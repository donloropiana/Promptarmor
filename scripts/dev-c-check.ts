/**
 * Engineer C smoke test for the Rules / Settings read model and the
 * admin-side writes the Server Actions rely on. Runs against the live
 * database with Doppler env:
 *
 *   DEV_EMAIL=... DEV_PASSWORD=... doppler run -p promptarmor -c prd -- bun scripts/dev-c-check.ts
 *
 * Read-only unless --write is passed, in which case it inserts one rule
 * version and one offer version (both immutable, reason "dev-c smoke test")
 * on the ClearPath workspace and then reverts nothing (versions cannot be
 * deleted); use sparingly.
 */

import { createClient } from "@supabase/supabase-js";

import type { Database } from "../lib/supabase/database.types";

const url = process.env.SUPABASE_URL!;
const pub = process.env.SUPABASE_PUBLISHABLE_KEY!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const email = process.env.DEV_EMAIL;
const password = process.env.DEV_PASSWORD;
const PROFILE = process.env.DEV_PROFILE ?? "cf7d66e9-54d5-4b99-ac6f-89d760a20731";
const WRITE = process.argv.includes("--write");

function ok(label: string, cond: unknown, extra?: unknown) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra !== undefined ? ` · ${JSON.stringify(extra)}` : ""}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  if (!url || !pub || !secret) throw new Error("Missing SUPABASE_* env (run under doppler)");
  if (!email || !password) throw new Error("Set DEV_EMAIL and DEV_PASSWORD");

  // 1. Password sign-in -> user-context client (what RLS sees in the app).
  const anon = createClient<Database>(url, pub, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  ok("password sign-in", !signInErr && signIn.session, signInErr?.message);
  const token = signIn.session!.access_token;
  const userId = signIn.user!.id;
  const user = createClient<Database>(url, pub, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const admin = createClient<Database>(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  // 2. Membership + profiles (sidebar switcher).
  const { data: memberships, error: mErr } = await user
    .from("profile_members")
    .select("role, created_at, profiles(id, name)")
    .eq("user_id", userId);
  ok("getMyProfiles query", !mErr && (memberships?.length ?? 0) > 0, mErr?.message ?? memberships?.map((m) => m.profiles));

  // 3. Members with the FK hint (two FKs to users on profile_members).
  const { data: members, error: memErr } = await user
    .from("profile_members")
    .select("user_id, role, created_at, users!profile_members_user_id_fkey(id, email, full_name, avatar_url)")
    .eq("profile_id", PROFILE);
  ok("getMembers query (FK hint)", !memErr && (members?.length ?? 0) > 0, memErr?.message ?? members?.length);

  // 4. Invitations (owner-only RLS, named columns).
  const { data: inv, error: invErr } = await user
    .from("profile_invitations")
    .select("id, email, role, invited_by, created_at, expires_at, accepted_at, revoked_at")
    .eq("profile_id", PROFILE);
  ok("getPendingInvitations query", !invErr, invErr?.message ?? `${inv?.length} rows`);

  // 5. Rules + versions + references (Rules tab).
  const { data: rules, error: rErr } = await user
    .from("rules")
    .select("id, code, kind, active, cloned_from, current_version_id")
    .eq("profile_id", PROFILE);
  ok("getWorkspaceRules: rules", !rErr && (rules?.length ?? 0) > 0, rErr?.message ?? `${rules?.length} rules`);
  const ruleIds = (rules ?? []).map((r) => r.id);
  const { data: versions, error: vErr } = await user
    .from("rule_versions")
    .select("id, rule_id, version_no, title, body, default_severity, applies_to, reference_ids, reason, author_id, created_at")
    .in("rule_id", ruleIds)
    .order("version_no", { ascending: false });
  ok("getWorkspaceRules: versions", !vErr && (versions?.length ?? 0) >= (rules?.length ?? 0), vErr?.message ?? `${versions?.length} versions`);
  const refIds = [...new Set((versions ?? []).flatMap((v) => v.reference_ids ?? []))];
  const { data: refs, error: refErr } = await user.from("reference_library").select("id, label, citation, url, summary").in("id", refIds);
  ok("reference_library readable", !refErr, refErr?.message ?? `${refs?.length}/${refIds.length} refs found`);
  const missingRefs = refIds.filter((id) => !refs?.some((r) => r.id === id));
  ok("every rule reference_id exists in reference_library", missingRefs.length === 0, missingRefs);
  const withoutVersion = (rules ?? []).filter((r) => !r.current_version_id);
  ok("every rule has current_version_id", withoutVersion.length === 0, withoutVersion.map((r) => r.code));

  // 6. Offers + versions (Products tab).
  const { data: offers, error: oErr } = await user.from("offers").select("id, code, product, name, active").eq("profile_id", PROFILE);
  ok("getWorkspaceOffers: offers", !oErr && (offers?.length ?? 0) > 0, oErr?.message ?? offers?.map((o) => o.code));
  const { data: ov, error: ovErr } = await user
    .from("offer_versions")
    .select("id, offer_id, version_no, terms, effective_from, reason, author_id, created_at")
    .in("offer_id", (offers ?? []).map((o) => o.id))
    .order("version_no", { ascending: false });
  ok("getWorkspaceOffers: versions", !ovErr && (ov?.length ?? 0) >= (offers?.length ?? 0), ovErr?.message ?? `${ov?.length} versions`);
  const sampleTerms = ov?.[0]?.terms as Record<string, unknown> | undefined;
  ok("offer terms carry a summary", typeof sampleTerms?.summary === "string", sampleTerms ? Object.keys(sampleTerms) : null);

  // 7. Affected-approved-ads query shape (GIN contains on offer_version_ids).
  const firstVersionId = ov?.[0]?.id;
  if (firstVersionId) {
    const { data: runs, error: runErr } = await user
      .from("analysis_runs")
      .select("id, asset_version_id")
      .eq("profile_id", PROFILE)
      .contains("offer_version_ids", [firstVersionId]);
    ok("analysis_runs.contains(offer_version_ids)", !runErr, runErr?.message ?? `${runs?.length} runs used ${ov?.[0]?.version_no ? "V" + ov[0].version_no : "?"}`);
  }
  const { data: approved, error: aErr } = await user
    .from("assets")
    .select("id, title, status, approved_version_id, approved_decision_id")
    .eq("profile_id", PROFILE)
    .in("status", ["approved", "approved_with_exceptions"]);
  ok("approved assets query", !aErr, aErr?.message ?? `${approved?.length} approved`);

  // 8. Connections + sync runs (Connected accounts).
  const { data: conns, error: cErr } = await user
    .from("connections")
    .select("id, provider, account_email, status, last_synced_at, last_error, connected_by, created_at")
    .eq("profile_id", PROFILE)
    .neq("status", "disconnected");
  ok("connections query", !cErr, cErr?.message ?? `${conns?.length} live connections`);
  const { data: syncRuns, error: sErr } = await user
    .from("sync_runs")
    .select("id, connection_id, kind, started_at, finished_at, stats, error, connections(provider, account_email)")
    .eq("profile_id", PROFILE)
    .order("started_at", { ascending: false })
    .limit(5);
  ok("sync_runs with connections embed", !sErr, sErr?.message ?? `${syncRuns?.length} runs`);

  // 9. Events for the bell, budget status, sample count.
  const { data: events, error: eErr } = await user
    .from("events")
    .select("id, kind, data, actor_id, asset_id, created_at")
    .eq("profile_id", PROFILE)
    .in("kind", ["decision.recorded", "change_request.created", "version.created", "analysis.completed", "member.joined", "offer.changed"])
    .order("created_at", { ascending: false })
    .limit(10);
  ok("events query (bell)", !eErr, eErr?.message ?? events?.map((e) => e.kind));
  const { data: budget, error: bErr } = await user.rpc("ai_budget_status", { p_profile_id: PROFILE });
  ok("ai_budget_status rpc", !bErr && Array.isArray(budget) && budget.length === 1, bErr?.message ?? budget?.[0]);
  const { count: samples, error: smErr } = await user.from("assets").select("id", { count: "exact", head: true }).eq("profile_id", PROFILE).eq("audience", "sample");
  ok("sample count query", !smErr, smErr?.message ?? `${samples} samples`);
  const { data: pend, error: pErr } = await user.rpc("my_pending_invitations");
  ok("my_pending_invitations rpc", !pErr, pErr?.message ?? `${pend?.length} pending for me`);

  // 10. Audit export shape.
  const { data: decisions, error: dErr } = await user
    .from("decisions")
    .select("id, asset_id, asset_version_id, content_sha256, decision, approver_id, approver_email, exceptions, dismissed, rationale, self_approved, attested, manual_only, auth_method, analysis_run_id, created_at")
    .eq("profile_id", PROFILE)
    .limit(5);
  ok("decisions export query", !dErr, dErr?.message ?? `${decisions?.length} decisions`);

  // 11. Admin writes used by the actions (opt-in).
  if (WRITE) {
    const rule = (rules ?? []).find((r) => r.active) ?? rules?.[0];
    const cur = (versions ?? []).find((v) => v.id === rule?.current_version_id);
    if (rule && cur) {
      const { data: nv, error: nvErr } = await admin
        .from("rule_versions")
        .insert({
          rule_id: rule.id,
          profile_id: PROFILE,
          title: cur.title,
          body: `${cur.body}\n\n(dev-c smoke test edit)`,
          default_severity: cur.default_severity,
          applies_to: cur.applies_to,
          reference_ids: cur.reference_ids,
          metadata: {},
          reason: "dev-c smoke test",
          author_id: userId,
        } as never)
        .select("id, version_no")
        .single();
      ok("admin insert rule_versions (trigger assigns version_no)", !nvErr && nv, nvErr?.message ?? nv);
      const { data: after } = await admin.from("rules").select("current_version_id").eq("id", rule.id).single();
      ok("rules.current_version_id moved", after?.current_version_id === nv?.id);
      const { error: evErr } = await admin.from("events").insert({ profile_id: PROFILE, actor_id: userId, kind: "rule.edited", data: { rule_id: rule.id, test: true } });
      ok("admin insert events with actor_id", !evErr, evErr?.message);
      const { error: toggleErr } = await admin.from("rules").update({ active: rule.active }).eq("id", rule.id).eq("profile_id", PROFILE);
      ok("admin update rules.active", !toggleErr, toggleErr?.message);
    }
    const offer = offers?.[0];
    const curOv = (ov ?? []).find((v) => v.offer_id === offer?.id);
    if (offer && curOv) {
      const { data: nov, error: novErr } = await admin
        .from("offer_versions")
        .insert({ offer_id: offer.id, profile_id: PROFILE, terms: curOv.terms, reason: "dev-c smoke test", author_id: userId } as never)
        .select("id, version_no")
        .single();
      ok("admin insert offer_versions (trigger assigns version_no)", !novErr && nov, novErr?.message ?? nov);
    }
  } else {
    console.log("skip  admin writes (pass --write to exercise rule/offer version inserts)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
