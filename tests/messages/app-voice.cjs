// Voice calls: the real social.js for several users, the real SQL. (The sound itself goes PC to PC
// and is checked in the window test; this covers ringing, accepting, hanging up and who is told what.)
const path = require("path");
const { createWorld, USERS, fakeApp } = require("./harness.cjs");
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MISSED = "📞 Missed voice call";

(async () => {
  const w = await createWorld(path.resolve(process.argv[2]));
  const A = w.login("A"), B = w.login("B"), C = w.login("C"), D = w.login("D");
  const ok = async (p) => { const r = await p; if (!r.success) throw new Error("call failed: " + r.error); return r.data; };
  const err = async (p) => (await p).error || "";
  for (const s of [A, B, C, D]) await ok(s.call("start"));
  await ok(A.call("requestFriend", USERS.B.id)); await ok(B.call("requestFriend", USERS.A.id));
  await ok(A.call("requestFriend", USERS.C.id)); await ok(C.call("requestFriend", USERS.A.id));
  const AB = await ok(A.call("openConversation", USERS.B.id));
  await sleep(300);
  const clear = () => { for (const s of [A, B, C, D]) { s.events.length = 0; s.flashes = []; } w.notifications.length = 0; };
  const events = (s, type) => s.events.filter((e) => e.type === type);
  const past = () => w.run(null, "update public.voice_calls set created_at = created_at - interval '1 hour' where status = 'ended'");
  clear();

  console.log("1. Calling a friend");
  check("a made-up id is refused before asking Supabase", /isn't valid/.test(await err(A.call("startCall", "nope"))));
  check("you can't call someone who isn't your friend", (await err(A.call("startCall", USERS.D.id))) === "You can only call friends.");
  let call = await ok(A.call("startCall", USERS.B.id));
  check("the call starts ringing, and says who is who", call.status === "ringing" && call.outgoing === true && call.peerId === USERS.B.id && call.callerId === USERS.A.id, call);
  await sleep(80);
  let ev = events(B, "call");
  check("the friend's AURA is told a call is ringing for them", ev.length === 1 && ev[0].call.id === call.id && ev[0].call.status === "ringing" && ev[0].call.outgoing === false && ev[0].call.peerId === USERS.A.id, ev);
  check("nobody else hears about the call", events(C, "call").length === 0 && events(D, "call").length === 0);
  check("AURA is in front, so no Windows notification and no flashing", w.notifications.length === 0 && !(B.flashes || []).length);
  check("the caller can't start a second call meanwhile", (await err(A.call("startCall", USERS.C.id))) === "You're already in a call.");
  check("a third friend is told they're busy", /on another call/.test(await err(C.call("startCall", USERS.A.id))));
  check("AURA starting up finds the ringing call", (await ok(B.call("currentCall")))?.id === call.id && (await ok(C.call("currentCall"))) === null);

  console.log("2. Nothing is swapped until the call is accepted");
  check("connection details are refused while it rings", /isn't connected/.test(await err(A.call("callSignal", call.id, "offer", "{}"))));
  check("an unknown kind never leaves the PC", /valid call message/.test(await err(A.call("callSignal", call.id, "video", "{}"))));
  check("nor does an empty or huge one", /too long/.test(await err(A.call("callSignal", call.id, "ice", ""))) && /too long/.test(await err(A.call("callSignal", call.id, "ice", "x".repeat(20001)))) && /too long/.test(await err(A.call("callSignal", call.id, "ice", { not: "text" }))));
  let st = await ok(B.call("callState", call.id, 0));
  check("checking on the call says it is ringing, with nothing to pass on", st.call.status === "ringing" && st.signals.length === 0, st);
  check("someone else checking on it learns nothing", (await ok(C.call("callState", call.id, 0))).call === null);

  console.log("3. Accepting, and connecting");
  clear();
  check("someone else can't accept it", /has ended/.test(await err(C.call("answerCall", call.id))));
  const live = await ok(B.call("answerCall", call.id));
  await sleep(80);
  check("the friend accepts", live.status === "active" && live.outgoing === false && !!live.answeredAt, live);
  ev = events(A, "call");
  check("the caller's AURA is told straight away", ev.length === 1 && ev[0].call.status === "active" && ev[0].call.outgoing === true, ev);
  const n1 = await ok(A.call("callSignal", call.id, "offer", JSON.stringify({ sdp: "v=0 from A" })));
  await ok(A.call("callSignal", call.id, "ice", JSON.stringify([{ candidate: "candidate:1" }])));
  await sleep(80);
  ev = events(B, "signal");
  check("what the caller's PC sends reaches the friend's, in order", ev.length === 2 && ev[0].callId === call.id && ev[0].signal.kind === "offer" && JSON.parse(ev[0].signal.payload).sdp === "v=0 from A" && ev[1].signal.kind === "ice" && ev[0].signal.id === n1 && ev[1].signal.id > n1, ev);
  check("...and nobody else's (not even the sender's own)", events(A, "signal").length === 0 && events(C, "signal").length === 0);
  await ok(B.call("callSignal", call.id, "answer", JSON.stringify({ sdp: "v=0 from B" })));
  await sleep(80);
  check("the answer reaches the caller", events(A, "signal").length === 1 && events(A, "signal")[0].signal.kind === "answer");
  check("the roles can't be swapped", /valid call message/.test(await err(B.call("callSignal", call.id, "offer", "{}"))) && /valid call message/.test(await err(A.call("callSignal", call.id, "answer", "{}"))));
  check("someone outside the call can't send into it", /isn't your call/.test(await err(C.call("callSignal", call.id, "ice", "[]"))));
  st = await ok(B.call("callState", call.id, 0));
  check("checking on the call hands over anything a live update might have missed", st.call.status === "active" && st.signals.length === 2 && st.signals[0].kind === "offer", st);
  st = await ok(B.call("callState", call.id, st.signals[0].id));
  check("...only what came after the last one seen", st.signals.length === 1 && st.signals[0].kind === "ice", st);
  check("a heartbeat says the call is going", (await ok(A.call("callBeat", call.id))) === "active" && (await ok(C.call("callBeat", call.id))) === "ended");

  console.log("4. Hanging up");
  clear();
  const done = await ok(B.call("endCall", call.id));
  await sleep(80);
  check("either person can hang up", done.status === "ended" && done.reason === "hangup", done);
  ev = events(A, "call");
  check("the other person's AURA is told the call ended", ev.length === 1 && ev[0].call.status === "ended" && ev[0].call.reason === "hangup", ev);
  check("the connection details are gone from Supabase", (await w.run(null, "select count(*)::int n from public.voice_signals")).rows[0].n === 0);
  check("a heartbeat now says ended", (await ok(A.call("callBeat", call.id))) === "ended");
  check("no missed-call note for a call that happened", (await ok(A.call("getMessages", AB))).messages.length === 0);

  console.log("5. Declining, cancelling, not answering");
  await past(); clear();
  call = await ok(A.call("startCall", USERS.B.id)); await sleep(60);
  let over = await ok(B.call("endCall", call.id)); await sleep(80);
  check("the friend declines: the caller is told", over.reason === "declined" && events(A, "call").some((e) => e.call.status === "ended" && e.call.reason === "declined"), events(A, "call"));
  check("declining leaves no note", (await ok(A.call("getMessages", AB))).messages.length === 0);
  clear();
  call = await ok(A.call("startCall", USERS.B.id)); await sleep(60);
  over = await ok(A.call("endCall", call.id)); await sleep(120);
  check("the caller cancels: the friend's AURA stops ringing", over.reason === "cancelled" && events(B, "call").some((e) => e.call.status === "ended" && e.call.reason === "cancelled"));
  let msgs = (await ok(B.call("getMessages", AB))).messages;
  check("a note is left in the conversation", msgs.length === 1 && msgs[0].content === MISSED && msgs[0].senderId === USERS.A.id, msgs);
  check("it arrives like any message, so it shows as unread", events(B, "message").length === 1 && events(B, "message")[0].message.content === MISSED && (await ok(B.call("listConversations")))[0].unread === 1);
  clear();
  call = await ok(A.call("startCall", USERS.B.id)); await sleep(60);
  over = await ok(A.call("endCall", call.id, "missed")); await sleep(80);
  check("nobody picked up: marked as missed, with a note", over.reason === "missed" && (await ok(B.call("getMessages", AB))).messages.length === 2);
  check("only 'missed' and 'failed' are passed on as reasons", (await ok(A.call("endCall", call.id, "anything else"))).reason === "missed");

  console.log("6. When AURA isn't the window in front");
  await past(); clear();
  B.focused = false;
  call = await ok(A.call("startCall", USERS.B.id)); await sleep(120);
  check("Windows shows who is calling", w.notifications.length === 1 && w.notifications[0].opts.title === "tctray is calling" && /answer/i.test(w.notifications[0].opts.body), w.notifications.map((n) => n.opts));
  check("AURA's taskbar button flashes", B.flashing === true);
  check("the notification is silent (the window is already ringing)", w.notifications[0].opts.silent === true);
  w.notifications[0].handlers.click();
  check("clicking it brings AURA to the front", B.focused === true && B.shown === true);
  await ok(A.call("endCall", call.id)); await sleep(120);
  check("when the caller gives up, the flashing stops and the notification is taken down", B.flashing === false && w.notifications[0].closed === true);
  B.focused = false; await past(); clear();
  call = await ok(A.call("startCall", USERS.B.id)); await sleep(120);
  await ok(B.call("answerCall", call.id)); await sleep(60);
  check("accepting stops the flashing too", B.flashing === false && w.notifications[0].closed === true);
  await ok(A.call("endCall", call.id)); B.focused = true;

  console.log("7. Relays");
  let cfg = await ok(A.call("callConfig"));
  check("with no relay set up, calls use the free direct-connection servers", cfg.relay === false && cfg.iceServers.length === 1 && cfg.iceServers[0].urls.every((u) => u.startsWith("stun:")), cfg);
  check("the AURA server was asked once, at the right address", w.serverCalls.length === 1 && w.serverCalls[0].route === "/api/voice/ice", w.serverCalls);
  await ok(A.call("callConfig"));
  check("the answer is remembered rather than asked for on every call", w.serverCalls.length === 1);
  w.server = async () => ({ success: true, iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478"] },
    { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:5349?transport=tcp", "https://evil.example/x", "javascript:alert(1)"], username: "u", credential: "c" },
    { urls: "turn:no-login.example:3478" },
    { urls: ["file:///etc/passwd"] }, "junk", null,
  ] });
  cfg = await ok(C.call("callConfig"));
  check("with a relay set up on the AURA server, it is used", cfg.relay === true && cfg.iceServers.length === 2 && cfg.iceServers[1].username === "u" && cfg.iceServers[1].credential === "c", cfg);
  w.server = async () => ({ success: true, iceServers: [{ urls: ["turn::::", "turn:", "stun:host?transport=udp", "turn:-bad-.example:3478", "stun:[::1]:3478", "turn:relay.example.com:443?transport=tcp"], username: "u", credential: "c" }] });
  const strict = await ok(B.call("callConfig"));
  check("malformed addresses are dropped, well-formed ones kept", JSON.stringify(strict.iceServers[0].urls) === JSON.stringify(["stun:[::1]:3478", "turn:relay.example.com:443?transport=tcp"]), strict);
  check("only real call-server addresses are passed to the window", JSON.stringify(cfg.iceServers[1].urls) === JSON.stringify(["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:5349?transport=tcp"]) && !JSON.stringify(cfg).includes("evil") && !JSON.stringify(cfg).includes("no-login"), cfg);
  w.server = async () => { throw new Error("boom"); };
  check("if the AURA server is down, calls still get the direct-connection servers", (await ok(D.call("callConfig"))).relay === false);

  console.log("8. Logging out");
  await past(); clear();
  call = await ok(A.call("startCall", USERS.B.id)); await sleep(60);
  await ok(B.call("stop")); clear();
  await ok(A.call("endCall", call.id)); await sleep(80);
  check("after logging out, no more call updates arrive", events(B, "call").length === 0);
  await ok(B.call("start")); await sleep(60);

  console.log("9. Closing AURA");
  // Each running AURA listens for "about to quit". Index 0 is tctray's, 1 is Alex's (the order they logged in).
  const closing = (index) => { const event = { stopped: false, preventDefault() { event.stopped = true; } }; fakeApp.handlers["will-quit"][index](event); return event; };
  check("AURA listens for being closed", (fakeApp.handlers["will-quit"] || []).length === 4);
  await past(); clear(); fakeApp.quits = 0;
  check("with no call going, closing isn't held up at all", closing(0).stopped === false && fakeApp.quits === 0);
  call = await ok(A.call("startCall", USERS.B.id)); await sleep(60);
  check("a call ringing for you doesn't hold up closing either (it is left to ring)", closing(1).stopped === false);
  await ok(B.call("answerCall", call.id)); await sleep(60); clear();
  const held = closing(1);
  await sleep(250);
  check("closing in the middle of a call hangs up first, then closes", held.stopped === true && fakeApp.quits === 1 && (await w.run(null, "select status, end_reason from public.voice_calls where id = $1", [call.id])).rows[0].status === "ended", fakeApp.quits);
  check("the other person's AURA is told", events(A, "call").some((e) => e.call.status === "ended"));
  check("closing again goes straight through", closing(1).stopped === false);
  // The window usually sends the hang-up itself as it closes. AURA must then wait for that to arrive.
  await past(); clear(); fakeApp.quits = 0;
  // (Marcus's AURA this time: each AURA only closes once)
  call = await ok(A.call("startCall", USERS.C.id)); await sleep(60); await ok(C.call("answerCall", call.id)); await sleep(60);
  const sent = C.call("endCall", call.id); // not waited for
  const waiting = closing(2);
  check("a hang-up already on its way is waited for", waiting.stopped === true && fakeApp.quits === 0);
  await sent; await sleep(60);
  check("...and then AURA closes", fakeApp.quits === 1 && (await w.run(null, "select status from public.voice_calls where id = $1", [call.id])).rows[0].status === "ended", fakeApp.quits);
  await past(); clear(); fakeApp.quits = 0;
  call = await ok(A.call("startCall", USERS.C.id)); await sleep(60);
  w.setOffline("A", true);
  const stuck = closing(0);
  await sleep(1300);
  check("with no internet, AURA still closes within about a second", stuck.stopped === true && fakeApp.quits === 1, fakeApp.quits);
  w.setOffline("A", false); await sleep(50);
  await w.run(null, "update public.voice_calls set status = 'ended', end_reason = 'cancelled', ended_at = now() where status <> 'ended'");

  console.log("10. A ring missed while the connection was down");
  await past(); clear();
  w.setOffline("B", true); await sleep(30);
  call = await ok(A.call("startCall", USERS.B.id)); await sleep(80);
  check("while offline, nothing arrives", events(B, "call").length === 0);
  w.setOffline("B", false); await sleep(150);
  ev = events(B, "call");
  check("back online, AURA checks and finds the call still ringing", ev.length === 1 && ev[0].call.id === call.id && ev[0].call.status === "ringing" && ev[0].call.outgoing === false, ev);
  await ok(A.call("endCall", call.id)); await sleep(60);

  console.log("11. Blocking or removing a friend ends the call for both");
  await past(); clear();
  call = await ok(A.call("startCall", USERS.C.id)); await sleep(60); await ok(C.call("answerCall", call.id)); await sleep(60); clear();
  const friendship = (await ok(A.call("listFriends"))).find((f) => f.userId === USERS.C.id).friendshipId;
  await ok(C.call("removeFriend", friendship)); await sleep(100);
  check("removing a friend mid-call: both are told it ended", events(A, "call").some((e) => e.call.id === call.id && e.call.status === "ended") && events(C, "call").some((e) => e.call.status === "ended"), [events(A, "call"), events(C, "call")]);
  await past(); clear();
  call = await ok(A.call("startCall", USERS.B.id)); await sleep(60);
  await ok(B.call("blockUser", USERS.A.id)); await sleep(100);
  check("blocking someone who is ringing you: their call ends as declined", events(A, "call").some((e) => e.call.id === call.id && e.call.status === "ended" && e.call.reason === "declined"), events(A, "call"));
  check("...and they can't ring again", (await err(A.call("startCall", USERS.B.id))) === "You can only call friends.");
  await ok(B.call("unblockUser", USERS.A.id)); await ok(A.call("requestFriend", USERS.B.id)); await ok(B.call("requestFriend", USERS.A.id)); await sleep(350);

  console.log("12. Messages still work alongside calls");
  clear();
  await sleep(10);
  await ok(A.call("sendMessage", AB, "still here")); await sleep(80);
  check("a message arrives as before", events(B, "message").some((e) => e.message.content === "still here"));

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
