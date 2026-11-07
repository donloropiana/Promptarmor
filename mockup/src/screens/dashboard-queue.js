/* Compliance Workbench prototype: Dashboard (#dashboard) and Queue (#queue).
 * Owns routes: dashboard, queue (queue also accepts a preset param, e.g. #queue-security-alerts).
 * Actions are prefixed dash- and queue-. Uses only window.App and window.DATA.
 */
(function () {
  'use strict';
  var A = window.App, ui = A.ui, esc = A.esc;

  /* ------------------------------------------------------------------ */
  /* Module CSS (theme tokens only)                                      */
  /* ------------------------------------------------------------------ */
  var CSS = `
.dq-row2 { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(300px, 1fr); gap: 16px; align-items: start; }
.dq-row2 > .stack { gap: 16px; }
@media (max-width: 1100px) { .dq-row2 { grid-template-columns: minmax(0, 1fr); } }
.list-item.dq-next { display: grid; grid-template-columns: 118px minmax(0, 1fr) auto auto; gap: 10px; align-items: center; }
.dq-next-main { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.dq-next .cell-title, .dq-next .cell-sub { max-width: none; }
.dq-next-risk { display: flex; min-width: 0; }
@media (max-width: 860px) { .list-item.dq-next { grid-template-columns: 112px minmax(0, 1fr) auto; } }
@media (max-width: 520px) { .list-item.dq-next { grid-template-columns: minmax(0, 1fr) auto; } .dq-next-risk { grid-column: 1 / -1; } }
.dq-src-group { padding: 7px 12px 3px; font-size: 11px; font-weight: 500; color: var(--muted-foreground); border-bottom: 1px solid var(--border); background: color-mix(in oklch, var(--muted) 45%, var(--card)); }
.list-item.dq-src { gap: 8px; }
.dq-src .src-labeled { min-width: 0; flex: 0 1 auto; }
.dq-src-status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; white-space: nowrap; }
.dq-src-time { font-size: 12px; color: var(--muted-foreground); white-space: nowrap; min-width: 52px; text-align: right; font-variant-numeric: tabular-nums; }
.dq-budget-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 12.5px; }
.dq-kpi-headline { grid-column: span 2; }
.dq-kpi-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
.dq-kpi-head .vbars { width: 168px; max-width: 45%; height: 52px; flex: none; }
.dq-kpi-head .vbar { min-height: 3px; }
.dq-firstrun { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
@media (max-width: 1100px) { .dq-firstrun { grid-template-columns: minmax(0, 1fr); } }
.dq-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 860px) { .dq-steps { grid-template-columns: minmax(0, 1fr); } }
.dq-step { display: flex; gap: 12px; padding: 14px; align-items: flex-start; }
.dq-step-num { width: 24px; height: 24px; border-radius: 999px; border: 1px solid var(--border); display: grid; place-items: center; flex: none; font: 600 12px/1 var(--font-sans); color: var(--muted-foreground); background: var(--background); }
.dq-step-num svg.i { width: 14px; height: 14px; }
.dq-step.is-done .dq-step-num { background: var(--st-approved-bg); color: var(--st-approved); border-color: transparent; }
.dq-step-body { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1 1 auto; }
.dq-step-title { font-weight: 600; font-size: 13.5px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dq-howto { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; }
.q-toolbar .select, .q-toolbar .input { width: auto; }
.q-toolbar .select { max-width: 190px; }
.q-search { flex: 0 1 220px; min-width: 160px; }
.q-search .input { width: 100%; }
@media (max-width: 640px) { .q-search { flex: 1 1 100%; } .q-toolbar .select { max-width: none; flex: 1 1 140px; } }
.q-check { display: flex; align-items: center; justify-content: center; margin: -8px -10px; padding: 8px 10px; cursor: pointer; }
.table th .q-check { margin: 0; padding: 0; }
.table-dense .q-check { margin: -5px -10px; padding: 5px 10px; }
.q-title { color: inherit; text-decoration: none; }
.q-title:hover { text-decoration: underline; text-underline-offset: 2px; }
.q-issue { display: flex; align-items: center; gap: 6px; min-width: 180px; max-width: 320px; }
.q-issue > .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.q-issue > svg.i { width: 14px; height: 14px; flex: none; color: var(--muted-foreground); }
.q-issue.is-security { color: var(--st-security-alert); font-weight: 500; }
.q-issue.is-security > svg.i { color: var(--st-security-alert); }
.q-issue .more { flex: none; font-size: 11.5px; color: var(--muted-foreground); }
.cell-title.q-narrow, .cell-sub.q-narrow { max-width: 170px; }
.q-ver { font: 500 12px/1.2 var(--font-mono); white-space: nowrap; }
.q-srcs { display: inline-flex; gap: 4px; }
.q-group { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; }
.q-group .q-group-name { font-weight: 600; font-size: 12.5px; color: var(--foreground); }
.card.q-bulk { padding: 8px 12px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; border-color: var(--ring); }
.q-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: 12px; color: var(--muted-foreground); }
.q-foot .kbd { margin: 0 2px; }
.q-active-filters { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
`;
  try {
    if (document.head && !document.querySelector('style[data-module="dashboard-queue.js"]')) {
      var styleEl = document.createElement('style');
      styleEl.setAttribute('data-module', 'dashboard-queue.js');
      styleEl.textContent = CSS;
      document.head.appendChild(styleEl);
    }
  } catch (e) { /* styling is optional */ }

  /* ------------------------------------------------------------------ */
  /* Labels and small helpers                                            */
  /* ------------------------------------------------------------------ */
  var PRODUCT = { personal_loan: 'Personal loan', credit_card: 'Credit card', mortgage: 'Mortgage' };
  var CHANNEL = {
    paid_social: 'Paid social', display: 'Display', email: 'Email', affiliate_post: 'Affiliate post', direct_mail: 'Direct mail',
    landing_page: 'Landing page', sms: 'SMS', paid_search: 'Paid search', video: 'Video', organic_social: 'Organic social', print: 'Print'
  };
  function human(map, k) {
    if (!k) return '';
    if (map[k]) return map[k];
    var s = String(k).replace(/[_-]+/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  var SEV_RANK = { critical: 3, major: 2, minor: 1 };
  var TERMINAL = { 'approved': 1, 'approved-with-exceptions': 1, 'rejected': 1 };
  var BUCKET = {
    'needs-review': 0, 'recheck-ready': 0, 'needs-manual-review': 0, 're-review-due': 0,
    'preflighting': 1, 'changes-requested': 2, 'approved': 3, 'approved-with-exceptions': 3, 'rejected': 3
  };
  var SRC_ORDER = ['gmail', 'google-drive', 'google-sheets', 'outlook', 'onedrive', 'excel', 'upload'];
  var SRC_STATUS = {
    'connected': { label: 'Connected', dot: 'ok' },
    'syncing': { label: 'Syncing', dot: 'sync' },
    'resyncing-gap': { label: 'Resyncing after gap', dot: 'sync' },
    'needs-reconnect': { label: 'Needs reconnect', dot: 'err' },
    'owner-removed': { label: 'Owner removed', dot: 'warn' },
    'not-connected': { label: 'Not connected', dot: 'off' },
    'error': { label: 'Sync error', dot: 'err' }
  };

  function S() { return A.state; }
  function plural(n, one, many) { return A.plural(n, one, many); }
  function latest(a) { return A.latestVersion(a); }
  function flags(a) { return (a && a.flags) || {}; }
  function ms(iso) { var m = A.toMs(iso); return isNaN(m) ? null : m; }
  function now() { return A.nowMs(); }
  function lower(s) { return String(s || '').toLowerCase(); }
  function firstSentence(s) {
    var t = String(s || '').trim(); if (!t) return '';
    var m = /^(.+?[.!?])(\s|$)/.exec(t);
    return m ? m[1] : t;
  }
  // "Open" here follows the metrics definition: not resolved, not dismissed, not accepted as an exception.
  function openList(v) {
    return A.openFindings(v).filter(function (f) { return f.disposition !== 'accepted-exception'; });
  }
  function topSev(v) {
    var best = null;
    openList(v).forEach(function (f) { if (SEV_RANK[f.severity] && (!best || SEV_RANK[f.severity] > SEV_RANK[best])) best = f.severity; });
    return best;
  }
  function sevCounts(v) {
    var c = { critical: 0, major: 0, minor: 0 };
    openList(v).forEach(function (f) { if (c[f.severity] != null) c[f.severity] += 1; });
    return c;
  }
  function hasSecurity(a) { return A.blockingAlerts(latest(a)).length > 0; }
  function isRunning(a) { var v = latest(a); return a.status === 'preflighting' || !!(v && v.run && v.run.status === 'running'); }
  function notChecked(a) {
    var v = latest(a);
    if (!v || isRunning(a)) return true;
    if (flags(a).extractionFailed) return true;
    return !!(v.run && v.run.status === 'failed' && !(v.findings || []).length);
  }
  function isMine(a) {
    var u = A.me();
    return !!(a && a.submitter && a.submitter.email && u && u.email && lower(a.submitter.email) === lower(u.email));
  }
  function changedAfterApproval(a) { return !!(a.approvedVersionId && a.latestVersionId && a.approvedVersionId !== a.latestVersionId); }
  function dueMs(a) { var m = ms(a.dueDate); return m == null ? Infinity : m; }
  function createdMs(a) {
    var m = ms(a.createdAt);
    if (m != null) return m;
    var v = (a.versions || [])[0];
    return v ? (ms(v.createdAt) || 0) : 0;
  }
  function lastActivity(a) {
    var best = null;
    (a.events || []).forEach(function (e) { var m = ms(e.at); if (m != null && (best == null || m > best)) best = m; });
    (a.versions || []).forEach(function (v) { var m = ms(v.createdAt); if (m != null && (best == null || m > best)) best = m; });
    return best;
  }
  function isoOf(m) { return m == null ? null : new Date(m).toISOString(); }
  function refProvider(ref) {
    var s = ref && ref.sourceId ? A.sourceById(ref.sourceId) : null;
    var p = s ? s.provider : 'upload';
    if (p === 'upload') {
      var l = String((ref && ref.label) || '');
      if (/^paste/i.test(l)) p = 'paste';
      else if (/^import/i.test(l)) p = 'csv';
    }
    return p;
  }
  function providersOf(a) {
    var out = [];
    (a.sourceRefs || []).forEach(function (r) { var p = refProvider(r); if (out.indexOf(p) < 0) out.push(p); });
    if (!out.length) out.push('upload');
    return out;
  }
  function campaignName(a) { var c = a.campaignId ? A.campaignById(a.campaignId) : null; return c ? c.name : ''; }
  function partnerOf(a) { return a.partnerId ? A.partnerById(a.partnerId, a.profileId) || A.partnerById(a.partnerId) : null; }
  function membersOf(p) {
    return ((p && p.members) || []).map(function (m) { return A.userById(m.userId); }).filter(Boolean);
  }
  function metricsProfileId() {
    var m = S().metrics || {};
    return m.profileId || (window.DATA && window.DATA.activeProfileId) || 'p-clearpath';
  }
  function weekStartMs() {
    var today = (S().meta && S().meta.today) || new Date(now()).toISOString().slice(0, 10);
    var d = new Date(today + 'T12:00:00Z');
    var back = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - back);
    return A.toMs(d.toISOString().slice(0, 10) + 'T00:00:00-06:00');
  }

  /* One-line explanation of why an asset is where it is (critique S6). */
  function topIssue(a) {
    var v = latest(a);
    if (!v) return { kind: 'none', icon: 'circle-dashed', text: 'No version yet' };
    var alerts = A.blockingAlerts(v);
    if (alerts.length) {
      var how = String(alerts[0].how || '').split(',')[0];
      return { kind: 'security', icon: 'shield-alert', text: 'Security alert: hidden text' + (how ? ' (' + how + ')' : '') + '. Acknowledge before deciding.' };
    }
    if (isRunning(a)) {
      var steps = (v.run && v.run.pending && v.run.pending.steps) || [];
      var label = a.subLabel || 'Preflight running';
      var idx = steps.indexOf(label);
      return { kind: 'running', icon: 'loader', text: (idx >= 0 ? 'Step ' + (idx + 1) + ' of ' + steps.length + ': ' : 'Preflight: ') + label };
    }
    if (flags(a).extractionFailed) {
      return { kind: 'failed', icon: 'circle-x', text: 'Extraction failed: ' + flags(a).extractionFailed + '. Nothing was checked; review manually.' };
    }
    var open = openList(v).slice().sort(function (x, y) {
      return (SEV_RANK[y.severity] || 0) - (SEV_RANK[x.severity] || 0) ||
        (x.recheck === 'new' ? -1 : 0) - (y.recheck === 'new' ? -1 : 0);
    });
    if (open.length) {
      var f = open[0];
      var rule = f.ruleId ? A.ruleById(f.ruleId) : null;
      var text = f.title || firstSentence(f.explanation) || (rule && rule.title) || 'Open finding';
      return { kind: 'finding', icon: f.recheck === 'new' ? 'plus' : 'alert', sev: f.severity, text: text, more: open.length - 1 };
    }
    if (v.run && v.run.status === 'failed') return { kind: 'failed', icon: 'circle-x', text: v.run.failReason || 'Preflight failed. Review manually.' };
    var exc = A.openFindings(v).filter(function (x) { return x.disposition === 'accepted-exception'; }).length;
    if (exc) return { kind: 'exception', icon: 'alert', text: plural(exc, 'accepted exception') + ' with written justification' };
    if (flags(a).reusedFrom) {
      var rf = flags(a).reusedFrom;
      return { kind: 'clean', icon: 'circle-check', text: 'No issues flagged · analysis reused from ' + (rf.runId || 'an earlier run') + (rf.assetId ? ' (' + rf.assetId + ')' : '') };
    }
    return { kind: 'clean', icon: 'circle-check', text: 'No issues flagged' };
  }

  /* Priority: actionable first, then security alert > Critical > Major > due date > age. */
  function priorityCmp(x, y) {
    var bx = BUCKET[x.status] != null ? BUCKET[x.status] : 4, by = BUCKET[y.status] != null ? BUCKET[y.status] : 4;
    if (bx !== by) return bx - by;
    var sx = hasSecurity(x) ? 1 : 0, sy = hasSecurity(y) ? 1 : 0;
    if (sx !== sy) return sy - sx;
    var tx = topSev(latest(x)), ty = topSev(latest(y));
    var rx = tx === 'critical' ? 2 : tx === 'major' ? 1 : 0, ry = ty === 'critical' ? 2 : ty === 'major' ? 1 : 0;
    if (rx !== ry) return ry - rx;
    var dx = dueMs(x), dy = dueMs(y);
    if (dx !== dy) return dx < dy ? -1 : 1;
    return createdMs(x) - createdMs(y);
  }
  function idNum(a) { return parseInt(String(a.id).replace(/\D/g, ''), 10) || 0; }

  /* Risk cell / badge for an asset. */
  function riskHtml(a) {
    var v = latest(a);
    if (isRunning(a)) return ui.tag('checking', { icon: 'loader', title: 'Preflight is still running' });
    if (notChecked(a)) return ui.tag('not checked', { icon: 'circle-dashed', title: 'Nothing was checked. This never counts as "No issues flagged".' });
    var t = topSev(v);
    return t ? ui.severityBadge(t) : '<span class="small muted">None open</span>';
  }

  /* ------------------------------------------------------------------ */
  /* Shared state                                                        */
  /* ------------------------------------------------------------------ */
  function freshQueue() {
    return {
      tab: 'needs-review', preset: null, q: '',
      f: { product: '', channel: '', source: '', risk: '', partner: '' },
      group: 'none', sort: 'priority', selected: {}, cursorId: null, lastParam: null
    };
  }
  var qs = freshQueue();
  var ds = { budgetPreview: false };
  A.on('reset', function () { qs = freshQueue(); ds = { budgetPreview: false }; });
  A.on('profile-changed', function () { qs = freshQueue(); ds.budgetPreview = false; });

  var TABS = [
    { id: 'needs-review', label: 'Needs review', statuses: ['needs-review', 'needs-manual-review', 're-review-due', 'preflighting'] },
    { id: 'changes-requested', label: 'Changes requested', statuses: ['changes-requested'] },
    { id: 'recheck-ready', label: 'Recheck ready', statuses: ['recheck-ready'] },
    { id: 'approved', label: 'Approved', statuses: ['approved', 'approved-with-exceptions'] },
    { id: 'all', label: 'All', statuses: null }
  ];
  function tabById(id) { return TABS.find(function (t) { return t.id === id; }) || TABS[0]; }
  function inTab(a, tabId) { var t = tabById(tabId); return !t.statuses || t.statuses.indexOf(a.status) >= 0; }

  function defn(key, fallback) { var d = (S().metrics && S().metrics.definitions) || {}; return d[key] || fallback; }
  var PRESETS = {
    'my-decision': {
      label: 'Needs my decision', icon: 'eye',
      desc: function () { return defn('needsMyDecision', 'Status Needs review or Recheck ready, and not submitted by you'); },
      test: function (a) { return (a.status === 'needs-review' || a.status === 'recheck-ready') && !isMine(a); }
    },
    'security-alerts': {
      label: 'Security alerts', icon: 'shield-alert',
      desc: function () { return defn('securityAlerts', 'Latest version has an unacknowledged hidden-text security alert'); },
      test: hasSecurity
    },
    'changed-after-approval': {
      label: 'Changed after approval', icon: 'git-compare',
      desc: function () { return defn('changedAfterApproval', 'An approved version exists and a newer version is not approved'); },
      test: changedAfterApproval
    },
    're-review-due': {
      label: 'Re-review due', icon: 'history',
      desc: function () { return defn('reReviewDue', 'Status Re-review due'); },
      test: function (a) { return a.status === 're-review-due'; }
    },
    'blocked-critical': {
      label: 'Blocked by open Critical', icon: 'octagon-alert',
      desc: function () { return defn('blockedByCritical', 'At least one open Critical finding on the latest version'); },
      test: function (a) { return (a.status === 'needs-review' || a.status === 'recheck-ready' || a.status === 'needs-manual-review') && topSev(latest(a)) === 'critical'; }
    },
    'assigned-to-me': {
      label: 'Assigned to me', icon: 'user',
      desc: function () { return 'Assets assigned to you in this profile'; },
      test: function (a) { return a.assigneeId === A.me().id; }
    }
  };
  function applyPreset(name) {
    var keepGroup = qs.group, keepSort = qs.sort;
    qs = freshQueue();
    qs.group = keepGroup; qs.sort = keepSort;
    if (PRESETS[name]) { qs.preset = name; qs.tab = 'all'; return true; }
    if (TABS.some(function (t) { return t.id === name; })) { qs.tab = name; return true; }
    return false;
  }
  function isValidParam(p) { return !!(PRESETS[p] || TABS.some(function (t) { return t.id === p; })); }

  /* ------------------------------------------------------------------ */
  /* DASHBOARD                                                           */
  /* ------------------------------------------------------------------ */
  function budgetReached(p) {
    var b = (p && p.budget) || {};
    return (b.profileCapUsd != null && (b.profileSpentTodayUsd || 0) >= b.profileCapUsd) ||
      (b.globalCapUsd != null && (b.globalSpentTodayUsd || 0) >= b.globalCapUsd);
  }
  function budgetBanner(p) {
    if (!ds.budgetPreview && !budgetReached(p)) return '';
    var actions = ui.button('View AI spend', { href: '#reports', size: 'sm', icon: 'chart' }) +
      (A.isOwner() ? ui.button('Budget settings', { href: '#profile-prefs', size: 'sm', icon: 'settings-gear', variant: 'ghost' }) : '') +
      (ds.budgetPreview ? ui.button('End preview', { action: 'dash-budget-preview', size: 'sm', variant: 'ghost' }) : '');
    return ui.callout('warning', 'AI budget reached for today' + (ds.budgetPreview ? ' (preview)' : ''),
      'AI preflight is paused until midnight UTC (6:00 PM Central). New assets wait in the queue as <strong>Not AI-screened</strong>. ' +
      'Deterministic checks for offer terms, required disclosures and hidden text still run, and nothing is ever approved automatically.',
      { actionsHtml: actions, id: 'dash-budget-banner', role: 'status', icon: 'pause' });
  }
  function budgetToggle() {
    return '<span class="row row-tight">' +
      '<label class="small muted" for="dash-budget-preview">Preview: budget reached</label>' +
      '<button type="button" class="switch" role="switch" id="dash-budget-preview" data-action="dash-budget-preview" aria-checked="' + (ds.budgetPreview ? 'true' : 'false') + '"' +
      ' title="Shows the banner members see when the daily AI cap is reached"></button></span>';
  }

  function tileHtml(o) {
    var cls = 'tile' + (o.count === 0 ? ' is-zero' : '') + (o.alert && o.count > 0 ? ' is-alert' : '');
    return '<button type="button" class="' + cls + '" data-action="dash-tile" data-preset="' + esc(o.preset) + '" title="' + esc(o.title || '') + '">' +
      '<span class="tile-label">' + A.icon(o.icon) + '<span>' + esc(o.label) + '</span></span>' +
      '<span class="tile-value">' + esc(o.count) + '</span>' +
      '<span class="tile-meta">' + (o.metaHtml || esc(o.meta || '')) + '</span></button>';
  }

  function workTiles(p) {
    var list = A.assetsFor(p.id);
    var mine = list.filter(PRESETS['my-decision'].test);
    var overdue = 0, soon = 0, t = now();
    mine.forEach(function (a) { var d = dueMs(a); if (d === Infinity) return; if (d < t) overdue += 1; else if (d - t < 86400e3) soon += 1; });
    var myMeta = overdue ? plural(overdue, 'overdue', 'overdue') + (soon ? ' · ' + soon + ' due within 24h' : '') :
      soon ? soon + ' due within 24h' : (mine.length ? 'Nothing overdue' : 'You are caught up');

    var recheck = list.filter(function (a) { return a.status === 'recheck-ready'; });
    var nNew = 0, nStill = 0;
    recheck.forEach(function (a) { openList(latest(a)).forEach(function (f) { if (f.recheck === 'new') nNew += 1; else if (f.recheck === 'still-present') nStill += 1; }); });
    var recheckMeta = recheck.length ? (nNew + ' new · ' + nStill + ' still present') : 'No revisions waiting';

    var sec = list.filter(hasSecurity);
    var changed = list.filter(changedAfterApproval);
    var rere = list.filter(PRESETS['re-review-due'].test);
    var pending = S().intake.filter(function (i) { return i.profileId === p.id && i.status === 'pending'; });
    var provs = [];
    pending.forEach(function (i) { var s = A.sourceById(i.sourceId); var l = s ? (A.labels.SOURCES[s.provider] || {}).label || s.provider : 'Upload'; if (provs.indexOf(l) < 0) provs.push(l); });

    return '<div class="grid grid-6">' + [
      tileHtml({ preset: 'my-decision', icon: 'eye', label: 'Needs my decision', count: mine.length, meta: myMeta, title: PRESETS['my-decision'].desc() }),
      tileHtml({ preset: 'recheck-ready', icon: 'refresh', label: 'Recheck ready', count: recheck.length, meta: recheckMeta, title: 'Status Recheck ready: a revised version arrived and was rechecked' }),
      tileHtml({ preset: 'security-alerts', icon: 'shield-alert', label: 'Security alerts', count: sec.length, alert: true, meta: sec.length ? 'Acknowledge before deciding' : 'No hidden text found', title: PRESETS['security-alerts'].desc() }),
      tileHtml({ preset: 'changed-after-approval', icon: 'git-compare', label: 'Changed after approval', count: changed.length, meta: changed.length ? 'Approved version stays live' : 'No approved asset changed', title: PRESETS['changed-after-approval'].desc() }),
      tileHtml({ preset: 're-review-due', icon: 'history', label: 'Re-review due', count: rere.length, meta: rere.length ? 'Offer or rule changed after approval' : 'All approvals current', title: PRESETS['re-review-due'].desc() }),
      tileHtml({ preset: 'intake', icon: 'inbox', label: 'Intake to triage', count: pending.length, meta: pending.length ? 'From ' + provs.join(', ') : 'Triage is clear', title: 'Items from connected mail, drives and sheets that need a person to confirm them' })
    ].join('') + '</div>';
  }

  function nextUpRow(a) {
    var v = latest(a), ti = topIssue(a);
    var risk = hasSecurity(a) ? ui.statusBadge('security-alert') : riskHtml(a);
    return '<a class="list-item dq-next" href="#asset-' + esc(a.id) + '">' +
      '<span class="dq-next-risk">' + risk + '</span>' +
      '<span class="dq-next-main"><span class="cell-title">' + esc(a.title) + '</span>' +
        '<span class="cell-sub">' + esc(a.id) + (v && v.n > 1 ? ' · V' + v.n : '') + ' · ' + esc(ti.text) + '</span></span>' +
      '<span class="hide-mobile">' + ui.statusBadge(a.status) + '</span>' +
      '<span>' + ui.due(a.dueDate) + '</span></a>';
  }

  function nextUpCard(p) {
    var list = A.assetsFor(p.id);
    var work = list.filter(function (a) { return BUCKET[a.status] === 0; }).sort(priorityCmp);
    var shown = work.slice(0, 8);
    var waiting = list.filter(function (a) { return a.status === 'changes-requested'; });
    var oldest = null;
    waiting.forEach(function (a) {
      var crs = (a.changeRequests || []).filter(function (c) { return c.status === 'open'; });
      var at = crs.length ? ms(crs[crs.length - 1].at) : lastActivity(a);
      if (at != null && (oldest == null || at < oldest)) oldest = at;
    });
    var body = shown.length ? '<div class="list list-flush">' + shown.map(nextUpRow).join('') + '</div>' :
      ui.empty('Nothing needs a decision', 'New submissions land here after preflight. Assets waiting on submitters and approved assets are in the queue.', ui.button('Open queue', { href: '#queue', size: 'sm' }));
    var foot = '<div class="card-footer">' +
      (waiting.length ? ui.button(plural(waiting.length, 'asset') + ' waiting on submitters' + (oldest != null ? ' · oldest requested ' + ui.relTime(isoOf(oldest)) : ''), { action: 'dash-tile', data: { preset: 'changes-requested' }, size: 'sm', variant: 'ghost', icon: 'undo' }) :
        '<span class="small muted">No change requests open</span>') +
      '<span class="spacer"></span>' +
      (work.length > shown.length ? '<span class="small muted">+' + (work.length - shown.length) + ' more</span>' : '') +
      ui.button('Open queue', { href: '#queue', size: 'sm', iconRight: 'arrow-right', variant: 'ghost' }) + '</div>';
    return '<section class="card card-flush" aria-labelledby="dash-next-title">' +
      '<div class="card-header with-border"><div><h2 class="card-title" id="dash-next-title">' + A.icon('queue') + 'Next up</h2>' +
      '<p class="card-desc">Security alerts first, then open Critical, then Major, then due date, then age.</p></div>' +
      '<span class="count">' + work.length + '</span></div>' +
      '<div class="card-body">' + body + '</div>' + foot + '</section>';
  }

  function srcStatus(s) {
    var st = SRC_STATUS[s.status] || { label: s.status, dot: 'off' };
    if (s.provider === 'upload' && s.status === 'connected') return { label: 'Ready', dot: 'ok' };
    if (s.status === 'connected' && s.lastSyncAt) {
      var age = now() - (ms(s.lastSyncAt) || now());
      if (age > 2 * 3600e3) return { label: 'Delayed', dot: 'warn' };
    }
    return st;
  }
  function srcRow(s) {
    var st = srcStatus(s);
    var provLabel = (A.labels.SOURCES[s.provider] || {}).label || s.provider;
    if (s.provider === 'upload') provLabel = 'Upload, paste, CSV/XLSX';
    return '<a class="list-item dq-src" href="#intake-sources" title="' + esc(provLabel + ': ' + st.label + (s.account ? ' · ' + s.account : '')) + '">' +
      ui.sourceIcon(s.provider, { label: provLabel }) + (s.illustrative ? ui.illustrative() : '') +
      '<span class="spacer"></span>' +
      '<span class="dq-src-status"><span class="dot dot-' + esc(st.dot) + '" aria-hidden="true"></span>' + esc(st.label) + '</span>' +
      '<span class="dq-src-time">' + (s.lastSyncAt ? esc(ui.relTime(s.lastSyncAt)) : '—') + '</span></a>';
  }
  function intakeHealthCard(p) {
    var srcs = S().sources.filter(function (s) { return s.profileId === p.id; }).sort(function (x, y) {
      var ix = SRC_ORDER.indexOf(x.provider), iy = SRC_ORDER.indexOf(y.provider);
      return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy);
    });
    var groups = [
      { id: 'google', label: 'Google · Gmail, Drive, Sheets', connect: 'Connect Google' },
      { id: 'microsoft', label: 'Microsoft · Outlook, OneDrive, Excel', connect: 'Connect Microsoft', illustrative: true },
      { id: 'direct', label: 'Direct', connect: null }
    ];
    var rows = groups.map(function (g) {
      var inG = srcs.filter(function (s) { return (s.group || (A.labels.SOURCES[s.provider] || {}).group) === g.id; });
      if (!inG.length && !g.connect) return '';
      var head = '<div class="dq-src-group" role="presentation">' + esc(g.label) + '</div>';
      if (!inG.length) {
        return head + '<a class="list-item dq-src" href="#intake-sources">' +
          '<span class="small muted">Not connected</span>' + (g.illustrative ? ui.illustrative() : '') +
          '<span class="spacer"></span><span class="small">' + esc(g.connect) + '</span>' + A.icon('chevron-right') + '</a>';
      }
      return head + inG.map(srcRow).join('');
    }).join('');
    var pending = S().intake.filter(function (i) { return i.profileId === p.id && i.status === 'pending'; }).length;
    return '<section class="card card-flush" aria-labelledby="dash-intake-title">' +
      '<div class="card-header with-border"><div><h2 class="card-title" id="dash-intake-title">' + A.icon('inbox') + 'Intake health</h2>' +
      '<p class="card-desc">Read-only connections. Smart watch finds marketing submissions on its own.</p></div>' +
      ui.button('Sources', { href: '#intake-sources', size: 'sm', variant: 'ghost', iconRight: 'chevron-right' }) + '</div>' +
      '<div class="card-body"><div class="list list-flush">' + rows + '</div></div>' +
      '<div class="card-footer">' + (pending ?
        ui.button(plural(pending, 'item') + ' waiting in Triage', { href: '#intake-triage', size: 'sm', variant: 'ghost', icon: 'inbox', iconRight: 'arrow-right' }) :
        '<span class="small muted">Triage is clear</span>') + '</div></section>';
  }

  function budgetCard(p) {
    var b = p.budget || {};
    var pCap = Number(b.profileCapUsd) || 0, gCap = Number(b.globalCapUsd) || 0;
    var pSpent = Number(b.profileSpentTodayUsd) || 0, gSpent = Number(b.globalSpentTodayUsd) || 0;
    if (ds.budgetPreview) { gSpent = Math.max(gSpent, gSpent + (pCap - pSpent)); pSpent = pCap; }
    function row(label, spent, cap, id) {
      return '<div class="stack stack-sm">' +
        '<div class="dq-budget-row"><span id="' + id + '">' + esc(label) + '</span><span class="num tabular">' + esc(ui.money(spent)) + ' <span class="muted">of ' + esc(ui.money(cap)) + '</span></span></div>' +
        ui.meter(spent, cap, { label: label + ': ' + ui.money(spent) + ' of ' + ui.money(cap) + ' used today' }) + '</div>';
    }
    return '<section class="card" aria-labelledby="dash-budget-title">' +
      '<div class="card-header"><div><h2 class="card-title" id="dash-budget-title">' + A.icon('dollar') + 'AI budget today' + (ds.budgetPreview ? ' ' + ui.tag('preview') : '') + '</h2>' +
      '<p class="card-desc">Per-profile cap inside the deployment-wide cap.</p></div>' +
      ui.button('Cost ledger', { href: '#reports', size: 'sm', variant: 'ghost', iconRight: 'chevron-right' }) + '</div>' +
      '<div class="card-body stack">' +
        row('This profile', pSpent, pCap, 'dash-budget-profile') +
        row('All profiles', gSpent, gCap, 'dash-budget-global') +
        '<p class="xs muted">Resets at midnight UTC. A run that would pass either cap is declined and the asset goes to Needs manual review. Seeded sample runs cost $0.</p>' +
      '</div></section>';
  }

  function kpiTile(o) {
    return '<a class="tile' + (o.cls ? ' ' + o.cls : '') + '" href="#reports" title="' + esc(o.title || 'Open Reports') + '">' +
      '<span class="tile-label"><span>' + esc(o.label) + '</span>' + ui.sample() + '</span>' +
      (o.headHtml || ('<span class="tile-value">' + o.valueHtml + '</span>')) +
      '<span class="tile-meta">' + esc(o.meta) + '</span></a>';
  }
  function kpiSection(p) {
    var m = S().metrics || {};
    var has = p.id === metricsProfileId();
    var notEnough = 'Not enough measured reviews yet (n<5)';
    var dash = '<span aria-hidden="true">—</span><span class="sr-only">No value</span>';

    // Live counts (computed from decisions in this profile).
    var ws = weekStartMs();
    var exceptions = 0;
    A.assetsFor(p.id).forEach(function (a) {
      (a.decisions || []).forEach(function (d) { var t = ms(d.at); if (d.decision === 'approved-with-exceptions' && t != null && t >= ws) exceptions += 1; });
    });
    var b = p.budget || {};
    var spend = Number(b.profileSpentTodayUsd) || 0;

    var weekly = (m.weekly || []).slice(-6);
    var headHtml;
    if (has && m.medianActiveMinutesPerAsset != null) {
      var maxV = Math.max.apply(null, weekly.map(function (w) { return Number(w.medianActiveMinutes) || 0; }).concat([1]));
      var bars = weekly.map(function (w, i) {
        var h = Math.max(4, Math.round((Number(w.medianActiveMinutes) || 0) / maxV * 100));
        return '<span class="vbar' + (i === weekly.length - 1 ? ' is-current' : '') + '" style="height:' + h + '%" title="' + esc('Week of ' + ui.date(w.weekOf) + ': ' + w.medianActiveMinutes + ' min') + '"></span>';
      }).join('');
      var srText = 'Weekly median active minutes: ' + weekly.map(function (w) { return ui.date(w.weekOf) + ' ' + w.medianActiveMinutes; }).join(', ') + '.';
      headHtml = '<span class="dq-kpi-head"><span class="tile-value">' + esc(m.medianActiveMinutesPerAsset) + '<span class="unit">min per asset</span></span>' +
        (weekly.length ? '<span class="vbars" aria-hidden="true">' + bars + '</span><span class="sr-only">' + esc(srText) + '</span>' : '') + '</span>';
    } else {
      headHtml = '<span class="tile-value">' + dash + '</span>';
    }
    var first = weekly[0];
    var headMeta = has ? ('Focused reviewer time from first open to decision, median of ' + (m.medianActiveMinutesN || 'n') + ' decided assets' +
      (first && first.medianActiveMinutes != null ? '. Down from ' + first.medianActiveMinutes + ' min ' + weekly.length + ' weeks ago.' : '.')) : notEnough;

    var tiles = [
      kpiTile({ cls: 'dq-kpi-headline', label: 'Median active reviewer minutes', headHtml: headHtml, meta: headMeta, title: 'Idle time excluded. Open Reports for the full breakdown.' }),
      kpiTile({ label: 'First-pass approval', valueHtml: has && m.firstPassApprovalRate != null ? esc(Math.round(m.firstPassApprovalRate * 100)) + '<span class="unit">%</span>' : dash,
        meta: has ? 'Approved without a change request' : notEnough }),
      kpiTile({ label: 'Rounds to approval', valueHtml: has && m.avgRounds != null ? esc(m.avgRounds) + '<span class="unit">avg</span>' : dash,
        meta: has ? 'Versions reviewed before approval' : notEnough }),
      kpiTile({ label: 'Exceptions this week', valueHtml: esc(exceptions), meta: 'Approvals with written justification; the owner is notified' }),
      kpiTile({ label: 'AI spend today', valueHtml: esc(ui.money(spend)),
        meta: (has && m.costPerAnalyzedVersionUsd != null ? ui.money(m.costPerAnalyzedVersionUsd) + ' per analyzed version' : 'Seeded runs cost $0') })
    ].join('');
    return '<section class="section" aria-labelledby="dash-kpi-title">' +
      '<div class="section-header"><div><h2 class="section-title" id="dash-kpi-title">' + A.icon('chart') + 'Review speed and quality</h2>' +
      '<p class="section-desc">Last 7 days. Speed sits next to its counter-metrics so faster never means sloppier. Values tagged sample are prototype data, not measurements.</p></div>' +
      ui.button('Reports', { href: '#reports', size: 'sm', variant: 'ghost', iconRight: 'chevron-right' }) + '</div>' +
      '<div class="grid grid-6">' + tiles + '</div></section>';
  }

  /* First run: a profile with no assets and no intake. */
  function firstRun(p) {
    var srcs = S().sources.filter(function (s) { return s.profileId === p.id; });
    function groupState(g) {
      var inG = srcs.filter(function (s) { return s.group === g && s.status !== 'not-connected'; });
      if (!inG.length) return null;
      var syncing = inG.some(function (s) { return s.status === 'syncing' || s.status === 'resyncing-gap'; });
      return (inG[0].account ? 'Connected as ' + inG[0].account : 'Connected') + (syncing ? ' · initial discovery running' : '');
    }
    var g = groupState('google'), mcs = groupState('microsoft');
    function step(n, o) {
      return '<li class="card dq-step' + (o.done ? ' is-done' : '') + '">' +
        '<span class="dq-step-num" aria-hidden="true">' + (o.done ? A.icon('check') : n) + '</span>' +
        '<div class="dq-step-body"><div class="dq-step-title">' + esc(o.title) + (o.tagHtml || '') + (o.done ? '<span class="sr-only">(done)</span>' : '') + '</div>' +
        '<p class="small muted">' + esc(o.body) + '</p>' +
        (o.statusText ? '<p class="small success-text">' + A.icon('circle-check') + ' ' + esc(o.statusText) + '</p>' : '') +
        '<div class="row row-wrap">' + o.actionHtml + '</div></div></li>';
    }
    var steps = '<ol class="dq-steps">' +
      step(1, { title: 'Connect Google', done: !!g, statusText: g,
        body: 'One click gives read access to Gmail, Google Drive and Google Sheets. Discovery starts right away and finds marketing submissions on its own.',
        actionHtml: ui.button(g ? 'Manage Google' : 'Connect Google', { href: '#intake-sources', variant: g ? 'outline' : 'default', size: 'sm', icon: 'plug' }) }) +
      step(2, { title: 'Connect Microsoft', done: !!mcs, statusText: mcs, tagHtml: ui.illustrative(),
        body: 'One click gives read access to Outlook, OneDrive and Excel. Same smart watch, no folder picking.',
        actionHtml: ui.button(mcs ? 'Manage Microsoft' : 'Connect Microsoft', { href: '#intake-sources', size: 'sm', icon: 'plug' }) }) +
      step(3, { title: 'Upload, paste or import',
        body: 'Drop files, paste ad copy, or import a CSV/XLSX tracker. Useful for one-off reviews and agency spreadsheets.',
        actionHtml: ui.button('New submission', { href: '#intake-new', size: 'sm', icon: 'upload' }) }) +
      step(4, { title: 'Load sample assets', tagHtml: ui.tag('seeded run, $0'),
        body: 'Copies 4 ClearPath sample assets into this profile with their finished preflight runs. No AI call is made and nothing is spent.',
        actionHtml: ui.button('Load sample assets', { action: 'dash-load-samples', size: 'sm', icon: 'layers' }) }) +
      '</ol>';
    var side = '<aside class="card" aria-labelledby="dash-howto-title"><div class="card-header"><h2 class="card-title" id="dash-howto-title">' + A.icon('info') + 'How review works here</h2></div>' +
      '<div class="card-body stack"><ol class="dq-howto">' +
        '<li>Connected mail and drives are read, never written to. New submissions and revisions are picked up automatically.</li>' +
        '<li>Each asset is checked against this profile’s rules and offer catalog. ' + ui.aiChip() + '</li>' +
        '<li>A member decides. AI never approves, and every decision is recorded against the exact version.</li>' +
        '<li>Change requests are saved in the app; copy the checklist as text to share it wherever you already talk to the submitter.</li>' +
      '</ol><div class="row row-wrap">' +
        ui.button('Invite members', { href: '#members', size: 'sm', variant: 'ghost', icon: 'user-plus' }) +
        ui.button('Review rules', { href: '#policies-rules', size: 'sm', variant: 'ghost', icon: 'book' }) +
      '</div></div></aside>';
    return '<div class="page">' +
      '<div class="page-header"><div class="page-heading"><span class="page-eyebrow">' + esc(p.name) + '</span>' +
        '<h1 class="page-title">Set up ' + esc(p.name) + '</h1>' +
        '<p class="page-desc">This profile has no assets yet. Start anywhere; you can add the other sources later.</p></div>' +
        '<div class="page-actions">' + budgetToggle() + '</div></div>' +
      budgetBanner(p) +
      '<div class="dq-firstrun"><section class="section" aria-label="Setup steps">' + steps + '</section>' + side + '</div>' +
      '</div>';
  }

  function renderDashboard(param) {
    if (param) return null;
    var p = A.profile();
    if (!p) return A.notFound('No profile selected.');
    var hasAssets = A.assetsFor(p.id).length > 0;
    var hasIntake = S().intake.some(function (i) { return i.profileId === p.id; });
    if (!hasAssets && !hasIntake) return firstRun(p);
    return '<div class="page">' +
      '<div class="page-header"><div class="page-heading"><span class="page-eyebrow">' + esc(p.name) + '</span>' +
        '<h1 class="page-title">Dashboard</h1>' +
        '<p class="page-desc">What needs a decision, what is arriving, and how review time is trending.</p></div>' +
        '<div class="page-actions">' + budgetToggle() +
          ui.button('New submission', { href: '#intake-new', size: 'sm', icon: 'plus' }) +
          ui.button('Open queue', { href: '#queue', size: 'sm', variant: 'default', icon: 'queue' }) + '</div></div>' +
      budgetBanner(p) +
      '<section class="section" aria-labelledby="dash-work-title"><div class="section-header"><h2 class="section-title" id="dash-work-title">' + A.icon('dashboard') + 'My work</h2>' +
        '<span class="section-desc">Live counts for this profile. Each tile opens the queue filtered to exactly these assets.</span></div>' +
        workTiles(p) + '</section>' +
      '<div class="dq-row2">' + nextUpCard(p) + '<div class="stack">' + intakeHealthCard(p) + budgetCard(p) + '</div></div>' +
      kpiSection(p) +
      '</div>';
  }

  A.route('dashboard', renderDashboard, { nav: 'dashboard', title: 'Dashboard' });

  A.action('dash-tile', function (el) {
    var preset = el.getAttribute('data-preset');
    if (preset === 'intake') { A.go('#intake-triage'); return; }
    applyPreset(preset);
    A.go('#queue');
  });
  A.action('dash-budget-preview', function () {
    ds.budgetPreview = !ds.budgetPreview;
    A.rerender();
    A.toast(ds.budgetPreview ? 'Previewing the "budget reached" state. Nothing was paused.' : 'Preview ended.', 'info');
  });

  /* Load sample assets into an empty profile (copies with seeded $0 runs). */
  var SAMPLE_IDS = ['A-101', 'A-103', 'A-104', 'A-109'];
  A.action('dash-load-samples', function () {
    var p = A.profile(); if (!p) return;
    var seed = (window.DATA && window.DATA.assets) || [];
    var seedProfiles = (window.DATA && window.DATA.profiles) || [];
    var seedCampaigns = (window.DATA && window.DATA.campaigns) || [];
    var u = A.me(), at = A.nowIso();
    var st = S();

    // A direct "upload" source so provenance points inside this profile.
    var up = st.sources.find(function (s) { return s.profileId === p.id && s.provider === 'upload'; });
    if (!up) {
      up = { id: 'src-upload-' + String(p.id).replace(/^p-/, ''), profileId: p.id, provider: 'upload', group: 'direct', account: null, connectedBy: null,
        status: 'connected', illustrative: false, watch: null, watchDetail: 'Upload files, paste copy, or import CSV/XLSX', lastSyncAt: at, itemsFound: 0, syncLog: [] };
      st.sources.push(up);
    }
    var assetIds = st.assets.map(function (x) { return x.id; });
    var runIds = [], decIds = [], crIds = [];
    st.assets.forEach(function (x) {
      (x.versions || []).forEach(function (v) { if (v.run && v.run.id) runIds.push(v.run.id); });
      (x.decisions || []).forEach(function (d) { decIds.push(d.id); });
      (x.changeRequests || []).forEach(function (c) { crIds.push(c.id); });
    });
    (st.costLedger || []).forEach(function (c) { if (c.runId) runIds.push(c.runId); });

    function mapCampaign(cid) {
      if (!cid) return null;
      var src = seedCampaigns.find(function (c) { return c.id === cid; }) || A.campaignById(cid);
      if (!src) return null;
      var hit = st.campaigns.find(function (c) { return c.profileId === p.id && c.name === src.name; });
      if (hit) return hit.id;
      var nid = 'c-' + String(p.id).replace(/^p-/, '') + '-' + String(cid).replace(/^c-/, '');
      st.campaigns.push({ id: nid, profileId: p.id, name: src.name });
      return nid;
    }
    function mapPartner(pid) {
      if (!pid) return null;
      p.partners = p.partners || [];
      if (p.partners.some(function (x) { return x.id === pid; })) return pid;
      var src = null;
      seedProfiles.forEach(function (sp) { (sp.partners || []).forEach(function (x) { if (x.id === pid) src = x; }); });
      if (!src) src = A.partnerById(pid);
      if (!src) return null;
      p.partners.push(A.clone(src));
      return pid;
    }

    var loaded = [];
    SAMPLE_IDS.forEach(function (oldId) {
      var src = seed.find(function (x) { return x.id === oldId; }) || A.asset(oldId, { anyProfile: true });
      if (!src) return;
      var a = A.clone(src);
      var newId = A.nextId('A', assetIds, 100); assetIds.push(newId);
      var oldNum = String(oldId).replace(/\D/g, ''), newNum = String(newId).replace(/\D/g, '');
      var fre = new RegExp('^F' + oldNum + '(?=-)');
      var remapF = function (id) { return id == null ? id : String(id).replace(fre, 'F' + newNum); };
      var vmap = {};
      a.id = newId;
      a.profileId = p.id;
      (a.versions || []).forEach(function (v) {
        var nvid = newId + '-v' + v.n;
        vmap[v.id] = nvid; v.id = nvid;
        (v.findings || []).forEach(function (f) { f.id = remapF(f.id); if (f.carriedFrom) f.carriedFrom = remapF(f.carriedFrom); });
        if (v.run) {
          var rid = A.nextId('R', runIds, 5500); runIds.push(rid);
          v.run.seededFrom = v.run.id;
          v.run.id = rid;
          v.run.costUsd = 0;
          v.run.seeded = true;
          delete v.run.reusedFrom;
          v.run.note = 'Seeded run copied from the sample set (' + (v.run.seededFrom || 'sample') + '). $0: no AI call was made.';
        }
      });
      a.latestVersionId = vmap[a.latestVersionId] || (a.versions.length ? a.versions[a.versions.length - 1].id : null);
      a.approvedVersionId = a.approvedVersionId ? (vmap[a.approvedVersionId] || null) : null;
      (a.decisions || []).forEach(function (d) {
        d.id = A.nextId('D', decIds, 900); decIds.push(d.id);
        d.versionId = vmap[d.versionId] || d.versionId;
        (d.exceptions || []).forEach(function (e) { e.findingId = remapF(e.findingId); });
      });
      (a.changeRequests || []).forEach(function (c) {
        c.id = A.nextId('CR', crIds, 300); crIds.push(c.id);
        c.versionId = vmap[c.versionId] || c.versionId;
        if (c.responseVersionId) c.responseVersionId = vmap[c.responseVersionId] || c.responseVersionId;
        (c.items || []).forEach(function (i) { i.findingId = remapF(i.findingId); });
      });
      a.campaignId = mapCampaign(a.campaignId);
      a.partnerId = mapPartner(a.partnerId);
      a.flags = a.flags || {};
      delete a.flags.reusedFrom;
      a.assigneeId = null;
      a.sourceRefs = [{ sourceId: up.id, label: 'Sample set: copy of ' + oldId + ' from ClearPath Financial', seenAt: at }];
      a.events = [{ at: at, actor: u.name, kind: 'intake', text: 'Loaded from the sample set (copy of ' + oldId + '). Seeded run, $0: no AI call was made.' }];
      st.assets.push(a);
      loaded.push(newId);
    });
    if (!loaded.length) { A.toast('Sample assets are not available in this build.', 'error'); return; }
    up.itemsFound = (up.itemsFound || 0) + loaded.length;
    A.logProfile(u.name, 'sample', 'Loaded ' + plural(loaded.length, 'sample asset') + ' (' + loaded.join(', ') + '). Seeded runs, $0.');
    A.emit('data-changed', { kind: 'sample-assets', profileId: p.id, assetIds: loaded });
    A.rerender();
    A.toast('Loaded ' + plural(loaded.length, 'sample asset') + ' with seeded runs. $0 spent.', 'success');
  });

  /* ------------------------------------------------------------------ */
  /* QUEUE                                                               */
  /* ------------------------------------------------------------------ */
  function filtersActive() {
    var f = qs.f;
    return !!(f.product || f.channel || f.source || f.risk || f.partner || qs.q.trim());
  }
  function passFilters(a) {
    var f = qs.f;
    if (qs.preset && PRESETS[qs.preset] && !PRESETS[qs.preset].test(a)) return false;
    if (f.product && a.product !== f.product) return false;
    if (f.channel && a.channel !== f.channel) return false;
    if (f.source && providersOf(a).indexOf(f.source) < 0) return false;
    if (f.partner) {
      if (f.partner === 'internal') { if (a.partnerId) return false; }
      else if (a.partnerId !== f.partner) return false;
    }
    if (f.risk) {
      var t = topSev(latest(a));
      if (f.risk === 'security' && !hasSecurity(a)) return false;
      if (f.risk === 'not-checked' && !notChecked(a)) return false;
      if (f.risk === 'critical' && (notChecked(a) || t !== 'critical')) return false;
      if (f.risk === 'major' && (notChecked(a) || t !== 'major')) return false;
      if (f.risk === 'minor' && (notChecked(a) || t !== 'minor')) return false;
      if (f.risk === 'none' && (notChecked(a) || t)) return false;
    }
    var q = lower(qs.q).trim();
    if (q) {
      var hay = lower(a.id + ' ' + a.id.replace('-', '') + ' ' + a.title + ' ' + (a.submitter ? a.submitter.name : '') + ' ' + campaignName(a));
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  }
  function sortRows(rows) {
    var s = qs.sort;
    return rows.sort(function (x, y) {
      if (s === 'due') { var d = dueMs(x) - dueMs(y); return d || priorityCmp(x, y); }
      if (s === 'updated') { return (lastActivity(y) || 0) - (lastActivity(x) || 0); }
      if (s === 'id') { return idNum(x) - idNum(y); }
      return priorityCmp(x, y);
    });
  }
  var GROUPS = {
    campaign: { label: 'Campaign', key: function (a) { return a.campaignId || ''; }, name: function (a) { return campaignName(a) || 'No campaign'; } },
    partner: { label: 'Partner', key: function (a) { return a.partnerId || ''; }, name: function (a) { var pt = partnerOf(a); return pt ? pt.name + ' (' + (pt.type === 'affiliate' ? 'affiliate' : 'agency') + ')' : 'Internal (no partner)'; } },
    product: { label: 'Product', key: function (a) { return a.product || ''; }, name: function (a) { return human(PRODUCT, a.product) || 'No product'; } },
    channel: { label: 'Channel', key: function (a) { return a.channel || ''; }, name: function (a) { return human(CHANNEL, a.channel) || 'No channel'; } }
  };
  var STATUS_ORDER = ['needs-review', 'needs-manual-review', 'recheck-ready', 're-review-due', 'preflighting', 'changes-requested', 'approved', 'approved-with-exceptions', 'rejected'];

  function groupHeader(name, items) {
    var counts = {};
    items.forEach(function (a) { counts[a.status] = (counts[a.status] || 0) + 1; });
    var approved = (counts['approved'] || 0) + (counts['approved-with-exceptions'] || 0);
    var blocked = items.filter(function (a) { return !TERMINAL[a.status] && topSev(latest(a)) === 'critical'; }).length;
    var badges = STATUS_ORDER.filter(function (s) { return counts[s]; }).map(function (s) { return ui.statusBadge(s, String(counts[s])); }).join('');
    return '<div class="q-group"><span class="q-group-name">' + esc(name) + '</span>' +
      '<span class="muted">' + esc(plural(items.length, 'asset') + ' · ' + approved + ' of ' + items.length + ' approved' + (blocked ? ' · ' + blocked + ' blocked by open Critical' : '')) + '</span>' +
      badges + '</div>';
  }

  function statusCell(a) {
    var sub = '';
    var badge;
    if (a.status === 'approved' || a.status === 'approved-with-exceptions') {
      var av = a.approvedVersionId ? A.version(a, a.approvedVersionId) : null;
      badge = ui.statusBadge(a.status, av ? 'V' + av.n : null);
      var bits = [];
      if (flags(a).selfApproved) bits.push('Self-approved');
      var exN = flags(a).exceptionsCount;
      if (exN == null) {
        var lastD = (a.decisions || []).filter(function (d) { return d.decision === 'approved-with-exceptions'; }).pop();
        exN = lastD ? (lastD.exceptions || []).length : 0;
      }
      if (a.status === 'approved-with-exceptions' && exN) bits.push(plural(exN, 'exception'));
      sub = bits.join(' · ');
    } else {
      badge = ui.statusBadge(a.status);
      sub = a.subLabel && a.subLabel !== 'Has findings' ? a.subLabel : '';
    }
    return badge + (sub ? '<span class="cell-sub q-narrow" title="' + esc(sub) + '">' + esc(sub) + '</span>' : '');
  }

  function queueColumns(visibleRows) {
    var ids = visibleRows.map(function (a) { return a.id; });
    var nSel = ids.filter(function (id) { return qs.selected[id]; }).length;
    var allSel = ids.length > 0 && nSel === ids.length;
    return [
      { key: 'sel', label: 'Select', shrink: true,
        headerHtml: '<label class="q-check" data-action="app-noop"><input type="checkbox" id="q-select-all" data-action="queue-select-all" aria-label="Select all assets in this view"' +
          (allSel ? ' checked' : '') + (ids.length ? '' : ' disabled') + ' data-some="' + (nSel > 0 && !allSel ? '1' : '0') + '"></label>',
        render: function (a) {
          return '<label class="q-check" data-action="app-noop"><input type="checkbox" id="q-select-' + esc(a.id) + '" data-action="queue-select" data-asset-id="' + esc(a.id) + '" aria-label="Select ' + esc(a.id) + '"' + (qs.selected[a.id] ? ' checked' : '') + '></label>';
        } },
      { key: 'asset', label: 'Asset', render: function (a) {
        var tags = [];
        var cn = campaignName(a);
        if (flags(a).possibleInjection) tags.push(ui.tag('possible injection', { icon: 'alert', title: 'Visible text addressed to AI systems. Shown as a warning; it does not block deciding.' }));
        if (flags(a).reusedFrom) tags.push(ui.tag('reused', { icon: 'copy', title: 'Analysis reused from ' + (flags(a).reusedFrom.runId || 'an earlier run') + ' at $0' }));
        if (isMine(a)) tags.push(ui.tag('you submitted', { icon: 'user' }));
        return '<a class="cell-title q-title" href="#asset-' + esc(a.id) + '" title="' + esc(a.title) + '">' + esc(a.title) + '</a>' +
          '<span class="cell-sub">' + '<span class="mono">' + esc(a.id) + '</span>' + (cn ? ' · ' + esc(cn) : '') + ' · ' + esc(human(PRODUCT, a.product)) + ' · ' + esc(human(CHANNEL, a.channel)) +
          (tags.length ? ' ' + tags.join(' ') : '') + '</span>';
      } },
      { key: 'issue', label: 'Top issue', render: function (a) {
        var ti = topIssue(a);
        var ic = ti.kind === 'running' ? A.icon('loader', { cls: 'spin' }) : A.icon(ti.icon || 'info');
        return '<span class="q-issue' + (ti.kind === 'security' ? ' is-security' : '') + '" title="' + esc(ti.text) + '">' + ic +
          '<span class="t">' + esc(ti.text) + '</span>' + (ti.more ? '<span class="more">+' + ti.more + '</span>' : '') + '</span>';
      } },
      { key: 'risk', label: 'Risk', shrink: true, render: riskHtml },
      { key: 'open', label: 'Open', align: 'right', shrink: true, render: function (a) {
        if (notChecked(a)) return '<span class="muted" title="Not checked">—</span>';
        var c = sevCounts(latest(a));
        var n = c.critical + c.major + c.minor;
        var tip = n ? [c.critical ? c.critical + ' Critical' : '', c.major ? c.major + ' Major' : '', c.minor ? c.minor + ' Minor' : ''].filter(Boolean).join(', ') : 'No open findings';
        return '<span title="' + esc(tip) + '"' + (n ? '' : ' class="muted"') + '>' + n + '</span><span class="sr-only"> (' + esc(tip) + ')</span>';
      } },
      { key: 'version', label: 'Version', shrink: true, render: function (a) {
        var v = latest(a); var n = v ? v.n : 1;
        var html = '<span class="q-ver" title="' + esc(n > 1 ? 'V' + n + ' is the latest of ' + n + ' versions; it changed since V' + (n - 1) : 'First version') + '">V' + n +
          (n > 1 ? ' <span aria-hidden="true">Δ</span><span class="sr-only">, changed since V' + (n - 1) + '</span>' : '') + '</span>';
        if (changedAfterApproval(a)) {
          var av = A.version(a, a.approvedVersionId);
          if (av) html += '<span class="cell-sub">V' + av.n + ' approved</span>';
        }
        return html;
      } },
      { key: 'source', label: 'Source', shrink: true, render: function (a) {
        return '<span class="q-srcs">' + providersOf(a).map(function (pv) { return ui.sourceIcon(pv); }).join('') + '</span>';
      } },
      { key: 'submitter', label: 'Submitter', render: function (a) {
        var s = a.submitter || {};
        var pt = partnerOf(a);
        var kind = isMine(a) ? 'You' : s.kind === 'partner' ? (pt ? (pt.type === 'affiliate' ? 'Affiliate' : 'Agency') : 'Partner') : 'Member';
        return '<span class="cell-title q-narrow" title="' + esc(s.name || '') + '">' + esc(s.name || 'Unknown') + '</span><span class="cell-sub">' + esc(kind) + '</span>';
      } },
      { key: 'status', label: 'Status', render: statusCell },
      { key: 'due', label: 'Due', shrink: true, render: function (a) {
        if (TERMINAL[a.status]) return a.dueDate ? '<span class="small muted nowrap" title="Was due ' + esc(ui.time(a.dueDate)) + '">' + esc(ui.date(a.dueDate)) + '</span>' : '<span class="muted">—</span>';
        return ui.due(a.dueDate);
      } },
      { key: 'updated', label: 'Updated', shrink: true, render: function (a) {
        var m = lastActivity(a); if (m == null) return '<span class="muted">—</span>';
        var iso = isoOf(m);
        return '<span class="small nowrap" title="' + esc(ui.time(iso)) + '">' + esc(ui.relTime(iso)) + '</span>';
      } },
      { key: 'assignee', label: 'Assignee', shrink: true, align: 'center', render: function (a) {
        var u = a.assigneeId ? A.userById(a.assigneeId) : null;
        return u ? ui.avatar(u, { size: 'sm' }) : '<span class="muted" title="Unassigned">—</span><span class="sr-only">Unassigned</span>';
      } }
    ];
  }

  function emptyFor(tabId) {
    if (filtersActive() || qs.preset) {
      return ui.empty('No assets match', 'Nothing in this tab matches the current filters.', ui.button('Clear filters', { action: 'queue-clear', size: 'sm' }));
    }
    var msg = {
      'needs-review': ['Nothing waits for review', 'New submissions from connected mail, drives and uploads land here after preflight.'],
      'changes-requested': ['No change requests open', 'When you request changes, the asset waits here until the revision arrives the same way the original did.'],
      'recheck-ready': ['No revisions to recheck', 'When a revised version arrives, it lands here showing what was resolved, what remains and what is new.'],
      'approved': ['Nothing approved yet', 'Approved versions show here with their version number and any exceptions.'],
      'all': ['No assets in this profile yet', 'Connect Google or Microsoft, or upload a file, to start.']
    }[tabId] || ['Nothing here', ''];
    var act = tabId === 'all' ? '<div class="row" style="justify-content:center">' + ui.button('Connect a source', { href: '#intake-sources', size: 'sm', icon: 'plug' }) +
      ui.button('New submission', { href: '#intake-new', size: 'sm', icon: 'upload' }) + '</div>' : '';
    return ui.empty(msg[0], msg[1], act);
  }

  function optionsFrom(list, keyFn, labelFn, allLabel) {
    var seen = {}, out = [{ value: '', label: allLabel }];
    list.forEach(function (a) { var k = keyFn(a); if (k && !seen[k]) { seen[k] = 1; out.push({ value: k, label: labelFn(k, a) }); } });
    return [out[0]].concat(out.slice(1).sort(function (x, y) { return x.label < y.label ? -1 : 1; }));
  }
  function filterSelect(id, key, label, opts) {
    return '<label class="sr-only" for="' + id + '">' + esc(label) + '</label>' +
      ui.select(id, opts, qs.f[key], { change: 'queue-filter', data: { key: key }, size: 'sm' });
  }

  function renderQueue(param) {
    if (param) {
      if (!isValidParam(param)) return null;
      if (param !== qs.lastParam) { applyPreset(param); qs.lastParam = param; }
    } else {
      qs.lastParam = null;
    }
    var p = A.profile();
    if (!p) return A.notFound('No profile selected.');
    var all = A.assetsFor(p.id);
    var base = all.filter(passFilters);
    var counts = {};
    TABS.forEach(function (t) { counts[t.id] = base.filter(function (a) { return inTab(a, t.id); }).length; });
    var rows = sortRows(base.filter(function (a) { return inTab(a, qs.tab); }));

    // Prune selection and cursor to what is visible.
    var visibleIds = {};
    rows.forEach(function (a) { visibleIds[a.id] = 1; });
    Object.keys(qs.selected).forEach(function (id) { if (!visibleIds[id]) delete qs.selected[id]; });
    if (qs.cursorId && !visibleIds[qs.cursorId]) qs.cursorId = null;
    var nSel = Object.keys(qs.selected).length;

    // Grouping.
    var tableRows = rows;
    var g = GROUPS[qs.group];
    if (g) {
      var order = [], buckets = {};
      rows.forEach(function (a) {
        var k = g.key(a);
        if (!buckets[k]) { buckets[k] = { name: g.name(a), items: [] }; order.push(k); }
        buckets[k].items.push(a);
      });
      order.sort(function (x, y) {
        if (!x && y) return 1;
        if (x && !y) return -1;
        return buckets[x].name < buckets[y].name ? -1 : buckets[x].name > buckets[y].name ? 1 : 0;
      });
      tableRows = [];
      order.forEach(function (k) {
        tableRows.push({ _groupHtml: groupHeader(buckets[k].name, buckets[k].items) });
        buckets[k].items.forEach(function (a) { tableRows.push(a); });
      });
    }

    var tabsHtml = ui.tabs('q-tabs', TABS.map(function (t) { return { id: t.id, label: t.label, count: counts[t.id] }; }), qs.tab, 'queue-tab', { label: 'Queue status' });

    var products = optionsFrom(all, function (a) { return a.product; }, function (k) { return human(PRODUCT, k); }, 'All products');
    var channels = optionsFrom(all, function (a) { return a.channel; }, function (k) { return human(CHANNEL, k); }, 'All channels');
    var provSeen = {}, sources = [{ value: '', label: 'All sources' }];
    all.forEach(function (a) { providersOf(a).forEach(function (pv) { provSeen[pv] = 1; }); });
    ['gmail', 'google-drive', 'google-sheets', 'outlook', 'onedrive', 'excel', 'upload', 'paste', 'csv'].forEach(function (pv) {
      if (provSeen[pv]) sources.push({ value: pv, label: (A.labels.SOURCES[pv] || {}).label || pv });
    });
    var partners = [{ value: '', label: 'All partners' }, { value: 'internal', label: 'Internal (no partner)' }].concat((p.partners || []).map(function (pt) {
      return { value: pt.id, label: pt.name + ' (' + (pt.type === 'affiliate' ? 'affiliate' : 'agency') + ')' };
    }));
    var risks = [
      { value: '', label: 'Any risk' }, { value: 'security', label: 'Security alert' }, { value: 'critical', label: 'Top: Critical' },
      { value: 'major', label: 'Top: Major' }, { value: 'minor', label: 'Top: Minor' }, { value: 'none', label: 'No open findings' }, { value: 'not-checked', label: 'Not checked' }
    ];

    var toolbar = '<div class="toolbar q-toolbar" role="group" aria-label="Filters">' +
      '<div class="input-group q-search">' + A.icon('search') +
        '<label class="sr-only" for="q-search">Filter by title, ID, submitter or campaign</label>' +
        '<input class="input input-sm" id="q-search" type="search" autocomplete="off" spellcheck="false" placeholder="Filter by title or ID" data-input="queue-search" value="' + esc(qs.q) + '"></div>' +
      filterSelect('q-f-product', 'product', 'Product', products) +
      filterSelect('q-f-channel', 'channel', 'Channel', channels) +
      filterSelect('q-f-source', 'source', 'Source', sources) +
      filterSelect('q-f-risk', 'risk', 'Risk', risks) +
      filterSelect('q-f-partner', 'partner', 'Partner', partners) +
      '<span class="spacer"></span>' +
      '<span class="row row-tight"><label class="small muted nowrap" for="q-group">Group by</label>' +
        ui.select('q-group', [{ value: 'none', label: 'None' }, { value: 'campaign', label: 'Campaign' }, { value: 'partner', label: 'Partner' }, { value: 'product', label: 'Product' }, { value: 'channel', label: 'Channel' }], qs.group, { change: 'queue-group', size: 'sm' }) + '</span>' +
      '<span class="row row-tight"><label class="small muted nowrap" for="q-sort">Sort</label>' +
        ui.select('q-sort', [{ value: 'priority', label: 'Priority' }, { value: 'due', label: 'Due date' }, { value: 'updated', label: 'Recently updated' }, { value: 'id', label: 'Asset ID' }], qs.sort, { change: 'queue-sort', size: 'sm' }) + '</span>' +
      '</div>';

    var chips = [];
    if (qs.preset && PRESETS[qs.preset]) {
      var pr = PRESETS[qs.preset];
      chips.push('<span class="chip chip-sm" title="' + esc(pr.desc()) + '">' + A.icon(pr.icon) + '<span class="truncate">' + esc(pr.label) + '</span>' +
        '<button type="button" class="chip-x" data-action="queue-clear-preset" aria-label="Remove filter: ' + esc(pr.label) + '">' + A.icon('x') + '</button></span>');
    }
    var activeBar = (chips.length || filtersActive()) ? '<div class="q-active-filters">' + chips.join('') +
      (filtersActive() || qs.preset ? ui.button('Clear filters', { action: 'queue-clear', size: 'sm', variant: 'ghost', icon: 'x' }) : '') +
      (qs.preset ? '<span class="small muted">' + esc(PRESETS[qs.preset].desc()) + '</span>' : '') + '</div>' : '';

    var bulk = nSel ? '<div class="card q-bulk" role="region" aria-label="Bulk actions">' +
      '<span class="strong">' + esc(nSel + ' selected') + '</span>' +
      ui.button('Assign', { action: 'queue-bulk-assign', size: 'sm', icon: 'user-plus', kbd: 'A' }) +
      ui.button('Set due date', { action: 'queue-bulk-due', size: 'sm', icon: 'calendar' }) +
      ui.button('Clear selection', { action: 'queue-clear-selection', size: 'sm', variant: 'ghost' }) +
      '<span class="spacer"></span><span class="small muted">No bulk approve. Each decision is made on one asset, in the workbench.</span></div>' : '';

    var table = ui.table(queueColumns(rows), tableRows, {
      id: 'q-table', dense: true, caption: 'Assets in ' + p.name + ', ' + tabById(qs.tab).label,
      empty: emptyFor(qs.tab),
      rowAttrs: function (a) {
        return {
          'class': 'clickable' + (a.id === qs.cursorId ? ' is-active' : '') + (qs.selected[a.id] ? ' is-selected' : ''),
          'data-action': 'queue-row', 'data-asset-id': a.id, 'data-row-id': a.id
        };
      }
    });

    var foot = '<div class="q-foot"><span>' + esc('Showing ' + rows.length + ' of ' + all.length + ' ' + (all.length === 1 ? 'asset' : 'assets') + ' in ' + p.name) + '</span>' +
      '<span class="hide-mobile">' + ui.kbd('J') + ui.kbd('K') + ' move · ' + ui.kbd('Enter') + ' open · ' + ui.kbd('X') + ' select · ' + ui.kbd('A') + ' assign · ' + ui.kbd('?') + ' all shortcuts</span></div>';

    return '<div class="page">' +
      '<div class="page-header"><div class="page-heading"><span class="page-eyebrow">' + esc(p.name) + '</span><h1 class="page-title">Queue</h1>' +
        '<p class="page-desc">Every asset in this profile, riskiest first. Open one to review it; approvals happen one asset at a time.</p></div>' +
        '<div class="page-actions">' + ui.button('Export view', { action: 'queue-export', size: 'sm', icon: 'copy' }) +
          ui.button('New submission', { href: '#intake-new', size: 'sm', variant: 'default', icon: 'plus' }) + '</div></div>' +
      tabsHtml + toolbar + activeBar + bulk + table + foot +
      '<div id="q-live" class="sr-only" aria-live="polite"></div>' +
      '</div>';
  }

  A.route('queue', renderQueue, { nav: 'queue', title: 'Queue' });

  /* Wire what click delegation cannot: indeterminate state of select-all. */
  A.on('rendered', function (r) {
    if (r.name !== 'queue') return;
    var all = document.getElementById('q-select-all');
    if (all) all.indeterminate = all.getAttribute('data-some') === '1';
    if (qs.cursorId) {
      var tr = rowEl(qs.cursorId);
      if (tr && r.nav) { try { tr.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }
    }
  });

  function rowEls() { return Array.prototype.slice.call(document.querySelectorAll('#q-table tbody tr[data-row-id]')); }
  function rowEl(id) { return rowEls().find(function (tr) { return tr.getAttribute('data-row-id') === id; }) || null; }
  function setCursor(id) {
    qs.cursorId = id;
    rowEls().forEach(function (tr) { tr.classList.toggle('is-active', tr.getAttribute('data-row-id') === id); });
    var tr = rowEl(id);
    if (tr) {
      try { tr.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ }
      var live = document.getElementById('q-live');
      var a = A.asset(id);
      if (live && a) live.textContent = a.id + ', ' + a.title + ', ' + (A.labels.STATUS[a.status] || {}).label;
    }
  }
  function moveCursor(delta) {
    var ids = rowEls().map(function (tr) { return tr.getAttribute('data-row-id'); });
    if (!ids.length) return;
    var i = ids.indexOf(qs.cursorId);
    i = i < 0 ? (delta > 0 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, i + delta));
    setCursor(ids[i]);
  }

  A.action('queue-tab', function (el) {
    var t = el.getAttribute('data-tab');
    if (!TABS.some(function (x) { return x.id === t; })) return;
    qs.tab = t;
    qs.cursorId = null;
    A.rerender();
    var btn = document.getElementById('q-tabs-tab-' + t);
    if (btn) { try { btn.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  });
  A.action('queue-filter', function (el) {
    var k = el.getAttribute('data-key');
    if (!qs.f.hasOwnProperty(k)) return;
    qs.f[k] = el.value;
    A.rerender();
  });
  A.action('queue-search', function (el) { qs.q = el.value || ''; A.rerender(); });
  A.action('queue-group', function (el) { qs.group = GROUPS[el.value] ? el.value : 'none'; A.rerender(); });
  A.action('queue-sort', function (el) { qs.sort = el.value || 'priority'; A.rerender(); });
  A.action('queue-clear', function () {
    qs.f = { product: '', channel: '', source: '', risk: '', partner: '' };
    qs.q = '';
    qs.preset = null;
    if (A.current().param) A.go('#queue'); else A.rerender();
  });
  A.action('queue-clear-preset', function () {
    qs.preset = null;
    if (A.current().param) A.go('#queue'); else A.rerender();
  });
  A.action('queue-row', function (el, ev) {
    var t = ev && ev.target;
    if (t && t.closest && t.closest('input, label, button, select')) return;
    var id = el.getAttribute('data-asset-id');
    if (!id) return;
    qs.cursorId = id;
    A.go('#asset-' + id);
  });
  A.action('queue-select', function (el) {
    var id = el.getAttribute('data-asset-id');
    if (!id) return;
    if (el.checked) qs.selected[id] = true; else delete qs.selected[id];
    qs.cursorId = id;
    A.rerender();
  });
  A.action('queue-select-all', function (el) {
    var ids = rowEls().map(function (tr) { return tr.getAttribute('data-row-id'); });
    if (el.checked) ids.forEach(function (id) { qs.selected[id] = true; });
    else qs.selected = {};
    A.rerender();
  });
  A.action('queue-clear-selection', function () { qs.selected = {}; A.rerender(); });

  function selectedIds() { return Object.keys(qs.selected).filter(function (id) { return !!A.asset(id); }); }
  function selectionList(ids) {
    var shown = ids.slice(0, 6).map(function (id) { var a = A.asset(id); return '<li><span class="mono">' + esc(id) + '</span> ' + esc(a ? a.title : ''); }).join('');
    return '<ul class="small muted" style="margin:0;padding-left:18px">' + shown + (ids.length > 6 ? '<li>and ' + (ids.length - 6) + ' more</li>' : '') + '</ul>';
  }
  function openAssign() {
    var ids = selectedIds();
    if (!ids.length && qs.cursorId) { qs.selected[qs.cursorId] = true; ids = [qs.cursorId]; A.rerender(); }
    if (!ids.length) { A.toast('Select assets first: click their checkboxes, or press X on a highlighted row.', 'info'); return; }
    var p = A.profile();
    var opts = [{ value: '', label: 'Unassigned' }].concat(membersOf(p).map(function (u) { return { value: u.id, label: u.name + (u.id === A.me().id ? ' (you)' : '') }; }));
    var first = A.asset(ids[0]);
    var cur = first && first.assigneeId && ids.every(function (id) { var a = A.asset(id); return a && a.assigneeId === first.assigneeId; }) ? first.assigneeId : A.me().id;
    A.dialog({
      id: 'queue-assign-dialog', title: 'Assign ' + plural(ids.length, 'asset'), size: 'sm',
      description: 'Assignment shows who is on it. It does not lock the asset; any member can still review it.',
      body: '<div class="stack">' + ui.field('Assignee', ui.select('queue-assign-to', opts, cur), { id: 'queue-assign-to' }) + selectionList(ids) + '</div>',
      actions: [{ label: 'Cancel' }, { label: 'Assign', action: 'queue-assign-confirm', variant: 'default', icon: 'user-plus' }]
    });
  }
  A.action('queue-bulk-assign', openAssign);
  A.action('queue-assign-confirm', function () {
    var sel = document.getElementById('queue-assign-to');
    var uid = sel ? sel.value : '';
    var u = uid ? A.userById(uid) : null;
    var ids = selectedIds();
    ids.forEach(function (id) {
      var a = A.asset(id); if (!a) return;
      if ((a.assigneeId || '') === uid) return;
      a.assigneeId = uid || null;
      A.log(id, A.me().name, 'metadata', u ? 'Assigned to ' + u.name + '.' : 'Removed the assignee.');
    });
    A.emit('data-changed', { kind: 'assign', assetIds: ids });
    A.closeDialog();
    qs.selected = {};
    A.rerender();
    A.toast(u ? 'Assigned ' + plural(ids.length, 'asset') + ' to ' + u.name + '.' : 'Unassigned ' + plural(ids.length, 'asset') + '.', 'success');
  });

  A.action('queue-bulk-due', function () {
    var ids = selectedIds();
    if (!ids.length) { A.toast('Select assets first.', 'info'); return; }
    var first = A.asset(ids[0]);
    var val = first && /^\d{4}-\d{2}-\d{2}$/.test(first.dueDate || '') ? first.dueDate : ((S().meta && S().meta.today) || '');
    A.dialog({
      id: 'queue-due-dialog', title: 'Set due date for ' + plural(ids.length, 'asset'), size: 'sm',
      description: 'Due dates drive the queue order and the due badges. Members see the change in the app.',
      body: '<div class="stack">' + ui.field('Due date', '<input class="input" type="date" id="queue-due-input" value="' + esc(val) + '">', { id: 'queue-due-input', hint: 'Due at 5:00 PM Central on that day.' }) +
        '<div class="error-text" id="queue-due-error" hidden>' + A.icon('alert') + 'Pick a date.</div>' + selectionList(ids) + '</div>',
      actions: [{ label: 'Cancel' }, { label: 'Set due date', action: 'queue-due-confirm', variant: 'default', icon: 'calendar' }]
    });
  });
  A.action('queue-due-confirm', function () {
    var input = document.getElementById('queue-due-input');
    var v = input ? String(input.value || '').trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      var err = document.getElementById('queue-due-error'); if (err) err.hidden = false;
      if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
      return;
    }
    var ids = selectedIds(), changed = 0;
    ids.forEach(function (id) { var c = A.editMetadata(id, { dueDate: v }); if (c && c.length) changed += 1; });
    A.emit('data-changed', { kind: 'due-date', assetIds: ids });
    A.closeDialog();
    qs.selected = {};
    A.rerender();
    A.toast(changed ? 'Due date set to ' + ui.date(v) + ' on ' + plural(changed, 'asset') + '.' : 'Due dates already matched. Nothing changed.', changed ? 'success' : 'info');
  });

  A.action('queue-export', function () {
    var p = A.profile();
    var rows = sortRows(A.assetsFor(p.id).filter(passFilters).filter(function (a) { return inTab(a, qs.tab); }));
    var text = A.csv(rows, [
      { key: 'id', label: 'Asset ID', value: function (a) { return a.id; } },
      { key: 'title', label: 'Title', value: function (a) { return a.title; } },
      { key: 'product', label: 'Product', value: function (a) { return human(PRODUCT, a.product); } },
      { key: 'channel', label: 'Channel', value: function (a) { return human(CHANNEL, a.channel); } },
      { key: 'campaign', label: 'Campaign', value: function (a) { return campaignName(a); } },
      { key: 'partner', label: 'Partner', value: function (a) { var pt = partnerOf(a); return pt ? pt.name : ''; } },
      { key: 'status', label: 'Status', value: function (a) { return (A.labels.STATUS[a.status] || {}).label || a.status; } },
      { key: 'risk', label: 'Top open severity', value: function (a) { return notChecked(a) ? 'Not checked' : (topSev(latest(a)) || 'None'); } },
      { key: 'open', label: 'Open findings', value: function (a) { return notChecked(a) ? '' : openList(latest(a)).length; } },
      { key: 'issue', label: 'Top issue', value: function (a) { return topIssue(a).text; } },
      { key: 'version', label: 'Latest version', value: function (a) { var v = latest(a); return v ? 'V' + v.n + ' (sha ' + v.sha + ')' : ''; } },
      { key: 'due', label: 'Due', value: function (a) { return a.dueDate || ''; } },
      { key: 'assignee', label: 'Assignee', value: function (a) { var u = a.assigneeId ? A.userById(a.assigneeId) : null; return u ? u.name : ''; } }
    ]);
    A.showExport({
      title: 'Export queue view', text: text, format: 'csv', filename: 'queue-' + tabById(qs.tab).id + '.csv',
      description: rows.length + ' rows from the current tab and filters. Copy the text to paste it into a spreadsheet.'
    });
  });

  /* Keyboard: Linear-style J/K, Enter, X, A. */
  A.key('queue', 'j', function () { moveCursor(1); }, 'Next asset');
  A.key('queue', 'k', function () { moveCursor(-1); }, 'Previous asset');
  A.key('queue', 'Enter', function () { if (qs.cursorId && A.asset(qs.cursorId)) A.go('#asset-' + qs.cursorId); }, 'Open highlighted asset');
  A.key('queue', 'x', function () {
    if (!qs.cursorId) { moveCursor(1); return; }
    if (qs.selected[qs.cursorId]) delete qs.selected[qs.cursorId]; else qs.selected[qs.cursorId] = true;
    A.rerender();
  }, 'Select or unselect highlighted asset');
  A.key('queue', 'a', function () { openAssign(); }, 'Assign selected assets');
  A.key('queue', 'Escape', function () {
    if (Object.keys(qs.selected).length) { qs.selected = {}; A.rerender(); }
    else if (qs.cursorId) { setCursor(null); }
  }, 'Clear selection');
  TABS.forEach(function (t, i) {
    A.key('queue', String(i + 1), function () { qs.tab = t.id; qs.cursorId = null; A.rerender(); }, i === 0 ? 'Switch queue tab (1 to 5)' : undefined);
  });
})();
