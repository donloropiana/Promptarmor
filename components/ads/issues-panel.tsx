"use client";

import { BookOpen, CheckCheck, ChevronDown, ChevronRight, ExternalLink, MapPin, Recycle, RotateCcw, SearchX, WandSparkles } from "lucide-react";
import { cn } from "cn";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { AnimatedUl } from "@/components/ui/animated-list";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { applySuggestion, dispositionFinding } from "@/lib/actions/ads";
import type { AdFinding } from "@/lib/data/ads";
import type { Severity } from "@/lib/types/ads";

import { severityLabel } from "./format";
import { LongText } from "./long-text";
import { SeverityWord } from "./severity";
import { recheckLabel } from "./what-changed";

const REASONS = [
  { value: "false_positive", label: "False positive: the words don't say that" },
  { value: "not_applicable", label: "Not applicable: this rule doesn't cover this ad" },
  { value: "disclosed_elsewhere", label: "Disclosed elsewhere in the creative" },
] as const;

const EVIDENCE_TITLES: Record<string, string> = {
  offer_mismatch: "Doesn't match the product terms",
  missing_disclosure: "Missing disclosure",
  needs_judgment: "Needs a human judgment",
  exact_match: "Flagged wording",
};

export function issueTitle(f: AdFinding): string {
  if (f.rule) return f.rule.title;
  if (f.origin === "reviewer") return "Reviewer-added issue";
  if (f.origin === "ai") return "Worth a look (not a rule yet)";
  return EVIDENCE_TITLES[f.evidenceType] ?? "Issue";
}

