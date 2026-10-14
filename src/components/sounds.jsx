// src/components/sounds.jsx — the sound for incoming calls (ringtone) and for new messages (chime).
// Added by aura-ringtones-setup.cjs.
//
// Pick one of AURA's own sounds, a sound file from your PC (MP3, WAV, OGG or M4A, up to 3 MB),
// or none. AURA's own sounds are made on the spot, so there are no sound files to ship. A file you
// choose stays on this PC (in AURA's own storage) and is never uploaded.
// Settings > Calls and messages has the choices; calls.jsx rings with them and messages.jsx chimes.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const KEY = "aura_call_sounds";
const CALL_PREFS_KEY = "aura_call_prefs"; // calls.jsx keeps the chosen speakers here
const MAX_FILE = 3 * 1024 * 1024;
const RING_MAX_SECONDS = 30;   // a long song rings from the start, 30 seconds at a time
const CHIME_MAX_SECONDS = 5;   // a message sound is cut off after 5 seconds

export const RINGTONES = [
  { id: "aura", label: "AURA" },
  { id: "classic", label: "Classic phone" },
  { id: "arcade", label: "Arcade" },
  { id: "bells", label: "Soft bells" },
];
export const CHIMES = [
  { id: "aura", label: "AURA chime" },
  { id: "ding", label: "Ding" },
  { id: "bubble", label: "Bubble" },
  { id: "blip", label: "Blip" },
];

// ── What you picked ──────────────────────────────────────────────────────────
const RING_IDS = new Set([...RINGTONES.map((r) => r.id), "custom", "off"]);
const CHIME_IDS = new Set([...CHIMES.map((c) => c.id), "custom", "windows", "off"]);
const clean = (p) => ({
  ring: RING_IDS.has(p?.ring) ? p.ring : "aura",
  message: CHIME_IDS.has(p?.message) ? p.message : "aura",
  ringName: typeof p?.ringName === "string" ? p.ringName.slice(0, 80) : "",
  messageName: typeof p?.messageName === "string" ? p.messageName.slice(0, 80) : "",
  volume: Number.isFinite(p?.volume) ? Math.min(1, Math.max(0, p.volume)) : 1,
});
let prefs = clean((() => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } })());
const watchers = new Set();
export const soundPrefs = () => prefs;
export function setSoundPrefs(patch) {
  prefs = clean({ ...prefs, ...patch });
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {}
  tellMain();
  watchers.forEach((w) => { try { w(); } catch {} });
}
const subscribe = (fn) => { watchers.add(fn); return () => watchers.delete(fn); };
// The main process shows Windows notifications; they stay silent unless you chose Windows' sound,
// so you don't hear two sounds for one message.
function tellMain() { try { window.electronAPI?.settingsSync?.({ messageSound: prefs.message }); } catch {} }
tellMain();

