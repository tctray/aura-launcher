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

let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const as = async (uid, role = "authenticated") => { await db.exec(`reset role; set test.uid = '${uid || ""}'; set role ${role};`); };
const owner = async () => { await db.exec(`reset role; set test.uid = '';`); };
const q = async (text, params) => (await db.query(text, params)).rows;
const one = async (text, params) => Object.values((await q(text, params))[0])[0];
const denied = async (text, params) => { try { const r = await db.query(text, params); return r.affectedRows === 0 && !/^\s*insert/i.test(text) ? "no rows" : false; } catch (e) { return e.message; } };

// Friends and conversations made before the media update, with a message already in place
await as(A); await q("select public.request_friend($1)", [B]); await q("select public.request_friend($1)", [C]);
await as(B); await q("select public.request_friend($1)", [A]);
await as(C); await q("select public.request_friend($1)", [A]);
await as(A);
const AB = await one("select public.open_conversation($1)", [B]);
const AC = await one("select public.open_conversation($1)", [C]);
await q("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'from before the update')", [AB, A]);

await owner();
const media = fs.readFileSync(SQL.media, "utf8");
await db.exec(media);
await db.exec(media); // must be safe to run twice
await db.exec(fs.readFileSync(SQL.messages, "utf8")); // and the first file run again afterwards must not undo it
await db.exec(media);

const uuid = () => crypto.randomUUID();
const put = (conv, ext = "png") => `${conv}/${uuid()}.${ext}`;
const upload = (path, who) => db.query("insert into storage.objects (bucket_id, name, owner, owner_id) values ('message-media', $1, $2::uuid, $3)", [path, who, who]);
const sendMedia = async (conv, who, path, extra = {}) => {
  await db.query("select pg_sleep(0.004)"); // keeps messages in a known order (this test database's clock only counts milliseconds)
  const row = { conversation_id: conv, sender_id: who, content: "", media_path: path, media_kind: "image", media_mime: "image/png", media_size: 1234, media_width: 800, media_height: 600, media_name: "shot.png", ...extra };
  const keys = Object.keys(row);
  return db.query(`insert into public.messages (${keys.join(",")}) values (${keys.map((_, i) => "$" + (i + 1)).join(",")}) returning *`, keys.map((k) => row[k]));
};
const fails = async (p) => { try { await p; return false; } catch (e) { return e.message; } };

