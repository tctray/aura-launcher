process.on('uncaughtException', (e) => {
  console.error('CRASH:', e.message, e.stack);
});

const path = require("path");
const fs   = require("fs");
const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");

// Dev only — in production, credentials are injected by GitHub Actions Secrets
if (!app.isPackaged) {
  const devEnv = path.join(__dirname, "../.env");
  if (fs.existsSync(devEnv)) require("dotenv").config({ path: devEnv });
}

const { autoUpdater } = require("electron-updater");
const path = require("path");
const http = require("http");
const fs = require("fs");
const vdf = require("@node-steam/vdf");
const axios = require("axios");
const DiscordRPC = require("discord-rpc");
const Registry = require("winreg");

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
      webSecurity: false, // needed for Twitch embeds in file:// context
    },
  });

  mainWin.maximize();
  mainWin.once("ready-to-show", () => mainWin.show());

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

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();

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

// ── Steam API ─────────────────────────────────────────────────────────────────
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

// ── Update check (legacy) ─────────────────────────────────────────────────────
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