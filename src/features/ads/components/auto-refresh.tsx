"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-fetches the server page every `intervalMs` while `active` is true
 * (an ad is still being checked). Stops on its own once nothing is running,
 * and pauses while the tab is hidden.
 */
export function AutoRefresh({ active, intervalMs = 5000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (document.visibilityState === "visible") router.refresh();
      timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, intervalMs, router]);
  return null;
}
