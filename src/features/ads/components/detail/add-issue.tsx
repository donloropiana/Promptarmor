"use client";

import { MapPin, Plus } from "lucide-react";
import { cn } from "cn";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { addReviewerIssue } from "@/features/ads/server/actions";
import { MAX_IMAGE_LABEL_CHARS, type Severity } from "@/features/ads/types";

/**
 * "+ Add issue": a reviewer quotes words the AI missed. The quote comes from
 * a text selection in the ad's text view (see creative-view.tsx); the
 * dialog takes severity, the rule it breaks and why. The server verifies the
 * words are in this version and records a reviewer finding with its author.
 *
 * With a `region` (a spot clicked on an image ad) the same dialog adds an
 * image note instead: a short label in place of the quote, pinned where the
 * reviewer clicked.
 */

export const MAX_QUOTE_CHARS = 500;

/** Where a pin was dropped: fractions 0..1 of the rendered image. */
export type PinRegion = { x: number; y: number };
const MIN_WHY_CHARS = 10;
const MAX_WHY_CHARS = 1000;

export type RuleOption = { id: string; code: string; title: string };

/** The current selection as ad text, when it lies inside `container`. */
export type AdSelection = {
  quote: string;
  /** First and last line boxes of the selection, relative to the viewport (for the floating button). */
  first: { left: number; right: number; top: number; bottom: number };
  rect: { left: number; right: number; top: number; bottom: number };
};

/**
 * Reads the window selection and returns the selected ad words when both
 * ends are inside `container`. Only text under `[data-ad-text]` counts, so
 * section labels ("Headline", "Page 2") never leak into the quote; text
 * from different paragraphs is joined with a newline so a quote that spans
 * two sections still matches the version's text after whitespace folding.
 */
export function readAdSelection(container: HTMLElement | null): AdSelection | null {
  if (!container || typeof window === "undefined") return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let lastBlock: Element | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    const block = (node.parentElement ?? null)?.closest("[data-ad-text]") ?? null;
    if (!block) continue;
    const text = node.textContent ?? "";
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : text.length;
    const slice = text.slice(start, end);
    if (!slice) continue;
    if (lastBlock && block !== lastBlock) parts.push("\n");
    parts.push(slice);
    lastBlock = block;
  }
  const quote = parts.join("").trim();
  if (!quote) return null;

  const rects = range.getClientRects();
  const first = rects.length ? rects[0] : range.getBoundingClientRect();
  const last = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
  const box = (r: DOMRect) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  return { quote, first: box(first), rect: box(last) };
}

const SEVERITIES: { value: Severity; label: string; hint: string }[] = [
  {
    value: "critical",
    label: "Critical",
    hint: "the ad cannot run as written; needs a fix or a written exception",
  },
  {
    value: "major",
    label: "Major",
    hint: "needs a fix or a written exception",
  },
  {
    value: "minor",
    label: "Minor",
    hint: "worth fixing, does not block approval",
  },
];

export function AddIssueDialog({ open, onOpenChange, ...form }: AddIssueFormProps & { open: boolean }) {
  const whyRef = useRef<HTMLTextAreaElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onOpenAutoFocus={(e) => {
          // Land on the first thing to type, not the close button.
          e.preventDefault();
          (form.region ? labelRef.current : whyRef.current)?.focus();
        }}
      >
        {/* Mounted only while open, so every opening starts clean with the words that were selected. */}
        {open && <AddIssueForm {...form} onOpenChange={onOpenChange} whyRef={whyRef} labelRef={labelRef} />}
      </DialogContent>
    </Dialog>
  );
}

type AddIssueFormProps = {
  onOpenChange: (open: boolean) => void;
  assetVersionId: string;
  versionNo: number;
  /** The selected words. Empty when the dialog was opened without a selection. */
  quote: string;
  /** When no words were selected, let the reviewer paste them (the server still checks they are in the ad). */
  quoteEditable: boolean;
  rules: RuleOption[];
  onAdded: (findingId: string) => void;
  /** Set for an image note: where the pin was dropped. The quote field becomes a short label. */
  region?: PinRegion | null;
};

