import { boot, report } from "./load";
const a = boot();
await a.flush(20);
await a.go("#asset-A-112"); await a.click('[data-action="wb-apply"]'); await a.click('[data-action="wb-apply-confirm"]');
await a.click("#tb-theme");
a.w.dispatchEvent(new a.w.Event("pagehide"));
await a.flush(30);
const saved: Record<string, string> = {};
for (let i = 0; i < a.w.localStorage.length; i++) { const k = a.w.localStorage.key(i); saved[k] = a.w.localStorage.getItem(k); }
console.log("keys", Object.keys(saved), "bytes", (saved["cw-demo-v1"] || "").length);
const b = boot({ preStorage: saved });
await b.flush(20);
b.expect(b.App.latestVersion(b.App.asset("A-112")).n === 2, "A-112 V2 restored from storage");
for (const r of ["#dashboard", "#queue", "#asset-A-112", "#compare-A-112", "#reports"]) { await b.go(r); b.expect(b.$("#view").textContent.trim().length > 10, "restored render " + r); }
report("persist-A", a.errors, a.warnings);
report("persist-B", b.errors, b.warnings);
process.exit(0);
