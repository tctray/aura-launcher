// src/components/AuraBar.jsx — floating overlay bar (F10 to show/hide)
// Styled after the Xbox Game Bar: one dark strip split into three segments.
import { useEffect, useState } from "react";

const BAR_H = 56;

// Same accent colors as the main app's themes
const THEME_ACCENTS = {
  midnight: "#FF5722", obsidian: "#888888", blood: "#cc0000", ocean: "#1e90ff", neon: "#00d4ff",
  crimson: "#e53935", forest: "#43a047", slate: "#7c4dff", gold: "#ffc107",
};

function readLocal() {
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  let profile = null, custom = null;
  try { profile = JSON.parse(get("aura_profile")); } catch {}
  try { custom = JSON.parse(get("aura_custom_theme")); } catch {}
  const theme = get("aura_theme") || "midnight";
  const accent = get("aura_accent") || (theme === "custom" ? custom?.ac : THEME_ACCENTS[theme]) || "#FF5722";
  return { avatar: profile?.avatar || "", username: profile?.username || "", accent };
}

const icons = {
  record: <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />,
  camera: (<>
    <path d="M4 8h3l2-2.5h6L17 8h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </>),
  gauge: (<>
    <path d="M4.5 17a8 8 0 1 1 15 0" />
    <path d="M12 13l4-4" />
    <circle cx="12" cy="13" r="1" fill="currentColor" />
  </>),
  home: (<>
    <path d="M4 11l8-6.5 8 6.5" />
    <path d="M6.5 9.5V19h11V9.5" />
  </>),
  close: <path d="M7 7l10 10M17 7L7 17" />,
};

function Icon({ name, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {icons[name]}
    </svg>
  );
}

const fmtElapsed = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
};