function AddIssueForm({
  onOpenChange,
  assetVersionId,
  versionNo,
  quote: initialQuote,
  quoteEditable,
  rules,
  onAdded,
  region,
  whyRef,
  labelRef,
}: AddIssueFormProps & {
  whyRef: React.RefObject<HTMLTextAreaElement | null>;
  labelRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [pending, start] = useTransition();
  const [quote, setQuote] = useState(initialQuote);
  const [severity, setSeverity] = useState<Severity>("major");
  const [ruleId, setRuleId] = useState<string>("none");
  const [why, setWhy] = useState("");
  const [error, setError] = useState<string | null>(null);

  const pinned = Boolean(region);
  const quoteTrimmed = quote.trim();
  const quoteTooLong = quoteTrimmed.length > (pinned ? MAX_IMAGE_LABEL_CHARS : MAX_QUOTE_CHARS);
  const quoteOk = quoteTrimmed.length > 0 && !quoteTooLong;
  const whyLen = why.trim().length;
  const whyOk = whyLen >= MIN_WHY_CHARS && whyLen <= MAX_WHY_CHARS;
  const canSubmit = quoteOk && whyOk && !pending;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{pinned ? "Add a note on the image" : "Add an issue"}</DialogTitle>
        <DialogDescription>
          {pinned
            ? `Pinned where you clicked on V${versionNo}. It goes in the audit record with your name and counts at approval time like any other issue.`
            : `For something the check missed on V${versionNo}. It goes in the audit record with your name and counts at approval time like any other issue.`}
        </DialogDescription>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          setError(null);
          start(async () => {
            const res = await addReviewerIssue({
              assetVersionId,
              quote: quoteTrimmed,
              severity,
              ruleId: ruleId === "none" ? null : ruleId,
              explanation: why.trim(),
              region: region ? { x: region.x, y: region.y } : undefined,
            });
            if (!res.ok) {
              setError(res.error);
              return;
            }
            toast.success(pinned ? "Note pinned" : "Issue added");
            onOpenChange(false);
            onAdded(res.data.findingId);
          });
        }}
      >
        <div className="grid gap-1.5">
          {pinned ? (
            <>
              <Label htmlFor="add-issue-label">What is it about?</Label>
              <Input
                ref={labelRef}
                id="add-issue-label"
                value={quote}
                onChange={(e) => setQuote(e.target.value)}
                placeholder="e.g. APR in the footer"
                aria-describedby="add-issue-label-help"
                maxLength={MAX_IMAGE_LABEL_CHARS + 40}
                dir="auto"
              />
              <p id="add-issue-label-help" className={cn("text-xs", quoteTooLong ? "text-destructive" : "text-muted-foreground")}>
                {quoteTooLong ? `Keep the label under ${MAX_IMAGE_LABEL_CHARS} characters; the details go below.` : "A few words naming the spot, so the note reads well in the change request."}
              </p>
            </>
          ) : quoteEditable ? (
            <>
              <Label htmlFor="add-issue-quote">The words</Label>
              <Textarea
                id="add-issue-quote"
                value={quote}
                onChange={(e) => setQuote(e.target.value)}
                placeholder="Paste the exact words from the ad"
                className="min-h-16"
                aria-describedby="add-issue-quote-help"
                dir="auto"
              />
              <p id="add-issue-quote-help" className={cn("text-xs", quoteTooLong ? "text-destructive" : "text-muted-foreground")}>
                {quoteTooLong
                  ? `Keep it under ${MAX_QUOTE_CHARS} characters: pick the few words that matter.`
                  : "Next time, select the words in the ad text and the + Add issue button appears by them."}
              </p>
            </>
          ) : (
            <>
              <div className="text-sm font-medium" id="add-issue-quote-label">
                The words
              </div>
              <q
                aria-labelledby="add-issue-quote-label"
                data-add-issue-quote
                className="line-clamp-4 border-l-2 border-foreground/30 pl-2 text-sm text-foreground [overflow-wrap:anywhere] [quotes:'“'_'”']"
                dir="auto"
                title={quoteTrimmed.length > 160 ? quoteTrimmed : undefined}
              >
                {quoteTrimmed}
              </q>
              {quoteTooLong && <p className="text-xs text-destructive">Keep it under {MAX_QUOTE_CHARS} characters: select just the few words that matter.</p>}
            </>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="add-issue-severity">Severity</Label>
            <Select value={severity} onValueChange={(v) => setSeverity(v as Severity)}>
              <SelectTrigger id="add-issue-severity" className="w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{SEVERITIES.find((s) => s.value === severity)?.hint}</p>
          </div>
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="add-issue-rule">Rule it breaks</Label>
            <Select value={ruleId} onValueChange={setRuleId}>
              {/* Rule titles are sentences: the trigger and the list clip them with an ellipsis instead of widening the dialog. */}
              <SelectTrigger id="add-issue-rule" className="w-full min-w-0 *:data-[slot=select-value]:min-w-0">
                <SelectValue placeholder="No specific rule" />
              </SelectTrigger>
              <SelectContent className="max-w-[min(28rem,calc(100vw-2rem))]">
                <SelectItem value="none">No specific rule</SelectItem>
                {rules.map((r) => (
                  <SelectItem key={r.id} value={r.id} title={`${r.code} · ${r.title}`}>
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span className="shrink-0 font-mono text-xs">{r.code}</span>
                      <span className="truncate">{r.title}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Only rules that are on are listed.</p>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="add-issue-why">Why is this a problem? (at least {MIN_WHY_CHARS} characters)</Label>
          <Textarea
            ref={whyRef}
            id="add-issue-why"
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            placeholder={pinned ? "What you see there, what the rule or the product terms say, and what should change." : "What the words claim, what the rule or the product terms say, and what should change."}
            className="min-h-24"
            aria-describedby="add-issue-why-count"
            maxLength={MAX_WHY_CHARS + 200}
          />
          <div id="add-issue-why-count" className={cn("text-xs tabular-nums", whyLen > 0 && !whyOk ? "text-destructive" : "text-muted-foreground")}>
            {whyLen} / {MIN_WHY_CHARS}
            {whyLen > MAX_WHY_CHARS ? ` · keep it under ${MAX_WHY_CHARS.toLocaleString("en-US")}` : ""}
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {pending ? <Spinner className="motion-reduce:animate-none" /> : pinned ? <MapPin data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
            {pinned ? "Pin note" : "Add issue"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
