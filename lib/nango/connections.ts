import "server-only";

import { z } from "zod";

import { requireSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";

import { INTEGRATIONS, isIntegrationKey, type IntegrationKey } from "./integrations";
import { deleteNangoConnection, isNangoConfigured, nangoProxy } from "./server";

/**
 * Server-side bookkeeping for Nango connections (the `connections` table).
 *
 * Shared by the Nango webhook (app/api/nango/webhook) and the post-connect
 * confirmation route (app/api/connections/confirm). Every write uses the
 * secret-key client, because only the server writes `connections`; callers
 * are responsible for having authenticated the input (verified webhook
 * signature, or tags re-read from Nango and matched to the signed-in member).
 *
 * Tenancy: a connection's profile comes from the connect-session tags ONLY
 * when the row is first inserted. Afterwards every lookup goes through
 * (provider_config_key, nango_connection_id), never through payload claims.
 */

const uuid = z.guid();

export type ConnectionStatus = "connected" | "syncing" | "needs_reconnect" | "error" | "disconnected";

export interface ConnectionRow {
  id: string;
  profile_id: string;
  provider: IntegrationKey;
  provider_config_key: string;
  nango_connection_id: string;
  connected_by: string | null;
  account_email: string | null;
  status: ConnectionStatus;
}

const ROW_COLUMNS =
  "id, profile_id, provider, provider_config_key, nango_connection_id, connected_by, account_email, status";

export interface ConnectionTags {
  userId: string;
  profileId: string;
  userEmail: string | null;
}

/**
 * Reads our attribution tags (end_user_id, organization_id, end_user_email)
 * from a Nango payload. Falls back to the deprecated `endUser` block. Returns
 * null unless both ids are well-formed uuids.
 */
export function readConnectionTags(
  tags: Record<string, unknown> | null | undefined,
  endUser?: { endUserId?: unknown; organizationId?: unknown; endUserEmail?: unknown } | null,
): ConnectionTags | null {
  const pick = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const userId = pick(tags?.end_user_id) ?? pick(endUser?.endUserId);
  const profileId = pick(tags?.organization_id) ?? pick(endUser?.organizationId);
  const userEmail = pick(tags?.end_user_email) ?? pick(endUser?.endUserEmail);
  if (!userId || !profileId) return null;
  if (!uuid.safeParse(userId).success || !uuid.safeParse(profileId).success) return null;
  return { userId, profileId, userEmail };
}

export async function findConnectionByNango(
  providerConfigKey: string,
  nangoConnectionId: string,
): Promise<ConnectionRow | null> {
  const admin = requireSupabaseAdminClient();
  const { data, error } = await admin
    .from("connections")
    .select(ROW_COLUMNS)
    .eq("provider_config_key", providerConfigKey)
    .eq("nango_connection_id", nangoConnectionId)
    .maybeSingle();
  if (error) throw new Error(`connections lookup failed: ${error.code} ${error.message}`);
  return (data as ConnectionRow | null) ?? null;
}

/** Appends to the audit log. Never throws (the log must not break ingestion). */
export async function logConnectionEvent(
  profileId: string,
  kind: string,
  data: Record<string, unknown>,
  actorId: string | null = null,
): Promise<void> {
  try {
    const admin = requireSupabaseAdminClient();
    const { error } = await admin.from("events").insert({ profile_id: profileId, actor_id: actorId, kind, data: data as Json });
    if (error) console.error("[nango] event insert failed:", kind, error.code, error.message);
  } catch (err) {
    console.error("[nango] event insert failed:", kind, (err as Error).message);
  }
}

export type RecordConnectionResult =
  /** New row inserted: run the initial sync. */
  | { outcome: "created"; connection: ConnectionRow }
  /** Existing row re-activated after a re-authorization: run a sync. */
  | { outcome: "reactivated"; connection: ConnectionRow }
  /** Already recorded (duplicate webhook, or webhook + confirm race). Nothing to do. */
  | { outcome: "exists"; connection: ConnectionRow }
  | { outcome: "rejected"; reason: string };

/**
 * Records a successful Nango authorization (operation "creation" or
 * "override"). Idempotent on (provider_config_key, nango_connection_id).
 *
 * The connections insert trigger rejects (42501) a connecting user who is no
 * longer a member of the profile; in that case the orphaned Nango connection
 * is deleted so no credentials linger.
 */
export async function recordNangoConnection(input: {
  providerConfigKey: string;
  nangoConnectionId: string;
  tags: ConnectionTags;
  operation: "creation" | "override";
  via: "webhook" | "confirm";
}): Promise<RecordConnectionResult> {
  const { providerConfigKey, nangoConnectionId, tags, operation, via } = input;
  if (!isIntegrationKey(providerConfigKey)) {
    return { outcome: "rejected", reason: `unknown integration ${providerConfigKey}` };
  }
  if (!nangoConnectionId || nangoConnectionId.length > 255) {
    return { outcome: "rejected", reason: "invalid connection id" };
  }

  const admin = requireSupabaseAdminClient();
  const existing = await findConnectionByNango(providerConfigKey, nangoConnectionId);

  if (existing) {
    if (existing.profile_id !== tags.profileId) {
      // Never move a connection between profiles on the strength of a payload.
      return { outcome: "rejected", reason: "connection already belongs to another profile" };
    }
    const reauthorized =
      operation === "override" && (existing.status === "needs_reconnect" || existing.status === "error");
    if (!reauthorized) return { outcome: "exists", connection: existing };

    const { data, error } = await admin
      .from("connections")
      .update({ status: "syncing", last_error: null })
      .eq("id", existing.id)
      .in("status", ["needs_reconnect", "error"])
      .select(ROW_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(`connections reactivate failed: ${error.code} ${error.message}`);
    if (!data) return { outcome: "exists", connection: existing };
    await logConnectionEvent(
      existing.profile_id,
      "connection.reconnected",
      { connection_id: existing.id, provider: existing.provider, via },
      tags.userId,
    );
    return { outcome: "reactivated", connection: data as ConnectionRow };
  }

  const { data, error } = await admin
    .from("connections")
    .insert({
      profile_id: tags.profileId,
      provider: providerConfigKey,
      provider_config_key: providerConfigKey,
      nango_connection_id: nangoConnectionId,
      connected_by: tags.userId,
      status: "syncing",
    })
    .select(ROW_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      // Lost a race with the other path (webhook vs confirm).
      const row = await findConnectionByNango(providerConfigKey, nangoConnectionId);
      if (row) return { outcome: "exists", connection: row };
    }
    if (error.code === "42501" || error.code === "23503") {
      // Not (or no longer) a member, or the profile/user is gone.
      try {
        await deleteNangoConnection(providerConfigKey, nangoConnectionId);
      } catch (err) {
        console.error("[nango] could not delete rejected connection:", (err as Error).message);
      }
      return { outcome: "rejected", reason: "connecting user is not a member of the profile" };
    }
    throw new Error(`connections insert failed: ${error.code} ${error.message}`);
  }

  const row = data as ConnectionRow;
  await logConnectionEvent(
    row.profile_id,
    "connection.created",
    {
      connection_id: row.id,
      provider: row.provider,
      provider_name: INTEGRATIONS[providerConfigKey].displayName,
      via,
    },
    tags.userId,
  );
  return { outcome: "created", connection: row };
}

/**
 * Applies a status change to the row identified by the Nango pair. Returns the
 * updated row, or null when no row matched (unknown connection) or the row was
 * already in a state listed in `skipIfStatusIn`.
 */
export async function updateConnectionStatusByNango(
  providerConfigKey: string,
  nangoConnectionId: string,
  patch: { status: ConnectionStatus; last_error?: string | null; nango_revoked_at?: string | null },
  options: { skipIfStatusIn?: ConnectionStatus[]; onlyIfStatusIn?: ConnectionStatus[] } = {},
): Promise<ConnectionRow | null> {
  const admin = requireSupabaseAdminClient();
  let query = admin
    .from("connections")
    .update({
      status: patch.status,
      ...(patch.last_error !== undefined ? { last_error: patch.last_error?.slice(0, 1000) ?? null } : {}),
      ...(patch.nango_revoked_at !== undefined ? { nango_revoked_at: patch.nango_revoked_at } : {}),
    })
    .eq("provider_config_key", providerConfigKey)
    .eq("nango_connection_id", nangoConnectionId);
  if (options.skipIfStatusIn?.length) {
    query = query.not("status", "in", `(${options.skipIfStatusIn.join(",")})`);
  }
  if (options.onlyIfStatusIn?.length) {
    query = query.in("status", options.onlyIfStatusIn);
  }
  const { data, error } = await query.select(ROW_COLUMNS).maybeSingle();
  if (error) throw new Error(`connections status update failed: ${error.code} ${error.message}`);
  return (data as ConnectionRow | null) ?? null;
}

// ---------------------------------------------------------------------------
// Account email (which mailbox / drive was connected)
// ---------------------------------------------------------------------------

const GRAPH = "https://graph.microsoft.com";
const GOOGLE_APIS = "https://www.googleapis.com";

function emailOrNull(v: unknown): string | null {
  return typeof v === "string" && v.includes("@") && v.length <= 320 ? v.trim().toLowerCase() : null;
}

/**
 * Looks up the connected account's email with one read-only provider call.
 * Nango does not store it (Gmail's post-connection hook keeps only a hash).
 * Returns null on any failure.
 */
export async function fetchAccountEmail(providerConfigKey: string, nangoConnectionId: string): Promise<string | null> {
  const base = { connectionId: nangoConnectionId, providerConfigKey, retries: 1 } as const;
  try {
    switch (providerConfigKey) {
      case "google-mail": {
        const res = await nangoProxy<{ emailAddress?: string }>({ ...base, endpoint: "/gmail/v1/users/me/profile" });
        return emailOrNull(res.data?.emailAddress);
      }
      case "google-drive":
      case "google-sheet": {
        const res = await nangoProxy<{ user?: { emailAddress?: string } }>({
          ...base,
          endpoint: "/drive/v3/about",
          params: { fields: "user(emailAddress)" },
          baseUrlOverride: GOOGLE_APIS,
        });
        return emailOrNull(res.data?.user?.emailAddress);
      }
      case "outlook":
      case "one-drive":
      case "one-drive-personal": {
        const res = await nangoProxy<{ mail?: string | null; userPrincipalName?: string | null }>({
          ...base,
          endpoint: "/v1.0/me",
          params: { $select: "mail,userPrincipalName" },
          baseUrlOverride: GRAPH,
        });
        return emailOrNull(res.data?.mail) ?? emailOrNull(res.data?.userPrincipalName);
      }
      default:
        return null;
    }
  } catch (err) {
    console.warn("[nango] account email lookup failed:", providerConfigKey, (err as Error).message);
    return null;
  }
}

/** Fills connections.account_email when it is still empty. Never throws. */
export async function fillAccountEmail(row: Pick<ConnectionRow, "id" | "provider_config_key" | "nango_connection_id" | "account_email">): Promise<void> {
  if (row.account_email) return;
  const email = await fetchAccountEmail(row.provider_config_key, row.nango_connection_id);
  if (!email) return;
  try {
    const admin = requireSupabaseAdminClient();
    const { error } = await admin
      .from("connections")
      .update({ account_email: email })
      .eq("id", row.id)
      .is("account_email", null);
    if (error) console.error("[nango] account_email update failed:", error.code, error.message);
  } catch (err) {
    console.error("[nango] account_email update failed:", (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// After a connection is recorded
// ---------------------------------------------------------------------------

/**
 * A fresh connection for the same member, profile, provider and account
 * supersedes older rows of that account stuck in needs_reconnect / error
 * (e.g. the user connected again instead of using Reconnect). Those rows are
 * marked disconnected; the revocation sweep then deletes their Nango
 * connections. Never throws.
 */
async function supersedeStaleConnections(rowId: string): Promise<void> {
  try {
    const admin = requireSupabaseAdminClient();
    const { data: row } = await admin
      .from("connections")
      .select("id, profile_id, provider, account_email, connected_by")
      .eq("id", rowId)
      .maybeSingle();
    const r = row as { id: string; profile_id: string; provider: string; account_email: string | null; connected_by: string | null } | null;
    if (!r?.account_email || !r.connected_by) return;
    const { data: stale, error } = await admin
      .from("connections")
      .update({ status: "disconnected", last_error: "Replaced by a newer connection of the same account" })
      .eq("profile_id", r.profile_id)
      .eq("provider", r.provider)
      .eq("connected_by", r.connected_by)
      .eq("account_email", r.account_email)
      .neq("id", r.id)
      .in("status", ["needs_reconnect", "error"])
      .select("id");
    if (error) throw new Error(`${error.code} ${error.message}`);
    if (stale && stale.length > 0) {
      await logConnectionEvent(
        r.profile_id,
        "connection.superseded",
        { connection_id: r.id, replaced_connection_ids: stale.map((x) => (x as { id: string }).id) },
        r.connected_by,
      );
      await revokeDisconnectedNangoConnections({ profileId: r.profile_id });
    }
  } catch (err) {
    console.error("[nango] supersede check failed:", (err as Error).message);
  }
}

/**
 * Runs after the response (via next/server `after()`): records the connected
 * account's email, retires older broken rows of the same account, then runs
 * the first sync. Never throws.
 *
 * `runConnectionSync` is imported lazily because lib/connectors/sync.ts
 * imports this module (logConnectionEvent).
 */
export async function runPostConnect(
  row: Pick<ConnectionRow, "id" | "provider_config_key" | "nango_connection_id" | "account_email">,
  kind: "initial" | "incremental",
): Promise<void> {
  await fillAccountEmail(row);
  await supersedeStaleConnections(row.id);
  try {
    const { runConnectionSync } = await import("@/lib/connectors/sync");
    const result = await runConnectionSync(row.id, { kind });
    if (!result.ok && result.skipped !== "unsupported_provider") {
      console.warn("[nango] post-connect sync did not complete:", row.id, result.skipped ?? result.error ?? "unknown");
    }
  } catch (err) {
    console.error("[nango] post-connect sync failed:", row.id, (err as Error).message);
  }
}

/**
 * Revokes the Nango grants of a member who was removed from (or left) a
 * profile. remove_member / leave_profile already marked that member's rows
 * 'disconnected' in the same transaction (event connection.owner_removed);
 * this deletes the matching Nango connections so their OAuth tokens stop
 * working. Only rows not revoked yet (nango_revoked_at null) are touched.
 * Idempotent (a 404 from Nango counts as deleted). Never throws.
 * Purging the departed member's private source_items is not done here.
 */
export async function revokeMemberNangoConnections(profileId: string, userId: string): Promise<number> {
  return revokeDisconnectedNangoConnections({ profileId, userId, actorEventUserId: userId });
}

/**
 * Sweep: deletes at Nango every 'disconnected' connection whose grant is
 * still live (nango_revoked_at null), however it was disconnected (member
 * removed or left through the RPC directly, a failed DELETE, a superseded
 * row), then stamps nango_revoked_at. Runs after member removal, after sync
 * and webhook requests (in after()) and from the daily maintenance cron.
 * Never throws; returns how many grants were revoked.
 */
export async function revokeDisconnectedNangoConnections(
  options: { profileId?: string; userId?: string; limit?: number; actorEventUserId?: string } = {},
): Promise<number> {
  if (!isNangoConfigured()) return 0;
  let revoked = 0;
  try {
    const admin = requireSupabaseAdminClient();
    let query = admin
      .from("connections")
      .select("id, profile_id, provider_config_key, nango_connection_id")
      .eq("status", "disconnected")
      .is("nango_revoked_at", null);
    if (options.profileId) query = query.eq("profile_id", options.profileId);
    if (options.userId) query = query.eq("connected_by", options.userId);
    const { data, error } = await query.order("updated_at", { ascending: true }).limit(options.limit ?? 25);
    if (error) throw new Error(`${error.code} ${error.message}`);

    const perProfile = new Map<string, string[]>();
    for (const row of (data ?? []) as {
      id: string;
      profile_id: string;
      provider_config_key: string;
      nango_connection_id: string;
    }[]) {
      try {
        await deleteNangoConnection(row.provider_config_key, row.nango_connection_id);
      } catch (err) {
        console.error("[nango] connection delete failed:", row.id, (err as Error).message);
        continue;
      }
      const { error: markError } = await admin
        .from("connections")
        .update({ nango_revoked_at: new Date().toISOString() })
        .eq("id", row.id)
        .is("nango_revoked_at", null);
      if (markError) console.error("[nango] nango_revoked_at update failed:", row.id, markError.code);
      revoked++;
      perProfile.set(row.profile_id, [...(perProfile.get(row.profile_id) ?? []), row.id]);
    }
    for (const [profileId, ids] of perProfile) {
      await logConnectionEvent(profileId, "connection.nango_revoked", {
        ...(options.actorEventUserId ? { user_id: options.actorEventUserId } : {}),
        connection_ids: ids,
        count: ids.length,
      });
    }
  } catch (err) {
    console.error("[nango] connection revocation sweep failed:", (err as Error).message);
  }
  return revoked;
}
