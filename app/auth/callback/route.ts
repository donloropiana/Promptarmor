import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath, signInPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * PKCE return URL: /auth/callback?code=...&next=/path
 *
 * Supabase's default email templates (and any PKCE flow started in this
 * browser) land here. Exchanges the code for a session, then redirects to a
 * validated same-origin `next`. The scanner-safe templates in docs/setup.md
 * use /auth/confirm (token_hash flow, works across devices) instead. There
 * is no Google or Microsoft sign-in: members connect those accounts in
 * Settings, after signing in by email.
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
