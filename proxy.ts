import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicSupabaseEnv, warnSupabaseNotConfigured } from "@/lib/supabase/env";

/**
 * Next.js 16 Proxy (formerly Middleware). Its only job is @supabase/ssr
 * session refresh: rotate the access-token cookie before Server Components
 * and Route Handlers read it. It does NOT authorize anything; pages, Server
 * Actions and Route Handlers authorize through lib/auth/dal.ts.
 *
 * Missing env (e.g. Vercel env sync not configured yet) skips the refresh
 * with a one-time console.warn instead of failing every request.
 */
export async function proxy(request: NextRequest) {
  const env = getPublicSupabaseEnv();
  if (!env) {
    warnSupabaseNotConfigured("proxy");
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Cache-Control etc. so a CDN never caches a response carrying a
        // refreshed session cookie.
        for (const [key, value] of Object.entries(headers ?? {})) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Do not run code between createServerClient and getClaims(). getClaims()
  // verifies the JWT (JWKS, ES256) and refreshes an expired session, writing
  // the new cookies through setAll above.
  try {
    await supabase.auth.getClaims();
  } catch (err) {
    console.error("[proxy] session refresh failed:", (err as Error).message);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except:
     * - _next/static, _next/image (build output, image optimizer)
     * - favicon.ico and common static asset extensions
     * - api/nango/webhook (server-to-server; raw body + signature check,
     *   no session cookie)
     */
    "/((?!_next/static|_next/image|favicon.ico|api/nango/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|txt|xml|woff2?|ttf|map)$).*)",
  ],
};
