# Compliance Workbench prototype: runtime contract

Read this before writing a screen module. `src/core.js` is the source of truth; this file documents it.

## 1. Files, order, build

```
src/index.html        shell markup + the whole <style> (tokens + component kit). No doctype/html/head/body.
src/data.js           window.DATA = {...}  (schema in the task brief)
src/core.js           window.App (this contract)
src/screens/*.js      one IIFE per screen, loaded alphabetically
src/boot.js           App.start()
```

`python3 build.py` inlines everything into `dist/compliance-workbench.html` and lints it (errors: wrapper tags, alert/confirm/prompt, window.open/print, download links, iframes, `#/` or `?`/`=` hashes, reserved hash names, external resource loads, network calls; warnings: storage outside core, email-scope words, non-`.example` URLs). `python3 build.py --strict` exits 1 on errors.
Syntax check a module: `bun build src/screens/x.js --outdir /tmp/claude-501/cw-check --target browser`.

Screen module skeleton:

```js
(function () {
  'use strict';
  var A = window.App, ui = A.ui, esc = A.esc;
  var st = { tab: 'all' };                      // screen-local UI state, in memory
  A.on('reset', function () { st = { tab: 'all' }; });

  A.route('queue', function (param) {          // returns an HTML string, or null for "Not found"
    return '<div class="page">...</div>';
  }, { nav: 'queue', title: 'Queue' });

  A.action('queue-tab', function (el) { st.tab = el.dataset.tab; A.rerender(); });
  A.key('queue', 'j', function () { /* ... */ }, 'Next row');
  A.on('rendered', function (r) { if (r.name !== 'queue') return; /* wire non-click events by id */ });
})();
```

Rules: do not touch the DOM at load time (only inside render, handlers and `rendered` listeners). Never cache `App.state` or objects from it across renders: `resetDemo()` replaces it. Always read through `App.state.*` or the helpers.

## 2. Non-negotiables for screens

- Interpolate data only through `App.esc()` (or helpers that escape). Helpers return trusted HTML.
- Never use `alert/confirm/prompt`, `window.open`, `window.print`, download links, iframes, CDN scripts or remote images. Confirmations use `App.confirmDialog`; exports use `App.showExport`.
- Hash routes are plain names: `#queue`, `#asset-A-105`, `#compare-A-103`. Never `#/`, `?`, `=`, or the names settings, sidebar, customize, upgrade, downloads, comment-*.
- Status and severity always via `ui.statusBadge` / `ui.severityBadge` (icon + text + color). Never color alone.
- KPI numbers carry `ui.sample()`. Connector states that would not be wired in the real build carry `ui.illustrative()`. AI surfaces carry `ui.aiChip()`.
- Email scope (Max, decision 12): the app sends only auth emails (magic link, code, password reset, member invites) and reads connected mailboxes/drives. No Resend, reply-to, thread replies, forwarding/inbound addresses, submitter portal or links, sending domains, or email notifications. Notifications are in-app (`App.notify`). Change requests are in-app plus "Copy as text".
- Use only `.example` domains. Regulation URLs in `data.references` render as plain text (no `<a href>` to external sites).
- Every input has a `<label for>` and a stable `id` (rerender restores focus and caret by id).
- Copy: plain, specific, active voice. No emoji.

## 3. Lifecycle and routing

| Function | Notes |
|---|---|
| `App.route(name, render, opts?)` | `name`: letters, digits, hyphens. `render(param)` returns HTML. Return `null`/`false` (or `App.notFound()`) for Not found. If it throws, an error callout renders and the error is logged. |
| opts.`nav` | Sidebar item to highlight: `'dashboard'`, `'queue'`, `'intake'`, `'policies'`, `'reports'`, or `null`. Default is inferred from the name prefix (`asset`/`compare` map to `queue`). |
| opts.`title` | String or `function(param)`; shown in the top bar after the profile name. Default: nav label. |
| opts.`chromeless` | `true` hides sidebar and top bar (sign-in, invite). The prototype banner always stays. |
| opts.`layout` | `'fill'`: `#view` loses padding and becomes exactly viewport minus chrome (`height: calc(100dvh - var(--chrome-h))`, `overflow:hidden`, flex column). Use for split-pane screens; panes scroll themselves. Below 1100px it falls back to normal page flow and panes stack. |
| `App.go(hash)` | `'#queue'` or `'queue'`. Closes menu, dialog and drawer, renders, updates `location.hash`. Safe to call inside render or a handler. |
| `App.current()` | `{ name, param }`. |
| `App.rerender()` | Re-renders the current route plus chrome. Keeps window scroll, scroll of any `#view [id]` element, and focus/selection of a focused element with an `id`. Dialogs and drawers stay open. |
| `App.notFound(message?)` | Not found page HTML. Same message whether the thing never existed or belongs to another profile (no existence leak). |
| `App.start()` | Called by boot.js only. |

