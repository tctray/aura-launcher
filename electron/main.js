process.on('uncaughtException', (e) => {
  console.error('CRASH:', e.message, e.stack);
});

const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const http = require("http");
const fs = require("fs");
const vdf = require("@node-steam/vdf");
const axios = require("axios");
const DiscordRPC = require("discord-rpc");

// ── Credentials ───────────────────────────────────────────────────────────────
const DISCORD_CLIENT_ID     = "YOUR_DISCORD_CLIENT_ID";
const DISCORD_CLIENT_SECRET = "YOUR_DISCORD_CLIENT_SECRET";
const DISCORD_REDIRECT_URI  = "http://localhost:3000/callback";
const IGDB_CLIENT_ID        = "YOUR_TWITCH_CLIENT_ID";
const IGDB_CLIENT_SECRET    = "YOUR_TWITCH_CLIENT_SECRET";

let discordToken = null;
let authServer   = null;
let igdbToken    = null;

// ── Auto-updater config ───────────────────────────────────────────────────────
autoUpdater.autoDownload        = false;
autoUpdater.autoInstallOnAppQuit = true;

// ── IGDB / Twitch token ───────────────────────────────────────────────────────
async function getIGDBToken() {
  if (igdbToken) return igdbToken;
  const res = await axios.post(
    `https://id.twitch.tv/oauth2/token?client_id=${IGDB_CLIENT_ID}&client_secret=${IGDB_CLIENT_SECRET}&grant_type=client_credentials`
  );
  igdbToken = res.data.access_token;
  return igdbToken;
}

// ── Create Main Window ────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
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
    },
  });
  win.maximize();
  win.once("ready-to-show", () => win.show());
  const isDev = !app.isPackaged;
  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  setupAutoUpdater(win);
  return win;
}

