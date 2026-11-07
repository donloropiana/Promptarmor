/**
 * Browser verification of image notes (reviewer pins on an image ad) against
 * a running dev server, Playwright + Chromium. It creates a "[test] " image
 * ad from a PNG made in-process (no canvas: a light banner with a dark header
 * band and a footer band), pins two notes, reloads, checks the pins and cards
 * persist and select each other at 1280 and 390px, checks the finding rows in
 * the database, the Request changes note, a V2 upload (the pin is never paired
 * with new findings), and that a text ad still has no pin layer. The ads it
 * created are retired at the end (status 'withdrawn', audience 'sample_cleared').
 *
 *   doppler run -p promptarmor -c prd -- env SMOKE_PASSWORD=... \
 *     PLAYWRIGHT_MODULE=$HOME/.bun/install/global/node_modules/playwright \
 *     VERIFY_BASE_URL=http://localhost:3102 \
 *     bun --conditions=react-server scripts/verify-image-notes.ts [--keep]
 *
 * Env: as scripts/verify-ads.ts (SMOKE_EMAIL, SMOKE_PASSWORD, VERIFY_BASE_URL,
 * VERIFY_SCREENS, VERIFY_PROFILE, VERIFY_USER, PLAYWRIGHT_MODULE).
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { startAnalysisForVersion } from "@/lib/ai/engine";
import { addVersion, createAd } from "@/lib/intake/ads";
import { getSampleAd } from "@/lib/seed/samples";
import { requireSupabaseAdminClient } from "@/lib/supabase/admin";

const BASE = (process.env.VERIFY_BASE_URL ?? "http://localhost:3102").replace(/\/$/, "");
const EMAIL = process.env.SMOKE_EMAIL ?? "promptarmortwo+reviewer@gmail.com";
const PASSWORD = process.env.SMOKE_PASSWORD;
const SCREENS = path.resolve(process.env.VERIFY_SCREENS ?? ".verify-screens");
const PROFILE_ID = process.env.VERIFY_PROFILE ?? "cf7d66e9-54d5-4b99-ac6f-89d760a20731";
const USER_ID = process.env.VERIFY_USER ?? "88b5b90e-3f4b-46a2-8c50-333240cbb671";
const KEEP = process.argv.includes("--keep");

const LABEL_1 = "APR in the footer";
const WHY_1 = "The footer shows a rate with no APR next to it; PL-1 terms require the APR wherever a rate appears.";
const LABEL_2 = "Headline claim";
const WHY_2 = "The headline promises guaranteed approval, which the product terms do not allow in any channel.";

// ---------------------------------------------------------------------------
// Minimal Playwright surface (loaded at runtime, see PLAYWRIGHT_MODULE)
// ---------------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };
type Locator = {
  first: () => Locator;
  nth: (i: number) => Locator;
  locator: (selector: string, opts?: { hasText?: string | RegExp }) => Locator;
  getByRole: (role: string, opts?: { name?: string | RegExp; exact?: boolean }) => Locator;
  count: () => Promise<number>;
  click: (opts?: { timeout?: number; force?: boolean; position?: { x: number; y: number } }) => Promise<void>;
  fill: (value: string, opts?: { timeout?: number }) => Promise<void>;
  isDisabled: () => Promise<boolean>;
  isEnabled: () => Promise<boolean>;
  waitFor: (opts?: { state?: "attached" | "detached" | "visible" | "hidden"; timeout?: number }) => Promise<void>;
  innerText: () => Promise<string>;
  inputValue: () => Promise<string>;
  getAttribute: (name: string) => Promise<string | null>;
  boundingBox: () => Promise<Box | null>;
  scrollIntoViewIfNeeded: () => Promise<void>;
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
  mouse: { move: (x: number, y: number) => Promise<void>; click: (x: number, y: number) => Promise<void> };
  on: (event: string, handler: (arg: { text: () => string; type: () => string } & Error) => void) => void;
  setViewportSize: (size: { width: number; height: number }) => Promise<void>;
  viewportSize: () => { width: number; height: number } | null;
};
type Browser = { newContext: (opts?: { viewport?: { width: number; height: number }; reducedMotion?: "reduce" }) => Promise<{ newPage: () => Promise<Page> }>; close: () => Promise<void> };

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

async function visible(loc: Locator, timeout = 10_000): Promise<boolean> {
  return loc.waitFor({ state: "visible", timeout }).then(() => true).catch(() => false);
}

// ---------------------------------------------------------------------------
// A banner PNG without a canvas: greyscale rows, dark header band, footer band.
// ---------------------------------------------------------------------------

function makeBannerPng(width: number, height: number): Uint8Array {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (bytes: Uint8Array) => {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width);
  iv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width + 1);
    raw[row] = 0; // filter: none
    const band = y < height * 0.22 ? 0x2a : y > height * 0.82 ? 0x8c : 0xf2;
    raw.fill(band, row + 1, row + 1 + width);
    // "Text" blocks: a few dark rectangles in the header and the footer.
    if (y > height * 0.06 && y < height * 0.16) for (let x = Math.round(width * 0.06); x < width * 0.55; x++) if (((x >> 3) & 1) === 0) raw[row + 1 + x] = 0xfa;
    if (y > height * 0.87 && y < height * 0.93) for (let x = Math.round(width * 0.06); x < width * 0.7; x++) if (((x >> 2) & 1) === 0) raw[row + 1 + x] = 0x22;
  }
  const idat = new Uint8Array(deflateSync(raw));
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}

// ---------------------------------------------------------------------------
// Test data (admin client)
// ---------------------------------------------------------------------------

type TestAd = { assetId: string; versionId: string; title: string };

async function createImageAd(): Promise<TestAd> {
  const title = "[test] Image notes banner";
  const created = await createAd({
    profileId: PROFILE_ID,
    userId: USER_ID,
    origin: "upload",
    title,
    file: { name: "spring-loan-banner.png", bytes: makeBannerPng(1200, 628), mimeType: "image/png" },
    product: "personal_loan",
    channel: "display",
    isSample: true,
  });
  console.log(`      created ${title} -> ${created.assetId}`);
  return { assetId: created.assetId, versionId: created.versionId, title };
}

async function createTextAd(): Promise<TestAd> {
  const sample = getSampleAd("credit-card-sms");
  if (!sample) throw new Error("sample credit-card-sms missing");
  const title = `[test] ${sample.title}`;
  const created = await createAd({ profileId: PROFILE_ID, userId: USER_ID, origin: "paste", title, text: sample.text, product: sample.product, channel: sample.channel, isSample: true, sampleKey: sample.key });
  console.log(`      created ${title} -> ${created.assetId}`);
  return { assetId: created.assetId, versionId: created.versionId, title };
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

async function retireTestAds(ads: TestAd[]) {
  const admin = requireSupabaseAdminClient();
  for (const ad of ads) {
    const { error } = await admin.from("assets").update({ status: "withdrawn", audience: "sample_cleared" }).eq("id", ad.assetId);
    if (error) console.error(`      could not retire ${ad.title}: ${error.code} ${error.message}`);
    else console.log(`      retired ${ad.title}`);
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

async function openAd(page: Page, ad: TestAd) {
  await page.goto(`${BASE}/ads/${ad.assetId}`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  await page.waitForTimeout(400);
}

const IMG = "[data-image-stage] img";
const PINS = "[data-image-pin]";

/** Clicks a spot on the image given as fractions, like a reviewer would. */
async function clickImageAt(page: Page, fx: number, fy: number): Promise<Box | null> {
  const img = page.locator(IMG);
  await img.scrollIntoViewIfNeeded();
  const box = await img.boundingBox();
  if (!box) return null;
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  return box;
}

