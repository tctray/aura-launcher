/**
 * AURA — voice calls between friends
 *
 *   - callActions       start a call, accept, decline, hang up, mute
 *   - useCall           the call in progress (or null), for anything that wants to show it
 *   - CallButton        a button that calls one person; it knows when you're already in a call
 *   - mountCallLayer    puts the call bar at the top of the window; started by useAuraSocial
 *
 * How a call travels:
 *   Ringing, accepting and hanging up go through window.auraSocial (preload.js) to
 *   electron/social.js and on to Supabase, which only lets friends call each other.
 *   Once the call is accepted, the two PCs connect to each other and the sound goes straight
 *   between them. It is never recorded, and it doesn't pass through Supabase.
 *
 * Added by aura-messages-setup.cjs.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { ringtone, soundPrefs } from "./sounds"; // your ringtone (Settings > Calls and messages)
import { cameraEffects } from "./camfx"; // your camera background in calls (Added by aura-camera-backgrounds-setup.cjs)

const RING_OUT_MS = 30000;    // a call you make rings this long before "didn't answer"
const RING_IN_MS = 50000;     // a call ringing for you is given up on after this, if nothing ends it first
const CONNECT_MS = 25000;     // after it is accepted, how long the two PCs get to find each other
const RECONNECT_MS = 25000;   // how long a dropped connection gets to come back
const POLL_MS = 2000;         // while ringing or connecting, check on the call this often
const BEAT_MS = 20000;        // while talking, tell Supabase "still here" this often
const NOTE_MS = 2600;         // how long "Call ended" and the like stay on screen
const PREFS_KEY = "aura_call_prefs";
const MAX_VOLUME = 3; // their volume can go up to 300%
const FALLBACK_SERVERS = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
// Screen share (Added by aura-screen-share-setup.cjs): up to 1080p at 30 frames a second. On a slow connection the
// picture gets softer or slower by itself rather than stopping.
const SCREEN_MAX_BITRATE = 4000000;
const SCREEN_VIDEO = { frameRate: { ideal: 30, max: 30 }, width: { max: 1920 }, height: { max: 1080 } };
// Your camera in a call (Added by aura-call-camera-setup.cjs): up to 1080p at 30 frames a second when the camera can
const CAM_MAX_BITRATE = 2500000;
const CAM_VIDEO = { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 30, max: 30 } };
// Screen share quality, picked in the Share Screen box (Added by aura-quality-setup.cjs)
//   Auto: 1080p, 30 fps. Smooth: 1080p at 60 fps, keeps it moving (games). Sharp: up to 1440p, keeps text crisp.
// On a slow connection each eases down by itself instead of stopping.
const SHARE_MODES = {
  auto: { label: "Auto", hint: "Good for most things: 1080p at 30 fps.", video: SCREEN_VIDEO, fps: 30, bitrate: 8000000, prefer: "balanced", content: "" },
  smooth: { label: "Smooth", hint: "60 fps for games and fast motion.", video: { frameRate: { ideal: 60, max: 60 }, width: { max: 1920 }, height: { max: 1080 } }, fps: 60, bitrate: 12000000, prefer: "maintain-framerate", content: "motion" },
  sharp: { label: "Sharp", hint: "Clearest text and detail, up to 1440p.", video: { frameRate: { ideal: 30, max: 30 }, width: { max: 2560 }, height: { max: 1440 } }, fps: 30, bitrate: 12000000, prefer: "maintain-resolution", content: "detail" },
};
// Pictures in calls use the graphics card's H.264 when this PC has it (clearer, lighter while gaming), else VP9
function preferCodecs(pc) {
  try {
    const all = RTCRtpReceiver.getCapabilities?.("video")?.codecs || [];
    const rank = (c) => (/h264/i.test(c.mimeType) ? (/packetization-mode=1/.test(c.sdpFmtpLine || "") ? 0 : 1) : /vp9/i.test(c.mimeType) ? 2 : 3);
    if (!all.some((c) => rank(c) < 3)) return;
    const order = all.map((c, i) => [c, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([c]) => c);
    for (const tr of pc.getTransceivers()) {
      if (tr.receiver?.track?.kind !== "video" || tr.stopped || typeof tr.setCodecPreferences !== "function") continue;
      try { tr.setCodecPreferences(order); } catch {}
    }
  } catch {}
}
// What a missed call leaves in the conversation (written by Supabase, see aura-messages-voice.sql)
export const MISSED_CALL = "📞 Missed voice call";

// ── Talking to the main process ───────────────────────────────────────────────
async function ask(name, ...args) {
  const fn = window.auraSocial?.[name];
  if (typeof fn !== "function") throw new Error("Voice calls only work in the AURA desktop app.");
  const res = await fn(...args);
  if (!res?.success) throw new Error(res?.error || "Something went wrong.");
  return res.data;
}
export const callsAvailable = () =>
  typeof window.auraSocial?.startCall === "function" && typeof window.RTCPeerConnection === "function" && !!navigator.mediaDevices?.getUserMedia;

// ── The call in progress ──────────────────────────────────────────────────────
// call: { id, peer: { userId, username, avatarUrl }, outgoing, phase, since, muted, peerMuted, note, busy }
// phase: starting -> ringing -> connecting -> live (<-> reconnecting) -> over
let state = { call: null };
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const setCall = (call) => { state = { call }; emit(); };
const patch = (p) => { if (state.call) setCall({ ...state.call, ...p }); };
export const useCall = () => useSyncExternalStore(subscribe, () => state).call;
export const callHooks = { toast: null, person: null }; // set by components/messages
const toast = (text, kind) => callHooks.toast?.(text, kind);

let session = 0;   // goes up whenever a call starts or ends, so late answers to old questions are ignored
let rtc = null;    // the working parts of the call in progress
const newRtc = () => ({ pc: null, dc: null, mic: null, audio: null, screen: null, remoteVideo: null, cam: null, remoteCam: null, peerCam: false, config: null, queue: Promise.resolve(), seen: new Set(), polled: 0, early: [], pendingIce: [], outIce: [], restarts: 0, wasLive: false, accepting: false, saidBye: false, timers: {} });

// ── Your microphone, speakers and volume ──────────────────────────────────────
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    const spot = p.pos && Number.isFinite(p.pos.x) && Number.isFinite(p.pos.y) ? { x: Math.min(1, Math.max(0, p.pos.x)), y: Math.min(1, Math.max(0, p.pos.y)) } : null;
    return { mic: typeof p.mic === "string" ? p.mic : "", speaker: typeof p.speaker === "string" ? p.speaker : "", volume: Number.isFinite(p.volume) ? Math.min(MAX_VOLUME, Math.max(0, p.volume)) : 1, pos: spot, shareMode: SHARE_MODES[p.shareMode] ? p.shareMode : "auto" };
  } catch { return { mic: "", speaker: "", volume: 1, pos: null, shareMode: "auto" }; }
}
let prefs = loadPrefs();
function savePrefs(next) {
  prefs = { ...prefs, ...next };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}
async function openMic(deviceId = prefs.mic) {
  const want = (id) => ({ audio: { ...(id ? { deviceId: { exact: id } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  try { return await navigator.mediaDevices.getUserMedia(want(deviceId)); }
  catch (e) {
    // The microphone you picked last time has been unplugged: use whichever Windows has as its default
    if (deviceId && (e?.name === "OverconstrainedError" || e?.name === "NotFoundError")) {
      const stream = await navigator.mediaDevices.getUserMedia(want(""));
      savePrefs({ mic: "" });
      return stream;
    }
    throw e;
  }
}
// What went wrong with the camera, in words (Added by aura-call-camera-setup.cjs)
function camProblem(e) {
  const name = e?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError") return "AURA isn't allowed to use your camera. In Windows, open Settings > Privacy & security > Camera and let desktop apps use it.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found. Plug one in and try again.";
  if (name === "NotReadableError" || name === "AbortError") return "Your camera is being used by another app. Close it and try again.";
  return "AURA couldn't use your camera" + (e?.message ? " (" + e.message + ")." : ".");
}
function micProblem(e) {
  const name = e?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError") return "AURA isn't allowed to use your microphone. In Windows, open Settings > Privacy & security > Microphone and let desktop apps use it.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone found. Plug one in and try again.";
  if (name === "NotReadableError" || name === "AbortError") return "Windows couldn't open your microphone. Another app may be using it.";
  return "AURA couldn't use your microphone" + (e?.message ? " (" + e.message + ")." : ".");
}
// Remembers which call this PC joined, so a call cut off by a crash can be closed when AURA next
// starts (without touching a call you are having in AURA on another PC)
const LIVE_KEY = "aura_call_live";
const remember = (id) => { try { if (id) localStorage.setItem(LIVE_KEY, id); else localStorage.removeItem(LIVE_KEY); } catch {} };
const remembered = () => { try { return localStorage.getItem(LIVE_KEY) || ""; } catch { return ""; } };
const stopStream = (stream) => { try { stream?.getTracks().forEach((t) => { t.onended = null; t.stop(); }); } catch {} };
// A headset pulled out mid-call: carry on with whichever microphone Windows falls back to
function watchMic(stream) {
  const track = stream?.getAudioTracks()[0];
  if (!track) return;
  track.onended = () => {
    if (!rtc || rtc.mic !== stream || !state.call || state.call.phase === "over") return;
    toast("Your microphone was unplugged. Switching to the Windows default.", "err");
    callActions.useMic("");
  };
}

// ── Sounds: made here, so there are no sound files to ship ────────────────────
let audioCtx = null;
function sound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx || audioCtx.state === "closed") audioCtx = new Ctx();
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  // Tones follow the speakers you picked ("" is the Windows default)
  const now = typeof audioCtx.sinkId === "string" ? audioCtx.sinkId : "";
  if (typeof audioCtx.setSinkId === "function" && now !== (prefs.speaker || "")) audioCtx.setSinkId(prefs.speaker || "").catch(() => {});
  return audioCtx;
}
// Between calls nothing is playing: let Windows have the sound device back
function rest() {
  setTimeout(() => { if (!rtc && !tones.timer && audioCtx && audioCtx.state === "running") audioCtx.suspend().catch(() => {}); }, 1500);
}
const tones = {
  timer: null, playing: [],
  // One note: frequencies sounded together, starting `at` seconds from now
  note(freqs, at, length, loud, wave = "sine") {
    const ctx = sound();
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(loud, t + 0.02);
    gain.gain.setValueAtTime(loud, t + Math.max(0.03, length - 0.05));
    gain.gain.linearRampToValueAtTime(0, t + length);
    gain.connect(ctx.destination);
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = wave; osc.frequency.value = f;
      osc.connect(gain); osc.start(t); osc.stop(t + length + 0.02);
      tones.playing.push(osc);
      osc.onended = () => { tones.playing = tones.playing.filter((o) => o !== osc); };
    }
  },
  loop(play, every) { tones.stop(); try { play(); } catch {} tones.timer = setInterval(() => { try { play(); } catch {} }, every); },
  // What you hear while your call rings at the other end
  ringback() { tones.loop(() => tones.note([440, 480], 0, 1.8, 0.035), 5200); },
  // A call coming in
  // Your ringtone from Settings (see sounds.jsx), or AURA's own
  ring() {
    const v = ringtone.volume();
    const own = () => { if (v > 0) tones.loop(() => { [659.3, 784, 987.8].forEach((f, i) => { tones.note([f], i * 0.16, 0.2, 0.09 * v); tones.note([f], 0.72 + i * 0.16, 0.2, 0.09 * v); }); }, 2600); };
    if (soundPrefs().ring === "aura") { own(); return; }
    ringtone.start({ loop: tones.loop, note: tones.note, speaker: prefs.speaker || "", onFail: own });
  },
  connected() { tones.stop(); try { tones.note([523.3], 0, 0.11, 0.07); tones.note([784], 0.11, 0.16, 0.07); } catch {} },
  ended() { tones.stop(); try { tones.note([392], 0, 0.12, 0.06); tones.note([261.6], 0.12, 0.2, 0.06); } catch {} },
  stop() {
    ringtone.stop();
    clearInterval(tones.timer); tones.timer = null;
    for (const osc of tones.playing) { try { osc.onended = null; osc.stop(); } catch {} }
    tones.playing = [];
  },
};

// ── Who is speaking: how loud each side is, a few times a second ──────────────
const meter = {
  taps: {}, timer: null, levels: { me: 0, peer: 0 }, watchers: new Set(),
  watch(fn) { meter.watchers.add(fn); return () => meter.watchers.delete(fn); },
  tell() { meter.watchers.forEach((w) => { try { w(meter.levels.me, meter.levels.peer); } catch {} }); },
  listen(side, stream) {
    meter.drop(side);
    const ctx = sound();
    if (!ctx || !stream) return;
    try {
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      meter.taps[side] = { source, analyser, data: new Float32Array(analyser.fftSize) };
    } catch { return; }
    if (!meter.timer) meter.timer = setInterval(meter.read, 90);
  },
  read() {
    for (const side of ["me", "peer"]) {
      const tap = meter.taps[side];
      let level = 0;
      if (tap && !(side === "me" && state.call?.muted)) {
        tap.analyser.getFloatTimeDomainData(tap.data);
        let sum = 0;
        for (let i = 0; i < tap.data.length; i++) sum += tap.data[i] * tap.data[i];
        level = Math.min(1, Math.sqrt(sum / tap.data.length) * 7); // speech sits around 0.05-0.15
      }
      const was = meter.levels[side];
      meter.levels[side] = level > was ? level : was * 0.72; // jump up, ease down
      if (meter.levels[side] < 0.02) meter.levels[side] = 0;
    }
    meter.tell();
  },
  drop(side) { const tap = meter.taps[side]; if (tap) { try { tap.source.disconnect(); } catch {} delete meter.taps[side]; } },
  stop() { clearInterval(meter.timer); meter.timer = null; meter.drop("me"); meter.drop("peer"); meter.levels = { me: 0, peer: 0 }; meter.tell(); },
};

// ── Ending and tidying up ─────────────────────────────────────────────────────
function cleanup() {
  dropBoost();
  const r = rtc;
  rtc = null;
  remember("");
  tones.stop();
  meter.stop();
  if (!r) return;
  Object.values(r.timers).forEach((t) => { clearTimeout(t); clearInterval(t); });
  try { if (r.dc) { r.dc.onmessage = null; r.dc.onopen = null; } } catch {}
  try { if (r.pc) { r.pc.onicecandidate = null; r.pc.ontrack = null; r.pc.ondatachannel = null; r.pc.oniceconnectionstatechange = null; } } catch {}
  // After "bye" the connection is given a moment before it closes, so the word gets out
  const close = () => { try { r.dc?.close(); } catch {} try { r.pc?.close(); } catch {} };
  if (r.saidBye) setTimeout(close, 250); else close();
  stopStream(r.mic); // the microphone goes off straight away either way
  stopStream(r.screen); // and so does your screen, if you were sharing it
  stopStream(r.cam); // and your camera (Added by aura-call-camera-setup.cjs)
  stopStream(r.camRaw); // (the camera itself: Added by aura-camera-backgrounds-setup.cjs)
  if (r.audio) { try { r.audio.pause(); r.audio.srcObject = null; } catch {} }
  rest();
}
function sayBye() {
  try { if (rtc?.dc?.readyState === "open") { rtc.dc.send('{"t":"bye"}'); rtc.saidBye = true; } } catch {}
}
// The call is finished. With a note ("Alex declined"), the bar stays a moment to say so.
function over(note) {
  const shown = ++session;
  cleanup();
  if (!state.call) return;
  tones.ended();
  if (!note) return setCall(null);
  patch({ phase: "over", note, busy: false });
  setTimeout(() => { if (session === shown) setCall(null); }, NOTE_MS);
}
// The two PCs couldn't reach each other, or lost each other
function fail(lost) {
  const c = state.call;
  if (!c) return;
  if (c.id) ask("endCall", c.id, "failed").catch(() => {});
  toast(lost ? `Your call with ${c.peer.username} dropped. Check your connection and call again.` : `Couldn't connect your call with ${c.peer.username}. One of your networks may be blocking direct calls.`, "err");
  over(lost ? "Call lost" : "Couldn't connect");
}

// ── Connecting the two PCs ────────────────────────────────────────────────────
async function send(kind, data) {
  const c = state.call, mine = session;
  if (!c?.id) return;
  const body = JSON.stringify(data);
  // A hiccup on the way to Supabase shouldn't cost the call: try a few times. If Supabase
  // refuses it (the call has just ended, say), trying again won't help, and the next check-in says so.
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await ask("callSignal", c.id, kind, body); return; }
    catch (e) { if (/isn't connected|isn't your call|valid call message|too long|Too many|not logged in/i.test(e?.message || "")) return; }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    if (mine !== session) return;
  }
}
function queueIce(candidate) {
  if (!rtc) return;
  rtc.outIce.push(candidate);
  if (rtc.timers.ice) return;
  const mine = session;
  // A PC finds several routes within moments of each other: send them together
  rtc.timers.ice = setTimeout(function flush() {
    if (mine !== session || !rtc) return;
    rtc.timers.ice = null;
    const batch = rtc.outIce.splice(0, 20);
    if (batch.length) send("ice", batch);
    if (rtc.outIce.length) rtc.timers.ice = setTimeout(flush, 120);
  }, 120);
}
function playRemote(stream) {
  if (!rtc) return;
  if (!rtc.audio) { rtc.audio = new Audio(); rtc.audio.autoplay = true; }
  rtc.audio.srcObject = stream;
  if (prefs.speaker && typeof rtc.audio.setSinkId === "function") rtc.audio.setSinkId(prefs.speaker).catch(() => {});
  applyVolume();
  rtc.audio.play().catch(() => {});
  meter.listen("peer", stream);
}

// Their volume. Up to 100% the call plays as it is. Above that it is made louder on the way to
// your speakers, with a limiter so loud moments don't crackle. (The <audio> element still has to
// play the call, muted, or the sound stops arriving.)
function applyVolume() {
  const a = rtc?.audio;
  if (!a) return;
  const v = prefs.volume;
  const stream = a.srcObject;
  const plain = (level) => { dropBoost(); a.muted = false; a.volume = Math.min(1, Math.max(0, level)); };
  if (v <= 1 || !stream) return plain(v);
  const ctx = sound();
  if (!ctx) return plain(1);
  try {
    if (!rtc.boost || rtc.boost.stream !== stream) {
      dropBoost();
      const source = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3; limiter.knee.value = 4; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
      source.connect(gain); gain.connect(limiter); limiter.connect(ctx.destination);
      rtc.boost = { stream, source, gain, limiter };
    }
    rtc.boost.gain.gain.setTargetAtTime(v, ctx.currentTime, 0.03);
    a.volume = 1;
    a.muted = true;
  } catch { plain(1); }
}
function dropBoost() {
  const b = rtc?.boost;
  if (!b) return;
  rtc.boost = null;
  for (const node of [b.source, b.gain, b.limiter]) { try { node.disconnect(); } catch {} }
}
function wireChannel(dc) {
  // Says whether you're muted, and that this AURA can share screens (an older AURA ignores that).
  // The PC that answers gets the channel already open, so it says so straight away.
  const hello = () => { try { dc.send(JSON.stringify({ t: "mute", on: !!state.call?.muted })); dc.send('{"t":"hello","screen":1,"cam":1}'); } catch {} };
  dc.onopen = hello;
  if (dc.readyState === "open") hello();
  dc.onmessage = (e) => {
    let m = null;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m?.t === "mute") patch({ peerMuted: !!m.on });
    else if (m?.t === "hello" && m.screen) { if (m.cam && rtc) rtc.peerCam = true; addScreenLane(); } // (camera: Added by aura-call-camera-setup.cjs)
    else if (m?.t === "screen") patch({ peerSharing: !!m.on });
    else if (m?.t === "cam") patch({ peerCamOn: !!m.on });
    else if (m?.t === "bye" && state.call && state.call.phase !== "over") {
      // They hung up. No need to wait for Supabase to say so, and in case their hang-up never
      // reached it, say it from this side too (ending a call twice does no harm).
      if (state.call.id) ask("endCall", state.call.id).catch(() => {});
      over("Call ended");
    }
  };
}
function buildPeer() {
  const mine = session;
  let pc = null;
  try { pc = new RTCPeerConnection({ iceServers: rtc.config?.iceServers?.length ? rtc.config.iceServers : FALLBACK_SERVERS, bundlePolicy: "max-bundle" }); }
  catch { pc = new RTCPeerConnection({ iceServers: FALLBACK_SERVERS, bundlePolicy: "max-bundle" }); } // a server address this PC won't take: use the standard ones
  rtc.pc = pc;
  for (const track of rtc.mic.getAudioTracks()) pc.addTrack(track, rtc.mic);
  meter.listen("me", rtc.mic);
  watchMic(rtc.mic);
  pc.onicecandidate = (e) => { if (mine === session && e.candidate) queueIce(e.candidate.toJSON()); };
  pc.ontrack = (e) => {
    if (mine !== session) return;
    if (e.track.kind === "video") {
      if (!rtc) return;
      // The second picture lane is their camera; the first is their screen (Added by aura-call-camera-setup.cjs)
      if (videoLanes()[1] && e.transceiver === videoLanes()[1]) { rtc.remoteCam = new MediaStream([e.track]); patch({ camRev: (state.call?.camRev || 0) + 1 }); return; }
      rtc.remoteVideo = new MediaStream([e.track]); patch({ screenRev: (state.call?.screenRev || 0) + 1 }); return; // their screen
    }
    playRemote(e.streams[0] || new MediaStream([e.track]));
  };
  pc.ondatachannel = (e) => { if (mine === session && rtc) { rtc.dc = e.channel; wireChannel(e.channel); } };
  pc.oniceconnectionstatechange = () => { if (mine === session) onLink(pc.iceConnectionState); };
  // Anything the other PC sent before this one was ready
  const early = rtc.early.splice(0);
  for (const signal of early) rtc.queue = rtc.queue.then(() => handle(signal)).catch(() => {});
}
function onLink(link) {
  const c = state.call;
  if (!c || !rtc) return;
  if (link === "connected" || link === "completed") {
    clearTimeout(rtc.timers.connect); clearTimeout(rtc.timers.reconnect); clearTimeout(rtc.timers.nudge);
    rtc.timers.reconnect = null;
    rtc.restarts = 0;
    if (c.phase !== "live") patch({ phase: "live", since: c.since || Date.now() });
    if (!rtc.wasLive) { rtc.wasLive = true; tones.connected(); }
    return;
  }
  if (link !== "disconnected" && link !== "failed") return;
  if (c.phase === "live") {
    patch({ phase: "reconnecting" });
    if (!rtc.timers.reconnect) { const mine = session; rtc.timers.reconnect = setTimeout(() => { if (mine === session) fail(true); }, RECONNECT_MS); }
  }
  // The caller's PC proposes a fresh route. Straight away if the old one is dead, after a pause if it may recover.
  if (!c.outgoing) return;
  const mine = session;
  clearTimeout(rtc.timers.nudge);
  rtc.timers.nudge = setTimeout(() => {
    if (mine !== session || !rtc?.pc || rtc.restarts >= 3) return;
    const now = rtc.pc.iceConnectionState;
    if (now !== "disconnected" && now !== "failed") return;
    rtc.restarts++;
    offer(true);
  }, link === "failed" ? 0 : 4000);
}
async function offer(restart) {
  const mine = session, pc = rtc?.pc;
  if (!pc) return;
  try {
    const made = await pc.createOffer(restart ? { iceRestart: true } : undefined);
    if (mine !== session) return;
    await pc.setLocalDescription(made);
    if (mine !== session) return;
    await send("offer", { sdp: pc.localDescription.sdp });
  } catch { if (mine === session && !restart) fail(false); }
}
// Something the other PC sent: its side of the connection, or a route to reach it.
// It comes from the other person's PC, so it is checked before it is used.
async function handle(signal) {
  const mine = session, c = state.call;
  if (!rtc || !c) return;
  const pc = rtc.pc;
  if (!pc) { rtc.early.push(signal); return; }
  let data = null;
  try { data = JSON.parse(signal.payload); } catch { return; }
  const drain = async () => { for (const cand of rtc.pendingIce.splice(0)) { try { await pc.addIceCandidate(cand); } catch {} } };
  if (signal.kind === "offer" && !c.outgoing) {
    if (typeof data?.sdp !== "string") return;
    await pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
    if (mine !== session) return;
    // A screen-share lane from their side: answer so that either of you can share
    for (const tr of pc.getTransceivers()) { if (tr.receiver?.track?.kind === "video" && tr.direction === "recvonly") { try { tr.direction = "sendrecv"; } catch {} } }
    preferCodecs(pc); // (Added by aura-quality-setup.cjs)
    await drain();
    const answer = await pc.createAnswer();
    if (mine !== session) return;
    await pc.setLocalDescription(answer);
    if (mine !== session) return;
    await send("answer", { sdp: pc.localDescription.sdp });
    screenReady();
  } else if (signal.kind === "answer" && c.outgoing) {
    if (typeof data?.sdp !== "string" || pc.signalingState !== "have-local-offer") return;
    await pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
    if (mine !== session) return;
    await drain();
    screenReady();
  } else if (signal.kind === "ice") {
    for (const cand of (Array.isArray(data) ? data : [data]).slice(0, 40)) {
      if (!cand || typeof cand.candidate !== "string" || cand.candidate.length > 1000) continue;
      const route = { candidate: cand.candidate, sdpMid: typeof cand.sdpMid === "string" ? cand.sdpMid : null, sdpMLineIndex: Number.isInteger(cand.sdpMLineIndex) ? cand.sdpMLineIndex : null };
      if (typeof cand.usernameFragment === "string") route.usernameFragment = cand.usernameFragment;
      if (pc.remoteDescription) { try { await pc.addIceCandidate(route); } catch {} } else rtc.pendingIce.push(route);
    }
  }
}
// ── Screen share (Added by aura-screen-share-setup.cjs) ──
// Calls start with sound only, so they work with friends on an older AURA. Once both PCs say
// they can share screens, the caller's PC adds a lane for a picture, in both directions. After
// that, starting and stopping a share just puts a picture on the lane or takes it off.
const videoLanes = () => rtc?.pc?.getTransceivers().filter((tr) => tr.receiver?.track?.kind === "video" && !tr.stopped && tr.currentDirection !== "stopped") || [];
const videoLane = () => videoLanes()[0] || null;
const camLane = () => videoLanes()[1] || null; // your camera and theirs (Added by aura-call-camera-setup.cjs)
function screenReady() {
  const lane = videoLane();
  const ok = !!lane && lane.currentDirection === "sendrecv";
  if (ok && state.call && !state.call.canShare) patch({ canShare: true });
  const cam = camLane();
  if (cam && cam.currentDirection === "sendrecv" && state.call && !state.call.canCam) patch({ canCam: true });
}
async function addScreenLane() {
  const c = state.call, mine = session;
  if (!rtc?.pc || !c?.outgoing || videoLane()) return;
  // Wait for any connection change already under way to finish
  for (let i = 0; i < 40 && rtc?.pc && rtc.pc.signalingState !== "stable"; i++) { await new Promise((r) => setTimeout(r, 250)); if (mine !== session) return; }
  if (!rtc?.pc || rtc.pc.signalingState !== "stable" || videoLane()) return;
  try {
    rtc.pc.addTransceiver("video", { direction: "sendrecv" });
    if (rtc.peerCam) rtc.pc.addTransceiver("video", { direction: "sendrecv" }); // a second lane for cameras, when both can (Added by aura-call-camera-setup.cjs)
    preferCodecs(rtc.pc); // (Added by aura-quality-setup.cjs)
    const made = await rtc.pc.createOffer();
    if (mine !== session) return;
    await rtc.pc.setLocalDescription(made);
    if (mine !== session) return;
    await send("offer", { sdp: rtc.pc.localDescription.sdp });
  } catch {} // no screen share on this call, but the call itself carries on
}
function tell(message) { try { if (rtc?.dc?.readyState === "open") rtc.dc.send(JSON.stringify(message)); } catch {} }

function onSignal(callId, signal) {
  const c = state.call;
  if (!c || !rtc || c.id !== callId || !signal || !(signal.id > 0) || rtc.seen.has(signal.id)) return;
  rtc.seen.add(signal.id);
  rtc.queue = rtc.queue.then(() => handle(signal)).catch(() => {}); // one at a time, in the order they came
}

// Where the call stands, according to Supabase
function applyStatus(call) {
  const c = state.call;
  if (!c || c.id !== call.id || c.phase === "over") return;
  if (call.status === "active" && c.outgoing && c.phase === "ringing") return void connect();
  if (call.status === "active" && !c.outgoing && c.phase === "ringing" && !rtc?.accepting) return over(""); // you answered it in AURA on another PC
  if (call.status !== "ended") return;
  const name = c.peer.username;
  const note = call.reason === "declined" ? (c.outgoing ? `${name} declined` : "")
    : call.reason === "missed" || call.reason === "cancelled" ? (c.outgoing ? `${name} didn't answer` : `Missed call from ${name}`)
    : call.reason === "failed" ? "Call lost" : "Call ended";
  over(note);
}
// While a call rings or connects, ask how it stands every few seconds. Live updates normally get
// there first; this makes sure a call can't be stuck ringing if one goes missing.
function startChecking() {
  const mine = session;
  clearInterval(rtc.timers.poll);
  rtc.timers.poll = setInterval(async () => {
    const c = state.call;
    if (mine !== session || !rtc || !c?.id || c.phase === "live" || c.phase === "over") return;
    try {
      const { call, signals } = await ask("callState", c.id, rtc.polled);
      if (mine !== session || !rtc) return;
      if (!call) return over("Call ended");
      for (const s of signals || []) { rtc.polled = Math.max(rtc.polled, s.id); onSignal(c.id, s); }
      applyStatus(call);
    } catch {}
  }, POLL_MS);
}
function startBeating() {
  const mine = session;
  clearInterval(rtc.timers.beat);
  rtc.timers.beat = setInterval(async () => {
    const c = state.call;
    if (mine !== session || !c?.id) return;
    try { if ((await ask("callBeat", c.id)) === "ended" && mine === session && state.call?.phase !== "over") over("Call ended"); } catch {}
  }, BEAT_MS);
}
const armConnect = () => { const mine = session; clearTimeout(rtc.timers.connect); rtc.timers.connect = setTimeout(() => { if (mine === session) fail(false); }, CONNECT_MS); };

// Your friend accepted: this PC (the caller's) proposes the connection
async function connect() {
  const mine = session;
  clearTimeout(rtc.timers.ring);
  tones.stop();
  patch({ phase: "connecting" });
  armConnect();
  startBeating();
  if (!rtc.config) { try { rtc.config = await ask("callConfig"); } catch {} if (mine !== session) return; }
  buildPeer();
  rtc.dc = rtc.pc.createDataChannel("aura");
  wireChannel(rtc.dc);
  await offer(false);
}

// A call is ringing for you
function incoming(call) {
  const mine = ++session;
  cleanup();
  const known = callHooks.person?.(call.peerId);
  setCall({ id: call.id, peer: known || { userId: call.peerId, username: "AURA friend", avatarUrl: "" }, outgoing: false, phase: "ringing", since: 0, muted: false, peerMuted: false, note: "", busy: false });
  rtc = newRtc();
  tones.ring();
  if (!known) ask("getProfile", call.peerId).then((p) => { if (mine === session && p?.username) patch({ peer: { userId: call.peerId, username: p.username, avatarUrl: p.avatarUrl || "" } }); }).catch(() => {});
  ask("callConfig").then((cfg) => { if (mine === session && rtc) rtc.config = cfg; }).catch(() => {});
  rtc.timers.ring = setTimeout(() => {
    if (mine !== session || state.call?.phase !== "ringing") return;
    over(`Missed call from ${state.call.peer.username}`);
    ask("currentCall").catch(() => {}); // lets Supabase close the call and leave the missed-call note
  }, RING_IN_MS);
  startChecking();
}

export const callActions = {
  // person: { userId, username, avatarUrl }
  async start(person) {
    if (!person?.userId) return;
    if (!callsAvailable()) return toast("Voice calls only work in the AURA desktop app.", "err");
    const busy = state.call && state.call.phase !== "over" ? state.call : null;
    if (busy) return toast(busy.peer.userId === person.userId ? `You're already in a call with ${busy.peer.username}` : `Hang up your call with ${busy.peer.username} first`, "err");
    const mine = ++session;
    cleanup();
    setCall({ id: null, peer: { userId: person.userId, username: person.username || "AURA friend", avatarUrl: person.avatarUrl || "" }, outgoing: true, phase: "starting", since: 0, muted: false, peerMuted: false, note: "", busy: false });
    rtc = newRtc();
    // The microphone first, so a friend's AURA never rings for a call that can't happen
    let mic = null;
    try { mic = await openMic(); }
    catch (e) { if (mine === session) { cleanup(); setCall(null); toast(micProblem(e), "err"); } return; }
    if (mine !== session) return stopStream(mic); // cancelled while Windows was opening the microphone
    rtc.mic = mic;
    let call = null;
    try { call = await ask("startCall", person.userId); }
    catch (e) {
      if (mine !== session) return;
      cleanup(); setCall(null); toast(e.message, "err");
      callActions.resume(); // if it was refused because someone is ringing you, show their call
      return;
    }
    if (mine !== session) { ask("endCall", call.id).catch(() => {}); return; }
    patch({ id: call.id, phase: "ringing" });
    remember(call.id);
    tones.ringback();
    rtc.timers.ring = setTimeout(() => {
      if (mine !== session || state.call?.phase !== "ringing") return;
      ask("endCall", call.id, "missed").catch(() => {});
      over(`${state.call.peer.username} didn't answer`);
    }, RING_OUT_MS);
    startChecking();
    ask("callConfig").then((cfg) => { if (mine === session && rtc) rtc.config = cfg; }).catch(() => {});
  },

  async accept() {
    const c = state.call;
    if (!c || c.outgoing || c.phase !== "ringing" || !rtc || rtc.accepting) return;
    const mine = session;
    rtc.accepting = true;
    patch({ busy: true });
    let mic = null;
    try { mic = await openMic(); }
    catch (e) {
      // Keeps ringing: you can sort the microphone out and accept again, or decline
      if (mine === session && rtc) { rtc.accepting = false; patch({ busy: false }); toast(micProblem(e), "err"); }
      return;
    }
    if (mine !== session || !rtc) return stopStream(mic);
    rtc.mic = mic;
    if (!rtc.config) { try { rtc.config = await ask("callConfig"); } catch {} if (mine !== session || !rtc) return; }
    tones.stop();
    clearTimeout(rtc.timers.ring);
    buildPeer(); // ready for the caller's side before telling them the call is accepted
    try { await ask("answerCall", c.id); }
    catch (e) { if (mine === session) { toast(e.message, "err"); over(""); } return; }
    if (mine !== session || !rtc) return;
    remember(c.id);
    startBeating();
    // On a fast network the two PCs may already be connected by the time Supabase answers
    if (state.call.phase === "ringing") { patch({ phase: "connecting", busy: false }); armConnect(); }
    else patch({ busy: false });
  },

  // Decline a call that is ringing, cancel one you are making, or hang up
  hangUp() {
    const c = state.call;
    if (!c) return;
    if (c.phase === "over") { ++session; return setCall(null); }
    sayBye();
    if (c.id) ask("endCall", c.id).catch(() => {});
    over(""); // if the call was still being set up, start() sees the new session number and stops
  },
  decline() { callActions.hangUp(); },

  toggleMute() {
    const c = state.call;
    if (!c || !rtc?.mic) return;
    const muted = !c.muted;
    rtc.mic.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    patch({ muted });
    try { if (rtc.dc?.readyState === "open") rtc.dc.send(JSON.stringify({ t: "mute", on: muted })); } catch {}
  },

  // Share your screen, or one window. `sourceId` comes from the picker (see ScreenPicker).
  // Sharing another one while sharing switches to it. (Added by aura-screen-share-setup.cjs)
  async shareScreen(sourceId) {
    const c = state.call;
    if (!c || !rtc || (c.phase !== "live" && c.phase !== "reconnecting")) return;
    const lane = videoLane();
    if (!lane || !c.canShare) return toast(`Screen share needs both of you on the latest AURA. Ask ${c.peer.username} to update.`, "err");
    const mine = session;
    const mode = SHARE_MODES[prefs.shareMode] || SHARE_MODES.auto; // (Added by aura-quality-setup.cjs)
    let stream = null;
    try {
      if (sourceId) await window.electronAPI?.setCaptureSource?.(sourceId);
      stream = await navigator.mediaDevices.getDisplayMedia({ video: mode.video, audio: false });
    } catch (e) {
      if (mine === session) toast(e?.name === "NotAllowedError" ? "AURA isn't allowed to capture your screen. In Windows, check Settings > Privacy & security." : "AURA couldn't capture that. Pick it again, or pick another screen or window.", "err");
      return;
    }
    if (mine !== session || !rtc) return stopStream(stream); // the call ended meanwhile
    for (const a of stream.getAudioTracks()) { a.stop(); stream.removeTrack(a); } // the picture only
    const track = stream.getVideoTracks()[0];
    if (!track) { stopStream(stream); return toast("AURA couldn't capture that.", "err"); }
    // Tell the encoder what it's showing: motion (games) or detail (text)
    try { if (mode.content) track.contentHint = mode.content; } catch {}
    track.applyConstraints?.(mode.video)?.catch?.(() => {});
    try { await lane.sender.replaceTrack(track); }
    catch { stopStream(stream); return toast("Your screen couldn't be sent. Try again.", "err"); }
    if (mine !== session || !rtc) return stopStream(stream);
    const before = rtc.screen;
    rtc.screen = stream;
    if (before && before !== stream) stopStream(before);
    try {
      const p = lane.sender.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      p.encodings[0].maxBitrate = mode.bitrate;
      p.encodings[0].maxFramerate = mode.fps;
      p.degradationPreference = mode.prefer;
      await lane.sender.setParameters(p);
    } catch {}
    // The window you shared was closed: stop sharing
    track.onended = () => { if (rtc?.screen === stream) callActions.stopScreen(); };
    patch({ sharing: true });
    tell({ t: "screen", on: true });
  },
  stopScreen() {
    const lane = videoLane();
    if (lane) lane.sender.replaceTrack(null).catch(() => {});
    if (rtc?.screen) { stopStream(rtc.screen); rtc.screen = null; }
    if (state.call?.sharing) patch({ sharing: false });
    tell({ t: "screen", on: false });
  },

  // Your camera, for the other person to see (Added by aura-call-camera-setup.cjs)
  async startCamera() {
    const c = state.call;
    if (!c || !rtc || (c.phase !== "live" && c.phase !== "reconnecting") || c.camOn || c.camStarting) return;
    const lane = camLane();
    if (!lane || !c.canCam) return toast(`Camera needs both of you on the latest AURA. Ask ${c.peer.username} to update.`, "err");
    const mine = session;
    patch({ camStarting: true });
    // The camera picked in Settings > Camera, if there is one
    let picked = "";
    try { picked = JSON.parse(localStorage.getItem("aura_settings") || "{}").camDevice || ""; } catch {}
    const want = (id) => navigator.mediaDevices.getUserMedia({ audio: false, video: { ...CAM_VIDEO, ...(id ? { deviceId: { exact: id } } : {}) } });
    let stream = null;
    try {
      try { stream = await want(picked); }
      catch (e) { if (picked && (e?.name === "OverconstrainedError" || e?.name === "NotFoundError")) stream = await want(""); else throw e; }
    } catch (e) {
      if (mine === session) { patch({ camStarting: false }); toast(camProblem(e), "err"); }
      return;
    }
    if (mine !== session || !rtc || !state.call?.camStarting) return stopStream(stream); // the call ended (or you pressed again) meanwhile
    // What's sent has your background (Settings > Camera); the camera itself is kept to let go of later (Added by aura-camera-backgrounds-setup.cjs)
    const raw = stream;
    const fx = cameraEffects(raw);
    if (fx) stream = fx.stream;
    const track = stream.getVideoTracks()[0];
    try { await lane.sender.replaceTrack(track); }
    catch { stopStream(stream); stopStream(raw); patch({ camStarting: false }); return toast("Your camera couldn't be sent. Try again.", "err"); }
    if (mine !== session || !rtc) { stopStream(raw); return stopStream(stream); }
    rtc.cam = stream; rtc.camRaw = raw;
    try {
      const p = lane.sender.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      p.encodings[0].maxBitrate = CAM_MAX_BITRATE;
      p.encodings[0].maxFramerate = 30;
      p.degradationPreference = "balanced";
      await lane.sender.setParameters(p);
    } catch {}
    // Unplugged mid-call: turn it off and say so
    const camTrack = raw.getVideoTracks()[0];
    if (camTrack) camTrack.onended = () => { if (rtc?.camRaw === raw) { callActions.stopCamera(); toast("Your camera was disconnected.", "err"); } };
    patch({ camOn: true, camStarting: false, camRev: (state.call?.camRev || 0) + 1 });
    tell({ t: "cam", on: true });
  },
  stopCamera() {
    const lane = camLane();
    if (lane) lane.sender.replaceTrack(null).catch(() => {});
    if (rtc?.cam) { stopStream(rtc.cam); rtc.cam = null; }
    if (rtc?.camRaw) { stopStream(rtc.camRaw); rtc.camRaw = null; } // the camera itself
    if (state.call?.camOn || state.call?.camStarting) patch({ camOn: false, camStarting: false });
    tell({ t: "cam", on: false });
  },

  // The call screen (Added by aura-call-screen-setup.cjs)
  openStage() { const c = state.call; if (c && (c.phase === "live" || c.phase === "reconnecting")) patch({ stage: true }); },
  closeStage() { if (state.call?.stage) patch({ stage: false }); },

  // Ends the call if it is with this person (used when you block them)
  endWith(userId) { if (state.call?.peer.userId === userId && state.call.phase !== "over") callActions.hangUp(); },

  // Devices, from the call bar's settings
  async useMic(deviceId) {
    savePrefs({ mic: deviceId || "" });
    const mine = session;
    if (!rtc?.mic) return;
    let fresh = null;
    try { fresh = await openMic(deviceId || ""); }
    catch (e) { toast(micProblem(e), "err"); return; }
    if (mine !== session || !rtc) return stopStream(fresh);
    const track = fresh.getAudioTracks()[0];
    track.enabled = !state.call?.muted;
    const sender = rtc.pc?.getSenders().find((s) => s.track?.kind === "audio");
    try { if (sender) await sender.replaceTrack(track); } catch {}
    if (mine !== session || !rtc) return stopStream(fresh); // the call ended while the microphones were being swapped
    stopStream(rtc.mic);
    rtc.mic = fresh;
    meter.listen("me", fresh);
    watchMic(fresh);
  },
  useSpeaker(deviceId) {
    savePrefs({ speaker: deviceId || "" });
    if (rtc?.audio && typeof rtc.audio.setSinkId === "function") rtc.audio.setSinkId(deviceId || "").catch(() => toast("AURA couldn't switch to those speakers.", "err"));
    if (rtc?.boost) sound(); // the louder-than-100% sound follows the speakers too
  },
  setVolume(volume) {
    savePrefs({ volume: Math.min(MAX_VOLUME, Math.max(0, Number(volume) || 0)) });
    applyVolume();
  },

  // Something arrived from the main process
  onEvent(event) {
    if (event?.type === "signal") return onSignal(event.callId, event.signal);
    if (event?.type !== "call" || !event.call?.id) return;
    const call = event.call, c = state.call;
    if (c && c.id === call.id) return applyStatus(call);
    if (call.status !== "ringing" || call.outgoing) return; // not a new call for you
    if (c && c.phase !== "over") return;                    // you're busy (Supabase normally refuses the call before this)
    incoming(call);
  },

  // When AURA starts: is a call already ringing for you? A call left over from before AURA was
  // closed can't be picked up again, so it is ended.
  async resume() {
    if (!callsAvailable() || state.call) return;
    try {
      const call = await ask("currentCall");
      if (!call || state.call) return;
      if (call.status === "ringing" && !call.outgoing) incoming(call);
      else if (call.id === remembered()) { remember(""); ask("endCall", call.id).catch(() => {}); }
    } catch {}
  },

  // Logging out, or AURA closing
  reset() {
    const c = state.call;
    if (c?.id && c.phase !== "over") {
      sayBye();
      // A call still ringing for you is left to ring out (unless you had just pressed Accept)
      if (c.outgoing || c.phase !== "ringing" || rtc?.accepting) ask("endCall", c.id).catch(() => {});
    }
    ++session;
    cleanup();
    setCall(null);
  },
};

// ── What you see ──────────────────────────────────────────────────────────────
const Svg = ({ children, size = 17 }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width={size} height={size} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const PHONE = "M6.6 3.5h2.7l1.4 4-2 1.5a12 12 0 0 0 6.3 6.3l1.5-2 4 1.4v2.7a2 2 0 0 1-2.2 2A16.3 16.3 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z";
export const IconPhone = ({ size }) => <Svg size={size}><path d={PHONE} /></Svg>;
const IconHangUp = () => <Svg><path d={PHONE} transform="rotate(135 12 12)" /></Svg>;
const IconMic = () => <Svg><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" /></Svg>;
const IconMicOff = () => <Svg><path d="M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5M5.5 11.5a6.5 6.5 0 0 0 10.2 5.3M18.5 11.5c0 .9-.2 1.8-.5 2.6M12 18v3M4 4l16 16" /></Svg>;
const IconGrip = () => <Svg size={14}><circle cx="9" cy="6" r="1.3" fill="currentColor" stroke="none" /><circle cx="15" cy="6" r="1.3" fill="currentColor" stroke="none" /><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="9" cy="18" r="1.3" fill="currentColor" stroke="none" /><circle cx="15" cy="18" r="1.3" fill="currentColor" stroke="none" /></Svg>;
const IconCam = () => <Svg><rect x="2" y="6" width="14" height="12" rx="2" /><path d="m16 10 6-3v10l-6-3z" /></Svg>; // (Added by aura-call-camera-setup.cjs)
const IconExpandCam = () => <Svg size={14}><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></Svg>;
const IconScreen = () => <Svg><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></Svg>;
const IconExpand = () => <Svg size={15}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Svg>;
const IconShrink = () => <Svg size={15}><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></Svg>;
const IconSliders = () => <Svg><path d="M5 6h8M17 6h2M5 12h2M11 12h8M5 18h9M18 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="16" cy="18" r="2" /></Svg>;

function Face({ person, size }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [person.avatarUrl]);
  const letter = (String(person.username || "?").trim()[0] || "?").toUpperCase();
  return (
    <span className="cx-face" style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }}>
      {person.avatarUrl && !broken ? <img src={person.avatarUrl} alt="" onError={() => setBroken(true)} /> : <span>{letter}</span>}
    </span>
  );
}
function Clock({ since }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const two = (n) => String(n).padStart(2, "0");
  return <>{s >= 3600 ? Math.floor(s / 3600) + ":" + two(Math.floor(s / 60) % 60) : two(Math.floor(s / 60))}:{two(s % 60)}</>;
}

// Microphone, speakers and how loud your friend is
function Devices({ onClose }) {
  const box = useRef(null);
  const [list, setList] = useState({ mics: [], speakers: [] });
  const [, redraw] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => navigator.mediaDevices.enumerateDevices().then((all) => {
      if (!alive) return;
      const pick = (kind) => all.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications");
      setList({ mics: pick("audioinput"), speakers: pick("audiooutput") });
    }).catch(() => {});
    load();
    navigator.mediaDevices.addEventListener?.("devicechange", load);
    const away = (e) => { if (box.current && !box.current.contains(e.target) && !e.target.closest?.("[data-cx-devices]")) onClose(); };
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { alive = false; navigator.mediaDevices.removeEventListener?.("devicechange", load); document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [onClose]);
  const name = (d, i, word) => d.label || `${word} ${i + 1}`;
  const known = (id, devices) => (id && devices.some((d) => d.deviceId === id) ? id : "");
  return (
    <div className="cx-devices" ref={box} role="dialog" aria-label="Call settings">
      <label>Microphone
        <select value={known(prefs.mic, list.mics)} onChange={(e) => { callActions.useMic(e.target.value).then(() => redraw((n) => n + 1)); }}>
          <option value="">Windows default</option>
          {list.mics.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{name(d, i, "Microphone")}</option>)}
        </select>
      </label>
      <label>Speakers
        <select value={known(prefs.speaker, list.speakers)} onChange={(e) => { callActions.useSpeaker(e.target.value); redraw((n) => n + 1); }}>
          <option value="">Windows default</option>
          {list.speakers.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{name(d, i, "Speakers")}</option>)}
        </select>
      </label>
      <label>
        <span className="cx-vol-h">Their volume <b>{Math.round(prefs.volume * 100)}%</b></span>
        <input type="range" min="0" max={MAX_VOLUME * 100} step="5" value={Math.round(prefs.volume * 100)} onChange={(e) => { callActions.setVolume(Number(e.target.value) / 100); redraw((n) => n + 1); }} aria-label="Their volume" aria-valuetext={`${Math.round(prefs.volume * 100)}%${prefs.volume > 1 ? ", boosted" : ""}`} />
        <span className="cx-vol-marks" aria-hidden="true"><span>0</span><span>100%</span><span>200%</span><span>300%</span></span>
      </label>
    </div>
  );
}

// ── Screen share: pick what to share (Added by aura-screen-share-setup.cjs) ──
function ScreenPicker({ onClose }) {
  const box = useRef(null);
  const [mode, setMode] = useState(SHARE_MODES[prefs.shareMode] ? prefs.shareMode : "auto"); // (Added by aura-quality-setup.cjs)
  const [sources, setSources] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const list = window.electronAPI?.getCaptureSources;
    if (typeof list !== "function") { setSources([]); return; }
    list().then((res) => {
      if (!alive) return;
      if (!res?.success) { setError("AURA couldn't list your screens and windows."); setSources([]); return; }
      const all = (res.sources || []).filter((s) => s && typeof s.id === "string" && /^(screen|window):/.test(s.id));
      setSources([...all.filter((s) => s.isScreen), ...all.filter((s) => !s.isScreen)]);
    }).catch(() => { if (alive) { setError("AURA couldn't list your screens and windows."); setSources([]); } });
    const away = (e) => { if (box.current && !box.current.contains(e.target) && !e.target.closest?.("[data-cx-share]")) onClose(); };
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { alive = false; document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [onClose]);
  const pick = (id) => { onClose(); callActions.shareScreen(id); };
  const screens = (sources || []).filter((s) => s.isScreen), windows = (sources || []).filter((s) => !s.isScreen);
  const tile = (s, i) => (
    <button key={s.id} type="button" className="cx-src" onClick={() => pick(s.id)} title={s.name}>
      {s.thumbnail ? <img src={s.thumbnail} alt="" draggable={false} /> : <span className="cx-src-ph"><IconScreen /></span>}
      <span className="cx-src-name">{s.isScreen && screens.length > 1 ? `Screen ${i + 1}` : s.isScreen ? "Your whole screen" : s.name}</span>
    </button>
  );
  return (
    <div className="cx-devices cx-picker" ref={box} role="dialog" aria-label="Share your screen">
      <div className="cx-picker-h">Share your screen</div>
      {/* Quality (Added by aura-quality-setup.cjs) */}
      <div className="cx-quality" role="radiogroup" aria-label="Quality">
        {Object.entries(SHARE_MODES).map(([k, m]) => (
          <button key={k} type="button" role="radio" aria-checked={mode === k} className={`cx-q ${mode === k ? "on" : ""}`} title={m.hint}
            onClick={() => { savePrefs({ shareMode: k }); setMode(k); }}>{m.label}</button>
        ))}
      </div>
      <div className="cx-picker-note cx-q-hint">{SHARE_MODES[mode].hint}</div>
      {sources === null && <div className="cx-picker-note">Looking for screens and windows…</div>}
      {error && <div className="cx-picker-note err">{error}</div>}
      {sources && !sources.length && !error && (
        <button type="button" className="cx-btn yes" onClick={() => pick("")}><IconScreen /> Share your screen</button>
      )}
      {screens.length > 0 && <div className="cx-src-grid">{screens.map(tile)}</div>}
      {windows.length > 0 && <><div className="cx-picker-sub">Or one window</div><div className="cx-src-grid">{windows.map(tile)}</div></>}
      <div className="cx-picker-note">Only the picture is shared, not the sound.</div>
    </div>
  );
}

