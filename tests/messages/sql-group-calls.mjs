// Database rules for calls with up to 3 people (supabase/aura-calls-group.sql), checked on a real
// Postgres (PGlite) with the same roles and auth.uid() that Supabase uses.
// Added by aura-group-calls-setup.cjs.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import { fileURLToPath } from "url";
import nodePath from "path";

const HERE = nodePath.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(nodePath.join(HERE, ...p), "utf8");
const FILES = {
  storage: read("storage-fake.sql"), setup: read("..", "..", "supabase", "aura-messages.sql"), media: read("..", "..", "supabase", "aura-messages-media.sql"),
  background: read("..", "..", "supabase", "aura-messages-background.sql"), safety: read("..", "..", "supabase", "aura-messages-safety.sql"),
  voice: read("..", "..", "supabase", "aura-messages-voice.sql"), group: read("..", "..", "supabase", "aura-calls-group.sql"),
};
// tctray, Alex, Marcus, Stranger, Jordan, Sam
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const D = "dddddddd-dddd-dddd-dddd-dddddddddddd", E = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", F = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const MISSED = "📞 Missed voice call";
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };

const db = new PGlite();
await db.exec(`
  create schema auth; create table auth.users (id uuid primary key);
  create role anon nologin; create role authenticated nologin;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  create publication supabase_realtime;
  insert into auth.users values ('${A}'), ('${B}'), ('${C}'), ('${D}'), ('${E}'), ('${F}');
  create table public.profiles (id uuid primary key references auth.users on delete cascade, username text unique not null, bio text, avatar_url text, created_at timestamptz default now());
  alter table public.profiles enable row level security;
  create policy "Logged-in users can view profiles" on public.profiles for select to authenticated using (true);
  insert into public.profiles (id, username) values ('${A}', 'tctray'), ('${B}', 'Alex'), ('${C}', 'Marcus'), ('${D}', 'Stranger'), ('${E}', 'Jordan'), ('${F}', 'Sam');
`);
await db.exec(FILES.storage);
for (const f of ["setup", "media", "background", "safety", "voice"]) await db.exec(FILES[f]);

const as = async (uid, role = "authenticated") => { await db.exec(`reset role; set test.uid = '${uid || ""}'; set role ${role};`); };
const owner = async () => { await db.exec(`reset role; set test.uid = '';`); };
const q = async (text, params) => (await db.query(text, params)).rows;
const one = async (text, params) => Object.values((await q(text, params))[0] || {})[0];
const fails = async (p) => { try { await p; return false; } catch (e) { return e.message; } };
const friends = async (x, y) => { await as(x); await q("select public.request_friend($1)", [y]); await as(y); await q("select public.request_friend($1)", [x]); };
const start = (target) => q("select * from public.start_call($1)", [target]).then((r) => r[0]);
const answer = (id) => q("select * from public.answer_call($1)", [id]).then((r) => r[0]);
const end = (id, why = null) => q("select * from public.end_call($1, $2)", [id, why]).then((r) => r[0]);
const add = (id, who) => q("select * from public.add_to_call($1, $2)", [id, who]).then((r) => r[0]);
const join = (id) => q("select * from public.join_group($1)", [id]);
const signal = (id, kind, body) => one("select public.send_call_signal($1, $2, $3)", [id, kind, body]);
const reset = async () => { await owner(); await q("delete from public.voice_signals"); await q("update public.voice_calls set status = 'ended', end_reason = coalesce(end_reason, 'hangup'), ended_at = coalesce(ended_at, now()), created_at = created_at - interval '1 hour'"); };
const pair = (row, x, y) => row && ((row.caller_id === x && row.callee_id === y) || (row.caller_id === y && row.callee_id === x));

// tctray is friends with everyone but the stranger. Alex and Marcus aren't friends with each other.
await friends(A, B); await friends(A, C); await friends(A, E); await friends(A, F); await friends(E, F);
await owner();

