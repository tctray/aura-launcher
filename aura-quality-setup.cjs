#!/usr/bin/env node
/**
 * AURA — the best picture quality, free
 *
 * Screen share in calls
 *   - A quality choice in the Share Screen box:
 *       Auto    1080p at 30 fps (twice the data it used before: sharper)
 *       Smooth  1080p at 60 fps, keeps it moving (games)
 *       Sharp   up to 1440p, keeps text and detail crisp
 *     AURA remembers your choice. On a slow connection it eases down by itself instead of stopping.
 *   - Calls use your graphics card's H.264 when your PC has it (clearer, lighter while gaming),
 *     else VP9. Both are better than the basic codec calls used before.
 *   - Your camera in calls goes up to 1080p (if you have the camera-in-calls update).
 *
 * Recording
 *   - Settings > Recording > Recording Quality:
 *       Standard  30 fps, 8 Mbps (what it was; best for older PCs)
 *       High      60 fps, 16 Mbps (the new default)
 *       Ultra     60 fps, 30 Mbps (the most detail, biggest files)
 *     Recordings keep your screen's full size. Used by F9, the AURA Bar and the Clips page.
 *   - Clips that are converted or trimmed keep more of their quality.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-quality-setup.cjs
 *
 * What it does:
 *   - edits    src/components/calls.jsx   screen share quality, codecs, camera
 *   - edits    src/App.jsx                Recording Quality
 *   - edits    electron/main.js           converting and trimming clips
 *   - creates  tests/quality.cjs          (only if AURA's checks are installed) checks it
 *
 * Every file it changes is copied to <name>.before-quality.bak first.
 * To put everything back:                 node aura-quality-setup.cjs --undo
 * To preview without changing anything:   node aura-quality-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FILES = {"test":"// Picture quality: screen share in calls (Auto, Smooth, Sharp), the video codec calls use,\n// your camera in calls, and Settings > Recording > Recording Quality.\n// Two AURA windows call each other for real in a real browser (a pretend Supabase passes the\n// connection details), and the test looks at what each asks the screen, camera and encoder for.\n// Added by aura-quality-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\nconst sleep = (ms) => new Promise((r) => setTimeout(r, ms));\n\nfunction serve(dir) {\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(dir, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => {\n      if (err) { res.writeHead(404); return res.end(); }\n      res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" });\n      res.end(data);\n    });\n  });\n  return new Promise((r) => server.listen(0, \"127.0.0.1\", () => r({ server, base: \"http://127.0.0.1:\" + server.address().port })));\n}\n\n// ── A pretend Supabase for calls ─────────────────────────────────────────────\nfunction makeWorld() {\n  const people = {};    // id -> { page, name }\n  let calls = [], signals = [], nextSignal = 1, nextCall = 1;\n  const shape = (c, me) => ({ id: c.id, callerId: c.caller, calleeId: c.callee, peerId: c.caller === me ? c.callee : c.caller, outgoing: c.caller === me, status: c.status, reason: c.reason || null });\n  const tell = (id, event) => { const p = people[id]?.page; if (p) p.evaluate((e) => window.__deliver && window.__deliver(e), event).catch(() => {}); };\n  const ok = (data) => ({ success: true, data });\n  const no = (error) => ({ success: false, error });\n  const end = (c, reason) => { if (c.status === \"ended\") return; c.status = \"ended\"; c.reason = reason || \"hangup\"; for (const id of [c.caller, c.callee]) tell(id, { type: \"call\", call: shape(c, id) }); };\n  const handlers = {\n    start: (me) => ok({ id: me, username: people[me].name, live: true }),\n    listFriends: (me) => ok(Object.keys(people).filter((id) => id !== me).map((id) => ({ friendshipId: \"f-\" + id, userId: id, username: people[id].name, avatarUrl: \"\", state: \"friend\", since: null, online: true, lastSeenAt: new Date().toISOString() }))),\n    getProfile: (_me, id) => ok(people[id] ? { userId: id, username: people[id].name, bio: \"\", avatarUrl: \"\" } : null),\n    listConversations: () => ok([]), listBlocked: () => ok([]),\n    callConfig: () => ok({ iceServers: [], relay: false }),\n    currentCall: (me) => { const c = calls.find((x) => x.status !== \"ended\" && (x.caller === me || x.callee === me)); return ok(c ? shape(c, me) : null); },\n    startCall: (me, other) => {\n      if (calls.some((x) => x.status !== \"ended\" && [x.caller, x.callee].some((p) => p === me || p === other))) return no(\"You're already in a call.\");\n      const c = { id: \"call-\" + nextCall++, caller: me, callee: other, status: \"ringing\" };\n      calls.push(c);\n      tell(other, { type: \"call\", call: shape(c, other) });\n      return ok(shape(c, me));\n    },\n    answerCall: (me, id) => { const c = calls.find((x) => x.id === id && x.callee === me && x.status === \"ringing\"); if (!c) return no(\"That call has ended.\"); c.status = \"active\"; tell(c.caller, { type: \"call\", call: shape(c, c.caller) }); return ok(shape(c, me)); },\n    endCall: (me, id, reason) => { const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me)); if (c) end(c, reason); return ok(true); },\n    callSignal: (me, id, kind, payload) => {\n      const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me));\n      if (!c || c.status !== \"active\") return no(\"That call isn't connected.\");\n      if (![\"offer\", \"answer\", \"ice\"].includes(kind)) return no(\"That isn't a valid call message.\");\n      if (typeof payload !== \"string\" || payload.length > 20000) return no(\"That call message is too long.\");\n      const to = c.caller === me ? c.callee : c.caller;\n      const s = { id: nextSignal++, call: id, from: me, to, kind, payload };\n      signals.push(s);\n      world.biggest = Math.max(world.biggest, payload.length);\n      world.sent[me] = (world.sent[me] || 0) + 1;\n      tell(to, { type: \"signal\", callId: id, signal: { id: s.id, kind, payload } });\n      return ok(s.id);\n    },\n    callState: (me, id, from) => { const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me)); return ok({ call: c ? shape(c, me) : null, signals: signals.filter((s) => s.call === id && s.to === me && s.id > (from || 0)).map((s) => ({ id: s.id, kind: s.kind, payload: s.payload })) }); },\n    callBeat: (me, id) => { const c = calls.find((x) => x.id === id); return ok(c && c.status !== \"ended\" ? \"active\" : \"ended\"); },\n  };\n  // Someone opened AURA after the others had already loaded their friends list: tell everyone to look again\n  const friendsChanged = () => Object.keys(people).forEach((id) => tell(id, { type: \"friends\" }));\n  const world = { people, handlers, biggest: 0, sent: {}, friendsChanged, reset() { calls.forEach((c) => end(c, \"hangup\")); } };\n  return world;\n}\n\nasync function person(browser, world, base, id, name, settings) {\n  const page = await (await browser.newContext({ viewport: { width: 1360, height: 860 }, permissions: [\"microphone\"] })).newPage();\n  const thrown = [];\n  page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n  world.people[id] = { page, name, thrown };\n  await page.exposeBinding(\"__social\", (_src, fn, args) => { const h = world.handlers[fn]; return h ? h(id, ...(args || [])) : { success: true, data: null }; });\n  await page.addInitScript(([id, name, settings]) => {\n    try { localStorage.clear(); localStorage.setItem(\"aura_profile\", JSON.stringify({ username: name, avatar: \"\", userId: id })); if (settings) localStorage.setItem(\"aura_settings\", JSON.stringify(settings)); } catch {}\n    const ok = (data) => Promise.resolve({ success: true, data });\n    const account = { getSession: () => ok({ id, email: name + \"@example.com\" }), getMyProfile: () => ok({ username: name, avatar_url: null }) };\n    window.auraCloud = new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => (account[key] ? account[key](...args) : ok(null))) });\n    window.auraSocial = new Proxy({}, {\n      get: (_t, key) => {\n        if (key === \"then\") return undefined;\n        if (key === \"onEvent\") return (cb) => { window.__deliver = cb; return () => { window.__deliver = null; }; };\n        return (...args) => window.__social(key, args);\n      },\n    });\n    // Screens and windows to pick from, like Windows would list them\n    const pic = (hue) => \"data:image/svg+xml;base64,\" + btoa(`<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"320\" height=\"180\"><rect width=\"320\" height=\"180\" fill=\"hsl(${hue},40%,35%)\"/></svg>`);\n    window.__chosen = [];\n    const desktop = {\n      getCaptureSources: () => Promise.resolve({ success: true, sources: [\n        { id: \"window:22:0\", name: \"Notepad\", thumbnail: pic(200), isScreen: false },\n        { id: \"screen:0:0\", name: \"Entire screen\", thumbnail: pic(20), isScreen: true },\n      ] }),\n      setCaptureSource: (sid) => { window.__chosen.push(sid); return Promise.resolve({ success: true }); },\n    };\n    window.electronAPI = new Proxy({}, {\n      get: (_t, key) => {\n        if (key === \"isElectron\") return true;\n        if (typeof key !== \"string\" || key === \"then\") return undefined;\n        if (key === \"onQuickRecordToggle\") return (cb) => { window.__f9 = cb; return () => {}; };\n        if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};\n        return (...args) => (desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }));\n      },\n    });\n    // Keep hold of every screen captured, to check it's switched off afterwards\n    window.__screens = [];\n    const realGDM = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);\n    window.__asked = [];\n    navigator.mediaDevices.getDisplayMedia = async (...a) => { window.__asked.push(JSON.parse(JSON.stringify(a[0] || {}))); const s = await realGDM(...a); window.__screens.push(s); return s; };\n    // What each camera is asked for, and what each recording is set to\n    window.__camAsk = [];\n    const realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);\n    navigator.mediaDevices.getUserMedia = (c = {}) => { if (c.video) window.__camAsk.push(JSON.parse(JSON.stringify(c.video))); return realGUM(c); };\n    const RealRec = window.MediaRecorder;\n    window.__recs = [];\n    window.MediaRecorder = class extends RealRec { constructor(stream, o) { super(stream, o); window.__recs.push({ options: o || {}, rec: this }); } };\n    window.MediaRecorder.isTypeSupported = (t) => RealRec.isTypeSupported(t);\n    // Keep hold of the connections, so the test can see what goes over them\n    const Real = window.RTCPeerConnection;\n    window.__pcs = [];\n    window.RTCPeerConnection = function (...a) { const pc = new Real(...a); window.__pcs.push(pc); return pc; };\n    window.RTCPeerConnection.prototype = Real.prototype;\n  }, [id, name, settings || null]);\n  await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n  return page;\n}\n\n(async () => {\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(process.env.CI ? 1 : 3); }\n  const args = [\"--use-fake-ui-for-media-stream\", \"--use-fake-device-for-media-stream\", \"--auto-accept-this-tab-capture\", \"--autoplay-policy=no-user-gesture-required\"];\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch({ ...options, args }); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with. Run  npx playwright install chromium  once to add one.\"); return done(process.env.CI ? 1 : 3); }\n  const now = await serve(DIST);\n  const until = async (fn, ms = 15000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); } catch { v = null; } if (v) return v; await sleep(200); } return v; };\n  const live = (p) => until(() => p.evaluate(() => !!document.querySelector(\".cx-bar.live\")));\n  const callFrom = async (from, to, toName) => {\n    await from.locator(`button.cx-call[title=\"Call ${toName}\"]`).first().click({ timeout: 15000 });\n    await until(() => to.evaluate(() => !!document.querySelector(\".cx-bar.ringing.in\")));\n    await to.locator(\".cx-btn.yes\").click({ timeout: 15000 });\n    return (await live(from)) && (await live(to));\n  };\n  // What Alex is sending as a picture: the encoder settings, the hint, and the codec in use\n  const sending = (p) => p.evaluate(async () => {\n    const pc = window.__pcs.filter((x) => x.connectionState !== \"closed\").pop();\n    if (!pc) return null;\n    const s = pc.getSenders().find((x) => x.track && x.track.kind === \"video\" && /screen|window|tab|web-contents|desktop/i.test(x.track.label + \" \" + (x.track.getSettings().displaySurface || \"\")));\n    if (!s) return null;\n    const e = (s.getParameters().encodings || [])[0] || {};\n    let codec = \"\";\n    const stats = await pc.getStats();\n    stats.forEach((r) => { if (r.type === \"outbound-rtp\" && r.kind === \"video\" && r.codecId && (r.framesEncoded || 0) > 0) { const c = stats.get(r.codecId); if (c) codec = c.mimeType; } });\n    return { bitrate: e.maxBitrate, fps: e.maxFramerate, hint: s.track.contentHint, codec };\n  });\n  const screenSeen = (p) => until(() => p.evaluate(() => { const v = document.querySelector(\".cx-screen video\"); return v && v.videoWidth > 0; }));\n  const share = async (p, mode) => {\n    await p.locator(\".cx-round.share\").click({ timeout: 15000 });\n    await p.locator(\".cx-picker .cx-src\").first().waitFor({ timeout: 15000 });\n    if (mode) await p.locator(\".cx-quality .cx-q\", { hasText: mode }).click();\n    await p.locator(\".cx-picker .cx-src\").first().click({ timeout: 15000 });\n    await until(async () => (await p.locator(\".cx-round.share.on\").count()) === 1);\n  };\n  const stopShare = async (p) => { await p.locator(\".cx-round.share.on\").click({ timeout: 15000 }); await sleep(600); };\n  const lastAsk = (p) => p.evaluate(() => window.__asked[window.__asked.length - 1] || null);\n\n  try {\n    const world = makeWorld();\n    const A = await person(browser, world, now.base, \"user-A\", \"Alex\", { recordSourceId: \"screen:0:0\", recordSourceName: \"Entire screen\", micVolume: 0 });\n    const B = await person(browser, world, now.base, \"user-B\", \"Bri\");\n    await sleep(5000);\n    world.friendsChanged();\n    await until(() => A.evaluate(() => !!document.querySelector('button.cx-call[title=\"Call Bri\"]')));\n    check(\"Alex calls Bri and they're connected\", await callFrom(A, B, \"Bri\"));\n    await until(() => A.locator(\".cx-round.share\").isEnabled());\n\n    console.log(\"1. The quality choice in Share Screen\");\n    await A.locator(\".cx-round.share\").click({ timeout: 15000 });\n    await A.locator(\".cx-picker .cx-src\").first().waitFor({ timeout: 15000 });\n    const choices = await A.locator(\".cx-quality .cx-q\").allInnerTexts();\n    check(\"the Share Screen box offers Auto, Smooth and Sharp\", choices.join(\",\") === \"Auto,Smooth,Sharp\", choices);\n    check(\"Auto is picked at first, and it says what it does\", (await A.locator(\".cx-q.on\").innerText()) === \"Auto\" && /1080p at 30 fps/.test(await A.locator(\".cx-q-hint\").innerText()));\n    await A.locator(\".cx-quality .cx-q\", { hasText: \"Smooth\" }).click();\n    check(\"picking Smooth says it's 60 fps\", (await A.locator(\".cx-q.on\").innerText()) === \"Smooth\" && /60 fps/.test(await A.locator(\".cx-q-hint\").innerText()));\n    await A.locator(\".cx-picker .cx-src\").first().click({ timeout: 15000 });\n    await until(async () => (await A.locator(\".cx-round.share.on\").count()) === 1);\n\n    console.log(\"2. Smooth (games)\");\n    let ask = await lastAsk(A);\n    check(\"the screen is captured at 60 fps\", ask?.video?.frameRate?.ideal === 60 && ask.video.frameRate.max === 60, ask);\n    check(\"Bri sees it\", !!(await screenSeen(B)));\n    let s = await until(async () => { const x = await sending(A); return x && x.codec ? x : null; }, 20000) || (await sending(A));\n    check(\"it's sent at 60 fps with up to 12 Mbps, marked as motion\", s && s.fps === 60 && s.bitrate === 12000000 && s.hint === \"motion\", s);\n    const caps = await A.evaluate(() => RTCRtpSender.getCapabilities(\"video\").codecs.map((c) => c.mimeType));\n    const want = caps.includes(\"video/H264\") ? \"video/H264\" : caps.includes(\"video/VP9\") ? \"video/VP9\" : \"\";\n    check(`it uses the better codec this PC has (${want.replace(\"video/\", \"\") || \"none\"}), not the basic VP8`, !want || (s && s.codec === want), { codec: s && s.codec, want });\n    check(\"AURA remembers Smooth for next time\", await A.evaluate(() => JSON.parse(localStorage.getItem(\"aura_call_prefs\") || \"{}\").shareMode === \"smooth\"));\n    await stopShare(A);\n\n    console.log(\"3. Sharp (text and detail)\");\n    await share(A, \"Sharp\");\n    ask = await lastAsk(A);\n    check(\"the screen is captured up to 1440p at 30 fps\", ask?.video?.width?.max === 2560 && ask.video.height.max === 1440 && ask.video.frameRate.max === 30, ask);\n    s = await until(async () => { const x = await sending(A); return x && x.hint === \"detail\" ? x : null; });\n    check(\"it's sent with up to 12 Mbps, marked as detail\", s && s.bitrate === 12000000 && s.fps === 30 && s.hint === \"detail\", s);\n    check(\"Bri sees it\", !!(await screenSeen(B)));\n    await stopShare(A);\n\n    console.log(\"4. Auto\");\n    await share(A, \"Auto\");\n    ask = await lastAsk(A);\n    s = await until(async () => { const x = await sending(A); return x && x.fps === 30 ? x : null; });\n    check(\"1080p at 30 fps with up to 8 Mbps (twice what it was)\", ask?.video?.width?.max === 1920 && s && s.bitrate === 8000000 && !s.hint, { ask, s });\n    await stopShare(A);\n    await share(A); // no choice made: the last one\n    check(\"sharing again uses the last choice\", (await lastAsk(A))?.video?.frameRate?.max === 30 && (await A.evaluate(() => JSON.parse(localStorage.getItem(\"aura_call_prefs\")).shareMode)) === \"auto\");\n    await stopShare(A);\n    await B.locator(\".cx-round.share\").click({ timeout: 15000 });\n    await B.locator(\".cx-picker .cx-src\").first().click({ timeout: 15000 });\n    check(\"Bri can share back (Bri's own choice: Auto)\", !!(await until(() => A.evaluate(() => { const v = document.querySelector(\".cx-screen video\"); return v && v.videoWidth > 0; }))) && (await lastAsk(B))?.video?.frameRate?.max === 30);\n    await stopShare(B);\n\n    console.log(\"5. Your camera in calls\");\n    if (await A.locator(\".cx-round.cam\").count()) {\n      await A.locator(\".cx-round.cam\").click();\n      const cam = await until(() => A.evaluate(() => window.__camAsk[window.__camAsk.length - 1] || null));\n      check(\"the camera is asked for up to 1080p\", cam?.width?.ideal === 1920 && cam?.height?.ideal === 1080, cam);\n      check(\"and Bri sees it\", !!(await until(() => B.evaluate(() => { const v = document.querySelector(\".cx-cams .cx-cam-theirs\"); return v && v.videoWidth > 0; }))));\n      await A.locator(\".cx-round.cam\").click();\n    } else note(\"the camera-in-calls update isn't installed, so its quality wasn't checked\");\n    await A.locator(\".cx-round.end\").click({ timeout: 15000 });\n    await sleep(1500);\n\n    console.log(\"6. Recording quality (Settings > Recording)\");\n    const f9 = async () => { await A.evaluate(() => window.__f9 && window.__f9({ game: \"Test\" })); await sleep(1500); };\n    const rec = () => A.evaluate(() => { const r = window.__recs[window.__recs.length - 1]; return r ? { bits: r.options.videoBitsPerSecond, state: r.rec.state } : null; });\n    await f9();\n    let r = await rec();\n    ask = await lastAsk(A);\n    check(\"by default (High) an F9 recording is 60 fps at 16 Mbps\", ask?.video?.frameRate?.ideal === 60 && r?.bits === 16000000 && r.state === \"recording\", { ask, r });\n    check(\"and keeps the screen's own size (no size limit)\", ask?.video && !ask.video.width && !ask.video.height, ask);\n    await f9();\n    await A.locator('.gm-rail-item[title=\"Settings\"], .sb-item[title=\"Settings\"]').first().click({ timeout: 15000 });\n    await sleep(800);\n    const row = A.locator(\".sr\", { has: A.locator(\".sr-l\", { hasText: /^Recording Quality$/ }) });\n    check(\"Settings > Recording has Recording Quality, set to High\", (await row.count()) === 1 && (await row.locator(\".seg button.on\").innerText()) === \"High\" && /60 fps/.test(await row.innerText()));\n    await row.locator(\".seg button\", { hasText: \"Standard\" }).click();\n    await f9();\n    r = await rec(); ask = await lastAsk(A);\n    check(\"Standard: 30 fps at 8 Mbps (what it used to be)\", ask?.video?.frameRate?.ideal === 30 && r?.bits === 8000000, { ask, r });\n    await f9();\n    await row.locator(\".seg button\", { hasText: \"Ultra\" }).click();\n    await f9();\n    r = await rec(); ask = await lastAsk(A);\n    check(\"Ultra: 60 fps at 30 Mbps\", ask?.video?.frameRate?.ideal === 60 && r?.bits === 30000000, { ask, r });\n    await f9();\n    check(\"it says roughly how big the files get\", /2\\.3 GB per 10 minutes/.test(await row.innerText()));\n    await A.locator('.gm-rail-item[title=\"Clips\"], .sb-item[title=\"Clips\"]').first().click({ timeout: 15000 });\n    await sleep(800);\n    await A.locator(\"button\", { hasText: \"⏺ Record\" }).first().click({ timeout: 15000 });\n    await A.locator(\"button\", { hasText: \"Record Full Desktop\" }).click({ timeout: 15000 });\n    await sleep(1500);\n    r = await rec(); ask = await lastAsk(A);\n    check(\"the Clips page's Record button uses it too\", ask?.video?.frameRate?.ideal === 60 && r?.bits === 30000000, { ask, r });\n    await A.locator(\"button\", { hasText: \"■ Stop\" }).first().click({ timeout: 15000 }).catch(() => {});\n\n    check(\"nothing crashed along the way\", [\"user-A\", \"user-B\"].every((id) => world.people[id].thrown.filter((m) => !/reading 'live'/.test(m)).length === 0), [\"user-A\", \"user-B\"].map((id) => world.people[id].thrown));\n  } finally {\n    await browser.close();\n    now.server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The picture quality check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-quality.bak";
const MARK = "Added by aura-quality-setup.cjs";
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

function swapAll(text, find, replace, count, what) {
  if (text.split(find).length - 1 !== count) throw new Error(what);
  return text.split(find).join(replace);
}

// ── Calls: screen share quality, better video codecs, sharper camera ─────────
function editCalls(text) {
  if (text.includes("SHARE_MODES")) return { text, notes: [] };
  let t = text;
  const notes = [];
  t = swapOnce(t, "const SCREEN_VIDEO = { frameRate: { ideal: 30, max: 30 }, width: { max: 1920 }, height: { max: 1080 } };\n",
    "const SCREEN_VIDEO = { frameRate: { ideal: 30, max: 30 }, width: { max: 1920 }, height: { max: 1080 } };\n" +
    "// Screen share quality, picked in the Share Screen box (" + MARK + ")\n" +
    "//   Auto: 1080p, 30 fps. Smooth: 1080p at 60 fps, keeps it moving (games). Sharp: up to 1440p, keeps text crisp.\n" +
    "// On a slow connection each eases down by itself instead of stopping.\n" +
    "const SHARE_MODES = {\n" +
    "  auto: { label: \"Auto\", hint: \"Good for most things: 1080p at 30 fps.\", video: SCREEN_VIDEO, fps: 30, bitrate: 8000000, prefer: \"balanced\", content: \"\" },\n" +
    "  smooth: { label: \"Smooth\", hint: \"60 fps for games and fast motion.\", video: { frameRate: { ideal: 60, max: 60 }, width: { max: 1920 }, height: { max: 1080 } }, fps: 60, bitrate: 12000000, prefer: \"maintain-framerate\", content: \"motion\" },\n" +
    "  sharp: { label: \"Sharp\", hint: \"Clearest text and detail, up to 1440p.\", video: { frameRate: { ideal: 30, max: 30 }, width: { max: 2560 }, height: { max: 1440 } }, fps: 30, bitrate: 12000000, prefer: \"maintain-resolution\", content: \"detail\" },\n" +
    "};\n" +
    "// Pictures in calls use the graphics card's H.264 when this PC has it (clearer, lighter while gaming), else VP9\n" +
    "function preferCodecs(pc) {\n" +
    "  try {\n" +
    "    const all = RTCRtpReceiver.getCapabilities?.(\"video\")?.codecs || [];\n" +
    "    const rank = (c) => (/h264/i.test(c.mimeType) ? (/packetization-mode=1/.test(c.sdpFmtpLine || \"\") ? 0 : 1) : /vp9/i.test(c.mimeType) ? 2 : 3);\n" +
    "    if (!all.some((c) => rank(c) < 3)) return;\n" +
    "    const order = all.map((c, i) => [c, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([c]) => c);\n" +
    "    for (const tr of pc.getTransceivers()) {\n" +
    "      if (tr.receiver?.track?.kind !== \"video\" || tr.stopped || typeof tr.setCodecPreferences !== \"function\") continue;\n" +
    "      try { tr.setCodecPreferences(order); } catch {}\n" +
    "    }\n" +
    "  } catch {}\n" +
    "}\n",
    "the screen share settings ( const SCREEN_VIDEO = ... )");
  // The quality you picked is remembered with your other call settings
  t = swapOnce(t, "volume: Number.isFinite(p.volume) ? Math.min(MAX_VOLUME, Math.max(0, p.volume)) : 1, pos: spot };",
    "volume: Number.isFinite(p.volume) ? Math.min(MAX_VOLUME, Math.max(0, p.volume)) : 1, pos: spot, shareMode: SHARE_MODES[p.shareMode] ? p.shareMode : \"auto\" };",
    "where call settings are loaded ( ... pos: spot }; )");
  t = swapOnce(t, "} catch { return { mic: \"\", speaker: \"\", volume: 1, pos: null }; }",
    "} catch { return { mic: \"\", speaker: \"\", volume: 1, pos: null, shareMode: \"auto\" }; }",
    "where call settings are loaded ( return { mic: \"\", ... pos: null } )");
  // Both PCs ask for the better codecs when the picture lanes are set up
  t = swapOnce(t, "    const made = await rtc.pc.createOffer();\n    if (mine !== session) return;\n    await rtc.pc.setLocalDescription(made);\n    if (mine !== session) return;\n    await send(\"offer\", { sdp: rtc.pc.localDescription.sdp });\n  } catch {} // no screen share",
    "    preferCodecs(rtc.pc); // (" + MARK + ")\n    const made = await rtc.pc.createOffer();\n    if (mine !== session) return;\n    await rtc.pc.setLocalDescription(made);\n    if (mine !== session) return;\n    await send(\"offer\", { sdp: rtc.pc.localDescription.sdp });\n  } catch {} // no screen share",
    "where the screen share lane is offered ( const made = await rtc.pc.createOffer(); ... )");
  t = swapOnce(t, "    for (const tr of pc.getTransceivers()) { if (tr.receiver?.track?.kind === \"video\" && tr.direction === \"recvonly\") { try { tr.direction = \"sendrecv\"; } catch {} } }\n",
    "    for (const tr of pc.getTransceivers()) { if (tr.receiver?.track?.kind === \"video\" && tr.direction === \"recvonly\") { try { tr.direction = \"sendrecv\"; } catch {} } }\n" +
    "    preferCodecs(pc); // (" + MARK + ")\n",
    "where the screen share lane is answered ( tr.direction = \"sendrecv\" )");
  // Sharing with the quality you picked
  t = swapOnce(t, "    const mine = session;\n    let stream = null;\n    try {\n      if (sourceId) await window.electronAPI?.setCaptureSource?.(sourceId);\n      stream = await navigator.mediaDevices.getDisplayMedia({ video: SCREEN_VIDEO, audio: false });\n",
    "    const mine = session;\n    const mode = SHARE_MODES[prefs.shareMode] || SHARE_MODES.auto; // (" + MARK + ")\n    let stream = null;\n    try {\n      if (sourceId) await window.electronAPI?.setCaptureSource?.(sourceId);\n      stream = await navigator.mediaDevices.getDisplayMedia({ video: mode.video, audio: false });\n",
    "where the screen is captured ( getDisplayMedia({ video: SCREEN_VIDEO, ... }) )");
  t = swapOnce(t, "    try { await lane.sender.replaceTrack(track); }\n    catch { stopStream(stream); return toast(\"Your screen couldn't be sent. Try again.\", \"err\"); }\n",
    "    // Tell the encoder what it's showing: motion (games) or detail (text)\n" +
    "    try { if (mode.content) track.contentHint = mode.content; } catch {}\n" +
    "    track.applyConstraints?.(mode.video)?.catch?.(() => {});\n" +
    "    try { await lane.sender.replaceTrack(track); }\n    catch { stopStream(stream); return toast(\"Your screen couldn't be sent. Try again.\", \"err\"); }\n",
    "where the screen is sent ( await lane.sender.replaceTrack(track); )");
  t = swapOnce(t, "      p.encodings[0].maxBitrate = SCREEN_MAX_BITRATE;\n      p.encodings[0].maxFramerate = 30;\n      p.degradationPreference = \"balanced\";\n",
    "      p.encodings[0].maxBitrate = mode.bitrate;\n      p.encodings[0].maxFramerate = mode.fps;\n      p.degradationPreference = mode.prefer;\n",
    "the screen share picture settings ( maxBitrate = SCREEN_MAX_BITRATE ... )");
  notes.push("Share Screen has a quality choice: Auto, Smooth (60 fps) or Sharp (up to 1440p)");
  notes.push("screen share can use twice the data (8-12 Mbps) and eases down by itself on slow connections");
  notes.push("calls use the graphics card's H.264 when the PC has it (else VP9)");
  // The picker: the quality choice
  t = swapOnce(t, "function ScreenPicker({ onClose }) {\n  const box = useRef(null);\n",
    "function ScreenPicker({ onClose }) {\n  const box = useRef(null);\n  const [mode, setMode] = useState(SHARE_MODES[prefs.shareMode] ? prefs.shareMode : \"auto\"); // (" + MARK + ")\n",
    "the screen share picker ( function ScreenPicker({ onClose }) { )");
  t = swapOnce(t, "      <div className=\"cx-picker-h\">Share your screen</div>\n",
    "      <div className=\"cx-picker-h\">Share your screen</div>\n" +
    "      {/* Quality (" + MARK + ") */}\n" +
    "      <div className=\"cx-quality\" role=\"radiogroup\" aria-label=\"Quality\">\n" +
    "        {Object.entries(SHARE_MODES).map(([k, m]) => (\n" +
    "          <button key={k} type=\"button\" role=\"radio\" aria-checked={mode === k} className={`cx-q ${mode === k ? \"on\" : \"\"}`} title={m.hint}\n" +
    "            onClick={() => { savePrefs({ shareMode: k }); setMode(k); }}>{m.label}</button>\n" +
    "        ))}\n" +
    "      </div>\n" +
    "      <div className=\"cx-picker-note cx-q-hint\">{SHARE_MODES[mode].hint}</div>\n",
    "the picker's title ( <div className=\"cx-picker-h\">Share your screen</div> )");
  t = swapOnce(t, ".cx-picker-note.err{color:#fca5a5}\n",
    ".cx-picker-note.err{color:#fca5a5}\n" +
    "/* Screen share quality (" + MARK + ") */\n" +
    ".cx-quality{display:flex;gap:4px;padding:3px;border-radius:10px;background:rgba(255,255,255,.06);border:1px solid var(--border,rgba(255,255,255,.14))}\n" +
    ".cx-q{flex:1;height:30px;border:none;border-radius:7px;background:transparent;color:var(--t2,#9aa0aa);font:600 12px 'DM Sans',sans-serif;cursor:pointer}\n" +
    ".cx-q:hover{color:var(--t1,#fff);background:rgba(255,255,255,.06)}\n" +
    ".cx-q.on{background:var(--ac,#FF5722);color:#fff}\n" +
    ".cx-q:focus-visible{outline:2px solid var(--ac2,var(--ac,#ff8a65));outline-offset:2px}\n" +
    ".cx-q-hint{margin-top:-6px}\n",
    "the picker's look ( .cx-picker-note.err{color:#fca5a5} )");
  // Your camera in calls, sharper (if that update is in)
  const cam = "const CAM_MAX_BITRATE = 1500000;\nconst CAM_VIDEO = { width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 }, frameRate: { ideal: 30, max: 30 } };\n";
  if (t.includes(cam)) {
    t = swapOnce(t, cam,
      "// Up to 1080p when the camera can (" + MARK + ")\n" +
      "const CAM_MAX_BITRATE = 2500000;\nconst CAM_VIDEO = { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 30, max: 30 } };\n",
      "the camera settings");
    notes.push("your camera in calls goes up to 1080p when the camera can");
  }
  return { text: t, notes };
}