Matching: exact name first, else the longest registered name followed by `-` (so `#asset-A-105` gives route `asset`, param `A-105`; `#policies-rules` matches route `policies-rules` if registered, otherwise `policies` with param `rules`). Params may contain hyphens (`#asset-A-105-v2` gives `A-105-v2`). Unknown hashes render Not found. Default route `#dashboard`.

Routes used by the screens: `dashboard`, `queue`, `asset` (param asset id), `compare` (param asset id), `intake-triage`, `intake-new`, `intake-sources`, `policies-rules`, `policies-offers`, `policies-references`, `reports`, `members`, `profile-prefs`, `new-profile`, `signin` (chromeless), `invite` (chromeless). The shell links to `#members`, `#profile-prefs`, `#new-profile`, `#signin`, `#intake-triage`, `#policies-rules`.

## 4. Events

`App.on(name, fn)` returns an unsubscribe function. `App.emit(name, payload)`.

| Event | Payload | When |
|---|---|---|
| `rendered` | `{ name, param, nav }` | After every render or rerender. Wire inputs, textareas, drag/drop here, by id. |
| `route-changed` | `{ name, param }` | After navigation to a different hash. |
| `data-changed` | `{ kind, ... }` | Emit after you mutate `App.state`. Core then saves (debounced) and refreshes the nav counts and bell. Core emits it from all its mutation helpers. |
| `profile-changed` | `{ profileId }` | Active profile switched. |
| `user-changed` | `{ userId }` | "View as (demo)" user switch. |
| `reset` | `{}` | Demo data reset. Clear screen-local state. |
| `theme-changed` | `{ mode }` | `system`, `light` or `dark`. |
| `dialog-opened` / `dialog-closed` | `{ id, el }` / `{ id }` | Wire dialog inputs here (or pass `onOpen`). |
| `drawer-opened` / `drawer-closed` | `{ id, el }` / `{ id }` | Same for drawers. |
| `started` | `{}` | After first render. |

Wiring pattern for non-click events:

```js
A.on('rendered', function (r) {
  if (r.name !== 'asset') return;
  var ta = document.getElementById('chat-input');
  if (ta) ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { /* send */ } });
});
```

Elements are recreated on every render, so listeners attached here never pile up.

## 5. Actions (click delegation)

`App.action(name, handler)` registers a global handler. Any element with `data-action="name"` calls `handler(el, event)` on click. Other `data-*` attributes carry parameters: `data-asset-id="A-105"` reads as `el.dataset.assetId`. `ui.button(..., { data: { assetId: 'A-105' } })` writes them for you (camelCase keys become kebab-case attributes).

- Disabled elements (`disabled` or `aria-disabled="true"`) never fire.
- On `<a data-action>` and submit buttons the default is prevented. Checkboxes still toggle.
- Extensions: `data-change="name"` fires the same registered handler on `change`; `data-input="name"` on `input`; `<form data-submit="name">` on submit (`handler(form, event)`). Every form submit is prevented, so forms never reload the page.
- Plain `<a href="#queue">` links navigate through the router (no action needed).
- After a handler runs, core schedules a save. Handlers mutate state, `App.emit('data-changed', ...)` if they changed data, then `App.rerender()` or `App.go()`.
- Naming: prefix with your screen, e.g. `dash-tile`, `queue-tab`, `queue-group`, `wb-dispose`, `wb-decide`, `cr-save`, `intake-accept`, `src-connect`, `pol-save-rule`, `rep-export`, `mem-invite`. A duplicate name logs a warning; the last one wins.
- Reserved (core): anything starting with `app-`, plus `go` (navigates to `data-href`), `dialog-close`, `drawer-close`, `copy-text` (copies `data-text`, or the value/text of the element matched by `data-copy-target`; on failure selects that element).