console.log("1. Setting it up");
await db.exec(FILES.group);
await db.exec(FILES.group); // safe to run twice
await db.exec(FILES.voice); // and the voice file can still be run again afterwards
await db.exec(FILES.safety);
await db.exec(FILES.group);
check("calls have a group", (await q("select column_name from information_schema.columns where table_name = 'voice_calls' and column_name = 'group_id'")).length === 1);
await as(null, "anon");
check("not logged in: can't add anyone", !!(await fails(add("00000000-0000-0000-0000-000000000000", B))));
await as(B);
check("the helpers can't be called directly", /permission denied/.test(await fails(q("select * from public.aura_group_people($1)", [A]))));

console.log("2. Adding a friend to a call");
await as(A); let call = await start(B);
await as(A); check("a call that is still ringing can't have people added", /has ended/.test(await fails(add(call.id, C))));
await as(B); await answer(call.id);
await as(C); check("someone outside the call can't add people to it", /has ended/.test(await fails(add(call.id, C))));
await as(A);
check("you can't add yourself", /Pick a friend/.test(await fails(add(call.id, A))));
check("you can only add friends", /only add friends/.test(await fails(add(call.id, D))));
check("someone already in the call can't be added again", /already in this call/.test(await fails(add(call.id, B))));
let invite = await add(call.id, C);
check("adding a friend rings them", invite && invite.status === "ringing" && invite.caller_id === A && invite.callee_id === C && invite.group_id === call.id, invite);
await as(B);
check("the person already in the call sees the call is now a group", (await q("select group_id from public.voice_calls where id = $1", [call.id]))[0]?.group_id === call.id);
check("...but not the ringing itself (that's between the two of them)", (await q("select id from public.voice_calls where id = $1", [invite.id])).length === 0);
await as(C);
check("the friend being added sees it ringing, with its group", (await q("select * from public.current_call()"))[0]?.group_id === call.id);
await as(D); check("nobody else sees any of it", (await q("select id from public.voice_calls")).length === 0);

console.log("3. Three people at most");
await as(A); check("while someone is being rung, the call is full", /call is full/.test(await fails(add(call.id, E))));
await as(B); check("...for everyone in it", /call is full|only add friends/.test(await fails(add(call.id, E))));
await as(C); check("the friend being rung can't join the others before answering", /has ended/.test(await fails(join(invite.id))));
await answer(invite.id);
let links = await join(invite.id);
check("once they answer, they're connected to the other person in the call", links.length === 1 && pair(links[0], C, B) && links[0].caller_id === C && links[0].status === "active" && links[0].group_id === call.id, links);
check("joining again doesn't connect them twice", (await join(invite.id)).length === 0);
await as(B); check("joining as someone who was already there adds nothing", (await join(call.id)).length === 0);
await as(D); check("a stranger can't join", /has ended/.test(await fails(join(call.id))));
await as(A); check("three people: nobody else can be added", /call is full/.test(await fails(add(call.id, F))));
await as(B); check("the other two can see the connection between them", (await q("select id from public.voice_calls where id = $1", [links[0].id])).length === 1);

console.log("4. The two who aren't friends can still talk in the call");
const link = links[0];
await as(C); check("the newcomer's PC proposes the connection", (await signal(link.id, "offer", "x")) > 0);
await as(B);
check("the other PC answers it", (await signal(link.id, "answer", "y")) > 0);
check("...and can't propose one itself", /valid call message/.test(await fails(signal(link.id, "offer", "z"))));
check("each sees only what was sent to them", (await q("select kind from public.voice_signals")).every((s) => s.kind === "offer"));
check("heartbeats work on that connection too", (await one("select public.call_heartbeat($1)", [link.id])) === "active");

