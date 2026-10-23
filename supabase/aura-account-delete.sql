-- AURA: deleting your account
--
-- Run this in Supabase (SQL Editor > New query > paste > Run) AFTER the other messages files.
-- It is safe to run more than once.
--
-- Lets someone delete their own AURA account from Edit Profile. Everything saved to the account
-- goes with it: the profile, the library, settings and play sessions saved online, friends,
-- messages they sent, chats of two they were in, calls, likes and blocks. Their pictures and
-- videos are removed from storage by AURA first (Supabase only lets files be removed that way).
-- Reports someone else made about them are kept, without their account, for review.
--
-- Added by aura-account-delete-setup.cjs.

do $$
begin
  if to_regclass('public.messages') is null or to_regclass('public.reports') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'messages' and column_name = 'media_path') then
    raise exception 'Run the other messages files first (aura-messages.sql, aura-messages-media.sql, aura-messages-safety.sql), then this one.';
  end if;
end $$;

-- The files in storage that belong to you: your profile pictures, and the pictures and videos you
-- sent (except any that were reported, which are kept for review). AURA removes these first.
create or replace function public.account_files()
returns table (bucket text, path text)
language sql stable security definer set search_path = '' as $$
  select o.bucket_id::text, o.name::text from storage.objects o
   where o.bucket_id = 'avatars' and (storage.foldername(o.name))[1] = (select auth.uid())::text
  union all
  select 'message-media', m.media_path from public.messages m
   where m.sender_id = (select auth.uid()) and m.media_path is not null
     and not exists (select 1 from public.reports r where r.message_media_path = m.media_path);
$$;

-- Deletes the account of whoever calls it, and everything saved to it. Nobody can delete
-- someone else's account with it.
create or replace function public.delete_my_account()
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  t text;
begin
  if me is null then raise exception 'Log in first.' using errcode = 'P0001'; end if;
  -- What AURA saves online for you (these tables were made in the Supabase dashboard)
  foreach t in array array['user_games', 'user_data', 'user_sessions'] loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'user_id') then
      execute format('delete from public.%I where user_id = $1', t) using me;
    end if;
  end loop;
  delete from public.profiles where id = me;
  -- The account itself. Friends, messages, calls, likes and blocks go with it.
  delete from auth.users where id = me;
  -- Group chats nobody is left in
  if to_regclass('public.conversation_members') is not null then
    execute 'delete from public.conversations c where c.is_group and not exists (select 1 from public.conversation_members m where m.conversation_id = c.id)';
  end if;
  return true;
exception when foreign_key_violation then
  raise exception 'The account couldn''t be deleted because of something saved to it that AURA doesn''t know about (%). Nothing was deleted.', sqlerrm using errcode = 'P0001';
end $$;

revoke all on function public.account_files(), public.delete_my_account() from public, anon;
grant execute on function public.account_files(), public.delete_my_account() to authenticated;
