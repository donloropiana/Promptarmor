/**
 * Consistency checks for the seed content. Exits 1 on any problem.
 *
 *   bun scripts/check-fixtures.ts
 *
 * Checks:
 * - every expected / not_expected rule code (incl. revision lists) exists in
 *   STARTER_RULES, and no code is in both lists of the same ad;
 * - every rule's reference_ids exist in REFERENCE_LIBRARY; codes are unique
 *   and within the database's 40-character limit; bodies within 20,000 chars;
 * - every starter product code is unique and its terms carry a summary;
 * - fixture keys are unique and the three sample chips exist;
 * - each ad's expected rules apply to its product (applies_to);
 * - each ad is 30 to 300 words (10 for banners, texts and search ads); an HTML ad's visible text matches `text`;
 *   an ad flagged hidden_text really has an instruction in its HTML;
 * - fixtures/*.json on disk match FIXTURE_ADS (run write-fixtures first).
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FIXTURE_ADS, SAMPLE_ADS, SAMPLE_KEYS } from "@/lib/seed/samples";
import { STARTER_PRODUCTS } from "@/lib/seed/starter-products";
import { REFERENCE_LIBRARY, STARTER_RULES } from "@/lib/seed/starter-rules";

const problems: string[] = [];
const warn = (msg: string) => problems.push(msg);

const ruleByCode = new Map(STARTER_RULES.map((r) => [r.code, r]));
const refIds = new Set(REFERENCE_LIBRARY.map((r) => r.id));

// Rules
const seenCodes = new Set<string>();
for (const r of STARTER_RULES) {
  if (seenCodes.has(r.code)) warn(`duplicate rule code ${r.code}`);
  seenCodes.add(r.code);
  if (r.code.length > 40) warn(`rule code too long (>40): ${r.code}`);
  if (r.title.length > 200) warn(`rule title too long (>200): ${r.code}`);
  if (r.body.length > 20000 || r.body.length < 1) warn(`rule body length out of range: ${r.code}`);
  if (!["critical", "major", "minor"].includes(r.default_severity)) warn(`bad severity on ${r.code}`);
  if (!["regulatory", "policy", "offer", "security"].includes(r.kind)) warn(`bad kind on ${r.code}`);
  if (r.reference_ids.length === 0) warn(`rule ${r.code} cites no reference`);
  for (const id of r.reference_ids) if (!refIds.has(id)) warn(`rule ${r.code} cites unknown reference ${id}`);
  if (r.applies_to.length === 0) warn(`rule ${r.code} applies to nothing`);
}
for (const ref of REFERENCE_LIBRARY) {
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(ref.id)) warn(`reference id fails the DB pattern: ${ref.id}`);
  if (!/^https:\/\//.test(ref.url)) warn(`reference url is not https: ${ref.id}`);
}
const unreferenced = REFERENCE_LIBRARY.filter((ref) => !STARTER_RULES.some((r) => r.reference_ids.includes(ref.id)));
for (const ref of unreferenced) warn(`reference ${ref.id} is cited by no rule`);

// Products
const seenProducts = new Set<string>();
for (const p of STARTER_PRODUCTS) {
  if (seenProducts.has(p.code)) warn(`duplicate product code ${p.code}`);
  seenProducts.add(p.code);
  if (typeof p.terms.summary !== "string" || !p.terms.summary) warn(`product ${p.code} has no summary`);
  if (!["personal_loan", "credit_card", "mortgage", "other"].includes(p.product)) warn(`product ${p.code} bad product`);
}

// Fixtures
function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/?(?:a|span|b|strong|em|i|u)\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
function normalize(text: string): string {
  return text.replace(/^\s*-\s+/gm, "").replace(/\s+/g, " ").trim().toLowerCase();
}
function appliesTo(code: string, product: string): boolean {
  const rule = ruleByCode.get(code);
  if (!rule) return false;
  const scope = rule.applies_to as string[];
  return scope.includes("all") || scope.includes(product);
}

const seenKeys = new Set<string>();
for (const ad of FIXTURE_ADS) {
  if (seenKeys.has(ad.key)) warn(`duplicate fixture key ${ad.key}`);
  seenKeys.add(ad.key);
  if (!/^[a-z0-9-]+$/.test(ad.key)) warn(`fixture key is not kebab-case: ${ad.key}`);

  const lists: [string, string[] | undefined][] = [
    ["expected_rule_codes", ad.expected_rule_codes],
    ["not_expected_rule_codes", ad.not_expected_rule_codes],
    ["revision_expected_rule_codes", ad.revision_expected_rule_codes],
    ["revision_not_expected_rule_codes", ad.revision_not_expected_rule_codes],
  ];
  for (const [name, list] of lists) {
    for (const code of list ?? []) {
      if (!ruleByCode.has(code)) warn(`${ad.key}: ${name} has unknown rule code ${code}`);
    }
  }
  for (const code of ad.expected_rule_codes) {
    if (ad.not_expected_rule_codes?.includes(code)) warn(`${ad.key}: ${code} is both expected and not expected`);
    if (ad.product !== "other" && ruleByCode.has(code) && !appliesTo(code, ad.product)) {
      warn(`${ad.key}: expected ${code} does not apply to product ${ad.product}`);
    }
  }
  for (const code of ad.revision_expected_rule_codes ?? []) {
    if (ad.revision_not_expected_rule_codes?.includes(code)) {
      warn(`${ad.key}: revision ${code} is both expected and not expected`);
    }
  }

  const words = ad.text.trim().split(/\s+/).length;
  // Banners and texts are short by nature; everything else should read like a real ad.
  const minWords = ["display", "sms", "paid_search"].includes(ad.channel) ? 10 : 30;
  if (words < minWords || words > 300) warn(`${ad.key}: ${words} words (want ${minWords} to 300)`);

  if (ad.format === "html") {
    if (!ad.html) warn(`${ad.key}: format html but no html`);
    else if (visibleText(ad.html) !== normalize(ad.text)) warn(`${ad.key}: text does not match the html's text content`);
    if (ad.revision && !ad.revision_html) warn(`${ad.key}: html ad has a revision but no revision_html`);
    if (ad.revision && ad.revision_html && visibleText(ad.revision_html) !== normalize(ad.revision)) {
      warn(`${ad.key}: revision text does not match revision_html`);
    }
  } else if (ad.html) {
    warn(`${ad.key}: format text but html present`);
  }

  if (ad.hidden_text) {
    const hasHiddenCss = /font-size:\s*[0-3]px|color:\s*#fff(?:fff)?\b|display:\s*none|visibility:\s*hidden/i.test(ad.html ?? "");
    if (!hasHiddenCss) warn(`${ad.key}: hidden_text is true but the html has no hidden-text styling`);
    if (!ad.expected_rule_codes.includes("HIDDEN-TEXT")) warn(`${ad.key}: hidden_text is true but HIDDEN-TEXT is not expected`);
  } else if (ad.expected_rule_codes.includes("HIDDEN-TEXT")) {
    warn(`${ad.key}: expects HIDDEN-TEXT but hidden_text is not set`);
  }
  if (ad.revision && ad.revision === ad.text) warn(`${ad.key}: revision is identical to text`);
}

for (const key of SAMPLE_KEYS) if (!seenKeys.has(key)) warn(`sample chip ${key} is missing from FIXTURE_ADS`);
if (SAMPLE_ADS.length !== SAMPLE_KEYS.length) warn(`SAMPLE_ADS has ${SAMPLE_ADS.length} entries, want ${SAMPLE_KEYS.length}`);
for (const s of SAMPLE_ADS) if (!FIXTURE_ADS.includes(s)) warn(`sample ${s.key} is not the same object as its fixture`);
if (FIXTURE_ADS.length < 15 || FIXTURE_ADS.length > 20) warn(`${FIXTURE_ADS.length} fixtures (want 15 to 20)`);

const compliant = FIXTURE_ADS.filter((a) => a.expected_rule_codes.length === 0).length;
const covered = new Set(FIXTURE_ADS.flatMap((a) => [...a.expected_rule_codes, ...(a.revision_expected_rule_codes ?? [])]));
const uncovered = STARTER_RULES.map((r) => r.code).filter((c) => !covered.has(c));

// Files on disk
async function checkDisk() {
  const dir = fileURLToPath(new URL("../fixtures", import.meta.url));
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    warn("fixtures/ does not exist (run: bun scripts/write-fixtures.ts)");
    return;
  }
  const onDisk = new Set(files.map((f) => f.replace(/\.json$/, "")));
  for (const ad of FIXTURE_ADS) {
    if (!onDisk.has(ad.key)) {
      warn(`fixtures/${ad.key}.json is missing (run: bun scripts/write-fixtures.ts)`);
      continue;
    }
    const raw = await readFile(path.join(dir, `${ad.key}.json`), "utf8");
    const parsed = JSON.parse(raw) as { text?: string; expected_rule_codes?: string[]; html?: string };
    if (parsed.text !== ad.text || parsed.html !== ad.html) warn(`fixtures/${ad.key}.json is stale (text/html differ)`);
    if (JSON.stringify(parsed.expected_rule_codes) !== JSON.stringify(ad.expected_rule_codes)) {
      warn(`fixtures/${ad.key}.json is stale (expected_rule_codes differ)`);
    }
  }
  for (const k of onDisk) if (!seenKeys.has(k)) warn(`fixtures/${k}.json has no source entry`);
}

await checkDisk();

console.log(
  `${STARTER_RULES.length} rules · ${REFERENCE_LIBRARY.length} references · ${STARTER_PRODUCTS.length} products · ${FIXTURE_ADS.length} fixtures (${compliant} expect zero issues, ${FIXTURE_ADS.filter((a) => a.hidden_text).length} hidden-text)`,
);
if (uncovered.length) console.log(`rules with no fixture that expects them: ${uncovered.join(", ")}`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("All checks passed.");
