-- AURA friends and messages
-- Safe to run more than once.

-- ── 1. Friend requests and friendships ───────────────────────────────────────
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);
-- One row per pair of people, whichever of them asked
create unique index if not exists friendships_pair on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists friendships_requester on public.friendships (requester_id);
create index if not exists friendships_addressee on public.friendships (addressee_id);

-- ── 2. Conversations: exactly one per pair of people ─────────────────────────
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  check (user_a < user_b),
  unique (user_a, user_b)
);
create index if not exists conversations_user_b on public.conversations (user_b);

-- ── 3. Messages ──────────────────────────────────────────────────────────────
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(content) <= 4000 and btrim(content, E' \t\n\r') <> ''),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists messages_conversation_time on public.messages (conversation_id, created_at desc);
create index if not exists messages_unread on public.messages (conversation_id) where read_at is null;
create index if not exists messages_sender_time on public.messages (sender_id, created_at desc);

-- ── 4. Online status (only friends can see it) ───────────────────────────────
create table if not exists public.user_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

-- ── 5. Who may do what ───────────────────────────────────────────────────────
alter table public.friendships enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.user_presence enable row level security;

-- Nothing for people who aren't logged in, and only the minimum for people who are.
-- Everything else (sending a request, accepting, opening a conversation, marking as read)
-- goes through the functions further down, which check who is asking.
revoke all on public.friendships, public.conversations, public.messages, public.user_presence from anon, authenticated;
grant select, delete on public.friendships to authenticated;
grant select on public.conversations to authenticated;
grant select, insert on public.messages to authenticated;
grant select on public.user_presence to authenticated;

-- Is the person asking friends with this user?
create or replace function public.is_friend(other uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = (select auth.uid()) and f.addressee_id = other)
        or (f.addressee_id = (select auth.uid()) and f.requester_id = other))
  );
$$;

do $$
begin
  -- friendships: you see, and can remove, only the ones you're part of
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'friendships' and policyname = 'See own friendships') then
    create policy "See own friendships" on public.friendships for select to authenticated
      using ((select auth.uid()) in (requester_id, addressee_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'friendships' and policyname = 'Remove own friendships') then
    create policy "Remove own friendships" on public.friendships for delete to authenticated
      using ((select auth.uid()) in (requester_id, addressee_id));
  end if;

  -- conversations: only the two people in it
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversations' and policyname = 'See own conversations') then
    create policy "See own conversations" on public.conversations for select to authenticated
      using ((select auth.uid()) in (user_a, user_b));
  end if;

  -- messages: read only inside your own conversations
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and policyname = 'Read messages in own conversations') then
    create policy "Read messages in own conversations" on public.messages for select to authenticated
      using (exists (
        select 1 from public.conversations c
        where c.id = conversation_id and (select auth.uid()) in (c.user_a, c.user_b)));
  end if;
  -- messages: send only as yourself, only into your own conversation, only to a current friend
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and policyname = 'Send messages to friends') then
    create policy "Send messages to friends" on public.messages for insert to authenticated
      with check (
        sender_id = (select auth.uid())
        and exists (
          select 1 from public.conversations c
          where c.id = conversation_id
            and (select auth.uid()) in (c.user_a, c.user_b)
            and public.is_friend(case when c.user_a = (select auth.uid()) then c.user_b else c.user_a end)));
  end if;

  -- online status: your own, and your friends'
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_presence' and policyname = 'See own and friends presence') then
    create policy "See own and friends presence" on public.user_presence for select to authenticated
      using (user_id = (select auth.uid()) or public.is_friend(user_id));
  end if;
end $$;

-- ── 6. Messages can't be back-dated, pre-marked as read, or spammed ──────────
create or replace function public.messages_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.id := gen_random_uuid();
  new.created_at := clock_timestamp(); -- the real time, so two messages never share a timestamp
  new.read_at := null;
  if (select count(*) from public.messages m where m.sender_id = new.sender_id and m.created_at > now() - interval '10 seconds') >= 20 then
    raise exception 'You''re sending messages too quickly. Wait a few seconds.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.messages_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return null;
end $$;

drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert before insert on public.messages
  for each row execute function public.messages_before_insert();
drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert after insert on public.messages
  for each row execute function public.messages_after_insert();

