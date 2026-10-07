/**
 * AURA — friends and messages
 *
 * Everything the window needs for AURA friends and direct messages:
 *   - useAuraSocial     started once in AuraApp: loads your friends and conversations, listens
 *                       for live updates, shows in-app notices, and returns the unread count
 *   - MessagesPage      the Messages page (frosted glass, with its own colors and background),
 *                       including pictures, GIFs and videos
 *   - AuraFriendsTab    the "AURA" tab in the Friends panel: add friends, requests, Message
 *   - MessagesIcon      the icon used in the left menu
 *
 * It also covers deleting your own messages, blocking people and reporting them, and it is where
 * voice calls are started from (the calls themselves live in components/calls).
 *
 * The window never talks to Supabase directly. It asks through window.auraSocial (preload.js),
 * which is answered by electron/social.js.
 *
 * Added by aura-messages-setup.cjs.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { PrivacyButton } from "./privacy";
import { CallButton, IconPhone, MISSED_CALL, callActions, callHooks, callsAvailable, mountCallLayer, useCall } from "./calls";

// ── Talking to the main process ───────────────────────────────────────────────
async function call(name, ...args) {
  const fn = window.auraSocial?.[name];
  if (typeof fn !== "function") throw new Error("Messages only work in the AURA desktop app.");
  const res = await fn(...args);
  if (!res?.success) throw new Error(res?.error || "Something went wrong.");
  return res.data;
}

// ── One shared store, so the page, the Friends tab and the menu badge all agree ──
const blank = () => ({
  ready: false, me: null, live: false, everLive: false,
  friends: [], friendsLoaded: false, friendsError: "",
  conversations: [], conversationsLoaded: false, conversationsError: "",
  threads: {},          // conversation id -> { items, hasMore, loading, loadingOlder, error, loaded }
  media: {},            // file path -> { url, at, life } viewing links, fetched as files come on screen
  blocked: [],          // people you have blocked
  activeId: null, pageOpen: false,
});
let state = blank();
const listeners = new Set();
const hooks = { toast: null, goToMessages: null }; // set by useAuraSocial
const set = (patch) => { state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }; listeners.forEach((l) => l()); };
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const useSocial = () => useSyncExternalStore(subscribe, () => state);
const thread = (id) => state.threads[id] || { items: [], hasMore: false, loading: false, loadingOlder: false, error: "", loaded: false };
const setThread = (id, patch) => set((s) => ({ threads: { ...s.threads, [id]: { ...thread(id), ...(typeof patch === "function" ? patch(thread(id)) : patch) } } }));
const sortByNewest = (list) => [...list].sort((a, b) => Date.parse(b.lastMessageAt || 0) - Date.parse(a.lastMessageAt || 0));
const isLooking = (conversationId) => state.pageOpen && state.activeId === conversationId && document.hasFocus();

let tempCounter = 0;
const readTimers = {};
const lastNotice = {};

const actions = {
  async refreshFriends() {
    try {
      const before = new Set(state.friends.filter((f) => f.state === "incoming").map((f) => f.friendshipId));
      const friends = await call("listFriends");
      const wasLoaded = state.friendsLoaded;
      set({ friends, friendsLoaded: true, friendsError: "" });
      // Tell the user about requests that weren't there a moment ago
      if (wasLoaded) for (const f of friends) if (f.state === "incoming" && !before.has(f.friendshipId)) hooks.toast?.(`${f.username} sent you a friend request`);
    } catch (e) { set({ friendsLoaded: true, friendsError: e.message }); }
  },

  async refreshBlocked() {
    try { set({ blocked: await call("listBlocked") }); } catch {}
  },

  async refreshConversations() {
    try {
      const conversations = await call("listConversations");
      set({ conversations, conversationsLoaded: true, conversationsError: "" });
    } catch (e) { set({ conversationsLoaded: true, conversationsError: e.message }); }
  },

  // Open a conversation that already exists
  async open(conversationId) {
    set({ activeId: conversationId });
    if (!conversationId) return;
    const t = thread(conversationId);
    if (!t.loaded && !t.loading) await actions.loadThread(conversationId);
    actions.markRead(conversationId);
  },

  // Open (or start) the conversation with a friend, and go to the Messages page
  async openWith(userId) {
    try {
      const conversationId = await call("openConversation", userId);
      if (!state.conversations.some((c) => c.id === conversationId)) await actions.refreshConversations();
      hooks.goToMessages?.();
      await actions.open(conversationId);
    } catch (e) { hooks.toast?.(e.message, "err"); }
  },

  async loadThread(conversationId) {
    setThread(conversationId, { loading: true, error: "" });
    try {
      const { messages, hasMore } = await call("getMessages", conversationId);
      // Keep anything still being sent
      setThread(conversationId, (t) => ({ items: [...messages, ...t.items.filter((m) => m.pending || m.failed)], hasMore, loading: false, loaded: true }));
    } catch (e) { setThread(conversationId, { loading: false, error: e.message }); }
  },

  async loadOlder(conversationId) {
    const t = thread(conversationId);
    if (!t.hasMore || t.loadingOlder || !t.items.length) return;
    setThread(conversationId, { loadingOlder: true });
    try {
      const { messages, hasMore } = await call("getMessages", conversationId, t.items[0].createdAt);
      setThread(conversationId, (cur) => {
        const known = new Set(cur.items.map((m) => m.id));
        return { items: [...messages.filter((m) => !known.has(m.id)), ...cur.items], hasMore, loadingOlder: false };
      });
    } catch (e) { setThread(conversationId, { loadingOlder: false }); hooks.toast?.(e.message, "err"); }
  },

  // Shows the message straight away, then confirms it once Supabase has it
  async send(conversationId, text, retryOf) {
    const content = tidy(text);
    if (!content || !state.me) return false;
    const tempId = retryOf || `sending-${++tempCounter}`;
    const draft = { id: tempId, conversationId, senderId: state.me.id, content, createdAt: new Date().toISOString(), readAt: null, pending: true, failed: false };
    setThread(conversationId, (t) => ({ items: [...t.items.filter((m) => m.id !== tempId), draft] }));
    try {
      const saved = await call("sendMessage", conversationId, content);
      setThread(conversationId, (t) => ({ items: mergeMessage(t.items.filter((m) => m.id !== tempId), saved) }));
      touchConversation(saved, false);
      return true;
    } catch (e) {
      setThread(conversationId, (t) => ({ items: t.items.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true, error: e.message } : m)) }));
      return false;
    }
  },
  discard(conversationId, tempId) { setThread(conversationId, (t) => ({ items: t.items.filter((m) => m.id !== tempId) })); },

  // Sends a picture, GIF or video. `attachment` comes from readAttachment() below.
  async sendMedia(conversationId, attachment, caption, retryOf) {
    if (!attachment?.file || !state.me) return false;
    const content = tidy(caption);
    const tempId = retryOf || `sending-${++tempCounter}`;
    const draft = {
      id: tempId, conversationId, senderId: state.me.id, content, createdAt: new Date().toISOString(), readAt: null, pending: true, failed: false, attachment,
      media: { path: "", kind: attachment.kind, mime: attachment.mime, size: attachment.size, width: attachment.width, height: attachment.height, name: attachment.name, local: attachment.url },
    };
    setThread(conversationId, (t) => ({ items: [...t.items.filter((m) => m.id !== tempId), draft] }));
    try {
      const bytes = new Uint8Array(await attachment.file.arrayBuffer());
      const saved = await call("sendMedia", conversationId, { name: attachment.name, bytes, width: attachment.width, height: attachment.height }, content);
      // You already have the file, so show your own copy instead of downloading it back
      if (saved.media?.path) set((s) => ({ media: { ...s.media, [saved.media.path]: { url: attachment.url, at: Date.now(), life: Infinity } } }));
      setThread(conversationId, (t) => ({ items: mergeMessage(t.items.filter((m) => m.id !== tempId), saved) }));
      touchConversation(saved, false);
      return true;
    } catch (e) {
      setThread(conversationId, (t) => ({ items: t.items.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true, error: e.message } : m)) }));
      return false;
    }
  },

  // The picture both people see behind one chat. `file` is a picture from this PC, or null to remove it.
  async setBackground(conversationId, file) {
    let payload = null, local = "";
    if (file) {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type || "")) throw new Error("Choose a picture (PNG, JPG or WebP).");
      try { local = await shrinkPicture(file, 1920, 0.84); } catch { throw new Error("That picture couldn't be opened. Try a PNG or JPG."); }
      const raw = atob(local.slice(local.indexOf(",") + 1));
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      payload = { name: "background.jpg", bytes };
    }
    const saved = await call("setBackground", conversationId, payload);
    // You already have the picture, so show your own copy instead of downloading it back
    if (saved?.path && local) set((s) => ({ media: { ...s.media, [saved.path]: { url: local, at: Date.now(), life: Infinity } } }));
    applyBackground(conversationId, saved || null);
    return saved || null;
  },

  // Deletes one of your own messages for both people
  async deleteMessage(conversationId, messageId) {
    await call("deleteMessage", messageId);
    applyDeleted({ id: messageId, conversationId });
  },

  // Blocks someone: no more messages or friend requests either way. They aren't told.
  async block(person) {
    callActions.endWith(person.userId); // a call with them ends too
    await call("blockUser", person.userId);
    callActions.endWith(person.userId); // (and one they started in that instant)
    const open = state.conversations.find((c) => c.id === state.activeId);
    if (open && open.userId === person.userId) set({ activeId: null });
    await Promise.all([actions.refreshBlocked(), actions.refreshFriends(), actions.refreshConversations()]);
  },
  async unblock(person) {
    await call("unblockUser", person.userId);
    await Promise.all([actions.refreshBlocked(), actions.refreshConversations()]);
  },
  // report: { reason, details, messageId, block }
  async report(person, report) {
    await call("reportUser", person.userId, report);
    if (report.block) {
      callActions.endWith(person.userId);
      const open = state.conversations.find((c) => c.id === state.activeId);
      if (open && open.userId === person.userId) set({ activeId: null });
      await Promise.all([actions.refreshBlocked(), actions.refreshFriends(), actions.refreshConversations()]);
    }
  },

  // Asks for a viewing link for a file. Requests made close together go out as one.
  needMedia(path, again) {
    if (!path) return;
    const have = state.media[path];
    if (have && !again && Date.now() - have.at < have.life) return;
    if (!again && Date.now() - (mediaAsked[path] || 0) < 15000) return;
    mediaAsked[path] = Date.now();
    mediaWanted.add(path);
    clearTimeout(mediaTimer);
    mediaTimer = setTimeout(fetchMedia, 40);
  },

  // Marks what the other person sent as read (a moment after you look at it)
  markRead(conversationId) {
    const c = state.conversations.find((x) => x.id === conversationId);
    if (!c || !c.unread || !isLooking(conversationId)) return;
    set((s) => ({ conversations: s.conversations.map((x) => (x.id === conversationId ? { ...x, unread: 0 } : x)) }));
    clearTimeout(readTimers[conversationId]);
    readTimers[conversationId] = setTimeout(() => call("markRead", conversationId).catch(() => {}), 250);
  },

  // Something arrived from the main process
  onEvent(event) {
    if (!event || !state.me) return;
    if (event.type === "message") return onMessage(event.message);
    if (event.type === "call" || event.type === "signal") return callActions.onEvent(event); // voice calls
    if (event.type === "friends") { actions.refreshFriends(); actions.refreshConversations(); actions.refreshBlocked(); return; }
    if (event.type === "deleted") { if (event.message?.id) applyDeleted(event.message); return; }
    if (event.type === "open") { hooks.goToMessages?.(); actions.open(event.conversationId); return; }
    if (event.type === "background") {
      const c = state.conversations.find((x) => x.id === event.conversationId);
      if (!c) { actions.refreshConversations(); return; }
      const now = event.background?.path || "";
      if ((c.background?.path || "") === now) return; // already showing it (your own change)
      applyBackground(event.conversationId, event.background || null);
      if (event.by && event.by !== state.me.id) hooks.toast?.(`${c.username} ${now ? "changed" : "removed"} the background of your chat`);
      return;
    }
    if (event.type === "live") {
      const cameBack = event.connected && state.everLive && !state.live;
      set({ live: !!event.connected, everLive: state.everLive || !!event.connected });
      if (cameBack) actions.catchUp(); // pick up anything missed while disconnected
    }
  },

  async catchUp() {
    callActions.resume(); // a call may have started ringing while live updates were down
    await Promise.all([actions.refreshConversations(), actions.refreshFriends(), actions.refreshBlocked()]);
    if (state.activeId) { await actions.loadThread(state.activeId); actions.markRead(state.activeId); }
  },
};

// A message was deleted (by you, or by the other person): its words and file go, its place stays
function applyDeleted(message) {
  const t = state.threads[message.conversationId];
  const was = t?.items.find((m) => m.id === message.id);
  if (was && !was.deleted) setThread(message.conversationId, (cur) => ({ items: cur.items.map((m) => (m.id === message.id ? { ...m, content: "", media: null, deleted: true } : m)) }));
  if (!was || !was.deleted) actions.refreshConversations(); // the list's preview and unread count may have been about it
}
// Conversations with people you've blocked are kept out of sight until you unblock them
const visibleConversations = (s) => (s.blocked.length ? s.conversations.filter((c) => !s.blocked.some((b) => b.userId === c.userId)) : s.conversations);

function applyBackground(conversationId, background) {
  set((s) => ({ conversations: s.conversations.map((c) => (c.id === conversationId ? { ...c, background: background?.path ? background : null } : c)) }));
}

const mediaWanted = new Set();
const mediaAsked = {};
let mediaTimer = null;
async function fetchMedia() {
  const paths = [...mediaWanted];
  mediaWanted.clear();
  if (!paths.length) return;
  const now = Date.now();
  try {
    const { urls, seconds } = await call("mediaUrls", paths);
    const life = Math.max(60, seconds || 3600) * 800; // ask again a little before the link runs out
    // A file you sent or set yourself keeps showing from your own copy, even if a link was asked for meanwhile
    set((s) => ({ media: { ...s.media, ...Object.fromEntries(paths.filter((p) => s.media[p]?.life !== Infinity).map((p) => [p, urls?.[p] ? { url: urls[p], at: now, life } : { url: "", at: now, life: 60000, missing: true }])) } }));
  } catch (e) {
    set((s) => ({ media: { ...s.media, ...Object.fromEntries(paths.filter((p) => !s.media[p]?.url).map((p) => [p, { url: "", at: now, life: 0, error: e.message }])) } }));
  }
}

// "Photo", "GIF" or "Video": what a file is called where there are no words to show
const mediaWord = (media) => (!media ? "" : media.kind === "video" ? "Video" : media.mime === "image/gif" ? "GIF" : "Photo");
const sizeText = (n) => (n >= 1048576 ? (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

// What can be attached. The main process checks again from the file's own bytes.
const MEDIA_LIMITS = { image: 10 * 1024 * 1024, video: 50 * 1024 * 1024 };
const MEDIA_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime,.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.mov";
const MAX_ATTACHMENTS = 6;
let attachmentCounter = 0;
function kindOf(file) {
  const type = String(file?.type || "").toLowerCase();
  const ext = (String(file?.name || "").toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
  if (/^image\/(png|jpeg|gif|webp)$/.test(type) || (!type && /^(png|jpe?g|gif|webp)$/.test(ext))) return { kind: "image", mime: type || "image/" + (ext === "jpg" ? "jpeg" : ext) };
  if (/^video\/(mp4|webm|quicktime)$/.test(type) || (!type && /^(mp4|webm|mov)$/.test(ext))) return { kind: "video", mime: type || (ext === "mov" ? "video/quicktime" : "video/" + ext) };
  return null;
}
// Reads a chosen, pasted or dropped file: what it is, how big, and its width and height
// (so the chat can keep the right amount of room for it before it has loaded).
async function readAttachment(file) {
  const what = kindOf(file);
  const name = file?.name || "file";
  if (!what) throw new Error(`"${name}" can't be sent. Pictures (PNG, JPG, WebP), GIFs and videos (MP4, WebM, MOV) only.`);
  if (!file.size) throw new Error(`"${name}" is empty.`);
  if (file.size > MEDIA_LIMITS[what.kind]) throw new Error(`"${name}" is ${sizeText(file.size)}. ${what.kind === "video" ? "Videos" : "Pictures and GIFs"} can be up to ${sizeText(MEDIA_LIMITS[what.kind])}.`);
  const url = URL.createObjectURL(file);
  const size = await new Promise((resolve) => {
    const done = (w, h) => resolve(w > 0 && h > 0 ? { width: w, height: h } : { width: null, height: null });
    const giveUp = setTimeout(() => done(0, 0), 4000);
    if (what.kind === "image") {
      const img = new Image();
      img.onload = () => { clearTimeout(giveUp); done(img.naturalWidth, img.naturalHeight); };
      img.onerror = () => { clearTimeout(giveUp); done(0, 0); };
      img.src = url;
    } else {
      const v = document.createElement("video");
      v.preload = "metadata"; v.muted = true;
      v.onloadedmetadata = () => { clearTimeout(giveUp); done(v.videoWidth, v.videoHeight); };
      v.onerror = () => { clearTimeout(giveUp); done(0, 0); };
      v.src = url;
    }
  });
  return { id: `att-${++attachmentCounter}`, file, url, name, size: file.size, ...what, ...size };
}

function mergeMessage(items, message) {
  if (items.some((m) => m.id === message.id)) return items;
  const out = [...items, message];
  // Confirmed messages in time order, anything still sending stays at the end
  return [...out.filter((m) => !m.pending && !m.failed).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)), ...out.filter((m) => m.pending || m.failed)];
}

function touchConversation(message, countUnread) {
  set((s) => ({
    conversations: sortByNewest(s.conversations.map((c) => (c.id !== message.conversationId ? c : {
      ...c, lastMessage: message.content.slice(0, 160), lastMedia: mediaWord(message.media), lastSenderId: message.senderId, lastMessageAt: message.createdAt,
      unread: countUnread ? c.unread + 1 : c.unread,
    }))),
  }));
}

function onMessage(message) {
  const mine = message.senderId === state.me.id;
  const conversation = state.conversations.find((c) => c.id === message.conversationId);
  const t = state.threads[message.conversationId];
  if (t?.loaded) {
    if (t.items.some((m) => m.id === message.id)) return; // already have it (our own send, confirmed)
    // Our own message arriving live before the send call answered: it replaces the "sending" copy
    const twin = !mine ? null : t.items.find((m) => m.pending && m.content === message.content
      && (message.media ? !!m.media && m.media.size === message.media.size && (m.media.name || "") === (message.media.name || "") : !m.media));
    // Keep showing your own copy of a file you just sent
    if (twin?.media?.local && message.media?.path) set((s) => ({ media: { ...s.media, [message.media.path]: { url: twin.media.local, at: Date.now(), life: Infinity } } }));
    setThread(message.conversationId, (cur) => ({ items: mergeMessage(twin ? cur.items.filter((m) => m.id !== twin.id) : cur.items, message) }));
  }
  const listed = conversation ? null : actions.refreshConversations(); // a brand-new conversation: fetch the list to get it
  if (conversation) touchConversation(message, !mine && !isLooking(message.conversationId));
  if (mine) return;
  if (isLooking(message.conversationId)) { actions.markReadNow(message.conversationId); return; }
  // In-app notice, at most one per conversation every few seconds. If AURA isn't the window in
  // front, the main process shows a Windows notification instead.
  if (!document.hasFocus()) return;
  if (message.content === MISSED_CALL) return; // the call bar has just said so
  const now = Date.now();
  if (now - (lastNotice[message.conversationId] || 0) < 4000) return;
  lastNotice[message.conversationId] = now;
  const text = message.content.replace(/\s+/g, " ").trim() || (message.media ? `sent a ${mediaWord(message.media) === "GIF" ? "GIF" : mediaWord(message.media).toLowerCase()}` : "");
  const say = (name) => hooks.toast?.(`${name || "New message"}: ${text.length > 60 ? text.slice(0, 59) + "…" : text}`);
  const known = conversation?.username || state.friends.find((f) => f.userId === message.senderId)?.username;
  if (known || !listed) say(known);
  else listed.then(() => say(state.conversations.find((c) => c.id === message.conversationId)?.username));
}
actions.markReadNow = (conversationId) => {
  clearTimeout(readTimers[conversationId]);
  readTimers[conversationId] = setTimeout(() => call("markRead", conversationId).catch(() => {}), 250);
};

// Someone you know, in the shape the call bar wants: from your friends, or someone you've messaged
const toPerson = (p) => ({ userId: p.userId, username: p.username, avatarUrl: p.avatarUrl || "" });
function personById(userId) {
  const known = state.friends.find((f) => f.userId === userId) || state.conversations.find((c) => c.userId === userId);
  return known ? toPerson(known) : null;
}

// A missed call leaves a line in the conversation. It reads differently depending on who called.
const callNote = (content, mine) => (content !== MISSED_CALL ? "" : mine ? "Call not answered" : "Missed voice call");

// Keep line breaks inside a message, drop blank lines and spaces around it
function tidy(raw) {
  return String(raw ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/^\s+|\s+$/g, "").replace(/\n{4,}/g, "\n\n\n");
}
const MAX_LENGTH = 4000;

// ── Started once, from AuraApp ────────────────────────────────────────────────
export function useAuraSocial({ view, goTo, toast }) {
  const s = useSocial();
  hooks.toast = toast;
  hooks.goToMessages = () => goTo("messages");

  useEffect(() => {
    if (!window.auraSocial?.start) return;
    let alive = true;
    state = blank(); // a different account may have just signed in
    listeners.forEach((l) => l());
    ensureStyles();
    // Voice calls: the call bar sits above every page, and looks people up in your friends list
    callHooks.toast = (text, kind) => hooks.toast?.(text, kind);
    callHooks.person = personById;
    const removeCallBar = mountCallLayer();
    const off = window.auraSocial.onEvent?.((event) => { if (alive) actions.onEvent(event); });
    (async () => {
      try {
        const me = await call("start");
        if (!alive) return;
        set({ me, ready: true, live: !!me.live, everLive: !!me.live });
        await Promise.all([actions.refreshFriends(), actions.refreshConversations(), actions.refreshBlocked()]);
        if (alive) callActions.resume(); // a call may already be ringing for you
      } catch (e) {
        if (alive) set({ ready: true, friendsLoaded: true, conversationsLoaded: true, friendsError: e.message, conversationsError: e.message });
      }
    })();
    // If live updates are down, check for new messages now and then until they're back
    const fallback = setInterval(() => { if (state.me && !state.live) actions.catchUp(); }, 20000);
    // Coming back to AURA: mark what you're looking at as read, and freshen online dots
    let lastFresh = Date.now();
    const onFocus = () => {
      if (!state.me) return;
      if (state.activeId) actions.markRead(state.activeId);
      if (Date.now() - lastFresh > 60000) { lastFresh = Date.now(); actions.refreshConversations(); actions.refreshFriends(); }
    };
    const onOnline = () => { if (state.me) actions.catchUp(); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      alive = false;
      off?.();
      removeCallBar(); // hangs up, if a call is going on
      clearInterval(fallback);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      Object.values(readTimers).forEach(clearTimeout);
    };
  }, []);

  // The page tells the store whether it's on screen (so arriving messages count as read or unread)
  useEffect(() => {
    set({ pageOpen: view === "messages" });
    if (view === "messages" && state.activeId) actions.markRead(state.activeId);
  }, [view]);

  const unread = visibleConversations(s).reduce((n, c) => n + (c.unread || 0), 0);
  const requests = s.friends.filter((f) => f.state === "incoming").length;
  return { unread, requests };
}

// ── Small shared pieces ───────────────────────────────────────────────────────
export const MessagesIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-8l-4.5 3.5V17.5H4A1.5 1.5 0 0 1 2.5 16V7A1.5 1.5 0 0 1 4 5.5z"/>
    <path d="M7.5 10h9M7.5 13.2h5.5"/>
  </svg>
);
const Svg = ({ d, size = 16, ...rest }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width={size} height={size} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>{d}</svg>
);
const IconSend = () => <Svg d={<><path d="M4 12l15-7-5 15-3-6z"/><path d="M11 14l8-9"/></>} />;
const IconPalette = () => <Svg d={<><path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.8-1.8 0-1.3-1-1.6-1-2.6 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.6" cy="11" r=".9"/><circle cx="10.4" cy="7.4" r=".9"/><circle cx="15" cy="7.6" r=".9"/></>} />;
const IconPlus = () => <Svg d={<path d="M12 5v14M5 12h14"/>} />;
const IconX = () => <Svg d={<path d="M6 6l12 12M18 6L6 18"/>} size={14} />;
const IconDown = () => <Svg d={<path d="M6 9l6 6 6-6"/>} size={14} />;
const IconClip = () => <Svg d={<path d="M20.5 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.4 3.4 0 0 1 4.8 4.8l-8.5 8.5a1.8 1.8 0 0 1-2.5-2.5l7.8-7.8"/>} />;
const IconPlay = () => <Svg d={<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>} size={22} />;
const IconPhoto = () => <Svg d={<><rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.5" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5L21 17"/></>} size={20} />;
const IconTrash = () => <Svg d={<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2h9.2L17.5 7M10 10.5v5.5M14 10.5v5.5"/>} size={15} />;
const IconFlag = () => <Svg d={<path d="M5.5 21V4M5.5 4.5h11l-2.2 3.7 2.2 3.8h-11"/>} size={15} />;
const IconGame = () => <Svg d={<><rect x="2.5" y="7" width="19" height="10" rx="5"/><path d="M7.5 10.5v3M6 12h3M15.5 11h.01M17.5 13h.01"/></>} />;

function Avatar({ name, url, size = 38, online = null }) {
  const [broken, setBroken] = useState(false);
  const letter = (String(name || "?").trim()[0] || "?").toUpperCase();
  return (
    <span className="mx-av" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>
      {url && !broken ? <img src={url} alt="" onError={() => setBroken(true)} /> : <span className="mx-av-l">{letter}</span>}
      {online !== null && <span className={`mx-dot ${online ? "on" : ""}`} title={online ? "Online" : "Offline"} />}
    </span>
  );
}

// "now", "2m", "1h", "Tue", "Oct 3"
function shortTime(iso) {
  const t = Date.parse(iso);
  if (!t) return "";
  const diff = Date.now() - t;
  if (diff < 60000) return "now";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "h";
  if (diff < 6 * 86400000) return new Date(t).toLocaleDateString([], { weekday: "short" });
  return new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
}
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function dayLabel(iso) {
  const d = new Date(iso); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((today - d) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

// ── Colors and background for the Messages page ───────────────────────────────
// "Match AURA" follows your theme and accent. The others are fixed looks. The background is the
// glow by default, or a picture of your own. All of that is saved on this PC and only you see it.
// A single chat can also have a shared background: that one is kept in Supabase, both people
// see it, and either of them can change or remove it.
const LOOK_KEY = "aura_messages_look";
const BG_KEY = "aura_messages_bg";       // your own background picture, shrunk and kept as a data URL
const AURA_BG_KEY = "aura_bg";           // the background set on AURA's Customize page
const SCHEMES = {
  aura:    { name: "Match AURA" },
  violet:  { name: "Violet",  a: "#8b5cf6", b: "#c4b5fd", base: "#0b0714" },
  ocean:   { name: "Ocean",   a: "#3b82f6", b: "#67e8f9", base: "#050b18" },
  ember:   { name: "Ember",   a: "#ff5a36", b: "#ffb86b", base: "#140907" },
  emerald: { name: "Emerald", a: "#22c55e", b: "#a7f3d0", base: "#06120c" },
  rose:    { name: "Rose",    a: "#f43f5e", b: "#fda4af", base: "#14070b" },
  mono:    { name: "Mono",    a: "#d4d4d8", b: "#ffffff", base: "#0a0a0b" },
  custom:  { name: "Custom" },
};
const HEX = /^#[0-9a-f]{6}$/i;
const DEFAULT_LOOK = { scheme: "aura", a: "#8b5cf6", b: "#c4b5fd", glass: 62, bg: "glow", bright: 45, blur: 14 };
const within = (v, lo, hi, fallback) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
const stored = (key) => { try { return localStorage.getItem(key) || ""; } catch { return ""; } };
// The picture behind the glass, or "" for the glow
function backgroundOf(look) {
  if (look.bg === "picture") return stored(BG_KEY);
  if (look.bg === "aura") return stored(AURA_BG_KEY);
  return "";
}
function loadLook() {
  try {
    const v = JSON.parse(localStorage.getItem(LOOK_KEY) || "{}");
    return {
      scheme: SCHEMES[v.scheme] ? v.scheme : "aura",
      a: HEX.test(v.a) ? v.a : DEFAULT_LOOK.a,
      b: HEX.test(v.b) ? v.b : DEFAULT_LOOK.b,
      glass: within(v.glass, 40, 90, DEFAULT_LOOK.glass),
      bg: ["glow", "picture", "aura"].includes(v.bg) ? v.bg : "glow",
      bright: within(v.bright, 15, 80, DEFAULT_LOOK.bright),
      blur: within(v.blur, 0, 30, DEFAULT_LOOK.blur),
    };
  } catch { return { ...DEFAULT_LOOK }; }
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => "#" + c.map((n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0")).join("");
const mix = (h1, h2, t) => { const a = rgb(h1), b = rgb(h2); return toHex(a.map((n, i) => n + (b[i] - n) * t)); };
// How bright a color looks, 0 (black) to 1 (white)
const brightness = (hex) => { const [r, g, b] = rgb(hex).map((n) => { const c = n / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const cssVar = (name, fallback) => { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return HEX.test(v) ? v : fallback; };

function resolveLook(look) {
  let a, b, base;
  if (look.scheme === "aura") { a = cssVar("--ac", "#FF5722"); b = cssVar("--ac2", a); base = cssVar("--bg", "#14141c"); }
  else if (look.scheme === "custom") { a = look.a; b = look.b; base = mix("#06060a", look.a, 0.07); }
  else ({ a, b, base } = SCHEMES[look.scheme]);
  // The backdrop is always dark enough for white text, whatever the theme
  if (brightness(base) > 0.06) base = mix(base, "#05050a", 0.55);
  // Text on your own bubbles: dark on bright colors, white on deep ones
  const onAccent = brightness(mix(a, b, 0.35)) > 0.42 ? "#0b0b12" : "#ffffff";
  return { "--mx-a": a, "--mx-b": b, "--mx-base": base, "--mx-on": onAccent, "--mx-fill": look.glass + "%" };
}
// With a picture behind the glass: how much of it shows through the dark wash, and how frosted the glass is
const pictureVars = (look) => ({ "--mx-wash": String(1 - look.bright / 100), "--mx-blur": look.blur + "px" });

// A file from storage, ready to draw: "" until its viewing link has arrived and the picture has loaded.
// If the link has run out, a fresh one is asked for once.
function useLoadedMedia(path) {
  const s = useSocial();
  const url = path ? s.media[path]?.url || "" : "";
  const [loaded, setLoaded] = useState("");
  const retried = useRef("");
  useEffect(() => { if (path) actions.needMedia(path); }, [path]);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const img = new Image();
    img.onload = () => { if (alive) setLoaded(url); };
    img.onerror = () => {
      if (!alive || retried.current === path) return;
      retried.current = path;
      actions.needMedia(path, true);
    };
    img.src = url;
    return () => { alive = false; };
  }, [url, path]);
  return url && loaded === url ? url : "";
}

// Shrinks a chosen picture so it is quick to draw and small enough to keep on this PC
async function shrinkPicture(file, longest, quality) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", quality);
}
async function saveBackground(file) {
  if (!/^image\//.test(file?.type || "")) throw new Error("Choose a picture (PNG, JPG or WebP).");
  for (const [longest, quality] of [[1920, 0.84], [1440, 0.78], [1024, 0.7]]) {
    let data;
    try { data = await shrinkPicture(file, longest, quality); } catch { throw new Error("That picture couldn't be opened. Try a PNG or JPG."); }
    try { localStorage.setItem(BG_KEY, data); return data; } catch {} // no room: try a smaller copy
  }
  throw new Error("There isn't room to keep that picture. Try a smaller one.");
}

function useLook() {
  const [look, setLook] = useState(loadLook);
  const [vars, setVars] = useState(() => resolveLook(look));
  const [picture, setPicture] = useState(() => backgroundOf(look));
  useEffect(() => {
    setVars(resolveLook(look));
    setPicture(backgroundOf(look));
    try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch {}
    if (look.scheme !== "aura") return;
    // Follow AURA's theme as it changes
    const watcher = new MutationObserver(() => setVars(resolveLook(look)));
    watcher.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => watcher.disconnect();
  }, [look]);
  return [look, setLook, vars, picture];
}

function LookPicker({ look, setLook, onClose, conversation, sharedUrl, hasPicture }) {
  const s = useSocial();
  const box = useRef(null);
  const chooser = useRef(null);
  const sharedChooser = useRef(null);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const shared = conversation?.background || null;
  // The same picture for both people in this chat
  const share = async (file) => {
    if (!conversation || sharing || (file === undefined)) return;
    setSharing(true);
    try { await actions.setBackground(conversation.id, file); }
    catch (e) { hooks.toast?.(e.message, "err"); }
    setSharing(false);
  };
  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target) && !e.target.closest?.("[data-mx-look]")) onClose(); };
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [onClose]);
  const swatch = (key) => {
    const s = SCHEMES[key];
    if (key === "aura") return "linear-gradient(135deg,var(--ac),var(--ac2))";
    if (key === "custom") return `linear-gradient(135deg,${look.a},${look.b})`;
    return `linear-gradient(135deg,${s.a},${s.b})`;
  };
  const mine = stored(BG_KEY);
  const auras = stored(AURA_BG_KEY);
  const showing = backgroundOf(look);
  const choose = async (file) => {
    if (!file || busy) return;
    setBusy(true);
    try { await saveBackground(file); setLook({ ...look, bg: "picture", stamp: Date.now() }); }
    catch (e) { hooks.toast?.(e.message, "err"); }
    setBusy(false);
  };
  const remove = () => { try { localStorage.removeItem(BG_KEY); } catch {} setLook({ ...look, bg: "glow", stamp: Date.now() }); };
  return (
    <div className="mx-pop mx-look" ref={box} role="dialog" aria-label="Messages colors and background">
      <div className="mx-pop-t">Colors</div>
      <div className="mx-swatches">
        {Object.keys(SCHEMES).map((key) => (
          <button key={key} type="button" className={`mx-swatch ${look.scheme === key ? "on" : ""}`} onClick={() => setLook({ ...look, scheme: key })} aria-pressed={look.scheme === key}>
            <span className="mx-swatch-c" style={{ background: swatch(key) }} />
            <span>{SCHEMES[key].name}</span>
          </button>
        ))}
      </div>
      {look.scheme === "custom" && (
        <div className="mx-custom">
          <label>Glow<input type="color" value={look.a} onChange={(e) => setLook({ ...look, a: e.target.value })} /></label>
          <label>Highlight<input type="color" value={look.b} onChange={(e) => setLook({ ...look, b: e.target.value })} /></label>
        </div>
      )}

      <div className="mx-pop-t second">Background</div>
      {conversation && (
        <>
          <div className="mx-bg-h">This chat<span>You and {conversation.username} both see it</span></div>
          {shared ? (
            <div className="mx-shared">
              <span className="mx-shared-pic" style={sharedUrl ? { backgroundImage: cssUrl(sharedUrl) } : undefined} />
              <div className="mx-shared-i">
                <div className="mx-shared-by">{sharing ? "Updating…" : shared.by && s.me && shared.by === s.me.id ? "Set by you" : shared.by ? `Set by ${conversation.username}` : "Shared picture"}</div>
                <div className="mx-bgrow">
                  {conversation.isFriend && <button type="button" className="mx-link" onClick={() => sharedChooser.current?.click()} disabled={sharing}>Change</button>}
                  <button type="button" className="mx-link" onClick={() => share(null)} disabled={sharing}>Remove</button>
                </div>
              </div>
            </div>
          ) : (
            <button type="button" className="mx-swatch wide" onClick={() => sharedChooser.current?.click()} disabled={sharing || !conversation.isFriend} title={conversation.isFriend ? undefined : "You can only set this for a chat with a friend"}>
              <span className="mx-swatch-c pic">+</span><span>{sharing ? "Setting…" : "Set a picture for this chat"}</span>
            </button>
          )}
          <input ref={sharedChooser} type="file" accept="image/png,image/jpeg,image/webp" hidden data-mx-shared-file onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) share(f); }} />
          <div className="mx-bg-h">Your other chats<span>Only you see it</span></div>
        </>
      )}
      <div className="mx-bgs">
        <button type="button" className={`mx-swatch ${!showing ? "on" : ""}`} onClick={() => setLook({ ...look, bg: "glow" })} aria-pressed={!showing}>
          <span className="mx-swatch-c" style={{ background: "radial-gradient(circle at 50% 120%,var(--mx-a),var(--mx-base) 70%)" }} /><span>Glow</span>
        </button>
        <button type="button" className={`mx-swatch ${look.bg === "picture" && showing ? "on" : ""}`} onClick={() => (mine ? setLook({ ...look, bg: "picture" }) : chooser.current?.click())} aria-pressed={look.bg === "picture" && !!showing} disabled={busy}>
          <span className="mx-swatch-c pic" style={mine ? { backgroundImage: cssUrl(mine) } : undefined}>{!mine && "+"}</span><span>{busy ? "Adding…" : mine ? "Your picture" : "Add a picture"}</span>
        </button>
        {auras && (
          <button type="button" className={`mx-swatch ${look.bg === "aura" ? "on" : ""}`} onClick={() => setLook({ ...look, bg: "aura" })} aria-pressed={look.bg === "aura"}>
            <span className="mx-swatch-c pic" style={{ backgroundImage: cssUrl(auras) }} /><span>AURA's background</span>
          </button>
        )}
      </div>
      <input ref={chooser} type="file" accept="image/png,image/jpeg,image/webp" hidden data-mx-bg-file onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; choose(f); }} />
      {look.bg === "picture" && mine && (
        <div className="mx-bgrow">
          <button type="button" className="mx-link" onClick={() => chooser.current?.click()} disabled={busy}>Change picture</button>
          <button type="button" className="mx-link" onClick={remove}>Remove</button>
        </div>
      )}
      {hasPicture && (
        <>
          <label className="mx-range">
            <span>Picture</span>
            <input type="range" min="15" max="80" step="1" value={look.bright} onChange={(e) => setLook({ ...look, bright: Number(e.target.value) })} aria-label="How bright the picture is" />
            <span className="mx-range-ends"><i>Darker</i><i>Brighter</i></span>
          </label>
          <label className="mx-range">
            <span>Frost</span>
            <input type="range" min="0" max="30" step="1" value={look.blur} onChange={(e) => setLook({ ...look, blur: Number(e.target.value) })} aria-label="How blurred the picture is behind the glass" />
            <span className="mx-range-ends"><i>Sharp</i><i>Frosted</i></span>
          </label>
        </>
      )}
      <label className="mx-range">
        <span>Glass</span>
        <input type="range" min="40" max="90" step="1" value={look.glass} onChange={(e) => setLook({ ...look, glass: Number(e.target.value) })} aria-label="How solid the glass is" />
        <span className="mx-range-ends"><i>Clearer</i><i>More solid</i></span>
      </label>
    </div>
  );
}
// A picture address, safe to put inside CSS url("...")
const cssUrl = (address) => `url("${String(address).replace(/["\\\n\r]/g, (ch) => "%" + ch.charCodeAt(0).toString(16).padStart(2, "0"))}")`;

// ── Friends: add by username, requests, and the list ──────────────────────────
// Used in the Friends panel ("panel") and in the New message drawer on the Messages page ("glass").
function FriendsManager({ variant = "panel", onMessaged }) {
  const s = useSocial();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const toast = (m, t) => hooks.toast?.(m, t);
  const run = async (key, work) => {
    if (busy) return;
    setBusy(key);
    try { await work(); } catch (e) { toast(e.message, "err"); }
    setBusy("");
  };
  const add = () => run("add", async () => {
    const who = await call("findUser", name);
    if (!who) return toast(`No AURA user named "${name.trim().replace(/^@/, "")}"`, "err");
    if (who.isMe) return toast("That's your own username", "err");
    const result = await call("requestFriend", who.userId);
    setName("");
    toast({ sent: `Friend request sent to ${who.username}`, accepted: `You and ${who.username} are now friends`, already_sent: `You already sent ${who.username} a request`, already_friends: `You're already friends with ${who.username}` }[result] || "Done");
    await actions.refreshFriends();
  });
  const accept = (f) => run(f.friendshipId, async () => { await call("acceptFriend", f.friendshipId); toast(`You and ${f.username} are now friends`); await actions.refreshFriends(); });
  const remove = (f, said) => run(f.friendshipId, async () => { await call("removeFriend", f.friendshipId); if (said) toast(said); await Promise.all([actions.refreshFriends(), actions.refreshConversations()]); });
  const message = (f) => run(f.friendshipId, async () => { await actions.openWith(f.userId); onMessaged?.(); });
  const block = (f) => {
    if (!window.confirm(`Block ${f.username}? They won't be able to message you or send you friend requests. They aren't told.`)) return;
    run(f.friendshipId, async () => { await actions.block(f); toast(`${f.username} is blocked`); });
  };
  const unblock = (b) => run("unblock-" + b.userId, async () => { await actions.unblock(b); toast(`${b.username} is unblocked`); });
  const [showBlocked, setShowBlocked] = useState(false);

  const incoming = s.friends.filter((f) => f.state === "incoming");
  const outgoing = s.friends.filter((f) => f.state === "outgoing");
  const friends = s.friends.filter((f) => f.state === "friend").sort((a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username));
  const Row = ({ f, sub, children }) => (
    <div className="mx-fr">
      <Avatar name={f.username} url={f.avatarUrl} size={34} online={f.state === "friend" ? f.online : null} />
      <div className="mx-fr-i"><div className="mx-fr-n">{f.username}</div><div className="mx-fr-s">{sub}</div></div>
      <div className="mx-fr-a">{children}</div>
    </div>
  );

  return (
    <div className={`mx-fm ${variant}`}>
      <form className="mx-add" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add(); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="AURA username" maxLength={40} aria-label="AURA username" spellCheck={false} />
        <button type="submit" disabled={!name.trim() || busy === "add"}>{busy === "add" ? "Adding…" : "Add friend"}</button>
      </form>

      {!s.friendsLoaded && <div className="mx-note">Loading friends…</div>}
      {s.friendsError && <div className="mx-note err">{s.friendsError} <button type="button" className="mx-link" onClick={() => actions.refreshFriends()}>Try again</button></div>}

      {incoming.length > 0 && <div className="mx-sec">Friend requests</div>}
      {incoming.map((f) => (
        <Row key={f.friendshipId} f={f} sub="Wants to be friends">
          <button type="button" className="mx-mini solid" onClick={() => accept(f)} disabled={!!busy}>Accept</button>
          <button type="button" className="mx-mini" onClick={() => remove(f)} disabled={!!busy}>Decline</button>
          <button type="button" className="mx-mini" onClick={() => block(f)} disabled={!!busy}>Block</button>
        </Row>
      ))}

      {friends.length > 0 && <div className="mx-sec">Friends</div>}
      {friends.map((f) => (
        <Row key={f.friendshipId} f={f} sub={f.online ? "Online" : "Offline"}>
          <CallButton person={toPerson(f)} className="mx-mini mx-call" />
          {/* The Friends panel is narrow: there, Message is an icon so both buttons fit beside the name */}
          {variant === "panel"
            ? <button type="button" className="mx-mini solid mx-call" onClick={() => message(f)} disabled={!!busy} title={`Message ${f.username}`} aria-label={`Message ${f.username}`}><MessagesIcon /></button>
            : <button type="button" className="mx-mini solid" onClick={() => message(f)} disabled={!!busy}>Message</button>}
        </Row>
      ))}

      {outgoing.length > 0 && <div className="mx-sec">Requests you sent</div>}
      {outgoing.map((f) => (
        <Row key={f.friendshipId} f={f} sub="Waiting for them to accept">
          <button type="button" className="mx-mini" onClick={() => remove(f)} disabled={!!busy}>Cancel</button>
        </Row>
      ))}

      {s.friendsLoaded && !s.friendsError && s.friends.length === 0 && (
        <div className="mx-note">No AURA friends yet. Type a friend's AURA username above to send them a request.</div>
      )}

      {s.blocked.length > 0 && (
        <button type="button" className="mx-sec mx-sec-btn" onClick={() => setShowBlocked((v) => !v)} aria-expanded={showBlocked}>Blocked ({s.blocked.length}) <IconDown /></button>
      )}
      {showBlocked && s.blocked.map((b) => (
        <div className="mx-fr" key={b.userId}>
          <Avatar name={b.username} url={b.avatarUrl} size={34} />
          <div className="mx-fr-i"><div className="mx-fr-n">{b.username}</div><div className="mx-fr-s">Can't message or add you</div></div>
          <div className="mx-fr-a"><button type="button" className="mx-mini" onClick={() => unblock(b)} disabled={!!busy}>Unblock</button></div>
        </div>
      ))}

      <div className="mx-foot"><PrivacyButton quiet>Privacy policy</PrivacyButton></div>
    </div>
  );
}

