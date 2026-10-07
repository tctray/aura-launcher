process.on('uncaughtException', (e) => {
  console.error('CRASH:', e.message, e.stack);
});

const path = require("path");
const fs   = require("fs");
const { app, BrowserWindow, ipcMain, shell, dialog, globalShortcut } = require("electron");
// Notes errors in a log file on this PC (see errorlog.js). Nothing is sent anywhere.
require("./errorlog").register(require("electron"));
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
app.on("web-contents-created", (_e, contents) => {
  if (contents.getType() !== "webview") return;
  // The Browser tab can go anywhere; the social tabs stay on their own sites
  const isBrowserTab = contents.session === require("electron").session.fromPartition("persist:social-browser");
  contents.setWindowOpenHandler(({ url }) => {
    if (isBrowserTab || isSocialHost(url)) contents.loadURL(url);
    else shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (e, url) => {
    if (!isBrowserTab && !isSocialHost(url)) { e.preventDefault(); shell.openExternal(url); }
  });
});
// Load .env — written by CI from GitHub Secrets, or local file in dev
// Load .env — dev reads from project root, packaged reads from resources/
// Note: process.resourcesPath is available immediately in main process
const devEnv = path.join(__dirname, "../.env");
const pkgEnv = path.join(app.getAppPath(), "../.env");
const resEnv = process.resourcesPath ? path.join(process.resourcesPath, ".env") : null;

if      (fs.existsSync(devEnv)) require("dotenv").config({ path: devEnv });
else if (resEnv && fs.existsSync(resEnv)) require("dotenv").config({ path: resEnv });
else if (fs.existsSync(pkgEnv)) require("dotenv").config({ path: pkgEnv });


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
};
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
function loadAppSettings() {
  try { Object.assign(appSettings, JSON.parse(fs.readFileSync(settingsFile(), "utf8"))); } catch {}
}
function saveAppSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(appSettings, null, 2)); } catch (e) { console.error("Settings save failed:", e.message); }
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
  // Use userData path - always accessible in packaged apps
  return path.join(app.getPath("userData"), "Clips");
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
    backgroundColor: "#222831",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      webSecurity: false,
      enableBlinkFeatures: "GetDisplayMedia",
      autoplayPolicy: "no-user-gesture-required", // lets recording audio start without a fresh click
      backgroundThrottling: false, // keep recording smoothly while AURA is minimized behind a game
      allowRunningInsecureContent: true,
      sandbox: false,
    },
  });
  applyWindowMode(appSettings.windowMode);
  mainWin.once("ready-to-show", () => mainWin.show());
  mainWin.webContents.on("did-finish-load", () => {
    mainWin?.webContents.setZoomFactor(appSettings.zoom || 1);
  });
  // F11 toggles fullscreen, so there's always a way out of fullscreen mode
  mainWin.webContents.on("before-input-event", (_e, input) => {
    if (input.type === "keyDown" && input.key === "F11") mainWin.setFullScreen(!mainWin.isFullScreen());
  });

  // Closing AURA also closes the AURA Bar and fully quits the app
  mainWin.on("closed", () => {
    mainWin = null;
    if (auraBar && !auraBar.isDestroyed()) auraBar.destroy();
    auraBar = null;
    app.quit();
  });
  // Allow getUserMedia with desktop capture source
  mainWin.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    // Allow all media permissions including microphone
    // "display-capture" is what getDisplayMedia asks for. Without it, screen recording
    // with computer sound is refused and AURA falls back to Stereo Mix.
    const allowed = ["media", "audioCapture", "desktopCapture", "display-capture", "mediaKeySystem"];
    callback(allowed.includes(permission) || permission.includes("media") || permission.includes("audio"));
  });

  mainWin.webContents.session.setPermissionCheckHandler(() => true);

  mainWin.webContents.on("enter-html-full-screen", () => {
    mainWin.setFullScreen(true);
  });
  mainWin.webContents.on("leave-html-full-screen", () => {
    mainWin.setFullScreen(false);
  });
  mainWin.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
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
const BAR_WIDTH = 640;
const BAR_HEIGHT = 60;           // bar only
const BAR_HEIGHT_EXPANDED = 160; // bar + performance panel
const RECORD_HOTKEY = "Alt+Shift+R";
let currentGameName = null;

