import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import { fileURLToPath } from "url";
import nodePath from "path";
// The SQL being checked is the project's own copy, in the supabase folder
const HERE = nodePath.dirname(fileURLToPath(import.meta.url));
const SQL = { messages: nodePath.join(HERE, "..", "..", "supabase", "aura-messages.sql"), media: nodePath.join(HERE, "..", "..", "supabase", "aura-messages-media.sql"), background: nodePath.join(HERE, "..", "..", "supabase", "aura-messages-background.sql"), safety: nodePath.join(HERE, "..", "..", "supabase", "aura-messages-safety.sql"), voice: nodePath.join(HERE, "..", "..", "supabase", "aura-messages-voice.sql"), storage: nodePath.join(HERE, "storage-fake.sql") };
const sql = fs.readFileSync(SQL.messages, "utf8");
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", C = "cccccccc-cccc-cccc-cccc-cccccccccccc", D = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const db = new PGlite();
// A stand-in for what Supabase provides, including its permissive default grants on new tables
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
  insert into public.profiles (id, username) values ('${A}', 'tctray'), ('${B}', 'Alex'), ('${C}', 'Stranger');
`);
await db.exec(sql);
await db.exec(sql); // must be safe to run twice

let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const as = async (uid, role = "authenticated") => { await db.exec(`reset role; set test.uid = '${uid || ""}'; set role ${role};`); };
const q = async (text, params) => (await db.query(text, params)).rows;
const one = async (text, params) => Object.values((await q(text, params))[0])[0];
const denied = async (text, params) => { try { await db.query(text, params); return false; } catch (e) { return e.message; } };

console.log("1. Friend requests");
await as(A);
check("A asks B: sent", await one("select public.request_friend($1)", [B]) === "sent");
check("asking again changes nothing", await one("select public.request_friend($1)", [B]) === "already_sent");
check("can't add yourself", /can't add yourself/.test(await denied("select public.request_friend($1)", [A])));
check("can't add someone with no AURA profile", /No AURA user/.test(await denied("select public.request_friend($1)", [D])));
check("can't insert a friendship directly", !!(await denied("insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'accepted')", [A, C])));
check("can't flip a request to accepted directly", !!(await denied("update public.friendships set status = 'accepted'")));
check("A can't accept their own request", /isn't waiting/.test(await denied("select public.accept_friend(id) from public.friendships")));
check("not friends yet", await one("select public.is_friend($1)", [B]) === false);
const reqId = await one("select id from public.friendships");
await as(C);
check("C can't see the request between A and B", (await q("select * from public.friendships")).length === 0);
check("C can't accept it", /isn't waiting/.test(await denied("select public.accept_friend($1)", [reqId])));
check("C can't delete it", (await db.query("delete from public.friendships where id = $1", [reqId])).affectedRows === 0);
await as(B);
let fl = await q("select * from public.list_friends()");
check("B sees it as an incoming request from tctray", fl.length === 1 && fl[0].state === "incoming" && fl[0].username === "tctray", fl);
check("B accepts", await one("select public.accept_friend($1)", [reqId]) === true);
await as(A);
fl = await q("select * from public.list_friends()");
check("A sees Alex as a friend", fl.length === 1 && fl[0].state === "friend" && fl[0].username === "Alex" && fl[0].user_id === B, fl);
check("asking again says already friends", await one("select public.request_friend($1)", [B]) === "already_friends");
check("still exactly one row for the pair", await (async () => { await db.exec("reset role"); return (await one("select count(*)::int from public.friendships")) === 1; })());
await as(C);
check("C asks A, then A asks C: that accepts it (no duplicate)", await one("select public.request_friend($1)", [A]) === "sent" && await (async () => { await as(A); return (await one("select public.request_friend($1)", [C])) === "accepted"; })());
await as(A); await db.query("delete from public.friendships where requester_id = $1", [C]); // A removes C again for the tests below

console.log("2. Conversations");
await as(A);
const conv = await one("select public.open_conversation($1)", [B]);
check("A opens a conversation with B", /^[0-9a-f-]{36}$/.test(conv));
check("opening it again gives the same one", await one("select public.open_conversation($1)", [B]) === conv);
await as(B);
check("B opening it gives the same one", await one("select public.open_conversation($1)", [A]) === conv);
await as(A);
check("can't open one with a non-friend", /only message friends/.test(await denied("select public.open_conversation($1)", [C])));
check("can't create a conversation directly", !!(await denied("insert into public.conversations (user_a, user_b) values ($1, $2)", [A, C])));
await as(C);
check("C can't see A and B's conversation", (await q("select * from public.conversations")).length === 0 && (await q("select * from public.list_conversations()")).length === 0);

console.log("3. Messages");
await as(A);
const m1 = (await q("insert into public.messages (conversation_id, sender_id, content, created_at, read_at) values ($1, $2, 'Are you playing tonight?', '2001-01-01', now()) returning *", [conv, A]))[0];
check("A sends a message", m1.content === "Are you playing tonight?");
check("can't back-date it or pre-mark it read", new Date(m1.created_at).getFullYear() >= 2026 && m1.read_at === null, m1);
check("can't send as someone else", /row-level security/.test(await denied("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'fake')", [conv, B])));
check("can't send an empty or blank message", !!(await denied("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, E'  \\n  ')", [conv, A])));
check("can't send a message over 4000 characters", !!(await denied("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, $3)", [conv, A, "x".repeat(4001)])));
check("multi-line and exactly 4000 characters are fine", !(await denied("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, $3)", [conv, A, "line one\n\nline three"])) && !(await q("select pg_sleep(0.005)")).x
  && !(await denied("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, $3)", [conv, A, "y".repeat(4000)]))); // (this test database's clock only counts milliseconds)
check("can't edit a message, even your own", !!(await denied("update public.messages set content = 'edited'")));
check("can't delete a message", !!(await denied("delete from public.messages")));
await as(C);
check("C reads nothing", (await q("select * from public.messages")).length === 0);
check("C can't read it by guessing the conversation id", (await q("select * from public.messages where conversation_id = $1", [conv])).length === 0);
check("C can't send into it", /row-level security/.test(await denied("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'hi')", [conv, C])));
check("C can't mark it read", /isn't your conversation/.test(await denied("select public.mark_conversation_read($1)", [conv])));
await as(B);
let lc = await q("select * from public.list_conversations()");
check("B sees 3 unread from tctray with the newest as preview", lc.length === 1 && lc[0].unread === 3 && lc[0].username === "tctray" && lc[0].last_message.startsWith("yyyy") && lc[0].last_message.length === 160 && lc[0].last_sender_id === A, lc.map((r) => ({ ...r, last_message: r.last_message?.slice(0, 8) })));
await db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'Yeah, around 8.')", [conv, B]);
check("B marks the conversation read (3 messages)", await one("select public.mark_conversation_read($1)", [conv]) === 3);
lc = await q("select * from public.list_conversations()");
check("B now has 0 unread", lc[0].unread === 0);
await as(A);
lc = await q("select * from public.list_conversations()");
check("A has 1 unread, and B's reply is the preview", lc[0].unread === 1 && lc[0].last_message === "Yeah, around 8." && lc[0].username === "Alex", lc);
check("B reading didn't mark B's own message as read for A", (await q("select read_at from public.messages where sender_id = $1", [B]))[0].read_at === null);
check("the conversation's last-message time was updated", (await q("select last_message_at from public.conversations"))[0].last_message_at !== null);

console.log("4. Online status");
await as(B); await db.query("select public.aura_heartbeat()");
await as(C); await db.query("select public.aura_heartbeat()");
await as(A);
check("A sees friend B's last-seen time", (await q("select * from public.list_friends()"))[0].last_seen_at !== null);
check("A can't see stranger C's", (await q("select * from public.user_presence where user_id = $1", [C])).length === 0);
check("can't fake someone's online status", !!(await denied("insert into public.user_presence (user_id) values ($1)", [C])) && !!(await denied("update public.user_presence set last_seen_at = now()")));

console.log("5. After unfriending");
await as(B);
check("B removes A as a friend", (await db.query("delete from public.friendships where id = $1", [reqId])).affectedRows === 1);
await as(A);
check("A can no longer send", /row-level security/.test(await denied("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'hello?')", [conv, A])));
check("but both can still read the history", (await q("select * from public.messages")).length === 4);
check("the list shows they're no longer friends", (await q("select * from public.list_conversations()"))[0].is_friend === false);

console.log("6. Not logged in");
await as("", "anon");
for (const t of ["friendships", "conversations", "messages", "user_presence"]) check(`${t}: no access`, /permission denied/.test(await denied(`select * from public.${t}`)));
check("functions: no access", /permission denied/.test(await denied("select public.list_conversations()")) && /permission denied/.test(await denied("select public.request_friend($1)", [A])));

console.log("7. Sending too fast");
await db.exec("reset role"); await db.query("insert into public.friendships (requester_id, addressee_id, status) values ($1, $2, 'accepted')", [A, B]);
await as(A);
let sent = 0, stopped = "";
for (let i = 0; i < 30 && !stopped; i++) { const e = await denied("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, $3)", [conv, A, "spam " + i]); if (e) stopped = e; else sent++; }
check("a flood is stopped after about 20 messages in 10 seconds", sent <= 20 && /too quickly/.test(stopped), [sent, stopped]);

await db.exec("reset role");
const pub = await q("select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1");
console.log("live updates on:", pub.map((r) => r.tablename).join(", "));
console.log(failed ? "\n" + failed + " FAILED" : "\nall passed");
process.exit(failed ? 1 : 0);
