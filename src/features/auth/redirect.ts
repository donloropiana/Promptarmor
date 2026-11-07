/**
 * Open-redirect-safe handling of "next" parameters. Pure: usable on the
 * server and in the browser.
 *
 * Accepts a same-app relative path ("/invite/abc?x=1"). An absolute http(s)
 * URL is reduced to its path, query and hash, so the redirect always stays on
 * the current origin (Supabase email templates pass {{ .RedirectTo }}, which
 * is absolute). Anything else, including protocol-relative "//evil.com",
 * backslash tricks, control characters and paths under /auth/ (callback,
 * confirm, signout), falls back.
 */
export function safeNextPath(raw: unknown, fallback = "/"): string {
  if (typeof raw !== "string") return fallback;
  let candidate = raw.trim();
  if (!candidate || candidate.length > 2048) return fallback;

  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    try {
      const u = new URL(candidate);
      if (u.protocol !== "http:" && u.protocol !== "https:") return fallback;
      candidate = `${u.pathname}${u.search}${u.hash}`;
    } catch {
      return fallback;
    }
  }

  if (!candidate.startsWith("/")) return fallback;
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return fallback;
  // Control characters and backslashes have no business in our paths.
  if (/[\u0000-\u001f\u007f\\]/.test(candidate)) return fallback;

  const base = "http://next.invalid";
  try {
    const u = new URL(candidate, base);
    if (u.origin !== base) return fallback;
    // Re-check AFTER normalization: URL parsing collapses dot segments, so
    // "/.//evil.com", "/a/..//evil.com" or "/%2e//evil.com" become "//evil.com",
    // which a redirect would treat as protocol-relative.
    if (u.pathname.startsWith("//") || u.pathname.startsWith("/\\")) return fallback;
    const path = `${u.pathname}${u.search}${u.hash}`;
    if (path.startsWith("//") || path.startsWith("/\\")) return fallback;
    if (u.pathname === "/auth" || u.pathname.startsWith("/auth/")) return fallback;
    return path;
  } catch {
    return fallback;
  }
}

/** Builds "/signin?next=..." (optionally with an error code). */
export function signInPath(next?: string, error?: string): string {
  const params = new URLSearchParams();
  const safe = safeNextPath(next, "");
  if (safe && safe !== "/") params.set("next", safe);
  if (error) params.set("error", error);
  const qs = params.toString();
  return qs ? `/signin?${qs}` : "/signin";
}
