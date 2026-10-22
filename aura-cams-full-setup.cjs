#!/usr/bin/env node
/**
 * AURA — call cameras full screen
 *
 * The cameras under the call box get a Full screen button (top right of the camera panel, shown
 * when you point at it). Double-clicking a camera does the same. The cameras fill your monitor,
 * with yours small in the corner; with 3 people the other two sit side by side.
 * Esc, the button or another double-click goes back.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-cams-full-setup.cjs
 *
 * What it does:
 *   - edits    src/components/calls.jsx
 *   - creates  tests/cams-full.cjs   (only if AURA's checks are installed)
 *
 * Every file it changes is copied to <name>.before-cams-full.bak first.
 * To put everything back:                 node aura-cams-full-setup.cjs --undo
 * To preview without changing anything:   node aura-cams-full-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const crypto = require("crypto");

const FILES = {"edits":[{"file":"calls","find":"function CallCams({ call }) {\n  const [big, setBig] = useState(false);\n  const [hidden, setHidden] = useState(false);\n  const theirs = camsOf();","replace":"function CallCams({ call }) {\n  const [big, setBig] = useState(false);\n  const [hidden, setHidden] = useState(false);\n  // Full screen: the cameras fill your whole monitor (Added by aura-cams-full-setup.cjs). Asked for in the click itself, on\n  // the panel already showing (Windows says no otherwise). If it still can't, they fill AURA's window.\n  const box = useRef(null);\n  const [full, setFull] = useState(false);\n  useEffect(() => {\n    if (!full) return;\n    const changed = () => { if (document.fullscreenElement !== box.current) setFull(false); };\n    const esc = (e) => { if (e.key === \"Escape\") setFull(false); };\n    document.addEventListener(\"fullscreenchange\", changed);\n    window.addEventListener(\"keydown\", esc);\n    return () => {\n      document.removeEventListener(\"fullscreenchange\", changed);\n      window.removeEventListener(\"keydown\", esc);\n      if (box.current && document.fullscreenElement === box.current) document.exitFullscreen().catch(() => {});\n    };\n  }, [full]);\n  const goFull = () => {\n    const el = box.current;\n    try { if (el && document.fullscreenElement !== el) el.requestFullscreen?.({ navigationUI: \"hide\" })?.catch?.(() => {}); } catch {}\n    setFull(true);\n  };\n  const leaveFull = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); setFull(false); };\n  const theirs = camsOf();"},{"file":"calls","find":"  if (!theirs.length && !mine) return null;\n  if (hidden) return (","replace":"  if (!theirs.length && !mine) return null;\n  if (hidden && !full) return ("},{"file":"calls","find":"    <div className={`cx-cams ${theirs.length ? \"two\" : \"solo\"} ${duo ? \"duo\" : \"\"} ${big ? \"big\" : \"\"}`} role=\"region\" aria-label=\"Cameras\">","replace":"    <div ref={box} className={`cx-cams ${theirs.length ? \"two\" : \"solo\"} ${duo ? \"duo\" : \"\"} ${big ? \"big\" : \"\"} ${full ? \"full\" : \"\"}`} role=\"region\" aria-label=\"Cameras\"\n      onDoubleClick={(e) => { if (!e.target.closest(\"button\")) (full ? leaveFull() : goFull()); }}>"},{"file":"calls","find":"      <div className=\"cx-cam-tools\">\n        {theirs.length > 0 && <button type=\"button\" onClick={() => setBig((b) => !b)}","replace":"      {full && <span className=\"cx-cam-hint\">Press Esc to exit full screen</span>}\n      <div className=\"cx-cam-tools\">\n        <button type=\"button\" className=\"cx-cam-full\" onClick={full ? leaveFull : goFull} title={full ? \"Exit full screen (Esc)\" : \"Full screen\"} aria-label={full ? \"Exit full screen\" : \"Full screen\"}>{full ? <IconShrink /> : <IconExpand />}</button>{/* (Added by aura-cams-full-setup.cjs) */}\n        {theirs.length > 0 && !full && <button type=\"button\" onClick={() => setBig((b) => !b)}"},{"file":"calls","find":"        <button type=\"button\" onClick={() => setHidden(true)} title=\"Hide the cameras\" aria-label=\"Hide the cameras\">–</button>\n      </div>","replace":"        {!full && <button type=\"button\" onClick={() => setHidden(true)} title=\"Hide the cameras\" aria-label=\"Hide the cameras\">–</button>}\n      </div>"},{"file":"calls","find":"    if (e.button !== 0 || e.target.closest(\"button:not(.cx-grip),select,input,.cx-devices\")) return;","replace":"    if (e.button !== 0 || e.target.closest(\"button:not(.cx-grip),select,input,.cx-devices,.cx-cams.full\")) return;"},{"file":"calls","find":".reduce-motion .cx-bar,","replace":"/* Call cameras full screen (Added by aura-cams-full-setup.cjs) */\n.cx-cams.full,.cx-cams:fullscreen{position:fixed;inset:0!important;width:100vw!important;height:100vh!important;max-width:none;aspect-ratio:auto;transform:none;border-radius:0;border:none;box-shadow:none;z-index:9650;cursor:default}\n.cx-bar:has(.cx-cams.full){transform:none;backdrop-filter:none;animation:none}\n.cx-cams.full video:not(.small),.cx-cams:fullscreen video:not(.small){object-fit:contain}\n.cx-cams.full video.small{inset:auto 24px 24px auto;width:min(22%,360px)}\n.cx-cams.full .cx-cam-pair{gap:4px}\n.cx-cams.full .cx-cam-name{left:16px;bottom:16px;padding:4px 12px;font-size:14px}\n.cx-cams.full .cx-cam-tools{top:16px;right:16px;opacity:1}\n.cx-cams.full .cx-cam-tools button{width:36px;height:36px;border-radius:9px}\n.cx-cam-hint{position:absolute;top:22px;left:50%;transform:translateX(-50%);padding:4px 12px;border-radius:999px;background:rgba(0,0,0,.55);font:500 12px 'DM Sans',sans-serif;color:rgba(255,255,255,.75);pointer-events:none}\n.reduce-motion .cx-bar,"}],"test":"// The cameras in a call can go full screen: the button on the camera panel (or a double-click)\n// fills the monitor, Esc or the button goes back. Two AURA windows in a call, in a real browser.\n// Added by aura-cams-full-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst OLD = process.env.AURA_OLD_DIST || \"\";\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\nconst sleep = (ms) => new Promise((r) => setTimeout(r, ms));\n\nfunction serve(dir) {\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(dir, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => {\n      if (err) { res.writeHead(404); return res.end(); }\n      res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" });\n      res.end(data);\n    });\n  });\n  return new Promise((r) => server.listen(0, \"127.0.0.1\", () => r({ server, base: \"http://127.0.0.1:\" + server.address().port })));\n}\n\n// ── A pretend Supabase for calls, with groups (as in aura-calls-group.sql) ───\nfunction makeWorld() {\n  const people = {};    // id -> { page, name }\n  let calls = [], signals = [], nextSignal = 1, nextCall = 1;\n  const shape = (c, me) => ({ id: c.id, callerId: c.caller, calleeId: c.callee, peerId: c.caller === me ? c.callee : c.caller, outgoing: c.caller === me, status: c.status, reason: c.reason || null, groupId: c.group || null });\n  const tell = (id, event) => { const p = people[id]?.page; if (p) p.evaluate((e) => window.__deliver && window.__deliver(e), event).catch(() => {}); };\n  const both = (c) => { for (const id of [c.caller, c.callee]) tell(id, { type: \"call\", call: shape(c, id) }); };\n  const ok = (data) => ({ success: true, data });\n  const no = (error) => ({ success: false, error });\n  const end = (c, reason) => { if (c.status === \"ended\") return; c.status = \"ended\"; c.reason = reason || \"hangup\"; both(c); };\n  const live = () => calls.filter((x) => x.status !== \"ended\");\n  const busy = (id) => live().some((x) => x.caller === id || x.callee === id);\n  const groupPeople = (g) => new Set(live().filter((x) => x.group === g).flatMap((x) => [x.caller, x.callee]));\n  const handlers = {\n    start: (me) => ok({ id: me, username: people[me].name, live: true }),\n    listFriends: (me) => ok(Object.keys(people).filter((id) => id !== me).map((id) => ({ friendshipId: \"f-\" + id, userId: id, username: people[id].name, avatarUrl: \"\", state: \"friend\", since: null, online: true, lastSeenAt: new Date().toISOString() }))),\n    getProfile: (_me, id) => ok(people[id] ? { userId: id, username: people[id].name, bio: \"\", avatarUrl: \"\" } : null),\n    listConversations: () => ok([]), listBlocked: () => ok([]),\n    callConfig: () => ok({ iceServers: [], relay: false }),\n    currentCall: (me) => { const c = live().find((x) => x.caller === me || x.callee === me); return ok(c ? shape(c, me) : null); },\n    startCall: (me, other) => {\n      if (busy(me)) return no(\"You're already in a call.\");\n      if (busy(other)) return no(\"They're on another call. Try again in a bit.\");\n      const c = { id: \"call-\" + nextCall++, caller: me, callee: other, status: \"ringing\" };\n      calls.push(c);\n      tell(other, { type: \"call\", call: shape(c, other) });\n      return ok(shape(c, me));\n    },\n    answerCall: (me, id) => { const c = calls.find((x) => x.id === id && x.callee === me && x.status === \"ringing\"); if (!c) return no(\"That call has ended.\"); c.status = \"active\"; tell(c.caller, { type: \"call\", call: shape(c, c.caller) }); return ok(shape(c, me)); },\n    endCall: (me, id, reason) => { const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me)); if (c) end(c, c.status === \"ringing\" ? (me === c.callee ? \"declined\" : reason === \"missed\" ? \"missed\" : \"cancelled\") : reason === \"failed\" ? \"failed\" : \"hangup\"); return ok(c ? shape(c, me) : null); },\n    addToCall: (me, id, other) => {\n      if (world.noGroups) return no(\"Calls with 3 people aren't set up in Supabase yet. Run aura-calls-group.sql first.\");\n      const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me) && x.status === \"active\");\n      if (!c) return no(\"That call has ended.\");\n      const g = c.group || c.id;\n      if (!c.group) { c.group = g; both(c); }\n      const inCall = groupPeople(g);\n      if (inCall.has(other)) return no(\"They're already in this call.\");\n      if (inCall.size >= 3) return no(\"This call is full. Calls can have up to 3 people.\");\n      if (busy(other)) return no(\"They're on another call. Try again in a bit.\");\n      const n = { id: \"call-\" + nextCall++, caller: me, callee: other, status: \"ringing\", group: g };\n      calls.push(n);\n      world.added.push(n.id);\n      tell(other, { type: \"call\", call: shape(n, other) });\n      return ok(shape(n, me));\n    },\n    joinGroup: (me, id) => {\n      const c = calls.find((x) => x.id === id && x.callee === me && x.status === \"active\" && x.group);\n      if (!c) return no(\"That call has ended.\");\n      const made = [];\n      const others = new Set(live().filter((x) => x.group === c.group && x.status === \"active\").flatMap((x) => [x.caller, x.callee]));\n      others.delete(me);\n      for (const other of others) {\n        if (live().some((x) => x.group === c.group && ((x.caller === me && x.callee === other) || (x.caller === other && x.callee === me)))) continue;\n        const n = { id: \"call-\" + nextCall++, caller: me, callee: other, status: \"active\", group: c.group };\n        calls.push(n);\n        tell(other, { type: \"call\", call: shape(n, other) });\n        made.push(shape(n, me));\n      }\n      return ok(made);\n    },\n    callSignal: (me, id, kind, payload) => {\n      const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me));\n      if (!c || c.status !== \"active\") return no(\"That call isn't connected.\");\n      if (![\"offer\", \"answer\", \"ice\"].includes(kind)) return no(\"That isn't a valid call message.\");\n      if ((kind === \"offer\" && me !== c.caller) || (kind === \"answer\" && me !== c.callee)) return no(\"That isn't a valid call message.\");\n      if (typeof payload !== \"string\" || payload.length > 20000) return no(\"That call message is too long.\");\n      const to = c.caller === me ? c.callee : c.caller;\n      const s = { id: nextSignal++, call: id, from: me, to, kind, payload };\n      signals.push(s);\n      world.biggest = Math.max(world.biggest, payload.length);\n      tell(to, { type: \"signal\", callId: id, signal: { id: s.id, kind, payload } });\n      return ok(s.id);\n    },\n    callState: (me, id, from) => { const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me)); return ok({ call: c ? shape(c, me) : null, signals: signals.filter((s) => s.call === id && s.to === me && s.id > (from || 0)).map((s) => ({ id: s.id, kind: s.kind, payload: s.payload })) }); },\n    callBeat: (me, id) => { const c = calls.find((x) => x.id === id); return ok(c && c.status !== \"ended\" ? \"active\" : \"ended\"); },\n  };\n  const friendsChanged = () => Object.keys(people).forEach((id) => tell(id, { type: \"friends\" }));\n  const between = (x, y) => live().find((c) => (c.caller === x && c.callee === y) || (c.caller === y && c.callee === x)) || null;\n  const world = { people, handlers, biggest: 0, added: [], noGroups: false, friendsChanged, between, live, reset() { calls.forEach((c) => end(c, \"hangup\")); } };\n  return world;\n}\n\nasync function person(browser, world, base, id, name) {\n  const page = await (await browser.newContext({ viewport: { width: 1360, height: 860 }, permissions: [\"microphone\"] })).newPage();\n  const thrown = [];\n  page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n  world.people[id] = { page, name, thrown };\n  await page.exposeBinding(\"__social\", (_src, fn, args) => { const h = world.handlers[fn]; return h ? h(id, ...(args || [])) : { success: true, data: null }; });\n  await page.addInitScript(([id, name]) => {\n    try { localStorage.clear(); localStorage.setItem(\"aura_profile\", JSON.stringify({ username: name, avatar: \"\", userId: id })); } catch {}\n    const ok = (data) => Promise.resolve({ success: true, data });\n    const account = { getSession: () => ok({ id, email: name + \"@example.com\" }), getMyProfile: () => ok({ username: name, avatar_url: null }) };\n    window.auraCloud = new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => (account[key] ? account[key](...args) : ok(null))) });\n    window.auraSocial = new Proxy({}, {\n      get: (_t, key) => {\n        if (key === \"then\") return undefined;\n        if (key === \"onEvent\") return (cb) => { window.__deliver = cb; return () => { window.__deliver = null; }; };\n        return (...args) => window.__social(key, args);\n      },\n    });\n    // Screens and windows to pick from, like Windows would list them\n    const pic = (hue) => \"data:image/svg+xml;base64,\" + btoa(`<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"320\" height=\"180\"><rect width=\"320\" height=\"180\" fill=\"hsl(${hue},40%,35%)\"/></svg>`);\n    window.__chosen = [];\n    window.__room = [];\n    const desktop = {\n      getCaptureSources: () => Promise.resolve({ success: true, sources: [\n        { id: \"window:22:0\", name: \"Notepad\", thumbnail: pic(200), isScreen: false },\n        { id: \"screen:0:0\", name: \"Entire screen\", thumbnail: pic(20), isScreen: true },\n      ] }),\n      setCaptureSource: (sid) => { window.__chosen.push(sid); return Promise.resolve({ success: true }); },\n      streamRoom: (room) => { window.__room.push(room); return Promise.resolve({ success: true }); },\n    };\n    window.electronAPI = new Proxy({}, {\n      get: (_t, key) => {\n        if (key === \"isElectron\") return true;\n        if (typeof key !== \"string\" || key === \"then\") return undefined;\n        if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};\n        return (...args) => (desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }));\n      },\n    });\n    // Keep hold of every screen captured, to check it's switched off afterwards\n    window.__screens = [];\n    const realGDM = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);\n    navigator.mediaDevices.getDisplayMedia = async (...a) => { const s = await realGDM(...a); window.__screens.push(s); return s; };\n    // Keep hold of the connections, so the test can see what goes over them\n    const Real = window.RTCPeerConnection;\n    window.__pcs = [];\n    window.RTCPeerConnection = function (...a) { const pc = new Real(...a); window.__pcs.push(pc); return pc; };\n    window.RTCPeerConnection.prototype = Real.prototype;\n  }, [id, name]);\n  await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n  return page;\n}\n\n(async () => {\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(process.env.CI ? 1 : 3); }\n  const args = [\"--use-fake-ui-for-media-stream\", \"--use-fake-device-for-media-stream\", \"--auto-accept-this-tab-capture\", \"--autoplay-policy=no-user-gesture-required\"];\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch({ ...options, args }); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with. Run  npx playwright install chromium  once to add one.\"); return done(process.env.CI ? 1 : 3); }\n  const now = await serve(DIST);\n  const old = OLD && fs.existsSync(path.join(OLD, \"index.html\")) ? await serve(OLD) : null;\n\n  const until = async (fn, ms = 15000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); } catch { v = null; } if (v) return v; await sleep(200); } return v; };\n  const bar = (p) => p.locator(\".cx-bar\");\n  const barName = (p) => p.evaluate(() => document.querySelector(\".cx-bar .cx-name\")?.textContent || \"\");\n  const live = (p) => until(() => p.evaluate(() => !!document.querySelector(\".cx-bar.live\")));\n  const callFrom = async (from, to, toName) => {\n    await from.locator(`button.cx-call[title=\"Call ${toName}\"]`).first().click({ timeout: 10000 });\n    await until(() => to.evaluate(() => !!document.querySelector(\".cx-bar.ringing.in\")));\n    await to.locator(\".cx-btn.yes\").click({ timeout: 15000 });\n    return (await live(from)) && (await live(to));\n  };\n  const hangUp = async (p) => { await p.locator(\".cx-bar .cx-round.end\").click({ timeout: 15000 }).catch(() => {}); await sleep(1500); };\n  const openAdder = async (p) => { if (!(await p.locator(\".cx-bar .cx-adder\").count())) await p.locator(\".cx-bar .cx-round.add\").click({ timeout: 10000 }); await p.locator(\".cx-bar .cx-adder\").waitFor({ timeout: 10000 }); };\n  const addFrom = async (p, name) => {\n    await openAdder(p);\n    const row = p.locator(\".cx-adder .cx-add-row\", { hasText: name });\n    await row.first().waitFor({ timeout: 10000 });\n    await row.first().click();\n  };\n  // How much sound is arriving on each connection that is open\n  const hearing = (p) => p.evaluate(async () => {\n    const out = [];\n    for (const pc of window.__pcs.filter((x) => x.connectionState === \"connected\")) {\n      let a = 0;\n      (await pc.getStats()).forEach((r) => { if (r.type === \"inbound-rtp\" && r.kind === \"audio\") a = r.bytesReceived || 0; });\n      out.push(a);\n    }\n    return out;\n  });\n  // Every open connection is getting sound, and more of it than a moment ago\n  const allHear = async (p, count) => {\n    const before = await hearing(p);\n    await sleep(1500);\n    const after = await hearing(p);\n    return after.length === count && before.length === count && after.every((a, i) => a > before[i]) ? after : { before, after };\n  };\n  const thrown = (ids, world) => ids.flatMap((id) => world.people[id].thrown.filter((m) => !/reading 'live'/.test(m)));\n\n  try {\n    const world = makeWorld();\n    const A = await person(browser, world, now.base, \"user-A\", \"Alex\");\n    const B = await person(browser, world, now.base, \"user-B\", \"Bri\");\n    await sleep(5000);\n    world.friendsChanged();\n    await until(() => A.evaluate(() => !!document.querySelector('button.cx-call[title=\"Call Bri\"]')));\n    const state = (p) => p.evaluate(() => {\n      const el = document.querySelector(\".cx-cams\");\n      if (!el) return null;\n      const r = el.getBoundingClientRect();\n      const v = el.querySelector(\".cx-cam-theirs\") || el.querySelector(\"video\");\n      return { fs: document.fullscreenElement === el, fills: Math.round(r.width) >= innerWidth - 1 && Math.round(r.height) >= innerHeight - 1 && r.left <= 1 && r.top <= 1, w: Math.round(r.width), playing: !!v && v.videoWidth > 0 };\n    });\n    const isFull = async (p) => { const s = await state(p); return s && (s.fs || s.fills) && s.playing ? s : null; };\n    const isSmall = async (p) => { const s = await state(p); return s && !s.fs && !s.fills && s.w <= 700 ? s : null; };\n\n    console.log(\"1. Their camera, full screen\");\n    check(\"Alex calls Bri, Bri accepts\", await callFrom(A, B, \"Bri\"));\n    await until(() => B.locator(\".cx-bar .cx-round.cam\").isEnabled());\n    await B.locator(\".cx-bar .cx-round.cam\").click();\n    check(\"Alex sees Bri's camera under the call box\", await until(async () => (await state(A))?.playing, 20000));\n    await A.locator(\".cx-cams\").hover();\n    const btn = A.locator('.cx-cams button[aria-label=\"Full screen\"]');\n    check(\"the camera panel has a Full screen button\", await btn.isVisible());\n    await btn.click();\n    let s = await until(() => isFull(A), 8000);\n    check(\"pressing it fills the screen with the camera\", !!s, await state(A));\n    if (s && !s.fs) note(\"this browser didn't allow full screen, so it filled the window instead (AURA does the same if Windows says no)\");\n    check(\"it says how to get out\", /Esc/.test(await A.locator(\".cx-cams\").innerText()));\n    if (process.env.AURA_SHOT_DIR) await A.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, \"cams-full.png\") });\n    await A.keyboard.press(\"Escape\");\n    check(\"Esc puts it back under the call box\", !!(await until(() => isSmall(A), 8000)), await state(A));\n    await A.locator(\".cx-cams .cx-cam-theirs\").dblclick();\n    check(\"double-clicking the camera goes full screen too\", !!(await until(() => isFull(A), 8000)), await state(A));\n    await A.locator('.cx-cams button[aria-label=\"Exit full screen\"]').click();\n    check(\"and the button brings it back\", !!(await until(() => isSmall(A), 8000)), await state(A));\n    check(\"the call carried on throughout\", (await A.locator(\".cx-bar.live\").count()) === 1);\n\n    console.log(\"2. Your own camera, full screen\");\n    await B.locator(\".cx-bar .cx-round.cam.on\").click();\n    await until(() => A.locator(\".cx-bar .cx-round.cam\").isEnabled());\n    await A.locator(\".cx-bar .cx-round.cam\").click();\n    check(\"with only your camera on, it can go full screen as well\", await until(async () => (await state(A))?.playing, 15000) && (await A.locator(\".cx-cams\").hover().then(() => A.locator('.cx-cams button[aria-label=\"Full screen\"]').click()).then(() => until(() => isFull(A), 8000))));\n    await A.keyboard.press(\"Escape\");\n    await until(() => isSmall(A), 8000);\n    await hangUp(A);\n    check(\"hanging up takes it all away\", await until(async () => !(await A.locator(\".cx-cams\").count())));\n    check(\"nothing crashed along the way\", thrown([\"user-A\", \"user-B\"], world).length === 0, thrown([\"user-A\", \"user-B\"], world));\n  } finally {\n    await browser.close();\n    now.server.close();\n    if (old) old.server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The camera full screen check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-cams-full.bak";
const MARK = "Added by aura-cams-full-setup.cjs";
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
    return { text: t, notes: ["the call cameras get a Full screen button (and double-click)", "Esc or the button goes back"] };
  };
}
function editRunner(text) {
  if (/cams-full\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  let at = -1;
  for (let i = 0; i < lines.length; i++) if (/add\("window",/.test(lines[i])) at = i;
  if (at < 0) return { text, notes: ["(couldn't find where to add the check, so npm test doesn't include it)"] };
  lines.splice(at + 1, 0, 'if (fs.existsSync(path.join(__dirname, "cams-full.cjs"))) add("window", "Call cameras full screen", "cams-full.cjs");');
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
      } else if (entry.name === "cams-full.cjs") {
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
  const files = {
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
  consider("calls", files.calls, applyEdits("calls"), false);
  const runner = path.join(ROOT, "tests", "run.cjs");
  const hasChecks = fs.existsSync(runner);
  if (hasChecks) consider("checks", runner, editRunner, true);
  const created = [];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "cams-full.cjs"), content: FILES.test });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: call cameras full screen");
  say();
  for (const step of plan) {
    if (step.after !== step.before && !DRY) {
      const bak = step.file + BAK;
      if (!fs.existsSync(bak)) fs.copyFileSync(step.file, bak);
      fs.writeFileSync(step.file, withEol(step.after, step.eol));
    }
    say("  " + (step.label + ":").padEnd(10) + rel(step.file));
    (step.notes.length ? step.notes : ["already done"]).forEach((n) => say("            - " + n));
  }
  for (const c of created) {
    if (c.note !== "already done" && !DRY) { fs.mkdirSync(path.dirname(c.file), { recursive: true }); fs.writeFileSync(c.file, c.content); }
    say("  " + (c.label + ":").padEnd(10) + rel(c.file));
    say("            - " + c.note);
  }
  say();
  if (DRY) { say("Run it again without --dry-run to apply."); say(); return; }
  say("Done. Restart AURA. In a call, point at the cameras and press the full screen button (or double-click).");
  if (hasChecks) say("Run  npm test  before your next release.");
  say("To undo later:  node aura-cams-full-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
