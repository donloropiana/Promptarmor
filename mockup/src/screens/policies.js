/* Compliance Workbench prototype: Policies (rules, offer catalog, regulatory references).
 * Routes: #policies-rules, #policies-offers, #policies-references (plus #policies).
 * Deep links: #policies-rules-CP-PL-01 opens that rule, #policies-rules-LIB-DEF-01 opens the starter library at that rule,
 * #policies-offers-PL-1 opens that offer, #policies-references-ref-z-1026-16 scrolls to that reference.
 * Every rule and offer change creates a new version with a required reason. Approved versions of assets are never edited:
 * an offer change only flags approved assets that state a changed term as Re-review due.
 */
(function () {
  'use strict';
  var A = window.App;
  if (!A) return;
  var ui = A.ui, esc = A.esc;

  /* ------------------------------------------------------------------ */
  /* Module CSS (tokens only)                                            */
  /* ------------------------------------------------------------------ */
  var CSS = `
.pol-linkbtn { display: block; max-width: 100%; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.pol-linkbtn:hover .cell-title, .pol-linkbtn:focus-visible .cell-title { text-decoration: underline; text-underline-offset: 3px; }
.pol-redline { font-size: 13px; line-height: 1.65; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--card); color: var(--foreground); overflow-wrap: anywhere; white-space: pre-wrap; }
.pol-text { font-size: 13px; line-height: 1.6; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: color-mix(in oklch, var(--muted) 45%, var(--card)); overflow-wrap: anywhere; white-space: pre-wrap; }
.pol-fieldset { border: 0; padding: 0; margin: 0; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.pol-fieldset > legend { padding: 0; margin-bottom: 6px; }
.pol-checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px 12px; max-height: 232px; overflow: auto; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--card); }
.pol-counter { margin-left: auto; }
.pol-changes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; }
.pol-changes li { display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; min-width: 0; overflow-wrap: anywhere; }
.pol-item { align-items: flex-start; }
.pol-item-side { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.pol-url { font: 500 11.5px/1.45 var(--font-mono); color: var(--muted-foreground); overflow-wrap: anywhere; user-select: all; -webkit-user-select: all; }
.pol-terms-cell { white-space: normal; min-width: 240px; max-width: 520px; font-size: 12.5px; line-height: 1.45; }
.pol-group-title { font-size: 12px; font-weight: 600; color: var(--muted-foreground); margin: 2px 0 0; }
.pol-search { flex: 1 1 220px; max-width: 300px; }
.pol-hist-btns { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
@media (max-width: 860px) {
  .pol-item { flex-wrap: wrap; }
  .pol-item-side { align-items: flex-start; }
  .pol-search { max-width: none; }
}
`;
  (function injectStyle() {
    try {
      if (document.querySelector('style[data-module="policies.js"]')) return;
      var s = document.createElement('style');
      s.setAttribute('data-module', 'policies.js');
      s.textContent = CSS;
      document.head.appendChild(s);
    } catch (e) { /* styling is optional */ }
  })();

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */
  var REASON_MIN = 10, REASON_MAX = 500;
  var TEXT_CHANGED = 'Rule text edited';
  var PRODUCT = { personal_loan: 'Personal loan', credit_card: 'Credit card', mortgage: 'Mortgage' };
  var PRODUCT_ORDER = ['personal_loan', 'credit_card', 'mortgage'];
  var KIND = {
    regulatory: { label: 'Regulatory', icon: 'book', hint: 'Restates a regulation in plain language' },
    policy: { label: 'Internal policy', icon: 'building', hint: 'A ClearPath house rule' },
    offer: { label: 'Offer match', icon: 'tag', hint: 'Compares ad terms with the offer catalog' }
  };
  var KIND_ORDER = ['regulatory', 'policy', 'offer'];
  var SEV_ORDER = ['critical', 'major', 'minor'];
  var NUMERIC = { pct: 1, money: 1, months: 1, num: 1 };
  var UNIT = { pct: '%', money: '$', months: 'months' };

  // Offer terms: label, type and the claim pattern used to find approved copy that states the term.
  var RX_APR = /\bAPR\b|annual percentage rate/i;
  var RX_INTRO = /\bintro(ductory)?\b/i;
  var RX_PCT = /\d+(\.\d+)?\s?%/;
  var RX_TERM = /\b\d+[- ]?(months?|mos?|years?|yrs?)\b/i;
  var TERMS = {
    aprMin: { label: 'APR floor', type: 'pct', claim: RX_APR },
    aprMax: { label: 'APR ceiling', type: 'pct', claim: RX_APR },
    autopayDiscount: { label: 'Autopay discount', type: 'pct', claim: /auto-?pay/i },
    aprIncludesAutopay: { label: 'APR range includes autopay discount', type: 'bool', claim: /auto-?pay/i },
    originationFeeMin: { label: 'Lowest origination fee', type: 'pct', claim: /origination|\bfees?\b/i },
    originationFeeMax: { label: 'Highest origination fee', type: 'pct', claim: /origination|\bfees?\b/i },
    termMonthsMin: { label: 'Shortest term', type: 'months', claim: RX_TERM },
    termMonthsMax: { label: 'Longest term', type: 'months', claim: RX_TERM },
    amountMin: { label: 'Smallest loan', type: 'money', claim: /\$\s?\d/ },
    amountMax: { label: 'Largest loan', type: 'money', claim: /\$\s?\d/ },
    prepaymentPenalty: { label: 'Prepayment penalty', type: 'text', claim: /prepay|pay (it )?off early/i },
    creditCheck: { label: 'Credit check', type: 'text', long: true, claim: /credit (check|score|inquiry)|soft (pull|inquiry)|hard (pull|inquiry)/i },
    fundingTime: { label: 'Funding time', type: 'text', claim: /\bfund|same[- ]day|next[- ]day|business days?/i },
    representativeExample: { label: 'Representative example', type: 'text', long: true, claim: /example|\/mo\b|per month|monthly payment/i },
    introApr: { label: 'Intro APR', type: 'pct', claim: RX_INTRO },
    introMonths: { label: 'Intro period', type: 'months', claim: RX_INTRO },
    introAppliesTo: { label: 'Intro APR applies to', type: 'text', claim: RX_INTRO },
    goToAprMin: { label: 'Go-to APR (low)', type: 'pct', claim: RX_APR },
    goToAprMax: { label: 'Go-to APR (high)', type: 'pct', claim: RX_APR },
    goToAprType: { label: 'Go-to APR type', type: 'text', claim: /\bvariable\b|\bfixed\b/i },
    annualFee: { label: 'Annual fee', type: 'money', claim: /annual fee/i },
    balanceTransferFee: { label: 'Balance transfer fee', type: 'text', claim: /transfer fee|balance transfer/i },
    balanceTransferApr: { label: 'Balance transfer APR', type: 'text', claim: /balance transfer/i },
    purchaseApr: { label: 'Purchase APR', type: 'text', claim: RX_APR },
    cashAdvanceApr: { label: 'Cash advance APR', type: 'pct', claim: /cash advance/i },
    cashAdvanceFee: { label: 'Cash advance fee', type: 'text', claim: /cash advance/i },
    foreignTransactionFee: { label: 'Foreign transaction fee', type: 'pct', claim: /foreign/i },
    lateFee: { label: 'Late fee', type: 'text', claim: /late fee/i },
    rewards: { label: 'Rewards', type: 'text', claim: /cash ?back|rewards?|% back/i },
    offerDeadline: { label: 'Offer deadline', type: 'text', claim: /limited time|\bends\b|deadline|\bby (dec|december|12\/31)/i },
    rateSheet: { label: 'Rate sheet', type: 'text', claim: RX_PCT },
    rate30Fixed: { label: '30-year fixed rate', type: 'pct', claim: /30[- ]?(year|yr)|\d+(\.\d+)?\s?%/i },
    apr30Fixed: { label: '30-year fixed APR', type: 'pct', claim: /30[- ]?(year|yr)|\d+(\.\d+)?\s?%/i },
    pAndI30: { label: '30-year principal and interest', type: 'money', claim: /monthly payment|\$\s?\d[\d,]*(\.\d+)?\s*(\/\s?mo\b|per month|a month)/i },
    rate15Fixed: { label: '15-year fixed rate', type: 'pct', claim: /15[- ]?(year|yr)/i },
    apr15Fixed: { label: '15-year fixed APR', type: 'pct', claim: /15[- ]?(year|yr)/i },
    points: { label: 'Points', type: 'num', claim: /\bpoints?\b/i },
    assumptions: { label: 'Rate assumptions', type: 'text', long: true, claim: /assum|\bLTV\b|\bFICO\b|credit score of/i },
    prequalNote: { label: 'Prequalification note', type: 'text', long: true, claim: /pre-?qual/i },
    nmlsId: { label: 'NMLS ID', type: 'text', claim: /\bNMLS\b/i },
    equalHousing: { label: 'Equal Housing legend', type: 'text', claim: /equal housing/i }
  };
  var PAIRS = [['aprMin', 'aprMax'], ['goToAprMin', 'goToAprMax'], ['termMonthsMin', 'termMonthsMax'], ['amountMin', 'amountMax'], ['originationFeeMin', 'originationFeeMax']];
  var TEMPLATES = {
    personal_loan: { prefix: 'PL', name: 'Personal loan', terms: { aprMin: null, aprMax: null, autopayDiscount: null, originationFeeMin: null, originationFeeMax: null, termMonthsMin: null, termMonthsMax: null, amountMin: null, amountMax: null, prepaymentPenalty: '', creditCheck: '', fundingTime: '', representativeExample: '' } },
    credit_card: { prefix: 'CC', name: 'Credit card', terms: { introApr: null, introMonths: null, introAppliesTo: '', goToAprMin: null, goToAprMax: null, goToAprType: 'variable', annualFee: null, balanceTransferFee: '', lateFee: '', rewards: '' } },
    mortgage: { prefix: 'MG', name: 'Mortgage', terms: { rateSheet: '', rate30Fixed: null, apr30Fixed: null, rate15Fixed: null, apr15Fixed: null, points: null, assumptions: '', prequalNote: '', nmlsId: '', equalHousing: 'Equal Housing Lender' } }
  };
  var REF_GROUPS = [
    { title: 'Truth in Lending (Reg Z)', test: function (r) { return /^ref-z-/.test(r.id); } },
    { title: 'Equal Credit Opportunity (Reg B)', test: function (r) { return /^ref-b-/.test(r.id); } },
    { title: 'Mortgage advertising (Reg N)', test: function (r) { return /^ref-n-/.test(r.id); } },
    { title: 'Endorsements and affiliates (FTC)', test: function (r) { return r.id === 'ref-ftc-255' || r.id === 'ref-ftc-faq'; } },
    { title: 'Deception and UDAAP', test: function (r) { return r.id === 'ref-udaap' || r.id === 'ref-ftc-deception'; } },
    { title: 'Commercial email (CAN-SPAM)', test: function (r) { return r.id === 'ref-canspam'; } },
    { title: 'Prescreened offers (FCRA, Reg V)', test: function (r) { return /^ref-v-/.test(r.id); } }
  ];

  /* ------------------------------------------------------------------ */
  /* Screen-local state (never caches App.state objects)                 */
  /* ------------------------------------------------------------------ */
  function freshState() {
    return { q: '', kind: 'all', product: 'all', archived: false, refQ: '', ruleDiff: {}, offerV: {}, ruleEdit: null, offerEdit: null, offerPending: null };
  }
  var st = freshState();
  A.on('reset', function () { st = freshState(); });
  A.on('profile-changed', function () { st = freshState(); });

  /* ------------------------------------------------------------------ */
  /* Data helpers                                                        */
  /* ------------------------------------------------------------------ */
  function S() { return A.state; }
  function pid() { return S().activeProfileId; }
  function todayStr() { return (S().meta && S().meta.today) || A.nowIso().slice(0, 10); }
  function profileRules(includeArchived) {
    return S().rules.filter(function (r) { return r.profileId === pid() && (includeArchived || !r.archived); });
  }
  function starterRules() { return S().rules.filter(function (r) { return r.profileId == null; }); }
  function profileRule(id) { return S().rules.find(function (r) { return r.id === id && r.profileId === pid(); }) || null; }
  function starterRule(id) { return S().rules.find(function (r) { return r.id === id && r.profileId == null; }) || null; }
  function profileOffers() { return S().offers.filter(function (o) { return o.profileId === pid(); }); }
  function profileOffer(id) { return S().offers.find(function (o) { return o.id === id && o.profileId === pid(); }) || null; }
  function userName(id) { if (!id) return 'Vendor'; var u = A.userById(id); return u ? u.name : 'Unknown'; }
  function curVer(rule) { return A.ruleVersion(rule) || { v: 1, text: '', changedAt: null, authorId: null, reason: '' }; }
  function citations(rule) {
    return (rule.referenceIds || []).map(function (id) { var r = A.referenceById(id); return r ? r.citation : null; }).filter(Boolean).join(' · ');
  }
  function appliesText(list) {
    list = list || [];
    if (PRODUCT_ORDER.every(function (p) { return list.indexOf(p) >= 0; })) return 'All products';
    return list.map(function (p) { return PRODUCT[p] || p; }).join(', ') || 'No products';
  }
  function kindBadge(k) {
    var x = KIND[k] || { label: k || 'Rule', icon: 'circle', hint: '' };
    return '<span class="badge badge-outline" title="' + esc(x.hint) + '">' + A.icon(x.icon) + '<span>' + esc(x.label) + '</span></span>';
  }
  function slug(s) { return String(s || 'profile').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  // Rule ID prefix for the active profile: reuse the prefix of its existing rules, else the profile's initials.
  function profileCode() {
    var mine = profileRules(true);
    var m = mine.length ? /^([A-Z]{2,4})-/.exec(mine[0].id) : null;
    if (m) return m[1];
    if (pid() === 'p-clearpath') return 'CP';
    return (A.initials(A.profile() ? A.profile().name : 'PR') || 'PR').replace(/[^A-Z]/g, '') || 'PR';
  }
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function longDate(d) {
    return /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? MONTHS_LONG[parseInt(d.slice(5, 7), 10) - 1] + ' ' + parseInt(d.slice(8, 10), 10) + ', ' + d.slice(0, 4) : String(d || '');
  }
  function mdY(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d.slice(5, 7) + '/' + d.slice(8, 10) + '/' + d.slice(0, 4) : String(d || ''); }
  function dayBefore(d) {
    var t = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - 86400000;
    return new Date(t).toISOString().slice(0, 10);
  }
  function keepDrawerScroll(drawerId, fn) {
    var body = document.getElementById(drawerId + '-body');
    var y = body ? body.scrollTop : 0;
    fn();
    var nb = document.getElementById(drawerId + '-body');
    if (nb) nb.scrollTop = y;
  }

  // Word-level redline (LCS over whitespace-delimited tokens).
  function wordDiff(a, b) {
    var x = String(a || '').match(/\S+\s*/g) || [], y = String(b || '').match(/\S+\s*/g) || [];
    var n = x.length, m = y.length, i, j;
    var key = function (t) { return t.replace(/\s+$/, ''); };
    var dp = [];
    for (i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1));
    for (i = n - 1; i >= 0; i--) {
      for (j = m - 1; j >= 0; j--) dp[i][j] = key(x[i]) === key(y[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
    var segs = [], added = 0, removed = 0;
    var push = function (t, s) { var last = segs[segs.length - 1]; if (last && last.t === t) last.s += s; else segs.push({ t: t, s: s }); };
    i = 0; j = 0;
    while (i < n && j < m) {
      if (key(x[i]) === key(y[j])) { push('eq', y[j]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', x[i]); removed++; i++; }
      else { push('add', y[j]); added++; j++; }
    }
    while (i < n) { push('del', x[i++]); removed++; }
    while (j < m) { push('add', y[j++]); added++; }
    var html = segs.map(function (sg) {
      if (sg.t === 'eq') return esc(sg.s);
      var body = sg.s.replace(/\s+$/, ''), trail = sg.s.slice(body.length);
      return (sg.t === 'del' ? '<del class="diff-del">' + esc(body) + '</del>' : '<ins class="diff-add">' + esc(body) + '</ins>') + esc(trail);
    }).join('');
    return { html: html, added: added, removed: removed };
  }
  var DIFF_LEGEND = '<span class="diff-legend"><del class="diff-del">Removed</del><ins class="diff-add">Added</ins></span>';

  /* ---- rule usage ---- */
  function isOpenStrict(f) { return A.isOpenFinding(f) && f.disposition !== 'accepted-exception'; }
  function ruleUsage() {
    var map = {};
    A.assetsFor().forEach(function (a) {
      var v = A.latestVersion(a); if (!v) return;
      (v.findings || []).forEach(function (f) {
        if (!isOpenStrict(f)) return;
        var u = map[f.ruleId] = map[f.ruleId] || { open: 0, assets: {} };
        u.open++; u.assets[a.id] = 1;
      });
    });
    return map;
  }
  function ruleFindingsDetail(rule) {
    var cur = curVer(rule), out = [];
    A.assetsFor().forEach(function (a) {
      var v = A.latestVersion(a); if (!v) return;
      (v.findings || []).forEach(function (f) {
        if (f.ruleId !== rule.id || f.recheck === 'resolved') return;
        out.push({ asset: a, version: v, finding: f, stale: !!(f.ruleVersion && f.ruleVersion < cur.v) });
      });
    });
    return out;
  }

  /* ---- offers ---- */
  function latestOfferVersion(o) { return o.versions.reduce(function (m, v) { return !m || v.v > m.v ? v : m; }, null); }
  function currentOfferVersion(o) {
    var t = todayStr();
    var inForce = o.versions.filter(function (v) { return v.effectiveFrom <= t && (!v.effectiveTo || v.effectiveTo >= t); });
    if (inForce.length) return inForce.reduce(function (m, v) { return v.v > m.v ? v : m; });
    var started = o.versions.filter(function (v) { return v.effectiveFrom <= t; });
    return started.length ? started.reduce(function (m, v) { return v.v > m.v ? v : m; }) : latestOfferVersion(o);
  }
  function versionState(o, v) {
    var cur = currentOfferVersion(o);
    if (v === cur) return 'current';
    return v.effectiveFrom > todayStr() ? 'scheduled' : 'superseded';
  }
  function versionStateBadge(o, v) {
    var s = versionState(o, v);
    var m = { current: ['circle-check', 'In force'], scheduled: ['clock', 'Scheduled'], superseded: ['history', 'Superseded'] }[s];
    return '<span class="badge ' + (s === 'current' ? 'badge-secondary' : 'badge-outline') + '">' + A.icon(m[0]) + '<span>' + m[1] + '</span></span>';
  }
  function effRange(v) { return ui.date(v.effectiveFrom) + ' – ' + (v.effectiveTo ? ui.date(v.effectiveTo) : 'present'); }
  function termType(key, val) {
    if (TERMS[key]) return TERMS[key].type;
    if (typeof val === 'boolean') return 'bool';
    if (typeof val === 'number') return 'num';
    return 'text';
  }
  function termLabel(key) {
    return TERMS[key] ? TERMS[key].label : String(key).replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/^./, function (c) { return c.toUpperCase(); });
  }
  function fmtNum(n) { var x = Number(n); return isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: 3 }) : String(n); }
  function fmtTerm(key, val) {
    if (val == null || val === '') return '—';
    var t = termType(key, val);
    if (t === 'pct') return fmtNum(val) + '%';
    if (t === 'money') { var x = Number(val); return '$' + x.toLocaleString('en-US', { minimumFractionDigits: x % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
    if (t === 'months') return fmtNum(val) + ' months';
    if (t === 'num') return fmtNum(val);
    if (t === 'bool') return val ? 'Yes' : 'No';
    return String(val);
  }
  function blank(v) { return v == null || v === ''; }
  function sameTerm(a, b) {
    if (blank(a) || blank(b)) return blank(a) && blank(b);
    if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
    if (typeof a === 'boolean' || typeof b === 'boolean') return !!a === !!b;
    return String(a).trim() === String(b).trim();
  }
  function termChanges(base, next) {
    var keys = Object.keys(base || {});
    Object.keys(next || {}).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
    return keys.filter(function (k) { return !sameTerm((base || {})[k], (next || {})[k]); })
      .map(function (k) { return { key: k, from: (base || {})[k], to: (next || {})[k] }; });
  }
  function changesListHtml(changes) {
    if (!changes.length) return '<p class="xs muted">No changes yet.</p>';
    return '<ul class="pol-changes">' + changes.map(function (c) {
      return '<li><span class="medium">' + esc(termLabel(c.key)) + '</span><del class="diff-del">' + esc(fmtTerm(c.key, c.from)) + '</del><span class="muted" aria-label="changed to">→</span><ins class="diff-add">' + esc(fmtTerm(c.key, c.to)) + '</ins></li>';
    }).join('') + '</ul>';
  }
  function changeSentence(changes) {
    return changes.map(function (c) { return termLabel(c.key) + ' from ' + fmtTerm(c.key, c.from) + ' to ' + fmtTerm(c.key, c.to); }).join('; ');
  }
  function offerSummary(o, v) {
    var t = (v && v.terms) || {};
    var f = function (k) { return fmtTerm(k, t[k]); };
    var has = function (k) { return !blank(t[k]); };
    var parts = [];
    if (o.product === 'personal_loan') {
      if (has('aprMin') || has('aprMax')) parts.push('APR ' + f('aprMin') + '–' + f('aprMax') + (t.aprIncludesAutopay ? ' with autopay' : ''));
      if (has('amountMin') || has('amountMax')) parts.push(f('amountMin') + '–' + f('amountMax'));
      if (has('termMonthsMin') || has('termMonthsMax')) parts.push(fmtNum(t.termMonthsMin) + '–' + fmtNum(t.termMonthsMax) + ' months');
      if (has('originationFeeMax')) parts.push('origination fee ' + f('originationFeeMin') + '–' + f('originationFeeMax'));
    } else if (o.product === 'credit_card') {
      if (has('introApr')) parts.push(f('introApr') + ' intro APR' + (t.introAppliesTo ? ' on ' + t.introAppliesTo : '') + (has('introMonths') ? ' for ' + f('introMonths') : ''));
      if (has('goToAprMin') || has('goToAprMax')) parts.push('then ' + f('goToAprMin') + '–' + f('goToAprMax') + (t.goToAprType ? ' ' + t.goToAprType : ''));
      if (has('annualFee')) parts.push('annual fee ' + f('annualFee'));
      if (has('balanceTransferFee')) parts.push('transfer fee ' + t.balanceTransferFee);
    } else if (o.product === 'mortgage') {
      if (has('rateSheet')) parts.push('Rate sheet ' + t.rateSheet);
      if (has('rate30Fixed')) parts.push('30-yr fixed ' + f('rate30Fixed') + (has('apr30Fixed') ? ' (' + f('apr30Fixed') + ' APR)' : ''));
      if (has('rate15Fixed')) parts.push('15-yr fixed ' + f('rate15Fixed') + (has('apr15Fixed') ? ' (' + f('apr15Fixed') + ' APR)' : ''));
      if (has('points')) parts.push(f('points') + ' points');
    }
    if (!parts.length) parts = Object.keys(t).filter(has).slice(0, 4).map(function (k) { return termLabel(k) + ' ' + f(k); });
    return parts.join(' · ') || 'No terms yet';
  }
  // Which offers an asset is checked against: from run offer snapshots, else the only offer for its product.
  function offerIdsForAsset(a) {
    var ids = {};
    (a.versions || []).forEach(function (v) {
      ((v.run && v.run.offerSnapshot) || []).forEach(function (s) { var m = /^([A-Z]+-\d+)/.exec(String(s)); if (m) ids[m[1]] = 1; });
    });
    var list = Object.keys(ids);
    if (!list.length) {
      var same = profileOffers().filter(function (o) { return o.product === a.product; });
      if (same.length === 1) list = [same[0].id];
    }
    return list;
  }
  function assetsForOffer(o) { return A.assetsFor().filter(function (a) { return offerIdsForAsset(a).indexOf(o.id) >= 0; }); }
  function versionText(v) {
    if (!v || !v.content) return '';
    var c = v.content, parts = [];
    if (c.subject) parts.push(c.subject);
    (c.sections || []).forEach(function (s) { if (s.text) parts.push(s.text); });
    if (c.visual) ['headline', 'subhead', 'cta', 'footnote'].forEach(function (k) { if (c.visual[k]) parts.push(c.visual[k]); });
    return parts.join('\n');
  }
  function escapeRx(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function claimRe(change) {
    if (TERMS[change.key] && TERMS[change.key].claim) return TERMS[change.key].claim;
    if (!blank(change.from)) return new RegExp(escapeRx(String(change.from)), 'i');
    return null;
  }
  function snippet(text, idx, len) {
    var s = text.lastIndexOf('\n', idx) + 1, e = text.indexOf('\n', idx);
    if (e < 0) e = text.length;
    var line = text.slice(s, e).trim();
    if (line.length <= 110) return line;
    var rel = idx - s, from = Math.max(0, rel - 45), to = Math.min(line.length, rel + len + 45);
    return (from > 0 ? '…' : '') + line.slice(from, to).trim() + (to < line.length ? '…' : '');
  }
  function offerImpact(o, changes) {
    var linked = assetsForOffer(o);
    var affected = [], unaffected = [];
    linked.filter(function (a) { return a.approvedVersionId; }).forEach(function (a) {
      var v = A.version(a, a.approvedVersionId) || A.latestVersion(a);
      var text = versionText(v), hit = null;
      changes.some(function (c) {
        var re = claimRe(c); var m = re ? re.exec(text) : null;
        if (m) { hit = { key: c.key, quote: snippet(text, m.index, m[0].length) }; return true; }
        return false;
      });
      var row = { assetId: a.id, vn: v ? v.n : 1, hit: hit, status: a.status };
      (hit ? affected : unaffected).push(row);
    });
    var inReview = linked.filter(function (a) { return !a.approvedVersionId && a.status !== 'rejected'; }).map(function (a) { return a.id; });
    return { affected: affected, unaffected: unaffected, inReview: inReview };
  }
  function assetLink(a, extraHtml) {
    return '<a class="list-item" href="#asset-' + esc(a.id) + '"><span class="mono small">' + esc(a.id) + '</span><span class="truncate grow">' + esc(a.title) + '</span>' + (extraHtml || '') + ui.statusBadge(a.status) + '</a>';
  }

  /* ------------------------------------------------------------------ */
  /* Page                                                                */
  /* ------------------------------------------------------------------ */
  var TAB_DESC = {
    rules: 'Rules are controlled documents. Preflight checks cite them, every edit needs a reason and creates a new version, and each finding records the version that produced it.',
    offers: 'The terms ClearPath actually offers. Offer-match rules compare every ad with the version in force on the check date. A new version flags approved assets that state a changed term as Re-review due.',
    references: 'Read-only sources behind the rules, each checked against its source. Not legal advice; verify against the source.'
  };
  function renderPage(tab) {
    var p = A.profile();
    var rulesN = profileRules(false).length, offersN = profileOffers().length, refsN = S().references.length;
    var actions;
    if (tab === 'rules') {
      actions = ui.button('Export', { action: 'pol-export-rules', icon: 'copy', size: 'sm', variant: 'ghost', title: 'Export rules with every version as JSON' }) +
        ui.button('Starter library', { action: 'pol-library', icon: 'book', size: 'sm', kbd: 'L' }) +
        ui.button('New rule', { action: 'pol-rule-new', icon: 'plus', size: 'sm', variant: 'default', kbd: 'N' });
    } else if (tab === 'offers') {
      actions = ui.button('Export', { action: 'pol-export-offers', icon: 'copy', size: 'sm', variant: 'ghost', title: 'Export the offer catalog with every version as JSON' }) +
        ui.button('Add offer', { action: 'pol-offer-new', icon: 'plus', size: 'sm', variant: 'default', kbd: 'N' });
    } else {
      actions = ui.button('Export', { action: 'pol-export-refs', icon: 'copy', size: 'sm', variant: 'ghost', title: 'Export references as CSV' });
    }
    var body = tab === 'rules' ? rulesTab() : tab === 'offers' ? offersTab() : refsTab();
    return '<div class="page">' +
      '<div class="page-header"><div class="page-heading">' +
        '<div class="page-eyebrow">' + A.icon('book') + '<span>' + esc(p ? p.name : '') + '</span></div>' +
        '<h1 class="page-title">Policies</h1>' +
        '<p class="page-desc">' + esc(TAB_DESC[tab]) + '</p>' +
      '</div><div class="page-actions">' + actions + '</div></div>' +
      ui.tabs('pol-tabs', [
        { id: 'rules', label: 'Rules', count: rulesN, icon: 'shield' },
        { id: 'offers', label: 'Offer catalog', count: offersN, icon: 'tag' },
        { id: 'references', label: 'Regulatory references', count: refsN, icon: 'book' }
      ], tab, 'pol-tab', { label: 'Policy sections' }) +
      '<div class="tab-panel stack stack-lg" role="tabpanel" aria-labelledby="pol-tabs-tab-' + tab + '">' + body + '</div>' +
    '</div>';
  }

  /* ---- Rules tab ---- */
  function filteredRules() {
    var q = st.q.trim().toLowerCase();
    return profileRules(true).filter(function (r) {
      if (!!r.archived !== !!st.archived) return false;
      if (st.kind !== 'all' && r.kind !== st.kind) return false;
      if (st.product !== 'all' && (r.appliesTo || []).indexOf(st.product) < 0) return false;
      if (!q) return true;
      var hay = [r.id, r.title, curVer(r).text, citations(r), r.clonedFrom || ''].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function rulesTab() {
    var all = profileRules(true);
    if (!all.length) {
      return '<div class="card"><div class="card-body">' + ui.empty('No rules in this profile yet',
        'Start from the starter library: clone the rules you need, then edit them here. Each clone remembers the library rule it came from.',
        '<div class="row" style="justify-content:center">' + ui.button('Open starter library', { action: 'pol-library', icon: 'book', variant: 'default' }) +
        ui.button('New rule', { action: 'pol-rule-new', icon: 'plus' }) + '</div>') + '</div></div>';
    }
    var pool = all.filter(function (r) { return !!r.archived === !!st.archived; });
    var archivedN = all.filter(function (r) { return r.archived; }).length;
    var usage = ruleUsage();
    var rows = filteredRules();
    var kindChips = [ui.chip('All', { action: 'pol-rule-kind', data: { kind: 'all' }, pressed: st.kind === 'all', count: pool.length, size: 'sm' })]
      .concat(KIND_ORDER.map(function (k) {
        return ui.chip(KIND[k].label, { action: 'pol-rule-kind', data: { kind: k }, pressed: st.kind === k, icon: KIND[k].icon, count: pool.filter(function (r) { return r.kind === k; }).length, size: 'sm' });
      })).join('');
    var toolbar = '<div class="toolbar">' +
      '<div class="input-group pol-search">' + A.icon('search') + '<label class="sr-only" for="pol-rule-q">Search rules</label>' +
        '<input class="input input-sm" type="search" id="pol-rule-q" placeholder="Search rules, IDs, citations" autocomplete="off" value="' + esc(st.q) + '" data-input="pol-rule-q"></div>' +
      '<div class="chip-list" role="group" aria-label="Filter by kind">' + kindChips + '</div>' +
      '<label class="sr-only" for="pol-rule-product">Filter by product</label>' +
      ui.select('pol-rule-product', [{ value: 'all', label: 'All products' }].concat(PRODUCT_ORDER.map(function (p) { return { value: p, label: PRODUCT[p] }; })), st.product, { change: 'pol-rule-product', size: 'sm' }).replace('class="select', 'style="width:auto" class="select') +
      '<span class="spacer"></span>' +
      (archivedN || st.archived ? ui.chip(st.archived ? 'Showing archived' : 'Archived', { action: 'pol-rule-archived', pressed: st.archived, icon: 'history', count: archivedN, size: 'sm', title: 'Archived rules are kept for the record and not used by checks' }) : '') +
    '</div>';
    var cols = [
      { key: 'id', label: 'ID', shrink: true, render: function (r) { return '<span class="mono small">' + esc(r.id) + '</span>'; } },
      { key: 'title', label: 'Rule', render: function (r) {
        var c = citations(r);
        return '<button type="button" class="pol-linkbtn" data-action="pol-open-rule" data-rule-id="' + esc(r.id) + '"><span class="cell-title">' + esc(r.title) + '</span></button>' +
          '<span class="cell-sub">' + (r.archived ? 'Archived · ' : '') + esc(c || 'Internal policy, no external citation') + '</span>';
      } },
      { key: 'kind', label: 'Kind', shrink: true, render: function (r) { return kindBadge(r.kind); } },
      { key: 'applies', label: 'Applies to', cls: 'small hide-mobile', headerCls: 'hide-mobile', render: function (r) { return esc(appliesText(r.appliesTo)); } },
      { key: 'sev', label: 'Default severity', shrink: true, render: function (r) { return ui.severityBadge(r.defaultSeverity); } },
      { key: 'v', label: 'Version', shrink: true, render: function (r) {
        return '<span class="mono small">v' + esc(curVer(r).v) + '</span><span class="cell-sub">' + esc(r.clonedFrom ? 'from ' + r.clonedFrom : 'custom rule') + '</span>';
      } },
      { key: 'changed', label: 'Last changed', shrink: true, cls: 'hide-mobile', headerCls: 'hide-mobile', render: function (r) {
        var v = curVer(r);
        return '<span class="small" title="' + esc(ui.time(v.changedAt)) + '">' + esc(ui.date(v.changedAt)) + '</span><span class="cell-sub">' + esc(userName(v.authorId)) + '</span>';
      } },
      { key: 'used', label: 'Used by', align: 'right', shrink: true, render: function (r) {
        var u = usage[r.id];
        if (!u) return '<span class="muted small" title="No open findings cite this rule">0 findings</span>';
        var n = Object.keys(u.assets).length;
        return '<span class="small medium" title="' + esc(A.plural(u.open, 'open finding') + ' on ' + A.plural(n, 'asset') + ' (latest versions)') + '">' + esc(A.plural(u.open, 'finding')) + '</span>' +
          '<span class="cell-sub">' + esc(A.plural(n, 'asset')) + '</span>';
      } },
      { key: 'go', label: 'Open', srOnly: true, shrink: true, render: function () { return '<span class="muted" aria-hidden="true">' + A.icon('chevron-right') + '</span>'; } }
    ];
    var emptyHtml = '<div class="stack" style="align-items:center"><span>No rules match these filters.</span>' + ui.button('Clear filters', { action: 'pol-rule-clear', size: 'sm' }) + '</div>';
    var table = ui.table(cols, rows, {
      id: 'pol-rules-table', caption: 'Rules in this profile',
      rowAttrs: function (r) { return { 'data-action': 'pol-open-rule', 'data-rule-id': r.id, 'class': r.archived ? 'is-muted' : null }; },
      empty: emptyHtml
    });
    var note = '<p class="xs muted">Starter rules come from the vendor library and are read-only until you clone them. Archive a rule to stop using it; nothing is deleted.</p>';
    return toolbar + table + note;
  }

  /* ---- Offer catalog tab ---- */
  function offersTab() {
    var offers = profileOffers();
    if (!offers.length) {
      return '<div class="card"><div class="card-body">' + ui.empty('No offers in this profile yet',
        'Offer-match rules compare ads with the terms you actually offer. Add each product with its current terms.',
        '<div class="row" style="justify-content:center">' + ui.button('Add offer', { action: 'pol-offer-new', icon: 'plus', variant: 'default' }) + '</div>') + '</div></div>';
    }
    var cols = [
      { key: 'id', label: 'ID', shrink: true, render: function (o) { return '<span class="mono small strong">' + esc(o.id) + '</span>'; } },
      { key: 'name', label: 'Offer', render: function (o) {
        return '<button type="button" class="pol-linkbtn" data-action="pol-open-offer" data-offer-id="' + esc(o.id) + '"><span class="cell-title">' + esc(o.name) + '</span></button><span class="cell-sub">' + esc(PRODUCT[o.product] || o.product) + '</span>';
      } },
      { key: 'terms', label: 'Key terms (in force today)', cls: 'pol-terms-cell', render: function (o) { return esc(offerSummary(o, currentOfferVersion(o))); } },
      { key: 'ver', label: 'Version', shrink: true, render: function (o) {
        var cur = currentOfferVersion(o), latest = latestOfferVersion(o);
        return '<span class="mono small">v' + esc(cur.v) + '</span><span class="cell-sub">since ' + esc(ui.date(cur.effectiveFrom)) + '</span>' +
          (latest !== cur && latest.effectiveFrom > todayStr() ? '<span class="cell-sub">' + A.icon('clock') + ' v' + esc(latest.v) + ' from ' + esc(ui.date(latest.effectiveFrom)) + '</span>' : '');
      } },
      { key: 'assets', label: 'Approved assets', shrink: true, render: function (o) {
        var linked = assetsForOffer(o).filter(function (a) { return a.approvedVersionId; });
        if (!linked.length) return '<span class="muted">0</span>';
        var due = linked.filter(function (a) { return a.status === 're-review-due' || (a.flags && a.flags.reReviewDue); }).length;
        return '<div class="stack stack-sm"><span class="medium">' + linked.length + '</span>' + (due ? ui.statusBadge('re-review-due', String(due)) : '') + '</div>';
      } },
      { key: 'changed', label: 'Last changed', shrink: true, cls: 'hide-mobile', headerCls: 'hide-mobile', render: function (o) {
        var v = latestOfferVersion(o);
        return '<span class="small" title="' + esc(ui.time(v.savedAt)) + '">' + esc(ui.date(v.savedAt || v.effectiveFrom)) + '</span><span class="cell-sub">' + esc(userName(v.authorId)) + '</span>';
      } },
      { key: 'go', label: 'Open', srOnly: true, shrink: true, render: function () { return '<span class="muted" aria-hidden="true">' + A.icon('chevron-right') + '</span>'; } }
    ];
    var table = ui.table(cols, offers, {
      id: 'pol-offers-table', caption: 'Offer catalog',
      rowAttrs: function (o) { return { 'data-action': 'pol-open-offer', 'data-offer-id': o.id }; }
    });
    var how = ui.callout('info', 'How offer changes reach approved assets',
      'Saving a new version checks every approved asset that uses the offer. If its approved copy states a changed term, the asset is marked <strong>Re-review due</strong>. The approval stays on record and the approved version is never edited.');
    return table + how;
  }

  /* ---- References tab ---- */
  function refsTab() {
    var q = st.refQ.trim().toLowerCase();
    var refs = S().references.filter(function (r) { return !q || [r.citation, r.label, r.summary, r.id].join(' ').toLowerCase().indexOf(q) >= 0; });
    var rules = profileRules(true);
    var usedBy = function (ref) { return rules.filter(function (r) { return (r.referenceIds || []).indexOf(ref.id) >= 0; }); };
    var used = {};
    var groups = REF_GROUPS.map(function (g) { return { title: g.title, items: refs.filter(function (r) { if (used[r.id] || !g.test(r)) return false; used[r.id] = 1; return true; }) }; });
    var other = refs.filter(function (r) { return !used[r.id]; });
    if (other.length) groups.push({ title: 'Other', items: other });
    var item = function (r) {
      var ub = usedBy(r);
      return '<div class="list-item pol-item" id="pol-ref-' + esc(r.id) + '">' +
        '<div class="stack stack-sm grow">' +
          '<div class="row row-wrap"><span class="mono small strong">' + esc(r.citation) + '</span><span class="medium">' + esc(r.label) + '</span></div>' +
          '<p class="small">' + esc(r.summary) + '</p>' +
          '<div class="row row-wrap row-tight"><span class="pol-url">' + esc(r.url) + '</span>' +
            ui.button('Copy source link', { action: 'copy-text', data: { text: r.url }, variant: 'ghost', size: 'sm', icon: 'copy', iconOnly: true }) + '</div>' +
          '<div class="row row-wrap row-tight"><span class="xs muted">Cited by</span>' +
            (ub.length ? ub.map(function (x) { return ui.chip(x.id, { action: 'pol-open-rule', data: { ruleId: x.id }, size: 'sm', title: x.title }); }).join('') : '<span class="xs muted">no rules in this profile</span>') +
          '</div>' +
        '</div>' +
        '<div class="pol-item-side">' + ui.tag('verified as of ' + r.verifiedAsOf, { icon: 'shield-check', title: 'Checked against the source on ' + ui.date(r.verifiedAsOf) }) +
          '<span class="badge badge-outline" title="References are maintained with the starter library">' + A.icon('lock') + '<span>Read-only</span></span></div>' +
      '</div>';
    };
    var toolbar = '<div class="toolbar"><div class="input-group pol-search">' + A.icon('search') + '<label class="sr-only" for="pol-ref-q">Search references</label>' +
      '<input class="input input-sm" type="search" id="pol-ref-q" placeholder="Search citations and summaries" autocomplete="off" value="' + esc(st.refQ) + '" data-input="pol-ref-q"></div>' +
      '<span class="xs muted">' + esc(A.plural(refs.length, 'reference')) + '</span></div>';
    var verified = S().references.map(function (r) { return r.verifiedAsOf; }).filter(Boolean).sort()[0] || todayStr();
    var intro = ui.callout('neutral', 'Read-only. Verified as of ' + longDate(verified),
      'Each entry was checked against its source. Source links are shown as text; copy one to open it in your browser. Not legal advice; verify against the source.', { icon: 'lock' });
    var listHtml = groups.filter(function (g) { return g.items.length; }).map(function (g) {
      return '<section class="section"><h2 class="pol-group-title">' + esc(g.title) + '</h2><div class="list">' + g.items.map(item).join('') + '</div></section>';
    }).join('');
    if (!listHtml) listHtml = '<div class="card"><div class="card-body">' + ui.empty('No references match', 'Try a citation such as 1026.24 or a word from the summary.', ui.button('Clear search', { action: 'pol-ref-clear', size: 'sm' })) + '</div></div>';
    var hygiene = '<p class="xs muted">Deliberately not cited: CFPB Bulletin 2014-02 and CFPB Circular 2024-01, both withdrawn on May 12, 2025 (90 FR 20084).</p>';
    return intro + toolbar + listHtml + hygiene;
  }

  /* ------------------------------------------------------------------ */
  /* Rule drawer (view)                                                  */
  /* ------------------------------------------------------------------ */
  function redlineHtml(rule, v) {
    var vers = rule.versions || [];
    var idx = vers.findIndex(function (x) { return x.v === v; });
    if (idx < 0) idx = vers.length - 1;
    var ver = vers[idx], prev = idx > 0 ? vers[idx - 1] : null;
    if (!ver) return '';
    if (!prev) {
      return '<div class="section-header"><div class="section-title">' + A.icon('git-compare') + 'Redline: v' + esc(ver.v) + '</div></div>' +
        '<p class="small muted">v' + esc(ver.v) + ' is the first version' + (rule.clonedFrom ? ', cloned from the starter library (' + esc(rule.clonedFrom) + ')' : '') + '. There is nothing earlier to compare.</p>';
    }
    var d = wordDiff(prev.text, ver.text);
    var fc = (ver.fieldChanges || []);
    return '<div class="section-header"><div class="section-title">' + A.icon('git-compare') + 'Redline: v' + esc(prev.v) + ' → v' + esc(ver.v) + '</div>' + DIFF_LEGEND + '</div>' +
      '<div class="pol-redline">' + d.html + '</div>' +
      (fc.length ? '<ul class="pol-changes">' + fc.map(function (c) { return '<li>' + A.icon('edit') + '<span>' + esc(c) + '</span></li>'; }).join('') + '</ul>' : '') +
      '<p class="xs muted">' + (d.added || d.removed ? esc(A.plural(d.added, 'word') + ' added, ' + d.removed + ' removed') : 'No wording changes') +
        ' · ' + esc(userName(ver.authorId)) + ', ' + esc(ui.time(ver.changedAt)) + ' · Reason: ' + esc(ver.reason || '—') + '</p>';
  }
  function ruleDrawerHtml(rule) {
    var cur = curVer(rule);
    var diffV = st.ruleDiff[rule.id] || cur.v;
    var refs = (rule.referenceIds || []).map(function (id) { return A.referenceById(id); }).filter(Boolean);
    var detail = ruleFindingsDetail(rule);
    var lib = rule.clonedFrom ? starterRule(rule.clonedFrom) : null;
    var parts = [];
    if (rule.archived) {
      parts.push(ui.callout('neutral', 'Archived ' + ui.date(rule.archivedAt) + ' by ' + userName(rule.archivedBy),
        esc(rule.archiveReason || '') + '<br>Checks no longer use this rule. Past findings keep their citation and version.', { icon: 'history' }));
    }
    parts.push('<div class="row row-wrap">' + kindBadge(rule.kind) + ui.severityBadge(rule.defaultSeverity) +
      '<span class="badge badge-outline"><span class="mono">v' + esc(cur.v) + '</span><span class="badge-sub">· current</span></span></div>');
    parts.push(ui.dl([
      ['Applies to', esc(appliesText(rule.appliesTo))],
      ['Current version', 'v' + esc(cur.v) + ' · ' + esc(ui.time(cur.changedAt)) + ' · ' + esc(userName(cur.authorId))],
      ['Origin', lib ? 'Cloned from <span class="mono">' + esc(lib.id) + '</span> (starter library v' + esc(curVer(lib).v) + ')' : (rule.clonedFrom ? 'Cloned from <span class="mono">' + esc(rule.clonedFrom) + '</span>' : 'Created in this profile')],
      ['Open findings', esc(String(detail.filter(function (x) { return isOpenStrict(x.finding); }).length))]
    ]));
    parts.push('<section class="section"><div class="section-title">Rule text (v' + esc(cur.v) + ')</div><div class="pol-text">' + esc(cur.text) + '</div></section>');
    parts.push('<section class="section"><div class="section-title">Linked references</div>' + (refs.length
      ? '<div class="list">' + refs.map(function (r) {
          return '<a class="list-item" href="#policies-references-' + esc(r.id) + '"><span class="mono small">' + esc(r.citation) + '</span><span class="truncate grow small">' + esc(r.label) + '</span>' +
            ui.tag('verified ' + r.verifiedAsOf, { icon: 'shield-check' }) + '</a>';
        }).join('') + '</div>'
      : '<p class="small muted">No external reference. This is an internal ClearPath policy.</p>') + '</section>');
    parts.push('<section class="section" id="pol-redline-panel">' + redlineHtml(rule, diffV) + '</section>');
    var hist = rule.versions.slice().reverse().map(function (v, i) {
      var isCur = v.v === cur.v;
      return '<li class="tl-item"><span class="tl-dot' + (isCur ? ' is-strong' : '') + '"></span>' +
        '<div class="tl-head"><span class="tl-actor mono">v' + esc(v.v) + '</span><span class="tl-time">' + esc(ui.time(v.changedAt)) + '</span><span class="small">' + esc(userName(v.authorId)) + '</span>' +
          (isCur ? '<span class="badge badge-secondary">Current</span>' : '') + '</div>' +
        '<div class="tl-text">' + esc(v.reason || '—') + '</div>' +
        (v.fieldChanges && v.fieldChanges.length ? '<div class="xs muted">' + esc(v.fieldChanges.join(' · ')) + '</div>' : '') +
        '<div class="pol-hist-btns">' + ui.button(i === rule.versions.length - 1 ? 'View v' + v.v : 'Redline vs v' + (v.v - 1), {
          action: 'pol-rule-diff', data: { ruleId: rule.id, v: v.v }, variant: 'ghost', size: 'sm', icon: 'git-compare', pressed: v.v === diffV, cls: 'pol-diff-btn'
        }) + '</div></li>';
    }).join('');
    parts.push('<section class="section"><div class="section-title">' + A.icon('history') + 'Version history</div><ol class="timeline">' + hist + '</ol></section>');
    var byAsset = [], seen = {};
    detail.forEach(function (x) {
      if (!seen[x.asset.id]) { seen[x.asset.id] = { asset: x.asset, items: [] }; byAsset.push(seen[x.asset.id]); }
      seen[x.asset.id].items.push(x);
    });
    var usedHtml = byAsset.length ? '<div class="list">' + byAsset.map(function (g) {
      var stale = g.items.filter(function (x) { return x.stale; })[0];
      var extra = g.items.map(function (x) { return ui.severityBadge(x.finding.severity) + (x.finding.disposition ? ui.dispositionBadge(x.finding.disposition) : ''); }).join('') +
        (stale ? ui.tag('checked against v' + stale.finding.ruleVersion, { icon: 'history', title: 'Checked against v' + stale.finding.ruleVersion + '; v' + cur.v + ' is current. The next check of this asset uses v' + cur.v + '.' }) : '');
      return assetLink(g.asset, extra);
    }).join('') + '</div>' : '<p class="small muted">No findings on the latest version of any asset cite this rule.</p>';
    parts.push('<section class="section"><div class="section-title">' + A.icon('layers') + 'Findings that cite this rule</div>' + usedHtml + '</section>');
    return parts.join('');
  }
  function ruleDrawerFooter(rule) {
    if (rule.archived) {
      return '<span class="grow"></span>' + ui.button('Close', { action: 'drawer-close' }) + ui.button('Restore rule', { action: 'pol-rule-restore', data: { ruleId: rule.id }, variant: 'default', icon: 'undo' });
    }
    return ui.button('Archive', { action: 'pol-rule-archive', data: { ruleId: rule.id }, variant: 'ghost', icon: 'history' }) +
      '<span class="grow"></span>' + ui.button('Close', { action: 'drawer-close' }) +
      ui.button('Edit rule', { action: 'pol-rule-edit', data: { ruleId: rule.id }, variant: 'default', icon: 'edit' });
  }
  function openRuleDrawer(id) {
    var rule = profileRule(id);
    if (!rule) { A.toast('Rule ' + id + ' is not in this profile', 'error'); return; }
    A.drawer({ id: 'pol-rule-drawer', title: rule.id + ' · ' + rule.title, width: 'lg', body: ruleDrawerHtml(rule), footer: ruleDrawerFooter(rule) });
  }

  /* ------------------------------------------------------------------ */
  /* Rule editor                                                         */
  /* ------------------------------------------------------------------ */
  function newRuleId() {
    var code = profileCode(), max = 0, re = new RegExp('^' + code + '-CUS-(\\d+)$');
    S().rules.forEach(function (r) { var m = re.exec(r.id); if (m) max = Math.max(max, parseInt(m[1], 10)); });
    return code + '-CUS-' + ('0' + (max + 1)).slice(-2);
  }
  function ruleDraftFrom(rule) {
    if (!rule) return { kind: 'policy', title: '', text: '', defaultSeverity: 'major', appliesTo: PRODUCT_ORDER.slice(), referenceIds: [], reason: 'New rule created in this profile' };
    return { kind: rule.kind, title: rule.title, text: curVer(rule).text, defaultSeverity: rule.defaultSeverity, appliesTo: (rule.appliesTo || []).slice(), referenceIds: (rule.referenceIds || []).slice(), reason: '' };
  }
  function readRuleForm() {
    var val = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    var checked = function (name) {
      return Array.prototype.slice.call(document.querySelectorAll('#pol-rule-form input[name="' + name + '"]:checked')).map(function (el) { return el.value; });
    };
    return {
      kind: val('pol-rule-kind') || 'policy', title: val('pol-rule-title').trim(), text: val('pol-rule-text').trim(),
      defaultSeverity: val('pol-rule-sev') || 'major', appliesTo: checked('pol-rule-applies'), referenceIds: checked('pol-rule-refs'),
      reason: val('pol-rule-reason').trim()
    };
  }
  function citeList(ids) { return ids.map(function (id) { var r = A.referenceById(id); return r ? r.citation : id; }); }
  function ruleChangeList(rule, d) {
    if (!rule) return [];
    var out = [], cur = curVer(rule);
    if (d.text !== String(cur.text || '').trim()) out.push(TEXT_CHANGED);
    if (d.title !== rule.title) out.push('Title: "' + rule.title + '" → "' + d.title + '"');
    if (d.kind !== rule.kind) out.push('Kind: ' + (KIND[rule.kind] || { label: rule.kind }).label + ' → ' + (KIND[d.kind] || { label: d.kind }).label);
    if (d.defaultSeverity !== rule.defaultSeverity) out.push('Default severity: ' + A.labels.SEVERITY[rule.defaultSeverity].label + ' → ' + A.labels.SEVERITY[d.defaultSeverity].label);
    var ap0 = PRODUCT_ORDER.filter(function (p) { return (rule.appliesTo || []).indexOf(p) >= 0; }), ap1 = PRODUCT_ORDER.filter(function (p) { return d.appliesTo.indexOf(p) >= 0; });
    if (ap0.join() !== ap1.join()) out.push('Applies to: ' + appliesText(ap0) + ' → ' + appliesText(ap1));
    var r0 = rule.referenceIds || [], added = d.referenceIds.filter(function (id) { return r0.indexOf(id) < 0; }), removed = r0.filter(function (id) { return d.referenceIds.indexOf(id) < 0; });
    if (added.length) out.push('Added reference ' + citeList(added).join(', '));
    if (removed.length) out.push('Removed reference ' + citeList(removed).join(', '));
    return out;
  }
  function ruleProblems(rule, d) {
    var p = [];
    if (!d.title) p.push('Add a title.');
    if (d.text.length < 20) p.push('Write the rule text (at least 20 characters).');
    if (!d.appliesTo.length) p.push('Pick at least one product.');
    if (rule && !ruleChangeList(rule, d).length) p.push('No changes yet.');
    if (d.reason.length < REASON_MIN) p.push('Add a reason for the change (at least ' + REASON_MIN + ' characters).');
    return p;
  }
  function rulePreviewHtml(rule, d) {
    if (!rule) return d.text ? '<div class="pol-text">' + esc(d.text) + '</div>' : '<p class="xs muted">The rule text appears here as you type.</p>';
    var changes = ruleChangeList(rule, d);
    if (!changes.length) return '<p class="xs muted">No changes yet. Edit the text or the fields above.</p>';
    var diff = wordDiff(curVer(rule).text, d.text);
    var fc = changes.filter(function (c) { return c !== TEXT_CHANGED; });
    return '<div class="pol-redline">' + diff.html + '</div>' +
      (fc.length ? '<ul class="pol-changes mt-8">' + fc.map(function (c) { return '<li>' + A.icon('edit') + '<span>' + esc(c) + '</span></li>'; }).join('') + '</ul>' : '');
  }
  function ruleEditorHtml(ed) {
    var rule = ed.ruleId ? profileRule(ed.ruleId) : null;
    var cur = rule ? curVer(rule) : null;
    var d = ed.draft || ruleDraftFrom(rule);
    var nextV = cur ? cur.v + 1 : 1;
    var intro = rule
      ? ui.callout('info', null, 'Saving creates <strong>v' + nextV + '</strong> of ' + esc(rule.id) + '. Findings keep the rule version that produced them (v' + esc(cur.v) + '); each asset\'s next check uses v' + nextV + '.')
      : ui.callout('info', null, 'The new rule starts at v1 in ' + esc(A.profile().name) + ' with the ID <span class="mono">' + esc(ed.newId) + '</span>.');
    var kindSel = ui.field('Kind', ui.select('pol-rule-kind', KIND_ORDER.map(function (k) { return { value: k, label: KIND[k].label }; }), d.kind), { id: 'pol-rule-kind' });
    var sevSel = ui.field('Default severity', ui.select('pol-rule-sev', SEV_ORDER.map(function (s) { return { value: s, label: A.labels.SEVERITY[s].label }; }), d.defaultSeverity), { id: 'pol-rule-sev', hint: 'Reviewers can still change severity on a finding.' });
    var title = ui.field('Title', '<input class="input" id="pol-rule-title" maxlength="120" autocomplete="off" value="' + esc(d.title) + '">', { id: 'pol-rule-title' });
    var applies = '<fieldset class="pol-fieldset"><legend class="label">Applies to</legend><div class="row row-wrap row-loose">' + PRODUCT_ORDER.map(function (p) {
      return '<label class="check" for="pol-rule-ap-' + p + '"><input type="checkbox" name="pol-rule-applies" id="pol-rule-ap-' + p + '" value="' + p + '"' + (d.appliesTo.indexOf(p) >= 0 ? ' checked' : '') + '>' + esc(PRODUCT[p]) + '</label>';
    }).join('') + '</div></fieldset>';
    var text = ui.field('Rule text', '<textarea class="textarea" id="pol-rule-text" rows="6">' + esc(d.text) + '</textarea>', { id: 'pol-rule-text', hint: 'Plain language. Preflight checks use this text, and findings cite it with the version number.' });
    var refs = '<fieldset class="pol-fieldset"><legend class="label">Linked references <span class="optional">(optional)</span></legend><div class="pol-checks">' + S().references.map(function (r) {
      return '<label class="check" for="pol-rule-ref-' + esc(r.id) + '"><input type="checkbox" name="pol-rule-refs" id="pol-rule-ref-' + esc(r.id) + '" value="' + esc(r.id) + '"' + (d.referenceIds.indexOf(r.id) >= 0 ? ' checked' : '') + '>' +
        '<span><span class="mono xs">' + esc(r.citation) + '</span><br><span class="xs muted">' + esc(r.label) + '</span></span></label>';
    }).join('') + '</div></fieldset>';
    var preview = '<section class="section"><div class="section-header"><div class="section-title">' + A.icon('git-compare') + (rule ? 'Changes vs v' + esc(cur.v) : 'Preview') + '</div>' + (rule ? DIFF_LEGEND : '') + '</div><div id="pol-rule-preview"></div></section>';
    var reason = ui.field(rule ? 'Reason for change' : 'Reason', '<textarea class="textarea" id="pol-rule-reason" rows="2" maxlength="' + REASON_MAX + '" placeholder="Why this change? For example: legal memo LM-2026-11 asks for SMS opt-out wording.">' + esc(d.reason) + '</textarea>',
      { id: 'pol-rule-reason', labelExtra: '<span class="counter pol-counter" id="pol-rule-reason-count"></span>', hint: 'Required. It appears in the version history and the audit record.' });
    return '<form id="pol-rule-form" class="stack stack-lg" data-input="pol-rule-draft" data-change="pol-rule-draft" novalidate>' +
      intro + '<div class="field-row">' + kindSel + sevSel + '</div>' + title + applies + text + refs + preview + reason + '</form>';
  }
  function updateRuleEditorLive() {
    var ed = st.ruleEdit; if (!ed) return;
    var rule = ed.ruleId ? profileRule(ed.ruleId) : null;
    var d = readRuleForm();
    ed.draft = d;
    var pv = document.getElementById('pol-rule-preview'); if (pv) pv.innerHTML = rulePreviewHtml(rule, d);
    var cnt = document.getElementById('pol-rule-reason-count');
    if (cnt) { cnt.textContent = d.reason.length + '/' + REASON_MAX; cnt.className = 'counter pol-counter ' + (d.reason.length >= REASON_MIN ? 'is-ok' : 'is-short'); }
    var probs = ruleProblems(rule, d);
    var btn = document.getElementById('pol-rule-save-btn'); if (btn) btn.disabled = probs.length > 0;
    var hint = document.getElementById('pol-rule-save-hint'); if (hint) hint.textContent = probs[0] || 'Ready to save.';
  }
  function openRuleEditor(ruleId) {
    var rule = ruleId ? profileRule(ruleId) : null;
    if (ruleId && !rule) return;
    if (rule && rule.archived) { A.toast('Restore ' + rule.id + ' before editing it', 'warning'); return; }
    if (!st.ruleEdit || st.ruleEdit.ruleId !== (ruleId || null)) st.ruleEdit = { ruleId: ruleId || null, draft: null, newId: ruleId ? null : newRuleId() };
    var ed = st.ruleEdit;
    var nextV = rule ? curVer(rule).v + 1 : 1;
    A.drawer({
      id: 'pol-rule-editor', width: 'lg',
      title: rule ? 'Edit ' + rule.id + ' · ' + rule.title : 'New rule ' + ed.newId,
      body: ruleEditorHtml(ed),
      footer: '<span class="xs muted grow" id="pol-rule-save-hint" aria-live="polite"></span>' +
        ui.button('Cancel', { action: 'pol-rule-cancel' }) +
        ui.button(rule ? 'Save as v' + nextV : 'Create rule', { action: 'pol-rule-save', variant: 'default', icon: 'check', id: 'pol-rule-save-btn', disabled: true }),
      onOpen: function () {
        var d = ed.draft || ruleDraftFrom(rule);
        var k = document.getElementById('pol-rule-kind'); if (k) k.value = d.kind;
        var sv = document.getElementById('pol-rule-sev'); if (sv) sv.value = d.defaultSeverity;
        updateRuleEditorLive();
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Starter library drawer                                              */
  /* ------------------------------------------------------------------ */
  function libraryHtml() {
    var p = A.profile();
    var lib = starterRules();
    var clonedMap = {};
    profileRules(true).forEach(function (r) { if (r.clonedFrom) clonedMap[r.clonedFrom] = r; });
    var missing = lib.filter(function (l) { return !clonedMap[l.id]; });
    var groupOf = function (r) { var ap = r.appliesTo || []; return PRODUCT_ORDER.every(function (x) { return ap.indexOf(x) >= 0; }) ? 'all' : (ap[0] || 'all'); };
    var groups = [['personal_loan', 'Personal loans'], ['credit_card', 'Credit cards'], ['mortgage', 'Mortgage'], ['all', 'All products']];
    var item = function (l) {
      var mine = clonedMap[l.id], lv = curVer(l);
      var side = mine
        ? ui.tag(mine.archived ? 'archived in profile' : 'in profile', { icon: 'check' }) +
          ui.button(mine.id + ' · v' + curVer(mine).v, { action: 'pol-open-rule', data: { ruleId: mine.id }, variant: 'link', size: 'sm' })
        : ui.button('Clone to profile', { action: 'pol-clone', data: { libId: l.id }, size: 'sm', icon: 'copy' });
      return '<div class="list-item pol-item" id="pol-lib-' + esc(l.id) + '"><div class="stack stack-sm grow">' +
        '<div class="row row-wrap"><span class="mono xs muted">' + esc(l.id) + ' · v' + esc(lv.v) + '</span><span class="medium">' + esc(l.title) + '</span></div>' +
        '<div class="row row-wrap">' + kindBadge(l.kind) + ui.severityBadge(l.defaultSeverity) + '<span class="xs muted">' + esc(citations(l)) + '</span></div>' +
        '<p class="small muted">' + esc(lv.text) + '</p></div>' +
        '<div class="pol-item-side">' + side + '</div></div>';
    };
    var head = ui.callout('info', 'Read-only templates maintained by the vendor',
      'Release 2026.06. Clone a rule to use and edit it in ' + esc(p ? p.name : 'this profile') + '. Library updates never change rules you already cloned.', { icon: 'lock' }) +
      '<div class="toolbar"><span class="small">' + esc(A.plural(lib.length, 'starter rule')) + ' · ' + esc(String(lib.length - missing.length)) + ' in this profile</span><span class="spacer"></span>' +
      ui.button(missing.length ? 'Clone all ' + missing.length + ' missing' : 'All rules cloned', { action: 'pol-clone-all', size: 'sm', icon: 'copy', disabled: !missing.length }) + '</div>';
    return head + groups.map(function (g) {
      var items = lib.filter(function (l) { return groupOf(l) === g[0]; });
      if (!items.length) return '';
      return '<section class="section"><h3 class="pol-group-title">' + esc(g[1]) + '</h3><div class="list">' + items.map(item).join('') + '</div></section>';
    }).join('');
  }
  function openLibrary(focusId) {
    A.drawer({ id: 'pol-library', title: 'Starter library', width: 'lg', body: libraryHtml(), footer: '<span class="grow"></span>' + ui.button('Done', { action: 'drawer-close', variant: 'default' }) });
    if (focusId) {
      var el = document.getElementById('pol-lib-' + focusId);
      if (el) { try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ } el.classList.add('flash'); }
    }
  }
  function cloneRule(libId) {
    var lib = starterRule(libId);
    if (!lib) return null;
    var existing = profileRules(true).find(function (r) { return r.clonedFrom === libId; });
    if (existing) return existing;
    var code = profileCode();
    var base = code + '-' + lib.id.replace(/^LIB-/, ''), id = base, k = 2;
    while (S().rules.some(function (r) { return r.id === id && r.profileId === pid(); })) id = base + '-' + (k++);
    var lv = curVer(lib), u = A.me();
    var rule = {
      id: id, profileId: pid(), title: lib.title, kind: lib.kind, referenceIds: (lib.referenceIds || []).slice(), appliesTo: (lib.appliesTo || []).slice(),
      defaultSeverity: lib.defaultSeverity, clonedFrom: lib.id,
      versions: [{ v: 1, text: lv.text, changedAt: A.nowIso(), authorId: u.id, reason: 'Cloned from starter library ' + lib.id + ' v' + lv.v }]
    };
    S().rules.push(rule);
    A.logProfile(u.name, 'policy', 'Cloned starter rule ' + lib.id + ' v' + lv.v + ' as ' + id + ' v1.');
    return rule;
  }

  /* ------------------------------------------------------------------ */
  /* Offer drawer (view)                                                 */
  /* ------------------------------------------------------------------ */
  function offerDrawerHtml(o) {
    var cur = currentOfferVersion(o);
    var ver = A.offerVersion(o, st.offerV[o.id] || cur.v) || cur;
    var sorted = o.versions.slice().sort(function (a, b) { return a.v - b.v; });
    var idx = sorted.indexOf(ver), prev = idx > 0 ? sorted[idx - 1] : null;
    var changes = prev ? termChanges(prev.terms, ver.terms) : [];
    var parts = [];
    parts.push('<div class="row row-wrap"><span class="badge badge-outline">' + A.icon('tag') + '<span>' + esc(PRODUCT[o.product] || o.product) + '</span></span>' +
      '<span class="small muted">v' + esc(cur.v) + ' in force since ' + esc(ui.date(cur.effectiveFrom)) + '</span></div>');
    parts.push('<div class="row row-wrap between"><div class="seg" role="group" aria-label="Show version">' + sorted.map(function (v) {
      return '<button type="button" data-action="pol-offer-v" data-offer-id="' + esc(o.id) + '" data-v="' + esc(v.v) + '" aria-pressed="' + (v === ver) + '">v' + esc(v.v) + '</button>';
    }).join('') + '</div><div class="row row-tight">' + versionStateBadge(o, ver) + '<span class="xs muted">' + esc(effRange(ver)) + '</span></div></div>');
    if (prev) {
      parts.push(ui.callout(changes.length ? 'rereview' : 'neutral', 'v' + ver.v + ' changed ' + A.plural(changes.length, 'term') + ' from v' + prev.v,
        changesListHtml(changes) + '<p class="xs muted mt-8">Saved ' + esc(ui.time(ver.savedAt)) + ' by ' + esc(userName(ver.authorId)) + ' · Reason: ' + esc(ver.changeReason || '—') + '</p>', { icon: 'git-compare' }));
    } else {
      parts.push('<p class="xs muted">v' + esc(ver.v) + ' is the first version. Saved ' + esc(ui.time(ver.savedAt)) + ' by ' + esc(userName(ver.authorId)) + ' · ' + esc(ver.changeReason || '') + '</p>');
    }
    var keys = Object.keys(ver.terms || {});
    if (prev) Object.keys(prev.terms || {}).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
    var changed = {}; changes.forEach(function (c) { changed[c.key] = c; });
    var cols = [
      { key: 'label', label: 'Term', render: function (k) { return '<span class="small' + (changed[k] ? ' medium' : ' muted') + '">' + esc(termLabel(k)) + '</span>'; } },
      { key: 'value', label: 'v' + ver.v, render: function (k) {
        var c = changed[k];
        return c ? '<span class="small"><del class="diff-del">' + esc(fmtTerm(k, c.from)) + '</del> <ins class="diff-add">' + esc(fmtTerm(k, c.to)) + '</ins></span>'
          : '<span class="small">' + esc(fmtTerm(k, (ver.terms || {})[k])) + '</span>';
      } }
    ];
    parts.push('<section class="section"><div class="section-title">Terms</div>' + ui.table(cols, keys, { dense: true, caption: 'Terms of ' + o.id + ' v' + ver.v }) + '</section>');
    var hist = sorted.slice().reverse().map(function (v) {
      return '<li class="tl-item"><span class="tl-dot' + (v === cur ? ' is-strong' : '') + '"></span>' +
        '<div class="tl-head"><span class="tl-actor mono">v' + esc(v.v) + '</span><span class="tl-time">' + esc(effRange(v)) + '</span>' + versionStateBadge(o, v) + '</div>' +
        '<div class="tl-text">' + esc(v.changeReason || '—') + '</div>' +
        '<div class="xs muted">Saved ' + esc(ui.time(v.savedAt)) + ' by ' + esc(userName(v.authorId)) + '</div></li>';
    }).join('');
    parts.push('<section class="section"><div class="section-title">' + A.icon('history') + 'Version history</div><ol class="timeline">' + hist + '</ol></section>');
    var linked = assetsForOffer(o);
    var approved = linked.filter(function (a) { return a.approvedVersionId; });
    var other = linked.filter(function (a) { return !a.approvedVersionId; });
    parts.push('<section class="section"><div class="section-title">' + A.icon('circle-check') + 'Approved assets that use ' + esc(o.id) + '</div>' +
      (approved.length ? '<div class="list">' + approved.map(function (a) { return assetLink(a); }).join('') + '</div>' : '<p class="small muted">None yet.</p>') + '</section>');
    if (other.length) {
      parts.push('<section class="section"><div class="section-title">' + A.icon('eye') + 'In review against ' + esc(o.id) + '</div><div class="list">' + other.map(function (a) { return assetLink(a); }).join('') + '</div></section>');
    }
    return parts.join('');
  }
  function openOfferDrawer(id) {
    var o = profileOffer(id);
    if (!o) { A.toast('Offer ' + id + ' is not in this profile', 'error'); return; }
    A.drawer({
      id: 'pol-offer-drawer', title: o.id + ' · ' + o.name, width: 'lg', body: offerDrawerHtml(o),
      footer: '<span class="grow"></span>' + ui.button('Close', { action: 'drawer-close' }) +
        ui.button('Edit terms', { action: 'pol-offer-edit', data: { offerId: o.id }, variant: 'default', icon: 'edit' })
    });
  }

  /* ------------------------------------------------------------------ */
  /* Offer editor                                                        */
  /* ------------------------------------------------------------------ */
  function newOfferId(product) {
    var prefix = (TEMPLATES[product] || TEMPLATES.personal_loan).prefix, max = 0, re = new RegExp('^' + prefix + '-(\\d+)$');
    profileOffers().forEach(function (o) { var m = re.exec(o.id); if (m) max = Math.max(max, parseInt(m[1], 10)); });
    return prefix + '-' + (max + 1);
  }
  function termInput(k, val, baseVal) {
    var t = termType(k, baseVal != null ? baseVal : val), id = 'pol-term-' + k;
    var label = termLabel(k) + (UNIT[t] ? ' (' + UNIT[t] + ')' : '');
    var ctl;
    if (NUMERIC[t]) ctl = '<input class="input" type="number" step="any" inputmode="decimal" id="' + id + '" value="' + esc(blank(val) ? '' : String(val)) + '">';
    else if (t === 'bool') ctl = ui.select(id, [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], val ? 'yes' : 'no');
    else if (TERMS[k] && TERMS[k].long) ctl = '<textarea class="textarea" rows="2" id="' + id + '">' + esc(val == null ? '' : val) + '</textarea>';
    else ctl = '<input class="input" id="' + id + '" autocomplete="off" value="' + esc(val == null ? '' : val) + '">';
    return { long: !!(TERMS[k] && TERMS[k].long), html: ui.field(label, ctl, { id: id }) };
  }
  function offerEditorHtml(ed) {
    var o = ed.offerId ? profileOffer(ed.offerId) : null;
    var base = o ? latestOfferVersion(o) : null;
    var d = ed.draft || { eff: todayStr(), reason: o ? '' : 'Initial catalog load', terms: ed.baseTerms, id: ed.newId, name: '' };
    var intro = o
      ? ui.callout('info', null, 'Saving creates <strong>v' + (base.v + 1) + '</strong>. v' + esc(base.v) + ' stays on record; approvals and findings keep the offer version they were checked against.')
      : ui.callout('info', null, 'Offer-match rules compare ads with these terms. Leave a field blank if it does not apply.');
    var idFields = o ? '' :
      '<div class="field-row">' + ui.field('Product', ui.select('pol-offer-product', PRODUCT_ORDER.map(function (p) { return { value: p, label: PRODUCT[p] }; }), ed.product), { id: 'pol-offer-product' }) +
      ui.field('Offer ID', '<input class="input mono" id="pol-offer-id" maxlength="10" autocomplete="off" value="' + esc(d.id || '') + '">', { id: 'pol-offer-id', hint: 'For example ' + ed.newId + '.' }) + '</div>' +
      ui.field('Name', '<input class="input" id="pol-offer-name" maxlength="120" autocomplete="off" placeholder="For example: ClearPath Personal Loan" value="' + esc(d.name || '') + '">', { id: 'pol-offer-name' });
    var eff = ui.field('Effective from', '<input class="input" type="date" id="pol-offer-eff" value="' + esc(d.eff || todayStr()) + '"' + (base ? ' min="' + esc(base.effectiveFrom) + '"' : '') + '>',
      { id: 'pol-offer-eff', hint: base ? 'On or after ' + ui.date(base.effectiveFrom) + ' (v' + base.v + ' start). A later date schedules the change.' : 'The date these terms start to apply.' });
    var short = [], long = [];
    Object.keys(ed.baseTerms).forEach(function (k) { var x = termInput(k, (d.terms || {})[k], ed.baseTerms[k]); (x.long ? long : short).push(x.html); });
    var reason = ui.field(o ? 'Reason for change' : 'Reason', '<textarea class="textarea" id="pol-offer-reason" rows="2" maxlength="' + REASON_MAX + '" placeholder="For example: Rate committee memo RC-2026-11 raised the APR floor.">' + esc(d.reason || '') + '</textarea>',
      { id: 'pol-offer-reason', labelExtra: '<span class="counter pol-counter" id="pol-offer-reason-count"></span>', hint: 'Required. It appears in the version history and on every flagged asset.' });
    return '<form id="pol-offer-form" class="stack stack-lg" data-input="pol-offer-draft" data-change="pol-offer-draft" novalidate>' + intro + idFields + eff +
      '<section class="section"><div class="section-title">Terms</div><div class="grid grid-2">' + short.join('') + '</div>' + long.join('') + '</section>' +
      (o ? '<section class="section"><div class="section-header"><div class="section-title">' + A.icon('git-compare') + 'Changes vs v' + esc(base.v) + '</div>' + DIFF_LEGEND + '</div><div id="pol-offer-changes"></div></section>' : '') +
      reason + '</form>';
  }
  function readOfferForm(ed) {
    var val = function (id) { var el = document.getElementById(id); return el ? el.value : null; };
    var terms = {};
    Object.keys(ed.baseTerms).forEach(function (k) {
      var raw = val('pol-term-' + k); if (raw == null) return;
      var t = termType(k, ed.baseTerms[k]);
      if (NUMERIC[t]) { var n = parseFloat(raw); terms[k] = raw.trim() === '' || isNaN(n) ? null : n; }
      else if (t === 'bool') terms[k] = raw === 'yes';
      else terms[k] = raw.trim();
    });
    return {
      eff: (val('pol-offer-eff') || '').trim(), reason: (val('pol-offer-reason') || '').trim(), terms: terms,
      id: (val('pol-offer-id') || '').trim().toUpperCase(), name: (val('pol-offer-name') || '').trim()
    };
  }
  function offerProblems(ed, d) {
    var p = [];
    var o = ed.offerId ? profileOffer(ed.offerId) : null, base = o ? latestOfferVersion(o) : null;
    if (!o) {
      if (!/^[A-Z]{2,4}-\d{1,3}$/.test(d.id)) p.push('Use an offer ID like ' + ed.newId + '.');
      else if (profileOffer(d.id)) p.push(d.id + ' already exists in this profile.');
      if (!d.name) p.push('Add a name.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.eff)) p.push('Pick an effective date.');
    else if (base && d.eff < base.effectiveFrom) p.push('The effective date must be on or after ' + ui.date(base.effectiveFrom) + '.');
    PAIRS.forEach(function (pair) {
      var lo = d.terms[pair[0]], hi = d.terms[pair[1]];
      if (typeof lo === 'number' && typeof hi === 'number' && lo > hi) p.push(termLabel(pair[0]) + ' is higher than ' + termLabel(pair[1]).toLowerCase() + '.');
    });
    if (o && !termChanges(ed.baseTerms, d.terms).length) p.push('No term changes yet.');
    if (d.reason.length < REASON_MIN) p.push('Add a reason (at least ' + REASON_MIN + ' characters).');
    return p;
  }
  function updateOfferEditorLive() {
    var ed = st.offerEdit; if (!ed) return;
    var d = readOfferForm(ed);
    ed.draft = d;
    var ch = document.getElementById('pol-offer-changes'); if (ch) ch.innerHTML = changesListHtml(termChanges(ed.baseTerms, d.terms));
    var cnt = document.getElementById('pol-offer-reason-count');
    if (cnt) { cnt.textContent = d.reason.length + '/' + REASON_MAX; cnt.className = 'counter pol-counter ' + (d.reason.length >= REASON_MIN ? 'is-ok' : 'is-short'); }
    var probs = offerProblems(ed, d);
    var btn = document.getElementById('pol-offer-review-btn'); if (btn) btn.disabled = probs.length > 0;
    var hint = document.getElementById('pol-offer-save-hint'); if (hint) hint.textContent = probs[0] || (ed.offerId ? 'Next: review which approved assets this affects.' : 'Ready to save.');
  }
  function openOfferEditor(offerId, product) {
    var o = offerId ? profileOffer(offerId) : null;
    if (offerId && !o) return;
    if (!st.offerEdit || st.offerEdit.offerId !== (offerId || null) || (!offerId && product && st.offerEdit.product !== product)) {
      var prod = o ? o.product : (product || 'personal_loan');
      var keep = (!offerId && st.offerEdit && !st.offerEdit.offerId && st.offerEdit.draft) ? st.offerEdit.draft : null;
      st.offerEdit = {
        offerId: offerId || null, product: prod, newId: o ? null : newOfferId(prod),
        baseTerms: o ? A.clone(latestOfferVersion(o).terms || {}) : A.clone(TEMPLATES[prod].terms), draft: null
      };
      if (keep) {
        var autoId = /^(PL|CC|MG)-\d+$/.test(keep.id || '');
        st.offerEdit.draft = { eff: keep.eff, reason: keep.reason, name: keep.name, id: autoId || !keep.id ? st.offerEdit.newId : keep.id, terms: A.clone(st.offerEdit.baseTerms) };
      }
    }
    var ed = st.offerEdit;
    A.drawer({
      id: 'pol-offer-editor', width: 'lg',
      title: o ? 'Edit ' + o.id + ' terms · ' + o.name : 'Add offer',
      body: offerEditorHtml(ed),
      footer: '<span class="xs muted grow" id="pol-offer-save-hint" aria-live="polite"></span>' +
        ui.button('Cancel', { action: 'pol-offer-cancel' }) +
        (o ? ui.button('Review impact', { action: 'pol-offer-review', variant: 'default', icon: 'arrow-right', id: 'pol-offer-review-btn', disabled: true })
           : ui.button('Add offer', { action: 'pol-offer-create', variant: 'default', icon: 'check', id: 'pol-offer-review-btn', disabled: true })),
      onOpen: function () {
        var ps = document.getElementById('pol-offer-product'); if (ps) ps.value = ed.product;
        var terms = (ed.draft && ed.draft.terms) || ed.baseTerms;
        Object.keys(ed.baseTerms).forEach(function (k) {
          if (termType(k, ed.baseTerms[k]) !== 'bool') return;
          var el = document.getElementById('pol-term-' + k); if (el) el.value = terms[k] ? 'yes' : 'no';
        });
        updateOfferEditorLive();
      }
    });
  }
  function impactDialog(o, nextV, d, changes, impact) {
    var n = impact.affected.length;
    var ids = impact.affected.map(function (x) { return x.assetId; });
    var allMarked = impact.affected.every(function (x) { var a = A.asset(x.assetId); return a && (a.status === 'approved' || a.status === 'approved-with-exceptions' || a.status === 're-review-due'); });
    var headline = n === 0 ? 'No approved assets state a changed term'
      : 'This affects ' + A.plural(n, 'approved asset') + ' (' + ids.join(', ') + ') · ' +
        (allMarked ? (n === 1 ? 'it' : 'they') + ' will be marked Re-review due' : (n === 1 ? 'its live approval' : 'their live approvals') + ' will be flagged for re-review');
    var STATUS = A.labels.STATUS;
    var rows = impact.affected.map(function (x) {
      var a = A.asset(x.assetId); if (!a) return '';
      var note;
      if (a.status === 're-review-due') note = 'Already Re-review due. This change is added to the reason.';
      else if (a.status === 'approved' || a.status === 'approved-with-exceptions') note = 'Will be marked Re-review due. The V' + x.vn + ' approval stays on record.';
      else note = 'A newer version is in review (' + (STATUS[a.status] ? STATUS[a.status].label : a.status) + '). The live V' + x.vn + ' approval is flagged; the status stays.';
      return '<div class="list-item pol-item"><div class="stack stack-sm grow">' +
        '<div class="row row-wrap"><span class="mono small strong">' + esc(a.id) + '</span><span class="medium">' + esc(a.title) + '</span>' + ui.statusBadge(a.status) + '</div>' +
        '<div class="xs muted">Approved V' + esc(x.vn) + ' states “' + esc(x.hit.quote) + '” (' + esc(termLabel(x.hit.key)) + ')</div>' +
        '<div class="xs">' + esc(note) + '</div></div></div>';
    }).join('');
    var body = '<div class="stack stack-lg">' +
      '<section class="section"><div class="section-title">' + esc(o.id) + ' v' + nextV + ' · effective ' + esc(ui.date(d.eff)) + (d.eff > todayStr() ? ' (scheduled)' : '') + '</div>' + changesListHtml(changes) + '</section>' +
      ui.callout(n ? 'rereview' : 'success', headline, n
        ? '<div class="list mt-8">' + rows + '</div><p class="xs muted mt-8">Matched by term type in each approved version\'s text. Approved versions are never edited.</p>'
        : 'Approved assets that use ' + esc(o.id) + ' do not state the changed terms, so their approvals stand.' + (impact.unaffected.length ? ' Checked ' + esc(A.plural(impact.unaffected.length, 'approved asset')) + '.' : '')) +
      (impact.inReview.length ? '<p class="small muted">' + esc(A.plural(impact.inReview.length, 'asset')) + ' in review (' + esc(impact.inReview.join(', ')) + ') ' + (impact.inReview.length === 1 ? 'uses' : 'use') + ' ' + esc(o.id) + '. ' + (impact.inReview.length === 1 ? 'Its' : 'Their') + ' next check uses v' + nextV + '.</p>' : '') +
      '<p class="xs muted">Reason: ' + esc(d.reason) + '</p>' +
    '</div>';
    A.dialog({
      id: 'pol-offer-impact', size: 'md', title: 'Save ' + o.id + ' v' + nextV + '?', body: body,
      actions: [
        { label: 'Back', action: 'dialog-close', variant: 'outline' },
        { label: n ? 'Save v' + nextV + ' and flag ' + A.plural(n, 'asset') : 'Save v' + nextV, action: 'pol-offer-save', variant: 'default', icon: 'check', id: 'pol-offer-save-btn' }
      ]
    });
  }

  /* ------------------------------------------------------------------ */
  /* Routes                                                              */
  /* ------------------------------------------------------------------ */
  A.route('policies-rules', function (param) {
    if (param && !profileRule(param) && !starterRule(param)) return null;
    return renderPage('rules');
  }, { nav: 'policies', title: 'Policies' });
  A.route('policies-offers', function (param) {
    if (param && !profileOffer(param)) return null;
    return renderPage('offers');
  }, { nav: 'policies', title: 'Policies' });
  A.route('policies-references', function (param) {
    if (param && !A.referenceById(param)) return null;
    return renderPage('references');
  }, { nav: 'policies', title: 'Policies' });
  A.route('policies', function (param) {
    if (param) return null;
    return renderPage('rules');
  }, { nav: 'policies', title: 'Policies' });

  // Deep links open the matching drawer, or scroll to the reference.
  A.on('rendered', function (r) {
    if (!r || !r.nav || !r.param) return;
    if (r.name === 'policies-rules') {
      if (profileRule(r.param)) openRuleDrawer(r.param);
      else if (starterRule(r.param)) openLibrary(r.param);
    } else if (r.name === 'policies-offers') {
      if (profileOffer(r.param)) openOfferDrawer(r.param);
    } else if (r.name === 'policies-references') {
      var el = document.getElementById('pol-ref-' + r.param);
      if (el) { try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ } el.classList.add('flash'); }
    }
  });

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */
  A.action('pol-tab', function (el) { A.go('#policies-' + el.dataset.tab); });

  // Rules: filters
  A.action('pol-rule-q', function (el) { st.q = el.value || ''; A.rerender(); });
  A.action('pol-rule-kind', function (el) { st.kind = el.dataset.kind || 'all'; A.rerender(); });
  A.action('pol-rule-product', function (el) { st.product = el.value || 'all'; A.rerender(); });
  A.action('pol-rule-archived', function () { st.archived = !st.archived; st.kind = 'all'; A.rerender(); });
  A.action('pol-rule-clear', function () { st.q = ''; st.kind = 'all'; st.product = 'all'; st.archived = false; A.rerender(); });

  // Rules: view, redline, edit
  A.action('pol-open-rule', function (el) { openRuleDrawer(el.dataset.ruleId); });
  A.action('pol-rule-diff', function (el) {
    var rule = profileRule(el.dataset.ruleId); if (!rule) return;
    var v = parseInt(el.dataset.v, 10);
    st.ruleDiff[rule.id] = v;
    var panel = document.getElementById('pol-redline-panel');
    if (panel) {
      panel.innerHTML = redlineHtml(rule, v);
      Array.prototype.slice.call(document.querySelectorAll('#pol-rule-drawer .pol-diff-btn')).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === String(v))); });
      try { panel.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ }
      panel.classList.remove('flash'); void panel.offsetWidth; panel.classList.add('flash');
    } else openRuleDrawer(rule.id);
  });
  A.action('pol-rule-edit', function (el) { openRuleEditor(el.dataset.ruleId); });
  A.action('pol-rule-new', function () { st.ruleEdit = null; openRuleEditor(null); });
  A.action('pol-rule-draft', function () { updateRuleEditorLive(); });
  A.action('pol-rule-cancel', function () {
    var ed = st.ruleEdit; st.ruleEdit = null;
    if (ed && ed.ruleId && profileRule(ed.ruleId)) openRuleDrawer(ed.ruleId); else A.closeDrawer();
  });
  A.action('pol-rule-save', function () {
    var ed = st.ruleEdit; if (!ed) return;
    var rule = ed.ruleId ? profileRule(ed.ruleId) : null;
    var d = readRuleForm();
    var probs = ruleProblems(rule, d);
    if (probs.length) { A.toast(probs[0], 'error'); return; }
    var u = A.me(), now = A.nowIso(), savedV;
    if (!rule) {
      var id = ed.newId || newRuleId();
      while (profileRule(id)) id = newRuleId();
      rule = { id: id, profileId: pid(), title: d.title, kind: d.kind, referenceIds: d.referenceIds, appliesTo: d.appliesTo, defaultSeverity: d.defaultSeverity, clonedFrom: null,
        versions: [{ v: 1, text: d.text, changedAt: now, authorId: u.id, reason: d.reason }] };
      S().rules.push(rule);
      savedV = 1;
      A.logProfile(u.name, 'policy', 'Created rule ' + id + ' v1: ' + d.reason);
      A.notify('New rule ' + id + ' (' + d.title + ') created by ' + u.name, '#policies-rules-' + id);
    } else {
      var cur = curVer(rule);
      var changes = ruleChangeList(rule, d);
      var touched = {};
      ruleFindingsDetail(rule).forEach(function (x) { touched[x.asset.id] = x.version.n; });
      var nv = { v: cur.v + 1, text: d.text, changedAt: now, authorId: u.id, reason: d.reason };
      var fc = changes.filter(function (c) { return c !== TEXT_CHANGED; });
      if (fc.length) nv.fieldChanges = fc;
      rule.versions.push(nv);
      rule.title = d.title; rule.kind = d.kind; rule.defaultSeverity = d.defaultSeverity; rule.appliesTo = d.appliesTo; rule.referenceIds = d.referenceIds;
      savedV = nv.v;
      A.logProfile(u.name, 'policy', 'Saved rule ' + rule.id + ' v' + nv.v + ' (' + changes.join('; ') + '). Reason: ' + d.reason);
      Object.keys(touched).forEach(function (aid) {
        A.log(aid, u.name, 'rule-change', 'Rule ' + rule.id + ' updated to v' + nv.v + '. Findings on V' + touched[aid] + ' cite v' + cur.v + '; the next check uses v' + nv.v + '. Reason: ' + d.reason);
      });
      A.notify('Rule ' + rule.id + ' updated to v' + nv.v + ' by ' + u.name, '#policies-rules-' + rule.id);
    }
    st.ruleEdit = null;
    st.ruleDiff[rule.id] = savedV;
    A.emit('data-changed', { kind: 'rule', ruleId: rule.id });
    openRuleDrawer(rule.id);
    A.rerender();
    A.toast('Saved ' + rule.id + ' v' + savedV, 'success');
  });

  // Rules: archive and restore (never delete)
  A.action('pol-rule-archive', function (el) {
    var rule = profileRule(el.dataset.ruleId); if (!rule) return;
    var open = ruleFindingsDetail(rule).filter(function (x) { return isOpenStrict(x.finding); }).length;
    A.dialog({
      id: 'pol-archive-dialog', size: 'sm', title: 'Archive ' + rule.id + '?', dismissible: false,
      body: '<div class="stack"><p class="small">Checks stop using this rule. Past findings keep their citation and version, and you can restore the rule later. Nothing is deleted.</p>' +
        (open ? ui.callout('warning', A.plural(open, 'open finding') + ' cite this rule', 'They stay on their assets until a reviewer resolves or dismisses them.') : '') +
        ui.field('Reason', '<textarea class="textarea" id="pol-archive-reason" rows="2" maxlength="' + REASON_MAX + '" data-input="pol-archive-draft"></textarea>', { id: 'pol-archive-reason', hint: 'At least ' + REASON_MIN + ' characters.' }) + '</div>',
      actions: [
        { label: 'Cancel', action: 'dialog-close', variant: 'outline' },
        { label: 'Archive rule', action: 'pol-rule-archive-confirm', variant: 'destructive', data: { ruleId: rule.id }, id: 'pol-archive-btn', disabled: true }
      ]
    });
  });
  A.action('pol-archive-draft', function (el) { var b = document.getElementById('pol-archive-btn'); if (b) b.disabled = (el.value || '').trim().length < REASON_MIN; });
  A.action('pol-rule-archive-confirm', function (el) {
    var rule = profileRule(el.dataset.ruleId); if (!rule) return;
    var t = document.getElementById('pol-archive-reason'), reason = t ? t.value.trim() : '';
    if (reason.length < REASON_MIN) { A.toast('Add a reason (at least ' + REASON_MIN + ' characters)', 'error'); return; }
    var u = A.me();
    rule.archived = true; rule.archivedAt = A.nowIso(); rule.archivedBy = u.id; rule.archiveReason = reason;
    A.logProfile(u.name, 'policy', 'Archived rule ' + rule.id + ' (v' + curVer(rule).v + '). Reason: ' + reason);
    A.emit('data-changed', { kind: 'rule', ruleId: rule.id });
    A.closeDialog();
    openRuleDrawer(rule.id);
    A.rerender();
    A.toast('Archived ' + rule.id + '. Checks no longer use it.', 'success');
  });
  A.action('pol-rule-restore', function (el) {
    var rule = profileRule(el.dataset.ruleId); if (!rule) return;
    var u = A.me();
    rule.archived = false;
    A.logProfile(u.name, 'policy', 'Restored rule ' + rule.id + ' (v' + curVer(rule).v + ').');
    A.emit('data-changed', { kind: 'rule', ruleId: rule.id });
    openRuleDrawer(rule.id);
    A.rerender();
    A.toast('Restored ' + rule.id, 'success');
  });

  // Starter library
  A.action('pol-library', function () { openLibrary(); });
  A.action('pol-clone', function (el) {
    var libId = el.dataset.libId;
    var before = profileRules(true).length;
    var rule = cloneRule(libId);
    if (!rule) { A.toast('Starter rule ' + libId + ' not found', 'error'); return; }
    var created = profileRules(true).length > before;
    if (created) A.emit('data-changed', { kind: 'rule', ruleId: rule.id });
    keepDrawerScroll('pol-library', function () { openLibrary(); });
    A.rerender();
    A.toast(created ? 'Cloned ' + libId + ' as ' + rule.id + ' v1' : libId + ' is already in this profile as ' + rule.id, created ? 'success' : 'info');
  });
  A.action('pol-clone-all', function () {
    var cloned = profileRules(true).map(function (r) { return r.clonedFrom; });
    var missing = starterRules().filter(function (l) { return cloned.indexOf(l.id) < 0; });
    if (!missing.length) { A.toast('Every starter rule is already in this profile', 'info'); return; }
    missing.forEach(function (l) { cloneRule(l.id); });
    A.emit('data-changed', { kind: 'rule' });
    openLibrary();
    A.rerender();
    A.toast('Cloned ' + A.plural(missing.length, 'starter rule') + ' into ' + A.profile().name, 'success');
  });

  // Offers
  A.action('pol-open-offer', function (el) { openOfferDrawer(el.dataset.offerId); });
  A.action('pol-offer-v', function (el) {
    var o = profileOffer(el.dataset.offerId); if (!o) return;
    st.offerV[o.id] = parseInt(el.dataset.v, 10);
    keepDrawerScroll('pol-offer-drawer', function () { openOfferDrawer(o.id); });
    var btn = document.querySelector('#pol-offer-drawer [data-action="pol-offer-v"][data-v="' + st.offerV[o.id] + '"]');
    if (btn) { try { btn.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  });
  A.action('pol-offer-edit', function (el) { openOfferEditor(el.dataset.offerId); });
  A.action('pol-offer-new', function () { st.offerEdit = null; openOfferEditor(null, 'personal_loan'); });
  A.action('pol-offer-draft', function (form, ev) {
    var ed = st.offerEdit; if (!ed) return;
    var t = ev && ev.target;
    if (t && t.id === 'pol-offer-product' && !ed.offerId && t.value !== ed.product) {
      ed.draft = readOfferForm(ed);
      openOfferEditor(null, t.value);
      var sel = document.getElementById('pol-offer-product'); if (sel) { try { sel.focus(); } catch (e) { /* ignore */ } }
      return;
    }
    updateOfferEditorLive();
  });
  A.action('pol-offer-cancel', function () {
    var ed = st.offerEdit; st.offerEdit = null; st.offerPending = null;
    if (ed && ed.offerId && profileOffer(ed.offerId)) openOfferDrawer(ed.offerId); else A.closeDrawer();
  });
  A.action('pol-offer-review', function () {
    var ed = st.offerEdit; if (!ed || !ed.offerId) return;
    var o = profileOffer(ed.offerId); if (!o) return;
    var d = readOfferForm(ed); ed.draft = d;
    var probs = offerProblems(ed, d);
    if (probs.length) { A.toast(probs[0], 'error'); return; }
    var changes = termChanges(ed.baseTerms, d.terms);
    var nextV = latestOfferVersion(o).v + 1;
    var impact = offerImpact(o, changes);
    st.offerPending = { offerId: o.id, draft: d, changes: changes, impact: impact, nextV: nextV };
    impactDialog(o, nextV, d, changes, impact);
  });
  A.action('pol-offer-save', function () {
    var pend = st.offerPending; if (!pend) { A.closeDialog(); return; }
    var o = profileOffer(pend.offerId); if (!o) { A.closeDialog(); return; }
    var u = A.me(), d = pend.draft, changes = pend.changes, impact = pend.impact;
    var latest = latestOfferVersion(o);
    if (latest.v + 1 !== pend.nextV) { A.toast('The offer changed while you were editing. Review the impact again.', 'error'); A.closeDialog(); return; }
    o.versions.forEach(function (v) {
      if (!v.effectiveTo && v.effectiveFrom <= d.eff) v.effectiveTo = v.effectiveFrom === d.eff ? d.eff : dayBefore(d.eff);
    });
    var nv = { v: pend.nextV, effectiveFrom: d.eff, effectiveTo: null, savedAt: A.nowIso(), authorId: u.id, changeReason: d.reason, terms: A.clone(d.terms) };
    o.versions.push(nv);
    var sentence = changeSentence(changes);
    var why = 'Offer ' + o.id + ' v' + nv.v + ' (effective ' + mdY(nv.effectiveFrom) + ') changed ' + sentence;
    impact.affected.forEach(function (x) {
      var a = A.asset(x.assetId); if (!a) return;
      a.flags = a.flags || {};
      var was = a.status;
      a.flags.reReviewDue = was === 're-review-due' && a.flags.reReviewDue ? a.flags.reReviewDue + ' · ' + why : why;
      A.log(a.id, u.name, 'offer-change', 'Saved offer ' + o.id + ' v' + nv.v + ' (effective ' + ui.date(nv.effectiveFrom) + '): ' + sentence + '. The approved V' + x.vn + ' states "' + x.hit.quote + '".');
      if (was === 'approved' || was === 'approved-with-exceptions') {
        a.status = 're-review-due';
        a.subLabel = 'Offer ' + o.id + ' changed after approval';
        A.log(a.id, 'System', 'status', 'Status changed to Re-review due. The V' + x.vn + ' approval stays on record.');
      } else if (was === 're-review-due') {
        a.subLabel = 'Offer ' + o.id + ' changed after approval';
      }
    });
    impact.inReview.forEach(function (aid) {
      A.log(aid, u.name, 'offer-change', 'Saved offer ' + o.id + ' v' + nv.v + ' (effective ' + ui.date(nv.effectiveFrom) + '): ' + sentence + '. Earlier checks used an older version; the next check uses v' + nv.v + '.');
    });
    var flagged = impact.affected.map(function (x) { return x.assetId; });
    A.logProfile(u.name, 'offer-change', 'Saved offer ' + o.id + ' v' + nv.v + ' (effective ' + ui.date(nv.effectiveFrom) + '): ' + sentence + '. Reason: ' + d.reason +
      (flagged.length ? '. Flagged Re-review due: ' + flagged.join(', ') + '.' : '. No approved assets affected.'));
    A.notify('Offer ' + o.id + ' v' + nv.v + ' saved' + (flagged.length ? ' · ' + A.plural(flagged.length, 'approved asset') + ' marked Re-review due (' + flagged.join(', ') + ')' : ' · no approved assets affected'),
      flagged.length === 1 ? '#asset-' + flagged[0] : (flagged.length ? '#queue' : '#policies-offers-' + o.id));
    st.offerPending = null; st.offerEdit = null; st.offerV[o.id] = nv.v;
    A.emit('data-changed', { kind: 'offer', offerId: o.id, flagged: flagged });
    A.closeDialog();
    openOfferDrawer(o.id);
    A.rerender();
    A.toast('Saved ' + o.id + ' v' + nv.v + (flagged.length ? ' · ' + flagged.join(', ') + ' marked Re-review due' : ''), 'success');
  });
  A.action('pol-offer-create', function () {
    var ed = st.offerEdit; if (!ed || ed.offerId) return;
    var d = readOfferForm(ed); ed.draft = d;
    var probs = offerProblems(ed, d);
    if (probs.length) { A.toast(probs[0], 'error'); return; }
    var u = A.me();
    var o = { id: d.id, profileId: pid(), product: ed.product, name: d.name,
      versions: [{ v: 1, effectiveFrom: d.eff, effectiveTo: null, savedAt: A.nowIso(), authorId: u.id, changeReason: d.reason, terms: A.clone(d.terms) }] };
    S().offers.push(o);
    A.logProfile(u.name, 'offer-change', 'Added offer ' + o.id + ' v1 (' + o.name + ', effective ' + ui.date(d.eff) + '). Reason: ' + d.reason);
    st.offerEdit = null;
    A.emit('data-changed', { kind: 'offer', offerId: o.id });
    openOfferDrawer(o.id);
    A.rerender();
    A.toast('Added ' + o.id + ' v1', 'success');
  });

  // References
  A.action('pol-ref-q', function (el) { st.refQ = el.value || ''; A.rerender(); });
  A.action('pol-ref-clear', function () { st.refQ = ''; A.rerender(); });

  // Exports (dialogs with Copy; nothing is downloaded or sent)
  A.action('pol-export-rules', function () {
    var p = A.profile();
    var data = {
      profile: p.name, exportedAt: A.nowIso(), exportedBy: A.me().name,
      rules: profileRules(true).map(function (r) {
        return {
          id: r.id, title: r.title, kind: r.kind, appliesTo: r.appliesTo, defaultSeverity: r.defaultSeverity, citations: citeList(r.referenceIds || []),
          clonedFrom: r.clonedFrom || null, archived: !!r.archived,
          versions: r.versions.map(function (v) { return { v: v.v, changedAt: v.changedAt, author: userName(v.authorId), reason: v.reason, fieldChanges: v.fieldChanges || [], text: v.text }; })
        };
      })
    };
    A.showExport({ title: 'Export rules', text: data, format: 'json', filename: slug(p.name) + '-rules.json',
      description: 'Every rule in ' + p.name + ' with all versions, authors, dates and reasons. Generated in the browser from the prototype data.' });
  });
  A.action('pol-export-offers', function () {
    var p = A.profile();
    var data = {
      profile: p.name, exportedAt: A.nowIso(), exportedBy: A.me().name,
      offers: profileOffers().map(function (o) {
        return { id: o.id, name: o.name, product: o.product, inForce: 'v' + currentOfferVersion(o).v,
          versions: o.versions.map(function (v) { return { v: v.v, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, savedAt: v.savedAt, author: userName(v.authorId), reason: v.changeReason, terms: v.terms }; }) };
      })
    };
    A.showExport({ title: 'Export offer catalog', text: data, format: 'json', filename: slug(p.name) + '-offers.json',
      description: 'Every offer in ' + p.name + ' with all versions, effective dates and reasons. Generated in the browser from the prototype data.' });
  });
  A.action('pol-export-refs', function () {
    var text = A.csv(S().references, [
      { key: 'citation', label: 'Citation' }, { key: 'label', label: 'Reference' }, { key: 'summary', label: 'Summary' },
      { key: 'url', label: 'Source' }, { key: 'verifiedAsOf', label: 'Verified as of' }
    ]);
    A.showExport({ title: 'Export regulatory references', text: text, format: 'csv', filename: 'regulatory-references.csv',
      description: 'Read-only references with their sources and verification dates. Not legal advice; verify against the source.' });
  });

  /* ------------------------------------------------------------------ */
  /* Keyboard                                                            */
  /* ------------------------------------------------------------------ */
  ['policies-rules', 'policies-offers', 'policies-references', 'policies'].forEach(function (scope) {
    A.key(scope, '1', function () { A.go('#policies-rules'); }, 'Rules tab');
    A.key(scope, '2', function () { A.go('#policies-offers'); }, 'Offer catalog tab');
    A.key(scope, '3', function () { A.go('#policies-references'); }, 'Regulatory references tab');
  });
  ['policies-rules', 'policies'].forEach(function (scope) {
    A.key(scope, 'l', function () { openLibrary(); }, 'Open starter library');
    A.key(scope, 'n', function () { st.ruleEdit = null; openRuleEditor(null); }, 'New rule');
  });
  A.key('policies-offers', 'n', function () { st.offerEdit = null; openOfferEditor(null, 'personal_loan'); }, 'Add offer');
})();
