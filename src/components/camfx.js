// Camera backgrounds: blur, a picture, or your own photo behind you. Added by aura-camera-backgrounds-setup.cjs
//
//   With a green screen behind you, AURA sees it and swaps the green for your background (the
//   sharpest result). Without one, it finds you in the picture by itself, using Google's free
//   MediaPipe selfie model, which runs on this PC (nothing is sent anywhere).
//
//   cameraEffects(stream)    your camera with its background; gives { stream, stop } (or null)
//   BACKGROUNDS              the choices, for Settings > Camera
//   paintBackground(...)     draws one (for the little previews)
//   setBackgroundPicture()   your own photo (kept on this PC only)
//   effectsStatus() / onEffectsStatus(fn)   green screen found? cutout ready?
import modelUrl from "./selfie_segmenter.tflite?url";
import wasmLoaderUrl from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryUrl from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";

export const BACKGROUNDS = [
  { id: "none", label: "None" },
  { id: "blur", label: "Blur" },
  { id: "aura", label: "AURA Glow" },
  { id: "midnight", label: "Midnight" },
  { id: "sunset", label: "Sunset" },
  { id: "ocean", label: "Ocean" },
  { id: "arcade", label: "Arcade" },
  { id: "studio", label: "Studio" },
  { id: "picture", label: "Your Photo" },
];
const PIC_KEY = "aura_cam_bg_picture";

// ── What's picked (Settings > Camera), looked at a few times a second ───────
const read = () => {
  try {
    const s = JSON.parse(localStorage.getItem("aura_settings") || "{}");
    return { bg: BACKGROUNDS.some((b) => b.id === s.camBg) ? s.camBg : "none", green: ["auto", "on", "off"].includes(s.camGreen) ? s.camGreen : "auto" };
  } catch { return { bg: "none", green: "auto" }; }
};
let opts = read(), readAt = 0;
const options = () => { const now = performance.now(); if (now - readAt > 400) { opts = read(); readAt = now; } return opts; };
export function refreshCameraEffects() { readAt = 0; }

// ── Is a green screen there? Is the cutout ready? (for Settings) ────────────
let status = { green: false, cutout: "idle" }; // cutout: idle | loading | ready | failed
const watchers = new Set();
const setStatus = (p) => { const next = { ...status, ...p }; if (next.green === status.green && next.cutout === status.cutout) return; status = next; watchers.forEach((w) => { try { w(status); } catch {} }); };
export const effectsStatus = () => status;
export function onEffectsStatus(fn) { watchers.add(fn); return () => watchers.delete(fn); }

// ── Your own photo ───────────────────────────────────────────────────────────
let picture = null, pictureSrc = null;
export const backgroundPicture = () => { try { return localStorage.getItem(PIC_KEY) || ""; } catch { return ""; } };
export function setBackgroundPicture(dataUrl) {
  try { if (dataUrl) localStorage.setItem(PIC_KEY, dataUrl); else localStorage.removeItem(PIC_KEY); } catch {}
  pictureSrc = null; cache = null;
}
function pictureNow() {
  const src = backgroundPicture();
  if (src !== pictureSrc) {
    pictureSrc = src; picture = null; cache = null;
    if (src) { const img = new Image(); img.onload = () => { if (pictureSrc === src) { picture = img; cache = null; } }; img.src = src; }
  }
  return picture;
}
// A photo you pick is made 1280 x 720 at most, so it stays small
export function shrinkPicture(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type || "")) return reject(new Error("That isn't a picture."));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1280 / img.width, 720 / img.height);
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.88));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That picture couldn't be opened.")); };
    img.src = url;
  });
}

