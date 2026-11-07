/**
 * Browser verification of life after approval: Mark as live, the Live tab,
 * expiry (cron + list load) back to Needs review tagged Expired, Archive and
 * Unarchive, and the audit export's ads section. Playwright + Chromium
 * against a running dev server; creates one "[test] " sample ad and retires
 * it at the end (approved ads are hidden, their approval kept).
 *
 *   doppler run -p promptarmor -c prd -- env SMOKE_PASSWORD=... \
 *     PLAYWRIGHT_MODULE=$HOME/.bun/install/global/node_modules/playwright \
 *     VERIFY_BASE_URL=http://localhost:3103 bun --conditions=react-server scripts/verify-lifecycle.ts [--keep]
 *
 * Needs the lifecycle migration (supabase/migrations/20261107162200_lifecycle.sql)
 * applied; without it the script says so and exits with code 2. CRON_SECRET
 * (from Doppler) is used to call /api/cron/maintenance like Vercel does.
 *
 * Env: SMOKE_EMAIL, SMOKE_PASSWORD (required), VERIFY_BASE_URL,
 * VERIFY_SCREENS, VERIFY_PROFILE / VERIFY_USER, PLAYWRIGHT_MODULE.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";

import { startAnalysisForVersion } from "@/lib/ai/engine";
import { createAd } from "@/lib/intake/ads";
import { getSampleAd } from "@/lib/seed/samples";
import { requireSupabaseAdminClient } from "@/lib/supabase/admin";

const BASE = (process.env.VERIFY_BASE_URL ?? "http://localhost:3103").replace(/\/$/, "");
const EMAIL = process.env.SMOKE_EMAIL ?? "promptarmortwo+reviewer@gmail.com";
const PASSWORD = process.env.SMOKE_PASSWORD;
const SCREENS = path.resolve(process.env.VERIFY_SCREENS ?? ".verify-screens");
const PROFILE_ID = process.env.VERIFY_PROFILE ?? "cf7d66e9-54d5-4b99-ac6f-89d760a20731";
const USER_ID = process.env.VERIFY_USER ?? "88b5b90e-3f4b-46a2-8c50-333240cbb671";
const KEEP = process.argv.includes("--keep");

const RATIONALE = "Read V1 in full against PL-1 terms; the numbers were checked by hand and the channel is right for this copy.";

// Minimal Playwright surface (loaded at runtime, see PLAYWRIGHT_MODULE).
type Locator = {
  first: () => Locator;
  nth: (i: number) => Locator;
  locator: (selector: string, opts?: { hasText?: string | RegExp }) => Locator;
  getByRole: (role: string, opts?: { name?: string | RegExp; exact?: boolean }) => Locator;
  getByText: (text: string | RegExp, opts?: { exact?: boolean }) => Locator;
  getByLabel: (text: string | RegExp, opts?: { exact?: boolean }) => Locator;
  count: () => Promise<number>;
  click: (opts?: { timeout?: number; force?: boolean }) => Promise<void>;
  fill: (value: string, opts?: { timeout?: number }) => Promise<void>;
  isDisabled: () => Promise<boolean>;
  isEnabled: () => Promise<boolean>;
  waitFor: (opts?: { state?: "attached" | "detached" | "visible" | "hidden"; timeout?: number }) => Promise<void>;
  innerText: () => Promise<string>;
  getAttribute: (name: string) => Promise<string | null>;
};
type Page = {
  goto: (url: string, opts?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
  reload: (opts?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
  url: () => string;
  locator: (selector: string, opts?: { hasText?: string | RegExp }) => Locator;
  getByRole: (role: string, opts?: { name?: string | RegExp; exact?: boolean }) => Locator;
  getByText: (text: string | RegExp, opts?: { exact?: boolean }) => Locator;
  getByLabel: (text: string | RegExp, opts?: { exact?: boolean }) => Locator;
  waitForURL: (url: string | RegExp, opts?: { timeout?: number }) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  screenshot: (opts: { path: string; fullPage?: boolean }) => Promise<unknown>;
  evaluate: <T>(fn: string) => Promise<T>;
  keyboard: { press: (key: string) => Promise<void> };
  mouse: { move: (x: number, y: number) => Promise<void> };
  on: (event: string, handler: (arg: { text: () => string; type: () => string } & Error) => void) => void;
  viewportSize: () => { width: number; height: number } | null;
};
type Browser = {
  newContext: (opts?: { viewport?: { width: number; height: number }; reducedMotion?: string }) => Promise<{ newPage: () => Promise<Page> }>;
  close: () => Promise<void>;
};

const results: { label: string; ok: boolean; detail?: string }[] = [];
function record(label: string, ok: boolean, detail?: string) {
  results.push({ label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` · ${detail}` : ""}`);
}
async function shot(page: Page, name: string) {
  await page.waitForTimeout(250);
  const file = path.join(SCREENS, `${name}-${page.viewportSize()?.width ?? 0}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`      screenshot ${file}`);
}
const bodyText = (page: Page) => page.locator("body").innerText().catch(() => "");
async function settled(page: Page, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await page.evaluate<number>("document.querySelectorAll('[data-slot=\"skeleton\"]').length")) === 0) return true;
    await page.waitForTimeout(200);
  }
  return false;
}
async function waitForText(page: Page, test: RegExp, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (test.test(await bodyText(page))) return true;
    await page.waitForTimeout(500);
  }
  return false;
}
function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------

type TestAd = { assetId: string; versionId: string; title: string };

async function preflight(): Promise<boolean> {
  const admin = requireSupabaseAdminClient();
  const { error } = await admin.from("assets").select("id, live_at, expires_at, archived_at").eq("profile_id", PROFILE_ID).limit(1);
  if (error?.code === "42703") {
    console.error("The lifecycle columns are missing. Apply supabase/migrations/20261107162200_lifecycle.sql first.");
    return false;
  }
  if (error) throw new Error(`preflight failed: ${error.code} ${error.message}`);
  return true;
}

async function createTestAd(): Promise<TestAd> {
  const sample = getSampleAd("paid-social-personal-loan");
  if (!sample) throw new Error("sample missing");
  const title = `[test] lifecycle: ${sample.title}`;
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
  return { assetId: created.assetId, versionId: created.versionId, title };
}

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

async function retire(ad: TestAd | null) {
  const admin = requireSupabaseAdminClient();
  const { data: leftovers } = await admin.from("assets").select("id, title, status").eq("profile_id", PROFILE_ID).eq("audience", "sample").like("title", "[test] lifecycle:%");
  for (const row of leftovers ?? []) {
    const approved = row.status === "approved" || row.status === "approved_with_exceptions";
    const patch = approved ? { audience: "sample_cleared" } : { status: "withdrawn", audience: "sample_cleared" };
    const { error } = await admin.from("assets").update(patch).eq("id", row.id);
    console.log(error ? `      could not retire ${row.title}: ${error.code} ${error.message}` : `      retired ${row.title}${approved ? " (approved: hidden, approval kept)" : ""}`);
  }
  if (ad && !(leftovers ?? []).some((r) => r.id === ad.assetId)) console.log(`      ${ad.title} already retired`);
}

async function signIn(page: Page) {
  await page.goto(`${BASE}/signin`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.getByRole("tab", { name: "Password" }).click();
  await page.locator("#pw-email").fill(EMAIL);
  await page.locator("#pw-password").fill(PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/ads(\?|$)/, { timeout: 60_000 });
  record("sign-in -> /ads", /\/ads/.test(page.url()));
}

/** Approve V1 through the sheet (attestation; exceptions for any open Critical/Major; self-approval rationale). */
async function approve(page: Page, ad: TestAd, versionNo: number, label: string) {
  await page.goto(`${BASE}/ads/${ad.assetId}`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  await page.mouse.move(5, 5);
  await page.keyboard.press("a");
  const sheet = page.getByRole("dialog", { name: new RegExp(`Approve V${versionNo}`) });
  record(`${label}: A opens the Approve V${versionNo} sheet`, await sheet.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false));
  const boxes = sheet.locator("textarea[id^='exc-text-']");
  const n = await boxes.count();
  for (let i = 0; i < n; i++) {
    const id = await boxes.nth(i).getAttribute("id");
    await sheet.locator(`#${id!.replace("exc-text-", "exc-reason-")}`).click();
    await page.getByRole("option", { name: /Business decision/ }).click();
    await boxes.nth(i).fill(RATIONALE);
  }
  await sheet.locator("#approve-rationale").fill(RATIONALE);
  await sheet.getByRole("checkbox").click();
  const submit = sheet.getByRole("button", { name: new RegExp(`^Approve( with exceptions)? V${versionNo}$`) });
  record(`${label}: submit enabled once attested`, await submit.isEnabled(), `${n} exception field(s)`);
  await submit.click();
  record(`${label}: approval toast`, await waitForText(page, new RegExp(`Approved V${versionNo}`), 20_000));
  // Stay on this ad whatever the auto-advance does.
  await page.waitForTimeout(2_000);
  await page.goto(`${BASE}/ads/${ad.assetId}`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
}

async function markLiveFlow(page: Page, ad: TestAd) {
  const text = await bodyText(page);
  record("ship it: approved page shows the Ship it card", /Ship it/.test(text) && /Mark as live/.test(text));
  await page.getByRole("button", { name: "Mark as live" }).first().click();
  const where = page.locator("#live-channel");
  await where.waitFor({ state: "visible", timeout: 5_000 });
  await where.click();
  await page.getByRole("option", { name: "Meta", exact: true }).click();
  await page.locator("#live-url").fill("https://www.facebook.com/ads/library/?id=123");
  // Past end date: refused with a plain message, nothing recorded.
  await page.locator("#live-ends").fill(isoDate(new Date(Date.now() - 2 * 86_400_000)));
  await shot(page, "lifecycle-mark-live-form");
  await page.locator("section[aria-label='Ship it'] form").getByRole("button", { name: "Mark as live" }).click();
  const refused = await waitForText(page, /end date has already passed/i, 10_000);
  record("ship it: past end date refused with a plain message", refused, refused ? "The end date has already passed…" : (await bodyText(page)).slice(0, 200));
  const admin = requireSupabaseAdminClient();
  const { data: after } = await admin.from("assets").select("live_at").eq("id", ad.assetId).single();
  record("ship it: nothing recorded on refusal", after?.live_at == null);

  // Future end date: live.
  const ends = new Date(Date.now() + 60 * 86_400_000);
  await page.locator("#live-ends").fill(isoDate(ends));
  await page.locator("section[aria-label='Ship it'] form").getByRole("button", { name: "Mark as live" }).click();
  record("ship it: Marked as live toast", await waitForText(page, /Marked as live/, 15_000));
  const liveShown = await waitForText(page, /Live on Meta since/, 15_000);
  const liveText = await bodyText(page);
  record("ship it: card reads Live on Meta since … · ends …", liveShown && /ends /.test(liveText), liveText.match(/Live on Meta since[^\n]*/)?.[0]);
  record("ship it: link shown by its host", /facebook\.com/.test(liveText));
  record("ad: header status word is Live", (await page.locator("[data-slot=sidebar-inset] header").nth(1).innerText()).includes("Live"));
  await shot(page, "lifecycle-live");
  const { data: row } = await admin.from("assets").select("live_at, live_channel, live_url, expires_at, status").eq("id", ad.assetId).single();
  record("db: live fields saved, status unchanged", row?.live_channel === "meta" && Boolean(row?.live_at) && Boolean(row?.expires_at) && (row?.status === "approved" || row?.status === "approved_with_exceptions"), JSON.stringify(row));
  const { data: ev } = await admin.from("events").select("kind").eq("asset_id", ad.assetId).eq("kind", "asset.marked_live");
  record("events: asset.marked_live recorded", (ev?.length ?? 0) === 1, `${ev?.length ?? 0} rows`);

  // Change the end date (the Live card).
  await page.getByRole("button", { name: /Change end date/ }).click();
  await page.locator("#live-ends-edit").fill(isoDate(new Date(Date.now() - 86_400_000)));
  await page.locator("section[aria-label='Live'] form").getByRole("button", { name: "Save" }).click();
  record("live: past end date refused on change too", await waitForText(page, /end date has already passed/i, 10_000));
  await page.locator("#live-ends-edit").fill(isoDate(new Date(Date.now() + 90 * 86_400_000)));
  await page.locator("section[aria-label='Live'] form").getByRole("button", { name: "Save" }).click();
  record("live: end date saved", await waitForText(page, /End date saved/, 10_000));
  const { data: ev2 } = await admin.from("events").select("kind").eq("asset_id", ad.assetId).eq("kind", "asset.expiry_set");
  record("events: asset.expiry_set recorded", (ev2?.length ?? 0) === 1);

  // Live tab.
  await page.goto(`${BASE}/ads?tab=live`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  const liveRow = page.locator(`a[data-ad-row][href="/ads/${ad.assetId}"]`);
  const rowText = await liveRow.innerText().catch(() => "");
  record("list: Live tab shows the row with its live line", /Live on Meta since/.test(rowText) && /ends /.test(rowText), rowText.replace(/\s+/g, " ").slice(0, 200));
  record("list: tabs read Needs review · Changes requested · Approved · Live · Archived · All", /Needs review[\s\S]*Changes requested[\s\S]*Approved[\s\S]*Live[\s\S]*Archived[\s\S]*All/.test(await page.locator("nav[aria-label='Ad status']").innerText()));
  await shot(page, "lifecycle-list-live");
  await page.goto(`${BASE}/ads?tab=approved`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  record("list: a live ad is not also on the Approved tab", (await page.locator(`a[data-ad-row][href="/ads/${ad.assetId}"]`).count()) === 0);
}

async function expiryFlow(page: Page, ad: TestAd) {
  const admin = requireSupabaseAdminClient();
  // Own [test] ad only: end date one minute ago.
  const { error } = await admin.from("assets").// One second ago: after the approval was granted (the sweep only expires an end date that passed during the current approval) but already in the past.
  update({ expires_at: new Date(Date.now() - 1_000).toISOString() }).eq("id", ad.assetId).eq("profile_id", PROFILE_ID);
  record("db: end date set to one minute ago on the test ad", !error, error?.message);

  const secret = process.env.CRON_SECRET;
  if (secret) {
    const res = await fetch(`${BASE}/api/cron/maintenance`, { headers: { authorization: `Bearer ${secret}` } });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; expired?: number | { expired: number; skipped: string } };
    const expired = typeof body.expired === "number" ? body.expired : body.expired?.expired ?? 0;
    record("cron: maintenance route expired the ad", res.status === 200 && body.ok === true && expired >= 1, `status ${res.status} · expired ${JSON.stringify(body.expired)}`);
  } else {
    record("cron: CRON_SECRET not in env; relying on the list-load sweep", true, "skipped");
  }

  await page.goto(`${BASE}/ads`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  const row = page.locator(`a[data-ad-row][href="/ads/${ad.assetId}"]`);
  const rowText = await row.innerText().catch(() => "");
  record("list: expired ad is back in Needs review tagged Expired", /Expired/.test(rowText) && /Needs review/.test(rowText), rowText.replace(/\s+/g, " ").slice(0, 200));
  record("list: its live line stays for the record", /Was live on Meta/.test(rowText), rowText.match(/Was live[^\n]*/)?.[0]);
  await shot(page, "lifecycle-list-expired");
  const { data: a } = await admin.from("assets").select("status, re_review_reason, live_at, expires_at").eq("id", ad.assetId).single();
  const reason = (a?.re_review_reason ?? {}) as Record<string, unknown>;
  record("db: status re_review_due with reason kind expired; live fields kept", a?.status === "re_review_due" && reason.kind === "expired" && Boolean(a?.live_at) && Boolean(a?.expires_at), JSON.stringify(a));
  const { data: ev } = await admin.from("events").select("kind").eq("asset_id", ad.assetId).eq("kind", "asset.expired");
  record("events: asset.expired recorded once", (ev?.length ?? 0) === 1, `${ev?.length ?? 0} rows`);

  await row.click();
  await page.waitForURL(new RegExp(`/ads/${ad.assetId}`), { timeout: 30_000 });
  await settled(page);
  const text = await bodyText(page);
  record("ad: page explains Approval expired", /Approval expired/.test(text) && /end date passed/i.test(text));
  record("ad: Approve is available again", (await page.getByRole("button", { name: /^Approve V/ }).count()) === 1);
  await shot(page, "lifecycle-ad-expired");
}

async function archiveFlow(page: Page, ad: TestAd) {
  // Re-approve: the old end date must not expire it again on the next list load.
  await approve(page, ad, 1, "re-approve");
  await page.goto(`${BASE}/ads`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  record("list: re-approved ad does not expire again on load", (await page.locator(`a[data-ad-row][href="/ads/${ad.assetId}"]`).count()) === 0);
  await page.goto(`${BASE}/ads?tab=approved`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  const approvedRow = page.locator(`a[data-ad-row][href="/ads/${ad.assetId}"]`);
  record("list: it sits on Approved (not Live: its run ended)", (await approvedRow.count()) === 1 && /Was live on Meta/.test(await approvedRow.innerText()));

  await page.goto(`${BASE}/ads/${ad.assetId}`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  record("ship it: offers Mark as live again after a run ended", /Mark it live again/.test(await bodyText(page)));
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /Archive…/ }).click();
  const dialog = page.getByRole("dialog", { name: "Archive this ad" });
  record("archive: dialog opens from the overflow menu", await dialog.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false));
  record("archive: button disabled without a reason", await dialog.getByRole("button", { name: "Archive", exact: true }).isDisabled());
  await dialog.locator("#archive-reason").fill("Campaign ended; superseded by the spring creative.");
  await shot(page, "lifecycle-archive-dialog");
  await dialog.getByRole("button", { name: "Archive", exact: true }).click();
  record("archive: page shows Archived <date>", await waitForText(page, /Archived [A-Z][a-z]{2} \d/, 10_000));
  const text = await bodyText(page);
  record("ad: Archived card with the reason and Unarchive", /Archived /.test(text) && /Campaign ended/.test(text) && (await page.getByRole("button", { name: "Unarchive" }).count()) === 1);
  record("ad: archived page is frozen (no Approve button)", (await page.getByRole("button", { name: /^Approve V/ }).count()) === 0);
  await shot(page, "lifecycle-ad-archived");
  const admin = requireSupabaseAdminClient();
  const { data: ev } = await admin.from("events").select("kind").eq("asset_id", ad.assetId).eq("kind", "asset.archived");
  record("events: asset.archived recorded", (ev?.length ?? 0) === 1);

  await page.goto(`${BASE}/ads?tab=archived`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  const archivedRow = page.locator(`a[data-ad-row][href="/ads/${ad.assetId}"]`);
  const rowText = await archivedRow.innerText().catch(() => "");
  record("list: Archived tab shows the row with the reason", /Archived/.test(rowText) && /Campaign ended/.test(rowText), rowText.replace(/\s+/g, " ").slice(0, 200));
  await shot(page, "lifecycle-list-archived");
  await page.goto(`${BASE}/ads?tab=approved`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  record("list: archived ad left the Approved tab", (await page.locator(`a[data-ad-row][href="/ads/${ad.assetId}"]`).count()) === 0);

  // Unarchive brings it back.
  await page.goto(`${BASE}/ads/${ad.assetId}`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  await page.getByRole("button", { name: "Unarchive" }).click();
  record("unarchive: toast", await waitForText(page, /Back from the archive/, 10_000));
  await page.goto(`${BASE}/ads?tab=approved`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  record("list: unarchived ad is back on Approved", (await page.locator(`a[data-ad-row][href="/ads/${ad.assetId}"]`).count()) === 1);
  const { data: ev2 } = await admin.from("events").select("kind").eq("asset_id", ad.assetId).eq("kind", "asset.unarchived");
  record("events: asset.unarchived recorded", (ev2?.length ?? 0) === 1);
}

async function exportFlow(page: Page, ad: TestAd) {
  await page.goto(`${BASE}/settings/workspace`, { waitUntil: "networkidle", timeout: 60_000 });
  await settled(page);
  await page.getByRole("button", { name: "Export audit record" }).click();
  const pre = page.locator("pre[aria-label='Audit record JSON']").first();
  const ok = await pre.waitFor({ state: "visible", timeout: 30_000 }).then(() => true).catch(() => false);
  const json = ok ? await pre.innerText() : "";
  record("export: audit record has an ads section with the lifecycle fields", /"ads"/.test(json) && /"live_channel": "meta"/.test(json) && /"archived_at"/.test(json) && json.includes(ad.assetId));
  record("export: dialog counts the ads", /\d+ ads? \(with live, end and archive dates\)/.test(await bodyText(page)));
  await shot(page, "lifecycle-export");
}

async function main() {
  if (!PASSWORD) throw new Error("Set SMOKE_PASSWORD (never commit it).");
  if (!(await preflight())) {
    process.exitCode = 2;
    return;
  }
  mkdirSync(SCREENS, { recursive: true });
  let ad: TestAd | null = null;
  const pw = (await import(process.env.PLAYWRIGHT_MODULE ?? "playwright")) as { chromium: { launch: () => Promise<Browser> } };
  const browser = await pw.chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" })).newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  try {
    await retire(null);
    ad = await createTestAd();
    record("setup: check finished", ["complete", "failed", "declined_budget"].includes(await runCheck(ad.versionId)));
    await signIn(page);
    await approve(page, ad, 1, "approve");
    await markLiveFlow(page, ad);
    await expiryFlow(page, ad);
    await archiveFlow(page, ad);
    await exportFlow(page, ad);
  } catch (err) {
    record("flow crashed", false, (err as Error).message);
    await shot(page, "lifecycle-crash").catch(() => undefined);
  } finally {
    await browser.close();
    if (KEEP) console.log("--keep: leaving the [test] ad in place");
    else await retire(ad);
  }
  const ignorable = (m: string) => /favicon|Download the React DevTools|hydrat.*suppress|Content Security Policy|sandboxed|about:srcdoc/i.test(m);
  const realConsole = consoleErrors.filter((m) => !ignorable(m));
  record("no browser console errors", realConsole.length === 0, realConsole.slice(0, 5).join(" | ").slice(0, 600) || undefined);
  record("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 5).join(" | ").slice(0, 600) || undefined);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("verify-lifecycle crashed:", err);
  process.exitCode = 1;
});