// ── Sound files you chose (kept in AURA's own storage on this PC) ────────────
const DB = "aura-sounds";
function db() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("files");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}
async function saveFile(slot, blob) {
  const d = await db();
  await new Promise((resolve, reject) => { const tx = d.transaction("files", "readwrite"); tx.objectStore("files").put(blob, slot); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  d.close();
  delete urls[slot];
}
async function loadFile(slot) {
  try {
    const d = await db();
    const blob = await new Promise((resolve) => { const r = d.transaction("files").objectStore("files").get(slot); r.onsuccess = () => resolve(r.result || null); r.onerror = () => resolve(null); });
    d.close();
    return blob instanceof Blob ? blob : null;
  } catch { return null; }
}
async function removeFile(slot) {
  try { const d = await db(); await new Promise((r) => { const tx = d.transaction("files", "readwrite"); tx.objectStore("files").delete(slot); tx.oncomplete = r; tx.onerror = r; }); d.close(); } catch {}
  if (urls[slot]) { try { URL.revokeObjectURL(urls[slot]); } catch {} delete urls[slot]; }
}
const urls = {};
async function fileUrl(slot) {
  if (urls[slot]) return urls[slot];
  const blob = await loadFile(slot);
  if (!blob) return "";
  urls[slot] = URL.createObjectURL(blob);
  return urls[slot];
}

// ── Checking a file before it's used ─────────────────────────────────────────
const AUDIO_TYPES = /^audio\/(mpeg|mp3|wav|wave|x-wav|ogg|mp4|x-m4a|aac|webm|flac)$/i;
const AUDIO_NAMES = /\.(mp3|wav|ogg|oga|m4a|aac|webm|flac)$/i;
// Answers { blob, name, seconds } or throws a message you can show
export async function checkSoundFile(file) {
  if (!file) throw new Error("Choose a sound file.");
  if (!AUDIO_TYPES.test(file.type || "") && !AUDIO_NAMES.test(file.name || "")) throw new Error("That isn't a sound file. Choose an MP3, WAV, OGG or M4A.");
  if (file.size > MAX_FILE) throw new Error("That file is too big. Choose one under 3 MB (a short clip works best).");
  if (file.size < 100) throw new Error("That file is empty.");
  const Ctx = window.AudioContext || window.webkitAudioContext;
  let seconds = 0;
  if (Ctx) {
    const ctx = new Ctx();
    try { seconds = (await ctx.decodeAudioData(await file.arrayBuffer())).duration; }
    catch { throw new Error("AURA couldn't play that file. Try an MP3 or WAV."); }
    finally { ctx.close().catch(() => {}); }
  }
  if (!(seconds > 0.05)) throw new Error("AURA couldn't play that file. Try an MP3 or WAV.");
  const name = String(file.name || "Your sound").replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 80) || "Your sound";
  return { blob: file.slice(0, file.size, file.type || "audio/mpeg"), name, seconds };
}
export async function adoptSoundFile(slot, file) {
  const ok = await checkSoundFile(file);
  await saveFile(slot, ok.blob);
  setSoundPrefs(slot === "ring" ? { ring: "custom", ringName: ok.name } : { message: "custom", messageName: ok.name });
  return ok;
}
export async function forgetSoundFile(slot) {
  await removeFile(slot);
  if (slot === "ring" && prefs.ring === "custom") setSoundPrefs({ ring: "aura", ringName: "" });
  if (slot === "message" && prefs.message === "custom") setSoundPrefs({ message: "aura", messageName: "" });
}

// ── AURA's own sounds ────────────────────────────────────────────────────────
// Each is a list of notes. note(freqs, at, length, loud, wave) plays them; calls.jsx passes its own,
// so ringing uses the speakers you picked for calls.
export const RING_PATTERNS = {
  // (aura is calls.jsx's own ring)
  classic: { every: 3000, play: (note, v) => { for (let b = 0; b < 2; b++) for (let i = 0; i < 16; i++) note([440, 480], b * 0.95 + i * 0.05, 0.04, 0.05 * v); } },
  arcade: { every: 2200, play: (note, v) => { [523.3, 659.3, 784, 1046.5, 784, 1046.5].forEach((f, i) => note([f], i * 0.09, 0.08, 0.022 * v, "square")); [523.3, 659.3, 784, 1046.5].forEach((f, i) => note([f], 0.75 + i * 0.09, 0.08, 0.022 * v, "square")); } },
  bells: { every: 3400, play: (note, v) => { [[784, 0], [659.3, 0.32], [523.3, 0.64], [659.3, 0.96], [784, 1.28]].forEach(([f, at]) => { note([f], at, 0.5, 0.06 * v); note([f * 2], at, 0.22, 0.012 * v); }); } },
};
export const CHIME_PATTERNS = {
  aura: (note, v) => { note([987.8], 0, 0.09, 0.075 * v); note([1318.5], 0.09, 0.18, 0.07 * v); },
  ding: (note, v) => { note([1568], 0, 0.55, 0.06 * v); note([3136], 0, 0.22, 0.012 * v); },
  bubble: (note, v) => { [392, 523.3, 784].forEach((f, i) => note([f], i * 0.055, 0.07, 0.07 * v)); },
  blip: (note, v) => { note([1174.7], 0, 0.06, 0.03 * v, "square"); note([1568], 0.07, 0.07, 0.025 * v, "square"); },
};

// A player for chimes and previews, on the speakers chosen for calls
let ctx = null;
const speaker = () => { try { return String(JSON.parse(localStorage.getItem(CALL_PREFS_KEY) || "{}").speaker || ""); } catch { return ""; } };
function context() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!ctx || ctx.state === "closed") ctx = new Ctx();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const want = speaker();
  if (typeof ctx.setSinkId === "function" && (typeof ctx.sinkId === "string" ? ctx.sinkId : "") !== want) ctx.setSinkId(want).catch(() => {});
  return ctx;
}
let restTimer = null;
const playing = [];
function note(freqs, at, length, loud, wave = "sine") {
  const c = context();
  if (!c) return;
  const t = c.currentTime + at;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(loud, t + 0.015);
  gain.gain.setValueAtTime(loud, t + Math.max(0.02, length - 0.05));
  gain.gain.linearRampToValueAtTime(0, t + length);
  gain.connect(c.destination);
  for (const f of freqs) {
    const osc = c.createOscillator();
    osc.type = wave; osc.frequency.value = f;
    osc.connect(gain); osc.start(t); osc.stop(t + length + 0.02);
    playing.push(osc);
    osc.onended = () => { const i = playing.indexOf(osc); if (i >= 0) playing.splice(i, 1); };
  }
  clearTimeout(restTimer);
  restTimer = setTimeout(() => { if (!playing.length && ctx && ctx.state === "running") ctx.suspend().catch(() => {}); }, 4000);
}
let fileAudio = null;
let fileStop = null;
function stopAll() {
  clearTimeout(fileStop);
  if (fileAudio) { try { fileAudio.pause(); } catch {} fileAudio = null; }
  for (const o of playing.splice(0)) { try { o.onended = null; o.stop(); } catch {} }
}
async function playFile(slot, seconds, volume) {
  const url = await fileUrl(slot);
  if (!url) return false;
  stopAll();
  const a = new Audio(url);
  a.volume = Math.min(1, Math.max(0, volume));
  try { const want = speaker(); if (want && typeof a.setSinkId === "function") await a.setSinkId(want); } catch {}
  fileAudio = a;
  try { await a.play(); } catch { return false; }
  fileStop = setTimeout(() => { if (fileAudio === a) { a.pause(); fileAudio = null; } }, seconds * 1000);
  return true;
}

