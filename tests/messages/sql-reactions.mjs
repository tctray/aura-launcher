import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import { fileURLToPath } from "url";
import nodePath from "path";
// The SQL being checked is the project's own copy, in the supabase folder
const HERE = nodePath.dirname(fileURLToPath(import.meta.url));
const SQL = { messages: nodePath.join(HERE, "..", "..", "supabase", "aura-messages.sql"), media: nodePath.join(HERE, "..", "..", "supabase", "aura-messages-media.sql"), background: nodePath.join(HERE, "..", "..", "supabase", "aura-messages-background.sql"), safety: nodePath.join(HERE, "..", "..", "supabase", "aura-messages-safety.sql"), voice: nodePath.join(HERE, "..", "..", "supabase", "aura-messages-voice.sql"), reactions: nodePath.join(HERE, "..", "..", "supabase", "aura-messages-reactions.sql"), storage: nodePath.join(HERE, "storage-fake.sql") };
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", C = "cccccccc-cccc-cccc-cccc-cccccccccccc", D = "dddddddd-dddd-dddd-dddd-dddddddddddd";
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
await db.exec(fs.readFileSync(SQL.storage, "utf8"));
await db.exec(fs.readFileSync(SQL.messages, "utf8"));
await db.exec(fs.readFileSync(SQL.media, "utf8"));
await db.exec(fs.readFileSync(SQL.background, "utf8"));
await db.exec(fs.readFileSync(SQL.safety, "utf8"));
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const as = async (uid, role = "authenticated") => { await db.exec(`reset role; set test.uid = '${uid || ""}'; set role ${role};`); };
const owner = async () => { await db.exec(`reset role; set test.uid = '';`); };
const q = async (text, params) => (await db.query(text, params)).rows;
const one = async (text, params) => Object.values((await q(text, params))[0])[0];
const fails = async (p) => { try { await p; return false; } catch (e) { return e.message; } };
const uuid = () => crypto.randomUUID();
const tick = () => q("select pg_sleep(0.004)");
const say = async (conv, who, text) => { await tick(); return (await q("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, $3) returning *", [conv, who, text]))[0]; };
const friends = async (x, y) => { await as(x); await q("select public.request_friend($1)", [y]); await as(y); return one("select public.request_friend($1)", [x]); };
const react = (message, feeling) => db.query("select public.react_to_message($1, $2) as r", [message, feeling]);
const all = async (message) => { await owner(); return q("select user_id, reaction, conversation_id from public.message_reactions where message_id = $1 order by user_id", [message]); };

// Conversations with history from before this update
await friends(A, B); await friends(A, C);
await as(A);
const AB = await one("select public.open_conversation($1)", [B]);
const AC = await one("select public.open_conversation($1)", [C]);
const m1 = await say(AB, A, "did you see the trailer?");
await as(B); const m2 = await say(AB, B, "looks great");
await as(A); const mc = await say(AC, A, "for Marcus only");

await owner();
const sql = fs.readFileSync(SQL.reactions, "utf8");
await db.exec(sql);
await db.exec(sql); // must be safe to run twice
await db.exec(fs.readFileSync(SQL.messages, "utf8")); await db.exec(fs.readFileSync(SQL.media, "utf8")); await db.exec(fs.readFileSync(SQL.safety, "utf8")); await db.exec(sql);