// ── Screen share: their screen, in a corner or full screen (Added by aura-screen-share-setup.cjs, screen-share v2) ──
// Full screen fills your whole monitor. Esc, the button or double-click goes back to the corner.
function ScreenView() {
  const call = useCall();
  const box = useRef(null);
  const video = useRef(null);
  const [mode, setMode] = useState("dock"); // dock | full | hidden
  const [idle, setIdle] = useState(false);  // full screen, mouse still: the top strip fades away
  const showing = !!call && !!call.peerSharing && (call.phase === "live" || call.phase === "reconnecting");
  const stream = showing ? rtc?.remoteVideo || null : null;
  useEffect(() => { if (showing) setMode("dock"); }, [showing]);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    if (stream) v.play().catch(() => {});
  }, [stream, mode, call?.screenRev]);
  // Leaving full screen however it happens (Esc, F11, Windows) puts it back in the corner
  useEffect(() => {
    const changed = () => { if (!document.fullscreenElement) setMode((m) => (m === "full" ? "dock" : m)); };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  // Their share stopped or the call ended while it was full screen: AURA's window goes back to normal
  useEffect(() => { if (!showing && document.fullscreenElement?.classList?.contains("cx-screen")) document.exitFullscreen().catch(() => {}); }, [showing]);
  const goFull = () => {
    setMode("full");
    const el = box.current;
    // If the whole screen can't be used, it still fills AURA's window
    try { el?.requestFullscreen?.({ navigationUI: "hide" })?.catch?.(() => {}); } catch {}
  };
  const leaveFull = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); setMode("dock"); };
  useEffect(() => {
    if (mode !== "full") { setIdle(false); return; }
    let timer = null;
    const wake = () => { setIdle(false); clearTimeout(timer); timer = setTimeout(() => setIdle(true), 2500); };
    const esc = (e) => { if (e.key === "Escape") leaveFull(); };
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("keydown", esc);
    return () => { clearTimeout(timer); window.removeEventListener("mousemove", wake); window.removeEventListener("keydown", esc); };
  }, [mode]);
  if (!showing) return null;
  const name = call.peer.username;
  if (mode === "hidden") return (
    <button type="button" className="cx-screen-pill" onClick={() => setMode("dock")} aria-label={`Show ${name}'s screen`}><IconScreen /> {name} is sharing their screen <b>Show</b></button>
  );
  const full = mode === "full";
  return (
    <div ref={box} className={`cx-screen ${mode} ${idle ? "idle" : ""}`} role="region" aria-label={`${name}'s screen`}>
      <div className="cx-screen-top">
        <span className="cx-screen-name"><span className="cx-screen-dot" />{name}'s screen{full && <span className="cx-screen-hint">Press Esc to exit full screen</span>}</span>
        <button type="button" onClick={full ? leaveFull : goFull} title={full ? "Exit full screen (Esc)" : "Full screen"} aria-label={full ? "Exit full screen" : "Full screen"}>{full ? <IconShrink /> : <IconExpand />}</button>
        {!full && <button type="button" onClick={() => setMode("hidden")} title="Hide" aria-label={`Hide ${name}'s screen`}>×</button>}
      </div>
      <video ref={video} autoPlay playsInline muted onDoubleClick={full ? leaveFull : goFull} />
    </div>
  );
}

