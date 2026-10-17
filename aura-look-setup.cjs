#!/usr/bin/env node
/**
 * AURA — a Full Screen switch, and a theme from your background
 *
 *   - Settings > Display: "Full Screen" is now a switch, with F11 shown beside it. F11 switches
 *     between full screen and maximized anytime, and the switch follows. "Open in a Window" (off:
 *     maximized) shows while full screen is off. Leaving a full-screen video or shared screen
 *     keeps AURA full screen if that's how you set it.
 *   - Customize > BG: AURA reads the colors in your background picture and shows them as
 *     swatches. "Use These Colors" builds a theme from the picture: dark panels tinted with its
 *     main color, and its brightest color as the accent. Tap a swatch to build around that color
 *     instead. "Match my theme to new backgrounds" does it by itself whenever you pick a new
 *     background. The result is your custom theme, so it syncs and can be saved like any other.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-look-setup.cjs
 *
 * What it does:
 *   - creates  src/components/bgtheme.js   reads colors from a picture, builds a theme
 *   - edits    src/App.jsx                  the switch in Settings, the swatches in Customize
 *   - edits    electron/main.js             F11, and keeping full screen after a video
 *   - edits    electron/preload.js          tells the window when F11 was pressed
 *   - creates  tests/look.cjs               (only if AURA's checks are installed) checks it
 *
 * Every file it changes is copied to <name>.before-look.bak first.
 * To put everything back:                 node aura-look-setup.cjs --undo
 * To preview without changing anything:   node aura-look-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FILES = {"bgtheme":"// A theme made from your background picture: the picture's main colour tints AURA's panels and\n// cards, and its brightest colour becomes the accent. Added by aura-look-setup.cjs\n//\n//   colorsFrom(pixels)          the picture's colours, most used first (pixels: RGBA bytes)\n//   themeFrom(base, accent)     { bg, panel, card, hover, ac, ac2 } for AURA's custom theme\n//   readPicture(src)            loads a picture and answers its colours (in the window)\n\nconst clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));\nexport const hex = (r, g, b) => \"#\" + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, \"0\")).join(\"\");\nexport function toRgb(h) {\n  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || \"\"));\n  if (!m) return null;\n  const n = parseInt(m[1], 16);\n  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];\n}\nexport function toHsl([r, g, b]) {\n  r /= 255; g /= 255; b /= 255;\n  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;\n  if (!d) return [0, 0, l];\n  const s = d / (1 - Math.abs(2 * l - 1));\n  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;\n  h *= 60; if (h < 0) h += 360;\n  return [h, s, l];\n}\nexport function fromHsl(h, s, l) {\n  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;\n  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];\n  return hex((r + m) * 255, (g + m) * 255, (b + m) * 255);\n}\n\n// The picture's colours: similar shades grouped together, most used first. Each answer is\n// { hex, share, vivid } where vivid says how colourful it is (0 grey to 1 bright).\nexport function colorsFrom(pixels, max = 6) {\n  const buckets = new Map();\n  let total = 0;\n  for (let i = 0; i + 3 < pixels.length; i += 4) {\n    if (pixels[i + 3] < 128) continue; // see-through\n    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];\n    const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4); // 16 steps a channel\n    const k = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };\n    k.r += r; k.g += g; k.b += b; k.n++;\n    buckets.set(key, k);\n    total++;\n  }\n  if (!total) return [];\n  const all = [...buckets.values()].map((k) => {\n    const rgb = [k.r / k.n, k.g / k.n, k.b / k.n];\n    const [, s, l] = toHsl(rgb);\n    return { rgb, share: k.n / total, vivid: s * (1 - Math.abs(2 * l - 1)) };\n  }).sort((a, b) => b.share - a.share);\n  // Keep colours that look different from the ones already kept\n  const kept = [];\n  const far = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 48;\n  for (const c of all) {\n    if (kept.every((k) => far(k.rgb, c.rgb))) kept.push(c);\n    if (kept.length >= max * 3) break;\n  }\n  return kept.slice(0, max).map((c) => ({ hex: hex(...c.rgb), share: Math.round(c.share * 1000) / 1000, vivid: Math.round(c.vivid * 100) / 100 }));\n}\n\n// The colour to build the theme around: the most colourful one that's used a fair amount,\n// or the most used one if the picture is mostly grey\nexport function pickAccent(colors) {\n  const list = Array.isArray(colors) ? colors : [];\n  const lively = list.filter((c) => c.vivid >= 0.18 && c.share >= 0.01);\n  if (lively.length) return lively.sort((a, b) => b.vivid * Math.sqrt(b.share) - a.vivid * Math.sqrt(a.share))[0].hex;\n  return list[0]?.hex || \"#FF5722\";\n}\n\n// AURA's colours from the picture: dark panels tinted with the picture's main colour, and an\n// accent bright enough to read on them\nexport function themeFrom(baseHex, accentHex) {\n  const base = toRgb(baseHex) || [34, 40, 49];\n  const acc = toRgb(accentHex) || base;\n  const [bh, bs] = toHsl(base);\n  const [ah, as] = toHsl(acc);\n  const tint = clamp(bs, 0.12, 0.4);\n  const accentSat = as < 0.12 ? as : clamp(as, 0.55, 0.9); // a grey picture keeps a grey accent\n  return {\n    bg: fromHsl(bh, tint, 0.09),\n    panel: fromHsl(bh, tint, 0.065),\n    card: fromHsl(bh, tint * 0.9, 0.15),\n    hover: fromHsl(bh, tint * 0.9, 0.2),\n    ac: fromHsl(ah, accentSat, 0.56),\n    ac2: fromHsl((ah + 18) % 360, accentSat, 0.7),\n  };\n}\n\n// Load the picture and read its colours (in the window). A picture from a website that doesn't\n// allow it can't be read, and answers null.\nexport function readPicture(src) {\n  return new Promise((resolve) => {\n    if (!src || typeof document === \"undefined\") return resolve(null);\n    const img = new Image();\n    if (!/^data:/i.test(src)) img.crossOrigin = \"anonymous\";\n    const done = (v) => { img.onload = img.onerror = null; resolve(v); };\n    const timer = setTimeout(() => done(null), 8000);\n    img.onload = () => {\n      clearTimeout(timer);\n      try {\n        const size = 64;\n        const c = document.createElement(\"canvas\");\n        c.width = size; c.height = size;\n        const ctx = c.getContext(\"2d\", { willReadFrequently: true });\n        ctx.drawImage(img, 0, 0, size, size);\n        done(colorsFrom(ctx.getImageData(0, 0, size, size).data));\n      } catch { done(null); }\n    };\n    img.onerror = () => { clearTimeout(timer); done(null); };\n    img.src = src;\n  });\n}\n","test":"// The Full Screen switch (and F11), and a theme made from your background picture.\n// Part 1 checks how colors are picked; part 2 opens the built window (dist) in a real browser with\n// a pretend desktop side. Added by aura-look-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\nconst zlib = require(\"zlib\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\n\n// A small picture: `parts` is [[r,g,b,share], ...] painted as stripes\nfunction png(parts, size = 40) {\n  const rows = [];\n  let y = 0;\n  const colorAt = (yy) => { let acc = 0; for (const p of parts) { acc += p[3]; if (yy < acc * size) return p; } return parts[parts.length - 1]; };\n  for (y = 0; y < size; y++) { const c = colorAt(y); const row = Buffer.alloc(1 + size * 3); for (let x = 0; x < size; x++) { row[1 + x * 3] = c[0]; row[2 + x * 3] = c[1]; row[3 + x * 3] = c[2]; } rows.push(row); }\n  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });\n  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };\n  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };\n  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;\n  const file = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk(\"IHDR\", ihdr), chunk(\"IDAT\", zlib.deflateSync(Buffer.concat(rows))), chunk(\"IEND\", Buffer.alloc(0))]);\n  return \"data:image/png;base64,\" + file.toString(\"base64\");\n}\n\n(async () => {\n  console.log(\"1. Picking colors from a picture\");\n  const src = fs.readFileSync(path.join(ROOT, \"src\", \"components\", \"bgtheme.js\"), \"utf8\");\n  const B = await import(\"data:text/javascript;base64,\" + Buffer.from(src).toString(\"base64\"));\n  const px = (parts) => { const out = []; for (const [r, g, b, n] of parts) for (let i = 0; i < n; i++) out.push(r, g, b, 255); return out; };\n  let colors = B.colorsFrom(px([[18, 24, 48, 700], [250, 120, 20, 200], [200, 200, 200, 100]]));\n  check(\"the most used color comes first\", colors[0] && B.toHsl(B.toRgb(colors[0].hex))[2] < 0.2, colors);\n  check(\"the picture's bright orange is picked as the accent\", (() => { const [h, s] = B.toHsl(B.toRgb(B.pickAccent(colors))); return h > 15 && h < 40 && s > 0.8; })(), B.pickAccent(colors));\n  const theme = B.themeFrom(colors[0].hex, B.pickAccent(colors));\n  const L = (h) => B.toHsl(B.toRgb(h))[2];\n  const H = (h) => B.toHsl(B.toRgb(h))[0];\n  check(\"the theme's background and panels are dark, tinted with the picture's main color\", L(theme.bg) < 0.12 && L(theme.panel) < L(theme.bg) && L(theme.card) > L(theme.bg) && L(theme.hover) > L(theme.card) && Math.abs(H(theme.bg) - H(colors[0].hex)) < 12, theme);\n  check(\"the accent is bright enough to read on them\", L(theme.ac) > 0.5 && L(theme.ac2) > L(theme.ac), theme);\n  const grey = B.colorsFrom(px([[40, 40, 40, 600], [180, 180, 180, 400]]));\n  check(\"a black-and-white picture keeps a grey accent (no made-up color)\", B.toHsl(B.toRgb(B.themeFrom(grey[0].hex, B.pickAccent(grey)).ac))[1] < 0.15, B.themeFrom(grey[0].hex, B.pickAccent(grey)));\n  check(\"a see-through or empty picture gives no colors (and doesn't fail)\", B.colorsFrom([0, 0, 0, 0]).length === 0 && B.colorsFrom([]).length === 0);\n  check(\"bad colors are handled\", !!B.themeFrom(\"nope\", null).bg);\n\n  console.log(\"2. In the window\");\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(failed ? 1 : process.env.CI ? 1 : 3); }\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch(options); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with.\"); return done(failed ? 1 : process.env.CI ? 1 : 3); }\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(DIST, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" }); res.end(data); });\n  });\n  await new Promise((r) => server.listen(0, \"127.0.0.1\", r));\n  const base = \"http://127.0.0.1:\" + server.address().port;\n  const ORANGE_NAVY = png([[18, 24, 48, 0.7], [250, 120, 20, 0.2], [200, 200, 200, 0.1]]);\n  const GREEN = png([[10, 30, 14, 0.75], [40, 220, 90, 0.25]]);\n  try {\n    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();\n    const thrown = [];\n    page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n    await page.route((url) => !String(url).startsWith(base) && !String(url).startsWith(\"data:\"), (route) => route.abort());\n    await page.addInitScript((bg) => {\n      try { localStorage.clear(); localStorage.setItem(\"aura_profile\", JSON.stringify({ username: \"tester\", avatar: \"\", userId: \"user-1\" })); localStorage.setItem(\"aura_bg\", bg); } catch {}\n      window.__calls = [];\n      const ok = (data) => Promise.resolve({ success: true, data });\n      const account = { getSession: () => ok({ id: \"user-1\", email: \"me@example.com\" }), getMyProfile: () => ok({ username: \"tester\", avatar_url: null }) };\n      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => (name === \"auraCloud\" && account[key]) ? account[key](...args) : ok(null)) });\n      window.auraCloud = fake(\"auraCloud\");\n      window.auraSocial = fake(\"auraSocial\");\n      window.electronAPI = new Proxy({}, {\n        get: (_t, key) => {\n          if (key === \"isElectron\") return true;\n          if (typeof key !== \"string\" || key === \"then\") return undefined;\n          if (key === \"onWindowModeChanged\") return (cb) => { window.__modeChanged = cb; return () => {}; };\n          if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};\n          return (...args) => { window.__calls.push([key, args]); return Promise.resolve({ success: false }); };\n        },\n      });\n    }, ORANGE_NAVY);\n    await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n    await page.waitForTimeout(4500);\n    const menu = async (name) => { await page.locator(`.gm-rail-item[title=\"${name}\"], .sb-item[title=\"${name}\"]`).first().click({ timeout: 5000 }); await page.waitForTimeout(500); };\n    const synced = () => page.evaluate(() => window.__calls.filter(([k]) => k === \"settingsSync\").map(([, a]) => a[0].windowMode).filter(Boolean));\n\n    console.log(\"3. Settings: Full Screen\");\n    await menu(\"Settings\");\n    const full = page.locator('[role=\"switch\"][aria-label=\"Full screen\"]');\n    check(\"Settings has a Full Screen switch, with F11 shown beside it\", (await full.count()) === 1 && /Full Screen\\s*F11/.test(await page.locator(\".sr\", { has: full }).innerText()), await page.locator(\".sr\", { has: full }).innerText().catch(() => \"\"));\n    check(\"it starts off (AURA opens maximized), with Open in a Window below it\", (await full.getAttribute(\"aria-checked\")) === \"false\" && (await page.locator('[role=\"switch\"][aria-label=\"Open in a window\"]').count()) === 1);\n    await full.click();\n    await page.waitForTimeout(300);\n    check(\"switching it on makes AURA full screen\", (await full.getAttribute(\"aria-checked\")) === \"true\" && (await synced()).pop() === \"fullscreen\", await synced());\n    check(\"and Open in a Window steps aside\", (await page.locator('[role=\"switch\"][aria-label=\"Open in a window\"]').count()) === 0);\n    await full.focus(); await page.keyboard.press(\" \");\n    await page.waitForTimeout(300);\n    check(\"it works from the keyboard too: back to maximized\", (await full.getAttribute(\"aria-checked\")) === \"false\" && (await synced()).pop() === \"maximized\", await synced());\n    await page.evaluate(() => window.__modeChanged && window.__modeChanged(\"fullscreen\"));\n    await page.waitForTimeout(300);\n    check(\"pressing F11 (AURA's main side says so) flips the switch to match\", (await full.getAttribute(\"aria-checked\")) === \"true\");\n    await page.evaluate(() => window.__modeChanged && window.__modeChanged(\"maximized\"));\n    await page.waitForTimeout(300);\n    await page.locator('[role=\"switch\"][aria-label=\"Open in a window\"]').click();\n    await page.waitForTimeout(300);\n    check(\"Open in a Window still works\", (await synced()).pop() === \"windowed\");\n\n    console.log(\"4. Customize: a theme from your background\");\n    await menu(\"Customize\");\n    await page.getByText(\"🖼 BG\").click();\n    await page.locator(\".bgt-dot\").first().waitFor({ timeout: 8000 });\n    const dots = await page.locator(\".bgt-dot\").evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));\n    check(\"the colors in the picture show as swatches\", dots.length >= 2 && dots.some((c) => /rgb\\(250, 120, 20\\)|rgb\\(2[45]\\d, 1[12]\\d, [12]\\d\\)/.test(c)), dots);\n    const accentBefore = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue(\"--ac\").trim());\n    await page.getByRole(\"button\", { name: \"Use These Colors\" }).click();\n    await page.waitForTimeout(500);\n    const vars = () => page.evaluate(() => { const s = getComputedStyle(document.documentElement); return { ac: s.getPropertyValue(\"--ac\").trim(), bg: s.getPropertyValue(\"--bg\").trim(), theme: localStorage.getItem(\"aura_theme\"), saved: localStorage.getItem(\"aura_custom_theme\") }; });\n    const hue = (h) => { const r = parseInt(h.slice(1, 3), 16) / 255, g = parseInt(h.slice(3, 5), 16) / 255, b = parseInt(h.slice(5, 7), 16) / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; let x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; x *= 60; return x < 0 ? x + 360 : x; };\n    let v = await vars();\n    check(\"Use These Colors: the accent becomes the picture's orange\", /^#[0-9a-f]{6}$/i.test(v.ac) && hue(v.ac) > 15 && hue(v.ac) < 40 && v.ac !== accentBefore, v);\n    check(\"and the background is a dark navy from the picture\", /^#[0-9a-f]{6}$/i.test(v.bg) && hue(v.bg) > 200 && hue(v.bg) < 250, v);\n    check(\"it's saved as your custom theme\", v.theme === \"custom\" && /\"ac\"/.test(v.saved || \"\"), v);\n    const second = await page.locator('.bgt-dot[aria-pressed=\"false\"]').last().elementHandle();\n    const secondColor = await second.evaluate((e) => getComputedStyle(e).backgroundColor);\n    await second.click();\n    await page.waitForTimeout(400);\n    check(\"tapping another swatch builds the theme around that color instead\", (await vars()).ac !== v.ac && (await second.getAttribute(\"aria-pressed\")) === \"true\", { secondColor, now: await vars() });\n    await page.locator(\".bgt-auto .tog\").click();\n    await page.waitForTimeout(300);\n    await page.locator('input[placeholder=\"https://... image URL\"]').fill(GREEN);\n    await page.getByRole(\"button\", { name: \"Apply Background\" }).click();\n    await page.waitForTimeout(1500);\n    v = await vars();\n    check(\"with Match on, a new background brings its own theme: green\", hue(v.ac) > 110 && hue(v.ac) < 160 && hue(v.bg) > 100 && hue(v.bg) < 160, v);\n    const kept = v.ac;\n    await menu(\"Home\"); await menu(\"Customize\"); await page.getByText(\"🖼 BG\").click(); await page.waitForTimeout(1200);\n    check(\"coming back to Customize doesn't redo it (your own changes are kept)\", (await vars()).ac === kept);\n    await page.locator('input[placeholder=\"https://... image URL\"]').fill(\"https://example.com/picture.jpg\");\n    await page.getByRole(\"button\", { name: \"Apply Background\" }).click();\n    await page.waitForTimeout(2500);\n    check(\"a picture from a website that can't be read says so, and what to do\", /can't read the colors[\\s\\S]*Browse/.test(await page.locator(\".bgt\").innerText().catch(() => \"\")), await page.locator(\".bgt\").innerText().catch(() => \"\"));\n    check(\"and the theme stays as it was\", (await vars()).ac === kept);\n    check(\"nothing crashed\", (await page.locator(\".aura-fallback\").count()) === 0 && thrown.filter((m) => !/reading 'live'/.test(m)).length === 0, thrown);\n    if (process.env.AURA_SHOT) { await page.locator('input[placeholder=\"https://... image URL\"]').fill(ORANGE_NAVY); await page.getByRole(\"button\", { name: \"Apply Background\" }).click(); await page.waitForTimeout(1500); await page.screenshot({ path: process.env.AURA_SHOT }); }\n  } finally {\n    await browser.close();\n    server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The look check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-look.bak";
const MARK = "Added by aura-look-setup.cjs";
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "release", ".git", ".vite", "coverage", "tests", "supabase"]);

const rel = (p) => path.relative(ROOT, p) || p;
const say = (line = "") => console.log(line);
function stop(lines) {
  say();
  say("Nothing was changed.");
  (Array.isArray(lines) ? lines : [lines]).forEach((l) => say("  " + l));
  say();
  process.exit(1);
}
function readText(file) {
  const raw = fs.readFileSync(file, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n"; // keep Windows line endings as they are
  return { text: raw.replace(/\r\n/g, "\n"), eol };
}
const withEol = (text, eol) => (eol === "\n" ? text : text.replace(/\n/g, eol));
function* walk(dir, depth = 0) {
  if (depth > 7) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) yield* walk(full, depth + 1);
    } else if (/\.(jsx?|tsx?|cjs|mjs)$/.test(entry.name) && !/^aura-[\w-]+\.cjs$/.test(entry.name)) {
      try { if (fs.statSync(full).size < 3 * 1024 * 1024) yield full; } catch {}
    }
  }
}
// Finds one file. A project can have several that look alike, so `prefer` is a list of tie-breakers.
function findOne(label, test, hint, prefer = []) {
  let hits = [];
  for (const file of walk(ROOT)) {
    let text = "";
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    if (test(text)) hits.push({ file, text });
  }
  if (!hits.length) stop(["I couldn't find " + label + ".", hint, "Copy this message to Claude."]);
  for (const rule of prefer) {
    if (hits.length === 1) break;
    const kept = hits.filter((h) => rule(h));
    if (kept.length) hits = kept;
  }
  if (hits.length === 1) return hits[0].file;
  stop(["I found more than one file that looks like " + label + ":", ...hits.map((h) => "  " + rel(h.file)), "Copy this message to Claude."]);
}
const sameFile = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const indentOf = (line) => line.match(/^\s*/)[0];
const findLine = (lines, re, from = 0, to = lines.length) => { for (let i = from; i < to; i++) if (re.test(lines[i])) return i; return -1; };

