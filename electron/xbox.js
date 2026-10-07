// AURA — Xbox / Game Pass games installed on this PC.
//
// The Xbox app installs each game in a folder like  C:\XboxGames\<Game>\Content , and puts a small
// file there (MicrosoftGame.config) that names the game and the program that runs it. This file
// reads those to fill AURA's library, and works out how to start a game the way Xbox expects.
//
// Nothing here goes online or needs an Xbox login: it only reads folders on this PC.
//
// Added by aura-xbox-setup.cjs. Used from the main file in two places:
//   ipcMain.handle("import-xbox", ...)   -> importGames()
//   ipcMain.handle("launch-game", ...)   -> launcherFor(exePath)
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CONFIG = "MicrosoftGame.config";
const HELPER = "gamelaunchhelper.exe";   // Xbox's own "start this game" program, present in most games
const DEFAULT_FOLDER = "XboxGames";
// Programs that sit beside a game but aren't the game
const NOT_THE_GAME = /(crash|report|unins|setup|install|redist|vc_?redist|dxsetup|helper|launcher_?helper|easyanticheat|battleye|eac_|be_?service|ue4prereq|prereq|dotnet|updater|bootstrap)/i;

// ── Reading MicrosoftGame.config ──────────────────────────────────────────────
const decode = (s) => String(s).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");
function attributes(tag) {
  const out = {};
  for (const m of String(tag).matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = decode(m[2] !== undefined ? m[2] : m[3]);
  return out;
}
// { name, publisher, displayName, executables: [{ name, id, family, devOnly }] }
function readConfig(text) {
  const xml = String(text || "").replace(/<!--[\s\S]*?-->/g, "");
  const first = (tagName) => { const m = xml.match(new RegExp("<" + tagName + "\\b[^>]*>", "i")); return m ? attributes(m[0]) : {}; };
  const identity = first("Identity"), visuals = first("ShellVisuals");
  const executables = [...xml.matchAll(/<Executable\b[^>]*>/gi)].map((m) => attributes(m[0]))
    .filter((a) => a.name && /\.exe$/i.test(a.name))
    .map((a) => ({ name: a.name, id: a.id || "Game", family: a.targetdevicefamily || "", devOnly: /^true$/i.test(a.isdevonly || "") }));
  return { name: identity.name || "", publisher: identity.publisher || "", displayName: visuals.defaultdisplayname || "", executables };
}
// The program for this PC: not a console-only one, not a developer tool
function pcExecutable(config) {
  const usable = config.executables.filter((e) => !e.devOnly && (!e.family || /^pc$/i.test(e.family)));
  return usable[0] || config.executables.find((e) => !e.devOnly) || null;
}

// ── How Windows names an installed app ────────────────────────────────────────
// Windows shortens a publisher's full name to 13 characters. With the app's name, that makes the
// address Windows starts it by:  <name>_<those 13 characters>!<program id>
function publisherId(publisher) {
  const hash = crypto.createHash("sha256").update(Buffer.from(String(publisher), "utf16le")).digest();
  let bits = "";
  for (let i = 0; i < 8; i++) bits += hash[i].toString(2).padStart(8, "0");
  bits += "0"; // 64 bits, padded to 65 so it splits into thirteen groups of five
  const letters = "0123456789abcdefghjkmnpqrstvwxyz";
  let out = "";
  for (let i = 0; i < 65; i += 5) out += letters[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}
function appAddress(config) {
  const exe = pcExecutable(config);
  if (!config.name || !config.publisher || !/^[\w.-]+$/.test(config.name)) return "";
  const id = exe && /^[\w.-]+$/.test(exe.id) ? exe.id : "Game";
  return config.name + "_" + publisherId(config.publisher) + "!" + id;
}

// ── Finding the folders the Xbox app installs into ────────────────────────────
// Each drive that has Xbox games carries a small hidden file (.GamingRoot) naming the folder.
// The default is XboxGames; people can choose another in the Xbox app's settings.
function foldersFromGamingRoot(buffer) {
  if (!buffer || buffer.length < 6 || buffer.toString("latin1", 0, 4) !== "RGBX") return [];
  return buffer.slice(4).toString("utf16le").split("\u0000")
    .map((part) => part.replace(/[\u0000-\u001f]/g, "").trim().replace(/^[\\/]+|[\\/]+$/g, ""))
    .filter((part) => part && part.length <= 200 && !/[<>:"|?*]/.test(part) && !/(^|[\\/])\.\.([\\/]|$)/.test(part));
}
const within = (promise, ms, fallback) => Promise.race([promise.catch(() => fallback), new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);
async function gamingRoots() {
  if (process.platform !== "win32") return [];
  const roots = [];
  await Promise.all("CDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(async (letter) => {
    const drive = letter + ":\\";
    // A drive that doesn't answer quickly (an empty card reader, a network drive that is away) is skipped
    if (!(await within(fs.promises.access(drive).then(() => true), 1500, false))) return;
    const named = await within(fs.promises.readFile(drive + ".GamingRoot").then(foldersFromGamingRoot), 1500, []);
    for (const folder of new Set([...named, DEFAULT_FOLDER])) {
      const full = path.join(drive, folder);
      if (await within(fs.promises.stat(full).then((s) => s.isDirectory()), 1500, false)) roots.push(full);
    }
  }));
  return [...new Set(roots.map((r) => r.toLowerCase()))].map((lower) => roots.find((r) => r.toLowerCase() === lower)).sort();
}

// ── Reading one game's folder ─────────────────────────────────────────────────
const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };
const fromConfigPath = (p) => String(p).split(/[\\/]+/).filter((s) => s && s !== "." && s !== "..").join(path.sep);
// When a game has no usable config: the biggest program in its folder that isn't a tool
function biggestProgram(dir, depth = 0, found = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (depth < 3 && !/^(_commonredist|redist|engine\W?extras|__installer)$/i.test(entry.name)) biggestProgram(full, depth + 1, found); }
    else if (/\.exe$/i.test(entry.name) && !NOT_THE_GAME.test(entry.name)) { try { found.push({ full, size: fs.statSync(full).size }); } catch {} }
  }
  if (depth > 0) return null;
  found.sort((a, b) => b.size - a.size);
  return found.length ? found[0].full : null;
}
// { title, exePath } for the game in this folder, or null if there isn't one
function readGame(gameDir) {
  const folderName = path.basename(gameDir);
  const content = [path.join(gameDir, "Content"), gameDir].find((d) => exists(path.join(d, CONFIG))) || (exists(path.join(gameDir, "Content")) ? path.join(gameDir, "Content") : null);
  if (!content) return null;
  let config = { name: "", publisher: "", displayName: "", executables: [] };
  try { config = readConfig(fs.readFileSync(path.join(content, CONFIG), "utf8")); } catch {}
  let exePath = "";
  const exe = pcExecutable(config);
  if (exe) { const candidate = path.join(content, fromConfigPath(exe.name)); if (exists(candidate)) exePath = candidate; }
  if (!exePath) exePath = biggestProgram(content) || "";
  if (!exePath) return null; // an add-on or leftover folder, not a game
  // Some games give their name as a lookup code rather than words: the folder's name is used then
  const named = config.displayName && !/^ms-resource:/i.test(config.displayName) && !/^@\{/.test(config.displayName) ? config.displayName.trim() : "";
  return { title: named || folderName, exePath };
}

// Every Xbox game found in these folders (or in the Xbox folders on this PC, when none are given)
async function findGames(options = {}) {
  const roots = Array.isArray(options.roots) ? options.roots : await gamingRoots();
  const games = [], seen = new Set();
  for (const root of roots) {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      let game = null;
      try { game = readGame(path.join(root, entry.name)); } catch {}
      if (!game || seen.has(game.exePath.toLowerCase())) continue;
      seen.add(game.exePath.toLowerCase());
      games.push(game);
    }
  }
  games.sort((a, b) => a.title.localeCompare(b.title));
  return { roots, games };
}