// ── Cameras, in the call box (Added by aura-call-camera-setup.cjs) ──
// Their camera, big, with yours small in its corner (mirrored, like a mirror). It hangs under the
// call box and moves with it. The arrows make it bigger; the dash tucks it away.
function CamVideo({ stream, rev, mirror, className }) {
  const v = useRef(null);
  useEffect(() => { const el = v.current; if (!el) return; if (el.srcObject !== stream) el.srcObject = stream || null; if (stream) el.play().catch(() => {}); }, [stream, rev]);
  return <video ref={v} className={className} autoPlay playsInline muted style={mirror ? { transform: "scaleX(-1)" } : undefined} />;
}
function CallCams({ call }) {
  const [big, setBig] = useState(false);
  const [hidden, setHidden] = useState(false);
  const theirs = call.peerCamOn ? rtc?.remoteCam || null : null;
  const mine = call.camOn ? rtc?.cam || null : null;
  if (!theirs && !mine) return null;
  const name = call.peer.username;
  if (hidden) return (
    <button type="button" className="cx-cams-pill" onClick={() => setHidden(false)} aria-label="Show the cameras">{theirs ? `${name}'s camera` : "Your camera"} <b>Show</b></button>
  );
  return (
    <div className={`cx-cams ${theirs ? "two" : "solo"} ${big ? "big" : ""}`} role="region" aria-label="Cameras">
      {theirs
        ? <><CamVideo className="cx-cam-theirs" stream={theirs} rev={call.camRev} /><span className="cx-cam-name">{name}</span>{mine && <CamVideo className="cx-cam-mine small" stream={mine} rev={call.camRev} mirror />}</>
        : <><CamVideo className="cx-cam-mine" stream={mine} rev={call.camRev} mirror /><span className="cx-cam-name">You</span></>}
      <div className="cx-cam-tools">
        {theirs && <button type="button" onClick={() => setBig((b) => !b)} title={big ? "Smaller" : "Bigger"} aria-label={big ? "Make the camera smaller" : "Make the camera bigger"}><IconExpandCam /></button>}
        <button type="button" onClick={() => setHidden(true)} title="Hide the cameras" aria-label="Hide the cameras">–</button>
      </div>
    </div>
  );
}

