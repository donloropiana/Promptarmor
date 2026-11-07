-- =============================================================================
-- 20261106170100_intake.sql
-- Intake and content: Nango connections, sync runs, source items (raw
-- arrivals), campaigns, assets, asset <-> source provenance, and IMMUTABLE
-- asset versions (with the triggers that maintain assets.latest_version_id,
-- the review status, the queued analysis run and the asset audit trail).
--
-- Tenant consistency: child rows reference parents through composite foreign
-- keys (parent_id, profile_id) -> parent (id, profile_id), so even server code
-- running with the secret key cannot link rows across profiles.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- connections: one row per Nango connection (one per integration). Nango does
-- not know about tenancy: connect-session tags carry end_user_id (user id) and
-- organization_id (profile id); the webhook handler maps
-- (provider_config_key, nango_connection_id) -> profile_id here.
-- Server-written (secret key) only. The integration unique keys in Nango are
-- the provider names, so provider_config_key must equal provider.
-- -----------------------------------------------------------------------------
create table if not exists public.connections (
  id                   uuid primary key default gen_random_uuid(),
  profile_id           uuid not null references public.profiles (id) on delete cascade,
  provider             text not null check (provider in (
                         'google-mail', 'google-drive', 'google-sheet',
                         'outlook', 'one-drive', 'one-drive-personal')),
  provider_group       text generated always as (
                         case when provider like 'google-%' then 'google' else 'microsoft' end
                       ) stored,
  nango_connection_id  text not null,
  provider_config_key  text not null,
  account_email        text,
  connected_by         uuid references public.users (id) on delete set null,
  status               text not null default 'syncing' check (status in (
                         'connected', 'syncing', 'needs_reconnect', 'error', 'disconnected')),
  watch                jsonb not null default '{"mode":"smart"}'::jsonb,
  cursor               jsonb not null default '{}'::jsonb,
  last_synced_at       timestamptz,
  last_error           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint connections_id_profile_key unique (id, profile_id),
  constraint connections_nango_key unique (provider_config_key, nango_connection_id),
  constraint connections_config_key_matches check (provider_config_key = provider)
);
create index if not exists connections_profile_idx on public.connections (profile_id, provider_group);
create index if not exists connections_connected_by_idx on public.connections (connected_by);
alter table public.connections enable row level security;

drop trigger if exists connections_set_updated_at on public.connections;
create trigger connections_set_updated_at
  before update on public.connections
  for each row execute function private.set_updated_at();

-- A connection can only be attached to a profile its connecting user is a
-- CURRENT member of. Connect sessions stay valid for a while, so a member
-- removed after starting OAuth must not be able to finish attaching one.
create or replace function private.connections_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.connected_by is null or not exists (
    select 1 from public.profile_members m
    where m.profile_id = new.profile_id and m.user_id = new.connected_by
  ) then
    raise exception 'connected_by must be a current member of the profile'
      using errcode = '42501',
            hint = 'Map the connect-session tags (end_user_id, organization_id) only after checking membership.';
  end if;
  return new;
end;
$$;

drop trigger if exists connections_before_insert on public.connections;
create trigger connections_before_insert
  before insert on public.connections
  for each row execute function private.connections_before_insert();

-- -----------------------------------------------------------------------------
-- sync_runs: per-run history for the Sources drawer.
-- -----------------------------------------------------------------------------
create table if not exists public.sync_runs (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references public.profiles (id) on delete cascade,
  connection_id  uuid not null,
  kind           text not null check (kind in ('initial', 'incremental', 'gap_rescan', 'manual')),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  stats          jsonb not null default '{}'::jsonb,
  error          text,
  constraint sync_runs_connection_fk foreign key (connection_id, profile_id)
    references public.connections (id, profile_id) on delete cascade
);
create index if not exists sync_runs_connection_idx on public.sync_runs (connection_id, profile_id, started_at desc);
create index if not exists sync_runs_profile_idx on public.sync_runs (profile_id, started_at desc);
alter table public.sync_runs enable row level security;

