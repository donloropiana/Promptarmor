-- =============================================================================
-- 20261106170400_storage.sql
-- Private bucket for submitted creative and connector files.
--   Object paths: profiles/{profile_id}/...   e.g.
--     profiles/{profile_id}/sources/{source_item_id}/{filename}
--     profiles/{profile_id}/versions/{object_uuid}/{filename}   (write-once)
--   Read: members of {profile_id} (signed URLs or the user-context client);
--     objects under sources/{source_item_id}/ only when the caller can see
--     that source item (its visibility rule, via source_items RLS).
--   Write: server only (secret key bypasses RLS). Browser uploads use
--     server-issued signed upload URLs with upsert: false.
--   text/html is accepted because submitted creative can be HTML. It is never
--   served from the app origin or opened directly: render it only in a
--   sandboxed iframe (srcdoc, strict CSP), and hand out signed URLs created
--   with { download: true }.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'private-assets',
  'private-assets',
  false,
  26214400, -- 25 MB
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'text/html',
    'text/plain',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'message/rfc822'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- profile id from 'profiles/{uuid}/...'; null for anything else. IMMUTABLE,
-- plain SQL (not SECURITY DEFINER) so the planner can inline it.
create or replace function private.storage_profile_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when parts[1] = 'profiles'
     and parts[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     and cardinality(parts) >= 3
    then parts[2]::uuid
  end
  from (select string_to_array(p_name, '/') as parts) s;
$$;

-- The uuid in path segment p_index (1-based), or null.
create or replace function private.storage_path_uuid(p_name text, p_index integer)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', p_index) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then split_part(p_name, '/', p_index)::uuid
  end;
$$;

revoke all on function private.storage_profile_id(text)         from public, anon, authenticated, service_role;
revoke all on function private.storage_path_uuid(text, integer) from public, anon, authenticated, service_role;
grant execute on function private.storage_profile_id(text)         to authenticated, service_role;
grant execute on function private.storage_path_uuid(text, integer) to authenticated, service_role;

drop policy if exists private_assets_member_select on storage.objects;
create policy private_assets_member_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'private-assets'
    and private.storage_profile_id(name) in (select private.member_profile_ids())
    and (
      split_part(name, '/', 3) <> 'sources'
      or exists (
        select 1 from public.source_items s
        where s.id = private.storage_path_uuid(name, 4)
          and s.profile_id = private.storage_profile_id(name)
      )
    )
  );
-- No INSERT / UPDATE / DELETE policies for authenticated or anon: writes to
-- this bucket go through the server (secret key) or server-signed upload URLs.
