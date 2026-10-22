// Cover art: none are skipped any more. Checks the cover fetcher (electron/covers.js) against a
// pretend AURA server that behaves like a busy one (a group answered only in part, a search refused
// for a moment, games with no cover, being offline), then, in an AURA window, Settings > Fetch
// (progress on the button, how many were found) and covers coming in straight after an import.
// Added by aura-covers-setup.cjs.
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


(async () => {
  console.log("1. The cover fetcher (electron/covers.js)");
  const { fetchCovers, cleanTitle } = require(path.join(ROOT, "electron", "covers.js"));
  const cover = (t) => "https://images.igdb.com/igdb/image/upload/t_cover_big/" + t.toLowerCase().replace(/[^a-z0-9]+/g, "") + ".webp";
  const NONE = new Set(["Some Tool", "Mystery Mod"]);
  // A busy server: a group only gets its first 3 answered; every third single search is refused once
  function busyServer() {
    const log = [];
    let singles = 0;
    const refused = new Set();
    const server = async (route, body) => {
      log.push(route);
      if (route === "/api/covers/bulk") {
        const out = {};
        body.games.slice(0, 3).forEach((g) => { if (!NONE.has(g.title)) out[g.id] = cover(g.title); });
        return { success: true, covers: out };
      }
      singles++;
      if (singles % 3 === 0 && !refused.has(body.title)) { refused.add(body.title); return { success: false, error: "IGDB is busy right now. Try again in a moment." }; }
      if (NONE.has(body.title)) return { success: false, error: "No cover found" };
      return { success: true, url: cover(body.title) };
    };
    return { server, log };
  }
  const names = ["Hollow Knight", "DOOM™ Eternal", "Celeste", "Hades", "Some Tool", "Portal 2", "Stardew Valley", "Terraria", "Mystery Mod", "Rocket League®", "Factorio", "Balatro", "Dead Cells", "Outer Wilds", "Tunic", "Inscryption", "Cuphead", "Hollow Knight"];
  const games = names.map((title, i) => ({ id: "g" + (i === names.length - 1 ? 0 : i), title }));
  const fake = busyServer();
  const steps = [];
  const res = await fetchCovers(games, { server: fake.server, wait: async () => {}, progress: (p) => steps.push(p) });
  const findable = names.slice(0, -1).filter((t) => !NONE.has(t));
  check("every game IGDB has a cover for gets one, even when the server is busy", res.success && res.found === findable.length && findable.every((t) => res.covers["g" + names.indexOf(t)]), res);
  check("games IGDB has nothing for are left without, and said so", !res.covers.g4 && !res.covers.g8 && res.total === 17);
  check("the same game twice is only looked up once", res.total === names.length - 1);
  check("™ and ® are left out of the search", cleanTitle("DOOM™ Eternal") === "DOOM Eternal" && res.covers.g1 === cover("DOOM Eternal") && res.covers.g9 === cover("Rocket League"));
  check("small groups first, then one at a time only for the gaps", fake.log.filter((r) => r === "/api/covers/bulk").length === 3 && fake.log.filter((r) => r === "/api/covers/one").length < 20, fake.log.length);
  check("it reports how far it has got, ending with all of them", steps.length > 3 && steps[steps.length - 1].done === 17 && steps[steps.length - 1].total === 17, steps.slice(-2));
  const waits = [];
  await fetchCovers(games.slice(0, 10), { server: busyServer().server, wait: async (ms) => { waits.push(ms); } });
  check("it goes slowly enough for IGDB (pauses between requests)", waits.length >= 3 && waits.every((ms) => ms >= 300), waits);
  let calls = 0;
  const off = await fetchCovers(games, { server: async () => { calls++; return { success: false, error: "Couldn't reach the AURA server. Check your internet connection." }; }, wait: async () => {} });
  check("offline: it stops straight away and says why", off.success === false && /internet/.test(off.error) && calls === 1, { off, calls });
  let n = 0;
  const half = await fetchCovers(games.slice(0, 9), { server: async (route, body) => (++n <= 1 ? { success: true, covers: { [body.games[0].id]: cover(body.games[0].title) } } : { success: false, error: "Couldn't reach the AURA server. Check your internet connection." }), wait: async () => {} });
  check("going offline halfway keeps what was found, and says why it stopped", half.success && half.found === 1 && /internet/.test(half.error), half);
  const odd = await fetchCovers([{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "", title: "C" }, { id: "d", title: "  " }], { server: async (route) => (route === "/api/covers/bulk" ? { success: true, covers: { a: "javascript:alert(1)", b: "http://plain.example/x.jpg", zz: cover("x") } } : { success: false, error: "No cover found" }), wait: async () => {} });
  check("only https picture addresses, only for the games asked about, and games without an id or title are skipped", odd.success && odd.found === 0 && odd.total === 2, odd);

  if (!fs.existsSync(path.join(DIST, "index.html"))) { check("the window has been built (dist/index.html)", false, "Run  npm run build  first."); return done(1); }
  let chromium;
  try { ({ chromium } = require("playwright")); } catch { note("the test browser isn't installed here"); return done(failed ? 1 : process.env.CI ? 1 : 3); }
  let browser = null;
  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: "msedge" }, { channel: "chrome" }]) {
    try { browser = await chromium.launch(options); break; } catch {}
  }
  if (!browser) { note("no browser to test with"); return done(failed ? 1 : process.env.CI ? 1 : 3); }
  const now = await serve(DIST);
  const until = async (fn, ms = 15000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); } catch { v = null; } if (v) return v; await sleep(150); } return v; };
  try {
    console.log("2. In AURA: Settings > Fetch, and after an import");
    const page = await (await browser.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
    const thrown = [];
    page.on("pageerror", (e) => thrown.push(String(e.message || e).split("\n")[0]));
    await page.addInitScript(() => {
      try {
        localStorage.clear();
        localStorage.setItem("aura_profile", JSON.stringify({ username: "Alex", avatar: "", userId: "user-A" }));
        localStorage.setItem("aura_games", JSON.stringify([
          { id: "a1", title: "Hollow Knight", exePath: "", cover: "", category: "Indie", favorite: false, playCount: 0, lastPlayed: null, addedAt: 1 },
          { id: "a2", title: "Celeste", exePath: "", cover: "", category: "Indie", favorite: false, playCount: 0, lastPlayed: null, addedAt: 2 },
          { id: "a3", title: "Some Tool", exePath: "", cover: "", category: "Other", favorite: false, playCount: 0, lastPlayed: null, addedAt: 3 },
        ]));
      } catch {}
      const ok = (data) => Promise.resolve({ success: true, data });
      const account = { getSession: () => ok({ id: "user-A", email: "alex@example.com" }), getMyProfile: () => ok({ username: "Alex", avatar_url: null }) };
      window.auraCloud = new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (account[key] ? account[key](...args) : ok(null))) });
      const pic = (t) => "data:image/svg+xml;base64," + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="264" height="352"><rect width="264" height="352" fill="#357"/><text x="20" y="60" fill="#fff">${t}</text></svg>`);
      window.__asked = [];
      let progress = null;
      const desktop = {
        isElectron: true,
        onCoversProgress: (cb) => { progress = cb; return () => { progress = null; }; },
        fetchCoversBulk: async (games) => {
          window.__asked.push(games.map((g) => g.title));
          const covers = {};
          for (let i = 0; i < games.length; i++) {
            await new Promise((r) => setTimeout(r, 400));
            if (games[i].title !== "Some Tool") covers[games[i].id] = pic(games[i].title);
            progress && progress({ done: i + 1, found: Object.keys(covers).length, total: games.length });
          }
          return { success: true, covers, found: Object.keys(covers).length, total: games.length };
        },
        importSteam: async () => ({ success: true, games: [{ title: "Hades", exePath: "C:/Games/Hades/Hades.exe" }, { title: "Terraria", exePath: "C:/Games/Terraria/Terraria.exe" }] }),
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
    });
    await page.goto(now.base + "/index.html", { waitUntil: "load" });
    await sleep(4500);
    await page.locator('.gm-rail-item[title="Settings"], .sb-item[title="Settings"]').first().click({ timeout: 8000 });
    await sleep(800);
    const row = page.locator(".sr", { hasText: "Fetch Missing Cover Art" });
    const btn = row.locator("button");
    await btn.click();
    check("while it fetches, the button shows how far it has got", await until(async () => /^\d+ of 3$/.test((await btn.innerText()).trim()) && (await btn.isDisabled()), 4000), await btn.innerText());
    const said = await until(async () => { const t = await page.locator("body").innerText(); return /Cover art found for 2 of 3/.test(t) ? t : null; }, 8000);
    check("then it says how many were found, and what to do about the rest", !!said && /Edit and press Auto/.test(said));
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("aura_games") || "[]"));
    check("the covers found are saved with the games", saved.filter((g) => g.cover).length === 2 && !saved.find((g) => g.title === "Some Tool").cover, saved.map((g) => [g.title, !!g.cover]));
    check("the button is back to Fetch", (await btn.innerText()).trim() === "Fetch");
    await page.locator(".sr", { hasText: "Import Steam Games" }).locator("button").click();
    check("after a Steam import, covers are fetched straight away without pressing anything", await until(async () => (await page.evaluate(() => window.__asked)).some((list) => list.includes("Hades") && list.includes("Terraria")), 6000), await page.evaluate(() => window.__asked));
    check("...and they're saved", await until(async () => (await page.evaluate(() => JSON.parse(localStorage.getItem("aura_games") || "[]"))).filter((g) => /Hades|Terraria/.test(g.title) && g.cover).length === 2, 8000));
    check("nothing crashed along the way", thrown.length === 0, thrown);
  } finally {
    await browser.close();
    now.server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The cover check itself broke:", e); process.exit(2); });
