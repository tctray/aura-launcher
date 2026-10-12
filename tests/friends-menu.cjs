// The friends panel (right side) and its menu button.
//
// Opens the built window (dist) in a real browser with a pretend desktop side and checks that:
//   - the left menu has no Friends item, on Home or on any other page
//   - the friends panel has a menu button (three lines) that folds it to a narrow strip and
//     opens it again, giving the page the room while it is folded
//   - folded or open, it is the same on Home and on the other pages, and it is remembered
//   - folding the panel doesn't throw away what is in it
// Added by aura-friends-menu-setup.cjs.
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

  // Start AURA logged in, on Home. Storage is only cleared the first time, so restarting
  // AURA (reload) keeps what it remembered.
  async function start() {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    const thrown = [];
    page.on("pageerror", (e) => thrown.push(String(e.message || e).split("\n")[0]));
    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());
    await page.addInitScript(() => {
      try {
        if (!sessionStorage.getItem("__started")) {
          sessionStorage.setItem("__started", "1");
          localStorage.clear();
          localStorage.setItem("aura_profile", JSON.stringify({ username: "tester", avatar: "", userId: "user-1" }));
        }
      } catch {}
      const ok = (data) => Promise.resolve({ success: true, data });
      const account = { getSession: () => ok({ id: "user-1", email: "me@example.com" }), getMyProfile: () => ok({ username: "tester", avatar_url: null }), saveProfile: (name, picture) => ok({ username: name, avatar_url: picture || null }) };
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (name === "auraCloud" && account[key]) ? account[key](...args) : ok(null)) });
      window.auraCloud = fake("auraCloud");
      window.auraSocial = fake("auraSocial");
      window.electronAPI = new Proxy({}, {
        get: (_t, key) => {
          if (key === "isElectron") return true;
          if (typeof key !== "string" || key === "then") return undefined;
          if (/^on[A-Z]/.test(key)) return () => () => {};
          if (/^remove/.test(key)) return () => {};
          return () => Promise.resolve({ success: false });
        },
      });
    });
    const load = async () => { await page.goto(base + "/index.html", { waitUntil: "load" }); await page.waitForTimeout(4500); };
    await load();
    const goTo = async (label) => { await page.locator(`.gm-rail-item[title="${label}"], .sb-item[title="${label}"]`).first().click({ timeout: 5000 }); await page.waitForTimeout(900); };
    const button = page.locator(".fp .fp-toggle");
    const press = async () => { await button.click({ timeout: 4000 }); await page.waitForTimeout(600); };
    const look = () => page.evaluate(() => {
      const seen = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== "hidden"; };
      const panel = document.querySelector(".fp"), b = panel?.querySelector(".fp-toggle");
      const left = [...document.querySelectorAll(".gm-rail-item, .sb-item")];
      const page = document.querySelector(".gm-main") || document.querySelector(".main");
      const br = b?.getBoundingClientRect();
      return {
        layout: document.querySelector(".gm-app") ? "home" : "sidebar",
        leftItems: left.length,
        leftFriends: left.filter((el) => /friend/i.test((el.getAttribute("title") || "") + " " + el.textContent)).map((el) => el.getAttribute("title") || el.textContent.trim()),
        panels: document.querySelectorAll(".fp").length,
        width: panel ? Math.round(panel.getBoundingClientRect().width) : -1,
        atRightEdge: panel ? Math.round(window.innerWidth - panel.getBoundingClientRect().right) : -1,
        title: seen(panel?.querySelector(".fp-title")) ? panel.querySelector(".fp-title").textContent.trim() : "",
        body: seen(panel?.querySelector(".fp-body")),
        tabs: seen(panel?.querySelector(".fp-body")) ? [...panel.querySelectorAll(".fp-body > div:first-child > button")].map((x) => x.textContent.trim().toUpperCase()) : [],
        button: b ? { seen: seen(b), isButton: b.tagName === "BUTTON", lines: b.querySelectorAll("svg line").length, tip: b.getAttribute("title"), name: b.getAttribute("aria-label"), expanded: b.getAttribute("aria-expanded"), inside: !!br && br.left >= panel.getBoundingClientRect().left && br.right <= panel.getBoundingClientRect().right, x: br ? Math.round(br.left) : -1 } : null,
        oldX: !!panel?.querySelector(".fp-refresh"),
        pageWidth: page ? Math.round(page.getBoundingClientRect().width) : -1,
        saved: localStorage.getItem("aura_friends_open"),
        strayLines: (() => { const cs = getComputedStyle(document.getElementById("root")); return [cs.borderLeftWidth, cs.borderRightWidth].filter((w) => w !== "0px"); })(),
      };
    });
    return { page, thrown, load, goTo, button, press, look };
  }

  try {
    console.log("1. Home");
    const app = await start();
    let s = await app.look();
    check("this is Home, and the left menu is there", s.layout === "home" && s.leftItems >= 6, s);
    check("the left menu has no Friends item", s.leftFriends.length === 0, s.leftFriends);
    check("the friends panel is open on the right, with its three tabs", s.panels === 1 && s.width >= 240 && s.atRightEdge === 0 && s.body && s.tabs.join("|") === "AURA|DISCORD|STEAM", s);
    check("it has a menu button of its own: three lines, on the panel", !!s.button && s.button.seen && s.button.isButton && s.button.lines === 3 && s.button.inside, s.button);
    check("the button says what it does (Hide friends), also to a screen reader", !!s.button && s.button.tip === "Hide friends" && s.button.name === "Hide friends" && s.button.expanded === "true", s.button);
    check("the panel is labelled FRIENDS, and the old X is gone", s.title === "FRIENDS" && !s.oldX, [s.title, s.oldX]);
    const open = s;

    await app.press();
    s = await app.look();
    check("the button folds the panel to a narrow strip", s.width > 30 && s.width <= 64 && s.atRightEdge === 0, s.width);
    check("the strip keeps only the button", !s.body && s.title === "" && !!s.button && s.button.seen && s.button.inside && s.button.lines === 3, s);
    check("which now says Show friends", !!s.button && s.button.tip === "Show friends" && s.button.name === "Show friends" && s.button.expanded === "false", s.button);
    check("the page gets the room", s.pageWidth - open.pageWidth === open.width - s.width && s.pageWidth > open.pageWidth + 150, [open.pageWidth, s.pageWidth]);
    check("no stray line shows down the page where the panel was", s.strayLines.length === 0, s.strayLines);
    check("AURA remembers it is folded", s.saved === "0", s.saved);

    console.log("2. The other pages");
    await app.goTo("Library");
    s = await app.look();
    check("on Library the left menu has no Friends item either", s.layout === "sidebar" && s.leftItems >= 6 && s.leftFriends.length === 0, s.leftFriends);
    check("the panel is still folded here", s.panels === 1 && s.width <= 64 && !s.body && !!s.button && s.button.seen, s);
    await app.press();
    s = await app.look();
    check("the button opens it again", s.width >= 240 && s.body && s.tabs.join("|") === "AURA|DISCORD|STEAM" && s.title === "FRIENDS" && s.saved === "1", s);
    await app.button.focus();
    await app.page.keyboard.press("Enter");
    await app.page.waitForTimeout(600);
    check("it works from the keyboard too (Enter)", (await app.look()).width <= 64);
    await app.page.keyboard.press("Enter");
    await app.page.waitForTimeout(600);
    check("and opens the same way", (await app.look()).width >= 240);

    console.log("3. Nothing in the panel is lost");
    const box = app.page.locator(".fp input").first();
    if (!(await box.count())) note("the friends panel has no box to type in here, so this wasn't checked");
    else {
      await box.fill("half a username");
      await app.press();
      const folded = await app.look();
      await app.press();
      check("something typed in it is still there after folding and opening", folded.width <= 64 && (await box.inputValue()) === "half a username", await box.inputValue().catch(() => null));
    }
    await app.goTo("Home");
    s = await app.look();
    check("back on Home the panel is open, as it was left", s.layout === "home" && s.width >= 240 && s.body, s);

    console.log("4. Restarting AURA");
    await app.press();
    await app.load();
    s = await app.look();
    check("folded when AURA closed: folded when it opens, button showing", s.width <= 64 && !s.body && !!s.button && s.button.seen && s.button.expanded === "false", s);
    await app.press();
    await app.load();
    s = await app.look();
    check("open when AURA closed: open when it opens", s.width >= 240 && s.body, s);
    check("nothing crashed along the way", (await app.page.locator(".aura-fallback").count()) === 0 && app.thrown.length === 0, app.thrown);
    await app.page.context().close();

    console.log("5. The code");
    const source = (() => { try { return fs.readFileSync(path.join(ROOT, "src", "App.jsx"), "utf8"); } catch { return ""; } })();
    if (!source) note("src/App.jsx isn't here, so the code wasn't checked");
    else check("the friends panel is only opened and folded from its own button", (source.match(/setFriendsOpen\(/g) || []).length === 2 && !/className="(?:sb-item|gm-rail-item)" onClick=\{\(\)=>setFriendsOpen/.test(source), (source.match(/setFriendsOpen\(/g) || []).length);
  } finally {
    await browser.close();
    server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The friends panel check itself broke:", e); process.exit(2); });
