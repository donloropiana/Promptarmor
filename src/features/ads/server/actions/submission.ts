import "server-only";

import type { ActionResult } from "@/lib/action-result";
import type { AdFile } from "@/features/ads/types";

/**
 * What a person may hand us as ad content, by file or by typing: the upload
 * size and type limits, the bounds on pasted text, reading the file out of
 * FormData, and which intake errors already speak plainly. A new ad
 * (uploadAd) and a reviewer's new version (addReviewerVersion) share it, so
 * both take exactly the same content.
 */

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel caps request bodies at 4.5 MB.
/** Pasted text: at least a sentence, at most 200,000 characters (intake keeps 60,000 for the check). */
export const MIN_TEXT_CHARS = 10;
export const MAX_TEXT_CHARS = 200_000;
/** Intake errors whose message is already written for the person who pasted or dropped the ad. */
export const PLAIN_INTAKE_CODES = new Set(["empty", "empty_file", "too_large", "unsupported_type", "not_member", "rate_limited", "no_content"]);
const ACCEPTED_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "text/html", "text/plain"]);
const ACCEPTED_EXT = /\.(pdf|png|jpe?g|webp|html?|txt)$/i;

export async function fileFromForm(formData: FormData): Promise<AdFile | ActionResult<never> | null> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "That file is over 4 MB. Export a smaller PDF or image and try again.", code: "too_large" };
  const mime = file.type || guessMime(file.name);
  if (!ACCEPTED_MIME.has(mime) && !ACCEPTED_EXT.test(file.name)) {
    return { ok: false, error: "Use a PDF, PNG, JPG, WebP, HTML or text file.", code: "unsupported" };
  }
  return { name: file.name || "ad", bytes: new Uint8Array(await file.arrayBuffer()), mimeType: ACCEPTED_MIME.has(mime) ? mime : guessMime(file.name) };
}

function guessMime(name: string): string {
  const ext = name.toLowerCase().split(".").pop();
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "html":
    case "htm":
      return "text/html";
    default:
      return "text/plain";
  }
}
