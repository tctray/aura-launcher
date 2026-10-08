// GIF search and sending GIFs: the real social.js, with stand-ins for the AURA server, KLIPY and GIPHY.
const path = require("path");
const { createWorld, USERS } = require("./harness.cjs");
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEY = "TestKeyTestKeyTestKey1234567890ab";
const KLIPY_GIF = "https://static.klipy.com/ii/0e837dd9cc97455ea04098830a531e5c/30/c8/0M6hUd7U.gif";
const GIPHY_GIF = "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExZXhhbXBsZQ/3o7abKhOpu0NwenH3O/200.webp?cid=790b7611example&ep=v1_gifs_search&rid=200.webp&ct=g";
// A GIF as the AURA server passes it on from KLIPY
const kg = (id, over = {}) => ({ id: String(id), title: "Happy Dance", preview: { url: `https://static.klipy.com/ii/abc/01/02/${id}-sm.webp`, width: 220, height: 124 }, send: { url: `https://static.klipy.com/ii/abc/01/02/${id}-md.gif`, width: 300, height: 169 }, ...over });
// A GIF as GIPHY's own API answers
const gg = (id, over = {}) => ({ id, title: "  Happy   Dance GIF by Someone  ", images: {
  fixed_width: { url: `https://media1.giphy.com/media/${id}/200w.gif?cid=abc&rid=200w.gif&ct=g`, webp: `https://media1.giphy.com/media/${id}/200w.webp?cid=abc&rid=200w.webp&ct=g`, width: "200", height: "113" },
  fixed_height: { url: `https://media1.giphy.com/media/${id}/200.gif?cid=abc&rid=200.gif&ct=g`, webp: `https://media1.giphy.com/media/${id}/200.webp?cid=abc&rid=200.webp&ct=g`, width: "356", height: "200" },
  ...over.images } });
const asked = [];      // every request this AURA itself sent out to a GIF service
let giphy = () => ({ status: 200, body: { data: [gg("aaa111"), gg("bbb222")], pagination: { total_count: 2, count: 2, offset: 0 } } });
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  asked.push({ host: u.host, path: u.pathname, params: Object.fromEntries(u.searchParams.entries()), method: opts.method || "GET" });
  const res = await giphy(u);
  if (res.throws) throw new TypeError("fetch failed");
  return new Response(typeof res.body === "string" ? res.body : JSON.stringify(res.body), { status: res.status, headers: { "Content-Type": "application/json" } });
};

