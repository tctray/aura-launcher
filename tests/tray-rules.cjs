// Running in the tray (electron/main.js): when closing AURA only hides it, and when AURA
// really quits. Reads the desktop side's code, so it runs anywhere in a few seconds.
//
// Closing the window must hide AURA (so calls and messages still reach you), but these must
// always really quit, or AURA could get stuck running: Quit AURA in the tray menu, Restart now
// for an update, Windows shutting down, a downloaded update waiting to install, and
// "Keep AURA running" turned off.
// Added by aura-tray-setup.cjs.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok || extra === undefined ? "" : "  " + JSON.stringify(extra))); };
const read = (...p) => { try { return fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n"); } catch { return ""; } };

const main = read("electron", "main.js");
const social = read("electron", "social.js");
if (!main) { check("electron/main.js is here", false); process.exit(1); }

// The body of a handler, from its first line to the line that closes it
const body = (start) => {
  const at = main.indexOf(start);
  if (at < 0) return "";
  const end = main.indexOf("\n  });", at);
  return end < 0 ? "" : main.slice(at, end);
};
const closing = body('mainWin.on("close", (event) => {');

console.log("1. Closing the window");
check("closing the window hides AURA in the tray instead of quitting", /event\.preventDefault\(\);\s*hideToTray\(\);/.test(closing), closing.slice(0, 200));
const guard = (closing.match(/if \(([^\n]*)\) return;/) || [])[1] || "";
check("unless AURA is really quitting", /\bquitting\b/.test(guard), guard);
check("or an update has downloaded (closing installs it, as the update notice says)", /\bupdateReady\b/.test(guard) && /autoUpdater\.on\("update-downloaded", \(\) => \{ updateReady = true; \}\)/.test(main), guard);
check("or \"Keep AURA running when closed\" is off", /appSettings\.keepRunning === false/.test(guard), guard);
check("or the tray icon couldn't be made (then there'd be no way back)", /!tray\b/.test(guard), guard);
const hide = (main.match(/function hideToTray\(\) \{[\s\S]*?\n\}/) || [""])[0];
check("hiding also hides the AURA Bar, and remembers whether it was showing", /barWasVisible = [^\n]*auraBar\.isVisible\(\)/.test(hide) && /auraBar\.hide\(\)/.test(hide) && /mainWin\.hide\(\)/.test(hide));
check("the first time, a notification says AURA is still running and how to quit", /trayTipShown/.test(hide) && /AURA is still running/.test(hide) && /Quit AURA/.test(hide));

console.log("2. Really quitting");
check("anything that quits AURA marks it as quitting first", /app\.on\("before-quit", \(\) => \{ quitting = true; \}\)/.test(main));
const menu = (main.match(/Menu\.buildFromTemplate\(\[[\s\S]*?\]\)/) || [""])[0];
check("the tray menu has Open AURA and Quit AURA", /label: "Open AURA", click: showMain/.test(menu) && /label: "Quit AURA"/.test(menu), menu);
check("Quit AURA really quits", /label: "Quit AURA", click: \(\) => \{ quitting = true; app\.quit\(\); \}/.test(menu));
check("Restart now (installing an update) really quits", /ipcMain\.handle\("install-update", \(\) => \{ quitting = true; autoUpdater\.quitAndInstall\(/.test(main));
check("Windows shutting down, restarting or signing out lets AURA close", /mainWin\.on\("query-session-end", \(\) => \{ quitting = true; \}\)/.test(main) && /mainWin\.on\("session-end", \(\) => \{ quitting = true; \}\)/.test(main));
check("once really closed, AURA still shuts everything down as before", /mainWin\.on\("closed", \(\) => \{[\s\S]{0,200}app\.quit\(\);/.test(main));

console.log("3. Coming back");
check("clicking the tray icon opens AURA", /tray\.on\("click", showMain\)/.test(main));
const shown = (main.match(/function showMain\(\) \{[\s\S]*?\n\}/) || [""])[0];
check("opening it restores, shows and focuses the window", /restore\(\)/.test(shown) && /mainWin\.show\(\)/.test(shown) && /mainWin\.focus\(\)/.test(shown));
check("opening AURA again (a second launch) still brings the window back", /app\.on\("second-instance"[\s\S]{0,200}mainWin\.show\(\)/.test(main));
check("the AURA Bar comes back with the window if it was showing", /function onMainShown\(\) \{[\s\S]*?barWasVisible[\s\S]*?auraBar\.showInactive\(\)/.test(main) && /mainWin\.on\("show", onMainShown\)/.test(main));

console.log("4. Start AURA when Windows starts");
check("it is set through Windows' own sign-in list, with AURA's \"start hidden\" switch", /app\.setLoginItemSettings\(\{ openAtLogin: appSettings\.startWithWindows === true, args: \[START_HIDDEN_ARG\] \}\)/.test(main) && /const START_HIDDEN_ARG = "--hidden";/.test(main));
check("only in the installed app on Windows (never from your project folder)", /function applyStartWithWindows\(\) \{\s*if \(process\.platform !== "win32" \|\| !app\.isPackaged\) return;/.test(main));
check("changing the switch in Settings changes it", /if \(appSettings\.startWithWindows !== prevStart\) applyStartWithWindows\(\);/.test(main));
check("started by Windows: no window until it's opened", /let startHidden = process\.argv\.includes\(START_HIDDEN_ARG\)/.test(main) && /show: !startHidden, \/\/ started by Windows/.test(main) && /mainWin\.once\("ready-to-show", \(\) => \{ if \(!startHidden\) mainWin\.show\(\); \}\)/.test(main));
check("and no AURA Bar either", /show: !startHidden, \/\/ the AURA Bar/.test(main));
check("the window mode (maximized etc.) is applied when it's first opened", /if \(!startHidden\) applyWindowMode\(appSettings\.windowMode\)/.test(main) && /if \(startHidden\) \{ startHidden = false; applyWindowMode\(appSettings\.windowMode\); \}/.test(main));

console.log("5. The settings");
const defaults = (main.match(/const appSettings = \{[\s\S]*?\n\};/) || [""])[0];
check("\"Keep AURA running\" starts on and \"Start with Windows\" starts off", /keepRunning: true,/.test(defaults) && /startWithWindows: false,/.test(defaults), defaults);
check("Settings can change both", /appSettings\.keepRunning = appSettings\.keepRunning !== false;/.test(main) && /appSettings\.startWithWindows = appSettings\.startWithWindows === true;/.test(main));

console.log("6. Calls while AURA is hidden");
if (!social) console.log("  note  electron/social.js isn't here, so this wasn't checked");
else {
  const ring = (social.match(/async function ring\(call\) \{[\s\S]*?\n  \}/) || [""])[0];
  check("a call rings with a Windows notification whenever AURA's window isn't in front (hidden counts)", /if \(win\.isFocused\(\) && win\.isVisible\(\) && !win\.isMinimized\(\)\) return;/.test(ring) && /new Notification\(/.test(ring), ring.slice(0, 160));
  check("clicking the notification opens AURA", /n\.on\("click"[\s\S]{0,200}\.show\(\)/.test(ring));
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
