// AURA — the media player: Clips > Media (your music and videos, playlists, YouTube links) and the
// mini player that keeps going while you use the rest of AURA.
// The files are found, read and converted by electron/media.js.
// Added by aura-media-player-setup.cjs.
// (AURA's own buttons control YouTube too: Added by aura-media-youtube-setup.cjs)
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

const api = () => (typeof window !== "undefined" ? window.electronAPI : null);
const available = () => typeof api()?.mediaState === "function";
const local = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const fmt = (s) => {
  if (!(s >= 0) || !isFinite(s)) return "0:00";
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`;
};

// ── The player (one for all of AURA, so it keeps playing when you change page) ──
const S = {
  item: null, queue: [], index: -1, playing: false, time: 0, duration: 0,
  volume: local.get("aura_media_volume", 0.8), muted: false, shuffle: local.get("aura_media_shuffle", false), repeat: local.get("aura_media_repeat", "off"),
  preparing: null, error: "", tab: local.get("aura_clips_tab", "clips"), art: "",
};
let snapshot = { ...S };
const subs = new Set();
const emit = () => { snapshot = { ...S }; subs.forEach((f) => f()); };
const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
export const useMedia = () => useSyncExternalStore(subscribe, () => snapshot);
export const mediaNow = () => snapshot; // what is playing right now, for voice commands (Added by aura-voice-setup.cjs)

let host = null, video = null, frame = null, stageEl = null, miniEl = null, panelEl = null, loop = 0, lastPos = "", tried = new Set(), history = [];
function ensureHost() {
  if (host) return;
  host = document.createElement("div");
  host.id = "aura-media-host";
  Object.assign(host.style, { position: "fixed", zIndex: "795", background: "#000", borderRadius: "10px", overflow: "hidden", display: "none" });
  video = document.createElement("video");
  video.playsInline = true;
  Object.assign(video.style, { width: "100%", height: "100%", objectFit: "contain", display: "block" });
  video.volume = S.volume;
  video.addEventListener("play", () => { S.playing = true; emit(); });
  video.addEventListener("pause", () => { S.playing = false; emit(); });
  let lastEmit = 0;
  video.addEventListener("timeupdate", () => {
    S.time = video.currentTime;
    if (Date.now() - lastEmit > 250) { lastEmit = Date.now(); emit(); }
    if (S.item && S.duration > 600 && Math.floor(S.time) % 5 === 0) remember(S.item.path, S.time);
  });
  video.addEventListener("durationchange", () => { S.duration = isFinite(video.duration) ? video.duration : 0; emit(); });
  video.addEventListener("loadedmetadata", () => {
    // A video whose picture the window can't show plays as sound only: convert it instead
    if (S.item?.kind === "video" && video.videoWidth === 0 && video.duration > 0) return failed();
    const at = local.get("aura_media_pos", {})[S.item?.path];
    if (at > 10 && at < video.duration - 30) video.currentTime = at;
  });
  video.addEventListener("ended", () => { if (S.item) remember(S.item.path, 0); next(true); });
  video.addEventListener("error", () => failed());
  video.addEventListener("dblclick", () => fullscreen());
  host.appendChild(video);
  document.body.appendChild(host);
  api()?.onMediaProgress?.((p) => { if (S.item && p.path === S.item.path) { S.preparing = p.percent; emit(); } });
  try {
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => toggle(true));
    ms.setActionHandler("pause", () => toggle(false));
    ms.setActionHandler("previoustrack", () => prev());
    ms.setActionHandler("nexttrack", () => next());
    ms.setActionHandler("seekto", (d) => seek(d.seekTime));
  } catch {}
}
function remember(p, t) {
  const all = local.get("aura_media_pos", {});
  if (t > 0) all[p] = Math.floor(t); else delete all[p];
  const keys = Object.keys(all); if (keys.length > 200) delete all[keys[0]];
  local.set("aura_media_pos", all);
}

// Keeps the picture over the player box on the Media tab, or in the mini player, or hidden
function place() {
  loop = 0;
  if (!host) return;
  if (!S.item) { host.style.display = "none"; lastPos = ""; return; }
  if (document.fullscreenElement === host) { loop = requestAnimationFrame(place); return; }
  const visible = (el) => el && el.isConnected && el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0;
  const target = S.item.kind !== "audio" ? (visible(stageEl) ? stageEl : visible(miniEl) ? miniEl : null) : null;
  let pos = "none";
  if (target) { const r = target.getBoundingClientRect(); pos = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`; }
  if (pos !== lastPos) {
    lastPos = pos;
    if (pos === "none") host.style.display = "none";
    else { const [l, t, w, h] = pos.split(",").map(Number); Object.assign(host.style, { display: "block", left: l + "px", top: t + "px", width: w + "px", height: h + "px" }); }
  }
  loop = window.__auraHidden ? setTimeout(place, 500) : requestAnimationFrame(place); // (resting while hidden: Added by aura-release-fixes-setup.cjs)
}
const kick = () => { if (!loop) loop = requestAnimationFrame(place); };
export const setStage = (el) => { stageEl = el; kick(); };
export const setMini = (el) => { miniEl = el; kick(); };
export const setPanel = (el) => { panelEl = el; };
// Is the Media tab's player on screen? (Then the mini player isn't needed.)
export const stageVisible = () => !!panelEl && panelEl.isConnected && panelEl.getClientRects().length > 0;

function showFrame(src) {
  if (!frame) {
    frame = document.createElement("iframe");
    frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    Object.assign(frame.style, { width: "100%", height: "100%", border: "0", display: "block" });
  }
  frame.src = src;
  if (!frame.isConnected) host.appendChild(frame);
  video.style.display = "none";
  frame.style.display = "block";
}
function hideFrame() { clearInterval(yt.hello); yt.ready = false; if (frame) { frame.src = "about:blank"; frame.remove(); } video.style.display = "block"; }