// ── Recording: a quality choice in Settings ──────────────────────────────────
function editApp(text) {
  if (text.includes("REC_QUALITY")) return { text, notes: [] };
  let t = text;
  t = swapOnce(t, '  recordSourceId: "",     // screen/window chosen for the AURA Bar and F9\n',
    '  recQuality: "high",     // Standard (30 fps), High (60 fps) or Ultra (60 fps, most detail) (' + MARK + ")\n" +
    '  recordSourceId: "",     // screen/window chosen for the AURA Bar and F9\n',
    "the recording settings ( recordSourceId: \"\", )");
  t = swapOnce(t, "const isQuickRecording = () => !!quickRec.recorder || quickRec.starting;\n",
    "const isQuickRecording = () => !!quickRec.recorder || quickRec.starting;\n" +
    "// Recording quality, from Settings > Recording (" + MARK + "). Recordings keep your screen's own size.\n" +
    "const REC_QUALITY = { standard: { fps: 30, bitrate: 8000000 }, high: { fps: 60, bitrate: 16000000 }, ultra: { fps: 60, bitrate: 30000000 } };\n" +
    "const recQuality = () => REC_QUALITY[SETTINGS.recQuality] || REC_QUALITY.high;\n" +
    "const recVideo = () => ({ frameRate: { ideal: recQuality().fps, max: recQuality().fps } });\n",
    "the quick recording ( const isQuickRecording = ... )");
  t = swapAll(t, "video: { frameRate: 30 }", "video: recVideo()", 2, "where recordings capture the screen ( video: { frameRate: 30 } twice )");
  t = swapAll(t, "videoBitsPerSecond: 8000000", "videoBitsPerSecond: recQuality().bitrate", 2, "the recording's quality ( videoBitsPerSecond: 8000000 twice )");
  t = swapOnce(t, '          <div className="sr"><div><div className="sr-l">Microphone</div>',
    '          {/* Recording quality (' + MARK + ') */}\n' +
    '          <div className="sr"><div><div className="sr-l">Recording Quality</div><div className="sr-s">{({standard:"30 fps, smaller files (about 600 MB per 10 minutes). Best for older PCs",high:"60 fps and sharp (about 1.2 GB per 10 minutes)",ultra:"60 fps, the most detail (about 2.3 GB per 10 minutes)"})[s.recQuality]||"60 fps and sharp (about 1.2 GB per 10 minutes)"}</div></div>\n' +
    '            <Seg value={s.recQuality||"high"} options={[["standard","Standard"],["high","High"],["ultra","Ultra"]]} onChange={v=>set({recQuality:v})}/></div>\n' +
    '          <div className="sr"><div><div className="sr-l">Microphone</div>',
    "the Microphone row in Settings > Recording");
  return { text: t, notes: [
    "Settings > Recording has Recording Quality: Standard (30 fps), High (60 fps, the new default) or Ultra",
    "recordings keep your screen's full size",
  ] };
}

