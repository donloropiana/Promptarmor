// Characterization tests for the deterministic offer checks (./offer-checks):
// which numbers an ad's text yields, which of them contradict the product
// terms on file, and which rule a mismatch cites.
// Run with: bun test src/features/analysis/offer-checks.test.ts
// @ts-expect-error -- bun:test types are not installed; Bun provides the module at test time.
import { describe, expect, test } from "bun:test";

import type { Product } from "@/features/products/catalog";

import { OFFER_RULE_FALLBACK, deterministicOfferRuleCodes, extractClaims, resolveOfferRuleCode, runOfferChecks } from "./offer-checks";
import type { ContentFinding, OfferInput, RuleInput } from "./schema";

const LOAN: OfferInput = {
  code: "PL-1",
  product: "personal_loan",
  name: "Test Personal Loan",
  terms: {
    apr_min: 8.99,
    apr_max: 24.99,
    loan_min: 2000,
    loan_max: 40000,
    term_months_min: 24,
    term_months_max: 60,
    origination_fee_pct_min: 1,
    origination_fee_pct_max: 5,
    late_fee: "$15 after a 10-day grace period",
  },
};

const LOW_RATE_LOAN: OfferInput = { code: "PL-2", product: "personal_loan", name: "Low Rate Loan", terms: { apr_min: 4.99, apr_max: 5.5, loan_max: "$60,000" } };

const CARD: OfferInput = {
  code: "CC-1",
  product: "credit_card",
  name: "Test Card",
  terms: {
    apr_min: 19.99,
    apr_max: 28.99,
    intro_apr: 0,
    intro_months: 12,
    go_to_apr_min: 19.99,
    go_to_apr_max: 28.99,
    annual_fee: 0,
    balance_transfer_fee_pct: 3,
    late_fee_max_usd: 40,
  },
};

const FEE_CARD: OfferInput = { code: "CC-2", product: "credit_card", name: "Fee Card", terms: { apr_min: 20, apr_max: 25, annual_fee: 95 } };

const RULES: RuleInput[] = [
  {
    code: "OFFER-ACCURACY",
    title: "Advertised terms must match the offer",
    body: "Rates, fees and amounts must match product terms.",
    default_severity: "critical",
    applies_to: ["all"],
  },
  { code: "INTRO-RATE", title: "Intro rates need the go-to rate", body: "State what the rate becomes.", default_severity: "major", applies_to: ["credit_card"] },
  { code: "UDAAP", title: "No deceptive claims", body: "General.", default_severity: "major", applies_to: ["all"] },
];

function check(text: string, offers: OfferInput[], product: Product, rules: RuleInput[] = RULES): ContentFinding[] {
  return runOfferChecks({ text, product, offers, rules });
}

/** The parts of a finding that say what was flagged. */
const brief = (f: ContentFinding) => [f.rule_code, f.severity, f.quote, f.suggested_copy];

describe("extractClaims", () => {
  test("classifies rates, amounts and terms with their bounds", () => {
    const claims = extractClaims("Rates from 8.99% to 24.99% APR. Borrow up to $40,000. Repay over 5 years.");
    expect(claims.map((c) => [c.quote, c.kind, c.about, c.bound, c.value])).toEqual([
      ["Rates from 8.99%", "apr", "generic", "min", 8.99],
      ["24.99% APR", "apr", "generic", "exact", 24.99],
      ["up to $40,000", "money", "loan_amount", "max", 40000],
      ["over 5 years", "months", "term", "exact", 60],
    ]);
    expect(claims[0].at).toBe(0);
  });

  test("intro rates, intro periods and fees", () => {
    expect(extractClaims("0% intro APR for 15 months. Balance transfer fee: 5% of each transfer. $95 annual fee.").map((c) => [c.quote, c.kind, c.about])).toEqual([
      ["0% intro APR", "intro_apr", "generic"],
      ["5%", "fee_pct", "balance_transfer_fee"],
      ["$95", "money", "annual_fee"],
      ["for 15 months", "months", "intro_months"],
    ]);
  });

  test("ignores rewards, savings yields, discounts and monthly payments", () => {
    expect(extractClaims("2% cash back on every purchase.")).toEqual([]);
    expect(extractClaims("Earn 5% APY on savings.")).toEqual([]);
    expect(extractClaims("Save 10% off your first order.")).toEqual([]);
    expect(extractClaims("Only $189/month.")).toEqual([]);
  });

  test("a $Nk amount reads as thousands", () => {
    expect(extractClaims("Borrow up to $50k today.").map((c) => [c.quote, c.value])).toEqual([["up to $50k", 50000]]);
  });
});

