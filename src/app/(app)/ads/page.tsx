import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AdsList } from "@/features/ads/components/list/ads-list";
import { EmptyWorkspace, type SampleChip } from "@/features/ads/components/list/empty-workspace";
import { parseTab } from "@/features/ads/format";
import { Banners, MetricsStrip, SummaryLine } from "@/features/ads/components/list/metrics-strip";
import { AdsListSkeleton } from "@/features/ads/components/skeletons";
import { DropBar, WindowDropOverlay } from "@/features/ads/components/list/uploader";
import { getActiveProfile, requireUser } from "@/features/auth/server/dal";
import { getAdsMetrics, getAdsSummary, listAds, nudgeStaleRunsAfter } from "@/features/ads/server/queries";
import { expireLapsedAds } from "@/features/ads/server/lifecycle";
import { SAMPLE_ADS, SAMPLE_CHIPS } from "@/features/ads/samples";

export const metadata: Metadata = { title: "Ads · Marketing Compliance Workbench" };
// Reads the session (see src/app/(app)/layout.tsx), so it blocks on the server by design.
export const instant = false;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function AdsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<AdsListSkeleton />}>
      <AdsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function AdsContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser("/ads");
  const profile = await getActiveProfile();
  if (!profile) redirect("/new-workspace");

  const sp = await searchParams;
  const tab = parseTab(sp.tab);
  // Live ads whose end date passed go back to Needs review before the list is read.
  await expireLapsedAds({ profileId: profile.id }).catch((err: unknown) => console.error("[ads] expiry sweep failed:", (err as Error).message));
  const list = await listAds(profile.id, user.id);
  if (list.anyChecking) nudgeStaleRunsAfter(profile.id);

  if (list.totalAds === 0 && list.triage.length === 0) {
    const samples: SampleChip[] = SAMPLE_CHIPS.map((chip) => {
      const ad = SAMPLE_ADS.find((a) => a.key === chip.key);
      return {
        key: chip.key,
        title: chip.label,
        description: chip.description,
        product: ad?.product ?? "unknown",
        channel: ad?.channel ?? "",
        hiddenText: Boolean(ad?.hidden_text),
      };
    });
    return (
      <>
        <WindowDropOverlay />
        <EmptyWorkspace samples={samples} workspaceName={profile.name} />
      </>
    );
  }

  const [summary, metrics] = await Promise.all([getAdsSummary(profile.id, list), getAdsMetrics(profile.id)]);

  return (
    <div className="flex flex-col gap-4">
      <WindowDropOverlay />
      <h1 className="sr-only">Ads</h1>
      <DropBar />
      <Banners summary={summary} metrics={metrics} />
      <div className="flex flex-col gap-3">
        <SummaryLine summary={summary} />
        <MetricsStrip metrics={metrics} />
      </div>
      <AdsList rows={list.rows} counts={list.counts} tab={tab} anyChecking={list.anyChecking} triage={list.triage} skipped={list.skipped} now={list.now} truncated={list.truncated} />
    </div>
  );
}
