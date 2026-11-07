// Scripted end-to-end flows for the demo storyline. Usage: bun run scenario.ts
import { boot, report } from "./load";

const t = boot();
const { App, $, $$, go, click, setVal, expect, flush, ctx, viewText, document } = t;
const LONG = "Disclosure appears in the landing page footer and legal signed off on 2026-11-05 by email.";
const step = (s: string) => { ctx.where = s; process.stderr.write("· " + s + "\n"); };
const dlgOpen = () => !!$("#dialog-root .dialog, #dialog-root [role=dialog]");
const btnByText = (txt: string, scope = "") => ($$(`${scope} button`) as any[]).find((b) => (b.textContent || "").trim().startsWith(txt));
const fillDialog = () => {
  for (const s of $$("#dialog-root select")) { const o = Array.from(s.options).find((o: any) => o.value); if (o) setVal(s, (o as any).value); }
  for (const ta of $$("#dialog-root textarea")) if (!ta.value || ta.value.length < 45) setVal(ta, LONG);
  for (const cb of $$("#dialog-root input[type=checkbox]")) if (!cb.checked) setVal(cb, "1");
};

await flush(20);

// 1. Approve with exceptions on A-101 (open Critical findings, authored by Priya)
step("A-101 approve with exceptions");
App.resetDemo(); await flush();
await go("#asset-A-101");
await click('[data-action="wb-decide"]:not([data-mode="reject"])', "Approve button");
expect(dlgOpen(), "decision dialog opened");
expect(($("#dialog-root") as any).textContent.includes("Approve with exceptions"), "dialog is the exceptions variant");
expect(($("#wb-decide-go") as any)?.disabled, "confirm disabled before justification");
fillDialog(); await flush();
expect(!($("#wb-decide-go") as any)?.disabled, "confirm enabled after reasons + 40-char justification + attestation: " + ($("#wb-dlg-status") as any)?.textContent);
await click("#wb-decide-go");
expect(App.asset("A-101").status === "approved-with-exceptions", "A-101 status approved-with-exceptions (got " + App.asset("A-101").status + ")");
expect(App.state.notifications.some((n: any) => /exception/i.test(n.text || "")), "owner notified about exceptions");

// 1b. Self-approval with exceptions blocked when profile has >1 member (A-111/A-114 authored by Hannah)
step("A-114 self-approve (no findings)");
await go("#asset-A-114");
await click('[data-action="wb-decide"]:not([data-mode="reject"])', "Approve button");
expect(dlgOpen(), "self-approve dialog opened");
expect(($("#dialog-root") as any).textContent.includes("Self-approval"), "self-approval callout shown");
fillDialog(); await flush();
await click("#wb-decide-go");
const d114 = App.asset("A-114");
expect(d114.status === "approved", "A-114 approved (got " + d114.status + ")");
expect(/self/i.test(JSON.stringify(d114.decisions.slice(-1))), "self-approved decision recorded");

// 2. Request changes on A-106 (in-app checklist)
step("A-106 request changes");
await go("#asset-A-106");
await click('[data-action="wb-request"]', "Request changes");
let saveBtn: any = $('[data-action="rl-cr-save"]') || $('[data-action="wb-cr-save"]');
expect(saveBtn, "change request builder shown");
const addItem = $('#dialog-root [data-action="rl-cr-add"]');
expect(addItem, "Add finding to checklist button");
if (addItem) await click(addItem);
saveBtn = $('[data-action="rl-cr-save"]') || $('[data-action="wb-cr-save"]');
if (saveBtn && saveBtn.disabled) {
  // fill the builder's textareas/note, then check again
  for (const ta of $$("#view textarea, #dialog-root textarea, #drawer-root textarea")) if (!ta.value) setVal(ta, LONG);
  await flush();
  saveBtn = $('[data-action="rl-cr-save"]') || $('[data-action="wb-cr-save"]');
}
expect(saveBtn && !saveBtn.disabled, "save change request enabled");
if (saveBtn) await click(saveBtn);
expect(App.asset("A-106").status === "changes-requested", "A-106 changes-requested (got " + App.asset("A-106").status + ")");
const copyBtn = $('[data-action="rl-copy-cr"], [data-action="wb-cr-copy"], [data-action="rl-cr-copy"]');
if (copyBtn) { const n = t.clip.length; await click(copyBtn); await flush(); expect(t.clip.length > n, "Copy as text wrote to clipboard"); }

