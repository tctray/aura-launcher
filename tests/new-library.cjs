"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const OLD = process.env.AURA_OLD_DIST || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff" };
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok || extra === undefined ? "" : "\n          " + (typeof extra === "string" ? extra : JSON.stringify(extra)))); };
const note = (text) => console.log("  note  " + text);
const done = (code) => { console.log(code === 0 ? "\nall passed" : code === 3 ? "\nskipped" : `\n${failed} FAILED`); process.exit(code); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve(dir) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path.join(dir, url === "/" ? "index.html" : url);
    if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, base: "http://127.0.0.1:" + server.address().port })));
}


// A new AURA starts with an empty library and says where to start; a library you already have is
// left as it is; Reset library empties it. Added by aura-no-demo-setup.cjs.
(async () => {
  if (!fs.existsSync(path.join(DIST, "index.html"))) { check("the window has been built (dist/index.html)", false, "Run  npm run build  first."); return done(1); }
  let chromium;
  try { ({ chromium } = require("playwright")); } catch { note("the test browser isn't installed here"); return done(process.env.CI ? 1 : 3); }
  let browser = null;
  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: "msedge" }, { channel: "chrome" }]) {
    try { browser = await chromium.launch(options); break; } catch {}
  }
  if (!browser) { note("no browser to test with"); return done(process.env.CI ? 1 : 3); }
  const now = await serve(DIST);
  const until = async (fn, ms = 10000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); } catch { v = null; } if (v) return v; await sleep(150); } return v; };
  async function open(games) {
    const page = await (await browser.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
    const thrown = [];
    page.on("pageerror", (e) => thrown.push(String(e.message || e).split("\n")[0]));
    await page.addInitScript((games) => {
      try {
        if (!sessionStorage.getItem("seeded")) {
          sessionStorage.setItem("seeded", "1");
          localStorage.clear();
          localStorage.setItem("aura_profile", JSON.stringify({ username: "Alex", avatar: "", userId: "user-A" }));
          if (games) localStorage.setItem("aura_games", JSON.stringify(games));
        }
      } catch {}
      const ok = (data) => Promise.resolve({ success: true, data });
      const account = { getSession: () => ok({ id: "user-A", email: "alex@example.com" }), getMyProfile: () => ok({ username: "Alex", avatar_url: null }) };
      window.auraCloud = new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (account[key] ? account[key](...args) : ok(null))) });
      window.__asked = [];
      const desktop = {
        importSteam: async () => { window.__asked.push("steam"); return { success: true, games: [{ title: "Hades", exePath: "C:/Games/Hades/Hades.exe" }] }; },
        importEpic: async () => { window.__asked.push("epic"); return { success: false }; },
        importXbox: async () => { window.__asked.push("xbox"); return { success: false, error: "No Xbox games found" }; },
        fetchCoversBulk: async () => ({ success: true, covers: {} }),
      };
      window.electronAPI = new Proxy({}, {
        get: (_t, key) => {
          if (key === "isElectron") return true;
          if (typeof key !== "string" || key === "then") return undefined;
          if (desktop[key]) return desktop[key];
          if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};
          return () => Promise.resolve({ success: false });
        },
      });
      window.confirm = () => true;
    }, games || null);
    await page.goto(now.base + "/index.html", { waitUntil: "load" });
    await sleep(4500);
    return { page, thrown };
  }
  const goTo = (page, name) => page.locator(`.gm-rail-item[title="${name}"], .sb-item[title="${name}"]`).first().click({ timeout: 8000 }).then(() => sleep(700));
  const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("aura_games") || "null"));
  try {
    console.log("1. A new AURA");
    let { page, thrown } = await open(null);
    check("starts with no games (no placeholder games)", (await page.locator(".gm-shelf-card, .card, .gm-card").count()) === 0 && !/Elden Ring|Cyberpunk 2077/.test(await page.locator("body").innerText()));
    const card = page.locator(".start-lib");
    check("Home says where to start", await card.isVisible() && /Bring in your games/.test(await card.innerText()));
    check("...with Import Steam, Epic, Xbox and Add a game", (await card.locator("button").allInnerTexts()).map((t) => t.trim()).join("|") === "Import Steam|Import Epic|Import Xbox|Add a game", await card.locator("button").allInnerTexts());
    await card.locator("button", { hasText: "Add a game" }).click();
    check("Add a game opens the Add Game box", await until(() => page.locator(".fi").first().isVisible()));
    await page.locator(".mbk .mf button", { hasText: "Cancel" }).click();
    await goTo(page, "Library");
    check("the Library says the same", await page.locator(".start-lib").isVisible());
    await page.locator(".start-lib button", { hasText: "Import Steam" }).click();
    check("Import Steam brings the games in", await until(async () => (await saved(page))?.some((g) => g.title === "Hades")));
    check("...and the card goes once there are games", await until(async () => !(await page.locator(".start-lib").count())));
    check("nothing crashed", thrown.length === 0, thrown);
    await page.context().close();

    console.log("2. A library you already have");
    const mine = [{ id: "m1", title: "Celeste", exePath: "", cover: "", category: "Indie", favorite: true, playCount: 4, lastPlayed: Date.now(), addedAt: 1 }];
    ({ page, thrown } = await open(mine));
    check("is kept as it is", (await saved(page))?.length === 1 && (await saved(page))[0].title === "Celeste");
    check("...with no card about adding games", !(await page.locator(".start-lib").count()));
    await goTo(page, "Settings");
    await page.locator(".sr", { hasText: "Reset Library" }).locator("button").first().click({ timeout: 5000 }).catch(() => {});
    await sleep(500);
    const after = await saved(page);
    check("Reset library leaves it empty, not full of placeholder games", after === null || (Array.isArray(after) && after.length === 0), after);
    check("nothing crashed", thrown.length === 0, thrown);
  } finally {
    await browser.close();
    now.server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The new library check itself broke:", e); process.exit(2); });
