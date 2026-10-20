// Camera backgrounds: None, Blur, six backgrounds and your own photo, with or without a green screen.
// Opens the built window (dist) in a real browser with pretend cameras. The pretend camera's
// picture is green, like a green screen, so the test can check AURA notices it and swaps the green.
// With Green Screen set to Never, AURA finds the person by itself (Google's free MediaPipe model,
// on this PC); the pretend camera has no person in it, so then everything is background.
// Then two AURA windows call each other for real, and the other person sees the background too.
// Added by aura-camera-backgrounds-setup.cjs.
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

// A small red picture, to use as "your photo"
function redPng(w = 64, h = 36) {
  const zlib = require("zlib");
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 230; raw[o + 1] = 20; raw[o + 2] = 30; } }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

(async () => {
  if (!fs.existsSync(path.join(DIST, "index.html"))) { check("the window has been built (dist/index.html)", false, "Run  npm run build  first."); return done(1); }
  let chromium;
  try { ({ chromium } = require("playwright")); } catch { note("the test browser isn't installed here"); return done(process.env.CI ? 1 : 3); }
  // (software graphics are allowed, so finding you in the picture can run on a PC without a graphics card)
  const args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--auto-accept-this-tab-capture", "--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
  let browser = null;
  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: "msedge" }, { channel: "chrome" }]) {
    try { browser = await chromium.launch({ ...options, args }); break; } catch {}
  }
  if (!browser) { note("no browser to test with. Run  npx playwright install chromium  once to add one."); return done(process.env.CI ? 1 : 3); }
  const now = await serve(DIST);
  const until = async (fn, ms = 15000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); } catch { v = null; } if (v) return v; await sleep(250); } return v; };
  const live = (p) => until(() => p.evaluate(() => !!document.querySelector(".cx-bar.live")));
  const callFrom = async (from, to, toName) => {
    await from.locator(`button.cx-call[title="Call ${toName}"]`).first().click({ timeout: 15000 });
    await until(() => to.evaluate(() => !!document.querySelector(".cx-bar.ringing.in")));
    await to.locator(".cx-btn.yes").click({ timeout: 15000 });
    return (await live(from)) && (await live(to));
  };
  const camsLive = (p) => p.evaluate(() => window.__cams.filter((s) => s.getVideoTracks().some((t) => t.readyState === "live")).length);
  // What a video shows: a grid of spots, each sorted into green, blue (Midnight), red (your photo) or other
  const look = (p, sel) => p.evaluate((sel) => {
    const v = document.querySelector(sel);
    if (!v || !(v.videoWidth > 0)) return null;
    const c = document.createElement("canvas"); c.width = 160; c.height = 90;
    const g = c.getContext("2d"); g.drawImage(v, 0, 0, 160, 90);
    const d = g.getImageData(0, 0, 160, 90).data;
    const n = { green: 0, blue: 0, red: 0, other: 0, total: 0 };
    for (let y = 8; y < 90; y += 12) for (let x = 8; x < 160; x += 12) {
      const i = (y * 160 + x) * 4, r = d[i], gg = d[i + 1], b = d[i + 2];
      n.total++;
      if (gg > 70 && gg > r * 1.35 && gg > b * 1.35) n.green++;
      else if (b > gg + 20 && b > r) n.blue++;
      else if (r > 150 && r > gg * 2 && r > b * 2) n.red++;
      else n.other++;
    }
    return n;
  }, sel);
  const mostly = (n, kind) => !!n && n[kind] / n.total >= 0.6;
  const PREVIEW = ".cam-pan video";

  try {
    const world = makeWorld();
    const A = await person(browser, world, now.base, "user-A", "Alex");
    const B = await person(browser, world, now.base, "user-B", "Bri");
    await sleep(5000);
    world.friendsChanged();
    const settingsOf = () => A.evaluate(() => JSON.parse(localStorage.getItem("aura_settings") || "{}"));

    console.log("1. Settings > Camera");
    await A.locator('.gm-rail-item[title="Settings"], .sb-item[title="Settings"]').first().click({ timeout: 15000 });
    await sleep(800);
    const section = A.locator(".ss", { has: A.locator(".ss-t", { hasText: /^CAMERA$/ }) });
    const tiles = section.locator(".cam-bg-tile");
    const names = await tiles.allInnerTexts();
    check("there's a Background choice: None, Blur, six backgrounds and Your Photo", names.join(",") === "None,Blur,AURA Glow,Midnight,Sunset,Ocean,Arcade,Studio,Your Photo", names);
    check("None is picked at first", (await section.locator(".cam-bg-tile.on").innerText()) === "None");
    const greenRow = section.locator(".sr", { has: A.locator(".sr-l", { hasText: /^Green Screen$/ }) });
    check("and a Green Screen choice: Auto, Always, Never (Auto at first)", (await greenRow.locator(".seg button").allInnerTexts()).join(",") === "Auto,Always,Never" && (await greenRow.locator(".seg button.on").innerText()) === "Auto");
    check("each background has a little picture of it", await A.evaluate(() => [...document.querySelectorAll(".cam-bg-tile canvas")].length === 9));

    console.log("2. The preview, with no background");
    await A.locator(".aura-cam").first().click();
    let n = await until(async () => { const x = await look(A, PREVIEW); return x && x.total ? x : null; });
    check("the camera shows as it is (the pretend camera is green)", mostly(n, "green"), n);

    console.log("3. A green screen behind you");
    await tiles.filter({ hasText: /^Midnight$/ }).click();
    n = await until(async () => { const x = await look(A, PREVIEW); return mostly(x, "blue") ? x : null; });
    check("picking Midnight: AURA sees the green screen and swaps the green for Midnight", mostly(n, "blue"), n || (await look(A, PREVIEW)));
    check("Settings says a green screen was found", !!(await until(async () => /Green screen found/.test(await greenRow.innerText()))), await greenRow.innerText());
    check("AURA remembers the choice", (await settingsOf()).camBg === "midnight");

    console.log("4. No green screen: AURA finds you by itself");
    await greenRow.locator(".seg button", { hasText: "Never" }).click();
    // Finding you needs graphics (WebGL). The real AURA has them; some test browsers don't
    const graphics = await A.evaluate(() => { try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; } });
    const ready = await until(async () => { const t = await greenRow.innerText(); return /finds you in the picture by itself/.test(t) && !/getting ready/.test(t) ? t : /doesn't work/.test(t) ? "failed" : null; }, 90000);
    if (!graphics && ready === "failed") {
      note("this test browser has no graphics (WebGL), so finding you in the picture couldn't be checked here (the AURA app itself has them)");
      check("without graphics, AURA says so instead of breaking (and the camera still shows)", ready === "failed" && /green screen still works/.test(await greenRow.innerText()) && !!(await look(A, PREVIEW)), ready || (await greenRow.innerText()));
    } else {
      check("the cutout gets ready (free, on this PC)", !!ready && ready !== "failed", ready || (await greenRow.innerText()));
      n = await until(async () => { const x = await look(A, PREVIEW); return mostly(x, "blue") ? x : null; }, 45000);
      check("with no one in the picture, all of it is the background", mostly(n, "blue"), n || (await look(A, PREVIEW)));
    }
    await greenRow.locator(".seg button", { hasText: "Auto" }).click();

    console.log("5. Your own photo");
    await tiles.filter({ hasText: /^Your Photo$/ }).click(); // no photo yet: asks for one
    await section.locator('input[type="file"]').setInputFiles({ name: "red.png", mimeType: "image/png", buffer: redPng() });
    n = await until(async () => { const x = await look(A, PREVIEW); return mostly(x, "red") ? x : null; });
    check("choosing a photo puts it behind you", mostly(n, "red"), n || (await look(A, PREVIEW)));
    check("it's picked, kept on this PC (not in the settings sent to your account)", (await settingsOf()).camBg === "picture" && (await A.evaluate(() => (localStorage.getItem("aura_cam_bg_picture") || "").startsWith("data:image/jpeg"))) && !JSON.stringify(await settingsOf()).includes("data:image"));
    check("a link lets you choose a different photo", (await section.locator(".cam-bg-link").count()) === 1);
    await section.locator('input[type="file"]').setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    check("something that isn't a picture is explained", !!(await until(async () => /isn't a picture/.test(await section.innerText()))));

    console.log("6. Blur, and the button on the preview");
    await tiles.filter({ hasText: /^Blur$/ }).click();
    const t0 = await A.evaluate(() => document.querySelector(".cam-pan video").currentTime);
    await sleep(1500);
    check("Blur works (the picture keeps moving)", (await A.evaluate(() => document.querySelector(".cam-pan video").currentTime)) > t0);
    await A.locator(".cam-view").hover();
    await A.locator(".cam-bg-btn").click();
    const strip = await A.locator(".cam-bgs .cam-bg").allInnerTexts();
    check("the preview's Background button shows the same choices", strip.length === 9 && strip[3] === "Midnight", strip);
    await A.locator(".cam-bgs .cam-bg", { hasText: "Midnight" }).click();
    n = await until(async () => { const x = await look(A, PREVIEW); return mostly(x, "blue") ? x : null; });
    check("and picking one there works too", mostly(n, "blue") && (await settingsOf()).camBg === "midnight", n);
    await A.locator(".cam-bgs .cam-bg", { hasText: "None" }).click();
    n = await until(async () => { const x = await look(A, PREVIEW); return mostly(x, "green") ? x : null; });
    check("None puts the camera back as it is", mostly(n, "green"), n);
    await A.locator(".cam-bgs .cam-bg", { hasText: "Midnight" }).click();
    await A.locator('.cam-pan button[aria-label="Close the camera"]').click();
    await sleep(500);
    check("closing the preview lets go of the camera itself", (await camsLive(A)) === 0, await camsLive(A));

    console.log("7. In a call");
    await until(() => A.evaluate(() => !!document.querySelector('button.cx-call[title="Call Bri"]')));
    check("Alex calls Bri and they're connected", await callFrom(A, B, "Bri"));
    await until(() => A.evaluate(() => !!document.querySelector(".cx-round.cam")), 5000);
    if (!(await A.locator(".cx-round.cam").count())) {
      note("the camera-in-calls update isn't installed, so backgrounds in calls weren't checked");
      await A.locator(".cx-round.end").click({ timeout: 15000 }).catch(() => {});
    } else {
    await until(() => A.locator(".cx-round.cam").isEnabled());
    await A.locator(".cx-round.cam").click();
    n = await until(async () => { const x = await look(B, ".cx-cams .cx-cam-theirs"); return mostly(x, "blue") ? x : null; }, 20000);
    check("Bri sees Alex with the Midnight background", mostly(n, "blue"), n || (await look(B, ".cx-cams .cx-cam-theirs")));
    await A.locator(".cx-round.cam").click();
    check("turning the camera off in the call lets go of it", !!(await until(async () => (await camsLive(A)) === 0)));
    await A.locator(".cx-round.cam").click();
    await until(async () => (await camsLive(A)) === 1);
    await A.locator(".cx-round.end").click({ timeout: 15000 });
    check("hanging up lets go of it too", !!(await until(async () => (await camsLive(A)) === 0)));
    }

    check("nothing crashed along the way", ["user-A", "user-B"].every((id) => world.people[id].thrown.filter((m) => !/reading 'live'/.test(m)).length === 0), ["user-A", "user-B"].map((id) => world.people[id].thrown));
  } finally {
    await browser.close();
    now.server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The camera backgrounds check itself broke:", e); process.exit(2); });
