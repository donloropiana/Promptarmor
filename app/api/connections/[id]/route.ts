import { z } from "zod";

import { getCurrentUser, getMembershipRole } from "@/lib/auth/dal";
import { logConnectionEvent, type ConnectionRow } from "@/lib/nango/connections";
import { isSameOrigin, json } from "@/lib/nango/route-auth";
import { deleteNangoConnection, isNangoConfigured } from "@/lib/nango/server";
import { requireSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseContext } from "@/lib/supabase/context";

/**
 * DELETE /api/connections/:id   (id = connections.id, never a Nango id)
 *
 * Disconnects a Google/Microsoft connection: deletes the Nango connection (so
 * Nango drops the stored OAuth tokens) and marks the row `disconnected`.
 *
 * Authorization: the row is loaded with the user-context client (RLS: members
 * only), membership is re-checked, and only the member who connected it or a
 * profile owner may disconnect it. Only the row's own nango_connection_id and
 * provider_config_key are sent to Nango.
 */

const Id = z.guid();

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!isSameOrigin(request)) return json({ error: "Cross-origin request rejected." }, 403);

  const { id } = await ctx.params;
  if (!Id.safeParse(id).success) return json({ error: "Connection not found." }, 404);

  const user = await getCurrentUser();
  if (!user) return json({ error: "Sign in to continue." }, 401);
  const supabase = (await getSupabaseContext())?.supabase;
  if (!supabase) return json({ error: "Sign in to continue." }, 401);

  const { data, error } = await supabase
    .from("connections")
    .select("id, profile_id, provider, provider_config_key, nango_connection_id, connected_by, account_email, status")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[connections/delete] lookup failed:", error.code, error.message);
    return json({ error: "Could not load the connection." }, 500);
  }
  const row = data as ConnectionRow | null;
  if (!row) return json({ error: "Connection not found." }, 404);

  const role = await getMembershipRole(row.profile_id);
  if (!role) return json({ error: "Connection not found." }, 404);
  if (row.connected_by !== user.id && role !== "owner") {
    return json({ error: "Only the person who connected this account or a profile owner can disconnect it." }, 403);
  }

  // Delete at Nango first so the tokens are gone even if our update fails.
  let nangoDeleted = false;
  if (isNangoConfigured()) {
    try {
      nangoDeleted = await deleteNangoConnection(row.provider_config_key, row.nango_connection_id);
    } catch (err) {
      console.error("[connections/delete] Nango delete failed:", (err as Error).message);
    }
  }

  // Stop reading regardless: the user asked to disconnect.
  const admin = requireSupabaseAdminClient();
  const { data: updated, error: updateError } = await admin
    .from("connections")
    .update({
      status: "disconnected",
      last_error: nangoDeleted ? null : "Disconnected; Nango cleanup pending.",
      // Null keeps the row in the revocation sweep until Nango confirms.
      ...(nangoDeleted ? { nango_revoked_at: new Date().toISOString() } : {}),
    })
    .eq("id", row.id)
    .eq("profile_id", row.profile_id)
    .neq("status", "disconnected")
    .select("id");
  if (updateError) {
    console.error("[connections/delete] update failed:", updateError.code, updateError.message);
    return json({ error: "Could not disconnect. Try again." }, 500);
  }

  // Skip the event when the Nango deletion webhook already recorded it.
  if (updated && updated.length > 0) {
    await logConnectionEvent(
      row.profile_id,
      "connection.disconnected",
      { connection_id: row.id, provider: row.provider, via: "user", nango_deleted: nangoDeleted },
      user.id,
    );
  }

  return json({ ok: true, nangoDeleted });
}
