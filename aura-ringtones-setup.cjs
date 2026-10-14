#!/usr/bin/env node
/**
 * AURA — choose your ringtone and message sound
 *
 * Settings > Calls and messages gets three new rows:
 *   - Ringtone:       AURA (as now), Classic phone, Arcade, Soft bells, a sound file from your PC,
 *                     or None
 *   - Message Sound:  AURA chime, Ding, Bubble, Blip, Windows notification sound, a sound file
 *                     from your PC, or None
 *   - Ringtone and Message Volume
 * Each has Play to hear it first. A file from your PC can be an MP3, WAV, OGG or M4A up to 3 MB.
 * It's checked before it's used, kept on this PC only (never uploaded), and a long one is cut
 * off: a ring plays its first 30 seconds over and over, a message sound its first 5 seconds.
 * Messages now chime whenever one arrives in a chat you're not looking at, also while AURA is
 * hidden by the clock, and the Windows notification stays silent so you hear only one sound.
 * (Pick "Windows notification sound" to keep Windows' own sound instead.)
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-ringtones-setup.cjs
 *
 * What it does:
 *   - creates  src/components/sounds.jsx   the sounds and their settings
 *   - edits    src/components/calls.jsx    calls ring with your ringtone
 *   - edits    src/components/messages.jsx messages chime
 *   - edits    src/App.jsx                 the rows in Settings
 *   - edits    electron/social.js          Windows notifications don't add a second sound
 *   - edits    electron/main.js            remembers which message sound you chose
 *   - creates  tests/ringtones.cjs         (only if AURA's checks are installed) checks it
 *
 * Every file it changes is copied to <name>.before-ringtones.bak first.
 * To put everything back:                 node aura-ringtones-setup.cjs --undo
 * To preview without changing anything:   node aura-ringtones-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FILES = {"sounds":"// src/components/sounds.jsx — the sound for incoming calls (ringtone) and for new messages (chime).\n// Added by aura-ringtones-setup.cjs.\n//\n// Pick one of AURA's own sounds, a sound file from your PC (MP3, WAV, OGG or M4A, up to 3 MB),\n// or none. AURA's own sounds are made on the spot, so there are no sound files to ship. A file you\n// choose stays on this PC (in AURA's own storage) and is never uploaded.\n// Settings > Calls and messages has the choices; calls.jsx rings with them and messages.jsx chimes.\nimport { useEffect, useRef, useState, useSyncExternalStore } from \"react\";\n\nconst KEY = \"aura_call_sounds\";\nconst CALL_PREFS_KEY = \"aura_call_prefs\"; // calls.jsx keeps the chosen speakers here\nconst MAX_FILE = 3 * 1024 * 1024;\nconst RING_MAX_SECONDS = 30;   // a long song rings from the start, 30 seconds at a time\nconst CHIME_MAX_SECONDS = 5;   // a message sound is cut off after 5 seconds\n\nexport const RINGTONES = [\n  { id: \"aura\", label: \"AURA\" },\n  { id: \"classic\", label: \"Classic phone\" },\n  { id: \"arcade\", label: \"Arcade\" },\n  { id: \"bells\", label: \"Soft bells\" },\n];\nexport const CHIMES = [\n  { id: \"aura\", label: \"AURA chime\" },\n  { id: \"ding\", label: \"Ding\" },\n  { id: \"bubble\", label: \"Bubble\" },\n  { id: \"blip\", label: \"Blip\" },\n];\n\n// ── What you picked ──────────────────────────────────────────────────────────\nconst RING_IDS = new Set([...RINGTONES.map((r) => r.id), \"custom\", \"off\"]);\nconst CHIME_IDS = new Set([...CHIMES.map((c) => c.id), \"custom\", \"windows\", \"off\"]);\nconst clean = (p) => ({\n  ring: RING_IDS.has(p?.ring) ? p.ring : \"aura\",\n  message: CHIME_IDS.has(p?.message) ? p.message : \"aura\",\n  ringName: typeof p?.ringName === \"string\" ? p.ringName.slice(0, 80) : \"\",\n  messageName: typeof p?.messageName === \"string\" ? p.messageName.slice(0, 80) : \"\",\n  volume: Number.isFinite(p?.volume) ? Math.min(1, Math.max(0, p.volume)) : 1,\n});\nlet prefs = clean((() => { try { return JSON.parse(localStorage.getItem(KEY) || \"{}\"); } catch { return {}; } })());\nconst watchers = new Set();\nexport const soundPrefs = () => prefs;\nexport function setSoundPrefs(patch) {\n  prefs = clean({ ...prefs, ...patch });\n  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {}\n  tellMain();\n  watchers.forEach((w) => { try { w(); } catch {} });\n}\nconst subscribe = (fn) => { watchers.add(fn); return () => watchers.delete(fn); };\n// The main process shows Windows notifications; they stay silent unless you chose Windows' sound,\n// so you don't hear two sounds for one message.\nfunction tellMain() { try { window.electronAPI?.settingsSync?.({ messageSound: prefs.message }); } catch {} }\ntellMain();\n\n// ── Sound files you chose (kept in AURA's own storage on this PC) ────────────\nconst DB = \"aura-sounds\";\nfunction db() {\n  return new Promise((resolve, reject) => {\n    try {\n      const req = indexedDB.open(DB, 1);\n      req.onupgradeneeded = () => req.result.createObjectStore(\"files\");\n      req.onsuccess = () => resolve(req.result);\n      req.onerror = () => reject(req.error);\n    } catch (e) { reject(e); }\n  });\n}\nasync function saveFile(slot, blob) {\n  const d = await db();\n  await new Promise((resolve, reject) => { const tx = d.transaction(\"files\", \"readwrite\"); tx.objectStore(\"files\").put(blob, slot); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });\n  d.close();\n  delete urls[slot];\n}\nasync function loadFile(slot) {\n  try {\n    const d = await db();\n    const blob = await new Promise((resolve) => { const r = d.transaction(\"files\").objectStore(\"files\").get(slot); r.onsuccess = () => resolve(r.result || null); r.onerror = () => resolve(null); });\n    d.close();\n    return blob instanceof Blob ? blob : null;\n  } catch { return null; }\n}\nasync function removeFile(slot) {\n  try { const d = await db(); await new Promise((r) => { const tx = d.transaction(\"files\", \"readwrite\"); tx.objectStore(\"files\").delete(slot); tx.oncomplete = r; tx.onerror = r; }); d.close(); } catch {}\n  if (urls[slot]) { try { URL.revokeObjectURL(urls[slot]); } catch {} delete urls[slot]; }\n}\nconst urls = {};\nasync function fileUrl(slot) {\n  if (urls[slot]) return urls[slot];\n  const blob = await loadFile(slot);\n  if (!blob) return \"\";\n  urls[slot] = URL.createObjectURL(blob);\n  return urls[slot];\n}\n\n// ── Checking a file before it's used ─────────────────────────────────────────\nconst AUDIO_TYPES = /^audio\\/(mpeg|mp3|wav|wave|x-wav|ogg|mp4|x-m4a|aac|webm|flac)$/i;\nconst AUDIO_NAMES = /\\.(mp3|wav|ogg|oga|m4a|aac|webm|flac)$/i;\n// Answers { blob, name, seconds } or throws a message you can show\nexport async function checkSoundFile(file) {\n  if (!file) throw new Error(\"Choose a sound file.\");\n  if (!AUDIO_TYPES.test(file.type || \"\") && !AUDIO_NAMES.test(file.name || \"\")) throw new Error(\"That isn't a sound file. Choose an MP3, WAV, OGG or M4A.\");\n  if (file.size > MAX_FILE) throw new Error(\"That file is too big. Choose one under 3 MB (a short clip works best).\");\n  if (file.size < 100) throw new Error(\"That file is empty.\");\n  const Ctx = window.AudioContext || window.webkitAudioContext;\n  let seconds = 0;\n  if (Ctx) {\n    const ctx = new Ctx();\n    try { seconds = (await ctx.decodeAudioData(await file.arrayBuffer())).duration; }\n    catch { throw new Error(\"AURA couldn't play that file. Try an MP3 or WAV.\"); }\n    finally { ctx.close().catch(() => {}); }\n  }\n  if (!(seconds > 0.05)) throw new Error(\"AURA couldn't play that file. Try an MP3 or WAV.\");\n  const name = String(file.name || \"Your sound\").replace(/\\.[a-z0-9]{1,5}$/i, \"\").replace(/[\\u0000-\\u001f]/g, \"\").trim().slice(0, 80) || \"Your sound\";\n  return { blob: file.slice(0, file.size, file.type || \"audio/mpeg\"), name, seconds };\n}\nexport async function adoptSoundFile(slot, file) {\n  const ok = await checkSoundFile(file);\n  await saveFile(slot, ok.blob);\n  setSoundPrefs(slot === \"ring\" ? { ring: \"custom\", ringName: ok.name } : { message: \"custom\", messageName: ok.name });\n  return ok;\n}\nexport async function forgetSoundFile(slot) {\n  await removeFile(slot);\n  if (slot === \"ring\" && prefs.ring === \"custom\") setSoundPrefs({ ring: \"aura\", ringName: \"\" });\n  if (slot === \"message\" && prefs.message === \"custom\") setSoundPrefs({ message: \"aura\", messageName: \"\" });\n}\n\n// ── AURA's own sounds ────────────────────────────────────────────────────────\n// Each is a list of notes. note(freqs, at, length, loud, wave) plays them; calls.jsx passes its own,\n// so ringing uses the speakers you picked for calls.\nexport const RING_PATTERNS = {\n  // (aura is calls.jsx's own ring)\n  classic: { every: 3000, play: (note, v) => { for (let b = 0; b < 2; b++) for (let i = 0; i < 16; i++) note([440, 480], b * 0.95 + i * 0.05, 0.04, 0.05 * v); } },\n  arcade: { every: 2200, play: (note, v) => { [523.3, 659.3, 784, 1046.5, 784, 1046.5].forEach((f, i) => note([f], i * 0.09, 0.08, 0.022 * v, \"square\")); [523.3, 659.3, 784, 1046.5].forEach((f, i) => note([f], 0.75 + i * 0.09, 0.08, 0.022 * v, \"square\")); } },\n  bells: { every: 3400, play: (note, v) => { [[784, 0], [659.3, 0.32], [523.3, 0.64], [659.3, 0.96], [784, 1.28]].forEach(([f, at]) => { note([f], at, 0.5, 0.06 * v); note([f * 2], at, 0.22, 0.012 * v); }); } },\n};\nexport const CHIME_PATTERNS = {\n  aura: (note, v) => { note([987.8], 0, 0.09, 0.075 * v); note([1318.5], 0.09, 0.18, 0.07 * v); },\n  ding: (note, v) => { note([1568], 0, 0.55, 0.06 * v); note([3136], 0, 0.22, 0.012 * v); },\n  bubble: (note, v) => { [392, 523.3, 784].forEach((f, i) => note([f], i * 0.055, 0.07, 0.07 * v)); },\n  blip: (note, v) => { note([1174.7], 0, 0.06, 0.03 * v, \"square\"); note([1568], 0.07, 0.07, 0.025 * v, \"square\"); },\n};\n\n// A player for chimes and previews, on the speakers chosen for calls\nlet ctx = null;\nconst speaker = () => { try { return String(JSON.parse(localStorage.getItem(CALL_PREFS_KEY) || \"{}\").speaker || \"\"); } catch { return \"\"; } };\nfunction context() {\n  const Ctx = window.AudioContext || window.webkitAudioContext;\n  if (!Ctx) return null;\n  if (!ctx || ctx.state === \"closed\") ctx = new Ctx();\n  if (ctx.state === \"suspended\") ctx.resume().catch(() => {});\n  const want = speaker();\n  if (typeof ctx.setSinkId === \"function\" && (typeof ctx.sinkId === \"string\" ? ctx.sinkId : \"\") !== want) ctx.setSinkId(want).catch(() => {});\n  return ctx;\n}\nlet restTimer = null;\nconst playing = [];\nfunction note(freqs, at, length, loud, wave = \"sine\") {\n  const c = context();\n  if (!c) return;\n  const t = c.currentTime + at;\n  const gain = c.createGain();\n  gain.gain.setValueAtTime(0, t);\n  gain.gain.linearRampToValueAtTime(loud, t + 0.015);\n  gain.gain.setValueAtTime(loud, t + Math.max(0.02, length - 0.05));\n  gain.gain.linearRampToValueAtTime(0, t + length);\n  gain.connect(c.destination);\n  for (const f of freqs) {\n    const osc = c.createOscillator();\n    osc.type = wave; osc.frequency.value = f;\n    osc.connect(gain); osc.start(t); osc.stop(t + length + 0.02);\n    playing.push(osc);\n    osc.onended = () => { const i = playing.indexOf(osc); if (i >= 0) playing.splice(i, 1); };\n  }\n  clearTimeout(restTimer);\n  restTimer = setTimeout(() => { if (!playing.length && ctx && ctx.state === \"running\") ctx.suspend().catch(() => {}); }, 4000);\n}\nlet fileAudio = null;\nlet fileStop = null;\nfunction stopAll() {\n  clearTimeout(fileStop);\n  if (fileAudio) { try { fileAudio.pause(); } catch {} fileAudio = null; }\n  for (const o of playing.splice(0)) { try { o.onended = null; o.stop(); } catch {} }\n}\nasync function playFile(slot, seconds, volume) {\n  const url = await fileUrl(slot);\n  if (!url) return false;\n  stopAll();\n  const a = new Audio(url);\n  a.volume = Math.min(1, Math.max(0, volume));\n  try { const want = speaker(); if (want && typeof a.setSinkId === \"function\") await a.setSinkId(want); } catch {}\n  fileAudio = a;\n  try { await a.play(); } catch { return false; }\n  fileStop = setTimeout(() => { if (fileAudio === a) { a.pause(); fileAudio = null; } }, seconds * 1000);\n  return true;\n}\n\n// ── New message ──────────────────────────────────────────────────────────────\nlet lastChime = 0;\n// Plays the message sound you picked. \"windows\" leaves it to the Windows notification; \"off\" is quiet.\nexport async function chime() {\n  const p = prefs;\n  if (p.message === \"off\" || p.message === \"windows\" || p.volume <= 0) return;\n  const now = Date.now();\n  if (now - lastChime < 1500) return; // a burst of messages chimes once\n  lastChime = now;\n  if (p.message === \"custom\" && (await playFile(\"message\", CHIME_MAX_SECONDS, p.volume))) return;\n  (CHIME_PATTERNS[p.message] || CHIME_PATTERNS.aura)(note, p.volume);\n}\n\n// ── Incoming call (used by calls.jsx) ────────────────────────────────────────\n// start() rings with your choice; if your file can't play it calls onFail (AURA's own ring).\nlet ringAudio = null;\nlet ringTurn = 0; // a call answered while a file is still loading must not start ringing after\nexport const ringtone = {\n  async start({ loop, note: callNote, speaker: callSpeaker, onFail }) {\n    const p = prefs;\n    ringtone.stop();\n    const turn = ++ringTurn;\n    if (p.ring === \"off\" || p.volume <= 0) return true; // quiet: the call still shows and flashes\n    if (p.ring === \"custom\") {\n      const url = await fileUrl(\"ring\");\n      if (turn !== ringTurn) return true;\n      if (url) {\n        const a = new Audio(url);\n        a.loop = true;\n        a.volume = p.volume;\n        a.ontimeupdate = () => { if (a.currentTime > RING_MAX_SECONDS) a.currentTime = 0; };\n        try { if (callSpeaker && typeof a.setSinkId === \"function\") await a.setSinkId(callSpeaker); } catch {}\n        if (turn !== ringTurn) return true;\n        ringAudio = a;\n        try { await a.play(); if (turn !== ringTurn) { a.pause(); ringAudio = null; } return true; } catch { ringAudio = null; }\n      }\n      if (turn === ringTurn) onFail?.(); // the file is gone or won't play: ring with AURA's own sound\n      return false;\n    }\n    const pattern = RING_PATTERNS[p.ring];\n    if (!pattern) return false;\n    loop(() => pattern.play(callNote, p.volume), pattern.every);\n    return true;\n  },\n  stop() { ringTurn++; if (ringAudio) { try { ringAudio.pause(); ringAudio.ontimeupdate = null; } catch {} ringAudio = null; } },\n  volume: () => prefs.volume,\n};\n\n// ── Settings > Calls and messages ────────────────────────────────────────────\n// Rows in the same style as the rest of Settings (sr / sr-l / sr-s).\nexport function CallSoundSettings() {\n  const p = useSyncExternalStore(subscribe, soundPrefs);\n  const [busy, setBusy] = useState(\"\");\n  const [hint, setHint] = useState({ ring: \"\", message: \"\" });\n  const [previewing, setPreviewing] = useState(\"\");\n  const pick = { ring: useRef(null), message: useRef(null) };\n  const previewTimer = useRef(null);\n  useEffect(() => () => { clearTimeout(previewTimer.current); stopAll(); }, []);\n\n  const preview = async (slot) => {\n    clearTimeout(previewTimer.current);\n    stopAll();\n    if (previewing === slot) { setPreviewing(\"\"); return; }\n    const choice = slot === \"ring\" ? p.ring : p.message;\n    if (choice === \"off\") return;\n    setPreviewing(slot);\n    const seconds = slot === \"ring\" ? 6 : 3;\n    if (choice === \"custom\") { if (!(await playFile(slot, seconds, p.volume))) setHint((n) => ({ ...n, [slot]: \"AURA couldn't play your sound. Choose it again.\" })); }\n    else if (slot === \"ring\") {\n      if (choice === \"aura\") { [659.3, 784, 987.8].forEach((f, i) => { note([f], i * 0.16, 0.2, 0.09 * p.volume); note([f], 0.72 + i * 0.16, 0.2, 0.09 * p.volume); }); }\n      else { const pat = RING_PATTERNS[choice]; pat.play(note, p.volume); previewTimer.current = setTimeout(() => pat.play(note, p.volume), pat.every); }\n    } else if (choice === \"windows\") { setHint((n) => ({ ...n, message: \"Windows plays its own notification sound when AURA isn't in front.\" })); }\n    else (CHIME_PATTERNS[choice] || CHIME_PATTERNS.aura)(note, p.volume);\n    previewTimer.current = setTimeout(() => { stopAll(); setPreviewing(\"\"); }, seconds * 1000 + 200);\n  };\n  const choose = (slot, value) => {\n    stopAll(); setPreviewing(\"\");\n    setHint((n) => ({ ...n, [slot]: \"\" }));\n    if (value === \"file\") { pick[slot].current?.click(); return; }\n    setSoundPrefs(slot === \"ring\" ? { ring: value } : { message: value });\n  };\n  const fromFile = async (slot, file) => {\n    if (!file) return;\n    setBusy(slot);\n    try {\n      const ok = await adoptSoundFile(slot, file);\n      const long = slot === \"ring\" ? ok.seconds > RING_MAX_SECONDS : ok.seconds > CHIME_MAX_SECONDS;\n      setHint((n) => ({ ...n, [slot]: long ? (slot === \"ring\" ? `Using \"${ok.name}\". It's long, so calls ring with its first ${RING_MAX_SECONDS} seconds.` : `Using \"${ok.name}\". Only its first ${CHIME_MAX_SECONDS} seconds play.`) : `Using \"${ok.name}\".` }));\n    } catch (e) {\n      setHint((n) => ({ ...n, [slot]: e.message || \"AURA couldn't use that file.\" }));\n    }\n    setBusy(\"\");\n  };\n\n  const row = (slot) => {\n    const isRing = slot === \"ring\";\n    const value = isRing ? p.ring : p.message;\n    const customName = isRing ? p.ringName : p.messageName;\n    const list = isRing ? RINGTONES : CHIMES;\n    return (\n      <div className=\"sr\" key={slot}>\n        <div>\n          <div className=\"sr-l\">{isRing ? \"Ringtone\" : \"Message Sound\"}</div>\n          <div className=\"sr-s\">{hint[slot] || (isRing ? \"What you hear when a friend calls. Choose one of AURA's or a sound file from your PC\" : \"What you hear when a message arrives and you're not looking at that chat\")}</div>\n        </div>\n        <div style={{ display: \"flex\", alignItems: \"center\", gap: 8 }}>\n          <select className=\"fs set-select\" value={value} onChange={(e) => choose(slot, e.target.value)} disabled={busy === slot}\n                  aria-label={isRing ? \"Ringtone\" : \"Message sound\"} style={{ width: 200 }}>\n            {list.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}\n            {!isRing && <option value=\"windows\">Windows notification sound</option>}\n            {customName && <option value=\"custom\">{customName} (your file)</option>}\n            <option value=\"file\">{busy === slot ? \"Checking the file…\" : customName ? \"Choose another file…\" : \"Choose a file from your PC…\"}</option>\n            <option value=\"off\">None</option>\n          </select>\n          <button className=\"btn-gh\" style={{ fontSize: 11, padding: \"5px 10px\", minWidth: 58 }} onClick={() => preview(slot)}\n                  disabled={value === \"off\" || busy === slot} aria-pressed={previewing === slot}>{previewing === slot ? \"Stop\" : \"Play\"}</button>\n          {value === \"custom\" && (\n            <button className=\"btn-gh\" style={{ fontSize: 11, padding: \"5px 10px\" }} onClick={() => { forgetSoundFile(slot); setHint((n) => ({ ...n, [slot]: \"\" })); }}\n                    title=\"Stop using your file and go back to AURA's sound\">Remove</button>\n          )}\n          <input ref={pick[slot]} type=\"file\" accept=\"audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac\" style={{ display: \"none\" }}\n                 onChange={(e) => { const f = e.target.files?.[0]; e.target.value = \"\"; fromFile(slot, f); }} />\n        </div>\n      </div>\n    );\n  };\n\n  return (\n    <>\n      {row(\"ring\")}\n      {row(\"message\")}\n      <div className=\"sr\" style={{ opacity: p.ring === \"off\" && (p.message === \"off\" || p.message === \"windows\") ? 0.5 : 1 }}>\n        <div><div className=\"sr-l\">Ringtone and Message Volume</div><div className=\"sr-s\">How loud the ringtone and message sound are. Calls themselves have their own volume</div></div>\n        <div className=\"set-range\">\n          <input type=\"range\" min={0} max={1} step={0.05} value={p.volume} aria-label=\"Ringtone and message volume\"\n                 onChange={(e) => setSoundPrefs({ volume: parseFloat(e.target.value) })} />\n          <span>{Math.round(p.volume * 100)}%</span>\n        </div>\n      </div>\n    </>\n  );\n}\n","test":"// Ringtones and message sounds: the pieces that make them work are in place.\n// Added by aura-ringtones-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst path = require(\"path\");\nconst ROOT = path.join(__dirname, \"..\");\nlet failed = 0;\nconst check = (name, ok) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name); };\nconst read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), \"utf8\").replace(/\\r\\n/g, \"\\n\"); } catch { return \"\"; } };\nconst sounds = read(\"src/components/sounds.jsx\");\nconst calls = read(\"src/components/calls.jsx\");\nconst messages = read(\"src/components/messages.jsx\");\nconst app = read(\"src/App.jsx\");\nconst social = read(\"electron/social.js\");\nconst main = read(\"electron/main.js\");\n\nconsole.log(\"1. The choices\");\ncheck(\"AURA's ringtones and message sounds, a file from your PC, or none\", /export const RINGTONES = \\[/.test(sounds) && /export const CHIMES = \\[/.test(sounds) && /value=\"file\"/.test(sounds) && /value=\"off\">None</.test(sounds));\ncheck(\"Settings > Calls and messages shows them\", /import \\{ CallSoundSettings \\} from \"\\.\\/components\\/sounds\";/.test(app) && /<CallSoundSettings\\/>/.test(app));\ncheck(\"your choices are kept on this PC\", /const KEY = \"aura_call_sounds\";/.test(sounds) && /localStorage\\.setItem\\(KEY/.test(sounds));\n\nconsole.log(\"2. Sound files from your PC\");\ncheck(\"only sound files, up to 3 MB\", /const MAX_FILE = 3 \\* 1024 \\* 1024;/.test(sounds) && /That isn't a sound file/.test(sounds));\ncheck(\"a file must really play before it's used\", /decodeAudioData/.test(sounds));\ncheck(\"kept on this PC (AURA's own storage), never uploaded\", /indexedDB\\.open\\(DB/.test(sounds) && !/fetch\\(|auraCloud|auraSocial/.test(sounds));\ncheck(\"long files are cut: 30 s for a ring, 5 s for a message\", /const RING_MAX_SECONDS = 30;/.test(sounds) && /const CHIME_MAX_SECONDS = 5;/.test(sounds));\n\nconsole.log(\"3. Calls and messages use them\");\ncheck(\"calls ring with your ringtone, and stop with the call\", /import \\{ ringtone, soundPrefs \\} from \"\\.\\/sounds\";/.test(calls) && /ringtone\\.start\\(\\{ loop: tones\\.loop, note: tones\\.note/.test(calls) && /stop\\(\\) \\{\\n\\s*ringtone\\.stop\\(\\);/.test(calls));\ncheck(\"AURA's own ring follows the volume\", /tones\\.note\\(\\[f\\], i \\* 0\\.16, 0\\.2, 0\\.09 \\* v\\)/.test(calls));\ncheck(\"a call answered while the file loads never rings late\", /if \\(turn !== ringTurn\\) return true;/.test(sounds));\ncheck(\"messages you're not looking at chime (not missed calls)\", /import \\{ chime \\} from \"\\.\\/sounds\";/.test(messages) && /if \\(message\\.content !== MISSED_CALL\\) chime\\(\\);/.test(messages));\ncheck(\"a burst of messages chimes once\", /if \\(now - lastChime < 1500\\) return;/.test(sounds));\ncheck(\"Windows notifications don't add a second sound\", /silent: typeof messageSound === \"function\" \\? messageSound\\(\\) !== \"windows\" : false/.test(social) && /messageSound: \\(\\) => appSettings\\.messageSound/.test(main) && /messageSound: \"aura\",/.test(main));\n\nconsole.log(failed ? `\\n${failed} FAILED` : \"\\nall passed\");\nprocess.exit(failed ? 1 : 0);\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-ringtones.bak";
const MARK = "Added by aura-ringtones-setup.cjs";
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "release", ".git", ".vite", "coverage", "tests", "supabase"]);

const rel = (p) => path.relative(ROOT, p) || p;
const say = (line = "") => console.log(line);
function stop(lines) {
  say();
  say("Nothing was changed.");
  (Array.isArray(lines) ? lines : [lines]).forEach((l) => say("  " + l));
  say();
  process.exit(1);
}
function readText(file) {
  const raw = fs.readFileSync(file, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n"; // keep Windows line endings as they are
  return { text: raw.replace(/\r\n/g, "\n"), eol };
}
const withEol = (text, eol) => (eol === "\n" ? text : text.replace(/\n/g, eol));
function* walk(dir, depth = 0) {
  if (depth > 7) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) yield* walk(full, depth + 1);
    } else if (/\.(jsx?|tsx?|cjs|mjs)$/.test(entry.name) && !/^aura-[\w-]+\.cjs$/.test(entry.name)) {
      try { if (fs.statSync(full).size < 3 * 1024 * 1024) yield full; } catch {}
    }
  }
}
// Finds one file. A project can have several that look alike, so `prefer` is a list of tie-breakers.
function findOne(label, test, hint, prefer = []) {
  let hits = [];
  for (const file of walk(ROOT)) {
    let text = "";
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    if (test(text)) hits.push({ file, text });
  }
  if (!hits.length) stop(["I couldn't find " + label + ".", hint, "Copy this message to Claude."]);
  for (const rule of prefer) {
    if (hits.length === 1) break;
    const kept = hits.filter((h) => rule(h));
    if (kept.length) hits = kept;
  }
  if (hits.length === 1) return hits[0].file;
  stop(["I found more than one file that looks like " + label + ":", ...hits.map((h) => "  " + rel(h.file)), "Copy this message to Claude."]);
}
const sameFile = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const indentOf = (line) => line.match(/^\s*/)[0];
const findLine = (lines, re, from = 0, to = lines.length) => { for (let i = from; i < to; i++) if (re.test(lines[i])) return i; return -1; };

