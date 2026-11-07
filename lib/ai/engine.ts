import "server-only";

import { generateText } from "ai";

import { sectionAtOffset, type Section } from "@/lib/intake/extract";
import { requireSupabaseAdminClient } from "@/lib/supabase/admin";
import { downloadObject } from "@/lib/supabase/storage";
import type { Database, Json, TablesInsert } from "@/lib/supabase/types";
import type { Product, Severity, VersionContent } from "@/lib/types/ads";
import type { SupabaseClient } from "@supabase/supabase-js";

import { analyzeContent, LLM_TIMEOUT_MS } from "./analyze";
import { MODELS, costUsd, estimateCostUsd, friendlyAiError, releaseBudget, reserveBudget, settleBudget, type Reservation } from "./budget";
import { detectHiddenText } from "./hidden-text";
import { TRANSCRIBE_SYSTEM_PROMPT } from "./prompts";
import { matchPriorFindings, type PriorFinding } from "./recheck";
import type { ContentFinding, HiddenTextCandidate, OfferInput, RuleInput } from "./schema";
import { locateQuote, spanHash } from "./spans";

export { analyzeContent } from "./analyze";
export { askAboutAd } from "./chat";

/**
 * The check engine: claims a queued analysis run, checks the version against
 * the workspace's rules and product terms, and persists findings, alerts,
 * coverage and cost. Never throws: every failure is recorded on the run and
 * a submitted ad falls back to "needs manual review".
 *
 * Call sites:
 *   after(() => startAnalysisForVersion(versionId))   right after intake
 *   after(() => nudgeStaleRuns(profileId))            from the Ads list
 *   GET /api/cron/analyze                              daily sweep (Hobby)
 */

type Admin = SupabaseClient<Database>;

/** A queued run older than this is considered stale and re-run by nudgeStaleRuns. */
export const STALE_QUEUED_MS = 2 * 60 * 1000;
/** A running run older than this is marked failed (the function that owned it is gone). */
export const STUCK_RUNNING_MS = 10 * 60 * 1000;

const EXPECTED_OUTPUT_TOKENS = 3_000;

type RunRow = Database["public"]["Tables"]["analysis_runs"]["Row"];
type VersionRow = Database["public"]["Tables"]["asset_versions"]["Row"];
type AssetRow = Pick<Database["public"]["Tables"]["assets"]["Row"], "id" | "profile_id" | "product" | "channel" | "status" | "submitted_at" | "title">;

type LoadedRule = RuleInput & { rule_id: string; rule_version_id: string; kind: string };
type LoadedOffer = OfferInput & { offer_id: string; offer_version_id: string };

function isProduct(v: unknown): v is Product {
  return v === "personal_loan" || v === "credit_card" || v === "mortgage" || v === "other" || v === "unknown";
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const causeText = cause instanceof Error ? ` (${cause.message})` : "";
    return `${err.name}: ${err.message}${causeText}`.slice(0, 1_000);
  }
  return String(err).slice(0, 1_000);
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/** Runs the queued analysis run for a version, if any. Never throws. */
export async function startAnalysisForVersion(versionId: string): Promise<void> {
  try {
    const admin = requireSupabaseAdminClient();
    const { data, error } = await admin
      .from("analysis_runs")
      .select("id")
      .eq("asset_version_id", versionId)
      .eq("status", "queued")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[ai/engine] queued run lookup failed:", error.code, error.message);
      return;
    }
    if (!data?.id) return;
    await runAnalysis(data.id);
  } catch (err) {
    console.error("[ai/engine] startAnalysisForVersion failed:", errorText(err));
  }
}

/**
 * Cheap recovery for runs the request that created them never finished
 * (cold start, timeout, lost after()). Marks runs stuck in 'running' for
 * over 10 minutes as failed, then re-runs up to `limit` queued runs older
 * than 2 minutes. Call it inside after() from a workspace page; it returns
 * quickly when there is nothing to do.
 */
