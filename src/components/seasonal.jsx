// AURA — seasonal decorations: Halloween, Autumn, Christmas and Winter, layered over your own theme.
// Off until you switch them on in Settings > Seasonal Decorations. Nothing here changes your theme,
// colours or background: every decoration is a see-through layer that ignores the mouse, and when
// they're off (or nothing is in season) none of it is on the page at all.
// Everything is drawn here as SVG and CSS: no pictures are downloaded.
// Added by aura-seasonal-setup.cjs.
import { useSyncExternalStore } from "react";

// ── The seasons. Add a holiday by adding an entry: when(date) says if it's on. ──
export const SEASONS = [
  { id: "halloween", name: "Halloween", dates: "October", when: (d) => d.getMonth() === 9, a: "#ff7a1a", b: "#9b4dff", c: "#16101f" },
  { id: "autumn", name: "Autumn", dates: "November", when: (d) => d.getMonth() === 10, a: "#e8833a", b: "#c9962c", c: "#7a3b1d" },
  { id: "christmas", name: "Christmas", dates: "December", when: (d) => d.getMonth() === 11, a: "#e2384d", b: "#2fae66", c: "#f5c84c" },
  { id: "winter", name: "Winter", dates: "January and February", when: (d) => d.getMonth() === 0 || d.getMonth() === 1, a: "#8fd3ff", b: "#d9ecff", c: "#5b8fd6" },
];
export const seasonById = (id) => SEASONS.find((s) => s.id === id) || null;
export const seasonFor = (date = new Date()) => SEASONS.find((s) => s.when(date)) || null;

// ── Your choices, kept on this PC ─────────────────────────────────────────────
const KEY = "aura_seasonal";
export const DEFAULTS = { on: false, mode: "auto", interface: true, effects: true, logo: true, nav: true, background: true, intensity: 2, reduceMotion: false };
const clean = (s) => {
  const o = { ...DEFAULTS };
  if (s && typeof s === "object") {
    for (const k of ["on", "interface", "effects", "logo", "nav", "background", "reduceMotion"]) if (typeof s[k] === "boolean") o[k] = s[k];
    if (s.mode === "auto" || seasonById(s.mode)) o.mode = s.mode;
    if ([1, 2, 3].includes(s.intensity)) o.intensity = s.intensity;
  }
  return o;
};
const read = () => { try { return clean(JSON.parse(localStorage.getItem(KEY) || "null")); } catch { return { ...DEFAULTS }; } };

const systemReduce = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
let store = { settings: read(), preview: null, day: new Date().toDateString(), systemReduce: systemReduce() };
const subs = new Set();
const emit = (patch) => { store = { ...store, ...patch }; subs.forEach((f) => f()); watch(); };
const subscribe = (f) => { subs.add(f); watch(); return () => { subs.delete(f); watch(); }; };
// Only while decorations are on (or previewing): follow the system's reduced-motion setting, and
// notice when the date changes (Halloween ending at midnight). With them off, nothing is listening
// and no timer runs.
let mq = null, dayTimer = 0;
const onMotion = () => emit({ systemReduce: systemReduce() });
function watch() {
  const want = subs.size > 0 && (store.settings.on || !!store.preview);
  if (want && !mq) {
    try { mq = window.matchMedia("(prefers-reduced-motion: reduce)"); mq.addEventListener?.("change", onMotion); } catch { mq = {}; }
    if (store.settings.mode === "auto") dayTimer = setInterval(() => { const day = new Date().toDateString(); if (day !== store.day) emit({ day }); }, 10 * 60 * 1000);
    if (store.systemReduce !== systemReduce()) emit({ systemReduce: systemReduce() });
  } else if (!want && mq) {
    try { mq.removeEventListener?.("change", onMotion); } catch {}
    mq = null; clearInterval(dayTimer); dayTimer = 0;
  } else if (want && store.settings.mode !== "auto" && dayTimer) { clearInterval(dayTimer); dayTimer = 0; }
  else if (want && store.settings.mode === "auto" && !dayTimer) dayTimer = setInterval(() => { const day = new Date().toDateString(); if (day !== store.day) emit({ day }); }, 10 * 60 * 1000);
}
// For the tests: is anything running while decorations are off?
if (typeof window !== "undefined") window.__auraSeasonalWatching = () => ({ listening: !!mq, timer: !!dayTimer });

