process.on('uncaughtException', (e) => {
  console.error('CRASH:', e.message, e.stack);
});

const path = require("path");
const fs   = require("fs");
const { app, BrowserWindow, ipcMain, shell, dialog, globalShortcut } = require("electron");

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



// ── Credentials from .env ─────────────────────────────────────────────────────
// Never hardcode these — keep them in electron/.env or your project root .env
const DISCORD_CLIENT_ID     = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI  = "http://localhost:3000/callback";
const IGDB_CLIENT_ID        = process.env.TWITCH_CLIENT_ID;
const IGDB_CLIENT_SECRET    = process.env.TWITCH_CLIENT_SECRET;
const STEAM_API_KEY         = process.env.STEAM_API_KEY;
const OPENXBL_KEY           = process.env.OPENXBL_KEY;
const YOUTUBE_API_KEY       = process.env.YOUTUBE_API_KEY;

let discordToken  = null;
let authServer    = null;
let igdbToken     = null;
let igdbTokenExp  = 0;
let mainWin       = null;

// ── Auto-updater ──────────────────────────────────────────────────────────────
autoUpdater.autoDownload         = false;
autoUpdater.autoInstallOnAppQuit = true;

// ── IGDB/Twitch token — refreshes when expired ────────────────────────────────
async function getIGDBToken() {
  if (igdbToken && Date.now() < igdbTokenExp) return igdbToken;
  const res = await axios.post(
    `https://id.twitch.tv/oauth2/token?client_id=${IGDB_CLIENT_ID}&client_secret=${IGDB_CLIENT_SECRET}&grant_type=client_credentials`
  );
  igdbToken    = res.data.access_token;
  igdbTokenExp = Date.now() + (res.data.expires_in - 300) * 1000; // 5min buffer
  return igdbToken;
}

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
      allowRunningInsecureContent: true,
      sandbox: false,
    },
  });

  mainWin.maximize();
  mainWin.once("ready-to-show", () => mainWin.show());

  // Allow getUserMedia with desktop capture source
  mainWin.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    // Allow all media permissions including microphone
    const allowed = ["media", "audioCapture", "desktopCapture", "mediaKeySystem"];
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

function createAuraBar() {
  const { screen } = require("electron");
  const { width } = screen.getPrimaryDisplay().workAreaSize;

  auraBar = new BrowserWindow({
    width: Math.round(width * 0.4),
    height: 48,
    x: Math.round(width * 0.3),
    y: 20,
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
  isRecording: !!global.pipeChunks,
  clipServerPort: global.clipServerPort,
  clipServerToken: global.clipServerToken,
}));

// Forward recording events to bar
function notifyBar(channel, data) {
  auraBar?.webContents.send(channel, data);
}

