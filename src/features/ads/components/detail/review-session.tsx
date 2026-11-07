"use client";

import { useEffect } from "react";

const HEARTBEAT_MS = 30_000;

/**
 * Measures reviewer time on this version. Opens one review_sessions row
 * (surface 'workbench') through /api/review-session when the page opens and
 * bumps active_seconds every 30 s while the tab is visible. The final write
 * on page hide is a keepalive fetch, which carries the session cookie, so no
 * token ever lives in the browser (the cookie is httpOnly).
 */
export function ReviewSession({ profileId, versionId }: { profileId: string; versionId: string }) {
  useEffect(() => {
    let sessionId: string | null = null;
    let active = 0;
    let lastTick = Date.now();
    let visible = document.visibilityState === "visible";
    let stopped = false;

    const accrue = () => {
      const now = Date.now();
      if (visible) active += Math.round((now - lastTick) / 1000);
      lastTick = now;
    };

    const send = async (method: "POST" | "PATCH", body: unknown, keepalive = false) => {
      try {
        const res = await fetch("/api/review-session", {
          method,
          keepalive,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return res.ok ? ((await res.json()) as { id?: string }) : null;
      } catch {
        return null; // Best effort only: timing is never a gate.
      }
    };

    const start = async () => {
      const data = await send("POST", { profileId, versionId });
      if (!data?.id || stopped) return;
      sessionId = data.id;
    };

    const beat = (keepalive = false) => {
      if (!sessionId) return;
      accrue();
      void send("PATCH", { id: sessionId, activeSeconds: active }, keepalive);
    };

    const onVisibility = () => {
      accrue();
      visible = document.visibilityState === "visible";
      if (!visible) beat();
    };
    const onPageHide = () => beat(true);

    void start();
    const timer = setInterval(() => beat(), HEARTBEAT_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      beat(true);
    };
  }, [profileId, versionId]);

  return null;
}