// The "AURA" tab inside the Friends panel
export function AuraFriendsTab() {
  useEffect(() => { ensureStyles(); }, []);
  return <FriendsManager variant="panel" />;
}

// ── Call a friend: pick one from your friends list ────────────────────────────
function CallPicker({ onClose }) {
  const s = useSocial();
  const current = useCall();
  const box = useRef(null);
  const [find, setFind] = useState("");
  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target) && !e.target.closest?.("[data-mx-callpick]")) onClose(); };
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [onClose]);
  const friends = s.friends.filter((f) => f.state === "friend").sort((a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username));
  const wanted = find.trim().toLowerCase();
  const shown = wanted ? friends.filter((f) => f.username.toLowerCase().includes(wanted)) : friends;
  const busy = !!current && current.phase !== "over";
  return (
    <div className="mx-pop mx-callpick" ref={box} role="dialog" aria-label="Call a friend">
      <div className="mx-pop-t">Call a friend</div>
      {friends.length > 6 && <input className="mx-callpick-find" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a friend" aria-label="Find a friend" spellCheck={false} autoFocus />}
      {!s.friendsLoaded && <div className="mx-note">Loading friends…</div>}
      {s.friendsError && <div className="mx-note err">{s.friendsError}</div>}
      {s.friendsLoaded && !s.friendsError && friends.length === 0 && <div className="mx-note">No AURA friends yet. Add one with the + button, then call them from here.</div>}
      {busy && <div className="mx-note">You're in a call with {current.peer.username}. Hang up to call someone else.</div>}
      <div className="mx-callpick-list" role="list">
        {shown.map((f) => (
          <button key={f.friendshipId} type="button" role="listitem" className={`mx-callpick-row ${f.online ? "" : "off"}`} disabled={busy} onClick={() => { callActions.start(toPerson(f)); onClose(); }} title={`Call ${f.username}`}>
            <Avatar name={f.username} url={f.avatarUrl} size={36} online={f.online} />
            <span className="mx-callpick-i"><span className="mx-callpick-n">{f.username}</span><span className="mx-callpick-s">{f.online ? "Online" : "Offline"}</span></span>
            <span className="mx-callpick-go"><IconPhone size={14} /> Call</span>
          </button>
        ))}
        {wanted && shown.length === 0 && <div className="mx-note">No friend named "{find.trim()}".</div>}
      </div>
      {friends.some((f) => !f.online) && <div className="mx-callpick-foot">A friend who is offline won't hear the call. They'll see that they missed it.</div>}
    </div>
  );
}

// ── Messages page ─────────────────────────────────────────────────────────────
function ConversationList() {
  const s = useSocial();
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []); // keeps "2m" fresh
  if (!s.conversationsLoaded) return <div className="mx-list"><div className="mx-note">Loading conversations…</div></div>;
  const conversations = visibleConversations(s);
  return (
    <div className="mx-list" role="list">
      {s.conversationsError && <div className="mx-note err">{s.conversationsError} <button type="button" className="mx-link" onClick={() => actions.refreshConversations()}>Try again</button></div>}
      {!s.conversationsError && conversations.length === 0 && (
        <div className="mx-empty-list">
          <div className="mx-empty-t">No conversations yet</div>
        </div>
      )}
      {conversations.map((c) => {
        const mine = c.lastSenderId && s.me && c.lastSenderId === s.me.id;
        // The newest message, in words: its text, what kind of file it was, or that it was deleted
        const missed = callNote(c.lastMessage, mine);
        const last = missed || (c.lastMessage ? c.lastMessage.replace(/\s+/g, " ") : c.lastMedia || (c.lastSenderId ? "Message deleted" : ""));
        return (
          <button key={c.id} type="button" role="listitem" className={`mx-conv ${s.activeId === c.id ? "on" : ""} ${c.unread ? "unread" : ""}`} onClick={() => actions.open(c.id)}>
            <Avatar name={c.username} url={c.avatarUrl} size={40} online={c.isFriend ? c.online : null} />
            <span className="mx-conv-m">
              <span className="mx-conv-top"><span className="mx-conv-n">{c.username}</span><span className="mx-conv-t">{last ? shortTime(c.lastMessageAt) : ""}</span></span>
              <span className="mx-conv-bot">
                <span className="mx-conv-p">{last ? (mine && !missed && (c.lastMessage || c.lastMedia) ? "You: " : "") + last : "No messages yet"}</span>
                {c.unread > 0 && <span className="mx-badge" aria-label={`${c.unread} unread`}>{c.unread > 99 ? "99+" : c.unread}</span>}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ProfileCard({ conversation, onClose, onReport }) {
  const s = useSocial();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");
  const box = useRef(null);
  useEffect(() => {
    let alive = true;
    call("getProfile", conversation.userId).then((p) => alive && setProfile(p || {})).catch((e) => alive && setError(e.message));
    const away = (e) => { if (box.current && !box.current.contains(e.target) && !e.target.closest?.("[data-mx-profile]")) onClose(); };
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { alive = false; document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [conversation.userId, onClose]);
  const friendship = s.friends.find((f) => f.userId === conversation.userId && f.state === "friend");
  const person = { userId: conversation.userId, username: conversation.username };
  const block = async () => {
    if (!window.confirm(`Block ${conversation.username}? They won't be able to message you or send you friend requests, and this conversation will be hidden. They aren't told.`)) return;
    try { await actions.block(person); hooks.toast?.(`${conversation.username} is blocked`); onClose(); }
    catch (e) { hooks.toast?.(e.message, "err"); }
  };
  const unfriend = async () => {
    if (!friendship || !window.confirm(`Remove ${conversation.username} as a friend? You won't be able to message each other until you're friends again.`)) return;
    try { await call("removeFriend", friendship.friendshipId); hooks.toast?.(`${conversation.username} removed from your friends`); await Promise.all([actions.refreshFriends(), actions.refreshConversations()]); onClose(); }
    catch (e) { hooks.toast?.(e.message, "err"); }
  };
  return (
    <div className="mx-pop mx-profile" ref={box} role="dialog" aria-label={`${conversation.username}'s profile`}>
      <Avatar name={conversation.username} url={profile?.avatarUrl || conversation.avatarUrl} size={64} />
      <div className="mx-profile-n">{profile?.username || conversation.username}</div>
      <div className="mx-profile-s">{conversation.isFriend ? (conversation.online ? "Online" : "Offline") : "Not in your friends"}</div>
      {error && <div className="mx-note err">{error}</div>}
      {!profile && !error && <div className="mx-note">Loading profile…</div>}
      {profile?.bio && <p className="mx-profile-b">{profile.bio}</p>}
      {profile?.joinedAt && <div className="mx-profile-j">On AURA since {new Date(profile.joinedAt).toLocaleDateString([], { month: "long", year: "numeric" })}</div>}
      {friendship && <button type="button" className="mx-btn ghost danger" onClick={unfriend}>Remove friend</button>}
      <div className="mx-profile-safe">
        <button type="button" className="mx-link" onClick={() => { onClose(); onReport?.(null); }}>Report</button>
        <button type="button" className="mx-link" onClick={block}>Block</button>
      </div>
    </div>
  );
}

const drafts = {}; // what you'd typed in each conversation, kept while you look at another
const trays = {};  // and the files you'd picked but not sent yet

// How big to draw a picture or video in the chat: its own shape, within a sensible box
function mediaBox(media) {
  const w = media.width || 320, h = media.height || 200;
  const scale = Math.min(340 / w, 360 / h, 1);
  return { width: Math.max(120, Math.round(w * scale)), height: Math.max(80, Math.round(h * scale)) };
}

// A picture, GIF or video inside the chat
function MediaView({ message, onOpen }) {
  const s = useSocial();
  const media = message.media;
  const entry = media.path ? s.media[media.path] : null;
  const url = media.local || entry?.url || "";
  const [broken, setBroken] = useState(false);
  const retried = useRef(false);
  useEffect(() => { if (media.path && !media.local) actions.needMedia(media.path); }, [media.path, media.local]);
  useEffect(() => { setBroken(false); }, [url]);
  // A link that has run out fails to load: ask for a fresh one, once
  const failed = () => {
    if (media.local || retried.current || !media.path) { setBroken(true); return; }
    retried.current = true;
    actions.needMedia(media.path, true);
  };
  const again = () => { retried.current = false; setBroken(false); actions.needMedia(media.path, true); };
  const box = mediaBox(media);
  const label = mediaWord(media);
  const gone = !media.local && entry?.missing;
  const trouble = !media.local && (broken || (entry && !entry.url && !entry.missing));
  return (
    <div className={`mx-media ${media.kind}`} style={{ width: box.width, aspectRatio: `${box.width} / ${box.height}` }}>
      {gone ? (
        <div className="mx-media-note">This {label === "GIF" ? "GIF" : label.toLowerCase()} is no longer available.</div>
      ) : trouble ? (
        <div className="mx-media-note">Couldn't load this {label === "GIF" ? "GIF" : label.toLowerCase()}. <button type="button" className="mx-link" onClick={again}>Try again</button></div>
      ) : !url ? (
        <div className="mx-media-note wait"><IconPhoto /> Loading…</div>
      ) : media.kind === "video" ? (
        <video src={url} controls preload="metadata" playsInline onError={failed} aria-label={media.name ? `Video: ${media.name}` : "Video"} />
      ) : (
        <button type="button" className="mx-media-open" onClick={() => onOpen?.({ url, name: media.name, label })} title="View full size" aria-label={`${label}${media.name ? ": " + media.name : ""}. View full size`}>
          <img src={url} alt={media.name || label} draggable={false} onError={failed} />
        </button>
      )}
      {label === "GIF" && url && !gone && !trouble && <span className="mx-media-tag">GIF</span>}
      {message.pending && <span className="mx-media-busy"><i className="mx-spin" /> Sending…</span>}
    </div>
  );
}

// A picture at full size, over the whole window. Esc or a click outside closes it.
function Lightbox({ item, onClose }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", esc, true);
    return () => document.removeEventListener("keydown", esc, true);
  }, [onClose]);
  return createPortal(
    <div className="mx-lightbox" role="dialog" aria-modal="true" aria-label={item.name || item.label} onClick={onClose}>
      <img src={item.url} alt={item.name || item.label} onClick={(e) => e.stopPropagation()} />
      <button type="button" className="mx-lightbox-x" onClick={onClose} aria-label="Close" autoFocus><IconX /></button>
      {item.name && <div className="mx-lightbox-n">{item.name}</div>}
    </div>,
    document.body,
  );
}

// Report a person, or one message of theirs. Covers the conversation while it's open.
const REASONS = [["spam", "Spam"], ["harassment", "Harassment or bullying"], ["inappropriate", "Inappropriate content"], ["other", "Something else"]];
function ReportSheet({ conversation, message, onClose }) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const first = useRef(null);
  useEffect(() => {
    first.current?.focus();
    const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", esc, true);
    return () => document.removeEventListener("keydown", esc, true);
  }, [onClose]);
  const name = conversation.username;
  const quoted = message ? (message.content ? message.content.replace(/\s+/g, " ").slice(0, 140) : mediaWord(message.media) || "Message") : "";
  const send = async (e) => {
    e.preventDefault();
    if (!reason) { setError("Pick a reason."); return; }
    setBusy(true); setError("");
    try {
      await actions.report({ userId: conversation.userId, username: name }, { reason, details, messageId: message?.id || null, block: alsoBlock });
      hooks.toast?.(alsoBlock ? `Report sent. ${name} is blocked.` : "Report sent. Thank you.");
      onClose();
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <div className="mx-sheet" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="mx-sheet-in" role="dialog" aria-modal="true" aria-label={`Report ${name}`} onSubmit={send}>
        <div className="mx-sheet-t">Report {name}</div>
        {message && <div className="mx-quote">{quoted}</div>}
        <fieldset className="mx-reasons">
          <legend>What's wrong?</legend>
          {REASONS.map(([key, label], i) => (
            <label key={key} className={reason === key ? "on" : ""}>
              <input ref={i === 0 ? first : undefined} type="radio" name="mx-reason" value={key} checked={reason === key} onChange={() => { setReason(key); setError(""); }} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <label className="mx-field">
          <span>Anything to add? (optional)</span>
          <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} rows={3} />
        </label>
        <label className="mx-check"><input type="checkbox" checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} /><span>Also block {name}</span></label>
        <p className="mx-sheet-n">{message ? "The developer of AURA receives your reason and a copy of this message." : "The developer of AURA receives your reason."} {name} isn't told who reported them.</p>
        {error && <div className="mx-note err" role="alert">{error}</div>}
        <div className="mx-sheet-a">
          <button type="button" className="mx-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="mx-btn" disabled={busy}>{busy ? "Sending…" : "Send report"}</button>
        </div>
      </form>
    </div>
  );
}

function Thread({ conversation, nowPlaying }) {
  const s = useSocial();
  const t = s.threads[conversation.id] || thread(conversation.id);
  const [text, setText] = useState("");
  const [tray, setTray] = useState([]);       // files picked, pasted or dropped, waiting to be sent
  const [dropping, setDropping] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [reporting, setReporting] = useState(null); // { message } while the report form is open
  const [showProfile, setShowProfile] = useState(false);
  const [newBelow, setNewBelow] = useState(false);
  const scroller = useRef(null);
  const input = useRef(null);
  const picker = useRef(null);
  const dragDepth = useRef(0);
  const stick = useRef(true);        // are we at the bottom?
  const before = useRef(null);       // scroll position saved while older messages load
  const lastId = useRef(null);

  // One draft per conversation
  useEffect(() => {
    setText(drafts[conversation.id] || "");
    setTray(trays[conversation.id] || []);
    setShowProfile(false); setNewBelow(false); setViewing(null); setDropping(false); setReporting(null);
    stick.current = true; lastId.current = null;
    input.current?.focus();
    return () => {};
  }, [conversation.id]);
  useEffect(() => { drafts[conversation.id] = text; }, [text, conversation.id]);
  useEffect(() => { trays[conversation.id] = tray; }, [tray, conversation.id]);

  // Grow the box with the text, up to about six lines
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 132) + "px";
  }, [text, conversation.id]);

  // Stay at the newest message unless the reader has scrolled up
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (before.current !== null) { el.scrollTop = el.scrollHeight - before.current; before.current = null; return; } // older messages were added above
    const newest = t.items[t.items.length - 1];
    const changed = newest && newest.id !== lastId.current;
    lastId.current = newest?.id || null;
    if (!changed) return;
    if (stick.current || (s.me && newest.senderId === s.me.id)) { el.scrollTop = el.scrollHeight; setNewBelow(false); }
    else setNewBelow(true);
  }, [t.items, conversation.id]);

  // The tray makes the typing area taller: keep the newest message in view when it appears
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [tray.length]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (stick.current && newBelow) setNewBelow(false);
    if (el.scrollTop < 80 && t.hasMore && !t.loadingOlder) { before.current = el.scrollHeight - el.scrollTop; actions.loadOlder(conversation.id); }
  };
  const jump = () => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; setNewBelow(false); };

  // Files: from the attach button, pasted, or dropped onto the conversation
  const addFiles = async (list) => {
    const files = Array.from(list || []).filter((f) => f && typeof f.arrayBuffer === "function");
    if (!files.length || !conversation.isFriend) return;
    let room = MAX_ATTACHMENTS - (trays[conversation.id] || []).length;
    if (files.length > room) hooks.toast?.(`You can send up to ${MAX_ATTACHMENTS} files at a time`, "err");
    for (const file of files) {
      if (room <= 0) break;
      try {
        const attachment = await readAttachment(file);
        room--;
        setTray((cur) => (cur.length >= MAX_ATTACHMENTS ? cur : [...cur, attachment]));
      } catch (e) { hooks.toast?.(e.message, "err"); }
    }
    input.current?.focus();
  };
  const removeFromTray = (id) => setTray((cur) => { const gone = cur.find((a) => a.id === id); if (gone) URL.revokeObjectURL(gone.url); return cur.filter((a) => a.id !== id); });
  const onPaste = (e) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (!files.length) return; // plain text pastes as usual
    e.preventDefault();
    addFiles(files);
  };
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
  const onDragEnter = (e) => { if (!hasFiles(e) || !conversation.isFriend) return; e.preventDefault(); dragDepth.current++; setDropping(true); };
  const onDragOver = (e) => { if (hasFiles(e) && conversation.isFriend) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } };
  const onDragLeave = (e) => { if (!hasFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDropping(false); };
  const onDrop = (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current = 0; setDropping(false); addFiles(e.dataTransfer.files); };

  const ready = tidy(text);
  const tooLong = ready.length > MAX_LENGTH;
  const canSend = conversation.isFriend && (!!ready || tray.length > 0) && !tooLong;
  const send = (value = text) => {
    const content = tidy(value);
    const files = value === text ? tray : [];
    if (!conversation.isFriend || (!content && !files.length) || content.length > MAX_LENGTH) return;
    if (value === text) { setText(""); setTray([]); }
    stick.current = true;
    if (!files.length) actions.send(conversation.id, content);
    // Files go one after another so they arrive in the order you picked them; the words go with the first
    else (async () => { for (let i = 0; i < files.length; i++) await actions.sendMedia(conversation.id, files[i], i === 0 ? content : ""); })();
    input.current?.focus();
  };
  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } // Enter sends, Shift+Enter makes a new line
  };
  const remove = async (m) => {
    if (!window.confirm("Delete this message for both of you? This can't be undone.")) return;
    try { await actions.deleteMessage(conversation.id, m.id); }
    catch (e) { hooks.toast?.(e.message, "err"); }
  };
  const retry = (m) => (m.attachment ? actions.sendMedia(conversation.id, m.attachment, m.content, m.id) : actions.send(conversation.id, m.content, m.id));

  // Group messages: a new block when the sender changes or five minutes pass; a divider per day
  const blocks = useMemo(() => {
    const out = [];
    let day = "";
    for (const m of t.items) {
      const d = new Date(m.createdAt).toDateString();
      if (d !== day) { day = d; out.push({ type: "day", key: "day-" + d, label: dayLabel(m.createdAt) }); }
      const prev = out[out.length - 1];
      if (prev?.type === "group" && prev.senderId === m.senderId && Date.parse(m.createdAt) - Date.parse(prev.items[prev.items.length - 1].createdAt) < 5 * 60000) prev.items.push(m);
      else out.push({ type: "group", key: "g-" + m.id, senderId: m.senderId, items: [m] });
    }
    return out;
  }, [t.items]);

  return (
    <section className={`mx-thread ${dropping ? "dropping" : ""}`} aria-label={`Conversation with ${conversation.username}`} onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <header className="mx-head">
        <button type="button" className="mx-who" data-mx-profile onClick={() => setShowProfile((v) => !v)} title="View profile" aria-expanded={showProfile}>
          <Avatar name={conversation.username} url={conversation.avatarUrl} size={40} online={conversation.isFriend ? conversation.online : null} />
          <span><span className="mx-who-n">{conversation.username}</span><span className="mx-who-s">{conversation.isFriend ? (conversation.online ? "Online" : "Offline") : "Not in your friends"}</span></span>
        </button>
        <div className="mx-head-a">
          {nowPlaying?.title && conversation.isFriend && (
            <button type="button" className="mx-btn ghost" onClick={() => send(`🎮 Join me in ${nowPlaying.title}!`)} title={`Invite ${conversation.username} to ${nowPlaying.title}`}><IconGame /> Invite to {nowPlaying.title}</button>
          )}
          {conversation.isFriend && (
            <CallButton person={toPerson(conversation)} className="mx-btn ghost">{({ withThem }) => <><IconPhone size={15} /> {withThem ? "In call" : "Call"}</>}</CallButton>
          )}
        </div>
        {showProfile && <ProfileCard conversation={conversation} onClose={() => setShowProfile(false)} onReport={(message) => setReporting({ message })} />}
      </header>

      {s.everLive && !s.live && <div className="mx-banner" role="status">Reconnecting. New messages may take a moment to show up.</div>}

      <div className="mx-scroll" ref={scroller} onScroll={onScroll}>
        {t.loadingOlder && <div className="mx-note center">Loading earlier messages…</div>}
        {t.loading && !t.loaded && <div className="mx-note center">Loading messages…</div>}
        {t.error && <div className="mx-note err center">{t.error} <button type="button" className="mx-link" onClick={() => actions.loadThread(conversation.id)}>Try again</button></div>}
        {t.loaded && !t.error && t.items.length === 0 && (
          <div className="mx-hello">
            <Avatar name={conversation.username} url={conversation.avatarUrl} size={72} />
            <div className="mx-hello-t">Say hi to {conversation.username}</div>
            <p>This is the start of your conversation.</p>
          </div>
        )}
        {blocks.map((b) => b.type === "day" ? (
          <div key={b.key} className="mx-day"><span>{b.label}</span></div>
        ) : (
          <div key={b.key} className={`mx-group ${s.me && b.senderId === s.me.id ? "me" : "them"}`}>
            {b.items.map((m) => (
              <div key={m.id} className={`mx-msg ${m.pending ? "pending" : ""} ${m.failed ? "failed" : ""} ${m.media ? "has-media" : ""} ${m.deleted ? "gone" : ""}`}>
                {m.deleted && <div className="mx-bubble">{s.me && m.senderId === s.me.id ? "You deleted this message" : "This message was deleted"}</div>}
                {m.media && <MediaView message={m} onOpen={setViewing} />}
                {m.content && (m.content === MISSED_CALL
                  ? <div className="mx-bubble mx-missed"><IconPhone size={15} /> {callNote(m.content, !!s.me && m.senderId === s.me.id)}</div>
                  : <div className="mx-bubble">{m.content}</div>)}
                {m.content === MISSED_CALL && conversation.isFriend && s.me && m.senderId !== s.me.id && (
                  <CallButton person={toPerson(conversation)} className="mx-link mx-callback">Call back</CallButton>
                )}
                {!m.pending && !m.failed && !m.deleted && (
                  <div className="mx-acts">
                    {s.me && m.senderId === s.me.id
                      ? <button type="button" onClick={() => remove(m)} title="Delete message" aria-label="Delete message"><IconTrash /></button>
                      : <button type="button" onClick={() => setReporting({ message: m })} title="Report message" aria-label="Report message"><IconFlag /></button>}
                  </div>
                )}
                {m.failed && (
                  <div className="mx-fail">Not sent. {m.error} <button type="button" className="mx-link" onClick={() => retry(m)}>Try again</button> <button type="button" className="mx-link" onClick={() => actions.discard(conversation.id, m.id)}>Delete</button></div>
                )}
              </div>
            ))}
            <div className="mx-meta"><b>{s.me && b.senderId === s.me.id ? "You" : conversation.username}</b>{b.items[b.items.length - 1].failed ? "" : b.items[b.items.length - 1].pending ? "Sending…" : clock(b.items[b.items.length - 1].createdAt)}</div>
          </div>
        ))}
      </div>
      {newBelow && <button type="button" className="mx-new" onClick={jump}><IconDown /> New messages</button>}

      {conversation.isFriend ? (
        <div className={`mx-compose ${tooLong ? "over" : ""}`}>
          {tray.length > 0 && (
            <div className="mx-tray" role="list" aria-label="Files to send">
              {tray.map((a) => (
                <div key={a.id} className="mx-tray-i" role="listitem" title={`${a.name} (${sizeText(a.size)})`}>
                  {a.kind === "video" ? <video src={a.url} muted preload="metadata" /> : <img src={a.url} alt="" />}
                  {a.kind === "video" && <span className="mx-tray-v"><IconPlay /></span>}
                  <span className="mx-tray-s">{a.mime === "image/gif" ? "GIF · " : ""}{sizeText(a.size)}</span>
                  <button type="button" className="mx-tray-x" onClick={() => removeFromTray(a.id)} aria-label={`Remove ${a.name}`}><IconX /></button>
                </div>
              ))}
            </div>
          )}
          <div className="mx-compose-row">
            <button type="button" className="mx-attach" onClick={() => picker.current?.click()} disabled={tray.length >= MAX_ATTACHMENTS} title="Attach a picture, GIF or video" aria-label="Attach a picture, GIF or video"><IconClip /></button>
            <input ref={picker} type="file" accept={MEDIA_ACCEPT} multiple hidden data-mx-file onChange={(e) => { const files = Array.from(e.target.files || []); e.target.value = ""; addFiles(files); }} />
            <textarea ref={input} rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onPaste={onPaste} placeholder={tray.length ? "Add a message (optional)" : `Message ${conversation.username}`} aria-label={`Message ${conversation.username}`} />
            {ready.length > MAX_LENGTH - 400 && <span className="mx-count">{ready.length} / {MAX_LENGTH}</span>}
            <button type="button" className="mx-send" onClick={() => send()} disabled={!canSend} aria-label="Send message" title="Send (Enter)"><IconSend /></button>
          </div>
        </div>
      ) : (
        <div className="mx-compose off">You and {conversation.username} aren't friends any more, so you can't send messages. Your history stays here.</div>
      )}
      {dropping && <div className="mx-drop" aria-hidden="true"><div><IconPhoto /> Drop to attach</div></div>}
      {viewing && <Lightbox item={viewing} onClose={() => setViewing(null)} />}
      {reporting && <ReportSheet conversation={conversation} message={reporting.message} onClose={() => setReporting(null)} />}
    </section>
  );
}

