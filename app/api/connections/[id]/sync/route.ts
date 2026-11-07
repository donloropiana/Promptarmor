import { after } from "next/server";
import { z } from "zod";

import { hasAdapter } from "@/lib/connectors/registry";
import { runConnectionSync } from "@/lib/connectors/sync";
import { getCurrentUser } from "@/lib/auth/dal";
import { revokeDisconnectedNangoConnections } from "@/lib/nango/connections";
import { authorizeMember, isSameOrigin, json } from "@/lib/nango/route-auth";
import { getSupabaseContext } from "@/lib/supabase/context";

/**
 * POST /api/connections/:id/sync   (id = connections.id, never a Nango id)
 *
 * "Sync now". Loads the connection with the user-context client (RLS: members
 * only), re-checks membership of the row's profile (JSON flavour of
 * requireMember), then runs one time-boxed sync pass with the secret-key
 * pipeline. Only the row's own Nango ids reach Nango. When `hasMore` is true
 * the client calls again to continue (components/connections/sync-drain.ts).
 *
 * Only the member who connected the account, or a profile owner, may sync it
 * (same rule as DELETE): a sync spends that member's provider quota. A fully
 * caught-up connection is not re-synced within MIN_INTERVAL_MS.
 */

// Vercel Hobby: keep under the platform cap; the pipeline stops at ~45s.
export const maxDuration = 60;

const Id = z.guid();
const MIN_INTERVAL_MS = 60_000;

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!isSameOrigin(request)) return json({ error: "Cross-origin request rejected." }, 403);

  const { id } = await ctx.params;
  if (!Id.safeParse(id).success) return json({ error: "Connection not found." }, 404);

  const user = await getCurrentUser();
  if (!user) return json({ error: "Sign in to continue." }, 401);
  const supabase = (await getSupabaseContext())?.supabase;
  if (!supabase) return json({ error: "Sign in to continue." }, 401);

  const { data, error } = await supabase
    .from("connections")
    .select("id, profile_id, provider, status, connected_by, last_synced_at")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[connections/sync] lookup failed:", error.code, error.message);
    return json({ error: "Could not load the connection." }, 500);
  }
  const row = data as {
    id: string;
    profile_id: string;
    provider: string;
    status: string;
    connected_by: string | null;
    last_synced_at: string | null;
  } | null;
  if (!row) return json({ error: "Connection not found." }, 404);

  const auth = await authorizeMember(row.profile_id);
  if (!auth.ok) return auth.response;
  if (row.connected_by !== auth.user.id && auth.role !== "owner") {
    return json({ error: "Only the person who connected this account or an owner can sync it." }, 403);
  }

  // Grants of connections disconnected elsewhere are revoked after the response.
  after(() => revokeDisconnectedNangoConnections({ profileId: row.profile_id, limit: 10 }));

  if (row.status === "disconnected") {
    return json({ error: "This account is disconnected. Reconnect it to sync again." }, 409);
  }
  if (!hasAdapter(row.provider)) {
    return json({ error: "This source cannot be synced directly." }, 422);
  }
  const lastSynced = row.last_synced_at ? Date.parse(row.last_synced_at) : NaN;
  if (Number.isFinite(lastSynced) && Date.now() - lastSynced < MIN_INTERVAL_MS) {
    return json({ error: "This account was synced less than a minute ago.", skipped: "too_soon", hasMore: false }, 429);
  }

  const result = await runConnectionSync(row.id, {
    kind: "manual",
    timeBudgetMs: 45_000,
    triggeredBy: auth.user.id,
  });

  if (result.skipped === "already_running") {
    return json({ error: "A sync for this account is already running.", skipped: result.skipped }, 409);
  }
  if (result.skipped === "not_configured") {
    return json({ error: "Syncing is not configured on this deployment." }, 503);
  }
  if (result.skipped) {
    return json({ error: "This account cannot be synced right now.", skipped: result.skipped }, 409);
  }

  const s = result.stats;
  return json({
    ok: result.ok,
    syncRunId: result.syncRunId,
    kind: result.kind,
    status: result.status,
    hasMore: result.hasMore,
    stats: {
      new: s.new,
      modified: s.modified,
      duplicates: s.duplicates,
      skipped: s.skipped,
      errors: s.errors,
      unchanged: s.unchanged,
      gap: s.gap,
    },
    ...(result.ok ? {} : { error: result.status === "needs_reconnect" ? "Reconnect this account to resume syncing." : "The sync stopped early; see the sync log." }),
  });
}