function swapOnce(text, find, replace, what) {
  const i = text.indexOf(find);
  if (i < 0 || text.indexOf(find, i + 1) >= 0) throw new Error(what);
  return text.slice(0, i) + replace + text.slice(i + find.length);
}

// ── App.jsx ──────────────────────────────────────────────────────────────────
function editApp(text) {
  if (text.includes("<BgThemePicker")) return { text, notes: [] };
  let t = text;
  const S = (a, b, what) => { t = swapOnce(t, a, b, what); };

  const imp = /^import \{ useCloudGames, useCloudProfile \} from "\.\/cloudsync";\n/m;
  if (!imp.test(t)) throw new Error('the imports at the top ( import { useCloudGames, useCloudProfile } from "./cloudsync"; )');
  t = t.replace(imp, (m) => m + 'import { readPicture, themeFrom, pickAccent } from "./components/bgtheme"; // a theme from your background (' + MARK + ")\n");

  const wm = /^(\s*)windowMode: "maximized",[^\n]*\n/m;
  const w = wm.exec(t);
  if (!w) throw new Error('AURA\'s settings ( windowMode: "maximized", )');
  t = t.slice(0, w.index + w[0].length) + w[1] + "matchBgTheme: false,   // keep the theme matched to your background picture (" + MARK + ")\n" + t.slice(w.index + w[0].length);

  // ── Settings: Full Screen as a switch, with F11 ────────────────────────────
  const oldMode = /^(\s*)<div className="sr"><div><div className="sr-l">Window Mode<\/div>[^\n]*\n\s*<Seg value=\{s\.windowMode\}[^\n]*\n/m;
  const om = oldMode.exec(t);
  if (!om) throw new Error('the Window Mode row in Settings ( <div className="sr-l">Window Mode</div> ... <Seg value={s.windowMode} ... )');
  const ind = om[1];
  const sw = (on, label, flip) => `<div className={\`tog \${${on}?"on":""}\`} role="switch" aria-checked={${on}} aria-label="${label}" tabIndex={0} onClick={${flip}} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();(${flip})();}}}/>`;
  const rows = [
    `{/* Full screen as a switch, and F11 to switch anytime (${MARK}) */}`,
    `<div className="sr"><div><div className="sr-l">Full Screen <kbd style={{background:"var(--hover)",border:"1px solid var(--border)",borderRadius:4,padding:"1px 6px",fontFamily:"monospace",fontSize:10,marginLeft:6,color:"var(--t2)"}}>F11</kbd></div><div className="sr-s">AURA fills your whole screen. Press F11 anytime to switch between full screen and maximized</div></div>`,
    `  ${sw('s.windowMode==="fullscreen"', "Full screen", '()=>set({windowMode:s.windowMode==="fullscreen"?"maximized":"fullscreen"})')}</div>`,
    `{s.windowMode!=="fullscreen"&&<div className="sr"><div><div className="sr-l">Open in a Window</div><div className="sr-s">Off: AURA opens maximized. On: it opens in a smaller window you can move</div></div>`,
    `  ${sw('s.windowMode==="windowed"', "Open in a window", '()=>set({windowMode:s.windowMode==="windowed"?"maximized":"windowed"})')}</div>}`,
  ].map((l) => ind + l).join("\n") + "\n";
  t = t.slice(0, om.index) + rows + t.slice(om.index + om[0].length);

  // ── Customize > BG: a theme from your background ──────────────────────────
  S("function Customize({ theme, onThemeChange,",
    [
      "// ── A theme from your background (" + MARK + ") ──",
      "// AURA reads the colours in your picture. Tap one to build the theme around it, or keep the",
      "// theme matched to whatever background you pick.",
      "const bgKey = (src) => (src ? String(src.length) + \":\" + src.slice(0, 40) + src.slice(-40) : \"\");",
      "function BgThemePicker({ bgImage, onUse }) {",
      "  const s = useSettings();",
      "  const [colors, setColors] = useState(undefined); // undefined: reading, null: couldn't",
      "  const [picked, setPicked] = useState(\"\");",
      "  useEffect(() => {",
      "    let alive = true;",
      "    setColors(undefined); setPicked(\"\");",
      "    readPicture(bgImage).then((c) => { if (alive) setColors(c && c.length ? c : null); });",
      "    return () => { alive = false; };",
      "  }, [bgImage]);",
      "  const base = colors?.[0]?.hex;",
      "  const accent = picked || (colors ? pickAccent(colors) : \"\");",
      "  const preview = colors ? themeFrom(base, accent) : null;",
      "  const choose = (hexColor) => { if (!colors) return; setPicked(hexColor); onUse(themeFrom(base, hexColor)); try { localStorage.setItem(\"aura_bg_theme_for\", bgKey(bgImage)); } catch {} };",
      "  // Kept matched: a new background gets its theme once (your own changes after that are kept)",
      "  useEffect(() => {",
      "    if (!s.matchBgTheme || !colors) return;",
      "    let done = \"\";",
      "    try { done = localStorage.getItem(\"aura_bg_theme_for\") || \"\"; } catch {}",
      "    if (done !== bgKey(bgImage)) choose(pickAccent(colors));",
      "  }, [s.matchBgTheme, colors]); // eslint-disable-line react-hooks/exhaustive-deps",
      "  return (",
      "    <div className=\"bgt\">",
      "      <div className=\"bgt-h\">Theme from your background</div>",
      "      <div className=\"bgt-s\">Tap a color from your picture to build AURA's colors around it.</div>",
      "      {colors === undefined && <div className=\"bgt-s\">Reading the colors in your picture…</div>}",
      "      {colors === null && <div className=\"bgt-s bgt-err\">AURA can't read the colors of this picture (the website it's from doesn't allow it). Use Browse to pick a picture from your PC instead.</div>}",
      "      {colors && (",
      "        <>",
      "          <div className=\"bgt-sw\" role=\"group\" aria-label=\"Colors in your background\">",
      "            {colors.map((c) => (",
      "              <button key={c.hex} type=\"button\" className={`bgt-dot ${accent === c.hex ? \"on\" : \"\"}`} style={{ background: c.hex }} onClick={() => choose(c.hex)} title={`Build the theme around ${c.hex}`} aria-label={`Build the theme around ${c.hex}`} aria-pressed={accent === c.hex} />",
      "            ))}",
      "          </div>",
      "          {preview && <div className=\"bgt-strip\" aria-hidden=\"true\">{[preview.bg, preview.panel, preview.card, preview.hover, preview.ac, preview.ac2].map((c, i) => <span key={i} style={{ background: c }} />)}</div>}",
      "          <div style={{ display: \"flex\", gap: 8, alignItems: \"center\", flexWrap: \"wrap\" }}>",
      "            <button type=\"button\" className=\"btn-p\" style={{ justifyContent: \"center\" }} onClick={() => choose(accent)}>Use These Colors</button>",
      "            <label className=\"bgt-auto\">",
      "              <span className={`tog ${s.matchBgTheme ? \"on\" : \"\"}`} role=\"switch\" aria-checked={!!s.matchBgTheme} tabIndex={0}",
      "                onClick={() => updateSettings({ matchBgTheme: !s.matchBgTheme })}",
      "                onKeyDown={(e) => { if (e.key === \"Enter\" || e.key === \" \") { e.preventDefault(); updateSettings({ matchBgTheme: !s.matchBgTheme }); } }} />",
      "              Match my theme to new backgrounds",
      "            </label>",
      "          </div>",
      "        </>",
      "      )}",
      "    </div>",
      "  );",
      "}",
      "const BGT_CSS = `",
      ".bgt{text-align:left;margin-top:22px;padding:16px;border-radius:12px;background:var(--card);border:1px solid var(--border);display:flex;flex-direction:column;gap:12px}",
      ".bgt-h{font-family:Rajdhani,sans-serif;font-size:15px;font-weight:700;letter-spacing:.5px;color:var(--t1)}",
      ".bgt-s{font-size:11px;color:var(--t2);margin-top:-6px}",
      ".bgt-err{color:var(--danger)}",
      ".bgt-sw{display:flex;gap:10px;flex-wrap:wrap}",
      ".bgt-dot{width:38px;height:38px;border-radius:10px;border:2px solid rgba(255,255,255,.12);cursor:pointer;padding:0;transition:transform .15s,border-color .15s}",
      ".bgt-dot:hover{transform:scale(1.08)}",
      ".bgt-dot.on{border-color:#fff;transform:scale(1.1)}",
      ".bgt-dot:focus-visible,.bgt-auto .tog:focus-visible{outline:2px solid #fff;outline-offset:2px}",
      ".bgt-strip{display:flex;height:12px;border-radius:8px;overflow:hidden}",
      ".bgt-strip span{flex:1}",
      ".bgt-auto{display:flex;align-items:center;gap:9px;font-size:11.5px;color:var(--t2);cursor:pointer;user-select:none}",
      ".reduce-motion .bgt-dot{transition:none}",
      "`;",
      "if (typeof document !== \"undefined\" && !document.getElementById(\"aura-bgt-css\")) { const el = document.createElement(\"style\"); el.id = \"aura-bgt-css\"; el.textContent = BGT_CSS; document.head.appendChild(el); }",
      "",
      "function Customize({ theme, onThemeChange,",
    ].join("\n"),
    "the Customize page ( function Customize({ theme, onThemeChange, ... )");
  S("  const applyCustom = () => { onCustomColorsChange(local);onThemeChange(\"custom\"); };\n",
    "  const applyCustom = () => { onCustomColorsChange(local);onThemeChange(\"custom\"); };\n" +
    "  // A theme made from the background picture: it becomes your custom theme (" + MARK + ")\n" +
    "  const applyBgColors = (colors) => { setLocal(colors); setAc2color(colors.ac2); onAccentChange(null); onThemeChange(\"custom\"); onCustomColorsChange(colors); };\n",
    "the Customize page ( const applyCustom = () => { ... } )");
  S("{bgImage&&<button className=\"btn-gh\" style={{padding:\"10px 16px\"}} onClick={()=>{onBgChange(\"\");setBgInput(\"\");}}>Remove</button>}\n            </div>\n",
    "{bgImage&&<button className=\"btn-gh\" style={{padding:\"10px 16px\"}} onClick={()=>{onBgChange(\"\");setBgInput(\"\");}}>Remove</button>}\n            </div>\n" +
    "            {bgImage&&<BgThemePicker bgImage={bgImage} onUse={applyBgColors}/>}\n",
    "the background buttons in Customize ( ...Remove</button>} )");

  // ── F11 from the main process keeps the switch in step ─────────────────────
  const cloud = /^(\s*)useCloudProfile\(\{[^\n]*\}\);\n/m;
  const cm = cloud.exec(t);
  if (!cm) throw new Error("where account sync starts ( useCloudProfile({ ... }); )");
  const block = [
    "// F11 switched full screen: the Full Screen switch in Settings follows (" + MARK + ")",
    "useEffect(() => {",
    "  const off = window.electronAPI?.onWindowModeChanged?.((mode) => {",
    "    if ([\"maximized\", \"fullscreen\", \"windowed\"].includes(mode) && SETTINGS.windowMode !== mode) updateSettings({ windowMode: mode });",
    "  });",
    "  return () => { if (typeof off === \"function\") off(); };",
    "}, []);",
  ].map((l) => cm[1] + l).join("\n") + "\n";
  t = t.slice(0, cm.index + cm[0].length) + block + t.slice(cm.index + cm[0].length);

  return { text: t, notes: [
    "Settings > Display: a Full Screen switch (F11 switches anytime), and Open in a Window",
    "Customize > BG: colors from your background, a theme built from them, and Match my theme to new backgrounds",
  ] };
}

