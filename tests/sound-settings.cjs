// Settings > Sound devices: the tab, choosing devices, volume, favourites and Quick Switch, and the
// AURA bar's sound button. Opens the built window (dist) in a real browser, as AURA on Windows,
// with pretend sound devices.
// Added by aura-sound-devices-setup.cjs.
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

  const id = (n) => `{0.0.${n < 10 ? 0 : 1}.00000000}.{${String(n).padStart(8, "0")}-0000-0000-0000-000000000000}`;
  const DEVICES = {
    outputs: [
      { id: id(1), flow: "out", name: "Arctis Nova 7 Gen 2", detail: "Headphones", inUse: false, volume: 0.72, muted: false },
      { id: id(2), flow: "out", name: "IHTB138", detail: "Headphones", inUse: true, volume: 0.5, muted: false },
      { id: id(3), flow: "out", name: "ME6S", detail: "Speakers", inUse: false, volume: 1, muted: false },
      { id: id(4), flow: "out", name: "H27T27", detail: "NVIDIA High Definition Audio", inUse: false, volume: 1, muted: false },
    ],
    inputs: [
      { id: id(11), flow: "in", name: "Arctis Nova 7 Gen 2", detail: "Microphone", inUse: false, volume: 0.85, muted: false },
      { id: id(12), flow: "in", name: "HyperX Cloud Alpha S Chat", detail: "Microphone", inUse: true, volume: 0.6, muted: false },
    ],
  };
  async function open({ windows = true, hash = "", tab = null, favs = [] } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, userAgent: windows ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) aura Chrome/134.0 Electron/41.0 Safari/537.36" : "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) aura Chrome/134.0 Electron/41.0 Safari/537.36" }); // (a Linux PC, even when the test runs on Windows)
    const page = await ctx.newPage();
    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());
    await page.addInitScript(({ DEVICES, tab, favs }) => {
      try { localStorage.clear(); localStorage.setItem("aura_profile", JSON.stringify({ username: "tctray", avatar: "", userId: "user-1" })); if (tab) localStorage.setItem("aura_settings_tab", tab); } catch {}
      window.__calls = [];
      const ok = (data) => Promise.resolve({ success: true, data });
      const answers = { getSession: () => ok({ id: "user-1", email: "me@example.com" }), getMyProfile: () => ok({ username: "tctray", avatar_url: null }) };
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => { window.__calls.push([name + "." + String(key), args]); if (/^on[A-Z]/.test(String(key))) return () => {}; return (name === "auraCloud" && answers[key]) ? answers[key](...args) : ok(null); }) });
      window.auraCloud = fake("auraCloud");
      window.auraSocial = fake("auraSocial");
      // The sound part of AURA's bridge; everything else answers "nothing"
      const state = { ...JSON.parse(JSON.stringify(DEVICES)), prefs: { favs, hotkey: true, bar: true, autoHeadset: false }, hotkey: "Ctrl + Alt + S", hotkeyBusy: false };
      window.__sound = state;
      const list = () => ({ success: true, supported: true, ...JSON.parse(JSON.stringify(state)) });
      const sound = {
        soundList: async () => list(),
        soundUse: async (id) => { const d = [...state.outputs, ...state.inputs].find((x) => x.id === id); if (!d) return { success: false, error: "That device isn't connected." }; (d.flow === "out" ? state.outputs : state.inputs).forEach((x) => { x.inUse = x.id === id; }); return list(); },
        soundVolume: async (id, v) => { [...state.outputs, ...state.inputs].find((x) => x.id === id).volume = v; return { success: true }; },
        soundMute: async (id, m) => { [...state.outputs, ...state.inputs].find((x) => x.id === id).muted = m; return { success: true }; },
        soundPrefs: async (patch) => { Object.assign(state.prefs, patch); return { success: true, prefs: state.prefs, hotkeyBusy: false }; },
        soundQuickSwitch: async () => { const f = state.prefs.favs; if (!f.length) return { success: false, error: "Star one or two devices in Settings > Sound devices first." }; const cur = state.outputs.find((x) => x.inUse).id; const t = f.length > 1 && cur === f[0].output ? f[1] : f[0]; state.outputs.forEach((x) => { x.inUse = x.id === t.output; }); return { success: true, name: t.outputName }; },
        soundOpenWindows: async () => ({ success: true }),
        barGetState: async () => ({ recording: false, game: "Madden 27", hotkey: "Alt+Shift+R", sound: { show: state.prefs.favs.length > 0, hotkey: "Ctrl + Alt + S" } }),
      };
      window.electronAPI = new Proxy({}, { get: (_t, key) => {
        if (key in sound) return (...args) => { window.__calls.push(["electronAPI." + String(key), args]); return sound[key](...args); };
        if (key === "isElectron" || key === "then") return undefined;
        return (...args) => { if (/^on[A-Z]/.test(String(key))) return () => {}; return Promise.resolve(null); };
      } });
    }, { DEVICES, tab, favs });
    await page.goto(base + "/index.html" + hash, { waitUntil: "load" });
    await page.waitForTimeout(3500);
    return page;
  }
  const toSettings = async (page) => {
    await page.locator('[title="Settings"], .gm-rail-item:has-text("Settings"), .sb-item:has-text("Settings")').first().click();
    await page.waitForTimeout(600);
  };
  const soundCalls = (page, k) => page.evaluate((k) => window.__calls.filter(([n]) => n === "electronAPI." + k).map(([, a]) => a), k);
  let page;
  try {
    console.log("1. The tab");
    page = await open();
    await toSettings(page);
    const tabs = page.locator('[role="tablist"][aria-label="Settings"]');
    check("Settings has General and Sound devices tabs at the top", await tabs.isVisible() && (await tabs.locator('[role="tab"]').allInnerTexts()).join("|") === "General|Sound devices");
    check("General is open first, with the usual settings", (await tabs.locator('[aria-selected="true"]').innerText()) === "General" && await page.getByText("UI Scale").isVisible());
    await tabs.getByText("Sound devices").click();
    await page.waitForTimeout(500);
    check("Sound devices shows what you hear and your mics, not the general settings", await page.getByText("Output · what you hear").isVisible() && await page.getByText("Input · your mic").isVisible() && !(await page.getByText("UI Scale").isVisible()));
    const outRows = page.locator(".snd-dev");
    check("every device is listed by name", (await outRows.count()) === 6 && /Arctis Nova 7 Gen 2/.test(await outRows.first().innerText()));
    check("the one in use is marked", /In use/.test(await page.locator(".snd-dev.on").first().innerText()) && /IHTB138/.test(await page.locator(".snd-dev.on").first().innerText()));

    console.log("2. Choosing");
    await page.getByRole("button", { name: "Use Arctis Nova 7 Gen 2" }).first().click();
    await page.waitForTimeout(400);
    check("clicking a device switches to it", JSON.stringify(await soundCalls(page, "soundUse")) === JSON.stringify([[id(1)]]) && /Arctis Nova 7 Gen 2/.test(await page.locator(".snd-dev.on").first().innerText()));
    check("its volume is shown", (await page.getByLabel("Volume for Arctis Nova 7 Gen 2").inputValue()) === "0.72");
    await page.getByLabel("Volume for Arctis Nova 7 Gen 2").fill("0.3");
    await page.waitForTimeout(400);
    check("moving the slider sets the volume", (await soundCalls(page, "soundVolume")).some(([d, v]) => d === id(1) && Math.abs(v - 0.3) < 0.001));
    await page.getByRole("button", { name: "Mute HyperX Cloud Alpha S Chat" }).click();
    await page.waitForTimeout(300);
    check("the mic can be muted", JSON.stringify(await soundCalls(page, "soundMute")) === JSON.stringify([[id(12), true]]));

    console.log("3. Quick Switch");
    check("with no favourites, it says how to set it up", await page.getByText("Star one or two devices under Output").isVisible());
    await page.getByRole("button", { name: "Add Arctis Nova 7 Gen 2 to Quick Switch" }).click();
    await page.getByRole("button", { name: "Add ME6S to Quick Switch" }).click();
    await page.waitForTimeout(400);
    let favs = await page.evaluate(() => window.__sound.prefs.favs.map((f) => f.outputName));
    check("starring two devices makes them the favourites", JSON.stringify(favs) === '["Arctis Nova 7 Gen 2","ME6S"]', favs);
    check("...shown side by side, with the one in use marked", (await page.locator(".snd-fav").count()) === 2 && /In use/.test(await page.locator(".snd-fav.on").innerText()));
    await page.getByLabel("Mic with ME6S").selectOption(id(12));
    await page.waitForTimeout(300);
    check("each favourite can bring its own mic", await page.evaluate((m) => window.__sound.prefs.favs[1].input === m, id(12)));
    await page.getByRole("button", { name: "Add IHTB138 to Quick Switch" }).click();
    await page.waitForTimeout(300);
    favs = await page.evaluate(() => window.__sound.prefs.favs.map((f) => f.outputName));
    check("a third star replaces the oldest", JSON.stringify(favs) === '["ME6S","IHTB138"]', favs);
    await page.getByRole("button", { name: "Switch to ME6S" }).click();
    await page.waitForTimeout(500);
    check("clicking a favourite switches to it, mic too", (await soundCalls(page, "soundUse")).slice(-2).map((a) => a[0]).join() === [id(3), id(12)].join());
    await page.getByRole("switch", { name: "Use my headset when a game starts" }).click();
    await page.waitForTimeout(300);
    check("the automatic options are switches that save", await page.evaluate(() => window.__sound.prefs.autoHeadset === true));
    check("the shortcut is shown", await page.locator(".snd-key").first().innerText() === "Ctrl + Alt + S");

    console.log("4. Remembered");
    await page.context().close();
    page = await open({ tab: "sound" });
    await toSettings(page);
    check("Settings opens on the tab you used last", await page.getByText("Output · what you hear").isVisible());
    await page.context().close();
    page = await open({ windows: false, tab: "sound" });
    await toSettings(page);
    check("not on Windows: no tabs, just the usual settings", !(await page.locator('[role="tablist"][aria-label="Settings"]').isVisible()) && await page.getByText("UI Scale").isVisible());
    await page.context().close();

    console.log("5. The AURA bar");
    page = await open({ hash: "#aurabar" });
    check("with no favourites, the bar has no sound button", (await page.getByRole("button", { name: "Switch sound device" }).count()) === 0);
    await page.context().close();
    page = await open({ hash: "#aurabar", favs: [{ output: id(1), outputName: "Arctis Nova 7 Gen 2" }, { output: id(3), outputName: "ME6S" }] });
    const btn = page.getByRole("button", { name: "Switch sound device" });
    check("with favourites, it has one", await btn.isVisible());
    await btn.click(); await page.waitForTimeout(300);
    check("pressing it switches, and the bar says to what", /Sound: /.test(await page.locator("body").innerText()));
    // The bar window is 700 wide: the strip's contents must fit in it
    const need = await page.evaluate(() => { const strip = document.querySelector(".ab-btn")?.parentElement?.parentElement; return strip ? [...strip.children].reduce((w, c) => w + c.getBoundingClientRect().width, 0) : 9999; });
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, clip: { x: 0, y: 0, width: 760, height: 80 } });
    check("everything still fits on the bar", need <= 700, need);
  } catch (e) {
    check("the test ran to the end", false, String(e?.message || e).slice(0, 400));
  }
  await browser.close();
  server.close();
  done(failed ? 1 : 0);
})();
