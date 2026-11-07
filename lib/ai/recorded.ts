import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { ContentFinding, HiddenTextCandidate } from "./schema";

/**
 * Recorded checks: the output of one live analyzeContent call per sample ad
 * and fixture, written by scripts/record-fixtures.ts into
 * fixtures/recorded/<key>.json and keyed by the ad text's normalized hash
 * (lib/intake/hash.ts, the same hash intake stores on the version).
 *
 * In AI_MODE=replay the engine uses a recording whose hash matches the
 * version instead of calling a model, so demos and tests show real model
 * findings at $0. scripts/eval.ts --recorded scores them without spend.
 *
 * Files are read from <cwd>/fixtures/recorded. On a serverless host they
 * exist only when traced into the bundle; when the folder is missing the
 * loader just finds nothing and the run completes in off mode.
 */

export const RECORDED_DIR = path.join(process.cwd(), "fixtures", "recorded");

export type RecordedCheck = {
  /** Fixture key, or "<key>--revision" for a sample's scripted revision. */
  key: string;
  /** sha256 of the normalized ad text: the lookup key. */
  normalized_text_hash: string;
  /** sha256 of the raw text or HTML, as intake stores it on the version. */
  content_sha256: string;
  recorded_at: string;
  model: string;
  prompt_version: string;
  prompt_hash: string;
  product: string;
  channel?: string;
  format: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    cost_usd: number;
  };
  /** The merged output (deterministic + model) at recording time. */
  findings: ContentFinding[];
  hidden_text: HiddenTextCandidate[];
  deterministic_count: number;
};

function isRecording(v: unknown): v is RecordedCheck {
  if (!v || typeof v !== "object") return false;
  const r = v as Partial<RecordedCheck>;
  return (
    typeof r.key === "string" &&
    typeof r.normalized_text_hash === "string" &&
    /^[0-9a-f]{64}$/.test(r.normalized_text_hash) &&
    typeof r.model === "string" &&
    typeof r.prompt_hash === "string" &&
    Array.isArray(r.findings) &&
    Array.isArray(r.hidden_text) &&
    Boolean(r.usage) &&
    typeof r.usage === "object"
  );
}

let cache: Promise<Map<string, RecordedCheck>> | null = null;

async function readAll(dir: string): Promise<Map<string, RecordedCheck>> {
  const byHash = new Map<string, RecordedCheck>();
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return byHash;
  }
  for (const file of files) {
    try {
      const parsed: unknown = JSON.parse(await readFile(path.join(dir, file), "utf8"));
      if (!isRecording(parsed)) {
        console.warn(`[ai/recorded] ${file} is not a recording; skipped.`);
        continue;
      }
      // First file wins when two recordings share a hash (sorted by name, so deterministic).
      if (!byHash.has(parsed.normalized_text_hash)) byHash.set(parsed.normalized_text_hash, parsed);
    } catch (err) {
      console.warn(`[ai/recorded] ${file} could not be read: ${(err as Error).message}`);
    }
  }
  return byHash;
}

/** All recordings by normalized text hash. Read once per process; `fresh` re-reads (scripts). */
export async function loadRecordings(options: { dir?: string; fresh?: boolean } = {}): Promise<Map<string, RecordedCheck>> {
  const dir = options.dir ?? RECORDED_DIR;
  if (options.fresh || dir !== RECORDED_DIR) return readAll(dir);
  if (!cache) cache = readAll(dir);
  return cache;
}

/** The recording for an ad whose normalized text hash is `hash`, if any. */
export async function findRecording(hash: string | null | undefined): Promise<RecordedCheck | null> {
  if (!hash) return null;
  const all = await loadRecordings();
  return all.get(hash) ?? null;
}

/** The recording's findings as the engine expects them (nothing else is trusted from the file). */
export function recordedFindings(rec: RecordedCheck): ContentFinding[] {
  return rec.findings
    .filter((f) => f && typeof f.rule_code === "string" && typeof f.quote === "string")
    .map((f) => ({
      rule_code: f.rule_code,
      severity: f.severity === "critical" || f.severity === "minor" ? f.severity : "major",
      quote: f.quote.slice(0, 400),
      explanation: String(f.explanation ?? ""),
      suggested_fix: String(f.suggested_fix ?? ""),
      suggested_copy: typeof f.suggested_copy === "string" && f.suggested_copy.trim() ? f.suggested_copy : undefined,
      evidence_type:
        f.evidence_type === "exact_match" || f.evidence_type === "offer_mismatch" || f.evidence_type === "missing_disclosure"
          ? f.evidence_type
          : "needs_judgment",
    }));
}
