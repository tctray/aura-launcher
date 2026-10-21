#!/usr/bin/env node
/**
 * AURA — saved themes keep their background
 *
 *   - Customize > Saved: saving a theme now also saves the background showing (a picture from
 *     your PC, a web link, or no background).
 *   - Loading a saved theme changes the colors AND the background together.
 *   - Each saved theme shows its background in its little picture, and says "with background"
 *     or "no background".
 *   - Pictures from your PC are kept in AURA's picture storage on this PC (they can be several MB,
 *     too big for the theme list). Saving over a theme or deleting it lets go of its old picture.
 *   - Themes saved before this update keep working: they load their colors and leave the
 *     background as it is. A theme synced from another PC whose picture isn't on this one loads
 *     its colors and says so.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-theme-backgrounds-setup.cjs
 *
 * What it does:
 *   - creates  src/components/themebg.js     keeps each theme's background
 *   - edits    src/App.jsx                   saving and loading themes in Customize
 *   - creates  tests/theme-backgrounds.cjs   (only if AURA's checks are installed) checks it
 *
 * Every file it changes is copied to <name>.before-theme-backgrounds.bak first.
 * To put everything back:                 node aura-theme-backgrounds-setup.cjs --undo
 * To preview without changing anything:   node aura-theme-backgrounds-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FILES = {"themebg":"// The background saved with each theme (Customize > Saved). Added by aura-theme-backgrounds-setup.cjs\n//\n// A saved theme keeps its background as one of:\n//   { kind: \"none\" }              no background\n//   { kind: \"web\", url }          a picture from a web link (this travels with your account)\n//   { kind: \"pic\", pic: \"<id>\" }  a picture from this PC, kept in AURA's picture storage on this PC\n// Pictures from the PC can be several MB, so they're not put inside the theme list itself.\nconst DB = \"aura-theme-pictures\";\nconst STORE = \"pics\";\nlet opening = null;\nfunction db() {\n  if (opening) return opening;\n  opening = new Promise((resolve, reject) => {\n    if (typeof indexedDB === \"undefined\") return reject(new Error(\"no picture storage\"));\n    const req = indexedDB.open(DB, 1);\n    req.onupgradeneeded = () => req.result.createObjectStore(STORE);\n    req.onsuccess = () => resolve(req.result);\n    req.onerror = () => reject(req.error);\n  });\n  opening.catch(() => { opening = null; });\n  return opening;\n}\nfunction run(mode, fn) {\n  return db().then((d) => new Promise((resolve, reject) => {\n    const tx = d.transaction(STORE, mode);\n    const req = fn(tx.objectStore(STORE));\n    tx.oncomplete = () => resolve(req ? req.result : undefined);\n    tx.onerror = () => reject(tx.error);\n    tx.onabort = () => reject(tx.error);\n  }));\n}\nexport const isWebPicture = (v) => typeof v === \"string\" && /^https?:\\/\\//i.test(v);\nconst isPicture = (v) => typeof v === \"string\" && /^data:image\\/[a-z.+-]+;base64,/i.test(v);\n\n// What to keep with a theme being saved, for the background showing now. null: it couldn't be kept.\nexport async function backgroundForTheme(bg) {\n  if (!bg) return { kind: \"none\" };\n  if (isWebPicture(bg)) return { kind: \"web\", url: bg };\n  if (!isPicture(bg)) return null;\n  try {\n    const id = \"pic-\" + Date.now().toString(36) + \"-\" + Math.random().toString(36).slice(2, 8);\n    await run(\"readwrite\", (st) => st.put(bg, id));\n    return { kind: \"pic\", pic: id };\n  } catch { return null; }\n}\n// The picture kept for a theme (null if it isn't on this PC)\nexport async function themePicture(id) {\n  if (typeof id !== \"string\" || !id) return null;\n  try { const v = await run(\"readonly\", (st) => st.get(id)); return isPicture(v) ? v : null; } catch { return null; }\n}\nexport async function forgetThemePicture(id) {\n  if (typeof id !== \"string\" || !id) return;\n  try { await run(\"readwrite\", (st) => st.delete(id)); } catch {}\n}\n// A theme's background as something to show: \"\" for none, a link or picture, or null if unknown/missing\nexport async function resolveThemeBackground(b) {\n  if (!b || typeof b !== \"object\") return null;\n  if (b.kind === \"none\") return \"\";\n  if (b.kind === \"web\") return isWebPicture(b.url) ? b.url : null;\n  if (b.kind === \"pic\") return themePicture(b.pic);\n  return null;\n}\n","test":"// Saved themes keep their background: saving a theme (Customize > Saved) keeps the background showing\n// (a picture from the PC, a web link, or none), and loading it brings back the colors and the background\n// together. Opens the built window (dist) in a real browser with a pretend desktop side.\n// Added by aura-theme-backgrounds-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\n\n(async () => {\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(process.env.CI ? 1 : 3); }\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch(options); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with. Run  npx playwright install chromium  once to add one.\"); return done(process.env.CI ? 1 : 3); }\n\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(DIST, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => {\n      if (err) { res.writeHead(404); return res.end(); }\n      res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" });\n      res.end(data);\n    });\n  });\n  await new Promise((r) => server.listen(0, \"127.0.0.1\", r));\n  const base = \"http://127.0.0.1:\" + server.address().port;\n\n  try {\n    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();\n    const thrown = [];\n    page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n    await page.route((url) => !String(url).startsWith(base) && !String(url).startsWith(\"data:\"), (route) => route.abort());\n    await page.addInitScript(() => {\n      try {\n        if (!sessionStorage.getItem(\"aura_test_started\")) {\n          sessionStorage.setItem(\"aura_test_started\", \"1\");\n          localStorage.clear();\n          localStorage.setItem(\"aura_profile\", JSON.stringify({ username: \"tester\", avatar: \"\", userId: \"user-1\" }));\n          // Two themes saved before this update or on another PC\n          localStorage.setItem(\"aura_saved_themes\", JSON.stringify([\n            { name: \"Old one\", colors: {}, accent: \"#00ff99\", themeName: \"obsidian\" },\n            { name: \"Elsewhere\", colors: {}, accent: \"#ff00aa\", themeName: \"ocean\", background: { kind: \"pic\", pic: \"pic-from-another-pc\" } },\n          ]));\n        }\n      } catch {}\n      // A picture \"picked from the PC\": a solid colour, made here\n      window.__picture = (color) => { const c = document.createElement(\"canvas\"); c.width = 64; c.height = 36; const g = c.getContext(\"2d\"); g.fillStyle = color; g.fillRect(0, 0, 64, 36); return c.toDataURL(\"image/png\"); };\n      window.__pickColor = \"#d01010\";\n      const ok = (data) => Promise.resolve({ success: true, data });\n      const account = { getSession: () => ok({ id: \"user-1\", email: \"me@example.com\" }), getMyProfile: () => ok({ username: \"tester\", avatar_url: null }), getMyData: () => ok([]), getMySessionIds: () => ok([]) };\n      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => (name === \"auraCloud\" && account[key]) ? account[key](...args) : ok(null)) });\n      window.auraCloud = fake(\"auraCloud\");\n      window.auraSocial = fake(\"auraSocial\");\n      window.electronAPI = new Proxy({}, {\n        get: (_t, key) => {\n          if (key === \"isElectron\") return true;\n          if (typeof key !== \"string\" || key === \"then\") return undefined;\n          if (key === \"pickImage\") return () => Promise.resolve(window.__picture(window.__pickColor));\n          if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};\n          return () => Promise.resolve({ success: false });\n        },\n      });\n    });\n    await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n    await page.waitForTimeout(4500);\n    const look = () => page.evaluate(() => {\n      const bg = document.querySelector(\".app-bg\");\n      return { bgVar: getComputedStyle(document.documentElement).getPropertyValue(\"--bg\").trim().toLowerCase(), picture: bg ? bg.style.backgroundImage : \"\", saved: localStorage.getItem(\"aura_bg\") || \"\" };\n    });\n    const tab = async (label) => { await page.locator(\"button\", { hasText: label }).first().click(); await page.waitForTimeout(250); };\n    const preset = async (name) => { await tab(\"Presets\"); await page.locator(\"span\", { hasText: new RegExp(\"^\" + name.toUpperCase() + \"$\") }).first().click(); await page.waitForTimeout(300); };\n    const saveAs = async (name) => { await tab(\"Saved\"); await page.locator('input[placeholder^=\"Theme name\"]').fill(name); await page.locator(\"button.btn-p\", { hasText: /^Save$/ }).click(); await page.waitForTimeout(600); };\n    const row = (name) => page.locator(\"div\", { has: page.locator(`div:text-is(\"${name}\")`) }).filter({ has: page.locator(\"button\", { hasText: \"Load\" }) }).last();\n    const load = async (name) => { await tab(\"Saved\"); await row(name).locator(\"button\", { hasText: \"Load\" }).click(); await page.waitForTimeout(900); };\n    const savedList = () => page.evaluate(() => JSON.parse(localStorage.getItem(\"aura_saved_themes\") || \"[]\"));\n    const toasts = () => page.evaluate(() => [...document.querySelectorAll(\".toast\")].map((t) => t.innerText).join(\" | \"));\n    const red = await page.evaluate(() => window.__picture(\"#d01010\"));\n\n    await page.locator('.gm-rail-item[title=\"Customize\"], .sb-item[title=\"Customize\"]').first().click({ timeout: 5000 });\n    await page.waitForTimeout(600);\n\n    console.log(\"1. Saving a theme keeps its background\");\n    await preset(\"Ocean\");\n    await tab(\"BG\");\n    await page.locator(\"button.btn-p\", { hasText: /^Browse$/ }).click();\n    await page.waitForTimeout(500);\n    let l = await look();\n    check(\"(a picture from the PC is the background, with the Ocean colors)\", l.saved === red && /data:image/.test(l.picture) && l.bgVar === \"#020c1b\", { ...l, picture: l.picture.slice(0, 40), saved: l.saved.slice(0, 30) });\n    await saveAs(\"Red ocean\");\n    let list = await savedList();\n    const ro = list.find((x) => x.name === \"Red ocean\");\n    check(\"the saved theme keeps the background picture\", ro && ro.background && ro.background.kind === \"pic\" && typeof ro.background.pic === \"string\", ro);\n    check(\"the picture itself isn't put in the theme list (it can be several MB)\", !JSON.stringify(list).includes(\"data:image\"), JSON.stringify(list).length);\n    check(\"the list says it has a background and shows it in its little picture\", /with background/.test(await row(\"Red ocean\").innerText()) && (await row(\"Red ocean\").locator(\".theme-bg-thumb\").count()) === 1);\n\n    await preset(\"Blood\");\n    await tab(\"BG\");\n    await page.locator('input[placeholder=\"https://... image URL\"]').fill(\"https://example.com/space.jpg\");\n    await page.locator(\"button.btn-p\", { hasText: \"Apply Background\" }).click();\n    await page.waitForTimeout(400);\n    await saveAs(\"Web blood\");\n    list = await savedList();\n    check(\"a web-link background is saved as the link\", JSON.stringify(list.find((x) => x.name === \"Web blood\").background) === JSON.stringify({ kind: \"web\", url: \"https://example.com/space.jpg\" }));\n\n    await preset(\"Midnight\");\n    await tab(\"BG\");\n    await page.locator(\"button.btn-gh\", { hasText: /^Remove$/ }).click();\n    await page.waitForTimeout(400);\n    await saveAs(\"Plain\");\n    list = await savedList();\n    check(\"no background is saved as no background\", JSON.stringify(list.find((x) => x.name === \"Plain\").background) === JSON.stringify({ kind: \"none\" }) && /no background/.test(await row(\"Plain\").innerText()));\n\n    console.log(\"2. Loading a theme brings back the colors and the background\");\n    await load(\"Red ocean\");\n    l = await look();\n    check(\"Red ocean: the Ocean colors and the red picture\", l.bgVar === \"#020c1b\" && l.saved === red && /data:image/.test(l.picture), { bgVar: l.bgVar, saved: l.saved.slice(0, 30) });\n    check(\"and it says so\", /\"Red ocean\" loaded/.test(await toasts()), await toasts());\n    await tab(\"BG\");\n    check(\"the BG tab shows that picture too\", (await page.locator('input[placeholder=\"https://... image URL\"]').inputValue()) === red);\n    await load(\"Plain\");\n    l = await look();\n    check(\"Plain: the Midnight colors and no background\", l.bgVar === \"#222831\" && l.saved === \"\" && l.picture === \"\", l);\n    await load(\"Web blood\");\n    l = await look();\n    check(\"Web blood: the Blood colors and the web picture\", l.bgVar === \"#0d0000\" && l.saved === \"https://example.com/space.jpg\" && /example\\.com\\/space\\.jpg/.test(l.picture), l);\n    await load(\"Old one\");\n    l = await look();\n    check(\"a theme saved before this update: its colors load, the background stays as it is\", l.bgVar === \"#0a0a0a\" && l.saved === \"https://example.com/space.jpg\", l);\n    await load(\"Elsewhere\");\n    l = await look();\n    check(\"a theme whose picture is on another PC: colors load, background stays, and it says why\", l.bgVar === \"#020c1b\" && l.saved === \"https://example.com/space.jpg\" && /on another PC/.test(await toasts()), { l, t: await toasts() });\n\n    console.log(\"3. After restarting AURA\");\n    await page.reload({ waitUntil: \"load\" });\n    await page.waitForTimeout(4500);\n    await page.locator('.gm-rail-item[title=\"Customize\"], .sb-item[title=\"Customize\"]').first().click({ timeout: 5000 });\n    await page.waitForTimeout(600);\n    await load(\"Red ocean\");\n    l = await look();\n    check(\"saved themes still bring back their picture\", l.bgVar === \"#020c1b\" && l.saved === red, { bgVar: l.bgVar, saved: l.saved.slice(0, 30) });\n\n    console.log(\"4. Replacing and deleting\");\n    const firstPic = (await savedList()).find((x) => x.name === \"Red ocean\").background.pic;\n    await page.evaluate(() => { window.__pickColor = \"#1040d0\"; });\n    await tab(\"BG\");\n    await page.locator(\"button.btn-p\", { hasText: /^Browse$/ }).click();\n    await page.waitForTimeout(400);\n    await saveAs(\"Red ocean\");\n    const kept = (id) => page.evaluate((id) => new Promise((res) => { const r = indexedDB.open(\"aura-theme-pictures\", 1); r.onsuccess = () => { const g = r.result.transaction(\"pics\").objectStore(\"pics\").get(id); g.onsuccess = () => res(!!g.result); g.onerror = () => res(false); }; r.onerror = () => res(false); }), id);\n    const secondPic = (await savedList()).find((x) => x.name === \"Red ocean\").background.pic;\n    check(\"saving over a theme keeps the new picture and lets go of the old one\", secondPic !== firstPic && (await kept(secondPic)) && !(await kept(firstPic)) && (await savedList()).filter((x) => x.name === \"Red ocean\").length === 1);\n    await tab(\"Saved\");\n    await row(\"Red ocean\").locator(\"button.btn-d\").click();\n    await page.waitForTimeout(500);\n    check(\"deleting a theme lets go of its picture\", !(await kept(secondPic)) && !(await savedList()).some((x) => x.name === \"Red ocean\"));\n\n    check(\"nothing crashed along the way\", (await page.locator(\".aura-fallback\").count()) === 0 && thrown.length === 0, thrown);\n  } finally {\n    await browser.close();\n    server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The theme backgrounds check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-theme-backgrounds.bak";
const MARK = "Added by aura-theme-backgrounds-setup.cjs";
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

function editApp(text) {
  if (text.includes("./components/themebg")) return { text, notes: [] };
  let t = text;
  const imp = /^import \{ useCloudGames, useCloudProfile \} from "\.\/cloudsync";\n/m;
  if (!imp.test(t)) throw new Error('the imports at the top ( import { useCloudGames, useCloudProfile } from "./cloudsync"; )');
  t = t.replace(imp, (m) => m + 'import { backgroundForTheme, resolveThemeBackground, forgetThemePicture, themePicture, isWebPicture } from "./components/themebg"; // a saved theme keeps its background (' + MARK + ")\n");

  // Saving: the background goes with the theme
  t = swapOnce(t,
    "              <button className=\"btn-p\" style={{flexShrink:0}} onClick={()=>{\n" +
    "                if(!saveName.trim()) return;\n" +
    "                onSaveTheme({name:saveName.trim(),colors:{...local},accent,ac2:ac2color,themeName:theme});\n" +
    "                setSaveName(\"\");\n" +
    "              }}>Save</button>\n",
    "              <button className=\"btn-p\" style={{flexShrink:0}} onClick={async()=>{\n" +
    "                if(!saveName.trim()) return;\n" +
    "                const name=saveName.trim();\n" +
    "                // The background showing now is saved with it (" + MARK + ")\n" +
    "                const background=await backgroundForTheme(bgImage);\n" +
    "                onSaveTheme({name,colors:{...local},accent,ac2:ac2color,themeName:theme,...(background?{background}:{})});\n" +
    "                setSaveName(\"\");\n" +
    "              }}>Save</button>\n",
    "the Save button in Customize > Saved");
  t = swapOnce(t, '            <div style={{fontSize:11,color:"var(--t3)",marginBottom:16}}>Save your current theme settings as a named preset.</div>\n',
    '            <div style={{fontSize:11,color:"var(--t3)",marginBottom:16}}>Save your current colors and background as a named theme. Loading it brings back both.</div>\n',
    "the Saved tab's note");
  // The list: a little picture of each theme, with its background
  t = swapOnce(t,
    '                      <div style={{width:44,height:44,borderRadius:10,background:swatchBg,border:"1px solid rgba(255,255,255,.08)",flexShrink:0,position:"relative",overflow:"hidden"}}>\n',
    '                      <div style={{width:44,height:44,borderRadius:10,background:swatchBg,border:"1px solid rgba(255,255,255,.08)",flexShrink:0,position:"relative",overflow:"hidden"}}>\n' +
    '                        <ThemeBgThumb background={t.background}/>{/* (' + MARK + ') */}\n',
    "the saved theme's swatch");
  t = swapOnce(t,
    '                        <div style={{fontSize:10,color:"var(--t3)",marginTop:2}}>{t.themeName||"Custom"} · <span style={{color:swatchAc}}>{swatchAc}</span></div>\n',
    '                        <div style={{fontSize:10,color:"var(--t3)",marginTop:2}}>{t.themeName||"Custom"} · <span style={{color:swatchAc}}>{swatchAc}</span>{t.background?.kind==="web"||t.background?.kind==="pic"?" · with background":t.background?.kind==="none"?" · no background":""}</div>\n',
    "the saved theme's description");
  // Customize keeps its boxes in step when a theme is loaded
  t = swapOnce(t, "  const updateLocal = (key, val) => { const updated={...local,[key]:val};setLocal(updated);if(theme===\"custom\") onCustomColorsChange(updated); };\n",
    "  // A theme was loaded (or synced): the colour boxes and the background box show it (" + MARK + ")\n" +
    "  useEffect(()=>{ if(customColors){ setLocal(customColors); if(customColors.ac2) setAc2color(customColors.ac2); } },[customColors]);\n" +
    "  useEffect(()=>{ setBgInput(bgImage||\"\"); },[bgImage]);\n" +
    "  const updateLocal = (key, val) => { const updated={...local,[key]:val};setLocal(updated);if(theme===\"custom\") onCustomColorsChange(updated); };\n",
    "the custom colour editor ( const updateLocal = ... )");
  // The thumbnail
  t = swapOnce(t, "function Customize({ theme, onThemeChange,",
    "// A saved theme's background, small (" + MARK + ")\n" +
    "function ThemeBgThumb({ background }) {\n" +
    "  const [src, setSrc] = useState(background?.kind === \"web\" && isWebPicture(background.url) ? background.url : \"\");\n" +
    "  useEffect(() => { let alive = true; if (background?.kind === \"pic\") themePicture(background.pic).then((p) => { if (alive && p) setSrc(p); }); return () => { alive = false; }; }, [background?.kind, background?.pic]);\n" +
    "  if (!src) return null;\n" +
    "  return <div className=\"theme-bg-thumb\" style={{ position: \"absolute\", inset: 0, backgroundImage: `url(\"${src.replace(/\"/g, \"%22\")}\")`, backgroundSize: \"cover\", backgroundPosition: \"center\", opacity: .85 }} />;\n" +
    "}\n" +
    "function Customize({ theme, onThemeChange,",
    "the Customize page ( function Customize({ ... )");
  // Saving over a name, and deleting: let go of a picture no theme uses any more
  t = swapOnce(t,
    "  const saveCustomTheme2 = useCallback((named) => {\n" +
    "    const updated = [...savedThemes.filter(t=>t.name!==named.name), named];\n" +
    "    setSavedThemes(updated);\n" +
    "    localStorage.setItem(\"aura_saved_themes\", JSON.stringify(updated));\n",
    "  // A picture kept for a theme that no saved theme uses any more is let go of (" + MARK + ")\n" +
    "  const dropUnusedPicture = (gone, still) => { const id = gone?.background?.kind === \"pic\" ? gone.background.pic : \"\"; if (id && !still.some((x) => x.background?.kind === \"pic\" && x.background.pic === id)) forgetThemePicture(id); };\n" +
    "  const saveCustomTheme2 = useCallback((named) => {\n" +
    "    const before = savedThemes.find(t=>t.name===named.name);\n" +
    "    const updated = [...savedThemes.filter(t=>t.name!==named.name), named];\n" +
    "    if (before) dropUnusedPicture(before, updated);\n" +
    "    setSavedThemes(updated);\n" +
    "    try { localStorage.setItem(\"aura_saved_themes\", JSON.stringify(updated)); } catch {}\n",
    "where a theme is saved ( const saveCustomTheme2 = ... )");
  t = swapOnce(t,
    "  const deleteCustomTheme2 = useCallback((name) => {\n" +
    "    const updated = savedThemes.filter(t=>t.name!==name);\n" +
    "    setSavedThemes(updated);\n" +
    "    localStorage.setItem(\"aura_saved_themes\", JSON.stringify(updated));\n",
    "  const deleteCustomTheme2 = useCallback((name) => {\n" +
    "    const updated = savedThemes.filter(t=>t.name!==name);\n" +
    "    dropUnusedPicture(savedThemes.find(t=>t.name===name), updated);\n" +
    "    setSavedThemes(updated);\n" +
    "    try { localStorage.setItem(\"aura_saved_themes\", JSON.stringify(updated)); } catch {}\n",
    "where a theme is deleted ( const deleteCustomTheme2 = ... )");
  // Loading: colours and background together
  t = swapOnce(t,
    "              setCustomColors(colors); saveCustomTheme(colors);\n" +
    "              applyTheme(themeKey, ac, colors);\n" +
    "            }}\n",
    "              setCustomColors(colors); saveCustomTheme(colors);\n" +
    "              applyTheme(themeKey, ac, colors);\n" +
    "              // Its background too (themes saved before this kept only colours, so those leave it as it is) (" + MARK + ")\n" +
    "              if (t.background) resolveThemeBackground(t.background).then((bg) => {\n" +
    "                if (bg === null) { toast(`\"${t.name}\" loaded. Its background picture is on another PC, so yours stayed the same.`); return; }\n" +
    "                try { localStorage.setItem(\"aura_bg_theme_for\", bgKey(bg)); } catch {} // the saved colours stay (not re-matched to the picture)\n" +
    "                setBgImage(bg); try { localStorage.setItem(\"aura_bg\", bg || \"\"); } catch {}\n" +
    "                toast(`\"${t.name}\" loaded`);\n" +
    "              });\n" +
    "              else toast(`\"${t.name}\" loaded`);\n" +
    "            }}\n",
    "where a saved theme is loaded ( onLoadTheme={(t)=>{ ... }} )");
  return { text: t, notes: [
    "saving a theme (Customize > Saved) also saves the background showing (picture, web link or none)",
    "loading a theme changes the colors and the background together",
    "each saved theme shows its background in its little picture",
  ] };
}

