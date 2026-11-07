import "server-only";

import type { AppSupabaseContext } from "@/lib/supabase/context";

/**
 * Who wrote it: the one rule for showing a user (full name, else email) and
 * the batched users lookup that feeds it. Shared by every read model that
 * shows an author (rule versions, offer versions).
 */

type UserName = { id: string; full_name: string | null; email: string };

/** Display name for a user id, falling back to the email. */
export function displayName(u: { full_name?: string | null; email?: string | null } | null | undefined): string | null {
  if (!u) return null;
  const n = u.full_name?.trim();
  return n || u.email || null;
}

/** users rows for the given ids (nulls and repeats skipped), keyed by id. */
export async function userNames(supabase: AppSupabaseContext["supabase"], ids: (string | null)[]): Promise<Map<string, UserName>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const out = new Map<string, UserName>();
  if (unique.length === 0) return out;
  const { data } = await supabase.from("users").select("id, full_name, email").in("id", unique);
  for (const u of (data ?? []) as UserName[]) out.set(u.id, u);
  return out;
}
