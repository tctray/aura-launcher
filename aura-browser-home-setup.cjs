#!/usr/bin/env node
/**
 * AURA — the Social browser: it survives a visit to Home, has a homepage, and reopens where you were
 *
 * 1. Going Home no longer throws the Social page away.
 *    AURA has two layouts (Home, and the one with the sidebar). Switching between them rebuilt
 *    the Social page: its sites reloaded and a video that had popped out disappeared for good.
 *    The Social page now stays loaded whichever page you are on.
 *
 * 2. A homepage for the Browser tab.
 *    Right-click the Home button to make the page you are on your homepage. After that the Home
 *    button opens it. The same menu goes back to AURA's start page.
 *
 * 3. The Browser tab reopens where you were.
 *    The page you were last on is remembered on this PC, and the Browser tab opens on it next
 *    time. (If you went to the start page, it opens on the start page, or on your homepage.)
 *
 * 4. The "Error log" row in Settings is hidden in the installed app.
 *    People using AURA don't need it there. It still shows while you are developing
 *    (npm run electron:dev), and the "Open error log" button still appears on the message a
 *    crashed page shows, which is when someone would need it.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-browser-home-setup.cjs
 *   4. Then:  npm test
 *
 * What it does:
 *   - edits    src/App.jsx                  keeps the Social page loaded; hides the Error log row
 *   - edits    src/components/social.jsx    the homepage, and reopening where you were
 *   - creates  tests/browser-home.cjs       (only if AURA's checks are installed) checks all of it
 *   - edits    tests/run.cjs                (same) so npm test runs it
 *
 * Every file it changes is copied to <name>.before-browser-home.bak first.
 * To put everything back:                 node aura-browser-home-setup.cjs --undo
 * To preview without changing anything:   node aura-browser-home-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const EDITS = [{"kind":"insert","file":"app","label":"the Social page stays loaded when you go Home (its sites no longer reload, and a popped-out video stays out)","done":"function SocialKeeper(","aheadOf":"function AuraApp(){","text":"// ── Social page keeper ────────────────────────────────────────────────────────\n// Added by aura-browser-home-setup.cjs.\n// AURA has two layouts: Home, and the one with the sidebar. Switching between them rebuilds the\n// page, and the Social page used to be rebuilt with it: its sites reloaded, and a video that had\n// popped out was closed. So the Social page lives here, outside both layouts, and is laid over\n// the space the sidebar layout leaves for it (the element with id \"social-slot\"). On every other\n// page it is hidden, not removed.\nfunction SocialKeeper({ show, onShow }) {\n  const [box, setBox] = useState(null);\n  useEffect(() => {\n    if (!show) return;\n    const measure = () => {\n      const slot = document.getElementById(\"social-slot\");\n      if (!slot) return;\n      const r = slot.getBoundingClientRect();\n      if (r.width < 1 || r.height < 1) return;\n      const next = { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };\n      setBox((b) => (b && b.left === next.left && b.top === next.top && b.width === next.width && b.height === next.height ? b : next));\n    };\n    measure();\n    const slot = document.getElementById(\"social-slot\");\n    const watcher = typeof ResizeObserver === \"function\" && slot ? new ResizeObserver(measure) : null;\n    watcher?.observe(slot);\n    window.addEventListener(\"resize\", measure);\n    const timer = setInterval(measure, 400); // the space can move without changing size (a side panel opening)\n    return () => { watcher?.disconnect(); window.removeEventListener(\"resize\", measure); clearInterval(timer); };\n  }, [show]);\n  const on = show && !!box;\n  return (\n    <div className=\"social-keeper\" style={on\n      ? { position: \"fixed\", left: box.left, top: box.top, width: box.width, height: box.height, zIndex: 3, display: \"flex\", flexDirection: \"column\", overflow: \"hidden\" }\n      : { position: \"fixed\", left: 0, top: 0, width: box?.width || 1000, height: box?.height || 700, display: \"none\" }}>\n      <PageBoundary name=\"social\"><SocialPage visible={show} onShow={onShow}/></PageBoundary>\n    </div>\n  );\n}\n\n"},{"kind":"re","file":"app","label":"the Social page stays loaded when you go Home (its sites no longer reload, and a popped-out video stays out)","re":"^        <style>\\{S\\}</style>\\n(?=        \\{bgImage&&)","missingOk":true,"text":"        <style>{S}</style>\n        <SocialKeeper key=\"social-keeper\" show={view===\"social\"} onShow={()=>goTo(\"social\")}/>\n"},{"kind":"re","file":"app","label":"the Social page stays loaded when you go Home (its sites no longer reload, and a popped-out video stays out)","re":"^      <style>\\{S\\}</style>\\n(?=      \\{bgImage&&)","missingOk":true,"text":"      <style>{S}</style>\n      <SocialKeeper key=\"social-keeper\" show={view===\"social\"} onShow={()=>goTo(\"social\")}/>\n"},{"kind":"re","file":"app","label":"the Social page stays loaded when you go Home (its sites no longer reload, and a popped-out video stays out)","re":"^[ \\t]*<div style=\\{\\{display:view===\"social\"\\?\"flex\":\"none\",flex:1,flexDirection:\"column\",overflow:\"hidden\",minHeight:0\\}\\}>\\n[ \\t]*<PageBoundary name=\"social\"><SocialPage visible=\\{view===\"social\"\\}[^\\n]*/></PageBoundary>\\n[ \\t]*</div>\\n","done":"<div id=\"social-slot\"","text":"          {/* The Social page itself lives in SocialKeeper, so going Home doesn't throw it away. This is the space it is laid over. */}\n          <div id=\"social-slot\" style={{display:view===\"social\"?\"flex\":\"none\",flex:1,minHeight:0}}/>\n"},{"kind":"re","file":"app","label":"Settings: the Error log row only shows while developing, not in the installed app","re":"<div className=\"sr\"><div><div className=\"sr-l\">Error log</div><div className=\"sr-s\">[^<]*</div></div><ErrorLogButton/></div>","done":"{import.meta.env.DEV && <div className=\"sr\"><div><div className=\"sr-l\">Error log</div>","text":"{import.meta.env.DEV && <div className=\"sr\"><div><div className=\"sr-l\">Error log</div><div className=\"sr-s\">If something goes wrong, AURA notes it in a file on this PC. Nothing is sent anywhere. (This row only shows while developing.)</div></div><ErrorLogButton/></div>}"},{"kind":"insert","file":"social","label":"the Browser tab has a homepage (right-click the Home button) and reopens on the page you were last on","done":"const HOMEPAGE_KEY =","aheadOf":"// Turn what's typed in the address bar into a URL (or a Google search)","text":"// ── Homepage and \"where you were\" (Browser tab) ───────────────────────────────\n// Added by aura-browser-home-setup.cjs. Both are kept on this PC, in AURA's own storage.\n//   homepage:   the page the Home button opens. Right-click the Home button to choose it.\n//               With none chosen, Home shows AURA's start page.\n//   last page:  the page you were on, so the Browser tab opens there next time.\n// Only ordinary https pages are ever kept or reopened.\nconst HOMEPAGE_KEY = \"aura_browser_home\";\nconst LASTPAGE_KEY = \"aura_browser_last\";\nconst HTTPS_PAGE = /^https:\\/\\/[^\\s]{1,1990}$/i;\nconst savedPage = (key) => { try { const v = localStorage.getItem(key) || \"\"; return HTTPS_PAGE.test(v) ? v : \"\"; } catch { return \"\"; } };\n\n"},{"kind":"replace","file":"social","label":"the Browser tab has a homepage (right-click the Home button) and reopens on the page you were last on","done":"const firstPage = useRef(","before":"  const [browserHome, setBrowserHome] = useState(true);","text":"  const [homepage, setHomepage] = useState(() => savedPage(HOMEPAGE_KEY));\n  const firstPage = useRef(savedPage(LASTPAGE_KEY) || savedPage(HOMEPAGE_KEY)); // what the Browser tab opens on (\"\" = the start page)\n  const [homeMenu, setHomeMenu] = useState(null);\n  const [browserHome, setBrowserHome] = useState(() => !firstPage.current);"},{"kind":"insert","file":"social","label":"the Browser tab has a homepage (right-click the Home button) and reopens on the page you were last on","after":"const browserUrl = states.browser?.url;","done":"localStorage.setItem(LASTPAGE_KEY, browserUrl)","text":"  // Remember where you are, so the Browser tab opens here next time\n  useEffect(() => { if (HTTPS_PAGE.test(browserUrl || \"\")) { try { localStorage.setItem(LASTPAGE_KEY, browserUrl); } catch {} } }, [browserUrl]);\n"},{"kind":"re","file":"social","label":"the Browser tab has a homepage (right-click the Home button) and reopens on the page you were last on","re":"^[ \\t]*try \\{ view\\.loadURL\\(url\\); \\} catch \\{ view\\.src = url; \\}\\n[ \\t]*setBrowserHome\\(false\\);\\n","done":"if (HTTPS_PAGE.test(url)) { try { localStorage.setItem(LASTPAGE_KEY, url); } catch {} }","text":"    try { view.loadURL(url); } catch { view.src = url; }\n    setBrowserHome(false);\n    if (HTTPS_PAGE.test(url)) { try { localStorage.setItem(LASTPAGE_KEY, url); } catch {} }\n"},{"kind":"replace","file":"social","label":"the Browser tab has a homepage (right-click the Home button) and reopens on the page you were last on","done":"if (homepage) { openInBrowserTab(homepage); return; }","before":"    if (active === \"browser\") { setBrowserHome(true); return; }","text":"    if (active === \"browser\") {\n      if (homepage) { openInBrowserTab(homepage); return; }\n      openStartPage();\n      return;\n    }"},{"kind":"replace","file":"social","label":"the Browser tab has a homepage (right-click the Home button) and reopens on the page you were last on","done":"&& !firstPage.current));","before":"const showStart = isBrowser && (browserHome || !st.url || st.url === \"about:blank\");","text":"const showStart = isBrowser && (browserHome || ((!st.url || st.url === \"about:blank\") && !firstPage.current));"},{"kind":"insert","file":"social","label":"the Browser tab has a homepage (right-click the Home button) and reopens on the page you were last on","done":"const openStartPage = () => {","aheadOf":"const openOutside = () => {","text":"  // Homepage (Browser tab): right-click the Home button to choose\n  const openStartPage = () => {\n    setBrowserHome(true);\n    try { localStorage.removeItem(LASTPAGE_KEY); } catch {} // you chose the start page, so that is where you are\n    setHomeMenu(null);\n  };\n  const chooseHomepage = (url) => {\n    const next = HTTPS_PAGE.test(url || \"\") ? url : \"\";\n    setHomepage(next);\n    try { if (next) localStorage.setItem(HOMEPAGE_KEY, next); else localStorage.removeItem(HOMEPAGE_KEY); } catch {}\n    setHomeMenu(null);\n  };\n  useEffect(() => {\n    if (!homeMenu) return;\n    const onKey = (e) => { if (e.key === \"Escape\") setHomeMenu(null); };\n    window.addEventListener(\"keydown\", onKey);\n    return () => window.removeEventListener(\"keydown\", onKey);\n  }, [homeMenu]);\n\n"},{"kind":"replace","file":"social","label":"the Browser tab has a homepage (right-click the Home button) and reopens on the page you were last on","done":"className=\"home-btn\"","before":"<button style={tool} onClick={goHome} title=\"Home\" aria-label=\"Home\"><Svg name=\"home\" /></button>","text":"<button className=\"home-btn\" style={{ ...tool, color: homepage ? \"var(--t1)\" : \"var(--t2)\" }} onClick={goHome} aria-label=\"Home\" aria-haspopup=\"menu\"\n                  onContextMenu={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setHomeMenu({ right: Math.max(8, window.innerWidth - r.right), top: r.bottom + 6 }); }}\n                  title={homepage ? \"Home: \" + siteName(homepage) + \" (right-click to change)\" : \"Home (right-click to choose your homepage)\"}><Svg name=\"home\" /></button>"},{"kind":"insert","file":"social","label":"the Browser tab has a homepage (right-click the Home button) and reopens on the page you were last on","done":"className=\"bmk-menu home-menu\"","aheadOf":"<style>{BOOKMARK_CSS}</style>","text":"      {homeMenu && (\n        <>\n          <div onClick={() => setHomeMenu(null)} onContextMenu={(e) => { e.preventDefault(); setHomeMenu(null); }} style={{ position: \"fixed\", inset: 0, zIndex: 9199 }} />\n          <div className=\"bmk-menu home-menu\" role=\"menu\" aria-label=\"Homepage\" style={{ right: homeMenu.right, top: homeMenu.top }}>\n            <button role=\"menuitem\" disabled={!HTTPS_PAGE.test(pageUrl)} onClick={() => chooseHomepage(pageUrl)}>Make this page my homepage</button>\n            {homepage && <button role=\"menuitem\" onClick={() => chooseHomepage(\"\")}>Use AURA's start page instead</button>}\n            <button role=\"menuitem\" onClick={openStartPage}>Open the start page</button>\n          </div>\n        </>\n      )}\n"},{"kind":"replace","file":"social","label":"the Browser tab has a homepage (right-click the Home button) and reopens on the page you were last on","done":"firstPage.current ? { ...s, url: firstPage.current } : s}","before":"<SiteView key={s.id} site={s} active={s.id === active} onState={onState} register={register} />","text":"<SiteView key={s.id} site={s.id === \"browser\" && firstPage.current ? { ...s, url: firstPage.current } : s} active={s.id === active} onState={onState} register={register} />"},{"kind":"re","file":"social","label":"the Browser tab has a homepage (right-click the Home button) and reopens on the page you were last on","re":"^      </div>\\n    </div>\\n  \\);\\n\\}\\n(?=\\n// ── Bookmarks bar)","done":"Tip: right-click the Home button to choose your homepage.","text":"      </div>\n      <div style={{ fontSize: 12, color: \"var(--t2)\", fontFamily: \"DM Sans, sans-serif\" }}>Tip: right-click the Home button to choose your homepage.</div>\n    </div>\n  );\n}\n"},{"kind":"insert","file":"runner","label":"npm test now checks the Social browser","after":"add(\"window\", \"The window opens and every page loads\", \"window.cjs\");","done":"browser-home.cjs","text":"if (fs.existsSync(path.join(__dirname, \"browser-home.cjs\"))) add(\"window\", \"The Social browser: Home, homepage, where you were\", \"browser-home.cjs\");\n"}];
