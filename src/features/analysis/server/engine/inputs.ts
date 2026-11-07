import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { OfferInput, RuleInput } from "@/features/analysis/schema";
import type { Product } from "@/features/products/catalog";
import type { Severity } from "@/features/rules/severity";
import type { Database, Json } from "@/lib/supabase/types";

/**
 * What a run checks, read with the admin client: the version, its asset, the
 * workspace's active rules (at their current versions) and the product terms
 * in effect. Also owns the row and input shapes the other engine modules share.
 */

export type Admin = SupabaseClient<Database>;

export type RunRow = Database["public"]["Tables"]["analysis_runs"]["Row"];
export type VersionRow = Database["public"]["Tables"]["asset_versions"]["Row"];
export type AssetRow = Pick<Database["public"]["Tables"]["assets"]["Row"], "id" | "profile_id" | "product" | "channel" | "status" | "submitted_at" | "title">;

export type LoadedRule = RuleInput & { rule_id: string; rule_version_id: string; kind: string };
export type LoadedOffer = OfferInput & { offer_id: string; offer_version_id: string };

export async function loadVersion(admin: Admin, run: RunRow): Promise<VersionRow> {
  const { data, error } = await admin.from("asset_versions").select("*").eq("id", run.asset_version_id).single();
  if (error || !data) throw new Error(`version ${run.asset_version_id} not found: ${error?.message ?? ""}`);
  return data;
}

export async function loadAsset(admin: Admin, assetId: string): Promise<AssetRow> {
  const { data, error } = await admin
    .from("assets")
    .select("id, profile_id, product, channel, status, submitted_at, title")
    .eq("id", assetId)
    .single();
  if (error || !data) throw new Error(`asset ${assetId} not found: ${error?.message ?? ""}`);
  return data;
}

export async function loadRules(admin: Admin, profileId: string, product: Product): Promise<LoadedRule[]> {
  const { data: rules, error } = await admin
    .from("rules")
    .select("id, code, kind, current_version_id")
    .eq("profile_id", profileId)
    .eq("active", true);
  if (error) throw new Error(`rules load failed: ${error.message}`);
  const versionIds = (rules ?? []).map((r) => r.current_version_id).filter((id): id is string => Boolean(id));
  if (versionIds.length === 0) return [];
  const { data: versions, error: vError } = await admin
    .from("rule_versions")
    .select("id, rule_id, title, body, default_severity, applies_to")
    .in("id", versionIds);
  if (vError) throw new Error(`rule versions load failed: ${vError.message}`);
  const byRule = new Map((versions ?? []).map((v) => [v.rule_id, v]));
  const out: LoadedRule[] = [];
  for (const r of rules ?? []) {
    const v = byRule.get(r.id);
    if (!v) continue;
    const applies = v.applies_to ?? [];
    // Keep every active rule (the run records all of them in rule_results; n/a ones are marked).
    out.push({
      rule_id: r.id,
      rule_version_id: v.id,
      kind: r.kind,
      code: r.code,
      title: v.title,
      body: v.body,
      default_severity: (["critical", "major", "minor"].includes(v.default_severity) ? v.default_severity : "major") as Severity,
      applies_to: applies.length ? applies : ["all"],
    });
  }
  void product;
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

export async function loadOffers(admin: Admin, profileId: string, product: Product): Promise<LoadedOffer[]> {
  const { data: offers, error } = await admin.from("offers").select("id, code, product, name").eq("profile_id", profileId).eq("active", true);
  if (error) throw new Error(`offers load failed: ${error.message}`);
  const relevant = (offers ?? []).filter((o) => product === "unknown" || product === "other" || o.product === product);
  if (relevant.length === 0) return [];
  const { data: versions, error: vError } = await admin
    .from("offer_versions")
    .select("id, offer_id, terms, version_no, effective_to")
    .in(
      "offer_id",
      relevant.map((o) => o.id),
    )
    .order("version_no", { ascending: false });
  if (vError) throw new Error(`offer versions load failed: ${vError.message}`);
  const current = new Map<string, { id: string; terms: Json }>();
  for (const v of versions ?? []) {
    if (current.has(v.offer_id)) continue;
    // Highest version_no first; prefer one still in effect.
    if (v.effective_to && new Date(v.effective_to).getTime() < Date.now()) continue;
    current.set(v.offer_id, { id: v.id, terms: v.terms });
  }
  // Offers whose every version has ended: fall back to the newest so the check still has numbers.
  for (const v of versions ?? []) if (!current.has(v.offer_id)) current.set(v.offer_id, { id: v.id, terms: v.terms });
  const out: LoadedOffer[] = [];
  for (const o of relevant) {
    const v = current.get(o.id);
    if (!v) continue;
    const terms = v.terms && typeof v.terms === "object" && !Array.isArray(v.terms) ? (v.terms as Record<string, unknown>) : {};
    out.push({ offer_id: o.id, offer_version_id: v.id, code: o.code, product: o.product, name: o.name, terms });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}
