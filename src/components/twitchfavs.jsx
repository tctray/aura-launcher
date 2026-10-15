// Twitch favorites: the streamers you star, which of them are live, and a notice when one goes live.
// The list itself is kept in AURA's settings (twitchFavs), so it travels with your account.
// Added by aura-twitch-favorites-setup.cjs
import { useEffect, useRef, useState } from "react";

export const MAX_FAVS = 50;
const LOGIN = /^[a-z0-9_]{1,25}$/;
const CHECK_EVERY_MS = 2 * 60 * 1000;   // how often favorites are checked
const QUIET_MS = 30 * 60 * 1000;        // no second notice for the same streamer within this time
const PER_ASK = 10;                     // streamers per request to AURA's Twitch server

// A stream's or channel's Twitch login name ("shroud"), or "" if it can't be told
export function loginOf(s) {
  if (!s || typeof s !== "object") return "";
  const tries = [s.userLogin, s.login];
  try {
    const u = new URL(String(s.url || ""));
    if (/(^|\.)twitch\.tv$/i.test(u.hostname)) tries.push(u.pathname.split("/")[1]);
  } catch {}
  tries.push(s.user);
  for (const t of tries) {
    const v = String(t || "").trim().toLowerCase();
    if (LOGIN.test(v)) return v;
  }
  return "";
}

// What someone typed: "shroud", "@shroud", "twitch.tv/shroud" or a full link
export function parseLogin(text) {
  let v = String(text || "").trim();
  const link = /(?:^|\/\/|\.)twitch\.tv\/([^/?#\s]+)/i.exec(v);
  if (link) v = link[1];
  v = v.replace(/^@/, "").toLowerCase();
  return LOGIN.test(v) ? v : "";
}

const okPic = (v) => (typeof v === "string" && v.length < 500 && /^https:\/\/([a-z0-9-]+\.)*(jtvnw\.net|twitch\.tv)\//i.test(v) ? v : "");

// Favorites as they're saved: [{ login, name, pic? }], no repeats, at most MAX_FAVS
export function cleanFavs(list) {
  const out = [];
  const seen = new Set();
  for (const f of Array.isArray(list) ? list : []) {
    const login = String(f?.login || "").trim().toLowerCase();
    if (!LOGIN.test(login) || seen.has(login)) continue;
    seen.add(login);
    const name = typeof f.name === "string" && f.name.trim() ? f.name.trim().slice(0, 40) : login;
    const pic = okPic(f.pic);
    out.push(pic ? { login, name, pic } : { login, name });
    if (out.length >= MAX_FAVS) break;
  }
  return out;
}

export const isFav = (favs, s) => {
  const login = loginOf(s);
  return !!login && Array.isArray(favs) && favs.some((f) => f?.login === login);
};

// Star or unstar a stream or channel
export function toggleFav(favs, s) {
  const list = cleanFavs(favs);
  const login = loginOf(s);
  if (!login) return list;
  if (list.some((f) => f.login === login)) return list.filter((f) => f.login !== login);
  if (list.length >= MAX_FAVS) return list;
  return cleanFavs([...list, { login, name: s.user || s.name || login, pic: s.pic }]);
}

// The names typed into "+ Streamers" before favorites existed
export function migrateFavs(text) {
  return cleanFavs(String(text || "").split(",").map((x) => ({ login: parseLogin(x) })));
}

// Who just went live: seen offline last time, live now, and not announced in the last half hour.
// Someone seen for the first time (just starred, or AURA just opened) is never announced.
export function liveChanges(prev, liveNow, logins, now, lastNotice, quietMs = QUIET_MS) {
  const next = new Map();
  const wentLive = [];
  for (const login of logins) {
    const on = liveNow.has(login);
    next.set(login, on);
    if (on && prev.get(login) === false && !(now - (lastNotice.get(login) || 0) < quietMs)) wentLive.push(login);
  }
  return { next, wentLive };
}

// Names as Twitch writes them ("pokimane" -> "Pokimane"), once a favorite has been seen live.
// A new list when something changed, otherwise null.
export function renameFavs(favs, found) {
  const list = cleanFavs(favs);
  let changed = false;
  const next = list.map((f) => {
    const s = found.get(f.login);
    const name = typeof s?.user === "string" ? s.user.trim() : "";
    if (!name || name === f.name || name.toLowerCase() !== f.login) return f;
    changed = true;
    return { ...f, name };
  });
  return changed ? next : null;
}

// Ask AURA's Twitch server which favorites are live. A Map of login -> stream, or null if it couldn't tell.
export async function fetchFavLive(logins, ask) {
  const found = new Map();
  for (let i = 0; i < logins.length; i += PER_ASK) {
    const part = logins.slice(i, i + PER_ASK);
    let res = null;
    try { res = await ask({ gameNames: [], userLogins: part }); } catch { return null; }
    if (!res?.success || !Array.isArray(res.streams)) return null;
    const wanted = new Set(part);
    for (const s of res.streams) {
      const login = loginOf(s);
      if (wanted.has(login) && !found.has(login)) found.set(login, s);
    }
  }
  return found;
}

// ── Which favorites are live right now, shared by the whole window ───────────
const store = { live: new Map(), checked: false, listeners: new Set(), checks: new Set() };
function publish(live, checked) {
  store.live = live;
  store.checked = checked;
  store.listeners.forEach((fn) => fn());
}
export function useFavLive() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    store.listeners.add(fn);
    return () => { store.listeners.delete(fn); };
  }, []);
  return { live: store.live, checked: store.checked };
}
export const favLiveStream = (login) => store.live.get(login) || null;
// Check again now (the Live page's refresh button)
export function refreshFavLive() { store.checks.forEach((fn) => fn()); }

