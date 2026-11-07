import { BookOpenCheckIcon, PackageIcon } from "lucide-react";

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { WorkspaceOffer, WorkspaceRule } from "@/features/rules/server/queries";

import { ProductCard } from "@/features/products/components/product-card";
import { RuleCard } from "./rule-card";

/** The Rules tab body: a quiet list of rule cards, or an honest empty state. */
export function RulesList({ rules }: { rules: WorkspaceRule[] }) {
  if (rules.length === 0) {
    return (
      <Empty className="border py-12">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BookOpenCheckIcon />
          </EmptyMedia>
          <EmptyTitle>No rules yet</EmptyTitle>
          <EmptyDescription>
            Starter rules are added when a workspace is created. If they have not appeared, reload the page; otherwise add a rule of your own.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  const on = rules.filter((r) => r.active).length;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground tabular-nums">
        {on} of {rules.length} on · checks use the current version of every rule that is on
      </p>
      <ul className="flex flex-col gap-2">
        {rules.map((r) => (
          <RuleCard key={r.id} rule={r} />
        ))}
      </ul>
    </div>
  );
}

/** The Products tab body: product term sheets, or an honest empty state. */
export function ProductsList({ offers }: { offers: WorkspaceOffer[] }) {
  if (offers.length === 0) {
    return (
      <Empty className="border py-12">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PackageIcon />
          </EmptyMedia>
          <EmptyTitle>No products yet</EmptyTitle>
          <EmptyDescription>
            Products are the real terms ads are checked against: rate floors, intro periods, fees. Add one to catch rates nobody can actually get.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Every check records which version of each product it used. Changing terms sends affected approved ads back to Needs review.
      </p>
      <ul className="flex flex-col gap-2">
        {offers.map((o) => (
          <ProductCard key={o.id} offer={o} />
        ))}
      </ul>
    </div>
  );
}
