"use client";

import { ArrowLeft, Ban, ClockAlert, Copy, Keyboard, MailCheck, RefreshCw, ShieldOff, Sparkles, TrendingUp } from "lucide-react";
import { cn } from "cn";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { simulateRevision } from "@/lib/actions/ads";
import type { AdDetail } from "@/lib/data/ads";

import { AskBox } from "./ask-box";
import { AutoRefresh } from "./auto-refresh";
import { CreativeView, type CreativeViewMode } from "./creative-view";
import { DecisionBar, NO_DIALOGS, blockingReason, type DecisionDialogs } from "./decision-bar";
import { APPROVED_STATUSES, formatDateTime, formatDuration, formatUsd, relativeTime, shortSha, stageLabel } from "./format";
import { HiddenTextAlert } from "./hidden-text-alert";
import { History } from "./history";
import { IssuesPanel } from "./issues-panel";
import { MetaChips } from "./meta-chips";
import { ReviewSession } from "./review-session";
import { SeverityWord } from "./severity";
import { AD_SHORTCUTS, ShortcutsDialog, isTypingTarget } from "./shortcuts-dialog";
import { ReasonTags, StatusWord } from "./status";
import { ChangeSummaryLine, WordDiff, summariseChanges } from "./what-changed";

function subscribeMedia(cb: () => void) {
  const mq = window.matchMedia("(min-width: 768px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const useIsDesktop = () =>
  useSyncExternalStore(
    subscribeMedia,
    () => window.matchMedia("(min-width: 768px)").matches,
    () => false,
  );

function tagsFor(detail: AdDetail): string[] {
  const tags: string[] = [];
  if (detail.isSample) tags.push("Sample");
  if (detail.alerts.some((a) => !a.acknowledgedAt)) tags.push("Hidden text");
  if (detail.status === "re_review_due") tags.push("Rates changed");
  if (detail.status === "approved_with_exceptions") tags.push("With exceptions");
  if (detail.changedAfterApproval) tags.push("Changed after approval");
  if (detail.status === "needs_manual_review" && !detail.runs.some((r) => r.versionId === detail.latest.id && r.status === "complete")) tags.push("Not AI-screened");
  if (detail.latest.versionNo > 1 && !APPROVED_STATUSES.has(detail.status)) tags.push(`V${detail.latest.versionNo}`);
  else if (detail.decisions.length === 0 && !detail.checking) tags.push("New");
  return tags;
}

export function AdPage({ detail, userId }: { detail: AdDetail; userId: string }) {
  const isDesktop = useIsDesktop();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formFor, setFormFor] = useState<string | null>(null);
  const [dialogs, setDialogs] = useState<DecisionDialogs>(NO_DIALOGS);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [leftView, setLeftView] = useState<"current" | "changes">("current");
  const [creativeView, setCreativeView] = useState<CreativeViewMode>(detail.latest.content.format === "text" ? "text" : "preview");

  const approved = APPROVED_STATUSES.has(detail.status);
  // Approved ads are frozen (withdraw first); rejected/withdrawn ones can still be re-decided.
  const readOnly = approved;
  const markFindings = useMemo(() => [...detail.findings, ...detail.partialFindings], [detail.findings, detail.partialFindings]);
  const openIssueIds = useMemo(() => detail.findings.filter((f) => f.open || f.disposition?.disposition === "accepted_exception").map((f) => f.id), [detail.findings]);
  const changes = useMemo(() => (detail.previous ? summariseChanges(detail.findings, detail.previousFindings) : null), [detail.findings, detail.previousFindings, detail.previous]);
  const latestRun = detail.latestRun;
  const runFailed = latestRun && (latestRun.status === "failed" || latestRun.status === "declined_budget");

  const blocked = blockingReason(detail);
  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) {
      setLeftView("current");
      setCreativeView("text");
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e)) return;
      switch (e.key) {
        case "?":
          e.preventDefault();
          setShowShortcuts(true);
          break;
        case "a":
          if (readOnly || blocked) return;
          e.preventDefault();
          setDialogs({ ...NO_DIALOGS, approve: true });
          break;
        case "r":
          if (readOnly || detail.checking) return;
          e.preventDefault();
          setDialogs({ ...NO_DIALOGS, request: true });
          break;
        case "x":
          if (readOnly || !selectedId) return;
          if (!detail.findings.some((f) => f.id === selectedId && f.open)) return;
          e.preventDefault();
          setFormFor(selectedId);
          break;
        case "j":
        case "k": {
          if (openIssueIds.length === 0) return;
          e.preventDefault();
          const idx = selectedId ? openIssueIds.indexOf(selectedId) : -1;
          const next = e.key === "j" ? Math.min(openIssueIds.length - 1, idx + 1) : Math.max(0, idx <= 0 ? 0 : idx - 1);
          select(openIssueIds[next]);
          break;
        }
        case "Escape":
          setSelectedId(null);
          setFormFor(null);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readOnly, selectedId, openIssueIds, select, blocked, detail.checking, detail.findings]);

  const left = (
    <div className="min-w-0 p-4 sm:p-5">
      {detail.previous && (
        <Tabs value={leftView} onValueChange={(v) => setLeftView(v as "current" | "changes")} className="mb-3">
          <TabsList variant="line">
            <TabsTrigger value="current">V{detail.latest.versionNo}</TabsTrigger>
            <TabsTrigger value="changes">What changed</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      {leftView === "changes" && detail.previous ? (
        <WordDiff previous={detail.previous} current={detail.latest} />
      ) : (
        <CreativeView
          version={detail.latest}
          findings={markFindings}
          fileUrl={detail.fileUrl}
          selectedId={selectedId}
          onSelect={(id) => select(id)}
          channel={detail.channel}
          view={creativeView}
          onViewChange={setCreativeView}
        />
      )}
    </div>
  );

  const right = (
    <div className="min-w-0 space-y-4 p-4 sm:p-5">
      <HiddenTextAlert alerts={detail.alerts} issueCount={detail.findings.filter((f) => f.open).length} />

      {detail.checking && (
        <div className="flex items-start gap-3 rounded-xl border bg-card p-4" role="status" aria-live="polite">
          <Spinner className="mt-0.5 size-4" />
          <div className="min-w-0">
            <div className="text-sm font-medium">Checking V{detail.latest.versionNo}…</div>
            <p className="text-sm text-muted-foreground">{stageLabel(latestRun?.stage, latestRun?.status)}. Usually under a minute. Issues appear here as soon as it finishes.</p>
          </div>
        </div>
      )}

      {!detail.checking && runFailed && (
        <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
          <ShieldOff aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Not AI-screened</div>
            <p className="text-sm text-muted-foreground">
              {latestRun?.status === "declined_budget" ? "Today's AI budget is used up, so this version was not checked automatically." : "The automatic check did not complete."} Read the ad yourself; an
              approval will be recorded as a manual approval with your rationale.
            </p>
            {detail.partialFindings.length > 0 && (
              <div className="mt-2">
                <div className="text-xs font-medium text-muted-foreground">Found by the product-terms check before it stopped (not part of the decision record):</div>
                <ul className="mt-1 space-y-1">
                  {detail.partialFindings.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => select(selectedId === f.id ? null : f.id)}
                        aria-pressed={selectedId === f.id}
                        className={cn("flex w-full flex-wrap items-center gap-x-2 rounded-md px-1 py-0.5 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none", selectedId === f.id && "bg-muted")}
                      >
                        <SeverityWord severity={f.severity} />
                        {f.quote && <q className="[quotes:'“'_'”']">{f.quote}</q>}
                        {f.explanation && <span className="text-muted-foreground">{f.explanation}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {detail.status === "re_review_due" && (
        <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
          <TrendingUp aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-sm font-medium">Rates changed since approval</div>
            <p className="text-sm text-muted-foreground">
              {typeof detail.reReviewReason?.summary === "string" ? detail.reReviewReason.summary : "A product this ad relies on changed. Re-check the numbers before approving again."}
            </p>
          </div>
        </div>
      )}

      {detail.changedAfterApproval && !approved && detail.approval && (
        <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
          <ClockAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 text-sm">
            <span className="font-medium">Approved V{detail.approval.versionNo}</span>
            <span className="text-muted-foreground">
              {" "}
              {detail.approval.exceptions.length ? `with ${detail.approval.exceptions.length} exception${detail.approval.exceptions.length === 1 ? "" : "s"}` : ""} · V{detail.latest.versionNo} is not approved yet.
            </span>
          </div>
        </div>
      )}

      {detail.status === "changes_requested" && <WaitingForRevision detail={detail} />}

      {approved && detail.approval && <ApprovalRecord detail={detail} />}

      {changes && detail.previous && (
        <section className="rounded-xl border bg-card p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">What changed since V{detail.previous.versionNo}</h2>
            <ChangeSummaryLine summary={changes} />
          </div>
          {changes.fixed.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {changes.fixed.map((f) => (
                <li key={f.id} className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 rounded-full border px-1.5 text-[11px] font-medium text-foreground">Fixed</span>
                  <span className="min-w-0">
                    {f.rule?.title ?? "Issue"}
                    {f.quote ? (
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
          <Button type="button" size="xs" variant="ghost" className="mt-2" onClick={() => setLeftView(leftView === "changes" ? "current" : "changes")}>
            {leftView === "changes" ? `Show V${detail.latest.versionNo}` : "Show the word diff"}
          </Button>
        </section>
      )}

      <section aria-label="Issues">
        <h2 className="mb-2 text-sm font-medium">
          Issues on V{detail.latest.versionNo}
          {detail.findings.length > 0 && <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">{detail.findings.filter((f) => f.open).length} open</span>}
        </h2>
        {detail.checking && detail.findings.length === 0 ? (
          <p className="text-sm text-muted-foreground">Issues will appear here when the check finishes.</p>
        ) : runFailed && detail.findings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This version was not checked by AI, so there is no issue list. Anything the product-terms check found is listed above; read the ad yourself before deciding.
          </p>
        ) : (
          <IssuesPanel
            findings={detail.findings}
            assetId={detail.id}
            versionNo={detail.latest.versionNo}
            format={detail.latest.content.format}
            selectedId={selectedId}
            onSelect={select}
            formFor={formFor}
            onFormFor={setFormFor}
            readOnly={readOnly}
          />
        )}
      </section>

      <AskBox versionId={detail.latest.id} versionNo={detail.latest.versionNo} />
      <History detail={detail} />
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AutoRefresh active={detail.checking} />
      <ReviewSession profileId={detail.profileId} userId={userId} versionId={detail.latest.id} />

      <header className="mb-3 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/ads" className="inline-flex items-center gap-1 rounded-md hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
            <ArrowLeft aria-hidden className="size-3.5" /> Ads
          </Link>
          <span aria-hidden>·</span>
          <StatusWord status={detail.status} checking={detail.checking} />
          <ReasonTags tags={tagsFor(detail)} />
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Keyboard shortcuts" onClick={() => setShowShortcuts(true)} className="ml-auto hidden sm:inline-flex">
            <Keyboard />
          </Button>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-tight tracking-tight">{detail.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-mono">
                V{detail.latest.versionNo} · {shortSha(detail.latest.contentSha256)}
              </span>
              <span>
                {detail.isSample ? (
                  <span className="inline-flex items-center gap-1">
                    <Sparkles aria-hidden className="size-3" /> Sample ad
                  </span>
                ) : (
                  <>From {detail.submitterName || detail.submitterEmail || detail.latest.authorLabel || "a member"}</>
                )}
              </span>
              <span title={formatDateTime(detail.submittedAt ?? detail.createdAt)}>{relativeTime(detail.submittedAt ?? detail.createdAt)}</span>
              {detail.seenIn > 1 && (
                <span className="inline-flex items-center gap-1">
                  <Copy aria-hidden className="size-3" /> Seen in {detail.seenIn} places
                </span>
              )}
            </div>
          </div>
          <MetaChips assetId={detail.id} product={detail.product} channel={detail.channel} inferred={detail.latest.content.meta?.inferred} disabled={readOnly && approved} />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border bg-background">
        {isDesktop ? (
          <ResizablePanelGroup orientation="horizontal" className="min-h-[60vh]">
            <ResizablePanel defaultSize="55%" minSize="32%">
              {left}
            </ResizablePanel>
            <ResizableHandle withHandle aria-label="Resize columns" />
            <ResizablePanel defaultSize="45%" minSize="32%">
              {right}
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className="grid md:grid-cols-[55%_45%]">
            {left}
            <div className="border-t md:border-t-0 md:border-l">{right}</div>
          </div>
        )}
      </div>

      <DecisionBar detail={detail} userId={userId} dialogs={dialogs} onDialogs={setDialogs} />
      <ShortcutsDialog open={showShortcuts} onOpenChange={setShowShortcuts} shortcuts={AD_SHORTCUTS} />
    </div>
  );
}

function WaitingForRevision({ detail }: { detail: AdDetail }) {
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
              Requested by {cr.authorLabel} {relativeTime(cr.createdAt)} · {cr.items.length} item{cr.items.length === 1 ? "" : "s"}
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
              {pending ? <Spinner /> : <RefreshCw data-icon="inline-start" />}
              Simulate revision from Gmail
            </Button>
            <span className="rounded border px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">demo</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApprovalRecord({ detail }: { detail: AdDetail }) {
  const a = detail.approval!;
  return (
    <section aria-label="Approval record" className="rounded-xl border bg-card p-4">
      <div className="text-sm font-medium">
        Approved V{a.versionNo ?? "?"} · <span className="font-mono">{shortSha(a.contentSha256)}</span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">By</dt>
        <dd>
          {a.approverLabel}
          {a.selfApproved ? " (self-approval)" : ""}
        </dd>
        <dt className="text-muted-foreground">When</dt>
        <dd>{formatDateTime(a.createdAt)}</dd>
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
              <li key={i} className="rounded-lg border p-2 text-sm">
                <div className="text-xs text-muted-foreground">
                  {f?.rule?.title ?? "Issue"} {e.reason ? `· ${String(e.reason).replace(/_/g, " ")}` : ""}
                </div>
                <p className={cn("mt-0.5")}>{e.text}</p>
              </li>
            );
          })}
        </ul>
      )}
      {a.rationale && <p className="mt-2 text-sm text-muted-foreground">{a.rationale}</p>}
    </section>
  );
}
