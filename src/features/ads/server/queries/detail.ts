import "server-only";

import { locateQuote } from "@/features/analysis/spans";
import { asProduct, type Product } from "@/features/products/catalog";
import { SEVERITY_ORDER, asSeverity, type Severity } from "@/features/rules/severity";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";
import { imageRegionOf, type FindingAnchor, type ImageRegionAnchor, type VersionContent } from "@/features/ads/types";

import { getNextNeedsReviewIdWith } from "./next-ad";
import { contentOf, loadUsers, signUrl, type Db } from "./shared";

/**
 * The Ad page in one read: the ad and every version, the issues on the latest
 * and the previous version (dispositions, cited rules and their legal sources,
 * and for "What changed" whether a previous issue's words are still there),
 * hidden-text alerts, the history (runs, decisions, change requests, events),
 * review time, the rules in force for "+ Add issue", and the next ad to open.
 * Read-only, with the user-context client.
 */

export type AdVersion = {
  id: string;
  versionNo: number;
  origin: string;
  authorId: string | null;
  authorLabel: string | null;
  content: VersionContent;
  extractedText: string;
  contentSha256: string;
  storagePath: string | null;
  createdAt: string;
};

export type AdFinding = {
  id: string;
  versionId: string;
  origin: "ai" | "reviewer";
  /** For reviewer-added issues: who added it ("You", a name, or an email). */
  authorLabel: string | null;
  severity: Severity;
  /** Severity as the AI (or reviewer) set it, before any override. */
  originalSeverity: Severity;
  evidenceType: string;
  quote: string | null;
  verifiedSpan: boolean;
  /** Where the quoted words sit in the text (null for image notes and unlocated quotes). */
  anchor: FindingAnchor | null;
  /** A reviewer's pin on the image, when this issue is an image note; `quote` is then its label. */
  imageAnchor: ImageRegionAnchor | null;
  explanation: string | null;
  suggestedFix: string | null;
  suggestedCopy: string | null;
  priorFindingId: string | null;
  recheckStatus: "new" | "still_present" | "re_anchored" | null;
  reusedFromFindingId: string | null;
  rule: { id: string; ruleId: string; code: string | null; title: string; body: string; references: { id: string; label: string; citation: string; url: string | null }[] } | null;
  disposition: {
    id: string;
    disposition: "fix_required" | "dismissed" | "accepted_exception";
    reason: string | null;
    note: string | null;
    actorLabel: string | null;
    carried: boolean;
    createdAt: string;
  } | null;
  /** Open = no disposition, or fix_required. */
  open: boolean;
  /**
   * True when the database will weigh this issue at decision time (reviewer
   * findings and AI findings from a complete run). False for the deterministic
   * product-terms findings a failed run kept: shown, actionable, but an
   * approval over them is recorded as a manual approval with a rationale.
   */
  decisionGrade: boolean;
  /**
   * Previous-version issues only: whether the quoted words still appear in the
   * latest version. "Fixed" requires false; null on latest-version issues.
   */
  wordsStillThere: boolean | null;
  createdAt: string;
};

export type AdAlert = {
  id: string;
  kind: "hidden_text" | "possible_injection";
  excerpt: string | null;
  location: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
};

export type AdRun = {
  id: string;
  versionId: string;
  status: string;
  stage: string | null;
  model: string | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  reusedFromRunId: string | null;
  /**
   * How the check ran (analysis_runs.input_metadata.mode): 'off' = the AI
   * step was skipped on purpose (test mode), 'replay' = a recorded result was
   * replayed, 'reused' = findings reused from an identical ad at $0, 'live' =
   * a real model call. Null when the run did not get that far.
   */
  mode: CheckMode | null;
  /** The model read the file as an image (no text layer). */
  transcribed: boolean;
};

export type CheckMode = "off" | "replay" | "reused" | "live";

export type AdDecision = {
  id: string;
  versionId: string;
  versionNo: number | null;
  decision: string;
  approverId: string;
  approverLabel: string;
  rationale: string | null;
  exceptions: { finding_id: string; severity?: string; reason?: string; text?: string }[];
  dismissed: unknown[];
  attested: boolean;
  selfApproved: boolean;
  manualOnly: boolean;
  contentSha256: string;
  snapshot: Record<string, unknown>;
  createdAt: string;
};

