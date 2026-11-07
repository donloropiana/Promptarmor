import "server-only";

import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { z } from "zod";

import { signInPath } from "@/features/auth/redirect";
import { getSupabaseContext, type AppSupabaseContext } from "@/lib/supabase/context";
import type { ProfileRole } from "@/lib/supabase/types";

/**
 * Data Access Layer. Every page, Server Action and Route Handler authorizes
 * through these helpers (never through src/proxy.ts alone).
 *
 * All helpers read cookies(), so with Cache Components a Server Component
 * calling them must render inside <Suspense>.
 */

export const ACTIVE_PROFILE_COOKIE = "pa_active_profile";

// Lenient 8-4-4-4-12 hex check (z.uuid() rejects non-RFC seed ids).
const uuid = z.guid();

export type CurrentUser = {
  id: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
};

export type Membership = {
  user: CurrentUser;
  profileId: string;
  role: ProfileRole;
  /** RLS-scoped client bound to the verified user token. */
  supabase: AppSupabaseContext["supabase"];
};

export type ProfileSummary = {
  id: string;
  name: string;
  role: ProfileRole;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/**
 * The signed-in user from a JWKS-verified access token, or null.
 * Memoized per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const ctx = await getSupabaseContext();
  const claims = ctx?.userClaims;
  if (!ctx || !claims?.id) return null;
  const meta = claims.userMetadata ?? {};
  return {
    id: claims.id,
    email: str(claims.email)?.toLowerCase() ?? null,
    fullName: str(meta.full_name) ?? str(meta.name),
    avatarUrl: str(meta.avatar_url) ?? str(meta.picture),
  };
});

/**
 * The path of the current request (set by src/proxy.ts), so a signed-out visitor
 * comes back to the page they asked for after signing in. Null outside a
 * request or when the proxy did not run.
 */
async function requestPath(): Promise<string | null> {
  try {
    const h = await headers();
    return h.get("x-app-path");
  } catch {
    return null;
  }
}

/**
 * The signed-in user, or a redirect to /signin?next=<next>.
 * `next` defaults to the current request path (see requestPath), so the
 * layout gate and pages send people back where they were headed.
 */
export async function requireUser(next?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(signInPath(next ?? (await requestPath()) ?? undefined));
  return user;
}

/** Role of the current user in a profile, or null (not a member / bad id). */
export async function getMembershipRole(profileId: string): Promise<ProfileRole | null> {
  if (!uuid.safeParse(profileId).success) return null;
  const ctx = await getSupabaseContext();
  if (!ctx?.userClaims?.id) return null;
  const { data, error } = await ctx.supabase
    .from("profile_members")
    .select("role")
    .eq("profile_id", profileId)
    .eq("user_id", ctx.userClaims.id)
    .maybeSingle();
  if (error) {
    console.error("[dal] membership lookup failed:", error.code, error.message);
    return null;
  }
  const role = (data as { role?: string } | null)?.role;
  return role === "owner" || role === "member" ? role : null;
}

/**
 * Requires a signed-in member of `profileId`. Signed-out -> /signin;
 * not a member (or unknown id) -> notFound() so profile ids do not leak.
 */
export async function requireMember(profileId: string, next?: string): Promise<Membership> {
  const user = await requireUser(next);
  const role = await getMembershipRole(profileId);
  const ctx = await getSupabaseContext();
  if (!role || !ctx) notFound();
  return { user, profileId, role, supabase: ctx.supabase };
}

/** Requires an owner of `profileId` (members get notFound()). */
export async function requireOwner(profileId: string, next?: string): Promise<Membership> {
  const m = await requireMember(profileId, next);
  if (m.role !== "owner") notFound();
  return m;
}

/** Profiles the current user belongs to, oldest membership first. */
export const getMyProfiles = cache(async (): Promise<ProfileSummary[]> => {
  const ctx = await getSupabaseContext();
  if (!ctx?.userClaims?.id) return [];
  const { data, error } = await ctx.supabase
    .from("profile_members")
    .select("role, created_at, profiles(id, name)")
    .eq("user_id", ctx.userClaims.id)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[dal] profile list failed:", error.code, error.message);
    return [];
  }
  type Row = {
    role: string;
    profiles: { id: string; name: string } | { id: string; name: string }[] | null;
  };
  const out: ProfileSummary[] = [];
  for (const row of (data ?? []) as Row[]) {
    const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    if (!p) continue;
    out.push({ id: p.id, name: p.name, role: row.role === "owner" ? "owner" : "member" });
  }
  return out;
});

/**
 * Active profile id: the `pa_active_profile` cookie when it names a profile
 * the user still belongs to, otherwise the first membership, otherwise null.
 * (Server Components cannot write cookies; setActiveProfile does that.)
 */
export const getActiveProfileId = cache(async (): Promise<string | null> => {
  const profiles = await getMyProfiles();
  if (profiles.length === 0) return null;
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(ACTIVE_PROFILE_COOKIE)?.value;
  if (fromCookie && profiles.some((p) => p.id === fromCookie)) return fromCookie;
  return profiles[0].id;
});

/** Active profile with name and role, or null. */
export async function getActiveProfile(): Promise<ProfileSummary | null> {
  const id = await getActiveProfileId();
  if (!id) return null;
  const profiles = await getMyProfiles();
  return profiles.find((p) => p.id === id) ?? null;
}
