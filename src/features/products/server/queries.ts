import "server-only";

import { cache } from "react";

import { requireMember, type Membership } from "@/features/auth/server/dal";
import { asProduct, type Product } from "@/features/products/catalog";
import { displayName, userNames } from "@/lib/display-name";
import type { Json } from "@/lib/supabase/types";

/**
 * Read model for products (offers): the Products tab of the Rules page, with
 * every term-sheet version, and the approved ads that relied on one version
 * (so a terms change can send them back for review). Every read goes through
 * the user-context client, so RLS limits it to the active workspace.
 * Server Components calling these read cookies(), so render them inside
 * <Suspense>.
 */

/** A plain-JSON term sheet. Known numeric keys are rendered as a table. */
export type OfferTerms = Record<string, unknown> & { summary?: string };

export type OfferVersion = {
  id: string;
  offerId: string;
  versionNo: number;
  terms: OfferTerms;
  effectiveFrom: string;
  reason: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
};

export type WorkspaceOffer = {
  id: string;
  code: string;
  product: Product;
  name: string;
  active: boolean;
  current: OfferVersion;
  versions: OfferVersion[];
};

function termsOf(v: Json): OfferTerms {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as OfferTerms) : {};
}

/**
 * Workspace offers (the Products tab) with every version, newest first.
 * `current` is the highest version_no. Active offers first, then by code.
 */
export const getWorkspaceOffers = cache(async (profileId: string): Promise<WorkspaceOffer[]> => {
  const { supabase } = await requireMember(profileId);

  const { data: offers, error } = await supabase
    .from("offers")
    .select("id, code, product, name, active")
    .eq("profile_id", profileId)
    .order("code", { ascending: true });
  if (error) {
    console.error("[offers] list failed:", error.code, error.message);
    return [];
  }
  const rows = (offers ?? []) as { id: string; code: string; product: string; name: string; active: boolean }[];
  if (rows.length === 0) return [];

  const { data: versions, error: vErr } = await supabase
    .from("offer_versions")
    .select("id, offer_id, version_no, terms, effective_from, reason, author_id, created_at")
    .in(
      "offer_id",
      rows.map((o) => o.id),
    )
    .order("version_no", { ascending: false });
  if (vErr) {
    console.error("[offers] versions failed:", vErr.code, vErr.message);
    return [];
  }
  type VRow = {
    id: string;
    offer_id: string;
    version_no: number;
    terms: Json;
    effective_from: string;
    reason: string;
    author_id: string | null;
    created_at: string;
  };
  const vRows = (versions ?? []) as VRow[];
  const names = await userNames(supabase, vRows.map((v) => v.author_id));

  const byOffer = new Map<string, OfferVersion[]>();
  for (const v of vRows) {
    const list = byOffer.get(v.offer_id) ?? [];
    list.push({
      id: v.id,
      offerId: v.offer_id,
      versionNo: v.version_no,
      terms: termsOf(v.terms),
      effectiveFrom: v.effective_from,
      reason: v.reason,
      authorId: v.author_id,
      authorName: displayName(names.get(v.author_id ?? "")),
      createdAt: v.created_at,
    });
    byOffer.set(v.offer_id, list);
  }

  const out: WorkspaceOffer[] = [];
  for (const o of rows) {
    const list = byOffer.get(o.id) ?? [];
    if (list.length === 0) continue;
    out.push({
      id: o.id,
      code: o.code,
      product: asProduct(o.product),
      name: o.name,
      active: o.active,
      current: list[0],
      versions: list,
    });
  }
  out.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.code.localeCompare(b.code);
  });
  return out;
});

export type AffectedAd = { id: string; title: string; status: string };

/**
 * Approved ads that relied on `offerVersionId`:
 *
 * 1. The approving check recorded it (analysis_runs.offer_version_ids
 *    contains it), found through decisions.analysis_run_id of the asset's
 *    approved decision, or any run on the approved version.
 * 2. Otherwise, when the check never got as far as recording which terms it
 *    used (it failed or was declined by the budget, so the reviewer approved
 *    by hand against the terms current at the time): the ad is for the same
 *    product type and its approval was recorded while this version was the
 *    current one. "Not AI-screened" approvals still come back when rates change.
 *
 * Read under RLS.
 */
