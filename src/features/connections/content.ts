/**
 * Content helpers for the sync pipeline: hashing (Web Crypto), text
 * normalization, a dependency-free HTML -> text converter, MIME helpers and
 * Storage-safe filenames. Pure functions; no I/O.
 *
 * All inputs are untrusted submitted content. Nothing here executes or
 * renders it.
 */

export const MAX_STORE_BYTES = 25 * 1024 * 1024; // private-assets bucket limit

/** Mime types the private-assets bucket accepts (20261106170400_storage.sql). */
export const STORABLE_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/html",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "message/rfc822",
]);

const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  html: "text/html",
  htm: "text/html",
  txt: "text/plain",
  md: "text/plain",
  csv: "text/csv",
  eml: "message/rfc822",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
  mp4: "video/mp4",
};

export function baseMime(mime: string | null | undefined): string {
  return (mime ?? "").split(";")[0].trim().toLowerCase();
}

/** Best mime for a part: the declared type unless it is generic, then the extension. */
export function resolveMime(declared: string | null | undefined, filename: string | null | undefined): string {
  const m = baseMime(declared);
  if (m && m !== "application/octet-stream" && m !== "binary/octet-stream") {
    if (m === "image/jpg") return "image/jpeg";
    return m;
  }
  const ext = (filename ?? "").toLowerCase().split(".").pop() ?? "";
  return EXT_MIME[ext] ?? (m || "application/octet-stream");
}

export function isTextMime(mime: string): boolean {
  return mime === "text/plain" || mime === "text/html" || mime === "text/csv" || mime === "text/markdown";
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

export function extensionFor(mime: string): string {
  for (const [ext, m] of Object.entries(EXT_MIME)) if (m === mime) return ext;
  return "bin";
}

/** Signature logos, tracking pixels and CID images are not creative. */
export function isInlineImage(
  mime: string,
  size: number | null,
  contentId: string | null,
  disposition: string,
  filename: string,
): boolean {
  if (!isImageMime(mime)) return false;
  const s = size ?? 0;
  if (s > 0 && s < 8 * 1024) return true;
  const inlineish = Boolean(contentId) || disposition.startsWith("inline");
  if (inlineish && s < 50 * 1024) return true;
  if (/^(image\d{2,4}|logo|signature|sig|outlook-|spacer|pixel|icon|facebook|twitter|linkedin|instagram)/i.test(filename) && s < 100 * 1024) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  // Copy into a fresh ArrayBuffer so subtle.digest gets a plain BufferSource.
  const buf = new Uint8Array(bytes.byteLength);
  buf.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const out = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < out.length; i++) hex += out[i].toString(16).padStart(2, "0");
  return hex;
}

/**
 * Normalization for normalized_text_hash: NFKC, lowercase, zero-width and
 * soft-hyphen characters removed, whitespace collapsed, trimmed.
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[​-‍⁠﻿­]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Below this many normalized characters a text hash is too generic to dedupe on. */
export const MIN_TEXT_FOR_HASH_DEDUPE = 80;

export async function normalizedTextHash(text: string | null | undefined): Promise<{ hash: string | null; length: number }> {
  if (!text) return { hash: null, length: 0 };
  const n = normalizeText(text);
  if (!n) return { hash: null, length: 0 };
  return { hash: await sha256Hex(n), length: n.length };
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/** Decode base64 or base64url (Gmail) into bytes. */
export function base64ToBytes(input: string): Uint8Array {
  const s = input.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  if (typeof Buffer !== "undefined") {
    const b = Buffer.from(padded, "base64");
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  }
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToText(bytes: Uint8Array, charset?: string | null): string {
  const label = (charset ?? "utf-8").toLowerCase().replace(/["']/g, "");
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

export function charsetOf(contentType: string | null | undefined): string | null {
  const m = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType ?? "");
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// HTML -> text (no DOM, no execution)
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  deg: "°",
  percnt: "%",
  dollar: "$",
  cent: "¢",
  pound: "£",
  euro: "€",
  sup1: "¹",
  sup2: "²",
  sup3: "³",
  dagger: "†",
  Dagger: "‡",
  sect: "§",
  para: "¶",
  zwnj: "‌",
  zwj: "‍",
  shy: "­",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (m, ent: string) => {
    if (ent[0] === "#") {
      const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    }
    return NAMED_ENTITIES[ent] ?? NAMED_ENTITIES[ent.toLowerCase()] ?? m;
  });
}

/**
 * Visible-ish text of an HTML document. Keeps alt text and link targets
 * (disclosures often live in them). Hidden-text detection is the security
 * scan's job, not this function's: everything textual is kept.
 */
export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|head|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, " ");
  // alt text of images
  s = s.replace(/<img\b[^>]*?\balt\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi, (_m, _q, a, b) => ` ${a ?? b ?? ""} `);
  // link targets after the anchor text
  s = s.replace(
    /<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi,
    (_m, _q, a: string | undefined, b: string | undefined, inner: string) => {
      const href = (a ?? b ?? "").trim();
      const show = /^https?:\/\//i.test(href) && href.length < 300 ? ` (${href})` : "";
      return `${inner}${show}`;
    },
  );
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|li|h[1-6]|table|section|article|header|footer|blockquote|ul|ol)\s*>/gi, "\n");
  s = s.replace(/<(td|th)\b[^>]*>/gi, " \t");
  s = s.replace(/<li\b[^>]*>/gi, "\n- ");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/ /g, " ");
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

// ---------------------------------------------------------------------------
// Filenames
// ---------------------------------------------------------------------------

/** Storage-key-safe filename (ASCII letters, digits, dot, dash, underscore). */
export function sanitizeFilename(name: string | null | undefined, fallbackMime?: string): string {
  let n = (name ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "");
  n = n.replace(/[/\\]+/g, "_");
  n = n.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/_+\./g, ".");
  n = n.replace(/^[._-]+/, "").replace(/[._-]+$/, "");
  if (n.length > 120) {
    const dot = n.lastIndexOf(".");
    const ext = dot > 0 && n.length - dot <= 10 ? n.slice(dot) : "";
    n = n.slice(0, 120 - ext.length) + ext;
  }
  if (!n) n = `file.${extensionFor(fallbackMime ?? "")}`;
  if (!n.includes(".") && fallbackMime) n = `${n}.${extensionFor(fallbackMime)}`;
  return n;
}

/** Parse 'Name <user@example.com>' into its parts. */
export function parseAddress(raw: string | null | undefined): { name: string | null; email: string | null } {
  if (!raw) return { name: null, email: null };
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() || null };
  const e = /[^\s<>"]+@[^\s<>"]+/.exec(raw);
  return { name: null, email: e ? e[0].toLowerCase() : null };
}

export function clip(s: string, max: number): string;
export function clip(s: string | null | undefined, max: number): string | null;
export function clip(s: string | null | undefined, max: number): string | null {
  if (s == null) return null;
  return s.length > max ? s.slice(0, max) : s;
}
