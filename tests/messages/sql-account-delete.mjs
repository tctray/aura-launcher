// Database rules for deleting your account (supabase/aura-account-delete.sql), checked on a real
// Postgres (PGlite) with the same roles and auth.uid() that Supabase uses.
// Added by aura-account-delete-setup.cjs.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import nodePath from "path";

const HERE = nodePath.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(nodePath.join(HERE, ...p), "utf8");
const sql = (name) => read("..", "..", "supabase", name);
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
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
  create table public.profiles (id uuid primary key references auth.users, username text unique not null, bio text, avatar_url text, created_at timestamptz default now());
  alter table public.profiles enable row level security;
  create policy "Logged-in users can view profiles" on public.profiles for select to authenticated using (true);
  -- What AURA saves online, as made in the Supabase dashboard (no link to the account, so nothing cascades)
  create table public.user_games (user_id uuid not null, game_key text not null, primary key (user_id, game_key));
  create table public.user_data (user_id uuid not null, key text not null, value jsonb, primary key (user_id, key));
  create table public.user_sessions (user_id uuid not null, id text not null, primary key (user_id, id));
`);
for (const [id, name] of [[A, "tctray"], [B, "Alex"], [C, "Marcus"]]) {
  await db.query("insert into auth.users values ($1)", [id]);
  await db.query("insert into public.profiles (id, username) values ($1, $2)", [id, name]);
  for (const t of ["user_games (user_id, game_key)", "user_data (user_id, key)", "user_sessions (user_id, id)"]) await db.query(`insert into public.${t} values ($1, 'x')`, [id]);
}
await db.exec(read("storage-fake.sql"));
for (const f of ["aura-messages.sql", "aura-messages-media.sql", "aura-messages-background.sql", "aura-messages-safety.sql", "aura-messages-reactions.sql", "aura-messages-voice.sql", "aura-messages-groups.sql", "aura-calls-group.sql", "aura-messages-links.sql", "aura-avatars.sql"]) await db.exec(sql(f));

const as = async (uid) => { await db.exec(`reset role; set test.uid = '${uid || ""}'; set role ${uid ? "authenticated" : "anon"};`); };
const owner = async () => { await db.exec(`reset role; set test.uid = '';`); };
const q = async (text, params) => (await db.query(text, params)).rows;
const one = async (text, params) => Object.values((await q(text, params))[0] || {})[0];
const fails = async (p) => { try { await p; return false; } catch (e) { return e.message; } };
const count = async (text, params) => { await owner(); return Number(await one(`select count(*) from ${text}`, params)); };
const friends = async (x, y) => { await as(x); await q("select public.request_friend($1)", [y]); await as(y); await q("select public.request_friend($1)", [x]); };
const say = async (conv, who, text) => { await as(who); return (await q("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, $3) returning id", [conv, who, text]))[0].id; };
const pic = async (conv, who) => {
  const p = conv + "/" + crypto.randomUUID() + ".png";
  await owner(); await q("insert into storage.objects (bucket_id, name, owner, owner_id) values ('message-media', $1, $2::uuid, $3)", [p, who, who]);
  await as(who); await q("insert into public.messages (conversation_id, sender_id, content, media_path, media_kind, media_mime, media_size, media_name) values ($1, $2, '', $3, 'image', 'image/png', 500, 'a.png')", [conv, who, p]);
  return p;
};

console.log("1. Setting it up");
await owner();
const fresh = new PGlite();
await fresh.exec("create schema auth; create table auth.users (id uuid primary key); create function auth.uid() returns uuid language sql as $$ select null::uuid $$;");
check("needs the messages files first, and says so", /Run the other messages files first/.test(await fails(fresh.exec(sql("aura-account-delete.sql")))));
await db.exec(sql("aura-account-delete.sql"));
await db.exec(sql("aura-account-delete.sql")); // safe to run twice

// tctray has friends, chats, pictures, a group, likes, a block and a report against them
await friends(A, B); await friends(A, C); await friends(B, C);
await as(A); const AB = await one("select public.open_conversation($1)", [B]);
await as(B); const BC = await one("select public.open_conversation($1)", [C]);
const fromA = await say(AB, A, "hey Alex");
const fromB = await say(AB, B, "hi!");
await say(BC, B, "Marcus, hi");
const picA = await pic(AB, A), picB = await pic(AB, B);
await as(A); const G = await one("select public.create_group($1, $2::uuid[])", ["Squad", [B, C]]);
const inGroup = await say(G, A, "squad up");
const keptInGroup = await say(G, B, "on my way");
const picReported = await pic(G, A);
await as(A); const solo = await one("select public.create_group($1, $2::uuid[])", ["Just me", [B]]);
await as(B); await q("select public.leave_group($1)", [solo]);
await as(B); await q("select public.react_to_message($1, 'like')", [fromA]);
await as(C); await q("select public.report_in_group($1, 'spam', null, (select id from public.messages where media_path = $2))", [A, picReported]);
await owner(); await q("insert into storage.objects (bucket_id, name, owner, owner_id) values ('avatars', $1, $2::uuid, $3), ('avatars', $4, $5::uuid, $6)", [A + "/me.png", A, A, B + "/alex.png", B, B]);

console.log("2. The files that belong to you");
await as(A);
const files = await q("select * from public.account_files()");
const names = files.map((f) => f.bucket + "/" + f.path).sort();
check("your profile picture and the pictures you sent are listed", names.includes("avatars/" + A + "/me.png") && names.includes("message-media/" + picA), names);
check("...but not other people's", !names.includes("message-media/" + picB) && !names.some((n) => n.includes("alex.png")), names);
check("...nor one that was reported (it is kept for review)", !names.includes("message-media/" + picReported), names);
await as(null);
check("someone who isn't logged in can't list anything", !!(await fails(q("select * from public.account_files()"))));
check("...or delete anything", !!(await fails(q("select public.delete_my_account()"))));

console.log("3. Something AURA doesn't know about stops it, and nothing is deleted");
await owner(); await db.exec("create table public.mystery (owner uuid references auth.users(id)); grant all on public.mystery to authenticated;"); await q("insert into public.mystery values ($1)", [A]);
await as(A);
const refused = await fails(q("select public.delete_my_account()"));
check("it says so in plain words", /couldn't be deleted because of something saved to it that AURA doesn't know about.*Nothing was deleted/.test(refused), refused);
check("...and everything is still there", (await count("auth.users where id = $1", [A])) === 1 && (await count("public.user_games where user_id = $1", [A])) === 1 && (await count("public.messages where sender_id = $1", [A])) > 0 && (await count("public.profiles where id = $1", [A])) === 1);
await owner(); await db.exec("drop table public.mystery");

console.log("4. Deleting");
await as(A);
check("you can delete your own account", (await one("select public.delete_my_account()")) === true);
check("the account is gone", (await count("auth.users where id = $1", [A])) === 0 && (await count("public.profiles where id = $1", [A])) === 0);
check("...with the library, settings and sessions saved online", (await count("public.user_games where user_id = $1", [A])) + (await count("public.user_data where user_id = $1", [A])) + (await count("public.user_sessions where user_id = $1", [A])) === 0);
check("...friends, and messages you sent", (await count("public.friendships where requester_id = $1 or addressee_id = $1", [A])) === 0 && (await count("public.messages where sender_id = $1", [A])) === 0);
check("...your one-to-one chats", (await count("public.conversations where id = $1", [AB])) === 0 && (await count("public.messages where id = $1", [fromB])) === 0);
check("...and likes on your messages", (await count("public.message_reactions where message_id = $1", [fromA])) === 0);
check("a group carries on for the others, without your messages", (await count("public.conversations where id = $1", [G])) === 1 && (await count("public.conversation_members where conversation_id = $1", [G])) === 2 && (await count("public.messages where id = $1", [inGroup])) === 0 && (await count("public.messages where id = $1", [keptInGroup])) === 1);
check("a group nobody is left in is removed", (await count("public.conversations where id = $1", [solo])) === 0);
check("a report about you is kept, with the reported picture", (await count("public.reports where message_media_path = $1 and reported_id is null", [picReported])) === 1);
check("other people's chats, accounts and saved data are untouched", (await count("public.conversations where id = $1", [BC])) === 1 && (await count("auth.users")) === 2 && (await count("public.user_games")) === 2 && (await count("public.friendships")) === 1);
await as(B);
check("nobody can delete someone else's account (it only ever deletes your own)", (await one("select public.delete_my_account()")) === true && (await count("auth.users where id = $1", [C])) === 1 && (await count("auth.users where id = $1", [B])) === 0);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
