/**
 * Browser helper: keeps calling POST /api/connections/:id/sync while the
 * server reports `hasMore` (each call is one ~45 s pass on Vercel Hobby, so
 * an initial backfill needs several). Stops on any other outcome.
 *
 * A 409 `already_running` (e.g. the first sync started by the connect
 * webhook / confirm route is still going) waits and retries. Capped at
 * `maxPasses` calls. Never throws.
 */

export type DrainOutcome = "done" | "stopped" | "capped" | "error";

export interface DrainOptions {
  maxPasses?: number;
  /** Wait between retries when another pass is still running. */
  busyWaitMs?: number;
  signal?: AbortSignal;
  onPass?: (info: { pass: number; hasMore: boolean; status: number }) => void;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

export async function drainConnectionSync(connectionId: string, options: DrainOptions = {}): Promise<DrainOutcome> {
  const maxPasses = options.maxPasses ?? 10;
  const busyWaitMs = options.busyWaitMs ?? 15_000;

  for (let pass = 1; pass <= maxPasses; pass++) {
    if (options.signal?.aborted) return "stopped";
    let res: Response;
    try {
      res = await fetch(`/api/connections/${encodeURIComponent(connectionId)}/sync`, {
        method: "POST",
        signal: options.signal,
      });
    } catch {
      return options.signal?.aborted ? "stopped" : "error";
    }
    let body: { hasMore?: unknown; skipped?: unknown } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // non-JSON: treated below by status
    }
    const hasMore = body.hasMore === true;
    options.onPass?.({ pass, hasMore, status: res.status });

    if (res.status === 409 && body.skipped === "already_running") {
      await sleep(busyWaitMs, options.signal);
      continue;
    }
    if (!res.ok) return res.status === 429 ? "done" : "stopped";
    if (!hasMore) return "done";
  }
  return "capped";
}