export async function nudgeStaleRuns(profileId: string, options: { limit?: number } = {}): Promise<{ ran: number; failed: number }> {
  const limit = Math.max(1, Math.min(options.limit ?? 2, 5));
  const summary = { ran: 0, failed: 0 };
  try {
    const admin = requireSupabaseAdminClient();
    const stuckBefore = new Date(Date.now() - STUCK_RUNNING_MS).toISOString();
    const { data: stuck } = await admin
      .from("analysis_runs")
      .select("id, asset_version_id")
      .eq("profile_id", profileId)
      .eq("status", "running")
      .lt("created_at", stuckBefore)
      .limit(10);
    for (const run of stuck ?? []) {
      await failRun(admin, run.id, "Timed out: the check did not finish within 10 minutes.", { profileId });
      summary.failed++;
    }

    const staleBefore = new Date(Date.now() - STALE_QUEUED_MS).toISOString();
    const { data: queued } = await admin
      .from("analysis_runs")
      .select("id")
      .eq("profile_id", profileId)
      .eq("status", "queued")
      .lt("created_at", staleBefore)
      .order("created_at", { ascending: true })
      .limit(limit);
    for (const run of queued ?? []) {
      await runAnalysis(run.id);
      summary.ran++;
    }
  } catch (err) {
    console.error("[ai/engine] nudgeStaleRuns failed:", errorText(err));
  }
  return summary;
}

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

  let reservation: Reservation | null = null;
  let settled = false;
  let asset: AssetRow | null = null;
  /** What the deterministic checks found, kept so a failed model call still leaves real issues behind. */
  let fallback: { findings: ContentFinding[]; version: VersionRow; text: string; sections: Section[]; rules: LoadedRule[]; transcribed: boolean } | null = null;

  try {
    const version = await loadVersion(admin, run);
    asset = await loadAsset(admin, version.asset_id);
    const content = (version.content ?? {}) as VersionContent;
    const sections: Section[] = Array.isArray(content.sections) ? content.sections : [];
    const product: Product = isProduct(asset.product) ? asset.product : "unknown";
    const format = content.format ?? "text";

    // ---- stage: extract -------------------------------------------------
    let text = version.extracted_text ?? "";
    let transcribed = false;
    const needsTranscription = (format === "image" || format === "pdf") && text.trim().length < 20 && Boolean(version.storage_path);

    // ---- stage: rules ---------------------------------------------------
    await setStage(admin, runId, "rules");
    const rules = await loadRules(admin, asset.profile_id, product);
    const offers = await loadOffers(admin, asset.profile_id, product);

    // ---- stage: hidden text (deterministic, before any model call) -------
    await setStage(admin, runId, "hidden_text");
    const deterministicHidden = detectHiddenText({ html: content.html, text });
    const alertCount = await insertAlerts(admin, asset.profile_id, version.id, deterministicHidden, "deterministic");
    if (alertCount > 0) await flagManualReview(admin, asset, "hidden_text");

    // ---- stage: budget --------------------------------------------------
    await setStage(admin, runId, "budget");
    const promptChars = text.length + JSON.stringify(rules).length + JSON.stringify(offers.map((o) => o.terms)).length + 4_500;
    let estUsd = estimateCostUsd(MODELS.check, promptChars, EXPECTED_OUTPUT_TOKENS);
    if (needsTranscription) estUsd += estimateCostUsd(MODELS.cheap, 4_000, 2_000);
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
    }

    // ---- stage: offer checks (deterministic, kept even if the model fails) ----
    await setStage(admin, runId, "offer_checks");
    const deterministic = await analyzeContent({
      text,
      html: content.html,
      product,
      channel: asset.channel ?? content.meta?.channel,
      format,
      rules,
      offers,
      transcribed,
      skipModel: true,
    });
    fallback = { findings: deterministic.findings, version, text: transcribed ? "" : text, sections, rules, transcribed };

    // ---- stage: llm -----------------------------------------------------
    await setStage(admin, runId, "llm");
    const analysis = await analyzeContent({
      text,
      html: content.html,
      product,
      channel: asset.channel ?? content.meta?.channel,
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

    // Alerts the model noticed that the deterministic scan did not.
    const modelHidden = analysis.hidden_text.filter(
      (h) => !deterministicHidden.some((d) => d.excerpt.toLowerCase().includes(h.excerpt.toLowerCase().slice(0, 60))),
    );
    const modelAlertCount = await insertAlerts(admin, asset.profile_id, version.id, modelHidden, "model");
    if (modelAlertCount > 0) await flagManualReview(admin, asset, "hidden_text");

    // ---- stages: verify, recheck, persist --------------------------------
    const persisted = await persistFindings(admin, runId, {
      profileId: asset.profile_id,
      version,
      findings: analysis.findings,
      text: transcribed ? "" : text,
      sections,
      rules,
      transcribed,
    });
    const { verified, insertedIds, prior } = persisted;

    // rule_results + coverage
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
      const result = ids.length > 0 ? "flagged" : !applies ? "na" : analysis.model_called ? "pass" : "not_checked";
      return { rule_version_id: r.rule_version_id, result, finding_ids: ids };
    });
    const coverage = {
      rules_total: rules.length,
      rules_checked: ruleResults.filter((r) => r.result !== "na" && r.result !== "not_checked").length,
      offers_used: offers.map((o) => o.code),
      findings: verified.length,
      verified_spans: verified.filter((v) => v.verified).length,
      hidden_text_alerts: alertCount + modelAlertCount,
      deterministic_findings: analysis.deterministic_count,
    };
    const inputMetadata: Record<string, Json> = {
      format,
      product,
      channel: asset.channel ?? null,
      chars: text.length,
      sections: sections.length,
      transcribed,
      ...(transcribed ? { transcript: text.slice(0, 20_000) } : {}),
      hidden_text_count: deterministicHidden.length + modelHidden.length,
      prior_findings: prior.length,
    };

    const { error: completeError } = await admin
      .from("analysis_runs")
      .update({
        status: "complete",
        stage: "done",
        model: analysis.usage.model,
        prompt_hash: analysis.prompt_hash,
        rule_version_ids: rules.map((r) => r.rule_version_id),
        offer_version_ids: offers.map((o) => o.offer_version_id),
        rule_results: ruleResults as Json,
        coverage: coverage as Json,
        input_metadata: inputMetadata as Json,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: totalCost,
        error: null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
    if (completeError) throw new Error(`run completion failed: ${completeError.code ?? ""} ${completeError.message}`);

    await logEvent(admin, asset.profile_id, asset.id, "analysis.completed", {
      run_id: runId,
      asset_version_id: version.id,
      findings: verified.length,
      critical: verified.filter((v) => v.finding.severity === "critical").length,
      major: verified.filter((v) => v.finding.severity === "major").length,
      minor: verified.filter((v) => v.finding.severity === "minor").length,
      hidden_text_alerts: alertCount + modelAlertCount,
      cost_usd: totalCost,
      model: analysis.usage.model,
      prompt_hash: analysis.prompt_hash,
    });
  } catch (err) {
    const message = errorText(err);
    console.error(`[ai/engine] run ${runId} failed:`, message);
    if (reservation && !settled) await releaseBudget(admin, reservation.requestId);
    await failRun(admin, runId, friendlyError(message), { profileId: run.profile_id, asset });
    // The product-terms and hidden-text checks do not need the model: keep what they found.
    if (fallback && fallback.findings.length > 0 && asset) {
      try {
        const kept = await persistFindings(admin, runId, {
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
            coverage: { rules_total: fallback.rules.length, rules_checked: 0, deterministic_findings: kept.insertedIds.length, model_called: false } as Json,
            rule_version_ids: fallback.rules.map((r) => r.rule_version_id),
          })
          .eq("id", runId);
      } catch (persistErr) {
        console.error("[ai/engine] fallback persistence failed:", errorText(persistErr));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function loadVersion(admin: Admin, run: RunRow): Promise<VersionRow> {
  const { data, error } = await admin.from("asset_versions").select("*").eq("id", run.asset_version_id).single();
  if (error || !data) throw new Error(`version ${run.asset_version_id} not found: ${error?.message ?? ""}`);
  return data;
}

async function loadAsset(admin: Admin, assetId: string): Promise<AssetRow> {
  const { data, error } = await admin
    .from("assets")
    .select("id, profile_id, product, channel, status, submitted_at, title")
    .eq("id", assetId)
    .single();
  if (error || !data) throw new Error(`asset ${assetId} not found: ${error?.message ?? ""}`);
  return data;
}

async function loadRules(admin: Admin, profileId: string, product: Product): Promise<LoadedRule[]> {
  const { data: rules, error } = await admin
    .from("rules")
    .select("id, code, kind, current_version_id")
    .eq("profile_id", profileId)
    .eq("active", true);
  if (error) throw new Error(`rules load failed: ${error.message}`);
  const versionIds = (rules ?? []).map((r) => r.current_version_id).filter((id): id is string => Boolean(id));
  if (versionIds.length === 0) return [];
  const { data: versions, error: vError } = await admin
    .from("rule_versions")
    .select("id, rule_id, title, body, default_severity, applies_to")
    .in("id", versionIds);
  if (vError) throw new Error(`rule versions load failed: ${vError.message}`);
  const byRule = new Map((versions ?? []).map((v) => [v.rule_id, v]));
  const out: LoadedRule[] = [];
  for (const r of rules ?? []) {
    const v = byRule.get(r.id);
    if (!v) continue;
    const applies = v.applies_to ?? [];
    // Keep every active rule (the run records all of them in rule_results; n/a ones are marked).
    out.push({
      rule_id: r.id,
      rule_version_id: v.id,
      kind: r.kind,
      code: r.code,
      title: v.title,
      body: v.body,
      default_severity: (["critical", "major", "minor"].includes(v.default_severity) ? v.default_severity : "major") as Severity,
      applies_to: applies.length ? applies : ["all"],
    });
  }
  void product;
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

async function loadOffers(admin: Admin, profileId: string, product: Product): Promise<LoadedOffer[]> {
  const { data: offers, error } = await admin.from("offers").select("id, code, product, name").eq("profile_id", profileId).eq("active", true);
  if (error) throw new Error(`offers load failed: ${error.message}`);
  const relevant = (offers ?? []).filter((o) => product === "unknown" || product === "other" || o.product === product);
  if (relevant.length === 0) return [];
  const { data: versions, error: vError } = await admin
    .from("offer_versions")
    .select("id, offer_id, terms, version_no, effective_to")
    .in(
      "offer_id",
      relevant.map((o) => o.id),
    )
    .order("version_no", { ascending: false });
  if (vError) throw new Error(`offer versions load failed: ${vError.message}`);
  const current = new Map<string, { id: string; terms: Json }>();
  for (const v of versions ?? []) {
    if (current.has(v.offer_id)) continue;
    // Highest version_no first; prefer one still in effect.
    if (v.effective_to && new Date(v.effective_to).getTime() < Date.now()) continue;
    current.set(v.offer_id, { id: v.id, terms: v.terms });
  }
  // Offers whose every version has ended: fall back to the newest so the check still has numbers.
  for (const v of versions ?? []) if (!current.has(v.offer_id)) current.set(v.offer_id, { id: v.id, terms: v.terms });
  const out: LoadedOffer[] = [];
  for (const o of relevant) {
    const v = current.get(o.id);
    if (!v) continue;
    const terms = v.terms && typeof v.terms === "object" && !Array.isArray(v.terms) ? (v.terms as Record<string, unknown>) : {};
    out.push({ offer_id: o.id, offer_version_id: v.id, code: o.code, product: o.product, name: o.name, terms });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

async function loadPriorFindings(admin: Admin, version: VersionRow): Promise<PriorFinding[]> {
  if (version.version_no <= 1) return [];
  const { data: prev } = await admin
    .from("asset_versions")
    .select("id")
    .eq("asset_id", version.asset_id)
    .eq("version_no", version.version_no - 1)
    .maybeSingle();
  if (!prev?.id) return [];
  // The previous version's most recent finished run: complete preferred, else a failed run that kept deterministic findings.
  const { data: runs } = await admin
    .from("analysis_runs")
    .select("id, status")
    .eq("asset_version_id", prev.id)
    .in("status", ["complete", "failed", "declined_budget"])
    .order("created_at", { ascending: false });
  const latestComplete = (runs ?? []).find((r) => r.status === "complete");
  const latestAny = (runs ?? [])[0];
  const runIds = latestComplete ? [latestComplete.id] : latestAny ? [latestAny.id] : [];
  const query = admin.from("findings").select("id, rule_version_id, span_hash, quote, origin, analysis_run_id").eq("asset_version_id", prev.id);
  const { data: findings } = runIds.length > 0 ? await query.or(`origin.eq.reviewer,analysis_run_id.in.(${runIds.join(",")})`) : await query.eq("origin", "reviewer");
  if (!findings || findings.length === 0) return [];

  const ruleVersionIds = Array.from(new Set(findings.map((f) => f.rule_version_id).filter((id): id is string => Boolean(id))));
  const codeByVersion = new Map<string, string>();
  if (ruleVersionIds.length > 0) {
    const { data: rv } = await admin.from("rule_versions").select("id, rule_id").in("id", ruleVersionIds);
    const ruleIds = Array.from(new Set((rv ?? []).map((r) => r.rule_id)));
    const { data: rules } = ruleIds.length ? await admin.from("rules").select("id, code").in("id", ruleIds) : { data: [] as { id: string; code: string }[] };
    const codeByRule = new Map((rules ?? []).map((r) => [r.id, r.code]));
    for (const r of rv ?? []) {
      const code = codeByRule.get(r.rule_id);
      if (code) codeByVersion.set(r.id, code);
    }
  }

  const { data: dispositions } = await admin
    .from("finding_latest_dispositions")
    .select("finding_id, disposition_id")
    .in(
      "finding_id",
      findings.map((f) => f.id),
    );
  const dispositionByFinding = new Map<string, string>();
  for (const d of dispositions ?? []) if (d.finding_id && d.disposition_id) dispositionByFinding.set(d.finding_id, d.disposition_id);

  return findings.map((f) => ({
    id: f.id,
    rule_version_id: f.rule_version_id,
    rule_code: f.rule_version_id ? (codeByVersion.get(f.rule_version_id) ?? null) : null,
    span_hash: f.span_hash,
    quote: f.quote,
    latest_disposition_id: dispositionByFinding.get(f.id) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Persistence of findings (verify -> recheck -> insert -> carry dispositions)
// ---------------------------------------------------------------------------

async function persistFindings(
  admin: Admin,
  runId: string,
  input: {
    profileId: string;
    version: VersionRow;
    findings: ContentFinding[];
    /** Text to anchor quotes into ("" when nothing can be verified). */
    text: string;
    sections: Section[];
    rules: LoadedRule[];
    transcribed: boolean;
    /** False on the failure path, where the run's stage stays 'failed'. */
    touchStage?: boolean;
  },
): Promise<{ verified: VerifiedFinding[]; insertedIds: string[]; prior: PriorFinding[] }> {
  const stage = async (name: string) => {
    if (input.touchStage !== false) await setStage(admin, runId, name);
  };
  await stage("verify");
  const verified = input.findings.map((f) => verifyFinding(f, input.text, input.sections, input.rules, input.transcribed));

  await stage("recheck");
  const prior = await loadPriorFindings(admin, input.version);
  const matches = matchPriorFindings(
    verified.map((v) => ({ rule_version_id: v.rule_version_id, rule_code: v.finding.rule_code, quote: v.finding.quote, span_hash: v.span_hash })),
    prior,
  );

  await stage("persist");
  const rows: TablesInsert<"findings">[] = verified.map((v, i) => ({
    profile_id: input.profileId,
    analysis_run_id: runId,
    asset_version_id: input.version.id,
    origin: "ai",
    rule_version_id: v.rule_version_id,
    severity: v.finding.severity,
    evidence_type: v.evidence_type,
    section_id: v.section_id,
    quote: v.finding.quote,
    span_hash: v.span_hash,
    verified_span: v.verified,
    anchor: (v.anchor ?? {}) as Json,
    explanation: v.finding.explanation,
    suggested_fix: v.finding.suggested_fix,
    suggested_copy: v.finding.suggested_copy ?? null,
    prior_finding_id: matches[i].prior_finding_id,
    recheck_status: matches[i].recheck_status,
  }));

  let insertedIds: string[] = [];
  if (rows.length > 0) {
    const { data: inserted, error: insertError } = await admin.from("findings").insert(rows).select("id");
    if (insertError) throw new Error(`findings insert failed: ${insertError.code ?? ""} ${insertError.message}`);
    insertedIds = (inserted ?? []).map((r) => r.id);
  }

  // Carry dispositions forward where the words did not change.
  const carried = matches
    .map((m, i) => ({ m, id: insertedIds[i] }))
    .filter((x) => x.id && x.m.recheck_status === "still_present" && x.m.carried_from_disposition_id);
  if (carried.length > 0) {
    const { error: carryError } = await admin.from("finding_dispositions").insert(
      carried.map((x) => ({
        profile_id: input.profileId,
        finding_id: x.id,
        carried_from_disposition_id: x.m.carried_from_disposition_id,
        // The trigger copies disposition/reason/note/override from the source row.
        disposition: "fix_required",
      })),
    );
    if (carryError) console.error("[ai/engine] carrying dispositions failed:", carryError.code, carryError.message);
  }

  return { verified, insertedIds, prior };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

type VerifiedFinding = {
  finding: ContentFinding;
  rule_version_id: string | null;
  evidence_type: ContentFinding["evidence_type"];
  verified: boolean;
  anchor: { start: number; end: number; section_id?: string } | null;
  section_id: string | null;
  span_hash: string;
};

function verifyFinding(f: ContentFinding, text: string, sections: Section[], rules: LoadedRule[], transcribed: boolean): VerifiedFinding {
  const rule = rules.find((r) => r.code.trim().toUpperCase() === f.rule_code.trim().toUpperCase());
  const anchor = text ? locateQuote(text, f.quote) : null;
  const sectionId = anchor ? (sectionAtOffset(sections, anchor.start) ?? null) : null;
  const verified = Boolean(anchor);
  return {
    finding: f,
    rule_version_id: rule?.rule_version_id ?? null,
    // Unverifiable quotes keep their type only when the words came from a transcription.
    evidence_type: verified || transcribed ? f.evidence_type : "needs_judgment",
    verified,
    anchor: anchor ? { ...anchor, ...(sectionId ? { section_id: sectionId } : {}) } : null,
    section_id: sectionId,
    span_hash: spanHash(f.quote),
  };
}

// ---------------------------------------------------------------------------
// Transcription (images and scanned PDFs)
// ---------------------------------------------------------------------------

async function transcribe(bytes: Uint8Array, mediaType: string): Promise<{ text: string; inputTokens: number; outputTokens: number; costUsd: number }> {
  const result = await generateText({
    model: MODELS.cheap,
    system: TRANSCRIBE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "file", data: bytes, mediaType },
          { type: "text", text: "Transcribe every piece of visible text in this ad, exactly as written." },
        ],
      },
    ],
    maxOutputTokens: 4_000,
    maxRetries: 1,
    timeout: { totalMs: Math.min(LLM_TIMEOUT_MS, 60_000) },
  });
  const inputTokens = result.usage.inputTokens ?? 0;
  const outputTokens = result.usage.outputTokens ?? 0;
  const text = result.text.trim() === "NO_TEXT" ? "" : result.text.trim();
  return { text, inputTokens, outputTokens, costUsd: costUsd(MODELS.cheap, inputTokens, outputTokens) };
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

async function setStage(admin: Admin, runId: string, stage: string): Promise<void> {
  const { error } = await admin.from("analysis_runs").update({ stage }).eq("id", runId);
  if (error) console.warn("[ai/engine] stage update failed:", error.code, error.message);
}

async function insertAlerts(
  admin: Admin,
  profileId: string,
  versionId: string,
  candidates: HiddenTextCandidate[],
  detector: "deterministic" | "model",
): Promise<number> {
  if (candidates.length === 0) return 0;
  const rows: TablesInsert<"security_alerts">[] = candidates.slice(0, 20).map((c) => ({
    profile_id: profileId,
    asset_version_id: versionId,
    kind: c.kind,
    excerpt: c.excerpt.slice(0, 300),
    location: { where: c.location, source: c.location.startsWith("html") ? "html" : "text", detector } as Json,
  }));
  const { error } = await admin.from("security_alerts").insert(rows);
  if (error) {
    console.error("[ai/engine] security_alerts insert failed:", error.code, error.message);
    return 0;
  }
  return rows.length;
}

/** A submitted ad waiting for review goes to manual review when the check cannot be trusted or failed. */
async function flagManualReview(admin: Admin, asset: AssetRow, reason: string): Promise<void> {
  if (!asset.submitted_at || asset.status !== "needs_review") return;
  const { error } = await admin.from("assets").update({ status: "needs_manual_review" }).eq("id", asset.id).eq("status", "needs_review");
  if (error) {
    console.error("[ai/engine] needs_manual_review update failed:", error.code, error.message);
    return;
  }
  asset.status = "needs_manual_review";
  await logEvent(admin, asset.profile_id, asset.id, "analysis.manual_review", { reason });
}

async function declineRun(admin: Admin, runId: string, asset: AssetRow, rules: LoadedRule[], offers: LoadedOffer[], estUsd: number): Promise<void> {
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

async function failRun(admin: Admin, runId: string, message: string, ctx: { profileId: string; asset?: AssetRow | null }): Promise<void> {
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

/** Plain-English run error; the raw message is kept after a colon for debugging. */
function friendlyError(raw: string): string {
  const known = friendlyAiError(raw);
  if (known) return `The AI check could not run: ${known} A person must review this ad.`;
  return `The AI check failed: ${raw}`;
}

async function logEvent(admin: Admin, profileId: string, assetId: string | null, kind: string, data: Record<string, Json>): Promise<void> {
  const { error } = await admin.from("events").insert({ profile_id: profileId, asset_id: assetId, actor_id: null, kind, data: data as Json });
  if (error) console.warn("[ai/engine] event insert failed:", error.code, error.message);
}
