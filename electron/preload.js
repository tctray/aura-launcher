const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Game launching
  launchGame: (exePath) => ipcRenderer.invoke("launch-game", exePath),


  fetchCoverArt: (title) => ipcRenderer.invoke("fetch-cover-art", title),
fetchCoversBulk: (games) => ipcRenderer.invoke("fetch-covers-bulk", games),

onGameSessionEnded: (callback) => ipcRenderer.on("game-session-ended", callback),

  // File picker
  pickExe: () => ipcRenderer.invoke("pick-exe"),


  pickImage: () => ipcRenderer.invoke("pick-image"),

  checkUpdate: () => ipcRenderer.invoke("check-update"),
openExternal: (url) => ipcRenderer.invoke("open-external", url),

fetchTrailer: (title) => ipcRenderer.invoke("fetch-trailer", title),

steamGetProfile: (steamId) => ipcRenderer.invoke("steam-get-profile", steamId),
steamGetFriends: (steamId) => ipcRenderer.invoke("steam-get-friends", steamId),
steamGetPlaytime: (steamId) => ipcRenderer.invoke("steam-get-playtime", steamId),

steamGetFriendsProfiles: (steamId) => ipcRenderer.invoke("steam-get-friends-profiles", steamId),

xboxGetProfile: () => ipcRenderer.invoke("xbox-get-profile"),
xboxGetAchievements: (titleId) => ipcRenderer.invoke("xbox-get-achievements", titleId),
xboxGetRecentGames: () => ipcRenderer.invoke("xbox-get-recent-games"),

  // Steam import
  importSteam: () => ipcRenderer.invoke("import-steam"),
  importEpic: () => ipcRenderer.invoke("import-epic"),
  importXbox: () => ipcRenderer.invoke("import-xbox"),

  // Discord
  discordLogin: () => ipcRenderer.invoke("discord-login"),
  discordLogout: () => ipcRenderer.invoke("discord-logout"),
  discordGetUser: () => ipcRenderer.invoke("discord-get-user"),
  discordGetFriends: () => ipcRenderer.invoke("discord-get-friends"),
  discordInviteFriend: (friendId, gameName) => ipcRenderer.invoke("discord-invite-friend", friendId, gameName),

  // Listen for successful Discord auth (sent from main after OAuth callback)
  onDiscordAuthSuccess: (callback) => ipcRenderer.on("discord-auth-success", callback),
  removeDiscordAuthListener: () => ipcRenderer.removeAllListeners("discord-auth-success"),

  // Electron check
  isElectron: true,

  rpcGetFriends: () => ipcRenderer.invoke("rpc-get-friends"),
});

