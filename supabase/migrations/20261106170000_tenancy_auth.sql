-- =============================================================================
-- 20261106170000_tenancy_auth.sql
-- Tenancy and auth: users mirror of auth.users, profiles (workspaces),
-- profile_members (owner|member), profile_invitations (email-bound, hashed
-- token), the append-only events log, private RLS helpers and tenancy RPCs.
--
-- Conventions used by every migration in this set:
--   * Every SECURITY DEFINER function sets search_path = '' and fully
--     qualifies every name (pg_catalog is always searched implicitly).
--   * RLS is enabled on every table at creation time (deny-all until the
--     policies in 20261106170300_policies_ai.sql are created).
--   * Client-facing grants and all RLS policies live in 20261106170300.
--   * Every function gets explicit REVOKE/GRANT lines; nothing relies on
--     default privileges (which are tightened below anyway).
--   * Errors meant for the app use PostgREST's PTxxx SQLSTATEs, so the HTTP
--     status matches: PT404 not found, PT409 conflict, PT422 invalid input,
--     PT429 limit. 42501 = forbidden.
--   * Idempotent where practical: IF NOT EXISTS, CREATE OR REPLACE,
--     DROP ... IF EXISTS before CREATE TRIGGER / POLICY.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Default privileges: deny by default for functions created later.
-- A per-schema ALTER DEFAULT PRIVILEGES cannot remove the global PUBLIC
-- EXECUTE default, so that one is revoked globally; Supabase's schema-level
-- grants to anon/authenticated in public are revoked as well. Every RPC added
-- later must GRANT EXECUTE ... TO authenticated explicitly.
-- -----------------------------------------------------------------------------
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

-- -----------------------------------------------------------------------------
-- private schema: helpers used by policies, triggers and RPCs. Not exposed via
-- the Data API (only "public" is). authenticated needs USAGE so that RLS
-- policies can call the helpers granted to it below.
-- -----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Generic trigger functions
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Attached (in 20261106170300) to every immutable / append-only table as
-- BEFORE UPDATE OR DELETE (row) and BEFORE TRUNCATE (statement). It fires for
-- every role, including service_role. The only escape hatch is
-- private.purge_profile(), which sets app.purge_profile = 'on' for the
-- duration of its own transaction; PostgREST clients cannot set that GUC.
create or replace function private.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.purge_profile', true), '') = 'on' then
    return old;
  end if;
  raise exception 'public.% is append-only: % is not allowed', tg_table_name, lower(tg_op)
    using errcode = '42501',
          hint = 'Record a new row (new version, disposition, decision or event) instead.';
end;
$$;

-- -----------------------------------------------------------------------------
-- users: public mirror of auth.users (maintained by triggers below)
-- avatar_url must be https (it is user-controlled via signUp metadata and is
-- rendered to co-members). full_name is free text: the UI always shows the
-- email next to it, so a name cannot impersonate someone.
-- -----------------------------------------------------------------------------
create table if not exists public.users (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null check (email = lower(email)),
  full_name   text check (full_name is null or char_length(full_name) <= 200),
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint users_avatar_https check (
    avatar_url is null or (avatar_url ~ '^https://' and char_length(avatar_url) <= 2048))
);
create index if not exists users_email_idx on public.users (email);
alter table public.users enable row level security;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
  before update on public.users
  for each row execute function private.set_updated_at();

-- Insert/refresh public.users from auth.users. Email always follows auth;
-- name/avatar from OAuth metadata only fill blanks (user edits win). A
-- non-https avatar is dropped. No raise paths: a failure here would block
-- sign-up.
create or replace function private.sync_user_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name   text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name',
                                         new.raw_user_meta_data ->> 'name', '')), '');
  v_avatar text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'avatar_url',
                                         new.raw_user_meta_data ->> 'picture', '')), '');
begin
  if new.email is null then
    return new; -- no email yet (not expected: phone/anonymous sign-in is off)
  end if;
  if v_avatar is not null and (v_avatar !~ '^https://' or char_length(v_avatar) > 2048) then
    v_avatar := null;
  end if;
  insert into public.users as u (id, email, full_name, avatar_url)
  values (new.id, lower(new.email), left(v_name, 200), v_avatar)
  on conflict (id) do update
    set email      = excluded.email,
        full_name  = coalesce(u.full_name, excluded.full_name),
        avatar_url = coalesce(u.avatar_url, excluded.avatar_url);
  return new;
