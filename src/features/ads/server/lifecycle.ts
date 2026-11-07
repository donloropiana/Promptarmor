import "server-only";

import { APPROVED_STATUSES, liveChannelLabel } from "@/features/ads/format";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";

/**
 * Expiry sweep for ads that went live with an end date. Called by the daily
 * maintenance cron (every workspace) and on each Ads list load (that
 * workspace only), the way stale checks are nudged.
 *
 * An approved ad whose expires_at has passed goes back to Needs review:
 * status re_review_due, re_review_reason {kind: 'expired', ...} (the row
 * then shows the "Expired" tag instead of "Rates changed"). Its live fields
 * stay for the record. One events row (asset.expired, system actor) per ad.
 *
 * An ad that was re-approved after expiring keeps its old end date, so the
 * sweep only expires an ad whose end date passed AFTER its current approval
 * was granted (approval before end date). A re-approval after the end date
 * is left alone until it is marked live again with new dates.
 */
export type ExpirySweep = { checked: number; expired: number; ids: string[]; skipped?: string };

type Candidate = {
  id: string;
  profile_id: string;
  title: string;
  status: string;
  live_channel: string | null;
  expires_at: string | null;
  re_review_reason: Json | null;
  approved_decision_id: string | null;
};

export async function expireLapsedAds(opts: { profileId?: string; limit?: number } = {}): Promise<ExpirySweep> {
  const admin = createSupabaseAdminClient();
  if (!admin) return { checked: 0, expired: 0, ids: [], skipped: "admin client not configured" };
  const nowIso = new Date().toISOString();

  let query = admin
    .from("assets")
    .select("id, profile_id, title, status, live_channel, expires_at, re_review_reason, approved_decision_id")
    .in("status", [...APPROVED_STATUSES])
    .is("archived_at", null)
    .not("expires_at", "is", null)
    .lt("expires_at", nowIso)
    .order("expires_at", { ascending: true })
    .limit(opts.limit ?? 200);
  if (opts.profileId) query = query.eq("profile_id", opts.profileId);
  const { data, error } = await query;
  if (error) {
    // 42703: the lifecycle migration has not run yet; nothing can have an end date.
    if (error.code !== "42703") console.error("[lifecycle] expiry read failed:", error.code, error.message);
    return { checked: 0, expired: 0, ids: [], skipped: error.code === "42703" ? "lifecycle columns missing" : `error ${error.code}` };
  }

  // When was the current approval granted? Only an end date that passed
  // after that approval counts; a re-approval made after the end date does not.
  const rows = (data ?? []) as Candidate[];
  const decisionIds = rows.map((a) => a.approved_decision_id).filter((v): v is string => Boolean(v));
  const approvedAt = new Map<string, string>();
  if (decisionIds.length > 0) {
    const { data: decisions } = await admin.from("decisions").select("id, created_at").in("id", decisionIds);
    for (const d of decisions ?? []) approvedAt.set(d.id, d.created_at);
  }
  const candidates = rows.filter((a) => {
    if (!a.expires_at) return false;
    const grantedAt = a.approved_decision_id ? approvedAt.get(a.approved_decision_id) : undefined;
    if (grantedAt) return new Date(grantedAt).getTime() < new Date(a.expires_at).getTime();
    // No decision row to compare against: fall back to "not already expired for this same end date".
    const reason = a.re_review_reason && typeof a.re_review_reason === "object" && !Array.isArray(a.re_review_reason) ? (a.re_review_reason as Record<string, unknown>) : null;
    return !(reason?.kind === "expired" && reason.expires_at === a.expires_at);
  });

  const ids: string[] = [];
  for (const a of candidates) {
    const where = liveChannelLabel(a.live_channel);
    const reason = {
      kind: "expired",
      expires_at: a.expires_at,
      live_channel: a.live_channel,
      summary: `The approval's end date passed${where ? ` (live on ${where})` : ""}. Decide again before it runs further.`,
      expired_at: nowIso,
    };
    // The status guard: only an ad that is still approved moves (a decision
    // recorded in between wins).
    const { data: moved, error: uErr } = await admin
      .from("assets")
      .update({ status: "re_review_due", re_review_reason: reason as Json })
      .eq("id", a.id)
      .eq("profile_id", a.profile_id)
      .in("status", [...APPROVED_STATUSES])
      .select("id");
    if (uErr) {
      console.error("[lifecycle] expiry update failed:", uErr.code, uErr.message);
      continue;
    }
    if (!moved || moved.length === 0) continue;
    ids.push(a.id);
    const { error: eErr } = await admin.from("events").insert({
      profile_id: a.profile_id,
      asset_id: a.id,
      actor_id: null,
      kind: "asset.expired",
      data: { expires_at: a.expires_at, live_channel: a.live_channel, previous_status: a.status } as Json,
    });
    if (eErr) console.error("[lifecycle] asset.expired event failed:", eErr.code, eErr.message);
  }
  return { checked: data?.length ?? 0, expired: ids.length, ids };
}
