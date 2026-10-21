-- AURA group calls: up to 3 people in one voice call
--
-- Run this in Supabase (SQL Editor > New query > paste > Run) AFTER aura-messages-voice.sql.
-- It is safe to run more than once.
--
-- How it works: a call between three people is three ordinary two-person calls (A-B, A-C, B-C),
-- tied together by the same group_id. Each pair connects PC to PC as before, so every rule in
-- aura-messages-voice.sql still applies to each pair.
--   1. Anyone in a call can add a friend:      add_to_call(the_call, friend)  -> rings the friend
--   2. The friend answers as usual:            answer_call(...)
--   3. The friend's AURA then joins the rest:  join_group(the_call)           -> a call to each other person
-- Nobody else can be pulled into a call, a call never has more than 3 people, and nobody is
-- connected to someone they have blocked (or who has blocked them).
--
-- Added by aura-group-calls-setup.cjs.

-- ── 1. Which group a call belongs to ─────────────────────────────────────────
alter table public.voice_calls add column if not exists group_id uuid;
create index if not exists voice_calls_group on public.voice_calls (group_id) where group_id is not null;

-- The people in a group: everyone in a call of that group that hasn't ended (being rung counts)
create or replace function public.aura_group_people(g uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct p from public.voice_calls v, lateral (values (v.caller_id), (v.callee_id)) as x(p)
  where v.group_id = g and v.status <> 'ended';
$$;
-- Has either of these two blocked the other?
create or replace function public.aura_blocked_between(x uuid, y uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if to_regclass('public.blocks') is null then return false; end if; -- blocking isn't set up
  return exists (select 1 from public.blocks b where (b.blocker_id = x and b.blocked_id = y) or (b.blocker_id = y and b.blocked_id = x));
end $$;
revoke all on function public.aura_group_people(uuid), public.aura_blocked_between(uuid, uuid) from public, anon, authenticated;

-- ── 2. Adding a friend to the call you're in ─────────────────────────────────
create or replace function public.add_to_call(the_call uuid, target uuid)
returns public.voice_calls language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  c public.voice_calls;
  g uuid;
  made public.voice_calls;
begin
  if me is null then raise exception 'You''re not logged in.'; end if;
  if not exists (select 1 from public.voice_calls where id = the_call and me in (caller_id, callee_id) and status = 'active') then
    raise exception 'That call has ended.';
  end if;
  if target is null or target = me then raise exception 'Pick a friend to add.'; end if;
  if not public.is_friend(target) then raise exception 'You can only add friends to a call.'; end if;
  -- The same locks start_call takes, so nobody can be rung twice at once
  perform pg_advisory_xact_lock(hashtextextended(least(me, target)::text, 7));
  perform pg_advisory_xact_lock(hashtextextended(greatest(me, target)::text, 7));
  perform public.aura_calls_tidy(me);
  perform public.aura_calls_tidy(target);

  select * into c from public.voice_calls where id = the_call and me in (caller_id, callee_id) and status = 'active' for update;
  if not found then raise exception 'That call has ended.'; end if;
  g := coalesce(c.group_id, c.id);
  perform pg_advisory_xact_lock(hashtextextended(g::text, 8));
  if c.group_id is null then update public.voice_calls set group_id = g where id = c.id; end if;
  perform public.aura_calls_tidy(p) from public.aura_group_people(g) as p; -- a PC that went quiet doesn't hold a place

  if target in (select public.aura_group_people(g)) then raise exception 'They''re already in this call.'; end if;
  if (select count(*) from public.aura_group_people(g)) >= 3 then raise exception 'This call is full. Calls can have up to 3 people.'; end if;
  if exists (select 1 from public.voice_calls where status <> 'ended' and target in (caller_id, callee_id)) then
    raise exception 'They''re on another call. Try again in a bit.';
  end if;
  if exists (select 1 from public.aura_group_people(g) as p where public.aura_blocked_between(p, target)) then
    raise exception 'They can''t join this call.';
  end if;
  if (select count(*) from public.voice_calls where caller_id = me and created_at > now() - interval '1 minute') >= 6 then
    raise exception 'You''re calling too often. Wait a minute.';
  end if;

  insert into public.voice_calls (caller_id, callee_id, group_id) values (me, target, g) returning * into made;
  return made;
end $$;

-- ── 3. Joining the others, once you've answered ──────────────────────────────
-- Connects you to everyone else in the call (already answered: there is nothing to ring).
-- Only someone who was added and has answered can do this.
create or replace function public.join_group(the_call uuid)
returns setof public.voice_calls language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  c public.voice_calls;
  other uuid;
  made public.voice_calls;
begin
  if me is null then raise exception 'You''re not logged in.'; end if;
  select * into c from public.voice_calls where id = the_call and callee_id = me and status = 'active' and group_id is not null;
  if not found then raise exception 'That call has ended.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(c.group_id::text, 8));
  for other in
    select distinct p from public.voice_calls v, lateral (values (v.caller_id), (v.callee_id)) as x(p)
    where v.group_id = c.group_id and v.status = 'active' and p <> me
  loop
    continue when exists (select 1 from public.voice_calls v where v.group_id = c.group_id and v.status <> 'ended'
                          and least(v.caller_id, v.callee_id) = least(me, other) and greatest(v.caller_id, v.callee_id) = greatest(me, other));
    continue when public.aura_blocked_between(me, other);
    insert into public.voice_calls (caller_id, callee_id, status, answered_at, group_id)
      values (me, other, 'active', now(), c.group_id) returning * into made;
    return next made;
  end loop;
end $$;

-- ── 4. Blocking someone ends any call you have with them ─────────────────────
-- (Friends' calls already end when the friendship does. In a group you can be in a call with a
-- friend's friend, so this covers that too.)
create or replace function public.blocks_end_calls()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Friends: removing the friendship (which blocking does) already ends their calls
  if exists (select 1 from public.friendships f where f.status = 'accepted'
             and least(f.requester_id, f.addressee_id) = least(new.blocker_id, new.blocked_id)
             and greatest(f.requester_id, f.addressee_id) = greatest(new.blocker_id, new.blocked_id)) then
    return new;
  end if;
  update public.voice_calls set status = 'ended', end_reason = case when status = 'active' then 'hangup' else 'cancelled' end, ended_at = now()
    where status <> 'ended'
      and least(caller_id, callee_id) = least(new.blocker_id, new.blocked_id)
      and greatest(caller_id, callee_id) = greatest(new.blocker_id, new.blocked_id);
  delete from public.voice_signals s using public.voice_calls v
    where s.call_id = v.id and v.status = 'ended'
      and least(v.caller_id, v.callee_id) = least(new.blocker_id, new.blocked_id)
      and greatest(v.caller_id, v.callee_id) = greatest(new.blocker_id, new.blocked_id);
  return new;
end $$;
revoke all on function public.blocks_end_calls() from public, anon, authenticated;
do $$
begin
  if to_regclass('public.blocks') is not null then
    drop trigger if exists blocks_end_calls on public.blocks;
    create trigger blocks_end_calls after insert on public.blocks for each row execute function public.blocks_end_calls();
  end if;
end $$;

-- ── 5. Who may use them ──────────────────────────────────────────────────────
revoke all on function public.add_to_call(uuid, uuid), public.join_group(uuid) from public, anon;
grant execute on function public.add_to_call(uuid, uuid), public.join_group(uuid) to authenticated;
