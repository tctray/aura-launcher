#!/usr/bin/env node
/**
 * AURA — your profile picture, everywhere
 *
 * A profile picture chosen from your PC (Edit Profile > Browse) only ever stayed on your PC, so
 * friends saw your first letter instead. This saves it to your account:
 *   - it is checked, cut to a square and made small (256 x 256), which also drops hidden photo
 *     details such as where it was taken
 *   - it goes in a Supabase storage folder only you can add to or remove from
 *   - friends then see it in Messages, the Friends panel and calls
 *   - a picture you already chose is saved the next time AURA starts, without you doing anything
 *
 * How to use:
 *   1. Run aura-avatars.sql in Supabase (SQL Editor).
 *   2. Put this file in your AURA project folder (the one with package.json).
 *   3. Fully quit AURA.
 *   4. Run:   node aura-avatars-setup.cjs
 *
 * What it does:
 *   - creates  electron/avatar.js          checks, shrinks and uploads the picture
 *   - edits    electron/supabase.js        saving your profile saves the picture too
 *   - edits    src/components/auth.jsx     passes a picture from your PC along, and saves one you already chose
 *   - edits    the privacy policy          says how profile pictures are stored
 *   - creates  tests/avatars.cjs           (only if AURA's checks are installed) checks for the above
 *
 * Every file it changes is copied to <name>.before-avatars.bak first.
 * To put everything back:                 node aura-avatars-setup.cjs --undo
 * To preview without changing anything:   node aura-avatars-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FILES = {"avatar":"// AURA — profile pictures saved to your account.\n//\n// A picture chosen from the PC arrives as a data: address. Here it is checked (it must really be\n// a picture), made small (256 x 256; this also drops hidden details such as where a photo was\n// taken), uploaded to the \"avatars\" bucket in Supabase under your own folder, and its web address\n// is what goes in your profile. Your older pictures there are removed.\n//\n// Added by aura-avatars-setup.cjs. Used by supabase.js (saveProfile).\n\"use strict\";\nconst crypto = require(\"crypto\");\n\nconst BUCKET = \"avatars\";\nconst SIDE = 256;\nconst MAX_IN = 15 * 1024 * 1024;   // the picture as chosen\nconst MAX_OUT = 2 * 1024 * 1024;   // what is stored (the bucket refuses more)\nconst SETUP = \"Profile pictures aren't set up in Supabase yet. Run aura-avatars.sql first.\";\nconst DATA_URL = /^data:image\\/[a-z.+-]+;base64,([A-Za-z0-9+/=\\s]+)$/i;\nconst isDataUrl = (v) => typeof v === \"string\" && v.length < MAX_IN * 1.4 && DATA_URL.test(v);\n\n// What a picture really is, from its first bytes\nfunction sniff(b) {\n  if (!b || b.length < 12) return null;\n  const at = (i, t) => b.toString(\"latin1\", i, i + t.length) === t;\n  if (b[0] === 0x89 && at(1, \"PNG\")) return { mime: \"image/png\", ext: \"png\" };\n  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: \"image/jpeg\", ext: \"jpg\" };\n  if (at(0, \"GIF87a\") || at(0, \"GIF89a\")) return { mime: \"image/gif\", ext: \"gif\" };\n  if (at(0, \"RIFF\") && at(8, \"WEBP\")) return { mime: \"image/webp\", ext: \"webp\" };\n  return null;\n}\n\n// Electron's picture tools, when running inside Electron (the checks run without them)\nfunction electronImages() {\n  try { const { nativeImage } = require(\"electron\"); return nativeImage && typeof nativeImage.createFromBuffer === \"function\" ? nativeImage : null; } catch { return null; }\n}\n\n// Returns { bytes, mime, ext } ready to store\nfunction prepare(dataUrl, { nativeImage = electronImages() } = {}) {\n  if (!isDataUrl(dataUrl)) throw new Error(\"That picture couldn't be read.\");\n  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(\",\") + 1), \"base64\");\n  const kind = sniff(bytes);\n  if (!kind) throw new Error(\"A profile picture has to be a PNG, JPG, WebP or GIF.\");\n  // PNG and JPG are cut to a square from the middle and made small. GIFs and WebP keep their\n  // movement, so they are stored as they are if they are small enough.\n  if (nativeImage && (kind.ext === \"png\" || kind.ext === \"jpg\")) {\n    const img = nativeImage.createFromBuffer(bytes);\n    if (!img.isEmpty()) {\n      const { width, height } = img.getSize();\n      const side = Math.min(width, height);\n      const square = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side });\n      const small = side > SIDE ? square.resize({ width: SIDE, height: SIDE, quality: \"best\" }) : square;\n      const out = kind.ext === \"png\" ? small.toPNG() : small.toJPEG(88);\n      if (out && out.length) return { bytes: out, ...kind };\n    }\n  }\n  if (bytes.length > MAX_OUT) throw new Error(\"That picture is too big for a profile picture (\" + (bytes.length / 1048576).toFixed(1) + \" MB). Pick one under 2 MB.\");\n  return { bytes, ...kind };\n}\n\n// Uploads the picture for this user and returns its web address\nasync function upload(client, userId, dataUrl, opts) {\n  const pic = prepare(dataUrl, opts);\n  const name = crypto.randomUUID() + \".\" + pic.ext;\n  const store = client.storage.from(BUCKET);\n  const up = await store.upload(userId + \"/\" + name, pic.bytes, { contentType: pic.mime, cacheControl: \"31536000\", upsert: false });\n  if (up.error) {\n    const msg = String(up.error.message || up.error);\n    if (/bucket not found/i.test(msg)) throw new Error(SETUP);\n    if (/row-level security|unauthorized|403/i.test(msg)) throw new Error(SETUP);\n    if (/maximum allowed size|too large/i.test(msg)) throw new Error(\"That picture is too big for a profile picture. Pick one under 2 MB.\");\n    throw new Error(\"The picture couldn't be uploaded (\" + msg.slice(0, 120) + \").\");\n  }\n  const url = store.getPublicUrl(userId + \"/\" + name)?.data?.publicUrl;\n  if (typeof url !== \"string\" || !/^https:\\/\\//.test(url)) throw new Error(\"The picture was uploaded, but Supabase didn't give back its address.\");\n  // Older pictures of yours are tidied away. If that fails the new one still counts.\n  try {\n    const { data } = await store.list(userId, { limit: 100 });\n    const old = (data || []).map((f) => f && f.name).filter((n) => typeof n === \"string\" && n !== name && /^[0-9a-f-]{36}\\.(png|jpg|gif|webp)$/.test(n));\n    if (old.length) await store.remove(old.map((n) => userId + \"/\" + n));\n  } catch {}\n  return url;\n}\n\nmodule.exports = { upload, prepare, isDataUrl, sniff, SETUP, BUCKET };\n","test":"// Profile pictures (electron/avatar.js and supabase/aura-avatars.sql).\n// Added by aura-avatars-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst path = require(\"path\");\nconst ROOT = path.resolve(__dirname, \"..\");\nconst avatar = require(path.resolve(process.argv[2] || path.join(ROOT, \"electron\", \"avatar.js\")));\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok ? \"\" : \"  \" + JSON.stringify(extra))); };\nconst fails = async (fn) => { try { await fn(); return \"\"; } catch (e) { return e.message; } };\nconst dataUrl = (bytes, mime = \"image/png\") => `data:${mime};base64,${Buffer.from(bytes).toString(\"base64\")}`;\nconst PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);\nconst JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 2)]);\nconst GIF = Buffer.concat([Buffer.from(\"GIF89a\"), Buffer.alloc(200, 3)]);\nconst UID = \"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\", OTHER = \"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb\";\n\n// Electron's picture tools, imitated: remembers what was cut and how small it was made\nfunction fakeImages(width, height) {\n  const did = [];\n  const image = (w, h) => ({\n    isEmpty: () => false, getSize: () => ({ width: w, height: h }),\n    crop: (r) => { did.push([\"crop\", r]); return image(r.width, r.height); },\n    resize: (o) => { did.push([\"resize\", o.width, o.height]); return image(o.width, o.height); },\n    toPNG: () => { did.push([\"png\", w, h]); return Buffer.from(\"small png\"); },\n    toJPEG: (q) => { did.push([\"jpeg\", w, h, q]); return Buffer.from(\"small jpeg\"); },\n  });\n  return { did, nativeImage: { createFromBuffer: () => image(width, height) } };\n}\n// Supabase Storage, imitated\nfunction fakeClient({ uploadError = null, files = [] } = {}) {\n  const calls = [];\n  return { calls, storage: { from: (bucket) => ({\n    upload: async (p, bytes, opts) => { calls.push([\"upload\", bucket, p, bytes, opts]); return uploadError ? { data: null, error: { message: uploadError } } : { data: { path: p }, error: null }; },\n    getPublicUrl: (p) => ({ data: { publicUrl: \"https://proj.supabase.co/storage/v1/object/public/\" + bucket + \"/\" + p } }),\n    list: async (folder) => { calls.push([\"list\", bucket, folder]); return { data: files.map((name) => ({ name })), error: null }; },\n    remove: async (paths) => { calls.push([\"remove\", bucket, paths]); return { data: [], error: null }; },\n  }) } };\n}\n\n(async () => {\n  console.log(\"1. Getting a picture ready\");\n  let f = fakeImages(1200, 800);\n  let pic = avatar.prepare(dataUrl(JPG, \"image/jpeg\"), { nativeImage: f.nativeImage });\n  check(\"a photo is cut to a square from the middle and made 256 x 256\", JSON.stringify(f.did) === JSON.stringify([[\"crop\", { x: 200, y: 0, width: 800, height: 800 }], [\"resize\", 256, 256], [\"jpeg\", 256, 256, 88]]) && pic.mime === \"image/jpeg\" && pic.ext === \"jpg\" && pic.bytes.toString() === \"small jpeg\", f.did);\n  f = fakeImages(100, 300);\n  pic = avatar.prepare(dataUrl(PNG), { nativeImage: f.nativeImage });\n  check(\"a PNG stays a PNG (so see-through parts stay see-through); a small one isn't blown up\", JSON.stringify(f.did) === JSON.stringify([[\"crop\", { x: 0, y: 100, width: 100, height: 100 }], [\"png\", 100, 100]]) && pic.mime === \"image/png\", f.did);\n  pic = avatar.prepare(dataUrl(GIF, \"image/gif\"), { nativeImage: fakeImages(10, 10).nativeImage });\n  check(\"a GIF is kept as it is, so it still moves\", pic.mime === \"image/gif\" && pic.bytes.equals(GIF));\n  check(\"the file's own bytes decide what it is, not what it claims\", avatar.prepare(dataUrl(PNG, \"image/gif\"), { nativeImage: null }).mime === \"image/png\");\n  check(\"something that isn't a picture is refused\", /has to be a PNG, JPG, WebP or GIF/.test(await fails(() => avatar.prepare(dataUrl(Buffer.from(\"<script>alert(1)</script>\"), \"image/png\"), { nativeImage: null }))));\n  check(\"so is something that isn't a picture address at all\", /couldn't be read/.test(await fails(() => avatar.prepare(\"https://example.com/a.png\"))) && /couldn't be read/.test(await fails(() => avatar.prepare(\"data:text/html;base64,PGI+\"))));\n  check(\"a GIF too big to store says so\", /too big/.test(await fails(() => avatar.prepare(dataUrl(Buffer.concat([GIF, Buffer.alloc(2.2 * 1048576)]), \"image/gif\"), { nativeImage: null }))));\n\n  console.log(\"2. Saving it to the account\");\n  const old1 = \"11111111-1111-1111-1111-111111111111.jpg\", keep = \"notes.txt\";\n  let c = fakeClient({ files: [old1, keep] });\n  const url = await avatar.upload(c, UID, dataUrl(JPG, \"image/jpeg\"), { nativeImage: fakeImages(512, 512).nativeImage });\n  const up = c.calls.find((x) => x[0] === \"upload\");\n  check(\"it goes in your own folder in the avatars bucket, under a new random name\", up[1] === \"avatars\" && new RegExp(\"^\" + UID + \"/[0-9a-f-]{36}\\\\.jpg$\").test(up[2]) && up[4].contentType === \"image/jpeg\" && up[4].upsert === false, up.slice(1, 3));\n  check(\"and its web address is what the profile gets\", url === \"https://proj.supabase.co/storage/v1/object/public/avatars/\" + up[2], url);\n  const rm = c.calls.find((x) => x[0] === \"remove\");\n  check(\"your older picture is removed; nothing else is touched\", rm && JSON.stringify(rm[2]) === JSON.stringify([UID + \"/\" + old1]), rm);\n  check(\"not set up in Supabase yet: says what to run\", (await fails(() => avatar.upload(fakeClient({ uploadError: \"Bucket not found\" }), UID, dataUrl(PNG), { nativeImage: null }))) === avatar.SETUP);\n  check(\"refused by the storage rules: the same\", (await fails(() => avatar.upload(fakeClient({ uploadError: \"new row violates row-level security policy\" }), UID, dataUrl(PNG), { nativeImage: null }))) === avatar.SETUP);\n\n  console.log(\"3. The storage rules\");\n  const { PGlite } = await import(\"@electric-sql/pglite\");\n  const db = new PGlite();\n  await db.exec(`create schema auth; create role anon nologin; create role authenticated nologin;\n    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;\n    grant usage on schema auth to anon, authenticated;`);\n  await db.exec(fs.readFileSync(path.join(__dirname, \"messages\", \"storage-fake.sql\"), \"utf8\"));\n  const sql = fs.readFileSync(path.join(ROOT, \"supabase\", \"aura-avatars.sql\"), \"utf8\");\n  await db.exec(sql); await db.exec(sql); // safe to run twice\n  const as = (uid, role = \"authenticated\") => db.exec(`reset role; set test.uid = '${uid || \"\"}'; set role ${role};`);\n  const put = (name) => db.query(\"insert into storage.objects (bucket_id, name, owner_id) values ('avatars', $1, $2)\", [name, UID]);\n  await as(UID);\n  check(\"you can add a picture to your own folder\", !(await fails(() => put(UID + \"/a.jpg\"))));\n  check(\"not to someone else's\", /row-level security/.test(await fails(() => put(OTHER + \"/a.jpg\"))));\n  check(\"nor outside a folder\", /row-level security/.test(await fails(() => put(\"a.jpg\"))));\n  await as(OTHER); await db.query(\"insert into storage.objects (bucket_id, name, owner_id) values ('avatars', $1, $2)\", [OTHER + \"/b.jpg\", OTHER]);\n  await as(UID);\n  check(\"you can't remove someone else's picture\", (await db.query(\"delete from storage.objects where name = $1\", [OTHER + \"/b.jpg\"])).affectedRows === 0);\n  check(\"you can remove your own\", (await db.query(\"delete from storage.objects where name = $1\", [UID + \"/a.jpg\"])).affectedRows === 1);\n  await as(null, \"anon\");\n  check(\"not signed in: can't add any\", !!(await fails(() => put(UID + \"/c.jpg\"))));\n  await db.exec(\"reset role\");\n  const b = (await db.query(\"select * from storage.buckets where id = 'avatars'\")).rows[0];\n  check(\"the bucket shows pictures by their address, takes pictures only, up to 2 MB\", b.public === true && Number(b.file_size_limit) === 2097152 && JSON.stringify(b.allowed_mime_types) === JSON.stringify([\"image/jpeg\", \"image/png\", \"image/webp\", \"image/gif\"]), b);\n  check(\"it doesn't touch the private bucket for message files\", !/message-media/.test(sql));\n\n  console.log(failed ? `\\n${failed} FAILED` : \"\\nall passed\");\n  process.exit(failed ? 1 : 0);\n})().catch((e) => { console.error(\"TEST CRASHED:\", e); process.exit(2); });\n","sql":"-- AURA profile pictures\n-- Lets a picture chosen from your PC (Edit Profile > Browse) be saved to your account, so friends\n-- see it in Messages, the Friends panel and calls instead of your first letter.\n-- Safe to run more than once.\n--\n-- Pictures go in a storage bucket called \"avatars\", one folder per account. The bucket is public:\n-- a picture has a fixed web address, the same way a web-link profile picture always did. Only you\n-- can add, replace or remove the pictures in your own folder.\n\ninsert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)\nvalues ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])\non conflict (id) do update\n  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;\n\n-- Your own folder is  avatars/<your account id>/\ndrop policy if exists \"AURA avatars: add your own\" on storage.objects;\ncreate policy \"AURA avatars: add your own\" on storage.objects for insert to authenticated\n  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);\ndrop policy if exists \"AURA avatars: see your own\" on storage.objects;\ncreate policy \"AURA avatars: see your own\" on storage.objects for select to authenticated\n  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);\ndrop policy if exists \"AURA avatars: remove your own\" on storage.objects;\ncreate policy \"AURA avatars: remove your own\" on storage.objects for delete to authenticated\n  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-avatars.bak";
const MARK = "Added by aura-avatars-setup.cjs";
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "release", ".git", ".vite", "coverage", "tests", "supabase"]);

const rel = (p) => path.relative(ROOT, p) || p;
const say = (line = "") => console.log(line);
function stop(lines) {
  say();
  say("Nothing was changed.");
  (Array.isArray(lines) ? lines : [lines]).forEach((l) => say("  " + l));
  say();
  process.exit(1);
}
function readText(file) {
  const raw = fs.readFileSync(file, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n"; // keep Windows line endings as they are
  return { text: raw.replace(/\r\n/g, "\n"), eol };
}
const withEol = (text, eol) => (eol === "\n" ? text : text.replace(/\n/g, eol));
function* walk(dir, depth = 0) {
  if (depth > 7) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) yield* walk(full, depth + 1);
    } else if (/\.(jsx?|tsx?|cjs|mjs)$/.test(entry.name) && !/^aura-[\w-]+\.cjs$/.test(entry.name)) {
      try { if (fs.statSync(full).size < 3 * 1024 * 1024) yield full; } catch {}
    }
  }
}
// Finds one file. A project can have several that look alike, so `prefer` is a list of tie-breakers.
function findOne(label, test, hint, prefer = []) {
  let hits = [];
  for (const file of walk(ROOT)) {
    let text = "";
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    if (test(text)) hits.push({ file, text });
  }
  if (!hits.length) stop(["I couldn't find " + label + ".", hint, "Copy this message to Claude."]);
  for (const rule of prefer) {
    if (hits.length === 1) break;
    const kept = hits.filter((h) => rule(h));
    if (kept.length) hits = kept;
  }
  if (hits.length === 1) return hits[0].file;
  stop(["I found more than one file that looks like " + label + ":", ...hits.map((h) => "  " + rel(h.file)), "Copy this message to Claude."]);
}
const sameFile = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const indentOf = (line) => line.match(/^\s*/)[0];
const findLine = (lines, re, from = 0, to = lines.length) => { for (let i = from; i < to; i++) if (re.test(lines[i])) return i; return -1; };

