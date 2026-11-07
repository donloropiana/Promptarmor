import { connection } from "next/server";

import { MODELS } from "@/lib/ai/budget";
import { getAiMode } from "@/lib/ai/mode";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/health
 *
 * Deployment smoke check. Returns booleans only for secrets (never values):
 * which env vars are present, whether the database answers with the service
 * role, and whether the core tables exist. The AI block says which mode the
 * server runs in (live | off | replay, docs/ai-policy.md) and which check
 * model it would use; neither is a secret. Safe to leave public.
 */

const CORE_TABLES = ["profiles", "profile_members", "assets", "asset_versions", "analysis_runs", "findings", "rules", "offers"] as const;

function present(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export async function GET(): Promise<Response> {
  await connection();
  const env = {
    SUPABASE_URL: present("SUPABASE_URL") || present("NEXT_PUBLIC_SUPABASE_URL"),
    SUPABASE_PUBLISHABLE_KEY: present("SUPABASE_PUBLISHABLE_KEY") || present("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    SUPABASE_SECRET_KEY: present("SUPABASE_SECRET_KEY"),
    NANGO_SECRET_KEY: present("NANGO_SECRET_KEY"),
    NANGO_WEBHOOK_SIGNING_KEY: present("NANGO_WEBHOOK_SIGNING_KEY"),
    AI_GATEWAY: present("AI_GATEWAY_API_KEY") || present("VERCEL_OIDC_TOKEN") || process.env.VERCEL === "1",
  };

  const db = { reachable: false, tables_present: false };
  const admin = createSupabaseAdminClient();
  if (admin) {
    try {
      const checks = await Promise.all(
        CORE_TABLES.map(async (table) => {
          const { error } = await admin.from(table).select("*", { count: "exact", head: true }).limit(1);
          return !error;
        }),
      );
      db.reachable = checks.some(Boolean);
      db.tables_present = checks.every(Boolean);
    } catch {
      db.reachable = false;
    }
  }

  const mode = getAiMode();
  const ai = {
    mode,
    model_calls: mode === "live",
    check_model: MODELS.check,
    check_model_overridden: Boolean(process.env.AI_CHECK_MODEL?.trim()),
  };

  const ok = Object.values(env).every(Boolean) && db.reachable && db.tables_present;
  return Response.json(
    { ok, env, db, ai, time: new Date().toISOString() },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