// ── Controlling the YouTube player (YouTube's own player commands, sent as messages) ──
const YT_ORIGIN = "https://www.youtube-nocookie.com";
const yt = { ready: false, hello: 0, listening: false, state: -1 };
const isYt = () => S.item?.kind === "youtube";
function ytSend(func, args = []) {
  try { frame?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args, id: 1, channel: "widget" }), YT_ORIGIN); } catch {}
}
function ytListen() {
  if (yt.listening) return;
  yt.listening = true;
  window.addEventListener("message", (e) => {
    if (e.origin !== YT_ORIGIN || !frame || e.source !== frame.contentWindow || !isYt()) return;
    let d; try { d = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
    if (!d || typeof d !== "object") return;
    if (d.event === "onReady" || d.event === "initialDelivery" || d.event === "infoDelivery") {
      if (!yt.ready) { yt.ready = true; clearInterval(yt.hello); ytSend("setVolume", [Math.round(S.volume * 100)]); if (S.muted) ytSend("mute"); ytSend("setShuffle", [!!S.shuffle]); ytSend("setLoop", [S.repeat !== "off"]); }
    }
    const info = d.info && typeof d.info === "object" ? d.info : d.event === "onStateChange" ? { playerState: d.info } : null;
    if (!info) return;
    let changed = false;
    if (typeof info.currentTime === "number") { S.time = info.currentTime; changed = true; }
    if (typeof info.duration === "number" && info.duration > 0) { S.duration = info.duration; changed = true; }
    if (typeof info.playerState === "number") { yt.state = info.playerState; S.playing = info.playerState === 1 || info.playerState === 3; changed = true; }
    const vd = info.videoData;
    if (vd && typeof vd.title === "string" && vd.title && vd.title !== S.item.title) {
      S.item = { ...S.item, title: vd.title.slice(0, 200), artist: typeof vd.author === "string" ? vd.author.slice(0, 120) : "" };
      setSession(S.item, "");
      changed = true;
    }
    // Where you are in a playlist (YouTube sends the list itself only now and then)
    if (typeof info.playlistIndex === "number" && info.playlistIndex >= 0) {
      const count = Array.isArray(info.playlist) ? info.playlist.length : S.ytList?.count || 0;
      if (count) { S.ytList = { index: info.playlistIndex, count }; changed = true; }
    }
    if (changed) emit();
  });
}

async function load(item) {
  ensureHost();
  hideFrame();
  S.item = item; S.error = ""; S.preparing = null; S.time = 0; S.duration = 0; S.art = "";
  emit(); kick();
  const r = await api().mediaUrl(item.path);
  if (S.item !== item) return;
  if (!r?.success) { S.error = r?.error || "AURA can't open that file."; emit(); return; }
  S.art = r.art;
  setSession(item, r.art);
  if (!r.native) return failed();
  video.src = r.url;
  video.play().catch(() => {});
}
async function failed() {
  const item = S.item;
  if (!item || item.kind === "youtube") return;
  if (tried.has(item.path)) { S.error = "AURA couldn't play this file."; S.preparing = null; emit(); return; }
  tried.add(item.path);
  video.removeAttribute("src"); video.load();
  S.preparing = 0; emit();
  const r = await api().mediaConvert(item.path);
  if (S.item !== item) return;
  S.preparing = null;
  if (!r?.success) { S.error = r?.error || "AURA couldn't play this file."; emit(); return; }
  emit();
  video.src = r.url;
  video.play().catch(() => {});
}
function setSession(item, art) {
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: item.title || item.name, artist: item.artist || "", album: item.album || "", artwork: art ? [{ src: art, sizes: "320x320", type: "image/jpeg" }] : [] });
  } catch {}
}