## 6. Keyboard

`App.key(scope, combo, handler, labelOrOpts?)`

- `scope`: `'global'` or a route name (`'queue'`, `'asset'`). Route scope wins over global.
- `combo`: `'j'`, `'J'` (shift+j), `'Enter'`, `'Escape'`, `'?'`, `'1'`, `'mod+k'` (Cmd on Mac, Ctrl elsewhere), `'alt+x'`, or a two-key sequence `'g q'`. Shift is ignored for non-letter characters (`'?'` matches Shift+/).
- `labelOrOpts`: a string label for the `?` overlay, or `{ label, allowInInputs }`. Without a label the key works but is not listed.
- Ignored while typing in inputs, textareas, selects or contenteditable (unless `allowInInputs`), while a dialog or drawer is open, and for Enter/Space on buttons, links, tabs and `[data-action]` elements.
- Built in: `?` shortcut overlay, `/` focus search, `g d` / `g q` / `g i` / `g p` / `g r` go to Dashboard / Queue / Intake / Policies / Reports, Escape closes menu, then dialog, then drawer, then the mobile sidebar. Left/Right/Home/End move between `role="tab"` buttons.
- Search box: Enter on an asset ID (`A-105`, `a105`) jumps to `#asset-A-105`; anything else shows a toast. Search is otherwise decorative.

## 7. State and data helpers

`App.state` is a deep clone of `window.DATA`, persisted to localStorage key `cw-demo-v1` (try/catch, debounced). The saved copy is discarded automatically when data.js changes (fingerprint). `App.resetDemo()` restores the seed, emits `reset`, goes to `#dashboard`. `App.save()` saves now.

| Helper | Returns |
|---|---|
| `App.profile()` | Active profile object. |
| `App.me()` | Current user. |
| `App.isOwner(profileId?)` | Current user is owner of the active (or given) profile. |
| `App.isMember(profileId, userId?)` | Membership check. |
| `App.myProfiles()` | Profiles the current user belongs to (what the switcher lists). |
| `App.memberCount(profile)` | Number of members. |
| `App.assetsFor(profileId?)` | Assets of the active (or given) profile. |
| `App.asset(id, { anyProfile }?)` | Asset in the **active profile only**, else `null`. This is the isolation boundary: a route whose asset is `null` must return `null` / `App.notFound()`. Pass `{ anyProfile: true }` only for internal lookups. |
| `App.latestVersion(asset)` | Version with `asset.latestVersionId` (fallback: last). |
| `App.version(asset, versionId)` | By id (`'A-103-v2'`), by `'V2'`/`'v2'`/`2`, or latest when `versionId` is null. |
| `App.ruleById(id)` | Active-profile rule first, then starter library (`profileId: null`). |
| `App.ruleVersion(rule, v?)` | Version object (latest when `v` is omitted). |
| `App.offerById(id)`, `App.offerVersion(offer, v?)` | Same pattern for offers. |
| `App.sourceById`, `App.userById`, `App.campaignById`, `App.referenceById`, `App.partnerById(id, profileId?)` | Lookups. |
| `App.profileOf(asset)` | The asset's profile. |
| `App.openFindings(version)` | Findings with `recheck !== 'resolved'` and `disposition !== 'dismissed'`. |
| `App.isOpenFinding(f)` | Same predicate for one finding. |
| `App.topSeverity(version)` | `'critical' / 'major' / 'minor' / null` among open findings. |
| `App.blockingAlerts(version)` | Unacknowledged security alerts that block deciding (every kind except `possible-injection`). |
| `App.navCounts()` | `{ queue, intake }`: queue = needs-review + recheck-ready in the active profile; intake = pending intake items. |
| `App.isSelfApproval(asset, version)` | Current user authored the version (`authorName`) or is the asset's submitter (email). |

