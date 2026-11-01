// Seasonal decorations and avatar decorations, in the built window (dist) in a real browser:
// off by default, switching on and off without a restart, each part on its own, by the date,
// Preview, reduced motion, and avatar decorations saved and shown to friends.
// Added by aura-seasonal-setup.cjs.
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

  const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", JO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", SAM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const DECOR = {
    [JO]: { v: 1, on: true, mode: "manual", season: "christmas", frames: true, accessories: true, animate: true, picks: { christmas: { frame: "lights", acc: "santa", x: 0, y: 0, size: 1 } } },
    [SAM]: { v: 1, on: false, mode: "manual", season: "halloween", frames: true, accessories: true, animate: true, picks: { halloween: { frame: "web", acc: "hat" } } },
  };
  async function open({ date = "2026-12-10T12:00:00", keep = false, reduce = false, saveError = null, ctx: given, seasonal = null } = {}) {
    const ctx = given || await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: reduce ? "reduce" : "no-preference", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) aura Chrome/134.0 Electron/44.0 Safari/537.36" });
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date(date));
    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());
    await page.addInitScript(({ ME, JO, SAM, DECOR, keep, saveError, seasonal }) => {
      try {
        if (!keep) {
          localStorage.clear();
          localStorage.setItem("aura_profile", JSON.stringify({ username: "tctray", avatar: "", userId: ME }));
        }
        if (seasonal) localStorage.setItem("aura_seasonal", JSON.stringify(seasonal));
      } catch {}
      window.__calls = [];
      const ok = (data) => Promise.resolve({ success: true, data });
      const now = new Date().toISOString();
      const friend = (userId, username) => ({ friendshipId: "f" + username, userId, username, avatarUrl: "", state: "friend", since: null, online: true, lastSeenAt: now });
      const answers = {
        "auraCloud.getSession": () => ok({ id: ME, email: "me@example.com" }), "auraCloud.getMyProfile": () => ok({ username: "tctray", avatar_url: null }),
        "auraCloud.getAvatarDecorations": (ids) => { window.__calls.push(["getAvatarDecorations", ids]); const d = {}; for (const id of ids) if (DECOR[id] || window.__mine && id === ME) d[id] = id === ME ? window.__mine : DECOR[id]; return ok({ decor: d }); },
        "auraCloud.saveAvatarDecoration": (decor) => { window.__calls.push(["saveAvatarDecoration", decor]); if (saveError) return Promise.resolve({ success: false, error: saveError }); window.__mine = decor; return ok(decor); },
        "auraSocial.start": () => ok({ id: ME, username: "tctray", live: true }),
        "auraSocial.listFriends": () => ok([friend(JO, "Jordan"), friend(SAM, "Sam")]),
        "auraSocial.listConversations": () => ok([]), "auraSocial.listBlocked": () => ok([]),
      };
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => { if (/^on[A-Z]/.test(String(key))) return () => {}; const a = answers[name + "." + String(key)]; return a ? a(...args) : ok(null); }) });
      window.auraCloud = fake("auraCloud");
      window.auraSocial = fake("auraSocial");
      window.electronAPI = new Proxy({}, { get: (_t, key) => {
        if (key === "isElectron" || key === "then") return undefined;
        return (...args) => { if (/^on[A-Z]/.test(String(key))) return () => {}; return Promise.resolve(null); };
      } });
    }, { ME, JO, SAM, DECOR, keep, saveError, seasonal });
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(3000);
    return page;
  }
  const toSettings = async (page) => { await page.locator('.gm-rail-item[title="Settings"], .sb-item[title="Settings"]').first().click(); await page.waitForTimeout(500); };
  const sw = (page, name) => page.getByRole("switch", { name, exact: true });
  const count = (page, sel) => page.locator(sel).count();
  const look = (page) => page.evaluate(() => { const cs = getComputedStyle(document.documentElement); const b = getComputedStyle(document.body); return [cs.getPropertyValue("--ac"), cs.getPropertyValue("--ac2"), b.backgroundColor, b.backgroundImage].join("|"); });
  const seasonRow = (page) => page.locator(".sr", { hasText: "Season" }).filter({ hasText: "Automatic" });
  let page;
  try {
    console.log("1. Off until you switch it on");
    page = await open();
    check("nothing seasonal on the page", (await count(page, ".ssn, .ssn-logo")) === 0 && (await count(page, ".sb-profile .dav")) === 0);
    check("...and nothing seasonal running in the background", JSON.stringify(await page.evaluate(() => window.__auraSeasonalWatching())) === JSON.stringify({ listening: false, timer: false }));
    await toSettings(page);
    const master = sw(page, "Seasonal decorations");
    check("Settings has Seasonal Decorations, switched off", await page.getByText("SEASONAL DECORATIONS", { exact: true }).isVisible() && (await master.getAttribute("aria-checked")) === "false");
    check("...right after Display", await page.evaluate(() => { const t = [...document.querySelectorAll(".ss-t")].map((e) => e.textContent); return t.indexOf("SEASONAL DECORATIONS") === t.indexOf("DISPLAY") + 1; }));
    const before = await look(page);

    console.log("2. Switching it on (December: Christmas)");
    await master.click(); await page.waitForTimeout(300);
    check("decorations show straight away, no restart", (await count(page, ".ssn.ssn-christmas")) === 1);
    check("...falling snow, lights along the top, ornaments, a soft glow and the logo decoration", (await count(page, ".ssn-fall.snow")) > 5 && (await count(page, ".ssn-top")) === 1 && (await count(page, ".ssn-corner")) >= 1 && (await count(page, ".ssn-bg")) === 1 && (await count(page, ".ssn-logo-christmas")) >= 1);
    check("...and the page you're on gets a Christmas colour", await page.evaluate(() => getComputedStyle(document.querySelector(".sb-item.on, .gm-rail-item.on")).boxShadow.includes("226, 56, 77")));
    check("decorations never catch the mouse", await page.evaluate(() => getComputedStyle(document.querySelector(".ssn")).pointerEvents === "none" && [...document.querySelectorAll(".ssn *:not(.ssn-preview):not(.ssn-preview *)")].every((e) => getComputedStyle(e).pointerEvents === "none")));
    check("Settings still works under them", await (async () => { await sw(page, "Reduce motion").click(); await page.waitForTimeout(200); const on = (await sw(page, "Reduce motion").getAttribute("aria-checked")) === "true"; await sw(page, "Reduce motion").click(); await page.waitForTimeout(200); return on; })());
    check("your theme, colours and background aren't changed", (await look(page)) === before);
    check("it says what's showing", /On: Christmas decorations are showing/.test(await page.locator(".sr", { hasText: "Seasonal Decorations" }).first().innerText()));
    if (process.env.AURA_SHOT_DIR) await page.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "seasonal-christmas.png") });

    console.log("3. Each part on its own");
    const parts = [["Animated Effects", ".ssn-fx"], ["Navigation Accents", ".ssn-top"], ["Logo Decoration", ".ssn-logo"], ["Interface Decorations", ".ssn-corner"], ["Seasonal Background", ".ssn-bg"]];
    for (const [name, sel] of parts) {
      await sw(page, name).click(); await page.waitForTimeout(200);
      const gone = (await count(page, sel)) === 0;
      await sw(page, name).click(); await page.waitForTimeout(200);
      check(`${name} can be switched off and on`, gone && (await count(page, sel)) > 0);
    }
    await sw(page, "Animated Effects").click(); await page.waitForTimeout(150);
    await page.locator(".sr", { hasText: "Animation Amount" }).locator('input[type="range"]').fill("3"); await page.waitForTimeout(150);

    console.log("4. Switching it off");
    await master.click(); await page.waitForTimeout(300);
    check("everything seasonal is gone straight away", (await count(page, ".ssn, .ssn-logo, .ssn-fall, .ssn-bat")) === 0);
    check("...and nothing seasonal keeps running: no timers, no listeners", JSON.stringify(await page.evaluate(() => window.__auraSeasonalWatching())) === JSON.stringify({ listening: false, timer: false }), await page.evaluate(() => window.__auraSeasonalWatching()));
    check("...and AURA looks exactly as before", (await look(page)) === before && !(await page.evaluate(() => getComputedStyle(document.querySelector(".sb-item.on, .gm-rail-item.on")).boxShadow.includes("226, 56, 77"))));
    await master.click(); await page.waitForTimeout(300);
    check("switching back on brings back your choices (animations still off, amount kept)", (await count(page, ".ssn-christmas")) === 1 && (await count(page, ".ssn-fx")) === 0 && (await sw(page, "Animated Effects").getAttribute("aria-checked")) === "false" && (await page.locator(".sr", { hasText: "Animation Amount" }).locator('input[type="range"]').inputValue()) === "3");
    await sw(page, "Animated Effects").click(); await page.waitForTimeout(150);
    await seasonRow(page).getByRole("button", { name: "Halloween" }).click(); await page.waitForTimeout(300);
    check("choosing a season shows it whatever the date", (await count(page, ".ssn-halloween .ssn-bat")) >= 2 && (await count(page, ".ssn-logo-halloween")) >= 1);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("aura_seasonal")));
    check("your choices are saved on this PC", saved.on === true && saved.mode === "halloween" && saved.intensity === 3 && saved.effects === true, saved);
    const ctx = page.context();
    await page.close();
    page = await open({ keep: true, ctx });
    check("...and still there after AURA restarts", (await count(page, ".ssn-halloween")) === 1);
    await ctx.close();

    console.log("5. By the date");
    for (const [date, id, label] of [["2026-10-15T12:00:00", "halloween", "October: Halloween"], ["2026-11-20T12:00:00", "autumn", "November: Autumn"], ["2027-01-08T12:00:00", "winter", "January: Winter"], ["2028-02-29T12:00:00", "winter", "February 29: Winter"]]) {
      page = await open({ date, seasonal: { on: true, mode: "auto" } });
      check(label, (await count(page, `.ssn-${id}`)) === 1 && (await count(page, ".ssn")) === 1);
      await page.context().close();
    }
    page = await open({ date: "2027-03-10T12:00:00", seasonal: { on: true, mode: "auto" } });
    await toSettings(page);
    check("March: nothing in season, so AURA looks as usual (and says so)", (await count(page, ".ssn")) === 0 && /Nothing is in season right now/.test(await page.locator(".sr", { hasText: "Seasonal Decorations" }).first().innerText()));

    console.log("6. Preview");
    await sw(page, "Seasonal decorations").click(); await page.waitForTimeout(200);
    await page.locator(".ssn-pv-btns").getByRole("button", { name: "Christmas" }).click(); await page.waitForTimeout(300);
    check("with decorations off, Preview shows a season", (await count(page, ".ssn-christmas .ssn-fall")) > 0 && /Previewing Christmas/.test(await page.locator(".ssn-preview").innerText()));
    if (process.env.AURA_SHOT_DIR) await page.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "seasonal-preview.png") });
    await page.locator(".ssn-preview").getByRole("button", { name: "Stop preview" }).click(); await page.waitForTimeout(300);
    check("...Stop preview puts AURA back", (await count(page, ".ssn")) === 0);
    await page.locator(".ssn-pv-btns").getByRole("button", { name: "Autumn" }).click(); await page.waitForTimeout(300);
    check("...it ends by itself after 15 seconds", (await count(page, ".ssn-autumn")) === 1);
    await page.waitForTimeout(15500);
    check("   (gone)", (await count(page, ".ssn")) === 0);
    check("...and never switches decorations on", (await sw(page, "Seasonal decorations").getAttribute("aria-checked")) === "false");
    await page.context().close();

    console.log("7. Less motion");
    page = await open({ reduce: true, seasonal: { on: true, mode: "christmas" } });
    check("Windows set to reduce motion: decorations stay, nothing moves", (await count(page, ".ssn.still")) === 1 && (await count(page, ".ssn-fx")) === 0 && (await count(page, ".ssn-top")) === 1);
    await page.context().close();

    console.log("8. Avatar decorations");
    page = await open();
    await page.locator(".sb-profile, .gm-rail-avatar, .gm-rail-avatar-ph").first().click(); await page.waitForTimeout(500);
    const dsw = sw(page, "Avatar decorations");
    check("Edit Profile has Avatar Decorations, switched off", await page.getByText("Avatar Decorations", { exact: true }).isVisible() && (await dsw.getAttribute("aria-checked")) === "false");
    check("...with a preview of your picture", (await count(page, ".dav-preview .dav")) === 1);
    await dsw.click();
    await page.locator(".dav-row", { hasText: "Show" }).getByRole("button", { name: "Christmas" }).click();
    await page.locator(".dav-row", { hasText: "Frame" }).getByRole("button", { name: "Candy cane" }).click();
    await page.locator(".dav-row", { hasText: "Accessory" }).getByRole("button", { name: "Reindeer antlers" }).click();
    await page.waitForTimeout(200);
    check("choosing a frame and accessory shows them in the preview", (await page.locator(".dav-preview .dav").getAttribute("data-decor")) === "christmas:candy:antlers");
    await page.locator(".dav-row", { hasText: "Size" }).locator('input[type="range"]').fill("1.2");
    await sw(page, "Animated avatar decorations").click();
    if (process.env.AURA_SHOT_DIR) await page.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "avatar-decorations.png") });
    await page.locator(".modal .mf").getByRole("button", { name: "Save" }).click(); await page.waitForTimeout(800);
    const savedDecor = (await page.evaluate(() => window.__calls.filter(([n]) => n === "saveAvatarDecoration").map(([, d]) => d))).at(-1);
    check("Save saves them to your account", savedDecor && savedDecor.on === true && savedDecor.mode === "manual" && savedDecor.season === "christmas" && savedDecor.picks.christmas.frame === "candy" && savedDecor.picks.christmas.acc === "antlers" && Math.abs(savedDecor.picks.christmas.size - 1.2) < 0.01 && savedDecor.animate === false, savedDecor);
    check("your own picture shows them (seasonal interface decorations are still off)", (await count(page, ".ssn")) === 0 && (await count(page, '.sb-profile .dav[data-decor="christmas:candy:antlers"], .dav[data-decor="christmas:candy:antlers"]')) >= 1);
    check("...with animation off, as you chose", (await count(page, ".dav.still")) >= 1);
    await page.locator('.gm-rail-item[title="Messages"], .sb-item[title="Messages"]').first().click(); await page.waitForTimeout(1500);
    check("friends see decorations: Jordan's Christmas lights and Santa hat", (await page.locator('.dav[data-decor="christmas:lights:santa"]').count()) >= 1, await page.evaluate(() => [...document.querySelectorAll(".dav")].map((e) => e.dataset.decor)));
    check("...Sam has switched theirs off, so Sam's picture is plain", await page.evaluate(() => [...document.querySelectorAll(".dav")].every((e) => !e.dataset.decor.startsWith("halloween"))));
    check("...pictures themselves are unchanged inside the decorations", await page.evaluate(() => [...document.querySelectorAll(".dav .mx-av")].every((a) => a.closest(".dav-pic"))));
    const asked = await page.evaluate(() => window.__calls.filter(([n]) => n === "getAvatarDecorations").map(([, ids]) => ids));
    check("...fetched together, not one request per picture", asked.length <= 3 && asked.flat().filter((x) => x === JO).length === 1, asked);
    await page.context().close();

    page = await open({ saveError: "Avatar decorations need a one-time database update. In Supabase, open SQL Editor and run supabase/aura-seasonal.sql." });
    await page.locator(".sb-profile, .gm-rail-avatar, .gm-rail-avatar-ph").first().click(); await page.waitForTimeout(500);
    await sw(page, "Avatar decorations").click();
    await page.locator(".modal .mf").getByRole("button", { name: "Save" }).click(); await page.waitForTimeout(600);
    check("if it can't be saved, Edit Profile stays open and says why", await page.locator(".modal").isVisible() && /aura-seasonal\.sql/.test(await page.locator(".dav-problem").innerText()));
  } catch (e) {
    check("the test ran to the end", false, String(e?.stack || e).slice(0, 600));
  }
  await browser.close();
  server.close();
  done(failed ? 1 : 0);
})();
