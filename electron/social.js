// AURA friends and messages — the main-process side.
//
// The window never talks to Supabase itself. It asks through preload.js (window.auraSocial),
// those requests arrive here, and this file talks to Supabase as the signed-in user.
// Supabase's own rules (row level security) decide what that user may see or do, so even a
// tampered window can't read someone else's messages.
//
// Added by aura-messages-setup.cjs. Wired up from the main file with one line:
//   require("./social").register({ ipcMain, cloudHandler, cloud: auraCloud, getWindow: () => mainWin, server: (route, body) => auraServer(route, body) });
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
const MEDIA_EXTRA = ",media_path,media_kind,media_mime,media_size,media_width,media_height,media_name";
const MEDIA_SETUP = "Pictures and videos aren't set up in Supabase yet. Run aura-messages-media.sql first.";
// A chat's shared background: a picture both people see behind that conversation
const BACKGROUND_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const BACKGROUND_MAX = 4 * 1024 * 1024; // the window shrinks the picture first, so it is normally far smaller
const SAFETY_SETUP = "Deleting, blocking and reporting aren't set up in Supabase yet. Run aura-messages-safety.sql first.";
const REPORT_REASONS = ["spam", "harassment", "inappropriate", "other"];
const BACKGROUND_SETUP = "Shared chat backgrounds aren't set up in Supabase yet. Run aura-messages-background.sql first.";
// Voice calls. Supabase only carries the ringing and the details two PCs need to find each other;
// the sound goes straight from one PC to the other.
const VOICE_SETUP = "Voice calls aren't set up in Supabase yet. Run aura-messages-voice.sql first.";
const SIGNAL_KINDS = ["offer", "answer", "ice"];
const SIGNAL_MAX = 20000;
// Free public servers that tell a PC its own internet address, so two PCs can connect directly.
// On networks where a direct connection is impossible a relay is needed too: the AURA server
// hands one out if it has been set up (see callConfig below).
const DIRECT_ONLY = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];

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

