import "server-only";

import { after } from "next/server";

/**
 * The one call here that is not a read: the Ads list and the Ad page, while a
 * check shows as in progress, hand the analysis engine a nudge to run after
 * the response. The engine is imported lazily (dynamic import) so the ads
 * reads stay out of a module cycle with it.
 */

/**
 * Fire-and-forget after the response: ask the engine to pick up any run that
 * is still queued (for example when the after() that should have started it
 * never ran). `nudgeStaleRuns` is an optional export on the engine side.
 */
export function nudgeStaleRunsAfter(profileId: string): void {
  after(async () => {
    try {
      const mod = (await import("@/features/analysis/server/engine/queue")) as Record<string, unknown>;
      const fn = mod.nudgeStaleRuns;
      if (typeof fn === "function") await (fn as (id: string) => Promise<void>)(profileId);
    } catch (err) {
      console.error("[ads] nudgeStaleRuns failed:", (err as Error).message);
    }
  });
}
