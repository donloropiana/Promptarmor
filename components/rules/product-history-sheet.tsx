"use client";

import { dateTime, shortDate } from "@/components/shell/format";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { OfferVersion, WorkspaceOffer } from "@/lib/data/rules";

import { Redline, ValueChange } from "./redline";
import { TERM_FIELDS, formatTerm } from "./term-fields";

function labelFor(key: string): string {
  return TERM_FIELDS.find((f) => f.key === key)?.label ?? key.replace(/_/g, " ");
}
function fmt(key: string, v: unknown): string {
  const f = TERM_FIELDS.find((x) => x.key === key);
  return formatTerm(f?.kind ?? "text", v);
}

function VersionEntry({ version, previous, isCurrent }: { version: OfferVersion; previous: OfferVersion | null; isCurrent: boolean }) {
  const keys = [...new Set([...Object.keys(previous?.terms ?? {}), ...Object.keys(version.terms)])].filter(
    (k) => k !== "summary" && k !== "notes",
  );
  const changedKeys = previous ? keys.filter((k) => JSON.stringify(previous.terms[k]) !== JSON.stringify(version.terms[k])) : keys;
  const summaryBefore = typeof previous?.terms.summary === "string" ? previous.terms.summary : "";
  const summaryAfter = typeof version.terms.summary === "string" ? version.terms.summary : "";

  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium tabular-nums">V{version.versionNo}</span>
        {isCurrent ? <Badge variant="secondary">Current</Badge> : null}
        <span className="text-xs text-muted-foreground">
          {dateTime(version.createdAt)}
          {version.authorName ? ` · ${version.authorName}` : ""} · effective {shortDate(version.effectiveFrom)}
        </span>
      </div>
      <p className="text-sm">
        <span className="text-muted-foreground">Reason: </span>
        {version.reason}
      </p>
      {previous && summaryBefore !== summaryAfter ? (
        <div className="flex flex-col gap-0.5">
          <p className="text-xs text-muted-foreground">Summary</p>
          <div className="rounded-md border bg-muted/30 p-3">
            <Redline before={summaryBefore} after={summaryAfter} />
          </div>
        </div>
      ) : !previous && summaryAfter ? (
        <p className="text-sm">{summaryAfter}</p>
      ) : null}
      {changedKeys.length > 0 ? (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
          {changedKeys.map((k) => (
            <div key={k} className="flex min-w-0 flex-col">
              <dt className="truncate text-xs text-muted-foreground">{labelFor(k)}</dt>
              <dd className="tabular-nums">
                {previous ? <ValueChange before={fmt(k, previous.terms[k])} after={fmt(k, version.terms[k])} /> : fmt(k, version.terms[k])}
              </dd>
            </div>
          ))}
        </dl>
      ) : previous ? (
        <p className="text-xs text-muted-foreground">Only the summary or notes changed.</p>
      ) : null}
    </li>
  );
}

/** Every terms version of a product, newest first, with field-level changes. */
export function ProductHistorySheet({ offer, open, onOpenChange }: { offer: WorkspaceOffer; open: boolean; onOpenChange: (open: boolean) => void }) {
  const versions = offer.versions; // newest first
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader className="border-b px-4 py-3 pr-12">
          <SheetTitle className="text-base">
            History · {offer.code} {offer.name}
          </SheetTitle>
          <SheetDescription>
            {versions.length === 1 ? "One version so far." : `${versions.length} versions. Each check records which version it used.`}
          </SheetDescription>
        </SheetHeader>
        <ol className="flex-1 divide-y overflow-y-auto px-4 py-4">
          {versions.map((v, i) => (
            <VersionEntry key={v.id} version={v} previous={versions[i + 1] ?? null} isCurrent={v.id === offer.current.id} />
          ))}
        </ol>
      </SheetContent>
    </Sheet>
  );
}
