import { APP_TIME_ZONE } from "@/lib/time-zone";

import { isLive, liveChannelLabel, type Lifecycle } from "./domain";

/**
 * Presentation helpers (relative times, dates, money, durations, plain-English
 * labels) shared by the Ads list, the Ad page and src/features/ads/server/queries.ts.
 * No "use client", no server-only imports: safe on both sides. Domain rules
 * (tabs, statuses, lifecycle, channels, ranking) live in ./domain.
 */

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
    timeZone: opts.timeZone ?? APP_TIME_ZONE,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = get("year");
  const thisYear = String(new Date().getFullYear());
  const date = `${get("month")} ${get("day")}${year && year !== thisYear ? `, ${year}` : ""}`;
  return `${date}, ${get("hour")}:${get("minute")} ${get("dayPeriod")}`.replace(/\s+/g, " ").trim();
}

/** "Nov 10" (with the year when it is not the current one), pinned to APP_TIME_ZONE like formatDateTime. */
export function formatDate(iso: string | null | undefined, opts: { timeZone?: string } = {}): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: opts.timeZone ?? APP_TIME_ZONE }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = get("year");
  const thisYear = String(new Date().getFullYear());
  return `${get("month")} ${get("day")}${year && year !== thisYear ? `, ${year}` : ""}`;
}

/**
 * One line for the row and the ad page: "Live on Meta since Nov 10 · ends Jan 31",
 * "Was live on Meta Nov 10 – Jan 31" once it ended, "Archived Nov 7" when archived.
 */
export function lifecycleLine(l: Lifecycle & { liveChannel: string | null }, now = Date.now()): string | null {
  if (l.archivedAt) return `Archived ${formatDate(l.archivedAt)}`;
  if (!l.liveAt) return null;
  const where = liveChannelLabel(l.liveChannel);
  const on = where ? ` on ${where}` : "";
  if (isLive(l, now)) return `Live${on} since ${formatDate(l.liveAt)}${l.expiresAt ? ` · ends ${formatDate(l.expiresAt)}` : ""}`;
  const ended = l.expiresAt ? new Date(l.expiresAt).getTime() <= now : false;
  // The end date passed: it ran its course. Otherwise nothing was taken down;
  // the approval went away (withdrawn, or back for review) while it may still run.
  if (ended) return `Was live${on} ${formatDate(l.liveAt)} – ${formatDate(l.expiresAt!)}`;
  const why = l.status === "withdrawn" ? "approval withdrawn" : l.status === "re_review_due" ? "back for review" : "no longer approved";
  return `Marked live${on} ${formatDate(l.liveAt)}${l.expiresAt ? ` · ends ${formatDate(l.expiresAt)}` : ""} · ${why}`;
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
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
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