-- ── 7. The actions AURA calls ────────────────────────────────────────────────
-- Send a friend request. If they already sent you one, this accepts it.
create or replace function public.request_friend(target uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  f public.friendships;
begin
  if me is null then raise exception 'You''re not logged in.'; end if;
  if target is null or target = me then raise exception 'You can''t add yourself.'; end if;
  if not exists (select 1 from public.profiles p where p.id = target) then raise exception 'No AURA user found.'; end if;
  select * into f from public.friendships
    where least(requester_id, addressee_id) = least(me, target) and greatest(requester_id, addressee_id) = greatest(me, target);
  if found then
    if f.status = 'accepted' then return 'already_friends'; end if;
    if f.requester_id = me then return 'already_sent'; end if;
    update public.friendships set status = 'accepted', responded_at = now() where id = f.id;
    return 'accepted';
  end if;
  if (select count(*) from public.friendships where requester_id = me and status = 'pending') >= 100 then
    raise exception 'You have too many friend requests waiting.';
  end if;
  insert into public.friendships (requester_id, addressee_id) values (me, target);
  return 'sent';
end $$;

-- Accept a request that was sent to you
create or replace function public.accept_friend(request_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.friendships set status = 'accepted', responded_at = now()
    where id = request_id and addressee_id = auth.uid() and status = 'pending';
  if not found then raise exception 'That friend request isn''t waiting for you any more.'; end if;
  return true;
end $$;

-- Find, or create, the one conversation between you and a friend
create or replace function public.open_conversation(other uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  a uuid; b uuid; cid uuid;
begin
  if me is null then raise exception 'You''re not logged in.'; end if;
  if other is null or other = me then raise exception 'Pick a friend to message.'; end if;
  a := least(me, other); b := greatest(me, other);
  select id into cid from public.conversations where user_a = a and user_b = b;
  if cid is not null then return cid; end if;
  if not public.is_friend(other) then raise exception 'You can only message friends.'; end if;
  insert into public.conversations (user_a, user_b) values (a, b)
    on conflict (user_a, user_b) do nothing returning id into cid;
  if cid is null then select id into cid from public.conversations where user_a = a and user_b = b; end if;
  return cid;
end $$;

-- Mark everything the other person sent in this conversation as read
create or replace function public.mark_conversation_read(conversation uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  n integer;
begin
  if not exists (select 1 from public.conversations c where c.id = conversation and me in (c.user_a, c.user_b)) then
    raise exception 'That isn''t your conversation.';
  end if;
  update public.messages set read_at = now()
    where conversation_id = conversation and sender_id <> me and read_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- "I'm online"
create or replace function public.aura_heartbeat()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.user_presence (user_id, last_seen_at) values (auth.uid(), now())
    on conflict (user_id) do update set last_seen_at = now();
end $$;

-- Your conversations, newest first, with the other person, the last message and your unread count.
-- Runs with your own permissions, so it can only ever return what the rules above let you see.
create or replace function public.list_conversations()
returns table (id uuid, other_id uuid, username text, avatar_url text, last_seen_at timestamptz, is_friend boolean,
               last_message text, last_sender_id uuid, last_message_at timestamptz, unread integer)
language sql stable set search_path = '' as $$
  select c.id, o.other_id, p.username, p.avatar_url, pr.last_seen_at, public.is_friend(o.other_id),
         left(m.content, 160), m.sender_id, coalesce(m.created_at, c.created_at),
         (select count(*)::int from public.messages u
           where u.conversation_id = c.id and u.sender_id <> (select auth.uid()) and u.read_at is null)
  from public.conversations c
  cross join lateral (select case when c.user_a = (select auth.uid()) then c.user_b else c.user_a end as other_id) o
  left join public.profiles p on p.id = o.other_id
  left join public.user_presence pr on pr.user_id = o.other_id
  left join lateral (
    select mm.content, mm.sender_id, mm.created_at from public.messages mm
    where mm.conversation_id = c.id order by mm.created_at desc limit 1) m on true
  where (select auth.uid()) in (c.user_a, c.user_b)
  order by coalesce(m.created_at, c.created_at) desc;
$$;

-- Your friends and friend requests, with each person's name, picture and last-seen time
create or replace function public.list_friends()
returns table (friendship_id uuid, user_id uuid, username text, avatar_url text, state text, since timestamptz, last_seen_at timestamptz)
language sql stable set search_path = '' as $$
  select f.id, o.other_id, p.username, p.avatar_url,
         case when f.status = 'accepted' then 'friend' when f.requester_id = (select auth.uid()) then 'outgoing' else 'incoming' end,
         coalesce(f.responded_at, f.created_at), pr.last_seen_at
  from public.friendships f
  cross join lateral (select case when f.requester_id = (select auth.uid()) then f.addressee_id else f.requester_id end as other_id) o
  left join public.profiles p on p.id = o.other_id
  left join public.user_presence pr on pr.user_id = o.other_id
  where (select auth.uid()) in (f.requester_id, f.addressee_id)
  order by p.username nulls last;
$$;

-- Only logged-in users may call these
revoke all on function public.is_friend(uuid), public.request_friend(uuid), public.accept_friend(uuid), public.open_conversation(uuid),
  public.mark_conversation_read(uuid), public.aura_heartbeat(), public.list_conversations(), public.list_friends() from public, anon;
grant execute on function public.is_friend(uuid), public.request_friend(uuid), public.accept_friend(uuid), public.open_conversation(uuid),
  public.mark_conversation_read(uuid), public.aura_heartbeat(), public.list_conversations(), public.list_friends() to authenticated;
revoke all on function public.messages_before_insert(), public.messages_after_insert() from public, anon, authenticated;

-- ── 8. Live updates ──────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
      alter publication supabase_realtime add table public.messages;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'friendships') then
      alter publication supabase_realtime add table public.friendships;
    end if;
  end if;
end $$;