// ── main.js: F11, and leaving a full-screen video goes back to your setting ──
function editMain(text) {
  if (text.includes("function toggleFullScreenMode")) return { text, notes: [] };
  let t = text;
  t = swapOnce(t, "function applyWindowMode(mode) {\n",
    [
      "// F11: full screen on or off, remembered like the switch in Settings (" + MARK + ")",
      "let modeBeforeFull = \"maximized\";",
      "function toggleFullScreenMode() {",
      "  if (!mainWin || mainWin.isDestroyed()) return;",
      "  const full = appSettings.windowMode === \"fullscreen\";",
      "  if (!full) modeBeforeFull = appSettings.windowMode === \"windowed\" ? \"windowed\" : \"maximized\";",
      "  appSettings.windowMode = full ? modeBeforeFull : \"fullscreen\";",
      "  saveAppSettings();",
      "  applyWindowMode(appSettings.windowMode);",
      "  mainWin.webContents.send(\"window-mode-changed\", appSettings.windowMode);",
      "}",
      "function applyWindowMode(mode) {",
      "",
    ].join("\n"),
    "how the window mode is applied ( function applyWindowMode(mode) { )");
  t = swapOnce(t, "  mainWin.webContents.on(\"leave-html-full-screen\", () => {\n    mainWin.setFullScreen(false);\n  });\n",
    "  mainWin.webContents.on(\"leave-html-full-screen\", () => {\n" +
    "    applyWindowMode(appSettings.windowMode); // back to how you set AURA: full screen stays full screen\n" +
    "  });\n" +
    "  mainWin.webContents.on(\"before-input-event\", (event, input) => {\n" +
    "    if (input.type !== \"keyDown\" || input.key !== \"F11\" || input.isAutoRepeat || input.control || input.alt || input.meta || input.shift) return;\n" +
    "    event.preventDefault();\n" +
    "    toggleFullScreenMode();\n" +
    "  });\n",
    "where a full-screen video ends ( mainWin.webContents.on(\"leave-html-full-screen\", ... setFullScreen(false) ) )");
  return { text: t, notes: ["F11 switches full screen on and off, and AURA remembers it", "leaving a full-screen video keeps AURA in full screen if that's your setting"] };
}

