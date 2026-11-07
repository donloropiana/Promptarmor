import "server-only";

import type { Section } from "@/features/analysis/extract";
import type { ContentFinding, HiddenTextCandidate } from "@/features/analysis/schema";
import type { Product } from "@/features/products/catalog";
import { friendlyAiError } from "@/lib/ai/budget";
import type { AiMode, RunMode } from "@/lib/ai/mode";
import type { Json } from "@/lib/supabase/types";

import { persistFindings } from "./findings";
import { loadAsset, type Admin, type AssetRow, type LoadedOffer, type LoadedRule, type RunRow, type VersionRow } from "./inputs";
import { errorText, flagManualReview, insertAlerts, logEvent, type AlertDetector } from "./records";

/**
 * How a run ends, and what each ending writes: complete (alerts, findings,
 * rule results, coverage, the run row and the audit event), declined by the
 * budget, or failed (with the deterministic findings kept). Every ending that
 * leaves a submitted ad unchecked sends it to manual review.
 */

/** Everything the finishing steps need, gathered once per run. */
export type RunContext = {
  runId: string;
  asset: AssetRow;
  version: VersionRow;
  sections: Section[];
  rules: LoadedRule[];
  offers: LoadedOffer[];
  product: Product;
  format: string;
  channel: string | null;
  /** Text findings are anchored into ("" when quotes cannot be verified, e.g. a transcript). */
  anchorText: string;
  /** The full text that was checked (for metadata and the transcript). */
  text: string;
  transcribed: boolean;
  /** Hidden-text candidates the deterministic scan found (alerts already inserted). */
  deterministicHidden: HiddenTextCandidate[];
  deterministicAlertCount: number;
  promptHash: string;
  reuseKey: string | null;
};

type FinishInput = {
  mode: RunMode;
  /** analysis_runs.model: the model id, 'recorded', or 'none'. */
  model: string;
  findings: ContentFinding[];
  /** Parallel to findings: the finding each one was copied from (reused runs). */
  reusedFromFindingIds?: (string | null)[];
  reusedFromRunId?: string | null;
  /** Hidden-text candidates that did not come from the deterministic scan (model, recording, or the reused run). */
  extraHidden: HiddenTextCandidate[];
  usage: { inputTokens: number; outputTokens: number; costUsd: number; cacheReadTokens: number; cacheWriteTokens: number };
  /** Rule codes (upper case) that count as checked when nothing was found; "all" after a model call. */
  checkedCodes: Set<string> | "all";
  deterministicCount: number;
  metadata?: Record<string, Json>;
};

