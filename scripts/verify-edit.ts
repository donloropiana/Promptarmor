/**
 * Browser verification of "Edit" on the ad page (Edit copy / Replace file)
 * against a running dev server, with Playwright + Chromium. It creates one
 * throwaway "[test] " sample ad, edits its copy into V2 (and checks What
 * changed, History and the database row), replaces the file with a PNG into
 * V3, checks the disabled states, repeats the sheet at phone width, writes
 * screenshots and retires the ad at the end.
 *
 *   doppler run -p promptarmor -c prd -- env SMOKE_PASSWORD=... \
 *     PLAYWRIGHT_MODULE=$HOME/.bun/install/global/node_modules/playwright \
 *     VERIFY_BASE_URL=http://localhost:3101 \
 *     bun --conditions=react-server scripts/verify-edit.ts [--keep]
 *
 * Env: SMOKE_EMAIL (default promptarmortwo+reviewer@gmail.com), SMOKE_PASSWORD
 * (required, never committed), VERIFY_BASE_URL (default http://localhost:3101),
 * VERIFY_SCREENS (default ./.verify-screens), VERIFY_PROFILE / VERIFY_USER.
 * `--conditions=react-server` makes bun treat "server-only" as a no-op.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";

import { startAnalysisForVersion } from "@/lib/ai/engine";
import { createAd } from "@/lib/intake/ads";
import { getSampleAd } from "@/lib/seed/samples";
import { requireSupabaseAdminClient } from "@/lib/supabase/admin";

import { makePng } from "./stress-ads";

const BASE = (process.env.VERIFY_BASE_URL ?? "http://localhost:3101").replace(/\/$/, "");
const EMAIL = process.env.SMOKE_EMAIL ?? "promptarmortwo+reviewer@gmail.com";
const PASSWORD = process.env.SMOKE_PASSWORD;
const SCREENS = path.resolve(process.env.VERIFY_SCREENS ?? ".verify-screens");
const PROFILE_ID = process.env.VERIFY_PROFILE ?? "cf7d66e9-54d5-4b99-ac6f-89d760a20731";
const USER_ID = process.env.VERIFY_USER ?? "88b5b90e-3f4b-46a2-8c50-333240cbb671";
const KEEP = process.argv.includes("--keep");

const COPY_NOTE = "Fixed the rate and removed the approval claims";
const FILE_NOTE = "New artwork from the agency";

// ---------------------------------------------------------------------------
// Minimal Playwright surface (the module is loaded at runtime, see PLAYWRIGHT_MODULE)
// ---------------------------------------------------------------------------

type Locator = {
  first: () => Locator;
  locator: (selector: string, opts?: { hasText?: string | RegExp }) => Locator;
  getByRole: (role: string, opts?: { name?: string | RegExp; exact?: boolean }) => Locator;
  getByText: (text: string | RegExp, opts?: { exact?: boolean }) => Locator;
  count: () => Promise<number>;
  click: (opts?: { timeout?: number }) => Promise<void>;
  fill: (value: string, opts?: { timeout?: number }) => Promise<void>;
  isDisabled: () => Promise<boolean>;
  isEnabled: () => Promise<boolean>;
  waitFor: (opts?: { state?: "attached" | "detached" | "visible" | "hidden"; timeout?: number }) => Promise<void>;
  innerText: () => Promise<string>;
  inputValue: () => Promise<string>;
  getAttribute: (name: string) => Promise<string | null>;
  setInputFiles: (files: { name: string; mimeType: string; buffer: Buffer }) => Promise<void>;
};

type Page = {
  goto: (url: string, opts?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
  reload: (opts?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
  url: () => string;
  locator: (selector: string, opts?: { hasText?: string | RegExp }) => Locator;
  getByRole: (role: string, opts?: { name?: string | RegExp; exact?: boolean }) => Locator;
  getByText: (text: string | RegExp, opts?: { exact?: boolean }) => Locator;
  waitForURL: (url: string | RegExp, opts?: { timeout?: number }) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  screenshot: (opts: { path: string; fullPage?: boolean }) => Promise<unknown>;
  evaluate: <T>(fn: string) => Promise<T>;
  keyboard: { press: (key: string) => Promise<void> };
  mouse: { move: (x: number, y: number) => Promise<void> };
  on: (event: string, handler: (arg: { text: () => string; type: () => string } & Error) => void) => void;
  setViewportSize: (size: { width: number; height: number }) => Promise<void>;
  viewportSize: () => { width: number; height: number } | null;
};

type Context = { newPage: () => Promise<Page> };
type Browser = {
  newContext: (opts?: { viewport?: { width: number; height: number }; reducedMotion?: string }) => Promise<Context>;
  close: () => Promise<void>;
};

// ---------------------------------------------------------------------------
// Reporting + helpers
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
}

async function bodyText(page: Page): Promise<string> {
  return page.locator("body").innerText().catch(() => "");
}

async function settled(page: Page, timeoutMs = 60_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pending = await page.evaluate<number>("document.querySelectorAll('[data-slot=\"skeleton\"]').length");
    if (pending === 0) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

async function waitForText(page: Page, test: RegExp, timeoutMs = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (test.test(await bodyText(page))) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function visible(loc: Locator, timeout = 5_000): Promise<boolean> {
  return loc
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
}

async function noHorizontalScroll(page: Page, label: string) {
  const { scrollWidth, innerWidth } = await page.evaluate<{ scrollWidth: number; innerWidth: number }>(
    "({ scrollWidth: document.scrollingElement ? document.scrollingElement.scrollWidth : document.body.scrollWidth, innerWidth: window.innerWidth })",
  );
  record(`${label}: no horizontal scroll at ${innerWidth}px`, scrollWidth <= innerWidth + 1, `scrollWidth ${scrollWidth}`);
}

// ---------------------------------------------------------------------------
// Test data (admin client)
// ---------------------------------------------------------------------------

type TestAd = { assetId: string; versionId: string; title: string; text: string };

async function createTestAd(): Promise<TestAd> {
  const sample = getSampleAd("paid-social-personal-loan");
  if (!sample || sample.format !== "text") throw new Error("sample paid-social-personal-loan missing");
  const title = `[test] Edit copy and replace file`;
  const created = await createAd({
    profileId: PROFILE_ID,
    userId: USER_ID,
    origin: "paste",
    title,
    text: sample.text,
    product: sample.product,
    channel: sample.channel,
    isSample: true,
    sampleKey: sample.key,
  });
  console.log(`      created ${title} -> ${created.assetId}`);
  return { assetId: created.assetId, versionId: created.versionId, title, text: sample.text };
}

/** Runs the queued check for a version and waits for it to finish; returns the final status. */
async function runCheck(versionId: string): Promise<string> {
  const admin = requireSupabaseAdminClient();
  await startAnalysisForVersion(versionId).catch((err: Error) => console.log(`      (start check: ${err.message})`));
  const start = Date.now();
  while (Date.now() - start < 120_000) {
    const { data } = await admin.from("analysis_runs").select("status").eq("asset_version_id", versionId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (data && data.status !== "queued" && data.status !== "running") return data.status;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return "timeout";
}

async function latestVersion(assetId: string) {
  const admin = requireSupabaseAdminClient();
  const { data: asset } = await admin.from("assets").select("latest_version_id").eq("id", assetId).single();
  if (!asset?.latest_version_id) return null;
  const { data } = await admin.from("asset_versions").select("id, version_no, origin, author_id, content, extracted_text, storage_path").eq("id", asset.latest_version_id).single();
  return data;
}

async function versionAddedEvent(assetId: string, versionId: string) {
  const admin = requireSupabaseAdminClient();
  const { data } = await admin.from("events").select("id, kind, actor_id, data").eq("asset_id", assetId).eq("kind", "version.added").order("created_at", { ascending: false }).limit(5);
  return (data ?? []).find((e) => (e.data as { asset_version_id?: string })?.asset_version_id === versionId) ?? null;
}

async function retireTestAd(ad: TestAd) {
  const admin = requireSupabaseAdminClient();
  const { error } = await admin.from("assets").update({ status: "withdrawn", audience: "sample_cleared" }).eq("id", ad.assetId);
  if (error) console.error(`      could not retire ${ad.title}: ${error.code} ${error.message}`);
  else console.log(`      retired ${ad.title}`);
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

async function editCopyFlow(page: Page, ad: TestAd) {
  await page.goto(`${BASE}/ads/${ad.assetId}`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  const editButton = page.locator("[data-edit-version]");
  record("edit: Edit button in the creative header", await visible(editButton));
  record("edit: Edit button enabled once the check is done", await editButton.isEnabled());

  // ? lists E.
  await page.mouse.move(5, 5);
  await page.keyboard.press("?");
  const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  if (await visible(shortcuts)) {
    const text = await shortcuts.innerText();
    record("edit: shortcuts dialog lists E", /E\s*Edit copy or replace the file/.test(text.replace(/\n/g, " ")));
    await page.keyboard.press("Escape");
    await shortcuts.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
  } else record("edit: shortcuts dialog lists E", false, "dialog did not open");

  // E opens the sheet on Edit copy with the current text.
  await page.mouse.move(5, 5);
  await page.keyboard.press("e");
  const sheet = page.getByRole("dialog", { name: /Edit V1/ });
  record("edit: E opens the Edit sheet for V1", await visible(sheet));
  const copyTab = sheet.getByRole("tab", { name: "Edit copy" });
  record("edit: Edit copy tab is active for a text ad", (await copyTab.getAttribute("data-state")) === "active" || (await copyTab.getAttribute("aria-selected")) === "true");
  const textarea = sheet.locator("#edit-copy-text");
  const prefilled = await textarea.inputValue();
  record("edit: textarea prefilled with the current text", prefilled.trim() === ad.text.trim(), `${prefilled.length} chars`);
  const save = sheet.getByRole("button", { name: /Save as V2/ });
  record("edit: Save disabled until the text changes and a note is written", await save.isDisabled());

  const edited = ad.text.replace("5.99% APR", "8.99% APR").replace("Guaranteed approval. No credit check. ", "");
  await textarea.fill(edited);
  record("edit: Save still disabled without a note", await save.isDisabled());
  await sheet.locator("#edit-version-note").fill(COPY_NOTE);
  record("edit: Save enabled with changed text and a note", await save.isEnabled());
  await shot(page, "edit-copy-sheet");
  await save.click();
  record("edit: toast confirms V2", await waitForText(page, /Created V2\. Checking it now\./, 20_000));
  record("edit: sheet closed after saving", await sheet.waitFor({ state: "hidden", timeout: 10_000 }).then(() => true).catch(() => false));
  const v2Shown = await waitForText(page, /V2 ·/, 30_000);
  record("edit: page shows V2", v2Shown);
  // While the check runs, Edit is disabled.
  const checking = /Checking V2…/.test(await bodyText(page));
  if (checking) record("edit: Edit disabled while the check is running", await editButton.isDisabled());
  else console.log("      (check already finished; disabled-while-checking not observable)");

  // Database: origin reviewer_edit, author = the signed-in user, note in meta, version.added event.
  const v2 = await latestVersion(ad.assetId);
  record("edit: V2 row exists", Boolean(v2 && v2.version_no === 2), v2 ? `V${v2.version_no} ${v2.origin}` : "none");
  if (v2) {
    record("edit: V2 origin reviewer_edit with author = signed-in user", v2.origin === "reviewer_edit" && v2.author_id === USER_ID);
    const meta = ((v2.content as { meta?: { note?: string } })?.meta ?? {}) as { note?: string };
    record("edit: V2 carries the note in content.meta", meta.note === COPY_NOTE);
    record("edit: V2 text has the new rate and no approval claims", /8\.99% APR/.test(v2.extracted_text ?? "") && !/Guaranteed approval/.test(v2.extracted_text ?? ""));
    const ev = await versionAddedEvent(ad.assetId, v2.id);
    record("edit: version.added event recorded with actor + note", Boolean(ev && ev.actor_id === USER_ID && (ev.data as { note?: string }).note === COPY_NOTE && (ev.data as { how?: string }).how === "edit_copy"));

    const status = await runCheck(v2.id);
    record("edit: V2 check finished", status === "complete" || status === "failed" || status === "declined_budget", status);
  }
  await page.reload({ waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  const text = await bodyText(page);
  record("edit: What changed since V1 appears", /What changed since V1/.test(text));
  record("edit: the 5.99% rate issue counted as fixed", /[1-9]\d* fixed/.test(text), text.match(/\d+ fixed\s*·\s*\d+ still there\s*·\s*\d+ new/)?.[0]);
  record("edit: History shows the note as “V2 by You: …”", new RegExp(`V2 by You: ${COPY_NOTE}`).test(text));
  record("edit: History does not also show the bare “V2 edited by a reviewer” line", !/V2 edited by a reviewer/.test(text));
  await shot(page, "edit-copy-v2");
  await page.getByRole("tab", { name: "What changed" }).click();
  record("edit: word diff tab shows V1 → V2", await waitForText(page, /V1 → V2/, 5_000));
  await shot(page, "edit-copy-diff");
  await page.getByRole("tab", { name: "V2" }).click();
}

async function replaceFileFlow(page: Page, ad: TestAd) {
  const editButton = page.locator("[data-edit-version]");
  await editButton.click();
  const sheet = page.getByRole("dialog", { name: /Edit V2/ });
  record("replace: Edit button opens the sheet for V2", await visible(sheet));
  await sheet.getByRole("tab", { name: "Replace file" }).click();
  const save = sheet.getByRole("button", { name: /Save as V3/ });
  record("replace: Save disabled with no file and no note", await save.isDisabled());
  const png = makePng(600, 400);
  await sheet.locator("[data-edit-file-input]").setInputFiles({ name: "banner-600x400.png", mimeType: "image/png", buffer: Buffer.from(png) });
  record("replace: chosen file is named in the drop zone", await visible(sheet.locator("[data-edit-file]")) && /banner-600x400\.png/.test(await sheet.locator("[data-edit-file]").innerText()));
  await sheet.locator("#edit-version-note").fill(FILE_NOTE);
  record("replace: Save enabled with a file and a note", await save.isEnabled());
  await shot(page, "replace-file-sheet");
  await save.click();
  record("replace: toast confirms V3", await waitForText(page, /Created V3\. Checking it now\./, 30_000));
  record("replace: page shows V3", await waitForText(page, /V3 ·/, 30_000));

  const v3 = await latestVersion(ad.assetId);
  record("replace: V3 row exists", Boolean(v3 && v3.version_no === 3), v3 ? `V${v3.version_no} ${v3.origin}` : "none");
  if (v3) {
    const content = v3.content as { format?: string; filename?: string; meta?: { note?: string } };
    record("replace: V3 is an image version with the file stored", content.format === "image" && content.filename === "banner-600x400.png" && Boolean(v3.storage_path));
    record("replace: V3 origin reviewer_edit with author = signed-in user", v3.origin === "reviewer_edit" && v3.author_id === USER_ID);
    const ev = await versionAddedEvent(ad.assetId, v3.id);
    record("replace: version.added event recorded (replace_file + filename)", Boolean(ev && (ev.data as { how?: string }).how === "replace_file" && (ev.data as { filename?: string }).filename === "banner-600x400.png"));
    const status = await runCheck(v3.id);
    record("replace: V3 check ran (AI off: deterministic only)", status === "complete" || status === "failed" || status === "declined_budget", status);
  }
  await page.reload({ waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  const text = await bodyText(page);
  record("replace: creative header names the image file", /banner-600x400\.png/.test(text));
  record("replace: History shows “V3 by You: …” with the filename", new RegExp(`V3 by You: ${FILE_NOTE}`).test(text) && /Replaced the file with banner-600x400\.png/.test(text));
  await shot(page, "replace-file-v3");

  // On an image with no text, Edit opens on Replace file and Edit copy is disabled.
  await page.mouse.move(5, 5);
  await page.keyboard.press("e");
  const sheet3 = page.getByRole("dialog", { name: /Edit V3/ });
  record("replace: E opens the sheet on V3", await visible(sheet3));
  const copyTab = sheet3.getByRole("tab", { name: "Edit copy" });
  record("replace: Edit copy tab disabled when the version has no text", await copyTab.isDisabled());
  const fileTab = sheet3.getByRole("tab", { name: "Replace file" });
  record("replace: Replace file tab active instead", (await fileTab.getAttribute("data-state")) === "active" || (await fileTab.getAttribute("aria-selected")) === "true");
  // Pasted text too short keeps Save disabled; a sentence enables it (not saved).
  await sheet3.locator("#edit-paste-text").fill("too short");
  await sheet3.locator("#edit-version-note").fill("x");
  record("replace: pasted text under a sentence keeps Save disabled", await sheet3.getByRole("button", { name: /Save as V4/ }).isDisabled());
  await sheet3.locator("#edit-paste-text").fill("Rates from 8.99% APR. Borrow $2,000 to $40,000. See full terms before applying.");
  record("replace: pasted sentence enables Save", await sheet3.getByRole("button", { name: /Save as V4/ }).isEnabled());
  await page.keyboard.press("Escape");
  record("replace: Escape closes the sheet without saving", await sheet3.waitFor({ state: "hidden", timeout: 5_000 }).then(() => true).catch(() => false));
  const still = await latestVersion(ad.assetId);
  record("replace: nothing saved on cancel (still V3)", still?.version_no === 3);
}

async function phoneFlow(page: Page, ad: TestAd) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/ads/${ad.assetId}`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  await noHorizontalScroll(page, "phone: ad page");
  await page.locator("[data-edit-version]").click();
  const sheet = page.getByRole("dialog", { name: /Edit V3/ });
  record("phone: Edit opens the sheet", await visible(sheet));
  await shot(page, "edit-sheet-phone");
  await noHorizontalScroll(page, "phone: sheet open");
  await page.keyboard.press("Escape");
}

// ---------------------------------------------------------------------------

async function main() {
  if (!PASSWORD) throw new Error("Set SMOKE_PASSWORD (never commit it).");
  mkdirSync(SCREENS, { recursive: true });

  console.log("setup: creating the [test] ad and checking V1");
  const ad = await createTestAd();
  const v1 = await runCheck(ad.versionId);
  console.log(`      V1 check: ${v1}`);

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
    await editCopyFlow(page, ad);
    await replaceFileFlow(page, ad);
    await phoneFlow(page, ad);
  } catch (err) {
    record("flow crashed", false, (err as Error).message);
    await shot(page, "edit-crash").catch(() => undefined);
  } finally {
    await browser.close();
    if (KEEP) console.log("--keep: leaving the [test] ad in place");
    else await retireTestAd(ad);
  }

  const ignorable = (m: string) => /favicon|Download the React DevTools|hydrat.*suppress/i.test(m) || /Content Security Policy|sandboxed|about:srcdoc/i.test(m);
  const realConsole = consoleErrors.filter((m) => !ignorable(m));
  record("no browser console errors", realConsole.length === 0, realConsole.length ? realConsole.slice(0, 5).join(" | ").slice(0, 600) : undefined);
  record("no uncaught page errors", pageErrors.length === 0, pageErrors.length ? pageErrors.slice(0, 5).join(" | ").slice(0, 600) : undefined);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("verify-edit crashed:", err);
  process.exitCode = 1;
});
