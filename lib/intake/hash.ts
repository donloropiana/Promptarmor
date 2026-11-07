import { createHash } from "node:crypto";

/**
 * Hashing helpers shared by intake and the check engine. Pure, synchronous,
 * and safe to import from scripts (no "server-only").
 */

/** Lowercase hex SHA-256 of bytes or a UTF-8 string. */
export function sha256Hex(data: Uint8Array | string): string {
  const h = createHash("sha256");
  h.update(typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data));
  return h.digest("hex");
}

/**
 * Normalization used for normalized_text_hash and for dedupe: NFKC,
 * lowercase, zero-width and soft-hyphen characters removed, whitespace
 * collapsed, trimmed.
 */
export function normalizeForHash(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[​-‍⁠﻿­]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** sha256 of the normalized text, or null when there is no text. */
export function normalizedTextHash(text: string | null | undefined): string | null {
  if (!text) return null;
  const n = normalizeForHash(text);
  return n ? sha256Hex(n) : null;
}

/** Short hex digest (first 12 chars of sha256) for labels such as prompt_hash. */
export function shortHash(input: string, length = 12): string {
  return sha256Hex(input).slice(0, length);
}
