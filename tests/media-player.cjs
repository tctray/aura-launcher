// Clips > Media: the tabs, your folders, playing music and video, the mini player on other pages,
// playlists, converting, and YouTube links. Opens the built window (dist) in a real browser,
// with the real electron/media.js serving real (made-up) files.
// Added by aura-media-player-setup.cjs.
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

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

  // Real files, made with FFmpeg (WebM and Ogg, which the test browser plays; AURA itself plays MP4 and MP3 too)
  let ffmpeg = null; try { ffmpeg = require("ffmpeg-static"); } catch {}
  if (!ffmpeg || !fs.existsSync(ffmpeg)) { note("FFmpeg isn't installed here (npm install)"); return done(process.env.CI ? 1 : 3); }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-ui-"));
  const music = path.join(root, "Music"), videos = path.join(root, "Videos");
  fs.mkdirSync(music); fs.mkdirSync(videos);
  const make = (args, file) => spawnSync(ffmpeg, ["-y", "-loglevel", "error", ...args, file]).status === 0;
  make(["-f", "lavfi", "-i", "sine=frequency=330:duration=6", "-metadata", "title=Night Drive", "-metadata", "artist=The Testers", "-c:a", "libopus"], path.join(music, "01 night.ogg"));
  make(["-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-metadata", "title=Morning", "-metadata", "artist=The Testers", "-c:a", "libopus"], path.join(music, "02 morning.ogg"));
  make(["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25", "-f", "lavfi", "-i", "sine=frequency=500", "-t", "6", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "300k", "-c:a", "libopus"], path.join(videos, "trip.webm"));
  make(["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25", "-t", "2", "-c:v", "mpeg4"], path.join(videos, "old.avi"));
  const handlers = {};
  let pick = [];
  require(path.join(ROOT, "electron", "media.js")).create({
    userData: fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-data-")), ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    dialog: { showOpenDialog: async () => ({ canceled: !pick.length, filePaths: pick }), showSaveDialog: async () => ({ canceled: true }) },
  });
  const calls = [];
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await page.route((url) => { const u = String(url); return !u.startsWith(base) && !u.startsWith("http://127.0.0.1:"); }, (route) => route.abort());
  await page.exposeBinding("__media", async (_src, ch, args) => { calls.push(ch); const h = handlers["media:" + ch]; return h ? h(null, ...(args || [])) : { success: false, error: "no " + ch }; });
  await page.addInitScript(() => {
    try { localStorage.clear(); localStorage.setItem("aura_profile", JSON.stringify({ username: "tctray", avatar: "", userId: "user-1" })); } catch {}
    const ok = (data) => Promise.resolve({ success: true, data });
    const answers = { getSession: () => ok({ id: "user-1", email: "me@example.com" }), getMyProfile: () => ok({ username: "tctray", avatar_url: null }) };
    const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => { if (/^on[A-Z]/.test(String(key))) return () => {}; return (name === "auraCloud" && answers[key]) ? answers[key](...args) : ok(null); }) });
    window.auraCloud = fake("auraCloud");
    window.auraSocial = fake("auraSocial");
    const media = {
      mediaState: () => window.__media("state", []), mediaAddFolder: () => window.__media("add-folder", []), mediaRemoveFolder: (f) => window.__media("remove-folder", [f]),
      mediaScan: () => window.__media("scan", []), mediaInfo: (p) => window.__media("info", [p]), mediaOpenFiles: () => window.__media("open-files", []), mediaDropped: (p) => window.__media("dropped", [p]),
      mediaUrl: (p) => window.__media("url", [p]), mediaConvert: (p) => window.__media("convert", [p]), mediaPlaylistsSave: (l) => window.__media("playlists-save", [l]),
      mediaImport: () => window.__media("import", []), mediaExport: (id) => window.__media("export", [id]), mediaPathsFor: () => [],
    };
    window.electronAPI = new Proxy({}, { get: (_t, key) => {
      if (key in media) return media[key];
      if (key === "isElectron" || key === "then") return undefined;
      return (...args) => { if (/^on[A-Z]/.test(String(key))) return () => {}; return Promise.resolve(null); };
    } });
  });
  const nav = (label) => page.locator(`.gm-rail-item:has-text("${label}"), .sb-item:has-text("${label}")`).first().click();
  const host = () => page.evaluate(() => { const h = document.getElementById("aura-media-host"); const v = h?.querySelector("video"); const r = h?.getBoundingClientRect(); return h ? { shown: h.style.display !== "none", x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), paused: v.paused, time: v.currentTime, src: v.src, frame: h.querySelector("iframe")?.src || "" } : null; });
  const rect = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }; }, sel);
  const near = (a, b) => a && b && Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2 && Math.abs(a.w - b.w) <= 2;
  try {
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(3000);
    console.log("1. The tabs");
    await nav("Clips"); await page.waitForTimeout(500);
    const tabs = page.locator('[role="tablist"][aria-label="Clips and media"]');
    check("Clips has Clips and Media tabs", await tabs.isVisible() && (await tabs.locator('[role="tab"]').allInnerTexts()).join("|") === "Clips|Media");
    await tabs.getByText("Media").click(); await page.waitForTimeout(800);
    check("Media starts by asking for your music and videos", await page.getByText("Add your music and videos").isVisible());

    console.log("2. Your folders");
    pick = [music, videos];
    await page.locator(".md-side .md-add", { hasText: "Add folder" }).click();
    await page.waitForTimeout(2500);
    const rows = page.locator(".md-row");
    check("the music and videos in them are listed", (await rows.count()) === 4, await rows.count());
    check("...by their real titles and artists", /Night Drive/.test(await rows.allInnerTexts()) && /The Testers/.test((await rows.allInnerTexts()).join()));
    await page.locator(".md-nav", { hasText: "Music" }).click(); await page.waitForTimeout(300);
    check("Music shows just the music", (await rows.count()) === 2);

    console.log("3. Playing");
    await page.getByRole("button", { name: "Play Night Drive" }).click();
    await page.waitForTimeout(2000);
    let h = await host();
    check("a song plays", h && !h.paused && h.time > 0.3 && /\/f\?p=/.test(h.src), h);
    check("on the Media tab there's no mini player", !(await page.locator(".md-dock").isVisible()));
    check("...shown as Now playing, with its artist", (await page.locator(".md-now-t").innerText()) === "Night Drive" && /The Testers/.test(await page.locator(".md-now-s").innerText()));
    await page.getByRole("button", { name: "Next", exact: true }).first().click(); await page.waitForTimeout(1200);
    check("Next goes to the next song", (await page.locator(".md-now-t").innerText()) === "Morning");
    await page.getByRole("button", { name: "Pause" }).first().click(); await page.waitForTimeout(300);
    check("Pause pauses", (await host()).paused);
    await page.locator(".md-nav", { hasText: "Videos" }).click(); await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Play trip" }).click(); await page.waitForTimeout(2000);
    h = await host();
    check("a video plays in the player box", h.shown && !h.paused && near(h, await rect(".md-stage")), [h, await rect(".md-stage")]);

    console.log("4. Somewhere else in AURA");
    await nav("Library"); await page.waitForTimeout(1200);
    check("the mini player shows, and the video keeps playing in it", await page.locator(".md-dock").isVisible() && near(await host(), await rect(".md-dock-screen")) && !(await host()).paused, [await host(), await rect(".md-dock-screen")]);
    await nav("Home"); await page.waitForTimeout(1200);
    check("...on Home too", await page.locator(".md-dock").isVisible() && !(await host()).paused);
    await page.locator(".md-dock-t").click(); await page.waitForTimeout(1200);
    check("clicking it goes back to Clips > Media", await page.locator(".md-stage").isVisible() && !(await page.locator(".md-dock").isVisible()));

    console.log("5. Playlists");
    await page.locator(".md-nav", { hasText: "Music" }).click(); await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Add Night Drive to a playlist" }).click();
    await page.getByRole("menuitem", { name: "+ New playlist" }).click(); await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Add Morning to a playlist" }).click();
    await page.getByRole("menuitem", { name: "Playlist 1" }).click(); await page.waitForTimeout(500);
    await page.locator(".md-nav", { hasText: "Playlist 1" }).click(); await page.waitForTimeout(300);
    check("songs can be added to a playlist", (await rows.count()) === 2 && /Night Drive/.test(await rows.first().innerText()));
    await page.getByRole("button", { name: "Move Morning up" }).click(); await page.waitForTimeout(300);
    check("...and put in order", /Morning/.test(await rows.first().innerText()));
    await page.getByRole("button", { name: "Rename" }).click();
    await page.getByLabel("Playlist name").fill("Late night"); await page.keyboard.press("Enter"); await page.waitForTimeout(500);
    const kept = await handlers["media:state"](null);
    check("...renamed, and kept by AURA", kept.playlists.some((p) => p.name === "Late night" && p.items.length === 2 && /morning/.test(p.items[0])), kept.playlists);

    console.log("6. Files the window can't play, and YouTube");
    await page.locator(".md-nav", { hasText: "Videos" }).click(); await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Play old" }).click(); await page.waitForTimeout(400);
    check("an AVI is converted first", calls.includes("convert"));
    // Watch until the converted copy is playing (a short one may finish and move on to the next video)
    let converted = false;
    for (let i = 0; i < 60 && !converted; i++) {
      h = await host();
      converted = /\/f\?p=.*media-cache/.test(decodeURIComponent(h.src)) || /couldn't play/i.test(await page.locator(".md-now-s").innerText().catch(() => ""));
      if (!converted) await page.waitForTimeout(150);
    }
    check("...then plays from the converted copy", converted, h);
    await page.getByLabel("YouTube link").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG");
    await page.getByRole("button", { name: "Play", exact: true }).last().click(); await page.waitForTimeout(500);
    h = await host();
    check("a YouTube link with a playlist plays in the privacy-friendly YouTube player", /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?autoplay=1.*list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG/.test(h.frame), h.frame);
    await page.getByLabel("YouTube link").fill("https://evil.example/watch?v=abc");
    await page.getByRole("button", { name: "Play", exact: true }).last().click(); await page.waitForTimeout(300);
    check("other links aren't played", (await host()).frame.includes("dQw4w9WgXcQ"));

    console.log("7. Clips still there");
    await page.locator('[role="tab"]', { hasText: "Clips" }).click(); await page.waitForTimeout(500);
    check("the Clips tab shows your clips page again", !(await page.locator(".md").isVisible()));
  } catch (e) {
    check("the test ran to the end", false, String(e?.message || e).slice(0, 400));
  }
  await browser.close();
  server.close();
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  done(failed ? 1 : 0);
})();
