process.on('uncaughtException', (e) => {
  console.error('CRASH:', e.message, e.stack);
});

const path = require("path");
const fs   = require("fs");
const { app, BrowserWindow, ipcMain, shell, dialog, globalShortcut } = require("electron");
// Notes errors in a log file on this PC (see errorlog.js). Nothing is sent anywhere.
require("./errorlog").register(require("electron"));
// Safety rules for windows, links, permissions, games and clip files (see security.js)
const security = require("./security");
const isAppPage = (url) => security.isAppUrl(url, { appPath: app.getAppPath(), dev: !app.isPackaged });
const safeOpenExternal = security.makeOpenExternal({ shell, getClipFolder: () => getClipFolder() });
// AURA's own pages, in AURA's own windows (not embedded sites or frames inside them)
function isTrustedPage(wc, details = {}) {
  try {
    if (!wc || (wc.isDestroyed && wc.isDestroyed()) || wc.getType() !== "window") return false;
    if (details.isMainFrame === false) return false;
    return isAppPage(details.requestingUrl || wc.getURL());
  } catch { return false; }
}
const permissions = security.makePermissions({ dialog, BrowserWindow, isTrusted: isTrustedPage, getMainWindow: () => mainWin });
app.on("session-created", (ses) => permissions.lock(ses));
// Games you picked or imported on this PC (the window can't add to this list)
const approvedGames = security.makeGames({ file: path.join(app.getPath("userData"), "approved-games.json"), dialog, getMainWindow: () => mainWin });
// Only allow one copy of AURA at a time (a second launch just focuses the first)
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on("second-instance", () => {
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
  }
});

const perf = require("./perf");
perf.register();
// Social page: keep Instagram/X/Facebook inside AURA, open other links in the browser
const SOCIAL_HOSTS = ["instagram.com", "x.com", "twitter.com", "facebook.com", "messenger.com",
  "fbcdn.net", "cdninstagram.com", "accounts.google.com", "appleid.apple.com"];
const isSocialHost = (url) => {
  try {
    const h = new URL(url).hostname;
    return SOCIAL_HOSTS.some((d) => h === d || h.endsWith("." + d));
  } catch { return false; }
};
// Every window and embedded page: where it may go, and what opens outside AURA
app.on("web-contents-created", (_e, contents) => {
  // The installed AURA has no developer tools: if anything opens them, they close (Added by aura-no-devtools-setup.cjs)
  if (app.isPackaged) contents.on("devtools-opened", () => { try { contents.closeDevTools(); } catch {} });
  const type = contents.getType();
  const outside = (url) => { if (/^(https?|mailto):/i.test(String(url))) safeOpenExternal(url); };
  if (type === "webview") {
    // The Browser tab can go anywhere on the web; the social tabs stay on their own sites
    const isBrowserTab = contents.session === require("electron").session.fromPartition("persist:social-browser");
    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (isBrowserTab && /^https?:\/\//i.test(url)) {
        // A link that opens a new tab or window opens as a new tab in AURA's Browser
        const host = contents.hostWebContents;
        if (host && !host.isDestroyed()) host.send("browser-open-tab", { url, background: disposition === "background-tab" });
        else contents.loadURL(url);
      } else if (isSocialHost(url)) contents.loadURL(url);
      else outside(url);
      return { action: "deny" };
    });
    // Ctrl+T, Ctrl+W, Ctrl+Tab and Ctrl+Shift+Tab pressed inside a Browser page work on AURA's tabs
    if (isBrowserTab) contents.on("before-input-event", (e, input) => {
      if (input.type !== "keyDown" || !(input.control || input.meta) || input.alt) return;
      const key = String(input.key || "").toLowerCase();
      const what = key === "t" ? "new" : key === "w" ? "close" : key === "tab" ? (input.shift ? "previous" : "next") : null;
      if (!what) return;
      e.preventDefault();
      const host = contents.hostWebContents;
      if (host && !host.isDestroyed()) host.send("browser-tab-key", what);
    });
    contents.on("will-navigate", (e, url) => {
      if (isBrowserTab ? !/^(https?:|about:blank)/i.test(url) : !isSocialHost(url)) { e.preventDefault(); outside(url); }
    });
    return;
  }
  if (type === "window") {
    // AURA's own windows only ever show AURA's own pages
    const stay = (e, url) => { if (!isAppPage(url)) { e.preventDefault(); outside(url); } };
    contents.on("will-navigate", stay);
    contents.on("will-redirect", stay);
    contents.setWindowOpenHandler(({ url }) => { outside(url); return { action: "deny" }; });
    // Embedded pages never get Node, a preload or AURA's bridges
    contents.on("will-attach-webview", (e, webPreferences, params) => {
      if (!security.hardenWebview(webPreferences, params)) e.preventDefault();
    });
    return;
  }
  // Twitch player and chat: stay on Twitch; anything else opens in your browser
  const onTwitch = (url) => { try { const h = new URL(url).hostname; return h === "twitch.tv" || h.endsWith(".twitch.tv"); } catch { return false; } };
  contents.on("will-navigate", (e, url) => { if (!onTwitch(url)) { e.preventDefault(); outside(url); } });
  contents.setWindowOpenHandler(({ url }) => { outside(url); return { action: "deny" }; });
});
// .env is only read while developing. Real keys live on the AURA server, never in the app.
if (!app.isPackaged) {
  const devEnv = path.join(__dirname, "../.env");
  if (fs.existsSync(devEnv)) require("dotenv").config({ path: devEnv });
}


const { autoUpdater } = require("electron-updater");
const http = require("http");
const vdf = require("@node-steam/vdf");
const axios = require("axios");
const DiscordRPC = require("discord-rpc");
const Registry = require("winreg");
const { spawn } = require("child_process");
// Load the clip editor, but never let it stop AURA from starting
let registerClipEditor = () => {};
let openClipEditor = () => dialog.showErrorBox("Clip editor unavailable", "The clip editor couldn't load in this build of AURA.");
try {
  ({ registerClipEditor, openClipEditor } = require("./clip-editor/main/clip-editor"));
} catch (e) {
  console.error("Clip editor unavailable:", e.message);
}

// ── App settings the main process needs (window, zoom, recording) ─────────────
// The Settings page keeps these in sync through the "settings-sync" IPC call.
const appSettings = {
  windowMode: "maximized",   // "maximized" | "fullscreen" | "windowed"
  zoom: 1,                   // UI scale, 0.8 – 1.3
  micDevice: null,
  systemDevice: null,
  micVolume: 1,              // 0 – 2
  systemVolume: 1,           // 0 – 2
  keepRunning: true,         // closing the window keeps AURA in the tray (Added by aura-tray-setup.cjs)
  startWithWindows: false,   // open AURA in the tray when you sign in to Windows
  trayTipShown: false,
  trackAllGames: true,       // sessions for library games started outside AURA too (Added by aura-sessions-setup.cjs)
  keyF9: false,              // F9 also starts/stops recording (off: games keep F9) (Added by aura-release-fixes-setup.cjs)
  keyF10: false,             // F10 also shows the AURA Bar (off: games keep F10)
  clipFolder: null,          // the clip folder you picked (null: Videos\\AURA, or where clips already are)
  messageSound: "aura",       // the message sound picked in Settings ("windows" = Windows' own; Added by aura-ringtones-setup.cjs)       // the "AURA is still running" tip has been shown once
};
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
function loadAppSettings() {
  try { Object.assign(appSettings, JSON.parse(fs.readFileSync(settingsFile(), "utf8"))); } catch {}
}
function saveAppSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(appSettings, null, 2)); } catch (e) { console.error("Settings save failed:", e.message); }
}
// F11: full screen on or off, remembered like the switch in Settings (Added by aura-look-setup.cjs)
let modeBeforeFull = "maximized";
function toggleFullScreenMode() {
  if (!mainWin || mainWin.isDestroyed()) return;
  const full = appSettings.windowMode === "fullscreen";
  if (!full) modeBeforeFull = appSettings.windowMode === "windowed" ? "windowed" : "maximized";
  appSettings.windowMode = full ? modeBeforeFull : "fullscreen";
  saveAppSettings();
  applyWindowMode(appSettings.windowMode);
  mainWin.webContents.send("window-mode-changed", appSettings.windowMode);
}
function applyWindowMode(mode) {
  if (!mainWin) return;
  if (mode === "fullscreen") {
    mainWin.setFullScreen(true);
    return;
  }
  if (mainWin.isFullScreen()) mainWin.setFullScreen(false);
  if (mode === "windowed") {
    mainWin.unmaximize();
    mainWin.setSize(1280, 800);
    mainWin.center();
  } else {
    mainWin.maximize();
  }
}
// BrowserView bounds are in window pixels; the page measures in CSS pixels,
// which differ once the UI is zoomed.
function zoomBounds(b) {
  if (!b) return b;
  const z = mainWin?.webContents.getZoomFactor() || 1;
  return { x: Math.round(b.x * z), y: Math.round(b.y * z), width: Math.round(b.width * z), height: Math.round(b.height * z) };
}

// ── Recording state ───────────────────────────────────────────────────────────
let ffmpegPath = null;
let recordingProcess = null;
let isRecording = false;
let recordingGame = null;
let recordingStartTime = null;
let recordingOutFile = null;
let clipFolder = null;

try {
  // Try bundled full ffmpeg first (supports WASAPI)
  const bundledPath = app.isPackaged
    ? path.join(process.resourcesPath, "ffmpeg.exe")
    : path.join(__dirname, "../../resources/ffmpeg.exe");

  if (fs.existsSync(bundledPath)) {
    ffmpegPath = bundledPath;
    console.log("ffmpeg path (bundled):", ffmpegPath);
  } else {
    const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
    ffmpegPath = ffmpegInstaller.path;
    if (ffmpegPath && app.isPackaged) {
      ffmpegPath = ffmpegPath.replace("app.asar", "app.asar.unpacked");
    }
    console.log("ffmpeg path (installer):", ffmpegPath);
  }
} catch {
  console.log("ffmpeg not found — recording disabled");
}

