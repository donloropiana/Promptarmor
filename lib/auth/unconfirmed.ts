import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

/**
 * Pre-account hijack protection.
 *
 * Anyone can sign up as victim@corp with a password they choose and never
 * confirm it. If the mailbox owner later confirms that same auth user (by
 * accepting an invite or signing in with an email code), the earlier
 * registrant's password starts working on a confirmed account, which is
 * enough to accept invitations addressed to victim@corp.
 *
 * With "Confirm email" ON, an unconfirmed user has never had a session, so it
 * owns no memberships, profiles or data and is safe to delete. The next
 * invite / OTP request then creates a fresh, passwordless user.
 */

type Admin = SupabaseClient<Database>;

/**
 * Deletes the unconfirmed auth user for `email` if it has a password (only a
 * password sign-up can carry someone else's credential). Used before an
 * email-code sign-in. Returns true when a user was deleted. Never throws.
 */
export async function deleteUnconfirmedPasswordUser(email: string, admin?: Admin | null): Promise<boolean> {
  const client = admin ?? createSupabaseAdminClient();
  if (!client) return false;
  try {
    const { data, error } = await client.rpc("find_unconfirmed_password_user", { p_email: email });
    if (error) {
      console.warn("[auth] unconfirmed-user lookup failed:", error.code);
      return false;
    }
    const id = typeof data === "string" && data ? data : null;
    if (!id) return false;
    const { error: delError } = await client.auth.admin.deleteUser(id);
    if (delError) {
      console.warn("[auth] could not delete unconfirmed user:", delError.code ?? delError.status);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[auth] unconfirmed-user cleanup failed:", (err as Error).message);
    return false;
  }
}
