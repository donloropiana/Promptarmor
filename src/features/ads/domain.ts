/**
 * Ads domain rules: the review tabs, which statuses belong where, life after
 * approval (live, expired, archived), the channel vocabulary, and how an ad is
 * ranked and tagged. Framework-free (no React, no server-only), so the list,
 * the ad page, server queries and actions all apply the same rules.
 * Presentation (dates, money, sentences) lives in ./format.
 */

// ---------------------------------------------------------------------------
// Tabs and statuses
// ---------------------------------------------------------------------------

export type Tab = "needs_review" | "changes_requested" | "approved" | "live" | "archived" | "all";

/** Most ads one list read loads (newest first); the list says so when the cap is hit. */
export const LIST_CAP = 500;

export const TABS: { key: Tab; label: string }[] = [
  { key: "needs_review", label: "Needs review" },
  { key: "changes_requested", label: "Changes requested" },
  { key: "approved", label: "Approved" },
  { key: "live", label: "Live" },
  { key: "archived", label: "Archived" },
  { key: "all", label: "All" },
];

export const EMPTY_COUNTS: Record<Tab, number> = { needs_review: 0, changes_requested: 0, approved: 0, live: 0, archived: 0, all: 0 };

export function parseTab(value: string | string[] | undefined): Tab {
  const v = Array.isArray(value) ? value[0] : value;
  return TABS.some((t) => t.key === v) ? (v as Tab) : "needs_review";
}

export const NEEDS_REVIEW_STATUSES = new Set([
  "needs_review",
  "needs_manual_review",
  "recheck_ready",
  "re_review_due",
]);
export const APPROVED_STATUSES = new Set(["approved", "approved_with_exceptions"]);

/** Archive is for ads that are done deciding (approved, live, rejected or waiting on a revision). */
export const ARCHIVABLE_STATUSES = new Set(["approved", "approved_with_exceptions", "rejected", "changes_requested", "withdrawn"]);

/** Which tab (other than All) an asset status belongs to; null for rejected/withdrawn/drafts. */
export function tabForStatus(status: string): Exclude<Tab, "all"> | null {
  if (NEEDS_REVIEW_STATUSES.has(status)) return "needs_review";
  if (status === "changes_requested") return "changes_requested";
  if (APPROVED_STATUSES.has(status)) return "approved";
  return null;
}

export type StatusWord = "Needs review" | "Changes requested" | "Approved" | "Rejected" | "Withdrawn" | "Draft";

