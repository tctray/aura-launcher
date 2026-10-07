/**
 * AURA — account sync
 *
 * Your game library (titles, exe paths, covers) stays on this PC.
 * These follow the signed-in account instead:
 *   - per game: favorite, total playtime, times played, last played   (useCloudGames)
 *   - achievements, streaks, themes, some settings, session history    (useCloudProfile)
 * Games are matched between PCs by their title.
 *
 * Added by aura-profile-setup.cjs. Used from the App file with two lines:
 *   useCloudGames(games, setGames, toast);
 *   useCloudProfile({ ... });
 */
import { useEffect, useRef, useState } from "react";

const GAMES_KEY = "aura_games";
const OWNER_KEY = "aura_games_owner";                     // whose numbers are in aura_games right now
const statsKey = (uid) => `aura_gamestats_${uid}`;        // an account's numbers, kept while someone else is signed in
const pendingKey = (uid) => `aura_sync_pending_${uid}`;   // changes not saved online yet
const BLANK = { f: false, t: 0, n: 0, l: 0 };             // f favorite, t playtime (ms), n times played, l last played (ms)
const FOCUS_REFRESH_MS = 5 * 60 * 1000;
const RETRY_MS = 60 * 1000;

// One short message per problem, even when both parts of the sync hit it
let lastWarning = { text: "", at: 0 };
function warn(toast, error) {
  const msg = String(error || "unknown error");
  console.warn("AURA sync:", msg);
  let text = "Couldn't sync with your AURA account. AURA will try again.";
  if (/user_games|user_data|user_sessions|play_count|schema cache|permission denied|row-level security/i.test(msg)) text = "Account sync isn't set up in Supabase yet";
  else if (/fetch failed|network|timeout|ENOTFOUND|ECONN|not logged in/i.test(msg)) text = "Offline: your changes will sync later";
  if (lastWarning.text === text && Date.now() - lastWarning.at < 15000) return;
  lastWarning = { text, at: Date.now() };
  toast?.(text, "err");
}

const readJSON = (key, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v && typeof v === "object" ? v : fallback;
  } catch { return fallback; }
};
const writeJSON = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

