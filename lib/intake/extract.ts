/**
 * Text extraction for intake: PDF (unpdf), HTML (tag stripping that keeps
 * line breaks) and plain text, all producing the same section model.
 *
 * `extracted_text` on a version is the sections' text joined by a blank
 * line; finding anchors are offsets into that string. Keep joinSections and
 * sectionAtOffset in sync.
 *
 * Everything here treats its input as untrusted content: nothing is
 * executed or rendered.
 */

import { htmlToText } from "@/lib/connectors/content";

export type Section = { id: string; label: string; text: string };

export type ExtractedDocument = {
  sections: Section[];
  /** Sections joined by a blank line: what gets stored as extracted_text. */
  text: string;
  /** PDF page count, when known. */
  pages?: number;
};

const SECTION_SEPARATOR = "\n\n";

/** Longest text we keep per version (characters). Ads are short; this is a safety cap. */
export const MAX_EXTRACTED_CHARS = 60_000;

const DISCLOSURE_STRONG_RE =
  /^\s*[*†‡]|\b(subject to|terms (and|&) conditions|terms apply|disclos|equal housing|nmls|member fdic|fdic|see (full )?terms|not all applicants|credit approval|offer (ends|expires|valid)|restrictions apply|representative example|unsubscribe|privacy policy|all rights reserved)\b/i;
const DISCLOSURE_WEAK_RE = /\b(apr|annual percentage rate|rates? (are |may )?(vary|as of|subject)|based on (your )?credit)/i;

const SUBJECT_RE = /^(subject|preheader|pre-header|from|to)\s*:/i;

function cleanWhitespace(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function labelFor(index: number, text: string, total: number): string {
  if (SUBJECT_RE.test(text)) return text.split(":")[0].trim().replace(/^\w/, (c) => c.toUpperCase());
  // One paragraph is the whole ad, not a disclosure block.
  if (total === 1) return "Body";
  if (index === 0 && text.length <= 120 && !/\n/.test(text)) return "Headline";
  const inLatterHalf = index >= Math.floor(total / 2);
  if (DISCLOSURE_STRONG_RE.test(text)) return "Disclosure";
  if (DISCLOSURE_WEAK_RE.test(text) && inLatterHalf && text.length > 120) return "Disclosure";
  return "Body";
}

/**
 * Splits text on blank lines into sections p1..pn. Email-like text (Subject:
 * lines) keeps each header line as its own section.
 */
export function sectionsFromText(raw: string): Section[] {
  const text = cleanWhitespace(raw).slice(0, MAX_EXTRACTED_CHARS);
  if (!text) return [];
  const paragraphs: string[] = [];
  for (const chunk of text.split(/\n\s*\n/)) {
    const c = chunk.trim();
    if (!c) continue;
    // Header lines (Subject: ...) at the top of an email become their own sections.
    const lines = c.split("\n");
    if (lines.length > 1 && SUBJECT_RE.test(lines[0])) {
      let i = 0;
      while (i < lines.length && SUBJECT_RE.test(lines[i])) {
        paragraphs.push(lines[i].trim());
        i++;
      }
      const rest = lines.slice(i).join("\n").trim();
      if (rest) paragraphs.push(rest);
    } else {
      paragraphs.push(c);
    }
  }
  return paragraphs.map((p, i) => ({ id: `p${i + 1}`, label: labelFor(i, p, paragraphs.length), text: p }));
}

/**
 * HTML creative -> sections. htmlToText ends every block element with a
 * single newline, so lines are regrouped into paragraphs: a blank line, a
 * heading-like line (short, no end punctuation) or ~300 characters start a
 * new section. Hidden text is kept (the security scan finds it).
 */
export function sectionsFromHtml(html: string): Section[] {
  const text = cleanWhitespace(htmlToText(html));
  if (!text) return [];
  if (/\n\s*\n/.test(text)) return sectionsFromText(text);
  const lines = text.split("\n");
  const paragraphs: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const joined = current.join("\n").trim();
    if (joined) paragraphs.push(joined);
    current = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
      continue;
    }
    const headingLike = line.length <= 80 && !/[.!?:;,]$/.test(line) && (i + 1 < lines.length ? lines[i + 1].length > line.length : false);
    if (headingLike && current.length > 0) flush();
    current.push(line);
    const size = current.join("\n").length;
    if (headingLike || size > 300 || /[.!?]$/.test(line) && size > 160) flush();
  }
  flush();
  return paragraphs.map((p, i) => ({ id: `p${i + 1}`, label: labelFor(i, p, paragraphs.length), text: p }));
}

/** PDF -> one section per page, using unpdf (serverless PDF.js build). */
export async function extractPdf(bytes: Uint8Array): Promise<ExtractedDocument> {
  const { extractText } = await import("unpdf");
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const result = await extractText(copy, { mergePages: false });
  const pages = result.totalPages;
  const sections: Section[] = [];
  result.text.forEach((pageText, i) => {
    const t = cleanWhitespace(pageText);
    if (!t) return;
    sections.push({ id: `page${i + 1}`, label: `Page ${i + 1}`, text: t });
  });
  const text = joinSections(sections).slice(0, MAX_EXTRACTED_CHARS);
  return { sections, text, pages };
}

/** The exact string stored as extracted_text (anchors point into it). */
export function joinSections(sections: Section[]): string {
  return sections.map((s) => s.text).join(SECTION_SEPARATOR);
}

/** Section id that contains character `offset` of joinSections(sections). */
export function sectionAtOffset(sections: Section[], offset: number): string | undefined {
  let pos = 0;
  for (const s of sections) {
    const end = pos + s.text.length;
    if (offset >= pos && offset < end) return s.id;
    pos = end + SECTION_SEPARATOR.length;
  }
  return sections.length ? sections[sections.length - 1].id : undefined;
}

export function extractFromText(text: string): ExtractedDocument {
  const sections = sectionsFromText(text);
  return { sections, text: joinSections(sections) };
}

export function extractFromHtml(html: string): ExtractedDocument {
  const sections = sectionsFromHtml(html);
  return { sections, text: joinSections(sections) };
}
