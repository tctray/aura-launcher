-- AURA messages: deleting your own messages, blocking people, and reporting
-- Run this after aura-messages.sql, aura-messages-media.sql and aura-messages-background.sql.
-- Safe to run more than once.

-- ── 1. Deleting a message ────────────────────────────────────────────────────
-- A deleted message keeps its row (so the other person's AURA is told, and the order of the
-- conversation doesn't shift) but its words and its file are gone.
alter table public.messages add column if not exists deleted_at timestamptz;

-- A message needs words or a file, unless it has been deleted
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.messages'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%btrim(content%'
  loop
    execute format('alter table public.messages drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.messages add constraint messages_content_or_media check (
  char_length(content) <= 4000
  and (btrim(content, E' \t\n\r') <> '' or media_path is not null or deleted_at is not null)
);

-- A new message can never arrive already marked as deleted
create or replace function public.messages_safety_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.deleted_at := null;
  return new;
end $$;
revoke all on function public.messages_safety_before_insert() from public, anon, authenticated;
drop trigger if exists messages_safety_before_insert on public.messages;
create trigger messages_safety_before_insert before insert on public.messages
  for each row execute function public.messages_safety_before_insert();

-- ── 2. Blocking ──────────────────────────────────────────────────────────────
create table if not exists public.blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocked on public.blocks (blocked_id);
alter table public.blocks enable row level security;
-- You can see who you have blocked. Nobody can see who has blocked them.
revoke all on public.blocks from anon, authenticated;
grant select on public.blocks to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'blocks' and policyname = 'See own blocks') then
    create policy "See own blocks" on public.blocks for select to authenticated
      using (blocker_id = (select auth.uid()));
  end if;
end $$;

-- Two people can't become friends (or send each other a request) while either has blocked the other.
-- Messaging needs friendship, so this is what stops messages too.
create or replace function public.friendships_block_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.blocks b where b.blocker_id = auth.uid()
             and b.blocked_id in (new.requester_id, new.addressee_id)) then
    raise exception 'You''ve blocked this person. Unblock them to add them again.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.blocks b
             where (b.blocker_id = new.requester_id and b.blocked_id = new.addressee_id)
                or (b.blocker_id = new.addressee_id and b.blocked_id = new.requester_id)) then
    raise exception 'You can''t add this person.' using errcode = 'P0001'; -- doesn't say why
  end if;
  return new;
end $$;
revoke all on function public.friendships_block_check() from public, anon, authenticated;
drop trigger if exists friendships_block_check on public.friendships;
create trigger friendships_block_check before insert or update on public.friendships
  for each row execute function public.friendships_block_check();

