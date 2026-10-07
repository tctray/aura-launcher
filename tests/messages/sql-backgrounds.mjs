import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import { fileURLToPath } from "url";
import nodePath from "path";
// The SQL being checked is the project's own copy, in the supabase folder
const HERE = nodePath.dirname(fileURLToPath(import.meta.url));
const SQL = { messages: nodePath.join(HERE, "..", "..", "supabase", "aura-messages.sql"), media: nodePath.join(HERE, "..", "..", "supabase", "aura-messages-media.sql"), background: nodePath.join(HERE, "..", "..", "supabase", "aura-messages-background.sql"), safety: nodePath.join(HERE, "..", "..", "supabase", "aura-messages-safety.sql"), voice: nodePath.join(HERE, "..", "..", "supabase", "aura-messages-voice.sql"), storage: nodePath.join(HERE, "storage-fake.sql") };
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
const bgSql = fs.readFileSync(SQL.background, "utf8");
await db.exec(bgSql);
await db.exec(bgSql); // must be safe to run twice

let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const as = async (uid, role = "authenticated") => { await db.exec(`reset role; set test.uid = '${uid || ""}'; set role ${role};`); };
const owner = async () => { await db.exec(`reset role; set test.uid = '';`); };
const q = async (text, params) => (await db.query(text, params)).rows;
const one = async (text, params) => Object.values((await q(text, params))[0])[0];
const fails = async (p) => { try { await p; return false; } catch (e) { return e.message; } };
const uuid = () => crypto.randomUUID();
const upload = (path, who) => db.query("insert into storage.objects (bucket_id, name, owner, owner_id) values ('message-media', $1, $2::uuid, $3)", [path, who, who]);
const setBg = (conv, path) => db.query("select public.set_conversation_background($1, $2)", [conv, path]);
const seen = async () => q("select conversation_id, path, set_by from public.conversation_backgrounds order by conversation_id");

await as(A); await q("select public.request_friend($1)", [B]); await q("select public.request_friend($1)", [C]);
await as(B); await q("select public.request_friend($1)", [A]);
await as(C); await q("select public.request_friend($1)", [A]);
await as(A);
const AB = await one("select public.open_conversation($1)", [B]);
const AC = await one("select public.open_conversation($1)", [C]);

console.log("1. Setting a background");
const p1 = `${AB}/${uuid()}.jpg`; await upload(p1, A);
check("a person in the chat can set it", !(await fails(setBg(AB, p1))));
check("they see it, with who set it", JSON.stringify(await seen()) === JSON.stringify([{ conversation_id: AB, path: p1, set_by: A }]), await seen());
await as(B);
check("the other person sees the same one", JSON.stringify(await seen()) === JSON.stringify([{ conversation_id: AB, path: p1, set_by: A }]), await seen());
check("and can open the picture file", (await q("select 1 from storage.objects where name = $1", [p1])).length === 1);
const p2 = `${AB}/${uuid()}.png`; await upload(p2, B);
check("the other person can change it", !(await fails(setBg(AB, p2))) && (await seen())[0].path === p2 && (await seen())[0].set_by === B);
check("still one row for the chat, not two", Number(await one("select count(*) from public.conversation_backgrounds")) === 1);

console.log("2. People outside the chat");
await as(C);
check("a friend of only one of them sees nothing", (await seen()).filter((r) => r.conversation_id === AB).length === 0);
check("and can't set it", /isn't your conversation/.test(await fails(setBg(AB, p2))));
check("and can't remove it", /isn't your conversation/.test(await fails(setBg(AB, null))));
await as(D);
check("a stranger sees nothing and can't set it", (await seen()).length === 0 && /isn't your conversation/.test(await fails(setBg(AB, p1))));
await as(null, "anon");
check("not logged in: can't see or set", !!(await fails(db.query("select * from public.conversation_backgrounds"))) && !!(await fails(setBg(AB, p1))));

console.log("3. Only real pictures from this chat");
await as(A);
check("a picture that was never uploaded is refused", /wasn't uploaded/.test(await fails(setBg(AB, `${AB}/${uuid()}.jpg`))));
const pc = `${AC}/${uuid()}.jpg`; await upload(pc, A);
check("a picture from another of your chats is refused", /doesn't belong/.test(await fails(setBg(AB, pc))));
check("a path that climbs out of the folder is refused", /doesn't belong/.test(await fails(setBg(AB, `${AB}/../${AC}/${uuid()}.jpg`))));
const pv = `${AB}/${uuid()}.mp4`; await upload(pv, A);
const pg = `${AB}/${uuid()}.gif`; await upload(pg, A);
check("a video or GIF can't be a background", /doesn't belong/.test(await fails(setBg(AB, pv))) && /doesn't belong/.test(await fails(setBg(AB, pg))));
check("a web address can't be slipped in", /doesn't belong/.test(await fails(setBg(AB, "https://example.com/x.jpg"))));
check("none of those changed anything", (await seen()).find((r) => r.conversation_id === AB).path === p2);

console.log("4. Nobody edits the table directly");
check("can't insert", /permission denied/.test(await fails(db.query("insert into public.conversation_backgrounds (conversation_id, path) values ($1, 'x')", [AC]))));
check("can't update", /permission denied/.test(await fails(db.query("update public.conversation_backgrounds set path = 'x'"))));
check("can't delete", /permission denied/.test(await fails(db.query("delete from public.conversation_backgrounds"))));

console.log("5. Removing, and after unfriending");
check("either person can remove it", !(await fails(setBg(AB, null))));
const after = (await seen()).find((r) => r.conversation_id === AB);
check("the row stays with an empty path (so the other AURA is told)", after && after.path === null && after.set_by === A, after);
await setBg(AB, p1);
await q("delete from public.friendships where least(requester_id, addressee_id) = least($1::uuid, $2::uuid) and greatest(requester_id, addressee_id) = greatest($1::uuid, $2::uuid)", [A, B]);
const p3 = `${AB}/${uuid()}.jpg`;
check("no longer friends: can't upload a new picture", /row-level security/.test(await fails(upload(p3, A))));
check("or set one that's already there", /only set a background for a chat with a friend/.test(await fails(setBg(AB, p2))));
check("but can still remove the current one", !(await fails(setBg(AB, null))) && (await seen()).find((r) => r.conversation_id === AB).path === null);

console.log("6. Setup");
await owner();
check("live updates include the new table", Number(await one("select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'conversation_backgrounds'")) === 1);
check("one rule on the table after running the file twice", Number(await one("select count(*) from pg_policies where tablename = 'conversation_backgrounds'")) === 1);
await db.exec(fs.readFileSync(SQL.messages, "utf8")); await db.exec(fs.readFileSync(SQL.media, "utf8")); await db.exec(bgSql);
check("running all three files again breaks nothing", Number(await one("select count(*) from public.conversation_backgrounds")) === 1);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
