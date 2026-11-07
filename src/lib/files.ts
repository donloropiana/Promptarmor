/**
 * File types and names for stored files: the private-assets bucket limits,
 * MIME resolution and Storage-safe filenames. Shared by the Supabase
 * storage helpers and the connectors. Pure functions; no I/O.
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
