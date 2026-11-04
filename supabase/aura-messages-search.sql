-- AURA: message search and friend streaks. (Added by aura-messages-search-setup.cjs)
-- Two read-only functions. Both run with YOUR permissions (security invoker), so the same rules as
-- always decide what they can see: only chats you're in, only your own calls. Nothing new is stored
-- and no existing rules or data are changed.
-- Run once in Supabase > SQL Editor. Safe to run again.

-- ── 1. Search your messages ──────────────────────────────────────────────────
-- Words anywhere in a message's text, in chats you're in (or one of them), newest first, up to 50.
-- Deleted messages are never found.
create or replace function public.search_my_messages(q text, conversation uuid default null, before timestamptz default null)
returns table (id uuid, conversation_id uuid, sender_id uuid, content text, created_at timestamptz)
language plpgsql stable security invoker set search_path = '' as $$
declare
  words text := btrim(coalesce(q, ''));
  pattern text;
begin
  if auth.uid() is null then raise exception 'You''re not logged in.'; end if;
  if char_length(words) < 2 then return; end if;
  if char_length(words) > 100 then raise exception 'That search is too long.'; end if;
  -- % and _ are searched for as themselves
  pattern := '%' || replace(replace(replace(words, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select m.id, m.conversation_id, m.sender_id, left(m.content, 400), m.created_at
    from public.messages m
    where m.deleted_at is null
      and m.content ilike pattern escape '\'
      and (conversation is null or m.conversation_id = conversation)
      and (before is null or m.created_at < before)
    order by m.created_at desc, m.id desc
    limit 50;
end $$;
revoke all on function public.search_my_messages(text, uuid, timestamptz) from public, anon;
grant execute on function public.search_my_messages(text, uuid, timestamptz) to authenticated;

-- Makes searching fast once there are many messages (skipped if the extension isn't available)
do $$
begin
  begin
    create extension if not exists pg_trgm with schema extensions;
  exception when others then null;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    execute (select format('create index if not exists messages_content_search on public.messages using gin (content %I.gin_trgm_ops)', n.nspname)
             from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm');
  end if;
end $$;

-- ── 2. Friend streaks ────────────────────────────────────────────────────────
-- For each friend: how many days in a row you've BOTH messaged each other (a call you both were in
-- counts too), up to today or yesterday, in your time zone. today = whether today already counts.
-- Worked out from messages and calls you can already see; only you get your own streaks.
create or replace function public.friend_streaks(tz text default 'UTC')
returns table (user_id uuid, days integer, today boolean)
language plpgsql stable security invoker set search_path = '' as $$
declare
  me uuid := auth.uid();
  zone text := 'UTC';
  now_day date;
begin
  if me is null then raise exception 'You''re not logged in.'; end if;
  if tz is not null and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = tz) then zone := tz; end if;
  now_day := (now() at time zone zone)::date;
  return query
  with pairs as (
    select c.id as cid, case when c.user_a = me then c.user_b else c.user_a end as other
    from public.conversations c
    where c.user_a is not null and c.user_b is not null and me in (c.user_a, c.user_b) -- one-to-one chats (groups have no pair)
  ), friends as (
    select p.cid, p.other from pairs p where p.other is not null and public.is_friend(p.other)
  ), acts as (
    select f.other, (m.created_at at time zone zone)::date as d, (m.sender_id = me) as mine
    from friends f join public.messages m on m.conversation_id = f.cid
    where m.created_at > now() - interval '400 days'
    union all
    select f.other, (v.answered_at at time zone zone)::date, w.mine
    from friends f
    join public.voice_calls v on v.answered_at is not null and v.answered_at > now() - interval '400 days'
      and ((v.caller_id = me and v.callee_id = f.other) or (v.caller_id = f.other and v.callee_id = me))
    cross join (values (true), (false)) as w(mine)
  ), both_days as (
    select a.other, a.d from acts a group by a.other, a.d having bool_or(a.mine) and bool_or(not a.mine)
  ), runs as (
    select b.other, b.d, b.d - (row_number() over (partition by b.other order by b.d))::integer as grp from both_days b
  ), streaks as (
    select r.other, max(r.d) as last_day, count(*)::integer as n from runs r group by r.other, r.grp
  )
  select s.other, s.n, s.last_day = now_day
  from streaks s
  where s.last_day >= now_day - 1;
end $$;
revoke all on function public.friend_streaks(text) from public, anon;
grant execute on function public.friend_streaks(text) to authenticated;