export function playList(items, index = 0) {
  const list = (items || []).filter((i) => i && (i.path || i.kind === "youtube"));
  if (!list.length) return;
  S.queue = list; S.index = Math.max(0, Math.min(index, list.length - 1)); history = [];
  load(S.queue[S.index]);
}
export function playYouTube(link, name) {
  const link_ = youTube(link);
  if (!link_) return false;
  ensureHost();
  video.pause(); video.removeAttribute("src"); video.load();
  // link: the tidy link that Save keeps (Added by aura-media-youtube-save-setup.cjs)
  S.item = { kind: "youtube", name: name || (link_.list ? "YouTube playlist" : "YouTube video"), path: "", link: ytLink(link_) }; S.queue = [S.item]; S.index = 0; S.error = ""; S.preparing = null; S.time = 0; S.duration = 0; S.playing = true; S.art = "";
  const origin = /^https?:/.test(location.origin) ? "&origin=" + encodeURIComponent(location.origin) : "";
  const q = "autoplay=1&rel=0&modestbranding=1&enablejsapi=1" + origin + (link_.list ? "&list=" + encodeURIComponent(link_.list) : "");
  S.ytList = null;
  ytListen();
  showFrame(link_.id ? `${YT_ORIGIN}/embed/${link_.id}?${q}` : `${YT_ORIGIN}/embed/videoseries?${q}`);
  // Say hello until the player answers; then AURA's buttons control it
  clearInterval(yt.hello); yt.ready = false;
  const hello = () => { try { frame?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), YT_ORIGIN); } catch {} };
  frame.onload = hello;
  let tries = 0; yt.hello = setInterval(() => { if (yt.ready || ++tries > 40) clearInterval(yt.hello); else hello(); }, 500);
  emit(); kick();
  return true;
}
// The tidy form of a YouTube link, the one your saved list keeps (Added by aura-media-youtube-save-setup.cjs)
export function ytLink({ id, list }) {
  return id ? `https://www.youtube.com/watch?v=${id}${list ? "&list=" + list : ""}` : `https://www.youtube.com/playlist?list=${list}`;
}
const YT_SAVED = "aura_media_youtube";
const readSaved = () => {
  const v = local.get(YT_SAVED, []);
  return (Array.isArray(v) ? v : []).filter((s) => s && typeof s.id === "string" && typeof s.name === "string" && youTube(s.link))
    .map((s) => ({ id: s.id.slice(0, 40), name: s.name.slice(0, 80), link: ytLink(youTube(s.link)) })).slice(0, 200);
};
export function youTube(link) {
  let u;
  try { u = new URL(String(link || "").trim()); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id = "", list = u.searchParams.get("list") || "";
  if (host === "youtu.be") id = u.pathname.slice(1);
  else if (host === "youtube.com" || host === "youtube-nocookie.com") id = u.searchParams.get("v") || (/^\/(embed|shorts|live)\/([^/?]+)/.exec(u.pathname) || [])[2] || "";
  else return null;
  id = /^[\w-]{6,20}$/.test(id) ? id : "";
  list = /^[\w-]{10,64}$/.test(list) ? list : "";
  return id || list ? { id, list } : null;
}
export function toggle(force) {
  if (!S.item) return;
  if (isYt()) { const go = force === undefined ? !S.playing : force; ytSend(go ? "playVideo" : "pauseVideo"); S.playing = go; emit(); return; }
  const go = force === undefined ? video.paused : force;
  if (go) video.play().catch(() => {}); else video.pause();
}
function order(step) {
  const n = S.queue.length;
  if (!S.shuffle || n < 3) return (S.index + step + n) % n;
  if (step < 0 && history.length) return history.pop();
  let i; do { i = Math.floor(Math.random() * n); } while (i === S.index);
  return i;
}
export function next(auto = false) {
  if (!S.item || !S.queue.length) return;
  if (isYt()) { if (!auto) ytSend("nextVideo"); return; }
  if (auto && S.repeat === "one") { video.currentTime = 0; video.play().catch(() => {}); return; }
  const last = S.index >= S.queue.length - 1;
  if (auto && last && S.repeat === "off" && !S.shuffle) { S.playing = false; emit(); return; }
  history.push(S.index); if (history.length > 100) history.shift();
  S.index = order(1);
  load(S.queue[S.index]);
}
export function prev() {
  if (!S.item) return;
  if (isYt()) { if (S.time > 3) ytSend("seekTo", [0, true]); else ytSend("previousVideo"); return; }
  if (video && video.currentTime > 3) { video.currentTime = 0; return; }
  S.index = order(-1);
  load(S.queue[S.index]);
}
export function seek(t) {
  if (isYt() && isFinite(t)) { ytSend("seekTo", [Math.max(0, t), true]); S.time = t; emit(); return; }
  if (video && isFinite(t)) { video.currentTime = Math.max(0, Math.min(t, S.duration || t)); S.time = video.currentTime; emit(); } }
export function setVolume(v) { S.volume = Math.max(0, Math.min(1, v)); S.muted = false; if (video) { video.volume = S.volume; video.muted = false; } if (isYt()) { ytSend("unMute"); ytSend("setVolume", [Math.round(S.volume * 100)]); } local.set("aura_media_volume", S.volume); emit(); }
export function toggleMute() { S.muted = !S.muted; if (video) video.muted = S.muted; if (isYt()) ytSend(S.muted ? "mute" : "unMute"); emit(); }
export function setShuffle(on) { S.shuffle = on; local.set("aura_media_shuffle", on); if (isYt()) ytSend("setShuffle", [!!on]); emit(); }
export function cycleRepeat() { S.repeat = S.repeat === "off" ? "all" : S.repeat === "all" ? "one" : "off"; local.set("aura_media_repeat", S.repeat); if (isYt()) ytSend("setLoop", [S.repeat !== "off"]); emit(); }
export function stop() {
  if (video) { video.pause(); video.removeAttribute("src"); video.load(); }
  hideFrame();
  S.item = null; S.queue = []; S.index = -1; S.playing = false; S.preparing = null; S.error = "";
  try { navigator.mediaSession.metadata = null; } catch {}
  emit(); kick();
}
export function fullscreen() { if (host && S.item && S.item.kind !== "audio") host.requestFullscreen?.().catch(() => {}); }
export function setTab(tab) { S.tab = tab === "media" ? "media" : "clips"; local.set("aura_clips_tab", S.tab); emit(); }

// ── Small pieces ──────────────────────────────────────────────────────────────
const I = {
  play: <path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" />,
  pause: <><rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /></>,
  next: <><path d="M6 6l9 6-9 6z" fill="currentColor" stroke="none" /><path d="M18 6v12" /></>,
  prev: <><path d="M18 6l-9 6 9 6z" fill="currentColor" stroke="none" /><path d="M6 6v12" /></>,
  shuffle: <><path d="M4 7h3.5c4 0 5 10 9 10H20M17 14l3 3-3 3" /><path d="M4 17h3.5c1.4 0 2.4-1.2 3.3-2.8M13.2 9.8C14.1 8.2 15 7 16.5 7H20M17 4l3 3-3 3" /></>,
  repeat: <><path d="M5 11V9a2 2 0 0 1 2-2h12M16 4l3 3-3 3" /><path d="M19 13v2a2 2 0 0 1-2 2H5M8 20l-3-3 3-3" /></>,
  vol: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></>,
  mute: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M16 9.5l5 5M21 9.5l-5 5" /></>,
  full: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  note: <><path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></>,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />, // (Added by aura-media-youtube-save-setup.cjs)
  film: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M7.5 5v14M16.5 5v14M3.5 9.5h4M3.5 14.5h4M16.5 9.5h4M16.5 14.5h4" /></>,
};
const Icon = ({ n, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{I[n]}</svg>
);
function Art({ item, size = 40 }) {
  const [bad, setBad] = useState(false);
  const [src, setSrc] = useState("");
  useEffect(() => { setBad(false); setSrc(item?.artUrl || ""); }, [item?.artUrl]);
  const icon = item?.kind === "video" ? "film" : "note";
  return (
    <div className="md-art" style={{ width: size, height: size }}>
      {src && !bad ? <img src={src} alt="" loading="lazy" onError={() => setBad(true)} /> : <Icon n={icon} size={Math.round(size * 0.45)} />}
    </div>
  );
}

function Controls({ m, compact = false }) {
  const busy = !m.item;
  return (
    <div className={`md-ctl${compact ? " compact" : ""}`}>
      {!compact && (
        <div className="md-seek">
          <span>{fmt(m.time)}</span>
          <input type="range" min={0} max={m.duration || 0} step={0.1} value={Math.min(m.time, m.duration || 0)} disabled={busy || !m.duration}
            onChange={(e) => seek(parseFloat(e.target.value))} aria-label="Position" />
          <span>{fmt(m.duration)}</span>
        </div>
      )}
      <div className="md-btns">
        {!compact && <button type="button" className={`md-ib${m.shuffle ? " on" : ""}`} onClick={() => setShuffle(!m.shuffle)} aria-pressed={m.shuffle} title="Shuffle" aria-label="Shuffle"><Icon n="shuffle" /></button>}
        <button type="button" className="md-ib" onClick={prev} disabled={busy} title="Previous" aria-label="Previous"><Icon n="prev" /></button>
        <button type="button" className="md-ib big" onClick={() => toggle()} disabled={busy} title={m.playing ? "Pause" : "Play"} aria-label={m.playing ? "Pause" : "Play"}><Icon n={m.playing ? "pause" : "play"} size={compact ? 18 : 22} /></button>
        <button type="button" className="md-ib" onClick={() => next()} disabled={busy} title="Next" aria-label="Next"><Icon n="next" /></button>
        {!compact && <button type="button" className={`md-ib${m.repeat !== "off" ? " on" : ""}`} onClick={cycleRepeat} title={m.repeat === "one" ? "Repeat this one" : m.repeat === "all" ? "Repeat all" : "Repeat off"} aria-label={"Repeat: " + m.repeat}>
          <Icon n="repeat" />{m.repeat === "one" && <span className="md-one">1</span>}</button>}
        {!compact && (
          <div className="md-vol">
            <button type="button" className="md-ib" onClick={toggleMute} title={m.muted ? "Unmute" : "Mute"} aria-label={m.muted ? "Unmute" : "Mute"}><Icon n={m.muted || m.volume === 0 ? "mute" : "vol"} /></button>
            <input type="range" min={0} max={1} step={0.01} value={m.muted ? 0 : m.volume} onChange={(e) => setVolume(parseFloat(e.target.value))} aria-label="Volume" />
          </div>
        )}
        {!compact && m.item && m.item.kind !== "audio" && <button type="button" className="md-ib" onClick={fullscreen} title="Full screen (or double-click the picture)" aria-label="Full screen"><Icon n="full" /></button>}
      </div>
    </div>
  );
}

// ── Clips | Media ─────────────────────────────────────────────────────────────
export function ClipsAndMedia({ children, toast }) {
  const m = useMedia();
  if (!available()) return children;
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
      <style>{CSS}</style>
      <div className="md-tabs" role="tablist" aria-label="Clips and media">
        {[["clips", "Clips"], ["media", "Media"]].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={m.tab === id} className={m.tab === id ? "on" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {/* Clips stays open underneath, so a recording keeps going */}
      <div style={{ flex: 1, display: m.tab === "clips" ? "flex" : "none", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>{children}</div>
      {m.tab === "media" && <MediaTab toast={toast} />}
    </div>
  );
}

// What's been found, kept while you move around AURA
const lib = { state: null, items: null, info: {}, loading: false };

function MediaTab({ toast }) {
  const m = useMedia();
  const [st, setSt] = useState(lib.state);
  const [items, setItems] = useState(lib.items || []);
  const [info, setInfo] = useState(lib.info);
  const [view, setView] = useState(() => local.get("aura_media_view", "all")); // all | audio | video | playlist id
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(200);
  const [yt, setYt] = useState("");
  // YouTube links you saved: kept on this PC, shown under YouTube on the left (Added by aura-media-youtube-save-setup.cjs)
  const [saved, setSaved] = useState(readSaved);
  const [renamingYt, setRenamingYt] = useState(null);
  const keepSaved = (next) => { setSaved(next); local.set(YT_SAVED, next); };
  const [adding, setAdding] = useState(null); // the item a playlist is being picked for
  const [renaming, setRenaming] = useState(null);
  const [drag, setDrag] = useState(false);
  const [note, setNote] = useState("");
  const say = (msg) => (toast ? toast(msg) : setNote(msg));
  const stage = useRef(null), panel = useRef(null);
  useEffect(() => { local.set("aura_media_view", view); setShown(200); }, [view]);
  useEffect(() => { setStage(stage.current); setPanel(panel.current); return () => { setStage(null); setPanel(null); }; });

  const refresh = useCallback(async () => {
    const s = await api().mediaState();
    if (s?.success) { lib.state = s; setSt(s); }
    const r = await api().mediaScan();
    if (r?.success) { lib.items = r.items; setItems(r.items); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const playlists = st?.playlists || [];
  const savePlaylists = async (next) => {
    setSt((s) => ({ ...s, playlists: next })); lib.state = { ...lib.state, playlists: next };
    const r = await api().mediaPlaylistsSave(next);
    if (r?.success) { setSt((s) => ({ ...s, playlists: r.playlists })); lib.state = { ...lib.state, playlists: r.playlists }; }
  };
  const artUrl = (p) => (st ? `http://127.0.0.1:${st.port}/art?p=${encodeURIComponent(p)}&t=${st.token}` : "");
  const byPath = useMemo(() => new Map(items.map((i) => [i.path.toLowerCase(), i])), [items]);
  const decorate = (it) => {
    const x = info[it.path] || {};
    return { ...it, title: x.title || it.name, artist: x.artist || "", album: x.album || "", duration: x.duration || 0, artUrl: artUrl(it.path) };
  };
  const list = useMemo(() => {
    const pl = playlists.find((p) => p.id === view);
    let base = pl
      ? pl.items.map((p) => byPath.get(p.toLowerCase()) || { path: p, name: p.split(/[\\/]/).pop().replace(/\.[^.]+$/, ""), kind: /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|wma|aiff?)$/i.test(p) ? "audio" : "video", missing: !byPath.has(p.toLowerCase()) })
      : items.filter((i) => view === "all" || i.kind === view);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      base = base.filter((i) => { const x = info[i.path] || {}; return [i.name, x.title, x.artist, x.album].some((v) => v && v.toLowerCase().includes(q)); });
    }
    return base.map(decorate);
  }, [items, info, view, query, playlists, st]); // eslint-disable-line react-hooks/exhaustive-deps

  // Read titles, artists and lengths for what's on screen
  useEffect(() => {
    const want = list.slice(0, shown).filter((i) => !i.missing && !(i.path in lib.info)).map((i) => i.path).slice(0, 60);
    if (!want.length || lib.loading) return;
    lib.loading = true;
    api().mediaInfo(want).then((r) => {
      lib.loading = false;
      if (!r?.success) return;
      for (const p of want) lib.info[p] = r.info[p] || {};
      setInfo({ ...lib.info });
    });
  }, [list, shown]);

  const play = (i) => { const playable = list.filter((x) => !x.missing); playList(playable, playable.findIndex((x) => x.path === list[i].path)); };
  const addFolder = async () => { const r = await api().mediaAddFolder(); if (r?.success) { lib.state = r; setSt(r); refresh(); } };
  const removeFolder = async (f) => { const r = await api().mediaRemoveFolder(f); if (r?.success) { lib.state = r; setSt(r); refresh(); } };
  const openFiles = async () => { const r = await api().mediaOpenFiles(); if (r?.success && r.items.length) { refresh(); playList(r.items.map(decorate)); } };
  const imported = (pls) => {
    if (!pls?.length) return;
    setSt((s) => ({ ...s, playlists: [...(s?.playlists || []), ...pls.map(({ id, name, items: it }) => ({ id, name, items: it }))] }));
    lib.state = { ...lib.state, playlists: [...playlists, ...pls] };
    setView(pls[0].id);
    const missing = pls.reduce((t, p) => t + (p.missing || 0), 0), skipped = pls.reduce((t, p) => t + (p.skipped || 0), 0);
    say(`Imported "${pls[0].name}"${pls.length > 1 ? ` and ${pls.length - 1} more` : ""}` + (missing ? `. ${missing} song${missing === 1 ? " isn't" : "s aren't"} on this PC` : "") + (skipped ? `. ${skipped} web link${skipped === 1 ? " was" : "s were"} skipped` : ""));
  };
  const importList = async () => { const r = await api().mediaImport(); if (r?.success) { imported(r.playlists); refresh(); } else if (r?.error) say(r.error); };
  const newPlaylist = (first) => {
    const id = (crypto.randomUUID?.() || String(Date.now())).slice(0, 36);
    const n = playlists.length + 1;
    const pl = { id, name: `Playlist ${n}`, items: first ? [first.path] : [] };
    savePlaylists([...playlists, pl]);
    if (!first) { setView(id); setRenaming(id); }
    return pl;
  };
  const addTo = (pl, it) => {
    if (pl.items.some((p) => p.toLowerCase() === it.path.toLowerCase())) { say(`Already in "${pl.name}"`); return; }
    savePlaylists(playlists.map((p) => (p.id === pl.id ? { ...p, items: [...p.items, it.path] } : p)));
    say(`Added to "${pl.name}"`);
  };
  const current = playlists.find((p) => p.id === view);
  const move = (i, step) => {
    const it = [...current.items]; const j = i + step;
    if (j < 0 || j >= it.length) return;
    [it[i], it[j]] = [it[j], it[i]];
    savePlaylists(playlists.map((p) => (p.id === current.id ? { ...p, items: it } : p)));
  };
  const removeAt = (i) => savePlaylists(playlists.map((p) => (p.id === current.id ? { ...p, items: p.items.filter((_x, j) => j !== i) } : p)));
  const deleteList = () => {
    if (!window.confirm(`Delete the playlist "${current.name}"? The songs and videos stay on your PC.`)) return;
    savePlaylists(playlists.filter((p) => p.id !== current.id)); setView("all");
  };
  const exportList = async () => { const r = await api().mediaExport(current.id); if (r?.success && r.saved) say("Playlist saved"); else if (r?.error) say(r.error); };

  const onDrop = async (e) => {
    e.preventDefault(); setDrag(false);
    const paths = api().mediaPathsFor?.([...(e.dataTransfer?.files || [])]) || [];
    if (!paths.length) return;
    const r = await api().mediaDropped(paths);
    if (!r?.success) { say(r?.error || "AURA can't open those."); return; }
    if (r.playlists?.length) imported(r.playlists);
    if (r.items?.length) { refresh(); playList(r.items.map(decorate)); }
    else if (!r.playlists?.length) say("There's no music or video in what you dropped.");
  };
  const playYt = () => { if (playYouTube(yt)) setYt(""); else say("That isn't a YouTube link."); };
  // Saving what's playing from YouTube (Added by aura-media-youtube-save-setup.cjs)
  const nowLink = m.item?.kind === "youtube" ? m.item.link || "" : "";
  const isSaved = !!nowLink && saved.some((s) => s.link === nowLink);
  const isList = (link) => /[?&]list=/.test(link);
  const saveYt = () => {
    if (!nowLink || isSaved) return;
    if (saved.length >= 200) { say("You can save up to 200 YouTube links. Remove one first."); return; }
    const name = (!isList(nowLink) && m.item.title) || `YouTube ${isList(nowLink) ? "playlist" : "video"} ${saved.length + 1}`;
    const s = { id: (crypto.randomUUID?.() || String(Date.now())).slice(0, 36), name: name.slice(0, 80), link: nowLink };
    keepSaved([...saved, s]);
    setRenamingYt(s.id);
    say("Saved under YouTube on the left. Type a name, or press Enter to keep this one.");
  };
  const removeYt = (s) => { keepSaved(saved.filter((x) => x.id !== s.id)); say(`Removed "${s.name}"`); };
  const renameYt = (s, n) => { n = n.trim(); if (n) keepSaved(saved.map((x) => (x.id === s.id ? { ...x, name: n.slice(0, 80) } : x))); setRenamingYt(null); };

  const counts = { all: items.length, audio: items.filter((i) => i.kind === "audio").length, video: items.filter((i) => i.kind === "video").length };
  const title = current ? current.name : view === "audio" ? "Music" : view === "video" ? "Videos" : "Everything";
  const nowVideo = m.item && m.item.kind !== "audio";
  const nowInfo = m.item ? { ...m.item, ...(info[m.item.path] || {}) } : null;

  return (
    <div className={`md${drag ? " drag" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }} onDrop={onDrop}>
      <aside className="md-side" aria-label="Media library">
        <div className="md-h">Library</div>
        {[["all", "Everything"], ["audio", "Music"], ["video", "Videos"]].map(([id, label]) => (
          <button key={id} type="button" className={`md-nav${view === id ? " on" : ""}`} onClick={() => setView(id)}>{label}<span>{counts[id]}</span></button>
        ))}
        <div className="md-h">Folders</div>
        {(st?.folders || []).map((f) => (
          <div key={f} className="md-folder" title={f}><span>{f.split(/[\\/]/).filter(Boolean).pop() || f}</span>
            <button type="button" onClick={() => removeFolder(f)} aria-label={`Remove ${f}`} title="Stop showing this folder (nothing is deleted)"><Icon n="close" size={12} /></button></div>
        ))}
        <button type="button" className="md-add" onClick={addFolder}><Icon n="plus" size={14} /> Add folder</button>
        <div className="md-h">Playlists</div>
        {playlists.map((p) => (
          <button key={p.id} type="button" className={`md-nav${view === p.id ? " on" : ""}`} onClick={() => setView(p.id)}>{p.name}<span>{p.items.length}</span></button>
        ))}
        <button type="button" className="md-add" onClick={() => newPlaylist()}><Icon n="plus" size={14} /> New playlist</button>
        <button type="button" className="md-add" onClick={importList}><Icon n="plus" size={14} /> Import playlist file</button>
        {saved.length > 0 && <>
          <div className="md-h">YouTube</div>
          {saved.map((s) => (renamingYt === s.id ? (
            <input key={s.id} className="fi md-yt-name" autoFocus defaultValue={s.name} aria-label="Name for this YouTube link" onFocus={(e) => e.target.select()}
              onBlur={(e) => renameYt(s, e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.currentTarget.value = s.name; e.currentTarget.blur(); } }} />
          ) : (
            <div key={s.id} className={`md-saved${nowLink === s.link ? " on" : ""}`}>
              <button type="button" className="md-saved-play" onClick={() => playYouTube(s.link, s.name)} onDoubleClick={() => setRenamingYt(s.id)} title="Click to play. Double-click to rename." aria-label={`Play ${s.name}`}>
                <b>{s.name}</b><span>{isList(s.link) ? "Playlist" : "Video"}</span>
              </button>
              <button type="button" onClick={() => setRenamingYt(s.id)} aria-label={`Rename ${s.name}`} title="Rename"><Icon n="edit" size={12} /></button>
              <button type="button" onClick={() => removeYt(s)} aria-label={`Remove ${s.name}`} title="Remove from your list (nothing changes on YouTube)"><Icon n="close" size={12} /></button>
            </div>
          )))}
        </>}
      </aside>

      <section className="md-main">
        <div ref={panel} className={`md-now${nowVideo ? " video" : ""}`}>
          {nowVideo ? <div ref={stage} className="md-stage" onDoubleClick={fullscreen} /> : (
            <div className="md-cover">{m.item ? <Art item={{ ...m.item, artUrl: m.art }} size={120} /> : <div className="md-empty-art"><Icon n="note" size={40} /></div>}</div>
          )}
          <div className="md-now-i">
            <div className="md-now-t">{nowInfo ? nowInfo.title || nowInfo.name : "Nothing playing"}</div>
            <div className="md-now-s">
              {m.preparing != null ? `Getting this file ready to play… ${m.preparing}%` : m.error ? <span className="md-err">{m.error}</span>
                : nowInfo ? [nowInfo.artist, nowInfo.album].filter(Boolean).join(" · ") + (m.ytList ? `${nowInfo.artist ? " · " : ""}${m.ytList.index + 1} of ${m.ytList.count}` : "") || (m.queue.length > 1 ? `${m.index + 1} of ${m.queue.length}` : "")
                : "Pick something below, or drop music and videos here."}
            </div>
            <Controls m={m} />
          </div>
        </div>

        <div className="md-bar">
          {renaming && current ? (
            <input className="fi md-rename" autoFocus defaultValue={current.name} aria-label="Playlist name"
              onBlur={(e) => { const n = e.target.value.trim(); if (n) savePlaylists(playlists.map((p) => (p.id === current.id ? { ...p, name: n.slice(0, 80) } : p))); setRenaming(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenaming(null); }} />
          ) : <div className="md-title" onDoubleClick={() => current && setRenaming(current.id)} title={current ? "Double-click to rename" : undefined}>{title}<span>{list.length}</span></div>}
          <input className="fi md-search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search" />
          <button type="button" className="btn-p md-small" disabled={!list.some((i) => !i.missing)} onClick={() => play(Math.max(0, list.findIndex((i) => !i.missing)))}>Play all</button>
          {current ? <>
            <button type="button" className="btn-gh md-small" onClick={() => setRenaming(current.id)}>Rename</button>
            <button type="button" className="btn-gh md-small" onClick={exportList}>Export</button>
            <button type="button" className="btn-gh md-small" onClick={deleteList}>Delete</button>
          </> : <button type="button" className="btn-gh md-small" onClick={openFiles}>Open files</button>}
        </div>
        <div className="md-yt">
          <input className="fi" placeholder="Paste a YouTube video or playlist link" value={yt} onChange={(e) => setYt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && playYt()} aria-label="YouTube link" />
          <button type="button" className="btn-gh md-small" disabled={!yt.trim()} onClick={playYt}>Play</button>
          {nowLink && <button type="button" className="btn-gh md-small" disabled={isSaved} onClick={saveYt} title={isSaved ? "It's in your YouTube list on the left" : "Keep what's playing in your YouTube list on the left"}>{isSaved ? "Saved" : "Save"}</button>}
        </div>
        {note && <div className="md-note" role="status">{note}</div>}

        <div className="md-list" role="list">
          {!st && <div className="md-empty">Looking for your music and videos…</div>}
          {st && !list.length && (
            <div className="md-empty">
              {current ? "This playlist is empty. Use + on any song or video to add it here." : items.length ? "Nothing matches." : <>
                <div className="md-empty-t">Add your music and videos</div>
                <div>Pick a folder like Music or Videos, open some files, or drop them anywhere here. Playlist files from other players (.m3u, .pls, .xspf, .wpl) work too.</div>
                <div className="md-empty-b"><button type="button" className="btn-p md-small" onClick={addFolder}>Add folder</button><button type="button" className="btn-gh md-small" onClick={openFiles}>Open files</button></div>
              </>}
            </div>
          )}
          {list.slice(0, shown).map((it, i) => {
            const on = m.item && m.item.path === it.path;
            return (
              <div key={it.path + i} role="listitem" className={`md-row${on ? " on" : ""}${it.missing ? " missing" : ""}`}>
                <button type="button" className="md-row-play" disabled={it.missing} onClick={() => play(i)} onDoubleClick={() => play(i)} aria-label={`Play ${it.title}`}>
                  <Art item={it} />
                  <span className="md-row-t"><span className="md-row-n">{it.title}</span><span className="md-row-s">{it.missing ? "Not on this PC" : [it.artist, it.album].filter(Boolean).join(" · ") || it.folder?.split(/[\\/]/).pop() || ""}</span></span>
                  <span className="md-row-d">{it.duration ? fmt(it.duration) : ""}</span>
                </button>
                {current ? <>
                  <button type="button" className="md-ib" onClick={() => move(i, -1)} disabled={i === 0 || !!query} aria-label={`Move ${it.title} up`} title="Move up"><Icon n="up" size={15} /></button>
                  <button type="button" className="md-ib" onClick={() => move(i, 1)} disabled={i === list.length - 1 || !!query} aria-label={`Move ${it.title} down`} title="Move down"><Icon n="down" size={15} /></button>
                  <button type="button" className="md-ib" onClick={() => removeAt(i)} disabled={!!query} aria-label={`Remove ${it.title} from the playlist`} title="Remove from playlist"><Icon n="close" size={14} /></button>
                </> : (
                  <div className="md-addto">
                    <button type="button" className="md-ib" onClick={() => setAdding(adding === it.path ? null : it.path)} aria-expanded={adding === it.path} aria-label={`Add ${it.title} to a playlist`} title="Add to a playlist"><Icon n="plus" size={15} /></button>
                    {adding === it.path && (
                      <div className="md-pop" role="menu">
                        {playlists.map((p) => <button key={p.id} type="button" role="menuitem" onClick={() => { addTo(p, it); setAdding(null); }}>{p.name}</button>)}
                        <button type="button" role="menuitem" className="new" onClick={() => { const p = newPlaylist(it); say(`Added to "${p.name}"`); setAdding(null); }}>+ New playlist</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {list.length > shown && <button type="button" className="btn-gh md-more" onClick={() => setShown((n) => n + 200)}>Show more ({list.length - shown} left)</button>}
        </div>
      </section>
      {drag && <div className="md-dropping">Drop music, videos or a playlist file to play them</div>}
    </div>
  );
}

// ── The mini player, while you're somewhere else in AURA ──────────────────────
export function MediaDock({ onOpen }) {
  const m = useMedia();
  const box = useRef(null), screen = useRef(null);
  const [pos, setPos] = useState(() => local.get("aura_media_dock", null));
  const [, force] = useState(0);
  // Show it whenever the Media tab's player isn't on screen
  useEffect(() => { const t = setInterval(() => { if (!window.__auraHidden) force((n) => n + 1); }, 500); return () => clearInterval(t); }, []); // (resting while hidden: Added by aura-release-fixes-setup.cjs)
  const visible = !!m.item && !stageVisible();
  const video = m.item && m.item.kind !== "audio";
  useEffect(() => { setMini(visible && video ? screen.current : null); return () => setMini(null); });
  const drag = useRef(null);
  if (!available() || !visible) return null;
  const W = 300;
  const style = pos ? { left: Math.min(Math.max(0, pos.x), window.innerWidth - W), top: Math.min(Math.max(0, pos.y), window.innerHeight - 80) } : { right: 20, bottom: 20 };
  const down = (e) => { if (e.target.closest("button")) return; const r = box.current.getBoundingClientRect(); drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const moveIt = (e) => { if (!drag.current) return; setPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }); };
  const up = () => { if (drag.current) { drag.current = null; setPos((p) => { if (p) local.set("aura_media_dock", p); return p; }); } };
  const open = () => { setTab("media"); onOpen?.(); };
  return (
    <div ref={box} className="md-dock" style={{ ...style, width: W }} onPointerDown={down} onPointerMove={moveIt} onPointerUp={up} onPointerCancel={up}>
      <style>{CSS}</style>
      {video && <div ref={screen} className="md-dock-screen" onDoubleClick={fullscreen} />}
      <div className="md-dock-bar">
        {!video && <Art item={{ ...m.item, artUrl: m.art }} size={38} />}
        <button type="button" className="md-dock-t" onClick={open} title="Open in Clips > Media">
          <span>{m.item.title || m.item.name}</span>
          <small>{m.preparing != null ? `Getting ready… ${m.preparing}%` : m.error || (m.queue.length > 1 ? `${m.index + 1} of ${m.queue.length}` : "Now playing")}</small>
        </button>
        <Controls m={m} compact />
        <button type="button" className="md-ib" onClick={stop} title="Stop" aria-label="Stop playing"><Icon n="close" size={15} /></button>
      </div>
    </div>
  );
}

const CSS = `
.md-tabs{display:inline-flex;align-self:flex-start;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:3px;gap:2px;margin:16px 24px 0}
.md-tabs button{background:transparent;border:0;color:var(--t2);font:inherit;font-size:13px;font-weight:500;padding:7px 18px;border-radius:8px;cursor:pointer}
.md-tabs button:hover{color:var(--t1)}
.md-tabs button.on{background:var(--ac);color:#fff}
.md-tabs button:focus-visible,.md button:focus-visible,.md-dock button:focus-visible{outline:2px solid var(--ac);outline-offset:1px}
.md{flex:1;min-height:0;display:flex;gap:18px;padding:16px 24px 20px;position:relative;line-height:1.35}
.md-side{width:210px;flex-shrink:0;overflow-y:auto;display:flex;flex-direction:column;gap:2px;text-align:left}
.md-h{font-family:'Rajdhani',sans-serif;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--t2);margin:14px 8px 6px}
.md-h:first-child{margin-top:2px}
.md-nav{display:flex;align-items:center;justify-content:space-between;gap:8px;background:transparent;border:0;color:var(--t1);font:inherit;font-size:13px;padding:8px 10px;border-radius:8px;cursor:pointer;text-align:left}
.md-nav span{font-size:11px;color:var(--t2)}
.md-nav:hover{background:var(--hover)}
.md-nav.on{background:var(--acd);color:var(--ac)}
.md-folder{display:flex;align-items:center;gap:6px;padding:6px 6px 6px 10px;font-size:12.5px;color:var(--t2)}
.md-folder span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.md-folder button{background:transparent;border:0;color:var(--t2);cursor:pointer;padding:4px;border-radius:6px;display:flex}
.md-folder button:hover{color:var(--t1);background:var(--hover)}
.md-add{display:flex;align-items:center;gap:6px;background:transparent;border:0;color:var(--ac);font:inherit;font-size:12.5px;padding:7px 10px;border-radius:8px;cursor:pointer;text-align:left}
.md-add:hover{background:var(--hover)}
.md-saved{display:flex;align-items:center;border-radius:8px}
.md-saved:hover{background:var(--hover)}
.md-saved-play{flex:1;min-width:0;display:flex;align-items:center;justify-content:space-between;gap:8px;background:transparent;border:0;color:var(--t1);font:inherit;font-size:13px;padding:8px 4px 8px 10px;cursor:pointer;text-align:left}
.md-saved.on .md-saved-play{color:var(--ac)}
.md-saved-play b{font-weight:400;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.md-saved-play span{font-size:11px;color:var(--t2);flex-shrink:0}
.md-saved>button:not(.md-saved-play){background:transparent;border:0;color:var(--t2);cursor:pointer;padding:4px;border-radius:6px;display:flex;opacity:0}
.md-saved:hover>button:not(.md-saved-play),.md-saved>button:not(.md-saved-play):focus-visible{opacity:1}
.md-saved>button:not(.md-saved-play):hover{color:var(--t1);background:var(--hover)}
.md-yt-name{width:100%;margin:2px 0;font-size:13px}
.md-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px;min-height:0}
.md-now{display:flex;gap:18px;align-items:center;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px}
.md-now.video{flex-direction:column;align-items:stretch}
.md-stage{width:100%;aspect-ratio:16/9;max-height:42vh;background:#000;border-radius:10px}
.md-cover .md-art,.md-empty-art{width:120px;height:120px;border-radius:10px}
.md-empty-art{display:flex;align-items:center;justify-content:center;background:var(--hover);color:var(--t2)}
.md-now-i{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;text-align:left}
.md-now-t{font-size:17px;font-weight:600;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.md-now-s{font-size:12.5px;color:var(--t2);min-height:17px}
.md-err{color:#ff9bae}
.md-ctl{display:flex;flex-direction:column;gap:6px;margin-top:6px}
.md-seek{display:flex;align-items:center;gap:10px;font-size:11.5px;color:var(--t2);font-variant-numeric:tabular-nums}
.md-seek input{flex:1;accent-color:var(--ac)}
.md-btns{display:flex;align-items:center;gap:4px}
.md-ib{width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;background:transparent;border:0;border-radius:8px;color:var(--t1);cursor:pointer;position:relative;flex-shrink:0;padding:0}
.md-ib:hover:not(:disabled){background:var(--hover)}
.md-ib:disabled{opacity:.35;cursor:default}
.md-ib.on{color:var(--ac)}
.md-ib.big{width:40px;height:40px;border-radius:50%;background:var(--ac);color:#fff}
.md-ib.big:hover:not(:disabled){background:var(--ac);filter:brightness(1.1)}
.md-ctl.compact .md-ib.big{width:34px;height:34px}
.md-one{position:absolute;right:3px;bottom:3px;font-size:9px;font-weight:700}
.md-vol{display:flex;align-items:center;gap:4px;margin-left:auto}
.md-vol input{width:100px;accent-color:var(--ac)}
.md-bar,.md-yt{display:flex;align-items:center;gap:8px}
.md-title{flex:1;min-width:0;font-family:'Rajdhani',sans-serif;font-size:20px;font-weight:700;color:var(--t1);text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.md-title span{font-family:inherit;font-size:13px;color:var(--t2);margin-left:10px;font-weight:600}
.md-rename{flex:1;max-width:340px}
.md-search{width:200px}
.md-yt .fi{flex:1}
.md-small{font-size:11.5px!important;padding:7px 14px!important;white-space:nowrap}
.md-note{font-size:12px;color:var(--t2)}
.md-list{flex:1;min-height:0;overflow-y:auto;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:4px}
.md-row{display:flex;align-items:center;gap:2px;border-radius:9px;padding-right:6px}
.md-row:hover{background:var(--hover)}
.md-row.on{background:var(--acd)}
.md-row.on .md-row-n{color:var(--ac)}
.md-row.missing{opacity:.5}
.md-row-play{flex:1;min-width:0;display:flex;align-items:center;gap:12px;background:transparent;border:0;color:inherit;font:inherit;text-align:left;padding:7px 8px;cursor:pointer;border-radius:9px}
.md-row-play:disabled{cursor:default}
.md-row-t{flex:1;min-width:0;display:flex;flex-direction:column}
.md-row-n{font-size:13px;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.md-row-s{font-size:11.5px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.md-row-d{font-size:11.5px;color:var(--t2);font-variant-numeric:tabular-nums;flex-shrink:0}
.md-art{flex-shrink:0;border-radius:7px;overflow:hidden;background:var(--hover);color:var(--t2);display:flex;align-items:center;justify-content:center}
.md-art img{width:100%;height:100%;object-fit:cover;display:block}
.md-addto{position:relative}
.md-pop{position:absolute;right:0;top:34px;z-index:20;min-width:190px;max-height:260px;overflow-y:auto;background:var(--panel);border:1px solid var(--border);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.5);padding:4px;display:flex;flex-direction:column}
.md-pop button{background:transparent;border:0;color:var(--t1);font:inherit;font-size:12.5px;text-align:left;padding:8px 10px;border-radius:7px;cursor:pointer}
.md-pop button:hover{background:var(--hover)}
.md-pop button.new{color:var(--ac)}
.md-more{margin:8px auto;display:block}
.md-empty{padding:40px 20px;text-align:center;color:var(--t2);font-size:13px;line-height:1.6}
.md-empty-t{font-size:16px;font-weight:600;color:var(--t1);margin-bottom:6px}
.md-empty-b{display:flex;gap:8px;justify-content:center;margin-top:14px}
.md.drag::after{content:"";position:absolute;inset:8px;border:2px dashed var(--ac);border-radius:14px;pointer-events:none}
.md-dropping{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:var(--panel);border:1px solid var(--ac);color:var(--t1);padding:14px 20px;border-radius:12px;font-size:14px;pointer-events:none;box-shadow:0 12px 40px rgba(0,0,0,.5)}
.md-dock{position:fixed;z-index:794;background:var(--panel,#141418);border:1px solid var(--border,rgba(255,255,255,.1));border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.6);overflow:hidden;cursor:grab;touch-action:none;user-select:none;line-height:1.3}
.md-dock-screen{width:100%;aspect-ratio:16/9;background:#000}
.md-dock-bar{display:flex;align-items:center;gap:6px;padding:8px}
.md-dock-t{flex:1;min-width:0;display:flex;flex-direction:column;background:transparent;border:0;color:var(--t1,#fff);font:inherit;text-align:left;cursor:pointer;padding:0 2px}
.md-dock-t span{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.md-dock-t small{font-size:10.5px;color:var(--t2,#8b8b9e);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.md-dock .md-ctl{margin:0}
.md-dock .md-btns{gap:0}
@media (max-width:900px){.md-side{width:160px}.md-search{width:130px}}
`;