export default function AuraBar() {
  const api = window.electronAPI;
  const [state, setState] = useState({ recording: false, recStartedAt: null, game: null, hotkey: "Ctrl+Alt+R" });
  const [now, setNow] = useState(Date.now());
  const [statsOpen, setStatsOpen] = useState(false);
  const [stats, setStats] = useState(null);
  const [toast, setToast] = useState(null);
  const [local, setLocal] = useState(readLocal);
  const [avatarErr, setAvatarErr] = useState(false);
  const ACCENT = local.accent;

  // Pick up profile picture / theme changes made in the main window
  useEffect(() => {
    const refresh = () => { setLocal(readLocal()); setAvatarErr(false); };
    window.addEventListener("storage", refresh);
    const t = setInterval(refresh, 5000);
    return () => { window.removeEventListener("storage", refresh); clearInterval(t); };
  }, []);

  // Transparent window background
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    document.body.style.margin = "0";
    document.body.style.overflow = "hidden";
  }, []);

  // Clock + recording timer
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Recording / game state from the main process
  useEffect(() => {
    if (api?.barGetState) {
      api.barGetState().then((s) => s && setState((p) => ({ ...p, ...s })));
      const off = api.onBarState?.((s) => setState((p) => ({ ...p, ...s })));
      return () => off?.();
    }
    // Older preload: follow the recording events instead
    const start = () => setState((p) => ({ ...p, recording: true, recStartedAt: Date.now() }));
    const stop = () => setState((p) => ({ ...p, recording: false, recStartedAt: null }));
    api?.onRecordingStarted?.(start);
    api?.onRecordingStopped?.(stop);
    api?.onRecordingHotkey?.((_e, a) => (a === "start" ? start() : stop()));
  }, []);

  // Live stats only while the panel is open
  useEffect(() => {
    if (!statsOpen || !api?.perfSubscribe) return;
    api.perfSubscribe().then((r) => r?.history?.length && setStats(r.history[r.history.length - 1]));
    const off = api.onPerfStats(setStats);
    return () => { off?.(); api.perfUnsubscribe(); };
  }, [statsOpen]);

  const showToast = (text) => {
    setToast(text);
    setTimeout(() => setToast(null), 2200);
  };

  const toggleStats = () => {
    const next = !statsOpen;
    setStatsOpen(next);
    api?.barSetExpanded?.(next);
  };

  const toggleRecord = async () => {
    if (!api?.barToggleRecord) { showToast("Add the bar lines to preload.js"); return; }
    const r = await api.barToggleRecord();
    if (r && r.success === false && r.error) showToast(r.error);
  };

  const screenshot = async () => {
    const shoot = api?.barScreenshot || api?.takeScreenshot;
    if (!shoot) { showToast("Screenshot unavailable"); return; }
    const r = await shoot();
    showToast(r?.success ? "Screenshot saved" : "Screenshot failed");
  };

  const openAura = () => (api?.barOpenAura || api?.focusMain)?.();

  const close = () => {
    if (statsOpen) { setStatsOpen(false); api?.barSetExpanded?.(false); }
    (api?.barClose || api?.aurabarHide)?.();
  };

  const clock = new Date(now).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const recLabel = state.recording
    ? `Stop recording (${state.hotkey})`
    : `Start recording (${state.hotkey})`;

  return (
    <div style={{ fontFamily: "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif", color: "#f2f4f8", userSelect: "none" }}>
      <style>{`
        .ab-btn { -webkit-app-region: no-drag; background: transparent; border: 0; color: inherit;
          height: ${BAR_H}px; min-width: 56px; padding: 0 16px; display: flex; align-items: center;
          justify-content: center; gap: 8px; cursor: pointer; position: relative; font: inherit; }
        .ab-btn:hover { background: rgba(255,255,255,0.08); }
        .ab-btn:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: -2px; }
        .ab-btn[data-active="true"]::after { content: ""; position: absolute; left: 50%; bottom: 7px;
          width: 28px; height: 3px; margin-left: -14px; border-radius: 2px; background: ${ACCENT}; }
        @keyframes ab-pulse { 50% { opacity: 0.35; } }
        @media (prefers-reduced-motion: reduce) { .ab-pulse { animation: none !important; } }
      `}</style>

      {/* The bar */}
      <div style={{
        display: "flex", alignItems: "stretch", height: BAR_H, borderRadius: 12, overflow: "hidden",
        background: "#0b0d11", boxShadow: "0 8px 28px rgba(0,0,0,0.45)", border: "1px solid rgba(255,255,255,0.06)",
        WebkitAppRegion: "drag",
      }}>
        {/* Left: what's playing — drag the bar from here */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 16px 0 10px", minWidth: 0, maxWidth: 200 }}
             title="Drag to move">
          {local.avatar && !avatarErr ? (
            <img src={local.avatar} alt="" onError={() => setAvatarErr(true)}
                 style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", flexShrink: 0,
                          border: `2px solid ${ACCENT}` }} />
          ) : (
            <div style={{
              width: 36, height: 36, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center",
              background: ACCENT, color: "#10131c", fontWeight: 800, fontSize: 15,
            }}>{(local.username || "A").charAt(0).toUpperCase()}</div>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {toast || state.game || local.username || "AURA"}
            </div>
            <div style={{ fontSize: 11, color: "rgba(242,244,248,0.55)", whiteSpace: "nowrap" }}>
              {state.game ? "Playing now" : "F10 to hide"}
            </div>
          </div>
        </div>

        {/* Middle: actions */}
        <div style={{ display: "flex", background: "#1a1d24" }}>
          <button className="ab-btn" onClick={toggleRecord} title={recLabel} aria-label={recLabel}
                  data-active={state.recording}
                  style={{ color: state.recording ? "#ff4d4f" : undefined, minWidth: state.recording ? 92 : 56 }}>
            <span className={state.recording ? "ab-pulse" : ""}
                  style={{ display: "flex", animation: state.recording ? "ab-pulse 1.4s ease-in-out infinite" : "none" }}>
              <Icon name={state.recording ? "stop" : "record"} />
            </span>
            {state.recording && (
              <span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "#f2f4f8" }}>
                {fmtElapsed(now - (state.recStartedAt || now))}
              </span>
            )}
          </button>
          <button className="ab-btn" onClick={screenshot} title="Take screenshot" aria-label="Take screenshot">
            <Icon name="camera" />
          </button>
          <button className="ab-btn" onClick={toggleStats} data-active={statsOpen}
                  title="Performance" aria-label="Performance" aria-expanded={statsOpen}>
            <Icon name="gauge" />
          </button>
          <button className="ab-btn" onClick={openAura} title="Open AURA" aria-label="Open AURA">
            <Icon name="home" />
          </button>
        </div>

        {/* Right: clock + close */}
        <div style={{ display: "flex", alignItems: "center", paddingLeft: 18 }}>
          <span style={{ fontSize: 20, fontWeight: 600, fontVariantNumeric: "tabular-nums", paddingRight: 6 }}>{clock}</span>
          <button className="ab-btn" onClick={close} title="Close bar (F10 to reopen)" aria-label="Close bar">
            <Icon name="close" />
          </button>
        </div>
      </div>

      {/* Performance panel */}
      {statsOpen && (
        <div style={{
          marginTop: 8, borderRadius: 12, background: "#0b0d11", border: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "0 8px 28px rgba(0,0,0,0.45)", display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 1fr",
          padding: "14px 6px",
        }}>
          <Stat label="FPS" big accent={ACCENT} value={stats?.fps != null ? Math.round(stats.fps) : "—"}
                sub={stats?.fps != null ? `1% low ${Math.round(stats.fpsLow)}` : stats?.game ? "Waiting…" : "No game running"} />
          <Stat label="CPU" value={stats ? `${Math.round(stats.cpu)}%` : "—"} />
          <Stat label="RAM" value={stats ? `${Math.round((stats.ramUsed / stats.ramTotal) * 100)}%` : "—"}
                sub={stats ? `${(stats.ramUsed / 1073741824).toFixed(1)} GB` : null} />
          <Stat label="GPU" value={stats?.gpu ? `${Math.round(stats.gpu.util)}%` : "—"}
                sub={stats?.gpu?.temp != null ? `${Math.round(stats.gpu.temp)}°C` : null} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, big, accent }) {
  return (
    <div style={{ padding: "0 14px", borderLeft: big ? 0 : "1px solid rgba(255,255,255,0.07)" }}>
      <div style={{ fontSize: 12, color: "rgba(242,244,248,0.55)" }}>{label}</div>
      <div style={{ fontSize: big ? 30 : 22, fontWeight: 700, lineHeight: 1.15, fontVariantNumeric: "tabular-nums",
                    color: big ? accent : "#f2f4f8" }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "rgba(242,244,248,0.55)" }}>{sub}</div>}
    </div>
  );
}