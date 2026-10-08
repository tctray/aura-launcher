-- AURA profile pictures
-- Lets a picture chosen from your PC (Edit Profile > Browse) be saved to your account, so friends
-- see it in Messages, the Friends panel and calls instead of your first letter.
-- Safe to run more than once.
--
-- Pictures go in a storage bucket called "avatars", one folder per account. The bucket is public:
-- a picture has a fixed web address, the same way a web-link profile picture always did. Only you
-- can add, replace or remove the pictures in your own folder.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Your own folder is  avatars/<your account id>/
drop policy if exists "AURA avatars: add your own" on storage.objects;
create policy "AURA avatars: add your own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "AURA avatars: see your own" on storage.objects;
create policy "AURA avatars: see your own" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "AURA avatars: remove your own" on storage.objects;
create policy "AURA avatars: remove your own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
