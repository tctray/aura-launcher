// A chat's shared background: the real social.js for several users, the real SQL, a stand-in for Storage.
const path = require("path");
const { createWorld, USERS } = require("./harness.cjs");
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (head, size) => Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 7)]);
const JPG = pad(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]), 9000);
const PNG = pad(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), 7000);
const GIF = pad(Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00\x00", "latin1"), 300);
const MP4 = pad(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.from([0, 0, 2, 0])]), 5000);
const PDF = pad(Buffer.from("%PDF-1.7\n", "latin1"), 800);
const pic = (bytes, name = "wall.jpg") => ({ name, bytes: new Uint8Array(bytes) });

(async () => {
  const w = await createWorld(path.resolve(process.argv[2]));
  const A = w.login("A"), B = w.login("B"), C = w.login("C"), D = w.login("D");
  const ok = async (p) => { const r = await p; if (!r.success) throw new Error("call failed: " + r.error); return r.data; };
  for (const s of [A, B, C, D]) await ok(s.call("start"));
  await ok(A.call("requestFriend", USERS.B.id)); await ok(B.call("requestFriend", USERS.A.id));
  await ok(A.call("requestFriend", USERS.C.id)); await ok(C.call("requestFriend", USERS.A.id));
  const AB = await ok(A.call("openConversation", USERS.B.id)), AC = await ok(A.call("openConversation", USERS.C.id));
  await sleep(400); for (const s of [A, B, C, D]) s.events.length = 0;
  const bgEvents = (s) => s.events.filter((e) => e.type === "background");
  const stored = async () => Number((await w.run(null, "select count(*)::int n from storage.objects")).rows[0].n);
  const current = async (conv) => (await w.run(null, "select path, set_by from public.conversation_backgrounds where conversation_id = $1", [conv])).rows[0] || null;

  console.log("1. Setting a background for a chat");
  check("live messages are connected for everyone", A.events.concat(B.events).every((e) => e.type !== "live" || e.connected));
  let bg = await ok(A.call("setBackground", AB, pic(JPG)));
  check("comes back with where the picture is and who set it", bg && new RegExp("^" + AB + "/[0-9a-f-]{36}\\.jpg$").test(bg.path) && bg.by === USERS.A.id, bg);
  check("the picture is in the chat's private folder, exactly as sent", w.files.get("message-media/" + bg.path).bytes.equals(JPG) && w.uploads[w.uploads.length - 1].opts.contentType === "image/jpeg");
  await sleep(80);
  check("the other person's AURA is told straight away", bgEvents(B).length === 1 && bgEvents(B)[0].conversationId === AB && bgEvents(B)[0].background.path === bg.path && bgEvents(B)[0].by === USERS.A.id, bgEvents(B));
  check("nobody else's is", bgEvents(C).length === 0 && bgEvents(D).length === 0);
  let listB = await ok(B.call("listConversations"));
  check("it's on the chat in the other person's list", listB.length === 1 && listB[0].background && listB[0].background.path === bg.path && listB[0].background.by === USERS.A.id, listB[0]);
  let listA = await ok(A.call("listConversations"));
  check("only that chat has it", listA.find((c) => c.id === AB).background.path === bg.path && listA.find((c) => c.id === AC).background === null);
  check("both can open the picture", Object.keys((await ok(B.call("mediaUrls", [bg.path]))).urls).length === 1 && Object.keys((await ok(A.call("mediaUrls", [bg.path]))).urls).length === 1);
  check("a friend of only one of them can't, and their list shows nothing", Object.keys((await ok(C.call("mediaUrls", [bg.path]))).urls).length === 0 && (await ok(C.call("listConversations"))).every((c) => c.background === null));

  console.log("2. The other person changes it, then removes it");
  A.events.length = 0; B.events.length = 0;
  let bg2 = await ok(B.call("setBackground", AB, pic(PNG, "other.png")));
  await sleep(80);
  check("the first person's AURA gets the new one", bgEvents(A).length === 1 && bgEvents(A)[0].background.path === bg2.path && bgEvents(A)[0].by === USERS.B.id && /\.png$/.test(bg2.path), bgEvents(A));
  A.events.length = 0; B.events.length = 0;
  check("removing returns nothing", (await ok(A.call("setBackground", AB, null))) === null);
  await sleep(80);
  check("and the other AURA is told it's gone", bgEvents(B).length === 1 && bgEvents(B)[0].background === null && bgEvents(B)[0].by === USERS.A.id, bgEvents(B));
  check("the list shows none again", (await ok(B.call("listConversations")))[0].background === null);

  console.log("3. Refused, with nothing uploaded");
  let n0 = await stored();
  const no = async (who, conv, file) => (await who.call("setBackground", conv, file)).error || "";
  check("a GIF, a video, a PDF", /has to be a picture/.test(await no(A, AB, pic(GIF))) && /has to be a picture/.test(await no(A, AB, pic(MP4))) && /has to be a picture/.test(await no(A, AB, pic(PDF, "x.jpg"))));
  check("a picture over 4 MB", /too big for a background/.test(await no(A, AB, pic(Buffer.concat([JPG, Buffer.alloc(4 * 1024 * 1024)])))));
  check("no bytes, or a file path instead of bytes", /couldn't be read/.test(await no(A, AB, { name: "x.jpg" })) && /couldn't be read/.test(await no(A, AB, { name: "x.jpg", bytes: "C:\\\\x.jpg" })));
  check("a made-up conversation id", /isn't valid/.test(await no(A, "nope", pic(JPG))));
  let e = await no(D, AB, pic(JPG));
  check("a stranger", e === "You can only set a background for a chat with a friend.", e);
  e = await no(C, AB, pic(JPG));
  check("a friend of only one of them", e === "You can only set a background for a chat with a friend.", e);
  e = await no(C, AB, null);
  check("someone outside can't remove it either", /isn't your conversation/.test(e), e);
  check("none of those stored anything or changed the chat", (await stored()) === n0 && (await current(AB)).path === null, [await stored() - n0, await current(AB)]);
  w.setOffline("A", true);
  check("offline: says so", /offline/i.test(await no(A, AB, pic(JPG))));
  w.setOffline("A", false);

  console.log("4. After removing the friend");
  bg = await ok(A.call("setBackground", AB, pic(JPG)));
  const fs = await ok(A.call("listFriends"));
  await ok(A.call("removeFriend", fs.find((f) => f.userId === USERS.B.id).friendshipId));
  e = await no(A, AB, pic(PNG));
  check("can't set a new one", e === "You can only set a background for a chat with a friend." && (await current(AB)).path === bg.path, e);
  check("can still remove the one that's there", (await ok(B.call("setBackground", AB, null))) === null && (await current(AB)).path === null);

  console.log(failed ? "\n" + failed + " FAILED" : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST CRASHED:", e); process.exit(2); });
