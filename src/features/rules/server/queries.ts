import "server-only";

import { cache } from "react";

import { requireMember, type Membership } from "@/features/auth/server/dal";
import type { RuleKind } from "@/features/rules/labels";
import { asSeverity, type Severity } from "@/features/rules/severity";
import { displayName, userNames } from "@/lib/display-name";

/**
 * Read model for the Rules tab of the Rules page: workspace rules with their
 * versions, and the legal reference library they cite. (The Products tab
 * reads from features/products/server/queries.) Every read goes through
 * the user-context client, so RLS limits it to the active workspace.
 * Server Components calling these read cookies(), so render them inside
 * <Suspense>.
 */

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

function kind(v: unknown): RuleKind {
  return v === "regulatory" || v === "policy" || v === "offer" || v === "security" ? v : "policy";
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
    defaultSeverity: asSeverity(v.default_severity),
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

  // Stable order (kind, then code) whether a rule is on or off: turning one
  // off must not make it jump to the bottom of the list under your cursor.
  const kindOrder: Record<RuleKind, number> = { regulatory: 0, offer: 1, policy: 2, security: 3 };
  out.sort((a, b) => {
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
    defaultSeverity: asSeverity(v.default_severity),
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
