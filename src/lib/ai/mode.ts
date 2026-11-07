/**
 * AI_MODE: whether this process may call a model at all.
 *
 *   live    model calls allowed (budget reserved and settled around each one)
 *   off     no model call, ever: checks complete with the deterministic
 *           findings only (product terms, hidden text)
 *   replay  no model call, ever: like off, but when the ad's text matches a
 *           recording in fixtures/recorded/ the recorded findings are used
 *
 * Default: live in production on Vercel (VERCEL_ENV=production), off
 * everywhere else, so local work and previews never spend. Reuse of an
 * earlier identical check ($0) works in every mode. See docs/ai-policy.md.
 *
 * Pure (reads process.env on every call, so scripts can set it late) and
 * safe to import from scripts and client-free server code.
 */

export const AI_MODES = ["live", "off", "replay"] as const;
export type AiMode = (typeof AI_MODES)[number];

/** How a finished run got its findings (analysis_runs.input_metadata.mode). */
export type RunMode = "live" | "off" | "replay" | "reused";

function isAiMode(v: string): v is AiMode {
  return (AI_MODES as readonly string[]).includes(v);
}

let warned = false;

export function getAiMode(): AiMode {
  const raw = (process.env.AI_MODE ?? "").trim().toLowerCase();
  if (raw && isAiMode(raw)) return raw;
  if (raw && !warned) {
    warned = true;
    console.warn(`[ai/mode] AI_MODE="${raw}" is not one of ${AI_MODES.join(", ")}; falling back to the default.`);
  }
  return process.env.VERCEL_ENV === "production" ? "live" : "off";
}

/** True only in live mode: the single switch every model call checks first. */
export function modelCallsAllowed(): boolean {
  return getAiMode() === "live";
}

export class ModelCallsDisabledError extends Error {
  readonly mode: AiMode;
  constructor(purpose: string, mode: AiMode) {
    super(`Model call for ${purpose} blocked: AI_MODE is "${mode}". Set AI_MODE=live to allow AI spend.`);
    this.name = "ModelCallsDisabledError";
    this.mode = mode;
  }
}

/** Throws unless model calls are allowed. Called right before every generateText. */
export function assertModelCallsAllowed(purpose: string): void {
  const mode = getAiMode();
  if (mode !== "live") throw new ModelCallsDisabledError(purpose, mode);
}

/** Plain-English label for a run's mode, for logs and scripts (the UI has its own copy). */
export function describeRunMode(mode: RunMode | string | null | undefined): string {
  switch (mode) {
    case "live":
      return "AI check";
    case "reused":
      return "Reused an earlier identical check (no AI spend)";
    case "replay":
      return "Recorded check (no AI spend)";
    case "off":
      return "AI check skipped (test mode)";
    default:
      return "Check";
  }
}
