import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

/**
 * AI budget: model ids, prices and the reserve / settle / release wrappers
 * around the database budget RPCs (docs/schema.md §4). Every LLM call in the
 * product goes through reserveBudget first; the database refuses when a cap
 * would be exceeded, so spend can never overshoot the $5/day global cap.
 *
 * Pure except for the RPC wrappers, which take the admin client as an
 * argument so they stay importable from scripts.
 */

/**
 * Model choice (docs/ai-policy.md). Chosen 2026-11-07 from published
 * instruction-following benchmarks and the gateway price list, not by brand:
 *
 *   check  openai/gpt-oss-120b   $0.10/$0.50 per 1M. Best instruction follower
 *          among the models the gateway serves on every plan (IFEval 79,
 *          IFBench 69%); structured output; ~$0.0014 per check.
 *   cheap  openai/gpt-5-nano     $0.05/$0.40 per 1M. Vision + structured
 *          output for the easy jobs: transcription, Ask, classification.
 *
 * Each call walks a ladder (lib/ai/ladder.ts): when the gateway refuses a
 * model (plan restriction, unknown id) the next one is tried and the run
 * records which model answered. Haiku is last: as good or better, but it
 * needs paid credits on the gateway.
 */
export const DEFAULT_CHECK_MODEL = "openai/gpt-oss-120b";
export const CHEAP_MODEL = "openai/gpt-5-nano";

/**
 * Fallbacks after the check model, in order. All take structured output.
 * Known-answer eval, 2026-11-07 (scripts/eval.ts, 20 fixtures): gpt-oss-120b
 * recall 83%, 15 false positives, $0.0012/ad; gpt-5-mini recall 100%, 38 false
 * positives, $0.0022/ad; gemini-2.5-flash-lite recall 67%, 31 false positives.
 * gpt-5-nano is not in this ladder: when it caught the fallback it invented
 * hidden-text findings and flagged compliant ads.
 */
export const CHECK_FALLBACKS = ["openai/gpt-5-mini", "google/gemini-2.5-flash-lite", "anthropic/claude-haiku-5.5"] as const;
/** Fallbacks after the cheap model, in order. All read images. */
export const CHEAP_FALLBACKS = ["google/gemini-2.5-flash-lite", "anthropic/claude-haiku-5.5"] as const;

let warnedCheckModel: string | null = null;

/**
 * The check model: AI_CHECK_MODEL when set (any gateway id), else the default.
 * Opus ids are refused (policy: never Opus) and fall back to the default.
 */
export function resolveCheckModel(): string {
  const raw = process.env.AI_CHECK_MODEL?.trim();
  if (!raw) return DEFAULT_CHECK_MODEL;
  if (/opus/i.test(raw)) {
    if (warnedCheckModel !== raw) {
      warnedCheckModel = raw;
      console.warn(`[ai/budget] AI_CHECK_MODEL="${raw}" refused (Opus is never used); using ${DEFAULT_CHECK_MODEL}.`);
    }
    return DEFAULT_CHECK_MODEL;
  }
  return raw;
}

/**
 * Model ids as gateway strings. `check` is read from the environment on
 * every access so scripts and tests can change AI_CHECK_MODEL late.
 */
export const MODELS = {
  /** Full check of an ad: structured output, quotes, suggestions. */
  get check(): string {
    return resolveCheckModel();
  },
  /** The check model followed by its fallbacks, without repeats. */
  get checkLadder(): string[] {
    return Array.from(new Set([resolveCheckModel(), ...CHECK_FALLBACKS]));
  },
  /** Classification, chat, transcription, extraction. */
  cheap: CHEAP_MODEL,
  /** The cheap model followed by its fallbacks. */
  cheapLadder: [CHEAP_MODEL, ...CHEAP_FALLBACKS] as readonly string[],
} as const;

export type ModelId = string;

export type ModelPrice = {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M cached input tokens read (Anthropic: 10% of input). */
  cacheRead: number;
  /** USD per 1M cached input tokens written (Anthropic 5-minute cache: 125% of input). */
  cacheWrite: number;
};

function anthropicPrice(input: number, output: number): ModelPrice {
  return { input, output, cacheRead: input * 0.1, cacheWrite: input * 1.25 };
}

/** OpenAI and Google bill cached input at a discount and charge nothing extra to write it. */
function implicitCachePrice(input: number, output: number, cacheReadShare: number): ModelPrice {
  return { input, output, cacheRead: input * cacheReadShare, cacheWrite: input };
}

/** USD per 1M tokens (Vercel AI Gateway list prices, checked 2026-11-07). */
export const PRICES_PER_MTOK: Record<string, ModelPrice> = {
  "openai/gpt-oss-120b": implicitCachePrice(0.1, 0.5, 0.5),
  "openai/gpt-oss-20b": implicitCachePrice(0.03, 0.14, 0.5),
  "openai/gpt-5-nano": implicitCachePrice(0.05, 0.4, 0.1),
  "openai/gpt-5-mini": implicitCachePrice(0.25, 2, 0.1),
  "google/gemini-2.5-flash-lite": implicitCachePrice(0.1, 0.4, 0.25),
  "anthropic/claude-haiku-5.5": anthropicPrice(0.1, 0.5),
  "anthropic/claude-sonnet-5.5": anthropicPrice(2, 10),
  "anthropic/claude-haiku-4.5": anthropicPrice(1, 5),
  "anthropic/claude-sonnet-4.5": anthropicPrice(3, 15),
  "anthropic/claude-sonnet-4": anthropicPrice(3, 15),
};

