import "server-only";

import { sha256Hex } from "@/features/analysis/hash";
import type { ContentFinding, HiddenTextCandidate } from "@/features/analysis/schema";
import type { Severity } from "@/features/rules/severity";

import type { Admin, LoadedOffer, LoadedRule, RunRow } from "./inputs";

/**
 * Reuse ($0): a previous complete run in the workspace with the same reuse
 * key is copied instead of bought again. Owns the key itself, which earlier
 * run counts as reusable, and reading back the findings and model-found
 * alerts to copy.
 */

/**
 * The reuse key (docs/schema.md §6.5): same normalized text (or, for images
 * awaiting transcription, the same bytes), same rule versions, same product
 * terms and same prompt => the same result, so it is copied instead of
 * bought again.
 */
export function computeReuseKey(textHash: string, rules: LoadedRule[], offers: LoadedOffer[], promptHashValue: string): string {
  const ruleIds = rules.map((r) => r.rule_version_id).sort();
  const offerIds = offers.map((o) => o.offer_version_id).sort();
  return sha256Hex([textHash, ruleIds.join(","), offerIds.join(","), promptHashValue].join("\n"));
}

type ReusableRun = Pick<RunRow, "id" | "model" | "asset_version_id" | "input_metadata" | "completed_at">;

function previousMode(run: ReusableRun): string | null {
  const meta = run.input_metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta) && typeof meta.mode === "string") return meta.mode;
  return null;
}

/** The newest complete run in the profile with this key that carries real findings (an 'off' run has none worth copying). */
export async function findReusableRun(admin: Admin, profileId: string, reuseKey: string, currentRunId: string): Promise<ReusableRun | null> {
  const { data, error } = await admin
    .from("analysis_runs")
    .select("id, model, asset_version_id, input_metadata, completed_at")
    .eq("profile_id", profileId)
    .eq("reuse_key", reuseKey)
    .eq("status", "complete")
    .neq("id", currentRunId)
    .order("completed_at", { ascending: false })
    .limit(10);
  if (error) {
    console.warn("[ai/engine] reuse lookup failed:", error.code, error.message);
    return null;
  }
  // Only a run that had model-grade findings is worth copying; an 'off' run is just the deterministic pass again.
  return (data ?? []).find((r) => previousMode(r) !== "off") ?? null;
}

/** The AI findings of a run as ContentFindings, with the ids they are copied from. */
export async function loadFindingsToCopy(admin: Admin, runId: string, rules: LoadedRule[]): Promise<{ id: string; finding: ContentFinding }[]> {
  const { data, error } = await admin
    .from("findings")
    .select("id, rule_version_id, severity, evidence_type, quote, explanation, suggested_fix, suggested_copy")
    .eq("analysis_run_id", runId)
    .eq("origin", "ai")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`reuse: findings load failed: ${error.message}`);
  const codeByVersion = new Map(rules.map((r) => [r.rule_version_id, r.code]));
  return (data ?? []).map((f) => ({
    id: f.id,
    finding: {
      rule_code: (f.rule_version_id && codeByVersion.get(f.rule_version_id)) || "UNMATCHED-RULE",
      severity: (["critical", "major", "minor"].includes(f.severity) ? f.severity : "major") as Severity,
      quote: f.quote ?? "",
      explanation: f.explanation ?? "",
      suggested_fix: f.suggested_fix ?? "",
      suggested_copy: f.suggested_copy ?? undefined,
      evidence_type: (["exact_match", "offer_mismatch", "missing_disclosure", "needs_judgment"].includes(f.evidence_type)
        ? f.evidence_type
        : "needs_judgment") as ContentFinding["evidence_type"],
    },
  }));
}

/** Hidden-text alerts on a version that did not come from the deterministic scan (so they are copied rather than re-detected). */
export async function loadModelAlerts(admin: Admin, versionId: string): Promise<HiddenTextCandidate[]> {
  const { data } = await admin.from("security_alerts").select("kind, excerpt, location").eq("asset_version_id", versionId);
  const out: HiddenTextCandidate[] = [];
  for (const a of data ?? []) {
    const loc = a.location && typeof a.location === "object" && !Array.isArray(a.location) ? (a.location as Record<string, unknown>) : {};
    if (loc.detector === "deterministic") continue;
    if (!a.excerpt) continue;
    out.push({ kind: a.kind === "possible_injection" ? "possible_injection" : "hidden_text", excerpt: a.excerpt, location: typeof loc.where === "string" ? loc.where : "text" });
  }
  return out;
}
