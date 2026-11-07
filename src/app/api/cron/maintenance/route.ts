import { timingSafeEqual } from "node:crypto";

import { hasAdapter } from "@/features/connections/providers/registry";
import { runConnectionSync } from "@/features/connections/server/sync";
import { expireLapsedAds } from "@/features/ads/server/lifecycle";
import { revokeDisconnectedNangoConnections } from "@/features/connections/server/connections";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/cron/maintenance   (Vercel Cron, daily on Hobby; see vercel.json)
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET`. Without CRON_SECRET the
 * route refuses every call (fails closed). Each run, within the 60 s limit:
 *   1. recover_stale_syncs(): closes sync runs killed by a timeout and moves
 *      their connections out of 'syncing'.
 *   2. Revokes the Nango grants of every 'disconnected' connection that still
 *      has one (nango_revoked_at null), e.g. after remove_member /
 *      leave_profile were called directly through the Data API.
 *   3. Deletes webhook_receipts older than 7 days.
 *   4. Expiry: live ads whose end date passed go back to Needs review,
 *      tagged Expired (src/features/ads/server/lifecycle.ts).
 *   5. Spends the remaining time on one sync pass for the connection that has
 *      waited longest (unfinished backfills first: last_synced_at null).
 */

export const maxDuration = 60;

const BUDGET_MS = 55_000;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(header);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) {
    if (!process.env.CRON_SECRET) console.warn("[cron/maintenance] CRON_SECRET is not set; refusing.");
    return json({ error: "unauthorized" }, 401);
  }
  const startedAt = Date.now();
  const admin = createSupabaseAdminClient();
  if (!admin) return json({ error: "not configured" }, 503);

  const summary: Record<string, unknown> = {};

  const { data: reset, error: recoverError } = await admin.rpc("recover_stale_syncs", {
    p_stale_after: "5 minutes",
  });
  summary.stale_syncs_reset = recoverError ? `error ${recoverError.code}` : reset;

  summary.nango_revoked = await revokeDisconnectedNangoConnections({ limit: 50 });

  const { error: receiptsError, count } = await admin
    .from("webhook_receipts")
    .delete({ count: "exact" })
    .lt("received_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());
  summary.webhook_receipts_deleted = receiptsError ? `error ${receiptsError.code}` : (count ?? 0);

  const expiry = await expireLapsedAds({ limit: 500 });
  summary.expired = expiry.skipped ? { expired: expiry.expired, skipped: expiry.skipped } : expiry.expired;

  const remaining = BUDGET_MS - (Date.now() - startedAt);
  if (remaining > 20_000) {
    const { data: next } = await admin
      .from("connections")
      .select("id, provider")
      .eq("status", "connected")
      .order("last_synced_at", { ascending: true, nullsFirst: true })
      .limit(5);
    const target = ((next ?? []) as { id: string; provider: string }[]).find((c) => hasAdapter(c.provider));
    if (target) {
      const result = await runConnectionSync(target.id, { timeBudgetMs: remaining - 8_000 });
      summary.sync = {
        connection_id: target.id,
        ok: result.ok,
        status: result.status,
        has_more: result.hasMore,
        skipped: result.skipped ?? null,
      };
    }
  }

  return json({ ok: true, ...summary, duration_ms: Date.now() - startedAt });
}
