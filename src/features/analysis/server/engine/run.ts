import "server-only";

import type { VersionContent } from "@/features/ads/types";
import type { Section } from "@/features/analysis/extract";
import { normalizedTextHash } from "@/features/analysis/hash";
import { detectHiddenText } from "@/features/analysis/hidden-text";
import { deterministicOfferRuleCodes } from "@/features/analysis/offer-checks";
import { promptHash } from "@/features/analysis/prompts";
import { analyzeContent, hiddenTextRuleCode, mergeFindings } from "@/features/analysis/server/analyze";
import { findRecording, recordedFindings } from "@/features/analysis/server/recorded";
import { asProduct, type Product } from "@/features/products/catalog";
import { reserveBudget, settleBudget, type Reservation } from "@/lib/ai/budget";
import { getAiMode } from "@/lib/ai/mode";
import { requireSupabaseAdminClient } from "@/lib/supabase/admin";
import { downloadObject } from "@/lib/supabase/storage";
import type { Json } from "@/lib/supabase/types";

import { loadAsset, loadOffers, loadRules, loadVersion, type Admin, type AssetRow } from "./inputs";
import { closeReservationAfterFailure, estimateLiveRunUsd, transcribe } from "./live";
import { declineRun, failRun, finishRun, friendlyError, keepDeterministicFindings, type DeterministicFallback, type RunContext } from "./outcomes";
import { errorText, flagManualReview, insertAlerts, setStage } from "./records";
import { computeReuseKey, findReusableRun, loadFindingsToCopy, loadModelAlerts } from "./reuse";

/**
 * The check engine's run: claims a queued analysis run, checks the version
 * against the workspace's rules and product terms, and persists findings,
 * alerts, coverage and cost. Never throws: every failure is recorded on the
 * run and a submitted ad falls back to "needs manual review".
 *
 * How a run gets its findings (analysis_runs.input_metadata.mode):
 *   reused  an earlier complete run in the workspace had the same reuse key
 *           (same text, rules, terms, prompt): its findings are copied at $0
 *   live    AI_MODE=live: budget reserved, one model call, settled
 *   replay  AI_MODE=replay and fixtures/recorded has this text: recorded
 *           findings, $0
 *   off     AI_MODE=off (the default outside production): deterministic
 *           findings only (product terms, hidden text), $0, still 'complete'
 * The deterministic checks run first in every mode. See docs/ai-policy.md.
 */

