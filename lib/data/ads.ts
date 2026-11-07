import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";

import {
  APPROVED_STATUSES,
  NEEDS_REVIEW_STATUSES,
  SEVERITY_ORDER,
  asProduct,
  asSeverity,
  providerName,
  tabForStatus,
  type Tab,
} from "@/components/ads/format";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";
import type { FindingAnchor, Product, Severity, VersionContent } from "@/lib/types/ads";

/**
 * Reads for the Ads list and the Ad page. Everything goes through the
 * user-context client, so RLS decides what the member can see. Nothing here
 * writes. All functions tolerate a half-built workspace (no rules, no runs,
 * no decisions) and return empty shapes instead of throwing.
 */

type Db = SupabaseClient<Database>;
const BUCKET = "private-assets";
const SIGNED_URL_TTL = 60 * 60;

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export type ThumbIcon = "pdf" | "image" | "email" | "social" | "web" | "display" | "search" | "sms" | "affiliate" | "text";

export type FromInfo = {
  label: string;
  /** Secondary line, e.g. the email address or the account that synced it. */
  detail: string | null;
  kind: "you" | "member" | "submitter" | "connector" | "sample";
  provider: string | null;
};

export type AdListRow = {
  id: string;
  title: string;
  product: Product;
  channel: string | null;
  status: string;
  tab: Exclude<Tab, "all"> | null;
  tags: string[];
  checking: boolean;
  checkStage: string | null;
  notScreened: boolean;
  openCritical: number;
  openMajor: number;
  openMinor: number;
  hiddenText: boolean;
  topIssue: { quote: string | null; explanation: string | null } | null;
  from: FromInfo;
  thumbnail: { kind: "image"; url: string } | { kind: "icon"; icon: ThumbIcon };
  versionNo: number;
  approvedVersionNo: number | null;
  approvedBy: string | null;
  approvedAt: string | null;
  withExceptions: boolean;
  submittedAt: string;
  updatedAt: string;
  isSample: boolean;
  seenIn: number;
  /** Sort key: smaller is worse. */
  rank: number;
};

export type TriageRow = {
  id: string;
  title: string;
  sender: string | null;
  senderEmail: string | null;
  provider: string;
  kind: string;
  occurredAt: string | null;
  classification: string;
  reason: string | null;
  product: Product;
  channel: string | null;
  candidateAssetId: string | null;
  candidateAssetTitle: string | null;
};

export type SkippedRow = {
  id: string;
  title: string;
  sender: string | null;
  provider: string;
  occurredAt: string | null;
  why: "not_marketing" | "declined";
};

export type AdsListData = {
  rows: AdListRow[];
  counts: Record<Tab, number>;
  anyChecking: boolean;
  totalAds: number;
  triage: TriageRow[];
  skipped: SkippedRow[];
  /** Server time when the list was read; the UI uses it for relative ages. */
  now: number;
};

export type AdsSummary = {
  needReview: number;
  revisionsIn: number;
  connectedAccounts: number;
  lastSyncedAt: string | null;
  brokenConnections: { id: string; provider: string; accountEmail: string | null; status: string }[];
};

export type AdsMetrics = {
  decisions: number;
  ready: boolean;
  minutesPerAd: number | null;
  daysToApproval: number | null;
  approvedFirstTimePct: number | null;
  exceptions: number | null;
  aiSpendToday: number | null;
  aiCap: number | null;
  aiRemaining: number | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type UserLite = { id: string; full_name: string | null; email: string };

async function loadUsers(db: Db, ids: Iterable<string | null | undefined>): Promise<Map<string, UserLite>> {
  const unique = [...new Set([...ids].filter((v): v is string => Boolean(v)))];
  const map = new Map<string, UserLite>();
  if (unique.length === 0) return map;
  const { data } = await db.from("users").select("id, full_name, email").in("id", unique);
  for (const u of data ?? []) map.set(u.id, u);
  return map;
}

function contentOf(json: Json | null | undefined): VersionContent {
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const c = json as Record<string, unknown>;
    const format = c.format;
    return {
      ...(c as unknown as VersionContent),
      format: format === "html" || format === "pdf" || format === "image" ? format : "text",
    };
  }
  return { format: "text" };
}