// ── New message ──────────────────────────────────────────────────────────────
let lastChime = 0;
// Plays the message sound you picked. "windows" leaves it to the Windows notification; "off" is quiet.
export async function chime() {
  const p = prefs;
  if (p.message === "off" || p.message === "windows" || p.volume <= 0) return;
  const now = Date.now();
  if (now - lastChime < 1500) return; // a burst of messages chimes once
  lastChime = now;
  if (p.message === "custom" && (await playFile("message", CHIME_MAX_SECONDS, p.volume))) return;
  (CHIME_PATTERNS[p.message] || CHIME_PATTERNS.aura)(note, p.volume);
}

// ── Incoming call (used by calls.jsx) ────────────────────────────────────────
// start() rings with your choice; if your file can't play it calls onFail (AURA's own ring).
let ringAudio = null;
let ringTurn = 0; // a call answered while a file is still loading must not start ringing after
export const ringtone = {
  async start({ loop, note: callNote, speaker: callSpeaker, onFail }) {
    const p = prefs;
    ringtone.stop();
    const turn = ++ringTurn;
    if (p.ring === "off" || p.volume <= 0) return true; // quiet: the call still shows and flashes
    if (p.ring === "custom") {
      const url = await fileUrl("ring");
      if (turn !== ringTurn) return true;
      if (url) {
        const a = new Audio(url);
        a.loop = true;
        a.volume = p.volume;
        a.ontimeupdate = () => { if (a.currentTime > RING_MAX_SECONDS) a.currentTime = 0; };
        try { if (callSpeaker && typeof a.setSinkId === "function") await a.setSinkId(callSpeaker); } catch {}
        if (turn !== ringTurn) return true;
        ringAudio = a;
        try { await a.play(); if (turn !== ringTurn) { a.pause(); ringAudio = null; } return true; } catch { ringAudio = null; }
      }
      if (turn === ringTurn) onFail?.(); // the file is gone or won't play: ring with AURA's own sound
      return false;
    }
    const pattern = RING_PATTERNS[p.ring];
    if (!pattern) return false;
    loop(() => pattern.play(callNote, p.volume), pattern.every);
    return true;
  },
  stop() { ringTurn++; if (ringAudio) { try { ringAudio.pause(); ringAudio.ontimeupdate = null; } catch {} ringAudio = null; } },
  volume: () => prefs.volume,
};

