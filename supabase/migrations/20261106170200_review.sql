-- =============================================================================
-- 20261106170200_review.sql
-- Review: reference library, rules + rule_versions, offers + offer_versions,
-- analysis_runs, findings (immutable AI output), finding_dispositions
-- (append-only), security_alerts, decisions (append-only, written only by
-- record_decision()/withdraw_approval()), change_requests,
-- recheck_verifications (append-only), review_sessions (heartbeats), the
-- finding_latest_dispositions and asset_queue views.
-- RPCs: record_decision(), withdraw_approval(), submit_for_review(),
-- update_asset(), clone_starter_rules(), acknowledge_security_alert().
-- =============================================================================

-- -----------------------------------------------------------------------------
-- reference_library: global, read-only to authenticated (seeded by operator).
-- -----------------------------------------------------------------------------
create table if not exists public.reference_library (
  id              text primary key check (id ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  label           text not null,
  citation        text not null,
  url             text,
  summary         text,
  verified_as_of  date,
  created_at      timestamptz not null default now()
);
alter table public.reference_library enable row level security;

-- -----------------------------------------------------------------------------
-- rules: identity only. profile_id null = starter library (readable by every
-- signed-in user, never analysed directly). Analysis uses only rules whose
-- profile_id is the asset's profile: create_profile() clones every active
-- starter rule into the new profile, and clone_starter_rules() adds starter
-- rules published later. Everything that changes what a rule means (title,
-- scope, severity, body) lives on the immutable rule_versions.
-- current_version_id is maintained by the rule_versions insert trigger.
-- Archive with active = false; never delete (versions are immutable).
-- -----------------------------------------------------------------------------
create table if not exists public.rules (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid references public.profiles (id) on delete cascade,
  code                text not null check (char_length(code) between 1 and 40),
  kind                text not null check (kind in ('regulatory', 'policy', 'offer', 'security')),
  active              boolean not null default true,
  cloned_from         uuid references public.rules (id) on delete set null,
  current_version_id  uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint rules_profile_code_key unique nulls not distinct (profile_id, code)
);
create index if not exists rules_cloned_from_idx on public.rules (cloned_from);
alter table public.rules enable row level security;

drop trigger if exists rules_set_updated_at on public.rules;
create trigger rules_set_updated_at
  before update on public.rules
  for each row execute function private.set_updated_at();

-- rule_versions: IMMUTABLE. profile_id is copied from the rule and
-- version_no assigned by trigger. applies_to: products and/or channels, e.g.
-- {personal_loan,email}. metadata: optional deterministic patterns, trigger
-- terms, cloned_from_version_id, etc.
create table if not exists public.rule_versions (
  id                uuid primary key default gen_random_uuid(),
  rule_id           uuid not null references public.rules (id) on delete cascade,
  profile_id        uuid references public.profiles (id) on delete cascade,
  version_no        integer not null check (version_no >= 1),
  title             text not null check (char_length(title) between 1 and 200),
  applies_to        text[] not null default '{}',
  default_severity  text not null check (default_severity in ('critical', 'major', 'minor')),
  body              text not null check (char_length(body) between 1 and 20000),
  reference_ids     text[] not null default '{}',
  metadata          jsonb not null default '{}'::jsonb,
  reason            text not null check (char_length(btrim(reason)) between 1 and 500),
  author_id         uuid references public.users (id),
  created_at        timestamptz not null default now(),
  constraint rule_versions_rule_version_no_key unique (rule_id, version_no),
  constraint rule_versions_id_rule_key unique (id, rule_id)
);
create index if not exists rule_versions_profile_idx on public.rule_versions (profile_id);
create index if not exists rule_versions_author_idx on public.rule_versions (author_id);
alter table public.rule_versions enable row level security;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rules_current_version_fk') then
    alter table public.rules
      add constraint rules_current_version_fk foreign key (current_version_id, id)
      references public.rule_versions (id, rule_id);
  end if;
end;
$$;
create index if not exists rules_current_version_idx on public.rules (current_version_id, id);

-- rules guard: profile_id never changes; current_version_id only moves via
-- the rule_versions trigger; cloned_from must point at a starter rule or a
-- rule in the same profile.
create or replace function private.rules_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src_profile uuid;
begin
  if tg_op = 'UPDATE' then
    if new.profile_id is distinct from old.profile_id then
      raise exception 'A rule cannot move between profiles' using errcode = '42501';
    end if;
    if new.current_version_id is distinct from old.current_version_id
       and coalesce(current_setting('app.rule_versioning', true), '') <> 'on' then
      raise exception 'current_version_id is maintained by the rule_versions trigger' using errcode = '42501';
    end if;
  elsif new.current_version_id is not null then
    raise exception 'New rules start without a version; insert into rule_versions' using errcode = '42501';
  end if;

  if new.cloned_from is not null and (tg_op = 'INSERT' or new.cloned_from is distinct from old.cloned_from) then
    select r.profile_id into v_src_profile from public.rules r where r.id = new.cloned_from;
    if not found or (v_src_profile is not null and v_src_profile is distinct from new.profile_id) then
      raise exception 'cloned_from must be a starter-library rule or a rule in the same profile'
        using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists rules_guard on public.rules;
create trigger rules_guard
  before insert or update on public.rules
  for each row execute function private.rules_guard();

create or replace function private.rule_versions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_next       integer;
begin
  select r.profile_id into v_profile_id from public.rules r where r.id = new.rule_id for update;
  if not found then
    raise exception 'Rule not found' using errcode = '23503';
  end if;
  new.profile_id := v_profile_id;
  select coalesce(max(v.version_no), 0) + 1 into v_next
  from public.rule_versions v where v.rule_id = new.rule_id;
  if new.version_no is null then
    new.version_no := v_next;
  elsif new.version_no <> v_next then
    raise exception 'Next version_no for this rule is %, got %', v_next, new.version_no using errcode = 'PT409';
  end if;
  return new;
end;
$$;

create or replace function private.rule_versions_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.rule_versioning', 'on', true);
  update public.rules r set current_version_id = new.id where r.id = new.rule_id;
  perform set_config('app.rule_versioning', 'off', true);
  return null;
end;
$$;

drop trigger if exists rule_versions_before_insert on public.rule_versions;
create trigger rule_versions_before_insert
  before insert on public.rule_versions
  for each row execute function private.rule_versions_before_insert();

drop trigger if exists rule_versions_after_insert on public.rule_versions;
create trigger rule_versions_after_insert
  after insert on public.rule_versions
  for each row execute function private.rule_versions_after_insert();

-- Clone active starter rules (all, or the given ids) that the profile does
-- not have yet (by cloned_from or by code). Returns the number cloned.
create or replace function private.clone_starter_rules(p_profile_id uuid, p_rule_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       record;
  v_new   uuid;
  v_count integer := 0;
begin
  for r in
    select s.id, s.code, s.kind, v.id as version_id, v.title, v.applies_to, v.default_severity,
           v.body, v.reference_ids, v.metadata
    from public.rules s
    join public.rule_versions v on v.id = s.current_version_id
    where s.profile_id is null
      and s.active
      and (p_rule_ids is null or s.id = any (p_rule_ids))
      and not exists (
        select 1 from public.rules x
        where x.profile_id = p_profile_id and (x.cloned_from = s.id or x.code = s.code))
    order by s.code
  loop
    insert into public.rules (profile_id, code, kind, cloned_from)
    values (p_profile_id, r.code, r.kind, r.id)
    returning id into v_new;
    insert into public.rule_versions (rule_id, title, applies_to, default_severity, body,
                                      reference_ids, metadata, reason)
    values (v_new, r.title, r.applies_to, r.default_severity, r.body, r.reference_ids,
            r.metadata || jsonb_build_object('cloned_from_version_id', r.version_id),
            'Cloned from starter library');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- offers + offer_versions (the catalog behind "actually available terms").
-- -----------------------------------------------------------------------------
create table if not exists public.offers (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  code        text not null check (char_length(code) between 1 and 40),
  product     text not null check (product in ('personal_loan', 'credit_card', 'mortgage', 'other')),
  name        text not null check (char_length(name) between 1 and 200),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint offers_profile_code_key unique (profile_id, code),
  constraint offers_id_profile_key unique (id, profile_id)
);
alter table public.offers enable row level security;

drop trigger if exists offers_set_updated_at on public.offers;
create trigger offers_set_updated_at
  before update on public.offers
  for each row execute function private.set_updated_at();

-- offer_versions: IMMUTABLE. terms e.g. {apr_min, apr_max, intro_apr,
-- intro_months, fees:{...}, term_months:[...], representative_example}.
create table if not exists public.offer_versions (
  id              uuid primary key default gen_random_uuid(),
  offer_id        uuid not null,
  profile_id      uuid not null references public.profiles (id) on delete cascade,
  version_no      integer not null check (version_no >= 1),
  terms           jsonb not null default '{}'::jsonb check (jsonb_typeof(terms) = 'object'),
  effective_from  date not null default current_date,
  effective_to    date,
  reason          text not null check (char_length(btrim(reason)) between 1 and 500),
  author_id       uuid references public.users (id),
  created_at      timestamptz not null default now(),
  constraint offer_versions_offer_version_no_key unique (offer_id, version_no),
  constraint offer_versions_dates check (effective_to is null or effective_to >= effective_from),
  constraint offer_versions_offer_fk foreign key (offer_id, profile_id)
    references public.offers (id, profile_id) on delete cascade
);
create index if not exists offer_versions_profile_idx on public.offer_versions (profile_id, offer_id);
create index if not exists offer_versions_author_idx on public.offer_versions (author_id);
alter table public.offer_versions enable row level security;

create or replace function private.offer_versions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_next       integer;
begin
  select o.profile_id into v_profile_id from public.offers o where o.id = new.offer_id for update;
  if not found then
    raise exception 'Offer not found' using errcode = '23503';
  end if;
  new.profile_id := coalesce(new.profile_id, v_profile_id);
  select coalesce(max(v.version_no), 0) + 1 into v_next
  from public.offer_versions v where v.offer_id = new.offer_id;
  if new.version_no is null then
    new.version_no := v_next;
  elsif new.version_no <> v_next then
    raise exception 'Next version_no for this offer is %, got %', v_next, new.version_no using errcode = 'PT409';
  end if;
  return new;
end;
$$;

drop trigger if exists offer_versions_before_insert on public.offer_versions;
create trigger offer_versions_before_insert
  before insert on public.offer_versions
  for each row execute function private.offer_versions_before_insert();

-- -----------------------------------------------------------------------------
-- analysis_runs: server-written. A 'queued' row is created by the
-- asset_versions insert trigger; the server claims it
--   update analysis_runs set status = 'running' where id = $1 and status = 'queued'
-- stage drives the staged-progress UI (extracting | deterministic |
-- checking_rules | verifying).
-- coverage e.g. {"copy":"checked","images_ocr":"1/1","linked_page":"not_provided"}.
-- rule_results: [{rule_version_id, result: pass|flagged|na|not_checked, finding_ids:[]}]
-- input_metadata: the asset metadata (product, channel, states, audience...)
-- the run used to pick rules.
-- reuse_key: sha256 of (section hash, sorted rule_version_ids, sorted
-- offer_version_ids); same key in the same profile = cached result reusable.
-- rule_version_ids / offer_version_ids must belong to the run's profile
-- (trigger below).
-- -----------------------------------------------------------------------------
create table if not exists public.analysis_runs (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid not null references public.profiles (id) on delete cascade,
  asset_version_id    uuid not null,
  status              text not null default 'queued' check (status in (
                        'queued', 'running', 'complete', 'failed', 'declined_budget')),
  stage               text,
  model               text,
  prompt_hash         text,
  rule_version_ids    uuid[] not null default '{}',
  offer_version_ids   uuid[] not null default '{}',
  rule_results        jsonb not null default '[]'::jsonb check (jsonb_typeof(rule_results) = 'array'),
  input_metadata      jsonb not null default '{}'::jsonb check (jsonb_typeof(input_metadata) = 'object'),
  input_tokens        integer not null default 0 check (input_tokens >= 0),
  output_tokens       integer not null default 0 check (output_tokens >= 0),
  cost_usd            numeric(10, 6) not null default 0 check (cost_usd >= 0),
  coverage            jsonb not null default '{}'::jsonb,
  reuse_key           text check (reuse_key is null or reuse_key ~ '^[0-9a-f]{64}$'),
  reused_from_run_id  uuid,
  error               text,
  created_at          timestamptz not null default now(),
  completed_at        timestamptz,
  constraint analysis_runs_id_profile_key unique (id, profile_id),
  constraint analysis_runs_id_version_key unique (id, asset_version_id),
  constraint analysis_runs_version_fk foreign key (asset_version_id, profile_id)
    references public.asset_versions (id, profile_id) on delete cascade,
  constraint analysis_runs_reused_from_fk foreign key (reused_from_run_id, profile_id)
    references public.analysis_runs (id, profile_id) on delete set null (reused_from_run_id)
);
create index if not exists analysis_runs_version_idx on public.analysis_runs (asset_version_id, profile_id, created_at desc);
create index if not exists analysis_runs_profile_idx on public.analysis_runs (profile_id, created_at desc);
create index if not exists analysis_runs_reused_from_idx on public.analysis_runs (reused_from_run_id, profile_id);
create index if not exists analysis_runs_queued_idx on public.analysis_runs (created_at) where status = 'queued';
create index if not exists analysis_runs_reuse_key_idx on public.analysis_runs (profile_id, reuse_key) where reuse_key is not null;
create index if not exists analysis_runs_rule_versions_gin on public.analysis_runs using gin (rule_version_ids);
create index if not exists analysis_runs_offer_versions_gin on public.analysis_runs using gin (offer_version_ids);
alter table public.analysis_runs enable row level security;

create or replace function private.analysis_runs_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from unnest(new.rule_version_ids) x
    where not exists (select 1 from public.rule_versions rv
                      where rv.id = x and rv.profile_id = new.profile_id)
  ) then
    raise exception 'rule_version_ids must all be rule versions of this profile' using errcode = '23503';
  end if;
  if exists (
    select 1 from unnest(new.offer_version_ids) x
    where not exists (select 1 from public.offer_versions ov
                      where ov.id = x and ov.profile_id = new.profile_id)
  ) then
    raise exception 'offer_version_ids must all be offer versions of this profile' using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists analysis_runs_validate on public.analysis_runs;
create trigger analysis_runs_validate
  before insert or update of rule_version_ids, offer_version_ids on public.analysis_runs
  for each row execute function private.analysis_runs_validate();

-- -----------------------------------------------------------------------------
-- findings: IMMUTABLE. origin 'ai' rows belong to an analysis run; origin
-- 'reviewer' rows are misses a human added (author_id required, run optional).
-- anchor e.g. {"type":"text_range","start":120,"end":148} | {"type":"page","page":2}
-- Recheck (V(n) vs V(n-1)): prior_finding_id links a finding to the matching
-- finding on an earlier version (or an earlier run of the same version);
-- recheck_status = new | still_present | re_anchored; span_hash = sha256 of
-- the normalized quote. "Resolved" = a prior finding with no successor.
-- reused_from_finding_id: copied from a cached run ($0) - shown per finding.
-- -----------------------------------------------------------------------------
create table if not exists public.findings (
  id                      uuid primary key default gen_random_uuid(),
  profile_id              uuid not null references public.profiles (id) on delete cascade,
  analysis_run_id         uuid,
  asset_version_id        uuid not null,
  origin                  text not null default 'ai' check (origin in ('ai', 'reviewer')),
  author_id               uuid references public.users (id),
  rule_version_id         uuid references public.rule_versions (id),
  severity                text not null check (severity in ('critical', 'major', 'minor')),
  evidence_type           text not null check (evidence_type in (
                            'exact_match', 'offer_mismatch', 'missing_disclosure', 'needs_judgment')),
  section_id              text,
  quote                   text,
  span_hash               text check (span_hash is null or span_hash ~ '^[0-9a-f]{64}$'),
  verified_span           boolean not null default false,
  anchor                  jsonb not null default '{}'::jsonb,
  explanation             text,
  suggested_fix           text,
  suggested_copy          text,
  prior_finding_id        uuid,
  recheck_status          text check (recheck_status in ('new', 'still_present', 're_anchored')),
  reused_from_finding_id  uuid,
  created_at              timestamptz not null default now(),
  constraint findings_id_profile_key unique (id, profile_id),
  constraint findings_origin_requirements check (
    (origin = 'ai' and analysis_run_id is not null)
    or (origin = 'reviewer' and author_id is not null)
  ),
  constraint findings_run_fk foreign key (analysis_run_id, asset_version_id)
    references public.analysis_runs (id, asset_version_id) on delete cascade,
  constraint findings_version_fk foreign key (asset_version_id, profile_id)
    references public.asset_versions (id, profile_id) on delete cascade,
  constraint findings_prior_fk foreign key (prior_finding_id, profile_id)
    references public.findings (id, profile_id),
  constraint findings_reused_from_fk foreign key (reused_from_finding_id, profile_id)
    references public.findings (id, profile_id)
);
create index if not exists findings_version_idx on public.findings (asset_version_id, profile_id, severity);
create index if not exists findings_run_idx on public.findings (analysis_run_id, asset_version_id);
create index if not exists findings_rule_version_idx on public.findings (rule_version_id);
create index if not exists findings_author_idx on public.findings (author_id);
create index if not exists findings_profile_idx on public.findings (profile_id);
create index if not exists findings_prior_idx on public.findings (prior_finding_id, profile_id);
create index if not exists findings_reused_from_idx on public.findings (reused_from_finding_id, profile_id);
alter table public.findings enable row level security;

-- A finding may cite only its own profile's rule versions (starter rules are
-- cloned into each profile), and a prior finding must be on the same asset
-- at the same or an earlier version.
create or replace function private.findings_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.rule_version_id is not null and not exists (
    select 1 from public.rule_versions rv
    where rv.id = new.rule_version_id and rv.profile_id = new.profile_id
  ) then
    raise exception 'rule_version_id must be a rule version of this profile' using errcode = '23503';
  end if;
  if new.prior_finding_id is not null and not exists (
    select 1
    from public.findings pf
    join public.asset_versions pv on pv.id = pf.asset_version_id
    join public.asset_versions cv on cv.id = new.asset_version_id
    where pf.id = new.prior_finding_id
      and pv.asset_id = cv.asset_id
      and pv.version_no <= cv.version_no
  ) then
    raise exception 'prior_finding_id must be a finding on the same asset at this or an earlier version'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists findings_before_insert on public.findings;
