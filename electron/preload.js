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

