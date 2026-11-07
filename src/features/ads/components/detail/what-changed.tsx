"use client";

import { diffWords } from "diff";
import { cn } from "cn";
import { useMemo } from "react";

import type { AdFinding, AdVersion } from "@/features/ads/server/queries";

export type RecheckLabel = "Fixed" | "Still there" | "New";

export type ChangeSummary = {
  fixed: AdFinding[];
  /** Prior issues the new check did not raise again although their words are still in the ad. */
  notReflagged: AdFinding[];
  stillThere: AdFinding[];
  fresh: AdFinding[];
};

/**
 * Fixed = a prior issue with no successor whose quoted words are gone from the
 * new version; Not re-flagged = no successor but the words are still there (a
 * failed check, model variance, or a reviewer-added issue); Still there =
 * successor exists; New = no prior.
 */
export function summariseChanges(current: AdFinding[], previous: AdFinding[]): ChangeSummary {
  const succeeded = new Set(current.map((f) => f.priorFindingId).filter((v): v is string => Boolean(v)));
  const unmatched = previous.filter((p) => !succeeded.has(p.id) && (p.open || p.disposition?.disposition === "accepted_exception"));
  const fixed = unmatched.filter((p) => !p.wordsStillThere);
  const notReflagged = unmatched.filter((p) => p.wordsStillThere);
  const stillThere = current.filter((f) => f.priorFindingId || f.recheckStatus === "still_present" || f.recheckStatus === "re_anchored");
  const fresh = current.filter((f) => !f.priorFindingId && f.recheckStatus !== "still_present" && f.recheckStatus !== "re_anchored");
  return { fixed, notReflagged, stillThere, fresh };
}

export function recheckLabel(f: AdFinding): RecheckLabel {
  return f.priorFindingId || f.recheckStatus === "still_present" || f.recheckStatus === "re_anchored" ? "Still there" : "New";
}

export function ChangeSummaryLine({ summary, className }: { summary: ChangeSummary; className?: string }) {
  return (
    <p className={cn("text-sm tabular-nums", className)}>
      <span className="font-medium">{summary.fixed.length} fixed</span>
      <span className="text-muted-foreground"> · </span>
      <span className="font-medium">{summary.stillThere.length} still there</span>
      <span className="text-muted-foreground"> · </span>
      <span className="font-medium">{summary.fresh.length} new</span>
      {summary.notReflagged.length > 0 && (
        <>
          <span className="text-muted-foreground"> · </span>
          <span className="font-medium">{summary.notReflagged.length} not re-flagged</span>
        </>
      )}
    </p>
  );
}

/** Inline word diff of extracted text, previous vs current. Uses <ins>/<del>, never colour alone. */
export function WordDiff({ previous, current }: { previous: AdVersion; current: AdVersion }) {
  const parts = useMemo(() => diffWords(previous.extractedText || "", current.extractedText || ""), [previous.extractedText, current.extractedText]);
  const changed = parts.some((p) => p.added || p.removed);
  return (
    <div className="rounded-xl border bg-card p-4 text-[15px] leading-relaxed sm:p-6">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          V{previous.versionNo} → V{current.versionNo}
        </span>
        <span className="inline-flex items-center gap-1">
          <ins className="rounded-sm bg-foreground/10 px-0.5 no-underline">added</ins>
        </span>
        <span className="inline-flex items-center gap-1">
          <del className="rounded-sm px-0.5 text-muted-foreground">removed</del>
        </span>
      </div>
      {!changed ? (
        <p className="text-sm text-muted-foreground">The text did not change between these versions.</p>
      ) : (
        <p className="whitespace-pre-wrap break-words">
          {parts.map((p, i) =>
            p.added ? (
              <ins key={i} className="rounded-sm bg-foreground/10 px-0.5 no-underline">
                {p.value}
              </ins>
            ) : p.removed ? (
              <del key={i} className="rounded-sm px-0.5 text-muted-foreground">
                {p.value}
              </del>
            ) : (
              <span key={i}>{p.value}</span>
            ),
          )}
        </p>
      )}
    </div>
  );
}
