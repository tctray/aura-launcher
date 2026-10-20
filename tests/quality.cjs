// Picture quality: screen share in calls (Auto, Smooth, Sharp), the video codec calls use,
// your camera in calls, and Settings > Recording > Recording Quality.
// Two AURA windows call each other for real in a real browser (a pretend Supabase passes the
// connection details), and the test looks at what each asks the screen, camera and encoder for.
// Added by aura-quality-setup.cjs.
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

async function person(browser, world, base, id, name, settings) {
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 860 }, permissions: ["microphone"] })).newPage();
  const thrown = [];
  page.on("pageerror", (e) => thrown.push(String(e.message || e).split("\n")[0]));
  world.people[id] = { page, name, thrown };
  await page.exposeBinding("__social", (_src, fn, args) => { const h = world.handlers[fn]; return h ? h(id, ...(args || [])) : { success: true, data: null }; });
  await page.addInitScript(([id, name, settings]) => {
    try { localStorage.clear(); localStorage.setItem("aura_profile", JSON.stringify({ username: name, avatar: "", userId: id })); if (settings) localStorage.setItem("aura_settings", JSON.stringify(settings)); } catch {}
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
        if (key === "onQuickRecordToggle") return (cb) => { window.__f9 = cb; return () => {}; };
        if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};
        return (...args) => (desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }));
      },
    });
    // Keep hold of every screen captured, to check it's switched off afterwards
    window.__screens = [];
    const realGDM = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    window.__asked = [];
    navigator.mediaDevices.getDisplayMedia = async (...a) => { window.__asked.push(JSON.parse(JSON.stringify(a[0] || {}))); const s = await realGDM(...a); window.__screens.push(s); return s; };
    // What each camera is asked for, and what each recording is set to
    window.__camAsk = [];
    const realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c = {}) => { if (c.video) window.__camAsk.push(JSON.parse(JSON.stringify(c.video))); return realGUM(c); };
    const RealRec = window.MediaRecorder;
    window.__recs = [];
    window.MediaRecorder = class extends RealRec { constructor(stream, o) { super(stream, o); window.__recs.push({ options: o || {}, rec: this }); } };
    window.MediaRecorder.isTypeSupported = (t) => RealRec.isTypeSupported(t);
    // Keep hold of the connections, so the test can see what goes over them
    const Real = window.RTCPeerConnection;
    window.__pcs = [];
    window.RTCPeerConnection = function (...a) { const pc = new Real(...a); window.__pcs.push(pc); return pc; };
    window.RTCPeerConnection.prototype = Real.prototype;
  }, [id, name, settings || null]);
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
  // What Alex is sending as a picture: the encoder settings, the hint, and the codec in use
  const sending = (p) => p.evaluate(async () => {
    const pc = window.__pcs.filter((x) => x.connectionState !== "closed").pop();
    if (!pc) return null;
    const s = pc.getSenders().find((x) => x.track && x.track.kind === "video" && /screen|window|tab|web-contents|desktop/i.test(x.track.label + " " + (x.track.getSettings().displaySurface || "")));
    if (!s) return null;
    const e = (s.getParameters().encodings || [])[0] || {};
    let codec = "";
    const stats = await pc.getStats();
    stats.forEach((r) => { if (r.type === "outbound-rtp" && r.kind === "video" && r.codecId && (r.framesEncoded || 0) > 0) { const c = stats.get(r.codecId); if (c) codec = c.mimeType; } });
    return { bitrate: e.maxBitrate, fps: e.maxFramerate, hint: s.track.contentHint, codec };
  });
  const screenSeen = (p) => until(() => p.evaluate(() => { const v = document.querySelector(".cx-screen video"); return v && v.videoWidth > 0; }));
  const share = async (p, mode) => {
    await p.locator(".cx-round.share").click({ timeout: 15000 });
    await p.locator(".cx-picker .cx-src").first().waitFor({ timeout: 15000 });
    if (mode) await p.locator(".cx-quality .cx-q", { hasText: mode }).click();
    await p.locator(".cx-picker .cx-src").first().click({ timeout: 15000 });
    await until(async () => (await p.locator(".cx-round.share.on").count()) === 1);
  };
  const stopShare = async (p) => { await p.locator(".cx-round.share.on").click({ timeout: 15000 }); await sleep(600); };
  const lastAsk = (p) => p.evaluate(() => window.__asked[window.__asked.length - 1] || null);

  try {
    const world = makeWorld();
    const A = await person(browser, world, now.base, "user-A", "Alex", { recordSourceId: "screen:0:0", recordSourceName: "Entire screen", micVolume: 0 });
    const B = await person(browser, world, now.base, "user-B", "Bri");
    await sleep(5000);
    world.friendsChanged();
    await until(() => A.evaluate(() => !!document.querySelector('button.cx-call[title="Call Bri"]')));
    check("Alex calls Bri and they're connected", await callFrom(A, B, "Bri"));
    await until(() => A.locator(".cx-round.share").isEnabled());

    console.log("1. The quality choice in Share Screen");
    await A.locator(".cx-round.share").click({ timeout: 15000 });
    await A.locator(".cx-picker .cx-src").first().waitFor({ timeout: 15000 });
    const choices = await A.locator(".cx-quality .cx-q").allInnerTexts();
    check("the Share Screen box offers Auto, Smooth and Sharp", choices.join(",") === "Auto,Smooth,Sharp", choices);
    check("Auto is picked at first, and it says what it does", (await A.locator(".cx-q.on").innerText()) === "Auto" && /1080p at 30 fps/.test(await A.locator(".cx-q-hint").innerText()));
    await A.locator(".cx-quality .cx-q", { hasText: "Smooth" }).click();
    check("picking Smooth says it's 60 fps", (await A.locator(".cx-q.on").innerText()) === "Smooth" && /60 fps/.test(await A.locator(".cx-q-hint").innerText()));
    await A.locator(".cx-picker .cx-src").first().click({ timeout: 15000 });
    await until(async () => (await A.locator(".cx-round.share.on").count()) === 1);

    console.log("2. Smooth (games)");
    let ask = await lastAsk(A);
    check("the screen is captured at 60 fps", ask?.video?.frameRate?.ideal === 60 && ask.video.frameRate.max === 60, ask);
    check("Bri sees it", !!(await screenSeen(B)));
    let s = await until(async () => { const x = await sending(A); return x && x.codec ? x : null; }, 20000) || (await sending(A));
    check("it's sent at 60 fps with up to 12 Mbps, marked as motion", s && s.fps === 60 && s.bitrate === 12000000 && s.hint === "motion", s);
    const caps = await A.evaluate(() => RTCRtpSender.getCapabilities("video").codecs.map((c) => c.mimeType));
    const want = caps.includes("video/H264") ? "video/H264" : caps.includes("video/VP9") ? "video/VP9" : "";
    check(`it uses the better codec this PC has (${want.replace("video/", "") || "none"}), not the basic VP8`, !want || (s && s.codec === want), { codec: s && s.codec, want });
    check("AURA remembers Smooth for next time", await A.evaluate(() => JSON.parse(localStorage.getItem("aura_call_prefs") || "{}").shareMode === "smooth"));
    await stopShare(A);

    console.log("3. Sharp (text and detail)");
    await share(A, "Sharp");
    ask = await lastAsk(A);
    check("the screen is captured up to 1440p at 30 fps", ask?.video?.width?.max === 2560 && ask.video.height.max === 1440 && ask.video.frameRate.max === 30, ask);
    s = await until(async () => { const x = await sending(A); return x && x.hint === "detail" ? x : null; });
    check("it's sent with up to 12 Mbps, marked as detail", s && s.bitrate === 12000000 && s.fps === 30 && s.hint === "detail", s);
    check("Bri sees it", !!(await screenSeen(B)));
    await stopShare(A);

    console.log("4. Auto");
    await share(A, "Auto");
    ask = await lastAsk(A);
    s = await until(async () => { const x = await sending(A); return x && x.fps === 30 ? x : null; });
    check("1080p at 30 fps with up to 8 Mbps (twice what it was)", ask?.video?.width?.max === 1920 && s && s.bitrate === 8000000 && !s.hint, { ask, s });
    await stopShare(A);
    await share(A); // no choice made: the last one
    check("sharing again uses the last choice", (await lastAsk(A))?.video?.frameRate?.max === 30 && (await A.evaluate(() => JSON.parse(localStorage.getItem("aura_call_prefs")).shareMode)) === "auto");
    await stopShare(A);
    await B.locator(".cx-round.share").click({ timeout: 15000 });
    await B.locator(".cx-picker .cx-src").first().click({ timeout: 15000 });
    check("Bri can share back (Bri's own choice: Auto)", !!(await until(() => A.evaluate(() => { const v = document.querySelector(".cx-screen video"); return v && v.videoWidth > 0; }))) && (await lastAsk(B))?.video?.frameRate?.max === 30);
    await stopShare(B);

    console.log("5. Your camera in calls");
    if (await A.locator(".cx-round.cam").count()) {
      await A.locator(".cx-round.cam").click();
      const cam = await until(() => A.evaluate(() => window.__camAsk[window.__camAsk.length - 1] || null));
      check("the camera is asked for up to 1080p", cam?.width?.ideal === 1920 && cam?.height?.ideal === 1080, cam);
      check("and Bri sees it", !!(await until(() => B.evaluate(() => { const v = document.querySelector(".cx-cams .cx-cam-theirs"); return v && v.videoWidth > 0; }))));
      await A.locator(".cx-round.cam").click();
    } else note("the camera-in-calls update isn't installed, so its quality wasn't checked");
    await A.locator(".cx-round.end").click({ timeout: 15000 });
    await sleep(1500);

    console.log("6. Recording quality (Settings > Recording)");
    const f9 = async () => { await A.evaluate(() => window.__f9 && window.__f9({ game: "Test" })); await sleep(1500); };
    const rec = () => A.evaluate(() => { const r = window.__recs[window.__recs.length - 1]; return r ? { bits: r.options.videoBitsPerSecond, state: r.rec.state } : null; });
    await f9();
    let r = await rec();
    ask = await lastAsk(A);
    check("by default (High) an F9 recording is 60 fps at 16 Mbps", ask?.video?.frameRate?.ideal === 60 && r?.bits === 16000000 && r.state === "recording", { ask, r });
    check("and keeps the screen's own size (no size limit)", ask?.video && !ask.video.width && !ask.video.height, ask);
    await f9();
    await A.locator('.gm-rail-item[title="Settings"], .sb-item[title="Settings"]').first().click({ timeout: 15000 });
    await sleep(800);
    const row = A.locator(".sr", { has: A.locator(".sr-l", { hasText: /^Recording Quality$/ }) });
    check("Settings > Recording has Recording Quality, set to High", (await row.count()) === 1 && (await row.locator(".seg button.on").innerText()) === "High" && /60 fps/.test(await row.innerText()));
    await row.locator(".seg button", { hasText: "Standard" }).click();
    await f9();
    r = await rec(); ask = await lastAsk(A);
    check("Standard: 30 fps at 8 Mbps (what it used to be)", ask?.video?.frameRate?.ideal === 30 && r?.bits === 8000000, { ask, r });
    await f9();
    await row.locator(".seg button", { hasText: "Ultra" }).click();
    await f9();
    r = await rec(); ask = await lastAsk(A);
    check("Ultra: 60 fps at 30 Mbps", ask?.video?.frameRate?.ideal === 60 && r?.bits === 30000000, { ask, r });
    await f9();
    check("it says roughly how big the files get", /2\.3 GB per 10 minutes/.test(await row.innerText()));
    await A.locator('.gm-rail-item[title="Clips"], .sb-item[title="Clips"]').first().click({ timeout: 15000 });
    await sleep(800);
    await A.locator("button", { hasText: "⏺ Record" }).first().click({ timeout: 15000 });
    await A.locator("button", { hasText: "Record Full Desktop" }).click({ timeout: 15000 });
    await sleep(1500);
    r = await rec(); ask = await lastAsk(A);
    check("the Clips page's Record button uses it too", ask?.video?.frameRate?.ideal === 60 && r?.bits === 30000000, { ask, r });
    await A.locator("button", { hasText: "■ Stop" }).first().click({ timeout: 15000 }).catch(() => {});

    check("nothing crashed along the way", ["user-A", "user-B"].every((id) => world.people[id].thrown.filter((m) => !/reading 'live'/.test(m)).length === 0), ["user-A", "user-B"].map((id) => world.people[id].thrown));
  } finally {
    await browser.close();
    now.server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The picture quality check itself broke:", e); process.exit(2); });
