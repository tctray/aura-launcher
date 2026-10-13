#!/usr/bin/env node
/**
 * AURA — keeps running in the tray, so calls and messages reach you
 *
 * Before: closing AURA's window quit AURA completely, so a friend's call couldn't ring.
 *
 * Now:
 *   - Closing the window hides AURA instead. It keeps running, with an AURA icon by the clock.
 *     Click the icon to open AURA. Right-click it for Open AURA and Quit AURA.
 *   - A call while AURA is hidden rings and shows a Windows notification. Click it to open AURA
 *     and answer. Message notifications work the same way.
 *   - The first time you close it, a notification says AURA is still running and how to quit.
 *   - Settings > Calls and messages has two switches:
 *       Keep AURA Running When Closed     (on)   turn off to make closing quit AURA, as before
 *       Start AURA When Windows Starts    (off)  opens AURA by the clock when you sign in
 *   - AURA still really quits for: Quit AURA, Restart now (updates), Windows shutting down, and
 *     closing it when an update has downloaded (that installs the update).
 *   - The AURA Bar hides with the window and comes back with it. F9 and F10 keep working.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-tray-setup.cjs
 *   4. Then:  npm test
 *
 * What it does:
 *   - edits    electron/main.js          closing hides AURA; the tray icon; start with Windows
 *   - edits    src/App.jsx               the two switches in Settings
 *   - creates  tests/tray-rules.cjs      (only if AURA's checks are installed) when AURA hides and when it quits
 *   - creates  tests/tray-settings.cjs   (same) the switches in Settings
 *   - edits    tests/run.cjs             (same) so npm test runs them
 *
 * Every file it changes is copied to <name>.before-tray.bak first.
 * To put everything back:                 node aura-tray-setup.cjs --undo
 * To preview without changing anything:   node aura-tray-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const EDITS = [{"kind":"insert","file":"main","label":"closing AURA's window keeps AURA running in the tray, so calls and messages still reach you","after":"let mainWin       = null;","done":"// ── Running in the tray ──","text":"\n// ── Running in the tray ───────────────────────────────────────────────────────\n// Added by aura-tray-setup.cjs.\n// Closing AURA's window hides it instead of quitting, so calls and messages still reach you\n// (Settings > \"Keep AURA running when closed\" turns this off). An AURA icon by the clock opens\n// it again or quits it. \"Start AURA when Windows starts\" opens it straight into the tray.\n// AURA really quits when you choose Quit AURA, press Restart now for an update, when Windows\n// shuts down, or when an update has downloaded (closing it then installs the update).\nconst START_HIDDEN_ARG = \"--hidden\";\nlet tray = null;\nlet quitting = false;\nlet updateReady = false;\nlet startHidden = process.argv.includes(START_HIDDEN_ARG); // started by Windows at sign-in\nlet barWasVisible = true; // the AURA Bar comes back with the window if it was showing when AURA was closed\napp.on(\"before-quit\", () => { quitting = true; });\nautoUpdater.on(\"update-downloaded\", () => { updateReady = true; });\nfunction showMain() {\n  if (!mainWin || mainWin.isDestroyed()) return;\n  if (mainWin.isMinimized()) mainWin.restore();\n  mainWin.show();\n  mainWin.focus();\n}\n// Whenever the window comes back (tray icon, a notification, opening AURA again)\nfunction onMainShown() {\n  if (startHidden) { startHidden = false; applyWindowMode(appSettings.windowMode); }\n  if (barWasVisible && auraBar && !auraBar.isDestroyed() && !auraBar.isVisible()) auraBar.showInactive();\n}\nfunction hideToTray() {\n  barWasVisible = !!auraBar && !auraBar.isDestroyed() && auraBar.isVisible();\n  if (barWasVisible) auraBar.hide();\n  mainWin.hide();\n  if (appSettings.trayTipShown) return;\n  // The first time only: say where AURA went\n  appSettings.trayTipShown = true;\n  saveAppSettings();\n  try {\n    const { Notification } = require(\"electron\");\n    if (!Notification.isSupported()) return;\n    const tip = new Notification({ title: \"AURA is still running\", body: \"Calls and messages will still reach you. To quit, right-click the AURA icon by the clock and choose Quit AURA.\" });\n    tip.on(\"click\", showMain);\n    tip.show();\n  } catch {}\n}\nfunction createTray() {\n  if (tray) return;\n  const { Tray, Menu, nativeImage } = require(\"electron\");\n  let image = nativeImage.createFromPath(path.join(__dirname, app.isPackaged ? \"../dist/icon.png\" : \"../public/icon.png\"));\n  if (image.isEmpty()) image = nativeImage.createFromPath(path.join(__dirname, \"../public/icon.png\"));\n  if (!image.isEmpty()) image = image.resize({ width: 32, height: 32, quality: \"best\" });\n  try { tray = new Tray(image); } catch (e) { console.error(\"Tray icon unavailable:\", e.message); tray = null; return; }\n  tray.setToolTip(\"AURA\");\n  tray.setContextMenu(Menu.buildFromTemplate([\n    { label: \"Open AURA\", click: showMain },\n    { type: \"separator\" },\n    { label: \"Quit AURA\", click: () => { quitting = true; app.quit(); } },\n  ]));\n  tray.on(\"click\", showMain);\n}\nfunction applyStartWithWindows() {\n  if (process.platform !== \"win32\" || !app.isPackaged) return;\n  try { app.setLoginItemSettings({ openAtLogin: appSettings.startWithWindows === true, args: [START_HIDDEN_ARG] }); }\n  catch (e) { console.error(\"Start with Windows:\", e.message); }\n}\n"},{"kind":"insert","file":"main","label":"Settings has \"Keep AURA running when closed\" (on) and \"Start AURA when Windows starts\" (off)","after":"  systemVolume: 1,           // 0 – 2","done":"keepRunning: true,","text":"  keepRunning: true,         // closing the window keeps AURA in the tray (Added by aura-tray-setup.cjs)\n  startWithWindows: false,   // open AURA in the tray when you sign in to Windows\n  trayTipShown: false,       // the \"AURA is still running\" tip has been shown once\n"},{"kind":"insert","file":"main","label":"closing AURA's window keeps AURA running in the tray, so calls and messages still reach you","after":"    minHeight: 600,","done":"show: !startHidden,","text":"    show: !startHidden, // started by Windows at sign-in: stay in the tray until opened\n"},{"kind":"replace","file":"main","label":"closing AURA's window keeps AURA running in the tray, so calls and messages still reach you","done":"if (!startHidden) applyWindowMode(appSettings.windowMode);","before":"  applyWindowMode(appSettings.windowMode);\n  mainWin.once(\"ready-to-show\", () => mainWin.show());","text":"  if (!startHidden) applyWindowMode(appSettings.windowMode); // started hidden: done when it's first shown\n  mainWin.once(\"ready-to-show\", () => { if (!startHidden) mainWin.show(); });\n  mainWin.on(\"show\", onMainShown);"},{"kind":"insert","file":"main","label":"closing AURA's window keeps AURA running in the tray, so calls and messages still reach you","done":"hideToTray();","aheadOf":"// Closing AURA also closes the AURA Bar and fully quits the app","text":"  // Closing the window hides AURA in the tray (see \"Running in the tray\"). It really closes when\n  // AURA is quitting, when an update is waiting to install, or when \"Keep AURA running\" is off.\n  mainWin.on(\"close\", (event) => {\n    if (quitting || updateReady || appSettings.keepRunning === false || !tray) return;\n    event.preventDefault();\n    hideToTray();\n  });\n  // Windows is shutting down, restarting or signing out: let AURA close\n  mainWin.on(\"query-session-end\", () => { quitting = true; });\n  mainWin.on(\"session-end\", () => { quitting = true; });\n"},{"kind":"insert","file":"main","label":"closing AURA's window keeps AURA running in the tray, so calls and messages still reach you","after":"    skipTaskbar: true,","done":"show: !startHidden, // the AURA Bar","text":"    show: !startHidden, // the AURA Bar waits for the window when AURA starts in the tray\n"},{"kind":"insert","file":"main","label":"closing AURA's window keeps AURA running in the tray, so calls and messages still reach you","after":"  registerHotkeys();","done":"  createTray();","text":"  createTray();\n  applyStartWithWindows();\n"},{"kind":"replace","file":"main","label":"closing AURA's window keeps AURA running in the tray, so calls and messages still reach you","done":"ipcMain.handle(\"install-update\", () => { quitting = true;","before":"  ipcMain.handle(\"install-update\", () => autoUpdater.quitAndInstall(false, true));","text":"  ipcMain.handle(\"install-update\", () => { quitting = true; autoUpdater.quitAndInstall(false, true); });"},{"kind":"insert","file":"main","label":"Settings has \"Keep AURA running when closed\" (on) and \"Start AURA when Windows starts\" (off)","after":"  const prevZoom = appSettings.zoom;","done":"const prevStart = appSettings.startWithWindows;","text":"  const prevStart = appSettings.startWithWindows;\n"},{"kind":"insert","file":"main","label":"Settings has \"Keep AURA running when closed\" (on) and \"Start AURA when Windows starts\" (off)","after":"  appSettings.zoom = Math.min(1.3, Math.max(0.8, Number(appSettings.zoom) || 1));","done":"appSettings.keepRunning = appSettings.keepRunning !== false;","text":"  appSettings.keepRunning = appSettings.keepRunning !== false;\n  appSettings.startWithWindows = appSettings.startWithWindows === true;\n"},{"kind":"insert","file":"main","label":"Settings has \"Keep AURA running when closed\" (on) and \"Start AURA when Windows starts\" (off)","after":"  if (appSettings.zoom !== prevZoom) mainWin?.webContents.setZoomFactor(appSettings.zoom);","done":"if (appSettings.startWithWindows !== prevStart) applyStartWithWindows();","text":"  if (appSettings.startWithWindows !== prevStart) applyStartWithWindows();\n"},{"kind":"insert","file":"app","label":"Settings has \"Keep AURA running when closed\" (on) and \"Start AURA when Windows starts\" (off)","after":"  windowMode: \"maximized\",// \"maximized\" | \"fullscreen\" | \"windowed\"","done":"keepRunning: true,","text":"  // Running in the background (Added by aura-tray-setup.cjs)\n  keepRunning: true,      // closing the window keeps AURA in the tray, so calls still reach you\n  startWithWindows: false,// open AURA in the tray when you sign in to Windows\n"},{"kind":"replace","file":"app","label":"Settings has \"Keep AURA running when closed\" (on) and \"Start AURA when Windows starts\" (off)","done":"\"systemVolume\",\"keepRunning\",\"startWithWindows\"];","before":"const MAIN_SETTING_KEYS = [\"windowMode\",\"zoom\",\"micDevice\",\"systemDevice\",\"micVolume\",\"systemVolume\"];","text":"const MAIN_SETTING_KEYS = [\"windowMode\",\"zoom\",\"micDevice\",\"systemDevice\",\"micVolume\",\"systemVolume\",\"keepRunning\",\"startWithWindows\"];"},{"kind":"re","file":"app","label":"Settings has \"Keep AURA running when closed\" (on) and \"Start AURA when Windows starts\" (off)","re":"^      <div className=\"ss\">\\n        <div className=\"ss-t\">SOUND</div>\\n","done":"<div className=\"ss-t\">CALLS AND MESSAGES</div>","text":"      <div className=\"ss\">\n        <div className=\"ss-t\">CALLS AND MESSAGES</div>\n        <div className=\"ss-card\">\n          <div className=\"sr\"><div><div className=\"sr-l\">Keep AURA Running When Closed</div><div className=\"sr-s\">Closing AURA keeps it running by the clock, so friends' calls and messages still reach you. To quit, right-click the AURA icon there</div></div><Tog k=\"keepRunning\"/></div>\n          <div className=\"sr\"><div><div className=\"sr-l\">Start AURA When Windows Starts</div><div className=\"sr-s\">Opens AURA quietly by the clock when you sign in, so you can get calls right away</div></div><Tog k=\"startWithWindows\"/></div>\n        </div>\n      </div>\n      <div className=\"ss\">\n        <div className=\"ss-t\">SOUND</div>\n"},{"kind":"insert","file":"runner","label":"npm test now checks running in the tray","after":"add(\"files\", \"Project files\", \"static.cjs\");","done":"tray-rules.cjs","text":"if (fs.existsSync(path.join(__dirname, \"tray-rules.cjs\"))) add(\"files\", \"Running in the tray: when AURA closes and when it only hides\", \"tray-rules.cjs\");\n"},{"kind":"insert","file":"runner","label":"npm test now checks running in the tray","after":"add(\"window\", \"The window opens and every page loads\", \"window.cjs\");","done":"tray-settings.cjs","text":"if (fs.existsSync(path.join(__dirname, \"tray-settings.cjs\"))) add(\"window\", \"Settings: running in the background\", \"tray-settings.cjs\");\n"}];
const FILES = {"rules":"// Running in the tray (electron/main.js): when closing AURA only hides it, and when AURA\n// really quits. Reads the desktop side's code, so it runs anywhere in a few seconds.\n//\n// Closing the window must hide AURA (so calls and messages still reach you), but these must\n// always really quit, or AURA could get stuck running: Quit AURA in the tray menu, Restart now\n// for an update, Windows shutting down, a downloaded update waiting to install, and\n// \"Keep AURA running\" turned off.\n// Added by aura-tray-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"  \" + JSON.stringify(extra))); };\nconst read = (...p) => { try { return fs.readFileSync(path.join(ROOT, ...p), \"utf8\").replace(/\\r\\n/g, \"\\n\"); } catch { return \"\"; } };\n\nconst main = read(\"electron\", \"main.js\");\nconst social = read(\"electron\", \"social.js\");\nif (!main) { check(\"electron/main.js is here\", false); process.exit(1); }\n\n// The body of a handler, from its first line to the line that closes it\nconst body = (start) => {\n  const at = main.indexOf(start);\n  if (at < 0) return \"\";\n  const end = main.indexOf(\"\\n  });\", at);\n  return end < 0 ? \"\" : main.slice(at, end);\n};\nconst closing = body('mainWin.on(\"close\", (event) => {');\n\nconsole.log(\"1. Closing the window\");\ncheck(\"closing the window hides AURA in the tray instead of quitting\", /event\\.preventDefault\\(\\);\\s*hideToTray\\(\\);/.test(closing), closing.slice(0, 200));\nconst guard = (closing.match(/if \\(([^\\n]*)\\) return;/) || [])[1] || \"\";\ncheck(\"unless AURA is really quitting\", /\\bquitting\\b/.test(guard), guard);\ncheck(\"or an update has downloaded (closing installs it, as the update notice says)\", /\\bupdateReady\\b/.test(guard) && /autoUpdater\\.on\\(\"update-downloaded\", \\(\\) => \\{ updateReady = true; \\}\\)/.test(main), guard);\ncheck(\"or \\\"Keep AURA running when closed\\\" is off\", /appSettings\\.keepRunning === false/.test(guard), guard);\ncheck(\"or the tray icon couldn't be made (then there'd be no way back)\", /!tray\\b/.test(guard), guard);\nconst hide = (main.match(/function hideToTray\\(\\) \\{[\\s\\S]*?\\n\\}/) || [\"\"])[0];\ncheck(\"hiding also hides the AURA Bar, and remembers whether it was showing\", /barWasVisible = [^\\n]*auraBar\\.isVisible\\(\\)/.test(hide) && /auraBar\\.hide\\(\\)/.test(hide) && /mainWin\\.hide\\(\\)/.test(hide));\ncheck(\"the first time, a notification says AURA is still running and how to quit\", /trayTipShown/.test(hide) && /AURA is still running/.test(hide) && /Quit AURA/.test(hide));\n\nconsole.log(\"2. Really quitting\");\ncheck(\"anything that quits AURA marks it as quitting first\", /app\\.on\\(\"before-quit\", \\(\\) => \\{ quitting = true; \\}\\)/.test(main));\nconst menu = (main.match(/Menu\\.buildFromTemplate\\(\\[[\\s\\S]*?\\]\\)/) || [\"\"])[0];\ncheck(\"the tray menu has Open AURA and Quit AURA\", /label: \"Open AURA\", click: showMain/.test(menu) && /label: \"Quit AURA\"/.test(menu), menu);\ncheck(\"Quit AURA really quits\", /label: \"Quit AURA\", click: \\(\\) => \\{ quitting = true; app\\.quit\\(\\); \\}/.test(menu));\ncheck(\"Restart now (installing an update) really quits\", /ipcMain\\.handle\\(\"install-update\", \\(\\) => \\{ quitting = true; autoUpdater\\.quitAndInstall\\(/.test(main));\ncheck(\"Windows shutting down, restarting or signing out lets AURA close\", /mainWin\\.on\\(\"query-session-end\", \\(\\) => \\{ quitting = true; \\}\\)/.test(main) && /mainWin\\.on\\(\"session-end\", \\(\\) => \\{ quitting = true; \\}\\)/.test(main));\ncheck(\"once really closed, AURA still shuts everything down as before\", /mainWin\\.on\\(\"closed\", \\(\\) => \\{[\\s\\S]{0,200}app\\.quit\\(\\);/.test(main));\n\nconsole.log(\"3. Coming back\");\ncheck(\"clicking the tray icon opens AURA\", /tray\\.on\\(\"click\", showMain\\)/.test(main));\nconst shown = (main.match(/function showMain\\(\\) \\{[\\s\\S]*?\\n\\}/) || [\"\"])[0];\ncheck(\"opening it restores, shows and focuses the window\", /restore\\(\\)/.test(shown) && /mainWin\\.show\\(\\)/.test(shown) && /mainWin\\.focus\\(\\)/.test(shown));\ncheck(\"opening AURA again (a second launch) still brings the window back\", /app\\.on\\(\"second-instance\"[\\s\\S]{0,200}mainWin\\.show\\(\\)/.test(main));\ncheck(\"the AURA Bar comes back with the window if it was showing\", /function onMainShown\\(\\) \\{[\\s\\S]*?barWasVisible[\\s\\S]*?auraBar\\.showInactive\\(\\)/.test(main) && /mainWin\\.on\\(\"show\", onMainShown\\)/.test(main));\n\nconsole.log(\"4. Start AURA when Windows starts\");\ncheck(\"it is set through Windows' own sign-in list, with AURA's \\\"start hidden\\\" switch\", /app\\.setLoginItemSettings\\(\\{ openAtLogin: appSettings\\.startWithWindows === true, args: \\[START_HIDDEN_ARG\\] \\}\\)/.test(main) && /const START_HIDDEN_ARG = \"--hidden\";/.test(main));\ncheck(\"only in the installed app on Windows (never from your project folder)\", /function applyStartWithWindows\\(\\) \\{\\s*if \\(process\\.platform !== \"win32\" \\|\\| !app\\.isPackaged\\) return;/.test(main));\ncheck(\"changing the switch in Settings changes it\", /if \\(appSettings\\.startWithWindows !== prevStart\\) applyStartWithWindows\\(\\);/.test(main));\ncheck(\"started by Windows: no window until it's opened\", /let startHidden = process\\.argv\\.includes\\(START_HIDDEN_ARG\\)/.test(main) && /show: !startHidden, \\/\\/ started by Windows/.test(main) && /mainWin\\.once\\(\"ready-to-show\", \\(\\) => \\{ if \\(!startHidden\\) mainWin\\.show\\(\\); \\}\\)/.test(main));\ncheck(\"and no AURA Bar either\", /show: !startHidden, \\/\\/ the AURA Bar/.test(main));\ncheck(\"the window mode (maximized etc.) is applied when it's first opened\", /if \\(!startHidden\\) applyWindowMode\\(appSettings\\.windowMode\\)/.test(main) && /if \\(startHidden\\) \\{ startHidden = false; applyWindowMode\\(appSettings\\.windowMode\\); \\}/.test(main));\n\nconsole.log(\"5. The settings\");\nconst defaults = (main.match(/const appSettings = \\{[\\s\\S]*?\\n\\};/) || [\"\"])[0];\ncheck(\"\\\"Keep AURA running\\\" starts on and \\\"Start with Windows\\\" starts off\", /keepRunning: true,/.test(defaults) && /startWithWindows: false,/.test(defaults), defaults);\ncheck(\"Settings can change both\", /appSettings\\.keepRunning = appSettings\\.keepRunning !== false;/.test(main) && /appSettings\\.startWithWindows = appSettings\\.startWithWindows === true;/.test(main));\n\nconsole.log(\"6. Calls while AURA is hidden\");\nif (!social) console.log(\"  note  electron/social.js isn't here, so this wasn't checked\");\nelse {\n  const ring = (social.match(/async function ring\\(call\\) \\{[\\s\\S]*?\\n  \\}/) || [\"\"])[0];\n  check(\"a call rings with a Windows notification whenever AURA's window isn't in front (hidden counts)\", /if \\(win\\.isFocused\\(\\) && win\\.isVisible\\(\\) && !win\\.isMinimized\\(\\)\\) return;/.test(ring) && /new Notification\\(/.test(ring), ring.slice(0, 160));\n  check(\"clicking the notification opens AURA\", /n\\.on\\(\"click\"[\\s\\S]{0,200}\\.show\\(\\)/.test(ring));\n}\n\nconsole.log(failed ? `\\n${failed} FAILED` : \"\\nall passed\");\nprocess.exit(failed ? 1 : 0);\n","settings":"// Settings > Calls and messages: \"Keep AURA running when closed\" and \"Start AURA when Windows\n// starts\". Opens the built window (dist) in a real browser with a pretend desktop side and checks\n// the two switches, what they start as, and that each change is passed to the desktop side.\n// Added by aura-tray-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\n\n(async () => {\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(process.env.CI ? 1 : 3); }\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch(options); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with. Run  npx playwright install chromium  once to add one.\"); return done(process.env.CI ? 1 : 3); }\n\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(DIST, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => {\n      if (err) { res.writeHead(404); return res.end(); }\n      res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" });\n      res.end(data);\n    });\n  });\n  await new Promise((r) => server.listen(0, \"127.0.0.1\", r));\n  const base = \"http://127.0.0.1:\" + server.address().port;\n\n  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();\n  const thrown = [];\n  page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n  await page.route((url) => !String(url).startsWith(base), (route) => route.abort());\n  await page.addInitScript(() => {\n    try {\n      if (!sessionStorage.getItem(\"__started\")) {\n        sessionStorage.setItem(\"__started\", \"1\");\n        localStorage.clear();\n        localStorage.setItem(\"aura_profile\", JSON.stringify({ username: \"tester\", avatar: \"\", userId: \"user-1\" }));\n      }\n    } catch {}\n    window.__synced = [];\n    const ok = (data) => Promise.resolve({ success: true, data });\n    const account = { getSession: () => ok({ id: \"user-1\", email: \"me@example.com\" }), getMyProfile: () => ok({ username: \"tester\", avatar_url: null }) };\n    const fake = (name) => new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => (name === \"auraCloud\" && account[key]) ? account[key](...args) : ok(null)) });\n    window.auraCloud = fake(\"auraCloud\");\n    window.auraSocial = fake(\"auraSocial\");\n    window.electronAPI = new Proxy({}, {\n      get: (_t, key) => {\n        if (key === \"isElectron\") return true;\n        if (typeof key !== \"string\" || key === \"then\") return undefined;\n        if (/^on[A-Z]/.test(key)) return () => () => {};\n        if (/^remove/.test(key)) return () => {};\n        if (key === \"settingsSync\") return (patch) => { window.__synced.push(patch); return Promise.resolve(patch); };\n        return () => Promise.resolve({ success: false });\n      },\n    });\n  });\n  const open = async () => {\n    await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n    await page.waitForTimeout(4500);\n    await page.locator('.gm-rail-item[title=\"Settings\"], .sb-item[title=\"Settings\"]').first().click({ timeout: 5000 });\n    await page.waitForTimeout(900);\n  };\n  const look = () => page.evaluate(() => {\n    const title = [...document.querySelectorAll(\".ss-t\")].find((t) => t.textContent.trim() === \"CALLS AND MESSAGES\");\n    const rows = title ? [...title.parentElement.querySelectorAll(\".sr\")] : [];\n    const row = (label) => rows.find((r) => r.querySelector(\".sr-l\")?.textContent.trim() === label);\n    const sw = (label) => { const r = row(label); const t = r?.querySelector(\".tog\"); return r && t ? { on: t.classList.contains(\"on\"), says: r.querySelector(\".sr-s\")?.textContent.trim() || \"\" } : null; };\n    let saved = {};\n    try { saved = JSON.parse(localStorage.getItem(\"aura_settings\") || \"{}\"); } catch {}\n    return { section: !!title, keep: sw(\"Keep AURA Running When Closed\"), start: sw(\"Start AURA When Windows Starts\"), synced: window.__synced, saved: { keepRunning: saved.keepRunning, startWithWindows: saved.startWithWindows } };\n  });\n  const flip = async (label) => {\n    const t = page.locator(\".sr\", { has: page.locator(\".sr-l\", { hasText: label }) }).locator(\".tog\");\n    await t.scrollIntoViewIfNeeded({ timeout: 4000 });\n    await t.click({ timeout: 4000 });\n    await page.waitForTimeout(300);\n  };\n\n  try {\n    console.log(\"1. The switches\");\n    await open();\n    let s = await look();\n    check(\"Settings has a Calls and messages section\", s.section, s);\n    check(\"\\\"Keep AURA Running When Closed\\\" is there and starts on\", !!s.keep && s.keep.on, s.keep);\n    check(\"it says why (calls and messages still reach you) and how to quit\", !!s.keep && /calls and messages still reach you/.test(s.keep.says) && /right-click the AURA icon/.test(s.keep.says), s.keep && s.keep.says);\n    check(\"\\\"Start AURA When Windows Starts\\\" is there and starts off\", !!s.start && !s.start.on, s.start);\n    check(\"opening Settings tells the desktop side the current choices (as it does for the other settings)\", s.synced.length > 0 && s.synced.every((p) => p.keepRunning !== false && p.startWithWindows !== true) && s.synced.some((p) => p.keepRunning === true && p.startWithWindows === false), s.synced);\n\n    console.log(\"2. Changing them\");\n    await flip(\"Keep AURA Running When Closed\");\n    s = await look();\n    check(\"turning \\\"Keep running\\\" off tells the desktop side\", !s.keep.on && s.synced.some((p) => p.keepRunning === false), s.synced);\n    await flip(\"Start AURA When Windows Starts\");\n    s = await look();\n    check(\"turning \\\"Start with Windows\\\" on tells the desktop side\", s.start.on && s.synced.some((p) => p.startWithWindows === true), s.synced);\n    check(\"both are remembered\", s.saved.keepRunning === false && s.saved.startWithWindows === true, s.saved);\n    await open();\n    s = await look();\n    check(\"and still set after AURA restarts\", !s.keep.on && s.start.on, [s.keep, s.start]);\n    await flip(\"Keep AURA Running When Closed\");\n    await flip(\"Start AURA When Windows Starts\");\n    s = await look();\n    check(\"turning them back tells the desktop side too\", s.keep.on && !s.start.on && s.synced.some((p) => p.keepRunning === true) && s.synced.some((p) => p.startWithWindows === false), s.synced);\n    check(\"nothing crashed along the way\", (await page.locator(\".aura-fallback\").count()) === 0 && thrown.length === 0, thrown);\n  } finally {\n    await browser.close();\n    server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The Settings check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-tray.bak";
const MARK = "Added by aura-tray-setup.cjs";
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "release", ".git", ".vite", "coverage"]);
const CREATED = ["tray-rules.cjs", "tray-settings.cjs"];
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
  main: ['ipcMain.handle("install-update", () => autoUpdater.quitAndInstall(false, true));', 'mainWin.once("ready-to-show", () => mainWin.show());'],
};
const REQUIRED = {
  main: ["// ── Running in the tray ──", "keepRunning: true,", "show: !startHidden, // started by Windows", "show: !startHidden, // the AURA Bar", "hideToTray();\n  });", "  createTray();", "if (appSettings.startWithWindows !== prevStart) applyStartWithWindows();", "appSettings.keepRunning = appSettings.keepRunning !== false;", 'mainWin.on("show", onMainShown);', "const prevStart = appSettings.startWithWindows;"],
  app: ["keepRunning: true,", '"keepRunning","startWithWindows"];', "CALLS AND MESSAGES"],
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
    main: { file: path.join(ROOT, "electron", "main.js"), name: "desktop", js: true },
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
  if (hasChecks) {
    created.push({ label: "checks", file: path.join(ROOT, "tests", "tray-rules.cjs"), content: FILES.rules });
    created.push({ label: "checks", file: path.join(ROOT, "tests", "tray-settings.cjs"), content: FILES.settings });
  }
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: keeps running in the tray");
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
  say("  " + (hasChecks ? "2" : "1") + ". Start AURA and close it with the X. It should disappear, with an AURA icon by");
  say("     the clock (it may be under the ^ arrow). Have a friend call you: it should ring.");
  say("     Right-click the icon and choose Quit AURA to quit.");
  say();
  say("To undo later:  node aura-tray-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
