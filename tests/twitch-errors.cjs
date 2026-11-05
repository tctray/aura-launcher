// Live on Twitch: when streams can't be loaded, AURA says why and offers Try again, instead of
// saying no one is live. Opens the built window (dist) in a real browser.
// Added by aura-twitch-errors-setup.cjs; retrying by itself added by aura-twitch-retry-setup.cjs.
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

  const thrown = [];
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on("pageerror", (e) => thrown.push(String(e.message || e).split("\n")[0]));
  await page.route((url) => !String(url).startsWith(base), (route) => route.abort());
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem("__started")) {
        sessionStorage.setItem("__started", "1");
        localStorage.clear();
        localStorage.setItem("aura_profile", JSON.stringify({ username: "tester", avatar: "", userId: "user-1" }));
        localStorage.setItem("aura_games", JSON.stringify([{ id: "g1", title: "Fortnite", cover: "/icon.png", genre: "Other" }]));
      }
    } catch {}
    window.__asked = 0;
    window.__mode = sessionStorage.getItem("__mode") || "fail";
    const ok = (data) => Promise.resolve({ success: true, data });
    const account = { getSession: () => ok({ id: "user-1", email: "me@example.com" }), getMyProfile: () => ok({ username: "tester", avatar_url: null }) };
    const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (name === "auraCloud" && account[key]) ? account[key](...args) : ok(null)) });
    window.auraCloud = fake("auraCloud");
    window.auraSocial = fake("auraSocial");
    const stream = { id: "s1", user: "Ninja", login: "ninja", title: "Fortnite with chat", game: "Fortnite", viewers: 12000, thumbnail: "/icon.png", url: "https://twitch.tv/ninja" };
    window.electronAPI = new Proxy({}, {
      get: (_t, key) => {
        if (key === "isElectron") return true;
        if (typeof key !== "string" || key === "then") return undefined;
        if (/^on[A-Z]/.test(key)) return () => () => {};
        if (/^remove/.test(key)) return () => {};
        if (key === "fetchTwitchStreams") return () => { window.__asked++; if (window.__mode === "failonce" || window.__mode === "fail1") window.__mode = window.__asked === 1 ? "fail1" : "ok"; return Promise.resolve(window.__mode === "fail" || window.__mode === "fail1" ? { success: false, error: "AURA couldn't find your login on this PC. Log out and log back in." } : { success: true, streams: [stream] }); };
        return () => Promise.resolve({ success: false });
      },
    });
  });
  try {
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(4500);
    console.log("1. Home: Live on Twitch");
    const shelf = page.locator(".twitch-shelf");
    check("when streams can't be loaded, it says why (not just “none live”)", /Couldn't load live streams: AURA couldn't find your login on this PC/.test(await shelf.innerText()) && !/No live streams found/.test(await shelf.innerText()));
    await page.evaluate(() => { window.__mode = "ok"; });
    const before = await page.evaluate(() => window.__asked);
    await shelf.getByRole("button", { name: "Try again" }).click();
    await page.waitForTimeout(800);
    check("Try again asks again, and the streams show", (await page.evaluate(() => window.__asked)) > before && /Ninja/i.test(await page.locator(".twitch-shelf").innerText()) && !/Couldn't load/.test(await page.locator(".twitch-shelf").innerText()));
    console.log("2. Live Streams page");
    await page.evaluate(() => { window.__mode = "fail"; });
    await page.locator('.gm-rail-item[title="Live Streams"], .sb-item[title="Live Streams"]').first().click();
    await page.waitForTimeout(1500);
    check("the Live Streams page says why too", await page.getByText("Couldn't load live streams").isVisible() && await page.getByText("AURA couldn't find your login on this PC. Log out and log back in.").isVisible());
    await page.evaluate(() => { window.__mode = "ok"; });
    await page.locator("button.btn-gh", { hasText: "Try again" }).click();
    await page.waitForTimeout(1200);
    check("...and Try again brings the streams", !(await page.getByText("Couldn't load live streams").count()) && (await page.getByText("Ninja", { exact: false }).count()) > 0);
    console.log("3. Right as AURA starts"); // (Added by aura-twitch-retry-setup.cjs)
    await page.evaluate(() => sessionStorage.setItem("__mode", "failonce"));
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(3500);
    check("if the first try fails (the login isn't ready yet), it says so for now", /Couldn't load live streams/.test(await page.locator(".twitch-shelf").innerText().catch(() => "")));
    await page.waitForTimeout(6000);
    check("...and tries again by itself a few seconds later, and the streams show", /Ninja/i.test(await page.locator(".twitch-shelf").innerText().catch(() => "")) && (await page.evaluate(() => window.__asked)) === 2, await page.evaluate(() => ({ asked: window.__asked, mode: window.__mode, text: document.querySelector(".twitch-shelf")?.innerText.slice(0, 200) })));
    check("no errors in the window", thrown.length === 0, thrown);
  } catch (e) {
    check("the test ran to the end", false, String(e?.stack || e).slice(0, 500));
  }
  await browser.close();
  server.close();
  done(failed ? 1 : 0);
})();
