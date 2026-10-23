// Moving around AURA with a controller. Opens the built window (dist) in a real browser with a
// pretend controller, and checks: moving in all four directions goes to what's really there,
// holding keeps moving, A selects (also switches in Settings), B closes and goes back, LB / RB
// change page, a dialog keeps the controller inside it, no "Controller Active" box covers the
// corner, and nothing moves while AURA isn't the window in front. Added by aura-controller-setup.cjs.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log("1. Which way is next");
  const src = fs.readFileSync(path.join(ROOT, "src", "components", "padnav.js"), "utf8");
  const P = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
  const box = (id, left, top, w = 100, h = 60) => ({ id, left, top, right: left + w, bottom: top + h });
  const grid = [box("a", 0, 0), box("b", 120, 0), box("c", 240, 0), box("d", 0, 100), box("e", 120, 100), box("f", 240, 100), box("far", 600, 400)];
  const go = (from, dir) => P.nextInDirection(grid.find((g) => g.id === from), grid, dir)?.id || null;
  check("right goes to the next one in the row", go("a", "right") === "b" && go("b", "right") === "c");
  check("down goes to the one straight below, not the nearest corner", go("b", "down") === "e" && go("c", "down") === "f");
  check("up and left work the same way", go("e", "up") === "b" && go("f", "left") === "e");
  check("nothing that way: stays put", go("a", "up") === null && go("a", "left") === null);
  const sidebar = [box("menu1", 0, 0, 180, 40), box("menu2", 0, 50, 180, 40), box("card", 220, 0, 150, 200)];
  check("from the menu, right goes to the page", P.nextInDirection(sidebar[1], sidebar, "right")?.id === "card");

  console.log("2. In the window");
  if (!fs.existsSync(path.join(DIST, "index.html"))) { check("the window has been built (dist/index.html)", false, "Run  npm run build  first."); return done(1); }
  let chromium;
  try { ({ chromium } = require("playwright")); } catch { note("the test browser isn't installed here"); return done(failed ? 1 : process.env.CI ? 1 : 3); }
  let browser = null;
  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: "msedge" }, { channel: "chrome" }]) {
    try { browser = await chromium.launch(options); break; } catch {}
  }
  if (!browser) { note("no browser to test with."); return done(failed ? 1 : process.env.CI ? 1 : 3); }
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path.join(DIST, url === "/" ? "index.html" : url);
    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" }); res.end(data); });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    const thrown = [];
    page.on("pageerror", (e) => thrown.push(String(e.message || e).split("\n")[0]));
    await page.route((url) => !String(url).startsWith(base) && !String(url).startsWith("data:"), (route) => route.abort());
    await page.addInitScript(() => {
      try { localStorage.clear(); localStorage.setItem("aura_profile", JSON.stringify({ username: "tester", avatar: "", userId: "user-1" })); } catch {}
      // A library to move around in (a new AURA starts empty: Added by aura-no-demo-setup.cjs)
      try { localStorage.setItem("aura_games", JSON.stringify([["Elden Ring","RPG"],["Cyberpunk 2077","RPG"],["Hollow Knight","Indie"],["Counter-Strike 2","FPS"],["Civilization VI","Strategy"],["Celeste","Indie"],["Hades","Action"],["Portal 2","Adventure"]].map(([title, category], i) => ({ id: "c" + i, title, exePath: "C:/Games/" + i + ".exe", cover: "", category, favorite: i < 2, playCount: i, lastPlayed: Date.now() - i * 3600000, addedAt: Date.now() - i * 86400000 })))); } catch {}
      const ok = (data) => Promise.resolve({ success: true, data });
      const account = { getSession: () => ok({ id: "user-1", email: "me@example.com" }), getMyProfile: () => ok({ username: "tester", avatar_url: null }) };
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (name === "auraCloud" && account[key]) ? account[key](...args) : ok(null)) });
      window.auraCloud = fake("auraCloud");
      window.auraSocial = fake("auraSocial");
      window.electronAPI = new Proxy({}, { get: (_t, key) => (key === "isElectron" ? true : typeof key !== "string" || key === "then" ? undefined : /^(on[A-Z]|remove)/.test(key) ? () => () => {} : () => Promise.resolve({ success: false })) });
      // A pretend controller the test presses
      window.__pad = { id: "Xbox Controller", index: 0, connected: true, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
      window.__front = true;
      Object.defineProperty(navigator, "getGamepads", { value: () => [window.__pad, null, null, null] });
      Document.prototype.hasFocus = function () { return window.__front; };
    });
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await sleep(5000);
    await page.evaluate(() => { const e = new Event("gamepadconnected"); e.gamepad = window.__pad; window.dispatchEvent(e); });
    const BTN = { A: 0, B: 1, Y: 3, LB: 4, RB: 5, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
    const press = async (name, hold = 90) => { await page.evaluate((i) => { window.__pad.buttons[i].pressed = true; }, BTN[name]); await sleep(hold); await page.evaluate((i) => { window.__pad.buttons[i].pressed = false; }, BTN[name]); await sleep(160); };
    const pageName = () => page.evaluate(() => { const el = [...document.querySelectorAll(".sb-item.on,.gm-rail-item.on")].find((e) => e.getBoundingClientRect().width > 0); return el ? el.getAttribute("title") || "" : ""; });
    const title = () => page.evaluate(() => (document.querySelector(".hdr-title")?.innerText || "").trim());
    const focused = () => page.evaluate(() => { const el = document.querySelector(".ctrl-focus"); if (!el) return null; const r = el.getBoundingClientRect(); return { cls: String(el.className).slice(0, 60), text: (el.innerText || el.getAttribute("aria-label") || el.title || "").trim().slice(0, 40), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), active: document.activeElement === el, menu: !!el.closest(".sb-item,.gm-rail-item"), dialog: !!el.closest(".mbk,[role=dialog]") }; });

    console.log("3. Nothing in the corner");
    await sleep(400);
    check("no \"Controller Active\" box", (await page.getByText("Controller Active").count()) === 0);
    check("a short notice says the controller is connected", /Controller connected/.test(await page.locator(".ctrl-hud").innerText().catch(() => "")));
    await sleep(3300);
    check("and it goes away by itself", (await page.locator(".ctrl-hud").count()) === 0);

    console.log("4. Moving around Home");
    await press("DOWN");
    let f = await focused();
    check("the first press lands on the page (not the menu), and really focuses it", !!f && !f.menu && f.active, f);
    const start = f;
    await press("RIGHT");
    f = await focused();
    check("right moves right", !!f && f.x > start.x && Math.abs(f.y - start.y) < 120, { start, f });
    await press("LEFT");
    const back = await focused();
    check("left comes back", !!back && Math.abs(back.x - start.x) < 30 && Math.abs(back.y - start.y) < 30, { start, back });
    await press("DOWN");
    f = await focused();
    check("down moves down", !!f && f.y > back.y, { back, f });
    await press("UP");
    check("up goes back up", (await focused()).y < f.y);
    const beforeHold = await focused();
    await page.evaluate(() => { window.__pad.axes[1] = 1; }); // left stick held down
    await sleep(1100);
    await page.evaluate(() => { window.__pad.axes[1] = 0; });
    await sleep(200);
    const afterHold = await focused();
    check("holding the stick keeps moving (several steps)", afterHold && afterHold.y > beforeHold.y + 150, { beforeHold, afterHold });
    for (let i = 0; i < 8; i++) await press("LEFT");
    f = await focused();
    check("left far enough reaches the menu", !!f && f.menu, f);

    console.log("5. Pages, Settings, and A");
    await press("RB");
    await sleep(500);
    check("RB goes to the next page", (await pageName()) === "Library", await pageName());
    await press("LB");
    await sleep(500);
    check("LB goes back", (await pageName()) === "Home", await pageName());
    await page.locator('.gm-rail-item[title="Settings"], .sb-item[title="Settings"]').first().click();
    await sleep(600);
    await page.mouse.move(5, 5);
    let reached = null;
    for (let i = 0; i < 25 && !reached; i++) {
      await press("DOWN");
      const g = await page.evaluate(() => { const el = document.querySelector(".ctrl-focus"); return el && el.matches('.tog,[role=switch]') ? { on: el.classList.contains("on") || el.getAttribute("aria-checked") === "true" } : null; });
      if (g) reached = g;
    }
    check("in Settings, moving down reaches the switches", !!reached, reached);
    if (reached) {
      await press("A");
      await sleep(300);
      const now = await page.evaluate(() => { const el = document.querySelector(".ctrl-focus"); return el.classList.contains("on") || el.getAttribute("aria-checked") === "true"; });
      check("A flips a switch", now !== reached.on, { before: reached.on, now });
      await press("A");
    }

    console.log("6. Dialogs and B");
    await page.locator('.gm-rail-item[title="Library"], .sb-item[title="Library"]').first().click();
    await sleep(600);
    await page.getByRole("button", { name: /Add Game/i }).first().click();
    await sleep(500);
    check("(the Add Game dialog is open)", (await page.locator(".mbk").count()) === 1);
    let inside = true;
    for (let i = 0; i < 6; i++) { await press(i % 2 ? "RIGHT" : "DOWN"); const g = await focused(); if (!g || !g.dialog) inside = false; }
    check("with a dialog open, the controller stays inside it", inside, await focused());
    await press("B");
    await sleep(400);
    if (await page.locator(".mbk").count()) await press("B");
    await sleep(300);
    check("B closes the dialog", (await page.locator(".mbk").count()) === 0);
    await press("DOWN");
    let card = null;
    for (let i = 0; i < 6 && !card; i++) { const g = await focused(); if (g && /card/.test(g.cls) && !g.menu) card = g; else await press("DOWN"); }
    if (card) {
      await press("A");
      await sleep(700);
      const hero = await title();
      check("A on a game opens it", !!hero && !/^LIBRARY$/i.test(hero), hero);
      await press("B");
      await sleep(600);
      check("B goes back from the game", /^LIBRARY$/i.test(await title()), await title());
    } else check("(reached a game card in the Library)", false, await focused());
    await press("DOWN");
    await press("B");
    check("B from the page goes to the menu", !!(await focused())?.menu, await focused());
    await press("B");
    await sleep(500);
    check("B from the menu goes Home", (await pageName()) === "Home", await pageName());

    console.log("7. Start, and not while AURA is behind another window");
    await press("START");
    check("Start shows the buttons", /A: select[\s\S]*B: back/.test(await page.locator(".ctrl-hud").innerText().catch(() => "")));
    const where = await focused();
    await page.evaluate(() => { window.__front = false; });
    await press("RIGHT"); await press("RB");
    await sleep(500);
    check("while you're in a game (AURA not in front), the controller doesn't move AURA", JSON.stringify(await focused()) === JSON.stringify(where) && (await pageName()) === "Home");
    await page.evaluate(() => { window.__front = true; });
    await page.mouse.move(400, 400); await page.mouse.down(); await page.mouse.up();
    check("using the mouse hides the controller's ring", (await page.locator(".ctrl-focus").count()) === 0);
    check("nothing crashed", (await page.locator(".aura-fallback").count()) === 0 && thrown.filter((m) => !/reading 'live'/.test(m)).length === 0, thrown);
  } finally {
    await browser.close();
    server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The controller check itself broke:", e); process.exit(2); });