export type AdChangeRequest = {
  id: string;
  versionId: string;
  decisionId: string | null;
  authorLabel: string;
  items: { finding_id?: string; quote?: string; rule?: string; required_fix: string; suggested_copy?: string }[];
  note: string | null;
  messageText: string | null;
  dueDate: string | null;
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
};

export type AdEvent = {
  id: number;
  kind: string;
  actorLabel: string | null;
  data: Record<string, unknown>;
  createdAt: string;
};

export type AdDetail = {
  id: string;
  profileId: string;
  title: string;
  product: Product;
  channel: string | null;
  status: string;
  audience: string | null;
  isSample: boolean;
  submitterName: string | null;
  submitterEmail: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  latestVersionId: string;
  approvedVersionId: string | null;
  approvedDecisionId: string | null;
  changedAfterApproval: boolean;
  reReviewReason: Record<string, unknown> | null;
  /** Life after approval; null until the ad is marked live / archived. */
  liveAt: string | null;
  liveChannel: string | null;
  liveUrl: string | null;
  expiresAt: string | null;
  archivedAt: string | null;
  archiveReason: string | null;
  versions: AdVersion[];
  latest: AdVersion;
  previous: AdVersion | null;
  /** Signed URL for the latest version's file (pdf/image), if any. */
  fileUrl: string | null;
  /**
   * Issues on the latest version: reviewer findings plus AI findings from the
   * latest complete run, or, when no run completed, the deterministic
   * product-terms findings the failed run kept (decisionGrade = false).
   */
  findings: AdFinding[];
  /** Findings on the previous version, chosen the same way (for "What changed"). */
  previousFindings: AdFinding[];
  alerts: AdAlert[];
  runs: AdRun[];
  latestRun: AdRun | null;
  checking: boolean;
  /** A complete check exists for the latest version (its findings are decision-grade). */
  aiScreened: boolean;
  decisions: AdDecision[];
  approval: AdDecision | null;
  changeRequests: AdChangeRequest[];
  openChangeRequest: AdChangeRequest | null;
  events: AdEvent[];
  aiCostUsd: number;
  reviewSeconds: number;
  memberCount: number;
  seenIn: number;
  nextNeedsReviewId: string | null;
  /** The workspace's rules in force (for "+ Add issue"), ordered by code. */
  rulesInForce: { id: string; code: string; title: string }[];
  /** Server time when the detail was read; relative ages use it so server and client render the same text. */
  now: number;
};

type RawFinding = Database["public"]["Tables"]["findings"]["Row"];

export async function getAdDetail(assetId: string, profileId: string, userId: string): Promise<AdDetail | null> {
  return getAdDetailWith(await createClient(), assetId, profileId, userId);
}

