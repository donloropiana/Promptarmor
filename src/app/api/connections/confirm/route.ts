import { after } from "next/server";
import { z } from "zod";

import { readConnectionTags, recordNangoConnection, runPostConnect } from "@/features/connections/server/connections";
import { isIntegrationKey } from "@/lib/nango/integrations";
import { authorizeMember, isSameOrigin, json } from "@/features/connections/server/route-auth";
import { getNango, isNangoConfigured } from "@/lib/nango/server";

/**
 * POST /api/connections/confirm
 * Body: { profileId: uuid, providerConfigKey, connectionId }
 *
 * Called by the Connect buttons right after Connect UI reports success. It is a
 * fallback for the Nango auth webhook (Nango retries a failed webhook only
 * twice within ~300 ms), and makes the new connection show up immediately.
 *
 * The browser-supplied connection id is NOT trusted: the connection is read
 * back from Nango with the secret key, and recorded only if its session tags
 * name this signed-in user and this profile. Idempotent with the webhook.
 *
 * Recorded as an "override": a new id inserts a row; an existing row of
 * this user in needs_reconnect / error (a Reconnect session re-authorizes the
 * same Nango id) is re-activated and synced, like the override webhook.
 */

// after() work (account email + first sync, ~45 s budget) runs within this limit.
export const maxDuration = 60;

const Body = z.object({
  profileId: z.guid(),
  providerConfigKey: z.string().min(1).max(100),
  connectionId: z.string().min(1).max(255),
});

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return json({ error: "Cross-origin request rejected." }, 403);
  if (!isNangoConfigured()) return json({ error: "Connections are not configured yet." }, 503);

  let input: z.infer<typeof Body>;
  try {
    input = Body.parse(await request.json());
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  if (!isIntegrationKey(input.providerConfigKey)) return json({ error: "Unknown integration." }, 400);

  const auth = await authorizeMember(input.profileId);
  if (!auth.ok) return auth.response;

  let nangoTags: Record<string, unknown> | null = null;
  try {
    const connection = await getNango().getConnection(input.providerConfigKey, input.connectionId);
    nangoTags = (connection.tags ?? null) as Record<string, unknown> | null;
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (status === 404 || status === 400) return json({ error: "Connection not found." }, 404);
    console.error("[connections/confirm] getConnection failed:", (err as Error).message);
    return json({ error: "Could not verify the connection." }, 502);
  }

  const tags = readConnectionTags(nangoTags);
  if (!tags || tags.userId !== auth.user.id || tags.profileId !== input.profileId) {
    return json({ error: "Connection not found." }, 404);
  }

  try {
    const result = await recordNangoConnection({
      providerConfigKey: input.providerConfigKey,
      nangoConnectionId: input.connectionId,
      tags,
      operation: "override",
      via: "confirm",
    });
    if (result.outcome === "rejected") return json({ error: "Connection could not be added." }, 409);
    if (result.outcome === "created" || result.outcome === "reactivated") {
      const row = result.connection;
      after(() => runPostConnect(row, result.outcome === "created" ? "initial" : "incremental"));
    }
    return json({ ok: true, outcome: result.outcome, connectionId: result.connection.id });
  } catch (err) {
    console.error("[connections/confirm] record failed:", (err as Error).message);
    return json({ error: "Could not save the connection." }, 500);
  }
}
