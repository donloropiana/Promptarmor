/**
 * Small, dependency-free formatters shared by the shell, Rules and Settings.
 * Safe on the server and in the browser.
 */

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

/** "Nov 6, 2026" in the viewer's locale. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** "Nov 6, 2026, 3:04 PM". */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
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
