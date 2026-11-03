// Credits and licenses: the notices file lists every library AURA ships and includes FFmpeg's full
// licence and where its source is, it ships with AURA, and Settings > About shows it.
// Added by aura-credits-setup.cjs.
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
  console.log("1. The notices file");
  const notices = fs.readFileSync(path.join(ROOT, "THIRD-PARTY-NOTICES.md"), "utf8").replace(/\r\n/g, "\n");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const missing = Object.keys(pkg.dependencies || {}).filter((d) => !notices.includes(d.replace(/^@[^/]+\//, (m) => m)) && !notices.toLowerCase().includes(d.toLowerCase().replace(/-/g, " ")));
  check("every library AURA ships is listed", missing.length === 0, missing);
  check("it credits IGDB, Twitch, YouTube, KLIPY, Steam, Discord, Catbox", ["IGDB", "Twitch", "YouTube", "KLIPY", "Steam", "Discord", "Catbox"].every((w) => notices.includes(w)));
  check("...and says AURA isn't affiliated with them", /isn't affiliated with or endorsed by/.test(notices));
  check("FFmpeg: the GPL, and where to get its source", /GNU General Public License, version 3/.test(notices) && /https:\/\/ffmpeg\.org\/download\.html/.test(notices) && /https:\/\/github\.com\/ShareX\/FFmpeg/.test(notices));
  check("...with the full GPL text", /GNU GENERAL PUBLIC LICENSE\n\s+Version 3, 29 June 2007/.test(notices) && /END OF TERMS AND CONDITIONS/.test(notices) && notices.length > 35000);
  const shipped = (() => { try { return fs.readFileSync(path.join(ROOT, "node_modules", "ffmpeg-static", "ffmpeg.LICENSE"), "utf8").replace(/\r\n/g, "\n").trim(); } catch { return ""; } })();
  if (shipped) check("...exactly the licence that comes with the FFmpeg AURA includes", notices.includes(shipped));
  check("the file ships with AURA (in its install folder)", (pkg.build.extraResources || []).some((r) => r.from === "THIRD-PARTY-NOTICES.md"));

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

  async function open() {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());
    await page.addInitScript(() => {
      try { localStorage.clear(); localStorage.setItem("aura_profile", JSON.stringify({ username: "tctray", avatar: "", userId: "user-1" })); } catch {}
      window.__opened = [];
      const ok = (data) => Promise.resolve({ success: true, data });
      const answers = { getSession: () => ok({ id: "user-1", email: "me@example.com" }), getMyProfile: () => ok({ username: "tctray", avatar_url: null }) };
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (/^on[A-Z]/.test(String(key)) ? () => {} : name === "auraCloud" && answers[key] ? answers[key]() : ok(null))) });
      window.auraCloud = fake("auraCloud"); window.auraSocial = fake("auraSocial");
      window.electronAPI = new Proxy({}, { get: (_t, key) => {
        if (key === "isElectron" || key === "then") return undefined;
        if (key === "openExternal") return (u) => { window.__opened.push(u); return Promise.resolve({ success: true }); };
        return (...args) => (/^on[A-Z]/.test(String(key)) ? () => {} : Promise.resolve(null));
      } });
    });
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(3000);
    return page;
  }
  let page;
  try {
    console.log("2. Settings > About");
    page = await open();
    await page.locator('.gm-rail-item[title="Settings"], .sb-item[title="Settings"]').first().click(); await page.waitForTimeout(500);
    const row = page.locator(".sr", { hasText: "Credits" }).filter({ has: page.getByRole("button", { name: "Credits and licenses" }) });
    check("About has Credits, naming IGDB, Twitch, YouTube and KLIPY", await row.isVisible() && /IGDB/.test(await row.innerText()) && /Twitch/.test(await row.innerText()));
    await row.getByRole("button", { name: "Credits and licenses" }).click(); await page.waitForTimeout(300);
    const dlg = page.getByRole("dialog", { name: "Credits and licenses" });
    check("it opens the credits", await dlg.isVisible() && /Game information and cover art: IGDB\.com/.test(await dlg.innerText()) && /Open-source software included in AURA/.test(await dlg.innerText()));
    check("...with FFmpeg's licence and where its source is", /FFmpeg and the GPL/.test(await dlg.innerText()) && (await dlg.getByRole("button", { name: "https://ffmpeg.org/download.html" }).count()) === 1);
    await dlg.getByRole("button", { name: "https://ffmpeg.org/download.html" }).click();
    check("...links open in your browser", JSON.stringify(await page.evaluate(() => window.__opened)) === JSON.stringify(["https://ffmpeg.org/download.html"]), await page.evaluate(() => window.__opened));
    check("the full GPL text is one click away", !(await dlg.locator(".cr-pre").count()));
    await dlg.getByRole("button", { name: "Show the full GPL text" }).click();
    check("...and shows the whole licence", /TERMS AND CONDITIONS/.test(await dlg.locator(".cr-pre").innerText()) && (await dlg.locator(".cr-pre").innerText()).length > 30000);
    if (process.env.AURA_SHOT_DIR) await page.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "credits.png") });
    await page.keyboard.press("Escape"); await page.waitForTimeout(200);
    check("Esc closes it", !(await dlg.count()));
  } catch (e) {
    check("the test ran to the end", false, String(e?.message || e).slice(0, 400));
  }
  await browser.close();
  server.close();
  done(failed ? 1 : 0);
})();
