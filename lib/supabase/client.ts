import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getPublicSupabaseEnv } from "./env";
import type { Database } from "./types";

/**
 * Browser Supabase client (Client Components only). Session lives in cookies
 * shared with the server; createBrowserClient returns a singleton.
 *
 * Uses only the public URL and publishable key (inlined at build time via
 * next.config.ts `env`). Returns null when they were not available at build
 * time, so callers can render a disabled state instead of crashing.
 */
export function createClient(): SupabaseClient<Database> | null {
  const env = getPublicSupabaseEnv();
  if (!env) return null;
  return createBrowserClient<Database>(env.url, env.publishableKey);
}
