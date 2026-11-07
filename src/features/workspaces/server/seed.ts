import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/types";

import { STARTER_PRODUCTS } from "@/features/products/starter-products";
import { REFERENCE_LIBRARY, REFERENCES_VERIFIED_AS_OF, STARTER_RULES, type StarterRule } from "@/features/rules/starter-rules";

export { REFERENCE_LIBRARY, STARTER_RULES, STARTER_RULE_CODES } from "@/features/rules/starter-rules";
export { STARTER_PRODUCTS, STARTER_PRODUCT_CODES } from "@/features/products/starter-products";
export { SAMPLE_ADS, SAMPLE_KEYS, SAMPLE_CHIPS, FIXTURE_ADS, CHANNEL_LABELS, PRODUCT_LABELS, getSampleAd, isSampleKey } from "@/features/ads/samples";
export type { SampleAd } from "@/features/ads/samples";
export type { StarterRule, ReferenceEntry } from "@/features/rules/starter-rules";
export type { StarterProduct } from "@/features/products/starter-products";

/**
 * Seeding the starter library and a workspace's defaults.
 *
 * Both functions use the service-role client (they write rows no user may
 * write directly: starter rules with profile_id null, offers and versions).
 * Neither throws on "already there": they are idempotent and safe to re-run.
 *
 * ensureWorkspaceDefaults is cheap enough to call on every workspace page
 * load: two count queries, and nothing else when the workspace is complete.
 */

type Admin = SupabaseClient<Database>;

const STARTER_REASON = "starter library";
const STARTER_UPDATE_REASON = "starter library update";
const PRODUCTS_REASON = "starter products";

/** YYYY-MM-DD in UTC (offer_versions.effective_from is a date). */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

type StarterVersionRow = {
  id: string;
  rule_id: string;
  version_no: number;
  title: string;
  applies_to: string[];
  default_severity: string;
  body: string;
  reference_ids: string[];
  metadata: Json;
};

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`)
    .join(",")}}`;
}

/** True when the starter definition differs from the stored current version. */
function versionDiffers(rule: StarterRule, v: StarterVersionRow): boolean {
  return (
    rule.title !== v.title ||
    rule.body !== v.body ||
    rule.default_severity !== v.default_severity ||
    stableJson(rule.applies_to) !== stableJson(v.applies_to) ||
    stableJson(rule.reference_ids) !== stableJson(v.reference_ids) ||
    stableJson(rule.metadata ?? {}) !== stableJson(v.metadata ?? {})
  );
}

/**
 * Operator seed. Upserts the reference library by id, inserts every starter
 * rule (profile_id null) the database lacks with one rule_version each
 * (reason 'starter library'), and adds a new version to a starter rule whose
 * stored text no longer matches this file (reason 'starter library update').
 * Workspaces keep their own cloned copies; they are not touched here.
 */
