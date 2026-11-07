/**
 * Writes fixtures/<key>.json, one file per ad in src/features/ads/samples.ts
 * (FIXTURE_ADS). The three empty-state chips (SAMPLE_ADS) are the same
 * objects, so the demo and the eval always agree.
 *
 *   bun scripts/write-fixtures.ts
 *
 * Removes stale fixtures/*.json whose key is no longer in the list.
 */
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FIXTURE_ADS, SAMPLE_KEYS } from "@/features/ads/samples";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures", import.meta.url));

async function main() {
  await mkdir(FIXTURES_DIR, { recursive: true });
  const keep = new Set<string>();

  for (const ad of FIXTURE_ADS) {
    const file = `${ad.key}.json`;
    keep.add(file);
    const json = {
      key: ad.key,
      title: ad.title,
      product: ad.product,
      channel: ad.channel,
      format: ad.format,
      text: ad.text,
      ...(ad.html ? { html: ad.html } : {}),
      ...(ad.revision ? { revision: ad.revision } : {}),
      ...(ad.revision_html ? { revision_html: ad.revision_html } : {}),
      expected_rule_codes: ad.expected_rule_codes,
      ...(ad.not_expected_rule_codes ? { not_expected_rule_codes: ad.not_expected_rule_codes } : {}),
      ...(ad.revision_expected_rule_codes ? { revision_expected_rule_codes: ad.revision_expected_rule_codes } : {}),
      ...(ad.revision_not_expected_rule_codes
        ? { revision_not_expected_rule_codes: ad.revision_not_expected_rule_codes }
        : {}),
      ...(ad.hidden_text ? { hidden_text: true } : {}),
      sample_chip: (SAMPLE_KEYS as readonly string[]).includes(ad.key),
      notes: ad.notes,
    };
    await writeFile(path.join(FIXTURES_DIR, file), `${JSON.stringify(json, null, 2)}\n`, "utf8");
  }

  let removed = 0;
  for (const entry of await readdir(FIXTURES_DIR)) {
    if (entry.endsWith(".json") && !keep.has(entry)) {
      await unlink(path.join(FIXTURES_DIR, entry));
      removed += 1;
    }
  }

  console.log(`Wrote ${keep.size} fixtures to ${FIXTURES_DIR}${removed ? ` (removed ${removed} stale)` : ""}`);
}

main().catch((err) => {
  console.error("write-fixtures failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
