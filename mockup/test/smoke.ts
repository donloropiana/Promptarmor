// Smoke test for dist/compliance-workbench.html using happy-dom.
// Usage: bun run smoke.ts [--verbose]
import { Window } from "happy-dom";
import { readFileSync } from "fs";
import { join } from "path";

const VERBOSE = process.argv.includes("--verbose");
const DIST = join(import.meta.dir, "..", "dist", "compliance-workbench.html");
const html = readFileSync(DIST, "utf8");

type Err = { where: string; msg: string };
const errors: Err[] = [];
const warnings: Err[] = [];
let where = "load";

const window = new Window({
  url: "https://prototype.example/",
  width: 1280,
  height: 900,
  settings: {
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
    disableIframePageLoading: true,
    disableComputedStyleRendering: true,
    navigation: { disableMainFrameNavigation: true, disableChildFrameNavigation: true, disableChildPageNavigation: true },
    handleDisabledFileLoadingAsSuccess: true,
  },
});
const w: any = window;
const document = w.document;

// Capture console + forbidden APIs
const fmt = (args: any[]) =>
  args
    .map((a) => (a instanceof Error || (a && a.stack) ? `${a.message}\n${String(a.stack).split("\n").slice(0, 4).join("\n")}` : typeof a === "object" ? safeJson(a) : String(a)))
    .join(" ");
function safeJson(o: any) { try { return JSON.stringify(o).slice(0, 300); } catch { return String(o); } }
w.console.error = (...a: any[]) => errors.push({ where, msg: "console.error: " + fmt(a) });
w.console.warn = (...a: any[]) => warnings.push({ where, msg: "console.warn: " + fmt(a) });
w.console.log = () => {};
w.console.info = () => {};
const forbidden = (name: string) => (..._a: any[]) => errors.push({ where, msg: `forbidden API called: ${name}` });
w.alert = forbidden("alert");
w.confirm = forbidden("confirm");
w.prompt = forbidden("prompt");
w.open = forbidden("window.open");
w.print = forbidden("print");
w.addEventListener("error", (e: any) => errors.push({ where, msg: "window error: " + (e?.error?.stack || e?.message || String(e)) }));
w.addEventListener("unhandledrejection", (e: any) => errors.push({ where, msg: "unhandled rejection: " + String(e?.reason?.stack || e?.reason) }));
// Clipboard stub
try {
  Object.defineProperty(w.navigator, "clipboard", { configurable: true, value: { writeText: async (_t: string) => {} } });
} catch {}
if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
if (!w.scrollTo) w.scrollTo = () => {};
// Compress timers so simulated flows (consent, discovery, toasts) finish quickly.
const realST = w.setTimeout.bind(w);
w.setTimeout = (fn: any, ms?: number, ...rest: any[]) => realST(fn, Math.min(Number(ms) || 0, 3), ...rest);
const realSI = w.setInterval.bind(w);
w.setInterval = (fn: any, ms?: number, ...rest: any[]) => realSI(fn, Math.max(Math.min(Number(ms) || 0, 5), 5), ...rest);
const PHASES = (process.env.PHASES || "routes,clicks,overlays").split(",");
const progress = (s: string) => process.stderr.write(s + "\n");

// Build the test document: body = page markup without scripts, then run scripts in order.
const scriptRe = /<script>([\s\S]*?)<\/script>/g;
const scripts: string[] = [];
let m: RegExpExecArray | null;
while ((m = scriptRe.exec(html))) scripts.push(m[1]);
const markup = html.replace(scriptRe, "");
// Pull <title>/<meta>/<link>/<style> into head, rest into body (as a host would).
document.write(`<!doctype html><html><head></head><body></body></html>`);
const tmp = document.createElement("div");
tmp.innerHTML = markup;
const headTags = ["TITLE", "META", "LINK", "STYLE"];
for (const node of Array.from(tmp.childNodes) as any[]) {
  if (node.nodeType === 1 && headTags.includes(node.tagName)) document.head.appendChild(node);
  else document.body.appendChild(node);
}

const t0 = performance.now();
scripts.forEach((src, i) => {
  where = `script#${i}`;
  try {
    w.eval(src);
  } catch (e: any) {
    errors.push({ where, msg: "script threw: " + (e?.stack || e) });
  }
});

const App = w.App;
if (!App) {
  console.log("FATAL: window.App missing");
  console.log(errors);
  process.exit(1);
}

async function flush(ms = 12) {
  await new Promise((r) => setTimeout(r, ms));
}
function view() { return document.querySelector("#view"); }
function viewText() { const v = view(); return v ? (v.textContent || "").trim() : ""; }

