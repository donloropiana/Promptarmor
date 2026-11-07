import "server-only";

import {
  LIST_CAP,
  EMPTY_COUNTS,
  adTags,
  isNotScreened,
  rankAd,
  tabForAsset,
  type Tab,
} from "@/features/ads/domain";
import { providerName } from "@/features/ads/format";
import { asProduct, type Product } from "@/features/products/catalog";
import { SEVERITY_ORDER, asSeverity } from "@/features/rules/severity";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { imageRegionOf, type VersionContent } from "@/features/ads/types";

import { contentOf, loadUsers, signUrls, type Db } from "./shared";

/**
 * The Ads list: one row per ad (tab, tags, open issues and the top one, who
 * it came from, thumbnail, approval and its life after approval, rank), the
 * tab counts, and the arrivals waiting in triage or skipped. Read-only, with
 * the user-context client.
 */

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
  /** A PDF or image from which no text could be read (and no model read it either). */
  noText: boolean;
  from: FromInfo;
  thumbnail: { kind: "image"; url: string } | { kind: "icon"; icon: ThumbIcon };
  versionNo: number;
  approvedVersionNo: number | null;
  approvedBy: string | null;
  approvedAt: string | null;
  withExceptions: boolean;
  /** Exceptions recorded on the standing approval (0 when none or not approved). */
  exceptionCount: number;
  /** Life after approval (see src/features/ads/domain.ts isLive, format.ts lifecycleLine). */
  liveAt: string | null;
  liveChannel: string | null;
  liveUrl: string | null;
  expiresAt: string | null;
  archivedAt: string | null;
  archiveReason: string | null;
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
  /** True when the workspace has more ads than LIST_CAP; the oldest are left out. */
  truncated: boolean;
  triage: TriageRow[];
  skipped: SkippedRow[];
  /** Server time when the list was read; the UI uses it for relative ages. */
  now: number;
};

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

export type LifecycleRow = {
  live_at: string | null;
  live_channel: string | null;
  live_url: string | null;
  expires_at: string | null;
  archived_at: string | null;
  archive_reason: string | null;
};
const NO_LIFECYCLE: LifecycleRow = { live_at: null, live_channel: null, live_url: null, expires_at: null, archived_at: null, archive_reason: null };

/**
 * Live/expiry/archive columns for a set of ads. Read on its own so a database
 * that has not run the lifecycle migration yet (undefined column, 42703)
 * degrades to "nothing live, nothing archived" instead of breaking the list.
 */
async function loadLifecycle(db: Db, profileId: string, assetIds: string[]): Promise<Map<string, LifecycleRow>> {
  const map = new Map<string, LifecycleRow>();
  if (assetIds.length === 0) return map;
  const { data, error } = await db
    .from("assets")
    .select("id, live_at, live_channel, live_url, expires_at, archived_at, archive_reason")
    .eq("profile_id", profileId)
    .in("id", assetIds);
  if (error) {
    if (error.code !== "42703") console.error("[ads] lifecycle read failed:", error.code, error.message);
    return map;
  }
  for (const r of data ?? []) map.set(r.id, r);
  return map;
}

export async function listAds(profileId: string, userId: string): Promise<AdsListData> {
  return listAdsWith(await createClient(), profileId, userId);
}

