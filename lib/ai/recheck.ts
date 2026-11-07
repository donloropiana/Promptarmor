import { similarity, spanHash } from "./spans";

/**
 * Recheck: pairs the findings of V(n) with the findings of V(n-1) so the ad
 * page can say "3 fixed · 1 still there · 1 new" and carry dispositions
 * forward when the exact words did not change.
 *
 * Match order (one prior finding pairs with at most one new finding):
 *   1. same rule (version id or code) + same span_hash   -> still_present
 *   2. same rule + quote similarity >= 0.8               -> re_anchored
 *   3. otherwise                                         -> new
 */

export const RECHECK_SIMILARITY = 0.8;

export type PriorFinding = {
  id: string;
  rule_version_id: string | null;
  /** rules.code of the rule version, when known. */
  rule_code: string | null;
  span_hash: string | null;
  quote: string | null;
  /** finding_latest_dispositions.id for the prior finding, when any. */
  latest_disposition_id: string | null;
};

export type NewFinding = {
  rule_version_id: string | null;
  rule_code: string;
  quote: string;
  span_hash?: string | null;
};

export type RecheckMatch = {
  prior_finding_id: string | null;
  recheck_status: "new" | "still_present" | "re_anchored";
  /** Disposition to carry forward (still_present only). */
  carried_from_disposition_id: string | null;
};

function sameRule(a: NewFinding, b: PriorFinding): boolean {
  if (a.rule_version_id && b.rule_version_id && a.rule_version_id === b.rule_version_id) return true;
  if (b.rule_code && a.rule_code && a.rule_code.trim().toUpperCase() === b.rule_code.trim().toUpperCase()) return true;
  return false;
}

/** One RecheckMatch per new finding, in input order. */
export function matchPriorFindings(current: NewFinding[], prior: PriorFinding[]): RecheckMatch[] {
  const taken = new Set<string>();
  const results: RecheckMatch[] = current.map(() => ({ prior_finding_id: null, recheck_status: "new", carried_from_disposition_id: null }));

  // Pass 1: exact span matches.
  current.forEach((f, i) => {
    const hash = f.span_hash ?? spanHash(f.quote);
    const hit = prior.find((p) => !taken.has(p.id) && sameRule(f, p) && p.span_hash && p.span_hash === hash);
    if (hit) {
      taken.add(hit.id);
      results[i] = { prior_finding_id: hit.id, recheck_status: "still_present", carried_from_disposition_id: hit.latest_disposition_id };
    }
  });

  // Pass 2: same rule, similar words (the quote moved or was lightly edited).
  current.forEach((f, i) => {
    if (results[i].prior_finding_id) return;
    let best: { p: PriorFinding; score: number } | null = null;
    for (const p of prior) {
      if (taken.has(p.id) || !sameRule(f, p) || !p.quote) continue;
      const score = similarity(f.quote, p.quote);
      if (score >= RECHECK_SIMILARITY && (!best || score > best.score)) best = { p, score };
    }
    if (best) {
      taken.add(best.p.id);
      results[i] = { prior_finding_id: best.p.id, recheck_status: "re_anchored", carried_from_disposition_id: null };
    }
  });

  return results;
}

/** Prior findings that no new finding matched: "Fixed" (or "Outdated") in the UI. */
export function unmatchedPrior(prior: PriorFinding[], matches: RecheckMatch[]): PriorFinding[] {
  const matched = new Set(matches.map((m) => m.prior_finding_id).filter(Boolean));
  return prior.filter((p) => !matched.has(p.id));
}
