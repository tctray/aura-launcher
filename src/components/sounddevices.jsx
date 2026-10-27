// AURA — Settings > Sound devices: pick what you hear and talk through, set their volume, and
// star two favourites to flip between (Ctrl + Alt + S, or the button on the AURA bar).
// The work happens in electron/sounddevices.js. Windows only: elsewhere the tab doesn't show.
// Added by aura-sound-devices-setup.cjs.
import { useCallback, useEffect, useRef, useState } from "react";

const api = () => (typeof window !== "undefined" ? window.electronAPI : null);
// The tab shows only in AURA on Windows
export const soundTabAvailable = () =>
  typeof api()?.soundList === "function" && /Windows/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "");

const TAB_KEY = "aura_settings_tab";
export function useSettingsTab() {
  const [tab, setTab] = useState(() => {
    try { return soundTabAvailable() && localStorage.getItem(TAB_KEY) === "sound" ? "sound" : "general"; } catch { return "general"; }
  });
  const choose = useCallback((t) => { setTab(t); try { localStorage.setItem(TAB_KEY, t); } catch {} }, []);
  return [tab, choose];
}

export function SettingsTabs({ tab, onTab }) {
  if (!soundTabAvailable()) return null;
  const tabs = [["general", "General"], ["sound", "Sound devices"]];
  return (
    <div className="snd-tabs" role="tablist" aria-label="Settings">
      <style>{CSS}</style>
      {tabs.map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => onTab(id)}>{label}</button>
      ))}
    </div>
  );
}

const Star = ({ on }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
    <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z" />
  </svg>
);
const Speaker = ({ muted }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    {muted ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />}
  </svg>
);
const Mic = ({ muted }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
    {muted && <path d="M4 4l16 16" />}
  </svg>
);

