// AURA friends and messages — the main-process side.
//
// The window never talks to Supabase itself. It asks through preload.js (window.auraSocial),
// those requests arrive here, and this file talks to Supabase as the signed-in user.
// Supabase's own rules (row level security) decide what that user may see or do, so even a
// tampered window can't read someone else's messages.
//
// Added by aura-messages-setup.cjs. Wired up from the main file with one line:
//   require("./social").register({ ipcMain, cloudHandler, cloud: auraCloud, getWindow: () => mainWin });
"use strict";
const { app, Notification } = require("electron");

const ONLINE_WITHIN_MS = 150 * 1000;   // seen in the last 2.5 minutes counts as online
const HEARTBEAT_MS = 60 * 1000;
const PAGE_SIZE = 40;
const MAX_LENGTH = 4000;
const NOTIFY_QUIET_MS = 8000;          // at most one Windows notification per conversation in this time
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Pictures, GIFs and videos. Files go to a private Supabase Storage bucket, in a folder named
// after the conversation. Only the two people in that conversation can upload to it or view it.
const MEDIA_BUCKET = "message-media";
const MEDIA_TYPES = {
  "image/png":       { kind: "image", ext: "png",  max: 10 * 1024 * 1024 },
  "image/jpeg":      { kind: "image", ext: "jpg",  max: 10 * 1024 * 1024 },
  "image/gif":       { kind: "image", ext: "gif",  max: 10 * 1024 * 1024 },
  "image/webp":      { kind: "image", ext: "webp", max: 10 * 1024 * 1024 },
  "video/mp4":       { kind: "video", ext: "mp4",  max: 50 * 1024 * 1024 },
  "video/webm":      { kind: "video", ext: "webm", max: 50 * 1024 * 1024 },
  "video/quicktime": { kind: "video", ext: "mov",  max: 50 * 1024 * 1024 },
};
const MEDIA_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp|mp4|webm|mov)$/;
const MEDIA_LINK_SECONDS = 12 * 60 * 60; // how long a viewing link works before AURA asks for a new one
const BASIC_COLS = "id,conversation_id,sender_id,content,created_at,read_at";
const MEDIA_COLS = BASIC_COLS + ",media_path,media_kind,media_mime,media_size,media_width,media_height,media_name";
const MEDIA_SETUP = "Pictures and videos aren't set up in Supabase yet. Run aura-messages-media.sql first.";

