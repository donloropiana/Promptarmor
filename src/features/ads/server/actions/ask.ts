"use server";

import { z } from "zod";

import { SIGNED_OUT, invalid, type ActionResult } from "@/lib/action-result";
import { askAboutAd as askAboutAdEngine } from "@/features/analysis/server/chat";
import { getCurrentUser } from "@/features/auth/server/dal";
import { createClient } from "@/lib/supabase/server";

import { NOT_FOUND, fail, uuid } from "./shared";

/**
 * "Ask about this ad": read-only Q&A over one version, and the plain-English
 * wording for every way an answer can fail to come back.
 */

/** Read-only Q&A over one version. Never approves, rejects or changes anything. */
export async function askAboutAd(input: { assetVersionId: string; question: string }): Promise<ActionResult<{ answer: string }>> {
  const parsed = z
    .object({ assetVersionId: uuid, question: z.string().trim().min(2, { error: "Ask a question first." }).max(1000, { error: "Keep the question under 1,000 characters." }) })
    .safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const db = await createClient();
  const { data: version } = await db.from("asset_versions").select("id, profile_id").eq("id", parsed.data.assetVersionId).maybeSingle();
  if (!version) return NOT_FOUND;
  try {
    const result = await askAboutAdEngine({ profileId: version.profile_id, userId: user.id, assetVersionId: version.id, question: parsed.data.question });
    if (!result.ok) return { ok: false, error: plainAskError(result.error), code: "ask_failed" };
    return { ok: true, data: { answer: result.answer } };
  } catch (err) {
    return fail(err, "Ask isn't available right now. Try again in a moment.");
  }
}

/** One plain-English shape for every "no answer" case: what happened, then what to do. */
function plainAskError(raw: string): string {
  const detail = raw.replace(/^Ask about this ad is not available( right now)?:\s*/i, "").trim();
  if (/ask a question first/i.test(detail)) return detail;
  if (/budget/i.test(detail)) return "Ask isn't available right now: today's AI budget for this workspace is used up. The issues above still stand; try again tomorrow.";
  if (/not configured|gateway|verification|credit|payment|billing|api key|unauthori[sz]ed|forbidden/i.test(detail)) {
    return "Ask isn't available right now: the AI service is not accepting requests for this workspace. The issues above still stand; a person can still decide.";
  }
  if (/different way|no answer/i.test(detail)) return "No answer came back. Try asking in a different way.";
  return `Ask isn't available right now. ${detail.replace(/\s*A person must review this ad\.?$/i, "")}`.trim();
}