describe("runOfferChecks: rates", () => {
  test("a rate below the floor is critical, with the real floor as suggested copy", () => {
    const [f] = check("Personal loans with rates as low as 5.99% APR.", [LOAN], "personal_loan");
    expect(brief(f)).toEqual(["OFFER-ACCURACY", "critical", "rates as low as 5.99% APR", "rates as low as 8.99% APR"]);
    expect(f.evidence_type).toBe("offer_mismatch");
    expect(f.explanation).toBe(
      "The ad advertises 5.99% but the lowest APR Test Personal Loan (PL-1) actually offers is 8.99%. Advertising a rate the lender does not offer misleads consumers about the cost of credit.",
    );
    expect(f.suggested_fix).toBe("Use the real floor rate: 8.99% APR (and say rates vary by creditworthiness).");
  });

  test("a rate above the ceiling is minor", () => {
    const findings = check("Rates from 8.99% to 29.99% APR.", [LOAN], "personal_loan");
    expect(findings.map(brief)).toEqual([["OFFER-ACCURACY", "minor", "29.99% APR", "24.99% APR"]]);
    expect(findings[0].suggested_fix).toBe("Use the real rate range for PL-1: 8.99% to 24.99% APR.");
  });

  test("the real range passes", () => {
    expect(check("Rates from 8.99% to 24.99% APR. Borrow $2,000 to $40,000.", [LOAN], "personal_loan")).toEqual([]);
  });

  test("both ends of a stated range are checked", () => {
    expect(check("Rates between 3% and 4% APR.", [LOAN], "personal_loan").map((f) => f.quote)).toEqual(["3%", "4% APR"]);
  });

  test("BUG: a three-decimal rate is rounded to two decimals in the explanation", () => {
    const mortgage: OfferInput = { code: "M-1", product: "mortgage", name: "Test Mortgage", terms: { apr_min: 6.74 } };
    const [f] = check("Rates as low as 6.625% APR", [mortgage], "mortgage");
    // BUG: the ad says 6.625%, but the explanation quotes it as 6.63%.
    expect(f.explanation.startsWith("The ad advertises 6.63% but")).toBe(true);
  });
});

describe("runOfferChecks: amounts and terms", () => {
  test("an amount above the maximum is major; a starting amount below the minimum is minor", () => {
    expect(check("Borrow up to $50,000.", [LOAN], "personal_loan").map(brief)).toEqual([["OFFER-ACCURACY", "major", "up to $50,000", "up to $40,000"]]);
    expect(check("Loans starting at $500.", [LOAN], "personal_loan").map(brief)).toEqual([["OFFER-ACCURACY", "minor", "starting at $500", "starting at $2,000"]]);
  });

  test("BUG: the suggested copy for a $Nk amount keeps the k", () => {
    // BUG: "up to $50k" becomes "up to $40,000k" (forty million) instead of "up to $40,000".
    expect(check("Borrow up to $50k today.", [LOAN], "personal_loan").map((f) => f.suggested_copy)).toEqual(["up to $40,000k"]);
  });

  test("terms beyond the longest or under the shortest are minor; years are suggested in years", () => {
    expect(check("Repay over 7 years.", [LOAN], "personal_loan").map(brief)).toEqual([["OFFER-ACCURACY", "minor", "over 7 years", "over 5 years"]]);
    expect(check("Terms of 12 months available.", [LOAN], "personal_loan").map(brief)).toEqual([["OFFER-ACCURACY", "minor", "Terms of 12 months", "Terms of 24 months"]]);
    expect(check("Repay over 5 years.", [LOAN], "personal_loan")).toEqual([]);
  });

  test("BUG: a repayment term right after a sentence about APR is read as an intro period", () => {
    expect(check("Borrow up to $40,000 over 84 months.", [LOAN], "personal_loan").map((f) => f.quote)).toEqual(["over 84 months"]);
    // BUG: the APR in the previous sentence makes "over 84 months" an intro period, so the
    // 84-month term (longest real term: 60) is never checked.
    expect(extractClaims("Rates from 8.99% APR. Borrow up to $40,000 over 84 months.").at(-1)?.about).toBe("intro_months");
    expect(check("Rates from 8.99% APR. Borrow up to $40,000 over 84 months.", [LOAN], "personal_loan")).toEqual([]);
  });
});