function swapOnce(text, find, replace, what) {
  const i = text.indexOf(find);
  if (i < 0 || text.indexOf(find, i + 1) >= 0) throw new Error(what);
  return text.slice(0, i) + replace + text.slice(i + find.length);
}

// ── calls.jsx: ring with your ringtone ───────────────────────────────────────
function editCalls(text) {
  if (/from "\.\/sounds"/.test(text)) return { text, notes: [] };
  let t = text;
  t = swapOnce(t, 'import { createRoot } from "react-dom/client";\n',
    'import { createRoot } from "react-dom/client";\nimport { ringtone, soundPrefs } from "./sounds"; // your ringtone (Settings > Calls and messages)\n',
    'the imports at the top ( import { createRoot } from "react-dom/client"; )');
  t = swapOnce(t, "  note(freqs, at, length, loud) {", '  note(freqs, at, length, loud, wave = "sine") {', "the tone maker ( note(freqs, at, length, loud) )");
  t = swapOnce(t, '      osc.type = "sine"; osc.frequency.value = f;', "      osc.type = wave; osc.frequency.value = f;", 'the tone maker ( osc.type = "sine" )');
  t = swapOnce(t,
    "  ring() { tones.loop(() => { [659.3, 784, 987.8].forEach((f, i) => { tones.note([f], i * 0.16, 0.2, 0.09); tones.note([f], 0.72 + i * 0.16, 0.2, 0.09); }); }, 2600); },",
    [
      "  // Your ringtone from Settings (see sounds.jsx), or AURA's own",
      "  ring() {",
      "    const v = ringtone.volume();",
      "    const own = () => { if (v > 0) tones.loop(() => { [659.3, 784, 987.8].forEach((f, i) => { tones.note([f], i * 0.16, 0.2, 0.09 * v); tones.note([f], 0.72 + i * 0.16, 0.2, 0.09 * v); }); }, 2600); };",
      "    if (soundPrefs().ring === \"aura\") { own(); return; }",
      "    ringtone.start({ loop: tones.loop, note: tones.note, speaker: prefs.speaker || \"\", onFail: own });",
      "  },",
    ].join("\n"),
    "the incoming-call ring ( ring() { tones.loop(... 659.3, 784, 987.8 ...) } )");
  t = swapOnce(t, "  stop() {\n    clearInterval(tones.timer); tones.timer = null;",
    "  stop() {\n    ringtone.stop();\n    clearInterval(tones.timer); tones.timer = null;",
    "where the tones stop ( stop() { clearInterval(tones.timer); ... )");
  return { text: t, notes: ["calls ring with the ringtone you pick"] };
}