-- -----------------------------------------------------------------------------
-- campaigns: optional label with inherited defaults.
-- -----------------------------------------------------------------------------
create table if not exists public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  defaults    jsonb not null default '{}'::jsonb check (jsonb_typeof(defaults) = 'object'),
  created_by  uuid references public.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint campaigns_id_profile_key unique (id, profile_id)
);
create unique index if not exists campaigns_profile_name_key on public.campaigns (profile_id, lower(name));
create index if not exists campaigns_created_by_idx on public.campaigns (created_by);
alter table public.campaigns enable row level security;

drop trigger if exists campaigns_set_updated_at on public.campaigns;
create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- assets: the reviewable thing.
--   submitted_at / is_draft: null = preflight draft (status stays
--     'preflighting'; the reviewer queue never sees it) until
--     submit_for_review(). Connector and triage-accepted assets are created
--     with submitted_at = now().
--   latest_version_id / approved_version_id: pointers into asset_versions
--     (FKs added below). approved_version_id is the version that is currently
--     approved ("live"); a newer unapproved version never clears it, so
--       changed_after_approval = approved_version_id is not null
--                                and latest_version_id <> approved_version_id
--     It is cleared only by record_decision() (rejecting / requesting changes
--     on that same version) and withdraw_approval().
--   approved_decision_id: the decision behind approved_version_id.
--   assignee_id: must be a current member (composite FK to profile_members;
--     cleared automatically when that member leaves).
-- -----------------------------------------------------------------------------
create table if not exists public.assets (
  id                      uuid primary key default gen_random_uuid(),
  profile_id              uuid not null references public.profiles (id) on delete cascade,
  campaign_id             uuid,
  title                   text not null default 'Untitled asset' check (char_length(title) between 1 and 500),
  product                 text not null default 'unknown' check (product in (
                            'personal_loan', 'credit_card', 'mortgage', 'other', 'unknown')),
  channel                 text,
  submitter_name          text,
  submitter_email         text,
  submitter_org           text,
  states                  text[] not null default '{}',
  audience                text,
  due_date                date,
  status                  text not null default 'preflighting' check (status in (
                            'preflighting', 'needs_review', 'needs_manual_review',
                            'changes_requested', 'recheck_ready', 'approved',
                            'approved_with_exceptions', 'rejected', 're_review_due', 'withdrawn')),
  submitted_at            timestamptz,
  is_draft                boolean generated always as (submitted_at is null) stored,
  latest_version_id       uuid,
  approved_version_id     uuid,
  approved_decision_id    uuid,
  changed_after_approval  boolean generated always as (
                            approved_version_id is not null
                            and latest_version_id is distinct from approved_version_id
                          ) stored,
  re_review_reason        jsonb check (re_review_reason is null or jsonb_typeof(re_review_reason) = 'object'),
  assignee_id             uuid,
  in_market_from          date,
  in_market_to            date,
  approval_expires_at     timestamptz,
  retain_until            date,
  created_by              uuid references public.users (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint assets_id_profile_key unique (id, profile_id),
  constraint assets_campaign_fk foreign key (campaign_id, profile_id)
    references public.campaigns (id, profile_id) on delete set null (campaign_id),
  constraint assets_assignee_fk foreign key (profile_id, assignee_id)
    references public.profile_members (profile_id, user_id) on delete set null (assignee_id),
  constraint assets_in_market_dates check (
    in_market_from is null or in_market_to is null or in_market_to >= in_market_from),
  constraint assets_draft_status check (submitted_at is not null or status in ('preflighting', 'withdrawn')),
  constraint assets_approval_state check (
    (status not in ('approved', 'approved_with_exceptions') or approved_version_id is not null)
    and (status <> 'withdrawn' or approved_version_id is null)
    and ((approved_version_id is null) = (approved_decision_id is null)))
);
create index if not exists assets_queue_idx on public.assets (profile_id, status, updated_at desc);
create index if not exists assets_assignee_idx on public.assets (profile_id, assignee_id, status);
create index if not exists assets_changed_after_approval_idx on public.assets (profile_id) where changed_after_approval;
create index if not exists assets_campaign_idx on public.assets (campaign_id, profile_id);
create index if not exists assets_latest_version_idx on public.assets (latest_version_id, id);
create index if not exists assets_approved_version_idx on public.assets (approved_version_id, id);
create index if not exists assets_approved_decision_idx on public.assets (approved_decision_id, id);
create index if not exists assets_created_by_idx on public.assets (created_by);
alter table public.assets enable row level security;

drop trigger if exists assets_set_updated_at on public.assets;
create trigger assets_set_updated_at
  before update on public.assets
  for each row execute function private.set_updated_at();

-- "AI never approves", enforced in the database: approval state, the
-- latest-version pointer and submission can only change inside
-- record_decision()/withdraw_approval(), the asset_versions insert trigger
-- and submit_for_review() (which set transaction-local flags that API
-- clients, including the secret-key server, cannot set).
create or replace function private.guard_asset_pointers()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_deciding   boolean := coalesce(current_setting('app.recording_decision', true), '') = 'on';
  v_versioning boolean := coalesce(current_setting('app.inserting_version', true), '') = 'on';
  v_submitting boolean := coalesce(current_setting('app.submitting', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.approved_version_id is not null
       or new.approved_decision_id is not null
       or new.latest_version_id is not null
       or new.status in ('approved', 'approved_with_exceptions') then
      raise exception 'New assets start without versions or approvals'
        using errcode = '42501',
              hint = 'Insert asset_versions rows; record approvals with record_decision().';
    end if;
    return new;
  end if;

  if not v_deciding and (
       new.approved_version_id is distinct from old.approved_version_id
       or new.approved_decision_id is distinct from old.approved_decision_id
       or (new.status in ('approved', 'approved_with_exceptions') and new.status is distinct from old.status)
     ) then
    raise exception 'Approvals can only be recorded through record_decision()' using errcode = '42501';
  end if;

  if not v_versioning and new.latest_version_id is distinct from old.latest_version_id then
    raise exception 'latest_version_id is maintained by the asset_versions trigger' using errcode = '42501';
  end if;

  if not v_submitting and new.submitted_at is distinct from old.submitted_at then
    raise exception 'submitted_at is set only by submit_for_review()' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists assets_guard_pointers on public.assets;
create trigger assets_guard_pointers
  before insert or update on public.assets
  for each row execute function private.guard_asset_pointers();

-- Audit trail written by the database, whoever changes the row (secret-key
-- server included): asset.created, asset.status_changed {from, to} and
-- asset.metadata_updated {changed: {column: [old, new]}}. Actor is
-- private.current_actor() (the signed-in user, else null = system).
create or replace function private.assets_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed jsonb;
begin
  if coalesce(current_setting('app.purge_profile', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform private.log_event(new.profile_id, new.id, 'asset.created', jsonb_build_object(
      'title', new.title, 'product', new.product, 'channel', new.channel, 'status', new.status,
      'submitted', new.submitted_at is not null, 'campaign_id', new.campaign_id,
      'created_by', new.created_by));
    return null;
  end if;

  if new.status is distinct from old.status then
    perform private.log_event(new.profile_id, new.id, 'asset.status_changed', jsonb_build_object(
      'from', old.status, 'to', new.status,
      'latest_version_id', new.latest_version_id,
      'approved_version_id', new.approved_version_id));
  end if;

  select jsonb_object_agg(o.key, jsonb_build_array(o.value, n.value))
    into v_changed
  from jsonb_each(to_jsonb(old)) o
  join jsonb_each(to_jsonb(new)) n on n.key = o.key
  where o.key = any (array[
          'title', 'product', 'channel', 'states', 'audience', 'due_date', 'campaign_id',
          'submitter_name', 'submitter_email', 'submitter_org', 'assignee_id',
          'in_market_from', 'in_market_to', 'approval_expires_at', 'retain_until', 're_review_reason'])
    and o.value is distinct from n.value;
  if v_changed is not null then
    perform private.log_event(new.profile_id, new.id, 'asset.metadata_updated',
      jsonb_build_object('changed', v_changed));
  end if;
  return null;
end;
$$;

drop trigger if exists assets_audit on public.assets;
create trigger assets_audit
  after insert or update on public.assets
  for each row execute function private.assets_audit();

-- -----------------------------------------------------------------------------
-- source_items: raw arrivals (connector items, uploads, pastes, imports).
--   source_key          stable identity of the source object:
--                       short provider prefix + stable id (+ part), as built
--                       by lib/connectors/*: 'gmail:<msgId>:body',
--                       'gmail:<msgId>:<attachment>', 'outlook:<msgId>:body',
--                       'outlook:<msgId>:<attachment>', 'gdrive:<fileId>',
--                       'onedrive:<itemId>', 'upload:<uuid>'.
--   source_revision     provider revision of that object (Drive
--                       headRevisionId/modifiedTime, Graph eTag, Gmail
--                       message id). Lets a file reverted to earlier bytes
--                       (A -> B -> A) arrive again.
--   content_sha256      lowercase hex sha256 of the exact bytes (or of the
--                       exported text for Google Docs).
--   normalized_text_hash lowercase hex sha256 of normalized extracted text
--                       (NFKC, lowercase, zero-width chars removed, whitespace
--                       collapsed) - catches re-exports with new bytes.
-- UNIQUE NULLS NOT DISTINCT (profile_id, source_key, source_revision,
-- content_sha256) makes sync idempotent: insert ... on conflict do nothing.
--
-- visibility (generated): items from a member's connected mailbox/drive are
-- private to the connecting user ('connector_owner') until they are
-- classified marketing/new_version, linked to an asset, or accepted/merged/
-- split/versioned in triage; declined items go back to private. Uploads,
-- pastes and imports are always 'profile'. RLS (20261106170300) and the
-- storage policy (20261106170400) enforce it.
-- asset_id is the PRIMARY asset only; asset_sources is the truth for
-- split/merge provenance.
-- -----------------------------------------------------------------------------
create table if not exists public.source_items (
  id                     uuid primary key default gen_random_uuid(),
  profile_id             uuid not null references public.profiles (id) on delete cascade,
  connection_id          uuid,
  provider               text not null check (provider in (
                           'google-mail', 'google-drive', 'google-sheet',
                           'outlook', 'one-drive', 'one-drive-personal',
                           'upload', 'paste', 'import')),
  kind                   text not null check (kind in ('email', 'attachment', 'file', 'sheet_row', 'upload', 'paste')),
  external_id            text,
  parent_external_id     text,
  parent_source_item_id  uuid,
  source_key             text not null check (char_length(source_key) between 1 and 1000),
  source_revision        text check (source_revision is null or char_length(source_revision) <= 500),
  source_url             text,
  title                  text,
  sender                 text,
  sender_email           text,
  occurred_at            timestamptz,
  mime_type              text,
  size_bytes             bigint check (size_bytes is null or size_bytes >= 0),
  content_sha256         text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  normalized_text_hash   text check (normalized_text_hash is null or normalized_text_hash ~ '^[0-9a-f]{64}$'),
  storage_path           text,
  extracted_text         text,
  metadata               jsonb not null default '{}'::jsonb,
  classification         text not null default 'pending' check (classification in (
                           'pending', 'marketing', 'not_marketing', 'uncertain', 'duplicate',
                           'new_version', 'inline_image')),
  classification_reason  text,
  inferred               jsonb not null default '{}'::jsonb,
  candidate_asset_id     uuid,
  match_score            numeric(5, 4) check (match_score is null or match_score between 0 and 1),
  match_reason           text,
  triage_status          text not null default 'pending' check (triage_status in (
                           'pending', 'accepted', 'declined', 'merged', 'snoozed', 'split', 'versioned')),
  triage_reason          text check (triage_reason is null or char_length(triage_reason) <= 1000),
  snoozed_until          timestamptz,
  triaged_by             uuid references public.users (id) on delete set null,
  triaged_at             timestamptz,
  duplicate_of           uuid,
  asset_id               uuid,
  visibility             text generated always as (
                           case
                             when provider in ('upload', 'paste', 'import') then 'profile'
                             when asset_id is not null
                               or triage_status in ('accepted', 'merged', 'split', 'versioned') then 'profile'
                             when triage_status = 'declined' then 'connector_owner'
                             when classification in ('marketing', 'new_version') then 'profile'
                             else 'connector_owner'
                           end
                         ) stored,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint source_items_id_profile_key unique (id, profile_id),
  constraint source_items_dedupe_key unique nulls not distinct (profile_id, source_key, source_revision, content_sha256),
  constraint source_items_storage_path_in_profile check (
    storage_path is null
    or storage_path like ('profiles/' || profile_id::text || '/sources/' || id::text || '/%')),
  constraint source_items_connection_fk foreign key (connection_id, profile_id)
    references public.connections (id, profile_id) on delete set null (connection_id),
  constraint source_items_parent_fk foreign key (parent_source_item_id, profile_id)
    references public.source_items (id, profile_id) on delete cascade,
  constraint source_items_duplicate_of_fk foreign key (duplicate_of, profile_id)
    references public.source_items (id, profile_id) on delete set null (duplicate_of),
  constraint source_items_asset_fk foreign key (asset_id, profile_id)
    references public.assets (id, profile_id) on delete set null (asset_id),
  constraint source_items_candidate_asset_fk foreign key (candidate_asset_id, profile_id)
    references public.assets (id, profile_id) on delete set null (candidate_asset_id)
);
create index if not exists source_items_triage_idx on public.source_items (profile_id, triage_status, created_at desc);
create index if not exists source_items_sha_idx on public.source_items (profile_id, content_sha256);
create index if not exists source_items_text_hash_idx on public.source_items (profile_id, normalized_text_hash);
create index if not exists source_items_parent_idx on public.source_items (profile_id, parent_external_id);
create index if not exists source_items_parent_item_idx on public.source_items (parent_source_item_id, profile_id);
create index if not exists source_items_connection_idx on public.source_items (connection_id, profile_id, external_id);
create index if not exists source_items_duplicate_of_idx on public.source_items (duplicate_of, profile_id);
create index if not exists source_items_asset_idx on public.source_items (asset_id, profile_id);
create index if not exists source_items_candidate_asset_idx on public.source_items (candidate_asset_id, profile_id);
create index if not exists source_items_triaged_by_idx on public.source_items (triaged_by);
alter table public.source_items enable row level security;

drop trigger if exists source_items_set_updated_at on public.source_items;
create trigger source_items_set_updated_at
  before update on public.source_items
  for each row execute function private.set_updated_at();

-- Defense in depth: text of items classified not_marketing is never kept
-- (the server also deletes their stored bytes and nulls storage_path).
create or replace function private.source_items_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.classification = 'not_marketing' then
    new.extracted_text := null;
  end if;
  return new;
end;
$$;

drop trigger if exists source_items_before_write on public.source_items;
create trigger source_items_before_write
  before insert or update on public.source_items
  for each row execute function private.source_items_before_write();

-- True when the caller may see this source item (member + visibility rule).
-- For SECURITY DEFINER code paths, which bypass RLS.
create or replace function private.visible_source_item(p_source_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.source_items s
    where s.id = p_source_item_id
      and s.profile_id in (select private.member_profile_ids())
      and (s.visibility = 'profile'
           or exists (select 1 from public.connections c
                      where c.id = s.connection_id
                        and c.connected_by = (select auth.uid())))
  );
$$;

-- -----------------------------------------------------------------------------
-- asset_sources: provenance (an asset can be seen in several source items,
-- e.g. the same PDF in two emails and a Drive folder).
-- -----------------------------------------------------------------------------
create table if not exists public.asset_sources (
  asset_id        uuid not null,
  source_item_id  uuid not null,
  profile_id      uuid not null references public.profiles (id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (asset_id, source_item_id),
  constraint asset_sources_asset_fk foreign key (asset_id, profile_id)
    references public.assets (id, profile_id) on delete cascade,
  constraint asset_sources_source_item_fk foreign key (source_item_id, profile_id)
    references public.source_items (id, profile_id) on delete cascade
);
create index if not exists asset_sources_source_item_idx on public.asset_sources (source_item_id, profile_id);
create index if not exists asset_sources_asset_profile_idx on public.asset_sources (asset_id, profile_id);
create index if not exists asset_sources_profile_idx on public.asset_sources (profile_id);
alter table public.asset_sources enable row level security;

-- -----------------------------------------------------------------------------
-- asset_versions: IMMUTABLE (triggers in 20261106170300). version_no is
-- assigned by trigger (leave it null, or pass the expected next number).
-- content: { format, subject?, preheader?, sections: [{id, label, text}], ... }
-- author_id: the member who authored this content. REQUIRED for upload,
-- paste, reviewer_edit and suggestion_applied (the server sets it to the
-- signed-in user); null for sync/email/import. Drives self-approval rules.
-- storage_path: a write-once object under profiles/{profile_id}/versions/
-- (unique per version; never upserted).
-- -----------------------------------------------------------------------------
create table if not exists public.asset_versions (
  id                    uuid primary key default gen_random_uuid(),
  profile_id            uuid not null references public.profiles (id) on delete cascade,
  asset_id              uuid not null,
  version_no            integer not null check (version_no >= 1),
  origin                text not null check (origin in (
                          'upload', 'paste', 'sync', 'email', 'reviewer_edit', 'suggestion_applied', 'import')),
  source_item_id        uuid,
  author_id             uuid references public.users (id),
  content               jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  extracted_text        text,
  content_sha256        text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  normalized_text_hash  text check (normalized_text_hash is null or normalized_text_hash ~ '^[0-9a-f]{64}$'),
  storage_path          text,
  created_at            timestamptz not null default now(),
  constraint asset_versions_asset_version_no_key unique (asset_id, version_no),
  constraint asset_versions_id_profile_key unique (id, profile_id),
  constraint asset_versions_id_asset_key unique (id, asset_id),
  constraint asset_versions_author_required check (
    origin not in ('upload', 'paste', 'reviewer_edit', 'suggestion_applied') or author_id is not null),
  constraint asset_versions_storage_path_in_profile check (
    storage_path is null or storage_path like ('profiles/' || profile_id::text || '/versions/%')),
  constraint asset_versions_asset_fk foreign key (asset_id, profile_id)
    references public.assets (id, profile_id) on delete cascade,
  constraint asset_versions_source_item_fk foreign key (source_item_id, profile_id)
    references public.source_items (id, profile_id)
);
create index if not exists asset_versions_profile_idx on public.asset_versions (profile_id, created_at desc);
create index if not exists asset_versions_asset_profile_idx on public.asset_versions (asset_id, profile_id);
create index if not exists asset_versions_source_item_idx on public.asset_versions (source_item_id, profile_id);
create index if not exists asset_versions_author_idx on public.asset_versions (author_id);
create index if not exists asset_versions_text_hash_idx on public.asset_versions (profile_id, normalized_text_hash);
create unique index if not exists asset_versions_storage_path_key on public.asset_versions (storage_path)
  where storage_path is not null;
alter table public.asset_versions enable row level security;

-- Pointer FKs from assets (composite, so a pointer can only target a version
-- of the same asset).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'assets_latest_version_fk') then
    alter table public.assets
      add constraint assets_latest_version_fk foreign key (latest_version_id, id)
      references public.asset_versions (id, asset_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'assets_approved_version_fk') then
    alter table public.assets
      add constraint assets_approved_version_fk foreign key (approved_version_id, id)
      references public.asset_versions (id, asset_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_asset_fk') then
    alter table public.events
      add constraint events_asset_fk foreign key (asset_id, profile_id)
      references public.assets (id, profile_id);
  end if;
end;
$$;

-- BEFORE INSERT: serialize per asset, assign version_no, and refuse a
-- version whose bytes equal the latest version's (no-op versions).
create or replace function private.asset_versions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next       integer;
  v_latest_sha text;
begin
  perform 1 from public.assets a
   where a.id = new.asset_id and a.profile_id = new.profile_id
  for update;
  if not found then
    raise exception 'Asset not found in this profile' using errcode = '23503';
  end if;
  select v.version_no + 1, v.content_sha256
    into v_next, v_latest_sha
  from public.asset_versions v
  where v.asset_id = new.asset_id
  order by v.version_no desc
  limit 1;
  v_next := coalesce(v_next, 1);
  if new.version_no is null then
    new.version_no := v_next;
  elsif new.version_no <> v_next then
    raise exception 'Next version_no for this asset is %, got %', v_next, new.version_no
      using errcode = 'PT409';
  end if;
  if v_latest_sha is not null and v_latest_sha = new.content_sha256 then
    raise exception 'This content is identical to the latest version (V%)', v_next - 1
      using errcode = 'PT409', hint = 'unchanged';
  end if;
  return new;
end;
$$;

-- AFTER INSERT: move the latest pointer and the review status, and queue the
-- analysis run in the same transaction (so there is never a window in which
-- a version exists with no analysis_runs row; the server claims this queued
-- row instead of inserting its own). Never touches approved_version_id.
--   draft (submitted_at null)          => preflighting
--   later version after changes asked  => recheck_ready
--   otherwise                          => needs_review
create or replace function private.asset_versions_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status     text;
  v_submitted  timestamptz;
  v_new_status text;
  v_run_id     uuid;
begin
  select a.status, a.submitted_at into v_status, v_submitted
  from public.assets a where a.id = new.asset_id;

  if v_submitted is null then
    v_new_status := 'preflighting';
  elsif new.version_no > 1 and (
       v_status in ('changes_requested', 'recheck_ready')
       or exists (select 1 from public.change_requests cr
                  where cr.asset_id = new.asset_id and cr.status = 'open')
     ) then
    v_new_status := 'recheck_ready';
  else
    v_new_status := 'needs_review';
  end if;

  perform set_config('app.inserting_version', 'on', true);
  update public.assets a
     set latest_version_id = new.id,
         status = v_new_status
   where a.id = new.asset_id;
  perform set_config('app.inserting_version', 'off', true);

  insert into public.analysis_runs (profile_id, asset_version_id, status)
  values (new.profile_id, new.id, 'queued')
  returning id into v_run_id;

  perform private.log_event(new.profile_id, new.asset_id, 'version.created',
    jsonb_build_object(
      'asset_version_id', new.id,
      'version_no', new.version_no,
      'origin', new.origin,
      'author_id', new.author_id,
      'source_item_id', new.source_item_id,
      'content_sha256', new.content_sha256,
      'analysis_run_id', v_run_id,
      'previous_status', v_status,
      'status', v_new_status));
  return null;
end;
$$;

drop trigger if exists asset_versions_before_insert on public.asset_versions;
create trigger asset_versions_before_insert
  before insert on public.asset_versions
  for each row execute function private.asset_versions_before_insert();

drop trigger if exists asset_versions_after_insert on public.asset_versions;
create trigger asset_versions_after_insert
  after insert on public.asset_versions
  for each row execute function private.asset_versions_after_insert();

revoke all on function private.connections_before_insert()     from public, anon, authenticated, service_role;
revoke all on function private.guard_asset_pointers()          from public, anon, authenticated, service_role;
revoke all on function private.assets_audit()                  from public, anon, authenticated, service_role;
revoke all on function private.source_items_before_write()     from public, anon, authenticated, service_role;
revoke all on function private.visible_source_item(uuid)       from public, anon, authenticated, service_role;
revoke all on function private.asset_versions_before_insert()  from public, anon, authenticated, service_role;
revoke all on function private.asset_versions_after_insert()   from public, anon, authenticated, service_role;