function getClipFolder() {
  if (clipFolder) return clipFolder;
  // The folder you picked is remembered. Otherwise Videos\AURA, unless your clips are already
  // in the old place (AURA's data folder), which then stays in use. (Added by aura-release-fixes-setup.cjs)
  if (appSettings.clipFolder && path.isAbsolute(appSettings.clipFolder)) return appSettings.clipFolder;
  const old = path.join(app.getPath("userData"), "Clips");
  try { if (fs.existsSync(old) && fs.readdirSync(old).length) return old; } catch {}
  try { return path.join(app.getPath("videos"), "AURA"); } catch { return old; }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getAutoResolution() {
  const { screen } = require("electron");
  const display = screen.getPrimaryDisplay();
  return { width: display.size.width, height: display.size.height };
}



// ── AURA server ───────────────────────────────────────────────────────────────
// The secret keys (Twitch/IGDB, Steam, YouTube, Discord) live on the AURA server, not in
// this app. AURA asks the server, and the server checks the AURA login before answering.
const AURA_SERVER_URL = "https://cvyppf02p0.c36.airoapp.ai";
// Discord's client ID is public (it's part of the login link), so it can stay in the app
const DISCORD_CLIENT_ID     = process.env.DISCORD_CLIENT_ID || "1490124739669266664";
const DISCORD_REDIRECT_URI  = "http://localhost:3000/callback";

// Ask the AURA server for something. Answers { success, ... } like the old handlers did.
async function auraServer(route, body = {}) {
  let token = null;
  try { token = await auraCloud.getAccessToken(); }
  catch (e) { return { success: false, error: "AURA couldn't read your login on this PC (" + (e?.message || "unknown problem") + ")." }; }
  if (!token) return { success: false, error: "AURA couldn't find your login on this PC. Log out and log back in." };
  try {
    const res = await axios.post(AURA_SERVER_URL + route, body, {
      // Sent twice: some hosts drop the standard Authorization header before the server sees it
      headers: { Authorization: `Bearer ${token}`, "X-Aura-Token": token },
      timeout: 30000,
      validateStatus: () => true,
    });
    if (res.data && typeof res.data === "object" && typeof res.data.success === "boolean") return res.data;
    return { success: false, error: `The AURA server answered with an error (${res.status}).` };
  } catch {
    return { success: false, error: "Couldn't reach the AURA server. Check your internet connection." };
  }
}

let discordToken  = null;
let authServer    = null;
let mainWin       = null;
// Sound devices: Settings > Sound devices, Ctrl+Alt+S, the AURA bar button (Added by aura-sound-devices-setup.cjs)
const soundDevices = require("./sounddevices").create({ app, ipcMain, globalShortcut, getWindow: () => mainWin, onChange: () => pushBarState(), openExternal: (u) => shell.openExternal(u) });
// Voice commands: "Hey AURA, next song", off unless switched on in Settings (Added by aura-voice-setup.cjs)
require("./voice").create({ app, ipcMain, getWindow: () => mainWin, onRecord: (want) => { if ((want === "start") !== isRecording) toggleRecordingHotkey(); }, onBar: () => toggleBar() });

// ── Running in the tray ───────────────────────────────────────────────────────
// Added by aura-tray-setup.cjs.
// Closing AURA's window hides it instead of quitting, so calls and messages still reach you
// (Settings > "Keep AURA running when closed" turns this off). An AURA icon by the clock opens
// it again or quits it. "Start AURA when Windows starts" opens it straight into the tray.
// AURA really quits when you choose Quit AURA, press Restart now for an update, when Windows
// shuts down, or when an update has downloaded (closing it then installs the update).
const START_HIDDEN_ARG = "--hidden";
let tray = null;
let quitting = false;
let updateReady = false;
let startHidden = process.argv.includes(START_HIDDEN_ARG); // started by Windows at sign-in
let barWasVisible = true; // the AURA Bar comes back with the window if it was showing when AURA was closed
app.on("before-quit", () => { quitting = true; });
autoUpdater.on("update-downloaded", () => { updateReady = true; });
function showMain() {
  if (!mainWin || mainWin.isDestroyed()) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}
// Whenever the window comes back (tray icon, a notification, opening AURA again)
function onMainShown() {
  if (startHidden) { startHidden = false; applyWindowMode(appSettings.windowMode); }
  if (barWasVisible && auraBar && !auraBar.isDestroyed() && !auraBar.isVisible()) auraBar.showInactive();
}
function hideToTray() {
  barWasVisible = !!auraBar && !auraBar.isDestroyed() && auraBar.isVisible();
  if (barWasVisible) auraBar.hide();
  mainWin.hide();
  if (appSettings.trayTipShown) return;
  // The first time only: say where AURA went
  appSettings.trayTipShown = true;
  saveAppSettings();
  try {
    const { Notification } = require("electron");
    if (!Notification.isSupported()) return;
    const tip = new Notification({ title: "AURA is still running", body: "Calls and messages will still reach you. To quit, right-click the AURA icon by the clock and choose Quit AURA." });
    tip.on("click", showMain);
    tip.show();
  } catch {}
}
function createTray() {
  if (tray) return;
  const { Tray, Menu, nativeImage } = require("electron");
  let image = nativeImage.createFromPath(path.join(__dirname, app.isPackaged ? "../dist/icon.png" : "../public/icon.png"));
  if (image.isEmpty()) image = nativeImage.createFromPath(path.join(__dirname, "../public/icon.png"));
  if (!image.isEmpty()) image = image.resize({ width: 32, height: 32, quality: "best" });
  try { tray = new Tray(image); } catch (e) { console.error("Tray icon unavailable:", e.message); tray = null; return; }
  tray.setToolTip("AURA");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open AURA", click: showMain },
    { type: "separator" },
    { label: "Quit AURA", click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on("click", showMain);
}
function applyStartWithWindows() {
  if (process.platform !== "win32" || !app.isPackaged) return;
  try { app.setLoginItemSettings({ openAtLogin: appSettings.startWithWindows === true, args: [START_HIDDEN_ARG] }); }
  catch (e) { console.error("Start with Windows:", e.message); }
}

// ── Auto-updater ──────────────────────────────────────────────────────────────
autoUpdater.autoDownload         = false;
autoUpdater.autoInstallOnAppQuit = true;

// ── Find Steam install path from registry ─────────────────────────────────────
function getSteamPath() {
  return new Promise((resolve) => {
    try {
      const reg = new Registry({
        hive: Registry.HKCU,
        key:  "\\Software\\Valve\\Steam",
      });
      reg.get("SteamPath", (err, item) => {
        if (err || !item) {
          // fallback to default
          resolve("C:\\Program Files (x86)\\Steam");
        } else {
          resolve(item.value.replace(/\//g, "\\"));
        }
      });
    } catch {
      resolve("C:\\Program Files (x86)\\Steam");
    }
  });
}

// ── Create Main Window ────────────────────────────────────────────────────────
function createWindow() {
  mainWin = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: !startHidden, // started by Windows at sign-in: stay in the tray until opened
    backgroundColor: "#222831",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !app.isPackaged, // developer tools only while developing (Added by aura-no-devtools-setup.cjs)
      webviewTag: true,
      webSecurity: true,
      enableBlinkFeatures: "GetDisplayMedia",
      autoplayPolicy: "no-user-gesture-required", // lets recording audio start without a fresh click
      backgroundThrottling: false, // keep recording smoothly while AURA is minimized behind a game
      sandbox: true,
    },
  });
  if (!startHidden) applyWindowMode(appSettings.windowMode); // started hidden: done when it's first shown
  mainWin.once("ready-to-show", () => { if (!startHidden) mainWin.show(); });
  mainWin.on("show", onMainShown);
  mainWin.webContents.on("did-finish-load", () => {
    mainWin?.webContents.setZoomFactor(appSettings.zoom || 1);
  });
  // F11 toggles fullscreen, so there's always a way out of fullscreen mode
  mainWin.webContents.on("before-input-event", (_e, input) => {
    if (input.type === "keyDown" && input.key === "F11") mainWin.setFullScreen(!mainWin.isFullScreen());
  });

  // Closing the window hides AURA in the tray (see "Running in the tray"). It really closes when
  // AURA is quitting, when an update is waiting to install, or when "Keep AURA running" is off.
  mainWin.on("close", (event) => {
    if (quitting || updateReady || appSettings.keepRunning === false || !tray) return;
    event.preventDefault();
    hideToTray();
  });
  // Windows is shutting down, restarting or signing out: let AURA close
  mainWin.on("query-session-end", () => { quitting = true; });
  mainWin.on("session-end", () => { quitting = true; });
  // Closing AURA also closes the AURA Bar and fully quits the app
  mainWin.on("closed", () => {
    mainWin = null;
    if (auraBar && !auraBar.isDestroyed()) auraBar.destroy();
    auraBar = null;
    app.quit();
  });
  // AURA's own pages may use the microphone and capture the screen; websites inside AURA
  // ask you first and never get the rest (see security.js)
  permissions.lock(mainWin.webContents.session);
  // No menu bar (File, Edit, View...): it offered developer tools and reloading the page (Added by aura-no-devtools-setup.cjs)
  mainWin.setMenu(null);
  if (!app.isPackaged) {
    // While developing: F12 or Ctrl+Shift+I opens the developer tools
    mainWin.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      if (input.key === "F12" || (input.control && input.shift && String(input.key).toLowerCase() === "i")) { event.preventDefault(); mainWin.webContents.toggleDevTools(); }
    });
  }

  mainWin.webContents.on("enter-html-full-screen", () => {
    mainWin.setFullScreen(true);
  });
  mainWin.webContents.on("leave-html-full-screen", () => {
    applyWindowMode(appSettings.windowMode); // back to how you set AURA: full screen stays full screen
  });
  mainWin.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.key !== "F11" || input.isAutoRepeat || input.control || input.alt || input.meta || input.shift) return;
    event.preventDefault();
    toggleFullScreenMode();
  });
  // A crashed window loads again (at most once a minute) instead of staying blank (Added by aura-release-fixes-setup.cjs)
  let lastReload = 0;
  mainWin.webContents.on("render-process-gone", (_e, d) => {
    if (!d || d.reason === "clean-exit" || mainWin.isDestroyed() || Date.now() - lastReload < 60000) return;
    lastReload = Date.now();
    setTimeout(() => { try { if (!mainWin.isDestroyed()) mainWin.reload(); } catch {} }, 1000);
  });
  // The window is told when it's hidden, so it can rest while you play
  const tellShown = (shown) => { try { if (!mainWin.isDestroyed()) mainWin.webContents.send("window-shown", shown); } catch {} };
  mainWin.on("hide", () => tellShown(false));
  mainWin.on("minimize", () => tellShown(false));
  mainWin.on("show", () => tellShown(true));
  mainWin.on("restore", () => tellShown(true));
  mainWin.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    // Only AURA's own pages may capture the screen
    if (!request.frame || request.frame.parent || !isAppPage(request.frame.url)) return callback({});
    const { desktopCapturer } = require("electron");
    desktopCapturer.getSources({ types: ["screen", "window"] }).then(sources => {
      const sourceId = global.pendingCaptureSource;
      const source = sourceId
        ? sources.find(s => s.id === sourceId) || sources[0]
        : sources[0];
      // Pass video source and enable loopback audio
      callback({ video: source, audio: "loopback" });
    });
  }, { useSystemPicker: false });

  const isDev = !app.isPackaged;
  if (isDev) {
    mainWin.loadURL("http://localhost:5173");
  } else {
    mainWin.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  setupAutoUpdater(mainWin);

  // Discord RPC — connect after window is ready, don't crash if Discord closed
  setTimeout(() => {
    rpc.login({ clientId: DISCORD_CLIENT_ID }).catch(e =>
      console.log("Discord RPC unavailable:", e.message)
    );
  }, 3000);

  return mainWin;
}

