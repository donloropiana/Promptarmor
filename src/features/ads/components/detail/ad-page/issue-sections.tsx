"use client";

import { Button } from "@/components/ui/button";
import type { AdDetail } from "@/features/ads/server/queries";

import { IssuesPanel, issueTitle } from "../issues-panel";
import { ChangeSummaryLine, type ChangeSummary } from "../what-changed";
import type { LeftView, SelectIssue } from "./use-issue-selection";

/**
 * The review column's two issue lists: what changed since the previous
 * version (fixed and not re-flagged issues), and the issues on this one,
 * with what to say when there are none.
 */

export function ChangesCard({
  changes,
  previousVersionNo,
  latestVersionNo,
  leftView,
  onLeftViewChange,
}: {
  changes: ChangeSummary;
  previousVersionNo: number;
  latestVersionNo: number;
  leftView: LeftView;
  onLeftViewChange: (v: LeftView) => void;
}) {
  return (
    <section className="rounded-xl border bg-card p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">What changed since V{previousVersionNo}</h2>
        <ChangeSummaryLine summary={changes} />
      </div>
      {changes.fixed.length + changes.notReflagged.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          {[...changes.fixed.map((f) => ({ f, label: "Fixed" })), ...changes.notReflagged.map((f) => ({ f, label: "Not re-flagged" }))].map(({ f, label }) => (
            <li key={f.id} className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 rounded-full border px-1.5 text-[11px] font-medium text-foreground">{label}</span>
              <span className="min-w-0">
                {issueTitle(f)}
                {f.imageAnchor ? (
                  <> · pinned on the image{f.quote ? `: ${f.quote}` : ""} (look at the new image)</>
                ) : f.quote ? (
                  <>
                    {" "}
                    · <q className="[quotes:'“'_'”']">{f.quote}</q>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Button type="button" size="xs" variant="ghost" className="mt-2" onClick={() => onLeftViewChange(leftView === "changes" ? "current" : "changes")}>
        {leftView === "changes" ? `Show V${latestVersionNo}` : "Show the word diff"}
      </Button>
    </section>
  );
}

export function IssuesSection({
  detail,
  openCount,
  nothingToCheck,
  selectedId,
  onSelect,
  formFor,
  onFormFor,
  readOnly,
}: {
  detail: AdDetail;
  openCount: number;
  /** A PDF or image with no text that nothing read as an image. */
  nothingToCheck: boolean;
  selectedId: string | null;
  onSelect: SelectIssue;
  formFor: string | null;
  onFormFor: (id: string | null) => void;
  readOnly: boolean;
}) {
  const latestRun = detail.latestRun;
  const runFailed = Boolean(latestRun && (latestRun.status === "failed" || latestRun.status === "declined_budget"));
  return (
    <section aria-label="Issues">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="text-sm font-medium">
          Issues on V{detail.latest.versionNo}
          {detail.findings.length > 0 && (
            <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">
              {openCount} open{openCount !== detail.findings.length ? ` of ${detail.findings.length}` : ""}
            </span>
          )}
        </h2>
        {!detail.checking && !detail.aiScreened && detail.findings.length > 0 && (
          <span className="text-xs text-muted-foreground">From the product-terms check only. The AI check did not run.</span>
        )}
      </div>
      {detail.checking && detail.findings.length === 0 ? (
        <p className="text-sm text-muted-foreground">Issues will appear here when the check finishes.</p>
      ) : runFailed && !detail.aiScreened && detail.findings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          The AI check did not run and the product-terms check found nothing, so there is no issue list. Read the ad yourself before deciding; your approval will need a written rationale.
        </p>
      ) : (
        <IssuesPanel
          findings={detail.findings}
          assetId={detail.id}
          versionNo={detail.latest.versionNo}
          format={detail.latest.content.format}
          selectedId={selectedId}
          onSelect={onSelect}
          formFor={formFor}
          onFormFor={onFormFor}
          readOnly={readOnly}
          emptyNote={
            nothingToCheck
              ? "No text could be read from this file and nothing read it as an image, so there was nothing to check. Open the Preview and review it by hand before approving."
              : !detail.aiScreened
                ? "The AI check did not run and the product-terms check found nothing. Read the ad yourself before approving."
                : latestRun?.mode === "off"
                  ? "The product-terms check found nothing; the AI step is off on this server. Read the ad yourself before approving."
                  : undefined
          }
        />
      )}
    </section>
  );
}