// "Baldur's Gate 3™" and "baldurs gate 3" count as the same game
const keyCache = new Map();
export const gameKey = (title) => {
  const t = String(title || "");
  let key = keyCache.get(t);
  if (key === undefined) {
    const raw = t.toLowerCase().replace(/[™®©]/g, "").normalize("NFKD").replace(/\p{M}+/gu, "").replace(/['’`]/g, "");
    const clean = raw.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    key = (clean || raw.trim()).slice(0, 200);
    if (keyCache.size > 5000) keyCache.clear();
    keyCache.set(t, key);
  }
  return key;
};

const whole = (v) => Math.max(0, Math.round(Number(v) || 0));
const statsOf = (g) => ({ f: !!g.favorite, t: whole(g.totalTime), n: whole(g.playCount), l: whole(g.lastPlayed) });
const same = (a, b) => a.f === b.f && a.t === b.t && a.n === b.n && a.l === b.l;
const hasStats = (s) => s.f || s.t > 0 || s.n > 0 || s.l > 0;
const withStats = (g, s) => (same(statsOf(g), s) ? g : { ...g, favorite: s.f, totalTime: s.t, playCount: s.n, lastPlayed: s.l || null });
const toSeconds = (s) => ({ ...s, t: Math.round(s.t / 1000) * 1000 });

// If two games share a title, the first one is the synced one
function firstByKey(games) {
  const map = new Map();
  for (const g of games || []) {
    const k = gameKey(g?.title);
    if (k && !map.has(k)) map.set(k, { s: statsOf(g), title: String(g.title || "") });
  }
  return map;
}
function mapFirstByKey(games, fn) {
  const seen = new Set();
  return games.map((g) => {
    const k = gameKey(g?.title);
    if (!k || seen.has(k)) return g;
    seen.add(k);
    return fn(g, k);
  });
}

const fromRow = (r) => ({
  f: !!r.favorite,
  t: whole(r.playtime_seconds) * 1000,
  n: whole(r.play_count),
  l: r.last_played ? whole(Date.parse(r.last_played)) : 0,
});
const toRow = (key, title, s) => ({
  game_key: key,
  title,
  favorite: s.f,
  playtime_seconds: Math.round(s.t / 1000),
  play_count: s.n,
  last_played: s.l ? new Date(s.l).toISOString() : null,
});

// Local changes since the last save are added on top of what's online, so
// playtime from two PCs adds up instead of one overwriting the other.
const mergeUp = (online, local, base) => toSeconds(online
  ? { f: local.f, t: online.t + Math.max(0, local.t - base.t), n: online.n + Math.max(0, local.n - base.n), l: Math.max(online.l, local.l) }
  : local);
// Bring a game up to the merged numbers, keeping anything that changed while the sync was running
const rebase = (now, merged, then) => ({
  f: now.f !== then.f ? now.f : merged.f,
  t: merged.t + Math.max(0, now.t - then.t),
  n: merged.n + Math.max(0, now.n - then.n),
  l: Math.max(merged.l, now.l),
});

export function useCloudGames(games, setGames, toast) {
  const gamesRef = useRef(games);
  gamesRef.current = games;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  // True on a brand-new install, where the library is still the built-in demo games
  const [fresh] = useState(() => { try { return localStorage.getItem(GAMES_KEY) === null; } catch { return false; } });
  const st = useRef(null);
  if (!st.current) st.current = { uid: null, known: new Map(), syncing: false, again: false, timer: null, warned: false, lastSync: 0, requestSync: null };

  useEffect(() => {
    const s = st.current;
    const cloud = window.auraCloud;
    if (!cloud?.getSession || !cloud?.getMyGames || !cloud?.saveMyGames) return;
    let alive = true;

    const requestSync = (delay) => { clearTimeout(s.timer); s.timer = setTimeout(sync, delay); };
    s.requestSync = requestSync;

    const fail = (error) => {
      if (s.warned) return;
      s.warned = true;
      warn(toastRef.current, error);
    };

    // Make sure aura_games holds this account's numbers, not the last person's
    function begin(uid) {
      let owner = null;
      try { owner = localStorage.getItem(OWNER_KEY); } catch {}
      let current = gamesRef.current;
      if (!owner) {
        // First run with sync: what's on this PC becomes this account's
        if (!fresh) {
          const pending = readJSON(pendingKey(uid), {});
          for (const [k, { s: cur }] of firstByKey(current)) if (hasStats(cur) && !pending[k]) pending[k] = { t: 0, n: 0 };
          writeJSON(pendingKey(uid), pending);
        }
        try { localStorage.setItem(OWNER_KEY, uid); } catch {}
      } else if (owner !== uid) {
        // Someone else used this PC last: put their numbers aside, bring back this account's
        const theirs = {};
        for (const [k, { s: cur }] of firstByKey(current)) if (hasStats(cur)) theirs[k] = cur;
        writeJSON(statsKey(owner), theirs);
        const mine = readJSON(statsKey(uid), {});
        current = current.map((g) => withStats(g, { ...BLANK, ...(mine[gameKey(g?.title)] || {}) }));
        writeJSON(GAMES_KEY, current);
        try { localStorage.setItem(OWNER_KEY, uid); } catch {}
        setGames(current);
        gamesRef.current = current; // React shows this a moment later; the sync below must already use it
      }
      s.known = new Map([...firstByKey(current)].map(([k, v]) => [k, v.s]));
    }

    async function sync() {
      const uid = s.uid;
      if (!alive || !uid) return;
      if (s.syncing) { s.again = true; return; }
      s.syncing = true;
      try {
        const res = await cloud.getMyGames();
        if (!alive || s.uid !== uid) return;
        if (!res?.success) { fail(res?.error); requestSync(RETRY_MS); return; }

        const online = new Map((Array.isArray(res.data) ? res.data : []).map((r) => [r.game_key, fromRow(r)]));
        const local = firstByKey(gamesRef.current);
        const pending = readJSON(pendingKey(uid), {});
        const merged = new Map();
        const toSend = [];
        for (const [k, { s: L, title }] of local) {
          const C = online.get(k);
          if (pending[k]) {
            const M = mergeUp(C, L, pending[k]);
            merged.set(k, { M, L, send: true });
            toSend.push(toRow(k, title, M));
          } else if (C) {
            merged.set(k, { M: C, L, send: false });
          }
        }

        const saved = new Set();
        let error = null;
        for (let i = 0; i < toSend.length && !error; i += 200) {
          const chunk = toSend.slice(i, i + 200);
          const r = await cloud.saveMyGames(chunk);
          if (!alive || s.uid !== uid) return;
          if (r?.success) chunk.forEach((row) => saved.add(row.game_key));
          else error = r?.error || "save failed";
        }

        // Everything that's now the same online and here
        const settled = new Map();
        for (const [k, m] of merged) if (!m.send || saved.has(k)) settled.set(k, m);

        const here = firstByKey(gamesRef.current);
        const nowPending = readJSON(pendingKey(uid), {});
        for (const k of Object.keys(nowPending)) {
          const m = settled.get(k);
          if (!here.has(k)) delete nowPending[k];                 // game was removed from the library
          else if (m && m.send) delete nowPending[k];             // saved online
          else if (m) nowPending[k] = { t: m.M.t, n: m.M.n };     // changed while syncing: count from the online numbers
        }
        writeJSON(pendingKey(uid), nowPending);

        if (settled.size) {
          for (const [k, m] of settled) s.known.set(k, m.M);
          setGames((gs) => mapFirstByKey(gs, (g, k) => {
            const m = settled.get(k);
            return m ? withStats(g, rebase(statsOf(g), m.M, m.L)) : g;
          }));
        }
        s.lastSync = Date.now();
        if (error) { fail(error); requestSync(RETRY_MS); }
        else s.warned = false;
      } catch (e) {
        fail(e?.message);
        if (alive) requestSync(RETRY_MS);
      } finally {
        s.syncing = false;
        if (s.again && alive) { s.again = false; requestSync(300); }
      }
    }

    (async () => {
      let res = null;
      try { res = await cloud.getSession(); } catch {}
      if (!alive || !res?.success || !res.data?.id) return;
      begin(res.data.id);
      s.uid = res.data.id;
      sync();
    })();

    const onOnline = () => requestSync(500);
    const onFocus = () => { if (s.uid && Date.now() - s.lastSync > FOCUS_REFRESH_MS) requestSync(500); };
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      s.uid = null;
      clearTimeout(s.timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Notice favorites and playtime changing, and save them a moment later
  useEffect(() => {
    const s = st.current;
    const uid = s.uid;
    if (!uid) return;
    const now = firstByKey(games);
    let pending = null;
    for (const [k, { s: cur }] of now) {
      const was = s.known.get(k) || BLANK;
      if (same(cur, was)) continue;
      if (!pending) pending = readJSON(pendingKey(uid), {});
      if (!pending[k]) pending[k] = { t: was.t, n: was.n };
      s.known.set(k, cur);
    }
    for (const k of [...s.known.keys()]) if (!now.has(k)) s.known.delete(k);
    if (pending) {
      writeJSON(pendingKey(uid), pending);
      s.requestSync?.(2000);
    }
  }, [games]);
}

// ══════════════════════════════════════════════════════════════════════════════
// Achievements, streaks, themes, settings and session history
// ══════════════════════════════════════════════════════════════════════════════
const DATA_OWNER_KEY = "aura_data_owner";                       // whose achievements/theme/sessions are on this PC right now
const acctKey = (uid) => `aura_acct_${uid}`;                    // an account's things, kept while someone else is signed in
const atKey = (uid) => `aura_sync_at_${uid}`;                   // when this account last changed its theme / settings here
const sessSyncedKey = (uid) => `aura_sessions_synced_${uid}`;   // session ids known to be saved online
const SESSIONS_KEY = "aura_sessions";
const MAX_SESSIONS = 2000;                                      // same limit as sessionstore.js
const SETTLE_MS = 1500;

const DEFAULT_STATS = { totalLaunches: 0, gamesAdded: 0, totalPlaytimeHours: 0, favoritesCount: 0, streakDays: 0, gamesPlayedCount: 0, lastPlayedDate: null, playedGameIds: [] };
// Settings that follow the account. Mic, audio device, recording screen, window mode and UI scale stay per PC.
const SYNCED_SETTINGS = { anim: true, counts: true, cardSize: "md", reduceMotion: false, noBlur: false, uiSounds: true, uiVolume: 0.5, streamVolume: 0.8 };

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isWebUrl = (v) => typeof v === "string" && /^https?:\/\//i.test(v);
const isLocalPic = (v) => typeof v === "string" && v !== "" && !isWebUrl(v); // a picture picked from this PC
const getItem = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const setItem = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const removeItem = (k) => { try { localStorage.removeItem(k); } catch {} };
const chunks = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

// Achievements: { id: time unlocked }. Unlocked anywhere means unlocked, keeping the earliest time.
const cleanAch = (o) => {
  const out = {};
  if (isObj(o)) for (const k of Object.keys(o).sort()) { const t = whole(o[k]); if (t > 0) out[k] = t; }
  return out;
};
const unionAch = (a, b) => {
  const out = { ...a };
  for (const k of Object.keys(b)) out[k] = out[k] ? Math.min(out[k], b[k]) : b[k];
  return cleanAch(out);
};

// Stats that follow the account. Counts that depend on this PC's library stay here.
const pickStats = (s) => ({
  totalLaunches: whole(s?.totalLaunches),
  totalPlaytimeMs: whole(s?.totalPlaytimeMs) || whole((Number(s?.totalPlaytimeHours) || 0) * 3600000),
  streakDays: whole(s?.streakDays),
  lastPlayedDate: typeof s?.lastPlayedDate === "string" ? s.lastPlayedDate : null,
});
const dayOf = (d) => (d ? Date.parse(d) || 0 : 0);
const mergeStats = (a, b) => {
  const da = dayOf(a.lastPlayedDate), db = dayOf(b.lastPlayedDate);
  const later = db > da ? b : a;
  return {
    totalLaunches: Math.max(a.totalLaunches, b.totalLaunches),
    totalPlaytimeMs: Math.max(a.totalPlaytimeMs, b.totalPlaytimeMs),
    streakDays: da === db ? Math.max(a.streakDays, b.streakDays) : later.streakDays,
    lastPlayedDate: later.lastPlayedDate,
  };
};
const hasProgress = (s) => s.totalLaunches > 0 || s.totalPlaytimeMs > 0 || s.streakDays > 0;

// A background picture picked from this PC can't travel, so it's left out
const themePick = (p) => {
  const out = {
    theme: String(p.theme || "midnight"),
    accent: p.accent || null,
    custom: isObj(p.customColors) ? p.customColors : null,
    saved: Array.isArray(p.savedThemes) ? p.savedThemes : [],
  };
  const bg = p.bgImage || "";
  if (!isLocalPic(bg)) out.bg = bg;
  return out;
};
const unit = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d; };
const pickSettings = (raw) => {
  const s = { ...SYNCED_SETTINGS, ...(isObj(raw) ? raw : {}) };
  return {
    anim: !!s.anim, counts: !!s.counts,
    cardSize: ["sm", "md", "lg"].includes(s.cardSize) ? s.cardSize : "md",
    reduceMotion: !!s.reduceMotion, noBlur: !!s.noBlur, uiSounds: !!s.uiSounds,
    uiVolume: unit(s.uiVolume, 0.5), streamVolume: unit(s.streamVolume, 0.8),
  };
};

// Sessions, as sessionstore.js saves them
const validSession = (x) => isObj(x) && typeof x.id === "string" && x.id && Number.isFinite(x.end);
function readSessions() {
  const raw = getItem(SESSIONS_KEY);
  // trusted = false means "can't tell what's here", so nothing online is ever deleted because of it
  if (raw === null) return { list: [], trusted: false };
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return { list: v.filter(validSession), trusted: true };
  } catch {}
  return { list: [], trusted: false };
}
const toSessionRow = (x) => ({
  id: x.id, game_key: gameKey(x.title), title: x.title, category: x.category, exe_path: x.exePath,
  started_at: x.start, ended_at: x.end, duration_ms: x.durationMs, perf: x.perf || null,
});
const fromSessionRow = (r) => {
  const end = Date.parse(r.ended_at) || 0;
  const durationMs = whole(r.duration_ms);
  return {
    id: String(r.id),
    exePath: r.exe_path || `account:${r.game_key || r.id}`,
    title: String(r.title || r.game_key || "Unknown game"),
    category: r.category || "Other",
    start: Date.parse(r.started_at) || end - durationMs,
    end, durationMs,
    perf: isObj(r.perf) ? r.perf : null,
  };
};

export function useCloudProfile(props) {
  const ref = useRef(props);
  ref.current = props;
  // What this PC had before the first sync, so an existing setup isn't replaced by an empty one
  const [had] = useState(() => {
    const filled = (k) => { const v = getItem(k); return v !== null && v !== "" && v !== "null" && v !== "[]"; };
    return {
      theme: ["aura_theme", "aura_accent", "aura_custom_theme", "aura_saved_themes", "aura_bg"].some(filled),
      settings: getItem("aura_settings") !== null,
      gamesOwner: getItem(OWNER_KEY), // who the favorites/playtime sync says was using this PC
    };
  });
  const st = useRef(null);
  if (!st.current) {
    st.current = {
      uid: null, syncing: false, again: false, timer: null, warned: false, lastSync: 0, requestSync: null, selfWrite: false,
      clean: { ach: null, stats: null },          // what's known to match the account
      known: { theme: null, settings: null },     // last theme / settings seen here
      target: { theme: null, settings: null },    // what the account just set them to
      settle: { theme: 0, settings: 0 },
    };
  }

  useEffect(() => {
    const s = st.current;
    const cloud = window.auraCloud;
    const needed = ["getSession", "getMyData", "saveMyData", "getMySessionIds", "getMySessions", "saveMySessions", "deleteMySessions"];
    if (!cloud || needed.some((n) => typeof cloud[n] !== "function")) return;
    let alive = true;

    const requestSync = (delay) => { clearTimeout(s.timer); s.timer = setTimeout(sync, delay); };
    s.requestSync = requestSync;

    // React shows new values a moment after they're set; anything reading them straight away uses these
    const seeNow = (patch) => { ref.current = { ...ref.current, ...patch }; };

    function writeSessions(list) {
      s.selfWrite = true;
      try {
        setItem(SESSIONS_KEY, JSON.stringify(list));
        window.dispatchEvent(new Event("aura-sessions-updated")); // the Sessions page listens for this
      } finally { s.selfWrite = false; }
    }

    // Put a theme in place: saved on this PC and shown straight away
    function setThemeHere(next) {
      const cur = ref.current;
      const sig = JSON.stringify(themePick(next));
      setItem("aura_theme", next.theme);
      setItem("aura_accent", next.accent || "");
      setItem("aura_custom_theme", JSON.stringify(next.customColors));
      setItem("aura_saved_themes", JSON.stringify(next.savedThemes));
      setItem("aura_bg", next.bgImage || "");
      if (sig !== JSON.stringify(themePick(cur))) { s.target.theme = sig; s.settle.theme = Date.now() + SETTLE_MS; }
      cur.setTheme(next.theme);
      cur.setAccent(next.accent);
      cur.setCustomColors(next.customColors);
      cur.setSavedThemes(next.savedThemes);
      if ((cur.bgImage || "") !== next.bgImage) cur.setBgImage(next.bgImage);
      seeNow({ theme: next.theme, accent: next.accent, customColors: next.customColors, savedThemes: next.savedThemes, bgImage: next.bgImage });
    }
    function takeTheme(v) {
      const cur = ref.current;
      const next = {
        theme: typeof v.theme === "string" && v.theme ? v.theme : cur.theme,
        accent: typeof v.accent === "string" && /^#[0-9a-f]{6}$/i.test(v.accent) ? v.accent : null,
        customColors: isObj(v.custom) ? v.custom : null,
        savedThemes: Array.isArray(v.saved) ? v.saved : [],
        bgImage: cur.bgImage || "",
      };
      // A web-link background travels. "No background" never removes a picture picked on this PC.
      if (typeof v.bg === "string" && !isLocalPic(v.bg) && (v.bg !== "" || !isLocalPic(next.bgImage))) next.bgImage = v.bg;
      setThemeHere(next);
    }
    function takeSettings(v) {
      const cur = ref.current;
      const next = pickSettings(v);
      const sig = JSON.stringify(next);
      if (sig === JSON.stringify(pickSettings(cur.settings))) return;
      s.target.settings = sig;
      s.settle.settings = Date.now() + SETTLE_MS;
      cur.updateSettings(next);
      seeNow({ settings: { ...(isObj(cur.settings) ? cur.settings : {}), ...next } });
    }

    // Make sure what's on this PC belongs to this account, not the last person's
    function begin(uid) {
      let owner = getItem(DATA_OWNER_KEY);
      let inferred = false;
      if (!owner) {
        if (had.gamesOwner && had.gamesOwner !== uid) { owner = had.gamesOwner; inferred = true; }
      }
      const claim = () => ({ theme: had.theme ? Date.now() : 0, settings: had.settings ? Date.now() : 0 });
      if (!owner) {
        // First run: what's on this PC becomes this account's
        if (getItem(atKey(uid)) === null) writeJSON(atKey(uid), claim());
      } else if (owner !== uid) {
        // Someone else used this PC last: put their things aside, bring back this account's
        if (inferred && getItem(atKey(owner)) === null) writeJSON(atKey(owner), claim());
        const cur = ref.current;
        const theirSynced = new Set(readJSON(sessSyncedKey(owner), []));
        writeJSON(acctKey(owner), {
          ach: cur.unlockedAch || {},
          stats: cur.stats || null,
          theme: { theme: cur.theme, accent: cur.accent || null, customColors: cur.customColors || null, savedThemes: cur.savedThemes || [], bgImage: cur.bgImage || "" },
          settings: pickSettings(cur.settings),
          sessions: readSessions().list.filter((x) => !theirSynced.has(x.id)), // only the ones not saved online yet
        });
        removeItem(sessSyncedKey(owner));

        const mine = readJSON(acctKey(uid), {});
        const myAch = isObj(mine.ach) ? mine.ach : {};
        const myStats = isObj(mine.stats) ? { ...DEFAULT_STATS, ...mine.stats } : { ...DEFAULT_STATS };
        cur.setUnlockedAch(myAch);
        cur.setStats(myStats);
        seeNow({ unlockedAch: myAch, stats: myStats });
        const t = isObj(mine.theme) ? mine.theme : {};
        setThemeHere({
          theme: typeof t.theme === "string" && t.theme ? t.theme : "midnight",
          accent: typeof t.accent === "string" ? t.accent : null,
          customColors: isObj(t.customColors) ? t.customColors : null,
          savedThemes: Array.isArray(t.savedThemes) ? t.savedThemes : [],
          bgImage: typeof t.bgImage === "string" ? t.bgImage : "",
        });
        takeSettings(isObj(mine.settings) ? mine.settings : SYNCED_SETTINGS);
        writeJSON(sessSyncedKey(uid), []);
        writeSessions(Array.isArray(mine.sessions) ? mine.sessions.filter(validSession) : []);
        removeItem(acctKey(uid));
      }
      setItem(DATA_OWNER_KEY, uid);
      s.known.theme = s.settle.theme ? s.target.theme : JSON.stringify(themePick(ref.current));
      s.known.settings = s.settle.settings ? s.target.settings : JSON.stringify(pickSettings(ref.current.settings));
    }

    async function syncData(uid, gone) {
      const res = await cloud.getMyData();
      if (gone()) return null;
      if (!res?.success) return res?.error || "load failed";
      const C = {};
      for (const r of Array.isArray(res.data) ? res.data : []) if (r && isObj(r.value)) C[r.key] = r.value;
      const cur = ref.current;
      const out = [];

      const Lach = cleanAch(cur.unlockedAch), Cach = cleanAch(C.achievements), Mach = unionAch(Lach, Cach);
      const achSig = JSON.stringify(Mach);
      if (achSig !== JSON.stringify(Cach)) out.push({ key: "achievements", value: Mach });

      const Ls = pickStats(cur.stats), Cs = C.stats ? pickStats(C.stats) : null, Ms = Cs ? mergeStats(Ls, Cs) : Ls;
      const statsSig = JSON.stringify(Ms);
      if (Cs ? statsSig !== JSON.stringify(Cs) : hasProgress(Ls)) out.push({ key: "stats", value: Ms });

      // Theme and settings: whichever PC changed them last wins
      const at = readJSON(atKey(uid), {});
      const incoming = {};
      for (const kind of ["theme", "settings"]) {
        const mine = whole(at[kind]);
        const theirs = isObj(C[kind]) ? whole(C[kind].at) : 0;
        if (theirs > mine) incoming[kind] = { value: C[kind], at: theirs, seen: mine };
        else if (mine > theirs) out.push({ key: kind, value: { ...(kind === "theme" ? themePick(cur) : pickSettings(cur.settings)), at: mine } });
      }

      let error = null;
      if (out.length) {
        const r = await cloud.saveMyData(out);
        if (gone()) return null;
        if (!r?.success) error = r?.error || "save failed";
      }
      if (!error) { s.clean.ach = achSig; s.clean.stats = statsSig; }

      // Bring this PC up to date
      if (achSig !== JSON.stringify(Lach)) ref.current.setUnlockedAch((prev) => unionAch(cleanAch(prev), Mach));
      if (statsSig !== JSON.stringify(Ls)) {
        ref.current.setStats((prev) => {
          const m = mergeStats(pickStats(prev), Ms);
          return { ...DEFAULT_STATS, ...prev, ...m, totalPlaytimeHours: Math.max(Number(prev?.totalPlaytimeHours) || 0, m.totalPlaytimeMs / 3600000) };
        });
      }
      const nowAt = readJSON(atKey(uid), {});
      for (const kind of Object.keys(incoming)) {
        if (whole(nowAt[kind]) !== incoming[kind].seen) continue; // changed here while syncing: this PC's change is newer
        if (kind === "theme") takeTheme(incoming.theme.value);
        else takeSettings(incoming.settings.value);
        nowAt[kind] = incoming[kind].at;
      }
      writeJSON(atKey(uid), nowAt);
      return error;
    }

    async function syncSessions(uid, gone) {
      const idsRes = await cloud.getMySessionIds();
      if (gone()) return null;
      if (!idsRes?.success) return idsRes?.error || "load failed";
      const online = new Set(Array.isArray(idsRes.data) ? idsRes.data.map(String) : []);
      const { list, trusted } = readSessions();
      const synced = new Set(trusted ? readJSON(sessSyncedKey(uid), []) : []);
      const localIds = new Set(list.map((x) => x.id));

      const upload = list.filter((x) => !online.has(x.id) && !synced.has(x.id));               // new here
      const removeOnline = [...online].filter((id) => !localIds.has(id) && synced.has(id));     // deleted here
      const removeHere = new Set(list.filter((x) => synced.has(x.id) && !online.has(x.id)).map((x) => x.id)); // deleted on another PC
      const download = [...online].filter((id) => !localIds.has(id) && !synced.has(id));        // new from another PC

      let error = null;
      const uploaded = new Set();
      for (const part of chunks(upload, 100)) {
        const r = await cloud.saveMySessions(part.map(toSessionRow));
        if (gone()) return null;
        if (!r?.success) { error = r?.error || "save failed"; break; }
        // Only count the ones the account confirms it saved
        for (const id of Array.isArray(r.data) ? r.data : []) { online.add(String(id)); uploaded.add(String(id)); }
      }
      for (const part of error ? [] : chunks(removeOnline, 100)) {
        const r = await cloud.deleteMySessions(part);
        if (gone()) return null;
        if (!r?.success) { error = r?.error || "delete failed"; break; }
        part.forEach((id) => online.delete(id));
      }
      const pulled = [];
      for (const part of error ? [] : chunks(download, 100)) {
        const r = await cloud.getMySessions(part);
        if (gone()) return null;
        if (!r?.success) { error = r?.error || "load failed"; break; }
        for (const row of Array.isArray(r.data) ? r.data : []) { const x = fromSessionRow(row); if (validSession(x)) pulled.push(x); }
      }

      // Put it together with whatever is on this PC right now (a game may have ended while this ran)
      const fresh = readSessions().list;
      const have = new Set();
      let next = [];
      for (const x of fresh) { if (removeHere.has(x.id) || have.has(x.id)) continue; have.add(x.id); next.push(x); }
      for (const x of pulled) { if (!have.has(x.id)) { have.add(x.id); next.push(x); } }

      // A session from another PC points at that PC's exe path. If the same game is in this library, point it here.
      const games = Array.isArray(ref.current.games) ? ref.current.games : [];
      const exes = new Set(games.map((g) => g?.exePath).filter(Boolean));
      const byKey = new Map();
      for (const g of games) { const k = gameKey(g?.title); if (k && g.exePath && !byKey.has(k)) byKey.set(k, g.exePath); }
      next = next.map((x) => {
        if (exes.has(x.exePath)) return x;
        const exe = byKey.get(gameKey(x.title));
        return exe && exe !== x.exePath ? { ...x, exePath: exe } : x;
      });
      next = next.map((x, i) => [x, i]).sort((a, b) => b[0].end - a[0].end || a[1] - b[1]).map((p) => p[0]).slice(0, MAX_SESSIONS);

      writeJSON(sessSyncedKey(uid), [...online].filter((id) => have.has(id) || synced.has(id) || uploaded.has(id)));
      const changed = next.length !== fresh.length || next.some((x, i) => x.id !== fresh[i].id || x.exePath !== fresh[i].exePath);
      if (changed) writeSessions(next);
      return error;
    }

    async function sync() {
      const uid = s.uid;
      if (!alive || !uid) return;
      if (s.syncing) { s.again = true; return; }
      s.syncing = true;
      const gone = () => !alive || s.uid !== uid;
      try {
        const e1 = await syncData(uid, gone);
        if (gone()) return;
        const e2 = await syncSessions(uid, gone);
        if (gone()) return;
        s.lastSync = Date.now();
        if (e1 || e2) throw new Error(e1 || e2);
        s.warned = false;
      } catch (e) {
        if (!s.warned) { s.warned = true; warn(ref.current.toast, e?.message); }
        if (alive) requestSync(RETRY_MS);
      } finally {
        s.syncing = false;
        if (s.again && alive) { s.again = false; requestSync(300); }
      }
    }

    (async () => {
      let res = null;
      try { res = await cloud.getSession(); } catch {}
      if (!alive || !res?.success || !res.data?.id) return;
      s.uid = res.data.id; // set first, so switching accounts below isn't mistaken for changes made by hand
      begin(res.data.id);
      sync();
    })();

    const onOnline = () => requestSync(500);
    const onFocus = () => { if (s.uid && Date.now() - s.lastSync > FOCUS_REFRESH_MS) requestSync(500); };
    const onSessions = () => { if (!s.selfWrite && s.uid) requestSync(3000); };
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    window.addEventListener("aura-sessions-updated", onSessions);
    return () => {
      alive = false;
      s.uid = null;
      clearTimeout(s.timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("aura-sessions-updated", onSessions);
    };
  }, []);

  // Achievements and stats: keep this PC's copy saved, and sync when they change
  useEffect(() => {
    const s = st.current;
    const text = JSON.stringify(props.unlockedAch || {});
    if (getItem("aura_achievements") !== text) setItem("aura_achievements", text);
    if (s.uid && JSON.stringify(cleanAch(props.unlockedAch)) !== s.clean.ach) s.requestSync?.(2000);
  }, [props.unlockedAch]);

  useEffect(() => {
    const s = st.current;
    if (isObj(props.stats)) {
      const text = JSON.stringify(props.stats);
      if (getItem("aura_stats") !== text) setItem("aura_stats", text);
    }
    if (s.uid && JSON.stringify(pickStats(props.stats)) !== s.clean.stats) s.requestSync?.(2000);
  }, [props.stats]);

  // Theme and settings: remember when they were changed on this PC
  const changedHere = (kind, sig) => {
    const s = st.current;
    const uid = s.uid;
    if (!uid) return;
    if (Date.now() < s.settle[kind]) {
      // The account's version is being put in place; that isn't a change made here
      s.known[kind] = sig;
      if (sig === s.target[kind]) s.settle[kind] = 0;
      return;
    }
    if (sig === s.known[kind]) return;
    s.known[kind] = sig;
    const at = readJSON(atKey(uid), {});
    at[kind] = Date.now();
    writeJSON(atKey(uid), at);
    s.requestSync?.(2000);
  };
  const themeSig = JSON.stringify(themePick(props));
  const settingsSig = JSON.stringify(pickSettings(props.settings));
  useEffect(() => { changedHere("theme", themeSig); }, [themeSig]);
  useEffect(() => { changedHere("settings", settingsSig); }, [settingsSig]);
}
