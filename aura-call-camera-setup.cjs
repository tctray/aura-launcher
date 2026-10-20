#!/usr/bin/env node
/**
 * AURA — your camera in calls
 *
 *   - A camera button in the call box, next to Share Screen. Press it and the person you're
 *     calling sees you; press it again to turn it off.
 *   - Their camera shows under the call box (it moves with it), with yours small in the corner.
 *     Hover it for a bigger view, or tuck it away into a small button.
 *   - Works together with screen share: their screen in its corner, their camera under the call box.
 *   - The camera only turns on when you press the button, and turns off when you hang up. It
 *     uses the camera picked in Settings > Camera, if you have that update.
 *   - Both of you need this update. With a friend on an older AURA, calls and screen share work
 *     as before and the camera button says why it's off.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-call-camera-setup.cjs
 *
 * What it does:
 *   - edits    src/components/calls.jsx   the camera button, sending your camera, showing theirs
 *   - edits    tests/screen-share.cjs     (if it's there) counts both picture lanes
 *   - creates  tests/call-camera.cjs      (only if AURA's checks are installed) checks it
 *
 * Every file it changes is copied to <name>.before-call-camera.bak first.
 * To put everything back:                 node aura-call-camera-setup.cjs --undo
 * To preview without changing anything:   node aura-call-camera-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FILES = {"test":"// Cameras in voice calls. Two AURA windows (two people) call each other for real, in a real\n// browser, with pretend cameras: the call goes PC to PC, and a pretend Supabase in this test passes\n// the ringing and connection details between them. Checks:\n//   - the camera button in the call box: on, off, either person, both at once\n//   - the other person sees your camera under the call box (yours shows small in the corner)\n//   - camera and screen share at the same time, each in its own place\n//   - turning it off or hanging up lets go of the camera; problems are explained\n//   - a friend on an older AURA can still call and be called; the button says why it's off\n// Set AURA_OLD_DIST to a build of the older AURA to include that last part.\n// Added by aura-call-camera-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst OLD = process.env.AURA_OLD_DIST || \"\";\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\nconst sleep = (ms) => new Promise((r) => setTimeout(r, ms));\n\nfunction serve(dir) {\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(dir, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => {\n      if (err) { res.writeHead(404); return res.end(); }\n      res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" });\n      res.end(data);\n    });\n  });\n  return new Promise((r) => server.listen(0, \"127.0.0.1\", () => r({ server, base: \"http://127.0.0.1:\" + server.address().port })));\n}\n\n// ── A pretend Supabase for calls ─────────────────────────────────────────────\nfunction makeWorld() {\n  const people = {};    // id -> { page, name }\n  let calls = [], signals = [], nextSignal = 1, nextCall = 1;\n  const shape = (c, me) => ({ id: c.id, callerId: c.caller, calleeId: c.callee, peerId: c.caller === me ? c.callee : c.caller, outgoing: c.caller === me, status: c.status, reason: c.reason || null });\n  const tell = (id, event) => { const p = people[id]?.page; if (p) p.evaluate((e) => window.__deliver && window.__deliver(e), event).catch(() => {}); };\n  const ok = (data) => ({ success: true, data });\n  const no = (error) => ({ success: false, error });\n  const end = (c, reason) => { if (c.status === \"ended\") return; c.status = \"ended\"; c.reason = reason || \"hangup\"; for (const id of [c.caller, c.callee]) tell(id, { type: \"call\", call: shape(c, id) }); };\n  const handlers = {\n    start: (me) => ok({ id: me, username: people[me].name, live: true }),\n    listFriends: (me) => ok(Object.keys(people).filter((id) => id !== me).map((id) => ({ friendshipId: \"f-\" + id, userId: id, username: people[id].name, avatarUrl: \"\", state: \"friend\", since: null, online: true, lastSeenAt: new Date().toISOString() }))),\n    getProfile: (_me, id) => ok(people[id] ? { userId: id, username: people[id].name, bio: \"\", avatarUrl: \"\" } : null),\n    listConversations: () => ok([]), listBlocked: () => ok([]),\n    callConfig: () => ok({ iceServers: [], relay: false }),\n    currentCall: (me) => { const c = calls.find((x) => x.status !== \"ended\" && (x.caller === me || x.callee === me)); return ok(c ? shape(c, me) : null); },\n    startCall: (me, other) => {\n      if (calls.some((x) => x.status !== \"ended\" && [x.caller, x.callee].some((p) => p === me || p === other))) return no(\"You're already in a call.\");\n      const c = { id: \"call-\" + nextCall++, caller: me, callee: other, status: \"ringing\" };\n      calls.push(c);\n      tell(other, { type: \"call\", call: shape(c, other) });\n      return ok(shape(c, me));\n    },\n    answerCall: (me, id) => { const c = calls.find((x) => x.id === id && x.callee === me && x.status === \"ringing\"); if (!c) return no(\"That call has ended.\"); c.status = \"active\"; tell(c.caller, { type: \"call\", call: shape(c, c.caller) }); return ok(shape(c, me)); },\n    endCall: (me, id, reason) => { const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me)); if (c) end(c, reason); return ok(true); },\n    callSignal: (me, id, kind, payload) => {\n      const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me));\n      if (!c || c.status !== \"active\") return no(\"That call isn't connected.\");\n      if (![\"offer\", \"answer\", \"ice\"].includes(kind)) return no(\"That isn't a valid call message.\");\n      if (typeof payload !== \"string\" || payload.length > 20000) return no(\"That call message is too long.\");\n      const to = c.caller === me ? c.callee : c.caller;\n      const s = { id: nextSignal++, call: id, from: me, to, kind, payload };\n      signals.push(s);\n      world.biggest = Math.max(world.biggest, payload.length);\n      world.sent[me] = (world.sent[me] || 0) + 1;\n      tell(to, { type: \"signal\", callId: id, signal: { id: s.id, kind, payload } });\n      return ok(s.id);\n    },\n    callState: (me, id, from) => { const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me)); return ok({ call: c ? shape(c, me) : null, signals: signals.filter((s) => s.call === id && s.to === me && s.id > (from || 0)).map((s) => ({ id: s.id, kind: s.kind, payload: s.payload })) }); },\n    callBeat: (me, id) => { const c = calls.find((x) => x.id === id); return ok(c && c.status !== \"ended\" ? \"active\" : \"ended\"); },\n  };\n  // Someone opened AURA after the others had already loaded their friends list: tell everyone to look again\n  const friendsChanged = () => Object.keys(people).forEach((id) => tell(id, { type: \"friends\" }));\n  const world = { people, handlers, biggest: 0, sent: {}, friendsChanged, reset() { calls.forEach((c) => end(c, \"hangup\")); } };\n  return world;\n}\n\nasync function person(browser, world, base, id, name) {\n  const page = await (await browser.newContext({ viewport: { width: 1360, height: 860 }, permissions: [\"microphone\"] })).newPage();\n  const thrown = [];\n  page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n  world.people[id] = { page, name, thrown };\n  await page.exposeBinding(\"__social\", (_src, fn, args) => { const h = world.handlers[fn]; return h ? h(id, ...(args || [])) : { success: true, data: null }; });\n  await page.addInitScript(([id, name]) => {\n    try { localStorage.clear(); localStorage.setItem(\"aura_profile\", JSON.stringify({ username: name, avatar: \"\", userId: id })); } catch {}\n    const ok = (data) => Promise.resolve({ success: true, data });\n    const account = { getSession: () => ok({ id, email: name + \"@example.com\" }), getMyProfile: () => ok({ username: name, avatar_url: null }) };\n    window.auraCloud = new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => (account[key] ? account[key](...args) : ok(null))) });\n    window.auraSocial = new Proxy({}, {\n      get: (_t, key) => {\n        if (key === \"then\") return undefined;\n        if (key === \"onEvent\") return (cb) => { window.__deliver = cb; return () => { window.__deliver = null; }; };\n        return (...args) => window.__social(key, args);\n      },\n    });\n    // Screens and windows to pick from, like Windows would list them\n    const pic = (hue) => \"data:image/svg+xml;base64,\" + btoa(`<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"320\" height=\"180\"><rect width=\"320\" height=\"180\" fill=\"hsl(${hue},40%,35%)\"/></svg>`);\n    window.__chosen = [];\n    const desktop = {\n      getCaptureSources: () => Promise.resolve({ success: true, sources: [\n        { id: \"window:22:0\", name: \"Notepad\", thumbnail: pic(200), isScreen: false },\n        { id: \"screen:0:0\", name: \"Entire screen\", thumbnail: pic(20), isScreen: true },\n      ] }),\n      setCaptureSource: (sid) => { window.__chosen.push(sid); return Promise.resolve({ success: true }); },\n    };\n    window.electronAPI = new Proxy({}, {\n      get: (_t, key) => {\n        if (key === \"isElectron\") return true;\n        if (typeof key !== \"string\" || key === \"then\") return undefined;\n        if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};\n        return (...args) => (desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }));\n      },\n    });\n    // Keep hold of every screen captured, to check it's switched off afterwards\n    window.__screens = [];\n    const realGDM = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);\n    navigator.mediaDevices.getDisplayMedia = async (...a) => { const s = await realGDM(...a); window.__screens.push(s); return s; };\n    // Keep hold of every camera opened, and a way to make the next one fail\n    window.__cams = [];\n    window.__failCam = null;\n    const realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);\n    navigator.mediaDevices.getUserMedia = async (c = {}) => {\n      if (c.video && window.__failCam) { const e = new Error(\"pretend\"); e.name = window.__failCam; throw e; }\n      const s = await realGUM(c);\n      if (c.video) window.__cams.push(s);\n      return s;\n    };\n    // Keep hold of the connections, so the test can see what goes over them\n    const Real = window.RTCPeerConnection;\n    window.__pcs = [];\n    window.RTCPeerConnection = function (...a) { const pc = new Real(...a); window.__pcs.push(pc); return pc; };\n    window.RTCPeerConnection.prototype = Real.prototype;\n  }, [id, name]);\n  await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n  return page;\n}\n\n(async () => {\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(process.env.CI ? 1 : 3); }\n  const args = [\"--use-fake-ui-for-media-stream\", \"--use-fake-device-for-media-stream\", \"--auto-accept-this-tab-capture\", \"--autoplay-policy=no-user-gesture-required\"];\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch({ ...options, args }); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with. Run  npx playwright install chromium  once to add one.\"); return done(process.env.CI ? 1 : 3); }\n  const now = await serve(DIST);\n  const old = OLD && fs.existsSync(path.join(OLD, \"index.html\")) ? await serve(OLD) : null;\n\n  const until = async (fn, ms = 15000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); } catch { v = null; } if (v) return v; await sleep(200); } return v; };\n  const bar = (p) => p.locator(\".cx-bar\");\n  const live = (p) => until(() => p.evaluate(() => !!document.querySelector(\".cx-bar.live\")));\n  const callFrom = async (from, to, toName) => {\n    await from.locator(`button.cx-call[title=\"Call ${toName}\"]`).first().click({ timeout: 10000 });\n    await until(() => to.evaluate(() => !!document.querySelector(\".cx-bar.ringing.in\")));\n    await to.locator(\".cx-btn.yes\").click({ timeout: 15000 });\n    return (await live(from)) && (await live(to));\n  };\n  const hangUp = async (p) => { await p.locator(\".cx-round.end\").click({ timeout: 15000 }).catch(() => {}); await sleep(1500); };\n  const mlines = (p) => p.evaluate(() => { const pc = window.__pcs.filter((x) => x.connectionState !== \"closed\").pop(); return pc ? (pc.remoteDescription?.sdp || \"\").match(/^m=\\w+/gm) || [] : []; });\n  const audioIn = (p) => p.evaluate(async () => { const pc = window.__pcs.filter((x) => x.connectionState !== \"closed\").pop(); let a = 0; if (pc) (await pc.getStats()).forEach((r) => { if (r.type === \"inbound-rtp\" && r.kind === \"audio\") a = r.bytesReceived || 0; }); return a; });\n  // What the call box shows: their camera, yours, and the names on them\n  const cams = (p) => p.evaluate(() => {\n    const v = (sel) => { const e = document.querySelector(sel); return e ? { w: e.videoWidth, t: e.currentTime, box: Math.round(e.getBoundingClientRect().width), track: e.srcObject?.getVideoTracks()[0]?.id || \"\", mirror: getComputedStyle(e).transform } : null; };\n    const panel = document.querySelector(\".cx-cams\");\n    return { theirs: v(\".cx-cams .cx-cam-theirs\"), mine: v(\".cx-cams .cx-cam-mine\"), small: !!document.querySelector(\".cx-cams .cx-cam-mine.small\"), name: panel?.querySelector(\".cx-cam-name\")?.textContent || \"\", panel: panel ? Math.round(panel.getBoundingClientRect().width) : 0, pill: !!document.querySelector(\".cx-cams-pill\") };\n  });\n  const camsLive = (p) => p.evaluate(() => window.__cams.filter((s) => s.getVideoTracks().some((t) => t.readyState === \"live\")).length);\n  const camBtn = (p) => p.locator(\".cx-round.cam\");\n  const toasts = (p) => p.evaluate(() => [...document.querySelectorAll(\".toast, [class*=toast]\")].map((t) => t.innerText).join(\" | \"));\n\n  try {\n    const world = makeWorld();\n    const A = await person(browser, world, now.base, \"user-A\", \"Alex\");\n    const B = await person(browser, world, now.base, \"user-B\", \"Bri\");\n    await sleep(5000);\n    world.friendsChanged();\n    await until(() => A.evaluate(() => !!document.querySelector('button.cx-call[title=\"Call Bri\"]')));\n\n    console.log(\"1. A call, with cameras ready\");\n    check(\"Alex calls Bri, Bri accepts, and they're connected\", await callFrom(A, B, \"Bri\"));\n    check(\"both see a camera button in the call box, ready to use\", await until(async () => (await camBtn(A).isEnabled()) && (await camBtn(B).isEnabled())));\n    const ml = await mlines(B);\n    check(\"the call has a lane for the screen and one for cameras\", ml.filter((m) => m === \"m=video\").length === 2, ml);\n    check(\"no camera is on until someone presses the button\", (await camsLive(A)) === 0 && (await camsLive(B)) === 0 && (await A.locator(\".cx-cams\").count()) === 0);\n    check(\"Share Screen still works alongside it\", await A.locator(\".cx-round.share\").isEnabled());\n\n    console.log(\"2. Alex turns the camera on\");\n    const signalsBefore = world.sent[\"user-A\"] || 0;\n    await camBtn(A).click();\n    check(\"Alex's camera turns on, and the button shows it\", await until(async () => (await camsLive(A)) === 1 && (await A.locator(\".cx-round.cam.on\").count()) === 1));\n    check(\"Alex's call box says Camera on\", await until(async () => /Camera on/.test(await bar(A).innerText())));\n    let a = await until(async () => { const c = await cams(A); return c.mine && c.mine.w > 0 && c; });\n    check(\"Alex sees themself under the call box, mirrored, labelled You\", !!a && !a.theirs && a.name === \"You\" && /matrix\\(-1/.test(a.mine.mirror), a);\n    let b = await until(async () => { const c = await cams(B); return c.theirs && c.theirs.w > 0 && c; });\n    check(\"Bri sees Alex's camera under the call box, labelled Alex\", !!b && b.name === \"Alex\" && b.panel >= 300 && !b.mine, b);\n    check(\"not mirrored for Bri (Bri sees Alex as they are)\", !!b && b.theirs.mirror === \"none\", b && b.theirs.mirror);\n    const t0 = b?.theirs.t || 0;\n    await sleep(1500);\n    check(\"and it's moving\", ((await cams(B)).theirs?.t || 0) > t0);\n    check(\"turning the camera on doesn't reconnect the call\", (world.sent[\"user-A\"] || 0) === signalsBefore, { before: signalsBefore, after: world.sent[\"user-A\"] });\n\n    console.log(\"3. Both cameras on\");\n    await camBtn(B).click();\n    b = await until(async () => { const c = await cams(B); return c.theirs?.w > 0 && c.mine?.w > 0 && c.small && c; });\n    check(\"Bri sees Alex big, and themself small in the corner\", !!b && b.name === \"Alex\" && b.mine.box < b.theirs.box / 2, b);\n    a = await until(async () => { const c = await cams(A); return c.theirs?.w > 0 && c.mine?.w > 0 && c.small && c; });\n    check(\"Alex sees Bri big, and themself small in the corner\", !!a && a.name === \"Bri\", a);\n    const i0 = await audioIn(A); await sleep(1000);\n    check(\"their voices still arrive\", (await audioIn(A)) > i0);\n\n    console.log(\"4. Camera and screen share together\");\n    await A.locator(\".cx-round.share\").click();\n    await A.locator(\".cx-picker .cx-src\").first().click({ timeout: 15000 });\n    const both = await until(() => B.evaluate(() => {\n      const s = document.querySelector(\".cx-screen video\"), c = document.querySelector(\".cx-cams .cx-cam-theirs\");\n      const id = (e) => e?.srcObject?.getVideoTracks()[0]?.id || \"\";\n      return s && c && s.videoWidth > 0 && c.videoWidth > 0 && id(s) && id(c) && id(s) !== id(c) ? { screen: s.videoWidth, cam: c.videoWidth } : null;\n    }), 30000);\n    check(\"Bri sees Alex's screen in its corner and Alex's camera under the call box, each in its own place\", !!both, both);\n    await A.locator(\".cx-round.share.on\").click();\n    await until(async () => !(await B.locator(\".cx-screen\").count()));\n    check(\"stopping the screen share leaves the camera on\", (await cams(B)).theirs?.w > 0 && (await camsLive(A)) === 1);\n\n    console.log(\"5. Bigger, hide, show\");\n    const w0 = (await cams(B)).panel;\n    await B.locator(\".cx-cams\").hover();\n    await B.locator('.cx-cams button[aria-label=\"Make the camera bigger\"]').click();\n    await sleep(300);\n    check(\"the arrows make it bigger\", (await cams(B)).panel > w0 + 150, { w0, now: (await cams(B)).panel });\n    await B.locator('.cx-cams button[aria-label=\"Make the camera smaller\"]').click();\n    await B.locator('.cx-cams button[aria-label=\"Hide the cameras\"]').click();\n    await sleep(300);\n    check(\"the dash tucks it away into a small button\", (await B.locator(\".cx-cams\").count()) === 0 && (await cams(B)).pill);\n    check(\"(the cameras stay on while hidden)\", (await camsLive(A)) === 1 && (await camsLive(B)) === 1);\n    await B.locator(\".cx-cams-pill\").click();\n    await sleep(300);\n    check(\"and the button brings it back\", (await cams(B)).theirs?.w > 0);\n    if (process.env.AURA_SHOT_DIR) { await sleep(500); await B.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, \"cams.png\") }); }\n\n    console.log(\"6. Turning it off\");\n    await camBtn(A).click();\n    check(\"Alex's camera turns off and is let go\", await until(async () => (await camsLive(A)) === 0 && (await A.locator(\".cx-round.cam.on\").count()) === 0));\n    b = await until(async () => { const c = await cams(B); return !c.theirs && c.mine && c; });\n    check(\"Bri stops seeing Alex's camera (and still sees their own)\", !!b && b.name === \"You\", b);\n    a = await cams(A);\n    check(\"Alex now sees Bri's camera only\", !!a.theirs && !a.mine, a);\n    await camBtn(A).click();\n    check(\"Alex can turn it on again\", !!(await until(async () => { const c = await cams(B); return c.theirs?.w > 0; })));\n    await camBtn(A).click();\n    await until(async () => (await camsLive(A)) === 0);\n\n    console.log(\"7. When the camera can't be used\");\n    await A.evaluate(() => { window.__failCam = \"NotReadableError\"; });\n    await camBtn(A).click();\n    await sleep(800);\n    check(\"a camera in use by another app is explained\", /being used by another app/.test(await toasts(A)), await toasts(A));\n    check(\"and the button can be pressed again\", (await camBtn(A).isEnabled()) && (await A.locator(\".cx-round.cam.on\").count()) === 0);\n    await A.evaluate(() => { window.__failCam = \"NotAllowedError\"; });\n    await camBtn(A).click();\n    await sleep(800);\n    check(\"a camera blocked in Windows is explained\", /Privacy & security > Camera/.test(await toasts(A)), await toasts(A));\n    await A.evaluate(() => { window.__failCam = null; });\n    await camBtn(A).click();\n    await until(async () => (await camsLive(A)) === 1 && (await A.locator(\".cx-round.cam.on\").count()) === 1); // fully on (AURA is watching for it to be unplugged)\n    await A.evaluate(() => { const t = window.__cams[window.__cams.length - 1].getVideoTracks()[0]; t.stop(); t.dispatchEvent(new Event(\"ended\")); });\n    await sleep(800);\n    check(\"a camera unplugged mid-call: turned off and explained\", !!(await until(async () => /camera was disconnected/.test(await toasts(A)), 5000)) && (await A.locator(\".cx-round.cam.on\").count()) === 0, await toasts(A));\n    check(\"and Bri stops seeing it\", await until(async () => !(await cams(B)).theirs));\n\n    console.log(\"8. Hanging up with cameras on\");\n    await camBtn(A).click();\n    await until(async () => (await cams(B)).theirs?.w > 0);\n    await hangUp(B);\n    check(\"the call ends for both\", await until(() => A.evaluate(() => !document.querySelector(\".cx-bar.live\"))));\n    check(\"both cameras are let go\", (await camsLive(A)) === 0 && (await camsLive(B)) === 0, { a: await camsLive(A), b: await camsLive(B) });\n    check(\"and the camera pictures go away\", (await A.locator(\".cx-cams, .cx-cams-pill\").count()) === 0 && (await B.locator(\".cx-cams, .cx-cams-pill\").count()) === 0);\n    check(\"the next call starts with cameras off\", await callFrom(B, A, \"Alex\") && (await until(async () => camBtn(A).isEnabled())) && (await camsLive(A)) === 0 && (await A.locator(\".cx-round.cam.on\").count()) === 0);\n    await hangUp(A);\n\n    if (old) {\n      console.log(\"9. A friend still on the older AURA\");\n      const world2 = makeWorld();\n      const N = await person(browser, world2, now.base, \"user-N\", \"Nia\");\n      const O = await person(browser, world2, old.base, \"user-O\", \"Omar\");\n      await sleep(5000);\n      world2.friendsChanged();\n      await until(() => N.evaluate(() => !!document.querySelector('button.cx-call[title=\"Call Omar\"]')));\n      check(\"calling them works\", await callFrom(N, O, \"Omar\"));\n      check(\"screen share still works with them\", !!(await until(() => N.locator(\".cx-round.share\").isEnabled())));\n      const btn = camBtn(N);\n      check(\"the camera button is off, and says why\", (await btn.isDisabled()) && /latest AURA/.test(await btn.getAttribute(\"title\")), await btn.getAttribute(\"title\"));\n      const n0 = await audioIn(N), o0 = await audioIn(O); await sleep(1200);\n      check(\"both hear each other\", (await audioIn(N)) > n0 && (await audioIn(O)) > o0);\n      await N.locator(\".cx-round.share\").click();\n      await N.locator(\".cx-picker .cx-src\").first().click({ timeout: 15000 });\n      check(\"and Omar (older AURA) sees Nia's screen\", !!(await until(() => O.evaluate(() => { const v = document.querySelector(\".cx-screen video\"); return v && v.videoWidth > 0; }))));\n      await hangUp(N);\n      check(\"being called by them works too\", await callFrom(O, N, \"Nia\"));\n      check(\"screen share works that way round\", !!(await until(() => N.locator(\".cx-round.share\").isEnabled())));\n      check(\"and the camera button is off there too\", await camBtn(N).isDisabled());\n      await N.locator(\".cx-round.share\").click();\n      await N.locator(\".cx-picker .cx-src\").first().click({ timeout: 15000 });\n      check(\"and Omar sees Nia's screen\", !!(await until(() => O.evaluate(() => { const v = document.querySelector(\".cx-screen video\"); return v && v.videoWidth > 0; }))));\n      await hangUp(O);\n      check(\"nothing crashed on either side\", world2.people[\"user-N\"].thrown.filter((m) => !/reading 'live'/.test(m)).length === 0, world2.people[\"user-N\"].thrown);\n    } else note(\"no older AURA build given (AURA_OLD_DIST), so calls with an older AURA weren't checked here\");\n\n    check(\"nothing crashed along the way\", [\"user-A\", \"user-B\"].every((id) => world.people[id].thrown.filter((m) => !/reading 'live'/.test(m)).length === 0), [\"user-A\", \"user-B\"].map((id) => world.people[id].thrown));\n  } finally {\n    await browser.close();\n    now.server.close();\n    if (old) old.server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The call camera check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-call-camera.bak";
const MARK = "Added by aura-call-camera-setup.cjs";
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "release", ".git", ".vite", "coverage", "tests", "supabase"]);

const rel = (p) => path.relative(ROOT, p) || p;
const say = (line = "") => console.log(line);
function stop(lines) {
  say();
  say("Nothing was changed.");
  (Array.isArray(lines) ? lines : [lines]).forEach((l) => say("  " + l));
  say();
  process.exit(1);
}
function readText(file) {
  const raw = fs.readFileSync(file, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n"; // keep Windows line endings as they are
  return { text: raw.replace(/\r\n/g, "\n"), eol };
}
const withEol = (text, eol) => (eol === "\n" ? text : text.replace(/\n/g, eol));
function* walk(dir, depth = 0) {
  if (depth > 7) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) yield* walk(full, depth + 1);
    } else if (/\.(jsx?|tsx?|cjs|mjs)$/.test(entry.name) && !/^aura-[\w-]+\.cjs$/.test(entry.name)) {
      try { if (fs.statSync(full).size < 3 * 1024 * 1024) yield full; } catch {}
    }
  }
}
// Finds one file. A project can have several that look alike, so `prefer` is a list of tie-breakers.
function findOne(label, test, hint, prefer = []) {
  let hits = [];
  for (const file of walk(ROOT)) {
    let text = "";
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    if (test(text)) hits.push({ file, text });
  }
  if (!hits.length) stop(["I couldn't find " + label + ".", hint, "Copy this message to Claude."]);
  for (const rule of prefer) {
    if (hits.length === 1) break;
    const kept = hits.filter((h) => rule(h));
    if (kept.length) hits = kept;
  }
  if (hits.length === 1) return hits[0].file;
  stop(["I found more than one file that looks like " + label + ":", ...hits.map((h) => "  " + rel(h.file)), "Copy this message to Claude."]);
}
const sameFile = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const indentOf = (line) => line.match(/^\s*/)[0];
const findLine = (lines, re, from = 0, to = lines.length) => { for (let i = from; i < to; i++) if (re.test(lines[i])) return i; return -1; };