// ── Auto-updater ──────────────────────────────────────────────────────────────
function setupAutoUpdater(win) {
  if (!app.isPackaged) return;
  autoUpdater.checkForUpdates();
  autoUpdater.on("update-available",  (info) => win.webContents.send("update-available", info.version));
  autoUpdater.on("download-progress", (p)    => win.webContents.send("update-progress", p.percent));
  autoUpdater.on("update-downloaded", ()     => win.webContents.send("update-ready"));
  autoUpdater.on("error", (e) => console.error("Updater:", e.message));
}

// Allow desktopCapturer getUserMedia in renderer
app.commandLine.appendSwitch("enable-usermedia-screen-capturing");
app.commandLine.appendSwitch("allow-http-screen-capture");

// ── App lifecycle ─────────────────────────────────────────────────────────────
let auraBar = null;
const BAR_WIDTH = 700; // (room for the sound button: Added by aura-sound-devices-setup.cjs)
const BAR_HEIGHT = 60;           // bar only
const BAR_HEIGHT_EXPANDED = 160; // bar + performance panel
const RECORD_HOTKEY = "Alt+Shift+R";
const BAR_HOTKEY = "Alt+Shift+B"; // shows/hides the AURA Bar (F10 only if you switch it on) (Added by aura-release-fixes-setup.cjs)
let currentGameName = null;

function barState() {
  return {
    recording: isRecording,
    recStartedAt: isRecording ? recordingStartTime : null,
    game: currentGameName,
    hotkey: "Alt+Shift+R",
    barHotkey: appSettings.keyF10 ? "F10" : BAR_HOTKEY, // (Added by aura-release-fixes-setup.cjs)
    sound: soundDevices.barInfo(), // the Quick Switch button (Added by aura-sound-devices-setup.cjs)
  };
}

function pushBarState() {
  if (auraBar && !auraBar.isDestroyed()) auraBar.webContents.send("bar-state", barState());
}

function toggleRecordingHotkey() {
  // An FFmpeg screen-grab recording is running (older method): stop it
  if (recordingProcess) {
    stopRecording();
    mainWin?.webContents.send("recording-hotkey", "stop");
    pushBarState();
    return;
  }
  // Quick recording happens in the AURA window, which captures the screen together
  // with whatever you hear (any headset or speakers), unlike "Stereo Mix".
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send("quick-record-toggle", { game: currentGameName || recordingGame || "General" });
    return;
  }
  startRecording(currentGameName || recordingGame || "General");
  pushBarState();
}

// The AURA window reports when a quick recording starts or stops
ipcMain.handle("quick-record-state", (_e, { recording, game }) => {
  isRecording = !!recording;
  if (recording) {
    recordingGame = game || "General";
    recordingStartTime = Date.now();
    mainWin?.webContents.send("recording-started", { game: recordingGame });
  } else {
    recordingStartTime = null;
    mainWin?.webContents.send("recording-stopped", { saving: true });
  }
  pushBarState();
  return { success: true };
});


// ── AURA accounts (sign up, log in, profiles). The work happens in supabase.js ─
const auraCloud = require("./supabase");
// Every account call answers { success: true, data } or { success: false, error }
const cloudHandler = (fn) => async (_e, ...args) => {
  try {
    return { success: true, data: (await fn(...args)) ?? null };
  } catch (e) {
    return { success: false, error: e?.message || "Something went wrong" };
  }
};
ipcMain.handle("auth:signUp", cloudHandler(auraCloud.signUp));
ipcMain.handle("auth:logIn", cloudHandler(auraCloud.logIn));
ipcMain.handle("auth:logOut", cloudHandler(auraCloud.logOut));
ipcMain.handle("auth:deleteAccount", cloudHandler((password) => require("./account").deleteAccount(auraCloud, password))); // (Added by aura-account-delete-setup.cjs)
ipcMain.handle("auth:getSession", cloudHandler(auraCloud.getSession));
ipcMain.handle("auth:resendConfirmation", cloudHandler(auraCloud.resendConfirmation));
// Forgot password (Added by aura-reset-password-setup.cjs)
ipcMain.handle("auth:sendResetCode", cloudHandler(auraCloud.sendResetCode));
ipcMain.handle("auth:resetPasswordWithCode", cloudHandler(auraCloud.resetPasswordWithCode));
ipcMain.handle("profile:getMine", cloudHandler(auraCloud.getMyProfile));
ipcMain.handle("profile:save", cloudHandler(auraCloud.saveProfile));
ipcMain.handle("profile:get", cloudHandler(auraCloud.getProfile));
// The media player: Clips > Media (Added by aura-media-player-setup.cjs)
require("./media").create({ app, ipcMain, dialog, getWindow: () => mainWin });
// Release check: GitHub starts the freshly installed AURA with --aura-smoke-test. AURA opens as usual,
// waits 25 seconds, checks its window shows something and nothing went into the error log, writes the
// result to smoke-test.txt in its data folder, and closes. (Added by aura-release-process-setup.cjs)
if (process.argv.includes("--aura-smoke-test")) {
  const result = path.join(app.getPath("userData"), "smoke-test.txt");
  try { fs.unlinkSync(result); } catch {}
  const finish = (ok, why) => {
    try { fs.mkdirSync(path.dirname(result), { recursive: true }); fs.writeFileSync(result, (ok ? "OK: " : "FAILED: ") + why + "\n"); } catch {}
    app.exit(ok ? 0 : 1);
  };
  app.whenReady().then(() => setTimeout(async () => {
    try {
      let log = "";
      try { log = fs.readFileSync(path.join(app.getPath("userData"), "logs", "aura-errors.log"), "utf8"); } catch {}
      const errors = (log.match(/^\[\d{4}-\d\d-\d\d /gm) || []).length;
      if (!mainWin || mainWin.isDestroyed()) return finish(false, "the window didn't open");
      const shown = await mainWin.webContents.executeJavaScript("document.body ? document.body.innerText.trim().length : 0", true);
      if (!(shown > 20)) return finish(false, "the window opened but showed nothing");
      if (errors) return finish(false, errors + " error(s) in the error log:\n" + log.slice(-3000));
      finish(true, "AURA " + app.getVersion() + " started, showed its window and logged no errors");
    } catch (e) { finish(false, "the check itself failed: " + (e && e.message)); }
  }, 25000));
}
ipcMain.handle("games:getMine", cloudHandler(auraCloud.getMyGames));
ipcMain.handle("games:saveMine", cloudHandler(auraCloud.saveMyGames));
ipcMain.handle("data:getMine", cloudHandler(auraCloud.getMyData));
ipcMain.handle("data:saveMine", cloudHandler(auraCloud.saveMyData));
ipcMain.handle("sessions:getIds", cloudHandler(auraCloud.getMySessionIds));
ipcMain.handle("sessions:get", cloudHandler(auraCloud.getMySessions));
ipcMain.handle("sessions:save", cloudHandler(auraCloud.saveMySessions));
ipcMain.handle("sessions:delete", cloudHandler(auraCloud.deleteMySessions));

// AURA friends and messages. The work happens in social.js
require("./social").register({ ipcMain, cloudHandler, cloud: auraCloud, getWindow: () => mainWin, server: (route, body) => auraServer(route, body), messageSound: () => appSettings.messageSound });



// Pick the screen the mouse is on, for hands-free recording
ipcMain.handle("get-quick-capture-source", async () => {
  const { desktopCapturer, screen } = require("electron");
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const match = sources.find((s) => s.display_id === String(display.id)) || sources[0];
  return match ? { id: match.id, name: match.name } : null;
});

ipcMain.handle("bar-get-state", () => barState());

ipcMain.handle("bar-record-toggle", () => {
  if (!isRecording && !ffmpegPath) return { success: false, error: "Recording unavailable" };
  toggleRecordingHotkey();
  return { success: true, recording: isRecording };
});

ipcMain.handle("bar-set-expanded", (_e, open) => {
  if (!auraBar || auraBar.isDestroyed()) return;
  auraBar.setResizable(true);
  auraBar.setSize(BAR_WIDTH, open ? BAR_HEIGHT_EXPANDED : BAR_HEIGHT);
  auraBar.setResizable(false);
});

ipcMain.handle("bar-screenshot", async () => {
  // Hide the bar so it isn't in the screenshot
  const wasVisible = auraBar && !auraBar.isDestroyed() && auraBar.isVisible();
  if (wasVisible) auraBar.hide();
  await new Promise((r) => setTimeout(r, 200));
  const result = await captureScreenshot();
  if (wasVisible) auraBar.showInactive();
  return result;
});

function createAuraBar() {
  if (auraBar && !auraBar.isDestroyed()) return; // already exists
  const { screen } = require("electron");
  const { width } = screen.getPrimaryDisplay().workAreaSize;

  auraBar = new BrowserWindow({
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
    x: Math.round((width - BAR_WIDTH) / 2),
    y: 16,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: !startHidden, // the AURA Bar waits for the window when AURA starts in the tray
    resizable: false,
    movable: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.NODE_ENV === "development" || !app.isPackaged) {
    auraBar.loadURL("http://localhost:5173/#aurabar");
  } else {
    auraBar.loadFile(path.join(__dirname, "../dist/index.html"), { hash: "aurabar" });
  }

  auraBar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  auraBar.setAlwaysOnTop(true, "screen-saver");
}

ipcMain.handle("aurabar-move", (_e, { x, y }) => {
  auraBar?.setPosition(Math.round(x), Math.round(y));
  return { success: true };
});

ipcMain.handle("aurabar-hide", () => { auraBar?.hide(); });
ipcMain.handle("aurabar-show", () => { auraBar?.show(); });

ipcMain.handle("aurabar-get-state", () => ({
  isRecording,
  clipServerPort: global.clipServerPort,
  clipServerToken: global.clipServerToken,
}));

// Forward recording events to bar
function notifyBar(channel, data) {
  auraBar?.webContents.send(channel, data);
}

app.whenReady().then(() => {
  require("electron").Menu.setApplicationMenu(null); // no menu bar on any of AURA's windows (Added by aura-no-devtools-setup.cjs)
  // YouTube refuses to play embedded videos ("Error 153") unless the request says which site
  // or app is embedding them. The installed app is loaded from a file, which sends nothing,
  // so fill that in here. In dev (http://localhost) the browser already sends it.
  require("electron").session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ["https://www.youtube.com/embed*", "https://www.youtube-nocookie.com/embed*"] },
    (details, callback) => {
      const headers = details.requestHeaders;
      if (!headers.Referer && !headers.referer) headers.Referer = "https://taurreantraylor.com/";
      callback({ requestHeaders: headers });
    }
  );
  // Start local HTTP server for video file serving
  const clipServerToken = require("crypto").randomBytes(32).toString("hex");
  global.clipServerToken = clipServerToken;

  const httpServer = http.createServer((req, res) => {
    try {
      // Verify secret token
      const url = new URL(req.url, "http://127.0.0.1");
      const token = url.searchParams.get("token");
      if (token !== clipServerToken) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      // Only clips and screenshots from the clip folder (see security.js)
      let asked = "";
      try { asked = decodeURIComponent(url.pathname.slice(1)); } catch {}
      if (process.platform === "win32") asked = asked.replace(/\//g, "\\");
      const filePath = security.clipPath(asked, getClipFolder());
      if (!filePath || !security.isClipFile(filePath) || !fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const fileSize = fs.statSync(filePath).size;
      const type = /\.webm$/i.test(filePath) ? "video/webm" : /\.png$/i.test(filePath) ? "image/png" : /\.jpe?g$/i.test(filePath) ? "image/jpeg" : /\.mkv$/i.test(filePath) ? "video/x-matroska" : "video/mp4";
      const range = req.headers.range;

      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
        let start = m && m[1] !== "" ? Number(m[1]) : NaN;
        let end = m && m[2] !== "" ? Number(m[2]) : fileSize - 1;
        if (m && m[1] === "" && m[2] !== "") { start = Math.max(0, fileSize - Number(m[2])); end = fileSize - 1; }
        end = Math.min(end, fileSize - 1);
        if (!m || !(start >= 0) || start > end) {
          res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
          res.end();
          return;
        }
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
          "Content-Type": type,
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": fileSize,
          "Content-Type": type,
          "Accept-Ranges": "bytes",
        });
        fs.createReadStream(filePath).pipe(res);
      }
    } catch(e) {
      res.writeHead(500);
      res.end("Error");
    }
  });

  // Pick an available port and store it
  httpServer.listen(0, "127.0.0.1", () => {
    const port = httpServer.address().port;
    global.clipServerPort = port;
    console.log("Clip server running on port:", port);
  });

  loadAppSettings();
  registerClipEditor();
  createWindow();
  createAuraBar();
  registerHotkeys();
  createTray();
  applyStartWithWindows();

  ipcMain.handle("download-update", async () => {
    // Auto-update only works in the installed app; in dev mode, open the release page
    if (!app.isPackaged) {
      shell.openExternal("https://github.com/tctray/aura-launcher/releases/latest");
      return { success: false, error: "Updates only download in the installed app", openedPage: true };
    }
    try {
      // The updater must have checked (and found the update) before it can download it
      await autoUpdater.checkForUpdates();
      await autoUpdater.downloadUpdate(); // progress is sent to the window as it downloads
      return { success: true };
    } catch (e) {
      console.error("Update download failed:", e.message);
      shell.openExternal("https://github.com/tctray/aura-launcher/releases/latest");
      return { success: false, error: e.message, openedPage: true };
    }
  });
  ipcMain.handle("install-update", () => { quitting = true; autoUpdater.quitAndInstall(false, true); });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      createAuraBar();
    }
  });
});

