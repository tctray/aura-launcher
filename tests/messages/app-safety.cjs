// Deleting, blocking and reporting: the real social.js for several users, the real SQL, a stand-in for Storage.
const path = require("path");
const { createWorld, USERS } = require("./harness.cjs");
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 9)]);
const pic = (name = "a.png") => ({ name, bytes: new Uint8Array(PNG), width: 40, height: 30 });

(async () => {
  const w = await createWorld(path.resolve(process.argv[2]));
  const A = w.login("A"), B = w.login("B"), C = w.login("C"), D = w.login("D");
  const ok = async (p) => { const r = await p; if (!r.success) throw new Error("call failed: " + r.error); return r.data; };
  const err = async (p) => (await p).error || "";
  for (const s of [A, B, C, D]) await ok(s.call("start"));
  await ok(A.call("requestFriend", USERS.B.id)); await ok(B.call("requestFriend", USERS.A.id));
  await ok(A.call("requestFriend", USERS.C.id)); await ok(C.call("requestFriend", USERS.A.id));
  const AB = await ok(A.call("openConversation", USERS.B.id)), AC = await ok(A.call("openConversation", USERS.C.id));
  const say = async (who, conv, text) => { await sleep(6); return ok(who.call("sendMessage", conv, text)); };
  const m1 = await say(A, AB, "first"), m2 = await say(B, AB, "second from Alex");
  await sleep(6); const m3 = await ok(A.call("sendMedia", AB, pic("mine.png"), "my picture"));
  await sleep(6); const m4 = await ok(B.call("sendMedia", AB, pic("theirs.png"), ""));
  await sleep(400); for (const s of [A, B, C, D]) s.events.length = 0;
  const events = (s, type) => s.events.filter((e) => e.type === type);
  const fileCount = () => w.files.size;
  const thread = async (who) => (await ok(who.call("getMessages", AB))).messages;

  console.log("1. Deleting your own message");
  check("new messages aren't marked deleted", m1.deleted === false && m3.deleted === false);
  check("you can't delete someone else's", (await err(A.call("deleteMessage", m2.id))) === "You can only delete your own messages.");
  check("someone outside the chat can't delete anything in it", /only delete your own/.test(await err(C.call("deleteMessage", m1.id))));
  check("a made-up id is refused before asking Supabase", /isn't valid/.test(await err(A.call("deleteMessage", "nope"))));
  check("deleting works", (await ok(A.call("deleteMessage", m1.id))) === true);
  await sleep(80);
  let ev = events(B, "deleted");
  check("the other person's AURA is told which message, with nothing left in it", ev.length === 1 && ev[0].message.id === m1.id && ev[0].message.deleted === true && ev[0].message.content === "" && ev[0].message.media === null && ev[0].message.conversationId === AB, ev);
  check("yours is told too (so another PC of yours updates)", events(A, "deleted").length === 1);
  check("nobody outside the chat hears about it", events(C, "deleted").length === 0 && events(D, "deleted").length === 0);
  let t = await thread(B);
  check("in the history it is still in its place, marked deleted, words gone", t.length === 4 && t[0].id === m1.id && t[0].deleted && t[0].content === "" && !t[1].deleted && t[1].content === "second from Alex", t.map((x) => [x.content, x.deleted]));
  check("no Windows notification for a deletion", w.notifications.every((n) => !/delet/i.test(n.opts.body)));

  console.log("2. Deleting a message that has a file");
  const before = fileCount();
  check("the file exists and both can open it", before === 2 && Object.keys((await ok(B.call("mediaUrls", [m3.media.path]))).urls).length === 1);
  await ok(A.call("deleteMessage", m3.id)); await sleep(60);
  check("the file is removed from storage, not just hidden", fileCount() === before - 1 && !w.files.has("message-media/" + m3.media.path) && Number((await w.run(null, "select count(*)::int n from storage.objects where name = $1", [m3.media.path])).rows[0].n) === 0);
  check("neither person can get a link to it any more", Object.keys((await ok(B.call("mediaUrls", [m3.media.path]))).urls).length === 0 && Object.keys((await ok(A.call("mediaUrls", [m3.media.path]))).urls).length === 0);
  t = await thread(B);
  check("the message shows as deleted with no file and no caption", t[2].id === m3.id && t[2].deleted && t[2].media === null && t[2].content === "", t[2]);
  check("the other person's file is untouched", w.files.has("message-media/" + m4.media.path));
  check("deleting the same message again is harmless", (await ok(A.call("deleteMessage", m3.id))) === true && fileCount() === before - 1);

  console.log("3. Unread counts and previews");
  const u1 = await say(B, AB, "oops wrong chat");
  let la = (await ok(A.call("listConversations"))).find((c) => c.id === AB);
  check("a new message counts as unread", la.unread >= 1 && la.lastMessage === "oops wrong chat", la);
  const unreadBefore = la.unread;
  await ok(B.call("deleteMessage", u1.id));
  la = (await ok(A.call("listConversations"))).find((c) => c.id === AB);
  check("deleting it takes it off the unread count and out of the preview", la.unread === unreadBefore - 1 && la.lastMessage === "" && la.lastMedia === "" && la.lastSenderId === USERS.B.id, la);
  A.events.length = 0; B.events.length = 0;
  await ok(A.call("markRead", AB)); await sleep(60);
  check("messages being marked read don't look like deletions", events(A, "deleted").length === 0 && events(B, "deleted").length === 0, [A.events, B.events]);

  console.log("4. Reporting");
  check("a reason is needed", (await err(A.call("reportUser", USERS.B.id, {}))) === "Pick a reason for the report." && (await err(A.call("reportUser", USERS.B.id, { reason: "because" }))) === "Pick a reason for the report.");
  check("details over 1,000 characters are refused", /under 1,000/.test(await err(A.call("reportUser", USERS.B.id, { reason: "other", details: "x".repeat(1001) }))));
  check("reporting a person works", (await ok(A.call("reportUser", USERS.B.id, { reason: "harassment", details: "  keeps at it\r\n  " }))) === true);
  check("reporting one of their messages works", (await ok(A.call("reportUser", USERS.B.id, { reason: "inappropriate", messageId: m4.id }))) === true);
  check("you can't report your own message, or one from another chat", /can't be reported/.test(await err(A.call("reportUser", USERS.B.id, { reason: "spam", messageId: m1.id }))) && /can't be reported/.test(await err(C.call("reportUser", USERS.B.id, { reason: "spam", messageId: m2.id }))));
  check("or yourself", /can't report yourself/.test(await err(A.call("reportUser", USERS.A.id, { reason: "spam" }))));
  let reps = (await w.run(null, "select * from public.reports order by created_at")).rows;
  check("the owner's table has both, with names, reason and tidied details", reps.length === 2 && reps[0].reporter_name === "tctray" && reps[0].reported_name === "Alex" && reps[0].reason === "harassment" && reps[0].details === "keeps at it" && reps[1].message_id === m4.id && reps[1].message_media_path === m4.media.path, reps);
  check("the reported person isn't told", B.events.every((e) => !/report/i.test(JSON.stringify(e))));
  const fc = fileCount();
  await ok(B.call("deleteMessage", m4.id));
  check("if they delete the reported message, it goes from the chat but its file is kept for review", (await thread(A))[3].deleted === true && fileCount() === fc && w.files.has("message-media/" + m4.media.path));
  check("and the report still has the copy", (await w.run(null, "select message_media_path from public.reports where message_id = $1", [m4.id])).rows[0].message_media_path === m4.media.path);

  console.log("5. Blocking");
  A.events.length = 0; B.events.length = 0;
  await ok(A.call("listFriends")); await ok(B.call("listFriends")); // as AURA does when it starts
  check("your blocked list starts empty", (await ok(A.call("listBlocked"))).length === 0);
  check("blocking works", (await ok(A.call("blockUser", USERS.B.id))) === true);
  await sleep(400);
  check("both AURAs are told the friendship changed (to them it looks like being unfriended)", events(A, "friends").length >= 1 && events(B, "friends").length >= 1, [A.events, B.events]);
  const bl = await ok(A.call("listBlocked"));
  check("they are in your blocked list by name", bl.length === 1 && bl[0].userId === USERS.B.id && bl[0].username === "Alex", bl);
  check("their own blocked list says nothing", (await ok(B.call("listBlocked"))).length === 0);
  check("gone from each other's friends", (await ok(A.call("listFriends"))).every((f) => f.userId !== USERS.B.id) && (await ok(B.call("listFriends"))).every((f) => f.userId !== USERS.A.id));
  check("they can't message you", (await err(B.call("sendMessage", AB, "hello?"))) === "You can only message friends.");
  check("or send a file", (await err(B.call("sendMedia", AB, pic(), ""))) === "You can only message friends.");
  check("or send a friend request, and aren't told why", (await err(B.call("requestFriend", USERS.A.id))) === "You can't add this person.");
  check("or set the chat's background", /friend/.test(await err(B.call("setBackground", AB, { name: "x.png", bytes: new Uint8Array(PNG) }))));
  check("you are told to unblock before adding them", (await err(A.call("requestFriend", USERS.B.id))) === "You've blocked this person. Unblock them to add them again.");
  check("your other friends are unaffected", (await ok(A.call("sendMessage", AC, "still here"))).content === "still here");
  check("report and block in one step", (await ok(A.call("reportUser", USERS.C.id, { reason: "spam", block: true }))) === true && (await ok(A.call("listBlocked"))).length === 2);
  check("unblocking works", (await ok(A.call("unblockUser", USERS.B.id))) === true && (await ok(A.call("listBlocked"))).length === 1);
  check("after unblocking you can add each other again", (await ok(B.call("requestFriend", USERS.A.id))) === "sent" && (await ok(A.call("requestFriend", USERS.B.id))) === "accepted" && (await ok(B.call("sendMessage", AB, "sorry"))).content === "sorry");
  w.setOffline("A", true);
  check("offline: each says so", /offline/i.test(await err(A.call("blockUser", USERS.B.id))) && /offline/i.test(await err(A.call("deleteMessage", m2.id))) && /offline/i.test(await err(A.call("reportUser", USERS.B.id, { reason: "spam" }))));
  w.setOffline("A", false);

  console.log(failed ? "\n" + failed + " FAILED" : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST CRASHED:", e); process.exit(2); });
