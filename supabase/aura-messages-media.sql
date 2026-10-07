-- AURA messages: pictures, GIFs and videos
-- Run this after aura-messages.sql. Safe to run more than once.

-- ── 1. What a message can carry ──────────────────────────────────────────────
alter table public.messages add column if not exists media_path text;      -- where the file is in storage
alter table public.messages add column if not exists media_kind text;      -- 'image' or 'video'
alter table public.messages add column if not exists media_mime text;
alter table public.messages add column if not exists media_size integer;   -- bytes
alter table public.messages add column if not exists media_width integer;
alter table public.messages add column if not exists media_height integer;
alter table public.messages add column if not exists media_name text;      -- the file's original name
alter table public.messages add column if not exists deleted_at timestamptz; -- set when its sender deletes it (see aura-messages-safety.sql)

-- A message used to need words. Now it needs words, or a file, or both (unless it has been deleted).
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
alter table public.messages drop constraint if exists messages_media_shape;
alter table public.messages add constraint messages_media_shape check (
  (media_path is null and media_kind is null and media_mime is null and media_size is null
     and media_width is null and media_height is null and media_name is null)
  or (media_path is not null
     and ((media_kind = 'image' and media_mime in ('image/png', 'image/jpeg', 'image/gif', 'image/webp') and media_size between 1 and 10485760)
       or (media_kind = 'video' and media_mime in ('video/mp4', 'video/webm', 'video/quicktime') and media_size between 1 and 52428800))
     and (media_width is null or media_width between 1 and 20000)
     and (media_height is null or media_height between 1 and 20000)
     and (media_name is null or char_length(media_name) <= 200))
);
-- One file belongs to one message
create unique index if not exists messages_media_path on public.messages (media_path) where media_path is not null;

-- ── 2. Where the files live: a private storage bucket ────────────────────────
-- Private means there are no public links. AURA asks for a short-lived link each time,
-- and Supabase only gives one to the two people in the conversation.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('message-media', 'message-media', false, 52428800,
        array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Files are stored as  <conversation id>/<random name>.<type>  so the folder says whose they are.
-- Is the person asking one of the two people in that conversation?
create or replace function public.aura_media_can_view(folder text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversations c
    where c.id::text = folder and (select auth.uid()) in (c.user_a, c.user_b));
$$;
-- ...and are the two of them friends right now?
create or replace function public.aura_media_can_send(folder text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversations c
    join public.friendships f
      on f.status = 'accepted'
     and least(f.requester_id, f.addressee_id) = c.user_a
     and greatest(f.requester_id, f.addressee_id) = c.user_b
    where c.id::text = folder and (select auth.uid()) in (c.user_a, c.user_b));
$$;
revoke all on function public.aura_media_can_view(text), public.aura_media_can_send(text) from public, anon;
grant execute on function public.aura_media_can_view(text), public.aura_media_can_send(text) to authenticated;

-- Nobody can change or delete a file once it is sent: there are no rules allowing it.
drop policy if exists "AURA message media: the two people can view" on storage.objects;
create policy "AURA message media: the two people can view" on storage.objects for select to authenticated
  using (bucket_id = 'message-media' and public.aura_media_can_view((storage.foldername(name))[1]));
drop policy if exists "AURA message media: friends can upload" on storage.objects;
create policy "AURA message media: friends can upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'message-media' and public.aura_media_can_send((storage.foldername(name))[1]));

-- ── 3. A message may only point at a file in its own conversation ────────────
create or replace function public.messages_media_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.media_path is not null then
    if new.media_path !~ ('^' || new.conversation_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp|mp4|webm|mov)$') then
      raise exception 'That attachment doesn''t belong to this conversation.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'message-media' and o.name = new.media_path) then
      raise exception 'That attachment wasn''t uploaded.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.messages_media_before_insert() from public, anon, authenticated;
drop trigger if exists messages_media_before_insert on public.messages;
create trigger messages_media_before_insert before insert on public.messages
  for each row execute function public.messages_media_before_insert();

-- ── 4. The conversation list, now also saying what kind of file the last message was ─
-- A new function next to the old one, so AURA versions from before this update keep working.
create or replace function public.list_conversations_v2()
returns table (id uuid, other_id uuid, username text, avatar_url text, last_seen_at timestamptz, is_friend boolean,
               last_message text, last_sender_id uuid, last_message_at timestamptz, unread integer,
               last_media_kind text, last_media_mime text)
language sql stable set search_path = '' as $$
  select c.id, o.other_id, p.username, p.avatar_url, pr.last_seen_at, public.is_friend(o.other_id),
         left(m.content, 160), m.sender_id, coalesce(m.created_at, c.created_at),
         (select count(*)::int from public.messages u
           where u.conversation_id = c.id and u.sender_id <> (select auth.uid()) and u.read_at is null),
         m.media_kind, m.media_mime
  from public.conversations c
  cross join lateral (select case when c.user_a = (select auth.uid()) then c.user_b else c.user_a end as other_id) o
  left join public.profiles p on p.id = o.other_id
  left join public.user_presence pr on pr.user_id = o.other_id
  left join lateral (
    select mm.content, mm.sender_id, mm.created_at, mm.media_kind, mm.media_mime from public.messages mm
    where mm.conversation_id = c.id order by mm.created_at desc limit 1) m on true
  where (select auth.uid()) in (c.user_a, c.user_b)
  order by coalesce(m.created_at, c.created_at) desc;
$$;
revoke all on function public.list_conversations_v2() from public, anon;
grant execute on function public.list_conversations_v2() to authenticated;