// ── preload.js ───────────────────────────────────────────────────────────────
function editPreload(text) {
  if (text.includes("onWindowModeChanged")) return { text, notes: [] };
  const t = swapOnce(text,
    '  searchTwitch:       (opts) => ipcRenderer.invoke("search-twitch", opts),\n',
    '  searchTwitch:       (opts) => ipcRenderer.invoke("search-twitch", opts),\n' +
    "  // F11 switched full screen (" + MARK + ")\n" +
    '  onWindowModeChanged: (cb) => { const h = (_e, mode) => cb(mode); ipcRenderer.on("window-mode-changed", h); return () => ipcRenderer.removeListener("window-mode-changed", h); },\n',
    'the Twitch calls ( searchTwitch: (opts) => ipcRenderer.invoke("search-twitch", opts), )');
  return { text: t, notes: ["the Settings switch hears about F11"] };
}

// ── AURA's checks (only when they are installed) ─────────────────────────────
function editRunner(text) {
  if (/look\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  let at = -1;
  for (let i = 0; i < lines.length; i++) if (/add\("window",/.test(lines[i])) at = i;
  if (at < 0) return { text, notes: ["(couldn't find where to add the look check, so npm test doesn't include it)"] };
  lines.splice(at + 1, 0, 'if (fs.existsSync(path.join(__dirname, "look.cjs"))) add("window", "Full Screen switch and a theme from your background", "look.cjs");');
  return { text: lines.join("\n"), notes: ["npm test now checks the Full Screen switch and background themes too"] };
}

// Does `node` accept the file? Catches a bad edit before anything is written.
function syntaxProblem(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-check-"));
  const file = path.join(dir, "check.cjs");
  try {
    fs.writeFileSync(file, text);
    const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    return r.status === 0 ? "" : String(r.stderr || "syntax error").split("\n").filter(Boolean).slice(0, 4).join(" | ");
  } catch { return ""; } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
}

// ── Undo ──────────────────────────────────────────────────────────────────────
function undo() {
  let restored = 0;
  const visit = (dir, depth = 0) => {
    if (depth > 7) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if ((!SKIP_DIRS.has(entry.name) || entry.name === "tests") && !entry.name.startsWith(".")) visit(full, depth + 1);
      } else if (entry.name.endsWith(BAK)) {
        const target = full.slice(0, -BAK.length);
        fs.copyFileSync(full, target); fs.unlinkSync(full);
        say("  restored  " + rel(target)); restored++;
      } else if (entry.name === "bgtheme.js" || entry.name === "look.cjs") {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. Settings and Customize are back to how they were." : "Nothing to undo.");
  say();
}

// ── Run ───────────────────────────────────────────────────────────────────────
function run() {
  const pkgFile = path.join(ROOT, "package.json");
  if (!fs.existsSync(pkgFile)) stop(["This isn't your AURA project folder (no package.json here).", "Move this file next to package.json and run it from there."]);
  if (UNDO) return undo();

  const need = "Make sure this file is in your AURA project folder, next to package.json.";
  let pkgMain = "";
  try { pkgMain = String(JSON.parse(fs.readFileSync(pkgFile, "utf8")).main || ""); } catch {}
  const startFile = pkgMain ? path.resolve(ROOT, pkgMain) : "";
  const comp = (h) => /[\\/]components[\\/]/.test(h.file);
  const files = {
    main: findOne("your main file", (t) => /function applyWindowMode\(mode\)/.test(t), need, [
      (h) => startFile && sameFile(h.file, startFile),
      (h) => /function createWindow\s*\(/.test(h.text),
    ]),
    preload: findOne("your preload file", (t) => /searchTwitch:\s*\(opts\)/.test(t) && /contextBridge/.test(t), need, [
      (h) => /^preload\.[cm]?js$/.test(path.basename(h.file)),
    ]),
    app: findOne("your App file", (t) => /function AuraApp\s*\(/.test(t) && /<AuraApp\b/.test(t), need, [
      (h) => /^App\.[jt]sx?$/.test(path.basename(h.file)),
    ]),
  };

  const plan = [];
  const problems = [];
  const consider = (label, file, edit, checkSyntax) => {
    const { text, eol } = readText(file);
    try {
      const result = edit(text);
      if (checkSyntax && result.text !== text) { const bad = syntaxProblem(result.text); if (bad) throw new Error("a way to edit it safely (" + bad + ")"); }
      plan.push({ label, file, before: text, after: result.text, eol, notes: result.notes });
    } catch (e) { problems.push("In " + rel(file) + " I couldn't find " + e.message + "."); }
  };
  consider("App file", files.app, editApp, false);
  consider("main file", files.main, editMain, true);
  consider("preload", files.preload, editPreload, true);
  const runner = path.join(ROOT, "tests", "run.cjs");
  const hasChecks = fs.existsSync(runner);
  if (hasChecks) consider("checks", runner, editRunner, true);

  const created = [{ label: "colors", file: path.join(path.dirname(files.app), "components", "bgtheme.js"), content: FILES.bgtheme }];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "look.cjs"), content: FILES.test });
  for (const c of created) {
    c.note = "created";
    if (fs.existsSync(c.file)) {
      const existing = readText(c.file).text;
      if (!existing.includes(MARK)) problems.push(rel(c.file) + " already exists and wasn't made by this script, so I left it alone.");
      else c.note = existing === c.content ? "already done" : "updated";
    }
  }
  if (problems.length) stop([...problems, "Copy this message to Claude."]);

  say();
  say(DRY ? "Dry run. This is what would change:" : "AURA: Full Screen switch and a theme from your background");
  say();
  for (const step of plan) {
    if (step.after !== step.before && !DRY) {
      const bak = step.file + BAK;
      if (!fs.existsSync(bak)) fs.copyFileSync(step.file, bak);
      fs.writeFileSync(step.file, withEol(step.after, step.eol));
    }
    say("  " + (step.label + ":").padEnd(13) + rel(step.file));
    (step.notes.length ? step.notes : ["already done"]).forEach((n) => say("               - " + n));
  }
  for (const c of created) {
    if (c.note !== "already done" && !DRY) { fs.mkdirSync(path.dirname(c.file), { recursive: true }); fs.writeFileSync(c.file, c.content); }
    say("  " + (c.label + ":").padEnd(13) + rel(c.file));
    say("               - " + c.note);
  }
  say();
  if (DRY) { say("Run it again without --dry-run to apply."); say(); return; }
  say("Done. Restart AURA (stop it in the terminal and start it again), then look in Settings > Display and Customize > BG.");
  if (hasChecks) say("Run  npm test  before your next release.");
  say("To undo later:  node aura-look-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
