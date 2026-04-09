// Load .env manually
const _env = require("fs").readFileSync(require("path").join(__dirname, "../.env"), "utf8");
_env.split("\n").forEach(line => {
  const [key, ...vals] = line.trim().split("=");
  if (key && !key.startsWith("#")) process.env[key.trim()] = vals.join("=").trim();
});

process.on('uncaughtException', (e) => {  
  console.error('CRASH:', e.message, e.stack);
});
const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");
const vdf = require("@node-steam/vdf");
const axios = require("axios");
const DiscordRPC = require("discord-rpc");
const { spawn } = require("child_process");

const DISCORD_REDIRECT_URI = "http://localhost:3000/callback";
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const IGDB_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const IGDB_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

let discordToken = null;
let authServer = null;

// ── Create Main Window ─────────────────────────────────────────────────────────
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
  return win;
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── Discord RPC ────────────────────────────────────────────────────────────────
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

console.log("Attempting Discord RPC login with ID:", DISCORD_CLIENT_ID);
rpc.login({ clientId: DISCORD_CLIENT_ID }).catch(e => console.error("RPC login failed:", e.message));

// ── Launch Game ────────────────────────────────────────────────────────────────
ipcMain.handle("launch-game", async (_event, exePath) => {
  try {
    const startTime = Date.now();
    const child = spawn(exePath, [], {
      detached: true,
      stdio: "ignore",
      cwd: require("path").dirname(exePath),
    });
    child.unref();

    return new Promise((resolve) => {
      child.on("spawn", () => {
        console.log("Game launched:", exePath);
      });

      child.on("close", (code) => {
        const endTime = Date.now();
        const sessionMs = endTime - startTime;
        console.log("Game closed, session:", sessionMs);

        const wins = BrowserWindow.getAllWindows();
        if (wins.length > 0) {
          wins[0].webContents.send("game-session-ended", {
            exePath,
            sessionMs,
            startTime,
            endTime,
          });
        }
        resolve({ success: true, sessionMs });
      });

      child.on("error", (e) => {
        resolve({ success: false, error: e.message });
      });

      // Resolve immediately so UI doesn't hang waiting
      setTimeout(() => resolve({ success: true, sessionMs: 0 }), 1000);
    });
  } catch (e) {
    return { success: false, error: e.message };
  }
});

