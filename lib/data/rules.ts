import "server-only";

import { cache } from "react";

import { requireMember, type Membership } from "@/lib/auth/dal";
import type { Json } from "@/lib/supabase/types";
import type { Product, Severity } from "@/lib/types/ads";

/**
 * Read model for the Rules page (Rules | Products tabs). Every read goes
 * through the user-context client, so RLS limits it to the active workspace.
 * Server Components calling these read cookies(), so render them inside
 * <Suspense>.
 */

import { PRODUCT_LABELS, RULE_APPLIES_TO, RULE_KIND_LABELS, SEVERITIES, type RuleKind } from "./rules-labels";

export { PRODUCT_LABELS, RULE_APPLIES_TO, RULE_KIND_LABELS, SEVERITIES };
export type { RuleKind };

export type Reference = {
  id: string;
  label: string;
  citation: string;
  url: string | null;
  summary: string | null;
};

export type RuleVersion = {
  id: string;
  ruleId: string;
  versionNo: number;
  title: string;
  body: string;
  defaultSeverity: Severity;
  appliesTo: string[];
  referenceIds: string[];
  reason: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
};

export type WorkspaceRule = {
  id: string;
  code: string;
  kind: RuleKind;
  active: boolean;
  clonedFrom: string | null;
  current: RuleVersion;
  /** Every version, newest first (for the history drawer). */
  versions: RuleVersion[];
  references: Reference[];
  versionCount: number;
};

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

function sev(v: unknown): Severity {
  return v === "critical" || v === "major" || v === "minor" ? v : "minor";
}
function kind(v: unknown): RuleKind {
  return v === "regulatory" || v === "policy" || v === "offer" || v === "security" ? v : "policy";
}
function product(v: unknown): Product {
  return v === "personal_loan" || v === "credit_card" || v === "mortgage" || v === "other" ? v : "unknown";
}
function termsOf(v: Json): OfferTerms {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as OfferTerms) : {};
}

type UserName = { id: string; full_name: string | null; email: string };

/** Display name for a user id, falling back to the email. */
export function displayName(u: { full_name?: string | null; email?: string | null } | null | undefined): string | null {
  if (!u) return null;
  const n = u.full_name?.trim();
  return n || u.email || null;
}

async function userNames(supabase: Membership["supabase"], ids: (string | null)[]): Promise<Map<string, UserName>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const out = new Map<string, UserName>();
  if (unique.length === 0) return out;
  const { data } = await supabase.from("users").select("id, full_name, email").in("id", unique);
  for (const u of (data ?? []) as UserName[]) out.set(u.id, u);
  return out;
}

/** Reference library rows for the given ids (any order), keyed by id. */
export async function getReferences(supabase: Membership["supabase"], ids: string[]): Promise<Map<string, Reference>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, Reference>();
  if (unique.length === 0) return out;
  const { data, error } = await supabase
    .from("reference_library")
    .select("id, label, citation, url, summary")
    .in("id", unique);
  if (error) {
    console.error("[rules] reference lookup failed:", error.code, error.message);
    return out;
  }
  for (const r of (data ?? []) as Reference[]) out.set(r.id, r);
  return out;
}

/**
 * Workspace rules (profile_id = active) with their current version, legal
 * references and version count. Sorted: active first, then by kind, then code.
 */
export const getWorkspaceRules = cache(async (profileId: string): Promise<WorkspaceRule[]> => {
  const { supabase } = await requireMember(profileId);

  const { data: rules, error } = await supabase
    .from("rules")
    .select("id, code, kind, active, cloned_from, current_version_id")
    .eq("profile_id", profileId)
    .order("code", { ascending: true });
  if (error) {
    console.error("[rules] list failed:", error.code, error.message);
    return [];
  }
  const rows = (rules ?? []) as {
    id: string;
    code: string;
    kind: string;
    active: boolean;
    cloned_from: string | null;
    current_version_id: string | null;
  }[];
  if (rows.length === 0) return [];

  const ruleIds = rows.map((r) => r.id);
  const { data: versions, error: vErr } = await supabase
    .from("rule_versions")
    .select("id, rule_id, version_no, title, body, default_severity, applies_to, reference_ids, reason, author_id, created_at")
    .in("rule_id", ruleIds)
    .order("version_no", { ascending: false });
  if (vErr) {
    console.error("[rules] versions failed:", vErr.code, vErr.message);
    return [];
  }
  type VRow = {
    id: string;
    rule_id: string;
    version_no: number;
    title: string;
    body: string;
    default_severity: string;
    applies_to: string[];
    reference_ids: string[];
    reason: string;
    author_id: string | null;
    created_at: string;
  };
  const vRows = (versions ?? []) as VRow[];
  const names = await userNames(
    supabase,
    vRows.map((v) => v.author_id),
  );
  const refs = await getReferences(
    supabase,
    vRows.flatMap((v) => v.reference_ids ?? []),
  );

  const byRule = new Map<string, VRow[]>();
  for (const v of vRows) {
    const list = byRule.get(v.rule_id) ?? [];
    list.push(v);
    byRule.set(v.rule_id, list);
  }

  const toVersion = (v: VRow): RuleVersion => ({
    id: v.id,
    ruleId: v.rule_id,
    versionNo: v.version_no,
    title: v.title,
    body: v.body,
    defaultSeverity: sev(v.default_severity),
    appliesTo: v.applies_to ?? [],
    referenceIds: v.reference_ids ?? [],
    reason: v.reason,
    authorId: v.author_id,
    authorName: displayName(names.get(v.author_id ?? "")),
    createdAt: v.created_at,
  });

  const out: WorkspaceRule[] = [];
  for (const r of rows) {
    const list = byRule.get(r.id) ?? [];
    const currentRow = list.find((v) => v.id === r.current_version_id) ?? list[0];
    if (!currentRow) continue; // a rule without a version is incomplete; hide it
    const current = toVersion(currentRow);
    out.push({
      id: r.id,
      code: r.code,
      kind: kind(r.kind),
      active: r.active,
      clonedFrom: r.cloned_from,
      current,
      versions: list.map(toVersion),
      references: current.referenceIds.map((id) => refs.get(id)).filter((x): x is Reference => Boolean(x)),
      versionCount: list.length,
    });
  }

  const kindOrder: Record<RuleKind, number> = { regulatory: 0, offer: 1, policy: 2, security: 3 };
  out.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (kindOrder[a.kind] !== kindOrder[b.kind]) return kindOrder[a.kind] - kindOrder[b.kind];
    return a.code.localeCompare(b.code);
  });
  return out;
});

