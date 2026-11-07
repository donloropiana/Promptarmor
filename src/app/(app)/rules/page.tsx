import type { Metadata } from "next";
import { Suspense } from "react";

import { AddProductSheet } from "@/features/products/components/add-product-sheet";
import { AddRuleSheet } from "@/features/rules/components/add-rule-sheet";
import { ProductsList, RulesList } from "@/features/rules/components/rules-list";
import { RulesTabs, type RulesTab } from "@/features/rules/components/rules-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { getActiveProfileId } from "@/features/auth/server/dal";
import { getReferenceLibrary, getWorkspaceRules } from "@/features/rules/server/queries";
import { getWorkspaceOffers } from "@/features/products/server/queries";

export const metadata: Metadata = { title: "Rules · Marketing Compliance Workbench" };
// Reads the session (see src/app/(app)/layout.tsx), so it blocks on the server by design.
export const instant = false;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * /rules (Rules tab) and /rules?tab=products (Products tab). Both lists load
 * on the server behind one Suspense boundary; the tab switch is client-side.
 */
export default function RulesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton rows={5} />}>
      <RulesContent searchParams={searchParams} />
    </Suspense>
  );
}

async function RulesContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const initialTab: RulesTab = raw === "products" ? "products" : "rules";

  const profileId = await getActiveProfileId();
  if (!profileId) return null; // the layout gate shows the create-workspace screen

  const [rules, offers, library] = await Promise.all([
    getWorkspaceRules(profileId),
    getWorkspaceOffers(profileId),
    getReferenceLibrary(profileId),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Rules" description="What every ad is checked against: the law, your own rules and your real product terms." />
      <RulesTabs
        initialTab={initialTab}
        rulesCount={rules.length}
        productsCount={offers.length}
        rules={<RulesList rules={rules} />}
        products={<ProductsList offers={offers} />}
        rulesActions={<AddRuleSheet profileId={profileId} library={library} />}
        productsActions={<AddProductSheet profileId={profileId} />}
      />
    </div>
  );
}