// A slider that sends while you drag (a few times a second) and once more when you let go
function Volume({ device, kind, onError }) {
  const [value, setValue] = useState(device.volume ?? 0);
  const [muted, setMuted] = useState(device.muted);
  const dragging = useRef(false), last = useRef(0), timer = useRef(null);
  useEffect(() => { if (!dragging.current) { setValue(device.volume ?? 0); setMuted(device.muted); } }, [device.id, device.volume, device.muted]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const send = (v) => api()?.soundVolume(device.id, v).then((r) => { if (r && r.success === false) onError(r.error); });
  const change = (v) => {
    setValue(v);
    clearTimeout(timer.current);
    const wait = 120 - (Date.now() - last.current);
    if (wait <= 0) { last.current = Date.now(); send(v); }
    else timer.current = setTimeout(() => { last.current = Date.now(); send(v); }, wait);
  };
  const mute = async () => {
    const next = !muted;
    setMuted(next);
    const r = await api()?.soundMute(device.id, next);
    if (r && r.success === false) { setMuted(!next); onError(r.error); }
  };
  if (device.volume == null) return null;
  const Icon = kind === "in" ? Mic : Speaker;
  const what = kind === "in" ? "Mic volume" : "Volume";
  return (
    <div className="sr">
      <div><div className="sr-l">{what}</div><div className="sr-s">{device.name}</div></div>
      <div className="snd-vol">
        <button type="button" className={`snd-icon${muted ? " muted" : ""}`} onClick={mute} aria-pressed={muted}
          title={muted ? "Unmute" : "Mute"} aria-label={(muted ? "Unmute " : "Mute ") + device.name}><Icon muted={muted} /></button>
        <div className="set-range">
          <input type="range" min={0} max={1} step={0.01} value={value} aria-label={`${what} for ${device.name}`}
            onPointerDown={() => { dragging.current = true; }} onPointerUp={() => { dragging.current = false; }}
            onChange={(e) => change(parseFloat(e.target.value))} />
          <span>{Math.round(value * 100)}%</span>
        </div>
      </div>
    </div>
  );
}

function DeviceRow({ d, onUse, star, busy }) {
  return (
    <div className={`sr snd-dev${d.inUse ? " on" : ""}`}>
      <button type="button" className="snd-pick" onClick={() => !d.inUse && onUse(d)} disabled={busy} aria-pressed={d.inUse}
        aria-label={d.inUse ? `${d.name} (in use)` : `Use ${d.name}`}>
        <span className="snd-radio" aria-hidden="true" />
        <span className="snd-text"><span className="sr-l">{d.name}</span>{d.detail && <span className="sr-s">{d.detail}</span>}</span>
        {d.inUse && <span className="snd-badge">In use</span>}
      </button>
      {star && (
        <button type="button" className={`snd-star${star.on ? " on" : ""}`} onClick={star.toggle} aria-pressed={star.on}
          title={star.on ? "Remove from Quick Switch" : "Add to Quick Switch"} aria-label={(star.on ? "Remove " : "Add ") + d.name + (star.on ? " from" : " to") + " Quick Switch"}><Star on={star.on} /></button>
      )}
    </div>
  );
}

export function SoundDevicesTab({ toast }) {
  const [state, setState] = useState(null); // { outputs, inputs, prefs, hotkey, hotkeyBusy }
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const say = useCallback((msg) => { if (msg) (toast || ((m) => setError(m)))(msg); }, [toast]);

  const load = useCallback(async () => {
    const r = await api()?.soundList();
    if (!r) return;
    if (!r.success) { setError(r.error || "Couldn't read your sound devices."); return; }
    setError("");
    setState(r);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 4000); // a headset plugged in or out shows up by itself
    const off = api()?.onSoundChanged?.(() => load());
    return () => { clearInterval(t); off?.(); };
  }, [load]);

  const use = async (d) => {
    setBusy(true);
    const r = await api().soundUse(d.id);
    setBusy(false);
    if (r?.success) { setState((s) => ({ ...s, ...r })); setError(""); }
    else say(r?.error || "Windows didn't switch.");
  };
  const savePrefs = async (patch) => {
    setState((s) => ({ ...s, prefs: { ...s.prefs, ...patch } }));
    const r = await api().soundPrefs(patch);
    if (r?.success) setState((s) => ({ ...s, prefs: r.prefs, hotkeyBusy: r.hotkeyBusy }));
  };
  const quick = async (fav) => {
    setBusy(true);
    const r = fav ? await api().soundUse(fav.output) : await api().soundQuickSwitch();
    if (fav && r?.success && fav.input && state.inputs.some((i) => i.id === fav.input)) await api().soundUse(fav.input);
    setBusy(false);
    if (!r?.success) say(r?.error);
    load();
  };

  if (!state) {
    return <div className="snd-wrap"><style>{CSS}</style><div className="snd-note">{error || "Looking for your sound devices…"}</div></div>;
  }
  if (state.supported === false) return null;
  const { outputs = [], inputs = [], prefs = { favs: [] } } = state;
  const favs = prefs.favs || [];
  const isFav = (d) => favs.some((f) => f.output === d.id);
  const toggleFav = (d) => {
    const next = isFav(d)
      ? favs.filter((f) => f.output !== d.id)
      : [...favs, { output: d.id, outputName: d.name, input: null, inputName: "" }].slice(-2); // a third star replaces the oldest
    savePrefs({ favs: next });
  };
  const setFavMic = (i, id) => {
    const mic = inputs.find((d) => d.id === id);
    savePrefs({ favs: favs.map((f, j) => (j === i ? { ...f, input: mic ? mic.id : null, inputName: mic ? mic.name : "" } : f)) });
  };
  const out = outputs.find((d) => d.inUse), mic = inputs.find((d) => d.inUse);
  const nameOf = (id, list, fallback) => (list.find((d) => d.id === id) || {}).name || fallback;

  return (
    <div className="snd-wrap">
      <style>{CSS}</style>
      {error && <div className="snd-note err" role="alert">{error}</div>}
      <div className="snd-grid">
        <div>
          <div className="ss">
            <div className="ss-t">Output · what you hear</div>
            <div className="ss-card">
              {outputs.map((d) => <DeviceRow key={d.id} d={d} onUse={use} busy={busy} star={{ on: isFav(d), toggle: () => toggleFav(d) }} />)}
              {!outputs.length && <div className="sr"><div className="sr-s">No speakers or headphones are connected.</div></div>}
              {out && <Volume device={out} kind="out" onError={say} />}
            </div>
          </div>
          <div className="ss">
            <div className="ss-t">Input · your mic</div>
            <div className="ss-card">
              {inputs.map((d) => <DeviceRow key={d.id} d={d} onUse={use} busy={busy} />)}
              {!inputs.length && <div className="sr"><div className="sr-s">No microphones are connected.</div></div>}
              {mic && <Volume device={mic} kind="in" onError={say} />}
            </div>
          </div>
        </div>
        <div>
          <div className="ss">
            <div className="ss-t">Quick Switch</div>
            <div className="ss-card">
              <div className="sr">
                <div><div className="sr-l">Flip between your ★ favourites</div><div className="sr-s">Sound and mic switch together. Calls follow too.</div></div>
                <span className="snd-key" title={state.hotkeyBusy ? "Another app is using this shortcut" : undefined}>{state.hotkey || "Ctrl + Alt + S"}</span>
              </div>
              {favs.length === 0 && <div className="sr"><div className="sr-s">Star one or two devices under Output to set up Quick Switch.</div></div>}
              {favs.length > 0 && (
                <div className="snd-pair">
                  {favs.map((f, i) => {
                    const here = outputs.some((d) => d.id === f.output);
                    const on = out && out.id === f.output;
                    return [
                      i === 1 && <span key="arrow" className="snd-arrow" aria-hidden="true">⇄</span>,
                      <div key={f.output} className={`snd-fav${on ? " on" : ""}${here ? "" : " gone"}`}>
                        <button type="button" className="snd-fav-btn" disabled={busy || !here || on} onClick={() => quick(f)}
                          aria-label={on ? `${f.outputName} (in use)` : `Switch to ${f.outputName}`}>
                          <span className="snd-fav-n">{nameOf(f.output, outputs, f.outputName)}</span>
                          <span className="snd-fav-s">{here ? (on ? "In use" : "Click to switch") : "Not connected"}</span>
                        </button>
                        <select className="fs snd-mic" value={f.input || ""} onChange={(e) => setFavMic(i, e.target.value)} aria-label={`Mic with ${f.outputName}`}>
                          <option value="">Mic: leave as it is</option>
                          {inputs.map((d) => <option key={d.id} value={d.id}>Mic: {d.name}</option>)}
                          {f.input && !inputs.some((d) => d.id === f.input) && <option value={f.input}>Mic: {f.inputName} (not connected)</option>}
                        </select>
                      </div>,
                    ];
                  })}
                </div>
              )}
              {state.hotkeyBusy && <div className="sr"><div className="sr-s snd-warn">Another app is using {state.hotkey}, so the shortcut won't work. The AURA bar button still does.</div></div>}
            </div>
          </div>
          <div className="ss">
            <div className="ss-t">Automatic</div>
            <div className="ss-card">
              <div className="sr">
                <div><div className="sr-l">Use my headset when a game starts</div><div className="sr-s">{favs[0] ? `Switches to ${favs[0].outputName} while you play, then back` : "Your first ★ favourite is used as the headset"}</div></div>
                <div className={`tog ${prefs.autoHeadset ? "on" : ""}`} role="switch" aria-checked={!!prefs.autoHeadset} tabIndex={0} aria-label="Use my headset when a game starts"
                  onClick={() => savePrefs({ autoHeadset: !prefs.autoHeadset })} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); savePrefs({ autoHeadset: !prefs.autoHeadset }); } }} />
              </div>
              <div className="sr">
                <div><div className="sr-l">Shortcut {state.hotkey || "Ctrl + Alt + S"}</div><div className="sr-s">Flip devices from inside a game</div></div>
                <div className={`tog ${prefs.hotkey ? "on" : ""}`} role="switch" aria-checked={!!prefs.hotkey} tabIndex={0} aria-label="Quick Switch shortcut"
                  onClick={() => savePrefs({ hotkey: !prefs.hotkey })} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); savePrefs({ hotkey: !prefs.hotkey }); } }} />
              </div>
              <div className="sr">
                <div><div className="sr-l">Quick Switch on the AURA bar</div><div className="sr-s">A button to flip devices while you play (F10 shows the bar)</div></div>
                <div className={`tog ${prefs.bar ? "on" : ""}`} role="switch" aria-checked={!!prefs.bar} tabIndex={0} aria-label="Quick Switch on the AURA bar"
                  onClick={() => savePrefs({ bar: !prefs.bar })} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); savePrefs({ bar: !prefs.bar }); } }} />
              </div>
            </div>
          </div>
          <div className="ss">
            <div className="ss-t">Windows</div>
            <div className="ss-card">
              <div className="sr">
                <div><div className="sr-l">Windows sound settings</div><div className="sr-s">For everything else, like sound for each app</div></div>
                <button type="button" className="btn-gh" style={{ fontSize: 11, padding: "6px 14px" }} onClick={() => api()?.soundOpenWindows?.()}>Open</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.snd-tabs{display:inline-flex;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:3px;margin-bottom:22px;gap:2px}
