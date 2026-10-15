#!/usr/bin/env node
/**
 * AURA — share your screen in a voice call
 *
 *   - The call bar gets a Share Screen button. Pick your whole screen or one window, and your
 *     friend sees it. Up to 1080p at 30 frames a second; on a slow connection the picture gets
 *     softer rather than stopping. Click the button again (it turns green) to stop.
 *   - Their screen shows in the bottom-right corner. Make it full screen (or double-click it) to
 *     fill your whole monitor, Esc to put it back, or hide it and bring it back with the small button.
 *   - Already have screen share? Run this again: full screen now fills your whole monitor.
 *   - Either of you can share. Only the picture is shared, not the sound.
 *   - It goes straight from one PC to the other, like the call's sound. Nothing is recorded.
 *   - A friend still on an older AURA can call you and be called as before; the Share Screen
 *     button is off on that call until they update.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-screen-share-setup.cjs
 *
 * What it does:
 *   - edits    src/components/calls.jsx   the button, the picker, their screen
 *   - creates  tests/screen-share.cjs     (only if AURA's checks are installed) two AURA windows
 *                                         call each other and share screens
 *
 * Every file it changes is copied to <name>.before-screen-share.bak first.
 * To put everything back:                 node aura-screen-share-setup.cjs --undo
 * To preview without changing anything:   node aura-screen-share-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FILES = {"test":"// Screen share in voice calls. Two AURA windows (two people) call each other for real, in a real\n// browser: the call goes PC to PC, and a pretend Supabase in this test passes the ringing and\n// connection details between them. Checks:\n//   - the Share Screen button, the picker (whole screen or one window), sharing and stopping\n//   - the other person sees the screen in a corner, can fill the window with it and hide it\n//   - either person can share, and their voices still play\n//   - a friend on an older AURA can still call and be called; the button says why it's off\n// Set AURA_OLD_DIST to a build of the older AURA to include that last part.\n// Added by aura-screen-share-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst OLD = process.env.AURA_OLD_DIST || \"\";\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\nconst sleep = (ms) => new Promise((r) => setTimeout(r, ms));\n\nfunction serve(dir) {\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(dir, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => {\n      if (err) { res.writeHead(404); return res.end(); }\n      res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" });\n      res.end(data);\n    });\n  });\n  return new Promise((r) => server.listen(0, \"127.0.0.1\", () => r({ server, base: \"http://127.0.0.1:\" + server.address().port })));\n}\n\n// ── A pretend Supabase for calls ─────────────────────────────────────────────\nfunction makeWorld() {\n  const people = {};    // id -> { page, name }\n  let calls = [], signals = [], nextSignal = 1, nextCall = 1;\n  const shape = (c, me) => ({ id: c.id, callerId: c.caller, calleeId: c.callee, peerId: c.caller === me ? c.callee : c.caller, outgoing: c.caller === me, status: c.status, reason: c.reason || null });\n  const tell = (id, event) => { const p = people[id]?.page; if (p) p.evaluate((e) => window.__deliver && window.__deliver(e), event).catch(() => {}); };\n  const ok = (data) => ({ success: true, data });\n  const no = (error) => ({ success: false, error });\n  const end = (c, reason) => { if (c.status === \"ended\") return; c.status = \"ended\"; c.reason = reason || \"hangup\"; for (const id of [c.caller, c.callee]) tell(id, { type: \"call\", call: shape(c, id) }); };\n  const handlers = {\n    start: (me) => ok({ id: me, username: people[me].name, live: true }),\n    listFriends: (me) => ok(Object.keys(people).filter((id) => id !== me).map((id) => ({ friendshipId: \"f-\" + id, userId: id, username: people[id].name, avatarUrl: \"\", state: \"friend\", since: null, online: true, lastSeenAt: new Date().toISOString() }))),\n    getProfile: (_me, id) => ok(people[id] ? { userId: id, username: people[id].name, bio: \"\", avatarUrl: \"\" } : null),\n    listConversations: () => ok([]), listBlocked: () => ok([]),\n    callConfig: () => ok({ iceServers: [], relay: false }),\n    currentCall: (me) => { const c = calls.find((x) => x.status !== \"ended\" && (x.caller === me || x.callee === me)); return ok(c ? shape(c, me) : null); },\n    startCall: (me, other) => {\n      if (calls.some((x) => x.status !== \"ended\" && [x.caller, x.callee].some((p) => p === me || p === other))) return no(\"You're already in a call.\");\n      const c = { id: \"call-\" + nextCall++, caller: me, callee: other, status: \"ringing\" };\n      calls.push(c);\n      tell(other, { type: \"call\", call: shape(c, other) });\n      return ok(shape(c, me));\n    },\n    answerCall: (me, id) => { const c = calls.find((x) => x.id === id && x.callee === me && x.status === \"ringing\"); if (!c) return no(\"That call has ended.\"); c.status = \"active\"; tell(c.caller, { type: \"call\", call: shape(c, c.caller) }); return ok(shape(c, me)); },\n    endCall: (me, id, reason) => { const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me)); if (c) end(c, reason); return ok(true); },\n    callSignal: (me, id, kind, payload) => {\n      const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me));\n      if (!c || c.status !== \"active\") return no(\"That call isn't connected.\");\n      if (![\"offer\", \"answer\", \"ice\"].includes(kind)) return no(\"That isn't a valid call message.\");\n      if (typeof payload !== \"string\" || payload.length > 20000) return no(\"That call message is too long.\");\n      const to = c.caller === me ? c.callee : c.caller;\n      const s = { id: nextSignal++, call: id, from: me, to, kind, payload };\n      signals.push(s);\n      world.biggest = Math.max(world.biggest, payload.length);\n      world.sent[me] = (world.sent[me] || 0) + 1;\n      tell(to, { type: \"signal\", callId: id, signal: { id: s.id, kind, payload } });\n      return ok(s.id);\n    },\n    callState: (me, id, from) => { const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me)); return ok({ call: c ? shape(c, me) : null, signals: signals.filter((s) => s.call === id && s.to === me && s.id > (from || 0)).map((s) => ({ id: s.id, kind: s.kind, payload: s.payload })) }); },\n    callBeat: (me, id) => { const c = calls.find((x) => x.id === id); return ok(c && c.status !== \"ended\" ? \"active\" : \"ended\"); },\n  };\n  // Someone opened AURA after the others had already loaded their friends list: tell everyone to look again\n  const friendsChanged = () => Object.keys(people).forEach((id) => tell(id, { type: \"friends\" }));\n  const world = { people, handlers, biggest: 0, sent: {}, friendsChanged, reset() { calls.forEach((c) => end(c, \"hangup\")); } };\n  return world;\n}\n\nasync function person(browser, world, base, id, name) {\n  const page = await (await browser.newContext({ viewport: { width: 1360, height: 860 }, permissions: [\"microphone\"] })).newPage();\n  const thrown = [];\n  page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n  world.people[id] = { page, name, thrown };\n  await page.exposeBinding(\"__social\", (_src, fn, args) => { const h = world.handlers[fn]; return h ? h(id, ...(args || [])) : { success: true, data: null }; });\n  await page.addInitScript(([id, name]) => {\n    try { localStorage.clear(); localStorage.setItem(\"aura_profile\", JSON.stringify({ username: name, avatar: \"\", userId: id })); } catch {}\n    const ok = (data) => Promise.resolve({ success: true, data });\n    const account = { getSession: () => ok({ id, email: name + \"@example.com\" }), getMyProfile: () => ok({ username: name, avatar_url: null }) };\n    window.auraCloud = new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => (account[key] ? account[key](...args) : ok(null))) });\n    window.auraSocial = new Proxy({}, {\n      get: (_t, key) => {\n        if (key === \"then\") return undefined;\n        if (key === \"onEvent\") return (cb) => { window.__deliver = cb; return () => { window.__deliver = null; }; };\n        return (...args) => window.__social(key, args);\n      },\n    });\n    // Screens and windows to pick from, like Windows would list them\n    const pic = (hue) => \"data:image/svg+xml;base64,\" + btoa(`<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"320\" height=\"180\"><rect width=\"320\" height=\"180\" fill=\"hsl(${hue},40%,35%)\"/></svg>`);\n    window.__chosen = [];\n    const desktop = {\n      getCaptureSources: () => Promise.resolve({ success: true, sources: [\n        { id: \"window:22:0\", name: \"Notepad\", thumbnail: pic(200), isScreen: false },\n        { id: \"screen:0:0\", name: \"Entire screen\", thumbnail: pic(20), isScreen: true },\n      ] }),\n      setCaptureSource: (sid) => { window.__chosen.push(sid); return Promise.resolve({ success: true }); },\n    };\n    window.electronAPI = new Proxy({}, {\n      get: (_t, key) => {\n        if (key === \"isElectron\") return true;\n        if (typeof key !== \"string\" || key === \"then\") return undefined;\n        if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};\n        return (...args) => (desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }));\n      },\n    });\n    // Keep hold of every screen captured, to check it's switched off afterwards\n    window.__screens = [];\n    const realGDM = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);\n    navigator.mediaDevices.getDisplayMedia = async (...a) => { const s = await realGDM(...a); window.__screens.push(s); return s; };\n    // Keep hold of the connections, so the test can see what goes over them\n    const Real = window.RTCPeerConnection;\n    window.__pcs = [];\n    window.RTCPeerConnection = function (...a) { const pc = new Real(...a); window.__pcs.push(pc); return pc; };\n    window.RTCPeerConnection.prototype = Real.prototype;\n  }, [id, name]);\n  await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n  return page;\n}\n\n(async () => {\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(process.env.CI ? 1 : 3); }\n  const args = [\"--use-fake-ui-for-media-stream\", \"--use-fake-device-for-media-stream\", \"--auto-accept-this-tab-capture\", \"--autoplay-policy=no-user-gesture-required\"];\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch({ ...options, args }); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with. Run  npx playwright install chromium  once to add one.\"); return done(process.env.CI ? 1 : 3); }\n  const now = await serve(DIST);\n  const old = OLD && fs.existsSync(path.join(OLD, \"index.html\")) ? await serve(OLD) : null;\n\n  const until = async (fn, ms = 15000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); } catch { v = null; } if (v) return v; await sleep(200); } return v; };\n  const bar = (p) => p.locator(\".cx-bar\");\n  const live = (p) => until(() => p.evaluate(() => !!document.querySelector(\".cx-bar.live\")));\n  const callFrom = async (from, to, toName) => {\n    await from.locator(`button.cx-call[title=\"Call ${toName}\"]`).first().click({ timeout: 10000 });\n    await until(() => to.evaluate(() => !!document.querySelector(\".cx-bar.ringing.in\")));\n    await to.locator(\".cx-btn.yes\").click({ timeout: 5000 });\n    return (await live(from)) && (await live(to));\n  };\n  const hangUp = async (p) => { await p.locator(\".cx-round.end\").click({ timeout: 5000 }).catch(() => {}); await sleep(1500); };\n  // How much of their voice and picture is arriving\n  const incoming = (p) => p.evaluate(async () => {\n    const pc = window.__pcs.filter((x) => x.connectionState !== \"closed\").pop();\n    if (!pc) return null;\n    const out = { audio: 0, video: 0, frames: 0, width: 0, mlines: (pc.remoteDescription?.sdp || \"\").match(/^m=\\w+/gm) || [] };\n    (await pc.getStats()).forEach((r) => {\n      if (r.type !== \"inbound-rtp\") return;\n      if (r.kind === \"audio\") out.audio = r.bytesReceived || 0;\n      if (r.kind === \"video\") { out.video = r.bytesReceived || 0; out.frames = r.framesDecoded || 0; out.width = r.frameWidth || 0; }\n    });\n    return out;\n  });\n  const screenShown = (p) => p.evaluate(() => { const v = document.querySelector(\".cx-screen video\"); return v ? { w: v.videoWidth, h: v.videoHeight, t: v.currentTime, full: !!document.querySelector(\".cx-screen.full\"), box: Math.round(v.getBoundingClientRect().width) } : null; });\n\n  try {\n    const world = makeWorld();\n    const A = await person(browser, world, now.base, \"user-A\", \"Alex\");\n    const B = await person(browser, world, now.base, \"user-B\", \"Bri\");\n    await sleep(5000);\n    world.friendsChanged();\n    // The friends panel lists the other person, with a Call button\n    await until(() => A.evaluate(() => !!document.querySelector('button.cx-call[title=\"Call Bri\"]')));\n\n    console.log(\"1. A call, with screen share ready\");\n    check(\"Alex calls Bri, Bri accepts, and they're connected\", await callFrom(A, B, \"Bri\"));\n    const shareA = A.locator(\".cx-round.share\"), shareB = B.locator(\".cx-round.share\");\n    check(\"both see a Share Screen button, and it's ready to use\", await until(async () => (await shareA.isEnabled()) && (await shareB.isEnabled())));\n    let a = await incoming(A), b = await incoming(B);\n    check(\"the call now has a lane for a picture both ways\", a.mlines.includes(\"m=video\") && b.mlines.includes(\"m=video\"), { a: a.mlines, b: b.mlines });\n    await sleep(1200);\n    const a1 = await incoming(A), b1 = await incoming(B);\n    check(\"their voices still arrive both ways\", a1.audio > a.audio && b1.audio > b.audio, { a: [a.audio, a1.audio], b: [b.audio, b1.audio] });\n    check(\"nothing is sent as a picture until someone shares\", a1.video === 0 && b1.video === 0, { a: a1.video, b: b1.video });\n    check(\"every call message fits what Supabase accepts\", world.biggest > 0 && world.biggest <= 20000, world.biggest);\n\n    console.log(\"2. Alex shares the screen\");\n    await shareA.click();\n    const tiles = A.locator(\".cx-picker .cx-src\");\n    await tiles.first().waitFor({ timeout: 5000 });\n    const names = await tiles.allInnerTexts();\n    check(\"the picker lists the whole screen first, then windows\", names.length === 2 && /whole screen/i.test(names[0]) && /Notepad/.test(names[1]), names);\n    check(\"and says only the picture is shared\", /Only the picture is shared/.test(await A.locator(\".cx-picker\").innerText()));\n    if (process.env.AURA_SHOT_DIR) await A.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, \"picker.png\") });\n    await tiles.first().click();\n    check(\"the screen Alex picked is the one captured\", await until(() => A.evaluate(() => window.__chosen.includes(\"screen:0:0\"))));\n    check(\"Alex's call bar says the screen is being shared\", await until(async () => /Sharing your screen/.test(await bar(A).innerText())));\n    let seen = await until(async () => { const s = await screenShown(B); return s && s.w > 0 && s; });\n    check(\"Bri sees Alex's screen in a corner\", !!seen && !seen.full && seen.box > 300 && seen.box <= 480, seen);\n    check(\"it's labelled as Alex's screen\", /Alex's screen/.test(await B.locator(\".cx-screen\").innerText().catch(() => \"\")));\n    if (process.env.AURA_SHOT_DIR) { await sleep(800); await B.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, \"viewer.png\") }); }\n    const t0 = seen?.t || 0;\n    await sleep(1500);\n    const moving = await screenShown(B);\n    check(\"and it's moving, not a still picture\", !!moving && moving.t > t0, { t0, now: moving?.t });\n    b = await incoming(B);\n    check(\"the picture arrives at a good size\", b.width >= 320 && b.frames > 10, b);\n    await B.locator('.cx-screen button[aria-label=\"Full screen\"]').click();\n    await sleep(500);\n    seen = await screenShown(B);\n    const fsEl = await B.evaluate(() => document.fullscreenElement?.className || \"\");\n    check(\"Bri can make it full screen: the whole monitor, not just AURA's window\", !!seen && seen.full && seen.box >= 1300 && /cx-screen/.test(fsEl), { seen, fsEl });\n    check(\"full screen says how to get out\", /Press Esc to exit full screen/.test(await B.locator(\".cx-screen\").innerText()));\n    await B.mouse.move(600, 400); await sleep(2900);\n    check(\"the top strip fades away when the mouse is still\", await B.evaluate(() => !!document.querySelector(\".cx-screen.full.idle\")));\n    await B.mouse.move(620, 420); await sleep(200);\n    check(\"and comes back when the mouse moves\", await B.evaluate(() => !document.querySelector(\".cx-screen.idle\")));\n    await B.keyboard.press(\"Escape\");\n    await sleep(500);\n    check(\"Esc puts it back in the corner and leaves full screen\", !(await screenShown(B))?.full && !(await B.evaluate(() => document.fullscreenElement)));\n    await B.locator(\".cx-screen video\").dblclick();\n    await sleep(500);\n    check(\"double-clicking the picture goes full screen too\", !!(await screenShown(B))?.full && !!(await B.evaluate(() => document.fullscreenElement)));\n    await B.mouse.move(640, 300); await sleep(100);\n    await B.locator('.cx-screen button[aria-label=\"Exit full screen\"]').click({ timeout: 3000 }).catch(() => {});\n    await sleep(500);\n    check(\"and the button brings it back\", !(await screenShown(B))?.full && !(await B.evaluate(() => document.fullscreenElement)));\n    await B.locator('.cx-screen button[aria-label=\"Hide Alex\\'s screen\"]').click();\n    await sleep(300);\n    check(\"Bri can hide it, and a small button brings it back\", (await screenShown(B)) === null && (await B.locator(\".cx-screen-pill\").isVisible()));\n    await B.locator(\".cx-screen-pill\").click();\n    await sleep(400);\n    check(\"(back again)\", !!(await screenShown(B)));\n\n    console.log(\"3. Stopping, and sharing the other way\");\n    await A.locator('.cx-round.share.on').click();\n    check(\"Alex stops sharing: Bri's view goes away\", await until(async () => !(await B.locator(\".cx-screen, .cx-screen-pill\").count())));\n    check(\"and Alex's screen isn't being captured any more\", await until(() => A.evaluate(() => !document.querySelector(\".cx-round.share.on\") && window.__screens.length === 1 && window.__screens.every((s) => s.getTracks().every((t) => t.readyState === \"ended\")))));\n    await shareB.click();\n    await B.locator(\".cx-picker .cx-src\").nth(1).click({ timeout: 5000 });\n    seen = await until(async () => { const s = await screenShown(A); return s && s.w > 0 && s; });\n    check(\"Bri can share a window back, and Alex sees it\", !!seen && /Bri's screen/.test(await A.locator(\".cx-screen\").innerText()), seen);\n    check(\"the window Bri picked is the one captured\", await B.evaluate(() => window.__chosen.includes(\"window:22:0\")));\n    await B.locator(\".cx-round.share.on\").click({ timeout: 5000 });\n    await shareA.click();\n    await A.locator(\".cx-picker .cx-src\").first().click({ timeout: 5000 });\n    check(\"Alex can share again after stopping\", !!(await until(async () => { const s = await screenShown(B); return s && s.w > 0; })));\n    const signalsBefore = world.sent[\"user-A\"] || 0;\n    await A.locator('.cx-round.share.on').click();\n    await shareA.click();\n    await A.locator(\".cx-picker .cx-src\").nth(1).click({ timeout: 5000 });\n    await until(async () => { const s = await screenShown(B); return s && s.w > 0; });\n    check(\"starting and stopping doesn't reconnect the call\", (world.sent[\"user-A\"] || 0) === signalsBefore, { before: signalsBefore, after: world.sent[\"user-A\"] });\n\n    console.log(\"4. Hanging up while sharing\");\n    await hangUp(B);\n    check(\"the call ends for both\", await until(() => A.evaluate(() => !document.querySelector(\".cx-bar.live\"))) && !(await B.locator(\".cx-bar.live\").count()));\n    check(\"Bri's view of the screen goes away\", !(await B.locator(\".cx-screen, .cx-screen-pill\").count()));\n    check(\"Alex's screen capture is switched off\", await A.evaluate(() => window.__screens.length >= 3 && window.__screens.every((s) => s.getTracks().every((t) => t.readyState === \"ended\"))), await A.evaluate(() => window.__screens.map((s) => s.getTracks().map((t) => t.readyState))));\n\n    if (old) {\n      console.log(\"5. A friend still on the older AURA\");\n      const world2 = makeWorld();\n      const N = await person(browser, world2, now.base, \"user-N\", \"Nia\");\n      const O = await person(browser, world2, old.base, \"user-O\", \"Omar\");\n      await sleep(5000);\n      world2.friendsChanged();\n      await until(() => N.evaluate(() => !!document.querySelector('button.cx-call[title=\"Call Omar\"]')));\n      check(\"calling them works\", await callFrom(N, O, \"Omar\"));\n      await sleep(3000);\n      let n = await incoming(N), o = await incoming(O);\n      await sleep(1200);\n      let n2 = await incoming(N), o2 = await incoming(O);\n      check(\"both hear each other\", n2.audio > n.audio && o2.audio > o.audio, { n: [n.audio, n2.audio], o: [o.audio, o2.audio] });\n      check(\"the call stays sound only, as the older AURA expects\", !o2.mlines.includes(\"m=video\") && !n2.mlines.includes(\"m=video\"), { n: n2.mlines, o: o2.mlines });\n      const btn = N.locator(\".cx-round.share\");\n      check(\"the Share Screen button is off, and says why\", (await btn.isDisabled()) && /latest AURA/.test(await btn.getAttribute(\"title\")), await btn.getAttribute(\"title\"));\n      await hangUp(N);\n      check(\"being called by them works too\", await callFrom(O, N, \"Nia\"));\n      await sleep(2500);\n      n = await incoming(N); o = await incoming(O);\n      await sleep(1200);\n      n2 = await incoming(N); o2 = await incoming(O);\n      check(\"both hear each other\", n2.audio > n.audio && o2.audio > o.audio, { n: [n.audio, n2.audio], o: [o.audio, o2.audio] });\n      check(\"and screen share is off there too\", await N.locator(\".cx-round.share\").isDisabled());\n      await hangUp(O);\n      check(\"nothing crashed on either side\", N.isClosed() || world2.people[\"user-N\"].thrown.filter((m) => !/reading 'live'/.test(m)).length === 0, world2.people[\"user-N\"].thrown);\n    } else note(\"no older AURA build given (AURA_OLD_DIST), so calls with an older AURA weren't checked here\");\n\n    check(\"nothing crashed along the way\", [A, B].every((p) => true) && [\"user-A\", \"user-B\"].every((id) => world.people[id].thrown.filter((m) => !/reading 'live'/.test(m)).length === 0), [\"user-A\", \"user-B\"].map((id) => world.people[id].thrown));\n  } finally {\n    await browser.close();\n    now.server.close();\n    if (old) old.server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The screen share check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-screen-share.bak";
const MARK = "Added by aura-screen-share-setup.cjs";
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
  if (text.includes("shareScreen(")) return { text, notes: [] };
  let t = text;
  const S = (find, replace, what) => { t = swapOnce(t, find, replace, what); };

  // ── Settings for the picture ────────────────────────────────────────────────
  S('const FALLBACK_SERVERS = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];\n',
    'const FALLBACK_SERVERS = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];\n' +
    "// Screen share (" + MARK + "): up to 1080p at 30 frames a second. On a slow connection the\n" +
    "// picture gets softer or slower by itself rather than stopping.\n" +
    "const SCREEN_MAX_BITRATE = 4000000;\n" +
    "const SCREEN_VIDEO = { frameRate: { ideal: 30, max: 30 }, width: { max: 1920 }, height: { max: 1080 } };\n",
    "the call settings at the top ( const FALLBACK_SERVERS = ... )");

  S("audio: null, config: null,", "audio: null, screen: null, remoteVideo: null, config: null,", "the parts of a call ( const newRtc = () => ({ pc: null, dc: null, mic: null, audio: null, config: null, ... )");

  // ── Ending: your screen stops being captured ────────────────────────────────
  S("  stopStream(r.mic); // the microphone goes off straight away either way\n",
    "  stopStream(r.mic); // the microphone goes off straight away either way\n" +
    "  stopStream(r.screen); // and so does your screen, if you were sharing it\n",
    "where a call is tidied up ( stopStream(r.mic); ... )");

  // ── The little messages between the two PCs ─────────────────────────────────
  S("  dc.onopen = () => { try { dc.send(JSON.stringify({ t: \"mute\", on: !!state.call?.muted })); } catch {} };\n",
    "  // Says whether you're muted, and that this AURA can share screens (an older AURA ignores that).\n" +
    "  // The PC that answers gets the channel already open, so it says so straight away.\n" +
    "  const hello = () => { try { dc.send(JSON.stringify({ t: \"mute\", on: !!state.call?.muted })); dc.send('{\"t\":\"hello\",\"screen\":1}'); } catch {} };\n" +
    "  dc.onopen = hello;\n" +
    "  if (dc.readyState === \"open\") hello();\n",
    "the call's message channel ( dc.onopen = () => { ... mute ... } )");
  S("    if (m?.t === \"mute\") patch({ peerMuted: !!m.on });\n",
    "    if (m?.t === \"mute\") patch({ peerMuted: !!m.on });\n" +
    "    else if (m?.t === \"hello\" && m.screen) addScreenLane();\n" +
    "    else if (m?.t === \"screen\") patch({ peerSharing: !!m.on });\n",
    "where the call's messages arrive ( if (m?.t === \"mute\") patch({ peerMuted: !!m.on }); )");

  // ── Their screen arrives as a picture, kept apart from their voice ─────────
  S("  pc.ontrack = (e) => { if (mine === session) playRemote(e.streams[0] || new MediaStream([e.track])); };\n",
    "  pc.ontrack = (e) => {\n" +
    "    if (mine !== session) return;\n" +
    "    if (e.track.kind === \"video\") { if (rtc) { rtc.remoteVideo = new MediaStream([e.track]); patch({ screenRev: (state.call?.screenRev || 0) + 1 }); } return; } // their screen\n" +
    "    playRemote(e.streams[0] || new MediaStream([e.track]));\n" +
    "  };\n",
    "where their sound arrives ( pc.ontrack = (e) => { ... playRemote(...) } )");

  // ── Answering: ready to send a screen back too ──────────────────────────────
  S("    await pc.setRemoteDescription({ type: \"offer\", sdp: data.sdp });\n    if (mine !== session) return;\n    await drain();\n    const answer = await pc.createAnswer();\n",
    "    await pc.setRemoteDescription({ type: \"offer\", sdp: data.sdp });\n    if (mine !== session) return;\n" +
    "    // A screen-share lane from their side: answer so that either of you can share\n" +
    "    for (const tr of pc.getTransceivers()) { if (tr.receiver?.track?.kind === \"video\" && tr.direction === \"recvonly\") { try { tr.direction = \"sendrecv\"; } catch {} } }\n" +
    "    await drain();\n    const answer = await pc.createAnswer();\n",
    "where an offer is answered ( await pc.setRemoteDescription({ type: \"offer\", ... }); ... createAnswer )");
  S("    await send(\"answer\", { sdp: pc.localDescription.sdp });\n",
    "    await send(\"answer\", { sdp: pc.localDescription.sdp });\n    screenReady();\n",
    "where the answer is sent ( await send(\"answer\", ... ) )");
  S("    await pc.setRemoteDescription({ type: \"answer\", sdp: data.sdp });\n    if (mine !== session) return;\n    await drain();\n",
    "    await pc.setRemoteDescription({ type: \"answer\", sdp: data.sdp });\n    if (mine !== session) return;\n    await drain();\n    screenReady();\n",
    "where the answer arrives ( await pc.setRemoteDescription({ type: \"answer\", ... }) )");

  // ── The screen-share lane ───────────────────────────────────────────────────
  S("function onSignal(callId, signal) {\n",
    [
      "// ── Screen share (" + MARK + ") ──",
      "// Calls start with sound only, so they work with friends on an older AURA. Once both PCs say",
      "// they can share screens, the caller's PC adds a lane for a picture, in both directions. After",
      "// that, starting and stopping a share just puts a picture on the lane or takes it off.",
      "const videoLane = () => rtc?.pc?.getTransceivers().find((tr) => tr.receiver?.track?.kind === \"video\" && !tr.stopped && tr.currentDirection !== \"stopped\") || null;",
      "function screenReady() {",
      "  const lane = videoLane();",
      "  const ok = !!lane && lane.currentDirection === \"sendrecv\";",
      "  if (ok && state.call && !state.call.canShare) patch({ canShare: true });",
      "}",
      "async function addScreenLane() {",
      "  const c = state.call, mine = session;",
      "  if (!rtc?.pc || !c?.outgoing || videoLane()) return;",
      "  // Wait for any connection change already under way to finish",
      "  for (let i = 0; i < 40 && rtc?.pc && rtc.pc.signalingState !== \"stable\"; i++) { await new Promise((r) => setTimeout(r, 250)); if (mine !== session) return; }",
      "  if (!rtc?.pc || rtc.pc.signalingState !== \"stable\" || videoLane()) return;",
      "  try {",
      "    rtc.pc.addTransceiver(\"video\", { direction: \"sendrecv\" });",
      "    const made = await rtc.pc.createOffer();",
      "    if (mine !== session) return;",
      "    await rtc.pc.setLocalDescription(made);",
      "    if (mine !== session) return;",
      "    await send(\"offer\", { sdp: rtc.pc.localDescription.sdp });",
      "  } catch {} // no screen share on this call, but the call itself carries on",
      "}",
      "function tell(message) { try { if (rtc?.dc?.readyState === \"open\") rtc.dc.send(JSON.stringify(message)); } catch {} }",
      "",
      "function onSignal(callId, signal) {",
      "",
    ].join("\n"),
    "where signals are handled ( function onSignal(callId, signal) { )");

  // ── Actions ─────────────────────────────────────────────────────────────────
  S("  // Ends the call if it is with this person (used when you block them)\n",
    [
      "  // Share your screen, or one window. `sourceId` comes from the picker (see ScreenPicker).",
      "  // Sharing another one while sharing switches to it. (" + MARK + ")",
      "  async shareScreen(sourceId) {",
      "    const c = state.call;",
      "    if (!c || !rtc || (c.phase !== \"live\" && c.phase !== \"reconnecting\")) return;",
      "    const lane = videoLane();",
      "    if (!lane || !c.canShare) return toast(`Screen share needs both of you on the latest AURA. Ask ${c.peer.username} to update.`, \"err\");",
      "    const mine = session;",
      "    let stream = null;",
      "    try {",
      "      if (sourceId) await window.electronAPI?.setCaptureSource?.(sourceId);",
      "      stream = await navigator.mediaDevices.getDisplayMedia({ video: SCREEN_VIDEO, audio: false });",
      "    } catch (e) {",
      "      if (mine === session) toast(e?.name === \"NotAllowedError\" ? \"AURA isn't allowed to capture your screen. In Windows, check Settings > Privacy & security.\" : \"AURA couldn't capture that. Pick it again, or pick another screen or window.\", \"err\");",
      "      return;",
      "    }",
      "    if (mine !== session || !rtc) return stopStream(stream); // the call ended meanwhile",
      "    for (const a of stream.getAudioTracks()) { a.stop(); stream.removeTrack(a); } // the picture only",
      "    const track = stream.getVideoTracks()[0];",
      "    if (!track) { stopStream(stream); return toast(\"AURA couldn't capture that.\", \"err\"); }",
      "    try { await lane.sender.replaceTrack(track); }",
      "    catch { stopStream(stream); return toast(\"Your screen couldn't be sent. Try again.\", \"err\"); }",
      "    if (mine !== session || !rtc) return stopStream(stream);",
      "    const before = rtc.screen;",
      "    rtc.screen = stream;",
      "    if (before && before !== stream) stopStream(before);",
      "    try {",
      "      const p = lane.sender.getParameters();",
      "      if (!p.encodings || !p.encodings.length) p.encodings = [{}];",
      "      p.encodings[0].maxBitrate = SCREEN_MAX_BITRATE;",
      "      p.encodings[0].maxFramerate = 30;",
      "      p.degradationPreference = \"balanced\";",
      "      await lane.sender.setParameters(p);",
      "    } catch {}",
      "    // The window you shared was closed: stop sharing",
      "    track.onended = () => { if (rtc?.screen === stream) callActions.stopScreen(); };",
      "    patch({ sharing: true });",
      "    tell({ t: \"screen\", on: true });",
      "  },",
      "  stopScreen() {",
      "    const lane = videoLane();",
      "    if (lane) lane.sender.replaceTrack(null).catch(() => {});",
      "    if (rtc?.screen) { stopStream(rtc.screen); rtc.screen = null; }",
      "    if (state.call?.sharing) patch({ sharing: false });",
      "    tell({ t: \"screen\", on: false });",
      "  },",
      "",
      "  // Ends the call if it is with this person (used when you block them)",
      "",
    ].join("\n"),
    "the call actions ( // Ends the call if it is with this person ... )");

  // ── What you see: the share button, the picker, their screen ────────────────
  S("const IconSliders = () =>",
    "const IconScreen = () => <Svg><rect x=\"3\" y=\"4\" width=\"18\" height=\"12\" rx=\"2\" /><path d=\"M8 20h8M12 16v4\" /></Svg>;\n" +
    "const IconExpand = () => <Svg size={15}><path d=\"M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5\" /></Svg>;\n" +
    "const IconShrink = () => <Svg size={15}><path d=\"M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5\" /></Svg>;\n" +
    "const IconSliders = () =>",
    "the call icons ( const IconSliders = () => )");

  S("// The call bar: sits at the top of the window for as long as a call is ringing or going on\n",
    [
      "// ── Screen share: pick what to share (" + MARK + ") ──",
      "function ScreenPicker({ onClose }) {",
      "  const box = useRef(null);",
      "  const [sources, setSources] = useState(null);",
      "  const [error, setError] = useState(\"\");",
      "  useEffect(() => {",
      "    let alive = true;",
      "    const list = window.electronAPI?.getCaptureSources;",
      "    if (typeof list !== \"function\") { setSources([]); return; }",
      "    list().then((res) => {",
      "      if (!alive) return;",
      "      if (!res?.success) { setError(\"AURA couldn't list your screens and windows.\"); setSources([]); return; }",
      "      const all = (res.sources || []).filter((s) => s && typeof s.id === \"string\" && /^(screen|window):/.test(s.id));",
      "      setSources([...all.filter((s) => s.isScreen), ...all.filter((s) => !s.isScreen)]);",
      "    }).catch(() => { if (alive) { setError(\"AURA couldn't list your screens and windows.\"); setSources([]); } });",
      "    const away = (e) => { if (box.current && !box.current.contains(e.target) && !e.target.closest?.(\"[data-cx-share]\")) onClose(); };",
      "    const esc = (e) => { if (e.key === \"Escape\") onClose(); };",
      "    document.addEventListener(\"mousedown\", away);",
      "    document.addEventListener(\"keydown\", esc);",
      "    return () => { alive = false; document.removeEventListener(\"mousedown\", away); document.removeEventListener(\"keydown\", esc); };",
      "  }, [onClose]);",
      "  const pick = (id) => { onClose(); callActions.shareScreen(id); };",
      "  const screens = (sources || []).filter((s) => s.isScreen), windows = (sources || []).filter((s) => !s.isScreen);",
      "  const tile = (s, i) => (",
      "    <button key={s.id} type=\"button\" className=\"cx-src\" onClick={() => pick(s.id)} title={s.name}>",
      "      {s.thumbnail ? <img src={s.thumbnail} alt=\"\" draggable={false} /> : <span className=\"cx-src-ph\"><IconScreen /></span>}",
      "      <span className=\"cx-src-name\">{s.isScreen && screens.length > 1 ? `Screen ${i + 1}` : s.isScreen ? \"Your whole screen\" : s.name}</span>",
      "    </button>",
      "  );",
      "  return (",
      "    <div className=\"cx-devices cx-picker\" ref={box} role=\"dialog\" aria-label=\"Share your screen\">",
      "      <div className=\"cx-picker-h\">Share your screen</div>",
      "      {sources === null && <div className=\"cx-picker-note\">Looking for screens and windows…</div>}",
      "      {error && <div className=\"cx-picker-note err\">{error}</div>}",
      "      {sources && !sources.length && !error && (",
      "        <button type=\"button\" className=\"cx-btn yes\" onClick={() => pick(\"\")}><IconScreen /> Share your screen</button>",
      "      )}",
      "      {screens.length > 0 && <div className=\"cx-src-grid\">{screens.map(tile)}</div>}",
      "      {windows.length > 0 && <><div className=\"cx-picker-sub\">Or one window</div><div className=\"cx-src-grid\">{windows.map(tile)}</div></>}",
      "      <div className=\"cx-picker-note\">Only the picture is shared, not the sound.</div>",
      "    </div>",
      "  );",
      "}",
      "",
      "// ── Screen share: their screen, in a corner or filling the window (" + MARK + ") ──",
      "function ScreenView() {",
      "  const call = useCall();",
      "  const video = useRef(null);",
      "  const [mode, setMode] = useState(\"dock\"); // dock | full | hidden",
      "  const showing = !!call && !!call.peerSharing && (call.phase === \"live\" || call.phase === \"reconnecting\");",
      "  const stream = showing ? rtc?.remoteVideo || null : null;",
      "  useEffect(() => { if (showing) setMode(\"dock\"); }, [showing]);",
      "  useEffect(() => {",
      "    const v = video.current;",
      "    if (!v) return;",
      "    if (v.srcObject !== stream) v.srcObject = stream;",
      "    if (stream) v.play().catch(() => {});",
      "  }, [stream, mode, call?.screenRev]);",
      "  useEffect(() => {",
      "    if (mode !== \"full\") return;",
      "    const esc = (e) => { if (e.key === \"Escape\") setMode(\"dock\"); };",
      "    window.addEventListener(\"keydown\", esc);",
      "    return () => window.removeEventListener(\"keydown\", esc);",
      "  }, [mode]);",
      "  if (!showing) return null;",
      "  const name = call.peer.username;",
      "  if (mode === \"hidden\") return (",
      "    <button type=\"button\" className=\"cx-screen-pill\" onClick={() => setMode(\"dock\")} aria-label={`Show ${name}'s screen`}><IconScreen /> {name} is sharing their screen <b>Show</b></button>",
      "  );",
      "  return (",
      "    <div className={`cx-screen ${mode}`} role=\"region\" aria-label={`${name}'s screen`}>",
      "      <div className=\"cx-screen-top\">",
      "        <span className=\"cx-screen-name\"><span className=\"cx-screen-dot\" />{name}'s screen</span>",
      "        <button type=\"button\" onClick={() => setMode(mode === \"full\" ? \"dock\" : \"full\")} title={mode === \"full\" ? \"Back to the corner (Esc)\" : \"Fill the window\"} aria-label={mode === \"full\" ? \"Back to the corner\" : \"Fill the window\"}>{mode === \"full\" ? <IconShrink /> : <IconExpand />}</button>",
      "        {mode !== \"full\" && <button type=\"button\" onClick={() => setMode(\"hidden\")} title=\"Hide\" aria-label={`Hide ${name}'s screen`}>×</button>}",
      "      </div>",
      "      <video ref={video} autoPlay playsInline muted onDoubleClick={() => setMode(mode === \"full\" ? \"dock\" : \"full\")} />",
      "    </div>",
      "  );",
      "}",
      "",
      "// The call bar: sits at the top of the window for as long as a call is ringing or going on",
      "",
    ].join("\n"),
    "the call bar ( // The call bar: sits at the top of the window ... )");

  S("  const [devices, setDevices] = useState(false);\n  const active = !!call && (call.phase === \"live\" || call.phase === \"reconnecting\");\n  useEffect(() => { if (!active) setDevices(false); }, [active]);\n",
    "  const [devices, setDevices] = useState(false);\n  const [picker, setPicker] = useState(false); // choosing what to share\n  const active = !!call && (call.phase === \"live\" || call.phase === \"reconnecting\");\n  useEffect(() => { if (!active) { setDevices(false); setPicker(false); } }, [active]);\n",
    "the call bar's settings button ( const [devices, setDevices] = useState(false); ... )");
  S("{status ?? <><Clock since={call.since} />{call.muted && <span> · You're muted</span>}</>}",
    "{status ?? <><Clock since={call.since} />{call.sharing ? <span className=\"cx-sharing\"> · Sharing your screen</span> : call.muted && <span> · You're muted</span>}</>}",
    "the call bar's status line ( {status ?? <><Clock since={call.since} /> ... )");
  S("          <button type=\"button\" className={`cx-round ${devices ? \"on\" : \"\"}`} data-cx-devices",
    "          {call.sharing\n" +
    "            ? <button type=\"button\" className=\"cx-round share on\" onClick={() => { setPicker(false); callActions.stopScreen(); }} title=\"Stop sharing your screen\" aria-label=\"Stop sharing your screen\"><IconScreen /></button>\n" +
    "            : <button type=\"button\" className={`cx-round share ${picker ? \"open\" : \"\"}`} data-cx-share disabled={!call.canShare} onClick={() => { setDevices(false); setPicker((v) => !v); }} aria-expanded={picker}\n" +
    "                title={call.canShare ? \"Share your screen\" : `Screen share needs both of you on the latest AURA`} aria-label={call.canShare ? \"Share your screen\" : \"Screen share isn't available on this call\"}><IconScreen /></button>}\n" +
    "          <button type=\"button\" className={`cx-round ${devices ? \"on\" : \"\"}`} data-cx-devices",
    "the call bar's settings button ( <button ... className={`cx-round ${devices ? \"on\" : \"\"}`} data-cx-devices )");
  S("onClick={() => setDevices((v) => !v)} aria-expanded={devices}",
    "onClick={() => { setPicker(false); setDevices((v) => !v); }} aria-expanded={devices}",
    "the call bar's settings button ( onClick={() => setDevices((v) => !v)} )");
  S("      {devices && active && <Devices onClose={() => setDevices(false)} />}\n",
    "      {devices && active && <Devices onClose={() => setDevices(false)} />}\n" +
    "      {picker && active && !call.sharing && <ScreenPicker onClose={() => setPicker(false)} />}\n",
    "where the call settings open ( {devices && active && <Devices ... />} )");

  S("  root.render(<CallBar />);\n", "  root.render(<><CallBar /><ScreenView /></>);\n", "where the call bar is put on the window ( root.render(<CallBar />); )");

  // ── Looks ───────────────────────────────────────────────────────────────────
  S(".reduce-motion .cx-bar,.reduce-motion .cx-bar.ringing.in,.reduce-motion .cx-bar.moved{animation:none}\n",
    [
      "/* Screen share (" + MARK + ") */",
      ".cx-round.share:disabled{opacity:.4;cursor:default}",
      ".cx-round.share.open{background:rgba(255,255,255,.16)}",
      ".cx-round.share.on{background:#3ddc84;border-color:#3ddc84;color:#06240f}",
      ".cx-round.share.on:hover{background:#dc2626;border-color:#dc2626;color:#fff}",
      ".cx-sharing{color:#3ddc84}",
      ".cx-picker{width:440px;max-height:min(520px,calc(100vh - 90px));overflow-y:auto}",
      ".cx-bar.low .cx-picker{max-height:min(520px,calc(100vh - 90px))}",
      ".cx-picker-h{font-family:'Rajdhani',sans-serif;font-size:16px;font-weight:700;letter-spacing:.3px}",
      ".cx-picker-sub{font-size:12px;font-weight:600;color:var(--t2,#9aa0aa);margin-top:2px}",
      ".cx-picker-note{font-size:11.5px;color:var(--t2,#9aa0aa)}",
      ".cx-picker-note.err{color:#fca5a5}",
      ".cx-src-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}",
      ".cx-src{display:flex;flex-direction:column;gap:6px;padding:6px;border-radius:10px;border:1px solid var(--border,rgba(255,255,255,.14));background:rgba(255,255,255,.04);color:var(--t1,#fff);cursor:pointer;text-align:left;font:500 12px 'DM Sans',sans-serif;min-width:0}",
      ".cx-src:hover,.cx-src:focus-visible{border-color:var(--ac,#FF5722);background:rgba(255,255,255,.08)}",
      ".cx-src img,.cx-src-ph{width:100%;aspect-ratio:16/9;object-fit:contain;border-radius:6px;background:#000;display:flex;align-items:center;justify-content:center;color:var(--t3,rgba(255,255,255,.45))}",
      ".cx-src-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".cx-screen{position:fixed;right:16px;bottom:16px;z-index:9550;width:min(480px,calc(100vw - 32px));border-radius:14px;overflow:hidden;background:#000;border:1px solid var(--borderb,rgba(255,255,255,.18));box-shadow:0 20px 50px rgba(0,0,0,.6);display:flex;flex-direction:column;font-family:'DM Sans',sans-serif}",
      ".cx-screen video{display:block;width:100%;aspect-ratio:16/9;background:#000;object-fit:contain}",
      ".cx-screen.full{inset:0;width:auto;border-radius:0;border:none;z-index:9590}",
      ".cx-screen.full video{flex:1;aspect-ratio:auto;height:0;min-height:0}",
      ".cx-screen-top{display:flex;align-items:center;gap:6px;padding:6px 8px 6px 12px;background:color-mix(in srgb,var(--panel,#1a1f26) 92%,transparent);color:var(--t1,#fff)}",
      ".cx-screen.full .cx-screen-top{padding-top:62px}",
      ":root.cx-moved .cx-screen.full .cx-screen-top{padding-top:6px}",
      ".cx-screen-name{flex:1;min-width:0;display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".cx-screen-dot{width:8px;height:8px;border-radius:50%;background:#3ddc84;flex-shrink:0}",
      ".cx-screen-top button{width:28px;height:28px;border-radius:8px;border:none;background:transparent;color:var(--t2,#9aa0aa);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;line-height:1}",
      ".cx-screen-top button:hover,.cx-screen-top button:focus-visible{background:rgba(255,255,255,.1);color:var(--t1,#fff)}",
      ".cx-screen-pill{position:fixed;right:16px;bottom:16px;z-index:9550;display:flex;align-items:center;gap:8px;height:38px;padding:0 14px;border-radius:999px;border:1px solid var(--borderb,rgba(255,255,255,.18));background:var(--panel,#1a1f26);color:var(--t1,#fff);font:500 12.5px 'DM Sans',sans-serif;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.5)}",
      ".cx-screen-pill b{color:#3ddc84;font-weight:600}",
      ".cx-screen-top button:focus-visible,.cx-screen-pill:focus-visible,.cx-src:focus-visible{outline:2px solid var(--ac2,var(--ac,#ff8a65));outline-offset:2px}",
      ".reduce-motion .cx-bar,.reduce-motion .cx-bar.ringing.in,.reduce-motion .cx-bar.moved{animation:none}",
      "",
    ].join("\n"),
    "the call bar's looks ( .reduce-motion .cx-bar, ... )");

  return { text: t, notes: [
    "a Share Screen button in the call bar: pick your whole screen or one window",
    "their screen shows in a corner; it can fill the window or be hidden",
    "works both ways, and calls with someone on an older AURA still work (without screen share)",
  ] };
}