console.log("5. One call at a time still holds");
await as(B); check("someone in a group call can't start another", /already in a call/.test(await fails(start(A))));
await as(E); check("nobody can call someone who is in a group call", /on another call/.test(await fails(start(A))));
await as(C); check("current_call still gives an older AURA one call", (await q("select * from public.current_call()")).length === 1);

console.log("6. Leaving");
await as(B); await end(call.id); await end(link.id);
await as(A); check("when one person leaves, the other two carry on", (await q("select status from public.voice_calls where id = $1", [invite.id])).map((r) => r.status).join() === "active");
let second = await add(invite.id, F);
check("with a place free, someone else can be added", second && second.status === "ringing" && second.group_id === call.id, second);
await as(F); const declined = await end(second.id);
check("they can decline", declined.end_reason === "declined", declined);
await as(E); await start(F);
await as(A); check("someone on another call can't be added", /on another call/.test(await fails(add(invite.id, E))));
await reset();

console.log("7. Blocking");
await as(C); await q("select public.block_user($1)", [B]); // Marcus blocks Alex (they were never friends)
await as(A); call = await start(C); await as(C); await answer(call.id);
await as(A); check("nobody is added to a call with someone who blocked them", /can't join/.test(await fails(add(call.id, B))));
await as(C); await q("select public.unblock_user($1)", [B]);
await as(A); invite = await add(call.id, B);
await as(B); await answer(invite.id); links = await join(invite.id);
check("after unblocking they can be in a call together", links.length === 1 && pair(links[0], B, C), links);
await as(C); await q("select public.block_user($1)", [B]);
await owner();
let rows = await q("select id, status from public.voice_calls where id = any($1)", [[call.id, invite.id, links[0].id]]);
const status = (id) => rows.find((r) => r.id === id)?.status;
check("blocking someone mid-call ends the connection with them", status(links[0].id) === "ended", rows);
check("...and only that one", status(call.id) === "active" && status(invite.id) === "active", rows);
await as(C); await q("select public.unblock_user($1)", [B]);
await reset();

console.log("8. Calls left hanging");
await as(A); call = await start(B); await as(B); await answer(call.id);
await as(A); invite = await add(call.id, C);
await owner(); await q("update public.voice_calls set created_at = now() - interval '50 seconds' where id = $1", [invite.id]);
await as(C); check("an invite that rang too long can't be answered", /has ended/.test(await fails(answer(invite.id))));
await q("select * from public.current_call()"); // (what AURA asks when it starts, which tidies up)
const conv = await (async () => { await as(A); return one("select public.open_conversation($1)", [C]); })();
await owner(); const notes = await q("select content from public.messages where conversation_id = $1", [conv]);
check("it leaves a missed-call note, like any call", notes.some((n) => n.content === MISSED), notes);
await as(A); invite = await add(call.id, C); await as(C); await answer(invite.id); await join(invite.id);
await owner(); await q("update public.voice_calls set callee_beat_at = now() - interval '2 minutes', caller_beat_at = now() - interval '2 minutes' where group_id = $1 and $2 in (caller_id, callee_id)", [call.id, B]);
await as(A); second = await add(invite.id, F).catch((e) => e.message);
check("someone whose PC went quiet doesn't keep their place", second && second.status === "ringing", second);

console.log("9. Removing a friend");
await reset();
await as(A); call = await start(B); await as(B); await answer(call.id);
await as(A); invite = await add(call.id, C); await as(C); await answer(invite.id); links = await join(invite.id);
await as(A); await q("delete from public.friendships where $1 in (requester_id, addressee_id) and $2 in (requester_id, addressee_id)", [A, B]).catch(() => {});
await as(A); await q("select public.remove_friend($1)", [B]).catch(() => {});
await owner(); rows = await q("select id, status from public.voice_calls where id = any($1)", [[call.id, invite.id, links[0].id]]);
check("unfriending ends the call between those two", rows.find((r) => r.id === call.id)?.status === "ended", rows);
check("...and the others carry on", rows.filter((r) => r.status === "active").length === 2, rows);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
