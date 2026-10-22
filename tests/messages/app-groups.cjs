// Group chats: the real social.js for several users, the real SQL (aura-messages-groups.sql).
// Added by aura-messages-groups-setup.cjs.
const fs = require("fs");
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
  // tctray is friends with Alex and with Marcus; Alex and Marcus aren't friends
  await ok(A.call("requestFriend", USERS.B.id)); await ok(B.call("requestFriend", USERS.A.id));
  await ok(A.call("requestFriend", USERS.C.id)); await ok(C.call("requestFriend", USERS.A.id));
  const AB = await ok(A.call("openConversation", USERS.B.id));
  await ok(A.call("sendMessage", AB, "hello Alex"));
  await sleep(300);
  const clear = () => { for (const s of [A, B, C, D]) s.events.length = 0; w.notifications.length = 0; };
  const events = (s, type) => s.events.filter((e) => e.type === type);
  const groupIn = async (s) => (await ok(s.call("listConversations"))).find((c) => c.isGroup) || null;

  console.log("1. On a database without the group update");
  check("the conversation list still loads", (await ok(A.call("listConversations"))).length === 1);
  check("making a group says which file to run", /aura-messages-groups\.sql/.test(await err(A.call("createGroup", "Squad", [USERS.B.id]))));

  console.log("2. Making a group");
  await w.run(null, "select 1"); // (as the database owner)
  await w.db.exec(fs.readFileSync(path.join(__dirname, "..", "..", "supabase", "aura-messages-groups.sql"), "utf8"));
  // Everyone restarts AURA after the update is run (live updates for groups start then)
  for (const s of [A, B, C, D]) { await ok(s.call("stop")); await ok(s.call("start")); }
  await sleep(200);
  check("a name is needed (checked before asking Supabase)", (await err(A.call("createGroup", "  ", [USERS.B.id]))) === "Give the group a name.");
  check("made-up people are refused", /isn't valid/.test(await err(A.call("createGroup", "Squad", ["nope"]))));
  check("more than 10 people are refused", /up to 10/.test(await err(A.call("createGroup", "Squad", Array.from({ length: 11 }, (_, i) => `0000000${i % 10}-0000-0000-0000-00000000000${Math.floor(i / 10)}`)))));
  check("someone who isn't your friend can't be put in", /only add friends/.test(await err(A.call("createGroup", "Squad", [USERS.B.id, USERS.D.id]))));
  clear();
  const G = await ok(A.call("createGroup", "Squad", [USERS.B.id, USERS.C.id]));
  check("making a group with two friends works", typeof G === "string" && G.length === 36);
  await sleep(700);
  check("the people added are told straight away", events(B, "groups").length >= 1 && events(C, "groups").length >= 1, { b: events(B, "groups").length, c: events(C, "groups").length });
  check("...and get the line saying it was made", events(B, "message").some((e) => e.message.conversationId === G && e.message.content === "👥 created the group"));
  check("someone outside hears nothing", events(D, "groups").length === 0 && events(D, "message").length === 0);
  let g = await groupIn(B);
  check("it's in their conversation list, as a group", !!g && g.id === G && g.isGroup && g.title === "Squad" && g.username === "Squad" && g.userId === null && g.isFriend === true, g);
  check("...with its members, and who made it", g.members.length === 3 && g.ownerId === USERS.A.id && g.members.find((m) => m.userId === USERS.A.id).owner && !g.members.find((m) => m.userId === USERS.C.id).isFriend, g.members);
  check("...one unread line, which is a note", g.unread === 1 && g.lastNote === true, g);
  check("chats of two are still listed alongside", (await ok(B.call("listConversations"))).some((c) => c.id === AB && !c.isGroup));

  console.log("3. Talking in it");
  clear();
  C.focused = false; // Marcus has AURA in the background
  const hi = await ok(B.call("sendMessage", G, "who's on tonight?"));
  await sleep(150);
  check("a message reaches everyone in the group", events(A, "message").some((e) => e.message.id === hi.id) && events(C, "message").some((e) => e.message.id === hi.id));
  check("...including Marcus, who isn't Alex's friend", events(C, "message").length === 1);
  await sleep(100);
  const note = w.notifications.find((n) => /Squad/.test(n.opts.title));
  check("a Windows notice says who, and in which group", !!note && note.opts.title === "Alex in Squad" && note.opts.body === "who's on tonight?", w.notifications.map((n) => n.opts));
  C.focused = true;
  check("Marcus has it as unread", (await groupIn(C)).unread === 2);
  await ok(C.call("markRead", G));
  check("reading it marks it read, for Marcus only", (await groupIn(C)).unread === 0 && (await groupIn(A)).unread === 1);
  const liked = await ok(C.call("react", hi.id, "like", G));
  check("Marcus can like Alex's message", liked.reaction === "like");
  check("...and tctray sees that like with the messages", (await ok(A.call("getMessages", G))).messages.find((m) => m.id === hi.id).reactions.some((r) => r.userId === USERS.C.id && r.reaction === "like"));
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000005000100e221bc330000000049454e44ae426082", "hex");
  const pic = await ok(C.call("sendMedia", G, { name: "map.png", bytes: png, width: 1, height: 1 }, "here's the map"));
  check("pictures can be sent to the group", !!pic.media && pic.media.path.startsWith(G + "/"));
  check("...and the others can view them", !!(await ok(B.call("mediaUrls", [pic.media.path]))).urls[pic.media.path]);
  check("someone outside can't", !(await ok(D.call("mediaUrls", [pic.media.path]))).urls[pic.media.path]);
  check("a message in the group can be reported", (await ok(C.call("reportUser", USERS.B.id, { reason: "spam", messageId: hi.id, conversationId: G }))) === true);
  check("someone outside can't send to it", !!(await err(D.call("sendMessage", G, "let me in"))));

  console.log("4. Changing the group");
  check("anyone in it can rename it", (await ok(B.call("renameGroup", G, "Friday crew"))) === "Friday crew");
  check("the new name shows in everyone's list", (await groupIn(A)).title === "Friday crew");
  check("only the person who made it can remove people", /Only the person who made the group/.test(await err(B.call("removeGroupMember", G, USERS.C.id))));
  clear();
  check("they can remove someone", (await ok(A.call("removeGroupMember", G, USERS.C.id))) === true);
  await sleep(700);
  check("the person removed is told (the list is fetched again)", events(C, "groups").length >= 1);
  check("...and the group is gone from their list", (await groupIn(C)) === null);
  check("...and they can't send to it any more", !!(await err(C.call("sendMessage", G, "hello?"))));
  check("adding them back works", (await ok(A.call("addGroupMembers", G, [USERS.C.id]))) === 1);
  check("...and they see it again", (await groupIn(C))?.id === G);
  check("leaving works", (await ok(B.call("leaveGroup", G))) === true);
  check("...and it's gone from their list", (await groupIn(B)) === null);
  check("the others carry on", (await groupIn(A)).members.length === 2);

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
