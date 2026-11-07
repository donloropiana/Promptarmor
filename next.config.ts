import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  // Dev only: Next prints every Server Function call with its arguments,
  // which would put sign-in passwords and pasted ad text into terminal logs.
  logging: {
    serverFunctions: false,
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