Data conventions seen in data.js: version ids `A-103-v2`; finding ids `F103-2-1` (asset number, version n, index) with `carriedFrom` pointing at the previous version's finding id; run ids `R-55xx`; decision ids `D-1xxx`; change request ids `CR-30x`; notification ids `n-8`. Date-only strings (`'2026-11-09'`) mean 5 PM Central that day. The demo clock starts at `meta.now` and advances in real time (`App.nowIso()`); all times display in America/Chicago.

## 8. Mutations (use these; they log, notify, save and emit)

| Function | Behavior |
|---|---|
| `App.log(assetId, actorName, kind, text)` | Appends `{at, actor, kind, text}` to `asset.events`. Kinds in use: `intake`, `classification`, `merge`, `preflight`, `finding`, `disposition`, `security-ack`, `change-request`, `version`, `decision`, `metadata`, `offer-change`, `chat`, `note`. Returns the event. |
| `App.logProfile(actorName, kind, text, profileId?)` | Same, on `profile.events` (policy edits, members, sources). |
| `App.notify(text, href)` | Adds an in-app notification for the active profile (bell + drawer). Returns it. |
| `App.newVersion(assetId, { origin, sections, authorName?, subject?, hidden? })` | Creates V(n+1), an immutable new version; earlier versions are never mutated. `origin`: `reviewer_edit`, `suggestion_applied`, `sync`, `email` or `upload`. `sections` may be partial: merged by `id` into a copy of the previous content (unknown ids are appended; `{id, label, text}`), and matching `content.visual` keys (`headline`, `subhead`, `cta`, `footnote`) update too. Recheck per finding: if its quote no longer appears it becomes `recheck: 'resolved'`, otherwise `'still-present'`. A finding without a quote counts as resolved when its `suggestedCopy` now appears. Earlier-resolved findings are dropped. New finding ids and `carriedFrom` are set. Still-present findings keep `fix-required` and `dismissed`; `accepted-exception` is cleared. Security alerts whose text is still present carry forward unacknowledged. Flagged checklist rows with no remaining finding become `pass`. Adds a simulated run (cost ledger row, budget spend; if the run would exceed the cap it is declined and the asset goes to Needs manual review). Status becomes `recheck-ready`, or `needs-manual-review` when a hidden-text alert carried forward. If the asset had an approved version, `flags.changedAfterApproval = true` (`approvedVersionId` stays the live pointer). Logs a `version` event. Origins `sync`/`email`/`upload` also notify. Returns the version. |
| `App.canDecide(assetId, versionId, decision, { exceptions }?)` | `{ ok, reason?, selfApproval, openFindings }`. Blocks when: not the latest version; preflight running; unacknowledged hidden-text alert; already approved. `approved` needs no open Critical/Major and no open finding without a disposition or marked Fix required. `approved-with-exceptions` needs at least one open Critical/Major, blocks self-approval when the profile has more than one member and, when `exceptions` are passed, needs one per open Critical/Major (reason + text of at least 40 characters) and a disposition or exception for open Minors. Use it to enable buttons and show the reason. |
| `App.decide(assetId, versionId, decision, { exceptions, note, attested, force })` | `decision`: `approved`, `approved-with-exceptions`, `changes-requested`, `rejected`. Validates with `canDecide` (toast and `null` on failure unless `force`). Records `{id, versionId, decision, approverId, at, sha, exceptions, selfApproved, attested, note}`. Sets excepted findings to `accepted-exception`. Status = decision; on approval sets `approvedVersionId`, `subLabel 'V<n>'`, `flags.selfApproved`, `flags.exceptionsCount`, clears `changedAfterApproval`/`reReviewDue`, closes open change requests. Logs; notifies on exceptions ("Owner review recommended"). Returns the decision. For Request changes use `requestChanges`. |
| `App.requestChanges(assetId, versionId, { items: [{findingId, text}], note, dueDate })` | Saves the in-app change request (`status: 'open'`; earlier open ones become `resolved`), sets the listed findings without a disposition to `fix-required`, records a `changes-requested` decision, sets status, logs, notifies members in-app. Nothing is sent. Returns the change request. |
| `App.changeRequestText(assetId, crId?)` | Plain-text checklist for "Copy as text" (latest change request by default): title, version + sha, due date, note, numbered items with severity, rule, quote, required fix and suggested copy, and a closing line asking the submitter to send the revision the way they sent the original. |
| `App.setDisposition(assetId, versionId, findingId, disposition, note?)` | `fix-required`, `dismissed`, `accepted-exception` or `null`. Logs. |
| `App.ackSecurity(assetId, versionId, index?)` | Acknowledges a security alert (`acknowledgedBy/At`). Logs. |
| `App.editMetadata(assetId, patch)` | Shallow-assigns fields (`product`, `channel`, `states`, `dueDate`, `campaignId`, `partnerId`, `title` …) and logs one `metadata` event listing before → after. Returns the change list. |

