import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath, signInPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth (Google) PKCE return URL: /auth/callback?code=...&next=/path
 *
 * Exchanges the code for a session (the PKCE verifier cookie was set by the
 * signInWithGoogle Server Action in this same browser), then redirects to a
 * validated same-origin `next`. Email links do not come here: they go to
 * /auth/confirm (token_hash flow, works across devices).
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeNextPath(url.searchParams.get("next"));
  const code = url.searchParams.get("code");

  if (url.searchParams.get("error")) {
    // Provider-side failure or user cancelled consent. Do not echo the
    // provider's error text into our UI.
    return NextResponse.redirect(new URL(signInPath(next, "oauth"), url.origin));
  }

  if (code && code.length <= 1024) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return NextResponse.redirect(new URL(next, url.origin));
      }
      console.warn("[auth/callback] code exchange failed:", error.code ?? error.status);
    } catch (err) {
      console.error("[auth/callback]", (err as Error).message);
    }
  }

  return NextResponse.redirect(new URL(signInPath(next, "callback"), url.origin));
}
