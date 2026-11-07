import { sha256Hex } from "@/lib/intake/hash";
import type { FindingAnchor } from "@/lib/types/ads";

/**
 * Locating quoted spans in extracted text, tolerant of the small
 * differences a model introduces (smart quotes, whitespace, case, trailing
 * punctuation). A quote that cannot be found verbatim-ish is "unverifiable":
 * the finding is kept but marked verified_span = false.
 */

const QUOTE_MAP: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "‟": '"',
  "′": "'",
  "″": '"',
  "–": "-",
  "—": "-",
  "−": "-",
  " ": " ",
  "…": "...",
};

const ZERO_WIDTH = /[​-‍⁠﻿­]/;

type Normalized = { text: string; map: number[] };

/**
 * Normalizes a string for matching and keeps, for every normalized
 * character, the index of the original character it came from.
 */
function normalizeWithMap(input: string): Normalized {
  let out = "";
  const map: number[] = [];
  let lastWasSpace = true; // trims leading whitespace
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ZERO_WIDTH.test(ch)) continue;
    const mapped = QUOTE_MAP[ch] ?? ch;
    if (/\s/.test(mapped)) {
      if (lastWasSpace) continue;
      out += " ";
      map.push(i);
      lastWasSpace = true;
      continue;
    }
    for (const c of mapped.toLowerCase()) {
      out += c;
      map.push(i);
    }
    lastWasSpace = false;
  }
  // trim trailing space
  if (out.endsWith(" ")) {
    out = out.slice(0, -1);
    map.pop();
  }
  return { text: out, map };
}

/** Normalized form used for span hashes and similarity (no index map). */
export function normalizeForMatch(input: string): string {
  return normalizeWithMap(input).text.replace(/[.,;:!?]+$/g, "").trim();
}

/** sha256 of the normalized quote, for matching findings across versions. */
export function spanHash(quote: string): string {
  return sha256Hex(normalizeForMatch(quote));
}

function stripWrappingQuotes(s: string): string {
  return s.replace(/^["'“”‘’«»\s]+/, "").replace(/["'“”‘’«»\s]+$/, "");
}

/**
 * Finds `quote` inside `text`. Returns character offsets into the ORIGINAL
 * text, or null when the quote cannot be located.
 */
export function locateQuote(text: string, quote: string): FindingAnchor | null {
  if (!text || !quote) return null;
  const hay = normalizeWithMap(text);
  if (!hay.text) return null;

  const candidates = [quote, stripWrappingQuotes(quote), stripWrappingQuotes(quote).replace(/[.,;:!?…]+$/g, "")];
  for (const candidate of candidates) {
    const needle = normalizeWithMap(candidate).text.replace(/[.,;:!?]+$/g, "").trim();
    if (needle.length < 2) continue;
    const idx = hay.text.indexOf(needle);
    if (idx >= 0) {
      const start = hay.map[idx];
      const end = hay.map[idx + needle.length - 1] + 1;
      return { start, end };
    }
  }
  return null;
}

/**
 * Similarity (0..1) between two quotes: the better of word-level Dice and a
 * character-level longest-common-subsequence ratio, so light edits (a word
 * added or dropped, punctuation) still score high while rewrites do not.
 * Used by recheck to pair a re-worded finding with its predecessor.
 */
export function similarity(a: string, b: string): number {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokens(na);
  const tb = tokens(nb);
  let dice = 0;
  if (ta.length && tb.length) {
    const sb = new Map<string, number>();
    for (const t of tb) sb.set(t, (sb.get(t) ?? 0) + 1);
    let inter = 0;
    for (const t of ta) {
      const n = sb.get(t) ?? 0;
      if (n > 0) {
        inter++;
        sb.set(t, n - 1);
      }
    }
    dice = (2 * inter) / (ta.length + tb.length);
  }
  const lcs = na.length * nb.length <= 250_000 ? (2 * lcsLength(na, nb)) / (na.length + nb.length) : 0;
  return Math.max(dice, lcs);
}

function tokens(s: string): string[] {
  return s.split(/[^a-z0-9%$.]+/).filter(Boolean);
}

function lcsLength(a: string, b: string): number {
  let prev = new Uint16Array(b.length + 1);
  let cur = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}
