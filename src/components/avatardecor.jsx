// AURA — seasonal avatar decorations: frames and accessories drawn around your profile picture.
// Your picture itself is never changed: decorations are see-through layers around and over it.
// You choose them in Edit Profile > Avatar Decorations; they're saved to your account, and friends
// see the ones you chose wherever your picture shows (friends, messages, calls). Off by default.
// Added by aura-seasonal-setup.cjs.
import { forwardRef, useEffect, useImperativeHandle, useState, useSyncExternalStore } from "react";
import { SEASONS, seasonById, seasonFor, useSeasonalStore, Pumpkin } from "./seasonal";

// ── What there is to choose ───────────────────────────────────────────────────
export const FRAMES = {
  halloween: [["glow", "Pumpkin glow"], ["web", "Spiderweb"], ["ghost", "Ghostly glow"]],
  autumn: [["wreath", "Leaf wreath"], ["gold", "Orange and gold"], ["harvest", "Harvest"]],
  christmas: [["wreath", "Wreath"], ["glow", "Red and green glow"], ["candy", "Candy cane"], ["lights", "Christmas lights"]],
  winter: [["ice", "Icy blue"], ["flakes", "Snowflake wreath"], ["frost", "Frosted"]],
};
export const ACCESSORIES = {
  halloween: [["hat", "Witch hat"], ["wings", "Bat wings"], ["pumpkins", "Pumpkins"]],
  autumn: [["pumpkins", "Pumpkins"], ["leaves", "Falling leaves"]],
  christmas: [["santa", "Santa hat"], ["antlers", "Reindeer antlers"], ["flakes", "Snowflakes"]],
  winter: [["beanie", "Winter hat"], ["snow", "Snowfall"]],
};
const MOVABLE = new Set(["hat", "santa", "beanie", "antlers", "pumpkins"]); // can be moved and sized
const DEFAULT_PICKS = {
  halloween: { frame: "glow", acc: "hat" }, autumn: { frame: "wreath", acc: "pumpkins" },
  christmas: { frame: "wreath", acc: "santa" }, winter: { frame: "ice", acc: "beanie" },
};
export const BLANK = { v: 1, on: false, mode: "auto", season: "christmas", frames: true, accessories: true, animate: true, picks: {} };

