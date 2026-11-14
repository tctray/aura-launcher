// Sidebar badges only count what's new since you last opened that page, and the Social page has no
// Instagram or Facebook tab. Opens the built window (dist) in a real browser.
// Added by aura-badges-social-setup.cjs.
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => thrown.push(String(e.message || e).split("\n")[0]));
  await page.route((url) => !String(url).startsWith(base), (route) => route.abort());
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem("__started")) {
        sessionStorage.setItem("__started", "1");
        localStorage.clear();
        localStorage.setItem("aura_profile", JSON.stringify({ username: "tester", avatar: "", userId: "user-1" }));
        const g = (id, title, favorite) => ({ id, title, exePath: "C:\\Games\\" + id + ".exe", cover: "", category: "Other", favorite, playCount: 0, lastPlayed: null, addedAt: 1 });
        localStorage.setItem("aura_games", JSON.stringify([g("g1", "Old Game", false), g("g2", "New Game", true), g("g3", "Another New Game", true)]));
        localStorage.setItem("aura_achievements", JSON.stringify({ first: 1, five: 2 }));
        // Last time you looked: only Old Game was in the library, nothing was a favorite, and one achievement was unlocked
        localStorage.setItem("aura_seen_badges", JSON.stringify({ library: ["g1"], favorites: [], achievements: ["first"] }));
        localStorage.setItem("aura_social_tab", "instagram");
      }
    } catch {}
    const ok = (data) => Promise.resolve({ success: true, data });
    const account = { getSession: () => ok({ id: "user-1", email: "me@example.com" }), getMyProfile: () => ok({ username: "tester", avatar_url: null }) };
    const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (name === "auraCloud" && account[key]) ? account[key](...args) : ok(null)) });
    window.auraCloud = fake("auraCloud"); window.auraSocial = fake("auraSocial");
    window.electronAPI = new Proxy({}, { get: (_t, key) => (key === "isElectron" ? true : (typeof key !== "string" || key === "then") ? undefined : /^on[A-Z]/.test(key) ? () => () => {} : /^remove/.test(key) ? () => {} : () => Promise.resolve({ success: false })) });
  });
  // The number on the wide sidebar, or "dot" for the dot on the narrow one
  const badge = (label) => page.evaluate((label) => {
    const wide = [...document.querySelectorAll(".sb-item")].find((e) => e.textContent.includes(label));
    if (wide) return wide.querySelector(".sb-badge")?.textContent || "";
    const rail = document.querySelector(`.gm-rail-item[title="${label}"]`);
    return rail?.querySelector(".gm-rail-badge") ? "dot" : "";
  }, label);
  const is = (got, n) => got === String(n) || got === "dot";
  const go = async (label) => { await page.locator(`.sb-item[title="${label}"], .gm-rail-item[title="${label}"]`).first().click(); await page.waitForTimeout(600); };
  try {
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(4000);
    console.log("1. Sidebar badges");
    check("Library is marked for the 2 games new since you last looked", is(await badge("Library"), 2), await badge("Library"));
    check("Favorites is marked for the 2 new favorites", is(await badge("Favorites"), 2), await badge("Favorites"));
    check("Achievements is marked for the newly unlocked one", (await badge("Achievements")) !== "", await badge("Achievements")); // (1 from before, plus any AURA unlocks as it starts)
    await go("Library");
    check("opening Library clears its badge", (await badge("Library")) === "");
    check("...the others stay until you open them", is(await badge("Favorites"), 2) && (await badge("Achievements")) !== "");
    await go("Favorites"); await go("Achievements"); await go("Home");
    check("opening Favorites and Achievements clears theirs too", (await badge("Favorites")) === "" && (await badge("Achievements")) === "");
    await page.reload({ waitUntil: "load" }); await page.waitForTimeout(4000);
    check("still clear after restarting AURA", (await badge("Library")) === "" && (await badge("Favorites")) === "" && (await badge("Achievements")) === "");
    await page.evaluate(() => { const gs = JSON.parse(localStorage.getItem("aura_games")); gs.unshift({ id: "g4", title: "Brand New", exePath: "C:\\Games\\g4.exe", cover: "", category: "Other", favorite: false, playCount: 0, lastPlayed: null, addedAt: 2 }); localStorage.setItem("aura_games", JSON.stringify(gs)); });
    await page.reload({ waitUntil: "load" }); await page.waitForTimeout(4000);
    check("a game added later marks Library again", is(await badge("Library"), 1), await badge("Library"));

    console.log("2. Social");
    await go("Web"); // (the Social page is called Web now: (Added by aura-web-page-setup.cjs))
    const tabs = await page.locator('[role="tablist"][aria-label="Social sites"] [role="tab"]').allInnerTexts();
    check("no site tabs: Social is just the Browser", tabs.length === 0, tabs); // (just the Browser since aura-web-page-setup.cjs)
    check("...even if Instagram was your last tab, it opens on the Browser's start page", await page.getByText("YouTube", { exact: true }).first().isVisible());
    check("no errors in the window", thrown.length === 0, thrown);
  } catch (e) {
    check("the test ran to the end", false, String(e?.stack || e).slice(0, 500));
  }
  await browser.close();
  server.close();
  done(failed ? 1 : 0);
})();