console.log("1. Old messages and plain text still work");
await as(A);
check("the message from before is still there", (await q("select content, media_path from public.messages where conversation_id = $1", [AB]))[0].content === "from before the update");
check("plain text still sends", !(await fails(db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, 'hello')", [AB, A]))));
check("empty text with no file is still refused", !!(await fails(db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, '  ')", [AB, A]))));
check("text over 4,000 characters is still refused", !!(await fails(db.query("insert into public.messages (conversation_id, sender_id, content) values ($1, $2, $3)", [AB, A, "x".repeat(4001)]))));

console.log("2. Who can upload");
const p1 = put(AB);
check("a friend can upload into their own conversation", !(await fails(upload(p1, A))));
await as(B); const p2 = put(AB, "mp4");
check("so can the other person", !(await fails(upload(p2, B))));
await as(D);
check("someone outside the conversation can't upload into it", /row-level security/.test(await fails(upload(put(AB), D))), await fails(upload(put(AB), D)));
await as(A);
check("you can't upload into someone else's conversation", /row-level security/.test(await fails(upload(put(uuid()), A))));
check("or into a made-up folder", /row-level security/.test(await fails(upload("not-a-conversation/x.png", A))) && /row-level security/.test(await fails(upload("x.png", A))));
check("or into another bucket", !!(await fails(db.query("insert into storage.objects (bucket_id, name) values ('avatars', $1)", [put(AB)]))));
await as(null, "anon");
check("not logged in: can't upload", !!(await fails(upload(put(AB), null))));

console.log("3. Who can see a file");
await as(A); check("sender sees it", (await q("select 1 from storage.objects where name = $1", [p1])).length === 1);
await as(B); check("the other person sees it", (await q("select 1 from storage.objects where name = $1", [p1])).length === 1);
await as(C); check("a friend of only one of them doesn't", (await q("select 1 from storage.objects where name = $1", [p1])).length === 0);
await as(D); check("a stranger sees no files at all", (await q("select 1 from storage.objects")).length === 0);
await as(null, "anon"); check("not logged in: sees no files", (await q("select 1 from storage.objects")).length === 0);

console.log("4. Files can't be changed or removed");
await as(A);
check("can't delete your own file", (await db.query("delete from storage.objects where name = $1", [p1])).affectedRows === 0);
check("can't rename or move it", (await db.query("update storage.objects set name = $2 where name = $1", [p1, put(AC)])).affectedRows === 0);
await as(B);
check("the other person can't delete it either", (await db.query("delete from storage.objects where name = $1", [p1])).affectedRows === 0);

console.log("5. Sending a message with a file");
await as(A);
let r = await fails(sendMedia(AB, A, p1));
check("a picture with no words sends", r === false, r);
r = await fails(sendMedia(AB, A, p1));
check("the same file can't be attached twice", /messages_media_path|duplicate/.test(r), r);
const p3 = put(AB, "gif"); await upload(p3, A);
check("a GIF with a caption sends", !(await fails(sendMedia(AB, A, p3, { content: "look at this", media_mime: "image/gif" }))));
await as(B);
check("a video sends", !(await fails(sendMedia(AB, B, p2, { media_kind: "video", media_mime: "video/mp4", media_size: 40 * 1024 * 1024, media_name: "clip.mp4" }))));
await as(A);
check("a file that was never uploaded is refused", /wasn't uploaded/.test(await fails(sendMedia(AB, A, put(AB)))));
const pc = put(AC); await upload(pc, A);
check("a file from another of your conversations is refused", /doesn't belong/.test(await fails(sendMedia(AB, A, pc))));
check("a path that climbs out of the folder is refused", /doesn't belong/.test(await fails(sendMedia(AB, A, `${AB}/../${AC}/${uuid()}.png`))));
const p4 = put(AB); await upload(p4, A);
check("pictures over 10 MB are refused", /messages_media_shape/.test(await fails(sendMedia(AB, A, p4, { media_size: 10 * 1024 * 1024 + 1 }))));
check("a video labeled as a picture is refused", /messages_media_shape/.test(await fails(sendMedia(AB, A, p4, { media_mime: "video/mp4" }))));
check("other file types are refused", /messages_media_shape/.test(await fails(sendMedia(AB, A, p4, { media_mime: "application/pdf" }))) && /messages_media_shape/.test(await fails(sendMedia(AB, A, p4, { media_kind: "file" }))));
check("file details without a file are refused", /messages_media_shape/.test(await fails(db.query("insert into public.messages (conversation_id, sender_id, content, media_kind) values ($1, $2, 'hi', 'image')", [AB, A]))));
check("you still can't send as someone else", /row-level security/.test(await fails(sendMedia(AB, B, p4))));
await as(D); const pd = put(AB);
check("a stranger can't post a file message into the conversation", /row-level security/.test(await fails(sendMedia(AB, D, p4))));
await as(B);
const got = await q("select content, media_path, media_kind, media_mime, media_name, read_at from public.messages where conversation_id = $1 and media_path is not null order by created_at", [AB]);
check("the other person receives all three, unread", got.length === 3 && got[0].media_path === p1 && got[1].content === "look at this" && got.every((m) => m.read_at === null), got);

console.log("6. The conversation list");
await as(A);
let list = await q("select * from public.list_conversations_v2()");
let ab = list.find((c) => c.id === AB);
check("says the last message was a video", ab.last_media_kind === "video" && ab.last_media_mime === "video/mp4" && ab.last_message === "" && ab.last_sender_id === B, ab);
check("counts file messages as unread too", ab.unread === 1, ab.unread);
check("a conversation with no files has none listed", list.find((c) => c.id === AC).last_media_kind === null);
check("the old list still works for AURA versions from before this update", (await q("select * from public.list_conversations()")).length === 2);
await as(D); check("a stranger's list is still empty", (await q("select * from public.list_conversations_v2()")).length === 0);
await as(null, "anon"); check("not logged in: can't call it", !!(await fails(db.query("select * from public.list_conversations_v2()"))));

console.log("7. After removing a friend");
await as(A);
await q("delete from public.friendships where least(requester_id, addressee_id) = least($1::uuid, $2::uuid) and greatest(requester_id, addressee_id) = greatest($1::uuid, $2::uuid)", [A, B]);
check("can't upload any more", /row-level security/.test(await fails(upload(put(AB), A))));
check("can't send the file that's already uploaded", /row-level security/.test(await fails(sendMedia(AB, A, p4))));
check("old files can still be viewed by both", (await q("select 1 from storage.objects where name = $1", [p1])).length === 1);
await as(B); check("(the other side too)", (await q("select 1 from storage.objects where name = $1", [p2])).length === 1);

console.log("8. The bucket");
await owner();
const bucket = (await q("select * from storage.buckets where id = 'message-media'"))[0];
check("private, 50 MB limit, pictures and videos only", bucket.public === false && Number(bucket.file_size_limit) === 52428800 && bucket.allowed_mime_types.length === 7 && !bucket.allowed_mime_types.includes("image/svg+xml"), bucket);
check("only one copy of each rule after running the file three times", Number(await one("select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'")) === 2);
check("one content rule on messages, not two", Number(await one("select count(*) from pg_constraint where conrelid = 'public.messages'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%btrim(content%'")) === 1);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
