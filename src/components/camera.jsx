// The camera: a floating preview inside AURA, and (if you switch it on) your camera in a corner
// of the clips you record. Added by aura-camera-setup.cjs
//
//   CameraButton     the Camera item in the side menu (opens the preview and turns the camera on)
//   CameraPanel      the floating preview: drag it by its top bar, resize it from the corner
//   CameraSettings   the Camera section in Settings
//   cameraOverlay    puts the camera in a corner of a recording's picture (only while it's on)
//
// The camera only turns on when you press something that says so. Nothing is saved or sent
// anywhere: the picture stays on this PC, and only goes into a clip you record yourself.
import { useEffect, useRef, useState } from "react";
import { BACKGROUNDS, cameraEffects, paintBackground, refreshCameraEffects, setBackgroundPicture, backgroundPicture, shrinkPicture, effectsStatus, onEffectsStatus, holdCamera, borrowCamera, cameraBusy } from "./camfx"; // backgrounds (Added by aura-camera-backgrounds-setup.cjs)

// ── The camera itself (one for all of AURA) ─────────────────────────────────
const cam = { open: false, minimized: false, on: false, starting: false, stream: null, error: "", devices: [], deviceId: "" };
let snapshot = { ...cam };
const listeners = new Set();
const emit = () => { snapshot = { ...cam }; listeners.forEach((fn) => fn(snapshot)); };
let attempt = 0; // a newer start or a stop wins over an older start still waiting

export function useCamera() {
  const [s, setS] = useState(snapshot);
  useEffect(() => { listeners.add(setS); setS(snapshot); return () => listeners.delete(setS); }, []);
  return s;
}
export const cameraIsOn = () => !!cam.stream && cam.stream.getVideoTracks().some((t) => t.readyState === "live");

const media = () => (typeof navigator !== "undefined" ? navigator.mediaDevices : null);

async function refreshDevices() {
  try {
    const list = (await media().enumerateDevices()).filter((d) => d.kind === "videoinput");
    cam.devices = list.map((d, i) => ({ id: d.deviceId, label: d.label || "Camera " + (i + 1) }));
  } catch { cam.devices = []; }
  emit();
}
let watching = false;
function watchDevices() {
  if (watching || !media()?.addEventListener) return;
  watching = true;
  media().addEventListener("devicechange", refreshDevices);
  // Leaving or reloading AURA lets go of the camera
  window.addEventListener("pagehide", () => stopCamera());
}

function explain(e) {
  const name = (e && e.name) || "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError")
    return "AURA isn't allowed to use the camera. In Windows, open Settings > Privacy & security > Camera and turn on camera access for desktop apps, then press Turn on.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError")
    return "No camera was found. Plug one in, then press Turn on.";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError")
    return "The camera is being used by another app (like Discord, Zoom, OBS, Teams or the Windows Camera app), or Windows couldn't start it. Close the other app, then press Turn on.";
  return "The camera couldn't start" + (e && e.message ? ": " + e.message : ".");
}