// What a file really is, from its first bytes (the name and the type the window reports can be wrong)
function sniff(b) {
  if (!b || b.length < 12) return null;
  const at = (i, text) => b.toString("latin1", i, i + text.length) === text;
  if (b[0] === 0x89 && at(1, "PNG")) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (at(0, "GIF87a") || at(0, "GIF89a")) return "image/gif";
  if (at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  if (at(4, "ftyp")) {
    const brand = b.toString("latin1", 8, 12);
    if (brand === "qt  ") return "video/quicktime";
    // Same container, but not a video AURA can show: iPhone HEIC/AVIF photos and audio-only files
    if (/^(hei[cxms]|hev[cxms]|mif1|msf1|avi[fs]|M4A |M4B |M4P )$/.test(brand)) return null;
    return "video/mp4";
  }
  return null;
}
const megabytes = (n) => (n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + " MB";

function register({ ipcMain, cloudHandler, cloud, getWindow }) {
  const sb = () => cloud.internals.client();
  const currentUser = () => cloud.internals.currentUser();

  let channel = null;        // the live connection to Supabase
  let channelUser = null;    // whose it is
  let live = false;
  let heartbeat = null;
  let authWatched = false;
  let friendsTimer = null;
  const names = new Map();           // user id -> username, for notifications
  const friendshipIds = new Set();   // friendships this user is part of
  const quiet = new Map();           // conversation id -> { until, count, timer }
  let mediaReady = true;             // false once we learn the media SQL hasn't been run yet
  let listReady = true;              // same, for the newer conversation list

  // ── Small helpers ───────────────────────────────────────────────────────────
  const id = (value, what) => {
    if (typeof value !== "string" || !UUID.test(value)) throw new Error("That " + what + " isn't valid.");
    return value;
  };
  const isOnline = (lastSeen) => !!lastSeen && Date.now() - Date.parse(lastSeen) < ONLINE_WITHIN_MS;

  // Supabase errors, in words a person can act on
  function friendly(error) {
    const msg = String(error?.message || error || "Something went wrong");
    const code = String(error?.code || "");
    if (/fetch failed|network|timeout|ENOTFOUND|ECONN|EAI_AGAIN/i.test(msg)) return new Error("You're offline. Check your connection and try again.");
    if (/bucket not found/i.test(msg)) return new Error(MEDIA_SETUP);
    if (/exceeded the maximum allowed size|payload too large|entity too large/i.test(msg)) return new Error("That file is too big to send.");
    if (/mime type .* is not supported|invalid mime type/i.test(msg)) return new Error("That kind of file can't be sent. Pictures, GIFs and videos only.");
    if (/storage.*quota|exceeded.*quota/i.test(msg)) return new Error("AURA's file storage is full. Text messages still work.");
    if (code === "PGRST202" || code === "PGRST205" || code === "42883" || code === "42P01" || /schema cache|does not exist/i.test(msg)) {
      return new Error("Messages aren't set up in Supabase yet. Run the messages SQL first.");
    }
    if (/row-level security|permission denied/i.test(msg)) return new Error("You can only message friends.");
    if (code === "23514") return new Error(/messages_media_shape/.test(msg) ? "That file can't be sent (wrong type, or too big)." : "That message is empty or too long.");
    return new Error(msg);
  }
  async function rpc(name, args) {
    const { data, error } = await sb().rpc(name, args);
    if (error) throw friendly(error);
    return data;
  }
  function emit(event) {
    const win = getWindow();
    try { if (win && !win.isDestroyed()) win.webContents.send("social:event", event); } catch {}
  }

  const shapeMessage = (m) => ({
    id: m.id, conversationId: m.conversation_id, senderId: m.sender_id, content: m.content || "", createdAt: m.created_at, readAt: m.read_at || null,
    media: m.media_path ? { path: m.media_path, kind: m.media_kind, mime: m.media_mime, size: m.media_size || 0, width: m.media_width || null, height: m.media_height || null, name: m.media_name || "" } : null,
  });
  // The words shown where a file has no caption: in the list, in notices
  const mediaWord = (media) => (!media ? "" : media.kind === "video" ? "Video" : media.mime === "image/gif" ? "GIF" : "Photo");
  // The media columns arrive with aura-messages-media.sql. Until it has been run, read without them.
  const noMediaColumns = (error) => String(error?.code || "") === "42703" || /media_(path|kind|mime|size|width|height|name)/.test(String(error?.message || ""));

  // Keep line breaks inside a message, but drop blank lines and spaces around it
  function tidyContent(raw, allowEmpty = false) {
    const text = String(raw ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/^\s+|\s+$/g, "").replace(/\n{4,}/g, "\n\n\n");
    if (!text.trim() && !allowEmpty) throw new Error("Type a message first.");
    if (text.length > MAX_LENGTH) throw new Error("That message is too long (" + text.length + " of " + MAX_LENGTH + " characters).");
    return text;
  }

  // ── Friends ─────────────────────────────────────────────────────────────────
  async function listFriends() {
    const rows = (await rpc("list_friends")) || [];
    friendshipIds.clear();
    return rows.map((r) => {
      friendshipIds.add(r.friendship_id);
      if (r.username) names.set(r.user_id, r.username);
      return { friendshipId: r.friendship_id, userId: r.user_id, username: r.username || "AURA user", avatarUrl: r.avatar_url || "", state: r.state, since: r.since, online: isOnline(r.last_seen_at), lastSeenAt: r.last_seen_at || null };
    });
  }

  // Look someone up by their exact AURA username (upper or lower case doesn't matter)
  async function findUser(username) {
    const user = await currentUser();
    const name = String(username || "").trim().replace(/^@/, "");
    if (!name) throw new Error("Enter an AURA username.");
    if (name.length > 40) throw new Error("That username is too long.");
    const exact = name.replace(/[\\%_]/g, (ch) => "\\" + ch); // % and _ are wildcards otherwise
    const { data, error } = await sb().from("profiles").select("id,username,avatar_url").ilike("username", exact).limit(1).maybeSingle();
    if (error) throw friendly(error);
    if (!data) return null;
    return { userId: data.id, username: data.username, avatarUrl: data.avatar_url || "", isMe: data.id === user.id };
  }

  const requestFriend = async (userId) => rpc("request_friend", { target: id(userId, "user") }); // "sent" | "accepted" | "already_sent" | "already_friends"
  const acceptFriend = async (friendshipId) => rpc("accept_friend", { request_id: id(friendshipId, "friend request") });

  // Decline a request, cancel one you sent, or remove a friend: all the same thing
  async function removeFriend(friendshipId) {
    const { data, error } = await sb().from("friendships").delete().eq("id", id(friendshipId, "friend")).select("id");
    if (error) throw friendly(error);
    return (data || []).length > 0;
  }

  // Someone's public AURA profile (the same profiles table Edit Profile saves to)
  async function getProfile(userId) {
    const { data, error } = await sb().from("profiles").select("id,username,bio,avatar_url,created_at").eq("id", id(userId, "user")).maybeSingle();
    if (error) throw friendly(error);
    return data ? { userId: data.id, username: data.username, bio: data.bio || "", avatarUrl: data.avatar_url || "", joinedAt: data.created_at } : null;
  }

  // ── Conversations and messages ──────────────────────────────────────────────
  async function listConversations() {
    let rows = null;
    if (listReady) {
      const res = await sb().rpc("list_conversations_v2");
      if (!res.error) rows = res.data || [];
      else if (/PGRST202|42883/.test(String(res.error.code || "")) || /list_conversations_v2/.test(String(res.error.message || ""))) listReady = false;
      else throw friendly(res.error);
    }
    if (!rows) rows = (await rpc("list_conversations")) || []; // from before the media update
    return rows.map((r) => {
      if (r.username) names.set(r.other_id, r.username);
      return {
        id: r.id, userId: r.other_id, username: r.username || "AURA user", avatarUrl: r.avatar_url || "",
        online: isOnline(r.last_seen_at), isFriend: !!r.is_friend,
        lastMessage: r.last_message || "", lastSenderId: r.last_sender_id || null, lastMessageAt: r.last_message_at, unread: r.unread || 0,
        lastMedia: r.last_media_kind ? mediaWord({ kind: r.last_media_kind, mime: r.last_media_mime }) : "",
      };
    });
  }

  const openConversation = async (userId) => rpc("open_conversation", { other: id(userId, "user") });

  // The newest messages, or the ones before a given time when scrolling back
  async function getMessages(conversationId, before) {
    const cid = id(conversationId, "conversation");
    let when = null;
    if (before) {
      when = new Date(before);
      if (isNaN(when.getTime())) throw new Error("That date isn't valid.");
    }
    const ask = (cols) => {
      let query = sb().from("messages").select(cols).eq("conversation_id", cid)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE_SIZE + 1);
      if (when) query = query.lt("created_at", when.toISOString());
      return query;
    };
    let { data, error } = await ask(mediaReady ? MEDIA_COLS : BASIC_COLS);
    if (error && mediaReady && noMediaColumns(error)) { mediaReady = false; ({ data, error } = await ask(BASIC_COLS)); }
    if (error) throw friendly(error);
    const rows = data || [];
    return { messages: rows.slice(0, PAGE_SIZE).reverse().map(shapeMessage), hasMore: rows.length > PAGE_SIZE };
  }

  async function sendMessage(conversationId, content) {
    const user = await currentUser();
    const row = { conversation_id: id(conversationId, "conversation"), sender_id: user.id, content: tidyContent(content) }; // sender is always the signed-in account
    const save = (cols) => sb().from("messages").insert(row).select(cols).single();
    let { data, error } = await save(mediaReady ? MEDIA_COLS : BASIC_COLS);
    if (error && mediaReady && noMediaColumns(error)) { mediaReady = false; ({ data, error } = await save(BASIC_COLS)); } // nothing was saved the first time
    if (error) throw friendly(error);
    return shapeMessage(data);
  }

  // ── Pictures, GIFs and videos ───────────────────────────────────────────────
  // file: { name, bytes, width, height } as read by the window. The type is worked out here.
  async function sendMedia(conversationId, file, caption) {
    const user = await currentUser();
    const cid = id(conversationId, "conversation");
    const raw = file && (file.bytes || file.data);
    if (!raw || typeof raw === "string") throw new Error("That file couldn't be read.");
    const bytes = Buffer.isBuffer(raw) ? raw : ArrayBuffer.isView(raw) ? Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength) : Buffer.from(raw);
    if (!bytes.length) throw new Error("That file is empty.");
    const mime = sniff(bytes);
    const type = mime && MEDIA_TYPES[mime];
    if (!type) throw new Error("That kind of file can't be sent. Pictures (PNG, JPG, WebP), GIFs and videos (MP4, WebM, MOV) only.");
    if (!mediaReady) throw new Error(MEDIA_SETUP);
    if (bytes.length > type.max) throw new Error((type.kind === "video" ? "Videos" : "Pictures and GIFs") + " can be up to " + megabytes(type.max) + ". This one is " + megabytes(bytes.length) + ".");
    const content = tidyContent(caption, true);
    const side = (n) => (Number.isFinite(n) && n >= 1 && n <= 20000 ? Math.round(n) : null);
    const name = String(file.name || "").replace(/[\u0000-\u001f\\/]/g, " ").trim().slice(0, 200) || null;
    const path = cid + "/" + require("crypto").randomUUID() + "." + type.ext;

    const up = await sb().storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: mime, cacheControl: "31536000", upsert: false });
    if (up.error) throw friendly(up.error);
    const row = {
      conversation_id: cid, sender_id: user.id, content, media_path: path, media_kind: type.kind, media_mime: mime,
      media_size: bytes.length, media_width: side(file.width), media_height: side(file.height), media_name: name,
    };
    const { data, error } = await sb().from("messages").insert(row).select(MEDIA_COLS).single();
    if (error) throw noMediaColumns(error) ? new Error(MEDIA_SETUP) : friendly(error);
    return shapeMessage(data);
  }

  // Short-lived links for viewing files. Supabase only makes one for someone in that conversation.
  async function mediaUrls(paths) {
    const wanted = [...new Set((Array.isArray(paths) ? paths : []).filter((p) => typeof p === "string" && MEDIA_PATH.test(p)))].slice(0, 100);
    if (!wanted.length) return { urls: {}, seconds: MEDIA_LINK_SECONDS };
    const { data, error } = await sb().storage.from(MEDIA_BUCKET).createSignedUrls(wanted, MEDIA_LINK_SECONDS);
    if (error) throw friendly(error);
    const urls = {};
    for (const item of data || []) if (item && !item.error && item.signedUrl && wanted.includes(item.path)) urls[item.path] = item.signedUrl;
    return { urls, seconds: MEDIA_LINK_SECONDS };
  }

  const markRead = async (conversationId) => rpc("mark_conversation_read", { conversation: id(conversationId, "conversation") });

  // ── Live updates ────────────────────────────────────────────────────────────
  function unsubscribe() {
    clearInterval(heartbeat); heartbeat = null;
    clearTimeout(friendsTimer); friendsTimer = null;
    for (const q of quiet.values()) clearTimeout(q.timer);
    quiet.clear(); names.clear(); friendshipIds.clear();
    const old = channel;
    channel = null; channelUser = null; live = false;
    if (old) { try { sb().removeChannel(old); } catch {} }
  }

  function subscribe(userId) {
    if (channel && channelUser === userId) return; // already listening for this account
    unsubscribe();
    channelUser = userId;
    // Supabase only delivers rows this user is allowed to read, so no filter is needed here
    channel = sb().channel("aura-social:" + userId)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        if (channelUser !== userId || !payload?.new?.id) return;
        const message = shapeMessage(payload.new);
        emit({ type: "message", message });
        if (message.senderId !== userId) notify(message);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, (payload) => {
        if (channelUser !== userId) return;
        // A removed friendship arrives as just its id, for everyone. Ignore the ones that aren't ours.
        if (payload?.eventType === "DELETE" && !friendshipIds.has(payload?.old?.id)) return;
        clearTimeout(friendsTimer);
        friendsTimer = setTimeout(() => emit({ type: "friends" }), 300);
      })
      .subscribe((status) => {
        if (channelUser !== userId) return;
        const now = status === "SUBSCRIBED";
        if (now !== live) { live = now; emit({ type: "live", connected: live }); }
      });
    const beat = () => rpc("aura_heartbeat").catch(() => {});
    beat();
    heartbeat = setInterval(beat, HEARTBEAT_MS);
  }

  // Called by the window when it opens. Safe to call again.
  async function start() {
    const user = await currentUser();
    mediaReady = true; listReady = true; // check again each time AURA starts, in case the SQL has been run since
    if (!authWatched) {
      authWatched = true;
      try { sb().auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") unsubscribe(); }); } catch {}
    }
    subscribe(user.id);
    return { id: user.id, username: user.user_metadata?.username || null, live };
  }
  async function stop() { unsubscribe(); return true; }

  // ── Windows notifications (only while AURA isn't the window in front) ────────
  async function nameOf(userId) {
    if (names.has(userId)) return names.get(userId);
    try { const p = await getProfile(userId); if (p?.username) { names.set(userId, p.username); return p.username; } } catch {}
    return "AURA friend";
  }
  function show(title, body, conversationId) {
    try {
      if (!Notification.isSupported()) return;
      const n = new Notification({ title, body, silent: false });
      n.on("click", () => {
        const win = getWindow();
        if (!win || win.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.show(); win.focus();
        emit({ type: "open", conversationId });
      });
      n.show();
    } catch {}
  }
  async function notify(message) {
    const win = getWindow();
    // When AURA is in front, the window shows its own notice instead
    if (win && !win.isDestroyed() && win.isFocused() && win.isVisible() && !win.isMinimized()) return;
    const key = message.conversationId;
    const q = quiet.get(key);
    if (q && Date.now() < q.until) { q.count++; return; } // one already went out moments ago: count this one
    const sender = await nameOf(message.senderId);
    const entry = { until: Date.now() + NOTIFY_QUIET_MS, count: 0, timer: null };
    entry.timer = setTimeout(() => {
      quiet.delete(key);
      if (entry.count > 0) show(sender, entry.count === 1 ? "Sent another message" : "Sent " + entry.count + " more messages", key);
    }, NOTIFY_QUIET_MS);
    quiet.set(key, entry);
    const text = message.content.replace(/\s+/g, " ").trim() || (message.media ? "Sent a " + mediaWord(message.media).toLowerCase().replace("gif", "GIF") : "");
    show(sender, text.length > 140 ? text.slice(0, 139) + "…" : text, key);
  }

  // Windows needs the app's ID to show notifications under AURA's name
  try {
    if (process.platform === "win32" && app.isPackaged) {
      let appId = "com.aura.launcher";
      try { appId = require("../package.json").build?.appId || appId; } catch {}
      app.setAppUserModelId(appId);
    }
  } catch {}

  // ── What the window may ask for ─────────────────────────────────────────────
  const api = { start, stop, listFriends, findUser, requestFriend, acceptFriend, removeFriend, getProfile, listConversations, openConversation, getMessages, sendMessage, sendMedia, mediaUrls, markRead };
  for (const [name, fn] of Object.entries(api)) ipcMain.handle("social:" + name, cloudHandler(fn));
  return api;
}

module.exports = { register };
