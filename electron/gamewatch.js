// electron/gamewatch.js — notices when a game from your library is running, however it was started
// (AURA's Play button, Steam, Epic, the Xbox app, a shortcut), and when it closes.
// Added by aura-sessions-setup.cjs.
//
// Every few seconds it asks Windows for the names of the programs that are running (tasklist, on
// this PC only; nothing is sent anywhere) and matches them to the games in your library. A game
// that's seen starts a session; a game that's gone for two checks in a row ends it, timed to
// the last moment it was seen. In a game's first 3 minutes it may vanish for up to 90 seconds
// without ending: many games start, close and start again (Steam, the EA app and anti-cheat do
// this), and AURA looks in the game's folder for the program it hands over to. Games AURA started
// are watched for up to 3 minutes before they appear, and games that need administrator rights
// are seen like any other.
// Many games are started by a small program that opens the real one somewhere else in the game's
// folder (Unreal games run "<name>-Win64-Shipping.exe" from Binaries\Win64, for example). So every
// half minute or so AURA also looks at where running programs live, and a program running from
// inside a game's own folder counts as that game. The name it finds is remembered on this PC, so
// after that the quick check by name is enough.
"use strict";
const path = require("path");
const fs = require("fs");

// Names too common to tell games apart. A game whose program has one of these names is only
// tracked when AURA starts it.
const GENERIC = new Set([
  "launcher.exe", "game.exe", "start.exe", "play.exe", "setup.exe", "install.exe", "update.exe", "updater.exe",
  "client.exe", "app.exe", "main.exe", "bootstrapper.exe", "run.exe", "win64.exe", "shipping.exe",
]);
// Helpers that run beside games: never taken as the game itself
const HELPERS = /^(unins.*|.*crash.*|unrealcef.*|.*cefsub.*|.*cef.*process.*|crashpad.*|.*report.*|easyanticheat.*|eac.*|battleye.*|be.*service.*|start_protected_game|.*redist.*|vc_?redist.*|dxsetup|ue4prereq.*|cefprocess|.*webhelper.*|.*overlay.*|.*updater.*|.*launcher.*helper.*|steamservice|steam|epicgameslauncher|eadesktop|eabackgroundservice|origin|gamebar.*|xboxpcapp.*)\.exe$/i;

const nameOf = (p) => path.win32.basename(String(p || "")).toLowerCase(); // works for C:\ paths on any PC
const keyOf = (p) => String(p || "").toLowerCase();
const validExe = (p) => typeof p === "string" && p.length > 4 && p.length <= 1024 && /\.exe$/i.test(p) && !p.includes("\0");
// A game's own folder, when it is specific enough to stand for that game (not a drive, Program
// Files, a Steam or Xbox library folder, or the user's folder)
const BROAD = /^[a-z]:\\(?:|program files(?: \(x86\))?|windows(?:\\.*)?|users(?:\\[^\\]+)?(?:\\desktop|\\documents|\\downloads)?|programdata|games|xboxgames|steamlibrary|epic games|windowsapps|program files\\windowsapps)$|\\steamapps(?:\\common)?$|\\steam$|\\epic games$|\\ea games$|\\origin games$|\\xboxgames$|\\windowsapps$/i;
function folderOf(exePath) {
  if (!validExe(exePath) || !/^[a-z]:\\/i.test(exePath)) return null;
  const dir = path.win32.dirname(exePath).toLowerCase().replace(/\\+$/, "");
  if (dir.split("\\").length < 3 || BROAD.test(dir)) return null;
  return dir;
}

// The game's own programs, read from its folder on disk. For games protected by anti-cheat
// (Arc Raiders, The Finals, Fortnite...), Windows hides where the running program lives, so it
// can't be learned from what's running. Unreal games keep it in <Project>\Binaries\Win64.
const NOT_GAME_DIRS = /^(engine|installers?|redist|_?commonredist|easyanticheat|battleye|directx|dotnet|vcredist|support|prereq.*|tools?|launcher|__installer)$/i;
async function programsOnDisk(dir, readdir = (d) => fs.promises.readdir(d, { withFileTypes: true })) {
  const out = [];
  let top = [];
  try { top = await readdir(dir); } catch { return out; }
  const projects = top.filter((e) => e && e.isDirectory() && !NOT_GAME_DIRS.test(e.name)).slice(0, 30);
  for (const p of projects) {
    for (const plat of ["Win64", "WinGDK"]) {
      let files = [];
      try { files = await readdir(path.join(dir, p.name, "Binaries", plat)); } catch { continue; }
      for (const f of files) if (f && f.isFile() && /\.exe$/i.test(f.name)) out.push(f.name);
    }
  }
  return out.slice(0, 20);
}

