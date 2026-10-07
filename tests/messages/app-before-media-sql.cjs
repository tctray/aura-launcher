// The new AURA code against a Supabase project where aura-messages-media.sql hasn't been run yet.
process.env.NO_MEDIA_SQL = "1";
const path = require("path");
const { createWorld, USERS } = require("./harness.cjs");
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
(async () => {
  const w = await createWorld(path.resolve(process.argv[2]));
  // The stand-in client returns every column; make it behave like Supabase when asked for columns that don't exist
  const A = w.login("A"), B = w.login("B");
  const ok = async (p) => { const r = await p; if (!r.success) throw new Error("call failed: " + r.error); return r.data; };
  await ok(A.call("start")); await ok(B.call("start"));
  await ok(A.call("requestFriend", USERS.B.id)); await ok(B.call("requestFriend", USERS.A.id));
  const AB = await ok(A.call("openConversation", USERS.B.id));
  const m = await ok(A.call("sendMessage", AB, "hello"));
  check("text still sends", m && m.content === "hello" && m.media === null, m);
  check("history still loads", (await ok(B.call("getMessages", AB))).messages.length === 1);
  const list = await ok(B.call("listConversations"));
  check("the conversation list still loads (old function)", list.length === 1 && list[0].lastMessage === "hello" && list[0].lastMedia === "" && list[0].unread === 1, list);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
  const r = await A.call("sendMedia", AB, { name: "a.png", bytes: png }, "");
  check("sending a picture says exactly what to do", r.success === false && r.error === "Pictures and videos aren't set up in Supabase yet. Run aura-messages-media.sql first.", r);
  check("nothing was stored or saved", Number((await w.run(null, "select count(*)::int n from storage.objects")).rows[0].n) === 0 && Number((await w.run(null, "select count(*)::int n from public.messages")).rows[0].n) === 1);
  console.log(failed ? "\n" + failed + " FAILED" : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST CRASHED:", e); process.exit(2); });
