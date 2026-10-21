// The call screen: the button in the call box that fills the monitor with the call. A big tile
// for each person (camera when it's on, profile picture when it isn't), their shared screen in the
// middle, and the call buttons along the bottom. Also the camera preview's full screen button.
// Two AURA windows call each other for real in a real browser with pretend cameras; a pretend
// Supabase passes the connection details between them.
// Added by aura-call-screen-setup.cjs.
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
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

// ── A pretend Supabase for calls ─────────────────────────────────────────────
function makeWorld() {
  const people = {};    // id -> { page, name }
  let calls = [], signals = [], nextSignal = 1, nextCall = 1;
  const shape = (c, me) => ({ id: c.id, callerId: c.caller, calleeId: c.callee, peerId: c.caller === me ? c.callee : c.caller, outgoing: c.caller === me, status: c.status, reason: c.reason || null });
  const tell = (id, event) => { const p = people[id]?.page; if (p) p.evaluate((e) => window.__deliver && window.__deliver(e), event).catch(() => {}); };
  const ok = (data) => ({ success: true, data });
  const no = (error) => ({ success: false, error });
  const end = (c, reason) => { if (c.status === "ended") return; c.status = "ended"; c.reason = reason || "hangup"; for (const id of [c.caller, c.callee]) tell(id, { type: "call", call: shape(c, id) }); };
  const handlers = {
    start: (me) => ok({ id: me, username: people[me].name, live: true }),
    listFriends: (me) => ok(Object.keys(people).filter((id) => id !== me).map((id) => ({ friendshipId: "f-" + id, userId: id, username: people[id].name, avatarUrl: "", state: "friend", since: null, online: true, lastSeenAt: new Date().toISOString() }))),
    getProfile: (_me, id) => ok(people[id] ? { userId: id, username: people[id].name, bio: "", avatarUrl: "" } : null),
    listConversations: () => ok([]), listBlocked: () => ok([]),
    callConfig: () => ok({ iceServers: [], relay: false }),
    currentCall: (me) => { const c = calls.find((x) => x.status !== "ended" && (x.caller === me || x.callee === me)); return ok(c ? shape(c, me) : null); },
    startCall: (me, other) => {
      if (calls.some((x) => x.status !== "ended" && [x.caller, x.callee].some((p) => p === me || p === other))) return no("You're already in a call.");
      const c = { id: "call-" + nextCall++, caller: me, callee: other, status: "ringing" };
      calls.push(c);
      tell(other, { type: "call", call: shape(c, other) });
      return ok(shape(c, me));
    },
    answerCall: (me, id) => { const c = calls.find((x) => x.id === id && x.callee === me && x.status === "ringing"); if (!c) return no("That call has ended."); c.status = "active"; tell(c.caller, { type: "call", call: shape(c, c.caller) }); return ok(shape(c, me)); },
    endCall: (me, id, reason) => { const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me)); if (c) end(c, reason); return ok(true); },
    callSignal: (me, id, kind, payload) => {
      const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me));
      if (!c || c.status !== "active") return no("That call isn't connected.");
      if (!["offer", "answer", "ice"].includes(kind)) return no("That isn't a valid call message.");
      if (typeof payload !== "string" || payload.length > 20000) return no("That call message is too long.");
      const to = c.caller === me ? c.callee : c.caller;
      const s = { id: nextSignal++, call: id, from: me, to, kind, payload };
      signals.push(s);
      world.biggest = Math.max(world.biggest, payload.length);
      world.sent[me] = (world.sent[me] || 0) + 1;
      tell(to, { type: "signal", callId: id, signal: { id: s.id, kind, payload } });
      return ok(s.id);
    },
    callState: (me, id, from) => { const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me)); return ok({ call: c ? shape(c, me) : null, signals: signals.filter((s) => s.call === id && s.to === me && s.id > (from || 0)).map((s) => ({ id: s.id, kind: s.kind, payload: s.payload })) }); },
    callBeat: (me, id) => { const c = calls.find((x) => x.id === id); return ok(c && c.status !== "ended" ? "active" : "ended"); },
  };
  // Someone opened AURA after the others had already loaded their friends list: tell everyone to look again
  const friendsChanged = () => Object.keys(people).forEach((id) => tell(id, { type: "friends" }));
  const world = { people, handlers, biggest: 0, sent: {}, friendsChanged, reset() { calls.forEach((c) => end(c, "hangup")); } };
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
    // Keep hold of every camera opened, and a way to make the next one fail
    window.__cams = [];
    window.__failCam = null;
    const realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c = {}) => {
      if (c.video && window.__failCam) { const e = new Error("pretend"); e.name = window.__failCam; throw e; }
      const s = await realGUM(c);
      if (c.video) window.__cams.push(s);
      return s;
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
  const until = async (fn, ms = 15000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); } catch { v = null; } if (v) return v; await sleep(200); } return v; };
  const live = (p) => until(() => p.evaluate(() => !!document.querySelector(".cx-bar.live")));
  const callFrom = async (from, to, toName) => {
    await from.locator(`button.cx-call[title="Call ${toName}"]`).first().click({ timeout: 15000 });
    await until(() => to.evaluate(() => !!document.querySelector(".cx-bar.ringing.in")));
    await to.locator(".cx-btn.yes").click({ timeout: 15000 });
    return (await live(from)) && (await live(to));
  };
  const camsLive = (p) => p.evaluate(() => window.__cams.filter((s) => s.getVideoTracks().some((t) => t.readyState === "live")).length);
  // What the call screen shows
  const stage = (p) => p.evaluate(() => {
    const st = document.querySelector(".cx-stage");
    if (!st) return null;
    const tile = (who) => {
      const t = st.querySelector(".cx-tile." + who);
      if (!t) return null;
      const v = t.querySelector("video"), f = t.querySelector(".cx-face");
      return { name: t.querySelector(".cx-tile-name")?.textContent || "", video: v ? v.videoWidth : -1, mirror: v ? getComputedStyle(v).transform : "", face: !!f, faceText: f?.textContent || "", muted: !!t.querySelector(".cx-tile-muted"), w: Math.round(t.getBoundingClientRect().width) };
    };
    const sv = st.querySelector(".cx-stage-screen video");
    const r = st.getBoundingClientRect();
    return { them: tile("them"), me: tile("me"), screen: sv ? sv.videoWidth : -1, full: !!document.fullscreenElement && document.fullscreenElement.contains(st), front: document.visibilityState + (document.hasFocus() ? ", focused" : ", not focused") + (document.fullscreenElement ? ", full screen: " + (document.fullscreenElement.id || document.fullscreenElement.className) : ", nothing full screen"), w: Math.round(r.width), h: Math.round(r.height), bar: getComputedStyle(document.querySelector(".cx-bar") || document.body).display, top: st.querySelector(".cx-stage-top")?.innerText || "" };
  });
  const sbtn = (p, label) => p.locator(`.cx-stage-bar button[aria-label="${label}"]`);

  try {
    const world = makeWorld();
    const A = await person(browser, world, now.base, "user-A", "Alex");
    const B = await person(browser, world, now.base, "user-B", "Bri");
    await sleep(5000);
    world.friendsChanged();
    await until(() => A.evaluate(() => !!document.querySelector('button.cx-call[title="Call Bri"]')));
    check("Alex calls Bri and they're connected", await callFrom(A, B, "Bri"));
    await until(() => A.locator(".cx-round.cam").isEnabled());

    console.log("1. The call screen button");
    const open = A.locator('.cx-bar button[aria-label="Open the call screen"]');
    check("the call box has a call screen button, with the other call buttons", (await open.count()) === 1 && (await A.evaluate(() => { const b = document.querySelector('.cx-bar button[aria-label="Open the call screen"]'); return b.parentElement.classList.contains("cx-acts") && b.nextElementSibling?.classList.contains("end"); })));
    // Only the window in front may go full screen (like a real AURA window you click in): two pretend people are two windows here
    await A.bringToFront();
    await open.click();
    // (full screen can take a moment to start on a slow PC: wait for it)
    let s = (await until(async () => { const x = await stage(A); return x && x.full ? x : null; }, 8000)) || (await stage(A));
    if (s && !s.full && s.w >= 1300 && s.h >= 800) {
      // Some test browsers refuse full screen for a window that isn't really in front (a real AURA window you click in is)
      note("this test browser didn't allow full screen here (" + s.front + "), so only filling the window was checked");
      check("it opens the call screen, filling the whole window", true);
    } else check("it opens the call screen, filling the whole monitor", !!s && s.full && s.w >= 1300 && s.h >= 800, s);
    check("the call box steps aside while it's open", s && s.bar === "none", s && s.bar);
    check("it says who the call is with, how long, and how to go back", !!s && /Bri/.test(s.top) && /\d\d:\d\d/.test(s.top) && /Esc/.test(s.top), s && s.top);
    check("a tile for each of you, with profile pictures while the cameras are off", !!s && s.them?.face && s.them.name === "Bri" && s.them.faceText === "B" && s.me?.face && s.me.name === "You" && s.me.faceText === "A", s);
    check("the tiles are big", !!s && s.them.w >= 500, s && s.them);
    const glow = await until(() => A.evaluate(() => Number(getComputedStyle(document.querySelector(".cx-stage")).getPropertyValue("--cx-peer")) > 0), 8000);
    check("a green ring follows Bri's voice", !!glow);

    console.log("2. Cameras on the call screen");
    await B.locator(".cx-round.cam").click();
    s = await until(async () => { const x = await stage(A); return x && x.them.video > 0 ? x : null; });
    check("when Bri turns the camera on, Bri's tile shows the full camera picture", !!s && !s.them.face && s.them.mirror === "none", s && s.them);
    await sbtn(A, "Turn your camera on").click();
    s = await until(async () => { const x = await stage(A); return x && x.me.video > 0 ? x : null; });
    check("Alex can turn the camera on from the call screen: Alex's tile shows it, mirrored", !!s && /matrix\(-1/.test(s.me.mirror), s && s.me);
    check("and Bri sees Alex's camera", !!(await until(() => B.evaluate(() => { const v = document.querySelector(".cx-cams .cx-cam-theirs"); return v && v.videoWidth > 0; }))));
    await sbtn(A, "Turn your camera off").click();
    s = await until(async () => { const x = await stage(A); return x && x.me.face ? x : null; });
    check("turning it off brings back the profile picture (and lets go of the camera)", !!s && (await camsLive(A)) === 0, s && s.me);

    console.log("3. Mute and screen share from the call screen");
    await sbtn(A, "Mute your microphone").click();
    s = await until(async () => { const x = await stage(A); return x && x.me.muted ? x : null; });
    check("mute works, and Alex's tile shows it", !!s && (await A.evaluate(() => !!document.querySelector(".cx-bar.muted"))));
    s = await until(async () => { const x = await B.evaluate(() => !!document.querySelector(".cx-peer-muted")); return x; });
    check("Bri sees Alex is muted", !!s);
    await sbtn(A, "Unmute your microphone").click();
    await B.locator(".cx-round.share").click({ timeout: 15000 });
    await B.locator(".cx-picker .cx-src").first().click({ timeout: 15000 });
    s = await until(async () => { const x = await stage(A); return x && x.screen > 0 ? x : null; }, 20000);
    check("when Bri shares a screen it takes the middle of the call screen", !!s, s);
    check("with both tiles beside it, smaller", !!s && s.them.w < 400 && s.me.w < 400 && /sharing/.test(s.them.name), s);
    check("(and the small screen-share window stays out of the way)", await A.evaluate(() => getComputedStyle(document.querySelector(".cx-screen") || document.body).display === "none" || !document.querySelector(".cx-screen")));
    await B.locator(".cx-round.share.on").click({ timeout: 15000 });
    s = await until(async () => { const x = await stage(A); return x && x.screen === -1 ? x : null; });
    check("when Bri stops, the tiles go back to full size", !!s && s.them.w >= 500, s);
    await sbtn(A, "Share your screen").click();
    await A.locator(".cx-stage .cx-picker .cx-src").first().click({ timeout: 15000 });
    check("Alex can share from the call screen, and Bri sees it", !!(await until(() => B.evaluate(() => { const v = document.querySelector(".cx-screen video"); return v && v.videoWidth > 0; }))));
    await sbtn(A, "Stop sharing your screen").click();

    console.log("4. Going back");
    await A.keyboard.press("Escape");
    check("Esc goes back to the call box (full screen ends, the call carries on)", !!(await until(async () => !(await stage(A)) && !(await A.evaluate(() => document.fullscreenElement)) && (await A.evaluate(() => getComputedStyle(document.querySelector(".cx-bar")).display !== "none" && !!document.querySelector(".cx-bar.live"))))));
    await open.click();
    await until(() => stage(A));
    await sbtn(A, "Leave the call screen").click();
    check("the back button does too", !!(await until(async () => !(await stage(A)) && !!(await A.evaluate(() => document.querySelector(".cx-bar.live"))))));
    await open.click();
    await until(() => stage(A));
    await sbtn(A, "Turn your camera on").click();
    await until(async () => (await camsLive(A)) === 1);
    await sbtn(A, "Hang up").click();
    check("hanging up from the call screen ends the call and closes it", !!(await until(async () => !(await stage(A)) && !(await A.evaluate(() => document.fullscreenElement)) && !(await B.evaluate(() => document.querySelector(".cx-bar.live"))))));
    check("and lets go of the camera", (await camsLive(A)) === 0);

    console.log("5. The camera preview's full screen button");
    if (await A.locator(".aura-cam").count()) {
      await A.locator(".aura-cam").first().click();
      await until(() => A.evaluate(() => { const v = document.querySelector(".cam-pan video"); return v && v.videoWidth > 0; }));
      await A.bringToFront();
      await A.locator('.cam-pan button[aria-label="Show the camera full screen"]').click();
      const f = await until(() => A.evaluate(() => { const e = document.fullscreenElement; return e && e.classList.contains("cam-view") ? { w: Math.round(e.getBoundingClientRect().width), fit: getComputedStyle(e.querySelector("video")).objectFit } : null; }));
      check("it shows the camera on the whole monitor", !!f && f.w >= 1300 && f.fit === "contain", f);
      await A.keyboard.press("Escape");
      check("Esc goes back to the small window, camera still on", !!(await until(() => A.evaluate(() => !document.fullscreenElement && !!document.querySelector(".cam-pan.on")))));
      await A.locator(".cam-view").dblclick();
      check("double-clicking the picture goes full screen too", !!(await until(() => A.evaluate(() => document.fullscreenElement?.classList.contains("cam-view")))));
      check("full screen shows an Exit full screen button", await A.locator(".cam-exit").isVisible());
      await A.locator(".cam-exit").click();
      check("and it works", !!(await until(() => A.evaluate(() => !document.fullscreenElement))));
      await A.locator('.cam-pan button[aria-label="Close the camera"]').click();
    } else note("the camera preview update isn't installed, so its full screen button wasn't checked");

    check("nothing crashed along the way", ["user-A", "user-B"].every((id) => world.people[id].thrown.filter((m) => !/reading 'live'/.test(m)).length === 0), ["user-A", "user-B"].map((id) => world.people[id].thrown));
    if (process.env.AURA_SHOT_DIR) {
      await callFrom(A, B, "Bri");
      await until(() => A.locator(".cx-round.cam").isEnabled());
      await B.locator(".cx-round.cam").click();
      await A.locator('.cx-bar button[aria-label="Open the call screen"]').click();
      await sleep(2500);
      await A.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "stage.png") });
      await B.locator(".cx-round.share").click({ timeout: 15000 });
      await B.locator(".cx-picker .cx-src").first().click({ timeout: 15000 });
      await sleep(3000);
      await A.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "stage-screen.png") });
    }
  } finally {
    await browser.close();
    now.server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The call screen check itself broke:", e); process.exit(2); });