export function setSeasonal(patch) {
  const settings = clean({ ...store.settings, ...patch });
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {}
  emit({ settings });
}
let previewTimer = 0;
export function previewSeason(id) {
  clearTimeout(previewTimer);
  if (!seasonById(id)) { emit({ preview: null }); return; }
  emit({ preview: id });
  previewTimer = setTimeout(() => emit({ preview: null }), 15000);
}
export const stopPreview = () => previewSeason(null);

// What's showing right now. A preview shows everything for that season, whatever the settings.
export function resolve(st = store, date = new Date()) {
  const s = st.settings;
  const motion = !(s.reduceMotion || st.systemReduce);
  if (st.preview) return { season: seasonById(st.preview), preview: true, parts: { interface: true, effects: motion, logo: true, nav: true, background: true }, intensity: s.intensity, motion };
  if (!s.on) return null;
  const season = s.mode === "auto" ? seasonFor(date) : seasonById(s.mode);
  if (!season) return null;
  return { season, preview: false, parts: { interface: s.interface, effects: s.effects && motion, logo: s.logo, nav: s.nav, background: s.background }, intensity: s.intensity, motion };
}
export const useSeasonalStore = () => useSyncExternalStore(subscribe, () => store);
export const useSeason = () => { const st = useSeasonalStore(); return resolve(st); };

// A tiny repeatable random, so decorations sit in the same places every time
const rand = (seed) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

// ── The decorations layer (one per window, over everything, ignoring the mouse) ──
export function SeasonalLayer({ playing = false }) {
  const st = useSeasonalStore();
  const r = resolve(st);
  if (!r) return null;
  const { season, parts } = r;
  const vars = { "--ssn-a": season.a, "--ssn-b": season.b, "--ssn-c": season.c };
  return (
    <>
      <div className={`ssn ssn-${season.id}${r.motion ? "" : " still"}`} aria-hidden="true" style={vars}>
        <style>{CSS}</style>
        {parts.background && <div className="ssn-bg">{season.id === "halloween" && r.motion && parts.effects && <div className="ssn-fog" />}</div>}
        {parts.nav && <NavAccent season={season} motion={r.motion} />}
        {parts.interface && <Corners season={season} />}
        {parts.effects && !playing && <Effects season={season} intensity={r.intensity} />}
      </div>
      {r.preview && <PreviewBar season={season} style={vars} />}
    </>
  );
}

function PreviewBar({ season, style }) {
  return (
    <div className="ssn-preview" role="status" style={style}>
      <span>Previewing {season.name} decorations</span>
      <button type="button" onClick={stopPreview}>Stop preview</button>
    </div>
  );
}

