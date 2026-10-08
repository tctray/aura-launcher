// Likes and dislikes: the real social.js for several users, the real SQL.
const path = require("path");
const { createWorld, USERS } = require("./harness.cjs");
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const m1 = await say(A, AB, "did you see the trailer?"), m2 = await say(B, AB, "looks great"), mc = await say(A, AC, "for Marcus only");
  await sleep(300); for (const s of [A, B, C, D]) s.events.length = 0;
  const events = (s) => s.events.filter((e) => e.type === "reaction");
  const thread = async (who, conv = AB) => (await ok(who.call("getMessages", conv))).messages;
  const on = (list, id) => list.find((m) => m.id === id).reactions;
  const noted = w.notifications.length;
  B.focused = false; A.focused = false; // nobody has AURA in front: a like must still not raise a Windows notification

  console.log("1. Liking a message");
  check("a message with nothing on it has an empty list", JSON.stringify(on(await thread(A), m1.id)) === "[]");
  let r = await ok(B.call("react", m1.id, "like"));
  check("liking answers with whose it is and what it is", r.messageId === m1.id && r.userId === USERS.B.id && r.reaction === "like", r);
  await sleep(80);
  check("the other person's AURA is told straight away: which message, which chat, who, what", events(A).length === 1 && events(A)[0].messageId === m1.id && events(A)[0].conversationId === AB && events(A)[0].userId === USERS.B.id && events(A)[0].reaction === "like", events(A));
  check("yours is told too (so another PC of yours updates)", events(B).length === 1 && events(B)[0].reaction === "like");
  check("nobody outside the chat hears about it", events(C).length === 0 && events(D).length === 0);
  check("it's in the history for both people", JSON.stringify(on(await thread(A), m1.id)) === JSON.stringify([{ userId: USERS.B.id, reaction: "like" }]) && JSON.stringify(on(await thread(B), m1.id)) === JSON.stringify([{ userId: USERS.B.id, reaction: "like" }]), on(await thread(A), m1.id));
  check("other messages are untouched", on(await thread(A), m2.id).length === 0);
  check("no Windows notification for a like", w.notifications.length === noted, w.notifications.slice(noted).map((n) => n.opts));

  console.log("2. Changing it and taking it back");
  A.events.length = 0; B.events.length = 0;
  await ok(B.call("react", m1.id, "dislike")); await sleep(60);
  check("changing to a dislike is told to the other person", events(A).length === 1 && events(A)[0].reaction === "dislike" && events(A)[0].userId === USERS.B.id, events(A));
  check("the history shows one, the new one", JSON.stringify(on(await thread(A), m1.id)) === JSON.stringify([{ userId: USERS.B.id, reaction: "dislike" }]));
  await ok(A.call("react", m1.id, "like")); await sleep(60);
  let both = on(await thread(B), m1.id);
  check("each person has their own", both.length === 2 && both.find((x) => x.userId === USERS.A.id).reaction === "like" && both.find((x) => x.userId === USERS.B.id).reaction === "dislike", both);
  A.events.length = 0;
  r = await ok(B.call("react", m1.id, null)); await sleep(60);
  check("taking it back is told too, as nothing", r.reaction === null && events(A).length === 1 && events(A)[0].reaction === null && events(A)[0].userId === USERS.B.id, events(A));
  check("and it's gone from the history, leaving the other person's", JSON.stringify(on(await thread(B), m1.id)) === JSON.stringify([{ userId: USERS.A.id, reaction: "like" }]));

  console.log("3. What is refused");
  check("a made-up id is refused before asking Supabase", /isn't valid/.test(await err(A.call("react", "nope", "like"))));
  check("only like and dislike exist", /isn't a reaction AURA knows/.test(await err(A.call("react", m1.id, "love"))) && /isn't a reaction AURA knows/.test(await err(A.call("react", m1.id, { reaction: "like" }))));
  A.events.length = 0; B.events.length = 0;
  check("someone outside the chat can't react to a message in it", /isn't in one of your conversations/.test(await err(C.call("react", m1.id, "like"))));
  check("a stranger can't either", /isn't in one of your conversations/.test(await err(D.call("react", m2.id, "dislike"))));
  await sleep(60);
  check("and the people in the chat hear nothing", events(A).length === 0 && events(B).length === 0);
  check("someone outside the chat sees no likes in it", !(await ok(C.call("getMessages", AB))).messages.length);

  console.log("4. Deleting a message that has likes");
  await ok(B.call("react", m1.id, "like")); await sleep(60);
  A.events.length = 0; B.events.length = 0;
  await ok(A.call("deleteMessage", m1.id)); await sleep(80);
  check("both people are told the likes are gone", events(B).length === 2 && events(B).every((e) => e.messageId === m1.id && e.reaction === null), events(B));
  check("the deleted message carries none", on(await thread(B), m1.id).length === 0 && (await thread(B)).find((m) => m.id === m1.id).deleted === true);
  check("it can't be liked any more", /was deleted/.test(await err(B.call("react", m1.id, "like"))));

  console.log("5. Friends only, and trouble");
  await ok(C.call("react", mc.id, "like")); await sleep(40);
  const friendship = (await ok(A.call("listFriends"))).find((f) => f.userId === USERS.C.id).friendshipId;
  await ok(A.call("removeFriend", friendship)); await sleep(60);
  check("after you stop being friends you can't add one", /only react to messages from friends/.test(await err(C.call("react", mc.id, "dislike"))));
  check("but you can take yours back", (await ok(C.call("react", mc.id, null))).reaction === null && on(await thread(A, AC), mc.id).length === 0);
  w.setOffline("B", true); await sleep(20);
  check("offline: says so", /offline/i.test(await err(B.call("react", m2.id, "like"))));
  w.setOffline("B", false); await sleep(20);
  check("back online: works", (await ok(B.call("react", m2.id, "like"))).reaction === "like");
  // If the likes can't be read for some reason, the messages themselves must still load
  await w.run(null, "revoke select on public.message_reactions from authenticated");
  const still = await A.call("getMessages", AB);
  check("messages still load when the likes can't be fetched", still.success && still.data.messages.length === 2 && still.data.messages.every((m) => Array.isArray(m.reactions) && m.reactions.length === 0), still);
  await w.run(null, "grant select on public.message_reactions to authenticated");
  check("and the likes are back once they can be", on(await thread(A), m2.id).length === 1);
  check("still no Windows notifications from any of this", w.notifications.length === noted, w.notifications.slice(noted).map((n) => n.opts));

  console.log(failed ? "\n" + failed + " FAILED" : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST CRASHED:", e); process.exit(2); });