const FILES = {"home":"// The Social browser: it survives a visit to Home, has a homepage, and reopens where you were.\n// Also: the Error log row in Settings is only there while developing.\n//\n// Opens the built window (dist) in a real browser with a pretend desktop side and pretend pages\n// in the Social tabs, and checks:\n//   - going to Home (or any page) and back leaves the Browser tab's page exactly as it was\n//   - the Social page sits exactly over the space left for it, and is hidden on other pages\n//   - the Home button opens your homepage once you've chosen one; right-click to choose\n//   - the Browser tab opens on the page you were last on\n//   - only ordinary https pages are kept\n// Added by aura-browser-home-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\n\n(async () => {\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(process.env.CI ? 1 : 3); }\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch(options); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with. Run  npx playwright install chromium  once to add one.\"); return done(process.env.CI ? 1 : 3); }\n\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(DIST, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => {\n      if (err) { res.writeHead(404); return res.end(); }\n      res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" });\n      res.end(data);\n    });\n  });\n  await new Promise((r) => server.listen(0, \"127.0.0.1\", r));\n  const base = \"http://127.0.0.1:\" + server.address().port;\n\n  // Start AURA logged in. `saved` is what this PC already remembers (as AURA's own storage holds it).\n  async function start(saved = {}) {\n    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();\n    const thrown = [];\n    page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());\n    await page.addInitScript((saved) => {\n      try {\n        if (!sessionStorage.getItem(\"__started\")) { // keep storage across a reload inside one run\n          localStorage.clear();\n          localStorage.setItem(\"aura_profile\", JSON.stringify({ username: \"tester\", avatar: \"\", userId: \"user-1\" }));\n          for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v);\n          sessionStorage.setItem(\"__started\", \"1\");\n        }\n      } catch {}\n      const ok = (data) => Promise.resolve({ success: true, data });\n      const account = { getSession: () => ok({ id: \"user-1\", email: \"me@example.com\" }), getMyProfile: () => ok({ username: \"tester\", avatar_url: null }), saveProfile: (name, picture) => ok({ username: name, avatar_url: picture || null }) };\n      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => (name === \"auraCloud\" && account[key]) ? account[key](...args) : ok(null)) });\n      window.auraCloud = fake(\"auraCloud\");\n      window.auraSocial = fake(\"auraSocial\");\n      window.electronAPI = new Proxy({}, {\n        get: (_t, key) => {\n          if (key === \"isElectron\") return true;\n          if (typeof key !== \"string\" || key === \"then\") return undefined;\n          if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};\n          return () => Promise.resolve({ success: false });\n        },\n      });\n      // A pretend page in each Social tab. In the desktop app these are real embedded pages; here\n      // each one remembers the address it was sent to, and counts how often it was loaded.\n      window.__loads = [];\n      const give = (name, fn) => { HTMLElement.prototype[name] = fn; };\n      give(\"isCurrentlyAudible\", () => false);\n      give(\"executeJavaScript\", () => Promise.resolve(\"\"));\n      give(\"canGoBack\", () => false);\n      give(\"canGoForward\", () => false);\n      give(\"getURL\", function () { return this.__url || this.getAttribute(\"src\") || \"about:blank\"; });\n      give(\"getTitle\", () => \"A page\");\n      give(\"reload\", () => {});\n      give(\"loadURL\", function (url) { window.__loads.push(url); this.__url = url; this.dispatchEvent(new Event(\"did-navigate\")); this.dispatchEvent(new Event(\"did-stop-loading\")); return Promise.resolve(); });\n    }, saved);\n    await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n    await page.waitForTimeout(4500);\n    const menu = async (name) => { await page.locator(`.gm-rail-item[title=\"${name}\"], .sb-item[title=\"${name}\"]`).first().click({ timeout: 5000 }); await page.waitForTimeout(650); };\n    const tab = async (name) => { await page.getByRole(\"tab\", { name, exact: true }).click({ timeout: 5000 }); await page.waitForTimeout(350); };\n    // The Browser tab's page: where it is, and whether it is still the very same one\n    const browserPage = () => page.evaluate(() => {\n      const el = document.querySelector('webview[partition=\"persist:social-browser\"]');\n      if (!el) return null;\n      if (!el.__told) { el.__told = true; el.dispatchEvent(new Event(\"dom-ready\")); } // a real page says when it's ready\n      return { url: el.getURL(), src: el.getAttribute(\"src\"), mark: el.__mark || \"\", shown: el.offsetParent !== null || getComputedStyle(el).position === \"fixed\" };\n    });\n    const mark = (text) => page.evaluate((t) => { document.querySelector('webview[partition=\"persist:social-browser\"]').__mark = t; }, text);\n    const stored = (key) => page.evaluate((k) => localStorage.getItem(k), key);\n    const startPage = () => page.locator('input[aria-label=\"Search or web address\"]').isVisible();\n    const go = async (url) => { const box = page.locator('input[aria-label=\"Address\"]'); await box.fill(url); await box.press(\"Enter\"); await page.waitForTimeout(400); };\n    const homeMenu = async () => { await page.locator(\".home-btn\").click({ button: \"right\", timeout: 4000 }); await page.waitForTimeout(250); return page.locator(\".home-menu button\").evaluateAll((els) => els.map((b) => b.textContent.trim() + (b.disabled ? \" (off)\" : \"\"))); };\n    const pick = async (text) => { await page.locator(\".home-menu\").getByText(text, { exact: true }).click({ timeout: 4000 }); await page.waitForTimeout(350); };\n    return { page, thrown, menu, tab, browserPage, mark, stored, startPage, go, homeMenu, pick };\n  }\n\n  try {\n    console.log(\"1. Going Home and coming back\");\n    let app = await start();\n    await app.menu(\"Social\");\n    await app.tab(\"Browser\");\n    check(\"the Browser tab starts on AURA's start page\", await app.startPage());\n    await app.page.getByText(\"YouTube\", { exact: true }).first().click({ timeout: 5000 });\n    await app.page.waitForTimeout(500);\n    let p = await app.browserPage();\n    check(\"a quick link opens the page\", !!p && p.url === \"https://www.youtube.com/\" && !(await app.startPage()), p);\n    await app.mark(\"the one I opened\");\n    const place = () => app.page.evaluate(() => { const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(e).display }; }; return { keeper: box(\".social-keeper\"), slot: box(\"#social-slot\") }; });\n    let at = await place();\n    check(\"the Social page sits exactly over the space left for it\", !!at.keeper && !!at.slot && at.keeper.x === at.slot.x && at.keeper.y === at.slot.y && at.keeper.w === at.slot.w && at.keeper.h === at.slot.h && at.keeper.w > 400 && at.keeper.h > 300, at);\n    const loadsBefore = await app.page.evaluate(() => window.__loads.length);\n    await app.menu(\"Home\");\n    at = await place();\n    p = await app.browserPage();\n    check(\"on Home the Social page is hidden, not thrown away\", !!at.keeper && at.keeper.display === \"none\" && !!p && p.mark === \"the one I opened\", { at, p });\n    await app.menu(\"Social\");\n    p = await app.browserPage();\n    check(\"back on Social it is the very same page, still where you left it\", !!p && p.mark === \"the one I opened\" && p.url === \"https://www.youtube.com/\" && !(await app.startPage()), p);\n    check(\"and nothing was loaded again\", (await app.page.evaluate(() => window.__loads.length)) === loadsBefore);\n    for (const name of [\"Library\", \"Home\", \"Settings\", \"Home\", \"Live Streams\"]) await app.menu(name);\n    await app.menu(\"Social\");\n    p = await app.browserPage();\n    at = await place();\n    check(\"the same after a tour of other pages, Home twice\", !!p && p.mark === \"the one I opened\" && (await app.page.evaluate(() => window.__loads.length)) === loadsBefore && at.keeper.display !== \"none\" && at.keeper.w === at.slot.w, { p, at });\n    await app.page.setViewportSize({ width: 1180, height: 760 });\n    await app.page.waitForTimeout(700);\n    at = await place();\n    check(\"it follows the window when it changes size\", at.keeper.x === at.slot.x && at.keeper.w === at.slot.w && at.keeper.h === at.slot.h, at);\n    await app.page.setViewportSize({ width: 1440, height: 900 });\n    await app.page.waitForTimeout(600);\n\n    console.log(\"2. A homepage\");\n    let items = await app.homeMenu();\n    check(\"right-clicking the Home button offers to make this page the homepage\", items.join(\"|\") === \"Make this page my homepage|Open the start page\", items);\n    await app.pick(\"Make this page my homepage\");\n    check(\"choosing it is remembered on this PC\", (await app.stored(\"aura_browser_home\")) === \"https://www.youtube.com/\" && (await app.page.locator(\".home-menu\").count()) === 0);\n    await app.go(\"https://www.twitch.tv/\");\n    p = await app.browserPage();\n    check(\"typing an address goes there\", p.url === \"https://www.twitch.tv/\", p);\n    await app.page.locator(\".home-btn\").click({ timeout: 4000 });\n    await app.page.waitForTimeout(400);\n    p = await app.browserPage();\n    check(\"the Home button now opens the homepage, not the start page\", p.url === \"https://www.youtube.com/\" && !(await app.startPage()), p);\n    check(\"its tip says where it goes\", /Home: youtube\\.com/.test(await app.page.locator(\".home-btn\").getAttribute(\"title\")));\n    items = await app.homeMenu();\n    check(\"the menu now also offers AURA's start page back\", items.join(\"|\") === \"Make this page my homepage|Use AURA's start page instead|Open the start page\", items);\n    await app.pick(\"Open the start page\");\n    check(\"\\\"Open the start page\\\" shows it without changing the homepage\", (await app.startPage()) && (await app.stored(\"aura_browser_home\")) === \"https://www.youtube.com/\");\n    items = await app.homeMenu();\n    check(\"on the start page there is no page to make the homepage\", items[0] === \"Make this page my homepage (off)\", items);\n    await app.pick(\"Use AURA's start page instead\");\n    await app.page.getByText(\"Reddit\", { exact: true }).first().click({ timeout: 5000 });\n    await app.page.waitForTimeout(400);\n    await app.page.locator(\".home-btn\").click({ timeout: 4000 });\n    await app.page.waitForTimeout(400);\n    check(\"with the homepage cleared, Home is the start page again\", (await app.startPage()) && (await app.stored(\"aura_browser_home\")) === null);\n    await app.homeMenu();\n    await app.page.keyboard.press(\"Escape\");\n    await app.page.waitForTimeout(250);\n    check(\"Escape closes the menu\", (await app.page.locator(\".home-menu\").count()) === 0);\n\n    console.log(\"3. Where you were\");\n    check(\"on the start page, nothing is remembered as \\\"where you were\\\"\", (await app.stored(\"aura_browser_last\")) === null);\n    await app.go(\"https://store.steampowered.com/\");\n    check(\"the page you go to is remembered\", (await app.stored(\"aura_browser_last\")) === \"https://store.steampowered.com/\");\n    await app.go(\"http://example.com/\");\n    check(\"a page that isn't https is not\", (await app.stored(\"aura_browser_last\")) === \"https://store.steampowered.com/\");\n    check(\"nothing crashed along the way\", (await app.page.locator(\".aura-fallback\").count()) === 0, app.thrown);\n    await app.page.context().close();\n\n    const opensOn = async (saved) => {\n      const a = await start({ aura_social_tab: \"browser\", ...saved });\n      await a.menu(\"Social\");\n      const result = { page: await a.browserPage(), start: await a.startPage() };\n      await a.page.context().close();\n      return result;\n    };\n    let o = await opensOn({ aura_browser_last: \"https://store.steampowered.com/\" });\n    check(\"next time, the Browser tab opens on the page you were on\", !!o.page && o.page.src === \"https://store.steampowered.com/\" && !o.start, o);\n    o = await opensOn({ aura_browser_last: \"https://store.steampowered.com/\", aura_browser_home: \"https://www.youtube.com/\" });\n    check(\"where you were comes before the homepage\", !!o.page && o.page.src === \"https://store.steampowered.com/\" && !o.start, o);\n    o = await opensOn({ aura_browser_home: \"https://www.youtube.com/\" });\n    check(\"with nowhere remembered, it opens on your homepage\", !!o.page && o.page.src === \"https://www.youtube.com/\" && !o.start, o);\n    o = await opensOn({});\n    check(\"with neither, it opens on the start page\", !!o.page && o.page.src === \"about:blank\" && o.start, o);\n    o = await opensOn({ aura_browser_last: \"javascript:alert(1)\", aura_browser_home: \"http://example.com/\" });\n    check(\"anything in storage that isn't an ordinary https page is ignored\", !!o.page && o.page.src === \"about:blank\" && o.start, o);\n\n    console.log(\"4. Settings\");\n    app = await start();\n    await app.menu(\"Settings\");\n    await app.page.getByText(\"Privacy\", { exact: true }).first().scrollIntoViewIfNeeded({ timeout: 5000 });\n    check(\"the installed app's Settings has no Error log row\", (await app.page.getByText(\"Error log\", { exact: true }).count()) === 0 && (await app.page.getByText(\"Privacy\", { exact: true }).count()) > 0);\n    await app.page.context().close();\n    const source = (() => { try { return fs.readFileSync(path.join(ROOT, \"src\", \"App.jsx\"), \"utf8\"); } catch { return \"\"; } })();\n    const safety = (() => { try { return fs.readFileSync(path.join(ROOT, \"src\", \"components\", \"safety.jsx\"), \"utf8\"); } catch { return \"\"; } })();\n    check(\"it is still there while developing\", /import\\.meta\\.env\\.DEV && <div className=\"sr\"><div><div className=\"sr-l\">Error log<\\/div>/.test(source));\n    check(\"and a page that crashes still offers \\\"Open error log\\\"\", /Open error log/.test(safety) && /aura-fallback/.test(safety));\n  } finally {\n    await browser.close();\n    server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The Social browser check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-browser-home.bak";
const MARK = "Added by aura-browser-home-setup.cjs";
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "release", ".git", ".vite", "coverage"]);
const CREATED = ["browser-home.cjs"];
const RETIRED = [];

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
const count = (text, piece) => (piece ? text.split(piece).length - 1 : 0);