// Snow, leaves or bats. Only transform and opacity move, which the graphics card does cheaply,
// and everything pauses while AURA is hidden.
function Effects({ season, intensity }) {
  const scale = [0, 0.5, 1, 1.6][intensity] || 1;
  const base = { christmas: 26, winter: 14, autumn: 14, halloween: 4 }[season.id] || 0;
  const n = Math.max(season.id === "halloween" ? 2 : 4, Math.round(base * scale));
  const rnd = rand(season.id.length * 977 + n);
  const items = Array.from({ length: n }, (_x, i) => ({
    i, x: rnd() * 100, size: rnd(), dur: rnd(), delay: rnd(), sway: rnd(), hue: rnd(),
  }));
  if (season.id === "halloween") {
    return (
      <div className="ssn-fx">
        {items.map((p) => (
          <span key={p.i} className="ssn-bat" style={{ top: `${8 + p.x * 0.55}%`, animationDuration: `${16 + p.dur * 12}s`, animationDelay: `${-p.delay * 20}s`, "--s": 0.7 + p.size * 0.6 }}>
            <svg viewBox="0 0 40 18" width="34" height="16"><path className="ssn-wing" d="M20 9c-2-3-5-5-9-4 1 1 1 3 0 4-2-1-5-1-7 1 3 0 5 2 6 4 2-2 5-3 8-2 0 0 1 1 2 1s2-1 2-1c3-1 6 0 8 2 1-2 3-4 6-4-2-2-5-2-7-1-1-1-1-3 0-4-4-1-7 1-9 4z" fill="#140c1c" /></svg>
          </span>
        ))}
      </div>
    );
  }
  const leafColors = ["#e8833a", "#c9962c", "#b8452a", "#d9a441", "#9c5a2b"];
  return (
    <div className="ssn-fx">
      {items.map((p) => {
        const style = { left: `${p.x}%`, animationDuration: `${(season.id === "christmas" ? 9 : 13) + p.dur * 9}s`, animationDelay: `${-p.delay * 20}s`, "--sway": `${(p.sway - 0.5) * 80}px` };
        if (season.id === "autumn") return (
          <span key={p.i} className="ssn-fall leaf" style={style}>
            <svg viewBox="0 0 20 20" width={12 + p.size * 10} height={12 + p.size * 10}><path d="M10 1c3 3 7 4 8 9-3 0-5 2-6 5l-2 4-2-4c-1-3-3-5-6-5 1-5 5-6 8-9z" fill={leafColors[Math.floor(p.hue * leafColors.length)]} /><path d="M10 19V6" stroke="rgba(0,0,0,.25)" strokeWidth="1" /></svg>
          </span>
        );
        if (season.id === "winter") return (
          <span key={p.i} className="ssn-fall flake" style={style}>
            <svg viewBox="-10 -10 20 20" width={8 + p.size * 9} height={8 + p.size * 9}><g stroke="#e8f4ff" strokeWidth="1.4" strokeLinecap="round">{[0, 60, 120].map((a) => <path key={a} d="M0-8V8M-3-6l3 2 3-2M-3 6l3-2 3 2" transform={`rotate(${a})`} />)}</g></svg>
          </span>
        );
        return <span key={p.i} className="ssn-fall snow" style={{ ...style, width: 3 + p.size * 4, height: 3 + p.size * 4 }} />;
      })}
    </div>
  );
}

