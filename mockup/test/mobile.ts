import { boot, report } from "./load";
const t = boot({ width: 400 });
const { App, $, $$, go, click, flush } = t;
await flush(20);
console.log("matchMedia 640:", t.w.matchMedia("(max-width: 640px)").matches, "innerWidth", t.w.innerWidth);
const routes = ["#dashboard","#queue","#intake-triage","#intake-new","#intake-sources","#policies-rules","#policies-offers","#policies-references","#reports","#members","#profile-prefs","#new-profile","#signin","#invite", ...App.assetsFor().map((a: any) => "#asset-" + a.id), ...App.assetsFor().map((a: any) => "#compare-" + a.id)];
let n = 0;
for (const r of routes) {
  await go(r);
  if (!$("#view").textContent.trim()) t.errors.push({ where: r, msg: "empty view" });
  const m = $('[data-action="app-sidebar-open"]');
  if (m) { await click(m); t.expect($("#app").classList.contains("sidebar-open"), "sidebar opens"); const nav = $('#sb-nav a[href="#queue"]'); if (nav) await click(nav); t.expect(!$("#app").classList.contains("sidebar-open"), "sidebar closes after nav"); }
  // click every tab-like action on mobile
  for (const el of $$('#view [data-action$="-tab"]')) { await go(r); const e2 = $$('#view [data-action$="-tab"]').find((x: any) => x.textContent === el.textContent); if (e2) { await click(e2); n++; } }
}
console.log("mobile routes", routes.length, "tab clicks", n);
report("mobile", t.errors, t.warnings);
process.exit(0);
