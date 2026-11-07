"use client";

import { Ban, CalendarX, ClockAlert, MailCheck, RefreshCw, TrendingUp } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { LocalDateTime } from "@/features/ads/components/local-time";
import { LongText } from "@/features/ads/components/long-text";
import { formatDuration, formatUsd, relativeTime, shortSha } from "@/features/ads/format";
import { simulateRevision } from "@/features/ads/server/actions";
import type { AdDecision, AdDetail } from "@/features/ads/server/queries";

/**
 * The review column's cards for where the ad stands in its review: the
 * approval record, a re-review that is due, a version that changed after
 * approval, and changes requested that wait for a revision.
 */

export function ApprovalRecord({ detail }: { detail: AdDetail }) {
  const a = detail.approval!;
  return (
    <section aria-label="Approval record" className="rounded-xl border bg-card p-4">
      <div className="text-sm font-medium">
        Approved V{a.versionNo ?? "?"} · <span className="font-mono">{shortSha(a.contentSha256)}</span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">By</dt>
        <dd className="min-w-0 [overflow-wrap:anywhere]">
          {a.approverLabel}
          {a.selfApproved ? " (self-approval)" : ""}
        </dd>
        <dt className="text-muted-foreground">When</dt>
        <dd>
          <LocalDateTime iso={a.createdAt} />
        </dd>
        <dt className="text-muted-foreground">Exceptions</dt>
        <dd>{a.exceptions.length === 0 ? "None" : a.exceptions.length}</dd>
        <dt className="text-muted-foreground">Reviewer time</dt>
        <dd>{formatDuration(detail.reviewSeconds)}</dd>
        <dt className="text-muted-foreground">AI cost</dt>
        <dd>{formatUsd(detail.aiCostUsd, { precise: true })}</dd>
        {a.manualOnly && (
          <>
            <dt className="text-muted-foreground">AI screened</dt>
            <dd className="inline-flex items-center gap-1">
              <Ban aria-hidden className="size-3.5" /> No, manual approval
            </dd>
          </>
        )}
      </dl>
      {a.exceptions.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {a.exceptions.map((e, i) => {
            const f = detail.findings.find((x) => x.id === e.finding_id);
            return (
              <li key={i} className="min-w-0 rounded-lg border p-2 text-sm">
                <div className="text-xs text-muted-foreground">
                  {f?.rule?.title ?? "Issue"} {e.reason ? `· ${String(e.reason).replace(/_/g, " ")}` : ""}
                </div>
                <LongText text={e.text ?? ""} className="mt-0.5" />
              </li>
            );
          })}
        </ul>
      )}
      {a.rationale && <LongText text={a.rationale} className="mt-2 text-sm text-muted-foreground" />}
    </section>
  );
}

/** Shown on a re_review_due ad: the approval expired, or a product it relies on changed. */
export function ReReviewNotice({ reason }: { reason: AdDetail["reReviewReason"] }) {
  return reason?.kind === "expired" ? (
    <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
      <CalendarX aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-sm font-medium">Approval expired</div>
        <p className="text-sm text-muted-foreground">
          {typeof reason?.summary === "string" ? reason.summary : "The end date set when this ad went live has passed. Decide again before it runs further."}
        </p>
      </div>
    </div>
  ) : (
    <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
      <TrendingUp aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-sm font-medium">Rates changed since approval</div>
        <p className="text-sm text-muted-foreground">
          {typeof reason?.summary === "string" ? reason.summary : "A product this ad relies on changed. Re-check the numbers before approving again."}
        </p>
      </div>
    </div>
  );
}

/** An earlier version was approved; the latest one is not (yet). */
export function ChangedAfterApprovalNotice({ approval, latestVersionNo }: { approval: AdDecision; latestVersionNo: number }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
      <ClockAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 text-sm">
        <span className="font-medium">Approved V{approval.versionNo}</span>
        <span className="text-muted-foreground">
          {" "}
          {approval.exceptions.length ? `with ${approval.exceptions.length} exception${approval.exceptions.length === 1 ? "" : "s"}` : ""} · V{latestVersionNo} is not approved yet.
        </span>
      </div>
    </div>
  );
}

export function WaitingForRevision({ detail }: { detail: AdDetail }) {
  const [pending, start] = useTransition();
  const cr = detail.openChangeRequest;
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <MailCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Waiting for a revision</div>
          <p className="text-sm text-muted-foreground">It appears here automatically when the submitter replies or updates the file.</p>
          {cr && (
            <p className="mt-1 text-xs text-muted-foreground">
              Requested by {cr.authorLabel} {relativeTime(cr.createdAt, detail.now)} · {cr.items.length} item{cr.items.length === 1 ? "" : "s"}
              {cr.dueDate ? ` · due ${cr.dueDate}` : ""}
            </p>
          )}
          {cr?.messageText && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-muted-foreground">Note sent</summary>
              <pre className="mt-1 whitespace-pre-wrap rounded-lg border bg-muted/40 p-2.5 font-sans text-xs">{cr.messageText}</pre>
            </details>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await simulateRevision(detail.id);
                  if (!res.ok) toast.error(res.error);
                  else toast.success(`V${res.data.versionNo} arrived. Checking it now.`);
                })
              }
            >
              {pending ? <Spinner className="motion-reduce:animate-none" /> : <RefreshCw data-icon="inline-start" />}
              Simulate revision from Gmail
            </Button>
            <span className="rounded border px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">demo</span>
          </div>
        </div>
      </div>
    </div>
  );
}
