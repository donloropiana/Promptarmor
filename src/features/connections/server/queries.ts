import "server-only";

import { cache } from "react";

import { requireMember, type Membership } from "@/features/auth/server/dal";
import { getMembers } from "@/features/workspaces/server/queries";
import type { Json } from "@/lib/supabase/types";
import { INTEGRATIONS, isIntegrationKey, type ProviderGroup } from "@/lib/nango/integrations";

/**
 * Read model for connected accounts: a workspace's live connections grouped
 * by the member who connected them, its sync log, and the providers the
 * current user has connected. Every read uses the user-context client (RLS),
 * so a workspace never sees another's rows. Server Components calling these
 * read cookies(): render inside <Suspense>.
 */

export type ConnectionSummary = {
  id: string;
  provider: string;
  providerLabel: string;
  group: ProviderGroup | null;
  accountEmail: string | null;
  status: "connected" | "syncing" | "needs_reconnect" | "error" | "disconnected";
  lastSyncedAt: string | null;
  lastError: string | null;
  connectedBy: string | null;
  createdAt: string;
};

export type MemberConnections = {
  userId: string | null;
  name: string;
  email: string | null;
  isMe: boolean;
  connections: ConnectionSummary[];
};

export type SyncRunRow = {
  id: string;
  connectionId: string;
  providerLabel: string;
  accountEmail: string | null;
  kind: string;
  startedAt: string;
  finishedAt: string | null;
  stats: Record<string, unknown>;
  error: string | null;
};

// Private copy of the display-name rule in workspaces/server/queries.ts; keep the two in step.
function nameOf(u: { full_name?: string | null; email?: string | null } | null | undefined): string | null {
  if (!u) return null;
  const n = u.full_name?.trim();
  return n || u.email || null;
}

function connStatus(v: unknown): ConnectionSummary["status"] {
  return v === "connected" || v === "syncing" || v === "needs_reconnect" || v === "error" || v === "disconnected"
    ? v
    : "error";
}

/**
 * Live (not disconnected) connections grouped by the member who connected
 * them. The current user's group comes first. A member whose row was
 * removed shows as "Former member".
 */
export const getConnectionsByMember = cache(async (profileId: string): Promise<MemberConnections[]> => {
  const { supabase, user } = await requireMember(profileId);
  const { data, error } = await supabase
    .from("connections")
    .select("id, provider, account_email, status, last_synced_at, last_error, connected_by, created_at")
    .eq("profile_id", profileId)
    .neq("status", "disconnected")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[workspace] connections failed:", error.code, error.message);
    return [];
  }
  type Row = {
    id: string;
    provider: string;
    account_email: string | null;
    status: string;
    last_synced_at: string | null;
    last_error: string | null;
    connected_by: string | null;
    created_at: string;
  };
  const rows = (data ?? []) as Row[];
  const members = await getMembers(profileId);
  const memberById = new Map(members.map((m) => [m.userId, m]));

  const groups = new Map<string, MemberConnections>();
  for (const r of rows) {
    const key = r.connected_by ?? "former";
    let g = groups.get(key);
    if (!g) {
      const m = r.connected_by ? memberById.get(r.connected_by) : undefined;
      g = {
        userId: r.connected_by,
        name: m ? (nameOf({ full_name: m.fullName, email: m.email }) ?? "Member") : "Former member",
        email: m?.email ?? null,
        isMe: r.connected_by === user.id,
        connections: [],
      };
      groups.set(key, g);
    }
    const info = isIntegrationKey(r.provider) ? INTEGRATIONS[r.provider] : null;
    g.connections.push({
      id: r.id,
      provider: r.provider,
      providerLabel: info?.displayName ?? r.provider,
      group: info?.group ?? null,
      accountEmail: r.account_email,
      status: connStatus(r.status),
      lastSyncedAt: r.last_synced_at,
      lastError: r.last_error,
      connectedBy: r.connected_by,
      createdAt: r.created_at,
    });
  }
  const out = [...groups.values()];
  out.sort((a, b) => {
    if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
    if (a.userId === null) return 1;
    if (b.userId === null) return -1;
    return a.name.localeCompare(b.name);
  });
  return out;
});

/** Last `limit` sync runs for the workspace, newest first (the sync log). */
export const getSyncRuns = cache(async (profileId: string, limit = 50): Promise<SyncRunRow[]> => {
  const { supabase } = await requireMember(profileId);
  const { data, error } = await supabase
    .from("sync_runs")
    .select("id, connection_id, kind, started_at, finished_at, stats, error, connections(provider, account_email)")
    .eq("profile_id", profileId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[workspace] sync runs failed:", error.code, error.message);
    return [];
  }
  type C = { provider: string; account_email: string | null };
  type Row = {
    id: string;
    connection_id: string;
    kind: string;
    started_at: string;
    finished_at: string | null;
    stats: Json;
    error: string | null;
    connections: C | C[] | null;
  };
  return ((data ?? []) as Row[]).map((r) => {
    const c = Array.isArray(r.connections) ? r.connections[0] : r.connections;
    const info = c && isIntegrationKey(c.provider) ? INTEGRATIONS[c.provider] : null;
    return {
      id: r.id,
      connectionId: r.connection_id,
      providerLabel: info?.displayName ?? c?.provider ?? "Account",
      accountEmail: c?.account_email ?? null,
      kind: r.kind,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      stats: r.stats && typeof r.stats === "object" && !Array.isArray(r.stats) ? (r.stats as Record<string, unknown>) : {},
      error: r.error,
    };
  });
});

/** The provider keys the current user has a live connection for (for ConnectButtons). */
export async function getMyConnectedIntegrations(membership: Membership): Promise<string[]> {
  const { supabase, profileId, user } = membership;
  const { data } = await supabase
    .from("connections")
    .select("provider")
    .eq("profile_id", profileId)
    .eq("connected_by", user.id)
    .in("status", ["connected", "syncing"]);
  return [...new Set(((data ?? []) as { provider: string }[]).map((r) => r.provider))];
}
