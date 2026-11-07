"use client";

import { useSyncExternalStore } from "react";

import { formatDateTime } from "./format";

const subscribe = () => () => {};

/**
 * Absolute times in the viewer's own zone without a hydration mismatch: the
 * server (UTC on Vercel) renders "Nov 7, 2:07 AM UTC"; after hydration the
 * browser swaps in its local "Nov 6, 8:07 PM". Relative ages should use the
 * server's `now` instead (see relativeTime).
 */
export function useLocalDateTime(iso: string | null | undefined): string {
  return useSyncExternalStore(
    subscribe,
    () => formatDateTime(iso),
    () => (iso ? `${formatDateTime(iso, { timeZone: "UTC" })} UTC` : "—"),
  );
}

export function LocalDateTime({ iso, className }: { iso: string | null | undefined; className?: string }) {
  const text = useLocalDateTime(iso);
  return (
    <time dateTime={iso ?? undefined} className={className}>
      {text}
    </time>
  );
}