// ── The call screen (Added by aura-call-screen-setup.cjs) ──
// The whole monitor for a call: a big tile for each of you, showing the camera when it's on and
// the profile picture when it isn't (with a green ring while that person talks). When they share
// their screen it takes the middle, with both of you at the side. The call buttons are along the
// bottom. Esc, or the button, goes back to the call box.
function myself() {
  try { const p = JSON.parse(localStorage.getItem("aura_profile") || "null") || {}; return { userId: p.userId || "me", username: p.username || "You", avatarUrl: p.avatarUrl || p.avatar || "" }; }
  catch { return { userId: "me", username: "You", avatarUrl: "" }; }
}
function StageVideo({ stream, rev, mirror, contain }) {
  const v = useRef(null);
  useEffect(() => { const el = v.current; if (!el) return; if (el.srcObject !== stream) el.srcObject = stream || null; if (stream) el.play().catch(() => {}); }, [stream, rev]);
  return <video ref={v} autoPlay playsInline muted style={{ transform: mirror ? "scaleX(-1)" : undefined, objectFit: contain ? "contain" : "cover" }} />;
}
function StageTile({ who, person, stream, rev, mirror, muted, sharing }) {
  return (
    <div className={`cx-tile ${who} ${stream ? "cam" : ""}`} role="group" aria-label={who === "me" ? "You" : person.username}>
      {stream ? <StageVideo stream={stream} rev={rev} mirror={mirror} /> : <Face person={person} size={128} />}
      <span className="cx-tile-name">
        {muted && <span className="cx-tile-muted" title={who === "me" ? "You're muted" : `${person.username} is muted`}><IconMicOff /></span>}
        {who === "me" ? "You" : person.username}{sharing && <span className="cx-tile-sharing"> · sharing</span>}
      </span>
    </div>
  );
}
// Full screen has to be asked for in the click itself (a moment later, Windows and newer browsers say no),
// so the call layer (which the call screen is drawn into) goes full screen as the button is pressed
function fullCallLayer() {
  const host = document.getElementById("aura-call-layer");
  try { if (host && document.fullscreenElement !== host) host.requestFullscreen?.({ navigationUI: "hide" })?.catch?.(() => {}); } catch {}
}
function CallStage() {
  const call = useCall();
  const box = useRef(null);
  const [picker, setPicker] = useState(false);
  const open = !!call && !!call.stage && (call.phase === "live" || call.phase === "reconnecting");
  // It fills the whole monitor (asked for right at the click, see fullCallLayer); if Windows won't, it still fills AURA's window
  useEffect(() => {
    if (!open) { setPicker(false); return; }
    const el = document.getElementById("aura-call-layer");
    let wasFull = !!el && document.fullscreenElement === el;
    const changed = () => { if (document.fullscreenElement === el) wasFull = true; else if (wasFull) callActions.closeStage(); };
    const esc = (e) => { if (e.key === "Escape") callActions.closeStage(); };
    document.addEventListener("fullscreenchange", changed);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      window.removeEventListener("keydown", esc);
      if (document.fullscreenElement === el) document.exitFullscreen().catch(() => {});
    };
  }, [open]);
  // The green rings follow your voices
  useEffect(() => meter.watch((me, peer) => {
    const el = box.current;
    if (!el) return;
    el.style.setProperty("--cx-me", me.toFixed(2));
    el.style.setProperty("--cx-peer", peer.toFixed(2));
  }), [open]);
  if (!open) return null;
  const name = call.peer.username;
  const theirCam = call.peerCamOn ? rtc?.remoteCam || null : null;
  const myCam = call.camOn ? rtc?.cam || null : null;
  const screen = call.peerSharing ? rtc?.remoteVideo || null : null;
  return (
    <div ref={box} className={`cx-stage ${screen ? "with-screen" : ""}`} role="dialog" aria-label={`Call with ${name}`}>
      <div className="cx-stage-top">
        <span className="cx-stage-dot" />
        <span className="cx-stage-name">{name}</span>
        <span className="cx-stage-time">{call.phase === "reconnecting" ? "Reconnecting…" : <Clock since={call.since} />}</span>
        <span className="cx-stage-hint">Press Esc to go back</span>
      </div>
      <div className="cx-stage-main">
        {screen && <div className="cx-stage-screen" aria-label={`${name}'s screen`}><StageVideo stream={screen} rev={call.screenRev} contain /></div>}
        <div className="cx-tiles">
          <StageTile who="them" person={call.peer} stream={theirCam} rev={call.camRev} muted={call.peerMuted} sharing={!!screen} />
          <StageTile who="me" person={myself()} stream={myCam} rev={call.camRev} mirror muted={call.muted} sharing={!!call.sharing} />
        </div>
      </div>
      <div className="cx-stage-bar">
        <button type="button" className={`cx-round mic ${call.muted ? "on" : ""}`} onClick={callActions.toggleMute} aria-pressed={call.muted} title={call.muted ? "Unmute your microphone" : "Mute your microphone"} aria-label={call.muted ? "Unmute your microphone" : "Mute your microphone"}>{call.muted ? <IconMicOff /> : <IconMic />}</button>
        <button type="button" className={`cx-round cam ${call.camOn ? "on" : ""}`} disabled={!call.canCam || call.camStarting} aria-pressed={!!call.camOn}
          onClick={() => (call.camOn ? callActions.stopCamera() : callActions.startCamera())}
          title={!call.canCam ? "Camera needs both of you on the latest AURA" : call.camOn ? "Turn your camera off" : "Turn your camera on"}
          aria-label={!call.canCam ? "Camera isn't available on this call" : call.camOn ? "Turn your camera off" : "Turn your camera on"}><IconCam /></button>
        {call.sharing
          ? <button type="button" className="cx-round share on" onClick={() => { setPicker(false); callActions.stopScreen(); }} title="Stop sharing your screen" aria-label="Stop sharing your screen"><IconScreen /></button>
          : <button type="button" className={`cx-round share ${picker ? "open" : ""}`} data-cx-share disabled={!call.canShare} onClick={() => setPicker((v) => !v)} aria-expanded={picker}
              title={call.canShare ? "Share your screen" : "Screen share needs both of you on the latest AURA"} aria-label={call.canShare ? "Share your screen" : "Screen share isn't available on this call"}><IconScreen /></button>}
        <button type="button" className="cx-round end" onClick={callActions.hangUp} title="Hang up" aria-label="Hang up"><IconHangUp /></button>
        <button type="button" className="cx-round leave" onClick={callActions.closeStage} title="Back to the call box (Esc)" aria-label="Leave the call screen"><IconShrink /></button>
        {picker && !call.sharing && <ScreenPicker onClose={() => setPicker(false)} />}
      </div>
    </div>
  );
}

