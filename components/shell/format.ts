/**
 * Small, dependency-free formatters shared by the shell, Rules and Settings.
 * Safe on the server and in the browser: every date is printed in
 * APP_TIME_ZONE so both sides produce the same text.
 */
import { APP_TIME_ZONE } from "@/lib/time-zone";

/** "just now", "4 min ago", "2 h ago", "3 d ago", else a short date. */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} d ago`;
  return shortDate(iso);
}


/**
 * Formats from Intl parts with a fixed en-US pattern so Bun/Node on the server
 * and every browser print identical text ("Nov 6, 2026, 8:24 PM"); some ICU
 * builds otherwise insert "at" and cause hydration mismatches.
 */
function fmtParts(d: Date, o: Intl.DateTimeFormatOptions): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, ...o }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const date = `${get("month")} ${get("day")}${get("year") ? `, ${get("year")}` : ""}`;
  if (!o.hour) return date;
  return `${date}, ${get("hour")}:${get("minute")} ${get("dayPeriod")}`.replace(/\s+/g, " ").trim();
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "Nov 6, 2026". A date-only value ("2026-11-07", a Postgres `date`) is a
 * calendar day and is printed as-is, never shifted by a time zone. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = DATE_ONLY.exec(iso);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return fmtParts(d, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return fmtParts(new Date(t), { month: "short", day: "numeric", year: "numeric" });
}

/** "Nov 6, 2026, 3:04 PM". */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return fmtParts(new Date(t), {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** "$3.00"; null -> "—". */
export function usd(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(digits)}`;
}

/** Initials for an avatar fallback ("Hannah Ortiz" -> "HO", "a@b.c" -> "A"). */
export function initials(name: string | null | undefined, email?: string | null): string {
  const n = name?.trim();
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
    return (first + last).toUpperCase() || "?";
  }
  return (email?.trim()[0] ?? "?").toUpperCase();
}

/** Plural helper: count("ad", 2) -> "2 ads". */
export function count(noun: string, n: number, plural = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : plural}`;
}
