// Pictures, GIFs and videos: the real social.js for several users, the real SQL, a stand-in for Storage.
const path = require("path");
const zlib = require("zlib");
// (zlib.crc32 only exists in newer versions of Node, so the checksum is worked out here)
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const { createWorld, USERS } = require("./harness.cjs");
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Small real files of each kind
function png(w = 4, h = 3) {
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(t), d])) >>> 0); return Buffer.concat([len, Buffer.from(t), d, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.alloc((w * 3 + 1) * h, 120);
  for (let y = 0; y < h; y++) rows[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}
const pad = (head, size) => Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 7)]);
const FILES = {
  png: png(),
  jpg: pad(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]), 400),
  gif: pad(Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00\x00", "latin1"), 300),
  webp: pad(Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 ")]), 300),
  mp4: pad(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.from([0, 0, 2, 0]), Buffer.from("isomiso2")]), 5000),
  mov: pad(Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from("ftypqt  "), Buffer.from([0, 0, 2, 0])]), 5000),
  webm: pad(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 0x42, 0xf7, 0x81]), 5000),
  heic: pad(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.from([0, 0, 0, 0])]), 2000),
  m4a: pad(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypM4A "), Buffer.from([0, 0, 0, 0])]), 2000),
  pdf: pad(Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1"), 800),
  exe: pad(Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00", "latin1"), 800),
  svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  txt: Buffer.from("just some words in a file"),
};
const file = (kind, extra = {}) => ({ name: "thing." + kind, bytes: new Uint8Array(FILES[kind]), width: 800, height: 600, ...extra });

(async () => {
  const w = await createWorld(path.resolve(process.argv[2]));
  const A = w.login("A"), B = w.login("B"), C = w.login("C"), D = w.login("D");
  const ok = async (p) => { const r = await p; if (!r.success) throw new Error("call failed: " + r.error); return r.data; };
  for (const s of [A, B, C, D]) await ok(s.call("start"));
  await ok(A.call("requestFriend", USERS.B.id)); await ok(B.call("requestFriend", USERS.A.id));
  await ok(A.call("requestFriend", USERS.C.id)); await ok(C.call("requestFriend", USERS.A.id));
  const AB = await ok(A.call("openConversation", USERS.B.id)), AC = await ok(A.call("openConversation", USERS.C.id));
  await sleep(350); for (const s of [A, B, C, D]) s.events.length = 0;
  const stored = async () => Number((await w.run(null, "select count(*)::int n from storage.objects")).rows[0].n);
  const rows = async () => Number((await w.run(null, "select count(*)::int n from public.messages")).rows[0].n);

  console.log("1. Sending a picture");
  B.focused = false; w.notifications.length = 0;
  let m = await ok(A.call("sendMedia", AB, file("png", { name: "boss fight.png" }), "  look at this  "));
  check("comes back as a message with the file's details", m.senderId === USERS.A.id && m.content === "look at this" && m.media && m.media.kind === "image" && m.media.mime === "image/png" && m.media.size === FILES.png.length && m.media.width === 800 && m.media.height === 600 && m.media.name === "boss fight.png", m);
  check("stored under the conversation's folder with a random name", new RegExp("^" + AB + "/[0-9a-f-]{36}\\.png$").test(m.media.path), m.media.path);
  const up = w.uploads[w.uploads.length - 1];
  check("uploaded to the private bucket, never overwriting", up.bucket === "message-media" && up.opts.contentType === "image/png" && up.opts.upsert === false && up.uid === USERS.A.id, up);
  check("the bytes stored are exactly the file", w.files.get("message-media/" + m.media.path).bytes.equals(FILES.png));
  await sleep(60);
  let ev = B.events.find((e) => e.type === "message");
  check("the friend's window gets it live, file details included", ev && ev.message.id === m.id && ev.message.media && ev.message.media.path === m.media.path && ev.message.media.kind === "image", ev);
  check("with AURA in the background, Windows shows the caption", w.notifications.length === 1 && w.notifications[0].opts.title === "tctray" && w.notifications[0].opts.body === "look at this", w.notifications.map((n) => n.opts));
  check("the third friend's window hears nothing", !C.events.some((e) => e.type === "message"));

  console.log("2. No caption, and each kind of file");
  await sleep(8100); w.notifications.length = 0; // past the quiet time for notifications
  let g = await ok(A.call("sendMedia", AB, file("gif"), ""));
  check("a GIF with no words sends", g.content === "" && g.media.mime === "image/gif" && /\.gif$/.test(g.media.path), g);
  await sleep(60);
  check("Windows says what it was instead", w.notifications.length === 1 && w.notifications[0].opts.body === "Sent a GIF", w.notifications.map((n) => n.opts));
  const kinds = {};
  for (const k of ["jpg", "webp", "mp4", "mov", "webm"]) { const r = await ok(B.call("sendMedia", AB, file(k), null)); kinds[k] = r.media.kind + " " + r.media.mime + " " + r.media.path.split(".").pop(); await sleep(8); }
  check("JPG, WebP, MP4, MOV and WebM are each recognised", JSON.stringify(kinds) === JSON.stringify({ jpg: "image image/jpeg jpg", webp: "image image/webp webp", mp4: "video video/mp4 mp4", mov: "video video/quicktime mov", webm: "video video/webm webm" }), kinds);
  let listA = await ok(A.call("listConversations"));
  let ab = listA.find((c) => c.id === AB);
  check("the conversation list says the last message was a video", ab.lastMedia === "Video" && ab.lastMessage === "" && ab.lastSenderId === USERS.B.id && ab.unread === 5, ab);
  check("a conversation with only text has no file label", listA.find((c) => c.id === AC).lastMedia === "");
  let page = await ok(B.call("getMessages", AB));
  check("history returns all seven, oldest first, with their files", page.messages.length === 7 && page.messages[0].id === m.id && page.messages.every((x) => x.media && x.media.path) && page.messages[6].media.mime === "video/webm", page.messages.map((x) => x.media && x.media.mime));
  let t = await ok(A.call("sendMessage", AB, "plain words still work"));
  check("a plain text message has no file", t.media === null && t.content === "plain words still work", t);

  console.log("3. Viewing links");
  let links = await ok(B.call("mediaUrls", [m.media.path, g.media.path]));
  check("the friend gets a link for each file", Object.keys(links.urls).length === 2 && links.urls[m.media.path].includes("/media/message-media/" + m.media.path) && links.seconds >= 3600, links);
  check("the sender does too", Object.keys((await ok(A.call("mediaUrls", [m.media.path]))).urls).length === 1);
  check("someone outside the conversation gets none, even knowing the exact path", Object.keys((await ok(C.call("mediaUrls", [m.media.path, g.media.path]))).urls).length === 0);
  check("and a stranger gets none", Object.keys((await ok(D.call("mediaUrls", [m.media.path]))).urls).length === 0);
  const before = w.tokens.size;
  const odd = await ok(A.call("mediaUrls", ["../" + m.media.path, AB + "/../../x.png", "avatars/x.png", 42, null, m.media.path + "?x=1", { path: m.media.path }]));
  check("paths that aren't message files are never asked for", Object.keys(odd.urls).length === 0 && w.tokens.size === before, odd);
  check("nothing asked: nothing sent", Object.keys((await ok(A.call("mediaUrls", []))).urls).length === 0 && Object.keys((await ok(A.call("mediaUrls", "x"))).urls).length === 0);
  check("the same file asked twice is looked up once", (await ok(A.call("mediaUrls", [m.media.path, m.media.path])) , w.tokens.size === before + 1), w.tokens.size - before);

  console.log("4. Files that are refused before anything is uploaded");
  let n0 = await stored(), r0 = await rows(), u0 = w.uploads.length;
  const refused = async (f, caption) => (await A.call("sendMedia", AB, f, caption)).error || "";
  check("a PDF", /can't be sent/.test(await refused(file("pdf"))));
  check("a program renamed to .png", /can't be sent/.test(await refused(file("exe", { name: "totally-a-picture.png" }))));
  check("an SVG (can carry scripts)", /can't be sent/.test(await refused(file("svg"))));
  check("a text file", /can't be sent/.test(await refused(file("txt"))));
  check("an iPhone HEIC photo and an audio file (same container as MP4)", /can't be sent/.test(await refused(file("heic"))) && /can't be sent/.test(await refused(file("m4a"))));
  check("an empty file", /empty/.test(await refused({ name: "x.png", bytes: new Uint8Array(0) })));
  check("no file at all", /couldn't be read/.test(await refused(null)) && /couldn't be read/.test(await refused({ name: "x.png" })) && /couldn't be read/.test(await refused({ name: "x.png", bytes: "C:\\Users\\tctra\\secrets.txt" })));
  const bigPic = { name: "huge.png", bytes: new Uint8Array(Buffer.concat([FILES.png, Buffer.alloc(10 * 1024 * 1024)])) };
  const pic = await refused(bigPic);
  check("a picture over 10 MB, saying both sizes", /up to 10 MB/.test(pic) && /This one is 10 MB/.test(pic), pic);
  const bigVid = await refused({ name: "long.mp4", bytes: new Uint8Array(Buffer.concat([FILES.mp4, Buffer.alloc(50 * 1024 * 1024)])) });
  check("a video over 50 MB", /Videos can be up to 50 MB/.test(bigVid), bigVid);
  check("a caption over 4,000 characters", /too long/.test(await refused(file("png"), "x".repeat(4001))));
  check("a made-up conversation id", /isn't valid/.test((await A.call("sendMedia", "nope", file("png"), "")).error));
  check("none of those uploaded or saved anything", (await stored()) === n0 && (await rows()) === r0 && w.uploads.length === u0, [await stored() - n0, await rows() - r0, w.uploads.length - u0]);
  let ok2 = await ok(A.call("sendMedia", AB, { name: "a/b\\c\u0000d" + "n".repeat(300) + ".png", bytes: FILES.png, width: -5, height: "wide" }, ""));
  check("odd names and sizes are tidied, not trusted", ok2.media.name.length === 200 && !/[\\/\u0000]/.test(ok2.media.name) && ok2.media.width === null && ok2.media.height === null, ok2.media);
  let ok3 = await ok(A.call("sendMedia", AB, { name: "plain buffer.png", bytes: FILES.png.buffer.slice(FILES.png.byteOffset, FILES.png.byteOffset + FILES.png.length) }, ""));
  check("bytes arriving as a plain ArrayBuffer work too", ok3.media.size === FILES.png.length && w.files.get("message-media/" + ok3.media.path).bytes.equals(FILES.png));

  console.log("5. People who shouldn't be able to");
  n0 = await stored(); r0 = await rows();
  let e = (await D.call("sendMedia", AB, file("png"), "")).error;
  check("a stranger can't post into someone's conversation", e === "You can only message friends.", e);
  e = (await C.call("sendMedia", AB, file("png"), "")).error;
  check("nor can a friend of only one of them", e === "You can only message friends.", e);
  check("nothing was stored for either", (await stored()) === n0 && (await rows()) === r0);
  w.setOffline("A", true);
  check("offline: says so", /offline/i.test((await A.call("sendMedia", AB, file("png"), "")).error) && /offline/i.test((await A.call("mediaUrls", [m.media.path])).error));
  w.setOffline("A", false);
  const fs = await ok(A.call("listFriends"));
  await ok(A.call("removeFriend", fs.find((f) => f.userId === USERS.B.id).friendshipId));
  e = (await A.call("sendMedia", AB, file("png"), "")).error;
  check("after removing the friend: can't send files", e === "You can only message friends." && (await stored()) === n0, e);
  check("but both can still open the old ones", Object.keys((await ok(A.call("mediaUrls", [m.media.path]))).urls).length === 1 && Object.keys((await ok(B.call("mediaUrls", [m.media.path]))).urls).length === 1);

  console.log(failed ? "\n" + failed + " FAILED" : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST CRASHED:", e); process.exit(2); });