function thumbIconFor(format: VersionContent["format"], channel: string | null): ThumbIcon {
  if (format === "pdf") return "pdf";
  if (format === "image") return "image";
  const c = (channel ?? "").toLowerCase();
  if (c.includes("mail")) return "email";
  if (c.includes("social")) return "social";
  if (c.includes("display") || c.includes("banner")) return "display";
  if (c.includes("search")) return "search";
  if (c.includes("sms")) return "sms";
  if (c.includes("affiliate") || c.includes("partner")) return "affiliate";
  if (c.includes("landing") || c.includes("web") || format === "html") return "web";
  return "text";
}

async function signUrls(db: Db, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const { data, error } = await db.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL);
  if (error || !data) return out;
  for (const item of data) {
    if (item.signedUrl && item.path) out.set(item.path, item.signedUrl);
  }
  return out;
}

async function signUrl(db: Db, path: string | null, download = false): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL, download ? { download: true } : undefined);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

function tagsFor(input: {
  status: string;
  versionNo: number;
  hasDecisions: boolean;
  hiddenText: boolean;
  changedAfterApproval: boolean;
  notScreened: boolean;
  isSample: boolean;
}): string[] {
  const tags: string[] = [];
  if (input.isSample) tags.push("Sample");
  if (input.hiddenText) tags.push("Hidden text");
  if (input.status === "re_review_due") tags.push("Rates changed");
  if (input.status === "approved_with_exceptions") tags.push("With exceptions");
  if (input.changedAfterApproval) tags.push("Changed after approval");
  if (input.notScreened) tags.push("Not AI-screened");
  if (NEEDS_REVIEW_STATUSES.has(input.status) || input.status === "changes_requested") {
    if (input.versionNo > 1) tags.push(`V${input.versionNo}`);
    else if (!input.hasDecisions) tags.push("New");
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Ads list
// ---------------------------------------------------------------------------

export async function listAds(profileId: string, userId: string): Promise<AdsListData> {
  return listAdsWith(await createClient(), profileId, userId);
}

/** Same as listAds with an explicit (user-context) client; used by scripts. */
export async function listAdsWith(db: Db, profileId: string, userId: string): Promise<AdsListData> {
  const empty: AdsListData = {
    rows: [],
    counts: { needs_review: 0, changes_requested: 0, approved: 0, all: 0 },
    anyChecking: false,
    totalAds: 0,
    triage: [],
    skipped: [],
    now: Date.now(),
  };

  const [queueRes, assetsRes, triageRes, skippedRes] = await Promise.all([
    db.from("asset_queue").select("*").eq("profile_id", profileId).eq("is_draft", false).limit(500),
    db
      .from("assets")
      .select("id, audience, submitter_email, submitter_name, created_by, latest_version_id, approved_decision_id")
      .eq("profile_id", profileId)
      .limit(500),
    db
      .from("source_items")
      .select(
        "id, title, sender, sender_email, provider, kind, occurred_at, classification, classification_reason, inferred, candidate_asset_id",
      )
      .eq("profile_id", profileId)
      .eq("triage_status", "pending")
      .in("classification", ["marketing", "uncertain", "new_version"])
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(50),
    db
      .from("source_items")
      .select("id, title, sender, provider, occurred_at, classification, triage_status")
      .eq("profile_id", profileId)
      .or("classification.eq.not_marketing,triage_status.eq.declined")
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(200),
  ]);

  if (queueRes.error) {
    console.error("[ads] asset_queue read failed:", queueRes.error.code, queueRes.error.message);
    return empty;
  }
  const queue = (queueRes.data ?? []).filter((q) => q.asset_id && q.latest_version_id);
  const assetMeta = new Map((assetsRes.data ?? []).map((a) => [a.id, a]));

  const visibleQueue = queue.filter((q) => assetMeta.get(q.asset_id!)?.audience !== "sample_cleared");
  const latestVersionIds = visibleQueue.map((q) => q.latest_version_id!).filter(Boolean);
  const assetIds = visibleQueue.map((q) => q.asset_id!);

  const [versionsRes, findingsRes, sourcesRes, decisionsRes] = await Promise.all([
    latestVersionIds.length
      ? db.from("asset_versions").select("id, asset_id, content, storage_path, author_id").in("id", latestVersionIds)
      : Promise.resolve({ data: [] as { id: string; asset_id: string; content: Json; storage_path: string | null; author_id: string | null }[] }),
    latestVersionIds.length
      ? db
          .from("findings")
          .select("id, asset_version_id, severity, quote, explanation, origin, created_at, analysis_runs(status)")
          .in("asset_version_id", latestVersionIds)
      : Promise.resolve({ data: [] as never[] }),
    assetIds.length
      ? db.from("asset_sources").select("asset_id, source_item_id").in("asset_id", assetIds)
      : Promise.resolve({ data: [] as { asset_id: string; source_item_id: string }[] }),
    assetIds.length
      ? db
          .from("decisions")
          .select("id, asset_id, decision, approver_id, created_at")
          .in("asset_id", assetIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; asset_id: string; decision: string; approver_id: string; created_at: string }[] }),
  ]);

  const versions = new Map((versionsRes.data ?? []).map((v) => [v.id, v]));

  // Latest dispositions for the findings we loaded, to find the top OPEN issue (with its quote).
  type FindingLite = {
    id: string;
    asset_version_id: string;
    severity: string;
    quote: string | null;
    explanation: string | null;
    origin: string;
    created_at: string;
    analysis_runs: { status: string } | { status: string }[] | null;
  };
  // Issues a reviewer should see on a version: reviewer findings plus the AI
  // findings from a complete run. When no run completed (the model was
  // refused, the budget ran out), the deterministic product-terms findings
  // the failed run kept are shown instead, flagged as not decision-grade.
  const allFindings = (findingsRes.data ?? []) as unknown as FindingLite[];
  const versionsWithComplete = new Set<string>();
  for (const f of allFindings) {
    const run = Array.isArray(f.analysis_runs) ? f.analysis_runs[0] : f.analysis_runs;
    if (f.origin !== "reviewer" && run?.status === "complete") versionsWithComplete.add(f.asset_version_id);
  }
  const findings = allFindings.filter((f) => {
    if (f.origin === "reviewer") return true;
    const run = Array.isArray(f.analysis_runs) ? f.analysis_runs[0] : f.analysis_runs;
    if (run?.status === "complete") return true;
    return !versionsWithComplete.has(f.asset_version_id) && (run?.status === "failed" || run?.status === "declined_budget");
  });
  const dispositionMap = new Map<string, { disposition: string | null; severity_override: string | null }>();
  if (findings.length) {
    const { data } = await db
      .from("finding_latest_dispositions")
      .select("finding_id, disposition, severity_override")
      .in(
        "finding_id",
        findings.map((f) => f.id),
      );
    for (const d of data ?? []) if (d.finding_id) dispositionMap.set(d.finding_id, d);
  }
  const topByVersion = new Map<string, FindingLite>();
  const openByVersion = new Map<string, { critical: number; major: number; minor: number }>();
  for (const f of findings) {
    const d = dispositionMap.get(f.id);
    if (d?.disposition && d.disposition !== "fix_required") continue;
    const sev = asSeverity(d?.severity_override ?? f.severity);
    const counts = openByVersion.get(f.asset_version_id) ?? { critical: 0, major: 0, minor: 0 };
    counts[sev] += 1;
    openByVersion.set(f.asset_version_id, counts);
    const cur = topByVersion.get(f.asset_version_id);
    if (!cur) {
      topByVersion.set(f.asset_version_id, { ...f, severity: sev });
      continue;
    }
    const a = SEVERITY_ORDER[sev];
    const b = SEVERITY_ORDER[asSeverity(cur.severity)];
    if (a < b || (a === b && f.created_at < cur.created_at)) topByVersion.set(f.asset_version_id, { ...f, severity: sev });
  }

  // Sources (for "Seen in N places" and the From column of synced ads).
  const sourcesByAsset = new Map<string, string[]>();
  for (const s of sourcesRes.data ?? []) {
    const list = sourcesByAsset.get(s.asset_id) ?? [];
    list.push(s.source_item_id);
    sourcesByAsset.set(s.asset_id, list);
  }
  const sourceItemIds = [...new Set([...sourcesByAsset.values()].flat())];
  type SourceLite = { id: string; provider: string; sender: string | null; sender_email: string | null; connection_id: string | null };
  const sourceItems = new Map<string, SourceLite>();
  const connections = new Map<string, { id: string; provider: string; account_email: string | null; connected_by: string | null }>();
  if (sourceItemIds.length) {
    const { data } = await db
      .from("source_items")
      .select("id, provider, sender, sender_email, connection_id")
      .in("id", sourceItemIds);
    for (const s of data ?? []) sourceItems.set(s.id, s);
    const connIds = [...new Set((data ?? []).map((s) => s.connection_id).filter((v): v is string => Boolean(v)))];
    if (connIds.length) {
      const { data: conns } = await db.from("connections").select("id, provider, account_email, connected_by").in("id", connIds);
      for (const c of conns ?? []) connections.set(c.id, c);
    }
  }

  const decisionsByAsset = new Map<string, { id: string; decision: string; approver_id: string; created_at: string }[]>();
  for (const d of decisionsRes.data ?? []) {
    const list = decisionsByAsset.get(d.asset_id) ?? [];
    list.push(d);
    decisionsByAsset.set(d.asset_id, list);
  }

  const users = await loadUsers(db, [
    ...(assetsRes.data ?? []).map((a) => a.created_by),
    ...(versionsRes.data ?? []).map((v) => v.author_id),
    ...(decisionsRes.data ?? []).map((d) => d.approver_id),
    ...[...connections.values()].map((c) => c.connected_by),
  ]);

  // Thumbnails: sign image paths in one call.
  const imagePaths: string[] = [];
  for (const v of versions.values()) {
    const c = contentOf(v.content);
    if (c.format === "image" && v.storage_path) imagePaths.push(v.storage_path);
  }
  const signed = await signUrls(db, imagePaths);

  const rows: AdListRow[] = [];
  for (const q of visibleQueue) {
    const meta = assetMeta.get(q.asset_id!);
    const version = versions.get(q.latest_version_id!);
    const content = contentOf(version?.content);
    const status = q.status ?? "needs_review";
    const isSample = meta?.audience === "sample";
    const hiddenText = (q.open_alert_count ?? 0) > 0;
    const checking = q.analysis_status === "queued" || q.analysis_status === "running";
    const notScreened = status === "needs_manual_review" && q.analysis_status !== "complete";
    const decisions = decisionsByAsset.get(q.asset_id!) ?? [];
    const approval = q.approved_decision_id ? decisions.find((d) => d.id === q.approved_decision_id) ?? null : null;
    const top = topByVersion.get(q.latest_version_id!);

    // From: synced ads name the connector account; uploads name the author.
    let from: FromInfo;
    const sourceIds = sourcesByAsset.get(q.asset_id!) ?? [];
    const connectorSource = sourceIds.map((id) => sourceItems.get(id)).find((s) => s?.connection_id);
    if (isSample) {
      from = { label: "Sample ad", detail: null, kind: "sample", provider: null };
    } else if (connectorSource) {
      const conn = connectorSource.connection_id ? connections.get(connectorSource.connection_id) : undefined;
      const owner = conn?.connected_by ? users.get(conn.connected_by) : undefined;
      const senderLabel = connectorSource.sender?.trim() || connectorSource.sender_email || q.submitter_name || "Unknown sender";
      from = {
        label: senderLabel,
        detail: conn ? `via ${owner?.full_name?.trim() || owner?.email || "a member"}'s ${providerName(conn.provider)}` : null,
        kind: "connector",
        provider: conn?.provider ?? connectorSource.provider,
      };
    } else if ((version?.author_id ?? meta?.created_by) === userId) {
      from = { label: "You", detail: null, kind: "you", provider: null };
    } else if (meta?.submitter_name || meta?.submitter_email) {
      from = {
        label: meta.submitter_name?.trim() || meta.submitter_email || "Submitter",
        detail: meta.submitter_name && meta.submitter_email ? meta.submitter_email : null,
        kind: "submitter",
        provider: null,
      };
    } else {
      const authorId = version?.author_id ?? meta?.created_by ?? null;
      const u = authorId ? users.get(authorId) : undefined;
      from = { label: u?.full_name?.trim() || u?.email || "A member", detail: null, kind: "member", provider: null };
    }

    const thumbnail: AdListRow["thumbnail"] =
      content.format === "image" && version?.storage_path && signed.get(version.storage_path)
        ? { kind: "image", url: signed.get(version.storage_path)! }
        : { kind: "icon", icon: thumbIconFor(content.format, q.channel) };

    // The queue view only counts decision-grade findings; fall back to what we
    // loaded (deterministic findings on a not-screened version) so the row
    // still shows the real risk.
    const loadedOpen = openByVersion.get(q.latest_version_id!);
    const openCritical = (q.open_critical ?? 0) || loadedOpen?.critical || 0;
    const openMajor = (q.open_major ?? 0) || loadedOpen?.major || 0;
    const openMinor = (q.open_minor ?? 0) || loadedOpen?.minor || 0;
    const submittedAt = q.submitted_at ?? q.created_at ?? new Date(0).toISOString();
    const ageMs = Math.max(0, Date.now() - new Date(submittedAt).getTime());
    // Worst first: hidden text > critical > major > minor > age (older is worse).
    const rank =
      (hiddenText ? 0 : 1) * 1e15 +
      (openCritical ? 0 : 1) * 1e14 +
      (openMajor ? 0 : 1) * 1e13 +
      (openMinor ? 0 : 1) * 1e12 +
      Math.max(0, 1e12 - ageMs);

    rows.push({
      id: q.asset_id!,
      title: q.title?.trim() || "Untitled ad",
      product: asProduct(q.product),
      channel: q.channel,
      status,
      tab: tabForStatus(status),
      tags: tagsFor({
        status,
        versionNo: q.latest_version_no ?? 1,
        hasDecisions: decisions.length > 0,
        hiddenText,
        changedAfterApproval: Boolean(q.changed_after_approval),
        notScreened,
        isSample,
      }),
      checking,
      checkStage: q.analysis_stage,
      notScreened,
      openCritical,
      openMajor,
      openMinor,
      hiddenText,
      topIssue: top ? { quote: top.quote, explanation: top.explanation } : q.top_issue ? { quote: null, explanation: q.top_issue } : null,
      from,
      thumbnail,
      versionNo: q.latest_version_no ?? 1,
      approvedVersionNo: q.approved_version_no,
      approvedBy: approval ? (users.get(approval.approver_id)?.full_name?.trim() || users.get(approval.approver_id)?.email || null) : null,
      approvedAt: approval?.created_at ?? null,
      withExceptions: status === "approved_with_exceptions",
      submittedAt,
      updatedAt: q.updated_at ?? submittedAt,
      isSample,
      seenIn: sourceIds.length,
      rank,
    });
  }

  rows.sort((a, b) => a.rank - b.rank);

  const counts: Record<Tab, number> = { needs_review: 0, changes_requested: 0, approved: 0, all: 0 };
  for (const r of rows) {
    if (r.isSample) continue;
    counts.all += 1;
    if (r.tab) counts[r.tab] += 1;
  }

  const candidateIds = (triageRes.data ?? []).map((t) => t.candidate_asset_id).filter((v): v is string => Boolean(v));
  const candidateTitles = new Map<string, string>();
  for (const q of queue) if (q.asset_id && candidateIds.includes(q.asset_id)) candidateTitles.set(q.asset_id, q.title ?? "Untitled ad");

  const triage: TriageRow[] = (triageRes.data ?? []).map((t) => {
    const inferred = (t.inferred && typeof t.inferred === "object" && !Array.isArray(t.inferred) ? t.inferred : {}) as Record<string, unknown>;
    return {
      id: t.id,
      title: t.title?.trim() || "Untitled item",
      sender: t.sender,
      senderEmail: t.sender_email,
      provider: t.provider,
      kind: t.kind,
      occurredAt: t.occurred_at,
      classification: t.classification,
      reason: t.classification_reason,
      product: asProduct(typeof inferred.product === "string" ? inferred.product : null),
      channel: typeof inferred.channel === "string" ? inferred.channel : null,
      candidateAssetId: t.candidate_asset_id,
      candidateAssetTitle: t.candidate_asset_id ? candidateTitles.get(t.candidate_asset_id) ?? null : null,
    };
  });

  const skipped: SkippedRow[] = (skippedRes.data ?? []).map((s) => ({
    id: s.id,
    title: s.title?.trim() || "Untitled item",
    sender: s.sender,
    provider: s.provider,
    occurredAt: s.occurred_at,
    why: s.triage_status === "declined" ? "declined" : "not_marketing",
  }));

  return {
    rows,
    counts,
    anyChecking: rows.some((r) => r.checking),
    totalAds: rows.length,
    triage,
    skipped,
    now: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Summary line, metrics, banners
// ---------------------------------------------------------------------------

export async function getAdsSummary(profileId: string, list: AdsListData): Promise<AdsSummary> {
  return getAdsSummaryWith(await createClient(), profileId, list);
}

export async function getAdsSummaryWith(db: Db, profileId: string, list: AdsListData): Promise<AdsSummary> {
  const { data: conns } = await db
    .from("connections")
    .select("id, provider, account_email, status, last_synced_at")
    .eq("profile_id", profileId);
  const live = (conns ?? []).filter((c) => c.status === "connected" || c.status === "syncing");
  const broken = (conns ?? []).filter((c) => c.status === "needs_reconnect" || c.status === "error");
  const lastSyncedAt = live.reduce<string | null>((acc, c) => {
    if (!c.last_synced_at) return acc;
    return !acc || c.last_synced_at > acc ? c.last_synced_at : acc;
  }, null);
  const real = list.rows.filter((r) => !r.isSample);
  return {
    needReview: real.filter((r) => r.tab === "needs_review").length,
    revisionsIn: real.filter((r) => r.tab === "needs_review" && r.versionNo > 1).length,
    connectedAccounts: live.length,
    lastSyncedAt,
    brokenConnections: broken.map((c) => ({ id: c.id, provider: c.provider, accountEmail: c.account_email, status: c.status })),
  };
}

export async function getAdsMetrics(profileId: string): Promise<AdsMetrics> {
  return getAdsMetricsWith(await createClient(), profileId);
}

export async function getAdsMetricsWith(db: Db, profileId: string): Promise<AdsMetrics> {
  const out: AdsMetrics = {
    decisions: 0,
    ready: false,
    minutesPerAd: null,
    daysToApproval: null,
    approvedFirstTimePct: null,
    exceptions: null,
    aiSpendToday: null,
    aiCap: null,
    aiRemaining: null,
  };

  const [budgetRes, decisionsRes, assetsRes] = await Promise.all([
    db.rpc("ai_budget_status", { p_profile_id: profileId }),
    db
      .from("decisions")
      .select("id, asset_id, asset_version_id, decision, created_at")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: true })
      .limit(2000),
    db.from("assets").select("id, audience, submitted_at, status").eq("profile_id", profileId).limit(1000),
  ]);

  const budget = Array.isArray(budgetRes.data) ? budgetRes.data[0] : budgetRes.data;
  if (budget) {
    out.aiSpendToday = Number(budget.profile_used_usd ?? 0);
    out.aiCap = Number(budget.profile_cap_usd ?? 0);
    out.aiRemaining = Number(budget.remaining_usd ?? 0);
  }

  // Samples are never counted, and clearing them (audience 'sample_cleared')
  // must not turn their practice decisions into real numbers.
  const sampleIds = new Set((assetsRes.data ?? []).filter((a) => isSampleAudience(a.audience)).map((a) => a.id));
  const assetById = new Map((assetsRes.data ?? []).map((a) => [a.id, a]));
  const decisions = (decisionsRes.data ?? []).filter((d) => !sampleIds.has(d.asset_id) && d.decision !== "withdrawn");
  out.decisions = decisions.length;
  out.ready = decisions.length >= 5;
  if (!out.ready) return out;

  const byAsset = new Map<string, typeof decisions>();
  for (const d of decisions) {
    const list = byAsset.get(d.asset_id) ?? [];
    list.push(d);
    byAsset.set(d.asset_id, list);
  }

  // Days to approval: submitted_at -> first approval, per approved asset.
  const approvalDays: number[] = [];
  let firstTime = 0;
  for (const [assetId, list] of byAsset) {
    const first = list[0];
    if (APPROVED_STATUSES.has(first.decision)) firstTime += 1;
    const approval = list.find((d) => APPROVED_STATUSES.has(d.decision));
    const submitted = assetById.get(assetId)?.submitted_at;
    if (approval && submitted) {
      const days = (new Date(approval.created_at).getTime() - new Date(submitted).getTime()) / 86_400_000;
      if (days >= 0) approvalDays.push(days);
    }
  }
  out.approvedFirstTimePct = byAsset.size ? Math.round((firstTime / byAsset.size) * 100) : null;
  out.daysToApproval = approvalDays.length ? round1(approvalDays.reduce((a, b) => a + b, 0) / approvalDays.length) : null;
  out.exceptions = (assetsRes.data ?? []).filter((a) => a.status === "approved_with_exceptions" && !isSampleAudience(a.audience)).length;

  // Minutes per ad: reviewer active time on decided assets' versions.
  const decidedVersionIds = [...new Set(decisions.map((d) => d.asset_version_id))];
  if (decidedVersionIds.length) {
    const { data: sessions } = await db
      .from("review_sessions")
      .select("asset_version_id, active_seconds, surface")
      .in("asset_version_id", decidedVersionIds)
      .in("surface", ["workbench", "compare", "composer"]);
    const total = (sessions ?? []).reduce((acc, s) => acc + (s.active_seconds ?? 0), 0);
    out.minutesPerAd = byAsset.size ? round1(total / 60 / byAsset.size) : null;
  }
  return out;
}