export default function MessagesPage({ nowPlaying }) {
  const s = useSocial();
  const [look, setLook, vars, ownPicture] = useLook();
  const [picking, setPicking] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [calling, setCalling] = useState(false); // the "Call a friend" list
  useEffect(() => {
    ensureStyles();
    // While this page is open and in front, freshen the online dots now and then
    const t = setInterval(() => { if (document.hasFocus() && state.me && state.live) { actions.refreshConversations(); actions.refreshFriends(); } }, 90000);
    return () => clearInterval(t);
  }, []);
  const conversations = visibleConversations(s);
  const active = conversations.find((c) => c.id === s.activeId) || null;
  const requests = s.friends.filter((f) => f.state === "incoming").length;
  // A chat's shared background wins while that chat is open; otherwise your own choice shows
  const sharedUrl = useLoadedMedia(active?.background?.path || "");
  const picture = sharedUrl || ownPicture;
  const style = picture ? { ...vars, ...pictureVars(look) } : vars;

  return (
    <div className={`mx ${picture ? "has-pic" : ""} ${sharedUrl ? "has-shared" : ""}`} style={style}>
      <div className="mx-bg" aria-hidden="true">
        {picture ? <><span key={picture.length + picture.slice(-48)} className="mx-pic" style={{ backgroundImage: cssUrl(picture) }} /><span className="mx-wash" /></> : <><span className="mx-orb one" /><span className="mx-orb two" /></>}
      </div>
      <div className="mx-glass">
        <aside className="mx-side">
          <div className="mx-side-h">
            <h1>Messages</h1>
            <div className="mx-side-a">
              <button type="button" className={`mx-icon ${picking ? "on" : ""}`} data-mx-look onClick={() => setPicking((v) => !v)} title="Colors and background" aria-label="Colors and background" aria-expanded={picking}><IconPalette /></button>
              {callsAvailable() && <button type="button" className={`mx-icon ${calling ? "on" : ""}`} data-mx-callpick onClick={() => setCalling((v) => !v)} title="Call a friend" aria-label="Call a friend" aria-expanded={calling}><IconPhone /></button>}
              <button type="button" className={`mx-icon ${drawer ? "on" : ""}`} onClick={() => setDrawer((v) => !v)} title="New message" aria-label="New message" aria-expanded={drawer}>
                {drawer ? <IconX /> : <IconPlus />}{!drawer && requests > 0 && <i className="mx-pip" />}
              </button>
            </div>
            {picking && <LookPicker look={look} setLook={setLook} onClose={() => setPicking(false)} conversation={active} sharedUrl={sharedUrl} hasPicture={!!picture} />}
            {calling && <CallPicker onClose={() => setCalling(false)} />}
          </div>
          {drawer ? (
            <div className="mx-drawer"><FriendsManager variant="glass" onMessaged={() => setDrawer(false)} /></div>
          ) : (
            <ConversationList />
          )}
        </aside>
        {active ? (
          <Thread key={active.id} conversation={active} nowPlaying={nowPlaying} />
        ) : (
          <section className="mx-thread mx-none">
            <div className="mx-none-in">
              <div className="mx-none-t">{conversations.length ? "Pick a conversation" : "Your messages live here"}</div>
              <p>{conversations.length ? "Choose someone on the left to see your messages." : "Add an AURA friend, then send the first message."}</p>
              {!conversations.length && <button type="button" className="mx-btn" onClick={() => setDrawer(true)}>Find a friend</button>}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
// The page is one sheet of frosted glass over two glowing orbs, or over a picture of your own.
// The orbs take their color from the scheme; text stays white on a backdrop that is always kept
// dark (a picture gets a dark wash over it), so names and messages stay readable however clear
// the glass is set.
const CSS = `
.mx{position:relative;flex:1;min-height:0;min-width:0;display:flex;padding:18px;overflow:hidden;isolation:isolate;font-family:'DM Sans',sans-serif;color:#fff;
  --mx-ink:#fff;--mx-ink2:rgba(255,255,255,.76);--mx-ink3:rgba(255,255,255,.56);--mx-line:rgba(255,255,255,.11);--mx-dot-ring:var(--mx-base)}
.mx *{box-sizing:border-box}
.mx button{font-family:inherit;color:inherit}
.mx button:focus-visible,.mx textarea:focus-visible,.mx input:focus-visible,.mx-fm button:focus-visible,.mx-fm input:focus-visible{outline:2px solid var(--mx-b,var(--ac2));outline-offset:2px}

/* Keep clear of the Now Playing bar while a game is running */
:root:has(.now-playing) .mx{padding-bottom:90px}

/* Backdrop */
.mx-bg{position:absolute;inset:0;z-index:-1;background:var(--mx-base);overflow:hidden}
.mx-orb{position:absolute;left:50%;aspect-ratio:1;border-radius:50%;
  background:radial-gradient(closest-side,color-mix(in srgb,var(--mx-base) 98%,var(--mx-a)) 0,color-mix(in srgb,var(--mx-base) 91%,var(--mx-a)) 80%,color-mix(in srgb,var(--mx-a) 70%,var(--mx-base)) 95.6%,var(--mx-b) 99.2%,transparent 100%);
  box-shadow:0 0 90px 6px color-mix(in srgb,var(--mx-a) 40%,transparent),0 0 240px 50px color-mix(in srgb,var(--mx-a) 16%,transparent)}
.mx-orb.one{width:min(1100px,96%);top:0;transform:translate(-50%,-66%);animation:mx-drift-a 26s ease-in-out infinite alternate}
.mx-orb.two{width:min(1700px,150%);bottom:0;transform:translate(-50%,70%);animation:mx-drift-b 32s ease-in-out infinite alternate}
.mx-pic{position:absolute;inset:-30px;background-size:cover;background-position:center;animation:mx-arrive .45s ease}
@keyframes mx-arrive{from{opacity:0}to{opacity:1}}
.reduce-motion .mx-pic{animation:none}
@media (prefers-reduced-motion:reduce){.mx-pic{animation:none}}
.mx-wash{position:absolute;inset:0;background:var(--mx-base);opacity:var(--mx-wash,.55)}
@keyframes mx-drift-a{to{transform:translate(-47%,-63%)}}
@keyframes mx-drift-b{to{transform:translate(-53%,67%)}}

/* The sheet of glass */
.mx-glass{position:relative;flex:1;min-width:0;min-height:0;display:grid;grid-template-columns:clamp(232px,32%,312px) minmax(0,1fr);border-radius:22px;overflow:hidden;
  background:color-mix(in srgb,var(--mx-base) var(--mx-fill),transparent);backdrop-filter:blur(var(--mx-blur,28px)) saturate(150%);
  border:1px solid rgba(255,255,255,.14);box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 30px 80px rgba(0,0,0,.5)}
.no-blur .mx-glass{background:color-mix(in srgb,var(--mx-base) 93%,transparent)}
/* Over a picture, the pieces that carry words get a firmer backing */
.mx.has-pic .mx-glass{text-shadow:0 1px 3px rgba(0,0,0,.7)}
.mx.has-pic .mx-group.them .mx-bubble{background:linear-gradient(rgba(255,255,255,.09),rgba(255,255,255,.09)),color-mix(in srgb,var(--mx-base) 86%,transparent)}
.mx.has-pic .mx-day span,.mx.has-pic .mx-meta{background:color-mix(in srgb,var(--mx-base) 62%,transparent);border-radius:999px}
.mx.has-pic .mx-meta{padding:2px 9px;margin-top:2px}
.mx.has-pic .mx-compose{background:color-mix(in srgb,var(--mx-base) 68%,transparent)}
.mx.has-pic .mx-side,.mx.has-pic .mx-head{background:color-mix(in srgb,var(--mx-base) 34%,transparent)}
/* A soft shadow keeps white text sharp where a bright glow sits behind clear glass */
.mx-glass{text-shadow:0 1px 2px rgba(0,0,0,.4)}
.mx-group.me .mx-bubble,.mx-btn,.mx-badge,.mx-send,.mx-new,.mx-av-l,.mx-pop,.mx-media,.mx-tray{text-shadow:none!important}

/* Left: conversations */
.mx-side{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--mx-line)}
.mx-side-h{position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:18px 16px 12px 20px}
.mx-side-h h1{margin:0;font-family:'Rajdhani',sans-serif;font-size:24px;font-weight:700;letter-spacing:.6px;line-height:1}
.mx-side-a{display:flex;gap:6px}
.mx-icon{position:relative;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:var(--mx-ink2);transition:background .15s,color .15s}
.mx-icon:hover,.mx-icon.on{background:rgba(255,255,255,.15);color:#fff}
.mx-pip{position:absolute;top:-1px;right:-1px;width:10px;height:10px;border-radius:50%;background:var(--mx-a);border:2px solid var(--mx-base)}
.mx-list,.mx-drawer{flex:1;min-height:0;overflow-y:auto;padding:4px 10px 12px}
.mx-drawer{padding:4px 14px 14px}
.mx-conv{position:relative;width:100%;display:flex;align-items:center;gap:11px;padding:10px;border-radius:14px;border:1px solid transparent;background:transparent;cursor:pointer;text-align:left;transition:background .15s}
.mx-conv:hover{background:rgba(255,255,255,.06)}
.mx-conv.on{background:rgba(255,255,255,.11);border-color:rgba(255,255,255,.13)}
.mx-conv.on::before{content:'';position:absolute;left:-1px;top:22%;bottom:22%;width:3px;border-radius:0 3px 3px 0;background:linear-gradient(var(--mx-a),var(--mx-b))}
.mx-conv-m{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.mx-conv-top,.mx-conv-bot{display:flex;align-items:center;gap:8px;min-width:0}
.mx-conv-n{flex:1;min-width:0;font-size:14px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mx-conv-t{flex-shrink:0;font-size:11px;color:var(--mx-ink3);font-variant-numeric:tabular-nums}
.mx-conv-p{flex:1;min-width:0;font-size:12.5px;color:var(--mx-ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mx-conv.unread .mx-conv-p{color:#fff;font-weight:600}
.mx-conv.unread .mx-conv-t{color:var(--mx-b)}
.mx-badge{flex-shrink:0;min-width:19px;height:19px;padding:0 6px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:linear-gradient(135deg,var(--mx-a),var(--mx-b));color:var(--mx-on)}
.mx-empty-list{padding:26px 12px;text-align:center}
.mx-empty-list p,.mx-none p,.mx-hello p{margin:6px 0 14px;font-size:13px;line-height:1.5;color:var(--mx-ink2)}
.mx-empty-t{font-size:15px;font-weight:600}

/* Avatars */
.mx-av{position:relative;display:inline-flex;flex-shrink:0;border-radius:50%}
.mx-av img,.mx-av-l{width:100%;height:100%;border-radius:50%;object-fit:cover}
.mx-av-l{display:flex;align-items:center;justify-content:center;font-family:'Rajdhani',sans-serif;font-weight:700;background:linear-gradient(135deg,var(--mx-a,var(--ac)),var(--mx-b,var(--ac2)));color:var(--mx-on,#fff)}
.mx-dot{position:absolute;right:-1px;bottom:-1px;width:30%;height:30%;min-width:10px;min-height:10px;border-radius:50%;background:#6b7280;border:2px solid var(--mx-dot-ring,var(--panel))}
.mx-dot.on{background:#3ddc84}

/* Right: the conversation */
.mx-thread{position:relative;display:flex;flex-direction:column;min-width:0;min-height:0}
.mx-head{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 18px;border-bottom:1px solid var(--mx-line);flex-shrink:0}
.mx-who{display:flex;align-items:center;gap:12px;min-width:0;padding:5px 12px 5px 5px;border-radius:999px;background:transparent;border:1px solid transparent;cursor:pointer;text-align:left;transition:background .15s}
.mx-who:hover{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.1)}
.mx-who>span:last-child{display:flex;flex-direction:column;min-width:0}
.mx-who-n{font-family:'Rajdhani',sans-serif;font-size:20px;font-weight:700;letter-spacing:.4px;line-height:1.1;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mx-who-s{font-size:12px;color:var(--mx-ink2)}
.mx-banner{padding:8px 18px;font-size:12.5px;color:#fff;background:rgba(255,186,73,.16);border-bottom:1px solid rgba(255,186,73,.3)}
.mx-scroll{flex:1;min-height:0;overflow-y:auto;padding:18px 22px 10px;display:flex;flex-direction:column;gap:4px}
.mx-scroll::-webkit-scrollbar,.mx-list::-webkit-scrollbar,.mx-drawer::-webkit-scrollbar{width:6px}
.mx-scroll::-webkit-scrollbar-thumb,.mx-list::-webkit-scrollbar-thumb,.mx-drawer::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:3px}
.mx-day{display:flex;justify-content:center;margin:14px 0 8px}
.mx-day span{padding:3px 13px;border-radius:999px;border:1px solid rgba(255,255,255,.22);font-size:11.5px;color:var(--mx-ink2);background:rgba(0,0,0,.18)}
.mx-group{display:flex;flex-direction:column;gap:3px;margin-top:8px;max-width:min(580px,76%)}
.mx-group.me{align-self:flex-end;align-items:flex-end}
.mx-group.them{align-self:flex-start;align-items:flex-start}
.mx-msg{position:relative;display:flex;flex-direction:column;max-width:100%}
/* Delete (your messages) or Report (theirs): appears beside a message when you point at it or tab to it */
.mx-acts{position:absolute;top:50%;transform:translateY(-50%);opacity:0;transition:opacity .12s}
.mx-group.me .mx-acts{right:100%;padding-right:6px}
.mx-group.them .mx-acts{left:100%;padding-left:6px}
.mx-msg:hover .mx-acts,.mx-acts:focus-within{opacity:1}
.mx-acts button{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:color-mix(in srgb,var(--mx-base) 70%,transparent);border:1px solid rgba(255,255,255,.16);color:var(--mx-ink2)!important}
.mx-acts button:hover{color:#fff!important;border-color:rgba(255,255,255,.4)}
.mx-group.me .mx-acts button:hover{background:rgba(255,77,109,.3);border-color:rgba(255,77,109,.6)}
.mx-msg.gone .mx-bubble{background:transparent!important;border:1px dashed rgba(255,255,255,.28)!important;color:var(--mx-ink3)!important;font-style:italic;font-size:13px;text-shadow:none}
.mx.has-pic .mx-msg.gone .mx-bubble{background:color-mix(in srgb,var(--mx-base) 62%,transparent)!important;color:var(--mx-ink2)!important}
.mx-group.me .mx-msg{align-items:flex-end}
.mx-group.them .mx-msg{align-items:flex-start}
.mx-bubble{padding:9px 14px;border-radius:18px;font-size:14px;line-height:1.46;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}
.mx-group.them .mx-bubble{background:linear-gradient(rgba(255,255,255,.1),rgba(255,255,255,.1)),color-mix(in srgb,var(--mx-base) 60%,transparent);border:1px solid rgba(255,255,255,.12);color:#fff}
.mx-group.me .mx-bubble{background:linear-gradient(135deg,var(--mx-a),color-mix(in srgb,var(--mx-a) 52%,var(--mx-b)));color:var(--mx-on);border:1px solid rgba(255,255,255,.16)}
.mx-group.me .mx-msg:not(:last-of-type) .mx-bubble{border-bottom-right-radius:7px}
.mx-group.me .mx-msg:not(:first-of-type) .mx-bubble{border-top-right-radius:7px}
.mx-group.them .mx-msg:not(:last-of-type) .mx-bubble{border-bottom-left-radius:7px}
.mx-group.them .mx-msg:not(:first-of-type) .mx-bubble{border-top-left-radius:7px}
.mx-msg.pending .mx-bubble{opacity:.6}
.mx-msg.has-media{gap:3px}

/* Pictures, GIFs and videos */
.mx-media{position:relative;max-width:100%;border-radius:16px;overflow:hidden;background:color-mix(in srgb,var(--mx-base) 78%,#fff 6%);border:1px solid rgba(255,255,255,.14);flex-shrink:0}
.mx-media img,.mx-media video{display:block;width:100%;height:100%;object-fit:cover;background:#000}
.mx-media video{object-fit:contain}
.mx-media-open{display:block;width:100%;height:100%;padding:0;border:none;background:none;cursor:zoom-in}
.mx-media-open:focus-visible{outline-offset:-3px}
.mx-media-note{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:12px;text-align:center;font-size:12.5px;line-height:1.45;color:var(--mx-ink2)}
.mx-media-note.wait{animation:mx-pulse 1.4s ease-in-out infinite alternate}
@keyframes mx-pulse{from{opacity:.45}to{opacity:.9}}
.mx-media-tag{position:absolute;left:8px;top:8px;padding:2px 7px;border-radius:6px;font-size:10.5px;font-weight:700;letter-spacing:.4px;background:rgba(0,0,0,.62);color:#fff;pointer-events:none}
.mx-media-busy{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:8px;font-size:12.5px;font-weight:600;color:#fff;background:rgba(0,0,0,.5);pointer-events:none}
.mx-spin{width:15px;height:15px;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;animation:mx-spin .8s linear infinite}
@keyframes mx-spin{to{transform:rotate(360deg)}}
.mx-msg.failed .mx-media{border-color:rgba(255,77,109,.6);opacity:.75}
.mx-drop{position:absolute;inset:8px;z-index:5;display:flex;align-items:center;justify-content:center;border-radius:16px;border:2px dashed var(--mx-b);background:color-mix(in srgb,var(--mx-base) 82%,transparent);pointer-events:none}
.mx-drop div{display:flex;align-items:center;gap:10px;font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:700;letter-spacing:.4px}
.mx-sheet{position:absolute;inset:0;z-index:7;display:flex;align-items:center;justify-content:center;padding:18px;background:color-mix(in srgb,var(--mx-base) 72%,transparent);backdrop-filter:blur(6px)}
.mx-sheet-in{width:min(420px,100%);max-height:100%;overflow-y:auto;display:flex;flex-direction:column;gap:12px;padding:20px;border-radius:18px;background:color-mix(in srgb,var(--mx-base) 90%,#fff);border:1px solid rgba(255,255,255,.18);box-shadow:0 24px 60px rgba(0,0,0,.55);text-shadow:none}
.mx-sheet-t{font-family:'Rajdhani',sans-serif;font-size:21px;font-weight:700;letter-spacing:.4px}
.mx-quote{padding:8px 12px;border-left:3px solid var(--mx-b);border-radius:0 8px 8px 0;background:rgba(255,255,255,.06);font-size:12.5px;line-height:1.45;color:var(--mx-ink2);overflow-wrap:anywhere}
.mx-reasons{margin:0;padding:0;border:none;display:flex;flex-direction:column;gap:5px}
.mx-reasons legend,.mx-field span{padding:0;margin-bottom:6px;font-size:12.5px;font-weight:600;color:#fff}
.mx-reasons label{display:flex;align-items:center;gap:9px;padding:8px 11px;border-radius:10px;cursor:pointer;font-size:13px;background:rgba(255,255,255,.05);border:1px solid transparent;color:var(--mx-ink2)}
.mx-reasons label:hover{background:rgba(255,255,255,.1);color:#fff}
.mx-reasons label.on{border-color:rgba(255,255,255,.5);color:#fff;background:rgba(255,255,255,.1)}
.mx-reasons input,.mx-check input{accent-color:var(--mx-b);margin:0}
.mx-field{display:flex;flex-direction:column}
.mx-field textarea{resize:vertical;min-height:62px;max-height:160px;padding:9px 11px;border-radius:10px;font:13px/1.45 'DM Sans',sans-serif;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);color:#fff}
.mx-check{display:flex;align-items:center;gap:9px;font-size:13px;color:#fff;cursor:pointer}
.mx-sheet-n{margin:0;font-size:12px;line-height:1.5;color:var(--mx-ink3)}
.mx-sheet-a{display:flex;justify-content:flex-end;gap:8px}
.mx-sheet .mx-note{padding:0}
.mx-lightbox{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;padding:48px 32px;background:rgba(4,4,8,.9);cursor:zoom-out;font-family:'DM Sans',sans-serif}
.mx-lightbox img{max-width:100%;max-height:100%;border-radius:10px;box-shadow:0 30px 90px rgba(0,0,0,.7);cursor:default}
.mx-lightbox-x{position:absolute;top:16px;right:18px;width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);color:#fff}
.mx-lightbox-x:hover{background:rgba(255,255,255,.22)}
.mx-lightbox-x:focus-visible{outline:2px solid #fff;outline-offset:2px}
.mx-lightbox-n{position:absolute;left:0;right:0;bottom:14px;text-align:center;font-size:12.5px;color:rgba(255,255,255,.75);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 60px}
.mx-msg.failed .mx-bubble{background:rgba(255,77,109,.2);border-color:rgba(255,77,109,.5);color:#fff}
.mx-fail{margin-top:3px;font-size:12px;color:#ffb3c0}
.mx-meta{display:flex;gap:7px;font-size:11px;color:var(--mx-ink3);padding:1px 6px 0}
.mx-meta b{font-weight:600;color:var(--mx-ink2)}
.mx-new{position:absolute;left:50%;bottom:86px;transform:translateX(-50%);display:flex;align-items:center;gap:5px;padding:6px 13px;border-radius:999px;cursor:pointer;font-size:12px;font-weight:600;background:linear-gradient(135deg,var(--mx-a),var(--mx-b));color:var(--mx-on)!important;border:1px solid rgba(255,255,255,.2);box-shadow:0 8px 24px rgba(0,0,0,.4)}
.mx-hello,.mx-none-in{margin:auto;text-align:center;padding:20px}
.mx-hello-t,.mx-none-t{margin-top:12px;font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:700;letter-spacing:.4px}
.mx-none{align-items:center;justify-content:center}
.mx-none-t{margin-top:0}

/* Typing box */
.mx-compose{display:flex;flex-direction:column;gap:6px;margin:6px 18px 18px;padding:6px;border-radius:20px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);flex-shrink:0;transition:border-color .15s}
.mx-compose:focus-within{border-color:color-mix(in srgb,var(--mx-b) 70%,transparent)}
.mx-compose.over{border-color:rgba(255,77,109,.7)}
.mx-compose-row{display:flex;align-items:flex-end;gap:6px}
.mx-attach{width:38px;height:38px;flex-shrink:0;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;background:transparent;color:var(--mx-ink2)!important;transition:background .15s,color .15s}
.mx-attach:hover:not(:disabled){background:rgba(255,255,255,.12);color:#fff!important}
.mx-attach:disabled{opacity:.4;cursor:default}
.mx-tray{display:flex;gap:8px;padding:6px 6px 2px;overflow-x:auto}
.mx-tray-i{position:relative;width:76px;height:76px;flex-shrink:0;border-radius:12px;overflow:hidden;background:#000;border:1px solid rgba(255,255,255,.18)}
.mx-tray-i img,.mx-tray-i video{width:100%;height:100%;object-fit:cover;display:block}
.mx-tray-v{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;background:rgba(0,0,0,.25);pointer-events:none}
.mx-tray-s{position:absolute;left:0;right:0;bottom:0;padding:9px 5px 3px;font-size:10px;font-weight:600;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.8));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mx-tray-x{position:absolute;top:3px;right:3px;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(0,0,0,.7);border:1px solid rgba(255,255,255,.3);color:#fff!important;padding:0}
.mx-tray-x:hover{background:rgba(255,77,109,.9)}
.mx-tray-x svg{width:10px;height:10px}
.mx-compose textarea{flex:1;min-width:0;resize:none;border:none;outline:none!important;background:transparent;color:#fff;font:14px/1.46 'DM Sans',sans-serif;padding:8px 0;max-height:132px}
.mx-compose textarea::placeholder{color:var(--mx-ink3)}
.mx-count{align-self:center;font-size:11px;color:var(--mx-ink3);font-variant-numeric:tabular-nums}
.mx-compose.over .mx-count{color:#ffb3c0}
.mx-send{width:38px;height:38px;flex-shrink:0;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--mx-a),var(--mx-b));color:var(--mx-on)!important;transition:transform .12s,opacity .15s}
.mx-send:hover:not(:disabled){transform:scale(1.06)}
.mx-send:disabled{cursor:default;background:rgba(255,255,255,.1);color:var(--mx-ink3)!important}
.mx-compose.off{padding:13px 16px;font-size:13px;line-height:1.45;color:var(--mx-ink2)}

/* Buttons, notes, pop-ups */
.mx-btn{display:inline-flex;align-items:center;gap:7px;padding:8px 16px;border-radius:999px;cursor:pointer;font-size:13px;font-weight:600;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;background:linear-gradient(135deg,var(--mx-a),var(--mx-b));color:var(--mx-on)!important;border:1px solid rgba(255,255,255,.18)}
.mx-btn.ghost{background:rgba(255,255,255,.07);color:#fff!important;border-color:rgba(255,255,255,.16);font-weight:500}
.mx-btn.ghost:hover{background:rgba(255,255,255,.14)}
.mx-btn.danger:hover{background:rgba(255,77,109,.22);border-color:rgba(255,77,109,.5)}
.mx-link{background:none;border:none;padding:0;cursor:pointer;font:inherit;font-weight:600;text-decoration:underline;color:inherit}
.mx-note{padding:12px 10px;font-size:12.5px;line-height:1.5;color:var(--f-ink2,var(--mx-ink2))}
.mx-note.center{text-align:center}
.mx-note.err{color:#ffb3c0}
.mx-pop{position:absolute;z-index:6;border-radius:16px;padding:16px;background:color-mix(in srgb,var(--mx-base) 90%,#fff);backdrop-filter:blur(30px);border:1px solid rgba(255,255,255,.18);box-shadow:0 24px 60px rgba(0,0,0,.55)}
.mx-pop-t{font-size:13px;font-weight:600;margin-bottom:10px}
.mx-look{top:58px;left:16px;width:268px;max-height:min(600px,calc(100vh - 150px));overflow-y:auto}
.mx-pop-t.second{margin-top:16px}
.mx-bgs{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.mx-swatch-c.pic{border-radius:5px;background-size:cover;background-position:center;background-color:rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;font-size:13px;line-height:1;color:#fff}
.mx-swatch:disabled{opacity:.6;cursor:default}
.mx-bgrow{display:flex;gap:16px;margin-top:9px;padding:0 2px;font-size:12px;color:var(--mx-ink2)}
.mx-bg-h{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:12px 1px 6px;font-size:12px;font-weight:600;color:#fff}
.mx-pop-t.second+.mx-bg-h{margin-top:2px}
.mx-bg-h span{font-size:11px;font-weight:400;color:var(--mx-ink3);text-align:right}
.mx-swatch.wide{width:100%}
.mx-shared{display:flex;align-items:center;gap:10px;padding:7px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.5)}
.mx-shared-pic{width:58px;height:38px;flex-shrink:0;border-radius:6px;background:rgba(255,255,255,.1) center/cover;border:1px solid rgba(255,255,255,.25)}
.mx-shared-i{min-width:0}
.mx-shared-by{font-size:12.5px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mx-shared .mx-bgrow{margin-top:3px;padding:0;gap:14px}
.mx-link:disabled{opacity:.5;cursor:default}
.mx-swatches{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.mx-swatch{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:10px;cursor:pointer;font-size:12.5px;text-align:left;background:rgba(255,255,255,.05);border:1px solid transparent;color:var(--mx-ink2)}
.mx-swatch:hover{background:rgba(255,255,255,.1);color:#fff}
.mx-swatch.on{border-color:rgba(255,255,255,.5);color:#fff;background:rgba(255,255,255,.1)}
.mx-swatch-c{width:18px;height:18px;border-radius:50%;flex-shrink:0;border:1px solid rgba(255,255,255,.3)}
.mx-custom{display:flex;gap:10px;margin-top:10px}
.mx-custom label{flex:1;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px 6px 11px;border-radius:10px;font-size:12.5px;background:rgba(255,255,255,.05);color:var(--mx-ink2)}
.mx-custom input{width:30px;height:24px;padding:0;border:none;background:none;cursor:pointer}
.mx-range{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:4px 12px;margin-top:14px;font-size:12.5px;color:#fff}
.mx-range input{width:100%;accent-color:var(--mx-b)}
.mx-range-ends{grid-column:2;display:flex;justify-content:space-between;font-size:11px;color:var(--mx-ink3)}
.mx-range-ends i{font-style:normal}
.mx-profile{top:66px;left:18px;width:260px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:4px}
.mx-profile-n{margin-top:8px;font-family:'Rajdhani',sans-serif;font-size:21px;font-weight:700;letter-spacing:.4px}
.mx-profile-s,.mx-profile-j{font-size:12px;color:var(--mx-ink2)}
.mx-profile-b{margin:8px 0 4px;font-size:13px;line-height:1.5;color:#fff;overflow-wrap:anywhere}
.mx-profile .mx-btn{margin-top:12px}
.mx-profile-safe{display:flex;gap:18px;margin-top:12px;font-size:12px;color:var(--mx-ink2)}

/* Friends: in the Friends panel it wears AURA's own colors, on the Messages page the glass ones */
.mx-fm{--f-ink:var(--t1);--f-ink2:var(--t2);--f-fill:var(--card);--f-line:var(--border);--f-a:var(--ac);--f-b:var(--ac);--f-on:#fff;font-family:'DM Sans',sans-serif}
.mx-fm.glass{--f-ink:#fff;--f-ink2:var(--mx-ink2);--f-fill:rgba(255,255,255,.08);--f-line:rgba(255,255,255,.14);--f-a:var(--mx-a);--f-b:var(--mx-b);--f-on:var(--mx-on)}
.mx-fm *{box-sizing:border-box}
.mx-add{display:flex;gap:6px;margin-bottom:6px}
.mx-add input{flex:1;min-width:0;padding:9px 11px;border-radius:10px;font:12.5px 'DM Sans',sans-serif;background:var(--f-fill);border:1px solid var(--f-line);color:var(--f-ink);outline:none}
.mx-add input::placeholder{color:var(--f-ink2);opacity:.8}
.mx-add button,.mx-mini{flex-shrink:0;border-radius:9px;cursor:pointer;font:600 11.5px 'DM Sans',sans-serif;padding:0 12px;white-space:nowrap;border:1px solid var(--f-line);background:var(--f-fill);color:var(--f-ink)}
.mx-add button{background:linear-gradient(135deg,var(--f-a),var(--f-b));color:var(--f-on);border-color:transparent}
.mx-mini{padding:5px 10px}
.mx-mini.solid{background:linear-gradient(135deg,var(--f-a),var(--f-b));color:var(--f-on);border-color:transparent}
.mx-add button:disabled,.mx-mini:disabled{opacity:.5;cursor:default}
.mx-sec{margin:14px 2px 6px;font-size:11.5px;font-weight:600;color:var(--f-ink2)}
.mx-sec-btn{display:flex;align-items:center;gap:5px;padding:0;background:none;border:none;cursor:pointer;font-family:inherit}
.mx-sec-btn[aria-expanded=true] svg{transform:rotate(180deg)}
.mx-sec-btn:hover{color:var(--f-ink)}
.mx-foot{margin-top:16px;padding:10px 2px 0;border-top:1px solid var(--f-line)}
.mx-fr{display:flex;align-items:center;flex-wrap:wrap;gap:6px 9px;padding:7px 4px;border-radius:10px}
.mx-fr-i{flex:1;min-width:84px}
.mx-fr-n{font-size:12.5px;font-weight:600;color:var(--f-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mx-fr-s{font-size:11px;color:var(--f-ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mx-fr-a{display:flex;gap:5px;flex-shrink:0;margin-left:auto}

/* Voice calls: where they start from (the call bar itself is styled in components/calls) */
.mx-head-a{display:flex;align-items:center;gap:8px;min-width:0}
.mx-mini.mx-call{display:inline-flex;align-items:center;justify-content:center;width:32px;height:28px;padding:0}
.mx-mini.mx-call svg{width:15px;height:15px}
.mx-mini.mx-call:hover:not(:disabled){border-color:var(--f-a)}
.mx-missed{display:inline-flex;align-items:center;gap:8px}
.mx-group.them .mx-missed svg{color:#ff8fa3}
.mx-callback{align-self:flex-start;margin:2px 6px 0;font-size:12px;color:var(--mx-ink2)}
/* While a call is on, the call bar sits along the top of the window: the page moves down to make room */
.mx{transition:padding-top .2s ease}
:root:has(.cx-bar) .mx{padding-top:62px}
:root:has(.stream-full-bar) .mx{padding-top:18px}
.reduce-motion .mx{transition:none}
@media (prefers-reduced-motion:reduce){.mx{transition:none}}
.mx-callback:hover:not(:disabled){color:#fff}
.mx-callpick{top:58px;left:16px;width:286px;max-height:min(520px,calc(100vh - 150px));display:flex;flex-direction:column;padding:16px 10px 10px}
.mx-callpick .mx-pop-t{padding:0 6px}
.mx-callpick .mx-note{padding:6px 6px 10px}
.mx-callpick-find{margin:0 4px 8px;padding:8px 11px;border-radius:10px;font:12.5px 'DM Sans',sans-serif;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);color:#fff}
.mx-callpick-find::placeholder{color:var(--mx-ink3)}
.mx-callpick-list{min-height:0;overflow-y:auto}
.mx-callpick-row{width:100%;display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:12px;border:1px solid transparent;background:transparent;cursor:pointer;text-align:left}
.mx-callpick-row:hover:not(:disabled){background:rgba(255,255,255,.09)}
.mx-callpick-row:disabled{opacity:.5;cursor:default}
.mx-callpick-i{flex:1;min-width:0;display:flex;flex-direction:column}
.mx-callpick-n{font-size:13.5px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mx-callpick-s{font-size:11.5px;color:var(--mx-ink2)}
.mx-callpick-go{flex-shrink:0;display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border-radius:999px;font-size:12px;font-weight:600;background:linear-gradient(135deg,var(--mx-a),var(--mx-b));color:var(--mx-on)}
.mx-callpick-row.off .mx-callpick-go{background:rgba(255,255,255,.1);color:#fff}
.mx-callpick-foot{padding:9px 8px 2px;font-size:11.5px;line-height:1.45;color:var(--mx-ink3)}
`;

function ensureStyles() {
  if (document.getElementById("aura-mx-styles")) return;
  const el = document.createElement("style");
  el.id = "aura-mx-styles";
  el.textContent = CSS;
  document.head.appendChild(el);
}