console.log("1. Liking and disliking");
await as(B);
check("you can like a friend's message", (await react(m1.id, "like")).rows[0].r === "like");
let rows = await all(m1.id);
check("it is saved as yours, in the message's own conversation", rows.length === 1 && rows[0].user_id === B && rows[0].reaction === "like" && rows[0].conversation_id === AB, rows);
await as(B);
check("changing it to a dislike replaces it", (await react(m1.id, "dislike")).rows[0].r === "dislike");
rows = await all(m1.id);
check("still one per person per message", rows.length === 1 && rows[0].reaction === "dislike", rows);
await as(A);
check("you can react to your own message too", !(await fails(react(m1.id, "like"))));
rows = await all(m1.id);
check("each person's is kept separately", rows.length === 2 && rows.find((x) => x.user_id === A).reaction === "like" && rows.find((x) => x.user_id === B).reaction === "dislike", rows);
await as(B);
check("taking yours back works", (await react(m1.id, null)).rows[0].r === null);
rows = await all(m1.id);
check("it leaves the other person's alone", rows.find((x) => x.user_id === B).reaction === null && rows.find((x) => x.user_id === A).reaction === "like", rows);
await as(B);
check("taking back something you never added is harmless, and saves nothing", !(await fails(react(m2.id, null))) && (await all(m2.id)).length === 0);
await as(B);
check("only like and dislike exist", /isn't a reaction AURA knows/.test(await fails(react(m1.id, "love"))) && /isn't a reaction AURA knows/.test(await fails(react(m1.id, ""))));
check("a made-up message is refused", /isn't in one of your conversations/.test(await fails(react(uuid(), "like"))));

console.log("2. Only the two people in the conversation");
await as(C);
check("someone outside the conversation can't react to a message in it", /isn't in one of your conversations/.test(await fails(react(m1.id, "like"))));
check("or see who reacted", (await q("select * from public.message_reactions where message_id = $1", [m1.id])).length === 0);
await as(D);
check("a stranger can't either", /isn't in one of your conversations/.test(await fails(react(m1.id, "dislike"))) && (await q("select * from public.message_reactions")).length === 0);
await as(null, "anon");
check("not logged in: can't react or read", !!(await fails(react(m1.id, "like"))) && !!(await fails(q("select * from public.message_reactions"))));
await as("");
check("logged in as nobody: refused", /not logged in/.test(await fails(react(m1.id, "like"))));
await as(B);
check("both people in the conversation can see them", (await q("select * from public.message_reactions where message_id = $1 and reaction is not null", [m1.id])).length === 1);
await as(A);
check("you only see the ones in your own conversations", (await q("select distinct conversation_id from public.message_reactions")).every((x) => x.conversation_id === AB || x.conversation_id === AC));

console.log("3. Nobody can write to the table directly");
await as(B);
check("can't add one by hand (so it can't be put under someone else's name)", /permission denied/.test(await fails(db.query("insert into public.message_reactions (message_id, conversation_id, user_id, reaction) values ($1, $2, $3, 'like')", [m1.id, AB, A]))));
check("can't change someone else's", /permission denied/.test(await fails(db.query("update public.message_reactions set reaction = 'dislike' where message_id = $1", [m1.id]))));
check("can't remove someone else's", /permission denied/.test(await fails(db.query("delete from public.message_reactions where message_id = $1", [m1.id]))));
rows = await all(m1.id);
check("nothing changed", rows.find((x) => x.user_id === A).reaction === "like", rows);

console.log("4. Deleted messages");
await as(B); await react(m1.id, "like");
await as(A); await db.query("select public.delete_message($1)", [m1.id]);
rows = await all(m1.id);
check("deleting a message clears everything that was on it", rows.length === 2 && rows.every((x) => x.reaction === null), rows);
await as(B);
check("a deleted message can't be reacted to", /was deleted/.test(await fails(react(m1.id, "like"))));

console.log("5. Friends only");
await as(C); await react(mc.id, "like");
await as(A);
await db.query("delete from public.friendships where least(requester_id, addressee_id) = least($1::uuid, $2::uuid) and greatest(requester_id, addressee_id) = greatest($1::uuid, $2::uuid)", [A, C]);
await as(C);
check("after you stop being friends you can't add or change one", /only react to messages from friends/.test(await fails(react(mc.id, "dislike"))));
check("but you can still take yours back", !(await fails(react(mc.id, null))) && (await all(mc.id)).every((x) => x.reaction === null));
await as(A); await db.query("select public.block_user($1)", [B]);
await as(B);
check("someone you blocked can't react to your messages", /only react to messages from friends/.test(await fails(react(m2.id, "like"))));
await as(A);
check("and you can't react to theirs while they're blocked", /only react to messages from friends/.test(await fails(react(m2.id, "like"))));
await db.query("select public.unblock_user($1)", [B]);
check("friends again: it works again", (await friends(A, B)) === "accepted" && (await as(A), !(await fails(react(m2.id, "like")))));

console.log("6. Limits");
await as(A);
const many = [];
for (let i = 0; i < 31; i++) {
  if (i % 15 === 0) { await owner(); await db.exec("update public.messages set created_at = created_at - interval '1 minute'"); await as(A); } // (messages have a speed limit of their own)
  many.push((await say(AB, A, "message " + i)).id);
}
await owner(); await db.exec("update public.message_reactions set updated_at = now() - interval '1 minute'");
await as(B);
let refused = "";
let accepted = 0;
for (const id of many) { const e = await fails(react(id, "like")); if (e) { refused = e; break; } accepted++; }
check("a burst is stopped after 30 in ten seconds", accepted === 30 && /too quickly/.test(refused), [accepted, refused]);
await owner(); await db.exec("update public.message_reactions set updated_at = now() - interval '1 minute'");
await as(B);
check("and works again after a pause", !(await fails(react(many[30], "like"))));

console.log("7. Setup");
await owner();
check("likes arrive live", Number(await one("select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'message_reactions'")) === 1);
check("one viewing rule, and no rules that allow writing", Number(await one("select count(*) from pg_policies where schemaname = 'public' and tablename = 'message_reactions'")) === 1 && (await one("select cmd from pg_policies where schemaname = 'public' and tablename = 'message_reactions'")) === "SELECT");
check("the table can only be read, never written, by signed-in users", (await q("select privilege_type from information_schema.role_table_grants where table_name = 'message_reactions' and grantee = 'authenticated'")).map((x) => x.privilege_type).join() === "SELECT" && (await q("select 1 from information_schema.role_table_grants where table_name = 'message_reactions' and grantee = 'anon'")).length === 0);
check("removing a message for good removes what was on it", await (async () => { const n = Number(await one("select count(*) from public.message_reactions where message_id = $1", [many[0]])); await db.query("delete from public.messages where id = $1", [many[0]]); return n === 1 && Number(await one("select count(*) from public.message_reactions where message_id = $1", [many[0]])) === 0; })());
check("the messages from before the update are all still there", Number(await one("select count(*) from public.messages where conversation_id = $1", [AB])) >= 32);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