function createGameWatch({
  list,                         // async () => array of running program names (e.g. "MaddenNFL27.exe")
  onStart = () => {},           // (exePath, programName, { launched })
  onEnd = () => {},             // (exePath, { start, end, launched })
  findAliases = null,           // async (exePath) => program names running from the game's folder
  listWithPaths = null,         // async () => [{ name, path }] of running programs (where they live), or null if it failed
  folderEveryMs = 30000,        // how often to look at where programs live (15 s while a game is starting)
  shouldWatchAll = () => true,  // false: only games AURA started
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  idleMs = 20000,               // how often to look when nothing is running
  busyMs = 5000,                // how often while a game runs or is starting
  missesToEnd = 2,
  launchWaitMs = 3 * 60 * 1000, // how long a game AURA started may take to appear, and how long a new game counts as "starting"
  handoverMs = 90 * 1000,       // how long a starting game may vanish while it restarts or hands over
  aliasAfterMs = 15000,         // when to look in its folder for the real program
  aliasFile = null,             // where learned program names are kept
  onDisk = programsOnDisk,      // async (folder) => program names the game keeps in its folder
  diskPerCheck = 4,             // how many games' folders to read per check (so AURA stays quick)
} = {}) {
  const library = new Map();    // lower-case path -> path as given
  const aliases = new Map();    // lower-case path -> Set of lower-case program names
  const sessions = new Map();   // lower-case path -> { exePath, start, lastSeen, misses, launched, name }
  const pending = new Map();    // lower-case path -> { exePath, at, looked }
  let timer = null;
  let running = false;
  let checking = false;
  let lastFolderLook = -Infinity;
  const diskRead = new Set();   // games whose folder has been read on disk this run

  try {
    if (aliasFile && fs.existsSync(aliasFile)) {
      const saved = JSON.parse(fs.readFileSync(aliasFile, "utf8"));
      for (const [k, names] of Object.entries(saved || {})) {
        if (Array.isArray(names)) aliases.set(k, new Set(names.filter((n) => typeof n === "string" && /\.exe$/i.test(n) && n.length < 260).map((n) => n.toLowerCase())));
      }
    }
  } catch {}
  const saveAliases = () => {
    if (!aliasFile) return;
    try { fs.writeFileSync(aliasFile, JSON.stringify(Object.fromEntries([...aliases].map(([k, v]) => [k, [...v]])))); } catch {}
  };

  function setLibrary(paths) {
    library.clear();
    for (const p of Array.isArray(paths) ? paths.slice(0, 2000) : []) if (validExe(p)) library.set(keyOf(p), p);
  }
  function addAlias(exePath, programName) {
    const n = String(programName || "").toLowerCase();
    if (!validExe(exePath) || !/\.exe$/i.test(n) || HELPERS.test(n) || GENERIC.has(n) || n === nameOf(exePath)) return false;
    const k = keyOf(exePath);
    const set = aliases.get(k) || new Set();
    if (set.has(n) || set.size >= 5) return false;
    set.add(n); aliases.set(k, set); saveAliases();
    return true;
  }
  // A game AURA just started: watch for it even if its name is generic, and time it from now
  function launched(exePath) {
    if (!validExe(exePath)) return;
    const k = keyOf(exePath);
    if (!library.has(k)) library.set(k, exePath);
    if (!sessions.has(k)) pending.set(k, { exePath, at: now(), looked: false });
    schedule(0);
  }

  // Learn the real program of each library game from where running programs live
  // Library games with a folder of their own. A folder that holds (or sits above) another game's
  // folder stands for neither.
  function ownFolders() {
    const all = shouldWatchAll();
    const games = [];
    for (const [k, exePath] of library) {
      if (!all && !pending.has(k) && !sessions.has(k)) continue;
      const dir = folderOf(exePath);
      if (dir) games.push({ k, exePath, dir });
    }
    const shared = new Set();
    for (const a of games) for (const b of games) {
      if (a !== b && (a.dir === b.dir || b.dir.startsWith(a.dir + "\\"))) { shared.add(a.k); shared.add(b.k); }
    }
    return games.filter((g) => !shared.has(g.k));
  }
  // Read a few games' folders on disk for their real program (games AURA is starting go first)
  async function learnFromDisk() {
    if (!onDisk) return;
    const games = ownFolders().filter((g) => !diskRead.has(g.k));
    games.sort((a, b) => Number(pending.has(b.k) || sessions.has(b.k)) - Number(pending.has(a.k) || sessions.has(a.k)));
    for (const g of games.slice(0, diskPerCheck)) {
      diskRead.add(g.k);
      let names = [];
      try { names = (await onDisk(g.dir)) || []; } catch { names = []; }
      for (const n of names) addAlias(g.exePath, n);
    }
  }
  function learnFromFolders(procs) {
    for (const g of ownFolders()) {
      const own = nameOf(g.exePath);
      for (const p of procs) {
        const n = String(p && p.name || "");
        const where = String(p && p.path || "").toLowerCase();
        if (!/\.exe$/i.test(n) || !where.startsWith(g.dir + "\\")) continue;
        if (n.toLowerCase() === own || HELPERS.test(n)) continue;
        addAlias(g.exePath, n);
      }
    }
  }
  // Unreal games: "THPS.exe" starts "THPS-Win64-Shipping.exe" (or -WinGDK- on Game Pass)
  const unrealOf = (own) => { const base = own.replace(/\.exe$/i, ""); return [base + "-win64-shipping.exe", base + "-wingdk-shipping.exe", base + "-win64-test.exe"]; };

  // Which library games are running, given the running program names
  function match(names) {
    const runningNames = new Map(); // lower case -> as Windows wrote it
    for (const n of names) runningNames.set(String(n).toLowerCase(), String(n));
    const games = new Map(library);
    for (const [k, p] of pending) if (!games.has(k)) games.set(k, p.exePath);
    for (const [k, s] of sessions) if (!games.has(k)) games.set(k, s.exePath);
    const counts = new Map();
    for (const k of games.keys()) { const n = nameOf(k); counts.set(n, (counts.get(n) || 0) + 1); }
    const found = new Map(); // key -> program name seen
    const all = shouldWatchAll();
    for (const [k, exePath] of games) {
      const own = nameOf(exePath);
      const wanted = pending.has(k) || sessions.has(k);
      // A name shared by two games in the library, or a generic one, counts only for a game AURA started
      const trustOwn = wanted || (all && !GENERIC.has(own) && counts.get(own) === 1);
      if (trustOwn && runningNames.has(own)) { found.set(k, runningNames.get(own)); continue; }
      const ue = (all || wanted) ? unrealOf(own).find((n) => runningNames.has(n)) : null;
      if (ue) { found.set(k, runningNames.get(ue)); continue; }
      if (!all && !wanted) continue;
      for (const a of aliases.get(k) || []) if (runningNames.has(a)) { found.set(k, runningNames.get(a)); break; }
    }
    return found;
  }

  async function check() {
    if (checking) return;
    checking = true;
    try {
      let names = [];
      try { names = (await list()) || []; } catch { names = null; }
      if (names === null) return; // couldn't look this time: change nothing
      const t = now();
      // Every half minute (sooner while a game is starting): programs running from inside a game's folder
      const starting = pending.size > 0 || [...sessions.values()].some((s) => s.lastSeen - s.start < launchWaitMs && s.misses > 0);
      if (listWithPaths && t - lastFolderLook >= (starting ? 15000 : folderEveryMs)) {
        lastFolderLook = t;
        let procs = null;
        try { procs = await listWithPaths(); } catch { procs = null; }
        if (Array.isArray(procs)) learnFromFolders(procs);
      }
      await learnFromDisk();
      const found = match(names);
      // Started
      for (const [k, name] of found) {
        const s = sessions.get(k);
        if (s) { s.lastSeen = t; s.misses = 0; continue; }
        const p = pending.get(k);
        pending.delete(k);
        const exePath = library.get(k) || (p && p.exePath) || k;
        const session = { exePath, start: p ? p.at : t, lastSeen: t, misses: 0, launched: !!p, name, looks: 0, lastLook: 0 };
        sessions.set(k, session);
        try { onStart(exePath, name, { launched: session.launched, start: session.start }); } catch {}
      }
      // Ended (or, in its first minutes, restarting / handing over to another program)
      for (const [k, s] of [...sessions]) {
        if (found.has(k)) { s.misses = 0; continue; }
        s.misses++;
        const starting = s.lastSeen - s.start < launchWaitMs;
        if (starting && findAliases && s.looks < 6 && t - s.lastLook >= 15000) {
          s.looks++; s.lastLook = t;
          try { for (const n of (await findAliases(s.exePath)) || []) addAlias(s.exePath, n); } catch {}
        }
        const gone = starting ? t - s.lastSeen >= handoverMs : s.misses >= missesToEnd;
        if (!gone) continue;
        sessions.delete(k);
        try { onEnd(s.exePath, { start: s.start, end: s.lastSeen, launched: s.launched }); } catch {}
      }
      // Still waiting for a game AURA started
      for (const [k, p] of [...pending]) {
        if (t - p.at > launchWaitMs) { pending.delete(k); continue; }
        p.looks = p.looks || 0;
        if (findAliases && p.looks < 6 && t - p.at >= aliasAfterMs * (p.looks + 1)) {
          p.looks++; p.looked = true;
          try { for (const n of (await findAliases(p.exePath)) || []) addAlias(p.exePath, n); } catch {}
        }
      }
    } finally {
      checking = false;
      schedule();
    }
  }

  function schedule(delay) {
    if (!running) return;
    clearTimer(timer);
    timer = setTimer(check, delay != null ? delay : (sessions.size || pending.size ? busyMs : idleMs));
  }
  function start() { if (running) return; running = true; schedule(1000); }
  function stop() { running = false; clearTimer(timer); timer = null; }
  // AURA is quitting: end what's running now, so the time played isn't lost
  function finishAll() {
    for (const [k, s] of [...sessions]) { sessions.delete(k); try { onEnd(s.exePath, { start: s.start, end: Math.max(s.lastSeen, now()), launched: s.launched }); } catch {} }
    pending.clear();
  }
  const isRunning = (exePath) => sessions.has(keyOf(exePath));
  const snapshot = () => ({ library: [...library.values()], sessions: [...sessions.values()].map((s) => ({ ...s })), pending: [...pending.values()].map((p) => ({ ...p })), aliases: Object.fromEntries([...aliases].map(([k, v]) => [k, [...v]])) });

  return { setLibrary, launched, addAlias, check, start, stop, finishAll, isRunning, snapshot, match };
}

