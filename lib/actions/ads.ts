"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";

import { SIGNED_OUT, invalid, type ActionResult as SharedActionResult } from "@/lib/actions/result";
import { startAnalysisForVersion, askAboutAd as askAboutAdEngine } from "@/lib/ai/engine";
import { locateQuote, spanHash } from "@/lib/ai/spans";
import { getActiveProfileId, getCurrentUser, getMembershipRole } from "@/lib/auth/dal";
import { getNextNeedsReviewId } from "@/lib/data/ads";
import {
  IntakeError,
  acceptSourceItem,
  addVersion,
  createAd,
  createSampleAd,
  declineSourceItem,
  simulateRevision as simulateRevisionIntake,
} from "@/lib/intake/ads";
import { visibleLength } from "@/lib/intake/infer";
import { requireSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import type { AdFile, Product } from "@/lib/types/ads";

/**
 * Server Actions for the Ads list and the Ad page.
 *
 * Every action re-authenticates, confirms membership under RLS (by reading
 * the asset / finding / source item with the user-context client) and only
 * then calls intake, the engine or an RPC. Decisions go through
 * record_decision(): the database, not this code, decides what is approvable.
 */

export type ActionResult<T = null> = SharedActionResult<T>;

const NO_WORKSPACE: ActionResult<never> = { ok: false, error: "Pick a workspace first.", code: "no_workspace" };
const NOT_FOUND: ActionResult<never> = { ok: false, error: "That ad is not in this workspace.", code: "PT404" };

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel caps request bodies at 4.5 MB.
/** Pasted text: at least a sentence, at most 200,000 characters (intake keeps 60,000 for the check). */
const MIN_TEXT_CHARS = 10;
const MAX_TEXT_CHARS = 200_000;
/** Intake errors whose message is already written for the person who pasted or dropped the ad. */
const PLAIN_INTAKE_CODES = new Set(["empty", "empty_file", "too_large", "unsupported_type", "not_member", "rate_limited", "no_content"]);
const ACCEPTED_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "text/html", "text/plain"]);
const ACCEPTED_EXT = /\.(pdf|png|jpe?g|webp|html?|txt)$/i;

const uuid = z.guid({ error: "Invalid id." });
const productSchema = z.enum(["personal_loan", "credit_card", "mortgage", "other", "unknown"]);

function fail(err: unknown, fallback: string): ActionResult<never> {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[ads]", fallback, message);
  return { ok: false, error: fallback, code: "failed" };
}