// Holiday accents along the top of the window, and on the page you're on
function NavAccent({ season, motion }) {
  const id = `ssn-p-${season.id}`;
  if (season.id === "christmas") {
    const colors = ["#ff4d5e", "#3ddc84", "#ffd257", "#5cc8ff"];
    return (
      <svg className="ssn-top" width="100%" height="26">
        <defs>
          <pattern id={`${id}-w`} width="120" height="26" patternUnits="userSpaceOnUse"><path d="M0 4q30 14 60 0t60 0" fill="none" stroke="#1d3b26" strokeWidth="1.6" /></pattern>
          {colors.map((c, i) => (
            <pattern key={c} id={`${id}-${i}`} width="120" height="26" patternUnits="userSpaceOnUse">
              <g transform={`translate(${15 + i * 30} ${[9.5, 11, 9.5, 5][i]})`}><rect x="-1.6" y="-3" width="3.2" height="3" fill="#2a3a2e" /><ellipse cy="4" rx="3.4" ry="5" fill={c} /></g>
            </pattern>
          ))}
        </defs>
        <rect width="100%" height="26" fill={`url(#${id}-w)`} />
        {colors.map((c, i) => <rect key={c} className={motion ? "ssn-twinkle" : ""} style={{ animationDelay: `${i * 0.55}s` }} width="100%" height="26" fill={`url(#${id}-${i})`} />)}
      </svg>
    );
  }
  if (season.id === "winter") return (
    <svg className="ssn-top" width="100%" height="22">
      <defs><pattern id={id} width="64" height="22" patternUnits="userSpaceOnUse"><path d="M0 0h64v3H0z" fill="rgba(235,246,255,.75)" /><path d="M4 3l3 13 3-13M18 3l2 8 2-8M30 3l3 17 3-17M46 3l2 9 2-9M56 3l2.5 12L61 3" fill="rgba(210,236,255,.7)" /></pattern></defs>
      <rect width="100%" height="22" fill={`url(#${id})`} />
    </svg>
  );
  if (season.id === "autumn") return (
    <svg className="ssn-top" width="100%" height="24">
      <defs><pattern id={id} width="90" height="24" patternUnits="userSpaceOnUse">
        <path d="M0 5q22 10 45 0t45 0" fill="none" stroke="#6b3d1f" strokeWidth="1.5" />
        <path d="M14 10c3-1 6 0 7 3-3 1-6 0-7-3z" fill="#e8833a" /><path d="M36 8c2 2 2 5 0 7-2-2-2-5 0-7z" fill="#c9962c" /><path d="M58 9c3 0 5 2 5 5-3 0-5-2-5-5z" fill="#b8452a" /><path d="M78 7c2 2 3 4 2 7-2-2-3-4-2-7z" fill="#d9a441" />
      </pattern></defs>
      <rect width="100%" height="24" fill={`url(#${id})`} />
    </svg>
  );
  // Halloween: bunting in orange, purple and black
  return (
    <svg className="ssn-top" width="100%" height="24">
      <defs><pattern id={id} width="78" height="24" patternUnits="userSpaceOnUse">
        <path d="M0 3q39 8 78 0" fill="none" stroke="#2b1d36" strokeWidth="1.3" />
        <path d="M6 4l10 15 10-14z" fill="#ff7a1a" /><path d="M32 6l10 14 10-14z" fill="#9b4dff" /><path d="M58 5l9 13 9-14z" fill="#1d1426" stroke="#ff7a1a" strokeWidth=".6" />
      </pattern></defs>
      <rect width="100%" height="24" fill={`url(#${id})`} />
    </svg>
  );
}

