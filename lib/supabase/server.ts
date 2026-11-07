import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getPublicSupabaseEnv } from "./env";
import type { Database } from "./types";

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super("Supabase is not configured (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY missing).");
    this.name = "SupabaseNotConfiguredError";
  }
}

/**
 * Cookie-based Supabase client for Server Components, Server Actions and
 * Route Handlers (@supabase/ssr). Use it for auth operations that read or
 * write the session cookie: signIn*, verifyOtp, exchangeCodeForSession,
 * signOut, updateUser.
 *
 * For RLS-scoped data access prefer lib/supabase/context.ts
 * (getSupabaseContext), which verifies the JWT against JWKS first.
 *
 * Reads cookies(), so with Cache Components any Server Component that calls
 * it must render inside <Suspense>. Cookie writes from a Server Component
 * are ignored (the proxy refreshes the session instead).
 *
 * @throws SupabaseNotConfiguredError when env is missing.
 */
export async function createClient(): Promise<SupabaseClient<Database>> {
  const env = getPublicSupabaseEnv();
  if (!env) throw new SupabaseNotConfiguredError();

  const cookieStore = await cookies();

  return createServerClient<Database>(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component: cookies are read-only there.
          // proxy.ts refreshes the session cookie on the next request.
        }
      },
    },
  });
}
