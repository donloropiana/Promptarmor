"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { safeNextPath } from "@/features/auth/redirect";
import { createClient } from "@/lib/supabase/server";

export type ConfirmState = { error: string } | null;

const confirmSchema = z.object({
  token_hash: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]{6,512}$/),
  type: z.enum(["email", "signup", "magiclink", "invite", "recovery", "email_change"]),
  next: z.string().max(2048).optional(),
});

/**
 * Second half of the scanner-safe email link flow. The GET page only renders
 * a Continue button; the one-time token is spent here, on an explicit POST,
 * so link scanners that prefetch the URL cannot consume it.
 */
export async function confirmEmailLink(
  _prev: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  const parsed = confirmSchema.safeParse({
    token_hash: formData.get("token_hash"),
    type: formData.get("type"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) {
    return { error: "This link is incomplete. Open the latest email and try again." };
  }
  const { token_hash, type, next } = parsed.data;

  let ok = false;
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (error) {
      console.warn("[auth/confirm] verifyOtp failed:", error.code ?? error.status);
    }
    ok = !error;
  } catch (err) {
    console.error("[auth/confirm]", (err as Error).message);
    return { error: "Sign-in is not available right now. Try again shortly." };
  }

  if (!ok) {
    return {
      error: "This link is invalid, expired, or was already used. Request a new one from the sign-in page.",
    };
  }

  // A recovery session always lands on the password form.
  if (type === "recovery") redirect("/reset-password");
  redirect(safeNextPath(next));
}
