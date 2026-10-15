// Sessions for every library game, however it was started (electron/gamewatch.js), and one session
// for a game reopened within 5 minutes (src/sessionstore.js).
// Added by aura-sessions-setup.cjs.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const { createGameWatch, parseTasklist, GENERIC, folderOf } = require(path.resolve(process.argv[2] || path.join(ROOT, "electron", "gamewatch.js")));
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };

(async () => {
  // A pretend PC: a clock we move by hand, and the programs "running"
  let clock = 1_000_000;
  let running = [];
  let listFails = false;
  const events = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-gw-"));
  const make = (opts = {}) => createGameWatch({
    list: async () => { if (listFails) throw new Error("tasklist failed"); return running; },
    onStart: (exe, name, info) => events.push(["start", exe, name, info.launched]),
    onEnd: (exe, info) => events.push(["end", exe, info.end - info.start, info.launched]),
    now: () => clock,
    setTimer: () => 0, clearTimer: () => {},
    aliasFile: path.join(dir, "aliases.json"),
    ...opts,
  });
  const MADDEN = "C:\\Games\\EA\\Madden NFL 27\\Madden27.exe";
  const APEX = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Apex Legends\\r5apex_dx12.exe";
  const ARC = "D:\\SteamLibrary\\steamapps\\common\\Arc Raiders\\ArcRaiders.exe";
  const LAUNCHER = "C:\\Games\\Odd\\Launcher.exe";
  const step = async (w, ms) => { clock += ms; await w.check(); };

  console.log("1. Games started outside AURA");
  let w = make();
  w.setLibrary([MADDEN, APEX, ARC, LAUNCHER]);
  running = ["explorer.exe", "steam.exe"];
  await step(w, 0);
  check("nothing running: no session", events.length === 0);
  running = ["explorer.exe", "steam.exe", "r5apex_dx12.exe"];
  await step(w, 20000);
  check("a game started from Steam is noticed", events.length === 1 && events[0][0] === "start" && events[0][1] === APEX && events[0][3] === false, events);
  check("names are matched whatever their capitals", (running = ["R5APEX_DX12.EXE"], (await step(w, 5000)), events.length === 1));
  for (let i = 0; i < 40; i++) await step(w, 5000); // a few minutes in
  running = ["explorer.exe"];
  await step(w, 5000);
  check("one check without it isn't the end (a hiccup)", events.length === 1);
  await step(w, 5000);
  check("gone twice: the session ends", events.length === 2 && events[1][0] === "end" && events[1][1] === APEX, events);
  check("timed to the last moment it was seen", events[1][2] === 5000 * 41, events[1]);

  console.log("2. Games AURA started (also ones that need administrator rights)");
  events.length = 0;
  w.launched(MADDEN);
  await step(w, 2000);
  check("nothing yet while it starts", events.length === 0);
  running = ["Madden27.exe"];
  await step(w, 30000);
  check("seen: the session starts, timed from the moment you pressed Play", events.length === 1 && events[0][3] === true && events[0][2] === "Madden27.exe");
  for (let i = 0; i < 36; i++) await step(w, 5000);
  running = []; await step(w, 5000); await step(w, 5000);
  check("and ends when it closes", events.length === 2 && events[1][2] === 32000 + 36 * 5000, events);
  events.length = 0;
  w.launched(ARC);
  for (let i = 0; i < 40; i++) await step(w, 5000);
  check("a game that never appears gives up after 3 minutes, with no fake session", events.length === 0 && w.snapshot().pending.length === 0, w.snapshot());

  console.log("2b. Games that close and start again as they load (Steam, EA app, anti-cheat)");
  events.length = 0;
  w.launched(MADDEN);
  running = ["Madden27.exe"]; await step(w, 3000);
  check("the game appears: the timer starts", events.length === 1 && events[0][0] === "start");
  running = []; for (let i = 0; i < 8; i++) await step(w, 5000);
  check("it closes and takes 40 seconds to come back: the session keeps going (no timer reset)", events.length === 1, events);
  running = ["Madden27.exe"]; await step(w, 5000);
  for (let i = 0; i < 40; i++) await step(w, 5000);
  check("still one session once it's back", events.length === 1);
  running = []; for (let i = 0; i < 3; i++) await step(w, 5000);
  check("a game that has been running a while ends quickly when closed", events.length === 2 && events[1][0] === "end", events);
  events.length = 0;
  w.launched(APEX);
  running = ["r5apex_dx12.exe"]; await step(w, 3000);
  running = []; for (let i = 0; i < 19; i++) await step(w, 5000);
  check("a game quit right after starting ends once it's been gone 90 seconds", events.length === 2 && events[1][0] === "end", events);
  events.length = 0;
  const handover = make({ findAliases: async (exe) => (exe === ARC ? ["PioneerGame.exe"] : []), aliasFile: path.join(dir, "handover.json") });
  handover.setLibrary([ARC]);
  handover.launched(ARC);
  running = ["ArcRaiders.exe"]; await step(handover, 2000);
  running = ["PioneerGame.exe"]; await step(handover, 5000); await step(handover, 5000);
  for (let i = 0; i < 40; i++) await step(handover, 5000);
  check("a launcher that hands over to its game: one session, following the game", events.length === 1 && events[0][1] === ARC, events);
  running = []; for (let i = 0; i < 3; i++) await step(handover, 5000);
  check("which ends when the game closes", events.length === 2 && events[1][2] >= 150000, events);

  console.log("3. Launchers that start a differently named game");
  events.length = 0;
  w = make({ findAliases: async (exe) => (exe === ARC ? ["PioneerGame.exe", "CrashReportClient.exe", "EasyAntiCheat.exe"] : []), aliasAfterMs: 15000 });
  w.setLibrary([MADDEN, APEX, ARC, LAUNCHER]);
  w.launched(ARC);
  running = ["PioneerGame.exe"];
  await step(w, 5000);
  check("before AURA has looked, the real game isn't known", events.length === 0);
  await step(w, 15000);
  check("AURA learns the game's real program from its folder (skipping crash reporters and anti-cheat)", JSON.stringify(w.snapshot().aliases[ARC.toLowerCase()]) === JSON.stringify(["pioneergame.exe"]), w.snapshot().aliases);
  await step(w, 5000);
  check("and the session starts", events.length === 1 && events[0][1] === ARC && events[0][2] === "PioneerGame.exe", events);
  running = []; for (let i = 0; i < 20; i++) await step(w, 5000);
  events.length = 0;
  const again = make();
  again.setLibrary([ARC]);
  running = ["PioneerGame.exe"];
  await step(again, 1000);
  check("next time, even started from Steam, it's recognised (remembered on this PC)", events.length === 1 && events[0][1] === ARC && events[0][3] === false, events);

  console.log("3b. Games whose real program lives elsewhere in their folder (Tony Hawk, other Unreal games)");
  events.length = 0;
  const THPS = "D:\\SteamLibrary\\steamapps\\common\\THPS34\\THPS34.exe";
  let procs = [];
  const fw = make({ listWithPaths: async () => procs, aliasFile: path.join(dir, "folders.json") });
  fw.setLibrary([THPS, MADDEN]);
  running = ["THPS34-Win64-Shipping.exe"];
  procs = [{ name: "THPS34-Win64-Shipping.exe", path: "D:\\SteamLibrary\\steamapps\\common\\THPS34\\THPS34\\Binaries\\Win64\\THPS34-Win64-Shipping.exe" }];
  await step(fw, 1000);
  check("an Unreal game started from Steam is recognised by its -Win64-Shipping program", events.length === 1 && events[0][1] === THPS && events[0][3] === false, events);
  running = []; procs = []; for (let i = 0; i < 20; i++) await step(fw, 5000);
  events.length = 0;
  const ODD = "C:\\Games\\Studio\\Odd Game\\OddGame.exe";
  fw.setLibrary([ODD]);
  running = ["Engine-Main.exe"];
  procs = [{ name: "Engine-Main.exe", path: "C:\\Games\\Studio\\Odd Game\\bin\\Engine-Main.exe" }, { name: "UnrealCEFSubProcess.exe", path: "C:\\Games\\Studio\\Odd Game\\bin\\UnrealCEFSubProcess.exe" }];
  await step(fw, 31000);
  check("any program running from inside a game's folder counts as that game", events.length === 1 && events[0][1] === ODD && events[0][2] === "Engine-Main.exe", events);
  check("helpers in the folder (browser helpers, crash reporters) aren't taken for the game", !JSON.stringify(fw.snapshot().aliases).includes("unrealcef"), fw.snapshot().aliases);
  running = []; procs = []; for (let i = 0; i < 20; i++) await step(fw, 5000);
  events.length = 0;
  fw.setLibrary(["C:\\Games\\Shared\\a.exe", "C:\\Games\\Shared\\b.exe"]);
  procs = [{ name: "other.exe", path: "C:\\Games\\Shared\\other.exe" }]; running = ["other.exe"];
  await step(fw, 31000);
  check("two games in the same folder: a third program there counts for neither", events.length === 0);
  check("broad folders (a drive, Program Files, a Steam library, Desktop) never stand for a game", folderOf("C:\\Games\\x.exe") === null && folderOf("D:\\steamapps\\common\\x.exe") === null && folderOf("C:\\Users\\me\\Desktop\\x.exe") === null && folderOf(THPS) !== null);

  console.log("4. What isn't counted");
  events.length = 0;
  w = make();
  w.setLibrary([LAUNCHER, "C:\\A\\game.exe", "C:\\B\\game.exe"]);
  running = ["Launcher.exe", "game.exe"];
  await step(w, 1000);
  check("generic names (Launcher.exe, game.exe) only count when AURA starts the game", events.length === 0 && GENERIC.has("launcher.exe"));
  w.launched(LAUNCHER);
  await step(w, 1000);
  check("then they do", events.length === 1 && events[0][1] === LAUNCHER);
  events.length = 0;
  w = make({ shouldWatchAll: () => false });
  w.setLibrary([APEX]);
  running = ["r5apex_dx12.exe"];
  await step(w, 1000);
  check("with the setting off, games started outside AURA aren't counted", events.length === 0);
  w.launched(APEX); await step(w, 1000);
  check("but games started with Play still are", events.length === 1);
  events.length = 0;
  w = make();
  w.setLibrary([APEX]);
  running = ["r5apex_dx12.exe"]; await step(w, 1000);
  listFails = true; await step(w, 5000); await step(w, 5000); await step(w, 5000);
  check("if Windows can't be asked for a moment, nothing ends by mistake", events.length === 1);
  listFails = false;
  w.setLibrary(["not a path", 5, null, "C:\\x\\evil.bat", APEX]);
  check("only .exe paths are watched", w.snapshot().library.length === 1);
  w.finishAll();
  check("quitting AURA mid-game keeps the time played so far", events.length === 2 && events[1][0] === "end");

  console.log("5. Reading tasklist");
  const out = '"System Idle Process","0","Services","0","8 K"\r\n"explorer.exe","4321","Console","1","120,000 K"\r\n"r5apex_dx12.exe","999","Console","1","6,000,000 K"\r\nINFO: nothing\r\n';
  const names = parseTasklist(out);
  check("program names come out of tasklist's list", names.includes("explorer.exe") && names.includes("r5apex_dx12.exe") && !names.includes("System Idle Process"), names);

  console.log("6. Reopened within 5 minutes: one session");
  const store = {};
  global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  global.window = { dispatchEvent: () => {} };
  global.Event = class { constructor(t) { this.type = t; } };
  const src = fs.readFileSync(path.join(ROOT, "src", "sessionstore.js"), "utf8").replace(/^export /gm, "");
  const mod = {};
  new Function("mod", src + "\nmod.addSession = addSession; mod.loadSessions = loadSessions; mod.MERGE_GAP_MS = typeof MERGE_GAP_MS === 'undefined' ? null : MERGE_GAP_MS;")(mod);
  const T = Date.UTC(2026, 9, 13, 21, 0, 0);
  const add = (startMin, minutes, perf, extra = {}) => mod.addSession({ title: "Madden 27" }, { exePath: MADDEN, startTime: T + startMin * 60000, endTime: T + (startMin + minutes) * 60000, sessionMs: minutes * 60000, perf, ...extra });
  add(0, 2, { avgCpu: 60, peakRam: 20e9, avgGpu: 30 });
  add(3, 3, { avgCpu: 90, peakRam: 24e9, avgGpu: 40 });
  add(7, 2, null);
  let list = mod.loadSessions();
  check("three quick restarts become one session", list.length === 1 && list[0].durationMs === 7 * 60000 && list[0].start === T && list[0].end === T + 9 * 60000, list);
  check("its numbers are combined (average by time, peaks kept)", list[0].perf.avgCpu === 78 && list[0].perf.peakRam === 24e9, list[0].perf);
  add(30, 20, { avgCpu: 50 });
  list = mod.loadSessions();
  check("a game started again much later is a new session", list.length === 2 && list[0].durationMs === 20 * 60000);
  add(51, 0.2, null);
  check("a few seconds right after one is added to it rather than lost", mod.loadSessions()[0].durationMs === 20 * 60000 + 12000);
  add(200, 0.2, null);
  check("a few seconds on their own still don't count", mod.loadSessions().length === 2);
  const ids = mod.loadSessions().map((s) => s.id);
  check("a combined session gets a new id, so the cloud copy is replaced", new Set(ids).size === ids.length && ids.every((id) => /^[\w.:-]{1,80}$/.test(id)));
  mod.addSession({ title: "Apex Legends" }, { exePath: APEX, startTime: T + 300 * 60000, endTime: T + 340 * 60000, sessionMs: 40 * 60000, detected: true });
  check("a game started outside AURA is marked so", mod.loadSessions()[0].outside === true);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
