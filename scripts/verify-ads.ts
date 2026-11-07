/**
 * Browser verification of the Ads list and the ad page (Playwright + Chromium)
 * against a running dev server. It creates its own throwaway sample ads
 * (audience 'sample', titles starting "[test] "), drives every review flow in
 * a real browser at 1280px and 390px, writes screenshots, and retires the ads
 * it created at the end (status 'withdrawn', audience 'sample_cleared').
 *
 *   doppler run -p promptarmor -c prd -- env SMOKE_PASSWORD=... \
 *     PLAYWRIGHT_MODULE=$HOME/.bun/install/global/node_modules/playwright \
 *     bun --conditions=react-server scripts/verify-ads.ts [--keep]
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

import { startAnalysisForVersion } from "@/lib/ai/engine";
import { createAd } from "@/lib/intake/ads";
import { getSampleAd } from "@/lib/seed/samples";
import { requireSupabaseAdminClient } from "@/lib/supabase/admin";

const BASE = (process.env.VERIFY_BASE_URL ?? "http://localhost:3102").replace(/\/$/, "");
const EMAIL = process.env.SMOKE_EMAIL ?? "promptarmortwo+reviewer@gmail.com";
const PASSWORD = process.env.SMOKE_PASSWORD;
const SCREENS = path.resolve(process.env.VERIFY_SCREENS ?? ".verify-screens");
const PROFILE_ID = process.env.VERIFY_PROFILE ?? "cf7d66e9-54d5-4b99-ac6f-89d760a20731";
const USER_ID = process.env.VERIFY_USER ?? "88b5b90e-3f4b-46a2-8c50-333240cbb671";
const KEEP = process.argv.includes("--keep");

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
  on: (event: string, handler: (arg: { text: () => string; type: () => string } & Error) => void) => void;
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
  await page.getByRole("button", { name: /Acknowledge/ }).first().click();
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

async function main() {
  if (!PASSWORD) throw new Error("Set SMOKE_PASSWORD (never commit it).");
  mkdirSync(SCREENS, { recursive: true });

  console.log("setup: creating [test] sample ads");
  const ads: TestAd[] = [];
  ads.push(await createTestAd("paid-social-personal-loan"));
  ads.push(await createTestAd("affiliate-hidden-text"));
  ads.push(await createTestAd("credit-card-sms"));

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
    await listFlow(page, ads);
    await checkFlow(page, ads[0]);
    await requestChangesFlow(page, context, ads[0]);
    await approveFlow(page, ads[0]);
    await hiddenTextFlow(page, ads[1]);
    await rejectAndChipsFlow(page, ads[2]);
    await desktopHistoryCheck(page, ads[1]);
    await phoneFlow(page, [ads[0], ads[1]]);
  } catch (err) {
    record("flow crashed", false, (err as Error).message);
    await shot(page, "crash").catch(() => undefined);
  } finally {
    await browser.close();
    if (KEEP) console.log("--keep: leaving the [test] ads in place");
    else await retireTestAds(ads);
  }

  const ignorable = (m: string) => /favicon|Download the React DevTools|hydrat.*suppress/i.test(m);
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
