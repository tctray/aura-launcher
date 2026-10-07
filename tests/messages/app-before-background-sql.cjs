// The new AURA code against a Supabase project where aura-messages-background.sql hasn't been run yet.
process.env.NO_BG_SQL = "1";
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
  check("messages are still live (the background channel failing doesn't touch them)", A.events.some((e) => e.type === "live" && e.connected === true) && !A.events.some((e) => e.type === "live" && e.connected === false), A.events);
  await ok(A.call("requestFriend", USERS.B.id)); await ok(B.call("requestFriend", USERS.A.id));
  const AB = await ok(A.call("openConversation", USERS.B.id));
  B.events.length = 0;
  await ok(A.call("sendMessage", AB, "hello")); await sleep(60);
  check("a message still arrives live", B.events.some((e) => e.type === "message" && e.message.content === "hello"), B.events);
  const list = await ok(B.call("listConversations"));
  check("the conversation list still loads, with no background", list.length === 1 && list[0].background === null && list[0].lastMessage === "hello", list);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]), Buffer.alloc(500, 1)]);
  const r = await A.call("setBackground", AB, { name: "a.jpg", bytes: new Uint8Array(jpg) });
  check("setting a background says exactly what to do", r.success === false && r.error === "Shared chat backgrounds aren't set up in Supabase yet. Run aura-messages-background.sql first.", r);
  check("and uploads nothing", Number((await w.run(null, "select count(*)::int n from storage.objects")).rows[0].n) === 0);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
  check("pictures in messages still send", (await ok(A.call("sendMedia", AB, { name: "a.png", bytes: png }, ""))).media.kind === "image");
  console.log(failed ? "\n" + failed + " FAILED" : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST CRASHED:", e); process.exit(2); });
