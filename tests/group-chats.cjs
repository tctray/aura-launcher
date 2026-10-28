// Group chats in the Messages page. Three AURA windows (three people) in a real browser, with a
// pretend Supabase in this test that follows the rules in supabase/aura-messages-groups.sql:
//   - making a group (name and friends), the group in everyone's list, the lines saying what happened
//   - talking: who said what, likes, someone who isn't your friend in the same group
//   - renaming, removing someone, leaving
//   - calling two people from a group (a call with 3 people)
// Added by aura-messages-groups-setup.cjs.
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
  // ── Messages and groups, as aura-messages-groups.sql has them ──
  const friendsOf = { "user-A": ["user-B", "user-C"], "user-B": ["user-A"], "user-C": ["user-A"] };
  const isFriend = (x, y) => (friendsOf[x] || []).includes(y);
  const groups = []; // { id, title, owner, members: [{ id, joined, lastRead }] }
  const msgs = [];   // { id, conversationId, senderId, content, createdAt, reactions: [] }
  let nextId = 1;
  const uuid = () => { const n = String(nextId++).padStart(12, "0"); return `9${n.slice(1, 8)}-0000-4000-8000-${n}`; };
  const member = (g, me) => g.members.find((m) => m.id === me);
  const tellAll = (g, event, extra = []) => { for (const m of [...g.members.map((x) => x.id), ...extra]) tell(m, event); };
  const shapeMsg = (m) => ({ id: m.id, conversationId: m.conversationId, senderId: m.senderId, content: m.content, createdAt: m.createdAt, readAt: null, deleted: false, media: null, reactions: m.reactions.map((r) => ({ ...r })) });
  const post = (g, me, content) => {
    const m = { id: uuid(), conversationId: g.id, senderId: me, content, createdAt: new Date(Date.now() + msgs.length + 1).toISOString(), reactions: [] }; // always after the join time, like the database (Updated by aura-group-test-fix.cjs)
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
    sendMessage: (me, id, content) => { const g = findGroup(me, id); if (!g) return no("You can only message friends."); return ok(shapeMsg(post(g, me, String(content).trim()))); },
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
        return (...args) => window.__social(key, args);
      },
    });
    // Screens and windows to pick from, like Windows would list them
    const pic = (hue) => "data:image/svg+xml;base64," + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="hsl(${hue},40%,35%)"/></svg>`);
    window.__chosen = [];
    const desktop = {
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
  const thrown = (ids, world) => ids.flatMap((id) => world.people[id].thrown.filter((m) => !/reading 'live'/.test(m)));

  try {
    const world = makeWorld();
    const A = await person(browser, world, now.base, "user-A", "Alex");
    const B = await person(browser, world, now.base, "user-B", "Bri");
    const C = await person(browser, world, now.base, "user-C", "Cam");
    await sleep(5000);
    world.friendsChanged();
    const goTo = async (p, label) => { await p.locator(`.gm-rail-item[title="${label}"], .sb-item[title="${label}"]`).first().click({ timeout: 8000 }); await sleep(900); };
    for (const p of [A, B, C]) await goTo(p, "Messages");
    const listed = (p) => p.locator(".mx-conv").allInnerTexts();
    const open = async (p, name) => { await p.locator(".mx-conv", { hasText: name }).first().click({ timeout: 10000 }); await sleep(600); };
    const thread = (p) => p.locator(".mx-thread").innerText().catch(() => "");
    const typeSend = async (p, text) => { const box = p.locator(".mx-compose textarea"); await box.fill(text); await box.press("Enter"); };

    console.log("1. Making a group");
    const newBtn = A.locator('button[aria-label="New group"]');
    check("the Messages page has a New group button", await newBtn.isVisible());
    await newBtn.click();
    const sheet = A.locator('[role="dialog"][aria-label="New group"]');
    await sheet.waitFor({ timeout: 8000 });
    const ticks = await sheet.locator(".mx-tick").allInnerTexts();
    check("it lists your friends to pick from", ticks.length === 2 && ticks.some((t) => /Bri/.test(t)) && ticks.some((t) => /Cam/.test(t)), ticks);
    await sheet.locator('button[type="submit"]').click();
    check("it asks for a name first", /Give the group a name/.test(await sheet.innerText()));
    await sheet.locator("input.mx-input").fill("Squad");
    await sheet.locator(".mx-tick", { hasText: "Bri" }).click();
    await sheet.locator(".mx-tick", { hasText: "Cam" }).click();
    if (process.env.AURA_SHOT_DIR) await A.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "group-new.png") });
    await sheet.locator('button[type="submit"]').click();
    check("making it opens the group", await until(async () => /Squad/.test(await A.locator(".mx-head").innerText().catch(() => ""))));
    check("...which says who is in it", /3 people/.test(await A.locator(".mx-head").innerText()) && /Bri/.test(await A.locator(".mx-head").innerText()));
    check("...and that you made it", await until(async () => /You created the group/.test(await thread(A))));

    console.log("2. Everyone has it");
    check("Bri's list shows the group straight away", await until(async () => (await listed(B)).some((t) => /Squad/.test(t))), await listed(B));
    check("...saying who made it, as new", await until(async () => (await listed(B)).some((t) => /Alex created the group/.test(t)) && (await B.locator(".mx-conv.unread", { hasText: "Squad" }).count()) === 1), await listed(B)); // (Updated by aura-group-test-fix.cjs)
    check("Cam's too", await until(async () => (await listed(C)).some((t) => /Squad/.test(t))));
    await open(B, "Squad");
    check("in the group, the line reads as a sentence", /Alex created the group/.test(await thread(B)));
    check("opening it marks it read", await until(async () => !(await B.locator(".mx-conv.unread", { hasText: "Squad" }).count())));
    await open(C, "Squad");

    console.log("3. Talking");
    await typeSend(B, "who's on tonight?");
    check("Bri's message reaches Alex", await until(async () => /who's on tonight\?/.test(await thread(A))));
    check("...with Bri's name on it", await until(async () => (await A.locator(".mx-group.them .mx-meta").last().innerText()).includes("Bri")));
    check("Cam sees it too, though Cam and Bri aren't friends", await until(async () => /who's on tonight\?/.test(await thread(C))));
    await typeSend(C, "me!");
    check("Cam's answer reaches Bri, named", await until(async () => /me!/.test(await thread(B)) && (await B.locator(".mx-group.them .mx-meta").last().innerText()).includes("Cam")));
    const briMsg = C.locator(".mx-group.them .mx-msg", { hasText: "who's on tonight?" }).first();
    await briMsg.hover();
    await briMsg.locator('button[aria-label="Like"]').click();
    check("Cam can like Bri's message, and Bri sees who did", await until(async () => /Cam liked this/.test((await B.locator(".mx-react.like").first().getAttribute("title").catch(() => "")) || "")));
    if (process.env.AURA_SHOT_DIR) { await sleep(500); await B.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "group-chat.png") }); }

    console.log("4. The group's people");
    await A.locator(".mx-head .mx-who").click();
    const card = A.locator(".mx-gcard");
    await card.waitFor({ timeout: 8000 });
    const people = await card.innerText();
    check("its card lists everyone, and who made it", /3 people/.test(people) && /You/.test(people) && /Bri/.test(people) && /Cam/.test(people) && /Made the group/.test(people), people);
    check("whoever made it can remove people and add more", (await card.locator(".mx-gperson button", { hasText: "Remove" }).count()) === 2 && await card.locator("button", { hasText: "Add people" }).isVisible());
    if (process.env.AURA_SHOT_DIR) await A.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "group-card.png") });
    await A.keyboard.press("Escape");
    await C.locator(".mx-head .mx-who").click();
    const cCard = C.locator(".mx-gcard");
    await cCard.waitFor({ timeout: 8000 });
    check("the others can't remove anyone, and see who isn't their friend", (await cCard.locator(".mx-gperson button", { hasText: "Remove" }).count()) === 0 && /Not in your friends/.test(await cCard.innerText()));
    await cCard.locator("input.mx-input").fill("Friday crew");
    await cCard.locator('button[type="submit"]', { hasText: "Save" }).click();
    check("anyone can rename it: everyone sees the new name", await until(async () => /Friday crew/.test(await A.locator(".mx-head").innerText()) && /Friday crew/.test(await B.locator(".mx-head").innerText())));
    check("...with a line saying who did", await until(async () => /Cam named the group "Friday crew"/.test(await thread(A))));
    await C.keyboard.press("Escape");

    console.log("5. Removing and leaving");
    await A.locator(".mx-head .mx-who").click();
    A.once("dialog", (d) => d.accept());
    await A.locator(".mx-gcard .mx-gperson", { hasText: "Cam" }).locator("button", { hasText: "Remove" }).click();
    check("removing Cam takes the group out of Cam's list", await until(async () => !(await listed(C)).some((t) => /Friday crew/.test(t))));
    check("...and says so in the group", await until(async () => /You removed Cam/.test(await thread(A)) && /Alex removed Cam/.test(await thread(B))));
    await A.keyboard.press("Escape");
    await B.locator(".mx-head .mx-who").click();
    B.once("dialog", (d) => d.accept());
    await B.locator(".mx-gcard button", { hasText: "Leave group" }).click();
    check("Bri can leave", await until(async () => !(await listed(B)).some((t) => /Friday crew/.test(t))));
    check("...and Alex sees Bri left", await until(async () => /Bri left the group/.test(await thread(A))));

    console.log("6. Calling from a group");
    await A.locator('button[aria-label="New group"]').click();
    const sheet2 = A.locator('[role="dialog"][aria-label="New group"]');
    await sheet2.locator("input.mx-input").fill("Game night");
    await sheet2.locator(".mx-tick", { hasText: "Bri" }).click();
    await sheet2.locator(".mx-tick", { hasText: "Cam" }).click();
    await sheet2.locator('button[type="submit"]').click();
    await until(async () => /Game night/.test(await A.locator(".mx-head").innerText().catch(() => "")));
    await A.locator(".mx-head [data-mx-gcall]").click();
    const pick = A.locator(".mx-gcall");
    await pick.waitFor({ timeout: 8000 });
    check("Call lists the group's people who are your friends", (await pick.locator(".mx-tick").count()) === 2);
    await pick.locator(".mx-tick", { hasText: "Bri" }).click();
    await pick.locator(".mx-tick", { hasText: "Cam" }).click();
    await pick.locator(".mx-btn", { hasText: "Call both" }).click();
    check("Bri's AURA rings first", await until(() => B.evaluate(() => !!document.querySelector(".cx-bar.ringing.in"))));
    await B.locator(".cx-btn.yes").click({ timeout: 15000 });
    check("once Bri answers, Cam's AURA rings too", await until(async () => /Incoming group call/.test(await C.locator(".cx-bar.ringing.in").innerText().catch(() => "")), 25000));
    await C.locator(".cx-btn.yes").click({ timeout: 15000 });
    check("all three end up in one call", await until(async () => { const n = await A.locator(".cx-bar .cx-name").innerText().catch(() => ""); return /Bri/.test(n) && /Cam/.test(n); }, 25000));
    for (const p of [A, B, C]) await p.locator(".cx-bar .cx-round.end").click({ timeout: 5000 }).catch(() => {});

    check("nothing crashed along the way", thrown(["user-A", "user-B", "user-C"], world).length === 0, thrown(["user-A", "user-B", "user-C"], world));
  } finally {
    await browser.close();
    now.server.close();
    if (old) old.server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The group chat check itself broke:", e); process.exit(2); });