// ── Saving and trimming clips: less quality lost ─────────────────────────────
function editMain(text) {
  if (text.includes("aura-quality-setup")) return { text, notes: [] };
  let t = text;
  t = swapOnce(t, '      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",\n',
    '      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", // (sharper: ' + MARK + ')\n',
    'where a recording is converted ( "-crf", "21" )');
  t = swapOnce(t, '        "-c:v", "libx264",\n        "-preset", "ultrafast",\n        "-c:a", "aac",\n',
    '        "-c:v", "libx264",\n        "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", // a trimmed clip keeps its quality (' + MARK + ')\n        "-c:a", "aac", "-b:a", "160k",\n',
    'where a clip is trimmed ( "-preset", "ultrafast" )');
  return { text: t, notes: ["clips converted or trimmed keep more of their quality"] };
}

// ── AURA's checks (only when they are installed) ─────────────────────────────
function editRunner(text) {
  if (/quality\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  let at = -1;
  for (let i = 0; i < lines.length; i++) if (/add\("window",/.test(lines[i])) at = i;
  if (at < 0) return { text, notes: ["(couldn't find where to add the check, so npm test doesn't include it)"] };
  lines.splice(at + 1, 0, 'if (fs.existsSync(path.join(__dirname, "quality.cjs"))) add("window", "Picture quality: screen share, calls and recordings", "quality.cjs");');
  return { text: lines.join("\n"), notes: ["npm test now checks picture quality too"] };
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
      } else if (entry.name === "quality.cjs") {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. Picture quality is back to how it was." : "Nothing to undo.");
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
    app: findOne("your App file", (t) => /function AuraApp\s*\(/.test(t) && /<AuraApp\b/.test(t), need, [
      (h) => /^App\.[jt]sx?$/.test(path.basename(h.file)),
    ]),
    calls: findOne("your voice calls file", (t) => /function CallBar\s*\(/.test(t) && /export function mountCallLayer\s*\(/.test(t), need + " Voice calls with screen share need to be installed first (aura-screen-share-setup.cjs).", [
      (h) => /^calls\.[jt]sx?$/.test(path.basename(h.file)),
    ]),
    main: findOne("your main file", (t) => /function createWindow\s*\(/.test(t) && /function finishPipeRecording\s*\(/.test(t), need, [
      (h) => startFile && sameFile(h.file, startFile),
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
  consider("App file", files.app, editApp, false);
  consider("main file", files.main, editMain, true);
  const runner = path.join(ROOT, "tests", "run.cjs");
  const hasChecks = fs.existsSync(runner);
  if (hasChecks) consider("checks", runner, editRunner, true);

  const created = [];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "quality.cjs"), content: FILES.test });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: the best picture quality");
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
  say("Done. Restart AURA (stop it in the terminal and start it again). Pick a quality in the Share Screen box, and in Settings > Recording.");
  if (hasChecks) say("Run  npm test  before your next release.");
  say("To undo later:  node aura-quality-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
