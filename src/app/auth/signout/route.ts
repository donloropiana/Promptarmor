import { NextResponse, type NextRequest } from "next/server";

import { ACTIVE_PROFILE_COOKIE } from "@/features/auth/server/dal";
import { signInPath } from "@/features/auth/redirect";
import { isSameOrigin } from "@/features/connections/server/route-auth";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /auth/signout  (<form method="post" action="/auth/signout">)
 *
 * Signs out this browser session and 303s to /signin. An optional form
 * field `next` (same-origin path, validated) is carried to the sign-in page,
 * e.g. to switch accounts and come back to an invitation.
 * Cross-origin POSTs, and POSTs with neither Origin nor Sec-Fetch-Site:
 * same-origin, are refused (Route Handlers get no built-in CSRF check).
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  let next: string | undefined;
  try {
    const form = await request.formData();
    const v = form.get("next");
    if (typeof v === "string") next = v;
  } catch {
    // No form body (e.g. fetch without body): fine.
  }

  try {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: "local" });
  } catch (err) {
    console.error("[auth/signout]", (err as Error).message);
  }

  const response = NextResponse.redirect(new URL(signInPath(next), request.nextUrl.origin), {
    status: 303,
  });
  response.cookies.delete(ACTIVE_PROFILE_COOKIE);
  return response;
}
