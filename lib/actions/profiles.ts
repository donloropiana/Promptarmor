"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { refresh } from "next/cache";
import { after } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ACTIVE_PROFILE_COOKIE, getMembershipRole } from "@/lib/auth/dal";
import { getRequestOrigin } from "@/lib/auth/origin";
import { deleteUnconfirmedPasswordUser } from "@/lib/auth/unconfirmed";
import { revokeMemberNangoConnections } from "@/lib/nango/connections";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseContext, type AppSupabaseContext } from "@/lib/supabase/context";
import type { Json } from "@/lib/supabase/types";

/**
 * Profile (workspace) and membership Server Actions.
 *
 * Every action re-authenticates (JWKS-verified user token) and calls the
 * tenancy RPCs with the user-scoped client, so the database enforces
 * owner/member rules (see supabase/migrations/20261106170000_tenancy_auth.sql).
 * The secret-key admin client is used only for auth.admin user lookups,
 * deleting unconfirmed users before an invite, and inviteUserByEmail.
 *
 * Inputs: FormData or a plain object with the same field names. To use with
 * useActionState, wrap: useActionState((_s, fd: FormData) => inviteMember(fd), null).
 */

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; hint?: string };

type Input = FormData | Record<string, unknown>;

const ONE_YEAR = 60 * 60 * 24 * 365;
const INVITE_TOKEN_RE = /^[0-9a-f]{64}$/i;

const id = z.guid({ error: "Invalid id." });
const emailSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z.email({ error: "Enter a valid email address." }).max(320),
);
const roleSchema = z.enum(["owner", "member"]).default("member");

const createProfileSchema = z.object({
  name: z
    .string({ error: "Enter a workspace name." })
    .trim()
    .min(1, { error: "Enter a workspace name." })
    .max(80, { error: "Use at most 80 characters." }),
});
const inviteSchema = z.object({ profileId: id, email: emailSchema, role: roleSchema });
const invitationIdSchema = z.object({ invitationId: id });
const removeMemberSchema = z.object({ profileId: id, userId: id });
const setRoleSchema = z.object({ profileId: id, userId: id, role: z.enum(["owner", "member"]) });
const profileIdSchema = z.object({ profileId: id });
const settingsPatchSchema = z.object({
  profileId: id,
  patch: z.preprocess(
    (v) => {
      if (typeof v !== "string") return v;
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    },
    z.record(z.string(), z.unknown(), { error: "Settings must be an object." }),
  ),
});
const tokenSchema = z.object({
  token: z.string().trim().regex(INVITE_TOKEN_RE, { error: "This invitation link is not valid." }),
});

function toObject(input: Input): Record<string, unknown> {
  if (input instanceof FormData) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of input.entries()) {
      if (typeof v === "string" && !(k in out)) out[k] = v;
    }
    return out;
  }
  return input ?? {};
}

function invalid(error: z.ZodError): { ok: false; error: string; code: string } {
  return { ok: false, error: error.issues[0]?.message ?? "Invalid input.", code: "invalid_input" };
}

const SIGNED_OUT = { ok: false as const, error: "Your session has expired. Sign in again.", code: "unauthenticated" };

/** Maps tenancy RPC errors (PTxxx / 42501 / 23505 carry user-facing messages). */
function rpcFailure(error: PostgrestError): { ok: false; error: string; code?: string; hint?: string } {
  // A raw unique-index violation (e.g. two concurrent invites to one address
  // hitting profile_invitations_one_pending_idx) is not a message we raised.
  if (error.code === "23505" && /^duplicate key value/i.test(error.message ?? "")) {
    return { ok: false, error: "That invitation already exists. Refresh and try again.", code: error.code };
  }
  const userFacing = new Set(["PT404", "PT409", "PT422", "PT429", "42501", "23505"]);
  if (error.code && userFacing.has(error.code)) {
    return { ok: false, error: error.message, code: error.code, hint: error.hint ?? undefined };
  }
  console.error("[profiles] rpc failed:", error.code, error.message);
  if (error.code === "PGRST202") {
    return { ok: false, error: "The database is not ready yet. Try again shortly.", code: error.code };
  }
  return { ok: false, error: "Something went wrong. Please try again.", code: error.code };
}

