/**
 * Records the live check output for every fixture (and every sample ad's
 * scripted revision) into fixtures/recorded/<key>.json, so AI_MODE=replay
 * and `scripts/eval.ts --recorded` can show real model findings at $0.
 *
 *   AI_MODE=live doppler run -p promptarmor -c prd -- bun --conditions=react-server scripts/record-fixtures.ts [--only key1,key2] [--force] [--dry-run]
 *
 * Policy (docs/ai-policy.md): this is the ONE place model calls happen
 * outside production, and it only runs when AI_MODE=live is set explicitly.
 * A fixture whose recording already matches its text hash and the current
 * prompt hash is skipped (identical content is never re-checked); --force
 * re-records it. Results are written only when every call succeeded: when
 * the gateway refuses (customer_verification_required, missing key, budget)
 * the script explains and exits 1 without touching fixtures/recorded.
 *
 * Each file stores the key, the normalized text hash intake would store on
 * the version (lib/intake/hash.ts over the same extraction intake uses), the
 * content sha256, the model, prompt hash, token usage (incl. cache) and the
 * merged findings + hidden-text candidates from analyzeContent.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { analyzeContent, type AnalyzeContentResult } from "@/lib/ai/analyze";
import { isAiGatewayConfigured, MODELS } from "@/lib/ai/budget";
import { getAiMode } from "@/lib/ai/mode";
import { PROMPT_VERSION, promptHash } from "@/lib/ai/prompts";
import { loadRecordings, RECORDED_DIR, type RecordedCheck } from "@/lib/ai/recorded";
import type { OfferInput, RuleInput } from "@/lib/ai/schema";
import { extractFromHtml, extractFromText } from "@/lib/intake/extract";
import { normalizedTextHash, sha256Hex } from "@/lib/intake/hash";
import { STARTER_PRODUCTS } from "@/lib/seed/starter-products";
import { STARTER_RULES } from "@/lib/seed/starter-rules";
import type { Product } from "@/lib/types/ads";

type Fixture = {
  key: string;
  title: string;
  product: Product;
  channel?: string;
  format?: "text" | "html";
  text: string;
  html?: string;
  revision?: string;
  revision_html?: string;
};

/** One thing to record: a fixture, or a sample's scripted revision. */
type Target = {
  key: string;
  product: Product;
  channel?: string;
  format: "text" | "html";
  text: string;
  html?: string;
  normalized_text_hash: string;
  content_sha256: string;
};

const args = process.argv.slice(2);
const force = args.includes("--force");
const dryRun = args.includes("--dry-run");
const onlyArg = args.find((a) => a.startsWith("--only"));
const only = onlyArg ? (onlyArg.includes("=") ? onlyArg.split("=")[1] : args[args.indexOf(onlyArg) + 1]) : null;
const onlyKeys = only ? new Set(only.split(",").map((s) => s.trim()).filter(Boolean)) : null;

const FIXTURES_DIR = path.resolve(process.cwd(), "fixtures");

/** The same hashes intake stores on a version built from this text or HTML (lib/intake/ads.ts buildFromInput). */
export function hashesForContent(input: { text?: string; html?: string }): { normalized_text_hash: string; content_sha256: string; extracted: string } {
  if (input.html && input.html.trim()) {
    const doc = extractFromHtml(input.html);
    return { normalized_text_hash: normalizedTextHash(doc.text) ?? "", content_sha256: sha256Hex(input.html), extracted: doc.text };
  }
  const text = (input.text ?? "").replace(/\r\n?/g, "\n").trim();
  const doc = extractFromText(text);
  return { normalized_text_hash: normalizedTextHash(doc.text) ?? "", content_sha256: sha256Hex(text), extracted: doc.text };
}

async function loadFixtures(): Promise<Fixture[]> {
  const files = (await readdir(FIXTURES_DIR)).filter((f) => f.endsWith(".json")).sort();
  const out: Fixture[] = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(path.join(FIXTURES_DIR, file), "utf8")) as Fixture;
    if (raw?.key && typeof raw.text === "string") out.push(raw);
  }
  return out;
}

function targetsFor(f: Fixture): Target[] {
  const html = f.format === "html" ? f.html : undefined;
  const base = hashesForContent(html ? { html } : { text: f.text });
  const out: Target[] = [
    {
      key: f.key,
      product: f.product,
      channel: f.channel,
      format: html ? "html" : "text",
      text: base.extracted,
      html,
      normalized_text_hash: base.normalized_text_hash,
      content_sha256: base.content_sha256,
    },
  ];
  if (f.revision_html || f.revision) {
    const rev = f.revision_html ? hashesForContent({ html: f.revision_html }) : hashesForContent({ text: f.revision });
    out.push({
      key: `${f.key}--revision`,
      product: f.product,
      channel: f.channel,
      format: f.revision_html ? "html" : "text",
      text: rev.extracted,
      html: f.revision_html,
      normalized_text_hash: rev.normalized_text_hash,
      content_sha256: rev.content_sha256,
    });
  }
  return out.filter((t) => t.normalized_text_hash);
}

