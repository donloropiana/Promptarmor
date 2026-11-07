# Progress log

Active run: none (final hand-in state, 2026-11-07T15:35Z)

Read `docs/HANDOFF.md` first. Newest entries at the bottom. Keep entries short and factual.

## Needs Max in the morning
1. Add a credit card to the Vercel team so the AI Gateway serves model calls: https://vercel.com/midnightmusicgroups-projects/~/ai?modal=add-credit-card (the key in use is `promptarmor-demo`, capped at $2/day). Then tell the session: it records fixtures once (~$0.05), runs the live eval for the README numbers and verifies one live check + Ask on production.
2. Optional: paste the two email templates from docs/setup.md into Supabase -> Auth -> Email Templates (6-digit code in the email, links that work on another device).
3. Decide the demo login to hand graders: the reviewer account (owner of ClearPath) or an invitation from Settings -> Members.

## State at handoff (2026-11-07T00:50Z)
- Pushed all local work to `main` (auth, Nango, connectors, migrations, docs, mockup, skills).
- Database migrations: APPLIED (all 6) at 2026-11-07T00:53Z from the laptop. Test account + "ClearPath Financial" workspace exist (see HANDOFF).
- Production: https://promptarmor-two.vercel.app currently serves the placeholder home page only.
- Not yet started: AI check engine, the real UI (Ads list, ad page, Rules, Settings), sample ads/evals, README.

## Log

### 2026-11-07T02:04Z local build round 1 (4 parallel builders + integrator)
- Built: AI check engine + intake (lib/ai, lib/intake), Ads list + ad page (app/(app)/ads, components/ads), app shell, Rules | Products, Settings (members, accounts, workspace), new-workspace, sign-in cleanup (no Google button), /api/health, /api/cron/analyze, Nango webhook signing-key fix, starter rules (16) + references (10) + ClearPath products (4) seeded, 20 fixtures, docs/rules-rationale.md, docs/demo-script.md, scripts/{seed-starter,eval,smoke}.ts.
- Verified locally against the live DB: tsc, lint, build pass; Playwright smoke 45/45 (sign-in, create ad, check path, all pages, 390px no horizontal scroll, no console errors).
- BLOCKER: Vercel AI Gateway returns customer_verification_required for team midnightmusicgroups-projects (needs a credit card on file; dashboard only). Until then every check ends failed -> Needs review / Not AI-screened with deterministic findings only.
- Next: push + deploy; model policy (Haiku default, AI_MODE off outside production); reuse of identical content; critique pass; README.

### 2026-11-07T03:18Z local round 2 (policy, browser verification, README) + production checks
- Cost policy: Haiku 5.5 default (AI_CHECK_MODEL override, Opus refused), AI_MODE live|off|replay (live only on Vercel production), reuse of identical content at $0, Anthropic prompt caching, scripts/record-fixtures.ts, eval --recorded. Verified: zero ai_usage rows during all local testing.
- Browser-verified locally (Playwright): verify-ads 68/68, verify-shell 144/144, smoke 44/44.
- Production: smoke 44/45 (one hydration mismatch from date formatting, fixing next); magic-link sign-in FIXED (proxy routes ?code= to /auth/callback; Supabase templates are still defaults); real email -> sign-in -> invite accept flow verified with maxbushala@gmail.com, now an owner of ClearPath.
- README.md, docs/architecture.md, docs/security.md, docs/ai-policy.md, docs/demo-script.md written.
- Needs Max in the morning: (1) credit card on the Vercel team for AI Gateway; (2) optional: paste the email templates from docs/setup.md into Supabase Auth so emails carry the 6-digit code and links work across devices.

### 2026-11-07T04:55Z local round 3 (stress test, spec audit, security review) + integrator
- Stress (worst-case data on Ads list/ad page, verified at 1280 and 390): mobile overflow on unbreakable headlines, 60 KB text, 40 findings, RTL/CJK/emoji, 300-char names/emails, image-only PDFs honest ("nothing read it"), 500-row cap newest-first, thousands separators, reduced-motion spinners, HTML preview now loads nothing remote (default-src 'none', inert links, meta refresh stripped).
- Spec audit (docs/spec-audit.md): Cmd+B sidebar trap fixed (Show sidebar), database "profile" wording translated to "workspace", self-demotion confirm, invite expiry in APP_TIME_ZONE, Nango named honestly, "Company rule" replaces the last "policy" in UI.
- Security review (docs/security-review.md): hidden-text scanner rewritten (nested wrappers, 86 known-answer tests in scripts/test-hidden-text.ts), ad text never outside <ad_content> (PROMPT_VERSION check-v1.4), security headers, /api/health detail only when signed in or with the cron bearer, upload bytes sniffed, PDF page cap 60, 1-4 MB uploads fixed (serverActions.bodySizeLimit), per-member hourly creation limit (sample ads excluded), friendly run errors, arrival subject/sender/filename scanned for instructions.
- Verified locally (AI_MODE off, ai_usage unchanged at 16 rows): tsc, lint, build; test-hidden-text 86/86, smoke 44/44, verify-shell 177/177, verify-ads 68/68 + stress 152/152. ClearPath cleaned (0 visible test ads).
- Session cookie now httpOnly (review timer moved to /api/review-session; browser Supabase client deleted). PL-1/AFFILIATE-DISCLOSE histories carry verification versions (immutable) -> consider a fresh demo workspace.