// Turns the camera on. `deviceId`: which camera (empty: the one Windows picks)
export async function startCamera(deviceId = "") {
  watchDevices();
  const mine = ++attempt;
  stopTracks();
  cam.starting = true; cam.error = ""; cam.on = false;
  emit();
  if (!media()?.getUserMedia) { cam.starting = false; cam.error = "This PC can't use a camera in AURA."; emit(); return false; }
  const ask = (id) => media().getUserMedia({ audio: false, video: { ...(id ? { deviceId: { exact: id } } : {}), width: { ideal: 1280 }, height: { ideal: 720 } } });
  let stream = null;
  try {
    try { stream = await ask(deviceId); }
    catch (e) {
      // The saved camera isn't plugged in: use whichever one there is
      if (deviceId && (e.name === "OverconstrainedError" || e.name === "NotFoundError")) stream = await ask("");
      else throw e;
    }
  } catch (e) {
    // Busy because a call in AURA has it: show that camera instead of opening it again (Added by aura-camera-busy-setup.cjs)
    stream = cameraBusy(e) ? borrowCamera() : null;
    if (!stream) {
      if (mine !== attempt) return false;
      cam.starting = false; cam.error = explain(e);
      emit();
      return false;
    }
  }
  if (mine !== attempt) { stream.getTracks().forEach((t) => t.stop()); return false; } // turned off meanwhile
  const track = stream.getVideoTracks()[0];
  cam.raw = stream; holdCamera(stream); const fx = cameraEffects(stream); cam.stream = fx ? fx.stream : stream; cam.on = true; cam.starting = false; // (the background: Added by aura-camera-backgrounds-setup.cjs)
  cam.deviceId = (track && track.getSettings && track.getSettings().deviceId) || deviceId || "";
  if (track) track.addEventListener("ended", () => {
    if (cam.raw !== stream) return;
    stopTracks();
    cam.error = "The camera was disconnected. Plug it back in, then press Turn on.";
    emit();
  });
  emit();
  refreshDevices();
  return true;
}
function stopTracks() {
  if (cam.stream) cam.stream.getTracks().forEach((t) => { try { t.stop(); } catch {} });
  if (cam.raw) cam.raw.getTracks().forEach((t) => { try { t.stop(); } catch {} }); // the camera itself
  cam.stream = null; cam.raw = null; cam.on = false;
}
export function stopCamera() { attempt++; stopTracks(); cam.starting = false; emit(); }
export function openCamera(deviceId) { cam.open = true; cam.minimized = false; cam.error = ""; emit(); if (!cam.on && !cam.starting) startCamera(deviceId); }
export function closeCamera() { stopCamera(); cam.open = false; cam.minimized = false; cam.error = ""; emit(); }
const setMinimized = (v) => { cam.minimized = v; emit(); };
// The next camera in the list
function nextCamera() {
  if (cam.devices.length < 2) return;
  const at = cam.devices.findIndex((d) => d.id === cam.deviceId);
  startCamera(cam.devices[(at + 1) % cam.devices.length].id);
}

// ── Your camera in a corner of a recording ───────────────────────────────────
// Gives back a new picture track (the screen with the camera on top) and stop(), or null when
// the camera is off or this PC can't do it (then the recording is the screen on its own, as before).
export function cameraOverlay(screenTrack, { corner = "br" } = {}) {
  try {
    const camTrack = cam.stream && cam.stream.getVideoTracks()[0];
    if (!screenTrack || !camTrack || camTrack.readyState !== "live") return null;
    if (typeof MediaStreamTrackProcessor !== "function" || typeof MediaStreamTrackGenerator !== "function" || typeof OffscreenCanvas !== "function" || typeof VideoFrame !== "function") return null;
    // Keep the newest camera picture (the camera's own track: turning the camera off ends it)
    let latest = null, stopped = false;
    const camReader = new MediaStreamTrackProcessor({ track: camTrack }).readable.getReader();
    (async () => {
      try {
        for (;;) {
          const { value, done } = await camReader.read();
          if (done) break;
          if (stopped) { value.close(); break; }
          if (latest) latest.close();
          latest = value;
        }
      } catch {}
      if (latest) { latest.close(); latest = null; }
    })();
    const out = new MediaStreamTrackGenerator({ kind: "video" });
    let canvas = null, ctx = null;
    const mix = new TransformStream({
      transform(frame, ctl) {
        try {
          const w = frame.displayWidth, h = frame.displayHeight;
          if (!canvas || canvas.width !== w || canvas.height !== h) { canvas = new OffscreenCanvas(w, h); ctx = canvas.getContext("2d"); }
          ctx.drawImage(frame, 0, 0, w, h);
          const live = latest && camTrack.readyState === "live";
          if (live) {
            const cw = Math.round(w * 0.22), ch = Math.round(cw * (latest.displayHeight / latest.displayWidth || 9 / 16));
            const pad = Math.round(w * 0.015);
            const x = corner.endsWith("l") ? pad : w - cw - pad;
            const y = corner.startsWith("t") ? pad : h - ch - pad;
            ctx.fillStyle = "rgba(0,0,0,.55)";
            ctx.fillRect(x - 3, y - 3, cw + 6, ch + 6);
            ctx.drawImage(latest, x, y, cw, ch);
          }
          const mixed = new VideoFrame(canvas, { timestamp: frame.timestamp });
          frame.close();
          ctl.enqueue(mixed);
        } catch {
          ctl.enqueue(frame); // something went wrong with this picture: keep the screen as it is
        }
      },
    });
    const screenReader = new MediaStreamTrackProcessor({ track: screenTrack }).readable;
    screenReader.pipeThrough(mix).pipeTo(out.writable).catch(() => {});
    return {
      track: out,
      stop() {
        stopped = true;
        try { camReader.cancel(); } catch {}
        try { out.stop(); } catch {}
        if (latest) { try { latest.close(); } catch {} latest = null; }
      },
    };
  } catch {
    return null;
  }
}

