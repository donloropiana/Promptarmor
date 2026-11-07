"use client";

import { ScrollTextIcon } from "lucide-react";
import { useState } from "react";

import { dateTime, timeAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { SyncRunRow } from "@/features/connections/server/queries";

const KIND_LABELS: Record<string, string> = {
  initial: "First sync",
  incremental: "Automatic",
  gap_rescan: "Catch-up",
  manual: "Sync now",
};

function n(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function describe(run: SyncRunRow): string {
  if (run.error) return run.error;
  if (!run.finishedAt) return "Still running";
  const s = run.stats;
  const parts: string[] = [];
  const added = n(s.new);
  const modified = n(s.modified);
  const dup = n(s.duplicates);
  const skipped = n(s.skipped);
  const errors = n(s.errors);
  if (added) parts.push(`${added} new`);
  if (modified) parts.push(`${modified} changed`);
  if (dup) parts.push(`${dup} ${dup === 1 ? "duplicate" : "duplicates"}`);
  if (skipped) parts.push(`${skipped} skipped (not ads)`);
  if (errors) parts.push(`${errors} ${errors === 1 ? "error" : "errors"}`);
  return parts.length ? parts.join(" · ") : "Nothing new";
}

function duration(run: SyncRunRow): string | null {
  if (!run.finishedAt) return null;
  const ms = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.round(s / 60)} min`;
}

/** "Sync log" drawer: the last sync runs, optionally for one account. */
export function SyncLogSheet({ runs, connectionId, label = "Sync log" }: { runs: SyncRunRow[]; connectionId?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const list = connectionId ? runs.filter((r) => r.connectionId === connectionId) : runs;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <ScrollTextIcon />
        {label}
      </Button>
      <SheetContent className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-b px-4 py-3 pr-12">
          <SheetTitle className="text-base">Sync log</SheetTitle>
          <SheetDescription>
            {list.length === 0 ? "No syncs yet." : `Last ${list.length} ${list.length === 1 ? "sync" : "syncs"}, newest first.`}
          </SheetDescription>
        </SheetHeader>
        <ol className="flex-1 divide-y overflow-y-auto">
          {list.map((run) => {
            const d = duration(run);
            return (
              <li key={run.id} className="flex flex-col gap-0.5 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                  <span className="text-sm font-medium">
                    {run.providerLabel}
                    {run.accountEmail ? <span className="font-normal text-muted-foreground"> · {run.accountEmail}</span> : null}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums" title={dateTime(run.startedAt)} suppressHydrationWarning>
                    {timeAgo(run.startedAt)}
                  </span>
                </div>
                <p className={run.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{describe(run)}</p>
                <p className="text-xs text-muted-foreground">
                  {KIND_LABELS[run.kind] ?? run.kind}
                  {d ? ` · ${d}` : ""}
                </p>
              </li>
            );
          })}
        </ol>
      </SheetContent>
    </Sheet>
  );
}