app.on("window-all-closed", () => {
  globalShortcut.unregisterAll();
  if (isRecording) stopRecording();
  if (process.platform !== "darwin") app.quit();
});

// ── Discord RPC ───────────────────────────────────────────────────────────────
const rpc = new DiscordRPC.Client({ transport: "ipc" });

rpc.on("ready", () => {
  console.log("Discord RPC connected");
  rpc.setActivity({
    details: "Browsing Game Library",
    state:   "AURA Game Launcher",
    largeImageKey: "aura_logo",
    startTimestamp: new Date(),
  });
});

// ── Process watching (for games that go through a launcher like EA, Steam, Epic) ─
function runQuiet(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true, ...opts });
    let out = "";
    p.stdout.on("data", (d) => { out += d.toString(); });
    p.on("close", () => resolve(out));
    p.on("error", () => resolve(""));
  });
}

// Is a process with this exact name running?
async function isNameRunning(exeName) {
  const out = await runQuiet("tasklist", ["/FI", `IMAGENAME eq ${exeName}`, "/NH"]);
  return out.toLowerCase().includes(exeName.toLowerCase());
}

// Is anything running from the game's install folder? Catches games whose real
// process has a different name than the one in the library.
async function isFolderRunning(dir) {
  // The folder goes in through an environment variable, never into the command itself
  const folder = String(dir).replace(/\\+$/, "") + "\\";
  const script =
    "(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and " +
    "$_.ExecutablePath.StartsWith($env:AURA_DIR, [StringComparison]::OrdinalIgnoreCase) }).Count";
  const out = await runQuiet("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, AURA_DIR: folder } });
  return parseInt(out.trim(), 10) > 0;
}

async function isGameRunning(exePath) {
  if (await isNameRunning(path.basename(exePath))) return true;
  return isFolderRunning(path.dirname(exePath));
}

// Waits for the game to appear (up to appearMs), then until it closes
async function waitForGameToClose(exePath, appearMs) {
  const appearDeadline = Date.now() + appearMs;
  let seen = false;
  while (true) {
    const running = await isGameRunning(exePath);
    if (running) seen = true;
    else if (seen || Date.now() > appearDeadline) return;
    await new Promise((r) => setTimeout(r, 5000));
  }
}

// ── Sessions: library games however they were started (see gamewatch.js) ─────
// Added by aura-sessions-setup.cjs. AURA's Play button, Steam, Epic, Xbox or a shortcut: each
// game in your library that runs gets a session, also games that need administrator rights.
const gameWatchKit = require("./gamewatch");
const gameWatch = gameWatchKit.createGameWatch({
  list: () => (process.platform === "win32" ? gameWatchKit.listRunning(runQuiet) : Promise.resolve([])),
  findAliases: (exePath) => (process.platform === "win32" ? gameWatchKit.listInFolder(runQuiet, path.dirname(exePath)) : Promise.resolve([])),
  listWithPaths: () => (process.platform === "win32" ? gameWatchKit.listWithLocations(runQuiet) : Promise.resolve(null)), // where programs live (see gamewatch.js)
  shouldWatchAll: () => appSettings.trackAllGames !== false,
  aliasFile: path.join(app.getPath("userData"), "game-programs.json"),
  onStart: (exePath, programName, { launched, start }) => {
    perf.beginSession(exePath, programName);
    currentGameName = titleOf(exePath);
    if (!launched) rpc.setActivity({ details: `Playing ${titleOf(exePath)}`, state: "AURA Game Launcher", largeImageKey: "aura_logo", startTimestamp: new Date(start || Date.now()) }).catch(() => {});
    pushBarState();
    soundDevices.gameStarted(); // your headset while you play, if that's switched on (Added by aura-sound-devices-setup.cjs)
    console.log("Session started: " + path.basename(exePath) + (launched ? "" : " (started outside AURA)"));
    mainWin?.webContents.send("game-session-started", { exePath, startTime: start, launched }); // the Now Playing timer
  },
  onEnd: (exePath, { start, end, launched }) => {
    const perfSummary = perf.endSession(exePath);
    if (currentGameName === titleOf(exePath) || currentGameName === path.basename(exePath, ".exe")) currentGameName = null;
    pushBarState();
    soundDevices.gameEnded();
    console.log("Session ended: " + path.basename(exePath) + " (" + Math.round((end - start) / 1000) + "s)");
    mainWin?.webContents.send("game-session-ended", { exePath, sessionMs: Math.max(0, end - start), startTime: start, endTime: end, perf: perfSummary, detected: !launched });
    rpc.setActivity({ details: "Browsing Game Library", state: "AURA Game Launcher", largeImageKey: "aura_logo", startTimestamp: new Date() }).catch(() => {});
  },
});
// The games to look for: your library (the window sends it), remembered for next time
const watchListFile = () => path.join(app.getPath("userData"), "watched-games.json");
// Each library game's name, so the AURA Bar and Discord say "Arc Raiders", not "gamelaunchhelper"
const gameTitlesFile = () => path.join(app.getPath("userData"), "watched-titles.json");
let gameTitles = {};
try { gameTitles = JSON.parse(fs.readFileSync(gameTitlesFile(), "utf8")) || {}; } catch {}
const titleKey = (p) => String(p || "").replace(/\//g, "\\").toLowerCase();
function titleOf(exePath) {
  const t = gameTitles[titleKey(exePath)];
  return typeof t === "string" && t.trim() ? t.trim().slice(0, 80) : path.basename(String(exePath || ""), ".exe");
}
try { gameWatch.setLibrary(JSON.parse(fs.readFileSync(watchListFile(), "utf8"))); } catch {}
ipcMain.handle("games:watch", (_e, list) => {
  // Each one: the program's path, or { exePath, title }
  const items = (Array.isArray(list) ? list : []).slice(0, 2000);
  const titles = {};
  for (const it of items) if (it && typeof it === "object" && typeof it.exePath === "string" && /\.exe$/i.test(it.exePath) && typeof it.title === "string" && it.title.trim()) titles[titleKey(it.exePath)] = it.title.trim().slice(0, 80);
  gameTitles = titles;
  try { fs.writeFileSync(gameTitlesFile(), JSON.stringify(titles)); } catch {}
  const paths = items.map((it) => (it && typeof it === "object" ? it.exePath : it)).filter((p) => typeof p === "string" && p.length <= 1024 && /\.exe$/i.test(p));
  gameWatch.setLibrary(paths);
  try { fs.writeFileSync(watchListFile(), JSON.stringify(paths)); } catch {}
  return { success: true, count: paths.length };
});
app.whenReady().then(() => gameWatch.start());
app.on("before-quit", () => { try { gameWatch.finishAll(); } catch {} }); // a game still running keeps the time played so far

// ── Launch Game ───────────────────────────────────────────────────────────────
// Spawns the game so AURA can see when it closes, then logs the session
// (playtime + performance summary) back to the app.
const gameSessions = new Map();

ipcMain.handle("launch-game", async (_e, exePath) => {
  try {
    // Only .exe games you picked or imported start without asking (see security.js)
    const problem = await approvedGames.check(exePath);
    if (problem) return { success: false, error: problem };
    const startTime = Date.now();
    // Game Pass games are started the way Xbox expects (see xbox.js). AURA still watches the game itself.
    const xboxStart = require("./xbox").launcherFor(exePath);
    const child = spawn(xboxStart ? xboxStart.command : exePath, xboxStart ? xboxStart.args : [], {
      cwd: xboxStart ? xboxStart.cwd : path.dirname(exePath),
      detached: true,
      stdio: "ignore",
    });

    // Wait to see if the game actually started
    const started = await new Promise((resolve) => {
      child.once("spawn", () => resolve(true));
      child.once("error", () => resolve(false));
    });

    // Fallback for games that won't start this way (no session tracking)
    if (!started) {
      console.log(`Couldn't track ${path.basename(exePath)} (may need admin), opening normally`);
      const err = await shell.openPath(exePath);
      if (err) return { success: false, error: err };
      gameWatch.launched(exePath); // still gets a session: AURA watches for the game (see gamewatch.js)
      return { success: true };
    }

    // AURA times the session from now, and watches for the game to appear and close (see gamewatch.js)
    gameWatch.launched(exePath);

    rpc.setActivity({
      details: `Playing ${titleOf(exePath)}`,
      state:   "AURA Game Launcher",
      largeImageKey: "aura_logo",
      startTimestamp: new Date(),
    }).catch(() => {});

    child.unref();
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
});

// ── File pickers ──────────────────────────────────────────────────────────────
ipcMain.handle("pick-exe", async () => {
  const r = await dialog.showOpenDialog({
    title: "Select Game Executable",
    filters: [{ name: "Executables", extensions: ["exe"] }],
    properties: ["openFile"],
  });
  if (r.canceled) return null;
  approvedGames.approve(r.filePaths[0]);
  return r.filePaths[0];
});

ipcMain.handle("pick-image", async () => {
  const r = await dialog.showOpenDialog({
    title: "Select Image",
    filters: [{ name: "Images", extensions: ["png","jpg","jpeg","webp","gif"] }],
    properties: ["openFile"],
  });
  if (r.canceled) return null;
  const data = fs.readFileSync(r.filePaths[0]);
  const ext  = path.extname(r.filePaths[0]).slice(1).toLowerCase();
  const mime = ext === "jpg" ? "jpeg" : ext;
  return `data:image/${mime};base64,${data.toString("base64")}`;
});

ipcMain.handle("open-external", async (_e, url) => safeOpenExternal(url));

// ── Clip editor window ────────────────────────────────────────────────────────
ipcMain.on("open-clip-editor", () => openClipEditor(mainWin));

// ── Settings sync from the Settings page ──────────────────────────────────────
ipcMain.handle("settings-sync", (_e, patch = {}) => {
  const prevMode = appSettings.windowMode;
  const prevZoom = appSettings.zoom;
  const prevStart = appSettings.startWithWindows;
  const prevClipFolder = appSettings.clipFolder, prevKeys = [appSettings.keyF9, appSettings.keyF10].join(); // (Added by aura-release-fixes-setup.cjs)
  for (const key of Object.keys(appSettings)) {
    if (patch[key] !== undefined) appSettings[key] = patch[key];
  }
  appSettings.zoom = Math.min(1.3, Math.max(0.8, Number(appSettings.zoom) || 1));
  appSettings.keepRunning = appSettings.keepRunning !== false;
  appSettings.startWithWindows = appSettings.startWithWindows === true;
  appSettings.trackAllGames = appSettings.trackAllGames !== false;
  appSettings.messageSound = typeof appSettings.messageSound === "string" ? appSettings.messageSound.slice(0, 20) : "aura";
  // The clip folder only changes through its folder picker; F9/F10 are on or off (Added by aura-release-fixes-setup.cjs)
  appSettings.clipFolder = prevClipFolder;
  appSettings.keyF9 = appSettings.keyF9 === true;
  appSettings.keyF10 = appSettings.keyF10 === true;
  if ([appSettings.keyF9, appSettings.keyF10].join() !== prevKeys) { applyHotkeys(); pushBarState(); }
  saveAppSettings();
  if (appSettings.windowMode !== prevMode) applyWindowMode(appSettings.windowMode);
  if (appSettings.zoom !== prevZoom) mainWin?.webContents.setZoomFactor(appSettings.zoom);
  if (appSettings.startWithWindows !== prevStart) applyStartWithWindows();
  return { ...appSettings };
});

// ── Steam import — uses registry to find actual Steam path ────────────────────
ipcMain.handle("import-steam", async () => {
  try {
    const steamBase = await getSteamPath();
    const vdfPath   = path.join(steamBase, "steamapps", "libraryfolders.vdf");
    const raw       = fs.readFileSync(vdfPath, "utf8");
    const parsed    = vdf.parse(raw);
    const folders   = parsed.libraryfolders;
    const games     = [];

    for (const key of Object.keys(folders)) {
      const folder = folders[key];
      if (!folder.path) continue;
      const appsPath = path.join(folder.path, "steamapps");
      let files;
      try { files = fs.readdirSync(appsPath); } catch { continue; }
      for (const file of files) {
        if (!file.startsWith("appmanifest_") || !file.endsWith(".acf")) continue;
        try {
          const manifest = fs.readFileSync(path.join(appsPath, file), "utf8");
          const data     = vdf.parse(manifest);
          const info     = data.AppState;
          if (!info?.name || !info?.installdir) continue;
          const gameDir  = path.join(appsPath, "common", info.installdir);
          let exePath    = "";
          try {
            const exes = fs.readdirSync(gameDir).filter(f => f.endsWith(".exe"));
            if (exes.length) exePath = path.join(gameDir, exes[0]);
          } catch {}
          games.push({ title: info.name, exePath, category: "Other", cover: "" });
        } catch { continue; }
      }
    }
    approvedGames.approveAll(games);
    return { success: true, games };
  } catch(e) { return { success: false, error: e.message }; }
});

// ── Epic Games ────────────────────────────────────────────────────────────────
ipcMain.handle("import-epic", async () => {
  try {
    const manifestPath = path.join(
      process.env.PROGRAMDATA || "C:\\ProgramData",
      "Epic", "EpicGamesLauncher", "Data", "Manifests"
    );
    let files;
    try { files = fs.readdirSync(manifestPath).filter(f => f.endsWith(".item")); }
    catch { return { success: false, error: "Epic Games Launcher not found" }; }

    const games = [];
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(manifestPath, file), "utf8"));
        if (!data.DisplayName || !data.InstallLocation) continue;
        let exePath = data.LaunchExecutable
          ? path.join(data.InstallLocation, data.LaunchExecutable)
          : "";
        if (!exePath) {
          try {
            const exes = fs.readdirSync(data.InstallLocation).filter(f => f.endsWith(".exe"));
            if (exes.length) exePath = path.join(data.InstallLocation, exes[0]);
          } catch {}
        }
        games.push({ title: data.DisplayName, exePath, category: "Other", cover: "" });
      } catch { continue; }
    }
    approvedGames.approveAll(games);
    return { success: true, games };
  } catch(e) { return { success: false, error: e.message }; }
});