// ── Looks ─────────────────────────────────────────────────────────────────────
const CSS = `
.cam-pan{position:fixed;z-index:900;display:flex;flex-direction:column;background:var(--panel,#141418);border:1px solid var(--border,#2a2a35);border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.4);overflow:hidden;user-select:none;}
.cam-pan.on{border-color:var(--acg,rgba(255,87,34,.35));}
.cam-top{height:34px;flex-shrink:0;display:flex;align-items:center;gap:4px;padding:0 6px 0 10px;background:rgba(0,0,0,.35);border-bottom:1px solid var(--border,#2a2a35);cursor:grab;touch-action:none;}
.cam-top:active{cursor:grabbing;}
.cam-top:focus-visible{outline:2px solid var(--ac,#FF5722);outline-offset:-2px;}
.cam-name{flex:1;min-width:0;display:flex;align-items:center;gap:7px;font-family:Rajdhani,sans-serif;font-size:13px;font-weight:700;letter-spacing:.6px;color:var(--t1,#fff);white-space:nowrap;overflow:hidden;}
.cam-dot{width:8px;height:8px;border-radius:50%;background:var(--t3,#666);flex-shrink:0;}
.cam-pan.on .cam-dot,.cam-pill.on .cam-dot{background:#eb0400;box-shadow:0 0 7px #eb0400;}
.cam-state{font-family:'DM Sans',sans-serif;font-size:10px;font-weight:600;letter-spacing:0;color:var(--t3,#888);}
.cam-pan.on .cam-state,.cam-pill.on .cam-state{color:#ff6b5e;}
.cam-btn{width:26px;height:26px;flex-shrink:0;display:flex;align-items:center;justify-content:center;border:none;border-radius:7px;background:transparent;color:var(--t2,#aaa);cursor:pointer;font-size:13px;line-height:1;padding:0;}
.cam-btn:hover{background:var(--hover,#242430);color:var(--t1,#fff);}
.cam-btn:focus-visible{outline:2px solid var(--ac,#FF5722);outline-offset:1px;}
.cam-btn.is-on{color:var(--ac,#FF5722);}
.cam-btn.close:hover{background:rgba(255,77,109,.14);color:var(--danger,#ff4d6d);}
.cam-view{position:relative;flex:1;min-height:0;background:#000;}
.cam-view video{width:100%;height:100%;object-fit:cover;display:block;}
.cam-view:fullscreen{background:#000;}
.cam-view:fullscreen video{object-fit:contain;}
.cam-view:fullscreen .cam-size{display:none;}
.cam-exit{display:none;}
.cam-view:fullscreen .cam-exit{display:block;position:absolute;top:18px;right:18px;padding:9px 16px;border:1px solid rgba(255,255,255,.25);border-radius:999px;background:rgba(0,0,0,.6);color:#fff;font:600 13px 'DM Sans',sans-serif;cursor:pointer;}
.cam-view:fullscreen .cam-exit:hover{background:rgba(0,0,0,.85);}
.cam-off{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:14px;text-align:center;font-size:11px;line-height:1.45;color:var(--t2,#aaa);}
.cam-off .err{color:#ff8a8a;}
.cam-go{background:var(--ac,#FF5722);color:#fff;border:none;border-radius:8px;padding:7px 14px;font-size:11px;font-weight:700;font-family:'DM Sans',sans-serif;cursor:pointer;}
.cam-go:focus-visible{outline:2px solid #fff;outline-offset:2px;}
.cam-size{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;touch-action:none;background:linear-gradient(135deg,transparent 50%,rgba(255,255,255,.35) 50%,rgba(255,255,255,.35) 60%,transparent 60%,transparent 72%,rgba(255,255,255,.35) 72%,rgba(255,255,255,.35) 82%,transparent 82%);}
.cam-pill{position:fixed;z-index:900;display:flex;align-items:center;gap:6px;height:36px;padding:0 6px 0 12px;border-radius:18px;background:var(--panel,#141418);border:1px solid var(--border,#2a2a35);box-shadow:0 10px 30px rgba(0,0,0,.5);font-family:Rajdhani,sans-serif;font-size:13px;font-weight:700;letter-spacing:.5px;color:var(--t1,#fff);}
.cam-menu-dot{width:7px;height:7px;border-radius:50%;background:#eb0400;box-shadow:0 0 6px #eb0400;margin-left:auto;flex-shrink:0;}
/* Backgrounds (Added by aura-camera-backgrounds-setup.cjs) */
.cam-bg-btn{position:absolute;left:8px;bottom:8px;z-index:2;padding:4px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.55);color:#fff;font:600 11px 'DM Sans',sans-serif;cursor:pointer;opacity:0;transition:opacity .15s;}
.cam-view:hover .cam-bg-btn,.cam-bg-btn:focus-visible,.cam-bg-btn.open{opacity:1;}
.cam-bg-btn:focus-visible,.cam-bg:focus-visible,.cam-bg-tile:focus-visible{outline:2px solid var(--ac,#FF5722);outline-offset:2px;}
.cam-bgs{position:absolute;left:6px;right:6px;bottom:40px;z-index:2;display:flex;gap:6px;overflow-x:auto;padding:6px;border-radius:10px;background:rgba(10,10,14,.85);border:1px solid rgba(255,255,255,.12);}
.cam-bg{flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:3px;padding:3px;border-radius:7px;border:2px solid transparent;background:none;color:var(--t2,#aaa);font:600 9.5px 'DM Sans',sans-serif;cursor:pointer;}
.cam-bg.on{border-color:var(--ac,#FF5722);color:#fff;}
.cam-swatch{display:block;border-radius:5px;}
.cam-bg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:10px;margin-top:10px;}
.cam-bg-tile{display:flex;flex-direction:column;gap:5px;padding:4px;border-radius:10px;border:2px solid var(--border,#2a2a35);background:var(--card,#1c1c22);color:var(--t1,#fff);font:600 11px 'DM Sans',sans-serif;cursor:pointer;text-align:left;}
.cam-bg-tile .cam-swatch{width:100%;height:auto;aspect-ratio:16/9;}
.cam-bg-tile.on{border-color:var(--ac,#FF5722);}
.cam-bg-row{flex-direction:column;align-items:stretch!important;}
.cam-bg-note{font-size:11px;color:var(--t2,#aaa);}
.cam-bg-note.err{color:#ff8a8a;}
.cam-bg-link{background:none;border:none;padding:0;color:var(--ac,#FF5722);font:600 11px 'DM Sans',sans-serif;cursor:pointer;text-decoration:underline;}
@media (prefers-reduced-motion:no-preference){.cam-pan.on .cam-dot{animation:pulse 2s infinite;}}
`;
function useCss() {
  useEffect(() => {
    if (document.getElementById("aura-cam-css")) return;
    const el = document.createElement("style");
    el.id = "aura-cam-css";
    el.textContent = CSS;
    document.head.appendChild(el);
  }, []);
}

const CamIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16" aria-hidden="true">
    <rect x="2" y="6" width="14" height="12" rx="2" /><path d="m16 10 6-3v10l-6-3z" />
  </svg>
);

// ── The Camera item in the side menu ─────────────────────────────────────────
export function CameraButton({ rail = false, open: menuOpen = true, settings = {} }) {
  useCss();
  const c = useCamera();
  const press = () => (c.open ? closeCamera() : openCamera(settings.camDevice || ""));
  const onKey = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); press(); } };
  const title = c.open ? "Close the camera" : "Camera";
  const label = c.open ? "Close Camera" : "Camera";
  if (rail) return (
    <div className={`gm-rail-item aura-cam ${c.open ? "on" : ""}`} role="button" tabIndex={0} title={title} aria-pressed={c.open} onClick={press} onKeyDown={onKey}>
      <CamIcon />{menuOpen && <span className="gm-rail-item-label">{label}</span>}{c.on && <span className="cam-menu-dot" aria-label="camera is on" />}
    </div>
  );
  return (
    <div style={{ flexShrink: 0, padding: "0 10px 2px" }}>
      <div className={`sb-item aura-cam ${c.open ? "on" : ""}`} role="button" tabIndex={0} title={title} aria-pressed={c.open} onClick={press} onKeyDown={onKey} style={{ marginBottom: 0 }}>
        <CamIcon />{menuOpen && <span>{label}</span>}{c.on && <span className="cam-menu-dot" aria-label="camera is on" />}
      </div>
    </div>
  );
}