const SLUG = /^[a-z][a-z0-9-]{0,19}$/;
const num = (v, lo, hi, d) => (typeof v === "number" && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
// Only the shape AURA expects, from anyone's profile (the same rules as electron/decor.js)
export function cleanDecor(d) {
  if (!d || typeof d !== "object") return null;
  const o = { v: 1, on: d.on === true, mode: d.mode === "manual" ? "manual" : "auto", season: SLUG.test(d.season || "") ? d.season : "christmas", frames: d.frames !== false, accessories: d.accessories !== false, animate: d.animate !== false, picks: {} };
  if (d.picks && typeof d.picks === "object") for (const [k, p] of Object.entries(d.picks).slice(0, 12)) {
    if (!SLUG.test(k) || !p || typeof p !== "object") continue;
    o.picks[k] = { frame: SLUG.test(p.frame || "") ? p.frame : "", acc: SLUG.test(p.acc || "") ? p.acc : "", x: num(p.x, -0.3, 0.3, 0), y: num(p.y, -0.3, 0.3, 0), size: num(p.size, 0.7, 1.3, 1) };
  }
  return o;
}
const pickFor = (decor, id) => ({ x: 0, y: 0, size: 1, ...DEFAULT_PICKS[id], ...(decor.picks?.[id] || {}) });
// What to draw for a decoration today: null when it's off or nothing is in season
export function decorNow(decor, date = new Date()) {
  if (!decor || !decor.on) return null;
  const season = decor.mode === "manual" ? seasonById(decor.season) : seasonFor(date);
  if (!season) return null;
  const p = pickFor(decor, season.id);
  const frame = decor.frames && (FRAMES[season.id] || []).some(([f]) => f === p.frame) ? p.frame : "";
  const acc = decor.accessories && (ACCESSORIES[season.id] || []).some(([a]) => a === p.acc) ? p.acc : "";
  if (!frame && !acc) return null;
  return { season: season.id, frame, acc, x: p.x, y: p.y, size: p.size, animate: decor.animate };
}

// ── Everyone's decorations, fetched in small batches and kept for 10 minutes ──
const cache = new Map(); // user id -> { decor, at }
const pending = new Set();
let wanted = new Set(), timer = 0, myId = null, unavailable = false, asked = false;
const subs = new Set();
let version = 0;
const emit = () => { version++; subs.forEach((f) => f()); };
const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
const cloud = () => (typeof window !== "undefined" ? window.auraCloud : null);
export const decorAvailable = () => typeof cloud()?.getAvatarDecorations === "function";
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function want(id) {
  if (!id || !ID.test(id) || unavailable || !decorAvailable() || pending.has(id)) return;
  const c = cache.get(id);
  if (c && Date.now() - c.at < 600000) return;
  wanted.add(id);
  clearTimeout(timer);
  timer = setTimeout(flush, 60);
}
async function flush() {
  const ids = [...wanted].slice(0, 200);
  wanted = new Set([...wanted].slice(200));
  if (!ids.length) return;
  ids.forEach((i) => pending.add(i));
  try {
    const r = await cloud().getAvatarDecorations(ids);
    if (r?.success) {
      if (r.data?.unavailable) unavailable = true; // the database update hasn't been run: nobody has any
      for (const id of ids) cache.set(id, { decor: cleanDecor(r.data?.decor?.[id]), at: Date.now() });
    } else for (const id of ids) cache.set(id, { decor: cache.get(id)?.decor || null, at: Date.now() - 540000 }); // try again in a minute
  } catch {} finally { ids.forEach((i) => pending.delete(i)); emit(); if (wanted.size) timer = setTimeout(flush, 60); }
}
async function findMe() {
  if (asked || !decorAvailable()) return;
  asked = true;
  try { const r = await cloud().getSession?.(); if (r?.success && r.data?.id) { myId = r.data.id; want(myId); emit(); } } catch {}
}
export function useDecor(userId, self = false) {
  useSyncExternalStore(subscribe, () => version);
  useEffect(() => { if (self) findMe(); else want(userId); }, [userId, self]);
  const id = self ? myId : userId;
  return id ? cache.get(id)?.decor || null : null;
}
export async function saveMyDecor(decor) {
  const clean = cleanDecor(decor);
  const r = await cloud()?.saveAvatarDecoration?.(clean);
  if (!r?.success) throw new Error(r?.error || "Your decorations weren't saved.");
  if (!myId) { asked = false; await findMe(); }
  if (myId) cache.set(myId, { decor: clean, at: Date.now() });
  unavailable = false;
  emit();
  return clean;
}

// ── A picture with its decorations ────────────────────────────────────────────
// Wrap any avatar: <DecoratedAvatar userId={…} size={40}><img …/></DecoratedAvatar>. Without
// decorations it gives back exactly what it was given.
export function DecoratedAvatar({ userId, self = false, decor: given, size = 40, children }) {
  const fetched = useDecor(given === undefined ? userId : null, given === undefined && self);
  const st = useSeasonalStore(); // the viewer's reduced-motion choice
  const d = decorNow(given === undefined ? fetched : given);
  if (!d || size < 20) return children;
  const still = !d.animate || st.settings.reduceMotion || st.systemReduce;
  const small = size < 28; // tiny pictures get the frame only
  const back = !small && BACK.has(d.acc);
  return (
    <span className={`dav dav-${d.season}${still ? " still" : ""}`} style={{ width: size, height: size }} data-decor={`${d.season}:${d.frame}:${d.acc}`}>
      <style>{CSS}</style>
      {back && <Layer><Accessory d={d} /></Layer>}
      <span className="dav-pic">{children}</span>
      <Layer front>{d.frame && <Frame season={d.season} frame={d.frame} />}{!small && !back && d.acc && <Accessory d={d} />}</Layer>
    </span>
  );
}
const Layer = ({ front, children }) => (
  <svg className={`dav-l${front ? " front" : ""}`} viewBox="-30 -30 160 160" aria-hidden="true">{children}</svg>
);
const BACK = new Set(["wings", "antlers"]);
const around = (n, r, fn) => Array.from({ length: n }, (_x, i) => { const a = (i / n) * Math.PI * 2 - Math.PI / 2; return fn(50 + r * Math.cos(a), 50 + r * Math.sin(a), (a * 180) / Math.PI + 90, i); });
const leaf = "M0-6c2.4 2 4.4 3.4 4.8 6.4-2 0-3 1.2-3.6 3L0 6l-1.2-2.6C-1.8 1.6-2.8.4-4.8.4-4.4-2.6-2.4-4 0-6z";
const flake = (s) => <g stroke="currentColor" strokeWidth={1.2 / s} strokeLinecap="round" transform={`scale(${s})`}>{[0, 60, 120].map((a) => <path key={a} d="M0-4V4M-1.6-3l1.6 1 1.6-1M-1.6 3l1.6-1 1.6 1" transform={`rotate(${a})`} />)}</g>;

function Frame({ season, frame }) {
  const k = `${season}:${frame}`;
  switch (k) {
    case "halloween:glow": return <g className="dav-pulse"><circle cx="50" cy="50" r="53" fill="none" stroke="#ff7a1a" strokeWidth="9" opacity=".25" /><circle cx="50" cy="50" r="53" fill="none" stroke="#ff8c2a" strokeWidth="3.6" /></g>;
    case "halloween:web": return (
      <g stroke="rgba(236,232,250,.85)" strokeWidth=".9" fill="none">
        {around(16, 0, (x, y, a) => <path key={a} d={`M${50 + 50 * Math.cos(((a - 90) * Math.PI) / 180)} ${50 + 50 * Math.sin(((a - 90) * Math.PI) / 180)}L${50 + 66 * Math.cos(((a - 90) * Math.PI) / 180)} ${50 + 66 * Math.sin(((a - 90) * Math.PI) / 180)}`} />)}
        {[55, 60, 65].map((r) => <path key={r} d={around(16, r, (x, y) => [x, y]).map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ") + "Z"} />)}
        <path d="M95 82v10" /><g transform="translate(95 95)"><ellipse rx="3.2" ry="4" fill="#120b18" stroke="none" /><path d="M-3-1h-4m3 2h-4m11-2h4m-3 2h4" stroke="#120b18" /></g>
      </g>
    );
    case "halloween:ghost": return <g className="dav-breathe"><circle cx="50" cy="50" r="54" fill="none" stroke="#9b4dff" strokeWidth="12" opacity=".22" /><circle cx="50" cy="50" r="53" fill="none" stroke="#b47dff" strokeWidth="2.4" opacity=".9" /></g>;
    case "autumn:wreath": return <g>{around(22, 57, (x, y, a, i) => <path key={i} d={leaf} transform={`translate(${x} ${y}) rotate(${a + (i % 2 ? 30 : -30)}) scale(1.35)`} fill={["#e8833a", "#c9962c", "#b8452a", "#d9a441"][i % 4]} />)}</g>;
    case "autumn:gold": return <g><defs><linearGradient id="dav-ag" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ff9a3c" /><stop offset="1" stopColor="#f2c14e" /></linearGradient></defs><circle cx="50" cy="50" r="53" fill="none" stroke="url(#dav-ag)" strokeWidth="4.5" /><circle cx="50" cy="50" r="58.5" fill="none" stroke="#f2c14e" strokeWidth="1.4" opacity=".8" /></g>;
    case "autumn:harvest": return (
      <g><circle cx="50" cy="50" r="53" fill="none" stroke="#c9962c" strokeWidth="3" />
        {[-1, 1].map((s) => <g key={s} transform={`translate(50 50) scale(${s} 1)`} stroke="#d9a441" fill="#d9a441">{[0, 1, 2].map((j) => <g key={j} transform={`rotate(${118 + j * 9})`}><path d="M0 52v22" strokeWidth="1.2" fill="none" />{[56, 61, 66, 71].map((y) => <ellipse key={y} cx="0" cy={y} rx="1.6" ry="3" stroke="none" />)}</g>)}</g>)}
      </g>
    );
    case "christmas:wreath": return (
      <g>{around(28, 56, (x, y, a, i) => <path key={i} d={leaf} transform={`translate(${x} ${y}) rotate(${a + (i % 2 ? 40 : -40)}) scale(1.3 1.1)`} fill={i % 2 ? "#1f7a45" : "#2fae66"} />)}
        {around(7, 57, (x, y, a, i) => <circle key={i} cx={x} cy={y} r="2.6" fill="#e2384d" />)}
        <g transform="translate(50 104)"><path d="M0 0c-8-8-16-6-15 0s9 4 15 0c8-8 16-6 15 0S6 4 0 0z" fill="#e2384d" /><path d="M-2 1l-6 12M2 1l6 12" stroke="#e2384d" strokeWidth="3" /><circle r="3" fill="#b8203a" /></g>
      </g>
    );
    case "christmas:glow": return <g className="dav-spin"><circle cx="50" cy="50" r="54" fill="none" stroke="#e2384d" strokeWidth="4" strokeDasharray="14 14" /><circle cx="50" cy="50" r="54" fill="none" stroke="#2fae66" strokeWidth="4" strokeDasharray="14 14" strokeDashoffset="14" /><circle cx="50" cy="50" r="54" fill="none" stroke="#f5c84c" strokeWidth="10" opacity=".12" /></g>;
    case "christmas:candy": return <g><circle cx="50" cy="50" r="54" fill="none" stroke="#f6f6f6" strokeWidth="6" /><circle cx="50" cy="50" r="54" fill="none" stroke="#e2384d" strokeWidth="6" strokeDasharray="6 6" /></g>;
    case "christmas:lights": return (
      <g><circle cx="50" cy="50" r="56" fill="none" stroke="#1d3b26" strokeWidth="1.4" />
        {around(16, 56, (x, y, a, i) => <g key={i} transform={`translate(${x} ${y}) rotate(${a})`} className={`dav-tw t${i % 3}`}><rect x="-1.4" y="-2" width="2.8" height="2.4" fill="#2a3a2e" /><ellipse cy="-5" rx="2.8" ry="4.2" fill={["#ff4d5e", "#3ddc84", "#ffd257", "#5cc8ff"][i % 4]} /></g>)}
      </g>
    );
    case "winter:ice": return <g><defs><linearGradient id="dav-ice" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e9f6ff" /><stop offset=".5" stopColor="#8fd3ff" /><stop offset="1" stopColor="#5b8fd6" /></linearGradient></defs><circle cx="50" cy="50" r="53.5" fill="none" stroke="url(#dav-ice)" strokeWidth="5" />{[[12, 14], [92, 30], [86, 92]].map(([x, y], i) => <path key={i} className="dav-tw t1" d={`M${x} ${y - 5}l1.2 3.8L${x + 5} ${y}l-3.8 1.2L${x} ${y + 5}l-1.2-3.8L${x - 5} ${y}l3.8-1.2z`} fill="#fff" />)}</g>;
    case "winter:flakes": return <g color="#e3f2ff">{around(12, 58, (x, y, a, i) => <g key={i} transform={`translate(${x} ${y}) rotate(${a})`}>{flake(i % 2 ? 1.4 : 1.1)}</g>)}</g>;
    case "winter:frost": return <g><circle cx="50" cy="50" r="54" fill="none" stroke="rgba(235,246,255,.5)" strokeWidth="9" /><circle cx="50" cy="50" r="52.5" fill="none" stroke="rgba(255,255,255,.9)" strokeWidth="1.4" />{around(10, 58, (x, y, a, i) => <path key={i} d="M0 0v-7M0-4l-3-3M0-4l3-3" stroke="rgba(240,248,255,.85)" strokeWidth="1.1" fill="none" transform={`translate(${x} ${y}) rotate(${a})`} />)}</g>;
    default: return null;
  }
}

function Accessory({ d }) {
  const t = (ax, ay) => MOVABLE.has(d.acc) ? `translate(${ax + d.x * 100} ${ay + d.y * 100}) scale(${d.size})` : `translate(${ax} ${ay})`;
  const k = `${d.season}:${d.acc}`;
  switch (k) {
    case "halloween:hat": return <g transform={t(50, 4)}><path d="M-34 0c10-6 22-8 34-8s24 2 34 8c-12 5-56 5-68 0z" fill="#1d1426" /><path d="M-18-6c4-14 8-30 26-42-4 14-2 26 6 42-10 2-22 2-32 0z" fill="#1d1426" /><path d="M-17-10c10 2 20 2 30 0l1 5c-10 2-22 2-32 0z" fill="#ff7a1a" /><rect x="-4" y="-11" width="7" height="7" rx="1" fill="none" stroke="#f5c84c" strokeWidth="1.4" /></g>;
    case "halloween:wings": return <g fill="#1d1426" className="dav-flap">{[-1, 1].map((s) => <path key={s} transform={`translate(50 46) scale(${s} 1)`} d="M30 0C40-18 56-26 76-22c-6 6-6 14-2 20-8-4-16-2-20 6-4-6-12-8-18-4 0-4-2-8-6-6z" />)}</g>;
    case "halloween:pumpkins": case "autumn:pumpkins": return <g transform={t(86, 92)}><Pumpkin x={0} y={0} r={13} tone={d.season === "autumn" ? "#d9782f" : "#ff7a1a"} /><Pumpkin x={-20} y={6} r={8} tone={d.season === "autumn" ? "#c9962c" : "#ff8c2a"} /></g>;
    case "autumn:leaves": return <g className="dav-drift">{around(6, 70, (x, y, a, i) => <path key={i} d={leaf} transform={`translate(${x} ${y}) rotate(${a * 1.7}) scale(1.5)`} fill={["#e8833a", "#c9962c", "#b8452a"][i % 3]} opacity=".9" />)}</g>;
    case "christmas:santa": return <g transform={t(64, 6) + " rotate(18)"}><path d="M-30 4C-26-20-6-34 18-30c10 4 16 14 18 26z" fill="#e2384d" /><path d="M18-30c12-2 22 6 24 18" stroke="#e2384d" strokeWidth="9" fill="none" strokeLinecap="round" /><circle cx="43" cy="-9" r="7" fill="#f7f7f7" /><rect x="-34" y="0" width="72" height="12" rx="6" fill="#f7f7f7" /></g>;
    case "christmas:antlers": return <g transform={t(50, 4)} stroke="#8a5a32" strokeWidth="5" fill="none" strokeLinecap="round">{[-1, 1].map((s) => <g key={s} transform={`scale(${s} 1)`}><path d="M14 0C18-14 22-26 34-36M24-18c6-2 12-2 16 2M28-28c-2-6 0-12 4-16" /></g>)}</g>;
    case "christmas:flakes": return <g color="#ffffff">{around(5, 68, (x, y, a, i) => <g key={i} className={`dav-tw t${i % 3}`} transform={`translate(${x} ${y})`}>{flake(1.6)}</g>)}</g>;
    case "winter:beanie": return <g transform={t(50, 10)}><path d="M-36 0c0-22 16-38 36-38S36-22 36 0z" fill="#5b8fd6" /><path d="M-24-24h48M-31-12h62" stroke="#d9ecff" strokeWidth="3" /><rect x="-40" y="-4" width="80" height="13" rx="6.5" fill="#d9ecff" /><circle cy="-42" r="8" fill="#ffffff" /></g>;
    case "winter:snow": return <g className="dav-snow" fill="#ffffff">{around(9, 0, (x, y, a, i) => <circle key={i} cx={-6 + ((i * 37) % 112)} cy={-20 + ((i * 53) % 40)} r={1.4 + (i % 3) * 0.7} opacity=".9" />)}</g>;
    default: return null;
  }
}

// ── Edit Profile > Avatar Decorations ─────────────────────────────────────────
export const AvatarDecorations = forwardRef(function AvatarDecorations({ picture, Seg, SetRange }, ref) {
  const mine = useDecor(null, true);
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(() => (seasonFor() || SEASONS[2]).id);
  const [problem, setProblem] = useState("");
  const d = draft || mine || BLANK;
  useEffect(() => { if (!draft && mine) setEditing((e) => (mine.mode === "manual" ? mine.season : e)); }, [mine]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch) => { setProblem(""); setDraft({ ...d, ...patch }); };
  const pick = pickFor(d, editing);
  const setPick = (patch) => set({ picks: { ...d.picks, [editing]: { frame: pick.frame, acc: pick.acc, x: pick.x, y: pick.y, size: pick.size, ...patch } } });
  useImperativeHandle(ref, () => ({
    async save() {
      if (!draft) return null;
      try { await saveMyDecor(draft); setDraft(null); return null; }
      catch (e) { setProblem(e.message); return e.message; }
    },
  }), [draft]);
  if (!decorAvailable()) return null;
  // The picture as others will see it, for the season being chosen
  const preview = { ...d, on: true, mode: "manual", season: editing };
  const toggle = (k, label) => (
    <div className={`tog ${d[k] ? "on" : ""}`} role="switch" aria-checked={!!d[k]} aria-label={label} tabIndex={0}
      onClick={() => set({ [k]: !d[k] })} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); set({ [k]: !d[k] }); } }} />
  );
  const pic = (size) => (
    <span className="dav-me" style={{ width: size, height: size }}>{picture ? <img src={picture} alt="" /> : <span>🎮</span>}</span>
  );
  const tile = (kind, id, label) => {
    const on = (kind === "frame" ? pick.frame : pick.acc) === id;
    const look = { ...preview, frames: kind === "frame", accessories: kind === "acc", picks: { [editing]: { ...pick, frame: kind === "frame" ? id : "", acc: kind === "acc" ? id : "" } } };
    return (
      <button key={kind + id} type="button" className={`dav-tile${on ? " on" : ""}`} aria-pressed={on} title={label} onClick={() => setPick(kind === "frame" ? { frame: id } : { acc: id })}>
        {id ? <DecoratedAvatar decor={look} size={40}>{pic(40)}</DecoratedAvatar> : <span className="dav-none">None</span>}
        <span className="dav-tile-l">{label}</span>
      </button>
    );
  };
  return (
    <div className="dav-edit">
      <div className="dav-edit-h">
        <div><div className="fl" style={{ margin: 0 }}>Avatar Decorations</div><div className="dav-sub">Seasonal frames and accessories around your picture, seen by your friends. Your picture itself is never changed.</div></div>
        {toggle("on", "Avatar decorations")}
      </div>
      <div className={`dav-body${d.on ? "" : " off"}`}>
        <div className="dav-preview">
          <DecoratedAvatar decor={preview} size={88}>{pic(88)}</DecoratedAvatar>
          <span className="dav-sub">{d.on ? "Preview" : "Preview (switched off)"}</span>
        </div>
        <div className="dav-row stack"><span className="dav-k">Show</span><Seg value={d.mode === "manual" ? d.season : "auto"} options={[["auto", "By the date"], ...SEASONS.map((s) => [s.id, s.name])]} onChange={(v) => { if (v === "auto") set({ mode: "auto" }); else { set({ mode: "manual", season: v }); setEditing(v); } }} /></div>
        <div className="dav-sub" style={{ marginTop: -4 }}>{d.mode === "manual" ? `Always your ${seasonById(d.season)?.name} decorations.` : "Each season's decorations during its dates: Halloween in October, Autumn in November, Christmas in December, Winter in January and February. None from March to September."}</div>
        <div className="dav-row stack"><span className="dav-k">Choose for</span><div className="dav-tabs">{SEASONS.map((s) => <button key={s.id} type="button" className={editing === s.id ? "on" : ""} onClick={() => setEditing(s.id)}>{s.name}</button>)}</div></div>
        <div className="dav-row top"><span className="dav-k">Frame</span><div className="dav-tiles">{tile("frame", "", "None")}{FRAMES[editing].map(([id, label]) => tile("frame", id, label))}</div></div>
        <div className="dav-row top"><span className="dav-k">Accessory</span><div className="dav-tiles">{tile("acc", "", "None")}{ACCESSORIES[editing].map(([id, label]) => tile("acc", id, label))}</div></div>
        {MOVABLE.has(pick.acc) && <>
          <div className="dav-row"><span className="dav-k">Position</span><SetRange value={pick.x} min={-0.3} max={0.3} step={0.02} onChange={(v) => setPick({ x: v })} format={(v) => (Math.abs(v) < 0.01 ? "Middle" : v < 0 ? "Left" : "Right")} /></div>
          <div className="dav-row"><span className="dav-k">Height</span><SetRange value={pick.y} min={-0.3} max={0.3} step={0.02} onChange={(v) => setPick({ y: v })} format={(v) => (Math.abs(v) < 0.01 ? "Middle" : v < 0 ? "Higher" : "Lower")} /></div>
          <div className="dav-row"><span className="dav-k">Size</span><SetRange value={pick.size} min={0.7} max={1.3} step={0.05} onChange={(v) => setPick({ size: v })} format={(v) => Math.round(v * 100) + "%"} /></div>
        </>}
        <div className="dav-flags">
          <div><span>Frames</span>{toggle("frames", "Avatar frames")}</div>
          <div><span>Accessories</span>{toggle("accessories", "Avatar accessories")}</div>
          <div><span>Animated</span>{toggle("animate", "Animated avatar decorations")}</div>
        </div>
      </div>
      {problem && <div className="dav-problem" role="alert">{problem}</div>}
    </div>
  );
});

