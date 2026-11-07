"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { refresh } from "next/cache";
import { z } from "zod";

import { getMembershipRole } from "@/lib/auth/dal";
import { requireSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseContext, type AppSupabaseContext } from "@/lib/supabase/context";
import type { Json } from "@/lib/supabase/types";

/**
 * Rules Server Actions. The user-context client (RLS) proves membership by
 * reading the rule first; the secret-key client then writes, because
 * `authenticated` has no INSERT on rule_versions and no UPDATE on rules.
 * Every write records the actor (author_id on versions, actor_id on events).
 */

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

type Input = FormData | Record<string, unknown>;

const id = z.guid({ error: "Invalid id." });
const severity = z.enum(["critical", "major", "minor"], { error: "Choose a severity." });
const appliesTo = z.preprocess(
  (v) => {
    if (Array.isArray(v)) return v;
    if (typeof v === "string") {
      try {
        const parsed: unknown = JSON.parse(v);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // comma-separated fallback
      }
      return v.split(",").map((s) => s.trim()).filter(Boolean);
    }
    return v;
  },
  z
    .array(z.string().trim().min(1).max(40))
    .min(1, { error: "Choose at least one product." })
    .max(10),
);
const referenceIds = z.preprocess(
  (v) => {
    if (Array.isArray(v)) return v;
    if (typeof v === "string") {
      try {
        const parsed: unknown = JSON.parse(v);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // comma-separated fallback
      }
      return v.split(",").map((s) => s.trim()).filter(Boolean);
    }
    return v ?? [];
  },
  z.array(z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/, { error: "Invalid source id." })).max(20),
);
const reason = z
  .string({ error: "Say why you are changing this rule." })
  .trim()
  .min(3, { error: "Say why you are changing this rule (a few words)." })
  .max(500, { error: "Keep the reason under 500 characters." });
const title = z
  .string({ error: "Give the rule a title." })
  .trim()
  .min(1, { error: "Give the rule a title." })
  .max(200, { error: "Keep the title under 200 characters." });
const body = z
  .string({ error: "Describe what the rule checks." })
  .trim()
  .min(1, { error: "Describe what the rule checks." })
  .max(20000, { error: "Keep the rule under 20,000 characters." });

const setActiveSchema = z.object({
  ruleId: id,
  active: z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean()),
});
const editSchema = z.object({
  ruleId: id,
  title,
  body,
  severity,
  appliesTo,
  reason,
});
const addSchema = z.object({
  profileId: id,
  code: z
    .string({ error: "Give the rule a short code." })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_.-]{0,39}$/, { error: "Codes use letters, numbers, dots, dashes or underscores (max 40)." }),
  kind: z.enum(["regulatory", "policy", "offer", "security"]).default("policy"),
  title,
  body,
  severity,
  appliesTo,
  referenceIds,
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

function invalid(error: z.ZodError): { ok: false; error: string; code: string } {
  return { ok: false, error: error.issues[0]?.message ?? "Check the form and try again.", code: "invalid_input" };
}

const SIGNED_OUT = { ok: false as const, error: "Your session has expired. Sign in again.", code: "unauthenticated" };
const NOT_FOUND = { ok: false as const, error: "Rule not found.", code: "PT404" };