### 2026-11-07T06:00Z local: reviewer-added issues ("highlight text → + Add issue")
- Built the last missing ui-spec item on the ad page: select words in the Text view → floating **+ Add issue** (also a header **Add issue** button for keyboard users; without a selection the dialog takes pasted words) → dialog "Add an issue" (quoted words read-only, Severity default Major, Rule it breaks from the rules that are on + "No specific rule", why ≥ 10 chars) → `addReviewerIssue` (`lib/actions/ads.ts`): RLS read proves membership, latest version only, not on approved ads, quote located with `locateQuote` (else "Those words are not in this version of the ad."), rule must be on and in this workspace, insert `findings` origin `reviewer` + `author_id` via the admin client, event `finding.added`, `refresh()`. New: `components/ads/add-issue.tsx`; changed: `creative-view.tsx`, `ad-page.tsx`, `issues-panel.tsx` (chip "Added by you / <name>", title "Reviewer-added issue" when no rule), `history.tsx` ("Issue added (Major) · “words”"), `lib/data/ads.ts` (`rulesInForce`, `authorLabel`).
- Found and fixed while here: `lib/data/ads.ts` embedded `rules(code)` from `rule_versions`, which PostgREST rejects as ambiguous (two FKs between the tables), so every issue card had been rendering without its rule title and legal links; now `rules!rule_versions_rule_id_fkey(code)` and the error is logged.
- Verified locally (AI_MODE off, `ai_usage` unchanged at 17 rows): tsc, lint, build; verify-ads 96/96 (68 + 28 new checks: floating button placement at 1280/390, dialog, rule picker, toast, panel chip/quote/rule, highlight, open count +1, history line, Approve sheet lists it as an exception, error path, Not a problem on it); smoke 44/44. ClearPath cleaned with `scripts/cleanup-workspace.ts` (4 retired; 18 older approved/decided `[test]` ads from earlier rounds are kept by design).
- Dev-server note: after editing files while a Playwright client was connected, `next dev` (Turbopack) went into a "[Fast Refresh] rebuilding" → full reload loop on every page until restarted; restart fixed it.
- README: Known-limitations bullet removed, "Add issue" added under Decisions; docs/schema.md notes the reviewer insert path.

### 2026-11-07T06:09Z submission candidate (tag `submission`)
- Production https://promptarmor-two.vercel.app serves 533b38a: smoke 45/45; Add issue verified live (floating button, dialog, "Added by you", rule links with legal sources on every issue card); session cookie httpOnly; security headers; /api/health gated.
- ClearPath workspace: 0 visible ads (empty state with the three sample chips), 0 pending invitations, 2 owners (reviewer account + Max). Hidden: 18 approved "[test]" ads (sample_cleared, not listed) and verification versions in the PL-1 / AFFILIATE-DISCLOSE histories. A fresh workspace needs the old ones purged (`private.purge_profile`), which this session deliberately left for Max.
- AI Gateway key rotated to `promptarmor-demo` ($2/day); still blocked on a credit card. ai_usage shows only $0 released reservations.
- Cloud routine stays disabled.

## 2026-11-07 09:30 CST — AI live on production; model ladder; caps aligned

- The gateway was refusing Anthropic models on the team's free tier, not the key. The app was pinned to Haiku, so every check ended "Not AI-screened". Fixed by choosing models the gateway serves on every plan and adding a ladder (`lib/ai/ladder.ts`): a refused model or a malformed answer (after one retry) moves to the next rung, and the run records which model answered.
- Defaults chosen from published instruction-following benchmarks plus a live known-answer eval over the 20 fixtures (3 models, 8 cents total): check = `openai/gpt-oss-120b` (recall 83%, 15 false positives, $0.0012/ad); fallbacks gpt-5-mini (100% / 38 / $0.0022), gemini-2.5-flash-lite (67% / 31), claude-haiku-5.5 (needs paid credits). Transcription and Ask = `openai/gpt-5-nano`.
- Verified on production: sample chip → 4 Critical issues with verified quotes in 12 s, history shows `gpt-oss-120b · $0.002`; Ask answers "Why was the APR flagged?" correctly. Smoke 44/44 with "issues listed".
- Gateway key rotated to `promptarmor-demo-5` ($5/day); global DB cap $5/day (migration `ai_caps_align`); workspace default $3/day. Old $2 key `promptarmor-demo` still exists and can be revoked from the dashboard.
- Arrivals: bounces, calendar traffic, account notices and receipts are never candidates; triage rows say "Could be an ad: has a call to action" instead of signal dumps. The two system-mail rows in ClearPath were reclassified.
- ClearPath left empty (samples cleared, test ads retired) so the chips show.
- Design review (six lenses + red team, this morning) and the roadmap it produced are summarized in the README roadmap section; the longer notes are in the session transcript.
