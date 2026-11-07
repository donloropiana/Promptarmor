import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

/**
 * AI budget: model ids, prices and the reserve / settle / release wrappers
 * around the database budget RPCs (docs/schema.md §4). Every LLM call in the
 * product goes through reserveBudget first; the database refuses when a cap
 * would be exceeded, so spend can never overshoot the $10/day global cap.
 *
 * Pure except for the RPC wrappers, which take the admin client as an
 * argument so they stay importable from scripts.
 */

export const MODELS = {
  /** Full check of an ad: structured output, quotes, suggestions. */
  check: "anthropic/claude-sonnet-5.5",
  /** Classification, chat, transcription, extraction. */
  cheap: "anthropic/claude-haiku-5.5",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS] | (string & {});

/** USD per 1M tokens (Vercel AI Gateway list prices, checked 2026-11-06). */
export const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  "anthropic/claude-sonnet-5.5": { input: 2, output: 10 },
  "anthropic/claude-haiku-5.5": { input: 0.1, output: 0.5 },
};

const FALLBACK_PRICE = { input: 10, output: 50 };

export type BudgetPurpose = "classification" | "analysis" | "suggestion" | "change_request_draft" | "chat";

export function priceFor(model: string): { input: number; output: number } {
  return PRICES_PER_MTOK[model] ?? FALLBACK_PRICE;
}

/** Real cost from token usage, rounded to 6 decimals (numeric(10,6) in the DB). */
export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(model);
  const usd = (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
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
