import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { bytesToText, resolveMime } from "@/features/connections/content";
import { SAMPLE_ADS } from "@/features/ads/samples";
import { requireSupabaseAdminClient } from "@/lib/supabase/admin";
import { downloadObject, uploadVersionBytes } from "@/lib/supabase/storage";
import type { Database, Json, TablesInsert } from "@/lib/supabase/types";
import type { AdFile, SampleKey, VersionContent } from "@/features/ads/types";
import { asProduct, isProductType, type Product } from "@/features/products/catalog";

import { extractFromHtml, extractFromText, extractPdf, type ExtractedDocument } from "@/features/analysis/extract";
import { normalizedTextHash, sha256Hex } from "@/features/analysis/hash";
import { hasVisibleText, inferChannel, inferProduct, inferTitle } from "@/features/analysis/infer";

/**
 * Intake: turning pasted text, uploaded files, sample ads and connector
 * arrivals into assets and immutable versions. Inserting a version makes the
 * database queue an analysis run; callers then start it with
 * `after(() => startAnalysisForVersion(versionId))` (lib/ai/engine).
 *
 * Every function confirms membership with the admin client before writing
 * (the admin client bypasses RLS). Nothing here runs the check.
 */

type Admin = SupabaseClient<Database>;
type VersionOrigin = Database["public"]["Tables"]["asset_versions"]["Insert"]["origin"];

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const TEXT_MIMES = new Set(["text/plain", "text/markdown", "text/csv"]);

/** Server-side upload ceiling (the Server Action body limit in next.config.ts is the first fence). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Abuse limits per person: how many ads (and versions) one account may
 * create per hour, across workspaces. Generous for a review desk, small
 * enough that a scripted loop cannot fill a workspace or burn the AI cap by
 * itself (each version queues a check).
 */
export const MAX_ADS_PER_USER_PER_HOUR = 60;
export const MAX_VERSIONS_PER_USER_PER_HOUR = 150;

/**
 * The bytes a file claims to be must match its first bytes: an HTML file
 * renamed .png would otherwise be stored as an image and sent to the model
 * as one. Text and HTML files are not sniffed (any bytes decode to text).
 */
