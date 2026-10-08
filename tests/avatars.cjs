// Profile pictures (electron/avatar.js and supabase/aura-avatars.sql).
// Added by aura-avatars-setup.cjs.
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const avatar = require(path.resolve(process.argv[2] || path.join(ROOT, "electron", "avatar.js")));
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const fails = async (fn) => { try { await fn(); return ""; } catch (e) { return e.message; } };
const dataUrl = (bytes, mime = "image/png") => `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 2)]);
const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(200, 3)]);
const UID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", OTHER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

// Electron's picture tools, imitated: remembers what was cut and how small it was made
function fakeImages(width, height) {
  const did = [];
  const image = (w, h) => ({
    isEmpty: () => false, getSize: () => ({ width: w, height: h }),
    crop: (r) => { did.push(["crop", r]); return image(r.width, r.height); },
    resize: (o) => { did.push(["resize", o.width, o.height]); return image(o.width, o.height); },
    toPNG: () => { did.push(["png", w, h]); return Buffer.from("small png"); },
    toJPEG: (q) => { did.push(["jpeg", w, h, q]); return Buffer.from("small jpeg"); },
  });
  return { did, nativeImage: { createFromBuffer: () => image(width, height) } };
}
// Supabase Storage, imitated
function fakeClient({ uploadError = null, files = [] } = {}) {
  const calls = [];
  return { calls, storage: { from: (bucket) => ({
    upload: async (p, bytes, opts) => { calls.push(["upload", bucket, p, bytes, opts]); return uploadError ? { data: null, error: { message: uploadError } } : { data: { path: p }, error: null }; },
    getPublicUrl: (p) => ({ data: { publicUrl: "https://proj.supabase.co/storage/v1/object/public/" + bucket + "/" + p } }),
    list: async (folder) => { calls.push(["list", bucket, folder]); return { data: files.map((name) => ({ name })), error: null }; },
    remove: async (paths) => { calls.push(["remove", bucket, paths]); return { data: [], error: null }; },
  }) } };
}

(async () => {
  console.log("1. Getting a picture ready");
  let f = fakeImages(1200, 800);
  let pic = avatar.prepare(dataUrl(JPG, "image/jpeg"), { nativeImage: f.nativeImage });
  check("a photo is cut to a square from the middle and made 256 x 256", JSON.stringify(f.did) === JSON.stringify([["crop", { x: 200, y: 0, width: 800, height: 800 }], ["resize", 256, 256], ["jpeg", 256, 256, 88]]) && pic.mime === "image/jpeg" && pic.ext === "jpg" && pic.bytes.toString() === "small jpeg", f.did);
  f = fakeImages(100, 300);
  pic = avatar.prepare(dataUrl(PNG), { nativeImage: f.nativeImage });
  check("a PNG stays a PNG (so see-through parts stay see-through); a small one isn't blown up", JSON.stringify(f.did) === JSON.stringify([["crop", { x: 0, y: 100, width: 100, height: 100 }], ["png", 100, 100]]) && pic.mime === "image/png", f.did);
  pic = avatar.prepare(dataUrl(GIF, "image/gif"), { nativeImage: fakeImages(10, 10).nativeImage });
  check("a GIF is kept as it is, so it still moves", pic.mime === "image/gif" && pic.bytes.equals(GIF));
  check("the file's own bytes decide what it is, not what it claims", avatar.prepare(dataUrl(PNG, "image/gif"), { nativeImage: null }).mime === "image/png");
  check("something that isn't a picture is refused", /has to be a PNG, JPG, WebP or GIF/.test(await fails(() => avatar.prepare(dataUrl(Buffer.from("<script>alert(1)</script>"), "image/png"), { nativeImage: null }))));
  check("so is something that isn't a picture address at all", /couldn't be read/.test(await fails(() => avatar.prepare("https://example.com/a.png"))) && /couldn't be read/.test(await fails(() => avatar.prepare("data:text/html;base64,PGI+"))));
  check("a GIF too big to store says so", /too big/.test(await fails(() => avatar.prepare(dataUrl(Buffer.concat([GIF, Buffer.alloc(2.2 * 1048576)]), "image/gif"), { nativeImage: null }))));

  console.log("2. Saving it to the account");
  const old1 = "11111111-1111-1111-1111-111111111111.jpg", keep = "notes.txt";
  let c = fakeClient({ files: [old1, keep] });
  const url = await avatar.upload(c, UID, dataUrl(JPG, "image/jpeg"), { nativeImage: fakeImages(512, 512).nativeImage });
  const up = c.calls.find((x) => x[0] === "upload");
  check("it goes in your own folder in the avatars bucket, under a new random name", up[1] === "avatars" && new RegExp("^" + UID + "/[0-9a-f-]{36}\\.jpg$").test(up[2]) && up[4].contentType === "image/jpeg" && up[4].upsert === false, up.slice(1, 3));
  check("and its web address is what the profile gets", url === "https://proj.supabase.co/storage/v1/object/public/avatars/" + up[2], url);
  const rm = c.calls.find((x) => x[0] === "remove");
  check("your older picture is removed; nothing else is touched", rm && JSON.stringify(rm[2]) === JSON.stringify([UID + "/" + old1]), rm);
  check("not set up in Supabase yet: says what to run", (await fails(() => avatar.upload(fakeClient({ uploadError: "Bucket not found" }), UID, dataUrl(PNG), { nativeImage: null }))) === avatar.SETUP);
  check("refused by the storage rules: the same", (await fails(() => avatar.upload(fakeClient({ uploadError: "new row violates row-level security policy" }), UID, dataUrl(PNG), { nativeImage: null }))) === avatar.SETUP);

  console.log("3. The storage rules");
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  await db.exec(`create schema auth; create role anon nologin; create role authenticated nologin;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;`);
  await db.exec(fs.readFileSync(path.join(__dirname, "messages", "storage-fake.sql"), "utf8"));
  const sql = fs.readFileSync(path.join(ROOT, "supabase", "aura-avatars.sql"), "utf8");
  await db.exec(sql); await db.exec(sql); // safe to run twice
  const as = (uid, role = "authenticated") => db.exec(`reset role; set test.uid = '${uid || ""}'; set role ${role};`);
  const put = (name) => db.query("insert into storage.objects (bucket_id, name, owner_id) values ('avatars', $1, $2)", [name, UID]);
  await as(UID);
  check("you can add a picture to your own folder", !(await fails(() => put(UID + "/a.jpg"))));
  check("not to someone else's", /row-level security/.test(await fails(() => put(OTHER + "/a.jpg"))));
  check("nor outside a folder", /row-level security/.test(await fails(() => put("a.jpg"))));
  await as(OTHER); await db.query("insert into storage.objects (bucket_id, name, owner_id) values ('avatars', $1, $2)", [OTHER + "/b.jpg", OTHER]);
  await as(UID);
  check("you can't remove someone else's picture", (await db.query("delete from storage.objects where name = $1", [OTHER + "/b.jpg"])).affectedRows === 0);
  check("you can remove your own", (await db.query("delete from storage.objects where name = $1", [UID + "/a.jpg"])).affectedRows === 1);
  await as(null, "anon");
  check("not signed in: can't add any", !!(await fails(() => put(UID + "/c.jpg"))));
  await db.exec("reset role");
  const b = (await db.query("select * from storage.buckets where id = 'avatars'")).rows[0];
  check("the bucket shows pictures by their address, takes pictures only, up to 2 MB", b.public === true && Number(b.file_size_limit) === 2097152 && JSON.stringify(b.allowed_mime_types) === JSON.stringify(["image/jpeg", "image/png", "image/webp", "image/gif"]), b);
  check("it doesn't touch the private bucket for message files", !/message-media/.test(sql));

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST CRASHED:", e); process.exit(2); });
