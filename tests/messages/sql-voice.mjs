import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import { fileURLToPath } from "url";
import nodePath from "path";
// The SQL being checked is the project's own copy, in the supabase folder
const HERE = nodePath.dirname(fileURLToPath(import.meta.url));
const SQL = { messages: nodePath.join(HERE, "..", "..", "supabase", "aura-messages.sql"), media: nodePath.join(HERE, "..", "..", "supabase", "aura-messages-media.sql"), background: nodePath.join(HERE, "..", "..", "supabase", "aura-messages-background.sql"), safety: nodePath.join(HERE, "..", "..", "supabase", "aura-messages-safety.sql"), voice: nodePath.join(HERE, "..", "..", "supabase", "aura-messages-voice.sql"), storage: nodePath.join(HERE, "storage-fake.sql") };
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", C = "cccccccc-cccc-cccc-cccc-cccccccccccc", D = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const MISSED = "📞 Missed voice call";
const FILES = { storage: fs.readFileSync(SQL.storage, "utf8"), setup: fs.readFileSync(SQL.messages, "utf8"), media: fs.readFileSync(SQL.media, "utf8"), background: fs.readFileSync(SQL.background, "utf8"), safety: fs.readFileSync(SQL.safety, "utf8"), voice: fs.readFileSync(SQL.voice, "utf8") };
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };

async function world(files) {
  const db = new PGlite();
  await db.exec(`
    create schema auth; create table auth.users (id uuid primary key);
    create role anon nologin; create role authenticated nologin;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create publication supabase_realtime;
    insert into auth.users values ('${A}'), ('${B}'), ('${C}'), ('${D}');
    create table public.profiles (id uuid primary key references auth.users on delete cascade, username text unique not null, bio text, avatar_url text, created_at timestamptz default now());
    alter table public.profiles enable row level security;
    create policy "Logged-in users can view profiles" on public.profiles for select to authenticated using (true);
    insert into public.profiles (id, username) values ('${A}', 'tctray'), ('${B}', 'Alex'), ('${C}', 'Marcus'), ('${D}', 'Stranger');
  `);
  await db.exec(FILES.storage);
  for (const f of files) await db.exec(FILES[f]);
  const t = {
    db,
    as: async (uid, role = "authenticated") => { await db.exec(`reset role; set test.uid = '${uid || ""}'; set role ${role};`); },
    owner: async () => { await db.exec(`reset role; set test.uid = '';`); },
    q: async (text, params) => (await db.query(text, params)).rows,
  };
  t.one = async (text, params) => Object.values((await t.q(text, params))[0])[0];
  t.fails = async (p) => { try { await p; return false; } catch (e) { return e.message; } };
  t.friends = async (x, y) => { await t.as(x); await t.q("select public.request_friend($1)", [y]); await t.as(y); return t.one("select public.request_friend($1)", [x]); };
  t.start = (target) => t.q("select * from public.start_call($1)", [target]).then((r) => r[0]);
  t.answer = (id) => t.q("select * from public.answer_call($1)", [id]).then((r) => r[0]);
  t.end = (id, why = null) => t.q("select * from public.end_call($1, $2)", [id, why]).then((r) => r[0]);
  t.signal = (id, kind, body) => t.one("select public.send_call_signal($1, $2, $3)", [id, kind, body]);
  // Clears the slate between sections: every call ended and pushed into the past
  t.reset = async () => { await t.owner(); await t.q("delete from public.voice_signals"); await t.q("update public.voice_calls set status = 'ended', end_reason = coalesce(end_reason, 'hangup'), ended_at = coalesce(ended_at, now()), created_at = created_at - interval '1 hour'"); };
  return t;
}

const t = await world(["setup", "media", "background", "safety"]);
const { db, as, owner, q, one, fails, friends, start, answer, end, signal, reset } = t;
await friends(A, B); await friends(A, C); await friends(B, C);
await as(A); await q("select public.request_friend($1)", [D]); // D hasn't accepted
const AB = await (async () => { await as(A); return one("select public.open_conversation($1)", [B]); })();
await owner();
const sql = FILES.voice;
await db.exec(sql);
await db.exec(sql); // must be safe to run twice
for (const f of ["setup", "media", "background", "safety"]) await db.exec(FILES[f]);
await db.exec(sql);
const messagesIn = async (conv) => { await owner(); return q("select sender_id, content from public.messages where conversation_id = $1 order by created_at", [conv]); };

console.log("1. Who can call whom");
await as(null, "anon"); check("not logged in: can't call", !!(await fails(start(B))));
await as(A);
check("you can't call yourself", /Pick a friend/.test(await fails(start(A))));
check("you can't call someone who isn't your friend", /only call friends/.test(await fails(start(D))));
await as(D); check("a friend request that hasn't been accepted isn't enough", /only call friends/.test(await fails(start(A))));
await as(A);
let call = await start(B);
check("calling a friend starts a call that is ringing", call && call.status === "ringing" && call.caller_id === A && call.callee_id === B && !call.answered_at, call);

