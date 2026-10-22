-- AURA group chats: a conversation with up to 10 people
--
-- Run this in Supabase (SQL Editor > New query > paste > Run) AFTER the other messages files
-- (aura-messages.sql, -media, -background, -safety, -reactions). It is safe to run more than once.
--
-- How it works: a group is a conversation like any other, with a list of members instead of two
-- people. Its messages, pictures, videos, GIFs and likes use the same tables as everything else,
-- so deleting, reporting and the picture storage all work the same way. Chats between two people
-- are not changed.
--   - Anyone can make a group with their friends (create_group). The person who made it can add
--     or remove people; anyone can rename it or leave it.
--   - Only members see a group, its members, its messages and its files.
--   - Nobody can be added by someone they've blocked (or who has blocked them).
--
-- Added by aura-messages-groups-setup.cjs.

do $$
begin
  if to_regclass('public.conversations') is null or to_regclass('public.blocks') is null
     or to_regclass('public.message_reactions') is null or to_regclass('public.reports') is null then
    raise exception 'Run the other messages files first (aura-messages.sql, -media, -background, -safety, -reactions), then this one.';
  end if;
end $$;

-- ── 1. A conversation can be a group ─────────────────────────────────────────
alter table public.conversations add column if not exists is_group boolean not null default false;
alter table public.conversations add column if not exists title text;
alter table public.conversations add column if not exists created_by uuid references auth.users(id) on delete set null;
-- A group has no "two people": user_a and user_b are left empty for it
alter table public.conversations alter column user_a drop not null;
alter table public.conversations alter column user_b drop not null;
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.conversations'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%user_a < user_b%'
      and conname <> 'conversations_shape'
  loop
    execute format('alter table public.conversations drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.conversations drop constraint if exists conversations_shape;
alter table public.conversations add constraint conversations_shape check (
  (not is_group and user_a is not null and user_b is not null and user_a < user_b and title is null)
  or (is_group and user_a is null and user_b is null and title is not null and char_length(title) between 1 and 60)
);

-- ── 2. Who is in each group ──────────────────────────────────────────────────
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  added_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user on public.conversation_members (user_id);
alter table public.conversation_members enable row level security;
revoke all on public.conversation_members from anon, authenticated;
grant select on public.conversation_members to authenticated;

-- Is the signed-in person in this group? (Used by the rules below.)
create or replace function public.aura_in_group(conversation uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversation_members m where m.conversation_id = conversation and m.user_id = (select auth.uid()));
$$;
create or replace function public.aura_in_group_folder(folder text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversation_members m where m.conversation_id::text = folder and m.user_id = (select auth.uid()));
$$;
-- Has either of these two blocked the other?
create or replace function public.aura_blocked_either(x uuid, y uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.blocks b where (b.blocker_id = x and b.blocked_id = y) or (b.blocker_id = y and b.blocked_id = x));
$$;
revoke all on function public.aura_blocked_either(uuid, uuid) from public, anon, authenticated;
revoke all on function public.aura_in_group(uuid), public.aura_in_group_folder(text) from public, anon;
grant execute on function public.aura_in_group(uuid), public.aura_in_group_folder(text) to authenticated;

-- ── 3. Who may see and send what (added to the rules for chats of two) ───────
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversations' and policyname = 'See groups you are in') then
    create policy "See groups you are in" on public.conversations for select to authenticated
      using (is_group and public.aura_in_group(id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversation_members' and policyname = 'See members of your groups') then
    create policy "See members of your groups" on public.conversation_members for select to authenticated
      using (public.aura_in_group(conversation_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and policyname = 'Read messages in groups you are in') then
    create policy "Read messages in groups you are in" on public.messages for select to authenticated
      using (public.aura_in_group(conversation_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and policyname = 'Send messages to groups you are in') then
    create policy "Send messages to groups you are in" on public.messages for insert to authenticated
      with check (sender_id = (select auth.uid()) and public.aura_in_group(conversation_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_reactions' and policyname = 'See reactions in groups you are in') then
    create policy "See reactions in groups you are in" on public.message_reactions for select to authenticated
      using (public.aura_in_group(conversation_id));
  end if;
end $$;
-- Pictures and videos: a group's files are in a folder named after the group, like a chat's
drop policy if exists "AURA message media: group members can view" on storage.objects;
create policy "AURA message media: group members can view" on storage.objects for select to authenticated
  using (bucket_id = 'message-media' and public.aura_in_group_folder((storage.foldername(name))[1]));
drop policy if exists "AURA message media: group members can upload" on storage.objects;
create policy "AURA message media: group members can upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'message-media' and public.aura_in_group_folder((storage.foldername(name))[1]));

-- ── 4. Making and changing groups ────────────────────────────────────────────
-- A line in the group saying what happened ("added Cam"). It's sent as the person who did it.
create or replace function public.aura_group_note(conversation uuid, who uuid, what text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.messages (conversation_id, sender_id, content) values (conversation, who, '👥 ' || left(what, 300));
end $$;
revoke all on function public.aura_group_note(uuid, uuid, text) from public, anon, authenticated;
create or replace function public.aura_name(who uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select p.username from public.profiles p where p.id = who), 'someone');
$$;
revoke all on function public.aura_name(uuid) from public, anon, authenticated;
create or replace function public.aura_group_title(raw text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  t text := regexp_replace(btrim(coalesce(raw, '')), '\s+', ' ', 'g');
begin
  if t = '' then raise exception 'Give the group a name.'; end if;
  if char_length(t) > 60 then raise exception 'Keep the group''s name to 60 characters or fewer.'; end if;
  return t;
end $$;

create or replace function public.create_group(title text, people uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  t text;
  others uuid[];
  p uuid;
  cid uuid;
begin
  if me is null then raise exception 'You''re not logged in.'; end if;
  t := public.aura_group_title(title);
  others := array(select distinct x from unnest(coalesce(people, '{}'::uuid[])) as x where x is not null and x <> me);
  if coalesce(array_length(others, 1), 0) = 0 then raise exception 'Pick at least one friend for the group.'; end if;
  if array_length(others, 1) > 9 then raise exception 'Groups can have up to 10 people.'; end if;
  foreach p in array others loop
    if not public.is_friend(p) or public.aura_blocked_either(me, p) then raise exception 'You can only add friends to a group.'; end if;
  end loop;
  if (select count(*) from public.conversations c where c.created_by = me and c.is_group and c.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'You''ve made a lot of groups. Try again in a while.';
  end if;
  insert into public.conversations (is_group, title, created_by) values (true, t, me) returning id into cid;
  insert into public.conversation_members (conversation_id, user_id, role, added_by, last_read_at) values (cid, me, 'owner', me, now());
  insert into public.conversation_members (conversation_id, user_id, role, added_by) select cid, x, 'member', me from unnest(others) as x;
  perform public.aura_group_note(cid, me, 'created the group');
  return cid;
end $$;

-- The person who made the group adds friends of theirs
create or replace function public.add_group_members(conversation uuid, people uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  others uuid[];
  p uuid;
begin
  if me is null then raise exception 'You''re not logged in.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(conversation::text, 9));
  if not exists (select 1 from public.conversation_members m where m.conversation_id = conversation and m.user_id = me) then raise exception 'That isn''t one of your groups.'; end if;
  if not exists (select 1 from public.conversation_members m where m.conversation_id = conversation and m.user_id = me and m.role = 'owner') then
    raise exception 'Only the person who made the group can add people.';
  end if;
  others := array(select distinct x from unnest(coalesce(people, '{}'::uuid[])) as x
                  where x is not null and x <> me and not exists (select 1 from public.conversation_members m where m.conversation_id = conversation and m.user_id = x));
  if coalesce(array_length(others, 1), 0) = 0 then return 0; end if;
  if (select count(*) from public.conversation_members m where m.conversation_id = conversation) + array_length(others, 1) > 10 then
    raise exception 'Groups can have up to 10 people.';
  end if;
  foreach p in array others loop
    if not public.is_friend(p) or public.aura_blocked_either(me, p) then raise exception 'You can only add friends to a group.'; end if;
  end loop;
  insert into public.conversation_members (conversation_id, user_id, role, added_by) select conversation, x, 'member', me from unnest(others) as x;
  foreach p in array others loop perform public.aura_group_note(conversation, me, 'added ' || public.aura_name(p)); end loop;
  return array_length(others, 1);
end $$;

-- The person who made the group removes someone
create or replace function public.remove_group_member(conversation uuid, who uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'You''re not logged in.'; end if;
  if not exists (select 1 from public.conversation_members m where m.conversation_id = conversation and m.user_id = me and m.role = 'owner') then
    raise exception 'Only the person who made the group can remove people.';
  end if;
  if who is null or who = me then raise exception 'To leave the group, use Leave group.'; end if;
  if not exists (select 1 from public.conversation_members m where m.conversation_id = conversation and m.user_id = who) then return false; end if;
  perform public.aura_group_note(conversation, me, 'removed ' || public.aura_name(who));
  delete from public.conversation_members m where m.conversation_id = conversation and m.user_id = who;
  return true;
end $$;

-- Anyone can leave. If the person who made it leaves, whoever has been in it longest takes over;
-- when the last person leaves, the group and its messages are gone.
create or replace function public.leave_group(conversation uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  was text;
  heir uuid;
begin
  if me is null then raise exception 'You''re not logged in.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(conversation::text, 9));
  select m.role into was from public.conversation_members m where m.conversation_id = conversation and m.user_id = me;
  if not found then return false; end if;
  if exists (select 1 from public.conversation_members m where m.conversation_id = conversation and m.user_id <> me) then
    perform public.aura_group_note(conversation, me, 'left the group');
  end if;
  delete from public.conversation_members m where m.conversation_id = conversation and m.user_id = me;
  if not exists (select 1 from public.conversation_members m where m.conversation_id = conversation) then
    delete from public.conversations c where c.id = conversation and c.is_group;
  elsif was = 'owner' then
    select m.user_id into heir from public.conversation_members m where m.conversation_id = conversation order by m.joined_at, m.user_id limit 1;
    update public.conversation_members m set role = 'owner' where m.conversation_id = conversation and m.user_id = heir;
  end if;
  return true;
end $$;

create or replace function public.rename_group(conversation uuid, title text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  t text;
begin
  if me is null then raise exception 'You''re not logged in.'; end if;
  if not public.aura_in_group(conversation) then raise exception 'That isn''t one of your groups.'; end if;
  t := public.aura_group_title(title);
  if (select c.title from public.conversations c where c.id = conversation) = t then return t; end if;
  update public.conversations c set title = t where c.id = conversation and c.is_group;
  perform public.aura_group_note(conversation, me, 'named the group "' || t || '"');
  return t;
end $$;

-- What you've read in a group (each person has their own place)
create or replace function public.mark_group_read(conversation uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.conversation_members m set last_read_at = now() where m.conversation_id = conversation and m.user_id = (select auth.uid());
  return found;
end $$;

-- Your groups for the Messages list: name, members, newest message and how many you haven't read.
-- Messages from someone you've blocked don't count and aren't previewed.
create or replace function public.list_groups()
returns table (id uuid, title text, owner_id uuid, members jsonb, last_message text, last_sender_id uuid, last_message_at timestamptz,
               unread integer, last_media_kind text, last_media_mime text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.title,
         (select m.user_id from public.conversation_members m where m.conversation_id = c.id and m.role = 'owner' limit 1),
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'user_id', m.user_id, 'username', p.username, 'avatar_url', p.avatar_url, 'role', m.role,
                   'last_seen_at', case when m.user_id = (select auth.uid()) or public.is_friend(m.user_id) then pr.last_seen_at end,
                   'is_friend', public.is_friend(m.user_id)) order by m.joined_at, m.user_id), '[]'::jsonb)
            from public.conversation_members m
            left join public.profiles p on p.id = m.user_id
            left join public.user_presence pr on pr.user_id = m.user_id
            where m.conversation_id = c.id),
         left(lm.content, 160), lm.sender_id, coalesce(lm.created_at, c.created_at),
         (select count(*)::int from public.messages u
            where u.conversation_id = c.id and u.sender_id <> (select auth.uid()) and u.deleted_at is null
              and u.created_at > coalesce(me.last_read_at, me.joined_at)
              and not exists (select 1 from public.blocks b where b.blocker_id = (select auth.uid()) and b.blocked_id = u.sender_id)),
         lm.media_kind, lm.media_mime
  from public.conversation_members me
  join public.conversations c on c.id = me.conversation_id and c.is_group
  left join lateral (
    select mm.content, mm.sender_id, mm.created_at, mm.media_kind, mm.media_mime from public.messages mm
    where mm.conversation_id = c.id
      and not exists (select 1 from public.blocks b where b.blocker_id = (select auth.uid()) and b.blocked_id = mm.sender_id)
    order by mm.created_at desc limit 1) lm on true
  where me.user_id = (select auth.uid())
  order by coalesce(lm.created_at, c.created_at) desc;
$$;

-- ── 5. Likes and reports in a group ──────────────────────────────────────────
-- Like react_to_message, for a group you're in (the people in a group needn't all be friends)
create or replace function public.react_in_group(message uuid, feeling text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  m record;
begin
  if me is null then raise exception 'You''re not logged in.'; end if;
  if feeling is not null and feeling not in ('like', 'dislike') then raise exception 'That isn''t a reaction AURA knows.'; end if;
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

-- Like report_user, for a message in a group you're in
create or replace function public.report_in_group(target uuid, why text, more text default null, message uuid default null)
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
  if (select count(*) from public.reports r where r.reporter_id = me and r.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'You''ve sent a lot of reports today. Try again tomorrow.';
  end if;
  select mm.* into m from public.messages mm
    join public.conversation_members cm on cm.conversation_id = mm.conversation_id and cm.user_id = me
    where mm.id = message and mm.sender_id = target;
  if not found then raise exception 'That message can''t be reported.'; end if;
  if exists (select 1 from public.reports r where r.reporter_id = me and r.message_id = message) then return true; end if;
  insert into public.reports (reason, details, reporter_id, reporter_name, reported_id, reported_name,
                              conversation_id, message_id, message_content, message_media_path, message_sent_at)
  values (why, note, me, public.aura_name(me), target, public.aura_name(target), m.conversation_id, m.id, m.content, m.media_path, m.created_at);
  return true;
end $$;

-- ── 6. Who may use them ──────────────────────────────────────────────────────
revoke all on function public.aura_group_title(text), public.create_group(text, uuid[]), public.add_group_members(uuid, uuid[]),
  public.remove_group_member(uuid, uuid), public.leave_group(uuid), public.rename_group(uuid, text), public.mark_group_read(uuid),
  public.list_groups(), public.react_in_group(uuid, text), public.report_in_group(uuid, text, text, uuid) from public, anon;
grant execute on function public.create_group(text, uuid[]), public.add_group_members(uuid, uuid[]),
  public.remove_group_member(uuid, uuid), public.leave_group(uuid), public.rename_group(uuid, text), public.mark_group_read(uuid),
  public.list_groups(), public.react_in_group(uuid, text), public.report_in_group(uuid, text, text, uuid) to authenticated;

-- ── 7. Live updates: being added to (or removed from) a group shows up straight away ──
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_members') then
      alter publication supabase_realtime add table public.conversation_members;
    end if;
  end if;
end $$;