/** Every version of one rule, newest first (for the history drawer). */
export async function getRuleVersions(profileId: string, ruleId: string): Promise<RuleVersion[]> {
  const { supabase } = await requireMember(profileId);
  const { data, error } = await supabase
    .from("rule_versions")
    .select("id, rule_id, version_no, title, body, default_severity, applies_to, reference_ids, reason, author_id, created_at")
    .eq("rule_id", ruleId)
    .eq("profile_id", profileId)
    .order("version_no", { ascending: false });
  if (error) {
    console.error("[rules] history failed:", error.code, error.message);
    return [];
  }
  type VRow = {
    id: string;
    rule_id: string;
    version_no: number;
    title: string;
    body: string;
    default_severity: string;
    applies_to: string[];
    reference_ids: string[];
    reason: string;
    author_id: string | null;
    created_at: string;
  };
  const rows = (data ?? []) as VRow[];
  const names = await userNames(supabase, rows.map((v) => v.author_id));
  return rows.map((v) => ({
    id: v.id,
    ruleId: v.rule_id,
    versionNo: v.version_no,
    title: v.title,
    body: v.body,
    defaultSeverity: sev(v.default_severity),
    appliesTo: v.applies_to ?? [],
    referenceIds: v.reference_ids ?? [],
    reason: v.reason,
    authorId: v.author_id,
    authorName: displayName(names.get(v.author_id ?? "")),
    createdAt: v.created_at,
  }));
}

/** The whole reference library (for the Add rule sheet's source picker). */
export async function getReferenceLibrary(profileId: string): Promise<Reference[]> {
  const { supabase } = await requireMember(profileId);
  const { data, error } = await supabase
    .from("reference_library")
    .select("id, label, citation, url, summary")
    .order("label", { ascending: true });
  if (error) {
    console.error("[rules] library failed:", error.code, error.message);
    return [];
  }
  return (data ?? []) as Reference[];
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
      product: product(o.product),
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
 * Approved ads whose approving check used `offerVersionId`
 * (analysis_runs.offer_version_ids contains it). The run is found through
 * decisions.analysis_run_id of the asset's approved decision, falling back to
 * any run on the approved version. Read under RLS.
 */
export async function getApprovedAdsUsingOfferVersion(
  supabase: Membership["supabase"],
  profileId: string,
  offerVersionId: string,
): Promise<AffectedAd[]> {
  const { data: assets, error } = await supabase
    .from("assets")
    .select("id, title, status, approved_version_id, approved_decision_id")
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
    approved_version_id: string | null;
    approved_decision_id: string | null;
  };
  const rows = (assets ?? []) as ARow[];
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
  if (runRows.length === 0) return [];
  const runIds = new Set(runRows.map((r) => r.id));
  const versionIds = new Set(runRows.map((r) => r.asset_version_id));

  const decisionIds = rows.map((a) => a.approved_decision_id).filter((x): x is string => Boolean(x));
  const decisionRun = new Map<string, string | null>();
  if (decisionIds.length > 0) {
    const { data: decisions } = await supabase
      .from("decisions")
      .select("id, analysis_run_id")
      .in("id", decisionIds);
    for (const d of (decisions ?? []) as { id: string; analysis_run_id: string | null }[]) {
      decisionRun.set(d.id, d.analysis_run_id);
    }
  }

  const out: AffectedAd[] = [];
  for (const a of rows) {
    const viaDecision = a.approved_decision_id ? decisionRun.get(a.approved_decision_id) : null;
    const hit =
      (viaDecision && runIds.has(viaDecision)) ||
      (a.approved_version_id ? versionIds.has(a.approved_version_id) : false);
    if (hit) out.push({ id: a.id, title: a.title, status: a.status });
  }
  return out;
}
