"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { SIGNED_OUT, invalid, type ActionResult } from "@/lib/action-result";
import { visibleLength } from "@/features/analysis/infer";
import { getActiveProfileId, getCurrentUser, getMembershipRole } from "@/features/auth/server/dal";
import { IntakeError, acceptSourceItem, createAd, createSampleAd, declineSourceItem } from "@/features/ads/server/intake";
import { createClient } from "@/lib/supabase/server";

import { fail, isFailure, kickAnalysis, productSchema, uuid } from "./shared";
import { MAX_TEXT_CHARS, MIN_TEXT_CHARS, PLAIN_INTAKE_CODES, fileFromForm } from "./submission";

/**
 * Getting ads in: a dropped or chosen file, pasted text, a sample from the
 * empty state, and the "Is this an ad?" answer for a connector arrival. Each
 * creates the ad through intake and starts its check.
 */

const NO_WORKSPACE: ActionResult<never> = { ok: false, error: "Pick a workspace first.", code: "no_workspace" };

async function requireUserAndWorkspace(): Promise<{ userId: string; profileId: string } | ActionResult<never>> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const profileId = await getActiveProfileId();
  if (!profileId) return NO_WORKSPACE;
  const role = await getMembershipRole(profileId);
  if (!role) return NO_WORKSPACE;
  return { userId: user.id, profileId };
}

/**
 * Creates an ad from a dropped/chosen file or pasted text (FormData fields:
 * file | text, optional title, product, channel) and opens its page.
 * Redirects on success; returns an error otherwise.
 */
export async function uploadAd(formData: FormData): Promise<ActionResult<never>> {
  const ctx = await requireUserAndWorkspace();
  if (isFailure(ctx)) return ctx;

  const text = String(formData.get("text") ?? "").trim();
  const titleRaw = String(formData.get("title") ?? "").trim();
  const productRaw = String(formData.get("product") ?? "").trim();
  const channelRaw = String(formData.get("channel") ?? "").trim();
  const parsedProduct = productSchema.safeParse(productRaw);
  const product = parsedProduct.success ? parsedProduct.data : undefined;

  const file = await fileFromForm(formData);
  if (file && "ok" in file) return file;
  // Visible characters only: whitespace, zero-width and other invisible
  // characters never count as ad text.
  if (!file && visibleLength(text) < MIN_TEXT_CHARS) return { ok: false, error: "Paste the ad text (at least a sentence) or choose a file.", code: "invalid_input" };
  if (text.length > MAX_TEXT_CHARS) return { ok: false, error: `That text is too long. Paste up to ${MAX_TEXT_CHARS.toLocaleString("en-US")} characters.`, code: "invalid_input" };

  let created: { assetId: string; versionId: string };
  try {
    if (file) {
      const isHtml = file.mimeType === "text/html";
      const isText = file.mimeType === "text/plain";
      const decoded = isHtml || isText ? new TextDecoder().decode(file.bytes) : undefined;
      created = await createAd({
        profileId: ctx.profileId,
        userId: ctx.userId,
        origin: "upload",
        title: titleRaw || undefined,
        file: isHtml || isText ? undefined : file,
        html: isHtml ? decoded : undefined,
        text: isText ? decoded : undefined,
        product,
        channel: channelRaw || undefined,
      });
    } else {
      created = await createAd({
        profileId: ctx.profileId,
        userId: ctx.userId,
        origin: "paste",
        title: titleRaw || undefined,
        text,
        product,
        channel: channelRaw || undefined,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/unchanged|identical|PT409/i.test(message)) return { ok: false, error: "This exact ad is already in the workspace.", code: "PT409" };
    // Intake already says in plain English what was wrong with the input.
    if (err instanceof IntakeError && PLAIN_INTAKE_CODES.has(err.code)) return { ok: false, error: err.message, code: err.code };
    if (err instanceof IntakeError && err.code === "pdf_unreadable") {
      console.error("[ads] pdf unreadable:", message);
      return { ok: false, error: "That PDF could not be read. Export it again from the original file, or paste the text.", code: err.code };
    }
    return fail(err, "We could not read that ad. Try a different file or paste the text.");
  }
  kickAnalysis(created.versionId);
  redirect(`/ads/${created.assetId}`);
}

/** Pasted text only (used by the paste tab and the empty-state textarea). */
export async function pasteAd(input: { text: string; title?: string }): Promise<ActionResult<never>> {
  const fd = new FormData();
  fd.set("text", input.text ?? "");
  if (input.title) fd.set("title", input.title);
  return uploadAd(fd);
}

/** Starts a sample ad (empty state chips) and opens it. */
export async function trySample(sampleKey: string): Promise<ActionResult<never>> {
  const parsed = z.string().trim().min(1).max(80).safeParse(sampleKey);
  if (!parsed.success) return invalid(parsed.error);
  const ctx = await requireUserAndWorkspace();
  if (isFailure(ctx)) return ctx;
  let created: { assetId: string; versionId: string };
  try {
    created = await createSampleAd({ profileId: ctx.profileId, userId: ctx.userId, sampleKey: parsed.data });
  } catch (err) {
    return fail(err, "We could not start that sample. Try again.");
  }
  kickAnalysis(created.versionId);
  redirect(`/ads/${created.assetId}`);
}

/** "Is this an ad?" Yes creates the ad and starts its check; No declines the item. */
export async function triageSourceItem(input: { sourceItemId: string; accept: boolean }): Promise<ActionResult<{ assetId: string | null }>> {
  const parsed = z.object({ sourceItemId: uuid, accept: z.boolean() }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const db = await createClient();
  const { data: item } = await db.from("source_items").select("id, profile_id, triage_status").eq("id", parsed.data.sourceItemId).maybeSingle();
  if (!item) return { ok: false, error: "That item is no longer waiting.", code: "PT404" };
  if (item.triage_status !== "pending") return { ok: false, error: "Someone already answered for this item.", code: "PT409" };
  try {
    if (parsed.data.accept) {
      const created = await acceptSourceItem({ sourceItemId: item.id, userId: user.id });
      kickAnalysis(created.versionId);
      refresh();
      return { ok: true, data: { assetId: created.assetId } };
    }
    await declineSourceItem({ sourceItemId: item.id, userId: user.id });
    refresh();
    return { ok: true, data: { assetId: null } };
  } catch (err) {
    return fail(err, parsed.data.accept ? "We could not turn that item into an ad." : "We could not skip that item.");
  }
}
