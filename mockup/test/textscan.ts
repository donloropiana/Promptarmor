import { boot } from "./load";
const t = boot();
const { App, $$, go, flush } = t;
await flush(20);
const routes = ["#dashboard","#queue","#intake-triage","#intake-new","#intake-sources","#policies-rules","#policies-offers","#policies-references","#reports","#members","#profile-prefs","#new-profile","#signin","#invite", ...App.assetsFor().map((a: any) => "#asset-" + a.id), ...App.assetsFor().map((a: any) => "#compare-" + a.id)];
const re = /[^.]{0,80}\b(repl(y|ies|ied)|forward\w*|resend|inbound|portal|domain|notif\w* by email|email notif\w*|we('ll| will)? (send|email)|sends? (an )?email|sent to (the )?submitter|emails? (the )?(submitter|partner|agency))\b[^.]{0,80}/gi;
const hits = new Map<string, Set<string>>();
for (const r of routes) {
  await go(r);
  const txt = (t.document as any).body.textContent.replace(/\s+/g, " ");
  for (const m of txt.matchAll(re)) { const k = m[0].trim(); if (!hits.has(k)) hits.set(k, new Set()); hits.get(k)!.add(r); }
}
for (const [k, v] of hits) console.log("-", k, " @", [...v].slice(0, 3).join(","));
process.exit(0);
