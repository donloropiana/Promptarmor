/**
 * Dev helper: creates an ad in a workspace as a given user, then runs the
 * check on it and prints what happened. Uses the service-role client, so it
 * needs the real env from Doppler:
 *
 *   doppler run -p promptarmor -c prd -- bun --conditions=react-server scripts/dev-create-ad.ts \
 *     --profile cf7d66e9-54d5-4b99-ac6f-89d760a20731 \
 *     --user 88b5b90e-3f4b-46a2-8c50-333240cbb671 \
 *     [--text "..." | --file ./ad.pdf | --sample paid-social-personal-loan] [--no-run] [--revision] [--seed]
 *
 * --seed first runs seedStarterLibrary() and ensureWorkspaceDefaults(profile)
 * (lib/seed) so the workspace has rules and products to check against.
 *
 * `--conditions=react-server` makes bun treat "server-only" as a no-op
 * (the same resolution Next.js uses for server code).
 *
 * Without AI_GATEWAY_API_KEY the model call fails; this script shows the
 * failure path: run failed with a plain-English error, asset
 * needs_manual_review.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { runAnalysis } from "@/lib/ai/engine";
import { createAd, createSampleAd, simulateRevision } from "@/lib/intake/ads";
import { ensureWorkspaceDefaults, seedStarterLibrary } from "@/lib/seed";
import { requireSupabaseAdminClient } from "@/lib/supabase/admin";

const DEFAULT_TEXT = `Subject: Consolidate your debt with a ClearPath personal loan

Rates as low as 5.99% APR with no fees ever. Borrow up to $75,000 and pay it off over up to 10 years.
Guaranteed approval in minutes, no credit check required.

Apply now at clearpath.example/apply`;

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "";
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const profileId = arg("profile");
  const userId = arg("user");
  if (!profileId || !userId) {
    console.error("Usage: --profile <profile uuid> --user <user uuid> [--text ... | --file path | --sample key] [--no-run] [--revision]");
    process.exit(2);
  }

  const admin = requireSupabaseAdminClient();
  if (flag("seed")) {
    console.log("seed", await seedStarterLibrary());
    await ensureWorkspaceDefaults(profileId);
    const { count: ruleCount } = await admin.from("rules").select("id", { count: "exact", head: true }).eq("profile_id", profileId);
    const { count: offerCount } = await admin.from("offers").select("id", { count: "exact", head: true }).eq("profile_id", profileId);
    console.log(`workspace has ${ruleCount ?? 0} rules and ${offerCount ?? 0} products`);
  }
  const sample = arg("sample");
  const file = arg("file");
  const text = arg("text");

  let created: { assetId: string; versionId: string };
  if (sample) {
    created = await createSampleAd({ profileId, userId, sampleKey: sample });
  } else if (file) {
    const bytes = new Uint8Array(await readFile(path.resolve(file)));
    created = await createAd({ profileId, userId, origin: "upload", file: { name: path.basename(file), bytes, mimeType: "" } });
  } else {
    created = await createAd({ profileId, userId, origin: "paste", text: text || DEFAULT_TEXT });
  }
  console.log("created", created);

  const { data: asset } = await admin.from("assets").select("id, title, product, channel, status, submitted_at").eq("id", created.assetId).single();
  console.log("asset", asset);

  let versionId = created.versionId;
  if (flag("revision")) {
    const rev = await simulateRevision({ assetId: created.assetId, userId });
    console.log("revision", rev);
    versionId = rev.versionId;
  }

  const { data: runs } = await admin.from("analysis_runs").select("id, status, stage").eq("asset_version_id", versionId);
  console.log("queued runs", runs);

  if (flag("no-run")) return;
  for (const run of runs ?? []) {
    if (run.status !== "queued") continue;
    const started = Date.now();
    await runAnalysis(run.id);
    const { data: done } = await admin
      .from("analysis_runs")
      .select("id, status, stage, error, model, prompt_hash, input_tokens, output_tokens, cost_usd, coverage")
      .eq("id", run.id)
      .single();
    console.log(`run finished in ${((Date.now() - started) / 1000).toFixed(1)}s`, done);
    const { data: findings } = await admin
      .from("findings")
      .select("severity, evidence_type, quote, verified_span, anchor, suggested_copy, recheck_status, rule_version_id")
      .eq("analysis_run_id", run.id);
    console.log("findings", findings);
    const { data: alerts } = await admin.from("security_alerts").select("kind, excerpt, location").eq("asset_version_id", versionId);
    console.log("alerts", alerts);
  }
  const { data: after } = await admin.from("assets").select("status").eq("id", created.assetId).single();
  console.log("asset status after run", after?.status);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
