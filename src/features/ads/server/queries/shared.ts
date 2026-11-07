import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/types";
import type { VersionContent } from "@/features/ads/types";

/**
 * What the ads reads share. Every read in queries/ goes through the
 * user-context client (Db), so RLS decides what the member can see. Nothing
 * here writes. All reads tolerate a half-built workspace (no rules, no runs,
 * no decisions) and return empty shapes instead of throwing. This module owns
 * the client type, member name lookups, parsing a version's content JSON, and
 * signed links to files in private storage.
 */

export type Db = SupabaseClient<Database>;
const BUCKET = "private-assets";
const SIGNED_URL_TTL = 60 * 60;

type UserLite = { id: string; full_name: string | null; email: string };

export async function loadUsers(db: Db, ids: Iterable<string | null | undefined>): Promise<Map<string, UserLite>> {
  const unique = [...new Set([...ids].filter((v): v is string => Boolean(v)))];
  const map = new Map<string, UserLite>();
  if (unique.length === 0) return map;
  const { data } = await db.from("users").select("id, full_name, email").in("id", unique);
  for (const u of data ?? []) map.set(u.id, u);
  return map;
}

export function contentOf(json: Json | null | undefined): VersionContent {
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const c = json as Record<string, unknown>;
    const format = c.format;
    return {
      ...(c as unknown as VersionContent),
      format: format === "html" || format === "pdf" || format === "image" ? format : "text",
    };
  }
  return { format: "text" };
}

export async function signUrls(db: Db, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const { data, error } = await db.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL);
  if (error || !data) return out;
  for (const item of data) {
    if (item.signedUrl && item.path) out.set(item.path, item.signedUrl);
  }
  return out;
}

export async function signUrl(db: Db, path: string | null, download = false): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL, download ? { download: true } : undefined);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