// Runs once, in the main window: keeps checking favorites and calls onLive(stream) when one goes live
export function useFavWatch({ favs, alerts, onLive, onSeen, everyMs = CHECK_EVERY_MS }) {
  const logins = cleanFavs(favs).map((f) => f.login).join(",");
  const ref = useRef({ prev: new Map(), last: new Map() });
  ref.current.alerts = alerts;
  ref.current.onLive = onLive;
  ref.current.onSeen = onSeen;
  useEffect(() => {
    const r = ref.current;
    const list = logins ? logins.split(",") : [];
    const ask = window.electronAPI?.fetchTwitchStreams;
    // Keep what's known about streamers still starred, so the page doesn't flicker
    const kept = new Map([...store.live].filter(([login]) => list.includes(login)));
    if (!list.length || typeof ask !== "function") { publish(kept, true); return; }
    publish(kept, store.checked && kept.size === store.live.size);
    let alive = true, busy = false;
    const check = async () => {
      if (busy || !alive) return;
      busy = true;
      try {
        const found = await fetchFavLive(list, ask);
        if (!alive || !found) return; // couldn't reach Twitch: try again next time, and don't announce anyone
        const { next, wentLive } = liveChanges(r.prev, found, list, Date.now(), r.last);
        r.prev = next;
        publish(found, true);
        try { r.onSeen?.(found); } catch {}
        if (!r.alerts) return;
        for (const login of wentLive) {
          r.last.set(login, Date.now());
          try { r.onLive?.(found.get(login)); } catch {}
        }
      } finally { busy = false; }
    };
    const soon = setTimeout(check, 1200); // a moment after starring, so a few quick clicks are one check
    const timer = setInterval(check, everyMs);
    store.checks.add(check);
    return () => { alive = false; clearTimeout(soon); clearInterval(timer); store.checks.delete(check); };
  }, [logins, everyMs]);
}

// How long a stream has been live, when Twitch says when it started
export function liveFor(started, now = Date.now()) {
  const t = typeof started === "number" ? started : Date.parse(started || "");
  if (!Number.isFinite(t) || t > now) return "";
  const mins = Math.floor((now - t) / 60000);
  if (mins < 1) return "Just went live";
  if (mins < 60) return "Live " + mins + "m";
  return "Live " + Math.floor(mins / 60) + "h " + (mins % 60) + "m";
}

