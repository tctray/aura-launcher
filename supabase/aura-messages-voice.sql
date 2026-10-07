-- AURA voice calls: one-to-one calls between friends
-- Run this after aura-messages.sql (and the other aura-messages files). Safe to run more than once.
--
-- How a call works:
--   1. You call a friend. A row appears in voice_calls with status 'ringing', and their AURA rings.
--   2. They accept: the row becomes 'active'. Only now do the two PCs swap the details they need
--      to connect to each other (voice_signals). Before a call is accepted, nothing about either
--      PC's network is shared.
--   3. The sound itself goes straight between the two PCs. It never passes through this database
--      and nothing is recorded.
--   4. Either of you hangs up: the row becomes 'ended' and the connection details are deleted.

-- ── 1. Calls ─────────────────────────────────────────────────────────────────
create table if not exists public.voice_calls (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid not null references auth.users(id) on delete cascade,
  callee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'ringing' check (status in ('ringing', 'active', 'ended')),
  end_reason text check (end_reason in ('hangup', 'declined', 'cancelled', 'missed', 'failed')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  caller_beat_at timestamptz not null default now(),   -- the last sign of life from each person's PC
  callee_beat_at timestamptz not null default now(),
  check (caller_id <> callee_id)
);
create index if not exists voice_calls_caller on public.voice_calls (caller_id, created_at desc);
create index if not exists voice_calls_callee on public.voice_calls (callee_id, created_at desc);
create index if not exists voice_calls_live on public.voice_calls (status) where status <> 'ended';

-- ── 2. Connection details, passed between the two PCs while a call connects ──
create table if not exists public.voice_signals (
  id bigint generated always as identity primary key,
  call_id uuid not null references public.voice_calls(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('offer', 'answer', 'ice')),
  payload text not null check (char_length(payload) between 1 and 20000),
  created_at timestamptz not null default now()
);
create index if not exists voice_signals_call on public.voice_signals (call_id, id);

-- ── 3. Who may see what ──────────────────────────────────────────────────────
-- You can see your own calls, and the connection details sent to you. Nobody writes to these
-- tables directly: every change goes through the functions below, which check who is asking.
alter table public.voice_calls enable row level security;
alter table public.voice_signals enable row level security;
revoke all on public.voice_calls, public.voice_signals from anon, authenticated;
grant select on public.voice_calls, public.voice_signals to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'voice_calls' and policyname = 'See own calls') then
    create policy "See own calls" on public.voice_calls for select to authenticated
      using ((select auth.uid()) in (caller_id, callee_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'voice_signals' and policyname = 'See connection details sent to you') then
    create policy "See connection details sent to you" on public.voice_signals for select to authenticated
      using (recipient_id = (select auth.uid()));
  end if;
end $$;

-- ── 4. Housekeeping ──────────────────────────────────────────────────────────
-- A call nobody picked up leaves a line in the conversation, so it is seen later
create or replace function public.aura_call_missed(caller uuid, callee uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a uuid := least(caller, callee);
  b uuid := greatest(caller, callee);
  cid uuid;
begin
  -- Only between people who are still friends (someone who has just been blocked leaves no note)
  if not exists (select 1 from public.friendships f where f.status = 'accepted'
                 and least(f.requester_id, f.addressee_id) = a and greatest(f.requester_id, f.addressee_id) = b) then
    return;
  end if;
  select id into cid from public.conversations where user_a = a and user_b = b;
  if cid is null then
    insert into public.conversations (user_a, user_b) values (a, b)
      on conflict (user_a, user_b) do nothing returning id into cid;
    if cid is null then select id into cid from public.conversations where user_a = a and user_b = b; end if;
  end if;
  insert into public.messages (conversation_id, sender_id, content) values (cid, caller, '📞 Missed voice call');
exception when others then
  null; -- the note is a nicety: never let it stop a call from ending
end $$;

-- Ends calls that were left hanging (a PC was switched off mid-call, say), and forgets old ones
create or replace function public.aura_calls_tidy(who uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c record;
begin
  for c in
    select id, caller_id, callee_id, status from public.voice_calls
    where status <> 'ended' and who in (caller_id, callee_id)
      and ((status = 'ringing' and created_at < now() - interval '45 seconds')
        or (status = 'active' and least(caller_beat_at, callee_beat_at) < now() - interval '90 seconds'))
    for update
  loop
    update public.voice_calls
      set status = 'ended', end_reason = case when c.status = 'ringing' then 'missed' else 'failed' end, ended_at = now()
      where id = c.id;
    delete from public.voice_signals where call_id = c.id;
    if c.status = 'ringing' then perform public.aura_call_missed(c.caller_id, c.callee_id); end if;
  end loop;
  -- The record of who called whom is kept for 30 days
  delete from public.voice_calls where status = 'ended' and who in (caller_id, callee_id) and ended_at < now() - interval '30 days';
end $$;
revoke all on function public.aura_call_missed(uuid, uuid), public.aura_calls_tidy(uuid) from public, anon, authenticated;

-- ── 5. The actions AURA calls ────────────────────────────────────────────────
-- Call a friend
create or replace function public.start_call(target uuid)
returns public.voice_calls language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  c public.voice_calls;
begin
  if me is null then raise exception 'You''re not logged in.'; end if;
  if target is null or target = me then raise exception 'Pick a friend to call.'; end if;
  -- Friends only. Blocking someone ends the friendship, so a blocked person can never ring you.
  if not public.is_friend(target) then raise exception 'You can only call friends.'; end if;

  -- One at a time per person, so two calls started in the same instant can't both get through
  perform pg_advisory_xact_lock(hashtextextended(least(me, target)::text, 7));
  perform pg_advisory_xact_lock(hashtextextended(greatest(me, target)::text, 7));
  perform public.aura_calls_tidy(me);
  perform public.aura_calls_tidy(target);

  if exists (select 1 from public.voice_calls where status = 'ringing' and caller_id = target and callee_id = me) then
    raise exception 'They''re calling you right now. Answer that call instead.';
  end if;
  if exists (select 1 from public.voice_calls where status <> 'ended' and me in (caller_id, callee_id)) then
    raise exception 'You''re already in a call.';
  end if;
  if exists (select 1 from public.voice_calls where status <> 'ended' and target in (caller_id, callee_id)) then
    raise exception 'They''re on another call. Try again in a bit.';
  end if;
  -- Calling can't be used to pester someone
  if (select count(*) from public.voice_calls where caller_id = me and created_at > now() - interval '1 minute') >= 6 then
    raise exception 'You''re calling too often. Wait a minute.';
  end if;
  if (select count(*) from public.voice_calls where caller_id = me and callee_id = target and status = 'ended'
        and end_reason in ('declined', 'missed', 'cancelled') and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'You''ve called them several times. Give it a few minutes.';
  end if;

  insert into public.voice_calls (caller_id, callee_id) values (me, target) returning * into c;
  return c;
end $$;

-- Accept a call that is ringing for you
create or replace function public.answer_call(the_call uuid)
returns public.voice_calls language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  c public.voice_calls;
begin
  if me is null then raise exception 'You''re not logged in.'; end if;
  update public.voice_calls set status = 'active', answered_at = now(), caller_beat_at = now(), callee_beat_at = now()
    where id = the_call and callee_id = me and status = 'ringing' and created_at > now() - interval '45 seconds'
      and public.is_friend(caller_id)
    returning * into c;
  if not found then raise exception 'That call has ended.'; end if;
  return c;
end $$;

-- Decline, cancel or hang up. Either person can end a call; it ends for both.
--   why: 'missed' when the caller gives up waiting, 'failed' when the two PCs couldn't connect.
create or replace function public.end_call(the_call uuid, why text default null)
returns public.voice_calls language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  c public.voice_calls;
  reason text;
begin
  if me is null then raise exception 'You''re not logged in.'; end if;
  select * into c from public.voice_calls where id = the_call and me in (caller_id, callee_id) for update;
  if not found then raise exception 'That isn''t your call.'; end if;
  if c.status = 'ended' then return c; end if;
  if c.status = 'ringing' then
    reason := case when me = c.callee_id then 'declined' when why = 'missed' then 'missed' else 'cancelled' end;
  else
    reason := case when why = 'failed' then 'failed' else 'hangup' end;
  end if;
  update public.voice_calls set status = 'ended', end_reason = reason, ended_at = now() where id = the_call returning * into c;
  delete from public.voice_signals where call_id = the_call;
  if reason in ('missed', 'cancelled') then perform public.aura_call_missed(c.caller_id, c.callee_id); end if;
  return c;
end $$;

-- "Still here", sent every so often by both PCs during a call. Answers with the call's status.
-- Each person has their own: if either PC goes quiet, the call is ended by the housekeeping above,
-- so nobody can be left looking "already in a call".
create or replace function public.call_heartbeat(the_call uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  now_status text;
begin
  update public.voice_calls
    set caller_beat_at = case when caller_id = me then now() else caller_beat_at end,
        callee_beat_at = case when callee_id = me then now() else callee_beat_at end
    where id = the_call and me in (caller_id, callee_id) and status <> 'ended';
  select status into now_status from public.voice_calls where id = the_call and me in (caller_id, callee_id);
  return coalesce(now_status, 'ended');
end $$;

-- Pass connection details to the other PC. Only once the call has been accepted.
create or replace function public.send_call_signal(the_call uuid, what text, body text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  c public.voice_calls;
  new_id bigint;
begin
  if me is null then raise exception 'You''re not logged in.'; end if;
  -- (The row is held while this runs, so details can't be stored just after the call has ended)
  select * into c from public.voice_calls where id = the_call and me in (caller_id, callee_id) for share;
  if not found then raise exception 'That isn''t your call.'; end if;
  if c.status <> 'active' then raise exception 'That call isn''t connected.'; end if;
  if what is null or what not in ('offer', 'answer', 'ice') then raise exception 'That isn''t a valid call message.'; end if;
  -- The caller proposes the connection and the person called answers it, never the other way round
  if (what = 'offer' and me <> c.caller_id) or (what = 'answer' and me <> c.callee_id) then
    raise exception 'That isn''t a valid call message.';
  end if;
  if body is null or char_length(body) < 1 or char_length(body) > 20000 then raise exception 'That call message is too long.'; end if;
  if (select count(*) from public.voice_signals s where s.call_id = the_call and s.sender_id = me) >= 300 then
    raise exception 'Too many call messages.';
  end if;
  insert into public.voice_signals (call_id, sender_id, recipient_id, kind, payload)
    values (the_call, me, case when me = c.caller_id then c.callee_id else c.caller_id end, what, body)
    returning id into new_id;
  return new_id;
end $$;

-- The call you are in right now, or one that is ringing for you, if any
create or replace function public.current_call()
returns setof public.voice_calls language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then return; end if;
  perform public.aura_calls_tidy(me);
  return query select * from public.voice_calls where status <> 'ended' and me in (caller_id, callee_id) order by created_at desc limit 1;
end $$;

-- ── 6. Removing or blocking a friend ends any call between you ───────────────
-- (Blocking removes the friendship, so this covers both.)
create or replace function public.friendships_end_calls()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c record;
begin
  for c in
    select id, caller_id, status from public.voice_calls
    where status <> 'ended'
      and least(caller_id, callee_id) = least(old.requester_id, old.addressee_id)
      and greatest(caller_id, callee_id) = greatest(old.requester_id, old.addressee_id)
    for update
  loop
    update public.voice_calls
      set status = 'ended', ended_at = now(),
          end_reason = case when c.status = 'active' then 'hangup' when auth.uid() = c.caller_id then 'cancelled' else 'declined' end
      where id = c.id;
    delete from public.voice_signals where call_id = c.id;
  end loop;
  return old;
end $$;
revoke all on function public.friendships_end_calls() from public, anon, authenticated;
drop trigger if exists friendships_end_calls on public.friendships;
create trigger friendships_end_calls after delete on public.friendships
  for each row execute function public.friendships_end_calls();

-- Only logged-in users may call these
revoke all on function public.start_call(uuid), public.answer_call(uuid), public.end_call(uuid, text), public.call_heartbeat(uuid),
  public.send_call_signal(uuid, text, text), public.current_call() from public, anon;
grant execute on function public.start_call(uuid), public.answer_call(uuid), public.end_call(uuid, text), public.call_heartbeat(uuid),
  public.send_call_signal(uuid, text, text), public.current_call() to authenticated;

-- ── 7. Live updates, so a call rings (and ends) straight away ────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'voice_calls') then
      alter publication supabase_realtime add table public.voice_calls;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'voice_signals') then
      alter publication supabase_realtime add table public.voice_signals;
    end if;
  end if;
end $$;
