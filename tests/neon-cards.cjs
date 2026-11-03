// The neon border on game cards: a light travelling round the card while you point at it or tab
// to it, in the theme's accent colours, still while a game runs, with reduce motion, and while AURA
// is hidden. Opens the built window (dist) in a real browser. Added by aura-neon-cards-setup.cjs.
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

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.route((url) => !String(url).startsWith(base), (route) => route.abort());
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      localStorage.setItem("aura_profile", JSON.stringify({ username: "tctray", avatar: "", userId: "user-1" }));
      localStorage.setItem("aura_games", JSON.stringify([1, 2, 3, 4].map((n) => ({ id: "g" + n, title: "Game " + n, exePath: "C:\\Games\\g" + n + ".exe", category: "Action", cover: "", favorite: n < 3, playCount: n, lastPlayed: Date.now() - n * 1000 }))));
    } catch {}
    const ok = (data) => Promise.resolve({ success: true, data });
    const answers = { getSession: () => ok({ id: "user-1", email: "me@example.com" }), getMyProfile: () => ok({ username: "tctray", avatar_url: null }) };
    const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (/^on[A-Z]/.test(String(key)) ? () => {} : name === "auraCloud" && answers[key] ? answers[key]() : ok(null))) });
    window.auraCloud = fake("auraCloud"); window.auraSocial = fake("auraSocial");
    window.electronAPI = new Proxy({}, { get: (_t, key) => (key === "isElectron" || key === "then" ? undefined : (...args) => (/^on[A-Z]/.test(String(key)) ? () => {} : Promise.resolve(null))) });
  });
  const ring = (sel) => page.evaluate((sel) => {
    const el = document.querySelector(sel); if (!el) return null;
    const a = getComputedStyle(el, "::after"), c = getComputedStyle(el);
    const m = /matrix\(([^)]+)\)/.exec(c.transform); const ty = m ? Number(m[1].split(",")[5]) : 0;
    return { opacity: Number(a.opacity), name: a.animationName, dur: a.animationDuration, state: a.animationPlayState, angle: a.getPropertyValue("--aura-neon").trim(), bg: a.backgroundImage, events: a.pointerEvents, ty: Math.round(ty) };
  }, sel);
  try {
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(3000);
    await page.locator('.gm-rail-item[title="Library"], .sb-item[title="Library"]').first().click();
    await page.waitForTimeout(800);
    const sel = ".card";
    check("the Library shows game cards", (await page.locator(sel).count()) >= 4);
    let r = await ring(sel);
    check("not pointing at a card: no border light, nothing moving", r && r.opacity === 0 && r.name === "none", r);
    await page.locator(sel).first().hover(); await page.waitForTimeout(400);
    r = await ring(sel);
    check("pointing at a card: the neon border shows and travels round", r.opacity === 1 && r.name === "aura-neon" && r.dur === "1.8s", r);
    const a1 = r.angle; await page.waitForTimeout(300); const a2 = (await ring(sel)).angle;
    check("...really moving (the light's position changes)", a1 !== a2 && /deg$/.test(a2), [a1, a2]);
    check("...a 2px line made of the theme's two accent colours, which never blocks clicks", /conic-gradient/.test(r.bg) && r.events === "none" && (await page.evaluate(() => getComputedStyle(document.querySelector(".card"), "::after").paddingTop)) === "2px");
    check("...and the card lifts about 5px", r.ty === -5, r.ty);
    check("...(its fade-in no longer holds it in place)", /\.card\{[^}]*animation:fadeUp \.4s ease backwards\}/.test(fs.readFileSync(path.join(ROOT, "src", "App.jsx"), "utf8")));
    await page.evaluate(() => { document.documentElement.style.setProperty("--ac", "#00ff00"); document.documentElement.style.setProperty("--ac2", "#0000ff"); });
    await page.waitForTimeout(100);
    r = await ring(sel);
    check("a different theme colour: the light follows it", /rgb\(0, 255, 0\)/.test(r.bg) && /rgb\(0, 0, 255\)/.test(r.bg), r.bg.slice(0, 200));
    await page.evaluate(() => { document.documentElement.style.removeProperty("--ac"); document.documentElement.style.removeProperty("--ac2"); });
    if (process.env.AURA_SHOT_DIR) { await page.locator(sel).first().hover(); for (const n of [1, 2, 3]) { await page.waitForTimeout(450); await page.locator(sel).first().screenshot({ path: path.join(process.env.AURA_SHOT_DIR, `neon-${n}.png`) }); } }
    await page.mouse.move(5, 890); await page.waitForTimeout(400);
    r = await ring(sel);
    check("moving away: the light goes", r.opacity === 0 && r.name === "none", r);
    await page.locator(sel).nth(1).locator("button").first().focus().catch(() => {});
    await page.evaluate(() => { const b = document.querySelectorAll(".card")[1].querySelector("button, [tabindex]"); if (b) b.focus(); });
    await page.waitForTimeout(300);
    const f = await page.evaluate(() => { const el = document.querySelectorAll(".card")[1]; const a = getComputedStyle(el, "::after"); return { opacity: Number(a.opacity), name: a.animationName, has: !!el.querySelector(":focus") }; });
    check("tabbing to a card shows it too", f.has && f.opacity === 1 && f.name === "aura-neon", f);
    await page.locator(sel).first().hover(); await page.waitForTimeout(300);
    await page.evaluate(() => document.documentElement.classList.add("aura-playing")); await page.waitForTimeout(150);
    r = await ring(sel);
    check("while a game is running: the border shows but doesn't move", r.opacity === 1 && r.name === "none" && /linear-gradient/.test(r.bg), r);
    await page.evaluate(() => { document.documentElement.classList.remove("aura-playing"); document.documentElement.classList.add("reduce-motion"); }); await page.waitForTimeout(150);
    r = await ring(sel);
    check("with Reduce motion on: the same, nothing moves", r.opacity === 1 && r.name === "none", r);
    await page.evaluate(() => { document.documentElement.classList.remove("reduce-motion"); document.documentElement.classList.add("aura-resting"); }); await page.waitForTimeout(150);
    r = await ring(sel);
    check("while AURA is hidden: paused", r.name === "aura-neon" && r.state === "paused", r);
    await page.evaluate(() => document.documentElement.classList.remove("aura-resting"));
    const src = fs.readFileSync(path.join(ROOT, "src", "App.jsx"), "utf8");
    check("AURA marks when a game is running", /classList\.toggle\("aura-playing",!!nowPlaying\)/.test(src));
    check("the other layout's cards (Home shelves) get the same border", /\.gm-card:hover::after/.test(src) && /\.gm-card:hover\{transform:translateY\(-5px\)/.test(src));
  } catch (e) {
    check("the test ran to the end", false, String(e?.message || e).slice(0, 400));
  }
  await browser.close();
  server.close();
  done(failed ? 1 : 0);
})();