// ── One edit ──────────────────────────────────────────────────────────────────
// Each returns the new text and whether it changed anything. If the place it is looking for
// isn't there, that is fine when the edit was already made (its "done" text is present) or when
// the edit only removes something that is already gone. Anything else is a problem.
function applyEdit(text, edit) {
  const already = () => {
    if (edit.done && text.includes(edit.done)) return { text, changed: false };
    if (edit.missingOk) return { text, changed: false };
    throw new Error(edit.kind === "cut" || edit.kind === "insert" ? "the line  " + (edit.from || edit.after || edit.aheadOf).trim() : "the part for: " + edit.label);
  };
  if (edit.done && text.includes(edit.done)) return { text, changed: false };

  if (edit.kind === "replace") {
    const n = count(text, edit.before);
    if (n === 0) return already();
    if (n > 1) throw new Error("exactly one of  " + edit.before.slice(0, 70) + "  (there are " + n + ")");
    return { text: text.replace(edit.before, () => edit.text), changed: true };
  }

  if (edit.kind === "re") {
    const re = new RegExp(edit.re, "m");
    if (!re.test(text)) return already();
    return { text: text.replace(re, () => edit.text), changed: true };
  }

  const lines = text.split("\n");
  if (edit.kind === "insert") {
    const anchor = edit.after || edit.aheadOf;
    const hits = lines.map((l, i) => (l.includes(anchor) ? i : -1)).filter((i) => i >= 0);
    if (!hits.length) return already();
    if (hits.length > 1) throw new Error("exactly one line with  " + anchor.trim() + "  (there are " + hits.length + ")");
    lines.splice(hits[0] + (edit.after ? 1 : 0), 0, ...edit.text.replace(/\n$/, "").split("\n"));
    return { text: lines.join("\n"), changed: true };
  }

  if (edit.kind === "cut") {
    const starts = lines.map((l, i) => (l.includes(edit.from) ? i : -1)).filter((i) => i >= 0);
    if (!starts.length) return already();
    if (starts.length > 1) throw new Error("exactly one line with  " + edit.from.trim() + "  (there are " + starts.length + ")");
    const a = starts[0];
    let b = -1;
    for (let i = a + 1; i < lines.length; i++) if (lines[i].includes(edit.to)) { b = i; break; }
    if (b < 0) throw new Error("the line  " + edit.to.trim() + "  after  " + edit.from.trim());
    if (edit.maxLines && b - a > edit.maxLines) throw new Error("the part from  " + edit.from.trim() + "  where I expected it (it is longer than it should be)");
    // Never remove more than was meant: only these handlers may be inside the part taken out
    if (edit.only) {
      const inside = lines.slice(a, b).join("\n");
      const others = [...inside.matchAll(/ipcMain\.(?:handle|on)\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]).filter((name) => !edit.only.includes(name));
      if (others.length) throw new Error("the part from  " + edit.from.trim() + "  on its own (" + others.join(", ") + " is in the middle of it)");
    }
    const put = edit.text ? edit.text.replace(/\n$/, "").split("\n") : [];
    lines.splice(a, b - a, ...put);
    return { text: lines.join("\n"), changed: true };
  }
  throw new Error("how to make the change: " + edit.label);
}