// ── The backgrounds themselves, drawn (no picture files needed) ─────────────
const accent = () => { try { return getComputedStyle(document.documentElement).getPropertyValue("--ac").trim() || "#FF5722"; } catch { return "#FF5722"; } };
export function paintBackground(ctx, w, h, id) {
  const lin = (stops, x0 = 0, y0 = 0, x1 = 0, y1 = h) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); stops.forEach(([at, c]) => g.addColorStop(at, c)); return g; };
  const rad = (stops, x, y, r) => { const g = ctx.createRadialGradient(x, y, 0, x, y, r); stops.forEach(([at, c]) => g.addColorStop(at, c)); return g; };
  ctx.save();
  if (id === "aura") {
    ctx.fillStyle = "#0b0b10"; ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.85; ctx.fillStyle = rad([[0, accent()], [1, "rgba(11,11,16,0)"]], w * 0.25, h * 0.2, Math.max(w, h) * 0.75); ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.5; ctx.fillStyle = rad([[0, "#7c3aed"], [1, "rgba(11,11,16,0)"]], w * 0.85, h * 0.9, Math.max(w, h) * 0.6); ctx.fillRect(0, 0, w, h);
  } else if (id === "midnight") {
    ctx.fillStyle = lin([[0, "#0d1033"], [1, "#2b1655"]]); ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,.75)";
    for (let i = 0; i < 70; i++) { const x = ((i * 7919) % 997) / 997 * w, y = ((i * 104729) % 991) / 991 * h * 0.8, r = (i % 3 === 0 ? 1.6 : 0.9) * Math.max(1, w / 1280); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  } else if (id === "sunset") {
    ctx.fillStyle = lin([[0, "#3b1d60"], [0.55, "#e0566c"], [1, "#ffb36b"]]); ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.55; ctx.fillStyle = rad([[0, "#ffe2a8"], [1, "rgba(255,226,168,0)"]], w * 0.5, h * 0.92, h * 0.55); ctx.fillRect(0, 0, w, h);
  } else if (id === "ocean") {
    ctx.fillStyle = lin([[0, "#0b2a3a"], [0.6, "#14607a"], [1, "#2fa3c4"]]); ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.18; ctx.strokeStyle = "#bff3ff"; ctx.lineWidth = Math.max(1, h / 240);
    for (let k = 0; k < 6; k++) { ctx.beginPath(); for (let x = 0; x <= w; x += w / 40) ctx.lineTo(x, h * (0.62 + k * 0.07) + Math.sin(x / w * 12 + k) * h * 0.012); ctx.stroke(); }
  } else if (id === "arcade") {
    ctx.fillStyle = lin([[0, "#12002b"], [0.6, "#2a0055"], [1, "#12002b"]]); ctx.fillRect(0, 0, w, h);
    const horizon = h * 0.58;
    ctx.strokeStyle = "rgba(255,64,200,.6)"; ctx.lineWidth = Math.max(1, h / 360);
    for (let i = -14; i <= 14; i++) { ctx.beginPath(); ctx.moveTo(w / 2 + i * w * 0.02, horizon); ctx.lineTo(w / 2 + i * w * 0.16, h); ctx.stroke(); }
    for (let j = 1; j < 9; j++) { const y = horizon + (h - horizon) * Math.pow(j / 9, 1.8); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.globalAlpha = 0.9; ctx.fillStyle = lin([[0, "#ffd166"], [1, "#ff3d9a"]], 0, h * 0.18, 0, horizon); ctx.beginPath(); ctx.arc(w / 2, horizon, h * 0.26, Math.PI, 0); ctx.fill();
  } else if (id === "studio" || id === "picture") {
    const pic = id === "picture" ? pictureNow() : null;
    if (pic) {
      const k = Math.max(w / pic.width, h / pic.height);
      ctx.drawImage(pic, (w - pic.width * k) / 2, (h - pic.height * k) / 2, pic.width * k, pic.height * k);
    } else {
      ctx.fillStyle = rad([[0, "#5c5c66"], [1, "#18181d"]], w * 0.5, h * 0.42, Math.max(w, h) * 0.7); ctx.fillRect(0, 0, w, h);
    }
  } else {
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}
let cache = null; // { key, canvas }
function backgroundCanvas(id, w, h) {
  if (id === "picture") pictureNow();
  const key = id + "|" + w + "x" + h + "|" + (id === "aura" ? accent() : "") + "|" + (id === "picture" ? (picture ? pictureSrc.length : 0) : "");
  if (cache && cache.key === key) return cache.canvas;
  const c = new OffscreenCanvas(w, h);
  paintBackground(c.getContext("2d"), w, h, id);
  cache = { key, canvas: c };
  return c;
}

// ── Finding you in the picture (when there's no green screen) ───────────────
let segmenter = null, loading = null, lastTime = 0;
function loadSegmenter() {
  if (segmenter || loading) return loading;
  setStatus({ cutout: "loading" });
  loading = (async () => {
    try {
      const { ImageSegmenter } = await import("@mediapipe/tasks-vision");
      const model = new Uint8Array(await (await fetch(modelUrl)).arrayBuffer());
      const files = { wasmLoaderPath: wasmLoaderUrl, wasmBinaryPath: wasmBinaryUrl };
      const make = (delegate) => ImageSegmenter.createFromOptions(files, { baseOptions: { modelAssetBuffer: model, delegate }, runningMode: "VIDEO", outputConfidenceMasks: true, outputCategoryMask: false });
      try { segmenter = await make("GPU"); } catch { segmenter = await make("CPU"); } // the graphics card if it can, else the processor
      setStatus({ cutout: "ready" });
    } catch (e) {
      console.log("Camera background: the cutout couldn't start", e && e.message);
      setStatus({ cutout: "failed" });
    }
  })();
  return loading;
}

// ── Your camera, with its background ─────────────────────────────────────────
const SW = 256, SH = 144; // the small copy the green screen check and the cutout look at
export function cameraEffects(raw) {
  try {
    const track = raw && raw.getVideoTracks()[0];
    if (!track || typeof MediaStreamTrackProcessor !== "function" || typeof MediaStreamTrackGenerator !== "function" || typeof OffscreenCanvas !== "function" || typeof VideoFrame !== "function") return null;
    const out = new MediaStreamTrackGenerator({ kind: "video" });
    const small = new OffscreenCanvas(SW, SH), sctx = small.getContext("2d", { willReadFrequently: true });
    const mask = new OffscreenCanvas(SW, SH), mctx = mask.getContext("2d");
    const maskPixels = mctx.createImageData(SW, SH);
    let full = null, fctx = null, layer = null, lctx = null;
    let green = false, checkedAt = 0;
    const mix = new TransformStream({
      transform(frame, ctl) {
        const o = options();
        if (o.bg === "none") { ctl.enqueue(frame); return; } // your camera as it is
        try {
          const w = frame.displayWidth, h = frame.displayHeight;
          if (!full || full.width !== w || full.height !== h) {
            full = new OffscreenCanvas(w, h); fctx = full.getContext("2d");
            layer = new OffscreenCanvas(w, h); lctx = layer.getContext("2d");
          }
          sctx.drawImage(frame, 0, 0, SW, SH);
          const seen = sctx.getImageData(0, 0, SW, SH);
          const px = seen.data;
          // A green screen? Look twice a second (and don't flicker between the two)
          const now = performance.now();
          if (o.green === "auto" && now - checkedAt > 500) {
            checkedAt = now;
            let n = 0;
            for (let i = 0; i < px.length; i += 16) { const r = px[i], g = px[i + 1], b = px[i + 2]; if (g > 80 && g > r * 1.35 && g > b * 1.35) n++; }
            const share = n / (px.length / 16);
            if (!green && share > 0.3) green = true;
            else if (green && share < 0.18) green = false;
          }
          const useGreen = o.green === "on" || (o.green === "auto" && green);
          setStatus({ green: o.green === "auto" ? green : o.green === "on" });
          const a = maskPixels.data;
          if (useGreen) {
            // Green goes, you stay (soft at the edges)
            for (let i = 0; i < px.length; i += 4) {
              const r = px[i], g = px[i + 1], b = px[i + 2];
              const key = g - Math.max(r, b);
              const alpha = g < 70 || key <= 18 ? 255 : key >= 60 ? 0 : Math.round(255 * (1 - (key - 18) / 42));
              a[i] = a[i + 1] = a[i + 2] = 255; a[i + 3] = alpha;
            }
          } else {
            if (!segmenter) { loadSegmenter(); ctl.enqueue(frame); return; } // still getting ready: show the camera as it is
            lastTime = Math.max(lastTime + 1, now);
            const result = segmenter.segmentForVideo(seen, lastTime);
            const m = result.confidenceMasks && result.confidenceMasks[0];
            const conf = m ? m.getAsFloat32Array() : null;
            for (let i = 0, j = 0; i < a.length; i += 4, j++) { a[i] = a[i + 1] = a[i + 2] = 255; a[i + 3] = conf ? Math.round(Math.min(1, Math.max(0, (conf[j] - 0.2) / 0.6)) * 255) : 255; }
            try { result.close?.(); } catch {}
          }
          mctx.putImageData(maskPixels, 0, 0);
          // The background
          fctx.globalCompositeOperation = "source-over";
          if (o.bg === "blur") { fctx.filter = "blur(" + Math.round(w / 90) + "px)"; fctx.drawImage(frame, -w * 0.03, -h * 0.03, w * 1.06, h * 1.06); fctx.filter = "none"; }
          else fctx.drawImage(backgroundCanvas(o.bg, w, h), 0, 0);
          // You, on top
          lctx.globalCompositeOperation = "copy";
          lctx.filter = "blur(" + Math.max(1, Math.round(w / 640)) + "px)";
          lctx.drawImage(mask, 0, 0, w, h);
          lctx.filter = "none";
          lctx.globalCompositeOperation = "source-in";
          lctx.drawImage(frame, 0, 0, w, h);
          lctx.globalCompositeOperation = "source-over";
          fctx.drawImage(layer, 0, 0);
          const mixed = new VideoFrame(full, { timestamp: frame.timestamp });
          frame.close();
          ctl.enqueue(mixed);
        } catch {
          ctl.enqueue(frame); // something went wrong with this picture: send the camera as it is
        }
      },
    });
    new MediaStreamTrackProcessor({ track }).readable.pipeThrough(mix).pipeTo(out.writable).catch(() => {});
    const stream = new MediaStream([out]);
    return { stream, stop() { try { out.stop(); } catch {} raw.getTracks().forEach((t) => { try { t.stop(); } catch {} }); } };
  } catch {
    return null;
  }
}

// One camera, shared (Added by aura-camera-busy-setup.cjs)
// Windows often won't let the same camera be opened twice (for example by the camera preview at
// 720p and by a call at 1080p): the second one is told "the camera is being used by another app".
// So whatever has the camera open says so here, and the other part of AURA borrows a copy of that
// picture instead of opening the camera again. A copy keeps going after the original is closed.
const cameraHolders = new Set();
export function holdCamera(stream) { if (stream) cameraHolders.add(stream); }
export function borrowCamera() {
  for (const s of [...cameraHolders]) {
    const t = s.getVideoTracks()[0];
    if (!t || t.readyState !== "live") { cameraHolders.delete(s); continue; }
    try { return new MediaStream([t.clone()]); } catch {}
  }
  return null;
}
export const cameraBusy = (e) => e?.name === "NotReadableError" || e?.name === "TrackStartError" || e?.name === "AbortError";
