-- =============================================================================
-- 20261106170500_review_fixes.sql
-- Security / correctness fixes from code review (applies after 170000-170400).
--
--   1. source_items.visibility: automatic classification never widens
--      visibility. Mail and files from a member's connected account stay
--      private to that member until a human links/accepts them in triage.
--   2. connections.nango_revoked_at: lets the server sweep every
--      'disconnected' row whose Nango grant was not deleted yet, however it
--      got disconnected (remove_member / leave_profile called directly
--      through PostgREST, a failed delete, ...).
--   3. webhook_receipts: replay protection for Nango webhooks (Nango's HMAC
--      covers only the body, with no timestamp or nonce).
--   4. Invitations: at most 20 invitation emails (new + reissued) per profile
--      per rolling 24 h (PT429), and the audit log stores masked invitee
--      emails (events are readable by every member; invitations by owners
--      only).
--   5. find_unconfirmed_password_user(): service-role lookup used to stop
--      pre-account hijacking (an unconfirmed account whose password someone
--      else chose is deleted before an invite or email-code sign-in reuses it).
--   6. recover_stale_syncs(): closes sync runs killed by a platform timeout
--      and resets their connections from 'syncing'.
-- Conventions as in 20261106170000 (search_path = '', explicit grants).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. source_items.visibility (PG17: ALTER COLUMN ... SET EXPRESSION)
-- -----------------------------------------------------------------------------
-- Before: classification 'marketing' / 'new_version' made an item visible to
-- every member. The keyword pre-classifier fires on ordinary personal or
-- banking mail (a card statement, a loan offer), and anyone who can email a
-- member could push content into the shared queue. Now only a human action
-- (accept / merge / split / version in triage, or linking to an asset)
-- shares a connector item with the profile.
alter table public.source_items
  alter column visibility set expression as (
    case
      when provider in ('upload', 'paste', 'import') then 'profile'
      when asset_id is not null
        or triage_status in ('accepted', 'merged', 'split', 'versioned') then 'profile'
      else 'connector_owner'
    end
  );

comment on column public.source_items.visibility is
  'Generated. profile = every member; connector_owner = only the member who connected the source account. '
  'Connector items become profile-visible only through a human triage action (accepted/merged/split/versioned) '
  'or an asset link; automatic classification never widens visibility.';

-- -----------------------------------------------------------------------------
-- 2. connections.nango_revoked_at
-- -----------------------------------------------------------------------------
alter table public.connections add column if not exists nango_revoked_at timestamptz;

comment on column public.connections.nango_revoked_at is
  'When the Nango connection (and its OAuth tokens) was deleted. Null on a disconnected row = revocation still pending; '
  'the server sweep (revokeDisconnectedNangoConnections) deletes it at Nango and sets this.';

create index if not exists connections_revoke_pending_idx
  on public.connections (updated_at)
  where status = 'disconnected' and nango_revoked_at is null;

-- -----------------------------------------------------------------------------
-- 3. webhook_receipts (server only)
-- -----------------------------------------------------------------------------
create table if not exists public.webhook_receipts (
  body_sha256  text primary key check (body_sha256 ~ '^[0-9a-f]{64}$'),
  source       text not null default 'nango' check (char_length(source) between 1 and 50),
  received_at  timestamptz not null default now()
);
create index if not exists webhook_receipts_received_idx on public.webhook_receipts (received_at);
alter table public.webhook_receipts enable row level security;
-- No policies: deny-all for API roles; only the secret key (service_role) writes.
revoke all on table public.webhook_receipts from anon, authenticated, service_role;
grant select, insert, delete on table public.webhook_receipts to service_role;