export function IssuesPanel({
  findings,
  assetId,
  versionNo,
  format,
  selectedId,
  onSelect,
  formFor,
  onFormFor,
  readOnly,
  emptyNote,
}: {
  findings: AdFinding[];
  assetId: string;
  versionNo: number;
  format: "text" | "html" | "pdf" | "image";
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Which issue has its "Not a problem" form open (owned by the parent so the X key can open it). */
  formFor: string | null;
  onFormFor: (id: string | null) => void;
  readOnly: boolean;
  /** What to say when nothing was found (depends on which checks actually ran). */
  emptyNote?: string;
}) {
  const [showDismissed, setShowDismissed] = useState(false);

  const active = findings.filter((f) => f.open || f.disposition?.disposition === "accepted_exception");
  const dismissed = findings.filter((f) => f.disposition?.disposition === "dismissed");
  const groups: { severity: Severity; items: AdFinding[] }[] = (["critical", "major", "minor"] as Severity[])
    .map((severity) => ({ severity, items: active.filter((f) => f.severity === severity) }))
    .filter((g) => g.items.length > 0);

  if (findings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-card p-6 text-center">
        <CheckCheck aria-hidden className="mx-auto mb-2 size-5 text-muted-foreground" />
        <div className="text-sm font-medium">No issues found</div>
        <p className="mt-1 text-sm text-muted-foreground">{emptyNote ?? "The check found nothing against the rules or the product terms. Read the ad yourself before approving."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {groups.length === 0 && (
        <div className="rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground">
          Every issue has been marked Not a problem. Review the dismissed list below before approving.
        </div>
      )}
      {groups.map((g) => (
        <section key={g.severity} aria-label={`${severityLabel(g.severity)} issues`}>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {severityLabel(g.severity)} <span className="tabular-nums">({g.items.length})</span>
          </h3>
          <AnimatedUl className="enter-stagger space-y-2">
            {g.items.map((f, i) => (
              <li key={f.id} style={{ "--i": Math.min(i, 6) } as React.CSSProperties}>
                <IssueCard
                  finding={f}
                  assetId={assetId}
                  versionNo={versionNo}
                  format={format}
                  selected={selectedId === f.id}
                  onSelect={() => onSelect(selectedId === f.id ? null : f.id)}
                  formOpen={formFor === f.id}
                  onFormOpen={(o) => onFormFor(o ? f.id : null)}
                  readOnly={readOnly}
                />
              </li>
            ))}
          </AnimatedUl>
        </section>
      ))}

      {dismissed.length > 0 && (
        <section aria-label="Dismissed issues">
          <button
            type="button"
            onClick={() => setShowDismissed((s) => !s)}
            aria-expanded={showDismissed}
            className="mb-2 inline-flex items-center gap-1 rounded-md text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            {showDismissed ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}
            Dismissed <span className="tabular-nums">({dismissed.length})</span>
          </button>
          {showDismissed && (
            <AnimatedUl className="space-y-2">
              {dismissed.map((f) => (
                <li key={f.id}>
                  <DismissedCard finding={f} readOnly={readOnly} onSelect={() => onSelect(f.id)} selected={selectedId === f.id} />
                </li>
              ))}
            </AnimatedUl>
          )}
        </section>
      )}
    </div>
  );
}

function IssueCard({
  finding: f,
  assetId,
  versionNo,
  format,
  selected,
  onSelect,
  formOpen,
  onFormOpen,
  readOnly,
}: {
  finding: AdFinding;
  assetId: string;
  versionNo: number;
  format: "text" | "html" | "pdf" | "image";
  selected: boolean;
  onSelect: () => void;
  formOpen: boolean;
  onFormOpen: (open: boolean) => void;
  readOnly: boolean;
}) {
  const [applying, startApply] = useTransition();
  const [reopening, startReopen] = useTransition();
  const canApply = (format === "text" || format === "html") && Boolean(f.suggestedCopy?.trim());
  const textOnly = format !== "text" && format !== "html" && Boolean(f.suggestedCopy?.trim());
  const isException = f.disposition?.disposition === "accepted_exception";
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <div
      ref={ref}
      data-finding-id={f.id}
      className={cn(
        "scroll-mb-24 scroll-mt-4 rounded-xl border bg-card transition-[box-shadow,border-color] duration-150",
        selected && "border-foreground/40 ring-1 ring-foreground/20",
        f.severity === "critical" && !selected && "border-destructive/30",
      )}
    >
      <button type="button" onClick={onSelect} aria-pressed={selected} className="flex w-full flex-col items-start gap-1.5 rounded-t-xl px-3.5 pt-3 text-left focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
        <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1">
          <SeverityWord severity={f.severity} />
          {versionNo > 1 && (
            <span className={cn("rounded-full border px-1.5 text-[11px] font-medium", recheckLabel(f) === "New" ? "text-foreground" : "text-muted-foreground")}>{recheckLabel(f)}</span>
          )}
          {f.origin === "reviewer" && (
            <span className="rounded-full border px-1.5 text-[11px] font-medium text-muted-foreground" data-reviewer-chip>
              Added by {f.authorLabel && f.authorLabel !== "You" ? f.authorLabel : f.authorLabel === "You" ? "you" : "reviewer"}
            </span>
          )}
          {f.severity !== f.originalSeverity && <span className="text-[11px] text-muted-foreground">was {severityLabel(f.originalSeverity)}</span>}
          {isException && <span className="rounded-full border px-1.5 text-[11px] font-medium text-muted-foreground">Accepted as exception</span>}
        </div>
        <div className="min-w-0 max-w-full text-sm font-semibold leading-snug [overflow-wrap:anywhere]">{issueTitle(f)}</div>
        {f.imageAnchor ? (
          <span data-pinned-note className="inline-flex max-w-full items-start gap-1 text-sm text-foreground [overflow-wrap:anywhere]" dir="auto">
            <MapPin aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <span>
              <span className="text-muted-foreground">Pinned on the image</span>
              {f.quote ? <>: {f.quote}</> : null}
            </span>
          </span>
        ) : f.quote ? (
          <q className="block max-w-full border-l-2 border-foreground/30 pl-2 text-sm text-foreground [overflow-wrap:anywhere] [quotes:'“'_'”']" dir="auto">
            {f.quote}
          </q>
        ) : null}
      </button>
      <div className="space-y-2.5 px-3.5 pb-3 pt-1.5">
        {!f.verifiedSpan && f.origin === "ai" && (
          <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <SearchX aria-hidden className="size-3.5" /> Evidence not found in the text. Check the creative by hand.
          </p>
        )}
        {f.explanation && <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{f.explanation}</p>}
        {f.rule && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <BookOpen aria-hidden className="size-3.5" />
              Rule: <span className="text-foreground">{f.rule.title}</span>
              {f.rule.code && <span className="font-mono">{f.rule.code}</span>}
            </span>
            {f.rule.references.map((r) =>
              r.url ? (
                <a key={r.id} href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-4 hover:text-foreground">
                  {r.citation}
                  <ExternalLink aria-hidden className="size-3" />
                </a>
              ) : (
                <span key={r.id}>{r.citation}</span>
              ),
            )}
          </div>
        )}
        {(f.suggestedFix || f.suggestedCopy) && (
          <div className="rounded-lg bg-muted/50 p-2.5">
            {f.suggestedFix && <p className="text-sm">{f.suggestedFix}</p>}
            {f.suggestedCopy && (
              <q className="mt-1 block whitespace-pre-wrap text-sm text-foreground [overflow-wrap:anywhere] [quotes:'“'_'”']" dir="auto">
                {f.suggestedCopy}
              </q>
            )}
            {!readOnly && canApply && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={applying}
                onClick={() =>
                  startApply(async () => {
                    const res = await applySuggestion({ assetId, findingId: f.id });
                    if (!res.ok) toast.error(res.error);
                    else toast.success(`Created V${res.data.versionNo}. Checking it now.`);
                  })
                }
              >
                {applying ? <Spinner className="motion-reduce:animate-none" /> : <WandSparkles data-icon="inline-start" />}
                Use this wording
              </Button>
            )}
            {textOnly && <p className="mt-1.5 text-xs text-muted-foreground">Text suggestion only: this ad is a file, so change the original and upload it again.</p>}
          </div>
        )}
        {f.reusedFromFindingId && (
          <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Recycle aria-hidden className="size-3.5" /> Reused from an earlier identical check · $0
          </p>
        )}
        {isException && f.disposition && (
          <div className="rounded-lg border p-2.5 text-xs">
            <div className="text-muted-foreground">
              Exception by {f.disposition.actorLabel ?? "a member"}
              {f.disposition.carried ? " (carried from the previous version)" : ""}
            </div>
            {f.disposition.note && <LongText text={f.disposition.note} className="mt-0.5" />}
            {!readOnly && (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="mt-1.5"
                disabled={reopening}
                onClick={() =>
                  startReopen(async () => {
                    const res = await dispositionFinding({ findingId: f.id, disposition: "fix_required", note: "Reopened by reviewer" });
                    if (!res.ok) toast.error(res.error);
                  })
                }
              >
                {reopening ? <Spinner className="motion-reduce:animate-none" /> : <RotateCcw data-icon="inline-start" />}
                Reopen
              </Button>
            )}
          </div>
        )}
        {!readOnly && f.open && !formOpen && (
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => onFormOpen(true)}>
              Not a problem
              <kbd className="ml-1 rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">X</kbd>
            </Button>
          </div>
        )}
        {formOpen && <DismissForm finding={f} onClose={() => onFormOpen(false)} />}
      </div>
    </div>
  );
}