// 3. Apply suggestion on A-112 -> new version, recheck-ready
step("A-112 apply suggestion");
await go("#asset-A-112");
const vBefore = App.latestVersion(App.asset("A-112")).n;
await click('[data-action="wb-apply"]', "Apply suggestion");
await click('[data-action="wb-apply-confirm"]', "Apply as Vn");
const a112 = App.asset("A-112");
const v112 = App.latestVersion(a112);
expect(v112.n === vBefore + 1, "new version created (V" + v112.n + ")");
expect(v112.origin === "suggestion_applied", "origin suggestion_applied (got " + v112.origin + ")");
expect(a112.status === "recheck-ready", "status recheck-ready (got " + a112.status + ")");
expect(a112.versions[0].sha !== v112.sha, "fresh sha");

// 4. Edit copy on A-107
step("A-107 edit copy");
await go("#asset-A-107");
const before107 = App.latestVersion(App.asset("A-107")).n;
await click('[data-action="wb-edit-section"]', "Edit copy");
const ta = $("#dialog-root textarea");
expect(ta, "edit textarea");
if (ta) setVal(ta, ta.value + " Rates and terms subject to change.");
await click('[data-action="wb-edit-save"]', "Save as Vn");
const v107 = App.latestVersion(App.asset("A-107"));
expect(v107.n === before107 + 1 && v107.origin === "reviewer_edit", "reviewer_edit version created (" + v107.origin + ")");

// 5a. Visible "possible injection" on A-104 does not block
step("A-104 possible injection");
await go("#asset-A-104");
expect(/Possible injection/.test(viewText()), "possible-injection warning visible");
await click('[data-action="wb-decide"]:not([data-mode="reject"])', "Approve");
expect(dlgOpen(), "possible injection does not block decision dialog");
App.closeDialog(); await flush();
// 5. Hidden-text asset A-109: decision blocked until security alert acknowledged
step("A-109 security alert");
await go("#asset-A-109");
expect(/Security alert|hidden/i.test(viewText()), "security alert visible");
await click('[data-action="wb-decide"]:not([data-mode="reject"])', "Approve");
const blockedBeforeAck = !dlgOpen();
App.closeDialog(); await flush();
await click('[data-action="wb-ack"]', "Acknowledge");
if (dlgOpen()) { fillDialog(); const b = btnByText("Acknowledge", "#dialog-root") || $('#dialog-root .btn-default'); if (b) await click(b); }
await flush();
const v104 = App.latestVersion(App.asset("A-109"));
expect(v104.securityAlerts.every((s: any) => s.acknowledged || s.ackBy || s.acknowledgedBy), "security alert acknowledged: " + JSON.stringify(v104.securityAlerts[0]).slice(0, 200));
expect(blockedBeforeAck, "approve blocked before acknowledging");

// 6. Chat: ask to approve -> refuses
step("A-109 chat");
await go("#asset-A-109");
const chatTab = $('[data-action="wb-tab"][data-tab="chat"], [data-action="wb-tab"][data-id="chat"]');
if (chatTab) await click(chatTab);
const ci = $("#wb-chat-input");
expect(ci, "chat input present");
if (ci) {
  setVal(ci, "Can you approve this asset for me?");
  await click('[data-action="wb-chat-send"]');
  expect(/can.?t approve|cannot approve|never approve|not able to approve|only a member|won.?t approve|don.?t approve|do not approve/i.test(viewText()), "chat refuses to approve");
  setVal($("#wb-chat-input"), "What was the hidden text?");
  await click('[data-action="wb-chat-send"]');
  expect(/not as an instruction|treated it as (data|content)|as data/i.test(viewText()), "chat explains hidden text treated as data");
}

