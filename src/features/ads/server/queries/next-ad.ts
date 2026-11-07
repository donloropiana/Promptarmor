import "server-only";

import { NEEDS_REVIEW_STATUSES, rankAd } from "@/features/ads/domain";
import { createClient } from "@/lib/supabase/server";

import type { Db } from "./shared";

/**
 * Which ad to open next after a decision: the worst-ranked ad still needing
 * review, ranked the way the Ads list ranks it. Read-only, with the
 * user-context client.
 */

/** Worst-first id of the next ad needing review, excluding one. Used after a decision. */
export async function getNextNeedsReviewId(profileId: string, excludeAssetId: string): Promise<string | null> {
  return getNextNeedsReviewIdWith(await createClient(), profileId, excludeAssetId);
}

/**
 * Ranked with rankAd, the list's own order. The database order puts every ad
 * with hidden text first, then any critical, major and minor issue, then the
 * oldest, so the 200 rows read hold the true top ad unless more than 200
 * share its worst flag.
 */
export async function getNextNeedsReviewIdWith(db: Db, profileId: string, excludeAssetId: string): Promise<string | null> {
  const { data } = await db
    .from("asset_queue")
    .select("asset_id, open_alert_count, open_critical, open_major, open_minor, submitted_at, created_at")
    .eq("profile_id", profileId)
    .eq("is_draft", false)
    .neq("asset_id", excludeAssetId)
    .in("status", [...NEEDS_REVIEW_STATUSES])
    .order("open_alert_count", { ascending: false, nullsFirst: false })
    .order("open_critical", { ascending: false, nullsFirst: false })
    .order("open_major", { ascending: false, nullsFirst: false })
    .order("open_minor", { ascending: false, nullsFirst: false })
    .order("submitted_at", { ascending: true })
    .order("asset_id", { ascending: true })
    .limit(200);
  const now = Date.now();
  let best: { id: string; rank: number } | null = null;
  for (const q of data ?? []) {
    if (!q.asset_id) continue;
    const rank = rankAd(
      {
        hiddenText: (q.open_alert_count ?? 0) > 0,
        openCritical: q.open_critical ?? 0,
        openMajor: q.open_major ?? 0,
        openMinor: q.open_minor ?? 0,
        submittedAt: q.submitted_at ?? q.created_at ?? new Date(0).toISOString(),
      },
      now,
    );
    if (!best || rank < best.rank) best = { id: q.asset_id, rank };
  }
  return best?.id ?? null;
}
