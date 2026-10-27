// AURA — the media player (Clips > Media): your music and videos, playlists, and playlist files.
// Runs in the main process. The window reaches it through preload.js (window.electronAPI.media*).
//
// What the window may play is limited to music and video files: in the folders you added, files you
// opened or dropped onto AURA, and files listed in playlists you imported. They are served to the
// window by a small server on this PC only (127.0.0.1) that needs a secret key, the same way your
// clips are. Formats the window can't play (AVI, WMV, some MKV...) are converted once with the FFmpeg
// AURA already has, and kept in a cache that is cleared when it gets big.
//
// Added by aura-media-player-setup.cjs. Wired up from the main file with one line:
//   require("./media").create({ app, ipcMain, dialog, getWindow: () => mainWin });
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");

const AUDIO = ["mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "wma", "aiff", "aif"];
const VIDEO = ["mp4", "m4v", "webm", "mov", "mkv", "avi", "wmv", "flv", "mpg", "mpeg", "ts", "m2ts", "mts", "3gp"];
const NATIVE = new Set(["mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "mp4", "m4v", "webm", "mov", "mkv"]); // the window tries these as they are
const PLAYLISTS = ["m3u", "m3u8", "pls", "xspf", "wpl"];
const MAX_FILES = 5000, MAX_DEPTH = 6, CACHE_MAX = 5 * 1024 ** 3;
const SKIP_DIRS = /^(\.|\$|node_modules$|System Volume Information$|AppData$|Windows$|Program Files)/i;
const extOf = (p) => path.extname(String(p || "")).slice(1).toLowerCase();
const kindOf = (p) => (AUDIO.includes(extOf(p)) ? "audio" : VIDEO.includes(extOf(p)) ? "video" : null);
const isMedia = (p) => !!kindOf(p);
const text = (s, max = 200) => (typeof s === "string" ? s.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");
const same = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
function inside(file, folder) {
  const r = path.relative(path.resolve(folder), path.resolve(file));
  return !!r && !r.startsWith("..") && !path.isAbsolute(r);
}
const unpacked = (p) => (p ? p.replace("app.asar", "app.asar.unpacked") : null);
function tool(name) {
  try { const p = unpacked(name === "ffprobe" ? require("ffprobe-static").path : require("ffmpeg-static")); return p && fs.existsSync(p) ? p : null; } catch { return null; }
}

// ── Reading playlist files (.m3u .m3u8 .pls .xspf .wpl) ───────────────────────
const entities = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
function fromFileUrl(u) {
  if (!/^file:/i.test(u)) return u;
  let p = u.replace(/^file:\/\/(localhost)?/i, "");
  try { p = decodeURIComponent(p); } catch {}
  if (/^\/[a-z]:[\\/]/i.test(p)) p = p.slice(1); // file:///C:/Music/a.mp3
  return p;
}
// Returns { name, entries: [path or link as written] }
function parsePlaylist(content, file) {
  const kind = extOf(file);
  const raw = String(content || "").replace(/^\uFEFF/, "");
  let name = path.basename(file, path.extname(file));
  const entries = [];
  if (kind === "pls") {
    for (const line of raw.split(/\r?\n/)) { const m = /^\s*File\d+\s*=\s*(.+?)\s*$/i.exec(line); if (m) entries.push(m[1]); }
  } else if (kind === "xspf") {
    const head = raw.split(/<trackList/i)[0]; // the playlist's own title comes before its tracks
    const t = /<title>([\s\S]*?)<\/title>/i.exec(head); if (t) name = entities(t[1]).trim() || name;
    for (const m of raw.matchAll(/<location>([\s\S]*?)<\/location>/gi)) entries.push(entities(m[1]).trim());
  } else if (kind === "wpl") {
    const t = /<title>([\s\S]*?)<\/title>/i.exec(raw); if (t) name = entities(t[1]).trim() || name;
    for (const m of raw.matchAll(/<media\b[^>]*\bsrc\s*=\s*"([^"]*)"/gi)) entries.push(entities(m[1]).trim());
  } else {
    for (const line of raw.split(/\r?\n/)) {
      const l = line.trim();
      if (!l) continue;
      if (/^#PLAYLIST:/i.test(l)) { name = l.slice(10).trim() || name; continue; }
      if (l.startsWith("#")) continue;
      entries.push(l);
    }
  }
  return { name: text(name, 80) || "Playlist", entries: entries.filter(Boolean).slice(0, MAX_FILES) };
}
// Turns what a playlist says into full paths on this PC; links (http...) and other files are skipped
function resolveEntries(entries, file) {
  const dir = path.dirname(file);
  const found = [], missing = [], skipped = [];
  for (const e of entries) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(e) && !/^file:/i.test(e)) { skipped.push(e); continue; }
    let p = fromFileUrl(e);
    if (process.platform === "win32") p = p.replace(/\//g, "\\");
    else p = p.replace(/\\/g, "/");
    const full = path.isAbsolute(p) || /^[a-z]:[\\/]/i.test(p) ? p : path.resolve(dir, p);
    if (!isMedia(full)) { skipped.push(e); continue; }
    if (fs.existsSync(full)) found.push(path.resolve(full)); else missing.push(full);
  }
  return { found, missing, skipped };
}
function m3u(name, items) {
  return "#EXTM3U\n#PLAYLIST:" + text(name, 80) + "\n" + items.map((p) => p).join("\n") + "\n";
}

function create({ app, ipcMain, dialog, getWindow = () => null, userData, ffmpeg, ffprobe, platform = process.platform } = {}) {
  const dataDir = userData || app.getPath("userData");
  const storeFile = path.join(dataDir, "aura-media.json");
  const cacheDir = path.join(dataDir, "media-cache");
  const FFMPEG = ffmpeg === undefined ? tool("ffmpeg") : ffmpeg;
  const FFPROBE = ffprobe === undefined ? tool("ffprobe") : ffprobe;
  let store = { folders: [], files: [], playlists: [] };
  try { const s = JSON.parse(fs.readFileSync(storeFile, "utf8")); store = { folders: arr(s.folders), files: arr(s.files), playlists: Array.isArray(s.playlists) ? s.playlists.map(cleanList).filter(Boolean) : [] }; } catch {}
  function arr(a) { return Array.isArray(a) ? a.filter((p) => typeof p === "string" && path.isAbsolute(p)).slice(0, MAX_FILES) : []; }
  function cleanList(p) {
    if (!p || typeof p !== "object") return null;
    const id = typeof p.id === "string" && /^[a-z0-9-]{6,40}$/i.test(p.id) ? p.id : crypto.randomUUID();
    return { id, name: text(p.name, 80) || "Playlist", items: arr(p.items).filter(isMedia) };
  }
  const save = () => { try { fs.writeFileSync(storeFile, JSON.stringify(store, null, 1)); } catch {} };
  const allow = (paths) => {
    let added = 0;
    const known = new Set(store.files.map((p) => p.toLowerCase()));
    for (const p of paths) if (isMedia(p) && !known.has(p.toLowerCase()) && !store.folders.some((f) => inside(p, f))) { store.files.push(p); known.add(p.toLowerCase()); added++; }
    if (store.files.length > MAX_FILES * 2) store.files = store.files.slice(-MAX_FILES * 2);
    if (added) save();
  };
  const allowed = (p) => {
    if (typeof p !== "string" || !path.isAbsolute(p)) return false;
    const full = path.resolve(p);
    if (inside(full, cacheDir)) return true;
    if (!isMedia(full)) return false;
    return store.folders.some((f) => inside(full, f)) || store.files.some((f) => same(f, full)) || store.playlists.some((l) => l.items.some((i) => same(i, full)));
  };

  // ── The little server the window plays from ─────────────────────────────────
  const token = crypto.randomBytes(24).toString("hex");
  let port = 0, starting = null;
  const TYPES = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/webm", jpg: "image/jpeg" };
  function serve(req, res) {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.searchParams.get("t") !== token) { res.writeHead(403); return res.end(); }
      if (url.pathname === "/art") return art(url.searchParams.get("p") || "", res);
      const file = url.searchParams.get("p") || "";
      if (url.pathname !== "/f" || !allowed(file) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      const size = fs.statSync(file).size;
      const type = TYPES[extOf(file)] || "application/octet-stream";
      const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || "").trim());
      if (m) {
        let start = m[1] !== "" ? Number(m[1]) : NaN, end = m[2] !== "" ? Number(m[2]) : size - 1;
        if (m[1] === "" && m[2] !== "") { start = Math.max(0, size - Number(m[2])); end = size - 1; }
        end = Math.min(end, size - 1);
        if (!(start >= 0) || start > end) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); return res.end(); }
        res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1, "Content-Type": type });
        return fs.createReadStream(file, { start, end }).on("error", () => res.destroy()).pipe(res);
      }
      res.writeHead(200, { "Content-Length": size, "Content-Type": type, "Accept-Ranges": "bytes" });
      fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
    } catch { try { res.writeHead(500); res.end(); } catch {} }
  }
  function start() {
    if (port) return Promise.resolve(port);
    if (!starting) starting = new Promise((resolve, reject) => {
      const server = http.createServer(serve);
      server.on("error", (e) => { starting = null; reject(e); });
      server.listen(0, "127.0.0.1", () => { port = server.address().port; server.unref?.(); resolve(port); });
    });
    return starting;
  }
  const urlOf = (p) => `http://127.0.0.1:${port}/f?p=${encodeURIComponent(p)}&t=${token}`;
  const artUrl = (p) => `http://127.0.0.1:${port}/art?p=${encodeURIComponent(p)}&t=${token}`;

  // ── Running FFmpeg / FFprobe ────────────────────────────────────────────────
  function run(bin, args, { onLine, timeoutMs = 60000, binary = false } = {}) {
    return new Promise((resolve) => {
      if (!bin) return resolve({ code: -1, out: binary ? Buffer.alloc(0) : "" });
      let proc;
      try { proc = spawn(bin, args, { windowsHide: true }); } catch { return resolve({ code: -1, out: binary ? Buffer.alloc(0) : "" }); }
      const chunks = []; let size = 0, rest = "";
      const timer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, timeoutMs);
      proc.stdout.on("data", (d) => {
        if (size < 20 * 1024 * 1024) { chunks.push(d); size += d.length; }
        if (onLine) { rest += d; const lines = rest.split(/\r?\n/); rest = lines.pop(); lines.forEach(onLine); }
      });
      proc.stderr.on("data", () => {});
      proc.on("error", () => { clearTimeout(timer); resolve({ code: -1, out: binary ? Buffer.alloc(0) : "" }); });
      proc.on("close", (code) => { clearTimeout(timer); const out = Buffer.concat(chunks); resolve({ code, out: binary ? out : out.toString("utf8") }); });
    });
  }

  // What's in a file: title, artist, album, length, picture size, codecs
  const metaFile = path.join(dataDir, "aura-media-meta.json");
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaFile, "utf8")) || {}; } catch {}
  let metaDirty = null;
  const keyOf = (p, st) => p + "|" + st.size + "|" + Math.round(st.mtimeMs);
  async function info(p) {
    let st; try { st = fs.statSync(p); } catch { return null; }
    const key = keyOf(p, st);
    if (meta[key]) return meta[key];
    const r = await run(FFPROBE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", p], { timeoutMs: 20000 });
    let out = { title: "", artist: "", album: "", duration: 0, art: false, width: 0, height: 0, vcodec: "", acodec: "" };
    try {
      const j = JSON.parse(r.out);
      // Most files keep titles with the file; Ogg and Opus keep them with the sound itself
      const tags = {};
      for (const src of [...(j.streams || []).filter((s) => s.codec_type === "audio").map((s) => s.tags), j.format?.tags]) for (const [k, v] of Object.entries(src || {})) tags[k.toLowerCase()] = v;
      const v = (j.streams || []).find((s) => s.codec_type === "video" && !(s.disposition?.attached_pic));
      const pic = (j.streams || []).find((s) => s.codec_type === "video" && s.disposition?.attached_pic);
      const a = (j.streams || []).find((s) => s.codec_type === "audio");
      out = { title: text(tags.title, 150), artist: text(tags.artist || tags.album_artist, 120), album: text(tags.album, 120), duration: Math.round(parseFloat(j.format?.duration) || 0),
        art: !!pic || !!v, width: v?.width || 0, height: v?.height || 0, vcodec: text(v?.codec_name, 20), acodec: text(a?.codec_name, 20) };
    } catch {}
    if (r.code === 0) {
      meta[key] = out;
      clearTimeout(metaDirty);
      metaDirty = setTimeout(() => { try { const keys = Object.keys(meta); if (keys.length > 20000) for (const k of keys.slice(0, keys.length - 20000)) delete meta[k]; fs.writeFileSync(metaFile, JSON.stringify(meta)); } catch {} }, 2000);
    }
    return out;
  }

  // A small picture: the album cover, or a frame from a video
  async function art(p, res) {
    try {
      if (!allowed(p) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
      const st = fs.statSync(p);
      const name = crypto.createHash("sha1").update(keyOf(p, st)).digest("hex") + ".jpg";
      const file = path.join(cacheDir, "art", name);
      if (!fs.existsSync(file)) {
        const m = await info(p);
        if (!m?.art) { res.writeHead(404); return res.end(); }
        const at = kindOf(p) === "video" ? ["-ss", String(Math.min(30, Math.max(1, Math.round((m.duration || 10) / 10))))] : [];
        const r = await run(FFMPEG, ["-v", "error", ...at, "-i", p, "-an", "-map", "0:v:0", "-frames:v", "1", "-vf", "scale=320:-2", "-f", "image2", "-c:v", "mjpeg", "pipe:1"], { binary: true, timeoutMs: 20000 });
        if (r.code !== 0 || !r.out.length) { res.writeHead(404); return res.end(); }
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, r.out);
      }
      const data = fs.readFileSync(file);
      res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": data.length, "Cache-Control": "max-age=86400" });
      res.end(data);
    } catch { try { res.writeHead(500); res.end(); } catch {} }
  }

  // ── Finding files ───────────────────────────────────────────────────────────
  function itemOf(p, st, folder) {
    return { path: p, name: path.basename(p, path.extname(p)), ext: extOf(p), kind: kindOf(p), size: st.size, added: Math.round(st.mtimeMs), folder: folder || path.dirname(p) };
  }
  function walk(folder, out = [], depth = 0) {
    if (out.length >= MAX_FILES || depth > MAX_DEPTH) return out;
    let list = [];
    try { list = fs.readdirSync(folder, { withFileTypes: true }); } catch { return out; }
    for (const d of list) {
      if (out.length >= MAX_FILES) break;
      const p = path.join(folder, d.name);
      if (d.isDirectory()) { if (!SKIP_DIRS.test(d.name)) walk(p, out, depth + 1); }
      else if (d.isFile() && isMedia(p)) { try { out.push(itemOf(p, fs.statSync(p))); } catch {} }
    }
    return out;
  }
  function expand(paths) {
    const out = [];
    for (const p of paths) {
      if (typeof p !== "string" || !path.isAbsolute(p)) continue;
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p, out);
      else if (st.isFile() && isMedia(p)) out.push(itemOf(path.resolve(p), st));
      if (out.length >= MAX_FILES) break;
    }
    return out;
  }

  // ── Converting what the window can't play ───────────────────────────────────
  const converting = new Map();
  function cacheTrim() {
    try {
      const files = fs.readdirSync(cacheDir).filter((n) => /\.(mp4|m4a)$/.test(n)).map((n) => { const f = path.join(cacheDir, n); const s = fs.statSync(f); return { f, size: s.size, used: s.atimeMs || s.mtimeMs }; }).sort((a, b) => a.used - b.used);
      let total = files.reduce((t, x) => t + x.size, 0);
      for (const x of files) { if (total <= CACHE_MAX) break; try { fs.unlinkSync(x.f); total -= x.size; } catch {} }
    } catch {}
  }
  async function convert(p, progress) {
    if (!allowed(p) || !fs.existsSync(p)) throw new Error("AURA can't open that file.");
    if (!FFMPEG) throw new Error("AURA can't convert this file because FFmpeg is missing.");
    const st = fs.statSync(p);
    const audio = kindOf(p) === "audio";
    const out = path.join(cacheDir, crypto.createHash("sha1").update(keyOf(p, st)).digest("hex") + (audio ? ".m4a" : ".mp4"));
    if (fs.existsSync(out)) { try { const now = new Date(); fs.utimesSync(out, now, fs.statSync(out).mtime); } catch {} return out; }
    if (converting.has(out)) return converting.get(out);
    const job = (async () => {
      fs.mkdirSync(cacheDir, { recursive: true });
      const m = await info(p) || {};
      const tmp = out + ".part" + (audio ? ".m4a" : ".mp4");
      const tick = (line) => { const x = /^out_time_(?:us|ms)=(\d+)/.exec(line); if (x && m.duration) progress(Math.min(99, Math.floor(Number(x[1]) / 1e6 / m.duration * 100))); };
      const base = ["-y", "-v", "error", "-nostats", "-progress", "pipe:1", "-i", p];
      const tries = audio
        ? [[...base, "-vn", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", tmp]]
        : [
          // Repackaging only (seconds), when the picture and sound are already in formats the window plays
          ...(/^(h264|hevc|vp9|av1)$/.test(m.vcodec) && /^(aac|mp3|opus|)$/.test(m.acodec) ? [[...base, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", tmp]] : []),
          [...base, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-movflags", "+faststart", tmp],
        ];
      for (const args of tries) {
        const r = await run(FFMPEG, args, { onLine: tick, timeoutMs: 3 * 60 * 60 * 1000 });
        if (r.code === 0 && fs.existsSync(tmp) && fs.statSync(tmp).size > 0) { fs.renameSync(tmp, out); cacheTrim(); return out; }
        try { fs.unlinkSync(tmp); } catch {}
      }
      throw new Error("AURA couldn't play or convert this file.");
    })();
    converting.set(out, job);
    try { return await job; } finally { converting.delete(out); }
  }

  // ── What the window asks for ────────────────────────────────────────────────
  const send = (ch, d) => { try { const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send(ch, d); } catch {} };
  const answer = (fn) => async (_e, ...args) => {
    try { return { success: true, ...(await fn(...args)) }; }
    catch (e) { return { success: false, error: e?.message || "Something went wrong." }; }
  };
  const pickFolder = async () => {
    const r = await dialog.showOpenDialog(getWindow() || undefined, { title: "Add a music or video folder", properties: ["openDirectory", "multiSelections"] });
    return r.canceled ? [] : r.filePaths;
  };
  const state = async () => ({ port: await start(), token, folders: store.folders, playlists: store.playlists, native: [...NATIVE], audio: AUDIO, video: VIDEO });
  if (ipcMain) {
    ipcMain.handle("media:state", answer(state));
    ipcMain.handle("media:add-folder", answer(async () => {
      const picked = (await pickFolder()).filter((f) => !store.folders.some((x) => same(x, f)));
      store.folders.push(...picked); save();
      return state();
    }));
    ipcMain.handle("media:remove-folder", answer(async (folder) => { store.folders = store.folders.filter((f) => !same(f, String(folder))); save(); return state(); }));
    ipcMain.handle("media:scan", answer(async () => {
      const items = [];
      for (const f of store.folders) { for (const it of walk(f)) { it.folder = f; items.push(it); } if (items.length >= MAX_FILES) break; }
      const known = new Set(items.map((i) => i.path.toLowerCase()));
      for (const it of expand(store.files)) if (!known.has(it.path.toLowerCase())) items.push(it);
      return { items: items.slice(0, MAX_FILES) };
    }));
    ipcMain.handle("media:info", answer(async (paths) => {
      const list = (Array.isArray(paths) ? paths : []).filter(allowed).slice(0, 60);
      const out = {};
      for (const p of list) out[p] = await info(p);
      return { info: out };
    }));
    ipcMain.handle("media:open-files", answer(async () => {
      const r = await dialog.showOpenDialog(getWindow() || undefined, { title: "Open music or videos", properties: ["openFile", "multiSelections"], filters: [{ name: "Music and videos", extensions: [...AUDIO, ...VIDEO] }] });
      if (r.canceled) return { items: [] };
      const items = expand(r.filePaths); allow(items.map((i) => i.path));
      return { items };
    }));
    // Files and folders dropped onto AURA (the paths come from Windows' drag and drop)
    ipcMain.handle("media:dropped", answer(async (paths) => {
      const items = expand((Array.isArray(paths) ? paths : []).slice(0, 200));
      allow(items.map((i) => i.path));
      const playlistFiles = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === "string" && PLAYLISTS.includes(extOf(p)) && fs.existsSync(p)).slice(0, 5);
      const playlists = [];
      for (const f of playlistFiles) playlists.push(importFile(f));
      return { items, playlists };
    }));
    ipcMain.handle("media:url", answer(async (p) => { await start(); if (!allowed(p)) throw new Error("AURA can't open that file."); return { url: urlOf(p), art: artUrl(p), native: NATIVE.has(extOf(p)) }; }));
    ipcMain.handle("media:convert", answer(async (p) => {
      await start();
      let last = -1;
      const file = await convert(p, (percent) => { if (percent !== last) { last = percent; send("media-progress", { path: p, percent }); } });
      return { url: urlOf(file) };
    }));
    ipcMain.handle("media:playlists-save", answer(async (lists) => {
      store.playlists = (Array.isArray(lists) ? lists : []).slice(0, 200).map(cleanList).filter(Boolean);
      save();
      return { playlists: store.playlists };
    }));
    ipcMain.handle("media:import", answer(async () => {
      const r = await dialog.showOpenDialog(getWindow() || undefined, { title: "Import a playlist", properties: ["openFile", "multiSelections"], filters: [{ name: "Playlists", extensions: PLAYLISTS }] });
      if (r.canceled) return { playlists: [] };
      return { playlists: r.filePaths.slice(0, 20).map(importFile) };
    }));
    ipcMain.handle("media:export", answer(async (id) => {
      const list = store.playlists.find((l) => l.id === id);
      if (!list) throw new Error("That playlist isn't there any more.");
      const r = await dialog.showSaveDialog(getWindow() || undefined, { title: "Export playlist", defaultPath: list.name.replace(/[<>:"/\\|?*]/g, "_") + ".m3u8", filters: [{ name: "Playlist", extensions: ["m3u8"] }] });
      if (r.canceled || !r.filePath) return { saved: false };
      fs.writeFileSync(r.filePath, m3u(list.name, list.items), "utf8");
      return { saved: true, file: r.filePath };
    }));
  }
  function importFile(f) {
    const parsed = parsePlaylist(fs.readFileSync(f, "utf8"), f);
    const { found, missing, skipped } = resolveEntries(parsed.entries, f);
    const list = cleanList({ name: parsed.name, items: [...found, ...missing] });
    store.playlists.push(list); save();
    return { ...list, missing: missing.length, skipped: skipped.length };
  }

  return { allowed, start, urlOf, convert, info, store: () => store, token };
}

module.exports = { create, parsePlaylist, resolveEntries, m3u, kindOf, isMedia, AUDIO, VIDEO };