/** The database says "profile"; people see "workspace". */
function plain(message: string): string {
  const text = message
    .replace(/\bprofiles?\b/g, (w) => (w.endsWith("s") ? "workspaces" : "workspace"))
    .replace(/\bProfiles?\b/g, (w) => (w.endsWith("s") ? "Workspaces" : "Workspace"))
    .trim();
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function dbFailure(where: string, error: PostgrestError): { ok: false; error: string; code?: string } {
  if (error.code === "23505") return { ok: false, error: "A rule with that code already exists in this workspace.", code: error.code };
  if (error.code === "PT409" || error.code === "PT422" || error.code === "42501") {
    return { ok: false, error: plain(error.message), code: error.code };
  }
  console.error(`[rules] ${where} failed:`, error.code, error.message);
  return { ok: false, error: "Something went wrong. Please try again.", code: error.code };
}

async function requireContext(): Promise<AppSupabaseContext | null> {
  const ctx = await getSupabaseContext();
  return ctx?.userClaims?.id ? ctx : null;
}

type RuleRow = { id: string; profile_id: string | null; code: string; active: boolean; current_version_id: string | null };

/** Loads a workspace rule under RLS and confirms the caller is a member of its workspace. */
async function loadOwnRule(ctx: AppSupabaseContext, ruleId: string): Promise<RuleRow | null> {
  const { data, error } = await ctx.supabase
    .from("rules")
    .select("id, profile_id, code, active, current_version_id")
    .eq("id", ruleId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as RuleRow;
  // Starter-library rules (profile_id null) are readable by everyone and never edited in place.
  if (!row.profile_id) return null;
  const role = await getMembershipRole(row.profile_id);
  return role ? row : null;
}

async function logEvent(profileId: string, actorId: string, kind: string, data: Record<string, unknown>): Promise<void> {
  const admin = requireSupabaseAdminClient();
  const { error } = await admin.from("events").insert({ profile_id: profileId, actor_id: actorId, kind, data: data as Json });
  if (error) console.error("[rules] event insert failed:", error.code, error.message);
}

/** Turns a workspace rule on or off (rules.active). Plain column update. */
export async function setRuleActive(input: Input): Promise<ActionResult<{ active: boolean }>> {
  const parsed = setActiveSchema.safeParse(toObject(input));
  if (!parsed.success) return invalid(parsed.error);
  const ctx = await requireContext();
  if (!ctx) return SIGNED_OUT;
  const rule = await loadOwnRule(ctx, parsed.data.ruleId);
  if (!rule?.profile_id) return NOT_FOUND;

  const admin = requireSupabaseAdminClient();
  const { error } = await admin
    .from("rules")
    .update({ active: parsed.data.active })
    .eq("id", rule.id)
    .eq("profile_id", rule.profile_id);
  if (error) return dbFailure("setRuleActive", error);

  await logEvent(rule.profile_id, ctx.userClaims!.id, parsed.data.active ? "rule.enabled" : "rule.disabled", {
    rule_id: rule.id,
    code: rule.code,
  });
  refresh();
  return { ok: true, data: { active: parsed.data.active } };
}

/**
 * Edits a rule by inserting a new immutable rule_versions row (title, body,
 * severity, applies_to, required reason). The database trigger moves
 * rules.current_version_id. Reference ids are carried over from the
 * current version.
 */
export async function editRule(input: Input): Promise<ActionResult<{ versionId: string; versionNo: number }>> {
  const parsed = editSchema.safeParse(toObject(input));
  if (!parsed.success) return invalid(parsed.error);
  const ctx = await requireContext();
  if (!ctx) return SIGNED_OUT;
  const rule = await loadOwnRule(ctx, parsed.data.ruleId);
  if (!rule?.profile_id) return NOT_FOUND;

  let referenceIds: string[] = [];
  let metadata: Json = {};
  if (rule.current_version_id) {
    const { data: cur } = await ctx.supabase
      .from("rule_versions")
      .select("reference_ids, metadata, title, body, default_severity, applies_to")
      .eq("id", rule.current_version_id)
      .maybeSingle();
    const c = cur as { reference_ids: string[]; metadata: Json; title: string; body: string; default_severity: string; applies_to: string[] } | null;
    if (c) {
      referenceIds = c.reference_ids ?? [];
      metadata = c.metadata ?? {};
      const same =
        c.title === parsed.data.title &&
        c.body === parsed.data.body &&
        c.default_severity === parsed.data.severity &&
        JSON.stringify([...c.applies_to].sort()) === JSON.stringify([...parsed.data.appliesTo].sort());
      if (same) return { ok: false, error: "Nothing changed. Edit the rule before saving a new version.", code: "unchanged" };
    }
  }

  const admin = requireSupabaseAdminClient();
  // version_no is assigned by the insert trigger; the generated types mark it
  // required because the column is NOT NULL, so the insert is cast.
  const insert = {
    rule_id: rule.id,
    profile_id: rule.profile_id,
    title: parsed.data.title,
    body: parsed.data.body,
    default_severity: parsed.data.severity,
    applies_to: parsed.data.appliesTo,
    reference_ids: referenceIds,
    metadata,
    reason: parsed.data.reason,
    author_id: ctx.userClaims!.id,
  };
  const { data, error } = await admin
    .from("rule_versions")
    .insert(insert as never)
    .select("id, version_no")
    .single();
  if (error) return dbFailure("editRule", error);
  const row = data as { id: string; version_no: number };

  await logEvent(rule.profile_id, ctx.userClaims!.id, "rule.edited", {
    rule_id: rule.id,
    code: rule.code,
    rule_version_id: row.id,
    version_no: row.version_no,
    reason: parsed.data.reason,
  });
  refresh();
  return { ok: true, data: { versionId: row.id, versionNo: row.version_no } };
}

/** Adds a workspace rule: a rules row plus its first version. */
export async function addRule(input: Input): Promise<ActionResult<{ ruleId: string }>> {
  const parsed = addSchema.safeParse(toObject(input));
  if (!parsed.success) return invalid(parsed.error);
  const ctx = await requireContext();
  if (!ctx) return SIGNED_OUT;
  const role = await getMembershipRole(parsed.data.profileId);
  if (!role) return { ok: false, error: "Workspace not found.", code: "PT404" };
  const userId = ctx.userClaims!.id;
  const { profileId } = parsed.data;

  const admin = requireSupabaseAdminClient();
  const { data: created, error } = await admin
    .from("rules")
    .insert({ profile_id: profileId, code: parsed.data.code, kind: parsed.data.kind, active: true })
    .select("id")
    .single();
  if (error) return dbFailure("addRule", error);
  const ruleId = (created as { id: string }).id;

  const insert = {
    rule_id: ruleId,
    profile_id: profileId,
    title: parsed.data.title,
    body: parsed.data.body,
    default_severity: parsed.data.severity,
    applies_to: parsed.data.appliesTo,
    reference_ids: parsed.data.referenceIds,
    metadata: {},
    reason: parsed.data.reason,
    author_id: userId,
  };
  const { error: vErr } = await admin.from("rule_versions").insert(insert as never);
  if (vErr) {
    // Leave no rule without a version: the identity row is harmless to remove
    // (nothing references it yet) and otherwise the code would be taken.
    await admin.from("rules").delete().eq("id", ruleId).eq("profile_id", profileId).is("current_version_id", null);
    return dbFailure("addRule.version", vErr);
  }

  await logEvent(profileId, userId, "rule.added", { rule_id: ruleId, code: parsed.data.code, kind: parsed.data.kind });
  refresh();
  return { ok: true, data: { ruleId } };
}