function barState() {
  return {
    recording: isRecording,
    recStartedAt: isRecording ? recordingStartTime : null,
    game: currentGameName,
    hotkey: "Alt+Shift+R",
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
ipcMain.handle("auth:getSession", cloudHandler(auraCloud.getSession));
ipcMain.handle("auth:resendConfirmation", cloudHandler(auraCloud.resendConfirmation));
ipcMain.handle("profile:getMine", cloudHandler(auraCloud.getMyProfile));
ipcMain.handle("profile:save", cloudHandler(auraCloud.saveProfile));
ipcMain.handle("profile:get", cloudHandler(auraCloud.getProfile));
ipcMain.handle("games:getMine", cloudHandler(auraCloud.getMyGames));
ipcMain.handle("games:saveMine", cloudHandler(auraCloud.saveMyGames));
ipcMain.handle("data:getMine", cloudHandler(auraCloud.getMyData));
ipcMain.handle("data:saveMine", cloudHandler(auraCloud.saveMyData));
ipcMain.handle("sessions:getIds", cloudHandler(auraCloud.getMySessionIds));
ipcMain.handle("sessions:get", cloudHandler(auraCloud.getMySessions));
ipcMain.handle("sessions:save", cloudHandler(auraCloud.saveMySessions));
ipcMain.handle("sessions:delete", cloudHandler(auraCloud.deleteMySessions));

// AURA friends and messages. The work happens in social.js
require("./social").register({ ipcMain, cloudHandler, cloud: auraCloud, getWindow: () => mainWin, server: (route, body) => auraServer(route, body) });



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
    resizable: false,
    movable: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
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

      const rawPath = decodeURIComponent(url.pathname.slice(1));
      // Fix Windows path - restore backslashes and drive letter colon
      const filePath = rawPath.replace(/\//g, "\\");
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;
        const fileStream = fs.createReadStream(filePath, { start, end });
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize,
          "Content-Type": filePath.endsWith(".webm") ? "video/webm" : filePath.endsWith(".png") ? "image/png" : filePath.endsWith(".jpg") ? "image/jpeg" : "video/mp4",
        });
        fileStream.pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": fileSize,
          "Content-Type": filePath.endsWith(".webm") ? "video/webm" : filePath.endsWith(".png") ? "image/png" : filePath.endsWith(".jpg") ? "image/jpeg" : "video/mp4",
          "Accept-Ranges": "bytes",
        });
        fs.createReadStream(filePath).pipe(res);
      }
    } catch(e) {
      res.writeHead(500);
      res.end("Error: " + e.message);
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
  ipcMain.handle("install-update", () => autoUpdater.quitAndInstall(false, true));

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
function runQuiet(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true });
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
  const safe = dir.replace(/'/g, "''").replace(/\\+$/, "") + "\\";
  const script =
    `(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and ` +
    `$_.ExecutablePath.StartsWith('${safe}', [StringComparison]::OrdinalIgnoreCase) }).Count`;
  const out = await runQuiet("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
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

// ── Launch Game ───────────────────────────────────────────────────────────────
// Spawns the game so AURA can see when it closes, then logs the session
// (playtime + performance summary) back to the app.
const gameSessions = new Map();

ipcMain.handle("launch-game", async (_e, exePath) => {
  try {
    const startTime = Date.now();
    const child = spawn(exePath, [], {
      cwd: path.dirname(exePath),
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
      return { success: true };
    }

    gameSessions.set(exePath, startTime);
    perf.beginSession(exePath);
    currentGameName = path.basename(exePath, ".exe");
    pushBarState();

    rpc.setActivity({
      details: `Playing ${path.basename(exePath, ".exe")}`,
      state:   "AURA Game Launcher",
      largeImageKey: "aura_logo",
      startTimestamp: new Date(),
    }).catch(() => {});

    // When the game closes: send the session + performance summary
    const exeName = path.basename(exePath);
    const finishSession = () => {
      const endTime = Date.now();
      const perfSummary = perf.endSession(exePath);
      gameSessions.delete(exePath);
      if (currentGameName === path.basename(exePath, ".exe")) currentGameName = null;
      pushBarState();
      console.log(`Session ended: ${exeName} (${Math.round((endTime - startTime) / 1000)}s)`);

      mainWin?.webContents.send("game-session-ended", {
        exePath,
        sessionMs: endTime - startTime,
        startTime,
        endTime,
        perf: perfSummary,
      });

      rpc.setActivity({
        details: "Browsing Game Library",
        state:   "AURA Game Launcher",
        largeImageKey: "aura_logo",
        startTimestamp: new Date(),
      }).catch(() => {});
    };

    child.on("exit", async () => {
      if (process.platform === "win32") {
        const quick = Date.now() - startTime < 60000;
        if (await isGameRunning(exePath)) {
          // The launcher closed but the game is still going
          console.log(`${exeName} handed off, watching the game until it closes...`);
          await waitForGameToClose(exePath, 0);
        } else if (quick) {
          // Launchers like the EA app can take a while to start the real game
          console.log(`${exeName} exited quickly, waiting up to 3 minutes for the game to start...`);
          await waitForGameToClose(exePath, 180000);
        }
      }
      finishSession();
    });

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
  return r.canceled ? null : r.filePaths[0];
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

ipcMain.handle("open-external", async (_e, url) => {
  await shell.openExternal(url);
  return { success: true };
});

// ── Clip editor window ────────────────────────────────────────────────────────
ipcMain.on("open-clip-editor", () => openClipEditor(mainWin));

// ── Settings sync from the Settings page ──────────────────────────────────────
ipcMain.handle("settings-sync", (_e, patch = {}) => {
  const prevMode = appSettings.windowMode;
  const prevZoom = appSettings.zoom;
  for (const key of Object.keys(appSettings)) {
    if (patch[key] !== undefined) appSettings[key] = patch[key];
  }
  appSettings.zoom = Math.min(1.3, Math.max(0.8, Number(appSettings.zoom) || 1));
  saveAppSettings();
  if (appSettings.windowMode !== prevMode) applyWindowMode(appSettings.windowMode);
  if (appSettings.zoom !== prevZoom) mainWin?.webContents.setZoomFactor(appSettings.zoom);
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
    return { success: true, games };
  } catch(e) { return { success: false, error: e.message }; }
});

// ── Xbox ──────────────────────────────────────────────────────────────────────
ipcMain.handle("import-xbox", async () => {
  try {
    const xboxPath = "C:\\XboxGames";
    const games    = [];
    if (fs.existsSync(xboxPath)) {
      for (const folder of fs.readdirSync(xboxPath)) {
        const fp = path.join(xboxPath, folder);
        try {
          const exes = fs.readdirSync(fp).filter(f => f.endsWith(".exe"));
          if (exes.length) games.push({ title: folder, exePath: path.join(fp, exes[0]), category: "Other", cover: "" });
        } catch { continue; }
      }
    }
    if (games.length) return { success: true, games };
    return { success: false, error: "No Xbox games found." };
  } catch(e) { return { success: false, error: e.message }; }
});

// ── IGDB cover art ────────────────────────────────────────────────────────────
ipcMain.handle("fetch-cover-art", async (_e, title) => auraServer("/api/covers/one", { title }));

ipcMain.handle("fetch-covers-bulk", async (_e, games) => {
  // Sent in small groups so a big library doesn't make one very long request
  const list = (Array.isArray(games) ? games : []).filter((g) => g && g.title).map((g) => ({ id: g.id, title: g.title }));
  const covers = {};
  for (let i = 0; i < list.length; i += 20) {
    const res = await auraServer("/api/covers/bulk", { games: list.slice(i, i + 20) });
    if (!res.success) return Object.keys(covers).length ? { success: true, covers } : res;
    Object.assign(covers, res.covers || {});
  }
  return { success: true, covers };
});

// ── Twitch live streams ────────────────────────────────────────────────────────
ipcMain.handle("fetch-twitch-streams", async (_e, opts = {}) =>
  auraServer("/api/twitch/streams", { gameNames: opts?.gameNames, userLogins: opts?.userLogins }));

ipcMain.handle("search-twitch", async (_e, opts = {}) =>
  auraServer("/api/twitch/search", { query: opts?.query, type: opts?.type }));


ipcMain.handle("steam-get-profile", async (_e, steamId) => auraServer("/api/steam/profile", { steamId: String(steamId || "").trim() }));

ipcMain.handle("steam-get-playtime", async (_e, steamId) => auraServer("/api/steam/playtime", { steamId: String(steamId || "").trim() }));

ipcMain.handle("steam-get-friends-profiles", async (_e, steamId) => auraServer("/api/steam/friends", { steamId: String(steamId || "").trim() }));

// ── Discord OAuth ─────────────────────────────────────────────────────────────
ipcMain.handle("discord-login", async () => {
  try {
    await startAuthServer();
    const authUrl = `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&scope=identify`;
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

ipcMain.handle("discord-get-friends", async () => {
  if (!discordToken) return { success: false, error: "Not logged in" };
  try {
    const res = await axios.get("https://discord.com/api/users/@me/relationships", {
      headers: { Authorization: `Bearer ${discordToken}` },
    });
    const friends = res.data.filter(r => r.type === 1).map(r => ({
      id:       r.id,
      username: r.user.username,
      avatar:   r.user.avatar
        ? `https://cdn.discordapp.com/avatars/${r.user.id}/${r.user.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/0.png`,
      status:   r.presence?.status || "offline",
      activity: r.presence?.activities?.[0]?.name || null,
    }));
    return { success: true, friends };
  } catch(e) { return { success: false, error: e.message }; }
});

ipcMain.handle("discord-invite-friend", async (_e, friendId, gameName) => {
  if (!discordToken) return { success: false, error: "Not logged in" };
  try {
    const dm = await axios.post(
      "https://discord.com/api/users/@me/channels",
      { recipient_id: friendId },
      { headers: { Authorization: `Bearer ${discordToken}`, "Content-Type": "application/json" } }
    );
    await axios.post(
      `https://discord.com/api/channels/${dm.data.id}/messages`,
      { content: `🎮 Hey! Join me in **${gameName}** on AURA Game Launcher!` },
      { headers: { Authorization: `Bearer ${discordToken}`, "Content-Type": "application/json" } }
    );
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
});

// ── Discord RPC friends ───────────────────────────────────────────────────────
ipcMain.handle("rpc-get-friends", async () => {
  try {
    const data    = await rpc.getRelationships();
    const friends = data.relationships.filter(r => r.type === 1).map(r => ({
      id:       r.user.id,
      username: r.user.username,
      avatar:   r.user.avatar
        ? `https://cdn.discordapp.com/avatars/${r.user.id}/${r.user.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/0.png`,
      status:   r.presence?.status || "offline",
      activity: r.presence?.activities?.[0]?.name || null,
    }));
    return { success: true, friends };
  } catch(e) { return { success: false, error: e.message }; }
});

// ── YouTube trailer ───────────────────────────────────────────────────────────
ipcMain.handle("fetch-trailer", async (_e, title) => auraServer("/api/trailer", { title }));

// ── Clip Recording ────────────────────────────────────────────────────────────
function startRecording(gameName, opts = {}) {
  if (!ffmpegPath) return { success: false, error: "ffmpeg not available" };
  if (isRecording) return { success: false, error: "Already recording" };

  const gameDir = path.join(getClipFolder(), gameName || "General");
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
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
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
    const gameDir = path.join(getClipFolder(), gameName || "General");
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

ipcMain.handle("trim-clip", async (_e, { path: filePath, start, end }) => {
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
        "-preset", "ultrafast",
        "-c:a", "aac",
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

ipcMain.handle("share-clip", async (_e, filePath) => {
  try {
    const FormData = require("form-data");
    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", fs.createReadStream(filePath), {
      filename: path.basename(filePath),
      contentType: filePath.endsWith(".webm") ? "video/webm" : "video/mp4",
    });

    const response = await new Promise((resolve, reject) => {
      const https = require("https");
      const req = https.request({
        hostname: "catbox.moe",
        path: "/user/api.php",
        method: "POST",
        headers: form.getHeaders(),
      }, (res) => {
        let data = "";
        res.on("data", d => data += d);
        res.on("end", () => resolve(data.trim()));
      });
      req.on("error", reject);
      form.pipe(req);
    });

    if (response.startsWith("https://")) {
      console.log("Clip shared:", response);
      return { success: true, url: response };
    } else {
      return { success: false, error: response };
    }
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("save-clip", async (_e, gameName, buffer) => {
  try {
    const gameDir = path.join(getClipFolder(), gameName || "General");
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
  try {
    fs.unlinkSync(filePath);
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("open-clip-folder", async (_e, filePath) => {
  shell.showItemInFolder(filePath);
  return { success: true };
});

ipcMain.handle("rename-clip", async (_e, { oldPath, newName }) => {
  try {
    const dir = path.dirname(oldPath);
    const ext = path.extname(oldPath);
    const newPath = path.join(dir, newName + ext);
    fs.renameSync(oldPath, newPath);
    return { success: true, newPath };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

// ── Register F9 hotkey after window ready ─────────────────────────────────────
function registerHotkeys() {
  // F9 or Ctrl+Alt+R start/stop recording
  globalShortcut.register("F9", toggleRecordingHotkey);
  if (!globalShortcut.register(RECORD_HOTKEY, toggleRecordingHotkey)) {
    console.log("Record hotkey is in use by another app:", RECORD_HOTKEY);
  }

  // F10 toggles AURA Bar visibility
  globalShortcut.register("F10", () => {
    if (!auraBar) return;
    if (auraBar.isVisible()) {
      auraBar.hide();
    } else {
      // showInactive: don't steal focus from the game (that can minimize it)
      auraBar.showInactive();
      auraBar.setAlwaysOnTop(true, "screen-saver");
      auraBar.moveTop();
    }
  });
}


let streamView = null;

// ── Stream full view ──────────────────────────────────────────────────────────
// The Twitch player is a separate layer drawn on top of AURA's page, so when it fills the window
// it also covers AURA's buttons. Two things make sure there is always a way out:
//   - a slim strip at the top is left uncovered, where the page shows "Exit full view"
//   - Esc leaves full view even when the keyboard is inside the Twitch player
const STREAM_BAR = 44; // height of that strip, in page pixels (the page draws a bar the same height)
function fillWindowWithStream() {
  if (!streamView || !mainWin) return;
  const [w, h] = mainWin.getContentSize();
  const bar = Math.round(STREAM_BAR * (mainWin.webContents.getZoomFactor() || 1));
  streamView.setBounds({ x: 0, y: bar, width: w, height: Math.max(1, h - bar) });
}
function leaveStreamFull() {
  if (!streamView || !streamView.__auraFull) return false;
  streamView.__auraFull = false;
  // Straight back to where it was; the page then lines it up exactly
  if (streamView.__auraBefore) { try { streamView.setBounds(streamView.__auraBefore); } catch {} }
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
  if (!view.__auraFull) view.__auraBefore = view.getBounds();
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

ipcMain.handle("stream-set-volume", async (_e, { volume, muted }) => {
  if (!streamView) return { success: false };
  try {
    // Execute JS in the Twitch player to set volume
    await streamView.webContents.executeJavaScript(`
      try {
        const videos = document.querySelectorAll('video');
        videos.forEach(v => {
          v.volume = ${muted ? 0 : volume / 100};
          v.muted = ${muted};
        });
      } catch(e) {}
    `);
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("stream-restore", async (_e, { bounds, chatBounds }) => {
  console.log("stream-restore called, streamView:", !!streamView);
  if (!streamView) return { success: false };
  try {
    if (!mainWin.getBrowserViews().includes(streamView)) {
      mainWin.addBrowserView(streamView);
    }
    streamView.setBounds(zoomBounds(bounds));
    if (mainWin.chatView && chatBounds) {
      if (!mainWin.getBrowserViews().includes(mainWin.chatView)) {
        mainWin.addBrowserView(mainWin.chatView);
      }
      mainWin.chatView.setBounds(zoomBounds(chatBounds));
    }
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("stream-open", async (_e, { channel, bounds }) => {
  if (streamView) {
    mainWin.removeBrowserView(streamView);
    streamView.webContents.destroy();
    streamView = null;
  }
  streamView = new (require("electron").BrowserView)({
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  mainWin.addBrowserView(streamView);
  streamView.setBounds(zoomBounds(bounds));
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

ipcMain.handle("stream-pip", async (_e, bounds) => {
  console.log("stream-pip called, bounds:", bounds, "chatView:", !!mainWin.chatView, "streamView:", !!streamView);
  if (streamView) {
    streamView.setBounds(zoomBounds(bounds));
  }
  // Hide chat in PiP mode
  if (mainWin.chatView) {
    mainWin.removeBrowserView(mainWin.chatView);
  }
  return { success: true };
});

ipcMain.handle("stream-resize", async (_e, bounds) => {
  if (streamView) streamView.setBounds(zoomBounds(bounds));
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
  mainWin.chatView.setBounds(zoomBounds(bounds));
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
function startAuthServer() {
  return new Promise((resolve, reject) => {
    if (authServer) { authServer.close(); authServer = null; }
    authServer = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost:3000");
      if (url.pathname !== "/callback") { res.writeHead(404); res.end(); return; }
      const code = url.searchParams.get("code");
      if (!code) { res.writeHead(400); res.end("No code"); return; }
      try {
        // The AURA server swaps the one-time code for a login (that step needs the Discord secret)
        const tokenRes = await auraServer("/api/discord/token", { code });
        if (!tokenRes.success) throw new Error(tokenRes.error || "Discord login failed.");
        discordToken = tokenRes.access_token;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><body style="background:#222831;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:12px">
          <div style="font-size:48px">✅</div>
          <div style="font-size:20px;font-weight:700">Connected to Discord!</div>
          <div style="font-size:13px;color:#a0a8b4">You can close this tab and return to AURA.</div>
        </body></html>`);
        mainWin?.webContents.send("discord-auth-success");
      } catch(e) {
        res.writeHead(500); res.end("Auth failed: " + e.message);
      }
      authServer.close(); authServer = null;
    });
    authServer.listen(3000, resolve);
    authServer.on("error", reject);
  });
}