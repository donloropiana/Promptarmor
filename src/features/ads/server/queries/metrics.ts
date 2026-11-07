import "server-only";

import { APPROVED_STATUSES } from "@/features/ads/domain";
import { createClient } from "@/lib/supabase/server";

import type { AdsListData } from "./list";
import type { Db } from "./shared";

/**
 * The numbers above the Ads list: the summary line and the broken-connection
 * banner (getAdsSummary, from the list just read plus the workspace's
 * connections) and the metrics strip (getAdsMetrics: days to approval,
 * first-time approvals, exceptions, reviewer minutes, today's AI spend).
 * Samples never count. Read-only, with the user-context client.
 */

export type AdsSummary = {
  needReview: number;
  revisionsIn: number;
  connectedAccounts: number;
  lastSyncedAt: string | null;
  brokenConnections: { id: string; provider: string; accountEmail: string | null; status: string }[];
};

export type AdsMetrics = {
  decisions: number;
  ready: boolean;
  minutesPerAd: number | null;
  daysToApproval: number | null;
  approvedFirstTimePct: number | null;
  exceptions: number | null;
  aiSpendToday: number | null;
  aiCap: number | null;
  aiRemaining: number | null;
};

export async function getAdsSummary(profileId: string, list: AdsListData): Promise<AdsSummary> {
  return getAdsSummaryWith(await createClient(), profileId, list);
}

export async function getAdsSummaryWith(db: Db, profileId: string, list: AdsListData): Promise<AdsSummary> {
  const { data: conns } = await db
    .from("connections")
    .select("id, provider, account_email, status, last_synced_at")
    .eq("profile_id", profileId);
  const live = (conns ?? []).filter((c) => c.status === "connected" || c.status === "syncing");
  const broken = (conns ?? []).filter((c) => c.status === "needs_reconnect" || c.status === "error");
  const lastSyncedAt = live.reduce<string | null>((acc, c) => {
    if (!c.last_synced_at) return acc;
    return !acc || c.last_synced_at > acc ? c.last_synced_at : acc;
  }, null);
  const real = list.rows.filter((r) => !r.isSample);
  return {
    needReview: real.filter((r) => r.tab === "needs_review").length,
    revisionsIn: real.filter((r) => r.tab === "needs_review" && r.versionNo > 1).length,
    connectedAccounts: live.length,
    lastSyncedAt,
    brokenConnections: broken.map((c) => ({ id: c.id, provider: c.provider, accountEmail: c.account_email, status: c.status })),
  };
}

export async function getAdsMetrics(profileId: string): Promise<AdsMetrics> {
  return getAdsMetricsWith(await createClient(), profileId);
}

export async function getAdsMetricsWith(db: Db, profileId: string): Promise<AdsMetrics> {
  const out: AdsMetrics = {
    decisions: 0,
    ready: false,
    minutesPerAd: null,
    daysToApproval: null,
    approvedFirstTimePct: null,
    exceptions: null,
    aiSpendToday: null,
    aiCap: null,
    aiRemaining: null,
  };

  const [budgetRes, decisionsRes, assetsRes] = await Promise.all([
    db.rpc("ai_budget_status", { p_profile_id: profileId }),
    db
      .from("decisions")
      .select("id, asset_id, asset_version_id, decision, created_at")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: true })
      .limit(2000),
    db.from("assets").select("id, audience, submitted_at, status").eq("profile_id", profileId).limit(1000),
  ]);

  const budget = Array.isArray(budgetRes.data) ? budgetRes.data[0] : budgetRes.data;
  if (budget) {
    out.aiSpendToday = Number(budget.profile_used_usd ?? 0);
    out.aiCap = Number(budget.profile_cap_usd ?? 0);
    out.aiRemaining = Number(budget.remaining_usd ?? 0);
  }

  // Samples are never counted, and clearing them (audience 'sample_cleared')
  // must not turn their practice decisions into real numbers.
  const sampleIds = new Set((assetsRes.data ?? []).filter((a) => isSampleAudience(a.audience)).map((a) => a.id));
  const assetById = new Map((assetsRes.data ?? []).map((a) => [a.id, a]));
  const decisions = (decisionsRes.data ?? []).filter((d) => !sampleIds.has(d.asset_id) && d.decision !== "withdrawn");
  out.decisions = decisions.length;
  out.ready = decisions.length >= 5;
  if (!out.ready) return out;

  const byAsset = new Map<string, typeof decisions>();
  for (const d of decisions) {
    const list = byAsset.get(d.asset_id) ?? [];
    list.push(d);
    byAsset.set(d.asset_id, list);
  }

  // Days to approval: submitted_at -> first approval, per approved asset.
  const approvalDays: number[] = [];
  let firstTime = 0;
  for (const [assetId, list] of byAsset) {
    const first = list[0];
    if (APPROVED_STATUSES.has(first.decision)) firstTime += 1;
    const approval = list.find((d) => APPROVED_STATUSES.has(d.decision));
    const submitted = assetById.get(assetId)?.submitted_at;
    if (approval && submitted) {
      const days = (new Date(approval.created_at).getTime() - new Date(submitted).getTime()) / 86_400_000;
      if (days >= 0) approvalDays.push(days);
    }
  }
  out.approvedFirstTimePct = byAsset.size ? Math.round((firstTime / byAsset.size) * 100) : null;
  out.daysToApproval = approvalDays.length ? round1(approvalDays.reduce((a, b) => a + b, 0) / approvalDays.length) : null;
  out.exceptions = (assetsRes.data ?? []).filter((a) => a.status === "approved_with_exceptions" && !isSampleAudience(a.audience)).length;

  // Minutes per ad: reviewer active time on decided assets' versions.
  const decidedVersionIds = [...new Set(decisions.map((d) => d.asset_version_id))];
  if (decidedVersionIds.length) {
    const { data: sessions } = await db
      .from("review_sessions")
      .select("asset_version_id, active_seconds, surface")
      .in("asset_version_id", decidedVersionIds)
      .in("surface", ["workbench", "compare", "composer"]);
    const total = (sessions ?? []).reduce((acc, s) => acc + (s.active_seconds ?? 0), 0);
    out.minutesPerAd = byAsset.size ? round1(total / 60 / byAsset.size) : null;
  }
  return out;
}

/** Sample ads, including ones a reviewer has cleared, never count toward the workspace metrics. */
function isSampleAudience(audience: string | null | undefined): boolean {
  return audience === "sample" || audience === "sample_cleared";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