None of these call `rerender()`. Call `App.rerender()` (or `App.go`) after them.

## 9. UI helpers (`App.ui.*`, all return HTML strings)

| Helper | Output |
|---|---|
| `statusBadge(status, subLabel?)` | Icon + label + tone, e.g. `Approved · V2`. Statuses: preflighting, needs-review, changes-requested, recheck-ready, approved, approved-with-exceptions, rejected, re-review-due, needs-manual-review, security-alert. |
| `severityBadge(sev)` | critical (solid red), major (orange), minor (gray), each with an icon. |
| `evidenceBadge(type)` | exact-match, offer-mismatch, missing-disclosure, needs-judgment (dashed violet). |
| `resultBadge(r)` | Checklist: pass, flagged, na, not-checked (dashed; never shown as pass). |
| `recheckBadge(label)` | resolved, still-present, new, outdated. |
| `dispositionBadge(d)` | fix-required, dismissed ("Not an issue"), accepted-exception, null ("Open"). |
| `due(iso)` | Clock badge: green "Due Nov 9", amber "Due in 5h" (under 24h), red "Overdue 3h". |
| `sourceIcon(provider, { label }?)` | Generic icon tile (no brand logos) with title; `label: true` adds the provider name, or pass a string. Providers: gmail, google-drive, google-sheets, outlook, onedrive, excel, upload, paste, csv. |
| `avatar(userOrId, { size: 'sm'|'lg' }?)` | Initials circle. |
| `kbd(k)` | Keycap. |
| `sample()` / `illustrative()` | Small dashed tags. |
| `tag(text, { icon, cls, title })` | Generic small tag. |
| `aiChip(text?)` | "AI preflight · advisory, human decision required". |
| `sha(s)` | `sha 9f2c41a` in mono. |
| `versionLabel(asset, version)` | `V2 · Latest · Approved`. |
| `empty(title, body, actionHtml?)` | Empty state. |
| `button(label, { action, data, variant, size, icon, iconRight, iconOnly, disabled, id, title, tip, kbd, pressed, href, type, block, cls, attrs, labelHtml, ariaLabel })` | `variant`: default, outline (default), ghost, destructive, secondary, link. `size`: sm, md, lg. `label` is escaped; pass `labelHtml` for markup. `href` renders an `<a>`. |
| `chip(label, { action, data, pressed, icon, dot, count, size: 'sm', href, title })` | Filter chip (`aria-pressed`) or static chip. `dot`: ok, warn, err, sync, off. |
| `tabs(id, items[{id,label,count,icon,data}], activeId, action, { variant: 'pills', label })` | Tab buttons; handler gets `el.dataset.tab` and `el.dataset.tabs` (the group id). |
| `table(columns, rows, opts)` | columns `[{ key, label, render(row,i), align: 'right'|'center', width, shrink, cls, headerCls, srOnly, headerHtml }]`; rows are objects, or `{ _groupHtml }` for a group header row; opts `{ rowAttrs(row,i) → {attr: value}, empty: html, dense, flush, id, caption }`. Wrapped in `.table-wrap` (horizontal scroll). |
| `meter(value, max, { label, tone, auto })` | Thin bar; turns amber at 80% and red at 100% unless `auto: false`. |
| `hbars(items[{label, value, display}], { max })` | Horizontal bar chart (neutral color). |
| `steps(labels[], activeIndex, { failed })` | Staged progress (done / spinner / pending). |
| `field(label, controlHtml, { id, hint, error, optional, cls, labelExtra })` | Label + control + hint. |
| `select(id, options[{value,label}|string], value, { change, data, size: 'sm', ariaLabel, disabled, name })` | Styled `<select>`; `change` sets `data-change`. |
| `callout(variant, title, bodyHtml, { actionsHtml, id, icon, role })` | variants: info, success, warning, danger, security, recheck, rereview, neutral. |
| `dl(pairs[[label, valueHtml]])` | Definition list. |
| `skeleton(lines)` | Loading placeholder. |
| `money(n)` | `$3.00`; under $0.10 shows 4 decimals (`$0.0042`). |
| `time(iso)` | `Nov 6, 9:02 AM` (Central; year shown when not 2026). |
| `date(iso)` | `Nov 9`. |
| `relTime(iso)` | `just now`, `5m ago`, `in 2d` (dates beyond 30 days print as a date). |