// A few decorations in the corners
function Corners({ season }) {
  if (season.id === "halloween") return (
    <>
      <svg className="ssn-corner tr" viewBox="0 0 120 120" width="118" height="118">
        <g stroke="rgba(230,225,245,.55)" strokeWidth=".9" fill="none">
          {[0, 15, 30, 45, 60, 75, 90].map((a) => <path key={a} d={`M120 0L${120 - 120 * Math.cos((a * Math.PI) / 180)} ${120 * Math.sin((a * Math.PI) / 180)}`} />)}
          {[30, 55, 82, 108].map((r) => <path key={r} d={Array.from({ length: 7 }, (_x, i) => { const a = (i * 15 * Math.PI) / 180; return `${i ? "Q" + (120 - (r - 7) * Math.cos(a - 0.13)) + " " + ((r - 7) * Math.sin(a - 0.13)) + " " : "M"}${120 - r * Math.cos(a)} ${r * Math.sin(a)}`; }).join(" ")} />)}
        </g>
        <path d="M84 0v46" stroke="rgba(230,225,245,.5)" strokeWidth=".8" /><g transform="translate(84 50)"><ellipse rx="4" ry="5" fill="#120b18" /><path d="M-4-1h-4m4 2h-5m13-2h4m-4 2h5M-3-3l-3-3m9 3l3-3" stroke="#120b18" strokeWidth="1" /></g>
      </svg>
      <svg className="ssn-corner br" viewBox="0 0 110 70" width="104" height="66">
        <Pumpkin x={34} y={44} r={22} /><Pumpkin x={76} y={52} r={15} />
      </svg>
    </>
  );
  if (season.id === "autumn") return (
    <>
      <svg className="ssn-corner tr" viewBox="0 0 120 90" width="110" height="82">
        {[[100, 10, 30, "#e8833a"], [78, 4, -20, "#c9962c"], [108, 34, 70, "#b8452a"], [86, 26, 10, "#d9a441"]].map(([x, y, a, c], i) => <path key={i} transform={`translate(${x} ${y}) rotate(${a}) scale(1.4)`} d="M0-10c3 3 7 4 8 9-3 0-5 2-6 5L0 8l-2-4c-1-3-3-5-6-5 1-5 5-6 8-9z" fill={c} opacity=".85" />)}
      </svg>
      <svg className="ssn-corner br" viewBox="0 0 110 70" width="104" height="66"><Pumpkin x={40} y={46} r={20} tone="#d9782f" /><path d="M66 60c8-14 22-18 34-14-6 4-10 10-12 18" fill="#9c5a2b" opacity=".8" /></svg>
    </>
  );
  if (season.id === "christmas") return (
    <>
      <svg className="ssn-corner tr" viewBox="0 0 120 110" width="112" height="102">
        {[[30, 46, "#e2384d"], [62, 70, "#f5c84c"], [94, 38, "#2fae66"]].map(([x, len, c]) => (
          <g key={x}><path d={`M${x} 0V${len}`} stroke="rgba(255,255,255,.35)" strokeWidth=".8" /><rect x={x - 3} y={len - 1} width="6" height="5" rx="1" fill="#c9b27a" /><circle cx={x} cy={len + 13} r="10" fill={c} /><ellipse cx={x - 3.5} cy={len + 9} rx="3" ry="2" fill="rgba(255,255,255,.45)" /></g>
        ))}
      </svg>
      <svg className="ssn-corner br" viewBox="0 0 110 70" width="100" height="64">
        <path d="M30 50c-12-4-20 2-26 10 8 2 16 0 26-10zM30 50c4-12 0-22-8-28-2 9 0 18 8 28zM30 50c12-4 22 0 28 8-9 2-18 0-28-8z" fill="#1f7a45" /><circle cx="27" cy="52" r="4.5" fill="#e2384d" /><circle cx="35" cy="50" r="4.5" fill="#e2384d" /><circle cx="31" cy="57" r="4.5" fill="#e2384d" />
      </svg>
    </>
  );
  // Winter: frost in the top corners
  return (
    <>
      {["tl", "tr"].map((k) => (
        <svg key={k} className={`ssn-corner ${k} frost`} viewBox="0 0 120 120" width="120" height="120">
          <defs><radialGradient id={`ssn-frost-${k}`} cx={k === "tl" ? "0" : "1"} cy="0" r="1"><stop offset="0" stopColor="rgba(225,242,255,.38)" /><stop offset=".7" stopColor="rgba(225,242,255,0)" /></radialGradient></defs>
          <rect width="120" height="120" fill={`url(#ssn-frost-${k})`} />
          <g stroke="rgba(235,246,255,.6)" strokeWidth=".9" fill="none" transform={k === "tr" ? "translate(120 0) scale(-1 1)" : undefined}>
            <path d="M0 0l46 46M14 14l-6 12M14 14l12-6M30 30l-8 14M30 30l14-8M0 22l20 12M22 0l12 20" />
          </g>
        </svg>
      ))}
    </>
  );
}