export async function getApprovedAdsUsingOfferVersion(
  supabase: Membership["supabase"],
  profileId: string,
  offerVersionId: string,
): Promise<AffectedAd[]> {
  const { data: assets, error } = await supabase
    .from("assets")
    .select("id, title, status, product, audience, approved_version_id, approved_decision_id")
    .eq("profile_id", profileId)
    .in("status", ["approved", "approved_with_exceptions"]);
  if (error) {
    console.error("[offers] affected assets lookup failed:", error.code, error.message);
    return [];
  }
  type ARow = {
    id: string;
    title: string;
    status: string;
    product: string | null;
    audience: string | null;
    approved_version_id: string | null;
    approved_decision_id: string | null;
  };
  // Cleared samples are hidden everywhere, so a terms change must not resurface them.
  const rows = ((assets ?? []) as ARow[]).filter((a) => a.audience !== "sample_cleared");
  if (rows.length === 0) return [];

  const { data: runs, error: rErr } = await supabase
    .from("analysis_runs")
    .select("id, asset_version_id")
    .eq("profile_id", profileId)
    .contains("offer_version_ids", [offerVersionId]);
  if (rErr) {
    console.error("[offers] run lookup failed:", rErr.code, rErr.message);
    return [];
  }
  const runRows = (runs ?? []) as { id: string; asset_version_id: string }[];
  const runIds = new Set(runRows.map((r) => r.id));
  const versionIds = new Set(runRows.map((r) => r.asset_version_id));

  const decisionIds = rows.map((a) => a.approved_decision_id).filter((x): x is string => Boolean(x));
  const decisionById = new Map<string, { runId: string | null; createdAt: string }>();
  if (decisionIds.length > 0) {
    const { data: decisions } = await supabase.from("decisions").select("id, analysis_run_id, created_at").in("id", decisionIds);
    for (const d of (decisions ?? []) as { id: string; analysis_run_id: string | null; created_at: string }[]) {
      decisionById.set(d.id, { runId: d.analysis_run_id, createdAt: d.created_at });
    }
  }

  // Runs the approving decisions point at: did they record any terms at all?
  const decisionRunIds = [...new Set([...decisionById.values()].map((d) => d.runId).filter((x): x is string => Boolean(x)))];
  const runRecordedOffers = new Map<string, boolean>();
  if (decisionRunIds.length > 0) {
    const { data: dRuns } = await supabase.from("analysis_runs").select("id, offer_version_ids").in("id", decisionRunIds);
    for (const r of (dRuns ?? []) as { id: string; offer_version_ids: string[] | null }[]) {
      runRecordedOffers.set(r.id, (r.offer_version_ids ?? []).length > 0);
    }
  }

  // The window in which this version was the product's current terms.
  const { data: ov } = await supabase
    .from("offer_versions")
    .select("id, offer_id, version_no, created_at, offers(product)")
    .eq("id", offerVersionId)
    .maybeSingle();
  type OVRow = { id: string; offer_id: string; version_no: number; created_at: string; offers: { product: string } | { product: string }[] | null };
  const version = (ov as OVRow | null) ?? null;
  let windowStart = 0;
  let windowEnd = Number.POSITIVE_INFINITY;
  let offerProduct: string | null = null;
  if (version) {
    windowStart = Date.parse(version.created_at);
    const o = Array.isArray(version.offers) ? version.offers[0] : version.offers;
    offerProduct = o?.product ?? null;
    const { data: next } = await supabase
      .from("offer_versions")
      .select("created_at")
      .eq("offer_id", version.offer_id)
      .gt("version_no", version.version_no)
      .order("version_no", { ascending: true })
      .limit(1)
      .maybeSingle();
    const n = (next as { created_at: string } | null)?.created_at;
    if (n) windowEnd = Date.parse(n);
  }

  const out: AffectedAd[] = [];
  for (const a of rows) {
    const decision = a.approved_decision_id ? decisionById.get(a.approved_decision_id) : undefined;
    const viaDecision = decision?.runId ?? null;
    let hit = (viaDecision !== null && runIds.has(viaDecision)) || (a.approved_version_id ? versionIds.has(a.approved_version_id) : false);

    if (!hit && version && offerProduct && decision) {
      // The check loads every product when the ad's product is unknown/other.
      const sameProduct = a.product === offerProduct || a.product === "unknown" || a.product === "other" || !a.product;
      const recorded = viaDecision ? (runRecordedOffers.get(viaDecision) ?? false) : false;
      const decidedAt = Date.parse(decision.createdAt);
      if (sameProduct && !recorded && Number.isFinite(decidedAt) && decidedAt >= windowStart && decidedAt < windowEnd) hit = true;
    }
    if (hit) out.push({ id: a.id, title: a.title, status: a.status });
  }
  return out;
}