create trigger findings_before_insert
  before insert on public.findings
  for each row execute function private.findings_before_insert();

-- -----------------------------------------------------------------------------
-- finding_dispositions: APPEND-ONLY; the latest row per finding wins
-- (created_at uses clock_timestamp() so same-transaction rows still order).
-- Members insert their own (actor_id = auth.uid()) under RLS.
--   severity_override: reviewer reclassification; effective severity =
--     coalesce(latest.severity_override, finding.severity).
--   carried_from_disposition_id: set only by the server when it carries a
--     disposition from the prior finding (unchanged span) to its successor.
--     The trigger copies disposition/reason/note/override from the source
--     row and leaves actor_id null, so the UI attributes it to the original
--     actor without forging actor_id.
-- Critical/Major findings (by AI severity): dismissing, or downgrading to
-- minor, needs reason in ('false_positive','not_applicable',
-- 'disclosed_elsewhere') (+ 'severity_overstated' for a downgrade) and a
-- note of at least 40 characters.
-- -----------------------------------------------------------------------------
create table if not exists public.finding_dispositions (
  id                           uuid primary key default gen_random_uuid(),
  profile_id                   uuid not null references public.profiles (id) on delete cascade,
  finding_id                   uuid not null,
  disposition                  text not null check (disposition in ('fix_required', 'dismissed', 'accepted_exception')),
  reason                       text check (reason is null or char_length(reason) <= 200),
  note                         text check (note is null or char_length(note) <= 4000),
  severity_override            text check (severity_override in ('critical', 'major', 'minor')),
  carried_from_disposition_id  uuid,
  actor_id                     uuid default auth.uid() references public.users (id),
  created_at                   timestamptz not null default clock_timestamp(),
  constraint finding_dispositions_id_profile_key unique (id, profile_id),
  constraint finding_dispositions_dismiss_reason check (
    disposition <> 'dismissed' or nullif(btrim(coalesce(reason, '')), '') is not null
  ),
  constraint finding_dispositions_actor check (actor_id is not null or carried_from_disposition_id is not null),
  constraint finding_dispositions_finding_fk foreign key (finding_id, profile_id)
    references public.findings (id, profile_id) on delete cascade,
  constraint finding_dispositions_carried_from_fk foreign key (carried_from_disposition_id, profile_id)
    references public.finding_dispositions (id, profile_id)
);
create index if not exists finding_dispositions_finding_idx on public.finding_dispositions (finding_id, profile_id, created_at desc);
create index if not exists finding_dispositions_latest_idx on public.finding_dispositions (finding_id, created_at desc, id desc);
create index if not exists finding_dispositions_profile_idx on public.finding_dispositions (profile_id);
create index if not exists finding_dispositions_actor_idx on public.finding_dispositions (actor_id);
create index if not exists finding_dispositions_carried_from_idx on public.finding_dispositions (carried_from_disposition_id, profile_id);
alter table public.finding_dispositions enable row level security;

