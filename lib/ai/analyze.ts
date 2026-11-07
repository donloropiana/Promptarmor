import { generateText, Output } from "ai";

import type { Product, Severity } from "@/lib/types/ads";

import { MODELS, costUsd } from "./budget";
import { detectHiddenText } from "./hidden-text";
import { cheapProviderOptions, tryModels } from "./ladder";
import { assertModelCallsAllowed } from "./mode";
import { runOfferChecks } from "./offer-checks";
import { buildCheckSystemPrompt, buildCheckUserPrompt, promptHash } from "./prompts";
import { AnalysisOutputSchema, type ContentFinding, type HiddenTextCandidate, type OfferInput, type RuleInput } from "./schema";
import { normalizeForMatch } from "./spans";

/**
 * analyzeContent: the pure check. No database, no budget: the caller
 * (runAnalysis, scripts/eval.ts) reserves budget and persists results.
 *
 * Order: deterministic hidden-text scan -> deterministic offer checks ->
 * one structured-output call to the check model (told what is already
 * flagged) -> merge and dedupe by quote + rule.
 *
 * The model call is refused unless AI_MODE=live (lib/ai/mode): callers
 * that must not spend pass skipModel, and the guard catches the rest.
 */

/** Hard ceiling on one model call; the budget reservation TTL is 15 minutes. */
export const LLM_TIMEOUT_MS = 90_000;

export type AnalyzeContentInput = {
  text: string;
  html?: string;
  product: Product;
  channel?: string;
  format?: string;
  rules: RuleInput[];
  offers: OfferInput[];
  /** True when `text` was transcribed from an image. */
  transcribed?: boolean;
  /** Skip the model call (offer checks + hidden text only). */
  skipModel?: boolean;
};

export type AnalyzeUsage = {
  input_tokens: number;
  output_tokens: number;
  /** Input tokens served from the prompt cache (part of input_tokens). */
  cache_read_tokens: number;
  /** Input tokens written to the prompt cache (part of input_tokens). */
  cache_write_tokens: number;
  cost_usd: number;
  model: string;
};

export type AnalyzeContentResult = {
  findings: ContentFinding[];
  hidden_text: HiddenTextCandidate[];
  usage: AnalyzeUsage;
  prompt_hash: string;
  /** Findings produced before the model ran (offer checks). */
  deterministic_count: number;
  /** Whether the model was called (false when skipped). */
  model_called: boolean;
};

const SEVERITY_RANK: Record<Severity, number> = { critical: 3, major: 2, minor: 1 };

function dedupeKey(f: { rule_code: string; quote: string }): string {
  return `${f.rule_code.trim().toUpperCase()}|${normalizeForMatch(f.quote)}`;
}

/**
 * Merges deterministic and model findings. Same rule + same quote => keep
 * the deterministic one (it carries the real numbers). Same quote under a
 * different rule is allowed. Model findings citing unknown rule codes are
 * kept but downgraded to needs_judgment so the reviewer still sees them.
 */
