import "server-only";

import { imageRegionOf } from "@/features/ads/types";
import { sectionAtOffset, type Section } from "@/features/analysis/extract";
import { matchPriorFindings, type PriorFinding } from "@/features/analysis/recheck";
import type { ContentFinding } from "@/features/analysis/schema";
import { locateQuote, spanHash } from "@/features/analysis/spans";
import type { Json, TablesInsert } from "@/lib/supabase/types";

import type { Admin, LoadedRule, VersionRow } from "./inputs";
import { setStage } from "./records";

/**
 * Persisting a run's findings: verify each quote against the checked text,
 * recheck against the previous version's findings, insert the rows, and carry
 * reviewer dispositions forward where the words did not change.
 */

export async function persistFindings(
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
    /** Parallel to findings: the finding each row is copied from (reused runs). */
    reusedFromFindingIds?: (string | null)[];
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
    reused_from_finding_id: input.reusedFromFindingIds?.[i] ?? null,
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
// Recheck input: the previous version's findings
// ---------------------------------------------------------------------------

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
  const query = admin.from("findings").select("id, rule_version_id, span_hash, quote, origin, analysis_run_id, anchor").eq("asset_version_id", prev.id);
  const { data: rows } = runIds.length > 0 ? await query.or(`origin.eq.reviewer,analysis_run_id.in.(${runIds.join(",")})`) : await query.eq("origin", "reviewer");
  // A reviewer's pin on the image has a label, not quoted words: it is never
  // paired with a finding on the new version (the new image needs a new look).
  const findings = (rows ?? []).filter((f) => !imageRegionOf(f.anchor));
  if (findings.length === 0) return [];

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
