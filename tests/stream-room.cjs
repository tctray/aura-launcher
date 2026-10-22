// A Twitch stream makes room for AURA's own panels. The player is drawn on top of AURA's page, so
// call cameras, a shared screen, call settings and the camera preview used to be hidden under it.
// Checks the math (electron/streamroom.js), and, in two AURA windows in a call, that the page tells
// the main process where those panels are.
// Added by aura-stream-room-setup.cjs.
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
  const world = { people, handlers, biggest: 0, added: [], noGroups: false, friendsChanged, between, live, reset() { calls.forEach((c) => end(c, "hangup")); } };
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
    window.__room = [];
    const desktop = {
      getCaptureSources: () => Promise.resolve({ success: true, sources: [
        { id: "window:22:0", name: "Notepad", thumbnail: pic(200), isScreen: false },
        { id: "screen:0:0", name: "Entire screen", thumbnail: pic(20), isScreen: true },
      ] }),
      setCaptureSource: (sid) => { window.__chosen.push(sid); return Promise.resolve({ success: true }); },
      streamRoom: (room) => { window.__room.push(room); return Promise.resolve({ success: true }); },
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
  console.log("1. The player makes room (electron/streamroom.js)");
  const { fitStream, cleanRoom } = require(path.join(ROOT, "electron", "streamroom.js"));
  const want = { x: 160, y: 120, width: 1400, height: 880 };
  check("nothing in the way: the player stays where it is", fitStream(want, { rects: [], all: false }) === want);
  check("a panel off to the side changes nothing", fitStream(want, { rects: [{ x: 1600, y: 200, width: 200, height: 200 }] }) === want);
  let f = fitStream(want, { rects: [{ x: 700, y: 60, width: 340, height: 250 }] });
  check("call cameras near the top: the player starts below them", f && f.y === 318 && f.y + f.height === 1000 && f.x === 160 && f.width === 1400, f);
  f = fitStream(want, { rects: [{ x: 1080, y: 700, width: 480, height: 300 }] });
  check("a shared screen in the bottom corner: the player ends above it", f && f.y === 120 && f.y + f.height === 692, f);
  f = fitStream(want, { rects: [{ x: 700, y: 60, width: 340, height: 250 }] }, 1.25);
  check("with AURA zoomed in, page sizes are turned into window sizes", f && f.y === Math.ceil(310 * 1.25 + 10), f);
  check("when there isn't room left, it steps aside (still playing)", fitStream(want, { rects: [{ x: 700, y: 60, width: 340, height: 500 }, { x: 700, y: 640, width: 300, height: 300 }] }) === null);
  check("the call screen needs the whole window: it steps aside", fitStream(want, { rects: [], all: true }) === null);
  const clean = cleanRoom({ all: "yes", rects: [{ x: 1, y: 2, width: 3, height: 4 }, { x: "a", y: 0, width: 5, height: 5 }, { x: 0, y: 0, width: -5, height: 5 }, ...Array(20).fill({ x: 0, y: 0, width: 1, height: 1 })] });
  check("what the page sends is checked (numbers only, sizes above zero, the first 12 only, all only when true)", clean.all === false && clean.rects.length === 10 && clean.rects[0].x === 1, clean);
  const mainSrc = fs.readFileSync(path.join(ROOT, "electron", "main.js"), "utf8");
  check("every place that sizes the player goes through placeStream", (mainSrc.match(/streamView\.setBounds\(/g) || []).length === 1 && /function placeStream/.test(mainSrc));
  check("...and the chat through placeChat", !/chatView\.setBounds\(/.test(mainSrc) && /function placeChat/.test(mainSrc));

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
    await sleep(5000);
    world.friendsChanged();
    await until(() => A.evaluate(() => !!document.querySelector('button.cx-call[title="Call Bri"]')));
    const room = (p) => p.evaluate(() => window.__room[window.__room.length - 1] || null);
    const has = (r, box) => !!r && !r.all && r.rects.some((x) => Math.abs(x.x - box.x) <= 2 && Math.abs(x.y - box.y) <= 2 && Math.abs(x.width - box.width) <= 2 && Math.abs(x.height - box.height) <= 2);
    const boxOf = (p, sel) => p.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } : null; }, sel);

    console.log("2. The page says where its panels are");
    check("with no call, nothing needs room", await until(async () => { const r = await room(A); return r && !r.all && r.rects.length === 0; }));
    check("Alex calls Bri, Bri accepts", await callFrom(A, B, "Bri"));
    check("the call box needs room", await until(async () => has(await room(A), await boxOf(A, ".cx-bar"))));
    await until(() => B.locator(".cx-bar .cx-round.cam").isEnabled());
    await B.locator(".cx-bar .cx-round.cam").click();
    await until(() => A.locator(".cx-cams").count());
    check("the cameras under the call box need room", await until(async () => has(await room(A), await boxOf(A, ".cx-cams"))));
    await A.locator(".cx-bar [data-cx-devices]").click();
    check("so do the call settings while they're open", await until(async () => has(await room(A), await boxOf(A, ".cx-devices"))));
    await A.keyboard.press("Escape");
    check("...and not once they're closed", await until(async () => { const r = await room(A); return r && r.rects.length === 2; }));
    await A.locator(".cx-bar .cx-round.stage").click();
    check("the call screen needs the whole window", await until(async () => (await room(A))?.all === true));
    await A.keyboard.press("Escape");
    check("going back to the call box gives the stream its place back", await until(async () => (await room(A))?.all === false));
    await A.locator(".aura-cam").first().click();
    check("the camera preview needs room too", await until(async () => { const b = await boxOf(A, ".cam-pan"); return b && has(await room(A), b); }));
    await A.locator('.cam-pan button[aria-label="Close the camera"]').first().click();
    await hangUp(A);
    check("after the call, nothing needs room again", await until(async () => { const r = await room(A); return r && !r.all && r.rects.length === 0; }));
    check("it only speaks up when something changes", (await A.evaluate(() => window.__room.length)) < 40, await A.evaluate(() => window.__room.length));
    check("nothing crashed along the way", thrown(["user-A", "user-B"], world).length === 0, thrown(["user-A", "user-B"], world));
  } finally {
    await browser.close();
    now.server.close();
    if (old) old.server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The stream room check itself broke:", e); process.exit(2); });