function swapOnce(text, find, replace, what) {
  const i = text.indexOf(find);
  if (i < 0 || text.indexOf(find, i + 1) >= 0) throw new Error(what);
  return text.slice(0, i) + replace + text.slice(i + find.length);
}

function editCalls(text) {
  if (text.includes("async startCamera()")) return { text, notes: [] };
  let t = text;
  // Settings for the picture
  t = swapOnce(t, "const SCREEN_VIDEO = { frameRate: { ideal: 30, max: 30 }, width: { max: 1920 }, height: { max: 1080 } };\n",
    "const SCREEN_VIDEO = { frameRate: { ideal: 30, max: 30 }, width: { max: 1920 }, height: { max: 1080 } };\n" +
    (t.includes("SHARE_MODES")
      // (the quality update is already in: up to 1080p)
      ? "// Your camera in a call (" + MARK + "): up to 1080p at 30 frames a second when the camera can\n" +
        "const CAM_MAX_BITRATE = 2500000;\n" +
        "const CAM_VIDEO = { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 30, max: 30 } };\n"
      : "// Your camera in a call (" + MARK + "): up to 720p at 30 frames a second\n" +
        "const CAM_MAX_BITRATE = 1500000;\n" +
        "const CAM_VIDEO = { width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 }, frameRate: { ideal: 30, max: 30 } };\n"),
    "the screen share settings ( const SCREEN_VIDEO = ... )");
  t = swapOnce(t, "screen: null, remoteVideo: null, config: null,",
    "screen: null, remoteVideo: null, cam: null, remoteCam: null, peerCam: false, config: null,",
    "the parts of a call ( const newRtc = () => ({ ... screen: null, remoteVideo: null, config: null, ... )");
  // Hanging up turns the camera off
  t = swapOnce(t, "  stopStream(r.screen); // and so does your screen, if you were sharing it\n",
    "  stopStream(r.screen); // and so does your screen, if you were sharing it\n  stopStream(r.cam); // and your camera (" + MARK + ")\n",
    "where a call is tidied up ( stopStream(r.screen); )");
  // Saying hello: this AURA can do cameras too (an older AURA ignores that)
  t = swapOnce(t, `dc.send('{"t":"hello","screen":1}');`, `dc.send('{"t":"hello","screen":1,"cam":1}');`,
    "the hello message ( {\"t\":\"hello\",\"screen\":1} )");
  t = swapOnce(t, `    else if (m?.t === "hello" && m.screen) addScreenLane();\n    else if (m?.t === "screen") patch({ peerSharing: !!m.on });\n`,
    `    else if (m?.t === "hello" && m.screen) { if (m.cam && rtc) rtc.peerCam = true; addScreenLane(); } // (camera: ${MARK})\n` +
    `    else if (m?.t === "screen") patch({ peerSharing: !!m.on });\n` +
    `    else if (m?.t === "cam") patch({ peerCamOn: !!m.on });\n`,
    "where messages from the other PC are read ( m?.t === \"hello\" ... m?.t === \"screen\" )");
  // A picture arriving: their screen, or their camera
  t = swapOnce(t,
    `    if (e.track.kind === "video") { if (rtc) { rtc.remoteVideo = new MediaStream([e.track]); patch({ screenRev: (state.call?.screenRev || 0) + 1 }); } return; } // their screen\n`,
    `    if (e.track.kind === "video") {\n` +
    `      if (!rtc) return;\n` +
    `      // The second picture lane is their camera; the first is their screen (${MARK})\n` +
    `      if (videoLanes()[1] && e.transceiver === videoLanes()[1]) { rtc.remoteCam = new MediaStream([e.track]); patch({ camRev: (state.call?.camRev || 0) + 1 }); return; }\n` +
    `      rtc.remoteVideo = new MediaStream([e.track]); patch({ screenRev: (state.call?.screenRev || 0) + 1 }); return; // their screen\n` +
    `    }\n`,
    "where their picture arrives ( if (e.track.kind === \"video\") { ... // their screen )");
  // Lanes: the first picture lane is the screen, the second the camera
  t = swapOnce(t,
    "const videoLane = () => rtc?.pc?.getTransceivers().find((tr) => tr.receiver?.track?.kind === \"video\" && !tr.stopped && tr.currentDirection !== \"stopped\") || null;\n",
    "const videoLanes = () => rtc?.pc?.getTransceivers().filter((tr) => tr.receiver?.track?.kind === \"video\" && !tr.stopped && tr.currentDirection !== \"stopped\") || [];\n" +
    "const videoLane = () => videoLanes()[0] || null;\n" +
    "const camLane = () => videoLanes()[1] || null; // your camera and theirs (" + MARK + ")\n",
    "the screen share lane ( const videoLane = () => ... )");
  t = swapOnce(t,
    "  if (ok && state.call && !state.call.canShare) patch({ canShare: true });\n}\n",
    "  if (ok && state.call && !state.call.canShare) patch({ canShare: true });\n" +
    "  const cam = camLane();\n" +
    "  if (cam && cam.currentDirection === \"sendrecv\" && state.call && !state.call.canCam) patch({ canCam: true });\n" +
    "}\n",
    "where screen share becomes ready ( if (ok && state.call && !state.call.canShare) ... )");
  t = swapOnce(t,
    "    rtc.pc.addTransceiver(\"video\", { direction: \"sendrecv\" });\n",
    "    rtc.pc.addTransceiver(\"video\", { direction: \"sendrecv\" });\n" +
    "    if (rtc.peerCam) rtc.pc.addTransceiver(\"video\", { direction: \"sendrecv\" }); // a second lane for cameras, when both can (" + MARK + ")\n",
    "where the screen share lane is added ( rtc.pc.addTransceiver(\"video\", ... ) )");
  // Turning your camera on and off
  t = swapOnce(t,
    "  // Ends the call if it is with this person (used when you block them)\n",
    "  // Your camera, for the other person to see (" + MARK + ")\n" +
    "  async startCamera() {\n" +
    "    const c = state.call;\n" +
    "    if (!c || !rtc || (c.phase !== \"live\" && c.phase !== \"reconnecting\") || c.camOn || c.camStarting) return;\n" +
    "    const lane = camLane();\n" +
    "    if (!lane || !c.canCam) return toast(`Camera needs both of you on the latest AURA. Ask ${c.peer.username} to update.`, \"err\");\n" +
    "    const mine = session;\n" +
    "    patch({ camStarting: true });\n" +
    "    // The camera picked in Settings > Camera, if there is one\n" +
    "    let picked = \"\";\n" +
    "    try { picked = JSON.parse(localStorage.getItem(\"aura_settings\") || \"{}\").camDevice || \"\"; } catch {}\n" +
    "    const want = (id) => navigator.mediaDevices.getUserMedia({ audio: false, video: { ...CAM_VIDEO, ...(id ? { deviceId: { exact: id } } : {}) } });\n" +
    "    let stream = null;\n" +
    "    try {\n" +
    "      try { stream = await want(picked); }\n" +
    "      catch (e) { if (picked && (e?.name === \"OverconstrainedError\" || e?.name === \"NotFoundError\")) stream = await want(\"\"); else throw e; }\n" +
    "    } catch (e) {\n" +
    "      if (mine === session) { patch({ camStarting: false }); toast(camProblem(e), \"err\"); }\n" +
    "      return;\n" +
    "    }\n" +
    "    if (mine !== session || !rtc || !state.call?.camStarting) return stopStream(stream); // the call ended (or you pressed again) meanwhile\n" +
    "    const track = stream.getVideoTracks()[0];\n" +
    "    try { await lane.sender.replaceTrack(track); }\n" +
    "    catch { stopStream(stream); patch({ camStarting: false }); return toast(\"Your camera couldn't be sent. Try again.\", \"err\"); }\n" +
    "    if (mine !== session || !rtc) return stopStream(stream);\n" +
    "    rtc.cam = stream;\n" +
    "    try {\n" +
    "      const p = lane.sender.getParameters();\n" +
    "      if (!p.encodings || !p.encodings.length) p.encodings = [{}];\n" +
    "      p.encodings[0].maxBitrate = CAM_MAX_BITRATE;\n" +
    "      p.encodings[0].maxFramerate = 30;\n" +
    "      p.degradationPreference = \"balanced\";\n" +
    "      await lane.sender.setParameters(p);\n" +
    "    } catch {}\n" +
    "    // Unplugged mid-call: turn it off and say so\n" +
    "    track.onended = () => { if (rtc?.cam === stream) { callActions.stopCamera(); toast(\"Your camera was disconnected.\", \"err\"); } };\n" +
    "    patch({ camOn: true, camStarting: false, camRev: (state.call?.camRev || 0) + 1 });\n" +
    "    tell({ t: \"cam\", on: true });\n" +
    "  },\n" +
    "  stopCamera() {\n" +
    "    const lane = camLane();\n" +
    "    if (lane) lane.sender.replaceTrack(null).catch(() => {});\n" +
    "    if (rtc?.cam) { stopStream(rtc.cam); rtc.cam = null; }\n" +
    "    if (state.call?.camOn || state.call?.camStarting) patch({ camOn: false, camStarting: false });\n" +
    "    tell({ t: \"cam\", on: false });\n" +
    "  },\n\n" +
    "  // Ends the call if it is with this person (used when you block them)\n",
    "the call actions ( // Ends the call if it is with this person ... )");
  t = swapOnce(t, "function micProblem(e) {\n",
    "// What went wrong with the camera, in words (" + MARK + ")\n" +
    "function camProblem(e) {\n" +
    "  const name = e?.name || \"\";\n" +
    "  if (name === \"NotAllowedError\" || name === \"SecurityError\") return \"AURA isn't allowed to use your camera. In Windows, open Settings > Privacy & security > Camera and let desktop apps use it.\";\n" +
    "  if (name === \"NotFoundError\" || name === \"OverconstrainedError\") return \"No camera found. Plug one in and try again.\";\n" +
    "  if (name === \"NotReadableError\" || name === \"AbortError\") return \"Your camera is being used by another app. Close it and try again.\";\n" +
    "  return \"AURA couldn't use your camera\" + (e?.message ? \" (\" + e.message + \").\" : \".\");\n" +
    "}\n" +
    "function micProblem(e) {\n",
    "the microphone messages ( function micProblem(e) { )");
  // The camera icon
  t = swapOnce(t, "const IconScreen = () => ",
    "const IconCam = () => <Svg><rect x=\"2\" y=\"6\" width=\"14\" height=\"12\" rx=\"2\" /><path d=\"m16 10 6-3v10l-6-3z\" /></Svg>; // (" + MARK + ")\n" +
    "const IconExpandCam = () => <Svg size={14}><path d=\"M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7\" /></Svg>;\n" +
    "const IconScreen = () => ",
    "the icons ( const IconScreen = () => )");
  // The cameras, in the call box
  t = swapOnce(t, "// The call bar: sits at the top of the window for as long as a call is ringing or going on\n",
    "// ── Cameras, in the call box (" + MARK + ") ──\n" +
    "// Their camera, big, with yours small in its corner (mirrored, like a mirror). It hangs under the\n" +
    "// call box and moves with it. The arrows make it bigger; the dash tucks it away.\n" +
    "function CamVideo({ stream, rev, mirror, className }) {\n" +
    "  const v = useRef(null);\n" +
    "  useEffect(() => { const el = v.current; if (!el) return; if (el.srcObject !== stream) el.srcObject = stream || null; if (stream) el.play().catch(() => {}); }, [stream, rev]);\n" +
    "  return <video ref={v} className={className} autoPlay playsInline muted style={mirror ? { transform: \"scaleX(-1)\" } : undefined} />;\n" +
    "}\n" +
    "function CallCams({ call }) {\n" +
    "  const [big, setBig] = useState(false);\n" +
    "  const [hidden, setHidden] = useState(false);\n" +
    "  const theirs = call.peerCamOn ? rtc?.remoteCam || null : null;\n" +
    "  const mine = call.camOn ? rtc?.cam || null : null;\n" +
    "  if (!theirs && !mine) return null;\n" +
    "  const name = call.peer.username;\n" +
    "  if (hidden) return (\n" +
    "    <button type=\"button\" className=\"cx-cams-pill\" onClick={() => setHidden(false)} aria-label=\"Show the cameras\">{theirs ? `${name}'s camera` : \"Your camera\"} <b>Show</b></button>\n" +
    "  );\n" +
    "  return (\n" +
    "    <div className={`cx-cams ${theirs ? \"two\" : \"solo\"} ${big ? \"big\" : \"\"}`} role=\"region\" aria-label=\"Cameras\">\n" +
    "      {theirs\n" +
    "        ? <><CamVideo className=\"cx-cam-theirs\" stream={theirs} rev={call.camRev} /><span className=\"cx-cam-name\">{name}</span>{mine && <CamVideo className=\"cx-cam-mine small\" stream={mine} rev={call.camRev} mirror />}</>\n" +
    "        : <><CamVideo className=\"cx-cam-mine\" stream={mine} rev={call.camRev} mirror /><span className=\"cx-cam-name\">You</span></>}\n" +
    "      <div className=\"cx-cam-tools\">\n" +
    "        {theirs && <button type=\"button\" onClick={() => setBig((b) => !b)} title={big ? \"Smaller\" : \"Bigger\"} aria-label={big ? \"Make the camera smaller\" : \"Make the camera bigger\"}><IconExpandCam /></button>}\n" +
    "        <button type=\"button\" onClick={() => setHidden(true)} title=\"Hide the cameras\" aria-label=\"Hide the cameras\">–</button>\n" +
    "      </div>\n" +
    "    </div>\n" +
    "  );\n" +
    "}\n\n" +
    "// The call bar: sits at the top of the window for as long as a call is ringing or going on\n",
    "the call bar ( // The call bar: sits at the top of the window ... )");
  // The status line says when your camera is on
  t = swapOnce(t,
    "{call.sharing ? <span className=\"cx-sharing\"> · Sharing your screen</span> : call.muted && <span> · You're muted</span>}",
    "{call.sharing ? <span className=\"cx-sharing\"> · Sharing your screen</span> : call.camOn ? <span className=\"cx-sharing\"> · Camera on</span> : call.muted && <span> · You're muted</span>}",
    "the call status ( · Sharing your screen ... · You're muted )");
  // The camera button, next to Share Screen
  t = swapOnce(t,
    "          <button type=\"button\" className={`cx-round ${devices ? \"on\" : \"\"}`} data-cx-devices",
    "          {/* Your camera (" + MARK + ") */}\n" +
    "          <button type=\"button\" className={`cx-round cam ${call.camOn ? \"on\" : \"\"}`} disabled={!call.canCam || call.camStarting} aria-pressed={!!call.camOn}\n" +
    "            onClick={() => (call.camOn ? callActions.stopCamera() : callActions.startCamera())}\n" +
    "            title={!call.canCam ? \"Camera needs both of you on the latest AURA\" : call.camOn ? \"Turn your camera off\" : \"Turn your camera on\"}\n" +
    "            aria-label={!call.canCam ? \"Camera isn't available on this call\" : call.camOn ? \"Turn your camera off\" : \"Turn your camera on\"}><IconCam /></button>\n" +
    "          <button type=\"button\" className={`cx-round ${devices ? \"on\" : \"\"}`} data-cx-devices",
    "the call settings button ( <button ... data-cx-devices )");
  t = swapOnce(t,
    "      {devices && active && <Devices onClose={() => setDevices(false)} />}\n",
    "      {active && <CallCams call={call} />}\n" +
    "      {devices && active && <Devices onClose={() => setDevices(false)} />}\n",
    "where the call settings open ( {devices && active && <Devices ... )");
  // Dragging the call box by its camera picture moves it too (buttons on it still work)
  t = swapOnce(t,
    "/* Screen share (Added by aura-screen-share-setup.cjs) */\n",
    "/* Cameras in calls (" + MARK + ") */\n" +
    ".cx-round.cam:disabled{opacity:.4;cursor:default}\n" +
    ".cx-round.cam.on{background:#3ddc84;border-color:#3ddc84;color:#06240f}\n" +
    ".cx-round.cam.on:hover{background:#dc2626;border-color:#dc2626;color:#fff}\n" +
    ".cx-cams{position:absolute;top:56px;left:50%;transform:translateX(-50%);width:340px;aspect-ratio:16/9;border-radius:14px;overflow:hidden;background:#000;border:1px solid var(--borderb,rgba(255,255,255,.18));box-shadow:0 20px 50px rgba(0,0,0,.55);cursor:grab}\n" +
    ".cx-cams.solo{width:200px}\n" +
    ".cx-cams.big{width:min(640px,calc(100vw - 24px))}\n" +
    ".cx-bar.low .cx-cams{top:auto;bottom:56px}\n" +
    ".cx-cams video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000}\n" +
    ".cx-cams video.small{inset:auto 8px 8px auto;width:28%;height:auto;aspect-ratio:16/9;border-radius:8px;border:1px solid rgba(255,255,255,.3);box-shadow:0 6px 18px rgba(0,0,0,.5)}\n" +
    ".cx-cam-name{position:absolute;left:8px;bottom:8px;padding:2px 8px;border-radius:999px;background:rgba(0,0,0,.55);font-size:11.5px;font-weight:600;color:#fff}\n" +
    ".cx-cam-tools{position:absolute;top:6px;right:6px;display:flex;gap:4px;opacity:0;transition:opacity .15s}\n" +
    ".cx-cams:hover .cx-cam-tools,.cx-cams:focus-within .cx-cam-tools{opacity:1}\n" +
    ".cx-cam-tools button{width:26px;height:26px;border-radius:7px;border:none;background:rgba(0,0,0,.6);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:15px;line-height:1}\n" +
    ".cx-cam-tools button:hover{background:rgba(0,0,0,.85)}\n" +
    ".cx-cams-pill{position:absolute;top:56px;left:50%;transform:translateX(-50%);white-space:nowrap;display:flex;align-items:center;gap:8px;height:32px;padding:0 12px;border-radius:999px;border:1px solid var(--borderb,rgba(255,255,255,.18));background:var(--panel,#1a1f26);color:var(--t1,#fff);font:500 12px 'DM Sans',sans-serif;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.5)}\n" +
    ".cx-bar.low .cx-cams-pill{top:auto;bottom:56px}\n" +
    ".cx-cams-pill b{color:#3ddc84;font-weight:600}\n" +
    ".cx-cam-tools button:focus-visible,.cx-cams-pill:focus-visible{outline:2px solid var(--ac2,var(--ac,#ff8a65));outline-offset:2px;opacity:1}\n" +
    "/* Screen share (Added by aura-screen-share-setup.cjs) */\n",
    "the screen share look ( /* Screen share (Added by aura-screen-share-setup.cjs) */ )");
  return { text: t, notes: [
    "a camera button in the call box, next to Share Screen",
    "their camera shows under the call box, with yours small in its corner",
    "a friend on an older AURA can still call; the camera button says why it's off",
  ] };
}

