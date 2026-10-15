#!/usr/bin/env node
/**
 * AURA — achievements that count everything
 *
 * Before, only games added one at a time with "Add Game" counted toward Collector I and II, and
 * only games started with AURA's Play button counted toward First Launch, Explorer and the
 * streaks. Now these count too:
 *   - games imported from Steam, Epic or Xbox, and a library brought in from your account
 *   - games played from outside AURA (the ones on the Sessions page): playtime, different
 *     games played, days in a row, first launch
 * What you'd already done unlocks the next time AURA opens (several at once show as one notice).
 * The demo games AURA starts with don't count. Also fixed: one unlock could undo another.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-achievements-fix-setup.cjs
 *
 * What it does:
 *   - creates  src/achievements.js        counts what you've done
 *   - edits    src/App.jsx                checks achievements whenever anything changes
 *   - creates  tests/achievements.cjs     (only if AURA's checks are installed) checks it
 *
 * Every file it changes is copied to <name>.before-achievements-fix.bak first.
 * To put everything back:                 node aura-achievements-fix-setup.cjs --undo
 * To preview without changing anything:   node aura-achievements-fix-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FILES = {"ach":"// Achievements count everything you do, however a game got into AURA or was started:\n// games imported from Steam, Epic or Xbox, a library brought in from your account, and games\n// played from outside AURA (Sessions) all count. Added by aura-achievements-fix-setup.cjs\nconst num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);\nconst titleKey = (t) => String(t || \"\").trim().toLowerCase();\nconst dayStart = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };\n\n// The most days in a row with some play, from the times games were played\nexport function longestStreak(times) {\n  const days = [...new Set(times.filter((t) => Number.isFinite(t) && t > 0).map(dayStart))].sort((a, b) => a - b);\n  let best = 0, run = 0, prev = null;\n  for (const d of days) {\n    if (prev !== null) {\n      const p = new Date(prev);\n      const next = new Date(p.getFullYear(), p.getMonth(), p.getDate() + 1).getTime(); // safe across clock changes\n      run = d === next ? run + 1 : 1;\n    } else run = 1;\n    best = Math.max(best, run);\n    prev = d;\n  }\n  return best;\n}\n\n// The numbers the achievements are checked against. Never lower than what AURA already counted.\n// Demo games (the ones AURA starts with) don't count as games you added or favorited.\nexport function achievementStats(games, stats, sessions, demoGames) {\n  const s = stats && typeof stats === \"object\" ? stats : {};\n  const all = Array.isArray(games) ? games.filter((g) => g && typeof g === \"object\") : [];\n  const demo = new Set((Array.isArray(demoGames) ? demoGames : []).map((d) => d.id + \"|\" + d.exePath));\n  const mine = all.filter((g) => !demo.has(g.id + \"|\" + g.exePath));\n  const list = Array.isArray(sessions) ? sessions.filter((x) => x && Number.isFinite(x.end)) : [];\n\n  const played = new Set(list.map((x) => titleKey(x.title)).filter(Boolean));\n  for (const id of Array.isArray(s.playedGameIds) ? s.playedGameIds : []) {\n    const g = all.find((x) => x.id === id);\n    played.add(g ? titleKey(g.title) : \"id:\" + id);\n  }\n  const sessionHours = list.reduce((n, x) => n + num(x.durationMs), 0) / 3600000;\n  const times = [];\n  for (const x of list) { times.push(x.end); if (Number.isFinite(x.start)) times.push(x.start); }\n\n  return {\n    ...s,\n    totalLaunches: Math.max(num(s.totalLaunches), list.length ? 1 : 0),\n    gamesAdded: Math.max(num(s.gamesAdded), mine.length),\n    favoritesCount: Math.max(mine.filter((g) => g.favorite).length, 0),\n    gamesPlayedCount: Math.max(num(s.gamesPlayedCount), played.size),\n    totalPlaytimeHours: Math.max(num(s.totalPlaytimeHours), num(s.totalPlaytimeMs) / 3600000, sessionHours),\n    streakDays: Math.max(num(s.streakDays), longestStreak(times)),\n  };\n}\n","test":"// Achievements count everything: games imported from Steam, Epic or Xbox, and games played from\n// outside AURA. Part 1 checks the counting on its own; part 2 opens the built window (dist) in a\n// real browser with a pretend desktop side, imports 10 Steam games, then plays over three days.\n// Added by aura-achievements-fix-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\nconst DAY = 86400000;\n\n(async () => {\n  console.log(\"1. Counting\");\n  const src = fs.readFileSync(path.join(ROOT, \"src\", \"achievements.js\"), \"utf8\");\n  const { achievementStats, longestStreak } = await import(\"data:text/javascript;base64,\" + Buffer.from(src).toString(\"base64\"));\n  const demo = [{ id: \"1\", exePath: \"C:\\\\demo1.exe\", favorite: true, title: \"Demo\" }, { id: \"2\", exePath: \"C:\\\\demo2.exe\", title: \"Demo 2\" }];\n  const mine = Array.from({ length: 10 }, (_, i) => ({ id: \"g\" + i, exePath: \"C:\\\\g\" + i + \".exe\", title: \"Game \" + i, favorite: i < 2 }));\n  let s = achievementStats([...demo, ...mine], {}, [], demo);\n  check(\"imported games count as added; demo games don't\", s.gamesAdded === 10, s);\n  check(\"favorites count only your own games\", s.favoritesCount === 2, s);\n  s = achievementStats(demo, {}, [], demo);\n  check(\"a library of only demo games counts as nothing\", s.gamesAdded === 0 && s.favoritesCount === 0 && s.totalLaunches === 0, s);\n  s = achievementStats(mine, { gamesAdded: 14, totalLaunches: 3, totalPlaytimeHours: 5, streakDays: 4, gamesPlayedCount: 6 }, [], demo);\n  check(\"never lower than what AURA already counted\", s.gamesAdded === 14 && s.totalLaunches === 3 && s.totalPlaytimeHours === 5 && s.streakDays === 4 && s.gamesPlayedCount === 6, s);\n  const noon = new Date(2026, 9, 10, 12).getTime();\n  const sessions = [\n    { title: \"Game 1\", start: noon, end: noon + 40 * 60000, durationMs: 40 * 60000 },\n    { title: \"Game 2\", start: noon + DAY, end: noon + DAY + 30 * 60000, durationMs: 30 * 60000 },\n    { title: \"game 2\", start: noon + 2 * DAY, end: noon + 2 * DAY + 60000, durationMs: 60000 },\n  ];\n  s = achievementStats(mine, {}, sessions, demo);\n  check(\"games played from outside AURA count: a launch, playtime, different games\", s.totalLaunches === 1 && Math.abs(s.totalPlaytimeHours - 71 / 60) < 1e-9 && s.gamesPlayedCount === 2, s);\n  check(\"days in a row come from when you played\", s.streakDays === 3, s);\n  check(\"a gap breaks the run\", longestStreak([noon, noon + DAY, noon + 3 * DAY, noon + 4 * DAY, noon + 5 * DAY]) === 3);\n  check(\"several plays on one day are one day\", longestStreak([noon, noon + 3600000, noon + 7200000]) === 1);\n  const dst = [new Date(2026, 2, 7, 23).getTime(), new Date(2026, 2, 8, 23).getTime(), new Date(2026, 2, 9, 1).getTime()];\n  check(\"the clocks changing doesn't break a run\", longestStreak(dst) === 3);\n  check(\"broken data is ignored\", achievementStats(null, null, [null, { end: \"x\" }], null).gamesAdded === 0);\n\n  console.log(\"2. In the window\");\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(failed ? 1 : process.env.CI ? 1 : 3); }\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch(options); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with. Run  npx playwright install chromium  once to add one.\"); return done(failed ? 1 : process.env.CI ? 1 : 3); }\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(DIST, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => {\n      if (err) { res.writeHead(404); return res.end(); }\n      res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" });\n      res.end(data);\n    });\n  });\n  await new Promise((r) => server.listen(0, \"127.0.0.1\", r));\n  const base = \"http://127.0.0.1:\" + server.address().port;\n  try {\n    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();\n    const thrown = [];\n    page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n    await page.route((url) => !String(url).startsWith(base) && !String(url).startsWith(\"data:\"), (route) => route.abort());\n    await page.addInitScript(() => {\n      try {\n        if (!sessionStorage.getItem(\"started\")) {\n          sessionStorage.setItem(\"started\", \"1\");\n          localStorage.clear();\n          localStorage.setItem(\"aura_profile\", JSON.stringify({ username: \"tester\", avatar: \"\", userId: \"user-1\" }));\n        }\n      } catch {}\n      const ok = (data) => Promise.resolve({ success: true, data });\n      const account = { getSession: () => ok({ id: \"user-1\", email: \"me@example.com\" }), getMyProfile: () => ok({ username: \"tester\", avatar_url: null }) };\n      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => (name === \"auraCloud\" && account[key]) ? account[key](...args) : ok(null)) });\n      window.auraCloud = fake(\"auraCloud\");\n      window.auraSocial = fake(\"auraSocial\");\n      const steam = Array.from({ length: 10 }, (_, i) => ({ title: \"Steam Game \" + (i + 1), exePath: \"C:\\\\Steam\\\\game\" + (i + 1) + \".exe\" }));\n      const desktop = { importSteam: () => Promise.resolve({ success: true, games: steam }), fetchTwitchStreams: () => Promise.resolve({ success: true, streams: [] }) };\n      window.electronAPI = new Proxy({}, {\n        get: (_t, key) => {\n          if (key === \"isElectron\") return true;\n          if (typeof key !== \"string\" || key === \"then\") return undefined;\n          if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};\n          return (...args) => (desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }));\n        },\n      });\n    });\n    await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n    await page.waitForTimeout(5500);\n    const unlocked = () => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem(\"aura_achievements\") || \"{}\")).sort());\n    const toastText = () => page.evaluate(() => [...document.querySelectorAll(\".ach-toast\")].map((t) => t.innerText.replace(/\\s+/g, \" \")));\n    check(\"a fresh AURA with only the demo games unlocks nothing\", (await unlocked()).length === 0, await unlocked());\n    await page.locator('.gm-rail-item[title=\"Settings\"], .sb-item[title=\"Settings\"]').first().click({ timeout: 5000 });\n    await page.waitForTimeout(500);\n    await page.locator(\".sr\", { hasText: \"Import Steam Games\" }).locator(\"button\").click({ timeout: 5000 });\n    await page.waitForTimeout(3200);\n    const shown = await toastText();\n    check(\"importing 10 Steam games unlocks Collector I and Collector II\", JSON.stringify(await unlocked()) === JSON.stringify([\"five_games_added\", \"ten_games_added\"]), await unlocked());\n    check(\"and says so\", shown.some((t) => /Collector I\\b/.test(t)) && shown.some((t) => /Collector II/.test(t)), shown);\n\n    // Games played from outside AURA over three days, then AURA opened again\n    await page.evaluate((DAY) => {\n      const end = Date.now() - 60000;\n      const s = [0, 1, 2].map((d) => ({ id: \"x\" + d, exePath: \"C:\\\\Steam\\\\game\" + (d + 1) + \".exe\", title: \"Steam Game \" + (d + 1), category: \"Other\", start: end - d * DAY - 25 * 60000, end: end - d * DAY, durationMs: 25 * 60000, perf: null, outside: true }));\n      localStorage.setItem(\"aura_sessions\", JSON.stringify(s));\n    }, DAY);\n    await page.reload({ waitUntil: \"load\" });\n    await page.waitForTimeout(5500);\n    const after = await unlocked();\n    check(\"games played from outside AURA unlock First Launch, Getting Started and On a Roll\", [\"first_launch\", \"one_hour\", \"three_day_streak\"].every((id) => after.includes(id)), after);\n    check(\"what was unlocked before is kept\", after.includes(\"ten_games_added\") && after.includes(\"five_games_added\"), after);\n    check(\"catching up on several at once gives one notice, not a pile\", (await toastText()).length === 1 && /3 achievements/.test((await toastText())[0] || \"\"), await toastText());\n    await page.locator('.gm-rail-item[title=\"Achievements\"], .sb-item[title=\"Achievements\"]').first().click({ timeout: 5000 });\n    await page.waitForTimeout(600);\n    check(\"the Achievements page shows 5 unlocked\", /5 \\/ \\d+ unlocked/.test(await page.locator(\".ach-progress\").innerText()), await page.locator(\".ach-progress\").innerText());\n    check(\"nothing crashed along the way\", (await page.locator(\".aura-fallback\").count()) === 0 && thrown.filter((m) => !/reading 'live'/.test(m)).length === 0, thrown);\n  } finally {\n    await browser.close();\n    server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The achievements check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-achievements-fix.bak";
const MARK = "Added by aura-achievements-fix-setup.cjs";
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
  if (text.includes("achievementStats(")) return { text, notes: [] };
  let t = text;
  const imp = /^import \{ addSession \} from "\.\/sessionstore";\n/m;
  if (!imp.test(t)) throw new Error('the imports at the top ( import { addSession } from "./sessionstore"; )');
  t = t.replace(imp, 'import { addSession, loadSessions } from "./sessionstore";\nimport { achievementStats } from "./achievements"; // ' + MARK + "\n");

  const oldCheck = [
    "  const checkAchievements = useCallback((newStats, currentUnlocked) => {",
    "    const newlyUnlocked = [];",
    "    ACHIEVEMENTS.forEach(a => { if (!currentUnlocked[a.id] && a.condition(newStats)) newlyUnlocked.push(a); });",
    "    if (newlyUnlocked.length > 0) {",
    "      const updated = { ...currentUnlocked };",
    "      newlyUnlocked.forEach(a => { updated[a.id] = Date.now(); });",
    "      setUnlockedAch(updated);",
    "      saveAchievements(updated);",
    "      newlyUnlocked.forEach(a => {",
    "        const id = uid();",
    "        setAchToasts(t => [...t, { id, achievement: a }]);",
    "        playSfx(\"achievement\");",
    "        setTimeout(() => setAchToasts(t => t.filter(x => x.id !== id)), 4000);",
    "      });",
    "    }",
    "  }, []);",
    "",
  ].join("\n");
  const newCheck = [
    "  // What's unlocked right now. Checks used to see an old copy, so an unlock could undo another.",
    "  // (" + MARK + ")",
    "  const unlockedRef = useRef(unlockedAch);",
    "  useEffect(() => { unlockedRef.current = unlockedAch; }, [unlockedAch]);",
    "  const checkAchievements = useCallback((newStats) => {",
    "    const cur = unlockedRef.current || {};",
    "    const fresh = ACHIEVEMENTS.filter(a => !cur[a.id] && a.condition(newStats));",
    "    if (!fresh.length) return;",
    "    const now = Date.now();",
    "    const add = {};",
    "    fresh.forEach(a => { add[a.id] = now; });",
    "    unlockedRef.current = { ...cur, ...add };",
    "    setUnlockedAch(prev => { const updated = { ...add, ...prev }; saveAchievements(updated); return updated; });",
    "    // Several at once (catching up on what you'd already done): one notice, not a pile",
    "    const shown = fresh.length > 2 ? [{ id: \"many\", icon: \"🏆\", title: fresh.length + \" achievements\" }] : fresh;",
    "    shown.forEach(a => {",
    "      const id = uid();",
    "      setAchToasts(t => [...t, { id, achievement: a }]);",
    "      setTimeout(() => setAchToasts(t => t.filter(x => x.id !== id)), 4000);",
    "    });",
    "    playSfx(\"achievement\");",
    "  }, []);",
    "",
  ].join("\n");
  t = swapOnce(t, oldCheck, newCheck, "how achievements are checked ( const checkAchievements = useCallback((newStats, currentUnlocked) => { ... )");

  const cloud = /^(\s*)useCloudProfile\(\{[^\n]*\}\);\n/m;
  const cm = cloud.exec(t);
  if (!cm) throw new Error("where account sync starts ( useCloudProfile({ ... }); )");
  const ind = cm[1];
  const block = [
    "// Achievements count everything: imported games (Steam, Epic, Xbox), a library from your account,",
    "// and games played from outside AURA. Checked a moment after anything changes, and at start,",
    "// so what you'd already done unlocks too. (" + MARK + ")",
    "const [sessionsTick, setSessionsTick] = useState(0);",
    "useEffect(() => {",
    "  const on = () => setSessionsTick(n => n + 1);",
    "  window.addEventListener(\"aura-sessions-updated\", on);",
    "  return () => window.removeEventListener(\"aura-sessions-updated\", on);",
    "}, []);",
    "useEffect(() => {",
    "  const timer = setTimeout(() => checkAchievements(achievementStats(games, stats, loadSessions(), DEMO_GAMES)), 2500);",
    "  return () => clearTimeout(timer);",
    "}, [games, stats, sessionsTick, checkAchievements]);",
  ].map((l) => ind + l).join("\n") + "\n";
  t = t.slice(0, cm.index + cm[0].length) + block + t.slice(cm.index + cm[0].length);
  return { text: t, notes: [
    "games imported from Steam, Epic or Xbox now count toward Collector I and II",
    "games played from outside AURA count toward playtime, Explorer, streaks and First Launch",
    "what you'd already done unlocks the next time AURA opens",
    "fixed: one unlock could undo another",
  ] };
}
// ── AURA's checks (only when they are installed) ─────────────────────────────
function editRunner(text) {
  if (/achievements\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  let at = -1;
  for (let i = 0; i < lines.length; i++) if (/add\("window",/.test(lines[i])) at = i;
  if (at < 0) return { text, notes: ["(couldn't find where to add the achievements check, so npm test doesn't include it)"] };
  lines.splice(at + 1, 0, 'if (fs.existsSync(path.join(__dirname, "achievements.cjs"))) add("window", "Achievements count everything", "achievements.cjs");');
  return { text: lines.join("\n"), notes: ["npm test now checks achievements too"] };
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
      } else if (entry.name === "achievements.js" || entry.name === "achievements.cjs") {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. Achievements count as they did before." : "Nothing to undo.");
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

  const created = [{ label: "counting", file: path.join(path.dirname(files.app), "achievements.js"), content: FILES.ach }];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "achievements.cjs"), content: FILES.test });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: achievements that count everything");
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
  say("Done. Restart AURA (stop it in the terminal and start it again), then wait a few seconds: anything you'd already earned unlocks.");
  if (hasChecks) say("Run  npm test  before your next release.");
  say("To undo later:  node aura-achievements-fix-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