// ── messages.jsx: chime when a message arrives ───────────────────────────────
function editMessages(text) {
  if (/from "\.\/sounds"/.test(text)) return { text, notes: [] };
  let t = text;
  t = swapOnce(t, 'import { PrivacyButton } from "./privacy";\n',
    'import { PrivacyButton } from "./privacy";\nimport { chime } from "./sounds"; // your message sound (Settings > Calls and messages)\n',
    'the imports at the top ( import { PrivacyButton } from "./privacy"; )');
  t = swapOnce(t,
    "  if (isLooking(message.conversationId)) { actions.markReadNow(message.conversationId); return; }\n",
    "  if (isLooking(message.conversationId)) { actions.markReadNow(message.conversationId); return; }\n" +
    "  if (message.content !== MISSED_CALL) chime(); // the call already rang for a missed call\n",
    "where a new message arrives ( if (isLooking(message.conversationId)) { actions.markReadNow(...); return; } )");
  return { text: t, notes: ["a message you're not looking at plays your message sound"] };
}

// ── App: the choices in Settings > Calls and messages ────────────────────────
function editApp(text) {
  if (/<CallSoundSettings\s*\/>/.test(text)) return { text, notes: [] };
  let t = text;
  const imp = /^import \{ PrivacyButton \} from "\.\/components\/privacy";\n/m;
  if (!imp.test(t)) throw new Error('the imports at the top ( import { PrivacyButton } from "./components/privacy"; )');
  t = t.replace(imp, (m) => m + 'import { CallSoundSettings } from "./components/sounds";\n');
  const row = /^(\s*)<div className="sr"><div><div className="sr-l">Start AURA When Windows Starts<\/div>[^\n]*<Tog k="startWithWindows"\/><\/div>\n/m;
  const m = t.match(row);
  if (!m) throw new Error('the "Start AURA When Windows Starts" row in Settings > Calls and messages');
  t = t.replace(row, (line) => line + m[1] + "<CallSoundSettings/>\n");
  return { text: t, notes: ["Settings > Calls and messages: Ringtone, Message Sound and their volume"] };
}

