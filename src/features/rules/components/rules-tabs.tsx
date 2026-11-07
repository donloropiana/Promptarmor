"use client";

import { useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type RulesTab = "rules" | "products";

/**
 * Rules | Products. Both panels are rendered by the server; switching is
 * instant and only updates ?tab= in the address bar (native history, no
 * server round trip), so /rules?tab=products deep-links to Products.
 */
export function RulesTabs({
  initialTab,
  rulesCount,
  productsCount,
  rules,
  products,
  rulesActions,
  productsActions,
}: {
  initialTab: RulesTab;
  rulesCount: number;
  productsCount: number;
  rules: ReactNode;
  products: ReactNode;
  /** Shown to the right of the tab list while that tab is active. */
  rulesActions?: ReactNode;
  productsActions?: ReactNode;
}) {
  const searchParams = useSearchParams();
  const fromUrl = searchParams.get("tab");
  const [tab, setTab] = useState<RulesTab>(fromUrl === "products" ? "products" : fromUrl === "rules" ? "rules" : initialTab);

  function change(value: string) {
    const next: RulesTab = value === "products" ? "products" : "rules";
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "rules") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }

  return (
    <Tabs value={tab} onValueChange={change} className="gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList aria-label="Rules sections">
          <TabsTrigger value="rules">
            Rules <span className="text-muted-foreground tabular-nums">{rulesCount}</span>
          </TabsTrigger>
          <TabsTrigger value="products">
            Products <span className="text-muted-foreground tabular-nums">{productsCount}</span>
          </TabsTrigger>
        </TabsList>
        <div className="flex items-center gap-2">{tab === "rules" ? rulesActions : productsActions}</div>
      </div>
      <TabsContent value="rules">{rules}</TabsContent>
      <TabsContent value="products">{products}</TabsContent>
    </Tabs>
  );
}