export function Pumpkin({ x, y, r, tone = "#ff7a1a" }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d={`M-2 ${-r * 0.82}c0-${r * 0.25} ${r * 0.1}-${r * 0.38} ${r * 0.3}-${r * 0.42}`} stroke="#4f6b2a" strokeWidth={r * 0.14} fill="none" strokeLinecap="round" />
      <ellipse rx={r * 0.62} ry={r * 0.8} fill={tone} />
      <ellipse cx={-r * 0.42} rx={r * 0.5} ry={r * 0.74} fill={tone} />
      <ellipse cx={r * 0.42} rx={r * 0.5} ry={r * 0.74} fill={tone} />
      <ellipse rx={r * 0.3} ry={r * 0.8} fill="rgba(255,255,255,.08)" />
      <path d={`M${-r * 0.4} ${-r * 0.1}l${r * 0.14}-${r * 0.2}l${r * 0.14} ${r * 0.2}zM${r * 0.12} ${-r * 0.1}l${r * 0.14}-${r * 0.2}l${r * 0.14} ${r * 0.2}zM${-r * 0.42} ${r * 0.22}q${r * 0.42} ${r * 0.3} ${r * 0.84} 0`} fill="rgba(40,16,0,.55)" stroke="rgba(40,16,0,.55)" strokeWidth={r * 0.05} />
    </g>
  );
}

// ── The AURA logo, decorated for the season ───────────────────────────────────
export function SeasonalLogo({ children, style }) {
  const r = useSeason();
  if (!r || !r.parts.logo) return children;
  const id = r.season.id;
  return (
    <span className="ssn-logo" style={{ position: "relative", display: "inline-flex", ...style }}>
      {children}
      <svg className={`ssn-logo-d ssn-logo-${id}`} viewBox="0 0 40 40" width="26" height="26" aria-hidden="true">
        {id === "halloween" && <><path d="M2 32c5-3 11-4 18-4s13 1 18 4c-7 2.4-29 2.4-36 0z" fill="#2a1a3a" stroke="#9b4dff" strokeWidth=".9" /><path d="M11 29c2-9 5-18 15-25-2 8-1 15 3 25-6 1.2-12 1.2-18 0z" fill="#2a1a3a" stroke="#9b4dff" strokeWidth=".9" /><path d="M11.6 25.6c5.6 1 11.2 1 16.8 0l.8 2.8c-6 1.1-12.4 1.1-18.4 0z" fill="#ff7a1a" /></>}
        {id === "autumn" && [[14, 20, -30, "#e8833a"], [24, 16, 20, "#c9962c"], [20, 27, 70, "#b8452a"]].map(([x, y, a, c], i) => <path key={i} transform={`translate(${x} ${y}) rotate(${a})`} d="M0-9c3 3 6 4 7 8-3 0-4 2-5 4L0 7l-2-4c-1-2-2-4-5-4 1-4 4-5 7-8z" fill={c} />)}
        {id === "christmas" && <><path d="M4 28c2-12 10-20 22-22 4 4 7 10 8 16z" fill="#e2384d" /><path d="M3 27c8-3 22-4 32-2 1 2 1 4 0 6-10-2-22-1-32 2-1-2-1-4 0-6z" fill="#f4f4f4" /><circle cx="34" cy="21" r="4" fill="#f4f4f4" /></>}
        {id === "winter" && <g stroke="#e8f4ff" strokeWidth="2" strokeLinecap="round" transform="translate(20 20)">{[0, 60, 120].map((a) => <path key={a} d="M0-14V14M-5-10l5 4 5-4M-5 10l5-4 5 4" transform={`rotate(${a})`} />)}</g>}
      </svg>
    </span>
  );
}

