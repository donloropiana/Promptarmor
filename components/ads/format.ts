/**
 * Pure helpers shared by the Ads list, the Ad page and lib/data/ads.ts.
 * No "use client", no server-only imports: safe on both sides.
 */

import type { Product, Severity } from "@/lib/types/ads";

export type Tab = "needs_review" | "changes_requested" | "approved" | "all";

export const TABS: { key: Tab; label: string }[] = [
  { key: "needs_review", label: "Needs review" },
  { key: "changes_requested", label: "Changes requested" },
  { key: "approved", label: "Approved" },
  { key: "all", label: "All" },
];

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

export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, major: 1, minor: 2 };

export function severityLabel(s: string): "Critical" | "Major" | "Minor" {
  if (s === "critical") return "Critical";
  if (s === "major") return "Major";
  return "Minor";
}

export function asSeverity(s: string | null | undefined): Severity {
  return s === "critical" || s === "major" || s === "minor" ? s : "minor";
}

export const PRODUCT_LABELS: Record<Product, string> = {
  personal_loan: "Personal loan",
  credit_card: "Credit card",
  mortgage: "Mortgage",
  other: "Other",
  unknown: "Unknown product",
};

export const PRODUCT_OPTIONS: Product[] = ["personal_loan", "credit_card", "mortgage", "other"];

export function productLabel(p: string | null | undefined): string {
  return PRODUCT_LABELS[(p ?? "unknown") as Product] ?? "Unknown product";
}

export function asProduct(p: string | null | undefined): Product {
  return p && p in PRODUCT_LABELS ? (p as Product) : "unknown";
}

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

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, now - t);
  const s = Math.round(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} d ago`;
  const w = Math.round(d / 7);
  if (w < 9) return `${w} w ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo} mo ago`;
  return `${Math.round(d / 365)} y ago`;
}

/**
 * "Nov 6, 8:07 PM" (with the year when it is not the current one). Built from
 * Intl parts so every runtime (Bun on the server, each browser) prints the
 * same text for the same zone; pass `timeZone` to pin the zone (the server
 * renders UTC, see useLocalDateTime).
 */
export function formatDateTime(iso: string | null | undefined, opts: { timeZone?: string } = {}): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: opts.timeZone,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = get("year");
  const thisYear = String(new Date().getFullYear());
  const date = `${get("month")} ${get("day")}${year && year !== thisYear ? `, ${year}` : ""}`;
  return `${date}, ${get("hour")}:${get("minute")} ${get("dayPeriod")}`.replace(/\s+/g, " ").trim();
}

export function formatUsd(n: number | null | undefined, opts: { precise?: boolean } = {}): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n === 0) return "$0.00";
  if (opts.precise || (n > 0 && n < 0.01)) return `$${n.toFixed(n < 0.001 ? 4 : 3)}`;
  return `$${n.toFixed(2)}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return s ? `${m} min ${s} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 6) : "";
}

export function pluralise(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Display name for a user row: name, else email, else a neutral fallback. */
export function personLabel(
  u: { full_name?: string | null; email?: string | null } | null | undefined,
  fallback = "Someone",
): string {
  if (!u) return fallback;
  return u.full_name?.trim() || u.email || fallback;
}

/** Plain-English stage for a running check. */
export function stageLabel(stage: string | null | undefined, status: string | null | undefined): string {
  if (status === "queued") return "Waiting to start";
  const s = (stage ?? "").toLowerCase();
  if (!s) return "Checking…";
  if (s.includes("extract")) return "Reading the ad";
  if (s.includes("transcrib") || s.includes("ocr")) return "Reading the image";
  if (s.includes("budget")) return "Reserving AI budget";
  if (s.includes("hidden") || s.includes("security") || s.includes("scan")) return "Scanning for hidden text";
  if (s === "rules") return "Loading the rules";
  if (s.includes("persist") || s === "done") return "Saving results";
  if (s.includes("offer") || s.includes("rate") || s.includes("term")) return "Comparing against product terms";
  if (s.includes("llm") || s.includes("rule") || s.includes("analy") || s.includes("check")) return "Checking against the rules";
  if (s.includes("verif") || s.includes("anchor") || s.includes("quote")) return "Verifying quoted words";
  if (s.includes("recheck") || s.includes("compare") || s.includes("prior")) return "Comparing with the previous version";
  if (s.includes("save") || s.includes("final") || s.includes("complete")) return "Saving results";
  return s.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Count open issues on an ad by effective severity. */
export function issueSummary(c: number, m: number, mi: number): string {
  const parts: string[] = [];
  if (c) parts.push(`${c} critical`);
  if (m) parts.push(`${m} major`);
  if (mi) parts.push(`${mi} minor`);
  return parts.length ? parts.join(" · ") : "No open issues";
}

export function providerName(provider: string | null | undefined): string {
  switch (provider) {
    case "google-mail":
      return "Gmail";
    case "google-drive":
      return "Google Drive";
    case "google-sheet":
      return "Google Sheets";
    case "outlook":
      return "Outlook";
    case "one-drive":
    case "one-drive-personal":
      return "OneDrive";
    case "upload":
      return "upload";
    case "paste":
      return "pasted text";
    default:
      return provider ?? "a connected account";
  }
}
