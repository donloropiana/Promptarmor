/* core.js: Compliance Workbench prototype runtime.
   Defines window.App (router, actions, keys, event bus, UI helpers, overlays, data helpers).
   Screens register with App.route / App.action / App.key at load time; boot.js calls App.start().
   Full reference: CONTRACT.md. */
(function () {
  'use strict';

  var STORE_KEY = 'cw-demo-v1';
  var THEME_KEY = 'cw-theme';
  var DEFAULT_ROUTE = 'dashboard';
  var TZ = 'America/Chicago';
  var ROUTE_NAME_RE = /^[A-Za-z0-9-]+$/;
  var RESERVED_ROUTES = ['settings', 'sidebar', 'customize', 'upgrade', 'downloads'];
  var IS_MAC = /Mac|iPhone|iPad/.test((navigator && (navigator.platform || navigator.userAgent)) || '');

  /* ------------------------------------------------------------------ */
  /* Storage (every access guarded)                                      */
  /* ------------------------------------------------------------------ */
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } }

  /* ------------------------------------------------------------------ */
  /* Small utilities                                                     */
  /* ------------------------------------------------------------------ */
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function kebab(k) { return String(k).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(); }
  function dataAttrs(data) {
    if (!data) return '';
    return Object.keys(data).filter(function (k) { return data[k] != null && data[k] !== false; })
      .map(function (k) { return ' data-' + kebab(k) + '="' + esc(data[k]) + '"'; }).join('');
  }
  function htmlAttrs(obj) {
    if (!obj) return '';
    return Object.keys(obj).filter(function (k) { return obj[k] != null && obj[k] !== false; })
      .map(function (k) { return obj[k] === true ? ' ' + k : ' ' + k + '="' + esc(obj[k]) + '"'; }).join('');
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function initialsOf(name) {
    var parts = String(name || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0][1] || ''))).toUpperCase();
  }
  function normText(s) {
    return String(s || '').toLowerCase()
      .replace(/[‘’‛]/g, "'").replace(/[“”‟]/g, '"')
      .replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();
  }
  function shortSha() {
    var out = '';
    try {
      var a = new Uint8Array(4); window.crypto.getRandomValues(a);
      for (var i = 0; i < a.length; i++) out += ('0' + a[i].toString(16)).slice(-2);
      return out.slice(0, 7);
    } catch (e) {
      for (var j = 0; j < 7; j++) out += Math.floor(Math.random() * 16).toString(16);
      return out;
    }
  }
  function nextId(prefix, ids, base) {
    var max = base || 0, re = new RegExp('^' + prefix + '-(\\d+)$');
    (ids || []).forEach(function (id) { var m = re.exec(String(id || '')); if (m) max = Math.max(max, parseInt(m[1], 10)); });
    return prefix + '-' + (max + 1);
  }
  var uidCounter = 0;
  function uid(prefix) { uidCounter += 1; return (prefix || 'id') + '-' + Date.now().toString(36) + uidCounter.toString(36); }

  /* ------------------------------------------------------------------ */
  /* Icons (lucide-style strokes, 24px grid)                             */
  /* ------------------------------------------------------------------ */
  var SHIELD = '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>';
  var ICONS = {
    'dashboard': '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    'queue': '<path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/>',
    'inbox': '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    'shield': SHIELD,
    'shield-alert': SHIELD + '<path d="M12 8v4"/><path d="M12 16h.01"/>',
    'shield-check': SHIELD + '<path d="m9 12 2 2 4-4"/>',
    'book': '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    'chart': '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    'settings-gear': '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    'bell': '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
    'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    'moon': '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    'monitor': '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
    'check': '<path d="M20 6 9 17l-5-5"/>',
    'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    'alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    'octagon-alert': '<path d="M12 16h.01"/><path d="M12 8v4"/><path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"/>',
    'info': '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    'mail': '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    'drive': '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    'folder': '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    'sheet': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 9v12"/><path d="M15 9v12"/>',
    'upload': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
    'clipboard': '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    'clipboard-check': '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
    'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    'refresh': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'chevron-up': '<path d="m18 15-6-6-6 6"/>',
    'chevrons-up-down': '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
    'user': '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>',
    'eye': '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
    'eye-off': '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
    'edit': '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    'sparkles': '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
    'lock': '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    'history': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    'git-compare': '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M11 18H8a2 2 0 0 1-2-2V9"/>',
    'filter': '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
    'more': '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    'menu': '<path d="M4 12h16"/><path d="M4 6h16"/><path d="M4 18h16"/>',
    'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>',
    'minus': '<path d="M5 12h14"/>',
    'clock': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    'loader': '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
    'file': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    'image': '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    'message': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
    'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    'keyboard': '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
    'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    'arrow-up-down': '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
    'trash': '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2"/>',
    'calendar': '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
    'tag': '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
    'help': '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    'circle': '<circle cx="12" cy="12" r="10"/>',
    'circle-check': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    'circle-x': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    'circle-slash': '<circle cx="12" cy="12" r="10"/><line x1="9" x2="15" y1="15" y2="9"/>',
    'circle-dashed': '<path d="M10.1 2.182a10 10 0 0 1 3.8 0"/><path d="M13.9 21.818a10 10 0 0 1-3.8 0"/><path d="M17.609 3.721a10 10 0 0 1 2.69 2.7"/><path d="M2.182 13.9a10 10 0 0 1 0-3.8"/><path d="M20.279 17.609a10 10 0 0 1-2.7 2.69"/><path d="M21.818 10.1a10 10 0 0 1 0 3.8"/><path d="M3.721 6.391a10 10 0 0 1 2.7-2.69"/><path d="M6.391 20.279a10 10 0 0 1-2.69-2.7"/>',
    'circle-dot': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>',
    'hand': '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
    'undo': '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
    'building': '<rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>',
    'plug': '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
    'layers': '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    'key': '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
    'split': '<path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/>',
    'merge': '<path d="m8 6 4-4 4 4"/><path d="M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22"/><path d="m20 22-5-5"/>',
    'dollar': '<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    'pause': '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    'external': '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'
  };
  var warnedIcons = {};
  function icon(name, opts) {
    opts = opts || {};
    var body = ICONS[name];
    if (!body) {
      if (!warnedIcons[name]) { warnedIcons[name] = true; if (window.console) console.warn('[App.icon] unknown icon: ' + name); }
      body = ICONS.circle;
    }
    var size = opts.size ? ' style="width:' + Number(opts.size) + 'px;height:' + Number(opts.size) + 'px"' : '';
    var label = opts.label ? ' role="img" aria-label="' + esc(opts.label) + '"' : ' aria-hidden="true"';
    return '<svg class="i i-' + esc(name) + (opts.cls ? ' ' + esc(opts.cls) : '') + '"' + size + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"' + label + '>' + body + '</svg>';
  }

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */
  var FALLBACK_DATA = {
    meta: { today: '2026-11-06', now: '2026-11-06T16:30:00-06:00' },
    users: [{ id: 'u-demo', name: 'Demo Reviewer', email: 'reviewer@clearpath.example', initials: 'DR' }],
    currentUserId: 'u-demo',
    activeProfileId: 'p-clearpath',
    profiles: [{
      id: 'p-clearpath', name: 'ClearPath Financial', createdAt: '2026-10-01T09:00:00-05:00',
      members: [{ userId: 'u-demo', role: 'owner', joinedAt: '2026-10-01T09:00:00-05:00' }],
      invites: [], partners: [],
      budget: { profileCapUsd: 3, profileSpentTodayUsd: 0, globalCapUsd: 10, globalSpentTodayUsd: 0 },
      prefs: { equalHousingLegend: true }
    }],
    campaigns: [], references: [], rules: [], offers: [], sources: [], intake: [], assets: [],
    notifications: [], metrics: {}, costLedger: []
  };

  var seedFp = null;
  function hashStr(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + ':' + s.length; }
  function seedFingerprint() {
    if (seedFp == null) { try { seedFp = hashStr(JSON.stringify(window.DATA || FALLBACK_DATA)); } catch (e) { seedFp = 'unhashable'; } }
    return seedFp;
  }
  function seedState() {
    if (!window.DATA && window.console) console.warn('[App] window.DATA is missing; using an empty fallback dataset.');
    return normalizeState(clone(window.DATA || FALLBACK_DATA));
  }
  function normalizeState(s) {
    s = s || {};
    s.meta = s.meta || clone(FALLBACK_DATA.meta);
    ['users', 'profiles', 'campaigns', 'references', 'rules', 'offers', 'sources', 'intake', 'assets', 'notifications', 'costLedger']
      .forEach(function (k) { if (!Array.isArray(s[k])) s[k] = []; });
    s.metrics = s.metrics || {};
    if (!s.profiles.length) s.profiles = clone(FALLBACK_DATA.profiles);
    if (!s.users.length) s.users = clone(FALLBACK_DATA.users);
    if (!s.currentUserId) s.currentUserId = s.users[0].id;
    if (!s.activeProfileId) s.activeProfileId = s.profiles[0].id;
    s.profiles.forEach(function (p) {
      ['members', 'invites', 'partners'].forEach(function (k) { if (!Array.isArray(p[k])) p[k] = []; });
      p.budget = p.budget || { profileCapUsd: 3, profileSpentTodayUsd: 0, globalCapUsd: 10, globalSpentTodayUsd: 0 };
      p.prefs = p.prefs || {};
    });
    s.assets.forEach(function (a) {
      ['versions', 'decisions', 'changeRequests', 'events', 'chat', 'sourceRefs', 'states'].forEach(function (k) { if (!Array.isArray(a[k])) a[k] = []; });
      a.flags = a.flags || {};
      a.versions.forEach(function (v) {
        ['findings', 'checklist', 'securityAlerts'].forEach(function (k) { if (!Array.isArray(v[k])) v[k] = []; });
        v.content = v.content || { format: 'text', sections: [] };
        if (!Array.isArray(v.content.sections)) v.content.sections = [];
      });
      if (!a.latestVersionId && a.versions.length) a.latestVersionId = a.versions[a.versions.length - 1].id;
    });
    return s;
  }
  function loadState() {
    var raw = lsGet(STORE_KEY);
    if (raw) {
      try {
        var p = JSON.parse(raw);
        if (p && p.fp === seedFingerprint() && p.state) return normalizeState(p.state);
      } catch (e) { /* corrupt or stale; fall through to seed */ }
    }
    return seedState();
  }
  var saveTimer = null;
  function saveNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try { lsSet(STORE_KEY, JSON.stringify({ fp: seedFingerprint(), savedAt: Date.now(), state: App.state })); } catch (e) { /* ignore */ }
  }
  function saveSoon() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 80);
  }

  /* ------------------------------------------------------------------ */
  /* Demo clock                                                          */
  /* ------------------------------------------------------------------ */
  var bootReal = Date.now();
  function nowMs() {
    var meta = (App.state && App.state.meta) || {};
    var base = Date.parse(meta.now || '') || Date.now();
    var t = base + (Date.now() - bootReal);
    if (meta._lastNowMs && t <= meta._lastNowMs) t = meta._lastNowMs + 1000;
    return t;
  }
  function nowIso() {
    var t = nowMs();
    if (App.state && App.state.meta) App.state.meta._lastNowMs = t;
    return new Date(t).toISOString();
  }

  /* ------------------------------------------------------------------ */
  /* Date + number formatting                                            */
  /* ------------------------------------------------------------------ */
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
  function toMs(iso) {
    if (iso == null || iso === '') return NaN;
    if (typeof iso === 'number') return iso;
    if (iso instanceof Date) return iso.getTime();
    var s = String(iso);
    if (DATE_ONLY.test(s)) return Date.parse(s + 'T17:00:00-06:00'); // date-only means end of business day, Central
    return Date.parse(s);
  }
  function demoYear() { var t = (App.state && App.state.meta && App.state.meta.today) || '2026'; return String(t).slice(0, 4); }
  var dtf = null;
  function parts(ms) {
    var out = {};
    try {
      dtf = dtf || new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
      dtf.formatToParts(new Date(ms)).forEach(function (p) { out[p.type] = p.value; });
    } catch (e) {
      var d = new Date(ms), h = d.getHours();
      out = { year: String(d.getFullYear()), month: MONTHS[d.getMonth()], day: String(d.getDate()), hour: String(h % 12 || 12), minute: ('0' + d.getMinutes()).slice(-2), dayPeriod: h < 12 ? 'AM' : 'PM' };
    }
    return out;
  }
  function fmtDate(iso) {
    if (iso == null || iso === '') return '—';
    var s = String(iso);
    if (DATE_ONLY.test(s)) {
      var y = s.slice(0, 4), m = parseInt(s.slice(5, 7), 10), d = parseInt(s.slice(8, 10), 10);
      return MONTHS[m - 1] + ' ' + d + (y !== demoYear() ? ', ' + y : '');
    }
    var ms = toMs(iso); if (isNaN(ms)) return s;
    var p = parts(ms);
    return p.month + ' ' + p.day + (p.year !== demoYear() ? ', ' + p.year : '');
  }
  function fmtTime(iso) {
    if (iso == null || iso === '') return '—';
    if (DATE_ONLY.test(String(iso))) return fmtDate(iso);
    var ms = toMs(iso); if (isNaN(ms)) return String(iso);
    var p = parts(ms);
    return p.month + ' ' + p.day + (p.year !== demoYear() ? ', ' + p.year : '') + ', ' + p.hour + ':' + p.minute + ' ' + (p.dayPeriod || '');
  }
  function durationShort(absMs) {
    if (absMs < 3600e3) return Math.max(1, Math.round(absMs / 60e3)) + 'm';
    if (absMs < 86400e3) return Math.round(absMs / 3600e3) + 'h';
    return Math.round(absMs / 86400e3) + 'd';
  }
  function relTime(iso) {
    var ms = toMs(iso); if (isNaN(ms)) return '—';
    var diff = ms - nowMs(), a = Math.abs(diff);
    if (a < 45e3) return 'just now';
    if (a >= 30 * 86400e3) return fmtDate(iso);
    return diff > 0 ? 'in ' + durationShort(a) : durationShort(a) + ' ago';
  }
  function money(n) {
    if (n == null || n === '' || isNaN(n)) return '—';
    n = Number(n);
    var a = Math.abs(n), s;
    if (a !== 0 && a < 0.1) s = a.toFixed(4);
    else s = a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '-' : '') + '$' + s;
  }

  /* ------------------------------------------------------------------ */
  /* Labels                                                              */
  /* ------------------------------------------------------------------ */
  var STATUS = {
    'preflighting': { label: 'Preflighting', icon: 'loader' },
    'needs-review': { label: 'Needs review', icon: 'eye' },
    'changes-requested': { label: 'Changes requested', icon: 'undo' },
    'recheck-ready': { label: 'Recheck ready', icon: 'refresh' },
    'approved': { label: 'Approved', icon: 'circle-check' },
    'approved-with-exceptions': { label: 'Approved with exceptions', icon: 'alert' },
    'rejected': { label: 'Rejected', icon: 'circle-x' },
    're-review-due': { label: 'Re-review due', icon: 'history' },
    'needs-manual-review': { label: 'Needs manual review', icon: 'hand' },
    'security-alert': { label: 'Security alert', icon: 'shield-alert' }
  };
  var SEVERITY = {
    critical: { label: 'Critical', icon: 'octagon-alert', rank: 3 },
    major: { label: 'Major', icon: 'alert', rank: 2 },
    minor: { label: 'Minor', icon: 'info', rank: 1 }
  };
  var EVIDENCE = {
    'exact-match': { label: 'Exact match', icon: 'check' },
    'offer-mismatch': { label: 'Offer mismatch', icon: 'git-compare' },
    'missing-disclosure': { label: 'Missing disclosure', icon: 'circle-dashed' },
    'needs-judgment': { label: 'Needs judgment', icon: 'help' }
  };
  var RESULT = {
    'pass': { label: 'Pass', icon: 'check' },
    'flagged': { label: 'Flagged', icon: 'alert' },
    'na': { label: 'N/A', icon: 'circle-slash' },
    'not-checked': { label: 'Not checked', icon: 'circle-dashed' }
  };
  var RECHECK = {
    'resolved': { label: 'Resolved', icon: 'circle-check' },
    'still-present': { label: 'Still present', icon: 'alert' },
    'new': { label: 'New', icon: 'plus' },
    'outdated': { label: 'Outdated · verify', icon: 'help' }
  };
  var DISPOSITION = {
    'fix-required': { label: 'Fix required', icon: 'edit' },
    'dismissed': { label: 'Not an issue', icon: 'circle-slash' },
    'accepted-exception': { label: 'Accepted exception', icon: 'alert' },
    'open': { label: 'Open', icon: 'circle-dashed' }
  };
  var ORIGIN = {
    'upload': 'Upload', 'sync': 'Synced from source', 'email': 'Connected mailbox',
    'reviewer_edit': 'Reviewer edit', 'suggestion_applied': 'Suggestion applied'
  };
  var DECISION = {
    'approved': 'Approved', 'approved-with-exceptions': 'Approved with exceptions',
    'changes-requested': 'Changes requested', 'rejected': 'Rejected'
  };
  var SOURCES = {
    'gmail': { label: 'Gmail', icon: 'mail', group: 'google' },
    'google-drive': { label: 'Google Drive', icon: 'drive', group: 'google' },
    'google-sheets': { label: 'Google Sheets', icon: 'sheet', group: 'google' },
    'outlook': { label: 'Outlook', icon: 'mail', group: 'microsoft' },
    'onedrive': { label: 'OneDrive', icon: 'drive', group: 'microsoft' },
    'excel': { label: 'Excel', icon: 'sheet', group: 'microsoft' },
    'upload': { label: 'Upload', icon: 'upload', group: 'direct' },
    'paste': { label: 'Paste', icon: 'clipboard', group: 'direct' },
    'csv': { label: 'CSV/XLSX import', icon: 'sheet', group: 'direct' }
  };

  /* ------------------------------------------------------------------ */
  /* UI helpers (return HTML strings)                                    */
  /* ------------------------------------------------------------------ */
  function kbd(k) { return '<kbd class="kbd">' + esc(k) + '</kbd>'; }
  function badgeHtml(cls, iconName, label, sub, title) {
    return '<span class="badge ' + cls + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + (iconName ? icon(iconName) : '') +
      '<span>' + esc(label) + '</span>' + (sub ? '<span class="badge-sub">· ' + esc(sub) + '</span>' : '') + '</span>';
  }
  function statusBadge(status, subLabel) {
    var s = STATUS[status] || { label: status ? String(status).replace(/-/g, ' ') : 'Unknown', icon: 'circle' };
    return badgeHtml('st st-' + (STATUS[status] ? status : 'unknown'), s.icon, s.label, subLabel);
  }
  function severityBadge(sev) {
    var s = SEVERITY[sev]; if (!s) return '';
    return badgeHtml('sev sev-' + sev, s.icon, s.label);
  }
  function evidenceBadge(type) {
    var e = EVIDENCE[type]; if (!e) return '';
    return badgeHtml('ev ev-' + type, e.icon, e.label);
  }
  function resultBadge(result) {
    var r = RESULT[result] || RESULT['not-checked'];
    return badgeHtml('res res-' + (RESULT[result] ? result : 'not-checked'), r.icon, r.label);
  }
  function recheckBadge(label) {
    var r = RECHECK[label]; if (!r) return '';
    return badgeHtml('rc rc-' + label, r.icon, r.label);
  }
  function dispositionBadge(d) {
    var key = d || 'open', r = DISPOSITION[key]; if (!r) return '';
    return badgeHtml('disp disp-' + key, r.icon, r.label);
  }
  function dueBadge(iso) {
    var ms = toMs(iso); if (isNaN(ms)) return '<span class="badge badge-outline">No due date</span>';
    var diff = ms - nowMs();
    if (diff < 0) return badgeHtml('due due-overdue', 'clock', 'Overdue ' + durationShort(-diff), null, 'Due ' + fmtTime(iso));
    if (diff < 86400e3) return badgeHtml('due due-soon', 'clock', 'Due in ' + durationShort(diff), null, 'Due ' + fmtTime(iso));
    return badgeHtml('due due-ok', 'clock', 'Due ' + fmtDate(iso), null, 'Due ' + fmtTime(iso));
  }
  function sourceIcon(provider, opts) {
    opts = opts || {};
    var s = SOURCES[provider] || { label: provider || 'Source', icon: 'plug', group: 'direct' };
    var ic = '<span class="src src-' + esc(s.group) + '" title="' + esc(s.label) + '"' + (opts.label ? ' aria-hidden="true"' : ' role="img" aria-label="' + esc(s.label) + '"') + '>' + icon(s.icon) + '</span>';
    return opts.label ? '<span class="src-labeled">' + ic + '<span class="truncate">' + esc(typeof opts.label === 'string' ? opts.label : s.label) + '</span></span>' : ic;
  }
  function avatar(user, opts) {
    opts = opts || {};
    var u = typeof user === 'string' ? userById(user) : user;
    var name = u ? u.name : (typeof user === 'string' ? user : 'Unknown');
    var ini = (u && u.initials) || initialsOf(name);
    var size = opts.size ? ' avatar-' + opts.size : '';
    return '<span class="avatar' + size + '" title="' + esc(name) + '" role="img" aria-label="' + esc(name) + '">' + esc(ini) + '</span>';
  }
  function sample() { return '<span class="tag tag-sample" title="Sample number for the prototype, not measured">sample</span>'; }
  function illustrative() { return '<span class="tag tag-illustrative" title="Illustrative state: this connector would not be wired in the first real build">illustrative</span>'; }
  function tag(text, opts) { opts = opts || {}; return '<span class="tag' + (opts.cls ? ' ' + esc(opts.cls) : '') + '"' + (opts.title ? ' title="' + esc(opts.title) + '"' : '') + '>' + (opts.icon ? icon(opts.icon) : '') + esc(text) + '</span>'; }
  function aiChip(text) { return '<span class="badge badge-outline ai-chip">' + icon('sparkles') + '<span>' + esc(text || 'AI preflight · advisory, human decision required') + '</span></span>'; }
  function sha(s) { return s ? '<code class="sha" title="Content hash (short)">sha ' + esc(s) + '</code>' : ''; }
  function empty(title, body, actionHtml) {
    return '<div class="empty"><div class="empty-icon">' + icon('inbox') + '</div><div class="empty-title">' + esc(title) + '</div>' +
      (body ? '<p class="empty-body">' + esc(body) + '</p>' : '') + (actionHtml || '') + '</div>';
  }
  function button(label, o) {
    o = o || {};
    var variant = o.variant || 'outline', size = o.size || 'md';
    var cls = ['btn', 'btn-' + variant, 'btn-' + size];
    if (o.iconOnly) cls.push('btn-icon');
    if (o.block) cls.push('btn-block');
    if (o.cls) cls.push(o.cls);
    var text = o.iconOnly ? '<span class="sr-only">' + esc(label) + '</span>' :
      (o.labelHtml != null ? o.labelHtml : (label != null && label !== '' ? '<span>' + esc(label) + '</span>' : ''));
    var inner = (o.icon ? icon(o.icon) : '') + text + (o.iconRight ? icon(o.iconRight) : '') + (o.kbd ? kbd(o.kbd) : '');
    var a = {
      'class': cls.join(' '), id: o.id, title: o.title || (o.iconOnly ? label : null),
      'data-action': o.action, 'aria-label': o.ariaLabel, 'data-tip': o.tip,
      'aria-pressed': o.pressed == null ? null : String(!!o.pressed)
    };
    if (o.href) {
      return '<a href="' + esc(o.href) + '"' + htmlAttrs(a) + (o.disabled ? ' aria-disabled="true" tabindex="-1"' : '') + dataAttrs(o.data) + htmlAttrs(o.attrs) + '>' + inner + '</a>';
    }
    return '<button type="' + (o.type || 'button') + '"' + htmlAttrs(a) + (o.disabled ? ' disabled' : '') + dataAttrs(o.data) + htmlAttrs(o.attrs) + '>' + inner + '</button>';
  }
  function chip(label, o) {
    o = o || {};
    var cls = 'chip' + (o.size === 'sm' ? ' chip-sm' : '') + (o.cls ? ' ' + o.cls : '');
    var inner = (o.dot ? '<span class="dot dot-' + esc(o.dot) + '" aria-hidden="true"></span>' : '') + (o.icon ? icon(o.icon) : '') +
      '<span class="truncate">' + esc(label) + '</span>' + (o.count != null ? '<span class="count">' + esc(o.count) + '</span>' : '');
    if (o.action) {
      return '<button type="button" class="' + cls + '" data-action="' + esc(o.action) + '"' + dataAttrs(o.data) +
        (o.pressed != null ? ' aria-pressed="' + (!!o.pressed) + '"' : '') + (o.title ? ' title="' + esc(o.title) + '"' : '') + '>' + inner + '</button>';
    }
    if (o.href) return '<a class="' + cls + '" href="' + esc(o.href) + '"' + (o.title ? ' title="' + esc(o.title) + '"' : '') + '>' + inner + '</a>';
    return '<span class="' + cls + '"' + (o.title ? ' title="' + esc(o.title) + '"' : '') + '>' + inner + '</span>';
  }
  function tabs(id, items, activeId, action, opts) {
    opts = opts || {};
    var html = (items || []).map(function (it) {
      var sel = it.id === activeId;
      return '<button type="button" role="tab" class="tab" id="' + esc(id + '-tab-' + it.id) + '" aria-selected="' + sel + '" tabindex="' + (sel ? '0' : '-1') +
        '" data-action="' + esc(action) + '" data-tab="' + esc(it.id) + '" data-tabs="' + esc(id) + '"' + dataAttrs(it.data) + '>' +
        (it.icon ? icon(it.icon) : '') + '<span>' + esc(it.label) + '</span>' + (it.count != null ? '<span class="count">' + esc(it.count) + '</span>' : '') + '</button>';
    }).join('');
    return '<div class="tabs' + (opts.variant === 'pills' ? ' tabs-pills' : '') + '" role="tablist" id="' + esc(id) + '"' + (opts.label ? ' aria-label="' + esc(opts.label) + '"' : '') + '>' + html + '</div>';
  }
  function table(columns, rows, opts) {
    opts = opts || {};
    columns = columns || []; rows = rows || [];
    var head = '<thead><tr>' + columns.map(function (c) {
      var cls = [c.align === 'right' ? 'num' : '', c.align === 'center' ? 'center' : '', c.shrink ? 'shrink' : '', c.headerCls || ''].join(' ').trim();
      return '<th scope="col"' + (cls ? ' class="' + cls + '"' : '') + (c.width ? ' style="width:' + esc(c.width) + '"' : '') + '>' +
        (c.srOnly ? '<span class="sr-only">' + esc(c.label) + '</span>' : (c.headerHtml != null ? c.headerHtml : esc(c.label))) + '</th>';
    }).join('') + '</tr></thead>';
    var body;
    if (!rows.length) {
      body = '<tr class="empty-row"><td colspan="' + columns.length + '">' + (opts.empty != null ? opts.empty : 'Nothing to show.') + '</td></tr>';
    } else {
      body = rows.map(function (r, i) {
        if (r && r._groupHtml != null) return '<tr class="group-row"><td colspan="' + columns.length + '">' + r._groupHtml + '</td></tr>';
        var ra = opts.rowAttrs ? (opts.rowAttrs(r, i) || {}) : {};
        var cells = columns.map(function (c) {
          var cls = [c.align === 'right' ? 'num' : '', c.align === 'center' ? 'center' : '', c.shrink ? 'shrink' : '', c.cls || ''].join(' ').trim();
          var v = c.render ? c.render(r, i) : esc(r[c.key]);
          return '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + (v == null ? '' : v) + '</td>';
        }).join('');
        return '<tr' + htmlAttrs(ra) + '>' + cells + '</tr>';
      }).join('');
    }
    return '<div class="table-wrap' + (opts.flush ? ' flush' : '') + '"' + (opts.id ? ' id="' + esc(opts.id) + '"' : '') + '><table class="table' + (opts.dense ? ' table-dense' : '') + '">' +
      (opts.caption ? '<caption class="sr-only">' + esc(opts.caption) + '</caption>' : '') + head + '<tbody>' + body + '</tbody></table></div>';
  }
  function meter(value, max, o) {
    o = o || {};
    var pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    var tone = o.tone || (o.auto !== false ? (pct >= 100 ? 'is-danger' : pct >= 80 ? 'is-warn' : '') : '');
    return '<div class="meter ' + esc(tone) + '" role="meter" aria-valuemin="0" aria-valuemax="' + esc(max) + '" aria-valuenow="' + esc(value) + '" aria-label="' + esc(o.label || 'Progress') + '"><span style="width:' + pct.toFixed(1) + '%"></span></div>';
  }
  function hbars(items, o) {
    o = o || {};
    var max = o.max || Math.max.apply(null, (items || []).map(function (it) { return Number(it.value) || 0; }).concat([1]));
    return '<div class="hbars">' + (items || []).map(function (it) {
      var pct = max > 0 ? Math.max(0, Math.min(100, (Number(it.value) || 0) / max * 100)) : 0;
      return '<span class="hbar-label" title="' + esc(it.label) + '">' + esc(it.label) + '</span>' +
        '<span class="hbar-track" aria-hidden="true"><span class="hbar-fill" style="display:block;width:' + pct.toFixed(1) + '%"></span></span>' +
        '<span class="hbar-value">' + esc(it.display != null ? it.display : it.value) + '</span>';
    }).join('') + '</div>';
  }
  function steps(list, activeIndex, o) {
    o = o || {};
    return '<ol class="steps">' + (list || []).map(function (label, i) {
      var st = i < activeIndex ? 'is-done' : (i === activeIndex ? (o.failed ? 'is-failed' : 'is-active') : '');
      var ic = i < activeIndex ? icon('circle-check') : (i === activeIndex ? (o.failed ? icon('circle-x') : icon('loader', { cls: 'spin' })) : icon('circle-dashed'));
      return '<li class="step ' + st + '">' + ic + '<span>' + esc(label) + '</span></li>';
    }).join('') + '</ol>';
  }
  function field(label, controlHtml, o) {
    o = o || {};
    return '<div class="field' + (o.cls ? ' ' + esc(o.cls) : '') + '"><label class="label"' + (o.id ? ' for="' + esc(o.id) + '"' : '') + '>' + esc(label) +
      (o.optional ? ' <span class="optional">(optional)</span>' : '') + (o.labelExtra || '') + '</label>' + controlHtml +
      (o.hint ? '<div class="hint"' + (o.id ? ' id="' + esc(o.id) + '-hint"' : '') + '>' + esc(o.hint) + '</div>' : '') +
      (o.error ? '<div class="error-text">' + icon('alert') + esc(o.error) + '</div>' : '') + '</div>';
  }
  function select(id, options, value, o) {
    o = o || {};
    return '<select class="select' + (o.size === 'sm' ? ' input-sm' : '') + '" id="' + esc(id) + '"' + (o.name ? ' name="' + esc(o.name) + '"' : '') +
      (o.change ? ' data-change="' + esc(o.change) + '"' : '') + dataAttrs(o.data) + (o.disabled ? ' disabled' : '') + (o.ariaLabel ? ' aria-label="' + esc(o.ariaLabel) + '"' : '') + '>' +
      (options || []).map(function (op) {
        var v = typeof op === 'object' ? op.value : op, l = typeof op === 'object' ? op.label : op;
        return '<option value="' + esc(v) + '"' + (String(v) === String(value) ? ' selected' : '') + '>' + esc(l) + '</option>';
      }).join('') + '</select>';
  }
  var CALLOUT_ICON = { info: 'info', success: 'circle-check', warning: 'alert', danger: 'octagon-alert', security: 'shield-alert', recheck: 'refresh', rereview: 'history', neutral: 'info' };
  function callout(variant, title, bodyHtml, o) {
    o = o || {};
    return '<div class="callout callout-' + esc(variant || 'neutral') + '"' + (o.id ? ' id="' + esc(o.id) + '"' : '') + ' role="' + (o.role || (variant === 'security' || variant === 'danger' ? 'alert' : 'note')) + '">' +
      icon(o.icon || CALLOUT_ICON[variant] || 'info') + '<div class="callout-content">' + (title ? '<div class="callout-title">' + esc(title) + '</div>' : '') +
      (bodyHtml ? '<div class="callout-body">' + bodyHtml + '</div>' : '') + (o.actionsHtml ? '<div class="callout-actions">' + o.actionsHtml + '</div>' : '') + '</div></div>';
  }
  function dl(pairs) {
    return '<dl class="dl">' + (pairs || []).filter(Boolean).map(function (p) { return '<dt>' + esc(p[0]) + '</dt><dd>' + (p[1] == null || p[1] === '' ? '<span class="muted">—</span>' : p[1]) + '</dd>'; }).join('') + '</dl>';
  }
  function skeleton(lines) {
    var n = lines || 4, out = '<div aria-busy="true" aria-label="Loading"><span class="skel skel-title"></span>';
    for (var i = 0; i < n; i++) out += '<span class="skel skel-line ' + (['w-80', '', 'w-60', 'w-40'][i % 4]) + '"></span>';
    return out + '</div>';
  }
  function versionLabel(asset, version) {
    if (!version) return '';
    var bits = ['V' + version.n];
    if (asset && version.id === asset.latestVersionId) bits.push('Latest');
    if (asset && version.id === asset.approvedVersionId) bits.push('Approved');
    return bits.join(' · ');
  }

  /* ------------------------------------------------------------------ */
  /* Data helpers                                                        */
  /* ------------------------------------------------------------------ */
  function S() { return App.state; }
  function profile() {
    var s = S(); if (!s) return null;
    return s.profiles.find(function (p) { return p.id === s.activeProfileId; }) || s.profiles[0] || null;
  }
  function me() {
    var s = S();
    return s.users.find(function (u) { return u.id === s.currentUserId; }) || s.users[0] || FALLBACK_DATA.users[0];
  }
  function memberRecord(p, userId) { return p ? (p.members || []).find(function (m) { return m.userId === userId; }) : null; }
  function isOwner(profileId) {
    var p = profileId ? S().profiles.find(function (x) { return x.id === profileId; }) : profile();
    var m = memberRecord(p, me().id);
    return !!(m && m.role === 'owner');
  }
  function isMember(profileId, userId) {
    var p = S().profiles.find(function (x) { return x.id === profileId; });
    return !!memberRecord(p, userId || me().id);
  }
  function myProfiles() {
    var u = me();
    var list = S().profiles.filter(function (p) { return !p.members || !p.members.length || memberRecord(p, u.id); });
    return list.length ? list : S().profiles.slice();
  }
  function assetsFor(profileId) {
    var pid = profileId || S().activeProfileId;
    return S().assets.filter(function (a) { return a.profileId === pid; });
  }
  function findAsset(id) { return S().assets.find(function (a) { return a.id === id; }) || null; }
  function asset(id, opts) {
    var a = findAsset(id);
    if (!a) return null;
    if (opts && opts.anyProfile) return a;
    return a.profileId === S().activeProfileId ? a : null; // profile isolation: other profiles' assets do not exist here
  }
  function latestVersion(a) {
    if (!a || !a.versions || !a.versions.length) return null;
    return a.versions.find(function (v) { return v.id === a.latestVersionId; }) || a.versions[a.versions.length - 1];
  }
  function version(a, versionId) {
    if (!a || !a.versions) return null;
    if (versionId == null) return latestVersion(a);
    var byId = a.versions.find(function (v) { return v.id === versionId; });
    if (byId) return byId;
    var m = /^v?(\d+)$/i.exec(String(versionId));
    return m ? (a.versions.find(function (v) { return v.n === parseInt(m[1], 10); }) || null) : null;
  }
  function ruleById(id) {
    var s = S(), pid = s.activeProfileId;
    return s.rules.find(function (r) { return r.id === id && r.profileId === pid; }) ||
      s.rules.find(function (r) { return r.id === id && r.profileId == null; }) ||
      s.rules.find(function (r) { return r.id === id; }) || null;
  }
  function ruleVersion(rule, v) {
    if (!rule || !rule.versions || !rule.versions.length) return null;
    if (v == null) return rule.versions[rule.versions.length - 1];
    return rule.versions.find(function (x) { return x.v === v; }) || null;
  }
  function offerById(id) {
    var s = S(), pid = s.activeProfileId;
    return s.offers.find(function (o) { return o.id === id && o.profileId === pid; }) || s.offers.find(function (o) { return o.id === id; }) || null;
  }
  function offerVersion(offer, v) {
    if (!offer || !offer.versions || !offer.versions.length) return null;
    if (v == null) return offer.versions[offer.versions.length - 1];
    return offer.versions.find(function (x) { return x.v === v; }) || null;
  }
  function sourceById(id) { return S().sources.find(function (x) { return x.id === id; }) || null; }
  function userById(id) { return S().users.find(function (u) { return u.id === id; }) || null; }
  function campaignById(id) { return S().campaigns.find(function (c) { return c.id === id; }) || null; }
  function referenceById(id) { return S().references.find(function (r) { return r.id === id; }) || null; }
  function partnerById(id, profileId) {
    var list = profileId ? [S().profiles.find(function (p) { return p.id === profileId; })] : [profile()].concat(S().profiles);
    for (var i = 0; i < list.length; i++) {
      var p = list[i]; if (!p) continue;
      var hit = (p.partners || []).find(function (x) { return x.id === id; });
      if (hit) return hit;
    }
    return null;
  }
  function profileOf(a) { return a ? S().profiles.find(function (p) { return p.id === a.profileId; }) : null; }
  // Hidden-text security alerts block decisions until acknowledged; visible "possible injection" warnings do not.
  function blockingAlerts(v) { return v ? (v.securityAlerts || []).filter(function (s) { return s.kind !== 'possible-injection' && !s.acknowledged; }) : []; }
  function isOpenFinding(f) { return f && f.recheck !== 'resolved' && f.disposition !== 'dismissed'; }
  function openFindings(v) { return v ? (v.findings || []).filter(isOpenFinding) : []; }
  function topSeverity(v) {
    var best = null;
    openFindings(v).forEach(function (f) { if (SEVERITY[f.severity] && (!best || SEVERITY[f.severity].rank > SEVERITY[best].rank)) best = f.severity; });
    return best;
  }
  function navCounts() {
    var pid = S().activeProfileId;
    return {
      queue: assetsFor(pid).filter(function (a) { return a.status === 'needs-review' || a.status === 'recheck-ready'; }).length,
      intake: S().intake.filter(function (i) { return i.profileId === pid && i.status === 'pending'; }).length
    };
  }
  function isSelfApproval(a, v) {
    var u = me();
    if (v && v.authorName && v.authorName === u.name) return true;
    return !!(a && a.submitter && a.submitter.email && u.email && String(a.submitter.email).toLowerCase() === String(u.email).toLowerCase());
  }

  /* ------------------------------------------------------------------ */
  /* Event bus                                                           */
  /* ------------------------------------------------------------------ */
  var bus = {};
  function on(name, fn) {
    (bus[name] = bus[name] || []).push(fn);
    return function off() { bus[name] = (bus[name] || []).filter(function (f) { return f !== fn; }); };
  }
  function emit(name, payload) {
    (bus[name] || []).slice().forEach(function (fn) {
      try { fn(payload); } catch (e) { if (window.console) console.error('[App] listener for "' + name + '" failed', e); }
    });
    if (name === 'data-changed') { saveSoon(); scheduleCounts(); }
  }

  /* ------------------------------------------------------------------ */
  /* Mutations: audit, notifications, versions, decisions                */
  /* ------------------------------------------------------------------ */
  function log(assetId, actorName, kind, text) {
    var a = findAsset(assetId);
    if (!a) { if (window.console) console.warn('[App.log] unknown asset ' + assetId); return null; }
    var ev = { at: nowIso(), actor: actorName || me().name, kind: kind || 'note', text: text || '' };
    a.events.push(ev);
    emit('data-changed', { kind: 'event', assetId: assetId });
    return ev;
  }
  function logProfile(actorName, kind, text, profileId) {
    var p = profileId ? S().profiles.find(function (x) { return x.id === profileId; }) : profile();
    if (!p) return null;
    if (!Array.isArray(p.events)) p.events = [];
    var ev = { at: nowIso(), actor: actorName || me().name, kind: kind || 'note', text: text || '' };
    p.events.push(ev);
    emit('data-changed', { kind: 'profile-event' });
    return ev;
  }
  function notify(text, href) {
    var n = { id: nextId('n', S().notifications.map(function (x) { return x.id; }), 100), at: nowIso(), text: text, read: false, href: href || null, profileId: S().activeProfileId };
    S().notifications.unshift(n);
    emit('data-changed', { kind: 'notification' });
    return n;
  }
  function visibleNotifications() {
    var pid = S().activeProfileId;
    return S().notifications.filter(function (n) { return !n.profileId || n.profileId === pid; });
  }
  function allRunIds() {
    var ids = [];
    S().assets.forEach(function (a) { a.versions.forEach(function (v) { if (v.run && v.run.id) ids.push(v.run.id); }); });
    S().costLedger.forEach(function (c) { if (c.runId) ids.push(c.runId); });
    return ids;
  }
  function priceFor(model) {
    var m = String(model || '').toLowerCase();
    if (m.indexOf('opus') >= 0) return [5, 25];
    if (m.indexOf('sonnet') >= 0) return [3, 15];
    return [1, 5];
  }
  function sectionsText(sections) { return (sections || []).map(function (s) { return s.text || ''; }).join('\n'); }

  function newVersion(assetId, opts) {
    opts = opts || {};
    var a = findAsset(assetId);
    if (!a) { toast('Asset ' + assetId + ' not found', 'error'); return null; }
    var prev = latestVersion(a);
    var u = me();
    var n = a.versions.reduce(function (m, v) { return Math.max(m, v.n || 0); }, 0) + 1;

    // Merge sections by id into a copy of the previous content (callers may pass only edited sections).
    var content = clone(prev ? prev.content : { format: 'text', sections: [] }) || { format: 'text', sections: [] };
    content.sections = Array.isArray(content.sections) ? content.sections : [];
    (opts.sections || []).forEach(function (sec) {
      var existing = content.sections.find(function (x) { return x.id === sec.id; });
      if (existing) { if (sec.text != null) existing.text = sec.text; if (sec.label) existing.label = sec.label; }
      else content.sections.push({ id: sec.id || ('s' + (content.sections.length + 1)), label: sec.label || 'Section', text: sec.text || '' });
      if (content.visual && sec.id && Object.prototype.hasOwnProperty.call(content.visual, sec.id) && sec.text != null) content.visual[sec.id] = sec.text;
    });
    if (opts.subject != null) content.subject = opts.subject;
    if (opts.hidden) content.hidden = opts.hidden;

    var fullText = normText(sectionsText(content.sections) + '\n' + (content.subject || ''));
    var sectionText = {};
    content.sections.forEach(function (s) { sectionText[s.id] = normText(s.text); });
    var hiddenText = normText((content.hidden || []).map(function (h) { return h.text; }).join('\n'));

    // Deterministic recheck: carry findings forward and label them.
    var resolved = 0, still = 0;
    var fPrefix = 'F' + (String(a.id).replace(/\D/g, '') || a.id) + '-' + n + '-';
    var findings = ((prev && prev.findings) || []).filter(function (f) { return f.recheck !== 'resolved'; }).map(function (f, k) {
      var nf = clone(f);
      nf.id = fPrefix + (k + 1);
      nf.carriedFrom = f.id;
      var q = normText(f.quote);
      var hay = (f.sectionId && sectionText[f.sectionId] != null) ? sectionText[f.sectionId] : fullText;
      var present;
      if (q) present = hay.indexOf(q) >= 0 || fullText.indexOf(q) >= 0;
      else if (f.suggestedCopy) present = fullText.indexOf(normText(f.suggestedCopy)) < 0; // missing-disclosure fixed when suggested copy now appears
      else present = true;
      nf.recheck = present ? 'still-present' : 'resolved';
      if (present) {
        still += 1;
        if (f.disposition === 'accepted-exception') { nf.disposition = null; nf.dispositionNote = null; }
        else if (f.disposition === 'dismissed') nf.dispositionNote = (f.dispositionNote ? f.dispositionNote + ' ' : '') + '(carried forward: text unchanged)';
      } else {
        resolved += 1;
      }
      return nf;
    });

    var alerts = ((prev && prev.securityAlerts) || []).filter(function (al) {
      var t = normText(al.text);
      return !t || fullText.indexOf(t) >= 0 || hiddenText.indexOf(t) >= 0;
    }).map(function (al) { var c = clone(al); c.acknowledged = false; return c; });

    var checklist = ((prev && prev.checklist) || []).map(function (row) {
      var c = clone(row);
      if (row.result === 'flagged') {
        var stillFlagged = findings.some(function (f) { return f.ruleId === row.ruleId && f.recheck === 'still-present' && f.disposition !== 'dismissed'; });
        if (!stillFlagged) c.result = 'pass';
      }
      return c;
    });

    // Simulated re-run cost, metered against the budget.
    var model = (prev && prev.run && prev.run.model) || 'claude-haiku';
    var tokensIn = 1800 + Math.round(fullText.length / 3.6);
    var tokensOut = 260 + findings.length * 90;
    var price = priceFor(model);
    var cost = Math.round(((tokensIn * price[0] + tokensOut * price[1]) / 1e6) * 10000) / 10000;
    var p = profileOf(a);
    var b = (p && p.budget) || {};
    var overCap = (b.profileCapUsd != null && (b.profileSpentTodayUsd || 0) + cost > b.profileCapUsd) ||
      (b.globalCapUsd != null && (b.globalSpentTodayUsd || 0) + cost > b.globalCapUsd);
    var runId = nextId('R', allRunIds(), 5500);
    var run = {
      id: runId, model: model, tokensIn: overCap ? 0 : tokensIn, tokensOut: overCap ? 0 : tokensOut, costUsd: overCap ? 0 : cost,
      seeded: false, simulated: true, status: overCap ? 'failed' : 'complete',
      failReason: overCap ? 'Run declined: it would exceed the daily AI cap. Deterministic recheck still ran.' : null,
      coverage: clone((prev && prev.run && prev.run.coverage) || { copy: 'checked', image: 'n/a', disclosures: 'checked', stateLaw: 'not covered', links: 'not provided' })
    };
    if (!overCap) {
      b.profileSpentTodayUsd = Math.round(((b.profileSpentTodayUsd || 0) + cost) * 10000) / 10000;
      b.globalSpentTodayUsd = Math.round(((b.globalSpentTodayUsd || 0) + cost) * 10000) / 10000;
      S().costLedger.push({ at: nowIso(), runId: runId, assetId: a.id, model: model, tokensIn: tokensIn, tokensOut: tokensOut, costUsd: cost, cached: false });
    }

    var vid = a.id + '-v' + n;
    while (a.versions.some(function (v) { return v.id === vid; })) vid += 'b';
    var nv = {
      id: vid, n: n, createdAt: nowIso(), origin: opts.origin || 'reviewer_edit', authorName: opts.authorName || u.name,
      sha: shortSha(), content: content, run: run, findings: findings, checklist: checklist, securityAlerts: alerts
    };
    a.versions.push(nv);
    a.latestVersionId = nv.id;
    a.subLabel = null;
    if (a.approvedVersionId) a.flags.changedAfterApproval = true;
    var forcedManual = alerts.some(function (al) { return al.kind !== 'possible-injection'; }) || overCap;
    a.status = forcedManual ? 'needs-manual-review' : 'recheck-ready';
    (a.changeRequests || []).forEach(function (cr) { if (cr.status === 'open' && !cr.responseVersionId) cr.responseVersionId = nv.id; });

    var originLabel = ORIGIN[nv.origin] || nv.origin;
    log(a.id, nv.authorName, 'version', 'V' + n + ' created (' + originLabel + ') · sha ' + nv.sha + ' · recheck: ' + resolved + ' resolved, ' + still + ' still present' +
      (overCap ? ' · AI re-run declined (daily cap)' : ' · run ' + runId + ' ' + money(cost)));
    if (nv.origin === 'sync' || nv.origin === 'email' || nv.origin === 'upload') {
      notify('New version of ' + a.id + ' arrived: V' + n + ' · ' + (a.title || ''), '#asset-' + a.id);
    }
    emit('data-changed', { kind: 'version', assetId: a.id, versionId: nv.id });
    return nv;
  }

  function memberCount(p) { return p ? (p.members || []).length : 0; }
  function canDecide(assetId, versionId, decision, opts) {
    opts = opts || {};
    function no(reason) { return { ok: false, reason: reason }; }
    var a = findAsset(assetId); if (!a) return no('Asset not found.');
    var v = version(a, versionId); if (!v) return no('Version not found.');
    if (!DECISION[decision]) return no('Unknown decision.');
    if (v.id !== a.latestVersionId) return no('Only the latest version can be decided. V' + v.n + ' is an earlier version.');
    if (a.status === 'preflighting' || (v.run && v.run.status === 'running')) return no('Preflight is still running.');
    if (blockingAlerts(v).length) return no('Acknowledge the security alert before deciding.');
    var isApproval = decision === 'approved' || decision === 'approved-with-exceptions';
    if (isApproval && a.approvedVersionId === v.id && (a.status === 'approved' || a.status === 'approved-with-exceptions')) return no('V' + v.n + ' is already approved.');
    var open = openFindings(v);
    var self = isSelfApproval(a, v);
    if (decision === 'approved') {
      var cm = open.filter(function (f) { return f.severity !== 'minor'; });
      if (cm.length) return no(plural(cm.length, 'open Critical or Major finding') + '. Mark ' + (cm.length === 1 ? 'it' : 'them') + ' Not an issue, or use Approve with exceptions.');
      var undecided = open.filter(function (f) { return f.disposition == null || f.disposition === 'fix-required'; });
      if (undecided.length) return no(plural(undecided.length, 'finding') + ' still need' + (undecided.length === 1 ? 's' : '') + ' a disposition.');
    }
    if (decision === 'approved-with-exceptions') {
      var needs = open.filter(function (f) { return f.severity !== 'minor'; });
      if (!needs.length) return no('There are no open Critical or Major findings. Use Approve.');
      if (self && memberCount(profileOf(a)) > 1) return no('You authored this version. Approving it with exceptions needs another member.');
      if (opts.exceptions) {
        var byId = {};
        opts.exceptions.forEach(function (e) { byId[e.findingId] = e; });
        var missing = needs.filter(function (f) { return !byId[f.id]; });
        if (missing.length) return no('Add a justification for ' + missing.map(function (f) { return f.id; }).join(', ') + '.');
        var weak = opts.exceptions.filter(function (e) { return !e.reason || String(e.text || '').trim().length < 40; });
        if (weak.length) return no('Each exception needs a reason and a justification of at least 40 characters.');
        var minorsOpen = open.filter(function (f) { return f.severity === 'minor' && (f.disposition == null || f.disposition === 'fix-required') && !byId[f.id]; });
        if (minorsOpen.length) return no(plural(minorsOpen.length, 'Minor finding') + ' still need' + (minorsOpen.length === 1 ? 's' : '') + ' a disposition.');
      }
    }
    return { ok: true, selfApproval: isApproval && self, openFindings: open };
  }

  function decide(assetId, versionId, decision, opts) {
    opts = opts || {};
    var a = findAsset(assetId);
    if (!a) { toast('Asset not found', 'error'); return null; }
    var v = version(a, versionId) || latestVersion(a);
    if (!v) { toast('This asset has no version to decide on.', 'error'); return null; }
    var chk = canDecide(a.id, v.id, decision, opts);
    if (!chk.ok && !opts.force) { toast(chk.reason, 'error'); return null; }
    var u = me();
    var isApproval = decision === 'approved' || decision === 'approved-with-exceptions';
    var selfApproved = isApproval && isSelfApproval(a, v);
    var exceptions = decision === 'approved-with-exceptions' ? (opts.exceptions || []).map(function (e) {
      return { findingId: e.findingId, reason: e.reason, text: String(e.text || '').trim() };
    }) : [];
    var allDecisionIds = [];
    S().assets.forEach(function (x) { (x.decisions || []).forEach(function (d) { allDecisionIds.push(d.id); }); });
    var d = {
      id: nextId('D', allDecisionIds, 900), versionId: v.id, decision: decision, approverId: u.id, at: nowIso(), sha: v.sha,
      exceptions: exceptions, selfApproved: selfApproved, attested: !!opts.attested, note: opts.note || ''
    };
    a.decisions.push(d);
    exceptions.forEach(function (e) {
      var f = (v.findings || []).find(function (x) { return x.id === e.findingId; });
      if (f) { f.disposition = 'accepted-exception'; f.dispositionNote = e.text; f.exceptionReason = e.reason; }
    });
    a.status = decision;
    if (isApproval) {
      a.approvedVersionId = v.id;
      a.subLabel = 'V' + v.n;
      a.flags.changedAfterApproval = false;
      a.flags.reReviewDue = false;
      a.flags.selfApproved = selfApproved;
      a.flags.exceptionsCount = exceptions.length;
      (a.changeRequests || []).forEach(function (cr) { if (cr.status === 'open') cr.status = 'resolved'; });
    } else {
      a.subLabel = null;
    }
    var text;
    if (decision === 'approved') text = 'Approved V' + v.n + ' · sha ' + v.sha + (selfApproved ? ' · self-approved' : '');
    else if (decision === 'approved-with-exceptions') {
      text = 'Approved V' + v.n + ' with ' + plural(exceptions.length, 'exception') + ' · sha ' + v.sha + (selfApproved ? ' · self-approved' : '') +
        ' (' + exceptions.map(function (e) { return e.findingId + ': ' + e.reason; }).join('; ') + ')';
    } else if (decision === 'changes-requested') text = 'Requested changes on V' + v.n;
    else text = 'Rejected V' + v.n;
    if (opts.note) text += '. Note: ' + opts.note;
    log(a.id, u.name, 'decision', text);
    if (decision === 'approved-with-exceptions') {
      notify(u.name + ' approved ' + a.id + ' V' + v.n + ' with ' + plural(exceptions.length, 'exception') + '. Owner review recommended.', '#asset-' + a.id);
    }
    emit('data-changed', { kind: 'decision', assetId: a.id, versionId: v.id, decision: decision });
    return d;
  }

  function requestChanges(assetId, versionId, opts) {
    opts = opts || {};
    var a = findAsset(assetId); if (!a) { toast('Asset not found', 'error'); return null; }
    var v = version(a, versionId) || latestVersion(a);
    var chk = canDecide(a.id, v.id, 'changes-requested');
    if (!chk.ok && !opts.force) { toast(chk.reason, 'error'); return null; }
    var items = (opts.items || []).filter(function (i) { return i && String(i.text || '').trim(); });
    if (!items.length) { toast('Add at least one item to the checklist.', 'error'); return null; }
    var u = me();
    var allCr = [];
    S().assets.forEach(function (x) { (x.changeRequests || []).forEach(function (c) { allCr.push(c.id); }); });
    (a.changeRequests || []).forEach(function (c) { if (c.status === 'open') c.status = 'resolved'; });
    var cr = {
      id: nextId('CR', allCr, 300), versionId: v.id, at: nowIso(), authorId: u.id,
      items: items.map(function (i) { return { findingId: i.findingId || null, text: String(i.text).trim() }; }),
      note: opts.note || '', dueDate: opts.dueDate || null, status: 'open'
    };
    a.changeRequests.push(cr);
    cr.items.forEach(function (i) {
      var f = i.findingId && (v.findings || []).find(function (x) { return x.id === i.findingId; });
      if (f && !f.disposition) f.disposition = 'fix-required';
    });
    var allDecisionIds = [];
    S().assets.forEach(function (x) { (x.decisions || []).forEach(function (d) { allDecisionIds.push(d.id); }); });
    a.decisions.push({ id: nextId('D', allDecisionIds, 900), versionId: v.id, decision: 'changes-requested', approverId: u.id, at: cr.at, sha: v.sha, exceptions: [], selfApproved: false, note: cr.note, changeRequestId: cr.id });
    a.status = 'changes-requested';
    a.subLabel = null;
    log(a.id, u.name, 'change-request', 'Change request ' + cr.id + ' saved for V' + v.n + ': ' + plural(cr.items.length, 'item') +
      (cr.dueDate ? ', due ' + fmtDate(cr.dueDate) : '') + (cr.note ? '. Note: ' + cr.note : ''));
    notify(u.name + ' requested changes on ' + a.id + ' · ' + (a.title || '') + ' (' + plural(cr.items.length, 'item') + ')', '#asset-' + a.id);
    emit('data-changed', { kind: 'change-request', assetId: a.id, changeRequestId: cr.id });
    return cr;
  }

  function changeRequestText(assetId, crId) {
    var a = findAsset(assetId); if (!a) return '';
    var cr = crId ? a.changeRequests.find(function (c) { return c.id === crId; }) : a.changeRequests[a.changeRequests.length - 1];
    if (!cr) return '';
    var v = version(a, cr.versionId) || latestVersion(a);
    var lines = [];
    lines.push('Changes requested: ' + (a.title || a.id));
    lines.push(a.id + ' · V' + (v ? v.n : '?') + (v && v.sha ? ' · sha ' + v.sha : '') + (cr.dueDate ? ' · due ' + fmtDate(cr.dueDate) : ''));
    if (cr.note) { lines.push(''); lines.push(cr.note); }
    lines.push('');
    cr.items.forEach(function (it, i) {
      var f = it.findingId && v ? (v.findings || []).find(function (x) { return x.id === it.findingId; }) : null;
      var r = f ? ruleById(f.ruleId) : null;
      var head = (i + 1) + '. ' + (f && SEVERITY[f.severity] ? '[' + SEVERITY[f.severity].label + '] ' : '') + (r ? r.title + ' (' + r.id + ')' : (f ? f.ruleId : 'Item'));
      lines.push(head);
      if (f && f.quote) lines.push('   Found: "' + f.quote + '"');
      lines.push('   Required fix: ' + it.text);
      if (f && f.suggestedCopy) lines.push('   Suggested copy: "' + f.suggestedCopy + '"');
      lines.push('');
    });
    lines.push('Send the revision the way you sent the original (reply on the same email thread or update the same file). It will be matched to ' + a.id + ' automatically.');
    return lines.join('\n');
  }

  function setDisposition(assetId, versionId, findingId, disposition, note) {
    var a = findAsset(assetId); if (!a) return null;
    var v = version(a, versionId) || latestVersion(a);
    var f = (v.findings || []).find(function (x) { return x.id === findingId; });
    if (!f) return null;
    f.disposition = disposition || null;
    f.dispositionNote = note || null;
    log(a.id, me().name, 'disposition', findingId + ' on V' + v.n + ': ' + (disposition ? DISPOSITION[disposition].label : 'cleared') + (note ? ' (' + note + ')' : ''));
    return f;
  }
  function ackSecurity(assetId, versionId, index) {
    var a = findAsset(assetId); if (!a) return null;
    var v = version(a, versionId) || latestVersion(a);
    var al = (v.securityAlerts || [])[index || 0];
    if (!al) return null;
    al.acknowledged = true; al.acknowledgedBy = me().name; al.acknowledgedAt = nowIso();
    log(a.id, me().name, 'security-ack', 'Acknowledged ' + (al.kind === 'hidden-text' ? 'hidden-text security alert' : 'possible-injection warning') + ' on V' + v.n);
    return al;
  }
  function editMetadata(assetId, patch) {
    var a = findAsset(assetId); if (!a) return null;
    var changes = [];
    Object.keys(patch || {}).forEach(function (k) {
      var before = a[k], after = patch[k];
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      a[k] = after;
      changes.push(k + ': ' + (Array.isArray(before) ? before.join(', ') : (before == null || before === '' ? '(none)' : before)) + ' → ' + (Array.isArray(after) ? after.join(', ') : (after == null || after === '' ? '(none)' : after)));
    });
    if (changes.length) log(a.id, me().name, 'metadata', 'Metadata changed. ' + changes.join('; '));
    return changes;
  }

  /* ------------------------------------------------------------------ */
  /* Toasts                                                              */
  /* ------------------------------------------------------------------ */
  var TOAST_ICON = { 'default': 'info', success: 'circle-check', error: 'octagon-alert', warning: 'alert', info: 'info' };
  function toast(message, variant) {
    variant = variant || 'default';
    var root = $('#toast-root');
    if (!root) { if (window.console) console.log('[toast]', message); return; }
    var el = document.createElement('div');
    el.className = 'toast toast-' + variant;
    if (variant === 'error') el.setAttribute('role', 'alert');
    el.innerHTML = icon(TOAST_ICON[variant] || 'info') + '<div class="toast-msg">' + esc(message) + '</div>' +
      '<button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label="Dismiss notification" data-toast-close>' + icon('x') + '</button>';
    root.appendChild(el);
    while (root.children.length > 3) root.removeChild(root.firstChild);
    var remove = function () {
      if (!el.parentNode) return;
      el.classList.add('is-leaving');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 160);
    };
    el.querySelector('[data-toast-close]').addEventListener('click', remove);
    setTimeout(remove, variant === 'error' ? 6500 : 4000);
  }

  /* ------------------------------------------------------------------ */
  /* Dialog + drawer                                                     */
  /* ------------------------------------------------------------------ */
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var dialogState = null, drawerState = null;
  function dialogOpen() { return !!dialogState; }
  function drawerOpen() { return !!drawerState; }
  function focusables(root) { return $$(FOCUSABLE, root).filter(function (el) { return el.offsetParent !== null || el === document.activeElement; }); }

  function dialog(o) {
    o = o || {};
    closeMenu();
    var root = $('#dialog-root');
    var prevFocus = dialogState ? dialogState.prevFocus : document.activeElement;
    var id = o.id || 'app-dialog';
    var size = o.size || 'md';
    var actions = (o.actions || []).map(function (ac) {
      return button(ac.label, {
        action: ac.action || 'dialog-close', variant: ac.variant || 'outline', data: ac.data, disabled: ac.disabled,
        id: ac.id, icon: ac.icon, kbd: ac.kbd, title: ac.title
      });
    }).join('');
    root.innerHTML =
      '<div class="dialog-layer">' +
        '<div class="dialog-backdrop" data-action="app-dialog-backdrop"></div>' +
        '<div class="dialog-pos">' +
          '<div class="dialog dialog-' + esc(size) + '" role="dialog" aria-modal="true" id="' + esc(id) + '" aria-labelledby="' + esc(id) + '-title"' + (o.description ? ' aria-describedby="' + esc(id) + '-desc"' : '') + '>' +
            '<div class="dialog-header"><div class="dialog-heading"><h2 class="dialog-title" id="' + esc(id) + '-title">' + esc(o.title || '') + '</h2>' +
              (o.description ? '<p class="dialog-desc" id="' + esc(id) + '-desc">' + esc(o.description) + '</p>' : '') + '</div>' +
              button('Close', { action: 'dialog-close', variant: 'ghost', size: 'sm', icon: 'x', iconOnly: true, cls: 'dialog-close' }) + '</div>' +
            '<div class="dialog-body" id="' + esc(id) + '-body">' + (o.body || '') + '</div>' +
            (actions || o.footerNote ? '<div class="dialog-footer">' + (o.footerNote ? '<span class="footer-note">' + o.footerNote + '</span>' : '') + actions + '</div>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    dialogState = { id: id, prevFocus: prevFocus, onClose: o.onClose, dismissible: o.dismissible !== false };
    var dlg = document.getElementById(id);
    var target = (o.initialFocus && $(o.initialFocus, dlg)) || $('.dialog-body input:not([type="hidden"]):not([disabled]), .dialog-body textarea:not([disabled]), .dialog-body select:not([disabled])', dlg);
    if (!target) { var fb = $$('.dialog-footer .btn:not([disabled])', dlg); target = fb.length ? fb[fb.length - 1] : $('.dialog-close', dlg); }
    try { if (target) target.focus({ preventScroll: true }); } catch (e) { if (target) target.focus(); }
    if (typeof o.onOpen === 'function') { try { o.onOpen(dlg); } catch (e) { if (window.console) console.error(e); } }
    emit('dialog-opened', { id: id, el: dlg });
    return dlg;
  }
  function closeDialog() {
    if (!dialogState) return;
    var st = dialogState;
    dialogState = null;
    var root = $('#dialog-root'); if (root) root.innerHTML = '';
    if (typeof st.onClose === 'function') { try { st.onClose(); } catch (e) { if (window.console) console.error(e); } }
    if (st.prevFocus && document.contains(st.prevFocus)) { try { st.prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    emit('dialog-closed', { id: st.id });
  }
  function drawer(o) {
    o = o || {};
    closeMenu();
    var root = $('#drawer-root');
    var prevFocus = drawerState ? drawerState.prevFocus : document.activeElement;
    var id = o.id || 'app-drawer';
    var w = o.width;
    var width = typeof w === 'number' ? w + 'px' : ({ sm: '360px', md: '440px', lg: '560px', xl: '720px' }[w] || w || '440px');
    root.innerHTML =
      '<div class="drawer-layer">' +
        '<div class="drawer-backdrop" data-action="drawer-close"></div>' +
        '<aside class="drawer" role="dialog" aria-modal="true" id="' + esc(id) + '" aria-labelledby="' + esc(id) + '-title" style="--drawer-w:' + esc(width) + '">' +
          '<div class="drawer-header"><h2 class="drawer-title" id="' + esc(id) + '-title">' + esc(o.title || '') + '</h2>' +
            (o.headerActions || '') + button('Close', { action: 'drawer-close', variant: 'ghost', size: 'sm', icon: 'x', iconOnly: true }) + '</div>' +
          '<div class="drawer-body" id="' + esc(id) + '-body">' + (o.body || '') + '</div>' +
          (o.footer ? '<div class="drawer-footer">' + o.footer + '</div>' : '') +
        '</aside>' +
      '</div>';
    drawerState = { id: id, prevFocus: prevFocus, onClose: o.onClose };
    var el = document.getElementById(id);
    var first = focusables($('.drawer-body', el))[0] || $('.drawer-header .btn', el);
    try { if (first) first.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    if (typeof o.onOpen === 'function') { try { o.onOpen(el); } catch (e) { if (window.console) console.error(e); } }
    emit('drawer-opened', { id: id, el: el });
    return el;
  }
  function closeDrawer() {
    if (!drawerState) return;
    var st = drawerState;
    drawerState = null;
    var root = $('#drawer-root'); if (root) root.innerHTML = '';
    if (typeof st.onClose === 'function') { try { st.onClose(); } catch (e) { if (window.console) console.error(e); } }
    if (!dialogState && st.prevFocus && document.contains(st.prevFocus)) { try { st.prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    emit('drawer-closed', { id: st.id });
  }
  function confirmDialog(o) {
    o = o || {};
    return dialog({
      title: o.title || 'Are you sure?', size: 'sm', id: o.id,
      body: o.body != null ? o.body : (o.message ? '<p>' + esc(o.message) + '</p>' : ''),
      actions: [
        { label: o.cancelLabel || 'Cancel', action: 'dialog-close', variant: 'outline' },
        { label: o.confirmLabel || 'Confirm', action: o.action, data: o.data, variant: o.destructive ? 'destructive' : 'default', id: o.confirmId }
      ]
    });
  }

  /* ------------------------------------------------------------------ */
  /* Menu (popover)                                                      */
  /* ------------------------------------------------------------------ */
  var menuState = null;
  function menu(anchor, items, o) {
    o = o || {};
    closeMenu();
    if (!anchor) return null;
    var root = $('#popover-root');
    var html = (items || []).map(function (it) {
      if (!it) return '';
      if (it.sep) return '<div class="menu-sep" role="separator"></div>';
      if (it.heading) return '<div class="menu-label">' + esc(it.heading) + '</div>';
      var cls = 'menu-item' + (it.danger ? ' is-danger' : '');
      var inner = (it.icon ? icon(it.icon) : '<span class="menu-icon-pad"></span>') +
        '<span class="menu-text"><span>' + esc(it.label) + '</span>' + (it.hint ? '<span class="menu-hint">' + esc(it.hint) + '</span>' : '') + '</span>' +
        (it.checked ? icon('check', { cls: 'menu-check' }) : '') + (it.kbd ? kbd(it.kbd) : '');
      var role = it.checked != null ? 'menuitemradio' : 'menuitem';
      var checked = it.checked != null ? ' aria-checked="' + (!!it.checked) + '"' : '';
      if (it.href) return '<a role="' + role + '" class="' + cls + '" href="' + esc(it.href) + '" tabindex="-1"' + checked + '>' + inner + '</a>';
      return '<button type="button" role="' + role + '" class="' + cls + '" tabindex="-1" data-action="' + esc(it.action || 'app-noop') + '"' + dataAttrs(it.data) + (it.disabled ? ' disabled' : '') + checked + '>' + inner + '</button>';
    }).join('');
    root.innerHTML = '<div class="menu" role="menu" id="app-menu" aria-label="' + esc(o.label || 'Menu') + '">' + html + '</div>';
    var m = root.firstChild;
    var r = anchor.getBoundingClientRect();
    m.style.minWidth = Math.max(o.matchWidth ? r.width : 0, o.minWidth || 200) + 'px';
    var mw = m.offsetWidth, mh = m.offsetHeight;
    var top = o.placement === 'top' ? r.top - mh - 4 : r.bottom + 4;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    if (top < 8) top = 8;
    var left = o.align === 'end' ? r.right - mw : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    m.style.top = top + 'px';
    m.style.left = left + 'px';
    anchor.setAttribute('aria-expanded', 'true');
    menuState = { anchor: anchor };
    var first = $('.menu-item:not([disabled])', m);
    try { if (first) first.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    return m;
  }
  function closeMenu(restoreFocus) {
    if (!menuState) return;
    var st = menuState;
    menuState = null;
    var root = $('#popover-root'); if (root) root.innerHTML = '';
    try { st.anchor.setAttribute('aria-expanded', 'false'); } catch (e) { /* ignore */ }
    if (restoreFocus && document.contains(st.anchor)) { try { st.anchor.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  /* ------------------------------------------------------------------ */
  /* Clipboard + exports                                                 */
  /* ------------------------------------------------------------------ */
  function selectFallback(fallback) {
    var el = typeof fallback === 'string' ? $(fallback) : fallback;
    if (!el) return;
    try {
      if (typeof el.select === 'function') { el.focus(); el.select(); }
      else {
        var range = document.createRange(); range.selectNodeContents(el);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      }
    } catch (e) { /* ignore */ }
  }
  function copy(text, fallback) {
    var fail = function () {
      selectFallback(fallback);
      toast('The browser blocked clipboard access. The text is selected; press ' + (IS_MAC ? 'Cmd+C' : 'Ctrl+C') + ' to copy.', 'warning');
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(String(text == null ? '' : text)).then(function () { toast('Copied to clipboard', 'success'); }, fail);
        return;
      }
    } catch (e) { /* fall through */ }
    fail();
  }
  function csv(rows, columns) {
    rows = rows || [];
    var cols = columns || (rows[0] ? Object.keys(rows[0]).map(function (k) { return { key: k, label: k }; }) : []);
    var q = function (v) {
      if (v == null) return '';
      var s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [cols.map(function (c) { return q(c.label || c.key); }).join(',')]
      .concat(rows.map(function (r) { return cols.map(function (c) { return q(typeof c.value === 'function' ? c.value(r) : r[c.key]); }).join(','); }))
      .join('\n');
  }
  function showExport(o) {
    o = o || {};
    var text = typeof o.text === 'string' ? o.text : JSON.stringify(o.text, null, 2);
    var lines = text.split('\n').length;
    return dialog({
      title: o.title || 'Export', size: 'lg', id: 'export-dialog',
      description: o.description || 'Generated in the browser from the prototype data. Copy it and save it wherever you keep records.',
      body: '<label class="label" for="export-text">' + esc(o.format ? o.format.toUpperCase() : 'Text') + (o.filename ? ' <span class="muted mono">' + esc(o.filename) + '</span>' : '') + '</label>' +
        '<textarea class="textarea code" id="export-text" readonly rows="' + Math.min(22, Math.max(6, lines)) + '">' + esc(text) + '</textarea>',
      actions: [
        { label: 'Close', action: 'dialog-close', variant: 'outline' },
        { label: 'Copy', action: 'app-export-copy', variant: 'default', icon: 'copy' }
      ]
    });
  }

  /* ------------------------------------------------------------------ */
  /* Router                                                              */
  /* ------------------------------------------------------------------ */
  var routes = {};
  var current = { name: null, param: null, hash: '' };
  var started = false, rendering = false;
  function route(name, render, opts) {
    if (!ROUTE_NAME_RE.test(name || '')) { if (window.console) console.error('[App.route] invalid route name "' + name + '". Use letters, digits and hyphens.'); return; }
    if (RESERVED_ROUTES.indexOf(name) >= 0 || /^comment-/.test(name)) { if (window.console) console.error('[App.route] "' + name + '" is a reserved name.'); return; }
    if (routes[name] && window.console) console.warn('[App.route] route "' + name + '" registered twice; the last one wins.');
    routes[name] = { render: render, opts: opts || {} };
  }
  function cleanHash(h) {
    h = String(h == null ? '' : h).trim();
    if (h.charAt(0) === '#') h = h.slice(1);
    try { h = decodeURIComponent(h); } catch (e) { /* keep raw */ }
    return h || DEFAULT_ROUTE;
  }
  function parseHash(h) {
    h = cleanHash(h);
    if (!ROUTE_NAME_RE.test(h)) return { name: null, param: null, hash: h };
    if (routes[h]) return { name: h, param: null, hash: h };
    var best = null;
    Object.keys(routes).forEach(function (name) {
      if (h.indexOf(name + '-') === 0 && (!best || name.length > best.length)) best = name;
    });
    if (best) return { name: best, param: h.slice(best.length + 1), hash: h };
    return { name: null, param: null, hash: h };
  }
  var NAV = [
    { id: 'dashboard', label: 'Dashboard', href: '#dashboard', icon: 'dashboard', seq: 'g d' },
    { id: 'queue', label: 'Queue', href: '#queue', icon: 'queue', seq: 'g q', count: 'queue', countLabel: 'need review or recheck' },
    { id: 'intake', label: 'Intake', href: '#intake-triage', icon: 'inbox', seq: 'g i', count: 'intake', countLabel: 'waiting in triage' },
    { id: 'policies', label: 'Policies', href: '#policies-rules', icon: 'book', seq: 'g p' },
    { id: 'reports', label: 'Reports', href: '#reports', icon: 'chart', seq: 'g r' }
  ];
  var NAV_INFER = { asset: 'queue', compare: 'queue', queue: 'queue', intake: 'intake', policies: 'policies', reports: 'reports', dashboard: 'dashboard' };
  function activeNav() {
    var r = current.name && routes[current.name];
    if (r && r.opts.nav !== undefined) return r.opts.nav;
    var first = String(current.name || '').split('-')[0];
    return NAV_INFER[first] || null;
  }
  function routeTitle() {
    var r = current.name && routes[current.name];
    if (r && r.opts.title) {
      try { return typeof r.opts.title === 'function' ? r.opts.title(current.param) : r.opts.title; } catch (e) { return ''; }
    }
    var nav = NAV.find(function (n) { return n.id === activeNav(); });
    return nav ? nav.label : (r ? '' : 'Not found');
  }
  function notFound(message) {
    return '<div class="page"><div class="notfound card"><div class="card-body stack" style="align-items:center;padding:28px 20px">' +
      '<div class="empty-icon">' + icon('search') + '</div>' +
      '<h1 class="page-title">Not found</h1>' +
      '<p class="muted">' + esc(message || 'This page doesn’t exist, or it belongs to a profile you’re not a member of.') + '</p>' +
      '<p class="small muted mono wrap-anywhere">#' + esc(current.hash) + '</p>' +
      '<div class="row" style="justify-content:center">' + button('Go to dashboard', { href: '#dashboard', variant: 'default', icon: 'dashboard' }) + '</div>' +
      '</div></div></div>';
  }
  function errorPage(err) {
    return '<div class="page page-narrow">' + callout('danger', 'This screen failed to render', '<span class="mono small">' + esc(err && (err.stack || err.message) || String(err)) + '</span>',
      { actionsHtml: button('Go to dashboard', { href: '#dashboard', variant: 'outline', size: 'sm' }) }) + '</div>';
  }
  function render(isNav) {
    var view = $('#view'); if (!view) return;
    rendering = true;
    var r = current.name ? routes[current.name] : null;
    var html;
    if (!r) html = notFound();
    else {
      try { html = r.render(current.param); }
      catch (e) { if (window.console) console.error('[App] render failed for #' + current.hash, e); html = errorPage(e); }
      if (html == null || html === false) html = notFound();
    }
    var app = $('#app');
    if (app) {
      app.classList.toggle('is-chromeless', !!(r && r.opts.chromeless));
      app.classList.remove('sidebar-open');
    }
    view.classList.toggle('layout-fill', !!(r && r.opts.layout === 'fill'));
    view.setAttribute('data-route', current.name || 'not-found');
    view.innerHTML = html;
    renderChrome();
    rendering = false;
    if (isNav) {
      try { window.scrollTo(0, 0); } catch (e) { /* ignore */ }
      view.scrollTop = 0;
      var tb = $('#topbar');
      var ae = document.activeElement;
      if (!ae || ae === document.body || (!view.contains(ae) && !(tb && tb.contains(ae)))) {
        try { view.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      }
    }
    emit('rendered', { name: current.name, param: current.param, nav: !!isNav });
    if (isNav) emit('route-changed', { name: current.name, param: current.param });
  }
  function go(hash) {
    var h = cleanHash(hash);
    if (rendering) { setTimeout(function () { go(h); }, 0); return; }
    if (h.indexOf('/') >= 0 || h.indexOf('?') >= 0 || h.indexOf('=') >= 0) {
      if (window.console) console.warn('[App.go] invalid route "' + h + '". Use plain names like #asset-A-105.');
    }
    closeMenu(); closeDialog(); closeDrawer();
    var same = h === current.hash;
    current = parseHash(h);
    if (!started) return;
    render(!same);
    try { if (cleanHash(window.location.hash) !== h) window.location.hash = h; } catch (e) { /* hash not writable */ }
  }
  function rerender() {
    if (!started) return;
    if (rendering) { setTimeout(rerender, 0); return; }
    var view = $('#view');
    var ae = document.activeElement;
    var snap = { y: window.scrollY, focusId: null, sel: null, scrolls: [] };
    if (ae && ae.id && view && view.contains(ae)) {
      snap.focusId = ae.id;
      try { if (typeof ae.selectionStart === 'number') snap.sel = [ae.selectionStart, ae.selectionEnd]; } catch (e) { /* not selectable */ }
    }
    $$('#view [id]').forEach(function (el) { if (el.scrollTop || el.scrollLeft) snap.scrolls.push([el.id, el.scrollTop, el.scrollLeft]); });
    var viewScroll = view ? view.scrollTop : 0;
    render(false);
    if (view) view.scrollTop = viewScroll;
    snap.scrolls.forEach(function (s) { var el = document.getElementById(s[0]); if (el) { el.scrollTop = s[1]; el.scrollLeft = s[2]; } });
    try { window.scrollTo(0, snap.y); } catch (e) { /* ignore */ }
    if (snap.focusId && !dialogState && !drawerState && !menuState) {
      var f = document.getElementById(snap.focusId);
      if (f) {
        try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        if (snap.sel) { try { f.setSelectionRange(snap.sel[0], snap.sel[1]); } catch (e) { /* ignore */ } }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Chrome (sidebar + top bar)                                          */
  /* ------------------------------------------------------------------ */
  var themeMode = 'system';
  var THEME_LABEL = { system: 'System', light: 'Light', dark: 'Dark' };
  var THEME_NEXT = { system: 'light', light: 'dark', dark: 'system' };
  var THEME_ICON = { system: 'monitor', light: 'sun', dark: 'moon' };
  function applyTheme() {
    var de = document.documentElement;
    if (themeMode === 'light' || themeMode === 'dark') de.setAttribute('data-theme', themeMode);
    else de.removeAttribute('data-theme');
  }
  function renderChrome() { renderSidebar(); renderTopbar(); }
  function renderSidebar() {
    var p = profile(), u = me();
    var slot = $('#sb-profile');
    if (slot) {
      var m = memberRecord(p, u.id);
      slot.innerHTML = '<button type="button" class="sb-profile" id="sb-profile-btn" data-action="app-profile-switcher" aria-haspopup="menu" aria-expanded="false" aria-label="Profile: ' + esc(p ? p.name : 'none') + '. Switch profile">' +
        '<span class="pf-mark" aria-hidden="true">' + esc(initialsOf(p ? p.name : '?')) + '</span>' +
        '<span class="pf-text"><span class="pf-name">' + esc(p ? p.name : 'No profile') + '</span>' +
        '<span class="pf-meta">' + esc(p ? plural(memberCount(p), 'member') + (m ? ' · ' + (m.role === 'owner' ? 'Owner' : 'Member') : '') : '') + '</span></span>' +
        icon('chevrons-up-down') + '</button>';
    }
    var nav = $('#sb-nav');
    if (nav) {
      var counts = navCounts(), act = activeNav();
      nav.innerHTML = NAV.map(function (n) {
        var c = n.count ? counts[n.count] : 0;
        return '<a class="nav-item" href="' + n.href + '" data-nav="' + n.id + '"' + (act === n.id ? ' aria-current="page"' : '') + '>' + icon(n.icon) + '<span>' + esc(n.label) + '</span>' +
          (n.count ? '<span class="count" data-count-for="' + n.count + '" aria-label="' + esc(c + ' ' + n.countLabel) + '"' + (c ? '' : ' hidden') + '>' + c + '</span>' : '') + '</a>';
      }).join('');
    }
    var foot = $('#sb-foot');
    if (foot) {
      foot.innerHTML = '<button type="button" class="sb-user" id="sb-user-btn" data-action="app-user-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Account and profile menu">' +
        avatar(u) + '<span class="pf-text"><span class="pf-name">' + esc(u.name) + '</span><span class="pf-meta">' + esc(u.email) + '</span></span>' + icon('chevrons-up-down') + '</button>';
    }
  }
  // Cheap in-place refresh of live counts (nav + bell) after any data change.
  function refreshCounts() {
    var counts = navCounts();
    $$('#sb-nav [data-count-for]').forEach(function (el) {
      var key = el.getAttribute('data-count-for'), c = counts[key] || 0;
      var nav = NAV.find(function (n) { return n.count === key; });
      el.textContent = String(c);
      el.hidden = !c;
      el.setAttribute('aria-label', c + ' ' + (nav ? nav.countLabel : ''));
    });
    renderBell();
  }
  var countsTimer = null;
  function scheduleCounts() {
    if (!started) return;
    if (countsTimer) clearTimeout(countsTimer);
    countsTimer = setTimeout(function () { countsTimer = null; refreshCounts(); }, 0);
  }
  function renderBell() {
    var bell = $('#tb-bell');
    if (!bell) return;
    var unread = visibleNotifications().filter(function (n) { return !n.read; }).length;
    bell.innerHTML = icon('bell') + (unread ? '<span class="bell-count" aria-hidden="true">' + (unread > 9 ? '9+' : unread) + '</span>' : '');
    bell.setAttribute('aria-label', 'Notifications' + (unread ? ', ' + unread + ' unread' : ''));
  }
  function renderTopbar() {
    var t = $('#tb-title');
    if (t) {
      var r = current.name && routes[current.name];
      var title = routeTitle();
      var p = profile();
      t.innerHTML = (p && !(r && r.opts.chromeless) ? '<span class="crumb hide-mobile truncate">' + esc(p.name) + '</span><span class="crumb-sep hide-mobile" aria-hidden="true">/</span>' : '') +
        '<span class="crumb-current">' + esc(title || '') + '</span>';
    }
    renderBell();
    var th = $('#tb-theme');
    if (th) {
      th.innerHTML = icon(THEME_ICON[themeMode]);
      th.setAttribute('aria-label', 'Theme: ' + THEME_LABEL[themeMode] + '. Switch to ' + THEME_LABEL[THEME_NEXT[themeMode]]);
      th.setAttribute('title', 'Theme: ' + THEME_LABEL[themeMode]);
    }
    var av = $('#tb-avatar');
    if (av) av.innerHTML = avatar(me());
  }
  function openSidebar() {
    var app = $('#app'); if (!app) return;
    app.classList.add('sidebar-open');
    var b = $('#tb-menu'); if (b) b.setAttribute('aria-expanded', 'true');
    var first = $('#app-sidebar .sb-profile') || $('#app-sidebar .nav-item');
    try { if (first) first.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
  function closeSidebar() {
    var app = $('#app'); if (!app || !app.classList.contains('sidebar-open')) return false;
    app.classList.remove('sidebar-open');
    var b = $('#tb-menu'); if (b) { b.setAttribute('aria-expanded', 'false'); try { b.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    return true;
  }
  function switchProfile(id) {
    var p = S().profiles.find(function (x) { return x.id === id; });
    if (!p) return;
    if (S().activeProfileId === id) { closeMenu(); return; }
    S().activeProfileId = id;
    emit('profile-changed', { profileId: id });
    emit('data-changed', { kind: 'profile' });
    go('#dashboard');
    toast('Switched to ' + p.name);
  }
  function showNotifications() {
    var list = visibleNotifications();
    var body = list.length ? '<div class="stack stack-sm">' + list.map(function (n) {
      return '<button type="button" class="notif' + (n.read ? ' is-read' : '') + '" data-action="app-open-notification" data-id="' + esc(n.id) + '">' +
        '<span class="notif-dot" aria-hidden="true"></span><span class="stack stack-sm grow"><span class="notif-text">' + esc(n.text) + '</span>' +
        '<span class="notif-time">' + esc(relTime(n.at)) + ' · ' + esc(fmtTime(n.at)) + (n.read ? '' : ' · unread') + '</span></span></button>';
    }).join('') + '</div>' : empty('No notifications', 'Decisions with exceptions, change requests and new versions show up here.');
    drawer({
      title: 'Notifications', id: 'notifications-drawer', width: 'sm', body: body,
      headerActions: list.some(function (n) { return !n.read; }) ? button('Mark all read', { action: 'app-notifications-read-all', variant: 'ghost', size: 'sm' }) : '',
      footer: '<span class="small muted">Notifications are in-app only. Nothing is emailed.</span>'
    });
  }
  function showShortcuts() {
    var fmtCombo = function (raw) {
      var seq = String(raw).trim().split(/\s+/);
      return '<span class="kbd-seq">' + seq.map(function (part) {
        return part.split('+').map(function (k) {
          var d = k === 'mod' ? (IS_MAC ? '⌘' : 'Ctrl') : k === 'shift' ? 'Shift' : k === 'alt' ? (IS_MAC ? 'Opt' : 'Alt') :
            k === 'escape' || k === 'Escape' ? 'Esc' : k === 'enter' || k === 'Enter' ? 'Enter' : k.length === 1 ? k.toUpperCase() : k;
          return kbd(d);
        }).join('');
      }).join('<span class="muted xs">then</span>') + '</span>';
    };
    var listFor = function (scope) {
      var seen = {};
      return keys.filter(function (k) { return k.scope === scope && k.label; }).filter(function (k) {
        if (seen[k.raw]) return false; seen[k.raw] = true; return true;
      });
    };
    var global = listFor('global');
    var here = current.name ? listFor(current.name) : [];
    var rows = '<div class="shortcut-grid">';
    if (here.length) {
      rows += '<div class="shortcut-group-title">On this screen</div>' + here.map(function (k) { return '<span>' + esc(k.label) + '</span>' + fmtCombo(k.raw); }).join('');
    }
    rows += '<div class="shortcut-group-title">Everywhere</div>' + global.map(function (k) { return '<span>' + esc(k.label) + '</span>' + fmtCombo(k.raw); }).join('') +
      '<span>Close dialog, drawer or menu</span>' + fmtCombo('Escape') + '</div>';
    dialog({ title: 'Keyboard shortcuts', size: 'sm', id: 'shortcuts-dialog', body: rows, actions: [{ label: 'Done', action: 'dialog-close', variant: 'default' }] });
  }

  /* ------------------------------------------------------------------ */
  /* Actions (global click delegation)                                   */
  /* ------------------------------------------------------------------ */
  var actions = {};
  function action(name, handler) {
    if (actions[name] && window.console) console.warn('[App.action] "' + name + '" registered twice; the last one wins.');
    actions[name] = handler;
  }
  function runAction(name, el, ev) {
    var h = actions[name];
    if (!h) { if (window.console) console.warn('[App] no handler for action "' + name + '"'); return false; }
    try { h(el, ev); }
    catch (e) { if (window.console) console.error('[App] action "' + name + '" failed', e); toast('Something went wrong in "' + name + '". See the console.', 'error'); }
    saveSoon();
    return true;
  }

  // Built-in actions (names starting with "app-" are reserved for core).
  action('app-noop', function () { /* no-op */ });
  action('go', function (el) { go(el.getAttribute('data-href') || el.getAttribute('href') || '#dashboard'); });
  action('dialog-close', function () { closeDialog(); });
  action('drawer-close', function () { closeDrawer(); });
  action('app-dialog-backdrop', function () { if (dialogState && dialogState.dismissible) closeDialog(); });
  action('copy-text', function (el) {
    var target = el.getAttribute('data-copy-target');
    var text = el.getAttribute('data-text');
    if (text == null && target) { var t = $(target); text = t ? (t.value != null ? t.value : t.textContent) : ''; }
    copy(text || '', target);
  });
  action('app-export-copy', function () { var t = $('#export-text'); copy(t ? t.value : '', '#export-text'); });
  action('app-sidebar-open', function () { openSidebar(); });
  action('app-sidebar-close', function () { closeSidebar(); });
  action('app-theme', function () {
    themeMode = THEME_NEXT[themeMode] || 'system';
    lsSet(THEME_KEY, themeMode);
    applyTheme();
    renderTopbar();
    emit('theme-changed', { mode: themeMode });
  });
  action('app-profile-switcher', function (el) {
    var mine = myProfiles();
    menu(el, [{ heading: 'Profiles' }].concat(mine.map(function (p) {
      var m = memberRecord(p, me().id);
      return { label: p.name, hint: plural(memberCount(p), 'member') + (m ? ' · ' + (m.role === 'owner' ? 'Owner' : 'Member') : ''), action: 'app-switch-profile', data: { profileId: p.id }, checked: p.id === S().activeProfileId };
    })).concat([{ sep: true }, { label: 'New profile', icon: 'plus', href: '#new-profile' }]), { label: 'Switch profile', matchWidth: true, minWidth: 220 });
  });
  action('app-switch-profile', function (el) { closeMenu(); switchProfile(el.getAttribute('data-profile-id')); });
  action('app-user-menu', function (el) {
    var u = me();
    var p = profile();
    var others = S().users.filter(function (x) { return x.id !== u.id && p && memberRecord(p, x.id); });
    var items = [
      { heading: u.name + ' · ' + u.email },
      { label: 'Members & invites', icon: 'users', href: '#members' },
      { label: 'Profile settings', icon: 'settings-gear', href: '#profile-prefs' },
      { label: 'Keyboard shortcuts', icon: 'keyboard', action: 'app-shortcuts', kbd: '?' },
      { sep: true }
    ];
    if (others.length) {
      items.push({ heading: 'View as (demo)' });
      others.forEach(function (x) {
        var m = memberRecord(p, x.id);
        items.push({ label: x.name, hint: m && m.role === 'owner' ? 'Owner' : 'Member', icon: 'user', action: 'app-switch-user', data: { userId: x.id } });
      });
      items.push({ sep: true });
    }
    items.push({ label: 'Reset demo data', icon: 'refresh', action: 'app-reset-demo' });
    items.push({ label: 'Sign out', icon: 'log-out', href: '#signin' });
    menu(el, items, { label: 'Account menu', align: el.id === 'tb-avatar' ? 'end' : 'start', placement: el.id === 'sb-user-btn' ? 'top' : 'bottom', minWidth: 240 });
  });
  action('app-switch-user', function (el) {
    closeMenu();
    var id = el.getAttribute('data-user-id');
    var u = userById(id); if (!u) return;
    S().currentUserId = id;
    if (!memberRecord(profile(), id)) { var mine = myProfiles(); if (mine[0]) S().activeProfileId = mine[0].id; }
    emit('user-changed', { userId: id });
    emit('data-changed', { kind: 'user' });
    rerender();
    toast('Now viewing as ' + u.name);
  });
  action('app-shortcuts', function () { closeMenu(); showShortcuts(); });
  action('app-reset-demo', function () {
    closeMenu();
    confirmDialog({
      title: 'Reset demo data?', confirmLabel: 'Reset demo data', destructive: true, action: 'app-reset-demo-confirm',
      message: 'This restores every profile, asset, decision and setting to the original sample data. Changes you made in this browser are discarded.'
    });
  });
  action('app-reset-demo-confirm', function () { closeDialog(); resetDemo(); });
  action('app-notifications', function () { showNotifications(); });
  action('app-notifications-read-all', function () {
    visibleNotifications().forEach(function (n) { n.read = true; });
    emit('data-changed', { kind: 'notification' });
    renderTopbar();
    showNotifications();
  });
  action('app-open-notification', function (el) {
    var n = S().notifications.find(function (x) { return x.id === el.getAttribute('data-id'); });
    if (!n) return;
    n.read = true;
    emit('data-changed', { kind: 'notification' });
    if (n.href) go(n.href); else { renderTopbar(); showNotifications(); }
  });

  /* ------------------------------------------------------------------ */
  /* Keyboard shortcuts                                                  */
  /* ------------------------------------------------------------------ */
  var keys = [];
  var seqState = null;
  function normCombo(c) {
    var raw = String(c);
    var partsArr = raw === '+' ? ['+'] : raw.split('+');
    var key = partsArr.pop();
    if (key === '' && raw.slice(-1) === '+') key = '+';
    var mods = partsArr.map(function (m) { m = m.toLowerCase(); return (m === 'ctrl' || m === 'cmd' || m === 'meta' || m === 'control') ? 'mod' : m; });
    if (key.length === 1) {
      if (/[A-Z]/.test(key)) mods.push('shift');
      key = key.toLowerCase();
      if (!/^[a-z]$/.test(key)) mods = mods.filter(function (m) { return m !== 'shift'; });
    } else {
      key = key.toLowerCase();
      if (key === 'esc') key = 'escape';
      if (key === 'space' || key === ' ') key = 'space';
    }
    return ['mod', 'alt', 'shift'].filter(function (m) { return mods.indexOf(m) >= 0; }).concat([key]).join('+');
  }
  function eventCombo(e) {
    var k = e.key;
    if (!k || ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead', 'Process', 'Unidentified'].indexOf(k) >= 0) return null;
    var key = k === ' ' ? 'space' : k.toLowerCase();
    var mods = [];
    if (e.ctrlKey || e.metaKey) mods.push('mod');
    if (e.altKey) mods.push('alt');
    if (e.shiftKey && (/^[a-z]$/.test(key) || k.length > 1)) mods.push('shift');
    return mods.concat([key]).join('+');
  }
  function key(scope, combo, handler, opts) {
    if (typeof opts === 'string') opts = { label: opts };
    opts = opts || {};
    var seq = String(combo).trim().split(/\s+/);
    keys.push({
      scope: scope || 'global', raw: String(combo).trim(), handler: handler, label: opts.label || null, allowInInputs: !!opts.allowInInputs,
      combo: seq.length === 1 ? normCombo(seq[0]) : null, seq: seq.length > 1 ? seq.map(normCombo) : null
    });
  }
  function isTypingTarget(el) {
    if (!el || !el.closest) return false;
    if (el.isContentEditable) return true;
    var f = el.closest('input, textarea, select');
    if (!f) return false;
    if (f.tagName === 'INPUT') return ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].indexOf((f.type || '').toLowerCase()) < 0;
    return true;
  }
  function onMenuKey(e) {
    var m = $('#app-menu'); if (!m) return false;
    var items = $$('.menu-item:not([disabled])', m);
    var idx = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); return true; }
    if (e.key === 'Tab') { closeMenu(); return true; }
    if (e.key === 'ArrowDown') { e.preventDefault(); (items[(idx + 1) % items.length] || items[0]).focus(); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); (items[(idx - 1 + items.length) % items.length] || items[items.length - 1]).focus(); return true; }
    if (e.key === 'Home') { e.preventDefault(); if (items[0]) items[0].focus(); return true; }
    if (e.key === 'End') { e.preventDefault(); if (items.length) items[items.length - 1].focus(); return true; }
    return false;
  }
  function trapFocus(e, container) {
    var f = focusables(container);
    if (!f.length) { e.preventDefault(); return; }
    var first = f[0], last = f[f.length - 1];
    if (!container.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function onKeydown(e) {
    if (e.isComposing || e.defaultPrevented) return;
    if (menuState && onMenuKey(e)) return;
    var t = e.target;
    if (e.key === 'Escape') {
      if (dialogState) { e.preventDefault(); if (dialogState.dismissible) closeDialog(); return; }
      if (drawerState) { e.preventDefault(); closeDrawer(); return; }
      if (closeSidebar()) { e.preventDefault(); return; }
      if (isTypingTarget(t) && t.id === 'global-search') { t.blur(); return; }
    }
    if (e.key === 'Tab') {
      if (dialogState) { var d = document.getElementById(dialogState.id); if (d) trapFocus(e, d); return; }
      if (drawerState) { var dr = document.getElementById(drawerState.id); if (dr) trapFocus(e, dr); return; }
    }
    if (t && t.getAttribute && t.getAttribute('role') === 'tab' && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) >= 0) {
      var list = t.closest('[role="tablist"]');
      var tabsEls = list ? $$('[role="tab"]', list) : [];
      var i = tabsEls.indexOf(t);
      var nextEl = e.key === 'ArrowRight' ? tabsEls[(i + 1) % tabsEls.length] : e.key === 'ArrowLeft' ? tabsEls[(i - 1 + tabsEls.length) % tabsEls.length] :
        e.key === 'Home' ? tabsEls[0] : tabsEls[tabsEls.length - 1];
      if (nextEl) { e.preventDefault(); nextEl.focus(); }
      return;
    }
    if (dialogState || drawerState) return;
    var combo = eventCombo(e);
    if (!combo) return;
    var typing = isTypingTarget(t);
    if ((combo === 'enter' || combo === 'space') && t && t.closest && t.closest('button, a, [role="tab"], summary, [data-action]')) return;
    var now = Date.now();
    var prev = seqState && now - seqState.t < 1200 ? seqState.k : null;
    var scoped = keys.filter(function (k) { return k.scope === current.name && (!typing || k.allowInInputs); });
    var globals = keys.filter(function (k) { return k.scope === 'global' && (!typing || k.allowInInputs); });
    var cands = scoped.concat(globals);
    var hit = null;
    if (prev) hit = cands.find(function (k) { return k.seq && k.seq.length === 2 && k.seq[0] === prev && k.seq[1] === combo; });
    if (!hit) hit = cands.find(function (k) { return k.combo && k.combo === combo; });
    if (hit) {
      e.preventDefault();
      seqState = null;
      try { hit.handler(e); } catch (err) { if (window.console) console.error('[App] shortcut ' + hit.raw + ' failed', err); }
      saveSoon();
      return;
    }
    if (!typing && cands.some(function (k) { return k.seq && k.seq[0] === combo; })) { seqState = { k: combo, t: now }; return; }
    seqState = null;
  }

  // Built-in shortcuts
  key('global', '?', function () { showShortcuts(); }, 'Show keyboard shortcuts');
  key('global', '/', function () { var s = $('#global-search'); if (s && s.offsetParent !== null) s.focus(); }, 'Focus search');
  NAV.forEach(function (n) { key('global', n.seq, function () { go(n.href); }, 'Go to ' + n.label); });

  /* ------------------------------------------------------------------ */
  /* Global listeners                                                    */
  /* ------------------------------------------------------------------ */
  function bindGlobal() {
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var inMenu = !!t.closest('#popover-root');
      var el = t.closest('[data-action]');
      if (menuState && !inMenu) {
        if (el && el === menuState.anchor) { e.preventDefault(); closeMenu(); return; }
        closeMenu();
      }
      if (el) {
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
        if (el.tagName === 'A' || (el.tagName === 'BUTTON' && el.type === 'submit')) e.preventDefault();
        var ran = runAction(el.getAttribute('data-action'), el, e);
        if (inMenu && menuState) closeMenu();
        if (ran) return;
      }
      var a = t.closest('a[href]');
      if (a) {
        var href = a.getAttribute('href') || '';
        if (a.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
        if (href.charAt(0) === '#' && href.length > 1 && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
          e.preventDefault();
          if (inMenu) closeMenu();
          go(href);
        }
      }
    });
    document.addEventListener('change', function (e) {
      var el = e.target && e.target.closest && e.target.closest('[data-change]');
      if (el) runAction(el.getAttribute('data-change'), el, e);
    });
    document.addEventListener('input', function (e) {
      var el = e.target && e.target.closest && e.target.closest('[data-input]');
      if (el) runAction(el.getAttribute('data-input'), el, e);
    });
    document.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target && e.target.closest && e.target.closest('form[data-submit]');
      if (f) runAction(f.getAttribute('data-submit'), f, e);
    });
    document.addEventListener('keydown', onKeydown);
    window.addEventListener('hashchange', function () {
      var h = cleanHash(window.location.hash);
      if (h === current.hash) return;
      closeMenu(); closeDialog(); closeDrawer();
      current = parseHash(h);
      render(true);
    });
    window.addEventListener('resize', function () { closeMenu(); });
    window.addEventListener('scroll', function () { if (menuState) closeMenu(); }, { passive: true });
    window.addEventListener('pagehide', saveNow);

    var search = $('#global-search');
    if (search) {
      search.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var q = search.value.trim();
        var m = /^([a-z])-?(\d+)$/i.exec(q);
        if (m) { search.value = ''; search.blur(); go('#asset-' + m[1].toUpperCase() + '-' + m[2]); return; }
        toast(q ? 'Search is not wired in this prototype. Type an asset ID such as A-105 and press Enter to jump to it.' : 'Type an asset ID such as A-105 and press Enter.', 'info');
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */
  function resetDemo() {
    lsDel(STORE_KEY);
    App.state = seedState();
    emit('reset', {});
    emit('data-changed', { kind: 'reset' });
    go('#dashboard');
    toast('Demo data reset to the original sample data', 'success');
  }
  function start() {
    if (started) return;
    started = true;
    var t = lsGet(THEME_KEY);
    if (t === 'light' || t === 'dark' || t === 'system') themeMode = t;
    applyTheme();
    var mark = $('#wordmark-mark'); if (mark) mark.innerHTML = icon('shield-check');
    var tbMenu = $('#tb-menu'); if (tbMenu) tbMenu.innerHTML = icon('menu');
    var sIcon = $('#tb-search-icon'); if (sIcon) sIcon.outerHTML = icon('search');
    bindGlobal();
    current = parseHash(window.location.hash);
    render(true);
    emit('started', {});
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */
  var App = window.App = {
    state: null,
    resetDemo: resetDemo,
    save: saveNow,
    start: start,

    profile: profile, me: me, isOwner: isOwner, isMember: isMember, myProfiles: myProfiles,
    assetsFor: assetsFor, asset: asset, latestVersion: latestVersion, version: version,
    ruleById: ruleById, ruleVersion: ruleVersion, offerById: offerById, offerVersion: offerVersion,
    sourceById: sourceById, userById: userById, campaignById: campaignById, partnerById: partnerById, referenceById: referenceById,
    profileOf: profileOf, openFindings: openFindings, isOpenFinding: isOpenFinding, blockingAlerts: blockingAlerts, topSeverity: topSeverity, navCounts: navCounts,
    isSelfApproval: isSelfApproval, memberCount: memberCount,

    route: route, go: go, current: function () { return { name: current.name, param: current.param }; }, rerender: rerender, notFound: notFound,
    action: action, key: key, on: on, emit: emit,
    esc: esc, icon: icon,

    ui: {
      statusBadge: statusBadge, severityBadge: severityBadge, evidenceBadge: evidenceBadge, sourceIcon: sourceIcon, avatar: avatar,
      kbd: kbd, sample: sample, illustrative: illustrative, empty: empty, button: button, tabs: tabs, table: table,
      money: money, time: fmtTime, relTime: relTime,
      date: fmtDate, due: dueBadge, chip: chip, meter: meter, hbars: hbars, steps: steps, field: field, select: select,
      callout: callout, dl: dl, skeleton: skeleton, tag: tag, aiChip: aiChip, sha: sha, versionLabel: versionLabel,
      resultBadge: resultBadge, recheckBadge: recheckBadge, dispositionBadge: dispositionBadge
    },

    dialog: dialog, closeDialog: closeDialog, confirmDialog: confirmDialog, isDialogOpen: dialogOpen,
    drawer: drawer, closeDrawer: closeDrawer, isDrawerOpen: drawerOpen,
    menu: menu, closeMenu: closeMenu,
    toast: toast,
    copy: copy, csv: csv, showExport: showExport,

    log: log, logProfile: logProfile, notify: notify,
    newVersion: newVersion, decide: decide, canDecide: canDecide, requestChanges: requestChanges, changeRequestText: changeRequestText,
    setDisposition: setDisposition, ackSecurity: ackSecurity, editMetadata: editMetadata,

    nowIso: nowIso, nowMs: nowMs, toMs: toMs, uid: uid, nextId: nextId, shortSha: shortSha, clone: clone, plural: plural, initials: initialsOf, normText: normText,
    labels: { STATUS: STATUS, SEVERITY: SEVERITY, EVIDENCE: EVIDENCE, RESULT: RESULT, RECHECK: RECHECK, DISPOSITION: DISPOSITION, ORIGIN: ORIGIN, DECISION: DECISION, SOURCES: SOURCES }
  };
  App.state = loadState();
})();
