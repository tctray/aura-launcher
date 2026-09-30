// src/components/PerformancePage.jsx — live PC performance (FPS, CPU, RAM, GPU, disk, network)
import { useEffect, useMemo, useState } from "react";
import Sparkline from "./sparkline";

const TEXT = "#e8ecf4";
const MUTED = "rgba(232,236,244,0.55)";
const LINE = "rgba(255,255,255,0.08)";
const PANEL = "rgba(255,255,255,0.035)";
const HISTORY = 60;

const gb = (b) => (b / 1073741824).toFixed(1);
const fmtRate = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB/s` : `${Math.round(b / 1024)} KB/s`);
const fmtNet = (b) => { const m = (b * 8) / 1e6; return m >= 1 ? `${m.toFixed(1)} Mbps` : `${Math.round((b * 8) / 1e3)} Kbps`; };
const fpsColor = (v) => (v == null ? MUTED : v >= 60 ? "#4ade80" : v >= 30 ? "#facc15" : "#f87171");

const FPS_MESSAGES = {
  "no-game": "Launch a game from AURA to see live FPS.",
  waiting: "Waiting for the game to draw frames…",
  missing: "FPS needs PresentMon.exe in AURA's resources folder.",
  denied: "FPS needs admin rights. Run AURA as administrator, or add your account to Performance Log Users.",
  error: "Couldn't read frames. The game may run under a different process than the one AURA launched.",
  unsupported: "FPS tracking is Windows-only for now.",
};

export default function PerformancePage({ games = [], accent = "#ff7a1a" }) {
  const api = typeof window !== "undefined" ? window.electronAPI : null;
  const [hist, setHist] = useState([]);
  const [drives, setDrives] = useState([]);

  useEffect(() => {
    if (!api?.isElectron || !api.perfSubscribe) return;
    let alive = true;
    api.perfSubscribe().then((r) => {
      if (!alive || !r) return;
      setHist(r.history || []);
      setDrives(r.drives || []);
    });
    const off = api.onPerfStats((s) => setHist((h) => [...h.slice(-(HISTORY - 1)), s]));
    return () => { alive = false; off?.(); api.perfUnsubscribe(); };
  }, []);

  const now = hist[hist.length - 1];
  const series = (fn) => hist.map((s) => { try { return fn(s); } catch { return null; } });

  const gameTitle = useMemo(() => {
    if (!now?.game) return null;
    const g = games.find((g) => g.exePath?.split(/[\\/]/).pop().toLowerCase() === now.game.toLowerCase());
    return g?.title || now.game;
  }, [now?.game, games]);

  if (!api?.isElectron) {
    return <div style={{ color: MUTED, padding: 28 }}>Performance stats are available in the desktop app.</div>;
  }

  return (
    <div style={{ color: TEXT, padding: "24px 28px 48px", display: "grid", gap: 20 }}>
      <header>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-0.01em" }}>Performance</h1>
        <p style={{ margin: "4px 0 0", color: MUTED, fontSize: 14 }}>
          {gameTitle ? `Tracking ${gameTitle}` : "Live stats for your PC, updated every second."}
        </p>
      </header>

      {!now ? (
        <div style={{ ...panel, color: MUTED }}>Reading your system…</div>
      ) : (
        <>
          {/* FPS — the hero of the page */}
          <section style={{ ...panel, display: "grid", gridTemplateColumns: "minmax(180px, auto) 1fr", gap: 24, alignItems: "center" }}>
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 72, fontWeight: 800, lineHeight: 0.9, color: fpsColor(now.fps), fontVariantNumeric: "tabular-nums" }}>
                  {now.fps != null ? Math.round(now.fps) : "—"}
                </span>
                <span style={{ fontSize: 18, fontWeight: 600, color: MUTED }}>FPS</span>
              </div>
              <div style={{ color: MUTED, fontSize: 13, marginTop: 10 }}>
                {now.fps != null ? `1% low ${Math.round(now.fpsLow)} FPS` : FPS_MESSAGES[now.fpsStatus] || ""}
              </div>
            </div>
            <Sparkline values={series((s) => s.fps)} color={fpsColor(now.fps)} height={90} />
          </section>

          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}>
            <Tile title="CPU" value={`${Math.round(now.cpu)}%`} accent={accent}
                  values={series((s) => s.cpu)} max={100} />

            <Tile title="Memory" value={`${Math.round((now.ramUsed / now.ramTotal) * 100)}%`}
                  sub={`${gb(now.ramUsed)} of ${gb(now.ramTotal)} GB in use`} accent={accent}
                  values={series((s) => (s.ramUsed / s.ramTotal) * 100)} max={100} />

            {now.gpu ? (
              <Tile title="GPU" value={`${Math.round(now.gpu.util)}%`} accent={accent}
                    sub={[
                      now.gpu.temp != null && `${Math.round(now.gpu.temp)}°C`,
                      now.gpu.vramUsed != null && now.gpu.vramTotal && `VRAM ${(now.gpu.vramUsed / 1024).toFixed(1)} of ${(now.gpu.vramTotal / 1024).toFixed(1)} GB`,
                    ].filter(Boolean).join(" · ") || now.gpu.name}
                    values={series((s) => s.gpu?.util)} max={100} />
            ) : (
              <Tile title="GPU" value="—" sub="Usage isn't reported for this graphics card." accent={accent} values={[]} />
            )}

            <Tile title="Disk" value={fmtRate(now.diskRead + now.diskWrite)} accent={accent}
                  sub={`Read ${fmtRate(now.diskRead)} · Write ${fmtRate(now.diskWrite)}${now.diskBusy != null ? ` · ${Math.round(now.diskBusy)}% active` : ""}`}
                  values={series((s) => s.diskRead + s.diskWrite)} />

            <Tile title="Network" value={fmtNet(now.netDown)} accent={accent}
                  sub={`Down ${fmtNet(now.netDown)} · Up ${fmtNet(now.netUp)}`}
                  values={series((s) => s.netDown)} />
          </div>

          {drives.length > 0 && (
            <section style={panel}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 650 }}>Storage</h2>
              <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
                {drives.map((d) => {
                  const pct = (d.used / d.size) * 100;
                  return (
                    <div key={d.mount}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 5 }}>
                        <span>{d.mount}</span>
                        <span style={{ color: MUTED }}>{gb(d.size - d.used)} GB free of {gb(d.size)} GB</span>
                      </div>
                      <div style={{ height: 8, background: LINE, borderRadius: 4 }}>
                        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 4, background: pct > 90 ? "#f87171" : accent }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ title, value, sub, values, max, accent }) {
  return (
    <section style={{ ...panel, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: MUTED }}>{title}</h2>
        <span style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{value}</span>
      </div>
      <Sparkline values={values} color={accent} height={44} max={max} />
      {sub && <div style={{ color: MUTED, fontSize: 12.5 }}>{sub}</div>}
    </section>
  );
}

const panel = { background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: 20 };