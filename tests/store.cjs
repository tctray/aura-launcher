// The Microsoft Store version: the package settings (your Partner Center identity, permissions, a
// startup entry that's off until you switch it on, tiles), the GitHub job that builds and checks it,
// what AURA does differently in it, and Settings in both versions. Added by aura-store-setup.cjs.
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
  console.log("1. The Store package settings");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const ax = pkg.build.appx || {};
  check("your Partner Center identity", ax.identityName === "TraylorDigital.AuraGamingHub" && ax.publisher === "CN=E6B56AB7-1B45-4740-A412-E234538BDD63" && ax.publisherDisplayName === "Traylor Digital", ax);
  check("named Aura Gaming Hub", ax.displayName === "Aura Gaming Hub");
  check("asks Windows for the microphone and camera (calls, voice, clips) and the network", ["runFullTrust", "internetClient", "microphone", "webcam"].every((c) => (ax.capabilities || []).includes(c)));
  check("there's a command to build it", /electron-builder --win appx --publish always/.test(pkg.scripts["electron:build:store"] || ""));
  check("the normal installer is still built the same way", pkg.build.win.target === "nsis" && /electron-builder --publish always$/.test(pkg.scripts["electron:build"]));
  const ext = fs.readFileSync(path.join(ROOT, ax.customExtensionsPath || "build/appx-extensions.xml"), "utf8");
  check("Start with Windows is a Windows startup entry, off until you switch it on", /windows\.startupTask/.test(ext) && /Enabled="false"/.test(ext) && !/Enabled="true"/.test(ext) && ax.addAutoLaunchExtension === false);
  check("...pointing at AURA's program", ext.includes(`Executable="app\\${pkg.build.productName}.exe"`));
  let sizesOk = true; const sizes = { "StoreLogo.png": [50, 50], "Square44x44Logo.png": [44, 44], "Square150x150Logo.png": [150, 150], "Wide310x150Logo.png": [310, 150], "LargeTile.png": [310, 310], "SmallTile.png": [71, 71], "SplashScreen.png": [620, 300] };
  for (const [f, [w, h]] of Object.entries(sizes)) { try { const b = fs.readFileSync(path.join(ROOT, "build", "appx", f)); if (b.readUInt32BE(16) !== w || b.readUInt32BE(20) !== h) sizesOk = false; } catch { sizesOk = false; } }
  check("the tile and icon pictures Windows needs, in the right sizes", sizesOk);
  const flow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "build.yml"), "utf8").replace(/\r\n/g, "\n");
  const job = (/\n  build-store:\n([\s\S]*?)(?=\n  [a-z-]+:\n|$)/.exec(flow) || [])[1] || "";
  check("GitHub builds it after the Windows installer, on its own", /needs: \[build-windows\]/.test(job) && /npm run electron:build:store/.test(job) && /npm ci\b/.test(job));
  check("...and checks inside it: identity, permissions, startup entry, notices", /TraylorDigital\.AuraGamingHub/.test(job) && /E6B56AB7-1B45-4740-A412-E234538BDD63/.test(job) && /Enabled="false"/.test(job) && /THIRD-PARTY-NOTICES\.md/.test(job));

  console.log("2. What the Store version does differently");
  const main = fs.readFileSync(path.join(ROOT, "electron", "main.js"), "utf8");
  check("no GitHub updates: the Store keeps it up to date", /function setupAutoUpdater\(win\) \{\n  if \(!app\.isPackaged\) return;\n  if \(process\.windowsStore\) return;/.test(main) && /if \(process\.windowsStore\) return \{ success: true, store: true, hasUpdate: false/.test(main));
  check("...the update button opens AURA's Store page", /const STORE_PAGE = "ms-windows-store:\/\/pdp\/\?productid=" \+ STORE_ID;/.test(main) && /const STORE_ID = "9N7JVRJDPSPX";/.test(main) && /if \(process\.windowsStore\) \{ shell\.openExternal\(STORE_PAGE\)/.test(main));
  check("...so it never downloads or installs a GitHub update", /ipcMain\.handle\("download-update", async \(\) => \{\n[^\n]*\n    if \(process\.windowsStore\) \{ shell\.openExternal\(STORE_PAGE\); return \{ success: false, store: true/.test(main));
  check("Start with Windows is left to Windows Settings", /if \(process\.windowsStore\) return; \/\/ the Store version starts with Windows/.test(main) && /ms-settings:startupapps/.test(main));
  check("clips never go in the app's data folder (Windows deletes it on uninstall)", /if \(process\.windowsStore\) \{ try \{ return path\.join\(app\.getPath\("videos"\), "AURA"\);/.test(main));
  const policy = fs.readFileSync(path.join(ROOT, "PRIVACY.md"), "utf8");
  check("the privacy policy says the Store version is updated by the Store", /The Microsoft Store version doesn't: the Microsoft Store keeps it up to date\./.test(policy));

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

  async function open(store) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) aura Chrome/134.0 Electron/44.0 Safari/537.36" });
    const page = await ctx.newPage();
    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());
    await page.addInitScript((store) => {
      try { localStorage.clear(); localStorage.setItem("aura_profile", JSON.stringify({ username: "tctray", avatar: "", userId: "user-1" })); } catch {}
      window.__calls = [];
      const ok = (data) => Promise.resolve({ success: true, data });
      const answers = { getSession: () => ok({ id: "user-1", email: "me@example.com" }), getMyProfile: () => ok({ username: "tctray", avatar_url: null }) };
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (/^on[A-Z]/.test(String(key)) ? () => {} : name === "auraCloud" && answers[key] ? answers[key]() : ok(null))) });
      window.auraCloud = fake("auraCloud"); window.auraSocial = fake("auraSocial");
      const api = {
        isElectron: true,
        storeInfo: async () => ({ store, storeId: "9N7JVRJDPSPX" }),
        checkUpdate: async () => (store ? { success: true, store: true, hasUpdate: false } : { success: true, latest: "1.36.2", current: "1.36.2", hasUpdate: false }),
        downloadUpdate: async () => { window.__calls.push("downloadUpdate"); return { success: false, store: true, openedPage: true }; },
        openStartupSettings: async () => { window.__calls.push("openStartupSettings"); return { success: true }; },
      };
      window.electronAPI = new Proxy({}, { get: (_t, key) => (key in api ? api[key] : key === "then" ? undefined : (...args) => (/^on[A-Z]/.test(String(key)) ? () => {} : Promise.resolve(null))) });
    }, store);
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(3000);
    await page.locator('.gm-rail-item[title="Settings"], .sb-item[title="Settings"]').first().click(); await page.waitForTimeout(800);
    return page;
  }
  let page;
  try {
    console.log("3. Settings in each version");
    page = await open(true);
    const startRow = page.locator(".sr", { hasText: "Start AURA When Windows Starts" });
    check("Store version: Start with Windows explains where to switch it on", /Windows Settings > Apps > Startup/.test(await startRow.innerText()) && (await startRow.locator(".tog").count()) === 0);
    await startRow.getByRole("button", { name: "Open Startup settings" }).click(); await page.waitForTimeout(200);
    check("...and opens Windows' Startup settings", (await page.evaluate(() => window.__calls)).includes("openStartupSettings"));
    const upd = page.getByRole("button", { name: "Check in the Microsoft Store" });
    check("Store version: updates point to the Microsoft Store", await upd.isVisible());
    await upd.click(); await page.waitForTimeout(200);
    check("...which opens AURA's Store page", (await page.evaluate(() => window.__calls)).includes("downloadUpdate"));
    if (process.env.AURA_SHOT_DIR) await page.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "store-settings.png") });
    await page.context().close();
    page = await open(false);
    const row2 = page.locator(".sr", { hasText: "Start AURA When Windows Starts" });
    check("GitHub version: everything as before (the switch, and Up to date)", (await row2.locator(".tog").count()) === 1 && !(await row2.getByRole("button", { name: "Open Startup settings" }).count()) && !(await page.getByRole("button", { name: "Check in the Microsoft Store" }).count()) && await page.getByText("Up to date").isVisible());
  } catch (e) {
    check("the test ran to the end", false, String(e?.message || e).slice(0, 400));
  }
  await browser.close();
  server.close();
  done(failed ? 1 : 0);
})();
