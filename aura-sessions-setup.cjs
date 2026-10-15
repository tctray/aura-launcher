#!/usr/bin/env node
/**
 * AURA — Sessions for every game, however you start it
 *
 * Before: Sessions only recorded games started with AURA's Play button, and lost games that
 * need administrator rights (common with anti-cheat), so most games never showed up.
 *
 * Now:
 *   - Any game in your library that runs gets a session: started from AURA, Steam, Epic, the Xbox
 *     app or a shortcut, with its playtime and CPU / GPU / RAM / FPS, like before. AURA checks
 *     which programs are running every few seconds while it's open or hidden by the clock. That
 *     check stays on your PC; only the sessions it finds are saved.
 *   - Games that need administrator rights are tracked too.
 *   - Games whose launcher starts a differently named program are learned the first time you
 *     start them from AURA, and recognised after that however you start them.
 *   - A game reopened within 5 minutes (a restart, a crash, a launcher handing over) continues
 *     the same session instead of adding a new 2-minute row.
 *   - Quitting AURA mid-game keeps the time played so far.
 *   - The Now Playing timer shows for games started outside AURA too, timed from when they
 *     started, and stays while a game closes and reopens as it loads (Steam, the EA app and
 *     anti-cheat often do this): a game in its first 3 minutes may vanish for up to 90 seconds.
 *   - Already ran the first version of this script? Run this one too: it updates that copy.
 *   - Settings > Library: "Count Games Started Outside AURA" (on). Turn it off to count only
 *     games started with Play.
 *   - Playtime, "Recently Played" and achievements count games started outside AURA too.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-sessions-setup.cjs
 *
 * What it does:
 *   - creates  electron/gamewatch.js          notices which library games are running
 *   - edits    electron/main.js               every session goes through it
 *   - edits    electron/perf.js               FPS for the program that's really running
 *   - edits    electron/preload.js            the window sends your game list
 *   - edits    src/App.jsx                    sends the list; the setting in Settings > Library
 *   - edits    src/sessionstore.js            one session for a game reopened within 5 minutes
 *   - edits    src/components/privacy.jsx     says how games are noticed
 *   - creates  tests/sessions.cjs             (only if AURA's checks are installed) checks it
 *
 * Every file it changes is copied to <name>.before-sessions.bak first.
 * To put everything back:                 node aura-sessions-setup.cjs --undo
 * To preview without changing anything:   node aura-sessions-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FILES = {"gamewatch":"// electron/gamewatch.js — notices when a game from your library is running, however it was started\n// (AURA's Play button, Steam, Epic, the Xbox app, a shortcut), and when it closes.\n// Added by aura-sessions-setup.cjs.\n//\n// Every few seconds it asks Windows for the names of the programs that are running (tasklist, on\n// this PC only; nothing is sent anywhere) and matches them to the games in your library. A game\n// that's seen starts a session; a game that's gone for two checks in a row ends it, timed to\n// the last moment it was seen. In a game's first 3 minutes it may vanish for up to 90 seconds\n// without ending: many games start, close and start again (Steam, the EA app and anti-cheat do\n// this), and AURA looks in the game's folder for the program it hands over to. Games AURA started\n// are watched for up to 3 minutes before they appear, and games that need administrator rights\n// are seen like any other.\n\"use strict\";\nconst path = require(\"path\");\nconst fs = require(\"fs\");\n\n// Names too common to tell games apart. A game whose program has one of these names is only\n// tracked when AURA starts it.\nconst GENERIC = new Set([\n  \"launcher.exe\", \"game.exe\", \"start.exe\", \"play.exe\", \"setup.exe\", \"install.exe\", \"update.exe\", \"updater.exe\",\n  \"client.exe\", \"app.exe\", \"main.exe\", \"bootstrapper.exe\", \"run.exe\", \"win64.exe\", \"shipping.exe\",\n]);\n// Helpers that run beside games: never taken as the game itself\nconst HELPERS = /^(unins.*|.*crash.*|.*report.*|easyanticheat.*|eac.*|battleye.*|be.*service.*|start_protected_game|.*redist.*|vc_?redist.*|dxsetup|ue4prereq.*|cefprocess|.*webhelper.*|.*overlay.*|.*updater.*|.*launcher.*helper.*|steamservice|steam|epicgameslauncher|eadesktop|eabackgroundservice|origin|gamebar.*|xboxpcapp.*)\\.exe$/i;\n\nconst nameOf = (p) => path.win32.basename(String(p || \"\")).toLowerCase(); // works for C:\\ paths on any PC\nconst keyOf = (p) => String(p || \"\").toLowerCase();\nconst validExe = (p) => typeof p === \"string\" && p.length > 4 && p.length <= 1024 && /\\.exe$/i.test(p) && !p.includes(\"\\0\");\n\nfunction createGameWatch({\n  list,                         // async () => array of running program names (e.g. \"MaddenNFL27.exe\")\n  onStart = () => {},           // (exePath, programName, { launched })\n  onEnd = () => {},             // (exePath, { start, end, launched })\n  findAliases = null,           // async (exePath) => program names running from the game's folder\n  shouldWatchAll = () => true,  // false: only games AURA started\n  now = Date.now,\n  setTimer = setTimeout,\n  clearTimer = clearTimeout,\n  idleMs = 20000,               // how often to look when nothing is running\n  busyMs = 5000,                // how often while a game runs or is starting\n  missesToEnd = 2,\n  launchWaitMs = 3 * 60 * 1000, // how long a game AURA started may take to appear, and how long a new game counts as \"starting\"\n  handoverMs = 90 * 1000,       // how long a starting game may vanish while it restarts or hands over\n  aliasAfterMs = 15000,         // when to look in its folder for the real program\n  aliasFile = null,             // where learned program names are kept\n} = {}) {\n  const library = new Map();    // lower-case path -> path as given\n  const aliases = new Map();    // lower-case path -> Set of lower-case program names\n  const sessions = new Map();   // lower-case path -> { exePath, start, lastSeen, misses, launched, name }\n  const pending = new Map();    // lower-case path -> { exePath, at, looked }\n  let timer = null;\n  let running = false;\n  let checking = false;\n\n  try {\n    if (aliasFile && fs.existsSync(aliasFile)) {\n      const saved = JSON.parse(fs.readFileSync(aliasFile, \"utf8\"));\n      for (const [k, names] of Object.entries(saved || {})) {\n        if (Array.isArray(names)) aliases.set(k, new Set(names.filter((n) => typeof n === \"string\" && /\\.exe$/i.test(n) && n.length < 260).map((n) => n.toLowerCase())));\n      }\n    }\n  } catch {}\n  const saveAliases = () => {\n    if (!aliasFile) return;\n    try { fs.writeFileSync(aliasFile, JSON.stringify(Object.fromEntries([...aliases].map(([k, v]) => [k, [...v]])))); } catch {}\n  };\n\n  function setLibrary(paths) {\n    library.clear();\n    for (const p of Array.isArray(paths) ? paths.slice(0, 2000) : []) if (validExe(p)) library.set(keyOf(p), p);\n  }\n  function addAlias(exePath, programName) {\n    const n = String(programName || \"\").toLowerCase();\n    if (!validExe(exePath) || !/\\.exe$/i.test(n) || HELPERS.test(n) || GENERIC.has(n) || n === nameOf(exePath)) return false;\n    const k = keyOf(exePath);\n    const set = aliases.get(k) || new Set();\n    if (set.has(n) || set.size >= 5) return false;\n    set.add(n); aliases.set(k, set); saveAliases();\n    return true;\n  }\n  // A game AURA just started: watch for it even if its name is generic, and time it from now\n  function launched(exePath) {\n    if (!validExe(exePath)) return;\n    const k = keyOf(exePath);\n    if (!library.has(k)) library.set(k, exePath);\n    if (!sessions.has(k)) pending.set(k, { exePath, at: now(), looked: false });\n    schedule(0);\n  }\n\n  // Which library games are running, given the running program names\n  function match(names) {\n    const runningNames = new Map(); // lower case -> as Windows wrote it\n    for (const n of names) runningNames.set(String(n).toLowerCase(), String(n));\n    const games = new Map(library);\n    for (const [k, p] of pending) if (!games.has(k)) games.set(k, p.exePath);\n    for (const [k, s] of sessions) if (!games.has(k)) games.set(k, s.exePath);\n    const counts = new Map();\n    for (const k of games.keys()) { const n = nameOf(k); counts.set(n, (counts.get(n) || 0) + 1); }\n    const found = new Map(); // key -> program name seen\n    const all = shouldWatchAll();\n    for (const [k, exePath] of games) {\n      const own = nameOf(exePath);\n      const wanted = pending.has(k) || sessions.has(k);\n      // A name shared by two games in the library, or a generic one, counts only for a game AURA started\n      const trustOwn = wanted || (all && !GENERIC.has(own) && counts.get(own) === 1);\n      if (trustOwn && runningNames.has(own)) { found.set(k, runningNames.get(own)); continue; }\n      if (!all && !wanted) continue;\n      for (const a of aliases.get(k) || []) if (runningNames.has(a)) { found.set(k, runningNames.get(a)); break; }\n    }\n    return found;\n  }\n\n  async function check() {\n    if (checking) return;\n    checking = true;\n    try {\n      let names = [];\n      try { names = (await list()) || []; } catch { names = null; }\n      if (names === null) return; // couldn't look this time: change nothing\n      const t = now();\n      const found = match(names);\n      // Started\n      for (const [k, name] of found) {\n        const s = sessions.get(k);\n        if (s) { s.lastSeen = t; s.misses = 0; continue; }\n        const p = pending.get(k);\n        pending.delete(k);\n        const exePath = library.get(k) || (p && p.exePath) || k;\n        const session = { exePath, start: p ? p.at : t, lastSeen: t, misses: 0, launched: !!p, name, looks: 0, lastLook: 0 };\n        sessions.set(k, session);\n        try { onStart(exePath, name, { launched: session.launched, start: session.start }); } catch {}\n      }\n      // Ended (or, in its first minutes, restarting / handing over to another program)\n      for (const [k, s] of [...sessions]) {\n        if (found.has(k)) { s.misses = 0; continue; }\n        s.misses++;\n        const starting = s.lastSeen - s.start < launchWaitMs;\n        if (starting && findAliases && s.looks < 6 && t - s.lastLook >= 15000) {\n          s.looks++; s.lastLook = t;\n          try { for (const n of (await findAliases(s.exePath)) || []) addAlias(s.exePath, n); } catch {}\n        }\n        const gone = starting ? t - s.lastSeen >= handoverMs : s.misses >= missesToEnd;\n        if (!gone) continue;\n        sessions.delete(k);\n        try { onEnd(s.exePath, { start: s.start, end: s.lastSeen, launched: s.launched }); } catch {}\n      }\n      // Still waiting for a game AURA started\n      for (const [k, p] of [...pending]) {\n        if (t - p.at > launchWaitMs) { pending.delete(k); continue; }\n        if (!p.looked && findAliases && t - p.at >= aliasAfterMs) {\n          p.looked = true;\n          try { for (const n of (await findAliases(p.exePath)) || []) addAlias(p.exePath, n); } catch {}\n        }\n      }\n    } finally {\n      checking = false;\n      schedule();\n    }\n  }\n\n  function schedule(delay) {\n    if (!running) return;\n    clearTimer(timer);\n    timer = setTimer(check, delay != null ? delay : (sessions.size || pending.size ? busyMs : idleMs));\n  }\n  function start() { if (running) return; running = true; schedule(1000); }\n  function stop() { running = false; clearTimer(timer); timer = null; }\n  // AURA is quitting: end what's running now, so the time played isn't lost\n  function finishAll() {\n    for (const [k, s] of [...sessions]) { sessions.delete(k); try { onEnd(s.exePath, { start: s.start, end: Math.max(s.lastSeen, now()), launched: s.launched }); } catch {} }\n    pending.clear();\n  }\n  const isRunning = (exePath) => sessions.has(keyOf(exePath));\n  const snapshot = () => ({ library: [...library.values()], sessions: [...sessions.values()].map((s) => ({ ...s })), pending: [...pending.values()].map((p) => ({ ...p })), aliases: Object.fromEntries([...aliases].map(([k, v]) => [k, [...v]])) });\n\n  return { setLibrary, launched, addAlias, check, start, stop, finishAll, isRunning, snapshot, match };\n}\n\n// ── What's running (Windows) ─────────────────────────────────────────────────\n// tasklist lists every program, including ones running as administrator. Answers null if it failed.\nfunction parseTasklist(csv) {\n  const names = [];\n  for (const line of String(csv || \"\").split(/\\r?\\n/)) {\n    const m = /^\"([^\"]+)\"/.exec(line.trim());\n    if (m && /\\.exe$/i.test(m[1])) names.push(m[1]);\n  }\n  return names;\n}\nfunction listRunning(run) {\n  return run(\"tasklist\", [\"/FO\", \"CSV\", \"/NH\"]).then((out) => (out && /\\.exe\"/i.test(out) ? parseTasklist(out) : null));\n}\n// Programs running from a game's folder (for games whose launcher starts a differently named\n// program). Windows hides the location of programs running as administrator, so those are missed.\nfunction listInFolder(run, dir) {\n  const folder = String(dir).replace(/\\\\+$/, \"\") + \"\\\\\";\n  const script = \"Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:AURA_DIR, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.Name }\";\n  return run(\"powershell\", [\"-NoProfile\", \"-NonInteractive\", \"-Command\", script], { env: { ...process.env, AURA_DIR: folder } })\n    .then((out) => String(out || \"\").split(/\\r?\\n/).map((s) => s.trim()).filter((s) => /\\.exe$/i.test(s)));\n}\n\nmodule.exports = { createGameWatch, parseTasklist, listRunning, listInFolder, GENERIC, HELPERS };\n","test":"// Sessions for every library game, however it was started (electron/gamewatch.js), and one session\n// for a game reopened within 5 minutes (src/sessionstore.js).\n// Added by aura-sessions-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst os = require(\"os\");\nconst path = require(\"path\");\nconst ROOT = path.join(__dirname, \"..\");\nconst { createGameWatch, parseTasklist, GENERIC } = require(path.resolve(process.argv[2] || path.join(ROOT, \"electron\", \"gamewatch.js\")));\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok ? \"\" : \"  \" + JSON.stringify(extra))); };\n\n(async () => {\n  // A pretend PC: a clock we move by hand, and the programs \"running\"\n  let clock = 1_000_000;\n  let running = [];\n  let listFails = false;\n  const events = [];\n  const dir = fs.mkdtempSync(path.join(os.tmpdir(), \"aura-gw-\"));\n  const make = (opts = {}) => createGameWatch({\n    list: async () => { if (listFails) throw new Error(\"tasklist failed\"); return running; },\n    onStart: (exe, name, info) => events.push([\"start\", exe, name, info.launched]),\n    onEnd: (exe, info) => events.push([\"end\", exe, info.end - info.start, info.launched]),\n    now: () => clock,\n    setTimer: () => 0, clearTimer: () => {},\n    aliasFile: path.join(dir, \"aliases.json\"),\n    ...opts,\n  });\n  const MADDEN = \"C:\\\\Games\\\\EA\\\\Madden NFL 27\\\\Madden27.exe\";\n  const APEX = \"C:\\\\Program Files (x86)\\\\Steam\\\\steamapps\\\\common\\\\Apex Legends\\\\r5apex_dx12.exe\";\n  const ARC = \"D:\\\\SteamLibrary\\\\steamapps\\\\common\\\\Arc Raiders\\\\ArcRaiders.exe\";\n  const LAUNCHER = \"C:\\\\Games\\\\Odd\\\\Launcher.exe\";\n  const step = async (w, ms) => { clock += ms; await w.check(); };\n\n  console.log(\"1. Games started outside AURA\");\n  let w = make();\n  w.setLibrary([MADDEN, APEX, ARC, LAUNCHER]);\n  running = [\"explorer.exe\", \"steam.exe\"];\n  await step(w, 0);\n  check(\"nothing running: no session\", events.length === 0);\n  running = [\"explorer.exe\", \"steam.exe\", \"r5apex_dx12.exe\"];\n  await step(w, 20000);\n  check(\"a game started from Steam is noticed\", events.length === 1 && events[0][0] === \"start\" && events[0][1] === APEX && events[0][3] === false, events);\n  check(\"names are matched whatever their capitals\", (running = [\"R5APEX_DX12.EXE\"], (await step(w, 5000)), events.length === 1));\n  for (let i = 0; i < 40; i++) await step(w, 5000); // a few minutes in\n  running = [\"explorer.exe\"];\n  await step(w, 5000);\n  check(\"one check without it isn't the end (a hiccup)\", events.length === 1);\n  await step(w, 5000);\n  check(\"gone twice: the session ends\", events.length === 2 && events[1][0] === \"end\" && events[1][1] === APEX, events);\n  check(\"timed to the last moment it was seen\", events[1][2] === 5000 * 41, events[1]);\n\n  console.log(\"2. Games AURA started (also ones that need administrator rights)\");\n  events.length = 0;\n  w.launched(MADDEN);\n  await step(w, 2000);\n  check(\"nothing yet while it starts\", events.length === 0);\n  running = [\"Madden27.exe\"];\n  await step(w, 30000);\n  check(\"seen: the session starts, timed from the moment you pressed Play\", events.length === 1 && events[0][3] === true && events[0][2] === \"Madden27.exe\");\n  for (let i = 0; i < 36; i++) await step(w, 5000);\n  running = []; await step(w, 5000); await step(w, 5000);\n  check(\"and ends when it closes\", events.length === 2 && events[1][2] === 32000 + 36 * 5000, events);\n  events.length = 0;\n  w.launched(ARC);\n  for (let i = 0; i < 40; i++) await step(w, 5000);\n  check(\"a game that never appears gives up after 3 minutes, with no fake session\", events.length === 0 && w.snapshot().pending.length === 0, w.snapshot());\n\n  console.log(\"2b. Games that close and start again as they load (Steam, EA app, anti-cheat)\");\n  events.length = 0;\n  w.launched(MADDEN);\n  running = [\"Madden27.exe\"]; await step(w, 3000);\n  check(\"the game appears: the timer starts\", events.length === 1 && events[0][0] === \"start\");\n  running = []; for (let i = 0; i < 8; i++) await step(w, 5000);\n  check(\"it closes and takes 40 seconds to come back: the session keeps going (no timer reset)\", events.length === 1, events);\n  running = [\"Madden27.exe\"]; await step(w, 5000);\n  for (let i = 0; i < 40; i++) await step(w, 5000);\n  check(\"still one session once it's back\", events.length === 1);\n  running = []; for (let i = 0; i < 3; i++) await step(w, 5000);\n  check(\"a game that has been running a while ends quickly when closed\", events.length === 2 && events[1][0] === \"end\", events);\n  events.length = 0;\n  w.launched(APEX);\n  running = [\"r5apex_dx12.exe\"]; await step(w, 3000);\n  running = []; for (let i = 0; i < 19; i++) await step(w, 5000);\n  check(\"a game quit right after starting ends once it's been gone 90 seconds\", events.length === 2 && events[1][0] === \"end\", events);\n  events.length = 0;\n  const handover = make({ findAliases: async (exe) => (exe === ARC ? [\"PioneerGame.exe\"] : []), aliasFile: path.join(dir, \"handover.json\") });\n  handover.setLibrary([ARC]);\n  handover.launched(ARC);\n  running = [\"ArcRaiders.exe\"]; await step(handover, 2000);\n  running = [\"PioneerGame.exe\"]; await step(handover, 5000); await step(handover, 5000);\n  for (let i = 0; i < 40; i++) await step(handover, 5000);\n  check(\"a launcher that hands over to its game: one session, following the game\", events.length === 1 && events[0][1] === ARC, events);\n  running = []; for (let i = 0; i < 3; i++) await step(handover, 5000);\n  check(\"which ends when the game closes\", events.length === 2 && events[1][2] >= 150000, events);\n\n  console.log(\"3. Launchers that start a differently named game\");\n  events.length = 0;\n  w = make({ findAliases: async (exe) => (exe === ARC ? [\"PioneerGame.exe\", \"CrashReportClient.exe\", \"EasyAntiCheat.exe\"] : []), aliasAfterMs: 15000 });\n  w.setLibrary([MADDEN, APEX, ARC, LAUNCHER]);\n  w.launched(ARC);\n  running = [\"PioneerGame.exe\"];\n  await step(w, 5000);\n  check(\"before AURA has looked, the real game isn't known\", events.length === 0);\n  await step(w, 15000);\n  check(\"AURA learns the game's real program from its folder (skipping crash reporters and anti-cheat)\", JSON.stringify(w.snapshot().aliases[ARC.toLowerCase()]) === JSON.stringify([\"pioneergame.exe\"]), w.snapshot().aliases);\n  await step(w, 5000);\n  check(\"and the session starts\", events.length === 1 && events[0][1] === ARC && events[0][2] === \"PioneerGame.exe\", events);\n  running = []; for (let i = 0; i < 20; i++) await step(w, 5000);\n  events.length = 0;\n  const again = make();\n  again.setLibrary([ARC]);\n  running = [\"PioneerGame.exe\"];\n  await step(again, 1000);\n  check(\"next time, even started from Steam, it's recognised (remembered on this PC)\", events.length === 1 && events[0][1] === ARC && events[0][3] === false, events);\n\n  console.log(\"4. What isn't counted\");\n  events.length = 0;\n  w = make();\n  w.setLibrary([LAUNCHER, \"C:\\\\A\\\\game.exe\", \"C:\\\\B\\\\game.exe\"]);\n  running = [\"Launcher.exe\", \"game.exe\"];\n  await step(w, 1000);\n  check(\"generic names (Launcher.exe, game.exe) only count when AURA starts the game\", events.length === 0 && GENERIC.has(\"launcher.exe\"));\n  w.launched(LAUNCHER);\n  await step(w, 1000);\n  check(\"then they do\", events.length === 1 && events[0][1] === LAUNCHER);\n  events.length = 0;\n  w = make({ shouldWatchAll: () => false });\n  w.setLibrary([APEX]);\n  running = [\"r5apex_dx12.exe\"];\n  await step(w, 1000);\n  check(\"with the setting off, games started outside AURA aren't counted\", events.length === 0);\n  w.launched(APEX); await step(w, 1000);\n  check(\"but games started with Play still are\", events.length === 1);\n  events.length = 0;\n  w = make();\n  w.setLibrary([APEX]);\n  running = [\"r5apex_dx12.exe\"]; await step(w, 1000);\n  listFails = true; await step(w, 5000); await step(w, 5000); await step(w, 5000);\n  check(\"if Windows can't be asked for a moment, nothing ends by mistake\", events.length === 1);\n  listFails = false;\n  w.setLibrary([\"not a path\", 5, null, \"C:\\\\x\\\\evil.bat\", APEX]);\n  check(\"only .exe paths are watched\", w.snapshot().library.length === 1);\n  w.finishAll();\n  check(\"quitting AURA mid-game keeps the time played so far\", events.length === 2 && events[1][0] === \"end\");\n\n  console.log(\"5. Reading tasklist\");\n  const out = '\"System Idle Process\",\"0\",\"Services\",\"0\",\"8 K\"\\r\\n\"explorer.exe\",\"4321\",\"Console\",\"1\",\"120,000 K\"\\r\\n\"r5apex_dx12.exe\",\"999\",\"Console\",\"1\",\"6,000,000 K\"\\r\\nINFO: nothing\\r\\n';\n  const names = parseTasklist(out);\n  check(\"program names come out of tasklist's list\", names.includes(\"explorer.exe\") && names.includes(\"r5apex_dx12.exe\") && !names.includes(\"System Idle Process\"), names);\n\n  console.log(\"6. Reopened within 5 minutes: one session\");\n  const store = {};\n  global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };\n  global.window = { dispatchEvent: () => {} };\n  global.Event = class { constructor(t) { this.type = t; } };\n  const src = fs.readFileSync(path.join(ROOT, \"src\", \"sessionstore.js\"), \"utf8\").replace(/^export /gm, \"\");\n  const mod = {};\n  new Function(\"mod\", src + \"\\nmod.addSession = addSession; mod.loadSessions = loadSessions; mod.MERGE_GAP_MS = typeof MERGE_GAP_MS === 'undefined' ? null : MERGE_GAP_MS;\")(mod);\n  const T = Date.UTC(2026, 9, 13, 21, 0, 0);\n  const add = (startMin, minutes, perf, extra = {}) => mod.addSession({ title: \"Madden 27\" }, { exePath: MADDEN, startTime: T + startMin * 60000, endTime: T + (startMin + minutes) * 60000, sessionMs: minutes * 60000, perf, ...extra });\n  add(0, 2, { avgCpu: 60, peakRam: 20e9, avgGpu: 30 });\n  add(3, 3, { avgCpu: 90, peakRam: 24e9, avgGpu: 40 });\n  add(7, 2, null);\n  let list = mod.loadSessions();\n  check(\"three quick restarts become one session\", list.length === 1 && list[0].durationMs === 7 * 60000 && list[0].start === T && list[0].end === T + 9 * 60000, list);\n  check(\"its numbers are combined (average by time, peaks kept)\", list[0].perf.avgCpu === 78 && list[0].perf.peakRam === 24e9, list[0].perf);\n  add(30, 20, { avgCpu: 50 });\n  list = mod.loadSessions();\n  check(\"a game started again much later is a new session\", list.length === 2 && list[0].durationMs === 20 * 60000);\n  add(51, 0.2, null);\n  check(\"a few seconds right after one is added to it rather than lost\", mod.loadSessions()[0].durationMs === 20 * 60000 + 12000);\n  add(200, 0.2, null);\n  check(\"a few seconds on their own still don't count\", mod.loadSessions().length === 2);\n  const ids = mod.loadSessions().map((s) => s.id);\n  check(\"a combined session gets a new id, so the cloud copy is replaced\", new Set(ids).size === ids.length && ids.every((id) => /^[\\w.:-]{1,80}$/.test(id)));\n  mod.addSession({ title: \"Apex Legends\" }, { exePath: APEX, startTime: T + 300 * 60000, endTime: T + 340 * 60000, sessionMs: 40 * 60000, detected: true });\n  check(\"a game started outside AURA is marked so\", mod.loadSessions()[0].outside === true);\n\n  fs.rmSync(dir, { recursive: true, force: true });\n  console.log(failed ? `\\n${failed} FAILED` : \"\\nall passed\");\n  process.exit(failed ? 1 : 0);\n})().catch((e) => { console.error(e); process.exit(1); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-sessions.bak";
const MARK = "Added by aura-sessions-setup.cjs";
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

// ── sessionstore.js: a game reopened within 5 minutes continues the same session ─
const ADD_SESSION = `// A game reopened within this long continues the same session (a restart, a crash, a launcher
// handing over), instead of a new row. Added by aura-sessions-setup.cjs.
export const MERGE_GAP_MS = 5 * 60 * 1000;
const newId = (end) => \`\${end}-\${Math.random().toString(36).slice(2, 7)}\`;
function mergePerf(a, aMs, b, bMs) {
  if (!a) return b || null;
  if (!b) return a;
  const w = (x, y) => (x == null ? y : y == null ? x : Math.round(((x * aMs + y * bMs) / Math.max(1, aMs + bMs)) * 10) / 10);
  const lo = (x, y) => (x == null ? y : y == null ? x : Math.min(x, y));
  const hi = (x, y) => (x == null ? y : y == null ? x : Math.max(x, y));
  let trace = [...(a.fpsTrace || []), ...(b.fpsTrace || [])];
  while (trace.length > 40) { const t = []; for (let i = 0; i < trace.length; i += 2) { const pair = [trace[i], trace[i + 1]].filter((v) => v != null); t.push(pair.length ? Math.round(pair.reduce((p, q) => p + q, 0) / pair.length) : null); } trace = t; }
  return { ...a, ...b, avgFps: w(a.avgFps, b.avgFps), lowFps: lo(a.lowFps, b.lowFps), avgCpu: w(a.avgCpu, b.avgCpu), peakCpu: hi(a.peakCpu, b.peakCpu), peakRam: hi(a.peakRam, b.peakRam), avgGpu: w(a.avgGpu, b.avgGpu), fpsTrace: trace.length ? trace : null };
}

export function addSession(game, data) {
  if (!data?.sessionMs || !data.exePath) return;
  const end = data.endTime || Date.now();
  const start = data.startTime || end - data.sessionMs;
  const list = loadSessions();
  // Guard against the same session being reported twice
  if (list.some((s) => s.exePath === data.exePath && s.end === end)) return;

  // Picked up again within a few minutes: one longer session (a new id, so it syncs as the new one)
  const at = list.findIndex((s) => s.exePath === data.exePath);
  const prev = at >= 0 ? list[at] : null;
  if (prev && start >= prev.end - 60000 && start - prev.end <= MERGE_GAP_MS) {
    list.splice(at, 1);
    list.unshift({ ...prev, id: newId(end), end: Math.max(prev.end, end), durationMs: prev.durationMs + data.sessionMs, perf: mergePerf(prev.perf, prev.durationMs, data.perf || null, data.sessionMs), outside: prev.outside && !!data.detected });
    save(list.slice(0, MAX_SESSIONS));
    return;
  }
  if (data.sessionMs < MIN_SESSION_MS) return;

  list.unshift({
    id: newId(end),
    exePath: data.exePath,
    title: game?.title || data.exePath.split(/[\\\\/]/).pop().replace(/\\.exe$/i, ""),
    category: game?.category || "Other",
    start,
    end,
    durationMs: data.sessionMs,
    perf: data.perf || null,
    outside: !!data.detected, // started from Steam, Epic, Xbox or a shortcut rather than AURA's Play button
  });
  save(list.slice(0, MAX_SESSIONS));
}
`;
function editSessionStore(text) {
  if (/export const MERGE_GAP_MS/.test(text)) return { text, notes: [] };
  const start = text.indexOf("export function addSession(game, data) {");
  const end = text.indexOf("export function deleteSession(");
  if (start < 0 || end < start) throw new Error("addSession() ( export function addSession(game, data) { ... } )");
  return { text: text.slice(0, start) + ADD_SESSION + "\n" + text.slice(end), notes: ["a game reopened within 5 minutes continues the same session"] };
}

// ── perf.js: FPS for the program that's really running ──────────────────────
function editPerf(text) {
  if (/const fpsFor = new Map\(\)/.test(text)) return { text, notes: [] };
  let t = text;
  t = swapOnce(t,
    "function beginSession(exePath) {\n  sessions.set(exePath, []);\n  startFps(exePath);\n  update();\n}",
    "// programName: the program actually running, when it isn't the library's exe (a launcher's game)\n" +
    "const fpsFor = new Map();\n" +
    "function beginSession(exePath, programName) {\n  sessions.set(exePath, []);\n  const target = programName || path.basename(exePath);\n  fpsFor.set(exePath, target);\n  startFps(target);\n  update();\n}",
    "beginSession() ( function beginSession(exePath) { sessions.set(exePath, []); startFps(exePath); update(); } )");
  t = swapOnce(t,
    "  if (fps.exeName === path.basename(exePath)) stopFps();",
    "  const target = String(fpsFor.get(exePath) || path.basename(exePath)).toLowerCase();\n  fpsFor.delete(exePath);\n  if (fps.exeName && fps.exeName.toLowerCase() === target) stopFps();",
    "endSession() ( if (fps.exeName === path.basename(exePath)) stopFps(); )");
  return { text: t, notes: ["FPS is measured on the program that's really running"] };
}

// ── main.js: one watcher for every session ──────────────────────────────────
const WATCH_BLOCK = `// ── Sessions: library games however they were started (see gamewatch.js) ─────
// Added by aura-sessions-setup.cjs. AURA's Play button, Steam, Epic, Xbox or a shortcut: each
// game in your library that runs gets a session, also games that need administrator rights.
const gameWatchKit = require("./gamewatch");
const gameWatch = gameWatchKit.createGameWatch({
  list: () => (process.platform === "win32" ? gameWatchKit.listRunning(runQuiet) : Promise.resolve([])),
  findAliases: (exePath) => (process.platform === "win32" ? gameWatchKit.listInFolder(runQuiet, path.dirname(exePath)) : Promise.resolve([])),
  shouldWatchAll: () => appSettings.trackAllGames !== false,
  aliasFile: path.join(app.getPath("userData"), "game-programs.json"),
  onStart: (exePath, programName, { launched }) => {
    perf.beginSession(exePath, programName);
    currentGameName = path.basename(exePath, ".exe");
    pushBarState();
    console.log("Session started: " + path.basename(exePath) + (launched ? "" : " (started outside AURA)"));
  },
  onEnd: (exePath, { start, end, launched }) => {
    const perfSummary = perf.endSession(exePath);
    if (currentGameName === path.basename(exePath, ".exe")) currentGameName = null;
    pushBarState();
    console.log("Session ended: " + path.basename(exePath) + " (" + Math.round((end - start) / 1000) + "s)");
    mainWin?.webContents.send("game-session-ended", { exePath, sessionMs: Math.max(0, end - start), startTime: start, endTime: end, perf: perfSummary, detected: !launched });
    if (launched) rpc.setActivity({ details: "Browsing Game Library", state: "AURA Game Launcher", largeImageKey: "aura_logo", startTimestamp: new Date() }).catch(() => {});
  },
});
// The games to look for: your library (the window sends it), remembered for next time
const watchListFile = () => path.join(app.getPath("userData"), "watched-games.json");
try { gameWatch.setLibrary(JSON.parse(fs.readFileSync(watchListFile(), "utf8"))); } catch {}
ipcMain.handle("games:watch", (_e, list) => {
  const paths = (Array.isArray(list) ? list : []).filter((p) => typeof p === "string" && p.length <= 1024 && /\\.exe$/i.test(p)).slice(0, 2000);
  gameWatch.setLibrary(paths);
  try { fs.writeFileSync(watchListFile(), JSON.stringify(paths)); } catch {}
  return { success: true, count: paths.length };
});
app.whenReady().then(() => gameWatch.start());
app.on("before-quit", () => { try { gameWatch.finishAll(); } catch {} }); // a game still running keeps the time played so far

`;
function editMain(text) {
  if (/require\("\.\/gamewatch"\)/.test(text)) return { text, notes: [] };
  let t = text;
  t = swapOnce(t, "// ── Launch Game ─", WATCH_BLOCK + "// ── Launch Game ─", "the Launch Game section ( // ── Launch Game )");
  // Games that need administrator rights: still tracked
  t = swapOnce(t,
    "      const err = await shell.openPath(exePath);\n      if (err) return { success: false, error: err };\n      return { success: true };\n    }",
    "      const err = await shell.openPath(exePath);\n      if (err) return { success: false, error: err };\n      gameWatch.launched(exePath); // still gets a session: AURA watches for the game (see gamewatch.js)\n      return { success: true };\n    }",
    "where games that need administrator rights are opened ( shell.openPath(exePath) in launch-game )");
  // The rest of the launch: the watcher times it
  const from = t.indexOf("    gameSessions.set(exePath, startTime);\n");
  const to = t.indexOf("    child.unref();\n    return { success: true };", from);
  if (from < 0 || to < 0) throw new Error("the session timing in launch-game ( gameSessions.set(exePath, startTime) ... child.unref() )");
  const rpcStart = t.indexOf("    rpc.setActivity({", from);
  const rpcEnd = t.indexOf("}).catch(() => {});\n", rpcStart);
  if (rpcStart < 0 || rpcEnd < 0 || rpcEnd > to) throw new Error("the Discord status in launch-game ( rpc.setActivity({ details: `Playing ...` )");
  const rpcBlock = t.slice(rpcStart, rpcEnd + "}).catch(() => {});\n".length);
  t = t.slice(0, from) +
    "    // AURA times the session from now, and watches for the game to appear and close (see gamewatch.js)\n" +
    "    gameWatch.launched(exePath);\n\n" + rpcBlock + "\n" + t.slice(to);
  // The setting
  t = swapOnce(t, "  trayTipShown: false,", "  trayTipShown: false,\n  trackAllGames: true,       // sessions for library games started outside AURA too (Added by aura-sessions-setup.cjs)",
    "AURA's main-process settings ( trayTipShown: false, )");
  t = swapOnce(t, "  appSettings.startWithWindows = appSettings.startWithWindows === true;\n",
    "  appSettings.startWithWindows = appSettings.startWithWindows === true;\n  appSettings.trackAllGames = appSettings.trackAllGames !== false;\n",
    "where settings are checked ( appSettings.startWithWindows = appSettings.startWithWindows === true; )");
  return { text: t, notes: ["every library game that runs gets a session, however it was started", "games that need administrator rights are tracked too"] };
}

// ── preload.js: the window sends its game list ──────────────────────────────
function editPreload(text) {
  if (/watchGames:/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /^\s*launchGame:\s*\(exePath\) => ipcRenderer\.invoke\("launch-game", exePath\),\s*$/.test(l));
  if (at < 0) throw new Error('the Play bridge ( launchGame: (exePath) => ipcRenderer.invoke("launch-game", exePath), )');
  const ind = lines[at].match(/^\s*/)[0];
  lines.splice(at + 1, 0, ind + 'watchGames: (paths) => ipcRenderer.invoke("games:watch", paths), // the games Sessions looks for');
  return { text: lines.join("\n"), notes: ["the window tells AURA which games are in your library"] };
}