// ── Settings > Seasonal Decorations ───────────────────────────────────────────
const PARTS = [
  ["interface", "Interface Decorations", "Pumpkins, spiderwebs, ornaments and frost in the corners"],
  ["effects", "Animated Effects", "Falling snow and leaves, and floating bats"],
  ["logo", "Logo Decoration", "A seasonal touch on the AURA logo"],
  ["nav", "Navigation Accents", "Lights, bunting or icicles along the top of AURA"],
  ["background", "Seasonal Background", "A soft holiday glow over your own background (your background stays)"],
];
export function SeasonalSettings({ Seg, SetRange }) {
  const st = useSeasonalStore();
  const s = st.settings;
  const now = seasonFor();
  const toggle = (k, label) => (
    <div className={`tog ${s[k] ? "on" : ""}`} role="switch" aria-checked={!!s[k]} aria-label={label} tabIndex={0}
      onClick={() => setSeasonal({ [k]: !s[k] })} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSeasonal({ [k]: !s[k] }); } }} />
  );
  const showing = resolve({ ...st, preview: null });
  return (
    <div className="ss">
      <div className="ss-t">SEASONAL DECORATIONS</div>
      <div className="ss-card">
        <div className="sr">
          <div><div className="sr-l">Seasonal Decorations</div><div className="sr-s">{s.on
            ? (showing ? `On: ${showing.season.name} decorations are showing` : "On. Nothing is in season right now, so AURA looks as usual")
            : "Off: AURA looks as usual. Your theme, colours and background are never changed"}</div></div>
          {toggle("on", "Seasonal decorations")}
        </div>
        <div className="sr" style={{ opacity: s.on ? 1 : 0.5 }}>
          <div><div className="sr-l">Season</div><div className="sr-s">{s.mode === "auto" ? `Automatic changes with the date${now ? ` (now: ${now.name})` : " (Halloween in October, Autumn in November, Christmas in December, Winter in January and February)"}` : "Always this season, whatever the date"}</div></div>
          <Seg value={s.mode} options={[["auto", "Automatic"], ...SEASONS.map((x) => [x.id, x.name])]} onChange={(v) => setSeasonal({ mode: v })} />
        </div>
        {PARTS.map(([k, label, sub]) => (
          <div key={k} className="sr" style={{ opacity: s.on ? 1 : 0.5 }}><div><div className="sr-l">{label}</div><div className="sr-s">{sub}</div></div>{toggle(k, label)}</div>
        ))}
        <div className="sr" style={{ opacity: s.on && s.effects ? 1 : 0.5 }}>
          <div><div className="sr-l">Animation Amount</div><div className="sr-s">How much snow, how many leaves and bats</div></div>
          <SetRange value={s.intensity} min={1} max={3} step={1} onChange={(v) => setSeasonal({ intensity: Math.round(v) })} format={(v) => ["", "Low", "Medium", "High"][Math.round(v)] || ""} />
        </div>
        <div className="sr">
          <div><div className="sr-l">Reduce Motion</div><div className="sr-s">{st.systemReduce ? "Windows is set to reduce motion, so nothing moves" : "Keep the decorations, without anything moving"}</div></div>
          {toggle("reduceMotion", "Reduce motion")}
        </div>
        <div className="sr ssn-pv-row">
          <div><div className="sr-l">Preview</div><div className="sr-s">See a season for 15 seconds, even with decorations off</div></div>
          <div className="ssn-pv-btns">{SEASONS.map((x) => <button key={x.id} type="button" className="btn-gh" style={{ fontSize: 11, padding: "5px 10px" }} onClick={() => previewSeason(x.id)}>{x.name}</button>)}</div>
        </div>
      </div>
    </div>
  );
}