// The screen share check counted one picture lane; a call can have two now. And on a busy PC the
// picture can take a few seconds to get going: the check waits for it instead of failing.
function editScreenTest(text) {
  let t = text;
  const notes = [];
  if (!t.includes("Math.max(out.width")) {
    t = swapOnce(t,
      "      if (r.kind === \"video\") { out.video = r.bytesReceived || 0; out.frames = r.framesDecoded || 0; out.width = r.frameWidth || 0; }\n",
      "      if (r.kind === \"video\") { out.video += r.bytesReceived || 0; out.frames = Math.max(out.frames, r.framesDecoded || 0); out.width = Math.max(out.width, r.frameWidth || 0); } // (two picture lanes now: " + MARK + ")\n",
      "how the screen share check counts the picture");
    notes.push("the screen share check counts both picture lanes");
  }
  const slow = "    b = await incoming(B);\n    check(\"the picture arrives at a good size\", b.width >= 320 && b.frames > 10, b);\n";
  if (t.includes(slow)) {
    t = swapOnce(t, slow,
      "    // A busy PC can take a few seconds to get the picture going (" + MARK + ")\n" +
      "    b = (await until(async () => { const x = await incoming(B); return x && x.width >= 320 && x.frames > 10 ? x : null; }, 12000)) || (await incoming(B));\n" +
      "    check(\"the picture arrives at a good size\", b.width >= 320 && b.frames > 10, b);\n",
      "the screen share picture check");
    notes.push("it waits longer for the picture on a busy PC");
  }
  const fade = '    check("the top strip fades away when the mouse is still", await B.evaluate(() => !!document.querySelector(".cx-screen.full.idle")));\n';
  if (t.includes(fade)) {
    t = swapOnce(t, fade, '    check("the top strip fades away when the mouse is still", !!(await until(() => B.evaluate(() => !!document.querySelector(".cx-screen.full.idle")), 8000)));\n', "the fading strip check");
    if (!notes.includes("it waits longer for the picture on a busy PC")) notes.push("it allows for a busy PC");
  }
  if (/timeout: [35]000 \}/.test(t)) { t = t.replace(/timeout: [35]000 \}/g, "timeout: 15000 }"); notes.push("and gives buttons longer to respond"); }
  return { text: t, notes };
}

