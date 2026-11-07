/* admin.js: Reports, Members & invites, Profile settings, Sign-in, Invite acceptance, New profile.
   Routes: reports, members, profile-prefs, new-profile, signin (chromeless), invite (chromeless).
   Email scope: the only emails mentioned here are sign-in emails (link, code, password reset,
   member invite) sent by the auth system. Nothing else is sent. */
(function () {
  'use strict';
  var A = window.App, ui = A.ui, esc = A.esc;
  var DAY = 86400e3;

  /* ------------------------------------------------------------------ */
  /* Module CSS (tokens only)                                            */
  /* ------------------------------------------------------------------ */
  var CSS = `
.adm-auth { display: flex; justify-content: center; padding-bottom: 24px; }
.adm-auth-col { width: 100%; max-width: 400px; display: flex; flex-direction: column; gap: 14px; }
.adm-brand { display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; font-size: 14px; letter-spacing: -0.01em; }
.adm-auth-title { font-size: 18px; font-weight: 600; letter-spacing: -0.015em; line-height: 1.3; }
.adm-auth-sub { font-size: 13px; color: var(--muted-foreground); overflow-wrap: anywhere; }
.adm-or { display: flex; align-items: center; gap: 10px; color: var(--muted-foreground); font-size: 12px; }
.adm-or::before, .adm-or::after { content: ''; flex: 1 1 auto; height: 1px; background: var(--border); }
.adm-big-icon { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--muted); color: var(--muted-foreground); }
.adm-code { display: flex; gap: 8px; justify-content: space-between; }
.adm-code .input { flex: 1 1 0; min-width: 0; max-width: 52px; height: 48px; padding: 0; text-align: center; font: 600 20px/1 var(--font-mono); }
.adm-demo { border: 1px dashed var(--border); border-radius: var(--radius-lg); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; background: color-mix(in oklch, var(--muted) 40%, transparent); }
.adm-demo-title { font: 500 11px/1 var(--font-mono); color: var(--muted-foreground); }
.adm-def { display: inline-flex; color: var(--muted-foreground); cursor: help; border-radius: 999px; }
.adm-def svg.i { width: 13px; height: 13px; }
.adm-chart { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 6px; margin-top: 6px; }
.adm-bars { height: 84px; display: flex; align-items: flex-end; gap: 2px; border-top: 1px dashed var(--border); border-bottom: 1px solid var(--border); }
.adm-col { flex: 1 1 0; height: 100%; display: flex; align-items: flex-end; justify-content: center; padding: 0 3px; min-width: 0; }
.adm-bar { display: block; width: 100%; max-width: 30px; min-height: 2px; background: var(--chart-2); border-radius: 4px 4px 0 0; }
.adm-col:hover .adm-bar { background: var(--chart-3); }
.adm-bar.is-current, .adm-col:hover .adm-bar.is-current { background: var(--foreground); }
.adm-yaxis { height: 84px; display: flex; flex-direction: column; justify-content: space-between; font: 500 10.5px/1 var(--font-mono); color: var(--muted-foreground); text-align: right; }
.adm-yaxis span:first-child { transform: translateY(-50%); }
.adm-yaxis span:last-child { transform: translateY(50%); }
.adm-xaxis { display: flex; gap: 2px; padding-top: 5px; font: 500 10.5px/1.2 var(--font-sans); color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
.adm-xaxis span { flex: 1 1 0; min-width: 0; text-align: center; }
.adm-just { white-space: normal; max-width: 380px; min-width: 220px; font-size: 12.5px; }
.table tbody tr.adm-row-declined td { background: color-mix(in oklch, var(--danger-bg) 75%, transparent); }
.adm-tipwrap { display: inline-flex; border-radius: var(--radius-sm); }
.adm-budget { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.adm-meter-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 12.5px; }
.adm-switch-row { display: flex; align-items: flex-start; gap: 12px; }
.adm-switch-row .switch { margin-top: 2px; }
@media (min-width: 1000px) { .adm-members-table .table-wrap { overflow: visible; } }
@media (max-width: 860px) { .adm-budget { grid-template-columns: minmax(0, 1fr); } }
`;
  function ensureStyle() {
    try {
      if (!document.head || document.querySelector('style[data-module="admin.js"]')) return;
      var s = document.createElement('style');
      s.setAttribute('data-module', 'admin.js');
      s.textContent = CSS;
      document.head.appendChild(s);
    } catch (e) { /* styling is optional */ }
  }
  ensureStyle();

  /* ------------------------------------------------------------------ */
  /* Screen-local state (in memory)                                      */
  /* ------------------------------------------------------------------ */
  function freshSi() {
    return { tab: 'email', stage: 'enter', email: null, expired: false, error: null, lastSentMs: 0, focusCode: false };
  }
  function freshState() {
    return {
      rep: { kpiView: 'charts', auditAsset: null, auditKind: 'all', ledgerScope: 'all' },
      si: freshSi(),
      inv: { variant: 'match', inviteId: null },
      np: { error: null }
    };
  }
  var st = freshState();
  A.on('reset', function () { st = freshState(); });
  A.on('route-changed', function (r) {
    if (!r || r.name !== 'signin') st.si = freshSi(); // each visit to sign-in starts clean
  });
  A.on('profile-changed', function () { st.rep.auditAsset = null; st.rep.auditKind = 'all'; });

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */
  var PRODUCT = { personal_loan: 'Personal loan', credit_card: 'Credit card', mortgage: 'Mortgage' };
  var CHANNEL = {
    paid_social: 'Paid social', display: 'Display', email: 'Email', affiliate_post: 'Affiliate post', direct_mail: 'Direct mail',
    landing_page: 'Landing page', sms: 'SMS', paid_search: 'Paid search'
  };
  function human(map, v) { return v ? (map[v] || String(v).replace(/[_-]/g, ' ')) : null; }
  function S() { return A.state; }
  function nowIso() { return A.nowIso(); }
  function plusDaysIso(days) { return new Date(A.nowMs() + days * DAY).toISOString(); }
  function fmtInt(n) { return (Number(n) || 0).toLocaleString('en-US'); }
  function pct(x) { return Math.round((Number(x) || 0) * 100) + '%'; }
  function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim()); }
  function findUserByEmail(email) {
    var e = String(email || '').trim().toLowerCase();
    return S().users.find(function (u) { return String(u.email || '').toLowerCase() === e; }) || null;
  }
  function nameFromEmail(email) {
    var local = String(email || '').split('@')[0] || 'New member';
    return local.split(/[._-]+/).filter(Boolean).map(function (p) {
      return p.length === 1 ? p.toUpperCase() + '.' : p.charAt(0).toUpperCase() + p.slice(1);
    }).join(' ') || 'New member';
  }
  function metricsOwner() { return (S().metrics && S().metrics.profileId) || 'p-clearpath'; }
  function profileById(id) { return S().profiles.find(function (p) { return p.id === id; }) || null; }
  function pageHeader(title, desc, actionsHtml, eyebrowHtml) {
    return '<div class="page-header"><div class="page-heading">' + (eyebrowHtml ? '<div class="page-eyebrow">' + eyebrowHtml + '</div>' : '') +
      '<h1 class="page-title">' + esc(title) + '</h1>' + (desc ? '<p class="page-desc">' + desc + '</p>' : '') + '</div>' +
      (actionsHtml ? '<div class="page-actions">' + actionsHtml + '</div>' : '') + '</div>';
  }
  function sectionHeader(title, desc, actionsHtml, extraTitleHtml) {
    return '<div class="section-header"><div class="stack stack-sm"><h2 class="section-title">' + esc(title) + (extraTitleHtml || '') + '</h2>' +
      (desc ? '<p class="section-desc">' + desc + '</p>' : '') + '</div>' + (actionsHtml ? '<div class="toolbar">' + actionsHtml + '</div>' : '') + '</div>';
  }
  function toneBadge(tone, iconName, label, title) {
    return '<span class="badge tone tone-' + tone + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + A.icon(iconName) + '<span>' + esc(label) + '</span></span>';
  }
  // A disabled control plus the reason, readable on hover, on keyboard focus, and visibly next to it.
  function withTip(html, tip) {
    return '<span class="adm-tipwrap" tabindex="0" role="note" data-tip="' + esc(tip) + '" data-tip-pos="left" title="' + esc(tip) + '" aria-label="' + esc(tip) + '">' + html + '</span>';
  }
  function brand() {
    return '<div class="adm-brand"><span class="wordmark-mark" aria-hidden="true">' + A.icon('shield-check') + '</span><span>Compliance Workbench</span></div>';
  }

  /* ================================================================== */
  /* REPORTS                                                             */
  /* ================================================================== */
  var KPIS = [
    { key: 'medianActiveMinutes', label: 'Median active review time', unit: 'min', fmt: function (v) { return Number(v).toFixed(1); },
      def: 'Median minutes a reviewer actively worked on an asset before deciding. Idle time is not counted.' },
    { key: 'firstPassRate', label: 'First-pass approval rate', unit: '', fmt: pct, axis: pct,
      def: 'Share of decided assets approved on their first version, with no change request.' },
    { key: 'avgRounds', label: 'Average rounds per asset', unit: 'rounds', fmt: function (v) { return Number(v).toFixed(1); },
      def: 'Change-request rounds before the final decision. An asset approved the first time counts as 0.' },
    { key: 'decided', label: 'Assets decided', unit: 'assets', fmt: function (v) { return String(v); },
      def: 'Assets approved, approved with exceptions, or rejected during the week.' },
    { key: 'exceptions', label: 'Approvals with exceptions', unit: '', fmt: function (v) { return String(v); },
      def: 'Approvals recorded with at least one accepted exception and a written justification.' },
    { key: 'aiSpendUsd', label: 'AI spend', unit: '', fmt: function (v) { return ui.money(v); }, axis: function (v) { return '$' + Number(v).toFixed(2); },
      def: 'Total cost of preflight, recheck, intake classification and asset-question runs in the cost ledger.' }
  ];
  function niceMax(v) {
    if (!(v > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10)), n = v / p;
    var m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return m * p;
  }
  function weekLabel(d) { var m = /^\d{4}-(\d{2})-(\d{2})$/.exec(d || ''); return m ? parseInt(m[1], 10) + '/' + parseInt(m[2], 10) : String(d || ''); }
  function kpiChart(k, weekly) {
    var vals = weekly.map(function (w) { return Number(w[k.key]) || 0; });
    var max = niceMax(Math.max.apply(null, vals.concat([0])));
    var axisFmt = k.axis || k.fmt;
    var summary = k.label + ', weekly: ' + weekly.map(function (w, i) { return 'week of ' + ui.date(w.weekOf) + ' ' + k.fmt(vals[i]) + (k.unit ? ' ' + k.unit : ''); }).join('; ');
    var cols = weekly.map(function (w, i) {
      var h = max > 0 ? Math.max(0, Math.min(100, vals[i] / max * 100)) : 0;
      var tip = 'Week of ' + ui.date(w.weekOf) + ': ' + k.fmt(vals[i]) + (k.unit ? ' ' + k.unit : '');
      return '<span class="adm-col" data-tip="' + esc(tip) + '"><span class="adm-bar' + (i === weekly.length - 1 ? ' is-current' : '') + '" style="height:' + h.toFixed(1) + '%"></span></span>';
    }).join('');
    return '<div class="adm-chart" role="img" aria-label="' + esc(summary) + '">' +
      '<div class="adm-bars" aria-hidden="true">' + cols + '</div>' +
      '<div class="adm-yaxis" aria-hidden="true"><span>' + esc(axisFmt(max)) + '</span><span>0</span></div>' +
      '<div class="adm-xaxis" aria-hidden="true">' + weekly.map(function (w) { return '<span>' + esc(weekLabel(w.weekOf)) + '</span>'; }).join('') + '</div><span></span>' +
      '</div>';
  }
  function kpiCard(k, weekly) {
    var last = weekly[weekly.length - 1] || {};
    return '<div class="card"><div class="card-body stack stack-sm">' +
      '<div class="row between"><span class="tile-label">' + esc(k.label) +
        ' <span class="adm-def" tabindex="0" data-tip="' + esc(k.def) + '" aria-label="' + esc('Definition: ' + k.def) + '">' + A.icon('info') + '</span></span>' + ui.sample() + '</div>' +
      '<div class="tile-value">' + esc(k.fmt(last[k.key])) + (k.unit ? '<span class="unit">' + esc(k.unit) + '</span>' : '') + '</div>' +
      '<div class="tile-meta">Week of ' + esc(ui.date(last.weekOf)) + ' · bars show the last ' + weekly.length + ' weeks</div>' +
      kpiChart(k, weekly) +
      '</div></div>';
  }
  function kpiTable(weekly) {
    return ui.table([
      { key: 'weekOf', label: 'Week of', render: function (w) { return esc(ui.date(w.weekOf)); } },
      { key: 'decided', label: 'Decided', align: 'right' },
      { key: 'medianActiveMinutes', label: 'Median active min', align: 'right', render: function (w) { return esc(Number(w.medianActiveMinutes).toFixed(1)); } },
      { key: 'firstPassRate', label: 'First-pass rate', align: 'right', render: function (w) { return esc(pct(w.firstPassRate)); } },
      { key: 'avgRounds', label: 'Avg rounds', align: 'right', render: function (w) { return esc(Number(w.avgRounds).toFixed(1)); } },
      { key: 'exceptions', label: 'Exceptions', align: 'right' },
      { key: 'aiSpendUsd', label: 'AI spend', align: 'right', render: function (w) { return esc(ui.money(w.aiSpendUsd)); } }
    ], weekly.slice().reverse(), { dense: true, caption: 'KPI history by week (sample values)' });
  }
  function weeklyData() {
    var m = S().metrics || {};
    if (S().activeProfileId !== metricsOwner()) return [];
    return Array.isArray(m.weekly) ? m.weekly : [];
  }
  function periodCsv(weekly) {
    return A.csv(weekly, [
      { key: 'weekOf', label: 'week_of' }, { key: 'decided', label: 'assets_decided' },
      { key: 'medianActiveMinutes', label: 'median_active_minutes' }, { key: 'firstPassRate', label: 'first_pass_rate' },
      { key: 'avgRounds', label: 'avg_rounds' }, { key: 'exceptions', label: 'approvals_with_exceptions' }, { key: 'aiSpendUsd', label: 'ai_spend_usd' },
      { label: 'sample', value: function () { return 'yes'; } }
    ]);
  }

  // Exceptions log: one row per accepted exception on an approval.
  function exceptionRows() {
    var rows = [];
    A.assetsFor().forEach(function (a) {
      (a.decisions || []).forEach(function (d) {
        if (d.decision !== 'approved-with-exceptions') return;
        var v = A.version(a, d.versionId);
        (d.exceptions || []).forEach(function (x) {
          var f = v ? (v.findings || []).find(function (ff) { return ff.id === x.findingId; }) : null;
          var rule = f ? A.ruleById(f.ruleId) : null;
          var approver = A.userById(d.approverId);
          rows.push({
            at: d.at, assetId: a.id, title: a.title, versionN: v ? v.n : null, sha: d.sha || (v && v.sha), findingId: x.findingId,
            severity: f ? f.severity : null, ruleId: f ? f.ruleId : null, ruleTitle: rule ? rule.title : (f && f.title) || '',
            reason: x.reason, text: x.text, approver: approver ? approver.name : (d.approverId || 'Unknown'), selfApproved: !!d.selfApproved
          });
        });
      });
    });
    rows.sort(function (x, y) { return A.toMs(y.at) - A.toMs(x.at); });
    return rows;
  }

  // Cost ledger rows for the active profile, plus declined runs recorded on versions.
  function runIndex() {
    var idx = {};
    A.assetsFor().forEach(function (a) { (a.versions || []).forEach(function (v) { if (v.run && v.run.id) idx[v.run.id] = { asset: a, version: v }; }); });
    return idx;
  }
  function runKind(runId, idx) {
    var id = String(runId || '');
    if (/^Q-/.test(id)) return 'Asset question';
    if (/^C-/.test(id)) return 'Intake classification';
    var hit = idx[id];
    if (hit) return hit.version.n > 1 ? 'Recheck' : 'Preflight';
    return 'Preflight';
  }
  function ledgerRows() {
    var pid = S().activeProfileId, owner = metricsOwner(), idx = runIndex();
    var rows = (S().costLedger || []).filter(function (r) {
      if (r.profileId) return r.profileId === pid;
      if (r.assetId) return !!A.asset(r.assetId);
      return pid === owner;
    }).map(function (r) {
      var hit = idx[r.runId];
      return {
        at: r.at, runId: r.runId, assetId: r.assetId, model: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: r.costUsd,
        cached: !!r.cached, reusedFrom: hit && hit.version.run ? hit.version.run.reusedFrom : null, kind: runKind(r.runId, idx), status: 'charged'
      };
    });
    A.assetsFor().forEach(function (a) {
      (a.versions || []).forEach(function (v) {
        if (v.run && v.run.status === 'failed' && /cap/i.test(v.run.failReason || '')) {
          rows.push({ at: v.createdAt, runId: v.run.id, assetId: a.id, model: v.run.model, tokensIn: 0, tokensOut: 0, costUsd: 0, kind: v.n > 1 ? 'Recheck' : 'Preflight', status: 'declined', note: 'Run declined: would exceed cap' });
        }
      });
    });
    rows.sort(function (x, y) { return A.toMs(y.at) - A.toMs(x.at); });
    return rows;
  }
  function isToday(iso) { return ui.date(iso) === ui.date(nowIso()); }
  function ledgerTable(rows, model) {
    var example = { example: true, runId: null, kind: 'Preflight', assetId: null, model: model, tokensIn: 0, tokensOut: 0, costUsd: 0, status: 'declined',
      note: 'Run declined: would exceed cap. The estimate is checked before the call; the asset goes to Needs manual review.' };
    var shown = rows.slice();
    if (st.rep.ledgerScope !== 'today') shown.unshift(example);
    return ui.table([
      { key: 'at', label: 'Time', render: function (r) { return r.example ? ui.tag('example', { title: 'Example row showing how a declined run is recorded' }) : '<span class="nowrap" title="' + esc(ui.relTime(r.at)) + '">' + esc(ui.time(r.at)) + '</span>'; } },
      { key: 'runId', label: 'Run', render: function (r) { return r.runId ? '<span class="mono small">' + esc(r.runId) + '</span>' : '<span class="muted">—</span>'; } },
      { key: 'kind', label: 'Kind', render: function (r) { return '<span class="nowrap">' + esc(r.kind) + '</span>'; } },
      { key: 'assetId', label: 'Asset', render: function (r) {
        if (r.assetId && A.asset(r.assetId)) return '<a href="#asset-' + esc(r.assetId) + '" class="mono small">' + esc(r.assetId) + '</a>';
        return r.kind === 'Intake classification' ? '<span class="muted small">Intake</span>' : '<span class="muted">—</span>';
      } },
      { key: 'model', label: 'Model', render: function (r) { return '<span class="mono xs nowrap">' + esc(r.model || '—') + '</span>'; } },
      { key: 'tokensIn', label: 'Tokens in', align: 'right', render: function (r) { return esc(fmtInt(r.tokensIn)); } },
      { key: 'tokensOut', label: 'Tokens out', align: 'right', render: function (r) { return esc(fmtInt(r.tokensOut)); } },
      { key: 'costUsd', label: 'Cost', align: 'right', render: function (r) { return esc(ui.money(r.costUsd)); } },
      { key: 'cached', label: 'Cached / reused', render: function (r) {
        if (!r.cached && !r.reusedFrom) return '<span class="muted">—</span>';
        return ui.tag(r.reusedFrom ? 'reused ' + r.reusedFrom : 'cached', { icon: 'refresh', title: 'Result reused from an identical earlier run. No new model call.' });
      } },
      { key: 'status', label: 'Status', render: function (r) {
        if (r.status === 'declined') return '<div class="stack stack-sm">' + toneBadge('red', 'circle-slash', 'Declined') + '<span class="xs muted adm-just" style="min-width:180px">' + esc(r.note) + '</span></div>';
        return '<span class="small muted">Charged</span>';
      } }
    ], shown, {
      dense: true, caption: 'AI cost ledger',
      rowAttrs: function (r) { return r.status === 'declined' ? { 'class': 'adm-row-declined' } : null; },
      empty: st.rep.ledgerScope === 'declined' ? 'No declined runs.' : 'No AI runs yet for this profile.'
    });
  }

  // Audit log
  function auditTargets() {
    var list = A.assetsFor().slice().sort(function (x, y) { return x.id < y.id ? -1 : 1; });
    var opts = list.map(function (a) { return { value: a.id, label: a.id + ' · ' + a.title }; });
    opts.push({ value: 'profile', label: 'Profile activity (members, settings, policies)' });
    return opts;
  }
  function auditTarget() {
    var t = st.rep.auditAsset;
    if (t === 'profile') return t;
    if (t && A.asset(t)) return t;
    if (A.asset('A-103')) return 'A-103';
    var first = A.assetsFor()[0];
    return first ? first.id : 'profile';
  }
  function auditEvents(target) {
    if (target === 'profile') { var p = A.profile(); return (p && Array.isArray(p.events)) ? p.events : []; }
    var a = A.asset(target);
    return a ? (a.events || []) : [];
  }
  function eventsCsv(target, events) {
    return A.csv(events.map(function (e, i) { return { seq: i + 1, at: e.at, actor: e.actor, kind: e.kind, text: e.text }; }),
      [{ key: 'seq', label: 'seq' }, { key: 'at', label: 'at' }, { key: 'actor', label: 'actor' }, { key: 'kind', label: 'kind' }, { key: 'text', label: 'details' }]);
  }
  function addMonthsDate(iso, months) {
    var ms = A.toMs(iso); if (isNaN(ms)) return null;
    var d = new Date(ms); d.setUTCMonth(d.getUTCMonth() + months);
    return d.toISOString().slice(0, 10);
  }
  function auditPacket(a) {
    var p = A.profileOf(a), meU = A.me();
    var rules = {}, offers = {};
    var versions = (a.versions || []).map(function (v) {
      (v.findings || []).forEach(function (f) {
        var r = A.ruleById(f.ruleId); if (!r) return;
        var rv = A.ruleVersion(r, f.ruleVersion != null ? f.ruleVersion : undefined);
        var key = f.ruleId + ' v' + (rv ? rv.v : f.ruleVersion);
        if (!rules[key]) {
          rules[key] = {
            ruleId: f.ruleId, version: rv ? rv.v : f.ruleVersion, title: r.title, text: rv ? rv.text : null,
            references: (r.referenceIds || []).map(function (id) { var ref = A.referenceById(id); return ref ? ref.citation : id; })
          };
        }
      });
      ((v.run && v.run.offerSnapshot) || []).forEach(function (s) {
        var m = /^(\S+)\s+v(\d+)$/.exec(String(s)); if (!m || offers[s]) return;
        var o = A.offerById(m[1]), ov = o ? A.offerVersion(o, parseInt(m[2], 10)) : null;
        offers[s] = { offerId: m[1], version: parseInt(m[2], 10), name: o ? o.name : null, effectiveFrom: ov ? ov.effectiveFrom : null, effectiveTo: ov ? ov.effectiveTo || null : null, terms: ov ? ov.terms : null };
      });
      var c = v.content || {};
      return {
        id: v.id, n: v.n, createdAt: v.createdAt, origin: v.origin, originLabel: A.labels.ORIGIN[v.origin] || v.origin, author: v.authorName, sha: v.sha,
        latest: v.id === a.latestVersionId, approved: v.id === a.approvedVersionId,
        content: { format: c.format, subject: c.subject || null, sections: (c.sections || []).map(function (s) { return { id: s.id, label: s.label, text: s.text }; }) },
        run: v.run ? {
          id: v.run.id, model: v.run.model, status: v.run.status, tokensIn: v.run.tokensIn, tokensOut: v.run.tokensOut, costUsd: v.run.costUsd,
          seeded: !!v.run.seeded, reusedFrom: v.run.reusedFrom || null, offerSnapshot: v.run.offerSnapshot || [], coverage: v.run.coverage || null, failReason: v.run.failReason || null
        } : null,
        findings: (v.findings || []).map(function (f) {
          return {
            id: f.id, carriedFrom: f.carriedFrom || null, ruleId: f.ruleId, ruleVersion: f.ruleVersion, severity: f.severity, evidenceType: f.evidenceType,
            sectionId: f.sectionId || null, quote: f.quote || null, verifiedSpan: f.verifiedSpan !== false, recheck: f.recheck || null,
            disposition: f.disposition || 'open', dispositionNote: f.dispositionNote || null
          };
        }),
        checklist: v.checklist || [],
        securityAlerts: (v.securityAlerts || []).map(function (s) {
          return { kind: s.kind, how: s.how || null, textTreatedAsData: s.text || null, acknowledged: !!s.acknowledged, acknowledgedBy: s.acknowledgedBy || null, acknowledgedAt: s.acknowledgedAt || null };
        })
      };
    });
    var decisions = (a.decisions || []).map(function (d) {
      var u = A.userById(d.approverId), v = A.version(a, d.versionId);
      return {
        id: d.id, decision: d.decision, versionId: d.versionId, versionN: v ? v.n : null, sha: d.sha, at: d.at,
        approver: u ? { name: u.name, email: u.email } : { id: d.approverId }, authMethod: 'Google sign-in (sample)',
        selfApproved: !!d.selfApproved, attested: !!d.attested, note: d.note || null, exceptions: d.exceptions || []
      };
    });
    var lastDecision = decisions.length ? decisions[decisions.length - 1].at : null;
    var isMortgage = a.product === 'mortgage';
    return {
      packet: 'audit-packet', format: 1,
      generatedAt: nowIso(), generatedBy: { name: meU.name, email: meU.email },
      note: 'Prototype export generated in the browser from fictional sample data.',
      profile: p ? { id: p.id, name: p.name } : null,
      asset: {
        id: a.id, title: a.title, product: a.product, channel: a.channel, status: a.status, dueDate: a.dueDate || null, states: a.states || [],
        campaign: a.campaignId ? ((A.campaignById(a.campaignId) || {}).name || a.campaignId) : null,
        partner: a.partnerId ? ((A.partnerById(a.partnerId) || {}).name || a.partnerId) : null,
        submitter: a.submitter || null, approvedVersionId: a.approvedVersionId || null, latestVersionId: a.latestVersionId || null,
        sources: (a.sourceRefs || []).map(function (r) { return { sourceId: r.sourceId, label: r.label, seenAt: r.seenAt }; })
      },
      versions: versions,
      changeRequests: (a.changeRequests || []).map(function (cr) {
        var u = A.userById(cr.authorId);
        return { id: cr.id, versionId: cr.versionId, at: cr.at, author: u ? u.name : cr.authorId, status: cr.status, dueDate: cr.dueDate || null, note: cr.note || null, items: cr.items || [], delivery: 'In-app checklist; reviewer may copy it as text' };
      }),
      decisions: decisions,
      ruleSnapshots: Object.keys(rules).map(function (k) { return rules[k]; }),
      offerSnapshots: Object.keys(offers).map(function (k) { return offers[k]; }),
      retention: {
        policy: isMortgage ? 'Reg N, 12 CFR 1014.5: keep 24 months from last use' : 'Profile default: keep 24 months from last use',
        basis: 'In-market dates are not recorded in the prototype, so the last decision date is used.',
        retainUntil: lastDecision ? addMonthsDate(lastDecision, 24) : null
      },
      events: (a.events || []).map(function (e, i) { return { seq: i + 1, at: e.at, actor: e.actor, kind: e.kind, text: e.text }; })
    };
  }
  function exportAuditPacket() {
    var target = auditTarget();
    if (target === 'profile') {
      var p = A.profile();
      A.showExport({ title: 'Export profile activity', format: 'csv', filename: 'profile-activity.csv', text: eventsCsv(target, auditEvents(target)),
        description: 'Profile-level events (members, settings, policies). Pick an asset to export its full audit packet.' });
      return;
    }
    var a = A.asset(target);
    if (!a) { A.toast('Pick an asset first.', 'warning'); return; }
    A.showExport({
      title: 'Audit packet · ' + a.id, format: 'json', filename: 'audit-packet-' + a.id + '.json', text: auditPacket(a),
      description: 'Every version with its hash, findings and dispositions, change requests, decisions with approver, the rule and offer text in force, and the event log. Generated in the browser.'
    });
    A.log(a.id, A.me().name, 'export', 'Exported the audit packet (JSON).');
    A.rerender();
  }

  A.route('reports', function () {
    var p = A.profile(); if (!p) return null;
    var weekly = weeklyData();
    var m = S().metrics || {};

    // KPI history
    var kpiActions = weekly.length >= 5 ?
      '<div class="seg" role="group" aria-label="KPI view">' +
        '<button type="button" data-action="rep-kpi-view" data-view="charts" aria-pressed="' + (st.rep.kpiView === 'charts') + '">' + A.icon('chart') + 'Charts</button>' +
        '<button type="button" data-action="rep-kpi-view" data-view="table" aria-pressed="' + (st.rep.kpiView === 'table') + '">' + A.icon('sheet') + 'Table</button>' +
      '</div>' + ui.button('Export period report', { action: 'rep-export-period', size: 'sm', icon: 'copy' }) : '';
    var kpiBody;
    if (weekly.length < 5) {
      kpiBody = '<div class="card">' + ui.empty('Not enough data yet', 'KPI history appears once this profile has at least 5 weeks of decisions. Numbers here are measured, never estimated.') + '</div>';
    } else if (st.rep.kpiView === 'table') {
      kpiBody = kpiTable(weekly);
    } else {
      kpiBody = '<div class="grid grid-3">' + KPIS.map(function (k) { return kpiCard(k, weekly); }).join('') + '</div>';
    }

    // Findings by rule (live) + change-request reasons (sample)
    var byRule = {};
    A.assetsFor().forEach(function (a) { A.openFindings(A.latestVersion(a)).forEach(function (f) { byRule[f.ruleId] = (byRule[f.ruleId] || 0) + 1; }); });
    var ruleItems = Object.keys(byRule).map(function (id) { var r = A.ruleById(id); return { label: id + (r ? ' · ' + r.title : ''), value: byRule[id] }; })
      .sort(function (x, y) { return y.value - x.value || (x.label < y.label ? -1 : 1); }).slice(0, 6);
    var reasons = (S().activeProfileId === metricsOwner() && Array.isArray(m.topChangeRequestReasons)) ? m.topChangeRequestReasons : [];
    var dismissed = S().activeProfileId === metricsOwner() ? m.topDismissedRule : null;
    var breakdown = '<div class="grid grid-2">' +
      '<div class="card"><div class="card-header"><div><div class="card-title">Open findings by rule</div><div class="card-desc">Latest version of every asset in this profile. Counted live.</div></div></div>' +
        '<div class="card-body">' + (ruleItems.length ? ui.hbars(ruleItems) : '<p class="small muted">No open findings.</p>') + '</div></div>' +
      '<div class="card"><div class="card-header"><div><div class="card-title">Top change-request reasons ' + ui.sample() + '</div><div class="card-desc">Last 7 days.</div></div></div>' +
        '<div class="card-body stack">' + (reasons.length ? ui.hbars(reasons.map(function (r) { return { label: r.reason, value: r.count }; })) : '<p class="small muted">Not enough data yet.</p>') +
        (dismissed ? '<p class="small muted">Dismissed most often: <span class="mono">' + esc(dismissed.ruleId) + '</span> (' + esc(pct(dismissed.dismissRate)) + ' of its findings) ' + ui.sample() + '. Dismissed reasons help your team tune this rule.</p>' : '') +
        '</div></div>' +
      '</div>';

    // Exceptions log
    var ex = exceptionRows();
    var exTable = ui.table([
      { key: 'at', label: 'Approved', render: function (r) { return '<span class="nowrap">' + esc(ui.time(r.at)) + '</span>'; } },
      { key: 'assetId', label: 'Asset', render: function (r) { return '<a href="#asset-' + esc(r.assetId) + '" class="cell-title">' + esc(r.assetId) + '</a><span class="cell-sub">' + esc(r.title) + '</span>'; } },
      { key: 'version', label: 'Version', render: function (r) { return '<div class="stack stack-sm"><span>V' + esc(r.versionN) + '</span>' + ui.sha(r.sha) + '</div>'; } },
      { key: 'finding', label: 'Finding excepted', render: function (r) {
        return '<div class="stack stack-sm">' + '<span class="row row-tight">' + ui.severityBadge(r.severity) + '<span class="mono xs">' + esc(r.ruleId || r.findingId) + '</span></span>' +
          '<span class="cell-sub">' + esc(r.ruleTitle) + '</span></div>';
      } },
      { key: 'reason', label: 'Reason', render: function (r) { return '<span class="nowrap">' + esc(r.reason) + '</span>'; } },
      { key: 'text', label: 'Justification', render: function (r) { return '<span class="adm-just clamp-2" title="' + esc(r.text) + '">' + esc(r.text) + '</span>'; } },
      { key: 'approver', label: 'Approved by', render: function (r) { return '<span class="nowrap">' + esc(r.approver) + '</span>' + (r.selfApproved ? ' ' + ui.tag('self-approved') : ''); } }
    ], ex, { caption: 'Exceptions log', empty: 'No approvals with exceptions in this profile.' });

    // Cost ledger
    var b = p.budget || {};
    var allRows = ledgerRows();
    var scoped = allRows.filter(function (r) {
      if (st.rep.ledgerScope === 'today') return isToday(r.at);
      if (st.rep.ledgerScope === 'declined') return r.status === 'declined';
      return true;
    });
    var todayRows = allRows.filter(function (r) { return isToday(r.at) && r.status === 'charged'; });
    var todayCost = todayRows.reduce(function (s, r) { return s + (Number(r.costUsd) || 0); }, 0);
    var modelName = (allRows[0] && allRows[0].model) || 'claude-haiku-4-5';
    var profSpent = Number(b.profileSpentTodayUsd) || 0, profCap = Number(b.profileCapUsd) || 0;
    var globSpent = Number(b.globalSpentTodayUsd) || 0, globCap = Number(b.globalCapUsd) || 0;
    var meters = '<div class="adm-budget">' +
      '<div class="card"><div class="card-body stack stack-sm">' +
        '<div class="adm-meter-head"><span class="medium">This profile today</span><span class="num">' + esc(ui.money(profSpent)) + ' of ' + esc(ui.money(profCap)) + '</span></div>' +
        ui.meter(profSpent, profCap, { label: 'Profile AI spend today against its sub-cap' }) +
        '<span class="xs muted">Sub-cap for ' + esc(p.name) + '. ' + esc(ui.money(Math.max(0, profCap - profSpent))) + ' left. ' +
          (A.isOwner() ? '<a href="#profile-prefs">Change the sub-cap</a>' : 'Owners can change it in Profile settings.') + '</span>' +
      '</div></div>' +
      '<div class="card"><div class="card-body stack stack-sm">' +
        '<div class="adm-meter-head"><span class="medium">All profiles today (global cap)</span><span class="num">' + esc(ui.money(globSpent)) + ' of ' + esc(ui.money(globCap)) + '</span></div>' +
        ui.meter(globSpent, globCap, { label: 'Deployment-wide AI spend today against the global cap' }) +
        '<span class="xs muted">Set for the whole deployment. Each run reserves its estimate first; if either cap would be exceeded the run is declined.</span>' +
      '</div></div>' +
      '</div>';
    var ledgerChips = '<div class="chip-list" role="group" aria-label="Filter the ledger">' +
      ui.chip('All runs', { action: 'rep-ledger-scope', data: { scope: 'all' }, pressed: st.rep.ledgerScope === 'all', size: 'sm', count: allRows.length }) +
      ui.chip('Today', { action: 'rep-ledger-scope', data: { scope: 'today' }, pressed: st.rep.ledgerScope === 'today', size: 'sm', count: allRows.filter(function (r) { return isToday(r.at); }).length }) +
      ui.chip('Declined', { action: 'rep-ledger-scope', data: { scope: 'declined' }, pressed: st.rep.ledgerScope === 'declined', size: 'sm', count: allRows.filter(function (r) { return r.status === 'declined'; }).length }) +
      '</div>';

    // Audit log
    var target = auditTarget();
    var events = auditEvents(target);
    var kinds = [];
    events.forEach(function (e) { if (kinds.indexOf(e.kind) < 0) kinds.push(e.kind); });
    var kindSel = kinds.indexOf(st.rep.auditKind) >= 0 ? st.rep.auditKind : 'all';
    var evRows = events.map(function (e, i) { return { seq: i + 1, at: e.at, actor: e.actor, kind: e.kind, text: e.text }; })
      .filter(function (e) { return kindSel === 'all' || e.kind === kindSel; });
    var auditTable = ui.table([
      { key: 'seq', label: '#', align: 'right', shrink: true, render: function (e) { return '<span class="muted">' + esc(e.seq) + '</span>'; } },
      { key: 'at', label: 'Time', render: function (e) { return '<span class="nowrap" title="' + esc(ui.relTime(e.at)) + '">' + esc(ui.time(e.at)) + '</span>'; } },
      { key: 'actor', label: 'Actor', render: function (e) { return '<span class="nowrap">' + esc(e.actor) + '</span>'; } },
      { key: 'kind', label: 'Event', render: function (e) { return '<span class="tl-kind">' + esc(e.kind) + '</span>'; } },
      { key: 'text', label: 'Details', render: function (e) { return '<span class="small" style="white-space:normal">' + esc(e.text) + '</span>'; } }
    ], evRows, { dense: true, caption: 'Audit log, oldest first', empty: target === 'profile' ? 'No profile events yet. Member, settings and policy changes appear here.' : 'No events match this filter.' });
    var auditControls =
      '<div class="field" style="min-width:240px;flex:1 1 260px;max-width:420px"><label class="label" for="rep-audit-asset">Asset</label>' +
        ui.select('rep-audit-asset', auditTargets(), target, { change: 'rep-audit-asset', size: 'sm' }) + '</div>' +
      '<div class="field" style="min-width:160px"><label class="label" for="rep-audit-kind">Event type</label>' +
        ui.select('rep-audit-kind', [{ value: 'all', label: 'All events (' + events.length + ')' }].concat(kinds.map(function (k) { return { value: k, label: k }; })), kindSel, { change: 'rep-audit-kind', size: 'sm' }) + '</div>';

    return '<div class="page">' +
      pageHeader('Reports', 'Review history, exceptions, AI spend and the audit trail for ' + esc(p.name) + '. Numbers tagged ' + ui.sample() + ' are prototype values, not measurements.', '') +

      '<section class="section" aria-labelledby="rep-kpi-h">' +
        '<div class="section-header"><div class="stack stack-sm"><h2 class="section-title" id="rep-kpi-h">KPI history</h2>' +
          '<p class="section-desc">Weekly, same definitions as the dashboard. Hover a bar for its value, or switch to the table.</p></div>' +
          (kpiActions ? '<div class="toolbar">' + kpiActions + '</div>' : '') + '</div>' +
        kpiBody +
      '</section>' +

      '<section class="section" aria-label="Findings and change requests">' + breakdown + '</section>' +

      '<section class="section" aria-labelledby="rep-ex-h">' +
        '<div class="section-header"><div class="stack stack-sm"><h2 class="section-title" id="rep-ex-h">Exceptions log</h2>' +
          '<p class="section-desc">Every approval recorded with open Critical or Major findings, with the written justification. The profile owner is notified in-app.</p></div>' +
          '<div class="toolbar">' + ui.button('Export CSV', { action: 'rep-export-exceptions', size: 'sm', icon: 'copy', disabled: !ex.length }) + '</div></div>' +
        exTable +
      '</section>' +

      '<section class="section" aria-labelledby="rep-cost-h">' +
        '<div class="section-header"><div class="stack stack-sm"><h2 class="section-title" id="rep-cost-h">AI cost ledger</h2>' +
          '<p class="section-desc">One row per model call. Today: ' + esc(ui.money(todayCost)) + ' across ' + esc(A.plural(todayRows.length, 'call')) +
          (S().activeProfileId === metricsOwner() && m.costPerAnalyzedVersionUsd ? ' · average ' + esc(ui.money(m.costPerAnalyzedVersionUsd)) + ' per analyzed version ' + ui.sample() : '') + '</p></div>' +
          '<div class="toolbar">' + ledgerChips + ui.button('Export CSV', { action: 'rep-export-ledger', size: 'sm', icon: 'copy', disabled: !allRows.length }) + '</div></div>' +
        meters +
        ledgerTable(scoped, modelName) +
      '</section>' +

      '<section class="section" aria-labelledby="rep-audit-h">' +
        '<div class="section-header"><div class="stack stack-sm"><h2 class="section-title" id="rep-audit-h">Audit log</h2>' +
          '<p class="section-desc row row-tight">' + A.icon('lock') + '<span>Events cannot be edited or deleted. New events are appended, oldest first.</span></p></div>' +
          '<div class="toolbar">' +
            ui.button('Export events', { action: 'rep-export-events', size: 'sm', icon: 'copy', disabled: !events.length }) +
            ui.button(target === 'profile' ? 'Export profile activity' : 'Export audit packet', { action: 'rep-export-packet', size: 'sm', variant: 'default', icon: 'file-text', kbd: 'E' }) +
          '</div></div>' +
        '<div class="toolbar">' + auditControls +
          (target !== 'profile' ? '<div class="spacer"></div>' + ui.button('Open ' + target, { href: '#asset-' + target, size: 'sm', variant: 'ghost', iconRight: 'arrow-right' }) : '') + '</div>' +
        auditTable +
      '</section>' +
      '</div>';
  }, { nav: 'reports', title: 'Reports' });

  A.action('rep-kpi-view', function (el) { st.rep.kpiView = el.dataset.view === 'table' ? 'table' : 'charts'; A.rerender(); });
  A.action('rep-ledger-scope', function (el) { st.rep.ledgerScope = el.dataset.scope || 'all'; A.rerender(); });
  A.action('rep-audit-asset', function (el) { st.rep.auditAsset = el.value; st.rep.auditKind = 'all'; A.rerender(); });
  A.action('rep-audit-kind', function (el) { st.rep.auditKind = el.value; A.rerender(); });
  A.action('rep-export-period', function () {
    var weekly = weeklyData();
    A.showExport({ title: 'Period report', format: 'csv', filename: 'period-report.csv', text: periodCsv(weekly), description: 'Weekly KPIs for the last ' + weekly.length + ' weeks. Sample values in the prototype.' });
  });
  A.action('rep-export-exceptions', function () {
    var rows = exceptionRows();
    A.showExport({
      title: 'Exceptions log', format: 'csv', filename: 'exceptions-log.csv',
      text: A.csv(rows, [
        { key: 'at', label: 'approved_at' }, { key: 'assetId', label: 'asset' }, { key: 'title', label: 'title' },
        { label: 'version', value: function (r) { return 'V' + r.versionN; } }, { key: 'sha', label: 'sha' }, { key: 'findingId', label: 'finding' },
        { key: 'severity', label: 'severity' }, { key: 'ruleId', label: 'rule' }, { key: 'reason', label: 'reason' }, { key: 'text', label: 'justification' },
        { key: 'approver', label: 'approved_by' }, { label: 'self_approved', value: function (r) { return r.selfApproved ? 'yes' : 'no'; } }
      ])
    });
  });
  A.action('rep-export-ledger', function () {
    var rows = ledgerRows();
    A.showExport({
      title: 'AI cost ledger', format: 'csv', filename: 'ai-cost-ledger.csv',
      text: A.csv(rows, [
        { key: 'at', label: 'at' }, { key: 'runId', label: 'run' }, { key: 'kind', label: 'kind' }, { key: 'assetId', label: 'asset' }, { key: 'model', label: 'model' },
        { key: 'tokensIn', label: 'tokens_in' }, { key: 'tokensOut', label: 'tokens_out' }, { key: 'costUsd', label: 'cost_usd' },
        { label: 'cached_or_reused', value: function (r) { return r.reusedFrom ? 'reused ' + r.reusedFrom : (r.cached ? 'cached' : ''); } }, { key: 'status', label: 'status' }
      ])
    });
  });
  A.action('rep-export-events', function () {
    var target = auditTarget();
    A.showExport({ title: 'Audit events · ' + (target === 'profile' ? 'profile activity' : target), format: 'csv', filename: 'events-' + target + '.csv', text: eventsCsv(target, auditEvents(target)) });
  });
  A.action('rep-export-packet', function () { exportAuditPacket(); });
  A.key('reports', 'e', function () { exportAuditPacket(); }, 'Export audit packet');

  /* ================================================================== */
  /* MEMBERS & INVITES                                                   */
  /* ================================================================== */
  function invStatus(inv) {
    if (inv.status === 'pending' && A.toMs(inv.expiresAt) < A.nowMs()) return 'expired';
    return inv.status;
  }
  function invBadge(s) {
    if (s === 'pending') return toneBadge('blue', 'clock', 'Pending');
    if (s === 'accepted') return toneBadge('green', 'circle-check', 'Accepted');
    if (s === 'revoked') return toneBadge('red', 'circle-slash', 'Revoked');
    return toneBadge('gray', 'history', 'Expired');
  }
  function roleBadge(role) {
    return role === 'owner' ? '<span class="badge badge-secondary">' + A.icon('key') + '<span>Owner</span></span>' : '<span class="badge badge-outline">' + A.icon('user') + '<span>Member</span></span>';
  }
  function ownerCount(p) { return (p.members || []).filter(function (m) { return m.role === 'owner'; }).length; }
  function openInviteDialog() {
    if (!A.isOwner()) { A.toast('Only owners can invite people.', 'warning'); return; }
    var p = A.profile();
    A.dialog({
      title: 'Invite by email', id: 'mem-invite-dialog', size: 'sm', dismissible: false,
      description: 'They get a sign-in link for ' + p.name + '. Owners and members can review and decide; owners also manage people and settings.',
      body:
        '<form id="mem-invite-form" data-submit="mem-invite-submit" class="stack" novalidate>' +
          ui.field('Email', '<input class="input" type="email" id="mem-invite-email" autocomplete="off" placeholder="name@company.example" aria-describedby="mem-invite-error">', { id: 'mem-invite-email' }) +
          ui.field('Role', ui.select('mem-invite-role', [
            { value: 'member', label: 'Member: reviews, decides and edits copy' },
            { value: 'owner', label: 'Owner: also manages people and settings' }
          ], 'member'), { id: 'mem-invite-role' }) +
          '<div class="error-text" id="mem-invite-error" role="alert" hidden></div>' +
          '<p class="small muted">The sign-in system emails the link. It expires in 7 days. If they already have an account, they join when they sign in with this email. Agencies and affiliates are partners, not members; they are recorded on the assets they submit.</p>' +
        '</form>',
      actions: [
        { label: 'Cancel', action: 'dialog-close', variant: 'outline' },
        { label: 'Send invite', action: 'mem-invite-submit', variant: 'default', icon: 'mail' }
      ]
    });
  }
  function inviteError(msg) {
    var err = document.getElementById('mem-invite-error');
    var input = document.getElementById('mem-invite-email');
    if (err) { err.innerHTML = A.icon('alert') + '<span>' + esc(msg) + '</span>'; err.hidden = false; }
    if (input) { input.setAttribute('aria-invalid', 'true'); try { input.focus(); } catch (e) { /* ignore */ } }
  }

  A.route('members', function () {
    var p = A.profile(); if (!p) return null;
    var owner = A.isOwner(), meU = A.me(), owners = ownerCount(p);
    var rows = (p.members || []).map(function (m) { return { m: m, u: A.userById(m.userId) }; }).sort(function (x, y) {
      if (x.m.role !== y.m.role) return x.m.role === 'owner' ? -1 : 1;
      return String(x.u ? x.u.name : '') < String(y.u ? y.u.name : '') ? -1 : 1;
    });
    var cols = [
      { key: 'name', label: 'Name', render: function (r) {
        var name = r.u ? r.u.name : r.m.userId;
        return '<div class="row">' + ui.avatar(r.u || name) + '<div class="stack" style="gap:0;min-width:0"><span class="cell-title">' + esc(name) +
          (r.m.userId === meU.id ? ' ' + ui.tag('you') : '') + '</span>' + (r.u && r.u.title ? '<span class="cell-sub">' + esc(r.u.title) + '</span>' : '') + '</div></div>';
      } },
      { key: 'email', label: 'Email', render: function (r) { return '<span class="small">' + esc(r.u ? r.u.email : '—') + '</span>'; } },
      { key: 'role', label: 'Role', render: function (r) {
        return '<div class="stack stack-sm">' + roleBadge(r.m.role) + (r.m.role === 'owner' && owners === 1 ? '<span class="xs muted nowrap">Only owner</span>' : '') + '</div>';
      } },
      { key: 'joined', label: 'Joined', render: function (r) { return '<span class="nowrap" title="' + esc(ui.time(r.m.joinedAt)) + '">' + esc(ui.date(r.m.joinedAt)) + '</span>'; } }
    ];
    if (owner) {
      cols.push({ key: 'actions', label: 'Actions', align: 'right', shrink: true, render: function (r) {
        var lastOwner = r.m.role === 'owner' && owners === 1;
        var isMe = r.m.userId === meU.id;
        var name = r.u ? r.u.name : r.m.userId;
        var roleBtn = ui.button(r.m.role === 'owner' ? 'Make member' : 'Make owner', {
          action: 'mem-role', size: 'sm', variant: 'ghost', disabled: lastOwner,
          data: { userId: r.m.userId, role: r.m.role === 'owner' ? 'member' : 'owner' }, ariaLabel: (r.m.role === 'owner' ? 'Make member: ' : 'Make owner: ') + name
        });
        var removeBtn = ui.button('Remove', { action: 'mem-remove', size: 'sm', variant: 'ghost', icon: 'trash', disabled: lastOwner || isMe, data: { userId: r.m.userId }, ariaLabel: 'Remove ' + name });
        var lastTip = 'A profile needs at least one owner. Make another member an owner first.';
        if (lastOwner) { roleBtn = withTip(roleBtn, lastTip); removeBtn = withTip(removeBtn, lastTip); }
        else if (isMe) removeBtn = withTip(removeBtn, 'You can’t remove yourself. Another owner can remove you.');
        return '<div class="row row-tight" style="justify-content:flex-end">' + roleBtn + removeBtn + '</div>';
      } });
    }

    var invites = (p.invites || []).slice().sort(function (x, y) {
      var sx = invStatus(x) === 'pending' ? 0 : 1, sy = invStatus(y) === 'pending' ? 0 : 1;
      return sx - sy || A.toMs(y.sentAt) - A.toMs(x.sentAt);
    });
    var pendingCount = invites.filter(function (i) { return invStatus(i) === 'pending'; }).length;
    var invCols = [
      { key: 'email', label: 'Email', render: function (i) { return '<span class="medium">' + esc(i.email) + '</span>'; } },
      { key: 'role', label: 'Role', render: function (i) { return roleBadge(i.role); } },
      { key: 'by', label: 'Invited by', render: function (i) { var u = A.userById(i.invitedBy); return '<span class="nowrap small">' + esc(u ? u.name : (i.invitedBy || '—')) + '</span>'; } },
      { key: 'sent', label: 'Last sent', render: function (i) { return '<span class="nowrap" title="' + esc(ui.time(i.sentAt)) + '">' + esc(ui.relTime(i.sentAt)) + '</span>' + (i.sendCount > 1 ? '<span class="cell-sub">Sent ' + esc(i.sendCount) + ' times</span>' : ''); } },
      { key: 'expires', label: 'Link expires', render: function (i) {
        var s = invStatus(i);
        if (s === 'accepted') return '<span class="small muted">Accepted ' + esc(ui.date(i.acceptedAt || i.sentAt)) + '</span>';
        if (s === 'revoked') return '<span class="small muted">Link disabled</span>';
        return '<span class="nowrap" title="' + esc(ui.time(i.expiresAt)) + '">' + esc(ui.relTime(i.expiresAt)) + '</span>';
      } },
      { key: 'status', label: 'Status', render: function (i) { return invBadge(invStatus(i)); } },
      { key: 'actions', label: 'Actions', align: 'right', shrink: true, render: function (i) {
        var s = invStatus(i), out = [];
        if (s === 'pending' || s === 'expired') out.push(ui.button('Preview', { action: 'mem-preview-invite', size: 'sm', variant: 'ghost', icon: 'eye', data: { inviteId: i.id }, title: 'Open the page this invite link leads to (prototype)' }));
        if (owner && s !== 'accepted') out.push(ui.button(s === 'revoked' ? 'Invite again' : 'Send again', { action: 'mem-resend', size: 'sm', variant: 'outline', icon: 'refresh', data: { inviteId: i.id }, title: 'Email a new sign-in link. The previous link stops working.' }));
        if (owner && s === 'pending') out.push(ui.button('Revoke', { action: 'mem-revoke', size: 'sm', variant: 'ghost', icon: 'circle-slash', data: { inviteId: i.id } }));
        return out.length ? '<div class="row row-tight" style="justify-content:flex-end">' + out.join('') + '</div>' : '<span class="muted">—</span>';
      } }
    ];

    var partners = p.partners || [];
    var inviteBtn = ui.button('Invite by email', { action: 'mem-invite', variant: 'default', icon: 'user-plus', disabled: !owner, kbd: owner ? 'I' : null });
    if (!owner) inviteBtn = withTip(inviteBtn, 'Only owners can invite people.');

    return '<div class="page page-narrow" style="max-width:1080px">' +
      pageHeader('Members & invites', 'People in ' + esc(p.name) + '. Everyone is an owner or a member. Members review, decide and edit copy; owners also manage people and profile settings.', inviteBtn) +
      (owner ? '' : ui.callout('info', 'You’re a member of this profile', 'Only owners can invite people, change roles or remove members. ' + esc(A.plural(owners, 'owner')) + ' can help.')) +

      '<section class="section" aria-labelledby="mem-h">' +
        sectionHeader('Members', esc(A.plural((p.members || []).length, 'person', 'people')) + ' · ' + esc(A.plural(owners, 'owner'))) +
        '<div class="adm-members-table">' + ui.table(cols, rows, { caption: 'Members of ' + p.name }) + '</div>' +
        (owner && owners === 1 ? '<p class="xs muted">The last owner can’t be removed or made a member. Make someone else an owner first.</p>' : '') +
      '</section>' +

      '<section class="section" aria-labelledby="inv-h">' +
        sectionHeader('Invites', pendingCount ? esc(A.plural(pendingCount, 'pending invite')) + '. Sending again emails a new link and turns off the old one.' : 'No pending invites.') +
        '<div class="adm-members-table">' + ui.table(invCols, invites, { caption: 'Invites', empty: 'No invites yet.' + (owner ? ' Use Invite by email to add someone.' : '') }) + '</div>' +
        '<p class="xs muted row row-tight">' + A.icon('mail') + '<span>Invite links come from the sign-in system and are the only emails sent for this page. Removing someone keeps their decisions and audit events.</span></p>' +
      '</section>' +

      '<section class="section" aria-labelledby="partners-h">' +
        sectionHeader('Partners are not members', 'Agencies and affiliates are recorded on the assets they submit, so you can group the Queue by partner. They never sign in here.') +
        (partners.length ? '<div class="chip-list">' + partners.map(function (pt) {
          return ui.chip(pt.name, { icon: 'building', title: (pt.type === 'agency' ? 'Agency' : 'Affiliate') + (pt.contactEmail ? ' · ' + pt.contactEmail : '') });
        }).join('') + ui.button('Open the Queue', { href: '#queue', size: 'sm', variant: 'ghost', iconRight: 'arrow-right' }) + '</div>' : '<p class="small muted">No partners recorded yet. A partner is added when an asset from an agency or affiliate arrives.</p>') +
      '</section>' +
      '</div>';
  }, { nav: null, title: 'Members & invites' });

  A.action('mem-invite', function () { openInviteDialog(); });
  A.key('members', 'i', function () { openInviteDialog(); }, 'Invite by email');
  A.action('mem-invite-submit', function () {
    var p = A.profile();
    if (!A.isOwner()) { A.closeDialog(); A.toast('Only owners can invite people.', 'warning'); return; }
    var input = document.getElementById('mem-invite-email'), roleSel = document.getElementById('mem-invite-role');
    var email = String(input ? input.value : '').trim().toLowerCase();
    var role = roleSel && roleSel.value === 'owner' ? 'owner' : 'member';
    if (!isEmail(email)) { inviteError('Enter a full email address, like name@company.example.'); return; }
    var u = findUserByEmail(email);
    if (u && (p.members || []).some(function (m) { return m.userId === u.id; })) { inviteError(u.name + ' is already a member of ' + p.name + '.'); return; }
    var pending = (p.invites || []).find(function (i) { return i.email.toLowerCase() === email && invStatus(i) === 'pending'; });
    if (pending) { inviteError('An invite to ' + email + ' is already pending. Use Send again in the list.'); return; }
    var domain = email.split('@')[1];
    var partner = (p.partners || []).find(function (pt) { return pt.contactEmail && pt.contactEmail.split('@')[1] === domain; });
    if (partner) { inviteError(domain + ' belongs to ' + partner.name + ', a partner. Partners are recorded on assets and can’t be members.'); return; }
    var inv = {
      id: A.nextId('inv', (p.invites || []).map(function (i) { return i.id; }), 0), email: email, role: role, invitedBy: A.me().id,
      status: 'pending', sentAt: nowIso(), expiresAt: plusDaysIso(7), sendCount: 1
    };
    p.invites = p.invites || [];
    p.invites.unshift(inv);
    A.logProfile(A.me().name, 'member', 'Invited ' + email + ' as ' + (role === 'owner' ? 'Owner' : 'Member') + '. Link expires ' + ui.date(inv.expiresAt) + '.');
    A.emit('data-changed', { kind: 'invite' });
    A.closeDialog();
    A.rerender();
    A.toast('Invite sent to ' + email + '. The link expires ' + ui.date(inv.expiresAt) + '.', 'success');
  });
  function findInvite(id) {
    var p = A.profile();
    return p ? (p.invites || []).find(function (i) { return i.id === id; }) || null : null;
  }
  A.action('mem-resend', function (el) {
    if (!A.isOwner()) { A.toast('Only owners can send invites.', 'warning'); return; }
    var inv = findInvite(el.dataset.inviteId); if (!inv) return;
    var wasRevoked = inv.status === 'revoked';
    inv.status = 'pending';
    inv.sentAt = nowIso();
    inv.expiresAt = plusDaysIso(7);
    inv.sendCount = (inv.sendCount || 1) + 1;
    inv.linkId = A.shortSha();
    delete inv.revokedAt; delete inv.revokedBy;
    A.logProfile(A.me().name, 'member', (wasRevoked ? 'Invited ' + inv.email + ' again' : 'Sent a new invite link to ' + inv.email) + '. Earlier links no longer work. Expires ' + ui.date(inv.expiresAt) + '.');
    A.emit('data-changed', { kind: 'invite' });
    A.rerender();
    A.toast('Sent a new link to ' + inv.email + '. The previous link no longer works.', 'success');
  });
  A.action('mem-revoke', function (el) {
    var inv = findInvite(el.dataset.inviteId); if (!inv) return;
    A.confirmDialog({
      title: 'Revoke this invite?', confirmLabel: 'Revoke invite', destructive: true, action: 'mem-revoke-confirm', data: { inviteId: inv.id },
      message: 'The link sent to ' + inv.email + ' stops working right away. You can invite them again later.'
    });
  });
  A.action('mem-revoke-confirm', function (el) {
    var inv = findInvite(el.dataset.inviteId);
    A.closeDialog();
    if (!inv || !A.isOwner()) return;
    inv.status = 'revoked';
    inv.revokedAt = nowIso();
    inv.revokedBy = A.me().id;
    A.logProfile(A.me().name, 'member', 'Revoked the invite to ' + inv.email + '.');
    A.emit('data-changed', { kind: 'invite' });
    A.rerender();
    A.toast('Invite to ' + inv.email + ' revoked.');
  });
  A.action('mem-preview-invite', function (el) {
    st.inv.inviteId = el.dataset.inviteId || null;
    st.inv.variant = 'match';
    A.go('#invite');
  });
  A.action('mem-role', function (el) {
    var p = A.profile(), u = A.userById(el.dataset.userId);
    var role = el.dataset.role === 'owner' ? 'owner' : 'member';
    var name = u ? u.name : el.dataset.userId;
    A.confirmDialog({
      title: role === 'owner' ? 'Make ' + name + ' an owner?' : 'Make ' + name + ' a member?',
      confirmLabel: role === 'owner' ? 'Make owner' : 'Make member', action: 'mem-role-confirm', data: { userId: el.dataset.userId, role: role },
      message: role === 'owner' ? 'Owners can invite and remove people, change roles and edit profile settings for ' + p.name + '.' :
        name + ' keeps access to review and decide, but can no longer manage people or profile settings.'
    });
  });
  A.action('mem-role-confirm', function (el) {
    var p = A.profile();
    A.closeDialog();
    if (!A.isOwner()) { A.toast('Only owners can change roles.', 'warning'); return; }
    var m = (p.members || []).find(function (x) { return x.userId === el.dataset.userId; });
    if (!m) return;
    var role = el.dataset.role === 'owner' ? 'owner' : 'member';
    if (m.role === 'owner' && role === 'member' && ownerCount(p) === 1) { A.toast('A profile needs at least one owner.', 'error'); return; }
    m.role = role;
    var u = A.userById(m.userId), name = u ? u.name : m.userId;
    A.logProfile(A.me().name, 'member', 'Changed ' + name + '’s role to ' + (role === 'owner' ? 'Owner' : 'Member') + '.');
    A.emit('data-changed', { kind: 'member' });
    A.rerender();
    A.toast(name + ' is now ' + (role === 'owner' ? 'an owner' : 'a member') + '.', 'success');
  });
  A.action('mem-remove', function (el) {
    var p = A.profile(), u = A.userById(el.dataset.userId), name = u ? u.name : el.dataset.userId;
    var srcCount = (S().sources || []).filter(function (s) { return s.profileId === p.id && s.connectedBy === el.dataset.userId && s.status !== 'not-connected'; }).length;
    A.confirmDialog({
      title: 'Remove ' + name + '?', confirmLabel: 'Remove from profile', destructive: true, action: 'mem-remove-confirm', data: { userId: el.dataset.userId },
      body: '<p>' + esc(name) + ' loses access to ' + esc(p.name) + ' right away. Their decisions, notes and audit events stay in the record.</p>' +
        (srcCount ? ui.callout('warning', A.plural(srcCount, 'connected source') + ' used their account','Imported assets stay. The connection stops syncing until another member reconnects it in Intake → Sources.') : '')
    });
  });
  A.action('mem-remove-confirm', function (el) {
    var p = A.profile(), id = el.dataset.userId;
    A.closeDialog();
    if (!A.isOwner()) { A.toast('Only owners can remove people.', 'warning'); return; }
    var m = (p.members || []).find(function (x) { return x.userId === id; });
    if (!m) return;
    if (id === A.me().id) { A.toast('You can’t remove yourself.', 'error'); return; }
    if (m.role === 'owner' && ownerCount(p) === 1) { A.toast('A profile needs at least one owner.', 'error'); return; }
    p.members = p.members.filter(function (x) { return x.userId !== id; });
    var affected = (S().sources || []).filter(function (s) { return s.profileId === p.id && s.connectedBy === id && s.status !== 'not-connected'; });
    affected.forEach(function (s) {
      s.status = 'owner-removed';
      s.syncLog = s.syncLog || [];
      s.syncLog.push({ at: nowIso(), kind: 'error', summary: 'Connection owner removed from the profile. Sync paused; imported items are kept.' });
    });
    var u = A.userById(id), name = u ? u.name : id;
    A.logProfile(A.me().name, 'member', 'Removed ' + name + ' from the profile.' + (affected.length ? ' ' + A.plural(affected.length, 'source') + ' paused until reconnected.' : ''));
    A.emit('data-changed', { kind: 'member' });
    A.rerender();
    A.toast(name + ' was removed.' + (affected.length ? ' ' + A.plural(affected.length, 'source') + ' needs a new connection owner.' : ''), 'success');
  });

  /* ================================================================== */
  /* PROFILE SETTINGS                                                    */
  /* ================================================================== */
  function fieldError(id, msg) {
    var el = document.getElementById(id + '-error'), input = document.getElementById(id);
    if (el) { el.innerHTML = msg ? A.icon('alert') + '<span>' + esc(msg) + '</span>' : ''; el.hidden = !msg; }
    if (input) { if (msg) { input.setAttribute('aria-invalid', 'true'); try { input.focus(); } catch (e) { /* ignore */ } } else input.removeAttribute('aria-invalid'); }
  }
  A.route('profile-prefs', function () {
    var p = A.profile(); if (!p) return null;
    var owner = A.isOwner(), dis = owner ? '' : ' disabled';
    var b = p.budget || {};
    var cap = Number(b.profileCapUsd) || 0, spent = Number(b.profileSpentTodayUsd) || 0, gCap = Number(b.globalCapUsd) || 0, gSpent = Number(b.globalSpentTodayUsd) || 0;
    var ehl = !!(p.prefs && p.prefs.equalHousingLegend);
    var created = p.createdAt ? ui.date(p.createdAt) : '—';

    var general = '<div class="card"><div class="card-header with-border"><div><h2 class="card-title">General</h2><p class="card-desc">How this profile appears in the switcher and on exports.</p></div></div>' +
      '<form class="card-body stack" data-submit="pp-save-name" novalidate>' +
        ui.field('Profile name', '<input class="input" id="pp-name" maxlength="60" autocomplete="off" value="' + esc(p.name) + '" aria-describedby="pp-name-error"' + dis + '>', { id: 'pp-name' }) +
        '<div class="error-text" id="pp-name-error" role="alert" hidden></div>' +
        ui.dl([
          ['Created', esc(created)],
          ['Members', esc(A.plural(A.memberCount(p), 'person', 'people')) + ' · <a href="#members">Manage members</a>'],
          ['Profile ID', '<span class="mono small">' + esc(p.id) + '</span>']
        ]) +
        '<div class="row">' + ui.button('Save name', { type: 'submit', variant: 'default', size: 'sm', disabled: !owner }) + '</div>' +
      '</form></div>';

    var budget = '<div class="card"><div class="card-header with-border"><div><h2 class="card-title">AI budget</h2><p class="card-desc">A daily sub-cap for this profile, inside the global cap for the whole deployment.</p></div></div>' +
      '<form class="card-body stack" data-submit="pp-save-cap" novalidate>' +
        ui.field('Daily sub-cap for this profile (USD)', '<div class="input-group">' + A.icon('dollar') + '<input class="input" type="number" inputmode="decimal" id="pp-cap" min="0.25" max="' + esc(gCap) + '" step="0.25" value="' + esc(cap.toFixed(2)) + '" aria-describedby="pp-cap-hint pp-cap-error"' + dis + '></div>',
          { id: 'pp-cap', hint: 'Between $0.25 and the ' + ui.money(gCap) + ' global cap. Resets at midnight Central.' }) +
        '<div class="error-text" id="pp-cap-error" role="alert" hidden></div>' +
        '<div class="adm-budget">' +
          '<div class="stack stack-sm"><div class="adm-meter-head"><span>This profile today</span><span class="num">' + esc(ui.money(spent)) + ' of ' + esc(ui.money(cap)) + '</span></div>' +
            ui.meter(spent, cap, { label: 'Profile AI spend today' }) + '</div>' +
          '<div class="stack stack-sm"><div class="adm-meter-head"><span>All profiles today</span><span class="num">' + esc(ui.money(gSpent)) + ' of ' + esc(ui.money(gCap)) + '</span></div>' +
            ui.meter(gSpent, gCap, { label: 'Deployment AI spend today' }) + '</div>' +
        '</div>' +
        '<p class="small muted">Each run reserves its estimate before calling the model. If either cap would be exceeded, the run is declined, the asset goes to Needs manual review, and the decline shows in the <a href="#reports">cost ledger</a>. Deterministic checks still run.</p>' +
        '<div class="row">' + ui.button('Save sub-cap', { type: 'submit', variant: 'default', size: 'sm', disabled: !owner }) + '</div>' +
      '</form></div>';

    var disclosures = '<div class="card"><div class="card-header with-border"><div><h2 class="card-title">Disclosures</h2><p class="card-desc">Profile-wide requirements the checks apply.</p></div></div>' +
      '<div class="card-body stack">' +
        '<div class="adm-switch-row">' +
          '<button type="button" class="switch" role="switch" id="pp-ehl" aria-checked="' + ehl + '" aria-labelledby="pp-ehl-label" aria-describedby="pp-ehl-desc" data-action="pp-toggle-ehl"' + dis + '></button>' +
          '<div class="stack stack-sm"><span class="medium" id="pp-ehl-label">Require the Equal Housing Opportunity legend on mortgage ads</span>' +
          '<span class="small muted" id="pp-ehl-desc">When on, mortgage assets without the legend or logo get a finding. ' + (ehl ? 'Currently on.' : 'Currently off.') + ' Changing it applies to the next preflight or recheck; past results stay as they were.</span></div>' +
        '</div>' +
      '</div></div>';

    var demo = '<div class="card"><div class="card-header with-border"><div><h2 class="card-title">Demo data</h2><p class="card-desc">Prototype only.</p></div></div>' +
      '<div class="card-body row row-wrap between"><p class="small muted" style="max-width:52ch">Restore every profile, asset, decision and setting to the original sample data. This only affects this browser.</p>' +
        ui.button('Reset demo data', { action: 'app-reset-demo', variant: 'destructive', size: 'sm', icon: 'refresh' }) + '</div></div>';

    return '<div class="page page-narrow">' +
      pageHeader('Profile settings', esc(p.name) + ' · settings apply to everyone in this profile.', '') +
      (owner ? '' : ui.callout('info', 'Only owners can change these settings', 'You can see them, and the reset button below still works because it only affects your browser.')) +
      general + budget + disclosures + demo +
      '</div>';
  }, { nav: null, title: 'Profile settings' });

  A.action('pp-save-name', function () {
    var p = A.profile();
    if (!A.isOwner()) { A.toast('Only owners can rename the profile.', 'warning'); return; }
    var input = document.getElementById('pp-name');
    var name = String(input ? input.value : '').replace(/\s+/g, ' ').trim();
    if (!name) { fieldError('pp-name', 'Enter a name.'); return; }
    if (name.length > 60) { fieldError('pp-name', 'Use 60 characters or fewer.'); return; }
    if (name === p.name) { fieldError('pp-name', ''); A.toast('No changes to save.'); return; }
    var before = p.name;
    p.name = name;
    A.logProfile(A.me().name, 'settings', 'Renamed the profile from "' + before + '" to "' + name + '".');
    A.emit('data-changed', { kind: 'profile' });
    A.rerender();
    A.toast('Profile renamed to ' + name + '.', 'success');
  });
  A.action('pp-save-cap', function () {
    var p = A.profile();
    if (!A.isOwner()) { A.toast('Only owners can change the AI budget.', 'warning'); return; }
    var b = p.budget = p.budget || {};
    var input = document.getElementById('pp-cap');
    var v = parseFloat(String(input ? input.value : '').replace(/[$,\s]/g, ''));
    var g = Number(b.globalCapUsd) || 10;
    if (isNaN(v)) { fieldError('pp-cap', 'Enter an amount in dollars, like 3.00.'); return; }
    if (v < 0.25 || v > g) { fieldError('pp-cap', 'Choose an amount between $0.25 and ' + ui.money(g) + '.'); return; }
    v = Math.round(v * 100) / 100;
    var before = Number(b.profileCapUsd) || 0;
    if (v === before) { fieldError('pp-cap', ''); A.toast('No changes to save.'); return; }
    b.profileCapUsd = v;
    A.logProfile(A.me().name, 'settings', 'Changed the daily AI sub-cap from ' + ui.money(before) + ' to ' + ui.money(v) + '.');
    A.emit('data-changed', { kind: 'budget' });
    A.rerender();
    A.toast('Daily AI sub-cap set to ' + ui.money(v) + '.' + ((Number(b.profileSpentTodayUsd) || 0) >= v ? ' Today’s spend is already at the cap, so new runs are declined until midnight.' : ''), 'success');
  });
  A.action('pp-toggle-ehl', function () {
    var p = A.profile();
    if (!A.isOwner()) { A.toast('Only owners can change disclosure settings.', 'warning'); return; }
    p.prefs = p.prefs || {};
    p.prefs.equalHousingLegend = !p.prefs.equalHousingLegend;
    var on = p.prefs.equalHousingLegend;
    A.logProfile(A.me().name, 'settings', 'Turned the Equal Housing Opportunity legend requirement ' + (on ? 'on' : 'off') + '.');
    A.emit('data-changed', { kind: 'prefs' });
    A.rerender();
    A.toast('Equal Housing legend requirement turned ' + (on ? 'on' : 'off') + '. It applies from the next check.', 'success');
  });

  /* ================================================================== */
  /* NEW PROFILE                                                         */
  /* ================================================================== */
  A.route('new-profile', function () {
    var meU = A.me();
    return '<div class="page page-narrow" style="max-width:640px">' +
      pageHeader('Create a profile', 'A profile is a separate workspace with its own assets, sources, rules, offers and members. Nothing is shared between profiles.', '') +
      '<div class="card"><form class="card-body stack-lg stack" data-submit="np-create" novalidate>' +
        ui.field('Profile name', '<input class="input" id="np-name" maxlength="60" autocomplete="off" placeholder="e.g. Northwind Lending" aria-describedby="np-name-hint np-name-error"' + (st.np.error ? ' aria-invalid="true"' : '') + '>',
          { id: 'np-name', hint: 'Usually the company or brand whose marketing you review. You can rename it later.' }) +
        '<div class="error-text" id="np-name-error" role="alert"' + (st.np.error ? '' : ' hidden') + '>' + (st.np.error ? A.icon('alert') + '<span>' + esc(st.np.error) + '</span>' : '') + '</div>' +
        '<div class="stack stack-sm"><span class="label">What you start with</span>' +
          '<ul class="stack stack-sm small" style="margin:0;padding-left:18px">' +
            '<li>You (' + esc(meU.email) + ') as the owner. Invite others from Members &amp; invites.</li>' +
            '<li>An empty queue and intake. Connect Google or Microsoft, or upload, paste or import a file.</li>' +
            '<li>The starter rule library, ready to clone and edit in Policies.</li>' +
            '<li>A daily AI sub-cap of $3.00, inside the global cap.</li>' +
          '</ul></div>' +
        '<div class="row">' + ui.button('Create profile', { type: 'submit', variant: 'default', icon: 'plus' }) + ui.button('Cancel', { href: '#dashboard', variant: 'ghost' }) + '</div>' +
      '</form></div>' +
      '</div>';
  }, { nav: null, title: 'New profile' });

  A.action('np-create', function () {
    var input = document.getElementById('np-name');
    var name = String(input ? input.value : '').replace(/\s+/g, ' ').trim();
    var err = null;
    if (!name) err = 'Enter a name for the profile.';
    else if (name.length > 60) err = 'Use 60 characters or fewer.';
    else if (A.myProfiles().some(function (p) { return p.name.toLowerCase() === name.toLowerCase(); })) err = 'You already have a profile named ' + name + '.';
    if (err) { st.np.error = null; fieldError('np-name', err); return; }
    st.np.error = null;
    var cur = A.profile(), cb = (cur && cur.budget) || {};
    var slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'profile';
    var id = 'p-' + slug, n = 2;
    while (profileById(id)) { id = 'p-' + slug + '-' + n; n += 1; }
    var meU = A.me(), now = nowIso();
    var p = {
      id: id, name: name, createdAt: now,
      members: [{ userId: meU.id, role: 'owner', joinedAt: now }],
      invites: [], partners: [],
      budget: { profileCapUsd: 3, profileSpentTodayUsd: 0, globalCapUsd: Number(cb.globalCapUsd) || 10, globalSpentTodayUsd: Number(cb.globalSpentTodayUsd) || 0 },
      prefs: { equalHousingLegend: false },
      events: []
    };
    S().profiles.push(p);
    S().activeProfileId = id;
    A.logProfile(meU.name, 'settings', 'Created the profile "' + name + '". ' + meU.name + ' is the owner.', id);
    A.emit('profile-changed', { profileId: id });
    A.emit('data-changed', { kind: 'profile' });
    A.go('#dashboard');
    A.toast('Created ' + name + '. You’re the owner.', 'success');
  });

  /* ================================================================== */
  /* SIGN-IN (chromeless)                                                */
  /* ================================================================== */
  var DEMO_CODE = '482913';
  function siEmail() { return st.si.email != null ? st.si.email : (A.me().email || ''); }
  function siError() { return st.si.error ? '<div class="error-text" role="alert" id="si-error">' + A.icon('alert') + '<span>' + esc(st.si.error) + '</span></div>' : ''; }
  function emailInput(id) {
    return ui.field('Email', '<input class="input" type="email" id="' + id + '" autocomplete="email" inputmode="email" placeholder="you@company.example" value="' + esc(siEmail()) + '" data-input="si-email-input"' +
      (st.si.error ? ' aria-invalid="true" aria-describedby="si-error"' : '') + '>', { id: id });
  }
  function readEmail(id) {
    var el = document.getElementById(id);
    var v = String(el ? el.value : siEmail()).trim();
    st.si.email = v;
    return v;
  }
  function signIn(email, method) {
    var u = findUserByEmail(email), prev = A.me();
    if (u && u.id !== S().currentUserId) { S().currentUserId = u.id; A.emit('user-changed', { userId: u.id }); }
    var who = u || prev;
    if (!A.isMember(S().activeProfileId)) { var mine = A.myProfiles(); if (mine[0]) S().activeProfileId = mine[0].id; }
    A.emit('data-changed', { kind: 'user' });
    st.si = freshSi();
    A.go('#dashboard');
    A.toast('Signed in as ' + who.name + ' with ' + method + '.' + (u ? '' : ' That email has no sample account, so the prototype uses ' + who.name + '.'), 'success');
  }
  function rateLimited() {
    var wait = 60000 - (Date.now() - (st.si.lastSentMs || 0));
    if (st.si.lastSentMs && wait > 0) { st.si.error = 'Too many requests. Wait ' + Math.ceil(wait / 1000) + ' s before asking for another email.'; return true; }
    return false;
  }
  function siStageHtml() {
    var s = st.si, email = siEmail();
    if (s.stage === 'google') {
      return '<div class="stack" role="status"><div class="adm-auth-title">Continue with Google</div>' +
        ui.steps(['Open Google sign-in', 'Confirm your Google account', 'Load your profiles'], 1) + '</div>';
    }
    if (s.stage === 'link-sent') {
      return '<div class="stack" role="status"><div class="adm-big-icon">' + A.icon('mail') + '</div>' +
        '<div class="adm-auth-title">Check your email</div>' +
        '<p class="adm-auth-sub">We sent a sign-in link to <strong>' + esc(email) + '</strong>. It works once and expires in 15 minutes.</p>' +
        ui.callout('neutral', null, 'The link opens a page with a Continue button. Corporate email scanners that open links automatically can’t use it up.') +
        siError() +
        '<div class="stack stack-sm">' +
          ui.button('Open the link (demo)', { action: 'si-open-link', variant: 'default', block: true, icon: 'link' }) +
          ui.button('Enter a code instead', { action: 'si-send-code', variant: 'outline', block: true, icon: 'key' }) +
        '</div>' +
        '<div class="row row-wrap between small">' + ui.button('Send a new link', { action: 'si-resend', variant: 'link', data: { kind: 'link' } }) + ui.button('Use a different email', { action: 'si-back', variant: 'link' }) + '</div>' +
        '</div>';
    }
    if (s.stage === 'continue') {
      return '<div class="stack"><div class="adm-big-icon">' + A.icon('shield-check') + '</div>' +
        '<div class="adm-auth-title">Continue signing in</div>' +
        '<p class="adm-auth-sub">You opened a sign-in link for <strong>' + esc(email) + '</strong>.</p>' +
        ui.button('Continue', { action: 'si-continue', variant: 'default', block: true, iconRight: 'arrow-right', size: 'lg' }) +
        '<p class="xs muted">This extra click is on purpose. Email security scanners open links to check them; because the link only shows this page, a scanner can’t sign in or use up your link.</p>' +
        '</div>';
    }
    if (s.stage === 'code') {
      var boxes = '';
      for (var i = 0; i < 6; i++) {
        boxes += '<label class="sr-only" for="si-code-' + i + '">Digit ' + (i + 1) + ' of 6</label>' +
          '<input class="input" id="si-code-' + i + '" inputmode="numeric" pattern="[0-9]*" autocomplete="' + (i === 0 ? 'one-time-code' : 'off') + '"' + (st.si.error ? ' aria-invalid="true" aria-describedby="si-error"' : '') + '>';
      }
      return '<div class="stack"><div class="adm-auth-title" id="si-code-label">Enter your code</div>' +
        '<p class="adm-auth-sub">We emailed a 6-digit code to <strong>' + esc(email) + '</strong>. It expires in 10 minutes.</p>' +
        '<div class="adm-code" role="group" aria-labelledby="si-code-label">' + boxes + '</div>' +
        siError() +
        ui.button('Verify', { action: 'si-code-verify', variant: 'default', block: true }) +
        '<div class="row row-wrap between small">' + ui.button('Send a new code', { action: 'si-resend', variant: 'link', data: { kind: 'code' } }) + ui.button('Use a different email', { action: 'si-back', variant: 'link' }) + '</div>' +
        '</div>';
    }
    if (s.stage === 'forgot') {
      return '<form class="stack" data-submit="si-forgot-submit" novalidate><div class="adm-auth-title">Reset your password</div>' +
        '<p class="adm-auth-sub">We’ll email you a link to choose a new password.</p>' +
        emailInput('si-forgot-email') + siError() +
        ui.button('Email me a reset link', { type: 'submit', variant: 'default', block: true, icon: 'mail' }) +
        ui.button('Back to sign in', { action: 'si-back', variant: 'link' }) +
        '</form>';
    }
    if (s.stage === 'forgot-sent') {
      return '<div class="stack" role="status"><div class="adm-big-icon">' + A.icon('mail') + '</div>' +
        '<div class="adm-auth-title">Check your email</div>' +
        '<p class="adm-auth-sub">If an account exists for <strong>' + esc(email) + '</strong>, we sent a link to reset your password. It expires in 1 hour.</p>' +
        ui.button('Back to sign in', { action: 'si-back', variant: 'outline', block: true }) +
        '</div>';
    }
    // stage 'enter'
    var expired = s.expired ? ui.callout('danger', 'This link has expired or was already used — send a new one', 'Sign-in links work once and expire after 15 minutes.',
      { actionsHtml: ui.button('Send a new link', { action: 'si-expired-resend', size: 'sm', variant: 'outline', icon: 'mail' }) }) : '';
    var tabs = ui.tabs('si-tabs', [{ id: 'email', label: 'Email' }, { id: 'password', label: 'Password' }], s.tab, 'si-tab', { variant: 'pills', label: 'Sign-in method' });
    var body;
    if (s.tab === 'password') {
      body = '<form class="stack" data-submit="si-password" novalidate>' +
        emailInput('si-pw-email') +
        ui.field('Password', '<input class="input" type="password" id="si-password" autocomplete="current-password"' + (st.si.error ? ' aria-describedby="si-error"' : '') + '>', { id: 'si-password' }) +
        '<div class="row" style="justify-content:flex-end;margin-top:-4px">' + ui.button('Forgot password?', { action: 'si-forgot', variant: 'link', cls: 'small' }) + '</div>' +
        siError() +
        ui.button('Sign in', { type: 'submit', variant: 'default', block: true }) +
        '</form>';
    } else {
      body = '<form class="stack" data-submit="si-email-link" novalidate>' +
        emailInput('si-email') + siError() +
        '<div class="stack stack-sm">' +
          ui.button('Email me a link', { type: 'submit', variant: 'default', block: true, icon: 'mail' }) +
          ui.button('Email me a code', { action: 'si-send-code', variant: 'outline', block: true, icon: 'key' }) +
        '</div>' +
        '<p class="xs muted">The link opens a Continue page first, so corporate email scanners can’t use it up.</p>' +
        '</form>';
    }
    return '<div class="stack-lg stack">' + expired +
      '<div class="stack stack-sm"><h1 class="adm-auth-title">Sign in</h1><p class="adm-auth-sub">Review marketing for the profiles you belong to.</p></div>' +
      ui.button('Continue with Google', { action: 'si-google', variant: 'outline', block: true, size: 'lg' }) +
      '<div class="adm-or">or</div>' + tabs + body + '</div>';
  }
  function siDemoControls() {
    var s = st.si;
    return '<div class="adm-demo" aria-label="Prototype controls"><span class="adm-demo-title">prototype controls</span>' +
      '<div class="chip-list">' +
        ui.chip('Expired link error', { action: 'si-demo', data: { state: 'expired' }, pressed: s.expired && s.stage === 'enter', size: 'sm' }) +
        ui.chip('Link sent', { action: 'si-demo', data: { state: 'link-sent' }, pressed: s.stage === 'link-sent', size: 'sm' }) +
        ui.chip('Continue page', { action: 'si-demo', data: { state: 'continue' }, pressed: s.stage === 'continue', size: 'sm' }) +
        ui.chip('Code entry', { action: 'si-demo', data: { state: 'code' }, pressed: s.stage === 'code', size: 'sm' }) +
        ui.chip('Password reset sent', { action: 'si-demo', data: { state: 'forgot-sent' }, pressed: s.stage === 'forgot-sent', size: 'sm' }) +
        ui.chip('Invite page', { href: '#invite', icon: 'user-plus', size: 'sm' }) +
      '</div>' +
      '<span class="xs muted">Code ' + esc(DEMO_CODE) + ' works. Any password works. Sign-in emails (links, codes, password resets and member invites) come from the sign-in system and are the only emails the product sends.</span>' +
      '</div>';
  }
  A.route('signin', function () {
    ensureStyle();
    return '<div class="adm-auth"><div class="adm-auth-col">' + brand() +
      '<div class="card"><div class="card-body" style="padding:20px">' + siStageHtml() + '</div></div>' +
      '<p class="small muted center">New here? Signing in creates your account. Then create a profile or open an invite from a teammate.</p>' +
      siDemoControls() +
      '</div></div>';
  }, { chromeless: true, nav: null, title: 'Sign in' });

  A.action('si-email-input', function (el) { st.si.email = el.value; });
  A.action('si-tab', function (el) { st.si.tab = el.dataset.tab === 'password' ? 'password' : 'email'; st.si.stage = 'enter'; st.si.error = null; A.rerender(); });
  A.action('si-google', function () {
    st.si.stage = 'google'; st.si.error = null; st.si.expired = false;
    A.rerender();
    setTimeout(function () {
      if (A.current().name === 'signin' && st.si.stage === 'google') signIn(A.me().email, 'Google');
    }, 1100);
  });
  A.action('si-email-link', function () {
    var email = readEmail('si-email');
    if (!isEmail(email)) { st.si.error = 'Enter a full email address, like you@company.example.'; A.rerender(); return; }
    st.si.error = null; st.si.expired = false; st.si.stage = 'link-sent'; st.si.lastSentMs = Date.now();
    A.rerender();
  });
  A.action('si-send-code', function () {
    var email = st.si.stage === 'enter' ? readEmail('si-email') : siEmail();
    if (!isEmail(email)) { st.si.error = 'Enter a full email address, like you@company.example.'; A.rerender(); return; }
    st.si.error = null; st.si.expired = false; st.si.stage = 'code'; st.si.lastSentMs = Date.now(); st.si.focusCode = true;
    A.rerender();
  });
  A.action('si-resend', function (el) {
    if (rateLimited()) { A.rerender(); return; }
    st.si.error = null; st.si.lastSentMs = Date.now();
    if (el.dataset.kind === 'code') st.si.focusCode = true;
    A.rerender();
    A.toast((el.dataset.kind === 'code' ? 'Sent a new code to ' : 'Sent a new link to ') + siEmail() + '. Earlier ones no longer work.', 'success');
  });
  A.action('si-expired-resend', function () {
    var email = readEmail('si-email');
    if (!isEmail(email)) { st.si.expired = false; st.si.error = 'Enter your email, then choose Email me a link.'; A.rerender(); return; }
    st.si.expired = false; st.si.error = null; st.si.stage = 'link-sent'; st.si.lastSentMs = Date.now();
    A.rerender();
  });
  A.action('si-open-link', function () { st.si.stage = 'continue'; st.si.error = null; A.rerender(); });
  A.action('si-continue', function () { signIn(siEmail(), 'an email link'); });
  A.action('si-back', function () { st.si.stage = 'enter'; st.si.error = null; A.rerender(); });
  A.action('si-forgot', function () { readEmail('si-pw-email'); st.si.stage = 'forgot'; st.si.error = null; A.rerender(); });
  A.action('si-forgot-submit', function () {
    var email = readEmail('si-forgot-email');
    if (!isEmail(email)) { st.si.error = 'Enter a full email address, like you@company.example.'; A.rerender(); return; }
    st.si.error = null; st.si.stage = 'forgot-sent'; st.si.lastSentMs = Date.now();
    A.rerender();
  });
  A.action('si-password', function () {
    var email = readEmail('si-pw-email');
    var pw = document.getElementById('si-password');
    if (!isEmail(email)) { st.si.error = 'Enter a full email address, like you@company.example.'; A.rerender(); return; }
    if (!pw || !pw.value) { st.si.error = 'Enter your password.'; A.rerender(); var p2 = document.getElementById('si-password'); if (p2) p2.focus(); return; }
    signIn(email, 'a password');
  });
  A.action('si-demo', function (el) {
    var s = el.dataset.state;
    st.si.error = null;
    if (s === 'expired') { st.si.expired = !(st.si.expired && st.si.stage === 'enter'); st.si.stage = 'enter'; st.si.tab = 'email'; }
    else { st.si.expired = false; st.si.stage = s; if (s === 'code') st.si.focusCode = true; }
    A.rerender();
  });

  function codeBoxes() {
    var out = [];
    for (var i = 0; i < 6; i++) { var b = document.getElementById('si-code-' + i); if (!b) return null; out.push(b); }
    return out;
  }
  function verifyCode() {
    var boxes = codeBoxes(); if (!boxes) return;
    var code = boxes.map(function (b) { return b.value; }).join('');
    if (code.length < 6) {
      st.si.error = 'Enter all 6 digits.';
      try { if (document.activeElement) document.activeElement.blur(); } catch (e) { /* ignore */ }
      st.si.focusCode = true;
      A.rerender();
      return;
    }
    if (code === DEMO_CODE) { signIn(siEmail(), 'a 6-digit code'); return; }
    st.si.error = 'That code doesn’t match. Check the latest email, or send a new code.';
    try { if (document.activeElement) document.activeElement.blur(); } catch (e) { /* ignore */ }
    st.si.focusCode = true;
    A.rerender();
  }
  A.action('si-code-verify', function () { verifyCode(); });
  A.on('rendered', function (r) {
    if (r.name !== 'signin') return;
    if (st.si.stage !== 'code') return;
    var boxes = codeBoxes(); if (!boxes) return;
    function fill(digits, from) {
      var d = String(digits).replace(/\D/g, '').split('');
      for (var k = from; k < 6 && d.length; k++) boxes[k].value = d.shift();
      var next = boxes.find(function (b) { return !b.value; });
      if (next) next.focus(); else { boxes[5].focus(); verifyCode(); }
    }
    boxes.forEach(function (b, i) {
      b.addEventListener('input', function () {
        var d = b.value.replace(/\D/g, '');
        if (d.length > 1) { b.value = ''; fill(d, i); return; }
        b.value = d;
        if (d && i < 5) boxes[i + 1].focus();
        if (boxes.every(function (x) { return x.value; })) verifyCode();
      });
      b.addEventListener('keydown', function (e) {
        if (e.key === 'Backspace' && !b.value && i > 0) { e.preventDefault(); boxes[i - 1].value = ''; boxes[i - 1].focus(); }
        else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); boxes[i - 1].focus(); }
        else if (e.key === 'ArrowRight' && i < 5) { e.preventDefault(); boxes[i + 1].focus(); }
        else if (e.key === 'Enter') { e.preventDefault(); verifyCode(); }
      });
      b.addEventListener('paste', function (e) {
        var cd = e.clipboardData || window.clipboardData;
        var t = cd ? cd.getData('text') : '';
        if (/\d/.test(t)) { e.preventDefault(); fill(t, i); }
      });
      b.addEventListener('focus', function () { try { b.select(); } catch (e) { /* ignore */ } });
    });
    if (st.si.focusCode || r.nav) { st.si.focusCode = false; try { boxes[0].focus(); } catch (e) { /* ignore */ } }
  });

  /* ================================================================== */
  /* INVITE ACCEPTANCE (chromeless)                                      */
  /* ================================================================== */
  var DEMO_INVITE_EMAIL = 'd.kim@clearpath.example';
  function currentInvite() {
    var hit = null, hp = null;
    if (st.inv.inviteId) {
      S().profiles.forEach(function (p) {
        var i = (p.invites || []).find(function (x) { return x.id === st.inv.inviteId; });
        if (i && !hit) { hit = i; hp = p; }
      });
    }
    if (hit) {
      return { record: hit, profile: hp, email: hit.email, role: hit.role || 'member', inviter: A.userById(hit.invitedBy), sentAt: hit.sentAt, expiresAt: hit.expiresAt, status: invStatus(hit) };
    }
    var p = profileById('p-clearpath') || A.profile();
    var ownerM = p ? (p.members || []).find(function (m) { return m.role === 'owner'; }) : null;
    var sentMs = A.toMs(S().meta && S().meta.now) || A.nowMs();
    return {
      record: null, profile: p, email: DEMO_INVITE_EMAIL, role: 'member', inviter: ownerM ? A.userById(ownerM.userId) : null,
      sentAt: new Date(sentMs - 2 * 3600e3).toISOString(), expiresAt: new Date(sentMs + 7 * DAY - 2 * 3600e3).toISOString(), status: 'pending'
    };
  }
  function otherEmail(inv) {
    if (inv.email === DEMO_INVITE_EMAIL) return 'dan@gmail.example';
    var first = String(inv.email.split('@')[0] || 'me').split(/[._-]/)[0] || 'me';
    return first + '@gmail.example';
  }
  function inviteVariant(inv) {
    if (inv.status === 'revoked') return 'revoked';
    if (inv.status === 'accepted') return 'accepted';
    if (inv.status === 'expired' || st.inv.variant === 'expired') return 'expired';
    return st.inv.variant === 'mismatch' ? 'mismatch' : 'match';
  }
  A.route('invite', function () {
    ensureStyle();
    var inv = currentInvite();
    if (!inv.profile) return null;
    var variant = inviteVariant(inv);
    var inviterName = inv.inviter ? inv.inviter.name : 'A profile owner';
    var roleLabel = inv.role === 'owner' ? 'Owner' : 'Member';
    var signedInAs = variant === 'mismatch' ? otherEmail(inv) : inv.email;
    var head = '<div class="stack stack-sm"><div class="row">' + (inv.inviter ? ui.avatar(inv.inviter, { size: 'lg' }) : '') +
      '<span class="pf-mark" aria-hidden="true">' + esc(A.initials(inv.profile.name)) + '</span></div>' +
      '<h1 class="adm-auth-title">' + esc(inviterName) + ' invited you to ' + esc(inv.profile.name) + ' · ' + esc(roleLabel) + '</h1></div>';
    var details = ui.dl([
      ['Profile', esc(inv.profile.name)],
      ['Role', esc(roleLabel) + '<span class="cell-sub" style="white-space:normal">' + (inv.role === 'owner' ? 'Reviews and decides, and manages people and settings.' : 'Reviews assets, records decisions and edits copy.') + '</span>'],
      ['Sent to', esc(inv.email)],
      ['Expires', esc(ui.time(inv.expiresAt))]
    ]);
    var body;
    if (variant === 'match') {
      body = head + details +
        '<div class="stack stack-sm">' + ui.button('Accept invite', { action: 'inv-accept', variant: 'default', block: true, size: 'lg', icon: 'check' }) +
          ui.button('Decline', { action: 'inv-decline', variant: 'ghost', block: true }) + '</div>' +
        '<p class="small muted center">Signed in as <strong>' + esc(signedInAs) + '</strong> · ' + ui.button('Not you? Sign out', { action: 'inv-signout', variant: 'link' }) + '</p>';
    } else if (variant === 'mismatch') {
      body = head +
        ui.callout('warning', 'This invite is for ' + inv.email + ' but you’re signed in as ' + signedInAs,
          'Sign out, then sign in with ' + esc(inv.email) + '. Or ask ' + esc(inviterName) + ' to invite ' + esc(signedInAs) + ' instead.') +
        '<div class="stack stack-sm">' +
          ui.button('Sign out and switch account', { action: 'inv-signout', variant: 'default', block: true, size: 'lg', icon: 'log-out' }) +
          withTip(ui.button('Accept invite', { variant: 'outline', block: true, disabled: true }), 'Sign in as ' + inv.email + ' to accept.') +
        '</div>' +
        '<p class="small muted center">Signed in as <strong>' + esc(signedInAs) + '</strong></p>';
    } else if (variant === 'expired') {
      body = head + ui.callout('danger', 'This invite expired on ' + ui.date(inv.expiresAt),
        'Ask ' + esc(inviterName) + ' to send it again. The new link works for 7 days.') +
        ui.button('Go to sign in', { action: 'inv-signout', variant: 'outline', block: true });
    } else if (variant === 'revoked') {
      body = head + ui.callout('danger', 'This invite was revoked', esc(inviterName) + ' turned off this link. Ask them for a new invite if you still need access.') +
        ui.button('Go to sign in', { action: 'inv-signout', variant: 'outline', block: true });
    } else {
      body = head + ui.callout('success', 'This invite was already accepted', 'Sign in with ' + esc(inv.email) + ' to open ' + esc(inv.profile.name) + '.') +
        ui.button('Go to sign in', { action: 'inv-signout', variant: 'outline', block: true });
    }
    var forced = variant === 'revoked' || variant === 'accepted' || inv.status === 'expired';
    var demo = '<div class="adm-demo" aria-label="Prototype controls"><span class="adm-demo-title">prototype controls</span>' +
      (forced ? '<span class="xs muted">This invite is ' + esc(variant === 'expired' ? 'expired' : variant) + ' in the sample data.</span>' :
        '<div class="seg" role="group" aria-label="Invite state">' +
          ['match', 'mismatch', 'expired'].map(function (v) {
            var label = v === 'match' ? 'Invited email' : v === 'mismatch' ? 'Different email' : 'Expired';
            return '<button type="button" data-action="inv-variant" data-variant="' + v + '" aria-pressed="' + (variant === v) + '">' + esc(label) + '</button>';
          }).join('') + '</div>') +
      '<div class="row row-wrap">' +
        (inv.record ? ui.button('Show the sample invite', { action: 'inv-sample', variant: 'link', cls: 'small' }) : '') +
        ui.button('Back to Members & invites', { href: '#members', variant: 'link', cls: 'small' }) +
      '</div>' +
      '<span class="xs muted">Accepting switches the prototype to the new member. Switch back with View as in the account menu.</span>' +
      '</div>';
    return '<div class="adm-auth"><div class="adm-auth-col">' + brand() +
      '<div class="card"><div class="card-body stack-lg stack" style="padding:20px">' + body + '</div></div>' + demo +
      '</div></div>';
  }, { chromeless: true, nav: null, title: 'Invite' });

  A.action('inv-variant', function (el) { st.inv.variant = el.dataset.variant || 'match'; A.rerender(); });
  A.action('inv-sample', function () { st.inv.inviteId = null; st.inv.variant = 'match'; A.rerender(); });
  A.action('inv-signout', function () {
    var inv = currentInvite();
    st.si = freshSi();
    st.si.email = inv.email;
    A.go('#signin');
  });
  A.action('inv-decline', function () {
    var inv = currentInvite();
    A.confirmDialog({
      title: 'Decline this invite?', confirmLabel: 'Decline', action: 'inv-decline-confirm',
      message: 'You won’t join ' + inv.profile.name + '. ' + (inv.inviter ? inv.inviter.name : 'The owner') + ' can invite you again later.'
    });
  });
  A.action('inv-decline-confirm', function () {
    var inv = currentInvite();
    A.closeDialog();
    if (inv.record && inv.record.status === 'pending') {
      inv.record.status = 'revoked';
      inv.record.revokedAt = nowIso();
      A.logProfile(inv.email, 'member', inv.email + ' declined the invite.', inv.profile.id);
      A.emit('data-changed', { kind: 'invite' });
    }
    st.inv = { variant: 'match', inviteId: null };
    A.go('#signin');
    A.toast('Invite declined.');
  });
  A.action('inv-accept', function () {
    var inv = currentInvite(), p = inv.profile;
    if (!p || inviteVariant(inv) !== 'match') return;
    var now = nowIso();
    var u = findUserByEmail(inv.email);
    if (!u) {
      var base = 'u-' + (inv.email.split('@')[0] || 'new').toLowerCase().replace(/[^a-z0-9]+/g, '-'), uid = base, n = 2;
      while (A.userById(uid)) { uid = base + '-' + n; n += 1; }
      var name = nameFromEmail(inv.email);
      u = { id: uid, name: name, email: inv.email, initials: A.initials(name) };
      S().users.push(u);
    }
    p.members = p.members || [];
    var already = p.members.some(function (m) { return m.userId === u.id; });
    if (!already) p.members.push({ userId: u.id, role: inv.role === 'owner' ? 'owner' : 'member', joinedAt: now });
    p.invites = p.invites || [];
    if (inv.record) { inv.record.status = 'accepted'; inv.record.acceptedAt = now; }
    else {
      p.invites.unshift({
        id: A.nextId('inv', p.invites.map(function (i) { return i.id; }), 0), email: inv.email, role: inv.role, invitedBy: inv.inviter ? inv.inviter.id : null,
        status: 'accepted', sentAt: inv.sentAt, expiresAt: inv.expiresAt, acceptedAt: now, sendCount: 1
      });
    }
    var inviterName = inv.inviter ? inv.inviter.name : 'the owner';
    S().currentUserId = u.id;
    S().activeProfileId = p.id;
    if (!already) A.logProfile(u.name, 'member', u.name + ' (' + u.email + ') accepted the invite and joined as ' + (inv.role === 'owner' ? 'Owner' : 'Member') + '.', p.id);
    st.inv = { variant: 'match', inviteId: null };
    A.emit('user-changed', { userId: u.id });
    A.emit('profile-changed', { profileId: p.id });
    A.emit('data-changed', { kind: 'member' });
    A.go('#dashboard');
    A.toast(already ? 'You’re already a member of ' + p.name + '.' :
      'Welcome, ' + u.name + '. You joined ' + p.name + ' as ' + (inv.role === 'owner' ? 'an owner' : 'a member') + '. To return to ' + inviterName + ', use View as in the account menu.', 'success');
  });
})();