/** Claims and runs one analysis run end to end. Never throws. */
export async function runAnalysis(runId: string): Promise<void> {
  let admin: Admin;
  try {
    admin = requireSupabaseAdminClient();
  } catch (err) {
    console.error("[ai/engine] no admin client:", errorText(err));
    return;
  }

  // Claim: queued -> running. Someone else may have claimed it already.
  const { data: run, error: claimError } = await admin
    .from("analysis_runs")
    .update({ status: "running", stage: "extract" })
    .eq("id", runId)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();
  if (claimError) {
    console.error("[ai/engine] claim failed:", claimError.code, claimError.message);
    return;
  }
  if (!run) return;

  const mode = getAiMode();
  let reservation: Reservation | null = null;
  let settled = false;
  let asset: AssetRow | null = null;
  let fallback: DeterministicFallback | null = null;

  try {
    const version = await loadVersion(admin, run);
    asset = await loadAsset(admin, version.asset_id);
    const content = (version.content ?? {}) as VersionContent;
    const sections: Section[] = Array.isArray(content.sections) ? content.sections : [];
    const product: Product = asProduct(asset.product);
    const format = content.format ?? "text";
    const channel = asset.channel ?? content.meta?.channel ?? null;

    // ---- stage: extract -------------------------------------------------
    let text = version.extracted_text ?? "";
    let transcribed = false;
    const needsTranscription = (format === "image" || format === "pdf") && text.trim().length < 20 && Boolean(version.storage_path);

    // ---- stage: rules ---------------------------------------------------
    await setStage(admin, runId, "rules");
    const rules = await loadRules(admin, asset.profile_id, product);
    const offers = await loadOffers(admin, asset.profile_id, product);
    const hash = promptHash(rules, offers);

    // ---- stage: hidden text (deterministic, before any model call) -------
    await setStage(admin, runId, "hidden_text");
    const deterministicHidden = detectHiddenText({ html: content.html, text });
    const alertCount = await insertAlerts(admin, asset.profile_id, version.id, deterministicHidden, "deterministic");
    if (alertCount > 0) await flagManualReview(admin, asset, "hidden_text");

    // ---- stage: offer checks (deterministic, kept even if the model fails) ----
    await setStage(admin, runId, "offer_checks");
    const deterministic = await analyzeContent({
      text,
      html: content.html,
      product,
      channel: channel ?? undefined,
      format,
      rules,
      offers,
      transcribed,
      skipModel: true,
    });
    fallback = { findings: deterministic.findings, version, text, sections, rules, offers, transcribed: false };

    // Identical text (or identical image bytes) keyed with the exact rules, terms and prompt.
    // A file that needs transcription is keyed by its bytes: two different scans can share a short text layer ("Page 1").
    const textHash = needsTranscription ? version.content_sha256 : (version.normalized_text_hash ?? normalizedTextHash(text));
    const reuseKey = textHash ? computeReuseKey(textHash, rules, offers, hash) : null;

    const ctx: RunContext = {
      runId,
      asset,
      version,
      sections,
      rules,
      offers,
      product,
      format,
      channel,
      anchorText: text,
      text,
      transcribed: false,
      deterministicHidden,
      deterministicAlertCount: alertCount,
      promptHash: hash,
      reuseKey,
    };
    const deterministicCodes = new Set([...deterministicOfferRuleCodes(rules, product), hiddenTextRuleCode(rules).toUpperCase()]);

    // ---- stage: reuse (every mode): a previous identical check costs nothing ----
    await setStage(admin, runId, "reuse_lookup");
    const previous = reuseKey ? await findReusableRun(admin, asset.profile_id, reuseKey, runId) : null;
    if (previous) {
      const copied = await loadFindingsToCopy(admin, previous.id, rules);
      const previousHidden = await loadModelAlerts(admin, previous.asset_version_id);
      await finishRun(admin, ctx, {
        mode: "reused",
        model: previous.model ?? "none",
        findings: copied.map((c) => c.finding),
        reusedFromFindingIds: copied.map((c) => c.id),
        reusedFromRunId: previous.id,
        extraHidden: previousHidden,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        checkedCodes: "all",
        deterministicCount: deterministic.deterministic_count,
        metadata: { reused_from_run_id: previous.id, reused_from_version_id: previous.asset_version_id, reused_findings: copied.length },
      });
      return;
    }

    // ---- no model allowed: recorded findings (replay) or deterministic only (off) ----
    if (mode !== "live") {
      const recording = mode === "replay" && !needsTranscription ? await findRecording(textHash) : null;
      if (recording) {
        await finishRun(admin, ctx, {
          mode: "replay",
          model: "recorded",
          findings: mergeFindings(deterministic.findings, recordedFindings(recording), rules),
          extraHidden: recording.hidden_text.filter((h) => !deterministicHidden.some((d) => sameExcerpt(d.excerpt, h.excerpt))),
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          checkedCodes: "all",
          deterministicCount: deterministic.deterministic_count,
          metadata: {
            recorded: {
              key: recording.key,
              model: recording.model,
              prompt_hash: recording.prompt_hash,
              recorded_at: recording.recorded_at,
              usage: recording.usage as unknown as Json,
            },
          },
        });
        return;
      }
      await finishRun(admin, ctx, {
        mode: "off",
        model: "none",
        findings: deterministic.findings,
        extraHidden: [],
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        checkedCodes: deterministicCodes,
        deterministicCount: deterministic.deterministic_count,
        metadata: { ai_mode: mode, ...(needsTranscription ? { transcription_skipped: true } : {}) },
      });
      return;
    }

    // ---- stage: budget --------------------------------------------------
    await setStage(admin, runId, "budget");
    const estUsd = estimateLiveRunUsd(text, rules, offers, needsTranscription);
    reservation = await reserveBudget(admin, {
      profileId: asset.profile_id,
      estUsd,
      purpose: "analysis",
      analysisRunId: runId,
    });
    if (!reservation) {
      await declineRun(admin, runId, asset, rules, offers, estUsd);
      return;
    }

    // ---- stage: transcribe (images and scanned PDFs) ----------------------
    let transcriptionUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    if (needsTranscription && version.storage_path) {
      await setStage(admin, runId, "transcribe");
      const bytes = await downloadObject(admin, version.storage_path);
      const mediaType = content.mimeType ?? (format === "pdf" ? "application/pdf" : "image/png");
      const t = await transcribe(bytes, mediaType);
      text = t.text;
      transcribed = true;
      transcriptionUsage = { inputTokens: t.inputTokens, outputTokens: t.outputTokens, costUsd: t.costUsd };
      // Re-run the deterministic checks on the transcript so a failed model call still keeps them.
      const onTranscript = await analyzeContent({ text, product, channel: channel ?? undefined, format, rules, offers, transcribed, skipModel: true });
      fallback = { findings: onTranscript.findings, version, text: "", sections, rules, offers, transcribed };
    }

    // ---- stage: llm -----------------------------------------------------
    await setStage(admin, runId, "llm");
    const analysis = await analyzeContent({
      text,
      html: content.html,
      product,
      channel: channel ?? undefined,
      format,
      rules,
      offers,
      transcribed,
    });

    // ---- settle budget as soon as the model work is done ----------------
    const inputTokens = analysis.usage.input_tokens + transcriptionUsage.inputTokens;
    const outputTokens = analysis.usage.output_tokens + transcriptionUsage.outputTokens;
    const totalCost = Math.round((analysis.usage.cost_usd + transcriptionUsage.costUsd) * 1e6) / 1e6;
    await settleBudget(admin, {
      requestId: reservation.requestId,
      costUsd: totalCost,
      inputTokens,
      outputTokens,
      model: analysis.usage.model,
      analysisRunId: runId,
    });
    settled = true;

    await finishRun(
      admin,
      { ...ctx, anchorText: transcribed ? "" : text, text, transcribed },
      {
        mode: "live",
        model: analysis.usage.model,
        findings: analysis.findings,
        // Alerts the model noticed that the deterministic scan did not.
        extraHidden: analysis.hidden_text.filter((h) => !deterministicHidden.some((d) => sameExcerpt(d.excerpt, h.excerpt))),
        usage: {
          inputTokens,
          outputTokens,
          costUsd: totalCost,
          cacheReadTokens: analysis.usage.cache_read_tokens,
          cacheWriteTokens: analysis.usage.cache_write_tokens,
        },
        checkedCodes: "all",
        deterministicCount: analysis.deterministic_count,
        metadata: transcribed ? { transcription_tokens: transcriptionUsage.inputTokens + transcriptionUsage.outputTokens } : {},
      },
    );
  } catch (err) {
    const message = errorText(err);
    console.error(`[ai/engine] run ${runId} failed:`, message);
    if (reservation && !settled) await closeReservationAfterFailure(admin, reservation.requestId, runId, err);
    await failRun(admin, runId, friendlyError(err), { profileId: run.profile_id, asset });
    // The product-terms and hidden-text checks do not need the model: keep what they found.
    if (fallback && fallback.findings.length > 0 && asset) await keepDeterministicFindings(admin, run, asset, fallback, mode);
  }
}

function sameExcerpt(a: string, b: string): boolean {
  return a.toLowerCase().includes(b.toLowerCase().slice(0, 60));
}