create or replace function private.finding_dispositions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_severity text;
  v_prior    uuid;
  v_src      public.finding_dispositions%rowtype;
begin
  select f.severity, f.prior_finding_id into v_severity, v_prior
  from public.findings f
  where f.id = new.finding_id and f.profile_id = new.profile_id;
  if not found then
    raise exception 'Finding not found' using errcode = '23503';
  end if;

  if new.carried_from_disposition_id is not null then
    select * into v_src
    from public.finding_dispositions d
    where d.id = new.carried_from_disposition_id and d.profile_id = new.profile_id;
    if not found or v_prior is null or v_src.finding_id <> v_prior then
      raise exception 'A carried-forward disposition must come from the prior finding' using errcode = '23503';
    end if;
    new.disposition       := v_src.disposition;
    new.reason            := v_src.reason;
    new.note              := v_src.note;
    new.severity_override := v_src.severity_override;
    new.actor_id          := null;
  end if;

  if new.severity_override is not null and new.severity_override <> v_severity
     and nullif(btrim(coalesce(new.note, '')), '') is null then
    raise exception 'Changing a finding''s severity needs a note' using errcode = 'PT422';
  end if;

  if v_severity in ('critical', 'major') then
    if new.disposition = 'dismissed'
       and coalesce(new.reason, '') not in ('false_positive', 'not_applicable', 'disclosed_elsewhere') then
      raise exception 'Dismissing a Critical/Major finding needs reason false_positive, not_applicable or disclosed_elsewhere'
        using errcode = 'PT422';
    end if;
    if new.disposition <> 'dismissed' and new.severity_override = 'minor'
       and coalesce(new.reason, '') not in ('false_positive', 'not_applicable', 'disclosed_elsewhere', 'severity_overstated') then
      raise exception 'Downgrading a Critical/Major finding needs reason false_positive, not_applicable, disclosed_elsewhere or severity_overstated'
        using errcode = 'PT422';
    end if;
    if (new.disposition = 'dismissed' or new.severity_override = 'minor')
       and char_length(btrim(coalesce(new.note, ''))) < 40 then
      raise exception 'Dismissing or downgrading a Critical/Major finding needs a written note of at least 40 characters'
        using errcode = 'PT422';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists finding_dispositions_before_insert on public.finding_dispositions;
create trigger finding_dispositions_before_insert
  before insert on public.finding_dispositions
  for each row execute function private.finding_dispositions_before_insert();

-- Latest disposition per finding (RLS of the caller applies).
create or replace view public.finding_latest_dispositions
with (security_invoker = true)
as
select distinct on (d.finding_id)
  d.finding_id,
  d.id as disposition_id,
  d.profile_id,
  d.disposition,
  d.reason,
  d.note,
  d.actor_id,
  d.created_at,
  d.severity_override,
  d.carried_from_disposition_id
from public.finding_dispositions d
order by d.finding_id, d.created_at desc, d.id desc;

-- -----------------------------------------------------------------------------
-- security_alerts: server-inserted; members may only acknowledge (via
-- acknowledge_security_alert()). An alert is on an asset version, or on a
-- source item found at intake (filename, subject, sender, Sheet cell) before
-- any asset exists; on Accept the server copies open source-item alerts onto
-- v1 so the record_decision acknowledgement gate applies. Source-item alerts
-- follow the source item's visibility.
-- -----------------------------------------------------------------------------
create table if not exists public.security_alerts (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  asset_version_id  uuid,
  source_item_id    uuid,
  kind              text not null check (kind in ('hidden_text', 'possible_injection')),
  excerpt           text,
  location          jsonb not null default '{}'::jsonb,
  acknowledged_by   uuid references public.users (id) on delete set null,
  acknowledged_at   timestamptz,
  created_at        timestamptz not null default now(),
  constraint security_alerts_target check (asset_version_id is not null or source_item_id is not null),
  constraint security_alerts_version_fk foreign key (asset_version_id, profile_id)
    references public.asset_versions (id, profile_id) on delete cascade,
  constraint security_alerts_source_item_fk foreign key (source_item_id, profile_id)
    references public.source_items (id, profile_id) on delete cascade
);
create index if not exists security_alerts_profile_idx on public.security_alerts (profile_id, created_at desc);
create index if not exists security_alerts_version_idx on public.security_alerts (asset_version_id, profile_id);
create index if not exists security_alerts_source_item_idx on public.security_alerts (source_item_id, profile_id);
create index if not exists security_alerts_open_idx on public.security_alerts (profile_id) where acknowledged_at is null;
create index if not exists security_alerts_acknowledged_by_idx on public.security_alerts (acknowledged_by);
alter table public.security_alerts enable row level security;

