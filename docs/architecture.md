# Architecture

How the pieces fit, what runs where, and why. The README has the one-screen version; `docs/schema.md` has the database in full; `docs/security.md` has the trust boundaries.

## 1. The shape

```
                         ┌─────────────────────────────────────────────┐
  browser (React 19)     │  Next.js 16.4.5 App Router on Vercel Hobby   │
  ───────────────────►   │  src/proxy.ts (session cookies, auth gating)     │
  server actions,        │  app/(app)/*   four screens                  │
  route handlers         │  app/api/*     health, cron, webhook, conns  │
                         │  lib/actions   re-auth + membership checks   │
                         │  lib/intake    files/text/samples → versions │
                         │  lib/ai        the check engine              │
                         │  lib/connectors + lib/nango   arrivals       │
                         └────┬───────────────┬────────────────┬────────┘
                              │               │                │
                   ┌──────────▼─────┐  ┌──────▼───────┐  ┌─────▼──────────┐
                   │ Supabase       │  │ Vercel AI    │  │ Nango Cloud    │
                   │ Postgres + RLS │  │ Gateway      │  │ managed OAuth  │
                   │ RPCs, triggers │  │ (AI SDK)     │  │ Google / MSFT  │
                   │ budget ledger  │  │ Haiku / check│  │ read-only proxy│
                   │ private storage│  │ model        │  │ auth webhooks  │
                   └────────────────┘  └──────────────┘  └────────────────┘
```

One Next.js app, one Postgres database, two external services. No queue, no worker fleet, no separate API: the Hobby plan's function limits (60 s routes, one cron run per day) shaped every background path below.

## 2. Request paths

### Reading a page

`src/app/(app)/layout.tsx` reads the session and the active workspace cookie, confirms membership, calls `ensureWorkspaceDefaults` (idempotent: two count queries when the workspace is complete) and renders the shell. Pages read through `lib/data/*` with the **user-context** Supabase client, so RLS does the authorization. `cacheComponents` is on, so anything that touches cookies or the request sits under `<Suspense>` with a skeleton (`src/components/layout/shell-skeleton.tsx`, `src/features/ads/components/skeletons.tsx`).

### Writing

Every mutation is a server action in `lib/actions/*` (ads, rules, offers, profiles) or `app/(app)/*/actions.ts`. The pattern is the same everywhere:

1. Parse the input with Zod.
2. Re-read the session; return a plain `{ ok: false, error }` when signed out.
3. Load the target row with the user-context client (under RLS). Not found means not a member; both answer the same.
4. Then, and only then, call intake, the engine, or an RPC. Decisions, dispositions, settings and member changes go through RPCs with the user-context client so the database records the real actor. Intake and the engine use the secret-key client after that membership check, because they write rows no user may write directly (versions with storage paths, findings, alerts, ledger rows).
5. `refresh()` and return, or `redirect()` to the new ad.

### Intake → check

```
uploadAd / pasteAd / trySample / triageSourceItem (accept)
  └─ src/features/ads/server/intake.ts
       buildFromInput     PDF (unpdf) · HTML (strip to sections, keep raw) · image · text
       assets.insert      status needs_review, submitted_at now, product/channel inferred
       asset_versions.insert
          └─ DB trigger: version_no, latest_version_id, status, events.version.created,
                         analysis_runs.insert (status queued)
  └─ after(() => startAnalysisForVersion(versionId))        src/features/analysis/server/engine.ts
```

The version insert trigger is what queues the check, so a version can never exist without a run row. The request that created it runs the check in `after()` (the response has already gone back to the browser, which polls the ad page while `analysis_runs.status` is `queued` or `running`, shown as "Checking…").

### The engine (`src/features/analysis/server/engine.ts`)

`runAnalysis(runId)` claims the run with a conditional update (`queued → running`), so two workers cannot run the same check. Stages are written to `analysis_runs.stage` as it goes, and the function never throws: every failure is recorded on the run and a submitted ad falls back to manual review.

