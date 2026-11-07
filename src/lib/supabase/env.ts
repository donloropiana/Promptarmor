import type { SupabaseEnv } from "@supabase/server";

/**
 * Supabase environment resolution.
 *
 * Doppler/Vercel provide SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
 * SUPABASE_SECRET_KEY and SUPABASE_JWKS_URL. next.config.ts maps the two
 * public values to NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 * so they are inlined into browser bundles.
 *
 * Nothing here throws: callers decide what "not configured" means (the proxy
 * skips session refresh, the DAL treats the visitor as signed out, actions
 * return an error). Builds must succeed with no env at all.
 *
 * `process.env.NEXT_PUBLIC_*` must be read with static property access so the
 * bundler can inline it; do not destructure process.env.
 */

export type PublicSupabaseEnv = {
  url: string;
  publishableKey: string;
};

function clean(value: string | undefined | null): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

/** URL + publishable key. Safe on server and in the browser. */
export function getPublicSupabaseEnv(): PublicSupabaseEnv | null {
  const url =
    clean(process.env.NEXT_PUBLIC_SUPABASE_URL) ??
    // Server-side fallback (not inlined in browser bundles, so undefined there).
    clean(process.env.SUPABASE_URL);
  const publishableKey =
    clean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ??
    clean(process.env.SUPABASE_PUBLISHABLE_KEY);
  if (!url || !publishableKey) return null;
  return { url: url.replace(/\/+$/, ""), publishableKey };
}

export function isSupabaseConfigured(): boolean {
  return getPublicSupabaseEnv() !== null;
}

/**
 * JWKS endpoint used to verify user JWTs. Defaults to the project's
 * well-known endpoint. Only https (or loopback http) is accepted, matching
 * @supabase/server's transport rule.
 */
function resolveJwksUrl(projectUrl: string): URL | null {
  const raw =
    clean(process.env.SUPABASE_JWKS_URL) ??
    `${projectUrl}/auth/v1/.well-known/jwks.json`;
  try {
    const u = new URL(raw);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    if (u.protocol === "https:" || (u.protocol === "http:" && loopback)) {
      return u;
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Env overrides for @supabase/server primitives (verifyCredentials,
 * createContextClient, createAdminClient). Server-only in practice: the
 * secret key is never inlined into client bundles (no NEXT_PUBLIC_ prefix,
 * not listed in next.config.ts `env`), so in the browser it is undefined.
 */
export function getSupabaseServerEnv(): Partial<SupabaseEnv> | null {
  const pub = getPublicSupabaseEnv();
  if (!pub) return null;
  const secretKey = clean(process.env.SUPABASE_SECRET_KEY);
  return {
    url: pub.url,
    publishableKeys: { default: pub.publishableKey },
    secretKeys: secretKey ? { default: secretKey } : {},
    jwks: resolveJwksUrl(pub.url),
  };
}

export function hasSupabaseSecretKey(): boolean {
  return Boolean(clean(process.env.SUPABASE_SECRET_KEY));
}

/**
 * Fallback public origin of the app, used only when it cannot be derived
 * from the incoming request. NEXT_PUBLIC_SITE_URL is optional.
 */
export function getFallbackSiteUrl(): string {
  const explicit = clean(process.env.NEXT_PUBLIC_SITE_URL);
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production") {
    return "https://promptarmor-two.vercel.app";
  }
  return "http://localhost:3000";
}

let warnedMissing = false;
/** Logs the missing-env warning once per process. */
export function warnSupabaseNotConfigured(where: string): void {
  if (warnedMissing) return;
  warnedMissing = true;
  console.warn(
    `[supabase] ${where}: SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY are not set; auth is disabled for this process.`,
  );
}