// ── Version 2: the expand button fills your whole screen, not just AURA's window ──
const V2 = "screen-share v2";
const VIEW_V2 = [
  "// ── Screen share: their screen, in a corner or full screen (" + MARK + ", " + V2 + ") ──",
  "// Full screen fills your whole monitor. Esc, the button or double-click goes back to the corner.",
  "function ScreenView() {",
  "  const call = useCall();",
  "  const box = useRef(null);",
  "  const video = useRef(null);",
  "  const [mode, setMode] = useState(\"dock\"); // dock | full | hidden",
  "  const [idle, setIdle] = useState(false);  // full screen, mouse still: the top strip fades away",
  "  const showing = !!call && !!call.peerSharing && (call.phase === \"live\" || call.phase === \"reconnecting\");",
  "  const stream = showing ? rtc?.remoteVideo || null : null;",
  "  useEffect(() => { if (showing) setMode(\"dock\"); }, [showing]);",
  "  useEffect(() => {",
  "    const v = video.current;",
  "    if (!v) return;",
  "    if (v.srcObject !== stream) v.srcObject = stream;",
  "    if (stream) v.play().catch(() => {});",
  "  }, [stream, mode, call?.screenRev]);",
  "  // Leaving full screen however it happens (Esc, F11, Windows) puts it back in the corner",
  "  useEffect(() => {",
  "    const changed = () => { if (!document.fullscreenElement) setMode((m) => (m === \"full\" ? \"dock\" : m)); };",
  "    document.addEventListener(\"fullscreenchange\", changed);",
  "    return () => document.removeEventListener(\"fullscreenchange\", changed);",
  "  }, []);",
  "  // Their share stopped or the call ended while it was full screen: AURA's window goes back to normal",
  "  useEffect(() => { if (!showing && document.fullscreenElement?.classList?.contains(\"cx-screen\")) document.exitFullscreen().catch(() => {}); }, [showing]);",
  "  const goFull = () => {",
  "    setMode(\"full\");",
  "    const el = box.current;",
  "    // If the whole screen can't be used, it still fills AURA's window",
  "    try { el?.requestFullscreen?.({ navigationUI: \"hide\" })?.catch?.(() => {}); } catch {}",
  "  };",
  "  const leaveFull = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); setMode(\"dock\"); };",
  "  useEffect(() => {",
  "    if (mode !== \"full\") { setIdle(false); return; }",
  "    let timer = null;",
  "    const wake = () => { setIdle(false); clearTimeout(timer); timer = setTimeout(() => setIdle(true), 2500); };",
  "    const esc = (e) => { if (e.key === \"Escape\") leaveFull(); };",
  "    wake();",
  "    window.addEventListener(\"mousemove\", wake);",
  "    window.addEventListener(\"keydown\", esc);",
  "    return () => { clearTimeout(timer); window.removeEventListener(\"mousemove\", wake); window.removeEventListener(\"keydown\", esc); };",
  "  }, [mode]);",
  "  if (!showing) return null;",
  "  const name = call.peer.username;",
  "  if (mode === \"hidden\") return (",
  "    <button type=\"button\" className=\"cx-screen-pill\" onClick={() => setMode(\"dock\")} aria-label={`Show ${name}'s screen`}><IconScreen /> {name} is sharing their screen <b>Show</b></button>",
  "  );",
  "  const full = mode === \"full\";",
  "  return (",
  "    <div ref={box} className={`cx-screen ${mode} ${idle ? \"idle\" : \"\"}`} role=\"region\" aria-label={`${name}'s screen`}>",
  "      <div className=\"cx-screen-top\">",
  "        <span className=\"cx-screen-name\"><span className=\"cx-screen-dot\" />{name}'s screen{full && <span className=\"cx-screen-hint\">Press Esc to exit full screen</span>}</span>",
  "        <button type=\"button\" onClick={full ? leaveFull : goFull} title={full ? \"Exit full screen (Esc)\" : \"Full screen\"} aria-label={full ? \"Exit full screen\" : \"Full screen\"}>{full ? <IconShrink /> : <IconExpand />}</button>",
  "        {!full && <button type=\"button\" onClick={() => setMode(\"hidden\")} title=\"Hide\" aria-label={`Hide ${name}'s screen`}>×</button>}",
  "      </div>",
  "      <video ref={video} autoPlay playsInline muted onDoubleClick={full ? leaveFull : goFull} />",
  "    </div>",
  "  );",
  "}",
  "",
].join("\n");
const CSS_V2 = [
  "/* Full screen fills the monitor (" + V2 + ") */",
  ".cx-screen:fullscreen{inset:0;width:100vw;height:100vh;max-width:none;border-radius:0;border:none;box-shadow:none}",
  ".cx-screen:fullscreen video,.cx-screen.full video{flex:1;aspect-ratio:auto;height:0;min-height:0}",
  ".cx-screen:fullscreen .cx-screen-top{padding-top:6px}",
  ".cx-screen.full .cx-screen-top{transition:opacity .25s}",
  ".cx-screen.full.idle .cx-screen-top{opacity:0}",
  ".cx-screen.full.idle{cursor:none}",
  ".cx-screen-hint{font-weight:400;color:var(--t2,#9aa0aa);margin-left:6px}",
  "",
].join("\n");
function editCallsV2(text) {
  if (text.includes(V2)) return { text, notes: [] };
  if (!text.includes("shareScreen(")) return { text, notes: [] }; // version 1 wasn't put in (the step before does that)
  let t = text;
  const a = t.indexOf("// ── Screen share: their screen,");
  const b = t.indexOf("// The call bar: sits at the top of the window", a);
  if (a < 0 || b < 0) throw new Error("the screen share view ( // ── Screen share: their screen ... )");
  t = t.slice(0, a) + VIEW_V2 + "\n" + t.slice(b);
  t = swapOnce(t, ".reduce-motion .cx-bar,.reduce-motion .cx-bar.ringing.in,.reduce-motion .cx-bar.moved{animation:none}\n",
    CSS_V2 + ".reduce-motion .cx-bar,.reduce-motion .cx-bar.ringing.in,.reduce-motion .cx-bar.moved{animation:none}\n",
    "the call bar's looks ( .reduce-motion .cx-bar, ... )");
  return { text: t, notes: ["full screen now fills your whole monitor (Esc to go back)"] };
}
function editCallsAll(text) {
  const one = editCalls(text), two = editCallsV2(one.text);
  return { text: two.text, notes: [...one.notes, ...two.notes] };
}

