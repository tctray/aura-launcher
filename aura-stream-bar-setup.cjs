#!/usr/bin/env node
/**
 * AURA — the stream's Close button is always reachable
 *
 * While a game was running, the Now Playing bar along the bottom of AURA covered the bar under
 * the stream (with Full, Hide Chat and Close), so there was no way to find Close.
 *   - That bar is now above the stream, so it's always in sight.
 *   - While a game is playing, the stream and its chat stop above the Now Playing bar instead of
 *     going under it.
 *   - The chat opens in its own spot on the right straight away (it used to open over the
 *     player for a moment).
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-stream-bar-setup.cjs
 *
 * What it does:
 *   - edits    src/App.jsx              moves the stream's buttons, keeps clear of Now Playing
 *   - creates  tests/stream-bar.cjs     (only if AURA's checks are installed) checks it
 *
 * Every file it changes is copied to <name>.before-stream-bar.bak first.
 * To put everything back:                 node aura-stream-bar-setup.cjs --undo
 * To preview without changing anything:   node aura-stream-bar-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FILES = {"test":"// Live Streams: the stream's buttons (Full, Hide Chat, Close) can always be reached.\n//\n// The Now Playing bar sits along the bottom of AURA while a game is running. The stream's\n// buttons used to be under the player, right where that bar is, so Close couldn't be found.\n// This opens the built window (dist) in a real browser with a pretend desktop side, plays a\n// pretend stream and checks:\n//   - the buttons are above the player\n//   - with a game playing, the player and the chat stop above the Now Playing bar, and the\n//     Twitch player (a separate layer) is moved there too\n//   - the chat opens in its own spot, not over the player\n//   - Close shuts the stream\n// Added by aura-stream-bar-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\n\n(async () => {\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(process.env.CI ? 1 : 3); }\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch(options); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with. Run  npx playwright install chromium  once to add one.\"); return done(process.env.CI ? 1 : 3); }\n\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(DIST, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => {\n      if (err) { res.writeHead(404); return res.end(); }\n      res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" });\n      res.end(data);\n    });\n  });\n  await new Promise((r) => server.listen(0, \"127.0.0.1\", r));\n  const base = \"http://127.0.0.1:\" + server.address().port;\n\n  try {\n    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();\n    const thrown = [];\n    page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n    await page.route((url) => !String(url).startsWith(base) && !String(url).startsWith(\"data:\"), (route) => route.abort());\n    await page.addInitScript(() => {\n      try {\n        localStorage.clear();\n        localStorage.setItem(\"aura_profile\", JSON.stringify({ username: \"tester\", avatar: \"\", userId: \"user-1\" }));\n        localStorage.setItem(\"aura_games\", JSON.stringify([{ id: \"g1\", title: \"Arc Raiders\", exePath: \"C:\\\\Games\\\\ArcRaiders\\\\PioneerGame.exe\", cover: \"\", category: \"Action\", favorite: false, playCount: 3, lastPlayed: Date.now() - 3600000, addedAt: Date.now() - 86400000 }]));\n      } catch {}\n      window.__calls = [];\n      const ok = (data) => Promise.resolve({ success: true, data });\n      const account = {\n        getSession: () => ok({ id: \"user-1\", email: \"me@example.com\" }),\n        getMyProfile: () => ok({ username: \"tester\", avatar_url: null }),\n        getMyData: () => ok([]),\n        getMySessionIds: () => ok([]),\n      };\n      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => (name === \"auraCloud\" && account[key]) ? account[key](...args) : ok(null)) });\n      window.auraCloud = fake(\"auraCloud\");\n      window.auraSocial = fake(\"auraSocial\");\n      const picture = \"data:image/svg+xml;base64,\" + btoa('<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"440\" height=\"248\"><rect width=\"440\" height=\"248\" fill=\"#345\"/></svg>');\n      const stream = { id: \"s1\", user: \"Pokimane\", userLogin: \"pokimane\", title: \"Chill games\", game: \"Arc Raiders\", viewers: 7000, thumbnail: picture, url: \"https://twitch.tv/pokimane\" };\n      const desktop = { fetchTwitchStreams: () => Promise.resolve({ success: true, streams: [stream] }) };\n      window.electronAPI = new Proxy({}, {\n        get: (_t, key) => {\n          if (key === \"isElectron\") return true;\n          if (typeof key !== \"string\" || key === \"then\") return undefined;\n          if (key === \"onTwitchOpenStream\") return (cb) => { window.__openStream = cb; return () => { window.__openStream = null; }; };\n          if (key === \"onGameSessionStarted\") return (cb) => { window.__gameStarted = cb; return () => {}; };\n          if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};\n          return (...args) => { window.__calls.push([key, args]); return desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }); };\n        },\n      });\n    });\n    await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n    await page.waitForTimeout(4500);\n    const called = (name) => page.evaluate((n) => window.__calls.filter(([k]) => k === n).map(([, a]) => a[0]), name);\n    const box = (sel) => page.evaluate((s) => { const el = typeof s === \"string\" ? document.querySelector(s) : null; if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; }, sel);\n    // Where things are: the Close button, the player's box and the chat's box\n    const layout = () => page.evaluate(() => {\n      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; };\n      const close = [...document.querySelectorAll(\"button\")].find((b) => b.textContent.trim() === \"✕ Close\");\n      const bar = close && close.parentElement;\n      const player = bar && [...bar.parentElement.children].find((c) => c !== bar);\n      const chat = player && player.parentElement && player.parentElement.nextElementSibling;\n      let reachable = false;\n      if (close) { const c = r(close); const hit = document.elementFromPoint((c.left + c.right) / 2, (c.top + c.bottom) / 2); reachable = !!hit && (hit === close || close.contains(hit)); }\n      return { close: r(close), reachable, player: r(player), chat: r(chat), np: r(document.querySelector(\".now-playing\")), height: window.innerHeight };\n    });\n\n    console.log(\"1. A stream with no game running\");\n    await page.evaluate(() => window.__openStream && window.__openStream(\"pokimane\"));\n    await page.waitForTimeout(2600);\n    let at = await layout();\n    check(\"the stream opened\", (await called(\"streamOpen\")).length === 1 && !!at.close, await called(\"streamOpen\"));\n    check(\"Close, Full and Hide Chat are above the player\", at.close && at.close.bottom <= at.player.top + 1 && (await page.getByText(\"Hide Chat\").first().isVisible()) && (await page.getByText(\"⛶ Full\").first().isVisible()), at);\n    check(\"Close can be clicked (nothing is over it)\", at.reachable, at);\n    check(\"the player still reaches the bottom of the window\", at.player.bottom >= at.height - 2, at);\n    const chats = await called(\"chatOpen\");\n    const firstChat = chats[0] && chats[0].bounds;\n    check(\"the chat opens in its own spot on the right, not over the player\", !!firstChat && firstChat.x >= at.player.right - 2 && Math.abs(firstChat.x - at.chat.left) <= 2 && Math.abs(firstChat.y - at.chat.top) <= 2, { firstChat, at });\n\n    console.log(\"2. A game starts while the stream plays\");\n    await page.evaluate(() => window.__gameStarted && window.__gameStarted({ exePath: \"C:\\\\Games\\\\ArcRaiders\\\\PioneerGame.exe\", startTime: Date.now() }));\n    await page.waitForTimeout(1200);\n    at = await layout();\n    check(\"the Now Playing bar shows\", !!at.np && /Arc Raiders/.test(await page.locator(\".now-playing\").innerText()), at);\n    check(\"Close is still there and can be clicked\", at.reachable && at.close.bottom <= at.np.top, at);\n    check(\"the player stops above the Now Playing bar\", at.player.bottom <= at.np.top + 1, at);\n    check(\"the chat stops above it too\", !!at.chat && at.chat.bottom <= at.np.top + 1, at);\n    const restores = await called(\"streamRestore\");\n    const last = restores[restores.length - 1] || {};\n    const end = (b) => b ? b.y + b.height : Infinity;\n    check(\"the Twitch player and chat are moved up to match\", end(last.bounds) <= at.np.top + 1 && end(last.chatBounds) <= at.np.top + 1, last);\n    check(\"the Now Playing bar's Stop button can still be clicked\", await page.evaluate(() => { const b = document.querySelector(\".now-playing .np-close\"); if (!b) return false; const r = b.getBoundingClientRect(); const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2); return !!hit && (hit === b || b.contains(hit)); }));\n\n    console.log(\"3. Close\");\n    const before = (await called(\"streamClose\")).length;\n    await page.getByText(\"✕ Close\", { exact: true }).first().click({ timeout: 4000 });\n    await page.waitForTimeout(800);\n    check(\"Close shuts the stream and goes back to the list\", (await called(\"streamClose\")).length > before && (await page.getByText(\"Hide Chat\").count()) === 0);\n\n    console.log(\"4. The game stops\");\n    await page.locator(\".now-playing .np-close\").click({ timeout: 4000 });\n    await page.waitForTimeout(500);\n    await page.evaluate(() => window.__openStream && window.__openStream(\"pokimane\"));\n    await page.waitForTimeout(2200);\n    at = await layout();\n    check(\"without Now Playing, a stream uses the whole height again\", !at.np && at.player.bottom >= at.height - 2, at);\n\n    console.log(\"5. All of it\");\n    check(\"nothing crashed along the way\", (await page.locator(\".aura-fallback\").count()) === 0 && thrown.length === 0, thrown);\n  } finally {\n    await browser.close();\n    server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The stream buttons check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-stream-bar.bak";
const MARK = "Added by aura-stream-bar-setup.cjs";
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
  if (text.includes("streams-page")) return { text, notes: [] };
  let t = text;
  // 1. The bar with Full, Hide Chat and Close goes above the player, where nothing covers it
  const holder = '      <div ref={playerContainerRef} style={{flex:1,minHeight:0,background:"#000"}}>\n';
  const a = t.indexOf(holder);
  const barStart = t.indexOf("      {/* Stream info bar */}\n", a);
  const barEnd = t.indexOf("\n    </div>\n  ) : null;\n", barStart);
  if (a < 0 || barStart < 0 || barEnd < 0 || t.indexOf(holder, a + 1) >= 0) throw new Error("the stream player and the bar under it ( <div ref={playerContainerRef} ... {/* Stream info bar */} )");
  let bar = t.slice(barStart, barEnd + 1);
  const playerBox = t.slice(a, barStart);
  if (!bar.includes("✕ Close") || !bar.includes('borderTop:"1px solid var(--border)"')) throw new Error("the stream's Close button ( ✕ Close )");
  bar = bar.replace("      {/* Stream info bar */}\n", "      {/* Stream info bar: above the player, so the Now Playing bar can't cover Close (" + MARK + ") */}\n")
    .replace('borderTop:"1px solid var(--border)"', 'borderBottom:"1px solid var(--border)"');
  t = t.slice(0, a) + bar + playerBox + t.slice(barEnd + 1);
  // 2. While a game is playing, the page ends above the Now Playing bar (the player and chat too)
  t = swapOnce(t, '    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:activeStream?"var(--bg)":"transparent",height:"100%"}}>\n',
    '    <div className="streams-page" style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:activeStream?"var(--bg)":"transparent",height:"100%"}}>\n',
    "the Live Streams page ( <div style={{flex:1,...height:\"100%\"}}> )");
  t = swapOnce(t, ".np-cover{width:48px;",
    "/* Live Streams ends above the Now Playing bar, so it never covers the stream or its buttons (" + MARK + ") */\n" +
    "body:has(.now-playing) .streams-page{padding-bottom:72px;}\n" +
    ".np-cover{width:48px;",
    "the Now Playing bar's look ( .np-cover{width:48px; )");
  // 3. The chat opens over its own box, not over the player
  t = swapOnce(t,
    "        if (chatContainerRef.current && chatOpen && !restored?.success) {\n" +
    "          await window.electronAPI.chatOpen({\n" +
    "            channel: activeStream.userLogin || activeStream.user,\n" +
    "            bounds: { x: Math.round(pr.x), y: Math.round(pr.y), width: Math.round(pr.width), height: Math.round(pr.height) }\n",
    "        if (chatContainerRef.current && chatOpen && !restored?.success) {\n" +
    "          // The chat's own box (it used to open over the player) (" + MARK + ")\n" +
    "          const ch = chatContainerRef.current.getBoundingClientRect();\n" +
    "          await window.electronAPI.chatOpen({\n" +
    "            channel: activeStream.userLogin || activeStream.user,\n" +
    "            bounds: { x: Math.round(ch.x), y: Math.round(ch.y), width: Math.round(ch.width), height: Math.round(ch.height) }\n",
    "where the chat opens ( chatOpen({ ... bounds: pr ... }) )");
  return { text: t, notes: [
    "the bar with ⛶ Full, Hide Chat and ✕ Close is now above the stream",
    "while a game is playing, the stream and chat stop above the Now Playing bar",
    "the chat opens in its own spot on the right (not over the player first)",
  ] };
}

// ── AURA's checks (only when they are installed) ─────────────────────────────
function editRunner(text) {
  if (/stream-bar\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  let at = -1;
  for (let i = 0; i < lines.length; i++) if (/add\("window",/.test(lines[i])) at = i;
  if (at < 0) return { text, notes: ["(couldn't find where to add the check, so npm test doesn't include it)"] };
  lines.splice(at + 1, 0, 'if (fs.existsSync(path.join(__dirname, "stream-bar.cjs"))) add("window", "Live Streams: the stream\'s buttons are never covered", "stream-bar.cjs");');
  return { text: lines.join("\n"), notes: ["npm test now checks the stream's buttons too"] };
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
      } else if (entry.name === "stream-bar.cjs") {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. The stream's buttons are back under the player." : "Nothing to undo.");
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

  const created = [];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "stream-bar.cjs"), content: FILES.test });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: the stream's Close button");
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
  say("Done. Restart AURA (stop it in the terminal and start it again). On Live Streams, Full, Hide Chat and Close are now above the stream.");
  if (hasChecks) say("Run  npm test  before your next release.");
  say("To undo later:  node aura-stream-bar-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
