const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  perfSubscribe: () => ipcRenderer.invoke("perf-subscribe"),
  openClipEditor: () => ipcRenderer.send("open-clip-editor"),
  settingsSync: (patch) => ipcRenderer.invoke("settings-sync", patch),
  onQuickRecordToggle: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on("quick-record-toggle", h);
    return () => ipcRenderer.removeListener("quick-record-toggle", h);
  },
  quickRecordState: (state) => ipcRenderer.invoke("quick-record-state", state),
  getQuickCaptureSource: () => ipcRenderer.invoke("get-quick-capture-source"),
  perfUnsubscribe: () => ipcRenderer.invoke("perf-unsubscribe"),
  onPerfStats: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on("perf-stats", h);
    return () => ipcRenderer.removeListener("perf-stats", h);
  },
  barGetState: () => ipcRenderer.invoke("bar-get-state"),
  barToggleRecord: () => ipcRenderer.invoke("bar-record-toggle"),
  barSetExpanded: (open) => ipcRenderer.invoke("bar-set-expanded", open),
  barScreenshot: () => ipcRenderer.invoke("bar-screenshot"),
  barOpenAura: () => ipcRenderer.invoke("focus-main"),
  barClose: () => ipcRenderer.invoke("aurabar-hide"),
  onBarState: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on("bar-state", h);
    return () => ipcRenderer.removeListener("bar-state", h);
  },

  isElectron: true,

  // ── Game launching ──────────────────────────────────────────────────────────
  launchGame:          (exePath) => ipcRenderer.invoke("launch-game", exePath),
  watchGames: (paths) => ipcRenderer.invoke("games:watch", paths), // the games Sessions looks for
  onGameSessionStarted: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on("game-session-started", h); return () => ipcRenderer.removeListener("game-session-started", h); },
  onGameSessionEnded: (cb) => {
    ipcRenderer.on("game-session-ended", cb);
    return () => ipcRenderer.removeListener("game-session-ended", cb);
  },
  // ── File pickers ────────────────────────────────────────────────────────────
  pickExe:   () => ipcRenderer.invoke("pick-exe"),
  pickImage: () => ipcRenderer.invoke("pick-image"),

  // ── External links ──────────────────────────────────────────────────────────
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  // The error log: a file on this PC, never sent anywhere
  logError:     (entry) => ipcRenderer.invoke("log-error", entry),
  openErrorLog: ()      => ipcRenderer.invoke("open-error-log"),

  // ── Steam ───────────────────────────────────────────────────────────────────
  importSteam:             ()         => ipcRenderer.invoke("import-steam"),
  steamGetProfile:         (steamId)  => ipcRenderer.invoke("steam-get-profile", steamId),
  steamGetPlaytime:        (steamId)  => ipcRenderer.invoke("steam-get-playtime", steamId),
  steamGetFriendsProfiles: (steamId)  => ipcRenderer.invoke("steam-get-friends-profiles", steamId),

  // ── Epic & Xbox ─────────────────────────────────────────────────────────────
  importEpic:          () => ipcRenderer.invoke("import-epic"),
  importXbox:          () => ipcRenderer.invoke("import-xbox"),

  // ── Cover art (IGDB) ────────────────────────────────────────────────────────
  fetchCoverArt:   (title)  => ipcRenderer.invoke("fetch-cover-art", title),
  fetchCoversBulk: (games)  => ipcRenderer.invoke("fetch-covers-bulk", games),
  onCoversProgress: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on("covers-progress", h); return () => ipcRenderer.removeListener("covers-progress", h); }, // how far a cover fetch has got (Added by aura-covers-setup.cjs)

  // ── Twitch live streams ──────────────────────────────────────────────────────
  searchTwitch:       (opts) => ipcRenderer.invoke("search-twitch", opts),
  // F11 switched full screen (Added by aura-look-setup.cjs)
  onWindowModeChanged: (cb) => { const h = (_e, mode) => cb(mode); ipcRenderer.on("window-mode-changed", h); return () => ipcRenderer.removeListener("window-mode-changed", h); },
  fetchTwitchStreams: (opts) => ipcRenderer.invoke("fetch-twitch-streams", opts),
  // Twitch favorites (Added by aura-twitch-favorites-setup.cjs)
  twitchLiveNotice:   (info) => ipcRenderer.invoke("twitch-live-notice", info),
  onTwitchOpenStream: (cb) => { const h = (_e, login) => cb(login); ipcRenderer.on("twitch-open-stream", h); return () => ipcRenderer.removeListener("twitch-open-stream", h); },

  // ── Discord OAuth ───────────────────────────────────────────────────────────
  discordLogin:         ()                     => ipcRenderer.invoke("discord-login"),
  discordLogout:        ()                     => ipcRenderer.invoke("discord-logout"),
  discordGetUser:       ()                     => ipcRenderer.invoke("discord-get-user"),
  onDiscordAuthSuccess: (cb)                   => ipcRenderer.on("discord-auth-success", cb),
  removeDiscordAuthListener: ()                => ipcRenderer.removeAllListeners("discord-auth-success"),

  // ── Trailers ─────────────────────────────────────────────────────────────────
  fetchTrailer: (title) => ipcRenderer.invoke("fetch-trailer", title),

  // ── Recording ────────────────────────────────────────────────────────────────
  getMediaDevices:   ()      => ipcRenderer.invoke("get-media-devices"),
  getDisplays:        ()      => ipcRenderer.invoke("get-displays"),
  getCaptureSources:  ()     => ipcRenderer.invoke("get-capture-sources"),
  getAudioDevices:   ()      => ipcRenderer.invoke("get-audio-devices"),
  getClipServerPort:  ()      => ipcRenderer.invoke("get-clip-server-port"),
  setCaptureSource:  (id)    => ipcRenderer.invoke("set-capture-source", id),
  startFfmpegPipe:   (game, mime) => ipcRenderer.invoke("start-ffmpeg-pipe", game, mime),
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
  streamFullscreen:()      => ipcRenderer.invoke("stream-fullscreen"),
  streamExitFull:  ()      => ipcRenderer.invoke("stream-exit-full"),
  // Esc was pressed inside the Twitch player while it filled the window
  onStreamExitFull:(cb)    => { const h = () => cb(); ipcRenderer.on("stream-exit-full", h); return () => ipcRenderer.removeListener("stream-exit-full", h); },
  // Browser tabs: links that open a new tab, and Ctrl+T / Ctrl+W / Ctrl+Tab pressed inside a page
  onBrowserOpenTab: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on("browser-open-tab", h); return () => ipcRenderer.removeListener("browser-open-tab", h); },
  onBrowserTabKey:  (cb) => { const h = (_e, k) => cb(k); ipcRenderer.on("browser-tab-key", h); return () => ipcRenderer.removeListener("browser-tab-key", h); },
  streamRestore: (opts)  => ipcRenderer.invoke("stream-restore", opts),
  streamOpen:   (opts)   => ipcRenderer.invoke("stream-open", opts),
  streamResize: (bounds) => ipcRenderer.invoke("stream-resize", bounds),
  streamClose:  ()       => ipcRenderer.invoke("stream-close"),
  streamRoom:   (room)   => ipcRenderer.invoke("stream-room", room), // AURA's panels the stream makes room for (Added by aura-stream-room-setup.cjs)
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