// ── AURA's checks (only when they are installed) ─────────────────────────────
function editRunner(text) {
  if (/screen-share\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  let at = -1;
  for (let i = 0; i < lines.length; i++) if (/add\("window",/.test(lines[i])) at = i;
  if (at < 0) return { text, notes: ["(couldn't find where to add the screen share check, so npm test doesn't include it)"] };
  lines.splice(at + 1, 0, 'if (fs.existsSync(path.join(__dirname, "screen-share.cjs"))) add("window", "Screen share in voice calls", "screen-share.cjs");');
  return { text: lines.join("\n"), notes: ["npm test now checks screen share too"] };
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
      } else if (entry.name === "screen-share.cjs") {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. Calls are sound only again." : "Nothing to undo.");
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
    calls: findOne("your calls file (calls.jsx)", (t) => /export const callActions\s*=/.test(t) && /function buildPeer\(\)/.test(t), need, [
      (h) => /[\\/]components[\\/]/.test(h.file),
      (h) => /^calls\.jsx$/.test(path.basename(h.file)),
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
  consider("calls", files.calls, editCallsAll, false);
  const runner = path.join(ROOT, "tests", "run.cjs");
  const hasChecks = fs.existsSync(runner);
  if (hasChecks) consider("checks", runner, editRunner, true);

  const created = [];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "screen-share.cjs"), content: FILES.test });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: screen share in voice calls");
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
  say("Done. Restart AURA (stop it in the terminal and start it again), then call a friend and press the screen button in the call bar.");
  say("Your friend needs this update too before screen share works on your calls.");
  if (hasChecks) say("Run  npm test  before your next release.");
  say("To undo later:  node aura-screen-share-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
