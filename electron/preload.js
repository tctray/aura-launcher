const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,

  // ── Game launching ──────────────────────────────────────────────────────────
  launchGame:          (exePath) => ipcRenderer.invoke("launch-game", exePath),
  onGameSessionEnded:  (cb)      => ipcRenderer.on("game-session-ended", cb),

  // ── File pickers ────────────────────────────────────────────────────────────
  pickExe:   () => ipcRenderer.invoke("pick-exe"),
  pickImage: () => ipcRenderer.invoke("pick-image"),

  // ── External links ──────────────────────────────────────────────────────────
  openExternal: (url) => ipcRenderer.invoke("open-external", url),

  // ── Steam ───────────────────────────────────────────────────────────────────
  importSteam:             ()         => ipcRenderer.invoke("import-steam"),
  steamGetProfile:         (steamId)  => ipcRenderer.invoke("steam-get-profile", steamId),
  steamGetPlaytime:        (steamId)  => ipcRenderer.invoke("steam-get-playtime", steamId),
  steamGetFriendsProfiles: (steamId)  => ipcRenderer.invoke("steam-get-friends-profiles", steamId),

  // ── Epic & Xbox ─────────────────────────────────────────────────────────────
  importEpic:          () => ipcRenderer.invoke("import-epic"),
  importXbox:          () => ipcRenderer.invoke("import-xbox"),
  xboxGetProfile:      () => ipcRenderer.invoke("xbox-get-profile"),
  xboxGetRecentGames:  () => ipcRenderer.invoke("xbox-get-recent-games"),

  // ── Cover art (IGDB) ────────────────────────────────────────────────────────
  fetchCoverArt:   (title)  => ipcRenderer.invoke("fetch-cover-art", title),
  fetchCoversBulk: (games)  => ipcRenderer.invoke("fetch-covers-bulk", games),

  // ── Twitch live streams ──────────────────────────────────────────────────────
  fetchTwitchStreams: (opts) => ipcRenderer.invoke("fetch-twitch-streams", opts),

  // ── Discord OAuth ───────────────────────────────────────────────────────────
  discordLogin:         ()                     => ipcRenderer.invoke("discord-login"),
  discordLogout:        ()                     => ipcRenderer.invoke("discord-logout"),
  discordGetUser:       ()                     => ipcRenderer.invoke("discord-get-user"),
  discordGetFriends:    ()                     => ipcRenderer.invoke("discord-get-friends"),
  discordInviteFriend:  (friendId, gameName)   => ipcRenderer.invoke("discord-invite-friend", friendId, gameName),
  onDiscordAuthSuccess: (cb)                   => ipcRenderer.on("discord-auth-success", cb),
  removeDiscordAuthListener: ()                => ipcRenderer.removeAllListeners("discord-auth-success"),

  // ── Discord RPC ──────────────────────────────────────────────────────────────
  rpcGetFriends: () => ipcRenderer.invoke("rpc-get-friends"),

  // ── Trailers ─────────────────────────────────────────────────────────────────
  fetchTrailer: (title) => ipcRenderer.invoke("fetch-trailer", title),

  // ── Update checker (legacy) ──────────────────────────────────────────────────
  checkUpdate: () => ipcRenderer.invoke("check-update"),

  // ── Auto-updater ─────────────────────────────────────────────────────────────
  onUpdateAvailable: (cb) => ipcRenderer.on("update-available", (_e, v) => cb(v)),
  onUpdateProgress:  (cb) => ipcRenderer.on("update-progress",  (_e, p) => cb(p)),
  onUpdateReady:     (cb) => ipcRenderer.on("update-ready",     ()      => cb()),
  downloadUpdate:    ()   => ipcRenderer.invoke("download-update"),
  installUpdate:     ()   => ipcRenderer.invoke("install-update"),
});