`App.icon(name, { size, cls, label })` returns inline SVG. Names: dashboard, queue, inbox, shield, shield-alert, shield-check, book, chart, settings-gear, bell, search, sun, moon, monitor, check, x, alert, octagon-alert, info, mail, drive, folder, sheet, upload, clipboard, clipboard-check, link, refresh, chevron-right/left/down/up, chevrons-up-down, user, users, user-plus, eye, eye-off, edit, sparkles, lock, history, git-compare, filter, more, menu, plus, minus, clock, loader, file, file-text, image, message, log-out, copy, keyboard, arrow-right, arrow-left, arrow-up-down, trash, calendar, tag, help, circle, circle-check, circle-x, circle-slash, circle-dashed, circle-dot, hand, undo, building, plug, layers, key, split, merge, dollar, pause, external. Unknown names render a circle and warn once.

## 10. Overlays, clipboard, exports

| Function | Notes |
|---|---|
| `App.dialog({ title, description, body, actions, size, id, initialFocus, dismissible, footerNote, onOpen, onClose })` | One dialog at a time (a new one replaces the old one without calling the old `onClose`). `actions: [{ label, action, variant, data, id, disabled, icon, kbd, title }]`; an action without `action` closes the dialog. `size`: sm, md (default), lg, xl. Focus goes to `initialFocus`, else the first input in the body, else the last footer button. Focus is trapped; Escape and backdrop close unless `dismissible: false` (use that for forms holding typed input). Body and footer ids: `<id>-body`; give action buttons an `id` to toggle `disabled` live (e.g. the 40-character counter). Returns the dialog element. |
| `App.closeDialog()`, `App.isDialogOpen()` | Close restores focus to the opener. |
| `App.confirmDialog({ title, message | body, confirmLabel, cancelLabel, action, data, destructive, id, confirmId })` | Two-button confirm; the confirm button fires `action`. Your handler should call `App.closeDialog()`. |
| `App.drawer({ title, body, width, footer, headerActions, id, onOpen, onClose })` | Right-side sheet. `width`: sm 360, md 440 (default), lg 560, xl 720, or a number. |
| `App.closeDrawer()`, `App.isDrawerOpen()` | |
| `App.menu(anchorEl, items, { align: 'end', placement: 'top', minWidth, matchWidth, label })` | Popover menu anchored to an element (call it from a click handler with `el`). items: `{ label, action, data, icon, hint, kbd, href, checked, disabled, danger }`, `{ sep: true }`, `{ heading: 'Text' }`. Clicking the anchor again closes it. Arrow keys, Home/End and Escape work. |
| `App.closeMenu()` | |
| `App.toast(message, variant?)` | `default`, `success`, `error`, `warning`, `info`. Text is escaped. Errors stay 6.5 s, others 4 s, at most 3 visible. |
| `App.copy(text, fallbackElOrSelector?)` | Call synchronously inside a click handler. Uses `navigator.clipboard.writeText`; on rejection selects the fallback element's text and shows a toast. |
| `App.csv(rows, columns?)` | CSV text; columns `[{ key, label, value(row) }]`, default all keys of the first row. |
| `App.showExport({ title, text, format, filename, description })` | Export dialog: read-only monospace textarea plus a Copy button. `text` may be an object (pretty JSON). |

## 11. Utilities

