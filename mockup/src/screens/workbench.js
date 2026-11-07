/* workbench.js: the review workbench, route #asset-<id> (deep link to a version: #asset-<id>-v<n>).
   Left: creative viewer with evidence highlights. Right: Findings, Checklist, Offer facts, Coverage, Ask AI, History.
   Bottom: sticky decision bar. Uses only the App API (core.js), the CSS kit, and a small injected stylesheet (tokens only).
   The AI is advisory: nothing here lets the AI decide; every decision is a member action recorded through App.decide. */
(function () {
  'use strict';
  var A = window.App;
  if (!A) return;
  var ui = A.ui, esc = A.esc, icon = A.icon;

  /* ------------------------------------------------------------------ */
  /* Styles (theme tokens only; palette colours from data are inline)    */
  /* ------------------------------------------------------------------ */
  var CSS = `
.wb { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; min-width: 0; }
.wb-head { gap: 10px 16px; }
.wb-head-main { flex: 1 1 420px; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.wb-crumb a { color: inherit; text-decoration: none; }
.wb-crumb a:hover { color: var(--foreground); text-decoration: underline; text-underline-offset: 2px; }
.wb-crumb svg.i { width: 12px; height: 12px; }
.wb-title { margin: 0; overflow-wrap: anywhere; }
.wb-meta { gap: 6px; }
.wb-prov { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; color: var(--muted-foreground); min-width: 0; }
.wb-prov-label { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-head-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; flex: 0 1 auto; max-width: 100%; }
.wb-head .seg { flex-wrap: wrap; max-width: 100%; }
.wb-head .seg svg.i { width: 12px; height: 12px; color: var(--st-approved); }
.wb-banners { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 10px 16px; border-bottom: 1px solid var(--border); }
.wb-split { grid-template-columns: minmax(0, 1.05fr) minmax(360px, 1fr); grid-template-rows: minmax(0, 1fr); }
.wb-split > .pane { min-height: 0; }
.wb-tabs-head { padding: 0 6px; min-height: 0; }
.wb-tabs-head .tabs { border-bottom: 0; flex: 1 1 auto; }
.wb-panel { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.wb-viewer { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.wb-doc { font-size: 14px; line-height: 1.55; }
.wb-sec { position: relative; padding: 6px 10px 8px; border-radius: var(--radius-sm); scroll-margin: 16px; }
.wb-sec + .wb-sec { border-top: 1px dashed color-mix(in oklch, var(--creative-ink) 12%, transparent); }
.wb-sec-tools { display: flex; align-items: center; gap: 6px; min-height: 20px; margin-bottom: 2px; }
.wb-sec-label { font: 500 10.5px/1.2 var(--font-mono); text-transform: uppercase; letter-spacing: 0.04em; color: color-mix(in oklch, var(--creative-ink) 52%, transparent); }
.wb-sec-edit { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 7px; border: 1px solid color-mix(in oklch, var(--creative-ink) 18%, transparent); border-radius: var(--radius-sm); background: transparent; color: var(--creative-ink); font: 500 11.5px/1 var(--font-sans); opacity: 0.72; cursor: pointer; }
.wb-sec-edit:hover, .wb-sec-edit:focus-visible { opacity: 1; background: color-mix(in oklch, var(--creative-ink) 7%, transparent); }
.wb-sec-edit svg.i { width: 12px; height: 12px; }
.wb-sec-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.wb-r-headline .wb-sec-text { font-size: 19px; font-weight: 650; line-height: 1.3; letter-spacing: -0.01em; }
.wb-r-subject .wb-sec-text { font-weight: 600; }
.wb-r-preheader .wb-sec-text, .wb-r-footer .wb-sec-text, .wb-r-disclosure .wb-sec-text { font-size: 12px; color: color-mix(in oklch, var(--creative-ink) 72%, transparent); }
.wb-r-cta .wb-sec-text { display: inline-block; padding: 7px 14px; border-radius: 6px; background: var(--creative-ink); color: var(--creative-paper); font-weight: 600; font-size: 13px; }
.wb-r-cta .hl, .wb-r-cta .wb-inj { color: var(--creative-ink); }
.creative .hl { color: var(--creative-ink); }
.hl.wb-hl-dim { background: transparent; text-decoration-style: dotted; }
.wb-inj { background: transparent; color: inherit; outline: 1.5px dashed var(--st-security-alert); outline-offset: 1px; border-radius: 2px; cursor: pointer; }
.creative .hidden-text { color: var(--creative-ink); background: color-mix(in oklch, var(--destructive) 12%, var(--creative-paper)); border-color: var(--destructive); }
.wb-hidden-marker { display: inline-flex; align-items: center; gap: 4px; margin-left: 6px; height: 20px; padding: 0 6px; border: 1px dashed var(--destructive); border-radius: 4px; background: transparent; color: var(--destructive); font: 500 11px/1 var(--font-mono); vertical-align: middle; cursor: pointer; }
.wb-hidden-marker svg.i { width: 12px; height: 12px; }
.wb-email-head { padding: 8px 6px 4px; border-bottom: 1px solid color-mix(in oklch, var(--creative-ink) 12%, transparent); background: color-mix(in oklch, var(--creative-ink) 3%, var(--creative-paper)); }
.wb-email-row { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 8px; font-size: 12.5px; padding: 2px 10px; align-items: baseline; overflow-wrap: anywhere; }
.wb-k { color: color-mix(in oklch, var(--creative-ink) 55%, transparent); font-size: 12px; }
.wb-email-body, .wb-page-body { padding: 8px 6px 12px; }
.wb-browser-bar { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-bottom: 1px solid color-mix(in oklch, var(--creative-ink) 12%, transparent); background: color-mix(in oklch, var(--creative-ink) 4%, var(--creative-paper)); }
.wb-dots { display: inline-flex; gap: 5px; flex: none; }
.wb-dots i { width: 8px; height: 8px; border-radius: 999px; background: color-mix(in oklch, var(--creative-ink) 18%, transparent); display: block; }
.wb-url { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px; border-radius: 999px; background: var(--creative-paper); border: 1px solid color-mix(in oklch, var(--creative-ink) 12%, transparent); font: 400 11.5px/1 var(--font-mono); color: color-mix(in oklch, var(--creative-ink) 65%, transparent); }
.wb-url svg.i { width: 11px; height: 11px; flex: none; }
.wb-pdf { display: flex; flex-direction: column; gap: 4px; }
.wb-pdf-label { font-size: 11px; color: var(--muted-foreground); display: flex; gap: 5px; align-items: center; }
.wb-pdf-label svg.i { width: 12px; height: 12px; }
.wb-pdf-page { padding: 12px 8px; box-shadow: var(--shadow-md); }
.wb-seal { width: 64px; height: 64px; border-radius: 999px; border: 3px double currentColor; display: grid; place-items: center; font: 700 8.5px/1.15 var(--font-sans); letter-spacing: 0.08em; text-align: center; margin: 2px 10px 8px; }
.wb-ad-wrap { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px; border: 1px dashed var(--border); border-radius: var(--radius-md); background: color-mix(in oklch, var(--muted) 50%, var(--background)); min-width: 0; }
.wb-social { width: 100%; max-width: 320px; }
.wb-social-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; font-size: 12px; }
.wb-social-avatar { width: 26px; height: 26px; border-radius: 999px; display: grid; place-items: center; font: 700 10px/1 var(--font-sans); background: var(--creative-ink); color: var(--creative-paper); flex: none; }
.wb-art { display: flex; flex-direction: column; justify-content: center; gap: 8px; padding: 18px; }
.wb-ar-1x1 { aspect-ratio: 1 / 1; }
.wb-ar-4x5 { aspect-ratio: 4 / 5; }
.wb-ad-headline { font-size: 22px; font-weight: 700; line-height: 1.15; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.wb-ad-sub { font-size: 15px; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
.wb-ad-foot { font-size: 10px; line-height: 1.3; opacity: 0.9; margin-top: auto; overflow-wrap: anywhere; }
.wb-social-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; font-size: 11.5px; min-width: 0; }
.wb-ad-cta { display: inline-block; padding: 6px 12px; border-radius: 6px; background: var(--creative-ink); color: var(--creative-paper); font: 600 12px/1 var(--font-sans); white-space: nowrap; }
.wb-display { width: 300px; max-width: 100%; height: 250px; display: flex; flex-direction: column; gap: 8px; padding: 18px; }
.wb-phone { width: 100%; max-width: 300px; padding: 12px; border-radius: 18px; }
.wb-phone-head { font-size: 11.5px; text-align: center; color: color-mix(in oklch, var(--creative-ink) 55%, transparent); margin-bottom: 10px; }
.wb-bubble { background: color-mix(in oklch, var(--creative-ink) 8%, var(--creative-paper)); border-radius: 16px 16px 16px 4px; padding: 9px 12px; font-size: 13.5px; line-height: 1.45; overflow-wrap: anywhere; white-space: pre-wrap; }
.wb-search { width: 100%; max-width: 520px; padding: 12px 14px; }
.wb-search-url { font-size: 12px; }
.wb-search-title { font-size: 17px; line-height: 1.3; margin: 2px 0 4px; overflow-wrap: anywhere; }
.wb-search-desc { font-size: 13px; color: color-mix(in oklch, var(--creative-ink) 75%, transparent); overflow-wrap: anywhere; }
.wb-locked { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; padding: 36px 16px; font-size: 13px; }
.wb-locked svg.i { width: 28px; height: 28px; }
.wb-blocks { display: flex; flex-direction: column; gap: 0; min-width: 0; }
.wb-blocks > .row { margin-bottom: 8px; }
.wb-blocks .section-block { scroll-margin: 16px; }
.wb-measure { font-size: 11.5px; color: var(--muted-foreground); display: flex; gap: 6px; align-items: flex-start; }
.wb-measure svg.i { width: 13px; height: 13px; flex: none; margin-top: 1px; }
.btn.wb-mini { height: 24px; padding: 0 8px; font-size: 12px; }
.wb-summary { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12.5px; }
.wb-group { display: flex; flex-direction: column; gap: 8px; }
.wb-group-head { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--muted-foreground); }
.wb-group-head svg.i { width: 13px; height: 13px; }
.wb-finding { scroll-margin: 12px; }
.wb-f-title { font-size: 13.5px; font-weight: 600; line-height: 1.35; }
.wb-f-meta { display: flex; align-items: center; gap: 4px 8px; flex-wrap: wrap; font-size: 12px; color: var(--muted-foreground); }
.wb-f-meta .finding-rule { font-size: 12px; color: var(--foreground); }
.wb-f-expl { margin: 0; font-size: 12.5px; line-height: 1.5; }
.wb-cite { border: 0; background: none; padding: 0; display: inline-flex; align-items: center; gap: 3px; text-decoration: underline; text-underline-offset: 2px; text-decoration-color: var(--border); cursor: pointer; }
.wb-cite:hover { color: var(--foreground); }
.wb-cite svg.i { width: 11px; height: 11px; }
.wb-quote { display: block; width: 100%; text-align: left; background: none; border-top: 0; border-right: 0; border-bottom: 0; font: inherit; font-size: 13px; cursor: pointer; border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.wb-quote:hover { background: color-mix(in oklch, var(--muted) 60%, transparent); }
.wb-ev { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 500; }
.wb-ev svg.i { width: 12px; height: 12px; }
.wb-ev-ok { color: var(--success); }
.wb-ev-warn { color: var(--warning); }
.wb-sugg { border: 1px dashed var(--border); border-radius: var(--radius-md); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; min-width: 0; }
.wb-sugg-copy { font-size: 12.5px; padding: 6px 8px; background: var(--muted); border-radius: var(--radius-sm); overflow-wrap: anywhere; }
.wb-note { overflow-wrap: anywhere; }
.wb-dim { opacity: 0.72; }
.wb-f-actions .btn[aria-pressed="true"] { background: var(--primary); color: var(--primary-foreground); border-color: var(--primary); }
.wb-f-actions .btn[aria-pressed="true"] .kbd { background: color-mix(in oklch, var(--primary-foreground) 16%, transparent); color: var(--primary-foreground); border-color: transparent; }
details.wb-resolved > summary { cursor: pointer; font-size: 12px; font-weight: 600; color: var(--muted-foreground); padding: 4px 0; }
details.wb-resolved[open] > summary { margin-bottom: 8px; }
.wb-rule-cell { display: flex; flex-direction: column; gap: 1px; min-width: 0; white-space: normal; }
.wb-chat-item { display: flex; flex-direction: column; gap: 3px; max-width: 92%; align-self: flex-start; }
.wb-chat-item.wb-user { align-self: flex-end; align-items: flex-end; }
.wb-chat-item .chat-msg { max-width: 100%; }
.wb-chat-item .chat-meta { display: inline-flex; align-items: center; gap: 4px; }
.wb-chat-item .chat-meta svg.i { width: 12px; height: 12px; }
.wb-chat-compose { position: sticky; bottom: -14px; background: var(--background); padding: 10px 0 14px; margin-bottom: -14px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; z-index: 1; }
.wb-typing { color: var(--muted-foreground); }
.wb-bar { justify-content: space-between; }
.wb-bar-who { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 240px; }
.wb-bar-text { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.wb-bar-actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.btn.wb-danger { color: var(--danger); }
.wb-restate { font-size: 13px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--muted); overflow-wrap: anywhere; }
.wb-exc-list { display: flex; flex-direction: column; gap: 10px; }
.wb-diff { font-size: 13px; line-height: 1.55; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-md); white-space: pre-wrap; overflow-wrap: anywhere; }
.wb-fieldset { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.wb-fieldset > legend { padding: 0; margin-bottom: 6px; }
.wb-ver-list .list-item { flex-wrap: wrap; }
@media (max-width: 1100px) {
  .wb { display: block; }
  .wb .fill-header, .wb-banners { padding-left: 0; padding-right: 0; }
  .wb-split { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto; }
  .wb-split > .pane { border-right: 0; border-bottom: 1px solid var(--border); }
  .wb-chat-compose { position: static; margin-bottom: 0; }
}
@media (max-width: 640px) {
  .wb-head-actions { justify-content: flex-start; }
  .wb-bar-actions { width: 100%; }
  .wb-bar-actions .btn { flex: 1 1 auto; }
  .wb-ad-headline { font-size: 19px; }
  .wb-email-row { grid-template-columns: minmax(0, 1fr); gap: 0; }
}
@media (hover: none) { .wb-sec-edit { opacity: 1; } }
`;
  (function injectCss() {
    try {
      if (!document.head || document.querySelector('style[data-module="workbench.js"]')) return;
      var s = document.createElement('style');
      s.setAttribute('data-module', 'workbench.js');
      s.textContent = CSS;
      document.head.appendChild(s);
    } catch (e) { /* styles are cosmetic */ }
  })();

  /* ------------------------------------------------------------------ */
  /* Constants + screen state (in memory only)                           */
  /* ------------------------------------------------------------------ */
  var PRODUCT = { personal_loan: 'Personal loan', credit_card: 'Credit card', mortgage: 'Mortgage' };
  var CHANNEL = {
    paid_social: 'Paid social', display: 'Display', email: 'Email', affiliate_post: 'Affiliate post', direct_mail: 'Direct mail',
    landing_page: 'Landing page', sms: 'SMS', paid_search: 'Paid search', other: 'Other'
  };
  var EXC_REASONS = ['Disclosed elsewhere (cite the location)', 'Finding disputed (false positive)', 'Legal sign-off obtained', 'Accepted business risk'];
  var DISMISS_REASONS = ['Not an issue', 'Disclosed elsewhere', 'Rule doesn\'t apply to this channel', 'Duplicate of another finding'];
  var SEVS = ['critical', 'major', 'minor'];
  var DEFAULT_STEPS = ['Extracting text', 'Deterministic checks', 'Checking against rules', 'Verifying evidence'];
  var HEX = /^#[0-9a-fA-F]{3,8}$/;
  var TERM_LABELS = {
    aprMin: 'APR from', aprMax: 'APR up to', autopayDiscount: 'Autopay discount', aprIncludesAutopay: 'APR range includes autopay discount',
    originationFeeMin: 'Origination fee from', originationFeeMax: 'Origination fee up to', termMonthsMin: 'Term from', termMonthsMax: 'Term up to',
    amountMin: 'Loan amount from', amountMax: 'Loan amount up to', prepaymentPenalty: 'Prepayment penalty', creditCheck: 'Credit check',
    fundingTime: 'Funding time', representativeExample: 'Representative example', introApr: 'Intro APR', introMonths: 'Intro period',
    introAppliesTo: 'Intro APR applies to', goToAprMin: 'Go-to APR from', goToAprMax: 'Go-to APR up to', goToAprType: 'Go-to APR type',
    annualFee: 'Annual fee', balanceTransferFee: 'Balance transfer fee', balanceTransferApr: 'Balance transfer APR', cashAdvanceApr: 'Cash advance APR',
    cashAdvanceFee: 'Cash advance fee', foreignTransactionFee: 'Foreign transaction fee', lateFee: 'Late fee', rewards: 'Rewards',
    offerDeadline: 'Offer deadline', purchaseApr: 'Purchase APR', rateSheet: 'Rate sheet', rate30Fixed: '30-year fixed rate',
    apr30Fixed: '30-year fixed APR', pAndI30: '30-year monthly principal and interest', rate15Fixed: '15-year fixed rate', apr15Fixed: '15-year fixed APR',
    points: 'Points', assumptions: 'Assumptions', prequalNote: 'Prequalification', nmlsId: 'NMLS ID', equalHousing: 'Equal Housing legend'
  };
  var PCT_TERMS = ['aprMin', 'aprMax', 'originationFeeMin', 'originationFeeMax', 'introApr', 'goToAprMin', 'goToAprMax', 'cashAdvanceApr', 'foreignTransactionFee', 'rate30Fixed', 'apr30Fixed', 'rate15Fixed', 'apr15Fixed'];
  var USD_TERMS = ['amountMin', 'amountMax', 'annualFee', 'pAndI30'];
  var MONTH_TERMS = ['termMonthsMin', 'termMonthsMax', 'introMonths'];

  function freshState() {
    return {
      ver: {}, tab: 'findings', active: null, reveal: false, asOf: null, appliedParam: null, assetId: null,
      chatDraft: '', chatPending: false, dlg: null, dismiss: null, apply: null, edit: null, rev: null, crRows: null, pf: {}
    };
  }
  var st = freshState();
  function stopTimers() {
    Object.keys(st.pf).forEach(function (k) { if (st.pf[k] && st.pf[k].timer) clearTimeout(st.pf[k].timer); });
  }
  A.on('reset', function () { stopTimers(); st = freshState(); });
  A.on('route-changed', function (r) { if (!r || r.name !== 'asset') st.appliedParam = null; });

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */
  function byId(id) { return document.getElementById(id); }
  function later(fn) { setTimeout(fn, 0); }
  function mq(q) { try { return window.matchMedia(q).matches; } catch (e) { return false; } }
  function reduced() { return mq('(prefers-reduced-motion: reduce)'); }
  function stacked() { return mq('(max-width: 1100px)'); }
  function fmtInt(n) { return Number(n || 0).toLocaleString('en-US'); }
  function round4(n) { return Math.round(n * 10000) / 10000; }
  function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function sevLabel(sev) { var s = A.labels.SEVERITY[sev]; return s ? s.label : String(sev || ''); }
  function dispLabel(d) { var x = A.labels.DISPOSITION[d || 'open']; return x ? x.label : String(d || ''); }
  function originLabel(o) { return A.labels.ORIGIN[o] || o || 'Unknown'; }
  function slug(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 42) || 'page'; }
  function domainOf(email) { var m = /@([A-Za-z0-9.-]+)$/.exec(String(email || '')); return m ? m[1] : null; }
  function brandDomain() { return domainOf(A.me().email) || 'clearpathfinancial.example'; }
  function val(id) { var el = byId(id); return el ? String(el.value || '') : ''; }

  function flash(el) {
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 1300);
  }
  // Scroll an element into view inside its own pane (desktop) or the window (stacked layout).
  function scrollInPane(el) {
    if (!el) return;
    var pane = el.closest('.pane-body');
    if (!pane || stacked()) {
      try { el.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); } catch (e) { el.scrollIntoView(); }
      return;
    }
    var pr = pane.getBoundingClientRect(), er = el.getBoundingClientRect();
    var target = pane.scrollTop + (er.top - pr.top) - Math.max(12, (pane.clientHeight - er.height) / 2);
    try { pane.scrollTo({ top: Math.max(0, target), behavior: reduced() ? 'auto' : 'smooth' }); } catch (e) { pane.scrollTop = Math.max(0, target); }
  }

  function sectionsOf(v) { return (v && v.content && v.content.sections) || []; }
  function sectionById(v, id) { return sectionsOf(v).find(function (s) { return s.id === id; }) || null; }
  function hiddenOf(v) { return (v && v.content && v.content.hidden) || []; }
  function allText(v) { return sectionsOf(v).map(function (s) { return s.text || ''; }).join('\n') + '\n' + ((v && v.content && v.content.subject) || ''); }
  function textFor(v, sectionId) {
    if (sectionId === 'hidden') return hiddenOf(v).map(function (h) { return h.text || ''; }).join('\n');
    var s = sectionById(v, sectionId);
    return s ? (s.text || '') : null;
  }
  function contains(hay, needle) { return !!needle && A.normText(hay).indexOf(A.normText(needle)) >= 0; }
  function isVerified(v, f) {
    if (f.verifiedSpan === false) return false;
    if (!f.quote) return true;
    var t = textFor(v, f.sectionId);
    return contains(t != null ? t : allText(v), f.quote);
  }
  function role(label) {
    var l = String(label || '').toLowerCase();
    if (/subject/.test(l)) return 'subject';
    if (/preheader/.test(l)) return 'preheader';
    if (/call to action|\bcta\b/.test(l)) return 'cta';
    if (/footer/.test(l)) return 'footer';
    if (/disclosure|footnote/.test(l)) return 'disclosure';
    if (/headline|title|hero|envelope/.test(l)) return 'headline';
    return 'body';
  }
  function plabel(s) { return String((s && s.label) || '').replace(/\s*\(page \d+\)\s*/i, '') || 'Section'; }
  function partnerOf(a) { return a.partnerId ? A.partnerById(a.partnerId, a.profileId) : null; }
  function nextN(a) { return (a.versions || []).reduce(function (m, v) { return Math.max(m, v.n || 0); }, 0) + 1; }
  function isVisualFmt(v) { var f = v && v.content && v.content.format; return f === 'image' || f === 'text'; }
  function snippet(v) {
    var secs = sectionsOf(v);
    if (!secs.length) return 'No extracted text';
    var s = secs.find(function (x) { return role(x.label) === 'body'; }) || secs[0];
    var words = String(s.text || '').trim().split(/\s+/);
    return words.slice(0, 8).join(' ') + (words.length > 8 ? '…' : '');
  }
  function sevCounts(fs) {
    return SEVS.map(function (s) { var n = fs.filter(function (f) { return f.severity === s; }).length; return n ? n + ' ' + sevLabel(s) : null; }).filter(Boolean).join(', ');
  }
  function orderedFindings(v) {
    var fs = (v && v.findings) || [];
    var out = [];
    SEVS.forEach(function (s) { fs.forEach(function (f) { if (f.severity === s && f.recheck !== 'resolved') out.push(f); }); });
    fs.forEach(function (f) { if (out.indexOf(f) < 0 && f.recheck !== 'resolved') out.push(f); });
    return out;
  }
  function approvalFor(a, v) {
    if (!v || a.approvedVersionId !== v.id) return null;
    var ds = (a.decisions || []).filter(function (d) { return d.versionId === v.id && (d.decision === 'approved' || d.decision === 'approved-with-exceptions'); });
    return ds.length ? ds[ds.length - 1] : null;
  }
  function decisionById(a, id) { return (a.decisions || []).find(function (d) { return d.id === id; }) || null; }
  function ruleVersionAt(rule, at) {
    var t = A.toMs(at), best = null;
    (rule.versions || []).forEach(function (rv) { if (!rv.changedAt || A.toMs(rv.changedAt) <= t) best = rv; });
    return best || A.ruleVersion(rule);
  }
  function parseOfferRef(s) {
    var m = /^([A-Z]+-\d+)\s+v(\d+)/.exec(String(s || ''));
    if (!m) return null;
    var offer = A.offerById(m[1]);
    return { raw: s, offer: offer, ver: offer ? A.offerVersion(offer, parseInt(m[2], 10)) : null, id: m[1], v: parseInt(m[2], 10) };
  }
  function fmtTerm(k, value) {
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') {
      if (PCT_TERMS.indexOf(k) >= 0) return value + '%';
      if (USD_TERMS.indexOf(k) >= 0) return Number.isInteger(value) ? '$' + fmtInt(value) : ui.money(value);
      if (MONTH_TERMS.indexOf(k) >= 0) return value + ' months';
      if (k === 'autopayDiscount') return value + ' percentage points';
      return String(value);
    }
    return value == null ? '' : String(value);
  }
  function humanKey(k) { return TERM_LABELS[k] || String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, function (c) { return c.toUpperCase(); }); }

  /* ------------------------------------------------------------------ */
  /* Text utilities: tokens, diffs, applying a suggestion                */
  /* ------------------------------------------------------------------ */
  function toks(s) {
    var m = String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [], o = {};
    m.forEach(function (w) { o[w] = 1; });
    return Object.keys(o);
  }
  // Share of a's distinct words that also occur in b.
  function overlap(a, b) {
    var ta = toks(a), set = {};
    if (!ta.length) return 0;
    toks(b).forEach(function (w) { set[w] = 1; });
    return ta.filter(function (w) { return set[w]; }).length / ta.length;
  }
  function sentenceBounds(text, s, e) {
    var start = 0, end = text.length, i, j;
    for (i = s - 1; i >= 0; i--) { if (/[.!?]/.test(text[i]) && (i + 1 >= text.length || /\s/.test(text[i + 1]))) { start = i + 1; break; } }
    for (j = Math.max(e - 1, s); j < text.length; j++) { if (/[.!?]/.test(text[j]) && (j + 1 >= text.length || /\s/.test(text[j + 1]))) { end = j + 1; break; } }
    while (start < s && /\s/.test(text[start])) start++;
    return { s: start, e: end };
  }
  // Common prefix/suffix diff, widened to whole words.
  function diffParts(oldT, newT) {
    oldT = String(oldT || ''); newT = String(newT || '');
    var p = 0, max = Math.min(oldT.length, newT.length);
    while (p < max && oldT[p] === newT[p]) p++;
    var so = oldT.length, sn = newT.length;
    while (so > p && sn > p && oldT[so - 1] === newT[sn - 1]) { so--; sn--; }
    while (p > 0 && !/\s/.test(oldT[p - 1])) p--;
    while (so < oldT.length && !/\s/.test(oldT[so])) { so++; sn++; }
    if (sn < p) sn = p;
    return { pre: oldT.slice(0, p), oldMid: oldT.slice(p, so), newMid: newT.slice(p, sn), post: oldT.slice(so) };
  }
  // Keep the drawn ad's text (content.visual) in step with an edited section.
  function syncText(field, oldT, newT) {
    if (typeof field !== 'string' || !field || oldT === newT) return field;
    if (field === oldT) return newT;
    var d = diffParts(oldT, newT);
    if (d.oldMid.trim().length >= 2 && field.indexOf(d.oldMid) >= 0) return field.replace(d.oldMid, d.newMid);
    return field;
  }
  // Returns the section text with the finding's suggested copy applied, or null when the quote is gone.
  function applySuggestionText(text, f) {
    text = String(text || '');
    var q = f && f.quote, sugg = f && f.suggestedCopy;
    if (!q || !sugg) return null;
    var i = text.toLowerCase().indexOf(String(q).toLowerCase());
    if (i < 0) return null;
    var e = i + q.length, full = text.trim();
    // 1. A missing disclosure goes next to its anchor (the anchor stays).
    if (f.evidenceType === 'missing-disclosure' && overlap(q, sugg) < 0.5) {
      var ins = /[.!?]$/.test(sugg) ? sugg : sugg + '.';
      var after = text.slice(e);
      if (!after.trim()) return text.slice(0, i) + ins + ' ' + text.slice(i);
      return text.slice(0, e) + ' ' + ins + after;
    }
    // 2. The suggestion rewrites the whole section.
    if ((overlap(sugg, full) >= 0.5 && overlap(full, sugg) >= 0.6 && sugg.length >= 0.6 * full.length) || (i <= 1 && q.length >= 0.6 * full.length && /^[A-Z]/.test(sugg))) return sugg;
    // 3. The suggestion rewrites the sentence that holds the quote.
    var b = sentenceBounds(text, i, e);
    if (/[.!?]$/.test(sugg) && overlap(sugg, text.slice(b.s, b.e)) >= 0.5) return text.slice(0, b.s) + sugg + text.slice(b.e);
    // 4. Replace the quoted words.
    var before = text.slice(0, i), rest = text.slice(e), s = sugg;
    var midSentence = !!before.trim() && !/[.!?:]\s*$/.test(before);
    if (midSentence && /^[A-Z][a-z]/.test(s) && /[.!?]$/.test(s)) {
      var head = before.replace(/\s+$/, '').replace(/(?:[\s,]+(?:and|or|but|with|a|an|the|at|to|for|of|in|on|from|by|as))+$/i, '').replace(/[,;:]$/, '');
      var tail = rest.replace(/^\s*[.!?]+/, '').replace(/^\s+/, '').replace(/^(?:and|or|but|with)\s+/i, '');
      if (tail) tail = ' ' + tail.charAt(0).toUpperCase() + tail.slice(1);
      return head + '. ' + s + tail;
    }
    if (/[.!?]$/.test(s) && !/[.!?]$/.test(q)) {
      var nx = rest.replace(/^\s+/, '');
      if (/^[.!?]/.test(rest) || (nx && /^[a-z,;:]/.test(nx))) s = s.slice(0, -1);
    }
    if (midSentence && /^[A-Z][a-z]/.test(s)) s = s.charAt(0).toLowerCase() + s.slice(1);
    return before + s + rest;
  }
  function canApply(v, f) {
    if (!f || !f.suggestedCopy || !f.quote || !f.sectionId || f.sectionId === 'hidden') return false;
    var s = sectionById(v, f.sectionId);
    return !!s && applySuggestionText(s.text, f) !== null;
  }

  /* ------------------------------------------------------------------ */
  /* Context for one render                                              */
  /* ------------------------------------------------------------------ */
  function parseParam(param) {
    var m = /^([A-Za-z]+-\d+)(?:-v(\d+))?$/i.exec(String(param || ''));
    return m ? { id: m[1].toUpperCase(), n: m[2] ? parseInt(m[2], 10) : null } : null;
  }
  function ctx(param) {
    var p = parseParam(param);
    if (!p) return null;
    var a = A.asset(p.id);
    if (!a) return null;
    if (p.n && st.appliedParam !== param) {
      var pv = A.version(a, p.n);
      if (pv) st.ver[a.id] = pv.id;
      st.appliedParam = param;
    }
    var latest = A.latestVersion(a);
    var v = (st.ver[a.id] && A.version(a, st.ver[a.id])) || latest;
    if (!v) return null;
    var asOf = st.asOf ? decisionById(a, st.asOf) : null;
    var isLatest = !!latest && v.id === latest.id;
    var running = a.status === 'preflighting' || !!(v.run && v.run.status === 'running');
    var approvedStatus = a.status === 'approved' || a.status === 'approved-with-exceptions';
    var lockedApproved = approvedStatus && a.approvedVersionId === v.id;
    return {
      a: a, v: v, latest: latest, isLatest: isLatest, running: running, approvedStatus: approvedStatus, lockedApproved: lockedApproved,
      editable: isLatest && !running && !lockedApproved && !asOf, asOf: asOf, profile: A.profileOf(a) || A.profile(), me: A.me()
    };
  }
  function ctxCurrent() {
    var cur = A.current();
    return cur && cur.name === 'asset' ? ctx(cur.param) : null;
  }
  function isViewing(assetId) {
    var cur = A.current();
    var p = cur && cur.name === 'asset' ? parseParam(cur.param) : null;
    return !!p && p.id === assetId;
  }
  function readOnlyReason(c) {
    if (!c) return 'Open an asset first.';
    if (c.asOf) return 'You are looking at history as at a decision. Go back to now to make changes.';
    if (!c.isLatest) return 'V' + c.v.n + ' is an earlier version and read-only. Switch to V' + c.latest.n + '.';
    if (c.running) return 'Preflight is still running.';
    if (c.lockedApproved) return 'V' + c.v.n + ' is approved and read-only. Changes arrive as a new version.';
    return 'This version is read-only.';
  }
  function decideBlock(c) {
    if (c.asOf) return 'Go back to now before deciding.';
    if (!c.isLatest) return 'Only the latest version can be decided. Switch to V' + c.latest.n + '.';
    if (c.running) return 'Preflight is still running. Deciding opens when it finishes.';
    if (c.lockedApproved) return 'V' + c.v.n + ' is already approved.';
    if (A.blockingAlerts(c.v).length) return 'Acknowledge the security alert before deciding.';
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Highlighted text                                                    */
  /* ------------------------------------------------------------------ */
  function marked(text, sectionId, c) {
    text = String(text == null ? '' : text);
    var low = text.toLowerCase(), ranges = [];
    (c.v.findings || []).forEach(function (f) {
      if (f.sectionId !== sectionId || !f.quote || f.recheck === 'resolved') return;
      var i = low.indexOf(String(f.quote).toLowerCase());
      if (i >= 0) ranges.push({ s: i, e: i + f.quote.length, f: f });
    });
    if (sectionId !== 'hidden') {
      (c.v.securityAlerts || []).forEach(function (al, idx) {
        if (al.kind !== 'possible-injection' || !al.text) return;
        var i = low.indexOf(String(al.text).toLowerCase());
        if (i >= 0) ranges.push({ s: i, e: i + al.text.length, alert: idx });
      });
    }
    ranges.sort(function (x, y) { return x.s - y.s || (y.e - x.e); });
    var out = '', pos = 0;
    ranges.forEach(function (r) {
      if (r.s < pos) return; // overlapping spans: keep the first
      out += esc(text.slice(pos, r.s));
      var inner = esc(text.slice(r.s, r.e));
      if (r.f) {
        var f = r.f, sev = A.labels.SEVERITY[f.severity] ? f.severity : 'major';
        out += '<mark class="hl hl-' + sev + (st.active === f.id ? ' is-active' : '') + (f.disposition === 'dismissed' ? ' wb-hl-dim' : '') +
          '" id="wb-span-' + esc(f.id) + '" data-action="wb-span" data-finding="' + esc(f.id) + '" tabindex="0" role="button" title="' +
          esc(sevLabel(f.severity) + ': ' + (f.title || f.ruleId) + ' (' + f.id + ')') + '">' + inner + '</mark>';
      } else {
        out += '<mark class="wb-inj" id="wb-inj-' + r.alert + '" data-action="wb-span-alert" data-index="' + r.alert + '" tabindex="0" role="button" title="Possible injection: text addressed to AI systems">' + inner + '</mark>';
      }
      pos = r.e;
    });
    return out + esc(text.slice(pos));
  }
  function hiddenHost(c) {
    var secs = sectionsOf(c.v);
    if (!hiddenOf(c.v).length || !secs.length) return null;
    var foot = secs.find(function (s) { return role(s.label) === 'footer'; });
    return (foot || secs[secs.length - 1]).id;
  }
  function hiddenInline(c) {
    var hs = hiddenOf(c.v);
    if (!hs.length) return '';
    if (!st.reveal) {
      return ' <button type="button" class="wb-hidden-marker" data-action="wb-toggle-hidden" title="Hidden content was found here. Show it as inert text.">' + icon('eye-off') + 'hidden text</button>';
    }
    return hs.map(function (h, i) {
      return ' <span class="hidden-text" id="wb-hidden-' + i + '" title="' + esc('Hidden from people: ' + (h.how || 'method not recorded')) + '">[hidden] ' + marked(h.text, 'hidden', c) + '</span>';
    }).join('');
  }
  function styleFrom(fs) {
    var parts = [];
    if (fs && fs.sizePx && !isNaN(fs.sizePx)) parts.push('font-size:' + Number(fs.sizePx) + 'px');
    if (fs && HEX.test(fs.color || '')) parts.push('color:' + fs.color);
    return parts.length ? ' style="' + parts.join(';') + '"' : '';
  }

  /* ------------------------------------------------------------------ */
  /* Creative viewer                                                     */
  /* ------------------------------------------------------------------ */
  function editBtn(c, s) {
    if (!c.editable || !s) return '';
    return '<button type="button" class="wb-sec-edit" data-action="wb-edit-section" data-section="' + esc(s.id) + '" aria-label="Edit copy: ' + esc(plabel(s)) + '">' +
      icon('edit') + '<span>Edit copy</span></button>';
  }
  function secHtml(c, s, extraInner, styleAttr) {
    return '<div class="wb-sec wb-r-' + role(s.label) + '" id="wb-sec-' + esc(s.id) + '">' +
      '<div class="wb-sec-tools"><span class="wb-sec-label">' + esc(plabel(s)) + '</span>' + editBtn(c, s) + '</div>' +
      '<div class="wb-sec-text"' + (styleAttr || '') + '>' + marked(s.text, s.id, c) + (extraInner || '') + '</div></div>';
  }
  function emailFrame(c) {
    var secs = sectionsOf(c.v), host = hiddenHost(c), head = [], body = [];
    secs.forEach(function (s) { var r = role(s.label); (r === 'subject' || r === 'preheader' ? head : body).push(s); });
    var brand = (c.profile && c.profile.name) || 'Sender';
    var sec = function (s) { return secHtml(c, s, s.id === host ? hiddenInline(c) : ''); };
    var h = '<div class="wb-email-head">' +
      '<div class="wb-email-row"><span class="wb-k">From</span><span>' + esc(brand) + ' &lt;offers@' + esc(brandDomain()) + '&gt;</span></div>' +
      '<div class="wb-email-row"><span class="wb-k">To</span><span>Subscriber list</span></div>' +
      (head.length ? head.map(sec).join('') : (c.v.content.subject ? '<div class="wb-email-row"><span class="wb-k">Subject</span><span class="strong">' + esc(c.v.content.subject) + '</span></div>' : '')) +
      '</div>';
    return '<div class="creative wb-doc wb-email" aria-label="Email preview">' + h + '<div class="wb-email-body">' + body.map(sec).join('') + '</div></div>';
  }
  function browserFrame(c) {
    var a = c.a, vis = c.v.content.visual || {}, host = hiddenHost(c), p = partnerOf(a);
    var url = ((p && domainOf(p.contactEmail)) || brandDomain()) + '/' + slug(a.title);
    var body = sectionsOf(c.v).map(function (s) {
      var style = vis.footnoteStyle && role(s.label) === 'disclosure' ? styleFrom(vis.footnoteStyle) : '';
      return secHtml(c, s, s.id === host ? hiddenInline(c) : '', style);
    }).join('');
    return '<div class="creative wb-doc wb-browser" aria-label="Web page preview"><div class="wb-browser-bar"><span class="wb-dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '<span class="wb-url" title="' + esc(url) + '">' + icon('lock') + '<span class="truncate">' + esc(url) + '</span></span></div>' +
      '<div class="wb-page-body">' + body + '</div></div>';
  }
  function pdfPages(c) {
    var secs = sectionsOf(c.v), vis = c.v.content.visual || null, host = hiddenHost(c), pages = {}, order = [];
    secs.forEach(function (s) {
      var m = /\(page (\d+)\)/i.exec(s.label || ''), n = m ? parseInt(m[1], 10) : 1;
      if (!pages[n]) { pages[n] = []; order.push(n); }
      pages[n].push(s);
    });
    order.sort(function (x, y) { return x - y; });
    var pal = (vis && vis.palette) || {};
    var style = (HEX.test(pal.bg || '') ? 'background:' + pal.bg + ';' : '') + (HEX.test(pal.fg || '') ? 'color:' + pal.fg + ';' : '');
    return order.map(function (n, i) {
      var seal = i === 0 && vis && vis.seal ? '<div class="wb-seal" role="img" aria-label="Seal graphic on the envelope (image)"' + (HEX.test(pal.accent || '') ? ' style="color:' + pal.accent + '"' : '') + '><span>SEAL<br>GRAPHIC</span></div>' : '';
      return '<div class="wb-pdf"><div class="wb-pdf-label">' + icon('file') + 'Page ' + n + ' of ' + order.length + '</div>' +
        '<div class="creative wb-doc wb-pdf-page"' + (style ? ' style="' + style + '"' : '') + '>' + seal +
        pages[n].map(function (s) { return secHtml(c, s, s.id === host ? hiddenInline(c) : ''); }).join('') + '</div></div>';
    }).join('');
  }
  function adPreview(c) {
    var vis = c.v.content.visual;
    if (!vis) return '';
    var pal = vis.palette || {};
    var bg = HEX.test(pal.bg || '') ? pal.bg : null, fg = HEX.test(pal.fg || '') ? pal.fg : null, ac = HEX.test(pal.accent || '') ? pal.accent : null;
    var art = (bg ? 'background:' + bg + ';' : '') + (fg ? 'color:' + fg + ';' : '');
    var brand = (c.profile && c.profile.name) || 'Advertiser';
    var foot = vis.footnote ? '<div class="wb-ad-foot"' + (vis.footnoteStyle ? styleFrom(vis.footnoteStyle) : '') + '>' + esc(vis.footnote) + '</div>' : '';
    var cta = vis.cta ? '<span class="wb-ad-cta"' + (ac ? ' style="background:' + ac + ';color:' + (bg || fg || 'inherit') + '"' : '') + '>' + esc(vis.cta) + '</span>' : '';
    var sub = vis.subhead ? '<div class="wb-ad-sub"' + (ac ? ' style="color:' + ac + '"' : '') + '>' + esc(vis.subhead) + '</div>' : '';
    var html;
    if (vis.layout === 'display-300x250') {
      html = '<div class="creative wb-display" style="' + art + '"><div class="wb-ad-headline">' + esc(vis.headline || '') + '</div>' + sub + '<div>' + cta + '</div>' + foot + '</div>';
    } else {
      html = '<div class="creative wb-social"><div class="wb-social-head"><span class="wb-social-avatar" aria-hidden="true">' + esc(A.initials(brand)) + '</span>' +
        '<div><div class="strong">' + esc(brand) + '</div><div class="xs">Sponsored</div></div></div>' +
        '<div class="wb-art ' + (vis.layout === 'social-portrait' ? 'wb-ar-4x5' : 'wb-ar-1x1') + '" style="' + art + '"><div class="wb-ad-headline">' + esc(vis.headline || '') + '</div>' + sub + foot + '</div>' +
        '<div class="wb-social-foot"><span class="truncate">' + esc(brandDomain()) + '</span>' + cta + '</div></div>';
    }
    var label = { 'display-300x250': 'Display ad, 300 x 250', 'social-square': 'Social ad, 1:1', 'social-portrait': 'Social ad, 4:5' }[vis.layout] || 'Ad';
    return '<figure class="wb-ad-wrap" aria-label="' + esc(label) + ' preview">' + html + '<figcaption class="xs muted">' + esc(label) + ' · redrawn from the file for this prototype</figcaption></figure>';
  }
  function textPreview(c) {
    var vis = c.v.content.visual, secs = sectionsOf(c.v), brand = (c.profile && c.profile.name) || 'Sender';
    if (vis && vis.layout === 'search') {
      var heads = secs.filter(function (s) { return /headline/i.test(s.label); }).map(function (s) { return s.text; });
      var desc = secs.filter(function (s) { return /description/i.test(s.label); }).map(function (s) { return s.text; }).join(' ');
      var pal = vis.palette || {};
      return '<figure class="wb-ad-wrap" aria-label="Paid search ad preview"><div class="creative wb-search"><div class="xs">Sponsored</div>' +
        '<div class="wb-search-url"' + (HEX.test(pal.accent || '') ? ' style="color:' + pal.accent + '"' : '') + '>' + esc(brandDomain()) + '</div>' +
        '<div class="wb-search-title"' + (HEX.test(pal.fg || '') ? ' style="color:' + pal.fg + '"' : '') + '>' + esc(heads.join(' | ')) + '</div>' +
        '<div class="wb-search-desc">' + esc(desc) + '</div></div><figcaption class="xs muted">Paid search ad · redrawn from the import row</figcaption></figure>';
    }
    if (c.a.channel === 'sms') {
      return '<figure class="wb-ad-wrap" aria-label="Text message preview"><div class="creative wb-phone"><div class="wb-phone-head">' + esc(brand) + ' · Text message</div>' +
        '<div class="wb-bubble">' + esc(secs.map(function (s) { return s.text; }).join('\n')) + '</div></div><figcaption class="xs muted">SMS preview</figcaption></figure>';
    }
    return '';
  }
  function sectionBlocks(c, heading) {
    var host = hiddenHost(c);
    var note = c.v.content.format === 'image' ? '<span class="tag" title="Images and layout are not editable here">text suggestion only</span>' : '';
    return '<div class="wb-blocks"><div class="row row-tight"><span class="section-title">' + esc(heading) + '</span>' + note + '</div>' +
      sectionsOf(c.v).map(function (s) {
        return '<div class="section-block" id="wb-sec-' + esc(s.id) + '"><div class="section-block-head"><span>' + esc(plabel(s)) + '</span><span class="spacer"></span>' +
          (c.editable ? ui.button('Edit copy', { action: 'wb-edit-section', data: { section: s.id }, size: 'sm', variant: 'ghost', icon: 'edit', cls: 'wb-mini', ariaLabel: 'Edit copy: ' + plabel(s) }) : '') +
          '</div><div class="section-block-body">' + marked(s.text, s.id, c) + (s.id === host ? hiddenInline(c) : '') + '</div></div>';
      }).join('') + '</div>';
  }
  function lockedPdf(vis) {
    return '<div class="creative wb-locked">' + icon('lock') + '<div class="strong">' + esc(vis.headline || 'Locked file') + '</div>' +
      '<div>' + esc(vis.subhead || '') + '</div><div>Text could not be extracted, so nothing in this file was checked. Open the original from its source to review it yourself.</div></div>';
  }
  function measureNote(c) {
    var vis = c.v.content.visual, fs = vis && vis.footnoteStyle;
    if (!fs) return '';
    return '<div class="wb-measure">' + icon('info') + '<span>Measured in the rendered creative: ' + (vis.layout === 'display-300x250' ? 'footnote' : 'disclosure') + ' at about ' + esc(fs.sizePx) + 'px, ' +
      esc(fs.color || '') + ' on ' + esc(fs.bg || '') + (fs.contrastRatio ? ', contrast ' + esc(fs.contrastRatio) + ':1' : '') + '. CP-DISC-01 asks for at least 10px and 4.5:1 contrast.</span></div>';
  }
  function hiddenNote(c) {
    var hs = hiddenOf(c.v);
    if (!hs.length) return '';
    return '<div class="wb-measure" id="wb-hidden-note">' + icon('shield-alert') + '<span>' + esc(A.plural(hs.length, 'block') + ' of hidden text found (' + (hs[0].how || 'method not recorded') + '). ') +
      (st.reveal ? 'Shown above as inert, outlined text. It is never executed or followed.' : 'Turn on Show hidden text to see it as inert text.') + '</span></div>';
  }
  function viewer(c) {
    var ct = c.v.content || {}, secs = sectionsOf(c.v), vis = ct.visual || null, out;
    if (!secs.length && vis && vis.layout === 'locked-pdf') return '<div class="wb-viewer">' + lockedPdf(vis) + '</div>';
    if (!secs.length) return ui.empty('No extracted content', 'This version has no text to show.');
    switch (ct.format) {
      case 'email': out = emailFrame(c); break;
      case 'html': out = browserFrame(c); break;
      case 'pdf': out = pdfPages(c); break;
      case 'image': out = adPreview(c) + sectionBlocks(c, 'Text in this image (OCR)'); break;
      case 'text': out = textPreview(c) + sectionBlocks(c, c.a.channel === 'sms' ? 'Message text' : 'Ad text'); break;
      default: out = sectionBlocks(c, 'Content');
    }
    return '<div class="wb-viewer">' + out + measureNote(c) + hiddenNote(c) + '</div>';
  }
  function formatLabel(c) {
    var ct = c.v.content || {}, vis = ct.visual;
    if (vis && vis.layout === 'locked-pdf') return 'PDF, locked';
    if (ct.format === 'html') return 'Web page (HTML)';
    if (ct.format === 'email') return 'Email (HTML)';
    if (ct.format === 'pdf') return 'PDF';
    if (ct.format === 'image') return 'Image';
    if (ct.format === 'text') return c.a.channel === 'sms' ? 'SMS text' : 'Text';
    return ct.format || 'Content';
  }
  function leftPane(c) {
    var hasHidden = hiddenOf(c.v).length > 0;
    var fmt = c.v.content && c.v.content.format;
    var sw = hasHidden ? '<span class="small" id="wb-hidden-label">Show hidden text</span><button type="button" class="switch" role="switch" id="wb-hidden-switch" aria-checked="' + st.reveal + '" aria-labelledby="wb-hidden-label" data-action="wb-toggle-hidden"></button>' : '';
    var tag = (fmt === 'image' || fmt === 'pdf') ? '<span class="tag hide-mobile" title="Images, PDF layout and video are not editable">text suggestion only</span>' : '';
    return '<section class="pane wb-pane-left" aria-label="Creative">' +
      '<div class="pane-header"><div class="pane-title">' + icon(fmt === 'image' ? 'image' : fmt === 'email' ? 'mail' : 'file-text') + 'Creative</div>' +
      '<span class="muted small truncate">' + esc(formatLabel(c)) + ' · ' + esc(ui.versionLabel(c.a, c.v)) + '</span><span class="spacer"></span>' + tag + sw + '</div>' +
      '<div class="pane-body" id="wb-left-body">' + viewer(c) + '</div></section>';
  }

  /* ------------------------------------------------------------------ */
  /* Header + banners                                                    */
  /* ------------------------------------------------------------------ */
  function versionSeg(c) {
    var a = c.a;
    if ((a.versions || []).length < 2) return '<span class="badge badge-outline" title="Only one version so far">V' + esc(c.v.n) + '</span>';
    return '<div class="seg" role="group" aria-label="Version">' + a.versions.map(function (v) {
      return '<button type="button" data-action="wb-version" data-version="' + esc(v.id) + '" aria-pressed="' + (v.id === c.v.id) + '" title="' +
        esc(ui.versionLabel(a, v) + ' · ' + originLabel(v.origin) + ' · ' + ui.time(v.createdAt)) + '">V' + esc(v.n) +
        (v.id === a.approvedVersionId ? icon('circle-check', { label: 'approved' }) : '') + (v.id === a.latestVersionId ? '<span class="xs muted">latest</span>' : '') + '</button>';
    }).join('') + '</div>';
  }
  function header(c) {
    var a = c.a, v = c.v, p = partnerOf(a);
    var camp = a.campaignId ? A.campaignById(a.campaignId) : null;
    var refs = a.sourceRefs || [], ref0 = refs[0], src0 = ref0 ? A.sourceById(ref0.sourceId) : null;
    var run = v.run || {};
    var reused = run.reusedFrom || (a.flags && a.flags.reusedFrom && a.flags.reusedFrom.runId);
    var chips = [ui.statusBadge(a.status, a.subLabel)];
    if (A.blockingAlerts(c.latest).length) chips.push(ui.statusBadge('security-alert'));
    if (a.flags && a.flags.selfApproved && c.approvedStatus) chips.push(ui.tag('self-approved', { icon: 'user', title: 'The approver also authored or submitted the approved version' }));
    if (a.dueDate && !c.approvedStatus && a.status !== 'rejected') chips.push(ui.due(a.dueDate));
    chips.push(ui.chip(PRODUCT[a.product] || a.product || 'No product', { size: 'sm', icon: 'tag', title: 'Product' }));
    chips.push(ui.chip(CHANNEL[a.channel] || a.channel || 'No channel', { size: 'sm', icon: 'layers', title: 'Channel' }));
    chips.push(ui.chip(a.states && a.states.length ? a.states.join(', ') : 'No states set', { size: 'sm', icon: 'building', title: 'Target states' }));
    chips.push(ui.chip(p ? p.name + ' · ' + (p.type === 'agency' ? 'Agency' : 'Affiliate') : (a.submitter ? a.submitter.name : 'Unknown') + ' · Member', { size: 'sm', icon: p ? 'users' : 'user', title: 'Submitted by' }));
    if (camp) chips.push(ui.chip(camp.name, { size: 'sm', icon: 'layers', title: 'Campaign (optional label)' }));
    if (reused) chips.push(ui.chip('Reused from ' + reused + ' · $0', { size: 'sm', icon: 'refresh', action: 'wb-reuse', title: 'Results for unchanged sections were copied from an earlier run' }));

    var prov1 = ref0 ? '<div class="wb-prov">' + (src0 ? ui.sourceIcon(src0.provider) : icon('link')) + '<span class="wb-prov-label" title="' + esc(ref0.label) + '">' + esc(ref0.label) + '</span>' +
      '<span>· ' + esc(ui.time(ref0.seenAt)) + '</span>' + (refs.length > 1 ? ui.button('+' + (refs.length - 1) + ' more', { action: 'wb-sources', variant: 'link', size: 'sm' }) : '') + '</div>' : '';
    var prov2 = '<div class="wb-prov"><span>V' + esc(v.n) + ' · ' + esc(originLabel(v.origin)) + ' · ' + esc(v.authorName || 'Unknown') + ' · ' + esc(ui.time(v.createdAt)) + '</span>' + ui.sha(v.sha) +
      (run.id ? '<span>· Checked against ' + esc(A.plural((v.checklist || []).length, 'rule')) + ((run.offerSnapshot || []).length ? ' and ' + esc(run.offerSnapshot.join(', ')) : '') + ' · ' + esc(run.id) + '</span>' : '') + '</div>';

    var actions = versionSeg(c) +
      ((a.versions || []).length > 1 ? ui.button('Compare', { href: '#compare-' + a.id, size: 'sm', icon: 'git-compare', title: 'Compare versions' }) : '') +
      ui.button('Edit details', { action: 'wb-edit-details', size: 'sm', icon: 'edit' }) +
      ui.button('Add revision', { action: 'wb-revision', size: 'sm', icon: 'upload', disabled: c.running, title: c.running ? 'Wait for preflight to finish' : 'Paste or upload a revised version' }) +
      ui.button('More actions', { action: 'wb-more', size: 'sm', icon: 'more', iconOnly: true, attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } });

    return '<div class="fill-header wb-head"><div class="wb-head-main">' +
      '<div class="page-eyebrow wb-crumb"><a href="#queue">Queue</a>' + icon('chevron-right') + '<span class="mono">' + esc(a.id) + '</span></div>' +
      '<h1 class="page-title wb-title">' + esc(a.title) + '</h1>' +
      '<div class="row row-wrap wb-meta">' + chips.join('') + '</div>' + prov1 + prov2 +
      '</div><div class="wb-head-actions">' + actions + '</div></div>';
  }
  function banners(c) {
    var a = c.a, out = [];
    if (c.asOf) {
      var u = A.userById(c.asOf.approverId);
      out.push(ui.callout('info', 'As at ' + ui.time(c.asOf.at),
        esc((A.labels.DECISION[c.asOf.decision] || c.asOf.decision) + ' · V' + c.v.n + ' · sha ' + (c.asOf.sha || c.v.sha) + ' · ' + (u ? u.name : 'Unknown')) +
        '. The creative is the version that was decided. History shows only events up to that moment.',
        { icon: 'history', actionsHtml: ui.button('Back to now', { action: 'wb-asof-clear', size: 'sm', variant: 'default' }) }));
    } else if (!c.isLatest) {
      out.push(ui.callout('neutral', 'Viewing V' + c.v.n + ' (read-only)', 'V' + c.latest.n + ' is the latest version. Earlier versions never change.',
        { icon: 'history', actionsHtml: ui.button('Go to V' + c.latest.n, { action: 'wb-latest', size: 'sm' }) + ui.button('Compare', { href: '#compare-' + a.id, size: 'sm', icon: 'git-compare' }) }));
    }
    if (a.approvedVersionId && a.approvedVersionId !== a.latestVersionId) {
      var av = A.version(a, a.approvedVersionId), lv = c.latest;
      if (av && lv) {
        out.push(ui.callout('warning', 'Approved V' + av.n + ' · Source changed ' + ui.date(lv.createdAt) + ' → V' + lv.n + ' unapproved',
          esc('V' + av.n + ' stays approved and on record. V' + lv.n + ' (' + originLabel(lv.origin) + ', sha ' + lv.sha + ') needs a decision before it can be used.'),
          { icon: 'git-compare', actionsHtml: (c.v.id !== av.id ? ui.button('View V' + av.n, { action: 'wb-version', data: { version: av.id }, size: 'sm' }) : ui.button('View V' + lv.n, { action: 'wb-version', data: { version: lv.id }, size: 'sm' })) +
            ui.button('Compare V' + av.n + ' → V' + lv.n, { href: '#compare-' + a.id, size: 'sm', icon: 'git-compare' }) }));
      }
    }
    if (a.status === 're-review-due') {
      var why = a.flags && typeof a.flags.reReviewDue === 'string' ? a.flags.reReviewDue : 'Something this approval relied on changed';
      out.push(ui.callout('rereview', 'Re-review due', esc(why) + '. The earlier approval stays on record until you decide again: fix the copy, request changes, approve with exceptions or reject.',
        { actionsHtml: ui.button('Open offer catalog', { href: '#policies-offers', size: 'sm', icon: 'book' }) }));
    }
    if (a.flags && a.flags.extractionFailed) {
      out.push(ui.callout('danger', 'Couldn\'t extract text: ' + (typeof a.flags.extractionFailed === 'string' ? a.flags.extractionFailed : 'unreadable file'),
        'No AI check ran ($0) and nothing was reviewed, so this asset is never shown as No issues flagged. Ask for an unlocked file and add it as a revision, or review the original yourself.',
        { actionsHtml: ui.button('Add revision', { action: 'wb-revision', size: 'sm', icon: 'upload' }) + ui.button('Retry extraction', { action: 'wb-retry', size: 'sm', icon: 'refresh' }) }));
    } else if (c.latest && c.latest.run && c.latest.run.status === 'failed' && c.latest.run.failReason) {
      out.push(ui.callout('warning', 'AI re-run declined', esc(c.latest.run.failReason) + ' Review the changes manually.'));
    }
    return out.length ? '<div class="wb-banners">' + out.join('') + '</div>' : '';
  }

  /* ------------------------------------------------------------------ */
  /* Right pane: tabs                                                    */
  /* ------------------------------------------------------------------ */
  function preflightCard(c) {
    var v = c.v, run = v.run || {}, pend = run.pending || {};
    var steps = pend.steps || DEFAULT_STEPS;
    var idx = st.pf[c.a.id] ? Math.min(st.pf[c.a.id].idx, steps.length - 1) : 0;
    return '<div class="wb-panel"><div class="card"><div class="card-header"><div><div class="card-title">' + icon('loader', { cls: 'spin' }) + 'Preflight running · ' + esc(run.id || '') + '</div>' +
      '<div class="card-desc">Started ' + esc(ui.relTime(run.at || v.createdAt)) + '. Findings appear when the run finishes. Deciding is disabled until then.</div></div></div>' +
      '<div class="card-body">' + ui.steps(steps, idx) + '</div></div>' + ui.skeleton(4) + '<div>' + ui.aiChip() + '</div></div>';
  }
  function alertCard(c, al, i) {
    var canAck = c.isLatest && !c.asOf && !al.acknowledged;
    var ackd = al.acknowledged ? '<span class="small row row-tight">' + icon('check') + 'Acknowledged' + (al.acknowledgedBy ? ' by ' + esc(al.acknowledgedBy) : '') + (al.acknowledgedAt ? ', ' + esc(ui.time(al.acknowledgedAt)) : '') + '</span>' : '';
    if (al.kind === 'hidden-text') {
      var body = '<p>Instruction-like text was found in the submitted content. It was treated as content and not followed. AI results for this asset may be unreliable, so review it manually.</p>' +
        '<div class="small"><span class="medium">How it was hidden:</span> ' + esc(al.how || 'Not recorded') + '</div>' +
        '<div class="inert-block" role="note" aria-label="Hidden text, shown as inert text">' + esc(al.text) + '</div>' +
        (al.acknowledged ? '' : '<div class="small">Acknowledge it before deciding. Acknowledging records that you saw it; the related finding stays open.</div>');
      return '<div id="wb-alert-' + i + '">' + ui.callout('security', 'Security alert: hidden instructions', body, {
        actionsHtml: ui.button('Jump to text', { action: 'wb-jump-hidden', data: { index: i }, size: 'sm', icon: 'eye' }) +
          (canAck ? ui.button('Acknowledge', { action: 'wb-ack', data: { index: i }, size: 'sm', variant: 'default', icon: 'shield-check' }) : '') + ackd
      }) + '</div>';
    }
    var body2 = '<p>Visible text in the content is addressed to AI systems. It was treated as content and the check continued. This warning doesn\'t block a decision.</p>' +
      '<div class="small"><span class="medium">Where:</span> ' + esc(al.how || 'Not recorded') + '</div>' +
      '<div class="inert-block" role="note" aria-label="Text addressed to AI systems, shown as inert text">' + esc(al.text) + '</div>';
    return '<div id="wb-alert-' + i + '">' + ui.callout('warning', 'Possible injection (visible text)', body2, {
      icon: 'shield-alert',
      actionsHtml: ui.button('Jump to text', { action: 'wb-span-alert', data: { index: i }, size: 'sm', icon: 'eye' }) +
        (canAck ? ui.button('Mark as seen', { action: 'wb-ack', data: { index: i }, size: 'sm', icon: 'check' }) : '') + ackd
    }) + '</div>';
  }
  function approvalCallout(c, d) {
    var u = A.userById(d.approverId), exc = d.exceptions || [];
    var withExc = d.decision === 'approved-with-exceptions';
    var body = esc((u ? u.name : 'Unknown') + ' · ' + ui.time(d.at)) + ' · ' + ui.sha(d.sha || c.v.sha) + (d.selfApproved ? ' · ' + ui.tag('self-approved') : '') +
      (exc.length ? '<ul class="small" style="margin:4px 0 0;padding-left:18px">' + exc.map(function (e) { return '<li><span class="mono">' + esc(e.findingId) + '</span> · ' + esc(e.reason) + ': ' + esc(truncate(e.text, 140)) + '</li>'; }).join('') + '</ul>' : '') +
      (c.lockedApproved ? '<div class="small">Approved versions are read-only. Changes arrive as a new version from the source, or with Add revision.</div>' : '');
    return ui.callout(withExc ? 'warning' : 'success', (withExc ? 'Approved with ' + A.plural(exc.length, 'exception') : 'Approved') + ' · V' + c.v.n, body,
      { actionsHtml: ui.button('Approval record', { action: 'wb-record', data: { decision: d.id }, size: 'sm', icon: 'clipboard-check' }) });
  }
  function dispoBtn(f, value, label, k) {
    return ui.button(label, { action: 'wb-dispo', data: { finding: f.id, value: value }, size: 'sm', pressed: f.disposition === value, kbd: st.active === f.id ? k : null, title: label + ' (key ' + k + ')' });
  }
  function findingCard(c, f) {
    var v = c.v, rule = A.ruleById(f.ruleId), latestRv = rule ? A.ruleVersion(rule) : null;
    var refs = rule ? (rule.referenceIds || []).map(function (id) { return A.referenceById(id); }).filter(Boolean) : [];
    var resolved = f.recheck === 'resolved', canAct = c.editable && !resolved;
    var sec = f.sectionId === 'hidden' ? { label: 'Hidden text' } : sectionById(v, f.sectionId);
    var head = '<div class="finding-head">' + ui.severityBadge(f.severity) + ui.evidenceBadge(f.evidenceType) + (f.recheck ? ui.recheckBadge(f.recheck) : '') +
      (!resolved ? ui.dispositionBadge(f.disposition) : '') + (f.addedBy ? ui.tag('added by reviewer', { title: 'Missed by preflight; counts toward the miss rate' }) : '') +
      '<span class="spacer"></span><span class="mono xs muted">' + esc(f.id) + '</span></div>';
    var ruleLine = '<div class="wb-f-meta"><span class="finding-rule mono">' + esc(f.ruleId) + '</span><span>' + esc(rule ? rule.title : 'Unknown rule') + '</span>' +
      '<span class="mono xs">v' + esc(f.ruleVersion || (latestRv && latestRv.v) || 1) + (latestRv && f.ruleVersion && latestRv.v > f.ruleVersion ? ' (rule now v' + latestRv.v + ')' : '') + '</span>' +
      refs.map(function (r) { return '<button type="button" class="finding-cite wb-cite" data-action="wb-ref" data-ref="' + esc(r.id) + '" data-rule="' + esc(f.ruleId) + '" title="' + esc(r.label) + '">' + icon('book') + esc(r.citation) + '</button>'; }).join('') + '</div>';
    var quote = '';
    if (f.quote) {
      var qtext = f.sectionId === 'hidden' ? 'Hidden text: “' + truncate(f.quote, 160) + '”' : '“' + f.quote + '”';
      var where = sec ? ' · in ' + plabel(sec) : '';
      quote = '<div class="stack-sm"><button type="button" class="quote wb-quote" data-action="wb-focus" data-finding="' + esc(f.id) + '" title="Show in the creative">' + esc(qtext) + '</button>' +
        (resolved ? '<span class="wb-ev wb-ev-ok">' + icon('circle-check') + 'No longer in V' + esc(v.n) + '</span>' :
          isVerified(v, f) ? '<span class="wb-ev wb-ev-ok">' + icon('circle-check') + 'Evidence verified' + esc(where) + '</span>' :
            '<span class="wb-ev wb-ev-warn">' + icon('alert') + 'Evidence not found – verify' + esc(where) + '</span>') + '</div>';
    }
    var expl = f.explanation ? '<p class="wb-f-expl">' + esc(f.explanation) + '</p>' : '';
    var sugg = '';
    if (!resolved && (f.suggestedFix || f.suggestedCopy)) {
      var applyable = canAct && canApply(v, f);
      sugg = '<div class="wb-sugg"><div class="row row-tight">' + ui.tag('AI suggestion', { cls: 'tag-ai', icon: 'sparkles' }) + '</div>' +
        (f.suggestedFix ? '<div>' + esc(f.suggestedFix) + '</div>' : '') +
        (f.suggestedCopy ? '<div class="wb-sugg-copy">“' + esc(f.suggestedCopy) + '”</div>' : '') +
        (applyable ? '<div class="row row-wrap row-tight">' + ui.button('Apply suggestion', { action: 'wb-apply', data: { finding: f.id }, size: 'sm', icon: 'sparkles' }) +
          '<span class="xs muted">Creates V' + nextN(c.a) + ' and re-runs checks' + (isVisualFmt(v) || v.content.format === 'pdf' ? '. Text suggestion only' : '') + '</span></div>' : '') + '</div>';
    }
    var note = '';
    if (f.dispositionNote || f.exceptionReason) {
      note = '<div class="small wb-note">' + (f.exceptionReason ? '<span class="medium">' + esc(f.exceptionReason) + ':</span> ' : '<span class="medium">Note:</span> ') + esc(f.dispositionNote || '') + '</div>';
    } else if (f.disposition === 'accepted-exception' && canAct) {
      note = '<div class="xs muted">You write the justification when you approve.</div>';
    }
    var actions = canAct ? '<div class="finding-actions wb-f-actions" role="group" aria-label="Disposition for ' + esc(f.id) + '">' +
      dispoBtn(f, 'fix-required', 'Fix required', '1') + dispoBtn(f, 'dismissed', 'Not an issue', '2') + dispoBtn(f, 'accepted-exception', 'Accept as exception', '3') + '</div>' : '';
    return '<article class="finding wb-finding' + (st.active === f.id ? ' is-active' : '') + (resolved ? ' is-resolved' : '') + (f.disposition === 'dismissed' && !resolved ? ' wb-dim' : '') +
      '" id="wb-f-' + esc(f.id) + '" data-action="wb-select" data-finding="' + esc(f.id) + '" aria-label="' + esc(sevLabel(f.severity) + ' finding ' + f.id) + '">' +
      head + '<div class="wb-f-title">' + esc(f.title || (rule ? rule.title : f.ruleId)) + '</div>' + ruleLine + quote + expl + sugg + note + actions + '</article>';
  }
  function findingsPanel(c) {
    var a = c.a, v = c.v, out = [];
    if (c.running) return preflightCard(c);
    var approval = approvalFor(a, v);
    if (approval) out.push(approvalCallout(c, approval));
    if (a.status === 'changes-requested' && c.isLatest && !c.asOf && typeof A.renderWaitingCallout === 'function') {
      try { out.push(A.renderWaitingCallout(a) || ''); } catch (e) { if (window.console) console.error('[workbench] renderWaitingCallout failed', e); }
    }
    if (v.run && v.run.status === 'failed') {
      out.push(ui.callout(a.flags && a.flags.extractionFailed ? 'danger' : 'warning', 'Could not analyse this version',
        esc(v.run.failReason || v.run.note || 'Review the content manually.'), { actionsHtml: ui.button('Retry', { action: 'wb-retry', size: 'sm', icon: 'refresh' }) }));
    }
    (v.securityAlerts || []).forEach(function (al, i) { out.push(alertCard(c, al, i)); });
    var fs = v.findings || [];
    var live = fs.filter(function (f) { return f.recheck !== 'resolved'; });
    var resolved = fs.filter(function (f) { return f.recheck === 'resolved'; });
    var open = A.openFindings(v);
    var disp = live.filter(function (f) { return !!f.disposition; }).length;
    out.push('<div class="wb-summary">' + ui.aiChip() + '<span class="muted">' + esc(A.plural(open.length, 'open finding')) +
      (open.length ? ' · ' + esc(sevCounts(open)) : '') + (resolved.length ? ' · ' + resolved.length + ' resolved' : '') + '</span><span class="spacer"></span>' +
      (live.length ? '<span class="small muted num">' + disp + ' of ' + live.length + ' dispositioned</span>' : '') + '</div>');
    if (!fs.length && v.run && v.run.status === 'complete') {
      out.push(ui.empty('No issues flagged', 'Preflight found nothing against ' + A.plural((v.checklist || []).length, 'rule') + '. The Coverage tab lists what was not checked; that still needs your judgment.'));
    }
    SEVS.forEach(function (sev) {
      var g = live.filter(function (f) { return f.severity === sev; });
      if (!g.length) return;
      var meta = A.labels.SEVERITY[sev];
      out.push('<section class="wb-group" aria-label="' + esc(meta.label) + ' findings"><div class="wb-group-head">' + icon(meta.icon) + esc(meta.label) + ' (' + g.length + ')</div>' +
        g.map(function (f) { return findingCard(c, f); }).join('') + '</section>');
    });
    if (resolved.length) {
      out.push('<details class="wb-resolved"' + (resolved.some(function (f) { return f.id === st.active; }) ? ' open' : '') + '><summary>Resolved on recheck (' + resolved.length + ')</summary><div class="stack">' +
        resolved.map(function (f) { return findingCard(c, f); }).join('') + '</div></details>');
    }
    if (c.editable && v.run && v.run.status === 'complete') {
      out.push('<div>' + ui.button('Add a finding the check missed', { action: 'wb-add-finding', icon: 'plus', size: 'sm', variant: 'ghost' }) + '</div>');
    }
    return '<div class="wb-panel">' + out.join('') + '</div>';
  }
  function checklistPanel(c) {
    var v = c.v, rows = (v.checklist || []).slice();
    if (!rows.length) return ui.empty('No checklist', 'This version has no rule results.');
    var rank = { flagged: 0, 'not-checked': 1, pass: 2, na: 3 };
    rows.sort(function (x, y) { return (rank[x.result] != null ? rank[x.result] : 9) - (rank[y.result] != null ? rank[y.result] : 9); });
    var tally = {};
    rows.forEach(function (r) { tally[r.result] = (tally[r.result] || 0) + 1; });
    var head = '<div class="row row-wrap">' + ['flagged', 'pass', 'na', 'not-checked'].map(function (k) { return '<span class="row row-tight">' + ui.resultBadge(k) + '<span class="small num">' + (tally[k] || 0) + '</span></span>'; }).join('') + '</div>' +
      '<p class="xs muted">' + esc(A.plural(rows.length, 'rule')) + ' apply to ' + esc((PRODUCT[c.a.product] || 'this product').toLowerCase()) + ' assets. Not checked is never counted as a pass.</p>';
    var tbl = ui.table([
      { key: 'rule', label: 'Rule', render: function (r) { var rule = A.ruleById(r.ruleId); return '<div class="wb-rule-cell"><span class="medium">' + esc(rule ? rule.title : r.ruleId) + '</span><span class="mono xs muted">' + esc(r.ruleId) + (rule ? ' · v' + A.ruleVersion(rule).v : '') + '</span></div>'; } },
      { key: 'result', label: 'Result', shrink: true, render: function (r) { return ui.resultBadge(r.result); } },
      { key: 'findings', label: 'Findings', shrink: true, align: 'right', render: function (r) {
        var fs = (v.findings || []).filter(function (f) { return f.ruleId === r.ruleId && f.recheck !== 'resolved'; });
        return fs.length ? fs.map(function (f) { return ui.button(f.id, { action: 'wb-focus', data: { finding: f.id }, size: 'sm', variant: 'ghost', cls: 'wb-mini' }); }).join('') : '<span class="muted">—</span>';
      } }
    ], rows, { dense: true, caption: 'Rule checklist for V' + v.n });
    return '<div class="wb-panel">' + head + tbl + '</div>';
  }
  function offerPanel(c) {
    var run = c.v.run || {}, snap = run.offerSnapshot || [];
    if (!snap.length) return ui.empty('No offer terms used', run.status === 'failed' ? 'The check did not run, so no offer terms were compared.' : 'This run did not compare any offer catalog terms.');
    var cards = snap.map(function (raw) {
      var r = parseOfferRef(raw);
      if (!r || !r.offer || !r.ver) return ui.callout('neutral', raw, 'This offer version is not in the catalog any more.');
      var cur = A.offerVersion(r.offer), ov = r.ver;
      var stale = cur && cur.v !== ov.v ? ui.callout('info', 'Catalog is now at v' + cur.v, esc('Effective ' + ui.date(cur.effectiveFrom) + '. This run compared the copy with v' + ov.v + '.')) : '';
      var terms = Object.keys(ov.terms || {}).map(function (k) { return [humanKey(k), esc(fmtTerm(k, ov.terms[k]))]; });
      return '<div class="card"><div class="card-header with-border"><div><div class="card-title">' + icon('book') + esc(r.offer.id + ' v' + ov.v + ' · ' + r.offer.name) + '</div>' +
        '<div class="card-desc">' + esc('Effective ' + ui.date(ov.effectiveFrom) + (ov.effectiveTo ? ' to ' + ui.date(ov.effectiveTo) : ', no end date') + (ov.changeReason ? ' · ' + ov.changeReason : '')) + '</div></div></div>' +
        '<div class="card-body stack">' + stale + ui.dl(terms) + '</div></div>';
    }).join('');
    return '<div class="wb-panel"><p class="small muted">The offer terms this preflight compared the copy with, at the version in force for the run.</p>' + cards +
      '<div>' + ui.button('Open offer catalog', { href: '#policies-offers', size: 'sm', icon: 'book' }) + '</div></div>';
  }
  function covTone(value) {
    var s = String(value || '');
    if (/fail/i.test(s)) return 'err';
    if (/not covered|not provided|not followed|not checked|running|short link/i.test(s)) return 'warn';
    if (/^no (images|links)/i.test(s)) return 'off';
    return 'ok';
  }
  function coveragePanel(c) {
    var a = c.a, v = c.v, run = v.run || {}, cov = run.coverage || {};
    var items = [['Copy', cov.copy], ['Images', cov.image], ['Disclosures', cov.disclosures], ['State law', cov.stateLaw], ['Links', cov.links], ['SMS consent', cov.consent]].filter(function (p) { return p[1]; });
    var chips = '<div class="chip-list">' + items.map(function (p) {
      var text = String(p[1]).toLowerCase().indexOf(p[0].toLowerCase()) === 0 ? p[1] : p[0] + ': ' + p[1];
      return ui.chip(text, { size: 'sm', dot: covTone(p[1]), title: text });
    }).join('') + '</div>';
    var states = ui.callout('neutral', 'State law: not covered', esc(a.states && a.states.length ? 'This asset targets ' + a.states.join(', ') + '. ' : 'No target states are set. ') +
      'State-specific advertising rules are not checked in this build. Review them yourself where they apply.');
    var src = run.reusedFrom ? ui.button(run.reusedFrom, { action: 'wb-reuse', variant: 'link', size: 'sm' }) : null;
    var dl = ui.dl([
      ['Run', '<span class="mono">' + esc(run.id || '—') + '</span>' + (run.seeded ? ' ' + ui.tag('seeded run') : '') + (run.simulated ? ' ' + ui.tag('simulated') : '')],
      ['Status', esc(run.status === 'complete' ? 'Finished' : run.status === 'running' ? 'Running' : run.status === 'failed' ? 'Did not run' : (run.status || '—'))],
      ['Model', '<span class="mono">' + esc(run.model || '—') + '</span>'],
      ['Tokens', esc(fmtInt(run.tokensIn) + ' in · ' + fmtInt(run.tokensOut) + ' out')],
      ['Cost', esc(ui.money(run.costUsd || 0)) + ' ' + ui.sample()],
      src ? ['Reused from', src] : null,
      ['Offer terms', esc((run.offerSnapshot || []).join(', ') || 'None')],
      ['Rules', esc(A.plural((v.checklist || []).length, 'rule'))],
      run.note ? ['Note', esc(run.note)] : null,
      run.failReason ? ['Declined', esc(run.failReason)] : null
    ]);
    var b = (c.profile && c.profile.budget) || {};
    var budget = '<div class="section"><div class="section-header"><span class="section-title">' + icon('dollar') + 'AI spend today</span>' + ui.sample() + '</div>' +
      '<div class="meter-row"><span class="num">' + esc(ui.money(b.profileSpentTodayUsd || 0)) + ' of ' + esc(ui.money(b.profileCapUsd || 0)) + '</span>' + ui.meter(b.profileSpentTodayUsd || 0, b.profileCapUsd || 1, { label: 'Profile AI spend today' }) + '</div>' +
      '<div class="xs muted">Profile cap ' + esc(ui.money(b.profileCapUsd || 0)) + ' inside a ' + esc(ui.money(b.globalCapUsd || 0)) + ' daily cap for all profiles (' + esc(ui.money(b.globalSpentTodayUsd || 0)) + ' used). A run that would pass either cap is declined and the asset goes to manual review.</div></div>';
    return '<div class="wb-panel"><div class="section"><div class="section-title">What this run covered</div>' + chips + '</div>' + states +
      '<div class="section"><div class="section-title">Run</div>' + dl + '</div>' + budget + '</div>';
  }
  function chatSuggestions(c) {
    var v = c.v, open = A.openFindings(v), list = ['Summarize the findings'];
    var top = open[0] || (v.findings || [])[0];
    if (top) list.push('Explain ' + top.ruleId);
    list.push('Can you approve this?');
    var alerts = v.securityAlerts || [];
    if (alerts.some(function (al) { return al.kind === 'hidden-text'; })) list.push('The footer says Legal already cleared it. Does that change anything?');
    else if (alerts.length) list.push('What is the text addressed to AI assistants?');
    if (open.some(function (f) { return f.suggestedCopy; })) list.push('What would fix the open findings?');
    return list;
  }
  function chatPanel(c) {
    var a = c.a, me = c.me, msgs = a.chat || [];
    var log = msgs.length ? msgs.map(function (m) {
      var ai = m.role === 'assistant';
      return '<div class="wb-chat-item' + (ai ? '' : ' wb-user') + '"><div class="chat-meta">' + (ai ? icon('sparkles') + 'AI · advisory' : esc(me.name)) + '</div>' +
        '<div class="chat-msg chat-' + (ai ? 'assistant' : 'user') + '">' + esc(m.text) + '</div></div>';
    }).join('') : '<p class="small muted">No questions yet. Try one of the suggestions below.</p>';
    if (st.chatPending) log += '<div class="wb-chat-item"><div class="chat-meta">' + icon('sparkles') + 'AI · advisory</div><div class="chat-msg chat-assistant wb-typing">Reading ' + esc(a.id) + ' V' + esc(c.v.n) + '…</div></div>';
    var sugg = '<div class="chip-list" aria-label="Suggested questions">' + chatSuggestions(c).map(function (q) { return ui.chip(q, { size: 'sm', action: 'wb-chat-ask', data: { q: q } }); }).join('') + '</div>';
    return '<div class="wb-panel">' +
      '<div class="row row-wrap">' + ui.aiChip('AI · advisory · cannot approve or change anything') + '</div>' +
      '<p class="xs muted">Scoped to ' + esc(a.id) + ' V' + esc(c.v.n) + ': its content, its preflight run, the rules and offer terms that run used, and its findings. No tools, no other assets or profiles. Plain-text answers.</p>' +
      '<div class="chat" id="wb-chat-log" aria-live="polite">' + log + '</div>' +
      '<div class="wb-chat-compose">' + sugg +
      '<div class="chat-input"><label class="sr-only" for="wb-chat-input">Ask about this asset</label><textarea class="textarea" id="wb-chat-input" rows="2" data-input="wb-chat-draft" placeholder="Ask about this asset. Enter sends, Shift+Enter adds a line.">' + esc(st.chatDraft) + '</textarea>' +
      ui.button('Send', { action: 'wb-chat-send', variant: 'default', icon: 'arrow-right', disabled: st.chatPending }) + '</div>' +
      '<div class="xs muted">Each question is metered against the AI budget (about $0.002, sample) and logged in History.</div></div></div>';
  }
  function historyPanel(c) {
    var a = c.a, cutoff = c.asOf ? A.toMs(c.asOf.at) + 1000 : null;
    var decs = (a.decisions || []).filter(function (d) { return cutoff == null || A.toMs(d.at) <= cutoff; }).slice().reverse();
    var crs = (a.changeRequests || []).filter(function (cr) { return cutoff == null || A.toMs(cr.at) <= cutoff; }).slice().reverse();
    var events = (a.events || []).filter(function (e) { return cutoff == null || A.toMs(e.at) <= cutoff; }).slice().reverse();
    var decHtml = decs.length ? decs.map(function (d) {
      var dv = A.version(a, d.versionId), u = A.userById(d.approverId), isApproval = d.decision === 'approved' || d.decision === 'approved-with-exceptions';
      return '<div class="card card-muted"><div class="card-body stack-sm">' +
        '<div class="row row-wrap row-tight">' + ui.statusBadge(d.decision, dv ? 'V' + dv.n : null) + (d.selfApproved ? ui.tag('self-approved') : '') + '<span class="spacer"></span><span class="xs muted">' + esc(ui.time(d.at)) + '</span></div>' +
        '<div class="small">' + esc(u ? u.name : 'Unknown') + ' · ' + ui.sha(d.sha) + (d.attested ? ' · attestation recorded' : '') + ' · <span class="mono xs">' + esc(d.id) + '</span></div>' +
        ((d.exceptions || []).length ? '<ul class="small" style="margin:0;padding-left:18px">' + d.exceptions.map(function (e) { return '<li><span class="mono">' + esc(e.findingId) + '</span> · <span class="medium">' + esc(e.reason) + '</span>: ' + esc(e.text) + '</li>'; }).join('') + '</ul>' : '') +
        (d.note ? '<div class="small">Note: ' + esc(d.note) + '</div>' : '') +
        '<div class="row row-wrap row-tight">' + (c.asOf && c.asOf.id === d.id ? '' : ui.button('View as at decision time', { action: 'wb-asof', data: { decision: d.id }, size: 'sm', icon: 'history' })) +
        (isApproval ? ui.button('Approval record', { action: 'wb-record', data: { decision: d.id }, size: 'sm', icon: 'clipboard-check' }) : '') + '</div></div></div>';
    }).join('') : '<p class="small muted">No decisions yet.</p>';
    var crHtml = crs.length ? crs.map(function (cr) {
      var cv = A.version(a, cr.versionId), u = A.userById(cr.authorId);
      return '<div class="list-item"><div class="grow stack-sm"><div class="small"><span class="medium mono">' + esc(cr.id) + '</span> · V' + esc(cv ? cv.n : '?') + ' · ' + esc(A.plural((cr.items || []).length, 'item')) +
        (cr.dueDate ? ' · due ' + esc(ui.date(cr.dueDate)) : '') + ' · ' + esc(cr.status === 'open' ? 'Open' : 'Resolved') + '</div><div class="xs muted">' + esc((u ? u.name : 'Unknown') + ' · ' + ui.time(cr.at)) + '</div></div>' +
        ui.button('Copy as text', { action: 'wb-cr-copy', data: { cr: cr.id }, size: 'sm', icon: 'copy' }) +
        '<textarea class="sr-only" id="wb-crtext-' + esc(cr.id) + '" readonly tabindex="-1" aria-hidden="true">' + esc(A.changeRequestText(a.id, cr.id)) + '</textarea></div>';
    }).join('') : '';
    var vers = (a.versions || []).slice().reverse().map(function (v) {
      var run = v.run || {};
      return '<div class="list-item"><div class="grow stack-sm"><div class="small"><span class="medium">' + esc(ui.versionLabel(a, v)) + '</span> · ' + esc(originLabel(v.origin)) + ' · ' + esc(v.authorName || 'Unknown') + '</div>' +
        '<div class="xs muted">' + esc(ui.time(v.createdAt)) + ' · ' + ui.sha(v.sha) + (run.id ? ' · ' + esc(run.id) + ' ' + esc(ui.money(run.costUsd || 0)) : '') + '</div></div>' +
        (v.id === c.v.id ? '<span class="xs muted">Viewing</span>' : ui.button('View', { action: 'wb-version', data: { version: v.id }, size: 'sm' })) + '</div>';
    }).join('');
    var evHtml = events.length ? '<ol class="timeline">' + events.map(function (e) {
      var strong = ['decision', 'security', 'security-ack', 'change-request', 'version'].indexOf(e.kind) >= 0;
      return '<li class="tl-item"><span class="tl-dot' + (strong ? ' is-strong' : '') + '"></span><div class="tl-head"><span class="tl-actor">' + esc(e.actor) + '</span><span class="tl-kind">' + esc(e.kind) + '</span><span class="tl-time">' + esc(ui.time(e.at)) + '</span></div><div class="tl-text">' + esc(e.text) + '</div></li>';
    }).join('') + '</ol>' : '<p class="small muted">No events.</p>';
    return '<div class="wb-panel">' +
      '<div class="section"><div class="section-header"><span class="section-title">Decisions</span></div>' + decHtml + '</div>' +
      (crHtml ? '<div class="section"><div class="section-header"><span class="section-title">Change requests</span><span class="xs muted">Saved in the app. Nothing is sent.</span></div><div class="list">' + crHtml + '</div></div>' : '') +
      '<div class="section"><div class="section-header"><span class="section-title">Versions</span><span class="xs muted">Immutable</span></div><div class="list wb-ver-list">' + vers + '</div></div>' +
      '<div class="section"><div class="section-header"><span class="section-title">Audit trail</span><span class="xs muted">' + (c.asOf ? 'Up to ' + esc(ui.time(c.asOf.at)) : 'Newest first · append-only') + '</span></div>' + evHtml + '</div>' +
      '<div>' + ui.button('Export history (JSON)', { action: 'wb-export-history', size: 'sm', icon: 'file-text' }) + '</div></div>';
  }
  function rightPane(c) {
    var v = c.v, open = A.openFindings(v);
    var flagged = (v.checklist || []).filter(function (r) { return r.result === 'flagged'; }).length;
    var tabs = [
      { id: 'findings', label: 'Findings', count: c.running ? null : open.length },
      { id: 'checklist', label: 'Checklist', count: flagged || null },
      { id: 'offer', label: 'Offer facts' },
      { id: 'coverage', label: 'Coverage' },
      { id: 'chat', label: 'Ask AI', icon: 'sparkles' },
      { id: 'history', label: 'History', count: (c.a.decisions || []).length || null }
    ];
    if (!tabs.some(function (t) { return t.id === st.tab; })) st.tab = 'findings';
    var panel;
    switch (st.tab) {
      case 'checklist': panel = checklistPanel(c); break;
      case 'offer': panel = offerPanel(c); break;
      case 'coverage': panel = coveragePanel(c); break;
      case 'chat': panel = chatPanel(c); break;
      case 'history': panel = historyPanel(c); break;
      default: panel = findingsPanel(c);
    }
    return '<section class="pane wb-pane-right" aria-label="Review">' +
      '<div class="pane-header wb-tabs-head">' + ui.tabs('wb-tabs', tabs, st.tab, 'wb-tab', { label: 'Review panels' }) + '</div>' +
      '<div class="pane-body" id="wb-right-body" role="tabpanel" aria-labelledby="wb-tabs-tab-' + esc(st.tab) + '">' + panel + '</div></section>';
  }

  /* ------------------------------------------------------------------ */
  /* Decision bar                                                        */
  /* ------------------------------------------------------------------ */
  function decisionBar(c) {
    var a = c.a, v = c.v, me = c.me, actions, note;
    var live = (v.findings || []).filter(function (f) { return f.recheck !== 'resolved'; });
    var open = A.openFindings(v);
    var cm = open.filter(function (f) { return f.severity !== 'minor'; }).length;
    if (c.asOf) {
      note = 'History view as at ' + ui.time(c.asOf.at) + '.';
      actions = ui.button('Back to now', { action: 'wb-asof-clear', variant: 'default', icon: 'arrow-right' });
    } else if (!c.isLatest) {
      note = 'Earlier versions are read-only.';
      actions = ui.button('Go to V' + c.latest.n + ' (latest)', { action: 'wb-latest', variant: 'default', icon: 'arrow-right' });
    } else if (c.lockedApproved) {
      var d = approvalFor(a, v), u = d ? A.userById(d.approverId) : null;
      note = d ? (A.labels.DECISION[d.decision] + ' ' + ui.date(d.at) + ' by ' + (u ? u.name : 'Unknown') + ((d.exceptions || []).length ? ' · ' + A.plural(d.exceptions.length, 'exception') : '')) : 'Approved.';
      actions = ui.button('Approval record', { action: 'wb-record', icon: 'clipboard-check' }) + ui.button('Add revision', { action: 'wb-revision', icon: 'upload' });
    } else {
      var block = decideBlock(c);
      note = block || (live.length ? live.filter(function (f) { return !!f.disposition; }).length + ' of ' + live.length + ' findings dispositioned' + (cm ? ' · ' + A.plural(cm, 'open Critical or Major finding') : '') :
        (v.run && v.run.status === 'complete' ? 'No findings. Approve when you are satisfied.' : 'Nothing was checked automatically. Review the original yourself.'));
      var needsExc = cm > 0;
      actions = ui.button('Reject', { action: 'wb-decide', data: { mode: 'reject' }, disabled: !!block, icon: 'circle-x', cls: 'wb-danger', title: block || 'Reject V' + v.n }) +
        ui.button('Request changes', { action: 'wb-request', disabled: !!block, icon: 'undo', title: block || 'Build an in-app checklist from Fix required findings' }) +
        ui.button(needsExc ? 'Approve with exceptions' : 'Approve', { action: 'wb-decide', data: { mode: 'approve' }, variant: 'default', disabled: !!block, icon: needsExc ? 'alert' : 'check', kbd: block ? null : 'D', title: block || (needsExc ? 'Open Critical or Major findings need a written justification each' : 'Approve V' + v.n) });
    }
    return '<div class="sticky-footer wb-bar" role="region" aria-label="Decision">' +
      '<div class="wb-bar-who">' + ui.avatar(me, { size: 'sm' }) + '<div class="wb-bar-text"><div class="small truncate"><span class="medium">' + esc(me.name) + '</span> · ' +
      (c.isLatest && !c.asOf && !c.lockedApproved ? 'deciding on' : 'viewing') + ' V' + esc(v.n) + ' · ' + ui.sha(v.sha) + '</div><div class="xs muted truncate" id="wb-bar-note">' + esc(note) + '</div></div></div>' +
      '<div class="wb-bar-actions">' + actions + '</div></div>';
  }

  /* ------------------------------------------------------------------ */
  /* Route                                                               */
  /* ------------------------------------------------------------------ */
  A.route('asset', function (param) {
    var p = parseParam(param);
    if (!p || !A.asset(p.id)) return null; // also covers assets that belong to another profile
    if (st.assetId !== p.id) {
      st.assetId = p.id; st.active = null; st.reveal = false; st.asOf = null; st.chatDraft = ''; st.chatPending = false; st.tab = 'findings';
    }
    var c = ctx(param);
    if (!c) return null;
    return '<div class="wb" id="wb-root" data-asset="' + esc(c.a.id) + '">' + header(c) + banners(c) +
      '<div class="split wb-split">' + leftPane(c) + rightPane(c) + '</div>' + decisionBar(c) + '</div>';
  }, {
    nav: 'queue', layout: 'fill',
    title: function (param) { var p = parseParam(param), a = p ? A.asset(p.id) : null; return a ? a.id + ' · Review' : 'Asset'; }
  });

  A.on('rendered', function (r) {
    if (!r || r.name !== 'asset') return;
    var c = ctxCurrent();
    if (!c) return;
    if (c.a.status === 'preflighting') ensurePreflight(c.a.id);
    var root = byId('wb-root');
    if (root) {
      root.addEventListener('keydown', function (e) {
        var t = e.target;
        if ((e.key === 'Enter' || e.key === ' ') && t && t.matches && t.matches('mark[data-action]')) { e.preventDefault(); t.click(); }
      });
    }
    var ta = byId('wb-chat-input');
    if (ta) {
      ta.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(ta.value); }
      });
    }
  });

  /* ------------------------------------------------------------------ */
  /* Navigation inside the workbench                                     */
  /* ------------------------------------------------------------------ */
  function findIn(c, fid) { return c ? (c.v.findings || []).find(function (f) { return f.id === fid; }) || null : null; }
  function selectFinding(fid, o) {
    o = o || {};
    var c = ctxCurrent(), f = findIn(c, fid);
    if (!f) return;
    st.active = fid;
    if (o.tab) st.tab = 'findings';
    if (f.sectionId === 'hidden' && hiddenOf(c.v).length) st.reveal = true;
    A.rerender();
    if (o.toCard) { var card = byId('wb-f-' + fid); if (card) scrollInPane(card); }
    if (o.toSpan && !(o.toCard && stacked())) {
      var span = byId('wb-span-' + fid) || byId('wb-sec-' + f.sectionId);
      if (span) { scrollInPane(span); flash(span); }
    }
  }
  function moveActive(dir) {
    var c = ctxCurrent();
    if (!c || c.running) return;
    var list = orderedFindings(c.v);
    if (!list.length) { A.toast('No open findings on this version.', 'info'); return; }
    var i = -1;
    list.forEach(function (f, k) { if (f.id === st.active) i = k; });
    var next = list[i < 0 ? (dir > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, i + dir))];
    selectFinding(next.id, { tab: true, toCard: true, toSpan: true });
  }
  function setDispo(fid, value) {
    var c = ctxCurrent(), f = findIn(c, fid);
    if (!f) return;
    if (!c.editable) { A.toast(readOnlyReason(c), 'info'); return; }
    if (f.recheck === 'resolved') { A.toast(fid + ' is resolved on recheck and needs no disposition.', 'info'); return; }
    st.active = fid;
    if (f.disposition === value) {
      A.setDisposition(c.a.id, c.v.id, fid, null);
      A.toast(fid + ': disposition cleared');
    } else if (value === 'dismissed') {
      openDismiss(c, f);
      return;
    } else {
      A.setDisposition(c.a.id, c.v.id, fid, value);
      A.toast(fid + ' marked ' + dispLabel(value) + (value === 'accepted-exception' && f.severity !== 'minor' ? '. The approve button now reads Approve with exceptions.' : ''), 'success');
    }
    A.emit('data-changed', { kind: 'disposition', assetId: c.a.id });
    A.rerender();
  }

  A.action('wb-tab', function (el) {
    st.tab = el.getAttribute('data-tab') || 'findings';
    A.rerender();
    var b = byId('wb-right-body');
    if (b && !stacked()) b.scrollTop = 0;
    if (st.tab === 'chat') scrollChat();
  });
  A.action('wb-select', function (el, ev) {
    if (ev && ev.target && ev.target.closest && ev.target.closest('a, button, input, textarea, select, summary')) return;
    try { var sel = window.getSelection(); if (sel && String(sel).length > 2) return; } catch (e) { /* ignore */ }
    selectFinding(el.getAttribute('data-finding'), { toSpan: true });
  });
  A.action('wb-focus', function (el) { selectFinding(el.getAttribute('data-finding'), { tab: true, toSpan: true }); });
  A.action('wb-span', function (el) { selectFinding(el.getAttribute('data-finding'), { tab: true, toCard: true }); });
  A.action('wb-span-alert', function (el) {
    var i = el.getAttribute('data-index') || '0';
    if (el.tagName === 'MARK') {
      st.tab = 'findings'; A.rerender();
      var card = byId('wb-alert-' + i); if (card) { scrollInPane(card); flash(card); }
    } else {
      var m = byId('wb-inj-' + i); if (m) { scrollInPane(m); flash(m); }
      else A.toast('The text is in the content but could not be located exactly. Check the footer.', 'info');
    }
  });
  A.action('wb-toggle-hidden', function () { st.reveal = !st.reveal; A.rerender(); });
  A.action('wb-jump-hidden', function () {
    st.reveal = true;
    A.rerender();
    var el = byId('wb-hidden-0') || byId('wb-hidden-note');
    if (el) { scrollInPane(el); flash(el); }
  });
  A.action('wb-ack', function (el) {
    var c = ctxCurrent();
    if (!c) return;
    if (!c.isLatest || c.asOf) { A.toast(readOnlyReason(c), 'info'); return; }
    var i = parseInt(el.getAttribute('data-index') || '0', 10);
    var al = A.ackSecurity(c.a.id, c.v.id, i);
    if (!al) return;
    A.emit('data-changed', { kind: 'security-ack', assetId: c.a.id });
    A.toast(al.kind === 'hidden-text' ? 'Security alert acknowledged. You can decide on V' + c.v.n + ' now; the finding stays open.' : 'Warning marked as seen.', 'success');
    A.rerender();
  });
  A.action('wb-dispo', function (el) { setDispo(el.getAttribute('data-finding'), el.getAttribute('data-value')); });
  A.action('wb-version', function (el) {
    var c = ctxCurrent(); if (!c) return;
    st.ver[c.a.id] = el.getAttribute('data-version');
    st.active = null; st.asOf = null;
    A.rerender();
  });
  A.action('wb-latest', function () {
    var c = ctxCurrent(); if (!c) return;
    st.ver[c.a.id] = c.a.latestVersionId; st.asOf = null; st.active = null;
    A.rerender();
  });
  A.action('wb-asof', function (el) {
    var c = ctxCurrent(); if (!c) return;
    var d = decisionById(c.a, el.getAttribute('data-decision')); if (!d) return;
    st.asOf = d.id; st.ver[c.a.id] = d.versionId; st.tab = 'history'; st.active = null;
    A.rerender();
    var b = byId('wb-right-body'); if (b && !stacked()) b.scrollTop = 0;
  });
  A.action('wb-asof-clear', function () {
    var c = ctxCurrent(); if (!c) return;
    st.asOf = null; st.ver[c.a.id] = c.a.latestVersionId;
    A.rerender();
  });
  A.action('wb-retry', function () {
    A.toast('Extraction failed again: the file is still password-protected. Ask the submitter for an unlocked file, then use Add revision.', 'warning');
  });

  /* ------------------------------------------------------------------ */
  /* Drawers: reference, reuse, sources, approval record; more menu      */
  /* ------------------------------------------------------------------ */
  A.action('wb-ref', function (el) {
    var r = A.referenceById(el.getAttribute('data-ref')); if (!r) return;
    var rule = el.getAttribute('data-rule') ? A.ruleById(el.getAttribute('data-rule')) : null, rv = rule ? A.ruleVersion(rule) : null;
    A.drawer({
      title: r.citation, width: 'md', id: 'wb-ref-drawer',
      body: '<div class="stack"><div class="medium">' + esc(r.label) + '</div><p class="small">' + esc(r.summary) + '</p>' +
        ui.dl([['Citation', esc(r.citation)], ['Verified as of', esc(ui.date(r.verifiedAsOf))], ['Source', '<span class="mono xs wrap-anywhere">' + esc(r.url) + '</span>']]) +
        '<p class="xs muted">Regulatory references are read-only. Source links are shown as text in this prototype.</p>' +
        (rule && rv ? '<div class="card card-muted"><div class="card-body stack-sm"><div class="small medium">' + esc(rule.id + ' v' + rv.v + ' · ' + rule.title) + '</div><div class="small">' + esc(rv.text) + '</div></div></div>' : '') +
        '<div>' + ui.button('Open regulatory references', { href: '#policies-references', size: 'sm', icon: 'book' }) + '</div></div>'
    });
  });
  function assetByRun(runId) {
    var hit = null;
    A.assetsFor().forEach(function (a) { (a.versions || []).forEach(function (v) { if (!hit && v.run && v.run.id === runId) hit = { a: a, v: v }; }); });
    return hit;
  }
  A.action('wb-reuse', function () {
    var c = ctxCurrent(); if (!c) return;
    var run = c.v.run || {}, rf = (c.a.flags && c.a.flags.reusedFrom) || {};
    var runId = run.reusedFrom || rf.runId;
    var src = assetByRun(runId);
    A.drawer({
      title: 'Reused analysis · ' + runId, width: 'md', id: 'wb-reuse-drawer',
      body: '<div class="stack"><p class="small">Results for sections that match an earlier check were copied from run <span class="mono">' + esc(runId) + '</span>' +
        (src ? ' on ' + esc(src.a.id) + ' V' + esc(src.v.n) : '') + ' at $0. Reuse needs the same rule set and offer versions; a change to either forces a fresh check.</p>' +
        (run.note ? ui.callout('info', 'What was reused', esc(run.note)) : '') +
        ui.dl([
          ['This run', '<span class="mono">' + esc(run.id || '—') + '</span> · ' + esc(ui.money(run.costUsd || 0))],
          ['Source run', '<span class="mono">' + esc(runId) + '</span>' + (src && src.v.run ? ' · ' + esc(ui.money(src.v.run.costUsd || 0)) + ' · ' + esc(ui.time(src.v.run.at || src.v.createdAt)) : '')],
          ['Offer terms', esc((run.offerSnapshot || []).join(', ') || '—')]
        ]) +
        (src ? '<div>' + ui.button('Open ' + src.a.id, { href: '#asset-' + src.a.id, size: 'sm', icon: 'arrow-right' }) + '</div>' : '') + '</div>'
    });
  });
  A.action('wb-sources', function () {
    var c = ctxCurrent(); if (!c) return;
    var a = c.a;
    A.drawer({
      title: 'Sources and provenance · ' + a.id, width: 'md', id: 'wb-src-drawer',
      body: '<div class="stack"><div class="section-title">Where this asset was seen</div><div class="list">' + (a.sourceRefs || []).map(function (r) {
        var s = A.sourceById(r.sourceId);
        return '<div class="list-item">' + (s ? ui.sourceIcon(s.provider) : icon('link')) + '<div class="grow stack-sm"><div class="small wrap-anywhere">' + esc(r.label) + '</div><div class="xs muted">' + esc(ui.time(r.seenAt)) + '</div></div></div>';
      }).join('') + '</div><div class="section-title">Versions</div><div class="list">' + (a.versions || []).map(function (v) {
        return '<div class="list-item"><div class="grow small">' + esc('V' + v.n + ' · ' + originLabel(v.origin) + ' · ' + (v.authorName || 'Unknown') + ' · ' + ui.time(v.createdAt)) + '</div>' + ui.sha(v.sha) + '</div>';
      }).join('') + '</div><p class="xs muted">Read-only connections. Nothing is written back to the mailbox or drive.</p></div>'
    });
  });
  function recordData(a, d) {
    var v = A.version(a, d.versionId) || A.latestVersion(a), u = A.userById(d.approverId), run = (v && v.run) || {};
    return {
      asset: a.id, title: a.title, version: 'V' + (v ? v.n : '?'), versionId: d.versionId, sha: d.sha || (v && v.sha),
      decisionId: d.id, decision: d.decision, at: d.at, approver: u ? { name: u.name, email: u.email } : d.approverId,
      selfApproved: !!d.selfApproved, attested: !!d.attested, note: d.note || null, exceptions: d.exceptions || [],
      findings: ((v && v.findings) || []).map(function (f) { return { id: f.id, ruleId: f.ruleId, ruleVersion: f.ruleVersion, severity: f.severity, disposition: f.disposition, recheck: f.recheck || null, note: f.dispositionNote || null }; }),
      rulesInForce: ((v && v.checklist) || []).map(function (r) { var rule = A.ruleById(r.ruleId), rv = rule ? ruleVersionAt(rule, d.at) : null; return { ruleId: r.ruleId, version: rv ? rv.v : null, result: r.result, text: rv ? rv.text : null }; }),
      offerSnapshot: run.offerSnapshot || [], run: { id: run.id, model: run.model, tokensIn: run.tokensIn, tokensOut: run.tokensOut, costUsd: run.costUsd }
    };
  }
  A.action('wb-record', function (el) {
    var c = ctxCurrent(); if (!c) return;
    var a = c.a, id = el.getAttribute('data-decision');
    var d = id ? decisionById(a, id) : (approvalFor(a, c.v) || approvalFor(a, A.version(a, a.approvedVersionId)));
    if (!d) { A.toast('No approval is recorded for this asset yet.', 'info'); return; }
    var rec = recordData(a, d);
    A.drawer({
      title: 'Approval record · ' + a.id + ' ' + rec.version, width: 'lg', id: 'wb-record-drawer',
      body: '<div class="stack">' + ui.dl([
        ['Decision', ui.statusBadge(d.decision, rec.version)],
        ['Version', esc(rec.version) + ' · ' + ui.sha(rec.sha)],
        ['Approver', esc(rec.approver && rec.approver.name ? rec.approver.name + ' · ' + rec.approver.email : String(rec.approver))],
        ['When', esc(ui.time(d.at))],
        ['Attestation', esc(rec.attested ? 'Checked' : 'Not recorded') + (rec.selfApproved ? ' · ' + ui.tag('self-approved') : '')],
        ['Run', '<span class="mono">' + esc(rec.run.id || '—') + '</span> · ' + esc(rec.run.model || '')],
        ['Offer terms', esc(rec.offerSnapshot.join(', ') || 'None')]
      ]) +
        (rec.exceptions.length ? '<div class="section-title">Exceptions</div><ul class="small" style="margin:0;padding-left:18px">' + rec.exceptions.map(function (e) { return '<li><span class="mono">' + esc(e.findingId) + '</span> · <span class="medium">' + esc(e.reason) + '</span>: ' + esc(e.text) + '</li>'; }).join('') + '</ul>' : '') +
        '<div class="section-title">Rules in force at approval</div>' +
        ui.table([
          { key: 'ruleId', label: 'Rule', render: function (r) { return '<span class="mono small">' + esc(r.ruleId) + '</span>'; } },
          { key: 'version', label: 'Version', shrink: true, render: function (r) { return r.version ? 'v' + esc(r.version) : '—'; } },
          { key: 'result', label: 'Result', shrink: true, render: function (r) { return ui.resultBadge(r.result); } }
        ], rec.rulesInForce, { dense: true, caption: 'Rules in force' }) +
        '<p class="xs muted">Approval records are append-only. A later version never changes this record.</p></div>',
      footer: ui.button('Export JSON', { action: 'wb-record-export', data: { decision: d.id }, variant: 'default', icon: 'file-text' })
    });
  });
  A.action('wb-record-export', function (el) {
    var c = ctxCurrent(); if (!c) return;
    var d = decisionById(c.a, el.getAttribute('data-decision')); if (!d) return;
    var rec = recordData(c.a, d);
    A.showExport({ title: 'Approval record · ' + c.a.id + ' ' + rec.version, text: rec, format: 'json', filename: c.a.id.toLowerCase() + '-' + rec.version.toLowerCase() + '-approval.json' });
  });
  A.action('wb-export-history', function () {
    var c = ctxCurrent(); if (!c) return;
    var a = c.a;
    A.showExport({
      title: 'History · ' + a.id, format: 'json', filename: a.id.toLowerCase() + '-history.json',
      text: {
        asset: { id: a.id, title: a.title, product: a.product, channel: a.channel, states: a.states, status: a.status, approvedVersionId: a.approvedVersionId || null },
        versions: (a.versions || []).map(function (v) { return { id: v.id, n: v.n, origin: v.origin, authorName: v.authorName, createdAt: v.createdAt, sha: v.sha, run: v.run ? { id: v.run.id, costUsd: v.run.costUsd, status: v.run.status } : null }; }),
        decisions: a.decisions || [], changeRequests: a.changeRequests || [], events: a.events || []
      }
    });
  });
  A.action('wb-cr-copy', function (el) {
    var c = ctxCurrent(); if (!c) return;
    var id = el.getAttribute('data-cr');
    A.copy(A.changeRequestText(c.a.id, id), '#wb-crtext-' + id);
    A.log(c.a.id, c.me.name, 'copied-text', 'Copied the ' + id + ' checklist as text.');
  });
  A.action('wb-copy-id', function () { var c = ctxCurrent(); if (c) A.copy(c.a.id); });
  A.action('wb-more', function (el) {
    var c = ctxCurrent(); if (!c) return;
    var items = [{ label: 'Sources and provenance', icon: 'link', action: 'wb-sources' }];
    if (a_hasApproval(c.a)) items.push({ label: 'Approval record', icon: 'clipboard-check', action: 'wb-record' });
    items.push({ label: 'Export history (JSON)', icon: 'file-text', action: 'wb-export-history' });
    items.push({ label: 'Copy asset ID', icon: 'copy', action: 'wb-copy-id', hint: c.a.id });
    items.push({ sep: true });
    items.push({ label: 'Keyboard: J/K findings, 1/2/3 disposition, D decide, E edit', icon: 'keyboard', action: 'app-shortcuts' });
    A.menu(el, items, { align: 'end', label: 'More actions', minWidth: 240 });
  });
  function a_hasApproval(a) { return (a.decisions || []).some(function (d) { return d.decision === 'approved' || d.decision === 'approved-with-exceptions'; }); }

  /* ------------------------------------------------------------------ */
  /* Versions: create, then recheck bookkeeping                          */
  /* ------------------------------------------------------------------ */
  function recomputeChecklist(a, v) {
    var p = partnerOf(a);
    v.checklist = (v.checklist || []).map(function (row) {
      var has = (v.findings || []).some(function (f) { return f.ruleId === row.ruleId && f.recheck !== 'resolved' && f.disposition !== 'dismissed'; });
      var r = row.result;
      if (has) r = 'flagged';
      else if (r === 'flagged' || r === 'not-checked') {
        if (row.ruleId === 'CP-EML-01' && a.channel !== 'email') r = 'na';
        else if (/^CP-AFF-/.test(row.ruleId) && !(p && p.type === 'affiliate')) r = 'na';
        else r = 'pass';
      }
      return { ruleId: row.ruleId, result: r };
    });
  }
  function afterNewVersion(a, nv, prevText, prevAll) {
    var vis = nv.content && nv.content.visual;
    if (vis) {
      sectionsOf(nv).forEach(function (s) {
        var old = prevText[s.id];
        if (old != null && old !== s.text) ['headline', 'subhead', 'cta', 'footnote'].forEach(function (k) { vis[k] = syncText(vis[k], old, s.text || ''); });
      });
    }
    // A finding whose suggested copy now appears (and did not before) is resolved, even when its anchor text stays.
    var extra = [], all = allText(nv);
    (nv.findings || []).forEach(function (f) {
      if (f.recheck !== 'still-present' || !f.suggestedCopy) return;
      var hay = textFor(nv, f.sectionId);
      if (contains(hay != null ? hay : all, f.suggestedCopy) && !contains(prevAll, f.suggestedCopy)) { f.recheck = 'resolved'; extra.push(f.id); }
    });
    if (a.flags && a.flags.extractionFailed && sectionsOf(nv).length) {
      a.flags.extractionFailed = false;
      if (nv.content) nv.content.visual = null;
      if (nv.run && nv.run.status === 'complete') {
        nv.run.coverage = { copy: 'Checked', image: 'OCR 1/1', disclosures: 'Checked', stateLaw: 'Not covered', links: 'No links' };
        nv.run.note = null;
        a.status = 'needs-review';
      }
      A.log(a.id, 'System', 'extraction', 'Text extracted from V' + nv.n + '. Checks ran on the extracted text.');
    }
    if (nv.run && nv.run.status === 'complete') recomputeChecklist(a, nv);
    if (extra.length) A.log(a.id, 'System', 'recheck', 'Recheck on V' + nv.n + ': ' + extra.join(', ') + ' resolved (the suggested copy now appears).');
    var res = (nv.findings || []).filter(function (f) { return f.recheck === 'resolved'; }).length;
    var still = (nv.findings || []).filter(function (f) { return f.recheck === 'still-present'; }).length;
    if (a.status === 'recheck-ready') a.subLabel = res + ' resolved, ' + still + ' still present';
    else if (a.status === 'needs-review') a.subLabel = (nv.findings || []).length ? 'Has findings' : 'No issues flagged';
  }
  function createVersion(c, origin, sections, extra) {
    extra = extra || {};
    var a = c.a, prev = A.latestVersion(a), prevText = {};
    sectionsOf(prev).forEach(function (s) { prevText[s.id] = s.text || ''; });
    var prevAll = allText(prev) + '\n' + hiddenOf(prev).map(function (h) { return h.text; }).join('\n');
    var opts = { origin: origin, sections: sections, authorName: extra.authorName || c.me.name };
    if (extra.hidden) opts.hidden = extra.hidden;
    var nv = A.newVersion(a.id, opts);
    if (!nv) return null;
    afterNewVersion(a, nv, prevText, prevAll);
    if (extra.appliedFinding) A.log(a.id, c.me.name, 'version', 'V' + nv.n + ' applies the AI suggestion for ' + extra.appliedFinding + '.');
    if (extra.note) A.log(a.id, c.me.name, 'note', 'V' + nv.n + ' note: ' + extra.note);
    st.ver[a.id] = nv.id; st.active = null; st.asOf = null;
    A.emit('data-changed', { kind: 'version', assetId: a.id, versionId: nv.id });
    return nv;
  }
  function recheckSummary(nv) {
    var fs = nv.findings || [];
    var res = fs.filter(function (f) { return f.recheck === 'resolved'; }).length, still = fs.filter(function (f) { return f.recheck === 'still-present'; }).length;
    return 'Recheck: ' + res + ' resolved, ' + still + ' still present.';
  }

  /* ------------------------------------------------------------------ */
  /* Apply suggestion                                                    */
  /* ------------------------------------------------------------------ */
  A.action('wb-apply', function (el) {
    var c = ctxCurrent(), f = findIn(c, el.getAttribute('data-finding'));
    if (!f) return;
    if (!c.editable) { A.toast(readOnlyReason(c), 'info'); return; }
    var s = sectionById(c.v, f.sectionId), next = s ? applySuggestionText(s.text, f) : null;
    if (next == null) { A.toast('The quoted text is not in this section any more, so the suggestion can\'t be applied.', 'warning'); return; }
    var n = nextN(c.a), d = diffParts(s.text, next), visual = isVisualFmt(c.v) || c.v.content.format === 'pdf';
    st.apply = { assetId: c.a.id, versionId: c.v.id, findingId: f.id, sectionId: s.id, text: next };
    A.dialog({
      id: 'wb-apply-dialog', title: 'Apply suggestion', size: 'md',
      description: c.a.id + ' · ' + plabel(s) + ' · ' + f.id,
      body: '<div class="stack"><div><div class="label">Before (V' + esc(c.v.n) + ')</div><div class="wb-diff">' + esc(d.pre) + '<del class="diff-del">' + esc(d.oldMid) + '</del>' + esc(d.post) + '</div></div>' +
        '<div><div class="label">After (V' + n + ')</div><div class="wb-diff">' + esc(d.pre) + '<ins class="diff-add">' + esc(d.newMid) + '</ins>' + esc(d.post) + '</div></div>' +
        '<div class="diff-legend"><span class="diff-del">removed</span><span class="diff-add">added</span></div>' +
        (visual ? ui.callout('neutral', 'Text suggestion only', 'This changes the extracted copy so the checks run on it. The submitter must still produce the final creative.') : '') +
        '<p class="xs muted">' + ui.tag('AI suggestion', { cls: 'tag-ai', icon: 'sparkles' }) + ' Applying it creates V' + n + ' (Suggestion applied) and re-runs the checks. V' + esc(c.v.n) + ' is not changed, and nothing is written back to the source.</p></div>',
      actions: [{ label: 'Cancel' }, { label: 'Apply as V' + n, action: 'wb-apply-confirm', variant: 'default', icon: 'sparkles' }],
      onClose: function () { st.apply = null; }
    });
  });
  A.action('wb-apply-confirm', function () {
    var p = st.apply, c = ctxCurrent();
    if (!p || !c || c.a.id !== p.assetId || !c.editable || c.latest.id !== p.versionId) { A.closeDialog(); A.toast('This version changed. Open the suggestion again.', 'warning'); return; }
    A.closeDialog();
    var nv = createVersion(c, 'suggestion_applied', [{ id: p.sectionId, text: p.text }], { appliedFinding: p.findingId });
    if (nv) { A.toast('Created V' + nv.n + ' with the suggestion applied. ' + recheckSummary(nv), 'success'); A.rerender(); }
  });

  /* ------------------------------------------------------------------ */
  /* Edit copy (per section)                                             */
  /* ------------------------------------------------------------------ */
  function openEdit(sectionId) {
    var c = ctxCurrent();
    if (!c) return;
    if (!c.editable) { A.toast(readOnlyReason(c), 'info'); return; }
    var s = sectionById(c.v, sectionId);
    if (!s) return;
    var n = nextN(c.a), fmt = c.v.content.format;
    var fs = (c.v.findings || []).filter(function (f) { return f.sectionId === s.id && f.recheck !== 'resolved' && f.suggestedCopy; });
    st.edit = { assetId: c.a.id, versionId: c.v.id, sectionId: s.id };
    A.dialog({
      id: 'wb-edit-dialog', title: 'Edit copy', description: c.a.id + ' · ' + plabel(s) + ' · V' + c.v.n, size: 'lg', dismissible: false,
      body: '<div class="stack">' +
        (fmt === 'image' || fmt === 'pdf' ? ui.callout('neutral', 'Text suggestion only', 'Images and layout can\'t be edited here. Your edit becomes V' + n + ' so the checks run on the corrected copy; the submitter still produces the final creative.') : '') +
        ui.field(plabel(s), '<textarea class="textarea" id="wb-edit-text" rows="6">' + esc(s.text) + '</textarea>', { id: 'wb-edit-text', hint: 'Saving creates V' + n + ' (Reviewer edit) and re-runs the checks. V' + c.v.n + ' stays unchanged, and nothing is written back to the source.' }) +
        (fs.length ? '<div class="stack-sm"><div class="label">Suggestions for this section</div>' + fs.map(function (f) {
          return '<div class="wb-sugg"><div class="row row-wrap row-tight">' + ui.severityBadge(f.severity) + '<span class="small medium">' + esc(f.title || f.ruleId) + '</span>' + ui.tag('AI suggestion', { cls: 'tag-ai', icon: 'sparkles' }) + '</div>' +
            '<div class="wb-sugg-copy">“' + esc(f.suggestedCopy) + '”</div><div>' + ui.button('Use this suggestion', { action: 'wb-edit-insert', data: { finding: f.id }, size: 'sm', icon: 'sparkles' }) + '</div></div>';
        }).join('') + '</div>' : '') +
        ui.field('Change note', '<input class="input" id="wb-edit-note" type="text" autocomplete="off" placeholder="What did you change and why?">', { id: 'wb-edit-note', optional: true }) + '</div>',
      actions: [{ label: 'Cancel' }, { label: 'Save as V' + n, action: 'wb-edit-save', variant: 'default', icon: 'check' }],
      onClose: function () { st.edit = null; }
    });
  }
  A.action('wb-edit-section', function (el) { openEdit(el.getAttribute('data-section')); });
  A.action('wb-edit-insert', function (el) {
    var c = ctxCurrent(), f = findIn(c, el.getAttribute('data-finding')), ta = byId('wb-edit-text');
    if (!f || !ta) return;
    var t = applySuggestionText(ta.value, f);
    if (t == null) { A.toast('The quoted text "' + truncate(f.quote, 60) + '" is not in the box any more.', 'warning'); return; }
    ta.value = t;
    try { ta.focus(); } catch (e) { /* ignore */ }
    A.toast('Suggestion inserted. Review it, then save.', 'info');
  });
  A.action('wb-edit-save', function () {
    var p = st.edit, c = ctxCurrent();
    if (!p || !c || c.a.id !== p.assetId || !c.editable || c.latest.id !== p.versionId) { A.closeDialog(); A.toast('This version changed. Open the editor again.', 'warning'); return; }
    var s = sectionById(c.v, p.sectionId), text = val('wb-edit-text'), note = val('wb-edit-note').trim();
    if (!text.trim()) { A.toast('Section text can\'t be empty.', 'error'); return; }
    if (s && text.trim() === String(s.text || '').trim()) { A.toast('No changes to save.', 'info'); return; }
    A.closeDialog();
    var nv = createVersion(c, 'reviewer_edit', [{ id: p.sectionId, text: text }], { note: note });
    if (nv) { A.toast('Saved V' + nv.n + ' (Reviewer edit). ' + recheckSummary(nv), 'success'); A.rerender(); }
  });

  /* ------------------------------------------------------------------ */
  /* Add revision (paste or upload)                                      */
  /* ------------------------------------------------------------------ */
  function simulatedRevision(c) {
    var secs = A.clone(sectionsOf(c.latest));
    (c.latest.findings || []).forEach(function (f) {
      if (!A.isOpenFinding(f) || !f.suggestedCopy || f.sectionId === 'hidden') return;
      var s = secs.find(function (x) { return x.id === f.sectionId; });
      if (!s) return;
      var t = applySuggestionText(s.text, f);
      if (t != null) s.text = t;
    });
    if (!secs.length) {
      secs = [{ id: 's1', label: 'Flyer text', text: 'Open house this Saturday, 10 AM to 2 PM. See if you prequalify with ClearPath Home in minutes. Prequalification is not a loan approval. ClearPath Financial NMLS #000000. Equal Housing Lender.' }];
    }
    return secs;
  }
  function revFields(c, secs) {
    if (!secs.length) return ui.field('Text in the revised file', '<textarea class="textarea" id="wb-rev-s-new" rows="5" placeholder="Paste the revised copy"></textarea>', { id: 'wb-rev-s-new' });
    return secs.map(function (s) {
      return ui.field(plabel(s), '<textarea class="textarea" id="wb-rev-s-' + esc(s.id) + '" rows="' + (String(s.text || '').length > 160 ? 4 : 2) + '">' + esc(s.text) + '</textarea>', { id: 'wb-rev-s-' + s.id });
    }).join('');
  }
  A.action('wb-revision', function () {
    var c = ctxCurrent();
    if (!c) return;
    if (c.running) { A.toast('Wait for preflight to finish.', 'info'); return; }
    var a = c.a, n = nextN(a), secs = sectionsOf(c.latest);
    var pending = A.state.intake.find(function (i) { return i.newVersionOf === a.id && i.status === 'pending' && i.profileId === a.profileId; });
    var subName = a.submitter ? a.submitter.name : 'Submitter';
    var authorOpts = [{ value: subName, label: subName + ' (submitter)' }];
    if (c.me.name !== subName) authorOpts.push({ value: c.me.name, label: c.me.name + ' (you)' });
    st.rev = { assetId: a.id, versionId: c.latest.id, file: null, ids: secs.map(function (s) { return s.id; }) };
    A.dialog({
      id: 'wb-rev-dialog', title: 'Add revision', description: a.id + ' · creates V' + n + ' (Upload)', size: 'lg', dismissible: false,
      body: '<div class="stack">' +
        (pending ? ui.callout('info', 'A revision is already waiting in Triage', esc(pending.id + ': ' + pending.title + '. Confirming it there keeps the link to the email thread.'), { actionsHtml: ui.button('Open Triage', { href: '#intake-triage', size: 'sm', icon: 'inbox' }) }) :
          '<p class="small muted">Revisions usually arrive on their own: the submitter answers on the original email thread or updates the same file, and the connected mailbox or drive picks it up. Use this when you have the file in hand.</p>') +
        '<div class="seg" role="group" aria-label="How to add the revision"><button type="button" data-action="wb-rev-mode" data-mode="paste" aria-pressed="true" id="wb-rev-mode-paste">' + icon('clipboard') + 'Paste text</button>' +
        '<button type="button" data-action="wb-rev-mode" data-mode="upload" aria-pressed="false" id="wb-rev-mode-upload">' + icon('upload') + 'Upload file</button></div>' +
        '<div id="wb-rev-upload" hidden><label class="dropzone" for="wb-rev-file" id="wb-rev-drop" style="display:block;cursor:pointer">' + icon('upload', { size: 20 }) +
        '<div class="small medium">Drop the revised file here, or choose one</div><div class="xs">PDF, PNG, JPG, HTML, DOCX or TXT</div></label>' +
        '<input type="file" id="wb-rev-file" class="sr-only" accept=".pdf,.png,.jpg,.jpeg,.html,.htm,.docx,.txt">' +
        '<div class="xs muted" id="wb-rev-file-name" role="status" aria-live="polite">No file chosen.</div></div>' +
        '<div class="section-title">Revised copy</div>' + revFields(c, secs) +
        (hiddenOf(c.latest).length ? '<label class="check"><input type="checkbox" id="wb-rev-nohidden"><span>The hidden text is gone from this file</span></label>' : '') +
        ui.field('Revision from', ui.select('wb-rev-author', authorOpts, subName), { id: 'wb-rev-author', hint: 'Recorded as the author of V' + n + '. If you authored it, approving it with exceptions needs another member.' }) +
        '<p class="xs muted">Creates V' + n + '. Earlier versions stay unchanged and checks re-run automatically.</p></div>',
      actions: [{ label: 'Cancel' }, { label: 'Save as V' + n, action: 'wb-rev-save', variant: 'default', icon: 'check' }],
      onOpen: function (dlg) {
        if (!dlg) return;
        var inp = dlg.querySelector('#wb-rev-file'), dz = dlg.querySelector('#wb-rev-drop');
        if (inp) inp.addEventListener('change', function () { var f = inp.files && inp.files[0]; if (f) pickRevisionFile(f.name); });
        if (dz) {
          dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('is-over'); });
          dz.addEventListener('dragleave', function () { dz.classList.remove('is-over'); });
          dz.addEventListener('drop', function (e) {
            e.preventDefault(); dz.classList.remove('is-over');
            var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (f) pickRevisionFile(f.name);
          });
        }
      },
      onClose: function () { st.rev = null; }
    });
  });
  function pickRevisionFile(name) {
    var c = ctxCurrent();
    if (!c || !st.rev) return;
    st.rev.file = name;
    var secs = simulatedRevision(c);
    if (st.rev.ids.length) {
      secs.forEach(function (s) { var ta = byId('wb-rev-s-' + s.id); if (ta) ta.value = s.text; });
    } else {
      var ta = byId('wb-rev-s-new'); if (ta) ta.value = secs[0].text;
    }
    var out = byId('wb-rev-file-name');
    if (out) out.textContent = 'Selected ' + name + '. Text extracted (simulated in this prototype: the suggested fixes are filled in). Edit anything before saving.';
  }
  A.action('wb-rev-mode', function (el) {
    var mode = el.getAttribute('data-mode');
    var up = byId('wb-rev-upload');
    if (up) up.hidden = mode !== 'upload';
    ['paste', 'upload'].forEach(function (m) { var b = byId('wb-rev-mode-' + m); if (b) b.setAttribute('aria-pressed', String(m === mode)); });
  });
  A.action('wb-rev-save', function () {
    var p = st.rev, c = ctxCurrent();
    if (!p || !c || c.a.id !== p.assetId || c.latest.id !== p.versionId) { A.closeDialog(); A.toast('A newer version arrived. Open Add revision again.', 'warning'); return; }
    var changed = [];
    if (p.ids.length) {
      sectionsOf(c.latest).forEach(function (s) {
        var ta = byId('wb-rev-s-' + s.id);
        if (ta && ta.value.trim() !== String(s.text || '').trim()) changed.push({ id: s.id, text: ta.value.trim() });
      });
    } else {
      var t = val('wb-rev-s-new').trim();
      if (t) changed.push({ id: 's1', label: 'Extracted text', text: t });
    }
    var nh = byId('wb-rev-nohidden'), removeHidden = !!(nh && nh.checked);
    if (!changed.length && !removeHidden) {
      A.toast(p.file ? 'This revision matches V' + c.latest.n + ' exactly, so no new version was created.' : 'Nothing changed. Edit at least one section or choose a file.', 'info');
      return;
    }
    var author = val('wb-rev-author') || c.me.name, file = p.file;
    A.closeDialog();
    var nv = createVersion(c, 'upload', changed, { authorName: author, hidden: removeHidden ? [] : null });
    if (!nv) return;
    var up = A.state.sources.find(function (s) { return s.profileId === c.a.profileId && s.provider === 'upload'; });
    c.a.sourceRefs.push({ sourceId: up ? up.id : 'src-upload', label: (file ? 'Upload: ' + file : 'Paste: revised copy') + ' by ' + c.me.name, seenAt: nv.createdAt });
    A.emit('data-changed', { kind: 'version', assetId: c.a.id });
    A.toast('Added V' + nv.n + '. ' + recheckSummary(nv), 'success');
    A.rerender();
  });

  /* ------------------------------------------------------------------ */
  /* Edit details (metadata)                                             */
  /* ------------------------------------------------------------------ */
  A.action('wb-edit-details', function () {
    var c = ctxCurrent(); if (!c) return;
    var a = c.a, prof = c.profile;
    var camps = A.state.campaigns.filter(function (x) { return x.profileId === a.profileId; });
    var partners = (prof && prof.partners) || [];
    var opt = function (map) { return Object.keys(map).map(function (k) { return { value: k, label: map[k] }; }); };
    A.dialog({
      id: 'wb-md-dialog', title: 'Edit details', description: a.id + ' · changes are logged in History', size: 'md', dismissible: false,
      body: '<div class="stack">' +
        ui.field('Title', '<input class="input" id="wb-md-title" type="text" value="' + esc(a.title) + '">', { id: 'wb-md-title' }) +
        '<div class="field-row">' + ui.field('Product', ui.select('wb-md-product', opt(PRODUCT), a.product), { id: 'wb-md-product' }) +
        ui.field('Channel', ui.select('wb-md-channel', opt(CHANNEL), a.channel), { id: 'wb-md-channel' }) + '</div>' +
        '<div class="field-row">' + ui.field('Target states', '<input class="input" id="wb-md-states" type="text" value="' + esc((a.states || []).join(', ')) + '" placeholder="TX, AZ">', { id: 'wb-md-states', optional: true, hint: 'Two-letter codes, separated by commas.' }) +
        ui.field('Due date', '<input class="input" id="wb-md-due" type="date" value="' + esc(a.dueDate || '') + '">', { id: 'wb-md-due', optional: true }) + '</div>' +
        '<div class="field-row">' + ui.field('Campaign', ui.select('wb-md-campaign', [{ value: '', label: 'None' }].concat(camps.map(function (x) { return { value: x.id, label: x.name }; })), a.campaignId || ''), { id: 'wb-md-campaign', optional: true }) +
        ui.field('Submitting organization', ui.select('wb-md-partner', [{ value: '', label: 'None (member submission)' }].concat(partners.map(function (x) { return { value: x.id, label: x.name + ' · ' + (x.type === 'agency' ? 'Agency' : 'Affiliate') }; })), a.partnerId || ''), { id: 'wb-md-partner', optional: true }) + '</div>' +
        '</div>',
      actions: [{ label: 'Cancel' }, { label: 'Save details', action: 'wb-md-save', variant: 'default', icon: 'check' }]
    });
  });
  A.action('wb-md-save', function () {
    var c = ctxCurrent(); if (!c) return;
    var a = c.a;
    var states = val('wb-md-states').toUpperCase().split(/[\s,;]+/).filter(function (s) { return /^[A-Z]{2}$/.test(s); });
    var patch = {
      title: val('wb-md-title').trim() || a.title, product: val('wb-md-product') || a.product, channel: val('wb-md-channel') || a.channel,
      states: states, dueDate: val('wb-md-due') || null, campaignId: val('wb-md-campaign') || null, partnerId: val('wb-md-partner') || null
    };
    var changes = A.editMetadata(a.id, patch) || [];
    A.closeDialog();
    A.emit('data-changed', { kind: 'metadata', assetId: a.id });
    A.toast(changes.length ? 'Saved ' + A.plural(changes.length, 'change') + '. Logged in History.' : 'No changes.', changes.length ? 'success' : 'info');
    A.rerender();
  });

  /* ------------------------------------------------------------------ */
  /* Dismiss (Not an issue) + add a missed finding                       */
  /* ------------------------------------------------------------------ */
  function openDismiss(c, f) {
    st.dismiss = { assetId: c.a.id, versionId: c.v.id, findingId: f.id };
    A.dialog({
      id: 'wb-dismiss-dialog', title: 'Mark ' + f.id + ' as not an issue', size: 'md', dismissible: false,
      body: '<div class="stack"><div class="row row-wrap row-tight">' + ui.severityBadge(f.severity) + '<span class="medium small">' + esc(f.title || f.ruleId) + '</span></div>' +
        (f.quote ? '<div class="quote small">“' + esc(truncate(f.quote, 200)) + '”</div>' : '') +
        '<fieldset class="wb-fieldset"><legend class="label">Reason</legend>' + DISMISS_REASONS.map(function (r, i) {
          return '<label class="check"><input type="radio" name="wb-dis-reason" id="wb-dis-r-' + i + '" value="' + esc(r) + '"><span>' + esc(r) + '</span></label>';
        }).join('') + '</fieldset>' +
        ui.field('Note', '<textarea class="textarea" id="wb-dis-note" rows="2" placeholder="Where is it disclosed, or why doesn\'t the rule apply?"></textarea>', { id: 'wb-dis-note', optional: true }) +
        (f.severity === 'critical' ? ui.callout('warning', 'Dismissing a Critical finding', 'Your reason is recorded in History. Dismissal reasons help your team tune this rule.') : '') + '</div>',
      actions: [{ label: 'Cancel' }, { label: 'Mark not an issue', action: 'wb-dismiss-save', variant: 'default' }],
      onClose: function () { st.dismiss = null; }
    });
  }
  A.action('wb-dismiss-save', function () {
    var p = st.dismiss; if (!p) return;
    var r = document.querySelector('input[name="wb-dis-reason"]:checked');
    if (!r) { A.toast('Choose a reason.', 'error'); return; }
    var note = val('wb-dis-note').trim();
    A.setDisposition(p.assetId, p.versionId, p.findingId, 'dismissed', r.value + (note ? ': ' + note : ''));
    A.closeDialog();
    A.emit('data-changed', { kind: 'disposition', assetId: p.assetId });
    A.toast(p.findingId + ' marked Not an issue.', 'success');
    A.rerender();
  });
  A.action('wb-add-finding', function () {
    var c = ctxCurrent(); if (!c) return;
    if (!c.editable) { A.toast(readOnlyReason(c), 'info'); return; }
    var rules = A.state.rules.filter(function (r) { return r.profileId === c.a.profileId && (r.appliesTo || []).indexOf(c.a.product) >= 0; });
    if (!rules.length) rules = A.state.rules.filter(function (r) { return r.profileId === c.a.profileId; });
    var secs = sectionsOf(c.v);
    A.dialog({
      id: 'wb-add-dialog', title: 'Add a finding the check missed', size: 'md', dismissible: false,
      body: '<div class="stack">' +
        ui.field('Rule', ui.select('wb-add-rule', rules.map(function (r) { return { value: r.id, label: r.id + ' · ' + r.title }; }), rules[0] ? rules[0].id : ''), { id: 'wb-add-rule' }) +
        '<div class="field-row">' + ui.field('Severity', ui.select('wb-add-sev', [{ value: 'critical', label: 'Critical' }, { value: 'major', label: 'Major' }, { value: 'minor', label: 'Minor' }], 'major'), { id: 'wb-add-sev' }) +
        (secs.length ? ui.field('Section', ui.select('wb-add-sec', secs.map(function (s) { return { value: s.id, label: plabel(s) }; }), secs[0].id), { id: 'wb-add-sec' }) : '') + '</div>' +
        ui.field('Quoted text', '<input class="input" id="wb-add-quote" type="text" autocomplete="off">', { id: 'wb-add-quote', optional: true, hint: 'Copy the exact words so the span can be highlighted.' }) +
        ui.field('What is wrong', '<textarea class="textarea" id="wb-add-expl" rows="3"></textarea>', { id: 'wb-add-expl' }) +
        '<p class="xs muted">Reviewer-added findings are labelled as misses and count toward the miss rate. They start as Fix required.</p></div>',
      actions: [{ label: 'Cancel' }, { label: 'Add finding', action: 'wb-add-save', variant: 'default', icon: 'plus' }]
    });
  });
  A.action('wb-add-save', function () {
    var c = ctxCurrent(); if (!c || !c.editable) { A.closeDialog(); return; }
    var a = c.a, v = c.v, rule = A.ruleById(val('wb-add-rule'));
    var expl = val('wb-add-expl').trim(), quote = val('wb-add-quote').trim(), secId = val('wb-add-sec') || (sectionsOf(v)[0] || {}).id || null;
    if (!rule) { A.toast('Choose a rule.', 'error'); return; }
    if (expl.length < 10) { A.toast('Describe the problem in at least 10 characters.', 'error'); return; }
    var found = !quote || contains(textFor(v, secId) || '', quote);
    var base = 'F' + (a.id.replace(/\D/g, '') || a.id) + '-' + v.n + '-', k = (v.findings || []).length + 1;
    while ((v.findings || []).some(function (f) { return f.id === base + k; })) k++;
    var sev = val('wb-add-sev') || 'major';
    var f = {
      id: base + k, ruleId: rule.id, ruleVersion: A.ruleVersion(rule).v, severity: sev, evidenceType: quote ? 'exact-match' : 'needs-judgment',
      sectionId: secId, quote: quote || null, verifiedSpan: found, title: 'Added by reviewer: ' + rule.title, explanation: expl,
      suggestedFix: null, suggestedCopy: null, disposition: 'fix-required', dispositionNote: null, addedBy: c.me.name, recheck: null
    };
    v.findings.push(f);
    var row = (v.checklist || []).find(function (r) { return r.ruleId === rule.id; });
    if (row) row.result = 'flagged'; else v.checklist.push({ ruleId: rule.id, result: 'flagged' });
    if (a.status === 'needs-review' && /no issues/i.test(a.subLabel || '')) a.subLabel = 'Has findings';
    A.log(a.id, c.me.name, 'finding', 'Added ' + f.id + ' (missed by preflight): ' + rule.id + ', ' + sevLabel(sev) + (quote && !found ? '. Quote not found in the section.' : '.'));
    st.active = f.id; st.tab = 'findings';
    A.closeDialog();
    A.emit('data-changed', { kind: 'finding', assetId: a.id });
    A.toast('Added ' + f.id + (found ? '.' : '. The quoted text was not found, so it shows Evidence not found.'), found ? 'success' : 'warning');
    A.rerender();
    var card = byId('wb-f-' + f.id); if (card) { scrollInPane(card); flash(card); }
  });

  /* ------------------------------------------------------------------ */
  /* Decisions                                                           */
  /* ------------------------------------------------------------------ */
  function excRow(f, i) {
    return '<div class="card"><div class="card-body stack-sm">' +
      '<div class="row row-wrap row-tight">' + ui.severityBadge(f.severity) + ui.evidenceBadge(f.evidenceType) + (f.disposition ? ui.dispositionBadge(f.disposition) : '') + '<span class="spacer"></span><span class="mono xs muted">' + esc(f.id) + '</span></div>' +
      '<div class="small medium">' + esc(f.title || f.ruleId) + '</div>' +
      (f.quote ? '<div class="quote small">“' + esc(truncate(f.quote, 220)) + '”</div>' : '') +
      (f.disposition === 'fix-required' ? '<div class="xs muted">Marked Fix required. Approving records it as an accepted exception instead.</div>' : '') +
      ui.field('Reason', ui.select('wb-exc-reason-' + i, [{ value: '', label: 'Choose a reason' }].concat(EXC_REASONS.map(function (r) { return { value: r, label: r }; })), '', { change: 'wb-dlg-check' }), { id: 'wb-exc-reason-' + i }) +
      ui.field('Justification', '<textarea class="textarea" id="wb-exc-text-' + i + '" rows="3" data-input="wb-dlg-check" placeholder="Say where the disclosure appears, who signed off, or why the risk is acceptable."></textarea>' +
        '<div class="row between"><span class="hint">Write it yourself; nothing is prefilled.</span><span class="counter is-short" id="wb-exc-count-' + i + '">0 / 40</span></div>', { id: 'wb-exc-text-' + i }) +
      '</div></div>';
  }
  function openDecision(kind) {
    var c = ctxCurrent();
    if (!c) return;
    var block = decideBlock(c);
    if (block) { A.toast(block, 'info'); return; }
    var a = c.a, v = c.v, me = c.me, prof = c.profile;
    var open = A.openFindings(v);
    var mode = kind === 'reject' ? 'reject' : (open.some(function (f) { return f.severity !== 'minor'; }) ? 'exceptions' : 'approve');
    var self = A.isSelfApproval(a, v), members = A.memberCount(prof);
    var others = ((prof && prof.members) || []).filter(function (m) { return m.userId !== me.id; }).map(function (m) { var u = A.userById(m.userId); return u ? u.name : null; }).filter(Boolean);
    var owners = ((prof && prof.members) || []).filter(function (m) { return m.role === 'owner'; }).map(function (m) { var u = A.userById(m.userId); return u ? u.name : null; }).filter(Boolean);
    var parts = ['<div class="wb-restate">' + (mode === 'reject' ? 'Rejecting' : 'Approving') + ' <strong>V' + esc(v.n) + '</strong> · ' + ui.sha(v.sha) + ' · <span class="muted">“' + esc(snippet(v)) + '”</span></div>'];
    var rows = [];
    if (mode === 'exceptions') {
      rows = open.filter(function (f) { return f.severity !== 'minor' || !f.disposition || f.disposition === 'fix-required'; });
      if (self && members > 1) parts.push(ui.callout('danger', 'You authored V' + v.n, esc('Approving your own version with exceptions needs another member' + (others.length ? ' (' + others.join(' or ') + ')' : '') + '. You can still request changes or reject.')));
      else if (self) parts.push(ui.callout('warning', 'Self-approval', 'You are the only member of this profile, so you can approve your own version with exceptions. It will carry a Self-approved badge.'));
      parts.push('<p class="small">Each open finding below needs a reason and a justification of at least 40 characters.</p>');
      parts.push('<div class="wb-exc-list">' + rows.map(excRow).join('') + '</div>');
      parts.push('<p class="small muted">' + esc(owners.length ? (owners.indexOf(me.name) >= 0 && owners.length === 1 ? 'You are the profile owner. ' : owners.join(', ') + ' (owner) will be notified in the app. ') : '') +
        'The asset shows an amber Approved with exceptions badge, and the exceptions appear in exports.</p>');
    } else if (mode === 'approve') {
      var chk = A.canDecide(a.id, v.id, 'approved');
      var live = (v.findings || []).filter(function (f) { return f.recheck !== 'resolved'; });
      if (live.length) {
        parts.push('<div class="small">' + esc(A.plural(live.length, 'finding')) + ': ' + esc(['dismissed', 'accepted-exception', 'fix-required'].map(function (d) {
          var n = live.filter(function (f) { return f.disposition === d; }).length; return n ? n + ' ' + dispLabel(d).toLowerCase() : null;
        }).filter(Boolean).join(', ') || 'none dispositioned') + '.</div>');
      } else if (v.run && v.run.status === 'complete') {
        parts.push('<div class="small">Preflight flagged nothing against ' + esc(A.plural((v.checklist || []).length, 'rule')) + '. Not checked items still need your judgment.</div>');
      }
      if (!chk.ok) parts.push(ui.callout('warning', 'Can\'t approve yet', esc(chk.reason)));
      if (!v.run || v.run.status !== 'complete') parts.push(ui.callout('warning', 'Nothing was checked automatically', 'Approve only if you reviewed the original yourself.'));
      if (self) parts.push(ui.callout('warning', 'Self-approval', esc('You authored or submitted V' + v.n + '. The approval will carry a Self-approved badge. Add a short note saying why that is acceptable.')));
      parts.push(ui.field(self ? 'Self-approval note' : 'Note', '<textarea class="textarea" id="wb-dec-note" rows="2" data-input="wb-dlg-check" placeholder="' + (self ? 'At least 20 characters' : 'Optional') + '"></textarea>', { id: 'wb-dec-note', optional: !self }));
    } else {
      parts.push(ui.field('Reason', '<textarea class="textarea" id="wb-dec-note" rows="3" data-input="wb-dlg-check" placeholder="Why this version can\'t be used (at least 10 characters)"></textarea>', { id: 'wb-dec-note', hint: 'Shown in History and to members in the app.' }));
    }
    if (mode !== 'reject') {
      parts.push('<label class="check"><input type="checkbox" id="wb-attest" data-change="wb-dlg-check"><span>I, <strong>' + esc(me.name) + '</strong>, reviewed V' + esc(v.n) + ' (sha ' + esc(v.sha) + ')' +
        (mode === 'exceptions' ? ' and approve it with the exceptions above. The justifications are accurate.' : ' and approve it for use.') + '</span></label>');
    }
    parts.push('<div class="small muted" id="wb-dlg-status" role="status" aria-live="polite"></div>');
    st.dlg = { mode: mode, assetId: a.id, versionId: v.id, rows: rows.map(function (f) { return f.id; }), self: self };
    var go = mode === 'exceptions' ? 'Approve V' + v.n + ' with ' + A.plural(rows.length, 'exception') : (mode === 'approve' ? 'Approve V' + v.n : 'Reject V' + v.n);
    A.dialog({
      id: 'wb-decide-dialog', size: mode === 'exceptions' ? 'lg' : 'md', dismissible: false,
      title: mode === 'exceptions' ? 'Approve with exceptions' : go,
      description: 'Decisions are recorded with your name, the version and its hash. The AI never decides.',
      body: '<div class="stack">' + parts.join('') + '</div>',
      actions: [{ label: 'Cancel' }, { label: go, action: 'wb-decide-confirm', variant: mode === 'reject' ? 'destructive' : 'default', id: 'wb-decide-go', disabled: true }],
      onOpen: function () { dlgCheck(); },
      onClose: function () { st.dlg = null; }
    });
  }
  function dlgCheck() {
    var d = st.dlg;
    if (!d) return null;
    var ok = true, msg = '', exceptions = [];
    var note = val('wb-dec-note').trim();
    if (d.mode === 'exceptions') {
      d.rows.forEach(function (fid, i) {
        var text = val('wb-exc-text-' + i).trim(), ct = byId('wb-exc-count-' + i);
        if (ct) { ct.textContent = text.length + ' / 40'; ct.className = 'counter ' + (text.length >= 40 ? 'is-ok' : 'is-short'); }
        exceptions.push({ findingId: fid, reason: val('wb-exc-reason-' + i), text: text });
      });
      var chk = A.canDecide(d.assetId, d.versionId, 'approved-with-exceptions', { exceptions: exceptions });
      if (!chk.ok) { ok = false; msg = chk.reason; }
    } else if (d.mode === 'approve') {
      var chk2 = A.canDecide(d.assetId, d.versionId, 'approved');
      if (!chk2.ok) { ok = false; msg = chk2.reason; }
      else if (d.self && note.length < 20) { ok = false; msg = 'Add a self-approval note of at least 20 characters (' + note.length + ' so far).'; }
    } else {
      var chk3 = A.canDecide(d.assetId, d.versionId, 'rejected');
      if (!chk3.ok) { ok = false; msg = chk3.reason; }
      else if (note.length < 10) { ok = false; msg = 'Add a reason of at least 10 characters.'; }
    }
    var at = byId('wb-attest');
    if (ok && d.mode !== 'reject' && at && !at.checked) { ok = false; msg = 'Check the attestation to continue.'; }
    var btn = byId('wb-decide-go'); if (btn) btn.disabled = !ok;
    var s = byId('wb-dlg-status'); if (s) s.textContent = ok ? 'Ready to record the decision.' : msg;
    return { ok: ok, msg: msg, exceptions: exceptions, note: note };
  }
  A.action('wb-dlg-check', function () { dlgCheck(); });
  A.action('wb-decide', function (el) { openDecision(el.getAttribute('data-mode') === 'reject' ? 'reject' : 'approve'); });
  A.action('wb-decide-confirm', function () {
    var d = st.dlg, r = dlgCheck();
    if (!d || !r) return;
    if (!r.ok) { A.toast(r.msg, 'error'); return; }
    var dec = d.mode === 'exceptions' ? 'approved-with-exceptions' : (d.mode === 'approve' ? 'approved' : 'rejected');
    var res = A.decide(d.assetId, d.versionId, dec, { exceptions: d.mode === 'exceptions' ? r.exceptions : undefined, note: r.note, attested: d.mode !== 'reject' });
    if (!res) return;
    var a = A.asset(d.assetId), v = a ? A.version(a, d.versionId) : null, n = v ? v.n : '?';
    A.closeDialog();
    st.asOf = null;
    A.toast(dec === 'approved' ? 'Approved V' + n + (res.selfApproved ? ' (self-approved)' : '') + '. It is now the approved version.' :
      dec === 'approved-with-exceptions' ? 'Approved V' + n + ' with ' + A.plural(res.exceptions.length, 'exception') + '. The profile owner was notified in the app.' :
        'Rejected V' + n + '.', 'success');
    A.rerender();
  });
  function openCrFallback(c) {
    var fs = A.openFindings(c.v).filter(function (f) { return f.disposition !== 'accepted-exception'; });
    st.crRows = fs.map(function (f) { return f.id; });
    A.dialog({
      id: 'wb-cr-dialog', title: 'Request changes on V' + c.v.n, size: 'lg', dismissible: false,
      description: 'Saved in the app and shown to members. Use Copy as text to share it wherever you already talk to the submitter.',
      body: '<div class="stack">' + (fs.length ? fs.map(function (f, i) {
        var txt = [f.suggestedFix, f.suggestedCopy ? 'Suggested: "' + f.suggestedCopy + '"' : null].filter(Boolean).join(' ') || 'Fix: ' + (f.title || f.ruleId);
        return '<div class="card"><div class="card-body stack-sm"><label class="check"><input type="checkbox" id="wb-cr-on-' + i + '"' + (f.disposition === 'fix-required' || !f.disposition ? ' checked' : '') + '><span>' +
          ui.severityBadge(f.severity) + ' ' + esc(f.title || f.ruleId) + '</span></label>' +
          ui.field('Required fix', '<textarea class="textarea" rows="2" id="wb-cr-text-' + i + '">' + esc(txt) + '</textarea>', { id: 'wb-cr-text-' + i }) + '</div></div>';
      }).join('') : '<p class="small muted">No open findings. Add the change you need as a note.</p>') +
        ui.field('Note', '<textarea class="textarea" rows="2" id="wb-cr-note"></textarea>', { id: 'wb-cr-note', optional: true }) +
        ui.field('Due date', '<input class="input" type="date" id="wb-cr-due" value="' + esc(c.a.dueDate || '') + '">', { id: 'wb-cr-due', optional: true }) + '</div>',
      actions: [{ label: 'Cancel' }, { label: 'Save change request', action: 'wb-cr-save', variant: 'default' }],
      onClose: function () { st.crRows = null; }
    });
  }
  A.action('wb-request', function () {
    var c = ctxCurrent(); if (!c) return;
    var block = decideBlock(c);
    if (block) { A.toast(block, 'info'); return; }
    if (typeof A.openChangeRequest === 'function') { A.openChangeRequest(c.a.id); return; }
    openCrFallback(c);
  });
  A.action('wb-cr-save', function () {
    var c = ctxCurrent(); if (!c || !st.crRows) return;
    var items = [];
    st.crRows.forEach(function (fid, i) { var on = byId('wb-cr-on-' + i); var t = val('wb-cr-text-' + i).trim(); if (on && on.checked && t) items.push({ findingId: fid, text: t }); });
    var note = val('wb-cr-note').trim();
    if (!items.length && note) items.push({ findingId: null, text: note });
    if (!items.length) { A.toast('Add at least one item to the checklist.', 'error'); return; }
    var cr = A.requestChanges(c.a.id, c.v.id, { items: items, note: note, dueDate: val('wb-cr-due') || null });
    if (!cr) return;
    A.closeDialog();
    A.toast('Saved ' + cr.id + '. Members see it in the app; use Copy as text to share it.', 'success');
    A.rerender();
  });

  /* ------------------------------------------------------------------ */
  /* Ask about this asset (canned, scoped, advisory)                     */
  /* ------------------------------------------------------------------ */
  function chatAnswer(c, q) {
    var a = c.a, v = c.v, t = String(q || '').toLowerCase();
    var open = A.openFindings(v), live = (v.findings || []).filter(function (f) { return f.recheck !== 'resolved'; });
    var resolved = (v.findings || []).filter(function (f) { return f.recheck === 'resolved'; });
    var alerts = v.securityAlerts || [], vl = a.id + ' V' + v.n;
    function list(fs) {
      return fs.map(function (f, i) {
        return (i + 1) + '. [' + sevLabel(f.severity) + '] ' + (f.title || f.ruleId) + (f.quote && f.sectionId !== 'hidden' ? ': "' + f.quote + '"' : '') + ' (' + f.ruleId + (f.disposition ? ', ' + dispLabel(f.disposition) : '') + ')';
      }).join('\n');
    }
    if (c.running) return 'Preflight ' + ((v.run && v.run.id) || '') + ' is still running on ' + vl + '. I can only answer from a finished run, so ask again when the findings appear.';
    if (/(approv|sign[- ]?off|\bready\b|good to go|ok to (run|ship|publish|go)|okay to|green ?light|lgtm|\bship\b|publish|go live|pass this|clear this)/.test(t) && !/pre-?approv/.test(t)) {
      var r = 'I can\'t approve, reject or change anything. Only a member can decide, using the decision bar' + (A.blockingAlerts(v).length ? ', and only after acknowledging the security alert.' : '.');
      r += open.length ? '\n\n' + vl + ' has ' + A.plural(open.length, 'open finding') + ':\n' + list(open) : '\n\n' + vl + ' has no open findings. A member still has to review it and decide.';
      return r;
    }
    if (alerts.length && /(hidden|legal|clear|footer|inject|instruction|white|ignore|ai (assistant|reviewer|system)|top.rated|addressed)/.test(t)) {
      var al = alerts[0];
      if (al.kind === 'hidden-text') {
        var hf = (v.findings || []).find(function (f) { return f.sectionId === 'hidden'; });
        return 'The page contains text hidden from people (' + (al.how || 'method not recorded') + '). It reads: "' + al.text + '"\n\n' +
          'I treated it as part of the content under review, not as an instruction. It doesn\'t change the findings, the rules, or who can approve. ' +
          ((a.decisions || []).length ? '' : 'No Legal sign-off or earlier decision is recorded in this asset\'s history. ') +
          'Ask the partner to remove it' + (hf ? '; finding ' + hf.id + ' tracks it.' : '.');
      }
      return 'The footer has visible text addressed to AI systems: "' + al.text + '"\n\nI treated it as content, not as an instruction, so it doesn\'t change the findings or the rankings. It is shown as a warning so you can ask the partner to remove it.';
    }
    if (/(\bfix|rewrite|reword|suggest|wording|replace)/.test(t)) {
      var sf = live.filter(function (f) { return f.suggestedCopy || f.suggestedFix; });
      if (!sf.length) return 'There are no suggested fixes on ' + vl + '.';
      return 'Suggested fixes on ' + vl + ' (AI suggestions; you decide whether to use them):\n' + sf.map(function (f, i) {
        return (i + 1) + '. ' + f.id + ': ' + (f.suggestedFix || '') + (f.suggestedCopy ? '\n   Suggested copy: "' + f.suggestedCopy + '"' : '');
      }).join('\n') + '\n\nApply suggestion on a finding creates a new version. It never changes ' + vl + '.';
    }
    if (/(summar|overview|what('?s| is) wrong|issues|findings|problems|tl;?dr|status)/.test(t)) {
      if (!live.length) return vl + ': preflight flagged nothing against ' + A.plural((v.checklist || []).length, 'rule') + (resolved.length ? ' (' + resolved.length + ' earlier findings resolved on recheck)' : '') + '. The Coverage tab lists what was not checked, such as state law.';
      return vl + ' has ' + A.plural(open.length, 'open finding') + (open.length ? ' (' + sevCounts(open) + ')' : '') + ':\n' + list(live) +
        (resolved.length ? '\n\n' + resolved.length + ' resolved on recheck.' : '') + (alerts.length ? '\n\nThere is also a ' + (alerts[0].kind === 'hidden-text' ? 'security alert for hidden text' : 'possible-injection warning') + '.' : '') +
        '\n\nDispositions set: ' + live.filter(function (f) { return !!f.disposition; }).length + ' of ' + live.length + '.';
    }
    var rm = /\b(cp|lib)-[a-z]+-\d+\b/.exec(t);
    if (rm || /(rule|explain|why|regulation|cite|citation|\blaw\b|reg [a-z]|cfr)/.test(t)) {
      var af = findIn(c, st.active);
      var rid = rm ? rm[0].toUpperCase() : (af ? af.ruleId : (open[0] ? open[0].ruleId : (live[0] ? live[0].ruleId : null)));
      var rule = rid ? A.ruleById(rid) : null;
      if (!rule) return 'I couldn\'t find that rule in this profile\'s rule set. Rules with findings on ' + vl + ': ' + (live.map(function (f) { return f.ruleId; }).filter(function (x, i, arr) { return arr.indexOf(x) === i; }).join(', ') || 'none') + '.';
      var rv = A.ruleVersion(rule);
      var refs = (rule.referenceIds || []).map(function (id) { return A.referenceById(id); }).filter(Boolean);
      var fs = live.filter(function (f) { return f.ruleId === rule.id; });
      return rule.id + ' v' + rv.v + ': ' + rule.title + '\n' + rv.text + '\n\nSources: ' + (refs.map(function (r) { return r.citation; }).join('; ') || 'ClearPath policy') +
        (refs.length ? ' (verified as of ' + refs[0].verifiedAsOf + ')' : '') + '.' +
        (fs.length ? '\n\nOn ' + vl + ':\n' + fs.map(function (f) { return '- ' + (f.title || f.id) + '. ' + (f.explanation || ''); }).join('\n') : '\n\nNo open finding on ' + vl + ' uses this rule.');
    }
    if (/(offer|apr|rate|fee|terms|catalog|price)/.test(t)) {
      var snap = (v.run && v.run.offerSnapshot) || [];
      if (!snap.length) return 'No offer terms were compared for ' + vl + '.';
      return snap.map(function (raw) {
        var o = parseOfferRef(raw);
        if (!o || !o.ver) return raw + ': not in the catalog any more.';
        return o.offer.id + ' v' + o.ver.v + ' (' + o.offer.name + ', effective ' + o.ver.effectiveFrom + '):\n' + Object.keys(o.ver.terms || {}).slice(0, 8).map(function (k) { return '- ' + humanKey(k) + ': ' + fmtTerm(k, o.ver.terms[k]); }).join('\n');
      }).join('\n\n') + '\n\nThe Offer facts tab shows every term.';
    }
    if (/(cost|spend|token|budget|price of)/.test(t)) {
      var run = v.run || {};
      return 'Run ' + (run.id || '—') + ' on ' + vl + ' used ' + fmtInt(run.tokensIn) + ' input and ' + fmtInt(run.tokensOut) + ' output tokens with ' + (run.model || 'the configured model') + ', costing ' + ui.money(run.costUsd || 0) + ' (sample).' + (run.reusedFrom ? ' Results were partly reused from ' + run.reusedFrom + ' at $0.' : '');
    }
    var fr = open[0] || live[0];
    return 'I can answer questions about ' + vl + ': its findings, the rules and offer terms the check used, and suggested fixes. I can\'t approve, change anything, or look at other assets. Try "Summarize the findings"' + (fr ? ' or "Explain ' + fr.ruleId + '"' : '') + '.';
  }
  function meterChat(a, q) {
    var tokensIn = 1800 + Math.round(String(q || '').length * 2.5), tokensOut = 160 + Math.round(Math.random() * 80);
    var cost = round4((tokensIn * 1 + tokensOut * 5) / 1e6);
    var ids = (A.state.costLedger || []).map(function (x) { return x.runId; });
    var runId = A.nextId('Q', ids, 412);
    A.state.costLedger.push({ at: A.nowIso(), runId: runId, assetId: a.id, model: 'claude-haiku-4-5', tokensIn: tokensIn, tokensOut: tokensOut, costUsd: cost, cached: false });
    var p = A.profileOf(a), b = p && p.budget;
    if (b) {
      b.profileSpentTodayUsd = round4((b.profileSpentTodayUsd || 0) + cost);
      b.globalSpentTodayUsd = round4((b.globalSpentTodayUsd || 0) + cost);
    }
    A.log(a.id, A.me().name, 'chat', 'Asked in Ask about this asset: "' + truncate(q, 90) + '" · ' + runId + ' ' + ui.money(cost) + '.');
  }
  function scrollChat() {
    var b = byId('wb-right-body'), logEl = byId('wb-chat-log');
    if (!b) return;
    if (stacked()) { if (logEl && logEl.lastElementChild) { try { logEl.lastElementChild.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } } return; }
    b.scrollTop = b.scrollHeight;
  }
  function sendChat(q) {
    var c = ctxCurrent();
    if (!c) return;
    q = String(q || '').trim();
    if (!q) { A.toast('Type a question first.', 'info'); return; }
    if (st.chatPending) return;
    var a = c.a, aid = a.id;
    a.chat.push({ role: 'user', text: q, at: A.nowIso(), versionId: c.v.id });
    var answer = chatAnswer(c, q);
    st.chatDraft = ''; st.chatPending = true; st.tab = 'chat';
    A.emit('data-changed', { kind: 'chat', assetId: aid });
    A.rerender();
    scrollChat();
    var vid = c.v.id;
    setTimeout(function () {
      var cur = A.asset(aid, { anyProfile: true });
      st.chatPending = false;
      if (!cur) return;
      cur.chat.push({ role: 'assistant', text: answer, at: A.nowIso(), versionId: vid });
      meterChat(cur, q);
      if (isViewing(aid)) {
        A.rerender();
        scrollChat();
        var ta = byId('wb-chat-input'); if (ta && document.activeElement === document.body) { try { ta.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      }
    }, 450);
  }
  A.action('wb-chat-draft', function (el) { st.chatDraft = el.value; });
  A.action('wb-chat-send', function () { sendChat(val('wb-chat-input')); });
  A.action('wb-chat-ask', function (el) { sendChat(el.getAttribute('data-q')); });

  /* ------------------------------------------------------------------ */
  /* Preflight simulation (A-111 style running assets)                   */
  /* ------------------------------------------------------------------ */
  function completePreflight(aid) {
    var a = A.asset(aid, { anyProfile: true });
    if (!a || a.status !== 'preflighting') return;
    var v = A.latestVersion(a);
    if (!v || !v.run || v.run.status !== 'running') return;
    var run = v.run, pend = run.pending || {};
    v.findings = A.clone(pend.findings || []);
    run.status = 'complete';
    run.tokensIn = pend.tokensIn || 0; run.tokensOut = pend.tokensOut || 0; run.costUsd = pend.costUsd || 0;
    run.at = A.nowIso();
    var cov = run.coverage || {};
    if (/running/i.test(cov.copy || '')) cov.copy = 'Checked';
    if (/running/i.test(cov.disclosures || '')) cov.disclosures = 'Checked';
    run.coverage = cov;
    recomputeChecklist(a, v);
    a.status = 'needs-review';
    a.subLabel = pend.subLabel || (v.findings.length ? 'Has findings' : 'No issues flagged');
    var p = A.profileOf(a), b = p && p.budget;
    if (b) {
      b.profileSpentTodayUsd = round4((b.profileSpentTodayUsd || 0) + run.costUsd);
      b.globalSpentTodayUsd = round4((b.globalSpentTodayUsd || 0) + run.costUsd);
    }
    A.state.costLedger.push({ at: run.at, runId: run.id, assetId: a.id, model: run.model, tokensIn: run.tokensIn, tokensOut: run.tokensOut, costUsd: run.costUsd, cached: false });
    var counts = sevCounts(v.findings);
    A.log(a.id, 'System', 'preflight', 'Preflight ' + run.id + ' finished against ' + A.plural((v.checklist || []).length, 'rule') + ((run.offerSnapshot || []).length ? ' and ' + run.offerSnapshot.join(', ') : '') +
      '. ' + fmtInt(run.tokensIn) + ' tokens in, ' + fmtInt(run.tokensOut) + ' out, ' + ui.money(run.costUsd) + '.');
    A.log(a.id, 'System', 'finding', v.findings.length ? A.plural(v.findings.length, 'finding') + ': ' + counts + '.' : 'No issues flagged.');
    if (A.state.activeProfileId === a.profileId) {
      A.notify('Preflight finished on ' + a.id + ': ' + (v.findings.length ? A.plural(v.findings.length, 'finding') + ' (' + counts + ')' : 'no issues flagged') + '.', '#asset-' + a.id);
    }
    A.emit('data-changed', { kind: 'preflight', assetId: a.id });
  }
  function ensurePreflight(aid) {
    var a = A.asset(aid, { anyProfile: true });
    if (!a || a.status !== 'preflighting') return;
    var v = A.latestVersion(a);
    if (!v || !v.run || v.run.status !== 'running') return;
    var p = st.pf[aid];
    if (p && p.timer) return;
    var steps = (v.run.pending && v.run.pending.steps) || DEFAULT_STEPS;
    p = st.pf[aid] = p || { idx: 0, timer: null };
    var mine = st;
    function tick() {
      if (st !== mine) return; // demo was reset
      p.timer = null;
      var cur = A.asset(aid, { anyProfile: true });
      if (!cur || cur.status !== 'preflighting') return;
      p.idx += 1;
      if (p.idx >= steps.length) {
        completePreflight(aid);
        if (isViewing(aid)) { A.rerender(); A.toast('Preflight finished on ' + aid + '. Findings are ready.', 'success'); }
        return;
      }
      p.timer = setTimeout(tick, 1400);
      if (isViewing(aid)) A.rerender();
    }
    p.timer = setTimeout(tick, 1400);
  }

  /* ------------------------------------------------------------------ */
  /* Keyboard (scope: asset route)                                       */
  /* ------------------------------------------------------------------ */
  A.key('asset', 'j', function () { moveActive(1); }, 'Next finding');
  A.key('asset', 'k', function () { moveActive(-1); }, 'Previous finding');
  A.key('asset', '1', function () { if (!st.active) { A.toast('Select a finding first. Press J or K to move between findings.', 'info'); return; } setDispo(st.active, 'fix-required'); }, 'Mark the selected finding Fix required');
  A.key('asset', '2', function () { if (!st.active) { A.toast('Select a finding first. Press J or K to move between findings.', 'info'); return; } setDispo(st.active, 'dismissed'); }, 'Mark the selected finding Not an issue');
  A.key('asset', '3', function () { if (!st.active) { A.toast('Select a finding first. Press J or K to move between findings.', 'info'); return; } setDispo(st.active, 'accepted-exception'); }, 'Accept the selected finding as an exception');
  A.key('asset', 'd', function () { openDecision('approve'); }, 'Decide (approve or approve with exceptions)');
  A.key('asset', 'e', function () {
    var c = ctxCurrent(); if (!c) return;
    var f = findIn(c, st.active);
    var sid = f && f.sectionId && f.sectionId !== 'hidden' ? f.sectionId : (sectionsOf(c.v)[0] || {}).id;
    if (sid) openEdit(sid); else A.toast('This version has no text to edit.', 'info');
  }, 'Edit copy of the selected finding\'s section');
})();
