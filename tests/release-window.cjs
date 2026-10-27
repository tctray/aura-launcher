// Release fixes in the window: the F9/F10 switches in Settings (off by default), the shortcut text,
// and the window resting (animations paused, slideshow waiting) while it's hidden.
// Opens the built window (dist) in a real browser with a pretend AURA.
// Added by aura-release-fixes-setup.cjs.
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff", ".webp": "image/webp", ".mp4": "video/mp4" };
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok || extra === undefined ? "" : "  " + JSON.stringify(extra))); };
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

  async function open(hash = "") {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());
    await page.addInitScript(() => {
      try { localStorage.clear(); localStorage.setItem("aura_profile", JSON.stringify({ username: "tctray", avatar: "", userId: "user-1" })); } catch {}
      window.__synced = []; window.__shown = [];
      const ok = (data) => Promise.resolve({ success: true, data });
      const answers = { getSession: () => ok({ id: "user-1", email: "me@example.com" }), getMyProfile: () => ok({ username: "tctray", avatar_url: null }) };
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => { if (/^on[A-Z]/.test(String(key))) return () => {}; return (name === "auraCloud" && answers[key]) ? answers[key](...args) : ok(null); }) });
      window.auraCloud = fake("auraCloud");
      window.auraSocial = fake("auraSocial");
      const api = {
        settingsSync: async (patch) => { window.__synced.push(patch); return patch; },
        onWindowShown: (cb) => { window.__shown.push(cb); return () => {}; },
        barGetState: async () => ({ recording: false, game: null, hotkey: "Alt+Shift+R", barHotkey: "Alt+Shift+B" }),
      };
      window.electronAPI = new Proxy({}, { get: (_t, key) => {
        if (key in api) return api[key];
        if (key === "isElectron" || key === "then") return undefined;
        return (...args) => { if (/^on[A-Z]/.test(String(key))) return () => {}; return Promise.resolve(null); };
      } });
    });
    await page.goto(base + "/index.html" + hash, { waitUntil: "load" });
    await page.waitForTimeout(3000);
    return page;
  }
  let page;
  try {
    console.log("1. F9 and F10 in Settings");
    page = await open();
    await page.locator('.gm-rail-item:has-text("Settings"), .sb-item:has-text("Settings")').first().click();
    await page.waitForTimeout(600);
    check("Settings says which shortcuts work in games", await page.getByText("Alt + Shift + R starts and stops recording, Alt + Shift + B shows the AURA Bar.").isVisible());
    const f9 = page.locator(".sr", { hasText: "Also Use F9 to Record" }).locator(".tog");
    const f10 = page.locator(".sr", { hasText: "Also Use F10 for the AURA Bar" }).locator(".tog");
    check("F9 and F10 are off to start with", !(await f9.getAttribute("class")).includes("on") && !(await f10.getAttribute("class")).includes("on"));
    await f9.click(); await page.waitForTimeout(300);
    check("switching F9 on tells AURA", (await f9.getAttribute("class")).includes("on") && await page.evaluate(() => window.__synced.some((p) => p.keyF9 === true)));
    await f9.click(); await page.waitForTimeout(300);
    check("...and off again", await page.evaluate(() => window.__synced.some((p) => p.keyF9 === false)));
    await f10.click(); await page.waitForTimeout(300);
    check("F10 the same way", await page.evaluate(() => window.__synced.some((p) => p.keyF10 === true)));

    console.log("2. Resting while hidden");
    check("AURA listens for its window being hidden", await page.evaluate(() => window.__shown.length >= 1));
    await page.evaluate(() => window.__shown.forEach((cb) => cb(false)));
    check("hidden: AURA rests (animations paused)", await page.evaluate(() => document.documentElement.classList.contains("aura-resting") && window.__auraHidden === true));
    const paused = await page.evaluate(() => { const d = document.createElement("div"); d.style.animation = "x 1s infinite"; document.body.appendChild(d); const s = getComputedStyle(d).animationPlayState; d.remove(); return s; });
    check("...any animation is paused", paused === "paused", paused);
    await page.evaluate(() => window.__shown.forEach((cb) => cb(true)));
    check("shown again: back to normal", await page.evaluate(() => !document.documentElement.classList.contains("aura-resting") && window.__auraHidden === false));
    await page.context().close();

    console.log("3. The AURA Bar");
    page = await open("#aurabar");
    check("the bar says its own shortcut, not F10", /Alt\+Shift\+B to hide/.test(await page.locator("body").innerText()), (await page.locator("body").innerText()).slice(0, 200));
  } catch (e) {
    check("the test ran to the end", false, String(e?.message || e).slice(0, 400));
  }
  await browser.close();
  server.close();
  done(failed ? 1 : 0);
})();
