-- Bucket pubblico per avatar profilo (path: {user_id}/avatar.ext)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile_avatars_public_read" on storage.objects;
create policy "profile_avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'profile-avatars');

drop policy if exists "profile_avatars_insert_own" on storage.objects;
create policy "profile_avatars_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "profile_avatars_update_own" on storage.objects;
create policy "profile_avatars_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and split_part(name, '/', 1) = auth.uid()::text
  )
  with check (
    bucket_id = 'profile-avatars'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "profile_avatars_delete_own" on storage.objects;
create policy "profile_avatars_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and split_part(name, '/', 1) = auth.uid()::text
  );