/** Plain-English messages for the error codes record_decision and friends raise. */
function rpcFailure(error: PostgrestError, context: "decision" | "generic" = "generic"): ActionResult<never> {
  const msg = (error.message ?? "").toLowerCase();
  const hint = (error.hint ?? "").toLowerCase();
  switch (error.code) {
    case "PT404":
      return NOT_FOUND;
    case "PT409": {
      if (msg.includes("alert") || hint.includes("alert")) return { ok: false, error: "Acknowledge the hidden-text alert first.", code: error.code };
      if (msg.includes("still running")) return { ok: false, error: "The check is still running. Wait for it to finish, then try again.", code: error.code };
      if (msg.includes("not been analysed")) return { ok: false, error: "This version has not been checked yet. Wait for the check, then try again.", code: error.code };
      if (msg.includes("pre-check did not complete")) return { ok: false, error: "The AI check did not complete for this version. Reload the page; it will need a manual approval with a rationale.", code: error.code };
      if (msg.includes("latest")) return { ok: false, error: "A newer version arrived. Reload to review it.", code: error.code };
      if (msg.includes("fix required") || msg.includes("fix_required")) return { ok: false, error: "An issue is still marked Fix required. Resolve it or mark it Not a problem before approving.", code: error.code };
      if (msg.includes("no disposition")) return { ok: false, error: "Every open Critical or Major issue needs a written reason before approving.", code: error.code };
      if (msg.includes("unchanged") || hint.includes("unchanged")) return { ok: false, error: "That wording is already the current version.", code: error.code };
      if (msg.includes("draft")) return { ok: false, error: "This ad has not been submitted for review yet.", code: error.code };
      return { ok: false, error: context === "decision" ? "The ad changed while you were deciding. Reload and try again." : error.message, code: error.code };
    }
    case "PT422": {
      if (msg.includes("attest")) return { ok: false, error: "Tick the attestation box to approve.", code: error.code };
      if (msg.includes("rationale")) return { ok: false, error: "Add a rationale (at least 40 characters when there was no AI check, otherwise 20).", code: error.code };
      if (msg.includes("exception")) return { ok: false, error: "Each open Critical or Major issue needs a written reason of at least 40 characters.", code: error.code };
      if (msg.includes("change request") || msg.includes("items")) return { ok: false, error: "A change request needs at least one item with a required fix.", code: error.code };
      if (msg.includes("note")) return { ok: false, error: "The note must be at least 40 characters for Critical and Major issues.", code: error.code };
      return { ok: false, error: error.message || "Something in the form is not valid.", code: error.code };
    }
    case "42501": {
      if (msg.includes("self") || msg.includes("member")) return { ok: false, error: "You wrote this version, so you cannot approve it with exceptions while the workspace has other members. Ask another member to approve.", code: error.code };
      return { ok: false, error: "You are not allowed to do that.", code: error.code };
    }
    case "PGRST202":
      return { ok: false, error: "The database is not ready yet. Try again shortly.", code: error.code };
    default:
      console.error("[ads] rpc failed:", error.code, error.message);
      return { ok: false, error: "Something went wrong. Please try again.", code: error.code };
  }
}

async function requireUserAndWorkspace(): Promise<{ userId: string; profileId: string } | ActionResult<never>> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const profileId = await getActiveProfileId();
  if (!profileId) return NO_WORKSPACE;
  const role = await getMembershipRole(profileId);
  if (!role) return NO_WORKSPACE;
  return { userId: user.id, profileId };
}

function isFailure<T>(v: T | ActionResult<never>): v is ActionResult<never> {
  return typeof v === "object" && v !== null && "ok" in v && (v as { ok: unknown }).ok === false;
}

/** Loads an asset under RLS: proves membership and gives us the profile id. */
async function loadAsset(assetId: string) {
  const db = await createClient();
  const { data } = await db
    .from("assets")
    .select("id, profile_id, latest_version_id, status, product, channel, audience")
    .eq("id", assetId)
    .maybeSingle();
  return data;
}

function kickAnalysis(versionId: string) {
  after(async () => {
    try {
      await startAnalysisForVersion(versionId);
    } catch (err) {
      console.error("[ads] analysis start failed:", (err as Error).message);
    }
  });
}

// ---------------------------------------------------------------------------
// Create ads
// ---------------------------------------------------------------------------

async function fileFromForm(formData: FormData): Promise<AdFile | ActionResult<never> | null> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "That file is over 4 MB. Export a smaller PDF or image and try again.", code: "too_large" };
  const mime = file.type || guessMime(file.name);
  if (!ACCEPTED_MIME.has(mime) && !ACCEPTED_EXT.test(file.name)) {
    return { ok: false, error: "Use a PDF, PNG, JPG, WebP, HTML or text file.", code: "unsupported" };
  }
  return { name: file.name || "ad", bytes: new Uint8Array(await file.arrayBuffer()), mimeType: ACCEPTED_MIME.has(mime) ? mime : guessMime(file.name) };
}

function guessMime(name: string): string {
  const ext = name.toLowerCase().split(".").pop();
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "html":
    case "htm":
      return "text/html";
    default:
      return "text/plain";
  }
}

/**
 * Creates an ad from a dropped/chosen file or pasted text (FormData fields:
 * file | text, optional title, product, channel) and opens its page.
 * Redirects on success; returns an error otherwise.
 */
