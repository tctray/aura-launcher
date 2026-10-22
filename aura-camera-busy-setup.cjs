#!/usr/bin/env node
/**
 * AURA — "camera is being used by another app" fix
 *
 * Windows often won't let the same camera be opened twice. So with the camera preview open,
 * turning your camera on in a call failed with "being used by another app" (and the other way
 * round). Now AURA shares the one camera: whichever part opens it second borrows the picture.
 * Closing the preview doesn't stop the call's camera.
 * When a different app really has the camera, the message now names the usual ones
 * (Discord, Zoom, OBS, Teams, the Windows Camera app).
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-camera-busy-setup.cjs
 *
 * What it does:
 *   - edits    src/components/camfx.js, camera.jsx, calls.jsx
 *   - creates  tests/camera-busy.cjs   (only if AURA's checks are installed)
 *
 * Every file it changes is copied to <name>.before-camera-busy.bak first.
 * To put everything back:                 node aura-camera-busy-setup.cjs --undo
 * To preview without changing anything:   node aura-camera-busy-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const crypto = require("crypto");

const FILES = {"edits":[{"file":"camfx","find":"    return { stream, stop() { try { out.stop(); } catch {} raw.getTracks().forEach((t) => { try { t.stop(); } catch {} }); } };\n  } catch {\n    return null;\n  }\n}\n","replace":"    return { stream, stop() { try { out.stop(); } catch {} raw.getTracks().forEach((t) => { try { t.stop(); } catch {} }); } };\n  } catch {\n    return null;\n  }\n}\n\n// One camera, shared (Added by aura-camera-busy-setup.cjs)\n// Windows often won't let the same camera be opened twice (for example by the camera preview at\n// 720p and by a call at 1080p): the second one is told \"the camera is being used by another app\".\n// So whatever has the camera open says so here, and the other part of AURA borrows a copy of that\n// picture instead of opening the camera again. A copy keeps going after the original is closed.\nconst cameraHolders = new Set();\nexport function holdCamera(stream) { if (stream) cameraHolders.add(stream); }\nexport function borrowCamera() {\n  for (const s of [...cameraHolders]) {\n    const t = s.getVideoTracks()[0];\n    if (!t || t.readyState !== \"live\") { cameraHolders.delete(s); continue; }\n    try { return new MediaStream([t.clone()]); } catch {}\n  }\n  return null;\n}\nexport const cameraBusy = (e) => e?.name === \"NotReadableError\" || e?.name === \"TrackStartError\" || e?.name === \"AbortError\";\n"},{"file":"camera","find":"effectsStatus, onEffectsStatus } from \"./camfx\";","replace":"effectsStatus, onEffectsStatus, holdCamera, borrowCamera, cameraBusy } from \"./camfx\";"},{"file":"camera","find":"  } catch (e) {\n    if (mine !== attempt) return false;\n    cam.starting = false; cam.error = explain(e);\n    emit();\n    return false;\n  }\n","replace":"  } catch (e) {\n    // Busy because a call in AURA has it: show that camera instead of opening it again (Added by aura-camera-busy-setup.cjs)\n    stream = cameraBusy(e) ? borrowCamera() : null;\n    if (!stream) {\n      if (mine !== attempt) return false;\n      cam.starting = false; cam.error = explain(e);\n      emit();\n      return false;\n    }\n  }\n"},{"file":"camera","find":"  cam.raw = stream; const fx = cameraEffects(stream);","replace":"  cam.raw = stream; holdCamera(stream); const fx = cameraEffects(stream);"},{"file":"camera","find":"return \"The camera is being used by another app, or Windows couldn't start it. Close the other app, then press Turn on.\";","replace":"return \"The camera is being used by another app (like Discord, Zoom, OBS, Teams or the Windows Camera app), or Windows couldn't start it. Close the other app, then press Turn on.\";"},{"file":"calls","find":"import { cameraEffects } from \"./camfx\"; // your camera background in calls (Added by aura-camera-backgrounds-setup.cjs)\n","replace":"import { cameraEffects } from \"./camfx\"; // your camera background in calls (Added by aura-camera-backgrounds-setup.cjs)\nimport { holdCamera, borrowCamera, cameraBusy } from \"./camfx\"; // one camera shared by the preview and calls (Added by aura-camera-busy-setup.cjs)\n"},{"file":"calls","find":"if (name === \"NotReadableError\" || name === \"AbortError\") return \"Your camera is being used by another app. Close it and try again.\";","replace":"if (name === \"NotReadableError\" || name === \"AbortError\") return \"Your camera is being used by another app (like Discord, Zoom, OBS, Teams or the Windows Camera app). Close it and try again.\";"},{"file":"calls","find":"    } catch (e) {\n      if (mine === session) { patch({ camStarting: false }); toast(camProblem(e), \"err\"); }\n      return;\n    }\n","replace":"    } catch (e) {\n      // Busy because AURA's camera preview has it: send that picture instead of opening it again (Added by aura-camera-busy-setup.cjs)\n      stream = cameraBusy(e) ? borrowCamera() : null;\n      if (!stream) {\n        if (mine === session) { patch({ camStarting: false }); toast(camProblem(e), \"err\"); }\n        return;\n      }\n    }\n"},{"file":"calls","find":"    const raw = stream;\n    const fx = cameraEffects(raw);","replace":"    const raw = stream;\n    holdCamera(raw);\n    const fx = cameraEffects(raw);"}],"test":"// One camera for the camera preview and calls. Windows often won't open the same camera twice, so\n// AURA shares it: turning your camera on in a call while the preview is open (or the other way\n// round) borrows the picture instead of failing with \"being used by another app\". Two AURA windows\n// call each other in a real browser, with Windows' one-camera rule imitated.\n// Added by aura-camera-busy-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst OLD = process.env.AURA_OLD_DIST || \"\";\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\nconst sleep = (ms) => new Promise((r) => setTimeout(r, ms));\n\nfunction serve(dir) {\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(dir, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => {\n      if (err) { res.writeHead(404); return res.end(); }\n      res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" });\n      res.end(data);\n    });\n  });\n  return new Promise((r) => server.listen(0, \"127.0.0.1\", () => r({ server, base: \"http://127.0.0.1:\" + server.address().port })));\n}\n\n// ── A pretend Supabase for calls, with groups (as in aura-calls-group.sql) ───\nfunction makeWorld() {\n  const people = {};    // id -> { page, name }\n  let calls = [], signals = [], nextSignal = 1, nextCall = 1;\n  const shape = (c, me) => ({ id: c.id, callerId: c.caller, calleeId: c.callee, peerId: c.caller === me ? c.callee : c.caller, outgoing: c.caller === me, status: c.status, reason: c.reason || null, groupId: c.group || null });\n  const tell = (id, event) => { const p = people[id]?.page; if (p) p.evaluate((e) => window.__deliver && window.__deliver(e), event).catch(() => {}); };\n  const both = (c) => { for (const id of [c.caller, c.callee]) tell(id, { type: \"call\", call: shape(c, id) }); };\n  const ok = (data) => ({ success: true, data });\n  const no = (error) => ({ success: false, error });\n  const end = (c, reason) => { if (c.status === \"ended\") return; c.status = \"ended\"; c.reason = reason || \"hangup\"; both(c); };\n  const live = () => calls.filter((x) => x.status !== \"ended\");\n  const busy = (id) => live().some((x) => x.caller === id || x.callee === id);\n  const groupPeople = (g) => new Set(live().filter((x) => x.group === g).flatMap((x) => [x.caller, x.callee]));\n  const handlers = {\n    start: (me) => ok({ id: me, username: people[me].name, live: true }),\n    listFriends: (me) => ok(Object.keys(people).filter((id) => id !== me).map((id) => ({ friendshipId: \"f-\" + id, userId: id, username: people[id].name, avatarUrl: \"\", state: \"friend\", since: null, online: true, lastSeenAt: new Date().toISOString() }))),\n    getProfile: (_me, id) => ok(people[id] ? { userId: id, username: people[id].name, bio: \"\", avatarUrl: \"\" } : null),\n    listConversations: () => ok([]), listBlocked: () => ok([]),\n    callConfig: () => ok({ iceServers: [], relay: false }),\n    currentCall: (me) => { const c = live().find((x) => x.caller === me || x.callee === me); return ok(c ? shape(c, me) : null); },\n    startCall: (me, other) => {\n      if (busy(me)) return no(\"You're already in a call.\");\n      if (busy(other)) return no(\"They're on another call. Try again in a bit.\");\n      const c = { id: \"call-\" + nextCall++, caller: me, callee: other, status: \"ringing\" };\n      calls.push(c);\n      tell(other, { type: \"call\", call: shape(c, other) });\n      return ok(shape(c, me));\n    },\n    answerCall: (me, id) => { const c = calls.find((x) => x.id === id && x.callee === me && x.status === \"ringing\"); if (!c) return no(\"That call has ended.\"); c.status = \"active\"; tell(c.caller, { type: \"call\", call: shape(c, c.caller) }); return ok(shape(c, me)); },\n    endCall: (me, id, reason) => { const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me)); if (c) end(c, c.status === \"ringing\" ? (me === c.callee ? \"declined\" : reason === \"missed\" ? \"missed\" : \"cancelled\") : reason === \"failed\" ? \"failed\" : \"hangup\"); return ok(c ? shape(c, me) : null); },\n    addToCall: (me, id, other) => {\n      if (world.noGroups) return no(\"Calls with 3 people aren't set up in Supabase yet. Run aura-calls-group.sql first.\");\n      const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me) && x.status === \"active\");\n      if (!c) return no(\"That call has ended.\");\n      const g = c.group || c.id;\n      if (!c.group) { c.group = g; both(c); }\n      const inCall = groupPeople(g);\n      if (inCall.has(other)) return no(\"They're already in this call.\");\n      if (inCall.size >= 3) return no(\"This call is full. Calls can have up to 3 people.\");\n      if (busy(other)) return no(\"They're on another call. Try again in a bit.\");\n      const n = { id: \"call-\" + nextCall++, caller: me, callee: other, status: \"ringing\", group: g };\n      calls.push(n);\n      world.added.push(n.id);\n      tell(other, { type: \"call\", call: shape(n, other) });\n      return ok(shape(n, me));\n    },\n    joinGroup: (me, id) => {\n      const c = calls.find((x) => x.id === id && x.callee === me && x.status === \"active\" && x.group);\n      if (!c) return no(\"That call has ended.\");\n      const made = [];\n      const others = new Set(live().filter((x) => x.group === c.group && x.status === \"active\").flatMap((x) => [x.caller, x.callee]));\n      others.delete(me);\n      for (const other of others) {\n        if (live().some((x) => x.group === c.group && ((x.caller === me && x.callee === other) || (x.caller === other && x.callee === me)))) continue;\n        const n = { id: \"call-\" + nextCall++, caller: me, callee: other, status: \"active\", group: c.group };\n        calls.push(n);\n        tell(other, { type: \"call\", call: shape(n, other) });\n        made.push(shape(n, me));\n      }\n      return ok(made);\n    },\n    callSignal: (me, id, kind, payload) => {\n      const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me));\n      if (!c || c.status !== \"active\") return no(\"That call isn't connected.\");\n      if (![\"offer\", \"answer\", \"ice\"].includes(kind)) return no(\"That isn't a valid call message.\");\n      if ((kind === \"offer\" && me !== c.caller) || (kind === \"answer\" && me !== c.callee)) return no(\"That isn't a valid call message.\");\n      if (typeof payload !== \"string\" || payload.length > 20000) return no(\"That call message is too long.\");\n      const to = c.caller === me ? c.callee : c.caller;\n      const s = { id: nextSignal++, call: id, from: me, to, kind, payload };\n      signals.push(s);\n      world.biggest = Math.max(world.biggest, payload.length);\n      tell(to, { type: \"signal\", callId: id, signal: { id: s.id, kind, payload } });\n      return ok(s.id);\n    },\n    callState: (me, id, from) => { const c = calls.find((x) => x.id === id && (x.caller === me || x.callee === me)); return ok({ call: c ? shape(c, me) : null, signals: signals.filter((s) => s.call === id && s.to === me && s.id > (from || 0)).map((s) => ({ id: s.id, kind: s.kind, payload: s.payload })) }); },\n    callBeat: (me, id) => { const c = calls.find((x) => x.id === id); return ok(c && c.status !== \"ended\" ? \"active\" : \"ended\"); },\n  };\n  const friendsChanged = () => Object.keys(people).forEach((id) => tell(id, { type: \"friends\" }));\n  const between = (x, y) => live().find((c) => (c.caller === x && c.callee === y) || (c.caller === y && c.callee === x)) || null;\n  const world = { people, handlers, biggest: 0, added: [], noGroups: false, friendsChanged, between, live, reset() { calls.forEach((c) => end(c, \"hangup\")); } };\n  return world;\n}\n\nasync function person(browser, world, base, id, name) {\n  const page = await (await browser.newContext({ viewport: { width: 1360, height: 860 }, permissions: [\"microphone\"] })).newPage();\n  const thrown = [];\n  page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n  world.people[id] = { page, name, thrown };\n  await page.exposeBinding(\"__social\", (_src, fn, args) => { const h = world.handlers[fn]; return h ? h(id, ...(args || [])) : { success: true, data: null }; });\n  await page.addInitScript(([id, name]) => {\n    try { localStorage.clear(); localStorage.setItem(\"aura_profile\", JSON.stringify({ username: name, avatar: \"\", userId: id })); } catch {}\n    const ok = (data) => Promise.resolve({ success: true, data });\n    const account = { getSession: () => ok({ id, email: name + \"@example.com\" }), getMyProfile: () => ok({ username: name, avatar_url: null }) };\n    window.auraCloud = new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => (account[key] ? account[key](...args) : ok(null))) });\n    window.auraSocial = new Proxy({}, {\n      get: (_t, key) => {\n        if (key === \"then\") return undefined;\n        if (key === \"onEvent\") return (cb) => { window.__deliver = cb; return () => { window.__deliver = null; }; };\n        return (...args) => window.__social(key, args);\n      },\n    });\n    // Screens and windows to pick from, like Windows would list them\n    const pic = (hue) => \"data:image/svg+xml;base64,\" + btoa(`<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"320\" height=\"180\"><rect width=\"320\" height=\"180\" fill=\"hsl(${hue},40%,35%)\"/></svg>`);\n    window.__chosen = [];\n    const desktop = {\n      getCaptureSources: () => Promise.resolve({ success: true, sources: [\n        { id: \"window:22:0\", name: \"Notepad\", thumbnail: pic(200), isScreen: false },\n        { id: \"screen:0:0\", name: \"Entire screen\", thumbnail: pic(20), isScreen: true },\n      ] }),\n      setCaptureSource: (sid) => { window.__chosen.push(sid); return Promise.resolve({ success: true }); },\n    };\n    window.electronAPI = new Proxy({}, {\n      get: (_t, key) => {\n        if (key === \"isElectron\") return true;\n        if (typeof key !== \"string\" || key === \"then\") return undefined;\n        if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};\n        return (...args) => (desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }));\n      },\n    });\n    // Keep hold of every screen captured, to check it's switched off afterwards\n    window.__screens = [];\n    const realGDM = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);\n    navigator.mediaDevices.getDisplayMedia = async (...a) => { const s = await realGDM(...a); window.__screens.push(s); return s; };\n    // Windows' rule for cameras, imitated: a camera already open can't be opened a second time\n    // (\"being used by another app\"). __busy = \"other\" imitates another app holding it.\n    window.__busy = \"\";\n    window.__opened = [];\n    const realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);\n    navigator.mediaDevices.getUserMedia = async (c) => {\n      if (c && c.video) {\n        const open = window.__opened.some((s) => s.getVideoTracks().some((t) => t.readyState === \"live\"));\n        if (window.__busy === \"other\" || open) throw new DOMException(\"Could not start video source\", \"NotReadableError\");\n        const s = await realGUM(c);\n        window.__opened.push(s);\n        return s;\n      }\n      return realGUM(c);\n    };\n    // Keep hold of the connections, so the test can see what goes over them\n    const Real = window.RTCPeerConnection;\n    window.__pcs = [];\n    window.RTCPeerConnection = function (...a) { const pc = new Real(...a); window.__pcs.push(pc); return pc; };\n    window.RTCPeerConnection.prototype = Real.prototype;\n  }, [id, name]);\n  await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n  return page;\n}\n\n(async () => {\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(process.env.CI ? 1 : 3); }\n  const args = [\"--use-fake-ui-for-media-stream\", \"--use-fake-device-for-media-stream\", \"--auto-accept-this-tab-capture\", \"--autoplay-policy=no-user-gesture-required\"];\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch({ ...options, args }); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with. Run  npx playwright install chromium  once to add one.\"); return done(process.env.CI ? 1 : 3); }\n  const now = await serve(DIST);\n  const old = OLD && fs.existsSync(path.join(OLD, \"index.html\")) ? await serve(OLD) : null;\n\n  const until = async (fn, ms = 15000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); } catch { v = null; } if (v) return v; await sleep(200); } return v; };\n  const bar = (p) => p.locator(\".cx-bar\");\n  const barName = (p) => p.evaluate(() => document.querySelector(\".cx-bar .cx-name\")?.textContent || \"\");\n  const live = (p) => until(() => p.evaluate(() => !!document.querySelector(\".cx-bar.live\")));\n  const callFrom = async (from, to, toName) => {\n    await from.locator(`button.cx-call[title=\"Call ${toName}\"]`).first().click({ timeout: 10000 });\n    await until(() => to.evaluate(() => !!document.querySelector(\".cx-bar.ringing.in\")));\n    await to.locator(\".cx-btn.yes\").click({ timeout: 15000 });\n    return (await live(from)) && (await live(to));\n  };\n  const hangUp = async (p) => { await p.locator(\".cx-bar .cx-round.end\").click({ timeout: 15000 }).catch(() => {}); await sleep(1500); };\n  const openAdder = async (p) => { if (!(await p.locator(\".cx-bar .cx-adder\").count())) await p.locator(\".cx-bar .cx-round.add\").click({ timeout: 10000 }); await p.locator(\".cx-bar .cx-adder\").waitFor({ timeout: 10000 }); };\n  const addFrom = async (p, name) => {\n    await openAdder(p);\n    const row = p.locator(\".cx-adder .cx-add-row\", { hasText: name });\n    await row.first().waitFor({ timeout: 10000 });\n    await row.first().click();\n  };\n  // How much sound is arriving on each connection that is open\n  const hearing = (p) => p.evaluate(async () => {\n    const out = [];\n    for (const pc of window.__pcs.filter((x) => x.connectionState === \"connected\")) {\n      let a = 0;\n      (await pc.getStats()).forEach((r) => { if (r.type === \"inbound-rtp\" && r.kind === \"audio\") a = r.bytesReceived || 0; });\n      out.push(a);\n    }\n    return out;\n  });\n  // Every open connection is getting sound, and more of it than a moment ago\n  const allHear = async (p, count) => {\n    const before = await hearing(p);\n    await sleep(1500);\n    const after = await hearing(p);\n    return after.length === count && before.length === count && after.every((a, i) => a > before[i]) ? after : { before, after };\n  };\n  const thrown = (ids, world) => ids.flatMap((id) => world.people[id].thrown.filter((m) => !/reading 'live'/.test(m)));\n\n  try {\n    const world = makeWorld();\n    const A = await person(browser, world, now.base, \"user-A\", \"Alex\");\n    const B = await person(browser, world, now.base, \"user-B\", \"Bri\");\n    await sleep(5000);\n    world.friendsChanged();\n    await until(() => A.evaluate(() => !!document.querySelector('button.cx-call[title=\"Call Bri\"]')));\n    const previewOn = (p) => until(() => p.evaluate(() => { const v = document.querySelector(\".cam-pan video\"); return !!v && v.videoWidth > 0; }), 10000);\n    const camMoving = (p) => until(() => p.evaluate(async () => { const v = document.querySelector(\".cx-cams .cx-cam-theirs\"); if (!v || !v.videoWidth) return false; const t = v.currentTime; await new Promise((r) => setTimeout(r, 600)); return v.currentTime > t; }), 20000);\n    const opened = (p) => p.evaluate(() => window.__opened.length);\n    const said = (p) => p.locator(\"body\").innerText();\n\n    console.log(\"1. Preview open, then the camera in a call\");\n    check(\"Alex calls Bri, Bri accepts\", await callFrom(A, B, \"Bri\"));\n    await A.locator(\".aura-cam\").first().click();\n    check(\"Alex opens the camera preview\", await previewOn(A));\n    check(\"(this test's stand-in for Windows refuses a second opening)\", (await A.evaluate(() => navigator.mediaDevices.getUserMedia({ video: true }).then(() => \"opened\", (e) => e.name))) === \"NotReadableError\");\n    await until(() => A.locator(\".cx-bar .cx-round.cam\").isEnabled());\n    await A.locator(\".cx-bar .cx-round.cam\").click();\n    check(\"turning the camera on in the call works anyway\", await until(() => A.locator(\".cx-bar .cx-round.cam.on\").count()));\n    check(\"...without saying it's being used by another app\", !/being used by another app/.test(await said(A)));\n    check(\"Bri sees Alex's camera\", await camMoving(B));\n    check(\"the camera was only opened once\", (await opened(A)) === 1, await opened(A));\n    await A.locator('.cam-pan button[aria-label=\"Close the camera\"]').first().click();\n    await sleep(1500);\n    check(\"closing the preview doesn't stop the call's camera\", await camMoving(B));\n\n    console.log(\"2. Camera in a call, then the preview\");\n    await until(() => B.locator(\".cx-bar .cx-round.cam\").isEnabled());\n    await B.locator(\".cx-bar .cx-round.cam\").click();\n    check(\"Bri turns the camera on in the call\", await camMoving(A));\n    await B.locator(\".aura-cam\").first().click();\n    check(\"opening the preview shows it too\", await previewOn(B));\n    check(\"...without saying it's being used by another app\", !/being used by another app/.test(await said(B)));\n    check(\"the camera was only opened once\", (await opened(B)) === 1, await opened(B));\n\n    console.log(\"3. When another app really has it\");\n    await A.locator(\".cx-bar .cx-round.cam.on\").click();\n    await sleep(800);\n    await A.evaluate(() => { window.__busy = \"other\"; });\n    await A.locator(\".cx-bar .cx-round.cam\").click();\n    check(\"it says which kind of app to close\", await until(async () => /being used by another app \\(like Discord/.test(await said(A)), 8000));\n    await hangUp(A);\n\n    check(\"nothing crashed along the way\", thrown([\"user-A\", \"user-B\"], world).length === 0, thrown([\"user-A\", \"user-B\"], world));\n  } finally {\n    await browser.close();\n    now.server.close();\n    if (old) old.server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The camera sharing check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-camera-busy.bak";
const MARK = "Added by aura-camera-busy-setup.cjs";
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
    return { text: t, notes: { camfx: ["one camera, shared by the preview and calls"], camera: ["the preview borrows the call's camera when Windows says it's busy"], calls: ["a call borrows the preview's camera when Windows says it's busy", "the busy message names the usual apps to close"] }[key] };
  };
}
function editRunner(text) {
  if (/camera-busy\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  let at = -1;
  for (let i = 0; i < lines.length; i++) if (/add\("window",/.test(lines[i])) at = i;
  if (at < 0) return { text, notes: ["(couldn't find where to add the check, so npm test doesn't include it)"] };
  lines.splice(at + 1, 0, 'if (fs.existsSync(path.join(__dirname, "camera-busy.cjs"))) add("window", "One camera for the preview and calls", "camera-busy.cjs");');
  return { text: lines.join("\n"), notes: ["npm test checks the shared camera too"] };
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
      } else if (entry.name === "camera-busy.cjs") {
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
    camfx: findOne("the camera backgrounds file (camfx.js)", (t) => /export function cameraEffects\(/.test(t), need + " (It comes with aura-camera-backgrounds-setup.cjs.)", [comp]),
    camera: findOne("the camera file (camera.jsx)", (t) => /export function CameraPanel\(/.test(t) && /export async function startCamera\(/.test(t), need, [comp]),
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
  consider("camera", files.camfx, applyEdits("camfx"), false);
  consider("preview", files.camera, applyEdits("camera"), false);
  consider("calls", files.calls, applyEdits("calls"), false);
  const runner = path.join(ROOT, "tests", "run.cjs");
  const hasChecks = fs.existsSync(runner);
  if (hasChecks) consider("checks", runner, editRunner, true);
  const created = [];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "camera-busy.cjs"), content: FILES.test });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: one camera for the preview and calls");
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
  say("Done. Restart AURA. The preview and calls now share the camera.");
  if (hasChecks) say("Run  npm test  before your next release.");
  say("To undo later:  node aura-camera-busy-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