contextBridge.exposeInMainWorld("auraCloud", {
  signUp: (email, password, username) => ipcRenderer.invoke("auth:signUp", email, password, username),
  logIn: (email, password) => ipcRenderer.invoke("auth:logIn", email, password),
  logOut: () => ipcRenderer.invoke("auth:logOut"),
  getSession: () => ipcRenderer.invoke("auth:getSession"),
  resendConfirmation: (email) => ipcRenderer.invoke("auth:resendConfirmation", email),
  sendResetCode: (email) => ipcRenderer.invoke("auth:sendResetCode", email), // forgot password (Added by aura-reset-password-setup.cjs)
  resetPasswordWithCode: (email, code, password) => ipcRenderer.invoke("auth:resetPasswordWithCode", email, code, password),
  getMyProfile: () => ipcRenderer.invoke("profile:getMine"),
  saveProfile: (username, avatarUrl) => ipcRenderer.invoke("profile:save", username, avatarUrl),
  getProfile: (username) => ipcRenderer.invoke("profile:get", username),
  getMyGames: () => ipcRenderer.invoke("games:getMine"),
  saveMyGames: (games) => ipcRenderer.invoke("games:saveMine", games),
  getMyData: () => ipcRenderer.invoke("data:getMine"),
  saveMyData: (entries) => ipcRenderer.invoke("data:saveMine", entries),
  getMySessionIds: () => ipcRenderer.invoke("sessions:getIds"),
  getMySessions: (ids) => ipcRenderer.invoke("sessions:get", ids),
  saveMySessions: (sessions) => ipcRenderer.invoke("sessions:save", sessions),
  deleteMySessions: (ids) => ipcRenderer.invoke("sessions:delete", ids),
});

