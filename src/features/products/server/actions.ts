"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { refresh } from "next/cache";
import { z } from "zod";

import { PRODUCT_TYPES } from "@/features/products/catalog";
import { TERM_FIELDS } from "@/features/products/term-fields";
import { SIGNED_OUT, invalid, type ActionResult as SharedActionResult } from "@/lib/action-result";
import { getMembershipRole } from "@/features/auth/server/dal";
import { getApprovedAdsUsingOfferVersion, type AffectedAd } from "@/features/rules/server/queries";
import { requireSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseContext, type AppSupabaseContext } from "@/lib/supabase/context";
import type { Json } from "@/lib/supabase/types";

/**
 * Products (offers) Server Actions. Membership is proven by reading the
 * offer under RLS; the secret-key client then inserts the immutable
 * offer_versions row (author_id = the caller) and moves affected approved
 * ads back to Needs review (status re_review_due, tagged "Rates changed").
 */

export type ActionResult<T = null> = SharedActionResult<T>;

type Input = FormData | Record<string, unknown>;

const id = z.guid({ error: "Invalid id." });
const reason = z
  .string({ error: "Say why the terms changed." })
  .trim()
  .min(3, { error: "Say why the terms changed (a few words)." })
  .max(500, { error: "Keep the reason under 500 characters." });
const termsSchema = z.preprocess(
  (v) => {
    if (typeof v === "string") {
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    }
    return v;
  },
  z.record(z.string(), z.unknown(), { error: "Terms must be an object." }),
);

const editSchema = z.object({ offerId: id, terms: termsSchema, reason });
const previewSchema = z.object({ offerId: id });
const addSchema = z.object({
  profileId: id,
  code: z
    .string({ error: "Give the product a short code, like PL-2." })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_.-]{0,39}$/, { error: "Codes use letters, numbers, dots or dashes (max 40)." }),
  product: z.enum(PRODUCT_TYPES, { error: "Choose a product type." }),
  name: z.string({ error: "Give the product a name." }).trim().min(1, { error: "Give the product a name." }).max(200),
  terms: termsSchema,
  reason: reason.default("Added by a member"),
});

function toObject(input: Input): Record<string, unknown> {
  if (input instanceof FormData) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of input.entries()) if (typeof v === "string" && !(k in out)) out[k] = v;
    return out;
  }
  return input ?? {};
}

const NOT_FOUND = { ok: false as const, error: "Product not found.", code: "PT404" };

/** The database says "profile"; people see "workspace". */
function plain(message: string): string {
  const text = message
    .replace(/\bprofiles?\b/g, (w) => (w.endsWith("s") ? "workspaces" : "workspace"))
    .replace(/\bProfiles?\b/g, (w) => (w.endsWith("s") ? "Workspaces" : "Workspace"))
    .trim();
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function dbFailure(where: string, error: PostgrestError): { ok: false; error: string; code?: string } {
  if (error.code === "23505") return { ok: false, error: "A product with that code already exists in this workspace.", code: error.code };
  if (error.code === "PT409" || error.code === "PT422" || error.code === "42501") {
    return { ok: false, error: plain(error.message), code: error.code };
  }
  console.error(`[offers] ${where} failed:`, error.code, error.message);
  return { ok: false, error: "Something went wrong. Please try again.", code: error.code };
}

async function requireContext(): Promise<AppSupabaseContext | null> {
  const ctx = await getSupabaseContext();
  return ctx?.userClaims?.id ? ctx : null;
}

type OfferRow = { id: string; profile_id: string; code: string; name: string; product: string; active: boolean };

async function loadOwnOffer(ctx: AppSupabaseContext, offerId: string): Promise<OfferRow | null> {
  const { data, error } = await ctx.supabase
    .from("offers")
    .select("id, profile_id, code, name, product, active")
    .eq("id", offerId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as OfferRow;
  const role = await getMembershipRole(row.profile_id);
  return role ? row : null;
}

async function currentVersion(ctx: AppSupabaseContext, offerId: string): Promise<{ id: string; version_no: number; terms: Json } | null> {
  const { data } = await ctx.supabase
    .from("offer_versions")
    .select("id, version_no, terms")
    .eq("offer_id", offerId)
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string; version_no: number; terms: Json } | null) ?? null;
}

/**
 * Only built-in fields with a numeric or yes/no kind are converted. Every
 * other value, including any fact a workspace names itself, is kept exactly as
 * typed: "02139" stays "02139". The checks read numbers out of text anyway.
 */