console.log("2. Who can see a call");
check("the caller sees it", (await q("select id from public.voice_calls")).length === 1);
await as(B); check("the person being called sees it", (await q("select id from public.voice_calls")).length === 1);
check("current_call gives them the ringing call", (await q("select * from public.current_call()"))[0]?.id === call.id);
await as(C); check("nobody else sees it", (await q("select id from public.voice_calls")).length === 0 && (await q("select * from public.current_call()")).length === 0);
await as(null, "anon"); check("not logged in: sees nothing", !!(await fails(q("select id from public.voice_calls"))));
await as(B);
check("a call can't be created by hand", /permission denied/.test(await fails(q("insert into public.voice_calls (caller_id, callee_id) values ($1, $2)", [C, B]))));
check("...or changed by hand", /permission denied/.test(await fails(q("update public.voice_calls set status = 'active'"))));
check("...or removed by hand", /permission denied/.test(await fails(q("delete from public.voice_calls"))));
check("connection details can't be written by hand", /permission denied/.test(await fails(q("insert into public.voice_signals (call_id, sender_id, recipient_id, kind, payload) values ($1, $2, $3, 'ice', 'x')", [call.id, B, A]))));

console.log("3. One call at a time");
await as(A); check("the caller can't start a second call", /already in a call/.test(await fails(start(C))));
await as(B); check("the person being called can't call out either", /already in a call/.test(await fails(start(C))));
check("calling the person who is calling you says so", /calling you right now/.test(await fails(start(A))));
await as(C); check("a third friend is told they're on another call", /on another call/.test(await fails(start(A))) && /on another call/.test(await fails(start(B))));