// ── Backgrounds (Added by aura-camera-backgrounds-setup.cjs) ──
// A little picture of each background
function BgSwatch({ id, w = 96, h = 54 }) {
  const ref = useRef(null);
  const [, again] = useState(0);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (id === "none") { ctx.fillStyle = "#26262e"; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(w * 0.3, h * 0.8); ctx.lineTo(w * 0.7, h * 0.2); ctx.stroke(); return; }
    if (id === "blur") { paintBackground(ctx, w, h, "studio"); ctx.filter = "blur(3px)"; ctx.fillStyle = "rgba(255,255,255,.25)"; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(w * (0.15 + i * 0.18), h * (0.35 + (i % 2) * 0.3), h * 0.16, 0, 7); ctx.fill(); } ctx.filter = "none"; return; }
    paintBackground(ctx, w, h, id);
    // your photo loads a moment later
    if (id === "picture" && backgroundPicture()) { const t = setTimeout(() => { paintBackground(ctx, w, h, id); again((n) => n + 1); }, 300); return () => clearTimeout(t); }
  }, [id, w, h]);
  return <canvas ref={ref} width={w} height={h} className="cam-swatch" aria-hidden="true" />;
}
// Choosing your photo
function usePhotoPicker(onChange) {
  const input = useRef(null);
  const [problem, setProblem] = useState("");
  const pick = () => { setProblem(""); input.current?.click(); };
  const box = (
    <input ref={input} type="file" accept="image/*" style={{ display: "none" }} aria-hidden="true" tabIndex={-1}
      onChange={async (e) => {
        const f = e.target.files && e.target.files[0];
        e.target.value = "";
        if (!f) return;
        try { setBackgroundPicture(await shrinkPicture(f)); onChange({ camBg: "picture" }); refreshCameraEffects(); }
        catch (err) { setProblem(err.message || "That picture couldn't be used."); }
      }} />
  );
  return { pick, box, problem };
}
// The Background button on the preview, and its row of choices
function BgPicker({ settings, onSettings }) {
  const [open, setOpen] = useState(false);
  const now = settings.camBg || "none";
  const choose = (id) => { onSettings({ camBg: id }); refreshCameraEffects(); };
  const photo = usePhotoPicker(onSettings);
  return (
    <>
      <button className={`cam-bg-btn ${open ? "open" : ""}`} onClick={() => setOpen((v) => !v)} aria-expanded={open} title="Background">Background</button>
      {open && (
        <div className="cam-bgs" role="radiogroup" aria-label="Background">
          {BACKGROUNDS.map((b) => (
            <button key={b.id} role="radio" aria-checked={now === b.id} className={`cam-bg ${now === b.id ? "on" : ""}`} title={b.label}
              onClick={() => (b.id === "picture" && !backgroundPicture() ? photo.pick() : choose(b.id))}>
              <BgSwatch id={b.id} w={48} h={27} /><span>{b.label}</span>
            </button>
          ))}
          {photo.box}
        </div>
      )}
    </>
  );
}
function useEffectsStatus() {
  const [s, setS] = useState(effectsStatus());
  useEffect(() => onEffectsStatus(setS), []);
  return s;
}

// ── The floating preview ─────────────────────────────────────────────────────
const HEAD = 34;
const clampBox = (x, y, w, h) => ({
  x: Math.round(Math.min(Math.max(0, x), Math.max(0, window.innerWidth - w))),
  y: Math.round(Math.min(Math.max(0, y), Math.max(0, window.innerHeight - h))),
});

