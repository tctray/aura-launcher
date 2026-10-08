-- AURA messages: likes and dislikes
-- Run this after aura-messages.sql (and the other aura-messages files). Safe to run more than once.
--
-- Each person in a conversation can put one 👍 or 👎 on a message, change it, or take it back.
-- Both people see it. Nobody outside the conversation can see it or add one.

-- (Normally added by the pictures update or the safety update. Here too, so this file works on its own.)
alter table public.messages add column if not exists deleted_at timestamptz;

-- ── 1. The table ─────────────────────────────────────────────────────────────
create table if not exists public.message_reactions (
  id bigint generated always as identity primary key,
  message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text check (reaction in ('like', 'dislike')),   -- empty once it has been taken back
  updated_at timestamptz not null default now(),
  unique (message_id, user_id)                             -- one per person per message
);
create index if not exists message_reactions_conversation on public.message_reactions (conversation_id);
create index if not exists message_reactions_user_time on public.message_reactions (user_id, updated_at desc);

-- ── 2. Who may see what ──────────────────────────────────────────────────────
-- The two people in a conversation can see its likes and dislikes. Nobody writes to this table
-- directly: every change goes through react_to_message() below, which checks who is asking.
alter table public.message_reactions enable row level security;
revoke all on public.message_reactions from anon, authenticated;
grant select on public.message_reactions to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_reactions' and policyname = 'See reactions in own conversations') then
    create policy "See reactions in own conversations" on public.message_reactions for select to authenticated
      using (exists (
        select 1 from public.conversations c
        where c.id = conversation_id and (select auth.uid()) in (c.user_a, c.user_b)));
  end if;
end $$;

-- ── 3. Like, dislike, or take it back ────────────────────────────────────────
-- feeling: 'like', 'dislike', or nothing to take yours back. Always acts as the person signed in.
create or replace function public.react_to_message(message uuid, feeling text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  m record;
begin
  if me is null then raise exception 'You''re not logged in.'; end if;
  if feeling is not null and feeling not in ('like', 'dislike') then raise exception 'That isn''t a reaction AURA knows.'; end if;
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

-- ── 4. Deleting a message clears what was put on it ──────────────────────────
create or replace function public.messages_clear_reactions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update public.message_reactions set reaction = null, updated_at = now()
      where message_id = new.id and reaction is not null;
  end if;
  return null;
end $$;
revoke all on function public.messages_clear_reactions() from public, anon, authenticated;
drop trigger if exists messages_clear_reactions on public.messages;
create trigger messages_clear_reactions after update of deleted_at on public.messages
  for each row execute function public.messages_clear_reactions();

-- ── 5. Live updates, so a like shows up for the other person straight away ───
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions') then
      alter publication supabase_realtime add table public.message_reactions;
    end if;
  end if;
end $$;
