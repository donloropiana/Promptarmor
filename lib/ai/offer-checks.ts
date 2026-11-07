import type { Product, Severity } from "@/lib/types/ads";

import type { ContentFinding, OfferInput, RuleInput } from "./schema";

/**
 * Deterministic offer checks: compare the numbers an ad states (APRs, intro
 * rates, fees, loan amounts, terms) with the workspace's real product terms.
 * Runs before the model, so the obvious money mistakes are caught even when
 * the model is unavailable, and the model is told not to repeat them.
 *
 * Terms are plain JSON (lib/seed/starter-products): apr_min, apr_max,
 * intro_apr, intro_months, go_to_apr_min, go_to_apr_max, annual_fee,
 * origination_fee_pct, loan_min, loan_max, term_months_min, term_months_max,
 * balance_transfer_fee, late_fee, ... Missing keys mean "unknown": no check.
 */

export const OFFER_RULE_FALLBACK = "OFFER-TERMS";

type Terms = Record<string, unknown>;

type Claim = {
  /** Verbatim words from the ad. */
  quote: string;
  /** Character offset of the quote in the text. */
  at: number;
  value: number;
  kind: "apr" | "intro_apr" | "fee_pct" | "money" | "months";
  /** What the money/fee refers to, from the surrounding words. */
  about: "annual_fee" | "origination_fee" | "late_fee" | "balance_transfer_fee" | "loan_amount" | "intro_months" | "term" | "generic";
  /** For amounts: "up to", "from", "exact". */
  bound: "max" | "min" | "exact";
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const m = v.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    if (m) return Number(m[0]);
  }
  return null;
}