// ── Xbox ──────────────────────────────────────────────────────────────────────
// Finds the games the Xbox app has installed (see xbox.js), and asks the AURA server for their cover art
ipcMain.handle("import-xbox", async () => {
  const res = await require("./xbox").importGames({ covers: typeof auraServer === "function" ? (games) => auraServer("/api/covers/bulk", { games }) : null });
  if (res && res.success) approvedGames.approveAll(res.games);
  return res;
});

// ── IGDB cover art ────────────────────────────────────────────────────────────
ipcMain.handle("fetch-cover-art", async (_e, title) => auraServer("/api/covers/one", { title }));

ipcMain.handle("fetch-covers-bulk", async (_e, games) =>
  // Small groups, slowly, then one at a time for any game still missing, so none are skipped (see covers.js) (Added by aura-covers-setup.cjs)
  require("./covers").fetchCovers(games, {
    server: (route, body) => auraServer(route, body),
    progress: (p) => { try { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send("covers-progress", p); } catch {} },
  }));

// ── Twitch live streams ────────────────────────────────────────────────────────
ipcMain.handle("fetch-twitch-streams", async (_e, opts = {}) =>
  auraServer("/api/twitch/streams", { gameNames: opts?.gameNames, userLogins: opts?.userLogins }));

ipcMain.handle("search-twitch", async (_e, opts = {}) =>
  auraServer("/api/twitch/search", { query: opts?.query, type: opts?.type }));

// ── Twitch favorites: a Windows notification when one goes live (Added by aura-twitch-favorites-setup.cjs) ──
// Clicking it brings AURA back and opens that stream.
const liveNotices = new Set(); // held on to, so a click still works a while later
ipcMain.handle("twitch-live-notice", (_e, info = {}) => {
  const login = String(info?.login || "").toLowerCase();
  if (!/^[a-z0-9_]{1,25}$/.test(login) || !mainWin || mainWin.isDestroyed()) return { success: false };
  const text = (v, n) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
  const name = text(info?.name, 40) || login;
  const body = [text(info?.game, 60), text(info?.title, 140)].filter(Boolean).join(": ") || "Click to watch in AURA.";
  try {
    const { Notification } = require("electron");
    if (!Notification.isSupported()) return { success: false };
    const n = new Notification({ title: name + " is live on Twitch", body });
    liveNotices.add(n);
    if (liveNotices.size > 10) liveNotices.delete(liveNotices.values().next().value);
    n.on("click", () => {
      liveNotices.delete(n);
      if (!mainWin || mainWin.isDestroyed()) return;
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.show(); mainWin.focus();
      mainWin.webContents.send("twitch-open-stream", login);
    });
    n.on("close", () => liveNotices.delete(n));
    n.show();
    return { success: true };
  } catch { return { success: false }; }
});


ipcMain.handle("steam-get-profile", async (_e, steamId) => auraServer("/api/steam/profile", { steamId: String(steamId || "").trim() }));

ipcMain.handle("steam-get-playtime", async (_e, steamId) => auraServer("/api/steam/playtime", { steamId: String(steamId || "").trim() }));

ipcMain.handle("steam-get-friends-profiles", async (_e, steamId) => auraServer("/api/steam/friends", { steamId: String(steamId || "").trim() }));

