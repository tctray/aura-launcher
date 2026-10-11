// The stream mini-player: the small Twitch player that stays on screen when you leave Live Streams.
//
// The Twitch player is a separate layer that the main process puts on top of AURA's page, at the
// spot the page asks for. This opens the built window (dist) in a real browser with a pretend
// desktop side, plays a pretend stream, and checks what the page asks for:
//   - the player is at least 400 x 300 (Twitch's minimum), at any UI size
//   - the bar with the name, Open and X sits above the player, never under or over it
//   - dragging the bar moves the player with it
//   - the X shuts the stream down
//   - AURA never asks to change the volume inside the player
// Added by aura-twitch-discord-setup.cjs.
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

  // Start AURA logged in, with a desktop side that notes down everything the page asks it for
  async function start({ zoom = 1 } = {}) {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    const thrown = [];
    page.on("pageerror", (e) => thrown.push(String(e.message || e).split("\n")[0]));
    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());
    await page.addInitScript(({ zoom }) => {
      try {
        localStorage.clear();
        localStorage.setItem("aura_profile", JSON.stringify({ username: "tester", avatar: "", userId: "user-1" }));
        localStorage.setItem("aura_settings", JSON.stringify({ zoom }));
      } catch {}
      window.__calls = [];
      const ok = (data) => Promise.resolve({ success: true, data });
      const account = {
        getSession: () => ok({ id: "user-1", email: "me@example.com" }),
        getMyProfile: () => ok({ username: "tester", avatar_url: null }),
        saveProfile: (name, picture) => ok({ username: name, avatar_url: picture || null }),
      };
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (name === "auraCloud" && account[key]) ? account[key](...args) : ok(null)) });
      window.auraCloud = fake("auraCloud");
      window.auraSocial = fake("auraSocial");
      const stream = { id: "s1", user: "TestStreamer", userLogin: "teststreamer", title: "A test stream", game: "Test Game", viewers: 1234, thumbnail: "", url: "https://twitch.tv/teststreamer" };
      const desktop = {
        fetchTwitchStreams: () => Promise.resolve({ success: true, streams: [stream] }),
        // A window that isn't in the corner of the screen. The player's place must not depend on this.
        getWindowPos: () => Promise.resolve({ x: 300, y: 200 }),
      };
      window.electronAPI = new Proxy({}, {
        get: (_t, key) => {
          if (key === "isElectron") return true;
          if (typeof key !== "string" || key === "then") return undefined;
          if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};
          return (...args) => { window.__calls.push([key, args]); return desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }); };
        },
      });
    }, { zoom });
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(4500);
    const menu = async (name) => {
      await page.locator(`.gm-rail-item[title="${name}"], .sb-item[title="${name}"]`).first().click({ timeout: 5000 });
      await page.waitForTimeout(500);
    };
    const calls = (name) => page.evaluate((n) => window.__calls.filter(([k]) => k === n).map(([, a]) => a[0]), name);
    const box = (selector) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; }, selector);
    return { page, thrown, menu, calls, box };
  }
  const same = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  const apart = (a, b) => !!a && !!b && (a.y + a.height <= b.y || b.y + b.height <= a.y || a.x + a.width <= b.x || b.x + b.width <= a.x);

  try {
    console.log("1. Playing a stream");
    let app = await start();
    await app.menu("Live Streams");
    await app.page.getByText("A test stream").first().click({ timeout: 5000 });
    await app.page.waitForTimeout(900);
    const opened = await app.calls("streamOpen");
    check("picking a stream opens the Twitch player", opened.length === 1 && opened[0].channel === "teststreamer", opened);
    check("AURA has no volume slider of its own on the stream (the player has one)", (await app.page.locator('input[type="range"]:visible').count()) === 0);

    console.log("2. Leaving the page: the mini-player");
    await app.menu("Library");
    await app.page.waitForTimeout(900);
    let player = await app.box("#pip-stream-container"), bar = await app.box(".pip-bar"), close = await app.box(".pip-close"), open = await app.box(".pip-open");
    let asked = (await app.calls("streamPip")).pop();
    check("the mini-player shows", !!player && !!bar, { player, bar });
    check("the player is at least 400 x 300", !!player && player.width >= 400 && player.height >= 300, player);
    check("the Twitch player is put exactly where the page shows it (wherever the window is on screen)", same(asked, player), { asked, player });
    check("the bar sits above the player, not over it", !!bar && !!player && bar.y + bar.height <= player.y && apart(bar, player), { bar, player });
    check("Open and X are in the bar, clear of the player", !!close && !!open && apart(close, player) && apart(open, player) && close.width >= 24 && close.height >= 20, { open, close, player });
    check("the whole mini-player is inside the window", !!player && !!bar && bar.x >= 0 && bar.y >= 0 && player.x + player.width <= 1440 && player.y + player.height <= 900, { bar, player });
    check("the streamer's name is on the bar", /TestStreamer/.test(await app.page.locator(".pip-bar").innerText()));

    console.log("3. Moving it");
    const grab = { x: bar.x + 60, y: bar.y + Math.round(bar.height / 2) };
    await app.page.mouse.move(grab.x, grab.y);
    await app.page.mouse.down();
    await app.page.mouse.move(grab.x - 300, grab.y - 200, { steps: 6 });
    await app.page.mouse.up();
    await app.page.waitForTimeout(300);
    const moved = await app.box("#pip-stream-container");
    asked = (await app.calls("streamPip")).pop();
    check("dragging the bar moves the mini-player", !!moved && moved.x === player.x - 300 && moved.y === player.y - 200, { from: player, to: moved });
    check("and the Twitch player follows it", same(asked, moved), { asked, moved });
    await app.page.mouse.move(grab.x - 300, grab.y - 200);
    await app.page.mouse.down();
    await app.page.mouse.move(-500, -500, { steps: 4 });
    await app.page.mouse.up();
    await app.page.waitForTimeout(300);
    const cornered = await app.box(".pip-box");
    check("it can't be dragged off the window", !!cornered && cornered.x === 0 && cornered.y === 0, cornered);
    await app.menu("Settings");
    await app.page.waitForTimeout(300);
    check("it stays where you put it when you change page", same(await app.box(".pip-box"), cornered), await app.box(".pip-box"));

    console.log("4. Closing it");
    const before = (await app.calls("streamClose")).length;
    await app.page.locator(".pip-close").click({ timeout: 4000 });
    await app.page.waitForTimeout(600);
    check("X takes the mini-player away", (await app.box(".pip-box")) === null);
    check("and shuts the Twitch player down", (await app.calls("streamClose")).length > before);
    await app.menu("Live Streams");
    check("back on Live Streams the list is showing, not a stream", (await app.page.getByText("A test stream").first().isVisible()) && (await app.calls("streamOpen")).length === 1);

    console.log("5. Back and forth");
    await app.page.getByText("A test stream").first().click({ timeout: 5000 });
    await app.page.waitForTimeout(900);
    await app.menu("Library");
    await app.page.waitForTimeout(500);
    check("a new stream gets a mini-player too", !!(await app.box(".pip-box")) && (await app.calls("streamOpen")).length === 2);
    await app.page.locator(".pip-open").click({ timeout: 4000 });
    await app.page.waitForTimeout(700);
    check("Open goes back to the stream, and the mini-player goes away", (await app.box(".pip-box")) === null && (await app.page.getByText("Hide Chat").first().isVisible()));
    await app.page.getByText("Close", { exact: false }).filter({ hasText: /^✕ Close$/ }).first().click({ timeout: 4000 });
    await app.page.waitForTimeout(500);
    await app.menu("Home");
    await app.page.waitForTimeout(800);
    const onHome = app.page.locator(".twitch-shelf .twitch-card").first();
    if (await onHome.isVisible().catch(() => false)) {
      await onHome.click({ timeout: 4000 });
      await app.page.waitForTimeout(1000);
      check("a stream picked on Home opens on Live Streams", (await app.calls("streamOpen")).length === 3 && (await app.page.getByText("Hide Chat").first().isVisible()) && (await app.box(".pip-box")) === null, await app.calls("streamOpen"));
    } else note("Home isn't showing a Twitch row here, so picking a stream from it wasn't checked");
    const volume = await app.page.evaluate(() => window.__calls.filter(([k]) => /volume/i.test(k)).map(([k]) => k));
    check("AURA never asked to change the volume inside the player", volume.length === 0, volume);
    check("nothing crashed along the way", (await app.page.locator(".aura-fallback").count()) === 0, app.thrown);
    await app.page.context().close();

    console.log("6. At the smallest UI size (80%)");
    app = await start({ zoom: 0.8 });
    await app.menu("Live Streams");
    await app.page.getByText("A test stream").first().click({ timeout: 5000 });
    await app.page.waitForTimeout(900);
    await app.menu("Library");
    await app.page.waitForTimeout(900);
    player = await app.box("#pip-stream-container"); bar = await app.box(".pip-bar");
    asked = (await app.calls("streamPip")).pop();
    // The main process multiplies the page's numbers by the UI size to get real pixels
    const real = asked ? { width: Math.round(asked.width * 0.8), height: Math.round(asked.height * 0.8) } : null;
    check("the player is still at least 400 x 300 real pixels", !!real && real.width >= 400 && real.height >= 300, { asked, real });
    check("and the bar is still above it", same(asked, player) && !!bar && bar.y + bar.height <= player.y, { bar, player, asked });
    await app.page.context().close();
  } finally {
    await browser.close();
    server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The mini-player check itself broke:", e); process.exit(2); });
