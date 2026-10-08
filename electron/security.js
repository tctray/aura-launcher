// AURA's safety rules for windows, links, permissions, games and clip files.
// main.js wires these in. The window (renderer) can ask for things, but these checks
// run in the main process, so a bug in a page can't get around them.
// Added by aura-security-setup.cjs.
const path = require("path");
const fs = require("fs");
const { fileURLToPath } = require("url");

const DEV_URL = "http://localhost:5173";

// ── Is this one of AURA's own pages? ─────────────────────────────────────────
// Installed app: a file inside AURA's own folder. While developing: the Vite server.
function isAppUrl(url, { appPath, dev = false } = {}) {
  if (typeof url !== "string" || !url) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol === "file:") {
    if (!appPath) return false;
    let file;
    try { file = fileURLToPath(u); } catch { return false; }
    return inside(appPath, file);
  }
  return dev && u.origin === DEV_URL;
}

// true when `child` is inside `parent` (Windows paths compared without case)
function inside(parent, child) {
  if (typeof parent !== "string" || typeof child !== "string" || !parent || !child) return false;
  const win = process.platform === "win32" || /^[A-Za-z]:[\\/]/.test(parent);
  const p = win ? path.win32 : path;
  const a = p.resolve(parent), b = p.resolve(child);
  const rel = win ? p.relative(a.toLowerCase(), b.toLowerCase()) : p.relative(a, b);
  return !!rel && !rel.startsWith("..") && !p.isAbsolute(rel);
}

// ── Opening links outside AURA ───────────────────────────────────────────────
// Only web pages, email, Steam's "play this game" links and AURA's own screenshots and clips.
// Anything else (file shares, ms-msdt:, search-ms:, programs on the PC) is refused.
const CLIP_TYPES = new Set([".mp4", ".webm", ".mkv", ".png", ".jpg", ".jpeg"]);
const isClipFile = (p) => typeof p === "string" && CLIP_TYPES.has(path.extname(p).toLowerCase());

function checkExternal(url, { clipFolder } = {}) {
  if (typeof url !== "string" || !url || url.length > 4096) return null;
  let u;
  try { u = new URL(url.trim()); } catch { return null; }
  if (u.protocol === "https:" || u.protocol === "http:") {
    if (u.username || u.password) return null;
    return { kind: "web", url: u.href };
  }
  if (u.protocol === "mailto:") return { kind: "web", url: u.href };
  if (u.protocol === "steam:" && /^steam:\/\/(rungameid|run|store|nav\/games\/details)\/\d{1,12}\/?$/i.test(u.href)) return { kind: "web", url: u.href };
  if (u.protocol === "file:") {
    let file;
    try { file = fileURLToPath(u); } catch {
      // "file:///C:/..." written by hand on Windows-style paths
      file = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
    }
    file = clipPath(file, clipFolder);
    if (file && isClipFile(file)) return { kind: "file", path: file };
  }
  return null;
}

function makeOpenExternal({ shell, getClipFolder, log = console.log }) {
  return async function safeOpenExternal(url) {
    const ok = checkExternal(url, { clipFolder: getClipFolder() });
    if (!ok) {
      log("Blocked a link AURA won't open:", String(url).slice(0, 120));
      return { success: false, error: "AURA only opens web links." };
    }
    try {
      if (ok.kind === "file") {
        const err = await shell.openPath(ok.path);
        return err ? { success: false, error: err } : { success: true };
      }
      await shell.openExternal(ok.url);
      return { success: true };
    } catch (e) {
      return { success: false, error: e && e.message ? e.message : "Couldn't open that link." };
    }
  };
}

// ── Clip files ───────────────────────────────────────────────────────────────
// A path the window sent, if it is inside the clip folder (and not a shortcut out of it)
function clipPath(p, clipFolder) {
  if (typeof p !== "string" || !p || p.length > 1024 || p.includes("\0")) return null;
  if (!inside(clipFolder, p)) return null;
  const win = process.platform === "win32" || /^[A-Za-z]:[\\/]/.test(clipFolder);
  const full = (win ? path.win32 : path).resolve(p);
  try { if (fs.lstatSync(full).isSymbolicLink()) return null; } catch {}
  return full;
}

// A file or folder name the user typed, or a game's name: no slashes, no "..", nothing Windows refuses
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
function safeName(name, fallback = "General") {
  let clean = String(name == null ? "" : name)
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, 100)
    .replace(/[\s.]+$/g, "");
  if (!clean || RESERVED.test(clean)) clean = fallback;
  return clean;
}

// ── Permissions (camera, microphone, screen, location...) ────────────────────
// AURA's own pages get what they ask for. Websites inside AURA (Social and Browser tabs,
// Twitch) get fullscreen and copy; the camera and microphone only after you say yes; nothing else.
const SITE_ALWAYS = new Set(["fullscreen", "clipboard-sanitized-write", "pointerLock", "keyboardLock"]);