// ── Looks ─────────────────────────────────────────────────────────────────────
const CSS = `
.ssn{position:fixed;inset:0;pointer-events:none;z-index:95;overflow:hidden}
.ssn *{pointer-events:none}
.ssn-bg{position:absolute;inset:0;background:radial-gradient(60% 45% at 0% 100%,color-mix(in srgb,var(--ssn-a) 16%,transparent),transparent 70%),radial-gradient(55% 40% at 100% 0%,color-mix(in srgb,var(--ssn-b) 14%,transparent),transparent 70%);mix-blend-mode:screen}
.ssn-winter .ssn-bg{background:radial-gradient(70% 50% at 50% 0%,rgba(190,225,255,.12),transparent 70%),radial-gradient(60% 40% at 100% 100%,rgba(140,190,255,.08),transparent 70%)}
.ssn-fog{position:absolute;left:-20%;right:-20%;bottom:-6%;height:34%;background:radial-gradient(40% 60% at 25% 80%,rgba(190,170,230,.12),transparent 70%),radial-gradient(45% 55% at 70% 85%,rgba(190,170,230,.10),transparent 70%);animation:ssn-fog 36s ease-in-out infinite alternate}
@keyframes ssn-fog{to{transform:translateX(8%)}}
.ssn-top{position:absolute;top:0;left:0;right:0;opacity:.95}
.ssn-twinkle{animation:ssn-twinkle 2.2s ease-in-out infinite alternate}
@keyframes ssn-twinkle{from{opacity:1}to{opacity:.35}}
.ssn-corner{position:absolute;opacity:.9}
.ssn-corner.tr{top:0;right:0}.ssn-corner.tl{top:0;left:0}.ssn-corner.br{right:6px;bottom:4px;opacity:.85}
.ssn-halloween .ssn-corner.tr{opacity:.75}
.ssn-fx{position:absolute;inset:0}
.ssn-fall{position:absolute;top:-30px;display:block;will-change:transform;animation-name:ssn-fall;animation-timing-function:linear;animation-iteration-count:infinite}
.ssn-fall.snow{border-radius:50%;background:rgba(255,255,255,.85);box-shadow:0 0 6px rgba(255,255,255,.5)}
.ssn-fall.flake{opacity:.7}
.ssn-fall.leaf svg{animation:ssn-spin 5s linear infinite}
@keyframes ssn-fall{0%{transform:translate3d(0,0,0)}50%{transform:translate3d(var(--sway),52vh,0)}100%{transform:translate3d(0,106vh,0)}}
@keyframes ssn-spin{to{transform:rotate(360deg)}}
.ssn-bat{position:absolute;left:-60px;will-change:transform;animation:ssn-bat linear infinite;transform:scale(var(--s,1))}
.ssn-bat .ssn-wing{transform-origin:20px 9px;animation:ssn-flap .35s ease-in-out infinite alternate}
@keyframes ssn-bat{0%{transform:translate3d(0,0,0) scale(var(--s,1))}50%{transform:translate3d(55vw,-30px,0) scale(var(--s,1))}100%{transform:translate3d(115vw,10px,0) scale(var(--s,1))}}
@keyframes ssn-flap{to{transform:scaleY(.45)}}
.ssn.still .ssn-twinkle,.ssn.still .ssn-fog{animation:none}
.ssn-preview{position:fixed;z-index:9000;top:34px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:12px;padding:8px 10px 8px 16px;border-radius:999px;background:rgba(14,16,24,.92);border:1px solid var(--ssn-a);color:#fff;font-size:12.5px;box-shadow:0 8px 24px rgba(0,0,0,.4)}
.ssn-preview,.ssn-preview *{pointer-events:auto}
.ssn-preview button{border:0;border-radius:999px;padding:5px 12px;background:var(--ssn-a);color:#111;font:inherit;font-weight:600;cursor:pointer}
.ssn-logo-d{position:absolute;left:calc(4% - 10px);top:calc(36% - 18px);pointer-events:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))}
.ssn-logo-winter{left:auto;right:calc(4% - 9px);top:calc(36% - 16px)}
.ssn-pv-btns{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end}
@media (max-width:640px){.ssn-corner{transform:scale(.7);transform-origin:top right}.ssn-corner.br{transform-origin:bottom right}}
`;
// The page you're on gets the season's colour too (only while Navigation Accents are showing)
export function NavAccentStyle() {
  const r = useSeason();
  if (!r || !r.parts.nav) return null;
  return <style>{`.sb-item.on,.gm-rail-item.on{box-shadow:inset 3px 0 0 ${r.season.a}}`}</style>;
}

