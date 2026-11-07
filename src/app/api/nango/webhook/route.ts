import { createHash } from "node:crypto";

import { after } from "next/server";
import { z } from "zod";

import {
  logConnectionEvent,
  readConnectionTags,
  recordNangoConnection,
  revokeDisconnectedNangoConnections,
  runPostConnect,
  updateConnectionStatusByNango,
} from "@/features/connections/server/connections";
import { isIntegrationKey } from "@/lib/nango/integrations";
import { getNango, hasWebhookSigningKey, isNangoConfigured } from "@/lib/nango/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/nango/webhook  (configure in Nango: Environment Settings > Webhooks)
 *
 * 1. Verifies X-Nango-Hmac-Sha256 = hex HMAC-SHA256(raw body, webhook signing key)
 *    through the Nango client (constructed with webhookSigningKey =
 *    NANGO_WEBHOOK_SIGNING_KEY; verifyIncomingWebhookRequest(rawBody, headers)).
 *    Unsigned or mis-signed requests get 401 and touch nothing.
 * 2. Handles "auth" webhooks:
 *    - creation / override, success  -> insert (or re-activate) the connections row,
 *                                       profile and user from the session tags; then,
 *                                       after the response, look up the account email
 *                                       and run the initial sync.
 *    - refresh, failure              -> needs_reconnect (+ last_error)
 *    - refresh, success (recovery)   -> back to connected
 *    - deletion                      -> disconnected
 *    Everything else (sync, forward, async_action, unknown types) is ignored.
 * 3. Answers 200 quickly for every authentic webhook, even when processing
 *    fails (errors are logged; Nango retries only twice within ~300 ms anyway).
 *
 * Replay protection: Nango's HMAC covers only the body (no timestamp or
 * nonce), so sha256(raw body) is recorded in webhook_receipts before any
 * processing; a body seen before gets 200 {duplicate: true} and changes
 * nothing. Receipts older than 7 days are cleared by the maintenance cron.
 */

// after() work (account email + first sync, ~45 s budget) runs within this limit.
export const maxDuration = 60;

const AuthWebhook = z.object({
  type: z.literal("auth"),
  operation: z.string(),
  success: z.boolean(),
  connectionId: z.string().min(1).max(255),
  providerConfigKey: z.string().min(1).max(255),
  tags: z.record(z.string(), z.unknown()).nullish(),
  endUser: z
    .object({
      endUserId: z.unknown().optional(),
      organizationId: z.unknown().optional(),
      endUserEmail: z.unknown().optional(),
    })
    .nullish(),
  error: z.object({ type: z.string().optional(), description: z.string().optional() }).nullish(),
});

type AuthWebhookBody = z.infer<typeof AuthWebhook>;