/** Same as listAds with an explicit (user-context) client; used by scripts. */
export async function listAdsWith(db: Db, profileId: string, userId: string): Promise<AdsListData> {
  const empty: AdsListData = {
    rows: [],
    counts: { ...EMPTY_COUNTS },
    anyChecking: false,
    totalAds: 0,
    truncated: false,
    triage: [],
    skipped: [],
    now: Date.now(),
  };

  const [queueRes, assetsRes, triageRes, skippedRes] = await Promise.all([
    // Newest first so the cap, when hit, drops the oldest ads, not random ones.
    db.from("asset_queue").select("*").eq("profile_id", profileId).eq("is_draft", false).order("submitted_at", { ascending: false, nullsFirst: false }).limit(LIST_CAP),
    db
      .from("assets")
      .select("id, audience, submitter_email, submitter_name, created_by, latest_version_id, approved_decision_id")
      .eq("profile_id", profileId)
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .limit(LIST_CAP),
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

  type VersionLite = { id: string; asset_id: string; format: string | null; storage_path: string | null; author_id: string | null };
  const [versionsRes, findingsRes, sourcesRes, decisionsRes, noTextRes, lifecycle] = await Promise.all([
    // Only the fields the row needs: `content` can hold 60 KB of text or HTML
    // per version and the list never shows it.
    latestVersionIds.length
      ? db
          .from("asset_versions")
          .select("id, asset_id, format:content->>format, storage_path, author_id")
          .in("id", latestVersionIds)
          .then((r) => ({ data: (r.data ?? []) as unknown as VersionLite[], error: r.error }))
      : Promise.resolve({ data: [] as VersionLite[], error: null }),
    latestVersionIds.length
      ? db
          .from("findings")
          .select("id, asset_version_id, severity, quote, explanation, origin, created_at, anchor, analysis_runs(status)")
          .in("asset_version_id", latestVersionIds)
      : Promise.resolve({ data: [] as never[] }),
    assetIds.length
      ? db.from("asset_sources").select("asset_id, source_item_id").in("asset_id", assetIds)
      : Promise.resolve({ data: [] as { asset_id: string; source_item_id: string }[] }),
    assetIds.length
      ? db
          .from("decisions")
          .select("id, asset_id, decision, approver_id, created_at, exceptions")
          .in("asset_id", assetIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; asset_id: string; decision: string; approver_id: string; created_at: string; exceptions: Json }[] }),
    // Files nothing could read: intake stores an empty extraction as NULL, so
    // this is one cheap id lookup instead of loading every text.
    latestVersionIds.length
      ? db.from("asset_versions").select("id").in("id", latestVersionIds).is("extracted_text", null)
      : Promise.resolve({ data: [] as { id: string }[] }),
    loadLifecycle(db, profileId, assetIds),
  ]);

  const versions = new Map((versionsRes.data ?? []).map((v) => [v.id, v]));
  const noTextVersionIds = new Set((noTextRes.data ?? []).map((v) => v.id));
  // ...unless a completed check read the file as an image (the model transcribed it).
  const transcribedVersionIds = new Set<string>();
  if (noTextVersionIds.size) {
    const { data } = await db
      .from("analysis_runs")
      .select("asset_version_id, transcribed:input_metadata->>transcribed")
      .in("asset_version_id", [...noTextVersionIds])
      .eq("status", "complete");
    for (const r of (data ?? []) as unknown as { asset_version_id: string; transcribed: string | null }[]) {
      if (r.transcribed === "true") transcribedVersionIds.add(r.asset_version_id);
    }
  }

  // Latest dispositions for the findings we loaded, to find the top OPEN issue (with its quote).
  type FindingLite = {
    id: string;
    asset_version_id: string;
    severity: string;
    quote: string | null;
    explanation: string | null;
    origin: string;
    created_at: string;
    anchor: Json | null;
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

  const decisionsByAsset = new Map<string, { id: string; decision: string; approver_id: string; created_at: string; exceptions: Json }[]>();
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
    if (v.format === "image" && v.storage_path) imagePaths.push(v.storage_path);
  }
  const signed = await signUrls(db, imagePaths);

  const rows: AdListRow[] = [];
  const now = Date.now();
  for (const q of visibleQueue) {
    const meta = assetMeta.get(q.asset_id!);
    const version = versions.get(q.latest_version_id!);
    const content = contentOf(version ? { format: version.format } : null);
    const status = q.status ?? "needs_review";
    const life = lifecycle.get(q.asset_id!) ?? NO_LIFECYCLE;
    const isSample = meta?.audience === "sample";
    const hiddenText = (q.open_alert_count ?? 0) > 0;
    const checking = q.analysis_status === "queued" || q.analysis_status === "running";
    const notScreened = isNotScreened(status, q.analysis_status);
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

    rows.push({
      id: q.asset_id!,
      title: q.title?.trim() || "Untitled ad",
      product: asProduct(q.product),
      channel: q.channel,
      status,
      tab: tabForAsset({ status, liveAt: life.live_at, expiresAt: life.expires_at, archivedAt: life.archived_at }),
      tags: adTags({
        status,
        versionNo: q.latest_version_no ?? 1,
        hasDecisions: decisions.length > 0,
        hiddenText,
        changedAfterApproval: Boolean(q.changed_after_approval),
        notScreened,
        isSample,
        reReviewReason: q.re_review_reason,
      }),
      checking,
      checkStage: q.analysis_stage,
      notScreened,
      openCritical,
      openMajor,
      openMinor,
      hiddenText,
      // A note pinned on the image has a label, not quoted ad copy, so it is not shown in quotation marks.
      topIssue: top
        ? imageRegionOf(top.anchor)
          ? { quote: null, explanation: `Pinned on the image: ${top.quote ?? "note"}${top.explanation ? ` — ${top.explanation}` : ""}` }
          : { quote: top.quote, explanation: top.explanation }
        : q.top_issue
          ? { quote: null, explanation: q.top_issue }
          : null,
      noText: (content.format === "pdf" || content.format === "image") && noTextVersionIds.has(q.latest_version_id!) && !transcribedVersionIds.has(q.latest_version_id!),
      from,
      thumbnail,
      versionNo: q.latest_version_no ?? 1,
      approvedVersionNo: q.approved_version_no,
      approvedBy: approval ? (users.get(approval.approver_id)?.full_name?.trim() || users.get(approval.approver_id)?.email || null) : null,
      approvedAt: approval?.created_at ?? null,
      withExceptions: status === "approved_with_exceptions",
      exceptionCount: Array.isArray(approval?.exceptions) ? approval.exceptions.length : 0,
      liveAt: life.live_at,
      liveChannel: life.live_channel,
      liveUrl: life.live_url,
      expiresAt: life.expires_at,
      archivedAt: life.archived_at,
      archiveReason: life.archive_reason,
      submittedAt,
      updatedAt: q.updated_at ?? submittedAt,
      isSample,
      seenIn: sourceIds.length,
      rank: rankAd({ hiddenText, openCritical, openMajor, openMinor, submittedAt }, now),
    });
  }

  rows.sort((a, b) => a.rank - b.rank);

  const counts: Record<Tab, number> = { ...EMPTY_COUNTS };
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
    truncated: (queueRes.data?.length ?? 0) >= LIST_CAP,
    triage,
    skipped,
    now: Date.now(),
  };
}
