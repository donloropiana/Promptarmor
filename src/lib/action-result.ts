import type { z } from "zod";

/**
 * The result shape every Server Action returns, plus the two failures every
 * action shares. One module so the action files cannot drift apart. Not a
 * "use server" file, so it may export constants and plain functions.
 */
export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string; code?: string; hint?: string };

export const SIGNED_OUT = { ok: false as const, error: "Your session has expired. Sign in again.", code: "unauthenticated" };

/** The first validation message as a failed result. */
export function invalid(error: z.ZodError): { ok: false; error: string; code: string } {
  return { ok: false, error: error.issues[0]?.message ?? "Check the form and try again.", code: "invalid_input" };
}
