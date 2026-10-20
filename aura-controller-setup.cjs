#!/usr/bin/env node
/**
 * AURA — playing with a controller
 *
 * Moving around AURA with a controller works properly now:
 *   - D-pad or left stick: moves to whatever is next in that direction, on every page (Home,
 *     Library, Live Streams, Settings, Messages...). Hold it to keep moving. Up and down stay in
 *     the part you're in (the menu, the page, the friends panel); left and right move between them.
 *   - A: select (opens a game, flips a switch in Settings, starts typing in a text box)
 *   - B: back. Closes what's open; then goes to the menu; then Home.
 *   - X: play the game you're on.   Y: favorite it.
 *   - LB / RB: previous / next page.   Right stick: scroll.   Start: shows the buttons.
 *   - A dialog that's open (Add Game, call settings...) keeps the controller inside it.
 *   - Only while AURA is the window in front: playing a game never moves things in AURA.
 *   - Using the mouse hides the controller's ring until you use the controller again.
 *
 * The "Controller Active" box in the bottom-right corner is gone (it covered things). A short
 * notice still says when a controller connects.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-controller-setup.cjs
 *
 * What it does:
 *   - creates  src/components/padnav.js   works out what's next in each direction
 *   - edits    src/App.jsx                 the controller support, and the box in the corner
 *   - creates  tests/controller.cjs        (only if AURA's checks are installed) checks it
 *
 * Every file it changes is copied to <name>.before-controller.bak first.
 * To put everything back:                 node aura-controller-setup.cjs --undo
 * To preview without changing anything:   node aura-controller-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FILES = {"padnav":"// Moving around AURA with a controller: which thing is next in the direction you push.\n// Added by aura-controller-setup.cjs\n//\n//   nextInDirection(from, candidates, dir)   from / candidates are { left, top, right, bottom }\n//                                            (with any other fields); dir: up, down, left, right\n//   FOCUSABLE                                what a controller can land on\n//   isUsable(el)                             on screen, not hidden, not switched off\n//   scopeOf(doc)                             a dialog that's open (only it can be used), or the page\n\nexport const FOCUSABLE = [\n  \"button\", \"a[href]\", \"input:not([type=hidden])\", \"select\", \"textarea\",\n  \"[role=button]\", \"[role=switch]\", \"[role=tab]\", \"[role=listitem][tabindex]\", \"[tabindex]:not([tabindex='-1'])\",\n  \".gm-card\", \".gm-mf-card\", \".card\", \".twitch-card\", \".sb-item\", \".gm-rail-item\", \".tog\", \".chip\", \".clip-card\", \".sb-profile\",\n].join(\",\");\n\n// The thing in direction `dir` from `from`: closest along the way you push, and lined up with\n// where you are (something straight ahead beats something closer but off to the side)\nexport function nextInDirection(from, candidates, dir) {\n  const cx = (r) => (r.left + r.right) / 2, cy = (r) => (r.top + r.bottom) / 2;\n  let best = null, bestScore = Infinity;\n  for (const c of candidates) {\n    if (c === from) continue;\n    let along, across, overlap;\n    if (dir === \"right\" || dir === \"left\") {\n      along = dir === \"right\" ? c.left - from.right : from.left - c.right;\n      if (along < -Math.min(c.right - c.left, from.right - from.left) / 2) continue; // not that way\n      along = Math.max(0, along) + Math.abs(cx(c) - cx(from)) * 0.1;\n      overlap = Math.min(c.bottom, from.bottom) - Math.max(c.top, from.top);\n      across = overlap > 0 ? 0 : Math.abs(cy(c) - cy(from));\n    } else {\n      along = dir === \"down\" ? c.top - from.bottom : from.top - c.bottom;\n      if (along < -Math.min(c.bottom - c.top, from.bottom - from.top) / 2) continue;\n      along = Math.max(0, along) + Math.abs(cy(c) - cy(from)) * 0.1;\n      overlap = Math.min(c.right, from.right) - Math.max(c.left, from.left);\n      across = overlap > 0 ? 0 : Math.abs(cx(c) - cx(from));\n    }\n    const score = along + across * 3;\n    if (score < bestScore) { bestScore = score; best = c; }\n  }\n  return best;\n}\n\nexport function isUsable(el) {\n  if (!el || el.disabled || el.getAttribute?.(\"aria-disabled\") === \"true\") return false;\n  const r = el.getBoundingClientRect();\n  if (r.width < 4 || r.height < 4) return false;\n  if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) {\n    // Off screen but inside something that scrolls: still reachable (it scrolls into view)\n    let p = el.parentElement, scrolls = false;\n    while (p && p !== document.body) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowY + s.overflowX)) { scrolls = true; break; } p = p.parentElement; }\n    if (!scrolls) return false;\n  }\n  const s = getComputedStyle(el);\n  if (s.visibility === \"hidden\" || s.display === \"none\" || Number(s.opacity) === 0 && !el.matches(\".twitch-fav,.twitch-tool\")) return false;\n  return !el.closest(\"[aria-hidden=true],[inert]\");\n}\n\n// A dialog that's open takes over: only what's in it can be used\nexport function scopeOf(doc = document) {\n  const open = [...doc.querySelectorAll(\".mbk, [role=dialog], [aria-modal=true], .cx-screen.full\")].filter((d) => { const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0; });\n  return open.length ? open[open.length - 1] : doc.body;\n}\n","test":"// Moving around AURA with a controller. Opens the built window (dist) in a real browser with a\n// pretend controller, and checks: moving in all four directions goes to what's really there,\n// holding keeps moving, A selects (also switches in Settings), B closes and goes back, LB / RB\n// change page, a dialog keeps the controller inside it, no \"Controller Active\" box covers the\n// corner, and nothing moves while AURA isn't the window in front. Added by aura-controller-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\nconst sleep = (ms) => new Promise((r) => setTimeout(r, ms));\n\n(async () => {\n  console.log(\"1. Which way is next\");\n  const src = fs.readFileSync(path.join(ROOT, \"src\", \"components\", \"padnav.js\"), \"utf8\");\n  const P = await import(\"data:text/javascript;base64,\" + Buffer.from(src).toString(\"base64\"));\n  const box = (id, left, top, w = 100, h = 60) => ({ id, left, top, right: left + w, bottom: top + h });\n  const grid = [box(\"a\", 0, 0), box(\"b\", 120, 0), box(\"c\", 240, 0), box(\"d\", 0, 100), box(\"e\", 120, 100), box(\"f\", 240, 100), box(\"far\", 600, 400)];\n  const go = (from, dir) => P.nextInDirection(grid.find((g) => g.id === from), grid, dir)?.id || null;\n  check(\"right goes to the next one in the row\", go(\"a\", \"right\") === \"b\" && go(\"b\", \"right\") === \"c\");\n  check(\"down goes to the one straight below, not the nearest corner\", go(\"b\", \"down\") === \"e\" && go(\"c\", \"down\") === \"f\");\n  check(\"up and left work the same way\", go(\"e\", \"up\") === \"b\" && go(\"f\", \"left\") === \"e\");\n  check(\"nothing that way: stays put\", go(\"a\", \"up\") === null && go(\"a\", \"left\") === null);\n  const sidebar = [box(\"menu1\", 0, 0, 180, 40), box(\"menu2\", 0, 50, 180, 40), box(\"card\", 220, 0, 150, 200)];\n  check(\"from the menu, right goes to the page\", P.nextInDirection(sidebar[1], sidebar, \"right\")?.id === \"card\");\n\n  console.log(\"2. In the window\");\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(failed ? 1 : process.env.CI ? 1 : 3); }\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch(options); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with.\"); return done(failed ? 1 : process.env.CI ? 1 : 3); }\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(DIST, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" }); res.end(data); });\n  });\n  await new Promise((r) => server.listen(0, \"127.0.0.1\", r));\n  const base = \"http://127.0.0.1:\" + server.address().port;\n  try {\n    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();\n    const thrown = [];\n    page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n    await page.route((url) => !String(url).startsWith(base) && !String(url).startsWith(\"data:\"), (route) => route.abort());\n    await page.addInitScript(() => {\n      try { localStorage.clear(); localStorage.setItem(\"aura_profile\", JSON.stringify({ username: \"tester\", avatar: \"\", userId: \"user-1\" })); } catch {}\n      const ok = (data) => Promise.resolve({ success: true, data });\n      const account = { getSession: () => ok({ id: \"user-1\", email: \"me@example.com\" }), getMyProfile: () => ok({ username: \"tester\", avatar_url: null }) };\n      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => (name === \"auraCloud\" && account[key]) ? account[key](...args) : ok(null)) });\n      window.auraCloud = fake(\"auraCloud\");\n      window.auraSocial = fake(\"auraSocial\");\n      window.electronAPI = new Proxy({}, { get: (_t, key) => (key === \"isElectron\" ? true : typeof key !== \"string\" || key === \"then\" ? undefined : /^(on[A-Z]|remove)/.test(key) ? () => () => {} : () => Promise.resolve({ success: false })) });\n      // A pretend controller the test presses\n      window.__pad = { id: \"Xbox Controller\", index: 0, connected: true, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };\n      window.__front = true;\n      Object.defineProperty(navigator, \"getGamepads\", { value: () => [window.__pad, null, null, null] });\n      Document.prototype.hasFocus = function () { return window.__front; };\n    });\n    await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n    await sleep(5000);\n    await page.evaluate(() => { const e = new Event(\"gamepadconnected\"); e.gamepad = window.__pad; window.dispatchEvent(e); });\n    const BTN = { A: 0, B: 1, Y: 3, LB: 4, RB: 5, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };\n    const press = async (name, hold = 90) => { await page.evaluate((i) => { window.__pad.buttons[i].pressed = true; }, BTN[name]); await sleep(hold); await page.evaluate((i) => { window.__pad.buttons[i].pressed = false; }, BTN[name]); await sleep(160); };\n    const pageName = () => page.evaluate(() => { const el = [...document.querySelectorAll(\".sb-item.on,.gm-rail-item.on\")].find((e) => e.getBoundingClientRect().width > 0); return el ? el.getAttribute(\"title\") || \"\" : \"\"; });\n    const title = () => page.evaluate(() => (document.querySelector(\".hdr-title\")?.innerText || \"\").trim());\n    const focused = () => page.evaluate(() => { const el = document.querySelector(\".ctrl-focus\"); if (!el) return null; const r = el.getBoundingClientRect(); return { cls: String(el.className).slice(0, 60), text: (el.innerText || el.getAttribute(\"aria-label\") || el.title || \"\").trim().slice(0, 40), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), active: document.activeElement === el, menu: !!el.closest(\".sb-item,.gm-rail-item\"), dialog: !!el.closest(\".mbk,[role=dialog]\") }; });\n\n    console.log(\"3. Nothing in the corner\");\n    await sleep(400);\n    check(\"no \\\"Controller Active\\\" box\", (await page.getByText(\"Controller Active\").count()) === 0);\n    check(\"a short notice says the controller is connected\", /Controller connected/.test(await page.locator(\".ctrl-hud\").innerText().catch(() => \"\")));\n    await sleep(3300);\n    check(\"and it goes away by itself\", (await page.locator(\".ctrl-hud\").count()) === 0);\n\n    console.log(\"4. Moving around Home\");\n    await press(\"DOWN\");\n    let f = await focused();\n    check(\"the first press lands on the page (not the menu), and really focuses it\", !!f && !f.menu && f.active, f);\n    const start = f;\n    await press(\"RIGHT\");\n    f = await focused();\n    check(\"right moves right\", !!f && f.x > start.x && Math.abs(f.y - start.y) < 120, { start, f });\n    await press(\"LEFT\");\n    const back = await focused();\n    check(\"left comes back\", !!back && Math.abs(back.x - start.x) < 30 && Math.abs(back.y - start.y) < 30, { start, back });\n    await press(\"DOWN\");\n    f = await focused();\n    check(\"down moves down\", !!f && f.y > back.y, { back, f });\n    await press(\"UP\");\n    check(\"up goes back up\", (await focused()).y < f.y);\n    const beforeHold = await focused();\n    await page.evaluate(() => { window.__pad.axes[1] = 1; }); // left stick held down\n    await sleep(1100);\n    await page.evaluate(() => { window.__pad.axes[1] = 0; });\n    await sleep(200);\n    const afterHold = await focused();\n    check(\"holding the stick keeps moving (several steps)\", afterHold && afterHold.y > beforeHold.y + 150, { beforeHold, afterHold });\n    for (let i = 0; i < 8; i++) await press(\"LEFT\");\n    f = await focused();\n    check(\"left far enough reaches the menu\", !!f && f.menu, f);\n\n    console.log(\"5. Pages, Settings, and A\");\n    await press(\"RB\");\n    await sleep(500);\n    check(\"RB goes to the next page\", (await pageName()) === \"Library\", await pageName());\n    await press(\"LB\");\n    await sleep(500);\n    check(\"LB goes back\", (await pageName()) === \"Home\", await pageName());\n    await page.locator('.gm-rail-item[title=\"Settings\"], .sb-item[title=\"Settings\"]').first().click();\n    await sleep(600);\n    await page.mouse.move(5, 5);\n    let reached = null;\n    for (let i = 0; i < 25 && !reached; i++) {\n      await press(\"DOWN\");\n      const g = await page.evaluate(() => { const el = document.querySelector(\".ctrl-focus\"); return el && el.matches('.tog,[role=switch]') ? { on: el.classList.contains(\"on\") || el.getAttribute(\"aria-checked\") === \"true\" } : null; });\n      if (g) reached = g;\n    }\n    check(\"in Settings, moving down reaches the switches\", !!reached, reached);\n    if (reached) {\n      await press(\"A\");\n      await sleep(300);\n      const now = await page.evaluate(() => { const el = document.querySelector(\".ctrl-focus\"); return el.classList.contains(\"on\") || el.getAttribute(\"aria-checked\") === \"true\"; });\n      check(\"A flips a switch\", now !== reached.on, { before: reached.on, now });\n      await press(\"A\");\n    }\n\n    console.log(\"6. Dialogs and B\");\n    await page.locator('.gm-rail-item[title=\"Library\"], .sb-item[title=\"Library\"]').first().click();\n    await sleep(600);\n    await page.getByRole(\"button\", { name: /Add Game/i }).first().click();\n    await sleep(500);\n    check(\"(the Add Game dialog is open)\", (await page.locator(\".mbk\").count()) === 1);\n    let inside = true;\n    for (let i = 0; i < 6; i++) { await press(i % 2 ? \"RIGHT\" : \"DOWN\"); const g = await focused(); if (!g || !g.dialog) inside = false; }\n    check(\"with a dialog open, the controller stays inside it\", inside, await focused());\n    await press(\"B\");\n    await sleep(400);\n    if (await page.locator(\".mbk\").count()) await press(\"B\");\n    await sleep(300);\n    check(\"B closes the dialog\", (await page.locator(\".mbk\").count()) === 0);\n    await press(\"DOWN\");\n    let card = null;\n    for (let i = 0; i < 6 && !card; i++) { const g = await focused(); if (g && /card/.test(g.cls) && !g.menu) card = g; else await press(\"DOWN\"); }\n    if (card) {\n      await press(\"A\");\n      await sleep(700);\n      const hero = await title();\n      check(\"A on a game opens it\", !!hero && !/^LIBRARY$/i.test(hero), hero);\n      await press(\"B\");\n      await sleep(600);\n      check(\"B goes back from the game\", /^LIBRARY$/i.test(await title()), await title());\n    } else check(\"(reached a game card in the Library)\", false, await focused());\n    await press(\"DOWN\");\n    await press(\"B\");\n    check(\"B from the page goes to the menu\", !!(await focused())?.menu, await focused());\n    await press(\"B\");\n    await sleep(500);\n    check(\"B from the menu goes Home\", (await pageName()) === \"Home\", await pageName());\n\n    console.log(\"7. Start, and not while AURA is behind another window\");\n    await press(\"START\");\n    check(\"Start shows the buttons\", /A: select[\\s\\S]*B: back/.test(await page.locator(\".ctrl-hud\").innerText().catch(() => \"\")));\n    const where = await focused();\n    await page.evaluate(() => { window.__front = false; });\n    await press(\"RIGHT\"); await press(\"RB\");\n    await sleep(500);\n    check(\"while you're in a game (AURA not in front), the controller doesn't move AURA\", JSON.stringify(await focused()) === JSON.stringify(where) && (await pageName()) === \"Home\");\n    await page.evaluate(() => { window.__front = true; });\n    await page.mouse.move(400, 400); await page.mouse.down(); await page.mouse.up();\n    check(\"using the mouse hides the controller's ring\", (await page.locator(\".ctrl-focus\").count()) === 0);\n    check(\"nothing crashed\", (await page.locator(\".aura-fallback\").count()) === 0 && thrown.filter((m) => !/reading 'live'/.test(m)).length === 0, thrown);\n  } finally {\n    await browser.close();\n    server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The controller check itself broke:\", e); process.exit(2); });\n","hook":"// Moving around AURA with a controller (Added by aura-controller-setup.cjs)\n//   D-pad or left stick: move to the next thing in that direction (hold to keep moving)\n//   A: select   B: back (closes what's open, then to the menu, then Home)   X: play   Y: favorite\n//   LB / RB: previous / next page   Right stick: scroll   Start: show the buttons\n// Only while AURA is the window in front, so playing a game never moves things in AURA.\nfunction useController({ view, goTo, navItems, heroGame, setHeroGame, modal, setModal }) {\n  const [connected, setConnected] = useState(false);\n  const [hint, setHint] = useState(null);\n  const [hintHide, setHintHide] = useState(false);\n  const hintTimer = useRef(null);\n  const live = useRef({});\n  live.current = { view, goTo, navItems, heroGame, setHeroGame, modal, setModal };\n  const st = useRef({ prev: {}, dir: null, repeatAt: 0, focus: null });\n\n  const showHint = (msg, ms = 2600) => {\n    setHint(msg);\n    setHintHide(false);\n    clearTimeout(hintTimer.current);\n    hintTimer.current = setTimeout(() => {\n      setHintHide(true);\n      hintTimer.current = setTimeout(() => setHint(null), 400);\n    }, ms);\n  };\n\n  // The focus ring's look is always there (it used to come and go with the notice)\n  useEffect(() => {\n    if (document.getElementById(\"aura-ctrl-css\")) return;\n    const el = document.createElement(\"style\");\n    el.id = \"aura-ctrl-css\";\n    el.textContent = CONTROLLER_CSS;\n    document.head.appendChild(el);\n  }, []);\n\n  useEffect(() => {\n    const any = () => Array.from(navigator.getGamepads?.() || []).some(Boolean);\n    if (any()) setConnected(true);\n    const onConnect = () => { setConnected(true); showHint(\"🎮 Controller connected. Press Start to see the buttons\"); };\n    const onDisconnect = () => setConnected(any());\n    window.addEventListener(\"gamepadconnected\", onConnect);\n    window.addEventListener(\"gamepaddisconnected\", onDisconnect);\n    return () => { window.removeEventListener(\"gamepadconnected\", onConnect); window.removeEventListener(\"gamepaddisconnected\", onDisconnect); clearTimeout(hintTimer.current); };\n  }, []);\n\n  useEffect(() => {\n    const s = st.current;\n    const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };\n    const ring = (el) => { document.querySelectorAll(\".ctrl-focus\").forEach((e) => { if (e !== el) e.classList.remove(\"ctrl-focus\"); }); if (el) el.classList.add(\"ctrl-focus\"); };\n    const mark = (el) => {\n      if (!el) return;\n      ring(el);\n      if (!el.matches(\"button,a[href],input,select,textarea,[tabindex]\")) el.setAttribute(\"tabindex\", \"-1\");\n      // A text box is only typed in after A; passing over it doesn't start typing\n      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);\n      if (typing) { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); }\n      else { try { el.focus({ preventScroll: true }); } catch {} }\n      try { el.scrollIntoView({ block: \"nearest\", inline: \"nearest\", behavior: SETTINGS.reduceMotion ? \"auto\" : \"smooth\" }); } catch {}\n      s.focus = el;\n      s.showRing = true;\n    };\n    const candidates = () => [...scopeOf().querySelectorAll(FOCUSABLE)].filter(isUsable);\n    const current = () => {\n      const scope = scopeOf();\n      const el = s.focus;\n      if (el && el.isConnected && scope.contains(el) && isUsable(el)) return el;\n      const a = document.activeElement;\n      if (a && a !== document.body && scope.contains(a) && a.matches(FOCUSABLE) && isUsable(a)) return a;\n      return null;\n    };\n    const regionOf = (el) => (inMenu(el) ? \"menu\" : el.closest(\".fp\") ? \"friends\" : el.closest(\".cx-bar\") ? \"call\" : \"page\");\n    const inMenu = (el) => !!el.closest(\"aside.sb,aside.gm-rail,.sb-item,.gm-rail-item\");\n    // Where to start: the first thing on the page itself (not the menu, not the friends panel)\n    // Where to start on a page: its first game or stream (top left), else the first thing on it\n    const first = () => {\n      const list = candidates();\n      const onScreen = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; };\n      const page = list.filter((el) => regionOf(el) === \"page\" && onScreen(el)).map(rectOf).sort((a, b) => (Math.abs(a.top - b.top) > 20 ? a.top - b.top : a.left - b.left)).map((c) => c.el);\n      return page.find((el) => el.matches(\".card,.gm-card,.gm-mf-card,.twitch-card,.clip-card\")) || page.find((el) => !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) || page[0] || list[0];\n    };\n    const rectOf = (el) => { const r = el.getBoundingClientRect(); return { el, left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };\n    const move = (dir) => {\n      if (s.mouse) { s.mouse = false; return mark(first()); } // after the mouse: start again from the page\n      const cur = current();\n      if (!cur) return mark(first());\n      let others = candidates().filter((e) => e !== cur && !cur.contains(e) && !e.contains(cur));\n      // Up and down stay in the same part of the window (the menu, the page, the friends panel);\n      // left and right move between them\n      if (dir === \"up\" || dir === \"down\") { const same = others.filter((e) => regionOf(e) === regionOf(cur)); if (same.length) others = same; }\n      const next = nextInDirection(rectOf(cur), others.map(rectOf), dir);\n      if (next) mark(next.el);\n    };\n    const escape = () => {\n      const t = document.activeElement && document.activeElement !== document.body ? document.activeElement : document;\n      t.dispatchEvent(new KeyboardEvent(\"keydown\", { key: \"Escape\", code: \"Escape\", bubbles: true, cancelable: true }));\n    };\n    const back = () => {\n      const L = live.current;\n      const a = document.activeElement;\n      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { a.blur(); ring(a); s.focus = a; return; } // stop typing, stay put\n      if (scopeOf() !== document.body) { escape(); if (L.modal) L.setModal(null); return; } // close what's open\n      if (L.heroGame) { L.setHeroGame(null); return; }\n      const cur = current();\n      if (cur && !inMenu(cur)) { mark(document.querySelector(\".sb-item.on,.gm-rail-item.on,.sb-item.active,.gm-rail-item.active\") || [...document.querySelectorAll(\".sb-item,.gm-rail-item\")].find(isUsable)); return; }\n      if (L.view !== \"home\") L.goTo(\"home\");\n    };\n    const page = (step) => {\n      const L = live.current;\n      const ids = L.navItems.map((n) => n.id);\n      const at = Math.max(0, ids.indexOf(L.view));\n      const next = ids[Math.min(ids.length - 1, Math.max(0, at + step))];\n      if (next && next !== L.view) { L.goTo(next); s.focus = null; setTimeout(() => mark(first()), 350); }\n    };\n    const select = () => {\n      if (s.mouse) { s.mouse = false; return mark(first()); }\n      const el = current();\n      if (!el) return mark(first());\n      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) { el.focus(); return; }\n      const r = el.getBoundingClientRect();\n      // A game in the Library opens from its name strip\n      const target = el.matches(\".card\") ? el.querySelector(\".card-info\") || el : el;\n      target.click();\n      // Some things are drawn again when used (a switch in Settings): keep the ring on the new one\n      setTimeout(() => {\n        if (s.focus !== el || el.isConnected) return;\n        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;\n        const near = candidates().map(rectOf).map((c) => ({ c, d: Math.hypot((c.left + c.right) / 2 - cx, (c.top + c.bottom) / 2 - cy) })).sort((a, b) => a.d - b.d)[0];\n        if (near && near.d < 40) mark(near.c.el);\n      }, 80);\n    };\n    // X: play the game you're on\n    const launch = () => {\n      const el = current();\n      const play = el && (el.querySelector(\".play-btn\") || el.closest(\".card\")?.querySelector(\".play-btn\"));\n      if (play) play.click();\n    };\n    const favorite = () => {\n      const el = current();\n      const fav = el && (el.querySelector(\".c-act.fav,.twitch-fav\") || el.closest(\".card\")?.querySelector(\".c-act.fav\"));\n      if (fav) fav.click();\n    };\n    const scroller = (el) => { let p = el; while (p && p !== document.body) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 4) return p; p = p.parentElement; } return null; };\n\n    let raf = 0;\n    const poll = () => {\n      raf = requestAnimationFrame(poll);\n      const gp = Array.from(navigator.getGamepads?.() || []).find((g) => g && g.connected !== false);\n      // AURA redraws things (a switch, a card) and its own class names replace the ring: put it back\n      if (s.showRing && s.focus && s.focus.isConnected && !s.focus.classList.contains(\"ctrl-focus\")) s.focus.classList.add(\"ctrl-focus\");\n      if (!gp) return;\n      const pressed = (i) => !!gp.buttons[i]?.pressed;\n      const now = performance.now();\n      const was = s.prev;\n      s.prev = Object.fromEntries(Object.entries(B).map(([k, i]) => [k, pressed(i)]));\n      // Only while AURA is the window in front (not while you're playing)\n      if (!document.hasFocus() || document.visibilityState !== \"visible\") { s.dir = null; return; }\n      const just = (k) => s.prev[k] && !was[k];\n      // Moving: d-pad or left stick, again and again while held\n      const lx = gp.axes[0] || 0, ly = gp.axes[1] || 0;\n      const dir = s.prev.UP || ly < -0.6 ? \"up\" : s.prev.DOWN || ly > 0.6 ? \"down\" : s.prev.LEFT || lx < -0.6 ? \"left\" : s.prev.RIGHT || lx > 0.6 ? \"right\" : null;\n      if (dir && dir !== s.dir) { move(dir); s.repeatAt = now + 380; }\n      else if (dir && now >= s.repeatAt) { move(dir); s.repeatAt = now + 110; }\n      s.dir = dir;\n      if (just(\"A\")) select();\n      if (just(\"B\")) back();\n      if (just(\"Y\")) favorite();\n      if (just(\"X\")) launch();\n      if (just(\"LB\")) page(-1);\n      if (just(\"RB\")) page(1);\n      if (just(\"START\")) showHint(\"D-pad: move   A: select   B: back   X: play   Y: favorite   LB / RB: pages   Right stick: scroll\", 5000);\n      // Right stick scrolls whatever you're in\n      const ry = gp.axes[3] || 0;\n      if (Math.abs(ry) > 0.25) {\n        const box = (current() && scroller(current())) || scroller(document.querySelector(\".main,.content,.sc\") || document.body) || document.scrollingElement;\n        if (box) box.scrollBy(0, ry * 22);\n      }\n    };\n    raf = requestAnimationFrame(poll);\n    // The mouse takes over: the ring goes until the controller is used again\n    const onMouse = () => { ring(null); s.mouse = true; s.showRing = false; };\n    window.addEventListener(\"mousedown\", onMouse, true);\n    window.addEventListener(\"wheel\", onMouse, { passive: true, capture: true });\n    return () => { cancelAnimationFrame(raf); window.removeEventListener(\"mousedown\", onMouse, true); window.removeEventListener(\"wheel\", onMouse, true); };\n  }, []);\n\n  // A new page or a game opened: start from the top of it\n  useEffect(() => { st.current.focus = null; document.querySelectorAll(\".ctrl-focus\").forEach((e) => e.classList.remove(\"ctrl-focus\")); }, [view, heroGame]);\n\n  return { connected, hint, hintHide };\n}\n\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-controller.bak";
const MARK = "Added by aura-controller-setup.cjs";
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

function editAppWith(hook) {
  return function editApp(text) {
    if (text.includes("nextInDirection(")) return { text, notes: [] };
    let t = text;
    const imp = /^import \{ useCloudGames, useCloudProfile \} from "\.\/cloudsync";\n/m;
    if (!imp.test(t)) throw new Error('the imports at the top ( import { useCloudGames, useCloudProfile } from "./cloudsync"; )');
    t = t.replace(imp, (m) => m + 'import { FOCUSABLE, nextInDirection, isUsable, scopeOf } from "./components/padnav"; // moving around with a controller (' + MARK + ")\n");
    // The new way of moving around
    const a = t.indexOf("function useController(");
    const b = t.indexOf("// ── App ───", a);
    if (a < 0 || b < 0) throw new Error("the controller support ( function useController( ... // ── App ── )");
    t = t.slice(0, a) + hook + t.slice(b);
    // The focus ring keeps each thing's own shape, and leaves room when it scrolls into view
    t = swapOnce(t, ".ctrl-focus{outline:3px solid var(--ac)!important;outline-offset:3px!important;border-radius:10px!important;}",
      ".ctrl-focus{outline:3px solid var(--ac)!important;outline-offset:3px!important;scroll-margin:28px;}",
      "the controller focus ring ( .ctrl-focus{ ... } )");
    // No "Controller Active" box in the corner: it covered things
    const pill = /\n(\s*)\) : connected \? \(\n[\s\S]*?Controller Active<\/span>\n\s*<\/div>\n\s*<\/>\n\s*\) : null;\n/;
    if (!pill.test(t)) throw new Error('the "Controller Active" box ( ) : connected ? ( ... Controller Active ... ) : null; )');
    t = t.replace(pill, (_m, ind) => "\n" + ind + ") : null; // (no \"Controller Active\" box: it covered the corner; " + MARK + ")\n");
    // Its notice no longer needs the extra arguments
    t = t.replace(/heroGame, setHeroGame, modal, setModal, doPlay, doFav, games, sorted,\n(\s*)\}\);/, "heroGame, setHeroGame, modal, setModal,\n$1});");
    return { text: t, notes: [
      "the controller moves to whatever is next in the direction you push, on every page (holding keeps moving)",
      "B closes what's open, then goes to the menu, then Home; LB / RB change page; right stick scrolls",
      "the \"Controller Active\" box in the bottom-right corner is gone",
      "the controller only moves AURA while AURA is the window in front",
    ] };
  };
}
const editApp = editAppWith(FILES.hook);

// ── AURA's checks (only when they are installed) ─────────────────────────────
function editRunner(text) {
  if (/controller\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  let at = -1;
  for (let i = 0; i < lines.length; i++) if (/add\("window",/.test(lines[i])) at = i;
  if (at < 0) return { text, notes: ["(couldn't find where to add the controller check, so npm test doesn't include it)"] };
  lines.splice(at + 1, 0, 'if (fs.existsSync(path.join(__dirname, "controller.cjs"))) add("window", "Playing with a controller", "controller.cjs");');
  return { text: lines.join("\n"), notes: ["npm test now checks the controller too"] };
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
      } else if (entry.name === "padnav.js" || entry.name === "controller.cjs") {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. The controller works as it did before." : "Nothing to undo.");
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
  consider("App file", files.app, editApp, false);
  const runner = path.join(ROOT, "tests", "run.cjs");
  const hasChecks = fs.existsSync(runner);
  if (hasChecks) consider("checks", runner, editRunner, true);

  const created = [{ label: "moving", file: path.join(path.dirname(files.app), "components", "padnav.js"), content: FILES.padnav }];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "controller.cjs"), content: FILES.test });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: playing with a controller");
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
  say("Done. Restart AURA (stop it in the terminal and start it again), then pick up your controller and press Start to see the buttons.");
  if (hasChecks) say("Run  npm test  before your next release.");
  say("To undo later:  node aura-controller-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
