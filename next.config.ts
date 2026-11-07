import type { NextConfig } from "next";

/**
 * Response headers for every route. The creative preview renders untrusted
 * HTML only inside a sandboxed srcdoc iframe with its own CSP
 * (components/ads/creative-view.tsx); these headers protect the app pages
 * themselves: no framing by other sites (clickjacking), no MIME sniffing of
 * responses, a referrer that never leaks ad ids to the sites an ad links to,
 * and no plugins or <base> hijacking. Vercel adds Strict-Transport-Security.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
];

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
    // Uploads go through a Server Action (lib/actions/ads.ts uploadAd); the
    // default 1 MB body limit would refuse a 2 MB PDF before our own 4 MB
    // check ran. Vercel caps request bodies at 4.5 MB.
    serverActions: {
      bodySizeLimit: "4500kb",
    },
  },
  cacheComponents: true,
  partialPrefetching: true,
  // Dev only: Next prints every Server Function call with its arguments,
  // which would put sign-in passwords and pasted ad text into terminal logs.
  logging: {
    serverFunctions: false,
  },
  // Never advertise the framework.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
  // Public Supabase values for browser bundles, mapped from the server-side
  // names Doppler/Vercel provide. Public values ONLY: never map
  // SUPABASE_SECRET_KEY or NANGO_SECRET_KEY here (everything in `env` is
  // inlined into client JavaScript). Empty string when unset so builds work
  // without env; lib/supabase/env.ts treats "" as "not configured".
  env: {
    // `||`, not `??`: an empty NEXT_PUBLIC_* value must fall back too.
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      "",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
