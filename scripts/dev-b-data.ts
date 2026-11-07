/**
 * Engineer B smoke test for lib/data/ads.ts (the Ads list + Ad page reads).
 * Signs in as a member with a password and runs the same queries the pages
 * run, under RLS. Read-only. Needs Doppler env:
 *
 *   DEV_EMAIL=... DEV_PASSWORD=... doppler run -p promptarmor -c prd -- \
 *     bun --conditions=react-server scripts/dev-b-data.ts [--ad <asset id>] [--verbose]
 *
 * `--conditions=react-server` makes "server-only" a no-op (as in Next.js).
 */

import { createClient } from "@supabase/supabase-js";

import { getAdDetailWith, getAdsMetricsWith, getAdsSummaryWith, getNextNeedsReviewIdWith, listAdsWith } from "../lib/data/ads";
import type { Database } from "../lib/supabase/database.types";

const url = process.env.SUPABASE_URL!;
const pub = process.env.SUPABASE_PUBLISHABLE_KEY!;
const email = process.env.DEV_EMAIL;
const password = process.env.DEV_PASSWORD;
const PROFILE = process.env.DEV_PROFILE ?? "cf7d66e9-54d5-4b99-ac6f-89d760a20731";
const VERBOSE = process.argv.includes("--verbose");

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

function ok(label: string, cond: unknown, extra?: unknown) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra !== undefined ? ` · ${typeof extra === "string" ? extra : JSON.stringify(extra)}` : ""}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  if (!url || !pub) throw new Error("Missing SUPABASE_* env (run under doppler)");
  if (!email || !password) throw new Error("Set DEV_EMAIL and DEV_PASSWORD");

  const anon = createClient<Database>(url, pub, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  ok("password sign-in", !signInErr && signIn.session, signInErr?.message);
  const token = signIn.session!.access_token;
  const userId = signIn.user!.id;
  const db = createClient<Database>(url, pub, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const t0 = Date.now();
  const list = await listAdsWith(db, PROFILE, userId);
  ok(`listAds (${Date.now() - t0} ms)`, Array.isArray(list.rows), { total: list.totalAds, counts: list.counts, checking: list.anyChecking, triage: list.triage.length, skipped: list.skipped.length });
  for (const r of list.rows.slice(0, VERBOSE ? 50 : 8)) {
    console.log(
      `   - ${r.title.slice(0, 48).padEnd(48)} ${r.status.padEnd(22)} tab=${String(r.tab).padEnd(17)} v${r.versionNo} C${r.openCritical} M${r.openMajor} m${r.openMinor} hidden=${r.hiddenText ? "y" : "n"} checking=${r.checking ? "y" : "n"} from=${r.from.label}${r.isSample ? " [sample]" : ""} thumb=${r.thumbnail.kind}${r.topIssue ? ` top="${(r.topIssue.quote ?? "").slice(0, 30)}"` : ""} tags=${r.tags.join(",")}`,
    );
  }
  // Worst-first sort sanity: ranks must be non-decreasing.
  ok("worst-first sort", list.rows.every((r, i) => i === 0 || list.rows[i - 1].rank <= r.rank));
  ok("samples excluded from counts", list.counts.all === list.rows.filter((r) => !r.isSample).length);

  const t1 = Date.now();
  const summary = await getAdsSummaryWith(db, PROFILE, list);
  ok(`getAdsSummary (${Date.now() - t1} ms)`, summary, summary);

  const t2 = Date.now();
  const metrics = await getAdsMetricsWith(db, PROFILE);
  ok(`getAdsMetrics (${Date.now() - t2} ms)`, metrics.aiCap != null, metrics);

  const adId = arg("ad") ?? list.rows[0]?.id;
  if (!adId) {
    console.log("No ads in the workspace; create one with scripts/dev-create-ad.ts to test getAdDetail.");
    return;
  }
  const t3 = Date.now();
  const detail = await getAdDetailWith(db, adId, PROFILE, userId);
  ok(`getAdDetail (${Date.now() - t3} ms)`, detail, detail ? { title: detail.title, status: detail.status, versions: detail.versions.length, latest: `V${detail.latest.versionNo} ${detail.latest.content.format}`, findings: detail.findings.length, prev: detail.previousFindings.length, alerts: detail.alerts.length, runs: detail.runs.map((r) => r.status), decisions: detail.decisions.length, events: detail.events.length, aiCost: detail.aiCostUsd, reviewSeconds: detail.reviewSeconds, next: detail.nextNeedsReviewId, fileUrl: Boolean(detail.fileUrl) } : null);
  if (detail) {
    for (const f of detail.findings.slice(0, VERBOSE ? 50 : 6)) {
      console.log(`   - [${f.severity}] ${(f.rule?.title ?? f.evidenceType).slice(0, 40)} "${(f.quote ?? "").slice(0, 40)}" anchor=${f.anchor ? `${f.anchor.start}-${f.anchor.end}` : "none"} verified=${f.verifiedSpan} open=${f.open} disp=${f.disposition?.disposition ?? "-"} refs=${f.rule?.references.length ?? 0} recheck=${f.recheckStatus ?? "-"}`);
      if (f.anchor) {
        const slice = detail.latest.extractedText.slice(f.anchor.start, f.anchor.end);
        const matches = f.quote ? slice.replace(/\s+/g, " ").toLowerCase() === f.quote.replace(/\s+/g, " ").toLowerCase() : true;
        if (!matches) console.log(`     ! anchor text differs from quote: "${slice.slice(0, 40)}"`);
      }
    }
    ok("latest version has text or a file", detail.latest.extractedText.length > 0 || detail.fileUrl !== null);
    const next = await getNextNeedsReviewIdWith(db, PROFILE, adId);
    ok("getNextNeedsReviewId", next === null || typeof next === "string", next);
  }
}

main().catch((err) => {
  console.error("FAIL ", err);
  process.exit(1);
});
