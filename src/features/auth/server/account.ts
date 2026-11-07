"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { getCurrentUser } from "./dal";
import { getRequestOrigin } from "./origin";
import { createClient } from "@/lib/supabase/server";

/**
 * Your account: display name, sign-in email, password. Each acts on the
 * signed-in user only, through Supabase Auth with the user's own session
 * (never the secret key). public.users follows auth.users by trigger, so the
 * Members list and audit record pick up a new name or email on their own.
 *
 * Email changes keep Supabase's confirmation: the new address must click a
 * link before it becomes the sign-in email, because invitations are bound to
 * verified emails. Whether the OLD address must also confirm is the
 * "Secure email change" setting in Supabase Auth (see docs/setup.md).
 */

export type AccountResult = { ok: true; message: string } | { ok: false; error: string };

const SIGNED_OUT: AccountResult = { ok: false, error: "Your session has expired. Sign in again." };

const nameSchema = z
  .string({ error: "Enter your name." })
  .trim()
  .min(1, { error: "Enter your name." })
  .max(80, { error: "Use at most 80 characters." });
const emailSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z.email({ error: "Enter a valid email address." }).max(320),
);
const passwordSchema = z
  .string({ error: "Enter a new password." })
  .min(8, { error: "Use at least 8 characters." })
  .max(72, { error: "Use at most 72 characters." });

type AuthErrorLike = { code?: string; status?: number; message?: string };

function authError(err: AuthErrorLike): string {
  if (err.status === 429 || err.code?.startsWith("over_")) return "Too many requests. Wait a minute and try again.";
  switch (err.code) {
    case "email_exists":
      return "Another account already uses that email.";
    case "email_address_invalid":
      return "Enter a valid email address.";
    case "weak_password":
      return "Choose a stronger password (at least 8 characters, not a common one).";
    case "same_password":
      return "Choose a password different from your current one.";
    case "reauthentication_needed":
    case "reauthentication_not_valid":
      return "For security, sign out and sign back in, then change your password.";
    case "session_not_found":
    case "session_expired":
      return "Your session has expired. Sign in again.";
    default:
      return "Something went wrong. Try again.";
  }
}

export async function updateDisplayName(input: { name: string }): Promise<AccountResult> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const parsed = nameSchema.safeParse(input?.name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check your name." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ data: { full_name: parsed.data } });
  if (error) {
    console.error("[account] name update failed:", error.code ?? error.status);
    return { ok: false, error: authError(error) };
  }
  // A fresh token carries the new name to everything that reads claims.
  await supabase.auth.refreshSession();
  refresh();
  return { ok: true, message: "Name saved." };
}

export async function updateEmail(input: { email: string }): Promise<AccountResult> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const parsed = emailSchema.safeParse(input?.email);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a valid email address." };
  if (parsed.data === user.email) return { ok: false, error: "That's already your email." };

  const supabase = await createClient();
  const origin = await getRequestOrigin();
  const { error } = await supabase.auth.updateUser({ email: parsed.data }, { emailRedirectTo: `${origin}/settings/account` });
  if (error) {
    console.error("[account] email update failed:", error.code ?? error.status);
    return { ok: false, error: authError(error) };
  }
  refresh();
  return {
    ok: true,
    message: `We sent a confirmation link to ${parsed.data}. Your sign-in email changes when you open it. Until then, keep using ${user.email ?? "your current email"}.`,
  };
}

export async function updatePassword(input: { password: string; confirm: string }): Promise<AccountResult> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const parsed = passwordSchema.safeParse(input?.password);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the password." };
  if (input.confirm !== parsed.data) return { ok: false, error: "The passwords don't match." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) {
    console.error("[account] password update failed:", error.code ?? error.status);
    return { ok: false, error: authError(error) };
  }
  return { ok: true, message: "Password changed. Use it the next time you sign in." };
}
