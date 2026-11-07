"use server";

import { redirect } from "next/navigation";

import { createProfile, type ActionResult } from "@/lib/actions/profiles";
import { ensureWorkspaceDefaults } from "@/lib/seed";

/**
 * Creates a workspace (the caller becomes its owner and it becomes active),
 * seeds the starter rules and ClearPath-style products so the first ad has
 * something to be checked against, then redirects to the Ads list.
 */
export async function createWorkspace(input: FormData | Record<string, unknown>): Promise<ActionResult<{ profileId: string }>> {
  const res = await createProfile(input);
  if (!res.ok) return res;
  try {
    await ensureWorkspaceDefaults(res.data.profileId);
  } catch (err) {
    // The app shell retries this on every page load, so a hiccup here is not fatal.
    console.error("[new-workspace] ensureWorkspaceDefaults failed:", (err as Error).message);
  }
  redirect("/ads");
}
