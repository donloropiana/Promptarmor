"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";

const HEARTBEAT_MS = 30_000;

/**
 * Measures reviewer time on this version. Inserts one review_sessions row
 * (surface 'workbench') when the page opens and bumps active_seconds every
 * 30 s while the tab is visible. The final write on page hide uses a
 * keepalive fetch with the bearer token (sendBeacon cannot send it).
 */
export function ReviewSession({ profileId, userId, versionId }: { profileId: string; userId: string; versionId: string }) {
  useEffect(() => {
    const supabase = createClient();
    const env = getPublicSupabaseEnv();
    if (!supabase || !env) return;

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

    const start = async () => {
      const { data, error } = await supabase
        .from("review_sessions")
        .insert({ profile_id: profileId, user_id: userId, asset_version_id: versionId, surface: "workbench" })
        .select("id")
        .single();
      if (error || !data) return;
      if (stopped) return;
      sessionId = data.id;
    };

    const beat = async () => {
      if (!sessionId) return;
      accrue();
      await supabase.from("review_sessions").update({ active_seconds: active }).eq("id", sessionId);
    };

    const finalBeat = async () => {
      if (!sessionId) return;
      accrue();
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        await fetch(`${env.url}/rest/v1/review_sessions?id=eq.${sessionId}`, {
          method: "PATCH",
          keepalive: true,
          headers: {
            apikey: env.publishableKey,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ active_seconds: active }),
        });
      } catch {
        // Best effort only.
      }
    };

    const onVisibility = () => {
      accrue();
      visible = document.visibilityState === "visible";
      if (!visible) void beat();
    };

    void start();
    const timer = setInterval(() => void beat(), HEARTBEAT_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", finalBeat);

    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", finalBeat);
      void finalBeat();
    };
  }, [profileId, userId, versionId]);

  return null;
}
