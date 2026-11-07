// Characterization tests for recheck (./recheck): pairing a new version's
// findings with the previous version's, and which dispositions carry forward.
// Run with: bun test src/features/analysis/recheck.test.ts
// @ts-expect-error -- bun:test types are not installed; Bun provides the module at test time.
import { describe, expect, test } from "bun:test";

import { RECHECK_SIMILARITY, matchPriorFindings, unmatchedPrior, type NewFinding, type PriorFinding } from "./recheck";
import { spanHash } from "./spans";

const prior = (id: string, over: Partial<PriorFinding> = {}): PriorFinding => {
  const quote = over.quote === undefined ? "Rates as low as 5.99% APR" : over.quote;
  return {
    id,
    rule_version_id: "rv-apr",
    rule_code: "OFFER-APR",
    span_hash: quote ? spanHash(quote) : null,
    quote,
    latest_disposition_id: `disp-${id}`,
    ...over,
  };
};

const finding = (over: Partial<NewFinding> = {}): NewFinding => ({
  rule_version_id: "rv-apr",
  rule_code: "OFFER-APR",
  quote: "Rates as low as 5.99% APR",
  ...over,
});

const NEW = { prior_finding_id: null, recheck_status: "new", carried_from_disposition_id: null };

describe("matchPriorFindings", () => {
  test("same rule and same words: still present, carrying the disposition", () => {
    expect(matchPriorFindings([finding({ quote: "  rates as LOW as 5.99% apr. " })], [prior("p1")])).toEqual([
      { prior_finding_id: "p1", recheck_status: "still_present", carried_from_disposition_id: "disp-p1" },
    ]);
  });

  test("same rule is the version id, or else the rule code (trimmed, any case)", () => {
    expect(matchPriorFindings([finding({ rule_version_id: "rv-apr-2", rule_code: " offer-apr " })], [prior("p1")])[0].recheck_status).toBe("still_present");
    expect(matchPriorFindings([finding({ rule_version_id: "rv-apr", rule_code: "OTHER" })], [prior("p1")])[0].recheck_status).toBe("still_present");
    expect(matchPriorFindings([finding({ rule_version_id: "rv-other", rule_code: "OTHER" })], [prior("p1")])).toEqual([NEW]);
    expect(matchPriorFindings([finding({ rule_version_id: null })], [prior("p1", { rule_version_id: null, rule_code: null })])).toEqual([NEW]);
  });

  test("lightly edited words under the same rule: re-anchored, nothing carried", () => {
    expect(matchPriorFindings([finding({ quote: "Rates as low as 5.99% APR today" })], [prior("p1")])).toEqual([
      { prior_finding_id: "p1", recheck_status: "re_anchored", carried_from_disposition_id: null },
    ]);
  });

  test("a rewrite below the similarity bar is new", () => {
    expect(RECHECK_SIMILARITY).toBe(0.8);
    expect(matchPriorFindings([finding({ quote: "Rates from 5.99% APR" })], [prior("p1")])).toEqual([NEW]);
  });

  test("a precomputed span hash is used instead of hashing the quote", () => {
    const f = finding({ quote: "completely different words", span_hash: spanHash("Rates as low as 5.99% APR") });
    expect(matchPriorFindings([f], [prior("p1")])[0].recheck_status).toBe("still_present");
  });

  test("a prior without a span hash can only re-anchor; one without a quote cannot match at all", () => {
    expect(matchPriorFindings([finding()], [prior("p1", { span_hash: null })])[0].recheck_status).toBe("re_anchored");
    expect(matchPriorFindings([finding()], [prior("p1", { quote: null })])).toEqual([NEW]);
  });

  test("each prior pairs with at most one new finding, in input order", () => {
    const matches = matchPriorFindings([finding(), finding()], [prior("p1")]);
    expect(matches.map((m) => [m.prior_finding_id, m.recheck_status])).toEqual([
      ["p1", "still_present"],
      [null, "new"],
    ]);
  });

  test("exact matches are taken before similar ones", () => {
    // The first finding is similar to p1, but the second is an exact match, so p1 goes to the second.
    const matches = matchPriorFindings([finding({ quote: "Rates as low as 5.99% APR today" }), finding()], [prior("p1")]);
    expect(matches.map((m) => [m.prior_finding_id, m.recheck_status])).toEqual([
      [null, "new"],
      ["p1", "still_present"],
    ]);
  });

  test("the most similar prior wins a re-anchor", () => {
    const priors = [prior("far", { quote: "Rates as low as 5.99% APR for all", span_hash: null }), prior("near", { quote: "Rates as low as 5.99% APR now", span_hash: null })];
    expect(matchPriorFindings([finding({ quote: "Rates as low as 5.99% APR today" })], priors)[0].prior_finding_id).toBe("near");
  });

  test("re-anchoring is greedy in input order, not a best overall assignment", () => {
    const priors = [prior("a", { quote: "Apply online in minutes", span_hash: null }), prior("b", { quote: "Apply online in minutes today", span_hash: null })];
    // The first finding is close to both and takes b; the second only clears the bar against b, so it is new
    // (pairing first->a, second->b would have matched both).
    const matches = matchPriorFindings([finding({ quote: "Apply online in minutes today!!" }), finding({ quote: "Apply online in minutes today, it is free" })], priors);
    expect(matches.map((m) => [m.prior_finding_id, m.recheck_status])).toEqual([
      ["b", "re_anchored"],
      [null, "new"],
    ]);
  });
});

describe("unmatchedPrior", () => {
  test("prior findings no new finding claimed, in their original order", () => {
    const priors = [prior("p1"), prior("p2", { quote: "No annual fee" }), prior("p3", { quote: "Borrow up to $50,000" })];
    const matches = matchPriorFindings([finding({ quote: "Borrow up to $50,000" })], priors);
    expect(unmatchedPrior(priors, matches).map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(unmatchedPrior(priors, []).map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });
});