/** Where a pin's centre sits, as fractions of the image box. */
async function pinFraction(page: Page, pin: Locator): Promise<{ x: number; y: number } | null> {
  const [img, p] = await Promise.all([page.locator(IMG).boundingBox(), pin.boundingBox()]);
  if (!img || !p) return null;
  return { x: (p.x + p.width / 2 - img.x) / img.width, y: (p.y + p.height / 2 - img.y) / img.height };
}

async function pinNote(page: Page, label: string, why: string, severity: "Critical" | "Major" | "Minor", fx: number, fy: number, tag: string) {
  const box = await clickImageAt(page, fx, fy);
  record(`${tag}: image is on the page`, Boolean(box), box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "no image");
  const dialog = page.getByRole("dialog", { name: "Add a note on the image" });
  record(`${tag}: clicking the image opens the note dialog`, await visible(dialog, 5_000));
  record(`${tag}: a draft pin marks the spot while writing`, (await page.locator("[data-image-pin-draft]").count()) === 1);
  const submit = dialog.getByRole("button", { name: "Pin note", exact: true });
  record(`${tag}: submit disabled until a label and a reason`, await submit.isDisabled());
  await dialog.locator("#add-issue-label").fill(label);
  if (severity !== "Major") {
    await dialog.locator("#add-issue-severity").click();
    await page.getByRole("option", { name: severity }).click();
  }
  await dialog.locator("#add-issue-why").fill(why);
  record(`${tag}: submit enabled once valid`, await submit.isEnabled());
  if (tag === "pin 1") await shot(page, "image-note-dialog");
  await submit.click();
  record(`${tag}: toast Note pinned`, await waitForText(page, /Note pinned/, 20_000));
  await dialog.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
}

