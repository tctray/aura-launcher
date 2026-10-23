// Links in messages: clickable links, a preview while you type (which you can remove), preview
// cards in the chat (page, YouTube that plays in the chat, Steam with its price), and a preview's
// picture only ever shown when it's AURA's own small JPEG. Two AURA windows in a real browser.
// Added by aura-messages-links-setup.cjs.
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const OLD = process.env.AURA_OLD_DIST || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff" };
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok || extra === undefined ? "" : "\n          " + (typeof extra === "string" ? extra : JSON.stringify(extra)))); };
const note = (text) => console.log("  note  " + text);
const done = (code) => { console.log(code === 0 ? "\nall passed" : code === 3 ? "\nskipped" : `\n${failed} FAILED`); process.exit(code); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve(dir) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path.join(dir, url === "/" ? "index.html" : url);
    if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, base: "http://127.0.0.1:" + server.address().port })));
}

// ── A pretend Supabase for calls, with groups (as in aura-calls-group.sql) ───
function makeWorld() {
  const people = {};    // id -> { page, name }
  let calls = [], signals = [], nextSignal = 1, nextCall = 1;
  const shape = (c, me) => ({ id: c.id, callerId: c.caller, calleeId: c.callee, peerId: c.caller === me ? c.callee : c.caller, outgoing: c.caller === me, status: c.status, reason: c.reason || null, groupId: c.group || null });
  const tell = (id, event) => { const p = people[id]?.page; if (p) p.evaluate((e) => window.__deliver && window.__deliver(e), event).catch(() => {}); };
  const both = (c) => { for (const id of [c.caller, c.callee]) tell(id, { type: "call", call: shape(c, id) }); };
  const ok = (data) => ({ success: true, data });
  const no = (error) => ({ success: false, error });
  const end = (c, reason) => { if (c.status === "ended") return; c.status = "ended"; c.reason = reason || "hangup"; both(c); };
  const live = () => calls.filter((x) => x.status !== "ended");
  const busy = (id) => live().some((x) => x.caller === id || x.callee === id);
  const groupPeople = (g) => new Set(live().filter((x) => x.group === g).flatMap((x) => [x.caller, x.callee]));
  const handlers = {
    start: (me) => ok({ id: me, username: people[me].name, live: true }),
    listFriends: (me) => ok(Object.keys(people).filter((id) => id !== me).map((id) => ({ friendshipId: "f-" + id, userId: id, username: people[id].name, avatarUrl: "", state: "friend", since: null, online: true, lastSeenAt: new Date().toISOString() }))),
    getProfile: (_me, id) => ok(people[id] ? { userId: id, username: people[id].name, bio: "", avatarUrl: "" } : null),
    listConversations: () => ok([]), listBlocked: () => ok([]),
    callConfig: () => ok({ iceServers: [], relay: false }),
    currentCall: (me) => { const c = live().find((x) => x.caller === me || x.callee === me); return ok(c ? shape(c, me) : null); },
    startCall: (me, other) => {
      if (busy(me)) return no("You're already in a call.");
      if (busy(other)) return no("They're on another call. Try again in a bit.");
      const c = { id: "call-" + nextCall++, caller: me, callee: other, status: "ringing" };
      calls.push(c);
      tell(other, { type: "call", call: shape(c, other) });
      return ok(shape(c, me));
    },
    answerCall: (me, id) => { const c = calls.find((x) => x.id === id && x.callee === me && x.status === "ringing"); if (!c) return no("That call has ended."); c.status = "active"; tell(c.caller, { type: "call", call: shape(c, c.caller) }); return ok(shape(c, me)); },
    endCall: (me, id, reason) => { const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me)); if (c) end(c, c.status === "ringing" ? (me === c.callee ? "declined" : reason === "missed" ? "missed" : "cancelled") : reason === "failed" ? "failed" : "hangup"); return ok(c ? shape(c, me) : null); },
    addToCall: (me, id, other) => {
      if (world.noGroups) return no("Calls with 3 people aren't set up in Supabase yet. Run aura-calls-group.sql first.");
      const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me) && x.status === "active");
      if (!c) return no("That call has ended.");
      const g = c.group || c.id;
      if (!c.group) { c.group = g; both(c); }
      const inCall = groupPeople(g);
      if (inCall.has(other)) return no("They're already in this call.");
      if (inCall.size >= 3) return no("This call is full. Calls can have up to 3 people.");
      if (busy(other)) return no("They're on another call. Try again in a bit.");
      const n = { id: "call-" + nextCall++, caller: me, callee: other, status: "ringing", group: g };
      calls.push(n);
      world.added.push(n.id);
      tell(other, { type: "call", call: shape(n, other) });
      return ok(shape(n, me));
    },
    joinGroup: (me, id) => {
      const c = calls.find((x) => x.id === id && x.callee === me && x.status === "active" && x.group);
      if (!c) return no("That call has ended.");
      const made = [];
      const others = new Set(live().filter((x) => x.group === c.group && x.status === "active").flatMap((x) => [x.caller, x.callee]));
      others.delete(me);
      for (const other of others) {
        if (live().some((x) => x.group === c.group && ((x.caller === me && x.callee === other) || (x.caller === other && x.callee === me)))) continue;
        const n = { id: "call-" + nextCall++, caller: me, callee: other, status: "active", group: c.group };
        calls.push(n);
        tell(other, { type: "call", call: shape(n, other) });
        made.push(shape(n, me));
      }
      return ok(made);
    },
    callSignal: (me, id, kind, payload) => {
      const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me));
      if (!c || c.status !== "active") return no("That call isn't connected.");
      if (!["offer", "answer", "ice"].includes(kind)) return no("That isn't a valid call message.");
      if ((kind === "offer" && me !== c.caller) || (kind === "answer" && me !== c.callee)) return no("That isn't a valid call message.");
      if (typeof payload !== "string" || payload.length > 20000) return no("That call message is too long.");
      const to = c.caller === me ? c.callee : c.caller;
      const s = { id: nextSignal++, call: id, from: me, to, kind, payload };
      signals.push(s);
      world.biggest = Math.max(world.biggest, payload.length);
      tell(to, { type: "signal", callId: id, signal: { id: s.id, kind, payload } });
      return ok(s.id);
    },
    callState: (me, id, from) => { const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me)); return ok({ call: c ? shape(c, me) : null, signals: signals.filter((s) => s.call === id && s.to === me && s.id > (from || 0)).map((s) => ({ id: s.id, kind: s.kind, payload: s.payload })) }); },
    callBeat: (me, id) => { const c = calls.find((x) => x.id === id); return ok(c && c.status !== "ended" ? "active" : "ended"); },
  };
  const friendsChanged = () => Object.keys(people).forEach((id) => tell(id, { type: "friends" }));
  const between = (x, y) => live().find((c) => (c.caller === x && c.callee === y) || (c.caller === y && c.callee === x)) || null;
  // ── Messages and groups, as aura-messages-groups.sql has them (and link previews) ──
  // A picture: a real 4 x 3 PNG, so the window can make its small JPEG from it
  const PNG = [...(() => {
    const zlib = require("zlib");
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
    const w = 64, h = 36, ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; raw[i] = 40 + x * 3; raw[i + 1] = 80; raw[i + 2] = 160 - y * 2; }
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  })()]; // a real 64 x 36 picture
  const PREVIEWS = {
    "https://example.com/post": { url: "https://example.com/post", kind: "page", title: "Patch notes", description: "Big changes this week", site: "Example News", image: { bytes: PNG, mime: "image/png" } },
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ": { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", kind: "youtube", videoId: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", description: "Rick Astley", site: "YouTube", image: { bytes: PNG, mime: "image/png" } },
    "https://store.steampowered.com/app/367520/": { url: "https://store.steampowered.com/app/367520/", kind: "steam", appId: "367520", title: "Hollow Knight", description: "Forge your own path", site: "Steam", price: "$14.99", image: null },
  };
  const friendsOf = { "user-A": ["user-B", "user-C"], "user-B": ["user-A"], "user-C": ["user-A"] };
  const isFriend = (x, y) => (friendsOf[x] || []).includes(y);
  const groups = []; // { id, title, owner, members: [{ id, joined, lastRead }] }
  const msgs = [];   // { id, conversationId, senderId, content, createdAt, reactions: [] }
  let nextId = 1;
  const uuid = () => { const n = String(nextId++).padStart(12, "0"); return `9${n.slice(1, 8)}-0000-4000-8000-${n}`; };
  const member = (g, me) => g.members.find((m) => m.id === me);
  const tellAll = (g, event, extra = []) => { for (const m of [...g.members.map((x) => x.id), ...extra]) tell(m, event); };
  const shapeMsg = (m) => ({ id: m.id, conversationId: m.conversationId, senderId: m.senderId, content: m.content, createdAt: m.createdAt, readAt: null, deleted: false, media: null, link: m.link || null, reactions: m.reactions.map((r) => ({ ...r })) });
  const post = (g, me, content, link) => {
    const m = { id: uuid(), conversationId: g.id, senderId: me, content, createdAt: new Date(Date.now() + msgs.length).toISOString(), reactions: [], link: link || null };
    msgs.push(m);
    tellAll(g, { type: "message", message: shapeMsg(m) });
    return m;
  };
  const shapeGroup = (g, me) => {
    const mine = msgs.filter((m) => m.conversationId === g.id);
    const last = mine[mine.length - 1];
    const seen = member(g, me).lastRead || member(g, me).joined;
    return {
      id: g.id, isGroup: true, title: g.title, username: g.title, userId: null, avatarUrl: "", online: false, isFriend: true, ownerId: g.owner,
      members: g.members.map((x) => ({ userId: x.id, username: people[x.id].name, avatarUrl: "", owner: x.id === g.owner, isFriend: x.id === me || isFriend(me, x.id), online: true })),
      lastMessage: last?.content || "", lastSenderId: last?.senderId || null, lastMessageAt: last?.createdAt || g.created, unread: mine.filter((m) => m.senderId !== me && m.createdAt > seen).length, lastMedia: "", background: null,
    };
  };
  const findGroup = (me, id) => groups.find((g) => g.id === id && member(g, me));
  Object.assign(handlers, {
    listFriends: (me) => ok((friendsOf[me] || []).filter((id) => people[id]).map((id) => ({ friendshipId: "f-" + me + id, userId: id, username: people[id].name, avatarUrl: "", state: "friend", since: null, online: true, lastSeenAt: new Date().toISOString() }))),
    listConversations: (me) => ok(groups.filter((g) => member(g, me)).map((g) => shapeGroup(g, me)).sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1))),
    getMessages: (me, id) => { const g = findGroup(me, id); return g ? ok({ messages: msgs.filter((m) => m.conversationId === id).map(shapeMsg), hasMore: false }) : no("That isn't your conversation."); },
    sendMessage: (me, id, content, link) => { const g = findGroup(me, id); if (!g) return no("You can only message friends."); return ok(shapeMsg(post(g, me, String(content).trim(), link))); },
    linkPreview: (_me, url) => ok(PREVIEWS[url] || null),
    markRead: (me, id) => { const g = findGroup(me, id); if (g) member(g, me).lastRead = new Date(Date.now() + 1000).toISOString(); return ok(true); },
    react: (me, mid, reaction, cid) => {
      const m = msgs.find((x) => x.id === mid);
      const g = m && findGroup(me, m.conversationId);
      if (!g || cid !== g.id) return no("That message isn't in one of your conversations.");
      m.reactions = m.reactions.filter((r) => r.userId !== me);
      if (reaction) m.reactions.push({ userId: me, reaction });
      tellAll(g, { type: "reaction", messageId: mid, conversationId: g.id, userId: me, reaction: reaction || null });
      return ok({ messageId: mid, userId: me, reaction: reaction || null });
    },
    createGroup: (me, title, ids) => {
      const t = String(title || "").trim();
      if (!t) return no("Give the group a name.");
      if (!ids.length || ids.some((x) => !isFriend(me, x))) return no("You can only add friends to a group.");
      const now = new Date().toISOString();
      const g = { id: uuid(), title: t, owner: me, created: now, members: [me, ...ids].map((id) => ({ id, joined: now, lastRead: id === me ? now : null })) };
      groups.push(g);
      for (const x of ids) tell(x, { type: "groups" });
      post(g, me, "👥 created the group");
      return ok(g.id);
    },
    addGroupMembers: (me, id, ids) => {
      const g = findGroup(me, id);
      if (!g || g.owner !== me) return no("Only the person who made the group can add people.");
      const now = new Date().toISOString();
      for (const x of ids) if (!member(g, x)) { g.members.push({ id: x, joined: now, lastRead: null }); tell(x, { type: "groups" }); post(g, me, "👥 added " + people[x].name); }
      return ok(ids.length);
    },
    removeGroupMember: (me, id, who) => {
      const g = findGroup(me, id);
      if (!g || g.owner !== me) return no("Only the person who made the group can remove people.");
      post(g, me, "👥 removed " + people[who].name);
      g.members = g.members.filter((x) => x.id !== who);
      tellAll(g, { type: "groups" }, [who]);
      return ok(true);
    },
    leaveGroup: (me, id) => {
      const g = findGroup(me, id);
      if (!g) return ok(false);
      post(g, me, "👥 left the group");
      g.members = g.members.filter((x) => x.id !== me);
      if (g.owner === me && g.members.length) g.owner = g.members[0].id;
      tellAll(g, { type: "groups" }, [me]);
      return ok(true);
    },
    renameGroup: (me, id, title) => { const g = findGroup(me, id); if (!g) return no("That isn't one of your groups."); g.title = String(title).trim(); post(g, me, `👥 named the group "${g.title}"`); return ok(g.title); },
  });
  const world = { people, handlers, biggest: 0, added: [], noGroups: false, friendsChanged, between, live, groups, msgs, reset() { calls.forEach((c) => end(c, "hangup")); } };
  return world;
}

