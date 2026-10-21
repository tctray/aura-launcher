// Saved themes keep their background: saving a theme (Customize > Saved) keeps the background showing
// (a picture from the PC, a web link, or none), and loading it brings back the colors and the background
// together. Opens the built window (dist) in a real browser with a pretend desktop side.
// Added by aura-theme-backgrounds-setup.cjs.
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
        if (!sessionStorage.getItem("aura_test_started")) {
          sessionStorage.setItem("aura_test_started", "1");
          localStorage.clear();
          localStorage.setItem("aura_profile", JSON.stringify({ username: "tester", avatar: "", userId: "user-1" }));
          // Two themes saved before this update or on another PC
          localStorage.setItem("aura_saved_themes", JSON.stringify([
            { name: "Old one", colors: {}, accent: "#00ff99", themeName: "obsidian" },
            { name: "Elsewhere", colors: {}, accent: "#ff00aa", themeName: "ocean", background: { kind: "pic", pic: "pic-from-another-pc" } },
          ]));
        }
      } catch {}
      // A picture "picked from the PC": a solid colour, made here
      window.__picture = (color) => { const c = document.createElement("canvas"); c.width = 64; c.height = 36; const g = c.getContext("2d"); g.fillStyle = color; g.fillRect(0, 0, 64, 36); return c.toDataURL("image/png"); };
      window.__pickColor = "#d01010";
      const ok = (data) => Promise.resolve({ success: true, data });
      const account = { getSession: () => ok({ id: "user-1", email: "me@example.com" }), getMyProfile: () => ok({ username: "tester", avatar_url: null }), getMyData: () => ok([]), getMySessionIds: () => ok([]) };
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (name === "auraCloud" && account[key]) ? account[key](...args) : ok(null)) });
      window.auraCloud = fake("auraCloud");
      window.auraSocial = fake("auraSocial");
      window.electronAPI = new Proxy({}, {
        get: (_t, key) => {
          if (key === "isElectron") return true;
          if (typeof key !== "string" || key === "then") return undefined;
          if (key === "pickImage") return () => Promise.resolve(window.__picture(window.__pickColor));
          if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};
          return () => Promise.resolve({ success: false });
        },
      });
    });
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(4500);
    const look = () => page.evaluate(() => {
      const bg = document.querySelector(".app-bg");
      return { bgVar: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim().toLowerCase(), picture: bg ? bg.style.backgroundImage : "", saved: localStorage.getItem("aura_bg") || "" };
    });
    const tab = async (label) => { await page.locator("button", { hasText: label }).first().click(); await page.waitForTimeout(250); };
    const preset = async (name) => { await tab("Presets"); await page.locator("span", { hasText: new RegExp("^" + name.toUpperCase() + "$") }).first().click(); await page.waitForTimeout(300); };
    const saveAs = async (name) => { await tab("Saved"); await page.locator('input[placeholder^="Theme name"]').fill(name); await page.locator("button.btn-p", { hasText: /^Save$/ }).click(); await page.waitForTimeout(600); };
    const row = (name) => page.locator("div", { has: page.locator(`div:text-is("${name}")`) }).filter({ has: page.locator("button", { hasText: "Load" }) }).last();
    const load = async (name) => { await tab("Saved"); await row(name).locator("button", { hasText: "Load" }).click(); await page.waitForTimeout(900); };
    const savedList = () => page.evaluate(() => JSON.parse(localStorage.getItem("aura_saved_themes") || "[]"));
    const toasts = () => page.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.innerText).join(" | "));
    const red = await page.evaluate(() => window.__picture("#d01010"));

    await page.locator('.gm-rail-item[title="Customize"], .sb-item[title="Customize"]').first().click({ timeout: 5000 });
    await page.waitForTimeout(600);

    console.log("1. Saving a theme keeps its background");
    await preset("Ocean");
    await tab("BG");
    await page.locator("button.btn-p", { hasText: /^Browse$/ }).click();
    await page.waitForTimeout(500);
    let l = await look();
    check("(a picture from the PC is the background, with the Ocean colors)", l.saved === red && /data:image/.test(l.picture) && l.bgVar === "#020c1b", { ...l, picture: l.picture.slice(0, 40), saved: l.saved.slice(0, 30) });
    await saveAs("Red ocean");
    let list = await savedList();
    const ro = list.find((x) => x.name === "Red ocean");
    check("the saved theme keeps the background picture", ro && ro.background && ro.background.kind === "pic" && typeof ro.background.pic === "string", ro);
    check("the picture itself isn't put in the theme list (it can be several MB)", !JSON.stringify(list).includes("data:image"), JSON.stringify(list).length);
    check("the list says it has a background and shows it in its little picture", /with background/.test(await row("Red ocean").innerText()) && (await row("Red ocean").locator(".theme-bg-thumb").count()) === 1);

    await preset("Blood");
    await tab("BG");
    await page.locator('input[placeholder="https://... image URL"]').fill("https://example.com/space.jpg");
    await page.locator("button.btn-p", { hasText: "Apply Background" }).click();
    await page.waitForTimeout(400);
    await saveAs("Web blood");
    list = await savedList();
    check("a web-link background is saved as the link", JSON.stringify(list.find((x) => x.name === "Web blood").background) === JSON.stringify({ kind: "web", url: "https://example.com/space.jpg" }));

    await preset("Midnight");
    await tab("BG");
    await page.locator("button.btn-gh", { hasText: /^Remove$/ }).click();
    await page.waitForTimeout(400);
    await saveAs("Plain");
    list = await savedList();
    check("no background is saved as no background", JSON.stringify(list.find((x) => x.name === "Plain").background) === JSON.stringify({ kind: "none" }) && /no background/.test(await row("Plain").innerText()));

    console.log("2. Loading a theme brings back the colors and the background");
    await load("Red ocean");
    l = await look();
    check("Red ocean: the Ocean colors and the red picture", l.bgVar === "#020c1b" && l.saved === red && /data:image/.test(l.picture), { bgVar: l.bgVar, saved: l.saved.slice(0, 30) });
    check("and it says so", /"Red ocean" loaded/.test(await toasts()), await toasts());
    await tab("BG");
    check("the BG tab shows that picture too", (await page.locator('input[placeholder="https://... image URL"]').inputValue()) === red);
    await load("Plain");
    l = await look();
    check("Plain: the Midnight colors and no background", l.bgVar === "#222831" && l.saved === "" && l.picture === "", l);
    await load("Web blood");
    l = await look();
    check("Web blood: the Blood colors and the web picture", l.bgVar === "#0d0000" && l.saved === "https://example.com/space.jpg" && /example\.com\/space\.jpg/.test(l.picture), l);
    await load("Old one");
    l = await look();
    check("a theme saved before this update: its colors load, the background stays as it is", l.bgVar === "#0a0a0a" && l.saved === "https://example.com/space.jpg", l);
    await load("Elsewhere");
    l = await look();
    check("a theme whose picture is on another PC: colors load, background stays, and it says why", l.bgVar === "#020c1b" && l.saved === "https://example.com/space.jpg" && /on another PC/.test(await toasts()), { l, t: await toasts() });

    console.log("3. After restarting AURA");
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(4500);
    await page.locator('.gm-rail-item[title="Customize"], .sb-item[title="Customize"]').first().click({ timeout: 5000 });
    await page.waitForTimeout(600);
    await load("Red ocean");
    l = await look();
    check("saved themes still bring back their picture", l.bgVar === "#020c1b" && l.saved === red, { bgVar: l.bgVar, saved: l.saved.slice(0, 30) });

    console.log("4. Replacing and deleting");
    const firstPic = (await savedList()).find((x) => x.name === "Red ocean").background.pic;
    await page.evaluate(() => { window.__pickColor = "#1040d0"; });
    await tab("BG");
    await page.locator("button.btn-p", { hasText: /^Browse$/ }).click();
    await page.waitForTimeout(400);
    await saveAs("Red ocean");
    const kept = (id) => page.evaluate((id) => new Promise((res) => { const r = indexedDB.open("aura-theme-pictures", 1); r.onsuccess = () => { const g = r.result.transaction("pics").objectStore("pics").get(id); g.onsuccess = () => res(!!g.result); g.onerror = () => res(false); }; r.onerror = () => res(false); }), id);
    const secondPic = (await savedList()).find((x) => x.name === "Red ocean").background.pic;
    check("saving over a theme keeps the new picture and lets go of the old one", secondPic !== firstPic && (await kept(secondPic)) && !(await kept(firstPic)) && (await savedList()).filter((x) => x.name === "Red ocean").length === 1);
    await tab("Saved");
    await row("Red ocean").locator("button.btn-d").click();
    await page.waitForTimeout(500);
    check("deleting a theme lets go of its picture", !(await kept(secondPic)) && !(await savedList()).some((x) => x.name === "Red ocean"));

    check("nothing crashed along the way", (await page.locator(".aura-fallback").count()) === 0 && thrown.length === 0, thrown);
  } finally {
    await browser.close();
    server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The theme backgrounds check itself broke:", e); process.exit(2); });