/** Unknown ids are priced like Sonnet so estimates and reservations stay conservative. */
export const FALLBACK_PRICE: ModelPrice = PRICES_PER_MTOK["anthropic/claude-sonnet-5.5"];

export type BudgetPurpose = "classification" | "analysis" | "suggestion" | "change_request_draft" | "chat";

export function priceFor(model: string): ModelPrice {
  return PRICES_PER_MTOK[model.trim()] ?? FALLBACK_PRICE;
}

export type CacheUsage = {
  /** Input tokens served from the prompt cache (a subset of inputTokens). */
  read?: number;
  /** Input tokens written to the prompt cache (a subset of inputTokens). */
  write?: number;
};

/**
 * Real cost from token usage, rounded to 6 decimals (numeric(10,6) in the
 * DB). `inputTokens` is the total; cached reads and writes inside it are
 * priced at their own rates when given.
 */
export function costUsd(model: string, inputTokens: number, outputTokens: number, cache: CacheUsage = {}): number {
  const p = priceFor(model);
  const read = Math.max(0, Math.min(cache.read ?? 0, inputTokens));
  const write = Math.max(0, Math.min(cache.write ?? 0, inputTokens - read));
  const plain = Math.max(0, inputTokens - read - write);
  const usd = (plain * p.input + read * p.cacheRead + write * p.cacheWrite + outputTokens * p.output) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

/**
 * Conservative pre-call estimate: ~4 characters per input token, doubled for
 * safety, plus an expected output size.
 */
export function estimateCostUsd(model: string, inputChars: number, expectedOutputTokens: number): number {
  const inputTokens = Math.ceil(inputChars / 4) * 2;
  const usd = costUsd(model, inputTokens, expectedOutputTokens);
  // Never reserve less than a tenth of a cent, so tiny calls still count.
  return Math.max(usd, 0.001);
}

type Admin = SupabaseClient<Database>;

export type Reservation = { requestId: string; estUsd: number; purpose: BudgetPurpose };

/**
 * Reserves budget for one LLM call. Returns null when a cap would be
 * exceeded (the caller must not call the model). Throws only on transport
 * or RPC errors.
 */
export async function reserveBudget(
  admin: Admin,
  input: {
    profileId: string;
    estUsd: number;
    purpose: BudgetPurpose;
    userId?: string | null;
    analysisRunId?: string | null;
    sourceItemId?: string | null;
  },
): Promise<Reservation | null> {
  const requestId = crypto.randomUUID();
  const { data, error } = await admin.rpc("reserve_ai_budget", {
    p_profile_id: input.profileId,
    p_est_usd: input.estUsd,
    p_request_id: requestId,
    p_purpose: input.purpose,
    ...(input.userId ? { p_user_id: input.userId } : {}),
    ...(input.analysisRunId ? { p_analysis_run_id: input.analysisRunId } : {}),
    ...(input.sourceItemId ? { p_source_item_id: input.sourceItemId } : {}),
  });
  if (error) throw new Error(`reserve_ai_budget failed: ${error.code ?? ""} ${error.message}`);
  if (data !== true) return null;
  return { requestId, estUsd: input.estUsd, purpose: input.purpose };
}

/** Records the real tokens and cost of a call that happened. Never throws. */
export async function settleBudget(
  admin: Admin,
  input: {
    requestId: string;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    model: string;
    analysisRunId?: string | null;
  },
): Promise<void> {
  const { error } = await admin.rpc("settle_ai_budget", {
    p_request_id: input.requestId,
    p_actual_cost: Math.max(0, input.costUsd),
    p_input_tokens: Math.max(0, Math.round(input.inputTokens)),
    p_output_tokens: Math.max(0, Math.round(input.outputTokens)),
    p_model: input.model,
    ...(input.analysisRunId ? { p_analysis_run_id: input.analysisRunId } : {}),
  });
  if (error) console.error("[ai/budget] settle_ai_budget failed:", error.code, error.message);
}

/** Frees a reservation when no call was made. Never throws. */
export async function releaseBudget(admin: Admin, requestId: string): Promise<void> {
  const { error } = await admin.rpc("release_ai_budget", { p_request_id: requestId });
  if (error) console.error("[ai/budget] release_ai_budget failed:", error.code, error.message);
}

/** Turns gateway / SDK errors into a sentence a reviewer can act on. */
export function friendlyAiError(raw: string): string {
  if (/customer_verification_required|credit card on file/i.test(raw)) {
    return "The AI gateway needs a payment card on the Vercel team before it serves requests.";
  }
  if (/Free tier users do not have access|RestrictedModelsError|no_providers_available/i.test(raw)) {
    return "The AI gateway does not serve any of the configured models on its current plan.";
  }
  if (/No authentication provided|AI_GATEWAY_API_KEY|OIDC|GatewayAuthenticationError|authentication/i.test(raw)) {
    return "The AI gateway is not configured on this server.";
  }
  if (/timeout|timed out|TimeoutError|aborted/i.test(raw)) {
    return "The AI service took too long to answer.";
  }
  if (/rate limit|429/i.test(raw)) {
    return "The AI service is busy (rate limited).";
  }
  if (/NoObjectGeneratedError|schema|validation/i.test(raw)) {
    return "The AI returned an answer in the wrong shape and it was discarded.";
  }
  if (/insufficient|quota|credits|billing|payment/i.test(raw)) {
    return "The AI gateway refused the request for billing reasons.";
  }
  return "";
}

/** True when the gateway can authenticate in this process (key or Vercel OIDC). */
export function isAiGatewayConfigured(): boolean {
  return Boolean(
    process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim() || process.env.VERCEL === "1",
  );
}