// ── Auto-updater setup ────────────────────────────────────────────────────────
function setupAutoUpdater(win) {
  if (!app.isPackaged) return; // skip in dev

  autoUpdater.checkForUpdates();

  autoUpdater.on("update-available", (info) => {
    win.webContents.send("update-available", info.version);
  });

  autoUpdater.on("update-not-available", () => {});

  autoUpdater.on("download-progress", (progress) => {
    win.webContents.send("update-progress", progress.percent);
  });

  autoUpdater.on("update-downloaded", () => {
    win.webContents.send("update-ready");
  });

  autoUpdater.on("error", (err) => {
    console.error("AutoUpdater error:", err.message);
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();

  // Auto-update IPC (must be inside whenReady)
  ipcMain.handle("download-update", () => {
    try { autoUpdater.downloadUpdate(); } catch (e) { console.error(e); }
    return { success: true };
  });

  ipcMain.handle("install-update", () => {
    autoUpdater.quitAndInstall(false, true);
  });

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
  console.log("Discord RPC connected!");
  rpc.setActivity({
    details: "Browsing Game Library",
    state: "AURA Game Launcher",
    largeImageKey: "aura_logo",
    startTimestamp: new Date(),
  });
});

rpc.login({ clientId: DISCORD_CLIENT_ID }).catch(e =>
  console.error("RPC login failed:", e.message)
);

// ── Game session tracking ──────────────────────────────────────────────────────
const gameSessions = new Map();

// ── Launch Game ───────────────────────────────────────────────────────────────
ipcMain.handle("launch-game", async (_event, exePath) => {
  try {
    const sessionStart = Date.now();
    const err = await shell.openPath(exePath);
    if (err) return { success: false, error: err };

    gameSessions.set(exePath, sessionStart);

    // Watch for process exit (basic implementation)
    setTimeout(() => {
      if (gameSessions.has(exePath)) {
        const sessionMs = Date.now() - gameSessions.get(exePath);
        gameSessions.delete(exePath);
        const wins = BrowserWindow.getAllWindows();
        if (wins.length > 0) {
          wins[0].webContents.send("game-session-ended", { exePath, sessionMs });
        }
      }
    }, 3000); // simplified — real tracking needs process monitoring

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── File Pickers ──────────────────────────────────────────────────────────────
ipcMain.handle("pick-exe", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select Game Executable",
    filters: [{ name: "Executables", extensions: ["exe"] }],
    properties: ["openFile"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("pick-image", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select Image",
    filters: [{ name: "Images", extensions: ["png","jpg","jpeg","webp","gif"] }],
    properties: ["openFile"],
  });
  if (result.canceled) return null;
  const data = fs.readFileSync(result.filePaths[0]);
  const ext = path.extname(result.filePaths[0]).slice(1).toLowerCase();
  const mime = ext === "jpg" ? "jpeg" : ext;
  return `data:image/${mime};base64,${data.toString("base64")}`;
});

// ── Open External URL ─────────────────────────────────────────────────────────
ipcMain.handle("open-external", async (_event, url) => {
  await shell.openExternal(url);
  return { success: true };
});

// ── Steam Import ──────────────────────────────────────────────────────────────
ipcMain.handle("import-steam", async () => {
  try {
    const steamPath = "C:\\Program Files (x86)\\Steam\\steamapps";
    const vdfPath = steamPath + "\\libraryfolders.vdf";
    const raw = fs.readFileSync(vdfPath, "utf8");
    const parsed = vdf.parse(raw);
    const folders = parsed.libraryfolders;
    const games = [];
    for (const key of Object.keys(folders)) {
      const folder = folders[key];
      if (!folder.path) continue;
      const appsPath = folder.path + "\\steamapps";
      let files;
      try { files = fs.readdirSync(appsPath); } catch { continue; }
      for (const file of files) {
        if (!file.startsWith("appmanifest_") || !file.endsWith(".acf")) continue;
        try {
          const manifest = fs.readFileSync(appsPath + "\\" + file, "utf8");
          const data = vdf.parse(manifest);
          const info = data.AppState;
          if (!info || !info.name || !info.installdir) continue;
          const exeFolder = appsPath + "\\common\\" + info.installdir;
          let exePath = "";
          try {
            const exeFiles = fs.readdirSync(exeFolder).filter(f => f.endsWith(".exe"));
            if (exeFiles.length > 0) exePath = exeFolder + "\\" + exeFiles[0];
          } catch {}
          games.push({ title: info.name, exePath, category: "Other", cover: "" });
        } catch { continue; }
      }
    }
    return { success: true, games };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Epic Games Import ─────────────────────────────────────────────────────────
ipcMain.handle("import-epic", async () => {
  try {
    const manifestPath = "C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests";
    let files;
    try {
      files = fs.readdirSync(manifestPath).filter(f => f.endsWith(".item"));
    } catch {
      return { success: false, error: "Epic Games Launcher not found" };
    }
    const games = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(manifestPath + "\\" + file, "utf8");
        const data = JSON.parse(raw);
        if (!data.DisplayName || !data.InstallLocation) continue;
        let exePath = "";
        if (data.LaunchExecutable) {
          exePath = data.InstallLocation + "\\" + data.LaunchExecutable;
        } else {
          try {
            const exeFiles = fs.readdirSync(data.InstallLocation).filter(f => f.endsWith(".exe"));
            if (exeFiles.length > 0) exePath = data.InstallLocation + "\\" + exeFiles[0];
          } catch {}
        }
        games.push({ title: data.DisplayName, exePath, category: "Other", cover: "" });
      } catch { continue; }
    }
    return { success: true, games };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Xbox Game Pass Import ──────────────────────────────────────────────────────
ipcMain.handle("import-xbox", async () => {
  try {
    const games = [];
    const xboxPath = "C:\\XboxGames";
    if (fs.existsSync(xboxPath)) {
      const folders = fs.readdirSync(xboxPath);
      for (const folder of folders) {
        const folderPath = xboxPath + "\\" + folder;
        try {
          const exeFiles = fs.readdirSync(folderPath).filter(f => f.endsWith(".exe"));
          if (exeFiles.length > 0) {
            games.push({ title: folder, exePath: folderPath + "\\" + exeFiles[0], category: "Other", cover: "" });
          }
        } catch { continue; }
      }
    }
    if (games.length > 0) return { success: true, games };
    return { success: false, error: "No Xbox games found. Make sure Xbox app is installed." };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Xbox Recent Games (OpenXBL) ───────────────────────────────────────────────
ipcMain.handle("xbox-get-recent-games", async () => {
  try {
    const OPENXBL_KEY = "YOUR_OPENXBL_API_KEY";
    const res = await axios.get("https://xbl.io/api/v2/player/titleHistory", {
      headers: { "X-Authorization": OPENXBL_KEY, "Accept": "application/json" },
    });
    const titles = res.data?.titles || res.data?.games || [];
    return { success: true, games: titles };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Xbox Profile ──────────────────────────────────────────────────────────────
ipcMain.handle("xbox-get-profile", async () => {
  try {
    const OPENXBL_KEY = "YOUR_OPENXBL_API_KEY";
    const res = await axios.get("https://xbl.io/api/v2/account", {
      headers: { "X-Authorization": OPENXBL_KEY, "Accept": "application/json" },
    });
    return { success: true, profile: res.data };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── IGDB Cover Art ────────────────────────────────────────────────────────────
ipcMain.handle("fetch-cover-art", async (_event, title) => {
  try {
    const token = await getIGDBToken();
    const res = await axios.post(
      "https://api.igdb.com/v4/games",
      `search "${title}"; fields name,cover.image_id; limit 1;`,
      { headers: { "Client-ID": IGDB_CLIENT_ID, Authorization: `Bearer ${token}`, "Content-Type": "text/plain" } }
    );
    if (!res.data?.length || !res.data[0]?.cover?.image_id) {
      return { success: false, error: "No cover found" };
    }
    return {
      success: true,
      url: `https://images.igdb.com/igdb/image/upload/t_cover_big/${res.data[0].cover.image_id}.webp`,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("fetch-covers-bulk", async (_event, games) => {
  try {
    const token = await getIGDBToken();
    const covers = {};
    for (const game of games) {
      try {
        const res = await axios.post(
          "https://api.igdb.com/v4/games",
          `search "${game.title}"; fields name,cover.image_id; limit 1;`,
          { headers: { "Client-ID": IGDB_CLIENT_ID, Authorization: `Bearer ${token}`, "Content-Type": "text/plain" } }
        );
        if (res.data?.length && res.data[0]?.cover?.image_id) {
          covers[game.id] = `https://images.igdb.com/igdb/image/upload/t_cover_big/${res.data[0].cover.image_id}.webp`;
        }
      } catch {}
    }
    return { success: true, covers };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Twitch Live Streams ────────────────────────────────────────────────────────
ipcMain.handle("fetch-twitch-streams", async (_event, { gameNames, userLogins }) => {
  try {
    const token = await getIGDBToken();
    let gameIds = [];
    if (gameNames && gameNames.length > 0) {
      const gamesRes = await axios.get("https://api.twitch.tv/helix/games", {
        headers: { "Client-ID": IGDB_CLIENT_ID, Authorization: `Bearer ${token}` },
        params: { name: gameNames.slice(0, 10) },
      });
      gameIds = (gamesRes.data?.data || []).map(g => g.id);
    }
    const params = new URLSearchParams();
    params.append("first", "20");
    gameIds.forEach(id => params.append("game_id", id));
    if (userLogins?.length) userLogins.slice(0, 10).forEach(u => params.append("user_login", u.trim()));
    const streamsRes = await axios.get(`https://api.twitch.tv/helix/streams?${params.toString()}`, {
      headers: { "Client-ID": IGDB_CLIENT_ID, Authorization: `Bearer ${token}` },
    });
    const streams = (streamsRes.data?.data || []).map(s => ({
      id: s.id,
      user: s.user_name,
      title: s.title,
      game: s.game_name,
      viewers: s.viewer_count,
      thumbnail: s.thumbnail_url.replace("{width}", "440").replace("{height}", "248"),
      url: `https://twitch.tv/${s.user_login}`,
    }));
    return { success: true, streams };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Steam API ─────────────────────────────────────────────────────────────────
ipcMain.handle("steam-get-profile", async (_event, steamId) => {
  try {
    const STEAM_API_KEY = "YOUR_STEAM_API_KEY";
    const res = await axios.get(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamId}`);
    const players = res.data?.response?.players;
    if (!players?.length) return { success: false, error: "Profile not found" };
    return { success: true, player: players[0] };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("steam-get-playtime", async (_event, steamId) => {
  try {
    const STEAM_API_KEY = "YOUR_STEAM_API_KEY";
    const res = await axios.get(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${STEAM_API_KEY}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true`);
    return { success: true, games: res.data?.response?.games || [] };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("steam-get-friends-profiles", async (_event, steamId) => {
  try {
    const STEAM_API_KEY = "YOUR_STEAM_API_KEY";
    const friendsRes = await axios.get(`https://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=${STEAM_API_KEY}&steamid=${steamId}&relationship=friend`);
    const friendIds = (friendsRes.data?.friendslist?.friends || []).map(f => f.steamid).slice(0, 100).join(",");
    if (!friendIds) return { success: true, friends: [] };
    const summRes = await axios.get(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${friendIds}`);
    const friends = (summRes.data?.response?.players || []).map(p => ({
      id: p.steamid,
      username: p.personaname,
      avatar: p.avatarmedium,
      status: p.personastate > 0 ? "online" : "offline",
      activity: p.gameextrainfo || null,
    }));
    return { success: true, friends };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Discord OAuth ─────────────────────────────────────────────────────────────
ipcMain.handle("discord-login", async () => {
  try {
    await startAuthServer();
    const authUrl = `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback&scope=identify`;
    await shell.openExternal(authUrl);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("discord-logout", async () => { discordToken = null; return { success: true }; });

ipcMain.handle("discord-get-user", async () => {
  if (!discordToken) return { success: false, error: "Not logged in" };
  try {
    const res = await axios.get("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${discordToken}` } });
    return { success: true, user: res.data };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle("discord-get-friends", async () => {
  if (!discordToken) return { success: false, error: "Not logged in" };
  try {
    const res = await axios.get("https://discord.com/api/users/@me/relationships", { headers: { Authorization: `Bearer ${discordToken}` } });
    const friends = res.data.filter(r => r.type === 1).map(r => ({
      id: r.id,
      username: r.user.username,
      avatar: r.user.avatar ? `https://cdn.discordapp.com/avatars/${r.user.id}/${r.user.avatar}.png` : `https://cdn.discordapp.com/embed/avatars/0.png`,
      status: r.presence?.status || "offline",
      activity: r.presence?.activities?.[0]?.name || null,
    }));
    return { success: true, friends };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle("discord-invite-friend", async (_event, friendId, gameName) => {
  if (!discordToken) return { success: false, error: "Not logged in" };
  try {
    const dmRes = await axios.post(
      "https://discord.com/api/users/@me/channels",
      { recipient_id: friendId },
      { headers: { Authorization: `Bearer ${discordToken}`, "Content-Type": "application/json" } }
    );
    const channelId = dmRes.data.id;
    await axios.post(
      `https://discord.com/api/channels/${channelId}/messages`,
      { content: `🎮 Hey! Join me in **${gameName}** — playing via AURA Game Launcher!` },
      { headers: { Authorization: `Bearer ${discordToken}`, "Content-Type": "application/json" } }
    );
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── RPC Friends ───────────────────────────────────────────────────────────────
ipcMain.handle("rpc-get-friends", async () => {
  try {
    const data = await rpc.getRelationships();
    const friends = data.relationships.filter(r => r.type === 1).map(r => ({
      id: r.user.id,
      username: r.user.username,
      avatar: r.user.avatar ? `https://cdn.discordapp.com/avatars/${r.user.id}/${r.user.avatar}.png` : `https://cdn.discordapp.com/embed/avatars/0.png`,
      status: r.presence?.status || "offline",
      activity: r.presence?.activities?.[0]?.name || null,
    }));
    return { success: true, friends };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── YouTube Trailer ───────────────────────────────────────────────────────────
ipcMain.handle("fetch-trailer", async (_event, title) => {
  try {
    const query = encodeURIComponent(`${title} official game trailer`);
    const res = await axios.get(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&maxResults=1&key=YOUR_YOUTUBE_API_KEY`);
    const videoId = res.data?.items?.[0]?.id?.videoId;
    if (!videoId) return { success: false, error: "No trailer found" };
    return { success: true, videoId };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Update checker (legacy button support) ────────────────────────────────────
ipcMain.handle("check-update", async () => {
  try {
    const res = await axios.get("https://api.github.com/repos/tctray/aura-launcher/releases/latest");
    const latest = res.data.tag_name?.replace(/^v/, "");
    const current = app.getVersion();
    const hasUpdate = latest !== current;
    return { success: true, latest, current, hasUpdate };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── OAuth Callback Server ─────────────────────────────────────────────────────
function startAuthServer() {
  return new Promise((resolve, reject) => {
    if (authServer) { authServer.close(); authServer = null; }
    authServer = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost:3000");
      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        if (!code) { res.writeHead(400); res.end("No code received"); return; }
        try {
          const tokenRes = await axios.post(
            "https://discord.com/api/oauth2/token",
            new URLSearchParams({ client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: DISCORD_REDIRECT_URI }),
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
          );
          discordToken = tokenRes.data.access_token;
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`<html><body style="background:#222831;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:12px;"><div style="font-size:48px">✅</div><div style="font-size:20px;font-weight:700">Connected to Discord!</div><div style="font-size:13px;color:#a0a8b4">You can close this tab and return to AURA.</div></body></html>`);
          BrowserWindow.getAllWindows()[0]?.webContents.send("discord-auth-success");
        } catch (e) { res.writeHead(500); res.end("Auth failed: " + e.message); }
        authServer.close(); authServer = null;
      } else { res.writeHead(404); res.end("Not found"); }
    });
    authServer.listen(3000, () => resolve());
    authServer.on("error", reject);
  });
}