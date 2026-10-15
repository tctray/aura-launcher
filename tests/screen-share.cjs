// Screen share in voice calls. Two AURA windows (two people) call each other for real, in a real
// browser: the call goes PC to PC, and a pretend Supabase in this test passes the ringing and
// connection details between them. Checks:
//   - the Share Screen button, the picker (whole screen or one window), sharing and stopping
//   - the other person sees the screen in a corner, can fill the window with it and hide it
//   - either person can share, and their voices still play
//   - a friend on an older AURA can still call and be called; the button says why it's off
// Set AURA_OLD_DIST to a build of the older AURA to include that last part.
// Added by aura-screen-share-setup.cjs.
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
  const live = (p) => until(() => p.evaluate(() => !!document.querySelector(".cx-bar.live")));
  const callFrom = async (from, to, toName) => {
    await from.locator(`button.cx-call[title="Call ${toName}"]`).first().click({ timeout: 10000 });
    await until(() => to.evaluate(() => !!document.querySelector(".cx-bar.ringing.in")));
    await to.locator(".cx-btn.yes").click({ timeout: 5000 });
    return (await live(from)) && (await live(to));
  };
  const hangUp = async (p) => { await p.locator(".cx-round.end").click({ timeout: 5000 }).catch(() => {}); await sleep(1500); };
  // How much of their voice and picture is arriving
  const incoming = (p) => p.evaluate(async () => {
    const pc = window.__pcs.filter((x) => x.connectionState !== "closed").pop();
    if (!pc) return null;
    const out = { audio: 0, video: 0, frames: 0, width: 0, mlines: (pc.remoteDescription?.sdp || "").match(/^m=\w+/gm) || [] };
    (await pc.getStats()).forEach((r) => {
      if (r.type !== "inbound-rtp") return;
      if (r.kind === "audio") out.audio = r.bytesReceived || 0;
      if (r.kind === "video") { out.video = r.bytesReceived || 0; out.frames = r.framesDecoded || 0; out.width = r.frameWidth || 0; }
    });
    return out;
  });
  const screenShown = (p) => p.evaluate(() => { const v = document.querySelector(".cx-screen video"); return v ? { w: v.videoWidth, h: v.videoHeight, t: v.currentTime, full: !!document.querySelector(".cx-screen.full"), box: Math.round(v.getBoundingClientRect().width) } : null; });

  try {
    const world = makeWorld();
    const A = await person(browser, world, now.base, "user-A", "Alex");
    const B = await person(browser, world, now.base, "user-B", "Bri");
    await sleep(5000);
    world.friendsChanged();
    // The friends panel lists the other person, with a Call button
    await until(() => A.evaluate(() => !!document.querySelector('button.cx-call[title="Call Bri"]')));

    console.log("1. A call, with screen share ready");
    check("Alex calls Bri, Bri accepts, and they're connected", await callFrom(A, B, "Bri"));
    const shareA = A.locator(".cx-round.share"), shareB = B.locator(".cx-round.share");
    check("both see a Share Screen button, and it's ready to use", await until(async () => (await shareA.isEnabled()) && (await shareB.isEnabled())));
    let a = await incoming(A), b = await incoming(B);
    check("the call now has a lane for a picture both ways", a.mlines.includes("m=video") && b.mlines.includes("m=video"), { a: a.mlines, b: b.mlines });
    await sleep(1200);
    const a1 = await incoming(A), b1 = await incoming(B);
    check("their voices still arrive both ways", a1.audio > a.audio && b1.audio > b.audio, { a: [a.audio, a1.audio], b: [b.audio, b1.audio] });
    check("nothing is sent as a picture until someone shares", a1.video === 0 && b1.video === 0, { a: a1.video, b: b1.video });
    check("every call message fits what Supabase accepts", world.biggest > 0 && world.biggest <= 20000, world.biggest);

    console.log("2. Alex shares the screen");
    await shareA.click();
    const tiles = A.locator(".cx-picker .cx-src");
    await tiles.first().waitFor({ timeout: 5000 });
    const names = await tiles.allInnerTexts();
    check("the picker lists the whole screen first, then windows", names.length === 2 && /whole screen/i.test(names[0]) && /Notepad/.test(names[1]), names);
    check("and says only the picture is shared", /Only the picture is shared/.test(await A.locator(".cx-picker").innerText()));
    if (process.env.AURA_SHOT_DIR) await A.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "picker.png") });
    await tiles.first().click();
    check("the screen Alex picked is the one captured", await until(() => A.evaluate(() => window.__chosen.includes("screen:0:0"))));
    check("Alex's call bar says the screen is being shared", await until(async () => /Sharing your screen/.test(await bar(A).innerText())));
    let seen = await until(async () => { const s = await screenShown(B); return s && s.w > 0 && s; });
    check("Bri sees Alex's screen in a corner", !!seen && !seen.full && seen.box > 300 && seen.box <= 480, seen);
    check("it's labelled as Alex's screen", /Alex's screen/.test(await B.locator(".cx-screen").innerText().catch(() => "")));
    if (process.env.AURA_SHOT_DIR) { await sleep(800); await B.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "viewer.png") }); }
    const t0 = seen?.t || 0;
    await sleep(1500);
    const moving = await screenShown(B);
    check("and it's moving, not a still picture", !!moving && moving.t > t0, { t0, now: moving?.t });
    b = await incoming(B);
    check("the picture arrives at a good size", b.width >= 320 && b.frames > 10, b);
    await B.locator('.cx-screen button[aria-label="Full screen"]').click();
    await sleep(500);
    seen = await screenShown(B);
    const fsEl = await B.evaluate(() => document.fullscreenElement?.className || "");
    check("Bri can make it full screen: the whole monitor, not just AURA's window", !!seen && seen.full && seen.box >= 1300 && /cx-screen/.test(fsEl), { seen, fsEl });
    check("full screen says how to get out", /Press Esc to exit full screen/.test(await B.locator(".cx-screen").innerText()));
    await B.mouse.move(600, 400); await sleep(2900);
    check("the top strip fades away when the mouse is still", await B.evaluate(() => !!document.querySelector(".cx-screen.full.idle")));
    await B.mouse.move(620, 420); await sleep(200);
    check("and comes back when the mouse moves", await B.evaluate(() => !document.querySelector(".cx-screen.idle")));
    await B.keyboard.press("Escape");
    await sleep(500);
    check("Esc puts it back in the corner and leaves full screen", !(await screenShown(B))?.full && !(await B.evaluate(() => document.fullscreenElement)));
    await B.locator(".cx-screen video").dblclick();
    await sleep(500);
    check("double-clicking the picture goes full screen too", !!(await screenShown(B))?.full && !!(await B.evaluate(() => document.fullscreenElement)));
    await B.mouse.move(640, 300); await sleep(100);
    await B.locator('.cx-screen button[aria-label="Exit full screen"]').click({ timeout: 3000 }).catch(() => {});
    await sleep(500);
    check("and the button brings it back", !(await screenShown(B))?.full && !(await B.evaluate(() => document.fullscreenElement)));
    await B.locator('.cx-screen button[aria-label="Hide Alex\'s screen"]').click();
    await sleep(300);
    check("Bri can hide it, and a small button brings it back", (await screenShown(B)) === null && (await B.locator(".cx-screen-pill").isVisible()));
    await B.locator(".cx-screen-pill").click();
    await sleep(400);
    check("(back again)", !!(await screenShown(B)));

    console.log("3. Stopping, and sharing the other way");
    await A.locator('.cx-round.share.on').click();
    check("Alex stops sharing: Bri's view goes away", await until(async () => !(await B.locator(".cx-screen, .cx-screen-pill").count())));
    check("and Alex's screen isn't being captured any more", await until(() => A.evaluate(() => !document.querySelector(".cx-round.share.on") && window.__screens.length === 1 && window.__screens.every((s) => s.getTracks().every((t) => t.readyState === "ended")))));
    await shareB.click();
    await B.locator(".cx-picker .cx-src").nth(1).click({ timeout: 5000 });
    seen = await until(async () => { const s = await screenShown(A); return s && s.w > 0 && s; });
    check("Bri can share a window back, and Alex sees it", !!seen && /Bri's screen/.test(await A.locator(".cx-screen").innerText()), seen);
    check("the window Bri picked is the one captured", await B.evaluate(() => window.__chosen.includes("window:22:0")));
    await B.locator(".cx-round.share.on").click({ timeout: 5000 });
    await shareA.click();
    await A.locator(".cx-picker .cx-src").first().click({ timeout: 5000 });
    check("Alex can share again after stopping", !!(await until(async () => { const s = await screenShown(B); return s && s.w > 0; })));
    const signalsBefore = world.sent["user-A"] || 0;
    await A.locator('.cx-round.share.on').click();
    await shareA.click();
    await A.locator(".cx-picker .cx-src").nth(1).click({ timeout: 5000 });
    await until(async () => { const s = await screenShown(B); return s && s.w > 0; });
    check("starting and stopping doesn't reconnect the call", (world.sent["user-A"] || 0) === signalsBefore, { before: signalsBefore, after: world.sent["user-A"] });

    console.log("4. Hanging up while sharing");
    await hangUp(B);
    check("the call ends for both", await until(() => A.evaluate(() => !document.querySelector(".cx-bar.live"))) && !(await B.locator(".cx-bar.live").count()));
    check("Bri's view of the screen goes away", !(await B.locator(".cx-screen, .cx-screen-pill").count()));
    check("Alex's screen capture is switched off", await A.evaluate(() => window.__screens.length >= 3 && window.__screens.every((s) => s.getTracks().every((t) => t.readyState === "ended"))), await A.evaluate(() => window.__screens.map((s) => s.getTracks().map((t) => t.readyState))));

    if (old) {
      console.log("5. A friend still on the older AURA");
      const world2 = makeWorld();
      const N = await person(browser, world2, now.base, "user-N", "Nia");
      const O = await person(browser, world2, old.base, "user-O", "Omar");
      await sleep(5000);
      world2.friendsChanged();
      await until(() => N.evaluate(() => !!document.querySelector('button.cx-call[title="Call Omar"]')));
      check("calling them works", await callFrom(N, O, "Omar"));
      await sleep(3000);
      let n = await incoming(N), o = await incoming(O);
      await sleep(1200);
      let n2 = await incoming(N), o2 = await incoming(O);
      check("both hear each other", n2.audio > n.audio && o2.audio > o.audio, { n: [n.audio, n2.audio], o: [o.audio, o2.audio] });
      check("the call stays sound only, as the older AURA expects", !o2.mlines.includes("m=video") && !n2.mlines.includes("m=video"), { n: n2.mlines, o: o2.mlines });
      const btn = N.locator(".cx-round.share");
      check("the Share Screen button is off, and says why", (await btn.isDisabled()) && /latest AURA/.test(await btn.getAttribute("title")), await btn.getAttribute("title"));
      await hangUp(N);
      check("being called by them works too", await callFrom(O, N, "Nia"));
      await sleep(2500);
      n = await incoming(N); o = await incoming(O);
      await sleep(1200);
      n2 = await incoming(N); o2 = await incoming(O);
      check("both hear each other", n2.audio > n.audio && o2.audio > o.audio, { n: [n.audio, n2.audio], o: [o.audio, o2.audio] });
      check("and screen share is off there too", await N.locator(".cx-round.share").isDisabled());
      await hangUp(O);
      check("nothing crashed on either side", N.isClosed() || world2.people["user-N"].thrown.filter((m) => !/reading 'live'/.test(m)).length === 0, world2.people["user-N"].thrown);
    } else note("no older AURA build given (AURA_OLD_DIST), so calls with an older AURA weren't checked here");

    check("nothing crashed along the way", [A, B].every((p) => true) && ["user-A", "user-B"].every((id) => world.people[id].thrown.filter((m) => !/reading 'live'/.test(m)).length === 0), ["user-A", "user-B"].map((id) => world.people[id].thrown));
  } finally {
    await browser.close();
    now.server.close();
    if (old) old.server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The screen share check itself broke:", e); process.exit(2); });
