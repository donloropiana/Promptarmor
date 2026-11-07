import { timingSafeEqual } from "node:crypto";

import { getAiMode, runAnalysis, STALE_QUEUED_MS, STUCK_RUNNING_MS } from "@/features/analysis/server/engine";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/cron/analyze   (Vercel Cron; Hobby allows one run per day, see vercel.json)
 *
 * Safety net for analysis runs nobody finished: the request that created a
 * version normally runs the check in after(), and the Ads list nudges
 * stale runs on every load (nudgeStaleRuns in lib/ai/engine). This sweep
 * covers the rest, across every workspace:
 *   1. runs stuck in 'running' for over 10 minutes -> failed (+ manual review)
 *   2. queued runs older than 2 minutes -> run, oldest first, while time allows
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET`. Without CRON_SECRET the
 * route refuses every call (fails closed). Runs follow AI_MODE like any
 * other: outside live mode they complete without a model call.
 */

// One check can take up to ~100 s (90 s model timeout + persistence).
export const maxDuration = 120;

/** Only start another run while this much of the budget is left. */
const START_RUN_BEFORE_MS = 25_000;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(header);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) {
    if (!process.env.CRON_SECRET) console.warn("[cron/analyze] CRON_SECRET is not set; refusing.");
    return json({ error: "unauthorized" }, 401);
  }
  const startedAt = Date.now();
  const admin = createSupabaseAdminClient();
  if (!admin) return json({ error: "not configured" }, 503);

  const summary = { stuck_failed: 0, ran: 0, remaining_queued: 0 };

  // 1. Runs whose owner is gone.
  const stuckBefore = new Date(Date.now() - STUCK_RUNNING_MS).toISOString();
  const { data: stuck } = await admin
    .from("analysis_runs")
    .select("id, asset_version_id")
    .eq("status", "running")
    .lt("created_at", stuckBefore)
    .limit(25);
  for (const run of stuck ?? []) {
    const { data: updated } = await admin
      .from("analysis_runs")
      .update({
        status: "failed",
        stage: "failed",
        error: "Timed out: the check did not finish within 10 minutes.",
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id)
      .eq("status", "running")
      .select("id, profile_id, asset_version_id")
      .maybeSingle();
    if (!updated) continue;
    summary.stuck_failed++;
    const { data: version } = await admin.from("asset_versions").select("asset_id").eq("id", updated.asset_version_id).maybeSingle();
    if (version?.asset_id) {
      await admin
        .from("assets")
        .update({ status: "needs_manual_review" })
        .eq("id", version.asset_id)
        .eq("status", "needs_review")
        .not("submitted_at", "is", null);
    }
  }

  // 2. Queued runs nobody picked up.
  const staleBefore = new Date(Date.now() - STALE_QUEUED_MS).toISOString();
  const { data: queued } = await admin
    .from("analysis_runs")
    .select("id")
    .eq("status", "queued")
    .lt("created_at", staleBefore)
    .order("created_at", { ascending: true })
    .limit(10);
  const ids = (queued ?? []).map((r) => r.id);
  for (const id of ids) {
    if (Date.now() - startedAt > START_RUN_BEFORE_MS) break;
    await runAnalysis(id);
    summary.ran++;
  }
  summary.remaining_queued = Math.max(0, ids.length - summary.ran);

  return json({ ok: true, ai_mode: getAiMode(), ...summary, duration_ms: Date.now() - startedAt });
}
