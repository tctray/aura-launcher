// Deleting your account from the window: Edit profile > Delete account asks for your password,
// shows what went wrong, and afterwards goes back to the login page saying it's done.
// Opens the built window (dist) in a real browser with a pretend account system.
// Added by aura-account-delete-setup.cjs.
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

  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.route((url) => !String(url).startsWith(base), (route) => route.abort());
  await page.addInitScript(() => {
    try { localStorage.clear(); localStorage.setItem("aura_profile", JSON.stringify({ username: "tctray", avatar: "", userId: "user-1" })); } catch {}
    window.__calls = [];
    const ok = (data) => Promise.resolve({ success: true, data });
    let deleted = false;
    const answers = {
      getSession: () => ok(deleted ? null : { id: "user-1", email: "me@example.com" }),
      getMyProfile: () => ok({ username: "tctray", avatar_url: null }),
      deleteAccount: (password) => password === "right" ? (deleted = true, new Promise((r) => setTimeout(() => r({ success: true, data: true }), 300))) : Promise.resolve({ success: false, error: "That password isn't right." }),
    };
    const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => { window.__calls.push([name + "." + String(key), args]); if (/^on[A-Z]/.test(String(key))) return () => {}; // listeners hand back a way to stop listening, as preload.js does
return (name === "auraCloud" && answers[key]) ? answers[key](...args) : ok(null); }) });
    window.auraCloud = fake("auraCloud");
    window.auraSocial = fake("auraSocial");
  });
  const calls = (k) => page.evaluate((k) => window.__calls.filter(([n]) => n === "auraCloud." + k).map(([, a]) => a), k);
  const dialog = page.locator('[aria-labelledby="auth-delete-title"]');
  const openIt = async () => {
    await page.locator(".gm-rail-avatar-ph:visible, .gm-rail-avatar:visible, .sb-profile:visible").first().click(); // your picture or name opens Edit profile
    await page.locator(".aura-delete-account").click();
    await dialog.waitFor({ timeout: 5000 });
  };
  try {
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(4000);
    console.log("1. Finding it");
    await page.locator(".gm-rail-avatar-ph:visible, .gm-rail-avatar:visible, .sb-profile:visible").first().click(); // your picture or name opens Edit profile
    check("Edit profile has a Delete account button", await page.locator(".aura-delete-account").isVisible().catch(() => false));
    await page.locator(".aura-delete-account").click();
    await dialog.waitFor({ timeout: 5000 }).catch(() => {});
    check("it asks first, saying what goes and what stays", await dialog.isVisible() && /can't be undone/.test(await dialog.innerText()) && /stay/.test(await dialog.innerText()));
    check("...with the safe choice ready to press", await page.evaluate(() => document.activeElement?.textContent) === "Keep my account");
    await page.keyboard.press("Escape");
    check("Esc keeps the account", !(await dialog.isVisible()) && (await calls("deleteAccount")).length === 0);

    console.log("2. The password");
    await openIt();
    await dialog.getByRole("button", { name: "Delete account" }).click();
    check("without a password it asks for one, and nothing is sent", /Enter your password\./.test(await dialog.innerText()) && (await calls("deleteAccount")).length === 0);
    await dialog.locator("input[type=password]").fill("wrong");
    await dialog.getByRole("button", { name: "Delete account" }).click();
    await page.waitForTimeout(400);
    check("the wrong password: says so, and you're still in", /That password isn't right\./.test(await dialog.innerText()) && await dialog.isVisible());

    console.log("3. Deleting");
    await dialog.locator("input[type=password]").fill("right");
    await dialog.getByRole("button", { name: "Delete account" }).click();
    await page.waitForTimeout(100);
    check("it says it's working on it", /Deleting/.test(await dialog.innerText().catch(() => "")));
    await page.waitForTimeout(1500);
    check("the password typed is what's checked", JSON.stringify((await calls("deleteAccount")).map((a) => a[0])) === '["wrong","right"]');
    check("afterwards AURA goes back to the login page", !(await dialog.isVisible().catch(() => false)) && await page.locator(".auth-btn", { hasText: "Log in" }).isVisible().catch(() => false));
    check("...saying the account has been deleted", /Your AURA account has been deleted\./.test(await page.locator(".auth-msg.ok").innerText().catch(() => "")));
  } catch (e) {
    check("the test ran to the end", false, String(e?.message || e).slice(0, 300));
  }
  await browser.close();
  server.close();
  done(failed ? 1 : 0);
})();