.snd-tabs button{background:transparent;border:0;color:var(--t2);font:inherit;font-size:13px;font-weight:500;padding:8px 18px;border-radius:8px;cursor:pointer}
.snd-tabs button:hover{color:var(--t1)}
.snd-tabs button.on{background:var(--ac);color:#fff}
.snd-tabs button:focus-visible{outline:2px solid #fff;outline-offset:1px}
.snd-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:0 24px;align-items:start}
@media (max-width:1100px){.snd-grid{grid-template-columns:minmax(0,1fr)}}
.snd-note{font-size:12.5px;color:var(--t2);padding:12px 2px}
.snd-note.err{color:#ff9bae}
.snd-dev{padding:0;gap:0}
.snd-pick{flex:1;min-width:0;display:flex;align-items:center;gap:12px;line-height:1.35;background:transparent;border:0;color:inherit;font:inherit;text-align:left;padding:12px 16px;cursor:pointer}
.snd-pick:disabled{cursor:default}
.snd-pick:hover:not(:disabled){background:var(--hover)}
.snd-pick:focus-visible{outline:2px solid var(--ac);outline-offset:-2px}
.snd-text{display:flex;flex-direction:column;min-width:0}
.snd-text .sr-l,.snd-text .sr-s{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.snd-radio{width:16px;height:16px;border-radius:50%;border:2px solid var(--t2);opacity:.6;flex-shrink:0}
.snd-dev.on{background:var(--acd)}
.snd-dev.on .snd-radio{opacity:1;border-color:var(--ac);background:var(--ac);box-shadow:inset 0 0 0 3px var(--card)}
.snd-dev.on .snd-text .sr-l{color:var(--ac)}
.snd-badge{margin-left:auto;line-height:1.3;font-size:10.5px;font-weight:600;color:#fff;background:var(--ac);border-radius:20px;padding:3px 9px;flex-shrink:0}
.snd-star{background:transparent;border:0;color:var(--t2);opacity:.55;padding:0 16px;align-self:stretch;cursor:pointer;display:flex;align-items:center}
.snd-star:hover{color:var(--t1);opacity:1}
.snd-star.on{color:#ffc24b;opacity:1}
.snd-star:focus-visible{outline:2px solid var(--ac);outline-offset:-2px}
.snd-vol{display:flex;align-items:center;gap:8px}
.snd-icon{width:30px;height:30px;border-radius:8px;border:1px solid var(--border);background:var(--hover);color:var(--t1);display:flex;align-items:center;justify-content:center;cursor:pointer}
.snd-icon.muted{color:#ff8fa3;border-color:rgba(255,77,109,.4)}
.snd-key{font-family:monospace;font-size:11px;background:var(--hover);border:1px solid var(--border);padding:4px 8px;border-radius:6px;color:var(--t2);white-space:nowrap}
.snd-pair{display:flex;align-items:stretch;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border)}
.snd-arrow{align-self:center;color:var(--t2);font-size:18px}
.snd-fav{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.snd-fav-btn{line-height:1.35;display:flex;flex-direction:column;align-items:center;gap:2px;padding:12px 10px;border-radius:10px;border:1px solid var(--border);background:var(--hover);color:var(--t1);font:inherit;cursor:pointer;min-width:0}
.snd-fav-btn:hover:not(:disabled){border-color:var(--ac)}
.snd-fav-btn:disabled{cursor:default}
.snd-fav.on .snd-fav-btn{background:var(--ac);border-color:var(--ac);color:#fff}
.snd-fav.gone .snd-fav-btn{opacity:.5}
.snd-fav-n{font-size:13px;font-weight:600;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.snd-fav-s{font-size:10.5px;opacity:.75}
.snd-mic{width:100%;font-size:11px;padding:6px 8px}
.snd-warn{color:#ffc24b}
`;
