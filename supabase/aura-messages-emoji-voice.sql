-- AURA: emoji reactions and voice messages. (Added by aura-messages-emoji-voice-setup.cjs)
-- Run this after the other aura-messages files (it needs aura-messages-media.sql and
-- aura-messages-reactions.sql, and aura-messages-groups.sql if you use group chats).
-- Run once in Supabase > SQL Editor. Safe to run again. No existing messages or reactions are changed.
--
--   1. Reactions: as well as 👍 and 👎, a message can get ❤️ 😂 😮 😢 😡 or 🔥. Still one per person
--      per message, and the same people as before can see and add them.
--   2. Voice messages: a short recording (up to 2 minutes) sent like a picture. It goes in the same
--      private storage folder as the chat's pictures, so only the people in that chat can play it,
--      and it is removed when its sender deletes the message or their account.

-- ── 1. Emoji reactions ───────────────────────────────────────────────────────
-- The words AURA saves for each emoji: like 👍, dislike 👎, love ❤️, laugh 😂, wow 😮, sad 😢,
-- angry 😡, fire 🔥.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.message_reactions'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%dislike%'
  loop
    execute format('alter table public.message_reactions drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.message_reactions add constraint message_reactions_kind check (
  reaction is null or reaction in ('like', 'dislike', 'love', 'laugh', 'wow', 'sad', 'angry', 'fire')
);

-- The same as before (aura-messages-reactions.sql), with the new emoji allowed.
create or replace function public.react_to_message(message uuid, feeling text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  m record;
begin
  if me is null then raise exception 'You''re not logged in.'; end if;
  if feeling is not null and feeling not in ('like', 'dislike', 'love', 'laugh', 'wow', 'sad', 'angry', 'fire') then raise exception 'That isn''t a reaction AURA knows.'; end if;
  select msg.id, msg.conversation_id, msg.deleted_at, c.user_a, c.user_b into m
    from public.messages msg
    join public.conversations c on c.id = msg.conversation_id
    where msg.id = message and me in (c.user_a, c.user_b);
  if not found then raise exception 'That message isn''t in one of your conversations.'; end if;
  if feeling is null then
    -- Taking yours back always works, even after you stop being friends
    update public.message_reactions set reaction = null, updated_at = now()
      where message_id = m.id and user_id = me and reaction is not null;
    return null;
  end if;
  if m.deleted_at is not null then raise exception 'That message was deleted.'; end if;
  if not public.is_friend(case when m.user_a = me then m.user_b else m.user_a end) then
    raise exception 'You can only react to messages from friends.';
  end if;
  if (select count(*) from public.message_reactions r where r.user_id = me and r.updated_at > now() - interval '10 seconds') >= 30 then
    raise exception 'You''re doing that too quickly. Wait a few seconds.' using errcode = 'P0001';
  end if;
  insert into public.message_reactions (message_id, conversation_id, user_id, reaction)
    values (m.id, m.conversation_id, me, feeling)
  on conflict (message_id, user_id) do update set reaction = excluded.reaction, updated_at = now();
  return feeling;
end $$;
revoke all on function public.react_to_message(uuid, text) from public, anon;
grant execute on function public.react_to_message(uuid, text) to authenticated;

-- In a group (only if group chats are set up): the same as in aura-messages-groups.sql, with the new emoji allowed.
do $outer$
begin
  if to_regclass('public.conversation_members') is null then return; end if;
  execute $f$
create or replace function public.react_in_group(message uuid, feeling text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  m record;
begin
  if me is null then raise exception 'You''re not logged in.'; end if;
  if feeling is not null and feeling not in ('like', 'dislike', 'love', 'laugh', 'wow', 'sad', 'angry', 'fire') then raise exception 'That isn''t a reaction AURA knows.'; end if;
  select msg.id, msg.conversation_id, msg.deleted_at, msg.sender_id into m
    from public.messages msg
    join public.conversation_members cm on cm.conversation_id = msg.conversation_id and cm.user_id = me
    where msg.id = message;
  if not found then raise exception 'That message isn''t in one of your conversations.'; end if;
  if feeling is null then
    update public.message_reactions set reaction = null, updated_at = now() where message_id = m.id and user_id = me and reaction is not null;
    return null;
  end if;
  if m.deleted_at is not null then raise exception 'That message was deleted.'; end if;
  if public.aura_blocked_either(me, m.sender_id) then raise exception 'You can''t react to that message.'; end if;
  if (select count(*) from public.message_reactions r where r.user_id = me and r.updated_at > now() - interval '10 seconds') >= 30 then
    raise exception 'You''re doing that too quickly. Wait a few seconds.' using errcode = 'P0001';
  end if;
  insert into public.message_reactions (message_id, conversation_id, user_id, reaction) values (m.id, m.conversation_id, me, feeling)
  on conflict (message_id, user_id) do update set reaction = excluded.reaction, updated_at = now();
  return feeling;
end $$;
  $f$;
  execute 'revoke all on function public.react_in_group(uuid, text) from public, anon';
  execute 'grant execute on function public.react_in_group(uuid, text) to authenticated';
end $outer$;

-- ── 2. Voice messages ────────────────────────────────────────────────────────
-- A voice message is a message whose file is a recording ('audio'), with how long it is.
alter table public.messages add column if not exists media_seconds integer;
alter table public.messages drop constraint if exists messages_media_seconds;
alter table public.messages add constraint messages_media_seconds check (media_seconds is null or media_seconds between 1 and 120);

-- What a message's file may be: as before (aura-messages-media.sql), plus a recording of up to 5 MB.
alter table public.messages drop constraint if exists messages_media_shape;
alter table public.messages add constraint messages_media_shape check (
  (media_path is null and media_kind is null and media_mime is null and media_size is null
     and media_width is null and media_height is null and media_name is null)
  or (media_path is not null
     and ((media_kind = 'image' and media_mime in ('image/png', 'image/jpeg', 'image/gif', 'image/webp') and media_size between 1 and 10485760)
       or (media_kind = 'video' and media_mime in ('video/mp4', 'video/webm', 'video/quicktime') and media_size between 1 and 52428800)
       or (media_kind = 'audio' and media_mime = 'audio/webm' and media_size between 1 and 5242880))
     and (media_width is null or media_width between 1 and 20000)
     and (media_height is null or media_height between 1 and 20000)
     and (media_name is null or char_length(media_name) <= 200))
);

-- When a message loses its file (its sender deleted it), its length goes too
create or replace function public.messages_clear_seconds()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.media_path is null or new.media_kind is distinct from 'audio' then new.media_seconds := null; end if;
  return new;
end $$;
revoke all on function public.messages_clear_seconds() from public, anon, authenticated;
drop trigger if exists messages_clear_seconds on public.messages;
create trigger messages_clear_seconds before insert or update on public.messages
  for each row execute function public.messages_clear_seconds();

-- The private bucket also takes recordings (the rules for who can upload and view are unchanged)
update storage.buckets
   set allowed_mime_types = array(select distinct unnest(coalesce(allowed_mime_types, '{}'::text[]) || array['audio/webm']))
 where id = 'message-media';

-- A message may only point at a file in its own conversation (as before, now also .weba recordings)
create or replace function public.messages_media_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.media_path is not null then
    if new.media_path !~ ('^' || new.conversation_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp|mp4|webm|mov|weba)$') then
      raise exception 'That attachment doesn''t belong to this conversation.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'message-media' and o.name = new.media_path) then
      raise exception 'That attachment wasn''t uploaded.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.messages_media_before_insert() from public, anon, authenticated;