| Stage | Module | What it does |
|---|---|---|
| extract | `src/features/analysis/extract.ts` | Text and sections from the version; images and scanned PDFs are transcribed with the cheap model later |
| rules | engine | Loads the workspace's active rules at their `current_version_id` and the current product versions |
| hidden_text | `src/features/analysis/hidden-text.ts` | Deterministic scan → `security_alerts`, asset to manual review |
| offer_checks | `src/features/analysis/offer-checks.ts` | Deterministic numbers vs terms; kept as the fallback if the model fails |
| reuse | engine | `reuse_key` = sha256(normalized text, rule version ids, product version ids, prompt hash); a previous complete run with the same key has its findings copied at $0 (`reused_from_run_id`, `reused_from_finding_id`) |
| mode gate | `src/lib/ai/mode.ts` | Outside `AI_MODE=live` the run completes here: `off` keeps the deterministic findings; `replay` uses a recording from `fixtures/recorded/` when the text hash matches |
| budget | `src/lib/ai/budget.ts` → `reserve_ai_budget` | Estimates the cost from characters; a refused reservation ends the run as `declined_budget` |
| transcribe | engine | Haiku transcription of image bytes from storage (live mode only) |
| llm | `src/features/analysis/server/analyze.ts` | One `generateText` + `Output.object` call on the check model (Haiku unless `AI_CHECK_MODEL`); rules and terms in the system prompt behind an Anthropic cache breakpoint; "already flagged" and the ad inside `<ad_content>` in the user turn; 90 s timeout, one retry |
| verify | `src/features/analysis/spans.ts` | Locate each quote; unlocatable quotes are kept but unverified |
| recheck | `src/features/analysis/recheck.ts` | Pair with the previous version's findings; carry dispositions forward on unchanged spans |
| persist | engine | `findings`, `rule_results`, `coverage`, `input_metadata` (including `mode`), tokens incl. cache reads and writes, cost, `prompt_hash`; `settle_ai_budget`; `events.analysis.completed` |

`analyzeContent` in `src/features/analysis/server/analyze.ts` is pure (no database, no budget), which is what `scripts/eval.ts` runs over the fixtures. The spend rules, modes and prices are in `docs/ai-policy.md`. Every model call in the codebase checks the mode first (`assertModelCallsAllowed()` in analyze and transcription, `getAiMode()` in chat), so the policy is enforced at the call site, not only in the engine.

### Recovery without a worker

- **Nudge on read**: when the Ads list renders with any ad still checking, it calls `nudgeStaleRuns(profileId)` in `after()`: runs stuck in `running` for over 10 minutes are failed, and up to two queued runs older than 2 minutes are run.
- **Daily cron**: `/api/cron/analyze` does the same across every workspace within a 120 s budget; `/api/cron/maintenance` closes stale sync runs, revokes Nango grants for disconnected rows, clears old webhook receipts and spends the rest of its minute on one sync pass.

### Decisions

`decide` (`src/features/ads/server/actions.ts`) → `record_decision()` RPC. The action inserts the `accepted_exception` dispositions first (supabase-js has no transactions) and reverts them if the RPC refuses. The RPC locks the asset, version and findings, re-checks every rule, writes the append-only `decisions` row, resolves open change requests, inserts the new one for Changes requested, and logs events. The action then finds the next ad in Needs review for auto-advance.

### Products and re-review

`editOffer` (`src/features/products/server/actions.ts`) inserts an immutable `offer_versions` row, finds approved ads whose approving run's `offer_version_ids` contains the old version (GIN index), moves each to `re_review_due` with a `re_review_reason`, and logs `offer.changed` with the affected ids. The Ads list shows them in Needs review tagged **Rates changed**. `previewOfferChange` runs the same query to show "This sends N approved ads back" before the save.

## 3. Arrivals from connected accounts

```
Connect Google / Microsoft (src/features/connections/components/connect-buttons.tsx)
  └─ POST /api/connections/session   membership check → nango.createConnectSession
       tags: end_user_id = user, organization_id = workspace
  └─ Nango Connect UI (provider consent; Google asks for Gmail then Drive)
  └─ POST /api/connections/confirm (fallback) and the auth webhook
       └─ connections.insert (trigger: owner must still be a member)
       └─ after(): account email, then runConnectionSync (initial)
```

`runConnectionSync` (`src/features/connections/server/sync.ts`) is time-boxed (45 s by default) and resumable: it pages through `adapter.listChanges` (Gmail history, Drive changes, Graph delta), persists the cursor after every fully handled page, and returns `hasMore` so the page keeps calling `POST /api/connections/:id/sync` until the backfill is done. Each item is hashed (bytes and normalized text), classified by `src/features/connections/classify.ts` (keywords and file type, no model), and inserted with `ON CONFLICT DO NOTHING` on `(profile_id, source_key, source_revision, content_sha256)`. Bytes for items that may reach triage are stored under `sources/{source_item_id}/`.

