// src/components/SessionsPage.jsx — look back on play sessions with metrics
import { useEffect, useMemo, useState } from "react";
import { loadSessions, deleteSession, clearSessions } from "../sessionstore";
import Sparkline from "./sparkline";

const TEXT = "#e8ecf4";
const MUTED = "rgba(232,236,244,0.55)";
const LINE = "rgba(255,255,255,0.08)";
const PANEL = "rgba(255,255,255,0.035)";

const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
const fmtDur = (ms) => {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${Math.max(1, m)}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};
const fmtClock = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fmtGB = (b) => `${(b / 1073741824).toFixed(1)} GB`;
const coverOf = (g) => g?.cover || g?.coverUrl || g?.image || null;

function dayLabel(dayStart) {
  const today = startOfDay(Date.now());
  if (dayStart === today) return "Today";
  if (dayStart === addDays(today, -1)) return "Yesterday";
  return new Date(dayStart).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

export default function SessionsPage({ games = [], accent = "#ff7a1a" }) {
  const [sessions, setSessions] = useState(loadSessions);
  const [range, setRange] = useState("7d");
  const [gameFilter, setGameFilter] = useState("all");

  useEffect(() => {
    const refresh = () => setSessions(loadSessions());
    window.addEventListener("aura-sessions-updated", refresh);
    return () => window.removeEventListener("aura-sessions-updated", refresh);
  }, []);

  const gameByExe = useMemo(() => Object.fromEntries(games.map((g) => [g.exePath, g])), [games]);

  const filtered = useMemo(() => {
    const today = startOfDay(Date.now());
    const since = range === "7d" ? addDays(today, -6) : range === "30d" ? addDays(today, -29) : 0;
    return sessions.filter((s) => s.start >= since && (gameFilter === "all" || s.exePath === gameFilter));
  }, [sessions, range, gameFilter]);

  const stats = useMemo(() => {
    const total = filtered.reduce((a, s) => a + s.durationMs, 0);
    const longest = filtered.reduce((m, s) => (s.durationMs > (m?.durationMs || 0) ? s : m), null);
    const fpsVals = filtered.map((s) => s.perf?.avgFps).filter((v) => v != null);
    return {
      total,
      count: filtered.length,
      avg: filtered.length ? total / filtered.length : 0,
      longest,
      avgFps: fpsVals.length ? fpsVals.reduce((a, b) => a + b, 0) / fpsVals.length : null,
    };
  }, [filtered]);

  const streak = useMemo(() => {
    const days = new Set(sessions.map((s) => startOfDay(s.start)));
    let d = startOfDay(Date.now());
    if (!days.has(d)) d = addDays(d, -1);
    let n = 0;
    while (days.has(d)) { n++; d = addDays(d, -1); }
    return n;
  }, [sessions]);

  const chart = useMemo(() => {
    const today = startOfDay(Date.now());
    let buckets;
    if (range === "all") {
      buckets = [];
      let end = addDays(today, 1);
      for (let i = 0; i < 12; i++) {
        const start = addDays(end, -7);
        buckets.unshift({ start, end, label: new Date(start).toLocaleDateString([], { month: "short", day: "numeric" }), ms: 0 });
        end = start;
      }
    } else {
      const n = range === "7d" ? 7 : 30;
      buckets = Array.from({ length: n }, (_, i) => {
        const start = addDays(today, i - n + 1);
        const d = new Date(start);
        return {
          start, end: addDays(start, 1), ms: 0,
          label: n === 7 ? d.toLocaleDateString([], { weekday: "short" }) : String(d.getDate()),
        };
      });
    }
    for (const s of filtered) {
      const b = buckets.find((b) => s.start >= b.start && s.start < b.end);
      if (b) b.ms += s.durationMs;
    }
    return { buckets, max: Math.max(...buckets.map((b) => b.ms), 1) };
  }, [filtered, range]);

  const topGames = useMemo(() => {
    const map = new Map();
    for (const s of filtered) {
      const e = map.get(s.exePath) || { exePath: s.exePath, title: s.title, ms: 0, count: 0 };
      e.ms += s.durationMs; e.count++;
      map.set(s.exePath, e);
    }
    return [...map.values()].sort((a, b) => b.ms - a.ms).slice(0, 5);
  }, [filtered]);

  const hours = useMemo(() => {
    const h = Array(24).fill(0);
    for (const s of filtered) h[new Date(s.start).getHours()] += s.durationMs;
    return { h, max: Math.max(...h, 1) };
  }, [filtered]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const s of filtered) {
      const d = startOfDay(s.start);
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(s);
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [filtered]);

  const gameOptions = useMemo(() => {
    const map = new Map();
    for (const s of sessions) if (!map.has(s.exePath)) map.set(s.exePath, gameByExe[s.exePath]?.title || s.title);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [sessions, gameByExe]);

  const titleOf = (s) => gameByExe[s.exePath]?.title || s.title;

  return (
    <div style={{ color: TEXT, padding: "24px 28px 48px", display: "grid", gap: 20 }}>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 16, justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-0.01em" }}>Sessions</h1>
          <p style={{ margin: "4px 0 0", color: MUTED, fontSize: 14 }}>
            Every game you launch from AURA, with how long you played and how it ran.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select value={gameFilter} onChange={(e) => setGameFilter(e.target.value)} style={selectStyle}>
            <option value="all">All games</option>
            {gameOptions.map(([exe, title]) => <option key={exe} value={exe}>{title}</option>)}
          </select>
          <div role="tablist" style={{ display: "flex", background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 3 }}>
            {[["7d", "7 days"], ["30d", "30 days"], ["all", "All time"]].map(([k, label]) => (
              <button key={k} role="tab" aria-selected={range === k} onClick={() => setRange(k)}
                style={{
                  border: 0, borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600,
                  background: range === k ? accent : "transparent", color: range === k ? "#10131c" : MUTED,
                }}>{label}</button>
            ))}
          </div>
        </div>
      </header>

      {sessions.length === 0 ? (
        <div style={{ ...panel, padding: 40, textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>No sessions yet</p>
          <p style={{ margin: "6px 0 0", color: MUTED, fontSize: 14 }}>
            Launch a game from your library. Sessions longer than 30 seconds show up here when you close the game.
          </p>
        </div>
      ) : (
        <>
          {/* Headline numbers */}
          <section style={{ ...panel, display: "flex", flexWrap: "wrap", gap: "12px 40px", alignItems: "baseline" }}>
            <div>
              <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1, color: accent }}>{fmtDur(stats.total)}</div>
              <div style={{ color: MUTED, fontSize: 13, marginTop: 6 }}>played across {stats.count} session{stats.count === 1 ? "" : "s"}</div>
            </div>
            <Stat label="Average session" value={stats.count ? fmtDur(stats.avg) : "—"} />
            <Stat label="Longest session" value={stats.longest ? fmtDur(stats.longest.durationMs) : "—"}
                  sub={stats.longest ? titleOf(stats.longest) : null} />
            <Stat label="Average FPS" value={stats.avgFps != null ? Math.round(stats.avgFps) : "—"} />
            <Stat label="Day streak" value={streak} />
          </section>

          <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
            {/* Playtime chart */}
            <section style={panel}>
              <h2 style={h2}>{range === "all" ? "Playtime by week" : "Playtime by day"}</h2>
              <div style={{ display: "flex", alignItems: "flex-end", gap: range === "30d" ? 3 : 8, height: 140, marginTop: 14 }}>
                {chart.buckets.map((b) => (
                  <div key={b.start} title={`${b.label}: ${b.ms ? fmtDur(b.ms) : "no play"}`}
                       style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
                    <div style={{
                      height: `${(b.ms / chart.max) * 100}%`, minHeight: b.ms ? 3 : 1,
                      background: b.ms ? accent : LINE, borderRadius: 4,
                    }} />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: range === "30d" ? 3 : 8, marginTop: 6 }}>
                {chart.buckets.map((b, i) => (
                  <div key={b.start} style={{ flex: 1, textAlign: "center", fontSize: 11, color: MUTED, overflow: "hidden", whiteSpace: "nowrap" }}>
                    {range === "30d" && i % 5 !== 4 ? "" : range === "all" && i % 3 !== 2 ? "" : b.label}
                  </div>
                ))}
              </div>
            </section>

            {/* Top games */}
            <section style={panel}>
              <h2 style={h2}>Most played</h2>
              <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
                {topGames.map((g) => (
                  <div key={g.exePath}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 5 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{gameByExe[g.exePath]?.title || g.title}</span>
                      <span style={{ color: MUTED, flexShrink: 0, marginLeft: 12 }}>{fmtDur(g.ms)}</span>
                    </div>
                    <div style={{ height: 6, background: LINE, borderRadius: 3 }}>
                      <div style={{ width: `${(g.ms / topGames[0].ms) * 100}%`, height: "100%", background: accent, borderRadius: 3 }} />
                    </div>
                  </div>
                ))}
                {!topGames.length && <p style={{ color: MUTED, fontSize: 14, margin: 0 }}>No sessions in this range.</p>}
              </div>
            </section>
          </div>

          {/* Start times */}
          <section style={panel}>
            <h2 style={h2}>When you start playing</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 3, marginTop: 14 }}>
              {hours.h.map((ms, i) => (
                <div key={i} title={`${new Date(2000, 0, 1, i).toLocaleTimeString([], { hour: "numeric" })}: ${ms ? fmtDur(ms) : "none"}`}
                     style={{ height: 26, borderRadius: 4, background: ms ? accent : LINE, opacity: ms ? 0.25 + 0.75 * (ms / hours.max) : 1 }} />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", color: MUTED, fontSize: 11, marginTop: 6 }}>
              <span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>11 PM</span>
            </div>
          </section>

          {/* History */}
          <section style={{ display: "grid", gap: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ ...h2, fontSize: 18 }}>History</h2>
              <button onClick={() => window.confirm("Delete all session history? Game playtime totals aren't affected.") && clearSessions()}
                      style={{ ...ghostBtn }}>Clear history</button>
            </div>
            {grouped.map(([day, list]) => (
              <div key={day}>
                <div style={{ color: MUTED, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                  {dayLabel(day)} <span style={{ fontWeight: 400 }}>· {fmtDur(list.reduce((a, s) => a + s.durationMs, 0))}</span>
                </div>
                <div style={{ ...panel, padding: 0 }}>
                  {list.map((s, i) => (
                    <SessionRow key={s.id} s={s} game={gameByExe[s.exePath]} title={titleOf(s)}
                                accent={accent} first={i === 0} />
                  ))}
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function SessionRow({ s, game, title, accent, first }) {
  const cover = coverOf(game);
  const p = s.perf;
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "center", padding: "12px 16px", borderTop: first ? 0 : `1px solid ${LINE}` }}>
      <div style={{ width: 40, height: 54, borderRadius: 6, flexShrink: 0, background: LINE, overflow: "hidden" }}>
        {cover && <img src={cover} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        <div style={{ color: MUTED, fontSize: 13, marginTop: 2 }}>{fmtClock(s.start)} – {fmtClock(s.end)}</div>
        {p && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {p.avgFps != null && <Chip>{Math.round(p.avgFps)} FPS avg</Chip>}
            {p.lowFps != null && <Chip>{Math.round(p.lowFps)} FPS 1% low</Chip>}
            {p.avgCpu != null && <Chip>CPU {Math.round(p.avgCpu)}%</Chip>}
            {p.avgGpu != null && <Chip>GPU {Math.round(p.avgGpu)}%</Chip>}
            {p.peakRam != null && <Chip>RAM peak {fmtGB(p.peakRam)}</Chip>}
          </div>
        )}
      </div>
      {p?.fpsTrace && (
        <div style={{ width: 120, flexShrink: 0 }} title="FPS over the session">
          <Sparkline values={p.fpsTrace} color={accent} height={34} />
        </div>
      )}
      <div style={{ fontWeight: 700, fontSize: 15, flexShrink: 0, minWidth: 64, textAlign: "right" }}>{fmtDur(s.durationMs)}</div>
      <button onClick={() => deleteSession(s.id)} aria-label={`Delete ${title} session`} title="Delete session"
              style={{ ...ghostBtn, padding: "4px 8px", fontSize: 16, lineHeight: 1 }}>×</button>
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
      <div style={{ color: MUTED, fontSize: 13 }}>{label}{sub ? ` · ${sub}` : ""}</div>
    </div>
  );
}

function Chip({ children }) {
  return (
    <span style={{ fontSize: 12, padding: "3px 8px", borderRadius: 999, background: "rgba(255,255,255,0.06)", color: TEXT }}>
      {children}
    </span>
  );
}

const panel = { background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: 20 };
const h2 = { margin: 0, fontSize: 15, fontWeight: 650 };
const selectStyle = {
  background: PANEL, color: TEXT, border: `1px solid ${LINE}`, borderRadius: 10,
  padding: "8px 10px", fontSize: 13, outline: "none",
};
const ghostBtn = {
  background: "transparent", color: MUTED, border: `1px solid ${LINE}`, borderRadius: 8,
  padding: "6px 12px", fontSize: 13, cursor: "pointer",
};