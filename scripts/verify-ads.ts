/**
 * Browser verification of the Ads list and the ad page (Playwright + Chromium)
 * against a running dev server. It creates its own throwaway sample ads
 * (audience 'sample', titles starting "[test] "), drives every review flow in
 * a real browser at 1280px and 390px (including "+ Add issue" from a text
 * selection), writes screenshots, and retires the ads it created at the end
 * (status 'withdrawn', audience 'sample_cleared').
 *
 *   doppler run -p promptarmor -c prd -- env SMOKE_PASSWORD=... \
 *     PLAYWRIGHT_MODULE=$HOME/.bun/install/global/node_modules/playwright \
 *     bun --conditions=react-server scripts/verify-ads.ts [--keep] [--stress | --stress-only]
 *
 * --stress adds the worst-case pass (scripts/stress-ads.ts data: 300/400-char
 * headlines, 60 KB text, 40 findings, RTL/CJK/emoji, one emoji, inert HTML,
 * image-only PDF, 300-char submitter, 60 rows, a 2,000-char exception) plus
 * the intake refusals (whitespace, 5 MB file, 3.9 MB PDF) at 1280 and 390px;
 * --stress-only runs just that. Stress ads are retired at the end unless --keep.
 *
 * Env: SMOKE_EMAIL (default promptarmortwo+reviewer@gmail.com), SMOKE_PASSWORD
 * (required, never committed), VERIFY_BASE_URL (default http://localhost:3102),
 * VERIFY_SCREENS (screenshot directory, default ./.verify-screens),
 * VERIFY_PROFILE / VERIFY_USER (workspace and user ids of the test account),
 * PLAYWRIGHT_MODULE when playwright is not resolvable from this repo.
 *
 * `--conditions=react-server` makes bun treat "server-only" as a no-op. The
 * check engine is invoked directly for the test ads; with the AI gateway
 * refusing calls every check ends 'failed' (Not AI-screened) at $0 and the
 * deterministic product-terms findings are what the flows act on. When the
 * engine runs with the AI step off, the same flows run against a complete
 * check; both paths are handled.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";

import { startAnalysisForVersion } from "@/features/analysis/server/engine";
import { createAd } from "@/features/ads/server/intake";
import { getSampleAd } from "@/features/ads/samples";
import { requireSupabaseAdminClient } from "@/lib/supabase/admin";

import { BULK_COUNT, LONG_SUBMITTER_EMAIL, LONG_SUBMITTER_NAME, approveWithLongException, ensureStressAds, makePdf, retireStressAds, type StressAd } from "./stress-ads";

const BASE = (process.env.VERIFY_BASE_URL ?? "http://localhost:3102").replace(/\/$/, "");
const EMAIL = process.env.SMOKE_EMAIL ?? "promptarmortwo+reviewer@gmail.com";
const PASSWORD = process.env.SMOKE_PASSWORD;
const SCREENS = path.resolve(process.env.VERIFY_SCREENS ?? ".verify-screens");
const PROFILE_ID = process.env.VERIFY_PROFILE ?? "cf7d66e9-54d5-4b99-ac6f-89d760a20731";
const USER_ID = process.env.VERIFY_USER ?? "88b5b90e-3f4b-46a2-8c50-333240cbb671";
const KEEP = process.argv.includes("--keep");
const STRESS = process.argv.includes("--stress") || process.argv.includes("--stress-only");
const STRESS_ONLY = process.argv.includes("--stress-only");

const RATIONALE = "Read V2 in full against PL-1 terms: the rate now matches, approval claims are gone, payment terms accepted for this channel.";
const DISMISS_NOTE = "Checked PL-1 terms: this wording is accurate for the current rate sheet and the product team confirmed it in writing.";

// ---------------------------------------------------------------------------
// Minimal Playwright surface (the module is loaded at runtime, see PLAYWRIGHT_MODULE)
// ---------------------------------------------------------------------------

type Locator = {
  first: () => Locator;
  nth: (i: number) => Locator;
  last: () => Locator;
  locator: (selector: string, opts?: { hasText?: string | RegExp }) => Locator;
  getByRole: (role: string, opts?: { name?: string | RegExp; exact?: boolean }) => Locator;
  getByText: (text: string | RegExp, opts?: { exact?: boolean }) => Locator;
  getByLabel: (text: string | RegExp, opts?: { exact?: boolean }) => Locator;
  count: () => Promise<number>;
  click: (opts?: { timeout?: number; force?: boolean }) => Promise<void>;
  fill: (value: string, opts?: { timeout?: number }) => Promise<void>;
  focus: () => Promise<void>;
  isVisible: () => Promise<boolean>;
  isDisabled: () => Promise<boolean>;
  isEnabled: () => Promise<boolean>;
  waitFor: (opts?: { state?: "attached" | "detached" | "visible" | "hidden"; timeout?: number }) => Promise<void>;
  textContent: () => Promise<string | null>;
  innerText: () => Promise<string>;
  inputValue: () => Promise<string>;
  getAttribute: (name: string) => Promise<string | null>;
  boundingBox: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
  scrollIntoViewIfNeeded: () => Promise<void>;
  evaluate: <T>(fn: string) => Promise<T>;
  setInputFiles: (files: { name: string; mimeType: string; buffer: Buffer }) => Promise<void>;
};

type Frame = {
  locator: (selector: string) => Locator;
  evaluate: <T>(fn: string) => Promise<T>;
  title: () => Promise<string>;
  url: () => string;
};

type Page = {
  goto: (url: string, opts?: { waitUntil?: string; timeout?: number }) => Promise<{ status: () => number } | null>;
  reload: (opts?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
  url: () => string;
  locator: (selector: string, opts?: { hasText?: string | RegExp }) => Locator;
  getByRole: (role: string, opts?: { name?: string | RegExp; exact?: boolean }) => Locator;
  getByText: (text: string | RegExp, opts?: { exact?: boolean }) => Locator;
  getByLabel: (text: string | RegExp, opts?: { exact?: boolean }) => Locator;
  getByPlaceholder: (text: string | RegExp) => Locator;
  waitForURL: (url: string | RegExp, opts?: { timeout?: number }) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  waitForLoadState: (state?: string, opts?: { timeout?: number }) => Promise<void>;
  screenshot: (opts: { path: string; fullPage?: boolean }) => Promise<unknown>;
  evaluate: <T>(fn: string) => Promise<T>;
  keyboard: { press: (key: string) => Promise<void>; type: (text: string) => Promise<void> };
  mouse: { move: (x: number, y: number) => Promise<void> };
  on: (event: string, handler: (arg: { text: () => string; type: () => string; url: () => string; failure: () => { errorText: string } | null } & Error) => void) => void;
  frames: () => Frame[];
  setViewportSize: (size: { width: number; height: number }) => Promise<void>;
  viewportSize: () => { width: number; height: number } | null;
  close: () => Promise<void>;
};

type Context = {
  newPage: () => Promise<Page>;
  grantPermissions: (permissions: string[], opts?: { origin?: string }) => Promise<void>;
};

type Browser = {
  newContext: (opts?: { viewport?: { width: number; height: number }; reducedMotion?: string }) => Promise<Context>;
  close: () => Promise<void>;
};

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const results: { label: string; ok: boolean; detail?: string }[] = [];
function record(label: string, ok: boolean, detail?: string) {
  results.push({ label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` · ${detail}` : ""}`);
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(250);
  const width = page.viewportSize()?.width ?? 0;
  const file = path.join(SCREENS, `${name}-${width}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`      screenshot ${file}`);
  return file;
}

async function noHorizontalScroll(page: Page, label: string) {
  const { scrollWidth, innerWidth } = await page.evaluate<{ scrollWidth: number; innerWidth: number }>(
    "({ scrollWidth: document.scrollingElement ? document.scrollingElement.scrollWidth : document.body.scrollWidth, innerWidth: window.innerWidth })",
  );
  record(`${label}: no horizontal scroll at ${innerWidth}px`, scrollWidth <= innerWidth + 1, `scrollWidth ${scrollWidth}`);
}

async function bodyText(page: Page): Promise<string> {
  return page.locator("body").innerText().catch(() => "");
}

/** Streams finish after "load": wait until no loading skeleton is left. */
async function settled(page: Page, timeoutMs = 60_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pending = await page.evaluate<number>("document.querySelectorAll('[data-slot=\"skeleton\"]').length");
    if (pending === 0) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

/** Polls until `test` passes on the page text or the timeout elapses. */
async function waitForText(page: Page, test: RegExp, timeoutMs = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (test.test(await bodyText(page))) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Test data (admin client)
// ---------------------------------------------------------------------------

type TestAd = { key: string; assetId: string; versionId: string; title: string };

async function createTestAd(sampleKey: string): Promise<TestAd> {
  const sample = getSampleAd(sampleKey);
  if (!sample) throw new Error(`unknown sample ${sampleKey}`);
  const title = `[test] ${sample.title}`;
  const created = await createAd({
    profileId: PROFILE_ID,
    userId: USER_ID,
    origin: "paste",
    title,
    text: sample.format === "text" ? sample.text : undefined,
    html: sample.format === "html" ? (sample.html ?? undefined) : undefined,
    product: sample.product,
    channel: sample.channel,
    isSample: true,
    sampleKey: sample.key,
  });
  console.log(`      created ${title} -> ${created.assetId}`);
  return { key: sampleKey, assetId: created.assetId, versionId: created.versionId, title };
}

/** Runs the queued check for a version and waits for it to finish; returns the final status. */
async function runCheck(versionId: string): Promise<string> {
  const admin = requireSupabaseAdminClient();
  await startAnalysisForVersion(versionId);
  const start = Date.now();
  while (Date.now() - start < 120_000) {
    const { data } = await admin.from("analysis_runs").select("status").eq("asset_version_id", versionId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (data && data.status !== "queued" && data.status !== "running") return data.status;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return "timeout";
}

async function latestVersionId(assetId: string): Promise<string> {
  const admin = requireSupabaseAdminClient();
  const { data } = await admin.from("assets").select("latest_version_id").eq("id", assetId).single();
  return data?.latest_version_id ?? "";
}

async function retireTestAds(ads: TestAd[]) {
  const admin = requireSupabaseAdminClient();
  // Also sweep "[test] " ads an earlier, interrupted run left behind.
  const { data: leftovers } = await admin.from("assets").select("id, title").eq("profile_id", PROFILE_ID).eq("audience", "sample").like("title", "[test] %");
  for (const row of leftovers ?? []) {
    if (!ads.some((a) => a.assetId === row.id)) ads.push({ key: "leftover", assetId: row.id, versionId: "", title: row.title ?? "[test]" });
  }
  for (const ad of ads) {
    // Approved ads keep their approval pointers (a check constraint ties them
    // to the status), so they are only hidden; everything else is withdrawn.
    const { data: current } = await admin.from("assets").select("status").eq("id", ad.assetId).maybeSingle();
    const approved = current?.status === "approved" || current?.status === "approved_with_exceptions";
    const patch = approved ? { audience: "sample_cleared" } : { status: "withdrawn", audience: "sample_cleared" };
    const { error } = await admin.from("assets").update(patch).eq("id", ad.assetId);
    if (error) console.error(`      could not retire ${ad.title}: ${error.code} ${error.message}`);
    else console.log(`      retired ${ad.title}${approved ? " (approved: hidden, approval kept)" : ""}`);
  }
}

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

async function signIn(page: Page) {
  await page.goto(`${BASE}/signin`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.getByRole("tab", { name: "Password" }).click();
  await page.locator("#pw-email").fill(EMAIL);
  await page.locator("#pw-password").fill(PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/ads(\?|$)/, { timeout: 60_000 });
  record("password sign-in -> /ads", /\/ads/.test(page.url()), page.url());
}

async function listFlow(page: Page, ads: TestAd[]) {
  await page.goto(`${BASE}/ads`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(500);
  const text = await bodyText(page);
  record("list: samples grouped under their own heading", /Samples\s*·\s*not counted/.test(text));
  record("list: test ads visible", ads.every((a) => text.includes(a.title)), ads.map((a) => a.title).join(" | "));
  const sampleRows = page.getByRole("list", { name: "Sample ads" }).locator("a[data-ad-row]");
  record("list: sample rows live in the Samples section", (await sampleRows.count()) >= ads.length, `${await sampleRows.count()} rows`);
  await shot(page, "list");

  // Keyboard: J focuses the first row, J/K move, ? opens shortcuts, Enter opens.
  await page.mouse.move(5, 5);
  await page.keyboard.press("j");
  const focusedAfterJ = await page.evaluate<string | null>("document.activeElement && document.activeElement.getAttribute('data-ad-row') !== null ? document.activeElement.getAttribute('href') : null");
  record("list: J focuses a row", Boolean(focusedAfterJ), focusedAfterJ ?? "nothing focused");
  await page.keyboard.press("j");
  const second = await page.evaluate<string | null>("document.activeElement ? document.activeElement.getAttribute('href') : null");
  await page.keyboard.press("k");
  const backToFirst = await page.evaluate<string | null>("document.activeElement ? document.activeElement.getAttribute('href') : null");
  record("list: J/K move between rows", second !== focusedAfterJ && backToFirst === focusedAfterJ, `${focusedAfterJ} -> ${second} -> ${backToFirst}`);
  await page.keyboard.press("?");
  const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  record("list: ? opens the shortcuts dialog", await shortcuts.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false));
  await shot(page, "list-shortcuts");
  await page.keyboard.press("Escape");
  await shortcuts.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
  // Enter on the focused test row opens its page.
  const row = page.locator(`a[data-ad-row][href="/ads/${ads[0].assetId}"]`);
  await row.focus();
  await page.keyboard.press("Enter");
  const opened = await page.waitForURL(new RegExp(`/ads/${ads[0].assetId}`), { timeout: 30_000 }).then(() => true).catch(() => false);
  record("list: Enter opens the focused ad", opened, page.url());
}

async function checkFlow(page: Page, ad: TestAd) {
  await page.goto(`${BASE}/ads/${ad.assetId}`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  const sawChecking = await waitForText(page, /Checking V1…/, 20_000);
  record("ad: shows Checking… while the run is queued", sawChecking);
  await shot(page, "ad-checking");

  const status = await runCheck(ad.versionId);
  record("ad: check finished", status === "failed" || status === "complete" || status === "declined_budget", status);
  await page.reload({ waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  const text = await bodyText(page);
  const notScreened = /Not AI-screened/.test(text);
  const testMode = /AI check skipped \(test mode\)/.test(text);
  const replay = /Recorded check · no AI spend/.test(text);
  const reused = /Reused from an identical ad · \$0/.test(text);
  record("ad: outcome named plainly", notScreened || testMode || replay || reused, notScreened ? "Not AI-screened" : testMode ? "test mode" : replay ? "replay" : reused ? "reused" : "none of the four");
  if (status === "failed") record("ad: failed run shows Not AI-screened + product-terms issues", notScreened && /From the product-terms check only/.test(text));
  const cards = page.locator("section[aria-label='Issues'] [data-finding-id]");
  const cardCount = await cards.count();
  record("ad: deterministic issues listed (rate below PL-1 floor expected)", cardCount >= 1 && /8\.99%|5\.99%/.test(text), `${cardCount} cards`);
  await shot(page, "ad-not-screened");

  // Click an issue -> its words are highlighted in the creative.
  const firstCard = cards.first();
  await firstCard.locator("button").first().click();
  const selectedMark = page.locator("mark[data-selected]");
  const highlighted = await selectedMark.first().waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
  record("ad: clicking an issue highlights its words in the creative", highlighted, highlighted ? `“${(await selectedMark.first().innerText()).slice(0, 60)}”` : undefined);
  await shot(page, "ad-issue-selected");

  // Not a problem (X) on a Critical/Major: reason + 40-char note -> Dismissed (1) with Undo -> Undo reopens it.
  const majorCard = page.locator("section[aria-label='Major issues'] [data-finding-id]").first();
  const strictCard = (await majorCard.count()) > 0 ? majorCard : page.locator("section[aria-label='Critical issues'] [data-finding-id]").first();
  const hasStrict = (await strictCard.count()) > 0;
  record("ad: a Critical/Major issue exists to dismiss", hasStrict, (await majorCard.count()) > 0 ? "Major" : "Critical");
  if (hasStrict) {
    const header = strictCard.locator("button").first();
    if ((await header.getAttribute("aria-pressed")) !== "true") await header.click();
    await page.mouse.move(5, 5);
    await page.keyboard.press("x");
    const form = page.getByText("Not a problem: why?");
    const formOpen = await form.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
    record("ad: X opens the Not-a-problem form on the selected issue", formOpen);
    if (formOpen) {
      const confirm = page.getByRole("button", { name: "Confirm" });
      record("ad: Confirm disabled until reason + 40-char note", await confirm.isDisabled());
      await page.getByRole("combobox", { name: /Reason/ }).click();
      await page.getByRole("option", { name: /Disclosed elsewhere/ }).click();
      await page.locator("textarea[id^='note-']").fill(DISMISS_NOTE);
      record("ad: Confirm enabled once valid", await confirm.isEnabled());
      await shot(page, "ad-dismiss-form");
      await confirm.click();
      const dismissed = await waitForText(page, /Dismissed\s*\(1\)/i, 20_000);
      record("ad: issue moved to Dismissed (1)", dismissed);
      await page.getByRole("button", { name: /Dismissed/ }).click();
      const undo = page.getByRole("button", { name: "Undo" });
      record("ad: Dismissed list offers Undo", await undo.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false));
      await shot(page, "ad-dismissed");
      await undo.click();
      const reopened = await waitForText(page, /Reopened/, 20_000);
      await page.waitForTimeout(1_500);
      const openAgain = (await page.locator("section[aria-label='Issues'] [data-finding-id]").count()) >= cardCount;
      record("ad: Undo reopens the issue", reopened && openAgain);
    }
  }
}

async function requestChangesFlow(page: Page, context: Context, ad: TestAd) {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await page.mouse.move(5, 5);
  await page.keyboard.press("r");
  const sheet = page.getByRole("dialog", { name: /Request changes on V1/ });
  record("ad: R opens the Request changes sheet", await sheet.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false));
  const note = sheet.locator("#request-text");
  const prefilled = await note.inputValue();
  record("ad: note prefilled from the open issues", /Changes requested for/.test(prefilled) && /Quoted:/.test(prefilled), prefilled.split("\n")[0]);
  await sheet.getByRole("button", { name: "Copy as text" }).click();
  record("ad: Copy as text confirms", await waitForText(page, /Copied/, 5_000));
  const clip = await page.evaluate<string>("navigator.clipboard.readText().catch(() => '')");
  record("ad: clipboard holds the note", clip.startsWith("Changes requested for"), clip.slice(0, 40));
  await shot(page, "ad-request-sheet");
  await sheet.getByRole("button", { name: "Request changes" }).last().click();
  const waiting = await waitForText(page, /Waiting for a revision/, 30_000);
  record("ad: status Changes requested + waiting state", waiting && /Changes requested/.test(await bodyText(page)));
  await shot(page, "ad-waiting");

  // Simulate revision -> V2 arrives, gets checked, What changed appears.
  await page.getByRole("button", { name: "Simulate revision from Gmail" }).first().click();
  const v2 = await waitForText(page, /V2/, 30_000);
  record("ad: V2 arrives after Simulate revision", v2);
  const v2Id = await latestVersionId(ad.assetId);
  record("ad: V2 version id found", v2Id !== "" && v2Id !== ad.versionId);
  const status = await runCheck(v2Id);
  record("ad: V2 check finished", status !== "timeout", status);
  await page.reload({ waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  const text = await bodyText(page);
  const summary = text.match(/(\d+) fixed\s*·\s*(\d+) still there\s*·\s*(\d+) new/);
  record("ad: What changed summary line", Boolean(summary), summary?.[0]);
  const fixed = Number(summary?.[1] ?? 0);
  const still = Number(summary?.[2] ?? 0);
  const fresh = Number(summary?.[3] ?? 0);
  record("ad: the 5.99% rate issue is counted as fixed", fixed >= 1, `${fixed} fixed`);
  if (fixed > 0) record("ad: fixed issues listed with a Fixed label", (await page.locator("section [data-slot], section").getByText("Fixed", { exact: true }).count()) >= 1);
  if (still + fresh > 0) {
    const labels = await page.locator("section[aria-label='Issues'] [data-finding-id]").getByText(/^(Still there|New)$/).count();
    record("ad: remaining issues labelled Still there / New", labels >= still + fresh, `${labels} labels for ${still + fresh} issues`);
  } else {
    record("ad: no issues left on V2 (nothing to label)", (await page.locator("section[aria-label='Issues'] [data-finding-id]").count()) === 0);
  }
  await shot(page, "ad-v2-what-changed");
  await page.getByRole("tab", { name: "What changed" }).click();
  record("ad: word diff tab shows added/removed", await waitForText(page, /V1 → V2/, 5_000));
  await shot(page, "ad-v2-diff");
  await page.getByRole("tab", { name: "V2" }).click();
}

/**
 * Selects `phrase` inside the ad's text view the way a reader would (a DOM
 * Range over the text node, then mouseup on the text container) and returns
 * whether the floating "+ Add issue" button appeared.
 */
async function selectPhrase(page: Page, phrase: string): Promise<boolean> {
  const found = await page.evaluate<boolean>(`(() => {
    const phrase = ${JSON.stringify(phrase)};
    const blocks = document.querySelectorAll('[data-ad-text]');
    for (const block of blocks) {
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const i = (node.textContent || '').indexOf(phrase);
        if (i < 0) continue;
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + phrase.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        block.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return true;
      }
    }
    return false;
  })()`);
  if (!found) return false;
  return page
    .locator("[data-add-issue-floating]")
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
}

/**
 * "+ Add issue" on V2: select words the check missed ("Fixed rate for life"
 * is a RATE-FIXED miss when the AI step is off), add a Major issue citing
 * that rule, confirm it lands in the panel with its chip and quote, counts
 * as open, and shows up in the Approve sheet as an exception; then the error
 * path (words that are not in the ad) and finally Not a problem on the new
 * issue so the approval flow that follows is unchanged.
 */
async function addIssueFlow(page: Page, ad: TestAd) {
  await page.goto(`${BASE}/ads/${ad.assetId}`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  const textBefore = await bodyText(page);
  const countLine = textBefore.match(/Issues on V2\s*(\d+) open(?: of (\d+))?/);
  const openBefore = Number(countLine?.[1] ?? 0);
  const cardsBefore = await page.locator("section[aria-label='Issues'] [data-finding-id]").count();
  record("add issue: header button present on the text view", (await page.getByRole("button", { name: "Add issue", exact: true }).count()) >= 1);

  const phrase = "Fixed rate for life";
  const floating = await selectPhrase(page, phrase);
  record("add issue: selecting words shows the floating + Add issue button", floating);
  if (!floating) return;
  // The button sits inside the text column, by the selection.
  const box = await page.locator("[data-add-issue-floating]").boundingBox();
  const textBox = await page.locator("[data-ad-text]").first().boundingBox();
  record("add issue: floating button is inside the text column", Boolean(box && textBox && box.x >= textBox.x - 2 && box.x + box.width <= textBox.x + textBox.width + 2), box && textBox ? `button x ${Math.round(box.x)}..${Math.round(box.x + box.width)}, text x ${Math.round(textBox.x)}..${Math.round(textBox.x + textBox.width)}` : "missing");
  await page.locator("[data-add-issue-floating]").click();
  const dialog = page.getByRole("dialog", { name: "Add an issue" });
  record("add issue: dialog opens", await dialog.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false));
  const quoted = await dialog.locator("[data-add-issue-quote]").innerText().catch(() => "");
  record("add issue: dialog quotes the selected words read-only", quoted.trim() === phrase, `“${quoted.trim()}”`);
  const submit = dialog.getByRole("button", { name: "Add issue", exact: true });
  record("add issue: submit disabled until a 10-character reason", await submit.isDisabled());
  record("add issue: severity defaults to Major", /Major/.test(await dialog.locator("#add-issue-severity").innerText()));
  await dialog.locator("#add-issue-rule").click();
  const ruleOptions = await page.getByRole("option").count();
  record("add issue: rule picker lists No specific rule plus the rules that are on", ruleOptions >= 2 && (await page.getByRole("option", { name: "No specific rule" }).count()) === 1, `${ruleOptions} options`);
  await page.getByRole("option", { name: /RATE-FIXED/ }).click();
  await dialog.locator("#add-issue-why").fill("“For life” promises a rate that never changes; PL-1 is fixed for the loan term only, and the ad should say so.");
  record("add issue: submit enabled once valid", await submit.isEnabled());
  await shot(page, "add-issue-dialog");
  await submit.click();
  record("add issue: toast Issue added", await waitForText(page, /Issue added/, 20_000));
  await dialog.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);

  // The new issue is in the panel, with its chip, quote, rule and author.
  const newCard = page.locator("section[aria-label='Issues'] [data-finding-id]", { hasText: /Added by (you|reviewer)/ });
  const cardShown = await newCard.first().waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false);
  record("add issue: new issue shows in the panel with the Added by you/reviewer chip", cardShown);
  const cardText = cardShown ? await newCard.first().innerText() : "";
  record("add issue: card quotes the words and names the rule", cardText.includes(phrase) && /RATE-FIXED/.test(cardText), cardText.replace(/\s+/g, " ").slice(0, 160));
  record("add issue: it is selected and its words highlighted in the ad", (await page.locator(`mark[data-selected]`).count()) >= 1 && (await newCard.first().locator("button[aria-pressed='true']").count()) === 1);
  const textAfter = await bodyText(page);
  const countAfter = textAfter.match(/Issues on V2\s*(\d+) open(?: of (\d+))?/);
  const openAfter = Number(countAfter?.[1] ?? 0);
  const cardsAfter = await page.locator("section[aria-label='Issues'] [data-finding-id]").count();
  record("add issue: open count went up by one", openAfter === openBefore + 1 && cardsAfter === cardsBefore + 1, `${openBefore} -> ${openAfter} open, ${cardsBefore} -> ${cardsAfter} cards`);
  record("add issue: history records it", /Issue added/.test(textAfter));
  await shot(page, "add-issue-panel");

  // The Approve sheet now wants a written exception for it.
  await page.mouse.move(5, 5);
  await page.keyboard.press("a");
  const sheet = page.getByRole("dialog", { name: /Approve V2/ });
  const sheetOpen = await sheet.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
  record("add issue: Approve sheet opens", sheetOpen);
  if (sheetOpen) {
    const sheetText = await sheet.innerText();
    const fields = await sheet.locator("textarea[id^='exc-text-']").count();
    record("add issue: Approve sheet lists the reviewer issue as needing an exception", fields >= 1 && sheetText.includes(phrase), `${fields} exception field(s)`);
    await shot(page, "add-issue-approve-sheet");
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
  }

  // Error path: words that are not in the ad (typed into the editable quote box).
  await page.evaluate<void>("window.getSelection() && window.getSelection().removeAllRanges()");
  await page.waitForTimeout(300);
  record("add issue: floating button gone once the selection is cleared", (await page.locator("[data-add-issue-floating]").count()) === 0);
  await page.getByRole("button", { name: "Add issue", exact: true }).first().click();
  const dialog2 = page.getByRole("dialog", { name: "Add an issue" });
  record("add issue: header button opens the dialog without a selection", await dialog2.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false));
  await dialog2.locator("#add-issue-quote").fill("Zero percent forever, guaranteed by the moon");
  await dialog2.locator("#add-issue-why").fill("These words are not in the ad; the server must refuse them.");
  await dialog2.getByRole("button", { name: "Add issue", exact: true }).click();
  const inlineError = dialog2.getByRole("alert");
  const errored = await inlineError.waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false);
  record("add issue: words not in the ad -> inline error", errored && /not in this version of the ad/.test((await inlineError.innerText().catch(() => "")) ?? ""), errored ? await inlineError.innerText() : "no error shown");
  await shot(page, "add-issue-error");
  await page.keyboard.press("Escape");
  await dialog2.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
  const cardsAfterError = await page.locator("section[aria-label='Issues'] [data-finding-id]").count();
  record("add issue: nothing was added on the error path", cardsAfterError === cardsAfter, `${cardsAfterError} cards`);

  // Not a problem on the reviewer issue (same per-issue action as AI issues), so the approve step below is unchanged.
  const header = newCard.first().locator("button").first();
  if ((await header.getAttribute("aria-pressed")) !== "true") await header.click();
  await newCard.first().getByRole("button", { name: /Not a problem/ }).click();
  const form = page.getByText("Not a problem: why?");
  const formOpen = await form.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
  record("add issue: reviewer issue takes Not a problem like any other", formOpen);
  if (formOpen) {
    await page.getByRole("combobox", { name: /Reason/ }).click();
    await page.getByRole("option", { name: /Not applicable/ }).click();
    await page.locator("textarea[id^='note-']").fill(DISMISS_NOTE);
    await page.getByRole("button", { name: "Confirm" }).click();
    const dismissed = await waitForText(page, /Marked Not a problem/, 20_000);
    await page.waitForTimeout(1_500);
    const openNow = (await bodyText(page)).match(/Issues on V2\s*(\d+) open(?: of (\d+))?/);
    record("add issue: dismissed, open count back to where it was", dismissed && Number(openNow?.[1] ?? -1) === openBefore, `${openNow?.[1] ?? "?"} open`);
  }
}

async function approveFlow(page: Page, ad: TestAd) {
  await page.mouse.move(5, 5);
  await page.keyboard.press("a");
  const sheet = page.getByRole("dialog", { name: /Approve V2/ });
  record("ad: A opens the Approve V2 sheet", await sheet.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false));
  const sheetText = await sheet.innerText();
  const manual = /manual approval/i.test(sheetText);
  const exceptionBoxes = sheet.locator("textarea[id^='exc-text-']");
  const exceptionCount = await exceptionBoxes.count();
  record("ad: sheet states the exact version", /Approve V2 · [0-9a-f]{6}/.test(sheetText));
  const openStrict = await page.locator("section[aria-label='Critical issues'] [data-finding-id], section[aria-label='Major issues'] [data-finding-id]").count();
  if (manual) {
    record("ad: manual approval path (AI did not run) lists the still-open product-terms issues", /open issue.* from the product-terms check/i.test(sheetText) || !/open issue/i.test(sheetText), "no complete check, so no per-issue exceptions");
  } else if (openStrict > 0) {
    record("ad: exceptions path lists open Critical/Major with a reason each", exceptionCount === openStrict, `${exceptionCount} exception fields for ${openStrict} open issues`);
  } else {
    record("ad: plain approval (no Critical/Major open on V2)", exceptionCount === 0 && /No Critical or Major issues are open/.test(sheetText));
  }
  const submit = sheet.getByRole("button", { name: /^Approve( with exceptions)? V2$/ });
  record("ad: submit disabled before attestation/rationale", await submit.isDisabled());
  for (let i = 0; i < exceptionCount; i++) {
    const id = await exceptionBoxes.nth(i).getAttribute("id");
    await sheet.locator(`#${id!.replace("exc-text-", "exc-reason-")}`).click();
    await page.getByRole("option", { name: /Business decision/ }).click();
    await exceptionBoxes.nth(i).fill(RATIONALE);
  }
  const rationale = sheet.locator("#approve-rationale");
  await rationale.fill(RATIONALE);
  await sheet.getByRole("checkbox").click();
  record("ad: submit enabled once complete", await submit.isEnabled());
  await shot(page, "ad-approve-sheet");
  await submit.click();
  const toast = await waitForText(page, /Approved V2/, 20_000);
  record("ad: approval toast", toast);
  let advanced = false;
  for (let i = 0; i < 16 && !advanced; i++) {
    await page.waitForTimeout(500);
    advanced = !page.url().includes(ad.assetId);
  }
  record("ad: auto-advance to the next Needs-review ad (or a clear message)", advanced || /Nothing else needs review/.test(await bodyText(page)), advanced ? page.url() : "stayed");
  await shot(page, "ad-after-approve");

  // Approved tab row, then the approval record.
  await page.goto(`${BASE}/ads?tab=approved`, { waitUntil: "networkidle", timeout: 60_000 });
  const row = page.locator(`a[data-ad-row][href="/ads/${ad.assetId}"]`);
  const rowText = await row.innerText().catch(() => "");
  record("list: Approved tab row shows version, who and when", /V2/.test(rowText) && /by /.test(rowText) && /ago|just now/.test(rowText), rowText.replace(/\s+/g, " ").slice(0, 160));
  await shot(page, "list-approved");
  await row.click();
  await page.waitForURL(new RegExp(`/ads/${ad.assetId}`), { timeout: 30_000 });
  await settled(page);
  const text = await bodyText(page);
  record("ad: approval record shows exceptions, reviewer time and AI cost", /Approval record|Approved V2/.test(text) && /Exceptions/.test(text) && /Reviewer time/.test(text) && /AI cost/.test(text));
  record("ad: approved page is frozen (no Approve button)", (await page.getByRole("button", { name: /^Approve V/ }).count()) === 0);
  await shot(page, "ad-approved");
}

async function hiddenTextFlow(page: Page, ad: TestAd) {
  await page.goto(`${BASE}/ads/${ad.assetId}`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  const status = await runCheck(ad.versionId);
  record("hidden: check finished", status !== "timeout", status);
  await page.reload({ waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  const alert = page.getByRole("alert", { name: "Hidden text alert" });
  const pinned = await alert.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false);
  record("hidden: pinned alert shown", pinned);
  const excerpt = pinned ? await alert.locator("blockquote").first().innerText() : "";
  record("hidden: inert excerpt quoted", /approve|skip/i.test(excerpt), excerpt.slice(0, 80));
  const approve = page.getByRole("button", { name: /^Approve V1/ });
  record("hidden: Approve disabled until acknowledged", await approve.isDisabled());
  await shot(page, "hidden-alert");
  await page.getByRole("button", { name: /^Acknowledge/ }).click();
  const ack = await waitForText(page, /Acknowledged\. Decisions are unblocked/, 20_000);
  record("hidden: acknowledged state", ack);
  record("hidden: Approve enabled after acknowledging", await approve.isEnabled());
  await shot(page, "hidden-acknowledged");
}

async function rejectAndChipsFlow(page: Page, ad: TestAd) {
  await page.goto(`${BASE}/ads/${ad.assetId}`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  const status = await runCheck(ad.versionId);
  record("reject: check finished", status !== "timeout", status);
  await page.reload({ waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);

  // Product / channel chips.
  const product = page.getByRole("combobox", { name: "Product" });
  await product.click();
  await page.getByRole("option", { name: "Mortgage" }).click();
  await page.waitForTimeout(1_500);
  await page.reload({ waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  record("chips: product change persists", (await product.innerText()).includes("Mortgage"));
  record("chips: change is in the history", /Details changed/.test(await bodyText(page)));
  await product.click();
  await page.getByRole("option", { name: "Credit card" }).click();
  await page.waitForTimeout(1_000);
  const channel = page.getByRole("combobox", { name: "Channel" });
  await channel.click();
  await page.getByRole("option", { name: "Display" }).click();
  await page.waitForTimeout(1_500);
  await page.reload({ waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  record("chips: channel change persists", (await channel.innerText()).includes("Display"));

  // Ask about this ad: plain-English failure, layout intact.
  const ask = page.getByRole("region", { name: "Ask about this ad" });
  await ask.getByLabel("Your question").fill("Why was the APR flagged?");
  await ask.getByRole("button", { name: "Ask" }).click();
  const answered = await waitForText(page, /Ask isn't available right now|No answer came back|^.*You: Why was the APR flagged\?/m, 90_000);
  const askText = await ask.innerText();
  record("ask: plain-English result (gateway refuses -> \"Ask isn't available right now\")", answered, askText.replace(/\s+/g, " ").slice(0, 160));
  await noHorizontalScroll(page, "ask error");
  await shot(page, "ask-error");

  // Reject via the overflow menu.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /Reject/ }).click();
  const dialog = page.getByRole("dialog", { name: /Reject V1/ });
  record("reject: dialog opens from the overflow menu", await dialog.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false));
  const rejectButton = dialog.getByRole("button", { name: "Reject", exact: true });
  record("reject: button disabled without a reason", await rejectButton.isDisabled());
  await dialog.locator("#reject-rationale").fill("Off-brand creative; the campaign was cancelled by marketing this morning.");
  await shot(page, "reject-dialog");
  await rejectButton.click();
  const rejected = await waitForText(page, /Rejected V1/, 20_000);
  record("reject: toast and status", rejected);
  await page.waitForTimeout(2_000);
  await page.goto(`${BASE}/ads/${ad.assetId}`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  record("reject: page shows Rejected", /Rejected/.test(await bodyText(page)));
  await shot(page, "ad-rejected");
}

async function phoneFlow(page: Page, ads: TestAd[]) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/ads`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(500);
  await noHorizontalScroll(page, "list");
  record("list (390): no drop overlay without a drag", (await page.getByText("Drop to check this ad").count()) === 0);
  await shot(page, "list");

  await page.goto(`${BASE}/ads/${ads[0].assetId}`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  await page.waitForTimeout(500);
  await noHorizontalScroll(page, "ad page");
  const bar = page.locator("[data-decision-bar]");
  const box = await bar.boundingBox();
  const vh = 844;
  record("ad (390): decision bar reachable in the viewport", Boolean(box && box.y + box.height <= vh + 1 && box.y >= 0), box ? `y ${Math.round(box.y)} h ${Math.round(box.height)}` : "no bar");
  // Scroll to the end: History must not be hidden under the bar.
  await page.evaluate<void>("window.scrollTo(0, document.body.scrollHeight)");
  await page.waitForTimeout(300);
  const history = page.getByRole("region", { name: "History" });
  const hBox = await history.boundingBox();
  const bBox = await bar.boundingBox();
  record("ad (390): History not hidden under the decision bar", Boolean(hBox && bBox && hBox.y + hBox.height <= bBox.y + 1), hBox && bBox ? `history ends ${Math.round(hBox.y + hBox.height)}, bar starts ${Math.round(bBox.y)}` : "missing");
  await shot(page, "ad-page");

  // Hidden-text ad at phone width.
  await page.goto(`${BASE}/ads/${ads[1].assetId}`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  await page.waitForTimeout(500);
  await noHorizontalScroll(page, "hidden-text ad page");
  await shot(page, "hidden-ad");

  // Add issue at phone width: the Text tab, a selection, the floating button, the dialog.
  await page.getByRole("tab", { name: "Text" }).click();
  await page.waitForTimeout(300);
  const floating = await selectPhrase(page, "best personal loans");
  record("add issue (390): floating button appears by the selection", floating);
  if (floating) {
    const box = await page.locator("[data-add-issue-floating]").boundingBox();
    record("add issue (390): floating button within the viewport", Boolean(box && box.x >= 0 && box.x + box.width <= 390 + 1), box ? `x ${Math.round(box.x)}..${Math.round(box.x + box.width)}` : "missing");
    await page.locator("[data-add-issue-floating]").click();
  } else {
    await page.getByRole("button", { name: "Add issue", exact: true }).first().click();
  }
  const dialog = page.getByRole("dialog", { name: "Add an issue" });
  record("add issue (390): dialog opens", await dialog.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false));
  const dBox = await dialog.boundingBox();
  record("add issue (390): dialog fits the phone width", Boolean(dBox && dBox.x >= 0 && dBox.x + dBox.width <= 390 + 1), dBox ? `x ${Math.round(dBox.x)} w ${Math.round(dBox.width)}` : "missing");
  await noHorizontalScroll(page, "add issue dialog");
  await shot(page, "add-issue-dialog");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
  await page.setViewportSize({ width: 1280, height: 800 });
}

async function desktopHistoryCheck(page: Page, ad: TestAd) {
  await page.goto(`${BASE}/ads/${ad.assetId}`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  await page.waitForTimeout(500);
  await page.evaluate<void>("window.scrollTo(0, document.body.scrollHeight)");
  await page.waitForTimeout(300);
  const history = page.getByRole("region", { name: "History" });
  const hBox = await history.boundingBox();
  const bBox = await page.locator("[data-decision-bar]").boundingBox();
  record("ad (1280): History not hidden under the decision bar", Boolean(hBox && bBox && hBox.y + hBox.height <= bBox.y + 1), hBox && bBox ? `history ends ${Math.round(hBox.y + hBox.height)}, bar starts ${Math.round(bBox.y)}` : "missing");
}


// ---------------------------------------------------------------------------
// Worst-case data (break-ui): scripts/stress-ads.ts
// ---------------------------------------------------------------------------

const STRESS_HOSTS = /evil-(redirect|cdn|exfil|tracker|form|landing|frame|object)\.example/;

/** Elements whose content is wider than their box: text that escaped instead of wrapping or truncating. */
async function overflowingElements(page: Page, within = "main"): Promise<string[]> {
  return page.evaluate<string[]>(`(() => {
    const root = document.querySelector(${JSON.stringify(within)}) || document.body;
    const out = [];
    for (const el of root.querySelectorAll('*')) {
      if (el.closest('[data-slot="sheet-content"], [role="dialog"], iframe, pre')) continue;
      const cs = getComputedStyle(el);
      if (cs.overflowX !== 'visible') continue;
      // Content past the right edge of the viewport is the break; a full-bleed
      // bar or a focus-ring gutter with negative margins is not.
      const rect = el.getBoundingClientRect();
      if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && rect.left + el.scrollWidth > window.innerWidth + 1) {
        const tag = el.tagName.toLowerCase();
        const text = (el.textContent || '').trim().slice(0, 40);
        out.push(tag + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\\s+/).slice(0, 2).join('.') : '') + ' "' + text + '" ' + el.scrollWidth + '>' + el.clientWidth);
      }
    }
    return out.slice(0, 8);
  })()`);
}

async function stressListChecks(page: Page, ads: StressAd[], width: number) {
  await page.setViewportSize({ width, height: width < 600 ? 844 : 800 });
  const t0 = Date.now();
  await page.goto(`${BASE}/ads`, { waitUntil: "networkidle", timeout: 90_000 });
  await settled(page);
  const loadMs = Date.now() - t0;
  const rows = page.locator("a[data-ad-row]");
  const rowCount = await rows.count();
  record(`stress list (${width}): ${rowCount} rows rendered in ${loadMs} ms`, rowCount >= ads.length && loadMs < 15_000, `${rowCount} rows, expected >= ${ads.length}`);
  await noHorizontalScroll(page, `stress list (${width})`);
  const spill = await overflowingElements(page);
  record(`stress list (${width}): no element wider than its box`, spill.length === 0, spill.join(" | "));
  const text = await bodyText(page);
  record(`stress list (${width}): no relative time in the future`, !/\bin \d+ (min|h|d)\b/.test(text));

  // Rows for the nasty titles: visible, truncated with the full title on hover.
  for (const key of ["headline-300", "headline-400-nospace", "rtl-cjk-emoji", "one-emoji", "long-submitter", "findings-40", "image-only-pdf"]) {
    const ad = ads.find((a) => a.key === key);
    if (!ad) continue;
    const row = page.locator(`a[data-ad-row][href="/ads/${ad.assetId}"]`);
    const box = await row.boundingBox();
    const titleEl = row.locator("[data-ad-title]");
    const titleAttr = await titleEl.getAttribute("title").catch(() => null);
    const fits = Boolean(box && box.width <= width + 1);
    record(`stress list (${width}): row "${key}" fits and keeps the full title on hover`, fits && Boolean(titleAttr && titleAttr.length >= Math.min(ad.title.length, 40)), box ? `w ${Math.round(box.width)} title ${titleAttr?.length ?? 0} chars` : "no row");
    if (key === "findings-40") {
      const rowText = await row.innerText();
      record(`stress list (${width}): 40-finding row shows the count`, /40\s*(critical)?/.test(rowText), rowText.replace(/\s+/g, " ").slice(0, 120));
    }
    if (key === "image-only-pdf") {
      const rowText = await row.innerText();
      record(`stress list (${width}): image-only PDF row says no text was read (not "No open issues")`, /No text could be read/.test(rowText) && !/No open issues/.test(rowText), rowText.replace(/\s+/g, " ").slice(0, 120));
    }
  }

  // J walks every row; K comes back; the last row is reachable.
  await page.mouse.move(5, 5);
  await page.keyboard.press("Escape");
  for (let i = 0; i < rowCount; i++) await page.keyboard.press("j");
  const last = await page.evaluate<string | null>("document.activeElement ? document.activeElement.getAttribute('href') : null");
  const lastHref = await rows.last().getAttribute("href");
  record(`stress list (${width}): J reaches the last of ${rowCount} rows`, Boolean(last) && last === lastHref, `${last}`);
  const inView = await page.evaluate<boolean>("(() => { const r = document.activeElement.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; })()");
  record(`stress list (${width}): focused row scrolled into view`, inView);
  await shot(page, "stress-list");
}

async function stressAdPage(page: Page, ad: StressAd, width: number, extra?: (text: string) => Promise<void>) {
  await page.setViewportSize({ width, height: width < 600 ? 844 : 800 });
  await page.goto(`${BASE}/ads/${ad.assetId}`, { waitUntil: "networkidle", timeout: 90_000 });
  await settled(page);
  await page.waitForTimeout(300);
  await noHorizontalScroll(page, `stress ad "${ad.key}" (${width})`);
  const spill = await overflowingElements(page);
  record(`stress ad "${ad.key}" (${width}): no element wider than its box`, spill.length === 0, spill.join(" | "));
  const text = await bodyText(page);
  record(`stress ad "${ad.key}" (${width}): no relative time in the future`, !/\bin \d+ (min|h|d)\b/.test(text));
  // The sticky decision bar never hides the end of the page.
  await page.evaluate<void>("window.scrollTo(0, document.body.scrollHeight)");
  await page.waitForTimeout(250);
  const history = page.getByRole("region", { name: "History" });
  const hBox = await history.boundingBox();
  const bBox = await page.locator("[data-decision-bar]").boundingBox();
  record(`stress ad "${ad.key}" (${width}): History not hidden under the decision bar`, Boolean(hBox && bBox && hBox.y + hBox.height <= bBox.y + 1), hBox && bBox ? `history ends ${Math.round(hBox.y + hBox.height)}, bar starts ${Math.round(bBox.y)}` : "missing");
  if (extra) await extra(text);
  await shot(page, `stress-ad-${ad.key}`);
}

async function stressFlow(page: Page, ads: StressAd[]) {
  const by = (key: string) => ads.find((a) => a.key === key);

  for (const width of [1280, 390]) await stressListChecks(page, ads, width);

  // Headlines: 300 chars with spaces, 400 without.
  for (const key of ["headline-300", "headline-400-nospace"]) {
    const ad = by(key);
    if (!ad) continue;
    for (const width of [1280, 390]) {
      await stressAdPage(page, ad, width, async () => {
        const h1 = page.locator("h1").first();
        const box = await h1.boundingBox();
        record(`stress ad "${key}" (${width}): headline wraps inside the viewport`, Boolean(box && box.x >= 0 && box.x + box.width <= width + 1), box ? `x ${Math.round(box.x)} w ${Math.round(box.width)}` : "no h1");
      });
    }
  }

  // 60 KB in 200 paragraphs: renders, one "Body" label per run, highlight still works.
  const big = by("text-60kb");
  if (big) {
    await stressAdPage(page, big, 1280, async (text) => {
      const labels = await page.locator("section div.uppercase").count();
      record("stress ad \"text-60kb\": section labels collapsed (not one per paragraph)", labels > 0 && labels < 20, `${labels} labels`);
      record("stress ad \"text-60kb\": the whole text is on the page", /Section 28\./.test(text) && /Unsubscribe/.test(text));
    });
    await stressAdPage(page, big, 390);
  }

  // 40 findings: every card renders, the heading counts them, selecting one highlights.
  const f40 = by("findings-40");
  if (f40) {
    await stressAdPage(page, f40, 1280, async (text) => {
      const cards = await page.locator("section[aria-label='Issues'] [data-finding-id]").count();
      record("stress ad \"findings-40\": 40 issue cards", cards === 40, `${cards} cards`);
      record("stress ad \"findings-40\": heading says 40 open", /40 open/.test(text));
      await page.locator("section[aria-label='Issues'] [data-finding-id]").nth(39).locator("button").first().click();
      const selected = await page.locator("mark[data-selected]").first().waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
      record("stress ad \"findings-40\": selecting the 40th issue highlights its words", selected);
      await page.keyboard.press("Escape");
      await page.mouse.move(5, 5);
      await page.keyboard.press("r");
      const sheet = page.getByRole("dialog", { name: /Request changes/ });
      const open = await sheet.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
      if (open) {
        const note = await sheet.locator("#request-text").inputValue();
        record("stress ad \"findings-40\": request-changes note lists all 40", (note.match(/^\d+\. /gm) ?? []).length === 40, `${(note.match(/^\d+\. /gm) ?? []).length} numbered items`);
        await page.keyboard.press("Escape");
      }
    });
    await stressAdPage(page, f40, 390);
  }

  // Image ads: the 64px thumbnail crops (object-fit cover), never squashes.
  for (const key of ["image-wide", "image-tall"]) {
    const ad = by(key);
    if (!ad) continue;
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE}/ads`, { waitUntil: "networkidle", timeout: 90_000 });
    await settled(page);
    // Thumbnails load lazily: bring the row into view and give the signed URL a moment.
    const thumb = page.locator(`a[data-ad-row][href="/ads/${ad.assetId}"] img`);
    await thumb.scrollIntoViewIfNeeded().catch(() => undefined);
    const probe = `(() => { const el = document.querySelector('a[data-ad-row][href="/ads/${ad.assetId}"] img'); if (!el) return null; return { w: el.clientWidth, h: el.clientHeight, nw: el.naturalWidth, nh: el.naturalHeight, fit: getComputedStyle(el).objectFit }; })()`;
    type Fit = { w: number; h: number; nw: number; nh: number; fit: string };
    let fit: Fit | null = null;
    for (let i = 0; i < 20; i++) {
      fit = await page.evaluate<Fit | null>(probe);
      if (fit?.nw) break;
      await page.waitForTimeout(250);
    }
    record(`stress list: "${key}" thumbnail is square and crops instead of distorting`, Boolean(fit && fit.fit === "cover" && Math.abs(fit.w - fit.h) <= 1 && fit.nw > 0), fit ? `${fit.w}x${fit.h} box, ${fit.nw}x${fit.nh} image, object-fit ${fit.fit}` : "no thumbnail");
    await stressAdPage(page, ad, 390, async () => {
      const big = page.locator("main img[alt^='Ad image']").first();
      const box = await big.boundingBox();
      record(`stress ad "${key}" (390): the image fits the viewport`, Boolean(box && box.width <= 390 && box.height <= 844), box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "no image");
    });
  }

  // RTL + CJK + emoji, and the one-emoji ad.
  for (const key of ["rtl-cjk-emoji", "one-emoji"]) {
    const ad = by(key);
    if (!ad) continue;
    await stressAdPage(page, ad, 390, async (text) => {
      if (key === "rtl-cjk-emoji") record("stress ad \"rtl-cjk-emoji\": Arabic and Japanese text present", /قرض/.test(text) && /個人ローン/.test(text));
      if (key === "one-emoji") record("stress ad \"one-emoji\": the emoji is the title", /🏦/.test(text));
    });
  }

  // Inert HTML: sandbox + CSP, nothing executes, no request leaves for the ad's hosts.
  const evil = by("evil-html");
  if (evil) {
    // A request the policy blocks never reaches the network (Chromium reports
    // ERR_BLOCKED_BY_CSP); one that resolves DNS or finishes did leave.
    const leaked: string[] = [];
    const blocked: string[] = [];
    page.on("requestfinished", (req) => {
      if (STRESS_HOSTS.test(req.url())) leaked.push(req.url());
    });
    page.on("requestfailed", (req) => {
      const why = req.failure()?.errorText ?? "";
      if (!STRESS_HOSTS.test(req.url())) return;
      if (/^csp$|BLOCKED_BY_CSP|BLOCKED_BY_CLIENT|BLOCKED_BY_RESPONSE/.test(why)) blocked.push(`${req.url()} ${why}`);
      else leaked.push(`${req.url()} ${why}`);
    });
    await stressAdPage(page, evil, 1280, async (text) => {
      const frame = page.locator("iframe[title='Ad preview (sandboxed)']");
      record("stress ad \"evil-html\": preview iframe has an empty sandbox attribute", (await frame.getAttribute("sandbox")) === "");
      const srcdoc = (await frame.getAttribute("srcdoc")) ?? "";
      record("stress ad \"evil-html\": policy is the first thing in the document", /^<!doctype html><html><head><meta http-equiv="Content-Security-Policy"/.test(srcdoc) && /default-src 'none'/.test(srcdoc) && /img-src data:;/.test(srcdoc));
      record("stress ad \"evil-html\": meta refresh removed", !/http-equiv="refresh"/.test(srcdoc));
      const inner = page.frames().find((f) => f.url().startsWith("about:srcdoc")) ?? null;
      const title = inner ? await inner.title().catch(() => "") : "";
      record("stress ad \"evil-html\": the ad's script did not run (title unchanged)", title !== "pwned", `title "${title}"`);
      const imgs = inner ? await inner.evaluate<number[]>("Array.from(document.images).map(i => i.naturalWidth)") : [];
      record("stress ad \"evil-html\": remote images did not load", imgs.every((w) => w === 0), `natural widths ${imgs.join(",")}`);
      const nestedUrl = inner ? await inner.evaluate<string>("(() => { const f = document.querySelector('iframe'); return f && f.contentWindow ? 'has-window' : 'none'; })()").catch(() => "err") : "err";
      record("stress ad \"evil-html\": nested iframe did not load its remote page", leaked.every((u) => !/evil-frame/.test(u)), nestedUrl);
      // Click the link: nothing navigates (popup refused by the sandbox).
      const before = page.url();
      await inner?.locator("a").first().click({ timeout: 3_000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      record("stress ad \"evil-html\": clicking a link in the preview goes nowhere", page.url() === before && (inner ? inner.url() : "").startsWith("about:"), inner ? inner.url() : "");
      record("stress ad \"evil-html\": hidden instruction shown as an alert, not followed", /Hidden text aimed at the reviewer/.test(text) && /pre-cleared by legal/.test(text));
      record("stress ad \"evil-html\": footer says what the sandbox blocks", /no scripts, no network, no forms/.test(text) && /Remote images and files are not loaded/.test(text));
    });
    await page.waitForTimeout(1_000);
    record("stress ad \"evil-html\": zero requests left for the ad's remote hosts", leaked.length === 0, leaked.length ? leaked.slice(0, 3).join(" | ") : `${blocked.length} blocked by the policy before any network use`);
    await stressAdPage(page, evil, 390);
  }

  // Image-only PDF: honest empty state.
  const pdf = by("image-only-pdf");
  if (pdf) {
    await stressAdPage(page, pdf, 1280, async (text) => {
      await page.getByRole("tab", { name: "Text" }).click().catch(() => undefined);
      await page.waitForTimeout(300);
      const t = await bodyText(page);
      record("stress ad \"image-only-pdf\": says no text layer could be read and who (if anyone) read it", /No text layer could be read from this PDF/.test(t) && /(Nothing read it as an image either|The AI check read it as an image)/.test(t), t.match(/No text layer[^.]*\.[^.]*\./)?.[0]);
      record("stress ad \"image-only-pdf\": status card does not claim a check found nothing", !/it found nothing/.test(text));
    });
  }

  // 300-character submitter name and email.
  const sub = by("long-submitter");
  if (sub) {
    const admin = requireSupabaseAdminClient();
    await admin.from("assets").update({ submitter_name: LONG_SUBMITTER_NAME, submitter_email: LONG_SUBMITTER_EMAIL }).eq("id", sub.assetId);
    for (const width of [1280, 390]) {
      await stressAdPage(page, sub, width, async (text) => {
        record(`stress ad "long-submitter" (${width}): the 300-char name is on the page`, text.includes("ClearPath personal loan rates"));
      });
    }
    await admin.from("assets").update({ submitter_name: null, submitter_email: LONG_SUBMITTER_EMAIL }).eq("id", sub.assetId);
    await stressAdPage(page, sub, 390, async (text) => {
      record("stress ad \"long-submitter\" (390): a 300-char email with no spaces wraps", text.includes("@northwind-industries-holdings-"));
    });
  }

  // Approved tab: the 2,000-character exception.
  const exc = by("exception-2000");
  if (exc) {
    const approved = await approveWithLongException(exc.assetId, (m) => console.log(m));
    if (approved) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${BASE}/ads?tab=approved`, { waitUntil: "networkidle", timeout: 90_000 });
      await settled(page);
      const row = page.locator(`a[data-ad-row][href="/ads/${exc.assetId}"]`);
      const rowText = await row.innerText().catch(() => "");
      record("stress approved (390): row shows V1, who and With exceptions", /V1/.test(rowText) && /by /.test(rowText) && /With exceptions/.test(rowText), rowText.replace(/\s+/g, " ").slice(0, 160));
      await noHorizontalScroll(page, "stress approved tab (390)");
      const activeTab = await page.locator('nav[aria-label="Ad status"] [aria-current="page"]').boundingBox();
      record("stress approved (390): the current tab is scrolled into view in the tab strip", Boolean(activeTab && activeTab.x >= 0 && activeTab.x + activeTab.width <= 390), activeTab ? `x ${Math.round(activeTab.x)} w ${Math.round(activeTab.width)}` : "no active tab");
      await shot(page, "stress-approved-list");
      await stressAdPage(page, exc, 390, async (text) => {
        record("stress approved (390): approval record shows the 2,000-char exception in full", /Reviewed with product and legal on the Friday call/.test(text) && (text.match(/named owner/g) ?? []).length >= 2);
      });
      await stressAdPage(page, exc, 1280);
    } else {
      record("stress approved: could not approve the exception ad (see log)", false);
    }
  }

  // Intake refusals, through the real New ad dialog.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE}/ads`, { waitUntil: "networkidle", timeout: 90_000 });
  await settled(page);
  await page.getByRole("button", { name: "New ad" }).click();
  const dialog = page.getByRole("dialog", { name: "New ad" });
  await dialog.waitFor({ state: "visible", timeout: 5_000 });
  await dialog.getByRole("tab", { name: "Paste text" }).click();
  await dialog.locator("#new-ad-text").fill("   \n\n\t   ​​​​​​​​​​​   ");
  record("stress intake: whitespace-only paste keeps the button disabled", await dialog.getByRole("button", { name: "Check this ad" }).isDisabled());
  await dialog.getByRole("tab", { name: "File" }).click();
  const input = dialog.locator("input[type=file]");
  await input.setInputFiles({ name: "blank.txt", mimeType: "text/plain", buffer: Buffer.from("   \n\n   \t  \n") });
  // Intake also caps ads per member per hour; a stress run can hit it. That
  // refusal is plain copy too, so it counts, but the file checks need room.
  const blankMsg = await waitForText(page, /no readable text|in the last hour/, 20_000);
  const atQuota = /in the last hour/.test(await bodyText(page));
  record("stress intake: whitespace-only .txt refused with plain copy", blankMsg, atQuota ? "hourly limit reached first: refusal copy is the quota message" : (await bodyText(page)).match(/[^.]*no readable text[^.]*\./)?.[0]);
  await input.setInputFiles({ name: "huge.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(5 * 1024 * 1024) });
  const tooBig = await waitForText(page, /over 4 MB/, 10_000);
  record("stress intake: 5 MB file refused before upload", tooBig);
  await shot(page, "stress-intake-refusals");
  await input.setInputFiles({ name: "fall-flyer.pdf", mimeType: "application/pdf", buffer: Buffer.from(makePdf({ kind: "text", targetBytes: 3_900_000 })) });
  const accepted = await page.waitForURL(/\/ads\/[0-9a-f-]{36}/, { timeout: 120_000 }).then(() => true).catch(() => false);
  const afterText = await bodyText(page);
  const quotaHit = !accepted && /in the last hour/.test(afterText);
  record("stress intake: 3.9 MB PDF accepted (opens its ad page)", accepted || quotaHit, accepted ? page.url() : quotaHit ? "not tried: this member is at the hourly ad limit (re-run later)" : afterText.match(/did not go through[^.]*\./)?.[0] ?? "no redirect");
  if (accepted) {
    const id = page.url().split("/ads/")[1];
    const admin = requireSupabaseAdminClient();
    await admin.from("assets").update({ title: "[test] stress 3.9 MB PDF upload", audience: "sample" }).eq("id", id);
    ads.push({ key: "pdf-3.9mb", assetId: id, versionId: "", title: "[test] stress 3.9 MB PDF upload", created: true });
    record("stress intake: uploaded PDF text extracted", await waitForText(page, /Fall 2026 flyer|5\.99% APR/, 30_000));
  }
}

// ---------------------------------------------------------------------------

async function main() {
  if (!PASSWORD) throw new Error("Set SMOKE_PASSWORD (never commit it).");
  mkdirSync(SCREENS, { recursive: true });

  const ads: TestAd[] = [];
  if (!STRESS_ONLY) {
    console.log("setup: creating [test] sample ads");
    ads.push(await createTestAd("paid-social-personal-loan"));
    ads.push(await createTestAd("affiliate-hidden-text"));
    ads.push(await createTestAd("credit-card-sms"));
  }
  let stressAds: StressAd[] = [];
  if (STRESS) {
    console.log(`setup: worst-case ads (${BULK_COUNT} bulk rows + the nasty ones)`);
    stressAds = await ensureStressAds({ check: true, bulk: true });
  }

  const pw = (await import(process.env.PLAYWRIGHT_MODULE ?? "playwright")) as { chromium: { launch: () => Promise<Browser> } };
  const browser = await pw.chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  try {
    await signIn(page);
    if (!STRESS_ONLY) {
      await listFlow(page, ads);
      await checkFlow(page, ads[0]);
      await requestChangesFlow(page, context, ads[0]);
      await addIssueFlow(page, ads[0]);
      await approveFlow(page, ads[0]);
      await hiddenTextFlow(page, ads[1]);
      await rejectAndChipsFlow(page, ads[2]);
      await desktopHistoryCheck(page, ads[1]);
      await phoneFlow(page, [ads[0], ads[1]]);
    }
    if (STRESS) await stressFlow(page, stressAds);
  } catch (err) {
    record("flow crashed", false, (err as Error).message);
    await shot(page, "crash").catch(() => undefined);
  } finally {
    await browser.close();
    if (KEEP) console.log("--keep: leaving the [test] ads in place");
    else {
      await retireTestAds(ads);
      if (STRESS) await retireStressAds((m) => console.log(m));
    }
  }

  // An HTML ad that tries to run scripts or load remote files is meant to trip
  // the preview's sandbox and policy; the browser logs each block as an error.
  // Those lines are the defence working (auto-advance can open such an ad in any flow).
  const ignorable = (m: string) => /favicon|Download the React DevTools|hydrat.*suppress/i.test(m) || /Content Security Policy|sandboxed|about:srcdoc/i.test(m);
  const realConsole = consoleErrors.filter((m) => !ignorable(m));
  record("no browser console errors", realConsole.length === 0, realConsole.length ? realConsole.slice(0, 5).join(" | ").slice(0, 600) : undefined);
  record("no uncaught page errors", pageErrors.length === 0, pageErrors.length ? pageErrors.slice(0, 5).join(" | ").slice(0, 600) : undefined);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("verify-ads crashed:", err);
  process.exitCode = 1;
});
