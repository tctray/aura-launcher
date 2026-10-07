-- AURA messages: a background picture for a chat, shared by the two people in it
-- Run this after aura-messages.sql and aura-messages-media.sql. Safe to run more than once.

-- ── 1. One row per conversation that has (or had) a shared background ────────
-- The picture itself is a file in the private message-media bucket, in the conversation's folder.
-- Removing a background empties `path` rather than deleting the row, so the other person's AURA
-- is told about it the same way it is told about a change.
create table if not exists public.conversation_backgrounds (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  path text,
  set_by uuid references auth.users(id) on delete set null,
  set_at timestamptz not null default now()
);
alter table public.conversation_backgrounds enable row level security;

-- Only the two people in the conversation can see it. Nobody writes to the table directly:
-- changes go through the function below, which checks who is asking.
revoke all on public.conversation_backgrounds from anon, authenticated;
grant select on public.conversation_backgrounds to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversation_backgrounds' and policyname = 'See backgrounds of own conversations') then
    create policy "See backgrounds of own conversations" on public.conversation_backgrounds for select to authenticated
      using (exists (
        select 1 from public.conversations c
        where c.id = conversation_id and (select auth.uid()) in (c.user_a, c.user_b)));
  end if;
end $$;

-- ── 2. Set, change or remove a chat's background ─────────────────────────────
-- picture: the file's path in storage (it must already be uploaded), or null to remove.
create or replace function public.set_conversation_background(conversation uuid, picture text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  c public.conversations;
begin
  if me is null then raise exception 'You''re not logged in.'; end if;
  select * into c from public.conversations where id = conversation and me in (user_a, user_b);
  if not found then raise exception 'That isn''t your conversation.'; end if;
  if picture is not null then
    if not public.is_friend(case when c.user_a = me then c.user_b else c.user_a end) then
      raise exception 'You can only set a background for a chat with a friend.';
    end if;
    if picture !~ ('^' || conversation::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$') then
      raise exception 'That picture doesn''t belong to this conversation.';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'message-media' and o.name = picture) then
      raise exception 'That picture wasn''t uploaded.';
    end if;
  end if;
  insert into public.conversation_backgrounds (conversation_id, path, set_by, set_at)
    values (conversation, picture, me, now())
    on conflict (conversation_id) do update set path = excluded.path, set_by = excluded.set_by, set_at = excluded.set_at;
  return true;
end $$;
revoke all on function public.set_conversation_background(uuid, text) from public, anon;
grant execute on function public.set_conversation_background(uuid, text) to authenticated;

-- ── 3. Live updates, so the other person's AURA changes straight away ────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_backgrounds') then
      alter publication supabase_realtime add table public.conversation_backgrounds;
    end if;
  end if;
end $$;
