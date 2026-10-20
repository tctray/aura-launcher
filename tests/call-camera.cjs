// Cameras in voice calls. Two AURA windows (two people) call each other for real, in a real
// browser, with pretend cameras: the call goes PC to PC, and a pretend Supabase in this test passes
// the ringing and connection details between them. Checks:
//   - the camera button in the call box: on, off, either person, both at once
//   - the other person sees your camera under the call box (yours shows small in the corner)
//   - camera and screen share at the same time, each in its own place
//   - turning it off or hanging up lets go of the camera; problems are explained
//   - a friend on an older AURA can still call and be called; the button says why it's off
// Set AURA_OLD_DIST to a build of the older AURA to include that last part.
// Added by aura-call-camera-setup.cjs.
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
  const old = OLD && fs.existsSync(path.join(OLD, "index.html")) ? await serve(OLD) : null;

  const until = async (fn, ms = 15000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); } catch { v = null; } if (v) return v; await sleep(200); } return v; };
  const bar = (p) => p.locator(".cx-bar");
  const live = (p) => until(() => p.evaluate(() => !!document.querySelector(".cx-bar.live")));
  const callFrom = async (from, to, toName) => {
    await from.locator(`button.cx-call[title="Call ${toName}"]`).first().click({ timeout: 10000 });
    await until(() => to.evaluate(() => !!document.querySelector(".cx-bar.ringing.in")));
    await to.locator(".cx-btn.yes").click({ timeout: 15000 });
    return (await live(from)) && (await live(to));
  };
  const hangUp = async (p) => { await p.locator(".cx-round.end").click({ timeout: 15000 }).catch(() => {}); await sleep(1500); };
  const mlines = (p) => p.evaluate(() => { const pc = window.__pcs.filter((x) => x.connectionState !== "closed").pop(); return pc ? (pc.remoteDescription?.sdp || "").match(/^m=\w+/gm) || [] : []; });
  const audioIn = (p) => p.evaluate(async () => { const pc = window.__pcs.filter((x) => x.connectionState !== "closed").pop(); let a = 0; if (pc) (await pc.getStats()).forEach((r) => { if (r.type === "inbound-rtp" && r.kind === "audio") a = r.bytesReceived || 0; }); return a; });
  // What the call box shows: their camera, yours, and the names on them
  const cams = (p) => p.evaluate(() => {
    const v = (sel) => { const e = document.querySelector(sel); return e ? { w: e.videoWidth, t: e.currentTime, box: Math.round(e.getBoundingClientRect().width), track: e.srcObject?.getVideoTracks()[0]?.id || "", mirror: getComputedStyle(e).transform } : null; };
    const panel = document.querySelector(".cx-cams");
    return { theirs: v(".cx-cams .cx-cam-theirs"), mine: v(".cx-cams .cx-cam-mine"), small: !!document.querySelector(".cx-cams .cx-cam-mine.small"), name: panel?.querySelector(".cx-cam-name")?.textContent || "", panel: panel ? Math.round(panel.getBoundingClientRect().width) : 0, pill: !!document.querySelector(".cx-cams-pill") };
  });
  const camsLive = (p) => p.evaluate(() => window.__cams.filter((s) => s.getVideoTracks().some((t) => t.readyState === "live")).length);
  const camBtn = (p) => p.locator(".cx-round.cam");
  const toasts = (p) => p.evaluate(() => [...document.querySelectorAll(".toast, [class*=toast]")].map((t) => t.innerText).join(" | "));

  try {
    const world = makeWorld();
    const A = await person(browser, world, now.base, "user-A", "Alex");
    const B = await person(browser, world, now.base, "user-B", "Bri");
    await sleep(5000);
    world.friendsChanged();
    await until(() => A.evaluate(() => !!document.querySelector('button.cx-call[title="Call Bri"]')));

    console.log("1. A call, with cameras ready");
    check("Alex calls Bri, Bri accepts, and they're connected", await callFrom(A, B, "Bri"));
    check("both see a camera button in the call box, ready to use", await until(async () => (await camBtn(A).isEnabled()) && (await camBtn(B).isEnabled())));
    const ml = await mlines(B);
    check("the call has a lane for the screen and one for cameras", ml.filter((m) => m === "m=video").length === 2, ml);
    check("no camera is on until someone presses the button", (await camsLive(A)) === 0 && (await camsLive(B)) === 0 && (await A.locator(".cx-cams").count()) === 0);
    check("Share Screen still works alongside it", await A.locator(".cx-round.share").isEnabled());

    console.log("2. Alex turns the camera on");
    const signalsBefore = world.sent["user-A"] || 0;
    await camBtn(A).click();
    check("Alex's camera turns on, and the button shows it", await until(async () => (await camsLive(A)) === 1 && (await A.locator(".cx-round.cam.on").count()) === 1));
    check("Alex's call box says Camera on", await until(async () => /Camera on/.test(await bar(A).innerText())));
    let a = await until(async () => { const c = await cams(A); return c.mine && c.mine.w > 0 && c; });
    check("Alex sees themself under the call box, mirrored, labelled You", !!a && !a.theirs && a.name === "You" && /matrix\(-1/.test(a.mine.mirror), a);
    let b = await until(async () => { const c = await cams(B); return c.theirs && c.theirs.w > 0 && c; });
    check("Bri sees Alex's camera under the call box, labelled Alex", !!b && b.name === "Alex" && b.panel >= 300 && !b.mine, b);
    check("not mirrored for Bri (Bri sees Alex as they are)", !!b && b.theirs.mirror === "none", b && b.theirs.mirror);
    const t0 = b?.theirs.t || 0;
    await sleep(1500);
    check("and it's moving", ((await cams(B)).theirs?.t || 0) > t0);
    check("turning the camera on doesn't reconnect the call", (world.sent["user-A"] || 0) === signalsBefore, { before: signalsBefore, after: world.sent["user-A"] });

    console.log("3. Both cameras on");
    await camBtn(B).click();
    b = await until(async () => { const c = await cams(B); return c.theirs?.w > 0 && c.mine?.w > 0 && c.small && c; });
    check("Bri sees Alex big, and themself small in the corner", !!b && b.name === "Alex" && b.mine.box < b.theirs.box / 2, b);
    a = await until(async () => { const c = await cams(A); return c.theirs?.w > 0 && c.mine?.w > 0 && c.small && c; });
    check("Alex sees Bri big, and themself small in the corner", !!a && a.name === "Bri", a);
    const i0 = await audioIn(A); await sleep(1000);
    check("their voices still arrive", (await audioIn(A)) > i0);

    console.log("4. Camera and screen share together");
    await A.locator(".cx-round.share").click();
    await A.locator(".cx-picker .cx-src").first().click({ timeout: 15000 });
    const both = await until(() => B.evaluate(() => {
      const s = document.querySelector(".cx-screen video"), c = document.querySelector(".cx-cams .cx-cam-theirs");
      const id = (e) => e?.srcObject?.getVideoTracks()[0]?.id || "";
      return s && c && s.videoWidth > 0 && c.videoWidth > 0 && id(s) && id(c) && id(s) !== id(c) ? { screen: s.videoWidth, cam: c.videoWidth } : null;
    }), 30000);
    check("Bri sees Alex's screen in its corner and Alex's camera under the call box, each in its own place", !!both, both);
    await A.locator(".cx-round.share.on").click();
    await until(async () => !(await B.locator(".cx-screen").count()));
    check("stopping the screen share leaves the camera on", (await cams(B)).theirs?.w > 0 && (await camsLive(A)) === 1);

    console.log("5. Bigger, hide, show");
    const w0 = (await cams(B)).panel;
    await B.locator(".cx-cams").hover();
    await B.locator('.cx-cams button[aria-label="Make the camera bigger"]').click();
    await sleep(300);
    check("the arrows make it bigger", (await cams(B)).panel > w0 + 150, { w0, now: (await cams(B)).panel });
    await B.locator('.cx-cams button[aria-label="Make the camera smaller"]').click();
    await B.locator('.cx-cams button[aria-label="Hide the cameras"]').click();
    await sleep(300);
    check("the dash tucks it away into a small button", (await B.locator(".cx-cams").count()) === 0 && (await cams(B)).pill);
    check("(the cameras stay on while hidden)", (await camsLive(A)) === 1 && (await camsLive(B)) === 1);
    await B.locator(".cx-cams-pill").click();
    await sleep(300);
    check("and the button brings it back", (await cams(B)).theirs?.w > 0);
    if (process.env.AURA_SHOT_DIR) { await sleep(500); await B.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "cams.png") }); }

    console.log("6. Turning it off");
    await camBtn(A).click();
    check("Alex's camera turns off and is let go", await until(async () => (await camsLive(A)) === 0 && (await A.locator(".cx-round.cam.on").count()) === 0));
    b = await until(async () => { const c = await cams(B); return !c.theirs && c.mine && c; });
    check("Bri stops seeing Alex's camera (and still sees their own)", !!b && b.name === "You", b);
    a = await cams(A);
    check("Alex now sees Bri's camera only", !!a.theirs && !a.mine, a);
    await camBtn(A).click();
    check("Alex can turn it on again", !!(await until(async () => { const c = await cams(B); return c.theirs?.w > 0; })));
    await camBtn(A).click();
    await until(async () => (await camsLive(A)) === 0);

    console.log("7. When the camera can't be used");
    await A.evaluate(() => { window.__failCam = "NotReadableError"; });
    await camBtn(A).click();
    await sleep(800);
    check("a camera in use by another app is explained", /being used by another app/.test(await toasts(A)), await toasts(A));
    check("and the button can be pressed again", (await camBtn(A).isEnabled()) && (await A.locator(".cx-round.cam.on").count()) === 0);
    await A.evaluate(() => { window.__failCam = "NotAllowedError"; });
    await camBtn(A).click();
    await sleep(800);
    check("a camera blocked in Windows is explained", /Privacy & security > Camera/.test(await toasts(A)), await toasts(A));
    await A.evaluate(() => { window.__failCam = null; });
    await camBtn(A).click();
    await until(async () => (await camsLive(A)) === 1 && (await A.locator(".cx-round.cam.on").count()) === 1); // fully on (AURA is watching for it to be unplugged)
    await A.evaluate(() => { const t = window.__cams[window.__cams.length - 1].getVideoTracks()[0]; t.stop(); t.dispatchEvent(new Event("ended")); });
    await sleep(800);
    check("a camera unplugged mid-call: turned off and explained", !!(await until(async () => /camera was disconnected/.test(await toasts(A)), 5000)) && (await A.locator(".cx-round.cam.on").count()) === 0, await toasts(A));
    check("and Bri stops seeing it", await until(async () => !(await cams(B)).theirs));

    console.log("8. Hanging up with cameras on");
    await camBtn(A).click();
    await until(async () => (await cams(B)).theirs?.w > 0);
    await hangUp(B);
    check("the call ends for both", await until(() => A.evaluate(() => !document.querySelector(".cx-bar.live"))));
    check("both cameras are let go", (await camsLive(A)) === 0 && (await camsLive(B)) === 0, { a: await camsLive(A), b: await camsLive(B) });
    check("and the camera pictures go away", (await A.locator(".cx-cams, .cx-cams-pill").count()) === 0 && (await B.locator(".cx-cams, .cx-cams-pill").count()) === 0);
    check("the next call starts with cameras off", await callFrom(B, A, "Alex") && (await until(async () => camBtn(A).isEnabled())) && (await camsLive(A)) === 0 && (await A.locator(".cx-round.cam.on").count()) === 0);
    await hangUp(A);

    if (old) {
      console.log("9. A friend still on the older AURA");
      const world2 = makeWorld();
      const N = await person(browser, world2, now.base, "user-N", "Nia");
      const O = await person(browser, world2, old.base, "user-O", "Omar");
      await sleep(5000);
      world2.friendsChanged();
      await until(() => N.evaluate(() => !!document.querySelector('button.cx-call[title="Call Omar"]')));
      check("calling them works", await callFrom(N, O, "Omar"));
      check("screen share still works with them", !!(await until(() => N.locator(".cx-round.share").isEnabled())));
      const btn = camBtn(N);
      check("the camera button is off, and says why", (await btn.isDisabled()) && /latest AURA/.test(await btn.getAttribute("title")), await btn.getAttribute("title"));
      const n0 = await audioIn(N), o0 = await audioIn(O); await sleep(1200);
      check("both hear each other", (await audioIn(N)) > n0 && (await audioIn(O)) > o0);
      await N.locator(".cx-round.share").click();
      await N.locator(".cx-picker .cx-src").first().click({ timeout: 15000 });
      check("and Omar (older AURA) sees Nia's screen", !!(await until(() => O.evaluate(() => { const v = document.querySelector(".cx-screen video"); return v && v.videoWidth > 0; }))));
      await hangUp(N);
      check("being called by them works too", await callFrom(O, N, "Nia"));
      check("screen share works that way round", !!(await until(() => N.locator(".cx-round.share").isEnabled())));
      check("and the camera button is off there too", await camBtn(N).isDisabled());
      await N.locator(".cx-round.share").click();
      await N.locator(".cx-picker .cx-src").first().click({ timeout: 15000 });
      check("and Omar sees Nia's screen", !!(await until(() => O.evaluate(() => { const v = document.querySelector(".cx-screen video"); return v && v.videoWidth > 0; }))));
      await hangUp(O);
      check("nothing crashed on either side", world2.people["user-N"].thrown.filter((m) => !/reading 'live'/.test(m)).length === 0, world2.people["user-N"].thrown);
    } else note("no older AURA build given (AURA_OLD_DIST), so calls with an older AURA weren't checked here");

    check("nothing crashed along the way", ["user-A", "user-B"].every((id) => world.people[id].thrown.filter((m) => !/reading 'live'/.test(m)).length === 0), ["user-A", "user-B"].map((id) => world.people[id].thrown));
  } finally {
    await browser.close();
    now.server.close();
    if (old) old.server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The call camera check itself broke:", e); process.exit(2); });