async function pinFlow(page: Page, ad: TestAd) {
  await openAd(page, ad);
  record("image ad: Preview shows the image", await visible(page.locator(IMG)));
  record("image ad: hint says to click a spot to pin a note", /Click a spot on the image to pin a note/.test(await bodyText(page)));
  record("image ad: no pins yet", (await page.locator(PINS).count()) === 0);

  // Pin 1: Major, in the footer band.
  await pinNote(page, LABEL_1, WHY_1, "Major", 0.5, 0.88, "pin 1");
  const pin1 = page.locator(PINS).first();
  record("pin 1: one pin drawn over the image, numbered 1", (await visible(pin1, 20_000)) && (await page.locator(PINS).count()) === 1 && (await pin1.innerText()).trim() === "1");
  const where = await pinFraction(page, pin1);
  record("pin 1: pin sits where the click landed", Boolean(where && Math.abs(where.x - 0.5) < 0.02 && Math.abs(where.y - 0.88) < 0.02), where ? `x ${where.x.toFixed(3)} y ${where.y.toFixed(3)}` : "no pin");
  record("pin 1: new pin is selected", (await pin1.getAttribute("data-selected")) === "true");
  const card1 = page.locator("section[aria-label='Issues'] [data-finding-id]", { hasText: LABEL_1 });
  record("pin 1: card shows Pinned on the image with the label", (await visible(card1, 20_000)) && /Pinned on the image:\s*APR in the footer/.test(await card1.first().innerText()) && (await card1.first().locator("[data-pinned-note]").count()) === 1);
  record("pin 1: card is selected and carries the Added by you chip", (await card1.first().locator("button[aria-pressed='true']").count()) === 1 && /Added by you/.test(await card1.first().innerText()));
  record("pin 1: no text mark drawn for the label", (await page.locator("mark[data-finding-id]").count()) === 0);
  record("pin 1: the Preview stays active (no switch to Text)", (await page.getByRole("tab", { name: "Preview" }).getAttribute("aria-selected")) === "true");
  record("pin 1: history records the note", /Note pinned on the image/.test(await bodyText(page)));
  await shot(page, "image-note-pinned");

  // Pin 2: Critical, in the header.
  await pinNote(page, LABEL_2, WHY_2, "Critical", 0.2, 0.1, "pin 2");
  const pinCount = async () => page.locator(PINS).count();
  const start = Date.now();
  while ((await pinCount()) < 2 && Date.now() - start < 20_000) await page.waitForTimeout(300);
  record("pin 2: two pins drawn", (await pinCount()) === 2);
  // Pins are numbered in panel order (Critical first), so the header pin is 1 and the footer pin is 2.
  const pins = page.locator(PINS);
  const numbers = [(await pins.nth(0).innerText()).trim(), (await pins.nth(1).innerText()).trim()].sort();
  record("pin 2: pins numbered 1 and 2", numbers.join(",") === "1,2", numbers.join(","));
  const critical = page.locator(`${PINS}[aria-label*="critical"]`);
  record("pin 2: the critical pin is coloured as critical", (await critical.count()) === 1 && /bg-destructive/.test((await critical.first().getAttribute("class")) ?? ""));
  record("pin 2: the critical pin is number 1 (panel order)", (await critical.first().innerText()).trim() === "1");
  const countLine = (await bodyText(page)).match(/Issues on V1\s*(\d+) open/);
  record("pin 2: open count is 2", Number(countLine?.[1] ?? 0) === 2, `${countLine?.[1] ?? "?"} open`);
  await shot(page, "image-notes-two");
}

