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
    if (code === "PGRST202" || code === "PGRST205" || code === "42883" || code === "42P01" || /schema cache|does not exist/i.test(msg)) {
      return new Error("Messages aren't set up in Supabase yet. Run the messages SQL first.");
    }
    if (/row-level security|permission denied/i.test(msg)) return new Error("You can only message friends.");
    if (code === "23514") return new Error("That message is empty or too long.");
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

  const shapeMessage = (m) => ({ id: m.id, conversationId: m.conversation_id, senderId: m.sender_id, content: m.content, createdAt: m.created_at, readAt: m.read_at || null });

  // Keep line breaks inside a message, but drop blank lines and spaces around it
  function tidyContent(raw) {
    const text = String(raw ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/^\s+|\s+$/g, "").replace(/\n{4,}/g, "\n\n\n");
    if (!text.trim()) throw new Error("Type a message first.");
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
    const rows = (await rpc("list_conversations")) || [];
    return rows.map((r) => {
      if (r.username) names.set(r.other_id, r.username);
      return {
        id: r.id, userId: r.other_id, username: r.username || "AURA user", avatarUrl: r.avatar_url || "",
        online: isOnline(r.last_seen_at), isFriend: !!r.is_friend,
        lastMessage: r.last_message || "", lastSenderId: r.last_sender_id || null, lastMessageAt: r.last_message_at, unread: r.unread || 0,
      };
    });
  }

  const openConversation = async (userId) => rpc("open_conversation", { other: id(userId, "user") });

  // The newest messages, or the ones before a given time when scrolling back
  async function getMessages(conversationId, before) {
    let query = sb().from("messages").select("id,conversation_id,sender_id,content,created_at,read_at")
      .eq("conversation_id", id(conversationId, "conversation"))
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE_SIZE + 1);
    if (before) {
      const when = new Date(before);
      if (isNaN(when.getTime())) throw new Error("That date isn't valid.");
      query = query.lt("created_at", when.toISOString());
    }
    const { data, error } = await query;
    if (error) throw friendly(error);
    const rows = data || [];
    return { messages: rows.slice(0, PAGE_SIZE).reverse().map(shapeMessage), hasMore: rows.length > PAGE_SIZE };
  }

  async function sendMessage(conversationId, content) {
    const user = await currentUser();
    const { data, error } = await sb().from("messages")
      .insert({ conversation_id: id(conversationId, "conversation"), sender_id: user.id, content: tidyContent(content) }) // sender is always the signed-in account
      .select("id,conversation_id,sender_id,content,created_at,read_at").single();
    if (error) throw friendly(error);
    return shapeMessage(data);
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
    const text = message.content.replace(/\s+/g, " ").trim();
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
  const api = { start, stop, listFriends, findUser, requestFriend, acceptFriend, removeFriend, getProfile, listConversations, openConversation, getMessages, sendMessage, markRead };
  for (const [name, fn] of Object.entries(api)) ipcMain.handle("social:" + name, cloudHandler(fn));
  return api;
}

module.exports = { register };