// ── supabase.js: saving the profile uploads a picture from the PC ─────────────
const OLD_AVATAR_LINE = /^(\s*)if \(typeof avatarUrl === "string" && \/\^https\?:\\\/\\\/\/i\.test\(avatarUrl\)\) row\.avatar_url = avatarUrl;\s*$/;
function editSupabase(text) {
  if (/require\(\s*["']\.\/avatar["']\s*\)/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  const start = findLine(lines, /^async function saveProfile\(username, avatarUrl\)\s*\{\s*$/);
  if (start < 0) throw new Error("the profile save ( async function saveProfile(username, avatarUrl) )");
  const end = findLine(lines, /^\}\s*$/, start + 1, Math.min(lines.length, start + 20));
  const at = end < 0 ? -1 : findLine(lines, OLD_AVATAR_LINE, start, end);
  const ret = end < 0 ? -1 : findLine(lines, /^\s*return true;\s*$/, start, end);
  const upsert = end < 0 ? -1 : findLine(lines, /^\s*if \(error\) throw new Error\(error\.code === "23505"/, start, end);
  if (at < 0 || ret < 0 || upsert < 0 || !(at < upsert && upsert < ret)) throw new Error("the lines in saveProfile() I expected (it may have been changed by hand)");
  const pad = lines[at].match(OLD_AVATAR_LINE)[1];
  lines.splice(ret, 0, pad + 'if (pictureProblem) throw new Error("Your profile was saved, but not the picture: " + pictureProblem.message);');
  lines.splice(at + 1, 0,
    pad + "// A picture chosen from this PC is stored in Supabase, so friends see it too (see avatar.js)",
    pad + "let pictureProblem = null;",
    pad + 'if (require("./avatar").isDataUrl(avatarUrl)) {',
    pad + '  try { row.avatar_url = await require("./avatar").upload(client(), user.id, avatarUrl); }',
    pad + "  catch (e) { pictureProblem = e; }",
    pad + "}");
  return { text: lines.join("\n"), notes: ["saving your profile now saves a picture from your PC too"] };
}

// ── auth.jsx: pass the picture along, and save one chosen before this update ───
const OLD_WEBURL = 'const webUrl = (value) => (typeof value === "string" && /^https?:\\/\\//i.test(value) ? value : undefined);';
const EDIT_SAVE = /^(\s*)try \{ await cloudCall\("saveProfile", username, webUrl\(profile\.avatar\)\); \}\s*$/;
function editAuth(text) {
  if (/const pictureToSave = /.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  const w = lines.findIndex((l) => l.trim() === OLD_WEBURL);
  if (w < 0) throw new Error("the webUrl line ( const webUrl = (value) => ... )");
  const save = lines.findIndex((l) => EDIT_SAVE.test(l));
  if (save < 0) throw new Error('the Edit Profile save ( await cloudCall("saveProfile", username, webUrl(profile.avatar)) )');
  // Edit Profile: a picture chosen from the PC goes along too, and the main process uploads it
  lines[save] = lines[save].replace("webUrl(profile.avatar)", "pictureToSave(profile.avatar)");
  lines.splice(w + 1, 0,
    "// Edit Profile also sends a picture chosen from the PC; the main process uploads it (see electron/avatar.js)",
    'const pictureToSave = (value) => webUrl(value) ?? (typeof value === "string" && /^data:image\\/[a-z.+-]+;base64,/i.test(value) ? value : undefined);');
  const notes = ["Edit Profile saves a picture chosen from your PC to your account"];
  // At startup: a picture chosen before this update is saved once, quietly
  const ask = lines.findIndex((l) => /^\s*try \{ username = \(await cloudCall\("getMyProfile"\)\)\?\.username \|\| null; \} catch \{ reachable = false; \}\s*$/.test(l));
  const enter = ask < 0 ? -1 : lines.findIndex((l, i) => i > ask && /^\s*if \(username\) enter\(account, username, mine\);\s*$/.test(l));
  const decl = ask < 0 ? -1 : lines.findIndex((l, i) => i < ask && i > ask - 12 && /^\s*let taken = null;\s*$/.test(l));
  if (ask >= 0 && enter >= 0 && decl >= 0) {
    const pad2 = lines[enter].match(/^\s*/)[0];
    lines[ask] = lines[ask].match(/^\s*/)[0] + 'try { online = await cloudCall("getMyProfile"); username = online?.username || null; } catch { reachable = false; }';
    lines.splice(enter + 1, 0,
      pad2 + "// A picture chosen on this PC before pictures were saved online: save it now, quietly.",
      pad2 + "// (online is left undefined when the account couldn't be checked, so nothing is tried offline)",
      pad2 + 'if (username && online !== undefined && !online?.avatar_url && /^data:image\\//i.test(mine?.avatar || "")) cloudCall("saveProfile", username, mine.avatar).catch(() => {});');
    lines.splice(decl + 1, 0, lines[decl].match(/^\s*/)[0] + "let online; // your profile as saved online, once it has been checked");
    notes.push("a picture you already chose is saved the next time AURA starts");
  } else notes.push("(couldn't find where AURA checks your profile at startup, so a picture you already chose is saved the next time you press Save in Edit Profile)");
  return { text: lines.join("\n"), notes };
}

// ── The privacy policy: say how profile pictures are stored ───────────────────
const POLICY_OLD = "Your profile: username, bio and profile picture. Anyone signed in to AURA can see these, which is how friends find you by username.";
const POLICY_NEW = POLICY_OLD + " A profile picture you choose from your PC is stored with its own web address, so anyone who has that address can see it.";
function editPolicy(text) {
  if (text.includes(POLICY_NEW)) return { text, notes: [] };
  if (!text.includes(POLICY_OLD)) return { text, notes: ["(couldn't find the profile line in the privacy policy; it's worth adding that profile pictures have a web address)"] };
  return { text: text.replace(POLICY_OLD, POLICY_NEW), notes: ["says how profile pictures are stored"] };
}

// ── AURA's checks (only when they are installed) ──────────────────────────────
function editRunner(text) {
  if (/avatars\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  const at = findLine(lines, /^add\(\s*["']window["']\s*,/);
  if (at < 0) return { text, notes: ["(couldn't find where to add the profile picture checks, so npm test doesn't include them)"] };
  lines.splice(at, 0,
    "// Profile pictures saved to the account",
    'const avatarFile = path.join(ROOT, "electron", "avatar.js");',
    'if (fs.existsSync(avatarFile) && fs.existsSync(path.join(__dirname, "avatars.cjs")) && fs.existsSync(path.join(sqlDir, "aura-avatars.sql"))) add("messages", "Profile pictures", "avatars.cjs", [avatarFile]);');
  return { text: lines.join("\n"), notes: ["npm test now checks profile pictures too"] };
}

// Does `node` accept the file? Catches a bad edit before anything is written.
function syntaxProblem(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-check-"));
  const file = path.join(dir, "check.cjs");
  try {
    fs.writeFileSync(file, text);
    const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    return r.status === 0 ? "" : String(r.stderr || "syntax error").split("\n").filter(Boolean).slice(0, 4).join(" | ");
  } catch { return ""; } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
}

// ── Undo ──────────────────────────────────────────────────────────────────────
function undo() {
  let restored = 0;
  const visit = (dir, depth = 0) => {
    if (depth > 7) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if ((!SKIP_DIRS.has(entry.name) || entry.name === "tests" || entry.name === "supabase") && !entry.name.startsWith(".")) visit(full, depth + 1);
      } else if (entry.name.endsWith(BAK)) {
        const target = full.slice(0, -BAK.length);
        fs.copyFileSync(full, target); fs.unlinkSync(full);
        say("  restored  " + rel(target)); restored++;
      } else if (entry.name === "avatar.js" || entry.name === "avatars.cjs" || entry.name === "aura-avatars.sql") {
        try { const t = fs.readFileSync(full, "utf8"); if (t.includes(MARK) || t === FILES.sql) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. Profile pictures from your PC stay on your PC again. (Supabase is left alone.)" : "Nothing to undo.");
  say();
}

// ── Run ───────────────────────────────────────────────────────────────────────
function run() {
  const pkgFile = path.join(ROOT, "package.json");
  if (!fs.existsSync(pkgFile)) stop(["This isn't your AURA project folder (no package.json here).", "Move this file next to package.json and run it from there."]);
  if (UNDO) return undo();

  const need = "Run the earlier setup scripts first (accounts and messages), then run this again.";
  const files = {
    supabase: findOne("supabase.js", (t) => /createClient/.test(t) && /async function saveProfile\(username, avatarUrl\)/.test(t), need),
    auth: findOne("the accounts file (auth.jsx)", (t) => /export function AuthGate\s*\(/.test(t) && /const webUrl = /.test(t), need, [
      (h) => /[\\/]src[\\/]/.test(h.file),
    ]),
  };
  const privacyFiles = [];
  for (const file of walk(ROOT)) if (path.basename(file) === "privacy.jsx") privacyFiles.push(file);
  const md = path.join(ROOT, "PRIVACY.md");

  const plan = [];
  const problems = [];
  const consider = (label, file, edit, checkSyntax) => {
    const { text, eol } = readText(file);
    try {
      const result = edit(text);
      if (checkSyntax && result.text !== text) { const bad = syntaxProblem(result.text); if (bad) throw new Error("a way to edit it safely (" + bad + ")"); }
      plan.push({ label, file, before: text, after: result.text, eol, notes: result.notes });
    } catch (e) { problems.push("In " + rel(file) + " I couldn't find " + e.message + "."); }
  };
  consider("supabase", files.supabase, editSupabase, true);
  consider("accounts", files.auth, editAuth, false);
  for (const p of privacyFiles) consider("privacy", p, editPolicy, false);
  if (fs.existsSync(md)) consider("policy", md, editPolicy, false);
  const runner = path.join(ROOT, "tests", "run.cjs");
  const hasChecks = fs.existsSync(runner) && fs.existsSync(path.join(ROOT, "tests", "messages", "storage-fake.sql"));
  if (hasChecks) consider("checks", runner, editRunner, true);

  const created = [{ label: "avatar", file: path.join(path.dirname(files.supabase), "avatar.js"), content: FILES.avatar }];
  if (hasChecks) {
    created.push({ label: "checks", file: path.join(ROOT, "tests", "avatars.cjs"), content: FILES.test });
    created.push({ label: "checks", file: path.join(ROOT, "supabase", "aura-avatars.sql"), content: FILES.sql, ours: (t) => t === FILES.sql || /^-- AURA profile pictures/.test(t) });
  }
  for (const c of created) {
    c.note = "created";
    if (fs.existsSync(c.file)) {
      const existing = readText(c.file).text;
      if (!existing.includes(MARK) && !(c.ours && c.ours(existing))) problems.push(rel(c.file) + " already exists and wasn't made by this script, so I left it alone.");
      else c.note = existing === c.content ? "already done" : "updated";
    }
  }
  if (problems.length) stop([...problems, "Copy this message to Claude."]);

  say();
  say(DRY ? "Dry run. This is what would change:" : "AURA: profile pictures");
  say();
  for (const step of plan) {
    if (step.after !== step.before && !DRY) {
      const bak = step.file + BAK;
      if (!fs.existsSync(bak)) fs.copyFileSync(step.file, bak);
      fs.writeFileSync(step.file, withEol(step.after, step.eol));
    }
    say("  " + (step.label + ":").padEnd(11) + rel(step.file));
    (step.notes.length ? step.notes : ["already done"]).forEach((n) => say("             - " + n));
  }
  for (const c of created) {
    if (c.note !== "already done" && !DRY) { fs.mkdirSync(path.dirname(c.file), { recursive: true }); fs.writeFileSync(c.file, c.content); }
    say("  " + (c.label + ":").padEnd(11) + rel(c.file));
    say("             - " + c.note);
  }
  say();
  if (DRY) { say("Run it again without --dry-run to apply."); say(); return; }
  say("Done. Two things left:");
  say("  1. Run aura-avatars.sql in Supabase (SQL Editor), if you haven't yet.");
  say("  2. Restart AURA. A picture you already chose is saved to your account by itself.");
  if (hasChecks) say("Run  npm test  before your next release.");
  say("To undo later:  node aura-avatars-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
