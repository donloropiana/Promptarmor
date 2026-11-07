# AI spend policy

How the product decides whether to call a model, which model, and how it avoids paying twice. Owner: lib/ai (engine, budget, mode, recorded, prompts). The rules below are Max's and are enforced in code, not by convention.

## The rules

1. **Cheapest capable model everywhere.** Every call uses `anthropic/claude-haiku-5.5` unless `AI_CHECK_MODEL` names another gateway model for the ad check. Classification, image transcription and "Ask about this ad" are always Haiku. **Opus is never used**: an Opus id in `AI_CHECK_MODEL` is refused with a warning and Haiku is used.
2. **No AI spend outside production.** `AI_MODE` decides whether a model may be called at all. Unset, it is `live` only when `VERCEL_ENV=production`; everywhere else (laptop, preview deployments, scripts) it is `off`. In `off` and `replay` no model call is ever made and no budget is reserved. Every `generateText` in the codebase sits behind `assertModelCallsAllowed()` (lib/ai/mode.ts), so a script cannot spend by accident.
3. **Identical content is never re-checked.** Before any model call the engine computes a reuse key and copies the findings of an earlier identical check at $0 (see Reuse).
4. **The constant part of the prompt is cached.** Instructions + the product's rules + product terms are one cacheable system message; the ad text is outside the cache. Cached reads and writes are priced and recorded.
5. **Every live call is budgeted.** `reserve_ai_budget` before, `settle_ai_budget` after (or `release_ai_budget` when nothing was called), $10/day global and a per-workspace cap in the database (docs/schema.md §4).

## AI_MODE

| Mode | Model calls | What a check does | Run row |
|---|---|---|---|
| `live` | yes | reuse → budget → (transcribe) → model → settle → persist | `input_metadata.mode = 'live'`, `model` = model id, real tokens and cost |
| `off` | **never** | reuse → deterministic findings only (product terms, hidden text) | `mode = 'off'`, `model = 'none'`, status **complete**, cost 0 |
| `replay` | **never** | reuse → recorded findings when `fixtures/recorded` has this text, else like `off` | `mode = 'replay'`, `model = 'recorded'`, cost 0, `input_metadata.recorded` = {key, model, prompt_hash, recorded_at, usage} |
| (any) reuse hit | no | copies an earlier run's findings | `mode = 'reused'`, `model` = the earlier run's model, `reused_from_run_id`, each finding has `reused_from_finding_id`, cost 0 |

Notes

- An `off` run is a normal completed run, not a failure: the ad stays `needs_review` (it is **not** sent to manual review) and the UI says "AI check skipped (test mode)" from `input_metadata.mode`. Only a hidden-text alert, a budget decline or a real failure sends a submitted ad to `needs_manual_review`.
- `coverage.rules_checked` in `off` mode counts only the rules the deterministic checks can evaluate (the offer-terms rule(s) and HIDDEN-TEXT); the rest are `not_checked` in `rule_results`. In `live`, `replay` and `reused` every applicable rule counts as checked.
- Images and scanned PDFs need a model to transcribe; in `off`/`replay` they complete with no text checked and `input_metadata.transcription_skipped = true`.
- "Ask about this ad" answers "off in test mode, nothing was spent" outside `live`.
- `GET /api/health` reports `ai.mode`, `ai.model_calls` and `ai.check_model` so a deploy can be checked without reading env.
- Recordings are read from `<cwd>/fixtures/recorded`. On Vercel that folder is only present when traced into the function bundle (`outputFileTracingIncludes` in next.config.ts); replay is meant for laptops and demos, production runs `live`.

## Reuse ($0)

`reuse_key = sha256(normalized_text_hash + "\n" + sorted rule_version_ids + "\n" + sorted offer_version_ids + "\n" + prompt_hash)`

- `normalized_text_hash` is the version's hash from intake (NFKC, lower case, zero-width removed, whitespace collapsed). An image awaiting transcription uses its `content_sha256` instead, so an identical image is reused before paying for transcription.
- `prompt_hash` = sha256(prompt version + template + rules digest + offers digest), so a rule or product edit changes the key and the ad is checked again. The policy "product edits send approved ads back to review" therefore always produces a fresh check.
- The lookup is `(profile_id, reuse_key, status = 'complete')`, newest first, skipping runs whose mode was `off` (they hold nothing worth copying). Copied findings go through the same verification and recheck steps as fresh ones, so anchors point into the new version and dispositions carry forward.
- Every complete run stores its `reuse_key`, including `off` runs.

## Prompt caching

`lib/ai/analyze.ts` sends the system part as `instructions: { role: "system", content, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }` (AI SDK 7 through the Vercel AI Gateway). The system part is built only from the product, its rules and its product terms, so it is byte-identical for every ad of that product until a rule or product changes. Channel, format, the already-flagged list and the ad text are in the user message. Usage records `inputTokenDetails.cacheReadTokens` / `cacheWriteTokens`; `costUsd()` prices reads at 10% and writes at 125% of the input rate (Anthropic 5-minute cache) and the run keeps `cache_read_tokens` / `cache_write_tokens` in `input_metadata`. Anthropic ignores the breakpoint silently when the cached part is under its minimum size, so nothing breaks on small workspaces.

## Prices

`lib/ai/budget.ts` `PRICES_PER_MTOK` (USD per 1M tokens, gateway list prices, checked 2026-11-07):

| Model | Input | Output |
|---|---|---|
| anthropic/claude-haiku-5.5 (default) | 0.10 | 0.50 |
| anthropic/claude-sonnet-5.5 | 2.00 | 10.00 |
| anthropic/claude-haiku-4.5 | 1.00 | 5.00 |
| anthropic/claude-sonnet-4.5 / -4 | 3.00 | 15.00 |

An unknown model id is priced like Sonnet 5.5 so estimates and reservations stay conservative. Reservations estimate ~4 characters per token, doubled, plus 3,000 output tokens, never less than $0.001.

## Scripts

- `AI_MODE=live doppler run -p promptarmor -c prd -- bun --conditions=react-server scripts/record-fixtures.ts [--only k1,k2] [--force] [--dry-run]`: the one place model calls happen outside production. Records every fixture and every sample revision into `fixtures/recorded/<key>.json`; skips targets already recorded with the same text hash, prompt hash and model; writes nothing unless every call succeeded (a gateway refusal such as `customer_verification_required` exits 1 with an explanation).
- `bun --conditions=react-server scripts/eval.ts --recorded`: recall / false positives / hidden-text numbers from the recordings, $0. `--no-model` scores the deterministic checks alone. Without a flag it needs `AI_MODE=live` and refuses otherwise.
- `scripts/dev-create-ad.ts` runs the engine the way the app does and follows `AI_MODE`.

## Environment

```
AI_MODE=            # live | off | replay   (unset: live in production, off elsewhere)
AI_CHECK_MODEL=     # gateway id for the ad check (unset: anthropic/claude-haiku-5.5; Opus refused)
AI_GATEWAY_API_KEY= # only when neither Vercel OIDC nor the CLI login can authenticate
```