// 7. Connectors: Microsoft reconnect, Google disconnect + connect (two consent screens)
step("connect microsoft");
await go("#intake-sources");
await click('[data-action="src-connect"][data-group="microsoft"]', "Reconnect Microsoft");
let guard = 0;
while (dlgOpen() && guard++ < 12) {
  const next = $('#dialog-root [data-action="src-flow-next"], #dialog-root [data-action="src-flow-allow"], #dialog-root [data-action="src-flow-done"]');
  if (!next) { await flush(30); continue; }
  await click(next);
  await flush(30);
}
const ms = App.state.sources.filter((s: any) => ["outlook", "onedrive", "excel"].includes(s.provider));
expect(ms.every((s: any) => s.status === "connected" || s.status === "syncing" || s.status === "discovering"), "Microsoft sources connected: " + ms.map((s: any) => s.status).join(","));

step("connect google");
await go("#intake-sources");
await click('[data-action="src-more"][data-group="google"]');
const disc = $('#popover-root [data-action="src-disconnect"]');
expect(disc, "Disconnect Google in More menu");
if (disc) {
  await click(disc);
  const conf = $('#dialog-root [data-action="src-disconnect-confirm"]');
  if (conf) { fillDialog(); await click(conf); }
}
await go("#intake-sources");
const gc = $('[data-action="src-connect"][data-group="google"]');
expect(gc, "Connect Google button after disconnect");
let consentScreens = 0;
if (gc) {
  await click(gc);
  guard = 0;
  while (dlgOpen() && guard++ < 12) {
    if ($('#dialog-root [data-action="src-flow-allow"]')) consentScreens++;
    const next = $('#dialog-root [data-action="src-flow-next"], #dialog-root [data-action="src-flow-allow"], #dialog-root [data-action="src-flow-done"]');
    if (!next) { await flush(30); continue; }
    await click(next);
    await flush(30);
  }
}
expect(consentScreens === 2, "Google shows two consent screens (got " + consentScreens + ")");
const gs = App.state.sources.filter((s: any) => ["gmail", "google-drive", "google-sheets"].includes(s.provider));
expect(gs.every((s: any) => s.status === "connected"), "Google sources connected: " + gs.map((s: any) => s.status).join(","));

// 8. Intake triage: accept first item
step("intake accept");
await go("#intake-triage");
const qBefore = App.assetsFor().length;
const acc = $('[data-action="intake-confirm"]') || $('[data-action="intake-accept"]');
if (acc) {
  await click(acc);
  if (dlgOpen()) { fillDialog(); const b = $('#dialog-root [data-action="intake-accept"], #dialog-root .btn-default'); if (b) await click(b); }
} else expect(false, "no intake-accept button");
await flush(40);
expect(App.assetsFor().length >= qBefore, "accept did not lose assets");

// 9. Revision arrives: simulate on A-105 (changes requested) and accept match
step("A-105 accept matched revision");
await go("#asset-A-105");
const n105 = App.latestVersion(App.asset("A-105")).n;
await click('[data-action="rl-accept-match"]', "Accept as Vn and compare");
if (dlgOpen()) { fillDialog(); const b = $('#dialog-root .btn-default'); if (b) await click(b); }
expect(App.latestVersion(App.asset("A-105")).n === n105 + 1, "A-105 revision accepted as new version");
expect(App.current().name === "compare" || App.asset("A-105").status === "recheck-ready", "A-105 moves to compare/recheck-ready (" + App.current().name + ", " + App.asset("A-105").status + ")");
step("A-102 simulate revision");
await go("#asset-A-102");
const n102 = App.latestVersion(App.asset("A-102")).n;
await click('[data-action="rl-simulate"]', "Simulate revision");
await flush(40);
if (App.latestVersion(App.asset("A-102")).n === n102) {
  await go("#asset-A-102");
  const accm = $('[data-action="rl-accept-match"]');
  expect(accm, "simulated revision shows Accept match");
  if (accm) { await click(accm); if (dlgOpen()) { fillDialog(); const b = $('#dialog-root .btn-default'); if (b) await click(b); } }
}
expect(App.latestVersion(App.asset("A-102")).n === n102 + 1, "A-102 revision accepted");