const ok = (extra: Record<string, unknown> = {}) =>
  Response.json({ ok: true, ...extra }, { status: 200, headers: { "cache-control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  const raw = new Uint8Array(await request.arrayBuffer());
  const rawBody = new TextDecoder().decode(raw);

  if (!isNangoConfigured() || !hasWebhookSigningKey()) {
    console.error("[nango/webhook] NANGO_SECRET_KEY / NANGO_WEBHOOK_SIGNING_KEY are not configured; rejecting webhook.");
    return Response.json({ error: "webhook verification not configured" }, { status: 503 });
  }
  if (!verifySignature(rawBody, request.headers)) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return ok({ ignored: "invalid json" });
  }

  const parsed = AuthWebhook.safeParse(payload);
  if (!parsed.success) {
    // Sync / forward / async_action / new webhook types: not used by this app.
    return ok({ ignored: true });
  }

  const receipt = await recordReceipt(raw);
  if (receipt === "duplicate") return ok({ duplicate: true });
  if (receipt === "error") {
    // Cannot prove this is not a replay: let Nango retry instead of acting.
    return Response.json({ error: "temporarily unavailable" }, { status: 503 });
  }

  // Revoke Nango grants of connections disconnected elsewhere (sweep).
  after(() => revokeDisconnectedNangoConnections({ limit: 10 }));

  try {
    const result = await handleAuthWebhook(parsed.data);
    return ok(result);
  } catch (err) {
    console.error("[nango/webhook] processing failed:", (err as Error).message);
    return ok({ processed: false });
  }
}

/**
 * Nango's verifyIncomingWebhookRequest: HMAC-SHA256 of the RAW body with the
 * environment's webhook signing key, compared in constant time against the
 * X-Nango-Hmac-Sha256 header. The client is built with webhookSigningKey
 * (lib/nango/server getNango), so the API key is never used for signatures.
 */
function verifySignature(rawBody: string, headers: Headers): boolean {
  const plain: Record<string, string> = {};
  headers.forEach((value, key) => {
    plain[key] = value;
  });
  try {
    return getNango().verifyIncomingWebhookRequest(rawBody, plain);
  } catch (err) {
    console.error("[nango/webhook] signature verification failed:", (err as Error).message);
    return false;
  }
}

/** Inserts sha256(raw body) into webhook_receipts. 23505 = seen before. */
async function recordReceipt(raw: Uint8Array): Promise<"new" | "duplicate" | "error"> {
  const admin = createSupabaseAdminClient();
  if (!admin) return "error";
  const bodySha256 = createHash("sha256").update(raw).digest("hex");
  const { error } = await admin.from("webhook_receipts").insert({ body_sha256: bodySha256, source: "nango" });
  if (!error) return "new";
  if (error.code === "23505") return "duplicate";
  console.error("[nango/webhook] receipt insert failed:", error.code, error.message);
  return "error";
}

async function handleAuthWebhook(body: AuthWebhookBody): Promise<Record<string, unknown>> {
  const { operation, success, connectionId, providerConfigKey } = body;
  if (!isIntegrationKey(providerConfigKey)) return { ignored: "unknown integration" };

  // New connection, or re-authorization of an existing one.
  if ((operation === "creation" || operation === "override") && success) {
    const tags = readConnectionTags(body.tags, body.endUser);
    if (!tags) {
      console.warn("[nango/webhook] auth webhook without usable tags:", providerConfigKey);
      return { ignored: "missing tags" };
    }
    const result = await recordNangoConnection({
      providerConfigKey,
      nangoConnectionId: connectionId,
      tags,
      operation,
      via: "webhook",
    });
    if (result.outcome === "created" || result.outcome === "reactivated") {
      const row = result.connection;
      after(() => runPostConnect(row, result.outcome === "created" ? "initial" : "incremental"));
    } else if (result.outcome === "rejected") {
      console.warn("[nango/webhook] connection rejected:", result.reason);
    }
    return { outcome: result.outcome };
  }

  // Token refresh failed: the user has to reconnect.
  if (operation === "refresh" && !success) {
    const description = body.error?.description ?? body.error?.type ?? "Token refresh failed";
    const row = await updateConnectionStatusByNango(
      providerConfigKey,
      connectionId,
      { status: "needs_reconnect", last_error: `Reconnect required: ${description}` },
      { skipIfStatusIn: ["disconnected", "needs_reconnect"] },
    );
    if (row) {
      await logConnectionEvent(row.profile_id, "connection.needs_reconnect", {
        connection_id: row.id,
        provider: row.provider,
        error_type: body.error?.type ?? null,
      });
    }
    return { outcome: row ? "needs_reconnect" : "unchanged" };
  }

  // Refresh recovered after an earlier failure.
  if (operation === "refresh" && success) {
    const row = await updateConnectionStatusByNango(
      providerConfigKey,
      connectionId,
      { status: "connected", last_error: null },
      { onlyIfStatusIn: ["needs_reconnect"] },
    );
    if (row) {
      await logConnectionEvent(row.profile_id, "connection.recovered", {
        connection_id: row.id,
        provider: row.provider,
      });
    }
    return { outcome: row ? "recovered" : "unchanged" };
  }

  // Deleted in Nango (dashboard, API, or our own DELETE route).
  if (operation === "deletion") {
    const row = await updateConnectionStatusByNango(
      providerConfigKey,
      connectionId,
      // Nango already dropped the tokens: nothing left for the revoke sweep.
      { status: "disconnected", nango_revoked_at: new Date().toISOString() },
      { skipIfStatusIn: ["disconnected"] },
    );
    if (row) {
      await logConnectionEvent(row.profile_id, "connection.disconnected", {
        connection_id: row.id,
        provider: row.provider,
        via: "nango",
      });
    }
    return { outcome: row ? "disconnected" : "unchanged" };
  }

  return { ignored: `auth ${operation}` };
}
