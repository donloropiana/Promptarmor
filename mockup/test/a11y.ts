import { boot, report } from "./load";
const t = boot();
const { App, $, $$, go, flush, document } = t;
await flush(20);
const routes = ["#dashboard","#queue","#intake-triage","#intake-new","#intake-sources","#policies-rules","#policies-offers","#policies-references","#reports","#members","#profile-prefs","#new-profile","#signin","#invite", ...App.assetsFor().map((a: any) => "#asset-" + a.id), ...App.assetsFor().map((a: any) => "#compare-" + a.id)];
const tagCounts: Record<string, Set<string>> = {};
const unlabeled = new Set<string>();
const unwrappedTables = new Set<string>();
const dupIds = new Set<string>();
const noTypeButtons = new Set<string>();
for (const r of routes) {
  await go(r);
  for (const el of $$("[data-action]")) {
    const tg = el.tagName.toLowerCase();
    if (!["button", "a"].includes(tg)) (tagCounts[tg] ||= new Set()).add(el.getAttribute("data-action"));
  }
  for (const el of $$("#view input, #view textarea, #view select")) {
    if (el.type === "hidden") continue;
    const id = el.id;
    const lab = id && document.querySelector(`label[for="${id}"]`);
    const wrapped = el.closest("label");
    const aria = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
    if (!lab && !wrapped && !aria) unlabeled.add(r.replace(/A-\d+/, "A-x") + " " + el.tagName.toLowerCase() + "#" + (id || "(no id)") + "[" + (el.type || "") + "]");
    if (!id) unlabeled.add(r.replace(/A-\d+/, "A-x") + " missing id: " + el.tagName.toLowerCase() + " name=" + el.name);
  }
  for (const tb of $$("#view table")) {
    let p = tb.parentElement, ok = false;
    while (p && p.id !== "view") { const c = p.className || ""; if (/table-wrap|scroll-x|overflow|wrap/.test(c) || /overflow/.test(p.getAttribute("style") || "")) { ok = true; break; } p = p.parentElement; }
    if (!ok) unwrappedTables.add(r + " table." + tb.className);
  }
  const ids = $$("[id]").map((e: any) => e.id);
  const seen = new Set<string>();
  for (const id of ids) { if (seen.has(id)) dupIds.add(r.replace(/A-\d+/, "A-x") + " #" + id); seen.add(id); }
  for (const b of $$("button")) if (!b.getAttribute("type")) noTypeButtons.add(r + " " + (b.textContent || "").trim().slice(0, 30));
}
console.log("non-button data-action tags:", Object.fromEntries(Object.entries(tagCounts).map(([k, v]) => [k, [...v]])));
console.log("unlabeled inputs:", [...unlabeled].slice(0, 40));
console.log("tables not in overflow wrapper:", [...unwrappedTables].slice(0, 20));
console.log("duplicate ids:", [...dupIds].slice(0, 30));
console.log("buttons without type:", [...noTypeButtons].slice(0, 10), noTypeButtons.size);
report("a11y", t.errors, t.warnings);
process.exit(0);