async function persistenceFlow(page: Page) {
  await page.reload({ waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  await page.waitForTimeout(400);
  record("reload: both pins persist", (await page.locator(PINS).count()) === 2);
  record("reload: both cards persist", (await page.locator("section[aria-label='Issues'] [data-pinned-note]").count()) === 2);
  record("reload: nothing selected", (await page.locator(`${PINS}[data-selected]`).count()) === 0);

  // Click the footer pin -> its card is selected.
  const footerPin = page.locator(`${PINS}[aria-label*="${LABEL_1}"]`).first();
  await footerPin.click();
  await page.waitForTimeout(300);
  const footerId = await footerPin.getAttribute("data-finding-id");
  const footerCard = page.locator(`section[aria-label='Issues'] [data-finding-id="${footerId}"]`);
  record("reload: clicking a pin selects its card", (await footerCard.locator("button[aria-pressed='true']").count()) === 1 && (await footerPin.getAttribute("data-selected")) === "true");

  // Click the header card -> its pin is selected and the footer pin is not.
  const headerPin = page.locator(`${PINS}[aria-label*="${LABEL_2}"]`).first();
  const headerId = await headerPin.getAttribute("data-finding-id");
  await page.locator(`section[aria-label='Issues'] [data-finding-id="${headerId}"] button`).first().click();
  await page.waitForTimeout(300);
  record("reload: clicking a card selects its pin (and only it)", (await headerPin.getAttribute("data-selected")) === "true" && (await footerPin.getAttribute("data-selected")) === null);
  record("reload: Preview still the active view", (await page.getByRole("tab", { name: "Preview" }).getAttribute("aria-selected")) === "true");

  // Switching to Text and selecting a pinned note brings the Preview back.
  await page.getByRole("tab", { name: "Text" }).click();
  await page.waitForTimeout(300);
  record("text view: no pins while the Text view is up", (await page.locator(PINS).count()) === 0);
  await page.locator(`section[aria-label='Issues'] [data-finding-id="${footerId}"] button`).first().click();
  await page.waitForTimeout(400);
  record("text view: selecting a pinned note switches back to the Preview", (await page.getByRole("tab", { name: "Preview" }).getAttribute("aria-selected")) === "true" && (await page.locator(PINS).count()) === 2);
  await shot(page, "image-note-selected");
}

async function databaseChecks(ad: TestAd) {
  const admin = requireSupabaseAdminClient();
  const { data: rows } = await admin.from("findings").select("quote, anchor, verified_span, span_hash, evidence_type, origin, author_id, severity").eq("asset_version_id", ad.versionId).eq("origin", "reviewer").order("created_at");
  const found = rows ?? [];
  record("db: two reviewer findings on V1", found.length === 2, `${found.length} rows`);
  const footer = found.find((r) => r.quote === LABEL_1);
  const anchor = footer?.anchor && typeof footer.anchor === "object" && !Array.isArray(footer.anchor) ? (footer.anchor as Record<string, unknown>) : null;
  record(
    "db: anchor is image_region with fractions near the click",
    Boolean(anchor && anchor.type === "image_region" && typeof anchor.x === "number" && typeof anchor.y === "number" && Math.abs(anchor.x - 0.5) < 0.02 && Math.abs(anchor.y - 0.88) < 0.02),
    anchor ? JSON.stringify(anchor) : "no row",
  );
  record("db: verified_span false, no span hash, needs_judgment, author set", Boolean(footer && footer.verified_span === false && footer.span_hash === null && footer.evidence_type === "needs_judgment" && footer.author_id === USER_ID));
  record("db: severities kept as chosen", found.some((r) => r.quote === LABEL_2 && r.severity === "critical") && footer?.severity === "major");
  const { data: events } = await admin.from("events").select("kind, data").eq("asset_id", ad.assetId).eq("kind", "finding.added");
  const imageEvents = (events ?? []).filter((e) => e.data && typeof e.data === "object" && !Array.isArray(e.data) && (e.data as Record<string, unknown>).anchor_type === "image_region");
  record("db: finding.added events carry anchor_type image_region", imageEvents.length === 2, `${imageEvents.length} events`);
}

async function requestChangesNote(page: Page) {
  await page.mouse.move(5, 5);
  await page.keyboard.press("Escape");
  await page.keyboard.press("r");
  const sheet = page.getByRole("dialog", { name: /Request changes on V1/ });
  const open = await visible(sheet, 5_000);
  record("request changes: R opens the sheet", open);
  if (!open) return;
  const note = await sheet.locator("#request-text").inputValue();
  record("request changes: note lists both notes as pinned on the image with their labels", note.includes(`Pinned on the image: ${LABEL_1}`) && note.includes(`Pinned on the image: ${LABEL_2}`) && !/Quoted:/.test(note), note.split("\n").slice(2, 5).join(" | ").slice(0, 160));
  await shot(page, "image-notes-request-sheet");
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
}

async function phoneFlow(page: Page, ad: TestAd) {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAd(page, ad);
  await noHorizontalScroll(page, "image ad (390)");
  record("image ad (390): both pins drawn", (await page.locator(PINS).count()) === 2);
  const img = await page.locator(IMG).boundingBox();
  record("image ad (390): image fits the phone width", Boolean(img && img.x >= 0 && img.x + img.width <= 390 + 1), img ? `x ${Math.round(img.x)} w ${Math.round(img.width)}` : "no image");
  const footerPin = page.locator(`${PINS}[aria-label*="${LABEL_1}"]`).first();
  const where = await pinFraction(page, footerPin);
  record("image ad (390): pin stays at the same fraction of the image", Boolean(where && Math.abs(where.x - 0.5) < 0.02 && Math.abs(where.y - 0.88) < 0.02), where ? `x ${where.x.toFixed(3)} y ${where.y.toFixed(3)}` : "no pin");
  await footerPin.click();
  await page.waitForTimeout(400);
  const footerId = await footerPin.getAttribute("data-finding-id");
  record("image ad (390): tapping a pin selects its card", (await page.locator(`section[aria-label='Issues'] [data-finding-id="${footerId}"] button[aria-pressed='true']`).count()) === 1);
  await shot(page, "image-notes-phone");

  // Pinning works by touch-sized taps too: open the dialog and check it fits.
  await clickImageAt(page, 0.8, 0.5);
  const dialog = page.getByRole("dialog", { name: "Add a note on the image" });
  record("image ad (390): tapping the image opens the note dialog", await visible(dialog, 5_000));
  const dBox = await dialog.boundingBox();
  record("image ad (390): dialog fits the phone width", Boolean(dBox && dBox.x >= 0 && dBox.x + dBox.width <= 390 + 1), dBox ? `x ${Math.round(dBox.x)} w ${Math.round(dBox.width)}` : "missing");
  await shot(page, "image-note-dialog");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
  record("image ad (390): cancelling leaves no draft pin and no new note", (await page.locator("[data-image-pin-draft]").count()) === 0 && (await page.locator(PINS).count()) === 2);
  await page.setViewportSize({ width: 1280, height: 800 });
}

async function newVersionFlow(page: Page, ad: TestAd) {
  // V2: a new image. The pins belong to V1; recheck must not pair them with anything, and What changed must stay honest.
  const v2 = await addVersion({ assetId: ad.assetId, userId: USER_ID, origin: "upload", file: { name: "spring-loan-banner-v2.png", bytes: makeBannerPng(1200, 640), mimeType: "image/png" }, note: "test: new image" });
  const status = await runCheck(v2.versionId);
  record("v2: check on the new image finished", status !== "timeout", status);
  const admin = requireSupabaseAdminClient();
  const { data: v2Findings } = await admin.from("findings").select("id, prior_finding_id, recheck_status, origin").eq("asset_version_id", v2.versionId);
  record("v2: nothing on V2 claims a V1 pin as its prior", (v2Findings ?? []).every((f) => !f.prior_finding_id));
  await openAd(page, ad);
  const text = await bodyText(page);
  record("v2: page shows V2 with no pins (they were V1's)", /V2/.test(text) && (await page.locator(PINS).count()) === 0);
  record("v2: What changed lists the V1 notes as Not re-flagged, pinned on the image", /What changed since V1/.test(text) && /Not re-flagged/.test(text) && /pinned on the image: APR in the footer/.test(text) && !/1 fixed|2 fixed/.test(text), text.match(/\d+ fixed · \d+ still there · \d+ new(?: · \d+ not re-flagged)?/)?.[0]);
  record("v2: a new pin can be added on V2", Boolean(await clickImageAt(page, 0.5, 0.5)) && (await visible(page.getByRole("dialog", { name: "Add a note on the image" }), 5_000)));
  await page.keyboard.press("Escape");
  await shot(page, "image-notes-v2");
}

async function textAdUntouched(page: Page, ad: TestAd) {
  await openAd(page, ad);
  record("text ad: no pin layer and no pin hint", (await page.locator("[data-image-stage]").count()) === 0 && !/pin a note/.test(await bodyText(page)));
  record("text ad: header Add issue button still there", (await page.getByRole("button", { name: "Add issue", exact: true }).count()) >= 1);
}

async function main() {
  if (!PASSWORD) throw new Error("Set SMOKE_PASSWORD (never commit it).");
  mkdirSync(SCREENS, { recursive: true });

  console.log("setup: creating [test] ads");
  const imageAd = await createImageAd();
  const textAd = await createTextAd();
  const ads = [imageAd, textAd];
  const status = await runCheck(imageAd.versionId);
  record("setup: check on the image ad finished", status !== "timeout", status);

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
    await pinFlow(page, imageAd);
    await persistenceFlow(page);
    await databaseChecks(imageAd);
    await requestChangesNote(page);
    await phoneFlow(page, imageAd);
    await newVersionFlow(page, imageAd);
    await textAdUntouched(page, textAd);
  } catch (err) {
    record("flow crashed", false, (err as Error).message);
    await shot(page, "image-notes-crash").catch(() => undefined);
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
  console.error("verify-image-notes crashed:", err);
  process.exitCode = 1;
});
