import { z } from "zod";

import { authorizeMember, isSameOrigin, json } from "@/features/connections/server/route-auth";
import { getSupabaseContext } from "@/lib/supabase/context";

/**
 * Reviewer time on a version (review_sessions), written from the ad page's
 * heartbeat. Same-origin only; the row is inserted and updated under RLS as
 * the signed-in user (own rows only), and the database trigger caps
 * active_seconds growth at wall-clock time since the previous heartbeat, so a
 * tampered client cannot inflate it.
 *
 *   POST  { profileId, versionId }   -> { id }   (opens a session)
 *   PATCH { id, activeSeconds }      -> {}       (heartbeat; also sent on page hide)
 *
 * Every failure is best effort for the caller: timing is a nicety, never a
 * gate, so the page ignores non-2xx answers.
 */

const StartBody = z.object({ profileId: z.guid(), versionId: z.guid() });
const BeatBody = z.object({ id: z.guid(), activeSeconds: z.number().int().min(0).max(60 * 60 * 24) });

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return json({ error: "Cross-origin request rejected." }, 403);
  let input: z.infer<typeof StartBody>;
  try {
    input = StartBody.parse(await request.json());
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const auth = await authorizeMember(input.profileId);
  if (!auth.ok) return auth.response;
  const supabase = (await getSupabaseContext())?.supabase;
  if (!supabase) return json({ error: "Sign in to continue." }, 401);

  const { data, error } = await supabase
    .from("review_sessions")
    .insert({ profile_id: input.profileId, user_id: auth.user.id, asset_version_id: input.versionId, surface: "workbench" })
    .select("id")
    .single();
  if (error || !data) return json({ error: "Could not start the review timer." }, 500);
  return json({ id: data.id });
}

export async function PATCH(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return json({ error: "Cross-origin request rejected." }, 403);
  let input: z.infer<typeof BeatBody>;
  try {
    input = BeatBody.parse(await request.json());
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const supabase = (await getSupabaseContext())?.supabase;
  if (!supabase) return json({ error: "Sign in to continue." }, 401);

  // RLS (review_sessions_update_own) limits this to the caller's own rows.
  const { error } = await supabase.from("review_sessions").update({ active_seconds: input.activeSeconds }).eq("id", input.id);
  if (error) return json({ error: "Could not record review time." }, 500);
  return json({});
}
