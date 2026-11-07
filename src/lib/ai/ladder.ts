import type { generateText } from "ai";

/**
 * Model ladder: every model call names a list of models, cheapest-capable
 * first, and walks down it when the gateway refuses one (plan restriction,
 * unknown id, no provider) or the answer does not fit the schema. The model
 * that answered is returned with the result so the run records it and the
 * cost is priced for the right model.
 *
 * A refusal is remembered for a while so the next call skips straight to a
 * model that works; a real error (timeout, rate limit, server fault) is not a
 * refusal and is thrown as is. See docs/ai-policy.md.
 */

const REMEMBER_REFUSAL_MS = 10 * 60 * 1000;
const refusedUntil = new Map<string, number>();

function errorText(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as { message?: unknown; name?: unknown; responseBody?: unknown; cause?: unknown; data?: unknown };
  const parts = [e.name, e.message, e.responseBody, e.data ? JSON.stringify(e.data) : "", e.cause ? errorText(e.cause) : ""];
  return parts.filter((p) => typeof p === "string" && p).join(" | ");
}

/** The gateway will not serve this model at all (as opposed to failing this one call). */
export function isModelRefused(err: unknown): boolean {
  return /Free tier users do not have access|RestrictedModelsError|no_providers_available|customer_verification_required|model_not_found|model .* (does not exist|not found)|unsupported model|invalid model|no such model/i.test(
    errorText(err),
  );
}

/** The model answered but not in the requested shape. Worth one try on the next model. */
export function isMalformedAnswer(err: unknown): boolean {
  return /NoObjectGeneratedError|No object generated|JSONParseError|TypeValidationError/i.test(errorText(err));
}

/** Per-model options that keep reasoning models cheap and fast. Other providers ignore the keys they do not know. */
type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]["providerOptions"]>;

export function cheapProviderOptions(model: string): ProviderOptions {
  return {
    openai: { reasoningEffort: /gpt-oss/i.test(model) ? "low" : "minimal" },
    google: { thinkingConfig: { thinkingBudget: 0 } },
  };
}

export type LadderResult<T> = { value: T; model: string; skipped: string[] };

/**
 * Runs `attempt` with each model in turn. Models the gateway refused recently
 * are skipped (unless every model is in that state, in which case all are
 * tried again). Throws the last error when no model answers.
 */
export async function tryModels<T>(models: readonly string[], attempt: (model: string) => Promise<T>): Promise<LadderResult<T>> {
  const now = Date.now();
  const unique = Array.from(new Set(models.map((m) => m.trim()).filter(Boolean)));
  const fresh = unique.filter((m) => (refusedUntil.get(m) ?? 0) <= now);
  const order = fresh.length > 0 ? fresh : unique;
  const skipped: string[] = [];
  const retried = new Set<string>();
  let lastError: unknown = new Error("No model configured.");
  for (const model of order) {
    try {
      const value = await attempt(model);
      return { value, model, skipped };
    } catch (err) {
      lastError = err;
      if (isModelRefused(err)) {
        refusedUntil.set(model, Date.now() + REMEMBER_REFUSAL_MS);
        skipped.push(model);
        console.warn(`[ai/ladder] ${model} refused by the gateway; trying the next model.`);
        continue;
      }
      if (isMalformedAnswer(err)) {
        // A malformed answer is usually a one-off: one more try on the same model
        // before moving down, because the next rung may be worse at this job.
        if (!retried.has(model)) {
          retried.add(model);
          console.warn(`[ai/ladder] ${model} answered in the wrong shape; retrying once.`);
          try {
            const value = await attempt(model);
            return { value, model, skipped };
          } catch (again) {
            lastError = again;
            if (!isMalformedAnswer(again) && !isModelRefused(again)) throw again;
          }
        }
        if (model !== order[order.length - 1]) {
          skipped.push(model);
          console.warn(`[ai/ladder] ${model} answered in the wrong shape twice; trying the next model.`);
          continue;
        }
      }
      throw lastError;
    }
  }
  throw lastError;
}
