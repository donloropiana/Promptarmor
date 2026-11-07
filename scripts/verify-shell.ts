/**
 * Browser verification of the shell, Rules | Products, Settings and sign-in
 * (Playwright + Chromium) against a running dev server, as the test account.
 *
 *   SMOKE_PASSWORD=... doppler run -p promptarmor -c prd -- bun scripts/verify-shell.ts
 *
 * Env: SMOKE_EMAIL (default promptarmortwo+reviewer@gmail.com), SMOKE_PASSWORD
 * (required, never committed), SMOKE_BASE_URL (default http://localhost:3103),
 * SMOKE_SCREENS (screenshot directory, default ./.verify-screens),
 * PLAYWRIGHT_MODULE (when playwright is not resolvable from this repo),
 * SUPABASE_URL + SUPABASE_SECRET_KEY (optional: verifies logged events and
 * retires the test ads it creates), VERIFY_CLEAR_SAMPLES=1 (also runs "Clear
 * samples", which hides every sample ad in the workspace, not only this
 * script's), VERIFY_INVITEE (default promptarmortwo+invitee@gmail.com).
 *
 * Everything it creates is marked "[test]" and retired at the end: the test
 * ad is withdrawn and cleared, the invitation is revoked. Rule and product
 * edits are immutable versions by design: the rule edit toggles one sentence
 * (so a second run restores the text), the PL-1 edit is followed by a restore.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = (process.env.SMOKE_BASE_URL ?? "http://localhost:3103").replace(/\/$/, "");
const EMAIL = process.env.SMOKE_EMAIL ?? "promptarmortwo+reviewer@gmail.com";
const PASSWORD = process.env.SMOKE_PASSWORD;
const INVITEE = (process.env.VERIFY_INVITEE ?? "promptarmortwo+invitee@gmail.com").toLowerCase();
const SCREENS = path.resolve(process.env.SMOKE_SCREENS ?? ".verify-screens");
const CLEAR_SAMPLES = process.env.VERIFY_CLEAR_SAMPLES === "1";
const CHECK_TIMEOUT_MS = 120_000;

const TEST_AD_TITLE = "[test] ClearPath personal loan: spring rate card";
const TEST_AD_TEXT = `${TEST_AD_TITLE}
Personal loans from $2,000 to $50,000 with fixed rates from 8.99% to 24.99% APR, including the 0.25% autopay discount.
Terms from 24 to 60 months. An origination fee of 1% to 5% is deducted from the loan proceeds.
Example: a $10,000 loan at 12.99% APR over 36 months has a monthly payment of $336.88.
Checking your rate does not affect your credit score. Final rate depends on credit history and other factors.`;

const ERROR_BOUNDARY_TEXT = ["Application error", "Unhandled Runtime Error", "Something went wrong", "Internal Server Error"];

// Minimal structural types for the dynamically imported Playwright module.
type Locator = {
  first: () => Locator;
  last: () => Locator;
  nth: (i: number) => Locator;
  locator: (selector: string, opts?: { hasText?: string | RegExp }) => Locator;
  getByRole: (role: string, opts?: { name?: string | RegExp; exact?: boolean }) => Locator;
  getByText: (text: string | RegExp, opts?: { exact?: boolean }) => Locator;
  getByLabel: (text: string | RegExp, opts?: { exact?: boolean }) => Locator;
  count: () => Promise<number>;
  click: (opts?: { timeout?: number; force?: boolean }) => Promise<void>;
  fill: (value: string, opts?: { timeout?: number }) => Promise<void>;
  press: (key: string) => Promise<void>;
  focus: () => Promise<void>;
  isVisible: () => Promise<boolean>;
  isDisabled: () => Promise<boolean>;
  waitFor: (opts?: { state?: "visible" | "hidden" | "attached" | "detached"; timeout?: number }) => Promise<void>;
  textContent: () => Promise<string | null>;
  innerText: () => Promise<string>;
  inputValue: () => Promise<string>;
  getAttribute: (name: string) => Promise<string | null>;
  evaluate: <T>(fn: string) => Promise<T>;
  boundingBox: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
  screenshot: (opts: { path: string }) => Promise<unknown>;
};

type Response = { status: () => number; url: () => string; json: () => Promise<unknown> };

type Page = {
  goto: (url: string, opts?: { waitUntil?: string; timeout?: number }) => Promise<{ status: () => number } | null>;
  url: () => string;
  locator: (selector: string, opts?: { hasText?: string | RegExp }) => Locator;
  getByRole: (role: string, opts?: { name?: string | RegExp; exact?: boolean }) => Locator;
  getByText: (text: string | RegExp, opts?: { exact?: boolean }) => Locator;
  getByLabel: (text: string | RegExp, opts?: { exact?: boolean }) => Locator;
  waitForURL: (url: string | RegExp, opts?: { timeout?: number }) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  waitForLoadState: (state?: string, opts?: { timeout?: number }) => Promise<void>;
  waitForResponse: (match: (r: Response) => boolean, opts?: { timeout?: number }) => Promise<Response>;
  screenshot: (opts: { path: string; fullPage?: boolean }) => Promise<unknown>;
  evaluate: <T>(fn: string) => Promise<T>;
  keyboard: { press: (key: string) => Promise<void>; type: (text: string) => Promise<void> };
  on: (event: string, handler: (arg: { text: () => string; type: () => string } & Error) => void) => void;
  setViewportSize: (size: { width: number; height: number }) => Promise<void>;
  reload: (opts?: { waitUntil?: string }) => Promise<unknown>;
  close: () => Promise<void>;
};

type Context = {
  newPage: () => Promise<Page>;
  close: () => Promise<void>;
  grantPermissions: (perms: string[], opts?: { origin?: string }) => Promise<void>;
};

const results: { label: string; ok: boolean; detail?: string }[] = [];
function record(label: string, ok: boolean, detail?: string) {
  results.push({ label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` · ${detail}` : ""}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function settled(page: Page, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pending = await page.evaluate<number>('document.querySelectorAll(\'[data-slot="skeleton"]\').length');
    if (pending === 0) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

async function bodyText(page: Page): Promise<string> {
  return page.locator("body").innerText().catch(() => "");
}

async function expectNoErrorBoundary(page: Page, label: string) {
  const body = await bodyText(page);
  const hit = ERROR_BOUNDARY_TEXT.find((t) => body.includes(t));
  record(`${label}: no error boundary`, !hit, hit ? `found "${hit}"` : undefined);
}

async function expectNoHorizontalScroll(page: Page, label: string) {
  const { scrollWidth, innerWidth } = await page.evaluate<{ scrollWidth: number; innerWidth: number }>(
    "({ scrollWidth: document.scrollingElement ? document.scrollingElement.scrollWidth : document.body.scrollWidth, innerWidth: window.innerWidth })",
  );
  record(`${label}: no horizontal scroll at ${innerWidth}px`, scrollWidth <= innerWidth + 1, `scrollWidth ${scrollWidth}`);
}

async function visit(page: Page, route: string, label: string) {
  const res = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 60_000 });
  const status = res?.status() ?? 0;
  record(`${label}: HTTP ${status}`, status === 200);
  const ok = await settled(page);
  record(`${label}: content streamed in`, ok, ok ? undefined : "a loading skeleton is still showing after 60 s");
  await expectNoErrorBoundary(page, label);
}

async function shot(page: Page, name: string, width: number, fullPage = true) {
  await settled(page);
  await page.waitForTimeout(250);
  const file = path.join(SCREENS, `${name}-${width}.png`);
  await page.screenshot({ path: file, fullPage });
  console.log(`      screenshot ${file}`);
  return file;
}

/** Waits for a sonner toast whose text matches, returns its text. */
async function waitForToast(page: Page, match: RegExp, timeout = 20_000): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const texts = await page.evaluate<string[]>(
      'Array.from(document.querySelectorAll(\'[data-sonner-toast]\')).map((n) => (n.textContent || "").trim())',
    );
    const hit = texts.find((t) => match.test(t));
    if (hit) return hit;
    await page.waitForTimeout(150);
  }
  return null;
}

