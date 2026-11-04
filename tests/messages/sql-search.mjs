// Database rules for message search and friend streaks (supabase/aura-messages-search.sql), on a
// real Postgres (PGlite) with the same roles and auth.uid() that Supabase uses: only chats you're
// in are searched, deleted messages are never found, and streaks count days you both took part.
// Added by aura-messages-search-setup.cjs.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import { fileURLToPath } from "url";
import nodePath from "path";

const HERE = nodePath.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(nodePath.join(HERE, ...p), "utf8");
const sql = (n) => read("..", "..", "supabase", n + ".sql");
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const D = "dddddddd-dddd-dddd-dddd-dddddddddddd", E = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", F = "ffffffff-ffff-ffff-ffff-ffffffffffff";
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
await db.exec(read("storage-fake.sql"));
for (const f of ["aura-messages", "aura-messages-media", "aura-messages-background", "aura-messages-safety", "aura-messages-reactions", "aura-messages-groups", "aura-messages-voice", "aura-calls-group"]) await db.exec(sql(f));
const search = sql("aura-messages-search");
await db.exec(search);
await db.exec(search); // safe to run again

const as = async (uid, role = "authenticated") => { await db.exec(`reset role; set test.uid = '${uid || ""}'; set role ${role};`); };
const owner = async () => { await db.exec(`reset role; set test.uid = '';`); };
const q = async (text, params) => (await db.query(text, params)).rows;
const one = async (text, params) => Object.values((await q(text, params))[0] || {})[0];
const fails = async (p) => { try { await p; return false; } catch (e) { return e.message; } };
const friends = async (x, y) => { await as(x); await q("select public.request_friend($1)", [y]); await as(y); await q("select public.request_friend($1)", [x]); };
const chat = async (x, y) => { await as(x); return one("select public.open_conversation($1)", [y]); };
// A message from someone, so many days ago (0 = today), at noon UTC
// (AURA's database sets a new message's time itself, so the test moves it afterwards)
let order = 0;
const say = async (cid, who, text, daysAgo = 0, deleted = false) => {
  const mid = await one("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, $3) returning id", [cid, who, text]);
  await q(`update public.messages set created_at = date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' - make_interval(days => $2::int) + interval '12 hours' + make_interval(secs => $3::int),
           deleted_at = case when $4::boolean then now() end where id = $1`, [mid, daysAgo, ++order, deleted]);
};
const found = async (words, conv = null, before = null) => (await q("select content from public.search_my_messages($1, $2, $3)", [words, conv, before])).map((r) => r.content);

await friends(A, B); await friends(A, C); await friends(A, E); await friends(A, F); await friends(B, C);
const AB = await chat(A, B), AC = await chat(A, C), AE = await chat(A, E), AF = await chat(A, F), BC = await chat(B, C);
await as(A);
const G = await one("select public.create_group($1, $2)", ["Squad", [B, C]]);
await owner();
// a chat with someone who isn't a friend (from before they were removed)
const AD = await one("insert into public.conversations (user_a, user_b) values ($1, $2) returning id", [A < D ? A : D, A < D ? D : A]);

