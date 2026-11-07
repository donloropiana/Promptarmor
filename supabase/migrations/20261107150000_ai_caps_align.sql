-- Align the in-app AI caps with the gateway key (2026-11-07).
-- The production AI Gateway key is capped at $5/day on Vercel's side; the
-- global cap here matches it so no screen promises more than the gateway
-- will serve. Per-workspace default stays $3/day (profiles.settings.ai_daily_cap_usd).
create or replace function private.ai_global_daily_cap_usd()
returns numeric language sql immutable set search_path = ''
as $$ select 5.00::numeric $$;
