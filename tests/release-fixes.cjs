// Release fixes: AURA stays light while you play, F9/F10 stay with your games unless you switch them
// on, the clip folder you pick is remembered, and a crashed window loads again.
// The performance monitor (electron/perf.js) is run for real with a pretend Windows; the rest of the
// main file is checked for the rules it must keep.
// Added by aura-release-fixes-setup.cjs.
const fs = require("fs");
const path = require("path");
const Module = require("module");
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const ROOT = path.resolve(__dirname, "..");
const perfFile = path.resolve(process.argv[2] || path.join(ROOT, "electron", "perf.js"));

(async () => {
  console.log("1. The performance monitor while you play");
  // A pretend Electron and systeminformation that count what AURA asks for
  const asked = { load: 0, mem: 0, net: 0, gpu: 0 }, sent = [], handlers = {}, timers = [];
  const si = {
    currentLoad: async () => { asked.load++; return { currentLoad: 10 }; }, mem: async () => { asked.mem++; return { active: 1, total: 2 }; },
    networkStats: async () => { asked.net++; return []; }, graphics: async () => { asked.gpu++; return { controllers: [] }; },
    fsSize: async () => [], fsStats: async () => null,
  };
  const electron = {
    app: { getAppPath: () => ROOT, isPackaged: false, on() {} },
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (ch) => sent.push(ch) } }] },
  };
  const realLoad = Module._load;
  Module._load = function (req, parent, ...rest) {
    if (parent && parent.filename === perfFile && req === "electron") return electron;
    if (parent && parent.filename === perfFile && req === "systeminformation") return si;
    return realLoad.call(this, req, parent, ...rest);
  };
  const realSet = global.setInterval, realClear = global.clearInterval;
  global.setInterval = (fn, ms) => { const t = { fn, ms, on: true }; timers.push(t); return t; };
  global.clearInterval = (t) => { if (t && typeof t === "object") t.on = false; };
  const perf = require(perfFile);
  perf.register();
  const live = () => timers.filter((t) => t.on);
  const run = async (n) => { for (let i = 0; i < n; i++) { for (const t of live()) t.fn(); await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); } };

  perf.beginSession("C:\\Games\\Arc\\Arc.exe");
  check("a game starting: AURA looks every 5 seconds, not every second", live().length === 1 && live()[0].ms === 5000, live().map((t) => t.ms));
  await run(6);
  check("...without reading the network, and without waking the window", asked.net === 0 && sent.length === 0 && asked.load === 6, { asked, sent: sent.length });
  check("...and the graphics card only every third look (15 seconds)", asked.gpu === 2, asked);
  await handlers["perf-subscribe"]();
  check("opening the stats: every second again", live().length === 1 && live()[0].ms === 1000);
  await run(3);
  check("...with network, and the window gets the numbers", asked.net === 3 && sent.filter((c) => c === "perf-stats").length === 3, { asked, sent: sent.length });
  handlers["perf-unsubscribe"]();
  check("closing the stats during the game: back to every 5 seconds", live().length === 1 && live()[0].ms === 5000);
  const summary = perf.endSession("C:\\Games\\Arc\\Arc.exe");
  check("the game closing: nothing keeps running, and its session still has a summary", live().length === 0 && summary && summary.avgCpu === 10, summary);
  global.setInterval = realSet; global.clearInterval = realClear; Module._load = realLoad;

  console.log("2. Rules the main file keeps");
  const main = fs.readFileSync(path.join(ROOT, "electron", "main.js"), "utf8");
  const registered = [...main.matchAll(/globalShortcut\.register\(\s*"(F9|F10)"/g)].map((m) => m.index);
  const guarded = registered.every((i) => /if \(appSettings\.keyF(9|10)\)\s*$/.test(main.slice(Math.max(0, i - 40), i)));
  check("F9 and F10 are only taken when you switch them on", registered.length === 2 && guarded, main.slice(registered[0] - 60, registered[0] + 40));
  check("they're off unless switched on", /keyF9: false,/.test(main) && /keyF10: false,/.test(main) && /appSettings\.keyF9 = appSettings\.keyF9 === true/.test(main));
  check("Alt+Shift+R records and Alt+Shift+B shows the AURA Bar", /RECORD_HOTKEY, toggleRecordingHotkey/.test(main) && /const BAR_HOTKEY = "Alt\+Shift\+B"/.test(main) && /BAR_HOTKEY, toggleBar/.test(main));
  check("the clip folder you pick is saved", /appSettings\.clipFolder = clipFolder; saveAppSettings\(\)/.test(main) && /if \(appSettings\.clipFolder && path\.isAbsolute\(appSettings\.clipFolder\)\) return appSettings\.clipFolder/.test(main));
  check("...and the window can't change it (only the folder picker can)", /appSettings\.clipFolder = prevClipFolder;/.test(main));
  check("clips already in AURA's data folder stay where they are; new ones go to Videos\\AURA", /fs\.readdirSync\(old\)\.length\) return old/.test(main) && /app\.getPath\("videos"\), "AURA"/.test(main));
  check("a crashed window loads again, at most once a minute", /render-process-gone[\s\S]{0,200}60000[\s\S]{0,200}mainWin\.reload\(\)/.test(main));
  check("the window is told when it's hidden and shown", /mainWin\.on\("hide", \(\) => tellShown\(false\)\)/.test(main) && /mainWin\.on\("show", \(\) => tellShown\(true\)\)/.test(main));

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