async function person(browser, world, base, id, name) {
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 860 }, permissions: ["microphone"] })).newPage();
  const thrown = [];
  page.on("pageerror", (e) => thrown.push(String(e.message || e).split("\n")[0]));
  world.people[id] = { page, name, thrown };
  await page.exposeBinding("__social", (_src, fn, args) => { const h = world.handlers[fn]; return h ? h(id, ...(args || [])) : { success: true, data: null }; });
  await page.addInitScript(([id, name]) => {
    try { localStorage.clear(); localStorage.setItem("aura_profile", JSON.stringify({ username: name, avatar: "", userId: id })); } catch {}
    const ok = (data) => Promise.resolve({ success: true, data });
    const account = { getSession: () => ok({ id, email: name + "@example.com" }), getMyProfile: () => ok({ username: name, avatar_url: null }) };
    window.auraCloud = new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (account[key] ? account[key](...args) : ok(null))) });
    window.auraSocial = new Proxy({}, {
      get: (_t, key) => {
        if (key === "then") return undefined;
        if (key === "onEvent") return (cb) => { window.__deliver = cb; return () => { window.__deliver = null; }; };
        // (a preview's picture arrives as numbers here: made back into bytes, as the real app gets them)
        if (key === "linkPreview") return (...args) => window.__social(key, args).then((r) => { if (r?.data?.image?.bytes) r.data.image.bytes = new Uint8Array(r.data.image.bytes); return r; });
        return (...args) => window.__social(key, args);
      },
    });
    // Screens and windows to pick from, like Windows would list them
    const pic = (hue) => "data:image/svg+xml;base64," + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="hsl(${hue},40%,35%)"/></svg>`);
    window.__chosen = [];
    window.__opened = [];
    const desktop = {
      openExternal: (u) => { window.__opened.push(u); return Promise.resolve({ success: true }); },
      getCaptureSources: () => Promise.resolve({ success: true, sources: [
        { id: "window:22:0", name: "Notepad", thumbnail: pic(200), isScreen: false },
        { id: "screen:0:0", name: "Entire screen", thumbnail: pic(20), isScreen: true },
      ] }),
      setCaptureSource: (sid) => { window.__chosen.push(sid); return Promise.resolve({ success: true }); },
    };
    window.electronAPI = new Proxy({}, {
      get: (_t, key) => {
        if (key === "isElectron") return true;
        if (typeof key !== "string" || key === "then") return undefined;
        if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};
        return (...args) => (desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }));
      },
    });
    // Keep hold of every screen captured, to check it's switched off afterwards
    window.__screens = [];
    const realGDM = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = async (...a) => { const s = await realGDM(...a); window.__screens.push(s); return s; };
    // Keep hold of the connections, so the test can see what goes over them
    const Real = window.RTCPeerConnection;
    window.__pcs = [];
    window.RTCPeerConnection = function (...a) { const pc = new Real(...a); window.__pcs.push(pc); return pc; };
    window.RTCPeerConnection.prototype = Real.prototype;
  }, [id, name]);
  await page.goto(base + "/index.html", { waitUntil: "load" });
  return page;
}

(async () => {
  if (!fs.existsSync(path.join(DIST, "index.html"))) { check("the window has been built (dist/index.html)", false, "Run  npm run build  first."); return done(1); }
  let chromium;
  try { ({ chromium } = require("playwright")); } catch { note("the test browser isn't installed here"); return done(process.env.CI ? 1 : 3); }
  const args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--auto-accept-this-tab-capture", "--autoplay-policy=no-user-gesture-required"];
  let browser = null;
  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: "msedge" }, { channel: "chrome" }]) {
    try { browser = await chromium.launch({ ...options, args }); break; } catch {}
  }
  if (!browser) { note("no browser to test with. Run  npx playwright install chromium  once to add one."); return done(process.env.CI ? 1 : 3); }
  const now = await serve(DIST);
  const old = OLD && fs.existsSync(path.join(OLD, "index.html")) ? await serve(OLD) : null;

  const until = async (fn, ms = 15000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); } catch { v = null; } if (v) return v; await sleep(200); } return v; };
  const bar = (p) => p.locator(".cx-bar");
  const barName = (p) => p.evaluate(() => document.querySelector(".cx-bar .cx-name")?.textContent || "");
  const live = (p) => until(() => p.evaluate(() => !!document.querySelector(".cx-bar.live")));
  const callFrom = async (from, to, toName) => {
    await from.locator(`button.cx-call[title="Call ${toName}"]`).first().click({ timeout: 10000 });
    await until(() => to.evaluate(() => !!document.querySelector(".cx-bar.ringing.in")));
    await to.locator(".cx-btn.yes").click({ timeout: 15000 });
    return (await live(from)) && (await live(to));
  };
  const hangUp = async (p) => { await p.locator(".cx-bar .cx-round.end").click({ timeout: 15000 }).catch(() => {}); await sleep(1500); };
  const openAdder = async (p) => { if (!(await p.locator(".cx-bar .cx-adder").count())) await p.locator(".cx-bar .cx-round.add").click({ timeout: 10000 }); await p.locator(".cx-bar .cx-adder").waitFor({ timeout: 10000 }); };
  const addFrom = async (p, name) => {
    await openAdder(p);
    const row = p.locator(".cx-adder .cx-add-row", { hasText: name });
    await row.first().waitFor({ timeout: 10000 });
    await row.first().click();
  };
  // How much sound is arriving on each connection that is open
  const hearing = (p) => p.evaluate(async () => {
    const out = [];
    for (const pc of window.__pcs.filter((x) => x.connectionState === "connected")) {
      let a = 0;
      (await pc.getStats()).forEach((r) => { if (r.type === "inbound-rtp" && r.kind === "audio") a = r.bytesReceived || 0; });
      out.push(a);
    }
    return out;
  });
  // Every open connection is getting sound, and more of it than a moment ago
  const allHear = async (p, count) => {
    const before = await hearing(p);
    await sleep(1500);
    const after = await hearing(p);
    return after.length === count && before.length === count && after.every((a, i) => a > before[i]) ? after : { before, after };
  };
  // (this test's own set-up also runs inside the YouTube player's frame, where it has no screens to fake: that one isn't AURA's)
const thrown = (ids, world) => ids.flatMap((id) => world.people[id].thrown.filter((m) => !/reading 'live'|reading 'getDisplayMedia'/.test(m)));

  try {
    const world = makeWorld();
    const A = await person(browser, world, now.base, "user-A", "Alex");
    const B = await person(browser, world, now.base, "user-B", "Bri");
    await sleep(5000);
    world.handlers.createGroup("user-A", "Links", ["user-B"]);
    world.friendsChanged();
    const goTo = async (p, label) => { await p.locator(`.gm-rail-item[title="${label}"], .sb-item[title="${label}"]`).first().click({ timeout: 8000 }); await sleep(900); };
    for (const p of [A, B]) { await goTo(p, "Messages"); await p.locator(".mx-conv", { hasText: "Links" }).first().click({ timeout: 10000 }); await sleep(500); }
    const box = A.locator(".mx-compose textarea");
    const sentLink = () => world.msgs[world.msgs.length - 1].link;

    console.log("1. A preview while you type");
    await box.fill("look https://example.com/post");
    const draft = A.locator(".mx-compose .mx-link-card.draft");
    check("a preview of the link shows above the box", await until(async () => /Patch notes/.test(await draft.innerText().catch(() => ""))));
    check("...with the site's name and a small picture made on this PC", /Example News/.test(await draft.innerText()) && /^data:image\/jpeg;base64,/.test(await draft.locator("img").getAttribute("src")));
    if (process.env.AURA_SHOT_DIR) await A.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "link-draft.png") });
    await box.press("Enter");
    check("sending it sends the preview with the message", await until(() => sentLink()?.title === "Patch notes") && /^data:image\/jpeg;base64,/.test(sentLink().image || ""));
    check("the preview goes from above the box", !(await draft.count()));

    console.log("2. In the chat");
    const card = B.locator(".mx-group.them .mx-link-card").last();
    check("Bri sees the preview card under the message", await until(async () => /Patch notes/.test(await card.innerText().catch(() => ""))) && /Big changes this week/.test(await card.innerText()));
    check("...with its picture", /^data:image\/jpeg;base64,/.test(await card.locator("img").getAttribute("src")));
    await card.locator(".mx-link-text").click();
    check("clicking the card opens the page in the browser", await until(() => B.evaluate(() => window.__opened.includes("https://example.com/post"))));
    const anchor = B.locator(".mx-group.them .mx-bubble a.mx-a").last();
    check("the link in the message can be clicked too", (await anchor.innerText()) === "https://example.com/post");
    await B.evaluate(() => { window.__opened = []; });
    await anchor.click();
    check("...and opens in the browser, not inside AURA", await until(() => B.evaluate(() => window.__opened.length === 1 && window.__opened[0] === "https://example.com/post")));
    if (process.env.AURA_SHOT_DIR) await B.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "link-chat.png") });

    console.log("3. Removing a preview, and links without one");
    await box.fill("and https://example.com/post again");
    await until(() => draft.isVisible());
    await A.locator(".mx-compose .mx-link-x").click();
    check("the × removes the preview", !(await draft.count()));
    await box.press("Enter");
    check("...and the message goes without it", await until(() => world.msgs[world.msgs.length - 1].content === "and https://example.com/post again") && sentLink() === null);
    await box.fill("see https://example.org/nothing-here.");
    await sleep(1200);
    check("a link with no preview shows none", !(await draft.count()));
    await box.press("Enter");
    const plain = B.locator(".mx-group.them .mx-bubble a.mx-a", { hasText: "nothing-here" });
    check("...but is still a link (without the full stop after it)", await until(async () => (await plain.count()) === 1) && (await plain.innerText()) === "https://example.org/nothing-here");

    console.log("4. YouTube and Steam");
    await box.fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await until(async () => /Never Gonna/.test(await draft.innerText().catch(() => "")));
    await box.press("Enter");
    const yt = B.locator(".mx-link-card.youtube").last();
    check("a YouTube link shows the video with a play button", await until(() => yt.isVisible()) && (await yt.locator(".mx-link-play").count()) === 1);
    check("...and nothing from YouTube loads until it's played", (await yt.locator("iframe").count()) === 0);
    await yt.locator(".mx-link-pic").click();
    check("pressing play plays it in the chat (privacy-friendly YouTube)", await until(async () => /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?autoplay=1/.test((await yt.locator("iframe").getAttribute("src").catch(() => "")) || "")));
    await box.fill("https://store.steampowered.com/app/367520/");
    await until(async () => /Hollow Knight/.test(await draft.innerText().catch(() => "")));
    await box.press("Enter");
    const steam = B.locator(".mx-link-card.steam").last();
    check("a Steam link shows the game and its price", await until(async () => /Hollow Knight/.test(await steam.innerText().catch(() => ""))) && /\$14\.99/.test(await steam.innerText()));

    console.log("5. A preview made some other way");
    const g = world.groups[0];
    world.msgs.push({ id: "bad-1", conversationId: g.id, senderId: "user-A", content: "https://example.com/x", createdAt: new Date(Date.now() + 99999).toISOString(), reactions: [], link: { url: "https://example.com/x", kind: "page", title: "Sneaky", site: "x", image: "https://tracker.example/pixel.gif" } });
    await B.evaluate((m) => window.__deliver && window.__deliver({ type: "message", message: m }), { id: "bad-1", conversationId: g.id, senderId: "user-A", content: "https://example.com/x", createdAt: new Date(Date.now() + 99999).toISOString(), readAt: null, deleted: false, media: null, reactions: [], link: { url: "https://example.com/x", kind: "page", title: "Sneaky", site: "x", image: "https://tracker.example/pixel.gif" } });
    const sneaky = B.locator(".mx-link-card", { hasText: "Sneaky" });
    check("a picture from anywhere else is never loaded", await until(() => sneaky.isVisible()) && (await sneaky.locator("img").count()) === 0);

    check("nothing crashed along the way", thrown(["user-A", "user-B"], world).length === 0, thrown(["user-A", "user-B"], world));
  } finally {
    await browser.close();
    now.server.close();
    if (old) old.server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The links check itself broke:", e); process.exit(2); });