`App.nowIso()`, `App.nowMs()` (demo clock), `App.toMs(iso)`, `App.uid(prefix)`, `App.nextId(prefix, existingIds, base)` (returns `<prefix>-<max numeric suffix or base, plus 1>`), `App.shortSha()` (7 hex), `App.clone(o)`, `App.plural(n, 'item')`, `App.initials(name)`, `App.normText(s)` (lowercase, straight quotes, collapsed whitespace, zero-width removed), `App.labels.{STATUS, SEVERITY, EVIDENCE, RESULT, RECHECK, DISPOSITION, ORIGIN, DECISION, SOURCES}` (label maps for filters and selects).

## 12. CSS kit (class names)

Layout and page
- `.page` (column, 16px gap, max 1480px), `.page-narrow` (880px), `.page-header`, `.page-heading`, `.page-eyebrow`, `.page-title` (h1), `.page-desc`, `.page-actions`
- `.section`, `.section-header`, `.section-title`, `.section-desc`, `.toolbar`
- `.row` (flex, centered, 8px gap) with `.row-wrap`, `.row-start`, `.row-tight`, `.row-loose`; `.stack` (column) with `.stack-sm`, `.stack-lg`, `.stack-xl`; `.between`, `.spacer`, `.grow`
- `.grid` with `.grid-2`, `.grid-3`, `.grid-4`, `.grid-6`, `.grid-auto` (min 220px), `.grid-auto-sm` (min 160px); collapse at 1180px and 860px
- Text: `.muted`, `.small` (12px), `.xs` (11px), `.strong`, `.medium`, `.num`/`.tabular`, `.mono`, `.truncate`, `.clamp-2`, `.nowrap`, `.wrap-anywhere`, `.pre-wrap`, `.right`, `.center`, `.danger-text`, `.success-text`, `.warning-text`, `.sr-only`
- Spacing: `.mt-0/4/8/12/16`; `hr` or `.divider`
- Responsive: `.hide-mobile`, `.only-mobile` (860px breakpoint)

Split panes (use with route `layout: 'fill'`)
- `.fill-header` (header strip above panes), `.split` + `.split-2` | `.split-3` (creative / findings / 300-340px rail) | `.split-aside` (main + 300-360px) | `.split-main-rail`
- `.pane` (`.pane-muted`), `.pane-header`, `.pane-title`, `.pane-body` (scrolls; `.flush` removes padding), `.pane-footer`, `.sticky-footer` (decision bar)

Controls
- Buttons: `.btn` + `.btn-default|outline|ghost|secondary|destructive|link` + `.btn-sm|md|lg`, `.btn-icon`, `.btn-block`, `.btn-group`; `[aria-pressed="true"]` toggled look
- Forms: `.field`, `.field-row`, `.label` (`.optional`), `.hint`, `.error-text`, `.input` (`.input-sm`), `.select`, `.textarea` (`.code`), `.input-group` (with leading `svg.i`), `.check` (label wrapping a checkbox/radio), `.counter` (`.is-ok`, `.is-short`), `.seg` (segmented buttons with `aria-pressed`/`aria-selected`), `.switch` (button `role="switch" aria-checked`), `.dropzone` (`.is-over`)
- Tabs: `.tabs` (`.tabs-pills`), `.tab`, `.tab-panel`
- Chips: `.chip` (`.chip-sm`, `aria-pressed`), `.chip-x`, `.chip-list`, `.dot` + `.dot-ok|warn|err|sync|off`

