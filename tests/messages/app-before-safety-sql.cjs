// The new AURA code against a Supabase project where aura-messages-safety.sql hasn't been run yet.
process.env.NO_SAFETY_SQL = "1";
const path = require("path");
const { createWorld, USERS } = require("./harness.cjs");
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  // This database is as it was before the update, including the older media file without deleted_at
  const w = await createWorld(path.resolve(process.argv[2]));
  await w.run(null, "alter table public.messages drop constraint messages_content_or_media");
  await w.run(null, "alter table public.messages drop column deleted_at");
  await w.run(null, "alter table public.messages add constraint messages_content_or_media check (char_length(content) <= 4000 and (btrim(content, E' \\t\\n\\r') <> '' or media_path is not null))");
  const A = w.login("A"), B = w.login("B");
  const ok = async (p) => { const r = await p; if (!r.success) throw new Error("call failed: " + r.error); return r.data; };
  await ok(A.call("start")); await ok(B.call("start")); await sleep(80);
  check("messages are still live", A.events.some((e) => e.type === "live" && e.connected === true) && !A.events.some((e) => e.type === "live" && e.connected === false), A.events);
  await ok(A.call("requestFriend", USERS.B.id)); await ok(B.call("requestFriend", USERS.A.id));
  const AB = await ok(A.call("openConversation", USERS.B.id));
  const m = await ok(A.call("sendMessage", AB, "hello"));
  check("text still sends and comes back", m && m.content === "hello" && m.deleted === false, m);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
  const p = await ok(A.call("sendMedia", AB, { name: "a.png", bytes: png }, ""));
  check("pictures still send", p.media && p.media.kind === "image" && p.deleted === false, p);
  const page = await ok(B.call("getMessages", AB));
  check("history still loads, files included", page.messages.length === 2 && page.messages[1].media && page.messages[1].media.path === p.media.path, page.messages);
  check("the blocked list is simply empty", (await ok(A.call("listBlocked"))).length === 0);
  const SETUP = "Deleting, blocking and reporting aren't set up in Supabase yet. Run aura-messages-safety.sql first.";
  check("deleting says exactly what to do", (await A.call("deleteMessage", m.id)).error === SETUP, await A.call("deleteMessage", m.id));
  check("so does blocking", (await A.call("blockUser", USERS.B.id)).error === SETUP);
  check("and reporting", (await A.call("reportUser", USERS.B.id, { reason: "spam" })).error === SETUP);
  check("nothing was changed by those", (await ok(B.call("getMessages", AB))).messages.length === 2 && (await ok(A.call("listFriends"))).length === 1);
  console.log(failed ? "\n" + failed + " FAILED" : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST CRASHED:", e); process.exit(2); });