export function mergeFindings(deterministic: ContentFinding[], fromModel: ContentFinding[], rules: RuleInput[]): ContentFinding[] {
  const known = new Set(rules.map((r) => r.code.trim().toUpperCase()));
  const out: ContentFinding[] = [];
  const seen = new Set<string>();
  for (const f of deterministic) {
    const key = dedupeKey(f);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  const detQuotes = new Set(deterministic.map((f) => normalizeForMatch(f.quote)));
  for (const f of fromModel) {
    const quote = f.quote.trim();
    if (!quote) continue;
    const key = dedupeKey({ rule_code: f.rule_code, quote });
    if (seen.has(key)) continue;
    // Same quote already explained by a deterministic offer check: drop the duplicate.
    if (detQuotes.has(normalizeForMatch(quote)) && f.evidence_type === "offer_mismatch") continue;
    seen.add(key);
    const codeKnown = known.has(f.rule_code.trim().toUpperCase());
    out.push({
      ...f,
      quote: quote.slice(0, 400),
      rule_code: f.rule_code.trim(),
      evidence_type: codeKnown ? f.evidence_type : "needs_judgment",
      suggested_copy: f.suggested_copy?.trim() || undefined,
    });
  }
  return out.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

/** The rule that covers hidden / AI-directed text, when the workspace has one. */
export function hiddenTextRuleCode(rules: RuleInput[]): string {
  const rule = rules.find((r) => /hidden|injection|security/i.test(r.code)) ?? rules.find((r) => /hidden text|ai-directed|injection/i.test(r.title));
  return rule?.code ?? "HIDDEN-TEXT";
}

/** Every hidden-text candidate is also an issue on its own (Critical by default). */
export function hiddenTextFindings(hidden: HiddenTextCandidate[], rules: RuleInput[]): ContentFinding[] {
  if (hidden.length === 0) return [];
  const code = hiddenTextRuleCode(rules);
  const rule = rules.find((r) => r.code === code);
  return hidden.map((h) => ({
    rule_code: code,
    severity: rule?.default_severity ?? "critical",
    quote: h.excerpt,
    explanation:
      h.kind === "possible_injection"
        ? `This text is written for an automated reviewer, not a consumer (${h.location}). It was treated as content only: it changed nothing and cannot approve anything.`
        : `This text is hidden from readers (${h.location}). Text a person cannot see is not a disclosure and should not be in the ad.`,
    suggested_fix: "Remove the hidden text and ask the submitter why it was there.",
    evidence_type: "exact_match",
  }));
}

/** Applies each rule's default severity when the model deviated without a strong reason (keeps the model's choice when stricter). */
function clampSeverity(f: ContentFinding, rules: RuleInput[]): ContentFinding {
  const rule = rules.find((r) => r.code.trim().toUpperCase() === f.rule_code.trim().toUpperCase());
  // A concern outside the rulebook ("UNLISTED", or a code the model made up) is
  // worth a look, never a rule finding: Minor, so it is listed but blocks nothing.
  if (!rule) return { ...f, rule_code: "UNLISTED", severity: "minor" as Severity, evidence_type: "needs_judgment" as const };
  // Allow one step either way; a two-step jump down is usually the model being lenient.
  const want = SEVERITY_RANK[rule.default_severity];
  const got = SEVERITY_RANK[f.severity];
  if (want - got >= 2) return { ...f, severity: rule.default_severity };
  return f;
}

export async function analyzeContent(input: AnalyzeContentInput): Promise<AnalyzeContentResult> {
  const text = (input.text ?? "").trim();
  const rules = input.rules ?? [];
  const offers = input.offers ?? [];
  const hash = promptHash(rules, offers);

  const hidden = detectHiddenText({ html: input.html, text });
  const deterministic = runOfferChecks({ text, product: input.product, offers, rules });

  const base = {
    prompt_hash: hash,
    deterministic_count: deterministic.length,
  };

  if (input.skipModel || !text) {
    return {
      ...base,
      findings: mergeFindings([...deterministic, ...hiddenTextFindings(hidden, rules)], [], rules),
      hidden_text: hidden,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0, model: "none" },
      model_called: false,
    };
  }

  assertModelCallsAllowed("ad check");

  // Constant per product + rules + terms, so the provider can cache it; the ad itself stays outside.
  const system = buildCheckSystemPrompt({ rules, offers, product: input.product });
  const prompt = buildCheckUserPrompt({
    text,
    transcribed: input.transcribed,
    channel: input.channel,
    format: input.format,
    alreadyFlagged: deterministic,
  });

  // Cheapest capable model first; the gateway refusing one moves to the next (lib/ai/ladder.ts).
  const { value: result, model } = await tryModels(MODELS.checkLadder, (candidate) =>
    generateText({
      model: candidate,
      instructions: {
        role: "system",
        content: system,
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
      prompt,
      output: Output.object({
        name: "ad_check",
        description: "Compliance findings and hidden-text candidates for one ad.",
        schema: AnalysisOutputSchema,
      }),
      providerOptions: cheapProviderOptions(candidate),
      maxOutputTokens: 8_000,
      maxRetries: 1,
      timeout: { totalMs: LLM_TIMEOUT_MS },
    }),
  );

  const inputTokens = result.usage.inputTokens ?? 0;
  const outputTokens = result.usage.outputTokens ?? 0;
  const cacheRead = result.usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const cacheWrite = result.usage.inputTokenDetails?.cacheWriteTokens ?? 0;
  const output = result.output;

  const modelFindings: ContentFinding[] = output.findings.map((f) =>
    clampSeverity(
      {
        rule_code: f.rule_code,
        severity: f.severity,
        quote: f.quote,
        explanation: f.explanation,
        suggested_fix: f.suggested_fix,
        suggested_copy: f.suggested_copy ?? undefined,
        evidence_type: f.evidence_type,
      },
      rules,
    ),
  );

  const modelHidden: HiddenTextCandidate[] = output.hidden_text
    .filter((h) => h.excerpt.trim().length >= 4)
    .map((h) => ({ excerpt: h.excerpt.trim().slice(0, 300), location: h.location.slice(0, 120), kind: h.kind }));

  const allHidden = mergeHidden(hidden, modelHidden);
  const hiddenCode = hiddenTextRuleCode(rules).toUpperCase();
  return {
    ...base,
    findings: mergeFindings(
      [...deterministic, ...hiddenTextFindings(allHidden, rules)],
      // The model's own hidden-text findings are superseded by the merged alert list.
      modelFindings.filter((f) => f.rule_code.trim().toUpperCase() !== hiddenCode),
      rules,
    ),
    hidden_text: allHidden,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_tokens: cacheRead,
      cache_write_tokens: cacheWrite,
      cost_usd: costUsd(model, inputTokens, outputTokens, { read: cacheRead, write: cacheWrite }),
      model,
    },
    model_called: true,
  };
}

function mergeHidden(a: HiddenTextCandidate[], b: HiddenTextCandidate[]): HiddenTextCandidate[] {
  const out: HiddenTextCandidate[] = [];
  const seen = new Set<string>();
  for (const h of [...a, ...b]) {
    const key = normalizeForMatch(h.excerpt).slice(0, 100);
    if (!key || seen.has(key)) continue;
    // Also skip model candidates that are substrings of a deterministic one (or vice versa).
    if (out.some((o) => normalizeForMatch(o.excerpt).includes(key) || key.includes(normalizeForMatch(o.excerpt).slice(0, 100)))) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}
