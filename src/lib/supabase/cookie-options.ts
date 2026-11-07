/**
 * Session cookie attributes shared by every @supabase/ssr server client
 * (src/lib/supabase/server.ts and src/proxy.ts).
 *
 * httpOnly is deliberate: no code in the browser reads the session (there is
 * no browser Supabase client), so script injected into a page can never read
 * the token. Every data write goes through a Server Action or a same-origin
 * Route Handler, which read the cookie on the server.
 */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
} as const;
