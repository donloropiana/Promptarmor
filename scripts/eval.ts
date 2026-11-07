/**
 * Known-answer eval for the check engine.
 *
 *   doppler run -p promptarmor -c prd -- bun --conditions=react-server scripts/eval.ts [--no-model] [--only key1,key2] [--json]
 *
 * Runs analyzeContent (lib/ai/analyze) over every fixtures/*.json using the
 * starter rules and ClearPath products from lib/seed, then prints per-ad
 * results and totals: recall of expected rule codes, false positives
 * (codes listed in not_expected_rule_codes), hidden-text detection and cost.
 *
 * Needs AI_GATEWAY_API_KEY (or a Vercel OIDC token) for the model call.
 * `--no-model` runs only the deterministic checks (offer terms, hidden text)
 * and needs no key, which is useful for a quick regression pass.
 *
 * Fixture shape: { key, title, product, channel, text, html?, expected_rule_codes,
 *                  not_expected_rule_codes?, hidden_text? }
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { analyzeContent, type AnalyzeContentResult } from "@/lib/ai/analyze";
import { isAiGatewayConfigured } from "@/lib/ai/budget";
import type { OfferInput, RuleInput } from "@/lib/ai/schema";
import { STARTER_PRODUCTS } from "@/lib/seed/starter-products";
import { STARTER_RULES } from "@/lib/seed/starter-rules";
import type { Product } from "@/lib/types/ads";

type Fixture = {
  key: string;
  title: string;
  product: Product;
  channel?: string;
  text: string;
  html?: string;
  expected_rule_codes: string[];
  not_expected_rule_codes?: string[];
  hidden_text?: boolean;
};

const args = process.argv.slice(2);
const noModel = args.includes("--no-model");
const asJson = args.includes("--json");
const onlyArg = args.find((a) => a.startsWith("--only"));
const only = onlyArg ? (onlyArg.includes("=") ? onlyArg.split("=")[1] : args[args.indexOf(onlyArg) + 1]) : null;
const onlyKeys = only ? new Set(only.split(",").map((s) => s.trim()).filter(Boolean)) : null;

const FIXTURES_DIR = path.resolve(process.cwd(), "fixtures");

function norm(code: string): string {
  return code.trim().toUpperCase();
}

async function loadFixtures(): Promise<Fixture[]> {
  let files: string[];
  try {
    files = (await readdir(FIXTURES_DIR)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    console.error(`No fixtures directory at ${FIXTURES_DIR}. Engineer D's fixtures/*.json are needed.`);
    process.exit(2);
  }
  const out: Fixture[] = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(path.join(FIXTURES_DIR, file), "utf8")) as Fixture | Fixture[];
    for (const f of Array.isArray(raw) ? raw : [raw]) {
      if (!f?.key || typeof f.text !== "string" || !Array.isArray(f.expected_rule_codes)) {
        console.warn(`Skipping ${file}: missing key, text or expected_rule_codes`);
        continue;
      }
      out.push(f);
    }
  }
  return out;
}

type Row = {
  key: string;
  title: string;
  expected: string[];
  found: string[];
  hits: string[];
  misses: string[];
  false_positives: string[];
  unexpected: string[];
  hidden_expected: boolean;
  hidden_found: boolean;
  findings: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  seconds: number;
  error?: string;
};

async function main() {
  const fixtures = (await loadFixtures()).filter((f) => !onlyKeys || onlyKeys.has(f.key));
  if (fixtures.length === 0) {
    console.error("No fixtures matched.");
    process.exit(2);
  }
  if (!noModel && !isAiGatewayConfigured()) {
    console.error(
      [
        "AI_GATEWAY_API_KEY is not set, so the model cannot be called.",
        "Add it to Doppler (doppler secrets set AI_GATEWAY_API_KEY -p promptarmor -c prd) or run with --no-model",
        "for the deterministic checks only.",
      ].join("\n"),
    );
    process.exit(2);
  }

  const rules: RuleInput[] = STARTER_RULES.map((r) => ({
    code: r.code,
    title: r.title,
    body: r.body,
    default_severity: r.default_severity,
    applies_to: r.applies_to as string[],
  }));
  const offers: OfferInput[] = STARTER_PRODUCTS.map((p) => ({ code: p.code, product: p.product, name: p.name, terms: p.terms }));

  const rows: Row[] = [];
  for (const f of fixtures) {
    const started = Date.now();
    let result: AnalyzeContentResult | null = null;
    let error: string | undefined;
    try {
      result = await analyzeContent({
        text: f.text,
        html: f.html,
        product: f.product,
        channel: f.channel,
        format: f.html ? "html" : "text",
        rules,
        offers,
        skipModel: noModel,
      });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const seconds = (Date.now() - started) / 1000;
    const expected = f.expected_rule_codes.map(norm);
    const notExpected = (f.not_expected_rule_codes ?? []).map(norm);
    const found = Array.from(new Set((result?.findings ?? []).map((x) => norm(x.rule_code))));
    const hits = expected.filter((c) => found.includes(c));
    const misses = expected.filter((c) => !found.includes(c));
    const falsePositives = found.filter((c) => notExpected.includes(c));
    const unexpected = found.filter((c) => !expected.includes(c) && !notExpected.includes(c));
    rows.push({
      key: f.key,
      title: f.title,
      expected,
      found,
      hits,
      misses,
      false_positives: falsePositives,
      unexpected,
      hidden_expected: Boolean(f.hidden_text),
      hidden_found: (result?.hidden_text.length ?? 0) > 0,
      findings: result?.findings.length ?? 0,
      cost_usd: result?.usage.cost_usd ?? 0,
      input_tokens: result?.usage.input_tokens ?? 0,
      output_tokens: result?.usage.output_tokens ?? 0,
      seconds,
      error,
    });
    if (!asJson) printRow(rows[rows.length - 1], result);
  }

  const totalExpected = rows.reduce((n, r) => n + r.expected.length, 0);
  const totalHits = rows.reduce((n, r) => n + r.hits.length, 0);
  const totalFp = rows.reduce((n, r) => n + r.false_positives.length, 0);
  const totalUnexpected = rows.reduce((n, r) => n + r.unexpected.length, 0);
  const totalFindings = rows.reduce((n, r) => n + r.findings, 0);
  const totalCost = rows.reduce((n, r) => n + r.cost_usd, 0);
  const hiddenRows = rows.filter((r) => r.hidden_expected);
  const hiddenHits = hiddenRows.filter((r) => r.hidden_found).length;
  const hiddenFalse = rows.filter((r) => !r.hidden_expected && r.hidden_found).length;
  const errors = rows.filter((r) => r.error).length;

  const summary = {
    ads: rows.length,
    model: noModel ? "none (deterministic only)" : "anthropic/claude-sonnet-5.5",
    recall: totalExpected ? totalHits / totalExpected : null,
    expected_total: totalExpected,
    expected_found: totalHits,
    false_positives: totalFp,
    unexpected_codes: totalUnexpected,
    findings_total: totalFindings,
    hidden_text: { expected: hiddenRows.length, detected: hiddenHits, false_alarms: hiddenFalse },
    cost_total_usd: Math.round(totalCost * 1e6) / 1e6,
    cost_per_ad_usd: rows.length ? Math.round((totalCost / rows.length) * 1e6) / 1e6 : 0,
    errors,
    seconds_total: Math.round(rows.reduce((n, r) => n + r.seconds, 0) * 10) / 10,
  };

  if (asJson) {
    console.log(JSON.stringify({ summary, rows }, null, 2));
    return;
  }
  console.log("\n==== Summary ====");
  console.log(`Ads: ${summary.ads}   Model: ${summary.model}`);
  console.log(`Recall: ${summary.recall === null ? "—" : `${(summary.recall * 100).toFixed(0)}%`} (${totalHits}/${totalExpected} expected rule codes found)`);
  console.log(`False positives (listed as not expected): ${totalFp}   Unexpected codes (not listed either way): ${totalUnexpected}`);
  console.log(`Hidden text: ${hiddenHits}/${hiddenRows.length} detected, ${hiddenFalse} false alarms`);
  console.log(`Cost: $${summary.cost_total_usd.toFixed(4)} total, $${summary.cost_per_ad_usd.toFixed(4)} per ad   Errors: ${errors}   Time: ${summary.seconds_total}s`);
  if (errors > 0) process.exitCode = 1;
}

function printRow(r: Row, result: AnalyzeContentResult | null) {
  const status = r.error ? "ERROR" : r.misses.length === 0 && r.false_positives.length === 0 ? "ok" : "miss";
  console.log(`\n[${status}] ${r.key} — ${r.title}  ($${r.cost_usd.toFixed(4)}, ${r.seconds.toFixed(1)}s)`);
  if (r.error) console.log(`  error: ${r.error}`);
  console.log(`  expected: ${r.expected.join(", ") || "(none)"}`);
  console.log(`  found:    ${r.found.join(", ") || "(none)"}`);
  if (r.misses.length) console.log(`  missed:   ${r.misses.join(", ")}`);
  if (r.false_positives.length) console.log(`  false +:  ${r.false_positives.join(", ")}`);
  if (r.unexpected.length) console.log(`  extra:    ${r.unexpected.join(", ")}`);
  if (r.hidden_expected || r.hidden_found) console.log(`  hidden text: expected ${r.hidden_expected ? "yes" : "no"}, found ${r.hidden_found ? "yes" : "no"}`);
  for (const f of result?.findings ?? []) {
    console.log(`   - [${f.severity}] ${f.rule_code} "${f.quote.slice(0, 90)}"${f.suggested_copy ? ` -> "${f.suggested_copy.slice(0, 70)}"` : ""}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
