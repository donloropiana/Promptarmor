"use client";

import { cn } from "cn";
import { useMemo } from "react";

import type { AdVersion } from "@/features/ads/server/queries/detail";

import { MarkedText, type Mark } from "./marked-text";

/**
 * The Text view of a creative: a text ad as a card with its sections, a PDF's
 * text page by page, the words read from an image, and what an empty text view
 * means for a file nobody could read.
 */

/**
 * For a PDF or image with no text layer: whether a model read it as an
 * image ("transcribed"), nothing read it ("unread"), or the check has not
 * finished ("unknown").
 */
export type FileRead = "transcribed" | "unread" | "unknown";

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

/** What an empty text view means, said honestly: who (if anyone) read the file. */
function NoTextNote({ kind, fileRead }: { kind: "PDF" | "image"; fileRead: FileRead }) {
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

/** The version's words with the issues' quotes marked, laid out for its format. */
export function TextView({
  version,
  text,
  marks,
  selectedId,
  onSelect,
  fileRead,
}: {
  version: AdVersion;
  /** The version's text (extracted text, else the copy), as the marks were computed against. */
  text: string;
  marks: Mark[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  fileRead: FileRead;
}) {
  const format = version.content.format;
  if (format === "pdf") {
    // unpdf joins pages with a form feed when asked to; otherwise one block.
    const pages: { start: number; end: number }[] = [];
    let cursor = 0;
    for (const part of text.split("\f")) {
      pages.push({ start: cursor, end: cursor + part.length });
      cursor += part.length + 1;
    }
    return text.trim() ? (
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
  }
  if (format === "image") {
    return text.trim() ? (
      <div className="rounded-xl border bg-card p-4 sm:p-6">
        <div className="mb-2 select-none text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Text read from the image</div>
        <MarkedText text={text} marks={marks} selectedId={selectedId} onSelect={onSelect} className="text-sm" />
      </div>
    ) : (
      <NoTextNote kind="image" fileRead={fileRead} />
    );
  }
  return <TextCard version={version} marks={marks} selectedId={selectedId} onSelect={onSelect} />;
}