Classification outcomes and what the Ads list does with them:

| Classification | Visible to | Row |
|---|---|---|
| `marketing`, `uncertain` | the connecting member only | **Is this an ad?** with Yes / No |
| `new_version` (same source, new hash, already linked to an ad) | the connecting member | **New version?** |
| `duplicate` | nobody as a row; linked as provenance | "Seen in 2 places" on the ad |
| `not_marketing`, `inline_image` | counted behind "N skipped · show" | text discarded |

Accepting (`acceptSourceItem` in `src/features/ads/server/intake.ts`) creates the ad, links `asset_sources`, inserts v1 from the stored bytes or extracted text, copies open source-item alerts onto v1, and queues the check like any other version.

## 4. Data model in one paragraph

A workspace (`profiles`) has members, connections, rules, products (`offers`) and ads (`assets`). An ad has immutable `asset_versions`; each version gets `analysis_runs`, each run has immutable `findings`; findings get append-only `finding_dispositions`; a version may carry `security_alerts`; decisions are append-only `decisions` rows written only by `record_decision()`; every change lands in the append-only `events` log. Rules and products are versioned (`rule_versions`, `offer_versions`) and every run records which versions it used, which is what makes "Rates changed" and "view as at decision" possible. `docs/schema.md` has every column.

## 5. Deployment and configuration

- **Vercel** project `promptarmor`, Hobby plan, built with Bun from `bun.lock`. Every push to `main` deploys to production (`https://promptarmor-two.vercel.app`). `vercel.json` schedules the two daily crons.
- **Environment** comes from Doppler (`promptarmor` / `prd`) synced to Vercel: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`, `NANGO_SECRET_KEY`, `NANGO_WEBHOOK_SIGNING_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL`. `next.config.ts` maps the two public Supabase values into `NEXT_PUBLIC_*` for the browser bundle and nothing else. On Vercel the AI Gateway authenticates with OIDC; locally it needs `AI_GATEWAY_API_KEY`, and `AI_MODE` defaults to `off` outside `VERCEL_ENV=production` so nothing local or preview ever spends (`AI_CHECK_MODEL` overrides the Haiku default; Opus is refused).
- **Supabase** project `dquwmmysasjvvgxnbhdl`; the six migrations in `supabase/migrations/` are applied; `src/lib/supabase/database.types.ts` is generated from them. Auth settings the code assumes (confirm email on, email OTP length 6, redirect URLs) are in `docs/setup.md`.
- **Nango** cloud, `dev` environment, six integrations with managed OAuth apps; the webhook URL points at production. `docs/nango.md`.
- **Seeding** is app code, not SQL: `src/features/workspaces/server/seed.ts` upserts the reference library and starter rules (profile_id null) and `ensureWorkspaceDefaults` clones rules and creates the four ClearPath products for any workspace that lacks them. `scripts/seed-starter.ts` runs the same thing by hand and marks the ClearPath workspace trusted.

## 6. Frameworks and conventions

- **Next.js 16.4.5**: `src/proxy.ts` instead of middleware; Cache Components on; request-bound data under `<Suspense>` or `connection()`; `after()` for post-response work. The framework's own docs in `node_modules/next/dist/docs/` are the reference, since the APIs differ from older versions.
- **Bun only** (`bun install`, `bun run dev`, `bunx --bun tsc --noEmit -p .`). Scripts that import `server-only` modules run with `bun --conditions=react-server`.
- **UI**: Tailwind v4, shadcn/ui (Radix, Nova preset) in `components/ui`, `lucide-react` icons, `sonner` toasts, `diff` for the word diff. Keyboard: J/K/Enter/? on the list, J/K/X/A/R/?/Esc on the ad page; `prefers-reduced-motion` is honoured in `src/app/globals.css` and the creative view.
- **Words**: ad, workspace, issue, check, Products, Connected accounts, Changes requested in the UI; the database keeps its own names (asset, profile, finding, analysis_run, offer).

## 7. Things that are deliberately simple

- No background job system. The version trigger plus `after()`, nudge-on-read and a daily cron cover the three ways a check can be lost (cold start, timeout, nobody waiting).
- No email. Auth emails are Supabase's; everything else is in-app (bell, toasts, Copy as text).
- No per-request model fan-out. One structured call per check, with deterministic work before it and verification after it.
- No separate preview environment. One database, one production URL, migrations applied once.