// After the edits, none of these may be left, and all of the second list must be there. If not,
// an edit didn't fit this copy of AURA, and nothing is written.
const LEFTOVERS = {
  app: ['<PageBoundary name="social"><SocialPage visible={view==="social"}'],
};
const REQUIRED = {
  app: ["function SocialKeeper(", 'id="social-slot"', '\n        <SocialKeeper key="social-keeper"', '\n      <SocialKeeper key="social-keeper"', "{import.meta.env.DEV && <div className=\"sr\"><div><div className=\"sr-l\">Error log</div>"],
  social: ["const HOMEPAGE_KEY =", "const firstPage = useRef(", 'className="bmk-menu home-menu"'],
};

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
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) visit(full, depth + 1);
      } else if (entry.name.endsWith(BAK)) {
        const target = full.slice(0, -BAK.length);
        fs.copyFileSync(full, target); fs.unlinkSync(full);
        say("  restored  " + rel(target)); restored++;
      } else if (CREATED.includes(entry.name)) {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. Everything is back to how it was." : "Nothing to undo.");
  say();
}

// ── Run ───────────────────────────────────────────────────────────────────────
function run() {
  const pkgFile = path.join(ROOT, "package.json");
  if (!fs.existsSync(pkgFile)) stop(["This isn't your AURA project folder (no package.json here).", "Move this file next to package.json and run it from there."]);
  if (UNDO) return undo();

  const where = {
    app: { file: path.join(ROOT, "src", "App.jsx"), name: "window", js: false },
    social: { file: path.join(ROOT, "src", "components", "social.jsx"), name: "Social", js: false },
    runner: { file: path.join(ROOT, "tests", "run.cjs"), name: "checks", js: true, optional: true },
  };
  const missing = Object.values(where).filter((w) => !w.optional && !fs.existsSync(w.file)).map((w) => rel(w.file));
  if (missing.length) stop(["I couldn't find " + missing.join(" or ") + ".", "Make sure this file is in your AURA project folder, next to package.json.", "Copy this message to Claude."]);
  const hasChecks = fs.existsSync(where.runner.file);

  const plan = [];
  const problems = [];
  for (const [key, w] of Object.entries(where)) {
    if (w.optional && !fs.existsSync(w.file)) continue;
    const { text, eol } = readText(w.file);
    let now = text;
    const notes = [];
    for (const edit of EDITS.filter((e) => e.file === key)) {
      try {
        const result = applyEdit(now, edit);
        if (result.changed) { now = result.text; if (!notes.includes(edit.label)) notes.push(edit.label); }
      } catch (e) { problems.push("In " + rel(w.file) + " I couldn't find " + e.message + "."); }
    }
    const left = (LEFTOVERS[key] || []).filter((piece) => now.includes(piece));
    if (left.length) problems.push("In " + rel(w.file) + " I couldn't safely remove: " + left.join(", ") + ".");
    const absent = (REQUIRED[key] || []).filter((piece) => !now.includes(piece));
    if (absent.length) problems.push("In " + rel(w.file) + " I couldn't put in: " + absent.join(", ") + ".");
    if (w.js && now !== text) { const bad = syntaxProblem(now); if (bad) problems.push("In " + rel(w.file) + " I couldn't find a way to edit it safely (" + bad + ")."); }
    plan.push({ label: w.name, file: w.file, before: text, after: now, eol, notes });
  }

  const created = [];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "browser-home.cjs"), content: FILES.home });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: the Social browser");
  say();
  for (const step of plan) {
    if (step.after !== step.before && !DRY) {
      const bak = step.file + BAK;
      if (!fs.existsSync(bak)) fs.copyFileSync(step.file, bak);
      fs.writeFileSync(step.file, withEol(step.after, step.eol));
    }
    say("  " + (step.label + ":").padEnd(11) + rel(step.file));
    (step.notes.length ? step.notes : ["already done"]).forEach((n) => say("             - " + n));
  }
  for (const c of created) {
    if (c.note !== "already done" && !DRY) { fs.mkdirSync(path.dirname(c.file), { recursive: true }); fs.writeFileSync(c.file, c.content); }
    say("  " + (c.label + ":").padEnd(11) + rel(c.file));
    say("             - " + c.note);
  }
  for (const r of RETIRED) {
    const file = path.join(ROOT, r.file);
    let mine = false;
    try { mine = fs.readFileSync(file, "utf8").includes(r.mark); } catch {}
    if (!mine) continue;
    if (!DRY) { const bak = file + BAK; if (!fs.existsSync(bak)) fs.copyFileSync(file, bak); fs.unlinkSync(file); }
    say("  " + "checks:".padEnd(11) + rel(file));
    say("             - removed (the new check covers it)");
  }
  say();
  if (DRY) { say("Run it again without --dry-run to apply."); say(); return; }
  say("Done. Next:");
  if (hasChecks) say("  1. Check everything still works:   npm test");
  say("  " + (hasChecks ? "2" : "1") + ". Start AURA. Play a YouTube video in Social > Browser, click Home, then Social again:");
  say("     the video should pop out, stay out on Home, and go back into the page.");
  say("     Right-click the browser's Home button to choose a homepage.");
  say();
  say("To undo later:  node aura-browser-home-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
