"use client";

import { ExternalLink, FileText, Image as ImageIcon, Pencil, Plus } from "lucide-react";
import { cn } from "cn";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AdFinding, AdVersion } from "@/lib/data/ads";

import { AddIssueDialog, readAdSelection, type AdSelection, type RuleOption } from "./add-issue";
import { channelLabel } from "./format";

export type Mark = { id: string; start: number; end: number; severity: AdFinding["severity"] };

/** Anchors from findings, with a quote-search fallback for unanchored ones. Merged and sorted. */
export function marksFor(findings: AdFinding[], text: string): Mark[] {
  const marks: Mark[] = [];
  const lower = text.toLowerCase();
  for (const f of findings) {
    if (!f.open && f.disposition?.disposition !== "accepted_exception") continue;
    if (f.anchor && f.anchor.end <= text.length) {
      marks.push({ id: f.id, start: f.anchor.start, end: f.anchor.end, severity: f.severity });
      continue;
    }
    const q = f.quote?.trim().toLowerCase();
    if (q) {
      const i = lower.indexOf(q);
      if (i >= 0) marks.push({ id: f.id, start: i, end: i + q.length, severity: f.severity });
      else {
        const loose = q.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
        const m = new RegExp(loose, "i").exec(text);
        if (m) marks.push({ id: f.id, start: m.index, end: m.index + m[0].length, severity: f.severity });
      }
    }
  }
  return marks.sort((a, b) => a.start - b.start || b.end - a.end);
}

type Segment = { text: string; marks: Mark[] };

/** Splits text into segments so nested/overlapping marks render as stacked <mark>s. */
function segment(text: string, marks: Mark[], from = 0, to = text.length): Segment[] {
  const points = new Set<number>([from, to]);
  for (const m of marks) {
    if (m.end <= from || m.start >= to) continue;
    points.add(Math.max(from, m.start));
    points.add(Math.min(to, m.end));
  }
  const sorted = [...points].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i];
    const e = sorted[i + 1];
    if (e <= s) continue;
    out.push({ text: text.slice(s, e), marks: marks.filter((m) => m.start <= s && m.end >= e) });
  }
  return out;
}

function MarkedText({
  text,
  marks,
  selectedId,
  onSelect,
  from,
  to,
  className,
}: {
  text: string;
  marks: Mark[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  from?: number;
  to?: number;
  className?: string;
}) {
  const segments = useMemo(() => segment(text, marks, from ?? 0, to ?? text.length), [text, marks, from, to]);
  return (
    // data-ad-text: only text under this attribute can become an "Add issue" quote (labels never do).
    <p data-ad-text className={cn("whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]", className)} dir="auto">
      {segments.map((seg, i) => {
        if (seg.marks.length === 0) return <span key={i}>{seg.text}</span>;
        const primary = seg.marks.find((m) => m.id === selectedId) ?? seg.marks[0];
        const selected = seg.marks.some((m) => m.id === selectedId);
        return (
          <mark
            key={i}
            data-finding-id={primary.id}
            data-selected={selected || undefined}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(primary.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(primary.id);
              }
            }}
            aria-label={`Quoted in issue, ${primary.severity}`}
            className={cn(
              "cursor-pointer rounded-sm bg-transparent px-0.5 text-foreground underline decoration-2 underline-offset-[3px] transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
              primary.severity === "critical" ? "decoration-destructive" : primary.severity === "major" ? "decoration-foreground" : "decoration-muted-foreground",
              selected ? "bg-foreground/10 ring-1 ring-foreground/30" : "hover:bg-muted",
            )}
          >
            {seg.text}
          </mark>
        );
      })}
    </p>
  );
}

/** Maps content.sections onto extracted_text offsets, or null when they do not line up. */
function sectionRanges(text: string, sections: AdVersion["content"]["sections"]): { id: string; label: string; start: number; end: number }[] | null {
  if (!sections || sections.length === 0) return null;
  const out: { id: string; label: string; start: number; end: number }[] = [];
  let cursor = 0;
  for (const s of sections) {
    const t = s.text ?? "";
    if (!t.trim()) continue;
    const i = text.indexOf(t, cursor);
    if (i < 0) return null;
    out.push({ id: s.id, label: s.label, start: i, end: i + t.length });
    cursor = i + t.length;
  }
  return out.length ? out : null;
}