-- Block someone: they are removed from your friends (and any request between you is dropped)
create or replace function public.block_user(target uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'You''re not logged in.'; end if;
  if target is null or target = me then raise exception 'You can''t block yourself.'; end if;
  if not exists (select 1 from public.profiles p where p.id = target) then raise exception 'No AURA user found.'; end if;
  if (select count(*) from public.blocks where blocker_id = me) >= 1000 then raise exception 'Your blocked list is full.'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (me, target) on conflict do nothing;
  delete from public.friendships
    where least(requester_id, addressee_id) = least(me, target) and greatest(requester_id, addressee_id) = greatest(me, target);
  return true;
end $$;

create or replace function public.unblock_user(target uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'You''re not logged in.'; end if;
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = target;
  return true;
end $$;

-- The people you have blocked, with their names
create or replace function public.list_blocked()
returns table (user_id uuid, username text, avatar_url text, blocked_at timestamptz)
language sql stable set search_path = '' as $$
  select b.blocked_id, p.username, p.avatar_url, b.created_at
  from public.blocks b
  left join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = (select auth.uid())
  order by b.created_at desc;
$$;

-- ── 3. Reporting ─────────────────────────────────────────────────────────────
-- Reports are for whoever runs AURA to read here in Supabase (Table Editor > reports).
-- Nobody using the app can read this table, not even their own reports.
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'open',            -- change to 'handled' when you have dealt with it
  notes text,                                     -- your own notes
  reason text not null check (reason in ('spam', 'harassment', 'inappropriate', 'other')),
  details text check (details is null or char_length(details) <= 1000),
  reporter_id uuid references auth.users(id) on delete set null,
  reporter_name text,
  reported_id uuid references auth.users(id) on delete set null,
  reported_name text,
  -- When a particular message was reported, a copy of it as it was at that moment
  conversation_id uuid,
  message_id uuid,
  message_content text,
  message_media_path text,
  message_sent_at timestamptz
);
create index if not exists reports_open on public.reports (created_at desc) where status = 'open';
create index if not exists reports_reporter_time on public.reports (reporter_id, created_at desc);
create index if not exists reports_media on public.reports (message_media_path) where message_media_path is not null;
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;

create or replace function public.report_user(target uuid, why text, more text default null, message uuid default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  m public.messages;
  note text := nullif(btrim(coalesce(more, '')), '');
begin
  if me is null then raise exception 'You''re not logged in.'; end if;
  if target is null or target = me then raise exception 'You can''t report yourself.'; end if;
  if why is null or why not in ('spam', 'harassment', 'inappropriate', 'other') then raise exception 'Pick a reason for the report.'; end if;
  if note is not null and char_length(note) > 1000 then raise exception 'Keep the details under 1,000 characters.'; end if;
  if not exists (select 1 from public.profiles p where p.id = target) then raise exception 'No AURA user found.'; end if;
  if (select count(*) from public.reports r where r.reporter_id = me and r.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'You''ve sent a lot of reports today. Try again tomorrow.';
  end if;
  if message is not null then
    -- Only a message that person sent you, in a conversation you are part of
    select mm.* into m from public.messages mm
      join public.conversations c on c.id = mm.conversation_id
      where mm.id = message and mm.sender_id = target and me in (c.user_a, c.user_b);
    if not found then raise exception 'That message can''t be reported.'; end if;
    if exists (select 1 from public.reports r where r.reporter_id = me and r.message_id = message) then return true; end if; -- already reported
  end if;
  insert into public.reports (reason, details, reporter_id, reporter_name, reported_id, reported_name,
                              conversation_id, message_id, message_content, message_media_path, message_sent_at)
  values (why, note, me, (select p.username from public.profiles p where p.id = me), target, (select p.username from public.profiles p where p.id = target),
          m.conversation_id, m.id, m.content, m.media_path, m.created_at);
  return true;
end $$;

-- ── 4. Delete one of your own messages, for both people ──────────────────────
create or replace function public.delete_message(message uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  m public.messages;
begin
  if me is null then raise exception 'You''re not logged in.'; end if;
  select * into m from public.messages where id = message;
  if not found or m.sender_id <> me then raise exception 'You can only delete your own messages.'; end if;
  if m.deleted_at is not null then return true; end if;
  update public.messages
    set content = '', media_path = null, media_kind = null, media_mime = null, media_size = null,
        media_width = null, media_height = null, media_name = null,
        deleted_at = now(), read_at = coalesce(read_at, now()) -- a deleted message never counts as unread
    where id = message;
  return true;
end $$;

-- The file behind a message can be removed from storage by the person who sent it,
-- unless it has been reported (then it is kept for review).
create or replace function public.aura_media_is_mine(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.messages m where m.media_path = object_name and m.sender_id = (select auth.uid()))
     and not exists (select 1 from public.reports r where r.message_media_path = object_name);
$$;
drop policy if exists "AURA message media: sender can remove" on storage.objects;
create policy "AURA message media: sender can remove" on storage.objects for delete to authenticated
  using (bucket_id = 'message-media' and public.aura_media_is_mine(name));

-- Only logged-in users may call these
revoke all on function public.block_user(uuid), public.unblock_user(uuid), public.list_blocked(), public.report_user(uuid, text, text, uuid),
  public.delete_message(uuid), public.aura_media_is_mine(text) from public, anon;
grant execute on function public.block_user(uuid), public.unblock_user(uuid), public.list_blocked(), public.report_user(uuid, text, text, uuid),
  public.delete_message(uuid), public.aura_media_is_mine(text) to authenticated;