// ── AURA's checks (only when they are installed) ─────────────────────────────
function editRunner(text) {
  if (/theme-backgrounds\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  let at = -1;
  for (let i = 0; i < lines.length; i++) if (/add\("window",/.test(lines[i])) at = i;
  if (at < 0) return { text, notes: ["(couldn't find where to add the check, so npm test doesn't include it)"] };
  lines.splice(at + 1, 0, 'if (fs.existsSync(path.join(__dirname, "theme-backgrounds.cjs"))) add("window", "Saved themes keep their background", "theme-backgrounds.cjs");');
  return { text: lines.join("\n"), notes: ["npm test now checks saved theme backgrounds too"] };
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
      } else if ((entry.name === "theme-backgrounds.cjs" || entry.name === "themebg.js")) {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. Saved themes keep only their colors again." : "Nothing to undo.");
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
  const runner = path.join(ROOT, "tests", "run.cjs");
  const hasChecks = fs.existsSync(runner);
  if (hasChecks) consider("checks", runner, editRunner, true);

  const created = [{ label: "backgrounds", file: path.join(path.dirname(files.app), "components", "themebg.js"), content: FILES.themebg }];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "theme-backgrounds.cjs"), content: FILES.test });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: saved themes keep their background");
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
  say("Done. Restart AURA (stop it in the terminal and start it again). Save a theme in Customize > Saved: its background is saved with it.");
  if (hasChecks) say("Run  npm test  before your next release.");
  say("To undo later:  node aura-theme-backgrounds-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
