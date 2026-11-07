// Characterization tests for quote location (./spans): finding a model's
// quote in extracted text despite small differences, span hashes, and the
// similarity score recheck uses.
// Run with: bun test src/features/analysis/spans.test.ts
// @ts-expect-error -- bun:test types are not installed; Bun provides the module at test time.
import { describe, expect, test } from "bun:test";

import { locateQuote, normalizeForMatch, similarity, spanHash } from "./spans";

const TEXT = "Get a loan at 5.99% APR.  Rates vary.\nApply today — it’s “easy”!";

/** The original characters an anchor points at. */
function found(text: string, quote: string): string | null {
  const anchor = locateQuote(text, quote);
  return anchor ? text.slice(anchor.start, anchor.end) : null;
}

describe("locateQuote", () => {
  test("returns offsets into the original text", () => {
    expect(locateQuote(TEXT, "5.99% APR")).toEqual({ start: 14, end: 23 });
    expect(found(TEXT, "5.99% APR")).toBe("5.99% APR");
  });

  test("ignores case and runs of whitespace (newlines included)", () => {
    expect(found(TEXT, "rates   VARY")).toBe("Rates vary");
    expect(found(TEXT, "vary. apply")).toBe("vary.\nApply");
  });

  test("maps smart quotes and dashes to plain ones", () => {
    expect(found(TEXT, "it's \"easy\"")).toBe("it’s “easy”");
    expect(found(TEXT, "Apply today - it's")).toBe("Apply today — it’s");
  });

  test("drops wrapping quotes and trailing punctuation from the quote; the anchor stops before it", () => {
    expect(found(TEXT, "\"Rates vary.\"")).toBe("Rates vary");
    expect(found(TEXT, "5.99% apr.")).toBe("5.99% APR");
    expect(found("Hi there!!!", "there!!!")).toBe("there");
    expect(found("Hi there…", "there…")).toBe("there");
  });

  test("skips zero-width characters and soft hyphens, spanning them in the original", () => {
    expect(locateQuote("ab​cd efg", "abcd")).toEqual({ start: 0, end: 5 });
    expect(locateQuote("ab­cd efg", "abcd")).toEqual({ start: 0, end: 5 });
  });

  test("treats a no-break space as a space and an ellipsis as three dots", () => {
    expect(locateQuote("Hello world", "hello world")).toEqual({ start: 0, end: 11 });
    expect(locateQuote("x … y", "x ... y")).toEqual({ start: 0, end: 5 });
  });

  test("anchors the first occurrence", () => {
    expect(locateQuote("ok 55 here 55", "55")).toEqual({ start: 3, end: 5 });
  });

  test("null when the quote is absent, empty, or under two characters", () => {
    expect(locateQuote(TEXT, "not there")).toBeNull();
    expect(locateQuote(TEXT, "Apply today -- it's")).toBeNull();
    expect(locateQuote(TEXT, "")).toBeNull();
    expect(locateQuote("", "Rates")).toBeNull();
    expect(locateQuote("   ", "ab")).toBeNull();
    expect(locateQuote("first 5 then 5", "5")).toBeNull();
    expect(locateQuote(TEXT, "“A”")).toBeNull();
  });
});

describe("normalizeForMatch and spanHash", () => {
  test("normalizes case, whitespace, smart quotes and trailing punctuation", () => {
    expect(normalizeForMatch("  “Hello”,   World!!  ")).toBe('"hello", world');
    expect(normalizeForMatch("A​—B…")).toBe("a-b");
  });

  test("the hash is the sha256 hex of the normalized quote, so light differences share it", () => {
    expect(spanHash("Hello world")).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
    expect(spanHash("  hello   WORLD. ")).toBe(spanHash("Hello world"));
    expect(spanHash("Hello there")).not.toBe(spanHash("Hello world"));
  });
});

describe("similarity", () => {
  test("1 for the same words after normalization", () => {
    expect(similarity("Rates from 5.99% APR", "Rates from 5.99% APR")).toBe(1);
    expect(similarity("Rates from 5.99% APR", "rates from 5.99% apr!")).toBe(1);
  });

  test("a word added keeps the score above the recheck bar; a rewrite falls well below", () => {
    expect(similarity("Get approved in minutes", "Get approved in just minutes")).toBeCloseTo(0.902, 3);
    expect(similarity("Rates from 5.99% APR", "Rates as low as 5.99% APR")).toBeCloseTo(0.756, 3);
    expect(similarity("Rates from 5.99% APR", "No annual fee ever")).toBeCloseTo(0.263, 3);
  });

  test("the better of word overlap (order-free) and character LCS", () => {
    expect(similarity("a b", "b a")).toBe(1);
    expect(similarity("abc", "abd")).toBeCloseTo(2 / 3, 10);
  });

  test("0 when either side is empty after normalization", () => {
    expect(similarity("", "x")).toBe(0);
    expect(similarity("...", "x")).toBe(0);
  });

  test("past the LCS size budget only word overlap counts", () => {
    // 600 x 500 characters exceeds the 250,000-cell budget; one token each, and they differ.
    expect(similarity("x".repeat(600), "x".repeat(500))).toBe(0);
    expect(similarity("x".repeat(400), "x".repeat(500))).toBeCloseTo(800 / 900, 10);
  });
});