// ── The star on every stream card ────────────────────────────────────────────
export function FavStar({ on, name, onToggle }) {
  return (
    <button type="button" className={"twitch-fav" + (on ? " is-on" : "")} aria-pressed={on}
      title={on ? "Remove from favorites" : "Add to favorites"}
      aria-label={(on ? "Remove " : "Add ") + name + (on ? " from favorites" : " to favorites")}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      onKeyDown={(e) => e.stopPropagation()}>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}

// ── Home: add and remove favorites by name ───────────────────────────────────
export function FavEditor({ favs, onChange }) {
  const list = cleanFavs(favs);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const add = () => {
    const names = text.split(/[,\s]+/).filter(Boolean);
    if (!names.length) return;
    const bad = names.filter((n) => !parseLogin(n));
    let next = list, full = false;
    for (const n of names) {
      const login = parseLogin(n);
      if (!login || next.some((f) => f.login === login)) continue;
      if (next.length >= MAX_FAVS) { full = true; continue; }
      next = [...next, { login, name: login }];
    }
    if (next !== list) onChange(cleanFavs(next));
    setText(bad.length ? bad.join(", ") : "");
    setNote(bad.length ? "Twitch names use only letters, numbers and _ : " + bad.join(", ") : full ? "You can keep up to " + MAX_FAVS + " favorites." : "");
  };
  return (
    <div className="fav-edit">
      <div className="fav-edit-add">
        <input className="fi" value={text} onChange={(e) => { setText(e.target.value); setNote(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="Twitch name or link, e.g. shroud" aria-label="Add a favorite streamer" style={{ fontSize: 11 }}/>
        <button type="button" className="btn-p" onClick={add} disabled={!text.trim()}>Add</button>
      </div>
      {note && <div className="fav-edit-note" role="status">{note}</div>}
      {list.length > 0 && (
        <ul className="fav-chips" aria-label="Your favorite streamers">
          {list.map((f) => (
            <li key={f.login} className="fav-chip">
              <span>{f.name}</span>
              <button type="button" aria-label={"Remove " + f.name + " from favorites"} title="Remove"
                onClick={() => onChange(list.filter((x) => x.login !== f.login))}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="fav-edit-hint">Your favorites show first here and on Live Streams. Streams for games in your library show too.</div>
    </div>
  );
}

// ── Looks ────────────────────────────────────────────────────────────────────
// White only: the stream cards keep to no purple and no gold.
export const FAV_CSS = `
.twitch-fav{position:absolute;top:10px;right:10px;z-index:4;width:30px;height:30px;padding:0;border-radius:50%;display:grid;place-items:center;border:1px solid rgba(255,255,255,.22);background:rgba(0,0,0,.55);color:rgba(255,255,255,.88);cursor:pointer;opacity:0;transition:opacity .2s,transform .15s,background .15s;}
.twitch-card:hover .twitch-fav,.twitch-card:focus-within .twitch-fav,.twitch-card.on .twitch-fav,.twitch-card.ctrl-focus .twitch-fav,.twitch-fav.is-on{opacity:1;}
.twitch-fav.is-on{color:#fff;background:rgba(0,0,0,.72);border-color:rgba(255,255,255,.6);}
.twitch-fav:hover{transform:scale(1.08);background:rgba(0,0,0,.8);}
.twitch-fav:focus-visible{outline:2px solid #fff;outline-offset:2px;opacity:1;}
.reduce-motion .twitch-fav:hover{transform:none;}
.fav-row{margin-bottom:28px;}
.fav-hdr{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;}
.fav-title{margin:0;font-family:Rajdhani,sans-serif;font-size:15px;font-weight:700;letter-spacing:1.5px;color:var(--t1);}
.fav-count{font-size:11px;color:var(--t2);}
.fav-alerts{margin-left:auto;display:flex;align-items:center;gap:7px;font-size:11px;color:var(--t2);cursor:pointer;user-select:none;}
.fav-alerts input{accent-color:var(--ac);width:14px;height:14px;margin:0;cursor:pointer;}
.fav-empty{margin-bottom:22px;padding:12px 14px;border:1px dashed var(--border);border-radius:10px;font-size:12px;color:var(--t2);display:flex;align-items:center;gap:10px;}
.fav-empty svg{flex-shrink:0;color:var(--t3);}
.fav-edit{padding:0 40px;margin-bottom:12px;}
.fav-edit-add{display:flex;gap:8px;align-items:center;}
.fav-edit-add .fi{flex:1;}
.fav-edit-add .btn-p{font-size:11px;padding:7px 14px;flex-shrink:0;}
.fav-edit-add .btn-p:disabled{opacity:.5;cursor:default;}
.fav-edit-note{font-size:10px;color:var(--danger);margin-top:5px;}
.fav-chips{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:6px;}
.fav-chip{display:flex;align-items:center;gap:4px;padding:3px 4px 3px 10px;border-radius:20px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);font-size:11px;color:var(--t1);}
.fav-chip button{width:20px;height:20px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--t3);cursor:pointer;font-size:14px;line-height:1;}
.fav-chip button:hover,.fav-chip button:focus-visible{background:rgba(255,255,255,.12);color:var(--t1);}
.fav-edit-hint{font-size:10px;color:var(--t3);margin-top:6px;}
`;
if (typeof document !== "undefined" && !document.getElementById("aura-fav-css")) {
  const el = document.createElement("style");
  el.id = "aura-fav-css";
  el.textContent = FAV_CSS;
  document.head.appendChild(el);
}
