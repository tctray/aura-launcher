#!/usr/bin/env node
/**
 * AURA — security fixes before a public release
 *
 * Fixes the code problems on the PRODUCTION BLOCKERS list of the AURA security audit:
 *   E1  The AURA window runs sandboxed with web security on (embedded pages can't reach your PC)
 *   E2  AURA's windows only show AURA's own pages; other links open in your browser
 *   E3  Only web, email and Steam links are opened outside AURA (no file shares, ms-msdt:, programs)
 *   E4  Websites inside AURA (Social, Browser, Twitch) ask before using your camera or microphone,
 *       and never get location or screen capture
 *   G1  AURA only starts .exe games you picked or imported; anything else asks you once
 *   F1  Delete only works on clips in your clip folder (and sends them to the Recycle Bin)
 *   F2  Rename only works on clips in your clip folder, and can't move or overwrite files
 *   F3  The clip player only serves clips and screenshots from your clip folder
 *   X1  The Discord login listener only answers this PC, checks the login really came from AURA,
 *       and closes after 5 minutes
 * Plus, while it's in there: game names can't put recordings outside the clip folder (F4),
 * trimming only works on clips (F5), Show in folder (F6), the game-folder check can't be tricked
 * into running PowerShell commands (G2), the installed app no longer reads a .env file (K2),
 * Twitch channel names and volume are checked (E8), the AURA Bar is sandboxed (E9), and
 * .gitignore is repaired so release/ and .env are never committed (P3).
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-security-setup.cjs
 *
 * What it does:
 *   - creates  electron/security.js     the safety rules
 *   - edits    your main file           uses them
 *   - edits    .gitignore               repaired
 *   - creates  tests/security.cjs       (only if AURA's checks are installed) checks for the above
 *
 * Every file it changes is copied to <name>.before-security.bak first.
 * To put everything back:                 node aura-security-setup.cjs --undo
 * To preview without changing anything:   node aura-security-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FILES = {"security":"// AURA's safety rules for windows, links, permissions, games and clip files.\n// main.js wires these in. The window (renderer) can ask for things, but these checks\n// run in the main process, so a bug in a page can't get around them.\n// Added by aura-security-setup.cjs.\nconst path = require(\"path\");\nconst fs = require(\"fs\");\nconst { fileURLToPath } = require(\"url\");\n\nconst DEV_URL = \"http://localhost:5173\";\n\n// ── Is this one of AURA's own pages? ─────────────────────────────────────────\n// Installed app: a file inside AURA's own folder. While developing: the Vite server.\nfunction isAppUrl(url, { appPath, dev = false } = {}) {\n  if (typeof url !== \"string\" || !url) return false;\n  let u;\n  try { u = new URL(url); } catch { return false; }\n  if (u.protocol === \"file:\") {\n    if (!appPath) return false;\n    let file;\n    try { file = fileURLToPath(u); } catch { return false; }\n    return inside(appPath, file);\n  }\n  return dev && u.origin === DEV_URL;\n}\n\n// true when `child` is inside `parent` (Windows paths compared without case)\nfunction inside(parent, child) {\n  if (typeof parent !== \"string\" || typeof child !== \"string\" || !parent || !child) return false;\n  const win = process.platform === \"win32\" || /^[A-Za-z]:[\\\\/]/.test(parent);\n  const p = win ? path.win32 : path;\n  const a = p.resolve(parent), b = p.resolve(child);\n  const rel = win ? p.relative(a.toLowerCase(), b.toLowerCase()) : p.relative(a, b);\n  return !!rel && !rel.startsWith(\"..\") && !p.isAbsolute(rel);\n}\n\n// ── Opening links outside AURA ───────────────────────────────────────────────\n// Only web pages, email, Steam's \"play this game\" links and AURA's own screenshots and clips.\n// Anything else (file shares, ms-msdt:, search-ms:, programs on the PC) is refused.\nconst CLIP_TYPES = new Set([\".mp4\", \".webm\", \".mkv\", \".png\", \".jpg\", \".jpeg\"]);\nconst isClipFile = (p) => typeof p === \"string\" && CLIP_TYPES.has(path.extname(p).toLowerCase());\n\nfunction checkExternal(url, { clipFolder } = {}) {\n  if (typeof url !== \"string\" || !url || url.length > 4096) return null;\n  let u;\n  try { u = new URL(url.trim()); } catch { return null; }\n  if (u.protocol === \"https:\" || u.protocol === \"http:\") {\n    if (u.username || u.password) return null;\n    return { kind: \"web\", url: u.href };\n  }\n  if (u.protocol === \"mailto:\") return { kind: \"web\", url: u.href };\n  if (u.protocol === \"steam:\" && /^steam:\\/\\/(rungameid|run|store|nav\\/games\\/details)\\/\\d{1,12}\\/?$/i.test(u.href)) return { kind: \"web\", url: u.href };\n  if (u.protocol === \"file:\") {\n    let file;\n    try { file = fileURLToPath(u); } catch {\n      // \"file:///C:/...\" written by hand on Windows-style paths\n      file = decodeURIComponent(u.pathname.replace(/^\\/+/, \"\"));\n    }\n    file = clipPath(file, clipFolder);\n    if (file && isClipFile(file)) return { kind: \"file\", path: file };\n  }\n  return null;\n}\n\nfunction makeOpenExternal({ shell, getClipFolder, log = console.log }) {\n  return async function safeOpenExternal(url) {\n    const ok = checkExternal(url, { clipFolder: getClipFolder() });\n    if (!ok) {\n      log(\"Blocked a link AURA won't open:\", String(url).slice(0, 120));\n      return { success: false, error: \"AURA only opens web links.\" };\n    }\n    try {\n      if (ok.kind === \"file\") {\n        const err = await shell.openPath(ok.path);\n        return err ? { success: false, error: err } : { success: true };\n      }\n      await shell.openExternal(ok.url);\n      return { success: true };\n    } catch (e) {\n      return { success: false, error: e && e.message ? e.message : \"Couldn't open that link.\" };\n    }\n  };\n}\n\n// ── Clip files ───────────────────────────────────────────────────────────────\n// A path the window sent, if it is inside the clip folder (and not a shortcut out of it)\nfunction clipPath(p, clipFolder) {\n  if (typeof p !== \"string\" || !p || p.length > 1024 || p.includes(\"\\0\")) return null;\n  if (!inside(clipFolder, p)) return null;\n  const win = process.platform === \"win32\" || /^[A-Za-z]:[\\\\/]/.test(clipFolder);\n  const full = (win ? path.win32 : path).resolve(p);\n  try { if (fs.lstatSync(full).isSymbolicLink()) return null; } catch {}\n  return full;\n}\n\n// A file or folder name the user typed, or a game's name: no slashes, no \"..\", nothing Windows refuses\nconst RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\\..*)?$/i;\nfunction safeName(name, fallback = \"General\") {\n  let clean = String(name == null ? \"\" : name)\n    .replace(/[\\u0000-\\u001f<>:\"/\\\\|?*]/g, \"_\")\n    .replace(/^[\\s.]+|[\\s.]+$/g, \"\")\n    .slice(0, 100)\n    .replace(/[\\s.]+$/g, \"\");\n  if (!clean || RESERVED.test(clean)) clean = fallback;\n  return clean;\n}\n\n// ── Permissions (camera, microphone, screen, location...) ────────────────────\n// AURA's own pages get what they ask for. Websites inside AURA (Social and Browser tabs,\n// Twitch) get fullscreen and copy; the camera and microphone only after you say yes; nothing else.\nconst SITE_ALWAYS = new Set([\"fullscreen\", \"clipboard-sanitized-write\", \"pointerLock\", \"keyboardLock\"]);\n\nfunction makePermissions({ dialog, BrowserWindow, isTrusted, getMainWindow }) {\n  const yes = new Map(); // \"origin|kind\" -> true/false for this run of AURA\n\n  const originOf = (url) => { try { return new URL(url).origin; } catch { return \"\"; } };\n  const kindOf = (types) => {\n    const t = Array.isArray(types) ? types : [];\n    if (t.includes(\"video\") && t.includes(\"audio\")) return \"camera and microphone\";\n    if (t.includes(\"video\")) return \"camera\";\n    return \"microphone\";\n  };\n\n  async function askMedia(wc, details) {\n    const origin = originOf(details.requestingUrl || (wc && wc.getURL && wc.getURL()) || \"\");\n    if (!/^https:\\/\\//.test(origin)) return false;\n    const what = kindOf(details.mediaTypes);\n    const key = origin + \"|\" + what;\n    if (yes.has(key)) return yes.get(key);\n    let parent = null;\n    try { parent = BrowserWindow.fromWebContents((wc && wc.hostWebContents) || wc) || getMainWindow(); } catch { parent = getMainWindow(); }\n    const opts = {\n      type: \"question\", buttons: [\"Allow\", \"Block\"], defaultId: 1, cancelId: 1,\n      title: \"Allow \" + what + \"?\",\n      message: new URL(origin).host + \" wants to use your \" + what + \".\",\n      detail: \"AURA will remember your answer until you close AURA.\",\n    };\n    const { response } = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);\n    const ok = response === 0;\n    yes.set(key, ok);\n    return ok;\n  }\n\n  function lock(ses) {\n    if (!ses || ses.__auraLocked) return;\n    ses.__auraLocked = true;\n    ses.setPermissionRequestHandler((wc, permission, callback, details = {}) => {\n      if (isTrusted(wc, details)) return callback(true);\n      if (SITE_ALWAYS.has(permission)) return callback(true);\n      if (permission === \"media\" && !(details.mediaTypes || []).length) return callback(false);\n      if (permission === \"media\") {\n        askMedia(wc, details).then((ok) => callback(ok), () => callback(false));\n        return;\n      }\n      callback(false);\n    });\n    ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details = {}) => {\n      if (isTrusted(wc, details)) return true;\n      if (SITE_ALWAYS.has(permission)) return true;\n      if (permission === \"media\") {\n        const origin = originOf(details.requestingUrl || requestingOrigin || \"\");\n        for (const [key, ok] of yes) if (ok && key.startsWith(origin + \"|\")) return true;\n      }\n      return false;\n    });\n  }\n  return { lock, remembered: yes };\n}\n\n// ── Games ────────────────────────────────────────────────────────────────────\n// AURA only starts a game file you picked yourself or that an import found on this PC.\n// Anything else (a game added on another PC, or from before this update) is confirmed once.\nfunction makeGames({ file, dialog, getMainWindow, platform = process.platform }) {\n  let approved = null;\n  const p = platform === \"win32\" ? path.win32 : path;\n  const keyOf = (x) => p.resolve(String(x)).toLowerCase();\n  const load = () => {\n    if (approved) return approved;\n    try {\n      const list = JSON.parse(fs.readFileSync(file, \"utf8\"));\n      approved = new Set(Array.isArray(list) ? list.filter((x) => typeof x === \"string\") : []);\n    } catch { approved = new Set(); }\n    return approved;\n  };\n  const save = () => {\n    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify([...load()])); }\n    catch (e) { console.error(\"Couldn't save the list of approved games:\", e.message); }\n  };\n  function approve(exePath) {\n    if (typeof exePath !== \"string\" || !exePath || exePath.length > 1024) return;\n    load().add(keyOf(exePath));\n    save();\n  }\n  function approveAll(games) {\n    let changed = false;\n    for (const g of Array.isArray(games) ? games : []) {\n      const x = g && g.exePath;\n      if (typeof x === \"string\" && x && x.length <= 1024 && !load().has(keyOf(x))) { load().add(keyOf(x)); changed = true; }\n    }\n    if (changed) save();\n  }\n  // null when the game may start, otherwise the reason it can't\n  async function check(exePath) {\n    if (typeof exePath !== \"string\" || !exePath.trim() || exePath.length > 1024 || exePath.includes(\"\\0\")) {\n      return \"This game doesn't have a valid file. Edit the game and pick its .exe again.\";\n    }\n    if (!p.isAbsolute(exePath)) return \"This game doesn't have a valid file. Edit the game and pick its .exe again.\";\n    const full = p.resolve(exePath);\n    if (p.extname(full).toLowerCase() !== \".exe\") return \"AURA only starts .exe game files. Edit the game and pick its .exe.\";\n    let st;\n    try { st = fs.statSync(full); } catch { return \"That game file wasn't found. It may have been moved or uninstalled.\"; }\n    if (!st.isFile()) return \"That game file wasn't found. It may have been moved or uninstalled.\";\n    if (load().has(keyOf(full))) return null;\n    const win = getMainWindow();\n    const opts = {\n      type: \"question\", buttons: [\"Start game\", \"Cancel\"], defaultId: 0, cancelId: 1,\n      title: \"Start this game?\",\n      message: \"Start \" + p.basename(full) + \"?\",\n      detail: full + \"\\n\\nAURA asks once for games added on another PC or before this update.\",\n    };\n    const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);\n    if (response !== 0) return \"Cancelled.\";\n    approve(full);\n    return null;\n  }\n  return { check, approve, approveAll, has: (x) => load().has(keyOf(x)) };\n}\n\n// ── Embedded pages (<webview>) ───────────────────────────────────────────────\n// Whatever a page asks for, an embedded page never gets Node, a preload or AURA's bridges.\nfunction hardenWebview(webPreferences, params) {\n  delete webPreferences.preload;\n  delete webPreferences.preloadURL;\n  webPreferences.nodeIntegration = false;\n  webPreferences.nodeIntegrationInSubFrames = false;\n  webPreferences.contextIsolation = true;\n  webPreferences.sandbox = true;\n  webPreferences.webSecurity = true;\n  webPreferences.allowRunningInsecureContent = false;\n  const src = params && params.src;\n  return !src || /^https:\\/\\//i.test(src) || src === \"about:blank\";\n}\n\nmodule.exports = {\n  DEV_URL, isAppUrl, inside, checkExternal, makeOpenExternal, clipPath, isClipFile, safeName,\n  makePermissions, makeGames, hardenWebview, CLIP_TYPES,\n};\n","test":"// Security rules (electron/security.js) and how the main file uses them.\n// Added by aura-security-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst os = require(\"os\");\nconst path = require(\"path\");\nconst ROOT = path.join(__dirname, \"..\");\nconst sec = require(path.resolve(process.argv[2] || path.join(ROOT, \"electron\", \"security.js\")));\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok ? \"\" : \"  \" + JSON.stringify(extra))); };\nconst { pathToFileURL } = require(\"url\");\n\n(async () => {\n  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), \"aura-sec-\")));\n  const appPath = path.join(dir, \"app\");\n  const clips = path.join(dir, \"Clips\");\n  fs.mkdirSync(path.join(appPath, \"dist\"), { recursive: true });\n  fs.mkdirSync(path.join(clips, \"Elden Ring\"), { recursive: true });\n  fs.mkdirSync(path.join(clips, \"Screenshots\"), { recursive: true });\n  const clip = path.join(clips, \"Elden Ring\", \"clip-1.mp4\"); fs.writeFileSync(clip, \"x\");\n  const shot = path.join(clips, \"Screenshots\", \"s.png\"); fs.writeFileSync(shot, \"x\");\n  const secret = path.join(dir, \"passwords.txt\"); fs.writeFileSync(secret, \"x\");\n  const note = path.join(clips, \"notes.txt\"); fs.writeFileSync(note, \"x\");\n\n  console.log(\"1. AURA's own pages\");\n  const page = pathToFileURL(path.join(appPath, \"dist\", \"index.html\")).href;\n  check(\"the installed app's page is AURA's\", sec.isAppUrl(page, { appPath }));\n  check(\"with a #page on the end too\", sec.isAppUrl(page + \"#aurabar\", { appPath }));\n  check(\"a file outside AURA's folder isn't\", !sec.isAppUrl(pathToFileURL(secret).href, { appPath }));\n  check(\"a look-alike folder isn't\", !sec.isAppUrl(pathToFileURL(appPath + \"-evil/dist/index.html\").href, { appPath }));\n  check(\"websites aren't\", !sec.isAppUrl(\"https://evil.example/\", { appPath }) && !sec.isAppUrl(\"http://localhost:5173/\", { appPath }));\n  check(\"the dev server only counts while developing\", sec.isAppUrl(\"http://localhost:5173/#x\", { appPath, dev: true }) && !sec.isAppUrl(\"http://localhost:5174/\", { appPath, dev: true }));\n  check(\"rubbish isn't\", !sec.isAppUrl(\"\", { appPath }) && !sec.isAppUrl(null, { appPath }) && !sec.isAppUrl(\"javascript:alert(1)\", { appPath }));\n\n  console.log(\"2. Links that open outside AURA\");\n  const ext = (u) => sec.checkExternal(u, { clipFolder: clips });\n  check(\"web links open\", ext(\"https://www.twitch.tv/x\")?.kind === \"web\" && ext(\"http://example.com\")?.kind === \"web\");\n  check(\"email links open\", ext(\"mailto:?subject=hi\")?.kind === \"web\");\n  check(\"Steam play links open\", ext(\"steam://rungameid/570\")?.kind === \"web\");\n  check(\"other Steam commands don't\", !ext(\"steam://install/570/../../x\") && !ext(\"steam://openurl/https://evil.example\"));\n  for (const bad of [\"file://evil.example/share/x.exe\", \"\\\\\\\\evil.example\\\\share\\\\x.exe\", \"ms-msdt:/id PCWDiagnostic\", \"search-ms:query=x&crumb=location:\\\\\\\\evil\", \"ms-settings:\", \"javascript:alert(1)\", \"vbscript:x\", \"calculator:\", \"https://user:pass@example.com/\"]) {\n    check(\"refused: \" + bad, !ext(bad));\n  }\n  check(\"a screenshot in the clip folder opens\", ext(pathToFileURL(shot).href)?.path === shot);\n  check(\"a clip opens\", ext(pathToFileURL(clip).href)?.kind === \"file\");\n  check(\"other files on the PC don't\", !ext(pathToFileURL(secret).href) && !ext(pathToFileURL(note).href));\n  check(\"a way out of the clip folder doesn't\", !ext(pathToFileURL(path.join(clips, \"..\", \"passwords.txt\")).href));\n  const opened = [];\n  const open = sec.makeOpenExternal({ shell: { openExternal: async (u) => opened.push([\"web\", u]), openPath: async (p) => { opened.push([\"file\", p]); return \"\"; } }, getClipFolder: () => clips, log: () => {} });\n  check(\"opening a web link works\", (await open(\"https://example.com/a\")).success && opened[0][1] === \"https://example.com/a\");\n  check(\"opening a blocked link says so and opens nothing\", !(await open(\"ms-msdt:/id x\")).success && opened.length === 1);\n  check(\"a screenshot opens in its own app\", (await open(pathToFileURL(shot).href)).success && opened[1][0] === \"file\");\n\n  console.log(\"3. Clip files\");\n  check(\"a clip in the folder is fine\", sec.clipPath(clip, clips) === clip);\n  check(\"the folder itself isn't a clip\", sec.clipPath(clips, clips) === null);\n  check(\"a file outside isn't\", sec.clipPath(secret, clips) === null);\n  check(\"..\\\\ tricks aren't\", sec.clipPath(path.join(clips, \"Elden Ring\", \"..\", \"..\", \"passwords.txt\"), clips) === null);\n  check(\"a look-alike folder isn't\", sec.clipPath(clips + \"Evil\" + path.sep + \"x.mp4\", clips) === null);\n  check(\"rubbish isn't\", sec.clipPath(\"\", clips) === null && sec.clipPath(null, clips) === null && sec.clipPath(clip + \"\\0.mp4\", clips) === null && sec.clipPath({}, clips) === null);\n  try {\n    const link = path.join(clips, \"link.mp4\"); fs.symlinkSync(secret, link);\n    check(\"a shortcut out of the folder isn't\", sec.clipPath(link, clips) === null);\n  } catch { console.log(\"  (skipped the shortcut check: this PC doesn't allow making one)\"); }\n  check(\"Windows paths are compared without case\", sec.inside(\"C:\\\\Users\\\\Me\\\\Clips\", \"c:\\\\users\\\\me\\\\clips\\\\Game\\\\a.mp4\") && !sec.inside(\"C:\\\\Users\\\\Me\\\\Clips\", \"C:\\\\Users\\\\Me\\\\ClipsX\\\\a.mp4\") && !sec.inside(\"C:\\\\Users\\\\Me\\\\Clips\", \"C:\\\\Users\\\\Me\\\\Clips\\\\..\\\\a.mp4\"));\n  check(\"only clip and picture types count\", sec.isClipFile(\"a.MP4\") && sec.isClipFile(\"a.webm\") && sec.isClipFile(\"a.png\") && !sec.isClipFile(\"a.exe\") && !sec.isClipFile(\"a.lnk\") && !sec.isClipFile(\"a.txt\"));\n\n  console.log(\"4. Names typed for clips, and game names used for folders\");\n  check(\"a normal name stays\", sec.safeName(\"Elden Ring\") === \"Elden Ring\" && sec.safeName(\"Épique run (2)\") === \"Épique run (2)\");\n  check(\"slashes can't make a path\", !/[\\\\/]/.test(sec.safeName(\"..\\\\..\\\\Startup\\\\x\")) && !/[\\\\/]/.test(sec.safeName(\"../../x\")));\n  check(\".. alone is refused\", sec.safeName(\"..\") === \"General\" && sec.safeName(\" . \") === \"General\" && sec.safeName(\"..\", \"\") === \"\");\n  check(\"names Windows refuses are refused\", sec.safeName(\"CON\") === \"General\" && sec.safeName(\"nul.txt\") === \"General\" && sec.safeName(\"a:b*c?\") === \"a_b_c_\");\n  check(\"nothing becomes General\", sec.safeName(\"\") === \"General\" && sec.safeName(null) === \"General\");\n  check(\"very long names are cut\", sec.safeName(\"x\".repeat(500)).length === 100);\n\n  console.log(\"5. Games\");\n  const exe = path.join(dir, \"Game\", \"game.exe\"); fs.mkdirSync(path.dirname(exe), { recursive: true }); fs.writeFileSync(exe, \"MZ\");\n  const other = path.join(dir, \"Game\", \"other.exe\"); fs.writeFileSync(other, \"MZ\");\n  const bat = path.join(dir, \"Game\", \"run.bat\"); fs.writeFileSync(bat, \"x\");\n  let asked = 0, answer = 1;\n  const dialog = { showMessageBox: async () => { asked++; return { response: answer }; } };\n  const store = path.join(dir, \"userData\", \"approved-games.json\");\n  const games = sec.makeGames({ file: store, dialog, getMainWindow: () => null, platform: \"linux\" });\n  check(\"a game you picked starts without asking\", (games.approve(exe), (await games.check(exe)) === null && asked === 0));\n  check(\"only .exe files start\", /only starts \\.exe/.test(await games.check(bat)) && asked === 0);\n  check(\"a missing file says so\", /wasn't found/.test(await games.check(path.join(dir, \"Game\", \"gone.exe\"))));\n  check(\"no path, or a relative one, is refused\", /valid file/.test(await games.check(\"\")) && /valid file/.test(await games.check(\"game.exe\")) && /valid file/.test(await games.check({})));\n  check(\"a game nobody picked asks first, and Cancel stops it\", (await games.check(other)) === \"Cancelled.\" && asked === 1);\n  answer = 0;\n  check(\"saying Start runs it\", (await games.check(other)) === null && asked === 2);\n  check(\"and it isn't asked again\", (await games.check(other)) === null && asked === 2);\n  const again = sec.makeGames({ file: store, dialog, getMainWindow: () => null, platform: \"linux\" });\n  check(\"the list is kept after AURA restarts\", again.has(exe) && again.has(other));\n  again.approveAll([{ exePath: path.join(dir, \"Game\", \"imported.exe\") }, null, { exePath: 5 }]);\n  check(\"imports are remembered\", again.has(path.join(dir, \"Game\", \"imported.exe\")));\n  fs.writeFileSync(store, \"not json\");\n  check(\"a damaged list just means asking again\", !sec.makeGames({ file: store, dialog, getMainWindow: () => null, platform: \"linux\" }).has(exe));\n\n  console.log(\"6. Permissions\");\n  let handler, checker;\n  const ses = { setPermissionRequestHandler: (f) => { handler = f; }, setPermissionCheckHandler: (f) => { checker = f; } };\n  let promptAnswer = 0; let prompts = 0;\n  const perms = sec.makePermissions({\n    dialog: { showMessageBox: async () => { prompts++; return { response: promptAnswer }; } },\n    BrowserWindow: { fromWebContents: () => null },\n    isTrusted: (wc) => !!(wc && wc.trusted),\n    getMainWindow: () => null,\n  });\n  perms.lock(ses);\n  const ask = (wc, permission, details) => new Promise((r) => handler(wc, permission, r, details));\n  const site = { trusted: false, getURL: () => \"https://www.instagram.com/\" };\n  check(\"AURA's pages get the microphone and screen\", (await ask({ trusted: true }, \"media\", { mediaTypes: [\"audio\"] })) && (await ask({ trusted: true }, \"display-capture\", {})));\n  check(\"websites get fullscreen without asking\", await ask(site, \"fullscreen\", {}));\n  check(\"websites never get location, notifications or programs\", !(await ask(site, \"geolocation\", {})) && !(await ask(site, \"notifications\", {})) && !(await ask(site, \"openExternal\", {})) && prompts === 0);\n  promptAnswer = 1;\n  check(\"a website asking for the camera is asked about, and Block blocks it\", !(await ask(site, \"media\", { mediaTypes: [\"video\"], requestingUrl: \"https://www.instagram.com/x\" })) && prompts === 1);\n  check(\"the answer is remembered\", !(await ask(site, \"media\", { mediaTypes: [\"video\"], requestingUrl: \"https://www.instagram.com/y\" })) && prompts === 1);\n  promptAnswer = 0;\n  check(\"Allow allows the microphone for that site\", (await ask(site, \"media\", { mediaTypes: [\"audio\"], requestingUrl: \"https://www.messenger.com/\" })) && prompts === 2);\n  check(\"and the browser's check agrees\", checker(site, \"media\", \"https://www.messenger.com\", { requestingUrl: \"https://www.messenger.com/t/1\" }) === true && checker(site, \"media\", \"https://evil.example\", {}) === false);\n  check(\"a page that isn't https is never offered the camera\", !(await ask(site, \"media\", { mediaTypes: [\"video\"], requestingUrl: \"http://evil.example/\" })) && prompts === 2);\n  check(\"checks: AURA yes, websites only the safe ones\", checker({ trusted: true }, \"media\", \"\", {}) === true && checker(site, \"geolocation\", \"https://x\", {}) === false && checker(site, \"fullscreen\", \"https://x\", {}) === true);\n  const before = handler; perms.lock(ses);\n  check(\"locking a session twice is harmless\", handler === before);\n\n  console.log(\"7. Embedded pages\");\n  const prefs = { preload: \"C:\\\\evil.js\", nodeIntegration: true, contextIsolation: false, sandbox: false, webSecurity: false };\n  check(\"an https page may be embedded\", sec.hardenWebview(prefs, { src: \"https://www.instagram.com/\" }));\n  check(\"but never with Node, a preload or without the sandbox\", !prefs.preload && prefs.nodeIntegration === false && prefs.contextIsolation === true && prefs.sandbox === true && prefs.webSecurity === true);\n  check(\"file: and javascript: pages can't be embedded\", !sec.hardenWebview({}, { src: \"file:///C:/x.html\" }) && !sec.hardenWebview({}, { src: \"javascript:alert(1)\" }));\n\n  console.log(\"8. The main file uses all of this\");\n  const mainFile = path.join(ROOT, \"electron\", \"main.js\");\n  const main = fs.existsSync(mainFile) ? fs.readFileSync(mainFile, \"utf8\") : \"\";\n  if (!main) console.log(\"  (skipped: electron/main.js not found)\");\n  else {\n    const handlerOf = (name) => { const i = main.indexOf('ipcMain.handle(\"' + name + '\"'); return i < 0 ? \"\" : main.slice(i, main.indexOf(\"\\n});\", i) + 4); };\n    const createWindow = main.slice(main.indexOf(\"function createWindow\"), main.indexOf(\"function createWindow\") + 1500);\n    check(\"the AURA window is sandboxed with web security on\", /sandbox: true/.test(createWindow) && /webSecurity: true/.test(createWindow) && !/allowRunningInsecureContent: true/.test(createWindow));\n    check(\"the AURA Bar is sandboxed\", /auraBar = new BrowserWindow\\(\\{[\\s\\S]{0,700}?sandbox: true/.test(main));\n    check(\"nothing turns web security off\", !/webSecurity:\\s*false/.test(main) && !/nodeIntegration:\\s*true/.test(main) && !/contextIsolation:\\s*false/.test(main));\n    check(\"AURA's windows can't be sent to other sites\", /contents\\.on\\(\"will-navigate\", stay\\)/.test(main) && /will-attach-webview/.test(main));\n    check(\"links go through the safe opener\", /ipcMain\\.handle\\(\"open-external\", async \\(_e, url\\) => safeOpenExternal\\(url\\)\\)/.test(main) && !/else shell\\.openExternal\\(url\\)/.test(main));\n    check(\"permissions are locked for every session\", /app\\.on\\(\"session-created\", \\(ses\\) => permissions\\.lock\\(ses\\)\\)/.test(main) && !/setPermissionCheckHandler\\(\\(\\) => true\\)/.test(main));\n    check(\"only AURA's pages capture the screen\", /return callback\\(\\{\\}\\)/.test(main));\n    check(\"games are checked before they start\", /approvedGames\\.check\\(exePath\\)/.test(handlerOf(\"launch-game\")));\n    check(\"delete, rename, trim and the clip player stay in the clip folder\",\n      /security\\.clipPath/.test(handlerOf(\"delete-clip\")) && /security\\.clipPath/.test(handlerOf(\"rename-clip\")) && /security\\.clipPath/.test(handlerOf(\"trim-clip\")) && /security\\.clipPath\\(asked, getClipFolder\\(\\)\\)/.test(main));\n    check(\"game names can't leave the clip folder\", !/path\\.join\\(getClipFolder\\(\\), gameName \\|\\| \"General\"\\)/.test(main));\n    check(\"the Discord listener only answers this PC and checks the login\", /authServer\\.listen\\(3000, \"127\\.0\\.0\\.1\"/.test(main) && /state=\\$\\{discordState\\}/.test(main) && /state !== expected/.test(main));\n    check(\"PowerShell never gets a game folder in its command\", /\\$env:AURA_DIR/.test(main) && !/StartsWith\\('\\$\\{safe\\}'/.test(main));\n    check(\"the installed app doesn't read .env\", !/resEnv/.test(main));\n  }\n\n  fs.rmSync(dir, { recursive: true, force: true });\n  console.log(failed ? `\\n${failed} FAILED` : \"\\nall passed\");\n  process.exit(failed ? 1 : 0);\n})().catch((e) => { console.error(e); process.exit(1); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-security.bak";
const MARK = "Added by aura-security-setup.cjs";
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

// Replace exactly one match of `re` (or do nothing when `done` is already in the text)
function swap(state, { what, re, to, done, optional }) {
  if (done && done.test(state.text)) return;
  const hits = state.text.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"));
  if (!hits || hits.length !== 1) {
    if (optional) { state.skipped.push(what); return; }
    throw new Error(what + (hits ? " (found it " + hits.length + " times)" : ""));
  }
  state.text = state.text.replace(re, typeof to === "function" ? to : () => to);
  state.notes.push(what);
}

// ── Main file ────────────────────────────────────────────────────────────────
function editMain(text) {
  const s = { text, notes: [], skipped: [] };

  // The safety rules, loaded near the top
  swap(s, {
    what: "loads the safety rules (security.js)",
    done: /require\(\s*["']\.\/security["']\s*\)/,
    re: /^(require\("\.\/errorlog"\)\.register\(require\("electron"\)\);\n)/m,
    to: (m) => m +
      "// Safety rules for windows, links, permissions, games and clip files (see security.js)\n" +
      "const security = require(\"./security\");\n" +
      "const isAppPage = (url) => security.isAppUrl(url, { appPath: app.getAppPath(), dev: !app.isPackaged });\n" +
      "const safeOpenExternal = security.makeOpenExternal({ shell, getClipFolder: () => getClipFolder() });\n" +
      "// AURA's own pages, in AURA's own windows (not embedded sites or frames inside them)\n" +
      "function isTrustedPage(wc, details = {}) {\n" +
      "  try {\n" +
      "    if (!wc || (wc.isDestroyed && wc.isDestroyed()) || wc.getType() !== \"window\") return false;\n" +
      "    if (details.isMainFrame === false) return false;\n" +
      "    return isAppPage(details.requestingUrl || wc.getURL());\n" +
      "  } catch { return false; }\n" +
      "}\n" +
      "const permissions = security.makePermissions({ dialog, BrowserWindow, isTrusted: isTrustedPage, getMainWindow: () => mainWin });\n" +
      "app.on(\"session-created\", (ses) => permissions.lock(ses));\n" +
      "// Games you picked or imported on this PC (the window can't add to this list)\n" +
      "const approvedGames = security.makeGames({ file: path.join(app.getPath(\"userData\"), \"approved-games.json\"), dialog, getMainWindow: () => mainWin });\n",
  });

  // Where every window and embedded page may go
  swap(s, {
    what: "AURA's windows only show AURA's pages; other links open in your browser",
    done: /will-attach-webview/,
    re: /^app\.on\("web-contents-created", \(_e, contents\) => \{\n  if \(contents\.getType\(\) !== "webview"\) return;\n[\s\S]*?\n\}\);\n/m,
    to: [
      "// Every window and embedded page: where it may go, and what opens outside AURA",
      "app.on(\"web-contents-created\", (_e, contents) => {",
      "  const type = contents.getType();",
      "  const outside = (url) => { if (/^(https?|mailto):/i.test(String(url))) safeOpenExternal(url); };",
      "  if (type === \"webview\") {",
      "    // The Browser tab can go anywhere on the web; the social tabs stay on their own sites",
      "    const isBrowserTab = contents.session === require(\"electron\").session.fromPartition(\"persist:social-browser\");",
      "    contents.setWindowOpenHandler(({ url }) => {",
      "      if ((isBrowserTab && /^https?:\\/\\//i.test(url)) || isSocialHost(url)) contents.loadURL(url);",
      "      else outside(url);",
      "      return { action: \"deny\" };",
      "    });",
      "    contents.on(\"will-navigate\", (e, url) => {",
      "      if (isBrowserTab ? !/^(https?:|about:blank)/i.test(url) : !isSocialHost(url)) { e.preventDefault(); outside(url); }",
      "    });",
      "    return;",
      "  }",
      "  if (type === \"window\") {",
      "    // AURA's own windows only ever show AURA's own pages",
      "    const stay = (e, url) => { if (!isAppPage(url)) { e.preventDefault(); outside(url); } };",
      "    contents.on(\"will-navigate\", stay);",
      "    contents.on(\"will-redirect\", stay);",
      "    contents.setWindowOpenHandler(({ url }) => { outside(url); return { action: \"deny\" }; });",
      "    // Embedded pages never get Node, a preload or AURA's bridges",
      "    contents.on(\"will-attach-webview\", (e, webPreferences, params) => {",
      "      if (!security.hardenWebview(webPreferences, params)) e.preventDefault();",
      "    });",
      "    return;",
      "  }",
      "  // Twitch player and chat: stay on Twitch; anything else opens in your browser",
      "  const onTwitch = (url) => { try { const h = new URL(url).hostname; return h === \"twitch.tv\" || h.endsWith(\".twitch.tv\"); } catch { return false; } };",
      "  contents.on(\"will-navigate\", (e, url) => { if (!onTwitch(url)) { e.preventDefault(); outside(url); } });",
      "  contents.setWindowOpenHandler(({ url }) => { outside(url); return { action: \"deny\" }; });",
      "});",
      "",
    ].join("\n"),
  });

  // .env is for development only
  swap(s, {
    what: "the installed app no longer reads a .env file",
    done: /if \(!app\.isPackaged\) \{\n  const devEnv/,
    re: /^\/\/ Load \.env[^\n]*\n(?:\/\/[^\n]*\n)*const devEnv = [^\n]*\nconst pkgEnv = [^\n]*\nconst resEnv = [^\n]*\n\nif\s+\(fs\.existsSync\(devEnv\)\)[^\n]*\nelse if \(resEnv[^\n]*\nelse if \(fs\.existsSync\(pkgEnv\)\)[^\n]*\n/m,
    to: [
      "// .env is only read while developing. Real keys live on the AURA server, never in the app.",
      "if (!app.isPackaged) {",
      "  const devEnv = path.join(__dirname, \"../.env\");",
      "  if (fs.existsSync(devEnv)) require(\"dotenv\").config({ path: devEnv });",
      "}",
      "",
    ].join("\n"),
  });

  // The main window: sandbox and web security on
  swap(s, {
    what: "the AURA window runs sandboxed with web security on",
    done: /webviewTag: true,\n\s*webSecurity: true,/,
    re: /(webviewTag: true,\n\s*)webSecurity: false,(\n[\s\S]{0,400}?)\n\s*allowRunningInsecureContent: true,(\n\s*)sandbox: false,/,
    to: (_m, a, b, c) => a + "webSecurity: true," + b + c + "sandbox: true,",
  });

  // Permissions
  swap(s, {
    what: "websites inside AURA ask before using the camera or microphone",
    done: /permissions\.lock\(mainWin\.webContents\.session\)/,
    re: /^  \/\/ Allow getUserMedia with desktop capture source\n  mainWin\.webContents\.session\.setPermissionRequestHandler\([\s\S]*?\n  \}\);\n\n  mainWin\.webContents\.session\.setPermissionCheckHandler\(\(\) => true\);\n/m,
    to: "  // AURA's own pages may use the microphone and capture the screen; websites inside AURA\n  // ask you first and never get the rest (see security.js)\n  permissions.lock(mainWin.webContents.session);\n",
  });
  swap(s, {
    what: "only AURA's own pages can capture the screen",
    done: /Only AURA's own pages may capture the screen/,
    re: /(mainWin\.webContents\.session\.setDisplayMediaRequestHandler\(\(request, callback\) => \{\n)/,
    to: (m) => m + "    // Only AURA's own pages may capture the screen\n    if (!request.frame || request.frame.parent || !isAppPage(request.frame.url)) return callback({});\n",
  });

  // The AURA Bar
  swap(s, {
    what: "the AURA Bar runs sandboxed",
    done: /auraBar = new BrowserWindow\(\{[\s\S]{0,700}?sandbox: true,/,
    re: /(auraBar = new BrowserWindow\(\{[\s\S]{0,700}?)sandbox: false,/,
    to: (_m, a) => a + "sandbox: true,",
  });

  // The clip player only serves clips from the clip folder
  swap(s, {
    what: "the clip player only serves clips and screenshots from your clip folder",
    done: /Only clips and screenshots from the clip folder/,
    re: /^      const rawPath = decodeURIComponent\(url\.pathname\.slice\(1\)\);\n[\s\S]*?\n        fs\.createReadStream\(filePath\)\.pipe\(res\);\n      \}\n/m,
    to: [
      "      // Only clips and screenshots from the clip folder (see security.js)",
      "      let asked = \"\";",
      "      try { asked = decodeURIComponent(url.pathname.slice(1)); } catch {}",
      "      if (process.platform === \"win32\") asked = asked.replace(/\\//g, \"\\\\\");",
      "      const filePath = security.clipPath(asked, getClipFolder());",
      "      if (!filePath || !security.isClipFile(filePath) || !fs.existsSync(filePath)) {",
      "        res.writeHead(404);",
      "        res.end(\"Not found\");",
      "        return;",
      "      }",
      "      const fileSize = fs.statSync(filePath).size;",
      "      const type = /\\.webm$/i.test(filePath) ? \"video/webm\" : /\\.png$/i.test(filePath) ? \"image/png\" : /\\.jpe?g$/i.test(filePath) ? \"image/jpeg\" : /\\.mkv$/i.test(filePath) ? \"video/x-matroska\" : \"video/mp4\";",
      "      const range = req.headers.range;",
      "",
      "      if (range) {",
      "        const m = /^bytes=(\\d*)-(\\d*)$/.exec(String(range).trim());",
      "        let start = m && m[1] !== \"\" ? Number(m[1]) : NaN;",
      "        let end = m && m[2] !== \"\" ? Number(m[2]) : fileSize - 1;",
      "        if (m && m[1] === \"\" && m[2] !== \"\") { start = Math.max(0, fileSize - Number(m[2])); end = fileSize - 1; }",
      "        end = Math.min(end, fileSize - 1);",
      "        if (!m || !(start >= 0) || start > end) {",
      "          res.writeHead(416, { \"Content-Range\": `bytes */${fileSize}` });",
      "          res.end();",
      "          return;",
      "        }",
      "        res.writeHead(206, {",
      "          \"Content-Range\": `bytes ${start}-${end}/${fileSize}`,",
      "          \"Accept-Ranges\": \"bytes\",",
      "          \"Content-Length\": end - start + 1,",
      "          \"Content-Type\": type,",
      "        });",
      "        fs.createReadStream(filePath, { start, end }).pipe(res);",
      "      } else {",
      "        res.writeHead(200, {",
      "          \"Content-Length\": fileSize,",
      "          \"Content-Type\": type,",
      "          \"Accept-Ranges\": \"bytes\",",
      "        });",
      "        fs.createReadStream(filePath).pipe(res);",
      "      }",
      "",
    ].join("\n"),
  });
  swap(s, {
    what: "the clip player's errors don't describe your files",
    done: /res\.end\("Error"\);/,
    re: /res\.end\("Error: " \+ e\.message\);/,
    to: "res.end(\"Error\");",
    optional: true,
  });

  // Games
  swap(s, {
    what: "games only start if you picked or imported them (or said yes once)",
    done: /approvedGames\.check\(exePath\)/,
    re: /(ipcMain\.handle\("launch-game", async \(_e, exePath\) => \{\n  try \{\n)/,
    to: (m) => m + "    // Only .exe games you picked or imported start without asking (see security.js)\n    const problem = await approvedGames.check(exePath);\n    if (problem) return { success: false, error: problem };\n",
  });
  swap(s, {
    what: "a game you pick is remembered as yours",
    done: /approvedGames\.approve\(r\.filePaths\[0\]\)/,
    re: /(ipcMain\.handle\("pick-exe", async \(\) => \{\n[\s\S]{0,300}?)\n  return r\.canceled \? null : r\.filePaths\[0\];/,
    to: (_m, a) => a + "\n  if (r.canceled) return null;\n  approvedGames.approve(r.filePaths[0]);\n  return r.filePaths[0];",
  });
  for (const shop of ["steam", "epic"]) {
    swap(s, {
      what: "games found by the " + (shop === "steam" ? "Steam" : "Epic") + " import are remembered",
      done: new RegExp('ipcMain\\.handle\\("import-' + shop + '"[\\s\\S]*?approvedGames\\.approveAll\\(games\\);'),
      re: new RegExp('(ipcMain\\.handle\\("import-' + shop + '", async \\(\\) => \\{[\\s\\S]*?)\\n    return \\{ success: true, games \\};'),
      to: (_m, a) => a + "\n    approvedGames.approveAll(games);\n    return { success: true, games };",
    });
  }
  swap(s, {
    what: "games found by the Xbox import are remembered",
    done: /approvedGames\.approveAll\(res\.games\)/,
    re: /ipcMain\.handle\("import-xbox", async \(\) =>\n  (require\("\.\/xbox"\)\.importGames\([^\n]*\))\);/,
    to: (_m, call) => "ipcMain.handle(\"import-xbox\", async () => {\n  const res = await " + call + ";\n  if (res && res.success) approvedGames.approveAll(res.games);\n  return res;\n});",
  });
  swap(s, {
    what: "the game-folder check passes the folder safely to PowerShell",
    done: /\$env:AURA_DIR/,
    re: /async function isFolderRunning\(dir\) \{\n  const safe = [^\n]*\n  const script =\n    `[^\n]*` \+\n    `[^\n]*`;\n  const out = await runQuiet\("powershell", \["-NoProfile", "-NonInteractive", "-Command", script\]\);/,
    to: [
      "async function isFolderRunning(dir) {",
      "  // The folder goes in through an environment variable, never into the command itself",
      "  const folder = String(dir).replace(/\\\\+$/, \"\") + \"\\\\\";",
      "  const script =",
      "    \"(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and \" +",
      "    \"$_.ExecutablePath.StartsWith($env:AURA_DIR, [StringComparison]::OrdinalIgnoreCase) }).Count\";",
      "  const out = await runQuiet(\"powershell\", [\"-NoProfile\", \"-NonInteractive\", \"-Command\", script], { env: { ...process.env, AURA_DIR: folder } });",
    ].join("\n"),
  });
  swap(s, {
    what: "(runQuiet can be given options)",
    done: /function runQuiet\(cmd, args, opts = \{\}\)/,
    re: /function runQuiet\(cmd, args\) \{\n  return new Promise\(\(resolve\) => \{\n    const p = spawn\(cmd, args, \{ windowsHide: true \}\);/,
    to: "function runQuiet(cmd, args, opts = {}) {\n  return new Promise((resolve) => {\n    const p = spawn(cmd, args, { windowsHide: true, ...opts });",
  });

  // Links
  swap(s, {
    what: "only web, email and Steam links (and your own clips) open outside AURA",
    done: /ipcMain\.handle\("open-external", async \(_e, url\) => safeOpenExternal\(url\)\);/,
    re: /ipcMain\.handle\("open-external", async \(_e, url\) => \{\n  await shell\.openExternal\(url\);\n  return \{ success: true \};\n\}\);/,
    to: "ipcMain.handle(\"open-external\", async (_e, url) => safeOpenExternal(url));",
  });

  // Clip files
  const clipDir = /path\.join\(getClipFolder\(\), gameName \|\| "General"\)/g;
  const n = (s.text.match(clipDir) || []).length;
  if (n) { s.text = s.text.replace(clipDir, "path.join(getClipFolder(), security.safeName(gameName))"); s.notes.push("a game's name can't put recordings outside the clip folder"); }
  else if (!/security\.safeName\(gameName\)/.test(s.text)) s.skipped.push("game folder names for recordings");

  swap(s, {
    what: "Trim only works on clips in your clip folder",
    done: /AURA can only trim clips in your clip folder/,
    re: /ipcMain\.handle\("trim-clip", async \(_e, \{ path: filePath, start, end \}\) => \{\n  try \{\n/,
    to: [
      "ipcMain.handle(\"trim-clip\", async (_e, input = {}) => {",
      "  // Only clips in the clip folder, and only real times (see security.js)",
      "  const filePath = security.clipPath(input && input.path, getClipFolder());",
      "  const start = Number(input && input.start), end = Number(input && input.end);",
      "  if (!filePath || !security.isClipFile(filePath)) return { success: false, error: \"AURA can only trim clips in your clip folder.\" };",
      "  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > 24 * 3600) return { success: false, error: \"Pick a start and end inside the clip.\" };",
      "  try {",
      "",
    ].join("\n"),
  });
  swap(s, {
    what: "Delete only works on clips in your clip folder (they go to the Recycle Bin)",
    done: /AURA can only delete clips in your clip folder/,
    re: /ipcMain\.handle\("delete-clip", async \(_e, filePath\) => \{\n  try \{\n    fs\.unlinkSync\(filePath\);\n    return \{ success: true \};\n  \} catch\(e\) \{\n    return \{ success: false, error: e\.message \};\n  \}\n\}\);/,
    to: [
      "ipcMain.handle(\"delete-clip\", async (_e, filePath) => {",
      "  // Only clips and screenshots in the clip folder (see security.js)",
      "  const full = security.clipPath(filePath, getClipFolder());",
      "  if (!full || !security.isClipFile(full)) return { success: false, error: \"AURA can only delete clips in your clip folder.\" };",
      "  try {",
      "    try { await shell.trashItem(full); } catch { fs.unlinkSync(full); } // Recycle Bin when there is one",
      "    return { success: true };",
      "  } catch(e) {",
      "    return { success: false, error: e.message };",
      "  }",
      "});",
    ].join("\n"),
  });
  swap(s, {
    what: "Show in folder only shows clips (anything else opens the clip folder)",
    done: /ipcMain\.handle\("open-clip-folder", async \(_e, filePath\) => \{\n  const full = security\.clipPath/,
    re: /ipcMain\.handle\("open-clip-folder", async \(_e, filePath\) => \{\n  shell\.showItemInFolder\(filePath\);\n  return \{ success: true \};\n\}\);/,
    to: [
      "ipcMain.handle(\"open-clip-folder\", async (_e, filePath) => {",
      "  const full = security.clipPath(filePath, getClipFolder());",
      "  if (full) shell.showItemInFolder(full);",
      "  else { ensureDir(getClipFolder()); shell.openPath(getClipFolder()); }",
      "  return { success: true };",
      "});",
    ].join("\n"),
  });
  swap(s, {
    what: "Rename only works on clips in your clip folder, and never moves or overwrites files",
    done: /AURA can only rename clips in your clip folder/,
    re: /ipcMain\.handle\("rename-clip", async \(_e, \{ oldPath, newName \}\) => \{\n  try \{\n    const dir = path\.dirname\(oldPath\);\n    const ext = path\.extname\(oldPath\);\n    const newPath = path\.join\(dir, newName \+ ext\);\n    fs\.renameSync\(oldPath, newPath\);\n    return \{ success: true, newPath \};\n  \} catch\(e\) \{\n    return \{ success: false, error: e\.message \};\n  \}\n\}\);/,
    to: [
      "ipcMain.handle(\"rename-clip\", async (_e, input = {}) => {",
      "  // Only clips in the clip folder, renamed in place (see security.js)",
      "  const oldPath = security.clipPath(input && input.oldPath, getClipFolder());",
      "  if (!oldPath || !security.isClipFile(oldPath)) return { success: false, error: \"AURA can only rename clips in your clip folder.\" };",
      "  const name = security.safeName(input && input.newName, \"\");",
      "  if (!name) return { success: false, error: \"Type a name for the clip.\" };",
      "  try {",
      "    const ext = path.extname(oldPath);",
      "    const newPath = path.join(path.dirname(oldPath), name + ext);",
      "    if (newPath.toLowerCase() === oldPath.toLowerCase()) { fs.renameSync(oldPath, newPath); return { success: true, newPath }; }",
      "    if (fs.existsSync(newPath)) return { success: false, error: \"A clip with that name already exists.\" };",
      "    fs.renameSync(oldPath, newPath);",
      "    return { success: true, newPath };",
      "  } catch(e) {",
      "    return { success: false, error: e.message };",
      "  }",
      "});",
    ].join("\n"),
  });

  // Twitch
  swap(s, {
    what: "Twitch volume is always a number",
    done: /const vol = muted \? 0/,
    re: /(ipcMain\.handle\("stream-set-volume", async \(_e, \{ volume, muted \}\) => \{\n  if \(!streamView\) return \{ success: false \};\n  try \{\n)([\s\S]*?)v\.volume = \$\{muted \? 0 : volume \/ 100\};\n(\s*)v\.muted = \$\{muted\};/,
    to: (_m, a, b, ind) => a + "    const vol = muted ? 0 : Math.min(1, Math.max(0, Number(volume) / 100 || 0));\n" + b + "v.volume = ${vol};\n" + ind + "v.muted = ${!!muted};",
    optional: true,
  });
  for (const [handler, label] of [["stream-open", "player"], ["chat-open", "chat"]]) {
    swap(s, {
      what: "Twitch " + label + " only opens real channel names",
      done: new RegExp('ipcMain\\.handle\\("' + handler + '", async \\(_e, \\{ channel, bounds \\}\\) => \\{\\n  channel = String'),
      re: new RegExp('(ipcMain\\.handle\\("' + handler + '", async \\(_e, \\{ channel, bounds \\}\\) => \\{\\n)'),
      to: (m) => m + "  channel = String(channel || \"\").toLowerCase();\n  if (!/^[a-z0-9_]{1,25}$/.test(channel)) return { success: false, error: \"That isn't a Twitch channel name.\" };\n",
      optional: true,
    });
  }

  // Discord login
  swap(s, {
    what: "Discord login checks that the answer is for this login",
    done: /discordState = require\("crypto"\)/,
    re: /(ipcMain\.handle\("discord-login", async \(\) => \{\n  try \{\n    await startAuthServer\(\);\n    const authUrl = `[^`]*?)&scope=identify`;/,
    to: (_m, a) => a.replace("    await startAuthServer();\n", "    discordState = require(\"crypto\").randomBytes(24).toString(\"hex\");\n    await startAuthServer();\n") + "&scope=identify&state=${discordState}`;",
  });
  swap(s, {
    what: "the Discord login listener only answers this PC and closes after 5 minutes",
    done: /authServer\.listen\(3000, "127\.0\.0\.1"/,
    re: /\/\/ ── Discord OAuth callback server[^\n]*\nfunction startAuthServer\(\) \{\n[\s\S]*?\n    authServer\.listen\(3000, resolve\);\n    authServer\.on\("error", reject\);\n  \}\);\n\}/,
    to: [
      "// ── Discord OAuth callback server ─────────────────────────────────────────────",
      "// Listens on this PC only, for one login, for up to 5 minutes. The login must carry the",
      "// random \"state\" AURA put in the link, so another website can't log you in as someone else.",
      "let discordState = null;",
      "let authTimer = null;",
      "function stopAuthServer() {",
      "  clearTimeout(authTimer); authTimer = null;",
      "  if (authServer) { try { authServer.close(); } catch {} authServer = null; }",
      "}",
      "function startAuthServer() {",
      "  return new Promise((resolve, reject) => {",
      "    stopAuthServer();",
      "    const page = (title, text) => `<html><body style=\"background:#222831;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:12px\"><div style=\"font-size:20px;font-weight:700\">${title}</div><div style=\"font-size:13px;color:#a0a8b4\">${text}</div></body></html>`;",
      "    authServer = http.createServer(async (req, res) => {",
      "      const url = new URL(req.url, \"http://localhost:3000\");",
      "      if (url.pathname !== \"/callback\") { res.writeHead(404); res.end(); return; }",
      "      const code = url.searchParams.get(\"code\") || \"\";",
      "      const state = url.searchParams.get(\"state\") || \"\";",
      "      const expected = discordState;",
      "      if (!expected || state !== expected || !/^[A-Za-z0-9_-]{6,200}$/.test(code)) {",
      "        res.writeHead(400, { \"Content-Type\": \"text/html; charset=utf-8\" });",
      "        res.end(page(\"This Discord login didn't come from AURA\", \"Start again from AURA's Discord button.\"));",
      "        return;",
      "      }",
      "      discordState = null; // each login link works once",
      "      try {",
      "        // The AURA server swaps the one-time code for a login (that step needs the Discord secret)",
      "        const tokenRes = await auraServer(\"/api/discord/token\", { code });",
      "        if (!tokenRes.success) throw new Error(tokenRes.error || \"Discord login failed.\");",
      "        discordToken = tokenRes.access_token;",
      "        res.writeHead(200, { \"Content-Type\": \"text/html; charset=utf-8\" });",
      "        res.end(page(\"Connected to Discord!\", \"You can close this tab and return to AURA.\"));",
      "        mainWin?.webContents.send(\"discord-auth-success\");",
      "      } catch {",
      "        res.writeHead(500, { \"Content-Type\": \"text/html; charset=utf-8\" });",
      "        res.end(page(\"Discord login failed\", \"Close this tab and try again from AURA.\"));",
      "      }",
      "      stopAuthServer();",
      "    });",
      "    authServer.on(\"error\", reject);",
      "    authServer.listen(3000, \"127.0.0.1\", resolve);",
      "    authTimer = setTimeout(() => { discordState = null; stopAuthServer(); }, 5 * 60 * 1000);",
      "  });",
      "}",
    ].join("\n"),
  });

  return s;
}

