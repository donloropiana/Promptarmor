-- =============================================================================
-- 20261106170300_policies_ai.sql
-- 1. ai_usage ledger + atomic budget reservation RPCs (service role only)
-- 2. Table privileges for anon / authenticated / service_role (explicit, so
--    they do not depend on the project's default-privilege settings)
-- 3. Immutability: BEFORE UPDATE/DELETE/TRUNCATE triggers + revoked
--    UPDATE/DELETE/TRUNCATE on the append-only tables
-- 4. Every RLS policy for the public schema
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. AI budget (UTC day). A reservation must fit under ALL of:
--    * global cap        $10/day across all profiles
--    * profile cap       profiles.settings.ai_daily_cap_usd (default $3,
--                        never above the global cap)
--    untrusted profiles only (settings.ai_trusted is not true):
--    * untrusted pool    $5/day shared by every untrusted profile, so
--                        trusted profiles (the ClearPath demo) always keep
--                        about $5 of headroom
--    * creator cap       $3/day across all untrusted profiles created by the
--                        same person (create_profile allows 3 per user)
-- Spend counted per row: live reservation -> greatest(reserved_usd,
-- cost_usd); settled/released (or a reservation older than the TTL) ->
-- cost_usd. The server's LLM call timeout must stay well under the 15-minute
-- TTL so a stale-released reservation cannot overshoot the caps.
-- -----------------------------------------------------------------------------
create table if not exists public.ai_usage (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid not null references public.profiles (id) on delete cascade,
  analysis_run_id  uuid,
  source_item_id   uuid,
  requested_by     uuid references public.users (id) on delete set null,
  purpose          text not null default 'analysis' check (purpose in (
                     'classification', 'analysis', 'suggestion', 'change_request_draft', 'chat')),
  request_id       text not null unique check (char_length(request_id) between 1 and 200),
  model            text,
  input_tokens     integer not null default 0 check (input_tokens >= 0),
  output_tokens    integer not null default 0 check (output_tokens >= 0),
  cost_usd         numeric(10, 6) not null default 0 check (cost_usd >= 0),
  reserved_usd     numeric(10, 6) not null check (reserved_usd >= 0),
  status           text not null default 'reserved' check (status in ('reserved', 'settled', 'released')),
  budget_day       date not null default ((now() at time zone 'utc')::date),
  created_at       timestamptz not null default now(),
  settled_at       timestamptz,
  constraint ai_usage_run_fk foreign key (analysis_run_id, profile_id)
    references public.analysis_runs (id, profile_id) on delete set null (analysis_run_id),
  constraint ai_usage_source_item_fk foreign key (source_item_id, profile_id)
    references public.source_items (id, profile_id) on delete set null (source_item_id)
);
create index if not exists ai_usage_day_idx on public.ai_usage (budget_day, status);
create index if not exists ai_usage_profile_day_idx on public.ai_usage (profile_id, budget_day);
create index if not exists ai_usage_run_idx on public.ai_usage (analysis_run_id, profile_id);
create index if not exists ai_usage_source_item_idx on public.ai_usage (source_item_id, profile_id);
create index if not exists ai_usage_requested_by_idx on public.ai_usage (requested_by);
alter table public.ai_usage enable row level security;

create or replace function private.ai_global_daily_cap_usd()
returns numeric language sql immutable set search_path = ''
as $$ select 10.00::numeric $$;

create or replace function private.ai_default_profile_cap_usd()
returns numeric language sql immutable set search_path = ''
as $$ select 3.00::numeric $$;

create or replace function private.ai_untrusted_pool_cap_usd()
returns numeric language sql immutable set search_path = ''
as $$ select 5.00::numeric $$;

create or replace function private.ai_creator_cap_usd()
returns numeric language sql immutable set search_path = ''
as $$ select 3.00::numeric $$;

-- Reservations older than this are presumed dead and stop counting (a late
-- settle still records the real cost).
create or replace function private.ai_reservation_ttl()
returns interval language sql immutable set search_path = ''
as $$ select interval '15 minutes' $$;

create or replace function private.ai_row_spend(p_status text, p_reserved numeric, p_cost numeric, p_created_at timestamptz)
returns numeric
language sql
stable
set search_path = ''
as $$
  select case
    when p_status = 'reserved' and p_created_at >= now() - private.ai_reservation_ttl()
      then greatest(p_reserved, p_cost)
    else p_cost
  end;
$$;

-- Today's spend relevant to one profile.
create or replace function private.ai_spend_for(p_profile_id uuid, p_creator uuid)
returns table (global_used numeric, profile_used numeric, pool_used numeric, creator_used numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(s.spend), 0),
         coalesce(sum(s.spend) filter (where s.profile_id = p_profile_id), 0),
         coalesce(sum(s.spend) filter (where not s.trusted), 0),
         coalesce(sum(s.spend) filter (where not s.trusted and s.created_by = p_creator), 0)
  from (
    select u.profile_id,
           private.ai_row_spend(u.status, u.reserved_usd, u.cost_usd, u.created_at) as spend,
           coalesce((p.settings ->> 'ai_trusted')::boolean, false) as trusted,
           p.created_by
    from public.ai_usage u
    join public.profiles p on p.id = u.profile_id
    where u.budget_day = (now() at time zone 'utc')::date
  ) s;
$$;

-- reserve_ai_budget(profile, est_usd, request_id, user, purpose,
-- source_item, run) -> true if reserved.
-- Atomic: transaction-scoped advisory lock on the UTC budget day, release
-- stale reservations, check every cap, insert the reservation. Idempotent
-- per request_id (returns true again for an existing live reservation).
-- p_user_id (who triggered the spend) must be a member of the profile.
drop function if exists public.reserve_ai_budget(uuid, numeric, text);
create or replace function public.reserve_ai_budget(
  p_profile_id      uuid,
  p_est_usd         numeric,
  p_request_id      text,
  p_user_id         uuid    default null,
  p_purpose         text    default 'analysis',
  p_source_item_id  uuid    default null,
  p_analysis_run_id uuid    default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day         date := (now() at time zone 'utc')::date;
  v_global_cap  numeric := private.ai_global_daily_cap_usd();
  v_profile_cap numeric;
  v_trusted     boolean;
  v_creator     uuid;
  v_used        record;
  v_existing    public.ai_usage%rowtype;
begin
  if p_est_usd is null or p_est_usd <= 0 or p_est_usd > v_global_cap then
    raise exception 'Estimated cost must be > 0 and <= %', v_global_cap using errcode = 'PT422';
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'request_id is required' using errcode = 'PT422';
  end if;

  select least(coalesce((p.settings ->> 'ai_daily_cap_usd')::numeric, private.ai_default_profile_cap_usd()),
               v_global_cap),
         coalesce((p.settings ->> 'ai_trusted')::boolean, false),
         p.created_by
    into v_profile_cap, v_trusted, v_creator
  from public.profiles p
  where p.id = p_profile_id;
  if not found then
    raise exception 'Profile not found' using errcode = 'PT404';
  end if;
  if p_user_id is not null and not exists (
    select 1 from public.profile_members m where m.profile_id = p_profile_id and m.user_id = p_user_id
  ) then
    raise exception 'requested_by must be a member of the profile' using errcode = 'PT422';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('promptarmor.ai_budget.' || v_day::text, 0));

  select * into v_existing from public.ai_usage u where u.request_id = p_request_id;
  if found then
    return v_existing.profile_id = p_profile_id and v_existing.status in ('reserved', 'settled');
  end if;

  update public.ai_usage u
     set status = 'released', settled_at = now()
   where u.budget_day = v_day
     and u.status = 'reserved'
     and u.created_at < now() - private.ai_reservation_ttl();

  select * into v_used from private.ai_spend_for(p_profile_id, v_creator);

  if v_used.global_used + p_est_usd > v_global_cap
     or v_used.profile_used + p_est_usd > v_profile_cap then
    return false;
  end if;
  if not v_trusted then
    if v_used.pool_used + p_est_usd > private.ai_untrusted_pool_cap_usd() then
      return false;
    end if;
    if v_creator is not null and v_used.creator_used + p_est_usd > private.ai_creator_cap_usd() then
      return false;
    end if;
  end if;

  insert into public.ai_usage (profile_id, request_id, reserved_usd, status, budget_day,
                               requested_by, purpose, source_item_id, analysis_run_id)
  values (p_profile_id, p_request_id, p_est_usd, 'reserved', v_day,
          p_user_id, coalesce(p_purpose, 'analysis'), p_source_item_id, p_analysis_run_id);
  return true;
end;
$$;

-- settle_ai_budget(request_id, actual_cost, tokens...) records the real cost.
-- Accepts reserved or (stale-)released rows; idempotent for settled rows.
create or replace function public.settle_ai_budget(
  p_request_id      text,
  p_actual_cost     numeric,
  p_input_tokens    integer default 0,
  p_output_tokens   integer default 0,
  p_model           text default null,
  p_analysis_run_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actual_cost is null or p_actual_cost < 0 then
    raise exception 'actual_cost must be >= 0' using errcode = 'PT422';
  end if;
  update public.ai_usage u
     set status          = 'settled',
         cost_usd        = p_actual_cost,
         input_tokens    = coalesce(p_input_tokens, 0),
         output_tokens   = coalesce(p_output_tokens, 0),
         model           = coalesce(p_model, u.model),
         analysis_run_id = coalesce(p_analysis_run_id, u.analysis_run_id),
         settled_at      = now()
   where u.request_id = p_request_id
     and u.status in ('reserved', 'released');
  if not found then
    if exists (select 1 from public.ai_usage u where u.request_id = p_request_id and u.status = 'settled') then
      return;
    end if;
    raise exception 'Unknown AI request_id' using errcode = 'PT404';
  end if;
end;
$$;

-- release_ai_budget(request_id): the call never happened (or failed before
-- any spend). No-op unless the row is still reserved.
create or replace function public.release_ai_budget(p_request_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_usage u
     set status = 'released', settled_at = now()
   where u.request_id = p_request_id and u.status = 'reserved';
end;
$$;

-- ai_budget_status(profile) for the dashboard meter (members only).
-- remaining_usd is the headroom under every cap that applies.
drop function if exists public.ai_budget_status(uuid);
create or replace function public.ai_budget_status(p_profile_id uuid)
returns table (
  budget_day        date,
  global_cap_usd    numeric,
  global_used_usd   numeric,
  profile_cap_usd   numeric,
  profile_used_usd  numeric,
  trusted           boolean,
  remaining_usd     numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile_cap numeric;
  v_trusted     boolean;
  v_creator     uuid;
  v_used        record;
begin
  if not private.is_member(p_profile_id) then
    raise exception 'Profile not found' using errcode = 'PT404';
  end if;
  select least(coalesce((p.settings ->> 'ai_daily_cap_usd')::numeric, private.ai_default_profile_cap_usd()),
               private.ai_global_daily_cap_usd()),
         coalesce((p.settings ->> 'ai_trusted')::boolean, false),
         p.created_by
    into v_profile_cap, v_trusted, v_creator
  from public.profiles p where p.id = p_profile_id;
  select * into v_used from private.ai_spend_for(p_profile_id, v_creator);
  return query
  select (now() at time zone 'utc')::date,
         private.ai_global_daily_cap_usd(),
         v_used.global_used,
         v_profile_cap,
         v_used.profile_used,
         v_trusted,
         greatest(0, least(
           private.ai_global_daily_cap_usd() - v_used.global_used,
           v_profile_cap - v_used.profile_used,
           case when not v_trusted then private.ai_untrusted_pool_cap_usd() - v_used.pool_used end,
           case when not v_trusted and v_creator is not null
                then private.ai_creator_cap_usd() - v_used.creator_used end));
end;
$$;

revoke all on function private.ai_global_daily_cap_usd()                                 from public, anon, authenticated, service_role;
revoke all on function private.ai_default_profile_cap_usd()                              from public, anon, authenticated, service_role;
revoke all on function private.ai_untrusted_pool_cap_usd()                               from public, anon, authenticated, service_role;
revoke all on function private.ai_creator_cap_usd()                                      from public, anon, authenticated, service_role;
revoke all on function private.ai_reservation_ttl()                                      from public, anon, authenticated, service_role;
revoke all on function private.ai_row_spend(text, numeric, numeric, timestamptz)         from public, anon, authenticated, service_role;
revoke all on function private.ai_spend_for(uuid, uuid)                                  from public, anon, authenticated, service_role;

revoke all on function public.reserve_ai_budget(uuid, numeric, text, uuid, text, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.settle_ai_budget(text, numeric, integer, integer, text, uuid)  from public, anon, authenticated, service_role;
revoke all on function public.release_ai_budget(text)                                        from public, anon, authenticated, service_role;
revoke all on function public.ai_budget_status(uuid)                                         from public, anon, authenticated, service_role;
grant execute on function public.reserve_ai_budget(uuid, numeric, text, uuid, text, uuid, uuid) to service_role;
grant execute on function public.settle_ai_budget(text, numeric, integer, integer, text, uuid)  to service_role;
grant execute on function public.release_ai_budget(text)                                        to service_role;
grant execute on function public.ai_budget_status(uuid)                                         to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Table privileges (explicit; RLS still applies to authenticated)
-- -----------------------------------------------------------------------------
-- Start from nothing for the API roles on every app table and view.
revoke all on table
  public.users, public.profiles, public.profile_members, public.profile_invitations, public.events,
  public.connections, public.sync_runs, public.campaigns, public.assets, public.source_items,
  public.asset_sources, public.asset_versions, public.reference_library, public.rules,
  public.rule_versions, public.offers, public.offer_versions, public.analysis_runs, public.findings,
  public.finding_dispositions, public.security_alerts, public.change_requests, public.decisions,
  public.recheck_verifications, public.review_sessions, public.ai_usage,
  public.finding_latest_dispositions, public.asset_queue
from anon, authenticated, service_role;

-- authenticated: read (rows filtered by RLS).
grant select on table
  public.users, public.profiles, public.profile_members, public.events,
  public.connections, public.sync_runs, public.campaigns, public.assets, public.source_items,
  public.asset_sources, public.asset_versions, public.reference_library, public.rules,
  public.rule_versions, public.offers, public.offer_versions, public.analysis_runs, public.findings,
  public.finding_dispositions, public.security_alerts, public.change_requests, public.decisions,
  public.recheck_verifications, public.review_sessions, public.ai_usage,
  public.finding_latest_dispositions, public.asset_queue
to authenticated;
-- profile_invitations: every column except token_hash (select('*') fails;
-- name the columns).
grant select (id, profile_id, email, role, invited_by, created_at, expires_at, accepted_at, accepted_by, revoked_at)
  on table public.profile_invitations to authenticated;

-- authenticated: the only direct writes (column-limited, RLS-checked).
grant update (full_name, avatar_url) on table public.users to authenticated;
grant update (name) on table public.profiles to authenticated;
grant insert (profile_id, finding_id, disposition, reason, note, severity_override, actor_id)
  on table public.finding_dispositions to authenticated;
grant insert (profile_id, change_request_id, finding_id, item_index, asset_version_id, status, note, verified_by)
  on table public.recheck_verifications to authenticated;
grant insert (profile_id, user_id, asset_version_id, source_item_id, surface) on table public.review_sessions to authenticated;
grant update (active_seconds, last_heartbeat_at) on table public.review_sessions to authenticated;

-- service_role (secret key, server only; bypasses RLS):
-- full access to mutable tables ...
grant select, insert, update, delete on table
  public.users, public.profiles, public.profile_members, public.profile_invitations,
  public.connections, public.sync_runs, public.campaigns, public.assets, public.source_items,
  public.asset_sources, public.reference_library, public.rules, public.offers,
  public.analysis_runs, public.security_alerts, public.change_requests,
  public.review_sessions, public.ai_usage
to service_role;
-- ... insert-only on append-only tables (no UPDATE/DELETE/TRUNCATE) ...
grant select, insert on table
  public.asset_versions, public.findings, public.rule_versions, public.offer_versions,
  public.finding_dispositions, public.recheck_verifications, public.events
to service_role;
-- ... and read-only on decisions (written only by record_decision() /
-- withdraw_approval()) and the views.
grant select on table public.decisions, public.finding_latest_dispositions, public.asset_queue to service_role;

-- events.id identity sequence.
grant usage, select on all sequences in schema public to service_role;

-- -----------------------------------------------------------------------------
-- 3. Immutability (applies to every role, including service_role).
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'asset_versions', 'findings', 'rule_versions', 'offer_versions',
    'decisions', 'events', 'finding_dispositions', 'recheck_verifications'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_immutable', t);
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function private.forbid_mutation()',
      t || '_immutable', t);
    execute format('drop trigger if exists %I on public.%I', t || '_no_truncate', t);
    execute format(
      'create trigger %I before truncate on public.%I for each statement execute function private.forbid_mutation()',
      t || '_no_truncate', t);
    execute format('revoke update, delete, truncate on table public.%I from anon, authenticated, service_role', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. RLS policies (all scoped TO authenticated; anon has no grants at all).
-- Read model: members read the rows of their profiles, except
--   * profile_invitations: owners only
--   * source_items: private connector items only to the connecting user
--   * security_alerts on a source item: follow that item's visibility
-- SELECT policies use profile_id in (select private.member_profile_ids()),
-- which is evaluated once per statement.
-- -----------------------------------------------------------------------------

-- users: self, plus anyone who shares a profile with the caller.
drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select to authenticated
  using (id = (select auth.uid()) or id in (select private.co_member_ids()));

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- profiles: members read; owners rename (column grant limits it to name).
drop policy if exists profiles_select_member on public.profiles;
create policy profiles_select_member on public.profiles
  for select to authenticated
  using (id in (select private.member_profile_ids()));

drop policy if exists profiles_update_owner on public.profiles;
create policy profiles_update_owner on public.profiles
  for update to authenticated
  using (private.is_owner(id))
  with check (private.is_owner(id));

-- Member-readable, profile-scoped tables.
do $$
declare
  t text;
begin
  foreach t in array array[
    'profile_members', 'events',
    'connections', 'sync_runs', 'campaigns', 'assets', 'asset_sources', 'asset_versions',
    'offers', 'offer_versions', 'analysis_runs', 'findings', 'finding_dispositions',
    'change_requests', 'decisions', 'recheck_verifications', 'review_sessions', 'ai_usage'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_select_member', t);
    execute format(
      'create policy %I on public.%I for select to authenticated '
      'using (profile_id in (select private.member_profile_ids()))',
      t || '_select_member', t);
  end loop;
end;
$$;

-- profile_invitations: owners only.
drop policy if exists profile_invitations_select_member on public.profile_invitations;
drop policy if exists profile_invitations_select_owner on public.profile_invitations;
create policy profile_invitations_select_owner on public.profile_invitations
  for select to authenticated
  using (profile_id in (select private.owner_profile_ids()));

-- source_items: 'profile' items to every member; 'connector_owner' items
-- (unclassified / not marketing / declined mail and files from a member's
-- own account) only to the member who connected that account.
drop policy if exists source_items_select_member on public.source_items;
create policy source_items_select_member on public.source_items
  for select to authenticated
  using (
    profile_id in (select private.member_profile_ids())
    and (visibility = 'profile'
         or connection_id in (select c.id from public.connections c
                              where c.connected_by = (select auth.uid())))
  );

-- security_alerts: members; alerts on a source item only when the caller can
-- see that item (the subquery runs under source_items RLS).
drop policy if exists security_alerts_select_member on public.security_alerts;
create policy security_alerts_select_member on public.security_alerts
  for select to authenticated
  using (
    profile_id in (select private.member_profile_ids())
    and (source_item_id is null
         or exists (select 1 from public.source_items s where s.id = security_alerts.source_item_id))
  );

-- rules / rule_versions: starter library (profile_id null) + own profiles.
drop policy if exists rules_select on public.rules;
create policy rules_select on public.rules
  for select to authenticated
  using (profile_id is null or profile_id in (select private.member_profile_ids()));

drop policy if exists rule_versions_select on public.rule_versions;
create policy rule_versions_select on public.rule_versions
  for select to authenticated
  using (profile_id is null or profile_id in (select private.member_profile_ids()));

-- reference_library: global read.
drop policy if exists reference_library_select on public.reference_library;
create policy reference_library_select on public.reference_library
  for select to authenticated
  using (true);

-- finding_dispositions: members append their own.
drop policy if exists finding_dispositions_insert_own on public.finding_dispositions;
create policy finding_dispositions_insert_own on public.finding_dispositions
  for insert to authenticated
  with check (actor_id = (select auth.uid()) and private.is_member(profile_id));

-- recheck_verifications: members append their own.
drop policy if exists recheck_verifications_insert_own on public.recheck_verifications;
create policy recheck_verifications_insert_own on public.recheck_verifications
  for insert to authenticated
  with check (verified_by = (select auth.uid()) and private.is_member(profile_id));

-- review_sessions: members insert/update only their own rows.
drop policy if exists review_sessions_insert_own on public.review_sessions;
create policy review_sessions_insert_own on public.review_sessions
  for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_member(profile_id));

drop policy if exists review_sessions_update_own on public.review_sessions;
create policy review_sessions_update_own on public.review_sessions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.is_member(profile_id));
