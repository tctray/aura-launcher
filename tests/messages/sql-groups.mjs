// Database rules for group chats (supabase/aura-messages-groups.sql), checked on a real Postgres
// (PGlite) with the same roles and auth.uid() that Supabase uses.
// Added by aura-messages-groups-setup.cjs.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import { fileURLToPath } from "url";
import nodePath from "path";

const HERE = nodePath.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(nodePath.join(HERE, ...p), "utf8");
const sql = (name) => read("..", "..", "supabase", name);
const FILES = {
  storage: read("storage-fake.sql"), setup: sql("aura-messages.sql"), media: sql("aura-messages-media.sql"), background: sql("aura-messages-background.sql"),
  safety: sql("aura-messages-safety.sql"), reactions: sql("aura-messages-reactions.sql"), groups: sql("aura-messages-groups.sql"),
};
// tctray, Alex, Marcus, Stranger, Jordan, and eight more of tctray's friends
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const D = "dddddddd-dddd-dddd-dddd-dddddddddddd", E = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const MORE = Array.from({ length: 8 }, (_, i) => `1000000${i}-0000-0000-0000-000000000000`);
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
  create table public.profiles (id uuid primary key references auth.users on delete cascade, username text unique not null, bio text, avatar_url text, created_at timestamptz default now());
  alter table public.profiles enable row level security;
  create policy "Logged-in users can view profiles" on public.profiles for select to authenticated using (true);
