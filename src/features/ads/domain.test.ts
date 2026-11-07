// Run with: bun test src/features/ads/domain.test.ts
// @ts-expect-error -- bun:test types are not installed; Bun provides the module at test time.
import { describe, expect, test } from "bun:test";

import { asProduct, isProductType, productLabel } from "@/features/products/catalog";

import { adTags, isNotScreened, rankAd, type AdRankInput, type AdTagInput } from "./domain";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const ad = (over: Partial<AdRankInput>): AdRankInput => ({
  hiddenText: false,
  openCritical: 0,
  openMajor: 0,
  openMinor: 0,
  submittedAt: "2026-11-07T10:00:00Z",
  ...over,
});

describe("rankAd", () => {
  test("worst first: hidden text, then critical, major, minor", () => {
    const ranks = [ad({ hiddenText: true }), ad({ openCritical: 1 }), ad({ openMajor: 1 }), ad({ openMinor: 1 }), ad({})].map((a) => rankAd(a, NOW));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  test("an open minor issue outranks a clean ad, whatever their ages", () => {
    expect(rankAd(ad({ openMinor: 1, submittedAt: "2026-11-07T11:59:00Z" }), NOW)).toBeLessThan(rankAd(ad({ submittedAt: "2026-01-01T00:00:00Z" }), NOW));
  });

  test("older first among equals", () => {
    expect(rankAd(ad({ openMajor: 2, submittedAt: "2026-11-01T00:00:00Z" }), NOW)).toBeLessThan(rankAd(ad({ openMajor: 1 }), NOW));
  });
});

const tagInput = (over: Partial<AdTagInput>): AdTagInput => ({
  status: "needs_review",
  versionNo: 1,
  hasDecisions: false,
  hiddenText: false,
  changedAfterApproval: false,
  notScreened: false,
  isSample: false,
  reReviewReason: null,
  ...over,
});

describe("adTags", () => {
  test("in display order", () => {
    expect(
      adTags(tagInput({ isSample: true, hiddenText: true, status: "re_review_due", reReviewReason: { kind: "expired" }, changedAfterApproval: true, notScreened: true, versionNo: 3 })),
    ).toEqual(["Sample", "Hidden text", "Expired", "Changed after approval", "Not AI-screened", "V3"]);
  });

  test("New and V<n> only while the ad waits for a decision", () => {
    expect(adTags(tagInput({}))).toEqual(["New"]);
    expect(adTags(tagInput({ hasDecisions: true }))).toEqual([]);
    expect(adTags(tagInput({ status: "changes_requested", versionNo: 2 }))).toEqual(["V2"]);
    expect(adTags(tagInput({ status: "rejected", versionNo: 2, hasDecisions: true }))).toEqual([]);
    expect(adTags(tagInput({ status: "withdrawn" }))).toEqual([]);
    expect(adTags(tagInput({ status: "approved_with_exceptions", versionNo: 2, hasDecisions: true }))).toEqual(["With exceptions"]);
  });

  test("re-review reason defaults to rates changed", () => {
    expect(adTags(tagInput({ status: "re_review_due", reReviewReason: { kind: "offer_changed" }, hasDecisions: true }))).toEqual(["Rates changed"]);
  });
});

describe("isNotScreened", () => {
  test("only an ad waiting on a person whose latest check did not complete", () => {
    expect(isNotScreened("needs_manual_review", "failed")).toBe(true);
    expect(isNotScreened("needs_manual_review", null)).toBe(true);
    expect(isNotScreened("needs_manual_review", "complete")).toBe(false);
    expect(isNotScreened("approved", "failed")).toBe(false);
  });
});

describe("product catalog", () => {
  test("parses stored values without trusting prototype keys", () => {
    expect(asProduct("mortgage")).toBe("mortgage");
    expect(asProduct("constructor")).toBe("unknown");
    expect(asProduct(null)).toBe("unknown");
    expect(productLabel("toString")).toBe("Unknown product");
  });

  test("selectable products exclude unknown", () => {
    expect(isProductType("other")).toBe(true);
    expect(isProductType("unknown")).toBe(false);
  });
});
