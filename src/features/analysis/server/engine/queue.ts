import "server-only";

import { requireSupabaseAdminClient } from "@/lib/supabase/admin";

import { failRun } from "./outcomes";
import { errorText } from "./records";
import { runAnalysis } from "./run";

/**
 * Which queued runs get run, and when. Neither entry point throws.
 *
 * Call sites:
 *   after(() => startAnalysisForVersion(versionId))   right after intake
 *   after(() => nudgeStaleRuns(profileId))            from the Ads list
 *   GET /api/cron/analyze                              daily sweep (Hobby)
 */

/** A queued run older than this is considered stale and re-run by nudgeStaleRuns. */
export const STALE_QUEUED_MS = 2 * 60 * 1000;
/** A running run older than this is marked failed (the function that owned it is gone). */
export const STUCK_RUNNING_MS = 10 * 60 * 1000;

/** Runs the queued analysis run for a version, if any. Never throws. */
export async function startAnalysisForVersion(versionId: string): Promise<void> {
  try {
    const admin = requireSupabaseAdminClient();
    const { data, error } = await admin
      .from("analysis_runs")
      .select("id")
      .eq("asset_version_id", versionId)
      .eq("status", "queued")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[ai/engine] queued run lookup failed:", error.code, error.message);
      return;
    }
    if (!data?.id) return;
    await runAnalysis(data.id);
  } catch (err) {
    console.error("[ai/engine] startAnalysisForVersion failed:", errorText(err));
  }
}

/**
 * Cheap recovery for runs the request that created them never finished
 * (cold start, timeout, lost after()). Marks runs stuck in 'running' for
 * over 10 minutes as failed, then re-runs up to `limit` queued runs older
 * than 2 minutes. Call it inside after() from a workspace page; it returns
 * quickly when there is nothing to do.
 */
export async function nudgeStaleRuns(profileId: string, options: { limit?: number } = {}): Promise<{ ran: number; failed: number }> {
  const limit = Math.max(1, Math.min(options.limit ?? 2, 5));
  const summary = { ran: 0, failed: 0 };
  try {
    const admin = requireSupabaseAdminClient();
    const stuckBefore = new Date(Date.now() - STUCK_RUNNING_MS).toISOString();
    const { data: stuck } = await admin
      .from("analysis_runs")
      .select("id, asset_version_id")
      .eq("profile_id", profileId)
      .eq("status", "running")
      .lt("created_at", stuckBefore)
      .limit(10);
    for (const run of stuck ?? []) {
      await failRun(admin, run.id, "Timed out: the check did not finish within 10 minutes.", { profileId });
      summary.failed++;
    }

    const staleBefore = new Date(Date.now() - STALE_QUEUED_MS).toISOString();
    const { data: queued } = await admin
      .from("analysis_runs")
      .select("id")
      .eq("profile_id", profileId)
      .eq("status", "queued")
      .lt("created_at", staleBefore)
      .order("created_at", { ascending: true })
      .limit(limit);
    for (const run of queued ?? []) {
      await runAnalysis(run.id);
      summary.ran++;
    }
  } catch (err) {
    console.error("[ai/engine] nudgeStaleRuns failed:", errorText(err));
  }
  return summary;
}