function fmtPct(n: number): string {
  return `${Number.isInteger(n) ? n.toFixed(2) : n.toFixed(2)}%`.replace(/\.00%$/, "%").replace(/(\.\d)0%$/, "$1%");
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: n % 1 === 0 ? 0 : 2 })}`;
}

function context(text: string, at: number, len: number, before = 70, after = 70): { pre: string; post: string } {
  return { pre: text.slice(Math.max(0, at - before), at), post: text.slice(at + len, at + len + after) };
}

const CASHBACK_RE = /cash ?back|rewards?|points|bonus|off\b|discount|savings?|apy|yield|interest on (your )?(savings|deposits)/i;
/** "then", "after that", a range ("X% to Y%") or a dash right before the number: a go-to rate or range, not an intro rate. */
const GO_TO_BEFORE_RE = /\b(then|after|thereafter|to|and|between)\s*(a |an |the )?(variable |standard |regular |ongoing )?(apr (of|at) )?$|[-–]\s*$/i;
const INTRO_BEFORE_RE = /\b(intro(ductory)?|promo(tional)?)\s*(apr|rate)?\s*(of|at|:|as low as|from)?\s*$/i;
const INTRO_AFTER_RE = /^\s*(intro(ductory)?|promo(tional)?)\b|^\s*(apr\s+)?(on (purchases|balance transfers|transfers)\s+)?for (the )?(first )?\d{1,2}\s?(months|mos|billing cycles)/i;
const FEE_AFTER_RE = /^\s*(origination|balance[- ]transfer|transfer|annual|late|application|processing|cash advance|foreign transaction)?\s*fee\b|^\s*origination\b|^\s*of (each|the) (transfer|balance|loan)/i;
const FEE_BEFORE_RE = /\b(origination|balance[- ]transfer|transfer|annual|late|application|processing) fee\s*(of|is|:|at)?\s*$|\bfee\s*(of|is|:|at)?\s*$/i;
const APR_RE = /\bapr\b|a\.p\.r\.|annual percentage|\brates?\b|\binterest\b|as low as|\bfrom\b|starting (at|from)|\blow as\b|\bonly\b/i;

const MONEY_ABOUT: { about: Claim["about"]; re: RegExp }[] = [
  { about: "annual_fee", re: /annual fee/i },
  { about: "late_fee", re: /late (payment )?fee/i },
  { about: "origination_fee", re: /origination( fee)?/i },
  { about: "balance_transfer_fee", re: /(balance )?transfer fee|balance transfer|per transfer|each transfer|minimum/i },
];

/** The topic whose keyword sits closest to the number (before or after), or null. */
function nearestAbout(pre: string, post: string): Claim["about"] | null {
  let best: { about: Claim["about"]; distance: number } | null = null;
  for (const { about, re } of MONEY_ABOUT) {
    const preMatches = Array.from(pre.matchAll(new RegExp(re.source, "gi")));
    const last = preMatches[preMatches.length - 1];
    if (last && last.index !== undefined) {
      const distance = pre.length - (last.index + last[0].length);
      if (!best || distance < best.distance) best = { about, distance };
    }
    const after = new RegExp(re.source, "i").exec(post);
    if (after && after.index !== undefined) {
      const distance = after.index;
      if (!best || distance < best.distance) best = { about, distance };
    }
  }
  return best && best.distance <= 45 ? best.about : null;
}

/** Pulls every numeric claim with enough context to classify it. */
export function extractClaims(text: string): Claim[] {
  const claims: Claim[] = [];

  // Percentages, with a short qualifier before and a unit after, e.g. "as low as 5.99% APR".
  const pctRe =
    /((?:rates?\s+)?(?:as low as|starting (?:at|from)|starting|from|low as|only|just|fixed|variable)\s+)?(\d{1,2}(?:\.\d{1,3})?)\s?%(\s?(?:intro(?:ductory)?\s+)?(?:apr|a\.p\.r\.|annual percentage rate|fixed apr|variable apr|interest rate|interest|rate)\b)?/gi;
  for (const m of text.matchAll(pctRe)) {
    const at = m.index ?? 0;
    const whole = m[0];
    const value = Number(m[2]);
    if (!Number.isFinite(value)) continue;
    const { pre, post } = context(text, at, whole.length);
    const unit = (m[3] ?? "").trim();
    const rateUnit = /apr|a\.p\.r|percentage|interest|rate/i.test(unit);
    const pre30 = pre.slice(-30);
    const post40 = post.slice(0, 40);

    // The second half of a range ("1% to 5%", "19.99% to 28.99%") is the same kind of claim as the first.
    const previous = claims[claims.length - 1];
    if (previous && (previous.kind === "fee_pct" || previous.kind === "apr" || previous.kind === "intro_apr") && /^\s*(to|-|–|and)\s*$/i.test(text.slice(previous.at + previous.quote.length, at))) {
      claims.push({ quote: whole.trim(), at, value, kind: previous.kind === "intro_apr" ? "apr" : previous.kind, about: previous.about, bound: "exact" });
      continue;
    }

    // Fees: "3% origination fee", "fee of 3%", "3% of each transfer".
    if (!rateUnit && (FEE_AFTER_RE.test(post40) || FEE_BEFORE_RE.test(pre30))) {
      const near = `${pre30} ${post40}`;
      const about: Claim["about"] = /origination/i.test(near) ? "origination_fee" : /transfer/i.test(near) ? "balance_transfer_fee" : "generic";
      claims.push({ quote: whole.trim(), at, value, kind: "fee_pct", about, bound: "exact" });
      continue;
    }
    if (!rateUnit && CASHBACK_RE.test(`${pre30} ${post.slice(0, 30)}`)) continue;

    const goTo = GO_TO_BEFORE_RE.test(pre30);
    const intro = !goTo && (/intro|promo/i.test(unit) || INTRO_BEFORE_RE.test(pre30) || INTRO_AFTER_RE.test(post40));
    if (intro) {
      claims.push({ quote: whole.trim(), at, value, kind: "intro_apr", about: "generic", bound: "exact" });
      continue;
    }
    if (rateUnit || goTo || APR_RE.test(`${pre.slice(-40)} ${post.slice(0, 25)}`)) {
      claims.push({
        quote: whole.trim(),
        at,
        value,
        kind: "apr",
        about: "generic",
        bound: /as low as|from|starting|low as|only|just/i.test(whole) && !goTo ? "min" : "exact",
      });
    }
  }

  // Dollar amounts: fees and loan sizes.
  const moneyRe = /((?:borrow|loans?|get|receive|funds?|amounts?)\s+)?((?:up to|as much as|from|starting at|as little as)\s+)?\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?\s?(k\b|K\b)?/g;
  for (const m of text.matchAll(moneyRe)) {
    const at = m.index ?? 0;
    const whole = m[0];
    let value = Number(m[3].replace(/,/g, ""));
    if (m[4]) value *= 1000;
    if (!Number.isFinite(value)) continue;
    const { pre: preRaw, post: postRaw } = context(text, at, whole.length, 60, 60);
    // Only the sentence the number sits in can say what it is about.
    const pre = preRaw.slice(preRaw.search(/[^.!?\n]*$/));
    const post = postRaw.slice(0, Math.max(0, postRaw.search(/[.!?\n]|$/)));
    // "$189/month" is a payment amount (a trigger term for the rules), not a fee or a loan size.
    if (/^\s*(\/|per|a|each)\s*(mo|month)/i.test(postRaw)) continue;
    let about: Claim["about"] | null = m[1] ? "loan_amount" : nearestAbout(pre, post);
    if (!about) {
      if (/\bborrow\b|\bloans?\b|\bloan amounts?\b|\bfunds?\b|\bfinanc(e|ing)\b|\bget\b.{0,20}\bcash\b/i.test(`${pre} ${whole}`) || /\bup to\b|\bas much as\b/i.test(whole)) about = "loan_amount";
      else continue;
    }
    const bound: Claim["bound"] = /up to|as much as/i.test(whole) ? "max" : /from|starting at|as little as/i.test(whole) ? "min" : "exact";
    claims.push({ quote: whole.trim(), at, value, kind: "money", about, bound });
  }

  // Month counts: intro periods and repayment terms.
  const monthRe = /((?:for|first|up to|over|terms? (?:of|from|up to))\s+(?:the\s+)?(?:first\s+)?)?(\d{1,3})\s?(months?|mos?\b)/gi;
  for (const m of text.matchAll(monthRe)) {
    const at = m.index ?? 0;
    const whole = m[0];
    const value = Number(m[2]);
    const { pre, post } = context(text, at, whole.length, 60, 30);
    const around = `${pre} ${whole} ${post}`;
    if (/intro|promo/i.test(around) || /\bapr\b|interest/i.test(pre.slice(-40))) {
      claims.push({ quote: whole.trim(), at, value, kind: "months", about: "intro_months", bound: "exact" });
    } else if (/\bterms?\b|\brepay|\bpay (it )?(back|off)\b|\bover\b|\bup to\b/i.test(around)) {
      claims.push({ quote: whole.trim(), at, value, kind: "months", about: "term", bound: /up to/i.test(whole) ? "max" : "exact" });
    }
  }
  const yearRe = /((?:up to|over|terms? (?:of|from|up to))\s+)?(\d{1,2})\s?-?\s?(years?|yrs?)\b/gi;
  for (const m of text.matchAll(yearRe)) {
    const at = m.index ?? 0;
    const whole = m[0];
    const { pre, post } = context(text, at, whole.length, 60, 30);
    if (/\bterms?\b|\brepay|\bpay (it )?(back|off)\b|\bover\b|\bup to\b|\bloan\b/i.test(`${pre} ${whole} ${post}`)) {
      claims.push({ quote: whole.trim(), at, value: Number(m[2]) * 12, kind: "months", about: "term", bound: /up to/i.test(whole) ? "max" : "exact" });
    }
  }

  return claims;
}

// ---------------------------------------------------------------------------
// Rule resolution
// ---------------------------------------------------------------------------

type Topic = "apr" | "fee" | "intro" | "amount" | "term";

const TOPIC_WORDS: Record<Topic, RegExp> = {
  apr: /\bapr\b|\brate\b|rates|accura|actual|offered|product terms|offer terms/i,
  fee: /\bfees?\b|cost|accura|actual|offered|product terms|offer terms/i,
  intro: /intro|promotional|go-to|post-promo/i,
  amount: /amount|loan size|borrow|accura|actual|offered|product terms|offer terms/i,
  term: /\bterm\b|repay|duration|accura|actual|offered|product terms|offer terms/i,
};

/** Best rule code for a deterministic topic (among rules that apply to the product), or OFFER-TERMS when none fits. */
export function resolveOfferRuleCode(rules: RuleInput[], topic: Topic, product?: Product): string {
  let best: { code: string; score: number } | null = null;
  for (const r of rules) {
    if (product && product !== "unknown" && product !== "other" && !r.applies_to.includes("all") && !r.applies_to.includes(product)) continue;
    const hay = `${r.code} ${r.title} ${r.body}`;
    let score = 0;
    if (/offer|product terms|actual terms|real terms|accurac|misstat/i.test(r.code) || /offer|product terms|actual terms|accurac|misstat/i.test(r.title)) score += 5;
    if (TOPIC_WORDS[topic].test(r.title)) score += 3;
    if (TOPIC_WORDS[topic].test(hay)) score += 1;
    if (topic === "intro" && /intro/i.test(r.title)) score += 4;
    if (score > 0 && (!best || score > best.score)) best = { code: r.code, score };
  }
  return best && best.score >= 4 ? best.code : OFFER_RULE_FALLBACK;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

type Verdict = { ok: true } | { ok: false; explanation: string; suggested_copy?: string; suggested_fix: string; severity: Severity; topic: Topic };

function replaceNumber(quote: string, from: number, to: string): string {
  const fromStr = quote.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/)?.[0];
  if (!fromStr) return quote;
  return quote.replace(fromStr, to);
}

/** "up to 7 years" -> "up to 5 years"; "84 months" -> "60 months". */
function replaceTerm(quote: string, months: number): string {
  if (/year|yr/i.test(quote)) {
    if (months % 12 === 0) return replaceNumber(quote, 0, String(months / 12));
    return `${quote.replace(/\d+\s?-?\s?(years?|yrs?)/i, `${months} months`)}`;
  }
  return replaceNumber(quote, 0, String(months));
}

function checkClaim(claim: Claim, offer: OfferInput): Verdict {
  const t: Terms = offer.terms ?? {};
  const aprMin = num(t.apr_min);
  const aprMax = num(t.apr_max);
  const intro = num(t.intro_apr);
  const introMonths = num(t.intro_months);
  const annualFee = num(t.annual_fee);
  const originationPct = num(t.origination_fee_pct);
  const originationMin = num(t.origination_fee_pct_min) ?? originationPct;
  const originationMax = num(t.origination_fee_pct_max) ?? originationPct;
  const lateFee = num(t.late_fee_max_usd) ?? num(t.late_fee);
  const btFee = num(t.balance_transfer_fee_pct) ?? num(t.balance_transfer_fee);
  const loanMin = num(t.loan_min);
  const loanMax = num(t.loan_max);
  const termMin = num(t.term_months_min);
  const termMax = num(t.term_months_max);

  switch (claim.kind) {
    case "apr": {
      if (aprMin !== null && claim.value < aprMin - 1e-9) {
        return {
          ok: false,
          topic: "apr",
          severity: "critical",
          explanation: `The ad advertises ${fmtPct(claim.value)} but the lowest APR ${offer.name} (${offer.code}) actually offers is ${fmtPct(aprMin)}. Advertising a rate the lender does not offer misleads consumers about the cost of credit.`,
          suggested_fix: `Use the real floor rate: ${fmtPct(aprMin)} APR (and say rates vary by creditworthiness).`,
          suggested_copy: replaceNumber(claim.quote, claim.value, fmtPct(aprMin).replace("%", "")),
        };
      }
      if (aprMax !== null && claim.value > aprMax + 1e-9) {
        return {
          ok: false,
          topic: "apr",
          severity: "minor",
          explanation: `The ad states ${fmtPct(claim.value)} but the highest APR on ${offer.code} is ${fmtPct(aprMax)}. The number does not match the product on file.`,
          suggested_fix: `Use the real rate range for ${offer.code}: ${aprMin !== null ? `${fmtPct(aprMin)} to ` : ""}${fmtPct(aprMax)} APR.`,
          suggested_copy: replaceNumber(claim.quote, claim.value, fmtPct(aprMax).replace("%", "")),
        };
      }
      if (aprMin !== null && aprMax !== null && claim.bound === "exact" && claim.value > aprMin && claim.value <= aprMax) {
        return { ok: true };
      }
      return { ok: true };
    }
    case "intro_apr": {
      if (intro === null) {
        if (aprMin !== null && claim.value < aprMin - 1e-9) {
          return {
            ok: false,
            topic: "intro",
            severity: "critical",
            explanation: `The ad promotes a ${fmtPct(claim.value)} introductory rate, but ${offer.name} (${offer.code}) has no introductory rate on file; its APR starts at ${fmtPct(aprMin)}.`,
            suggested_fix: `Remove the introductory rate claim or add the real intro offer to the product terms first.`,
          };
        }
        return { ok: true };
      }
      if (Math.abs(claim.value - intro) > 1e-9) {
        return {
          ok: false,
          topic: "intro",
          severity: "critical",
          explanation: `The ad promotes a ${fmtPct(claim.value)} introductory APR, but the real introductory APR on ${offer.code} is ${fmtPct(intro)}.`,
          suggested_fix: `State the real introductory APR, ${fmtPct(intro)}, with its length and the rate that applies afterwards.`,
          suggested_copy: replaceNumber(claim.quote, claim.value, fmtPct(intro).replace("%", "")),
        };
      }
      return { ok: true };
    }
    case "fee_pct": {
      if (
        claim.about === "origination_fee" &&
        originationMin !== null &&
        originationMax !== null &&
        (claim.value < originationMin - 1e-9 || claim.value > originationMax + 1e-9)
      ) {
        const real = originationMin === originationMax ? fmtPct(originationMin) : `${fmtPct(originationMin)} to ${fmtPct(originationMax)}`;
        return {
          ok: false,
          topic: "fee",
          severity: "major",
          explanation: `The ad states a ${fmtPct(claim.value)} origination fee, but ${offer.code} charges ${real}.`,
          suggested_fix: `State the real origination fee: ${real}.`,
          suggested_copy: replaceNumber(claim.quote, claim.value, (originationMin === originationMax ? fmtPct(originationMin) : `${fmtPct(originationMin)} to ${fmtPct(originationMax)}`).replace(/%$/, "")),
        };
      }
      if (claim.about === "balance_transfer_fee" && btFee !== null && Math.abs(claim.value - btFee) > 1e-9) {
        return {
          ok: false,
          topic: "fee",
          severity: "major",
          explanation: `The ad states a ${fmtPct(claim.value)} balance transfer fee, but ${offer.code} charges ${fmtPct(btFee)}.`,
          suggested_fix: `State the real balance transfer fee of ${fmtPct(btFee)}.`,
          suggested_copy: replaceNumber(claim.quote, claim.value, fmtPct(btFee).replace("%", "")),
        };
      }
      return { ok: true };
    }
    case "money": {
      if (claim.about === "annual_fee" && annualFee !== null && Math.abs(claim.value - annualFee) > 1e-9) {
        return {
          ok: false,
          topic: "fee",
          severity: "major",
          explanation: `The ad states a ${fmtMoney(claim.value)} annual fee, but the real annual fee on ${offer.code} is ${fmtMoney(annualFee)}.`,
          suggested_fix: `State the real annual fee: ${fmtMoney(annualFee)}.`,
          suggested_copy: replaceNumber(claim.quote, claim.value, fmtMoney(annualFee).replace("$", "")),
        };
      }
      if (claim.about === "late_fee" && lateFee !== null && claim.value > lateFee + 1e-9) {
        return {
          ok: false,
          topic: "fee",
          severity: "major",
          explanation: `The ad states a ${fmtMoney(claim.value)} late fee, but the late fee on ${offer.code} is at most ${fmtMoney(lateFee)}.`,
          suggested_fix: `State the real late fee: up to ${fmtMoney(lateFee)}.`,
          suggested_copy: replaceNumber(claim.quote, claim.value, fmtMoney(lateFee).replace("$", "")),
        };
      }
      if (claim.about === "loan_amount") {
        if (loanMax !== null && claim.value > loanMax + 1e-9) {
          return {
            ok: false,
            topic: "amount",
            severity: "major",
            explanation: `The ad offers ${fmtMoney(claim.value)}, but the most ${offer.name} (${offer.code}) lends is ${fmtMoney(loanMax)}.`,
            suggested_fix: `Use the real maximum: ${fmtMoney(loanMax)}.`,
            suggested_copy: replaceNumber(claim.quote, claim.value, fmtMoney(loanMax).replace("$", "")),
          };
        }
        if (loanMin !== null && claim.bound === "min" && claim.value < loanMin - 1e-9) {
          return {
            ok: false,
            topic: "amount",
            severity: "minor",
            explanation: `The ad says loans start at ${fmtMoney(claim.value)}, but the smallest ${offer.code} loan is ${fmtMoney(loanMin)}.`,
            suggested_fix: `Use the real minimum: ${fmtMoney(loanMin)}.`,
            suggested_copy: replaceNumber(claim.quote, claim.value, fmtMoney(loanMin).replace("$", "")),
          };
        }
      }
      return { ok: true };
    }
    case "months": {
      if (claim.about === "intro_months" && introMonths !== null && Math.abs(claim.value - introMonths) > 1e-9) {
        return {
          ok: false,
          topic: "intro",
          severity: "major",
          explanation: `The ad promises the introductory rate for ${claim.value} months, but on ${offer.code} it lasts ${introMonths} months.`,
          suggested_fix: `State the real introductory period: ${introMonths} months.`,
          suggested_copy: replaceNumber(claim.quote, claim.value, String(introMonths)),
        };
      }
      if (claim.about === "term") {
        if (termMax !== null && claim.value > termMax + 1e-9) {
          return {
            ok: false,
            topic: "term",
            severity: "minor",
            explanation: `The ad mentions a ${claim.value}-month term, but the longest ${offer.code} term is ${termMax} months.`,
            suggested_fix: `Use the real term range: ${termMin !== null ? `${termMin} to ` : "up to "}${termMax} months.`,
            suggested_copy: replaceTerm(claim.quote, termMax),
          };
        }
        if (termMin !== null && claim.bound === "exact" && claim.value < termMin - 1e-9) {
          return {
            ok: false,
            topic: "term",
            severity: "minor",
            explanation: `The ad mentions a ${claim.value}-month term, but the shortest ${offer.code} term is ${termMin} months.`,
            suggested_fix: `Use the real term range: ${termMin} to ${termMax ?? "?"} months.`,
            suggested_copy: replaceTerm(claim.quote, termMin),
          };
        }
      }
      return { ok: true };
    }
  }
  return { ok: true };
}

const NO_FEE_RE = /\b(no|zero|without( any)?|0|never any)\s+(annual|origination|late|hidden|balance[- ]transfer|application|monthly|maintenance)?\s*fees?\b(\s*(ever|at all))?|\bfee[- ]free\b|\b(no|zero)[- ]fee\b/gi;
const GO_TO_RE = /after (that|the (intro|introductory|promo|promotional) period)|then (a |an )?(variable|standard|regular)|thereafter|go-to|standard (variable )?apr|regular (variable )?apr|ongoing (variable )?apr|variable apr of|(then|after).{0,40}\d{1,2}(\.\d{1,2})?\s?%/i;

/**
 * Runs every deterministic check. A claim is a mismatch only when it fails
 * against every candidate offer for the ad's product (several cards may be
 * on file). Returns findings in document order, deduped by quote.
 */
export function runOfferChecks(input: {
  text: string;
  product: Product;
  offers: OfferInput[];
  rules: RuleInput[];
}): ContentFinding[] {
  const text = input.text ?? "";
  if (!text.trim() || input.offers.length === 0) return [];

  const matching = input.offers.filter((o) => o.product === input.product);
  const candidates = matching.length > 0 ? matching : input.product === "unknown" || input.product === "other" ? input.offers : [];
  if (candidates.length === 0) return [];

  const findings: ContentFinding[] = [];
  const seen = new Set<string>();
  const push = (f: ContentFinding) => {
    const key = `${f.rule_code}|${f.quote.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(f);
  };

  for (const claim of extractClaims(text)) {
    const verdicts = candidates.map((o) => ({ offer: o, verdict: checkClaim(claim, o) }));
    if (verdicts.some((v) => v.verdict.ok)) continue;
    const worst = verdicts
      .filter((v): v is { offer: OfferInput; verdict: Extract<Verdict, { ok: false }> } => !v.verdict.ok)
      .sort((a, b) => rank(b.verdict.severity) - rank(a.verdict.severity))[0];
    if (!worst) continue;
    const code = resolveOfferRuleCode(input.rules, worst.verdict.topic, input.product);
    push({
      rule_code: code,
      severity: worst.verdict.severity,
      quote: claim.quote,
      explanation: worst.verdict.explanation,
      suggested_fix: worst.verdict.suggested_fix,
      suggested_copy: worst.verdict.suggested_copy,
      evidence_type: "offer_mismatch",
    });
  }

  // "No fees" claims against offers that do charge fees.
  for (const m of text.matchAll(NO_FEE_RE)) {
    const quote = m[0].trim();
    const which = (m[3] ?? "").toLowerCase();
    const failures = candidates
      .map((o) => {
        const t = o.terms ?? {};
        const annual = num(t.annual_fee);
        const orig = num(t.origination_fee_pct_min) ?? num(t.origination_fee_pct);
        const origMax = num(t.origination_fee_pct_max) ?? orig;
        const late = num(t.late_fee_max_usd) ?? num(t.late_fee);
        const bt = num(t.balance_transfer_fee_pct) ?? num(t.balance_transfer_fee);
        if (which.startsWith("annual")) return annual !== null && annual > 0 ? `${o.code} charges a ${fmtMoney(annual)} annual fee` : null;
        if (which.startsWith("origination"))
          return orig !== null && orig > 0 ? `${o.code} charges a ${origMax !== null && origMax !== orig ? `${fmtPct(orig)} to ${fmtPct(origMax)}` : fmtPct(orig)} origination fee` : null;
        if (which.startsWith("late")) return late !== null && late > 0 ? `${o.code} charges a late fee of up to ${fmtMoney(late)}` : null;
        if (which.startsWith("balance")) return bt !== null && bt > 0 ? `${o.code} charges a ${fmtPct(bt)} balance transfer fee` : null;
        if (which === "" || which === "hidden" || which === "application" || which === "monthly" || which === "maintenance") {
          const parts: string[] = [];
          if (annual !== null && annual > 0) parts.push(`a ${fmtMoney(annual)} annual fee`);
          if (orig !== null && orig > 0) parts.push(`a ${origMax !== null && origMax !== orig ? `${fmtPct(orig)} to ${fmtPct(origMax)}` : fmtPct(orig)} origination fee`);
          if (late !== null && late > 0) parts.push(`late fees up to ${fmtMoney(late)}`);
          if (bt !== null && bt > 0) parts.push(`a ${fmtPct(bt)} balance transfer fee`);
          if (which === "hidden" || which === "application" || which === "monthly" || which === "maintenance") return null;
          return parts.length ? `${o.code} charges ${parts.join(", ")}` : null;
        }
        return null;
      })
      .filter((x): x is string => Boolean(x));
    if (failures.length === candidates.length && failures.length > 0) {
      push({
        rule_code: resolveOfferRuleCode(input.rules, "fee", input.product),
        severity: "critical",
        quote,
        explanation: `The ad says "${quote}", but ${failures.join("; ")}. A fee claim that the product terms contradict misleads consumers about the cost of credit.`,
        suggested_fix: "Remove the no-fee claim or state the actual fees next to it.",
        evidence_type: "offer_mismatch",
      });
    }
  }

  // Intro rate promoted without the rate that applies afterwards.
  const introClaim = extractClaims(text).find((c) => c.kind === "intro_apr");
  if (introClaim && !GO_TO_RE.test(text)) {
    const withGoTo = candidates.filter((o) => num(o.terms?.go_to_apr_min) !== null || num(o.terms?.go_to_apr_max) !== null);
    if (withGoTo.length > 0) {
      const o = withGoTo[0];
      const gMin = num(o.terms.go_to_apr_min);
      const gMax = num(o.terms.go_to_apr_max);
      const range = gMin !== null && gMax !== null ? `${fmtPct(gMin)} to ${fmtPct(gMax)}` : fmtPct((gMin ?? gMax) as number);
      const months = num(o.terms.intro_months);
      push({
        rule_code: resolveOfferRuleCode(input.rules, "intro", input.product),
        severity: "major",
        quote: introClaim.quote,
        explanation: `The ad promotes an introductory rate but never says what the rate becomes afterwards. On ${o.code} the rate after the intro period is ${range} variable APR${months !== null ? ` (intro lasts ${months} months)` : ""}.`,
        suggested_fix: `Add the go-to rate next to the intro rate: "${range} variable APR after${months !== null ? ` ${months} months` : " the intro period"}, based on creditworthiness."`,
        suggested_copy: `${introClaim.quote} for ${months !== null ? `${months} months` : "the intro period"}, then ${range} variable APR based on your creditworthiness`,
        evidence_type: "missing_disclosure",
      });
    }
  }

  return findings;
}

function rank(s: Severity): number {
  return s === "critical" ? 3 : s === "major" ? 2 : 1;
}
