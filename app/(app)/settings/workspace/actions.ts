"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { getMembershipRole } from "@/lib/auth/dal";
import { getAuditExport, type AuditExport } from "@/lib/data/workspace";
import { requireSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseContext } from "@/lib/supabase/context";
import type { Json } from "@/lib/supabase/types";

/** Workspace settings actions: rename, clear samples, export the audit record. */

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string; code?: string };

const id = z.guid({ error: "Invalid id." });
const renameSchema = z.object({
  profileId: id,
  name: z
    .string({ error: "Enter a workspace name." })
    .trim()
    .min(1, { error: "Enter a workspace name." })
    .max(80, { error: "Use at most 80 characters." }),
});
const profileSchema = z.object({ profileId: id });

const SIGNED_OUT = { ok: false as const, error: "Your session has expired. Sign in again.", code: "unauthenticated" };

function toObject(input: FormData | Record<string, unknown>): Record<string, unknown> {
  if (input instanceof FormData) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of input.entries()) if (typeof v === "string" && !(k in out)) out[k] = v;
    return out;
  }
  return input ?? {};
}

/** Owner only (RLS lets owners update profiles.name). Logged as profile.renamed. */
export async function renameWorkspace(input: FormData | Record<string, unknown>): Promise<ActionResult<{ name: string }>> {
  const parsed = renameSchema.safeParse(toObject(input));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form.", code: "invalid_input" };
  const ctx = await getSupabaseContext();
  if (!ctx?.userClaims?.id) return SIGNED_OUT;
  const { profileId, name } = parsed.data;
  const role = await getMembershipRole(profileId);
  if (!role) return { ok: false, error: "Workspace not found.", code: "PT404" };
  if (role !== "owner") return { ok: false, error: "Only owners can rename the workspace.", code: "42501" };

  const { data: before } = await ctx.supabase.from("profiles").select("name").eq("id", profileId).maybeSingle();
  const oldName = (before as { name?: string } | null)?.name ?? null;
  if (oldName === name) return { ok: true, data: { name } };

  const { data, error } = await ctx.supabase.from("profiles").update({ name }).eq("id", profileId).select("name");
  if (error) {
    console.error("[workspace] rename failed:", error.code, error.message);
    return { ok: false, error: error.code === "42501" ? "Only owners can rename the workspace." : "Couldn't rename the workspace. Try again." };
  }
  if (!data || data.length === 0) return { ok: false, error: "Only owners can rename the workspace.", code: "42501" };

  try {
    const admin = requireSupabaseAdminClient();
    await admin.from("events").insert({
      profile_id: profileId,
      actor_id: ctx.userClaims.id,
      kind: "profile.renamed",
      data: { from: oldName, to: name } as Json,
    });
  } catch (err) {
    console.error("[workspace] rename event failed:", (err as Error).message);
  }
  refresh();
  return { ok: true, data: { name } };
}

/**
 * Hides sample ads from the Ads list by setting assets.audience to
 * 'sample_cleared' through update_asset (the audit trigger records each
 * change with the caller as actor). Nothing is deleted.
 */
export async function clearSamples(input: FormData | Record<string, unknown>): Promise<ActionResult<{ cleared: number }>> {
  const parsed = profileSchema.safeParse(toObject(input));
  if (!parsed.success) return { ok: false, error: "Invalid workspace.", code: "invalid_input" };
  const ctx = await getSupabaseContext();
  if (!ctx?.userClaims?.id) return SIGNED_OUT;
  const { profileId } = parsed.data;
  const role = await getMembershipRole(profileId);
  if (!role) return { ok: false, error: "Workspace not found.", code: "PT404" };

  const { data, error } = await ctx.supabase.from("assets").select("id").eq("profile_id", profileId).eq("audience", "sample").limit(500);
  if (error) {
    console.error("[workspace] sample lookup failed:", error.code, error.message);
    return { ok: false, error: "Couldn't find the sample ads. Try again." };
  }
  let cleared = 0;
  let firstError: string | null = null;
  for (const row of (data ?? []) as { id: string }[]) {
    const { error: rpcError } = await ctx.supabase.rpc("update_asset", { p_asset_id: row.id, p_patch: { audience: "sample_cleared" } });
    if (rpcError) {
      firstError ??= rpcError.message;
      console.error("[workspace] clear sample failed:", rpcError.code, rpcError.message);
      continue;
    }
    cleared += 1;
  }
  refresh();
  if (firstError && cleared === 0) {
    // The database says "profile"; people see "workspace".
    return { ok: false, error: `Couldn't clear the samples: ${firstError.replace(/\bprofile\b/gi, "workspace")}` };
  }
  return { ok: true, data: { cleared } };
}

/** Generates the audit record (decisions + events) for the Export dialog. */
export async function exportAuditRecord(input: FormData | Record<string, unknown>): Promise<ActionResult<AuditExport>> {
  const parsed = profileSchema.safeParse(toObject(input));
  if (!parsed.success) return { ok: false, error: "Invalid workspace.", code: "invalid_input" };
  const ctx = await getSupabaseContext();
  if (!ctx?.userClaims?.id) return SIGNED_OUT;
  const role = await getMembershipRole(parsed.data.profileId);
  if (!role) return { ok: false, error: "Workspace not found.", code: "PT404" };
  try {
    const record = await getAuditExport(parsed.data.profileId);
    if (!record) return { ok: false, error: "Workspace not found.", code: "PT404" };
    return { ok: true, data: record };
  } catch (err) {
    console.error("[workspace] export failed:", (err as Error).message);
    return { ok: false, error: "Couldn't build the audit record. Try again." };
  }
}
