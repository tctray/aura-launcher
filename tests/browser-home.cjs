// The Social browser: it survives a visit to Home, has a homepage, and reopens where you were.
// Also: the Error log row in Settings is only there while developing.
//
// Opens the built window (dist) in a real browser with a pretend desktop side and pretend pages
// in the Social tabs, and checks:
//   - going to Home (or any page) and back leaves the Browser tab's page exactly as it was
//   - the Social page sits exactly over the space left for it, and is hidden on other pages
//   - the Home button opens your homepage once you've chosen one; right-click to choose
//   - the Browser tab opens on the page you were last on
//   - only ordinary https pages are kept
// Added by aura-browser-home-setup.cjs.
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff" };
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok || extra === undefined ? "" : "\n          " + (typeof extra === "string" ? extra : JSON.stringify(extra)))); };
const note = (text) => console.log("  note  " + text);
const done = (code) => { console.log(code === 0 ? "\nall passed" : code === 3 ? "\nskipped" : `\n${failed} FAILED`); process.exit(code); };

(async () => {
  if (!fs.existsSync(path.join(DIST, "index.html"))) { check("the window has been built (dist/index.html)", false, "Run  npm run build  first."); return done(1); }
  let chromium;
  try { ({ chromium } = require("playwright")); } catch { note("the test browser isn't installed here"); return done(process.env.CI ? 1 : 3); }
  let browser = null;
  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: "msedge" }, { channel: "chrome" }]) {
    try { browser = await chromium.launch(options); break; } catch {}
  }
  if (!browser) { note("no browser to test with. Run  npx playwright install chromium  once to add one."); return done(process.env.CI ? 1 : 3); }

  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path.join(DIST, url === "/" ? "index.html" : url);
    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
      res.end(data);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;

  // Start AURA logged in. `saved` is what this PC already remembers (as AURA's own storage holds it).
  async function start(saved = {}) {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    const thrown = [];
    page.on("pageerror", (e) => thrown.push(String(e.message || e).split("\n")[0]));
    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());
    await page.addInitScript((saved) => {
      try {
        if (!sessionStorage.getItem("__started")) { // keep storage across a reload inside one run
          localStorage.clear();
          localStorage.setItem("aura_profile", JSON.stringify({ username: "tester", avatar: "", userId: "user-1" }));
          for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v);
          sessionStorage.setItem("__started", "1");
        }
      } catch {}
      const ok = (data) => Promise.resolve({ success: true, data });
      const account = { getSession: () => ok({ id: "user-1", email: "me@example.com" }), getMyProfile: () => ok({ username: "tester", avatar_url: null }), saveProfile: (name, picture) => ok({ username: name, avatar_url: picture || null }) };
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (name === "auraCloud" && account[key]) ? account[key](...args) : ok(null)) });
      window.auraCloud = fake("auraCloud");
      window.auraSocial = fake("auraSocial");
      window.electronAPI = new Proxy({}, {
        get: (_t, key) => {
          if (key === "isElectron") return true;
          if (typeof key !== "string" || key === "then") return undefined;
          if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};
          return () => Promise.resolve({ success: false });
        },
      });
      // A pretend page in each Social tab. In the desktop app these are real embedded pages; here
      // each one remembers the address it was sent to, and counts how often it was loaded.
      window.__loads = [];
      const give = (name, fn) => { HTMLElement.prototype[name] = fn; };
      give("isCurrentlyAudible", () => false);
      give("executeJavaScript", () => Promise.resolve(""));
      give("canGoBack", () => false);
      give("canGoForward", () => false);
      give("getURL", function () { return this.__url || this.getAttribute("src") || "about:blank"; });
      give("getTitle", () => "A page");
      give("reload", () => {});
      give("loadURL", function (url) { window.__loads.push(url); this.__url = url; this.dispatchEvent(new Event("did-navigate")); this.dispatchEvent(new Event("did-stop-loading")); return Promise.resolve(); });
    }, saved);
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(4500);
    const menu = async (name) => { await page.locator(`.gm-rail-item[title="${name}"], .sb-item[title="${name}"]`).first().click({ timeout: 5000 }); await page.waitForTimeout(650); };
    const tab = async (name) => { await page.getByRole("tab", { name, exact: true }).click({ timeout: 5000 }); await page.waitForTimeout(350); };
    // The Browser tab's page: where it is, and whether it is still the very same one
    const browserPage = () => page.evaluate(() => {
      const el = document.querySelector('webview[partition="persist:social-browser"]');
      if (!el) return null;
      if (!el.__told) { el.__told = true; el.dispatchEvent(new Event("dom-ready")); } // a real page says when it's ready
      return { url: el.getURL(), src: el.getAttribute("src"), mark: el.__mark || "", shown: el.offsetParent !== null || getComputedStyle(el).position === "fixed" };
    });
    const mark = (text) => page.evaluate((t) => { document.querySelector('webview[partition="persist:social-browser"]').__mark = t; }, text);
    const stored = (key) => page.evaluate((k) => localStorage.getItem(k), key);
    const startPage = () => page.locator('input[aria-label="Search or web address"]').isVisible();
    const go = async (url) => { const box = page.locator('input[aria-label="Address"]'); await box.fill(url); await box.press("Enter"); await page.waitForTimeout(400); };
    const homeMenu = async () => { await page.locator(".home-btn").click({ button: "right", timeout: 4000 }); await page.waitForTimeout(250); return page.locator(".home-menu button").evaluateAll((els) => els.map((b) => b.textContent.trim() + (b.disabled ? " (off)" : ""))); };
    const pick = async (text) => { await page.locator(".home-menu").getByText(text, { exact: true }).click({ timeout: 4000 }); await page.waitForTimeout(350); };
    return { page, thrown, menu, tab, browserPage, mark, stored, startPage, go, homeMenu, pick };
  }

  try {
    console.log("1. Going Home and coming back");
    let app = await start();
    await app.menu("Social");
    await app.tab("Browser");
    check("the Browser tab starts on AURA's start page", await app.startPage());
    await app.page.getByText("YouTube", { exact: true }).first().click({ timeout: 5000 });
    await app.page.waitForTimeout(500);
    let p = await app.browserPage();
    check("a quick link opens the page", !!p && p.url === "https://www.youtube.com/" && !(await app.startPage()), p);
    await app.mark("the one I opened");
    const place = () => app.page.evaluate(() => { const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(e).display }; }; return { keeper: box(".social-keeper"), slot: box("#social-slot") }; });
    let at = await place();
    check("the Social page sits exactly over the space left for it", !!at.keeper && !!at.slot && at.keeper.x === at.slot.x && at.keeper.y === at.slot.y && at.keeper.w === at.slot.w && at.keeper.h === at.slot.h && at.keeper.w > 400 && at.keeper.h > 300, at);
    const loadsBefore = await app.page.evaluate(() => window.__loads.length);
    await app.menu("Home");
    at = await place();
    p = await app.browserPage();
    check("on Home the Social page is hidden, not thrown away", !!at.keeper && at.keeper.display === "none" && !!p && p.mark === "the one I opened", { at, p });
    await app.menu("Social");
    p = await app.browserPage();
    check("back on Social it is the very same page, still where you left it", !!p && p.mark === "the one I opened" && p.url === "https://www.youtube.com/" && !(await app.startPage()), p);
    check("and nothing was loaded again", (await app.page.evaluate(() => window.__loads.length)) === loadsBefore);
    for (const name of ["Library", "Home", "Settings", "Home", "Live Streams"]) await app.menu(name);
    await app.menu("Social");
    p = await app.browserPage();
    at = await place();
    check("the same after a tour of other pages, Home twice", !!p && p.mark === "the one I opened" && (await app.page.evaluate(() => window.__loads.length)) === loadsBefore && at.keeper.display !== "none" && at.keeper.w === at.slot.w, { p, at });
    await app.page.setViewportSize({ width: 1180, height: 760 });
    await app.page.waitForTimeout(700);
    at = await place();
    check("it follows the window when it changes size", at.keeper.x === at.slot.x && at.keeper.w === at.slot.w && at.keeper.h === at.slot.h, at);
    await app.page.setViewportSize({ width: 1440, height: 900 });
    await app.page.waitForTimeout(600);

    console.log("2. A homepage");
    let items = await app.homeMenu();
    check("right-clicking the Home button offers to make this page the homepage", items.join("|") === "Make this page my homepage|Open the start page", items);
    await app.pick("Make this page my homepage");
    check("choosing it is remembered on this PC", (await app.stored("aura_browser_home")) === "https://www.youtube.com/" && (await app.page.locator(".home-menu").count()) === 0);
    await app.go("https://www.twitch.tv/");
    p = await app.browserPage();
    check("typing an address goes there", p.url === "https://www.twitch.tv/", p);
    await app.page.locator(".home-btn").click({ timeout: 4000 });
    await app.page.waitForTimeout(400);
    p = await app.browserPage();
    check("the Home button now opens the homepage, not the start page", p.url === "https://www.youtube.com/" && !(await app.startPage()), p);
    check("its tip says where it goes", /Home: youtube\.com/.test(await app.page.locator(".home-btn").getAttribute("title")));
    items = await app.homeMenu();
    check("the menu now also offers AURA's start page back", items.join("|") === "Make this page my homepage|Use AURA's start page instead|Open the start page", items);
    await app.pick("Open the start page");
    check("\"Open the start page\" shows it without changing the homepage", (await app.startPage()) && (await app.stored("aura_browser_home")) === "https://www.youtube.com/");
    items = await app.homeMenu();
    check("on the start page there is no page to make the homepage", items[0] === "Make this page my homepage (off)", items);
    await app.pick("Use AURA's start page instead");
    await app.page.getByText("Reddit", { exact: true }).first().click({ timeout: 5000 });
    await app.page.waitForTimeout(400);
    await app.page.locator(".home-btn").click({ timeout: 4000 });
    await app.page.waitForTimeout(400);
    check("with the homepage cleared, Home is the start page again", (await app.startPage()) && (await app.stored("aura_browser_home")) === null);
    await app.homeMenu();
    await app.page.keyboard.press("Escape");
    await app.page.waitForTimeout(250);
    check("Escape closes the menu", (await app.page.locator(".home-menu").count()) === 0);

    console.log("3. Where you were");
    check("on the start page, nothing is remembered as \"where you were\"", (await app.stored("aura_browser_last")) === null);
    await app.go("https://store.steampowered.com/");
    check("the page you go to is remembered", (await app.stored("aura_browser_last")) === "https://store.steampowered.com/");
    await app.go("http://example.com/");
    check("a page that isn't https is not", (await app.stored("aura_browser_last")) === "https://store.steampowered.com/");
    check("nothing crashed along the way", (await app.page.locator(".aura-fallback").count()) === 0, app.thrown);
    await app.page.context().close();

    const opensOn = async (saved) => {
      const a = await start({ aura_social_tab: "browser", ...saved });
      await a.menu("Social");
      const result = { page: await a.browserPage(), start: await a.startPage() };
      await a.page.context().close();
      return result;
    };
    let o = await opensOn({ aura_browser_last: "https://store.steampowered.com/" });
    check("next time, the Browser tab opens on the page you were on", !!o.page && o.page.src === "https://store.steampowered.com/" && !o.start, o);
    o = await opensOn({ aura_browser_last: "https://store.steampowered.com/", aura_browser_home: "https://www.youtube.com/" });
    check("where you were comes before the homepage", !!o.page && o.page.src === "https://store.steampowered.com/" && !o.start, o);
    o = await opensOn({ aura_browser_home: "https://www.youtube.com/" });
    check("with nowhere remembered, it opens on your homepage", !!o.page && o.page.src === "https://www.youtube.com/" && !o.start, o);
    o = await opensOn({});
    check("with neither, it opens on the start page", !!o.page && o.page.src === "about:blank" && o.start, o);
    o = await opensOn({ aura_browser_last: "javascript:alert(1)", aura_browser_home: "http://example.com/" });
    check("anything in storage that isn't an ordinary https page is ignored", !!o.page && o.page.src === "about:blank" && o.start, o);

    console.log("4. Settings");
    app = await start();
    await app.menu("Settings");
    await app.page.getByText("Privacy", { exact: true }).first().scrollIntoViewIfNeeded({ timeout: 5000 });
    check("the installed app's Settings has no Error log row", (await app.page.getByText("Error log", { exact: true }).count()) === 0 && (await app.page.getByText("Privacy", { exact: true }).count()) > 0);
    await app.page.context().close();
    const source = (() => { try { return fs.readFileSync(path.join(ROOT, "src", "App.jsx"), "utf8"); } catch { return ""; } })();
    const safety = (() => { try { return fs.readFileSync(path.join(ROOT, "src", "components", "safety.jsx"), "utf8"); } catch { return ""; } })();
    check("it is still there while developing", /import\.meta\.env\.DEV && <div className="sr"><div><div className="sr-l">Error log<\/div>/.test(source));
    check("and a page that crashes still offers \"Open error log\"", /Open error log/.test(safety) && /aura-fallback/.test(safety));
  } finally {
    await browser.close();
    server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The Social browser check itself broke:", e); process.exit(2); });