// ── social.js: Windows notifications stay quiet unless you chose Windows' sound ─
function editSocial(text) {
  if (/messageSound\(\) !== "windows"/.test(text)) return { text, notes: [] };
  let t = text;
  t = swapOnce(t, "function register({ ipcMain, cloudHandler, cloud, getWindow, server }) {",
    "function register({ ipcMain, cloudHandler, cloud, getWindow, server, messageSound }) {",
    "the start of register() ( function register({ ipcMain, cloudHandler, cloud, getWindow, server }) )");
  t = swapOnce(t, "      const n = new Notification({ title, body, silent: false });",
    "      // AURA plays your message sound itself; Windows adds its own only if you chose it\n" +
    "      const n = new Notification({ title, body, silent: typeof messageSound === \"function\" ? messageSound() !== \"windows\" : false });",
    "the message notification ( new Notification({ title, body, silent: false }) )");
  return { text: t, notes: ["Windows notifications don't add a second sound"] };
}

// ── main.js: remember which message sound you chose ──────────────────────────
function editMain(text) {
  if (/messageSound: \(\) => appSettings\.messageSound/.test(text)) return { text, notes: [] };
  let t = text;
  t = swapOnce(t, "  trayTipShown: false,", '  trayTipShown: false,\n  messageSound: "aura",       // the message sound picked in Settings ("windows" = Windows\' own; Added by aura-ringtones-setup.cjs)',
    "AURA's main-process settings ( trayTipShown: false, )");
  t = swapOnce(t, "  appSettings.startWithWindows = appSettings.startWithWindows === true;\n",
    "  appSettings.startWithWindows = appSettings.startWithWindows === true;\n" +
    "  appSettings.messageSound = typeof appSettings.messageSound === \"string\" ? appSettings.messageSound.slice(0, 20) : \"aura\";\n",
    "where settings are checked ( appSettings.startWithWindows = appSettings.startWithWindows === true; )");
  const reg = /require\("\.\/social"\)\.register\(\{ ipcMain, cloudHandler, cloud: auraCloud, getWindow: \(\) => mainWin, (server: \(route, body\) => auraServer\(route, body\)) \}\);/;
  if (!reg.test(t)) throw new Error('where messages are set up ( require("./social").register({ ... }) )');
  t = t.replace(reg, (_m, server) => 'require("./social").register({ ipcMain, cloudHandler, cloud: auraCloud, getWindow: () => mainWin, ' + server + ", messageSound: () => appSettings.messageSound });");
  return { text: t, notes: ["remembers whether Windows should play its own message sound"] };
}


