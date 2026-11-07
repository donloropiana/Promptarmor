/**
 * Retires test ads in one workspace.
 *
 *   doppler run -p promptarmor -c prd -- bun scripts/cleanup-workspace.ts <profile-id> [--dry-run] [--include-samples=false]
 *
 * Targets every asset in the workspace whose title starts with "[test]"
 * (case-insensitive, with or without a trailing space) OR whose audience is
 * 'sample', and that is NOT approved: status not in approved /
 * approved_with_exceptions / re_review_due and approved_version_id null
 * (the database refuses 'withdrawn' on an asset that still points at an
 * approved version). Each one gets status 'withdrawn' and audience
 * 'sample_cleared', which hides it from every list and count. Nothing is
 * deleted: versions, checks, findings and events stay for the audit trail.
 *
 * Uses the secret-key client directly (SUPABASE_URL + SUPABASE_SECRET_KEY),
 * so it runs with plain `bun` and no --conditions flag. Prints counts; with
 * --dry-run it prints what it would do and writes nothing.
 *
 * Pass --include-samples=false to leave sample-audience ads alone and retire
 * only "[test]" titles.
 */

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type AssetRow = {
  id: string;
  title: string;
  status: string;
  audience: string | null;
  approved_version_id: string | null;
  created_at: string;
};

const APPROVED_STATUSES = new Set(["approved", "approved_with_exceptions", "re_review_due"]);
const TEST_TITLE_RE = /^\s*\[test\]/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function usage(message?: string): never {
  if (message) console.error(`Error: ${message}\n`);
  console.error("Usage: bun scripts/cleanup-workspace.ts <profile-id> [--dry-run] [--include-samples=false]");
  process.exit(2);
}

function parseArgs(argv: string[]): { profileId: string; dryRun: boolean; includeSamples: boolean } {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const flags = argv.filter((a) => a.startsWith("--"));
  const profileId = positional[0];
  if (!profileId) usage("a workspace (profile) id is required");
  if (!UUID_RE.test(profileId)) usage(`"${profileId}" is not a uuid`);
  const dryRun = flags.includes("--dry-run") || flags.includes("--dry");
  const includeSamplesFlag = flags.find((f) => f.startsWith("--include-samples"));
  const includeSamples = includeSamplesFlag ? !/=\s*(false|0|no)$/i.test(includeSamplesFlag) : true;
  for (const f of flags) {
    if (f !== "--dry-run" && f !== "--dry" && !f.startsWith("--include-samples")) usage(`unknown flag ${f}`);
  }
  return { profileId, dryRun, includeSamples };
}

function isTarget(a: AssetRow, includeSamples: boolean): { target: boolean; why: string } {
  const testTitle = TEST_TITLE_RE.test(a.title ?? "");
  const sample = includeSamples && a.audience === "sample";
  if (!testTitle && !sample) return { target: false, why: "" };
  return { target: true, why: testTitle && sample ? "[test] title + sample" : testTitle ? "[test] title" : "sample" };
}

function isRetirable(a: AssetRow): boolean {
  if (APPROVED_STATUSES.has(a.status)) return false;
  if (a.approved_version_id) return false;
  return true;
}

async function main() {
  const { profileId, dryRun, includeSamples } = parseArgs(process.argv.slice(2));

  const url = process.env.SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret) {
    console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required (run under `doppler run -p promptarmor -c prd --`).");
    process.exit(2);
  }
  const admin = createClient<Database>(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: profile, error: pErr } = await admin.from("profiles").select("id, name").eq("id", profileId).maybeSingle();
  if (pErr) throw new Error(`profile lookup failed: ${pErr.code} ${pErr.message}`);
  if (!profile) {
    console.error(`No workspace with id ${profileId}.`);
    process.exit(1);
  }

  const { data: rows, error } = await admin
    .from("assets")
    .select("id, title, status, audience, approved_version_id, created_at")
    .eq("profile_id", profileId)
    .neq("status", "withdrawn")
    .order("created_at", { ascending: true })
    .limit(2000);
  if (error) throw new Error(`asset lookup failed: ${error.code} ${error.message}`);

  const all = (rows ?? []) as AssetRow[];
  const targets = all.map((a) => ({ a, ...isTarget(a, includeSamples) })).filter((t) => t.target);
  const retire = targets.filter((t) => isRetirable(t.a));
  const keepApproved = targets.filter((t) => !isRetirable(t.a));

  console.log(`Workspace "${profile.name}" (${profile.id})`);
  console.log(`  ${all.length} active ad${all.length === 1 ? "" : "s"} scanned (withdrawn ones skipped)`);
  console.log(`  ${targets.length} match "[test]"${includeSamples ? " or sample audience" : ""}`);
  console.log(`  ${retire.length} to retire, ${keepApproved.length} left alone because approved`);

  for (const t of retire) {
    console.log(`  ${dryRun ? "would retire" : "retiring"}  ${t.a.id}  [${t.a.status}]  (${t.why})  ${t.a.title.slice(0, 70)}`);
  }
  for (const t of keepApproved) {
    console.log(`  keeping       ${t.a.id}  [${t.a.status}]  (${t.why}, approved)  ${t.a.title.slice(0, 70)}`);
  }

  if (dryRun) {
    console.log("\nDry run: nothing written.");
    return;
  }
  if (retire.length === 0) {
    console.log("\nNothing to retire.");
    return;
  }

  let retired = 0;
  let failed = 0;
  for (const t of retire) {
    // The status filter repeats the retirable check so a concurrent approval is never overwritten.
    const { data: updated, error: uErr } = await admin
      .from("assets")
      .update({ status: "withdrawn", audience: "sample_cleared" })
      .eq("id", t.a.id)
      .eq("profile_id", profileId)
      .is("approved_version_id", null)
      .not("status", "in", "(approved,approved_with_exceptions,re_review_due,withdrawn)")
      .select("id")
      .maybeSingle();
    if (uErr || !updated) {
      failed += 1;
      console.error(`  failed        ${t.a.id}  ${uErr ? `${uErr.code} ${uErr.message}` : "row changed underneath us; skipped"}`);
      continue;
    }
    retired += 1;
  }

  const { error: eErr } = await admin.from("events").insert({
    profile_id: profileId,
    asset_id: null,
    actor_id: null,
    kind: "workspace.test_ads_retired",
    data: { retired, failed, kept_approved: keepApproved.length, include_samples: includeSamples, asset_ids: retire.map((t) => t.a.id) },
  });
  if (eErr) console.warn(`  (event not logged: ${eErr.code} ${eErr.message})`);

  console.log(`\nRetired ${retired}, failed ${failed}, kept ${keepApproved.length} approved.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
