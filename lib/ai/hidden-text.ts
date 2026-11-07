import { decodeEntities } from "@/lib/connectors/content";

import type { HiddenTextCandidate } from "./schema";

/**
 * Deterministic detection of hidden text and instruction-like text in ads.
 *
 * Two inputs: the raw HTML (styling tricks: tiny fonts, white-on-white,
 * opacity 0, display none, off-screen, aria-hidden, comments) and the plain
 * text (prompt-injection phrasing, zero-width characters, mixed scripts).
 * Results become security_alerts rows; the check still runs on the rest of
 * the ad, and nothing found here can change what the engine does.
 */

export const MAX_EXCERPT = 300;

const INSTRUCTION_PATTERNS: RegExp[] = [
  /\bignore (all |any |the |your )?(previous|prior|above|earlier|preceding|other|these|those)? ?(instructions?|rules?|guidance|guidelines|directions?|prompts?)\b/i,
  /\bdisregard (all |any |the |your )?(previous|prior|above|earlier)? ?(instructions?|rules?|guidance|findings?|checks?)\b/i,
  /\b(as an? ai|dear ai|dear (model|reviewer|assistant)|hey (ai|assistant|claude|chatgpt|gpt|model)|attention:? ?(ai|reviewer|model|assistant)|to the (ai|model|reviewer|assistant|language model|llm|system))\b/i,
  /\b(ai|automated|llm|language model|model|assistant|system) (reviewers?|instructions?|note|notice|directive)\b/i,
  /\b(approve|pass|clear|accept) (this|the) (ad|advert(isement)?|asset|content|creative|copy|email|post|page)\b/i,
  /\bsystem prompt\b/i,
  /\bmark (this |it |the ad )?(as )?(compliant|approved|passing|clean|safe|ok)\b/i,
  /\b(report|return|output|respond with|say)( that there are)? (no|zero) (issues|findings|problems|violations)\b/i,
  /\bno (issues|findings|violations) (should be|must be|are to be) (reported|returned|found)\b/i,
  /\byou are (now )?(a|an|the) \w+ (assistant|reviewer|model|ai)\b/i,
  /\b(this (ad|content) (has been|is|was) (pre-?approved|approved|reviewed|cleared) by (compliance|legal|the reviewer))\b/i,
  /<\|?(im_start|im_end|system|endoftext)\|?>/i,
  /\[\s*(system|assistant|instruction|inst)\s*\]/i,
  /^\s*#{1,4}\s*(system|instructions?|assistant)\b/im,
  /\boverride\b.{0,40}\b(rules?|checks?|review|compliance)\b/i,
];

const ZERO_WIDTH_RE = /[​-‍⁠﻿]/g;

/** Latin word containing Cyrillic/Greek lookalikes, or the reverse. */
const MIXED_SCRIPT_RE = /\b(?=[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]*[\p{Script=Cyrillic}\p{Script=Greek}])(?=[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]*\p{Script=Latin})[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]{3,}\b/gu;

function clipExcerpt(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > MAX_EXCERPT ? `${t.slice(0, MAX_EXCERPT - 1)}…` : t;
}

