// Emoji reactions and voice messages: the real social.js for several users, the real SQL
// (aura-messages-emoji-voice.sql), a stand-in for Storage. Added by aura-messages-emoji-voice-setup.cjs.
const fs = require("fs");
const path = require("path");
const { createWorld, USERS } = require("./harness.cjs");
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What AURA's recorder makes: WebM, Opus sound, no picture (just the parts the check looks at)
const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const pad = (head, size) => Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 7)]);
const recording = (size = 6000) => pad(Buffer.concat([EBML, Buffer.from("\x42\x82\x84webm\x16\x54\xae\x6b\x86\x81A_OPUS", "latin1")]), size);
const video = () => pad(Buffer.concat([EBML, Buffer.from("\x42\x82\x84webm\x86\x85V_VP8\x86\x86A_OPUS", "latin1")]), 6000);

(async () => {
  const w = await createWorld(path.resolve(process.argv[2]));
  const A = w.login("A"), B = w.login("B"), D = w.login("D");
  const ok = async (p) => { const r = await p; if (!r.success) throw new Error("call failed: " + r.error); return r.data; };
  const err = async (p) => (await p).error || "";
  for (const s of [A, B, D]) await ok(s.call("start"));
  await ok(A.call("requestFriend", USERS.B.id)); await ok(B.call("requestFriend", USERS.A.id));
  const AB = await ok(A.call("openConversation", USERS.B.id));
  const gg = await ok(A.call("sendMessage", AB, "gg that was close"));
  const thread = async (who) => (await ok(who.call("getMessages", AB))).messages;
  const voice = (who, bytes, seconds, extra = {}) => who.call("sendMedia", AB, { name: "", bytes: new Uint8Array(bytes), voice: true, seconds, ...extra }, "");
  await sleep(200);

  console.log("1. On a database without the update");
  check("messages still load", (await thread(A)).length === 1);
  check("👍 still works", (await ok(B.call("react", gg.id, "like"))).reaction === "like");
  check("an emoji says which file to run in Supabase", /aura-messages-emoji-voice\.sql/.test(await err(B.call("react", gg.id, "love"))));
  const uploadsBefore = w.uploads.length;
  check("a voice message says which file to run", /aura-messages-emoji-voice\.sql/.test(await err(voice(A, recording(), 4))));
  check("...and nothing is left behind", (await thread(A)).length === 1 && w.uploads.length - w.removals.length <= uploadsBefore);

  console.log("2. Emoji reactions");
  await w.run(null, "select 1");
  await w.db.exec(fs.readFileSync(path.join(__dirname, "..", "..", "supabase", "aura-messages-emoji-voice.sql"), "utf8"));
  for (const s of [A, B, D]) { await ok(s.call("stop")); await ok(s.call("start")); } // AURA checks again when it starts
  await sleep(100); A.events.length = 0;
  check("❤️ works", (await ok(B.call("react", gg.id, "love"))).reaction === "love");
  await sleep(80);
  const ev = A.events.filter((e) => e.type === "reaction");
  check("...the other person is told it's ❤️", ev.length === 1 && ev[0].reaction === "love" && ev[0].userId === USERS.B.id, ev);
  check("...it's in the history", JSON.stringify((await thread(A))[0].reactions) === JSON.stringify([{ userId: USERS.B.id, reaction: "love" }]));
  for (const f of ["laugh", "wow", "sad", "angry", "fire", "dislike"]) await ok(B.call("react", gg.id, f));
  check("every emoji works, one each", JSON.stringify((await thread(A))[0].reactions) === JSON.stringify([{ userId: USERS.B.id, reaction: "dislike" }]));
  check("a made-up one is refused before asking Supabase", /isn't a reaction AURA knows/.test(await err(B.call("react", gg.id, "meh"))));
  check("a stranger can't react", /isn't in one of your conversations/.test(await err(D.call("react", gg.id, "fire"))));

  console.log("3. Sending a voice message");
  B.focused = false;
  const noted = w.notifications.length;
  B.events.length = 0;
  const sent = await ok(voice(A, recording(), 7));
  check("it's saved as a recording, with its length", sent.media?.kind === "audio" && sent.media.mime === "audio/webm" && sent.media.seconds === 7 && /\.weba$/.test(sent.media.path) && sent.content === "", sent.media);
  check("...uploaded to the chat's private folder as audio/webm", w.uploads.some((u) => u.path === sent.media.path && u.opts.contentType === "audio/webm" && u.path.startsWith(AB + "/")));
  await sleep(150);
  const live = B.events.find((e) => e.type === "message" && e.message.id === sent.id);
  check("the other person gets it live, with its length", live?.message.media?.kind === "audio" && live.message.media.seconds === 7, live);
  check("...and a notice: “Sent a voice message”", w.notifications.slice(noted).some((n) => /Sent a voice message/.test(n.opts.body)), w.notifications.slice(noted).map((n) => n.opts));
  const hist = (await thread(B)).find((m) => m.id === sent.id);
  check("it's in the history with its length", hist?.media?.seconds === 7);
  const urls = await ok(B.call("mediaUrls", [sent.media.path]));
  check("the other person can get a link to play it", typeof urls.urls[sent.media.path] === "string");
  check("a stranger can't", !Object.keys((await D.call("mediaUrls", [sent.media.path])).data?.urls || {}).length);
  const list = await ok(B.call("listConversations"));
  check("the chat list calls it a voice message", list.find((c) => c.id === AB)?.lastMedia === "Voice message", list.find((c) => c.id === AB));
  check("a pictures-and-videos message still has no length", (await ok(A.call("sendMedia", AB, { name: "clip.webm", bytes: new Uint8Array(pad(EBML, 5000)) }, ""))).media.seconds === null);

  console.log("4. What's refused");
  check("a video passed off as a recording", /couldn't be read/.test(await err(voice(A, video(), 5))));
  check("something that isn't a recording at all", /couldn't be read/.test(await err(voice(A, pad(Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), 3000), 5))));
  check("longer than 2 minutes", /1 second to 2 minutes/.test(await err(voice(A, recording(), 121))));
  check("no length", /1 second to 2 minutes/.test(await err(voice(A, recording(), 0))));
  check("bigger than 5 MB", /Voice messages can be up to 5\.0 MB/.test(await err(voice(A, recording(5 * 1024 * 1024 + 10), 60))));
  check("a stranger can't send one into the chat", !!(await err(D.call("sendMedia", AB, { name: "", bytes: new Uint8Array(recording()), voice: true, seconds: 3 }, ""))));

  console.log("5. Deleting it");
  await ok(A.call("deleteMessage", sent.id));
  check("its file is removed from storage", w.removals.some((r) => r.paths.includes(sent.media.path) && r.removed === 1) && !w.files.has("message-media/" + sent.media.path), w.removals.slice(-2));
  const after = (await thread(B)).find((m) => m.id === sent.id);
  check("...and the other person sees it deleted, with no file", after?.deleted === true && after.media === null);

  for (const s of [A, B, D]) await s.call("stop");
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log("  FAIL  the test ran to the end  " + (e?.stack || e)); process.exit(1); });
