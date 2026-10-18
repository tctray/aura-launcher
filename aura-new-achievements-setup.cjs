#!/usr/bin/env node
/**
 * AURA — 9 new achievements
 *
 *   Picture Perfect   capture your first screenshot
 *   Clip It!          save your first clip
 *   Content Creator   10 screenshots or clips
 *   First Friend      add your first friend
 *   First Contact     send your first message
 *   Connected         link Steam, Discord or Xbox (Xbox: games from the Xbox app in your library)
 *   Squad Up          a party with 3+ friends: shown, but it waits for group calls (calls are
 *                     one-on-one for now), so Aura Legend doesn't need it yet
 *   Early Adopter     first time in AURA before January 1, 2027 (EARLY_ADOPTER_CUTOFF in App.jsx)
 *   Aura Legend       every other achievement (it unlocks in the same moment as the last one)
 *
 * What you'd already done counts: clips and screenshots already on your PC, friends you already
 * have, accounts already linked, and your first day in AURA (from your sessions and library).
 * Several at once show as one notice.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-new-achievements-setup.cjs
 *   (Needs aura-achievements-fix-setup.cjs to have been run first, which it has if you're on 1.22.1 or later.)
 *
 * What it does:
 *   - edits    src/App.jsx                  the achievements and their stats
 *   - edits    src/achievements.js          counts the new stats
 *   - edits    src/components/messages.jsx  says when you send a message, and how many friends you have
 *   - edits    tests/achievements.cjs       allows for Early Adopter
 *   - creates  tests/new-achievements.cjs   (only if AURA's checks are installed) checks it
 *
 * Every file it changes is copied to <name>.before-new-achievements.bak first.
 * To put everything back:                 node aura-new-achievements-setup.cjs --undo
 * To preview without changing anything:   node aura-new-achievements-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FILES = {"test":"// The new achievements: Picture Perfect, Clip It!, Content Creator, First Friend, First Contact,\n// Connected, Squad Up, Early Adopter and Aura Legend. Part 1 checks the counting; part 2 opens the\n// built window (dist) in a real browser with a pretend desktop side. Added by aura-new-achievements-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\n\n(async () => {\n  console.log(\"1. Counting\");\n  const src = fs.readFileSync(path.join(ROOT, \"src\", \"achievements.js\"), \"utf8\");\n  const { achievementStats } = await import(\"data:text/javascript;base64,\" + Buffer.from(src).toString(\"base64\"));\n  let s = achievementStats([], { clipsSaved: 1, messagesSent: 3, firstSeenAt: \"2026-10-18T10:00:00Z\" }, [], [], { clips: 4, screenshots: 2, friends: 1, accounts: 2, partySize: 2 });\n  check(\"clips and screenshots on this PC, friends, linked accounts and calls are counted\", s.clipsSaved === 4 && s.screenshotsTaken === 2 && s.friendsCount === 1 && s.accountsLinked === 2 && s.maxPartySize === 2, s);\n  check(\"messages sent and the first day are kept\", s.messagesSent === 3 && s.firstSeenAt === \"2026-10-18\", s);\n  s = achievementStats([], { clipsSaved: 5, friendsCount: 3 }, [], [], { clips: 1, friends: 0 });\n  check(\"never lower than before (a deleted clip or removed friend doesn't take anything back)\", s.clipsSaved === 5 && s.friendsCount === 3, s);\n  check(\"nothing known: all zero, and no first day\", (() => { const z = achievementStats([], {}, [], []); return z.clipsSaved === 0 && z.messagesSent === 0 && z.firstSeenAt === null; })());\n  const messages = fs.readFileSync(path.join(ROOT, \"src\", \"components\", \"messages.jsx\"), \"utf8\");\n  check(\"sending a message (text, picture, GIF or video) tells AURA, for First Contact\", (messages.match(/dispatchEvent\\(new Event\\(\"aura-message-sent\"\\)\\)/g) || []).length >= 2);\n\n  console.log(\"2. In the window\");\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(failed ? 1 : process.env.CI ? 1 : 3); }\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch(options); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with.\"); return done(failed ? 1 : process.env.CI ? 1 : 3); }\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(DIST, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" }); res.end(data); });\n  });\n  await new Promise((r) => server.listen(0, \"127.0.0.1\", r));\n  const base = \"http://127.0.0.1:\" + server.address().port;\n\n  // One AURA, set up as `setup` says\n  const open = async (setup) => {\n    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();\n    const thrown = [];\n    page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n    await page.route((url) => !String(url).startsWith(base) && !String(url).startsWith(\"data:\"), (route) => route.abort());\n    await page.addInitScript((setup) => {\n      try {\n        localStorage.clear();\n        localStorage.setItem(\"aura_profile\", JSON.stringify({ username: \"tester\", avatar: \"\", userId: \"user-1\" }));\n        for (const [k, v] of Object.entries(setup.storage || {})) localStorage.setItem(k, v);\n      } catch {}\n      window.__pc = { clips: setup.clips || 0, screenshots: setup.screenshots || 0, discord: !!setup.discord };\n      const ok = (data) => Promise.resolve({ success: true, data });\n      const account = { getSession: () => ok({ id: \"user-1\", email: \"me@example.com\" }), getMyProfile: () => ok({ username: \"tester\", avatar_url: null }) };\n      const social = {\n        start: () => ok({ id: \"user-1\", username: \"tester\", live: true }),\n        listFriends: () => ok(setup.friends ? [{ friendshipId: \"f1\", userId: \"user-2\", username: \"Bri\", avatarUrl: \"\", state: \"friend\", online: true }] : []),\n        listConversations: () => ok([]), listBlocked: () => ok([]),\n      };\n      window.auraCloud = new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => (account[key] ? account[key](...args) : ok(null))) });\n      window.auraSocial = new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : key === \"onEvent\" ? () => () => {} : (...args) => (social[key] ? social[key](...args) : ok(null))) });\n      const desktop = {\n        getClips: () => Promise.resolve({ success: true, clips: Array.from({ length: window.__pc.clips }, (_, i) => ({ id: \"c\" + i })) }),\n        getScreenshots: () => Promise.resolve({ success: true, screenshots: Array.from({ length: window.__pc.screenshots }, (_, i) => ({ id: \"s\" + i })) }),\n        discordGetUser: () => Promise.resolve(window.__pc.discord ? { success: true, user: { username: \"me\" } } : { success: false }),\n      };\n      window.electronAPI = new Proxy({}, {\n        get: (_t, key) => {\n          if (key === \"isElectron\") return true;\n          if (typeof key !== \"string\" || key === \"then\") return undefined;\n          if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};\n          return (...args) => (desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }));\n        },\n      });\n    }, setup);\n    await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n    await page.waitForTimeout(5500);\n    return { page, thrown };\n  };\n  const unlocked = (page) => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem(\"aura_achievements\") || \"{}\")).sort());\n  const stat = (page, k) => page.evaluate((k) => JSON.parse(localStorage.getItem(\"aura_stats\") || \"{}\")[k], k);\n\n  try {\n    console.log(\"3. Clips, screenshots and Early Adopter\");\n    let { page, thrown } = await open({ clips: 1, screenshots: 2 });\n    let u = await unlocked(page);\n    check(\"a clip and screenshots already on the PC unlock Clip It! and Picture Perfect\", u.includes(\"first_clip\") && u.includes(\"first_screenshot\"), u);\n    check(\"not Content Creator yet (3 of 10)\", !u.includes(\"ten_captures\"), u);\n    check(\"first time in AURA before 2027: Early Adopter\", u.includes(\"early_adopter\") && /^\\d{4}-\\d{2}-\\d{2}$/.test(await stat(page, \"firstSeenAt\")), [u, await stat(page, \"firstSeenAt\")]);\n    check(\"nothing that wasn't earned: no friend, message, link or party ones\", !u.some((id) => [\"first_friend\", \"first_message\", \"account_linked\", \"squad_up\", \"aura_legend\"].includes(id)), u);\n    await page.evaluate(() => { window.__pc.clips = 8; window.dispatchEvent(new Event(\"focus\")); });\n    await page.waitForTimeout(3500);\n    check(\"more clips saved: Content Creator unlocks when AURA looks again\", (await unlocked(page)).includes(\"ten_captures\"), await unlocked(page));\n    await page.evaluate(() => window.dispatchEvent(new Event(\"aura-message-sent\")));\n    await page.waitForTimeout(3500);\n    check(\"sending a message: First Contact\", (await unlocked(page)).includes(\"first_message\") && (await stat(page, \"messagesSent\")) === 1, [await unlocked(page), await stat(page, \"messagesSent\")]);\n    check(\"nothing crashed\", thrown.filter((m) => !/reading 'live'/.test(m)).length === 0, thrown);\n    await page.context().close();\n\n    console.log(\"4. Friends and linked accounts\");\n    ({ page, thrown } = await open({ friends: true, storage: { aura_steam_id: \"76561198000000000\" } }));\n    u = await unlocked(page);\n    check(\"a friend in your list: First Friend\", u.includes(\"first_friend\"), u);\n    check(\"Steam linked: Connected\", u.includes(\"account_linked\"), u);\n    await page.context().close();\n    ({ page } = await open({ discord: true }));\n    check(\"Discord linked: Connected\", (await unlocked(page)).includes(\"account_linked\"), await unlocked(page));\n    await page.context().close();\n    ({ page } = await open({ storage: { aura_games: JSON.stringify([{ id: \"x1\", title: \"ARC Raiders\", exePath: \"C:/XboxGames/ARC Raiders/Content/gamelaunchhelper.exe\", cover: \"\", category: \"Other\", favorite: false, playCount: 0, lastPlayed: null }]) } }));\n    check(\"Xbox games in your library: Connected\", (await unlocked(page)).includes(\"account_linked\"), await unlocked(page));\n    await page.context().close();\n\n    console.log(\"5. Early Adopter's cutoff, Squad Up and Aura Legend\");\n    ({ page } = await open({ storage: { aura_stats: JSON.stringify({ totalLaunches: 0, gamesAdded: 0, totalPlaytimeHours: 0, favoritesCount: 0, streakDays: 0, gamesPlayedCount: 0, lastPlayedDate: null, playedGameIds: [], firstSeenAt: \"2027-02-01\" }) } }));\n    check(\"first time in AURA after the cutoff: no Early Adopter\", !(await unlocked(page)).includes(\"early_adopter\"), await unlocked(page));\n    await page.context().close();\n    const allButLegend = [\"first_launch\", \"five_games_added\", \"ten_games_added\", \"one_hour\", \"ten_hours\", \"fifty_hours\", \"first_favorite\", \"five_favorites\", \"three_day_streak\", \"seven_day_streak\", \"five_games_played\", \"ten_games_played\", \"first_screenshot\", \"first_clip\", \"ten_captures\", \"first_friend\", \"first_message\", \"account_linked\"];\n    const had = Object.fromEntries(allButLegend.map((id) => [id, 1000]));\n    ({ page } = await open({ storage: { aura_achievements: JSON.stringify(had) } }));\n    u = await unlocked(page);\n    check(\"the last one earned (Early Adopter) unlocks Aura Legend in the same moment\", u.includes(\"early_adopter\") && u.includes(\"aura_legend\"), u);\n    check(\"Squad Up isn't needed for Aura Legend while calls are one-on-one, and stays locked\", !u.includes(\"squad_up\"), u);\n    await page.locator('.gm-rail-item[title=\"Achievements\"], .sb-item[title=\"Achievements\"]').first().click({ timeout: 5000 });\n    await page.waitForTimeout(600);\n    const shown = await page.locator(\".ach-progress\").innerText();\n    const body = await page.locator(\"body\").innerText();\n    check(\"the Achievements page counts all 21\", /\\/ 21 unlocked/.test(shown), shown);\n    check(\"and lists the new ones with their names\", [\"Picture Perfect\", \"Clip It!\", \"Content Creator\", \"First Friend\", \"First Contact\", \"Connected\", \"Squad Up\", \"Early Adopter\", \"Aura Legend\"].every((n) => body.includes(n)), body.slice(0, 400));\n    await page.context().close();\n  } finally {\n    await browser.close();\n    server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The new achievements check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-new-achievements.bak";
const MARK = "Added by aura-new-achievements-setup.cjs";
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

const NEW_ACHIEVEMENTS = [
  "  // New achievements (" + MARK + ")",
  '  { id:"first_screenshot", title:"Picture Perfect", description:"Capture your first screenshot",            icon:"📸", condition:(s)=>(s.screenshotsTaken||0)>=1 },',
  '  { id:"first_clip",       title:"Clip It!",        description:"Save your first clip",                     icon:"🎬", condition:(s)=>(s.clipsSaved||0)>=1 },',
  '  { id:"ten_captures",     title:"Content Creator", description:"Create 10 screenshots or clips",           icon:"🎥", condition:(s)=>((s.screenshotsTaken||0)+(s.clipsSaved||0))>=10 },',
  '  { id:"first_friend",     title:"First Friend",    description:"Add your first friend",                    icon:"🤝", condition:(s)=>(s.friendsCount||0)>=1 },',
  '  { id:"first_message",    title:"First Contact",   description:"Send your first message",                  icon:"💬", condition:(s)=>(s.messagesSent||0)>=1 },',
  '  { id:"account_linked",   title:"Connected",       description:"Link Steam, Discord or Xbox",              icon:"🔗", condition:(s)=>(s.accountsLinked||0)>=1 },',
  "  // Calls are one-on-one for now: Squad Up waits for group calls, and Aura Legend doesn't wait for it",
  '  { id:"squad_up",         title:"Squad Up",        description:"Join or create a party with 3+ friends (coming with group calls)", icon:"👥", soon:true, condition:(s)=>(s.maxPartySize||0)>=4 },',
  '  { id:"early_adopter",    title:"Early Adopter",   description:"Join AURA during the launch window",       icon:"🚀", condition:(s)=>!!s.firstSeenAt && s.firstSeenAt < EARLY_ADOPTER_CUTOFF },',
  '  { id:"aura_legend",      title:"Aura Legend",     description:"Unlock every other achievement",           icon:"👑", condition:(s,u={})=>ACHIEVEMENTS.every(a=>a.id==="aura_legend"||a.soon||u[a.id]) },',
].join("\n") + "\n";

// ── App.jsx ──────────────────────────────────────────────────────────────────
function editApp(text) {
  if (text.includes('id:"aura_legend"')) return { text, notes: [] };
  let t = text;
  const S = (a, b, what) => { t = swapOnce(t, a, b, what); };

  // The list, and the Early Adopter cutoff
  S("const ACHIEVEMENTS = [\n",
    "// Anyone whose first launch is before this date gets Early Adopter (" + MARK + ")\n" +
    "const EARLY_ADOPTER_CUTOFF = \"2027-01-01\";\n" +
    "const ACHIEVEMENTS = [\n",
    "the list of achievements ( const ACHIEVEMENTS = [ )");
  const end = /(\n  \{ id:"ten_games_played"[^\n]*\n)\];\n/;
  if (!end.test(t)) throw new Error('the end of the list of achievements ( { id:"ten_games_played" ... } ]; )');
  t = t.replace(end, (_m, last) => last + NEW_ACHIEVEMENTS + "];\n");

  // The new stats start at 0
  const ls = /^const loadStats = \(\) => \{[^\n]*\n/m;
  const m = ls.exec(t);
  if (!m) throw new Error("the stats AURA starts with ( const loadStats = () => { ... } )");
  const fields = "screenshotsTaken:0,clipsSaved:0,friendsCount:0,messagesSent:0,accountsLinked:0,maxPartySize:0,firstSeenAt:null,";
  const line = m[0].split("playedGameIds:[]}").join(fields + "playedGameIds:[]}");
  if (line === m[0]) throw new Error("the stats AURA starts with ( ... playedGameIds:[]} )");
  t = t.slice(0, m.index) + line + t.slice(m.index + m[0].length);

  // Aura Legend sees what's unlocked, including what unlocks in the same moment
  S("    const fresh = ACHIEVEMENTS.filter(a => !cur[a.id] && a.condition(newStats));\n",
    "    const fresh = ACHIEVEMENTS.filter(a => !cur[a.id] && a.condition(newStats, cur));\n" +
    "    // Aura Legend: also counts the ones unlocking right now (" + MARK + ")\n" +
    "    const seen = { ...cur }; fresh.forEach(a => { seen[a.id] = 1; });\n" +
    "    ACHIEVEMENTS.forEach(a => { if (!seen[a.id] && a.condition(newStats, seen)) { fresh.push(a); seen[a.id] = 1; } });\n",
    "how achievements are checked ( const fresh = ACHIEVEMENTS.filter(a => !cur[a.id] && a.condition(newStats)); ) — run aura-achievements-fix-setup.cjs first if you haven't");

  // The friends count and calls
  const mi = /^import MessagesPage, \{ ([^}]*) \} from "\.\/components\/messages";\n/m;
  const mm = mi.exec(t);
  if (!mm) throw new Error('the messages import ( import MessagesPage, { ... } from "./components/messages"; )');
  t = t.replace(mi, (_x, names) => "import MessagesPage, { " + names + ", useFriendCount } from \"./components/messages\";\nimport { useCall } from \"./components/calls\"; // a call in progress counts as a party (" + MARK + ")\n");

  // Live counts, and checking with them
  S("    const timer = setTimeout(() => checkAchievements(achievementStats(games, stats, loadSessions(), DEMO_GAMES)), 2500);\n    return () => clearTimeout(timer);\n  }, [games, stats, sessionsTick, checkAchievements]);\n",
    [
      "    const timer = setTimeout(() => checkAchievements(achievementStats(games, stats, loadSessions(), DEMO_GAMES, { ...captureCounts, friends: friendCount, partySize: callLive ? 2 : 0 })), 2500);",
      "    return () => clearTimeout(timer);",
      "  }, [games, stats, sessionsTick, checkAchievements, captureCounts, friendCount, callLive]);",
      "",
    ].join("\n"),
    "where achievements are checked ( checkAchievements(achievementStats(games, stats, loadSessions(), DEMO_GAMES)) ) — run aura-achievements-fix-setup.cjs first if you haven't");
  S("  const [sessionsTick, setSessionsTick] = useState(0);\n",
    [
      "  const [sessionsTick, setSessionsTick] = useState(0);",
      "  // New achievements: clips, screenshots, friends, messages, linked accounts, calls, first launch (" + MARK + ")",
      "  const friendCount = useFriendCount();",
      "  const liveCall = useCall();",
      "  const callLive = !!liveCall && (liveCall.phase === \"live\" || liveCall.phase === \"reconnecting\");",
      "  const [captureCounts, setCaptureCounts] = useState({});",
      "  useEffect(() => {",
      "    let alive = true;",
      "    const look = async () => {",
      "      const api = window.electronAPI;",
      "      if (!api?.isElectron) return;",
      "      const out = {};",
      "      try { const r = await api.getClips?.(); if (r?.success && Array.isArray(r.clips)) out.clips = r.clips.length; } catch {}",
      "      try { const r = await api.getScreenshots?.(); if (r?.success && Array.isArray(r.screenshots)) out.screenshots = r.screenshots.length; } catch {}",
      "      let linked = 0;",
      "      try { const r = await api.discordGetUser?.(); if (r?.success) linked++; } catch {}",
      "      try { if (localStorage.getItem(\"aura_steam_id\")) linked++; } catch {}",
      "      if (gamesRef.current.some((g) => /\\\\xboxgames\\\\|\\\\windowsapps\\\\/i.test(String(g?.exePath || \"\").replace(/\\//g, \"\\\\\")))) linked++; // Xbox games in your library",
      "      out.accounts = linked;",
      "      if (alive) setCaptureCounts((c) => (JSON.stringify({ ...c, ...out }) === JSON.stringify(c) ? c : { ...c, ...out }));",
      "    };",
      "    look();",
      "    const timer = setInterval(look, 60000);",
      "    window.addEventListener(\"focus\", look);",
      "    return () => { alive = false; clearInterval(timer); window.removeEventListener(\"focus\", look); };",
      "  }, []);",
      "  // Messages you send (messages.jsx says so)",
      "  useEffect(() => {",
      "    const sent = () => setStats((prev) => { const s = { ...prev, messagesSent: (Number(prev.messagesSent) || 0) + 1 }; saveStats(s); return s; });",
      "    window.addEventListener(\"aura-message-sent\", sent);",
      "    return () => window.removeEventListener(\"aura-message-sent\", sent);",
      "  }, []);",
      "  // The day you first used AURA: today, or earlier if your sessions or library say so",
      "  useEffect(() => {",
      "    if (stats.firstSeenAt) return;",
      "    let first = Date.now();",
      "    for (const x of loadSessions()) if (Number.isFinite(x?.start) && x.start > 0 && x.start < first) first = x.start;",
      "    for (const g of gamesRef.current) if (Number.isFinite(g?.addedAt) && g.addedAt > 0 && g.addedAt < first) first = g.addedAt;",
      "    const d = new Date(first);",
      "    const day = d.getFullYear() + \"-\" + String(d.getMonth() + 1).padStart(2, \"0\") + \"-\" + String(d.getDate()).padStart(2, \"0\");",
      "    setStats((prev) => { if (prev.firstSeenAt) return prev; const s = { ...prev, firstSeenAt: day }; saveStats(s); return s; });",
      "  }, [stats.firstSeenAt]);",
      "",
    ].join("\n"),
    "where achievements watch Sessions ( const [sessionsTick, setSessionsTick] = useState(0); ) — run aura-achievements-fix-setup.cjs first if you haven't");

  return { text: t, notes: [
    "9 new achievements: Picture Perfect, Clip It!, Content Creator, First Friend, First Contact, Connected, Squad Up, Early Adopter, Aura Legend",
    "what you'd already done unlocks the next time AURA opens (clips and screenshots on your PC, friends, linked accounts)",
  ] };
}

// ── achievements.js: the new stats ───────────────────────────────────────────
function editCounting(text) {
  if (text.includes("screenshotsTaken")) return { text, notes: [] };
  let t = text;
  t = swapOnce(t, "export function achievementStats(games, stats, sessions, demoGames) {",
    "// `extra`: what AURA can see right now: clips and screenshots on this PC, friends, linked accounts,\n" +
    "// the size of a call you're in (" + MARK + ")\n" +
    "export function achievementStats(games, stats, sessions, demoGames, extra = {}) {",
    "the counting ( export function achievementStats(games, stats, sessions, demoGames) { )");
  t = swapOnce(t, "    streakDays: Math.max(num(s.streakDays), longestStreak(times)),\n  };\n",
    "    streakDays: Math.max(num(s.streakDays), longestStreak(times)),\n" +
    "    screenshotsTaken: Math.max(num(s.screenshotsTaken), num(extra && extra.screenshots)),\n" +
    "    clipsSaved: Math.max(num(s.clipsSaved), num(extra && extra.clips)),\n" +
    "    friendsCount: Math.max(num(s.friendsCount), num(extra && extra.friends)),\n" +
    "    messagesSent: num(s.messagesSent),\n" +
    "    accountsLinked: Math.max(num(s.accountsLinked), num(extra && extra.accounts)),\n" +
    "    maxPartySize: Math.max(num(s.maxPartySize), num(extra && extra.partySize)),\n" +
    "    firstSeenAt: typeof s.firstSeenAt === \"string\" && /^\\d{4}-\\d{2}-\\d{2}/.test(s.firstSeenAt) ? s.firstSeenAt.slice(0, 10) : null,\n" +
    "  };\n",
    "the end of the counting ( streakDays: ... }; )");
  return { text: t, notes: ["counts clips, screenshots, friends, messages, linked accounts and calls"] };
}

// ── messages.jsx: tell AURA when a message is sent, and how many friends ─────
function editMessages(text) {
  if (text.includes("aura-message-sent")) return { text, notes: [] };
  let t = text;
  const find = "      touchConversation(saved, false);\n      return true;\n";
  const n = t.split(find).length - 1;
  if (n < 1) throw new Error("where a message is sent ( touchConversation(saved, false); return true; )");
  t = t.split(find).join("      touchConversation(saved, false);\n      try { window.dispatchEvent(new Event(\"aura-message-sent\")); } catch {} // for First Contact (" + MARK + ")\n      return true;\n");
  t = swapOnce(t, "// ── Started once, from AuraApp ────",
    "// How many friends you have, for First Friend (" + MARK + ")\n" +
    "export function useFriendCount() {\n" +
    "  const s = useSocial();\n" +
    "  return (s.friends || []).filter((f) => f.state === \"friend\").length;\n" +
    "}\n\n" +
    "// ── Started once, from AuraApp ────",
    "where messaging starts ( // ── Started once, from AuraApp ── )");
  return { text: t, notes: ["says when you send a message, and how many friends you have"] };
}


// ── tests/achievements.cjs: Early Adopter now unlocks for everyone before 2027 ──
function editOldTest(text) {
  if (text.includes("early_adopter")) return { text, notes: [] };
  let t = text;
  t = swapOnce(t, '    const unlocked = () => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("aura_achievements") || "{}")).sort());\n',
    '    // (Early Adopter unlocks for anyone new before 2027, so it isn\'t counted here; ' + MARK + ')\n' +
    '    const unlocked = () => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("aura_achievements") || "{}")).filter((k) => k !== "early_adopter").sort());\n',
    "the achievements check ( const unlocked = () => ... )");
  t = swapOnce(t, '/5 \\/ \\d+ unlocked/.test(', '/[56] \\/ \\d+ unlocked/.test(', "the achievements check ( /5 \\/ \\d+ unlocked/ )");
  return { text: t, notes: ["the achievements check allows for Early Adopter"] };
}

// ── AURA's checks (only when they are installed) ─────────────────────────────
function editRunner(text) {
  if (/new-achievements\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  let at = -1;
  for (let i = 0; i < lines.length; i++) if (/add\("window",/.test(lines[i])) at = i;
  if (at < 0) return { text, notes: ["(couldn't find where to add the new achievements check, so npm test doesn't include it)"] };
  lines.splice(at + 1, 0, 'if (fs.existsSync(path.join(__dirname, "new-achievements.cjs"))) add("window", "New achievements", "new-achievements.cjs");');
  return { text: lines.join("\n"), notes: ["npm test now checks the new achievements too"] };
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
      } else if (entry.name === "new-achievements.cjs") {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. The new achievements are gone." : "Nothing to undo.");
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
    counting: findOne("the achievements counting (achievements.js)", (t) => /export function achievementStats\(/.test(t), "Run aura-achievements-fix-setup.cjs first.", [
      (h) => /^achievements\.js$/.test(path.basename(h.file)),
    ]),
    messages: findOne("your messages file (messages.jsx)", (t) => /function onMessage\(message\)/.test(t) && /MessagesPage/.test(t), need, [
      (h) => /[\\/]components[\\/]/.test(h.file),
      (h) => /^messages\.jsx$/.test(path.basename(h.file)),
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
  consider("counting", files.counting, editCounting, false);
  consider("messages", files.messages, editMessages, false);
  const runner = path.join(ROOT, "tests", "run.cjs");
  const hasChecks = fs.existsSync(runner);
  if (hasChecks) consider("checks", runner, editRunner, true);
  const oldTest = path.join(ROOT, "tests", "achievements.cjs");
  if (fs.existsSync(oldTest)) consider("old check", oldTest, editOldTest, true);

  const created = [];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "new-achievements.cjs"), content: FILES.test });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: 9 new achievements");
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
  say("To undo later:  node aura-new-achievements-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
