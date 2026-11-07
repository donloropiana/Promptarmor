import "server-only";

import { getCurrentUser, getMembershipRole, type CurrentUser } from "@/lib/auth/dal";
import type { ProfileRole } from "@/lib/supabase/types";

/**
 * JSON-flavoured authorization for the connection Route Handlers.
 *
 * Same checks as requireMember() in lib/auth/dal.ts (JWKS-verified user, then
 * membership read under RLS), but answering fetch() callers with JSON 401/404
 * instead of a redirect to /signin or a notFound() page.
 */

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Cookie-authenticated mutations must come from our own pages. Fails closed:
 * an Origin header must name this host; without Origin, only the Fetch
 * Metadata header `Sec-Fetch-Site: same-origin` (or `none`, a user-typed
 * navigation) is accepted. Anything else is rejected. (JSON bodies also
 * force a CORS preflight, which we never answer.)
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === "null") return false; // sandboxed / opaque origins
  if (!origin) {
    const site = request.headers.get("sec-fetch-site");
    return site === "same-origin" || site === "none";
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const hosts = [request.headers.get("x-forwarded-host"), request.headers.get("host")]
    .flatMap((h) => (h ? h.split(",") : []))
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return hosts.includes(originHost);
}

export type MemberAuth =
  | { ok: true; user: CurrentUser; role: ProfileRole }
  | { ok: false; response: Response };

export async function authorizeMember(profileId: string): Promise<MemberAuth> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, response: json({ error: "Sign in to continue." }, 401) };
  const role = await getMembershipRole(profileId);
  if (!role) return { ok: false, response: json({ error: "Profile not found." }, 404) };
  return { ok: true, user, role };
}
