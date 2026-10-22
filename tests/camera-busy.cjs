// One camera for the camera preview and calls. Windows often won't open the same camera twice, so
// AURA shares it: turning your camera on in a call while the preview is open (or the other way
// round) borrows the picture instead of failing with "being used by another app". Two AURA windows
// call each other in a real browser, with Windows' one-camera rule imitated.
// Added by aura-camera-busy-setup.cjs.
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
    // Windows' rule for cameras, imitated: a camera already open can't be opened a second time
    // ("being used by another app"). __busy = "other" imitates another app holding it.
    window.__busy = "";
    window.__opened = [];
    const realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      if (c && c.video) {
        const open = window.__opened.some((s) => s.getVideoTracks().some((t) => t.readyState === "live"));
        if (window.__busy === "other" || open) throw new DOMException("Could not start video source", "NotReadableError");
        const s = await realGUM(c);
        window.__opened.push(s);
        return s;
      }
      return realGUM(c);
    };
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
    await sleep(5000);
    world.friendsChanged();
    await until(() => A.evaluate(() => !!document.querySelector('button.cx-call[title="Call Bri"]')));
    const previewOn = (p) => until(() => p.evaluate(() => { const v = document.querySelector(".cam-pan video"); return !!v && v.videoWidth > 0; }), 10000);
    const camMoving = (p) => until(() => p.evaluate(async () => { const v = document.querySelector(".cx-cams .cx-cam-theirs"); if (!v || !v.videoWidth) return false; const t = v.currentTime; await new Promise((r) => setTimeout(r, 600)); return v.currentTime > t; }), 20000);
    const opened = (p) => p.evaluate(() => window.__opened.length);
    const said = (p) => p.locator("body").innerText();

    console.log("1. Preview open, then the camera in a call");
    check("Alex calls Bri, Bri accepts", await callFrom(A, B, "Bri"));
    await A.locator(".aura-cam").first().click();
    check("Alex opens the camera preview", await previewOn(A));
    check("(this test's stand-in for Windows refuses a second opening)", (await A.evaluate(() => navigator.mediaDevices.getUserMedia({ video: true }).then(() => "opened", (e) => e.name))) === "NotReadableError");
    await until(() => A.locator(".cx-bar .cx-round.cam").isEnabled());
    await A.locator(".cx-bar .cx-round.cam").click();
    check("turning the camera on in the call works anyway", await until(() => A.locator(".cx-bar .cx-round.cam.on").count()));
    check("...without saying it's being used by another app", !/being used by another app/.test(await said(A)));
    check("Bri sees Alex's camera", await camMoving(B));
    check("the camera was only opened once", (await opened(A)) === 1, await opened(A));
    await A.locator('.cam-pan button[aria-label="Close the camera"]').first().click();
    await sleep(1500);
    check("closing the preview doesn't stop the call's camera", await camMoving(B));

    console.log("2. Camera in a call, then the preview");
    await until(() => B.locator(".cx-bar .cx-round.cam").isEnabled());
    await B.locator(".cx-bar .cx-round.cam").click();
    check("Bri turns the camera on in the call", await camMoving(A));
    await B.locator(".aura-cam").first().click();
    check("opening the preview shows it too", await previewOn(B));
    check("...without saying it's being used by another app", !/being used by another app/.test(await said(B)));
    check("the camera was only opened once", (await opened(B)) === 1, await opened(B));

    console.log("3. When another app really has it");
    await A.locator(".cx-bar .cx-round.cam.on").click();
    await sleep(800);
    await A.evaluate(() => { window.__busy = "other"; });
    await A.locator(".cx-bar .cx-round.cam").click();
    check("it says which kind of app to close", await until(async () => /being used by another app \(like Discord/.test(await said(A)), 8000));
    await hangUp(A);

    check("nothing crashed along the way", thrown(["user-A", "user-B"], world).length === 0, thrown(["user-A", "user-B"], world));
  } finally {
    await browser.close();
    now.server.close();
    if (old) old.server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The camera sharing check itself broke:", e); process.exit(2); });
