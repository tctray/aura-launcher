// Calls with 3 people: the real social.js for several users, the real SQL (aura-calls-group.sql).
// The sound and pictures go PC to PC and are checked in the window test (group-calls.cjs).
// Added by aura-group-calls-setup.cjs.
const fs = require("fs");
const path = require("path");
const { createWorld, USERS, fakeApp } = require("./harness.cjs");
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
  await sleep(300);
  const clear = () => { for (const s of [A, B, C, D]) { s.events.length = 0; s.flashes = []; } w.notifications.length = 0; };
  const events = (s, type) => s.events.filter((e) => e.type === type);

  console.log("1. On a database without the 3-person update");
  let call = await ok(A.call("startCall", USERS.B.id));
  await ok(B.call("answerCall", call.id));
  check("adding someone says which file to run", /aura-calls-group\.sql/.test(await err(A.call("addToCall", call.id, USERS.C.id))));
  check("calls carry no group", call.groupId === null, call);
  await ok(A.call("endCall", call.id));
  await w.run(null, "update public.voice_calls set created_at = created_at - interval '1 hour'");

  console.log("2. Adding a friend");
  await w.db.exec(fs.readFileSync(path.join(__dirname, "..", "..", "supabase", "aura-calls-group.sql"), "utf8"));
  call = await ok(A.call("startCall", USERS.B.id));
  await ok(B.call("answerCall", call.id));
  clear();
  check("a made-up id is refused before asking Supabase", /isn't valid/.test(await err(A.call("addToCall", call.id, "nope"))));
  check("someone who isn't your friend can't be added", /only add friends/.test(await err(A.call("addToCall", call.id, USERS.D.id))));
  const invite = await ok(A.call("addToCall", call.id, USERS.C.id));
  await sleep(80);
  check("adding a friend rings them, as part of the call", invite.status === "ringing" && invite.outgoing === true && invite.peerId === USERS.C.id && invite.groupId === call.id, invite);
  let ev = events(C, "call");
  check("the friend's AURA is told a call is ringing, and that it's a group call", ev.length === 1 && ev[0].call.id === invite.id && ev[0].call.status === "ringing" && ev[0].call.groupId === call.id && ev[0].call.peerId === USERS.A.id, ev);
  ev = events(B, "call");
  check("the other person's AURA learns the call is now a group", ev.some((e) => e.call.id === call.id && e.call.groupId === call.id && e.call.status === "active"), ev);
  check("...but isn't told about the ringing (that's between the two of them)", !ev.some((e) => e.call.id === invite.id));
  check("the stranger hears nothing", events(D, "call").length === 0);

  console.log("3. Answering and joining the others");
  clear();
  check("the friend can't join before answering", /has ended/.test(await err(C.call("joinGroup", invite.id))));
  await ok(C.call("answerCall", invite.id));
  const links = await ok(C.call("joinGroup", invite.id));
  await sleep(80);
  check("joining connects them to the other person, already answered", links.length === 1 && links[0].peerId === USERS.B.id && links[0].outgoing === true && links[0].status === "active" && links[0].groupId === call.id, links);
  ev = events(B, "call");
  check("the other person's AURA is told someone joined (nothing rings)", ev.some((e) => e.call.id === links[0].id && e.call.status === "active" && e.call.outgoing === false && e.call.peerId === USERS.C.id) && w.notifications.length === 0, ev);
  check("joining twice adds nothing", (await ok(C.call("joinGroup", invite.id))).length === 0);
  await ok(C.call("callSignal", links[0].id, "offer", JSON.stringify({ sdp: "v=0 from Marcus" })));
  await sleep(80);
  ev = events(B, "signal");
  check("the two who aren't friends can still connect", ev.length === 1 && ev[0].callId === links[0].id && ev[0].signal.kind === "offer", ev);
  const st = await ok(B.call("callState", links[0].id, 0));
  check("...and check on that connection", st.call.status === "active" && st.call.groupId === call.id && st.signals.length === 1, st);
  check("adding a fourth person is refused", /call is full|only add friends/.test(await err(B.call("addToCall", call.id, USERS.D.id))));

  console.log("4. Closing AURA in a call with 3 people");
  const closing = (index) => { const event = { stopped: false, preventDefault() { event.stopped = true; } }; fakeApp.handlers["will-quit"][index](event); return event; };
  fakeApp.quits = 0;
  const held = closing(2); // Marcus's AURA (the third one logged in)
  for (let i = 0; i < 40 && fakeApp.quits === 0; i++) await sleep(50);
  const rows = (await w.run(null, "select id, status from public.voice_calls where id = any($1)", [[call.id, invite.id, links[0].id]])).rows;
  const status = (id) => rows.find((r) => r.id === id)?.status;
  check("closing hangs up every part of the call first, then closes", held.stopped === true && fakeApp.quits === 1 && status(invite.id) === "ended" && status(links[0].id) === "ended", rows);
  check("...and the other two carry on", status(call.id) === "active", rows);

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
