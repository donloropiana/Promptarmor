import "server-only";

import type { HiddenTextCandidate } from "@/features/analysis/schema";
import type { Json, TablesInsert } from "@/lib/supabase/types";

import type { Admin, AssetRow } from "./inputs";

/**
 * The small writes every stage shares: the run's current stage, hidden-text
 * security alerts, the needs-manual-review flag on a submitted ad, audit
 * events, and the error text the engine logs. Each one logs and carries on
 * when the write fails.
 */

export function errorText(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const causeText = cause instanceof Error ? ` (${cause.message})` : "";
    return `${err.name}: ${err.message}${causeText}`.slice(0, 1_000);
  }
  return String(err).slice(0, 1_000);
}

export async function setStage(admin: Admin, runId: string, stage: string): Promise<void> {
  const { error } = await admin.from("analysis_runs").update({ stage }).eq("id", runId);
  if (error) console.warn("[ai/engine] stage update failed:", error.code, error.message);
}

/** Who found an alert: the deterministic scan, the model, a recording, or the run it was copied from. */
export type AlertDetector = "deterministic" | "model" | "recorded" | "reused";

export async function insertAlerts(
  admin: Admin,
  profileId: string,
  versionId: string,
  candidates: HiddenTextCandidate[],
  detector: AlertDetector,
): Promise<number> {
  if (candidates.length === 0) return 0;
  const rows: TablesInsert<"security_alerts">[] = candidates.slice(0, 20).map((c) => ({
    profile_id: profileId,
    asset_version_id: versionId,
    kind: c.kind,
    excerpt: c.excerpt.slice(0, 300),
    location: { where: c.location, source: c.location.startsWith("html") ? "html" : "text", detector } as Json,
  }));
  const { error } = await admin.from("security_alerts").insert(rows);
  if (error) {
    console.error("[ai/engine] security_alerts insert failed:", error.code, error.message);
    return 0;
  }
  return rows.length;
}

/** A submitted ad waiting for review goes to manual review when the check cannot be trusted or failed. */
export async function flagManualReview(admin: Admin, asset: AssetRow, reason: string): Promise<void> {
  if (!asset.submitted_at || asset.status !== "needs_review") return;
  const { error } = await admin.from("assets").update({ status: "needs_manual_review" }).eq("id", asset.id).eq("status", "needs_review");
  if (error) {
    console.error("[ai/engine] needs_manual_review update failed:", error.code, error.message);
    return;
  }
  asset.status = "needs_manual_review";
  await logEvent(admin, asset.profile_id, asset.id, "analysis.manual_review", { reason });
}

export async function logEvent(admin: Admin, profileId: string, assetId: string | null, kind: string, data: Record<string, Json>): Promise<void> {
  const { error } = await admin.from("events").insert({ profile_id: profileId, asset_id: assetId, actor_id: null, kind, data: data as Json });
  if (error) console.warn("[ai/engine] event insert failed:", error.code, error.message);
}
