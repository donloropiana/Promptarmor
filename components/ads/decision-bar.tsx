"use client";

import { Archive, ArchiveRestore, ArrowRight, Check, Copy, MailCheck, MessageSquareWarning, MoreHorizontal, Undo2, XCircle } from "lucide-react";
import { cn } from "cn";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { archiveAd, decide, simulateRevision, unarchiveAd, withdrawApproval, type DecideResult } from "@/lib/actions/ads";
import type { AdDetail, AdFinding } from "@/lib/data/ads";

import { APPROVED_STATUSES, ARCHIVABLE_STATUSES, formatDate, severityLabel, shortSha } from "./format";
import { issueTitle } from "./issues-panel";
import { SeverityWord } from "./severity";

const EXCEPTION_REASONS = [
  { value: "business_decision", label: "Business decision: the risk is accepted" },
  { value: "disclosed_elsewhere", label: "Disclosed elsewhere in the customer journey" },
  { value: "not_applicable", label: "Rule does not apply to this product or channel" },
  { value: "legal_reviewed", label: "Reviewed and cleared by legal" },
] as const;

export type DecisionDialogs = { approve: boolean; request: boolean; reject: boolean; withdraw: boolean; archive: boolean };
export const NO_DIALOGS: DecisionDialogs = { approve: false, request: false, reject: false, withdraw: false, archive: false };

/** Why a decision cannot be made right now, or null. */
export function blockingReason(detail: AdDetail): string | null {
  if (detail.alerts.some((a) => !a.acknowledgedAt)) return "Acknowledge the hidden-text alert first.";
  if (detail.checking) return "Wait for the check to finish.";
  const finished = detail.runs.some((r) => r.versionId === detail.latest.id && ["complete", "failed", "declined_budget"].includes(r.status));
  if (!finished) return "This version has not been checked yet.";
  return null;
}

