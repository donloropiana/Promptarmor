"use client";

import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { RuleVersion, WorkspaceRule } from "@/features/rules/server/queries";
import { APPLIES_TO_LABELS } from "@/features/rules/labels";

import { dateTime } from "@/lib/format";

import { Redline, ValueChange } from "@/components/redline";
import { SEVERITY_LABELS } from "@/features/rules/severity";

function productList(v: string[]): string {
  return v.map((p) => APPLIES_TO_LABELS[p] ?? p).join(", ");
}

function VersionEntry({ version, previous, isCurrent }: { version: RuleVersion; previous: RuleVersion | null; isCurrent: boolean }) {
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium tabular-nums">V{version.versionNo}</span>
        {isCurrent ? <Badge variant="secondary">Current</Badge> : null}
        <span className="text-xs text-muted-foreground">
          {dateTime(version.createdAt)}
          {version.authorName ? ` · ${version.authorName}` : ""}
        </span>
      </div>
      <p className="text-sm">
        <span className="text-muted-foreground">Reason: </span>
        {version.reason}
      </p>

      {previous ? (
        <dl className="flex flex-col gap-2 text-sm">
          {previous.title !== version.title ? (
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">Title</dt>
              <dd>
                <ValueChange before={previous.title} after={version.title} />
              </dd>
            </div>
          ) : null}
          {previous.defaultSeverity !== version.defaultSeverity ? (
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">Default severity</dt>
              <dd>
                <ValueChange before={SEVERITY_LABELS[previous.defaultSeverity]} after={SEVERITY_LABELS[version.defaultSeverity]} />
              </dd>
            </div>
          ) : null}
          {productList(previous.appliesTo) !== productList(version.appliesTo) ? (
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">Applies to</dt>
              <dd>
                <ValueChange before={productList(previous.appliesTo)} after={productList(version.appliesTo)} />
              </dd>
            </div>
          ) : null}
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">What it checks (changes vs V{previous.versionNo})</dt>
            <dd className="rounded-md border bg-muted/30 p-3">
              <Redline before={previous.body} after={version.body} />
            </dd>
          </div>
        </dl>
      ) : (
        <div className="flex flex-col gap-0.5 text-sm">
          <p className="text-xs text-muted-foreground">
            {version.title} · {SEVERITY_LABELS[version.defaultSeverity]} · {productList(version.appliesTo)}
          </p>
          <p className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 leading-relaxed">{version.body}</p>
        </div>
      )}
    </li>
  );
}

/** Every version of a rule, newest first, with a word-level redline against the previous one. */
export function RuleHistorySheet({ rule, open, onOpenChange }: { rule: WorkspaceRule; open: boolean; onOpenChange: (open: boolean) => void }) {
  const versions = rule.versions; // newest first
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader className="border-b px-4 py-3 pr-12">
          <SheetTitle className="text-base">History · {rule.code}</SheetTitle>
          <SheetDescription>
            {versions.length === 1 ? "One version so far." : `${versions.length} versions. Removed words are struck through, added words are underlined.`}
          </SheetDescription>
        </SheetHeader>
        <ol className="flex-1 divide-y overflow-y-auto px-4 py-4">
          {versions.map((v, i) => (
            <VersionEntry key={v.id} version={v} previous={versions[i + 1] ?? null} isCurrent={v.id === rule.current.id} />
          ))}
        </ol>
      </SheetContent>
    </Sheet>
  );
}
