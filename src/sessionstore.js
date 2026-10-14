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

// A game reopened within this long continues the same session (a restart, a crash, a launcher
// handing over), instead of a new row. Added by aura-sessions-setup.cjs.
export const MERGE_GAP_MS = 5 * 60 * 1000;
const newId = (end) => `${end}-${Math.random().toString(36).slice(2, 7)}`;
function mergePerf(a, aMs, b, bMs) {
  if (!a) return b || null;
  if (!b) return a;
  const w = (x, y) => (x == null ? y : y == null ? x : Math.round(((x * aMs + y * bMs) / Math.max(1, aMs + bMs)) * 10) / 10);
  const lo = (x, y) => (x == null ? y : y == null ? x : Math.min(x, y));
  const hi = (x, y) => (x == null ? y : y == null ? x : Math.max(x, y));
  let trace = [...(a.fpsTrace || []), ...(b.fpsTrace || [])];
  while (trace.length > 40) { const t = []; for (let i = 0; i < trace.length; i += 2) { const pair = [trace[i], trace[i + 1]].filter((v) => v != null); t.push(pair.length ? Math.round(pair.reduce((p, q) => p + q, 0) / pair.length) : null); } trace = t; }
  return { ...a, ...b, avgFps: w(a.avgFps, b.avgFps), lowFps: lo(a.lowFps, b.lowFps), avgCpu: w(a.avgCpu, b.avgCpu), peakCpu: hi(a.peakCpu, b.peakCpu), peakRam: hi(a.peakRam, b.peakRam), avgGpu: w(a.avgGpu, b.avgGpu), fpsTrace: trace.length ? trace : null };
}

export function addSession(game, data) {
  if (!data?.sessionMs || !data.exePath) return;
  const end = data.endTime || Date.now();
  const start = data.startTime || end - data.sessionMs;
  const list = loadSessions();
  // Guard against the same session being reported twice
  if (list.some((s) => s.exePath === data.exePath && s.end === end)) return;

  // Picked up again within a few minutes: one longer session (a new id, so it syncs as the new one)
  const at = list.findIndex((s) => s.exePath === data.exePath);
  const prev = at >= 0 ? list[at] : null;
  if (prev && start >= prev.end - 60000 && start - prev.end <= MERGE_GAP_MS) {
    list.splice(at, 1);
    list.unshift({ ...prev, id: newId(end), end: Math.max(prev.end, end), durationMs: prev.durationMs + data.sessionMs, perf: mergePerf(prev.perf, prev.durationMs, data.perf || null, data.sessionMs), outside: prev.outside && !!data.detected });
    save(list.slice(0, MAX_SESSIONS));
    return;
  }
  if (data.sessionMs < MIN_SESSION_MS) return;

  list.unshift({
    id: newId(end),
    exePath: data.exePath,
    title: game?.title || data.exePath.split(/[\\/]/).pop().replace(/\.exe$/i, ""),
    category: game?.category || "Other",
    start,
    end,
    durationMs: data.sessionMs,
    perf: data.perf || null,
    outside: !!data.detected, // started from Steam, Epic, Xbox or a shortcut rather than AURA's Play button
  });
  save(list.slice(0, MAX_SESSIONS));
}

export function deleteSession(id) {
  save(loadSessions().filter((s) => s.id !== id));
}

export function clearSessions() {
  save([]);
}