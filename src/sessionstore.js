// src/sessionStore.js — saves every play session to localStorage
const KEY = "aura_sessions";
const MAX_SESSIONS = 2000;
export const MIN_SESSION_MS = 30 * 1000; // ignore launches that close almost instantly

export function loadSessions() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}

function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
  window.dispatchEvent(new Event("aura-sessions-updated"));
}

export function addSession(game, data) {
  if (!data?.sessionMs || data.sessionMs < MIN_SESSION_MS) return;
  const end = data.endTime || Date.now();
  const list = loadSessions();
  // Guard against the same session being reported twice
  if (list.some((s) => s.exePath === data.exePath && s.end === end)) return;

  list.unshift({
    id: `${end}-${Math.random().toString(36).slice(2, 7)}`,
    exePath: data.exePath,
    title: game?.title || data.exePath.split(/[\\/]/).pop().replace(/\.exe$/i, ""),
    category: game?.category || "Other",
    start: data.startTime || end - data.sessionMs,
    end,
    durationMs: data.sessionMs,
    perf: data.perf || null,
  });
  save(list.slice(0, MAX_SESSIONS));
}

export function deleteSession(id) {
  save(loadSessions().filter((s) => s.id !== id));
}

export function clearSessions() {
  save([]);
}