async function signIn(page: Page) {
  await page.goto(`${BASE}/signin`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.getByRole("tab", { name: "Password" }).click();
  await page.locator("#pw-email").fill(EMAIL);
  await page.locator("#pw-password").fill(PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/ads(\?|$)/, { timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 });
}

// ---------------------------------------------------------------------------
// Optional admin access (events check + cleanup)
// ---------------------------------------------------------------------------

type Admin = {
  from: (table: string) => {
    select: (cols: string) => AdminQuery;
    update: (patch: Record<string, unknown>) => AdminQuery;
  };
};
type AdminQuery = {
  eq: (col: string, v: unknown) => AdminQuery;
  in: (col: string, v: unknown[]) => AdminQuery;
  gte: (col: string, v: unknown) => AdminQuery;
  like: (col: string, v: string) => AdminQuery;
  order: (col: string, opts?: { ascending?: boolean }) => AdminQuery;
  limit: (n: number) => AdminQuery;
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
  then: Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>["then"];
};

async function adminClient(): Promise<Admin | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  try {
    const mod = (await import("@supabase/supabase-js")) as { createClient: (u: string, k: string, o?: unknown) => unknown };
    return mod.createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as Admin;
  } catch (err) {
    console.warn("      admin client unavailable:", (err as Error).message);
    return null;
  }
}

async function countEvents(admin: Admin | null, profileId: string, kind: string, since: string): Promise<number | null> {
  if (!admin) return null;
  const { data, error } = await admin.from("events").select("id").eq("profile_id", profileId).eq("kind", kind).gte("created_at", since);
  if (error) return null;
  return (data ?? []).length;
}

// ---------------------------------------------------------------------------