-- -----------------------------------------------------------------------------
-- decisions: APPEND-ONLY. No INSERT grant for any API role (not even the
-- secret-key server); rows are written only by record_decision() and
-- withdraw_approval().
--   exceptions:     [{finding_id, severity, reason, text}] (text >= 40 chars)
--   dismissed:      Critical/Major findings that were dismissed or downgraded
--                   at decision time [{finding_id, severity,
--                   effective_severity, disposition, reason, note, actor_id,
--                   carried_from_disposition_id}]
--   manual_only:    approved although no analysis run completed (allowed only
--                   from needs_manual_review, rationale >= 40 chars)
--   asset_snapshot: the assets row (metadata, status, pointers) just before
--                   the decision
--   approver_email: snapshot of the decider's email
-- 'withdrawn' rows come from withdraw_approval() and point at the version
-- whose approval was withdrawn.
-- -----------------------------------------------------------------------------
create table if not exists public.decisions (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  asset_id          uuid not null,
  asset_version_id  uuid not null,
  content_sha256    text not null,
  decision          text not null check (decision in (
                      'approved', 'approved_with_exceptions', 'changes_requested', 'rejected', 'withdrawn')),
  approver_id       uuid not null references public.users (id),
  approver_email    text,
  exceptions        jsonb not null default '[]'::jsonb check (jsonb_typeof(exceptions) = 'array'),
  dismissed         jsonb not null default '[]'::jsonb check (jsonb_typeof(dismissed) = 'array'),
  rationale         text,
  self_approved     boolean not null default false,
  attested          boolean not null default false,
  manual_only       boolean not null default false,
  auth_method       text,
  analysis_run_id   uuid,
  asset_snapshot    jsonb not null default '{}'::jsonb check (jsonb_typeof(asset_snapshot) = 'object'),
  created_at        timestamptz not null default clock_timestamp(),
  constraint decisions_id_asset_key unique (id, asset_id),
  constraint decisions_exceptions_match check (
    (decision = 'approved_with_exceptions') = (jsonb_array_length(exceptions) > 0)
  ),
  constraint decisions_manual_only check (not manual_only or decision in ('approved', 'approved_with_exceptions')),
  constraint decisions_asset_fk foreign key (asset_id, profile_id)
    references public.assets (id, profile_id) on delete cascade,
  constraint decisions_version_fk foreign key (asset_version_id, asset_id)
    references public.asset_versions (id, asset_id) on delete cascade,
  constraint decisions_run_fk foreign key (analysis_run_id, asset_version_id)
    references public.analysis_runs (id, asset_version_id)
);
create index if not exists decisions_asset_idx on public.decisions (asset_id, profile_id, created_at desc);
create index if not exists decisions_version_idx on public.decisions (asset_version_id, asset_id);
create index if not exists decisions_profile_idx on public.decisions (profile_id, created_at desc);
create index if not exists decisions_approver_idx on public.decisions (approver_id);
create index if not exists decisions_run_idx on public.decisions (analysis_run_id, asset_version_id);
alter table public.decisions enable row level security;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'assets_approved_decision_fk') then
    alter table public.assets
      add constraint assets_approved_decision_fk foreign key (approved_decision_id, id)
      references public.decisions (id, asset_id);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- change_requests: written by record_decision(..., 'changes_requested',
-- p_change_request => ...) in the same transaction as the decision; earlier
-- open requests on the asset are resolved first. items:
-- [{finding_id?, quote?, rule?, required_fix, suggested_copy?, reason?}]
-- message_text: the exact text the reviewer copied out to the submitter (the
-- app sends no email).
-- -----------------------------------------------------------------------------
create table if not exists public.change_requests (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  asset_id          uuid not null,
  asset_version_id  uuid not null,
  decision_id       uuid references public.decisions (id),
  author_id         uuid references public.users (id) on delete set null,
  items             jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  note              text,
  message_text      text check (message_text is null or char_length(message_text) <= 20000),
  due_date          date,
  status            text not null default 'open' check (status in ('open', 'resolved')),
  created_at        timestamptz not null default now(),
  resolved_at       timestamptz,
  constraint change_requests_id_profile_key unique (id, profile_id),
  constraint change_requests_asset_fk foreign key (asset_id, profile_id)
    references public.assets (id, profile_id) on delete cascade,
  constraint change_requests_version_fk foreign key (asset_version_id, asset_id)
    references public.asset_versions (id, asset_id) on delete cascade
);
create index if not exists change_requests_asset_idx on public.change_requests (asset_id, profile_id, status);
create index if not exists change_requests_version_idx on public.change_requests (asset_version_id, asset_id);
create index if not exists change_requests_decision_idx on public.change_requests (decision_id);
create index if not exists change_requests_author_idx on public.change_requests (author_id);
create index if not exists change_requests_profile_idx on public.change_requests (profile_id, status);
alter table public.change_requests enable row level security;

-- -----------------------------------------------------------------------------
-- recheck_verifications: APPEND-ONLY, member-written. "Mark verified" per
-- change-request item on the Compare screen; the latest row per
-- (change_request_id, finding_id/item_index) wins.
-- -----------------------------------------------------------------------------
create table if not exists public.recheck_verifications (
  id                 uuid primary key default gen_random_uuid(),
  profile_id         uuid not null references public.profiles (id) on delete cascade,
  change_request_id  uuid not null,
  finding_id         uuid,
  item_index         integer check (item_index is null or item_index >= 0),
  asset_version_id   uuid not null,
  status             text not null check (status in ('resolved', 'still_present', 're_anchored', 'outdated')),
  note               text check (note is null or char_length(note) <= 4000),
  verified_by        uuid not null default auth.uid() references public.users (id),
  created_at         timestamptz not null default clock_timestamp(),
  constraint recheck_verifications_target check (finding_id is not null or item_index is not null),
  constraint recheck_verifications_cr_fk foreign key (change_request_id, profile_id)
    references public.change_requests (id, profile_id) on delete cascade,
  constraint recheck_verifications_finding_fk foreign key (finding_id, profile_id)
    references public.findings (id, profile_id) on delete cascade,
  constraint recheck_verifications_version_fk foreign key (asset_version_id, profile_id)
    references public.asset_versions (id, profile_id) on delete cascade
);
create index if not exists recheck_verifications_profile_idx on public.recheck_verifications (profile_id, created_at desc);
create index if not exists recheck_verifications_cr_idx on public.recheck_verifications (change_request_id, profile_id, created_at desc);
create index if not exists recheck_verifications_finding_idx on public.recheck_verifications (finding_id, profile_id);
create index if not exists recheck_verifications_version_idx on public.recheck_verifications (asset_version_id, profile_id);
create index if not exists recheck_verifications_verified_by_idx on public.recheck_verifications (verified_by);
alter table public.recheck_verifications enable row level security;

create or replace function private.recheck_verifications_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cr_asset uuid;
  v_items    jsonb;
begin
  select c.asset_id, c.items into v_cr_asset, v_items
  from public.change_requests c
  where c.id = new.change_request_id and c.profile_id = new.profile_id;
  if not found then
    raise exception 'Change request not found' using errcode = '23503';
  end if;
  if not exists (select 1 from public.asset_versions v
                 where v.id = new.asset_version_id and v.asset_id = v_cr_asset) then
    raise exception 'asset_version_id must be a version of the change request''s asset' using errcode = '23503';
  end if;
  if new.finding_id is not null and not exists (
    select 1 from public.findings f
    join public.asset_versions v on v.id = f.asset_version_id
    where f.id = new.finding_id and v.asset_id = v_cr_asset
  ) then
    raise exception 'finding_id must be a finding on the change request''s asset' using errcode = '23503';
  end if;
  if new.item_index is not null and new.item_index >= jsonb_array_length(v_items) then
    raise exception 'item_index is out of range for this change request' using errcode = 'PT422';
  end if;
  return new;
end;
$$;

drop trigger if exists recheck_verifications_before_insert on public.recheck_verifications;
create trigger recheck_verifications_before_insert
  before insert on public.recheck_verifications
  for each row execute function private.recheck_verifications_before_insert();

