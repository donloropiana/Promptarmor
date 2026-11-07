import "server-only";

import { createAdminClient } from "@supabase/server/core";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseServerEnv, hasSupabaseSecretKey } from "./env";
import type { Database } from "./types";

/**
 * Secret-key (sb_secret_) client that BYPASSES RLS. Server-only.
 *
 * Use only for things a user-scoped client cannot do: auth.admin.* calls
 * (inviteUserByEmail, getUserById), Nango webhook ingestion, operator jobs.
 * Never pass it user-controlled table names or filters without first
 * authorizing the caller through the user-scoped client.
 *
 * Returns null when SUPABASE_URL / keys / SUPABASE_SECRET_KEY are missing.
 */
export function createSupabaseAdminClient(): SupabaseClient<Database> | null {
  const env = getSupabaseServerEnv();
  if (!env || !hasSupabaseSecretKey()) return null;
  try {
    return createAdminClient<Database>({ env });
  } catch (err) {
    console.error("[supabase] createAdminClient failed:", (err as Error).message);
    return null;
  }
}

/** Like createSupabaseAdminClient, but throws when not configured. */
export function requireSupabaseAdminClient(): SupabaseClient<Database> {
  const client = createSupabaseAdminClient();
  if (!client) {
    throw new Error("Supabase admin client is not configured (SUPABASE_SECRET_KEY missing).");
  }
  return client;
}