describe("runOfferChecks: fees", () => {
  test("an origination fee outside the real range is major", () => {
    const findings = check("Origination fee of 0.5% to 6%.", [LOAN], "personal_loan");
    expect(findings.map(brief)).toEqual([
      ["OFFER-ACCURACY", "major", "0.5%", "1% to 5%"],
      ["OFFER-ACCURACY", "major", "6%", "1% to 5%"],
    ]);
    expect(check("A 3% origination fee applies.", [LOAN], "personal_loan")).toEqual([]);
  });

  test("late, annual and balance transfer fees against the terms", () => {
    expect(check("Late fee of $25.", [LOAN], "personal_loan").map(brief)).toEqual([["OFFER-ACCURACY", "major", "$25", "$15"]]);
    expect(check("$95 annual fee.", [CARD], "credit_card").map(brief)).toEqual([["OFFER-ACCURACY", "major", "$95", "$0"]]);
    expect(check("$0 annual fee. 2% cash back on every purchase.", [CARD], "credit_card")).toEqual([]);
    expect(check("Balance transfer fee: 5% of each transfer.", [CARD], "credit_card").map(brief)).toEqual([["OFFER-ACCURACY", "major", "5%", "3%"]]);
  });

  test("a no-fee claim the terms contradict is critical and names the fees", () => {
    const [orig] = check("No origination fees ever!", [LOAN], "personal_loan");
    expect(brief(orig)).toEqual(["OFFER-ACCURACY", "critical", "No origination fees ever", undefined]);
    expect(orig.explanation).toBe(
      'The ad says "No origination fees ever", but PL-1 charges a 1% to 5% origination fee. A fee claim that the product terms contradict misleads consumers about the cost of credit.',
    );
    const [noFees] = check("No fees!", [LOAN], "personal_loan");
    expect(noFees.explanation.startsWith('The ad says "No fees", but PL-1 charges a 1% to 5% origination fee, late fees up to $15.')).toBe(true);
    expect(check("No late fees.", [LOAN], "personal_loan").map((f) => f.quote)).toEqual(["No late fees"]);
  });

  test("hidden, application, monthly and maintenance fee claims are never flagged", () => {
    expect(check("No hidden fees. No application fee. No monthly fees.", [LOAN, FEE_CARD], "unknown")).toEqual([]);
  });
});

describe("runOfferChecks: intro rates", () => {
  test("a wrong intro period is major, and a missing go-to rate is its own finding", () => {
    const findings = check("0% intro APR for 15 months.", [CARD], "credit_card");
    expect(findings.map((f) => [f.rule_code, f.severity, f.quote, f.evidence_type])).toEqual([
      ["INTRO-RATE", "major", "for 15 months", "offer_mismatch"],
      ["INTRO-RATE", "major", "0% intro APR", "missing_disclosure"],
    ]);
    expect(findings[1].suggested_copy).toBe("0% intro APR for 12 months, then 19.99% to 28.99% variable APR based on your creditworthiness");
  });

  test("a complete intro disclosure passes", () => {
    expect(check("0% intro APR for 12 months, then 19.99% to 28.99% variable APR.", [CARD], "credit_card")).toEqual([]);
  });

  test("a wrong intro rate is critical; the go-to finding for the same words is then deduped away", () => {
    // Both findings cite INTRO-RATE on "1.99% intro APR", and findings are deduped by rule + quote.
    expect(check("1.99% intro APR on purchases.", [CARD], "credit_card").map(brief)).toEqual([["INTRO-RATE", "critical", "1.99% intro APR", "0% intro APR"]]);
  });

  test("no go-to finding when the terms carry no go-to rate", () => {
    const plain: OfferInput = { code: "CC-3", product: "credit_card", name: "Plain Card", terms: { intro_apr: 0, intro_months: 12 } };
    expect(check("0% intro APR for 12 months.", [plain], "credit_card")).toEqual([]);
  });
});

