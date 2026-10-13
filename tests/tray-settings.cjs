// Settings > Calls and messages: "Keep AURA running when closed" and "Start AURA when Windows
// starts". Opens the built window (dist) in a real browser with a pretend desktop side and checks
// the two switches, what they start as, and that each change is passed to the desktop side.
// Added by aura-tray-setup.cjs.
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

  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const thrown = [];
  page.on("pageerror", (e) => thrown.push(String(e.message || e).split("\n")[0]));
  await page.route((url) => !String(url).startsWith(base), (route) => route.abort());
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem("__started")) {
        sessionStorage.setItem("__started", "1");
        localStorage.clear();
        localStorage.setItem("aura_profile", JSON.stringify({ username: "tester", avatar: "", userId: "user-1" }));
      }
    } catch {}
    window.__synced = [];
    const ok = (data) => Promise.resolve({ success: true, data });
    const account = { getSession: () => ok({ id: "user-1", email: "me@example.com" }), getMyProfile: () => ok({ username: "tester", avatar_url: null }) };
    const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (name === "auraCloud" && account[key]) ? account[key](...args) : ok(null)) });
    window.auraCloud = fake("auraCloud");
    window.auraSocial = fake("auraSocial");
    window.electronAPI = new Proxy({}, {
      get: (_t, key) => {
        if (key === "isElectron") return true;
        if (typeof key !== "string" || key === "then") return undefined;
        if (/^on[A-Z]/.test(key)) return () => () => {};
        if (/^remove/.test(key)) return () => {};
        if (key === "settingsSync") return (patch) => { window.__synced.push(patch); return Promise.resolve(patch); };
        return () => Promise.resolve({ success: false });
      },
    });
  });
  const open = async () => {
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(4500);
    await page.locator('.gm-rail-item[title="Settings"], .sb-item[title="Settings"]').first().click({ timeout: 5000 });
    await page.waitForTimeout(900);
  };
  const look = () => page.evaluate(() => {
    const title = [...document.querySelectorAll(".ss-t")].find((t) => t.textContent.trim() === "CALLS AND MESSAGES");
    const rows = title ? [...title.parentElement.querySelectorAll(".sr")] : [];
    const row = (label) => rows.find((r) => r.querySelector(".sr-l")?.textContent.trim() === label);
    const sw = (label) => { const r = row(label); const t = r?.querySelector(".tog"); return r && t ? { on: t.classList.contains("on"), says: r.querySelector(".sr-s")?.textContent.trim() || "" } : null; };
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem("aura_settings") || "{}"); } catch {}
    return { section: !!title, keep: sw("Keep AURA Running When Closed"), start: sw("Start AURA When Windows Starts"), synced: window.__synced, saved: { keepRunning: saved.keepRunning, startWithWindows: saved.startWithWindows } };
  });
  const flip = async (label) => {
    const t = page.locator(".sr", { has: page.locator(".sr-l", { hasText: label }) }).locator(".tog");
    await t.scrollIntoViewIfNeeded({ timeout: 4000 });
    await t.click({ timeout: 4000 });
    await page.waitForTimeout(300);
  };

  try {
    console.log("1. The switches");
    await open();
    let s = await look();
    check("Settings has a Calls and messages section", s.section, s);
    check("\"Keep AURA Running When Closed\" is there and starts on", !!s.keep && s.keep.on, s.keep);
    check("it says why (calls and messages still reach you) and how to quit", !!s.keep && /calls and messages still reach you/.test(s.keep.says) && /right-click the AURA icon/.test(s.keep.says), s.keep && s.keep.says);
    check("\"Start AURA When Windows Starts\" is there and starts off", !!s.start && !s.start.on, s.start);
    check("opening Settings tells the desktop side the current choices (as it does for the other settings)", s.synced.length > 0 && s.synced.every((p) => p.keepRunning !== false && p.startWithWindows !== true) && s.synced.some((p) => p.keepRunning === true && p.startWithWindows === false), s.synced);

    console.log("2. Changing them");
    await flip("Keep AURA Running When Closed");
    s = await look();
    check("turning \"Keep running\" off tells the desktop side", !s.keep.on && s.synced.some((p) => p.keepRunning === false), s.synced);
    await flip("Start AURA When Windows Starts");
    s = await look();
    check("turning \"Start with Windows\" on tells the desktop side", s.start.on && s.synced.some((p) => p.startWithWindows === true), s.synced);
    check("both are remembered", s.saved.keepRunning === false && s.saved.startWithWindows === true, s.saved);
    await open();
    s = await look();
    check("and still set after AURA restarts", !s.keep.on && s.start.on, [s.keep, s.start]);
    await flip("Keep AURA Running When Closed");
    await flip("Start AURA When Windows Starts");
    s = await look();
    check("turning them back tells the desktop side too", s.keep.on && !s.start.on && s.synced.some((p) => p.keepRunning === true) && s.synced.some((p) => p.startWithWindows === false), s.synced);
    check("nothing crashed along the way", (await page.locator(".aura-fallback").count()) === 0 && thrown.length === 0, thrown);
  } finally {
    await browser.close();
    server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The Settings check itself broke:", e); process.exit(2); });