export async function uploadAd(formData: FormData): Promise<ActionResult<never>> {
  const ctx = await requireUserAndWorkspace();
  if (isFailure(ctx)) return ctx;

  const text = String(formData.get("text") ?? "").trim();
  const titleRaw = String(formData.get("title") ?? "").trim();
  const productRaw = String(formData.get("product") ?? "").trim();
  const channelRaw = String(formData.get("channel") ?? "").trim();
  const product = productSchema.safeParse(productRaw).success ? (productRaw as Product) : undefined;

  const file = await fileFromForm(formData);
  if (file && "ok" in file) return file;
  // Visible characters only: whitespace, zero-width and other invisible
  // characters never count as ad text.
  if (!file && visibleLength(text) < MIN_TEXT_CHARS) return { ok: false, error: "Paste the ad text (at least a sentence) or choose a file.", code: "invalid_input" };
  if (text.length > MAX_TEXT_CHARS) return { ok: false, error: `That text is too long. Paste up to ${MAX_TEXT_CHARS.toLocaleString("en-US")} characters.`, code: "invalid_input" };

  let created: { assetId: string; versionId: string };
  try {
    if (file) {
      const isHtml = file.mimeType === "text/html";
      const isText = file.mimeType === "text/plain";
      const decoded = isHtml || isText ? new TextDecoder().decode(file.bytes) : undefined;
      created = await createAd({
        profileId: ctx.profileId,
        userId: ctx.userId,
        origin: "upload",
        title: titleRaw || undefined,
        file: isHtml || isText ? undefined : file,
        html: isHtml ? decoded : undefined,
        text: isText ? decoded : undefined,
        product,
        channel: channelRaw || undefined,
      });
    } else {
      created = await createAd({
        profileId: ctx.profileId,
        userId: ctx.userId,
        origin: "paste",
        title: titleRaw || undefined,
        text,
        product,
        channel: channelRaw || undefined,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/unchanged|identical|PT409/i.test(message)) return { ok: false, error: "This exact ad is already in the workspace.", code: "PT409" };
    // Intake already says in plain English what was wrong with the input.
    if (err instanceof IntakeError && PLAIN_INTAKE_CODES.has(err.code)) return { ok: false, error: err.message, code: err.code };
    if (err instanceof IntakeError && err.code === "pdf_unreadable") {
      console.error("[ads] pdf unreadable:", message);
      return { ok: false, error: "That PDF could not be read. Export it again from the original file, or paste the text.", code: err.code };
    }
    return fail(err, "We could not read that ad. Try a different file or paste the text.");
  }
  kickAnalysis(created.versionId);
  redirect(`/ads/${created.assetId}`);
}

/** Pasted text only (used by the paste tab and the empty-state textarea). */
export async function pasteAd(input: { text: string; title?: string }): Promise<ActionResult<never>> {
  const fd = new FormData();
  fd.set("text", input.text ?? "");
  if (input.title) fd.set("title", input.title);
  return uploadAd(fd);
}

/** Starts a sample ad (empty state chips) and opens it. */
export async function trySample(sampleKey: string): Promise<ActionResult<never>> {
  const parsed = z.string().trim().min(1).max(80).safeParse(sampleKey);
  if (!parsed.success) return invalid(parsed.error);
  const ctx = await requireUserAndWorkspace();
  if (isFailure(ctx)) return ctx;
  let created: { assetId: string; versionId: string };
  try {
    created = await createSampleAd({ profileId: ctx.profileId, userId: ctx.userId, sampleKey: parsed.data });
  } catch (err) {
    return fail(err, "We could not start that sample. Try again.");
  }
  kickAnalysis(created.versionId);
  redirect(`/ads/${created.assetId}`);
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

const dispositionSchema = z.object({
  findingId: uuid,
  disposition: z.enum(["dismissed", "fix_required"]),
  reason: z.enum(["false_positive", "not_applicable", "disclosed_elsewhere"]).optional(),
  note: z.string().trim().max(2000).optional(),
});

/**
 * "Not a problem" (dismissed) or its undo (fix_required). For Critical and
 * Major issues a reason and a note of at least 40 characters are required
 * (checked here and again by the database).
 */
export async function dispositionFinding(input: z.input<typeof dispositionSchema>): Promise<ActionResult> {
  const parsed = dispositionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const db = await createClient();
  const { data: finding } = await db
    .from("findings")
    .select("id, profile_id, severity")
    .eq("id", parsed.data.findingId)
    .maybeSingle();
  if (!finding) return { ok: false, error: "That issue no longer exists.", code: "PT404" };

  const { disposition, reason, note } = parsed.data;
  if (disposition === "dismissed" && (finding.severity === "critical" || finding.severity === "major")) {
    if (!reason) return { ok: false, error: "Pick a reason.", code: "invalid_input" };
    if (!note || note.length < 40) return { ok: false, error: "Explain why in at least 40 characters, so the audit record stands on its own.", code: "invalid_input" };
  }
  const { error } = await db.from("finding_dispositions").insert({
    profile_id: finding.profile_id,
    finding_id: finding.id,
    disposition,
    reason: disposition === "dismissed" ? (reason ?? null) : null,
    note: note || null,
    actor_id: user.id,
  });
  if (error) return rpcFailure(error);
  refresh();
  return { ok: true, data: null };
}

const addIssueSchema = z.object({
  assetVersionId: uuid,
  quote: z
    .string()
    .trim()
    .min(1, { error: "Select the words in the ad first." })
    .max(500, { error: "Keep the quoted words under 500 characters: pick the few that matter." }),
  severity: z.enum(["critical", "major", "minor"], { error: "Pick a severity." }),
  ruleId: uuid.nullable().optional(),
  explanation: z
    .string()
    .trim()
    .min(10, { error: "Say why this is a problem (at least 10 characters)." })
    .max(1000, { error: "Keep the explanation under 1,000 characters." }),
});

export type AddIssueInput = z.input<typeof addIssueSchema>;

/**
 * "+ Add issue": a reviewer quotes words the AI missed. Recorded as a
 * finding with origin 'reviewer' and the author's id, anchored into the
 * version's text (the quote must be in the ad), optionally citing the
 * current version of one of the workspace's rules in force. At decision
 * time the database weighs it exactly like an AI finding.
 */
export async function addReviewerIssue(input: AddIssueInput): Promise<ActionResult<{ findingId: string }>> {
  const parsed = addIssueSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { assetVersionId, quote, severity, ruleId, explanation } = parsed.data;
  if (visibleLength(quote) === 0) return { ok: false, error: "Select some visible words in the ad first.", code: "invalid_input" };

  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;

  // Read under RLS: finding the version proves membership of its workspace.
  const db = await createClient();
  const { data: version } = await db.from("asset_versions").select("id, profile_id, asset_id, extracted_text, content").eq("id", assetVersionId).maybeSingle();
  if (!version) return { ok: false, error: "That ad no longer exists.", code: "PT404" };
  const { data: asset } = await db.from("assets").select("id, latest_version_id, status").eq("id", version.asset_id).maybeSingle();
  if (!asset) return { ok: false, error: "That ad no longer exists.", code: "PT404" };
  if (asset.latest_version_id !== version.id) return { ok: false, error: "Only the latest version can take new issues.", code: "PT409" };
  if (asset.status === "approved" || asset.status === "approved_with_exceptions") {
    return { ok: false, error: "This version is approved. Withdraw the approval before adding issues.", code: "PT409" };
  }

  const content = version.content && typeof version.content === "object" && !Array.isArray(version.content) ? (version.content as Record<string, unknown>) : {};
  const text = version.extracted_text || (typeof content.text === "string" ? content.text : "") || "";
  const anchor = locateQuote(text, quote);
  if (!anchor) return { ok: false, error: "Those words are not in this version of the ad.", code: "invalid_input" };

  // The rule must be one of this workspace's rules, in force, with a current version.
  let ruleVersionId: string | null = null;
  if (ruleId) {
    const { data: rule } = await db.from("rules").select("id, active, current_version_id").eq("id", ruleId).eq("profile_id", version.profile_id).maybeSingle();
    if (!rule || !rule.active || !rule.current_version_id) return { ok: false, error: "That rule is not in force in this workspace. Pick another or choose No specific rule.", code: "invalid_input" };
    ruleVersionId = rule.current_version_id;
  }

  // Members have no INSERT grant on findings (the engine writes them), so the
  // write goes through the admin client now that the RLS reads proved membership.
  let admin: ReturnType<typeof requireSupabaseAdminClient>;
  try {
    admin = requireSupabaseAdminClient();
  } catch (err) {
    return fail(err, "Issues cannot be added on this server right now.");
  }
  const { data: inserted, error } = await admin
    .from("findings")
    .insert({
      profile_id: version.profile_id,
      asset_version_id: version.id,
      origin: "reviewer",
      author_id: user.id,
      rule_version_id: ruleVersionId,
      severity,
      evidence_type: "needs_judgment",
      quote,
      span_hash: spanHash(quote),
      verified_span: true,
      anchor: { type: "text_range", start: anchor.start, end: anchor.end } as Json,
      explanation,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    if (error) return rpcFailure(error);
    return { ok: false, error: "Something went wrong. Please try again.", code: "failed" };
  }

  const { error: eErr } = await admin.from("events").insert({
    profile_id: version.profile_id,
    asset_id: version.asset_id,
    actor_id: user.id,
    kind: "finding.added",
    data: { finding_id: inserted.id, asset_version_id: version.id, severity, rule_version_id: ruleVersionId, quote: quote.slice(0, 200) } as Json,
  });
  if (eErr) console.error("[ads] finding.added event failed:", eErr.code, eErr.message);

  refresh();
  return { ok: true, data: { findingId: inserted.id } };
}

export async function acknowledgeAlert(alertId: string): Promise<ActionResult> {
  const parsed = uuid.safeParse(alertId);
  if (!parsed.success) return invalid(parsed.error);
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const db = await createClient();
  const { error } = await db.rpc("acknowledge_security_alert", { p_alert_id: parsed.data });
  if (error) return rpcFailure(error);
  refresh();
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

const decideSchema = z.object({
  versionId: uuid,
  decision: z.enum(["approved", "approved_with_exceptions", "changes_requested", "rejected"]),
  exceptions: z.array(z.object({ finding_id: uuid, reason: z.string().trim().max(60).optional(), text: z.string().trim().max(4000) })).default([]),
  rationale: z.string().trim().max(4000).optional(),
  attested: z.boolean().default(false),
  changeRequest: z
    .object({
      items: z.array(
        z.object({
          finding_id: uuid.optional(),
          quote: z.string().max(2000).optional(),
          rule: z.string().max(400).optional(),
          required_fix: z.string().trim().min(1).max(4000),
          suggested_copy: z.string().max(4000).optional(),
        }),
      ),
      note: z.string().max(8000).optional(),
      message_text: z.string().max(20000).optional(),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    .optional(),
});

export type DecideInput = z.input<typeof decideSchema>;
export type DecideResult = { decisionId: string; nextAdId: string | null };

/** Records a decision through record_decision(). The database enforces every rule. */
export async function decide(input: DecideInput): Promise<ActionResult<DecideResult>> {
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const { versionId, decision, exceptions, rationale, attested, changeRequest } = parsed.data;

  // UI-level checks with friendlier messages than the database's.
  if (decision === "approved_with_exceptions" && exceptions.some((e) => e.text.length < 40)) {
    return { ok: false, error: "Each exception needs a reason of at least 40 characters.", code: "invalid_input" };
  }
  if ((decision === "approved" || decision === "approved_with_exceptions") && !attested) {
    return { ok: false, error: "Tick the attestation box to approve.", code: "invalid_input" };
  }
  if (decision === "rejected" && !rationale) return { ok: false, error: "Say why you are rejecting this ad.", code: "invalid_input" };
  if (decision === "changes_requested" && (!changeRequest || changeRequest.items.length === 0)) {
    return { ok: false, error: "Add at least one change to request.", code: "invalid_input" };
  }

  const db = await createClient();
  const { data: version } = await db.from("asset_versions").select("id, asset_id, profile_id").eq("id", versionId).maybeSingle();
  if (!version) return NOT_FOUND;

  // Approving with open Critical/Major issues: the database wants each one
  // dispositioned as accepted_exception BEFORE the decision, plus one
  // justification entry each. supabase-js has no transactions, so we insert
  // the dispositions first and revert them (fix_required) if the decision fails.
  const added: string[] = [];
  if (decision === "approved_with_exceptions" && exceptions.length > 0) {
    const ids = exceptions.map((e) => e.finding_id);
    const { data: latest } = await db.from("finding_latest_dispositions").select("finding_id, disposition").in("finding_id", ids);
    const current = new Map((latest ?? []).map((d) => [d.finding_id, d.disposition]));
    for (const e of exceptions) {
      if (current.get(e.finding_id) === "accepted_exception") continue;
      const { error: dErr } = await db.from("finding_dispositions").insert({
        profile_id: version.profile_id,
        finding_id: e.finding_id,
        disposition: "accepted_exception",
        reason: e.reason || "business_decision",
        note: e.text,
        actor_id: user.id,
      });
      if (dErr) {
        await revertDispositions(db, version.profile_id, user.id, added);
        return rpcFailure(dErr);
      }
      added.push(e.finding_id);
    }
  }

  const { data, error } = await db.rpc("record_decision", {
    p_asset_version_id: versionId,
    p_decision: decision,
    p_exceptions: exceptions.map((e) => ({ finding_id: e.finding_id, reason: e.reason || "business_decision", text: e.text })) as unknown as Json,
    p_rationale: rationale || undefined,
    p_attested: attested,
    p_change_request: changeRequest ? (changeRequest as unknown as Json) : undefined,
  });
  if (error) {
    await revertDispositions(db, version.profile_id, user.id, added);
    return rpcFailure(error, "decision");
  }

  const nextAdId = await getNextNeedsReviewId(version.profile_id, version.asset_id);
  refresh();
  return { ok: true, data: { decisionId: String(data), nextAdId } };
}

async function revertDispositions(db: Awaited<ReturnType<typeof createClient>>, profileId: string, userId: string, findingIds: string[]) {
  if (findingIds.length === 0) return;
  const { error } = await db.from("finding_dispositions").insert(
    findingIds.map((finding_id) => ({
      profile_id: profileId,
      finding_id,
      disposition: "fix_required",
      note: "Reopened automatically: the approval did not go through.",
      actor_id: userId,
    })),
  );
  if (error) console.error("[ads] could not revert exception dispositions:", error.code, error.message);
}

export async function withdrawApproval(input: { assetId: string; rationale: string }): Promise<ActionResult> {
  const parsed = z.object({ assetId: uuid, rationale: z.string().trim().min(20, { error: "Give a reason of at least 20 characters." }).max(4000) }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const db = await createClient();
  const { error } = await db.rpc("withdraw_approval", { p_asset_id: parsed.data.assetId, p_rationale: parsed.data.rationale });
  if (error) return rpcFailure(error);
  refresh();
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

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
    })
    .safeParse({ assetId: String(formData.get("assetId") ?? ""), note: String(formData.get("note") ?? "").replace(/\s*\n+\s*/g, " ") });
  if (!parsed.success) return invalid(parsed.error);
  const { assetId, note } = parsed.data;

  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  // Read under RLS: finding the asset proves membership of its workspace.
  const asset = await loadAsset(assetId);
  if (!asset?.latest_version_id) return NOT_FOUND;
  if (asset.status === "approved" || asset.status === "approved_with_exceptions") {
    return { ok: false, error: "This ad is approved. Withdraw the approval before changing it.", code: "PT409" };
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
    if (/unchanged|identical|PT409/i.test(message)) {
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

// ---------------------------------------------------------------------------
// Metadata, triage, Q&A
// ---------------------------------------------------------------------------

export async function updateAdMeta(input: { assetId: string; product?: Product; channel?: string | null; title?: string }): Promise<ActionResult> {
  const parsed = z
    .object({
      assetId: uuid,
      product: productSchema.optional(),
      channel: z.string().trim().max(60).nullable().optional(),
      title: z.string().trim().min(1).max(200).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const patch: Record<string, Json> = {};
  if (parsed.data.product) patch.product = parsed.data.product;
  if (parsed.data.channel !== undefined) patch.channel = parsed.data.channel;
  if (parsed.data.title) patch.title = parsed.data.title;
  if (Object.keys(patch).length === 0) return { ok: true, data: null };
  const db = await createClient();
  const { error } = await db.rpc("update_asset", { p_asset_id: parsed.data.assetId, p_patch: patch });
  if (error) return rpcFailure(error);
  refresh();
  return { ok: true, data: null };
}

/** "Is this an ad?" Yes creates the ad and starts its check; No declines the item. */
export async function triageSourceItem(input: { sourceItemId: string; accept: boolean }): Promise<ActionResult<{ assetId: string | null }>> {
  const parsed = z.object({ sourceItemId: uuid, accept: z.boolean() }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const db = await createClient();
  const { data: item } = await db.from("source_items").select("id, profile_id, triage_status").eq("id", parsed.data.sourceItemId).maybeSingle();
  if (!item) return { ok: false, error: "That item is no longer waiting.", code: "PT404" };
  if (item.triage_status !== "pending") return { ok: false, error: "Someone already answered for this item.", code: "PT409" };
  try {
    if (parsed.data.accept) {
      const created = await acceptSourceItem({ sourceItemId: item.id, userId: user.id });
      kickAnalysis(created.versionId);
      refresh();
      return { ok: true, data: { assetId: created.assetId } };
    }
    await declineSourceItem({ sourceItemId: item.id, userId: user.id });
    refresh();
    return { ok: true, data: { assetId: null } };
  } catch (err) {
    return fail(err, parsed.data.accept ? "We could not turn that item into an ad." : "We could not skip that item.");
  }
}

/** Read-only Q&A over one version. Never approves, rejects or changes anything. */
export async function askAboutAd(input: { assetVersionId: string; question: string }): Promise<ActionResult<{ answer: string }>> {
  const parsed = z
    .object({ assetVersionId: uuid, question: z.string().trim().min(2, { error: "Ask a question first." }).max(1000, { error: "Keep the question under 1,000 characters." }) })
    .safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const db = await createClient();
  const { data: version } = await db.from("asset_versions").select("id, profile_id").eq("id", parsed.data.assetVersionId).maybeSingle();
  if (!version) return NOT_FOUND;
  try {
    const result = await askAboutAdEngine({ profileId: version.profile_id, userId: user.id, assetVersionId: version.id, question: parsed.data.question });
    if (!result.ok) return { ok: false, error: plainAskError(result.error), code: "ask_failed" };
    return { ok: true, data: { answer: result.answer } };
  } catch (err) {
    return fail(err, "Ask isn't available right now. Try again in a moment.");
  }
}

/** One plain-English shape for every "no answer" case: what happened, then what to do. */
function plainAskError(raw: string): string {
  const detail = raw.replace(/^Ask about this ad is not available( right now)?:\s*/i, "").trim();
  if (/ask a question first/i.test(detail)) return detail;
  if (/budget/i.test(detail)) return "Ask isn't available right now: today's AI budget for this workspace is used up. The issues above still stand; try again tomorrow.";
  if (/not configured|gateway|verification|credit|payment|billing|api key|unauthori[sz]ed|forbidden/i.test(detail)) {
    return "Ask isn't available right now: the AI service is not accepting requests for this workspace. The issues above still stand; a person can still decide.";
  }
  if (/different way|no answer/i.test(detail)) return "No answer came back. Try asking in a different way.";
  return `Ask isn't available right now. ${detail.replace(/\s*A person must review this ad\.?$/i, "")}`.trim();
}