export async function seedStarterLibrary(
  client?: Admin,
): Promise<{ rules: number; references: number; updated: number; total: number }> {
  const admin = client ?? requireSupabaseAdminClient();

  // 1. Reference library (global, read-only for users).
  const { error: refError } = await admin.from("reference_library").upsert(
    REFERENCE_LIBRARY.map((r) => ({
      id: r.id,
      label: r.label,
      citation: r.citation,
      url: r.url,
      summary: r.summary,
      verified_as_of: REFERENCES_VERIFIED_AS_OF,
    })),
    { onConflict: "id" },
  );
  if (refError) throw new Error(`reference_library upsert failed: ${refError.code} ${refError.message}`);

  // 2. Existing starter rules and their current versions.
  const { data: existingRules, error: rulesError } = await admin
    .from("rules")
    .select("id, code, kind, active, current_version_id")
    .is("profile_id", null);
  if (rulesError) throw new Error(`rules select failed: ${rulesError.code} ${rulesError.message}`);

  const byCode = new Map((existingRules ?? []).map((r) => [r.code, r]));
  const currentVersionIds = (existingRules ?? [])
    .map((r) => r.current_version_id)
    .filter((id): id is string => typeof id === "string");

  const versionsById = new Map<string, StarterVersionRow>();
  if (currentVersionIds.length > 0) {
    const { data: versions, error: vError } = await admin
      .from("rule_versions")
      .select("id, rule_id, version_no, title, applies_to, default_severity, body, reference_ids, metadata")
      .in("id", currentVersionIds);
    if (vError) throw new Error(`rule_versions select failed: ${vError.code} ${vError.message}`);
    for (const v of versions ?? []) versionsById.set(v.id, v as StarterVersionRow);
  }

  let inserted = 0;
  let updated = 0;

  for (const rule of STARTER_RULES) {
    const existing = byCode.get(rule.code);
    let ruleId = existing?.id;
    let nextVersionNo = 1;
    let needsVersion = false;
    let reason = STARTER_REASON;

    if (!existing) {
      const { data: created, error } = await admin
        .from("rules")
        .insert({ profile_id: null, code: rule.code, kind: rule.kind, active: true })
        .select("id")
        .single();
      if (error) {
        if (isUniqueViolation(error)) continue; // a concurrent seed won the race
        throw new Error(`rules insert failed for ${rule.code}: ${error.code} ${error.message}`);
      }
      ruleId = created.id;
      needsVersion = true;
      inserted += 1;
    } else if (!existing.current_version_id) {
      // A rule row without a version (an interrupted earlier seed): repair it.
      needsVersion = true;
    } else {
      const current = versionsById.get(existing.current_version_id);
      if (current && versionDiffers(rule, current)) {
        needsVersion = true;
        nextVersionNo = current.version_no + 1;
        reason = STARTER_UPDATE_REASON;
        updated += 1;
      }
    }

    if (!needsVersion || !ruleId) continue;
    const { error: vInsertError } = await admin.from("rule_versions").insert({
      rule_id: ruleId,
      version_no: nextVersionNo,
      title: rule.title,
      applies_to: rule.applies_to as string[],
      default_severity: rule.default_severity,
      body: rule.body,
      reference_ids: rule.reference_ids,
      metadata: (rule.metadata ?? {}) as Json,
      reason,
      author_id: null,
    });
    if (vInsertError) {
      throw new Error(`rule_versions insert failed for ${rule.code}: ${vInsertError.code} ${vInsertError.message}`);
    }
  }

  return { rules: inserted, references: REFERENCE_LIBRARY.length, updated, total: STARTER_RULES.length };
}

/**
 * Idempotent workspace defaults. Clones every active starter rule the
 * workspace lacks (rules.cloned_from + a copy of the starter's current
 * version, reason 'starter library'), then creates the ClearPath starter
 * products with one offer_version each (reason 'starter products') when the
 * workspace has no offers at all. Safe to call on every workspace page load.
 *
 * The clone_starter_rules RPC needs an authenticated caller, so this
 * replicates it with the service-role client. Callers must have confirmed
 * membership (or be operator code) before passing a profile id.
 */
export async function ensureWorkspaceDefaults(profileId: string, client?: Admin): Promise<void> {
  const admin = client ?? requireSupabaseAdminClient();

  // Cheap existence checks first (the hot path on page loads).
  const [{ count: ruleCount, error: rcError }, { count: offerCount, error: ocError }] = await Promise.all([
    admin.from("rules").select("id", { count: "exact", head: true }).eq("profile_id", profileId),
    admin.from("offers").select("id", { count: "exact", head: true }).eq("profile_id", profileId),
  ]);
  if (rcError) throw new Error(`rules count failed: ${rcError.code} ${rcError.message}`);
  if (ocError) throw new Error(`offers count failed: ${ocError.code} ${ocError.message}`);

  const rulesComplete = (ruleCount ?? 0) >= STARTER_RULES.length;
  const offersComplete = (offerCount ?? 0) > 0;
  if (rulesComplete && offersComplete) return;

  if (!rulesComplete) await cloneMissingStarterRules(admin, profileId);
  if (!offersComplete) await createStarterProducts(admin, profileId);
}

