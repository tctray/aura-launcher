// The update notice (bottom right), and the update button in Settings.
//
// Opens the built window (dist) in a real browser with a pretend desktop side, plays through an
// update the way the installed app reports one, and checks each step:
//   - Update available:   plain icon, the version, Later and Download
//   - Downloading update: the percentage and a progress bar, nothing to press
//   - Download complete:  a green check mark, Later and Restart now
//   - no emoji anywhere in it
//   - Settings: "Up to date" with a green check mark; Download and Restart now when there is one
// Added by aura-update-notice-setup.cjs.
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
const EMOJI = /\p{Extended_Pictographic}/u;

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

  // Start AURA logged in. `latest` is the newest version the pretend GitHub has.
  async function start({ latest = "1.16.0" } = {}) {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    const thrown = [];
    page.on("pageerror", (e) => thrown.push(String(e.message || e).split("\n")[0]));
    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());
    await page.addInitScript(({ latest }) => {
      try { localStorage.clear(); localStorage.setItem("aura_profile", JSON.stringify({ username: "tester", avatar: "", userId: "user-1" })); } catch {}
      window.__calls = [];
      window.__tell = {}; // what the desktop side would tell the window: update found, progress, ready
      const ok = (data) => Promise.resolve({ success: true, data });
      const account = { getSession: () => ok({ id: "user-1", email: "me@example.com" }), getMyProfile: () => ok({ username: "tester", avatar_url: null }), saveProfile: (name, picture) => ok({ username: name, avatar_url: picture || null }) };
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (name === "auraCloud" && account[key]) ? account[key](...args) : ok(null)) });
      window.auraCloud = fake("auraCloud");
      window.auraSocial = fake("auraSocial");
      const desktop = {
        checkUpdate: () => Promise.resolve({ success: true, current: "1.16.0", latest, hasUpdate: latest !== "1.16.0" }),
        downloadUpdate: () => Promise.resolve({ success: true }),
        installUpdate: () => Promise.resolve({ success: true }),
      };
      window.electronAPI = new Proxy({}, {
        get: (_t, key) => {
          if (key === "isElectron") return true;
          if (typeof key !== "string" || key === "then") return undefined;
          if (/^on[A-Z]/.test(key)) return (cb) => { window.__tell[key] = cb; return () => {}; };
          if (/^remove/.test(key)) return () => {};
          return (...args) => { window.__calls.push(key); return desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }); };
        },
      });
    }, { latest });
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(4500);
    const tell = async (what, value) => { await page.evaluate(([w, v]) => window.__tell[w] && window.__tell[w](v), [what, value]); await page.waitForTimeout(350); };
    const calls = (name) => page.evaluate((n) => window.__calls.filter((k) => k === n).length, name);
    const notice = () => page.evaluate(() => {
      const box = document.querySelector(".update-toast");
      if (!box) return null;
      const icon = box.querySelector(".update-toast-icon"), bar = box.querySelector(".update-progress-bar");
      return {
        title: box.querySelector(".update-toast-title")?.textContent.trim() || "", text: box.querySelector(".update-msg")?.textContent.trim() || "", all: box.innerText,
        buttons: [...box.querySelectorAll("button")].map((b) => b.textContent.trim()),
        icon: icon ? { colour: getComputedStyle(icon).color, drawn: !!icon.querySelector("svg path"), done: icon.classList.contains("done") } : null,
        bar: bar ? Math.round((bar.getBoundingClientRect().width / bar.parentElement.getBoundingClientRect().width) * 100) : null,
        moving: getComputedStyle(box).animationIterationCount === "infinite" || [...box.querySelectorAll("*")].some((e) => getComputedStyle(e).animationIterationCount === "infinite"),
      };
    });
    return { page, thrown, tell, calls, notice };
  }
  const green = (colour) => { const [r, g, b] = (String(colour).match(/\d+/g) || []).map(Number); return g > 150 && g > r + 60 && g > b + 60; };

  try {
    console.log("1. An update is found");
    let app = await start();
    check("no notice while there is nothing to say", (await app.notice()) === null);
    await app.tell("onUpdateAvailable", "1.17.0");
    let n = await app.notice();
    check("it says an update is available, and which version", !!n && n.title === "Update available" && /AURA 1\.17\.0 is ready to download/.test(n.text), n);
    check("with two buttons: Later and Download", !!n && n.buttons.join("|") === "Later|Download", n && n.buttons);
    check("a plain drawn icon, no emoji", !!n && !!n.icon && n.icon.drawn && !n.icon.done && !EMOJI.test(n.all), n && n.all);
    check("nothing pulses or shimmers", !!n && !n.moving);
    await app.page.locator(".update-toast").getByText("Later", { exact: true }).click({ timeout: 4000 });
    await app.page.waitForTimeout(300);
    check("Later puts it away", (await app.notice()) === null && (await app.calls("downloadUpdate")) === 0);
    await app.tell("onUpdateAvailable", "1.17.0");
    check("it comes back the next time AURA is told about the update", !!(await app.notice()));

    console.log("2. Downloading");
    await app.page.locator(".update-toast").getByText("Download", { exact: true }).click({ timeout: 4000 });
    await app.page.waitForTimeout(300);
    check("Download starts the download", (await app.calls("downloadUpdate")) === 1);
    await app.tell("onUpdateProgress", 42.4);
    await app.page.waitForTimeout(400);
    n = await app.notice();
    check("it shows how far along it is, in words and as a bar", !!n && n.title === "Downloading update" && n.text === "42% downloaded" && n.bar >= 40 && n.bar <= 44, n);
    check("with nothing to press, and no emoji", !!n && n.buttons.length === 0 && !EMOJI.test(n.all), n && n.buttons);

    console.log("3. Download complete");
    await app.tell("onUpdateReady");
    n = await app.notice();
    check("it says the download is complete", !!n && n.title === "Download complete", n);
    check("with a green check mark", !!n && !!n.icon && n.icon.done && n.icon.drawn && green(n.icon.colour), n && n.icon);
    check("it says to restart, names the version, and that closing AURA installs it too", !!n && /Restart AURA to finish updating to 1\.17\.0\./.test(n.text) && /next time you close AURA/.test(n.text), n && n.text);
    check("with two buttons: Later and Restart now", !!n && n.buttons.join("|") === "Later|Restart now", n && n.buttons);
    check("and no emoji", !!n && !EMOJI.test(n.all), n && n.all);
    await app.page.locator(".update-toast").getByText("Restart now", { exact: true }).click({ timeout: 4000 });
    await app.page.waitForTimeout(300);
    check("Restart now restarts AURA into the update", (await app.calls("installUpdate")) === 1);
    await app.page.locator(".update-toast").getByText("Later", { exact: true }).click({ timeout: 4000 });
    await app.page.waitForTimeout(300);
    check("Later puts it away", (await app.notice()) === null);
    check("nothing crashed along the way", (await app.page.locator(".aura-fallback").count()) === 0, app.thrown);
    await app.page.context().close();

    console.log("4. When the version isn't known");
    app = await start();
    await app.tell("onUpdateReady");
    n = await app.notice();
    check("the notice still reads properly", !!n && n.title === "Download complete" && /^Restart AURA to finish updating\. It also installs/.test(n.text) && !/undefined|null/.test(n.all), n && n.text);
    await app.page.context().close();

    console.log("5. Settings");
    const settings = async (app) => { await app.page.locator('.gm-rail-item[title="Settings"], .sb-item[title="Settings"]').first().click({ timeout: 5000 }); await app.page.waitForTimeout(900); };
    app = await start();
    await settings(app);
    const upToDate = app.page.locator(".update-ok").first();
    await upToDate.scrollIntoViewIfNeeded({ timeout: 5000 });
    const mark = await upToDate.evaluate((el) => ({ text: el.textContent.trim(), tick: el.querySelector("svg") ? getComputedStyle(el.querySelector("svg")).color : "" }));
    check("with no update: \"Up to date\" and a green check mark", mark.text === "Up to date" && green(mark.tick), mark);
    await app.page.context().close();
    app = await start({ latest: "1.17.0" });
    await settings(app);
    const download = app.page.getByRole("button", { name: "Download v1.17.0", exact: true });
    await download.scrollIntoViewIfNeeded({ timeout: 5000 });
    check("with an update: a Download button that names the version, and doesn't pulse", (await download.evaluate((el) => getComputedStyle(el).animationName)) === "none");
    await download.click({ timeout: 4000 });
    await app.page.waitForTimeout(500);
    const restart = app.page.getByRole("button", { name: "Restart now", exact: true }).first();
    check("after it downloads: a Restart now button", (await app.calls("downloadUpdate")) === 1 && (await restart.isVisible()));
    await restart.click({ timeout: 4000 });
    await app.page.waitForTimeout(300);
    check("which restarts AURA into the update", (await app.calls("installUpdate")) === 1);
    await app.page.context().close();

    console.log("6. The code");
    const source = (() => { try { return fs.readFileSync(path.join(ROOT, "src", "App.jsx"), "utf8").replace(/\r\n/g, "\n"); } catch { return ""; } })(); // Windows line endings too (Updated by aura-windows-test-fix.cjs)
    const from = source.indexOf("const UPDATE_CSS"), to = source.indexOf("function UpdateButton");
    const end = to < 0 ? -1 : source.indexOf("\n}\n", to);
    const part = from >= 0 && end > from ? source.slice(from, end) : "";
    check("no emoji is left in the update notice or the Settings update button", part.length > 1500 && !EMOJI.test(part) && !/✓|⚡|↓/.test(part), (part.match(/\p{Extended_Pictographic}|✓|⚡|↓/gu) || []).join(" "));
  } finally {
    await browser.close();
    server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The update notice check itself broke:", e); process.exit(2); });
