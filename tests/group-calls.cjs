// Calls with 3 people. Three AURA windows (three people) in a real browser: each pair of PCs connects
// directly, and a pretend Supabase in this test passes the ringing and connection details between
// them, following the rules in supabase/aura-calls-group.sql. Checks:
//   - adding a friend from the call box: the list, ringing, "Calling…", accepting
//   - all three hear each other (three connections, sound both ways on each)
//   - the call box and the call screen show everyone; a full call can't take a fourth
//   - cameras and screen share reach both other people
//   - one person leaving leaves the other two talking; someone can be added back
//   - declining an invite, and a friend on an older AURA
// Added by aura-group-calls-setup.cjs.
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
    await until(() => A.evaluate(() => !!document.querySelector('button.cx-call[title="Call Bri"]')));

    console.log("1. Adding a friend to a call");
    check("Alex calls Bri, Bri accepts, and they're connected", await callFrom(A, B, "Bri"));
    const addA = A.locator(".cx-bar .cx-round.add");
    check("the call box has an Add button", await addA.isVisible() && /Add someone/.test(await addA.getAttribute("title")));
    await addA.click();
    await A.locator(".cx-adder .cx-add-row").first().waitFor({ timeout: 10000 });
    const listed = await A.locator(".cx-adder .cx-add-row").allInnerTexts();
    check("it lists friends who aren't in the call", listed.length === 1 && /Cam/.test(listed[0]) && !listed.some((t) => /Bri/.test(t)), listed);
    check("and says how many people a call can have", /up to 3 people/.test(await A.locator(".cx-adder").innerText()));
    if (process.env.AURA_SHOT_DIR) await A.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "group-add.png") });
    await A.locator(".cx-adder .cx-add-row").first().click();
    check("Cam's AURA rings, as a group call", await until(async () => /Incoming group call/.test(await C.locator(".cx-bar.ringing.in").innerText().catch(() => ""))));
    check("Alex's call box says Cam is being called", await until(async () => /Calling Cam/.test(await bar(A).innerText())));
    check("...and the Add box offers to stop", /Calling Cam/.test(await A.locator(".cx-adder").innerText().catch(() => "")) && await A.locator(".cx-adder .cx-btn.no").isVisible());
    await A.keyboard.press("Escape");
    check("Alex and Bri carry on talking meanwhile", Array.isArray(await allHear(A, 1)));
    await C.locator(".cx-btn.yes").click({ timeout: 15000 });

    console.log("2. Three people, all hearing each other");
    check("Alex's call box shows Bri and Cam", await until(async () => /Bri/.test(await barName(A)) && /Cam/.test(await barName(A)), 20000), await barName(A));
    check("Bri's shows Alex and Cam (Bri was never rung: Cam's AURA connected to it)", await until(async () => /Alex/.test(await barName(B)) && /Cam/.test(await barName(B)), 20000), await barName(B));
    check("Cam's shows Alex and Bri", await until(async () => /Alex/.test(await barName(C)) && /Bri/.test(await barName(C)), 20000), await barName(C));
    check("Bri and Cam are connected directly", !!world.between("user-B", "user-C") && world.between("user-B", "user-C").status === "active");
    await sleep(1500);
    const hearA = await allHear(A, 2), hearB = await allHear(B, 2), hearC = await allHear(C, 2);
    check("Alex hears both of them", Array.isArray(hearA), hearA);
    check("Bri hears both of them", Array.isArray(hearB), hearB);
    check("Cam hears both of them", Array.isArray(hearC), hearC);
    check("each call box has a picture for both other people", (await A.locator(".cx-bar .cx-faces .cx-face").count()) === 2 && (await C.locator(".cx-bar .cx-faces .cx-face").count()) === 2);
    await openAdder(A);
    const fullText = await A.locator(".cx-adder").innerText().catch(() => "");
    check("a full call can't take a fourth person", /call is full/.test(fullText), fullText);
    await A.keyboard.press("Escape");
    check("every call message fits what Supabase accepts", world.biggest > 0 && world.biggest <= 20000, world.biggest);

    console.log("3. Muting, the call screen, cameras and screen share");
    await C.locator(".cx-bar .cx-round.mic").click();
    await A.locator(".cx-bar .cx-round.stage").click();
    await A.locator(".cx-stage").waitFor({ timeout: 10000 });
    check("Alex's call screen has a tile for each of the three", await until(async () => (await A.locator(".cx-stage .cx-tile").count()) === 3));
    const tileNames = await A.locator(".cx-stage .cx-tile-name").allInnerTexts();
    check("...named Bri, Cam and You", tileNames.some((t) => /Bri/.test(t)) && tileNames.some((t) => /Cam/.test(t)) && tileNames.some((t) => /You/.test(t)), tileNames);
    check("Cam's tile shows Cam is muted", await until(() => A.locator(".cx-stage .cx-tile", { hasText: "Cam" }).locator(".cx-tile-muted").count()));
    check("the call screen has the Add button too", await A.locator(".cx-stage .cx-round.add").isVisible());
    if (process.env.AURA_SHOT_DIR) await A.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "group-stage.png") });
    await A.keyboard.press("Escape");
    await until(async () => !(await A.locator(".cx-stage").count()));
    await C.locator(".cx-bar .cx-round.mic").click();
    const camC = C.locator(".cx-bar .cx-round.cam");
    check("Cam can turn the camera on", await until(() => camC.isEnabled()) && (await camC.click().then(() => true)));
    const camMoving = async (p) => until(() => p.evaluate(async () => { const v = document.querySelector(".cx-cams .cx-cam-theirs"); if (!v || !v.videoWidth) return false; const t = v.currentTime; await new Promise((r) => setTimeout(r, 600)); return v.currentTime > t; }), 20000);
    check("Alex sees Cam's camera", await camMoving(A) && /Cam/.test(await A.locator(".cx-cams").innerText()));
    check("Bri sees it too", await camMoving(B) && /Cam/.test(await B.locator(".cx-cams").innerText()));
    await B.locator(".cx-bar .cx-round.cam").click();
    check("with Bri's camera on as well, Alex sees both, side by side", await until(async () => (await A.locator(".cx-cams.duo .cx-cam-theirs").count()) === 2, 20000));
    if (process.env.AURA_SHOT_DIR) { await sleep(1000); await A.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "group-cams.png") }); }
    await C.locator(".cx-bar .cx-round.cam").click(); await B.locator(".cx-bar .cx-round.cam").click();
    await B.locator(".cx-bar .cx-round.share").click();
    await B.locator(".cx-picker .cx-src").first().click({ timeout: 15000 });
    const screenOn = (p) => until(() => p.evaluate(() => { const v = document.querySelector(".cx-screen video"); return !!v && v.videoWidth > 0; }), 20000);
    check("Bri shares the screen: Alex sees it", await screenOn(A) && /Bri's screen/.test(await A.locator(".cx-screen").innerText()));
    check("...and so does Cam", await screenOn(C) && /Bri's screen/.test(await C.locator(".cx-screen").innerText()));
    await B.locator(".cx-bar .cx-round.share.on").click();
    check("stopping takes it away for both", await until(async () => !(await A.locator(".cx-screen").count()) && !(await C.locator(".cx-screen").count())));

    console.log("4. Leaving and coming back");
    await hangUp(A);
    check("Alex leaves: Alex's call ends", await until(async () => !(await A.locator(".cx-bar.live").count())));
    check("Bri and Cam carry on, just the two of them", await until(async () => (await barName(B)) === "Cam" && (await barName(C)) === "Bri"), [await barName(B), await barName(C)]);
    check("...still hearing each other", Array.isArray(await allHear(B, 1)) && Array.isArray(await allHear(C, 1)));
    await sleep(1000);
    await addFrom(B, "Alex");
    check("Bri adds Alex back: Alex's AURA rings", await until(async () => /Incoming group call/.test(await A.locator(".cx-bar.ringing.in").innerText().catch(() => ""))));
    await A.locator(".cx-btn.yes").click({ timeout: 15000 });
    check("all three are back together", await until(async () => /Bri/.test(await barName(A)) && /Cam/.test(await barName(A)) && /Alex/.test(await barName(C)), 20000), [await barName(A), await barName(C)]);
    await sleep(1500);
    check("...and Cam hears both again", Array.isArray(await allHear(C, 2)));

    console.log("5. When the person added says no");
    for (const p of [A, B, C]) await hangUp(p);
    await sleep(1000);
    check("a fresh call: Alex and Bri", await callFrom(A, B, "Bri"));
    await addFrom(A, "Cam");
    await until(() => C.evaluate(() => !!document.querySelector(".cx-bar.ringing.in")));
    await C.locator(".cx-btn.no").click({ timeout: 15000 });
    check("Cam declines: Alex's call box goes back to just Bri", await until(async () => (await barName(A)) === "Bri" && !/Calling/.test(await bar(A).innerText())));
    check("...and the call with Bri carries on", Array.isArray(await allHear(A, 1)));
    await addFrom(A, "Cam");
    await until(() => C.evaluate(() => !!document.querySelector(".cx-bar.ringing.in")));
    await A.locator(".cx-adder .cx-btn.no").click({ timeout: 10000 });
    check("Alex can stop ringing Cam", await until(async () => !(await C.locator(".cx-bar").count()) || /Missed/.test(await C.locator(".cx-bar").innerText().catch(() => ""))));
    await A.keyboard.press("Escape");
    world.noGroups = true;
    await addFrom(A, "Cam");
    check("on a database without the update, adding says what to run", await until(async () => /aura-calls-group\.sql/.test(await A.locator("body").innerText())));
    world.noGroups = false;
    for (const p of [A, B, C]) await hangUp(p);

    if (old) {
      console.log("6. A friend on an older AURA");
      const O = await person(browser, world, old.base, "user-O", "Oli");
      await sleep(4000);
      world.friendsChanged();
      await sleep(1500);
      check("a fresh call: Alex and Bri", await callFrom(A, B, "Bri"));
      await addFrom(A, "Oli");
      await until(() => O.evaluate(() => !!document.querySelector(".cx-bar.ringing.in")));
      await O.locator(".cx-btn.yes").click({ timeout: 15000 });
      check("Alex is told only Alex can hear them", await until(async () => /older AURA/.test(await A.locator("body").innerText()), 20000));
      check("Alex still hears both", Array.isArray(await until(async () => { const h = await allHear(A, 2); return Array.isArray(h) ? h : null; }, 20000)));
      for (const p of [A, B, O]) await hangUp(p);
    } else note("no older AURA build given (AURA_OLD_DIST), so adding a friend on an older AURA wasn't checked here");

    check("nothing crashed along the way", thrown(["user-A", "user-B", "user-C"], world).length === 0, thrown(["user-A", "user-B", "user-C"], world));
  } finally {
    await browser.close();
    now.server.close();
    if (old) old.server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The group call check itself broke:", e); process.exit(2); });
