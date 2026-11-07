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

/** An uploaded file handed to intake. */
export type AdFile = { name: string; bytes: Uint8Array; mimeType: string };

/** Key of a sample ad in lib/seed/samples (SAMPLE_ADS[].key). */
export type SampleKey = string;