describe("runOfferChecks: which offers count", () => {
  test("a claim passes when any offer for the product allows it", () => {
    expect(check("Rates as low as 9.99% APR.", [LOAN, LOW_RATE_LOAN], "personal_loan")).toEqual([]);
    expect(check("Borrow up to $50k today.", [LOAN, LOW_RATE_LOAN], "personal_loan")).toEqual([]);
    expect(check("No annual fee.", [CARD, FEE_CARD], "credit_card")).toEqual([]);
    expect(check("No annual fee.", [FEE_CARD], "credit_card").map((f) => f.severity)).toEqual(["critical"]);
  });

  test("when every offer fails, the worst verdict is reported", () => {
    // PL-1 fails as critical (below its floor), PL-2 as minor (above its ceiling).
    const [f] = check("Rates as low as 5.99% APR.", [LOW_RATE_LOAN, LOAN], "personal_loan");
    expect(f.severity).toBe("critical");
    expect(f.explanation).toContain("(PL-1)");
  });

  test("offers for another product are ignored; unknown and other products use every offer", () => {
    expect(check("Rates as low as 5.99% APR.", [CARD], "personal_loan")).toEqual([]);
    expect(check("Rates as low as 5.99% APR.", [LOAN], "unknown").map((f) => f.severity)).toEqual(["critical"]);
    expect(check("Borrow up to $50k today.", [LOAN], "other").map((f) => f.severity)).toEqual(["major"]);
  });

  test("nothing to check without text or offers", () => {
    expect(check("", [LOAN], "personal_loan")).toEqual([]);
    expect(check("   ", [LOAN], "personal_loan")).toEqual([]);
    expect(check("Rates as low as 5.99% APR.", [], "personal_loan")).toEqual([]);
  });

  test("repeated words are flagged once", () => {
    expect(check("Rates as low as 5.99% APR. Rates as low as 5.99% APR.", [LOAN], "personal_loan")).toHaveLength(1);
  });

  test("with no fitting rule the finding cites OFFER-TERMS", () => {
    expect(check("Borrow up to $50,000.", [LOAN], "personal_loan", []).map((f) => f.rule_code)).toEqual([OFFER_RULE_FALLBACK]);
    expect(OFFER_RULE_FALLBACK).toBe("OFFER-TERMS");
  });
});

describe("resolveOfferRuleCode", () => {
  test("the best-scoring rule for the topic", () => {
    expect(resolveOfferRuleCode(RULES, "apr")).toBe("OFFER-ACCURACY");
    expect(resolveOfferRuleCode(RULES, "fee")).toBe("OFFER-ACCURACY");
    expect(resolveOfferRuleCode(RULES, "intro")).toBe("INTRO-RATE");
  });

  test("skips rules that do not apply to the product (unknown and other skip nothing)", () => {
    expect(resolveOfferRuleCode(RULES, "intro", "personal_loan")).toBe("OFFER-ACCURACY");
    expect(resolveOfferRuleCode(RULES, "intro", "credit_card")).toBe("INTRO-RATE");
    expect(resolveOfferRuleCode(RULES, "intro", "unknown")).toBe("INTRO-RATE");
    expect(resolveOfferRuleCode(RULES, "intro", "other")).toBe("INTRO-RATE");
  });

  test("falls back to OFFER-TERMS below a score of 4", () => {
    expect(resolveOfferRuleCode([], "fee")).toBe("OFFER-TERMS");
    const weak: RuleInput = { code: "DISCLOSE", title: "Clear disclosures", body: "State the rate clearly.", default_severity: "minor", applies_to: ["all"] };
    expect(resolveOfferRuleCode([weak], "apr")).toBe("OFFER-TERMS");
    const titled: RuleInput = { ...weak, title: "Rate disclosures" };
    expect(resolveOfferRuleCode([titled], "apr")).toBe("DISCLOSE");
  });
});

describe("deterministicOfferRuleCodes", () => {
  test("the rule codes the checks would cite for a product, uppercased", () => {
    expect(deterministicOfferRuleCodes(RULES)).toEqual(["OFFER-ACCURACY", "INTRO-RATE"]);
    expect(deterministicOfferRuleCodes(RULES, "personal_loan")).toEqual(["OFFER-ACCURACY"]);
    expect(deterministicOfferRuleCodes([])).toEqual([]);
    expect(deterministicOfferRuleCodes([{ ...RULES[0], code: "offer-accuracy" }])).toEqual(["OFFER-ACCURACY"]);
  });
});