console.log("1. Searching your messages");
await owner();
await say(AB, A, "you on tonight for some ranked?", 2);
await say(AB, B, "Ranked at 9, bring snacks", 1);
await say(AB, B, "that ranked game was wild", 0, true); // deleted
await say(AC, C, "ranked later?", 1);
await say(BC, B, "secret ranked plan between Alex and Marcus", 1);
await say(G, C, "group ranked night!", 0);
await say(AB, A, "I got 100% on the quiz", 0);
await say(AB, A, "I got 1000 on the quiz", 0);
await as(A);
let r = await found("ranked");
check("finds the word in all your chats, any capital letters, newest first", JSON.stringify(r) === JSON.stringify(["group ranked night!", "ranked later?", "Ranked at 9, bring snacks", "you on tonight for some ranked?"]), r);
check("...including group chats you're in", r.includes("group ranked night!"));
check("...never other people's chats", !r.some((x) => x.includes("secret")));
check("...and never deleted messages", !r.some((x) => x.includes("wild")));
check("searching only one chat", JSON.stringify(await found("ranked", AB)) === JSON.stringify(["Ranked at 9, bring snacks", "you on tonight for some ranked?"]));
check("% and _ are searched for as themselves", JSON.stringify(await found("100%")) === JSON.stringify(["I got 100% on the quiz"]));
check("one letter finds nothing (too short)", (await found("r")).length === 0 && (await found("  ")).length === 0);
check("a very long search is refused", !!(await fails(found("x".repeat(101)))));
const newest = (await q("select created_at from public.search_my_messages('ranked', null, null)"))[1].created_at;
check("older results, a page at a time", JSON.stringify(await found("ranked", null, newest)) === JSON.stringify(["Ranked at 9, bring snacks", "you on tonight for some ranked?"]));
await as(B);
check("someone else searching sees only their own chats", JSON.stringify(await found("ranked")) === JSON.stringify(["group ranked night!", "secret ranked plan between Alex and Marcus", "Ranked at 9, bring snacks", "you on tonight for some ranked?"]), await found("ranked"));
await as(D);
check("a stranger finds nothing of yours", (await found("ranked")).length === 0 && (await found("quiz")).length === 0);
await as(null, "anon");
check("signed out: no searching", !!(await fails(found("ranked"))));

console.log("2. Friend streaks");
await owner();
await q("delete from public.messages");
for (const d of [2, 1, 0]) { await say(AB, A, "hi", d); await say(AB, B, "hey", d); }      // Alex: 3 days, today counts
for (const d of [3, 2, 1]) { await say(AC, A, "yo", d); await say(AC, C, "yo", d); }       // Marcus: 3 days, not today yet
for (const d of [3, 2, 1, 0]) await say(AE, A, "anyone?", d);                              // Jordan never answers
for (const d of [6, 5, 1]) { await say(AF, A, "x", d); await say(AF, F, "y", d); }       // Sam: a gap, so only yesterday counts
for (const d of [1, 0]) { await say(AD, A, "a", d); await say(AD, D, "b", d); }           // not a friend
await as(A);
const streaks = async (tz = "UTC") => Object.fromEntries((await q("select * from public.friend_streaks($1)", [tz])).map((x) => [x.user_id, [x.days, x.today]]));
let st = await streaks();
check("days you both messaged in a row, today included", JSON.stringify(st[B]) === JSON.stringify([3, true]), st);
check("...a streak that hasn't counted today yet is still on (and can be saved today)", JSON.stringify(st[C]) === JSON.stringify([3, false]));
check("only one of you messaging doesn't count", !(E in st));
check("a missed day starts it again", JSON.stringify(st[F]) === JSON.stringify([1, false]));
check("people who aren't friends have no streak", !(D in st));
await owner();
await q("insert into public.voice_calls (caller_id, callee_id, status, created_at, answered_at, ended_at) values ($1, $2, 'ended', now(), now(), now())", [E, A]);
await as(A);
st = await streaks();
check("a call you both were in counts as messaging that day", JSON.stringify(st[E]) === JSON.stringify([1, true]), st[E]);
await owner();
await q("insert into public.voice_calls (caller_id, callee_id, status, end_reason, created_at, ended_at) values ($1, $2, 'ended', 'missed', now() - interval '2 days', now() - interval '2 days')", [F, A]);
await as(A);
check("...a missed call doesn't", JSON.stringify((await streaks())[F]) === JSON.stringify([1, false]));
await owner();
await q("delete from public.messages where conversation_id = $1 and created_at >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC') - interval '1 day'", [AC]);
await as(A);
check("two days without both of you: the streak is gone", !(C in (await streaks())));
check("any time zone works; a made-up one counts in UTC", JSON.stringify((await streaks("America/Los_Angeles"))[B] !== undefined) === "true" && JSON.stringify(await streaks("Not/AZone")) === JSON.stringify(await streaks("UTC")));
await as(B);
st = await streaks();
check("your friend sees the same streak with you", JSON.stringify(st[A]) === JSON.stringify([3, true]));
check("...but never your streaks with others", !(C in st) && !(E in st));
await as(null, "anon");
check("signed out: none", !!(await fails(streaks())));

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