async function visit(hash: string) {
  where = hash;
  try { App.go(hash); } catch (e: any) { errors.push({ where, msg: "go threw: " + (e?.stack || e) }); }
  await flush();
  const v = view();
  if (!v || !v.innerHTML.trim() || viewText().length < 2) errors.push({ where, msg: "#view empty" });
  const errPage = v && v.textContent && v.textContent.includes("This screen failed to render");
  if (errPage) errors.push({ where, msg: "render error page shown" });
  return v;
}

// ---- 1. Visit every route ----
await flush(10);
const routeNames: string[] = [];
// Recover route names: App exposes no list; derive from source registrations in dist.
const routeRe = /\bA(?:pp)?\.route\(\s*['"]([a-z0-9-]+)['"]/g;
let rm: RegExpExecArray | null;
while ((rm = routeRe.exec(html))) if (!routeNames.includes(rm[1])) routeNames.push(rm[1]);

const assetIds: string[] = (App.state.assets || []).map((a: any) => a.id);
const visited: string[] = [];
const notFoundRoutes: string[] = [];

for (const r of routeNames) {
  if (r === "asset" || r === "compare") continue;
  await visit("#" + r);
  visited.push("#" + r);
  if (viewText().includes("Not found") && document.querySelector("#view .notfound")) notFoundRoutes.push("#" + r);
}
// Per-asset routes, across all profiles (switch active profile so own assets are visible)
const profiles: any[] = App.state.profiles || [];
const origProfile = App.state.activeProfileId;
const assetNotFound: string[] = [];
for (const id of assetIds) {
  const a = App.state.assets.find((x: any) => x.id === id);
  if (a && a.profileId && App.state.activeProfileId !== a.profileId) {
    App.state.activeProfileId = a.profileId;
  }
  for (const pre of ["asset", "compare"]) {
    await visit(`#${pre}-${id}`);
    visited.push(`#${pre}-${id}`);
    if (document.querySelector("#view .notfound")) assetNotFound.push(`#${pre}-${id}`);
  }
}
App.state.activeProfileId = origProfile;
// Cross-profile isolation check: an asset from another profile must be Not found
const foreign = App.state.assets.find((a: any) => a.profileId && a.profileId !== origProfile);
if (foreign) {
  await visit(`#asset-${foreign.id}`);
  if (!document.querySelector("#view .notfound")) errors.push({ where: `#asset-${foreign.id}`, msg: "cross-profile asset did not render Not found" });
}
await visit("#no-such-page");
if (!document.querySelector("#view .notfound")) errors.push({ where: "#no-such-page", msg: "unknown route did not render Not found" });

// ---- 2. Static checks on every visited page (collected during visits) ----
const hrefIssues: Set<string> = new Set();
const extIssues: Set<string> = new Set();
function scanAttrs(root: any, ctx: string) {
  for (const el of Array.from(root.querySelectorAll("[href],[src]")) as any[]) {
    for (const attr of ["href", "src"]) {
      const v = el.getAttribute(attr);
      if (v == null) continue;
      if (v.startsWith("#/") || (v.startsWith("#") && /[?=\/]/.test(v))) hrefIssues.add(`${ctx}: ${attr}="${v}"`);
      if (/^https?:\/\//i.test(v)) {
        const host = v.replace(/^https?:\/\//i, "").split(/[\/?#]/)[0].toLowerCase();
        const fontOk = host === "fonts.googleapis.com" || host === "fonts.gstatic.com";
        const citeOk = el.tagName === "A" && attr === "href" && /(^|\.)(ecfr\.gov|ftc\.gov|consumerfinance\.gov|law\.cornell\.edu|federalregister\.gov)$/.test(host);
        const exampleOk = host.endsWith(".example");
        if (!fontOk && !citeOk && !(exampleOk && el.tagName === "A")) extIssues.add(`${ctx}: <${el.tagName.toLowerCase()} ${attr}="${v}">`);
      }
    }
  }
}

// ---- 3. Click every [data-action] on key routes ----
const keyRoutes = [
  "#dashboard", "#queue", "#intake-triage", "#intake-new", "#intake-sources",
  "#policies-rules", "#policies-offers", "#policies-references", "#reports", "#members",
  "#profile-prefs", "#new-profile", "#signin", "#invite",
];
// Add the first few assets of the active profile + a compare route
const myAssets = App.state.assets.filter((a: any) => !a.profileId || a.profileId === origProfile).map((a: any) => a.id);
for (const id of myAssets) keyRoutes.push(`#asset-${id}`);
for (const id of myAssets.slice(0, 4)) keyRoutes.push(`#compare-${id}`);

let clicked = 0;
const clickedByRoute: Record<string, number> = {};
const skipActions = new Set(["app-reset-demo", "reset-demo"]); // reset handled separately at the end
function describe(el: any) {
  const ds = Object.entries(el.dataset || {}).map(([k, v]) => `${k}=${v}`).join(",");
  return `${el.tagName.toLowerCase()}[${ds}] "${(el.textContent || "").trim().slice(0, 40)}"`;
}
function actionKeys(root: any) {
  return (Array.from(root.querySelectorAll("[data-action]")) as any[]).map((el, i) => {
    const key = el.getAttribute("data-action") + "|" + Object.entries(el.dataset || {}).map(([k, v]) => `${k}=${v}`).join(",") + "|" + (el.textContent || "").trim().slice(0, 30);
    return { key, i };
  });
}

for (const r of (PHASES.includes("clicks") ? keyRoutes : [])) {
  progress("clicks " + r);
  where = r;
  App.resetDemo?.();
  await flush();
  await visit(r);
  scanAttrs(document, r);
  // snapshot keys of action elements in document (view + chrome), dedupe
  const snapshot = actionKeys(document);
  const seen = new Set<string>();
  clickedByRoute[r] = 0;
  for (const { key } of snapshot) {
    if (seen.has(key)) continue;
    seen.add(key);
    const actName = key.split("|")[0];
    if (skipActions.has(actName)) continue;
    // re-navigate to fresh state for this click
    App.closeDialog?.(); App.closeDrawer?.();
    await visit(r);
    const el = (Array.from(document.querySelectorAll("[data-action]")) as any[]).find((e) => {
      const k = e.getAttribute("data-action") + "|" + Object.entries(e.dataset || {}).map(([k, v]) => `${k}=${v}`).join(",") + "|" + (e.textContent || "").trim().slice(0, 30);
      return k === key;
    });
    if (!el) continue; // element only exists in some state
    where = `${r} click ${describe(el)}`;
    try {
      el.click();
    } catch (e: any) {
      errors.push({ where, msg: "click threw: " + (e?.stack || e) });
    }
    await flush();
    scanAttrs(document, where);
    // If a dialog/drawer opened, also scan its actions once (one level deep)
    const overlays = Array.from(document.querySelectorAll("#dialog-root [data-action], #drawer-root [data-action], .dialog [data-action], .drawer [data-action], #popover-root [data-action]")) as any[];
    const overlayKeys = new Set<string>();
    for (const oel of overlays) {
      const ok = oel.getAttribute("data-action") + "|" + (oel.textContent || "").trim().slice(0, 30);
      if (overlayKeys.has(ok)) continue;
      overlayKeys.add(ok);
    }
    clicked++;
    clickedByRoute[r]++;
    if (!view() || !view().innerHTML.trim()) errors.push({ where, msg: "#view empty after click" });
  }
}

// ---- 3b. Second-level: click every action inside dialogs/drawers/menus opened from key routes ----
let overlayClicked = 0;
for (const r of (PHASES.includes("overlays") ? keyRoutes : [])) {
  progress("overlays " + r);
  App.resetDemo?.();
  await flush();
  await visit(r);
  const firstLevel = actionKeys(document);
  const seen = new Set<string>();
  for (const { key } of firstLevel) {
    if (seen.has(key)) continue;
    seen.add(key);
    const actName = key.split("|")[0];
    if (skipActions.has(actName)) continue;
    App.closeDialog?.(); App.closeDrawer?.();
    await visit(r);
    const find = () => (Array.from(document.querySelectorAll("[data-action]")) as any[]).find((e) => (e.getAttribute("data-action") + "|" + Object.entries(e.dataset || {}).map(([k, v]) => `${k}=${v}`).join(",") + "|" + (e.textContent || "").trim().slice(0, 30)) === key);
    const el = find();
    if (!el) continue;
    where = `${r} > ${describe(el)}`;
    try { el.click(); } catch {}
    await flush();
    const overlaySel = "#dialog-root [data-action], #drawer-root [data-action], #popover-root [data-action], [role=dialog] [data-action]";
    const ovKeys = (Array.from(document.querySelectorAll(overlaySel)) as any[]).map((e) => e.getAttribute("data-action") + "|" + Object.entries(e.dataset || {}).map(([k, v]) => `${k}=${v}`).join(",") + "|" + (e.textContent || "").trim().slice(0, 30));
    const uniq = Array.from(new Set(ovKeys));
    for (const ok of uniq) {
      if (skipActions.has(ok.split("|")[0])) continue;
      // reopen the overlay fresh
      App.closeDialog?.(); App.closeDrawer?.();
      await visit(r);
      const el1 = find();
      if (!el1) break;
      try { el1.click(); } catch {}
      await flush();
      const oel = (Array.from(document.querySelectorAll(overlaySel)) as any[]).find((e) => (e.getAttribute("data-action") + "|" + Object.entries(e.dataset || {}).map(([k, v]) => `${k}=${v}`).join(",") + "|" + (e.textContent || "").trim().slice(0, 30)) === ok);
      if (!oel) continue;
      where = `${r} > ${describe(el1)} > ${describe(oel)}`;
      try { oel.click(); } catch (e: any) { errors.push({ where, msg: "click threw: " + (e?.stack || e) }); }
      await flush();
      overlayClicked++;
      scanAttrs(document, where);
    }
  }
}

// ---- 4. Reset demo ----
where = "resetDemo";
try { App.resetDemo(); } catch (e: any) { errors.push({ where, msg: "resetDemo threw: " + e }); }
await flush();

// ---- 5. Source scans (whole dist file) ----
const nonStyle = html.replace(/<style>[\s\S]*?<\/style>/g, "");
const forbiddenSrc: string[] = [];
const forbidRe = [/(?<![\w.$'"])(alert|confirm|prompt)\s*\(/g, /window\.(open|print|alert|confirm|prompt)\s*\(/g];
for (const re of forbidRe) {
  let fm: RegExpExecArray | null;
  while ((fm = re.exec(nonStyle))) {
    const line = nonStyle.slice(0, fm.index).split("\n").length;
    const lineText = nonStyle.split("\n")[line - 1].trim();
    if (/^\s*(\/\/|\*)/.test(lineText)) continue;
    forbiddenSrc.push(`line ${line}: ${lineText.slice(0, 120)}`);
  }
}
const hashSlash = (html.match(/["'`]#\//g) || []).length;
const hashQ = (html.match(/["'`]#[A-Za-z0-9-]*[?=]/g) || []).length;
// literal colors outside token blocks: count hex/rgb()/hsl() in <style> excluding :root / [data-theme] blocks, and in JS
const styleBlocks = (html.match(/<style>([\s\S]*?)<\/style>/g) || []).join("\n");
// remove token blocks: rules whose selector includes :root
const noTokens = styleBlocks.replace(/(@media[^{]*\{\s*)?:root[^{]*\{[^}]*\}(\s*\})?/g, "");
const colorRe = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g;
const cssLiteralColors = (noTokens.match(colorRe) || []).filter((c) => !/^#[0-9a-fA-F]{3,8}$/.test(c) || true);
// hex in CSS: careful of id selectors like #app (letters a-f only) — filter tokens that are pure hex but appear after ':' or ' '
const cssHex: string[] = [];
noTokens.replace(/:\s*[^;{}]*?(#[0-9a-fA-F]{3,8})\b/g, (_s, hx) => { cssHex.push(hx); return _s; });
const cssFn = (noTokens.match(/rgba?\(|hsla?\(/g) || []).length;
const jsOnly = scripts.join("\n");
const jsHex = (jsOnly.match(/['"`(:\s]#[0-9a-fA-F]{6}\b|['"`(:\s]#[0-9a-fA-F]{3}\b(?![-\w])/g) || []).filter((s) => !/#[A-Fa-f]-/.test(s));
const jsFn = (jsOnly.match(/\brgba?\(|\bhsla?\(/g) || []).length;

// ---- Report ----
const dedupe = (arr: Err[]) => {
  const map = new Map<string, Err & { n: number }>();
  for (const e of arr) {
    const k = e.msg.split("\n")[0];
    if (!map.has(k)) map.set(k, { ...e, n: 1 });
    else map.get(k)!.n++;
  }
  return Array.from(map.values());
};
const ue = dedupe(errors);
const uw = dedupe(warnings);
const out = {
  routesRegistered: routeNames,
  pagesVisited: visited.length,
  assetIds: assetIds.length,
  assetRoutesNotFound: assetNotFound,
  notFoundNamedRoutes: notFoundRoutes,
  firstLevelClicks: clicked,
  overlayClicks: overlayClicked,
  clickedByRoute,
  errorsTotal: errors.length,
  uniqueErrors: ue.length,
  warningsTotal: warnings.length,
  forbiddenApiInSource: forbiddenSrc,
  hashSlashCount: hashSlash,
  hashQueryCount: hashQ,
  badHrefs: Array.from(hrefIssues).slice(0, 20),
  externalUrlIssues: Array.from(extIssues).slice(0, 20),
  literalColors: { cssHex: cssHex.length, cssFn, jsHex: jsHex.length, jsFn, cssHexSamples: cssHex.slice(0, 8), jsHexSamples: jsHex.slice(0, 8) },
  elapsedMs: Math.round(performance.now() - t0),
};
console.log(JSON.stringify(out, null, 2));
console.log("\n=== UNIQUE ERRORS ===");
for (const e of ue) console.log(`[${e.n}x] @ ${e.where}\n   ${e.msg.split("\n").slice(0, VERBOSE ? 6 : 3).join("\n   ")}`);
console.log("\n=== UNIQUE WARNINGS ===");
for (const e of uw.slice(0, VERBOSE ? 200 : 40)) console.log(`[${e.n}x] @ ${e.where}\n   ${e.msg.split("\n")[0].slice(0, 220)}`);
try { await window.happyDOM.abort(); } catch {}
process.exit(0);
