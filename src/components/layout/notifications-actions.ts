"use server";

import { getActiveProfileId } from "@/features/auth/server/dal";
import { getRecentEvents, type WorkspaceEvent } from "@/features/workspaces/server/queries";

/**
 * Loads the bell's list on demand (when the popover opens), so the shell
 * does not pay for it on every request. Reads the active workspace from the
 * cookie and the session, never from the client.
 */
export async function fetchRecentEvents(): Promise<{ ok: true; events: WorkspaceEvent[] } | { ok: false; error: string }> {
  try {
    const profileId = await getActiveProfileId();
    if (!profileId) return { ok: true, events: [] };
    const events = await getRecentEvents(profileId, 10);
    return { ok: true, events };
  } catch (err) {
    console.error("[shell] fetchRecentEvents failed:", (err as Error).message);
    return { ok: false, error: "Couldn't load activity. Try again." };
  }
}
