-- =============================================================================
-- Life after approval: live, expiry, archive (additive)
--
-- Nothing about status changes. "Live" and "Archived" are derived:
--   live     = status approved/approved_with_exceptions, live_at set,
--              expires_at null or in the future, archived_at null
--   archived = archived_at set (whatever the status)
-- so record_decision(), withdraw_approval(), the asset_queue view, the
-- "Rates changed" re-review (which matches approved statuses) and every
-- existing tab keep working unchanged. When expires_at passes, the server
-- moves the ad to re_review_due with re_review_reason {kind: 'expired', …};
-- the live fields stay for the record.
--
-- The server writes these columns after proving membership under RLS and
-- records one events row per change (asset.marked_live, asset.expiry_set,
-- asset.archived, asset.unarchived, asset.expired).
-- =============================================================================

alter table public.assets
  add column if not exists live_at        timestamptz,
  add column if not exists live_channel   text,
  add column if not exists live_url       text,
  add column if not exists expires_at     timestamptz,
  add column if not exists archived_at    timestamptz,
  add column if not exists archive_reason text;

alter table public.assets drop constraint if exists assets_live_fields_len;
alter table public.assets add constraint assets_live_fields_len check (
  (live_channel is null or char_length(live_channel) between 1 and 60)
  and (live_url is null or char_length(live_url) <= 2000)
  and (archive_reason is null or char_length(archive_reason) <= 2000));

-- Expiry sweep: approved ads whose end date passed (cron + list load).
create index if not exists assets_expires_idx
  on public.assets (expires_at)
  where expires_at is not null and archived_at is null;
create index if not exists assets_archived_idx
  on public.assets (profile_id, archived_at desc)
  where archived_at is not null;
