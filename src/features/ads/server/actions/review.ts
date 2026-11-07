"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { SIGNED_OUT, invalid, type ActionResult } from "@/lib/action-result";
import { visibleLength } from "@/features/analysis/infer";
import { locateQuote, spanHash } from "@/features/analysis/spans";
import { getCurrentUser } from "@/features/auth/server/dal";
import { getNextNeedsReviewId } from "@/features/ads/server/queries/next-ad";
import { MAX_IMAGE_LABEL_CHARS } from "@/features/ads/types";
import { requireSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

import { ARCHIVED, NOT_FOUND, fail, rpcFailure, uuid } from "./shared";

/**
 * Reviewing a version: everything the approval gate weighs. Issues (marking
 * one Not a problem or Fix required, adding one the AI missed), the
 * hidden-text alert, the decision itself through record_decision(), and
 * withdrawing an approval.
 */

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

/** A fraction of the rendered image, 0..1. */
const fraction = z.number().min(0).max(1);

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
  /**
   * An image note: the spot the reviewer pinned, as fractions of the rendered
   * image. With a region, `quote` is a short label ("APR in the footer") and
   * is not looked for in the text.
   */
  region: z
    .object({ x: fraction, y: fraction, w: fraction.optional(), h: fraction.optional() }, { error: "Click a spot on the image first." })
    .nullable()
    .optional(),
});

export type AddIssueInput = z.input<typeof addIssueSchema>;

/**
 * "+ Add issue": a reviewer quotes words the AI missed. Recorded as a
 * finding with origin 'reviewer' and the author's id, anchored into the
 * version's text (the quote must be in the ad), optionally citing the
 * current version of one of the workspace's rules in force. At decision
 * time the database weighs it exactly like an AI finding.
 *
 * With `region`, it is an image note instead: a pin the reviewer dropped on
 * an image ad. The anchor is {type: "image_region", x, y, w?, h?} (fractions
 * of the rendered image), the quote is the reviewer's label, verified_span
 * is false and there is no span hash, so recheck never pairs it with words
 * on a later version: a pin is always "new" to that version.
 */
export async function addReviewerIssue(input: AddIssueInput): Promise<ActionResult<{ findingId: string }>> {
  const parsed = addIssueSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { assetVersionId, quote, severity, ruleId, explanation, region } = parsed.data;
  if (visibleLength(quote) === 0) {
    return { ok: false, error: region ? "Give the note a short label first." : "Select some visible words in the ad first.", code: "invalid_input" };
  }
  if (region && quote.length > MAX_IMAGE_LABEL_CHARS) {
    return { ok: false, error: `Keep the label under ${MAX_IMAGE_LABEL_CHARS} characters; the details go in the explanation.`, code: "invalid_input" };
  }

  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;

  // Read under RLS: finding the version proves membership of its workspace.
  const db = await createClient();
  const { data: version } = await db.from("asset_versions").select("id, profile_id, asset_id, extracted_text, content").eq("id", assetVersionId).maybeSingle();
  if (!version) return { ok: false, error: "That ad no longer exists.", code: "PT404" };
  const { data: asset } = await db.from("assets").select("id, latest_version_id, status, archived_at").eq("id", version.asset_id).maybeSingle();
  if (!asset) return { ok: false, error: "That ad no longer exists.", code: "PT404" };
  if (asset.archived_at) return ARCHIVED;
  if (asset.latest_version_id !== version.id) return { ok: false, error: "Only the latest version can take new issues.", code: "PT409" };
  if (asset.status === "approved" || asset.status === "approved_with_exceptions") {
    return { ok: false, error: "This version is approved. Withdraw the approval before adding issues.", code: "PT409" };
  }

  const content = version.content && typeof version.content === "object" && !Array.isArray(version.content) ? (version.content as Record<string, unknown>) : {};
  let anchor: Json;
  let spanHashValue: string | null;
  let verifiedSpan: boolean;
  if (region) {
    // A pin only makes sense on a creative the page shows as an image.
    if (content.format !== "image") return { ok: false, error: "Notes can be pinned on image ads only. Select the words in the text instead.", code: "invalid_input" };
    anchor = { type: "image_region", x: region.x, y: region.y, ...(region.w !== undefined ? { w: region.w } : {}), ...(region.h !== undefined ? { h: region.h } : {}) };
    spanHashValue = null;
    verifiedSpan = false;
  } else {
    const text = version.extracted_text || (typeof content.text === "string" ? content.text : "") || "";
    const located = locateQuote(text, quote);
    if (!located) return { ok: false, error: "Those words are not in this version of the ad.", code: "invalid_input" };
    anchor = { type: "text_range", start: located.start, end: located.end };
    spanHashValue = spanHash(quote);
    verifiedSpan = true;
  }

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
      span_hash: spanHashValue,
      verified_span: verifiedSpan,
      anchor,
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
    data: {
      finding_id: inserted.id,
      asset_version_id: version.id,
      severity,
      rule_version_id: ruleVersionId,
      quote: quote.slice(0, 200),
      anchor_type: region ? "image_region" : "text_range",
    } as Json,
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
  const { data: owner } = await db.from("assets").select("archived_at").eq("id", version.asset_id).maybeSingle();
  if (owner?.archived_at) return ARCHIVED;

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