// The call bar: sits at the top of the window for as long as a call is ringing or going on
// Where the call bar sits. Left alone it is at the top in the middle; dragged, it stays where you
// put it (remembered as a share of the window, so it lands in the same place if the window changes
// size), and it is always kept fully on screen.
const EDGE = 8;
function placeBar(el, pos) {
  if (!el) return;
  // (the page is told too, so Messages only leaves room at the top while the bar is there)
  if (!pos) { el.classList.remove("moved", "low"); el.style.left = ""; el.style.top = ""; document.documentElement.classList.remove("cx-moved"); return; }
  const W = window.innerWidth, H = window.innerHeight, w = el.offsetWidth, h = el.offsetHeight;
  const left = Math.round(Math.min(Math.max(pos.x * W - w / 2, EDGE), Math.max(EDGE, W - w - EDGE)));
  const top = Math.round(Math.min(Math.max(pos.y * H, EDGE), Math.max(EDGE, H - h - EDGE)));
  el.classList.add("moved");
  document.documentElement.classList.add("cx-moved");
  el.classList.toggle("low", top + h / 2 > H / 2); // in the lower half, call settings open upwards
  el.style.left = left + "px";
  el.style.top = top + "px";
}

function CallBar() {
  const call = useCall();
  const bar = useRef(null);
  const drag = useRef(null);
  const [devices, setDevices] = useState(false);
  const [picker, setPicker] = useState(false); // choosing what to share
  const active = !!call && (call.phase === "live" || call.phase === "reconnecting");
  useEffect(() => { if (!active) { setDevices(false); setPicker(false); } }, [active]);
  // The ring around your friend's picture follows their voice; the microphone button follows yours
  useEffect(() => meter.watch((me, peer) => {
    const el = bar.current;
    if (!el) return;
    el.style.setProperty("--cx-me", me.toFixed(2));
    el.style.setProperty("--cx-peer", peer.toFixed(2));
  }), []);
  // Keep it where you put it as the window, or the bar itself, changes size
  const showing = !!call;
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const again = () => { if (!drag.current) placeBar(el, prefs.pos); };
    again();
    const watch = typeof ResizeObserver === "function" ? new ResizeObserver(again) : null;
    watch?.observe(el);
    window.addEventListener("resize", again);
    return () => { watch?.disconnect(); window.removeEventListener("resize", again); document.documentElement.classList.remove("cx-moved"); };
  }, [showing]);

  // Dragging: from the grip, or from any part of the bar that isn't a button
  const remember = (el) => {
    const r = el.getBoundingClientRect();
    savePrefs({ pos: { x: (r.left + r.width / 2) / window.innerWidth, y: r.top / window.innerHeight } });
  };
  // While dragging, the whole window is watched, so a quick flick that leaves the bar still moves it
  const onPointerDown = (e) => {
    if (e.button !== 0 || e.target.closest("button:not(.cx-grip),select,input,.cx-devices")) return;
    const el = bar.current;
    const r = el.getBoundingClientRect();
    const d = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, moved: false };
    const move = (ev) => {
      if (ev.pointerId !== d.id || drag.current !== d) return;
      if (!d.moved && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 4) return; // a click, not a drag
      d.moved = true;
      el.classList.add("dragging");
      placeBar(el, { x: (ev.clientX - d.dx + el.offsetWidth / 2) / window.innerWidth, y: (ev.clientY - d.dy) / window.innerHeight });
    };
    const up = (ev) => {
      if (ev.pointerId !== d.id) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (drag.current === d) drag.current = null;
      el.classList.remove("dragging");
      if (d.moved) remember(el);
    };
    drag.current = d;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  const putBack = () => { savePrefs({ pos: null }); placeBar(bar.current, null); };
  // The grip also works from the keyboard: arrow keys move it, Home puts it back
  const onGripKey = (e) => {
    const el = bar.current;
    const step = e.shiftKey ? 60 : 20;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (e.key === "Home") { e.preventDefault(); putBack(); return; }
    if (!move) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    placeBar(el, { x: (r.left + r.width / 2 + move[0]) / window.innerWidth, y: (r.top + move[1]) / window.innerHeight });
    remember(el);
  };

  if (!call) return null;
  const name = call.peer.username;
  const ringingIn = !call.outgoing && call.phase === "ringing";
  const status = call.phase === "over" ? call.note
    : call.phase === "starting" ? "Starting call…"
    : call.phase === "ringing" ? (call.outgoing ? "Calling…" : "Incoming voice call")
    : call.phase === "connecting" ? "Connecting…"
    : call.phase === "reconnecting" ? "Reconnecting…"
    : null;
  return (
    <div ref={bar} className={`cx-bar ${call.phase} ${call.outgoing ? "out" : "in"} ${call.muted ? "muted" : ""}`} role="region" aria-label={`Voice call with ${name}`}
      onPointerDown={onPointerDown}>
      <button type="button" className="cx-grip" onDoubleClick={putBack} onKeyDown={onGripKey} title="Drag to move. Double-click to put it back at the top." aria-label="Move the call bar. Arrow keys move it, Home puts it back at the top."><IconGrip /></button>
      {/* Until you accept, only the caller's initial shows: their picture isn't fetched for a call you haven't taken */}
      <Face person={ringingIn ? { ...call.peer, avatarUrl: "" } : call.peer} size={34} />
      <div className="cx-who">
        <div className="cx-name">{name}{active && call.peerMuted && <span className="cx-peer-muted" title={`${name} is muted`}><IconMicOff /><span className="cx-sr">{name} is muted</span></span>}</div>
        <div className="cx-status" role="status" aria-live="polite">{status ?? <><Clock since={call.since} />{call.sharing ? <span className="cx-sharing"> · Sharing your screen</span> : call.camOn ? <span className="cx-sharing"> · Camera on</span> : call.muted && <span> · You're muted</span>}</>}</div>
      </div>
      {ringingIn && (
        <div className="cx-acts">
          <button type="button" className="cx-btn no" onClick={callActions.decline}>Decline</button>
          <button type="button" className="cx-btn yes" onClick={callActions.accept} disabled={call.busy}><IconPhone size={15} /> {call.busy ? "Accepting…" : "Accept"}</button>
        </div>
      )}
      {!ringingIn && (call.phase === "starting" || call.phase === "ringing" || call.phase === "connecting") && (
        <div className="cx-acts"><button type="button" className="cx-btn no" onClick={callActions.hangUp}>{call.phase === "connecting" ? "Hang up" : "Cancel"}</button></div>
      )}
      {active && (
        <div className="cx-acts">
          <button type="button" className={`cx-round mic ${call.muted ? "on" : ""}`} onClick={callActions.toggleMute} aria-pressed={call.muted} title={call.muted ? "Unmute your microphone" : "Mute your microphone"} aria-label={call.muted ? "Unmute your microphone" : "Mute your microphone"}>{call.muted ? <IconMicOff /> : <IconMic />}</button>
          {call.sharing
            ? <button type="button" className="cx-round share on" onClick={() => { setPicker(false); callActions.stopScreen(); }} title="Stop sharing your screen" aria-label="Stop sharing your screen"><IconScreen /></button>
            : <button type="button" className={`cx-round share ${picker ? "open" : ""}`} data-cx-share disabled={!call.canShare} onClick={() => { setDevices(false); setPicker((v) => !v); }} aria-expanded={picker}
                title={call.canShare ? "Share your screen" : `Screen share needs both of you on the latest AURA`} aria-label={call.canShare ? "Share your screen" : "Screen share isn't available on this call"}><IconScreen /></button>}
          {/* Your camera (Added by aura-call-camera-setup.cjs) */}
          <button type="button" className={`cx-round cam ${call.camOn ? "on" : ""}`} disabled={!call.canCam || call.camStarting} aria-pressed={!!call.camOn}
            onClick={() => (call.camOn ? callActions.stopCamera() : callActions.startCamera())}
            title={!call.canCam ? "Camera needs both of you on the latest AURA" : call.camOn ? "Turn your camera off" : "Turn your camera on"}
            aria-label={!call.canCam ? "Camera isn't available on this call" : call.camOn ? "Turn your camera off" : "Turn your camera on"}><IconCam /></button>
          <button type="button" className={`cx-round ${devices ? "on" : ""}`} data-cx-devices onClick={() => { setPicker(false); setDevices((v) => !v); }} aria-expanded={devices} title="Microphone, speakers and volume" aria-label="Microphone, speakers and volume"><IconSliders /></button>
          <button type="button" className="cx-round stage" onClick={() => { setDevices(false); setPicker(false); fullCallLayer(); callActions.openStage(); }} title="Open the call screen" aria-label="Open the call screen"><IconExpand /></button>{/* (Added by aura-call-screen-setup.cjs) */}
          <button type="button" className="cx-round end" onClick={callActions.hangUp} title="Hang up" aria-label="Hang up"><IconHangUp /></button>
        </div>
      )}
      {active && <CallCams call={call} />}
      {devices && active && <Devices onClose={() => setDevices(false)} />}
      {picker && active && !call.sharing && <ScreenPicker onClose={() => setPicker(false)} />}
    </div>
  );
}

// A button that calls one person. Give it the classes of the buttons around it.
export function CallButton({ person, className = "", children, label }) {
  const call = useCall();
  useEffect(() => { ensureStyles(); }, []);
  if (!callsAvailable()) return null;
  const busy = !!call && call.phase !== "over";
  const withThem = busy && call.peer.userId === person.userId;
  const say = withThem ? `You're in a call with ${person.username}` : busy ? "You're already in a call" : label || `Call ${person.username}`;
  return (
    <button type="button" className={`${className} cx-call ${withThem ? "in-call" : ""}`} disabled={busy} onClick={(e) => { e.stopPropagation(); callActions.start(person); }} title={say} aria-label={say}>
      {typeof children === "function" ? children({ withThem, busy }) : children ?? <IconPhone size={15} />}
    </button>
  );
}

const CSS = `
.cx-bar{position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:9600;display:flex;align-items:center;gap:10px;height:48px;max-width:calc(100vw - 24px);padding:0 7px;border-radius:999px;
  font-family:'DM Sans',sans-serif;color:var(--t1,#fff);background:color-mix(in srgb,var(--panel,#1a1f26) 88%,transparent);backdrop-filter:blur(18px) saturate(140%);
  border:1px solid var(--borderb,rgba(255,255,255,.18));box-shadow:0 10px 34px rgba(0,0,0,.5);animation:cx-drop .2s ease-out;--cx-me:0;--cx-peer:0}
.cx-bar *{box-sizing:border-box}
/* Moving it */
.cx-bar.moved{transform:none;animation:cx-pop .18s ease-out}
.cx-bar.moved.ringing.in{animation:cx-pop .18s ease-out,cx-glow 1.3s ease-in-out .2s infinite alternate}
@keyframes cx-pop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}
.cx-bar.dragging{cursor:grabbing;user-select:none;box-shadow:0 18px 50px rgba(0,0,0,.6)}
.cx-bar .cx-who{cursor:grab}
.cx-bar.dragging .cx-who{cursor:grabbing}
.cx-grip{width:16px;height:30px;margin-right:-6px;flex-shrink:0;display:flex;align-items:center;justify-content:center;padding:0;border:none;border-radius:6px;background:transparent;cursor:grab;color:var(--t3,rgba(255,255,255,.4));touch-action:none}
.cx-grip:hover{color:var(--t1,#fff);background:rgba(255,255,255,.08)}
.cx-bar.dragging .cx-grip{cursor:grabbing}
.cx-bar.low .cx-devices{top:auto;bottom:56px}
@keyframes cx-drop{from{opacity:0;transform:translate(-50%,-14px)}to{opacity:1;transform:translate(-50%,0)}}
.cx-bar.ringing.in{border-color:color-mix(in srgb,var(--ac,#FF5722) 75%,transparent);animation:cx-drop .2s ease-out,cx-glow 1.3s ease-in-out .2s infinite alternate}
@keyframes cx-glow{from{box-shadow:0 10px 34px rgba(0,0,0,.5),0 0 0 0 color-mix(in srgb,var(--ac,#FF5722) 50%,transparent)}to{box-shadow:0 10px 34px rgba(0,0,0,.5),0 0 0 7px color-mix(in srgb,var(--ac,#FF5722) 0%,transparent)}}
.cx-face{position:relative;display:inline-flex;flex-shrink:0;border-radius:50%;transition:box-shadow .09s linear;box-shadow:0 0 0 calc(var(--cx-peer) * 5px) rgba(61,220,132,.8)}
.cx-face img,.cx-face>span{width:100%;height:100%;border-radius:50%;object-fit:cover}
.cx-face>span{display:flex;align-items:center;justify-content:center;font-family:'Rajdhani',sans-serif;font-weight:700;color:#fff;background:linear-gradient(135deg,var(--ac,#FF5722),var(--ac2,#ff8a65))}
.cx-who{min-width:96px;max-width:210px;display:flex;flex-direction:column;justify-content:center}
.cx-name{display:flex;align-items:center;gap:6px;font-family:'Rajdhani',sans-serif;font-size:16.5px;font-weight:700;letter-spacing:.3px;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cx-peer-muted{display:inline-flex;color:var(--t2,#9aa0aa)}
.cx-peer-muted svg{width:13px;height:13px}
.cx-status{font-size:11.5px;line-height:1.3;color:var(--t2,#9aa0aa);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.cx-bar.live .cx-status{color:#3ddc84}
.cx-bar.over .cx-who{max-width:340px;padding-right:10px}
.cx-acts{display:flex;align-items:center;gap:6px;margin-left:4px}
.cx-btn{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 15px;border-radius:999px;border:1px solid transparent;cursor:pointer;font:600 12.5px 'DM Sans',sans-serif;white-space:nowrap;color:#fff}
.cx-btn.yes{background:#15803d}
.cx-btn.yes:hover:not(:disabled){background:#16934a}
.cx-btn.no{background:rgba(220,38,38,.16);border-color:rgba(248,113,113,.55);color:#fecaca}
.cx-btn.no:hover{background:#dc2626;border-color:#dc2626;color:#fff}
.cx-btn:disabled{opacity:.7;cursor:default}
.cx-round{width:34px;height:34px;flex-shrink:0;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(255,255,255,.07);border:1px solid var(--border,rgba(255,255,255,.14));color:var(--t1,#fff);transition:background .15s}
.cx-round:hover,.cx-round.on{background:rgba(255,255,255,.16)}
.cx-round.mic{box-shadow:0 0 0 calc(var(--cx-me) * 4px) rgba(61,220,132,.7);transition:box-shadow .09s linear,background .15s}
.cx-round.mic.on{background:#fff;color:#111;box-shadow:none}
.cx-round.end{background:#dc2626;border-color:#dc2626;color:#fff}
.cx-round.end:hover{background:#ef4444}
.cx-bar button:focus-visible,.cx-devices select:focus-visible,.cx-devices input:focus-visible,.cx-call:focus-visible{outline:2px solid var(--ac2,var(--ac,#ff8a65));outline-offset:2px}
.cx-devices{position:absolute;top:56px;right:0;width:270px;display:flex;flex-direction:column;gap:12px;padding:14px;border-radius:14px;background:var(--panel,#1a1f26);border:1px solid var(--borderb,rgba(255,255,255,.16));box-shadow:0 20px 50px rgba(0,0,0,.55)}
.cx-devices label{display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:600;color:var(--t1,#fff)}
.cx-devices select{width:100%;padding:7px 8px;border-radius:8px;font:12.5px 'DM Sans',sans-serif;background:var(--card,#2D4059);border:1px solid var(--border,rgba(255,255,255,.14));color:var(--t1,#fff)}
.cx-devices input[type=range]{width:100%;accent-color:var(--ac,#FF5722)}
.cx-vol-h{display:flex;justify-content:space-between;align-items:baseline}
.cx-vol-h b{font-weight:600;font-variant-numeric:tabular-nums;color:var(--t2,rgba(255,255,255,.7))}
.cx-vol-marks{display:flex;justify-content:space-between;margin-top:-2px;font-size:10px;font-weight:500;color:var(--t3,rgba(255,255,255,.45));font-variant-numeric:tabular-nums}
.cx-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.cx-call{display:inline-flex;align-items:center;justify-content:center;gap:6px}
.cx-call.in-call:disabled{opacity:1;color:#3ddc84!important}
/* While a stream fills the window, only the strip along the top is free: the bar slims down to fit it */
:root:has(.stream-full-bar) .cx-bar{top:4px;height:36px;gap:8px;padding:0 4px}
:root:has(.stream-full-bar) .cx-bar .cx-face{width:26px!important;height:26px!important;font-size:12px!important}
:root:has(.stream-full-bar) .cx-bar .cx-status{display:none}
:root:has(.stream-full-bar) .cx-bar.over .cx-status{display:block}
:root:has(.stream-full-bar) .cx-bar.over .cx-name{display:none}
:root:has(.stream-full-bar) .cx-btn,:root:has(.stream-full-bar) .cx-round{height:28px}
:root:has(.stream-full-bar) .cx-round{width:28px}
:root:has(.stream-full-bar) .cx-devices{top:42px}
/* The call screen (Added by aura-call-screen-setup.cjs) */
.cx-round.stage.on{background:rgba(255,255,255,.16)}
#aura-call-layer:fullscreen{background:#0b0b0e}
.cx-stage{position:fixed;inset:0;z-index:9620;display:flex;flex-direction:column;background:radial-gradient(120% 90% at 50% 0%,color-mix(in srgb,var(--ac,#FF5722) 10%,#111116) 0%,#0b0b0e 70%);color:var(--t1,#fff);font-family:'DM Sans',sans-serif;--cx-me:0;--cx-peer:0}
.cx-stage *{box-sizing:border-box}
.cx-stage-top{display:flex;align-items:center;gap:10px;padding:16px 22px;flex-shrink:0}
.cx-stage-dot{width:9px;height:9px;border-radius:50%;background:#3ddc84;box-shadow:0 0 8px #3ddc84}
.cx-stage-name{font-family:'Rajdhani',sans-serif;font-size:20px;font-weight:700;letter-spacing:.4px}
.cx-stage-time{font-size:13px;color:#3ddc84;font-variant-numeric:tabular-nums}
.cx-stage-hint{margin-left:auto;font-size:12px;color:var(--t3,rgba(255,255,255,.45))}
.cx-stage-main{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;gap:16px;padding:0 22px}
.cx-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;width:100%;max-width:min(1600px,calc((100vh - 190px) * 32 / 9 + 16px))}
.cx-stage.with-screen .cx-tiles{grid-template-columns:1fr;width:min(320px,26vw);flex-shrink:0;max-width:none}
.cx-stage-screen{flex:1;min-width:0;height:100%;border-radius:16px;overflow:hidden;background:#000;border:1px solid rgba(255,255,255,.1)}
.cx-stage-screen video{width:100%;height:100%;display:block;background:#000}
.cx-tile{position:relative;aspect-ratio:16/9;border-radius:18px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#20202a,#131319);border:1px solid rgba(255,255,255,.08)}
.cx-tile.them{box-shadow:0 0 0 calc(var(--cx-peer) * 4px) rgba(61,220,132,.85)}
.cx-tile.me{box-shadow:0 0 0 calc(var(--cx-me) * 4px) rgba(61,220,132,.85)}
.cx-tile video{position:absolute;inset:0;width:100%;height:100%;background:#000}
.cx-tile .cx-face{box-shadow:0 0 0 calc(var(--cx-peer) * 10px) rgba(61,220,132,.8)}
.cx-tile.me .cx-face{box-shadow:0 0 0 calc(var(--cx-me) * 10px) rgba(61,220,132,.8)}
.cx-stage.with-screen .cx-tile .cx-face{width:72px!important;height:72px!important;font-size:30px!important}
.cx-tile-name{position:absolute;left:12px;bottom:12px;display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:rgba(0,0,0,.6);font-size:13px;font-weight:600}
.cx-tile-muted{display:inline-flex;color:#fca5a5}
.cx-tile-muted svg{width:14px;height:14px}
.cx-tile-sharing{color:#3ddc84;font-weight:500}
.cx-stage-bar{position:relative;display:flex;align-items:center;justify-content:center;gap:12px;padding:18px;flex-shrink:0}
.cx-stage-bar .cx-round{width:50px;height:50px}
.cx-stage-bar .cx-round svg{width:21px;height:21px}
.cx-stage-bar .cx-round.leave{margin-left:18px}
.cx-stage .cx-picker{top:auto;right:auto;bottom:84px;left:50%;transform:translateX(-50%)}
.cx-stage button:focus-visible{outline:2px solid var(--ac2,var(--ac,#ff8a65));outline-offset:2px}
:root:has(.cx-stage) .cx-bar,:root:has(.cx-stage) .cx-screen,:root:has(.cx-stage) .cx-screen-pill{display:none}
@media (max-width:760px){.cx-tiles{grid-template-columns:1fr}.cx-stage.with-screen .cx-stage-main{flex-direction:column}.cx-stage.with-screen .cx-tiles{width:100%;grid-template-columns:1fr 1fr}}
/* Cameras in calls (Added by aura-call-camera-setup.cjs) */
.cx-round.cam:disabled{opacity:.4;cursor:default}
.cx-round.cam.on{background:#3ddc84;border-color:#3ddc84;color:#06240f}
.cx-round.cam.on:hover{background:#dc2626;border-color:#dc2626;color:#fff}
.cx-cams{position:absolute;top:56px;left:50%;transform:translateX(-50%);width:340px;aspect-ratio:16/9;border-radius:14px;overflow:hidden;background:#000;border:1px solid var(--borderb,rgba(255,255,255,.18));box-shadow:0 20px 50px rgba(0,0,0,.55);cursor:grab}
.cx-cams.solo{width:200px}
.cx-cams.big{width:min(640px,calc(100vw - 24px))}
.cx-bar.low .cx-cams{top:auto;bottom:56px}
.cx-cams video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000}
.cx-cams video.small{inset:auto 8px 8px auto;width:28%;height:auto;aspect-ratio:16/9;border-radius:8px;border:1px solid rgba(255,255,255,.3);box-shadow:0 6px 18px rgba(0,0,0,.5)}
.cx-cam-name{position:absolute;left:8px;bottom:8px;padding:2px 8px;border-radius:999px;background:rgba(0,0,0,.55);font-size:11.5px;font-weight:600;color:#fff}
.cx-cam-tools{position:absolute;top:6px;right:6px;display:flex;gap:4px;opacity:0;transition:opacity .15s}
.cx-cams:hover .cx-cam-tools,.cx-cams:focus-within .cx-cam-tools{opacity:1}
.cx-cam-tools button{width:26px;height:26px;border-radius:7px;border:none;background:rgba(0,0,0,.6);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:15px;line-height:1}
.cx-cam-tools button:hover{background:rgba(0,0,0,.85)}
.cx-cams-pill{position:absolute;top:56px;left:50%;transform:translateX(-50%);white-space:nowrap;display:flex;align-items:center;gap:8px;height:32px;padding:0 12px;border-radius:999px;border:1px solid var(--borderb,rgba(255,255,255,.18));background:var(--panel,#1a1f26);color:var(--t1,#fff);font:500 12px 'DM Sans',sans-serif;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.5)}
.cx-bar.low .cx-cams-pill{top:auto;bottom:56px}
.cx-cams-pill b{color:#3ddc84;font-weight:600}
.cx-cam-tools button:focus-visible,.cx-cams-pill:focus-visible{outline:2px solid var(--ac2,var(--ac,#ff8a65));outline-offset:2px;opacity:1}
/* Screen share (Added by aura-screen-share-setup.cjs) */
.cx-round.share:disabled{opacity:.4;cursor:default}
.cx-round.share.open{background:rgba(255,255,255,.16)}
.cx-round.share.on{background:#3ddc84;border-color:#3ddc84;color:#06240f}
.cx-round.share.on:hover{background:#dc2626;border-color:#dc2626;color:#fff}
.cx-sharing{color:#3ddc84}
.cx-picker{width:440px;max-height:min(520px,calc(100vh - 90px));overflow-y:auto}
.cx-bar.low .cx-picker{max-height:min(520px,calc(100vh - 90px))}
.cx-picker-h{font-family:'Rajdhani',sans-serif;font-size:16px;font-weight:700;letter-spacing:.3px}
.cx-picker-sub{font-size:12px;font-weight:600;color:var(--t2,#9aa0aa);margin-top:2px}
.cx-picker-note{font-size:11.5px;color:var(--t2,#9aa0aa)}
.cx-picker-note.err{color:#fca5a5}
/* Screen share quality (Added by aura-quality-setup.cjs) */
.cx-quality{display:flex;gap:4px;padding:3px;border-radius:10px;background:rgba(255,255,255,.06);border:1px solid var(--border,rgba(255,255,255,.14))}
.cx-q{flex:1;height:30px;border:none;border-radius:7px;background:transparent;color:var(--t2,#9aa0aa);font:600 12px 'DM Sans',sans-serif;cursor:pointer}
.cx-q:hover{color:var(--t1,#fff);background:rgba(255,255,255,.06)}
.cx-q.on{background:var(--ac,#FF5722);color:#fff}
.cx-q:focus-visible{outline:2px solid var(--ac2,var(--ac,#ff8a65));outline-offset:2px}
.cx-q-hint{margin-top:-6px}
.cx-src-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.cx-src{display:flex;flex-direction:column;gap:6px;padding:6px;border-radius:10px;border:1px solid var(--border,rgba(255,255,255,.14));background:rgba(255,255,255,.04);color:var(--t1,#fff);cursor:pointer;text-align:left;font:500 12px 'DM Sans',sans-serif;min-width:0}
.cx-src:hover,.cx-src:focus-visible{border-color:var(--ac,#FF5722);background:rgba(255,255,255,.08)}
.cx-src img,.cx-src-ph{width:100%;aspect-ratio:16/9;object-fit:contain;border-radius:6px;background:#000;display:flex;align-items:center;justify-content:center;color:var(--t3,rgba(255,255,255,.45))}
.cx-src-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cx-screen{position:fixed;right:16px;bottom:16px;z-index:9550;width:min(480px,calc(100vw - 32px));border-radius:14px;overflow:hidden;background:#000;border:1px solid var(--borderb,rgba(255,255,255,.18));box-shadow:0 20px 50px rgba(0,0,0,.6);display:flex;flex-direction:column;font-family:'DM Sans',sans-serif}
.cx-screen video{display:block;width:100%;aspect-ratio:16/9;background:#000;object-fit:contain}
.cx-screen.full{inset:0;width:auto;border-radius:0;border:none;z-index:9590}
.cx-screen.full video{flex:1;aspect-ratio:auto;height:0;min-height:0}
.cx-screen-top{display:flex;align-items:center;gap:6px;padding:6px 8px 6px 12px;background:color-mix(in srgb,var(--panel,#1a1f26) 92%,transparent);color:var(--t1,#fff)}
.cx-screen.full .cx-screen-top{padding-top:62px}
:root.cx-moved .cx-screen.full .cx-screen-top{padding-top:6px}
.cx-screen-name{flex:1;min-width:0;display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cx-screen-dot{width:8px;height:8px;border-radius:50%;background:#3ddc84;flex-shrink:0}
.cx-screen-top button{width:28px;height:28px;border-radius:8px;border:none;background:transparent;color:var(--t2,#9aa0aa);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;line-height:1}
.cx-screen-top button:hover,.cx-screen-top button:focus-visible{background:rgba(255,255,255,.1);color:var(--t1,#fff)}
.cx-screen-pill{position:fixed;right:16px;bottom:16px;z-index:9550;display:flex;align-items:center;gap:8px;height:38px;padding:0 14px;border-radius:999px;border:1px solid var(--borderb,rgba(255,255,255,.18));background:var(--panel,#1a1f26);color:var(--t1,#fff);font:500 12.5px 'DM Sans',sans-serif;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.5)}
.cx-screen-pill b{color:#3ddc84;font-weight:600}
.cx-screen-top button:focus-visible,.cx-screen-pill:focus-visible,.cx-src:focus-visible{outline:2px solid var(--ac2,var(--ac,#ff8a65));outline-offset:2px}
/* Full screen fills the monitor (screen-share v2) */
.cx-screen:fullscreen{inset:0;width:100vw;height:100vh;max-width:none;border-radius:0;border:none;box-shadow:none}
.cx-screen:fullscreen video,.cx-screen.full video{flex:1;aspect-ratio:auto;height:0;min-height:0}
.cx-screen:fullscreen .cx-screen-top{padding-top:6px}
.cx-screen.full .cx-screen-top{transition:opacity .25s}
.cx-screen.full.idle .cx-screen-top{opacity:0}
.cx-screen.full.idle{cursor:none}
.cx-screen-hint{font-weight:400;color:var(--t2,#9aa0aa);margin-left:6px}
.reduce-motion .cx-bar,.reduce-motion .cx-bar.ringing.in,.reduce-motion .cx-bar.moved{animation:none}
@media (prefers-reduced-motion:reduce){.cx-bar,.cx-bar.ringing.in,.cx-bar.moved{animation:none}}
`;
function ensureStyles() {
  if (document.getElementById("aura-cx-styles")) return;
  const el = document.createElement("style");
  el.id = "aura-cx-styles";
  el.textContent = CSS;
  document.head.appendChild(el);
}

// Puts the call bar on the window. Returns the function that takes it away again.
export function mountCallLayer() {
  ensureStyles();
  const host = document.createElement("div");
  host.id = "aura-call-layer";
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(<><CallBar /><ScreenView /><CallStage /></>); // (call screen: Added by aura-call-screen-setup.cjs)
  const leaving = () => callActions.reset(); // AURA is closing or reloading: hang up
  window.addEventListener("beforeunload", leaving);
  return () => {
    window.removeEventListener("beforeunload", leaving);
    callActions.reset();
    setTimeout(() => { try { root.unmount(); } catch {} host.remove(); }, 0);
  };
}
