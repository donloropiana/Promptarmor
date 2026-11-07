import { z } from "zod";

import { CONNECT_STEPS, PROVIDER_GROUPS, getConnectStep } from "@/lib/nango/integrations";
import { authorizeMember, isSameOrigin, json } from "@/features/connections/server/route-auth";
import { getNango, isNangoConfigured } from "@/lib/nango/server";
import { getSupabaseContext } from "@/lib/supabase/context";

/**
 * POST /api/connections/session
 * Body: { group: "google" | "microsoft", profileId: uuid, step?: "mail" | "files",
 *         connectionId?: uuid }
 *
 * Creates a short-lived (30 min) Nango connect session for the signed-in
 * member and returns its token for Connect UI. The session's tags are how the
 * Nango auth webhook maps the new connection back to this user and profile
 * (Nango itself knows nothing about tenancy):
 *   end_user_id = user id, end_user_email = user email, organization_id = profile id
 *
 * `step` narrows allowed_integrations to one step of the group's flow, so
 * Connect UI skips its picker and goes straight to the provider consent.
 * Without `step`, every integration of the group is allowed.
 *
 * `connectionId` (our connections.id) asks for a RECONNECT session instead:
 * only the member who connected that account, only while it is in
 * needs_reconnect / error. Nango then re-authorizes the SAME Nango connection
 * and sends an `override` auth webhook, which re-activates the existing row
 * (no duplicate row, no orphaned Nango connection).
 */

const Body = z.object({
  group: z.enum(PROVIDER_GROUPS),
  profileId: z.guid(),
  step: z.enum(["mail", "files"]).optional(),
  connectionId: z.guid().optional(),
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

  const auth = await authorizeMember(input.profileId);
  if (!auth.ok) return auth.response;

  const steps = input.step ? [getConnectStep(input.group, input.step)] : CONNECT_STEPS[input.group];
  const allowedIntegrations = [...new Set(steps.flatMap((s) => (s ? [...s.integrations] : [])))];
  if (allowedIntegrations.length === 0) return json({ error: "Unknown connection step." }, 400);

  const tags: Record<string, string> = {
    end_user_id: auth.user.id,
    organization_id: input.profileId,
  };
  if (auth.user.email) tags.end_user_email = auth.user.email.slice(0, 255);
  if (auth.user.fullName) tags.end_user_display_name = auth.user.fullName.slice(0, 255);

  if (input.connectionId) {
    const supabase = (await getSupabaseContext())?.supabase;
    if (!supabase) return json({ error: "Sign in to continue." }, 401);
    const { data: row, error } = await supabase
      .from("connections")
      .select("id, profile_id, provider_config_key, nango_connection_id, connected_by, status, provider_group")
      .eq("id", input.connectionId)
      .eq("profile_id", input.profileId)
      .maybeSingle();
    if (error) {
      console.error("[connections/session] reconnect lookup failed:", error.code);
      return json({ error: "Could not load the connection." }, 500);
    }
    const r = row as {
      provider_config_key: string;
      nango_connection_id: string;
      connected_by: string | null;
      status: string;
      provider_group: string | null;
    } | null;
    if (!r || r.connected_by !== auth.user.id || r.provider_group !== input.group) {
      return json({ error: "Connection not found." }, 404);
    }
    if (r.status !== "needs_reconnect" && r.status !== "error") {
      return json({ error: "This account does not need to be reconnected." }, 409);
    }
    try {
      const { data } = await getNango().createReconnectSession({
        connection_id: r.nango_connection_id,
        integration_id: r.provider_config_key,
        tags,
      });
      return json({ token: data.token, expiresAt: data.expires_at, allowedIntegrations: [r.provider_config_key] });
    } catch (err) {
      console.error("[connections/session] createReconnectSession failed:", (err as Error).message);
      return json({ error: "Could not start the reconnection. Try again." }, 502);
    }
  }

  try {
    const { data } = await getNango().createConnectSession({
      tags,
      allowed_integrations: allowedIntegrations,
    });
    return json({ token: data.token, expiresAt: data.expires_at, allowedIntegrations });
  } catch (err) {
    console.error("[connections/session] createConnectSession failed:", (err as Error).message);
    return json({ error: "Could not start the connection. Try again." }, 502);
  }
}
