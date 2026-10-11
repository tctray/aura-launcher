#!/usr/bin/env node
/**
 * AURA — a cleaner update notice
 *
 * The notice in the bottom right when AURA has an update:
 *   - Update available:   a plain download icon, "Update available", the version, and two
 *                         buttons: Later and Download.
 *   - Downloading update: the percentage and a plain progress bar.
 *   - Download complete:  a green check mark, "Download complete", and two buttons: Later and
 *                         Restart now. It says the update also installs when AURA is next closed.
 *   - The sparkle and rocket emoji, the lightning bolt, the pulsing glow and the gradient
 *     buttons are gone.
 * Settings > About: "Up to date" has a green check mark, and its buttons use the same wording.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-update-notice-setup.cjs
 *   4. Then:  npm test
 *
 * What it does:
 *   - edits    src/App.jsx                the notice, its styles, and the Settings update button
 *   - creates  tests/update-notice.cjs    (only if AURA's checks are installed) checks it
 *   - edits    tests/run.cjs              (same) so npm test runs it
 *
 * Every file it changes is copied to <name>.before-update-notice.bak first.
 * To put everything back:                 node aura-update-notice-setup.cjs --undo
 * To preview without changing anything:   node aura-update-notice-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const EDITS = [{"kind":"cut","file":"app","label":"the update notice: plain icons, a green check mark when the download is complete, Later and Download / Restart now buttons","from":"const UPDATE_CSS = `","to":"function AutoUpdater() {","done":".update-toast-icon.done{","maxLines":30,"text":"// The update notice (bottom right). Restyled by aura-update-notice-setup.cjs.\nconst UPDATE_CSS = `\n.update-toast{position:fixed;bottom:88px;right:20px;z-index:999;width:320px;box-sizing:border-box;text-align:left;background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px;box-shadow:0 16px 44px rgba(0,0,0,.55);animation:fadeUp .3s ease;font-family:'DM Sans',sans-serif;}\n.update-toast-hdr{display:flex;align-items:flex-start;gap:12px;}\n.update-toast-icon{flex-shrink:0;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:var(--acd);color:var(--ac);}\n.update-toast-icon.done{background:rgba(34,197,94,.15);color:#22c55e;}\n.update-toast-text{flex:1;min-width:0;}\n.update-toast-title{font-size:13.5px;font-weight:700;line-height:1.3;color:var(--t1);}\n.update-msg{font-size:12px;line-height:1.45;color:var(--t2);margin-top:2px;}\n.update-progress-wrap{height:4px;background:var(--hover);border-radius:2px;overflow:hidden;margin-top:14px;}\n.update-progress-bar{height:100%;background:var(--ac);border-radius:2px;transition:width .3s ease;}\n.update-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px;}\n.update-btn{border-radius:8px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;border:1px solid var(--border);background:transparent;color:var(--t2);transition:background .15s,color .15s,filter .15s;}\n.update-btn:hover{background:var(--hover);color:var(--t1);}\n.update-btn.primary{background:var(--ac);border-color:var(--ac);color:#fff;}\n.update-btn.primary:hover{background:var(--ac);color:#fff;filter:brightness(1.1);}\n.update-btn:focus-visible{outline:2px solid var(--ac);outline-offset:2px;}\n.update-ok{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--t2);}\n.update-ok svg{color:#22c55e;}\n.reduce-motion .update-toast{animation:none;}\n`;\n\n"},{"kind":"cut","file":"app","label":"the update notice: plain icons, a green check mark when the download is complete, Later and Download / Restart now buttons","from":"if (!state || dismissed) return null;","to":"// ── Settings ─","done":"{done && \"Download complete\"}","maxLines":48,"text":"  if (!state || dismissed) return null;\n  const done = state === \"ready\";\n\n  return (\n    <>\n      <style>{UPDATE_CSS}</style>\n      <div className=\"update-toast\" role=\"status\" aria-live=\"polite\">\n        <div className=\"update-toast-hdr\">\n          <span className={\"update-toast-icon\" + (done ? \" done\" : \"\")} aria-hidden=\"true\">\n            {done\n              ? <svg viewBox=\"0 0 24 24\" width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"2.6\" strokeLinecap=\"round\" strokeLinejoin=\"round\"><path d=\"M5 12.5l4.5 4.5L19 7.5\"/></svg>\n              : <svg viewBox=\"0 0 24 24\" width=\"17\" height=\"17\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"2.2\" strokeLinecap=\"round\" strokeLinejoin=\"round\"><path d=\"M12 4v11\"/><path d=\"M7 10.5l5 5 5-5\"/><path d=\"M5 20h14\"/></svg>}\n          </span>\n          <div className=\"update-toast-text\">\n            <div className=\"update-toast-title\">\n              {state===\"available\" && \"Update available\"}\n              {state===\"downloading\" && \"Downloading update\"}\n              {done && \"Download complete\"}\n            </div>\n            <div className=\"update-msg\">\n              {state===\"available\" && (version ? \"AURA \" + version : \"A new version of AURA\") + \" is ready to download.\"}\n              {state===\"downloading\" && progress + \"% downloaded\"}\n              {done && \"Restart AURA to finish updating\" + (version ? \" to \" + version : \"\") + \". It also installs the next time you close AURA.\"}\n            </div>\n          </div>\n        </div>\n        {state===\"downloading\"&&(\n          <div className=\"update-progress-wrap\"><div className=\"update-progress-bar\" style={{width:`${progress}%`}}/></div>\n        )}\n        {state===\"available\"&&(\n          <div className=\"update-actions\">\n            <button type=\"button\" className=\"update-btn\" onClick={()=>setDismissed(true)}>Later</button>\n            <button type=\"button\" className=\"update-btn primary\" onClick={async()=>{setState(\"downloading\");const r=await window.electronAPI.downloadUpdate?.();if(!r?.success) setDismissed(true);}}>Download</button>\n          </div>\n        )}\n        {done&&(\n          <div className=\"update-actions\">\n            <button type=\"button\" className=\"update-btn\" onClick={()=>setDismissed(true)}>Later</button>\n            <button type=\"button\" className=\"update-btn primary\" onClick={()=>window.electronAPI.installUpdate?.()}>Restart now</button>\n          </div>\n        )}\n      </div>\n    </>\n  );\n}\n\n\n"},{"kind":"replace","file":"app","label":"Settings: \"Up to date\" has a green check mark, and the update buttons use the same plain wording","done":"<span className=\"update-ok\">","before":"if (status === \"latest\")   return <span style={{fontSize:11,color:\"var(--ac)\"}}>Up to date ✓</span>;","text":"if (status === \"latest\")   return <><style>{UPDATE_CSS}</style><span className=\"update-ok\"><svg viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"3\" strokeLinecap=\"round\" strokeLinejoin=\"round\" aria-hidden=\"true\"><path d=\"M5 12.5l4.5 4.5L19 7.5\"/></svg>Up to date</span></>;"},{"kind":"re","file":"app","label":"Settings: \"Up to date\" has a green check mark, and the update buttons use the same plain wording","re":"^([ \\t]*)\\}\\} style=\\{\\{fontSize:11,padding:\"5px 14px\",animation:\"pulse 2s infinite\"\\}\\}>\\n[ \\t]*v\\{latest\\} — Download\\n","done":"Download v{latest}","text":"    }} style={{fontSize:11,padding:\"5px 14px\"}}>\n      Download v{latest}\n"},{"kind":"replace","file":"app","label":"Settings: \"Up to date\" has a green check mark, and the update buttons use the same plain wording","done":"style={{fontSize:11,padding:\"5px 14px\"}}>Restart now</button>","before":"<button className=\"btn-p\" onClick={()=>window.electronAPI.installUpdate?.()} style={{fontSize:11,padding:\"5px 14px\"}}>⚡ Restart &amp; Update</button>","text":"<button className=\"btn-p\" onClick={()=>window.electronAPI.installUpdate?.()} style={{fontSize:11,padding:\"5px 14px\"}}>Restart now</button>"},{"kind":"insert","file":"runner","label":"npm test now checks the update notice","after":"add(\"window\", \"The window opens and every page loads\", \"window.cjs\");","done":"update-notice.cjs","text":"if (fs.existsSync(path.join(__dirname, \"update-notice.cjs\"))) add(\"window\", \"The update notice\", \"update-notice.cjs\");\n"}];
const FILES = {"notice":"// The update notice (bottom right), and the update button in Settings.\n//\n// Opens the built window (dist) in a real browser with a pretend desktop side, plays through an\n// update the way the installed app reports one, and checks each step:\n//   - Update available:   plain icon, the version, Later and Download\n//   - Downloading update: the percentage and a progress bar, nothing to press\n//   - Download complete:  a green check mark, Later and Restart now\n//   - no emoji anywhere in it\n//   - Settings: \"Up to date\" with a green check mark; Download and Restart now when there is one\n// Added by aura-update-notice-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\nconst EMOJI = /\\p{Extended_Pictographic}/u;\n\n(async () => {\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(process.env.CI ? 1 : 3); }\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch(options); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with. Run  npx playwright install chromium  once to add one.\"); return done(process.env.CI ? 1 : 3); }\n\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(DIST, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => {\n      if (err) { res.writeHead(404); return res.end(); }\n      res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" });\n      res.end(data);\n    });\n  });\n  await new Promise((r) => server.listen(0, \"127.0.0.1\", r));\n  const base = \"http://127.0.0.1:\" + server.address().port;\n\n  // Start AURA logged in. `latest` is the newest version the pretend GitHub has.\n  async function start({ latest = \"1.16.0\" } = {}) {\n    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();\n    const thrown = [];\n    page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());\n    await page.addInitScript(({ latest }) => {\n      try { localStorage.clear(); localStorage.setItem(\"aura_profile\", JSON.stringify({ username: \"tester\", avatar: \"\", userId: \"user-1\" })); } catch {}\n      window.__calls = [];\n      window.__tell = {}; // what the desktop side would tell the window: update found, progress, ready\n      const ok = (data) => Promise.resolve({ success: true, data });\n      const account = { getSession: () => ok({ id: \"user-1\", email: \"me@example.com\" }), getMyProfile: () => ok({ username: \"tester\", avatar_url: null }), saveProfile: (name, picture) => ok({ username: name, avatar_url: picture || null }) };\n      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => (name === \"auraCloud\" && account[key]) ? account[key](...args) : ok(null)) });\n      window.auraCloud = fake(\"auraCloud\");\n      window.auraSocial = fake(\"auraSocial\");\n      const desktop = {\n        checkUpdate: () => Promise.resolve({ success: true, current: \"1.16.0\", latest, hasUpdate: latest !== \"1.16.0\" }),\n        downloadUpdate: () => Promise.resolve({ success: true }),\n        installUpdate: () => Promise.resolve({ success: true }),\n      };\n      window.electronAPI = new Proxy({}, {\n        get: (_t, key) => {\n          if (key === \"isElectron\") return true;\n          if (typeof key !== \"string\" || key === \"then\") return undefined;\n          if (/^on[A-Z]/.test(key)) return (cb) => { window.__tell[key] = cb; return () => {}; };\n          if (/^remove/.test(key)) return () => {};\n          return (...args) => { window.__calls.push(key); return desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }); };\n        },\n      });\n    }, { latest });\n    await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n    await page.waitForTimeout(4500);\n    const tell = async (what, value) => { await page.evaluate(([w, v]) => window.__tell[w] && window.__tell[w](v), [what, value]); await page.waitForTimeout(350); };\n    const calls = (name) => page.evaluate((n) => window.__calls.filter((k) => k === n).length, name);\n    const notice = () => page.evaluate(() => {\n      const box = document.querySelector(\".update-toast\");\n      if (!box) return null;\n      const icon = box.querySelector(\".update-toast-icon\"), bar = box.querySelector(\".update-progress-bar\");\n      return {\n        title: box.querySelector(\".update-toast-title\")?.textContent.trim() || \"\", text: box.querySelector(\".update-msg\")?.textContent.trim() || \"\", all: box.innerText,\n        buttons: [...box.querySelectorAll(\"button\")].map((b) => b.textContent.trim()),\n        icon: icon ? { colour: getComputedStyle(icon).color, drawn: !!icon.querySelector(\"svg path\"), done: icon.classList.contains(\"done\") } : null,\n        bar: bar ? Math.round((bar.getBoundingClientRect().width / bar.parentElement.getBoundingClientRect().width) * 100) : null,\n        moving: getComputedStyle(box).animationIterationCount === \"infinite\" || [...box.querySelectorAll(\"*\")].some((e) => getComputedStyle(e).animationIterationCount === \"infinite\"),\n      };\n    });\n    return { page, thrown, tell, calls, notice };\n  }\n  const green = (colour) => { const [r, g, b] = (String(colour).match(/\\d+/g) || []).map(Number); return g > 150 && g > r + 60 && g > b + 60; };\n\n  try {\n    console.log(\"1. An update is found\");\n    let app = await start();\n    check(\"no notice while there is nothing to say\", (await app.notice()) === null);\n    await app.tell(\"onUpdateAvailable\", \"1.17.0\");\n    let n = await app.notice();\n    check(\"it says an update is available, and which version\", !!n && n.title === \"Update available\" && /AURA 1\\.17\\.0 is ready to download/.test(n.text), n);\n    check(\"with two buttons: Later and Download\", !!n && n.buttons.join(\"|\") === \"Later|Download\", n && n.buttons);\n    check(\"a plain drawn icon, no emoji\", !!n && !!n.icon && n.icon.drawn && !n.icon.done && !EMOJI.test(n.all), n && n.all);\n    check(\"nothing pulses or shimmers\", !!n && !n.moving);\n    await app.page.locator(\".update-toast\").getByText(\"Later\", { exact: true }).click({ timeout: 4000 });\n    await app.page.waitForTimeout(300);\n    check(\"Later puts it away\", (await app.notice()) === null && (await app.calls(\"downloadUpdate\")) === 0);\n    await app.tell(\"onUpdateAvailable\", \"1.17.0\");\n    check(\"it comes back the next time AURA is told about the update\", !!(await app.notice()));\n\n    console.log(\"2. Downloading\");\n    await app.page.locator(\".update-toast\").getByText(\"Download\", { exact: true }).click({ timeout: 4000 });\n    await app.page.waitForTimeout(300);\n    check(\"Download starts the download\", (await app.calls(\"downloadUpdate\")) === 1);\n    await app.tell(\"onUpdateProgress\", 42.4);\n    await app.page.waitForTimeout(400);\n    n = await app.notice();\n    check(\"it shows how far along it is, in words and as a bar\", !!n && n.title === \"Downloading update\" && n.text === \"42% downloaded\" && n.bar >= 40 && n.bar <= 44, n);\n    check(\"with nothing to press, and no emoji\", !!n && n.buttons.length === 0 && !EMOJI.test(n.all), n && n.buttons);\n\n    console.log(\"3. Download complete\");\n    await app.tell(\"onUpdateReady\");\n    n = await app.notice();\n    check(\"it says the download is complete\", !!n && n.title === \"Download complete\", n);\n    check(\"with a green check mark\", !!n && !!n.icon && n.icon.done && n.icon.drawn && green(n.icon.colour), n && n.icon);\n    check(\"it says to restart, names the version, and that closing AURA installs it too\", !!n && /Restart AURA to finish updating to 1\\.17\\.0\\./.test(n.text) && /next time you close AURA/.test(n.text), n && n.text);\n    check(\"with two buttons: Later and Restart now\", !!n && n.buttons.join(\"|\") === \"Later|Restart now\", n && n.buttons);\n    check(\"and no emoji\", !!n && !EMOJI.test(n.all), n && n.all);\n    await app.page.locator(\".update-toast\").getByText(\"Restart now\", { exact: true }).click({ timeout: 4000 });\n    await app.page.waitForTimeout(300);\n    check(\"Restart now restarts AURA into the update\", (await app.calls(\"installUpdate\")) === 1);\n    await app.page.locator(\".update-toast\").getByText(\"Later\", { exact: true }).click({ timeout: 4000 });\n    await app.page.waitForTimeout(300);\n    check(\"Later puts it away\", (await app.notice()) === null);\n    check(\"nothing crashed along the way\", (await app.page.locator(\".aura-fallback\").count()) === 0, app.thrown);\n    await app.page.context().close();\n\n    console.log(\"4. When the version isn't known\");\n    app = await start();\n    await app.tell(\"onUpdateReady\");\n    n = await app.notice();\n    check(\"the notice still reads properly\", !!n && n.title === \"Download complete\" && /^Restart AURA to finish updating\\. It also installs/.test(n.text) && !/undefined|null/.test(n.all), n && n.text);\n    await app.page.context().close();\n\n    console.log(\"5. Settings\");\n    const settings = async (app) => { await app.page.locator('.gm-rail-item[title=\"Settings\"], .sb-item[title=\"Settings\"]').first().click({ timeout: 5000 }); await app.page.waitForTimeout(900); };\n    app = await start();\n    await settings(app);\n    const upToDate = app.page.locator(\".update-ok\").first();\n    await upToDate.scrollIntoViewIfNeeded({ timeout: 5000 });\n    const mark = await upToDate.evaluate((el) => ({ text: el.textContent.trim(), tick: el.querySelector(\"svg\") ? getComputedStyle(el.querySelector(\"svg\")).color : \"\" }));\n    check(\"with no update: \\\"Up to date\\\" and a green check mark\", mark.text === \"Up to date\" && green(mark.tick), mark);\n    await app.page.context().close();\n    app = await start({ latest: \"1.17.0\" });\n    await settings(app);\n    const download = app.page.getByRole(\"button\", { name: \"Download v1.17.0\", exact: true });\n    await download.scrollIntoViewIfNeeded({ timeout: 5000 });\n    check(\"with an update: a Download button that names the version, and doesn't pulse\", (await download.evaluate((el) => getComputedStyle(el).animationName)) === \"none\");\n    await download.click({ timeout: 4000 });\n    await app.page.waitForTimeout(500);\n    const restart = app.page.getByRole(\"button\", { name: \"Restart now\", exact: true }).first();\n    check(\"after it downloads: a Restart now button\", (await app.calls(\"downloadUpdate\")) === 1 && (await restart.isVisible()));\n    await restart.click({ timeout: 4000 });\n    await app.page.waitForTimeout(300);\n    check(\"which restarts AURA into the update\", (await app.calls(\"installUpdate\")) === 1);\n    await app.page.context().close();\n\n    console.log(\"6. The code\");\n    const source = (() => { try { return fs.readFileSync(path.join(ROOT, \"src\", \"App.jsx\"), \"utf8\"); } catch { return \"\"; } })();\n    const from = source.indexOf(\"const UPDATE_CSS\"), to = source.indexOf(\"function UpdateButton\");\n    const end = to < 0 ? -1 : source.indexOf(\"\\n}\\n\", to);\n    const part = from >= 0 && end > from ? source.slice(from, end) : \"\";\n    check(\"no emoji is left in the update notice or the Settings update button\", part.length > 1500 && !EMOJI.test(part) && !/✓|⚡|↓/.test(part), (part.match(/\\p{Extended_Pictographic}|✓|⚡|↓/gu) || []).join(\" \"));\n  } finally {\n    await browser.close();\n    server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The update notice check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-update-notice.bak";
const MARK = "Added by aura-update-notice-setup.cjs";
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "release", ".git", ".vite", "coverage"]);
const CREATED = ["update-notice.cjs"];
const RETIRED = [];

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
const count = (text, piece) => (piece ? text.split(piece).length - 1 : 0);

// ── One edit ──────────────────────────────────────────────────────────────────
// Each returns the new text and whether it changed anything. If the place it is looking for
// isn't there, that is fine when the edit was already made (its "done" text is present) or when
// the edit only removes something that is already gone. Anything else is a problem.
function applyEdit(text, edit) {
  const already = () => {
    if (edit.done && text.includes(edit.done)) return { text, changed: false };
    if (edit.missingOk) return { text, changed: false };
    throw new Error(edit.kind === "cut" || edit.kind === "insert" ? "the line  " + (edit.from || edit.after || edit.aheadOf).trim() : "the part for: " + edit.label);
  };
  if (edit.done && text.includes(edit.done)) return { text, changed: false };

  if (edit.kind === "replace") {
    const n = count(text, edit.before);
    if (n === 0) return already();
    if (n > 1) throw new Error("exactly one of  " + edit.before.slice(0, 70) + "  (there are " + n + ")");
    return { text: text.replace(edit.before, () => edit.text), changed: true };
  }

  if (edit.kind === "re") {
    const re = new RegExp(edit.re, "m");
    if (!re.test(text)) return already();
    return { text: text.replace(re, () => edit.text), changed: true };
  }

  const lines = text.split("\n");
  if (edit.kind === "insert") {
    const anchor = edit.after || edit.aheadOf;
    const hits = lines.map((l, i) => (l.includes(anchor) ? i : -1)).filter((i) => i >= 0);
    if (!hits.length) return already();
    if (hits.length > 1) throw new Error("exactly one line with  " + anchor.trim() + "  (there are " + hits.length + ")");
    lines.splice(hits[0] + (edit.after ? 1 : 0), 0, ...edit.text.replace(/\n$/, "").split("\n"));
    return { text: lines.join("\n"), changed: true };
  }

  if (edit.kind === "cut") {
    const starts = lines.map((l, i) => (l.includes(edit.from) ? i : -1)).filter((i) => i >= 0);
    if (!starts.length) return already();
    if (starts.length > 1) throw new Error("exactly one line with  " + edit.from.trim() + "  (there are " + starts.length + ")");
    const a = starts[0];
    let b = -1;
    for (let i = a + 1; i < lines.length; i++) if (lines[i].includes(edit.to)) { b = i; break; }
    if (b < 0) throw new Error("the line  " + edit.to.trim() + "  after  " + edit.from.trim());
    if (edit.maxLines && b - a > edit.maxLines) throw new Error("the part from  " + edit.from.trim() + "  where I expected it (it is longer than it should be)");
    // Never remove more than was meant: only these handlers may be inside the part taken out
    if (edit.only) {
      const inside = lines.slice(a, b).join("\n");
      const others = [...inside.matchAll(/ipcMain\.(?:handle|on)\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]).filter((name) => !edit.only.includes(name));
      if (others.length) throw new Error("the part from  " + edit.from.trim() + "  on its own (" + others.join(", ") + " is in the middle of it)");
    }
    const put = edit.text ? edit.text.replace(/\n$/, "").split("\n") : [];
    lines.splice(a, b - a, ...put);
    return { text: lines.join("\n"), changed: true };
  }
  throw new Error("how to make the change: " + edit.label);
}

// After the edits, none of these may be left, and all of the second list must be there. If not,
// an edit didn't fit this copy of AURA, and nothing is written.
const LEFTOVERS = {
  app: ['"🚀"', '"✨"', "⚡ Restart", "↓ Download Now", "updatePulse", "progressShimmer", "Up to date ✓"],
};
const REQUIRED = {
  app: [".update-toast-icon.done{", '"Download complete"', '"Update available"'],
};

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
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) visit(full, depth + 1);
      } else if (entry.name.endsWith(BAK)) {
        const target = full.slice(0, -BAK.length);
        fs.copyFileSync(full, target); fs.unlinkSync(full);
        say("  restored  " + rel(target)); restored++;
      } else if (CREATED.includes(entry.name)) {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. Everything is back to how it was." : "Nothing to undo.");
  say();
}

// ── Run ───────────────────────────────────────────────────────────────────────
function run() {
  const pkgFile = path.join(ROOT, "package.json");
  if (!fs.existsSync(pkgFile)) stop(["This isn't your AURA project folder (no package.json here).", "Move this file next to package.json and run it from there."]);
  if (UNDO) return undo();

  const where = {
    app: { file: path.join(ROOT, "src", "App.jsx"), name: "window", js: false },
    runner: { file: path.join(ROOT, "tests", "run.cjs"), name: "checks", js: true, optional: true },
  };
  const missing = Object.values(where).filter((w) => !w.optional && !fs.existsSync(w.file)).map((w) => rel(w.file));
  if (missing.length) stop(["I couldn't find " + missing.join(" or ") + ".", "Make sure this file is in your AURA project folder, next to package.json.", "Copy this message to Claude."]);
  const hasChecks = fs.existsSync(where.runner.file);

  const plan = [];
  const problems = [];
  for (const [key, w] of Object.entries(where)) {
    if (w.optional && !fs.existsSync(w.file)) continue;
    const { text, eol } = readText(w.file);
    let now = text;
    const notes = [];
    for (const edit of EDITS.filter((e) => e.file === key)) {
      try {
        const result = applyEdit(now, edit);
        if (result.changed) { now = result.text; if (!notes.includes(edit.label)) notes.push(edit.label); }
      } catch (e) { problems.push("In " + rel(w.file) + " I couldn't find " + e.message + "."); }
    }
    const left = (LEFTOVERS[key] || []).filter((piece) => now.includes(piece));
    if (left.length) problems.push("In " + rel(w.file) + " I couldn't safely remove: " + left.join(", ") + ".");
    const absent = (REQUIRED[key] || []).filter((piece) => !now.includes(piece));
    if (absent.length) problems.push("In " + rel(w.file) + " I couldn't put in: " + absent.join(", ") + ".");
    if (w.js && now !== text) { const bad = syntaxProblem(now); if (bad) problems.push("In " + rel(w.file) + " I couldn't find a way to edit it safely (" + bad + ")."); }
    plan.push({ label: w.name, file: w.file, before: text, after: now, eol, notes });
  }

  const created = [];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "update-notice.cjs"), content: FILES.notice });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: a cleaner update notice");
  say();
  for (const step of plan) {
    if (step.after !== step.before && !DRY) {
      const bak = step.file + BAK;
      if (!fs.existsSync(bak)) fs.copyFileSync(step.file, bak);
      fs.writeFileSync(step.file, withEol(step.after, step.eol));
    }
    say("  " + (step.label + ":").padEnd(11) + rel(step.file));
    (step.notes.length ? step.notes : ["already done"]).forEach((n) => say("             - " + n));
  }
  for (const c of created) {
    if (c.note !== "already done" && !DRY) { fs.mkdirSync(path.dirname(c.file), { recursive: true }); fs.writeFileSync(c.file, c.content); }
    say("  " + (c.label + ":").padEnd(11) + rel(c.file));
    say("             - " + c.note);
  }
  for (const r of RETIRED) {
    const file = path.join(ROOT, r.file);
    let mine = false;
    try { mine = fs.readFileSync(file, "utf8").includes(r.mark); } catch {}
    if (!mine) continue;
    if (!DRY) { const bak = file + BAK; if (!fs.existsSync(bak)) fs.copyFileSync(file, bak); fs.unlinkSync(file); }
    say("  " + "checks:".padEnd(11) + rel(file));
    say("             - removed (the new check covers it)");
  }
  say();
  if (DRY) { say("Run it again without --dry-run to apply."); say(); return; }
  say("Done. Next:");
  if (hasChecks) say("  1. Check everything still works:   npm test");
  say("  " + (hasChecks ? "2" : "1") + ". The notice only shows in the installed AURA when a newer release is out, so you will");
  say("     first see the new look on the release after this one.");
  say();
  say("To undo later:  node aura-update-notice-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
