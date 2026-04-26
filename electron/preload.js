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
  searchTwitch:       (opts) => ipcRenderer.invoke("search-twitch", opts),
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

  // ── Recording ────────────────────────────────────────────────────────────────
  getMediaDevices:   ()      => ipcRenderer.invoke("get-media-devices"),
  getDisplays:        ()      => ipcRenderer.invoke("get-displays"),
  getCaptureSources:  ()     => ipcRenderer.invoke("get-capture-sources"),
  getAudioDevices:   ()      => ipcRenderer.invoke("get-audio-devices"),
  getClipServerPort:  ()      => ipcRenderer.invoke("get-clip-server-port"),
  setCaptureSource:  (id)    => ipcRenderer.invoke("set-capture-source", id),
  startFfmpegPipe:   (game)  => ipcRenderer.invoke("start-ffmpeg-pipe", game),
  pipeToFfmpeg:      (buf)   => ipcRenderer.invoke("pipe-to-ffmpeg", buf),
  stopFfmpegPipe:    ()      => ipcRenderer.invoke("stop-ffmpeg-pipe"),
  trimClip:          (opts)  => ipcRenderer.invoke("trim-clip", opts),
  shareClip:         (path)  => ipcRenderer.invoke("share-clip", path),
  saveClip:          (game, buf) => ipcRenderer.invoke("save-clip", game, buf),
  startRecording:    (game, opts)  => ipcRenderer.invoke("start-recording", game, opts),
  stopRecording:     ()      => ipcRenderer.invoke("stop-recording"),
  recordingStatus:   ()      => ipcRenderer.invoke("recording-status"),
  setClipFolder:     ()      => ipcRenderer.invoke("set-clip-folder"),
  getClipFolder:     ()      => ipcRenderer.invoke("get-clip-folder"),
  getClips:          ()      => ipcRenderer.invoke("get-clips"),
  deleteClip:        (p)     => ipcRenderer.invoke("delete-clip", p),
  openClipFolder:    (p)     => ipcRenderer.invoke("open-clip-folder", p),
  renameClip:        (opts)  => ipcRenderer.invoke("rename-clip", opts),
  onRecordingStarted:(cb)    => ipcRenderer.on("recording-started", cb),
  onRecordingStopped:(cb)    => ipcRenderer.on("recording-stopped", cb),
  onRecordingHotkey: (cb)    => ipcRenderer.on("recording-hotkey", cb),
  stopBarRecording:  ()      => ipcRenderer.invoke("stop-bar-recording"),
  onBarStopRecording:(cb)    => ipcRenderer.on("bar-stop-recording", cb),
  onBarToggleRecording: (cb) => ipcRenderer.on("bar-toggle-recording", cb),

  // ── Stream BrowserView ────────────────────────────────────────────────────
  aurabarMove:       (pos)   => ipcRenderer.invoke("aurabar-move", pos),
  aurabarHide:       ()      => ipcRenderer.invoke("aurabar-hide"),
  aurabarShow:       ()      => ipcRenderer.invoke("aurabar-show"),
  getEnvDebug:       ()      => ipcRenderer.invoke("get-env-debug"),
  focusMain:         ()      => ipcRenderer.invoke("focus-main"),
  getWindowPos:      ()      => ipcRenderer.invoke("get-window-pos"),
  toggleRecording:   ()      => ipcRenderer.invoke("toggle-recording"),
  getScreenshots:    ()      => ipcRenderer.invoke("get-screenshots"),
  takeScreenshot:    ()      => ipcRenderer.invoke("take-screenshot"),
  streamPip:    (bounds) => ipcRenderer.invoke("stream-pip", bounds),
  streamOpen:   (opts)   => ipcRenderer.invoke("stream-open", opts),
  streamResize: (bounds) => ipcRenderer.invoke("stream-resize", bounds),
  streamClose:  ()       => ipcRenderer.invoke("stream-close"),
  chatOpen:     (opts)   => ipcRenderer.invoke("chat-open", opts),
  chatClose:    ()       => ipcRenderer.invoke("chat-close"),

  // ── Update checker (legacy) ──────────────────────────────────────────────────
  checkUpdate: () => ipcRenderer.invoke("check-update"),

  // ── Auto-updater ─────────────────────────────────────────────────────────────
  onUpdateAvailable: (cb) => ipcRenderer.on("update-available", (_e, v) => cb(v)),
  onUpdateProgress:  (cb) => ipcRenderer.on("update-progress",  (_e, p) => cb(p)),
  onUpdateReady:     (cb) => ipcRenderer.on("update-ready",     ()      => cb()),
  downloadUpdate:    ()   => ipcRenderer.invoke("download-update"),
  installUpdate:     ()   => ipcRenderer.invoke("install-update"),
});