import { timingSafeEqual } from "node:crypto";

import { connection } from "next/server";

import { MODELS } from "@/lib/ai/budget";
import { getAiMode } from "@/lib/ai/mode";
import { getCurrentUser } from "@/lib/auth/dal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/health
 *
 * Deployment smoke check. Anonymous callers get `{ ok, time }` and nothing
 * else: which secrets exist, what the stack is made of and which model is in
 * use are not for the public internet. A signed-in user (any workspace
 * member, cookie session) or a caller with `Authorization: Bearer
 * $CRON_SECRET` gets the detail: booleans for secrets (which env vars are
 * present, never values), whether the database answers with the service
 * role, whether the core tables exist, the AI mode (live | off | replay,
 * docs/ai-policy.md) and the check model it would use.
 */

const CORE_TABLES = ["profiles", "profile_members", "assets", "asset_versions", "analysis_runs", "findings", "rules", "offers"] as const;

function present(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function hasCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(header);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function GET(request: Request): Promise<Response> {
  await connection();
  const headers = { "cache-control": "no-store", "x-robots-tag": "noindex" };

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

  const ok = Object.values(env).every(Boolean) && db.reachable && db.tables_present;
  const time = new Date().toISOString();

  let detailed = hasCronSecret(request);
  if (!detailed) {
    try {
      detailed = Boolean(await getCurrentUser());
    } catch {
      detailed = false;
    }
  }
  if (!detailed) {
    return Response.json({ ok, time }, { status: 200, headers });
  }

  const mode = getAiMode();
  const ai = {
    mode,
    model_calls: mode === "live",
    check_model: MODELS.check,
    check_model_overridden: Boolean(process.env.AI_CHECK_MODEL?.trim()),
  };
  return Response.json({ ok, env, db, ai, time }, { status: 200, headers });
}
