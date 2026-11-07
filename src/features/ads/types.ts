/**
 * Shared ad/version/finding types (contract shared by every engineer).
 *
 * These mirror the database (docs/schema.md §2) but use the product's words
 * where the two differ. Keep this file dependency-free: it is imported by
 * server code, client components and scripts alike.
 */

/** assets.product */
export type Product = "personal_loan" | "credit_card" | "mortgage" | "other" | "unknown";

/** findings.severity */
export type Severity = "critical" | "major" | "minor";

/**
 * asset_versions.content. `extracted_text` on the same row is the plain text
 * (all sections joined by blank lines) that finding anchors point into.
 */
export type VersionContent = {
  format: "text" | "html" | "pdf" | "image";
  /** Plain-text ads (paste, email body). */
  text?: string;
  /** Raw HTML of HTML creative. Untrusted: render only in a sandboxed iframe. */
  html?: string;
  /** Original filename for uploaded files. */
  filename?: string;
  /** IANA media type of the stored bytes. */
  mimeType?: string;
  /** Logical sections of the ad (paragraphs, headline/body/disclosure, pages). */
  sections?: { id: string; label: string; text: string }[];
  /**
   * What intake inferred about the ad, plus free-form notes (sampleKey for
   * sample ads, note for reviewer edits, pages for PDFs, source for arrivals).
   */
  meta?: { product?: Product; channel?: string; inferred?: boolean; [key: string]: unknown };
};

/** findings.anchor: character offsets into asset_versions.extracted_text. */
export type FindingAnchor = { start: number; end: number; section_id?: string };

/**
 * findings.anchor for a reviewer's pin on an image ad: fractions 0..1 of the
 * rendered image (x, y = the pinned point; w, h = an optional box). Never
 * matched against text, so a pin is always "new" on a later version.
 */
export type ImageRegionAnchor = { type: "image_region"; x: number; y: number; w?: number; h?: number };

/** Longest label an image note may carry (its `quote`); the details go in the explanation. */
export const MAX_IMAGE_LABEL_CHARS = 120;

/** Parses a raw findings.anchor into an ImageRegionAnchor, or null when it is not one. */
export function imageRegionOf(raw: unknown): ImageRegionAnchor | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const a = raw as Record<string, unknown>;
  if (a.type !== "image_region") return null;
  const frac = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
  if (!frac(a.x) || !frac(a.y)) return null;
  return { type: "image_region", x: a.x, y: a.y, ...(frac(a.w) ? { w: a.w } : {}), ...(frac(a.h) ? { h: a.h } : {}) };
}

/** An uploaded file handed to intake. */
export type AdFile = { name: string; bytes: Uint8Array; mimeType: string };

/** Key of a sample ad in lib/seed/samples (SAMPLE_ADS[].key). */
export type SampleKey = string;