function makePermissions({ dialog, BrowserWindow, isTrusted, getMainWindow }) {
  const yes = new Map(); // "origin|kind" -> true/false for this run of AURA

  const originOf = (url) => { try { return new URL(url).origin; } catch { return ""; } };
  const kindOf = (types) => {
    const t = Array.isArray(types) ? types : [];
    if (t.includes("video") && t.includes("audio")) return "camera and microphone";
    if (t.includes("video")) return "camera";
    return "microphone";
  };

  async function askMedia(wc, details) {
    const origin = originOf(details.requestingUrl || (wc && wc.getURL && wc.getURL()) || "");
    if (!/^https:\/\//.test(origin)) return false;
    const what = kindOf(details.mediaTypes);
    const key = origin + "|" + what;
    if (yes.has(key)) return yes.get(key);
    let parent = null;
    try { parent = BrowserWindow.fromWebContents((wc && wc.hostWebContents) || wc) || getMainWindow(); } catch { parent = getMainWindow(); }
    const opts = {
      type: "question", buttons: ["Allow", "Block"], defaultId: 1, cancelId: 1,
      title: "Allow " + what + "?",
      message: new URL(origin).host + " wants to use your " + what + ".",
      detail: "AURA will remember your answer until you close AURA.",
    };
    const { response } = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
    const ok = response === 0;
    yes.set(key, ok);
    return ok;
  }

  function lock(ses) {
    if (!ses || ses.__auraLocked) return;
    ses.__auraLocked = true;
    ses.setPermissionRequestHandler((wc, permission, callback, details = {}) => {
      if (isTrusted(wc, details)) return callback(true);
      if (SITE_ALWAYS.has(permission)) return callback(true);
      if (permission === "media" && !(details.mediaTypes || []).length) return callback(false);
      if (permission === "media") {
        askMedia(wc, details).then((ok) => callback(ok), () => callback(false));
        return;
      }
      callback(false);
    });
    ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details = {}) => {
      if (isTrusted(wc, details)) return true;
      if (SITE_ALWAYS.has(permission)) return true;
      if (permission === "media") {
        const origin = originOf(details.requestingUrl || requestingOrigin || "");
        for (const [key, ok] of yes) if (ok && key.startsWith(origin + "|")) return true;
      }
      return false;
    });
  }
  return { lock, remembered: yes };
}

// ── Games ────────────────────────────────────────────────────────────────────
// AURA only starts a game file you picked yourself or that an import found on this PC.
// Anything else (a game added on another PC, or from before this update) is confirmed once.
function makeGames({ file, dialog, getMainWindow, platform = process.platform }) {
  let approved = null;
  const p = platform === "win32" ? path.win32 : path;
  const keyOf = (x) => p.resolve(String(x)).toLowerCase();
  const load = () => {
    if (approved) return approved;
    try {
      const list = JSON.parse(fs.readFileSync(file, "utf8"));
      approved = new Set(Array.isArray(list) ? list.filter((x) => typeof x === "string") : []);
    } catch { approved = new Set(); }
    return approved;
  };
  const save = () => {
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify([...load()])); }
    catch (e) { console.error("Couldn't save the list of approved games:", e.message); }
  };
  function approve(exePath) {
    if (typeof exePath !== "string" || !exePath || exePath.length > 1024) return;
    load().add(keyOf(exePath));
    save();
  }
  function approveAll(games) {
    let changed = false;
    for (const g of Array.isArray(games) ? games : []) {
      const x = g && g.exePath;
      if (typeof x === "string" && x && x.length <= 1024 && !load().has(keyOf(x))) { load().add(keyOf(x)); changed = true; }
    }
    if (changed) save();
  }
  // null when the game may start, otherwise the reason it can't
  async function check(exePath) {
    if (typeof exePath !== "string" || !exePath.trim() || exePath.length > 1024 || exePath.includes("\0")) {
      return "This game doesn't have a valid file. Edit the game and pick its .exe again.";
    }
    if (!p.isAbsolute(exePath)) return "This game doesn't have a valid file. Edit the game and pick its .exe again.";
    const full = p.resolve(exePath);
    if (p.extname(full).toLowerCase() !== ".exe") return "AURA only starts .exe game files. Edit the game and pick its .exe.";
    let st;
    try { st = fs.statSync(full); } catch { return "That game file wasn't found. It may have been moved or uninstalled."; }
    if (!st.isFile()) return "That game file wasn't found. It may have been moved or uninstalled.";
    if (load().has(keyOf(full))) return null;
    const win = getMainWindow();
    const opts = {
      type: "question", buttons: ["Start game", "Cancel"], defaultId: 0, cancelId: 1,
      title: "Start this game?",
      message: "Start " + p.basename(full) + "?",
      detail: full + "\n\nAURA asks once for games added on another PC or before this update.",
    };
    const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    if (response !== 0) return "Cancelled.";
    approve(full);
    return null;
  }
  return { check, approve, approveAll, has: (x) => load().has(keyOf(x)) };
}

// ── Embedded pages (<webview>) ───────────────────────────────────────────────
// Whatever a page asks for, an embedded page never gets Node, a preload or AURA's bridges.
function hardenWebview(webPreferences, params) {
  delete webPreferences.preload;
  delete webPreferences.preloadURL;
  webPreferences.nodeIntegration = false;
  webPreferences.nodeIntegrationInSubFrames = false;
  webPreferences.contextIsolation = true;
  webPreferences.sandbox = true;
  webPreferences.webSecurity = true;
  webPreferences.allowRunningInsecureContent = false;
  const src = params && params.src;
  return !src || /^https:\/\//i.test(src) || src === "about:blank";
}

module.exports = {
  DEV_URL, isAppUrl, inside, checkExternal, makeOpenExternal, clipPath, isClipFile, safeName,
  makePermissions, makeGames, hardenWebview, CLIP_TYPES,
};