/** Sample ads, including ones a reviewer has cleared, never count toward the workspace metrics. */
function isSampleAudience(audience: string | null | undefined): boolean {
  return audience === "sample" || audience === "sample_cleared";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// Ad detail
// ---------------------------------------------------------------------------

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
  severity: Severity;
  /** Severity as the AI (or reviewer) set it, before any override. */
  originalSeverity: Severity;
  evidenceType: string;
  quote: string | null;
  verifiedSpan: boolean;
  anchor: FindingAnchor | null;
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

  const [versionsRes, runsRes, decisionsRes, changeRes, eventsRes, membersRes, sourcesRes, nextRes] = await Promise.all([
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
    db.from("events").select("id, kind, actor_id, data, created_at").eq("asset_id", assetId).order("created_at", { ascending: true }).limit(500),
    db.from("profile_members").select("user_id").eq("profile_id", profileId),
    db.from("asset_sources").select("source_item_id").eq("asset_id", assetId),
    db
      .from("asset_queue")
      .select("asset_id, status, open_alert_count, open_critical, open_major, submitted_at, latest_version_id")
      .eq("profile_id", profileId)
      .eq("is_draft", false)
      .neq("asset_id", assetId)
      .in("status", [...NEEDS_REVIEW_STATUSES])
      .limit(200),
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

  // Rule versions + reference library for citations.
  const ruleVersionIds = [...new Set(usableFindings.map((f) => f.rule_version_id).filter((v): v is string => Boolean(v)))];
  const rulesById = new Map<string, { id: string; rule_id: string; title: string; body: string; reference_ids: string[]; code: string | null }>();
  const refsById = new Map<string, { id: string; label: string; citation: string; url: string | null }>();
  if (ruleVersionIds.length) {
    const { data: rvs } = await db.from("rule_versions").select("id, rule_id, title, body, reference_ids, rules(code)").in("id", ruleVersionIds);
    const refIds = new Set<string>();
    for (const rv of rvs ?? []) {
      const rule = Array.isArray(rv.rules) ? rv.rules[0] : rv.rules;
      rulesById.set(rv.id, { id: rv.id, rule_id: rv.rule_id, title: rv.title, body: rv.body, reference_ids: rv.reference_ids ?? [], code: (rule as { code?: string } | null)?.code ?? null });
      for (const r of rv.reference_ids ?? []) refIds.add(r);
    }
    if (refIds.size) {
      const { data: refs } = await db.from("reference_library").select("id, label, citation, url").in("id", [...refIds]);
      for (const r of refs ?? []) refsById.set(r.id, r);
    }
  }

  const users = await loadUsers(db, [
    ...versionRows.map((v) => v.author_id),
    ...(decisionsRes.data ?? []).map((d) => d.approver_id),
    ...(changeRes.data ?? []).map((c) => c.author_id),
    ...(eventsRes.data ?? []).map((e) => e.actor_id),
    ...[...dispositions.values()].map((d) => d.actor_id),
    ...(alertsRes.data ?? []).map((a) => a.acknowledged_by),
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
      severity: effective,
      originalSeverity: original,
      evidenceType: f.evidence_type,
      quote: f.quote,
      verifiedSpan: f.verified_span,
      anchor,
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
      createdAt: f.created_at,
    };
  };

  const sortFindings = (a: AdFinding, b: AdFinding) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.createdAt.localeCompare(b.createdAt);
  const findings = usableFindings.filter((f) => f.asset_version_id === latest.id).map(toFinding).sort(sortFindings);
  const previousFindings = previous ? usableFindings.filter((f) => f.asset_version_id === previous.id).map(toFinding).sort(sortFindings) : [];

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

  const events: AdEvent[] = (eventsRes.data ?? []).map((e) => ({
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

  // Next ad to open after a decision: worst first among Needs review.
  const next = (nextRes.data ?? [])
    .map((q) => ({
      id: q.asset_id!,
      rank:
        ((q.open_alert_count ?? 0) > 0 ? 0 : 1) * 1e15 +
        ((q.open_critical ?? 0) > 0 ? 0 : 1) * 1e14 +
        ((q.open_major ?? 0) > 0 ? 0 : 1) * 1e13 +
        Math.max(0, 1e12 - (Date.now() - new Date(q.submitted_at ?? 0).getTime())),
    }))
    .sort((a, b) => a.rank - b.rank)[0];

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
    nextNeedsReviewId: next?.id ?? null,
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

/** Worst-first id of the next ad needing review, excluding one. Used after a decision. */
export async function getNextNeedsReviewId(profileId: string, excludeAssetId: string): Promise<string | null> {
  return getNextNeedsReviewIdWith(await createClient(), profileId, excludeAssetId);
}

export async function getNextNeedsReviewIdWith(db: Db, profileId: string, excludeAssetId: string): Promise<string | null> {
  const { data } = await db
    .from("asset_queue")
    .select("asset_id, open_alert_count, open_critical, open_major, submitted_at")
    .eq("profile_id", profileId)
    .eq("is_draft", false)
    .neq("asset_id", excludeAssetId)
    .in("status", [...NEEDS_REVIEW_STATUSES])
    .limit(200);
  const next = (data ?? [])
    .map((q) => ({
      id: q.asset_id!,
      rank:
        ((q.open_alert_count ?? 0) > 0 ? 0 : 1) * 1e15 +
        ((q.open_critical ?? 0) > 0 ? 0 : 1) * 1e14 +
        ((q.open_major ?? 0) > 0 ? 0 : 1) * 1e13 +
        Math.max(0, 1e12 - (Date.now() - new Date(q.submitted_at ?? 0).getTime())),
    }))
    .sort((a, b) => a.rank - b.rank)[0];
  return next?.id ?? null;
}

/**
 * Fire-and-forget after the response: ask the engine to pick up any run that
 * is still queued (for example when the after() that should have started it
 * never ran). `nudgeStaleRuns` is an optional export on the engine side.
 */
export function nudgeStaleRunsAfter(profileId: string): void {
  after(async () => {
    try {
      const mod = (await import("@/lib/ai/engine")) as Record<string, unknown>;
      const fn = mod.nudgeStaleRuns;
      if (typeof fn === "function") await (fn as (id: string) => Promise<void>)(profileId);
    } catch (err) {
      console.error("[ads] nudgeStaleRuns failed:", (err as Error).message);
    }
  });
}
