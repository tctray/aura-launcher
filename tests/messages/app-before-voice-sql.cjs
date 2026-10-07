// The new AURA code against a Supabase project where aura-messages-voice.sql hasn't been run yet.
process.env.NO_VOICE_SQL = "1";
const path = require("path");
const { createWorld, USERS } = require("./harness.cjs");
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const w = await createWorld(path.resolve(process.argv[2]));
  const A = w.login("A"), B = w.login("B");
  const ok = async (p) => { const r = await p; if (!r.success) throw new Error("call failed: " + r.error); return r.data; };
  await ok(A.call("start")); await ok(B.call("start")); await sleep(80);
  check("messages are still live", A.events.some((e) => e.type === "live" && e.connected === true) && !A.events.some((e) => e.type === "live" && e.connected === false), A.events);
  await ok(A.call("requestFriend", USERS.B.id)); await ok(B.call("requestFriend", USERS.A.id));
  const AB = await ok(A.call("openConversation", USERS.B.id));
  const m = await ok(A.call("sendMessage", AB, "hello")); await sleep(60);
  check("text still sends and arrives", m.content === "hello" && B.events.some((e) => e.type === "message" && e.message.content === "hello"));
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
  check("pictures still send", !!(await ok(A.call("sendMedia", AB, { name: "a.png", bytes: png }, ""))).media);
  check("AURA starting up finds no call, without an error", (await ok(A.call("currentCall"))) === null);
  const SETUP = "Voice calls aren't set up in Supabase yet. Run aura-messages-voice.sql first.";
  const tried = await A.call("startCall", USERS.B.id);
  check("calling says exactly what to do", tried.success === false && tried.error === SETUP, tried);
  check("so do the other call actions", (await A.call("answerCall", AB)).error === SETUP && (await A.call("endCall", AB)).error === SETUP && (await A.call("callState", AB, 0)).error === SETUP && (await A.call("callBeat", AB)).error === SETUP);
  check("the friend's AURA heard nothing about a call", !B.events.some((e) => e.type === "call"));
  check("the call servers can still be asked for", (await ok(A.call("callConfig"))).iceServers.length > 0);
  console.log(failed ? "\n" + failed + " FAILED" : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST CRASHED:", e); process.exit(2); });