const NUMERIC_KEYS = new Set(TERM_FIELDS.filter((f) => f.kind === "percent" || f.kind === "money" || f.kind === "months" || f.kind === "number").map((f) => f.key));
const BOOLEAN_KEYS = new Set(TERM_FIELDS.filter((f) => f.kind === "boolean").map((f) => f.key));

/** Cleans a terms object: trims strings, drops empty values, turns "8.99" into 8.99 and "true" into true for built-in fields. */
function cleanTerms(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = k.trim();
    if (!key || key.length > 60) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === "string") {
      const s = v.trim();
      if (!s) continue;
      // A built-in numeric fact may be typed with its unit ("8.99%", "$95", "12 months"): keep the number.
      const n = NUMERIC_KEYS.has(key) ? s.replace(/,/g, "").match(/^\s*[$]?\s*(-?\d+(?:\.\d+)?)\s*(%|\$|months?|mo\.?|yrs?|years?)?\s*$/i) : null;
      if (n) out[key] = Number(n[1]);
      else if (BOOLEAN_KEYS.has(key) && (s === "true" || s === "false")) out[key] = s === "true";
      else out[key] = s.slice(0, 2000);
      continue;
    }
    if (typeof v === "number" && !Number.isFinite(v)) continue;
    out[key] = v;
  }
  return out;
}

/** Which changed between two term sheets, as "apr_min 7.99 → 8.99" fragments. */
function diffTerms(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: string[] = [];
  for (const k of keys) {
    if (k === "summary" || k === "notes" || k === "representative_example") continue;
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const fmt = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
    out.push(`${k} ${fmt(a)} → ${fmt(b)}`);
  }
  return out;
}

export type OfferChangePreview = { count: number; ads: AffectedAd[]; currentVersionNo: number };

/**
 * "This sends N approved ads back to Needs review": the approved ads whose
 * approving check used the product's current terms version.
 */
export async function previewOfferChange(input: Input): Promise<ActionResult<OfferChangePreview>> {
  const parsed = previewSchema.safeParse(toObject(input));
  if (!parsed.success) return invalid(parsed.error);
  const ctx = await requireContext();
  if (!ctx) return SIGNED_OUT;
  const offer = await loadOwnOffer(ctx, parsed.data.offerId);
  if (!offer) return NOT_FOUND;
  const cur = await currentVersion(ctx, offer.id);
  if (!cur) return { ok: true, data: { count: 0, ads: [], currentVersionNo: 0 } };
  const ads = await getApprovedAdsUsingOfferVersion(ctx.supabase, offer.profile_id, cur.id);
  return { ok: true, data: { count: ads.length, ads, currentVersionNo: cur.version_no } };
}

/**
 * Saves new terms as an immutable offer_versions row (reason required), then
 * sends each approved ad that relied on the old version back to Needs review
 * (status re_review_due, re_review_reason {offer_version_id, from_version_id,
 * summary}) and logs one offer.changed event with the counts.
 */
