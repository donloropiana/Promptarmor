"use client";

import { FlaskConical, Recycle, ShieldOff } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";
import { formatUsd, relativeTime, stageLabel } from "@/features/ads/format";
import type { AdDetail } from "@/features/ads/server/queries/detail";

/**
 * One card that says how this version was checked. Reads the run's mode
 * (analysis_runs.input_metadata.mode) so test runs, replays and reuse are
 * named honestly, and the failure path explains what still ran.
 */
export function CheckStatus({ detail, openCount }: { detail: AdDetail; openCount: number }) {
  const run = detail.latestRun;
  const v = detail.latest.versionNo;
  if (detail.checking) {
    return (
      <div className="rounded-xl border bg-card p-4" role="status" aria-live="polite">
        <div className="flex items-start gap-3">
          <Spinner className="mt-0.5 size-4 motion-reduce:animate-none" />
          <div className="min-w-0">
            <div className="text-sm font-medium">Checking V{v}…</div>
            <p className="text-sm text-muted-foreground">{stageLabel(run?.stage, run?.status)}. Usually under a minute. Issues appear here as soon as it finishes.</p>
          </div>
        </div>
        <div className="progress-line mt-3 motion-reduce:hidden" aria-hidden />
      </div>
    );
  }
  if (!run) return null;

  const fromCheck = detail.findings.filter((f) => f.origin === "ai").length;
  const found = fromCheck > 0 ? `found ${fromCheck} issue${fromCheck === 1 ? "" : "s"}, listed below` : "found nothing";
  // A PDF or image with no text layer that no model read: there were no words to check.
  const noTextFile = (detail.latest.content.format === "pdf" || detail.latest.content.format === "image") && !detail.latest.extractedText.trim() && !run.transcribed;
  const ranLine = noTextFile ? "No text could be read from the file, so the product-terms check had nothing to compare." : `The product-terms check still ran and ${found}.`;

  if (!detail.aiScreened) {
    const why =
      run.status === "declined_budget"
        ? "Today's AI budget is used up, so the AI step was skipped."
        : run.status === "failed"
          ? "The AI step did not complete."
          : "The AI step has not run yet.";
    return (
      <div className="flex items-start gap-3 rounded-xl border bg-card p-4" role="status">
        <ShieldOff aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Not AI-screened</div>
          <p className="text-sm text-muted-foreground">
            {why} {ranLine} Read the ad yourself; approving it is recorded as a manual approval with your written rationale.
          </p>
          {run.error && (
            <details className="mt-1.5 text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">What went wrong</summary>
              <p className="mt-1 break-words">{run.error}</p>
            </details>
          )}
        </div>
      </div>
    );
  }

  if (run.mode === "off") {
    return (
      <div className="flex items-start gap-3 rounded-xl border bg-card p-4" role="status">
        <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">AI check skipped (test mode)</div>
          <p className="text-sm text-muted-foreground">
            {noTextFile
              ? "This server runs with the AI step off, and no text could be read from the file, so nothing was checked. Read it yourself before deciding. No AI spend."
              : `This server runs with the AI step off, so only the product-terms check ran; it ${found}. No AI spend.`}
          </p>
        </div>
      </div>
    );
  }
  if (run.mode === "replay") {
    return (
      <div className="flex items-start gap-3 rounded-xl border bg-card p-4" role="status">
        <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Recorded check · no AI spend</div>
          <p className="text-sm text-muted-foreground">
            A recorded result for this content was replayed instead of calling the model. {openCount} issue{openCount === 1 ? "" : "s"} open.
          </p>
        </div>
      </div>
    );
  }
  if (run.mode === "reused") {
    return (
      <div className="flex items-start gap-3 rounded-xl border bg-card p-4" role="status">
        <Recycle aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Reused from an identical ad · $0</div>
          <p className="text-sm text-muted-foreground">The same content was checked before, so its findings were reused without a new model call.</p>
        </div>
      </div>
    );
  }
  // Live model call: one quiet line with the cost (the history has the details).
  return (
    <p className="text-xs text-muted-foreground" role="status">
      Checked {relativeTime(run.completedAt ?? run.createdAt, detail.now)}
      {run.model ? ` · ${run.model}` : ""} · {formatUsd(run.costUsd, { precise: true })}
    </p>
  );
}