/*Youtube API*/
ipcMain.handle("fetch-trailer", async (_event, gameTitle) => {
  try {
    const res = await axios.get("https://www.googleapis.com/youtube/v3/search", {
      params: {
        key: process.env.YOUTUBE_API_KEY,
        q: `${gameTitle} official trailer`,
        part: "snippet",
        type: "video",
        maxResults: 1,
      }
    });
    const item = res.data.items[0];
    if (!item) return { success: false, error: "No trailer found" };
    return { success: true, videoId: item.id.videoId, title: item.snippet.title };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

/*Steam API*/
ipcMain.handle("steam-get-profile", async (_event, steamId) => {
  try {
    const res = await axios.get("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/", {
      params: {
        key: process.env.STEAM_API_KEY,
        steamids: steamId,
      }
    });
    const player = res.data.response.players[0];
    if (!player) return { success: false, error: "Player not found" };
    return { success: true, player };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("steam-get-friends", async (_event, steamId) => {
  try {
    const res = await axios.get("https://api.steampowered.com/ISteamUser/GetFriendList/v1/", {
      params: {
        key: process.env.STEAM_API_KEY,
        steamid: steamId,
        relationship: "friend",
      }
    });
    const friends = res.data.friendslist.friends;
    return { success: true, friends };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("steam-get-playtime", async (_event, steamId) => {
  try {
    const res = await axios.get("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/", {
      params: {
        key: process.env.STEAM_API_KEY,
        steamid: steamId,
        include_appinfo: true,
        include_played_free_games: true,
      }
    });
    const games = res.data.response.games || [];
    return { success: true, games };
  } catch(e) {
    return { success: false, error: e.message };
  }
});


ipcMain.handle("steam-get-friends-profiles", async (_event, steamId) => {
  console.log("steam-get-friends-profiles called with:", steamId);
  try {
    const friendsRes = await axios.get("https://api.steampowered.com/ISteamUser/GetFriendList/v1/", {
      params: { key: process.env.STEAM_API_KEY, steamid: steamId, relationship: "friend" }
    });
    console.log("Friends API response:", JSON.stringify(friendsRes.data));
    const friendIds = friendsRes.data.friendslist.friends.map(f => f.steamid).slice(0, 100);
    if (friendIds.length === 0) return { success: true, friends: [] };

    const profilesRes = await axios.get("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/", {
      params: { key: process.env.STEAM_API_KEY, steamids: friendIds.join(",") }
    });
    const friends = profilesRes.data.response.players.map(p => ({
      id: p.steamid,
      username: p.personaname,
      avatar: p.avatarmedium,
      status: p.personastate === 0 ? "offline" : "online",
      activity: p.gameextrainfo || null,
    })).sort((a,b) => a.status === "online" ? -1 : 1);

    return { success: true, friends };
  } catch(e) {
    console.log("Steam friends error:", e.message);
    return { success: false, error: e.message };
  }
});

ipcMain.handle("xbox-get-profile", async () => {
  try {
    const res = await axios.get("https://xbl.io/api/v2/account", {
      headers: { "x-authorization": process.env.OPENXBL_API_KEY }
    });
    return { success: true, profile: res.data };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("xbox-get-achievements", async (_event, titleId) => {
  try {
    const res = await axios.get(`https://xbl.io/api/v2/achievements/title/${titleId}`, {
      headers: { "x-authorization": process.env.OPENXBL_API_KEY }
    });
    return { success: true, achievements: res.data };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("xbox-get-recent-games", async () => {
  try {
    const res = await axios.get("https://xbl.io/api/v2/achievements", {
      headers: { "x-authorization": process.env.OPENXBL_API_KEY }
    });
    return { success: true, games: res.data };
  } catch(e) {
    return { success: false, error: e.message };
  }
});
// ── File Picker ────────────────────────────────────────────────────────────────
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
    title: "Select Avatar Image",
    filters: [{ name: "Images", extensions: ["jpg","jpeg","png","gif","webp"] }],
    properties: ["openFile"],
  });
  if (result.canceled) return null;
  const imgPath = result.filePaths[0];
  // Convert to base64 so it can be stored and displayed
  const data = fs.readFileSync(imgPath);
  const ext = imgPath.split(".").pop().toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
  return `data:${mime};base64,${data.toString("base64")}`;
});

/*Update Button*/
ipcMain.handle("check-update", async () => {
  try {
    const res = await axios.get("https://api.github.com/repos/tctray/aura-launcher/releases/latest",
      { headers: { "User-Agent": "AURA-Launcher" } }
    );
    const latest = res.data.tag_name.replace("v","");
    const current = require("../package.json").version;
    return { success:true, latest, current, hasUpdate: latest !== current };
  } catch(e) {
    return { success:false, error:e.message };
  }
});

ipcMain.handle("open-external", async (_event, url) => {
  await shell.openExternal(url);
  return { success: true };
});
/*end*/
// ── Steam Import ───────────────────────────────────────────────────────────────
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

// ── Epic Games Import ──────────────────────────────────────────────────────────
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

        // Find the exe in the install folder
        let exePath = "";
        if (data.LaunchExecutable) {
          exePath = data.InstallLocation + "\\" + data.LaunchExecutable;
        } else {
          try {
            const exeFiles = fs.readdirSync(data.InstallLocation)
              .filter(f => f.endsWith(".exe"));
            if (exeFiles.length > 0) {
              exePath = data.InstallLocation + "\\" + exeFiles[0];
            }
          } catch {}
        }

        games.push({
          title: data.DisplayName,
          exePath,
          category: "Other",
          cover: "",
        });
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
    const Database = require("better-sqlite3");

    // Xbox stores game info in the Gaming Services app data
    const localAppData = process.env.LOCALAPPDATA;
    const possiblePaths = [
      localAppData + "\\Packages\\Microsoft.GamingApp_8wekyb3d8bbwe\\LocalState\\XboxGameBarData.db",
      localAppData + "\\Packages\\Microsoft.XboxApp_8wekyb3d8bbwe\\LocalState\\XboxGameBarData.db",
    ];

    let db = null;
    for (const dbPath of possiblePaths) {
      if (fs.existsSync(dbPath)) {
        db = new Database(dbPath, { readonly: true });
        break;
      }
    }

    // If no database found, scan Program Files for Xbox games
    if (!db) {
      const xboxPath = "C:\\XboxGames";
      const games = [];

      if (fs.existsSync(xboxPath)) {
        const folders = fs.readdirSync(xboxPath);
        for (const folder of folders) {
          const folderPath = xboxPath + "\\" + folder;
          try {
            const exeFiles = fs.readdirSync(folderPath)
              .filter(f => f.endsWith(".exe"));
            if (exeFiles.length > 0) {
              games.push({
                title: folder,
                exePath: folderPath + "\\" + exeFiles[0],
                category: "Other",
                cover: "",
              });
            }
          } catch { continue; }
        }
      }

      // Also check Program Files for Xbox games
      const programFiles = "C:\\Program Files\\WindowsApps";
      if (fs.existsSync(programFiles)) {
        try {
          const folders2 = fs.readdirSync(programFiles);
          for (const folder of folders2) {
            if (!folder.startsWith("Microsoft.")) continue;
            const folderPath = programFiles + "\\" + folder;
            try {
              const exeFiles = fs.readdirSync(folderPath)
                .filter(f => f.endsWith(".exe") && !f.includes("Installer"));
              if (exeFiles.length > 0) {
                const title = folder.split("_")[0].replace("Microsoft.", "");
                games.push({
                  title,
                  exePath: folderPath + "\\" + exeFiles[0],
                  category: "Other",
                  cover: "",
                });
              }
            } catch { continue; }
          }
        } catch {}
      }

      if (games.length > 0) return { success: true, games };
      return { success: false, error: "Xbox Game Pass games not found. Make sure Xbox app is installed." };
    }

    // Read from database if found
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log("Xbox DB tables:", tables);

    let games = [];
    try {
      const rows = db.prepare("SELECT * FROM GameBarData").all();
      games = rows
        .filter(r => r.ExePath || r.AppTitle)
        .map(r => ({
          title: r.AppTitle || r.GameTitle || "Unknown",
          exePath: r.ExePath || "",
          category: "Other",
          cover: "",
        }));
    } catch {
      // Try alternate table name
      try {
        const rows = db.prepare("SELECT * FROM Games").all();
        games = rows.map(r => ({
          title: r.Name || r.Title || "Unknown",
          exePath: r.ExecutablePath || r.ExePath || "",
          category: "Other",
          cover: "",
        }));
      } catch {}
    }

    db.close();
    return { success: true, games };
  } catch (e) {
    console.log("Xbox import error:", e.message);
    return { success: false, error: e.message };
  }
});

// ── RPC Friends ────────────────────────────────────────────────────────────────
ipcMain.handle("rpc-get-friends", async () => {
  try {
    const data = await rpc.getRelationships();
    const friends = data.relationships
      .filter(r => r.type === 1)
      .map(r => ({
        id: r.user.id,
        username: r.user.username,
        avatar: r.user.avatar
          ? `https://cdn.discordapp.com/avatars/${r.user.id}/${r.user.avatar}.png`
          : `https://cdn.discordapp.com/embed/avatars/0.png`,
        status: r.presence?.status || "offline",
        activity: r.presence?.activities?.[0]?.name || null,
      }));
    return { success: true, friends };
  } catch (e) {
    console.log("getRelationships error:", e.message);
    return { success: false, error: e.message };
  }
});

// ── Discord OAuth Login ────────────────────────────────────────────────────────
ipcMain.handle("discord-login", async () => {
  try {
    await startAuthServer();
    const authUrl = `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback&scope=identify`;
    console.log("Opening Discord auth URL...");
    await shell.openExternal(authUrl);
    return { success: true };
  } catch (e) {
    console.log("discord-login error:", e.message);
    return { success: false, error: e.message };
  }
});

ipcMain.handle("discord-logout", async () => {
  discordToken = null;
  return { success: true };
});

ipcMain.handle("discord-get-user", async () => {
  if (!discordToken) return { success: false, error: "Not logged in" };
  try {
    const res = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${discordToken}` },
    });
    return { success: true, user: res.data };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("discord-get-friends", async () => {
  if (!discordToken) return { success: false, error: "Not logged in" };
  try {
    const res = await axios.get("https://discord.com/api/users/@me/relationships", {
      headers: { Authorization: `Bearer ${discordToken}` },
    });
    const friends = res.data.filter(r => r.type === 1).map(r => ({
      id: r.id,
      username: r.user.username,
      avatar: r.user.avatar
        ? `https://cdn.discordapp.com/avatars/${r.user.id}/${r.user.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/0.png`,
      status: r.presence?.status || "offline",
      activity: r.presence?.activities?.[0]?.name || null,
    }));
    return { success: true, friends };
  } catch (e) {
    return { success: false, error: e.message };
  }
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
      { content: `🎮 Hey! Join me in **${gameName}** — I'm playing via AURA Game Launcher!` },
      { headers: { Authorization: `Bearer ${discordToken}`, "Content-Type": "application/json" } }
    );
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});


// ── IGDB Cover Art ─────────────────────────────────────────────────────────────
// Add these constants at the top of main.js with your other credentials

let igdbToken = null;
let igdbTokenExpiry = null;

// Get or refresh the IGDB access token
async function getIGDBToken() {
  if (igdbToken && igdbTokenExpiry && Date.now() < igdbTokenExpiry) {
    return igdbToken;
  }
  const res = await axios.post(
    `https://id.twitch.tv/oauth2/token?client_id=${IGDB_CLIENT_ID}&client_secret=${IGDB_CLIENT_SECRET}&grant_type=client_credentials`
  );
  igdbToken = res.data.access_token;
  igdbTokenExpiry = Date.now() + (res.data.expires_in * 1000) - 60000;
  return igdbToken;
}

// Fetch cover art URL for a single game title
ipcMain.handle("fetch-cover-art", async (_event, gameTitle) => {
  try {
    const token = await getIGDBToken();
    const res = await axios.post(
      "https://api.igdb.com/v4/games",
      `search "${gameTitle}"; fields name,cover.url; limit 1;`,
      {
        headers: {
          "Client-ID": IGDB_CLIENT_ID,
          "Authorization": `Bearer ${token}`,
          "Content-Type": "text/plain",
        },
      }
    );

    if (!res.data || res.data.length === 0) {
      return { success: false, error: "Game not found" };
    }

    const game = res.data[0];
    if (!game.cover || !game.cover.url) {
      return { success: false, error: "No cover art found" };
    }

    // Convert to high quality image URL
    const coverUrl = game.cover.url
      .replace("//", "https://")
      .replace("t_thumb", "t_cover_big");

    return { success: true, url: coverUrl, title: game.name };
  } catch (e) {
    console.log("IGDB error:", e.message);
    return { success: false, error: e.message };
  }
});

// Fetch cover art for multiple games at once (for bulk import)
ipcMain.handle("fetch-covers-bulk", async (_event, games) => {
  try {
    const token = await getIGDBToken();
    const results = {};

    // Process in batches of 10 to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < games.length; i += batchSize) {
      const batch = games.slice(i, i + batchSize);

      for (const game of batch) {
        try {
          const res = await axios.post(
            "https://api.igdb.com/v4/games",
            `search "${game.title.replace(/"/g, '')}"; fields name,cover.url; limit 1;`,
            {
              headers: {
                "Client-ID": IGDB_CLIENT_ID,
                "Authorization": `Bearer ${token}`,
                "Content-Type": "text/plain",
              },
            }
          );

          if (res.data && res.data.length > 0 && res.data[0].cover) {
            const coverUrl = res.data[0].cover.url
              .replace("//", "https://")
              .replace("t_thumb", "t_cover_big");
            results[game.id] = coverUrl;
          }

          // Small delay to respect rate limits
          await new Promise(r => setTimeout(r, 100));
        } catch { continue; }
      }
    }

    return { success: true, covers: results };
  } catch (e) {
    console.log("IGDB bulk error:", e.message);
    return { success: false, error: e.message };
  }
});


// ── Local OAuth Callback Server ────────────────────────────────────────────────
function startAuthServer() {
  return new Promise((resolve, reject) => {
    if (authServer) {
      authServer.close();
      authServer = null;
    }

    authServer = http.createServer(async (req, res) => {
      console.log("Request received:", req.url);
      const url = new URL(req.url, "http://localhost:3000");

      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        console.log("Code received:", code);

        if (!code) {
          res.writeHead(400);
          res.end("No code received");
          return;
        }

        try {
          const tokenRes = await axios.post(
            "https://discord.com/api/oauth2/token",
            new URLSearchParams({
              client_id: DISCORD_CLIENT_ID,
              client_secret: DISCORD_CLIENT_SECRET,
              grant_type: "authorization_code",
              code,
              redirect_uri: DISCORD_REDIRECT_URI,
            }),
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
          );

          discordToken = tokenRes.data.access_token;
          console.log("Discord token received!");

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="background:#222831;color:#EEEEEE;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px;">
                <div style="font-size:48px">✅</div>
                <div style="font-size:20px;font-weight:700;">Successfully connected to Discord!</div>
                <div style="font-size:13px;color:#a0a8b4;">You can close this tab and return to AURA.</div>
              </body>
            </html>
          `);

          const wins = BrowserWindow.getAllWindows();
          if (wins.length > 0) {
            wins[0].webContents.send("discord-auth-success");
          }
        } catch (e) {
          console.log("Token exchange error:", e.message);
          res.writeHead(500);
          res.end("Auth failed: " + e.message);
        }

        authServer.close();
        authServer = null;
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    authServer.listen(3000, () => {
      console.log("Auth server listening on port 3000");
      resolve();
    });

    authServer.on("error", (e) => {
      console.log("Auth server error:", e.message);
      reject(e);
    });
  });
}

