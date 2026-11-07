import "server-only";

import { fromSupabaseUrl } from "@supabase/server";
import type { AuthError, AuthModeWithKey, SupabaseContext } from "@supabase/server";
import {
  createAdminClient,
  createContextClient,
  verifyCredentials,
} from "@supabase/server/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";

import { getSupabaseServerEnv, warnSupabaseNotConfigured } from "./env";
import { createClient as createSsrClient } from "./server";
import type { Database } from "./types";

/**
 * @supabase/server + @supabase/ssr composition (see
 * node_modules/@supabase/server/docs/ssr-frameworks.md):
 *
 *   proxy.ts (ssr)         refreshes the session cookie on every request
 *   createSsrClient()      reads the (fresh) access token from the cookie
 *   verifyCredentials()    verifies that JWT against the project JWKS
 *                          (SUPABASE_JWKS_URL, ES256) and pins the issuer
 *   createContextClient()  RLS-scoped client bound to the verified token
 *   createAdminClient()    secret-key client (created lazily on first use)
 *
 * Reads cookies(): Server Components using it must render inside <Suspense>.
 */

export type AppSupabaseContext = SupabaseContext<Database>;

export type SupabaseContextResult =
  | { data: AppSupabaseContext; error: null }
  | { data: null; error: AuthError | Error };

export async function createSupabaseContext(
  options: { auth?: AuthModeWithKey | AuthModeWithKey[] } = { auth: "user" },
): Promise<SupabaseContextResult> {
  const env = getSupabaseServerEnv();
  if (!env?.url) {
    warnSupabaseNotConfigured("createSupabaseContext");
    return { data: null, error: new Error("Supabase is not configured") };
  }

  let token: string | null = null;
  try {
    const ssr = await createSsrClient();
    const {
      data: { session },
    } = await ssr.auth.getSession();
    token = session?.access_token ?? null;
  } catch (err) {
    return { data: null, error: err as Error };
  }

  const { data: auth, error } = await verifyCredentials(
    { token, apikey: null },
    {
      auth: options.auth ?? "user",
      env,
      issuer: fromSupabaseUrl(env.url),
    },
  );
  if (error) return { data: null, error };

  let supabase: SupabaseClient<Database>;
  try {
    supabase = createContextClient<Database>({
      auth: { token: auth.token, keyName: auth.keyName },
      env,
    });
  } catch (err) {
    return { data: null, error: err as Error };
  }

  let admin: SupabaseClient<Database> | null = null;
  const ctx: AppSupabaseContext = {
    supabase,
    // Lazy: requires SUPABASE_SECRET_KEY, which user-only flows do not need.
    get supabaseAdmin() {
      admin ??= createAdminClient<Database>({ env });
      return admin;
    },
    userClaims: auth.userClaims,
    jwtClaims: auth.jwtClaims,
    authMode: auth.authMode,
  };
  return { data: ctx, error: null };
}

/**
 * Per-request memoized user context (auth: 'user'). Returns null when the
 * visitor is signed out, the token is invalid/expired, or env is missing.
 */
export const getSupabaseContext = cache(
  async (): Promise<AppSupabaseContext | null> => {
    const { data, error } = await createSupabaseContext({ auth: "user" });
    if (error) {
      const status = (error as AuthError).status;
      // 401s are ordinary "signed out" cases; anything else is a server problem.
      if (status !== undefined && status !== 401) {
        console.error("[supabase] context error:", error.message);
      }
      return null;
    }
    return data;
  },
);