// ── App.jsx: send the list, count outside launches, and the setting ──────────
function editApp(text) {
  if (/watchGames\?\.\(/.test(text)) return { text, notes: [] };
  let t = text;
  t = swapOnce(t, "  useEffect(()=>{gamesRef.current=games;},[games]);\n",
    "  useEffect(()=>{gamesRef.current=games;},[games]);\n" +
    "  // Sessions also count library games started outside AURA (see electron/gamewatch.js)\n" +
    "  const watchList=useMemo(()=>games.map(g=>g.exePath).filter(Boolean).join(\"\\n\"),[games]);\n" +
    "  useEffect(()=>{ window.electronAPI?.watchGames?.(watchList?watchList.split(\"\\n\"):[]); },[watchList]);\n",
    "where the game list is kept for the session handler ( useEffect(()=>{gamesRef.current=games;},[games]); )");
  t = swapOnce(t,
    "if(g.exePath===data.exePath) return {...g,totalTime:(g.totalTime||0)+data.sessionMs,lastSessionMs:data.sessionMs};",
    "if(g.exePath===data.exePath) return {...g,totalTime:(g.totalTime||0)+data.sessionMs,lastSessionMs:data.sessionMs,...(data.detected?{lastPlayed:Math.max(g.lastPlayed||0,data.endTime||Date.now())}:{})};",
    "where a finished session adds to the game's playtime ( totalTime:(g.totalTime||0)+data.sessionMs )");
  t = swapOnce(t, "  startWithWindows: false,", "  startWithWindows: false,\n  trackAllGames: true,    // Sessions count library games started outside AURA (Added by aura-sessions-setup.cjs)",
    "the default settings ( startWithWindows: false, )");
  t = swapOnce(t, '"keepRunning","startWithWindows"]', '"keepRunning","startWithWindows","trackAllGames"]', "the settings the main process uses ( MAIN_SETTING_KEYS )");
  const row = /^(\s*)<div className="sr"><div><div className="sr-l">Import Xbox Game Pass<\/div>[^\n]*\n/m;
  const m = t.match(row);
  if (!m) throw new Error('the "Import Xbox Game Pass" row in Settings > Library');
  t = t.replace(row, (line) => line + m[1] + '<div className="sr"><div><div className="sr-l">Count Games Started Outside AURA</div><div className="sr-s">Sessions and playtime include library games you start from Steam, Epic, Xbox or a shortcut. AURA checks which are running on this PC; nothing is sent anywhere</div></div><Tog k="trackAllGames"/></div>\n');
  return { text: t, notes: ["Settings > Library: Count Games Started Outside AURA (on)"] };
}

// ── privacy.jsx: say what's checked ─────────────────────────────────────────
function editPrivacy(text) {
  if (/checks which programs are running/.test(text)) return { text, notes: [] };
  const find = '"Play sessions: the game, when it started and ended, and the game\'s file location on your PC.",';
  if (!text.includes(find)) return { text, notes: ["(couldn't find the play sessions line in the privacy page; left it as it is)"] };
  return { text: text.replace(find, '"Play sessions: the game, when it started and ended, and the game\'s file location on your PC. To notice a game you started outside AURA, AURA checks which programs are running on your PC and compares their names with your library. That check stays on your PC; only the sessions it finds are saved.",'), notes: ["the privacy page says how games are noticed"] };
}


// ── v2: the Now Playing timer follows the session (it starts for games started outside AURA,
// and doesn't vanish while a game restarts as it loads) ──────────────────────
function editMainV2(text) {
  if (/game-session-started/.test(text)) return { text, notes: [] };
  let t = text;
  t = swapOnce(t, "  onStart: (exePath, programName, { launched }) => {", "  onStart: (exePath, programName, { launched, start }) => {",
    "the session start in gamewatch's setup ( onStart: (exePath, programName, { launched }) => { ) — run this script's first version first if you haven't");
  t = swapOnce(t,
    '    console.log("Session started: " + path.basename(exePath) + (launched ? "" : " (started outside AURA)"));\n',
    '    console.log("Session started: " + path.basename(exePath) + (launched ? "" : " (started outside AURA)"));\n' +
    '    mainWin?.webContents.send("game-session-started", { exePath, startTime: start, launched }); // the Now Playing timer\n',
    "the session start log line ( console.log(\"Session started: \" ... ) )");
  return { text: t, notes: ["the window hears when a session starts"] };
}
function editPreloadV2(text) {
  if (/onGameSessionStarted:/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /^\s*onGameSessionEnded: \(cb\) => \{\s*$/.test(l));
  if (at < 0) throw new Error("where the window hears a session end ( onGameSessionEnded: (cb) => { )");
  const ind = lines[at].match(/^\s*/)[0];
  lines.splice(at, 0, ind + 'onGameSessionStarted: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on("game-session-started", h); return () => ipcRenderer.removeListener("game-session-started", h); },');
  return { text: lines.join("\n"), notes: ["the window hears when a session starts"] };
}
function editAppV2(text) {
  if (/onGameSessionStarted\?\.\(/.test(text)) return { text, notes: [] };
  let t = text;
  t = swapOnce(t,
    "    const off = window.electronAPI.onGameSessionEnded((_event,data)=>{\n",
    "    // A session started (from AURA, Steam, a shortcut...): show Now Playing, timed from its start\n" +
    "    const offStart = window.electronAPI.onGameSessionStarted?.((data)=>{\n" +
    "      const g=gamesRef.current.find(x=>x.exePath===data?.exePath);\n" +
    "      if(g) setNowPlaying(np=>np&&np.exePath!==g.exePath?np:{...g,startedAt:data.startTime||Date.now()});\n" +
    "    });\n" +
    "    const off = window.electronAPI.onGameSessionEnded((_event,data)=>{\n",
    "the session-ended listener ( const off = window.electronAPI.onGameSessionEnded((_event,data)=>{ )");
  t = swapOnce(t,
    "    return off;\n  },[checkAchievements, unlockedAch]);",
    "    return ()=>{ off?.(); offStart?.(); };\n  },[checkAchievements, unlockedAch]);",
    "the end of the session listener ( return off; },[checkAchievements, unlockedAch]); )");
  t = swapOnce(t,
    "function NowPlayingBar({ game, onClose }) {\n  const [secs, setSecs] = useState(0);",
    "function NowPlayingBar({ game, onClose }) {\n  const [secs, setSecs] = useState(() => (game.startedAt ? Math.max(0, Math.floor((Date.now() - game.startedAt) / 1000)) : 0));",
    "the Now Playing timer ( function NowPlayingBar({ game, onClose }) { const [secs, setSecs] = useState(0); )");
  return { text: t, notes: ["Now Playing shows for games started outside AURA too, timed from when they started"] };
}


// ── AURA's checks (only when they are installed) ─────────────────────────────
function editRunner(text) {
  if (/sessions\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  const at = findLine(lines, /^add\("window",/);
  if (at < 0) return { text, notes: ["(couldn't find where to add the sessions check, so npm test doesn't include it)"] };
  lines.splice(at, 0, 'if (fs.existsSync(path.join(__dirname, "sessions.cjs"))) add("files", "Sessions: every library game, however it was started", "sessions.cjs", [path.join(ROOT, "electron", "gamewatch.js")]);');
  return { text: lines.join("\n"), notes: ["npm test now checks Sessions too"] };
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
      } else if (entry.name === "gamewatch.js" || entry.name === "sessions.cjs") {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. Sessions are back to how they were." : "Nothing to undo.");
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
  const notElectron = (h) => !/[\\/]electron[\\/]/.test(h.file);
  const files = {
    main: findOne("your main file", (t) => /ipcMain\.handle\(\s*["']launch-game["']/.test(t), need, [
      (h) => startFile && sameFile(h.file, startFile),
      (h) => /function createWindow\s*\(/.test(h.text),
    ]),
    perf: findOne("your performance file (perf.js)", (t) => /function beginSession\(exePath/.test(t) && /function summarize\(samples\)/.test(t), need, [(h) => /^perf\.[cm]?js$/.test(path.basename(h.file))]),
    preload: findOne("your preload file", (t) => /contextBridge\.exposeInMainWorld\(\s*["']electronAPI["']/.test(t), need, [(h) => /^preload\.[cm]?js$/.test(path.basename(h.file))]),
    app: findOne("your App file", (t) => /function AuraApp\s*\(/.test(t) && /<AuraApp\b/.test(t), need, [(h) => /^App\.[jt]sx?$/.test(path.basename(h.file))]),
    store: findOne("your sessions file (sessionstore.js)", (t) => /export function addSession\(game, data\)/.test(t), need, [notElectron, (h) => /^sessionstore\.[jt]s$/i.test(path.basename(h.file))]),
    privacy: findOne("your privacy page (privacy.jsx)", (t) => /Play sessions:/.test(t), need, [notElectron, (h) => /[\\/]components[\\/]/.test(h.file)]),
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
  // Both steps run every time; each skips what's already done (so this also updates a copy set up
  // by this script's first version)
  const both = (one, two) => (text) => { const a = one(text); const b = two(a.text); return { text: b.text, notes: [...a.notes, ...b.notes] }; };
  consider("main file", files.main, both(editMain, editMainV2), true);
  consider("perf.js", files.perf, editPerf, true);
  consider("preload", files.preload, both(editPreload, editPreloadV2), true);
  consider("App file", files.app, both(editApp, editAppV2), false);
  consider("sessions", files.store, editSessionStore, false);
  consider("privacy", files.privacy, editPrivacy, false);
  const runner = path.join(ROOT, "tests", "run.cjs");
  const hasChecks = fs.existsSync(runner);
  if (hasChecks) consider("checks", runner, editRunner, true);

  const created = [{ label: "gamewatch", file: path.join(path.dirname(files.main), "gamewatch.js"), content: FILES.gamewatch }];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "sessions.cjs"), content: FILES.test });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: Sessions for every game");
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
  say("Done. Restart AURA (stop it in the terminal and start it again), then start a game from Steam and close it after a minute: it shows in Sessions.");
  if (hasChecks) say("Run  npm test  before your next release.");
  say("To undo later:  node aura-sessions-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
