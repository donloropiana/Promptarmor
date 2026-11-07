/**
 * Creates (or finds) a throwaway workspace for write smoke tests, as the
 * signed-in test user, then seeds it with ensureWorkspaceDefaults (the same
 * call the app layout makes). Prints the profile id for dev-c-check.ts:
 *
 *   DEV_EMAIL=... DEV_PASSWORD=... doppler run -p promptarmor -c prd -- bun --conditions=react-server scripts/dev-c-throwaway.ts
 *
 * Remove it afterwards as operator: select private.purge_profile('<id>');
 */

import { createClient } from "@supabase/supabase-js";

import { ensureWorkspaceDefaults } from "../lib/seed";
import type { Database } from "../lib/supabase/database.types";

const NAME = "C smoke test (safe to purge)";

async function main() {
  const url = process.env.SUPABASE_URL!;
  const pub = process.env.SUPABASE_PUBLISHABLE_KEY!;
  const email = process.env.DEV_EMAIL!;
  const password = process.env.DEV_PASSWORD!;
  const anon = createClient<Database>(url, pub, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: signIn, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !signIn.session) throw new Error(`sign-in failed: ${error?.message}`);
  const user = createClient<Database>(url, pub, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${signIn.session.access_token}` } },
  });

  const { data: existing } = await user.from("profiles").select("id, name").eq("name", NAME).maybeSingle();
  let id = existing?.id;
  if (!id) {
    const { data, error: cErr } = await user.rpc("create_profile", { p_name: NAME });
    if (cErr) throw new Error(`create_profile failed: ${cErr.code} ${cErr.message}`);
    id = String(data);
    console.log("created", id);
  } else {
    console.log("reusing", id);
  }

  const t0 = Date.now();
  await ensureWorkspaceDefaults(id);
  console.log(`ensureWorkspaceDefaults ok in ${Date.now() - t0} ms`);
  const t1 = Date.now();
  await ensureWorkspaceDefaults(id);
  console.log(`second call (idempotent) in ${Date.now() - t1} ms`);

  const { count: rules } = await user.from("rules").select("id", { count: "exact", head: true }).eq("profile_id", id);
  const { count: offers } = await user.from("offers").select("id", { count: "exact", head: true }).eq("profile_id", id);
  console.log({ rules, offers });
  console.log(`DEV_PROFILE=${id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
