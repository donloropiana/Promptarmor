// Fill-and-drive explorer: on each key route, open every action; when a dialog/drawer/menu opens,
// fill its fields with valid-looking values and click each of its actions (depth 2).
// Usage: bun run fuzz.ts
import { boot, report } from "./load";

const t = boot();
const { App, $, $$, flush, ctx, setVal } = t;
const LONG = "Disclosure appears in the landing page footer and legal signed off on 2026-11-05 by email.";
const keyOf = (e: any) => e.getAttribute("data-action") + "|" + Object.entries(e.dataset || {}).filter(([k]) => k !== "action").map(([k, v]) => `${k}=${v}`).join(",") + "|" + (e.textContent || "").trim().slice(0, 30);
const OVER = "#dialog-root, #drawer-root, #popover-root";
const overlayActs = () => $$(`#dialog-root [data-action], #drawer-root [data-action], #popover-root [data-action]`);
const SKIP = new Set(["app-reset-demo"]);

function fill(scope: string) {
  for (const el of $$(`${scope} input, ${scope} textarea, ${scope} select`)) {
    if (el.disabled || el.readOnly) continue;
    const type = (el.type || "").toLowerCase();
    if (el.tagName === "SELECT") { const opts = Array.from(el.options).filter((o: any) => o.value); if (opts.length) setVal(el, (opts[opts.length > 1 ? 1 : 0] as any).value); continue; }
    if (type === "checkbox") { if (!el.checked) setVal(el, "1"); continue; }
    if (type === "radio") { if (!$$(`${scope} input[name="${el.name}"]`).some((r: any) => r.checked)) setVal(el, "1"); continue; }
    if (type === "file" || type === "hidden" || type === "search") continue;
    if (el.value && el.value.length >= 45) continue;
    if (type === "email") setVal(el, "new.person@clearpath.example");
    else if (type === "date") setVal(el, "2026-11-20");
    else if (type === "number") setVal(el, "5");
    else if (type === "password") setVal(el, "correct horse battery");
    else if (el.id && /code/i.test(el.id)) setVal(el, "246810");
    else if (el.tagName === "TEXTAREA") setVal(el, (el.value ? el.value + " " : "") + LONG);
    else setVal(el, el.value ? el.value + " updated" : "Sample value for review");
  }
}

const routes = [
  "#dashboard", "#queue", "#intake-triage", "#intake-new", "#intake-sources",
  "#policies-rules", "#policies-offers", "#policies-references", "#reports", "#members",
  "#profile-prefs", "#new-profile", "#signin", "#invite",
  ...App.assetsFor().map((a: any) => `#asset-${a.id}`),
  "#compare-A-103", "#compare-A-106",
];

if (process.env.ROUTES) { const want = process.env.ROUTES.split(","); routes.splice(0, routes.length, ...routes.filter((r) => want.includes(r))); }
let opened = 0, driven = 0, pageFilled = 0;
for (const r of routes) {
  process.stderr.write("fuzz " + r + "\n");
  App.resetDemo(); await flush();
  ctx.where = r; App.go(r); await flush();
  const first = Array.from(new Set($$("[data-action]").map(keyOf))).filter((k) => !SKIP.has(k.split("|")[0]));
  // (a) fill the page's own fields, then click each page action once
  for (const k of first) {
    App.resetDemo(); await flush(); App.go(r); await flush();
    fill("#view");
    const el = $$("[data-action]").find((e: any) => keyOf(e) === k);
    if (!el) continue;
    ctx.where = `${r} [filled] ${k}`;
    el.click(); await flush();
    pageFilled++;
    if (!$("#view") || !$("#view").innerHTML.trim()) t.errors.push({ where: ctx.where, msg: "#view empty after click" });
  }
  // (b) overlays: open each, fill, click each overlay action
  for (const k of first) {
    App.resetDemo(); await flush(); App.closeDialog(); App.closeDrawer(); App.go(r); await flush();
    const el = $$("[data-action]").find((e: any) => keyOf(e) === k);
    if (!el) continue;
    ctx.where = `${r} > ${k}`;
    el.click(); await flush();
    const ov = Array.from(new Set(overlayActs().map(keyOf))).filter((x) => !SKIP.has(x.split("|")[0]));
    if (!ov.length) continue;
    opened++;
    for (const ok of ov) {
      App.resetDemo(); await flush(); App.closeDialog(); App.closeDrawer(); App.go(r); await flush();
      const el1 = $$("[data-action]").find((e: any) => keyOf(e) === k);
      if (!el1) break;
      el1.click(); await flush();
      fill("#dialog-root"); fill("#drawer-root");
      await flush();
      const oel = overlayActs().find((e: any) => keyOf(e) === ok);
      if (!oel) continue;
      ctx.where = `${r} > ${k} > ${ok}`;
      oel.click(); await flush();
      driven++;
      // depth 2: if a new overlay replaced it, fill and click its primary button
      const pri = $$("#dialog-root .btn-default:not([disabled]), #drawer-root .btn-default:not([disabled])").find((e: any) => e.getAttribute("data-action"));
      if (pri) {
        fill("#dialog-root"); fill("#drawer-root"); await flush();
        const pri2 = $$("#dialog-root .btn-default:not([disabled]), #drawer-root .btn-default:not([disabled])").find((e: any) => e.getAttribute("data-action"));
        if (pri2) { ctx.where += ` > ${keyOf(pri2)}`; pri2.click(); await flush(); driven++; }
      }
      if (!$("#view") || !$("#view").innerHTML.trim()) t.errors.push({ where: ctx.where, msg: "#view empty after overlay click" });
    }
  }
}
await flush(50);
console.log(JSON.stringify({ routes: routes.length, pageFilledClicks: pageFilled, overlaysOpened: opened, overlayActionsDriven: driven }));
report("fuzz", t.errors, t.warnings);
try { await t.window.happyDOM.abort(); } catch {}
process.exit(0);