// ── AURA's checks (only when they are installed) ─────────────────────────────
function editRunner(text) {
  if (/ringtones\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  const at = findLine(lines, /^add\("window",/);
  if (at < 0) return { text, notes: ["(couldn't find where to add the ringtone check, so npm test doesn't include it)"] };
  lines.splice(at, 0, 'if (fs.existsSync(path.join(__dirname, "ringtones.cjs"))) add("files", "Ringtones and message sounds", "ringtones.cjs");');
  return { text: lines.join("\n"), notes: ["npm test now checks ringtones and message sounds too"] };
}

// Does `node` accept the file? Catches a bad edit before anything is written.
function syntaxProblem(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-check-"));
  const file = path.join(dir, "check.cjs");
  try {
    fs.writeFileSync(file, text);
    const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    return r.status === 0 ? "" : String(r.stderr || "syntax error").split("\n").filter(Boolean).slice(0, 4).join(" | ");
  } catch { return ""; } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
}

// ── Undo ──────────────────────────────────────────────────────────────────────
function undo() {
  let restored = 0;
  const visit = (dir, depth = 0) => {
    if (depth > 7) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if ((!SKIP_DIRS.has(entry.name) || entry.name === "tests") && !entry.name.startsWith(".")) visit(full, depth + 1);
      } else if (entry.name.endsWith(BAK)) {
        const target = full.slice(0, -BAK.length);
        fs.copyFileSync(full, target); fs.unlinkSync(full);
        say("  restored  " + rel(target)); restored++;
      } else if (entry.name === "sounds.jsx" || entry.name === "ringtones.cjs") {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. Calls ring and messages sound as they did before." : "Nothing to undo.");
  say();
}

// ── Run ───────────────────────────────────────────────────────────────────────
function run() {
  const pkgFile = path.join(ROOT, "package.json");
  if (!fs.existsSync(pkgFile)) stop(["This isn't your AURA project folder (no package.json here).", "Move this file next to package.json and run it from there."]);
  if (UNDO) return undo();

  const need = "Make sure this file is in your AURA project folder, next to package.json.";
  let pkgMain = "";
  try { pkgMain = String(JSON.parse(fs.readFileSync(pkgFile, "utf8")).main || ""); } catch {}
  const startFile = pkgMain ? path.resolve(ROOT, pkgMain) : "";
  const comp = (h) => /[\\/]components[\\/]/.test(h.file);
  const files = {
    main: findOne("your main file", (t) => /require\(\s*["']\.\/social["']\s*\)\.register\(/.test(t), need, [
      (h) => startFile && sameFile(h.file, startFile),
      (h) => /function createWindow\s*\(/.test(h.text),
    ]),
    social: findOne("your messaging file (social.js)", (t) => /function register\(\{ ipcMain, cloudHandler, cloud, getWindow, server/.test(t) && /new Notification\(/.test(t), need, [
      (h) => /^social\.[cm]?js$/.test(path.basename(h.file)),
    ]),
    calls: findOne("your calls file (calls.jsx)", (t) => /export const callActions\s*=/.test(t) && /const tones = \{/.test(t), need, [comp]),
    messages: findOne("your messages file (messages.jsx)", (t) => /function onMessage\(message\)/.test(t) && /export default function MessagesPage|MessagesPage/.test(t), need, [comp, (h) => /^messages\.jsx$/.test(path.basename(h.file))]),
    app: findOne("your App file", (t) => /function AuraApp\s*\(/.test(t) && /<AuraApp\b/.test(t), need, [
      (h) => /^App\.[jt]sx?$/.test(path.basename(h.file)),
    ]),
  };

  const plan = [];
  const problems = [];
  const consider = (label, file, edit, checkSyntax) => {
    const { text, eol } = readText(file);
    try {
      const result = edit(text);
      if (checkSyntax && result.text !== text) { const bad = syntaxProblem(result.text); if (bad) throw new Error("a way to edit it safely (" + bad + ")"); }
      plan.push({ label, file, before: text, after: result.text, eol, notes: result.notes });
    } catch (e) { problems.push("In " + rel(file) + " I couldn't find " + e.message + "."); }
  };
  consider("calls", files.calls, editCalls, false);
  consider("messages", files.messages, editMessages, false);
  consider("App file", files.app, editApp, false);
  consider("social.js", files.social, editSocial, true);
  consider("main file", files.main, editMain, true);
  const runner = path.join(ROOT, "tests", "run.cjs");
  const hasChecks = fs.existsSync(runner);
  if (hasChecks) consider("checks", runner, editRunner, true);

  const created = [{ label: "sounds", file: path.join(path.dirname(files.calls), "sounds.jsx"), content: FILES.sounds }];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "ringtones.cjs"), content: FILES.test });
  for (const c of created) {
    c.note = "created";
    if (fs.existsSync(c.file)) {
      const existing = readText(c.file).text;
      if (!existing.includes(MARK)) problems.push(rel(c.file) + " already exists and wasn't made by this script, so I left it alone.");
      else c.note = existing === c.content ? "already done" : "updated";
    }
  }
  if (problems.length) stop([...problems, "Copy this message to Claude."]);

  say();
  say(DRY ? "Dry run. This is what would change:" : "AURA: ringtones and message sounds");
  say();
  for (const step of plan) {
    if (step.after !== step.before && !DRY) {
      const bak = step.file + BAK;
      if (!fs.existsSync(bak)) fs.copyFileSync(step.file, bak);
      fs.writeFileSync(step.file, withEol(step.after, step.eol));
    }
    say("  " + (step.label + ":").padEnd(13) + rel(step.file));
    (step.notes.length ? step.notes : ["already done"]).forEach((n) => say("               - " + n));
  }
  for (const c of created) {
    if (c.note !== "already done" && !DRY) { fs.mkdirSync(path.dirname(c.file), { recursive: true }); fs.writeFileSync(c.file, c.content); }
    say("  " + (c.label + ":").padEnd(13) + rel(c.file));
    say("               - " + c.note);
  }
  say();
  if (DRY) { say("Run it again without --dry-run to apply."); say(); return; }
  say("Done. Restart AURA (stop it in the terminal and start it again), then open Settings > Calls and messages.");
  if (hasChecks) say("Run  npm test  before your next release.");
  say("To undo later:  node aura-ringtones-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
