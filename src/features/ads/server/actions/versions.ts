"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { SIGNED_OUT, invalid, type ActionResult } from "@/lib/action-result";
import { visibleLength } from "@/features/analysis/infer";
import { getCurrentUser } from "@/features/auth/server/dal";
import { IntakeError, addVersion, simulateRevision as simulateRevisionIntake } from "@/features/ads/server/intake";
import { requireSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

import { ARCHIVED, NOT_FOUND, fail, kickAnalysis, uuid } from "./shared";
import { MAX_TEXT_CHARS, MIN_TEXT_CHARS, PLAIN_INTAKE_CODES, fileFromForm } from "./submission";

/**
 * New versions of an existing ad: applying a suggested wording, the
 * reviewer's own Edit copy / Replace file, and the demo's simulated revision.
 * Each makes a NEW immutable version through intake and re-checks it.
 */

/** Loads an asset under RLS: proves membership and gives us the profile id. */
async function loadAsset(assetId: string) {
  const db = await createClient();
  const { data } = await db
    .from("assets")
    .select("id, profile_id, latest_version_id, status, product, channel, audience, archived_at")
    .eq("id", assetId)
    .maybeSingle();
  return data;
}

/**
 * "Use this wording": replaces the quoted span with the suggested copy in a
 * NEW version (origin suggestion_applied) and re-checks it. Text ads only.
 */
export async function applySuggestion(input: { assetId: string; findingId: string }): Promise<ActionResult<{ versionId: string; versionNo: number }>> {
  const parsed = z.object({ assetId: uuid, findingId: uuid }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const asset = await loadAsset(parsed.data.assetId);
  if (!asset?.latest_version_id) return NOT_FOUND;
  if (asset.archived_at) return ARCHIVED;

  const db = await createClient();
  const [{ data: finding }, { data: version }] = await Promise.all([
    db.from("findings").select("id, asset_version_id, quote, suggested_copy, anchor").eq("id", parsed.data.findingId).maybeSingle(),
    db.from("asset_versions").select("id, content, extracted_text").eq("id", asset.latest_version_id).maybeSingle(),
  ]);
  if (!finding || !version) return { ok: false, error: "That issue no longer exists.", code: "PT404" };
  if (finding.asset_version_id !== version.id) return { ok: false, error: "A newer version exists. Apply suggestions on the latest version.", code: "PT409" };
  if (!finding.suggested_copy?.trim()) return { ok: false, error: "This issue has no suggested wording to apply.", code: "invalid_input" };

  const content = version.content && typeof version.content === "object" && !Array.isArray(version.content) ? (version.content as Record<string, unknown>) : {};
  const format = content.format;
  if (format !== "text" && format !== "html") return { ok: false, error: "Text suggestion only: this ad is a file, so edit the original and upload it again.", code: "invalid_input" };

  const base = (typeof content.text === "string" && content.text) || version.extracted_text || "";
  const replaced = replaceQuote(base, finding.quote ?? "", finding.suggested_copy.trim());
  if (!replaced) return { ok: false, error: "We could not find the quoted words in the current text. Edit it by hand instead.", code: "invalid_input" };

  let html: string | undefined;
  if (format === "html" && typeof content.html === "string") {
    html = replaceQuote(content.html, finding.quote ?? "", escapeHtml(finding.suggested_copy.trim())) ?? undefined;
    if (!html) return { ok: false, error: "Text suggestion only: we could not safely change the HTML. Edit the source instead.", code: "invalid_input" };
  }

  try {
    const result = await addVersion({
      assetId: asset.id,
      userId: user.id,
      origin: "suggestion_applied",
      text: replaced,
      html,
      note: `Applied suggested wording for issue ${finding.id}`,
    });
    kickAnalysis(result.versionId);
    refresh();
    return { ok: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/unchanged|identical|PT409/i.test(message)) return { ok: false, error: "That wording is already the current version.", code: "PT409" };
    return fail(err, "We could not create the new version. Try again.");
  }
}

/** The "What changed" note on a reviewer-made version: one line, required. */
const MAX_VERSION_NOTE_CHARS = 200;

export type AddVersionResult = { versionId: string; versionNo: number };

/**
 * "Edit copy" / "Replace file" on the ad page: the reviewer's edited text or
 * a new file becomes a NEW immutable version (origin reviewer_edit, author =
 * the signed-in user) with a one-line note, and the check runs on it exactly
 * as it does for an applied suggestion. FormData fields: assetId, note, and
 * either text (edited or pasted copy) or file (PDF, image, HTML or text, up
 * to 4 MB, the same limits as uploadAd). Refused while the ad is approved
 * or its latest version is still being checked.
 */
export async function addReviewerVersion(formData: FormData): Promise<ActionResult<AddVersionResult>> {
  const parsed = z
    .object({
      assetId: uuid,
      note: z
        .string()
        .trim()
        .min(1, { error: "Say what changed, in one line." })
        .max(MAX_VERSION_NOTE_CHARS, { error: `Keep the note under ${MAX_VERSION_NOTE_CHARS} characters.` }),
      // The version the sheet was opened on; a newer one means the edit is stale.
      baseVersionId: uuid.optional(),
    })
    .safeParse({
      assetId: String(formData.get("assetId") ?? ""),
      note: String(formData.get("note") ?? "").replace(/\s*\n+\s*/g, " "),
      baseVersionId: formData.get("baseVersionId") ? String(formData.get("baseVersionId")) : undefined,
    });
  if (!parsed.success) return invalid(parsed.error);
  const { assetId, note, baseVersionId } = parsed.data;

  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  // Read under RLS: finding the asset proves membership of its workspace.
  const asset = await loadAsset(assetId);
  if (!asset?.latest_version_id) return NOT_FOUND;
  if (asset.archived_at) return ARCHIVED;
  if (asset.status === "approved" || asset.status === "approved_with_exceptions") {
    return { ok: false, error: "This ad is approved. Withdraw the approval before changing it.", code: "PT409" };
  }
  if (baseVersionId && baseVersionId !== asset.latest_version_id) {
    return { ok: false, error: "A newer version arrived while you were editing. Reload to review it, then edit that one.", code: "PT409" };
  }
  const db = await createClient();
  const { data: run } = await db
    .from("analysis_runs")
    .select("status")
    .eq("asset_version_id", asset.latest_version_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (run && (run.status === "queued" || run.status === "running")) {
    return { ok: false, error: "The check is still running. Wait for it to finish, then try again.", code: "PT409" };
  }

  const file = await fileFromForm(formData);
  if (file && "ok" in file) return file;
  const text = String(formData.get("text") ?? "").replace(/\r\n?/g, "\n").trim();
  if (!file && visibleLength(text) < MIN_TEXT_CHARS) return { ok: false, error: "Write the ad text (at least a sentence) or choose a file.", code: "invalid_input" };
  if (!file && text.length > MAX_TEXT_CHARS) return { ok: false, error: `That text is too long. Keep it under ${MAX_TEXT_CHARS.toLocaleString("en-US")} characters.`, code: "invalid_input" };

  let result: AddVersionResult;
  try {
    if (file) {
      // Same path as uploadAd: HTML and text files are decoded and stored as
      // html/text versions; PDFs and images keep their bytes.
      const isHtml = file.mimeType === "text/html";
      const isText = file.mimeType === "text/plain";
      const decoded = isHtml || isText ? new TextDecoder().decode(file.bytes) : undefined;
      result = await addVersion({
        assetId: asset.id,
        userId: user.id,
        origin: "reviewer_edit",
        file: isHtml || isText ? undefined : file,
        html: isHtml ? decoded : undefined,
        text: isText ? decoded : undefined,
        note,
      });
    } else {
      result = await addVersion({ assetId: asset.id, userId: user.id, origin: "reviewer_edit", text, note });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if ((err instanceof IntakeError && err.code === "unchanged") || /unchanged|identical|PT409/i.test(message)) {
      return { ok: false, error: file ? "That file is the same as the current version, so nothing changed." : "That text is the same as the current version, so nothing changed.", code: "PT409" };
    }
    if (err instanceof IntakeError && PLAIN_INTAKE_CODES.has(err.code)) return { ok: false, error: err.message, code: err.code };
    if (err instanceof IntakeError && err.code === "pdf_unreadable") {
      console.error("[ads] pdf unreadable:", message);
      return { ok: false, error: "That PDF could not be read. Export it again from the original file, or paste the text.", code: err.code };
    }
    if (err instanceof IntakeError && err.code === "mime_mismatch") return { ok: false, error: err.message, code: err.code };
    return fail(err, "We could not create the new version. Try again.");
  }

  // The database logs version.created from the insert trigger; this row
  // carries who made the version and their note, for History.
  try {
    const admin = requireSupabaseAdminClient();
    const { error: eErr } = await admin.from("events").insert({
      profile_id: asset.profile_id,
      asset_id: asset.id,
      actor_id: user.id,
      kind: "version.added",
      data: {
        asset_version_id: result.versionId,
        version_no: result.versionNo,
        previous_version_id: asset.latest_version_id,
        how: file ? "replace_file" : "edit_copy",
        filename: file ? file.name.slice(0, 200) : null,
        note,
      } as Json,
    });
    if (eErr) console.error("[ads] version.added event failed:", eErr.code, eErr.message);
  } catch (err) {
    console.error("[ads] version.added event failed:", (err as Error).message);
  }

  kickAnalysis(result.versionId);
  refresh();
  return { ok: true, data: result };
}

function replaceQuote(haystack: string, quote: string, replacement: string): string | null {
  const q = quote.trim();
  if (!q) return null;
  const direct = haystack.indexOf(q);
  if (direct >= 0) return haystack.slice(0, direct) + replacement + haystack.slice(direct + q.length);
  // Case- and whitespace-insensitive match.
  const pattern = q
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const re = new RegExp(pattern, "i");
  const m = re.exec(haystack);
  if (!m) return null;
  return haystack.slice(0, m.index) + replacement + haystack.slice(m.index + m[0].length);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Demo: adds the sample's revision (or a generic improved copy) as a new version from "Gmail". */
export async function simulateRevision(assetId: string): Promise<ActionResult<{ versionId: string; versionNo: number }>> {
  const parsed = uuid.safeParse(assetId);
  if (!parsed.success) return invalid(parsed.error);
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const asset = await loadAsset(parsed.data);
  if (!asset) return NOT_FOUND;
  if (asset.archived_at) return ARCHIVED;
  try {
    const result = await simulateRevisionIntake({ assetId: asset.id, userId: user.id });
    kickAnalysis(result.versionId);
    refresh();
    return { ok: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/unchanged|identical|PT409/i.test(message)) return { ok: false, error: "The revision is identical to the current version.", code: "PT409" };
    return fail(err, "We could not simulate a revision for this ad.");
  }
}