export async function editOffer(
  input: Input,
): Promise<ActionResult<{ versionId: string; versionNo: number; affected: number; changes: string[] }>> {
  const parsed = editSchema.safeParse(toObject(input));
  if (!parsed.success) return invalid(parsed.error);
  const ctx = await requireContext();
  if (!ctx) return SIGNED_OUT;
  const userId = ctx.userClaims!.id;
  const offer = await loadOwnOffer(ctx, parsed.data.offerId);
  if (!offer) return NOT_FOUND;

  const prev = await currentVersion(ctx, offer.id);
  const prevTerms = (prev?.terms && typeof prev.terms === "object" && !Array.isArray(prev.terms) ? prev.terms : {}) as Record<string, unknown>;
  const terms = cleanTerms(parsed.data.terms);
  if (Object.keys(terms).length === 0) return { ok: false, error: "Enter at least one term.", code: "invalid_input" };
  const changes = diffTerms(prevTerms, terms);
  const proseChanged = ["summary", "notes", "representative_example"].some((k) => (prevTerms[k] ?? "") !== (terms[k] ?? ""));
  if (changes.length === 0 && !proseChanged) {
    return { ok: false, error: "Nothing changed. Edit the terms before saving a new version.", code: "unchanged" };
  }

  // Affected ads are computed before the new version exists, against the old one.
  const affected = prev ? await getApprovedAdsUsingOfferVersion(ctx.supabase, offer.profile_id, prev.id) : [];

  const admin = requireSupabaseAdminClient();
  const insert = {
    offer_id: offer.id,
    profile_id: offer.profile_id,
    terms: terms as Json,
    reason: parsed.data.reason,
    author_id: userId,
  };
  const { data, error } = await admin
    .from("offer_versions")
    .insert(insert as never)
    .select("id, version_no")
    .single();
  if (error) return dbFailure("editOffer", error);
  const created = data as { id: string; version_no: number };

  const summary =
    changes.length > 0
      ? `Product ${offer.code} changed: ${changes.slice(0, 3).join("; ")}${changes.length > 3 ? ` (+${changes.length - 3} more)` : ""}`
      : `Product ${offer.code} terms updated`;

  let moved = 0;
  const movedIds: string[] = [];
  for (const ad of affected) {
    const { error: uErr } = await admin
      .from("assets")
      .update({
        status: "re_review_due",
        re_review_reason: {
          offer_version_id: created.id,
          from_version_id: prev?.id ?? null,
          offer_code: offer.code,
          summary,
          changed_at: new Date().toISOString(),
        } as Json,
      })
      .eq("id", ad.id)
      .eq("profile_id", offer.profile_id)
      .in("status", ["approved", "approved_with_exceptions"]);
    if (uErr) {
      console.error("[offers] re_review_due update failed:", uErr.code, uErr.message);
      continue;
    }
    moved += 1;
    movedIds.push(ad.id);
  }

  const { error: eErr } = await admin.from("events").insert({
    profile_id: offer.profile_id,
    actor_id: userId,
    kind: "offer.changed",
    data: {
      offer_id: offer.id,
      offer_code: offer.code,
      offer_name: offer.name,
      from_version_id: prev?.id ?? null,
      to_version_id: created.id,
      version_no: created.version_no,
      changes,
      summary,
      reason: parsed.data.reason,
      affected_count: moved,
      affected_asset_ids: movedIds,
    } as Json,
  });
  if (eErr) console.error("[offers] event insert failed:", eErr.code, eErr.message);

  refresh();
  return { ok: true, data: { versionId: created.id, versionNo: created.version_no, affected: moved, changes } };
}

/** Adds a product (offer) with its first terms version. */
export async function addOffer(input: Input): Promise<ActionResult<{ offerId: string }>> {
  const parsed = addSchema.safeParse(toObject(input));
  if (!parsed.success) return invalid(parsed.error);
  const ctx = await requireContext();
  if (!ctx) return SIGNED_OUT;
  const role = await getMembershipRole(parsed.data.profileId);
  if (!role) return { ok: false, error: "Workspace not found.", code: "PT404" };
  const userId = ctx.userClaims!.id;
  const { profileId } = parsed.data;
  const terms = cleanTerms(parsed.data.terms);
  if (Object.keys(terms).length === 0) return { ok: false, error: "Enter at least one term.", code: "invalid_input" };

  const admin = requireSupabaseAdminClient();
  const { data: created, error } = await admin
    .from("offers")
    .insert({ profile_id: profileId, code: parsed.data.code, product: parsed.data.product, name: parsed.data.name, active: true })
    .select("id")
    .single();
  if (error) return dbFailure("addOffer", error);
  const offerId = (created as { id: string }).id;

  const insert = { offer_id: offerId, profile_id: profileId, terms: terms as Json, reason: parsed.data.reason, author_id: userId };
  const { error: vErr } = await admin.from("offer_versions").insert(insert as never);
  if (vErr) {
    await admin.from("offers").delete().eq("id", offerId).eq("profile_id", profileId);
    return dbFailure("addOffer.version", vErr);
  }

  const { error: eErr } = await admin.from("events").insert({
    profile_id: profileId,
    actor_id: userId,
    kind: "offer.added",
    data: { offer_id: offerId, offer_code: parsed.data.code, offer_name: parsed.data.name, product: parsed.data.product } as Json,
  });
  if (eErr) console.error("[offers] event insert failed:", eErr.code, eErr.message);

  refresh();
  return { ok: true, data: { offerId } };
}

/** Archives or restores a product (offers.active). Archived products are not used by checks. */
export async function setOfferActive(input: Input): Promise<ActionResult<{ active: boolean }>> {
  const parsed = z
    .object({ offerId: id, active: z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean()) })
    .safeParse(toObject(input));
  if (!parsed.success) return invalid(parsed.error);
  const ctx = await requireContext();
  if (!ctx) return SIGNED_OUT;
  const offer = await loadOwnOffer(ctx, parsed.data.offerId);
  if (!offer) return NOT_FOUND;

  const admin = requireSupabaseAdminClient();
  const { error } = await admin.from("offers").update({ active: parsed.data.active }).eq("id", offer.id).eq("profile_id", offer.profile_id);
  if (error) return dbFailure("setOfferActive", error);
  refresh();
  return { ok: true, data: { active: parsed.data.active } };
}