-- -----------------------------------------------------------------------------
-- 4. Invitations: rate limit + masked emails in events
-- -----------------------------------------------------------------------------
-- Invitation emails sent for a profile in the last 24 h (new + reissued).
-- Serialized per profile by the caller's advisory lock.
create or replace function private.enforce_invite_rate_limit(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invite:' || p_profile_id::text, 0));
  if (select count(*)
        from public.events e
       where e.profile_id = p_profile_id
         and e.kind in ('invitation.created', 'invitation.reissued')
         and e.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'Invitation limit reached (20 per profile per day). Try again tomorrow.'
      using errcode = 'PT429';
  end if;
end;
$$;

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

  perform private.enforce_invite_rate_limit(p_profile_id);

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

  -- events are readable by every member; the full email stays in
  -- profile_invitations (owners only).
  perform private.log_event(
    p_profile_id, null,
    case when v_reissued then 'invitation.reissued' else 'invitation.created' end,
    jsonb_build_object('invitation_id', v_invitation_id,
                       'email_masked', private.mask_email(v_email),
                       'role', v_role));
  return v_token;
end;
$$;

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
    jsonb_build_object('invitation_id', v_inv.id,
                       'email_masked', private.mask_email(v_inv.email),
                       'by', v_uid));
end;
$$;

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

  perform private.enforce_invite_rate_limit(v_inv.profile_id);

  v_token := private.new_invite_token();
  update public.profile_invitations
     set token_hash = private.token_hash(v_token),
         invited_by = v_uid,
         expires_at = now() + interval '7 days'
   where id = v_inv.id;

  perform private.log_event(v_inv.profile_id, null, 'invitation.reissued',
    jsonb_build_object('invitation_id', v_inv.id,
                       'email_masked', private.mask_email(v_inv.email),
                       'role', v_inv.role));
  return v_token;
end;
$$;

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
                       'email_masked', private.mask_email(v_inv.email), 'role', v_inv.role));
  return v_inv.profile_id;
end;
$$;

revoke all on function private.enforce_invite_rate_limit(uuid)            from public, anon, authenticated, service_role;
revoke all on function private.accept_invitation_core(uuid, boolean)      from public, anon, authenticated, service_role;
revoke all on function public.invite_member(uuid, text, text)             from public, anon, authenticated, service_role;
revoke all on function public.revoke_invitation(uuid)                     from public, anon, authenticated, service_role;
revoke all on function public.reissue_invitation(uuid)                    from public, anon, authenticated, service_role;
grant execute on function public.invite_member(uuid, text, text)          to authenticated;
grant execute on function public.revoke_invitation(uuid)                  to authenticated;
grant execute on function public.reissue_invitation(uuid)                 to authenticated;

-- -----------------------------------------------------------------------------
-- 5. find_unconfirmed_password_user(email) -> auth user id (service_role only)
-- -----------------------------------------------------------------------------
-- An unconfirmed account that already has a password was registered by
-- whoever typed that password, not necessarily the mailbox owner. Before the
-- server sends an invite or an email-code sign-in for that address, it
-- deletes such an account so confirming the email cannot hand the earlier
-- registrant a confirmed login.
create or replace function public.find_unconfirmed_password_user(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select au.id
  from auth.users au
  where lower(au.email) = lower(btrim(coalesce(p_email, '')))
    and au.email_confirmed_at is null
    and coalesce(au.encrypted_password, '') <> ''
  limit 1;
$$;

revoke all on function public.find_unconfirmed_password_user(text) from public, anon, authenticated, service_role;
grant execute on function public.find_unconfirmed_password_user(text) to service_role;

-- -----------------------------------------------------------------------------
-- 6. recover_stale_syncs(stale_after) -> connections reset (service_role only)
-- -----------------------------------------------------------------------------
-- A platform timeout can kill a sync between "status = syncing" and its
-- finish block. Closes sync_runs left open longer than p_stale_after and
-- moves connections that are still 'syncing' without a live run back to
-- 'connected' (the next run resumes from the saved cursor).
create or replace function public.recover_stale_syncs(p_stale_after interval default interval '5 minutes')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stale interval := greatest(coalesce(p_stale_after, interval '5 minutes'), interval '2 minutes');
  v_reset integer;
begin
  update public.sync_runs r
     set finished_at = now(),
         error = coalesce(r.error, 'Timed out before finishing')
   where r.finished_at is null
     and r.started_at < now() - v_stale;

  update public.connections c
     set status = 'connected',
         last_error = coalesce(c.last_error, 'The last sync timed out; the next one resumes where it stopped.')
   where c.status = 'syncing'
     and c.updated_at < now() - v_stale
     and not exists (
       select 1 from public.sync_runs r
       where r.connection_id = c.id and r.profile_id = c.profile_id and r.finished_at is null
     );
  get diagnostics v_reset = row_count;
  return v_reset;
end;
$$;

revoke all on function public.recover_stale_syncs(interval) from public, anon, authenticated, service_role;
grant execute on function public.recover_stale_syncs(interval) to service_role;
