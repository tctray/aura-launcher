// Link previews in messages: the real social.js for two people, the real SQL (aura-messages-links.sql).
// Added by aura-messages-links-setup.cjs.
const fs = require("fs");
const path = require("path");
const { createWorld, USERS } = require("./harness.cjs");
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const w = await createWorld(path.resolve(process.argv[2]));
  const A = w.login("A"), B = w.login("B");
  const ok = async (p) => { const r = await p; if (!r.success) throw new Error("call failed: " + r.error); return r.data; };
  for (const s of [A, B]) await ok(s.call("start"));
  await ok(A.call("requestFriend", USERS.B.id)); await ok(B.call("requestFriend", USERS.A.id));
  const AB = await ok(A.call("openConversation", USERS.B.id));
  const thumb = "data:image/jpeg;base64," + Buffer.from("x".repeat(300)).toString("base64");
  const link = { url: "https://example.com/post", kind: "page", title: "Patch notes", description: "Big changes", site: "Example News", image: thumb };

  console.log("1. On a database without the link update");
  let sent = await ok(A.call("sendMessage", AB, "look https://example.com/post", link));
  check("the message still goes, without its preview", sent.content === "look https://example.com/post" && sent.link === null, sent);

  console.log("2. With it");
  await w.run(null, "select 1");
  await w.db.exec(fs.readFileSync(path.join(__dirname, "..", "..", "supabase", "aura-messages-links.sql"), "utf8"));
  await w.db.exec(fs.readFileSync(path.join(__dirname, "..", "..", "supabase", "aura-messages-links.sql"), "utf8")); // safe to run twice
  for (const s of [A, B]) { await ok(s.call("stop")); await ok(s.call("start")); } // (AURA started again)
  B.events.length = 0;
  sent = await ok(A.call("sendMessage", AB, "look at this https://example.com/post!", link));
  check("a message with a link carries its preview", JSON.stringify(sent.link) === JSON.stringify(link), sent.link);
  await sleep(100);
  const live = B.events.find((e) => e.type === "message" && e.message.id === sent.id);
  check("...which reaches the other person straight away", live && JSON.stringify(live.message.link) === JSON.stringify(link), live?.message?.link);
  let got = (await ok(B.call("getMessages", AB))).messages.find((m) => m.id === sent.id);
  check("...and is there when the chat is opened", got && got.link && got.link.title === "Patch notes" && got.link.image === thumb);
  sent = await ok(A.call("sendMessage", AB, "no link in here", link));
  check("a preview for a link that isn't in the message is dropped", sent.link === null);
  sent = await ok(A.call("sendMessage", AB, "javascript:alert(1)", { url: "javascript:alert(1)", title: "x" }));
  check("a preview of something that isn't an https link is dropped", sent.link === null);

  console.log("3. A preview made some other way is checked when it's read");
  await w.run(USERS.A.id, "insert into public.messages (conversation_id, sender_id, content, link) values ($1, $2, 'https://example.com/x', $3)",
    [AB, USERS.A.id, JSON.stringify({ url: "https://example.com/x", title: "Looks fine", image: "https://tracker.example/pixel.gif", kind: "script", extra: "<b>" })]);
  got = (await ok(B.call("getMessages", AB))).messages.find((m) => m.content === "https://example.com/x");
  check("a picture that isn't AURA's small JPEG is left out, and the rest is tidied", got && got.link && !got.link.image && got.link.kind === "page" && !("extra" in got.link), got?.link);
  await w.run(USERS.A.id, "insert into public.messages (conversation_id, sender_id, content, link) values ($1, $2, 'bad', $3)", [AB, USERS.A.id, JSON.stringify({ url: "http://127.0.0.1/", title: "x" })]);
  got = (await ok(B.call("getMessages", AB))).messages.find((m) => m.content === "bad");
  check("a preview of a local address isn't shown", got && got.link === null);
  let refused = "";
  try { await w.run(USERS.A.id, "insert into public.messages (conversation_id, sender_id, content, link) values ($1, $2, 'huge', $3)", [AB, USERS.A.id, JSON.stringify({ url: "https://example.com/", title: "x".repeat(90000) })]); } catch (e) { refused = e.message; }
  check("Supabase refuses a preview that is too big", /messages_link_shape/.test(refused), refused);

  console.log("4. Deleting");
  const withLink = (await ok(A.call("getMessages", AB))).messages.find((m) => m.link && m.senderId === USERS.A.id && m.link.title === "Patch notes");
  await ok(A.call("deleteMessage", withLink.id));
  const row = (await w.run(null, "select link, deleted_at from public.messages where id = $1", [withLink.id])).rows[0];
  check("deleting a message deletes its preview too", row.deleted_at && row.link === null, row);

  console.log("5. Looking a link up");
  check("only https links are looked up", (await ok(A.call("linkPreview", "http://example.com/"))) === null && (await ok(A.call("linkPreview", "https://localhost/"))) === null);

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
