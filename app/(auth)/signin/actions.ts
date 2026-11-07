"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/dal";
import { getRequestOrigin } from "@/lib/auth/origin";
import { safeNextPath, signInPath } from "@/lib/auth/redirect";
import { deleteUnconfirmedPasswordUser } from "@/lib/auth/unconfirmed";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign-in Server Actions (all public endpoints by nature; Supabase Auth
 * applies its own rate limits). Each returns AuthFormState for
 * useActionState, or redirects on success.
 *
 * Email links always point at /auth/confirm (see docs/setup.md templates),
 * with {{ .RedirectTo }} = the emailRedirectTo passed here, which is reduced
 * to a same-origin path by safeNextPath on the way back.
 */

export type AuthFormState = {
  ok: boolean;
  error?: string;
  message?: string;
  /** "code": show 6-digit code entry for `email`. "sent": informational. */
  step?: "code" | "sent";
  email?: string;
} | null;

const emailSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z.email({ error: "Enter a valid email address." }).max(320),
);
const passwordSchema = z
  .string({ error: "Enter your password." })
  .min(8, { error: "Use at least 8 characters." })
  .max(72, { error: "Use at most 72 characters." });
const codeSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.replace(/\s+/g, "") : v),
  z.string().regex(/^\d{6,10}$/, { error: "Enter the 6-digit code from the email." }),
);

const NOT_CONFIGURED: AuthFormState = {
  ok: false,
  error: "Sign-in isn't configured on this deployment yet.",
};

type AuthErrorLike = { code?: string; status?: number; message?: string };

function authErrorMessage(err: AuthErrorLike): string {
  if (err.status === 429 || err.code?.startsWith("over_")) {
    return "Too many requests — wait 60 s and try again.";
  }
  switch (err.code) {
    case "invalid_credentials":
      return "Incorrect email or password.";
    case "email_not_confirmed":
      return "Confirm your email first: use the link or code we emailed you.";
    case "otp_expired":
      return "That code is invalid or has expired. Send a new one.";
    case "weak_password":
      return "Choose a stronger password (at least 8 characters, not a common one).";
    case "email_address_invalid":
      return "Enter a valid email address.";
    case "signup_disabled":
    case "email_provider_disabled":
      return "Email sign-up is disabled.";
    case "same_password":
      return "Choose a password different from your current one.";
    default:
      return "Something went wrong. Please try again.";
  }
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form and try again.";
}

async function client(): Promise<SupabaseClient | null> {
  try {
    return await createClient();
  } catch {
    return null;
  }
}

/** Starts Google OAuth (PKCE). Redirects to Google, then /auth/callback. */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  const next = safeNextPath(formData.get("next"));
  const supabase = await client();
  if (!supabase) redirect(signInPath(next, "config"));

  const origin = await getRequestOrigin();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data?.url) {
    console.warn("[signin] google oauth start failed:", error?.code ?? error?.status);
    redirect(signInPath(next, "oauth"));
  }
  redirect(data.url);
}

/**
 * Emails a magic link AND a 6-digit code (both are in the template). New
 * emails get an account (shouldCreateUser) and the Confirm signup email.
 */
export async function sendEmailCode(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const email = parsed.data;
  const next = safeNextPath(formData.get("next"));

  const supabase = await client();
  if (!supabase) return NOT_CONFIGURED;
  const origin = await getRequestOrigin();

  // An unconfirmed account that already has a password may have been
  // registered by someone else; confirming it by code would hand them a
  // confirmed login. Delete it so the OTP flow creates a fresh,
  // passwordless user (lib/auth/unconfirmed.ts).
  await deleteUnconfirmedPasswordUser(email);

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: `${origin}${next}` },
  });
  if (error) {
    console.warn("[signin] otp send failed:", error.code ?? error.status);
    return { ok: false, error: authErrorMessage(error), email };
  }
  return {
    ok: true,
    step: "code",
    email,
    message: `We emailed a sign-in link and a 6-digit code to ${email}.`,
  };
}