Display
- Badges: `.badge`, `.badge-outline`, `.badge-secondary`, `.badge-solid`, `.badge-sub`; tones `.tone` + `.tone-blue|orange|violet|green|amber|red|yellow|slate|gray`; `.st-*`, `.sev-*`, `.ev-*`, `.res-*`, `.rc-*`, `.disp-*`, `.due-*` (prefer the helpers)
- `.tag` (`.tag-sample`, `.tag-illustrative`, `.tag-ai`), `.count` (`.count-strong`), `.sha`, `.ai-chip`
- Cards: `.card` (`.card-muted`, `.card-flush`, `.card-interactive`, `.is-selected`), `.card-header` (`.with-border`), `.card-title`, `.card-desc`, `.card-body`, `.card-footer`
- Tiles/KPIs: `.tile` (use `<button>` or `<a>` for click-through; `.is-alert`, `.is-zero`), `.tile-label`, `.tile-value` (`.unit`), `.tile-meta`
- Tables: `.table-wrap` (`.flush`), `.table` (`.table-dense`), rows `.is-active` (J/K cursor), `.is-selected`, `.is-muted`, `.clickable`, `.group-row`, `.empty-row`; cells `.num`, `.center`, `.shrink`, `.cell-title`, `.cell-sub`; `.sort-btn`
- Lists: `.list` (`.list-flush`), `.list-item` (`.is-active`, `.clickable`); `.dl`; timeline `.timeline` > `.tl-item` > `.tl-dot` (`.is-strong`), `.tl-head`, `.tl-actor`, `.tl-time`, `.tl-kind`, `.tl-text`
- Callouts: `.callout` + `.callout-info|success|warning|danger|security|recheck|rereview|neutral`, `.callout-content`, `.callout-title`, `.callout-body`, `.callout-actions`
- Empty/Not found: `.empty`, `.empty-icon`, `.empty-title`, `.empty-body`, `.notfound`
- Meters/charts: `.meter` (`.is-ok|is-warn|is-danger`, child `span` width %), `.meter-row`, `.hbars` / `.hbar-label` / `.hbar-track` / `.hbar-fill` / `.hbar-value`, `.vbars` / `.vbar` (`.is-current`)
- Loading: `.skel`, `.skel-line` (`.w-40|w-60|w-80`), `.skel-title`, `.skel-block`; progress `.steps` / `.step` (`.is-done|is-active|is-failed`), `.spin`
- Review content: `.section-block`, `.section-block-head`, `.section-block-body` (creative text sections), `.hl` + `.hl-critical|major|minor` (`.is-active`) evidence spans, `.hidden-text` and `.inert-block` (escaped rendering of hidden or injected text), `.diff-add`, `.diff-del`, `.diff-legend`, `.quote`, `.finding` (`.is-active`, `.is-resolved`), `.finding-head`, `.finding-rule`, `.finding-cite`, `.finding-actions`
- `.creative` frame for HTML/CSS-drawn ads (paper/ink tokens stay the same in dark mode; palette colors from data may be inline styles)
- Chat: `.chat`, `.chat-msg` + `.chat-user|chat-assistant`, `.chat-meta`, `.chat-input`
- `.code` (monospace block), `.avatar` (`.avatar-sm|lg`, `.avatar-stack`), `.src`, `.src-labeled`, `.kbd`, `.kbd-seq`
- Tooltips: `data-tip="Text"` on any element (`data-tip-pos="bottom|left"`). Clipped inside scrolling panes; keep critical info visible.
- `.flash` (one-shot highlight after scroll-to).

Tokens for inline styles (never hard-code colors): `--background --foreground --card --popover --primary --primary-foreground --secondary --muted --muted-foreground --accent --destructive --border --input --ring --sidebar --chart-1..5 --focus --overlay --hl --hl-active --diff-add-bg/-fg --diff-del-bg/-fg --creative-paper --creative-ink --st-<status> --st-<status>-bg --sev-critical|major|minor (+ -bg) --success --warning --info --danger (+ -bg) --radius --radius-sm|md|lg|xl --font-sans --font-mono --chrome-h`.

## 13. Shell (owned by core)

- Prototype banner (always visible, sticky).
- Sidebar: wordmark, profile switcher (lists `App.myProfiles()`, then "New profile" → `#new-profile`), nav with live counts (Queue: needs-review + recheck-ready; Intake: pending triage), account menu at the bottom (Members & invites `#members`, Profile settings `#profile-prefs`, Keyboard shortcuts, View as (demo) other members, Reset demo data with confirm, Sign out → `#signin`). At 860px and below it becomes an off-canvas drawer behind the menu button.
- Top bar: menu button (mobile), profile / page title, search (asset ID jump), notifications bell (unread count; drawer lists in-app notifications for the active profile; click marks read and opens `href`; "Mark all read"), theme toggle (System → Light → Dark, stored in `cw-theme`), avatar (account menu).
- `#view` (main), `#dialog-root`, `#drawer-root`, `#popover-root`, `#toast-root`.
- Switching profile goes to `#dashboard`. An asset URL from another profile renders Not found.