/** Shared tail of every successful run: alerts, findings, rule results, coverage, the run row and the audit event. */
export async function finishRun(admin: Admin, ctx: RunContext, input: FinishInput): Promise<void> {
  const { runId, asset, version, rules, offers, product } = ctx;

  const extraAlertCount = await insertAlerts(admin, asset.profile_id, version.id, input.extraHidden, detectorFor(input.mode));
  if (extraAlertCount > 0) await flagManualReview(admin, asset, "hidden_text");

  const { verified, insertedIds, prior } = await persistFindings(admin, runId, {
    profileId: asset.profile_id,
    version,
    findings: input.findings,
    text: ctx.anchorText,
    sections: ctx.sections,
    rules,
    transcribed: ctx.transcribed,
    reusedFromFindingIds: input.reusedFromFindingIds,
  });

  const findingIdsByRuleVersion = new Map<string, string[]>();
  verified.forEach((v, i) => {
    if (!v.rule_version_id || !insertedIds[i]) return;
    const list = findingIdsByRuleVersion.get(v.rule_version_id) ?? [];
    list.push(insertedIds[i]);
    findingIdsByRuleVersion.set(v.rule_version_id, list);
  });
  const ruleResults = rules.map((r) => {
    const applies = r.applies_to.includes("all") || r.applies_to.includes(product) || product === "unknown" || product === "other";
    const ids = findingIdsByRuleVersion.get(r.rule_version_id) ?? [];
    const checked = input.checkedCodes === "all" || input.checkedCodes.has(r.code.trim().toUpperCase());
    const result = ids.length > 0 ? "flagged" : !applies ? "na" : checked ? "pass" : "not_checked";
    return { rule_version_id: r.rule_version_id, result, finding_ids: ids };
  });
  const hiddenAlerts = ctx.deterministicAlertCount + extraAlertCount;
  const coverage = {
    rules_total: rules.length,
    rules_checked: ruleResults.filter((r) => r.result === "pass" || r.result === "flagged").length,
    offers_used: offers.map((o) => o.code),
    findings: verified.length,
    verified_spans: verified.filter((v) => v.verified).length,
    hidden_text_alerts: hiddenAlerts,
    deterministic_findings: input.deterministicCount,
    model_called: input.mode === "live",
    mode: input.mode,
  };
  const inputMetadata: Record<string, Json> = {
    mode: input.mode,
    model: input.model,
    format: ctx.format,
    product,
    channel: ctx.channel,
    chars: ctx.text.length,
    sections: ctx.sections.length,
    transcribed: ctx.transcribed,
    ...(ctx.transcribed ? { transcript: ctx.text.slice(0, 20_000) } : {}),
    hidden_text_count: ctx.deterministicHidden.length + input.extraHidden.length,
    prior_findings: prior.length,
    cache_read_tokens: input.usage.cacheReadTokens,
    cache_write_tokens: input.usage.cacheWriteTokens,
    ...(input.metadata ?? {}),
  };

  const { error: completeError } = await admin
    .from("analysis_runs")
    .update({
      status: "complete",
      stage: "done",
      model: input.model,
      prompt_hash: ctx.promptHash,
      rule_version_ids: rules.map((r) => r.rule_version_id),
      offer_version_ids: offers.map((o) => o.offer_version_id),
      rule_results: ruleResults as Json,
      coverage: coverage as Json,
      input_metadata: inputMetadata as Json,
      input_tokens: input.usage.inputTokens,
      output_tokens: input.usage.outputTokens,
      cost_usd: input.usage.costUsd,
      reuse_key: ctx.reuseKey,
      reused_from_run_id: input.reusedFromRunId ?? null,
      error: null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (completeError) throw new Error(`run completion failed: ${completeError.code ?? ""} ${completeError.message}`);

  await logEvent(admin, asset.profile_id, asset.id, "analysis.completed", {
    run_id: runId,
    asset_version_id: version.id,
    mode: input.mode,
    findings: verified.length,
    critical: verified.filter((v) => v.finding.severity === "critical").length,
    major: verified.filter((v) => v.finding.severity === "major").length,
    minor: verified.filter((v) => v.finding.severity === "minor").length,
    hidden_text_alerts: hiddenAlerts,
    cost_usd: input.usage.costUsd,
    model: input.model,
    prompt_hash: ctx.promptHash,
    ...(input.reusedFromRunId ? { reused_from_run_id: input.reusedFromRunId } : {}),
  });
}

function detectorFor(mode: RunMode): AlertDetector {
  return mode === "replay" ? "recorded" : mode === "reused" ? "reused" : "model";
}

export async function declineRun(admin: Admin, runId: string, asset: AssetRow, rules: LoadedRule[], offers: LoadedOffer[], estUsd: number): Promise<void> {
  await admin
    .from("analysis_runs")
    .update({
      status: "declined_budget",
      stage: "budget",
      error: `Daily AI budget reached (needed about $${estUsd.toFixed(3)}). The ad was not checked by AI; a person must review it.`,
      rule_version_ids: rules.map((r) => r.rule_version_id),
      offer_version_ids: offers.map((o) => o.offer_version_id),
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);
  await flagManualReview(admin, asset, "declined_budget");
  await logEvent(admin, asset.profile_id, asset.id, "analysis.declined_budget", { run_id: runId, est_usd: estUsd });
}

export async function failRun(admin: Admin, runId: string, message: string, ctx: { profileId: string; asset?: AssetRow | null }): Promise<void> {
  const { data: run } = await admin
    .from("analysis_runs")
    .update({ status: "failed", stage: "failed", error: message.slice(0, 1_000), completed_at: new Date().toISOString() })
    .eq("id", runId)
    .in("status", ["queued", "running"])
    .select("asset_version_id")
    .maybeSingle();
  if (!run) return;
  let asset = ctx.asset ?? null;
  if (!asset) {
    const { data: v } = await admin.from("asset_versions").select("asset_id").eq("id", run.asset_version_id).maybeSingle();
    if (v?.asset_id) asset = await loadAsset(admin, v.asset_id).catch(() => null);
  }
  if (asset) {
    await flagManualReview(admin, asset, "analysis_failed");
    await logEvent(admin, asset.profile_id, asset.id, "analysis.failed", { run_id: runId, error: message.slice(0, 300) });
  } else {
    await logEvent(admin, ctx.profileId, null, "analysis.failed", { run_id: runId, error: message.slice(0, 300) });
  }
}

/**
 * The sentence stored on the run and shown on the ad page. Raw provider,
 * SDK and database messages stay in the server log: they can carry request
 * ids, URLs and echoed prompt fragments that do not belong in the UI.
 */
export function friendlyError(err: unknown): string {
  const raw = errorText(err);
  const known = friendlyAiError(raw);
  if (known) return `The AI check could not run: ${known} A person must review this ad.`;
  if (/Download failed|storage/i.test(raw)) return "The AI check could not run: the uploaded file could not be read back from storage. A person must review this ad.";
  if (/NO_TEXT|no readable text/i.test(raw)) return "The AI check could not run: no readable text was found in the file. A person must review this ad.";
  const name = err instanceof Error && err.name && err.name !== "Error" ? ` (${err.name})` : "";
  return `The AI check failed${name}. A person must review this ad.`;
}

/** What the deterministic checks found, kept so a failed model call still leaves real issues behind. */
export type DeterministicFallback = {
  findings: ContentFinding[];
  version: VersionRow;
  text: string;
  sections: Section[];
  rules: LoadedRule[];
  offers: LoadedOffer[];
  transcribed: boolean;
};

/**
 * After failRun: the product-terms and hidden-text checks do not need the
 * model, so keep what they found on the failed run. Never throws.
 */
export async function keepDeterministicFindings(admin: Admin, run: RunRow, asset: AssetRow, fallback: DeterministicFallback, mode: AiMode): Promise<void> {
  try {
    const kept = await persistFindings(admin, run.id, {
      profileId: asset.profile_id,
      version: fallback.version,
      findings: fallback.findings,
      text: fallback.text,
      sections: fallback.sections,
      rules: fallback.rules,
      transcribed: fallback.transcribed,
      touchStage: false,
    });
    await admin
      .from("analysis_runs")
      .update({
        coverage: { rules_total: fallback.rules.length, rules_checked: 0, deterministic_findings: kept.insertedIds.length, model_called: false, mode } as Json,
        rule_version_ids: fallback.rules.map((r) => r.rule_version_id),
        // Recorded on failure too, so the audit record (and "Rates changed" after a
        // product-terms edit) knows which terms the product-terms check used.
        offer_version_ids: fallback.offers.map((o) => o.offer_version_id),
        input_metadata: { ...(run.input_metadata as Record<string, Json> | null), mode, ai_mode: mode } as Json,
      })
      .eq("id", run.id);
  } catch (persistErr) {
    console.error("[ai/engine] fallback persistence failed:", errorText(persistErr));
  }
}