export function CameraPanel({ settings = {}, onSettings = () => {} }) {
  useCss();
  const c = useCamera();
  const video = useRef(null);
  const view = useRef(null); // (full screen: Added by aura-call-screen-setup.cjs)
  const fullOff = () => { if (document.fullscreenElement && document.fullscreenElement === view.current) document.exitFullscreen().catch(() => {}); };
  useEffect(() => { const esc = (e) => { if (e.key === "Escape") fullOff(); }; window.addEventListener("keydown", esc); return () => { window.removeEventListener("keydown", esc); fullOff(); }; }, []);
  const [, redraw] = useState(0);
  const [live, setLive] = useState(null); // while dragging or resizing: { x, y, w }
  const width = Math.min(Math.max(Number(settings.camWidth) || 320, 200), 720);
  const w = live ? live.w : width;
  const h = c.minimized ? 36 : Math.round(w * 9 / 16) + HEAD;
  const pillW = 190;
  const boxW = c.minimized ? pillW : w;
  // Where it is: saved, or above the bottom-right corner (clear of the Now Playing bar)
  const wantX = live ? live.x : Number.isFinite(settings.camX) ? settings.camX : window.innerWidth - boxW - 24;
  const wantY = live ? live.y : Number.isFinite(settings.camY) ? settings.camY : window.innerHeight - h - 96;
  const at = clampBox(wantX, wantY, boxW, h);

  // The window changed size: stay on screen
  useEffect(() => { const fn = () => redraw((n) => n + 1); window.addEventListener("resize", fn); return () => window.removeEventListener("resize", fn); }, []);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (v.srcObject !== c.stream) v.srcObject = c.stream || null;
    if (c.stream) v.play().catch(() => {});
  }, [c.stream, c.minimized, c.open]);
  if (!c.open) return null;

  const save = (patch) => onSettings(patch);
  const drag = (e) => {
    if (e.button !== 0 || e.target.closest("button,select")) return;
    e.preventDefault();
    const sx = e.clientX - at.x, sy = e.clientY - at.y;
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch {}
    let pos = at;
    const move = (ev) => { pos = clampBox(ev.clientX - sx, ev.clientY - sy, boxW, h); setLive({ x: pos.x, y: pos.y, w }); };
    const up = () => {
      el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      setLive(null); save({ camX: pos.x, camY: pos.y });
    };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  };
  const resize = (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch {}
    const sx = e.clientX, sw = w;
    let nw = w;
    const move = (ev) => {
      const most = Math.max(200, Math.min(720, window.innerWidth - at.x, (window.innerHeight - at.y - HEAD) * 16 / 9));
      nw = Math.round(Math.min(Math.max(200, sw + ev.clientX - sx), most));
      setLive({ x: at.x, y: at.y, w: nw });
    };
    const up = () => {
      el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      setLive(null); save({ camWidth: nw, camX: at.x, camY: at.y });
    };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  };
  // Arrow keys move it too (Shift: further)
  const keys = (e) => {
    const step = e.shiftKey ? 40 : 10;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d || e.target !== e.currentTarget) return;
    e.preventDefault();
    const p = clampBox(at.x + d[0], at.y + d[1], boxW, h);
    save({ camX: p.x, camY: p.y });
  };
  const power = () => (c.on || c.starting ? stopCamera() : startCamera(settings.camDevice || ""));
  const state = c.starting ? "starting…" : c.on ? "on" : "off";

  if (c.minimized) return (
    <div className={`cam-pill ${c.on ? "on" : ""}`} style={{ left: at.x, top: at.y, width: pillW }} role="region" aria-label="Camera (minimized)">
      <div className="cam-name" onPointerDown={drag} style={{ cursor: "grab", touchAction: "none" }} tabIndex={0} onKeyDown={keys} title="Drag to move">
        <span className="cam-dot" />CAMERA <span className="cam-state">{state}</span>
      </div>
      <button className="cam-btn" title="Show the camera" aria-label="Show the camera" onClick={() => setMinimized(false)}>▢</button>
      <button className="cam-btn close" title="Close the camera" aria-label="Close the camera" onClick={closeCamera}>✕</button>
    </div>
  );

  return (
    <div className={`cam-pan ${c.on ? "on" : ""}`} style={{ left: at.x, top: at.y, width: w, height: h }} role="region" aria-label="Camera preview">
      <div className="cam-top" onPointerDown={drag} tabIndex={0} onKeyDown={keys} title="Drag to move (or use the arrow keys)">
        <div className="cam-name"><span className="cam-dot" />CAMERA <span className="cam-state">{state}</span></div>
        {c.devices.length > 1 && <button className="cam-btn" title="Switch camera" aria-label="Switch camera" onClick={nextCamera} disabled={!c.on}>⇄</button>}
        <button className={`cam-btn ${settings.camMirror !== false ? "is-on" : ""}`} title="Mirror the preview" aria-label="Mirror the preview" aria-pressed={settings.camMirror !== false} onClick={() => save({ camMirror: settings.camMirror === false })}>⇋</button>
        <button className={`cam-btn ${c.on ? "is-on" : ""}`} title={c.on ? "Turn the camera off" : "Turn the camera on"} aria-label={c.on ? "Turn the camera off" : "Turn the camera on"} aria-pressed={c.on} onClick={power}>⏻</button>
        <button className="cam-btn" title="Full screen (Esc to go back)" aria-label="Show the camera full screen" onClick={() => { try { view.current?.requestFullscreen?.({ navigationUI: "hide" })?.catch?.(() => {}); } catch {} }}>⛶</button>
        <button className="cam-btn" title="Minimize" aria-label="Minimize the camera" onClick={() => setMinimized(true)}>–</button>
        <button className="cam-btn close" title="Close the camera" aria-label="Close the camera" onClick={closeCamera}>✕</button>
      </div>
      <div className="cam-view" ref={view} onDoubleClick={() => { if (document.fullscreenElement === view.current) document.exitFullscreen().catch(() => {}); else try { view.current?.requestFullscreen?.()?.catch?.(() => {}); } catch {} }}>
        <video ref={video} autoPlay muted playsInline style={{ transform: settings.camMirror !== false ? "scaleX(-1)" : "none", visibility: c.on ? "visible" : "hidden" }} />
        {!c.on && (
          <div className="cam-off">
            {c.starting ? <span>Starting the camera…</span> : c.error ? <span className="err">{c.error}</span> : <span>The camera is off.</span>}
            {!c.starting && <button className="cam-go" onClick={() => startCamera(settings.camDevice || "")}>Turn on</button>}
          </div>
        )}
        {c.on && <BgPicker settings={settings} onSettings={save} />}
        <button className="cam-exit" onClick={fullOff} aria-label="Exit full screen">Exit full screen (Esc)</button>
        <div className="cam-size" onPointerDown={resize} title="Drag to resize" aria-hidden="true" />
      </div>
    </div>
  );
}