// ── Settings > Calls and messages ────────────────────────────────────────────
// Rows in the same style as the rest of Settings (sr / sr-l / sr-s).
export function CallSoundSettings() {
  const p = useSyncExternalStore(subscribe, soundPrefs);
  const [busy, setBusy] = useState("");
  const [hint, setHint] = useState({ ring: "", message: "" });
  const [previewing, setPreviewing] = useState("");
  const pick = { ring: useRef(null), message: useRef(null) };
  const previewTimer = useRef(null);
  useEffect(() => () => { clearTimeout(previewTimer.current); stopAll(); }, []);

  const preview = async (slot) => {
    clearTimeout(previewTimer.current);
    stopAll();
    if (previewing === slot) { setPreviewing(""); return; }
    const choice = slot === "ring" ? p.ring : p.message;
    if (choice === "off") return;
    setPreviewing(slot);
    const seconds = slot === "ring" ? 6 : 3;
    if (choice === "custom") { if (!(await playFile(slot, seconds, p.volume))) setHint((n) => ({ ...n, [slot]: "AURA couldn't play your sound. Choose it again." })); }
    else if (slot === "ring") {
      if (choice === "aura") { [659.3, 784, 987.8].forEach((f, i) => { note([f], i * 0.16, 0.2, 0.09 * p.volume); note([f], 0.72 + i * 0.16, 0.2, 0.09 * p.volume); }); }
      else { const pat = RING_PATTERNS[choice]; pat.play(note, p.volume); previewTimer.current = setTimeout(() => pat.play(note, p.volume), pat.every); }
    } else if (choice === "windows") { setHint((n) => ({ ...n, message: "Windows plays its own notification sound when AURA isn't in front." })); }
    else (CHIME_PATTERNS[choice] || CHIME_PATTERNS.aura)(note, p.volume);
    previewTimer.current = setTimeout(() => { stopAll(); setPreviewing(""); }, seconds * 1000 + 200);
  };
  const choose = (slot, value) => {
    stopAll(); setPreviewing("");
    setHint((n) => ({ ...n, [slot]: "" }));
    if (value === "file") { pick[slot].current?.click(); return; }
    setSoundPrefs(slot === "ring" ? { ring: value } : { message: value });
  };
  const fromFile = async (slot, file) => {
    if (!file) return;
    setBusy(slot);
    try {
      const ok = await adoptSoundFile(slot, file);
      const long = slot === "ring" ? ok.seconds > RING_MAX_SECONDS : ok.seconds > CHIME_MAX_SECONDS;
      setHint((n) => ({ ...n, [slot]: long ? (slot === "ring" ? `Using "${ok.name}". It's long, so calls ring with its first ${RING_MAX_SECONDS} seconds.` : `Using "${ok.name}". Only its first ${CHIME_MAX_SECONDS} seconds play.`) : `Using "${ok.name}".` }));
    } catch (e) {
      setHint((n) => ({ ...n, [slot]: e.message || "AURA couldn't use that file." }));
    }
    setBusy("");
  };

  const row = (slot) => {
    const isRing = slot === "ring";
    const value = isRing ? p.ring : p.message;
    const customName = isRing ? p.ringName : p.messageName;
    const list = isRing ? RINGTONES : CHIMES;
    return (
      <div className="sr" key={slot}>
        <div>
          <div className="sr-l">{isRing ? "Ringtone" : "Message Sound"}</div>
          <div className="sr-s">{hint[slot] || (isRing ? "What you hear when a friend calls. Choose one of AURA's or a sound file from your PC" : "What you hear when a message arrives and you're not looking at that chat")}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <select className="fs set-select" value={value} onChange={(e) => choose(slot, e.target.value)} disabled={busy === slot}
                  aria-label={isRing ? "Ringtone" : "Message sound"} style={{ width: 200 }}>
            {list.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            {!isRing && <option value="windows">Windows notification sound</option>}
            {customName && <option value="custom">{customName} (your file)</option>}
            <option value="file">{busy === slot ? "Checking the file…" : customName ? "Choose another file…" : "Choose a file from your PC…"}</option>
            <option value="off">None</option>
          </select>
          <button className="btn-gh" style={{ fontSize: 11, padding: "5px 10px", minWidth: 58 }} onClick={() => preview(slot)}
                  disabled={value === "off" || busy === slot} aria-pressed={previewing === slot}>{previewing === slot ? "Stop" : "Play"}</button>
          {value === "custom" && (
            <button className="btn-gh" style={{ fontSize: 11, padding: "5px 10px" }} onClick={() => { forgetSoundFile(slot); setHint((n) => ({ ...n, [slot]: "" })); }}
                    title="Stop using your file and go back to AURA's sound">Remove</button>
          )}
          <input ref={pick[slot]} type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac" style={{ display: "none" }}
                 onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; fromFile(slot, f); }} />
        </div>
      </div>
    );
  };

  return (
    <>
      {row("ring")}
      {row("message")}
      <div className="sr" style={{ opacity: p.ring === "off" && (p.message === "off" || p.message === "windows") ? 0.5 : 1 }}>
        <div><div className="sr-l">Ringtone and Message Volume</div><div className="sr-s">How loud the ringtone and message sound are. Calls themselves have their own volume</div></div>
        <div className="set-range">
          <input type="range" min={0} max={1} step={0.05} value={p.volume} aria-label="Ringtone and message volume"
                 onChange={(e) => setSoundPrefs({ volume: parseFloat(e.target.value) })} />
          <span>{Math.round(p.volume * 100)}%</span>
        </div>
      </div>
    </>
  );
}
