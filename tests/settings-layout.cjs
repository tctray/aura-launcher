// Settings: the sidebar of categories, search, groups that fold away, and that every setting is
// still there and still works. Opens the built window (dist) in a real browser.
// Added by aura-settings-layout-setup.cjs.
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

// Every setting that was on the page before the new layout
const ROWS = ["UI Scale", "Card Size", "Full Screen", "Open in a Window", "Reduce Animations", "Disable Blur Effects", "Home Banner", "Launch Animation", "Show Play Counts",
  "Seasonal Decorations", "Keep AURA Running When Closed", "Start AURA When Windows Starts", "Ringtone", "Message Sound", "Ringtone and Message Volume",
  "UI Sounds", "UI Sound Volume", "Trailer Volume", "Recording Screen", "Shortcuts", "Also Use F9 to Record", "Also Use F10 for the AURA Bar", "Recording Quality",
  "Microphone", "System Audio", "Mic Volume", "Game Volume", "Camera Preview", "Fetch Missing Cover Art", "Import Steam Games", "Import Epic Games", "Import Xbox Game Pass",
  "Count Games Started Outside AURA", "Games in Library", "Reset Library", "AURA Game Launcher", "Privacy", "Credits", "Feedback", "Developed by Taurrean Traylor"];

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
  const thrown = [];

  async function open({ width = 1440, height = 900, reducedMotion = "no-preference", fresh = true, ctx: reuse = null } = {}) {
    const ctx = reuse || await browser.newContext({ viewport: { width, height }, reducedMotion, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => thrown.push(String(e.message || e).split("\n")[0]));
    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());
    await page.addInitScript((fresh) => {
      try {
        if (fresh && !sessionStorage.getItem("__started")) {
          sessionStorage.setItem("__started", "1");
          localStorage.clear();
        }
        localStorage.setItem("aura_profile", JSON.stringify({ username: "tester", avatar: "", userId: "user-1" }));
      } catch {}
      window.__calls = [];
      const ok = (data) => Promise.resolve({ success: true, data });
      const account = { getSession: () => ok({ id: "user-1", email: "me@example.com" }), getMyProfile: () => ok({ username: "tester", avatar_url: null }) };
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (name === "auraCloud" && account[key]) ? account[key](...args) : ok(null)) });
      window.auraCloud = fake("auraCloud");
      window.auraSocial = fake("auraSocial");
      const sound = { success: true, supported: true, outputs: [{ id: "o1", name: "Speakers (Realtek)", inUse: true, volume: 0.6, muted: false }, { id: "o2", name: "Headset", inUse: false, volume: 0.4, muted: false }], inputs: [{ id: "i1", name: "Headset mic", inUse: true, volume: 0.7, muted: false }], prefs: { favs: [] }, hotkey: "Ctrl + Alt + S" };
      window.electronAPI = new Proxy({}, {
        get: (_t, key) => {
          if (key === "isElectron") return true;
          if (typeof key !== "string" || key === "then") return undefined;
          if (/^on[A-Z]/.test(key)) return () => () => {};
          if (/^remove/.test(key)) return () => {};
          if (key === "soundList") return () => { window.__calls.push("soundList"); return Promise.resolve(sound); };
          if (key === "getAudioDevices") return () => Promise.resolve({ success: true, devices: ["Stereo Mix (Realtek)", "Headset mic"] });
          if (key === "settingsSync") return (patch) => Promise.resolve(patch);
          return () => Promise.resolve({ success: false });
        },
      });
    }, fresh);
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(4000);
    await page.locator('.gm-rail-item[title="Settings"], .sb-item[title="Settings"]').first().click({ timeout: 5000 });
    await page.waitForTimeout(900);
    return { page, ctx };
  }
  const until = async (fn, ms = 4000) => { for (let t = 0; t < ms; t += 100) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
  const shot = async (page, name) => { if (process.env.AURA_SHOT_DIR) await page.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, name) }); };

  try {
    console.log("1. Everything is still there");
    let { page, ctx } = await open();
    const nav = page.getByRole("navigation", { name: "Settings categories" });
    const cats = await nav.locator(".set-nav-i").allInnerTexts();
    check("the sidebar lists the categories in order", cats.map((t) => t.trim()).join("|") === "Account|Appearance|Social & Calls|Notifications|Sound & Voice|Capture|Games & Library|Performance|Privacy|About", cats);
    const titles = await page.evaluate(() => [...document.querySelectorAll(".set-main .ss-t")].map((e) => e.textContent.trim()));
    const want = ["ACCOUNT", "DISPLAY", "SEASONAL DECORATIONS", "CALLS AND MESSAGES", "CALL AND MESSAGE ALERTS", "SOUND DEVICES", "SOUND", "RECORDING", "CAMERA", "LIBRARY", "PERFORMANCE", "PRIVACY", "ABOUT"];
    check("every section is there, in a sensible order", want.every((t, i) => titles.indexOf(t) >= 0 && (i === 0 || titles.indexOf(t) > titles.indexOf(want[i - 1]))), titles);
    const labels = await page.evaluate(() => [...document.querySelectorAll(".set-main .sr-l")].map((e) => (e.childNodes[0]?.textContent || e.textContent).trim()));
    const missing = ROWS.filter((r) => !labels.some((l) => l === r || l.startsWith(r)));
    check("every setting from before is still on the page", missing.length === 0, missing);
    check("the General / Sound devices tabs are gone (Sound devices is a group now)", (await page.locator(".snd-tabs").count()) === 0);
    check("Account shows who you are, with Edit profile and Log out", /Signed in as tester/.test(await page.locator(".set-cat[data-cat=account]").innerText()) && await page.locator(".set-cat[data-cat=account]").getByRole("button", { name: "Edit profile" }).isVisible() && await page.locator(".set-cat[data-cat=account]").getByRole("button", { name: "Log out", exact: true }).isVisible());
    await shot(page, "settings-top.png");

    console.log("2. The sidebar");
    const cur = () => page.evaluate(() => document.querySelector(".set-nav-i[aria-current=true]")?.dataset.nav);
    check("Account is highlighted to start with", (await cur()) === "account");
    await nav.getByRole("button", { name: "Capture" }).click();
    check("clicking Capture scrolls to it", await until(async () => page.evaluate(() => { const h = document.querySelector('.set-cat[data-cat=capture]'); const sc = h.closest(".sc"); return Math.abs(h.getBoundingClientRect().top - sc.getBoundingClientRect().top) < 40; })));
    check("...and highlights it", (await cur()) === "capture");
    check("...with the accent bar moved under it", await until(async () => page.evaluate(() => { const b = document.querySelector('.set-nav-i[data-nav=capture]'); const m = document.querySelector(".set-ind"); return !!m && Math.abs(new DOMMatrix(getComputedStyle(m).transform).m42 - b.offsetTop) < 1.5; })));
    check("...and its heading glows for a moment", await page.evaluate(() => document.querySelector('.set-cat[data-cat=capture] .set-cat-head').classList.contains("set-glow")));
    check("the sidebar stays in view while the page scrolls", await page.evaluate(() => { const r = document.querySelector(".set-side-in").getBoundingClientRect(); return r.top >= 0 && r.top < 140 && document.querySelector(".sc").scrollTop > 300; }));
    await shot(page, "settings-capture.png");
    await page.waitForTimeout(1000);
    await page.evaluate(() => document.querySelector('.set-cat[data-cat=library]').scrollIntoView({ block: "start" }));
    check("scrolling yourself moves the highlight too", await until(async () => (await cur()) === "library"), await cur());
    await page.evaluate(() => { const sc = document.querySelector(".sc"); sc.scrollTop = sc.scrollHeight; });
    check("at the bottom, About is highlighted", await until(async () => (await cur()) === "about"));
    await nav.getByRole("button", { name: "Appearance" }).focus();
    await page.keyboard.press("ArrowDown");
    check("arrow keys move along the categories", await page.evaluate(() => document.activeElement?.dataset?.nav === "social"));
    await page.keyboard.press("End");
    check("...End goes to the last", await page.evaluate(() => document.activeElement?.dataset?.nav === "about"));
    await page.keyboard.press("Home"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
    check("Enter opens that category, and the keyboard goes there", await until(async () => (await cur()) === "appearance") && await page.evaluate(() => document.activeElement?.id === "set-h-appearance"));

    console.log("3. Groups that fold away");
    const display = page.locator('.sg[data-sg=display]');
    const togDisplay = display.locator(".sg-tog");
    check("each group has a fold button that says what it does", (await togDisplay.getAttribute("aria-expanded")) === "true" && /DISPLAY: fold away/.test(await togDisplay.getAttribute("aria-label")));
    await togDisplay.click();
    check("folding hides its settings", await until(async () => !(await display.locator(".sr", { hasText: "UI Scale" }).isVisible())) && (await togDisplay.getAttribute("aria-expanded")) === "false");
    check("...its title stays", await display.locator(".ss-t").isVisible());
    check("...and it's remembered", await page.evaluate(() => JSON.parse(localStorage.getItem("aura_settings_groups") || "{}").display === false));
    await togDisplay.click();
    check("unfolding shows them again", await until(async () => display.locator(".sr", { hasText: "UI Scale" }).isVisible()));
    check("Sound devices starts folded, and doesn't ask Windows about devices until opened", (await page.locator('.sg[data-sg=sound-devices]').getAttribute("class")).includes("closed") && !(await page.evaluate(() => window.__calls.includes("soundList"))));

    console.log("4. Search");
    const box = page.getByRole("combobox", { name: "Search settings" });
    await box.fill("stereo");
    const results = page.getByRole("listbox", { name: "Matching settings" }).getByRole("option");
    check("finds a setting by its description (“stereo” → System Audio)", await until(async () => (await results.count()) >= 1 && /System Audio/.test(await results.first().innerText())));
    check("...saying where it is", /Capture › RECORDING/.test(await results.first().innerText()));
    await shot(page, "settings-search.png");
    await box.press("Enter");
    const sys = page.locator(".sr", { has: page.locator(".sr-l", { hasText: /^System Audio$/ }) });
    check("Enter goes to it and lights it up", await until(async () => (await sys.getAttribute("class")).includes("set-glow") && await sys.isVisible()));
    check("...with the keyboard on its control", await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "System audio for recordings"));
    check("...and it ends up in the middle of the page", await until(async () => page.evaluate(() => { const r = document.querySelector(".sr.set-glow")?.getBoundingClientRect(); const sc = document.querySelector(".sc").getBoundingClientRect(); return !!r && r.top > sc.top + 60 && r.bottom < sc.bottom - 60; })));
    await shot(page, "settings-found.png");
    await box.fill("fps");
    check("finds by related words too (“fps”)", await until(async () => { const t = (await results.allInnerTexts()).join("\n"); return /Recording Quality/.test(t) && /Disable Blur Effects/.test(t); }));
    await box.fill("");
    await page.locator('.sg[data-sg=performance] .sg-tog').click(); await page.waitForTimeout(400);
    await box.fill("blur");
    await until(async () => (await results.count()) >= 1);
    await results.filter({ hasText: "Disable Blur Effects" }).first().click();
    check("a setting in a folded group: the group opens and it's shown", await until(async () => (await page.locator('.sg[data-sg=performance]').getAttribute("class")) === "sg" && await page.locator(".sr", { hasText: "Disable Blur Effects" }).isVisible()));
    await box.fill("headset");
    await until(async () => /Sound devices/i.test(await results.first().innerText()));
    check("finds Sound devices even while it's folded", /Sound devices/i.test(await results.first().innerText()), await results.allInnerTexts());
    await results.first().click();
    check("...opening it shows your devices", await until(async () => page.getByText("Output · what you hear").isVisible()) && await page.evaluate(() => window.__calls.includes("soundList")), await page.evaluate(() => ({ cls: document.querySelector(".sg[data-sg=sound-devices]")?.className, html: (document.querySelector(".sg[data-sg=sound-devices] .sg-lazy")?.innerHTML || "").slice(0, 300), calls: window.__calls })));
    await shot(page, "settings-sound.png");
    await box.fill("zzqq");
    check("nothing found: it says so", await until(async () => /No settings match “zzqq”/.test(await page.locator(".set-find-pop").innerText())));
    await box.press("Escape");
    check("Esc clears the search", (await box.inputValue()) === "");
    await page.locator("body").click({ position: { x: 900, y: 20 } }).catch(() => {});
    await page.keyboard.press("Control+f");
    check("Ctrl + F goes to the search", await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Search settings"));

    console.log("5. Settings still work, by mouse and keyboard");
    const reduce = page.getByRole("switch", { name: "Reduce animations" });
    await reduce.focus(); await page.keyboard.press("Space");
    check("a switch flips with the keyboard, and keeps the keyboard", (await reduce.getAttribute("aria-checked")) === "true" && await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Reduce animations"));
    check("...and is saved under the same name as before", await page.evaluate(() => JSON.parse(localStorage.getItem("aura_settings") || "{}").reduceMotion === true));
    await page.keyboard.press("Space");
    await page.getByRole("switch", { name: "Home banner" }).click();
    check("clicking works the same", await page.evaluate(() => JSON.parse(localStorage.getItem("aura_settings") || "{}").homeBanner === false));
    await page.locator(".sr", { hasText: "Card Size" }).getByRole("button", { name: "Large" }).click();
    check("Card size: Large is chosen and saved", (await page.locator(".sr", { hasText: "Card Size" }).getByRole("button", { name: "Large" }).getAttribute("aria-pressed")) === "true" && await page.evaluate(() => JSON.parse(localStorage.getItem("aura_settings") || "{}").cardSize === "lg"));
    await page.locator(".set-cat[data-cat=account]").getByRole("button", { name: "Edit profile" }).click();
    check("Edit profile opens your profile", await until(async () => (await page.locator(".aura-delete-account, .modal input").count()) > 0));
    await page.keyboard.press("Escape").catch(() => {});
    await ctx.close();

    console.log("6. After restarting AURA");
    ({ page, ctx } = await open({ fresh: false, ctx: await browser.newContext({ viewport: { width: 1440, height: 900 } }) }));
    await page.evaluate(() => localStorage.setItem("aura_settings_groups", JSON.stringify({ camera: false })));
    await page.reload(); await page.waitForTimeout(4000);
    await page.locator('.gm-rail-item[title="Settings"], .sb-item[title="Settings"]').first().click(); await page.waitForTimeout(800);
    check("a folded group stays folded", (await page.locator('.sg[data-sg=camera]').getAttribute("class")).includes("closed"));
    await ctx.close();

    console.log("7. A smaller window");
    ({ page, ctx } = await open({ width: 900, height: 700 }));
    check("the categories go across the top", await page.evaluate(() => getComputedStyle(document.querySelector(".set-nav-list")).flexDirection === "row"));
    check("...and the page doesn't scroll sideways", await page.evaluate(() => { const sc = document.querySelector(".sc"); return sc.scrollWidth <= sc.clientWidth + 1; }));
    await page.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name: "Privacy" }).click();
    check("...and still take you there", await until(async () => page.evaluate(() => document.querySelector(".set-nav-i[aria-current=true]")?.dataset.nav === "privacy")));
    await shot(page, "settings-narrow.png");
    await ctx.close();

    console.log("8. Less motion");
    ({ page, ctx } = await open({ reducedMotion: "reduce" }));
    check("with reduced motion, the highlight and folding don't animate", await page.evaluate(() => getComputedStyle(document.querySelector(".set-ind")).transitionDuration.split(",").every((d) => parseFloat(d) === 0) && getComputedStyle(document.querySelector(".sg-chev")).transitionDuration.split(",").every((d) => parseFloat(d) === 0)));
    await ctx.close();

    check("no errors in the window", thrown.length === 0, thrown);
  } catch (e) {
    check("the test ran to the end", false, String(e?.stack || e).slice(0, 600));
  }
  await browser.close();
  server.close();
  done(failed ? 1 : 0);
})();
