#!/usr/bin/env node
/**
 * AURA — the call screen
 *
 *   - A call screen button in the call box, with the other call buttons. It fills your monitor:
 *       a big tile for each of you, showing the camera when it's on and the profile picture
 *       when it isn't, with a green ring while that person talks
 *       their shared screen takes the middle, with both of you beside it
 *       mute, camera, share screen, hang up and back along the bottom
 *     Esc or the back button returns to the call box; the call carries on.
 *   - The camera preview (Camera in the side menu) gets a full screen button too (or
 *     double-click the picture). Esc or "Exit full screen" goes back.
 *
 * Needs the camera-in-calls update first (aura-call-camera-setup.cjs).
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-call-screen-setup.cjs
 *
 * What it does:
 *   - edits    src/components/calls.jsx    the call screen and its button
 *   - edits    src/components/camera.jsx   (if it's there) the preview's full screen button
 *   - creates  tests/call-screen.cjs       (only if AURA's checks are installed) checks it
 *
 * Every file it changes is copied to <name>.before-call-screen.bak first.
 * To put everything back:                 node aura-call-screen-setup.cjs --undo
 * To preview without changing anything:   node aura-call-screen-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FILES = {"test":"// The call screen: the button in the call box that fills the monitor with the call. A big tile\n// for each person (camera when it's on, profile picture when it isn't), their shared screen in the\n// middle, and the call buttons along the bottom. Also the camera preview's full screen button.\n// Two AURA windows call each other for real in a real browser with pretend cameras; a pretend\n// Supabase passes the connection details between them.\n// Added by aura-call-screen-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\nconst sleep = (ms) => new Promise((r) => setTimeout(r, ms));\n\nfunction serve(dir) {\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(dir, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => {\n      if (err) { res.writeHead(404); return res.end(); }\n      res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" });\n      res.end(data);\n    });\n  });\n  return new Promise((r) => server.listen(0, \"127.0.0.1\", () => r({ server, base: \"http://127.0.0.1:\" + server.address().port })));\n}\n\n// ── A pretend Supabase for calls ─────────────────────────────────────────────\nfunction makeWorld() {\n  const people = {};    // id -> { page, name }\n  let calls = [], signals = [], nextSignal = 1, nextCall = 1;\n  const shape = (c, me) => ({ id: c.id, callerId: c.caller, calleeId: c.callee, peerId: c.caller === me ? c.callee : c.caller, outgoing: c.caller === me, status: c.status, reason: c.reason || null });\n  const tell = (id, event) => { const p = people[id]?.page; if (p) p.evaluate((e) => window.__deliver && window.__deliver(e), event).catch(() => {}); };\n  const ok = (data) => ({ success: true, data });\n  const no = (error) => ({ success: false, error });\n  const end = (c, reason) => { if (c.status === \"ended\") return; c.status = \"ended\"; c.reason = reason || \"hangup\"; for (const id of [c.caller, c.callee]) tell(id, { type: \"call\", call: shape(c, id) }); };\n  const handlers = {\n    start: (me) => ok({ id: me, username: people[me].name, live: true }),\n    listFriends: (me) => ok(Object.keys(people).filter((id) => id !== me).map((id) => ({ friendshipId: \"f-\" + id, userId: id, username: people[id].name, avatarUrl: \"\", state: \"friend\", since: null, online: true, lastSeenAt: new Date().toISOString() }))),\n    getProfile: (_me, id) => ok(people[id] ? { userId: id, username: people[id].name, bio: \"\", avatarUrl: \"\" } : null),\n    listConversations: () => ok([]), listBlocked: () => ok([]),\n    callConfig: () => ok({ iceServers: [], relay: false }),\n    currentCall: (me) => { const c = calls.find((x) => x.status !== \"ended\" && (x.caller === me || x.callee === me)); return ok(c ? shape(c, me) : null); },\n    startCall: (me, other) => {\n      if (calls.some((x) => x.status !== \"ended\" && [x.caller, x.callee].some((p) => p === me || p === other))) return no(\"You're already in a call.\");\n      const c = { id: \"call-\" + nextCall++, caller: me, callee: other, status: \"ringing\" };\n      calls.push(c);\n      tell(other, { type: \"call\", call: shape(c, other) });\n      return ok(shape(c, me));\n    },\n    answerCall: (me, id) => { const c = calls.find((x) => x.id === id && x.callee === me && x.status === \"ringing\"); if (!c) return no(\"That call has ended.\"); c.status = \"active\"; tell(c.caller, { type: \"call\", call: shape(c, c.caller) }); return ok(shape(c, me)); },\n    endCall: (me, id, reason) => { const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me)); if (c) end(c, reason); return ok(true); },\n    callSignal: (me, id, kind, payload) => {\n      const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me));\n      if (!c || c.status !== \"active\") return no(\"That call isn't connected.\");\n      if (![\"offer\", \"answer\", \"ice\"].includes(kind)) return no(\"That isn't a valid call message.\");\n      if (typeof payload !== \"string\" || payload.length > 20000) return no(\"That call message is too long.\");\n      const to = c.caller === me ? c.callee : c.caller;\n      const s = { id: nextSignal++, call: id, from: me, to, kind, payload };\n      signals.push(s);\n      world.biggest = Math.max(world.biggest, payload.length);\n      world.sent[me] = (world.sent[me] || 0) + 1;\n      tell(to, { type: \"signal\", callId: id, signal: { id: s.id, kind, payload } });\n      return ok(s.id);\n    },\n    callState: (me, id, from) => { const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me)); return ok({ call: c ? shape(c, me) : null, signals: signals.filter((s) => s.call === id && s.to === me && s.id > (from || 0)).map((s) => ({ id: s.id, kind: s.kind, payload: s.payload })) }); },\n    callBeat: (me, id) => { const c = calls.find((x) => x.id === id); return ok(c && c.status !== \"ended\" ? \"active\" : \"ended\"); },\n  };\n  // Someone opened AURA after the others had already loaded their friends list: tell everyone to look again\n  const friendsChanged = () => Object.keys(people).forEach((id) => tell(id, { type: \"friends\" }));\n  const world = { people, handlers, biggest: 0, sent: {}, friendsChanged, reset() { calls.forEach((c) => end(c, \"hangup\")); } };\n  return world;\n}\n\nasync function person(browser, world, base, id, name) {\n  const page = await (await browser.newContext({ viewport: { width: 1360, height: 860 }, permissions: [\"microphone\"] })).newPage();\n  const thrown = [];\n  page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n  world.people[id] = { page, name, thrown };\n  await page.exposeBinding(\"__social\", (_src, fn, args) => { const h = world.handlers[fn]; return h ? h(id, ...(args || [])) : { success: true, data: null }; });\n  await page.addInitScript(([id, name]) => {\n    try { localStorage.clear(); localStorage.setItem(\"aura_profile\", JSON.stringify({ username: name, avatar: \"\", userId: id })); } catch {}\n    const ok = (data) => Promise.resolve({ success: true, data });\n    const account = { getSession: () => ok({ id, email: name + \"@example.com\" }), getMyProfile: () => ok({ username: name, avatar_url: null }) };\n    window.auraCloud = new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => (account[key] ? account[key](...args) : ok(null))) });\n    window.auraSocial = new Proxy({}, {\n      get: (_t, key) => {\n        if (key === \"then\") return undefined;\n        if (key === \"onEvent\") return (cb) => { window.__deliver = cb; return () => { window.__deliver = null; }; };\n        return (...args) => window.__social(key, args);\n      },\n    });\n    // Screens and windows to pick from, like Windows would list them\n    const pic = (hue) => \"data:image/svg+xml;base64,\" + btoa(`<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"320\" height=\"180\"><rect width=\"320\" height=\"180\" fill=\"hsl(${hue},40%,35%)\"/></svg>`);\n    window.__chosen = [];\n    const desktop = {\n      getCaptureSources: () => Promise.resolve({ success: true, sources: [\n        { id: \"window:22:0\", name: \"Notepad\", thumbnail: pic(200), isScreen: false },\n        { id: \"screen:0:0\", name: \"Entire screen\", thumbnail: pic(20), isScreen: true },\n      ] }),\n      setCaptureSource: (sid) => { window.__chosen.push(sid); return Promise.resolve({ success: true }); },\n    };\n    window.electronAPI = new Proxy({}, {\n      get: (_t, key) => {\n        if (key === \"isElectron\") return true;\n        if (typeof key !== \"string\" || key === \"then\") return undefined;\n        if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};\n        return (...args) => (desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }));\n      },\n    });\n    // Keep hold of every screen captured, to check it's switched off afterwards\n    window.__screens = [];\n    const realGDM = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);\n    navigator.mediaDevices.getDisplayMedia = async (...a) => { const s = await realGDM(...a); window.__screens.push(s); return s; };\n    // Keep hold of every camera opened, and a way to make the next one fail\n    window.__cams = [];\n    window.__failCam = null;\n    const realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);\n    navigator.mediaDevices.getUserMedia = async (c = {}) => {\n      if (c.video && window.__failCam) { const e = new Error(\"pretend\"); e.name = window.__failCam; throw e; }\n      const s = await realGUM(c);\n      if (c.video) window.__cams.push(s);\n      return s;\n    };\n    // Keep hold of the connections, so the test can see what goes over them\n    const Real = window.RTCPeerConnection;\n    window.__pcs = [];\n    window.RTCPeerConnection = function (...a) { const pc = new Real(...a); window.__pcs.push(pc); return pc; };\n    window.RTCPeerConnection.prototype = Real.prototype;\n  }, [id, name]);\n  await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n  return page;\n}\n\n(async () => {\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(process.env.CI ? 1 : 3); }\n  const args = [\"--use-fake-ui-for-media-stream\", \"--use-fake-device-for-media-stream\", \"--auto-accept-this-tab-capture\", \"--autoplay-policy=no-user-gesture-required\"];\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch({ ...options, args }); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with. Run  npx playwright install chromium  once to add one.\"); return done(process.env.CI ? 1 : 3); }\n  const now = await serve(DIST);\n  const until = async (fn, ms = 15000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); } catch { v = null; } if (v) return v; await sleep(200); } return v; };\n  const live = (p) => until(() => p.evaluate(() => !!document.querySelector(\".cx-bar.live\")));\n  const callFrom = async (from, to, toName) => {\n    await from.locator(`button.cx-call[title=\"Call ${toName}\"]`).first().click({ timeout: 15000 });\n    await until(() => to.evaluate(() => !!document.querySelector(\".cx-bar.ringing.in\")));\n    await to.locator(\".cx-btn.yes\").click({ timeout: 15000 });\n    return (await live(from)) && (await live(to));\n  };\n  const camsLive = (p) => p.evaluate(() => window.__cams.filter((s) => s.getVideoTracks().some((t) => t.readyState === \"live\")).length);\n  // What the call screen shows\n  const stage = (p) => p.evaluate(() => {\n    const st = document.querySelector(\".cx-stage\");\n    if (!st) return null;\n    const tile = (who) => {\n      const t = st.querySelector(\".cx-tile.\" + who);\n      if (!t) return null;\n      const v = t.querySelector(\"video\"), f = t.querySelector(\".cx-face\");\n      return { name: t.querySelector(\".cx-tile-name\")?.textContent || \"\", video: v ? v.videoWidth : -1, mirror: v ? getComputedStyle(v).transform : \"\", face: !!f, faceText: f?.textContent || \"\", muted: !!t.querySelector(\".cx-tile-muted\"), w: Math.round(t.getBoundingClientRect().width) };\n    };\n    const sv = st.querySelector(\".cx-stage-screen video\");\n    const r = st.getBoundingClientRect();\n    return { them: tile(\"them\"), me: tile(\"me\"), screen: sv ? sv.videoWidth : -1, full: !!document.fullscreenElement && document.fullscreenElement.contains(st), w: Math.round(r.width), h: Math.round(r.height), bar: getComputedStyle(document.querySelector(\".cx-bar\") || document.body).display, top: st.querySelector(\".cx-stage-top\")?.innerText || \"\" };\n  });\n  const sbtn = (p, label) => p.locator(`.cx-stage-bar button[aria-label=\"${label}\"]`);\n\n  try {\n    const world = makeWorld();\n    const A = await person(browser, world, now.base, \"user-A\", \"Alex\");\n    const B = await person(browser, world, now.base, \"user-B\", \"Bri\");\n    await sleep(5000);\n    world.friendsChanged();\n    await until(() => A.evaluate(() => !!document.querySelector('button.cx-call[title=\"Call Bri\"]')));\n    check(\"Alex calls Bri and they're connected\", await callFrom(A, B, \"Bri\"));\n    await until(() => A.locator(\".cx-round.cam\").isEnabled());\n\n    console.log(\"1. The call screen button\");\n    const open = A.locator('.cx-bar button[aria-label=\"Open the call screen\"]');\n    check(\"the call box has a call screen button, with the other call buttons\", (await open.count()) === 1 && (await A.evaluate(() => { const b = document.querySelector('.cx-bar button[aria-label=\"Open the call screen\"]'); return b.parentElement.classList.contains(\"cx-acts\") && b.nextElementSibling?.classList.contains(\"end\"); })));\n    await open.click();\n    let s = await until(() => stage(A));\n    check(\"it opens the call screen, filling the whole monitor\", !!s && s.full && s.w >= 1300 && s.h >= 800, s);\n    check(\"the call box steps aside while it's open\", s && s.bar === \"none\", s && s.bar);\n    check(\"it says who the call is with, how long, and how to go back\", !!s && /Bri/.test(s.top) && /\\d\\d:\\d\\d/.test(s.top) && /Esc/.test(s.top), s && s.top);\n    check(\"a tile for each of you, with profile pictures while the cameras are off\", !!s && s.them?.face && s.them.name === \"Bri\" && s.them.faceText === \"B\" && s.me?.face && s.me.name === \"You\" && s.me.faceText === \"A\", s);\n    check(\"the tiles are big\", !!s && s.them.w >= 500, s && s.them);\n    const glow = await until(() => A.evaluate(() => Number(getComputedStyle(document.querySelector(\".cx-stage\")).getPropertyValue(\"--cx-peer\")) > 0), 8000);\n    check(\"a green ring follows Bri's voice\", !!glow);\n\n    console.log(\"2. Cameras on the call screen\");\n    await B.locator(\".cx-round.cam\").click();\n    s = await until(async () => { const x = await stage(A); return x && x.them.video > 0 ? x : null; });\n    check(\"when Bri turns the camera on, Bri's tile shows the full camera picture\", !!s && !s.them.face && s.them.mirror === \"none\", s && s.them);\n    await sbtn(A, \"Turn your camera on\").click();\n    s = await until(async () => { const x = await stage(A); return x && x.me.video > 0 ? x : null; });\n    check(\"Alex can turn the camera on from the call screen: Alex's tile shows it, mirrored\", !!s && /matrix\\(-1/.test(s.me.mirror), s && s.me);\n    check(\"and Bri sees Alex's camera\", !!(await until(() => B.evaluate(() => { const v = document.querySelector(\".cx-cams .cx-cam-theirs\"); return v && v.videoWidth > 0; }))));\n    await sbtn(A, \"Turn your camera off\").click();\n    s = await until(async () => { const x = await stage(A); return x && x.me.face ? x : null; });\n    check(\"turning it off brings back the profile picture (and lets go of the camera)\", !!s && (await camsLive(A)) === 0, s && s.me);\n\n    console.log(\"3. Mute and screen share from the call screen\");\n    await sbtn(A, \"Mute your microphone\").click();\n    s = await until(async () => { const x = await stage(A); return x && x.me.muted ? x : null; });\n    check(\"mute works, and Alex's tile shows it\", !!s && (await A.evaluate(() => !!document.querySelector(\".cx-bar.muted\"))));\n    s = await until(async () => { const x = await B.evaluate(() => !!document.querySelector(\".cx-peer-muted\")); return x; });\n    check(\"Bri sees Alex is muted\", !!s);\n    await sbtn(A, \"Unmute your microphone\").click();\n    await B.locator(\".cx-round.share\").click({ timeout: 15000 });\n    await B.locator(\".cx-picker .cx-src\").first().click({ timeout: 15000 });\n    s = await until(async () => { const x = await stage(A); return x && x.screen > 0 ? x : null; }, 20000);\n    check(\"when Bri shares a screen it takes the middle of the call screen\", !!s, s);\n    check(\"with both tiles beside it, smaller\", !!s && s.them.w < 400 && s.me.w < 400 && /sharing/.test(s.them.name), s);\n    check(\"(and the small screen-share window stays out of the way)\", await A.evaluate(() => getComputedStyle(document.querySelector(\".cx-screen\") || document.body).display === \"none\" || !document.querySelector(\".cx-screen\")));\n    await B.locator(\".cx-round.share.on\").click({ timeout: 15000 });\n    s = await until(async () => { const x = await stage(A); return x && x.screen === -1 ? x : null; });\n    check(\"when Bri stops, the tiles go back to full size\", !!s && s.them.w >= 500, s);\n    await sbtn(A, \"Share your screen\").click();\n    await A.locator(\".cx-stage .cx-picker .cx-src\").first().click({ timeout: 15000 });\n    check(\"Alex can share from the call screen, and Bri sees it\", !!(await until(() => B.evaluate(() => { const v = document.querySelector(\".cx-screen video\"); return v && v.videoWidth > 0; }))));\n    await sbtn(A, \"Stop sharing your screen\").click();\n\n    console.log(\"4. Going back\");\n    await A.keyboard.press(\"Escape\");\n    check(\"Esc goes back to the call box (full screen ends, the call carries on)\", !!(await until(async () => !(await stage(A)) && !(await A.evaluate(() => document.fullscreenElement)) && (await A.evaluate(() => getComputedStyle(document.querySelector(\".cx-bar\")).display !== \"none\" && !!document.querySelector(\".cx-bar.live\"))))));\n    await open.click();\n    await until(() => stage(A));\n    await sbtn(A, \"Leave the call screen\").click();\n    check(\"the back button does too\", !!(await until(async () => !(await stage(A)) && !!(await A.evaluate(() => document.querySelector(\".cx-bar.live\"))))));\n    await open.click();\n    await until(() => stage(A));\n    await sbtn(A, \"Turn your camera on\").click();\n    await until(async () => (await camsLive(A)) === 1);\n    await sbtn(A, \"Hang up\").click();\n    check(\"hanging up from the call screen ends the call and closes it\", !!(await until(async () => !(await stage(A)) && !(await A.evaluate(() => document.fullscreenElement)) && !(await B.evaluate(() => document.querySelector(\".cx-bar.live\"))))));\n    check(\"and lets go of the camera\", (await camsLive(A)) === 0);\n\n    console.log(\"5. The camera preview's full screen button\");\n    if (await A.locator(\".aura-cam\").count()) {\n      await A.locator(\".aura-cam\").first().click();\n      await until(() => A.evaluate(() => { const v = document.querySelector(\".cam-pan video\"); return v && v.videoWidth > 0; }));\n      await A.locator('.cam-pan button[aria-label=\"Show the camera full screen\"]').click();\n      const f = await until(() => A.evaluate(() => { const e = document.fullscreenElement; return e && e.classList.contains(\"cam-view\") ? { w: Math.round(e.getBoundingClientRect().width), fit: getComputedStyle(e.querySelector(\"video\")).objectFit } : null; }));\n      check(\"it shows the camera on the whole monitor\", !!f && f.w >= 1300 && f.fit === \"contain\", f);\n      await A.keyboard.press(\"Escape\");\n      check(\"Esc goes back to the small window, camera still on\", !!(await until(() => A.evaluate(() => !document.fullscreenElement && !!document.querySelector(\".cam-pan.on\")))));\n      await A.locator(\".cam-view\").dblclick();\n      check(\"double-clicking the picture goes full screen too\", !!(await until(() => A.evaluate(() => document.fullscreenElement?.classList.contains(\"cam-view\")))));\n      check(\"full screen shows an Exit full screen button\", await A.locator(\".cam-exit\").isVisible());\n      await A.locator(\".cam-exit\").click();\n      check(\"and it works\", !!(await until(() => A.evaluate(() => !document.fullscreenElement))));\n      await A.locator('.cam-pan button[aria-label=\"Close the camera\"]').click();\n    } else note(\"the camera preview update isn't installed, so its full screen button wasn't checked\");\n\n    check(\"nothing crashed along the way\", [\"user-A\", \"user-B\"].every((id) => world.people[id].thrown.filter((m) => !/reading 'live'/.test(m)).length === 0), [\"user-A\", \"user-B\"].map((id) => world.people[id].thrown));\n    if (process.env.AURA_SHOT_DIR) {\n      await callFrom(A, B, \"Bri\");\n      await until(() => A.locator(\".cx-round.cam\").isEnabled());\n      await B.locator(\".cx-round.cam\").click();\n      await A.locator('.cx-bar button[aria-label=\"Open the call screen\"]').click();\n      await sleep(2500);\n      await A.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, \"stage.png\") });\n      await B.locator(\".cx-round.share\").click({ timeout: 15000 });\n      await B.locator(\".cx-picker .cx-src\").first().click({ timeout: 15000 });\n      await sleep(3000);\n      await A.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, \"stage-screen.png\") });\n    }\n  } finally {\n    await browser.close();\n    now.server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The call screen check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-call-screen.bak";
const MARK = "Added by aura-call-screen-setup.cjs";
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

const STAGE = `
// ── The call screen (${MARK}) ──
// The whole monitor for a call: a big tile for each of you, showing the camera when it's on and
// the profile picture when it isn't (with a green ring while that person talks). When they share
// their screen it takes the middle, with both of you at the side. The call buttons are along the
// bottom. Esc, or the button, goes back to the call box.
function myself() {
  try { const p = JSON.parse(localStorage.getItem("aura_profile") || "null") || {}; return { userId: p.userId || "me", username: p.username || "You", avatarUrl: p.avatarUrl || p.avatar || "" }; }
  catch { return { userId: "me", username: "You", avatarUrl: "" }; }
}
function StageVideo({ stream, rev, mirror, contain }) {
  const v = useRef(null);
  useEffect(() => { const el = v.current; if (!el) return; if (el.srcObject !== stream) el.srcObject = stream || null; if (stream) el.play().catch(() => {}); }, [stream, rev]);
  return <video ref={v} autoPlay playsInline muted style={{ transform: mirror ? "scaleX(-1)" : undefined, objectFit: contain ? "contain" : "cover" }} />;
}
function StageTile({ who, person, stream, rev, mirror, muted, sharing }) {
  return (
    <div className={\`cx-tile \${who} \${stream ? "cam" : ""}\`} role="group" aria-label={who === "me" ? "You" : person.username}>
      {stream ? <StageVideo stream={stream} rev={rev} mirror={mirror} /> : <Face person={person} size={128} />}
      <span className="cx-tile-name">
        {muted && <span className="cx-tile-muted" title={who === "me" ? "You're muted" : \`\${person.username} is muted\`}><IconMicOff /></span>}
        {who === "me" ? "You" : person.username}{sharing && <span className="cx-tile-sharing"> · sharing</span>}
      </span>
    </div>
  );
}
// Full screen has to be asked for in the click itself (a moment later, Windows and newer browsers say no),
// so the call layer (which the call screen is drawn into) goes full screen as the button is pressed
function fullCallLayer() {
  const host = document.getElementById("aura-call-layer");
  try { if (host && document.fullscreenElement !== host) host.requestFullscreen?.({ navigationUI: "hide" })?.catch?.(() => {}); } catch {}
}
function CallStage() {
  const call = useCall();
  const box = useRef(null);
  const [picker, setPicker] = useState(false);
  const open = !!call && !!call.stage && (call.phase === "live" || call.phase === "reconnecting");
  // It fills the whole monitor (asked for right at the click, see fullCallLayer); if Windows won't, it still fills AURA's window
  useEffect(() => {
    if (!open) { setPicker(false); return; }
    const el = document.getElementById("aura-call-layer");
    let wasFull = !!el && document.fullscreenElement === el;
    const changed = () => { if (document.fullscreenElement === el) wasFull = true; else if (wasFull) callActions.closeStage(); };
    const esc = (e) => { if (e.key === "Escape") callActions.closeStage(); };
    document.addEventListener("fullscreenchange", changed);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      window.removeEventListener("keydown", esc);
      if (document.fullscreenElement === el) document.exitFullscreen().catch(() => {});
    };
  }, [open]);
  // The green rings follow your voices
  useEffect(() => meter.watch((me, peer) => {
    const el = box.current;
    if (!el) return;
    el.style.setProperty("--cx-me", me.toFixed(2));
    el.style.setProperty("--cx-peer", peer.toFixed(2));
  }), [open]);
  if (!open) return null;
  const name = call.peer.username;
  const theirCam = call.peerCamOn ? rtc?.remoteCam || null : null;
  const myCam = call.camOn ? rtc?.cam || null : null;
  const screen = call.peerSharing ? rtc?.remoteVideo || null : null;
  return (
    <div ref={box} className={\`cx-stage \${screen ? "with-screen" : ""}\`} role="dialog" aria-label={\`Call with \${name}\`}>
      <div className="cx-stage-top">
        <span className="cx-stage-dot" />
        <span className="cx-stage-name">{name}</span>
        <span className="cx-stage-time">{call.phase === "reconnecting" ? "Reconnecting…" : <Clock since={call.since} />}</span>
        <span className="cx-stage-hint">Press Esc to go back</span>
      </div>
      <div className="cx-stage-main">
        {screen && <div className="cx-stage-screen" aria-label={\`\${name}'s screen\`}><StageVideo stream={screen} rev={call.screenRev} contain /></div>}
        <div className="cx-tiles">
          <StageTile who="them" person={call.peer} stream={theirCam} rev={call.camRev} muted={call.peerMuted} sharing={!!screen} />
          <StageTile who="me" person={myself()} stream={myCam} rev={call.camRev} mirror muted={call.muted} sharing={!!call.sharing} />
        </div>
      </div>
      <div className="cx-stage-bar">
        <button type="button" className={\`cx-round mic \${call.muted ? "on" : ""}\`} onClick={callActions.toggleMute} aria-pressed={call.muted} title={call.muted ? "Unmute your microphone" : "Mute your microphone"} aria-label={call.muted ? "Unmute your microphone" : "Mute your microphone"}>{call.muted ? <IconMicOff /> : <IconMic />}</button>
        <button type="button" className={\`cx-round cam \${call.camOn ? "on" : ""}\`} disabled={!call.canCam || call.camStarting} aria-pressed={!!call.camOn}
          onClick={() => (call.camOn ? callActions.stopCamera() : callActions.startCamera())}
          title={!call.canCam ? "Camera needs both of you on the latest AURA" : call.camOn ? "Turn your camera off" : "Turn your camera on"}
          aria-label={!call.canCam ? "Camera isn't available on this call" : call.camOn ? "Turn your camera off" : "Turn your camera on"}><IconCam /></button>
        {call.sharing
          ? <button type="button" className="cx-round share on" onClick={() => { setPicker(false); callActions.stopScreen(); }} title="Stop sharing your screen" aria-label="Stop sharing your screen"><IconScreen /></button>
          : <button type="button" className={\`cx-round share \${picker ? "open" : ""}\`} data-cx-share disabled={!call.canShare} onClick={() => setPicker((v) => !v)} aria-expanded={picker}
              title={call.canShare ? "Share your screen" : "Screen share needs both of you on the latest AURA"} aria-label={call.canShare ? "Share your screen" : "Screen share isn't available on this call"}><IconScreen /></button>}
        <button type="button" className="cx-round end" onClick={callActions.hangUp} title="Hang up" aria-label="Hang up"><IconHangUp /></button>
        <button type="button" className="cx-round leave" onClick={callActions.closeStage} title="Back to the call box (Esc)" aria-label="Leave the call screen"><IconShrink /></button>
        {picker && !call.sharing && <ScreenPicker onClose={() => setPicker(false)} />}
      </div>
    </div>
  );
}
`;

const STAGE_CSS = `/* The call screen (${MARK}) */
.cx-round.stage.on{background:rgba(255,255,255,.16)}
#aura-call-layer:fullscreen{background:#0b0b0e}
.cx-stage{position:fixed;inset:0;z-index:9620;display:flex;flex-direction:column;background:radial-gradient(120% 90% at 50% 0%,color-mix(in srgb,var(--ac,#FF5722) 10%,#111116) 0%,#0b0b0e 70%);color:var(--t1,#fff);font-family:'DM Sans',sans-serif;--cx-me:0;--cx-peer:0}
.cx-stage *{box-sizing:border-box}
.cx-stage-top{display:flex;align-items:center;gap:10px;padding:16px 22px;flex-shrink:0}
.cx-stage-dot{width:9px;height:9px;border-radius:50%;background:#3ddc84;box-shadow:0 0 8px #3ddc84}
.cx-stage-name{font-family:'Rajdhani',sans-serif;font-size:20px;font-weight:700;letter-spacing:.4px}
.cx-stage-time{font-size:13px;color:#3ddc84;font-variant-numeric:tabular-nums}
.cx-stage-hint{margin-left:auto;font-size:12px;color:var(--t3,rgba(255,255,255,.45))}
.cx-stage-main{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;gap:16px;padding:0 22px}
.cx-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;width:100%;max-width:min(1600px,calc((100vh - 190px) * 32 / 9 + 16px))}
.cx-stage.with-screen .cx-tiles{grid-template-columns:1fr;width:min(320px,26vw);flex-shrink:0;max-width:none}
.cx-stage-screen{flex:1;min-width:0;height:100%;border-radius:16px;overflow:hidden;background:#000;border:1px solid rgba(255,255,255,.1)}
.cx-stage-screen video{width:100%;height:100%;display:block;background:#000}
.cx-tile{position:relative;aspect-ratio:16/9;border-radius:18px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#20202a,#131319);border:1px solid rgba(255,255,255,.08)}
.cx-tile.them{box-shadow:0 0 0 calc(var(--cx-peer) * 4px) rgba(61,220,132,.85)}
.cx-tile.me{box-shadow:0 0 0 calc(var(--cx-me) * 4px) rgba(61,220,132,.85)}
.cx-tile video{position:absolute;inset:0;width:100%;height:100%;background:#000}
.cx-tile .cx-face{box-shadow:0 0 0 calc(var(--cx-peer) * 10px) rgba(61,220,132,.8)}
.cx-tile.me .cx-face{box-shadow:0 0 0 calc(var(--cx-me) * 10px) rgba(61,220,132,.8)}
.cx-stage.with-screen .cx-tile .cx-face{width:72px!important;height:72px!important;font-size:30px!important}
.cx-tile-name{position:absolute;left:12px;bottom:12px;display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:rgba(0,0,0,.6);font-size:13px;font-weight:600}
.cx-tile-muted{display:inline-flex;color:#fca5a5}
.cx-tile-muted svg{width:14px;height:14px}
.cx-tile-sharing{color:#3ddc84;font-weight:500}
.cx-stage-bar{position:relative;display:flex;align-items:center;justify-content:center;gap:12px;padding:18px;flex-shrink:0}
.cx-stage-bar .cx-round{width:50px;height:50px}
.cx-stage-bar .cx-round svg{width:21px;height:21px}
.cx-stage-bar .cx-round.leave{margin-left:18px}
.cx-stage .cx-picker{top:auto;right:auto;bottom:84px;left:50%;transform:translateX(-50%)}
.cx-stage button:focus-visible{outline:2px solid var(--ac2,var(--ac,#ff8a65));outline-offset:2px}
:root:has(.cx-stage) .cx-bar,:root:has(.cx-stage) .cx-screen,:root:has(.cx-stage) .cx-screen-pill{display:none}
@media (max-width:760px){.cx-tiles{grid-template-columns:1fr}.cx-stage.with-screen .cx-stage-main{flex-direction:column}.cx-stage.with-screen .cx-tiles{width:100%;grid-template-columns:1fr 1fr}}
`;

function editCalls(text) {
  if (text.includes("function CallStage(")) {
    if (text.includes("function fullCallLayer(")) return { text, notes: [] };
    // Already installed: full screen is now asked for in the click itself
    let u = text;
    const swap = (a, b, what) => { u = swapOnce(u, a, b, what); };
    swap("  // Opening it fills the whole monitor (if Windows won't, it still fills AURA's window)\n  useEffect(() => {\n    if (!open) { setPicker(false); return; }\n    const el = box.current;\n    try { el?.requestFullscreen?.({ navigationUI: \"hide\" })?.catch?.(() => {}); } catch {}\n    let wasFull = false;\n    const changed = () => { if (document.fullscreenElement === el) wasFull = true; else if (wasFull) callActions.closeStage(); };", "  // It fills the whole monitor (asked for right at the click, see fullCallLayer); if Windows won't, it still fills AURA's window\n  useEffect(() => {\n    if (!open) { setPicker(false); return; }\n    const el = document.getElementById(\"aura-call-layer\");\n    let wasFull = !!el && document.fullscreenElement === el;\n    const changed = () => { if (document.fullscreenElement === el) wasFull = true; else if (wasFull) callActions.closeStage(); };", "the call screen's full screen");
    swap("function CallStage() {\n", "// Full screen has to be asked for in the click itself (a moment later, Windows and newer browsers say no),\n// so the call layer (which the call screen is drawn into) goes full screen as the button is pressed\nfunction fullCallLayer() {\n  const host = document.getElementById(\"aura-call-layer\");\n  try { if (host && document.fullscreenElement !== host) host.requestFullscreen?.({ navigationUI: \"hide\" })?.catch?.(() => {}); } catch {}\n}\nfunction CallStage() {\n", "the call screen");
    swap("onClick={() => { setDevices(false); setPicker(false); callActions.openStage(); }}", "onClick={() => { setDevices(false); setPicker(false); fullCallLayer(); callActions.openStage(); }}", "the call screen button");
    swap(".cx-stage{position:fixed;inset:0;", "#aura-call-layer:fullscreen{background:#0b0b0e}\n.cx-stage{position:fixed;inset:0;", "the call screen's look");
    return { text: u, notes: ["the call screen goes full screen right as you click (newer Windows and browsers need that)"] };
  }
  if (!text.includes("async startCamera()")) throw new Error("the camera in calls (run aura-call-camera-setup.cjs first)");
  let t = text;
  // Opening and closing it
  t = swapOnce(t, "  // Ends the call if it is with this person (used when you block them)\n",
    "  // The call screen (" + MARK + ")\n" +
    "  openStage() { const c = state.call; if (c && (c.phase === \"live\" || c.phase === \"reconnecting\")) patch({ stage: true }); },\n" +
    "  closeStage() { if (state.call?.stage) patch({ stage: false }); },\n\n" +
    "  // Ends the call if it is with this person (used when you block them)\n",
    "the call actions ( // Ends the call if it is with this person ... )");
  // The screen itself, after the call box's cameras
  t = swapOnce(t, "// The call bar: sits at the top of the window for as long as a call is ringing or going on\n",
    STAGE.trimStart() + "\n// The call bar: sits at the top of the window for as long as a call is ringing or going on\n",
    "the call bar ( // The call bar: sits at the top of the window ... )");
  // Its button, with the other call buttons
  t = swapOnce(t, "          <button type=\"button\" className=\"cx-round end\" onClick={callActions.hangUp} title=\"Hang up\" aria-label=\"Hang up\"><IconHangUp /></button>\n        </div>\n      )}\n      {active && <CallCams call={call} />}\n",
    "          <button type=\"button\" className=\"cx-round stage\" onClick={() => { setDevices(false); setPicker(false); fullCallLayer(); callActions.openStage(); }} title=\"Open the call screen\" aria-label=\"Open the call screen\"><IconExpand /></button>{/* (" + MARK + ") */}\n" +
    "          <button type=\"button\" className=\"cx-round end\" onClick={callActions.hangUp} title=\"Hang up\" aria-label=\"Hang up\"><IconHangUp /></button>\n        </div>\n      )}\n      {active && <CallCams call={call} />}\n",
    "the call box's Hang up button ( <button ... cx-round end ... {active && <CallCams ... )");
  t = swapOnce(t, "  root.render(<><CallBar /><ScreenView /></>);\n",
    "  root.render(<><CallBar /><ScreenView /><CallStage /></>); // (call screen: " + MARK + ")\n",
    "where the call box is put on the window ( root.render(<><CallBar /><ScreenView /></>); )");
  t = swapOnce(t, "/* Cameras in calls (Added by aura-call-camera-setup.cjs) */\n",
    STAGE_CSS + "/* Cameras in calls (Added by aura-call-camera-setup.cjs) */\n",
    "the camera look ( /* Cameras in calls ... */ )");
  return { text: t, notes: [
    "a call screen button in the call box, with the other call buttons",
    "it fills the monitor: their camera or profile picture, and yours, with green rings while you talk",
    "their shared screen shows big in the middle; mute, camera, share and hang up along the bottom",
  ] };
}

// The camera preview (Camera in the side menu): a full screen button
function editCamera(text) {
  if (text.includes("Show the camera full screen")) return { text, notes: [] };
  let t = text;
  t = swapOnce(t, "  const video = useRef(null);\n  const [, redraw] = useState(0);\n",
    "  const video = useRef(null);\n  const view = useRef(null); // (full screen: " + MARK + ")\n" +
    "  const fullOff = () => { if (document.fullscreenElement && document.fullscreenElement === view.current) document.exitFullscreen().catch(() => {}); };\n" +
    "  useEffect(() => { const esc = (e) => { if (e.key === \"Escape\") fullOff(); }; window.addEventListener(\"keydown\", esc); return () => { window.removeEventListener(\"keydown\", esc); fullOff(); }; }, []);\n" +
    "  const [, redraw] = useState(0);\n",
    "the camera preview ( const video = useRef(null); )");
  t = swapOnce(t, "        <button className=\"cam-btn\" title=\"Minimize\" aria-label=\"Minimize the camera\" onClick={() => setMinimized(true)}>–</button>\n",
    "        <button className=\"cam-btn\" title=\"Full screen (Esc to go back)\" aria-label=\"Show the camera full screen\" onClick={() => { try { view.current?.requestFullscreen?.({ navigationUI: \"hide\" })?.catch?.(() => {}); } catch {} }}>⛶</button>\n" +
    "        <button className=\"cam-btn\" title=\"Minimize\" aria-label=\"Minimize the camera\" onClick={() => setMinimized(true)}>–</button>\n",
    "the preview's Minimize button");
  t = swapOnce(t, "      <div className=\"cam-view\">\n", "      <div className=\"cam-view\" ref={view} onDoubleClick={() => { if (document.fullscreenElement === view.current) document.exitFullscreen().catch(() => {}); else try { view.current?.requestFullscreen?.()?.catch?.(() => {}); } catch {} }}>\n",
    "the preview's picture ( <div className=\"cam-view\"> )");
  t = swapOnce(t, "        <div className=\"cam-size\" onPointerDown={resize} title=\"Drag to resize\" aria-hidden=\"true\" />\n",
    "        <button className=\"cam-exit\" onClick={fullOff} aria-label=\"Exit full screen\">Exit full screen (Esc)</button>\n" +
    "        <div className=\"cam-size\" onPointerDown={resize} title=\"Drag to resize\" aria-hidden=\"true\" />\n",
    "the preview's resize corner");
  t = swapOnce(t, ".cam-view video{width:100%;height:100%;object-fit:cover;display:block;}\n",
    ".cam-view video{width:100%;height:100%;object-fit:cover;display:block;}\n" +
    ".cam-view:fullscreen{background:#000;}\n.cam-view:fullscreen video{object-fit:contain;}\n.cam-view:fullscreen .cam-size{display:none;}\n" +
    ".cam-exit{display:none;}\n.cam-view:fullscreen .cam-exit{display:block;position:absolute;top:18px;right:18px;padding:9px 16px;border:1px solid rgba(255,255,255,.25);border-radius:999px;background:rgba(0,0,0,.6);color:#fff;font:600 13px 'DM Sans',sans-serif;cursor:pointer;}\n.cam-view:fullscreen .cam-exit:hover{background:rgba(0,0,0,.85);}\n",
    "the preview's look ( .cam-view video{ ... } )");
  return { text: t, notes: ["the camera preview has a full screen button (or double-click it)"] };
}

// ── AURA's checks (only when they are installed) ─────────────────────────────
function editRunner(text) {
  if (/call-screen\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  let at = -1;
  for (let i = 0; i < lines.length; i++) if (/add\("window",/.test(lines[i])) at = i;
  if (at < 0) return { text, notes: ["(couldn't find where to add the check, so npm test doesn't include it)"] };
  lines.splice(at + 1, 0, 'if (fs.existsSync(path.join(__dirname, "call-screen.cjs"))) add("window", "The call screen", "call-screen.cjs");');
  return { text: lines.join("\n"), notes: ["npm test now checks the call screen too"] };
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
      } else if (entry.name === "call-screen.cjs") {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. The call screen is gone." : "Nothing to undo.");
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
    calls: findOne("your voice calls file", (t) => /function CallBar\s*\(/.test(t) && /export function mountCallLayer\s*\(/.test(t), need + " Voice calls need to be installed first.", [
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
  const cameraFile = path.join(path.dirname(files.calls), "camera.jsx");
  if (fs.existsSync(cameraFile) && fs.readFileSync(cameraFile, "utf8").includes("function CameraPanel(")) consider("camera file", cameraFile, editCamera, false);
  const runner = path.join(ROOT, "tests", "run.cjs");
  const hasChecks = fs.existsSync(runner);
  if (hasChecks) consider("checks", runner, editRunner, true);

  const created = [];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "call-screen.cjs"), content: FILES.test });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: the call screen");
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
  say("Done. Restart AURA (stop it in the terminal and start it again). In a call, the call screen button is next to Hang up.");
  if (hasChecks) say("Run  npm test  before your next release.");
  say("To undo later:  node aura-call-screen-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
