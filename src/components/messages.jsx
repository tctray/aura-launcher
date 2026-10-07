/**
 * AURA — friends and messages
 *
 * Everything the window needs for AURA friends and direct messages:
 *   - useAuraSocial     started once in AuraApp: loads your friends and conversations, listens
 *                       for live updates, shows in-app notices, and returns the unread count
 *   - MessagesPage      the Messages page (frosted glass, with its own color scheme)
 *   - AuraFriendsTab    the "AURA" tab in the Friends panel: add friends, requests, Message
 *   - MessagesIcon      the icon used in the left menu
 *
 * The window never talks to Supabase directly. It asks through window.auraSocial (preload.js),
 * which is answered by electron/social.js.
 *
 * Added by aura-messages-setup.cjs.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

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
    if (event.type === "friends") { actions.refreshFriends(); actions.refreshConversations(); return; }
    if (event.type === "open") { hooks.goToMessages?.(); actions.open(event.conversationId); return; }
    if (event.type === "live") {
      const cameBack = event.connected && state.everLive && !state.live;
      set({ live: !!event.connected, everLive: state.everLive || !!event.connected });
      if (cameBack) actions.catchUp(); // pick up anything missed while disconnected
    }
  },

  async catchUp() {
    await Promise.all([actions.refreshConversations(), actions.refreshFriends()]);
    if (state.activeId) { await actions.loadThread(state.activeId); actions.markRead(state.activeId); }
  },
};

function mergeMessage(items, message) {
  if (items.some((m) => m.id === message.id)) return items;
  const out = [...items, message];
  // Confirmed messages in time order, anything still sending stays at the end
  return [...out.filter((m) => !m.pending && !m.failed).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)), ...out.filter((m) => m.pending || m.failed)];
}

function touchConversation(message, countUnread) {
  set((s) => ({
    conversations: sortByNewest(s.conversations.map((c) => (c.id !== message.conversationId ? c : {
      ...c, lastMessage: message.content.slice(0, 160), lastSenderId: message.senderId, lastMessageAt: message.createdAt,
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
    const twin = mine ? t.items.find((m) => m.pending && m.content === message.content) : null;
    setThread(message.conversationId, (cur) => ({ items: mergeMessage(twin ? cur.items.filter((m) => m.id !== twin.id) : cur.items, message) }));
  }
  const listed = conversation ? null : actions.refreshConversations(); // a brand-new conversation: fetch the list to get it
  if (conversation) touchConversation(message, !mine && !isLooking(message.conversationId));
  if (mine) return;
  if (isLooking(message.conversationId)) { actions.markReadNow(message.conversationId); return; }
  // In-app notice, at most one per conversation every few seconds. If AURA isn't the window in
  // front, the main process shows a Windows notification instead.
  if (!document.hasFocus()) return;
  const now = Date.now();
  if (now - (lastNotice[message.conversationId] || 0) < 4000) return;
  lastNotice[message.conversationId] = now;
  const text = message.content.replace(/\s+/g, " ").trim();
  const say = (name) => hooks.toast?.(`${name || "New message"}: ${text.length > 60 ? text.slice(0, 59) + "…" : text}`);
  const known = conversation?.username || state.friends.find((f) => f.userId === message.senderId)?.username;
  if (known || !listed) say(known);
  else listed.then(() => say(state.conversations.find((c) => c.id === message.conversationId)?.username));
}
actions.markReadNow = (conversationId) => {
  clearTimeout(readTimers[conversationId]);
  readTimers[conversationId] = setTimeout(() => call("markRead", conversationId).catch(() => {}), 250);
};

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
    const off = window.auraSocial.onEvent?.((event) => { if (alive) actions.onEvent(event); });
    (async () => {
      try {
        const me = await call("start");
        if (!alive) return;
        set({ me, ready: true, live: !!me.live, everLive: !!me.live });
        await Promise.all([actions.refreshFriends(), actions.refreshConversations()]);
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

  const unread = s.conversations.reduce((n, c) => n + (c.unread || 0), 0);
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

// ── Color scheme for the Messages page ────────────────────────────────────────
// "Match AURA" follows your theme and accent. The others are fixed looks. Saved on this PC.
const LOOK_KEY = "aura_messages_look";
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
const DEFAULT_LOOK = { scheme: "aura", a: "#8b5cf6", b: "#c4b5fd", glass: 62 };
function loadLook() {
  try {
    const v = JSON.parse(localStorage.getItem(LOOK_KEY) || "{}");
    return {
      scheme: SCHEMES[v.scheme] ? v.scheme : "aura",
      a: HEX.test(v.a) ? v.a : DEFAULT_LOOK.a,
      b: HEX.test(v.b) ? v.b : DEFAULT_LOOK.b,
      glass: Number.isFinite(v.glass) ? Math.min(90, Math.max(40, v.glass)) : DEFAULT_LOOK.glass,
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

function useLook() {
  const [look, setLook] = useState(loadLook);
  const [vars, setVars] = useState(() => resolveLook(look));
  useEffect(() => {
    setVars(resolveLook(look));
    try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch {}
    if (look.scheme !== "aura") return;
    // Follow AURA's theme as it changes
    const watcher = new MutationObserver(() => setVars(resolveLook(look)));
    watcher.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => watcher.disconnect();
  }, [look]);
  return [look, setLook, vars];
}

function LookPicker({ look, setLook, onClose }) {
  const box = useRef(null);
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
  return (
    <div className="mx-pop mx-look" ref={box} role="dialog" aria-label="Messages color scheme">
      <div className="mx-pop-t">Color scheme</div>
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
      <label className="mx-range">
        <span>Glass</span>
        <input type="range" min="40" max="90" step="1" value={look.glass} onChange={(e) => setLook({ ...look, glass: Number(e.target.value) })} aria-label="How solid the glass is" />
        <span className="mx-range-ends"><i>Clearer</i><i>More solid</i></span>
      </label>
    </div>
  );
}

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
        </Row>
      ))}

      {friends.length > 0 && <div className="mx-sec">Friends</div>}
      {friends.map((f) => (
        <Row key={f.friendshipId} f={f} sub={f.online ? "Online" : "Offline"}>
          <button type="button" className="mx-mini solid" onClick={() => message(f)} disabled={!!busy}>Message</button>
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
    </div>
  );
}

// The "AURA" tab inside the Friends panel
export function AuraFriendsTab() {
  useEffect(() => { ensureStyles(); }, []);
  return <FriendsManager variant="panel" />;
}

// ── Messages page ─────────────────────────────────────────────────────────────
function ConversationList() {
  const s = useSocial();
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []); // keeps "2m" fresh
  if (!s.conversationsLoaded) return <div className="mx-list"><div className="mx-note">Loading conversations…</div></div>;
  return (
    <div className="mx-list" role="list">
      {s.conversationsError && <div className="mx-note err">{s.conversationsError} <button type="button" className="mx-link" onClick={() => actions.refreshConversations()}>Try again</button></div>}
      {!s.conversationsError && s.conversations.length === 0 && (
        <div className="mx-empty-list">
          <div className="mx-empty-t">No conversations yet</div>
        </div>
      )}
      {s.conversations.map((c) => {
        const mine = c.lastSenderId && s.me && c.lastSenderId === s.me.id;
        return (
          <button key={c.id} type="button" role="listitem" className={`mx-conv ${s.activeId === c.id ? "on" : ""} ${c.unread ? "unread" : ""}`} onClick={() => actions.open(c.id)}>
            <Avatar name={c.username} url={c.avatarUrl} size={40} online={c.isFriend ? c.online : null} />
            <span className="mx-conv-m">
              <span className="mx-conv-top"><span className="mx-conv-n">{c.username}</span><span className="mx-conv-t">{c.lastMessage ? shortTime(c.lastMessageAt) : ""}</span></span>
              <span className="mx-conv-bot">
                <span className="mx-conv-p">{c.lastMessage ? (mine ? "You: " : "") + c.lastMessage.replace(/\s+/g, " ") : "No messages yet"}</span>
                {c.unread > 0 && <span className="mx-badge" aria-label={`${c.unread} unread`}>{c.unread > 99 ? "99+" : c.unread}</span>}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ProfileCard({ conversation, onClose }) {
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
    </div>
  );
}

const drafts = {}; // what you'd typed in each conversation, kept while you look at another

function Thread({ conversation, nowPlaying }) {
  const s = useSocial();
  const t = s.threads[conversation.id] || thread(conversation.id);
  const [text, setText] = useState("");
  const [showProfile, setShowProfile] = useState(false);
  const [newBelow, setNewBelow] = useState(false);
  const scroller = useRef(null);
  const input = useRef(null);
  const stick = useRef(true);        // are we at the bottom?
  const before = useRef(null);       // scroll position saved while older messages load
  const lastId = useRef(null);

  // One draft per conversation
  useEffect(() => {
    setText(drafts[conversation.id] || "");
    setShowProfile(false); setNewBelow(false);
    stick.current = true; lastId.current = null;
    input.current?.focus();
    return () => {};
  }, [conversation.id]);
  useEffect(() => { drafts[conversation.id] = text; }, [text, conversation.id]);

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

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (stick.current && newBelow) setNewBelow(false);
    if (el.scrollTop < 80 && t.hasMore && !t.loadingOlder) { before.current = el.scrollHeight - el.scrollTop; actions.loadOlder(conversation.id); }
  };
  const jump = () => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; setNewBelow(false); };

  const ready = tidy(text);
  const tooLong = ready.length > MAX_LENGTH;
  const canSend = conversation.isFriend && !!ready && !tooLong;
  const send = (value = text) => {
    const content = tidy(value);
    if (!conversation.isFriend || !content || content.length > MAX_LENGTH) return;
    if (value === text) setText("");
    stick.current = true;
    actions.send(conversation.id, content);
    input.current?.focus();
  };
  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } // Enter sends, Shift+Enter makes a new line
  };

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
    <section className="mx-thread" aria-label={`Conversation with ${conversation.username}`}>
      <header className="mx-head">
        <button type="button" className="mx-who" data-mx-profile onClick={() => setShowProfile((v) => !v)} title="View profile" aria-expanded={showProfile}>
          <Avatar name={conversation.username} url={conversation.avatarUrl} size={40} online={conversation.isFriend ? conversation.online : null} />
          <span><span className="mx-who-n">{conversation.username}</span><span className="mx-who-s">{conversation.isFriend ? (conversation.online ? "Online" : "Offline") : "Not in your friends"}</span></span>
        </button>
        {nowPlaying?.title && conversation.isFriend && (
          <button type="button" className="mx-btn ghost" onClick={() => send(`🎮 Join me in ${nowPlaying.title}!`)} title={`Invite ${conversation.username} to ${nowPlaying.title}`}><IconGame /> Invite to {nowPlaying.title}</button>
        )}
        {showProfile && <ProfileCard conversation={conversation} onClose={() => setShowProfile(false)} />}
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
              <div key={m.id} className={`mx-msg ${m.pending ? "pending" : ""} ${m.failed ? "failed" : ""}`}>
                <div className="mx-bubble">{m.content}</div>
                {m.failed && (
                  <div className="mx-fail">Not sent. {m.error} <button type="button" className="mx-link" onClick={() => actions.send(conversation.id, m.content, m.id)}>Try again</button> <button type="button" className="mx-link" onClick={() => actions.discard(conversation.id, m.id)}>Delete</button></div>
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
          <textarea ref={input} rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} placeholder={`Message ${conversation.username}`} aria-label={`Message ${conversation.username}`} />
          {ready.length > MAX_LENGTH - 400 && <span className="mx-count">{ready.length} / {MAX_LENGTH}</span>}
          <button type="button" className="mx-send" onClick={() => send()} disabled={!canSend} aria-label="Send message" title="Send (Enter)"><IconSend /></button>
        </div>
      ) : (
        <div className="mx-compose off">You and {conversation.username} aren't friends any more, so you can't send messages. Your history stays here.</div>
      )}
    </section>
  );
}

export default function MessagesPage({ nowPlaying }) {
  const s = useSocial();
  const [look, setLook, vars] = useLook();
  const [picking, setPicking] = useState(false);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    ensureStyles();
    // While this page is open and in front, freshen the online dots now and then
    const t = setInterval(() => { if (document.hasFocus() && state.me && state.live) { actions.refreshConversations(); actions.refreshFriends(); } }, 90000);
    return () => clearInterval(t);
  }, []);
  const active = s.conversations.find((c) => c.id === s.activeId) || null;
  const requests = s.friends.filter((f) => f.state === "incoming").length;

  return (
    <div className="mx" style={vars}>
      <div className="mx-bg" aria-hidden="true"><span className="mx-orb one" /><span className="mx-orb two" /></div>
      <div className="mx-glass">
        <aside className="mx-side">
          <div className="mx-side-h">
            <h1>Messages</h1>
            <div className="mx-side-a">
              <button type="button" className={`mx-icon ${picking ? "on" : ""}`} data-mx-look onClick={() => setPicking((v) => !v)} title="Color scheme" aria-label="Color scheme" aria-expanded={picking}><IconPalette /></button>
              <button type="button" className={`mx-icon ${drawer ? "on" : ""}`} onClick={() => setDrawer((v) => !v)} title="New message" aria-label="New message" aria-expanded={drawer}>
                {drawer ? <IconX /> : <IconPlus />}{!drawer && requests > 0 && <i className="mx-pip" />}
              </button>
            </div>
            {picking && <LookPicker look={look} setLook={setLook} onClose={() => setPicking(false)} />}
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
              <div className="mx-none-t">{s.conversations.length ? "Pick a conversation" : "Your messages live here"}</div>
              <p>{s.conversations.length ? "Choose someone on the left to see your messages." : "Add an AURA friend, then send the first message."}</p>
              {!s.conversations.length && <button type="button" className="mx-btn" onClick={() => setDrawer(true)}>Find a friend</button>}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
// The page is one sheet of frosted glass over two glowing orbs. The orbs take their color from
// the scheme; text stays white on a backdrop that is always kept dark, so names and messages
// stay readable however clear the glass is set.
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
@keyframes mx-drift-a{to{transform:translate(-47%,-63%)}}
@keyframes mx-drift-b{to{transform:translate(-53%,67%)}}

/* The sheet of glass */
.mx-glass{position:relative;flex:1;min-width:0;min-height:0;display:grid;grid-template-columns:clamp(232px,32%,312px) minmax(0,1fr);border-radius:22px;overflow:hidden;
  background:color-mix(in srgb,var(--mx-base) var(--mx-fill),transparent);backdrop-filter:blur(28px) saturate(150%);
  border:1px solid rgba(255,255,255,.14);box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 30px 80px rgba(0,0,0,.5)}
