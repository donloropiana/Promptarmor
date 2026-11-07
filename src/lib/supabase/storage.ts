import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeFilename } from "@/lib/files";
import type { Database } from "./types";

/**
 * Helpers for the private-assets bucket (docs/schema.md §6.10).
 *
 * - Writes use the secret-key admin client (the bucket has no write policy).
 * - Reads go through signed URLs; HTML gets `download: true` so it is never
 *   rendered from the Supabase origin.
 * - Version objects live at profiles/{profileId}/versions/{uuid}/{filename}
 *   and are write-once (never upserted).
 */

export const PRIVATE_ASSETS_BUCKET = "private-assets";

/** Signed URLs live for 60 minutes. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

type Client = SupabaseClient<Database>;

/** Fresh write-once path for a version's bytes. */
export function versionObjectPath(profileId: string, filename: string, mimeType?: string): string {
  const safe = sanitizeFilename(filename, mimeType);
  return `profiles/${profileId}/versions/${crypto.randomUUID()}/${safe}`;
}

/**
 * Uploads bytes to a fresh version path. Throws on failure. The caller stores
 * the returned path on the asset_versions row (unique per version).
 */
export async function uploadVersionBytes(
  admin: Client,
  input: { profileId: string; filename: string; bytes: Uint8Array; mimeType: string },
): Promise<{ path: string }> {
  const path = versionObjectPath(input.profileId, input.filename, input.mimeType);
  const { error } = await admin.storage.from(PRIVATE_ASSETS_BUCKET).upload(path, input.bytes, {
    contentType: input.mimeType,
    upsert: false,
    cacheControl: "0",
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return { path };
}

/** Downloads an object's bytes (admin or user client; RLS applies to the user client). */
export async function downloadObject(client: Client, path: string): Promise<Uint8Array> {
  const { data, error } = await client.storage.from(PRIVATE_ASSETS_BUCKET).download(path);
  if (error || !data) throw new Error(`Download failed: ${error?.message ?? "no data"}`);
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Signed read URL (60 min). HTML is always forced to download so browsers
 * never render it from the storage origin.
 */
export async function createSignedReadUrl(
  client: Client,
  path: string,
  options: { download?: boolean | string; mimeType?: string | null } = {},
): Promise<string | null> {
  const isHtml = (options.mimeType ?? "").toLowerCase().startsWith("text/html") || /\.html?$/i.test(path);
  const download = options.download ?? (isHtml ? true : undefined);
  const { data, error } = await client.storage
    .from(PRIVATE_ASSETS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, download !== undefined ? { download } : undefined);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
