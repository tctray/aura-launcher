// AURA — voice commands in the window: Settings > Voice Commands, the "Listening" sign, and doing
// what you said (AURA's own player, pages, starting a game). Recording and the AURA Bar are done
// by the main process. The listening happens in electron/voice.js. Windows only.
// Added by aura-voice-setup.cjs.
import { useEffect, useRef, useState } from "react";
import { mediaNow, next, prev, toggle, setVolume, toggleMute, setTab } from "./media";

const api = () => (typeof window !== "undefined" ? window.electronAPI : null);
export const voiceAvailable = () =>
  typeof api()?.voiceGet === "function" && /Windows/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "");

const SAY = [
  ["Music and videos", "next song · previous song · pause · play · volume up · volume down · mute · unmute"],
  ["Recording", "start recording · stop recording"],
  ["Getting around", "open home · open library · open clips · open media · open messages · open settings · show the bar"],
  ["Games", "launch, then a game's name from your library, like “launch Fortnite”"],
];
const PAGES = { home: "home", library: "library", clips: "clips", media: "clips", messages: "messages", settings: "settings" };
const WINDOWS_KEY = { next: "next", prev: "prev", pause: "playpause", play: "playpause", up: "up", down: "down", mute: "mute", unmute: "mute" };

function run(c, { games, play, go, toast }) {
  if (!c || typeof c !== "object") return;
  if (c.action === "media") {
    const m = mediaNow();
    if (!m.item) { const key = WINDOWS_KEY[c.detail]; if (key) api().voiceKey?.(key); return; } // nothing in AURA's player: Windows' media keys (Spotify, a browser…)
    if (c.detail === "next") next();
    else if (c.detail === "prev") prev();
    else if (c.detail === "pause") toggle(false);
    else if (c.detail === "play") toggle(true);
    else if (c.detail === "up") setVolume(m.volume + 0.1);
    else if (c.detail === "down") setVolume(m.volume - 0.1);
    else if (c.detail === "mute") { if (!m.muted) toggleMute(); }
    else if (c.detail === "unmute") { if (m.muted) toggleMute(); }
    return;
  }
  if (c.action === "open" && PAGES[c.detail]) {
    if (c.detail === "media" || c.detail === "clips") setTab(c.detail);
    go(PAGES[c.detail]);
    return;
  }
  if (c.action === "launch" && typeof c.detail === "string") {
    const g = games.find((x) => x.title === c.detail && x.exePath);
    if (g) play(g); else toast(`“${c.detail}” isn't in your library`, "err");
  }
}

// Does what you said, and keeps the list of game names up to date
export function useVoiceCommands({ games, play, go, toast }) {
  const live = useRef({ games, play, go, toast });
  live.current = { games, play, go, toast };
  const titles = JSON.stringify((games || []).filter((g) => g.exePath && g.title).map((g) => g.title));
  useEffect(() => { if (voiceAvailable()) api().voiceGames?.(JSON.parse(titles))?.catch?.(() => {}); }, [titles]);
  useEffect(() => {
    if (!voiceAvailable() || typeof api().onVoiceCommand !== "function") return;
    return api().onVoiceCommand((c) => { try { run(c, live.current); } catch {} });
  }, []);
}

// "Listening…" after "Hey AURA", then what was heard, for a moment
export function VoiceSign() {
  const [sign, setSign] = useState(null);
  useEffect(() => {
    if (!voiceAvailable()) return;
    let timer = 0;
    const show = (s, ms) => { clearTimeout(timer); setSign(s); timer = setTimeout(() => setSign(null), ms); };
    const offs = [
      api().onVoiceStatus?.((s) => { if (s?.state === "awake") show({ text: "Listening… say a command" }, 6000); }),
      api().onVoiceCommand?.((c) => { if (c?.said) show({ text: c.said, done: true }, 1800); }),
    ];
    return () => { clearTimeout(timer); offs.forEach((off) => { try { off?.(); } catch {} }); };
  }, []);
  if (!sign) return null;
  return (
    <div className={`vc-sign${sign.done ? " done" : ""}`} role="status" aria-live="polite">
      <style>{CSS}</style>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">{sign.done ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>}</svg>
      <span>{sign.done ? `“${sign.text}”` : sign.text}</span>
    </div>
  );
}

// Settings > Voice Commands
export function VoiceSettings() {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    if (!voiceAvailable()) return;
    let live = true;
    api().voiceGet().then((r) => { if (live && r?.success) setSt(r); }).catch(() => {});
    const off = api().onVoiceStatus?.((s) => { if (live && s && s.state !== "awake") setSt((p) => ({ ...(p || {}), ...s })); });
    return () => { live = false; try { off?.(); } catch {} };
  }, []);
  if (!voiceAvailable()) return null;
  const on = !!st?.enabled;
  const flip = async () => {
    if (busy || !st) return;
    setBusy(true);
    try { const r = await api().voiceSet(!on); if (r?.success) setSt((p) => ({ ...(p || {}), ...r })); } finally { setBusy(false); }
  };
  const line = !st ? "…" : !on ? "Off. AURA doesn't use your microphone for this."
    : st.state === "starting" ? "Starting…" : st.state === "listening" ? "On. Listening for “Hey AURA”" : st.state === "error" ? st.error : "On";
  return (
    <div className="ss">
      <style>{CSS}</style>
      <div className="ss-t">VOICE COMMANDS</div>
      <div className="ss-card">
        <div className="sr">
          <div><div className="sr-l">Voice Commands</div><div className="sr-s">Say “Hey AURA”, then what you want, like “Hey AURA, next song” or “Hey AURA, start recording”. Uses the speech recognition built into Windows, on this PC. Nothing you say is recorded or sent anywhere.</div></div>
          <div className={`tog ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label="Voice commands" aria-disabled={busy || !st} tabIndex={0}
            onClick={flip} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } }} />
        </div>
        <div className="sr">
          <div><div className="sr-l">Status</div><div className={`sr-s${on && st?.state === "error" ? " vc-err" : ""}`} role="status">{line}</div></div>
          <button type="button" className="btn-gh" style={{ fontSize: 11, padding: "5px 12px" }} aria-expanded={help} onClick={() => setHelp((h) => !h)}>{help ? "Hide" : "What you can say"}</button>
        </div>
        {help && (
          <div className="vc-say">
            {SAY.map(([t, s]) => <div key={t}><b>{t}</b><span>{s}</span></div>)}
            <p>Say “Hey AURA” first, every time. You can also say “Hey AURA”, wait for the Listening sign, then the command. If nothing is playing in AURA, music commands go to whatever is playing on your PC.</p>
          </div>
        )}
      </div>
    </div>
  );
}

const CSS = `
.vc-sign{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:9000;display:flex;align-items:center;gap:8px;padding:9px 16px;border-radius:999px;background:var(--surface,#1b1f2a);border:1px solid var(--ac,#ff5a1f);color:var(--t1,#fff);font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.35);pointer-events:none}
.vc-sign svg{color:var(--ac,#ff5a1f)}
.vc-sign.done{border-color:var(--border,#333)}
.vc-err{color:#ff8a80}
.vc-say{display:grid;gap:8px;padding:12px 16px 14px;font-size:12.5px;color:var(--t2);text-align:left}
.vc-say div{display:grid;grid-template-columns:130px 1fr;gap:10px}
.vc-say b{color:var(--t1);font-weight:600}
.vc-say p{margin:4px 0 0;line-height:1.5}
@media (max-width:640px){.vc-say div{grid-template-columns:1fr;gap:2px}}
`;
