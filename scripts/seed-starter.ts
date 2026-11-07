/**
 * Operator seed: starter library, ClearPath workspace defaults, trusted flag.
 *
 * Run with real env from Doppler (the admin client needs SUPABASE_SECRET_KEY):
 *
 *   doppler run -p promptarmor -c prd -- bun --conditions=react-server scripts/seed-starter.ts
 *
 * `--conditions=react-server` makes the `server-only` marker resolve to its
 * empty build outside Next.js. Pass a different profile id as the first
 * argument to seed another workspace (it is not marked trusted unless you
 * also pass --trust).
 *
 * Idempotent: re-running inserts nothing that already exists and only adds a
 * starter rule version when the text in src/features/rules/starter-rules.ts changed.
 */
import { ensureWorkspaceDefaults, seedStarterLibrary, STARTER_PRODUCTS, STARTER_RULES } from "@/features/workspaces/server/seed";
import { requireSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";

const CLEARPATH_PROFILE_ID = "cf7d66e9-54d5-4b99-ac6f-89d760a20731";
const TRUSTED_SETTINGS = { ai_trusted: true, ai_daily_cap_usd: 5 };

async function main() {
  const args = process.argv.slice(2);
  const profileId = args.find((a) => !a.startsWith("--")) ?? CLEARPATH_PROFILE_ID;
  const trust = profileId === CLEARPATH_PROFILE_ID || args.includes("--trust");

  const admin = requireSupabaseAdminClient();

  console.log("Seeding starter library...");
  const lib = await seedStarterLibrary(admin);
  console.log(
    `  reference_library: ${lib.references} upserted · starter rules: ${lib.rules} inserted, ${lib.updated} updated, ${lib.total} defined`,
  );

  const { data: profile, error: pError } = await admin
    .from("profiles")
    .select("id, name, settings")
    .eq("id", profileId)
    .maybeSingle();
  if (pError) throw new Error(`profile lookup failed: ${pError.code} ${pError.message}`);
  if (!profile) throw new Error(`Profile ${profileId} does not exist.`);

  console.log(`Ensuring defaults for workspace "${profile.name}" (${profile.id})...`);
  await ensureWorkspaceDefaults(profileId, admin);

  if (trust) {
    const current =
      profile.settings && typeof profile.settings === "object" && !Array.isArray(profile.settings)
        ? (profile.settings as Record<string, unknown>)
        : {};
    const merged = { ...current, ...TRUSTED_SETTINGS } as Json;
    const { error: uError } = await admin.from("profiles").update({ settings: merged }).eq("id", profileId);
    if (uError) throw new Error(`profile settings update failed: ${uError.code} ${uError.message}`);
    console.log(`  settings: ai_trusted=true, ai_daily_cap_usd=${TRUSTED_SETTINGS.ai_daily_cap_usd}`);
  }

  // Read back and print counts so the run is verifiable.
  const [starters, refs, mineRules, mineVersions, offers, offerVersions, settings] = await Promise.all([
    admin.from("rules").select("id", { count: "exact", head: true }).is("profile_id", null),
    admin.from("reference_library").select("id", { count: "exact", head: true }),
    admin.from("rules").select("id", { count: "exact", head: true }).eq("profile_id", profileId),
    admin.from("rule_versions").select("id", { count: "exact", head: true }).eq("profile_id", profileId),
    admin.from("offers").select("code, product, name").eq("profile_id", profileId).order("code"),
    admin.from("offer_versions").select("id", { count: "exact", head: true }).eq("profile_id", profileId),
    admin.from("profiles").select("settings").eq("id", profileId).single(),
  ]);
  for (const r of [starters, refs, mineRules, mineVersions, offers, offerVersions, settings]) {
    if (r.error) throw new Error(`read-back failed: ${r.error.code} ${r.error.message}`);
  }

  console.log("Read-back:");
  console.log(`  starter rules (profile_id null): ${starters.count} (defined: ${STARTER_RULES.length})`);
  console.log(`  reference_library rows: ${refs.count}`);
  console.log(`  workspace rules: ${mineRules.count} · rule_versions: ${mineVersions.count}`);
  console.log(
    `  workspace offers: ${offers.data?.length ?? 0} (defined: ${STARTER_PRODUCTS.length}) · offer_versions: ${offerVersions.count}`,
  );
  for (const o of offers.data ?? []) console.log(`    ${o.code} · ${o.product} · ${o.name}`);
  console.log(`  settings: ${JSON.stringify(settings.data?.settings)}`);
}

main().catch((err) => {
  console.error("seed-starter failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