end;
$$;

drop trigger if exists sync_public_user_on_insert on auth.users;
create trigger sync_public_user_on_insert
  after insert on auth.users
  for each row execute function private.sync_user_from_auth();

drop trigger if exists sync_public_user_on_update on auth.users;
create trigger sync_public_user_on_update
  after update of email, raw_user_meta_data on auth.users
  for each row execute function private.sync_user_from_auth();

-- Backfill (no-op on an empty project).
insert into public.users (id, email, full_name, avatar_url)
select au.id,
       lower(au.email),
       left(nullif(btrim(coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name', '')), ''), 200),
       case when coalesce(au.raw_user_meta_data ->> 'avatar_url', au.raw_user_meta_data ->> 'picture', '') ~ '^https://'
             and char_length(coalesce(au.raw_user_meta_data ->> 'avatar_url', au.raw_user_meta_data ->> 'picture')) <= 2048
            then coalesce(au.raw_user_meta_data ->> 'avatar_url', au.raw_user_meta_data ->> 'picture') end
from auth.users au
where au.email is not null
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- profiles: named workspaces (tenants)
-- settings keys (all optional):
--   ai_daily_cap_usd  number 0..10, default 3. Operator-managed.
--   ai_trusted        boolean, default false. Operator-managed. Trusted
--                     profiles skip the shared untrusted pool and the
--                     per-creator cap (see reserve_ai_budget).
--   equal_housing_legend (bool), states (text[]), ... free-form otherwise.
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80 and name = btrim(name)),
  created_by  uuid references public.users (id) on delete set null,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_settings_is_object check (jsonb_typeof(settings) = 'object'),
  -- CASE forces evaluation order, so a non-numeric value is a clean check
  -- violation instead of a 22P02 from the cast.
  constraint profiles_ai_cap_valid check (
    case
      when not (settings ? 'ai_daily_cap_usd') then true
      when jsonb_typeof(settings -> 'ai_daily_cap_usd') <> 'number' then false
      else (settings ->> 'ai_daily_cap_usd')::numeric between 0 and 10
    end),
  constraint profiles_ai_trusted_valid check (
    not (settings ? 'ai_trusted') or jsonb_typeof(settings -> 'ai_trusted') = 'boolean')
);
create index if not exists profiles_created_by_idx on public.profiles (created_by);
alter table public.profiles enable row level security;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- profile_members
-- -----------------------------------------------------------------------------
create table if not exists public.profile_members (
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  user_id     uuid not null references public.users (id) on delete cascade,
  role        text not null default 'member' check (role in ('owner', 'member')),
  invited_by  uuid references public.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (profile_id, user_id)
);
create index if not exists profile_members_user_id_idx on public.profile_members (user_id);
create index if not exists profile_members_invited_by_idx on public.profile_members (invited_by);
alter table public.profile_members enable row level security;

-- A profile must always keep >= 1 owner. Skipped when the profile row itself
-- is gone (profile deletion cascading into its members). One exception: when
-- the account itself is being deleted (its public.users row is already gone
-- in this cascade) and nobody else is left in the profile, the delete is
-- allowed and the profile is left orphaned for the operator to purge. A sole
-- owner of a profile that still has other members cannot be deleted: promote
-- someone first.
create or replace function private.ensure_profile_keeps_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role <> 'owner' then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' and new.profile_id = old.profile_id then
    return null;
  end if;
  -- Lock the profile so concurrent owner removals serialize.
  perform 1 from public.profiles p where p.id = old.profile_id for update;
  if not found then
    return null;
  end if;
  if exists (
    select 1 from public.profile_members m
    where m.profile_id = old.profile_id and m.role = 'owner'
  ) then
    return null;
  end if;
  if tg_op = 'DELETE'
     and not exists (select 1 from public.users u where u.id = old.user_id)
     and not exists (select 1 from public.profile_members m where m.profile_id = old.profile_id) then
    return null;
  end if;
  raise exception 'A profile must keep at least one owner'
    using errcode = 'PT409',
          hint = 'Make another member an owner first.';
end;
$$;

drop trigger if exists profile_members_keep_owner on public.profile_members;
create trigger profile_members_keep_owner
  after update or delete on public.profile_members
  for each row execute function private.ensure_profile_keeps_owner();

-- -----------------------------------------------------------------------------
-- profile_invitations: bound to an email; only sha256(token) is stored.
-- Readable by owners only, and token_hash is not readable by any API role
-- except service_role (column grants in 20261106170300).
-- -----------------------------------------------------------------------------
create table if not exists public.profile_invitations (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  email        text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 320),
  role         text not null default 'member' check (role in ('owner', 'member')),
  invited_by   uuid references public.users (id) on delete set null,
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '7 days'),
  accepted_at  timestamptz,
  accepted_by  uuid references public.users (id) on delete set null,
  revoked_at   timestamptz,
  constraint profile_invitations_single_outcome check (accepted_at is null or revoked_at is null)
);
create unique index if not exists profile_invitations_one_pending_idx
  on public.profile_invitations (profile_id, email)
  where accepted_at is null and revoked_at is null;