.no-blur .mx-glass{background:color-mix(in srgb,var(--mx-base) 93%,transparent)}
/* A soft shadow keeps white text sharp where a bright glow sits behind clear glass */
.mx-glass{text-shadow:0 1px 2px rgba(0,0,0,.4)}
.mx-group.me .mx-bubble,.mx-btn,.mx-badge,.mx-send,.mx-new,.mx-av-l,.mx-pop{text-shadow:none}

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
.mx-msg{display:flex;flex-direction:column;max-width:100%}
.mx-group.me .mx-msg{align-items:flex-end}
.mx-bubble{padding:9px 14px;border-radius:18px;font-size:14px;line-height:1.46;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}
.mx-group.them .mx-bubble{background:linear-gradient(rgba(255,255,255,.1),rgba(255,255,255,.1)),color-mix(in srgb,var(--mx-base) 60%,transparent);border:1px solid rgba(255,255,255,.12);color:#fff}
.mx-group.me .mx-bubble{background:linear-gradient(135deg,var(--mx-a),color-mix(in srgb,var(--mx-a) 52%,var(--mx-b)));color:var(--mx-on);border:1px solid rgba(255,255,255,.16)}
.mx-group.me .mx-msg:not(:last-of-type) .mx-bubble{border-bottom-right-radius:7px}
.mx-group.me .mx-msg:not(:first-of-type) .mx-bubble{border-top-right-radius:7px}
.mx-group.them .mx-msg:not(:last-of-type) .mx-bubble{border-bottom-left-radius:7px}
.mx-group.them .mx-msg:not(:first-of-type) .mx-bubble{border-top-left-radius:7px}
.mx-msg.pending .mx-bubble{opacity:.6}
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
.mx-compose{display:flex;align-items:flex-end;gap:8px;margin:6px 18px 18px;padding:6px 6px 6px 16px;border-radius:20px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);flex-shrink:0;transition:border-color .15s}
.mx-compose:focus-within{border-color:color-mix(in srgb,var(--mx-b) 70%,transparent)}
.mx-compose.over{border-color:rgba(255,77,109,.7)}
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
.mx-look{top:58px;left:16px;width:268px}
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
.mx-fr{display:flex;align-items:center;flex-wrap:wrap;gap:6px 9px;padding:7px 4px;border-radius:10px}
.mx-fr-i{flex:1;min-width:84px}
.mx-fr-n{font-size:12.5px;font-weight:600;color:var(--f-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mx-fr-s{font-size:11px;color:var(--f-ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mx-fr-a{display:flex;gap:5px;flex-shrink:0;margin-left:auto}
`;

function ensureStyles() {
  if (document.getElementById("aura-mx-styles")) return;
  const el = document.createElement("style");
  el.id = "aura-mx-styles";
  el.textContent = CSS;
  document.head.appendChild(el);
}
