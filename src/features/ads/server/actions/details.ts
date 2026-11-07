"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { SIGNED_OUT, invalid, type ActionResult } from "@/lib/action-result";
import { getCurrentUser } from "@/features/auth/server/dal";
import type { Product } from "@/features/products/catalog";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

import { productSchema, rpcFailure, uuid } from "./shared";

/**
 * An ad's details on the Ad page: its product, channel and title, changed
 * through the update_asset RPC.
 */

export async function updateAdMeta(input: { assetId: string; product?: Product; channel?: string | null; title?: string }): Promise<ActionResult> {
  const parsed = z
    .object({
      assetId: uuid,
      product: productSchema.optional(),
      channel: z.string().trim().max(60).nullable().optional(),
      title: z.string().trim().min(1).max(200).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const patch: Record<string, Json> = {};
  if (parsed.data.product) patch.product = parsed.data.product;
  if (parsed.data.channel !== undefined) patch.channel = parsed.data.channel;
  if (parsed.data.title) patch.title = parsed.data.title;
  if (Object.keys(patch).length === 0) return { ok: true, data: null };
  const db = await createClient();
  const { error } = await db.rpc("update_asset", { p_asset_id: parsed.data.assetId, p_patch: patch });
  if (error) return rpcFailure(error);
  refresh();
  return { ok: true, data: null };
}
