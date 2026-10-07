// Opens the built window (the dist folder) in a real browser, the way AURA's own window loads it,
// and makes sure it comes up: something is on screen, and no page has crashed. Then it clicks
// through every page in the menu it can reach.
//
// It runs without the desktop side of AURA, so it sees the app the way a first-time visitor does:
// either the log-in page, or AURA with its demo library. Both count as "came up".
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff", ".webp": "image/webp", ".mp4": "video/mp4" };
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok || extra === undefined ? "" : "\n          " + String(extra).split("\n").join("\n          "))); };
const note = (text) => console.log("  note  " + text);
const done = (code) => { console.log(code === 0 ? "\nall passed" : code === 3 ? "\nskipped" : `\n${failed} FAILED`); process.exit(code); };

(async () => {
  if (!fs.existsSync(path.join(DIST, "index.html"))) { check("the window has been built (dist/index.html)", false, "Run  npm run build  first."); return done(1); }
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch { note("the test browser isn't installed here (run  npm install  to add it)"); return done(process.env.CI ? 1 : 3); }

  // A browser to open it in: the one Playwright installs, or Edge or Chrome already on this PC
  let browser = null, tried = [];
  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: "msedge" }, { channel: "chrome" }]) {
    try { browser = await chromium.launch(options); break; } catch (e) { tried.push(String(e.message).split("\n")[0]); }
  }
  if (!browser) { note("no browser to test with. Run  npx playwright install chromium  once to add one.\n          " + tried.join("\n          ")); return done(process.env.CI ? 1 : 3); }

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

  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    const thrown = [];
    page.on("pageerror", (e) => thrown.push(String(e.message || e).split("\n")[0]));
    // Pictures, fonts and streams from the internet aren't needed for this, and CI may not reach them
    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());
    // Open it as someone who has used AURA before, so the first-run profile setup isn't in the way
    await page.addInitScript(() => { try { if (!localStorage.getItem("aura_profile")) localStorage.setItem("aura_profile", JSON.stringify({ username: "Tester", avatar: "" })); } catch {} });
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(3500); // the opening animation
    const crashed = async () => page.evaluate(() => [...document.querySelectorAll(".aura-fallback")].filter((e) => e.offsetParent !== null || e.classList.contains("whole")).map((e) => (e.querySelector("h2")?.textContent || "") + ": " + (e.querySelector(".aura-fallback-what")?.textContent || "")));
    const onScreen = await page.evaluate(() => { const root = document.getElementById("root"); return { children: root ? root.childElementCount : 0, text: (document.body.innerText || "").trim().length }; });

    console.log("1. Opening the window");
    check("something is on screen (not a blank window)", onScreen.children > 0 && onScreen.text > 20, JSON.stringify(onScreen) + (thrown.length ? "\n" + thrown.join("\n") : ""));
    check("nothing crashed while it opened", (await crashed()).length === 0, (await crashed()).join("\n"));

    const menu = page.locator(".gm-rail-item[title], .sb-item[title]");
    const titles = [...new Set(await menu.evaluateAll((els) => els.filter((e) => e.offsetParent !== null).map((e) => e.getAttribute("title"))))].filter((t) => t && !/log ?out/i.test(t));
    console.log("2. Every page in the menu");
    if (!titles.length) note(failed ? "the pages weren't opened, because AURA didn't come up" : "AURA's menu isn't showing (the log-in or set-up page is), so the pages behind it weren't opened here");
    const bad = [];
    for (const title of titles) {
      const before = thrown.length;
      try {
        await page.locator(`.gm-rail-item[title="${title}"], .sb-item[title="${title}"]`).first().click({ timeout: 4000 });
        await page.waitForTimeout(450);
      } catch (e) { bad.push(`${title}: couldn't be opened (${String(e.message).split("\n")[0]})`); continue; }
      const fell = await crashed();
      if (fell.length) bad.push(`${title}: ${fell.join("; ")}`);
      else if (await page.evaluate(() => (document.body.innerText || "").trim().length) < 20) bad.push(`${title}: the window went blank` + (thrown.length > before ? " (" + thrown.slice(before).join("; ") + ")" : ""));
    }
    if (titles.length) check(`all ${titles.length} pages open without crashing (${titles.join(", ")})`, !bad.length, bad.join("\n"));
    // Errors that didn't take a page down are listed, but don't fail the check: without the desktop
    // side of AURA some features have nothing to talk to.
    const other = [...new Set(thrown)];
    if (other.length) note(`${other.length} error(s) were reported along the way that didn't stop a page:\n          ` + other.slice(0, 8).join("\n          "));
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The window check itself broke:", e); process.exit(2); });
