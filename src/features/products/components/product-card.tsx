"use client";

import { HistoryIcon, PencilIcon } from "lucide-react";
import { useState } from "react";

import { shortDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { WorkspaceOffer } from "@/features/rules/server/queries";
import { PRODUCT_LABELS } from "@/features/rules/labels";
import { cn } from "@/lib/utils";

import { ProductEditSheet } from "./product-edit-sheet";
import { ProductHistorySheet } from "./product-history-sheet";
import { formatTerm, otherTerms, presentTermFields } from "@/features/products/term-fields";

/** One product: code + name, summary, the term sheet, version, Edit terms, History. */
export function ProductCard({ offer }: { offer: WorkspaceOffer }) {
  const [editOpen, setEditOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const v = offer.current;
  const summary = typeof v.terms.summary === "string" ? v.terms.summary : null;
  const example = typeof v.terms.representative_example === "string" ? v.terms.representative_example : null;
  const notes = typeof v.terms.notes === "string" ? v.terms.notes : null;
  const fields = presentTermFields(v.terms);
  const other = otherTerms(v.terms);

  return (
    <li className={cn("flex flex-col gap-3 rounded-lg border bg-card p-4", !offer.active && "opacity-70")} data-active={offer.active}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-medium leading-snug">
              <span className="tabular-nums">{offer.code}</span> · {offer.name}
            </h3>
            {!offer.active ? <Badge variant="outline">Archived</Badge> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {PRODUCT_LABELS[offer.product] ?? offer.product} · <span className="tabular-nums">V{v.versionNo}</span> · effective {shortDate(v.effectiveFrom)}
          </p>
        </div>
      </div>

      {summary ? <p className="text-sm">{summary}</p> : null}

      {fields.length > 0 || other.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-3">
          {fields.map((f) => (
            <div key={f.key} className="flex min-w-0 flex-col">
              <dt className="truncate text-xs text-muted-foreground">{f.label}</dt>
              <dd className="tabular-nums">{formatTerm(f.kind, v.terms[f.key])}</dd>
            </div>
          ))}
          {other.map((o) => (
            <div key={o.key} className="flex min-w-0 flex-col">
              <dt className="truncate text-xs text-muted-foreground capitalize">{o.key}</dt>
              <dd className="truncate tabular-nums" title={o.value}>
                {o.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">No terms recorded yet.</p>
      )}

      {example ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Example: </span>
          {example}
        </p>
      ) : null}
      {notes ? <p className="text-xs text-muted-foreground">{notes}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
          <PencilIcon />
          Edit terms
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)}>
          <HistoryIcon />
          History
          <span className="text-muted-foreground tabular-nums">({offer.versions.length})</span>
        </Button>
      </div>

      <ProductEditSheet offer={offer} open={editOpen} onOpenChange={setEditOpen} />
      <ProductHistorySheet offer={offer} open={historyOpen} onOpenChange={setHistoryOpen} />
    </li>
  );
}