function TextCard({
  version,
  marks,
  selectedId,
  onSelect,
}: {
  version: AdVersion;
  marks: Mark[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const text = version.extractedText || version.content.text || "";
  const ranges = useMemo(() => sectionRanges(text, version.content.sections), [text, version.content.sections]);
  if (!text.trim()) {
    return <p className="text-sm text-muted-foreground">No text was extracted from this version.</p>;
  }
  if (!ranges) {
    return (
      <div className="rounded-xl border bg-card p-4 text-[15px] sm:p-6">
        <MarkedText text={text} marks={marks} selectedId={selectedId} onSelect={onSelect} />
      </div>
    );
  }
  return (
    <div className="rounded-xl border bg-card text-[15px]">
      {ranges.map((r, i) => {
        const isHeadline = /head|title|subject/i.test(r.label);
        const isFine = /disclos|fine|legal|footer|terms/i.test(r.label);
        // A run of same-labelled sections (a long email body) gets one label, not one per paragraph.
        const sameAsPrevious = i > 0 && ranges[i - 1].label === r.label;
        return (
          <section key={r.id} className={cn("px-4 sm:px-6", sameAsPrevious ? "pb-3" : "py-3", i > 0 && !sameAsPrevious && "border-t")}>
            {!sameAsPrevious && <div className="mb-1 select-none text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{r.label}</div>}
            <MarkedText
              text={text}
              marks={marks}
              selectedId={selectedId}
              onSelect={onSelect}
              from={r.start}
              to={r.end}
              className={cn(isHeadline && "text-lg font-semibold leading-snug", isFine && "text-[13px] text-muted-foreground")}
            />
          </section>
        );
      })}
    </div>
  );
}

/**
 * The preview frame is `sandbox=""` (no scripts, no forms, no popups, opaque
 * origin), and this policy stops every network request the markup could
 * still make: remote images (tracking pixels tell a submitter when a reviewer
 * opened the ad), stylesheets, fonts, frames, objects. Only inline styles and
 * data: images render. `<base target="_blank">` turns every link into a
 * popup, which the sandbox refuses, so nothing navigates; meta refresh is
 * removed because it would navigate the frame itself.
 */
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'; frame-src 'none'; connect-src 'none'">`;
const INERT_LINKS = `<base target="_blank"><style>a[target="_self"],a[target="_parent"],a[target="_top"],area{pointer-events:none}</style>`;
const HEAD_INJECT = `${CSP}${INERT_LINKS}`;

export function withCsp(html: string): string {
  const safe = html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?\s*refresh[^>]*>/gi, "<!-- meta refresh removed -->");
  // The policy goes first, in a <head> we own, so it applies to everything
  // after it. The parser merges the ad's own <html>/<head> into ours
  // (duplicate start tags are ignored, their children still land in the
  // head), so looking for the ad's <head> is unnecessary and unsafe: the
  // string "<head>" inside an attribute value would have swallowed the meta.
  return `<!doctype html><html><head>${HEAD_INJECT}</head>${safe}`;
}

/** True when the markup references anything off-site that the preview will not load. */
function hasRemoteAssets(html: string): boolean {
  return /\b(src|href|srcset|poster|data)\s*=\s*["']?\s*(https?:)?\/\//i.test(html) || /url\(\s*["']?\s*(https?:)?\/\//i.test(html);
}

function HtmlPreview({ html }: { html: string }) {
  const [tall, setTall] = useState(false);
  const remote = useMemo(() => hasRemoteAssets(html), [html]);
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <iframe
        title="Ad preview (sandboxed)"
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={withCsp(html)}
        className={cn("w-full bg-white transition-[height] duration-200 motion-reduce:transition-none", tall ? "h-[1400px]" : "h-[560px]")}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t px-3 py-1.5 text-xs text-muted-foreground">
        <span className="min-w-0">
          Rendered in a sandbox: no scripts, no network, no forms.
          {remote ? " Remote images and files are not loaded; the Text view has every word." : ""}
        </span>
        <button type="button" className="shrink-0 underline underline-offset-4 hover:text-foreground" onClick={() => setTall((t) => !t)}>
          {tall ? "Shorter" : "Taller"}
        </button>
      </div>
    </div>
  );
}

/** What an empty text view means, said honestly: who (if anyone) read the file. */
function NoTextNote({ kind, fileRead }: { kind: "PDF" | "image"; fileRead: "transcribed" | "unread" | "unknown" }) {
  const what = kind === "PDF" ? "No text layer could be read from this PDF" : "No text could be read from this image";
  return (
    <div className="rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">{what}.</p>
      <p className="mt-1">
        {fileRead === "transcribed"
          ? `The AI check read it as an image instead, so the issues on the right come from what it could make out. Open the ${kind === "PDF" ? "PDF" : "image"} in the Preview and compare.`
          : fileRead === "unread"
            ? `Nothing read it as an image either, so no words were checked against the rules or the product terms. Open the Preview and review it by hand before deciding.`
            : `When the check finishes it will say whether the AI read it as an image. Until then, use the Preview.`}
      </p>
    </div>
  );
}

/**
 * The creative on the left of the ad page. Text ads render as a card with
 * sections; HTML in a sandboxed iframe; PDF as "Open PDF" + extracted text with
 * page breaks; images inline. Clicking an issue highlights its words in the
 * text view (the view switches to Text when needed).
 */
export type CreativeViewMode = "preview" | "text";

/** Size the floating "+ Add issue" button is placed and clamped with (h-7 = 28px). */
const FLOAT_BUTTON_WIDTH = 112;
const FLOAT_BUTTON_HEIGHT = 28;

export function CreativeView({
  version,
  findings,
  fileUrl,
  selectedId,
  onSelect,
  channel,
  view,
  onViewChange,
  fileRead = "unknown",
  rulesInForce = [],
  canAddIssue = false,
  onIssueAdded,
  onEdit,
  editDisabledReason = null,
}: {
  version: AdVersion;
  findings: AdFinding[];
  fileUrl: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  channel: string | null;
  /** Controlled by the parent so selecting an issue can switch to the text view. */
  view: CreativeViewMode;
  onViewChange: (v: CreativeViewMode) => void;
  /**
   * For a PDF or image with no text layer: whether a model read it as an
   * image ("transcribed"), nothing read it ("unread"), or the check has not
   * finished ("unknown"). Decides what the empty text view says.
   */
  fileRead?: "transcribed" | "unread" | "unknown";
  /** Rules that are on, for the Add issue rule picker. */
  rulesInForce?: RuleOption[];
  /** "+ Add issue" is offered only while the ad can still take decisions (not approved). */
  canAddIssue?: boolean;
  /** Called with the new issue's id so the page can select it. */
  onIssueAdded?: (findingId: string) => void;
  /** "Edit" (edit the copy or replace the file): opens the page's edit sheet. Hidden when absent. */
  onEdit?: () => void;
  /** Why "Edit" is disabled right now (approved, or a check is running); null when it is available. */
  editDisabledReason?: string | null;
}) {
  const format = version.content.format;
  const text = version.extractedText || version.content.text || "";
  const marks = useMemo(() => marksFor(findings, text), [findings, text]);
  const containerRef = useRef<HTMLDivElement>(null);
  const textWrapRef = useRef<HTMLDivElement>(null);
  const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Selecting an issue: scroll its words into view (DOM only). Re-runs when
  // the findings change so a just-added issue is found once the page refreshes.
  useEffect(() => {
    if (!selectedId) return;
    const t = setTimeout(() => {
      const el = containerRef.current?.querySelector<HTMLElement>(`mark[data-finding-id="${selectedId}"]`);
      el?.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    }, 30);
    return () => clearTimeout(t);
  }, [selectedId, view, reduceMotion, findings]);

  // ---- "+ Add issue" from a text selection -------------------------------
  const showingText = (view === "text" || format === "text") && text.trim().length > 0;
  const addIssueAvailable = canAddIssue && showingText;
  const [floating, setFloating] = useState<{ quote: string; left: number; top: number } | null>(null);
  const [dialog, setDialog] = useState<{ quote: string; editable: boolean } | null>(null);

  /** Reads the selection; shows the floating button by its last line when it is ad text. */
  const captureSelection = useCallback(() => {
    const wrap = textWrapRef.current;
    if (!addIssueAvailable || !wrap) return;
    const sel: AdSelection | null = readAdSelection(wrap);
    if (!sel) {
      setFloating(null);
      return;
    }
    // Above the first selected line (it never covers what comes next);
    // below the last line when there is no room above.
    const box = wrap.getBoundingClientRect();
    const above = sel.first.top - box.top - FLOAT_BUTTON_HEIGHT - 6;
    const anchor = above >= 0 ? sel.first : sel.rect;
    const left = Math.max(0, Math.min(anchor.right - box.left, box.width - FLOAT_BUTTON_WIDTH));
    const top = above >= 0 ? above : sel.rect.bottom - box.top + 6;
    setFloating({ quote: sel.quote, left, top });
  }, [addIssueAvailable]);

  // The button goes away as soon as the selection collapses or leaves the
  // text; a selection made by touch handles or the keyboard (no mouseup)
  // shows it once the selection settles.
  useEffect(() => {
    if (!addIssueAvailable) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      if (timer) clearTimeout(timer);
      const s = window.getSelection();
      const wrap = textWrapRef.current;
      if (!s || s.isCollapsed || s.rangeCount === 0 || !wrap) {
        setFloating(null);
        return;
      }
      const r = s.getRangeAt(0);
      if (!wrap.contains(r.startContainer) || !wrap.contains(r.endContainer)) {
        setFloating(null);
        return;
      }
      timer = setTimeout(captureSelection, 250);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("selectionchange", onChange);
    };
  }, [addIssueAvailable, captureSelection]);

  // Keyboard selection (caret browsing, shift+arrows) ends on keyup.
  const onTextKeyUp = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.shiftKey || e.key === "Shift") captureSelection();
    },
    [captureSelection],
  );

  const openDialog = useCallback(
    (quote: string | null) => {
      const q = (quote ?? readAdSelection(textWrapRef.current)?.quote ?? "").trim();
      setFloating(null);
      setDialog({ quote: q, editable: q.length === 0 });
    },
    [],
  );

  const header = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="text-xs text-muted-foreground">
        {format === "text" && (channel ? `${channelLabel(channel)} · text` : "Text")}
        {format === "html" && "HTML creative"}
        {format === "pdf" && (version.content.filename || "PDF")}
        {format === "image" && (version.content.filename || "Image")}
      </div>
      <div className="flex items-center gap-2">
        {onEdit && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            data-edit-version
            disabled={editDisabledReason !== null}
            onClick={onEdit}
            title={editDisabledReason ?? "Edit the copy or replace the file; the change becomes the next version (E)"}
          >
            <Pencil data-icon="inline-start" />
            Edit
          </Button>
        )}
        {addIssueAvailable && (
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => openDialog(null)} title="Select words in the ad text, then add an issue for them">
            <Plus data-icon="inline-start" />
            Add issue
          </Button>
        )}
        {format !== "text" && (
          <Tabs value={view} onValueChange={(v) => onViewChange(v as CreativeViewMode)}>
            <TabsList className="h-7">
              <TabsTrigger value="preview" className="h-6 text-xs">
                Preview
              </TabsTrigger>
              <TabsTrigger value="text" className="h-6 text-xs">
                Text
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        {format === "pdf" && fileUrl && (
          <Button asChild size="sm" variant="outline">
            <a href={fileUrl} target="_blank" rel="noopener noreferrer">
              <FileText data-icon="inline-start" />
              Open PDF
              <ExternalLink data-icon="inline-end" className="size-3" />
            </a>
          </Button>
        )}
      </div>
    </div>
  );

  let body: React.ReactNode;
  if (view === "text" || format === "text") {
    if (format === "pdf") {
      // unpdf joins pages with a form feed when asked to; otherwise one block.
      const pages: { start: number; end: number }[] = [];
      let cursor = 0;
      for (const part of text.split("\f")) {
        pages.push({ start: cursor, end: cursor + part.length });
        cursor += part.length + 1;
      }
      body = text.trim() ? (
        <div className="space-y-3">
          {pages.map((p, i) => (
            <div key={i} className="rounded-xl border bg-card p-4 sm:p-6">
              {pages.length > 1 && <div className="mb-2 select-none text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Page {i + 1}</div>}
              <MarkedText text={text} marks={marks} selectedId={selectedId} onSelect={onSelect} from={p.start} to={p.end} className="text-sm" />
            </div>
          ))}
        </div>
      ) : (
        <NoTextNote kind="PDF" fileRead={fileRead} />
      );
    } else if (format === "image") {
      body = text.trim() ? (
        <div className="rounded-xl border bg-card p-4 sm:p-6">
          <div className="mb-2 select-none text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Text read from the image</div>
          <MarkedText text={text} marks={marks} selectedId={selectedId} onSelect={onSelect} className="text-sm" />
        </div>
      ) : (
        <NoTextNote kind="image" fileRead={fileRead} />
      );
    } else {
      body = <TextCard version={version} marks={marks} selectedId={selectedId} onSelect={onSelect} />;
    }
  } else if (format === "html") {
    body = version.content.html ? <HtmlPreview html={version.content.html} /> : <p className="text-sm text-muted-foreground">The HTML for this version is not available.</p>;
  } else if (format === "image") {
    body = fileUrl ? (
      <div className="overflow-hidden rounded-xl border bg-card">
        {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL from private storage */}
        <img src={fileUrl} alt={version.content.filename ? `Ad image: ${version.content.filename}` : "Ad image"} className="mx-auto max-h-[70vh] w-auto max-w-full" />
      </div>
    ) : (
      <div className="flex items-center gap-2 rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        <ImageIcon aria-hidden className="size-4" /> The image could not be loaded. Reload the page to get a fresh link.
      </div>
    );
  } else {
    // PDF preview: the browser's own viewer in a sandboxed frame; "Open PDF" for the full thing.
    body = fileUrl ? (
      <div className="overflow-hidden rounded-xl border bg-card">
        <iframe title="PDF preview" src={fileUrl} className="h-[70vh] w-full" />
      </div>
    ) : (
      <div className="flex items-center gap-2 rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        <FileText aria-hidden className="size-4" /> The PDF could not be loaded. Reload the page to get a fresh link.
      </div>
    );
  }

  return (
    <div ref={containerRef}>
      {header}
      {addIssueAvailable ? (
        <div ref={textWrapRef} className="relative" onMouseUp={captureSelection} onTouchEnd={captureSelection} onKeyUp={onTextKeyUp}>
          {body}
          {floating && (
            <Button
              type="button"
              size="sm"
              data-add-issue-floating
              className="absolute z-10 h-7 shadow-md"
              style={{ left: floating.left, top: floating.top }}
              // Keep the selection: a mousedown on the button must not collapse it.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => openDialog(floating.quote)}
            >
              <Plus data-icon="inline-start" />
              Add issue
            </Button>
          )}
        </div>
      ) : (
        body
      )}
      {addIssueAvailable && (
        <AddIssueDialog
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          assetVersionId={version.id}
          versionNo={version.versionNo}
          quote={dialog?.quote ?? ""}
          quoteEditable={dialog?.editable ?? false}
          rules={rulesInForce}
          onAdded={(id) => onIssueAdded?.(id)}
        />
      )}
    </div>
  );
}