// ── Discord OAuth ─────────────────────────────────────────────────────────────
ipcMain.handle("discord-login", async () => {
  try {
    discordState = require("crypto").randomBytes(24).toString("hex");
    await startAuthServer();
    const authUrl = `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&scope=identify&state=${discordState}`;
    await shell.openExternal(authUrl);
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
});

ipcMain.handle("discord-logout",       async () => { discordToken = null; return { success: true }; });

ipcMain.handle("discord-get-user", async () => {
  if (!discordToken) return { success: false, error: "Not logged in" };
  try {
    const res = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${discordToken}` },
    });
    return { success: true, user: res.data };
  } catch(e) { return { success: false, error: e.message }; }
});

// AURA doesn't read anyone's Discord friends list or send Discord messages for them. Both need
// Discord's approval for this app, so friends and invites are AURA's own (see social.js).

// ── YouTube trailer ───────────────────────────────────────────────────────────
ipcMain.handle("fetch-trailer", async (_e, title) => auraServer("/api/trailer", { title }));

// ── Clip Recording ────────────────────────────────────────────────────────────
function startRecording(gameName, opts = {}) {
  if (!ffmpegPath) return { success: false, error: "ffmpeg not available" };
  if (isRecording) return { success: false, error: "Already recording" };

  const gameDir = path.join(getClipFolder(), security.safeName(gameName));
  ensureDir(gameDir);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outFile = path.join(gameDir, `clip-${timestamp}.mp4`);

  // Determine capture input
  const { screen: electronScreen } = require("electron");
  const displays = electronScreen.getAllDisplays();
  let gdigrabInput = "desktop";
  let videoArgs = [];

  if (opts.isScreen && opts.sourceId) {
    const monitorIndex = parseInt(opts.sourceId.split(":")[1]) || 0;
    const display = displays[monitorIndex] || displays[0];
    videoArgs = [
      "-offset_x", String(display.bounds.x),
      "-offset_y", String(display.bounds.y),
      "-video_size", `${display.bounds.width}x${display.bounds.height}`,
    ];
    console.log(`Screen ${monitorIndex}: offset=${display.bounds.x},${display.bounds.y} size=${display.bounds.width}x${display.bounds.height}`);
  } else if (!opts.isScreen && opts.sourceName) {
    gdigrabInput = `title=${opts.sourceName}`;
  }

  const micDevice = opts.micDevice || appSettings.micDevice || "Microphone (Arctis Nova 7 Gen 2)";
  const systemAudio = opts.systemDevice || appSettings.systemDevice || "Stereo Mix (Realtek(R) Audio)";
  const vol = (v, d) => (Number.isFinite(+v) ? Math.min(2, Math.max(0, +v)) : d);
  const micVolume = vol(opts.micVolume, vol(appSettings.micVolume, 1));
  const systemVolume = vol(opts.systemVolume, vol(appSettings.systemVolume, 1));

  const args = [
    "-thread_queue_size", "512",
    "-f", "gdigrab",
    "-framerate", "30",
    ...videoArgs,
    "-i", gdigrabInput,
    "-thread_queue_size", "512",
    "-f", "dshow",
    "-i", `audio=${systemAudio}`,
    "-thread_queue_size", "512",
    "-f", "dshow",
    "-i", `audio=${micDevice}`,
    "-filter_complex", `[1:a]volume=${systemVolume.toFixed(2)}[sys];[2:a]volume=${micVolume.toFixed(2)}[mic];[sys][mic]amix=inputs=2:duration=longest[aout]`,
    "-map", "0:v",
    "-map", "[aout]",
    "-vcodec", "libx264",
    "-preset", "ultrafast",
    "-crf", "23",
    "-g", "60",            // keyframe every 2s so each fragment is written promptly
    "-pix_fmt", "yuv420p",
    "-acodec", "aac",
    "-b:a", "128k",
    // Fragmented MP4: the file is playable even if FFmpeg is stopped abruptly
    "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
    "-y",
    outFile
  ];

  console.log("Recording args:", args.join(" "));

  console.log("Starting recording:", gdigrabInput, "->", outFile);

  try {
    recordingProcess = spawn(ffmpegPath, args, { windowsHide: true });
    isRecording = true;
    recordingGame = gameName || "General";
    recordingStartTime = Date.now();
    recordingOutFile = outFile;

    recordingProcess.on("close", async (code) => {
      console.log("ffmpeg closed:", code);
      isRecording = false;
      recordingProcess = null;
      pushBarState();
      // The live file is written in fragments (so it survives a crash). Rewrite it
      // as a normal MP4 so players show the exact length and can seek accurately.
      const tmp = outFile.replace(/\.mp4$/, ".fixing.mp4");
      const ok = await new Promise((resolve) => {
        const fix = spawn(ffmpegPath, ["-y", "-i", outFile, "-c", "copy", "-movflags", "+faststart", tmp], { windowsHide: true });
        fix.on("error", () => resolve(false));
        fix.on("close", (c) => resolve(c === 0));
      });
      if (ok) {
        try { fs.renameSync(tmp, outFile); } catch (e) { console.error("Could not replace recording:", e.message); }
      } else {
        try { fs.unlinkSync(tmp); } catch {}
      }
      mainWin?.webContents.send("recording-stopped", { file: outFile, game: recordingGame });
      auraBar?.webContents.send("recording-stopped");
      pushBarState();
    });

    recordingProcess.stderr.on("data", (data) => {
      console.log("ffmpeg:", data.toString().slice(0, 200));
    });

    mainWin?.webContents.send("recording-started", { game: recordingGame, file: outFile });
    auraBar?.webContents.send("recording-started");
    pushBarState();
    return { success: true, file: outFile, game: recordingGame };
  } catch(e) {
    console.error("Recording error:", e.message);
    return { success: false, error: e.message };
  }
}


function stopRecording() {
  if (!isRecording || !recordingProcess) return { success: false, error: "Not recording" };
  const proc = recordingProcess;
  try {
    proc.stdin.write("q\n");
    proc.stdin.end();
  } catch {}
  // Only force-kill if FFmpeg hasn't finished writing after 15 seconds
  setTimeout(() => {
    if (recordingProcess === proc) proc.kill("SIGKILL");
  }, 15000);
  isRecording = false;
  pushBarState();
  return { success: true };
}

// Get available audio devices
let audioDeviceCache = null;
ipcMain.handle("get-audio-devices", async () => {
  if (!ffmpegPath) return { success: false, devices: [] };
  if (audioDeviceCache && Date.now() - audioDeviceCache.at < 60000) {
    return { success: true, devices: audioDeviceCache.devices };
  }
  try {
    const result = await Promise.race([
      new Promise((resolve) => {
        const proc = spawn(ffmpegPath, ["-list_devices", "true", "-f", "dshow", "-i", "dummy"], { windowsHide: true });
        let output = "";
        proc.stderr.on("data", d => output += d.toString());
        proc.on("close", () => resolve(output));
        proc.on("error", () => resolve(""));
      }),
      new Promise(resolve => setTimeout(() => resolve(""), 5000))
    ]);
    const devices = [];
    let inAudio = false;
    for (const line of result.split("\n")) {
      if (line.includes("DirectShow audio devices")) { inAudio = true; continue; }
      if (line.includes("DirectShow video devices")) { inAudio = false; continue; }
      if (inAudio && line.includes('"')) {
        const match = line.match(/"([^"]+)"/);
        if (match) devices.push(match[1]);
      }
    }
    console.log("Audio devices found:", devices.filter((d) => !d.startsWith("@")));
    if (devices.length) audioDeviceCache = { at: Date.now(), devices };
    return { success: true, devices };
  } catch(e) {
    return { success: false, devices: [] };
  }
});


// Get all screens and windows for picker
ipcMain.handle("get-displays", () => {
  const { screen } = require("electron");
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((d, i) => ({
    index: i,
    id: d.id,
    bounds: d.bounds,
    scaleFactor: d.scaleFactor,
    isPrimary: d.id === primary.id,
  }));
});

ipcMain.handle("get-capture-sources", async () => {
  try {
    const { desktopCapturer } = require("electron");
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 180 },
    });
    return {
      success: true,
      sources: sources.map(s => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
        isScreen: s.id.startsWith("screen:"),
      })),
    };
  } catch(e) {
    console.error("desktopCapturer error:", e.message);
    return { success: false, error: e.message, sources: [] };
  }
});

ipcMain.handle("get-clip-server-port", () => ({
  port: global.clipServerPort || null,
  token: global.clipServerToken || null,
}));

ipcMain.handle("set-capture-source", (_e, sourceId) => {
  global.pendingCaptureSource = sourceId;
  return { success: true };
});

// ── In-window recordings (AURA Bar, F9 and the Clips page Record button) ──────
// The window records with MediaRecorder and streams the data here, straight to disk.
// When it stops, the file is turned into a normal MP4 in the background, so the
// Stop button responds instantly even while a game is hogging the PC.
let pipe = null; // { stream, rawFile, outFile, mime }

// Newer FFmpeg (ffmpeg-static) handles the recorder's files better than the
// older bundled build; fall back to the recording FFmpeg if it's missing.
const convertFfmpegPath = (() => {
  try {
    const p = require("ffmpeg-static");
    return p ? p.replace("app.asar", "app.asar.unpacked") : null;
  } catch { return null; }
})() || ffmpegPath;

function runFfmpeg(args) {
  return new Promise((resolve) => {
    let log = "";
    const proc = spawn(convertFfmpegPath, args, { windowsHide: true });
    proc.stderr.on("data", (d) => { log = (log + d.toString()).slice(-2000); });
    proc.on("error", () => resolve({ code: -1, log }));
    proc.on("close", (code) => resolve({ code, log }));
  });
}

async function finishPipeRecording({ rawFile, outFile, mime, game }) {
  const h264 = /avc1|h264/i.test(mime || "");
  const aacAudio = /mp4a/i.test(mime || "");
  let result = { code: -1, log: "" };
  if (h264) {
    // Already H.264: just repackage (takes a second, no quality loss)
    result = await runFfmpeg(["-y", "-fflags", "+genpts", "-i", rawFile,
      "-c:v", "copy", "-c:a", aacAudio ? "copy" : "aac", "-b:a", "160k",
      "-movflags", "+faststart", outFile]);
    console.log("repackage closed:", result.code, "->", outFile);
  }
  if (result.code !== 0) {
    // Re-encode (VP9 recordings, or if repackaging failed)
    result = await runFfmpeg(["-y", "-fflags", "+genpts", "-i", rawFile,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", // (sharper: Added by aura-quality-setup.cjs)
      "-af", "aresample=async=1", "-c:a", "aac", "-b:a", "160k",
      "-movflags", "+faststart", outFile]);
    console.log("convert closed:", result.code, "->", outFile);
  }
  if (result.code === 0) {
    try { fs.unlinkSync(rawFile); } catch {}
  } else {
    // Keep the original recording so nothing is lost
    console.error("Conversion failed, keeping", rawFile, "\n", result.log.split("\n").slice(-6).join("\n"));
    try { fs.unlinkSync(outFile); } catch {}
  }
  mainWin?.webContents.send("recording-stopped", { file: result.code === 0 ? outFile : rawFile, game });
  auraBar?.webContents.send("recording-stopped");
}

ipcMain.handle("start-ffmpeg-pipe", async (_e, gameName, mime) => {
  // Let the AURA Bar know a recording is running, so its button shows Stop
  isRecording = true;
  recordingGame = gameName || "General";
  recordingStartTime = Date.now();
  pushBarState();
  try {
    const gameDir = path.join(getClipFolder(), security.safeName(gameName));
    ensureDir(gameDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const outFile = path.join(gameDir, `clip-${timestamp}.mp4`);
    const rawFile = /mp4/i.test(mime || "") ? outFile.replace(/\.mp4$/, ".raw.mp4") : outFile.replace(/\.mp4$/, ".webm");
    pipe = { stream: fs.createWriteStream(rawFile), rawFile, outFile, mime: mime || "video/webm", game: recordingGame };
    console.log("Recording to:", rawFile, "(" + pipe.mime + ")");
    auraBar?.webContents.send("recording-started");
    return { success: true, file: outFile };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("pipe-to-ffmpeg", (_e, buffer) => {
  pipe?.stream.write(Buffer.from(buffer));
  return { success: true };
});

ipcMain.handle("stop-ffmpeg-pipe", async () => {
  const job = pipe;
  pipe = null;
  // Show "not recording" right away
  isRecording = false;
  recordingStartTime = null;
  pushBarState();
  auraBar?.webContents.send("recording-stopped");
  if (!job) return { success: false };
  try {
    await new Promise((resolve) => job.stream.end(resolve));
    finishPipeRecording(job); // runs in the background
    return { success: true, file: job.outFile };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("trim-clip", async (_e, input = {}) => {
  // Only clips in the clip folder, and only real times (see security.js)
  const filePath = security.clipPath(input && input.path, getClipFolder());
  const start = Number(input && input.start), end = Number(input && input.end);
  if (!filePath || !security.isClipFile(filePath)) return { success: false, error: "AURA can only trim clips in your clip folder." };
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > 24 * 3600) return { success: false, error: "Pick a start and end inside the clip." };
  try {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    const outFile = path.join(dir, `${base}-trim${ext}`);
    const duration = end - start;

    await new Promise((resolve, reject) => {
      const args = [
        "-ss", String(start),
        "-i", filePath,
        "-t", String(duration),
        "-c:v", "libx264",
        "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", // a trimmed clip keeps its quality (Added by aura-quality-setup.cjs)
        "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart",
        "-y",
        outFile
      ];
      const proc = spawn(ffmpegPath, args, { windowsHide: true });
      proc.stderr.on("data", d => console.log("trim:", d.toString().slice(0, 100)));
      proc.on("close", code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
      proc.on("error", reject);
    });

    console.log("Trim saved:", outFile);
    return { success: true, file: outFile };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

// Share: uploads a clip from the clip folder and hands back its link (see share.js)
ipcMain.handle("share-clip", async (_e, filePath) => require("./share").shareClip(filePath, { clipFolder: getClipFolder() }));

ipcMain.handle("save-clip", async (_e, gameName, buffer) => {
  try {
    const gameDir = path.join(getClipFolder(), security.safeName(gameName));
    ensureDir(gameDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const outFile = path.join(gameDir, `clip-${timestamp}.webm`);
    fs.writeFileSync(outFile, Buffer.from(buffer));
    console.log("Clip saved:", outFile);
    return { success: true, file: outFile };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("start-recording", async (_e, gameName, opts) => startRecording(gameName, opts || {}));
ipcMain.handle("stop-recording",  async () => stopRecording());
ipcMain.handle("recording-status", async () => ({
  isRecording,
  game: recordingGame,
  elapsed: recordingStartTime ? Date.now() - recordingStartTime : 0,
}));

ipcMain.handle("set-clip-folder", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openDirectory"], title: "Choose Clip Save Folder" });
  if (r.canceled) return { success: false };
  clipFolder = r.filePaths[0];
  appSettings.clipFolder = clipFolder; saveAppSettings(); // remembered after a restart (Added by aura-release-fixes-setup.cjs)
  return { success: true, folder: clipFolder };
});

ipcMain.handle("get-clip-folder", async () => ({ folder: getClipFolder() }));

ipcMain.handle("get-clips", async () => {
  try {
    const base = getClipFolder();
    ensureDir(base);
    const clips = [];
    const gameDirs = fs.readdirSync(base).filter(f => fs.statSync(path.join(base, f)).isDirectory());
    for (const game of gameDirs) {
      const gameDir = path.join(base, game);
      const files = fs.readdirSync(gameDir).filter(f => f.endsWith(".mp4") || f.endsWith(".webm") || f.endsWith(".mkv"));
      for (const file of files) {
        const filePath = path.join(gameDir, file);
        const stat = fs.statSync(filePath);
        clips.push({
          id: `${game}-${file}`,
          game,
          file,
          path: filePath,
          size: stat.size,
          date: stat.mtime.toISOString(),
        });
      }
    }
    clips.sort((a, b) => new Date(b.date) - new Date(a.date));
    return { success: true, clips };
  } catch(e) {
    return { success: false, error: e.message, clips: [] };
  }
});

ipcMain.handle("delete-clip", async (_e, filePath) => {
  // Only clips and screenshots in the clip folder (see security.js)
  const full = security.clipPath(filePath, getClipFolder());
  if (!full || !security.isClipFile(full)) return { success: false, error: "AURA can only delete clips in your clip folder." };
  try {
    try { await shell.trashItem(full); } catch { fs.unlinkSync(full); } // Recycle Bin when there is one
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("open-clip-folder", async (_e, filePath) => {
  const full = security.clipPath(filePath, getClipFolder());
  if (full) shell.showItemInFolder(full);
  else { ensureDir(getClipFolder()); shell.openPath(getClipFolder()); }
  return { success: true };
});

ipcMain.handle("rename-clip", async (_e, input = {}) => {
  // Only clips in the clip folder, renamed in place (see security.js)
  const oldPath = security.clipPath(input && input.oldPath, getClipFolder());
  if (!oldPath || !security.isClipFile(oldPath)) return { success: false, error: "AURA can only rename clips in your clip folder." };
  const name = security.safeName(input && input.newName, "");
  if (!name) return { success: false, error: "Type a name for the clip." };
  try {
    const ext = path.extname(oldPath);
    const newPath = path.join(path.dirname(oldPath), name + ext);
    if (newPath.toLowerCase() === oldPath.toLowerCase()) { fs.renameSync(oldPath, newPath); return { success: true, newPath }; }
    if (fs.existsSync(newPath)) return { success: false, error: "A clip with that name already exists." };
    fs.renameSync(oldPath, newPath);
    return { success: true, newPath };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

// ── Shortcuts that work everywhere, even inside a game ─────────────────────────
// Alt+Shift+R records and Alt+Shift+B shows the AURA Bar. F9 and F10 only if you switch them on in
// Settings: a shortcut taken here never reaches the game, and many games use F9/F10 to quicksave.
// (Added by aura-release-fixes-setup.cjs)
function toggleBar() {
  if (!auraBar) return;
  if (auraBar.isVisible()) {
    auraBar.hide();
  } else {
    // showInactive: don't steal focus from the game (that can minimize it)
    auraBar.showInactive();
    auraBar.setAlwaysOnTop(true, "screen-saver");
    auraBar.moveTop();
  }
}
function applyHotkeys() {
  for (const key of ["F9", "F10", RECORD_HOTKEY, BAR_HOTKEY]) { try { globalShortcut.unregister(key); } catch {} }
  if (!globalShortcut.register(RECORD_HOTKEY, toggleRecordingHotkey)) console.log("Record hotkey is in use by another app:", RECORD_HOTKEY);
  if (!globalShortcut.register(BAR_HOTKEY, toggleBar)) console.log("Bar hotkey is in use by another app:", BAR_HOTKEY);
  if (appSettings.keyF9) globalShortcut.register("F9", toggleRecordingHotkey);
  if (appSettings.keyF10) globalShortcut.register("F10", toggleBar);
}
function registerHotkeys() { applyHotkeys(); }


let streamView = null;

// ── Stream full view ──────────────────────────────────────────────────────────
// The Twitch player is a separate layer drawn on top of AURA's page, so when it fills the window
// it also covers AURA's buttons. Two things make sure there is always a way out:
//   - a slim strip at the top is left uncovered, where the page shows "Exit full view"
//   - Esc leaves full view even when the keyboard is inside the Twitch player
const STREAM_BAR = 44; // height of that strip, in page pixels (the page draws a bar the same height)

// ── Room for AURA's own panels over the stream (Added by aura-stream-room-setup.cjs) ──
// The player and chat are drawn on top of AURA's page, so they make room for AURA's call cameras,
// shared screens, call settings and camera preview (see streamroom.js). Every place that sizes
// them goes through placeStream / placeChat.
const { fitStream, cleanRoom } = require("./streamroom");
let streamRoom = { rects: [], all: false };
function placeStream(want) {
  if (!streamView || !mainWin || !want) return;
  streamView.__auraWant = want;
  const fit = fitStream(want, streamRoom, mainWin.webContents.getZoomFactor() || 1);
  const shown = mainWin.getBrowserViews().includes(streamView);
  if (!fit) {
    // Steps aside, still playing
    if (shown) mainWin.removeBrowserView(streamView);
    streamView.__auraAside = true;
    return;
  }
  if (streamView.__auraAside) { streamView.__auraAside = false; if (!shown) mainWin.addBrowserView(streamView); }
  streamView.setBounds(fit);
}
function placeChat(want) {
  const chat = mainWin?.chatView;
  if (!chat || !want) return;
  chat.__auraWant = want;
  const shown = mainWin.getBrowserViews().includes(chat);
  if (streamRoom.all) { if (shown) mainWin.removeBrowserView(chat); chat.__auraAside = true; return; }
  if (chat.__auraAside) { chat.__auraAside = false; if (!shown) mainWin.addBrowserView(chat); }
  chat.setBounds(want);
}
ipcMain.handle("stream-room", async (_e, room) => {
  streamRoom = cleanRoom(room);
  try {
    if (streamView?.__auraWant) placeStream(streamView.__auraWant);
    if (mainWin?.chatView?.__auraWant && (mainWin.chatView.__auraAside || streamRoom.all)) placeChat(mainWin.chatView.__auraWant);
  } catch {}
  return { success: true };
});

function fillWindowWithStream() {
  if (!streamView || !mainWin) return;
  const [w, h] = mainWin.getContentSize();
  const bar = Math.round(STREAM_BAR * (mainWin.webContents.getZoomFactor() || 1));
  placeStream({ x: 0, y: bar, width: w, height: Math.max(1, h - bar) });
}
function leaveStreamFull() {
  if (!streamView || !streamView.__auraFull) return false;
  streamView.__auraFull = false;
  // Straight back to where it was; the page then lines it up exactly
  if (streamView.__auraBefore) { try { placeStream(streamView.__auraBefore); } catch {} }
  return true;
}

ipcMain.handle("stream-fullscreen", async () => {
  // Wait up to 2s for streamView to be available
  let attempts = 0;
  while (!streamView && attempts < 20) {
    await new Promise(r => setTimeout(r, 100));
    attempts++;
  }
  if (!streamView || !mainWin) return { success: false, error: "No stream active" };
  const view = streamView;
  if (!view.__auraFull) view.__auraBefore = view.__auraWant || view.getBounds();
  view.__auraFull = true;
  mainWin.removeBrowserView(view);
  mainWin.addBrowserView(view);
  fillWindowWithStream();
  if (mainWin.chatView) mainWin.removeBrowserView(mainWin.chatView);
  if (!view.__auraEsc) {
    view.__auraEsc = true;
    // Keys pressed inside the Twitch player never reach AURA's page, so Esc is caught here
    view.webContents.on("before-input-event", (e, input) => {
      if (input.type !== "keyDown" || input.key !== "Escape" || !view.__auraFull) return;
      e.preventDefault();
      view.webContents.executeJavaScript("document.fullscreenElement && document.exitFullscreen()").catch(() => {});
      if (streamView === view) leaveStreamFull();
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.focus();
        mainWin.webContents.send("stream-exit-full");
      }
    });
  }
  if (!mainWin.__auraStreamResize) {
    mainWin.__auraStreamResize = true;
    mainWin.on("resize", () => { if (streamView && streamView.__auraFull) fillWindowWithStream(); });
  }
  return { success: true };
});

// The page asks for this before it puts the player back in its place
ipcMain.handle("stream-exit-full", async () => ({ success: true, wasFull: leaveStreamFull() }));

// Volume is set with the Twitch player's own volume control. AURA runs nothing inside the player
// to change it: Twitch's rules say the player must be left as it is.

ipcMain.handle("stream-restore", async (_e, { bounds, chatBounds }) => {
  console.log("stream-restore called, streamView:", !!streamView);
  if (!streamView) return { success: false };
  try {
    if (!mainWin.getBrowserViews().includes(streamView)) {
      mainWin.addBrowserView(streamView);
    }
    placeStream(zoomBounds(bounds));
    if (mainWin.chatView && chatBounds) {
      if (!mainWin.getBrowserViews().includes(mainWin.chatView)) {
        mainWin.addBrowserView(mainWin.chatView);
      }
      placeChat(zoomBounds(chatBounds));
    }
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("stream-open", async (_e, { channel, bounds }) => {
  channel = String(channel || "").toLowerCase();
  if (!/^[a-z0-9_]{1,25}$/.test(channel)) return { success: false, error: "That isn't a Twitch channel name." };
  if (streamView) {
    mainWin.removeBrowserView(streamView);
    streamView.webContents.destroy();
    streamView = null;
  }
  streamView = new (require("electron").BrowserView)({
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  mainWin.addBrowserView(streamView);
  placeStream(zoomBounds(bounds));
  streamView.setAutoResize({ width: false, height: false });
  streamView.webContents.loadURL(
    `https://player.twitch.tv/?channel=${channel}&parent=aura-launcher&autoplay=true&muted=false`
  );
  return { success: true };
});

ipcMain.handle("get-env-debug", () => ({
  AURA_SERVER: AURA_SERVER_URL,
  KEYS: "On the AURA server, not in this app",
  DISCORD_CLIENT_ID: DISCORD_CLIENT_ID ? "SET" : "MISSING",
}));

ipcMain.handle("focus-main", () => {
  mainWin?.show();
  mainWin?.focus();
  return { success: true };
});

ipcMain.handle("get-window-pos", (_e) => {
  const pos = mainWin?.getPosition() || [0, 0];
  return { x: pos[0], y: pos[1] };
});

ipcMain.handle("stop-bar-recording", () => {
  if (recordingProcess) stopRecording();
  mainWin?.webContents.send("bar-stop-recording"); // stops in-window recordings
  return { success: true };
});

// Same start/stop logic as F9, so the bar always stops whatever is recording
ipcMain.handle("toggle-recording", async () => {
  toggleRecordingHotkey();
  return { success: true };
});

ipcMain.handle("get-screenshots", async () => {
  try {
    const screenshotDir = path.join(getClipFolder(), "Screenshots");
    if (!fs.existsSync(screenshotDir)) return { success: true, screenshots: [] };
    const files = fs.readdirSync(screenshotDir).filter(f => f.endsWith(".png") || f.endsWith(".jpg"));
    const screenshots = files.map(f => {
      const fp = path.join(screenshotDir, f);
      const stat = fs.statSync(fp);
      return { id: f, file: f, path: fp, date: stat.mtime.toISOString(), size: stat.size };
    }).sort((a, b) => new Date(b.date) - new Date(a.date));
    return { success: true, screenshots };
  } catch(e) {
    return { success: false, screenshots: [], error: e.message };
  }
});

ipcMain.handle("take-screenshot", () => captureScreenshot());

async function captureScreenshot() {
  try {
    const { desktopCapturer, screen } = require("electron");
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 3840, height: 2160 } });
    // Get cursor position to find which screen to screenshot
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    // Match source to display by index
    const displays = screen.getAllDisplays();
    const idx = displays.findIndex(d => d.id === display.id);
    const source = sources[idx] || sources[0];
    if (!source) return { success: false, error: "No screen found" };
    const screenshotDir = path.join(getClipFolder(), "Screenshots");
    ensureDir(screenshotDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const outFile = path.join(screenshotDir, `screenshot-${timestamp}.png`);
    const img = source.thumbnail.toPNG();
    fs.writeFileSync(outFile, img);
    console.log("Screenshot saved:", outFile);
    return { success: true, file: outFile };
  } catch(e) {
    console.error("Screenshot error:", e);
    return { success: false, error: e.message };
  }
}