async function cloneMissingStarterRules(admin: Admin, profileId: string): Promise<void> {
  const [{ data: starters, error: sError }, { data: mine, error: mError }] = await Promise.all([
    admin.from("rules").select("id, code, kind, active, current_version_id").is("profile_id", null).eq("active", true),
    admin.from("rules").select("id, code, cloned_from, current_version_id").eq("profile_id", profileId),
  ]);
  if (sError) throw new Error(`starter rules select failed: ${sError.code} ${sError.message}`);
  if (mError) throw new Error(`workspace rules select failed: ${mError.code} ${mError.message}`);

  const haveCodes = new Set((mine ?? []).map((r) => r.code));
  const haveClonedFrom = new Set((mine ?? []).map((r) => r.cloned_from).filter(Boolean));
  const missing = (starters ?? []).filter(
    (s) => s.current_version_id && !haveCodes.has(s.code) && !haveClonedFrom.has(s.id),
  );
  // Rows cloned earlier whose version insert never happened: repair them.
  const orphans = (mine ?? []).filter((r) => !r.current_version_id && r.cloned_from);

  const neededVersionIds = new Set<string>();
  for (const s of missing) if (s.current_version_id) neededVersionIds.add(s.current_version_id);
  const starterById = new Map((starters ?? []).map((s) => [s.id, s]));
  for (const o of orphans) {
    const src = o.cloned_from ? starterById.get(o.cloned_from) : undefined;
    if (src?.current_version_id) neededVersionIds.add(src.current_version_id);
  }
  if (neededVersionIds.size === 0) return;

  const { data: versions, error: vError } = await admin
    .from("rule_versions")
    .select("id, rule_id, version_no, title, applies_to, default_severity, body, reference_ids, metadata")
    .in("id", [...neededVersionIds]);
  if (vError) throw new Error(`starter rule_versions select failed: ${vError.code} ${vError.message}`);
  const versionById = new Map((versions ?? []).map((v) => [v.id, v as StarterVersionRow]));

  const clonedCodes: string[] = [];

  async function insertClonedVersion(ruleId: string, src: StarterVersionRow): Promise<boolean> {
    const metadata = {
      ...((src.metadata && typeof src.metadata === "object" && !Array.isArray(src.metadata)
        ? (src.metadata as Record<string, unknown>)
        : {}) as Record<string, unknown>),
      cloned_from_version_id: src.id,
    };
    const { error } = await admin.from("rule_versions").insert({
      rule_id: ruleId,
      version_no: 1,
      title: src.title,
      applies_to: src.applies_to,
      default_severity: src.default_severity,
      body: src.body,
      reference_ids: src.reference_ids,
      metadata: metadata as Json,
      reason: STARTER_REASON,
      author_id: null,
    });
    if (error) {
      // PT409: another request inserted version 1 first. Nothing to repair.
      if (error.code === "PT409") return false;
      throw new Error(`cloned rule_version insert failed: ${error.code} ${error.message}`);
    }
    return true;
  }

  for (const s of missing) {
    const src = s.current_version_id ? versionById.get(s.current_version_id) : undefined;
    if (!src) continue;
    const { data: created, error } = await admin
      .from("rules")
      .insert({ profile_id: profileId, code: s.code, kind: s.kind, active: true, cloned_from: s.id })
      .select("id")
      .single();
    if (error) {
      if (isUniqueViolation(error)) continue; // a concurrent page load cloned it first
      throw new Error(`rule clone failed for ${s.code}: ${error.code} ${error.message}`);
    }
    if (await insertClonedVersion(created.id, src)) clonedCodes.push(s.code);
  }

  for (const o of orphans) {
    const srcRule = o.cloned_from ? starterById.get(o.cloned_from) : undefined;
    const src = srcRule?.current_version_id ? versionById.get(srcRule.current_version_id) : undefined;
    if (!src) continue;
    if (await insertClonedVersion(o.id, src)) clonedCodes.push(o.code);
  }

  if (clonedCodes.length > 0) {
    const { error } = await admin.from("events").insert({
      profile_id: profileId,
      kind: "rules.cloned",
      data: { count: clonedCodes.length, codes: clonedCodes, source: STARTER_REASON } as Json,
    });
    if (error) console.warn("[seed] rules.cloned event not logged:", error.code, error.message);
  }
}

async function createStarterProducts(admin: Admin, profileId: string): Promise<void> {
  const effectiveFrom = todayUtc();
  const createdCodes: string[] = [];

  for (const p of STARTER_PRODUCTS) {
    const { data: offer, error } = await admin
      .from("offers")
      .insert({ profile_id: profileId, code: p.code, product: p.product, name: p.name, active: true })
      .select("id")
      .single();
    if (error) {
      if (isUniqueViolation(error)) continue; // concurrent page load
      throw new Error(`offer insert failed for ${p.code}: ${error.code} ${error.message}`);
    }
    const { error: vError } = await admin.from("offer_versions").insert({
      offer_id: offer.id,
      profile_id: profileId,
      version_no: 1,
      terms: p.terms as Json,
      effective_from: effectiveFrom,
      reason: PRODUCTS_REASON,
      author_id: null,
    });
    if (vError) throw new Error(`offer_version insert failed for ${p.code}: ${vError.code} ${vError.message}`);
    createdCodes.push(p.code);
  }

  if (createdCodes.length > 0) {
    const { error } = await admin.from("events").insert({
      profile_id: profileId,
      kind: "offers.seeded",
      data: { count: createdCodes.length, codes: createdCodes, source: PRODUCTS_REASON } as Json,
    });
    if (error) console.warn("[seed] offers.seeded event not logged:", error.code, error.message);
  }
}
