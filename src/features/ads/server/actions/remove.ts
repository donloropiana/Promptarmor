"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { SIGNED_OUT, invalid, type ActionResult } from "@/lib/action-result";
import { getCurrentUser } from "@/features/auth/server/dal";
import { requireSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

/**
 * The trash can on an Ads list row and its undo: removing an ad marks it
 * withdrawn (and its inbox item declined); restoring puts the earlier status
 * back. Nothing is ever deleted.
 */

const uuid = z.string().uuid();

/** Statuses a removed ad can be put back to (everything the list shows except approvals). */
const RESTORABLE = ["needs_review", "needs_manual_review", "changes_requested", "recheck_ready", "rejected", "re_review_due"] as const;

/**
 * The trash can on a row: takes the ad off the list ("not an ad", a
 * duplicate, a mistake). Nothing is deleted: the ad is marked withdrawn, the
 * inbox item it came from is marked declined, and the event is recorded.
 * Approved ads are frozen; withdraw the approval first.
 */
export async function removeAd(input: { assetId: string }): Promise<ActionResult<{ previousStatus: string }>> {
  const parsed = z.object({ assetId: uuid }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const db = await createClient();
  const { data: asset } = await db.from("assets").select("id, profile_id, status, audience").eq("id", parsed.data.assetId).maybeSingle();
  if (!asset) return { ok: false, error: "That ad is not in this workspace.", code: "PT404" };
  if (asset.status === "approved" || asset.status === "approved_with_exceptions") {
    return { ok: false, error: "This ad is approved. Withdraw the approval first.", code: "PT409" };
  }
  if (asset.status === "withdrawn") return { ok: true, data: { previousStatus: "withdrawn" } };

  const admin = requireSupabaseAdminClient();
  const { data: updated, error } = await admin
    .from("assets")
    .update({ status: "withdrawn", ...(asset.audience === "sample" ? { audience: "sample_cleared" } : {}) })
    .eq("id", asset.id)
    .not("status", "in", "(approved,approved_with_exceptions,withdrawn)")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: `Could not remove the ad: ${error.message}`, code: error.code };
  if (!updated) return { ok: false, error: "This ad changed under you. Reload and try again.", code: "PT409" };

  const now = new Date().toISOString();
  await admin
    .from("source_items")
    .update({ triage_status: "declined", triage_reason: "Removed from the ads list", triaged_by: user.id, triaged_at: now })
    .eq("asset_id", asset.id)
    .neq("triage_status", "declined");
  await admin.from("events").insert({
    profile_id: asset.profile_id,
    asset_id: asset.id,
    actor_id: user.id,
    kind: "ad.removed",
    data: { previous_status: asset.status } as Json,
  });
  refresh();
  return { ok: true, data: { previousStatus: asset.status } };
}

/** Undo for removeAd: puts the ad back with the status it had. */
export async function restoreAd(input: { assetId: string; status: string }): Promise<ActionResult> {
  const parsed = z.object({ assetId: uuid, status: z.enum(RESTORABLE) }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const db = await createClient();
  const { data: asset } = await db.from("assets").select("id, profile_id, status, audience").eq("id", parsed.data.assetId).maybeSingle();
  if (!asset) return { ok: false, error: "That ad is not in this workspace.", code: "PT404" };
  if (asset.status !== "withdrawn") return { ok: true, data: null };

  const admin = requireSupabaseAdminClient();
  const { error } = await admin
    .from("assets")
    .update({ status: parsed.data.status, ...(asset.audience === "sample_cleared" ? { audience: "sample" } : {}) })
    .eq("id", asset.id)
    .eq("status", "withdrawn");
  if (error) return { ok: false, error: `Could not restore the ad: ${error.message}`, code: error.code };
  await admin
    .from("source_items")
    .update({ triage_status: "accepted", triage_reason: "Put back on the ads list", triaged_by: user.id, triaged_at: new Date().toISOString() })
    .eq("asset_id", asset.id)
    .eq("triage_status", "declined");
  await admin.from("events").insert({
    profile_id: asset.profile_id,
    asset_id: asset.id,
    actor_id: user.id,
    kind: "ad.restored",
    data: { status: parsed.data.status } as Json,
  });
  refresh();
  return { ok: true, data: null };
}