console.log("4. Nothing about either PC is shared before the call is accepted");
await as(A); check("the caller can't send connection details while it rings", /isn't connected/.test(await fails(signal(call.id, "offer", "sdp"))));
await as(B); check("nor can the person being called", /isn't connected/.test(await fails(signal(call.id, "ice", "c"))));

console.log("5. Answering");
await as(C); check("someone else can't answer", /has ended/.test(await fails(answer(call.id))));
await as(A); check("the caller can't answer their own call", /has ended/.test(await fails(answer(call.id))));
await as(B);
let live = await answer(call.id);
check("the person called answers: the call is active", live.status === "active" && !!live.answered_at, live);
check("it can't be answered twice", /has ended/.test(await fails(answer(call.id))));

console.log("6. Connection details");
check("only the caller may propose the connection", /valid call message/.test(await fails(signal(call.id, "offer", "x"))));
await as(A);
check("only the person called may answer it", /valid call message/.test(await fails(signal(call.id, "answer", "x"))));
const s1 = await signal(call.id, "offer", "offer-from-A");
const s2 = await signal(call.id, "ice", "ice-from-A");
check("the caller sends an offer and network details", Number(s2) > Number(s1));
check("an unknown kind is refused", /valid call message/.test(await fails(signal(call.id, "video", "x"))));
check("an empty or oversized one is refused", /too long/.test(await fails(signal(call.id, "ice", ""))) && /too long/.test(await fails(signal(call.id, "ice", "x".repeat(20001)))));
check("the sender can't read back what was sent to the other person", (await q("select id from public.voice_signals")).length === 0);
await as(B);
await signal(call.id, "answer", "answer-from-B"); await signal(call.id, "ice", "ice-from-B");
let got = await q("select kind, payload, sender_id from public.voice_signals order by id");
check("the other person receives exactly what was sent to them, in order", got.length === 2 && got[0].payload === "offer-from-A" && got[1].payload === "ice-from-A" && got.every((g) => g.sender_id === A), got);
await as(A); got = await q("select kind, payload from public.voice_signals order by id");
check("and the caller receives the answer", got.length === 2 && got[0].kind === "answer" && got[1].payload === "ice-from-B", got);
await as(C);
check("someone outside the call sees none of it", (await q("select id from public.voice_signals")).length === 0);
check("...and can't send into it", /isn't your call/.test(await fails(signal(call.id, "ice", "x"))));
await as(A);
for (let i = 0; i < 298; i++) await signal(call.id, "ice", "c" + i);
check("there is a limit on how many one person can send in a call", /Too many/.test(await fails(signal(call.id, "ice", "one more"))));

console.log("7. Staying alive, and hanging up");
check("a heartbeat answers with the call's status", (await one("select public.call_heartbeat($1)", [call.id])) === "active");
await as(C); check("someone else's heartbeat learns nothing", (await one("select public.call_heartbeat($1)", [call.id])) === "ended");
check("someone else can't end the call", /isn't your call/.test(await fails(end(call.id))));
await as(B);
let done = await end(call.id);
check("either person can hang up", done.status === "ended" && done.end_reason === "hangup" && !!done.ended_at, done);
await owner(); check("the connection details are deleted when the call ends", (await q("select id from public.voice_signals")).length === 0);
await as(A);
check("hanging up again changes nothing", (await end(call.id)).end_reason === "hangup");
check("nothing more can be sent into an ended call", /isn't connected/.test(await fails(signal(call.id, "ice", "x"))));
check("a heartbeat now says it has ended", (await one("select public.call_heartbeat($1)", [call.id])) === "ended");
check("a finished call left no note in the conversation", (await messagesIn(AB)).length === 0);

console.log("8. Declined, cancelled, no answer");
await reset();
await as(A); call = await start(B);
await as(B); done = await end(call.id, "missed");
check("the person called declines (and can't label it a missed call)", done.end_reason === "declined", done);
check("a declined call leaves no note", (await messagesIn(AB)).length === 0);
await as(A); call = await start(B); done = await end(call.id);
check("the caller cancels", done.end_reason === "cancelled", done);
let notes = await messagesIn(AB);
check("a cancelled call leaves a note from the caller in the conversation", notes.length === 1 && notes[0].sender_id === A && notes[0].content === MISSED, notes);
await as(B); check("the person called sees that note as an unread message", (await q("select unread, last_message from public.list_conversations()")).find((c) => c.last_message === MISSED)?.unread === 1);
await as(A); call = await start(B); done = await end(call.id, "missed");
check("the caller gives up waiting: no answer", done.end_reason === "missed", done);
check("...and that leaves a note too", (await messagesIn(AB)).length === 2);
// B and C are friends who have never messaged
await reset();
await as(B); call = await start(C); await end(call.id);
await as(C); const bc = await q("select id, last_message from public.list_conversations()");
check("a missed call between friends who never messaged starts their conversation", bc.some((c) => c.last_message === MISSED), bc);

console.log("9. Calls left hanging are cleaned up");
await reset();
await as(A); call = await start(B);
await owner(); await q("update public.voice_calls set created_at = now() - interval '50 seconds' where id = $1", [call.id]);
await as(B); check("a call that rang too long can't be answered", /has ended/.test(await fails(answer(call.id))));
check("...and no longer counts as a call in progress", (await q("select * from public.current_call()")).length === 0);
await owner(); let row = (await q("select status, end_reason from public.voice_calls where id = $1", [call.id]))[0];
check("it is marked as missed", row.status === "ended" && row.end_reason === "missed", row);
check("with a note in the conversation", (await messagesIn(AB)).length === 3);
await reset();
await as(A); call = await start(B); await as(B); await answer(call.id);
await as(A); await signal(call.id, "offer", "x");
// Alex's PC has gone quiet; tctray's keeps saying "still here"
await owner(); await q("update public.voice_calls set callee_beat_at = now() - interval '2 minutes' where id = $1", [call.id]);
await as(A); check("one person's heartbeat counts for them only", (await one("select public.call_heartbeat($1)", [call.id])) === "active" && (await q("select callee_beat_at < now() - interval '100 seconds' as old from public.voice_calls where id = $1", [call.id]))[0].old === true);
await as(C);
const c2 = await start(A).catch((e) => e.message);
check("an active call where either PC has gone quiet is ended, so nobody is stuck 'in a call'", c2 && c2.status === "ringing", c2);
await owner(); row = (await q("select status, end_reason from public.voice_calls where id = $1", [call.id]))[0];
check("it is marked as failed, and its connection details are gone", row.end_reason === "failed" && (await q("select id from public.voice_signals")).length === 0, row);
await q("update public.voice_calls set status = 'ended', end_reason = 'hangup', ended_at = now() - interval '31 days', created_at = now() - interval '31 days' where id = $1", [call.id]);
await as(C); await end(c2.id);
await as(A); await q("select * from public.current_call()");
await owner(); check("calls older than 30 days are forgotten", (await q("select id from public.voice_calls where id = $1", [call.id])).length === 0);

console.log("10. Calling can't be used to pester someone");
await reset();
await as(A);
for (let i = 0; i < 5; i++) { const c = await start(B); await end(c.id); }
check("after five unanswered calls to the same friend, a sixth has to wait", /several times/.test(await fails(start(B))));
const other = await start(C).catch((e) => e.message);
check("another friend can still be called", other && other.status === "ringing", other);
await end(other.id);
check("more than six calls in a minute are refused", /too often/.test(await fails(start(C))));
await reset();
await as(A); check("after a while, calling works again", (await start(B)).status === "ringing");

console.log("11. Blocking and unfriending");
await reset();
await as(A); await q("select public.block_user($1)", [B]);
check("you can't call someone you blocked", /only call friends/.test(await fails(start(B))));
await as(B); check("and they can't call you", /only call friends/.test(await fails(start(A))));
await as(A); await q("select public.unblock_user($1)", [B]);
check("unblocking alone doesn't bring calls back: you'd need to be friends again", /only call friends/.test(await fails(start(B))));
await friends(A, B);
await as(A); call = await start(B); await end(call.id);
check("friends again: calls work", call.status === "ringing");
await as(C); await q("delete from public.friendships where $1 in (requester_id, addressee_id) and $2 in (requester_id, addressee_id)", [C, A]);
check("after removing a friend, neither can call the other", /only call friends/.test(await fails(start(A))));

console.log("11b. Blocking or removing a friend during a call");
await reset(); await friends(A, C);
const notesSoFar = (await messagesIn(AB)).length;
await as(A); call = await start(B);
await as(B); await q("select public.block_user($1)", [A]);
await owner(); row = (await q("select status, end_reason from public.voice_calls where id = $1", [call.id]))[0];
check("blocking someone whose call is ringing ends it (they see it as declined)", row.status === "ended" && row.end_reason === "declined", row);
await as(B); check("it can't be answered after that", /has ended/.test(await fails(answer(call.id))));
await as(A); check("the blocked caller's cancel leaves no note", (await end(call.id)).end_reason === "declined" && (await messagesIn(AB)).length === notesSoFar, (await messagesIn(AB)).length);
await as(B); await q("select public.unblock_user($1)", [A]); await friends(A, B); await reset();
await as(A); call = await start(B); await as(B); await answer(call.id); await as(A); await signal(call.id, "offer", "x");
await as(B); await q("delete from public.friendships where $1 in (requester_id, addressee_id) and $2 in (requester_id, addressee_id)", [A, B]);
await owner(); row = (await q("select status, end_reason from public.voice_calls where id = $1", [call.id]))[0];
check("removing a friend mid-call ends the call and deletes its connection details", row.status === "ended" && row.end_reason === "hangup" && (await q("select 1 from public.voice_signals")).length === 0, row);
await as(A); check("nothing more can be sent", /isn't connected/.test(await fails(signal(call.id, "ice", "x"))));
await friends(A, B); await reset();
await as(A); call = await start(B);
await owner(); await q("delete from public.friendships where $1 in (requester_id, addressee_id) and $2 in (requester_id, addressee_id)", [A, B]);
row = (await q("select status from public.voice_calls where id = $1", [call.id]))[0];
check("a friendship removed any other way ends the call too", row.status === "ended");
await friends(A, B);
// A call that is ringing when the friendship quietly disappears can't be answered or leave a note
await reset(); await as(A); call = await start(B);
await owner(); await q("alter table public.friendships disable trigger friendships_end_calls"); await q("delete from public.friendships where $1 in (requester_id, addressee_id) and $2 in (requester_id, addressee_id)", [A, B]); await q("alter table public.friendships enable trigger friendships_end_calls");
const notesBefore = (await messagesIn(AB)).length;
await as(B); check("answering checks you are still friends", /has ended/.test(await fails(answer(call.id))));
await as(A); await end(call.id);
check("and no missed-call note is written between people who aren't friends", (await messagesIn(AB)).length === notesBefore);
await friends(A, B);

console.log("12. Live updates and permissions");
await owner();
const pub = (await q("select tablename from pg_publication_tables where pubname = 'supabase_realtime'")).map((r) => r.tablename);
check("both tables send live updates", pub.includes("voice_calls") && pub.includes("voice_signals"), pub);
const execs = await q("select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('start_call','answer_call','end_call','call_heartbeat','send_call_signal','current_call','aura_calls_tidy','aura_call_missed','friendships_end_calls')");
check("the call functions are for logged-in users only", execs.length === 9 && execs.every((e) => !e.anon), execs);
check("the housekeeping functions can't be called from the app at all", execs.filter((e) => e.proname.startsWith("aura_") || e.proname === "friendships_end_calls").every((e) => !e.auth), execs);
await as(A); check("...even by a logged-in user", /permission denied/.test(await fails(q("select public.aura_call_missed($1, $2)", [C, A]))) && /permission denied/.test(await fails(q("select public.aura_calls_tidy($1)", [B]))));

console.log("13. On a database with only the first messages file");
const t2 = await world(["setup", "voice"]);
await t2.friends(A, B);
await t2.as(A); const basic = await t2.start(B); await t2.end(basic.id);
await t2.owner();
check("calls work, and a missed one still leaves its note", basic.status === "ringing" && (await t2.q("select content from public.messages"))[0]?.content === MISSED);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
