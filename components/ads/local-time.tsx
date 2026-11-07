"use client";

import { useSyncExternalStore } from "react";

import { formatDateTime } from "./format";

const subscribe = () => () => {};

/**
 * Absolute times, identical on the server and in the browser because
 * formatDateTime pins APP_TIME_ZONE. Kept as a hook so a per-viewer zone can
 * be reintroduced later without touching call sites.
 */
export function useLocalDateTime(iso: string | null | undefined): string {
  return useSyncExternalStore(
    subscribe,
    () => formatDateTime(iso),
    () => formatDateTime(iso),
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