async function requireContext(): Promise<AppSupabaseContext | null> {
  const ctx = await getSupabaseContext();
  return ctx?.userClaims?.id ? ctx : null;
}

async function setActiveProfileCookie(profileId: string): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_PROFILE_COOKIE, profileId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR,
  });
}

/**
 * Sends Supabase Auth's own Invite email (an auth email: the app sends no
 * other mail) when `email` has no confirmed account yet. The email's link
 * goes through /auth/confirm (type=invite) and lands on `redirectTo`.
 * Existing confirmed accounts get nothing; the owner copies the link, and
 * the invitee also sees it in the app via my_pending_invitations().
 *
 * An existing UNCONFIRMED account is deleted first and re-created by the
 * invite: whoever registered it may have chosen its password, and confirming
 * the invite would otherwise turn that password into a confirmed login for
 * the invited address (pre-account hijack). Unconfirmed users cannot have
 * had a session, so they own no data. If the delete fails, no email is sent.
 * Never throws; the caller never learns whether an account exists.
 */
async function sendAuthInviteIfNoAccount(email: string, redirectTo: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  if (!admin) return;
  try {
    const { data: existing, error: lookupError } = await admin
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (lookupError) {
      console.error("[profiles] user lookup failed:", lookupError.code);
      return;
    }
    const existingId = (existing as { id?: string } | null)?.id;
    if (existingId) {
      const { data, error } = await admin.auth.admin.getUserById(existingId);
      if (error || !data.user) return;
      // Confirmed account: no email (the invite shows up in the app).
      if (data.user.email_confirmed_at) return;
      const { error: delError } = await admin.auth.admin.deleteUser(existingId);
      if (delError) {
        console.warn("[profiles] could not delete unconfirmed user before invite:", delError.code ?? delError.status);
        return;
      }
    }
    // Also covers an unconfirmed auth user without a public.users row yet.
    await deleteUnconfirmedPasswordUser(email, admin);
    const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (error) console.warn("[profiles] inviteUserByEmail failed:", error.code ?? error.status);
  } catch (err) {
    console.error("[profiles] invite email failed:", (err as Error).message);
  }
}

// ---------------------------------------------------------------------------

/** Creates a profile; the caller becomes its owner and it becomes active. */
export async function createProfile(input: Input): Promise<ActionResult<{ profileId: string }>> {
  const parsed = createProfileSchema.safeParse(toObject(input));
  if (!parsed.success) return invalid(parsed.error);
  const ctx = await requireContext();
  if (!ctx) return SIGNED_OUT;

  const { data, error } = await ctx.supabase.rpc("create_profile", { p_name: parsed.data.name });
  if (error) return rpcFailure(error);
  const profileId = String(data);

  await setActiveProfileCookie(profileId);
  refresh();
  return { ok: true, data: { profileId } };
}

export type InviteResult = {
  /** Absolute link to /invite/<token>. The token is shown once; only its hash is stored. */
  inviteUrl: string;
  email: string;
  /**
   * Neutral status line for the UI. Deliberately does not say whether an
   * email went out, which would reveal whether the address has an account.
   */
  message: string;
};

const INVITE_MESSAGE =
  "Invitation created. Share the link below; if this address is new to Compliance Workbench it also gets a sign-up email.";

/**
 * Owner only (enforced by invite_member). Re-inviting a pending address
 * rotates its token. Always returns the link so the owner can copy it.
 */