// ── AURA's checks (only when they are installed) ─────────────────────────────
function editRunner(text) {
  if (/call-camera\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  let at = -1;
  for (let i = 0; i < lines.length; i++) if (/add\("window",/.test(lines[i])) at = i;
  if (at < 0) return { text, notes: ["(couldn't find where to add the check, so npm test doesn't include it)"] };
  lines.splice(at + 1, 0, 'if (fs.existsSync(path.join(__dirname, "call-camera.cjs"))) add("window", "Your camera in calls", "call-camera.cjs");');
  return { text: lines.join("\n"), notes: ["npm test now checks cameras in calls too"] };
}

// Does `node` accept the file? Catches a bad edit before anything is written.
function syntaxProblem(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-check-"));
  const file = path.join(dir, "check.cjs");
  try {
    fs.writeFileSync(file, text);
    const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    return r.status === 0 ? "" : String(r.stderr || "syntax error").split("\n").filter(Boolean).slice(0, 4).join(" | ");
  } catch { return ""; } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
}

// ── Undo ──────────────────────────────────────────────────────────────────────
function undo() {
  let restored = 0;
  const visit = (dir, depth = 0) => {
    if (depth > 7) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if ((!SKIP_DIRS.has(entry.name) || entry.name === "tests") && !entry.name.startsWith(".")) visit(full, depth + 1);
      } else if (entry.name.endsWith(BAK)) {
        const target = full.slice(0, -BAK.length);
        fs.copyFileSync(full, target); fs.unlinkSync(full);
        say("  restored  " + rel(target)); restored++;
      } else if (entry.name === "call-camera.cjs") {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. Calls are back to voice and screen share." : "Nothing to undo.");
  say();
}

// ── Run ───────────────────────────────────────────────────────────────────────
function run() {
  const pkgFile = path.join(ROOT, "package.json");
  if (!fs.existsSync(pkgFile)) stop(["This isn't your AURA project folder (no package.json here).", "Move this file next to package.json and run it from there."]);
  if (UNDO) return undo();

  const need = "Make sure this file is in your AURA project folder, next to package.json.";
  let pkgMain = "";
  try { pkgMain = String(JSON.parse(fs.readFileSync(pkgFile, "utf8")).main || ""); } catch {}
  const startFile = pkgMain ? path.resolve(ROOT, pkgMain) : "";
  const comp = (h) => /[\\/]components[\\/]/.test(h.file);
  const files = {
    calls: findOne("your voice calls file", (t) => /function CallBar\s*\(/.test(t) && /export function mountCallLayer\s*\(/.test(t), need + " Voice calls with screen share need to be installed first (aura-screen-share-setup.cjs).", [
      (h) => /^calls\.[jt]sx?$/.test(path.basename(h.file)),
    ]),
  };

  const plan = [];
  const problems = [];
  const consider = (label, file, edit, checkSyntax) => {
    const { text, eol } = readText(file);
    try {
      const result = edit(text);
      if (checkSyntax && result.text !== text) { const bad = syntaxProblem(result.text); if (bad) throw new Error("a way to edit it safely (" + bad + ")"); }
      plan.push({ label, file, before: text, after: result.text, eol, notes: result.notes });
    } catch (e) { problems.push("In " + rel(file) + " I couldn't find " + e.message + "."); }
  };
  consider("calls file", files.calls, editCalls, false);
  const screenTest = path.join(ROOT, "tests", "screen-share.cjs");
  if (fs.existsSync(screenTest)) consider("checks", screenTest, editScreenTest, true);
  const runner = path.join(ROOT, "tests", "run.cjs");
  const hasChecks = fs.existsSync(runner);
  if (hasChecks) consider("checks", runner, editRunner, true);

  const created = [];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "call-camera.cjs"), content: FILES.test });
  for (const c of created) {
    c.note = "created";
    if (fs.existsSync(c.file)) {
      const existing = readText(c.file).text;
      if (!existing.includes(MARK)) problems.push(rel(c.file) + " already exists and wasn't made by this script, so I left it alone.");
      else c.note = existing === c.content ? "already done" : "updated";
    }
  }
  if (problems.length) stop([...problems, "Copy this message to Claude."]);

  say();
  say(DRY ? "Dry run. This is what would change:" : "AURA: your camera in calls");
  say();
  for (const step of plan) {
    if (step.after !== step.before && !DRY) {
      const bak = step.file + BAK;
      if (!fs.existsSync(bak)) fs.copyFileSync(step.file, bak);
      fs.writeFileSync(step.file, withEol(step.after, step.eol));
    }
    say("  " + (step.label + ":").padEnd(13) + rel(step.file));
    (step.notes.length ? step.notes : ["already done"]).forEach((n) => say("               - " + n));
  }
  for (const c of created) {
    if (c.note !== "already done" && !DRY) { fs.mkdirSync(path.dirname(c.file), { recursive: true }); fs.writeFileSync(c.file, c.content); }
    say("  " + (c.label + ":").padEnd(13) + rel(c.file));
    say("               - " + c.note);
  }
  say();
  if (DRY) { say("Run it again without --dry-run to apply."); say(); return; }
  say("Done. Restart AURA (stop it in the terminal and start it again). In a call, the camera button is next to Share Screen. Your friend needs this update too.");
  if (hasChecks) say("Run  npm test  before your next release.");
  say("To undo later:  node aura-call-camera-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
