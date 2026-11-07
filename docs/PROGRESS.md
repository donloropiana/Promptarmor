# Progress log

Active run: 2026-11-07T03:18Z (local session on Max's laptop; it refreshes this line with every push. Cloud runs: skip while it is less than 50 minutes old)

Read `docs/HANDOFF.md` first. Newest entries at the bottom. Keep entries short and factual.

## Needs Max in the morning
- (filled in by runs; if empty, nothing is blocked on him)

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
