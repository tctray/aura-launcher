#!/usr/bin/env node
/**
 * AURA — a live stream makes room for your call
 *
 * The Twitch player is drawn on top of AURA's page, so while a stream was open it covered the
 * call's cameras, a shared screen, call settings, the Add box and the camera preview, and the
 * call screen opened behind it. Now:
 *   - the player gets shorter to make room for those panels (it keeps playing)
 *   - if there isn't room, or the call screen is open, it steps aside, still playing so you still
 *     hear it, and comes back when you close the panel
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-stream-room-setup.cjs
 *
 * What it does:
 *   - edits    electron/main.js, electron/preload.js, src/components/calls.jsx
 *   - creates  electron/streamroom.js, src/components/streamroom.js
 *   - creates  tests/stream-room.cjs   (only if AURA's checks are installed)
 *
 * Every file it changes is copied to <name>.before-stream-room.bak first.
 * To put everything back:                 node aura-stream-room-setup.cjs --undo
 * To preview without changing anything:   node aura-stream-room-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const crypto = require("crypto");

const FILES = {"edits":[{"file":"main","find":"const STREAM_BAR = 44; // height of that strip, in page pixels (the page draws a bar the same height)\nfunction fillWindowWithStream() {\n  if (!streamView || !mainWin) return;\n  const [w, h] = mainWin.getContentSize();\n  const bar = Math.round(STREAM_BAR * (mainWin.webContents.getZoomFactor() || 1));\n  streamView.setBounds({ x: 0, y: bar, width: w, height: Math.max(1, h - bar) });\n}\nfunction leaveStreamFull() {\n  if (!streamView || !streamView.__auraFull) return false;\n  streamView.__auraFull = false;\n  // Straight back to where it was; the page then lines it up exactly\n  if (streamView.__auraBefore) { try { streamView.setBounds(streamView.__auraBefore); } catch {} }\n  return true;\n}\n","replace":"const STREAM_BAR = 44; // height of that strip, in page pixels (the page draws a bar the same height)\n\n// ── Room for AURA's own panels over the stream (Added by aura-stream-room-setup.cjs) ──\n// The player and chat are drawn on top of AURA's page, so they make room for AURA's call cameras,\n// shared screens, call settings and camera preview (see streamroom.js). Every place that sizes\n// them goes through placeStream / placeChat.\nconst { fitStream, cleanRoom } = require(\"./streamroom\");\nlet streamRoom = { rects: [], all: false };\nfunction placeStream(want) {\n  if (!streamView || !mainWin || !want) return;\n  streamView.__auraWant = want;\n  const fit = fitStream(want, streamRoom, mainWin.webContents.getZoomFactor() || 1);\n  const shown = mainWin.getBrowserViews().includes(streamView);\n  if (!fit) {\n    // Steps aside, still playing\n    if (shown) mainWin.removeBrowserView(streamView);\n    streamView.__auraAside = true;\n    return;\n  }\n  if (streamView.__auraAside) { streamView.__auraAside = false; if (!shown) mainWin.addBrowserView(streamView); }\n  streamView.setBounds(fit);\n}\nfunction placeChat(want) {\n  const chat = mainWin?.chatView;\n  if (!chat || !want) return;\n  chat.__auraWant = want;\n  const shown = mainWin.getBrowserViews().includes(chat);\n  if (streamRoom.all) { if (shown) mainWin.removeBrowserView(chat); chat.__auraAside = true; return; }\n  if (chat.__auraAside) { chat.__auraAside = false; if (!shown) mainWin.addBrowserView(chat); }\n  chat.setBounds(want);\n}\nipcMain.handle(\"stream-room\", async (_e, room) => {\n  streamRoom = cleanRoom(room);\n  try {\n    if (streamView?.__auraWant) placeStream(streamView.__auraWant);\n    if (mainWin?.chatView?.__auraWant && (mainWin.chatView.__auraAside || streamRoom.all)) placeChat(mainWin.chatView.__auraWant);\n  } catch {}\n  return { success: true };\n});\n\nfunction fillWindowWithStream() {\n  if (!streamView || !mainWin) return;\n  const [w, h] = mainWin.getContentSize();\n  const bar = Math.round(STREAM_BAR * (mainWin.webContents.getZoomFactor() || 1));\n  placeStream({ x: 0, y: bar, width: w, height: Math.max(1, h - bar) });\n}\nfunction leaveStreamFull() {\n  if (!streamView || !streamView.__auraFull) return false;\n  streamView.__auraFull = false;\n  // Straight back to where it was; the page then lines it up exactly\n  if (streamView.__auraBefore) { try { placeStream(streamView.__auraBefore); } catch {} }\n  return true;\n}\n"},{"file":"main","find":"  if (!view.__auraFull) view.__auraBefore = view.getBounds();\n","replace":"  if (!view.__auraFull) view.__auraBefore = view.__auraWant || view.getBounds();\n"},{"file":"main","find":"    if (!mainWin.getBrowserViews().includes(streamView)) {\n      mainWin.addBrowserView(streamView);\n    }\n    streamView.setBounds(zoomBounds(bounds));\n    if (mainWin.chatView && chatBounds) {\n      if (!mainWin.getBrowserViews().includes(mainWin.chatView)) {\n        mainWin.addBrowserView(mainWin.chatView);\n      }\n      mainWin.chatView.setBounds(zoomBounds(chatBounds));\n    }","replace":"    if (!mainWin.getBrowserViews().includes(streamView)) {\n      mainWin.addBrowserView(streamView);\n    }\n    placeStream(zoomBounds(bounds));\n    if (mainWin.chatView && chatBounds) {\n      if (!mainWin.getBrowserViews().includes(mainWin.chatView)) {\n        mainWin.addBrowserView(mainWin.chatView);\n      }\n      placeChat(zoomBounds(chatBounds));\n    }"},{"file":"main","find":"  mainWin.addBrowserView(streamView);\n  streamView.setBounds(zoomBounds(bounds));\n  streamView.setAutoResize({ width: false, height: false });","replace":"  mainWin.addBrowserView(streamView);\n  placeStream(zoomBounds(bounds));\n  streamView.setAutoResize({ width: false, height: false });"},{"file":"main","find":"    streamView.setBounds({ x: b.x, y: b.y, width: Math.max(STREAM_MIN.width, b.width), height: Math.max(STREAM_MIN.height, b.height) });","replace":"    placeStream({ x: b.x, y: b.y, width: Math.max(STREAM_MIN.width, b.width), height: Math.max(STREAM_MIN.height, b.height) });"},{"file":"main","find":"  if (streamView) streamView.setBounds(zoomBounds(bounds));\n  return { success: true };","replace":"  if (streamView) placeStream(zoomBounds(bounds));\n  return { success: true };"},{"file":"main","find":"  mainWin.chatView.setBounds(zoomBounds(bounds));","replace":"  placeChat(zoomBounds(bounds));"},{"file":"preload","find":"  streamClose:  ()       => ipcRenderer.invoke(\"stream-close\"),\n","replace":"  streamClose:  ()       => ipcRenderer.invoke(\"stream-close\"),\n  streamRoom:   (room)   => ipcRenderer.invoke(\"stream-room\", room), // AURA's panels the stream makes room for (Added by aura-stream-room-setup.cjs)\n"},{"file":"calls","find":"import { cameraEffects } from \"./camfx\"; // your camera background in calls (Added by aura-camera-backgrounds-setup.cjs)\n","replace":"import { cameraEffects } from \"./camfx\"; // your camera background in calls (Added by aura-camera-backgrounds-setup.cjs)\nimport { watchStreamRoom } from \"./streamroom\"; // a Twitch stream makes room for call panels (Added by aura-stream-room-setup.cjs)\n"},{"file":"calls","find":"  const leaving = () => callActions.reset(); // AURA is closing or reloading: hang up\n  window.addEventListener(\"beforeunload\", leaving);\n  return () => {\n    window.removeEventListener(\"beforeunload\", leaving);","replace":"  const leaving = () => callActions.reset(); // AURA is closing or reloading: hang up\n  window.addEventListener(\"beforeunload\", leaving);\n  const stopRoom = watchStreamRoom(); // (Added by aura-stream-room-setup.cjs)\n  return () => {\n    stopRoom();\n    window.removeEventListener(\"beforeunload\", leaving);"}],"test":"// A Twitch stream makes room for AURA's own panels. The player is drawn on top of AURA's page, so\n// call cameras, a shared screen, call settings and the camera preview used to be hidden under it.\n// Checks the math (electron/streamroom.js), and, in two AURA windows in a call, that the page tells\n// the main process where those panels are.\n// Added by aura-stream-room-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst OLD = process.env.AURA_OLD_DIST || \"\";\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\nconst sleep = (ms) => new Promise((r) => setTimeout(r, ms));\n\nfunction serve(dir) {\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(dir, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => {\n      if (err) { res.writeHead(404); return res.end(); }\n      res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" });\n      res.end(data);\n    });\n  });\n  return new Promise((r) => server.listen(0, \"127.0.0.1\", () => r({ server, base: \"http://127.0.0.1:\" + server.address().port })));\n}\n\n// ── A pretend Supabase for calls, with groups (as in aura-calls-group.sql) ───\nfunction makeWorld() {\n  const people = {};    // id -> { page, name }\n  let calls = [], signals = [], nextSignal = 1, nextCall = 1;\n  const shape = (c, me) => ({ id: c.id, callerId: c.caller, calleeId: c.callee, peerId: c.caller === me ? c.callee : c.caller, outgoing: c.caller === me, status: c.status, reason: c.reason || null, groupId: c.group || null });\n  const tell = (id, event) => { const p = people[id]?.page; if (p) p.evaluate((e) => window.__deliver && window.__deliver(e), event).catch(() => {}); };\n  const both = (c) => { for (const id of [c.caller, c.callee]) tell(id, { type: \"call\", call: shape(c, id) }); };\n  const ok = (data) => ({ success: true, data });\n  const no = (error) => ({ success: false, error });\n  const end = (c, reason) => { if (c.status === \"ended\") return; c.status = \"ended\"; c.reason = reason || \"hangup\"; both(c); };\n  const live = () => calls.filter((x) => x.status !== \"ended\");\n  const busy = (id) => live().some((x) => x.caller === id || x.callee === id);\n  const groupPeople = (g) => new Set(live().filter((x) => x.group === g).flatMap((x) => [x.caller, x.callee]));\n  const handlers = {\n    start: (me) => ok({ id: me, username: people[me].name, live: true }),\n    listFriends: (me) => ok(Object.keys(people).filter((id) => id !== me).map((id) => ({ friendshipId: \"f-\" + id, userId: id, username: people[id].name, avatarUrl: \"\", state: \"friend\", since: null, online: true, lastSeenAt: new Date().toISOString() }))),\n    getProfile: (_me, id) => ok(people[id] ? { userId: id, username: people[id].name, bio: \"\", avatarUrl: \"\" } : null),\n    listConversations: () => ok([]), listBlocked: () => ok([]),\n    callConfig: () => ok({ iceServers: [], relay: false }),\n    currentCall: (me) => { const c = live().find((x) => x.caller === me || x.callee === me); return ok(c ? shape(c, me) : null); },\n    startCall: (me, other) => {\n      if (busy(me)) return no(\"You're already in a call.\");\n      if (busy(other)) return no(\"They're on another call. Try again in a bit.\");\n      const c = { id: \"call-\" + nextCall++, caller: me, callee: other, status: \"ringing\" };\n      calls.push(c);\n      tell(other, { type: \"call\", call: shape(c, other) });\n      return ok(shape(c, me));\n    },\n    answerCall: (me, id) => { const c = calls.find((x) => x.id === id && x.callee === me && x.status === \"ringing\"); if (!c) return no(\"That call has ended.\"); c.status = \"active\"; tell(c.caller, { type: \"call\", call: shape(c, c.caller) }); return ok(shape(c, me)); },\n    endCall: (me, id, reason) => { const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me)); if (c) end(c, c.status === \"ringing\" ? (me === c.callee ? \"declined\" : reason === \"missed\" ? \"missed\" : \"cancelled\") : reason === \"failed\" ? \"failed\" : \"hangup\"); return ok(c ? shape(c, me) : null); },\n    addToCall: (me, id, other) => {\n      if (world.noGroups) return no(\"Calls with 3 people aren't set up in Supabase yet. Run aura-calls-group.sql first.\");\n      const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me) && x.status === \"active\");\n      if (!c) return no(\"That call has ended.\");\n      const g = c.group || c.id;\n      if (!c.group) { c.group = g; both(c); }\n      const inCall = groupPeople(g);\n      if (inCall.has(other)) return no(\"They're already in this call.\");\n      if (inCall.size >= 3) return no(\"This call is full. Calls can have up to 3 people.\");\n      if (busy(other)) return no(\"They're on another call. Try again in a bit.\");\n      const n = { id: \"call-\" + nextCall++, caller: me, callee: other, status: \"ringing\", group: g };\n      calls.push(n);\n      world.added.push(n.id);\n      tell(other, { type: \"call\", call: shape(n, other) });\n      return ok(shape(n, me));\n    },\n    joinGroup: (me, id) => {\n      const c = calls.find((x) => x.id === id && x.callee === me && x.status === \"active\" && x.group);\n      if (!c) return no(\"That call has ended.\");\n      const made = [];\n      const others = new Set(live().filter((x) => x.group === c.group && x.status === \"active\").flatMap((x) => [x.caller, x.callee]));\n      others.delete(me);\n      for (const other of others) {\n        if (live().some((x) => x.group === c.group && ((x.caller === me && x.callee === other) || (x.caller === other && x.callee === me)))) continue;\n        const n = { id: \"call-\" + nextCall++, caller: me, callee: other, status: \"active\", group: c.group };\n        calls.push(n);\n        tell(other, { type: \"call\", call: shape(n, other) });\n        made.push(shape(n, me));\n      }\n      return ok(made);\n    },\n    callSignal: (me, id, kind, payload) => {\n      const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me));\n      if (!c || c.status !== \"active\") return no(\"That call isn't connected.\");\n      if (![\"offer\", \"answer\", \"ice\"].includes(kind)) return no(\"That isn't a valid call message.\");\n      if ((kind === \"offer\" && me !== c.caller) || (kind === \"answer\" && me !== c.callee)) return no(\"That isn't a valid call message.\");\n      if (typeof payload !== \"string\" || payload.length > 20000) return no(\"That call message is too long.\");\n      const to = c.caller === me ? c.callee : c.caller;\n      const s = { id: nextSignal++, call: id, from: me, to, kind, payload };\n      signals.push(s);\n      world.biggest = Math.max(world.biggest, payload.length);\n      tell(to, { type: \"signal\", callId: id, signal: { id: s.id, kind, payload } });\n      return ok(s.id);\n    },\n    callState: (me, id, from) => { const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me)); return ok({ call: c ? shape(c, me) : null, signals: signals.filter((s) => s.call === id && s.to === me && s.id > (from || 0)).map((s) => ({ id: s.id, kind: s.kind, payload: s.payload })) }); },\n    callBeat: (me, id) => { const c = calls.find((x) => x.id === id); return ok(c && c.status !== \"ended\" ? \"active\" : \"ended\"); },\n  };\n  const friendsChanged = () => Object.keys(people).forEach((id) => tell(id, { type: \"friends\" }));\n  const between = (x, y) => live().find((c) => (c.caller === x && c.callee === y) || (c.caller === y && c.callee === x)) || null;\n  const world = { people, handlers, biggest: 0, added: [], noGroups: false, friendsChanged, between, live, reset() { calls.forEach((c) => end(c, \"hangup\")); } };\n  return world;\n}\n\nasync function person(browser, world, base, id, name) {\n  const page = await (await browser.newContext({ viewport: { width: 1360, height: 860 }, permissions: [\"microphone\"] })).newPage();\n  const thrown = [];\n  page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n  world.people[id] = { page, name, thrown };\n  await page.exposeBinding(\"__social\", (_src, fn, args) => { const h = world.handlers[fn]; return h ? h(id, ...(args || [])) : { success: true, data: null }; });\n  await page.addInitScript(([id, name]) => {\n    try { localStorage.clear(); localStorage.setItem(\"aura_profile\", JSON.stringify({ username: name, avatar: \"\", userId: id })); } catch {}\n    const ok = (data) => Promise.resolve({ success: true, data });\n    const account = { getSession: () => ok({ id, email: name + \"@example.com\" }), getMyProfile: () => ok({ username: name, avatar_url: null }) };\n    window.auraCloud = new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => (account[key] ? account[key](...args) : ok(null))) });\n    window.auraSocial = new Proxy({}, {\n      get: (_t, key) => {\n        if (key === \"then\") return undefined;\n        if (key === \"onEvent\") return (cb) => { window.__deliver = cb; return () => { window.__deliver = null; }; };\n        return (...args) => window.__social(key, args);\n      },\n    });\n    // Screens and windows to pick from, like Windows would list them\n    const pic = (hue) => \"data:image/svg+xml;base64,\" + btoa(`<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"320\" height=\"180\"><rect width=\"320\" height=\"180\" fill=\"hsl(${hue},40%,35%)\"/></svg>`);\n    window.__chosen = [];\n    window.__room = [];\n    const desktop = {\n      getCaptureSources: () => Promise.resolve({ success: true, sources: [\n        { id: \"window:22:0\", name: \"Notepad\", thumbnail: pic(200), isScreen: false },\n        { id: \"screen:0:0\", name: \"Entire screen\", thumbnail: pic(20), isScreen: true },\n      ] }),\n      setCaptureSource: (sid) => { window.__chosen.push(sid); return Promise.resolve({ success: true }); },\n      streamRoom: (room) => { window.__room.push(room); return Promise.resolve({ success: true }); },\n    };\n    window.electronAPI = new Proxy({}, {\n      get: (_t, key) => {\n        if (key === \"isElectron\") return true;\n        if (typeof key !== \"string\" || key === \"then\") return undefined;\n        if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};\n        return (...args) => (desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }));\n      },\n    });\n    // Keep hold of every screen captured, to check it's switched off afterwards\n    window.__screens = [];\n    const realGDM = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);\n    navigator.mediaDevices.getDisplayMedia = async (...a) => { const s = await realGDM(...a); window.__screens.push(s); return s; };\n    // Keep hold of the connections, so the test can see what goes over them\n    const Real = window.RTCPeerConnection;\n    window.__pcs = [];\n    window.RTCPeerConnection = function (...a) { const pc = new Real(...a); window.__pcs.push(pc); return pc; };\n    window.RTCPeerConnection.prototype = Real.prototype;\n  }, [id, name]);\n  await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n  return page;\n}\n\n(async () => {\n  console.log(\"1. The player makes room (electron/streamroom.js)\");\n  const { fitStream, cleanRoom } = require(path.join(ROOT, \"electron\", \"streamroom.js\"));\n  const want = { x: 160, y: 120, width: 1400, height: 880 };\n  check(\"nothing in the way: the player stays where it is\", fitStream(want, { rects: [], all: false }) === want);\n  check(\"a panel off to the side changes nothing\", fitStream(want, { rects: [{ x: 1600, y: 200, width: 200, height: 200 }] }) === want);\n  let f = fitStream(want, { rects: [{ x: 700, y: 60, width: 340, height: 250 }] });\n  check(\"call cameras near the top: the player starts below them\", f && f.y === 318 && f.y + f.height === 1000 && f.x === 160 && f.width === 1400, f);\n  f = fitStream(want, { rects: [{ x: 1080, y: 700, width: 480, height: 300 }] });\n  check(\"a shared screen in the bottom corner: the player ends above it\", f && f.y === 120 && f.y + f.height === 692, f);\n  f = fitStream(want, { rects: [{ x: 700, y: 60, width: 340, height: 250 }] }, 1.25);\n  check(\"with AURA zoomed in, page sizes are turned into window sizes\", f && f.y === Math.ceil(310 * 1.25 + 10), f);\n  check(\"when there isn't room left, it steps aside (still playing)\", fitStream(want, { rects: [{ x: 700, y: 60, width: 340, height: 500 }, { x: 700, y: 640, width: 300, height: 300 }] }) === null);\n  check(\"the call screen needs the whole window: it steps aside\", fitStream(want, { rects: [], all: true }) === null);\n  const clean = cleanRoom({ all: \"yes\", rects: [{ x: 1, y: 2, width: 3, height: 4 }, { x: \"a\", y: 0, width: 5, height: 5 }, { x: 0, y: 0, width: -5, height: 5 }, ...Array(20).fill({ x: 0, y: 0, width: 1, height: 1 })] });\n  check(\"what the page sends is checked (numbers only, sizes above zero, the first 12 only, all only when true)\", clean.all === false && clean.rects.length === 10 && clean.rects[0].x === 1, clean);\n  const mainSrc = fs.readFileSync(path.join(ROOT, \"electron\", \"main.js\"), \"utf8\");\n  check(\"every place that sizes the player goes through placeStream\", (mainSrc.match(/streamView\\.setBounds\\(/g) || []).length === 1 && /function placeStream/.test(mainSrc));\n  check(\"...and the chat through placeChat\", !/chatView\\.setBounds\\(/.test(mainSrc) && /function placeChat/.test(mainSrc));\n\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(process.env.CI ? 1 : 3); }\n  const args = [\"--use-fake-ui-for-media-stream\", \"--use-fake-device-for-media-stream\", \"--auto-accept-this-tab-capture\", \"--autoplay-policy=no-user-gesture-required\"];\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch({ ...options, args }); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with. Run  npx playwright install chromium  once to add one.\"); return done(process.env.CI ? 1 : 3); }\n  const now = await serve(DIST);\n  const old = OLD && fs.existsSync(path.join(OLD, \"index.html\")) ? await serve(OLD) : null;\n\n  const until = async (fn, ms = 15000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); } catch { v = null; } if (v) return v; await sleep(200); } return v; };\n  const bar = (p) => p.locator(\".cx-bar\");\n  const barName = (p) => p.evaluate(() => document.querySelector(\".cx-bar .cx-name\")?.textContent || \"\");\n  const live = (p) => until(() => p.evaluate(() => !!document.querySelector(\".cx-bar.live\")));\n  const callFrom = async (from, to, toName) => {\n    await from.locator(`button.cx-call[title=\"Call ${toName}\"]`).first().click({ timeout: 10000 });\n    await until(() => to.evaluate(() => !!document.querySelector(\".cx-bar.ringing.in\")));\n    await to.locator(\".cx-btn.yes\").click({ timeout: 15000 });\n    return (await live(from)) && (await live(to));\n  };\n  const hangUp = async (p) => { await p.locator(\".cx-bar .cx-round.end\").click({ timeout: 15000 }).catch(() => {}); await sleep(1500); };\n  const openAdder = async (p) => { if (!(await p.locator(\".cx-bar .cx-adder\").count())) await p.locator(\".cx-bar .cx-round.add\").click({ timeout: 10000 }); await p.locator(\".cx-bar .cx-adder\").waitFor({ timeout: 10000 }); };\n  const addFrom = async (p, name) => {\n    await openAdder(p);\n    const row = p.locator(\".cx-adder .cx-add-row\", { hasText: name });\n    await row.first().waitFor({ timeout: 10000 });\n    await row.first().click();\n  };\n  // How much sound is arriving on each connection that is open\n  const hearing = (p) => p.evaluate(async () => {\n    const out = [];\n    for (const pc of window.__pcs.filter((x) => x.connectionState === \"connected\")) {\n      let a = 0;\n      (await pc.getStats()).forEach((r) => { if (r.type === \"inbound-rtp\" && r.kind === \"audio\") a = r.bytesReceived || 0; });\n      out.push(a);\n    }\n    return out;\n  });\n  // Every open connection is getting sound, and more of it than a moment ago\n  const allHear = async (p, count) => {\n    const before = await hearing(p);\n    await sleep(1500);\n    const after = await hearing(p);\n    return after.length === count && before.length === count && after.every((a, i) => a > before[i]) ? after : { before, after };\n  };\n  const thrown = (ids, world) => ids.flatMap((id) => world.people[id].thrown.filter((m) => !/reading 'live'/.test(m)));\n\n  try {\n    const world = makeWorld();\n    const A = await person(browser, world, now.base, \"user-A\", \"Alex\");\n    const B = await person(browser, world, now.base, \"user-B\", \"Bri\");\n    await sleep(5000);\n    world.friendsChanged();\n    await until(() => A.evaluate(() => !!document.querySelector('button.cx-call[title=\"Call Bri\"]')));\n    const room = (p) => p.evaluate(() => window.__room[window.__room.length - 1] || null);\n    const has = (r, box) => !!r && !r.all && r.rects.some((x) => Math.abs(x.x - box.x) <= 2 && Math.abs(x.y - box.y) <= 2 && Math.abs(x.width - box.width) <= 2 && Math.abs(x.height - box.height) <= 2);\n    const boxOf = (p, sel) => p.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } : null; }, sel);\n\n    console.log(\"2. The page says where its panels are\");\n    check(\"with no call, nothing needs room\", await until(async () => { const r = await room(A); return r && !r.all && r.rects.length === 0; }));\n    check(\"Alex calls Bri, Bri accepts\", await callFrom(A, B, \"Bri\"));\n    check(\"the call box needs room\", await until(async () => has(await room(A), await boxOf(A, \".cx-bar\"))));\n    await until(() => B.locator(\".cx-bar .cx-round.cam\").isEnabled());\n    await B.locator(\".cx-bar .cx-round.cam\").click();\n    await until(() => A.locator(\".cx-cams\").count());\n    check(\"the cameras under the call box need room\", await until(async () => has(await room(A), await boxOf(A, \".cx-cams\"))));\n    await A.locator(\".cx-bar [data-cx-devices]\").click();\n    check(\"so do the call settings while they're open\", await until(async () => has(await room(A), await boxOf(A, \".cx-devices\"))));\n    await A.keyboard.press(\"Escape\");\n    check(\"...and not once they're closed\", await until(async () => { const r = await room(A); return r && r.rects.length === 2; }));\n    await A.locator(\".cx-bar .cx-round.stage\").click();\n    check(\"the call screen needs the whole window\", await until(async () => (await room(A))?.all === true));\n    await A.keyboard.press(\"Escape\");\n    check(\"going back to the call box gives the stream its place back\", await until(async () => (await room(A))?.all === false));\n    await A.locator(\".aura-cam\").first().click();\n    check(\"the camera preview needs room too\", await until(async () => { const b = await boxOf(A, \".cam-pan\"); return b && has(await room(A), b); }));\n    await A.locator('.cam-pan button[aria-label=\"Close the camera\"]').first().click();\n    await hangUp(A);\n    check(\"after the call, nothing needs room again\", await until(async () => { const r = await room(A); return r && !r.all && r.rects.length === 0; }));\n    check(\"it only speaks up when something changes\", (await A.evaluate(() => window.__room.length)) < 40, await A.evaluate(() => window.__room.length));\n    check(\"nothing crashed along the way\", thrown([\"user-A\", \"user-B\"], world).length === 0, thrown([\"user-A\", \"user-B\"], world));\n  } finally {\n    await browser.close();\n    now.server.close();\n    if (old) old.server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The stream room check itself broke:\", e); process.exit(2); });\n","mainPart":"// Room for AURA's own panels over a Twitch stream. Added by aura-stream-room-setup.cjs\n//\n// The Twitch player (and its chat) are separate layers drawn on top of AURA's page, so anything\n// AURA shows where the player is (call cameras, a shared screen, call settings, the camera preview)\n// would be hidden under it. The page says where those panels are; the player makes room by getting\n// shorter (cut from the top for a panel in its upper half, from the bottom for one in its lower\n// half). If that would leave it smaller than Twitch allows, it steps aside instead: still playing,\n// so you still hear it, and back as soon as the panel goes. The call screen, or anything AURA puts\n// full screen, needs the whole window: then the player and chat both step aside.\n\"use strict\";\nconst MIN_HEIGHT = 300; // Twitch asks that its player is never shown smaller than 400 x 300\nconst GAP = 8;          // a little space between a panel and the player\n\n// What the page sent, checked: at most 12 rectangles of sensible numbers\nfunction cleanRoom(room) {\n  const num = (v) => (Number.isFinite(v) ? Math.max(-100000, Math.min(100000, Math.round(v))) : null);\n  const rects = [];\n  for (const r of Array.isArray(room?.rects) ? room.rects.slice(0, 12) : []) {\n    const x = num(r?.x), y = num(r?.y), width = num(r?.width), height = num(r?.height);\n    if (x === null || y === null || !(width > 0) || !(height > 0)) continue;\n    rects.push({ x, y, width, height });\n  }\n  return { rects, all: room?.all === true };\n}\n\n// Where the player goes, given where it wants to be (window pixels) and the room AURA needs\n// (page pixels, so `zoom` converts). null: step aside.\nfunction fitStream(want, room, zoom = 1) {\n  if (!want) return want;\n  if (room?.all) return null;\n  let top = want.y, bottom = want.y + want.height;\n  const mid = want.y + want.height / 2;\n  for (const p of room?.rects || []) {\n    const r = { x: p.x * zoom, y: p.y * zoom, width: p.width * zoom, height: p.height * zoom };\n    if (r.x >= want.x + want.width || r.x + r.width <= want.x || r.y >= bottom || r.y + r.height <= top) continue;\n    if (r.y + r.height / 2 < mid) top = Math.max(top, Math.ceil(r.y + r.height + GAP * zoom));\n    else bottom = Math.min(bottom, Math.floor(r.y - GAP * zoom));\n  }\n  if (top === want.y && bottom === want.y + want.height) return want;\n  const height = bottom - top;\n  if (height < Math.min(MIN_HEIGHT * zoom, want.height)) return null;\n  return { x: want.x, y: top, width: want.width, height };\n}\n\nmodule.exports = { fitStream, cleanRoom };\n","pagePart":"// Tells AURA's main process where AURA's own panels are, so a Twitch stream (drawn on top of the\n// page) makes room for them instead of hiding them. See electron/streamroom.js.\n// Added by aura-stream-room-setup.cjs\nconst PANELS = \".cx-bar, .cx-cams, .cx-cams-pill, .cx-devices, .cx-screen:not(.full), .cx-screen-pill, .cam-pan, .cam-pill\";\nconst WHOLE = \".cx-stage, .cx-screen.full\"; // these need the whole window\n\nexport function watchStreamRoom() {\n  const api = window.electronAPI;\n  if (typeof api?.streamRoom !== \"function\") return () => {};\n  let last = \"\";\n  const check = () => {\n    const full = document.fullscreenElement;\n    const all = !!document.querySelector(WHOLE) || (!!full && !full.classList?.contains(\"stream-full-bar\"));\n    const rects = all ? [] : [...document.querySelectorAll(PANELS)]\n      .map((el) => el.getBoundingClientRect())\n      .filter((r) => r.width > 0 && r.height > 0)\n      .map((r) => ({ x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }));\n    const sig = JSON.stringify([all, rects]);\n    if (sig === last) return;\n    last = sig;\n    try { Promise.resolve(api.streamRoom({ all, rects })).catch(() => {}); } catch {}\n  };\n  // Panels open, close and get dragged: a quick look a few times a second is enough\n  const timer = setInterval(check, 250);\n  document.addEventListener(\"fullscreenchange\", check);\n  check();\n  return () => {\n    clearInterval(timer);\n    document.removeEventListener(\"fullscreenchange\", check);\n    try { Promise.resolve(api.streamRoom({ all: false, rects: [] })).catch(() => {}); } catch {}\n  };\n}\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-stream-room.bak";
const MARK = "Added by aura-stream-room-setup.cjs";
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



const EDITS = FILES.edits;
function applyEdits(key) {
  return (text) => {
    if (text.includes(MARK)) return { text, notes: [] };
    let t = text;
    for (const e of EDITS.filter((x) => x.file === key)) t = swapOnce(t, e.find, e.replace, "the spot for: " + e.find.trim().split("\n")[0].slice(0, 90));
    return { text: t, notes: { main: ["the stream player and chat make room for AURA's panels, or step aside"], preload: ["the window can tell the player where its panels are"], calls: ["the call layer reports where its panels are"] }[key] };
  };
}
function editRunner(text) {
  if (/stream-room\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  let at = -1;
  for (let i = 0; i < lines.length; i++) if (/add\("window",/.test(lines[i])) at = i;
  if (at < 0) return { text, notes: ["(couldn't find where to add the check, so npm test doesn't include it)"] };
  lines.splice(at + 1, 0, 'if (fs.existsSync(path.join(__dirname, "stream-room.cjs"))) add("window", "A live stream makes room for call panels", "stream-room.cjs");');
  return { text: lines.join("\n"), notes: ["npm test checks it too"] };
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
      } else if ((entry.name === "stream-room.cjs" || entry.name === "streamroom.js")) {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished." : "Nothing to undo.");
  say();
}

function run() {
  const pkgFile = path.join(ROOT, "package.json");
  if (!fs.existsSync(pkgFile)) stop(["This isn't your AURA project folder (no package.json here).", "Move this file next to package.json and run it from there."]);
  if (UNDO) return undo();
  const need = "Make sure this file is in your AURA project folder, next to package.json.";
  const comp = (h) => /[\\/]components[\\/]/.test(h.file);
  let pkgMain = "";
  try { pkgMain = String(JSON.parse(fs.readFileSync(pkgFile, "utf8")).main || ""); } catch {}
  const files = {
    main: findOne("the main process file (main.js)", (t) => /ipcMain\.handle\("stream-open"/.test(t) && /function fillWindowWithStream\(/.test(t), need, [(h) => pkgMain && sameFile(h.file, path.resolve(ROOT, pkgMain)), (h) => /^main\.js$/.test(path.basename(h.file))]),
    preload: findOne("the preload file", (t) => /stream-close/.test(t) && /contextBridge/.test(t), need, [(h) => /^preload\.js$/.test(path.basename(h.file))]),
    calls: findOne("your calls file (calls.jsx)", (t) => /export const callActions\b/.test(t) && /export function mountCallLayer\b/.test(t), need, [comp]),
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
  consider("main process", files.main, applyEdits("main"), true);
  consider("preload", files.preload, applyEdits("preload"), true);
  consider("calls", files.calls, applyEdits("calls"), false);
  const runner = path.join(ROOT, "tests", "run.cjs");
  const hasChecks = fs.existsSync(runner);
  if (hasChecks) consider("checks", runner, editRunner, true);
  const created = [
    { label: "player", file: path.join(path.dirname(files.main), "streamroom.js"), content: FILES.mainPart },
    { label: "page", file: path.join(path.dirname(files.calls), "streamroom.js"), content: FILES.pagePart },
  ];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "stream-room.cjs"), content: FILES.test });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: a live stream makes room for your call");
  say();
  for (const step of plan) {
    if (step.after !== step.before && !DRY) {
      const bak = step.file + BAK;
      if (!fs.existsSync(bak)) fs.copyFileSync(step.file, bak);
      fs.writeFileSync(step.file, withEol(step.after, step.eol));
    }
    say("  " + (step.label + ":").padEnd(14) + rel(step.file));
    (step.notes.length ? step.notes : ["already done"]).forEach((n) => say("                - " + n));
  }
  for (const c of created) {
    if (c.note !== "already done" && !DRY) { fs.mkdirSync(path.dirname(c.file), { recursive: true }); fs.writeFileSync(c.file, c.content); }
    say("  " + (c.label + ":").padEnd(14) + rel(c.file));
    say("                - " + c.note);
  }
  say();
  if (DRY) { say("Run it again without --dry-run to apply."); say(); return; }
  say("Done. Restart AURA. Open a stream during a call: the player makes room for the call's panels.");
  if (hasChecks) say("Run  npm test  before your next release.");
  say("To undo later:  node aura-stream-room-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
