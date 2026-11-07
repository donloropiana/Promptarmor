import "server-only";

import { headers } from "next/headers";

import { getFallbackSiteUrl } from "@/lib/supabase/env";

const ORIGIN_RE = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i;
const HOST_RE = /^[a-z0-9.-]+(?::\d{1,5})?$/i;

/**
 * Public origin of the current request (e.g. https://promptarmor-two.vercel.app,
 * a preview URL, or http://localhost:3000). Used to build redirect URLs that
 * Supabase Auth then checks against its Redirect URLs allowlist, so a forged
 * Host header cannot send a user anywhere unlisted.
 *
 * Server Actions always carry an Origin header (Next.js rejects actions whose
 * Origin does not match the host), so it is preferred.
 */
export async function getRequestOrigin(): Promise<string> {
  const h = await headers();

  const origin = h.get("origin");
  if (origin && ORIGIN_RE.test(origin)) return origin.toLowerCase();

  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  if (host && HOST_RE.test(host)) {
    const forwardedProto = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim();
    const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
    const proto =
      forwardedProto === "http" || forwardedProto === "https"
        ? forwardedProto
        : isLocal
          ? "http"
          : "https";
    return `${proto}://${host.toLowerCase()}`;
  }

  return getFallbackSiteUrl();
}
