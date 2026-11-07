import "server-only";

import { generateText } from "ai";

import { TRANSCRIBE_SYSTEM_PROMPT } from "@/features/analysis/prompts";
import { LLM_TIMEOUT_MS } from "@/features/analysis/server/analyze";
import { MODELS, costUsd, estimateCostUsd, releaseBudget, settleBudget } from "@/lib/ai/budget";
import { cheapProviderOptions, tryModels } from "@/lib/ai/ladder";
import { assertModelCallsAllowed } from "@/lib/ai/mode";

import type { Admin, LoadedOffer, LoadedRule } from "./inputs";

/**
 * The paid parts of a live run (AI_MODE=live) around the check call itself:
 * what the run is expected to cost before its budget is reserved, the image
 * and scanned-PDF transcription call, and closing a reservation the run never
 * settled. The transcription estimate and the transcription call's limits
 * change together.
 */

const EXPECTED_OUTPUT_TOKENS = 3_000;

/** The reservation for a live run: the check call, plus transcription when the file has no usable text layer. */
export function estimateLiveRunUsd(text: string, rules: LoadedRule[], offers: LoadedOffer[], needsTranscription: boolean): number {
  const checkModel = MODELS.check;
  const promptChars = text.length + JSON.stringify(rules).length + JSON.stringify(offers.map((o) => o.terms)).length + 4_500;
  let estUsd = estimateCostUsd(checkModel, promptChars, EXPECTED_OUTPUT_TOKENS);
  if (needsTranscription) estUsd += estimateCostUsd(MODELS.cheap, 4_000, 2_000);
  return estUsd;
}

export async function transcribe(bytes: Uint8Array, mediaType: string): Promise<{ text: string; inputTokens: number; outputTokens: number; costUsd: number }> {
  assertModelCallsAllowed("image transcription");
  const { value: result, model } = await tryModels(MODELS.cheapLadder, (candidate) =>
    generateText({
      model: candidate,
      instructions: TRANSCRIBE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "file", data: bytes, mediaType },
            { type: "text", text: "Transcribe every piece of visible text in this ad, exactly as written." },
          ],
        },
      ],
      providerOptions: cheapProviderOptions(candidate),
      maxOutputTokens: 4_000,
      maxRetries: 1,
      timeout: { totalMs: Math.min(LLM_TIMEOUT_MS, 60_000) },
    }),
  );
  const inputTokens = result.usage.inputTokens ?? 0;
  const outputTokens = result.usage.outputTokens ?? 0;
  const text = result.text.trim() === "NO_TEXT" ? "" : result.text.trim();
  return { text, inputTokens, outputTokens, costUsd: costUsd(model, inputTokens, outputTokens) };
}

/**
 * Closes the reservation of a run that failed before settling. A model call
 * that ran but produced an unusable answer (NoObjectGeneratedError carries the
 * usage) still cost money: settle it so the ledger stays honest. Otherwise
 * nothing was spent and the reservation is released.
 */
export async function closeReservationAfterFailure(admin: Admin, requestId: string, runId: string, err: unknown): Promise<void> {
  const usage = (err as { usage?: { inputTokens?: number; outputTokens?: number } } | null)?.usage;
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  if (inputTokens > 0 || outputTokens > 0) {
    await settleBudget(admin, {
      requestId,
      costUsd: costUsd(MODELS.check, inputTokens, outputTokens),
      inputTokens,
      outputTokens,
      model: MODELS.check,
      analysisRunId: runId,
    });
  } else {
    await releaseBudget(admin, requestId);
  }
}
