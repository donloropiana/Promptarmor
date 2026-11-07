"use client";

import { cn } from "cn";
import { useMemo } from "react";

import type { AdFinding } from "@/features/ads/server/queries/detail";

/**
 * Highlighted ad text: which words each issue quotes (its anchor, or a search
 * for its quote) and how nested or overlapping quotes render as clickable
 * <mark>s. Every text view draws its words through MarkedText.
 */

export type Mark = { id: string; start: number; end: number; severity: AdFinding["severity"] };

/** Anchors from findings, with a quote-search fallback for unanchored ones. Merged and sorted. */
export function marksFor(findings: AdFinding[], text: string): Mark[] {
  const marks: Mark[] = [];
  const lower = text.toLowerCase();
  for (const f of findings) {
    if (!f.open && f.disposition?.disposition !== "accepted_exception") continue;
    // An image note's "quote" is a label, not words from the ad: it is drawn as a pin, never as a mark.
    if (f.imageAnchor) continue;
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

export function MarkedText({
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
