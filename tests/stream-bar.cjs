// Live Streams: the stream's buttons (Full, Hide Chat, Close) can always be reached.
//
// The Now Playing bar sits along the bottom of AURA while a game is running. The stream's
// buttons used to be under the player, right where that bar is, so Close couldn't be found.
// This opens the built window (dist) in a real browser with a pretend desktop side, plays a
// pretend stream and checks:
//   - the buttons are above the player
//   - with a game playing, the player and the chat stop above the Now Playing bar, and the
//     Twitch player (a separate layer) is moved there too
//   - the chat opens in its own spot, not over the player
//   - Close shuts the stream
// Added by aura-stream-bar-setup.cjs.
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

  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    const thrown = [];
    page.on("pageerror", (e) => thrown.push(String(e.message || e).split("\n")[0]));
    await page.route((url) => !String(url).startsWith(base) && !String(url).startsWith("data:"), (route) => route.abort());
    await page.addInitScript(() => {
      try {
        localStorage.clear();
        localStorage.setItem("aura_profile", JSON.stringify({ username: "tester", avatar: "", userId: "user-1" }));
        localStorage.setItem("aura_games", JSON.stringify([{ id: "g1", title: "Arc Raiders", exePath: "C:\\Games\\ArcRaiders\\PioneerGame.exe", cover: "", category: "Action", favorite: false, playCount: 3, lastPlayed: Date.now() - 3600000, addedAt: Date.now() - 86400000 }]));
      } catch {}
      window.__calls = [];
      const ok = (data) => Promise.resolve({ success: true, data });
      const account = {
        getSession: () => ok({ id: "user-1", email: "me@example.com" }),
        getMyProfile: () => ok({ username: "tester", avatar_url: null }),
        getMyData: () => ok([]),
        getMySessionIds: () => ok([]),
      };
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (name === "auraCloud" && account[key]) ? account[key](...args) : ok(null)) });
      window.auraCloud = fake("auraCloud");
      window.auraSocial = fake("auraSocial");
      const picture = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="440" height="248"><rect width="440" height="248" fill="#345"/></svg>');
      const stream = { id: "s1", user: "Pokimane", userLogin: "pokimane", title: "Chill games", game: "Arc Raiders", viewers: 7000, thumbnail: picture, url: "https://twitch.tv/pokimane" };
      const desktop = { fetchTwitchStreams: () => Promise.resolve({ success: true, streams: [stream] }) };
      window.electronAPI = new Proxy({}, {
        get: (_t, key) => {
          if (key === "isElectron") return true;
          if (typeof key !== "string" || key === "then") return undefined;
          if (key === "onTwitchOpenStream") return (cb) => { window.__openStream = cb; return () => { window.__openStream = null; }; };
          if (key === "onGameSessionStarted") return (cb) => { window.__gameStarted = cb; return () => {}; };
          if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};
          return (...args) => { window.__calls.push([key, args]); return desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }); };
        },
      });
    });
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(4500);
    const called = (name) => page.evaluate((n) => window.__calls.filter(([k]) => k === n).map(([, a]) => a[0]), name);
    const box = (sel) => page.evaluate((s) => { const el = typeof s === "string" ? document.querySelector(s) : null; if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; }, sel);
    // Where things are: the Close button, the player's box and the chat's box
    const layout = () => page.evaluate(() => {
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; };
      const close = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "✕ Close");
      const bar = close && close.parentElement;
      const player = bar && [...bar.parentElement.children].find((c) => c !== bar);
      const chat = player && player.parentElement && player.parentElement.nextElementSibling;
      let reachable = false;
      if (close) { const c = r(close); const hit = document.elementFromPoint((c.left + c.right) / 2, (c.top + c.bottom) / 2); reachable = !!hit && (hit === close || close.contains(hit)); }
      return { close: r(close), reachable, player: r(player), chat: r(chat), np: r(document.querySelector(".now-playing")), height: window.innerHeight };
    });

    console.log("1. A stream with no game running");
    await page.evaluate(() => window.__openStream && window.__openStream("pokimane"));
    await page.waitForTimeout(2600);
    let at = await layout();
    check("the stream opened", (await called("streamOpen")).length === 1 && !!at.close, await called("streamOpen"));
    check("Close, Full and Hide Chat are above the player", at.close && at.close.bottom <= at.player.top + 1 && (await page.getByText("Hide Chat").first().isVisible()) && (await page.getByText("⛶ Full").first().isVisible()), at);
    check("Close can be clicked (nothing is over it)", at.reachable, at);
    check("the player still reaches the bottom of the window", at.player.bottom >= at.height - 2, at);
    const chats = await called("chatOpen");
    const firstChat = chats[0] && chats[0].bounds;
    check("the chat opens in its own spot on the right, not over the player", !!firstChat && firstChat.x >= at.player.right - 2 && Math.abs(firstChat.x - at.chat.left) <= 2 && Math.abs(firstChat.y - at.chat.top) <= 2, { firstChat, at });

    console.log("2. A game starts while the stream plays");
    await page.evaluate(() => window.__gameStarted && window.__gameStarted({ exePath: "C:\\Games\\ArcRaiders\\PioneerGame.exe", startTime: Date.now() }));
    await page.waitForTimeout(1200);
    at = await layout();
    check("the Now Playing bar shows", !!at.np && /Arc Raiders/.test(await page.locator(".now-playing").innerText()), at);
    check("Close is still there and can be clicked", at.reachable && at.close.bottom <= at.np.top, at);
    check("the player stops above the Now Playing bar", at.player.bottom <= at.np.top + 1, at);
    check("the chat stops above it too", !!at.chat && at.chat.bottom <= at.np.top + 1, at);
    const restores = await called("streamRestore");
    const last = restores[restores.length - 1] || {};
    const end = (b) => b ? b.y + b.height : Infinity;
    check("the Twitch player and chat are moved up to match", end(last.bounds) <= at.np.top + 1 && end(last.chatBounds) <= at.np.top + 1, last);
    check("the Now Playing bar's Stop button can still be clicked", await page.evaluate(() => { const b = document.querySelector(".now-playing .np-close"); if (!b) return false; const r = b.getBoundingClientRect(); const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2); return !!hit && (hit === b || b.contains(hit)); }));

    console.log("3. Close");
    const before = (await called("streamClose")).length;
    await page.getByText("✕ Close", { exact: true }).first().click({ timeout: 4000 });
    await page.waitForTimeout(800);
    check("Close shuts the stream and goes back to the list", (await called("streamClose")).length > before && (await page.getByText("Hide Chat").count()) === 0);

    console.log("4. The game stops");
    await page.locator(".now-playing .np-close").click({ timeout: 4000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__openStream && window.__openStream("pokimane"));
    await page.waitForTimeout(2200);
    at = await layout();
    check("without Now Playing, a stream uses the whole height again", !at.np && at.player.bottom >= at.height - 2, at);

    console.log("5. All of it");
    check("nothing crashed along the way", (await page.locator(".aura-fallback").count()) === 0 && thrown.length === 0, thrown);
  } finally {
    await browser.close();
    server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The stream buttons check itself broke:", e); process.exit(2); });
