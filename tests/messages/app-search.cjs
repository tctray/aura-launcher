// Message search and friend streaks: the real social.js for several users, the real SQL
// (aura-messages-search.sql). Added by aura-messages-search-setup.cjs.
const fs = require("fs");
const path = require("path");
const { createWorld, USERS } = require("./harness.cjs");
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const w = await createWorld(path.resolve(process.argv[2]));
  const A = w.login("A"), B = w.login("B"), C = w.login("C");
  const ok = async (p) => { const r = await p; if (!r.success) throw new Error("call failed: " + r.error); return r.data; };
  const err = async (p) => (await p).error || "";
  for (const s of [A, B, C]) await ok(s.call("start"));
  await ok(A.call("requestFriend", USERS.B.id)); await ok(B.call("requestFriend", USERS.A.id));
  await ok(B.call("requestFriend", USERS.C.id)); await ok(C.call("requestFriend", USERS.B.id));
  const AB = await ok(A.call("openConversation", USERS.B.id));
  const BC = await ok(B.call("openConversation", USERS.C.id));
  await ok(A.call("sendMessage", AB, "you on tonight for some RANKED?"));
  await ok(B.call("sendMessage", AB, "ranked at 9"));
  await ok(B.call("sendMessage", BC, "ranked secret with Marcus"));
  await sleep(200);

  console.log("1. On a database without the update");
  check("searching says which file to run in Supabase", /aura-messages-search\.sql/.test(await err(A.call("searchMessages", "ranked"))));
  const before = await ok(A.call("friendStreaks"));
  check("streaks: none yet, and nothing breaks", before.unavailable === true && before.streaks.length === 0);

  console.log("2. Searching");
  await w.run(null, "select 1");
  await w.db.exec(fs.readFileSync(path.join(__dirname, "..", "..", "supabase", "aura-messages-search.sql"), "utf8"));
  let r = await ok(A.call("searchMessages", "  ranked  "));
  check("finds the word in your chats, newest first, whatever the capitals", JSON.stringify(r.results.map((x) => x.content)) === JSON.stringify(["ranked at 9", "you on tonight for some RANKED?"]), r);
  check("...with the chat, who sent it, and when", r.results[0].conversationId === AB && r.results[0].senderId === USERS.B.id && !isNaN(Date.parse(r.results[0].createdAt)) && typeof r.results[0].id === "string");
  check("...never other people's chats", !r.results.some((x) => /secret/.test(x.content)));
  check("one letter: nothing asked, nothing found", (await ok(A.call("searchMessages", "r"))).results.length === 0);
  check("a very long search is refused", /too long/.test(await err(A.call("searchMessages", "x".repeat(101)))));
  check("a made-up chat is refused", /isn't valid|not valid/.test(await err(A.call("searchMessages", "ranked", "not-a-chat"))));
  check("only one chat", (await ok(A.call("searchMessages", "ranked", AB))).results.length === 2 && (await ok(B.call("searchMessages", "ranked", BC))).results.length === 1);
  const mine = r.results.find((x) => x.senderId === USERS.A.id);
  await ok(A.call("deleteMessage", mine.id));
  check("a deleted message isn't found any more", (await ok(A.call("searchMessages", "tonight"))).results.length === 0);

  console.log("3. Streaks");
  let st = await ok(A.call("friendStreaks"));
  check("both of you messaged today: a 1-day streak, counted today", JSON.stringify(st.streaks) === JSON.stringify([{ userId: USERS.B.id, days: 1, today: true }]), st);
  // the two days before, as well
  await w.run(null, `insert into public.messages (conversation_id, sender_id, content) select $1, u, 'gg' from unnest(array[$2::uuid, $3::uuid]) u, generate_series(1, 2) d`, [AB, USERS.A.id, USERS.B.id]);
  await w.run(null, `with x as (select id, row_number() over (order by id) n from public.messages where content = 'gg') update public.messages m set created_at = now() - make_interval(days => ((x.n + 1) / 2)::int) from x where m.id = x.id`);
  st = await ok(A.call("friendStreaks"));
  check("three days in a row: 3", st.streaks[0]?.days === 3 && st.streaks[0]?.today === true, st);
  st = await ok(B.call("friendStreaks"));
  check("your friend sees the same streak with you", st.streaks.find((x) => x.userId === USERS.A.id)?.days === 3);
  check("...and their own with others (only one of them messaged Marcus: none)", !st.streaks.some((x) => x.userId === USERS.C.id));

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