// 10. Policies: edit a rule with change reason
step("policies edit rule");
await go("#policies-rules");
const openRule = $('[data-action="pol-open-rule"]');
if (openRule) await click(openRule);
const er = $('[data-action="pol-rule-edit"]');
expect(er, "Edit rule button");
if (er) {
  const rid = er.getAttribute("data-rule-id");
  const vBeforeR = App.ruleById(rid) && (App.ruleById(rid).versions || []).length;
  await click(er);
  for (const tx of $$("#view textarea, #drawer-root textarea, #dialog-root textarea")) setVal(tx, (tx.value || "") + " Updated after counsel review.");
  for (const ip of $$("#view input[type=text], #drawer-root input[type=text], #dialog-root input[type=text]")) if (/reason/i.test(ip.id)) setVal(ip, "Counsel asked to tighten trigger term wording.");
  await flush();
  const sv = $("#pol-rule-save-btn");
  expect(sv && !sv.disabled, "rule save enabled after reason");
  if (sv) await click(sv);
  if (dlgOpen()) { fillDialog(); const b = $('#dialog-root .btn-default'); if (b) await click(b); }
  const vAfterR = App.ruleById(rid) && (App.ruleById(rid).versions || []).length;
  expect(vAfterR === vBeforeR + 1, `rule ${rid} new version (${vBeforeR} -> ${vAfterR})`);
}

// 11. Members: invite by email
step("members invite");
await go("#members");
const invBefore = App.profile().invites.length;
await click('[data-action="mem-invite"]');
const em = $("#dialog-root input[type=email]") || $("#dialog-root input");
if (em) setVal(em, "new.reviewer@clearpath.example");
await click('[data-action="mem-invite-submit"]');
expect(App.profile().invites.length === invBefore + 1, "invite added");
// partner domain refused
await click('[data-action="mem-invite"]');
const partner = App.profile().partners[0];
const em2 = $("#dialog-root input[type=email]") || $("#dialog-root input");
if (em2 && partner && partner.contactEmail) { setVal(em2, "someone@" + partner.contactEmail.split("@")[1]); await click('[data-action="mem-invite-submit"]'); expect(App.profile().invites.length === invBefore + 1, "partner email refused as member"); }
App.closeDialog();

// 12. Profile isolation: switch to Sandbox, asset A-105 must be Not found
step("profile isolation");
await go("#dashboard");
await click('[data-action="app-profile-switcher"]');
const sw = $$('#popover-root [data-action="app-switch-profile"]').find((e: any) => e.getAttribute("data-profile-id") === "p-sandbox");
expect(sw, "Sandbox in profile switcher");
if (sw) await click(sw);
expect(App.profile().id === "p-sandbox", "switched to sandbox");
await go("#asset-A-105");
expect($("#view .notfound"), "A-105 not found from Sandbox");
for (const r of ["#dashboard", "#queue", "#intake-triage", "#intake-sources", "#policies-rules", "#policies-offers", "#reports", "#members", "#profile-prefs"]) {
  await go(r);
  expect(($("#view") as any).textContent.trim().length > 10, "sandbox renders " + r);
  expect(!/This screen failed/.test(viewText()), "no render error on sandbox " + r);
}

// 13. Sign-in flows
step("signin");
App.resetDemo(); await flush();
await go("#signin");
const signText = viewText();
expect(/Google/.test(signText) && /password/i.test(signText), "sign-in offers Google + password");
for (const a of ["si-google", "si-demo"]) { await go("#signin"); const b = $(`[data-action="${a}"]`); if (b) await click(b); }

// 14. Theme cycle
step("theme");
await go("#dashboard");
for (let i = 0; i < 3; i++) await click("#tb-theme");
expect(!document.documentElement.getAttribute("data-theme"), "theme back to system after 3 clicks");

// 15. Queue grouping by partner and campaign
step("queue group");
await go("#queue");
const groupCtl = $('[data-change="queue-group"], select#queue-group, [data-action="queue-group"]');
expect(groupCtl, "queue group-by control present");

// 16. Keyboard: '?' overlay
step("shortcuts");
await go("#dashboard");
document.dispatchEvent(new t.w.KeyboardEvent("keydown", { key: "?", bubbles: true }));
await flush();
expect(dlgOpen() || $("#popover-root *") || /shortcut/i.test(document.body.textContent), "? opens shortcut overlay");
App.closeDialog();

// 17. Reset
step("reset");
App.resetDemo(); await flush();
expect(App.asset("A-101").status === "needs-review", "reset restores A-101");

await flush(50);
report("scenario", t.errors, t.warnings);
try { await t.window.happyDOM.abort(); } catch {}
process.exit(0);