function isGatewayRefusal(message: string): boolean {
  return /customer_verification_required|credit card|No authentication provided|AI_GATEWAY_API_KEY|OIDC|GatewayAuthenticationError|insufficient|quota|billing|payment|401|402|403/i.test(message);
}

async function main() {
  if (getAiMode() !== "live") {
    console.error(
      [
        `AI_MODE is "${getAiMode()}", so no model call is allowed and nothing was recorded.`,
        "Recording spends real money (one check per fixture). Run it on purpose:",
        "  AI_MODE=live doppler run -p promptarmor -c prd -- bun --conditions=react-server scripts/record-fixtures.ts",
      ].join("\n"),
    );
    process.exit(2);
  }
  if (!isAiGatewayConfigured()) {
    console.error("The AI gateway is not configured (no AI_GATEWAY_API_KEY or Vercel OIDC token). Nothing was recorded.");
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
  const hash = promptHash(rules, offers);
  const model = MODELS.check;

  const fixtures = (await loadFixtures()).filter((f) => !onlyKeys || onlyKeys.has(f.key));
  if (fixtures.length === 0) {
    console.error("No fixtures matched.");
    process.exit(2);
  }
  const targets = fixtures.flatMap(targetsFor);
  const existing = await loadRecordings({ fresh: true });
  const existingByKey = new Map(Array.from(existing.values()).map((r) => [r.key, r]));

  const todo: Target[] = [];
  let skipped = 0;
  for (const t of targets) {
    const have = existingByKey.get(t.key);
    const same = have && have.normalized_text_hash === t.normalized_text_hash && have.prompt_hash === hash && have.model === model;
    if (same && !force) {
      skipped++;
      continue;
    }
    todo.push(t);
  }
  console.log(`${targets.length} targets (${fixtures.length} fixtures + revisions): ${todo.length} to record, ${skipped} already recorded with this text, prompt and model.`);
  if (todo.length === 0) return;
  if (dryRun) {
    for (const t of todo) console.log(`  would record ${t.key} (${t.normalized_text_hash.slice(0, 12)})`);
    return;
  }
  console.log(`Model ${model}, prompt ${PROMPT_VERSION}/${hash}. Nothing is written until every call succeeds.`);

  const results: { target: Target; result: AnalyzeContentResult; seconds: number }[] = [];
  let total = 0;
  for (const t of todo) {
    const started = Date.now();
    try {
      const result = await analyzeContent({
        text: t.text,
        html: t.html,
        product: t.product,
        channel: t.channel,
        format: t.format,
        rules,
        offers,
      });
      const seconds = (Date.now() - started) / 1000;
      total += result.usage.cost_usd;
      results.push({ target: t, result, seconds });
      console.log(
        `  ${t.key}: ${result.findings.length} findings, ${result.hidden_text.length} hidden-text, $${result.usage.cost_usd.toFixed(4)} (${result.usage.input_tokens} in / ${result.usage.output_tokens} out, cache read ${result.usage.cache_read_tokens}, write ${result.usage.cache_write_tokens}), ${seconds.toFixed(1)}s`,
      );
    } catch (err) {
      const message = err instanceof Error ? `${err.name}: ${err.message}${err.cause instanceof Error ? ` (${err.cause.message})` : ""}` : String(err);
      if (isGatewayRefusal(message)) {
        console.error(
          [
            "",
            `The AI gateway refused the call for "${t.key}": ${message.slice(0, 300)}`,
            /customer_verification_required|credit card/i.test(message)
              ? "The Vercel team needs a payment card on file before the gateway serves requests (Vercel dashboard > AI Gateway)."
              : "Check AI_GATEWAY_API_KEY / Vercel OIDC and the gateway's billing state.",
            `No files were written (${results.length} successful calls, $${total.toFixed(4)}, are discarded so the set never ends up half recorded).`,
          ].join("\n"),
        );
        process.exit(1);
      }
      console.error(`\nThe check for "${t.key}" failed: ${message.slice(0, 500)}\nNo files were written.`);
      process.exit(1);
    }
  }

  await mkdir(RECORDED_DIR, { recursive: true });
  const recordedAt = new Date().toISOString();
  for (const { target: t, result } of results) {
    const rec: RecordedCheck = {
      key: t.key,
      normalized_text_hash: t.normalized_text_hash,
      content_sha256: t.content_sha256,
      recorded_at: recordedAt,
      model: result.usage.model,
      prompt_version: PROMPT_VERSION,
      prompt_hash: result.prompt_hash,
      product: t.product,
      ...(t.channel ? { channel: t.channel } : {}),
      format: t.format,
      usage: {
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
        cache_read_tokens: result.usage.cache_read_tokens,
        cache_write_tokens: result.usage.cache_write_tokens,
        cost_usd: result.usage.cost_usd,
      },
      findings: result.findings,
      hidden_text: result.hidden_text,
      deterministic_count: result.deterministic_count,
    };
    await writeFile(path.join(RECORDED_DIR, `${t.key}.json`), `${JSON.stringify(rec, null, 2)}\n`, "utf8");
  }
  console.log(`\nWrote ${results.length} recordings to ${RECORDED_DIR} ($${total.toFixed(4)} total). Commit them so replay and --recorded evals stay at $0.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