export function statusWord(status: string): StatusWord {
  if (NEEDS_REVIEW_STATUSES.has(status)) return "Needs review";
  if (status === "changes_requested") return "Changes requested";
  if (APPROVED_STATUSES.has(status)) return "Approved";
  if (status === "rejected") return "Rejected";
  if (status === "withdrawn") return "Withdrawn";
  return "Draft";
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Life after approval. Status never changes for these: an ad is Live while
 * its approval stands, it was marked live and its end date (if any) has not
 * passed; Archived whenever archived_at is set.
 */
export type Lifecycle = {
  status: string;
  liveAt: string | null;
  expiresAt: string | null;
  archivedAt: string | null;
};

export function isLive(l: Lifecycle, now = Date.now()): boolean {
  if (!l.liveAt || l.archivedAt || !APPROVED_STATUSES.has(l.status)) return false;
  if (l.expiresAt && new Date(l.expiresAt).getTime() <= now) return false;
  return true;
}

/** Which tab (other than All) an asset belongs to, lifecycle included. */
export function tabForAsset(l: Lifecycle, now = Date.now()): Exclude<Tab, "all"> | null {
  if (l.archivedAt) return "archived";
  if (isLive(l, now)) return "live";
  return tabForStatus(l.status);
}

/** Where an ad can go live. Stored as the value; free text is kept as typed. */
export const LIVE_CHANNELS: { value: string; label: string }[] = [
  { value: "meta", label: "Meta" },
  { value: "google", label: "Google" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "tiktok", label: "TikTok" },
  { value: "email", label: "Email" },
  { value: "website", label: "Website" },
  { value: "display", label: "Display" },
  { value: "sms", label: "SMS" },
  { value: "print", label: "Print" },
  { value: "other", label: "Other" },
];

export function liveChannelLabel(c: string | null | undefined): string {
  if (!c) return "";
  const known = LIVE_CHANNELS.find((o) => o.value === c);
  if (known) return known.label;
  const words = c.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

/** Channel values are free text; these are the ones the product recognises. */
export const CHANNEL_OPTIONS: { value: string; label: string }[] = [
  { value: "paid_social", label: "Paid social" },
  { value: "email", label: "Email" },
  { value: "display", label: "Display" },
  { value: "search", label: "Search" },
  { value: "landing_page", label: "Landing page" },
  { value: "affiliate", label: "Affiliate" },
  { value: "sms", label: "SMS" },
  { value: "print", label: "Print" },
  { value: "other", label: "Other" },
];

export function channelLabel(c: string | null | undefined): string {
  if (!c) return "Channel unknown";
  const known = CHANNEL_OPTIONS.find((o) => o.value === c);
  if (known) return known.label;
  const words = c.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Channel unknown";
}

/** Normalises free-text channel values into a known option when possible. */
export function normaliseChannel(c: string | null | undefined): string | null {
  if (!c) return null;
  const v = c.toLowerCase().replace(/[\s-]+/g, "_");
  if (CHANNEL_OPTIONS.some((o) => o.value === v)) return v;
  if (/social|facebook|instagram|meta|tiktok|linkedin/.test(v)) return "paid_social";
  if (/mail/.test(v)) return "email";
  if (/landing|web|page/.test(v)) return "landing_page";
  if (/banner|display/.test(v)) return "display";
  if (/affiliate|partner|blog|post/.test(v)) return "affiliate";
  if (/sms|text/.test(v)) return "sms";
  if (/search|ppc|google_ads/.test(v)) return "search";
  return v;
}

// ---------------------------------------------------------------------------
// Ranking and tags
// ---------------------------------------------------------------------------

export type AdRankInput = {
  hiddenText: boolean;
  openCritical: number;
  openMajor: number;
  openMinor: number;
  submittedAt: string;
};

/**
 * Worst-first sort key (smaller is worse): hidden text > critical > major >
 * minor > age (older is worse). The Ads list sorts by it, and the next ad
 * offered after a decision is the Needs-review ad with the smallest value.
 */
export function rankAd(ad: AdRankInput, now = Date.now()): number {
  const ageMs = Math.max(0, now - new Date(ad.submittedAt).getTime());
  return (
    (ad.hiddenText ? 0 : 1) * 1e15 +
    (ad.openCritical ? 0 : 1) * 1e14 +
    (ad.openMajor ? 0 : 1) * 1e13 +
    (ad.openMinor ? 0 : 1) * 1e12 +
    Math.max(0, 1e12 - ageMs)
  );
}

/**
 * "Not AI-screened": the ad waits for a person because its latest check did
 * not complete (it failed, or the AI budget ran out).
 */
export function isNotScreened(status: string, latestRunStatus: string | null | undefined): boolean {
  return status === "needs_manual_review" && latestRunStatus !== "complete";
}

/** Why an approved ad is back in Needs review: the product terms changed, or its end date passed. */
export function reReviewTag(reason: unknown): "Rates changed" | "Expired" {
  const kind = reason && typeof reason === "object" && !Array.isArray(reason) ? (reason as Record<string, unknown>).kind : null;
  return kind === "expired" ? "Expired" : "Rates changed";
}

export type AdTagInput = {
  status: string;
  versionNo: number;
  /** Any decision recorded on the ad, on any version. */
  hasDecisions: boolean;
  /** Unacknowledged hidden-text alerts on the latest version. */
  hiddenText: boolean;
  changedAfterApproval: boolean;
  notScreened: boolean;
  isSample: boolean;
  /** assets.re_review_reason */
  reReviewReason: unknown;
};

/** The short reason tags shown next to an ad's status (list row and ad page), in display order. */
export function adTags(input: AdTagInput): string[] {
  const tags: string[] = [];
  if (input.isSample) tags.push("Sample");
  if (input.hiddenText) tags.push("Hidden text");
  if (input.status === "re_review_due") tags.push(reReviewTag(input.reReviewReason));
  if (input.status === "approved_with_exceptions") tags.push("With exceptions");
  if (input.changedAfterApproval) tags.push("Changed after approval");
  if (input.notScreened) tags.push("Not AI-screened");
  if (NEEDS_REVIEW_STATUSES.has(input.status) || input.status === "changes_requested") {
    if (input.versionNo > 1) tags.push(`V${input.versionNo}`);
    else if (!input.hasDecisions) tags.push("New");
  }
  return tags;
}