/** Verifies the 6-digit email code (sign-in, or sign-up confirmation). */
export async function verifyEmailCode(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = emailSchema.safeParse(formData.get("email"));
  const token = codeSchema.safeParse(formData.get("token"));
  if (!email.success) return { ok: false, error: firstIssue(email.error) };
  if (!token.success) return { ok: false, error: firstIssue(token.error), email: email.data };
  const next = safeNextPath(formData.get("next"));

  const supabase = await client();
  if (!supabase) return NOT_CONFIGURED;

  const { error } = await supabase.auth.verifyOtp({
    email: email.data,
    token: token.data,
    type: "email",
  });
  if (error) {
    return { ok: false, error: authErrorMessage({ ...error, code: error.code ?? "otp_expired" }), email: email.data };
  }
  redirect(next);
}

export async function signInWithPassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) return { ok: false, error: firstIssue(email.error) };
  const password = formData.get("password");
  if (typeof password !== "string" || password.length === 0 || password.length > 72) {
    return { ok: false, error: "Enter your password.", email: email.data };
  }
  const next = safeNextPath(formData.get("next"));

  const supabase = await client();
  if (!supabase) return NOT_CONFIGURED;

  const { error } = await supabase.auth.signInWithPassword({ email: email.data, password });
  if (error) return { ok: false, error: authErrorMessage(error), email: email.data };
  redirect(next);
}

/**
 * Password sign-up. Email confirmation is required (Supabase setting), so
 * this normally returns step "code": the Confirm signup email carries both
 * a link and a code. For an already-registered email Supabase returns the
 * same response (no account enumeration), and so do we.
 */
export async function signUpWithPassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) return { ok: false, error: firstIssue(email.error) };
  const password = passwordSchema.safeParse(formData.get("password"));
  if (!password.success) return { ok: false, error: firstIssue(password.error), email: email.data };
  const next = safeNextPath(formData.get("next"));

  const supabase = await client();
  if (!supabase) return NOT_CONFIGURED;
  const origin = await getRequestOrigin();

  const { data, error } = await supabase.auth.signUp({
    email: email.data,
    password: password.data,
    options: { emailRedirectTo: `${origin}${next}` },
  });
  if (error) return { ok: false, error: authErrorMessage(error), email: email.data };

  // Only when email confirmation is OFF (it must be ON in production).
  if (data.session) redirect(next);

  return {
    ok: true,
    step: "code",
    email: email.data,
    message: `Check ${email.data} for a confirmation link or 6-digit code.`,
  };
}

/** Sends the password reset email. Same answer whether or not the account exists. */
export async function requestPasswordReset(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) return { ok: false, error: firstIssue(email.error) };

  const supabase = await client();
  if (!supabase) return NOT_CONFIGURED;
  const origin = await getRequestOrigin();

  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${origin}/reset-password`,
  });
  if (error && (error.status === 429 || error.code?.startsWith("over_"))) {
    return { ok: false, error: authErrorMessage(error), email: email.data };
  }
  if (error) console.warn("[signin] reset email failed:", error.code ?? error.status);
  return {
    ok: true,
    step: "sent",
    email: email.data,
    message: `If an account exists for ${email.data}, we sent a password reset link.`,
  };
}

/** Sets a new password for the signed-in (recovery) session. */
export async function updatePassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Your reset link has expired. Request a new one from the sign-in page." };
  }
  const password = passwordSchema.safeParse(formData.get("password"));
  if (!password.success) return { ok: false, error: firstIssue(password.error) };
  if (formData.get("confirm") !== password.data) {
    return { ok: false, error: "The passwords don't match." };
  }

  const supabase = await client();
  if (!supabase) return NOT_CONFIGURED;
  const { error } = await supabase.auth.updateUser({ password: password.data });
  if (error) return { ok: false, error: authErrorMessage(error) };
  redirect("/");
}