function register({ ipcMain, cloudHandler, cloud, getWindow, server }) {
  const sb = () => cloud.internals.client();
  const currentUser = () => cloud.internals.currentUser();

  let channel = null;        // the live connection to Supabase
  let bgChannel = null;      // a second one just for chat backgrounds, so it can't disturb the first
  let callChannel = null;    // and a third for voice calls, for the same reason
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
  let backgroundsReady = true;       // same, for shared chat backgrounds
  let deleteReady = true;            // same, for deleted messages
  let liveCall = null;               // id of the call you started or answered on this PC, if any
  let ringing = null;                // { id, note } while a call is ringing and AURA isn't in front
  let relays = null;                 // { at, servers, relay } what callConfig last worked out
  let hangingUp = null;              // a hang-up on its way to Supabase (so closing AURA can wait for it)
  let callsWereDown = false;         // the calls connection dropped: check for a missed ring when it's back

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
    if (/start_call|answer_call|end_call|call_heartbeat|send_call_signal|current_call|voice_calls|voice_signals/.test(msg) && (code === "PGRST202" || code === "PGRST205" || code === "42883" || code === "42P01" || /schema cache|does not exist/i.test(msg))) return new Error(VOICE_SETUP);
    if (/set_conversation_background|conversation_backgrounds/.test(msg) && (code === "PGRST202" || code === "PGRST205" || code === "42883" || code === "42P01" || /schema cache|does not exist/i.test(msg))) return new Error(BACKGROUND_SETUP);
    if (/delete_message|block_user|unblock_user|list_blocked|report_user/.test(msg) && (code === "PGRST202" || code === "42883" || /schema cache|does not exist/i.test(msg))) return new Error(SAFETY_SETUP);
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
    id: m.id, conversationId: m.conversation_id, senderId: m.sender_id, content: m.content || "", createdAt: m.created_at, readAt: m.read_at || null, deleted: !!m.deleted_at,
    media: m.media_path ? { path: m.media_path, kind: m.media_kind, mime: m.media_mime, size: m.media_size || 0, width: m.media_width || null, height: m.media_height || null, name: m.media_name || "" } : null,
  });
  // The words shown where a file has no caption: in the list, in notices
  const mediaWord = (media) => (!media ? "" : media.kind === "video" ? "Video" : media.mime === "image/gif" ? "GIF" : "Photo");
  // Which columns a message has depends on which SQL files have been run. AURA asks for all of
  // them; if Supabase says one is missing, it remembers that and asks again without it.
  const messageCols = () => BASIC_COLS + (mediaReady ? MEDIA_EXTRA : "") + (deleteReady ? ",deleted_at" : "");
  const missingColumn = (error) => String(error?.code || "") === "42703" || /(media_(path|kind|mime|size|width|height|name)|deleted_at).*does not exist/i.test(String(error?.message || ""));
  function withoutMissing(error) {
    if (!missingColumn(error)) return false;
    const msg = String(error?.message || "");
    if (deleteReady && (/deleted_at/.test(msg) || !/media_/.test(msg))) { deleteReady = false; return true; }
    if (mediaReady) { mediaReady = false; return true; }
    return false;
  }
  // Runs a request that names the message columns, stepping down if some aren't there yet.
  // (A request that fails for a missing column changes nothing, so asking again is safe.)
  async function withColumns(run) {
    let res = await run(messageCols());
    for (let i = 0; i < 2 && res.error && withoutMissing(res.error); i++) res = await run(messageCols());
    return res;
  }

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
    const backgrounds = await sharedBackgrounds();
    return rows.map((r) => {
      if (r.username) names.set(r.other_id, r.username);
      return {
        id: r.id, userId: r.other_id, username: r.username || "AURA user", avatarUrl: r.avatar_url || "",
        online: isOnline(r.last_seen_at), isFriend: !!r.is_friend,
        lastMessage: r.last_message || "", lastSenderId: r.last_sender_id || null, lastMessageAt: r.last_message_at, unread: r.unread || 0,
        lastMedia: r.last_media_kind ? mediaWord({ kind: r.last_media_kind, mime: r.last_media_mime }) : "",
        background: backgrounds.get(r.id) || null,
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
    const { data, error } = await withColumns(ask);
    if (error) throw friendly(error);
    const rows = data || [];
    return { messages: rows.slice(0, PAGE_SIZE).reverse().map(shapeMessage), hasMore: rows.length > PAGE_SIZE };
  }

  async function sendMessage(conversationId, content) {
    const user = await currentUser();
    const row = { conversation_id: id(conversationId, "conversation"), sender_id: user.id, content: tidyContent(content) }; // sender is always the signed-in account
    const save = (cols) => sb().from("messages").insert(row).select(cols).single();
    const { data, error } = await withColumns(save);
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
    const { data, error } = await withColumns((cols) => sb().from("messages").insert(row).select(cols).single());
    if (error) throw !mediaReady || missingColumn(error) ? new Error(MEDIA_SETUP) : friendly(error);
    return shapeMessage(data);
  }

  // ── Deleting, blocking, reporting ───────────────────────────────────────────
  // Deletes one of your own messages for both people. Its file goes first: the storage rule lets
  // the sender remove a file only while their message still points at it.
  async function deleteMessage(messageId) {
    const user = await currentUser();
    const mid = id(messageId, "message");
    if (mediaReady) {
      const { data: row, error } = await sb().from("messages").select("id,sender_id,media_path").eq("id", mid).maybeSingle();
      if (error && !missingColumn(error)) throw friendly(error);
      if (row && row.sender_id !== user.id) throw new Error("You can only delete your own messages.");
      if (row?.media_path && MEDIA_PATH.test(row.media_path)) {
        try { await sb().storage.from(MEDIA_BUCKET).remove([row.media_path]); } catch {} // the message is still deleted below
      }
    }
    await rpc("delete_message", { message: mid });
    return true;
  }

  // Blocking removes them from your friends and stops requests and messages both ways. They aren't told.
  const blockUser = async (userId) => rpc("block_user", { target: id(userId, "user") });
  const unblockUser = async (userId) => rpc("unblock_user", { target: id(userId, "user") });
  async function listBlocked() {
    const { data, error } = await sb().rpc("list_blocked");
    if (error) {
      const set = friendly(error);
      if (set.message === SAFETY_SETUP) return []; // not set up yet: nobody is blocked
      throw set;
    }
    return (data || []).map((r) => ({ userId: r.user_id, username: r.username || "AURA user", avatarUrl: r.avatar_url || "", blockedAt: r.blocked_at }));
  }

  // report: { reason, details, messageId, block }. Goes to the reports table, which only the
  // person running AURA can read. With a message, Supabase keeps a copy of it for review.
  async function reportUser(userId, report) {
    const target = id(userId, "user");
    const reason = String(report?.reason || "");
    if (!REPORT_REASONS.includes(reason)) throw new Error("Pick a reason for the report.");
    const details = String(report?.details ?? "").replace(/\r\n?/g, "\n").trim();
    if (details.length > 1000) throw new Error("Keep the details under 1,000 characters.");
    await rpc("report_user", { target, why: reason, more: details || null, message: report?.messageId ? id(report.messageId, "message") : null });
    if (report?.block) await rpc("block_user", { target });
    return true;
  }

  // ── A chat's shared background ──────────────────────────────────────────────
  const missingTable = (error) => /^(42P01|PGRST205)$/.test(String(error?.code || "")) || /does not exist|schema cache/i.test(String(error?.message || ""));
  // The background each of your chats has, if any. Supabase only returns your own conversations'.
  async function sharedBackgrounds() {
    const found = new Map();
    if (!backgroundsReady) return found;
    const { data, error } = await sb().from("conversation_backgrounds").select("conversation_id,path,set_by");
    if (error) {
      // Not set up yet: remember that, so setting one can say so. Any other trouble: chats simply show none for now.
      if (missingTable(error)) backgroundsReady = false;
      return found;
    }
    for (const row of data || []) if (row.path && MEDIA_PATH.test(row.path)) found.set(row.conversation_id, { path: row.path, by: row.set_by || null });
    return found;
  }

  // Sets the picture both people see behind this chat. file: { name, bytes }, or null to remove it.
  async function setBackground(conversationId, file) {
    const user = await currentUser();
    const cid = id(conversationId, "conversation");
    let path = null;
    if (file) {
      const raw = file.bytes || file.data;
      if (!raw || typeof raw === "string") throw new Error("That picture couldn't be read.");
      const bytes = Buffer.isBuffer(raw) ? raw : ArrayBuffer.isView(raw) ? Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength) : Buffer.from(raw);
      const mime = sniff(bytes);
      const ext = mime && BACKGROUND_TYPES[mime];
      if (!ext) throw new Error("A background has to be a picture (PNG, JPG or WebP).");
      if (bytes.length > BACKGROUND_MAX) throw new Error("That picture is too big for a background (" + megabytes(bytes.length) + "). Try a smaller one.");
      // Check the table is there before uploading, so a picture is never left behind unused
      const ready = await sb().from("conversation_backgrounds").select("conversation_id").limit(1);
      if (ready.error) throw missingTable(ready.error) ? new Error(BACKGROUND_SETUP) : friendly(ready.error);
      path = cid + "/" + require("crypto").randomUUID() + "." + ext;
      const up = await sb().storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: mime, cacheControl: "31536000", upsert: false });
      if (up.error) throw /row-level security/i.test(String(up.error.message || "")) ? new Error("You can only set a background for a chat with a friend.") : friendly(up.error);
    }
    const { error } = await sb().rpc("set_conversation_background", { conversation: cid, picture: path });
    if (error) throw friendly(error);
    backgroundsReady = true;
    return path ? { path, by: user.id } : null;
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

  // ── Voice calls ─────────────────────────────────────────────────────────────
  // Supabase decides who may call whom (friends only) and keeps each call's state. Everything
  // here runs as the signed-in user, so the rules in aura-messages-voice.sql always apply.
  const shapeCall = (c, me) => ({
    id: c.id, callerId: c.caller_id, calleeId: c.callee_id, peerId: c.caller_id === me ? c.callee_id : c.caller_id, outgoing: c.caller_id === me,
    status: c.status, reason: c.end_reason || null, createdAt: c.created_at, answeredAt: c.answered_at || null, endedAt: c.ended_at || null,
  });
  const shapeSignal = (s) => ({ id: Number(s.id), kind: s.kind, payload: String(s.payload || "") });
  const one = (data) => (Array.isArray(data) ? data[0] || null : data || null);

  async function startCall(userId) {
    const user = await currentUser();
    const call = shapeCall(one(await rpc("start_call", { target: id(userId, "user") })), user.id);
    liveCall = call.id;
    return call;
  }
  async function answerCall(callId) {
    const user = await currentUser();
    const call = shapeCall(one(await rpc("answer_call", { the_call: id(callId, "call") })), user.id);
    liveCall = call.id;
    stopRinging(call.id);
    return call;
  }
  // Decline, cancel or hang up. reason: "missed" (nobody picked up) or "failed" (couldn't connect).
  function endCall(callId, reason) {
    const work = (async () => {
      const user = await currentUser();
      const cid = id(callId, "call");
      stopRinging(cid);
      const row = await rpc("end_call", { the_call: cid, why: reason === "missed" || reason === "failed" ? reason : null });
      if (liveCall === cid) liveCall = null; // only once Supabase has it
      return shapeCall(one(row), user.id);
    })();
    // Noted straight away, so that if AURA is closing it can wait for this to arrive first
    const settled = work.then(() => {}, () => {}).then(() => { if (hangingUp === settled) hangingUp = null; });
    hangingUp = settled;
    return work;
  }
  // Passes connection details to the other PC. Supabase refuses them until the call is accepted.
  async function callSignal(callId, kind, payload) {
    if (!SIGNAL_KINDS.includes(kind)) throw new Error("That isn't a valid call message.");
    if (typeof payload !== "string" || !payload || payload.length > SIGNAL_MAX) throw new Error("That call message is too long.");
    return Number(await rpc("send_call_signal", { the_call: id(callId, "call"), what: kind, body: payload }));
  }
  // Where a call stands, plus any connection details sent to you after number `after`.
  // The window asks this now and then, so nothing is lost if a live update goes missing.
  async function callState(callId, after) {
    const user = await currentUser();
    const cid = id(callId, "call");
    const { data: row, error } = await sb().from("voice_calls").select("*").eq("id", cid).maybeSingle();
    if (error) throw friendly(error);
    if (!row) return { call: null, signals: [] };
    let signals = [];
    if (row.status === "active") {
      const from = Number.isSafeInteger(after) && after > 0 ? after : 0;
      const res = await sb().from("voice_signals").select("id,kind,payload").eq("call_id", cid).gt("id", from).order("id", { ascending: true }).limit(200);
      if (res.error) throw friendly(res.error);
      signals = (res.data || []).map(shapeSignal);
    }
    if (row.status === "ended") { stopRinging(cid); if (liveCall === cid) liveCall = null; }
    return { call: shapeCall(row, user.id), signals };
  }
  // "Still here." Answers with the call's status: "active", or "ended" once it is over.
  const callBeat = async (callId) => rpc("call_heartbeat", { the_call: id(callId, "call") });
  // The call you are in, or one ringing for you (AURA asks when it starts)
  async function currentCall() {
    const user = await currentUser();
    const { data, error } = await sb().rpc("current_call");
    if (error) {
      const set = friendly(error);
      if (set.message === VOICE_SETUP) return null; // not set up yet: there is no call
      throw set;
    }
    const row = one(data);
    return row ? shapeCall(row, user.id) : null;
  }

  // The servers a call uses to connect two PCs. Only addresses of the right kind are passed on.
  function cleanServers(list) {
    if (!Array.isArray(list)) return null;
    // stun:host[:port]  or  turn(s):host[:port][?transport=udp|tcp]. Anything else is dropped.
    const HOST = "(\\[[0-9A-Fa-f:.]+\\]|[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(:\\d{1,5})?";
    const STUN_URL = new RegExp("^stun:" + HOST + "$"), TURN_URL = new RegExp("^turns?:" + HOST + "(\\?transport=(udp|tcp))?$");
    const ok = (u) => typeof u === "string" && u.length <= 200 && (STUN_URL.test(u) || TURN_URL.test(u));
    const text = (v) => (typeof v === "string" && v.length <= 600 ? v : undefined);
    const out = [];
    for (const item of list.slice(0, 6)) {
      const urls = (Array.isArray(item?.urls) ? item.urls : [item?.urls]).filter(ok).slice(0, 8);
      if (!urls.length) continue;
      const relay = urls.some((u) => /^turns?:/.test(u));
      const username = text(item.username), credential = text(item.credential);
      if (relay && (!username || !credential)) continue; // a relay without its login is no use
      out.push(relay ? { urls, username, credential } : { urls });
    }
    return out.length ? out : null;
  }
  // { iceServers, relay }. relay is true when a relay is available, so calls also work on
  // networks that don't allow a direct connection.
  async function callConfig() {
    await currentUser();
    if (relays && Date.now() - relays.at < (relays.relay ? 10 : 30) * 60 * 1000) return { iceServers: relays.servers, relay: relays.relay };
    let servers = null;
    if (typeof server === "function") {
      try {
        const res = await Promise.race([server("/api/voice/ice", {}), new Promise((resolve) => setTimeout(() => resolve(null), 5000))]);
        if (res && res.success) servers = cleanServers(res.iceServers);
      } catch {}
    }
    const relay = !!servers && servers.some((s) => s.urls.some((u) => /^turns?:/.test(u)));
    relays = { at: Date.now(), servers: servers || DIRECT_ONLY, relay };
    return { iceServers: relays.servers, relay };
  }

  // A call is ringing for you. The window shows it and plays the ring; when AURA isn't the window
  // in front, Windows shows a notification as well and AURA's taskbar button flashes.
  async function ring(call) {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    if (win.isFocused() && win.isVisible() && !win.isMinimized()) return;
    stopRinging();
    const entry = { id: call.id, note: null };
    ringing = entry;
    try { win.flashFrame(true); } catch {}
    const caller = await nameOf(call.peerId);
    if (ringing !== entry) return; // answered or ended while the name was being looked up
    try {
      if (!Notification.isSupported()) return;
      const n = new Notification({ title: caller + " is calling", body: "Open AURA to answer.", silent: true }); // the window is already ringing
      n.on("click", () => {
        const w = getWindow();
        if (!w || w.isDestroyed()) return;
        if (w.isMinimized()) w.restore();
        w.show(); w.focus();
      });
      n.show();
      entry.note = n;
    } catch {}
  }
  function stopRinging(callId) {
    if (!ringing || (callId && ringing.id !== callId)) return;
    const was = ringing;
    ringing = null;
    try { was.note?.close(); } catch {}
    try { const win = getWindow(); if (win && !win.isDestroyed()) win.flashFrame(false); } catch {}
  }

  // Closing AURA in the middle of a call hangs up first (waiting at most a second), so the other
  // person isn't left listening to silence.
  try {
    let leaving = false;
    if (typeof app.on === "function") app.on("will-quit", (event) => {
      if (leaving || (!liveCall && !hangingUp)) return;
      leaving = true;
      const cid = liveCall;
      liveCall = null;
      event.preventDefault();
      const carryOn = () => { try { app.quit(); } catch {} }; // whatever happens below, AURA still closes
      // Either the window has already sent the hang-up (wait for it to arrive), or it is sent now
      let hungUp = hangingUp || Promise.resolve();
      try { if (!hangingUp && cid) hungUp = Promise.resolve(sb().rpc("end_call", { the_call: cid, why: null })).then(() => {}, () => {}); } catch {}
      Promise.race([hungUp, new Promise((resolve) => setTimeout(resolve, 1000))]).then(carryOn, carryOn);
    });
  } catch {}

  // ── Live updates ────────────────────────────────────────────────────────────
  function unsubscribe() {
    clearInterval(heartbeat); heartbeat = null;
    clearTimeout(friendsTimer); friendsTimer = null;
    for (const q of quiet.values()) clearTimeout(q.timer);
    quiet.clear(); names.clear(); friendshipIds.clear();
    stopRinging();
    liveCall = null; relays = null; callsWereDown = false; // (a relay's login isn't kept for the next account)
    const old = [channel, bgChannel, callChannel];
    channel = null; bgChannel = null; callChannel = null; channelUser = null; live = false;
    for (const ch of old) if (ch) { try { sb().removeChannel(ch); } catch {} }
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
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
        // A message changing means it was read or deleted. Only deletions matter to the window.
        if (channelUser !== userId || !payload?.new?.id || !payload.new.deleted_at) return;
        emit({ type: "deleted", message: shapeMessage(payload.new) });
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
    // Chat backgrounds changing. On its own channel: if that table isn't set up yet, only this
    // channel fails and messages stay live. Supabase delivers a row only to the two people in the chat.
    bgChannel = sb().channel("aura-social-bg:" + userId)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_backgrounds" }, (payload) => {
        const row = payload?.new;
        if (channelUser !== userId || payload?.eventType === "DELETE" || !row?.conversation_id) return;
        const path = row.path && MEDIA_PATH.test(row.path) ? row.path : "";
        emit({ type: "background", conversationId: row.conversation_id, background: path ? { path, by: row.set_by || null } : null, by: row.set_by || null });
      })
      .subscribe();
    // Voice calls: a call starting, being answered or ending, and the connection details the
    // other PC sends. Supabase delivers a call only to the two people in it.
    const onCall = (payload) => {
      const row = payload?.new;
      if (channelUser !== userId || !row?.id || (row.caller_id !== userId && row.callee_id !== userId)) return;
      const call = shapeCall(row, userId);
      emit({ type: "call", call });
      if (call.status === "ringing" && !call.outgoing && payload.eventType === "INSERT") ring(call);
      else if (call.status !== "ringing") stopRinging(call.id);
      if (call.status === "ended" && liveCall === call.id) liveCall = null;
    };
    callChannel = sb().channel("aura-social-calls:" + userId)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "voice_calls" }, onCall)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "voice_calls" }, onCall)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "voice_signals" }, (payload) => {
        const row = payload?.new;
        if (channelUser !== userId || !row?.id || row.recipient_id !== userId) return;
        emit({ type: "signal", callId: row.call_id, signal: shapeSignal(row) });
      })
      .subscribe((status) => {
        if (channelUser !== userId) return;
        if (status !== "SUBSCRIBED") { callsWereDown = true; return; }
        if (!callsWereDown) return;
        // Back after a drop: a call may have started ringing in the meantime
        callsWereDown = false;
        currentCall().then((call) => {
          if (channelUser !== userId || !call || call.status !== "ringing" || call.outgoing) return;
          emit({ type: "call", call });
          ring(call);
        }).catch(() => {});
      });
    const beat = () => rpc("aura_heartbeat").catch(() => {});
    beat();
    heartbeat = setInterval(beat, HEARTBEAT_MS);
  }

  // Called by the window when it opens. Safe to call again.
  async function start() {
    const user = await currentUser();
    mediaReady = true; listReady = true; backgroundsReady = true; deleteReady = true; // check again each time AURA starts, in case the SQL has been run since
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
  const api = { start, stop, listFriends, findUser, requestFriend, acceptFriend, removeFriend, getProfile, listConversations, openConversation, getMessages, sendMessage, sendMedia, mediaUrls, setBackground, deleteMessage, blockUser, unblockUser, listBlocked, reportUser, markRead, startCall, answerCall, endCall, callSignal, callState, callBeat, currentCall, callConfig };
  for (const [name, fn] of Object.entries(api)) ipcMain.handle("social:" + name, cloudHandler(fn));
  return api;
}

module.exports = { register };