-- -----------------------------------------------------------------------------
-- review_sessions: active-time heartbeats written directly from the browser
-- under RLS (own rows only). surface: workbench | compare | composer |
-- triage (triage sessions point at a source item instead of a version). For
-- authenticated callers the trigger stamps times server-side and caps
-- active_seconds growth to wall-clock time since the previous heartbeat
-- (+5 s slack). Service role (seeding) is not clamped.
-- -----------------------------------------------------------------------------
create table if not exists public.review_sessions (
  id                 uuid primary key default gen_random_uuid(),
  profile_id         uuid not null references public.profiles (id) on delete cascade,
  user_id            uuid not null default auth.uid() references public.users (id) on delete cascade,
  surface            text not null default 'workbench' check (surface in ('workbench', 'compare', 'composer', 'triage')),
  asset_version_id   uuid,
  source_item_id     uuid,
  started_at         timestamptz not null default now(),
  last_heartbeat_at  timestamptz not null default now(),
  active_seconds     integer not null default 0 check (active_seconds >= 0),
  constraint review_sessions_target check (asset_version_id is not null or source_item_id is not null),
  constraint review_sessions_version_fk foreign key (asset_version_id, profile_id)
    references public.asset_versions (id, profile_id) on delete cascade,
  constraint review_sessions_source_item_fk foreign key (source_item_id, profile_id)
    references public.source_items (id, profile_id) on delete cascade
);
create index if not exists review_sessions_version_idx on public.review_sessions (asset_version_id, profile_id);
create index if not exists review_sessions_source_item_idx on public.review_sessions (source_item_id, profile_id);
create index if not exists review_sessions_user_idx on public.review_sessions (user_id, last_heartbeat_at desc);
create index if not exists review_sessions_profile_idx on public.review_sessions (profile_id, started_at desc);
alter table public.review_sessions enable row level security;

create or replace function private.review_sessions_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.started_at := now();
    new.last_heartbeat_at := now();
    new.active_seconds := 0;
  else
    new.active_seconds := greatest(
      old.active_seconds,
      least(new.active_seconds,
            old.active_seconds
              + ceil(extract(epoch from (now() - old.last_heartbeat_at)))::integer
              + 5));
    new.last_heartbeat_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists review_sessions_stamp on public.review_sessions;
create trigger review_sessions_stamp
  before insert or update on public.review_sessions
  for each row execute function private.review_sessions_stamp();

-- -----------------------------------------------------------------------------
-- Shared helper: the sign-in methods from the JWT amr claim.
-- -----------------------------------------------------------------------------
create or replace function private.jwt_auth_method()
returns text
language sql
stable
set search_path = ''
as $$
  select string_agg(x.value ->> 'method', ',')
  from jsonb_array_elements(
         case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end
       ) x;
$$;