(async () => {
  const w = await createWorld(path.resolve(process.argv[2]));
  const ok = async (p) => { const r = await p; if (!r.success) throw new Error("call failed: " + r.error); return r.data; };
  const err = async (p) => (await p).error || "";
  let answer = () => ({ success: false, error: "The AURA server answered with an error (404)." }); // what the AURA server says to /api/gifs/search
  w.server = async (route, body) => (route === "/api/gifs/search" ? answer(body) : { success: false, error: "The AURA server answered with an error (404)." });
  const A = w.login("A"), B = w.login("B");
  await ok(A.call("start")); await ok(B.call("start"));
  await ok(A.call("requestFriend", USERS.B.id)); await ok(B.call("requestFriend", USERS.A.id));
  const AB = await ok(A.call("openConversation", USERS.B.id));
  const toServer = () => (w.serverCalls || []).filter((c) => c.route === "/api/gifs/search");
  const SETUP = "GIF search isn't set up yet. Add KLIPY_API_KEY to the AURA server.";

  console.log("1. When GIF search isn't set up");
  check("an AURA server from before the GIF update: says what to do", (await err(A.call("gifSearch", ""))) === SETUP);
  answer = () => ({ success: false, error: "GIF search isn't set up on the AURA server yet." });
  check("a server with no key: the same", (await err(A.call("gifSearch", "cats"))) === SETUP);
  answer = () => ({ success: true, provider: "giphy", key: "not a key!" });
  check("an answer that isn't a key is not used", (await err(A.call("gifSearch", "cats"))) === SETUP);
  answer = () => ({ success: true, provider: "somewhere", gifs: [kg(1)] });
  check("nor is an answer from a service AURA doesn't know", (await err(A.call("gifSearch", "cats"))) === SETUP);
  answer = () => ({ success: false, error: "Couldn't reach the AURA server. Check your internet connection." });
  check("the server can't be reached: says that instead", /Couldn't reach the AURA server/.test(await err(A.call("gifSearch", "cats"))));
  check("no GIF service was contacted from this PC", asked.length === 0, asked);

  console.log("2. KLIPY: the AURA server does the searching");
  answer = (b) => ({ success: true, provider: "klipy", query: b.q, gifs: [kg(1), kg(2)], next: null });
  let n = toServer().length;
  let r = await ok(A.call("gifSearch", ""));
  let sent = toServer().pop();
  check("no words: asks the AURA server for what's popular, first page", toServer().length === n + 1 && JSON.stringify(sent.body) === JSON.stringify({ q: "", page: 1 }) && sent.uid === USERS.A.id, sent);
  check("each GIF comes back with a small preview and the address to send", r.provider === "klipy" && r.gifs.length === 2 && JSON.stringify(r.gifs[0]) === JSON.stringify({ id: "1", title: "Happy Dance", preview: { url: "https://static.klipy.com/ii/abc/01/02/1-sm.webp", width: 220, height: 124 }, send: { url: "https://static.klipy.com/ii/abc/01/02/1-md.gif", width: 300, height: 169 } }), r.gifs[0]);
  check("a short list has no next page", r.next === null, r.next);
  r = await ok(A.call("gifSearch", "  funny    cats  "));
  check("words are tidied before they are sent", JSON.stringify(toServer().pop().body) === JSON.stringify({ q: "funny cats", page: 1 }) && r.query === "funny cats", toServer().pop().body);
  await ok(A.call("gifSearch", "x".repeat(200)));
  check("a very long search is cut short", toServer().pop().body.q.length === 50);
  check("this PC never contacts KLIPY's search itself (so it never needs the key)", asked.length === 0, asked);
  n = toServer().length;
  await ok(A.call("gifSearch", "funny cats")); await ok(A.call("gifSearch", "FUNNY  cats")); await ok(A.call("gifSearch", ""));
  check("the same search again is answered from memory", toServer().length === n, toServer().length - n);
  answer = (b) => ({ success: true, provider: "klipy", query: b.q, gifs: Array.from({ length: 24 }, (_, i) => kg("p" + b.page + "x" + i)), next: b.page < 3 ? b.page + 1 : null });
  r = await ok(A.call("gifSearch", "dogs"));
  check("a full page says where the next one starts", r.gifs.length === 24 && r.next === 2, r.next);
  r = await ok(A.call("gifSearch", "dogs", 2));
  check("asking for more asks the server for that page", toServer().pop().body.page === 2 && r.gifs[0].id === "p2x0" && r.next === 3, [toServer().pop().body, r.next]);
  r = await ok(A.call("gifSearch", "dogs", 3));
  check("and stops at the end", r.next === null, r.next);
  r = await ok(A.call("gifSearch", "dogs", -5));
  check("a nonsense starting point means the start", r.gifs[0].id === "p1x0");

  console.log("3. Only real GIF-service pictures get through, whatever the server sends");
  const bad = (id, url) => kg(id, { preview: { url, width: 200, height: 100 }, send: { url, width: 200, height: 100 } });
  answer = () => ({ success: true, provider: "klipy", gifs: [
    bad(1, "https://evil.example/x.gif"), bad(2, "http://static.klipy.com/ii/a/b.gif"), bad(3, "https://static.klipy.com.evil.example/ii/a/b.gif"), bad(4, "https://static.klipy.com@evil.example/b.gif"),
    bad(5, "javascript:alert(1)"), bad(6, "https://static.klipy.com/ii/../../b.gif"), bad(7, "https://static.klipy.com/ii/a/b.gif?x=<script>"), bad(8, "https://static.klipy.com/ii/a/b.mp4"), bad(9, "https://notklipy.com/ii/a/b.gif"),
    bad(10, "https://static.klipy.com/ii/a/b.gif\nhttps://evil.example/x.gif"), bad(11, " https://static.klipy.com/ii/a/b.gif"), bad(12, "https://static.klipy.com:8443/ii/a/b.gif"), bad(13, "https://static.klipy.com\\@evil.example/b.gif"),
    kg(20), kg(20), null, "text", { id: "21" }, kg("bad id!"), { ...kg(22), title: "  Lots   of\n space  " },
    kg(23, { preview: { url: "https://static.klipy.co/ii/a/23.webp", width: "x", height: -4 } }),
  ], next: 99999 });
  r = await ok(A.call("gifSearch", "tricky"));
  check("anything not on the GIF service's own servers is dropped, and so are repeats and odd entries", r.gifs.map((g) => g.id).join() === "20,22,23", r.gifs.map((g) => [g.id, g.preview.url]));
  check("titles are tidied; odd sizes are left out; a nonsense next page is ignored", r.gifs[1].title === "Lots of space" && r.gifs[2].preview.width === null && r.gifs[2].preview.height === null && r.next === null, [r.gifs[1].title, r.gifs[2].preview, r.next]);

  console.log("4. When the search has trouble");
  answer = () => ({ success: false, error: "GIF search is busy right now. Try again in a few minutes." });
  check("the hourly limit: says it's busy", (await err(A.call("gifSearch", "limit"))) === "GIF search is busy right now. Try again in a few minutes.");
  answer = () => ({ success: false, error: "KLIPY didn't accept AURA's key. Check KLIPY_API_KEY on the AURA server." });
  check("a key KLIPY refuses: says to check the key", /Check KLIPY_API_KEY/.test(await err(A.call("gifSearch", "denied"))));
  answer = () => ({ success: false, error: "KLIPY's answer wasn't what AURA expected (pictures on an address AURA doesn't know: cdn.example.com). Copy this message to Claude." });
  check("an answer AURA can't use: the server's explanation is passed on", /cdn\.example\.com/.test(await err(A.call("gifSearch", "odd"))));
  answer = () => { throw new Error("boom"); };
  check("the server call failing outright: an error, not a crash", /isn't answering/.test(await err(A.call("gifSearch", "boom"))));
  answer = (b) => ({ success: true, provider: "klipy", query: b.q, gifs: [kg(1)], next: null });
  check("a failed search isn't remembered", (await ok(A.call("gifSearch", "limit"))).gifs.length === 1);

  console.log("5. GIPHY instead: this PC searches, with a key from the AURA server");
  await ok(A.call("stop")); await ok(A.call("start")); // (as after signing in again: nothing remembered)
  answer = () => ({ success: true, provider: "giphy", key: KEY });
  n = toServer().length;
  r = await ok(A.call("gifSearch", ""));
  let q = asked[asked.length - 1];
  check("no words: asks GIPHY for what's popular", asked.length === 1 && q.host === "api.giphy.com" && q.path === "/v1/gifs/trending" && q.method === "GET" && q.params.q === undefined, q);
  check("with the key, a page of 24, from the start, nothing explicit", q.params.api_key === KEY && q.params.limit === "24" && q.params.offset === "0" && q.params.rating === "pg-13", q.params);
  check("GIFs come back in the same shape", r.provider === "giphy" && r.gifs.length === 2 && r.gifs[0].id === "aaa111" && r.gifs[0].preview.url === "https://media1.giphy.com/media/aaa111/200w.webp?cid=abc&rid=200w.webp&ct=g" && r.gifs[0].preview.width === 200 && r.gifs[0].send.url === "https://media1.giphy.com/media/aaa111/200.webp?cid=abc&rid=200.webp&ct=g" && r.gifs[0].title === "Happy Dance GIF by Someone", r.gifs[0]);
  check("the key never reaches the window", !JSON.stringify(r).includes(KEY));
  r = await ok(A.call("gifSearch", "  funny    cats  "));
  q = asked[asked.length - 1];
  check("words: asks GIPHY's search", q.path === "/v1/gifs/search" && q.params.q === "funny cats", q);
  check("the AURA server is asked for the key once, then it is kept", toServer().length === n + 1, toServer().length - n);
  giphy = (u) => { const off = Number(u.searchParams.get("offset")); return { status: 200, body: { data: Array.from({ length: 24 }, (_, i) => gg("page" + off + "x" + i)), pagination: { total_count: 60, count: 24, offset: off } } }; };
  r = await ok(A.call("gifSearch", "dogs"));
  r = await ok(A.call("gifSearch", "dogs", r.next));
  check("more pages carry on from where the last one ended", asked[asked.length - 1].params.offset === "24" && r.gifs[0].id === "page24x0" && r.next === 48, [asked[asked.length - 1].params, r.next]);
  giphy = () => ({ status: 200, body: { data: [gg("ok1"), gg("x1", { images: { fixed_width: { url: "https://evil.example/x.gif", width: "1", height: "1" }, fixed_height: { url: "https://evil.example/x.gif" } } })], pagination: { total_count: 2 } } });
  check("pictures that aren't on GIPHY's servers are dropped", (await ok(A.call("gifSearch", "mixed"))).gifs.map((g) => g.id).join() === "ok1");
  giphy = () => ({ status: 429, body: {} });
  check("GIPHY's hourly limit: says it's busy", /busy right now/.test(await err(A.call("gifSearch", "g-limit"))));
  giphy = () => ({ throws: true });
  check("no connection: says so", /Couldn't reach GIPHY/.test(await err(A.call("gifSearch", "g-net"))));
  giphy = () => ({ status: 200, body: "<html>not json</html>" });
  check("a garbled answer: an error, not a crash", /GIPHY answered with an error/.test(await err(A.call("gifSearch", "g-junk"))));
  n = toServer().length;
  giphy = () => ({ status: 403, body: {} });
  check("a key GIPHY refuses: says to check the key", /didn't accept AURA's key/.test(await err(A.call("gifSearch", "g-denied"))));
  giphy = () => ({ status: 200, body: { data: [gg("after1")], pagination: { total_count: 1 } } });
  r = await ok(A.call("gifSearch", "g-after"));
  check("and the key is fetched fresh next time", toServer().length === n + 1 && r.gifs.length === 1, toServer().length - n);
  check("errors never show the key", ![await err(A.call("gifSearch", "g-denied")), SETUP].join().includes(KEY));

  console.log("6. Sending a GIF");
  await sleep(300); B.events.length = 0; w.notifications.length = 0; B.focused = false;
  const first = await ok(A.call("sendMessage", AB, KLIPY_GIF)); await sleep(80);
  check("a GIF is an ordinary message holding the GIF's address, unchanged", first.content === KLIPY_GIF && first.media === null, first);
  check("it arrives like any message", B.events.some((e) => e.type === "message" && e.message.content === KLIPY_GIF));
  check("the Windows notification says a GIF was sent, not the address", w.notifications.length === 1 && w.notifications[0].opts.body === "Sent a GIF" && w.notifications[0].opts.title === "tctray", w.notifications.map((x) => x.opts));
  let list = await ok(B.call("listConversations"));
  check("the conversation list shows GIF, not the address", list[0].lastMessage === "" && list[0].lastMedia === "GIF", [list[0].lastMessage, list[0].lastMedia]);
  await ok(A.call("sendMessage", AB, GIPHY_GIF)); await sleep(60);
  list = await ok(B.call("listConversations"));
  check("the same for a GIF from GIPHY", list[0].lastMessage === "" && list[0].lastMedia === "GIF", [list[0].lastMessage, list[0].lastMedia]);
  await sleep(9000); w.notifications.length = 0;
  const link = "https://evil.example/media/abc/200.gif";
  await ok(A.call("sendMessage", AB, link)); await sleep(80);
  check("a link to anywhere else stays a plain link", w.notifications.length === 1 && w.notifications[0].opts.body === link, w.notifications.map((x) => x.opts));
  list = await ok(B.call("listConversations"));
  check("in the list too", list[0].lastMessage === link && list[0].lastMedia === "", [list[0].lastMessage, list[0].lastMedia]);

  console.log("7. Signing out");
  n = toServer().length;
  const before = asked.length;
  await ok(A.call("stop")); await ok(A.call("start"));
  await ok(A.call("gifSearch", "dogs"));
  check("the key and remembered searches aren't kept for the next account", toServer().length === n + 1 && asked.length === before + 1, [toServer().length - n, asked.length - before]);
  w.noServer = true;
  const E = w.login("C"); await ok(E.call("start"));
  check("an AURA with no server set up: says what to do", (await err(E.call("gifSearch", ""))) === SETUP);

  console.log(failed ? "\n" + failed + " FAILED" : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST CRASHED:", e); process.exit(2); });