app.whenReady().then(() => {
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

  createWindow();
  createAuraBar();
  registerHotkeys();

  ipcMain.handle("download-update", () => {
    try { autoUpdater.downloadUpdate(); } catch(e) { console.error(e); }
    return { success: true };
  });
  ipcMain.handle("install-update", () => autoUpdater.quitAndInstall(false, true));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
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

// ── Launch Game ───────────────────────────────────────────────────────────────
const gameSessions = new Map();

ipcMain.handle("launch-game", async (_e, exePath) => {
  try {
    const err = await shell.openPath(exePath);
    if (err) return { success: false, error: err };
    gameSessions.set(exePath, Date.now());
    // Update RPC to show what game is being played
    rpc.setActivity({
      details: `Playing ${path.basename(exePath, ".exe")}`,
      state:   "AURA Game Launcher",
      largeImageKey: "aura_logo",
      startTimestamp: new Date(),
    }).catch(() => {});
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

ipcMain.handle("xbox-get-profile", async () => {
  try {
    const res = await axios.get("https://xbl.io/api/v2/account", {
      headers: { "X-Authorization": OPENXBL_KEY, Accept: "application/json" },
    });
    return { success: true, profile: res.data };
  } catch(e) { return { success: false, error: e.message }; }
});

ipcMain.handle("xbox-get-recent-games", async () => {
  try {
    const res = await axios.get("https://xbl.io/api/v2/player/titleHistory", {
      headers: { "X-Authorization": OPENXBL_KEY, Accept: "application/json" },
    });
    const titles = res.data?.titles || res.data?.games || [];
    return { success: true, games: titles };
  } catch(e) { return { success: false, error: e.message }; }
});

// ── IGDB cover art ────────────────────────────────────────────────────────────
ipcMain.handle("fetch-cover-art", async (_e, title) => {
  try {
    const token = await getIGDBToken();
    const res   = await axios.post(
      "https://api.igdb.com/v4/games",
      `search "${title}"; fields name,cover.image_id; limit 1;`,
      { headers: { "Client-ID": IGDB_CLIENT_ID, Authorization: `Bearer ${token}`, "Content-Type": "text/plain" } }
    );
    const imageId = res.data?.[0]?.cover?.image_id;
    if (!imageId) return { success: false, error: "No cover found" };
    return { success: true, url: `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.webp` };
  } catch(e) { return { success: false, error: e.message }; }
});

ipcMain.handle("fetch-covers-bulk", async (_e, games) => {
  try {
    const token  = await getIGDBToken();
    const covers = {};
    for (const game of games) {
      try {
        const res = await axios.post(
          "https://api.igdb.com/v4/games",
          `search "${game.title}"; fields name,cover.image_id; limit 1;`,
          { headers: { "Client-ID": IGDB_CLIENT_ID, Authorization: `Bearer ${token}`, "Content-Type": "text/plain" } }
        );
        const imageId = res.data?.[0]?.cover?.image_id;
        if (imageId) covers[game.id] = `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.webp`;
      } catch {}
    }
    return { success: true, covers };
  } catch(e) { return { success: false, error: e.message }; }
});

// ── Twitch live streams ────────────────────────────────────────────────────────
ipcMain.handle("fetch-twitch-streams", async (_e, { gameNames, userLogins }) => {
  try {
    const token   = await getIGDBToken();
    let gameIds   = [];

    if (gameNames?.length) {
      // Batch game name lookups
      for (const name of gameNames.slice(0, 10)) {
        try {
          const r = await axios.get("https://api.twitch.tv/helix/games", {
            headers: { "Client-ID": IGDB_CLIENT_ID, Authorization: `Bearer ${token}` },
            params:  { name },
          });
          const id = r.data?.data?.[0]?.id;
          if (id) gameIds.push(id);
        } catch {}
      }
    }

    const params = new URLSearchParams();
    params.append("first", "20");
    gameIds.forEach(id  => params.append("game_id",   id));
    userLogins?.slice(0, 10).forEach(u => params.append("user_login", u.trim().toLowerCase()));

    const r = await axios.get(`https://api.twitch.tv/helix/streams?${params}`, {
      headers: { "Client-ID": IGDB_CLIENT_ID, Authorization: `Bearer ${token}` },
    });

    const streams = (r.data?.data || []).map(s => ({
      id:        s.id,
      user:      s.user_name,
      userLogin: s.user_login,
      title:     s.title,
      game:      s.game_name,
      viewers:   s.viewer_count,
      thumbnail: s.thumbnail_url.replace("{width}", "440").replace("{height}", "248"),
      url:       `https://twitch.tv/${s.user_login}`,
    }));

    return { success: true, streams };
  } catch(e) {
    console.error("Twitch streams error:", e.message);
    return { success: false, error: e.message };
  }
});

ipcMain.handle("search-twitch", async (_e, { query, type }) => {
  // type: "streams" | "channels" | "games"
  try {
    const token = await getIGDBToken();

    if (type === "games") {
      const r = await axios.get("https://api.twitch.tv/helix/search/categories", {
        headers: { "Client-ID": IGDB_CLIENT_ID, Authorization: `Bearer ${token}` },
        params: { query, first: 10 },
      });
      return { success: true, results: (r.data?.data || []).map(g => ({
        id: g.id, name: g.name, thumbnail: g.box_art_url?.replace("{width}","140").replace("{height}","190"),
      }))};
    }

    if (type === "channels") {
      const r = await axios.get("https://api.twitch.tv/helix/search/channels", {
        headers: { "Client-ID": IGDB_CLIENT_ID, Authorization: `Bearer ${token}` },
        params: { query, first: 20 },
      });
      return { success: true, results: (r.data?.data || []).map(c => ({
        id: c.id, name: c.display_name, login: c.broadcaster_login,
        thumbnail: c.thumbnail_url, game: c.game_name, isLive: c.is_live,
        title: c.title,
      }))};
    }

    // Default: search streams by game name or channel
    const [chanRes, gameRes] = await Promise.allSettled([
      axios.get("https://api.twitch.tv/helix/search/channels", {
        headers: { "Client-ID": IGDB_CLIENT_ID, Authorization: `Bearer ${token}` },
        params: { query, first: 10 },
      }),
      axios.get("https://api.twitch.tv/helix/search/categories", {
        headers: { "Client-ID": IGDB_CLIENT_ID, Authorization: `Bearer ${token}` },
        params: { query, first: 5 },
      }),
    ]);

    const channels = chanRes.status === "fulfilled"
      ? (chanRes.value.data?.data || []).map(c => ({
          id: c.id, name: c.display_name, login: c.broadcaster_login,
          thumbnail: c.thumbnail_url, game: c.game_name, isLive: c.is_live, title: c.title,
        }))
      : [];

    const games = gameRes.status === "fulfilled"
      ? (gameRes.value.data?.data || []).map(g => ({
          id: g.id, name: g.name, thumbnail: g.box_art_url?.replace("{width}","140").replace("{height}","190"),
        }))
      : [];

    // If game found, also fetch live streams for it
    let gameStreams = [];
    if (games.length) {
      try {
        const params = new URLSearchParams();
        params.append("first", "10");
        games.slice(0, 3).forEach(g => params.append("game_id", g.id));
        const sr = await axios.get(`https://api.twitch.tv/helix/streams?${params}`, {
          headers: { "Client-ID": IGDB_CLIENT_ID, Authorization: `Bearer ${token}` },
        });
        gameStreams = (sr.data?.data || []).map(s => ({
          id: s.id, user: s.user_name, userLogin: s.user_login,
          title: s.title, game: s.game_name, viewers: s.viewer_count,
          thumbnail: s.thumbnail_url.replace("{width}","440").replace("{height}","248"),
          url: `https://twitch.tv/${s.user_login}`,
        }));
      } catch {}
    }

    return { success: true, channels, games, gameStreams };
  } catch(e) {
    return { success: false, error: e.message };
  }
});


ipcMain.handle("steam-get-profile", async (_e, steamId) => {
  try {
    const res = await axios.get(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamId}`
    );
    const players = res.data?.response?.players;
    if (!players?.length) return { success: false, error: "Profile not found" };
    return { success: true, player: players[0] };
  } catch(e) { return { success: false, error: e.message }; }
});

ipcMain.handle("steam-get-playtime", async (_e, steamId) => {
  try {
    const res = await axios.get(
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${STEAM_API_KEY}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true`
    );
    return { success: true, games: res.data?.response?.games || [] };
  } catch(e) { return { success: false, error: e.message }; }
});

ipcMain.handle("steam-get-friends-profiles", async (_e, steamId) => {
  try {
    const fr = await axios.get(
      `https://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=${STEAM_API_KEY}&steamid=${steamId}&relationship=friend`
    );
    const ids = (fr.data?.friendslist?.friends || []).map(f => f.steamid).slice(0, 100).join(",");
    if (!ids) return { success: true, friends: [] };
    const sr = await axios.get(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${ids}`
    );
    const friends = (sr.data?.response?.players || []).map(p => ({
      id:       p.steamid,
      username: p.personaname,
      avatar:   p.avatarmedium,
      status:   p.personastate > 0 ? "online" : "offline",
      activity: p.gameextrainfo || null,
    }));
    return { success: true, friends };
  } catch(e) { return { success: false, error: e.message }; }
});

// ── Discord OAuth ─────────────────────────────────────────────────────────────
ipcMain.handle("discord-login", async () => {
  try {
    await startAuthServer();
    const authUrl = `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&scope=identify%20relationships.read`;
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
ipcMain.handle("fetch-trailer", async (_e, title) => {
  try {
    const q   = encodeURIComponent(`${title} official game trailer`);
    const res = await axios.get(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${q}&type=video&maxResults=1&key=${YOUTUBE_API_KEY}`
    );
    const videoId = res.data?.items?.[0]?.id?.videoId;
    if (!videoId) return { success: false, error: "No trailer found" };
    return { success: true, videoId };
  } catch(e) { return { success: false, error: e.message }; }
});

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

  const micDevice = opts.micDevice || "Microphone (Arctis Nova 7 Gen 2)";
  const systemAudio = opts.systemDevice || "Stereo Mix (Realtek(R) Audio)";

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
    "-filter_complex", "[1:a][2:a]amix=inputs=2:duration=longest[aout]",
    "-map", "0:v",
    "-map", "[aout]",
    "-vcodec", "libx264",
    "-preset", "ultrafast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-acodec", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
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

    recordingProcess.on("close", (code) => {
      console.log("ffmpeg closed:", code);
      isRecording = false;
      recordingProcess = null;
      mainWin?.webContents.send("recording-stopped", { file: outFile, game: recordingGame });
      auraBar?.webContents.send("recording-stopped");
    });

    recordingProcess.stderr.on("data", (data) => {
      console.log("ffmpeg:", data.toString().slice(0, 200));
    });

    mainWin?.webContents.send("recording-started", { game: recordingGame, file: outFile });
    auraBar?.webContents.send("recording-started");
    return { success: true, file: outFile, game: recordingGame };
  } catch(e) {
    console.error("Recording error:", e.message);
    return { success: false, error: e.message };
  }
}


function stopRecording() {
  if (!isRecording || !recordingProcess) return { success: false, error: "Not recording" };
  try {
    recordingProcess.stdin.write("q");
  } catch {}
  setTimeout(() => {
    if (recordingProcess) recordingProcess.kill("SIGKILL");
  }, 2000);
  isRecording = false;
  return { success: true };
}

// Get available audio devices
ipcMain.handle("get-audio-devices", async () => {
  if (!ffmpegPath) return { success: false, devices: [] };
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
    console.log("Audio devices found:", devices);
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

ipcMain.handle("start-ffmpeg-pipe", async (_e, gameName) => {
  try {
    const gameDir = path.join(getClipFolder(), gameName || "General");
    ensureDir(gameDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    pipeOutFile = path.join(gameDir, `clip-${timestamp}.mp4`);
    const webmFile = pipeOutFile.replace(".mp4", ".webm");
    global.pipeWebmFile = webmFile;
    global.pipeChunks = [];
    console.log("Recording to webm:", webmFile);
    // Notify bar recording started
    auraBar?.webContents.send("recording-started");
    return { success: true, file: pipeOutFile };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("pipe-to-ffmpeg", (_e, buffer) => {
  if (global.pipeChunks) {
    global.pipeChunks.push(Buffer.from(buffer));
  }
  return { success: true };
});

ipcMain.handle("stop-ffmpeg-pipe", async () => {
  try {
    if (!global.pipeChunks || !global.pipeWebmFile) return { success: false };
    const webmFile = global.pipeWebmFile;
    const outFile = webmFile.replace(".webm", ".mp4");

    // Write all chunks to webm file
    const combined = Buffer.concat(global.pipeChunks);
    fs.writeFileSync(webmFile, combined);
    global.pipeChunks = [];
    console.log("Webm saved:", webmFile, combined.length, "bytes");

    // Convert webm to mp4 with ffmpeg
    const args = [
      "-i", webmFile,
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      "-y",
      outFile
    ];

    await new Promise((resolve) => {
      const proc = spawn(ffmpegPath, args, { windowsHide: true });
      proc.stderr.on("data", d => console.log("convert:", d.toString().slice(0, 100)));
      proc.on("close", (code) => {
        console.log("convert closed:", code, "->", outFile);
        // Delete temp webm
        try { fs.unlinkSync(webmFile); } catch {}
        resolve(code);
      });
    });

    mainWin?.webContents.send("recording-stopped", { file: outFile });
    auraBar?.webContents.send("recording-stopped");
    return { success: true };
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
  globalShortcut.register("F9", () => {
    if (isRecording) {
      stopRecording();
      mainWin?.webContents.send("recording-hotkey", "stop");
      auraBar?.webContents.send("recording-hotkey", "stop");
    } else {
      const currentGame = recordingGame || "General";
      startRecording(currentGame);
      mainWin?.webContents.send("recording-hotkey", "start");
      auraBar?.webContents.send("recording-hotkey", "start");
    }
  });

  // F10 toggles AURA Bar visibility
  globalShortcut.register("F10", () => {
    if (!auraBar) return;
    if (auraBar.isVisible()) {
      auraBar.hide();
    } else {
      auraBar.show();
      auraBar.focus();
    }
  });
}


let streamView = null;

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
  streamView.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
  streamView.setAutoResize({ width: false, height: false });
  streamView.webContents.loadURL(
    `https://player.twitch.tv/?channel=${channel}&parent=aura-launcher&autoplay=true&muted=false`
  );
  return { success: true };
});

ipcMain.handle("focus-main", () => {
  mainWin?.show();
  mainWin?.focus();
  return { success: true };
});

ipcMain.handle("get-window-pos", (_e) => {
  // Return position of the calling window (auraBar)
  const pos = auraBar?.getPosition() || [0, 0];
  return { x: pos[0], y: pos[1] };
});

ipcMain.handle("stop-bar-recording", () => {
  mainWin?.webContents.send("bar-stop-recording");
  return { success: true };
});

ipcMain.handle("toggle-recording", async () => {
  // Focus main window and send toggle
  mainWin?.show();
  mainWin?.focus();
  mainWin?.webContents.send("bar-toggle-recording");
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

ipcMain.handle("take-screenshot", async () => {
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
});

ipcMain.handle("stream-pip", async (_e, bounds) => {
  if (streamView) {
    streamView.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) });
  }
  return { success: true };
});

ipcMain.handle("stream-resize", async (_e, bounds) => {
  if (streamView) streamView.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
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
  mainWin.chatView.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
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
    return { success: true, latest, current, hasUpdate: latest !== current };
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
        const tokenRes = await axios.post(
          "https://discord.com/api/oauth2/token",
          new URLSearchParams({
            client_id:     DISCORD_CLIENT_ID,
            client_secret: DISCORD_CLIENT_SECRET,
            grant_type:    "authorization_code",
            code,
            redirect_uri:  DISCORD_REDIRECT_URI,
          }),
          { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );
        discordToken = tokenRes.data.access_token;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><body style="background:#222831;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:12px">
          <div style="font-size:48px">✅</div>
          <div style="font-size:20px;font-weight:700">Connected to Discord!</div>
          <div style="font-size:13px;color:#a0a8b4">You can close this tab and return to AURA.</div>
        </body></html>`);
        BrowserWindow.getAllWindows()[0]?.webContents.send("discord-auth-success");
      } catch(e) {
        res.writeHead(500); res.end("Auth failed: " + e.message);
      }
      authServer.close(); authServer = null;
    });
    authServer.listen(3000, resolve);
    authServer.on("error", reject);
  });
}