-- -----------------------------------------------------------------------------
-- acknowledge_security_alert(id): members only (and, for source-item alerts,
-- only members who can see the item); sets acknowledged_by/at once.
-- -----------------------------------------------------------------------------
create or replace function public.acknowledge_security_alert(p_alert_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := private.require_uid();
  v_alert    public.security_alerts%rowtype;
  v_asset_id uuid;
begin
  select * into v_alert from public.security_alerts s where s.id = p_alert_id for update;
  if not found
     or not private.is_member(v_alert.profile_id)
     or (v_alert.source_item_id is not null and not private.visible_source_item(v_alert.source_item_id)) then
    raise exception 'Security alert not found' using errcode = 'PT404';
  end if;
  if v_alert.acknowledged_at is not null then
    return;
  end if;
  update public.security_alerts
     set acknowledged_by = v_uid, acknowledged_at = now()
   where id = v_alert.id;
  if v_alert.asset_version_id is not null then
    select v.asset_id into v_asset_id from public.asset_versions v where v.id = v_alert.asset_version_id;
  else
    select s.asset_id into v_asset_id from public.source_items s where s.id = v_alert.source_item_id;
  end if;
  perform private.log_event(v_alert.profile_id, v_asset_id, 'security_alert.acknowledged',
    jsonb_build_object('alert_id', v_alert.id, 'kind', v_alert.kind,
                       'asset_version_id', v_alert.asset_version_id,
                       'source_item_id', v_alert.source_item_id));
end;
$$;

-- -----------------------------------------------------------------------------
-- record_decision(version, decision, exceptions, rationale, attested,
--                 change_request) -> decision id.
-- The ONLY way to write decisions (besides withdraw_approval) or approval
-- state.
--
-- Locks the asset, the version and the version's findings FOR UPDATE. Those
-- row locks conflict with the KEY SHARE locks that FK checks take, so a
-- security alert, analysis run or finding inserted on this version, or a
-- disposition inserted on one of its findings, waits for the decision (and
-- vice versa): no check-then-act race.
--
-- Checks, in order:
--   1. caller is a member of the version's profile (else PT404)
--   2. the asset was submitted (drafts cannot be decided)
--   3. the version is the asset's latest version
--   4. every security alert on the version is acknowledged
--   approve variants only:
--   5. attested = true; no analysis run queued/running; at least one run
--      finished (complete/failed/declined_budget). If none completed, the
--      asset must be in needs_manual_review and the rationale >= 40 chars
--      (recorded as manual_only, "Not AI-screened").
--   6. considered findings = findings of EVERY complete run on the version
--      + reviewer findings (re-running analysis cannot make findings
--      disappear); effective severity = latest severity_override or AI
--      severity
--      - any finding whose latest disposition is fix_required BLOCKS
--      - every effective critical/major finding needs a disposition
--      - effective critical/major accepted_exception findings => decision
--        must be approved_with_exceptions, with exactly one exceptions entry
--        each {finding_id, reason, text} where length(trim(text)) >= 40
--      - critical/major findings dismissed or downgraded are snapshotted in
--        decisions.dismissed and the event
--   7. self_approved = caller authored the version; self-approval WITH
--      exceptions is blocked when the profile has > 1 member or a member was
--      removed after the version was created; any self-approval needs a
--      rationale >= 20 chars
--   rejected needs a rationale. changes_requested needs p_change_request
--   {items: [...non-empty], note?, due_date?, message_text?}.
-- Effects: insert decision; assets.status = decision; approve variants set
-- approved_version_id/approved_decision_id; rejecting or requesting changes
-- on the currently approved version clears them (approval.revoked);
-- approve/reject resolve open change requests; changes_requested resolves
-- earlier open ones and inserts the new change request; events.
-- -----------------------------------------------------------------------------
drop function if exists public.record_decision(uuid, text, jsonb, text, boolean);
create or replace function public.record_decision(
  p_asset_version_id uuid,
  p_decision         text,
  p_exceptions       jsonb   default '[]'::jsonb,
  p_rationale        text    default null,
  p_attested         boolean default false,
  p_change_request   jsonb   default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_uuid constant   text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_uid             uuid := private.require_uid();
  v_profile_id      uuid;
  v_asset_id        uuid;
  v_version         public.asset_versions%rowtype;
  v_asset           public.assets%rowtype;
  v_is_approval     boolean;
  v_rationale       text := nullif(btrim(coalesce(p_rationale, '')), '');
  v_exceptions      jsonb := coalesce(p_exceptions, '[]'::jsonb);
  v_run_id          uuid;
  v_runs_pending    integer;
  v_runs_complete   integer;
  v_runs_finished   integer;
  v_manual_only     boolean := false;
  v_self            boolean;
  v_member_count    integer;
  v_removed_since   boolean := false;
  v_count           integer;
  v_fix_required    integer;
  v_undispositioned integer;
  v_exception_ids   uuid[];
  v_dismissed       jsonb := '[]'::jsonb;
  v_entry           jsonb;
  v_entry_ids       uuid[] := '{}';
  v_normalized      jsonb := '[]'::jsonb;
  v_finding_id      uuid;
  v_text            text;
  v_reason          text;
  v_severity        text;
  v_items           jsonb;
  v_note            text;
  v_message         text;
  v_due_date        date;
  v_revokes         boolean := false;
  v_decision_id     uuid;
  v_cr_id           uuid;
begin
  if p_decision is null or p_decision not in ('approved', 'approved_with_exceptions', 'changes_requested', 'rejected') then
    raise exception 'Unknown decision: %', coalesce(p_decision, 'null') using errcode = 'PT422';
  end if;
  v_is_approval := p_decision in ('approved', 'approved_with_exceptions');

  select v.profile_id, v.asset_id into v_profile_id, v_asset_id
  from public.asset_versions v where v.id = p_asset_version_id;
  if v_profile_id is null or not private.is_member(v_profile_id) then
    raise exception 'Asset version not found' using errcode = 'PT404';
  end if;

  select * into v_asset from public.assets a where a.id = v_asset_id for update;
  select * into v_version from public.asset_versions v where v.id = p_asset_version_id for update;
  perform 1 from public.findings f where f.asset_version_id = v_version.id for update;

  if v_asset.submitted_at is null then
    raise exception 'This asset is a draft; submit it for review before deciding' using errcode = 'PT409';
  end if;
  if v_asset.latest_version_id is distinct from v_version.id then
    raise exception 'V% is not the latest version of this asset; decide on the latest version', v_version.version_no
      using errcode = 'PT409';
  end if;

  select count(*) into v_count
  from public.security_alerts s
  where s.asset_version_id = v_version.id and s.acknowledged_at is null;
  if v_count > 0 then
    raise exception '% security alert(s) on this version must be acknowledged before deciding', v_count
      using errcode = 'PT409';
  end if;

  if jsonb_typeof(v_exceptions) <> 'array' then
    raise exception 'exceptions must be a JSON array' using errcode = 'PT422';
  end if;
  if p_change_request is not null and p_decision <> 'changes_requested' then
    raise exception 'p_change_request applies only to changes_requested' using errcode = 'PT422';
  end if;

  select count(*) filter (where r.status in ('queued', 'running')),
         count(*) filter (where r.status = 'complete'),
         count(*) filter (where r.status in ('complete', 'failed', 'declined_budget'))
    into v_runs_pending, v_runs_complete, v_runs_finished
  from public.analysis_runs r
  where r.asset_version_id = v_version.id;

  select r.id into v_run_id
  from public.analysis_runs r
  where r.asset_version_id = v_version.id and r.status = 'complete'
  order by r.completed_at desc nulls last, r.created_at desc
  limit 1;

  v_self := v_version.author_id is not null and v_version.author_id = v_uid;
  select count(*) into v_member_count from public.profile_members m where m.profile_id = v_profile_id;

  if v_is_approval then
    if not coalesce(p_attested, false) then
      raise exception 'Approval requires the attestation to be confirmed' using errcode = 'PT422';
    end if;
    if v_runs_pending > 0 then
      raise exception 'Analysis is still running for this version; wait for it to finish' using errcode = 'PT409';
    end if;
    if v_runs_finished = 0 then
      raise exception 'This version has not been analysed yet' using errcode = 'PT409';
    end if;
    if v_runs_complete = 0 then
      if v_asset.status <> 'needs_manual_review' then
        raise exception 'The AI pre-check did not complete for this version; approve it from Needs manual review'
          using errcode = 'PT409';
      end if;
      if v_rationale is null or char_length(v_rationale) < 40 then
        raise exception 'Approving without an AI pre-check needs a rationale of at least 40 characters'
          using errcode = 'PT422';
      end if;
      v_manual_only := true;
    end if;

    with considered as (
      select f.id,
             f.severity as original_severity,
             coalesce(ld.severity_override, f.severity) as severity,
             ld.disposition, ld.reason, ld.note, ld.actor_id, ld.carried_from_disposition_id
      from public.findings f
      left join lateral (
        select d.disposition, d.reason, d.note, d.actor_id, d.severity_override, d.carried_from_disposition_id
        from public.finding_dispositions d
        where d.finding_id = f.id
        order by d.created_at desc, d.id desc
        limit 1
      ) ld on true
      where f.asset_version_id = v_version.id
        and (f.origin = 'reviewer'
             or f.analysis_run_id in (select r.id from public.analysis_runs r
                                      where r.asset_version_id = v_version.id and r.status = 'complete'))
    )
    select count(*) filter (where c.disposition = 'fix_required'),
           count(*) filter (where c.disposition is null and c.severity in ('critical', 'major')),
           coalesce(array_agg(c.id) filter (where c.disposition = 'accepted_exception'
                                              and c.severity in ('critical', 'major')), '{}'),
           coalesce(jsonb_agg(jsonb_build_object(
                      'finding_id', c.id,
                      'severity', c.original_severity,
                      'effective_severity', c.severity,
                      'disposition', c.disposition,
                      'reason', c.reason,
                      'note', c.note,
                      'actor_id', c.actor_id,
                      'carried_from_disposition_id', c.carried_from_disposition_id))
                    filter (where (c.original_severity in ('critical', 'major')
                                   and (c.disposition = 'dismissed' or c.severity = 'minor'))
                               or (c.severity in ('critical', 'major') and c.disposition = 'dismissed')),
                    '[]'::jsonb)
      into v_fix_required, v_undispositioned, v_exception_ids, v_dismissed
      from considered c;

    if v_fix_required > 0 then
      raise exception '% finding(s) are marked Fix required; re-disposition them before approving', v_fix_required
        using errcode = 'PT409';
    end if;
    if v_undispositioned > 0 then
      raise exception '% Critical/Major finding(s) have no disposition yet', v_undispositioned
        using errcode = 'PT409';
    end if;
    if cardinality(v_exception_ids) > 0 and p_decision = 'approved' then
      raise exception 'Critical/Major findings were accepted as exceptions; record this as approved_with_exceptions'
        using errcode = 'PT422';
    end if;
    if cardinality(v_exception_ids) = 0 and p_decision = 'approved_with_exceptions' then
      raise exception 'No Critical/Major findings are accepted as exceptions; record this as approved'
        using errcode = 'PT422';
    end if;

    for v_entry in select e.value from jsonb_array_elements(v_exceptions) e loop
      if jsonb_typeof(v_entry) <> 'object' then
        raise exception 'Each exception must be an object {finding_id, reason, text}' using errcode = 'PT422';
      end if;
      if coalesce(v_entry ->> 'finding_id', '') !~ c_uuid then
        raise exception 'Exception entries need a valid finding_id' using errcode = 'PT422';
      end if;
      v_finding_id := (v_entry ->> 'finding_id')::uuid;
      v_text := btrim(coalesce(v_entry ->> 'text', ''));
      v_reason := nullif(btrim(coalesce(v_entry ->> 'reason', '')), '');
      if not (v_finding_id = any (v_exception_ids)) then
        raise exception 'Exception entries must reference Critical/Major findings accepted as exceptions on this version'
          using errcode = 'PT422';
      end if;
      if v_finding_id = any (v_entry_ids) then
        raise exception 'Duplicate exception entry for finding %', v_finding_id using errcode = 'PT422';
      end if;
      if v_reason is null then
        raise exception 'Each exception needs a reason' using errcode = 'PT422';
      end if;
      if char_length(v_text) < 40 then
        raise exception 'Each exception needs a written justification of at least 40 characters'
          using errcode = 'PT422';
      end if;
      select f.severity into v_severity from public.findings f where f.id = v_finding_id;
      v_entry_ids := v_entry_ids || v_finding_id;
      v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
        'finding_id', v_finding_id, 'severity', v_severity, 'reason', v_reason, 'text', v_text));
    end loop;

    if cardinality(v_entry_ids) <> cardinality(v_exception_ids) then
      raise exception 'Every Critical/Major finding accepted as an exception needs a justification entry'
        using errcode = 'PT422';
    end if;

    if v_self then
      if p_decision = 'approved_with_exceptions' then
        v_removed_since := exists (
          select 1 from public.events e
          where e.profile_id = v_profile_id
            and e.kind = 'member.removed'
            and e.created_at > v_version.created_at);
        if v_member_count > 1 or v_removed_since then
          raise exception 'You authored this version; another member must approve it with exceptions'
            using errcode = '42501';
        end if;
      end if;
      if v_rationale is null or char_length(v_rationale) < 20 then
        raise exception 'Self-approval needs a rationale of at least 20 characters' using errcode = 'PT422';
      end if;
    end if;
  else
    if jsonb_array_length(v_exceptions) > 0 then
      raise exception 'Exceptions apply only to approvals' using errcode = 'PT422';
    end if;
    if p_decision = 'rejected' and v_rationale is null then
      raise exception 'A rejection needs a rationale' using errcode = 'PT422';
    end if;
    if p_decision = 'changes_requested' then
      if p_change_request is null or jsonb_typeof(p_change_request) <> 'object' then
        raise exception 'Requesting changes needs p_change_request {items, note?, due_date?, message_text?}'
          using errcode = 'PT422';
      end if;
      v_items := p_change_request -> 'items';
      if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
        raise exception 'A change request needs at least one item' using errcode = 'PT422';
      end if;
      for v_entry in select e.value from jsonb_array_elements(v_items) e loop
        if jsonb_typeof(v_entry) <> 'object' then
          raise exception 'Each change request item must be an object' using errcode = 'PT422';
        end if;
        if nullif(btrim(coalesce(v_entry ->> 'required_fix', '')), '') is null then
          raise exception 'Each change request item needs required_fix' using errcode = 'PT422';
        end if;
        if coalesce(v_entry -> 'finding_id', 'null'::jsonb) <> 'null'::jsonb then
          if coalesce(v_entry ->> 'finding_id', '') !~ c_uuid
             or not exists (select 1 from public.findings f
                            where f.id = (v_entry ->> 'finding_id')::uuid
                              and f.asset_version_id = v_version.id) then
            raise exception 'Change request items can only reference findings on this version'
              using errcode = 'PT422';
          end if;
        end if;
      end loop;
      v_note := nullif(btrim(coalesce(p_change_request ->> 'note', '')), '');
      v_message := nullif(btrim(coalesce(p_change_request ->> 'message_text', '')), '');
      if nullif(btrim(coalesce(p_change_request ->> 'due_date', '')), '') is not null then
        if (p_change_request ->> 'due_date') !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'due_date must be YYYY-MM-DD' using errcode = 'PT422';
        end if;
        v_due_date := (p_change_request ->> 'due_date')::date;
      end if;
    end if;
  end if;

  v_revokes := not v_is_approval and coalesce(v_asset.approved_version_id = v_version.id, false);

  insert into public.decisions (
    profile_id, asset_id, asset_version_id, content_sha256, decision, approver_id, approver_email,
    exceptions, dismissed, rationale, self_approved, attested, manual_only, auth_method,
    analysis_run_id, asset_snapshot)
  values (
    v_profile_id, v_asset_id, v_version.id, v_version.content_sha256, p_decision, v_uid,
    (select u.email from public.users u where u.id = v_uid),
    v_normalized, v_dismissed, v_rationale, v_self, coalesce(p_attested, false), v_manual_only,
    private.jwt_auth_method(), v_run_id, to_jsonb(v_asset))
  returning id into v_decision_id;

  perform set_config('app.recording_decision', 'on', true);
  update public.assets a
     set status = p_decision,
         approved_version_id = case when v_is_approval then v_version.id
                                    when v_revokes then null
                                    else a.approved_version_id end,
         approved_decision_id = case when v_is_approval then v_decision_id
                                     when v_revokes then null
                                     else a.approved_decision_id end
   where a.id = v_asset_id;
  perform set_config('app.recording_decision', 'off', true);

  update public.change_requests cr
     set status = 'resolved', resolved_at = now()
   where cr.asset_id = v_asset_id and cr.status = 'open';

  if p_decision = 'changes_requested' then
    insert into public.change_requests (
      profile_id, asset_id, asset_version_id, decision_id, author_id, items, note, message_text, due_date)
    values (v_profile_id, v_asset_id, v_version.id, v_decision_id, v_uid, v_items, v_note, v_message, v_due_date)
    returning id into v_cr_id;
    perform private.log_event(v_profile_id, v_asset_id, 'change_request.created',
      jsonb_build_object('change_request_id', v_cr_id, 'decision_id', v_decision_id,
                         'asset_version_id', v_version.id, 'item_count', jsonb_array_length(v_items),
                         'due_date', v_due_date));
  end if;

  perform private.log_event(v_profile_id, v_asset_id, 'decision.recorded',
    jsonb_build_object(
      'decision_id', v_decision_id,
      'decision', p_decision,
      'asset_version_id', v_version.id,
      'version_no', v_version.version_no,
      'content_sha256', v_version.content_sha256,
      'self_approved', v_self,
      'exception_count', jsonb_array_length(v_normalized),
      'dismissed', v_dismissed,
      'manual_only', v_manual_only,
      'no_ai_screening', v_manual_only,
      'member_count', v_member_count,
      'analysis_run_id', v_run_id,
      'change_request_id', v_cr_id,
      'previous_status', v_asset.status));

  if v_revokes then
    perform private.log_event(v_profile_id, v_asset_id, 'approval.revoked',
      jsonb_build_object('asset_version_id', v_version.id, 'decision_id', v_decision_id,
                         'revoked_decision_id', v_asset.approved_decision_id, 'decision', p_decision));
  end if;

  return v_decision_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- withdraw_approval(asset, rationale) -> decision id. Members only;
