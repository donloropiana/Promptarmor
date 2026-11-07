import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { AdPage } from "@/features/ads/components/detail/ad-page";
import { AdPageSkeleton } from "@/features/ads/components/skeletons";
import { getActiveProfile, requireUser } from "@/features/auth/server/dal";
import { getAdDetail, nudgeStaleRunsAfter } from "@/features/ads/server/queries";

export const metadata: Metadata = { title: "Ad · Marketing Compliance Workbench" };
// Reads the session (see src/app/(app)/layout.tsx), so it blocks on the server by design.
export const instant = false;

type Params = Promise<{ id: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AdRoute({ params }: { params: Params }) {
  return (
    <Suspense fallback={<AdPageSkeleton />}>
      <AdContent params={params} />
    </Suspense>
  );
}

async function AdContent({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requireUser(`/ads/${id}`);
  const profile = await getActiveProfile();
  if (!profile) redirect("/new-workspace");

  const detail = await getAdDetail(id, profile.id, user.id);
  if (!detail) notFound();
  if (detail.checking) nudgeStaleRunsAfter(profile.id);

  return <AdPage detail={detail} userId={user.id} />;
}
