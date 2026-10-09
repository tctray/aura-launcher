// Staying logged in: when AURA starts with a saved login, it goes straight in
// (no "Pick a username"), unless the account really has no username yet.
// Opens the built window (dist) in a real browser with a pretend account system.
// Added by aura-username-fix-setup.cjs.
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

  // Start AURA with a saved login. `online` is the profile Supabase has; `local` the one saved on this PC.
  async function start({ online, local, offline = false }) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());
    await page.addInitScript(({ online, local, offline }) => {
      try { localStorage.clear(); if (local) localStorage.setItem("aura_profile", JSON.stringify(local)); } catch {}
      window.__calls = [];
      const ok = (data) => Promise.resolve({ success: true, data });
      const answers = {
        getSession: () => ok({ id: "user-1", email: "me@example.com", offline }),
        getMyProfile: () => (offline ? Promise.resolve({ success: false, error: "fetch failed" }) : ok(online)),
        saveProfile: (name, picture) => ok({ username: name, avatar_url: picture || null }),
      };
      // Everything else in the account system answers "nothing yet"
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => { window.__calls.push([name + "." + String(key), args]); return (name === "auraCloud" && answers[key]) ? answers[key](...args) : ok(null); }) });
      window.auraCloud = fake("auraCloud");
      window.auraSocial = fake("auraSocial");
    }, { online, local, offline });
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(4500);
    const seen = await page.evaluate(() => ({
      title: [...document.querySelectorAll(".auth-title")].map((e) => e.textContent).join(" | "),
      saved: window.__calls.filter(([k]) => k === "auraCloud.saveProfile").map(([, a]) => [a[0], String(a[1] || "").slice(0, 22)]),
      text: (document.body.innerText || "").trim().length,
    }));
    await page.context().close();
    return seen;
  }

  try {
    console.log("1. Starting AURA while logged in");
    let s = await start({ online: { username: "tctray", avatar_url: null }, local: { username: "tctray", avatar: "", userId: "user-1" } });
    check("goes straight in, no \"Pick a username\"", !s.title && s.text > 20, s);
    s = await start({ online: { username: "tctray", avatar_url: "https://twparkshmkrroaraiaow.supabase.co/storage/v1/object/public/avatars/user-1/a.png" }, local: { username: "tctray", avatar: "", userId: "user-1" } });
    check("same with a profile picture", !s.title && s.text > 20, s);
    s = await start({ online: { username: "tctray", avatar_url: null }, local: null });
    check("same on a PC where AURA has no profile saved yet", !s.title && s.text > 20, s);
    s = await start({ online: { username: "tctray", avatar_url: null }, local: { username: "tctray", avatar: "data:image/png;base64,iVBORw0KGgo=", userId: "user-1" } });
    check("a picture chosen on this PC is still uploaded quietly, and AURA goes straight in", !s.title && s.saved.some(([n, p]) => n === "tctray" && p.startsWith("data:image/png")), s);
    s = await start({ offline: true, local: { username: "tctray", avatar: "", userId: "user-1" } });
    check("offline: goes straight in with the name saved on this PC", !s.title && s.text > 20, s);

    console.log("2. Only when the account really has no username");
    s = await start({ online: null, local: null });
    check("asks for a username", /Pick a username/.test(s.title), s);
    s = await start({ online: null, local: { username: "tctray", avatar: "", userId: "user-1" } });
    check("but first tries the name saved on this PC, and goes in", !s.title && s.saved.some(([n]) => n === "tctray"), s);
    s = await start({ online: null, local: { username: "someone", avatar: "", userId: "user-2" } });
    check("a name saved by a different account isn't used", /Pick a username/.test(s.title) && !s.saved.length, s);
  } finally {
    await browser.close();
    server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