function DismissForm({ finding: f, onClose }: { finding: AdFinding; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [reason, setReason] = useState<(typeof REASONS)[number]["value"] | "">("");
  const [note, setNote] = useState("");
  const strict = f.originalSeverity === "critical" || f.originalSeverity === "major";
  const noteOk = !strict || note.trim().length >= 40;
  const reasonOk = !strict || reason !== "";
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    noteRef.current?.focus();
  }, []);

  return (
    <form
      className="space-y-2.5 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!noteOk || !reasonOk) return;
        start(async () => {
          const res = await dispositionFinding({ findingId: f.id, disposition: "dismissed", reason: reason || undefined, note: note.trim() || undefined });
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success("Marked Not a problem");
          onClose();
        });
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="text-sm font-medium">Not a problem: why?</div>
      <div className="grid gap-1.5">
        <Label htmlFor={`reason-${f.id}`}>Reason{strict ? "" : " (optional)"}</Label>
        <Select value={reason} onValueChange={(v) => setReason(v as typeof reason)}>
          <SelectTrigger id={`reason-${f.id}`} className="w-full">
            <SelectValue placeholder="Pick a reason" />
          </SelectTrigger>
          <SelectContent>
            {REASONS.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`note-${f.id}`}>
          Note{strict ? " (at least 40 characters; it goes in the audit record)" : " (optional)"}
        </Label>
        <Textarea
          ref={noteRef}
          id={`note-${f.id}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={strict ? "Say what you checked and why this ad is fine as written." : "Anything a future reviewer should know."}
          className="min-h-20"
          aria-describedby={`note-count-${f.id}`}
        />
        <div id={`note-count-${f.id}`} className={cn("text-xs tabular-nums", strict && !noteOk ? "text-destructive" : "text-muted-foreground")}>
          {note.trim().length}
          {strict ? " / 40" : ""}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending || !noteOk || !reasonOk}>
          {pending ? <Spinner className="motion-reduce:animate-none" /> : null}
          Confirm
        </Button>
      </div>
    </form>
  );
}

function DismissedCard({ finding: f, readOnly, onSelect, selected }: { finding: AdFinding; readOnly: boolean; onSelect: () => void; selected: boolean }) {
  const [pending, start] = useTransition();
  const reason = REASONS.find((r) => r.value === f.disposition?.reason)?.label.split(":")[0] ?? f.disposition?.reason?.replace(/_/g, " ");
  return (
    <div className={cn("rounded-xl border bg-card px-3.5 py-2.5 text-sm", selected && "border-foreground/40")}>
      <button type="button" onClick={onSelect} className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-left focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
        <SeverityWord severity={f.severity} className="text-muted-foreground" />
        <span className="font-medium line-through decoration-muted-foreground/60">{issueTitle(f)}</span>
        {f.imageAnchor ? (
          <span className="inline-flex min-w-0 max-w-full items-center gap-1 truncate text-muted-foreground" dir="auto">
            <MapPin aria-hidden className="size-3.5 shrink-0" />
            Pinned on the image{f.quote ? `: ${f.quote}` : ""}
          </span>
        ) : f.quote ? (
          <q className="min-w-0 max-w-full truncate text-muted-foreground [quotes:'“'_'”']" dir="auto">
            {f.quote}
          </q>
        ) : null}
      </button>
      <div className="mt-1 break-words text-xs text-muted-foreground">
        {reason ? `${reason} · ` : ""}
        by {f.disposition?.actorLabel ?? "a member"}
        {f.disposition?.carried ? " (carried from the previous version)" : ""}
        {f.disposition?.note ? ` · ${f.disposition.note}` : ""}
      </div>
      {!readOnly && (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="mt-1.5"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await dispositionFinding({ findingId: f.id, disposition: "fix_required", note: "Undo: reopened by reviewer" });
              if (!res.ok) toast.error(res.error);
              else toast.success("Reopened");
            })
          }
        >
          {pending ? <Spinner className="motion-reduce:animate-none" /> : <RotateCcw data-icon="inline-start" />}
          Undo
        </Button>
      )}
    </div>
  );
}
