// Database rules for emoji reactions and voice messages (supabase/aura-messages-emoji-voice.sql), on a
// real Postgres (PGlite) with the same roles and auth.uid() that Supabase uses.
// Added by aura-messages-emoji-voice-setup.cjs.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import { fileURLToPath } from "url";
import nodePath from "path";

const HERE = nodePath.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(nodePath.join(HERE, ...p), "utf8");
const sql = (n) => read("..", "..", "supabase", n + ".sql");
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", C = "cccccccc-cccc-cccc-cccc-cccccccccccc", D = "dddddddd-dddd-dddd-dddd-dddddddddddd";
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
  insert into auth.users values ('${A}'), ('${B}'), ('${C}'), ('${D}');
  create table public.profiles (id uuid primary key references auth.users on delete cascade, username text unique not null, bio text, avatar_url text, created_at timestamptz default now());
  alter table public.profiles enable row level security;
  create policy "Logged-in users can view profiles" on public.profiles for select to authenticated using (true);
  insert into public.profiles (id, username) values ('${A}', 'tctray'), ('${B}', 'Alex'), ('${C}', 'Marcus'), ('${D}', 'Stranger');
`);
await db.exec(read("storage-fake.sql"));
for (const f of ["aura-messages", "aura-messages-media", "aura-messages-background", "aura-messages-safety", "aura-messages-reactions", "aura-messages-groups"]) await db.exec(sql(f));

const as = async (uid, role = "authenticated") => { await db.exec(`reset role; set test.uid = '${uid || ""}'; set role ${role};`); };
const owner = async () => { await db.exec(`reset role; set test.uid = '';`); };
const q = async (text, params) => (await db.query(text, params)).rows;
const one = async (text, params) => Object.values((await q(text, params))[0] || {})[0];
const fails = async (p) => { try { await p; return false; } catch (e) { return e.message; } };
const friends = async (x, y) => { await as(x); await q("select public.request_friend($1)", [y]); await as(y); await q("select public.request_friend($1)", [x]); };
const react = (m, f) => q("select public.react_to_message($1, $2) as r", [m, f]);
const uuid = () => crypto.randomUUID();
const upload = async (conv, ext, mime) => { const name = conv + "/" + uuid() + "." + ext; await q("insert into storage.objects (bucket_id, name, metadata) values ('message-media', $1, $2)", [name, { mimetype: mime }]); return name; };
const voice = async (conv, seconds, extra = {}) => {
  const name = extra.path || (await upload(conv, "weba", "audio/webm"));
  const row = { kind: "audio", mime: "audio/webm", size: 9000, ...extra };
  return (await q(`insert into public.messages (conversation_id, sender_id, content, media_path, media_kind, media_mime, media_size, media_seconds)
    values ($1, (select auth.uid()), '', $2, $3, $4, $5, $6) returning *`, [conv, name, row.kind, row.mime, row.size, seconds]))[0];
};

await friends(A, B);
await as(A);
const AB = await one("select public.open_conversation($1)", [B]);
const hi = (await q("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'gg') returning *", [AB, A]))[0];
// The project's bucket as it was before (only pictures and videos)
await owner();
await q("update storage.buckets set allowed_mime_types = array['image/png','image/jpeg','image/gif','image/webp','video/mp4','video/webm','video/quicktime'] where id = 'message-media'");

console.log("1. Before the update");
await as(B);
check("only 👍 and 👎 work", (await react(hi.id, "like"))[0].r === "like" && /isn't a reaction AURA knows/.test(await fails(react(hi.id, "love"))));

console.log("2. Running it");
await owner();
const file = sql("aura-messages-emoji-voice");
check("it runs", !(await fails(db.exec(file))), await fails(db.exec(file)));
check("...and again", !(await fails(db.exec(file))));
check("likes from before are kept", (await q("select reaction from public.message_reactions where message_id = $1", [hi.id]))[0]?.reaction === "like");
check("the private bucket now takes recordings (and still pictures and videos)", await one("select 'audio/webm' = any(allowed_mime_types) and 'image/png' = any(allowed_mime_types) and 'video/mp4' = any(allowed_mime_types) and not public from storage.buckets where id = 'message-media'"));

console.log("3. Emoji reactions");
await as(B);
for (const f of ["love", "laugh", "wow", "sad", "angry", "fire", "dislike", "like"]) await react(hi.id, f);
check("every emoji works, and you still have just one", (await q("select reaction from public.message_reactions where message_id = $1 and user_id = $2", [hi.id, B])).map((r) => r.reaction).join() === "like");
await react(hi.id, "fire");
check("changing to 🔥", (await q("select reaction from public.message_reactions where message_id = $1 and user_id = $2", [hi.id, B]))[0].reaction === "fire");
check("a made-up one is refused", /isn't a reaction AURA knows/.test(await fails(react(hi.id, "meh"))));
check("taking it back", (await react(hi.id, null))[0].r === null);
await owner();
check("nobody can write a made-up one straight into the table either", !!(await fails(q("insert into public.message_reactions (message_id, conversation_id, user_id, reaction) values ($1, $2, $3, 'meh')", [hi.id, AB, C]))));
await as(D);
check("a stranger can't react", /isn't in one of your conversations/.test(await fails(react(hi.id, "love"))));
// A group: an emoji from a member
await friends(A, C);
await as(A);
const G = await one("select public.create_group($1, $2)", ["Squad", [B, C]]);
const gm = (await q("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'in the group') returning *", [G, A]))[0];
await as(C);
check("in a group, members can use emoji too", (await q("select public.react_in_group($1, 'laugh') as r", [gm.id]))[0].r === "laugh" && /isn't a reaction AURA knows/.test(await fails(q("select public.react_in_group($1, 'meh')", [gm.id]))));

console.log("4. Voice messages");
await as(A);
const v = await voice(AB, 7);
check("a friend can send a 7-second recording", v.media_kind === "audio" && v.media_seconds === 7 && /\.weba$/.test(v.media_path));
await as(B);
check("...the other person sees it, with its length", (await q("select media_seconds, media_kind from public.messages where id = $1", [v.id]))[0]?.media_seconds === 7);
check("...and can open its file", (await q("select name from storage.objects where name = $1", [v.media_path])).length === 1);
await as(D);
check("a stranger can't see it or its file", (await q("select 1 from public.messages where id = $1", [v.id])).length === 0 && (await q("select 1 from storage.objects where name = $1", [v.media_path])).length === 0);
check("...or upload into that chat's folder", !!(await fails(upload(AB, "weba", "audio/webm"))));
await as(A);
check("longer than 2 minutes is refused", !!(await fails(voice(AB, 121))));
check("0 seconds is refused", !!(await fails(voice(AB, 0))));
check("a recording over 5 MB is refused", !!(await fails(voice(AB, 5, { size: 5242881 }))));
check("an audio message must be audio/webm", !!(await fails(voice(AB, 5, { mime: "audio/mpeg" }))));
{ const n = await upload(AB, "png", "image/png"); check("a picture can't carry a length", (await q("insert into public.messages (conversation_id, sender_id, content, media_path, media_kind, media_mime, media_size, media_seconds) values ($1, $2, '', $3, 'image', 'image/png', 100, 5) returning media_seconds", [AB, A, n]))[0].media_seconds === null); }
check("a recording from another chat's folder is refused", /doesn't belong/.test(await fails(voice(AB, 4, { path: G + "/" + uuid() + ".weba" }))));
check("pictures and videos still send", !(await fails((async () => { const n = await upload(AB, "mp4", "video/mp4"); await q("insert into public.messages (conversation_id, sender_id, content, media_path, media_kind, media_mime, media_size) values ($1, $2, '', $3, 'video', 'video/mp4', 1000)", [AB, A, n]); })())));
const gv = await voice(G, 3);
await as(C);
check("in a group, everyone can play it", (await q("select media_seconds from public.messages where id = $1", [gv.id]))[0]?.media_seconds === 3);
await as(B);
check("someone else can't delete your voice message", /only delete your own/.test(await fails(q("select public.delete_message($1)", [v.id]))));
await as(A);
await q("select public.delete_message($1)", [v.id]);
const gone = (await q("select media_path, media_seconds, deleted_at from public.messages where id = $1", [v.id]))[0];
check("deleting it clears the file and its length", gone.media_path === null && gone.media_seconds === null && !!gone.deleted_at);

await as(null, "anon");
check("signed out: can't react", !!(await fails(react(hi.id, "love"))));

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