create index if not exists profile_invitations_profile_idx on public.profile_invitations (profile_id, created_at desc);
create index if not exists profile_invitations_pending_email_idx
  on public.profile_invitations (email)
  where accepted_at is null and revoked_at is null;
create index if not exists profile_invitations_invited_by_idx on public.profile_invitations (invited_by);
create index if not exists profile_invitations_accepted_by_idx on public.profile_invitations (accepted_by);
alter table public.profile_invitations enable row level security;

-- -----------------------------------------------------------------------------
-- events: APPEND-ONLY audit log (immutability triggers in 20261106170300).
-- actor_id deliberately has no FK so the log survives user deletion.
-- asset_id FK (composite with profile_id) is added in 20261106170100.
-- -----------------------------------------------------------------------------
create table if not exists public.events (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  asset_id    uuid,
  actor_id    uuid,
  kind        text not null check (kind ~ '^[a-z0-9_.-]{1,100}$'),
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists events_profile_asset_created_idx on public.events (profile_id, asset_id, created_at desc);
create index if not exists events_profile_created_idx on public.events (profile_id, created_at desc);
create index if not exists events_actor_idx on public.events (actor_id);
alter table public.events enable row level security;

-- -----------------------------------------------------------------------------
-- private helpers (SECURITY DEFINER, STABLE, search_path '')
-- -----------------------------------------------------------------------------
create or replace function private.is_member(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profile_members m
    where m.profile_id = p_profile_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_owner(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profile_members m
    where m.profile_id = p_profile_id
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
  );
$$;

-- Set-returning variants used by SELECT policies as
--   profile_id in (select private.member_profile_ids())
-- which Postgres evaluates once per statement (hashed subplan), not per row.
create or replace function private.member_profile_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.profile_id from public.profile_members m
  where m.user_id = (select auth.uid());
$$;

create or replace function private.owner_profile_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.profile_id from public.profile_members m
  where m.user_id = (select auth.uid()) and m.role = 'owner';
$$;

-- Users who share at least one profile with the caller (includes the caller).
create or replace function private.co_member_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct b.user_id
  from public.profile_members a
  join public.profile_members b on b.profile_id = a.profile_id
  where a.user_id = (select auth.uid());
$$;

create or replace function private.require_uid()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- Makes sure public.users has a row for the caller (defensive: the auth
-- trigger normally does this).
create or replace function private.ensure_user_row(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email)
  select au.id, lower(au.email)
  from auth.users au
  where au.id = p_user_id and au.email is not null
  on conflict (id) do nothing;
  if not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception 'Account has no email address' using errcode = '42501';
  end if;
end;
$$;

-- The actor for audit events: the signed-in user, else a transaction-local
-- app.actor_id that a future server-side RPC wrapper may set, else null
-- (system / secret-key server).
create or replace function private.current_actor()
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    auth.uid(),
    case when coalesce(current_setting('app.actor_id', true), '')
              ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         then current_setting('app.actor_id', true)::uuid end);
$$;

-- Writes one audit event.
create or replace function private.log_event(
  p_profile_id uuid,
  p_asset_id   uuid,
  p_kind       text,
  p_data       jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.events (profile_id, asset_id, actor_id, kind, data)
  values (p_profile_id, p_asset_id, private.current_actor(), p_kind, coalesce(p_data, '{}'::jsonb));
$$;

create or replace function private.token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

create or replace function private.new_invite_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select encode(extensions.gen_random_bytes(32), 'hex');
$$;

-- 'jane@example.com' -> 'j***@example.com'
create or replace function private.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(p_email, 1) || '***@' || split_part(p_email, '@', 2);
$$;

-- Operator-only: hard-delete a profile and everything under it, including
-- immutable rows. Not granted to any API role; run from the SQL editor.
-- Storage objects under profiles/{id}/ must be removed separately.
create or replace function private.purge_profile(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.purge_profile', 'on', true);
  delete from public.profiles p where p.id = p_profile_id;
  perform set_config('app.purge_profile', 'off', true);
end;
$$;

-- Marks a departing member's connections disconnected (the server reacts to
-- the event/status by deleting the Nango connection and purging that user's
-- private source items and their stored bytes). Returns the connection ids.
create or replace function private.disconnect_member_connections(p_profile_id uuid, p_user_id uuid, p_reason text)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  with d as (
    update public.connections c
       set status = 'disconnected', last_error = p_reason
     where c.profile_id = p_profile_id
       and c.connected_by = p_user_id
       and c.status <> 'disconnected'
    returning c.id
  )
  select coalesce(array_agg(d.id), '{}') into v_ids from d;
  if cardinality(v_ids) > 0 then
    perform private.log_event(p_profile_id, null, 'connection.owner_removed',
      jsonb_build_object('user_id', p_user_id, 'connection_ids', to_jsonb(v_ids), 'reason', p_reason));
  end if;
  return v_ids;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tenancy RPCs (public, SECURITY DEFINER, granted to authenticated only)
-- -----------------------------------------------------------------------------

-- create_profile(name) -> profile id. Creator becomes owner atomically, and
-- the active starter rules are cloned into the profile (analysis only uses a
-- profile's own rules). Limit: 3 profiles created per user (each profile
-- has its own AI sub-cap, so this bounds one person's AI spend).
create or replace function public.create_profile(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := private.require_uid();
  v_name       text := btrim(coalesce(p_name, ''));
  v_profile_id uuid;
  v_cloned     integer;
begin
  if char_length(v_name) not between 1 and 80 then
    raise exception 'Profile name must be 1 to 80 characters' using errcode = 'PT422';
  end if;
  perform private.ensure_user_row(v_uid);
  -- Serialize this user's concurrent create_profile calls for the limit check.
  perform 1 from public.users u where u.id = v_uid for update;
  if (select count(*) from public.profiles p where p.created_by = v_uid) >= 3 then
    raise exception 'Profile limit reached (3 per user)' using errcode = 'PT429';
  end if;

  insert into public.profiles (name, created_by)
  values (v_name, v_uid)
  returning id into v_profile_id;

  insert into public.profile_members (profile_id, user_id, role)
  values (v_profile_id, v_uid, 'owner');

  v_cloned := private.clone_starter_rules(v_profile_id, null);

  perform private.log_event(v_profile_id, null, 'profile.created',
                            jsonb_build_object('name', v_name, 'starter_rules_cloned', v_cloned));
  return v_profile_id;
end;
$$;

-- invite_member(profile, email, role) -> plaintext token (returned ONCE).
-- Owner only. If a pending invitation for that email exists it is reissued
-- (new token, new expiry, role updated) instead of failing.
create or replace function public.invite_member(
  p_profile_id uuid,
  p_email      text,
  p_role       text default 'member'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid           uuid := private.require_uid();
  v_email         text := lower(btrim(coalesce(p_email, '')));
  v_role          text := coalesce(p_role, 'member');
  v_token         text;
  v_invitation_id uuid;
  v_reissued      boolean := false;
begin
  if not private.is_member(p_profile_id) then
    raise exception 'Profile not found' using errcode = 'PT404';
  end if;
  if not private.is_owner(p_profile_id) then
    raise exception 'Only profile owners can invite members' using errcode = '42501';
  end if;
  if v_role not in ('owner', 'member') then
    raise exception 'Role must be owner or member' using errcode = 'PT422';
  end if;
  if char_length(v_email) > 320 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address' using errcode = 'PT422';
  end if;
  if exists (
    select 1
    from public.profile_members m
    join public.users u on u.id = m.user_id
    where m.profile_id = p_profile_id and u.email = v_email
  ) then
    raise exception 'That person is already a member of this profile' using errcode = '23505';
  end if;

  v_token := private.new_invite_token();

  update public.profile_invitations i
     set token_hash = private.token_hash(v_token),
         role       = v_role,
         invited_by = v_uid,
         expires_at = now() + interval '7 days'
   where i.profile_id = p_profile_id
     and i.email = v_email
     and i.accepted_at is null
     and i.revoked_at is null
  returning i.id into v_invitation_id;

  if v_invitation_id is null then
    insert into public.profile_invitations (profile_id, email, role, invited_by, token_hash)
    values (p_profile_id, v_email, v_role, v_uid, private.token_hash(v_token))
    returning id into v_invitation_id;
  else
    v_reissued := true;
  end if;

  perform private.log_event(
    p_profile_id, null,
    case when v_reissued then 'invitation.reissued' else 'invitation.created' end,
    jsonb_build_object('invitation_id', v_invitation_id, 'email', v_email, 'role', v_role));
  return v_token;
end;
$$;

-- revoke_invitation(id). Owner only; idempotent for already-revoked.
create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_inv public.profile_invitations%rowtype;
begin
  select * into v_inv from public.profile_invitations i where i.id = p_invitation_id for update;
  if not found or not private.is_member(v_inv.profile_id) then
    raise exception 'Invitation not found' using errcode = 'PT404';
  end if;
  if not private.is_owner(v_inv.profile_id) then
    raise exception 'Only profile owners can revoke invitations' using errcode = '42501';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'Invitation was already accepted; remove the member instead' using errcode = 'PT409';
  end if;
  if v_inv.revoked_at is not null then
    return;
  end if;
  update public.profile_invitations set revoked_at = now() where id = v_inv.id;
  perform private.log_event(v_inv.profile_id, null, 'invitation.revoked',
    jsonb_build_object('invitation_id', v_inv.id, 'email', v_inv.email, 'by', v_uid));
end;
$$;

-- reissue_invitation(id) -> new plaintext token. Owner only. The old token
-- stops working immediately; expiry restarts at 7 days.
create or replace function public.reissue_invitation(p_invitation_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_uid();
  v_inv   public.profile_invitations%rowtype;
  v_token text;
begin
  select * into v_inv from public.profile_invitations i where i.id = p_invitation_id for update;
  if not found or not private.is_member(v_inv.profile_id) then
    raise exception 'Invitation not found' using errcode = 'PT404';
  end if;
  if not private.is_owner(v_inv.profile_id) then
    raise exception 'Only profile owners can resend invitations' using errcode = '42501';
  end if;
  if v_inv.accepted_at is not null or v_inv.revoked_at is not null then
    raise exception 'Invitation is no longer pending' using errcode = 'PT409';
  end if;

  v_token := private.new_invite_token();
  update public.profile_invitations
     set token_hash = private.token_hash(v_token),
         invited_by = v_uid,
         expires_at = now() + interval '7 days'
   where id = v_inv.id;

  perform private.log_event(v_inv.profile_id, null, 'invitation.reissued',
    jsonb_build_object('invitation_id', v_inv.id, 'email', v_inv.email, 'role', v_inv.role));
  return v_token;
end;
$$;

-- Shared acceptance logic. Requires: pending, not expired, caller's
-- auth.users email confirmed, and both the JWT email and the auth.users
-- email (lowercased) equal to the invitation email. The masked-email hint is
-- given only on the token path (the token holder already knows the invite).
drop function if exists private.accept_invitation_core(uuid);
create or replace function private.accept_invitation_core(p_invitation_id uuid, p_reveal_hint boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := private.require_uid();
  v_inv        public.profile_invitations%rowtype;
  v_user_email text;
  v_confirmed  timestamptz;
  v_jwt_email  text := lower(nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), ''));
begin
  select * into v_inv from public.profile_invitations i where i.id = p_invitation_id for update;
  if not found then
    raise exception 'Invitation not found or no longer valid' using errcode = 'PT404';
  end if;

  select lower(au.email), au.email_confirmed_at
    into v_user_email, v_confirmed
  from auth.users au
  where au.id = v_uid;

  if v_confirmed is null then
    raise exception 'Confirm your email address before accepting this invitation' using errcode = '42501';
  end if;
  if v_user_email is distinct from v_inv.email or v_jwt_email is distinct from v_inv.email then
    if p_reveal_hint then
      raise exception 'This invitation was sent to a different email address'
        using errcode = '42501',
              hint = 'Sign in with ' || private.mask_email(v_inv.email);
    end if;
    raise exception 'This invitation was sent to a different email address' using errcode = '42501';
  end if;

  if v_inv.accepted_at is not null then
    if v_inv.accepted_by = v_uid then
      return v_inv.profile_id; -- idempotent re-accept
    end if;
    raise exception 'Invitation not found or no longer valid' using errcode = 'PT404';
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'This invitation was revoked' using errcode = 'PT409';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'This invitation has expired; ask an owner to resend it' using errcode = 'PT409';
  end if;

  perform private.ensure_user_row(v_uid);

  insert into public.profile_members (profile_id, user_id, role, invited_by)
  values (v_inv.profile_id, v_uid, v_inv.role, v_inv.invited_by)
  on conflict (profile_id, user_id) do nothing;

  update public.profile_invitations
     set accepted_at = now(), accepted_by = v_uid
   where id = v_inv.id;

  perform private.log_event(v_inv.profile_id, null, 'member.joined',
    jsonb_build_object('invitation_id', v_inv.id, 'user_id', v_uid,
                       'email', v_inv.email, 'role', v_inv.role));
  return v_inv.profile_id;
end;
$$;

-- accept_invitation(token) -> profile id (from the invite link).
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_uid();
  if p_token is null or btrim(p_token) !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'Invitation not found or no longer valid' using errcode = 'PT404';
  end if;
  select i.id into v_id
  from public.profile_invitations i
  where i.token_hash = private.token_hash(lower(btrim(p_token)));
  if v_id is null then
    raise exception 'Invitation not found or no longer valid' using errcode = 'PT404';
  end if;
  return private.accept_invitation_core(v_id, true);
end;
$$;

-- accept_invitation_by_id(id) -> profile id. For the in-app pending list
-- (my_pending_invitations). The id is resolved only among invitations for
-- the caller's own verified email before anything is locked or revealed, so
-- a guessed id yields a plain "not found".
create or replace function public.accept_invitation_by_id(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_id  uuid;
begin
  select i.id into v_id
  from public.profile_invitations i
  join auth.users au on au.id = v_uid
  where i.id = p_invitation_id
    and i.email = lower(au.email)
    and au.email_confirmed_at is not null;
  if v_id is null then
    raise exception 'Invitation not found or no longer valid' using errcode = 'PT404';
  end if;
  return private.accept_invitation_core(v_id, false);
end;
$$;

-- peek_invitation(token): what the invite landing page renders before the
-- explicit Accept click. Never returns ids or the full email. No row = the
-- token is unknown.
create or replace function public.peek_invitation(p_token text)
returns table (
  profile_name     text,
  role             text,
  invited_by_name  text,
  masked_email     text,
  status           text,
  expires_at       timestamptz,
  email_matches    boolean,
  email_verified   boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  if p_token is null or btrim(p_token) !~ '^[0-9a-fA-F]{64}$' then
    return;
  end if;
  return query
  select p.name,
         i.role,
         u.full_name,
         private.mask_email(i.email),
         case
           when i.accepted_at is not null then 'accepted'
           when i.revoked_at is not null then 'revoked'
           when i.expires_at <= now() then 'expired'
           else 'pending'
         end,
         i.expires_at,
         coalesce(lower(au.email) = i.email, false),
         coalesce(au.email_confirmed_at is not null, false)
  from public.profile_invitations i
  join public.profiles p on p.id = i.profile_id
  left join public.users u on u.id = i.invited_by
  left join auth.users au on au.id = v_uid
  where i.token_hash = private.token_hash(lower(btrim(p_token)));
end;
$$;

-- my_pending_invitations(): pending, unexpired invitations addressed to the
-- caller's VERIFIED email (empty if the email is unconfirmed).
create or replace function public.my_pending_invitations()
returns table (
  invitation_id    uuid,
  profile_id       uuid,
  profile_name     text,
  role             text,
  invited_by_name  text,
  invited_by_email text,
  created_at       timestamptz,
  expires_at       timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.profile_id, p.name, i.role, u.full_name, u.email, i.created_at, i.expires_at
  from auth.users au
  join public.profile_invitations i on i.email = lower(au.email)
  join public.profiles p on p.id = i.profile_id
  left join public.users u on u.id = i.invited_by
  where au.id = (select auth.uid())
    and au.email_confirmed_at is not null
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now()
    and not exists (
      select 1 from public.profile_members m
      where m.profile_id = i.profile_id and m.user_id = au.id
    )
  order by i.created_at desc;
$$;

-- remove_member(profile, user). Owner only; last owner cannot be removed
-- (enforced by the profile_members_keep_owner trigger). The removed user's
-- connections are marked disconnected in the same transaction.
create or replace function public.remove_member(p_profile_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_uid();
  v_role text;
begin
  if not private.is_member(p_profile_id) then
    raise exception 'Profile not found' using errcode = 'PT404';
  end if;
  if not private.is_owner(p_profile_id) then
    raise exception 'Only profile owners can remove members' using errcode = '42501';
  end if;
  delete from public.profile_members m
   where m.profile_id = p_profile_id and m.user_id = p_user_id
  returning m.role into v_role;
  if v_role is null then
    raise exception 'Member not found' using errcode = 'PT404';
  end if;
  perform private.log_event(p_profile_id, null, 'member.removed',
    jsonb_build_object('user_id', p_user_id, 'role', v_role, 'by', v_uid));
  perform private.disconnect_member_connections(p_profile_id, p_user_id, 'Connection owner was removed from the profile');
end;
$$;

-- leave_profile(profile). Any member; the last owner cannot leave. The
-- leaver's connections are marked disconnected in the same transaction.
create or replace function public.leave_profile(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_uid();
  v_role text;
begin
  delete from public.profile_members m
   where m.profile_id = p_profile_id and m.user_id = v_uid
  returning m.role into v_role;
  if v_role is null then
    raise exception 'Profile not found' using errcode = 'PT404';
  end if;
  perform private.log_event(p_profile_id, null, 'member.left',
    jsonb_build_object('user_id', v_uid, 'role', v_role));
  perform private.disconnect_member_connections(p_profile_id, v_uid, 'Connection owner left the profile');
end;
$$;

-- set_member_role(profile, user, role). Owner only; last owner cannot be
-- demoted (trigger).
create or replace function public.set_member_role(p_profile_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_old text;
begin
  if not private.is_member(p_profile_id) then
    raise exception 'Profile not found' using errcode = 'PT404';
  end if;
  if not private.is_owner(p_profile_id) then
    raise exception 'Only profile owners can change roles' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('owner', 'member') then
    raise exception 'Role must be owner or member' using errcode = 'PT422';
  end if;
  select m.role into v_old
  from public.profile_members m
  where m.profile_id = p_profile_id and m.user_id = p_user_id
  for update;
  if v_old is null then
    raise exception 'Member not found' using errcode = 'PT404';
  end if;
  if v_old = p_role then
    return;
  end if;
  update public.profile_members m
     set role = p_role
   where m.profile_id = p_profile_id and m.user_id = p_user_id;
  perform private.log_event(p_profile_id, null, 'member.role_changed',
    jsonb_build_object('user_id', p_user_id, 'from', v_old, 'to', p_role, 'by', v_uid));
end;
$$;

-- update_profile_settings(profile, patch) -> new settings. Owner only.
-- Shallow-merges patch into settings; a top-level key whose patch value is
-- JSON null is removed (nested nulls are kept as-is). The AI budget keys
-- (ai_daily_cap_usd, ai_trusted) are operator-managed and rejected here.
create or replace function public.update_profile_settings(p_profile_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := private.require_uid();
  v_settings jsonb;
begin
  if not private.is_member(p_profile_id) then
    raise exception 'Profile not found' using errcode = 'PT404';
  end if;
  if not private.is_owner(p_profile_id) then
    raise exception 'Only profile owners can change settings' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Settings patch must be a JSON object' using errcode = 'PT422';
  end if;
  if p_patch ?| array['ai_daily_cap_usd', 'ai_trusted'] then
    raise exception 'AI budget settings are managed by the operator' using errcode = '42501';
  end if;
  update public.profiles p
     set settings = (p.settings
                     || (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                           from jsonb_each(p_patch) e
                          where e.value <> 'null'::jsonb))
                    - coalesce((select array_agg(e.key)
                                  from jsonb_each(p_patch) e
                                 where e.value = 'null'::jsonb), '{}'::text[])
   where p.id = p_profile_id
  returning p.settings into v_settings;
  perform private.log_event(p_profile_id, null, 'profile.settings_updated',
    jsonb_build_object('patch', p_patch, 'by', v_uid));
  return v_settings;
end;
$$;

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
-- private: nothing executable by API roles except the RLS helpers.
revoke all on all functions in schema private from public, anon, authenticated, service_role;
grant execute on function private.is_member(uuid)       to authenticated, service_role;
grant execute on function private.is_owner(uuid)        to authenticated, service_role;
grant execute on function private.member_profile_ids()  to authenticated, service_role;
grant execute on function private.owner_profile_ids()   to authenticated, service_role;
grant execute on function private.co_member_ids()       to authenticated, service_role;

-- public RPCs: authenticated only.
revoke all on function public.create_profile(text)                       from public, anon, authenticated, service_role;
revoke all on function public.invite_member(uuid, text, text)            from public, anon, authenticated, service_role;
revoke all on function public.revoke_invitation(uuid)                    from public, anon, authenticated, service_role;
revoke all on function public.reissue_invitation(uuid)                   from public, anon, authenticated, service_role;
revoke all on function public.accept_invitation(text)                    from public, anon, authenticated, service_role;
revoke all on function public.accept_invitation_by_id(uuid)              from public, anon, authenticated, service_role;
revoke all on function public.peek_invitation(text)                      from public, anon, authenticated, service_role;
revoke all on function public.my_pending_invitations()                   from public, anon, authenticated, service_role;
revoke all on function public.remove_member(uuid, uuid)                  from public, anon, authenticated, service_role;
revoke all on function public.leave_profile(uuid)                        from public, anon, authenticated, service_role;
revoke all on function public.set_member_role(uuid, uuid, text)          from public, anon, authenticated, service_role;
revoke all on function public.update_profile_settings(uuid, jsonb)       from public, anon, authenticated, service_role;

grant execute on function public.create_profile(text)                    to authenticated;
grant execute on function public.invite_member(uuid, text, text)         to authenticated;
grant execute on function public.revoke_invitation(uuid)                 to authenticated;
grant execute on function public.reissue_invitation(uuid)                to authenticated;
grant execute on function public.accept_invitation(text)                 to authenticated;
grant execute on function public.accept_invitation_by_id(uuid)           to authenticated;
grant execute on function public.peek_invitation(text)                   to authenticated;
grant execute on function public.my_pending_invitations()                to authenticated;
grant execute on function public.remove_member(uuid, uuid)               to authenticated;
grant execute on function public.leave_profile(uuid)                     to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text)       to authenticated;
grant execute on function public.update_profile_settings(uuid, jsonb)    to authenticated;
