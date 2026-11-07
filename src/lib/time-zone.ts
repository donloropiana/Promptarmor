/**
 * One time zone for every date the app prints. Server (UTC on Vercel) and
 * browser (wherever the reviewer sits) then render identical text, so there
 * are no hydration mismatches, and an audit record reads the same for every
 * member. Defaults to the demo workspace's zone; override per deployment.
 */
export const APP_TIME_ZONE = process.env.NEXT_PUBLIC_TIME_ZONE || "America/Chicago";