export function looksLikeInstruction(text: string): boolean {
  return INSTRUCTION_PATTERNS.some((re) => re.test(text));
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const HIDDEN_STYLE_CHECKS: { label: string; re: RegExp }[] = [
  { label: "font-size 0-2px", re: /font-size\s*:\s*(0|0?\.\d+|1|2)(\.\d+)?\s*(px|pt)?\s*(;|$|!)/i },
  { label: "font-size near zero", re: /font-size\s*:\s*0?\.(0|1)\d*\s*(em|rem)\b/i },
  { label: "opacity 0", re: /opacity\s*:\s*0?(\.0+)?\s*(;|$|!)/i },
  { label: "display none", re: /display\s*:\s*none\b/i },
  { label: "visibility hidden", re: /visibility\s*:\s*hidden\b/i },
  { label: "off-screen", re: /(left|top|right|bottom|text-indent)\s*:\s*-\s*(9{3,}|[1-9]\d{3,})\s*(px|em|%)/i },
  { label: "zero size", re: /(height|width|max-height|max-width)\s*:\s*0\s*(px|em|rem)?\s*(;|$|!)/i },
  { label: "clip", re: /clip\s*:\s*rect\s*\(\s*0/i },
  { label: "color transparent", re: /\bcolor\s*:\s*transparent\b/i },
  { label: "color rgba alpha 0", re: /\bcolor\s*:\s*rgba\([^)]*,\s*0(\.0+)?\s*\)/i },
];

const WHITE_COLOR_RE = /(^|[^-\w])color\s*:\s*(#fff(fff)?|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)|#fefefe|#fdfdfd|#f8f8f8|#f9f9f9|#fafafa)\b/i;
const DARK_BACKGROUND_RE = /background(-color)?\s*:\s*(#(0|1|2|3)[0-9a-f]{2,5}|black|rgb\(\s*(\d|[1-5]\d)\s*,\s*(\d|[1-5]\d)\s*,\s*(\d|[1-5]\d)\s*\)|#[0-9a-f]{3}\b)/i;

function styleHiddenReason(style: string): string | null {
  for (const c of HIDDEN_STYLE_CHECKS) if (c.re.test(style)) return c.label;
  if (WHITE_COLOR_RE.test(style) && !DARK_BACKGROUND_RE.test(style)) return "white text";
  return null;
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

const TAG_RE = /<(span|div|p|font|small|b|i|em|strong|u|td|li|section|footer|header|a|h[1-6]|sup|sub|label|pre)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;

/**
 * Hidden passages in HTML creative. Nested elements with the same tag can
 * truncate the inner match; the excerpt is still the hidden element's text.
 */
export function detectHiddenHtml(html: string): HiddenTextCandidate[] {
  const out: HiddenTextCandidate[] = [];
  if (!html) return out;

  // Elements styled to be invisible or unreadable.
  for (const m of html.matchAll(TAG_RE)) {
    const [whole, tag, attrs, inner] = m;
    const at = m.index ?? 0;
    const style = /style\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
    const styleText = style ? (style[2] ?? style[3] ?? "") : "";
    const hiddenAttr = /\bhidden\b(?!\s*=\s*["']?false)/i.test(attrs) || /aria-hidden\s*=\s*["']?true/i.test(attrs);
    const reason = hiddenAttr ? "aria-hidden / hidden attribute" : styleHiddenReason(styleText);
    if (!reason) continue;
    const text = stripTags(inner);
    if (text.length < 4) continue;
    // An email preheader (hidden preview line) with ordinary copy is not hidden text.
    if (/preheader|pre-header|preview-text|previewtext/i.test(attrs) && !looksLikeInstruction(text)) continue;
    out.push({
      excerpt: clipExcerpt(text),
      location: `html:${tag.toLowerCase()}@char ${at} (${reason})`,
      kind: looksLikeInstruction(text) ? "possible_injection" : "hidden_text",
    });
    if (whole.length > 20_000) break;
  }

  // HTML comments that read like instructions.
  for (const m of html.matchAll(/<!--([\s\S]*?)-->/g)) {
    const text = m[1].replace(/\s+/g, " ").trim();
    if (text.length < 8) continue;
    if (looksLikeInstruction(text)) {
      out.push({ excerpt: clipExcerpt(text), location: `html:comment@char ${m.index ?? 0}`, kind: "possible_injection" });
    }
  }

  // Alt text / title attributes carrying instructions (never visible).
  for (const m of html.matchAll(/\b(alt|title|aria-label|data-[\w-]+)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const text = decodeEntities(m[3] ?? m[4] ?? "");
    if (looksLikeInstruction(text)) {
      out.push({ excerpt: clipExcerpt(text), location: `html:${m[1].toLowerCase()}@char ${m.index ?? 0}`, kind: "possible_injection" });
    }
  }

  return dedupe(out);
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

/** Instruction-like passages, zero-width characters and mixed scripts in plain text. */
export function detectHiddenInText(text: string): HiddenTextCandidate[] {
  const out: HiddenTextCandidate[] = [];
  if (!text) return out;

  // Instruction-like sentences: scan paragraph by paragraph, then sentence by sentence.
  let offset = 0;
  for (const para of text.split(/\n\s*\n/)) {
    const paraStart = text.indexOf(para, offset);
    offset = paraStart + para.length;
    const sentences = para.split(/(?<=[.!?])\s+(?=[A-Z("'“])/);
    let sentOffset = paraStart;
    for (const sentence of sentences) {
      const at = text.indexOf(sentence, sentOffset);
      sentOffset = at + sentence.length;
      if (looksLikeInstruction(sentence)) {
        out.push({
          excerpt: clipExcerpt(sentence),
          location: `text:line ${lineOf(text, at)}`,
          kind: "possible_injection",
        });
      }
    }
  }

  // Zero-width characters (used to hide words or break pattern matching).
  const zw = text.match(ZERO_WIDTH_RE);
  if (zw && zw.length >= 3) {
    const first = text.search(ZERO_WIDTH_RE);
    const around = text.slice(Math.max(0, first - 60), first + 120).replace(ZERO_WIDTH_RE, "");
    out.push({
      excerpt: clipExcerpt(`${zw.length} zero-width characters near: ${around}`),
      location: `text:line ${lineOf(text, first)}`,
      kind: "hidden_text",
    });
  }

  // Mixed-script words (Latin with Cyrillic/Greek lookalikes).
  const mixed = Array.from(text.matchAll(MIXED_SCRIPT_RE)).map((m) => m[0]);
  if (mixed.length > 0) {
    const first = text.search(MIXED_SCRIPT_RE);
    out.push({
      excerpt: clipExcerpt(`Lookalike characters in: ${Array.from(new Set(mixed)).slice(0, 8).join(", ")}`),
      location: `text:line ${lineOf(text, Math.max(0, first))}`,
      kind: "hidden_text",
    });
  }

  return dedupe(out);
}

export function detectHiddenText(input: { html?: string | null; text?: string | null }): HiddenTextCandidate[] {
  return dedupe([...detectHiddenHtml(input.html ?? ""), ...detectHiddenInText(input.text ?? "")]);
}

function dedupe(items: HiddenTextCandidate[]): HiddenTextCandidate[] {
  const seen = new Set<string>();
  const out: HiddenTextCandidate[] = [];
  for (const it of items) {
    const key = it.excerpt.toLowerCase().replace(/\W+/g, " ").trim().slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}