// AURA friends and messages. Each call is answered by electron/social.js
contextBridge.exposeInMainWorld("auraSocial", {
  start: () => ipcRenderer.invoke("social:start"),
  stop: () => ipcRenderer.invoke("social:stop"),
  listFriends: () => ipcRenderer.invoke("social:listFriends"),
  findUser: (username) => ipcRenderer.invoke("social:findUser", username),
  requestFriend: (userId) => ipcRenderer.invoke("social:requestFriend", userId),
  acceptFriend: (friendshipId) => ipcRenderer.invoke("social:acceptFriend", friendshipId),
  removeFriend: (friendshipId) => ipcRenderer.invoke("social:removeFriend", friendshipId),
  getProfile: (userId) => ipcRenderer.invoke("social:getProfile", userId),
  listConversations: () => ipcRenderer.invoke("social:listConversations"),
  openConversation: (userId) => ipcRenderer.invoke("social:openConversation", userId),
  getMessages: (conversationId, before) => ipcRenderer.invoke("social:getMessages", conversationId, before),
  sendMessage: (conversationId, content) => ipcRenderer.invoke("social:sendMessage", conversationId, content),
  // Pictures, GIFs and videos: the file's bytes go to the main process, which uploads them
  sendMedia: (conversationId, file, caption) => ipcRenderer.invoke("social:sendMedia", conversationId, file, caption),
  mediaUrls: (paths) => ipcRenderer.invoke("social:mediaUrls", paths),
  // The background picture a chat shares between its two people (null removes it)
  setBackground: (conversationId, file) => ipcRenderer.invoke("social:setBackground", conversationId, file),
  // Deleting your own messages, blocking and reporting
  deleteMessage: (messageId) => ipcRenderer.invoke("social:deleteMessage", messageId),
  blockUser: (userId) => ipcRenderer.invoke("social:blockUser", userId),
  unblockUser: (userId) => ipcRenderer.invoke("social:unblockUser", userId),
  listBlocked: () => ipcRenderer.invoke("social:listBlocked"),
  reportUser: (userId, report) => ipcRenderer.invoke("social:reportUser", userId, report),
  // Voice calls: ringing, accepting and hanging up, and the details two PCs swap to connect
  startCall: (userId) => ipcRenderer.invoke("social:startCall", userId),
  answerCall: (callId) => ipcRenderer.invoke("social:answerCall", callId),
  endCall: (callId, reason) => ipcRenderer.invoke("social:endCall", callId, reason),
  callSignal: (callId, kind, payload) => ipcRenderer.invoke("social:callSignal", callId, kind, payload),
  callState: (callId, after) => ipcRenderer.invoke("social:callState", callId, after),
  callBeat: (callId) => ipcRenderer.invoke("social:callBeat", callId),
  currentCall: () => ipcRenderer.invoke("social:currentCall"),
  callConfig: () => ipcRenderer.invoke("social:callConfig"),
  // Calls with 3 people // (Added by aura-group-calls-setup.cjs)
  addToCall: (callId, userId) => ipcRenderer.invoke("social:addToCall", callId, userId),
  joinGroup: (callId) => ipcRenderer.invoke("social:joinGroup", callId),
  // Likes and dislikes on messages, and GIF search (answered by the main process, never the window)
  react: (messageId, reaction, conversationId) => ipcRenderer.invoke("social:react", messageId, reaction, conversationId),
  // Group chats // (Added by aura-messages-groups-setup.cjs)
  createGroup: (title, userIds) => ipcRenderer.invoke("social:createGroup", title, userIds),
  addGroupMembers: (conversationId, userIds) => ipcRenderer.invoke("social:addGroupMembers", conversationId, userIds),
  removeGroupMember: (conversationId, userId) => ipcRenderer.invoke("social:removeGroupMember", conversationId, userId),
  leaveGroup: (conversationId) => ipcRenderer.invoke("social:leaveGroup", conversationId),
  renameGroup: (conversationId, title) => ipcRenderer.invoke("social:renameGroup", conversationId, title),
  gifSearch: (words, more) => ipcRenderer.invoke("social:gifSearch", words, more),
  markRead: (conversationId) => ipcRenderer.invoke("social:markRead", conversationId),
  // New messages and friend changes pushed from the main process
  onEvent: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on("social:event", h);
    return () => ipcRenderer.removeListener("social:event", h);
  },
});