`);
const people = [[A, "tctray"], [B, "Alex"], [C, "Marcus"], [D, "Stranger"], [E, "Jordan"], ...MORE.map((id, i) => [id, "Friend" + i])];
for (const [id, name] of people) { await db.query("insert into auth.users values ($1)", [id]); await db.query("insert into public.profiles (id, username) values ($1, $2)", [id, name]); }
await db.exec(FILES.storage);

const as = async (uid, role = "authenticated") => { await db.exec(`reset role; set test.uid = '${uid || ""}'; set role ${role};`); };
const owner = async () => { await db.exec(`reset role; set test.uid = '';`); };
const q = async (text, params) => (await db.query(text, params)).rows;
const one = async (text, params) => Object.values((await q(text, params))[0] || {})[0];
const fails = async (p) => { try { await p; return false; } catch (e) { return e.message; } };
const friends = async (x, y) => { await as(x); await q("select public.request_friend($1)", [y]); await as(y); await q("select public.request_friend($1)", [x]); };
const make = (title, who) => one("select public.create_group($1, $2::uuid[])", [title, who]);
const say = (cid, me, text) => q("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, $3) returning id", [cid, me, text]).then((r) => r[0].id);
const groups = () => q("select * from public.list_groups()");
const lines = async (cid) => { await owner(); return (await q("select content from public.messages where conversation_id = $1 order by created_at", [cid])).map((r) => r.content); };

console.log("1. Setting it up");
await db.exec(FILES.setup);
check("needs the other messages files first, and says so", /Run the other messages files first/.test(await fails(db.exec(FILES.groups))));
for (const f of ["media", "background", "safety", "reactions"]) await db.exec(FILES[f]);
await friends(A, B); await friends(A, C); await friends(A, E);
for (const m of MORE) await friends(A, m);
await as(A); const AB = await one("select public.open_conversation($1)", [B]); await say(AB, A, "hi Alex");
await owner();
await db.exec(FILES.groups);
await db.exec(FILES.groups); // safe to run twice
for (const f of ["setup", "media", "background", "safety", "reactions", "groups"]) await db.exec(FILES[f]); // and everything again, in order
check("an existing chat between two people still works", (await (async () => { await as(B); return q("select content from public.messages where conversation_id = $1", [AB]); })()).length === 1);
await as(B); check("...and can still be written to", !!(await say(AB, B, "hey")));
await as(A); check("a chat of two still opens the same way", (await one("select public.open_conversation($1)", [B])) === AB);
check("a conversation can't be half a group", /conversations_shape|violates/.test(await fails((async () => { await owner(); await q("insert into public.conversations (is_group, title, user_a, user_b) values (true, 'x', $1, $2)", [A < B ? A : B, A < B ? B : A]); })())));

console.log("2. Making a group");
await as(null, "anon"); check("not logged in: can't make one", !!(await fails(make("Squad", [B]))));
await as(A);
check("it needs a name", /Give the group a name/.test(await fails(make("   ", [B]))));
check("names are kept short", /60 characters/.test(await fails(make("x".repeat(61), [B]))));
check("it needs someone besides you", /at least one friend/.test(await fails(make("Squad", [A]))));
check("only friends can be put in it", /only add friends/.test(await fails(make("Squad", [B, D]))));
const G = await make("  Squad   night ", [B, C, B]);
check("making a group with two friends works", typeof G === "string");
await owner();
const row = (await q("select is_group, title, user_a, user_b, created_by from public.conversations where id = $1", [G]))[0];
check("it is a group, named tidily", row.is_group === true && row.title === "Squad night" && row.user_a === null && row.created_by === A, row);
const mem = await q("select user_id, role from public.conversation_members where conversation_id = $1 order by role desc", [G]);
check("you're in it as its owner, with each friend once", mem.length === 3 && mem.find((m) => m.user_id === A).role === "owner", mem);
check("it says it was made", (await lines(G))[0] === "👥 created the group");

console.log("3. Who sees it");
await as(B);
let gl = await groups();
check("the people in it see it in their list", gl.length === 1 && gl[0].id === G && gl[0].title === "Squad night" && gl[0].owner_id === A, gl);
check("...with everyone in it", gl[0].members.length === 3 && gl[0].members.map((m) => m.username).sort().join() === "Alex,Marcus,tctray", gl[0].members);
check("...and whether each is a friend", gl[0].members.find((m) => m.user_id === C).is_friend === false && gl[0].members.find((m) => m.user_id === A).is_friend === true);
check("online status is only shown for friends", gl[0].members.find((m) => m.user_id === C).last_seen_at === null);
check("the line saying it was made counts as new", gl[0].unread === 1, gl[0]);
check("a group isn't mixed into the chats-of-two list", (await q("select id from public.list_conversations_v2()")).every((c) => c.id !== G));
check("the members can see each other", (await q("select user_id from public.conversation_members where conversation_id = $1", [G])).length === 3);
await as(D);
check("someone outside sees nothing of it", (await groups()).length === 0 && (await q("select id from public.conversations where id = $1", [G])).length === 0
  && (await q("select 1 from public.conversation_members where conversation_id = $1", [G])).length === 0 && (await q("select 1 from public.messages where conversation_id = $1", [G])).length === 0);

console.log("4. Talking");
await as(B); const fromB = await say(G, B, "who's on tonight?");
check("a member can send a message", !!fromB);
await as(C);
check("Marcus, who isn't Alex's friend, still reads it", (await q("select content from public.messages where id = $1", [fromB]))[0]?.content === "who's on tonight?");
check("...and can answer", !!(await say(G, C, "me")));
await as(C); check("nobody can send as someone else", !!(await fails(say(G, A, "fake"))));
await as(D); check("someone outside can't send to it", !!(await fails(say(G, D, "let me in"))));
await as(C); check("a group's messages can't be marked read like a chat of two", !!(await fails(q("select public.mark_conversation_read($1)", [G]))));
check("each person has their own place: Marcus has unread", (await groups())[0].unread === 2);
await q("select public.mark_group_read($1)", [G]);
check("marking it read sets it to none, for Marcus only", (await groups())[0].unread === 0 && (await (async () => { await as(B); return (await groups())[0].unread; })()) > 0);

console.log("5. Pictures, likes, deleting, reporting");
await as(C);
check("a member can upload a picture to the group's folder", !(await fails(q("insert into storage.objects (bucket_id, name, owner) values ('message-media', $1, $2)", [G + "/11111111-1111-1111-1111-111111111111.png", C]))));
check("...and the others can see it", (await (async () => { await as(A); return q("select name from storage.objects where name like $1", [G + "/%"]); })()).length === 1);
await as(D); check("someone outside can't upload there", !!(await fails(q("insert into storage.objects (bucket_id, name, owner) values ('message-media', $1, $2)", [G + "/22222222-2222-2222-2222-222222222222.png", D]))));
check("...or see it", (await q("select name from storage.objects where name like $1", [G + "/%"])).length === 0);
await as(C);
check("Marcus can like Alex's message", (await one("select public.react_in_group($1, 'like')", [fromB])) === "like");
await as(A); check("tctray sees that like", (await q("select reaction from public.message_reactions where message_id = $1", [fromB]))[0]?.reaction === "like");
await as(D); check("someone outside can't like it", /isn't in one of your conversations/.test(await fails(q("select public.react_in_group($1, 'like')", [fromB]))));
await as(C); check("the like for chats of two refuses group messages (AURA uses the group one)", !!(await fails(q("select public.react_to_message($1, 'like')", [fromB]))));
await as(B); check("you can delete your own message in a group", (await one("select public.delete_message($1)", [fromB])) === true);
await as(C); check("...and nobody else's", /only delete your own/.test(await fails(q("select public.delete_message((select id from public.messages where conversation_id = $1 and sender_id = $2 limit 1))", [G, A]))));
const fromA = (await q("select id from public.messages where conversation_id = $1 and sender_id = $2 limit 1", [G, A]))[0].id;
check("a member can report a message in the group", (await one("select public.report_in_group($1, 'spam', null, $2)", [A, fromA])) === true);
await owner(); check("the report keeps a copy of it", (await q("select message_content from public.reports where message_id = $1", [fromA]))[0]?.message_content === "👥 created the group");
await as(D); check("someone outside can't report it", !!(await fails(q("select public.report_in_group($1, 'spam', null, $2)", [A, fromA]))));

console.log("6. Adding and removing people");
await as(B);
check("only the person who made it can add people", /Only the person who made the group/.test(await fails(q("select public.add_group_members($1, $2::uuid[])", [G, [E]]))));
check("...or remove them", /Only the person who made the group/.test(await fails(q("select public.remove_group_member($1, $2)", [G, C]))));
await as(A);
check("they can't add someone who isn't their friend", /only add friends/.test(await fails(q("select public.add_group_members($1, $2::uuid[])", [G, [D]]))));
check("adding a friend works", (await one("select public.add_group_members($1, $2::uuid[])", [G, [E, B]])) === 1);
check("...and says so in the group", (await lines(G)).includes("👥 added Jordan"));
await as(E); check("someone added sees the group, and what was said before", (await groups()).length === 1 && (await q("select 1 from public.messages where conversation_id = $1", [G])).length >= 4);
await as(A);
check("a group can have up to 10 people", /up to 10 people/.test(await fails(q("select public.add_group_members($1, $2::uuid[])", [G, MORE.slice(0, 7)]))));
check("...so 6 more fit", (await one("select public.add_group_members($1, $2::uuid[])", [G, MORE.slice(0, 6)])) === 6);
check("making one with more than 10 is refused too", /up to 10 people/.test(await fails(make("Big", [B, C, E, ...MORE]))));
check("removing someone works", (await one("select public.remove_group_member($1, $2)", [G, C])) === true);
check("...and says so", (await lines(G)).includes("👥 removed Marcus"));
await as(C);
check("someone removed no longer sees the group or its messages", (await groups()).length === 0 && (await q("select 1 from public.messages where conversation_id = $1", [G])).length === 0);
check("...and can't send to it", !!(await fails(say(G, C, "hello?"))));
check("...or see its pictures", (await q("select name from storage.objects where name like $1", [G + "/%"])).length === 0);
await as(A); check("you can't remove yourself (that's leaving)", /Leave group/.test(await fails(q("select public.remove_group_member($1, $2)", [G, A]))));
await as(A); await q("select public.remove_group_member($1, $2)", [G, MORE[0]]);

console.log("7. Renaming");
await as(B);
check("anyone in the group can rename it", (await one("select public.rename_group($1, $2)", [G, "Friday crew"])) === "Friday crew");
check("...and the group says so", (await lines(G)).includes('👥 named the group "Friday crew"'));
{ await as(B); const r = await fails(q("select public.rename_group($1, '')", [G])); check("a name can't be blank", /Give the group a name/.test(r), r); }
await as(C); check("someone outside can't rename it", /isn't one of your groups/.test(await fails(q("select public.rename_group($1, 'Hacked')", [G]))));

console.log("8. Blocking");
await as(B); await q("select public.block_user($1)", [E]); // Alex blocks Jordan (they're not friends)
await as(B); await q("select public.mark_group_read($1)", [G]);
await as(E); await say(G, E, "hey Alex");
await as(B); gl = await groups();
check("messages from someone you blocked don't count as unread", gl[0].unread === 0, gl[0]);
check("...and aren't shown in the list", gl[0].last_message !== "hey Alex", gl[0]);
await as(E); check("...but the others still see them", (await groups())[0].last_message === "hey Alex");
await as(A); await q("select public.block_user($1)", [MORE[1]]);
check("someone you blocked can't be put in a new group", /only add friends/.test(await fails(make("New", [B, MORE[1]]))));
await as(MORE[2]); await q("select public.block_user($1)", [A]);
await as(A); check("nor can someone who blocked you", /only add friends/.test(await fails(make("New", [B, MORE[2]]))));

console.log("9. Leaving");
await as(A); check("anyone can leave, even the person who made it", (await one("select public.leave_group($1)", [G])) === true);
await as(A); check("then it's gone from their list", (await groups()).length === 0);
await as(B); gl = await groups();
check("whoever has been in it longest takes over", gl[0].owner_id === B && gl[0].members.every((m) => m.user_id !== A), gl[0]);
check("the group says they left", (await lines(G)).includes("👥 left the group"));
await owner();
for (const m of (await q("select user_id from public.conversation_members where conversation_id = $1", [G])).map((r) => r.user_id)) { await as(m); await q("select public.leave_group($1)", [G]); }
await owner();
check("when the last person leaves, the group and its messages are gone", (await q("select 1 from public.conversations where id = $1", [G])).length === 0 && (await q("select 1 from public.messages where conversation_id = $1", [G])).length === 0);

console.log("10. Odds and ends");
await owner();
check("being added to a group arrives live", (await q("select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'conversation_members'")).length === 1);
await as(B);
check("the inner helpers can't be called directly", /permission denied/.test(await fails(q("select public.aura_group_note($1, $2, 'x')", [AB, B]))));
check("members can't be added by hand", /permission denied/.test(await fails(q("insert into public.conversation_members (conversation_id, user_id) values ($1, $2)", [AB, B]))));

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
