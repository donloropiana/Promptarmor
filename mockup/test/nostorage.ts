import { boot, report } from "./load";
const t = boot({ noStorage: true });
const { App, $, go, click, flush } = t;
await flush(20);
const routes = ["#dashboard","#queue","#intake-triage","#intake-sources","#policies-rules","#reports","#members","#asset-A-101","#compare-A-103","#signin"];
for (const r of routes) { await go(r); t.expect($("#view").textContent.trim().length > 10, "renders without storage " + r); }
await click("#tb-theme");
await go("#asset-A-112"); await click('[data-action="wb-apply"]'); await click('[data-action="wb-apply-confirm"]');
t.expect(App.latestVersion(App.asset("A-112")).n === 2, "edit works without storage");
App.resetDemo(); await flush(30);
report("no-storage", t.errors, t.warnings);
process.exit(0);