// The mini-player. Twitch asks that its player is never shown smaller than 400 x 300.
const STREAM_MIN = { width: 400, height: 300 };
ipcMain.handle("stream-pip", async (_e, bounds) => {
  if (streamView && bounds) {
    const b = zoomBounds(bounds);
    placeStream({ x: b.x, y: b.y, width: Math.max(STREAM_MIN.width, b.width), height: Math.max(STREAM_MIN.height, b.height) });
  }
  // Chat isn't shown in the mini-player
  if (mainWin.chatView) {
    mainWin.removeBrowserView(mainWin.chatView);
  }
  return { success: true };
});

ipcMain.handle("stream-resize", async (_e, bounds) => {
  if (streamView) placeStream(zoomBounds(bounds));
  return { success: true };
});

ipcMain.handle("stream-close", async () => {
  if (streamView) {
    mainWin.removeBrowserView(streamView);
    streamView.webContents.destroy();
    streamView = null;
  }
  return { success: true };
});

ipcMain.handle("chat-open", async (_e, { channel, bounds }) => {
  channel = String(channel || "").toLowerCase();
  if (!/^[a-z0-9_]{1,25}$/.test(channel)) return { success: false, error: "That isn't a Twitch channel name." };
  // Chat uses a separate BrowserView
  if (mainWin.chatView) {
    mainWin.removeBrowserView(mainWin.chatView);
    mainWin.chatView.webContents.destroy();
    mainWin.chatView = null;
  }
  mainWin.chatView = new (require("electron").BrowserView)({
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  mainWin.addBrowserView(mainWin.chatView);
  placeChat(zoomBounds(bounds));
  mainWin.chatView.webContents.loadURL(
    `https://www.twitch.tv/embed/${channel}/chat?parent=aura-launcher&darkpopout`
  );
  return { success: true };
});

ipcMain.handle("chat-close", async () => {
  if (mainWin.chatView) {
    mainWin.removeBrowserView(mainWin.chatView);
    mainWin.chatView.webContents.destroy();
    mainWin.chatView = null;
  }
  return { success: true };
});


ipcMain.handle("check-update", async () => {
  try {
    const res     = await axios.get("https://api.github.com/repos/tctray/aura-launcher/releases/latest");
    const latest  = res.data.tag_name?.replace(/^v/, "");
    const current = app.getVersion();
    // Only offer versions that are actually newer (never a downgrade)
    const newer = (x, y) => {
      const px = String(x).split(".").map(Number), py = String(y).split(".").map(Number);
      for (let i = 0; i < 3; i++) {
        if ((px[i] || 0) !== (py[i] || 0)) return (px[i] || 0) > (py[i] || 0);
      }
      return false;
    };
    return { success: true, latest, current, hasUpdate: !!latest && newer(latest, current) };
  } catch(e) { return { success: false, error: e.message }; }
});

// ── Discord OAuth callback server ─────────────────────────────────────────────
// Listens on this PC only, for one login, for up to 5 minutes. The login must carry the
// random "state" AURA put in the link, so another website can't log you in as someone else.
let discordState = null;
let authTimer = null;
function stopAuthServer() {
  clearTimeout(authTimer); authTimer = null;
  if (authServer) { try { authServer.close(); } catch {} authServer = null; }
}
function startAuthServer() {
  return new Promise((resolve, reject) => {
    stopAuthServer();
    const page = (title, text) => `<html><body style="background:#222831;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:12px"><div style="font-size:20px;font-weight:700">${title}</div><div style="font-size:13px;color:#a0a8b4">${text}</div></body></html>`;
    authServer = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost:3000");
      if (url.pathname !== "/callback") { res.writeHead(404); res.end(); return; }
      const code = url.searchParams.get("code") || "";
      const state = url.searchParams.get("state") || "";
      const expected = discordState;
      if (!expected || state !== expected || !/^[A-Za-z0-9_-]{6,200}$/.test(code)) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page("This Discord login didn't come from AURA", "Start again from AURA's Discord button."));
        return;
      }
      discordState = null; // each login link works once
      try {
        // The AURA server swaps the one-time code for a login (that step needs the Discord secret)
        const tokenRes = await auraServer("/api/discord/token", { code });
        if (!tokenRes.success) throw new Error(tokenRes.error || "Discord login failed.");
        discordToken = tokenRes.access_token;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page("Connected to Discord!", "You can close this tab and return to AURA."));
        mainWin?.webContents.send("discord-auth-success");
      } catch {
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page("Discord login failed", "Close this tab and try again from AURA."));
      }
      stopAuthServer();
    });
    authServer.on("error", reject);
    authServer.listen(3000, "127.0.0.1", resolve);
    authTimer = setTimeout(() => { discordState = null; stopAuthServer(); }, 5 * 60 * 1000);
  });
}