"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { SIGNED_OUT, invalid, type ActionResult } from "@/lib/action-result";
import { APPROVED_STATUSES, ARCHIVABLE_STATUSES, isLive } from "@/features/ads/domain";
import { getCurrentUser } from "@/features/auth/server/dal";
import { requireSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

import { NOT_FOUND, fail, isFailure, rpcFailure, uuid } from "./shared";

/**
 * Life after approval: marking an approved ad live, changing its end date,
 * and archiving or unarchiving it. Each reads the lifecycle columns under
 * RLS, writes with the admin client and records one event.
 */

type LifecycleAsset = {
  id: string;
  profile_id: string;
  status: string;
  live_at: string | null;
  live_channel: string | null;
  live_url: string | null;
  expires_at: string | null;
  archived_at: string | null;
};

/** Loads the lifecycle columns under RLS (proves membership). */
async function loadLifecycleAsset(assetId: string): Promise<LifecycleAsset | ActionResult<never>> {
  const db = await createClient();
  const { data, error } = await db
    .from("assets")
    .select("id, profile_id, status, live_at, live_channel, live_url, expires_at, archived_at")
    .eq("id", assetId)
    .maybeSingle();
  if (error) {
    if (error.code === "42703") return { ok: false, error: "Live and archive are not set up on this server yet.", code: "not_ready" };
    return rpcFailure(error);
  }
  if (!data) return NOT_FOUND;
  return data;
}

function adminOr(fallback: string): ReturnType<typeof requireSupabaseAdminClient> | ActionResult<never> {
  try {
    return requireSupabaseAdminClient();
  } catch (err) {
    return fail(err, fallback);
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A past end date is refused in plain words; the database gets ISO strings. */
function parseFutureDate(value: string | undefined | null, what: string): { iso: string | null } | ActionResult<never> {
  if (!value) return { iso: null };
  // A bare date (from <input type="date">) means the end of that day.
  const d = DATE_ONLY.test(value) ? new Date(`${value}T23:59:59`) : new Date(value);
  if (Number.isNaN(d.getTime())) return { ok: false, error: `That ${what} is not a valid date.`, code: "invalid_input" };
  if (d.getTime() <= Date.now()) return { ok: false, error: `The ${what} has already passed. Pick a date in the future, or leave it empty.`, code: "invalid_input" };
  return { iso: d.toISOString() };
}

const markLiveSchema = z.object({
  assetId: uuid,
  channel: z.string().trim().min(1, { error: "Pick where the ad is live." }).max(60),
  url: z.string().trim().max(2000).optional(),
  liveAt: z.string().trim().max(40).optional(),
  expiresAt: z.string().trim().max(40).optional(),
});
export type MarkLiveInput = z.input<typeof markLiveSchema>;

/**
 * "Mark as live": records where an approved ad is running, from when, and
 * (optionally) until when. Only approved ads can go live; an end date in the
 * past is refused. Allowed again after an earlier run ended (re-approval).
 */
export async function markLive(input: MarkLiveInput): Promise<ActionResult> {
  const parsed = markLiveSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const asset = await loadLifecycleAsset(parsed.data.assetId);
  if (isFailure(asset)) return asset;

  if (asset.archived_at) return { ok: false, error: "This ad is archived. Unarchive it first.", code: "PT409" };
  if (!APPROVED_STATUSES.has(asset.status)) return { ok: false, error: "Only an approved ad can be marked as live.", code: "PT409" };
  if (isLive({ status: asset.status, liveAt: asset.live_at, expiresAt: asset.expires_at, archivedAt: asset.archived_at })) {
    return { ok: false, error: "This ad is already live. Change its end date instead.", code: "PT409" };
  }

  let url: string | null = null;
  if (parsed.data.url) {
    const raw = /^https?:\/\//i.test(parsed.data.url) ? parsed.data.url : `https://${parsed.data.url}`;
    try {
      const u = new URL(raw);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme");
      url = u.toString();
    } catch {
      return { ok: false, error: "That link is not a valid web address.", code: "invalid_input" };
    }
  }
  const expires = parseFutureDate(parsed.data.expiresAt, "end date");
  if (isFailure(expires)) return expires;
  let liveAt = new Date().toISOString();
  if (parsed.data.liveAt) {
    const d = new Date(DATE_ONLY.test(parsed.data.liveAt) ? `${parsed.data.liveAt}T00:00:00` : parsed.data.liveAt);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "That start date is not a valid date.", code: "invalid_input" };
    if (expires.iso && d.getTime() >= new Date(expires.iso).getTime()) return { ok: false, error: "The end date must come after the start date.", code: "invalid_input" };
    liveAt = d.toISOString();
  }

  const admin = adminOr("Marking ads live is not available on this server right now.");
  if (isFailure(admin)) return admin;
  const { error } = await admin
    .from("assets")
    .update({ live_at: liveAt, live_channel: parsed.data.channel, live_url: url, expires_at: expires.iso })
    .eq("id", asset.id)
    .eq("profile_id", asset.profile_id)
    .in("status", [...APPROVED_STATUSES]);
  if (error) return rpcFailure(error);
  const { error: eErr } = await admin.from("events").insert({
    profile_id: asset.profile_id,
    asset_id: asset.id,
    actor_id: user.id,
    kind: "asset.marked_live",
    data: { live_at: liveAt, live_channel: parsed.data.channel, live_url: url, expires_at: expires.iso, previous: { live_at: asset.live_at, expires_at: asset.expires_at } } as Json,
  });
  if (eErr) console.error("[ads] asset.marked_live event failed:", eErr.code, eErr.message);
  refresh();
  return { ok: true, data: null };
}

/** Changes or clears the end date of a live ad. A past date is refused. */
export async function setExpiry(input: { assetId: string; expiresAt: string | null }): Promise<ActionResult> {
  const parsed = z.object({ assetId: uuid, expiresAt: z.string().trim().max(40).nullable() }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const asset = await loadLifecycleAsset(parsed.data.assetId);
  if (isFailure(asset)) return asset;
  if (asset.archived_at) return { ok: false, error: "This ad is archived. Unarchive it first.", code: "PT409" };
  if (!asset.live_at || !APPROVED_STATUSES.has(asset.status)) return { ok: false, error: "Mark the ad as live first; the end date belongs to a live run.", code: "PT409" };
  const expires = parseFutureDate(parsed.data.expiresAt, "end date");
  if (isFailure(expires)) return expires;

  const admin = adminOr("Changing the end date is not available on this server right now.");
  if (isFailure(admin)) return admin;
  const { error } = await admin.from("assets").update({ expires_at: expires.iso }).eq("id", asset.id).eq("profile_id", asset.profile_id);
  if (error) return rpcFailure(error);
  const { error: eErr } = await admin.from("events").insert({
    profile_id: asset.profile_id,
    asset_id: asset.id,
    actor_id: user.id,
    kind: "asset.expiry_set",
    data: { expires_at: expires.iso, previous_expires_at: asset.expires_at } as Json,
  });
  if (eErr) console.error("[ads] asset.expiry_set event failed:", eErr.code, eErr.message);
  refresh();
  return { ok: true, data: null };
}

/**
 * Archive: takes an ad that is done (approved, live, rejected or waiting on a
 * revision) off every working tab. Nothing is deleted and the status stays;
 * the Archived tab and the audit record keep it.
 */
export async function archiveAd(input: { assetId: string; reason: string }): Promise<ActionResult> {
  const parsed = z.object({ assetId: uuid, reason: z.string().trim().min(3, { error: "Say why, in a few words." }).max(2000) }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const asset = await loadLifecycleAsset(parsed.data.assetId);
  if (isFailure(asset)) return asset;
  if (asset.archived_at) return { ok: false, error: "This ad is already archived.", code: "PT409" };
  if (!ARCHIVABLE_STATUSES.has(asset.status)) {
    return { ok: false, error: "Only approved, live, rejected or changes-requested ads can be archived. Decide on it first.", code: "PT409" };
  }
  const admin = adminOr("Archiving is not available on this server right now.");
  if (isFailure(admin)) return admin;
  const archivedAt = new Date().toISOString();
  const { error } = await admin
    .from("assets")
    .update({ archived_at: archivedAt, archive_reason: parsed.data.reason })
    .eq("id", asset.id)
    .eq("profile_id", asset.profile_id)
    .is("archived_at", null);
  if (error) return rpcFailure(error);
  const { error: eErr } = await admin.from("events").insert({
    profile_id: asset.profile_id,
    asset_id: asset.id,
    actor_id: user.id,
    kind: "asset.archived",
    data: { reason: parsed.data.reason, status: asset.status, was_live: isLive({ status: asset.status, liveAt: asset.live_at, expiresAt: asset.expires_at, archivedAt: null }) } as Json,
  });
  if (eErr) console.error("[ads] asset.archived event failed:", eErr.code, eErr.message);
  refresh();
  return { ok: true, data: null };
}

/** Puts an archived ad back on the tab its status says. */
export async function unarchiveAd(assetId: string): Promise<ActionResult> {
  const parsed = uuid.safeParse(assetId);
  if (!parsed.success) return invalid(parsed.error);
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const asset = await loadLifecycleAsset(parsed.data);
  if (isFailure(asset)) return asset;
  if (!asset.archived_at) return { ok: false, error: "This ad is not archived.", code: "PT409" };
  const admin = adminOr("Unarchiving is not available on this server right now.");
  if (isFailure(admin)) return admin;
  const { error } = await admin.from("assets").update({ archived_at: null, archive_reason: null }).eq("id", asset.id).eq("profile_id", asset.profile_id);
  if (error) return rpcFailure(error);
  const { error: eErr } = await admin.from("events").insert({
    profile_id: asset.profile_id,
    asset_id: asset.id,
    actor_id: user.id,
    kind: "asset.unarchived",
    data: { archived_at: asset.archived_at, status: asset.status } as Json,
  });
  if (eErr) console.error("[ads] asset.unarchived event failed:", eErr.code, eErr.message);
  refresh();
  return { ok: true, data: null };
}