// What the Import button in Settings gets back: { success, games } in the shape the library uses.
// covers: optional, (list of { id, title }) => { success, covers: { id: url } }, as the AURA server answers.
async function importGames(options = {}) {
  try {
    const { roots, games } = await findGames(options);
    if (!roots.length) return { success: false, error: "No Xbox games folder found on this PC. Install a game from the Xbox app first." };
    if (!games.length) return { success: false, error: "No installed Xbox games found in " + roots.join(", ") + "." };
    const out = games.map((g) => ({ title: g.title, exePath: g.exePath, category: "Other", cover: "" }));
    if (typeof options.covers === "function") {
      // Cover art is a nicety: if the server can't be reached the games are still imported
      try {
        for (let i = 0; i < out.length; i += 20) {
          const group = out.slice(i, i + 20).map((g, n) => ({ id: "xbox-" + (i + n), title: g.title }));
          const res = await within(Promise.resolve(options.covers(group)), 20000, null);
          if (!res || !res.success || !res.covers) break;
          group.forEach((g, n) => { const url = res.covers[g.id]; if (typeof url === "string" && /^https:\/\//.test(url)) out[i + n].cover = url; });
        }
      } catch {}
    }
    return { success: true, games: out };
  } catch (e) { return { success: false, error: "AURA couldn't read the Xbox games folder (" + (e && e.message ? e.message : "unknown problem") + ")." }; }
}

// ── Starting a game ───────────────────────────────────────────────────────────
// For a program inside an Xbox game's folder: how to start it the way Xbox expects.
// Answers { command, args, cwd }, or null when this isn't an Xbox game (AURA then starts it as usual).
function launcherFor(exePath, options = {}) {
  try {
    if (typeof exePath !== "string" || !exePath) return null;
    let dir = path.dirname(exePath), content = null;
    for (let up = 0; up < 5 && dir && dir !== path.dirname(dir); up++, dir = path.dirname(dir)) {
      if (exists(path.join(dir, CONFIG))) { content = dir; break; }
    }
    if (!content) return null;
    // 1. Xbox's own starter, when the game ships one
    const helper = path.join(content, HELPER);
    if (exists(helper)) return { command: helper, args: [], cwd: content };
    // 2. Otherwise through Windows, by the app's address (what the Start menu does)
    if ((options.platform || process.platform) !== "win32") return null;
    const address = appAddress(readConfig(fs.readFileSync(path.join(content, CONFIG), "utf8")));
    return address ? { command: "explorer.exe", args: ["shell:AppsFolder\\" + address], cwd: content } : null;
  } catch { return null; }
}

module.exports = { importGames, findGames, launcherFor, readConfig, publisherId, appAddress, foldersFromGamingRoot, gamingRoots };