export async function inviteMember(input: Input): Promise<ActionResult<InviteResult>> {
  const parsed = inviteSchema.safeParse(toObject(input));
  if (!parsed.success) return invalid(parsed.error);
  const ctx = await requireContext();
  if (!ctx) return SIGNED_OUT;
  const { profileId, email, role } = parsed.data;

  const { data: token, error } = await ctx.supabase.rpc("invite_member", {
    p_profile_id: profileId,
    p_email: email,
    p_role: role,
  });
  if (error) return rpcFailure(error);
  if (typeof token !== "string" || !INVITE_TOKEN_RE.test(token)) {
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  const inviteUrl = `${await getRequestOrigin()}/invite/${token}`;
  await sendAuthInviteIfNoAccount(email, inviteUrl);
  refresh();
  return { ok: true, data: { inviteUrl, email, message: INVITE_MESSAGE } };
}

/** Owner only. Idempotent for already-revoked invitations. */
export async function revokeInvitation(input: Input): Promise<ActionResult> {
  const parsed = invitationIdSchema.safeParse(toObject(input));
  if (!parsed.success) return invalid(parsed.error);
  const ctx = await requireContext();
  if (!ctx) return SIGNED_OUT;

  const { error } = await ctx.supabase.rpc("revoke_invitation", {
    p_invitation_id: parsed.data.invitationId,
  });
  if (error) return rpcFailure(error);
  refresh();
  return { ok: true, data: null };
}

/** Owner only. New token (old link stops working), expiry restarts at 7 days. */
export async function reissueInvitation(input: Input): Promise<ActionResult<InviteResult>> {
  const parsed = invitationIdSchema.safeParse(toObject(input));
  if (!parsed.success) return invalid(parsed.error);
  const ctx = await requireContext();
  if (!ctx) return SIGNED_OUT;
  const { invitationId } = parsed.data;

  const { data: token, error } = await ctx.supabase.rpc("reissue_invitation", {
    p_invitation_id: invitationId,
  });
  if (error) return rpcFailure(error);
  if (typeof token !== "string" || !INVITE_TOKEN_RE.test(token)) {
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  // Owners can read invitation rows (name the columns: token_hash is not granted).
  const { data: row } = await ctx.supabase
    .from("profile_invitations")
    .select("email")
    .eq("id", invitationId)
    .maybeSingle();
  const email = (row as { email?: string } | null)?.email ?? "";

  const inviteUrl = `${await getRequestOrigin()}/invite/${token}`;
  if (email) await sendAuthInviteIfNoAccount(email, inviteUrl);
  refresh();
  return { ok: true, data: { inviteUrl, email, message: INVITE_MESSAGE } };
}

/**
 * Owner only; the last owner cannot be removed. The removed member's
 * connections are marked disconnected in the same transaction
 * (connection.owner_removed event); their Nango grants are then deleted
 * after the response (revokeMemberNangoConnections).
 */
export async function removeMember(input: Input): Promise<ActionResult> {
  const parsed = removeMemberSchema.safeParse(toObject(input));
  if (!parsed.success) return invalid(parsed.error);
  const ctx = await requireContext();
  if (!ctx) return SIGNED_OUT;

  const { error } = await ctx.supabase.rpc("remove_member", {
    p_profile_id: parsed.data.profileId,
    p_user_id: parsed.data.userId,
  });
  if (error) return rpcFailure(error);
  const { profileId, userId } = parsed.data;
  after(() => revokeMemberNangoConnections(profileId, userId));
  refresh();
  return { ok: true, data: null };
}

/**
 * Leaves a profile (any member; the last owner cannot leave). The leaver's
 * connections are marked disconnected in the same transaction; their Nango
 * grants are deleted after the response. The active-profile cookie is
 * cleared when it pointed at this profile.
 */
export async function leaveProfile(input: Input): Promise<ActionResult> {
  const parsed = profileIdSchema.safeParse(toObject(input));
  if (!parsed.success) return invalid(parsed.error);
  const ctx = await requireContext();
  if (!ctx) return SIGNED_OUT;
  const { profileId } = parsed.data;
  const userId = ctx.userClaims!.id;

  const { error } = await ctx.supabase.rpc("leave_profile", { p_profile_id: profileId });
  if (error) return rpcFailure(error);
  after(() => revokeMemberNangoConnections(profileId, userId));

  const store = await cookies();
  if (store.get(ACTIVE_PROFILE_COOKIE)?.value === profileId) store.delete(ACTIVE_PROFILE_COOKIE);
  refresh();
  return { ok: true, data: null };
}

/** Owner only; the last owner cannot be demoted (trigger). */
export async function setMemberRole(input: Input): Promise<ActionResult> {
  const parsed = setRoleSchema.safeParse(toObject(input));
  if (!parsed.success) return invalid(parsed.error);
  const ctx = await requireContext();
  if (!ctx) return SIGNED_OUT;

  const { error } = await ctx.supabase.rpc("set_member_role", {
    p_profile_id: parsed.data.profileId,
    p_user_id: parsed.data.userId,
    p_role: parsed.data.role,
  });
  if (error) return rpcFailure(error);
  refresh();
  return { ok: true, data: null };
}

/**
 * Owner only. Shallow-merges `patch` (object, or its JSON text) into the
 * profile settings; a top-level null removes that key. AI budget keys are
 * operator-managed and rejected by the database.
 */
export async function updateProfileSettings(input: Input): Promise<ActionResult<{ settings: unknown }>> {
  const parsed = settingsPatchSchema.safeParse(toObject(input));
  if (!parsed.success) return invalid(parsed.error);
  const ctx = await requireContext();
  if (!ctx) return SIGNED_OUT;

  const { data, error } = await ctx.supabase.rpc("update_profile_settings", {
    p_profile_id: parsed.data.profileId,
    p_patch: parsed.data.patch as Json,
  });
  if (error) return rpcFailure(error);
  refresh();
  return { ok: true, data: { settings: data } };
}

/** Switches the active profile (cookie) after confirming membership. */
export async function setActiveProfile(input: Input): Promise<ActionResult<{ profileId: string }>> {
  const parsed = profileIdSchema.safeParse(toObject(input));
  if (!parsed.success) return invalid(parsed.error);
  const ctx = await requireContext();
  if (!ctx) return SIGNED_OUT;

  const role = await getMembershipRole(parsed.data.profileId);
  if (!role) return { ok: false, error: "Workspace not found.", code: "PT404" };

  await setActiveProfileCookie(parsed.data.profileId);
  refresh();
  return { ok: true, data: { profileId: parsed.data.profileId } };
}

/**
 * Accepts an invitation from its link token (explicit click on
 * /invite/<token>). The database requires the signed-in user's VERIFIED
 * email to equal the invitation email. On success the profile becomes
 * active and the user is redirected to the app.
 */
export async function acceptInvitation(input: Input): Promise<ActionResult<{ profileId: string }>> {
  const parsed = tokenSchema.safeParse(toObject(input));
  if (!parsed.success) return invalid(parsed.error);
  const ctx = await requireContext();
  if (!ctx) return SIGNED_OUT;

  const { data, error } = await ctx.supabase.rpc("accept_invitation", {
    p_token: parsed.data.token.toLowerCase(),
  });
  if (error) return rpcFailure(error);

  await setActiveProfileCookie(String(data));
  redirect("/");
}

/** Accepts from the in-app pending list (rpc my_pending_invitations). */
export async function acceptInvitationById(input: Input): Promise<ActionResult<{ profileId: string }>> {
  const parsed = invitationIdSchema.safeParse(toObject(input));
  if (!parsed.success) return invalid(parsed.error);
  const ctx = await requireContext();
  if (!ctx) return SIGNED_OUT;

  const { data, error } = await ctx.supabase.rpc("accept_invitation_by_id", {
    p_invitation_id: parsed.data.invitationId,
  });
  if (error) return rpcFailure(error);

  const profileId = String(data);
  await setActiveProfileCookie(profileId);
  refresh();
  return { ok: true, data: { profileId } };
}