const CSS = `
.dav{position:relative;display:inline-flex;flex-shrink:0;vertical-align:middle}
.dav-pic{position:relative;z-index:1;display:inline-flex;width:100%;height:100%}
.dav-pic>*{flex-shrink:0}
.dav-l{position:absolute;left:-30%;top:-30%;width:160%;height:160%;overflow:visible;pointer-events:none;z-index:0}
.dav-l.front{z-index:2}
.dav-pulse{animation:dav-pulse 2.6s ease-in-out infinite alternate}
.dav-breathe{animation:dav-pulse 3.4s ease-in-out infinite alternate}
@keyframes dav-pulse{from{opacity:.65}to{opacity:1}}
.dav-spin{transform-origin:50px 50px;animation:dav-spin 14s linear infinite}
@keyframes dav-spin{to{transform:rotate(360deg)}}
.dav-tw{animation:dav-tw 1.8s ease-in-out infinite alternate}.dav-tw.t1{animation-delay:.6s}.dav-tw.t2{animation-delay:1.2s}
@keyframes dav-tw{from{opacity:1}to{opacity:.35}}
.dav-flap path{transform-origin:30px 0;animation:dav-flap 1.6s ease-in-out infinite alternate}
@keyframes dav-flap{to{transform:rotate(-8deg)}}
.dav-drift{animation:dav-drift 6s ease-in-out infinite alternate}
@keyframes dav-drift{to{transform:translateY(6px) rotate(3deg)}}
.dav-snow{animation:dav-snow 5s linear infinite}
@keyframes dav-snow{from{transform:translateY(0);opacity:1}to{transform:translateY(120px);opacity:0}}
.dav.still *{animation:none!important}
.dav-me{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;overflow:hidden;background:var(--card,#222);font-size:22px}
.dav-me img{width:100%;height:100%;object-fit:cover}
.dav-edit{margin-top:16px;padding-top:14px;border-top:1px solid var(--border,rgba(255,255,255,.1));text-align:left}
.dav-edit-h{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dav-sub{font-size:11px;color:rgba(255,255,255,.72);line-height:1.45;margin-top:3px}
.dav-body{display:grid;gap:10px;margin-top:12px}
.dav-body.off{opacity:.5}
.dav-preview{display:flex;flex-direction:column;align-items:center;gap:10px;padding:26px 0 6px}
.dav-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dav-row.top{align-items:flex-start}
.dav-row.stack{flex-direction:column;align-items:flex-start;gap:6px}
.dav-flags{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:2px}
.dav-flags>div{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--border,rgba(255,255,255,.12));border-radius:10px;font-size:12px}
.dav-k{font-size:12px;color:var(--t1,#fff);min-width:70px}
.dav-row .dav-k+.tog{margin-right:10px}
.dav-tabs{display:flex;gap:4px;flex-wrap:wrap}
.dav-tabs button{border:1px solid var(--border,rgba(255,255,255,.15));background:transparent;color:var(--t1,#fff);border-radius:999px;padding:4px 10px;font:inherit;font-size:11.5px;cursor:pointer}
.dav-tabs button.on{background:var(--acd,rgba(255,90,31,.15));border-color:var(--ac,#ff5a1f);color:var(--ac,#ff5a1f)}
.dav-tiles{display:flex;flex-wrap:wrap;gap:8px;flex:1}
.dav-tile{display:flex;flex-direction:column;align-items:center;gap:8px;width:76px;padding:18px 4px 7px;border-radius:10px;border:1px solid var(--border,rgba(255,255,255,.12));background:transparent;color:var(--t1,#fff);cursor:pointer;font:inherit}
.dav-tile.on{border-color:var(--ac,#ff5a1f);background:var(--acd,rgba(255,90,31,.12))}
.dav-tile:focus-visible,.dav-tabs button:focus-visible{outline:2px solid var(--ac,#ff5a1f);outline-offset:2px}
.dav-tile-l{font-size:10.5px;line-height:1.2;text-align:center}
.dav-none{width:40px;height:40px;display:flex;align-items:center;justify-content:center;border-radius:50%;border:1px dashed var(--border,rgba(255,255,255,.25));font-size:10px;color:rgba(255,255,255,.7)}
.dav-problem{margin-top:10px;font-size:12px;color:#ff8a80}
`;