// ── What's running (Windows) ─────────────────────────────────────────────────
// tasklist lists every program, including ones running as administrator. Answers null if it failed.
function parseTasklist(csv) {
  const names = [];
  for (const line of String(csv || "").split(/\r?\n/)) {
    const m = /^"([^"]+)"/.exec(line.trim());
    if (m && /\.exe$/i.test(m[1])) names.push(m[1]);
  }
  return names;
}
function listRunning(run) {
  return run("tasklist", ["/FO", "CSV", "/NH"]).then((out) => (out && /\.exe"/i.test(out) ? parseTasklist(out) : null));
}
// Programs running from a game's folder (for games whose launcher starts a differently named
// program). Windows hides the location of programs running as administrator, so those are missed.
function listInFolder(run, dir) {
  const folder = String(dir).replace(/\\+$/, "") + "\\";
  const script = "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:AURA_DIR, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.Name }";
  return run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, AURA_DIR: folder } })
    .then((out) => String(out || "").split(/\r?\n/).map((s) => s.trim()).filter((s) => /\.exe$/i.test(s)));
}

// Every running program with where it lives (one query; programs running as administrator have no location)
function listWithLocations(run) {
  const script = "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | ForEach-Object { $_.Name + '|' + $_.ExecutablePath }";
  return run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]).then((out) => {
    const rows = String(out || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf("|"); return i > 0 ? { name: l.slice(0, i), path: l.slice(i + 1) } : null; }).filter(Boolean);
    return rows.length ? rows : null;
  });
}

module.exports = { createGameWatch, parseTasklist, listRunning, listInFolder, listWithLocations, folderOf, programsOnDisk, GENERIC, HELPERS };
