// The Full Screen switch (and F11), and a theme made from your background picture.
// Part 1 checks how colors are picked; part 2 opens the built window (dist) in a real browser with
// a pretend desktop side. Added by aura-look-setup.cjs.
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff" };
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok || extra === undefined ? "" : "\n          " + (typeof extra === "string" ? extra : JSON.stringify(extra)))); };
const note = (text) => console.log("  note  " + text);
const done = (code) => { console.log(code === 0 ? "\nall passed" : code === 3 ? "\nskipped" : `\n${failed} FAILED`); process.exit(code); };

// A small picture: `parts` is [[r,g,b,share], ...] painted as stripes
function png(parts, size = 40) {
  const rows = [];
  let y = 0;
  const colorAt = (yy) => { let acc = 0; for (const p of parts) { acc += p[3]; if (yy < acc * size) return p; } return parts[parts.length - 1]; };
  for (y = 0; y < size; y++) { const c = colorAt(y); const row = Buffer.alloc(1 + size * 3); for (let x = 0; x < size; x++) { row[1 + x * 3] = c[0]; row[2 + x * 3] = c[1]; row[3 + x * 3] = c[2]; } rows.push(row); }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const file = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
  return "data:image/png;base64," + file.toString("base64");
}

(async () => {
  console.log("1. Picking colors from a picture");
  const src = fs.readFileSync(path.join(ROOT, "src", "components", "bgtheme.js"), "utf8");
  const B = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
  const px = (parts) => { const out = []; for (const [r, g, b, n] of parts) for (let i = 0; i < n; i++) out.push(r, g, b, 255); return out; };
  let colors = B.colorsFrom(px([[18, 24, 48, 700], [250, 120, 20, 200], [200, 200, 200, 100]]));
  check("the most used color comes first", colors[0] && B.toHsl(B.toRgb(colors[0].hex))[2] < 0.2, colors);
  check("the picture's bright orange is picked as the accent", (() => { const [h, s] = B.toHsl(B.toRgb(B.pickAccent(colors))); return h > 15 && h < 40 && s > 0.8; })(), B.pickAccent(colors));
  const theme = B.themeFrom(colors[0].hex, B.pickAccent(colors));
  const L = (h) => B.toHsl(B.toRgb(h))[2];
  const H = (h) => B.toHsl(B.toRgb(h))[0];
  check("the theme's background and panels are dark, tinted with the picture's main color", L(theme.bg) < 0.12 && L(theme.panel) < L(theme.bg) && L(theme.card) > L(theme.bg) && L(theme.hover) > L(theme.card) && Math.abs(H(theme.bg) - H(colors[0].hex)) < 12, theme);
  check("the accent is bright enough to read on them", L(theme.ac) > 0.5 && L(theme.ac2) > L(theme.ac), theme);
  const grey = B.colorsFrom(px([[40, 40, 40, 600], [180, 180, 180, 400]]));
  check("a black-and-white picture keeps a grey accent (no made-up color)", B.toHsl(B.toRgb(B.themeFrom(grey[0].hex, B.pickAccent(grey)).ac))[1] < 0.15, B.themeFrom(grey[0].hex, B.pickAccent(grey)));
  check("a see-through or empty picture gives no colors (and doesn't fail)", B.colorsFrom([0, 0, 0, 0]).length === 0 && B.colorsFrom([]).length === 0);
  check("bad colors are handled", !!B.themeFrom("nope", null).bg);

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
  const ORANGE_NAVY = png([[18, 24, 48, 0.7], [250, 120, 20, 0.2], [200, 200, 200, 0.1]]);
  const GREEN = png([[10, 30, 14, 0.75], [40, 220, 90, 0.25]]);
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    const thrown = [];
    page.on("pageerror", (e) => thrown.push(String(e.message || e).split("\n")[0]));
    await page.route((url) => !String(url).startsWith(base) && !String(url).startsWith("data:"), (route) => route.abort());
    await page.addInitScript((bg) => {
      try { localStorage.clear(); localStorage.setItem("aura_profile", JSON.stringify({ username: "tester", avatar: "", userId: "user-1" })); localStorage.setItem("aura_bg", bg); } catch {}
      window.__calls = [];
      const ok = (data) => Promise.resolve({ success: true, data });
      const account = { getSession: () => ok({ id: "user-1", email: "me@example.com" }), getMyProfile: () => ok({ username: "tester", avatar_url: null }) };
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (name === "auraCloud" && account[key]) ? account[key](...args) : ok(null)) });
      window.auraCloud = fake("auraCloud");
      window.auraSocial = fake("auraSocial");
      window.electronAPI = new Proxy({}, {
        get: (_t, key) => {
          if (key === "isElectron") return true;
          if (typeof key !== "string" || key === "then") return undefined;
          if (key === "onWindowModeChanged") return (cb) => { window.__modeChanged = cb; return () => {}; };
          if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};
          return (...args) => { window.__calls.push([key, args]); return Promise.resolve({ success: false }); };
        },
      });
    }, ORANGE_NAVY);
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(4500);
    const menu = async (name) => { await page.locator(`.gm-rail-item[title="${name}"], .sb-item[title="${name}"]`).first().click({ timeout: 5000 }); await page.waitForTimeout(500); };
    const synced = () => page.evaluate(() => window.__calls.filter(([k]) => k === "settingsSync").map(([, a]) => a[0].windowMode).filter(Boolean));

    console.log("3. Settings: Full Screen");
    await menu("Settings");
    const full = page.locator('[role="switch"][aria-label="Full screen"]');
    check("Settings has a Full Screen switch, with F11 shown beside it", (await full.count()) === 1 && /Full Screen\s*F11/.test(await page.locator(".sr", { has: full }).innerText()), await page.locator(".sr", { has: full }).innerText().catch(() => ""));
    check("it starts off (AURA opens maximized), with Open in a Window below it", (await full.getAttribute("aria-checked")) === "false" && (await page.locator('[role="switch"][aria-label="Open in a window"]').count()) === 1);
    await full.click();
    await page.waitForTimeout(300);
    check("switching it on makes AURA full screen", (await full.getAttribute("aria-checked")) === "true" && (await synced()).pop() === "fullscreen", await synced());
    check("and Open in a Window steps aside", (await page.locator('[role="switch"][aria-label="Open in a window"]').count()) === 0);
    await full.focus(); await page.keyboard.press(" ");
    await page.waitForTimeout(300);
    check("it works from the keyboard too: back to maximized", (await full.getAttribute("aria-checked")) === "false" && (await synced()).pop() === "maximized", await synced());
    await page.evaluate(() => window.__modeChanged && window.__modeChanged("fullscreen"));
    await page.waitForTimeout(300);
    check("pressing F11 (AURA's main side says so) flips the switch to match", (await full.getAttribute("aria-checked")) === "true");
    await page.evaluate(() => window.__modeChanged && window.__modeChanged("maximized"));
    await page.waitForTimeout(300);
    await page.locator('[role="switch"][aria-label="Open in a window"]').click();
    await page.waitForTimeout(300);
    check("Open in a Window still works", (await synced()).pop() === "windowed");

    console.log("4. Customize: a theme from your background");
    await menu("Customize");
    await page.getByText("🖼 BG").click();
    await page.locator(".bgt-dot").first().waitFor({ timeout: 8000 });
    const dots = await page.locator(".bgt-dot").evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
    check("the colors in the picture show as swatches", dots.length >= 2 && dots.some((c) => /rgb\(250, 120, 20\)|rgb\(2[45]\d, 1[12]\d, [12]\d\)/.test(c)), dots);
    const accentBefore = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ac").trim());
    await page.getByRole("button", { name: "Use These Colors" }).click();
    await page.waitForTimeout(500);
    const vars = () => page.evaluate(() => { const s = getComputedStyle(document.documentElement); return { ac: s.getPropertyValue("--ac").trim(), bg: s.getPropertyValue("--bg").trim(), theme: localStorage.getItem("aura_theme"), saved: localStorage.getItem("aura_custom_theme") }; });
    const hue = (h) => { const r = parseInt(h.slice(1, 3), 16) / 255, g = parseInt(h.slice(3, 5), 16) / 255, b = parseInt(h.slice(5, 7), 16) / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; let x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; x *= 60; return x < 0 ? x + 360 : x; };
    let v = await vars();
    check("Use These Colors: the accent becomes the picture's orange", /^#[0-9a-f]{6}$/i.test(v.ac) && hue(v.ac) > 15 && hue(v.ac) < 40 && v.ac !== accentBefore, v);
    check("and the background is a dark navy from the picture", /^#[0-9a-f]{6}$/i.test(v.bg) && hue(v.bg) > 200 && hue(v.bg) < 250, v);
    check("it's saved as your custom theme", v.theme === "custom" && /"ac"/.test(v.saved || ""), v);
    const second = await page.locator('.bgt-dot[aria-pressed="false"]').last().elementHandle();
    const secondColor = await second.evaluate((e) => getComputedStyle(e).backgroundColor);
    await second.click();
    await page.waitForTimeout(400);
    check("tapping another swatch builds the theme around that color instead", (await vars()).ac !== v.ac && (await second.getAttribute("aria-pressed")) === "true", { secondColor, now: await vars() });
    await page.locator(".bgt-auto .tog").click();
    await page.waitForTimeout(300);
    await page.locator('input[placeholder="https://... image URL"]').fill(GREEN);
    await page.getByRole("button", { name: "Apply Background" }).click();
    await page.waitForTimeout(1500);
    v = await vars();
    check("with Match on, a new background brings its own theme: green", hue(v.ac) > 110 && hue(v.ac) < 160 && hue(v.bg) > 100 && hue(v.bg) < 160, v);
    const kept = v.ac;
    await menu("Home"); await menu("Customize"); await page.getByText("🖼 BG").click(); await page.waitForTimeout(1200);
    check("coming back to Customize doesn't redo it (your own changes are kept)", (await vars()).ac === kept);
    await page.locator('input[placeholder="https://... image URL"]').fill("https://example.com/picture.jpg");
    await page.getByRole("button", { name: "Apply Background" }).click();
    await page.waitForTimeout(2500);
    check("a picture from a website that can't be read says so, and what to do", /can't read the colors[\s\S]*Browse/.test(await page.locator(".bgt").innerText().catch(() => "")), await page.locator(".bgt").innerText().catch(() => ""));
    check("and the theme stays as it was", (await vars()).ac === kept);
    check("nothing crashed", (await page.locator(".aura-fallback").count()) === 0 && thrown.filter((m) => !/reading 'live'/.test(m)).length === 0, thrown);
    if (process.env.AURA_SHOT) { await page.locator('input[placeholder="https://... image URL"]').fill(ORANGE_NAVY); await page.getByRole("button", { name: "Apply Background" }).click(); await page.waitForTimeout(1500); await page.screenshot({ path: process.env.AURA_SHOT }); }
  } finally {
    await browser.close();
    server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The look check itself broke:", e); process.exit(2); });