async function main() {
  if (!PASSWORD) throw new Error("Set SMOKE_PASSWORD (never commit it).");
  mkdirSync(SCREENS, { recursive: true });
  const startedAt = new Date().toISOString();

  const admin = await adminClient();
  console.log(admin ? "      admin client ready (events + cleanup)" : "      no SUPABASE_SECRET_KEY: skipping event checks and cleanup");

  const pw = (await import(process.env.PLAYWRIGHT_MODULE ?? "playwright")) as {
    chromium: { launch: () => Promise<{ newContext: (o: unknown) => Promise<Context>; close: () => Promise<void> }> };
  };
  const browser = await pw.chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(`${page.url()} :: ${err.message.split("\n")[0]}`));

  let profileId: string | null = null;
  let testAdId: string | null = null;
  let inviteUrl: string | null = null;

  try {
    // =====================================================================
    // 7. Sign-in page (signed out), 1280 and 390
    // =====================================================================
    await page.goto(`${BASE}/signin?error=link_expired`, { waitUntil: "networkidle", timeout: 60_000 });
    let text = await bodyText(page);
    record("signin: expired-link error copy", /That link is invalid or has expired/.test(text));
    record("signin: no Google text anywhere", !/google/i.test(text));
    record("signin: email tab + password tab", (await page.getByRole("tab", { name: /Email link or code/ }).count()) === 1 && (await page.getByRole("tab", { name: "Password" }).count()) === 1);
    record("signin: email field has a plain-English helper", /sign-in link and a 6-digit code/.test(text));
    await shot(page, "signin", 1280);

    await page.getByRole("tab", { name: "Password" }).click();
    text = await bodyText(page);
    record("signin: password tab shows Forgot password + Create an account", /Forgot password\?/.test(text) && /Create an account/.test(text));
    await page.getByRole("button", { name: "Forgot password?" }).click();
    text = await bodyText(page);
    record("signin: forgot password form", /link to choose a new password/.test(text) && (await page.getByRole("button", { name: "Send reset link" }).count()) === 1);
    await page.getByRole("button", { name: "Back to password sign-in" }).click();

    // Wrong password -> inline error copy.
    await page.locator("#pw-email").fill(EMAIL);
    await page.locator("#pw-password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const wrongPw = await page.getByText("Incorrect email or password.").waitFor({ state: "visible", timeout: 30_000 }).then(() => true).catch(() => false);
    record("signin: wrong password shows 'Incorrect email or password.'", wrongPw);
    record("signin: email kept after a failed attempt", (await page.locator("#pw-email").inputValue()) === EMAIL);
    await shot(page, "signin-error", 1280, false);

    // Keyboard: the primary action is reachable with Tab from the password field.
    await page.locator("#pw-password").focus();
    await page.keyboard.press("Tab");
    const focusedLabel = await page.evaluate<string>("(document.activeElement && (document.activeElement.textContent || '')).trim()");
    record("signin: Tab from password lands on Sign in", focusedLabel === "Sign in", focusedLabel);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/signin`, { waitUntil: "networkidle", timeout: 60_000 });
    await expectNoHorizontalScroll(page, "signin");
    await shot(page, "signin", 390);
    await page.getByRole("tab", { name: "Password" }).click();
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expectNoHorizontalScroll(page, "signin forgot");
    await shot(page, "signin-forgot", 390, false);
    await page.setViewportSize({ width: 1280, height: 800 });

    // =====================================================================
    // 8. New account path while signed out
    // =====================================================================
    await page.goto(`${BASE}/new-workspace`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForURL(/\/signin/, { timeout: 30_000 }).catch(() => undefined);
    record("/new-workspace signed out -> /signin?next=/new-workspace", /\/signin\?next=%2Fnew-workspace/.test(page.url()), page.url());

    // =====================================================================
    // Sign in
    // =====================================================================
    await signIn(page);
    record("password sign-in -> /ads", /\/ads/.test(page.url()), page.url());
    await settled(page);

    // =====================================================================
    // 1. Sidebar
    // =====================================================================
    const switcher = page.getByRole("button", { name: /^Workspace: / });
    record("sidebar: workspace switcher names the workspace", /ClearPath Financial/.test((await switcher.getAttribute("aria-label")) ?? ""));
    await switcher.click();
    let menu = page.getByRole("menu");
    await menu.waitFor({ state: "visible", timeout: 10_000 });
    text = await menu.innerText();
    record("sidebar: switcher lists workspaces + New workspace", /Workspaces/.test(text) && /ClearPath Financial/.test(text) && /New workspace/.test(text));
    await shot(page, "sidebar-switcher", 1280, false);
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);

    const adsLink = page.locator('[data-sidebar="menu-button"][aria-current="page"]');
    record("sidebar: Ads is the active item on /ads", /Ads/.test((await adsLink.first().innerText().catch(() => "")) ?? ""));
    await page.getByRole("link", { name: "Rules", exact: true }).first().click();
    await page.waitForURL(/\/rules/, { timeout: 30_000 });
    await settled(page);
    record("sidebar: Rules is the active item on /rules", /Rules/.test(await page.locator('[data-sidebar="menu-button"][aria-current="page"]').first().innerText().catch(() => "")));

    // Bell
    const bell = page.getByRole("button", { name: "Activity" }).first();
    await bell.click();
    const bellPanel = page.getByRole("dialog").first();
    await bellPanel.waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForTimeout(800);
    await settled(page, 15_000);
    text = await bellPanel.innerText();
    const rawKinds = /\b[a-z_]+\.[a-z_]+\b/.test(text.replace(/\d+\.\d+/g, ""));
    record("bell: opens an Activity list in plain English", /Activity/.test(text) && !rawKinds && !/undefined|null/.test(text), text.slice(0, 160).replace(/\n/g, " | "));
    await shot(page, "bell", 1280, false);
    await page.keyboard.press("Escape");

    // Bottom menu
    const bottom = page.getByRole("button", { name: /Workspace menu$/ });
    await bottom.click();
    menu = page.getByRole("menu");
    await menu.waitFor({ state: "visible", timeout: 10_000 });
    text = await menu.innerText();
    record("sidebar: bottom menu has Members, Connected accounts, Workspace, Sign out", /Members/.test(text) && /Connected accounts/.test(text) && /Workspace/.test(text) && /Sign out/.test(text));
    await shot(page, "sidebar-menu", 1280, false);
    await page.keyboard.press("Escape");

    // Mobile shell
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/ads`, { waitUntil: "networkidle", timeout: 60_000 });
    await settled(page);
    await expectNoHorizontalScroll(page, "ads (390)");
    const openMenu = page.getByRole("button", { name: "Open menu" });
    record("mobile: top bar with Open menu", await openMenu.isVisible());
    await openMenu.click();
    const sheet = page.getByRole("dialog");
    await sheet.waitFor({ state: "visible", timeout: 10_000 });
    text = await sheet.innerText();
    record("mobile: sheet shows nav + workspace", /Ads/.test(text) && /Rules/.test(text) && /ClearPath Financial/.test(text));
    await shot(page, "mobile-sheet", 390, false);
    await sheet.getByRole("link", { name: "Rules", exact: true }).click();
    await page.waitForURL(/\/rules/, { timeout: 30_000 });
    await sheet.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
    record("mobile: picking a nav item closes the sheet", !(await sheet.isVisible().catch(() => false)));
    await settled(page);
    await expectNoHorizontalScroll(page, "rules (390)");
    await shot(page, "rules", 390);
    await page.setViewportSize({ width: 1280, height: 800 });

    // =====================================================================
    // 2. Rules
    // =====================================================================
    await visit(page, "/rules", "rules");
    const ruleCards = page.locator("li[data-active]");
    const ruleCount = await ruleCards.count();
    record("rules: starter rules listed (>= 16)", ruleCount >= 16, `${ruleCount} cards`);
    const legalLinks = page.locator('li[data-active] a[target="_blank"]');
    record("rules: legal source links open in a new tab", (await legalLinks.count()) > 0, `${await legalLinks.count()} links`);
    const firstLink = legalLinks.first();
    record("rules: legal links say so for screen readers", /opens in a new tab/.test((await firstLink.innerText().catch(() => "")) + (await firstLink.textContent().catch(() => ""))));
    record("rules: count line", /\d+ of \d+ on/.test(await bodyText(page)));
    await shot(page, "rules", 1280);

    // profileId from the Add rule sheet is not exposed; use the admin client (rules.profile_id) later.
    if (admin) {
      const { data } = await admin.from("profiles").select("id").eq("name", "ClearPath Financial").limit(1);
      profileId = (data?.[0]?.id as string | undefined) ?? null;
    }

    // Toggle the first rule off and on. The card is found by its code, and it
    // must stay where it is (the list order does not depend on on/off).
    const firstTitle = (await ruleCards.first().locator("h3").first().innerText()).trim();
    const firstCode = (await ruleCards.first().locator("h3 + span").first().innerText()).trim();
    const firstCard = page.locator("li[data-active]", { hasText: firstCode }).first();
    const sw = firstCard.getByRole("switch");
    await sw.click();
    await page.waitForTimeout(1_500);
    record("rules: toggle off updates the switch", (await sw.getAttribute("aria-checked")) === "false" && (await firstCard.getAttribute("data-active")) === "false");
    const stillFirst = ((await ruleCards.first().locator("h3 + span").first().innerText()).trim()) === firstCode;
    record("rules: a rule turned off stays in place", stillFirst, stillFirst ? undefined : "the card moved");
    await sw.click();
    await page.waitForTimeout(1_500);
    record("rules: toggle on updates the switch", (await sw.getAttribute("aria-checked")) === "true" && (await firstCard.getAttribute("data-active")) === "true");
    if (admin && profileId) {
      const off = await countEvents(admin, profileId, "rule.disabled", startedAt);
      const on = await countEvents(admin, profileId, "rule.enabled", startedAt);
      record("rules: toggle events logged (rule.disabled + rule.enabled)", (off ?? 0) >= 1 && (on ?? 0) >= 1, `${off} off, ${on} on`);
    }

    // Edit the first rule: toggle a clarifying sentence in the body (idempotent across runs).
    await firstCard.getByRole("button", { name: "Edit" }).click();
    const editSheet = page.getByRole("dialog", { name: "Edit rule" });
    await editSheet.waitFor({ state: "visible", timeout: 10_000 });
    const bodyField = editSheet.locator("textarea").first();
    const currentBody = await bodyField.inputValue();
    const MARK = " Reviewers: when in doubt, quote the exact words that triggered this rule.";
    const nextBody = currentBody.includes(MARK) ? currentBody.replace(MARK, "") : `${currentBody}${MARK}`;
    const saveBtn = editSheet.getByRole("button", { name: /^Save as V\d+/ });
    record("rules: Save is disabled until something changes", await saveBtn.isDisabled());
    await bodyField.fill(nextBody);
    record("rules: Save stays disabled without a reason", await saveBtn.isDisabled());
    await editSheet.getByLabel("Reason").fill(currentBody.includes(MARK) ? "Removing the reviewer note added during verification" : "Clarify what reviewers should quote when applying this rule");
    const saveLabel = (await saveBtn.innerText()).trim();
    await saveBtn.click();
    const savedToast = await waitForToast(page, /Saved V\d+ of/);
    record("rules: edit saves a new version with a toast", savedToast !== null, savedToast ?? undefined);
    await editSheet.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    await settled(page);

    // History shows the new version with a redline.
    const editedCard = page.locator("li[data-active]", { hasText: firstTitle }).first();
    await editedCard.getByRole("button", { name: /History/ }).click();
    const historySheet = page.getByRole("dialog", { name: /^History ·/ });
    await historySheet.waitFor({ state: "visible", timeout: 10_000 });
    text = await historySheet.innerText();
    const expectedV = saveLabel.replace("Save as ", "");
    const hasV = new RegExp(`\\b${expectedV}\\b`).test(text);
    const redline = (await historySheet.locator("ins, del").count()) > 0;
    record(`rules: history shows ${expectedV} as Current with a redline`, hasV && /Current/.test(text) && redline, redline ? undefined : "no <ins>/<del> in the history");
    record("rules: history explains the redline", /struck through/.test(text));
    await shot(page, "rule-history", 1280, false);
    await page.keyboard.press("Escape");
    await historySheet.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
    if (admin && profileId) {
      const n = await countEvents(admin, profileId, "rule.edited", startedAt);
      record("rules: rule.edited event logged", (n ?? 0) >= 1, `${n}`);
    }

    // Add rule: validation + duplicate code copy (no permanent rule is created).
    await page.getByRole("button", { name: "Add rule" }).click();
    const addSheet = page.getByRole("dialog", { name: "Add rule" });
    await addSheet.waitFor({ state: "visible", timeout: 10_000 });
    const addBtn = addSheet.getByRole("button", { name: "Add rule" });
    record("rules: Add rule is disabled until code, title and body are filled", await addBtn.isDisabled());
    const dupCode = firstCode || "APR-TERM";
    await addSheet.getByLabel("Code").fill(dupCode);
    await addSheet.getByLabel("Title").fill("[test] duplicate code check");
    await addSheet.getByLabel("What it checks").fill("This rule is never saved: its code already exists.");
    await addBtn.click();
    const dupError = await addSheet.getByText(/A rule with that code already exists in this workspace\./).waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false);
    record("rules: duplicate code shows a plain error", dupError, dupCode);
    await shot(page, "rule-add-duplicate", 1280, false);
    await page.keyboard.press("Escape");
    await addSheet.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);

    // =====================================================================
    // 3. Products, with a [test] ad approved first
    // =====================================================================
    // Create the test ad (New ad > Paste text).
    await visit(page, "/ads", "ads");
    const chip = page.getByRole("button", { name: /Paid social post: personal loan/ }).first();
    const emptyWorkspace = await chip.isVisible().catch(() => false);
    if (emptyWorkspace) {
      record("ads: empty workspace (no drop bar) — creating the test ad needs New ad", false, "the empty state has no New ad button; use a sample first");
    }
    await page.getByRole("button", { name: "New ad" }).first().click();
    const newAd = page.getByRole("dialog", { name: "New ad" });
    await newAd.waitFor({ state: "visible", timeout: 10_000 });
    await newAd.getByRole("tab", { name: "Paste text" }).click();
    await newAd.locator("textarea").fill(TEST_AD_TEXT);
    await newAd.getByRole("button", { name: "Check this ad" }).click();
    await page.waitForURL(/\/ads\/[0-9a-f-]{36}/, { timeout: 90_000 });
    testAdId = page.url().match(/\/ads\/([0-9a-f-]{36})/)?.[1] ?? null;
    record("ads: [test] ad created", testAdId !== null, page.url());

    // Mark it a sample right away (test data hygiene).
    if (admin && testAdId) {
      const { error } = await admin.from("assets").update({ audience: "sample" }).eq("id", testAdId);
      record("ads: test ad marked audience=sample", !error, error?.message);
    }

    // Wait for the check to settle: failed -> Needs review, Not AI-screened.
    let outcome: "issues" | "not_screened" | "none" = "none";
    const t0 = Date.now();
    while (Date.now() - t0 < CHECK_TIMEOUT_MS) {
      const t = await bodyText(page);
      if (t.includes("Not AI-screened")) {
        outcome = "not_screened";
        break;
      }
      if (/\b(Critical|Major|Minor)\b/.test(t) && !/Checking V\d+…/.test(t)) {
        outcome = "issues";
        break;
      }
      await page.waitForTimeout(2_500);
    }
    record("ads: check settled", outcome !== "none", outcome);

    // Approve V1 by hand (rationale >= 40 chars, exceptions if any).
    await page.getByRole("button", { name: /^Approve V1/ }).click();
    const approveSheet = page.getByRole("dialog", { name: /^Approve V1/ });
    await approveSheet.waitFor({ state: "visible", timeout: 10_000 });
    const exceptionBoxes = approveSheet.locator('textarea[id^="exc-text-"]');
    const excCount = await exceptionBoxes.count();
    for (let i = 0; i < excCount; i++) {
      const box = exceptionBoxes.nth(i);
      const id = (await box.getAttribute("id")) ?? "";
      const fid = id.replace("exc-text-", "");
      await approveSheet.locator(`#exc-reason-${fid}`).click();
      await page.getByRole("option").first().click();
      await box.fill("Verification run: the quoted terms match the PL-1 rate card on file and were checked by hand.");
    }
    await approveSheet.locator("#approve-rationale").fill("Verification run: terms match the current PL-1 rate card; reviewed by hand because the AI check did not complete.");
    await approveSheet.getByRole("checkbox").click();
    const approveSubmit = approveSheet.getByRole("button", { name: /^Approve(?: with exceptions)? V1/ });
    record("ads: Approve V1 enabled after rationale + attestation", !(await approveSubmit.isDisabled()), excCount ? `${excCount} exceptions written` : undefined);
    await approveSubmit.click();
    const approvedToast = await waitForToast(page, /Approved V1/);
    record("ads: Approved V1 toast", approvedToast !== null, approvedToast ?? undefined);
    await sleep(2_500);

    // Edit PL-1: raise the lowest APR, confirm copy, save.
    await visit(page, "/rules?tab=products", "rules-products");
    text = await bodyText(page);
    record("products: PL-1, CC-1, CC-2 and MG-1 term sheets", ["PL-1", "CC-1", "CC-2", "MG-1"].every((c) => text.includes(c)));
    record("products: term sheet shows Lowest APR", /Lowest APR/.test(text));
    await shot(page, "products", 1280);
    const pl1 = page.locator("li[data-active]", { hasText: "PL-1" }).first();
    const pl1Version = Number(((await pl1.innerText()).match(/\bV(\d+)\b/) ?? [])[1] ?? "1");
    await pl1.getByRole("button", { name: "Edit terms" }).click();
    const termsSheet = page.getByRole("dialog", { name: /^Edit terms · PL-1/ });
    await termsSheet.waitFor({ state: "visible", timeout: 10_000 });
    const aprMin = termsSheet.getByLabel(/^Lowest APR/);
    const aprBefore = await aprMin.inputValue();
    const aprAfter = String(Math.round((Number(aprBefore) + 0.5) * 100) / 100);
    await aprMin.fill(aprAfter);
    await termsSheet.getByLabel("Reason").fill("Verification run: rate card moved the floor up by 0.5 points");
    await termsSheet.getByRole("button", { name: /^Save as V\d+/ }).click();
    const confirm = page.getByRole("alertdialog");
    await confirm.waitFor({ state: "visible", timeout: 20_000 });
    text = await confirm.innerText();
    const sendsBack = /This sends (\d+) approved ads? back to Needs review/.exec(text);
    record("products: confirm dialog says how many approved ads go back", sendsBack !== null, text.split("\n")[0]);
    record("products: confirm dialog lists the [test] ad", text.includes(TEST_AD_TITLE));
    record("products: confirm dialog explains the tag", /tagged “Rates changed”/.test(text));
    await shot(page, "products-confirm", 1280, false);
    await confirm.getByRole("button", { name: /^Save and send \d+ back|^Save terms$/ }).click();
    const savedTerms = await waitForToast(page, /Saved PL-1 V\d+/);
    record("products: saved toast names the version and the affected ads", savedTerms !== null && /back in Needs review/.test(savedTerms ?? ""), savedTerms ?? undefined);
    await confirm.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    await settled(page);
    const pl1After = page.locator("li[data-active]", { hasText: "PL-1" }).first();
    record(`products: PL-1 card now shows V${pl1Version + 1} with the new floor`, new RegExp(`V${pl1Version + 1}\\b`).test(await pl1After.innerText()) && (await pl1After.innerText()).includes(`${aprAfter}%`));

    // The approved [test] ad is back in Needs review, tagged Rates changed.
    if (testAdId) {
      await visit(page, `/ads/${testAdId}`, "test ad after terms change");
      text = await bodyText(page);
      record("ads: approved ad came back as Needs review · Rates changed", /Rates changed/.test(text) && /Needs review/.test(text));
      record("ads: ad page explains why it came back", /Rates changed since approval/.test(text));
      await shot(page, "ad-rates-changed", 1280, false);
      await visit(page, "/ads", "ads list after terms change");
      const row = page.locator("a, li", { hasText: TEST_AD_TITLE }).first();
      const rowText = await row.innerText().catch(() => "");
      record("ads list: the row shows the Rates changed tag", /Rates changed/.test(rowText), rowText.slice(0, 120).replace(/\n/g, " | "));
    }

    // Bell shows the offer.changed line.
    await page.getByRole("button", { name: "Activity" }).first().click();
    const bell2 = page.getByRole("dialog").first();
    await bell2.waitFor({ state: "visible", timeout: 10_000 });
    const bellLine = await bell2.getByText(/changed the terms of product PL-1/).first().waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false);
    text = await bell2.innerText();
    record("bell: shows the offer.changed line", bellLine && /back to Needs review/.test(text), (text.match(/[^\n]*changed the terms[^\n]*/) ?? [""])[0]);
    await shot(page, "bell-offer-changed", 1280, false);
    await page.keyboard.press("Escape");

    // Restore PL-1 (new version, back to the old floor).
    await visit(page, "/rules?tab=products", "rules-products (restore)");
    const pl1b = page.locator("li[data-active]", { hasText: "PL-1" }).first();
    await pl1b.getByRole("button", { name: "Edit terms" }).click();
    const termsSheet2 = page.getByRole("dialog", { name: /^Edit terms · PL-1/ });
    await termsSheet2.waitFor({ state: "visible", timeout: 10_000 });
    await termsSheet2.getByLabel(/^Lowest APR/).fill(aprBefore);
    await termsSheet2.getByLabel("Reason").fill("Verification run: restoring the previous floor");
    await termsSheet2.getByRole("button", { name: /^Save as V\d+/ }).click();
    const confirm2 = page.getByRole("alertdialog");
    await confirm2.waitFor({ state: "visible", timeout: 20_000 });
    text = await confirm2.innerText();
    record("products: restore confirm says no approved ads are affected", /Save new terms\?/.test(text) && /No approved ad relied on/.test(text), text.split("\n")[0]);
    await confirm2.getByRole("button", { name: "Save terms" }).click();
    const restored = await waitForToast(page, /Saved PL-1 V\d+/);
    record("products: PL-1 restored as a new version", restored !== null, restored ?? undefined);
    await confirm2.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    await settled(page);

    // Product history shows the versions.
    const pl1c = page.locator("li[data-active]", { hasText: "PL-1" }).first();
    await pl1c.getByRole("button", { name: /History/ }).click();
    const pHistory = page.getByRole("dialog", { name: /^History ·/ });
    await pHistory.waitFor({ state: "visible", timeout: 10_000 });
    text = await pHistory.innerText();
    record("products: history lists the versions with reasons", /restoring the previous floor/.test(text) && /moved the floor up/.test(text));
    await shot(page, "product-history", 1280, false);
    await page.keyboard.press("Escape");
    await pHistory.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);

    // =====================================================================
    // 4. Members
    // =====================================================================
    await visit(page, "/settings/members", "settings-members");
    text = await bodyText(page);
    record("members: lists the owner with (you)", /\(you\)/.test(text) && /Owner/.test(text));
    await shot(page, "members", 1280);

    // Last-owner protections.
    const meRow = page.locator("li", { hasText: "(you)" }).first();
    await meRow.getByRole("button", { name: /^Actions for/ }).click();
    menu = page.getByRole("menu");
    await menu.waitFor({ state: "visible", timeout: 10_000 });
    const makeMember = menu.getByRole("menuitem", { name: "Make member" });
    const leave = menu.getByRole("menuitem", { name: "Leave workspace" });
    const mmDisabled = (await makeMember.getAttribute("aria-disabled")) === "true" || (await makeMember.getAttribute("data-disabled")) !== null;
    const lvDisabled = (await leave.getAttribute("aria-disabled")) === "true" || (await leave.getAttribute("data-disabled")) !== null;
    record("members: last owner can't be demoted or leave (items disabled + explanation)", mmDisabled && lvDisabled && /last owner can.t be removed or demoted/.test(await menu.innerText()));
    await shot(page, "members-last-owner", 1280, false);
    await page.keyboard.press("Escape");

    // Invite -> link dialog -> copy.
    await page.locator("#invite-email").fill(INVITEE);
    await page.getByRole("button", { name: "Invite" }).click();
    const linkDialog = page.getByRole("dialog", { name: /^Invitation link for/ });
    await linkDialog.waitFor({ state: "visible", timeout: 30_000 });
    inviteUrl = await linkDialog.getByLabel("Invitation link").inputValue();
    record("members: invite shows a link dialog", /\/invite\/[0-9a-f]{64}$/.test(inviteUrl ?? ""), inviteUrl ?? undefined);
    await linkDialog.getByRole("button", { name: "Copy" }).click();
    const copied = await linkDialog.getByRole("button", { name: "Copied" }).waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
    const clip = await page.evaluate<string>("navigator.clipboard.readText().catch(() => '')");
    record("members: Copy copies the link", copied && clip === inviteUrl, copied ? undefined : "button never said Copied");
    await shot(page, "members-invite-link", 1280, false);
    await page.keyboard.press("Escape");
    await linkDialog.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(600);
    await settled(page);

    // Pending list -> Send again -> Revoke.
    const pending = page.locator("li", { hasText: INVITEE }).first();
    record("members: pending list shows the invitation", await pending.isVisible().catch(() => false));
    await pending.getByRole("button", { name: "Send again" }).click();
    const again = page.getByRole("dialog", { name: /^Invitation link for/ });
    await again.waitFor({ state: "visible", timeout: 30_000 });
    const newUrl = await again.getByLabel("Invitation link").inputValue();
    record("members: Send again makes a fresh link", /\/invite\/[0-9a-f]{64}$/.test(newUrl) && newUrl !== inviteUrl);
    record("members: Send again copy says the old link stopped working", /old one no longer works/.test(await again.innerText()));
    inviteUrl = newUrl;
    await page.keyboard.press("Escape");
    await again.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);

    // Invite landing page: signed out, then signed in as the wrong account.
    const outCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    try {
      const outPage = await outCtx.newPage();
      await outPage.goto(inviteUrl, { waitUntil: "networkidle", timeout: 60_000 });
      await outPage.waitForURL(/\/signin\?next=%2Finvite%2F/, { timeout: 30_000 }).catch(() => undefined);
      const t = await bodyText(outPage);
      record("invite: signed out -> sign-in with invitation copy", /\/signin\?next=%2Finvite%2F/.test(outPage.url()) && /Sign in to accept your invitation/.test(t) && /email address the invitation was sent to/.test(t), outPage.url());
      await outPage.screenshot({ path: path.join(SCREENS, "invite-signed-out-1280.png"), fullPage: false });
    } finally {
      await outCtx.close();
    }
    await page.goto(inviteUrl, { waitUntil: "networkidle", timeout: 60_000 });
    await settled(page);
    text = await bodyText(page);
    record("invite: wrong account explains who it was sent to", /Wrong account/.test(text) && /This invitation was sent to/.test(text) && /you.re signed in as/.test(text) && /Sign out and switch account/.test(text), text.split("\n").slice(0, 3).join(" | "));
    await shot(page, "invite-wrong-account", 1280, false);

    // Revoke.
    await visit(page, "/settings/members", "settings-members (revoke)");
    const pending2 = page.locator("li", { hasText: INVITEE }).first();
    await pending2.getByRole("button", { name: "Revoke" }).click();
    const revoked = await waitForToast(page, /Invitation for .* revoked/);
    record("members: Revoke removes the invitation", revoked !== null, revoked ?? undefined);
    const gone = await page.locator("li", { hasText: INVITEE }).first().waitFor({ state: "hidden", timeout: 10_000 }).then(() => true).catch(() => false);
    record("members: pending list updates after Revoke", gone, gone ? undefined : "row still visible 10 s after the toast");
    inviteUrl = null;

    // Bad invitation links are explained, not crashed on.
    await page.goto(`${BASE}/invite/not-a-real-token`, { waitUntil: "networkidle", timeout: 60_000 });
    await settled(page);
    record("invite: malformed link explains itself", /Invitation not found/.test(await bodyText(page)) && /copied the whole link/.test(await bodyText(page)));
    await page.goto(`${BASE}/invite/${"0".repeat(64)}`, { waitUntil: "networkidle", timeout: 60_000 });
    await settled(page);
    record("invite: unknown token explains itself", /Invitation not found/.test(await bodyText(page)) && /Ask a workspace owner/.test(await bodyText(page)));
    await page.goto(`${BASE}/settings`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForURL(/\/settings\/members/, { timeout: 30_000 }).catch(() => undefined);
    record("/settings -> /settings/members", /\/settings\/members/.test(page.url()), page.url());

    // =====================================================================
    // 5. Connected accounts
    // =====================================================================
    await visit(page, "/settings/accounts", "settings-accounts");
    text = await bodyText(page);
    record("accounts: honest card copy", /Reads only/.test(text) && /Looks back 14 days/.test(text) && /Keeps only ads/.test(text) && /wider permissions than we use/.test(text));
    record("accounts: Connect Google + Connect Microsoft, one click each", (await page.getByRole("button", { name: "Connect Google" }).count()) === 1 && (await page.getByRole("button", { name: "Connect Microsoft" }).count()) === 1);
    const noneYet = /Nothing connected yet/.test(text);
    record("accounts: empty state copy (or connections listed)", noneYet || /Listed by the member who connected them/.test(text), noneYet ? "empty state" : "has connections");
    await shot(page, "accounts", 1280);

    const googleBtn = page.getByRole("button", { name: "Connect Google" });
    const sessionPromise = page.waitForResponse((r) => r.url().includes("/api/connections/session"), { timeout: 30_000 });
    await googleBtn.click();
    const sessionRes = await sessionPromise.catch(() => null);
    record("accounts: Connect Google calls /api/connections/session", sessionRes !== null && sessionRes.status() === 200, sessionRes ? `HTTP ${sessionRes.status()}` : "no request");
    const iframe = page.locator("iframe#connect-ui");
    const iframeUp = await iframe.waitFor({ state: "attached", timeout: 15_000 }).then(() => true).catch(() => false);
    record("accounts: Nango Connect UI opens", iframeUp);
    record("accounts: button shows the connecting state", (await googleBtn.getAttribute("aria-busy")) === "true" && (await googleBtn.isDisabled()));
    const connectingToast = await waitForToast(page, /Connecting Google/, 10_000);
    record("accounts: toast says what step is next", connectingToast !== null && /Gmail/.test(connectingToast ?? ""), connectingToast ?? undefined);
    await shot(page, "accounts-connecting", 1280, false);
    // Simulate the person closing the Connect UI (the iframe posts {type:'close'}).
    await page.evaluate("window.dispatchEvent(new MessageEvent('message', { data: { type: 'close' }, origin: 'https://connect.nango.dev' }))");
    const closedToast = await waitForToast(page, /Google not connected/, 10_000);
    const iframeGone = await iframe.waitFor({ state: "detached", timeout: 10_000 }).then(() => true).catch(() => false);
    record("accounts: closing the popup recovers (toast + button re-enabled)", closedToast !== null && iframeGone && !(await googleBtn.isDisabled()), closedToast ?? undefined);
    record("accounts: page scroll restored after Connect UI closed", (await page.evaluate<string>("document.body.style.overflow")) === "");

    // =====================================================================
    // 6. Workspace
    // =====================================================================
    await visit(page, "/settings/workspace", "settings-workspace");
    text = await bodyText(page);
    record("workspace: AI cap card", /spent today of a/.test(text) && /daily cap/.test(text));
    record("workspace: sections present", /Sample ads/.test(text) && /Audit record/.test(text));
    await shot(page, "workspace", 1280);

    const nameInput = page.locator("#ws-name");
    const original = await nameInput.inputValue();
    const saveName = page.getByRole("button", { name: "Save", exact: true });
    record("workspace: Save disabled until the name changes", await saveName.isDisabled());
    await nameInput.fill(`${original} (verify)`);
    await saveName.click();
    const renamed = await waitForToast(page, /Renamed to/);
    record("workspace: rename saves with a toast", renamed !== null, renamed ?? undefined);
    await page.waitForTimeout(800);
    await settled(page);
    record("workspace: sidebar picks up the new name", /\(verify\)/.test((await page.getByRole("button", { name: /^Workspace: / }).getAttribute("aria-label")) ?? ""));
    await nameInput.fill(original);
    await saveName.click();
    await waitForToast(page, /Renamed to/);
    await page.waitForTimeout(600);
    if (admin && profileId) {
      const n = await countEvents(admin, profileId, "profile.renamed", startedAt);
      record("workspace: profile.renamed events logged", (n ?? 0) >= 2, `${n}`);
    }

    // Export audit record.
    await page.getByRole("button", { name: "Export audit record" }).click();
    const exportDialog = page.getByRole("dialog", { name: /^Audit record ·/ });
    await exportDialog.waitFor({ state: "visible", timeout: 10_000 });
    const jsonReady = await exportDialog.getByText(/\d+ decisions? and \d+ events, as JSON/).waitFor({ state: "visible", timeout: 30_000 }).then(() => true).catch(() => false);
    record("workspace: audit export builds the record", jsonReady);
    const pre = await exportDialog.locator("pre").innerText();
    record("workspace: audit JSON has workspace, decisions and events", /"workspace"/.test(pre) && /"decisions"/.test(pre) && /"events"/.test(pre));
    await exportDialog.getByRole("button", { name: "Copy JSON" }).click();
    const copiedJson = await exportDialog.getByRole("button", { name: "Copied" }).waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
    record("workspace: Copy JSON copies", copiedJson);
    await shot(page, "workspace-export", 1280, false);
    await page.keyboard.press("Escape");
    await exportDialog.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);

    // Clear samples (opt-in: hides every sample ad in the workspace).
    if (CLEAR_SAMPLES) {
      await page.reload({ waitUntil: "networkidle" });
      await settled(page);
      const clearBtn = page.getByRole("button", { name: /^Clear samples/ });
      if (await clearBtn.isDisabled()) {
        record("workspace: Clear samples (no samples to clear)", true, "button disabled");
      } else {
        await clearBtn.click();
        const clearDialog = page.getByRole("alertdialog");
        await clearDialog.waitFor({ state: "visible", timeout: 10_000 });
        record("workspace: Clear samples confirm copy", /disappear from the Ads list/.test(await clearDialog.innerText()));
        await clearDialog.getByRole("button", { name: "Clear samples" }).click();
        const cleared = await waitForToast(page, /Cleared \d+ sample|No sample ads to clear/);
        record("workspace: Clear samples toast", cleared !== null, cleared ?? undefined);
        await visit(page, "/ads", "ads after Clear samples");
        record("ads: the [test] sample is gone from the list", !(await bodyText(page)).includes(TEST_AD_TITLE));
      }
    }

    // Phone width for Settings pages.
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [route, label] of [
      ["/settings/members", "members"],
      ["/settings/accounts", "accounts"],
      ["/settings/workspace", "workspace"],
      ["/rules?tab=products", "products"],
    ] as const) {
      await visit(page, route, `${label} (390)`);
      await expectNoHorizontalScroll(page, label);
      await shot(page, label, 390);
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    // =====================================================================
    // Sign out from the bottom menu -> /signin
    // =====================================================================
    await visit(page, "/ads", "ads (before sign out)");
    await page.getByRole("button", { name: /Workspace menu$/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL(/\/signin/, { timeout: 30_000 });
    record("sign out -> /signin", /\/signin/.test(page.url()), page.url());
    await page.goto(`${BASE}/ads`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForURL(/\/signin/, { timeout: 30_000 }).catch(() => undefined);
    record("after sign out /ads is gated", /\/signin/.test(page.url()));
  } finally {
    // Cleanup: retire the test ad, revoke any invitation left behind.
    if (admin) {
      if (testAdId) {
        // Withdrawn when the approval pointers are clear; otherwise rejected (both terminal, both hidden as sample_cleared).
        let { error } = await admin.from("assets").update({ status: "withdrawn", audience: "sample_cleared" }).eq("id", testAdId);
        if (error) ({ error } = await admin.from("assets").update({ status: "rejected", audience: "sample_cleared" }).eq("id", testAdId));
        console.log(error ? `      cleanup: could not retire test ad: ${error.message}` : `      cleanup: retired test ad ${testAdId}`);
      }
      if (inviteUrl && profileId) {
        const { error } = await admin.from("profile_invitations").update({ revoked_at: new Date().toISOString() }).eq("profile_id", profileId).eq("email", INVITEE);
        console.log(error ? `      cleanup: could not revoke invitation: ${error.message}` : "      cleanup: revoked the test invitation");
      }
    }
    await browser.close();
  }

  const ignorable = (m: string) => /favicon|Download the React DevTools|hydrat.*suppress|connect\.nango\.dev|net::ERR_|Failed to load resource/i.test(m);
  const realConsole = consoleErrors.filter((m) => !ignorable(m));
  record("no browser console errors", realConsole.length === 0, realConsole.length ? realConsole.slice(0, 5).join(" | ").slice(0, 600) : undefined);
  record("no uncaught page errors", pageErrors.length === 0, pageErrors.length ? pageErrors.slice(0, 5).join(" | ").slice(0, 600) : undefined);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("verify-shell crashed:", err);
  process.exitCode = 1;
});