/** Sticky decision bar with the Approve / Request changes sheets and the overflow menu. Dialog state is owned by the parent (keyboard shortcuts). */
export function DecisionBar({
  detail,
  userId,
  dialogs,
  onDialogs,
}: {
  detail: AdDetail;
  userId: string;
  dialogs: DecisionDialogs;
  onDialogs: (next: DecisionDialogs) => void;
}) {
  const router = useRouter();
  const [simulating, startSimulate] = useTransition();
  const [unarchiving, startUnarchive] = useTransition();
  const cancelAdvance = useRef(false);

  const approved = APPROVED_STATUSES.has(detail.status);
  const archived = Boolean(detail.archivedAt);
  const canArchive = !archived && ARCHIVABLE_STATUSES.has(detail.status);
  const blocked = blockingReason(detail);
  const versionNo = detail.latest.versionNo;
  const set = (patch: Partial<DecisionDialogs>) => onDialogs({ ...NO_DIALOGS, ...patch });

  const afterDecision = (label: string, result: DecideResult, opts: { advance?: boolean } = {}) => {
    cancelAdvance.current = false;
    const next = result.nextAdId;
    // Request changes keeps you here: the ad now waits for its revision and
    // the page shows that state. Approvals and rejections move on.
    const advance = opts.advance ?? true;
    const id = toast.custom(
      (t) => (
        <div
          onMouseEnter={() => {
            cancelAdvance.current = true;
          }}
          onClick={() => {
            cancelAdvance.current = true;
          }}
          className="flex w-full items-center gap-3 rounded-lg border bg-popover px-3 py-2.5 text-sm text-popover-foreground shadow-lg"
        >
          <Check aria-hidden className="size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">{label}</div>
            <div className="text-xs text-muted-foreground">{next ? (advance ? "Opening the next ad… hover to stay here." : "This ad now waits for a revision.") : "Nothing else needs review."}</div>
          </div>
          {next ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                toast.dismiss(t);
                router.push(`/ads/${next}`);
              }}
            >
              Open next
              <ArrowRight data-icon="inline-end" />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                toast.dismiss(t);
                router.push("/ads");
              }}
            >
              Back to ads
            </Button>
          )}
        </div>
      ),
      { duration: 6000 },
    );
    if (next && advance) {
      setTimeout(() => {
        if (cancelAdvance.current) return;
        toast.dismiss(id);
        router.push(`/ads/${next}`);
      }, 1500);
    }
  };

  return (
    <div data-decision-bar className="sticky bottom-0 z-10 -mx-4 mt-3 border-t bg-background/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:mx-0 md:rounded-xl md:border md:px-3">
      <div className="flex items-center gap-2">
        {archived ? (
          <div className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
            <span className="font-medium">Archived {formatDate(detail.archivedAt)}</span>
            {detail.archiveReason && <span className="text-muted-foreground"> · {detail.archiveReason}</span>}
          </div>
        ) : approved ? (
          <div className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
            <span className="font-medium">Approved V{detail.approval?.versionNo ?? versionNo}</span>
            {detail.approval && (
              <span className="text-muted-foreground">
                {" "}
                · {detail.approval.approverLabel} ·{" "}
                {detail.approval.exceptions.length ? `${detail.approval.exceptions.length} exception${detail.approval.exceptions.length === 1 ? "" : "s"}` : "no exceptions"}
              </span>
            )}
          </div>
        ) : (
          <>
            <Button type="button" onClick={() => set({ approve: true })} disabled={Boolean(blocked)} title={blocked ?? undefined} className="min-w-0">
              <Check data-icon="inline-start" />
              <span className="truncate">Approve V{versionNo}</span>
              <kbd className="ml-1 hidden rounded border border-primary-foreground/30 px-1 font-mono text-[10px] sm:inline">A</kbd>
            </Button>
            <Button type="button" variant="outline" onClick={() => set({ request: true })} disabled={detail.checking} className="min-w-0">
              <MessageSquareWarning data-icon="inline-start" />
              <span className="truncate">Request changes</span>
              <kbd className="ml-1 hidden rounded border px-1 font-mono text-[10px] text-muted-foreground sm:inline">R</kbd>
            </Button>
            {blocked && <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground md:inline">{blocked}</span>}
          </>
        )}
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!approved && !archived && (
                <DropdownMenuItem onSelect={() => set({ reject: true })} disabled={detail.checking}>
                  <XCircle /> Reject…
                </DropdownMenuItem>
              )}
              {approved && !archived && (
                <DropdownMenuItem onSelect={() => set({ withdraw: true })}>
                  <Undo2 /> Withdraw approval…
                </DropdownMenuItem>
              )}
              {canArchive && (
                <DropdownMenuItem onSelect={() => set({ archive: true })}>
                  <Archive /> Archive…
                </DropdownMenuItem>
              )}
              {archived && (
                <DropdownMenuItem
                  disabled={unarchiving}
                  onSelect={() =>
                    startUnarchive(async () => {
                      const res = await unarchiveAd(detail.id);
                      if (!res.ok) toast.error(res.error);
                      else toast.success("Back from the archive");
                    })
                  }
                >
                  <ArchiveRestore /> Unarchive
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={simulating || detail.checking}
                onSelect={() =>
                  startSimulate(async () => {
                    const res = await simulateRevision(detail.id);
                    if (!res.ok) toast.error(res.error);
                    else toast.success(`V${res.data.versionNo} arrived. Checking it now.`);
                  })
                }
              >
                <MailCheck /> Simulate revision from Gmail <span className="ml-1 rounded border px-1 text-[10px] text-muted-foreground">demo</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Sheet open={dialogs.approve} onOpenChange={(o) => set({ approve: o })}>
        <SheetContent className="w-full data-[side=right]:sm:max-w-lg" aria-describedby="approve-desc">
          {dialogs.approve && <ApproveForm detail={detail} userId={userId} onClose={() => set({})} onDone={afterDecision} />}
        </SheetContent>
      </Sheet>
      <Sheet open={dialogs.request} onOpenChange={(o) => set({ request: o })}>
        <SheetContent className="w-full data-[side=right]:sm:max-w-lg" aria-describedby="request-desc">
          {dialogs.request && <RequestChangesForm detail={detail} onClose={() => set({})} onDone={afterDecision} />}
        </SheetContent>
      </Sheet>
      <Dialog open={dialogs.reject} onOpenChange={(o) => set({ reject: o })}>
        <DialogContent>{dialogs.reject && <RejectForm detail={detail} onClose={() => set({})} onDone={afterDecision} />}</DialogContent>
      </Dialog>
      <Dialog open={dialogs.withdraw} onOpenChange={(o) => set({ withdraw: o })}>
        <DialogContent>{dialogs.withdraw && <WithdrawForm assetId={detail.id} onClose={() => set({})} />}</DialogContent>
      </Dialog>
      <Dialog open={dialogs.archive} onOpenChange={(o) => set({ archive: o })}>
        <DialogContent>{dialogs.archive && <ArchiveForm detail={detail} onClose={() => set({})} />}</DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Approve
// ---------------------------------------------------------------------------

function ApproveForm({ detail, userId, onClose, onDone }: { detail: AdDetail; userId: string; onClose: () => void; onDone: (label: string, r: DecideResult) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [attested, setAttested] = useState(false);
  const [rationale, setRationale] = useState("");
  // Only decision-grade issues (reviewer-added, or from a complete check) can
  // be accepted as exceptions; the database ignores the rest.
  const needsException = useMemo(
    () => detail.findings.filter((f) => f.decisionGrade && (f.severity === "critical" || f.severity === "major") && (f.open || f.disposition?.disposition === "accepted_exception")),
    [detail.findings],
  );
  const stillOpenUnscreened = useMemo(() => detail.findings.filter((f) => !f.decisionGrade && f.open), [detail.findings]);
  const [entries, setEntries] = useState<Record<string, { reason: string; text: string }>>(() =>
    Object.fromEntries(
      needsException.map((f) => [
        f.id,
        {
          reason: f.disposition?.disposition === "accepted_exception" ? (f.disposition.reason ?? "business_decision") : "",
          text: f.disposition?.disposition === "accepted_exception" ? (f.disposition.note ?? "") : "",
        },
      ]),
    ),
  );

  const isAuthor = detail.latest.authorId === userId;
  const noCompleteRun = !detail.aiScreened;
  const withExceptions = needsException.length > 0;
  const selfBlocked = withExceptions && isAuthor && detail.memberCount > 1;
  const rationaleMin = noCompleteRun ? 40 : isAuthor ? 20 : 0;
  const rationaleOk = rationale.trim().length >= rationaleMin;
  const entriesOk = needsException.every((f) => (entries[f.id]?.reason ?? "") !== "" && (entries[f.id]?.text ?? "").trim().length >= 40);
  const canSubmit = attested && rationaleOk && entriesOk && !selfBlocked && !pending;
  const sha = shortSha(detail.latest.contentSha256);
  const decisionLabel = withExceptions ? "Approve with exceptions" : "Approve";

  return (
    <>
      <SheetHeader className="pb-0">
        <SheetTitle>
          Approve V{detail.latest.versionNo} · <span className="font-mono text-base">{sha}</span>
        </SheetTitle>
        <SheetDescription id="approve-desc">
          {withExceptions
            ? `${needsException.length} ${needsException.length === 1 ? "issue is" : "issues are"} still open. Each needs a written reason; together they become the recorded exceptions.`
            : noCompleteRun
              ? "The AI check did not run for this version, so this is a manual approval. It records the exact version you have in front of you."
              : "No Critical or Major issues are open. This records the exact version you have in front of you."}
        </SheetDescription>
      </SheetHeader>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          setError(null);
          start(async () => {
            const res = await decide({
              versionId: detail.latest.id,
              decision: withExceptions ? "approved_with_exceptions" : "approved",
              exceptions: needsException.map((f) => ({ finding_id: f.id, reason: entries[f.id].reason, text: entries[f.id].text.trim() })),
              rationale: rationale.trim() || undefined,
              attested: true,
            });
            if (!res.ok) {
              setError(res.error);
              return;
            }
            onClose();
            onDone(`Approved V${detail.latest.versionNo}${withExceptions ? " with exceptions" : ""}`, res.data);
          });
        }}
      >
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {needsException.map((f) => (
            <fieldset key={f.id} className="space-y-2 rounded-lg border p-3">
              <legend className="px-1">
                <SeverityWord severity={f.severity} />
              </legend>
              <div className="text-sm font-medium [overflow-wrap:anywhere]">{issueTitle(f)}</div>
              {f.quote && (
                <q className="block text-sm text-muted-foreground [overflow-wrap:anywhere] [quotes:'“'_'”']" dir="auto">
                  {f.quote}
                </q>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor={`exc-reason-${f.id}`}>Why approve anyway?</Label>
                <Select value={entries[f.id]?.reason ?? ""} onValueChange={(v) => setEntries((s) => ({ ...s, [f.id]: { ...(s[f.id] ?? { text: "" }), reason: v } }))}>
                  <SelectTrigger id={`exc-reason-${f.id}`} className="w-full">
                    <SelectValue placeholder="Pick a reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXCEPTION_REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`exc-text-${f.id}`}>Written reason (at least 40 characters)</Label>
                <Textarea
                  id={`exc-text-${f.id}`}
                  value={entries[f.id]?.text ?? ""}
                  onChange={(e) => setEntries((s) => ({ ...s, [f.id]: { ...(s[f.id] ?? { reason: "" }), text: e.target.value } }))}
                  className="min-h-20"
                  placeholder="What you checked, who agreed, and why the ad can run as written."
                />
                <div className={cn("text-xs tabular-nums", (entries[f.id]?.text ?? "").trim().length < 40 ? "text-destructive" : "text-muted-foreground")}>
                  {(entries[f.id]?.text ?? "").trim().length} / 40
                </div>
              </div>
            </fieldset>
          ))}

          {selfBlocked && (
            <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm">
              You wrote this version. With open issues, another member of the workspace has to approve it.
            </p>
          )}

          {stillOpenUnscreened.length > 0 && (
            <div className="rounded-lg border p-3">
              <div className="text-sm font-medium">
                {stillOpenUnscreened.length} open issue{stillOpenUnscreened.length === 1 ? "" : "s"} from the product-terms check
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">Approving leaves {stillOpenUnscreened.length === 1 ? "it" : "them"} as written. Say why in the rationale, or mark each one Not a problem first.</p>
              <ul className="mt-2 space-y-1">
                {stillOpenUnscreened.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-x-2 text-sm">
                    <SeverityWord severity={f.severity} />
                    <span className="min-w-0">{issueTitle(f)}</span>
                    {f.quote && (
                      <q className="min-w-0 max-w-full text-muted-foreground [overflow-wrap:anywhere] [quotes:'“'_'”']" dir="auto">
                        {f.quote}
                      </q>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="approve-rationale">Rationale{rationaleMin ? ` (required, at least ${rationaleMin} characters)` : " (optional)"}</Label>
            {noCompleteRun && (
              <p className="text-xs text-muted-foreground">The AI check did not run for this version, so this is a manual approval and is recorded as &quot;Not AI-screened&quot;.</p>
            )}
            {isAuthor && !noCompleteRun && <p className="text-xs text-muted-foreground">You wrote this version, so a short rationale is required.</p>}
            <Textarea id="approve-rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} className="min-h-16" placeholder="Anything the audit record should say." />
            {rationaleMin > 0 && (
              <div className={cn("text-xs tabular-nums", rationaleOk ? "text-muted-foreground" : "text-destructive")}>
                {rationale.trim().length} / {rationaleMin}
              </div>
            )}
          </div>

          <label className="flex items-start gap-2.5 rounded-lg border p-3 text-sm">
            <Checkbox checked={attested} onCheckedChange={(v) => setAttested(v === true)} className="mt-0.5" aria-describedby="attest-desc" />
            <span id="attest-desc">
              I have read{" "}
              <strong>
                V{detail.latest.versionNo} · {sha}
              </strong>{" "}
              in full and approve this exact version for use.
            </span>
          </label>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <SheetFooter className="flex-row justify-end gap-2 border-t">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {pending ? <Spinner className="motion-reduce:animate-none" /> : <Check data-icon="inline-start" />}
            {decisionLabel} V{detail.latest.versionNo}
          </Button>
        </SheetFooter>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// Request changes
// ---------------------------------------------------------------------------

function buildNote(detail: AdDetail, open: AdFinding[]): string {
  const lines: string[] = [];
  lines.push(`Changes requested for “${detail.title}” (V${detail.latest.versionNo})`);
  lines.push("");
  if (open.length === 0) {
    lines.push("Please revise the ad as discussed and send the updated version back.");
  } else {
    open.forEach((f, i) => {
      lines.push(`${i + 1}. ${issueTitle(f)} (${severityLabel(f.severity)})`);
      if (f.quote) lines.push(`   Quoted: “${f.quote}”`);
      if (f.rule) lines.push(`   Rule: ${f.rule.title}${f.rule.references[0] ? ` — ${f.rule.references[0].citation}` : ""}`);
      if (f.suggestedFix) lines.push(`   Fix: ${f.suggestedFix}`);
      else if (f.explanation) lines.push(`   Fix: ${f.explanation}`);
      if (f.suggestedCopy) lines.push(`   Suggested wording: “${f.suggestedCopy}”`);
      lines.push("");
    });
    lines.push("Please send the revised version back; it will be re-checked automatically.");
  }
  return lines.join("\n");
}

function RequestChangesForm({ detail, onClose, onDone }: { detail: AdDetail; onClose: () => void; onDone: (label: string, r: DecideResult, opts?: { advance?: boolean }) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const openIssues = useMemo(() => detail.findings.filter((f) => f.open), [detail.findings]);
  const [text, setText] = useState(() => buildNote(detail, openIssues));
  const [due, setDue] = useState("");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy. Select the text and copy it yourself.");
    }
  };

  return (
    <>
      <SheetHeader className="pb-0">
        <SheetTitle>Request changes on V{detail.latest.versionNo}</SheetTitle>
        <SheetDescription id="request-desc">
          Built from the open issues. Edit it and copy it to the submitter yourself; the app sends no email. The revision is re-checked when it arrives.
        </SheetDescription>
      </SheetHeader>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          setError(null);
          start(async () => {
            const items =
              openIssues.length > 0
                ? openIssues.map((f) => ({
                    finding_id: f.id,
                    quote: f.quote ?? undefined,
                    rule: f.rule?.title ?? undefined,
                    required_fix: f.suggestedFix || f.explanation || issueTitle(f),
                    suggested_copy: f.suggestedCopy ?? undefined,
                  }))
                : [{ required_fix: text.trim().slice(0, 4000) }];
            const res = await decide({
              versionId: detail.latest.id,
              decision: "changes_requested",
              changeRequest: { items, note: text.trim(), message_text: text.trim(), due_date: due || undefined },
            });
            if (!res.ok) {
              setError(res.error);
              return;
            }
            onClose();
            onDone(`Changes requested on V${detail.latest.versionNo}`, res.data, { advance: false });
          });
        }}
      >
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="request-text">Note to the submitter</Label>
              <Button type="button" size="xs" variant="ghost" onClick={copy}>
                <Copy data-icon="inline-start" /> Copy as text
              </Button>
            </div>
            <Textarea id="request-text" value={text} onChange={(e) => setText(e.target.value)} className="min-h-64 font-sans text-sm" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="request-due">Due date (optional)</Label>
            <Input id="request-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-fit" />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <SheetFooter className="flex-row justify-end gap-2 border-t">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !text.trim()}>
            {pending ? <Spinner className="motion-reduce:animate-none" /> : <MessageSquareWarning data-icon="inline-start" />}
            Request changes
          </Button>
        </SheetFooter>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// Reject / Withdraw
// ---------------------------------------------------------------------------

function RejectForm({ detail, onClose, onDone }: { detail: AdDetail; onClose: () => void; onDone: (label: string, r: DecideResult) => void }) {
  const [pending, start] = useTransition();
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Reject V{detail.latest.versionNo}</DialogTitle>
        <DialogDescription>Rejecting closes the ad. Use Request changes when a revision is expected.</DialogDescription>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!rationale.trim()) return;
          start(async () => {
            const res = await decide({ versionId: detail.latest.id, decision: "rejected", rationale: rationale.trim() });
            if (!res.ok) {
              setError(res.error);
              return;
            }
            onClose();
            onDone(`Rejected V${detail.latest.versionNo}`, res.data);
          });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="reject-rationale">Why (required)</Label>
          <Textarea id="reject-rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} className="min-h-24" autoFocus />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" disabled={pending || !rationale.trim()}>
            {pending ? <Spinner className="motion-reduce:animate-none" /> : <XCircle data-icon="inline-start" />}
            Reject
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function WithdrawForm({ assetId, onClose }: { assetId: string; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ok = rationale.trim().length >= 20;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Withdraw approval</DialogTitle>
        <DialogDescription>Takes the ad out of market. The approval record stays in the history.</DialogDescription>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          start(async () => {
            const res = await withdrawApproval({ assetId, rationale: rationale.trim() });
            if (!res.ok) {
              setError(res.error);
              return;
            }
            onClose();
            toast.success("Approval withdrawn");
          });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="withdraw-rationale">Why (at least 20 characters)</Label>
          <Textarea id="withdraw-rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} className="min-h-24" autoFocus />
          <div className={cn("text-xs tabular-nums", ok ? "text-muted-foreground" : "text-destructive")}>{rationale.trim().length} / 20</div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" disabled={pending || !ok}>
            {pending ? <Spinner className="motion-reduce:animate-none" /> : <Undo2 data-icon="inline-start" />}
            Withdraw
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function ArchiveForm({ detail, onClose }: { detail: AdDetail; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ok = reason.trim().length >= 3;
  const approved = APPROVED_STATUSES.has(detail.status);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Archive this ad</DialogTitle>
        <DialogDescription>
          {approved
            ? "Moves it off the Approved and Live tabs. The approval record and every version stay; Unarchive brings it back."
            : "Moves it to the Archived tab. Nothing is deleted; Unarchive brings it back."}
        </DialogDescription>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          start(async () => {
            const res = await archiveAd({ assetId: detail.id, reason: reason.trim() });
            if (!res.ok) {
              setError(res.error);
              return;
            }
            onClose();
            toast.success("Archived");
          });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="archive-reason">Why (a few words)</Label>
          <Textarea id="archive-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-20" placeholder="Campaign ended, superseded by V3, no longer offered…" autoFocus />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !ok}>
            {pending ? <Spinner className="motion-reduce:animate-none" /> : <Archive data-icon="inline-start" />}
            Archive
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