// ── .gitignore: repaired, and release/ and .env never committed ──────────────
function editGitignore(text) {
  const notes = [];
  let clean = text.replace(/\u0000/g, "").replace(/\r/g, "").replace(/^﻿/, "").replace(/^￾/, "");
  if (clean !== text) notes.push("removed damaged characters");
  const lines = clean.split("\n").map((l) => l.replace(/\s+$/, ""));
  const has = (rule) => lines.some((l) => l === rule || l === rule.replace(/\/$/, ""));
  const want = ["node_modules/", "dist/", "release/", ".env", ".env.*", "!.env.example", "*.bak"];
  const missing = want.filter((r) => !has(r));
  let out = lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n*$/, "\n");
  if (missing.length) {
    out += "\n# Build output and secrets never go in git (" + MARK + ")\n" + missing.join("\n") + "\n";
    notes.push("now ignores " + missing.join(", "));
  }
  return { text: out, notes };
}

// ── AURA's checks (only when they are installed) ─────────────────────────────
function editRunner(text) {
  if (/security\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /^add\("window",/.test(l));
  if (at < 0) return { text, notes: ["(couldn't find where to add the security checks, so npm test doesn't include them)"] };
  lines.splice(at, 0,
    'const securityFile = path.join(ROOT, "electron", "security.js");',
    'if (fs.existsSync(securityFile) && fs.existsSync(path.join(__dirname, "security.cjs"))) add("files", "Security: windows, links, games and clip files", "security.cjs", [securityFile]);');
  return { text: lines.join("\n"), notes: ["npm test now checks the security fixes too"] };
}

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
        if ((!SKIP_DIRS.has(entry.name) || entry.name === "tests") && !(entry.name.startsWith(".") && entry.name !== ".github")) visit(full, depth + 1);
      } else if (entry.name.endsWith(BAK)) {
        const target = full.slice(0, -BAK.length);
        fs.copyFileSync(full, target); fs.unlinkSync(full);
        say("  restored  " + rel(target)); restored++;
      } else if (entry.name === "security.js" || entry.name === "security.cjs") {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. Everything is back to how it was." : "Nothing to undo.");
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
  const mainFile = findOne("your main file", (t) => /ipcMain\.handle\(\s*["']launch-game["']/.test(t), need, [
    (h) => startFile && sameFile(h.file, startFile),
    (h) => /function createWindow\s*\(/.test(h.text),
  ]);

  const plan = [];
  const problems = [];
  {
    const { text, eol } = readText(mainFile);
    try {
      const s = editMain(text);
      if (s.text !== text) { const bad = syntaxProblem(s.text); if (bad) throw new Error("a way to edit it safely (" + bad + ")"); }
      plan.push({ label: "main file", file: mainFile, before: text, after: s.text, eol, notes: s.notes, skipped: s.skipped });
    } catch (e) { problems.push("In " + rel(mainFile) + " I couldn't find " + e.message + "."); }
  }
  const gitignore = path.join(ROOT, ".gitignore");
  {
    const before = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, "utf8") : "";
    const r = editGitignore(before);
    plan.push({ label: ".gitignore", file: gitignore, before, after: r.text, eol: "\n", notes: r.notes, skipped: [], raw: true, isNew: !fs.existsSync(gitignore) });
  }
  const runner = path.join(ROOT, "tests", "run.cjs");
  const hasChecks = fs.existsSync(runner);
  if (hasChecks) {
    const { text, eol } = readText(runner);
    const r = editRunner(text);
    plan.push({ label: "checks", file: runner, before: text, after: r.text, eol, notes: r.notes, skipped: [] });
  }

  const created = [{ label: "security", file: path.join(path.dirname(mainFile), "security.js"), content: FILES.security }];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "security.cjs"), content: FILES.test });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: security fixes");
  say();
  for (const c of created) {
    if (c.note !== "already done" && !DRY) { fs.mkdirSync(path.dirname(c.file), { recursive: true }); fs.writeFileSync(c.file, c.content); }
    say("  " + (c.label + ":").padEnd(12) + rel(c.file));
    say("              - " + c.note);
  }
  for (const step of plan) {
    if (step.after !== step.before && !DRY) {
      const bak = step.file + BAK;
      if (!step.isNew && !fs.existsSync(bak)) fs.copyFileSync(step.file, bak);
      fs.writeFileSync(step.file, step.raw ? step.after : withEol(step.after, step.eol));
    }
    say("  " + (step.label + ":").padEnd(12) + rel(step.file));
    (step.notes.length ? step.notes : ["already done"]).forEach((n) => say("              - " + n));
    step.skipped.forEach((n) => say("              - (skipped, couldn't find it: " + n + ")"));
  }
  say();
  if (DRY) { say("Run it again without --dry-run to apply."); say(); return; }
  say("Done. Next:");
  say("  1. Update the packages with known security problems:   npm audit fix");
  say("  2. Check everything still works:                       npm test");
  say("  3. Start AURA and try: launch a game, play/rename/delete a clip, the Social tab, a Twitch stream.");
  say("     Each game added before today asks \"Start this game?\" once. That's expected.");
  say();
  say("To undo later:  node aura-security-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