-- rationale >= 20 chars. Records a 'withdrawn' decision against the approved
-- version, sets status 'withdrawn' and clears the approval pointers.
-- -----------------------------------------------------------------------------
create or replace function public.withdraw_approval(p_asset_id uuid, p_rationale text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := private.require_uid();
  v_asset       public.assets%rowtype;
  v_version     public.asset_versions%rowtype;
  v_rationale   text := nullif(btrim(coalesce(p_rationale, '')), '');
  v_decision_id uuid;
begin
  select * into v_asset from public.assets a where a.id = p_asset_id for update;
  if not found or not private.is_member(v_asset.profile_id) then
    raise exception 'Asset not found' using errcode = 'PT404';
  end if;
  if v_asset.approved_version_id is null then
    raise exception 'Nothing is approved on this asset' using errcode = 'PT409';
  end if;
  if v_rationale is null or char_length(v_rationale) < 20 then
    raise exception 'Withdrawing an approval needs a rationale of at least 20 characters' using errcode = 'PT422';
  end if;
  select * into v_version from public.asset_versions v where v.id = v_asset.approved_version_id;

  insert into public.decisions (
    profile_id, asset_id, asset_version_id, content_sha256, decision, approver_id, approver_email,
    rationale, self_approved, attested, auth_method, asset_snapshot)
  values (
    v_asset.profile_id, v_asset.id, v_version.id, v_version.content_sha256, 'withdrawn', v_uid,
    (select u.email from public.users u where u.id = v_uid),
    v_rationale, coalesce(v_version.author_id = v_uid, false), false, private.jwt_auth_method(),
    to_jsonb(v_asset))
  returning id into v_decision_id;

  perform set_config('app.recording_decision', 'on', true);
  update public.assets a
     set status = 'withdrawn', approved_version_id = null, approved_decision_id = null
   where a.id = v_asset.id;
  perform set_config('app.recording_decision', 'off', true);

  update public.change_requests cr
     set status = 'resolved', resolved_at = now()
   where cr.asset_id = v_asset.id and cr.status = 'open';

  perform private.log_event(v_asset.profile_id, v_asset.id, 'approval.withdrawn',
    jsonb_build_object('decision_id', v_decision_id, 'asset_version_id', v_version.id,
                       'version_no', v_version.version_no,
                       'withdrawn_decision_id', v_asset.approved_decision_id));
  return v_decision_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- submit_for_review(asset): promotes a preflight draft into the reviewer
-- queue. Members only; needs a version. Status becomes needs_manual_review
-- when the latest version's analysis finished without completing
-- (failed/declined_budget), else needs_review. Idempotent once submitted.
-- -----------------------------------------------------------------------------
create or replace function public.submit_for_review(p_asset_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_uid();
  v_asset  public.assets%rowtype;
  v_status text;
begin
  select * into v_asset from public.assets a where a.id = p_asset_id for update;
  if not found or not private.is_member(v_asset.profile_id) then
    raise exception 'Asset not found' using errcode = 'PT404';
  end if;
  if v_asset.submitted_at is not null then
    return v_asset.status;
  end if;
  if v_asset.latest_version_id is null then
    raise exception 'Add content before submitting for review' using errcode = 'PT409';
  end if;

  if not exists (select 1 from public.analysis_runs r
                 where r.asset_version_id = v_asset.latest_version_id
                   and r.status in ('queued', 'running', 'complete'))
     and exists (select 1 from public.analysis_runs r
                 where r.asset_version_id = v_asset.latest_version_id
                   and r.status in ('failed', 'declined_budget')) then
    v_status := 'needs_manual_review';
  else
    v_status := 'needs_review';
  end if;

  perform set_config('app.submitting', 'on', true);
  update public.assets a
     set submitted_at = now(), status = v_status
   where a.id = v_asset.id;
  perform set_config('app.submitting', 'off', true);

  perform private.log_event(v_asset.profile_id, v_asset.id, 'asset.submitted',
    jsonb_build_object('asset_version_id', v_asset.latest_version_id, 'status', v_status, 'by', v_uid));
  return v_status;
end;
$$;

-- -----------------------------------------------------------------------------
-- update_asset(asset, patch): members edit asset metadata. Allowed keys:
-- title, product, channel, states (array), audience, due_date, campaign_id,
-- submitter_name, submitter_email, submitter_org, assignee_id,
-- in_market_from, in_market_to, approval_expires_at, retain_until.
-- The assets_audit trigger logs asset.metadata_updated with the caller as
-- actor.
-- -----------------------------------------------------------------------------
create or replace function public.update_asset(p_asset_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := private.require_uid();
  v_asset   public.assets%rowtype;
  v_bad     text;
  v_allowed constant text[] := array[
    'title', 'product', 'channel', 'states', 'audience', 'due_date', 'campaign_id',
    'submitter_name', 'submitter_email', 'submitter_org', 'assignee_id',
    'in_market_from', 'in_market_to', 'approval_expires_at', 'retain_until'];
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Patch must be a JSON object' using errcode = 'PT422';
  end if;
  select k into v_bad from jsonb_object_keys(p_patch) k where not (k = any (v_allowed)) limit 1;
  if v_bad is not null then
    raise exception 'Field % cannot be edited here', v_bad using errcode = 'PT422';
  end if;
  if p_patch ? 'states' and jsonb_typeof(p_patch -> 'states') <> 'array' then
    raise exception 'states must be an array' using errcode = 'PT422';
  end if;
  select * into v_asset from public.assets a where a.id = p_asset_id for update;
  if not found or not private.is_member(v_asset.profile_id) then
    raise exception 'Asset not found' using errcode = 'PT404';
  end if;

  update public.assets a set
    title               = case when p_patch ? 'title' then p_patch ->> 'title' else a.title end,
    product             = case when p_patch ? 'product' then p_patch ->> 'product' else a.product end,
    channel             = case when p_patch ? 'channel' then p_patch ->> 'channel' else a.channel end,
    states              = case when p_patch ? 'states'
                               then array(select jsonb_array_elements_text(p_patch -> 'states'))
                               else a.states end,
    audience            = case when p_patch ? 'audience' then p_patch ->> 'audience' else a.audience end,
    due_date            = case when p_patch ? 'due_date' then (p_patch ->> 'due_date')::date else a.due_date end,
    campaign_id         = case when p_patch ? 'campaign_id' then (p_patch ->> 'campaign_id')::uuid else a.campaign_id end,
    submitter_name      = case when p_patch ? 'submitter_name' then p_patch ->> 'submitter_name' else a.submitter_name end,
    submitter_email     = case when p_patch ? 'submitter_email' then p_patch ->> 'submitter_email' else a.submitter_email end,
    submitter_org       = case when p_patch ? 'submitter_org' then p_patch ->> 'submitter_org' else a.submitter_org end,
    assignee_id         = case when p_patch ? 'assignee_id' then (p_patch ->> 'assignee_id')::uuid else a.assignee_id end,
    in_market_from      = case when p_patch ? 'in_market_from' then (p_patch ->> 'in_market_from')::date else a.in_market_from end,
    in_market_to        = case when p_patch ? 'in_market_to' then (p_patch ->> 'in_market_to')::date else a.in_market_to end,
    approval_expires_at = case when p_patch ? 'approval_expires_at' then (p_patch ->> 'approval_expires_at')::timestamptz else a.approval_expires_at end,
    retain_until        = case when p_patch ? 'retain_until' then (p_patch ->> 'retain_until')::date else a.retain_until end
  where a.id = v_asset.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- clone_starter_rules(profile, rule_ids = null) -> number cloned. Members
-- only. Adds active starter rules (all, or the given ones) the profile does
-- not have yet.
-- -----------------------------------------------------------------------------
create or replace function public.clone_starter_rules(p_profile_id uuid, p_rule_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_uid();
  v_count integer;
begin
  if not private.is_member(p_profile_id) then
    raise exception 'Profile not found' using errcode = 'PT404';
  end if;
  v_count := private.clone_starter_rules(p_profile_id, p_rule_ids);
  if v_count > 0 then
    perform private.log_event(p_profile_id, null, 'rules.cloned',
      jsonb_build_object('count', v_count, 'rule_ids', to_jsonb(p_rule_ids), 'by', v_uid));
  end if;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- asset_queue: one row per asset for the queue/dashboard (RLS of the caller
-- applies). Open findings = findings on the latest version from complete
-- runs + reviewer findings whose latest disposition is none or fix_required,
-- counted by effective severity.
-- -----------------------------------------------------------------------------
create or replace view public.asset_queue
with (security_invoker = true)
as
select
  a.id as asset_id,
  a.profile_id,
  a.title,
  a.product,
  a.channel,
  a.status,
  a.is_draft,
  a.submitted_at,
  a.assignee_id,
  a.due_date,
  a.campaign_id,
  a.submitter_name,
  a.submitter_org,
  a.created_at,
  a.updated_at,
  a.latest_version_id,
  a.approved_version_id,
  a.approved_decision_id,
  a.changed_after_approval,
  a.re_review_reason,
  lv.version_no as latest_version_no,
  av.version_no as approved_version_no,
  lr.status as analysis_status,
  lr.stage as analysis_stage,
  coalesce(fc.open_critical, 0) as open_critical,
  coalesce(fc.open_major, 0) as open_major,
  coalesce(fc.open_minor, 0) as open_minor,
  fc.top_issue,
  coalesce(sa.open_alerts, 0) as open_alert_count,
  cr.open_change_request_created_at
from public.assets a
left join public.asset_versions lv on lv.id = a.latest_version_id
left join public.asset_versions av on av.id = a.approved_version_id
left join lateral (
  select r.status, r.stage
  from public.analysis_runs r
  where r.asset_version_id = a.latest_version_id
  order by r.created_at desc
  limit 1
) lr on true
left join lateral (
  select count(*) filter (where x.severity = 'critical') as open_critical,
         count(*) filter (where x.severity = 'major') as open_major,
         count(*) filter (where x.severity = 'minor') as open_minor,
         (array_agg(x.explanation order by x.rank, x.created_at))[1] as top_issue
  from (
    select coalesce(ld.severity_override, f.severity) as severity,
           case coalesce(ld.severity_override, f.severity) when 'critical' then 1 when 'major' then 2 else 3 end as rank,
           f.explanation,
           f.created_at
    from public.findings f
    left join lateral (
      select d.disposition, d.severity_override
      from public.finding_dispositions d
      where d.finding_id = f.id
      order by d.created_at desc, d.id desc
      limit 1
    ) ld on true
    where f.asset_version_id = a.latest_version_id
      and (f.origin = 'reviewer'
           or exists (select 1 from public.analysis_runs r2
                      where r2.id = f.analysis_run_id and r2.status = 'complete'))
      and (ld.disposition is null or ld.disposition = 'fix_required')
  ) x
) fc on true
left join lateral (
  select count(*) as open_alerts
  from public.security_alerts s
  where s.asset_version_id = a.latest_version_id and s.acknowledged_at is null
) sa on true
left join lateral (
  select min(c.created_at) as open_change_request_created_at
  from public.change_requests c
  where c.asset_id = a.id and c.status = 'open'
) cr on true;

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
revoke all on function private.rules_guard()                          from public, anon, authenticated, service_role;
revoke all on function private.rule_versions_before_insert()          from public, anon, authenticated, service_role;
revoke all on function private.rule_versions_after_insert()           from public, anon, authenticated, service_role;
revoke all on function private.clone_starter_rules(uuid, uuid[])      from public, anon, authenticated, service_role;
revoke all on function private.offer_versions_before_insert()         from public, anon, authenticated, service_role;
revoke all on function private.analysis_runs_validate()               from public, anon, authenticated, service_role;
revoke all on function private.findings_before_insert()               from public, anon, authenticated, service_role;
revoke all on function private.finding_dispositions_before_insert()   from public, anon, authenticated, service_role;
revoke all on function private.recheck_verifications_before_insert()  from public, anon, authenticated, service_role;
revoke all on function private.review_sessions_stamp()                from public, anon, authenticated, service_role;
revoke all on function private.jwt_auth_method()                      from public, anon, authenticated, service_role;

revoke all on function public.acknowledge_security_alert(uuid)                          from public, anon, authenticated, service_role;
revoke all on function public.record_decision(uuid, text, jsonb, text, boolean, jsonb)   from public, anon, authenticated, service_role;
revoke all on function public.withdraw_approval(uuid, text)                             from public, anon, authenticated, service_role;
revoke all on function public.submit_for_review(uuid)                                   from public, anon, authenticated, service_role;
revoke all on function public.update_asset(uuid, jsonb)                                 from public, anon, authenticated, service_role;
revoke all on function public.clone_starter_rules(uuid, uuid[])                         from public, anon, authenticated, service_role;
grant execute on function public.acknowledge_security_alert(uuid)                       to authenticated;
grant execute on function public.record_decision(uuid, text, jsonb, text, boolean, jsonb) to authenticated;
grant execute on function public.withdraw_approval(uuid, text)                          to authenticated;
grant execute on function public.submit_for_review(uuid)                                to authenticated;
grant execute on function public.update_asset(uuid, jsonb)                              to authenticated;
grant execute on function public.clone_starter_rules(uuid, uuid[])                      to authenticated;