function sniffMime(bytes: Uint8Array): "application/pdf" | "image/png" | "image/jpeg" | "image/webp" | "image/gif" | null {
  if (bytes.length < 12) return null;
  const b = bytes;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf"; // %PDF
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif"; // GIF8
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp"; // RIFF....WEBP
  return null;
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export class IntakeError extends Error {
  readonly code: string;
  constructor(message: string, code = "intake_error") {
    super(message);
    this.name = "IntakeError";
    this.code = code;
  }
}

async function assertMember(admin: Admin, profileId: string, userId: string): Promise<void> {
  const { data, error } = await admin
    .from("profile_members")
    .select("user_id")
    .eq("profile_id", profileId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new IntakeError("Could not confirm workspace membership.", "membership_check_failed");
  if (!data) throw new IntakeError("You are not a member of this workspace.", "not_member");
}

/** Refuses when one account has created more ads or versions in the last hour than the limits allow. */
async function assertCreateQuota(admin: Admin, userId: string, kind: "ad" | "version"): Promise<void> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const query =
    kind === "ad"
      ? admin
          .from("assets")
          .select("id", { count: "exact", head: true })
          .eq("created_by", userId)
          .gte("created_at", since)
          // Sample ads come from a fixed set of built-in texts ("Try a sample"), so they
          // cannot be abused and must not lock a member out of adding real ads.
          .or("audience.is.null,audience.neq.sample")
      : admin.from("asset_versions").select("id", { count: "exact", head: true }).eq("author_id", userId).gte("created_at", since);
  const { count, error } = await query;
  if (error) return; // A counting failure must not block the desk; the budget caps still hold.
  const limit = kind === "ad" ? MAX_ADS_PER_USER_PER_HOUR : MAX_VERSIONS_PER_USER_PER_HOUR;
  if ((count ?? 0) >= limit) {
    throw new IntakeError(
      kind === "ad"
        ? `You have added ${limit} ads in the last hour. Wait a little before adding more.`
        : `You have added ${limit} versions in the last hour. Wait a little before adding more.`,
      "rate_limited",
    );
  }
}

async function submitterFor(admin: Admin, userId: string): Promise<{ name: string | null; email: string | null }> {
  const { data } = await admin.from("users").select("full_name, email").eq("id", userId).maybeSingle();
  return { name: data?.full_name?.trim() || data?.email || null, email: data?.email ?? null };
}

// ---------------------------------------------------------------------------
// Building version content from raw input
// ---------------------------------------------------------------------------

type Built = {
  content: VersionContent;
  extractedText: string;
  contentSha256: string;
  normalizedTextHash: string | null;
  /** Bytes to store (uploads only). */
  bytes: Uint8Array | null;
  filename: string | null;
  mimeType: string | null;
};

async function buildFromInput(input: { text?: string; html?: string; file?: AdFile }): Promise<Built> {
  if (input.file) {
    const mime = resolveMime(input.file.mimeType, input.file.name);
    const bytes = input.file.bytes;
    if (!bytes || bytes.byteLength === 0) throw new IntakeError("The file is empty.", "empty_file");
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new IntakeError("The file is larger than 25 MB.", "too_large");
    if (mime === "application/pdf" || IMAGE_MIMES.has(mime)) {
      const sniffed = sniffMime(bytes);
      if (sniffed !== mime) {
        throw new IntakeError(
          sniffed
            ? `This file is a ${sniffed === "application/pdf" ? "PDF" : sniffed.replace("image/", "").toUpperCase()} named as ${mime === "application/pdf" ? "a PDF" : "an image"} of another kind. Rename it and try again.`
            : `This file is not a readable ${mime === "application/pdf" ? "PDF" : "image"}. Export it again and try once more.`,
          "mime_mismatch",
        );
      }
    }
    const sha = sha256Hex(bytes);
    const base: Pick<VersionContent, "filename" | "mimeType"> = { filename: input.file.name, mimeType: mime };

    if (mime === "application/pdf") {
      let doc: ExtractedDocument;
      try {
        doc = await extractPdf(bytes);
      } catch (err) {
        throw new IntakeError(`This PDF could not be read: ${(err as Error).message}`, "pdf_unreadable");
      }
      return {
        content: { format: "pdf", ...base, sections: doc.sections, meta: { pages: doc.pages } },
        extractedText: doc.text,
        contentSha256: sha,
        normalizedTextHash: normalizedTextHash(doc.text),
        bytes,
        filename: input.file.name,
        mimeType: mime,
      };
    }
    if (IMAGE_MIMES.has(mime)) {
      return {
        content: { format: "image", ...base, sections: [] },
        extractedText: "",
        contentSha256: sha,
        normalizedTextHash: null,
        bytes,
        filename: input.file.name,
        mimeType: mime,
      };
    }
    if (mime === "text/html") {
      const html = bytesToText(bytes);
      const doc = extractFromHtml(html);
      return {
        content: { format: "html", ...base, html, sections: doc.sections },
        extractedText: doc.text,
        contentSha256: sha,
        normalizedTextHash: normalizedTextHash(doc.text),
        bytes,
        filename: input.file.name,
        mimeType: mime,
      };
    }
    if (TEXT_MIMES.has(mime) || /\.(txt|md|csv)$/i.test(input.file.name)) {
      const text = bytesToText(bytes);
      if (!hasVisibleText(text)) throw new IntakeError("That file has no readable text in it. Paste the ad text or choose another file.", "empty");
      const doc = extractFromText(text);
      return {
        content: { format: "text", ...base, text, sections: doc.sections },
        extractedText: doc.text,
        contentSha256: sha,
        normalizedTextHash: normalizedTextHash(doc.text),
        bytes,
        filename: input.file.name,
        mimeType: mime === "text/markdown" ? "text/plain" : mime,
      };
    }
    throw new IntakeError("That file type is not supported. Use a PDF, image, HTML or text file.", "unsupported_type");
  }

  if (input.html && input.html.trim()) {
    const html = input.html;
    const doc = extractFromHtml(html);
    return {
      content: { format: "html", html, sections: doc.sections },
      extractedText: doc.text,
      contentSha256: sha256Hex(html),
      normalizedTextHash: normalizedTextHash(doc.text),
      bytes: null,
      filename: null,
      mimeType: "text/html",
    };
  }

  const text = (input.text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text || !hasVisibleText(text)) throw new IntakeError("There is no readable text here. Paste the ad text or choose a file.", "empty");
  const doc = extractFromText(text);
  return {
    content: { format: "text", text, sections: doc.sections },
    extractedText: doc.text,
    contentSha256: sha256Hex(text),
    normalizedTextHash: normalizedTextHash(doc.text),
    bytes: null,
    filename: null,
    mimeType: "text/plain",
  };
}

async function insertVersion(
  admin: Admin,
  row: {
    profileId: string;
    assetId: string;
    origin: VersionOrigin;
    authorId: string | null;
    sourceItemId?: string | null;
    built: Built;
    meta?: VersionContent["meta"];
  },
): Promise<{ versionId: string; versionNo: number }> {
  let storagePath: string | null = null;
  if (row.built.bytes && row.built.filename && row.built.mimeType) {
    const up = await uploadVersionBytes(admin, {
      profileId: row.profileId,
      filename: row.built.filename,
      bytes: row.built.bytes,
      mimeType: row.built.mimeType,
    });
    storagePath = up.path;
  }
  const content: VersionContent = {
    ...row.built.content,
    meta: { ...(row.built.content.meta ?? {}), ...(row.meta ?? {}) },
  };
  // version_no is assigned by the insert trigger (left out on purpose).
  const insert = {
    profile_id: row.profileId,
    asset_id: row.assetId,
    origin: row.origin,
    author_id: row.authorId,
    source_item_id: row.sourceItemId ?? null,
    content: content as unknown as Json,
    extracted_text: row.built.extractedText || null,
    content_sha256: row.built.contentSha256,
    normalized_text_hash: row.built.normalizedTextHash,
    storage_path: storagePath,
  } as unknown as TablesInsert<"asset_versions">;
  const { data, error } = await admin.from("asset_versions").insert(insert).select("id, version_no").single();
  if (error) {
    if (error.code === "PT409" && /identical/i.test(error.message)) {
      throw new IntakeError("This is the same content as the latest version, so nothing changed.", "unchanged");
    }
    throw new IntakeError(`Could not save the version: ${error.message}`, error.code ?? "version_insert_failed");
  }
  return { versionId: data.id, versionNo: data.version_no };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates an asset and its first version from pasted text, HTML or a file.
 * Infers product, channel and title when missing (cheap heuristics, no AI).
 * The version insert trigger queues the analysis run; this does not run it.
 */
export async function createAd(input: {
  profileId: string;
  userId: string;
  origin: "upload" | "paste";
  title?: string;
  text?: string;
  html?: string;
  file?: AdFile;
  product?: Product;
  channel?: string;
  isSample?: boolean;
  sampleKey?: string;
}): Promise<{ assetId: string; versionId: string }> {
  const admin = requireSupabaseAdminClient();
  await assertMember(admin, input.profileId, input.userId);
  await assertCreateQuota(admin, input.userId, "ad");

  const built = await buildFromInput({ text: input.text, html: input.html, file: input.file });
  const textForInference = built.extractedText || built.content.text || "";
  const product: Product = input.product && input.product !== "unknown" ? input.product : inferProduct(textForInference);
  const channel =
    input.channel?.trim() ||
    inferChannel({ text: textForInference, html: built.content.html, filename: built.filename, mimeType: built.mimeType });
  const title = inferTitle({ title: input.title, text: textForInference, filename: built.filename });
  const inferred = !input.product || !input.channel;

  const submitter = input.isSample ? { name: "Sample ad", email: null } : await submitterFor(admin, input.userId);

  const { data: asset, error: assetError } = await admin
    .from("assets")
    .insert({
      profile_id: input.profileId,
      title: title.slice(0, 500),
      product,
      channel,
      status: "needs_review",
      submitted_at: new Date().toISOString(),
      created_by: input.userId,
      submitter_name: submitter.name,
      submitter_email: submitter.email,
      audience: input.isSample ? "sample" : null,
    })
    .select("id")
    .single();
  if (assetError || !asset) throw new IntakeError(`Could not create the ad: ${assetError?.message ?? "unknown error"}`, assetError?.code ?? "asset_insert_failed");

  const version = await insertVersion(admin, {
    profileId: input.profileId,
    assetId: asset.id,
    origin: input.origin,
    authorId: input.userId,
    built,
    meta: { product, channel, inferred, ...(input.sampleKey ? { sampleKey: input.sampleKey } : {}) },
  });
  return { assetId: asset.id, versionId: version.versionId };
}

/** Adds a new immutable version to an existing ad (reviewer edit, applied suggestion, upload, paste, email). */
export async function addVersion(input: {
  assetId: string;
  userId: string;
  origin: "reviewer_edit" | "suggestion_applied" | "upload" | "paste" | "email";
  text?: string;
  html?: string;
  file?: AdFile;
  note?: string;
}): Promise<{ versionId: string; versionNo: number }> {
  const admin = requireSupabaseAdminClient();
  const { data: asset, error } = await admin.from("assets").select("id, profile_id, product, channel").eq("id", input.assetId).maybeSingle();
  if (error || !asset) throw new IntakeError("This ad could not be found.", "not_found");
  await assertMember(admin, asset.profile_id, input.userId);
  await assertCreateQuota(admin, input.userId, "version");

  const built = await buildFromInput({ text: input.text, html: input.html, file: input.file });
  const authorId = input.origin === "email" ? null : input.userId;
  return insertVersion(admin, {
    profileId: asset.profile_id,
    assetId: asset.id,
    origin: input.origin,
    authorId,
    built,
    meta: {
      product: asProduct(asset.product),
      channel: asset.channel ?? undefined,
      inferred: false,
      ...(input.note ? { note: input.note.slice(0, 500) } : {}),
      ...(input.origin === "email" ? { addedBy: input.userId } : {}),
    },
  });
}

/** Creates one of the built-in sample ads (lib/seed/samples) in the workspace. */
export async function createSampleAd(input: { profileId: string; userId: string; sampleKey: SampleKey }): Promise<{ assetId: string; versionId: string }> {
  const sample = SAMPLE_ADS.find((s) => s.key === input.sampleKey);
  if (!sample) throw new IntakeError("That sample ad does not exist.", "unknown_sample");
  return createAd({
    profileId: input.profileId,
    userId: input.userId,
    origin: "paste",
    title: sample.title,
    text: sample.format === "text" ? sample.text : undefined,
    html: sample.format === "html" ? (sample.html ?? undefined) : undefined,
    product: sample.product,
    channel: sample.channel,
    isSample: true,
    sampleKey: sample.key,
  });
}

/**
 * Demo: adds the next revision of an ad as if it had arrived by email. For
 * a sample ad this is the sample's scripted revision; for any other ad the
 * open suggestions on the latest version are applied to the text.
 */
export async function simulateRevision(input: { assetId: string; userId: string }): Promise<{ versionId: string; versionNo: number }> {
  const admin = requireSupabaseAdminClient();
  const { data: asset, error } = await admin
    .from("assets")
    .select("id, profile_id, audience, latest_version_id")
    .eq("id", input.assetId)
    .maybeSingle();
  if (error || !asset) throw new IntakeError("This ad could not be found.", "not_found");
  await assertMember(admin, asset.profile_id, input.userId);
  if (!asset.latest_version_id) throw new IntakeError("This ad has no version yet.", "no_version");

  const { data: latest } = await admin
    .from("asset_versions")
    .select("id, content, extracted_text")
    .eq("id", asset.latest_version_id)
    .single();
  const content = ((latest?.content ?? {}) as VersionContent) ?? {};
  const meta = (content.meta ?? {}) as { sampleKey?: string };

  if (asset.audience === "sample" && meta.sampleKey) {
    const sample = SAMPLE_ADS.find((s) => s.key === meta.sampleKey);
    if (sample?.revision_html) {
      return addVersion({ assetId: asset.id, userId: input.userId, origin: "email", html: sample.revision_html, note: "Revision received by email (demo)" });
    }
    if (sample?.revision) {
      return addVersion({ assetId: asset.id, userId: input.userId, origin: "email", text: sample.revision, note: "Revision received by email (demo)" });
    }
  }

  const note = "Revision received by email (demo)";
  if (content.format === "html" && content.html) {
    const revisedHtml = await applySuggestions(admin, asset.latest_version_id, content.html, "html");
    return addVersion({ assetId: asset.id, userId: input.userId, origin: "email", html: revisedHtml, note });
  }
  const baseText = content.text ?? latest?.extracted_text ?? "";
  const revised = await applySuggestions(admin, asset.latest_version_id, baseText, "text");
  return addVersion({ assetId: asset.id, userId: input.userId, origin: "email", text: revised, note });
}

const GENERIC_DISCLOSURE = "Rates, fees and terms are subject to credit approval and may change. See full terms before applying.";

/**
 * Applies every suggested_copy on a version to its text or HTML (the quoted
 * words are replaced in place); when nothing applies, a generic disclosure
 * line is added so the revision still differs from the original.
 */
async function applySuggestions(admin: Admin, versionId: string, source: string, kind: "text" | "html"): Promise<string> {
  const { data: findings } = await admin
    .from("findings")
    .select("id, quote, suggested_copy")
    .eq("asset_version_id", versionId)
    .not("suggested_copy", "is", null);
  let out = source;
  let applied = 0;
  for (const f of findings ?? []) {
    if (!f.quote || !f.suggested_copy || !out.includes(f.quote)) continue;
    // Model-written copy goes in as text: escaped for HTML, and through a
    // function so "$&" / "$'" in the wording are never replacement patterns.
    const replacement = kind === "html" ? escapeHtmlText(f.suggested_copy) : f.suggested_copy;
    out = out.replace(f.quote, () => replacement);
    applied++;
  }
  if (applied === 0) {
    if (kind === "html") {
      const line = `<p>${GENERIC_DISCLOSURE}</p>`;
      out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${line}</body>`) : `${out}\n${line}`;
    } else {
      out = `${out.trim()}\n\n${GENERIC_DISCLOSURE}`;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Connector arrivals ("Is this an ad?")
// ---------------------------------------------------------------------------

type SourceItemRow = Database["public"]["Tables"]["source_items"]["Row"];

async function loadVisibleSourceItem(admin: Admin, sourceItemId: string, userId: string): Promise<SourceItemRow> {
  const { data: item, error } = await admin.from("source_items").select("*").eq("id", sourceItemId).maybeSingle();
  if (error || !item) throw new IntakeError("This item could not be found.", "not_found");
  await assertMember(admin, item.profile_id, userId);
  if (item.visibility !== "profile") {
    // Private to the member who connected the account it came from.
    const { data: conn } = item.connection_id
      ? await admin.from("connections").select("connected_by").eq("id", item.connection_id).maybeSingle()
      : { data: null };
    if (!conn || conn.connected_by !== userId) throw new IntakeError("This item could not be found.", "not_found");
  }
  return item;
}

/**
 * "Is this an ad? Yes": creates an asset and v1 from a connector arrival,
 * links provenance and marks the item accepted. Bytes come from storage
 * when stored, otherwise the extracted text is used.
 */
export async function acceptSourceItem(input: { sourceItemId: string; userId: string }): Promise<{ assetId: string; versionId: string }> {
  const admin = requireSupabaseAdminClient();
  const item = await loadVisibleSourceItem(admin, input.sourceItemId, input.userId);
  if (item.asset_id) {
    const { data: existing } = await admin.from("assets").select("id, latest_version_id").eq("id", item.asset_id).maybeSingle();
    if (existing?.latest_version_id) return { assetId: existing.id, versionId: existing.latest_version_id };
  }

  let built: Built | null = null;
  if (item.storage_path) {
    try {
      const bytes = await downloadObject(admin, item.storage_path);
      const name = item.storage_path.split("/").pop() || item.title || "arrival";
      built = await buildFromInput({ file: { name, bytes, mimeType: item.mime_type ?? resolveMime(null, name) } });
    } catch (err) {
      console.warn("[intake] stored bytes unusable, falling back to text:", (err as Error).message);
      built = null;
    }
  }
  if (!built) {
    const text = (item.extracted_text ?? "").trim();
    if (!text) throw new IntakeError("This item has no readable content to check.", "no_content");
    built = await buildFromInput(item.mime_type === "text/html" ? { html: text } : { text });
  }
  // Stored bytes are copied under versions/ (version objects are write-once and unique per version).

  const inferred = (item.inferred ?? {}) as { product?: string; channel?: string | null };
  const textForInference = built.extractedText || "";
  const product: Product = isProductType(inferred.product) ? inferred.product : inferProduct(textForInference);
  const channel = inferred.channel || (item.kind === "email" ? "email" : inferChannel({ text: textForInference, html: built.content.html, filename: item.title, mimeType: item.mime_type }));
  const title = inferTitle({ title: item.title, text: textForInference, filename: built.filename });

  const { data: asset, error: assetError } = await admin
    .from("assets")
    .insert({
      profile_id: item.profile_id,
      title: title.slice(0, 500),
      product,
      channel,
      status: "needs_review",
      submitted_at: new Date().toISOString(),
      created_by: input.userId,
      submitter_name: item.sender,
      submitter_email: item.sender_email,
    })
    .select("id")
    .single();
  if (assetError || !asset) throw new IntakeError(`Could not create the ad: ${assetError?.message ?? "unknown error"}`, assetError?.code ?? "asset_insert_failed");

  const { error: linkError } = await admin
    .from("asset_sources")
    .insert({ asset_id: asset.id, source_item_id: item.id, profile_id: item.profile_id });
  if (linkError) console.warn("[intake] asset_sources insert failed:", linkError.code, linkError.message);

  const version = await insertVersion(admin, {
    profileId: item.profile_id,
    assetId: asset.id,
    origin: item.kind === "email" || item.kind === "attachment" ? "email" : "sync",
    authorId: null,
    sourceItemId: item.id,
    built,
    meta: { product, channel, inferred: true, source: item.provider, acceptedBy: input.userId },
  });

  const now = new Date().toISOString();
  const { error: triageError } = await admin
    .from("source_items")
    .update({
      triage_status: "accepted",
      triage_reason: "Accepted as an ad",
      triaged_by: input.userId,
      triaged_at: now,
      asset_id: asset.id,
    })
    .eq("id", item.id);
  if (triageError) console.warn("[intake] triage update failed:", triageError.code, triageError.message);

  // Open source-item alerts (filename, subject, sender scans) follow the ad onto v1.
  const { data: alerts } = await admin
    .from("security_alerts")
    .select("kind, excerpt, location")
    .eq("source_item_id", item.id)
    .is("acknowledged_at", null);
  if (alerts && alerts.length > 0) {
    await admin.from("security_alerts").insert(
      alerts.map((a) => ({
        profile_id: item.profile_id,
        asset_version_id: version.versionId,
        kind: a.kind,
        excerpt: a.excerpt,
        location: a.location,
      })),
    );
  }

  await admin.from("events").insert({
    profile_id: item.profile_id,
    asset_id: asset.id,
    actor_id: input.userId,
    kind: "triage.accepted",
    data: { source_item_id: item.id, provider: item.provider, kind: item.kind } as Json,
  });

  return { assetId: asset.id, versionId: version.versionId };
}

/** "Is this an ad? No": marks the arrival declined. Nothing else changes. */
export async function declineSourceItem(input: { sourceItemId: string; userId: string }): Promise<void> {
  const admin = requireSupabaseAdminClient();
  const item = await loadVisibleSourceItem(admin, input.sourceItemId, input.userId);
  if (item.triage_status === "declined") return;
  const { error } = await admin
    .from("source_items")
    .update({
      triage_status: "declined",
      triage_reason: "Not an ad",
      triaged_by: input.userId,
      triaged_at: new Date().toISOString(),
    })
    .eq("id", item.id);
  if (error) throw new IntakeError(`Could not update the item: ${error.message}`, error.code ?? "triage_failed");
  await admin.from("events").insert({
    profile_id: item.profile_id,
    asset_id: null,
    actor_id: input.userId,
    kind: "triage.declined",
    data: { source_item_id: item.id, provider: item.provider, kind: item.kind } as Json,
  });
}