export async function getAdDetailWith(db: Db, assetId: string, profileId: string, userId: string): Promise<AdDetail | null> {
  const { data: asset, error } = await db.from("assets").select("*").eq("id", assetId).eq("profile_id", profileId).maybeSingle();
  if (error) {
    console.error("[ads] asset read failed:", error.code, error.message);
    return null;
  }
  if (!asset || !asset.latest_version_id || asset.is_draft) return null;

  const [versionsRes, runsRes, decisionsRes, changeRes, eventsRes, membersRes, sourcesRes, nextNeedsReviewId, rulesRes] = await Promise.all([
    db
      .from("asset_versions")
      .select("id, version_no, origin, author_id, content, extracted_text, content_sha256, storage_path, created_at")
      .eq("asset_id", assetId)
      .order("version_no", { ascending: true }),
    db
      .from("analysis_runs")
      .select("id, asset_version_id, status, stage, model, cost_usd, input_tokens, output_tokens, error, created_at, completed_at, reused_from_run_id, input_metadata")
      .eq("profile_id", profileId)
      .in(
        "asset_version_id",
        // Narrowed again below once versions are known; the asset's own versions only.
        [asset.latest_version_id, asset.approved_version_id].filter((v): v is string => Boolean(v)),
      )
      .order("created_at", { ascending: true }),
    db.from("decisions").select("*").eq("asset_id", assetId).order("created_at", { ascending: false }),
    db.from("change_requests").select("*").eq("asset_id", assetId).order("created_at", { ascending: false }),
    // Newest 500 (reversed below to oldest first), so a long history drops its oldest events, not its newest.
    db.from("events").select("id, kind, actor_id, data, created_at").eq("asset_id", assetId).order("created_at", { ascending: false }).limit(500),
    db.from("profile_members").select("user_id").eq("profile_id", profileId),
    db.from("asset_sources").select("source_item_id").eq("asset_id", assetId),
    // Next ad to open after a decision: worst first among Needs review.
    getNextNeedsReviewIdWith(db, profileId, assetId),
    db.from("rules").select("id, code, current_version_id").eq("profile_id", profileId).eq("active", true).order("code", { ascending: true }),
  ]);

  const versionRows = versionsRes.data ?? [];
  if (versionRows.length === 0) return null;
  const versionIds = versionRows.map((v) => v.id);

  // Runs for every version (the first query only covered the pointers).
  let runRows = runsRes.data ?? [];
  if (versionIds.length > 2 || versionIds.some((id) => id !== asset.latest_version_id && id !== asset.approved_version_id)) {
    const { data } = await db
      .from("analysis_runs")
      .select("id, asset_version_id, status, stage, model, cost_usd, input_tokens, output_tokens, error, created_at, completed_at, reused_from_run_id, input_metadata")
      .eq("profile_id", profileId)
      .in("asset_version_id", versionIds)
      .order("created_at", { ascending: true });
    runRows = data ?? runRows;
  }

  const latestId = asset.latest_version_id;
  const latestRow = versionRows.find((v) => v.id === latestId) ?? versionRows[versionRows.length - 1];
  const previousRow = versionRows.filter((v) => v.version_no < latestRow.version_no).at(-1) ?? null;
  const findingVersionIds = [latestRow.id, previousRow?.id].filter((v): v is string => Boolean(v));

  const [findingsRes, alertsRes, sessionsRes] = await Promise.all([
    db.from("findings").select("*").in("asset_version_id", findingVersionIds).order("created_at", { ascending: true }),
    db.from("security_alerts").select("*").eq("asset_version_id", latestRow.id).order("created_at", { ascending: true }),
    db.from("review_sessions").select("active_seconds, surface").in("asset_version_id", versionIds),
  ]);

  const findingRows = (findingsRes.data ?? []) as RawFinding[];
  const completeRunIds = new Set(runRows.filter((r) => r.status === "complete").map((r) => r.id));
  // Per version: every complete run counts (the database weighs all of them);
  // with no complete run, the newest failed/declined run's deterministic
  // findings are shown instead.
  const fallbackRunIds = new Set<string>();
  for (const vid of findingVersionIds) {
    const runsHere = runRows.filter((r) => r.asset_version_id === vid);
    if (runsHere.some((r) => r.status === "complete")) continue;
    const fallback = [...runsHere].reverse().find((r) => r.status === "failed" || r.status === "declined_budget");
    if (fallback) fallbackRunIds.add(fallback.id);
  }
  const isDecisionGrade = (f: RawFinding) => f.origin === "reviewer" || Boolean(f.analysis_run_id && completeRunIds.has(f.analysis_run_id));
  const usableFindings = findingRows.filter((f) => isDecisionGrade(f) || Boolean(f.analysis_run_id && fallbackRunIds.has(f.analysis_run_id)));

  const dispositions = new Map<string, Database["public"]["Views"]["finding_latest_dispositions"]["Row"]>();
  if (usableFindings.length) {
    const { data } = await db
      .from("finding_latest_dispositions")
      .select("*")
      .in(
        "finding_id",
        usableFindings.map((f) => f.id),
      );
    for (const d of data ?? []) if (d.finding_id) dispositions.set(d.finding_id, d);
  }

  // Rule versions + reference library for citations, plus the current
  // version of every rule in force (titles for the Add issue rule picker).
  const inForceRows = (rulesRes.data ?? []).filter((r): r is typeof r & { current_version_id: string } => Boolean(r.current_version_id));
  const citedVersionIds = new Set(usableFindings.map((f) => f.rule_version_id).filter((v): v is string => Boolean(v)));
  const ruleVersionIds = [...new Set([...citedVersionIds, ...inForceRows.map((r) => r.current_version_id)])];
  const rulesById = new Map<string, { id: string; rule_id: string; title: string; body: string; reference_ids: string[]; code: string | null }>();
  const refsById = new Map<string, { id: string; label: string; citation: string; url: string | null }>();
  if (ruleVersionIds.length) {
    // The FK hint matters: rules also points back at rule_versions
    // (current_version_id), so a bare rules(code) embed is ambiguous and
    // PostgREST returns an error (no rule titles or legal links anywhere).
    const { data: rvs, error: rvErr } = await db
      .from("rule_versions")
      .select("id, rule_id, title, body, reference_ids, rules!rule_versions_rule_id_fkey(code)")
      .in("id", ruleVersionIds);
    if (rvErr) console.error("[ads] rule versions read failed:", rvErr.code, rvErr.message);
    const refIds = new Set<string>();
    for (const rv of rvs ?? []) {
      const rule = Array.isArray(rv.rules) ? rv.rules[0] : rv.rules;
      rulesById.set(rv.id, { id: rv.id, rule_id: rv.rule_id, title: rv.title, body: rv.body, reference_ids: rv.reference_ids ?? [], code: (rule as { code?: string } | null)?.code ?? null });
      // Legal sources only for the rules an issue cites; the picker needs just titles.
      if (citedVersionIds.has(rv.id)) for (const r of rv.reference_ids ?? []) refIds.add(r);
    }
    if (refIds.size) {
      const { data: refs } = await db.from("reference_library").select("id, label, citation, url").in("id", [...refIds]);
      for (const r of refs ?? []) refsById.set(r.id, r);
    }
  }
  const rulesInForce = inForceRows
    .map((r) => ({ id: r.id, code: r.code, title: rulesById.get(r.current_version_id)?.title ?? "" }))
    .filter((r) => r.title !== "");

  const users = await loadUsers(db, [
    ...versionRows.map((v) => v.author_id),
    ...(decisionsRes.data ?? []).map((d) => d.approver_id),
    ...(changeRes.data ?? []).map((c) => c.author_id),
    ...(eventsRes.data ?? []).map((e) => e.actor_id),
    ...[...dispositions.values()].map((d) => d.actor_id),
    ...(alertsRes.data ?? []).map((a) => a.acknowledged_by),
    ...usableFindings.map((f) => f.author_id),
  ]);
  const label = (id: string | null | undefined): string | null => {
    if (!id) return null;
    if (id === userId) return "You";
    const u = users.get(id);
    return u ? u.full_name?.trim() || u.email : "A member";
  };

  const versions: AdVersion[] = versionRows.map((v) => ({
    id: v.id,
    versionNo: v.version_no,
    origin: v.origin,
    authorId: v.author_id,
    authorLabel: label(v.author_id),
    content: contentOf(v.content),
    extractedText: v.extracted_text ?? "",
    contentSha256: v.content_sha256,
    storagePath: v.storage_path,
    createdAt: v.created_at,
  }));
  const latest = versions.find((v) => v.id === latestRow.id)!;
  const previous = previousRow ? versions.find((v) => v.id === previousRow.id) ?? null : null;

  const toFinding = (f: RawFinding): AdFinding => {
    const d = dispositions.get(f.id);
    const original = asSeverity(f.severity);
    const effective = asSeverity(d?.severity_override ?? f.severity);
    const rv = f.rule_version_id ? rulesById.get(f.rule_version_id) : undefined;
    const anchorRaw = f.anchor && typeof f.anchor === "object" && !Array.isArray(f.anchor) ? (f.anchor as Record<string, unknown>) : null;
    const anchor: FindingAnchor | null =
      anchorRaw && typeof anchorRaw.start === "number" && typeof anchorRaw.end === "number" && anchorRaw.end > anchorRaw.start
        ? { start: anchorRaw.start, end: anchorRaw.end, section_id: typeof anchorRaw.section_id === "string" ? anchorRaw.section_id : undefined }
        : null;
    const imageAnchor = imageRegionOf(f.anchor);
    const disposition =
      d && d.disposition
        ? {
            id: d.disposition_id ?? f.id,
            disposition: d.disposition as "fix_required" | "dismissed" | "accepted_exception",
            reason: d.reason,
            note: d.note,
            actorLabel: label(d.actor_id),
            carried: Boolean(d.carried_from_disposition_id),
            createdAt: d.created_at ?? f.created_at,
          }
        : null;
    return {
      id: f.id,
      versionId: f.asset_version_id,
      origin: f.origin === "reviewer" ? "reviewer" : "ai",
      authorLabel: f.origin === "reviewer" ? label(f.author_id) : null,
      severity: effective,
      originalSeverity: original,
      evidenceType: f.evidence_type,
      quote: f.quote,
      verifiedSpan: f.verified_span,
      anchor: imageAnchor ? null : anchor,
      imageAnchor,
      explanation: f.explanation,
      suggestedFix: f.suggested_fix,
      suggestedCopy: f.suggested_copy,
      priorFindingId: f.prior_finding_id,
      recheckStatus: f.recheck_status === "new" || f.recheck_status === "still_present" || f.recheck_status === "re_anchored" ? f.recheck_status : null,
      reusedFromFindingId: f.reused_from_finding_id,
      rule: rv
        ? {
            id: rv.id,
            ruleId: rv.rule_id,
            code: rv.code,
            title: rv.title,
            body: rv.body,
            references: rv.reference_ids.map((id) => refsById.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r)),
          }
        : null,
      disposition,
      open: !disposition || disposition.disposition === "fix_required",
      decisionGrade: isDecisionGrade(f),
      wordsStillThere: null,
      createdAt: f.created_at,
    };
  };

  const sortFindings = (a: AdFinding, b: AdFinding) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.createdAt.localeCompare(b.createdAt);
  const findings = usableFindings.filter((f) => f.asset_version_id === latest.id).map(toFinding).sort(sortFindings);
  const previousFindings = previous
    ? usableFindings
        .filter((f) => f.asset_version_id === previous.id)
        .map((f) => {
          const prior = toFinding(f);
          // A pin on the image cannot be confirmed fixed from the text: it stays "Not re-flagged" until a reviewer looks at the new image.
          const wordsStillThere = prior.imageAnchor ? true : f.quote ? locateQuote(latest.extractedText, f.quote) !== null : false;
          return { ...prior, wordsStillThere };
        })
        .sort(sortFindings)
    : [];

  const runs: AdRun[] = runRows.map((r) => ({
    id: r.id,
    versionId: r.asset_version_id,
    status: r.status,
    stage: r.stage,
    model: r.model,
    costUsd: Number(r.cost_usd ?? 0),
    inputTokens: r.input_tokens ?? 0,
    outputTokens: r.output_tokens ?? 0,
    error: r.error,
    createdAt: r.created_at,
    completedAt: r.completed_at,
    reusedFromRunId: r.reused_from_run_id,
    mode: checkModeOf(r),
    transcribed: Boolean(r.input_metadata && typeof r.input_metadata === "object" && !Array.isArray(r.input_metadata) && (r.input_metadata as Record<string, unknown>).transcribed === true),
  }));
  const latestRun = runs.filter((r) => r.versionId === latest.id).at(-1) ?? null;
  const aiScreened = runs.some((r) => r.versionId === latest.id && r.status === "complete");

  const versionNoById = new Map(versions.map((v) => [v.id, v.versionNo]));
  const decisions: AdDecision[] = (decisionsRes.data ?? []).map((d) => ({
    id: d.id,
    versionId: d.asset_version_id,
    versionNo: versionNoById.get(d.asset_version_id) ?? null,
    decision: d.decision,
    approverId: d.approver_id,
    approverLabel: label(d.approver_id) ?? d.approver_email ?? "A member",
    rationale: d.rationale,
    exceptions: Array.isArray(d.exceptions) ? (d.exceptions as AdDecision["exceptions"]) : [],
    dismissed: Array.isArray(d.dismissed) ? (d.dismissed as unknown[]) : [],
    attested: d.attested,
    selfApproved: d.self_approved,
    manualOnly: d.manual_only,
    contentSha256: d.content_sha256,
    snapshot: d.asset_snapshot && typeof d.asset_snapshot === "object" && !Array.isArray(d.asset_snapshot) ? (d.asset_snapshot as Record<string, unknown>) : {},
    createdAt: d.created_at,
  }));
  const approval = asset.approved_decision_id ? decisions.find((d) => d.id === asset.approved_decision_id) ?? null : null;

  const changeRequests: AdChangeRequest[] = (changeRes.data ?? []).map((c) => ({
    id: c.id,
    versionId: c.asset_version_id,
    decisionId: c.decision_id,
    authorLabel: label(c.author_id) ?? "A member",
    items: Array.isArray(c.items) ? (c.items as AdChangeRequest["items"]) : [],
    note: c.note,
    messageText: c.message_text,
    dueDate: c.due_date,
    status: c.status === "resolved" ? "resolved" : "open",
    createdAt: c.created_at,
    resolvedAt: c.resolved_at,
  }));

  const events: AdEvent[] = [...(eventsRes.data ?? [])].reverse().map((e) => ({
    id: e.id,
    kind: e.kind,
    actorLabel: label(e.actor_id),
    data: e.data && typeof e.data === "object" && !Array.isArray(e.data) ? (e.data as Record<string, unknown>) : {},
    createdAt: e.created_at,
  }));

  const alerts: AdAlert[] = (alertsRes.data ?? []).map((a) => ({
    id: a.id,
    kind: a.kind === "possible_injection" ? "possible_injection" : "hidden_text",
    excerpt: a.excerpt,
    location: describeLocation(a.location),
    acknowledgedAt: a.acknowledged_at,
    acknowledgedBy: label(a.acknowledged_by),
  }));

  const fileUrl =
    latest.content.format === "pdf" || latest.content.format === "image" ? await signUrl(db, latest.storagePath, false) : null;

  return {
    id: asset.id,
    profileId: asset.profile_id,
    title: asset.title?.trim() || "Untitled ad",
    product: asProduct(asset.product),
    channel: asset.channel,
    status: asset.status,
    audience: asset.audience,
    isSample: asset.audience === "sample",
    submitterName: asset.submitter_name,
    submitterEmail: asset.submitter_email,
    submittedAt: asset.submitted_at,
    createdAt: asset.created_at,
    updatedAt: asset.updated_at,
    latestVersionId: latest.id,
    approvedVersionId: asset.approved_version_id,
    approvedDecisionId: asset.approved_decision_id,
    changedAfterApproval: Boolean(asset.changed_after_approval),
    reReviewReason:
      asset.re_review_reason && typeof asset.re_review_reason === "object" && !Array.isArray(asset.re_review_reason)
        ? (asset.re_review_reason as Record<string, unknown>)
        : null,
    // select("*") simply lacks these before the lifecycle migration runs.
    liveAt: asset.live_at ?? null,
    liveChannel: asset.live_channel ?? null,
    liveUrl: asset.live_url ?? null,
    expiresAt: asset.expires_at ?? null,
    archivedAt: asset.archived_at ?? null,
    archiveReason: asset.archive_reason ?? null,
    versions,
    latest,
    previous,
    fileUrl,
    findings,
    previousFindings,
    alerts,
    runs,
    latestRun,
    checking: latestRun?.status === "queued" || latestRun?.status === "running",
    aiScreened,
    decisions,
    approval,
    changeRequests,
    openChangeRequest: changeRequests.find((c) => c.status === "open") ?? null,
    events,
    aiCostUsd: runs.reduce((acc, r) => acc + r.costUsd, 0),
    reviewSeconds: (sessionsRes.data ?? [])
      .filter((s) => s.surface === "workbench" || s.surface === "compare" || s.surface === "composer")
      .reduce((acc, s) => acc + (s.active_seconds ?? 0), 0),
    memberCount: membersRes.data?.length ?? 1,
    seenIn: sourcesRes.data?.length ?? 0,
    nextNeedsReviewId,
    rulesInForce,
    now: Date.now(),
  };
}

/** Reads how a run was executed from input_metadata.mode (or the reuse pointer). */
function checkModeOf(r: { status: string; reused_from_run_id: string | null; input_metadata: Json | null }): CheckMode | null {
  if (r.reused_from_run_id) return "reused";
  const meta = r.input_metadata && typeof r.input_metadata === "object" && !Array.isArray(r.input_metadata) ? (r.input_metadata as Record<string, unknown>) : null;
  const mode = meta?.mode;
  if (mode === "off" || mode === "replay" || mode === "reused" || mode === "live") return mode;
  if (r.status === "complete") return "live";
  return null;
}

function describeLocation(loc: Json | null): string | null {
  if (!loc) return null;
  if (typeof loc === "string") return loc;
  if (typeof loc === "object" && !Array.isArray(loc)) {
    const o = loc as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof o.description === "string") return o.description;
    if (typeof o.section === "string") parts.push(o.section);
    if (typeof o.section_id === "string") parts.push(`section ${o.section_id}`);
    if (typeof o.page === "number") parts.push(`page ${o.page}`);
    if (typeof o.kind === "string") parts.push(o.kind.replace(/_/g, " "));
    if (typeof o.where === "string") parts.push(o.where);
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}
