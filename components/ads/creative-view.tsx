"use client";

import { ExternalLink, FileText, Image as ImageIcon } from "lucide-react";
import { cn } from "cn";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AdFinding, AdVersion } from "@/lib/data/ads";

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
    <p className={cn("whitespace-pre-wrap break-words leading-relaxed", className)}>
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
        return (
          <section key={r.id} className={cn("px-4 py-3 sm:px-6", i > 0 && "border-t")}>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{r.label}</div>
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

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data: https:; form-action 'none'; base-uri 'none'">`;

function withCsp(html: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${CSP}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${CSP}</head>`);
  return `<!doctype html><html><head>${CSP}</head><body>${html}</body></html>`;
}

function HtmlPreview({ html }: { html: string }) {
  const [tall, setTall] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <iframe
        title="Ad preview (sandboxed)"
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={withCsp(html)}
        className={cn("w-full bg-white transition-[height]", tall ? "h-[1400px]" : "h-[560px]")}
      />
      <div className="flex items-center justify-between border-t px-3 py-1.5 text-xs text-muted-foreground">
        <span>Rendered in a sandbox: no scripts, no network, no forms.</span>
        <button type="button" className="underline underline-offset-4 hover:text-foreground" onClick={() => setTall((t) => !t)}>
          {tall ? "Shorter" : "Taller"}
        </button>
      </div>
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

export function CreativeView({
  version,
  findings,
  fileUrl,
  selectedId,
  onSelect,
  channel,
  view,
  onViewChange,
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
}) {
  const format = version.content.format;
  const text = version.extractedText || version.content.text || "";
  const marks = useMemo(() => marksFor(findings, text), [findings, text]);
  const containerRef = useRef<HTMLDivElement>(null);
  const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Selecting an issue: scroll its words into view (DOM only).
  useEffect(() => {
    if (!selectedId) return;
    const t = setTimeout(() => {
      const el = containerRef.current?.querySelector<HTMLElement>(`mark[data-finding-id="${selectedId}"]`);
      el?.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    }, 30);
    return () => clearTimeout(t);
  }, [selectedId, view, reduceMotion]);

  const header = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="text-xs text-muted-foreground">
        {format === "text" && (channel ? `${channelLabel(channel)} · text` : "Text")}
        {format === "html" && "HTML creative"}
        {format === "pdf" && (version.content.filename || "PDF")}
        {format === "image" && (version.content.filename || "Image")}
      </div>
      <div className="flex items-center gap-2">
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
              {pages.length > 1 && <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Page {i + 1}</div>}
              <MarkedText text={text} marks={marks} selectedId={selectedId} onSelect={onSelect} from={p.start} to={p.end} className="text-sm" />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No text could be extracted from this PDF, so issues were found by reading it as an image.</p>
      );
    } else if (format === "image") {
      body = text.trim() ? (
        <div className="rounded-xl border bg-card p-4 sm:p-6">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Text read from the image</div>
          <MarkedText text={text} marks={marks} selectedId={selectedId} onSelect={onSelect} className="text-sm" />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No text was read from this image.</p>
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
      {body}
    </div>
  );
}