// ── Settings > Camera ────────────────────────────────────────────────────────
const SIZES = [[240, "Small"], [320, "Medium"], [480, "Large"]];
const CORNERS = [["tl", "Top left"], ["tr", "Top right"], ["bl", "Bottom left"], ["br", "Bottom right"]];
function Switch({ on, label, onChange }) {
  return <div className={`tog ${on ? "on" : ""}`} role="switch" aria-checked={!!on} aria-label={label} tabIndex={0} onClick={() => onChange(!on)}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onChange(!on); } }} />;
}
export function CameraSettings({ settings: s, onChange, Seg }) {
  useCss();
  const c = useCamera();
  useEffect(() => { if (media()?.enumerateDevices) { watchDevices(); refreshDevices(); } }, []);
  const named = c.devices.some((d) => !/^Camera \d+$/.test(d.label));
  const saved = s.camDevice && !c.devices.some((d) => d.id === s.camDevice) ? [{ id: s.camDevice, label: s.camDeviceName || "Saved camera (not plugged in)" }] : [];
  const width = Number(s.camWidth) || 320;
  const fx = useEffectsStatus(); // (Added by aura-camera-backgrounds-setup.cjs)
  const bg = s.camBg || "none", greenMode = s.camGreen || "auto";
  const choose = (id) => { onChange({ camBg: id }); refreshCameraEffects(); };
  const photo = usePhotoPicker(onChange);
  const greenNote = greenMode === "on" ? "AURA always swaps green for your background"
    : greenMode === "off" ? "AURA finds you in the picture by itself (no green screen needed)"
    : !c.on || bg === "none" ? "AURA looks for a green screen behind you when a background is on"
    : fx.green ? "Green screen found: AURA swaps the green for your background"
    : fx.cutout === "failed" ? "No green screen found, and finding you in the picture doesn't work on this PC. A green screen still works"
    : fx.cutout === "loading" ? "No green screen found: getting ready to find you in the picture…"
    : "No green screen found: AURA finds you in the picture by itself";
  return (
    <div className="ss">
      <div className="ss-t">CAMERA</div>
      <div className="ss-card">
        <div className="sr"><div><div className="sr-l">Camera Preview</div><div className="sr-s">{c.on ? "Your camera is on. Close the preview to turn it off" : "A small window with your camera that you can move anywhere in AURA. The camera only turns on when you open it"}</div></div>
          <button className={c.open ? "btn-d" : "btn-p"} style={{ fontSize: 11, padding: "6px 14px" }} onClick={() => (c.open ? closeCamera() : openCamera(s.camDevice || ""))}>{c.open ? "Close preview" : "Open preview"}</button></div>
        <div className="sr"><div><div className="sr-l">Camera</div><div className="sr-s">{c.devices.length === 0 ? "No camera found" : named ? "The camera AURA uses" : "Open the preview once to see your cameras' names"}</div></div>
          <select className="fs set-select" aria-label="Camera" value={s.camDevice || ""} onChange={(e) => {
            const id = e.target.value;
            const d = c.devices.find((x) => x.id === id);
            onChange({ camDevice: id, camDeviceName: d ? d.label : "" });
            if (c.on) startCamera(id);
          }}>
            <option value="">Automatic</option>
            {[...saved, ...c.devices].map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select></div>
        <div className="sr"><div><div className="sr-l">Mirror the Preview</div><div className="sr-s">Shows you like a mirror. Recordings are never mirrored</div></div>
          <Switch on={s.camMirror !== false} label="Mirror the preview" onChange={(v) => onChange({ camMirror: v })} /></div>
        <div className="sr"><div><div className="sr-l">Preview Size</div><div className="sr-s">You can also drag its corner to any size</div></div>
          <Seg value={SIZES.some(([px]) => px === width) ? width : null} options={SIZES} onChange={(v) => onChange({ camWidth: v })} /></div>
        {/* Backgrounds (Added by aura-camera-backgrounds-setup.cjs) */}
        <div className="sr cam-bg-row"><div><div className="sr-l">Background</div><div className="sr-s">What's behind you, in the preview, calls and recordings. It all happens on this PC</div></div>
          <div className="cam-bg-grid" role="radiogroup" aria-label="Background">
            {BACKGROUNDS.map((b) => (
              <button key={b.id} type="button" role="radio" aria-checked={bg === b.id} className={`cam-bg-tile ${bg === b.id ? "on" : ""}`}
                onClick={() => (b.id === "picture" && !backgroundPicture() ? photo.pick() : choose(b.id))}><BgSwatch id={b.id} />{b.label}</button>
            ))}
          </div>
          {photo.box}
          {backgroundPicture() && <div className="cam-bg-note"><button type="button" className="cam-bg-link" onClick={photo.pick}>Choose a different photo</button></div>}
          {photo.problem && <div className="cam-bg-note err">{photo.problem}</div>}
        </div>
        <div className="sr"><div><div className="sr-l">Green Screen</div><div className="sr-s">{greenNote}</div></div>
          <Seg value={greenMode} options={[["auto", "Auto"], ["on", "Always"], ["off", "Never"]]} onChange={(v) => { onChange({ camGreen: v }); refreshCameraEffects(); }} /></div>
        <div className="sr"><div><div className="sr-l">Camera in Recordings</div><div className="sr-s">While the camera is on, clips you record with Alt + Shift + R, the AURA Bar or the Clips page show it in a corner. When it's off, clips are only the screen</div></div>
          <Switch on={!!s.camInRecordings} label="Camera in recordings" onChange={(v) => onChange({ camInRecordings: v })} /></div>
        {s.camInRecordings && <div className="sr"><div><div className="sr-l">Corner</div><div className="sr-s">Where the camera goes in the clip</div></div>
          <Seg value={s.camCorner || "br"} options={CORNERS} onChange={(v) => onChange({ camCorner: v })} /></div>}
      </div>
    </div>
  );
}
