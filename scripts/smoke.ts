/**
 * Browser smoke test (Playwright + Chromium) against a running dev server.
 *
 * Signs in with the password tab, creates an ad (first sample chip when the
 * workspace is empty, otherwise New ad > Paste), waits for the check to settle,
 * opens every top-level page, checks for error boundaries, console errors and
 * horizontal overflow at phone width, and writes screenshots.
 *
 *   SMOKE_PASSWORD=... bun scripts/smoke.ts
 *
 * Env: SMOKE_EMAIL (default promptarmortwo+reviewer@gmail.com), SMOKE_PASSWORD
 * (required, never committed), SMOKE_BASE_URL (default http://localhost:3100),
 * SMOKE_SCREENS (screenshot directory, default ./.smoke-screens), and
 * PLAYWRIGHT_MODULE when playwright is not resolvable from this repo (for
 * example a bun global install: NODE_PATH=~/.bun/install/global/node_modules).
 */

import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = (process.env.SMOKE_BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const EMAIL = process.env.SMOKE_EMAIL ?? "promptarmortwo+reviewer@gmail.com";
const PASSWORD = process.env.SMOKE_PASSWORD;
const SCREENS = path.resolve(process.env.SMOKE_SCREENS ?? ".smoke-screens");
const CHECK_TIMEOUT_MS = 120_000;

const ERROR_BOUNDARY_TEXT = [
  "Application error",
  "Unhandled Runtime Error",
  "Something went wrong",
  "This page could not be loaded",
  "Internal Server Error",
];

type Page = {
  goto: (url: string, opts?: { waitUntil?: string; timeout?: number }) => Promise<{ status: () => number } | null>;
  url: () => string;
  title: () => Promise<string>;
  locator: (selector: string, opts?: { hasText?: string | RegExp }) => Locator;
  getByRole: (role: string, opts?: { name?: string | RegExp; exact?: boolean }) => Locator;
  getByText: (text: string | RegExp, opts?: { exact?: boolean }) => Locator;
  getByLabel: (text: string | RegExp, opts?: { exact?: boolean }) => Locator;
  waitForURL: (url: string | RegExp, opts?: { timeout?: number }) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  waitForLoadState: (state?: string, opts?: { timeout?: number }) => Promise<void>;
  screenshot: (opts: { path: string; fullPage?: boolean }) => Promise<unknown>;
  evaluate: <T>(fn: string | (() => T)) => Promise<T>;
  content: () => Promise<string>;
  on: (event: string, handler: (arg: { text: () => string; type: () => string } & Error) => void) => void;
  setViewportSize: (size: { width: number; height: number }) => Promise<void>;
  close: () => Promise<void>;
};

type Locator = {
  first: () => Locator;
  locator: (selector: string) => Locator;
  count: () => Promise<number>;
  click: (opts?: { timeout?: number }) => Promise<void>;
  fill: (value: string, opts?: { timeout?: number }) => Promise<void>;
  isVisible: () => Promise<boolean>;
  waitFor: (opts?: { state?: string; timeout?: number }) => Promise<void>;
  textContent: () => Promise<string | null>;
  innerText: () => Promise<string>;
};

const results: { label: string; ok: boolean; detail?: string }[] = [];
function record(label: string, ok: boolean, detail?: string) {
  results.push({ label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` · ${detail}` : ""}`);
}

// The first line becomes the ad's title: the "[test] " prefix lets the lead purge
// smoke-test ads from a shared workspace (scripts/cleanup-workspace.ts).
const SAMPLE_TEXT = `[test] Crush your credit card debt with a ClearPath Personal Loan.
Rates from 5.99% APR. Guaranteed approval, no credit check.
Borrow up to $50,000 and pay as little as $199/mo.
Apply in two minutes at clearpath.example/apply.`;

async function expectNoErrorBoundary(page: Page, label: string) {
  const body = await page.locator("body").innerText().catch(() => "");
  const hit = ERROR_BOUNDARY_TEXT.find((t) => body.includes(t));
  record(`${label}: no error boundary`, !hit, hit ? `found "${hit}"` : undefined);
}

async function expectNoHorizontalScroll(page: Page, label: string) {
  const { scrollWidth, innerWidth } = await page.evaluate<{ scrollWidth: number; innerWidth: number }>(
    "({ scrollWidth: document.scrollingElement ? document.scrollingElement.scrollWidth : document.body.scrollWidth, innerWidth: window.innerWidth })",
  );
  record(`${label}: no horizontal scroll at ${innerWidth}px`, scrollWidth <= innerWidth + 1, `scrollWidth ${scrollWidth}`);
}

/** Streams finish after "load": wait until no loading skeleton is left on the page. */
async function settled(page: Page, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pending = await page.evaluate<number>('document.querySelectorAll(\'[data-slot="skeleton"]\').length');
    if (pending === 0) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

async function visit(page: Page, route: string, label: string) {
  const res = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 60_000 });
  const status = res?.status() ?? 0;
  record(`${label}: HTTP ${status}`, status === 200);
  const done = await settled(page);
  record(`${label}: content streamed in`, done, done ? undefined : "a loading skeleton is still showing after 60 s");
  await expectNoErrorBoundary(page, label);
  return status;
}

async function shot(page: Page, name: string, width: number) {
  await settled(page);
  await page.waitForTimeout(300);
  const file = path.join(SCREENS, `${name}-${width}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`      screenshot ${file}`);
  return file;
}

async function main() {
  if (!PASSWORD) throw new Error("Set SMOKE_PASSWORD (never commit it).");
  mkdirSync(SCREENS, { recursive: true });

  const pw = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
  const browser = await pw.chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const page: Page = await context.newPage();

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  try {
    // Signed-out: / and /ads land on /signin.
    await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForURL(/\/signin/, { timeout: 30_000 });
    record("/ signed out -> /signin", page.url().includes("/signin"), page.url());
    await page.goto(`${BASE}/ads`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForURL(/\/signin/, { timeout: 30_000 });
    record("/ads signed out -> /signin", page.url().includes("/signin"), page.url());

    const signinText = await page.locator("body").innerText();
    record("/signin has no Google button", !/google/i.test(signinText));
    await shot(page, "signin", 1280);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/signin`, { waitUntil: "networkidle", timeout: 60_000 });
    await expectNoHorizontalScroll(page, "signin");
    await shot(page, "signin", 390);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE}/signin`, { waitUntil: "networkidle", timeout: 60_000 });

    // Sign in with the password tab.
    await page.getByRole("tab", { name: "Password" }).click();
    await page.locator("#pw-email").fill(EMAIL);
    await page.locator("#pw-password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/ads(\?|$)/, { timeout: 60_000 });
    record("password sign-in -> /ads", /\/ads/.test(page.url()), page.url());
    await page.waitForLoadState("networkidle", { timeout: 60_000 });
    await expectNoErrorBoundary(page, "/ads");
    await shot(page, "ads", 1280);

    // Create an ad: first sample chip in an empty workspace, else New ad > Paste.
    const chip = page.getByRole("button", { name: /Paid social post: personal loan/ }).first();
    if (await chip.isVisible()) {
      await chip.click();
      console.log("      clicked the first sample chip");
    } else {
      await page.getByRole("button", { name: "New ad" }).click();
      await page.getByRole("tab", { name: "Paste text" }).click();
      await page.getByRole("dialog").locator("textarea").fill(SAMPLE_TEXT);
      await page.getByRole("button", { name: "Check this ad" }).click();
      console.log("      pasted an ad through New ad");
    }
    // The product refuses some submissions in the dialog (hourly ad limit,
    // unreadable text); say which rather than timing out in silence.
    const refusal = page
      .getByRole("dialog")
      .locator("[role=alert]")
      .first()
      .waitFor({ state: "visible", timeout: 90_000 })
      .then(async () => (await page.getByRole("dialog").locator("[role=alert]").first().innerText()).trim())
      .catch(() => null);
    const navigated = page
      .waitForURL(/\/ads\/[0-9a-f-]{36}/, { timeout: 90_000 })
      .then(() => "navigated" as const)
      .catch(() => null);
    const first = await Promise.race([refusal, navigated]);
    if (first !== "navigated") {
      const message = typeof first === "string" ? first : (await refusal) ?? "no ad page and no message within 90 s";
      throw new Error(`New ad did not open an ad page: ${message}`);
    }
    const adUrl = page.url();
    record("new ad -> ad page", /\/ads\/[0-9a-f-]{36}/.test(adUrl), adUrl);

    // Checking state, then within 120 s either issues or the manual-review state.
    const checking = page.getByText(/Checking V\d+…/).first();
    const sawChecking = await checking
      .waitFor({ state: "visible", timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    record("ad page shows Checking…", sawChecking, sawChecking ? undefined : "settled before the first paint or never showed");

    const start = Date.now();
    let outcome: "issues" | "not_screened" | "none" = "none";
    while (Date.now() - start < CHECK_TIMEOUT_MS) {
      const text = await page.locator("body").innerText();
      if (text.includes("Not AI-screened")) {
        outcome = "not_screened";
        break;
      }
      if (/\b(Critical|Major|Minor)\b/.test(text) && !/Checking V\d+…/.test(text)) {
        outcome = "issues";
        break;
      }
      await page.waitForTimeout(3_000);
    }
    const settledText = await page.locator("body").innerText();
    record(
      "check settled within 120 s",
      outcome !== "none",
      outcome === "issues" ? "issues listed" : outcome === "not_screened" ? "Not AI-screened (manual review)" : "still checking",
    );
    if (outcome === "not_screened") {
      record("Not AI-screened state names the status", /Needs review|Not AI-screened/.test(settledText));
    }
    await expectNoErrorBoundary(page, "ad page");
    await shot(page, "ad-page", 1280);

    // Other pages.
    for (const [route, label] of [
      ["/rules", "rules"],
      ["/rules?tab=products", "rules-products"],
      ["/settings/members", "settings-members"],
      ["/settings/accounts", "settings-accounts"],
      ["/settings/workspace", "settings-workspace"],
    ] as const) {
      await visit(page, route, label);
      if (label === "rules" || label === "settings-accounts") await shot(page, label, 1280);
    }

    // Phone width: same pages, no horizontal scroll.
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [route, label] of [
      ["/ads", "ads"],
      [adUrl.replace(BASE, ""), "ad-page"],
      ["/rules", "rules"],
      ["/settings/accounts", "settings-accounts"],
    ] as const) {
      await visit(page, route, `${label} (390)`);
      await expectNoHorizontalScroll(page, label);
      await shot(page, label, 390);
    }

    // Signed in, /signin hands back to the app.
    await page.goto(`${BASE}/signin`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForURL(/\/ads(\?|$)/, { timeout: 30_000 }).catch(() => undefined);
    record("/signin while signed in -> /ads", /\/ads(\?|$)/.test(page.url()), page.url());
  } finally {
    await browser.close();
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
  console.error("smoke test crashed:", err);
  process.exitCode = 1;
});
