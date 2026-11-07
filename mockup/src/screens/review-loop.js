/* review-loop.js
 * The review loop after a reviewer has findings:
 *   App.openChangeRequest(assetId)   in-app change request composer (one consolidated checklist, nothing is sent)
 *   App.renderWaitingCallout(asset)   callout for Changes requested assets (revision arrives through connected sources)
 *   #compare-<assetId>                V(n-1) vs V(n): side-by-side or inline word diff, recheck rail, Mark verified
 * Email scope (decision 12): this module never sends anything. "Copy as text" is the only way the checklist leaves the app.
 */
(function () {
  'use strict';
  var A = window.App, ui = A.ui, esc = A.esc;

  /* ------------------------------------------------------------------ */
  /* Module CSS (theme tokens only)                                      */
  /* ------------------------------------------------------------------ */
  var CSS = `
.rl-sbs { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); padding: 0; white-space: normal; }
.rl-col { padding: 10px 12px; min-width: 0; }
.rl-col + .rl-col { border-left: 1px solid var(--border); }
.rl-col-label { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font: 500 10.5px/1.2 var(--font-mono); color: var(--muted-foreground); }
.rl-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13.5px; line-height: 1.6; }
.rl-text-empty { color: var(--muted-foreground); font-style: italic; font-size: 12.5px; }
.rl-inline { padding: 10px 12px; }
.rl-collapse { width: 100%; border: 0; border-bottom: 0; background: transparent; color: var(--muted-foreground); font: inherit; font-size: 11.5px; font-weight: 500; text-align: left; cursor: pointer; border-radius: var(--radius-md); }
.rl-collapse:hover { background: var(--muted); color: var(--foreground); }
.rl-collapse:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; }
.section-block.rl-open > .rl-collapse { border-bottom: 1px solid var(--border); border-radius: var(--radius-md) var(--radius-md) 0 0; }
.rl-sec-meta { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; font-variant-numeric: tabular-nums; }
.rl-plus { color: var(--diff-add-fg); }
.rl-minus { color: var(--diff-del-fg); }
.rl-summary { align-items: center; padding-top: 8px; padding-bottom: 8px; }
.rl-summary-text { font-weight: 600; font-size: 13px; font-variant-numeric: tabular-nums; }
.rl-meter { width: 88px; }
.rl-row { cursor: default; }
.rl-row.rl-verified { border-color: color-mix(in oklch, var(--st-approved) 55%, var(--border)); }
.rl-verified-note { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; color: var(--st-approved); }
.rl-group-title { font-size: 11.5px; font-weight: 600; color: var(--muted-foreground); text-transform: uppercase; letter-spacing: 0.04em; margin: 4px 0 2px; }
.rl-asked { font-size: 12px; color: var(--muted-foreground); }
.rl-mini { padding: 12px; min-height: 132px; display: flex; flex-direction: column; gap: 6px; font-size: 12px; line-height: 1.35; }
.rl-mini-head { font-weight: 700; font-size: 15px; line-height: 1.2; }
.rl-mini-cta { align-self: flex-start; padding: 3px 8px; border-radius: var(--radius-sm); font-weight: 600; font-size: 11.5px; }
.rl-mini-foot { margin-top: auto; font-size: 10px; opacity: 0.8; }
.rl-cr-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.rl-cr-num { font: 600 11px/1 var(--font-mono); color: var(--muted-foreground); min-width: 14px; }
.rl-details > summary { cursor: pointer; font-size: 12.5px; color: var(--muted-foreground); padding: 2px 0; }
.rl-details > summary:hover { color: var(--foreground); }
.rl-details[open] > summary { margin-bottom: 6px; }
.rl-watch { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
@media (max-width: 860px) {
  .rl-sbs { grid-template-columns: minmax(0, 1fr); }
  .rl-col + .rl-col { border-left: 0; border-top: 1px dashed var(--border); }
}
`;
  try {
    if (!document.querySelector('style[data-module="review-loop.js"]')) {
      var styleEl = document.createElement('style');
      styleEl.setAttribute('data-module', 'review-loop.js');
      styleEl.textContent = CSS;
      document.head.appendChild(styleEl);
    }
  } catch (e) { /* styles are cosmetic */ }

  /* ------------------------------------------------------------------ */
  /* Screen-local state (memory only)                                    */
  /* ------------------------------------------------------------------ */
  function freshState() {
    return {
      mode: 'sbs',          // 'sbs' | 'inline'
      pairs: {},            // assetId -> { left, right } version ids
      showUnchanged: false,
      expanded: {},         // assetId:sectionId -> true
      active: {},           // assetId -> recheck row key
      hunk: {},             // assetId -> index of last visited changed section
      keepAsVersion: {},    // versionId -> true (low-overlap warning dismissed)
      drafts: {},           // assetId -> change request draft
      pendingScroll: null
    };
  }
  var st = freshState();
  var diffCache = {};
  var seq = 0;
  A.on('reset', function () { st = freshState(); diffCache = {}; });

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */
  function S() { return A.state; }
  function sevLabel(s) { var L = A.labels.SEVERITY[s]; return L ? L.label : (s || ''); }
  function ruleOf(f) { return f ? A.ruleById(f.ruleId) : null; }
  function ruleTitle(f) { var r = ruleOf(f); return r ? r.title : (f ? f.ruleId : ''); }
  function findingTitle(f) { return (f && f.title) || ruleTitle(f); }
  function firstCite(ruleId) {
    var r = A.ruleById(ruleId);
    if (!r || !r.referenceIds || !r.referenceIds.length) return '';
    var ref = A.referenceById(r.referenceIds[0]);
    return ref ? ref.citation : '';
  }
  function safeId(s) { return String(s == null ? '' : s).replace(/[^A-Za-z0-9_-]/g, '_'); }
  function srcMeta(provider) { return A.labels.SOURCES[provider] || { label: provider || 'Source', icon: 'plug', group: 'direct' }; }
  function isMailProvider(p) { return p === 'gmail' || p === 'outlook'; }
  function isLive(src) { return !!src && (src.status === 'connected' || src.status === 'syncing' || src.status === 'resyncing-gap'); }
  function findingIn(v, id) { return id && v ? (v.findings || []).find(function (f) { return f.id === id; }) || null : null; }
  function sectionLabel(v, sid) {
    var s = v && v.content && (v.content.sections || []).find(function (x) { return x.id === sid; });
    return s ? (s.label || s.id) : '';
  }
  function reduceMotion() {
    try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  function scrollToEl(el) {
    if (!el) return;
    try { el.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' }); } catch (e) { el.scrollIntoView(); }
    el.classList.remove('flash');
    void el.offsetWidth; // restart the one-shot highlight
    el.classList.add('flash');
  }
  function openCr(a, versionId) {
    var list = (a.changeRequests || []).filter(function (c) { return c.status === 'open' && (!versionId || c.versionId === versionId); });
    return list.length ? list[list.length - 1] : null;
  }
  function latestCr(a) { var l = a.changeRequests || []; return l.length ? l[l.length - 1] : null; }
  function pendingMatch(a) {
    return (S().intake || []).find(function (i) { return i.profileId === a.profileId && i.status === 'pending' && i.newVersionOf === a.id; }) || null;
  }
  // The source a revision would come back through: the newest mail or file reference on the asset.
  function primarySource(a) {
    var refs = (a.sourceRefs || []).slice().reverse();
    for (var i = 0; i < refs.length; i++) {
      var s = A.sourceById(refs[i].sourceId);
      if (s && s.provider !== 'upload') return { ref: refs[i], source: s };
    }
    return null;
  }
  function liveSource(profileId, provider) {
    return (S().sources || []).find(function (s) { return s.profileId === profileId && s.provider === provider && isLive(s); }) || null;
  }
  function stripLinks(s) {
    var removed = 0;
    var out = String(s || '').replace(/\b(?:https?:\/\/|www\.)[^\s)]+/gi, function () { removed += 1; return '[link removed]'; });
    return { text: out, removed: removed };
  }
  function safeColor(c) { return /^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : ''; }

  /* ------------------------------------------------------------------ */
  /* Word diff (LCS over word tokens)                                    */
  /* ------------------------------------------------------------------ */
  var TOKEN_RE = /\s+|\$?\d+(?:[.,]\d+)*%?|[A-Za-z0-9À-ɏ'’]+|[^\s]/g;
  function tokenize(s) {
    var out = [], m;
    s = String(s || '');
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(s)) !== null) {
      if (!m[0].length) { TOKEN_RE.lastIndex += 1; continue; }
      var ws = /^\s+$/.test(m[0]);
      out.push({ t: m[0], k: ws ? ' ' : m[0], s: m.index, e: m.index + m[0].length, ws: ws });
    }
    return out;
  }
  function lcsOps(a, b) {
    var n = a.length, m = b.length, ops = [], i, j;
    var pre = 0;
    while (pre < n && pre < m && a[pre].k === b[pre].k) pre++;
    var suf = 0;
    while (suf < n - pre && suf < m - pre && a[n - 1 - suf].k === b[m - 1 - suf].k) suf++;
    for (i = 0; i < pre; i++) ops.push({ op: 'eq', a: a[i], b: b[i] });
    var a2 = a.slice(pre, n - suf), b2 = b.slice(pre, m - suf);
    var N = a2.length, M = b2.length;
    if (N * M > 400000) {
      a2.forEach(function (t) { ops.push({ op: 'del', a: t }); });
      b2.forEach(function (t) { ops.push({ op: 'add', b: t }); });
    } else if (N || M) {
      var W = M + 1, dp = new Uint32Array((N + 1) * W);
      for (i = N - 1; i >= 0; i--) {
        for (j = M - 1; j >= 0; j--) {
          dp[i * W + j] = a2[i].k === b2[j].k ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
        }
      }
      i = 0; j = 0;
      while (i < N && j < M) {
        if (a2[i].k === b2[j].k) { ops.push({ op: 'eq', a: a2[i], b: b2[j] }); i++; j++; }
        else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) { ops.push({ op: 'del', a: a2[i] }); i++; }
        else { ops.push({ op: 'add', b: b2[j] }); j++; }
      }
      while (i < N) ops.push({ op: 'del', a: a2[i++] });
      while (j < M) ops.push({ op: 'add', b: b2[j++] });
    }
    for (i = suf; i > 0; i--) ops.push({ op: 'eq', a: a[n - i], b: b[m - i] });
    // A lone space between two changes reads better as part of the change.
    var out = [];
    for (i = 0; i < ops.length; i++) {
      var o = ops[i], prev = out.length ? out[out.length - 1] : null, next = ops[i + 1];
      if (o.op === 'eq' && o.a.ws && prev && prev.op !== 'eq' && next && next.op !== 'eq') {
        out.push({ op: 'del', a: o.a }); out.push({ op: 'add', b: o.b });
      } else out.push(o);
    }
    return out;
  }
  // Hunks: eq runs and change runs. Inside a change run, removed tokens are contiguous in A and added tokens contiguous in B.
  function diffText(aText, bText) {
    var key = aText.length + ':' + bText.length + ':' + aText + '\u0000' + bText;
    if (diffCache[key]) return diffCache[key];
    var ta = tokenize(aText), tb = tokenize(bText);
    var ops = lcsOps(ta, tb);
    var hunks = [], cur = null, added = 0, removed = 0, same = 0;
    ops.forEach(function (o) {
      if (o.op === 'eq') {
        if (!o.a.ws) same += 1;
        if (cur && cur.type === 'eq') { cur.aE = o.a.e; cur.bE = o.b.e; }
        else { cur = { type: 'eq', aS: o.a.s, aE: o.a.e, bS: o.b.s, bE: o.b.e }; hunks.push(cur); }
        return;
      }
      if (!cur || cur.type !== 'chg') { cur = { type: 'chg', del: null, add: null }; hunks.push(cur); }
      if (o.op === 'del') {
        if (!o.a.ws) removed += 1;
        if (!cur.del) cur.del = { s: o.a.s, e: o.a.e }; else cur.del.e = o.a.e;
      } else {
        if (!o.b.ws) added += 1;
        if (!cur.add) cur.add = { s: o.b.s, e: o.b.e }; else cur.add.e = o.b.e;
      }
    });
    var res = {
      hunks: hunks, added: added, removed: removed, same: same,
      aWords: ta.filter(function (t) { return !t.ws; }).length, bWords: tb.filter(function (t) { return !t.ws; }).length,
      changed: aText !== bText
    };
    diffCache[key] = res;
    return res;
  }
  function rangesFor(d, side) {
    var out = [];
    d.hunks.forEach(function (h) {
      if (h.type !== 'chg') return;
      var r = side === 'a' ? h.del : h.add;
      if (r) out.push({ s: r.s, e: r.e });
    });
    return out;
  }
  function paintRanges(text, s, e, ranges, cls) {
    var out = '', p = s;
    ranges.forEach(function (r) {
      var rs = Math.max(r.s, s), re = Math.min(r.e, e);
      if (re <= rs) return;
      if (rs > p) out += esc(text.slice(p, rs));
      out += '<span class="' + cls + '">' + esc(text.slice(rs, re)) + '</span>';
      p = re;
    });
    if (p < e) out += esc(text.slice(p, e));
    return out;
  }
  // One column: evidence marks (outer) with diff spans (inner).
  function paintSide(text, ranges, cls, marks) {
    var chunks = [], pos = 0;
    (marks || []).forEach(function (m) {
      if (m.s < pos) return; // overlapping quote: skip the later one
      if (m.s > pos) chunks.push({ s: pos, e: m.s });
      chunks.push({ s: m.s, e: m.e, mark: m });
      pos = m.e;
    });
    if (pos < text.length) chunks.push({ s: pos, e: text.length });
    return chunks.map(function (c) {
      var inner = paintRanges(text, c.s, c.e, ranges, cls);
      if (!c.mark) return inner;
      var m = c.mark;
      return '<span class="hl hl-' + esc(m.sev) + (m.active ? ' is-active' : '') + '" id="' + esc(m.id) + '" data-action="rl-row" data-asset-id="' + esc(m.assetId) +
        '" data-key="' + esc(m.key) + '" title="' + esc(m.title) + '">' + inner + '</span>';
    }).join('');
  }
  function paintInline(aText, bText, d) {
    return d.hunks.map(function (h) {
      if (h.type === 'eq') return esc(bText.slice(h.bS, h.bE));
      return (h.del ? '<del class="diff-del">' + esc(aText.slice(h.del.s, h.del.e)) + '</del>' : '') +
        (h.add ? '<ins class="diff-add">' + esc(bText.slice(h.add.s, h.add.e)) + '</ins>' : '');
    }).join('');
  }
  function findQuote(text, quote) {
    if (!quote || !text) return -1;
    var i = text.indexOf(quote);
    if (i >= 0) return i;
    var norm = function (s) { return String(s).toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"'); };
    return norm(text).indexOf(norm(quote));
  }

  /* ------------------------------------------------------------------ */
  /* Compare model                                                       */
  /* ------------------------------------------------------------------ */
  function sectionsOf(v) {
    var c = (v && v.content) || {};
    var list = (c.sections || []).map(function (s) { return { id: s.id, label: s.label || s.id, text: String(s.text || '') }; });
    if (c.subject && !list.some(function (s) { return /subject/i.test(s.label); })) list.unshift({ id: '__subject', label: 'Subject line', text: String(c.subject) });
    var hid = (c.hidden || []).map(function (h) { return h.text; }).filter(Boolean);
    if (hid.length) list.push({ id: '__hidden', label: 'Hidden text (not shown to readers)', text: hid.join('\n'), hidden: true });
    return list;
  }
  function pairSections(left, right) {
    var L = sectionsOf(left), R = sectionsOf(right), used = {};
    var pairs = R.map(function (r) { return { id: r.id, label: r.label, a: null, b: r, hidden: !!r.hidden }; });
    pairs.forEach(function (p) { var m = L.find(function (l) { return l.id === p.id; }); if (m) { p.a = m; used[m.id] = true; } });
    pairs.forEach(function (p) {
      if (p.a) return;
      var m = L.find(function (l) { return !used[l.id] && l.label === p.label; });
      if (m) { p.a = m; used[m.id] = true; }
    });
    L.forEach(function (l, i) {
      if (used[l.id]) return;
      var pos = 0;
      for (var k = i - 1; k >= 0; k--) {
        var idx = pairs.findIndex(function (p) { return p.a && p.a.id === L[k].id; });
        if (idx >= 0) { pos = idx + 1; break; }
      }
      pairs.splice(pos, 0, { id: l.id, label: l.label, a: l, b: null, hidden: !!l.hidden });
      used[l.id] = true;
    });
    return pairs;
  }
  function buildCompare(left, right) {
    var pairs = pairSections(left, right);
    var tot = { added: 0, removed: 0, same: 0, aWords: 0, bWords: 0, changed: 0 };
    pairs.forEach(function (p) {
      var at = p.a ? p.a.text : '', bt = p.b ? p.b.text : '';
      var d = diffText(at, bt);
      p.diff = d;
      p.state = !p.a ? 'added' : (!p.b ? 'removed' : (d.changed ? 'changed' : 'unchanged'));
      tot.added += d.added; tot.removed += d.removed; tot.same += d.same; tot.aWords += d.aWords; tot.bWords += d.bWords;
      if (p.state !== 'unchanged') tot.changed += 1;
    });
    tot.overlap = (tot.aWords + tot.bWords) ? (2 * tot.same) / (tot.aWords + tot.bWords) : 1;
    return { pairs: pairs, tot: tot };
  }
  // Trace each earlier finding from the left version through to the right version via carriedFrom.
  function recheckRows(a, left, right) {
    var steps = a.versions.filter(function (v) { return v.n > left.n && v.n <= right.n; }).sort(function (x, y) { return x.n - y.n; });
    var cr = (a.changeRequests || []).filter(function (c) { return c.versionId === left.id; }).pop() || null;
    var rows = [], coveredRight = {};
    (left.findings || []).forEach(function (lf) {
      if (lf.recheck === 'resolved') return; // resolved before this left version
      var cur = lf, hit = null, label = null;
      for (var i = 0; i < steps.length; i++) {
        var curId = cur.id;
        var nf = (steps[i].findings || []).find(function (x) { return x.carriedFrom === curId; });
        if (!nf) { label = hit && hit.recheck === 'resolved' ? 'resolved' : 'outdated'; break; }
        hit = nf; cur = nf;
      }
      if (!label) label = !hit ? 'outdated' : (hit.recheck === 'resolved' || hit.recheck === 'outdated' ? hit.recheck : 'still-present');
      var rf = hit && (right.findings || []).indexOf(hit) >= 0 ? hit : null;
      if (rf) coveredRight[rf.id] = true;
      var crIdx = cr ? cr.items.findIndex(function (it) { return it.findingId === lf.id; }) : -1;
      rows.push({ key: lf.id, kind: 'earlier', label: label, lf: lf, rf: rf, f: rf || lf, cr: cr, crIdx: crIdx, crItem: crIdx >= 0 ? cr.items[crIdx] : null });
    });
    (right.findings || []).forEach(function (rf) {
      if (coveredRight[rf.id] || rf.recheck === 'resolved') return;
      rows.push({ key: rf.id, kind: 'new', label: 'new', lf: null, rf: rf, f: rf, cr: null, crIdx: -1, crItem: null });
    });
    var counts = { resolved: 0, 'still-present': 0, 'new': 0, outdated: 0 };
    rows.forEach(function (r) { counts[r.label] = (counts[r.label] || 0) + 1; });
    return { rows: rows, counts: counts, cr: cr };
  }
  function getVer(a, right, key) {
    var m = a.recheckVerified && a.recheckVerified[right.id];
    return m ? m[key] || null : null;
  }
  function setVer(a, right, key, on) {
    if (!a.recheckVerified) a.recheckVerified = {};
    if (!a.recheckVerified[right.id]) a.recheckVerified[right.id] = {};
    if (on) a.recheckVerified[right.id][key] = { by: A.me().id, at: A.nowIso() };
    else delete a.recheckVerified[right.id][key];
  }
  function pairFor(a) {
    var sorted = a.versions.slice().sort(function (x, y) { return x.n - y.n; });
    var p = st.pairs[a.id];
    var right = p && A.version(a, p.right);
    var left = p && A.version(a, p.left);
    if (!right) right = A.latestVersion(a);
    if (!left || left.n >= right.n) {
      left = null;
      sorted.forEach(function (v) { if (v.n < right.n) left = v; });
    }
    return { left: left, right: right, sorted: sorted };
  }

  /* ------------------------------------------------------------------ */
  /* Compare screen                                                      */
  /* ------------------------------------------------------------------ */
  var COUNT_WORD = { resolved: 'resolved', 'still-present': 'still present', 'new': 'new', outdated: 'outdated' };
  function countBadge(k, n) {
    var r = A.labels.RECHECK[k];
    return '<span class="badge rc rc-' + k + '">' + A.icon(r ? r.icon : 'circle') + '<span>' + n + ' ' + esc(COUNT_WORD[k]) + '</span></span>';
  }
  function summaryText(c) {
    var parts = [c.resolved + ' resolved', c['still-present'] + ' still present', c['new'] + ' new'];
    if (c.outdated) parts.push(c.outdated + ' outdated');
    return parts.join(' · ');
  }
  function versionMeta(v) {
    return '<span class="row row-tight row-wrap small muted"><span class="strong" style="color:var(--foreground)">V' + v.n + '</span>' + ui.sha(v.sha) +
      '<span>' + esc(A.labels.ORIGIN[v.origin] || v.origin || '') + '</span><span>·</span><span>' + esc(ui.time(v.createdAt)) + '</span>' +
      (v.authorName ? '<span>·</span><span class="truncate">' + esc(v.authorName) + '</span>' : '') + '</span>';
  }
  function miniCreative(v) {
    var vis = v && v.content && v.content.visual;
    if (!vis) return '<div class="rl-text-empty">No layout preview for V' + v.n + '.</div>';
    var pal = vis.palette || {};
    var bg = safeColor(pal.bg), fg = safeColor(pal.fg), ac = safeColor(pal.accent);
    var style = (bg ? 'background:' + bg + ';' : '') + (fg ? 'color:' + fg + ';' : '');
    var ctaStyle = (ac ? 'background:' + ac + ';' : '') + (bg ? 'color:' + bg + ';' : '');
    return '<div class="creative rl-mini" style="' + esc(style) + '" role="img" aria-label="' + esc('Layout preview of V' + v.n + ': ' + [vis.headline, vis.subhead, vis.cta].filter(Boolean).join(', ')) + '">' +
      (vis.headline ? '<div class="rl-mini-head">' + esc(vis.headline) + '</div>' : '') +
      (vis.subhead ? '<div>' + esc(vis.subhead) + '</div>' : '') +
      (vis.cta ? '<div class="rl-mini-cta" style="' + esc(ctaStyle) + '">' + esc(vis.cta) + '</div>' : '') +
      (vis.footnote ? '<div class="rl-mini-foot">' + esc(vis.footnote) + '</div>' : '') +
      '</div>';
  }
  function hasVisual(v) { return !!(v && v.content && v.content.visual && (v.content.format === 'image' || v.content.format === 'pdf')); }

  function sectionMarks(a, side, pairText, sid, rows, activeKey) {
    var marks = [];
    rows.forEach(function (r) {
      var f = side === 'a' ? r.lf : (r.label !== 'resolved' ? r.rf : null);
      if (!f || !f.quote) return;
      if (f.sectionId && f.sectionId !== sid) {
        // quote anchored elsewhere; still mark it if the anchor section is missing and the quote is here
        return;
      }
      var i = findQuote(pairText, f.quote);
      if (i < 0) return;
      marks.push({
        s: i, e: i + f.quote.length, sev: f.severity || 'minor', id: 'rl-hl-' + side + '-' + safeId(f.id), key: r.key, assetId: a.id,
        active: r.key === activeKey, title: f.id + ': ' + findingTitle(f) + ' (' + COUNT_WORD[r.label] + ')'
      });
    });
    return marks.sort(function (x, y) { return x.s - y.s; });
  }

  function renderSection(a, p, left, right, rows, activeKey) {
    var expKey = a.id + ':' + p.id;
    var hasOpenHere = rows.some(function (r) { return r.rf && r.label !== 'resolved' && r.rf.sectionId === p.id; });
    var collapsed = p.state === 'unchanged' && !st.showUnchanged && !st.expanded[expKey] && !hasOpenHere;
    var stateTag = p.state === 'changed' ? ui.tag('Changed', { icon: 'edit' }) :
      p.state === 'added' ? ui.tag('Added in V' + right.n, { icon: 'plus' }) :
      p.state === 'removed' ? ui.tag('Removed in V' + right.n, { icon: 'minus' }) :
      '<span>Unchanged · reviewed in V' + left.n + '</span>';
    var counts = p.state === 'unchanged' ? '' :
      '<span class="rl-sec-meta xs"><span class="rl-plus" aria-label="' + p.diff.added + ' words added">+' + p.diff.added + '</span><span class="rl-minus" aria-label="' + p.diff.removed + ' words removed">−' + p.diff.removed + '</span></span>';
    var headInner = '<span class="strong" style="color:var(--foreground)">' + esc(p.label) + '</span>' + stateTag + counts;
    var head = p.state === 'unchanged' ?
      '<button type="button" class="section-block-head rl-collapse" data-action="rl-expand" data-asset-id="' + esc(a.id) + '" data-sid="' + esc(p.id) +
        '" aria-expanded="' + (!collapsed) + '"' + (collapsed ? '' : ' aria-controls="rl-secbody-' + safeId(p.id) + '"') + '>' +
        A.icon(collapsed ? 'chevron-right' : 'chevron-down') + headInner + '</button>' :
      '<div class="section-block-head">' + A.icon('edit') + headInner + '</div>';
    var cls = 'section-block' + (collapsed ? '' : ' rl-open') + (p.state !== 'unchanged' ? ' rl-hunk' : '');
    if (collapsed) return '<div class="' + cls + '" id="rl-sec-' + safeId(p.id) + '">' + head + '</div>';

    var at = p.a ? p.a.text : '', bt = p.b ? p.b.text : '';
    var body;
    var wrapHidden = function (html) { return p.hidden ? '<div class="inert-block">' + html + '</div>' : html; };
    if (st.mode === 'inline') {
      body = '<div class="section-block-body rl-inline" id="rl-secbody-' + safeId(p.id) + '"><div class="rl-text">' +
        wrapHidden(paintInline(at, bt, p.diff) || '<span class="rl-text-empty">Empty</span>') + '</div></div>';
    } else {
      var aMarks = p.hidden ? [] : sectionMarks(a, 'a', at, p.a ? p.a.id : p.id, rows, activeKey);
      var bMarks = p.hidden ? [] : sectionMarks(a, 'b', bt, p.b ? p.b.id : p.id, rows, activeKey);
      var colA = p.a ? wrapHidden(paintSide(at, rangesFor(p.diff, 'a'), 'diff-del', aMarks)) : '<span class="rl-text-empty">Not in V' + left.n + '</span>';
      var colB = p.b ? wrapHidden(paintSide(bt, rangesFor(p.diff, 'b'), 'diff-add', bMarks)) : '<span class="rl-text-empty">Removed in V' + right.n + '</span>';
      body = '<div class="section-block-body rl-sbs" id="rl-secbody-' + safeId(p.id) + '">' +
        '<div class="rl-col"><div class="rl-col-label">V' + left.n + ' · earlier</div><div class="rl-text">' + colA + '</div></div>' +
        '<div class="rl-col"><div class="rl-col-label">V' + right.n + (right.id === a.latestVersionId ? ' · latest' : '') + '</div><div class="rl-text">' + colB + '</div></div>' +
        '</div>';
    }
    var note = p.hidden ? '<div class="xs muted" style="padding:0 12px 10px">Shown as inert text. The checks treated it as data, never as instructions.</div>' : '';
    return '<div class="' + cls + '" id="rl-sec-' + safeId(p.id) + '">' + head + body + note + '</div>';
  }

  function rowExplain(r, left, right) {
    var f = r.f;
    if (r.label === 'resolved') {
      if (r.rf && r.rf.recheckNote) return r.rf.recheckNote;
      if (r.rf && /^resolved/i.test(r.rf.explanation || '')) return r.rf.explanation;
      return 'The quoted text no longer appears in V' + right.n + '.';
    }
    if (r.label === 'still-present') {
      if (r.rf && /^still present/i.test(r.rf.explanation || '')) return r.rf.explanation;
      return 'The quoted text still appears in ' + (sectionLabel(right, f.sectionId) || 'V' + right.n) + '.';
    }
    if (r.label === 'outdated') return 'The quote could not be found in V' + right.n + ' and no matching finding was carried forward. Check this item by hand.';
    return f.explanation || '';
  }

  function renderRow(a, r, left, right, activeKey) {
    var f = r.f, ver = getVer(a, right, r.key);
    var where = r.label === 'resolved' || r.label === 'outdated' ?
      (r.lf && r.lf.sectionId ? 'Was in ' + sectionLabel(left, r.lf.sectionId) + ' (V' + left.n + ')' : '') :
      (f.sectionId ? 'In ' + sectionLabel(right, f.sectionId) + ' (V' + right.n + ')' : '');
    var quote = (r.label === 'new' ? f.quote : (r.lf ? r.lf.quote : f.quote)) || '';
    var verifyBtn = ui.button(ver ? 'Verified' : 'Mark verified', {
      action: 'rl-verify', data: { assetId: a.id, key: r.key }, size: 'sm', variant: ver ? 'secondary' : 'outline', icon: ver ? 'circle-check' : 'check',
      pressed: !!ver, title: ver ? 'Click to undo' : 'Confirm you checked this item', kbd: r.key === activeKey ? 'V' : null
    });
    var showBtn = ui.button('Show in text', { action: 'rl-show', data: { assetId: a.id, key: r.key }, size: 'sm', variant: 'ghost', icon: 'eye' });
    var verBy = ver ? A.userById(ver.by) : null;
    return '<div class="finding rl-row' + (r.key === activeKey ? ' is-active' : '') + (ver ? ' rl-verified' : '') + (r.label === 'resolved' ? ' is-resolved' : '') +
      '" id="rl-row-' + safeId(r.key) + '">' +
      '<div class="finding-head">' + ui.recheckBadge(r.label) + ui.severityBadge(f.severity) +
        '<span class="finding-cite">' + esc(f.id) + '</span>' +
        (r.rf && r.label !== 'resolved' ? ui.dispositionBadge(r.rf.disposition) : '') + '</div>' +
      '<div class="finding-rule">' + esc(findingTitle(f).replace(/^New:\s*/, '')) + '</div>' +
      '<div class="finding-cite">' + esc(f.ruleId + (f.ruleVersion ? ' v' + f.ruleVersion : '') + (firstCite(f.ruleId) ? ' · ' + firstCite(f.ruleId) : '')) + '</div>' +
      (quote ? '<div class="quote' + (r.label === 'resolved' ? ' muted' : '') + '">“' + esc(quote) + '”</div>' : '') +
      (where ? '<div class="xs muted">' + esc(where) + '</div>' : '') +
      '<div class="small">' + esc(rowExplain(r, left, right)) + '</div>' +
      (r.label === 'new' && f.evidenceType ? '<div class="row row-wrap">' + ui.evidenceBadge(f.evidenceType) + '</div>' : '') +
      (r.crItem ? '<div class="rl-asked clamp-2" title="' + esc(r.crItem.text) + '">Asked in ' + esc(r.cr.id) + ' item ' + (r.crIdx + 1) + ': ' + esc(r.crItem.text) + '</div>' : '') +
      (r.label === 'new' && f.suggestedFix ? '<div class="small"><span class="muted">Required fix: </span>' + esc(f.suggestedFix) + '</div>' : '') +
      '<div class="finding-actions">' + verifyBtn + showBtn +
        (ver ? '<span class="rl-verified-note">' + A.icon('check') + 'by ' + esc(verBy ? verBy.name : 'a member') + ' · ' + esc(ui.relTime(ver.at)) + '</span>' : '') +
      '</div>' +
      '</div>';
  }

  function renderSingleVersion(a) {
    var v = A.latestVersion(a);
    return '<div class="pane-body"><div class="page page-narrow">' +
      '<div class="page-header"><div class="page-heading">' +
        '<div class="page-eyebrow"><a href="#queue">Queue</a>' + A.icon('chevron-right') + '<a href="#asset-' + esc(a.id) + '">' + esc(a.id) + '</a>' + A.icon('chevron-right') + '<span>Compare versions</span></div>' +
        '<h1 class="page-title">' + esc(a.title) + '</h1></div>' +
        '<div class="page-actions">' + ui.button('Open in workbench', { href: '#asset-' + a.id, variant: 'outline', icon: 'arrow-left' }) + '</div></div>' +
      '<div class="card"><div class="card-body">' +
        ui.empty('Only V' + (v ? v.n : 1) + ' so far', 'Compare opens when a revision arrives. Revisions come back the way the asset arrived: a reply on the original email thread or an update to the same file in a connected source.') +
      '</div></div>' +
      renderWaitingCallout(a) +
      '</div></div>';
  }

  A.route('compare', function (param) {
    var a = A.asset(param);
    if (!a) return null;
    if (!a.versions || a.versions.length < 2) return renderSingleVersion(a);
    var pr = pairFor(a), left = pr.left, right = pr.right;
    if (!left || !right) return renderSingleVersion(a);

    var model = buildCompare(left, right);
    var rc = recheckRows(a, left, right);
    var rows = rc.rows, counts = rc.counts;
    var activeKey = st.active[a.id];
    if (activeKey && !rows.some(function (r) { return r.key === activeKey; })) activeKey = null;
    var verifiedCount = rows.filter(function (r) { return getVer(a, right, r.key); }).length;
    var latest = A.latestVersion(a);
    var isLatest = right.id === latest.id;
    var approvedHere = a.approvedVersionId === right.id && (a.status === 'approved' || a.status === 'approved-with-exceptions');
    var partner = a.partnerId ? A.partnerById(a.partnerId) : null;
    var campaign = a.campaignId ? A.campaignById(a.campaignId) : null;

    // Version pickers
    var opts = pr.sorted.map(function (v) { return { value: v.id, label: ui.versionLabel(a, v) + ' · sha ' + v.sha }; });
    var pickers = '<div class="row row-tight">' +
      '<label class="sr-only" for="rl-left">Earlier version</label>' +
      ui.select('rl-left', opts.filter(function (o) { var v = A.version(a, o.value); return v.n < pr.sorted[pr.sorted.length - 1].n; }), left.id, { change: 'rl-pick', data: { assetId: a.id }, size: 'sm' }) +
      A.icon('arrow-right') +
      '<label class="sr-only" for="rl-right">Later version</label>' +
      ui.select('rl-right', opts.filter(function (o) { return A.version(a, o.value).n > pr.sorted[0].n; }), right.id, { change: 'rl-pick', data: { assetId: a.id }, size: 'sm' }) +
      '</div>';
    var seg = '<div class="seg" role="group" aria-label="Diff view">' +
      '<button type="button" data-action="rl-mode" data-mode="sbs" aria-pressed="' + (st.mode === 'sbs') + '">' + A.icon('split') + 'Side by side</button>' +
      '<button type="button" data-action="rl-mode" data-mode="inline" aria-pressed="' + (st.mode === 'inline') + '">' + A.icon('file-text') + 'Inline word diff</button>' +
      '</div>';
    var decideLabel = approvedHere ? 'Open V' + right.n + ' in workbench' : (isLatest ? 'Decide on V' + right.n : 'Open V' + latest.n + ' (latest)');
    var decideBtn = ui.button(decideLabel, { action: 'rl-decide', data: { assetId: a.id }, variant: 'default', icon: approvedHere ? 'arrow-right' : 'clipboard-check', kbd: 'D' });

    var header = '<div class="fill-header">' +
      '<div class="page-heading grow" style="min-width:0;flex:1 1 320px">' +
        '<div class="page-eyebrow"><a href="#queue">Queue</a>' + A.icon('chevron-right') + '<a href="#asset-' + esc(a.id) + '">' + esc(a.id) + '</a>' + A.icon('chevron-right') + '<span>Compare V' + left.n + ' → V' + right.n + '</span></div>' +
        '<div class="row row-wrap"><h1 class="page-title truncate" style="min-width:0">' + esc(a.title) + '</h1>' + ui.statusBadge(a.status, a.subLabel) + '</div>' +
        '<div class="row row-wrap small muted">' +
          '<span>' + esc(a.submitter ? a.submitter.name : '') + (partner ? ' (' + esc(partner.type) + ')' : '') + '</span>' +
          (campaign ? '<span>·</span><span>' + A.icon('tag') + ' ' + esc(campaign.name) + '</span>' : '') +
          '<span>·</span>' + versionMeta(left) + A.icon('arrow-right') + versionMeta(right) +
        '</div>' +
      '</div>' +
      '<div class="page-actions">' + pickers + seg + decideBtn + '</div>' +
      '</div>';

    var overlapPct = Math.round(model.tot.overlap * 100);
    var summary = '<div class="fill-header rl-summary">' +
      '<div class="row row-wrap grow" style="flex:1 1 360px">' +
        '<span class="rl-summary-text">' + esc(summaryText(counts)) + '</span>' +
        countBadge('resolved', counts.resolved) + countBadge('still-present', counts['still-present']) + countBadge('new', counts['new']) +
        (counts.outdated ? countBadge('outdated', counts.outdated) : '') +
        '<span class="small muted">Verified ' + verifiedCount + ' of ' + rows.length + '</span>' +
        '<span class="rl-meter">' + ui.meter(verifiedCount, rows.length || 1, { label: 'Recheck items verified', auto: false, tone: verifiedCount === rows.length && rows.length ? 'is-ok' : '' }) + '</span>' +
      '</div>' +
      '<div class="row row-wrap">' +
        '<span class="diff-legend"><span class="diff-add">added</span><span class="diff-del">removed</span></span>' +
        '<span class="small muted num">+' + model.tot.added + ' / −' + model.tot.removed + ' words · ' + model.tot.changed + ' of ' + model.pairs.length + ' sections changed · ' + overlapPct + '% text overlap</span>' +
        ui.button(st.showUnchanged ? 'Collapse unchanged' : 'Show unchanged', { action: 'rl-unchanged', size: 'sm', variant: 'ghost', icon: st.showUnchanged ? 'eye-off' : 'eye', pressed: st.showUnchanged }) +
      '</div>' +
      '</div>';

    // Notices at the top of the diff pane
    var notes = [];
    var bothWordy = model.tot.aWords >= 8 && model.tot.bWords >= 8;
    if (bothWordy && model.tot.overlap < 0.35 && !st.keepAsVersion[right.id]) {
      notes.push(ui.callout('warning', 'This looks like a different asset', 'Only ' + overlapPct + '% of the text matches V' + left.n + '. If the submitter sent a new piece instead of a revision, split it into its own asset from Triage.',
        { actionsHtml: ui.button('Keep as V' + right.n, { action: 'rl-keep-version', data: { versionId: right.id }, size: 'sm', variant: 'outline' }) +
          ui.button('Open Triage', { href: '#intake-triage', size: 'sm', variant: 'ghost', icon: 'inbox' }) }));
    }
    var hiddenAlerts = (right.securityAlerts || []).filter(function (s) { return s.kind !== 'possible-injection'; });
    if (hiddenAlerts.length) {
      var unacked = hiddenAlerts.some(function (s) { return !s.acknowledged; });
      notes.push(ui.callout('security', 'Security alert carried into V' + right.n, esc('Hidden text is still present in this version. ' + (unacked ? 'Acknowledge it in the workbench before deciding.' : 'It was acknowledged.')),
        { actionsHtml: ui.button('Open workbench', { href: '#asset-' + a.id, size: 'sm', variant: 'outline', icon: 'shield-alert' }) }));
    } else if ((right.securityAlerts || []).length) {
      notes.push(ui.callout('warning', 'Possible injection text still present', 'Visible text addressed to AI systems is still in V' + right.n + '. The checks treated it as content.'));
    }
    if (a.approvedVersionId && a.approvedVersionId !== right.id) {
      var av = A.version(a, a.approvedVersionId);
      if (av) notes.push(ui.callout('info', 'V' + av.n + ' is the approved version', 'It stays approved and live. V' + right.n + ' is not approved until someone decides on it.', { icon: 'lock' }));
    }
    if (!isLatest) {
      notes.push(ui.callout('neutral', 'You are comparing earlier versions', 'V' + latest.n + ' is the latest version.',
        { actionsHtml: ui.button('Compare V' + (latest.n - 1) + ' → V' + latest.n, { action: 'rl-latest-pair', data: { assetId: a.id }, size: 'sm', variant: 'outline', icon: 'git-compare' }) }));
    }
    if (right.run && right.run.status === 'failed') {
      notes.push(ui.callout('warning', 'AI re-run did not complete', esc(right.run.failReason || 'The deterministic recheck ran; the AI pass did not.') + ' New issues may be missing from this list.'));
    }
    if (!model.tot.changed) {
      notes.push(ui.callout('neutral', 'No text changes', hasVisual(right) ? 'Text diff unavailable for images and layout; compare visually below.' : 'V' + right.n + ' has the same text as V' + left.n + '. The file may have been re-exported.'));
    }

    var visualBlock = '';
    if (hasVisual(left) || hasVisual(right)) {
      var sameVisual = JSON.stringify((left.content || {}).visual || null) === JSON.stringify((right.content || {}).visual || null);
      visualBlock = '<div class="section-block">' +
        '<div class="section-block-head">' + A.icon('image') + '<span class="strong" style="color:var(--foreground)">Layout</span>' +
          (!sameVisual ? ui.tag('Changed', { icon: 'edit' }) :
            (model.tot.changed ? '<span>Layout fields were not re-extracted for V' + right.n + '; open both files to compare</span>' : '<span>No layout change detected</span>')) +
          '<span class="rl-sec-meta xs">Compare visually; the text below is extracted (OCR)</span></div>' +
        '<div class="section-block-body rl-sbs">' +
          '<div class="rl-col"><div class="rl-col-label">V' + left.n + '</div>' + miniCreative(left) + '</div>' +
          '<div class="rl-col"><div class="rl-col-label">V' + right.n + '</div>' + miniCreative(right) + '</div>' +
        '</div></div>';
    }

    var sectionsHtml = model.pairs.map(function (p) { return renderSection(a, p, left, right, rows, activeKey); }).join('');
    var diffPane = '<section class="pane" aria-label="Changes between V' + left.n + ' and V' + right.n + '">' +
      '<div class="pane-header"><span class="pane-title">' + A.icon('git-compare') + (st.mode === 'inline' ? 'Inline word diff' : 'Side by side') + '</span>' +
        '<span class="spacer"></span>' +
        ui.button('Previous change', { action: 'rl-hunk', data: { assetId: a.id, dir: '-1' }, size: 'sm', variant: 'ghost', icon: 'chevron-up', iconOnly: true, kbd: null, title: 'Previous changed section (P)' }) +
        ui.button('Next change', { action: 'rl-hunk', data: { assetId: a.id, dir: '1' }, size: 'sm', variant: 'ghost', icon: 'chevron-down', iconOnly: true, title: 'Next changed section (N)' }) +
      '</div>' +
      '<div class="pane-body" id="rl-diff-pane"><div class="stack">' + notes.join('') + visualBlock + '<div>' + sectionsHtml + '</div></div></div>' +
      '</section>';

    var earlier = rows.filter(function (r) { return r.kind === 'earlier'; });
    var fresh = rows.filter(function (r) { return r.kind === 'new'; });
    var unverifiedResolved = rows.filter(function (r) { return r.label === 'resolved' && !getVer(a, right, r.key); }).length;
    var crLine = rc.cr ? '<div class="row row-wrap small muted">' + A.icon('clipboard') + '<span>' + esc(rc.cr.id) + ' · ' + esc(A.plural(rc.cr.items.length, 'item')) + ' asked on V' + left.n + '</span>' +
      ui.button('View checklist', { action: 'rl-view-cr', data: { assetId: a.id, crId: rc.cr.id }, size: 'sm', variant: 'link' }) + '</div>' : '';
    var railBody = '<div class="stack">' + crLine +
      (earlier.length ? '<div class="rl-group-title">Earlier findings (V' + left.n + ')</div>' + earlier.map(function (r) { return renderRow(a, r, left, right, activeKey); }).join('') :
        '<div class="small muted">V' + left.n + ' had no open findings.</div>') +
      '<div class="rl-group-title">New in V' + right.n + '</div>' +
      (fresh.length ? fresh.map(function (r) { return renderRow(a, r, left, right, activeKey); }).join('') : '<div class="small muted">The recheck found no new issues in V' + right.n + '.</div>') +
      '</div>';
    var rail = '<aside class="pane pane-muted" aria-label="Recheck checklist">' +
      '<div class="pane-header"><span class="pane-title">' + A.icon('clipboard-check') + 'Recheck</span><span class="spacer"></span>' +
        (unverifiedResolved ? ui.button('Verify all resolved', { action: 'rl-verify-resolved', data: { assetId: a.id }, size: 'sm', variant: 'outline', icon: 'check' }) : '') + '</div>' +
      '<div class="pane-body" id="rl-rail">' + railBody + '</div>' +
      '<div class="pane-footer"><span class="small muted grow">' + (verifiedCount === rows.length && rows.length ? 'All items verified.' : 'Verify each item, then decide.') +
        ' ' + ui.kbd('J') + ui.kbd('K') + ' move · ' + ui.kbd('V') + ' verify</span>' +
        ui.button(isLatest && !approvedHere ? 'Decide on V' + right.n : 'Open in workbench', { action: 'rl-decide', data: { assetId: a.id }, size: 'sm', variant: 'outline', iconRight: 'arrow-right' }) +
      '</div>' +
      '</aside>';

    return header + summary + '<div class="split split-aside">' + diffPane + rail + '</div>';
  }, { nav: 'queue', layout: 'fill', title: function (param) { return 'Compare ' + param; } });

  /* Compare actions */
  function cmpAsset(el) { return A.asset((el && el.getAttribute('data-asset-id')) || A.current().param); }
  A.action('rl-mode', function (el) { st.mode = el.getAttribute('data-mode') === 'inline' ? 'inline' : 'sbs'; A.rerender(); });
  A.action('rl-unchanged', function () { st.showUnchanged = !st.showUnchanged; A.rerender(); });
  A.action('rl-expand', function (el) {
    var k = el.getAttribute('data-asset-id') + ':' + el.getAttribute('data-sid');
    st.expanded[k] = !st.expanded[k];
    A.rerender();
  });
  A.action('rl-pick', function (el) {
    var a = cmpAsset(el); if (!a) return;
    var l = document.getElementById('rl-left'), r = document.getElementById('rl-right');
    var lv = A.version(a, l ? l.value : null), rv = A.version(a, r ? r.value : null);
    if (!lv || !rv) return;
    if (lv.n >= rv.n) {
      if (el.id === 'rl-left') { rv = a.versions.filter(function (v) { return v.n > lv.n; }).sort(function (x, y) { return x.n - y.n; })[0] || rv; }
      else { lv = a.versions.filter(function (v) { return v.n < rv.n; }).sort(function (x, y) { return y.n - x.n; })[0] || lv; }
      A.toast('Showing V' + lv.n + ' → V' + rv.n + '. The earlier version always goes on the left.', 'info');
    }
    st.pairs[a.id] = { left: lv.id, right: rv.id };
    A.rerender();
  });
  A.action('rl-latest-pair', function (el) { var a = cmpAsset(el); if (!a) return; delete st.pairs[a.id]; A.rerender(); });
  A.action('rl-keep-version', function (el) {
    st.keepAsVersion[el.getAttribute('data-version-id')] = true;
    A.toast('Kept as a new version of this asset.', 'success');
    A.rerender();
  });
  A.action('rl-decide', function (el) { var a = cmpAsset(el); if (a) A.go('#asset-' + a.id); });
  A.action('rl-row', function (el) {
    var a = cmpAsset(el); if (!a) return;
    st.active[a.id] = el.getAttribute('data-key');
    st.pendingScroll = 'rl-row-' + safeId(st.active[a.id]);
    A.rerender();
  });

  function currentRows(a) {
    var pr = pairFor(a);
    if (!pr.left || !pr.right) return null;
    return { pr: pr, rc: recheckRows(a, pr.left, pr.right) };
  }
  function toggleVerify(a, key) {
    var cur = currentRows(a); if (!cur) return;
    var row = cur.rc.rows.find(function (r) { return r.key === key; });
    if (!row) return;
    var right = cur.pr.right;
    var was = !!getVer(a, right, key);
    setVer(a, right, key, !was);
    A.log(a.id, A.me().name, 'recheck', (was ? 'Cleared verification of ' : 'Verified ') + row.f.id + ' (' + COUNT_WORD[row.label] + ') on V' + right.n + ' against V' + cur.pr.left.n + '.');
    A.emit('data-changed', { kind: 'recheck-verify', assetId: a.id });
    A.rerender();
  }
  A.action('rl-verify', function (el) {
    var a = cmpAsset(el); if (!a) return;
    st.active[a.id] = el.getAttribute('data-key');
    toggleVerify(a, el.getAttribute('data-key'));
  });
  A.action('rl-verify-resolved', function (el) {
    var a = cmpAsset(el); if (!a) return;
    var cur = currentRows(a); if (!cur) return;
    var right = cur.pr.right;
    var todo = cur.rc.rows.filter(function (r) { return r.label === 'resolved' && !getVer(a, right, r.key); });
    if (!todo.length) return;
    todo.forEach(function (r) { setVer(a, right, r.key, true); });
    A.log(a.id, A.me().name, 'recheck', 'Verified ' + A.plural(todo.length, 'resolved item') + ' on V' + right.n + ': ' + todo.map(function (r) { return r.f.id; }).join(', ') + '.');
    A.emit('data-changed', { kind: 'recheck-verify', assetId: a.id });
    A.toast('Marked ' + A.plural(todo.length, 'resolved item') + ' verified.', 'success');
    A.rerender();
  });
  A.action('rl-show', function (el) {
    var a = cmpAsset(el); if (!a) return;
    var key = el.getAttribute('data-key');
    var cur = currentRows(a); if (!cur) return;
    var row = cur.rc.rows.find(function (r) { return r.key === key; });
    if (!row) return;
    st.active[a.id] = key;
    var useLeft = row.label === 'resolved' || row.label === 'outdated';
    var f = useLeft ? row.lf : row.rf;
    var sid = (f && f.sectionId) || (row.f && row.f.sectionId);
    if (sid) st.expanded[a.id + ':' + sid] = true;
    var target = f && st.mode === 'sbs' ? 'rl-hl-' + (useLeft ? 'a' : 'b') + '-' + safeId(f.id) : null;
    st.pendingScroll = [target, sid ? 'rl-sec-' + safeId(sid) : null];
    A.rerender();
  });
  A.action('rl-hunk', function (el) {
    var a = cmpAsset(el); if (!a) return;
    stepHunk(a, parseInt(el.getAttribute('data-dir'), 10) || 1);
  });
  function stepHunk(a, dir) {
    var els = Array.prototype.slice.call(document.querySelectorAll('#view .rl-hunk'));
    if (!els.length) { A.toast('No changed sections.', 'info'); return; }
    var i = st.hunk[a.id];
    i = i == null ? (dir > 0 ? 0 : els.length - 1) : (i + dir + els.length) % els.length;
    st.hunk[a.id] = i;
    scrollToEl(els[i]);
  }
  function moveActive(a, dir) {
    var cur = currentRows(a); if (!cur || !cur.rc.rows.length) return;
    var rows = cur.rc.rows;
    var idx = rows.findIndex(function (r) { return r.key === st.active[a.id]; });
    idx = idx < 0 ? (dir > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, idx + dir));
    st.active[a.id] = rows[idx].key;
    st.pendingScroll = 'rl-row-' + safeId(rows[idx].key);
    A.rerender();
  }
  A.on('rendered', function (r) {
    if (r.name !== 'compare' || !st.pendingScroll) return;
    var ids = [].concat(st.pendingScroll);
    st.pendingScroll = null;
    for (var i = 0; i < ids.length; i++) {
      var el = ids[i] && document.getElementById(ids[i]);
      if (el) { scrollToEl(el); break; }
    }
  });
  function keyAsset() { return A.asset(A.current().param); }
  A.key('compare', 'j', function () { var a = keyAsset(); if (a) moveActive(a, 1); }, 'Next recheck item');
  A.key('compare', 'k', function () { var a = keyAsset(); if (a) moveActive(a, -1); }, 'Previous recheck item');
  A.key('compare', 'v', function () {
    var a = keyAsset(); if (!a) return;
    if (!st.active[a.id]) { A.toast('Select an item first with J or K.', 'info'); return; }
    toggleVerify(a, st.active[a.id]);
  }, 'Mark the selected item verified');
  A.key('compare', 't', function () { st.mode = st.mode === 'inline' ? 'sbs' : 'inline'; A.rerender(); }, 'Switch side by side / inline diff');
  A.key('compare', 'u', function () { st.showUnchanged = !st.showUnchanged; A.rerender(); }, 'Show or hide unchanged sections');
  A.key('compare', 'n', function () { var a = keyAsset(); if (a) stepHunk(a, 1); }, 'Next changed section');
  A.key('compare', 'p', function () { var a = keyAsset(); if (a) stepHunk(a, -1); }, 'Previous changed section');
  A.key('compare', 'd', function () { var a = keyAsset(); if (a) A.go('#asset-' + a.id); }, 'Decide on the latest version');

  /* ------------------------------------------------------------------ */
  /* Request changes composer (in-app only)                              */
  /* ------------------------------------------------------------------ */
  function aiDraftFor(f) {
    var base = f.suggestedFix ? String(f.suggestedFix).trim() : 'Fix: ' + findingTitle(f) + '.';
    if (!/[.!?]$/.test(base)) base += '.';
    var cite = firstCite(f.ruleId);
    var cleaned = stripLinks(base + ' (' + f.ruleId + (cite ? ', ' + cite : '') + ')');
    return cleaned;
  }
  function newItemFromFinding(f) {
    var d = aiDraftFor(f);
    seq += 1;
    return { key: 'i' + seq, findingId: f.id, text: d.text, aiText: d.text, linksRemoved: d.removed, origin: 'ai', edited: false };
  }
  function buildDraft(a, v) {
    var existing = openCr(a, v.id);
    var items;
    if (existing) {
      items = existing.items.map(function (it) { seq += 1; return { key: 'i' + seq, findingId: it.findingId || null, text: it.text, origin: 'saved', fromCr: existing.id, edited: false }; });
    } else {
      items = (v.findings || []).filter(function (f) { return A.isOpenFinding(f) && f.disposition === 'fix-required'; }).map(newItemFromFinding);
    }
    return {
      assetId: a.id, versionId: v.id, items: items,
      note: existing ? (existing.note || '') : '', dueDate: existing ? (existing.dueDate || '') : '',
      editing: existing ? existing.id : null, restored: false
    };
  }
  function otherOpenFindings(v, d) {
    var inDraft = {};
    d.items.forEach(function (it) { if (it.findingId) inDraft[it.findingId] = true; });
    return (v.findings || []).filter(function (f) { return A.isOpenFinding(f) && !inDraft[f.id] && f.disposition !== 'accepted-exception'; });
  }
  function hiddenAlertAvailable(v, d) {
    var has = (v.securityAlerts || []).some(function (s) { return s.kind === 'hidden-text'; });
    return has && !d.items.some(function (it) { return it.origin === 'hidden'; });
  }
  function markerFor(d, it) {
    if (it.origin === 'ai' && !it.edited) {
      return ui.tag('AI draft · edit before saving', { icon: 'sparkles', cls: 'tag-ai', title: 'Drafted from the structured finding (rule, quote, required fix), never from the raw creative' });
    }
    if (it.origin === 'ai') {
      return ui.tag('Edited', { icon: 'edit' }) + ' ' + ui.button('Restore AI draft', { action: 'rl-cr-restore', data: { assetId: d.assetId, key: it.key }, size: 'sm', variant: 'link' });
    }
    if (it.origin === 'saved') return ui.tag(it.edited ? 'Edited' : 'Saved in ' + it.fromCr, { icon: it.edited ? 'edit' : 'history' });
    if (it.origin === 'hidden') return ui.tag('Security item', { icon: 'shield' });
    return ui.tag('Your item', { icon: 'user' });
  }
  function itemHtml(a, v, d, it, n) {
    var f = findingIn(v, it.findingId);
    var title = f ? findingTitle(f).replace(/^New:\s*/, '') : (it.origin === 'hidden' ? 'Hidden text in the creative' : 'Additional item');
    var cite = f ? f.ruleId + (f.ruleVersion ? ' v' + f.ruleVersion : '') + (firstCite(f.ruleId) ? ' · ' + firstCite(f.ruleId) : '') : '';
    var taId = 'rl-cr-text-' + it.key;
    return '<li class="card" id="rl-cr-item-' + esc(it.key) + '"><div class="card-body stack">' +
      '<div class="row row-wrap"><span class="rl-cr-num">' + n + '.</span>' + (f ? ui.severityBadge(f.severity) : '') +
        '<span class="finding-rule">' + esc(title) + '</span>' + (cite ? '<span class="finding-cite">' + esc(cite) + '</span>' : '') +
        '<span class="spacer"></span><span id="rl-cr-mark-' + esc(it.key) + '" class="row row-tight">' + markerFor(d, it) + '</span>' +
        ui.button('Remove item ' + n, { action: 'rl-cr-remove', data: { assetId: a.id, key: it.key }, size: 'sm', variant: 'ghost', icon: 'x', iconOnly: true }) +
      '</div>' +
      (f && f.quote ? '<div class="quote">“' + esc(f.quote) + '”</div><div class="xs muted">Found in ' + esc(sectionLabel(v, f.sectionId) || 'the creative') + ' · V' + v.n + '</div>' : '') +
      ui.field('Required fix', '<textarea class="textarea" id="' + esc(taId) + '" rows="2" data-input="rl-cr-edit" data-asset-id="' + esc(a.id) + '" data-key="' + esc(it.key) + '">' + esc(it.text) + '</textarea>', { id: taId }) +
      (it.linksRemoved ? '<div class="xs muted">' + A.icon('link') + ' ' + A.plural(it.linksRemoved, 'link') + ' removed from the drafted text.</div>' : '') +
      (f && f.suggestedCopy ? '<div class="small"><span class="muted">Suggested copy (optional for the submitter): </span>“' + esc(f.suggestedCopy) + '”</div>' : '') +
      '</div></li>';
  }
  function draftItems(d) { return d.items.filter(function (it) { return String(it.text || '').trim(); }); }
  function draftPlainText(a, v, d) {
    var lines = [];
    lines.push('Changes requested: ' + (a.title || a.id));
    lines.push(a.id + ' · V' + v.n + (v.sha ? ' · sha ' + v.sha : '') + (d.dueDate ? ' · due ' + ui.date(d.dueDate) : ''));
    if (String(d.note || '').trim()) { lines.push(''); lines.push(String(d.note).trim()); }
    lines.push('');
    draftItems(d).forEach(function (it, i) {
      var f = findingIn(v, it.findingId);
      var head = (i + 1) + '. ' + (f ? '[' + sevLabel(f.severity) + '] ' + ruleTitle(f) + ' (' + f.ruleId + ')' : (it.origin === 'hidden' ? 'Hidden text' : 'Item'));
      lines.push(head);
      if (f && f.quote) lines.push('   Found: "' + f.quote + '"');
      lines.push('   Required fix: ' + String(it.text).trim());
      if (f && f.suggestedCopy) lines.push('   Suggested copy: "' + f.suggestedCopy + '"');
      lines.push('');
    });
    lines.push('Send the revision the way you sent the original (on the same email thread, or by updating the same file). It is matched to ' + a.id + ' automatically.');
    return lines.join('\n');
  }
  function composerContext(assetId) {
    var a = A.asset(assetId); if (!a) return null;
    var v = A.latestVersion(a); if (!v) return null;
    var d = st.drafts[a.id];
    return d ? { a: a, v: v, d: d } : null;
  }
  function refreshComposerLive(ctx) {
    var pv = document.getElementById('rl-cr-preview');
    if (pv) pv.value = draftPlainText(ctx.a, ctx.v, ctx.d);
    var chk = A.canDecide(ctx.a.id, ctx.v.id, 'changes-requested');
    var save = document.getElementById('rl-cr-save');
    if (save) save.disabled = !chk.ok || !draftItems(ctx.d).length;
    var cnt = document.getElementById('rl-cr-count');
    if (cnt) cnt.textContent = A.plural(draftItems(ctx.d).length, 'item');
  }
  function showComposer(assetId, focusSel) {
    var a = A.asset(assetId);
    if (!a) { A.toast('Asset not found in this profile.', 'error'); return; }
    var v = A.latestVersion(a);
    if (!v) { A.toast('This asset has no version yet.', 'error'); return; }
    var d = st.drafts[a.id];
    var chk = A.canDecide(a.id, v.id, 'changes-requested');
    var submitter = a.submitter ? a.submitter.name : 'the submitter';
    var others = otherOpenFindings(v, d);
    var prevBody = document.getElementById('rl-cr-dialog-body');
    var keepTop = prevBody ? prevBody.scrollTop : 0;
    var restoredNow = d.restored;
    d.restored = false; // only on the first render after reopening

    var parts = [];
    if (!chk.ok) parts.push(ui.callout('warning', 'You can’t save this change request yet', esc(chk.reason)));
    if (restoredNow) {
      parts.push(ui.callout('neutral', 'Restored your unsaved draft', null,
        { actionsHtml: ui.button('Start over', { action: 'rl-cr-restart', data: { assetId: a.id }, size: 'sm', variant: 'outline', icon: 'undo' }) }));
    }
    if (d.editing) parts.push(ui.callout('info', 'Updating ' + d.editing, 'Saving creates a new checklist for V' + v.n + '. ' + d.editing + ' stays in the asset history.'));
    parts.push('<p class="small">One checklist for everything ' + esc(submitter) + ' needs to fix. Saving records it on the asset, sets the status to Changes requested and shows it to members in the app. ' +
      '<strong>Nothing is sent.</strong> Use Copy as text to paste it wherever you already talk to ' + esc(submitter) + '.</p>');
    parts.push('<div class="row row-start small muted">' + A.icon('sparkles') + '<span>Required-fix wording is drafted by AI from each finding’s rule, quote and suggested fix, never from the raw creative, and links are removed. Review and edit it before saving.</span></div>');

    parts.push('<div class="section"><div class="section-header"><div class="section-title">Checklist <span class="count" id="rl-cr-count">' + esc(A.plural(draftItems(d).length, 'item')) + '</span></div></div>' +
      (d.items.length ? '<ol class="rl-cr-list">' + d.items.map(function (it, i) { return itemHtml(a, v, d, it, i + 1); }).join('') + '</ol>' :
        ui.empty('No items yet', 'No open findings are marked Fix required. Add findings from the list below, or write your own item.')) +
      '<div class="row row-wrap">' + ui.button('Add your own item', { action: 'rl-cr-add-custom', data: { assetId: a.id }, size: 'sm', variant: 'outline', icon: 'plus' }) +
        (hiddenAlertAvailable(v, d) ? ui.button('Add "remove hidden text"', { action: 'rl-cr-add-hidden', data: { assetId: a.id }, size: 'sm', variant: 'outline', icon: 'shield' }) : '') + '</div>' +
      '</div>');

    if (others.length) {
      parts.push('<div class="section"><div class="section-header"><div><div class="section-title">Other open findings</div>' +
        '<div class="section-desc">Not in the checklist. Adding one marks it Fix required when you save.</div></div></div>' +
        '<div class="list">' + others.map(function (f) {
          return '<div class="list-item">' + ui.severityBadge(f.severity) +
            '<div class="grow" style="min-width:0"><div class="small strong truncate">' + esc(findingTitle(f).replace(/^New:\s*/, '')) + '</div>' +
            (f.quote ? '<div class="xs muted truncate">“' + esc(f.quote) + '”</div>' : '') + '</div>' +
            ui.dispositionBadge(f.disposition) +
            ui.button('Add', { action: 'rl-cr-add', data: { assetId: a.id, findingId: f.id }, size: 'sm', variant: 'outline', icon: 'plus' }) + '</div>';
        }).join('') + '</div></div>');
    }

    var today = (S().meta && S().meta.today) || '';
    parts.push('<div class="field-row">' +
      ui.field('Note', '<textarea class="textarea" id="rl-cr-note" rows="3" data-input="rl-cr-note" data-asset-id="' + esc(a.id) + '" placeholder="For example: Update the file in the shared folder when it is ready.">' + esc(d.note) + '</textarea>',
        { id: 'rl-cr-note', optional: true, hint: 'Shown in the asset history and at the top of the copied text.' }) +
      ui.field('Due date', '<input class="input" type="date" id="rl-cr-due" data-input="rl-cr-due" data-asset-id="' + esc(a.id) + '" value="' + esc(d.dueDate) + '"' + (today ? ' min="' + esc(today) + '"' : '') + '>',
        { id: 'rl-cr-due', optional: true, hint: 'Shown on the asset and in the copied text.' }) +
      '</div>');
    parts.push('<details class="rl-details" id="rl-cr-preview-wrap"><summary>Preview the copied text</summary>' +
      '<label class="sr-only" for="rl-cr-preview">Plain-text checklist</label>' +
      '<textarea class="textarea code" id="rl-cr-preview" rows="12" readonly>' + esc(draftPlainText(a, v, d)) + '</textarea></details>');

    A.dialog({
      id: 'rl-cr-dialog', size: 'lg', dismissible: false,
      title: 'Request changes',
      description: a.id + ' · V' + v.n + ' · sha ' + v.sha + ' · ' + (a.title || '') + ' · Submitter: ' + submitter,
      body: parts.join(''),
      footerNote: A.icon('lock') + ' ' + esc('In-app only. Nothing is sent.'),
      initialFocus: focusSel || null,
      actions: [
        { label: 'Cancel', action: 'rl-cr-cancel', variant: 'ghost', data: { assetId: a.id } },
        { label: 'Copy as text', action: 'rl-cr-copy', variant: 'outline', icon: 'copy', id: 'rl-cr-copy', data: { assetId: a.id } },
        { label: 'Save and mark Changes requested', action: 'rl-cr-save', variant: 'default', icon: 'check', id: 'rl-cr-save', data: { assetId: a.id }, disabled: !chk.ok || !draftItems(d).length }
      ],
      onOpen: function () {
        var b = document.getElementById('rl-cr-dialog-body');
        if (b && keepTop && !focusSel) b.scrollTop = keepTop;
      }
    });
  }

  A.openChangeRequest = function (assetId) {
    var a = A.asset(assetId);
    if (!a) { A.toast('Asset not found in this profile.', 'error'); return; }
    var v = A.latestVersion(a);
    if (!v) { A.toast('This asset has no version yet.', 'error'); return; }
    var d = st.drafts[a.id];
    if (d && d.versionId !== v.id) {
      A.toast('Your earlier draft was for an older version. Started a new one for V' + v.n + '.', 'info');
      d = null;
    }
    if (d) d.restored = true;
    else d = st.drafts[a.id] = buildDraft(a, v);
    showComposer(a.id);
  };

  function draftItem(d, key) { return d.items.find(function (it) { return it.key === key; }) || null; }
  A.action('rl-cr-edit', function (el) {
    var ctx = composerContext(el.getAttribute('data-asset-id')); if (!ctx) return;
    var it = draftItem(ctx.d, el.getAttribute('data-key')); if (!it) return;
    it.text = el.value;
    var edited = it.origin === 'ai' ? it.text !== it.aiText : true;
    if (edited !== it.edited) {
      it.edited = edited;
      var mk = document.getElementById('rl-cr-mark-' + it.key);
      if (mk) mk.innerHTML = markerFor(ctx.d, it);
    }
    refreshComposerLive(ctx);
  });
  A.action('rl-cr-note', function (el) {
    var ctx = composerContext(el.getAttribute('data-asset-id')); if (!ctx) return;
    ctx.d.note = el.value;
    refreshComposerLive(ctx);
  });
  A.action('rl-cr-due', function (el) {
    var ctx = composerContext(el.getAttribute('data-asset-id')); if (!ctx) return;
    ctx.d.dueDate = el.value || '';
    refreshComposerLive(ctx);
  });
  A.action('rl-cr-restore', function (el) {
    var ctx = composerContext(el.getAttribute('data-asset-id')); if (!ctx) return;
    var it = draftItem(ctx.d, el.getAttribute('data-key')); if (!it || it.aiText == null) return;
    it.text = it.aiText; it.edited = false;
    showComposer(ctx.a.id, '#rl-cr-text-' + it.key);
  });
  A.action('rl-cr-remove', function (el) {
    var ctx = composerContext(el.getAttribute('data-asset-id')); if (!ctx) return;
    var key = el.getAttribute('data-key');
    ctx.d.items = ctx.d.items.filter(function (it) { return it.key !== key; });
    showComposer(ctx.a.id);
  });
  A.action('rl-cr-add', function (el) {
    var ctx = composerContext(el.getAttribute('data-asset-id')); if (!ctx) return;
    var f = findingIn(ctx.v, el.getAttribute('data-finding-id')); if (!f) return;
    var it = newItemFromFinding(f);
    ctx.d.items.push(it);
    showComposer(ctx.a.id, '#rl-cr-text-' + it.key);
  });
  A.action('rl-cr-add-custom', function (el) {
    var ctx = composerContext(el.getAttribute('data-asset-id')); if (!ctx) return;
    seq += 1;
    var it = { key: 'i' + seq, findingId: null, text: '', origin: 'custom', edited: false };
    ctx.d.items.push(it);
    showComposer(ctx.a.id, '#rl-cr-text-' + it.key);
  });
  A.action('rl-cr-add-hidden', function (el) {
    var ctx = composerContext(el.getAttribute('data-asset-id')); if (!ctx) return;
    seq += 1;
    // Say what to remove, never how detection works, and never echo the hidden instructions.
    var it = { key: 'i' + seq, findingId: null, text: 'Remove all hidden or invisible text from the page, including text styled to match the background and zero-width characters.', origin: 'hidden', edited: false };
    ctx.d.items.push(it);
    showComposer(ctx.a.id, '#rl-cr-text-' + it.key);
  });
  A.action('rl-cr-restart', function (el) {
    var a = A.asset(el.getAttribute('data-asset-id')); if (!a) return;
    st.drafts[a.id] = buildDraft(a, A.latestVersion(a));
    showComposer(a.id);
    A.toast('Started a fresh draft from the current findings.', 'info');
  });
  A.action('rl-cr-cancel', function () {
    A.closeDialog();
    A.toast('Draft kept. Reopen Request changes to continue.', 'default');
  });
  A.action('rl-cr-copy', function (el) {
    var ctx = composerContext(el.getAttribute('data-asset-id')); if (!ctx) return;
    if (!draftItems(ctx.d).length) { A.toast('Add at least one item before copying.', 'error'); return; }
    var text = draftPlainText(ctx.a, ctx.v, ctx.d);
    var fallback = function () {
      var wrap = document.getElementById('rl-cr-preview-wrap');
      var ta = document.getElementById('rl-cr-preview');
      if (wrap) wrap.open = true;
      if (ta) { ta.value = text; try { ta.focus(); ta.select(); } catch (e) { /* ignore */ } }
      A.toast('The browser blocked clipboard access. The text is selected below; copy it with your keyboard.', 'warning');
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          A.toast('Checklist copied as text. Paste it wherever you talk to ' + (ctx.a.submitter ? ctx.a.submitter.name : 'the submitter') + '.', 'success');
        }, fallback);
        return;
      }
    } catch (e) { /* fall through */ }
    fallback();
  });
  A.action('rl-cr-save', function (el) {
    var ctx = composerContext(el.getAttribute('data-asset-id')); if (!ctx) return;
    var items = draftItems(ctx.d).map(function (it) { return { findingId: it.findingId || null, text: String(it.text).trim() }; });
    if (!items.length) { A.toast('Add at least one item to the checklist.', 'error'); return; }
    var cr = A.requestChanges(ctx.a.id, ctx.d.versionId, { items: items, note: String(ctx.d.note || '').trim(), dueDate: ctx.d.dueDate || null });
    if (!cr) return; // core showed the reason
    delete st.drafts[ctx.a.id];
    A.closeDialog();
    A.toast('Changes requested on ' + ctx.a.id + '. ' + cr.id + ' is saved in the app; use Copy as text to share it.', 'success');
    A.rerender();
  });

  /* ------------------------------------------------------------------ */
  /* Saved change request: view and copy                                 */
  /* ------------------------------------------------------------------ */
  function copySavedCr(a, cr) {
    var text = A.changeRequestText(a.id, cr.id);
    var done = function () {
      A.toast('Checklist copied as text. Paste it wherever you talk to ' + (a.submitter ? a.submitter.name : 'the submitter') + '.', 'success');
      A.log(a.id, A.me().name, 'copied-text', 'Copied the ' + cr.id + ' checklist as text.');
      A.rerender();
    };
    var fallback = function () {
      A.showExport({ title: cr.id + ' as text', text: text, format: 'text', description: 'The browser blocked clipboard access. Select the text and copy it with your keyboard.' });
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, fallback); return; }
    } catch (e) { /* fall through */ }
    fallback();
  }
  function crFromEl(el) {
    var a = A.asset(el.getAttribute('data-asset-id')); if (!a) return null;
    var crId = el.getAttribute('data-cr-id');
    var cr = crId ? (a.changeRequests || []).find(function (c) { return c.id === crId; }) : latestCr(a);
    return cr ? { a: a, cr: cr } : null;
  }
  A.action('rl-copy-cr', function (el) {
    var x = crFromEl(el);
    if (!x) { A.toast('No saved checklist on this asset.', 'error'); return; }
    copySavedCr(x.a, x.cr);
  });
  A.action('rl-edit-cr', function (el) { A.closeDrawer(); A.openChangeRequest(el.getAttribute('data-asset-id')); });
  A.action('rl-view-cr', function (el) {
    var x = crFromEl(el); if (!x) { A.toast('No saved checklist on this asset.', 'error'); return; }
    var a = x.a, cr = x.cr, v = A.version(a, cr.versionId) || A.latestVersion(a);
    var author = A.userById(cr.authorId);
    var items = cr.items.map(function (it, i) {
      var f = findingIn(v, it.findingId);
      return '<li class="card"><div class="card-body stack stack-sm">' +
        '<div class="row row-wrap"><span class="rl-cr-num">' + (i + 1) + '.</span>' + (f ? ui.severityBadge(f.severity) : '') +
          '<span class="finding-rule">' + esc(f ? findingTitle(f).replace(/^New:\s*/, '') : 'Additional item') + '</span>' +
          (f ? '<span class="finding-cite">' + esc(f.ruleId) + '</span>' : '') + '</div>' +
        (f && f.quote ? '<div class="quote">“' + esc(f.quote) + '”</div>' : '') +
        '<div class="small"><span class="muted">Required fix: </span>' + esc(it.text) + '</div>' +
        (f && f.suggestedCopy ? '<div class="small"><span class="muted">Suggested copy: </span>“' + esc(f.suggestedCopy) + '”</div>' : '') +
        '</div></li>';
    }).join('');
    var canEdit = cr.status === 'open' && cr.versionId === a.latestVersionId;
    A.drawer({
      id: 'rl-cr-drawer', title: cr.id + ' · Change request', width: 'lg',
      body: '<div class="stack">' + ui.dl([
          ['Asset', esc(a.id + ' · ' + (a.title || ''))],
          ['Version', 'V' + esc(v ? v.n : '?') + ' ' + ui.sha(v && v.sha)],
          ['Saved', esc((author ? author.name : 'A member') + ' · ' + ui.time(cr.at))],
          ['Due', cr.dueDate ? ui.due(cr.dueDate) : '<span class="muted">No due date</span>'],
          ['Status', cr.status === 'open' ? ui.tag('Open', { icon: 'clock' }) : ui.tag('Resolved', { icon: 'circle-check' })]
        ]) +
        (cr.note ? '<div class="quote">' + esc(cr.note) + '</div>' : '') +
        '<ol class="rl-cr-list">' + items + '</ol>' +
        '<p class="xs muted">Saved in the app only. Nothing was sent from here.</p></div>',
      footer: ui.button('Copy as text', { action: 'rl-copy-cr', data: { assetId: a.id, crId: cr.id }, variant: 'default', icon: 'copy' }) +
        (canEdit ? ui.button('Update checklist', { action: 'rl-edit-cr', data: { assetId: a.id }, variant: 'outline', icon: 'edit' }) : '')
    });
  });

  /* ------------------------------------------------------------------ */
  /* Waiting-for-revision callout                                        */
  /* ------------------------------------------------------------------ */
  function demoTag() { return ui.tag('demo', { cls: 'tag-sample', title: 'Demo control: simulates what the connected source would pick up' }); }
  function renderWaitingCallout(asset) {
    var a = asset && asset.id ? (A.asset(asset.id) || asset) : null;
    if (!a || a.status !== 'changes-requested') return '';
    var v = A.latestVersion(a);
    var cr = openCr(a) || null;
    var match = pendingMatch(a);
    var ps = primarySource(a);
    var provider = ps ? ps.source.provider : 'gmail';
    var meta = srcMeta(provider);
    var nextN = (v ? v.n : 0) + 1;
    var lines = [];

    if (match) {
      var file = (match.candidates || [])[0];
      lines.push('<p>' + esc(match.sender || 'The submitter') + ' replied on the original thread ' + esc(ui.relTime(match.receivedAt)) +
        (file ? ' with ' + esc(file.name) : '') + '. Triage matched it as a new version of ' + esc(a.id) + (match.reason ? ' (' + esc(match.reason.replace(/\.$/, '')) + ')' : '') + '.</p>');
    } else {
      lines.push('<p>It appears here automatically when the submitter replies to the original email or updates the file in a connected source.</p>');
    }
    if (cr) {
      var author = A.userById(cr.authorId);
      lines.push('<div class="row row-wrap small">' + A.icon('clipboard') + '<span>' + esc(cr.id) + ' · ' + esc(A.plural(cr.items.length, 'item')) + ' · saved by ' +
        esc(author ? author.name : 'a member') + ' ' + esc(ui.relTime(cr.at)) + '</span>' + (cr.dueDate ? ui.due(cr.dueDate) : '') + '</div>');
    }
    if (ps) {
      var live = isLive(ps.source);
      lines.push('<div class="rl-watch small">' + ui.sourceIcon(provider) + '<span class="muted">Watching</span><span class="truncate" style="min-width:0">' + esc(ps.ref.label) + '</span>' +
        (ps.source.illustrative ? ui.illustrative() : '') + '</div>');
      if (!live) {
        lines.push('<div class="row row-wrap small warning-text">' + A.icon('alert') + '<span>' + esc(meta.label) + ' needs attention (' + esc(String(ps.source.status).replace(/-/g, ' ')) +
          '), so the revision will not arrive automatically. Reconnect it in Sources or use Add revision.</span>' +
          ui.button('Open Sources', { href: '#intake-sources', size: 'sm', variant: 'link' }) + '</div>');
      }
    } else {
      lines.push('<div class="small muted">This asset was not imported from a connected source. Use Add revision when the submitter sends the update.</div>');
    }

    var actions = [];
    if (match) {
      actions.push(ui.button('Open Triage', { href: '#intake-triage', size: 'sm', variant: 'outline', icon: 'inbox' }));
      actions.push(ui.button('Accept as V' + nextN + ' and compare', { action: 'rl-accept-match', data: { assetId: a.id }, size: 'sm', variant: 'default', icon: 'git-compare' }));
    }
    if (cr) {
      actions.push(ui.button('View checklist', { action: 'rl-view-cr', data: { assetId: a.id, crId: cr.id }, size: 'sm', variant: 'outline', icon: 'clipboard' }));
      actions.push(ui.button('Copy as text', { action: 'rl-copy-cr', data: { assetId: a.id, crId: cr.id }, size: 'sm', variant: 'outline', icon: 'copy' }));
    }
    actions.push(ui.button('Add revision', { action: 'rl-add-revision', data: { assetId: a.id }, size: 'sm', variant: 'outline', icon: 'upload' }));
    if (!match) {
      var simLabel = 'Simulate revision from ' + (ps && isLive(ps.source) ? meta.label : 'Gmail');
      actions.push(ui.button(simLabel, {
        action: 'rl-simulate', data: { assetId: a.id }, size: 'sm', variant: 'secondary', icon: 'refresh',
        labelHtml: '<span>' + esc(simLabel) + '</span>' + demoTag(),
        title: 'Demo: pretend the submitter sent the fixes through the connected source'
      }));
    }
    return ui.callout('info', match ? 'Revision arrived · confirm it in Triage' : 'Waiting for revision', lines.join(''),
      { icon: match ? 'inbox' : 'clock', id: 'rl-waiting-' + safeId(a.id), actionsHtml: actions.join('') });
  }
  A.renderWaitingCallout = renderWaitingCallout;

  /* ------------------------------------------------------------------ */
  /* Revisions: simulate, accept matched, add by hand                    */
  /* ------------------------------------------------------------------ */
  // Builds the revised sections a cooperative submitter would send: apply suggested copy for checklist items.
  function proposeRevision(a, v) {
    var cr = openCr(a, v.id) || openCr(a);
    var ids = cr ? cr.items.map(function (i) { return i.findingId; }).filter(Boolean) :
      (v.findings || []).filter(function (f) { return A.isOpenFinding(f) && f.disposition === 'fix-required'; }).map(function (f) { return f.id; });
    var texts = {}, touched = {};
    (v.content.sections || []).forEach(function (s) { texts[s.id] = String(s.text || ''); });
    ids.forEach(function (fid) {
      var f = findingIn(v, fid);
      if (!f || !f.quote || !f.suggestedCopy) return; // no concrete fix: the submitter leaves it (shows as still present)
      var sid = f.sectionId && texts[f.sectionId] != null && texts[f.sectionId].indexOf(f.quote) >= 0 ? f.sectionId :
        Object.keys(texts).find(function (k) { return texts[k].indexOf(f.quote) >= 0; });
      if (!sid || texts[sid].indexOf(f.suggestedCopy) >= 0) return;
      var repl = f.evidenceType === 'missing-disclosure' ? f.quote + ' ' + f.suggestedCopy : f.suggestedCopy;
      texts[sid] = texts[sid].replace(f.quote, function () { return repl; });
      touched[sid] = true;
    });
    return Object.keys(touched).map(function (sid) { return { id: sid, text: texts[sid] }; });
  }
  // After the deterministic quote check: a missing-disclosure finding whose required text now appears is resolved.
  function refineRecheck(a, nv, overrides) {
    var full = A.normText((nv.content.sections || []).map(function (s) { return s.text; }).join('\n'));
    var flipped = [];
    (nv.findings || []).forEach(function (f) {
      var o = overrides && overrides.find(function (x) { return x.carriedFrom === f.carriedFrom; });
      var before = f.recheck;
      if (o) {
        f.recheck = o.recheck;
        if (o.quote) f.quote = o.quote;
        if (o.sectionId) f.sectionId = o.sectionId;
      } else if (f.recheck === 'still-present' && f.evidenceType === 'missing-disclosure' && f.suggestedCopy && full.indexOf(A.normText(f.suggestedCopy)) >= 0) {
        f.recheck = 'resolved';
        f.recheckNote = 'The required disclosure now appears.';
      }
      if (f.recheck !== before) flipped.push(f.id + ' → ' + COUNT_WORD[f.recheck]);
    });
    (nv.checklist || []).forEach(function (row) {
      if (row.result !== 'flagged') return;
      var still = (nv.findings || []).some(function (f) { return f.ruleId === row.ruleId && f.recheck !== 'resolved' && f.disposition !== 'dismissed'; });
      if (!still) row.result = 'pass';
    });
    var c = { resolved: 0, still: 0, fresh: 0 };
    (nv.findings || []).forEach(function (f) { if (f.recheck === 'resolved') c.resolved++; else if (f.recheck === 'new') c.fresh++; else c.still++; });
    if (flipped.length) A.log(a.id, 'System', 'recheck', 'Disclosure check on V' + nv.n + ': ' + flipped.join(', ') + '.');
    A.log(a.id, 'System', 'recheck', 'Recheck V' + nv.n + ': ' + c.resolved + ' resolved, ' + c.still + ' still present, ' + c.fresh + ' new.');
    if (a.status === 'recheck-ready') a.subLabel = c.resolved + ' resolved, ' + c.still + ' still present' + (c.fresh ? ', ' + c.fresh + ' new' : '');
    return c;
  }
  function closeOpenCrs(a, nv) {
    (a.changeRequests || []).forEach(function (cr) {
      if (cr.status !== 'open') return;
      cr.status = 'resolved';
      cr.resolvedAt = A.nowIso();
      if (!cr.responseVersionId) cr.responseVersionId = nv.id;
    });
  }
  function retargetNotification(a) {
    var n = (S().notifications || []).find(function (x) { return !x.read && String(x.text || '').indexOf('New version of ' + a.id) === 0; });
    if (n) n.href = '#compare-' + a.id;
  }
  function finishRevision(a, nv, c, how) {
    delete st.pairs[a.id];
    delete st.active[a.id];
    delete st.drafts[a.id];
    A.emit('data-changed', { kind: 'revision', assetId: a.id, versionId: nv.id });
    A.closeDialog(); A.closeDrawer();
    A.go('#compare-' + a.id);
    A.toast('V' + nv.n + ' ' + how + ' and matched to ' + a.id + '. Recheck: ' + c.resolved + ' resolved, ' + c.still + ' still present' + (c.fresh ? ', ' + c.fresh + ' new' : '') + '.', 'success');
  }
  function receiveRevision(a, opts) {
    var v = A.latestVersion(a);
    var match = opts.match || null;
    var ps = primarySource(a);
    var source = ps && isLive(ps.source) ? ps.source : (match && A.sourceById(match.sourceId)) || liveSource(a.profileId, 'gmail');
    var provider = source ? source.provider : 'gmail';
    var meta = srcMeta(provider);
    var mail = isMailProvider(provider);
    var sections = match && match.revision && match.revision.sections ? A.clone(match.revision.sections) : proposeRevision(a, v);
    var nextN = a.versions.reduce(function (m, x) { return Math.max(m, x.n || 0); }, 0) + 1;
    var subject = match ? match.title : ((ps && ps.ref.label) || '').replace(/^[^:]*:\s*/, '');
    var fromWho = a.submitter && a.submitter.email ? a.submitter.email : (a.submitter ? a.submitter.name : 'the submitter');
    var where = mail ? meta.label + ' thread' : meta.label + ' file update';
    A.log(a.id, 'System', 'intake', 'Revision received from ' + where + (subject ? ' "' + subject + '"' : '') + ' (' + (mail ? 'reply from ' : 'changed by ') + fromWho + '). Matched to ' + a.id + ' as V' + nextN + '.');
    var nv = A.newVersion(a.id, { origin: 'sync', sections: sections, authorName: a.submitter ? a.submitter.name : 'Submitter' });
    if (!nv) return;
    var c = refineRecheck(a, nv, match && match.revision ? match.revision.recheck : null);
    if (!Array.isArray(a.sourceRefs)) a.sourceRefs = [];
    if (source) {
      a.sourceRefs.push({ sourceId: source.id, label: mail ? meta.label + ' thread: reply from ' + fromWho + (subject ? ' on "' + subject + '"' : '') : meta.label + ': ' + (subject || 'file') + ' (updated)', seenAt: A.nowIso() });
      source.lastSyncAt = A.nowIso();
      if (Array.isArray(source.syncLog)) source.syncLog.unshift({ at: A.nowIso(), kind: 'incremental', summary: '+1 ' + (mail ? 'reply' : 'file change') + ' matched as V' + nv.n + ' of ' + a.id + '.' });
    }
    if (match) { match.status = 'accepted'; match.assetId = a.id; match.acceptedBy = A.me().id; match.acceptedAt = A.nowIso(); }
    closeOpenCrs(a, nv);
    retargetNotification(a);
    finishRevision(a, nv, c, 'arrived from ' + meta.label);
  }
  A.action('rl-simulate', function (el) {
    var a = A.asset(el.getAttribute('data-asset-id')); if (!a) return;
    if (a.status !== 'changes-requested') { A.toast('This asset is not waiting for a revision.', 'info'); return; }
    receiveRevision(a, {});
  });
  A.action('rl-accept-match', function (el) {
    var a = A.asset(el.getAttribute('data-asset-id')); if (!a) return;
    var match = pendingMatch(a);
    if (!match) { A.toast('The matched revision is no longer waiting in Triage.', 'info'); A.rerender(); return; }
    A.log(a.id, A.me().name, 'merge', 'Accepted ' + match.id + ' from Triage as a new version of ' + a.id + '.');
    receiveRevision(a, { match: match });
  });

  // Add revision by hand: a member pastes what the submitter sent.
  A.action('rl-add-revision', function (el) {
    var a = A.asset(el.getAttribute('data-asset-id')); if (!a) return;
    var v = A.latestVersion(a); if (!v) return;
    var secs = (v.content && v.content.sections) || [];
    var visual = hasVisual(v);
    A.dialog({
      id: 'rl-rev-dialog', size: 'lg', dismissible: false,
      title: 'Add revision to ' + a.id,
      description: 'Paste the revised copy ' + (a.submitter ? a.submitter.name : 'the submitter') + ' sent. Saving creates V' + (v.n + 1) + ' and rechecks it. V' + v.n + ' stays unchanged.',
      body: (visual ? ui.callout('neutral', 'Image or PDF', 'Paste the text as it appears in the revised file. Layout changes are compared visually.') : '') +
        secs.map(function (s, i) {
          var id = 'rl-rev-' + i;
          return ui.field(s.label || ('Section ' + (i + 1)), '<textarea class="textarea" id="' + id + '" rows="' + Math.min(8, Math.max(2, Math.ceil(String(s.text || '').length / 80))) + '">' + esc(s.text) + '</textarea>', { id: id });
        }).join('') +
        '<p class="xs muted">The revision is recorded as added by you on behalf of ' + esc(a.submitter ? a.submitter.name : 'the submitter') + '.</p>',
      actions: [
        { label: 'Cancel', action: 'dialog-close', variant: 'ghost' },
        { label: 'Save as V' + (v.n + 1), action: 'rl-rev-save', variant: 'default', icon: 'check', data: { assetId: a.id, versionId: v.id } }
      ]
    });
  });
  A.action('rl-rev-save', function (el) {
    var a = A.asset(el.getAttribute('data-asset-id')); if (!a) return;
    var v = A.latestVersion(a);
    if (!v || v.id !== el.getAttribute('data-version-id')) { A.toast('A newer version arrived while you were editing. Close this and try again.', 'error'); return; }
    var secs = (v.content && v.content.sections) || [];
    var changed = [];
    secs.forEach(function (s, i) {
      var ta = document.getElementById('rl-rev-' + i);
      if (ta && ta.value !== s.text) changed.push({ id: s.id, text: ta.value });
    });
    if (!changed.length) { A.toast('Nothing changed. Edit at least one section, or cancel.', 'error'); return; }
    var me = A.me();
    A.log(a.id, me.name, 'version', me.name + ' added a revision on behalf of ' + (a.submitter ? a.submitter.name : 'the submitter') + ' (pasted copy, ' + A.plural(changed.length, 'section') + ' changed).');
    var nv = A.newVersion(a.id, { origin: 'upload', sections: changed, authorName: a.submitter ? a.submitter.name : me.name });
    if (!nv) return;
    var c = refineRecheck(a, nv, null);
    closeOpenCrs(a, nv);
    retargetNotification(a);
    finishRevision(a, nv, c, 'added');
  });
})();
