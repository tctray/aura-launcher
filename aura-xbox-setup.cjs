#!/usr/bin/env node
/**
 * AURA — Xbox and Game Pass games in your library
 *
 * AURA's "Import Xbox Game Pass" button (Settings > Library) looked for each game's program in
 * the wrong place, so it never found any. This fixes it:
 *   - finds every game the Xbox app has installed, on any drive, with its proper name
 *   - adds cover art as it imports
 *   - starts Game Pass games the way Xbox expects, so they launch from AURA and playtime is tracked
 *
 * Nothing here goes online or needs an Xbox login. It only reads folders on your PC.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-xbox-setup.cjs
 *   4. Start AURA, open Settings, and click Import next to "Import Xbox Game Pass".
 *
 * What it does:
 *   - creates  electron/xbox.js        finds Xbox games and works out how to start them
 *   - edits    your main file          the Import button and the Play button use xbox.js
 *   - edits    your App file           imported games keep their cover art; clearer message if none are found
 *   - creates  tests/xbox.cjs          (only if AURA's checks are installed) checks for the above
 *
 * Every file it changes is copied to <name>.before-xbox.bak first.
 * To put everything back:                 node aura-xbox-setup.cjs --undo
 * To preview without changing anything:   node aura-xbox-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FILES = {"xbox":"// AURA — Xbox / Game Pass games installed on this PC.\n//\n// The Xbox app installs each game in a folder like  C:\\XboxGames\\<Game>\\Content , and puts a small\n// file there (MicrosoftGame.config) that names the game and the program that runs it. This file\n// reads those to fill AURA's library, and works out how to start a game the way Xbox expects.\n//\n// Nothing here goes online or needs an Xbox login: it only reads folders on this PC.\n//\n// Added by aura-xbox-setup.cjs. Used from the main file in two places:\n//   ipcMain.handle(\"import-xbox\", ...)   -> importGames()\n//   ipcMain.handle(\"launch-game\", ...)   -> launcherFor(exePath)\n\"use strict\";\nconst fs = require(\"fs\");\nconst path = require(\"path\");\nconst crypto = require(\"crypto\");\n\nconst CONFIG = \"MicrosoftGame.config\";\nconst HELPER = \"gamelaunchhelper.exe\";   // Xbox's own \"start this game\" program, present in most games\nconst DEFAULT_FOLDER = \"XboxGames\";\n// Programs that sit beside a game but aren't the game\nconst NOT_THE_GAME = /(crash|report|unins|setup|install|redist|vc_?redist|dxsetup|helper|launcher_?helper|easyanticheat|battleye|eac_|be_?service|ue4prereq|prereq|dotnet|updater|bootstrap)/i;\n\n// ── Reading MicrosoftGame.config ──────────────────────────────────────────────\nconst decode = (s) => String(s).replace(/&quot;/g, '\"').replace(/&apos;/g, \"'\").replace(/&lt;/g, \"<\").replace(/&gt;/g, \">\").replace(/&#(\\d+);/g, (_m, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, \"&\");\nfunction attributes(tag) {\n  const out = {};\n  for (const m of String(tag).matchAll(/([A-Za-z_][\\w:.-]*)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')/g)) out[m[1].toLowerCase()] = decode(m[2] !== undefined ? m[2] : m[3]);\n  return out;\n}\n// { name, publisher, displayName, executables: [{ name, id, family, devOnly }] }\nfunction readConfig(text) {\n  const xml = String(text || \"\").replace(/<!--[\\s\\S]*?-->/g, \"\");\n  const first = (tagName) => { const m = xml.match(new RegExp(\"<\" + tagName + \"\\\\b[^>]*>\", \"i\")); return m ? attributes(m[0]) : {}; };\n  const identity = first(\"Identity\"), visuals = first(\"ShellVisuals\");\n  const executables = [...xml.matchAll(/<Executable\\b[^>]*>/gi)].map((m) => attributes(m[0]))\n    .filter((a) => a.name && /\\.exe$/i.test(a.name))\n    .map((a) => ({ name: a.name, id: a.id || \"Game\", family: a.targetdevicefamily || \"\", devOnly: /^true$/i.test(a.isdevonly || \"\") }));\n  return { name: identity.name || \"\", publisher: identity.publisher || \"\", displayName: visuals.defaultdisplayname || \"\", executables };\n}\n// The program for this PC: not a console-only one, not a developer tool\nfunction pcExecutable(config) {\n  const usable = config.executables.filter((e) => !e.devOnly && (!e.family || /^pc$/i.test(e.family)));\n  return usable[0] || config.executables.find((e) => !e.devOnly) || null;\n}\n\n// ── How Windows names an installed app ────────────────────────────────────────\n// Windows shortens a publisher's full name to 13 characters. With the app's name, that makes the\n// address Windows starts it by:  <name>_<those 13 characters>!<program id>\nfunction publisherId(publisher) {\n  const hash = crypto.createHash(\"sha256\").update(Buffer.from(String(publisher), \"utf16le\")).digest();\n  let bits = \"\";\n  for (let i = 0; i < 8; i++) bits += hash[i].toString(2).padStart(8, \"0\");\n  bits += \"0\"; // 64 bits, padded to 65 so it splits into thirteen groups of five\n  const letters = \"0123456789abcdefghjkmnpqrstvwxyz\";\n  let out = \"\";\n  for (let i = 0; i < 65; i += 5) out += letters[parseInt(bits.slice(i, i + 5), 2)];\n  return out;\n}\nfunction appAddress(config) {\n  const exe = pcExecutable(config);\n  if (!config.name || !config.publisher || !/^[\\w.-]+$/.test(config.name)) return \"\";\n  const id = exe && /^[\\w.-]+$/.test(exe.id) ? exe.id : \"Game\";\n  return config.name + \"_\" + publisherId(config.publisher) + \"!\" + id;\n}\n\n// ── Finding the folders the Xbox app installs into ────────────────────────────\n// Each drive that has Xbox games carries a small hidden file (.GamingRoot) naming the folder.\n// The default is XboxGames; people can choose another in the Xbox app's settings.\nfunction foldersFromGamingRoot(buffer) {\n  if (!buffer || buffer.length < 6 || buffer.toString(\"latin1\", 0, 4) !== \"RGBX\") return [];\n  return buffer.slice(4).toString(\"utf16le\").split(\"\\u0000\")\n    .map((part) => part.replace(/[\\u0000-\\u001f]/g, \"\").trim().replace(/^[\\\\/]+|[\\\\/]+$/g, \"\"))\n    .filter((part) => part && part.length <= 200 && !/[<>:\"|?*]/.test(part) && !/(^|[\\\\/])\\.\\.([\\\\/]|$)/.test(part));\n}\nconst within = (promise, ms, fallback) => Promise.race([promise.catch(() => fallback), new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);\nasync function gamingRoots() {\n  if (process.platform !== \"win32\") return [];\n  const roots = [];\n  await Promise.all(\"CDEFGHIJKLMNOPQRSTUVWXYZ\".split(\"\").map(async (letter) => {\n    const drive = letter + \":\\\\\";\n    // A drive that doesn't answer quickly (an empty card reader, a network drive that is away) is skipped\n    if (!(await within(fs.promises.access(drive).then(() => true), 1500, false))) return;\n    const named = await within(fs.promises.readFile(drive + \".GamingRoot\").then(foldersFromGamingRoot), 1500, []);\n    for (const folder of new Set([...named, DEFAULT_FOLDER])) {\n      const full = path.join(drive, folder);\n      if (await within(fs.promises.stat(full).then((s) => s.isDirectory()), 1500, false)) roots.push(full);\n    }\n  }));\n  return [...new Set(roots.map((r) => r.toLowerCase()))].map((lower) => roots.find((r) => r.toLowerCase() === lower)).sort();\n}\n\n// ── Reading one game's folder ─────────────────────────────────────────────────\nconst exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };\nconst fromConfigPath = (p) => String(p).split(/[\\\\/]+/).filter((s) => s && s !== \".\" && s !== \"..\").join(path.sep);\n// When a game has no usable config: the biggest program in its folder that isn't a tool\nfunction biggestProgram(dir, depth = 0, found = []) {\n  let entries = [];\n  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }\n  for (const entry of entries) {\n    const full = path.join(dir, entry.name);\n    if (entry.isDirectory()) { if (depth < 3 && !/^(_commonredist|redist|engine\\W?extras|__installer)$/i.test(entry.name)) biggestProgram(full, depth + 1, found); }\n    else if (/\\.exe$/i.test(entry.name) && !NOT_THE_GAME.test(entry.name)) { try { found.push({ full, size: fs.statSync(full).size }); } catch {} }\n  }\n  if (depth > 0) return null;\n  found.sort((a, b) => b.size - a.size);\n  return found.length ? found[0].full : null;\n}\n// { title, exePath } for the game in this folder, or null if there isn't one\nfunction readGame(gameDir) {\n  const folderName = path.basename(gameDir);\n  const content = [path.join(gameDir, \"Content\"), gameDir].find((d) => exists(path.join(d, CONFIG))) || (exists(path.join(gameDir, \"Content\")) ? path.join(gameDir, \"Content\") : null);\n  if (!content) return null;\n  let config = { name: \"\", publisher: \"\", displayName: \"\", executables: [] };\n  try { config = readConfig(fs.readFileSync(path.join(content, CONFIG), \"utf8\")); } catch {}\n  let exePath = \"\";\n  const exe = pcExecutable(config);\n  if (exe) { const candidate = path.join(content, fromConfigPath(exe.name)); if (exists(candidate)) exePath = candidate; }\n  if (!exePath) exePath = biggestProgram(content) || \"\";\n  if (!exePath) return null; // an add-on or leftover folder, not a game\n  // Some games give their name as a lookup code rather than words: the folder's name is used then\n  const named = config.displayName && !/^ms-resource:/i.test(config.displayName) && !/^@\\{/.test(config.displayName) ? config.displayName.trim() : \"\";\n  return { title: named || folderName, exePath };\n}\n\n// Every Xbox game found in these folders (or in the Xbox folders on this PC, when none are given)\nasync function findGames(options = {}) {\n  const roots = Array.isArray(options.roots) ? options.roots : await gamingRoots();\n  const games = [], seen = new Set();\n  for (const root of roots) {\n    let entries = [];\n    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }\n    for (const entry of entries) {\n      if (!entry.isDirectory()) continue;\n      let game = null;\n      try { game = readGame(path.join(root, entry.name)); } catch {}\n      if (!game || seen.has(game.exePath.toLowerCase())) continue;\n      seen.add(game.exePath.toLowerCase());\n      games.push(game);\n    }\n  }\n  games.sort((a, b) => a.title.localeCompare(b.title));\n  return { roots, games };\n}\n\n// What the Import button in Settings gets back: { success, games } in the shape the library uses.\n// covers: optional, (list of { id, title }) => { success, covers: { id: url } }, as the AURA server answers.\nasync function importGames(options = {}) {\n  try {\n    const { roots, games } = await findGames(options);\n    if (!roots.length) return { success: false, error: \"No Xbox games folder found on this PC. Install a game from the Xbox app first.\" };\n    if (!games.length) return { success: false, error: \"No installed Xbox games found in \" + roots.join(\", \") + \".\" };\n    const out = games.map((g) => ({ title: g.title, exePath: g.exePath, category: \"Other\", cover: \"\" }));\n    if (typeof options.covers === \"function\") {\n      // Cover art is a nicety: if the server can't be reached the games are still imported\n      try {\n        for (let i = 0; i < out.length; i += 20) {\n          const group = out.slice(i, i + 20).map((g, n) => ({ id: \"xbox-\" + (i + n), title: g.title }));\n          const res = await within(Promise.resolve(options.covers(group)), 20000, null);\n          if (!res || !res.success || !res.covers) break;\n          group.forEach((g, n) => { const url = res.covers[g.id]; if (typeof url === \"string\" && /^https:\\/\\//.test(url)) out[i + n].cover = url; });\n        }\n      } catch {}\n    }\n    return { success: true, games: out };\n  } catch (e) { return { success: false, error: \"AURA couldn't read the Xbox games folder (\" + (e && e.message ? e.message : \"unknown problem\") + \").\" }; }\n}\n\n// ── Starting a game ───────────────────────────────────────────────────────────\n// For a program inside an Xbox game's folder: how to start it the way Xbox expects.\n// Answers { command, args, cwd }, or null when this isn't an Xbox game (AURA then starts it as usual).\nfunction launcherFor(exePath, options = {}) {\n  try {\n    if (typeof exePath !== \"string\" || !exePath) return null;\n    let dir = path.dirname(exePath), content = null;\n    for (let up = 0; up < 5 && dir && dir !== path.dirname(dir); up++, dir = path.dirname(dir)) {\n      if (exists(path.join(dir, CONFIG))) { content = dir; break; }\n    }\n    if (!content) return null;\n    // 1. Xbox's own starter, when the game ships one\n    const helper = path.join(content, HELPER);\n    if (exists(helper)) return { command: helper, args: [], cwd: content };\n    // 2. Otherwise through Windows, by the app's address (what the Start menu does)\n    if ((options.platform || process.platform) !== \"win32\") return null;\n    const address = appAddress(readConfig(fs.readFileSync(path.join(content, CONFIG), \"utf8\")));\n    return address ? { command: \"explorer.exe\", args: [\"shell:AppsFolder\\\\\" + address], cwd: content } : null;\n  } catch { return null; }\n}\n\nmodule.exports = { importGames, findGames, launcherFor, readConfig, publisherId, appAddress, foldersFromGamingRoot, gamingRoots };\n","test":"// Xbox / Game Pass games: builds a pretend Xbox games folder and checks that AURA's scanner\n// (electron/xbox.js) reads it the way it should, and knows how to start each kind of game.\n// Added by aura-xbox-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst os = require(\"os\");\nconst path = require(\"path\");\nconst xbox = require(path.resolve(process.argv[2] || path.join(__dirname, \"..\", \"electron\", \"xbox.js\")));\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + JSON.stringify(extra))); };\n\nconst tmp = fs.mkdtempSync(path.join(os.tmpdir(), \"aura-xbox-\"));\nconst root = path.join(tmp, \"XboxGames\"), second = path.join(tmp, \"MyGames\");\nconst put = (file, content = \"x\") => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };\nconst MS = \"CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US\";\nconst config = ({ name = \"Studio.Game\", publisher = MS, display = \"\", exes = '<Executable Name=\"Game.exe\" Id=\"Game\"/>' }) =>\n  `<?xml version=\"1.0\" encoding=\"utf-8\"?>\\n<Game configVersion=\"1\">\\n  <!-- <Executable Name=\"Commented.exe\" Id=\"Nope\"/> -->\\n  <Identity Name=\"${name}\" Publisher=\"${publisher}\" Version=\"1.0.0.0\"/>\\n  <ExecutableList>\\n    ${exes}\\n  </ExecutableList>\\n  <ShellVisuals DefaultDisplayName=\"${display}\" PublisherDisplayName=\"Studio\" Square150x150Logo=\"logo.png\"/>\\n</Game>\\n`;\nconst game = (folder, opts, files) => { const content = path.join(root, folder, \"Content\"); if (opts) put(path.join(content, \"MicrosoftGame.config\"), config(opts)); for (const [f, size] of Object.entries(files || {})) put(path.join(content, ...f.split(\"/\")), \"x\".repeat(size)); return content; };\n\n// A typical game: its config names the program, and Xbox's own starter sits beside it\nconst forza = game(\"Forza Horizon 5\", { name: \"Microsoft.624F8B84B80\", display: \"Forza Horizon 5\", exes: '<Executable Name=\"ForzaHorizon5.exe\" Id=\"App\"/>' }, { \"ForzaHorizon5.exe\": 50, \"gamelaunchhelper.exe\": 5 });\n// Name given as a lookup code, program in a sub-folder (written the Windows way), no starter\nconst halo = game(\"Halo Infinite\", { name: \"Microsoft.254428597CFE2\", display: \"ms-resource:AppDisplayName\", exes: '<Executable Name=\"Binaries\\\\Win64\\\\HaloInfinite.exe\" Id=\"Game\"/>' }, { \"Binaries/Win64/HaloInfinite.exe\": 50 });\n// A console program and a developer tool listed first; a name with \"&\" in it\nconst ori = game(\"Ori\", { display: \"Ori &amp; the Will of the Wisps\", exes: '<Executable Name=\"Console.exe\" Id=\"Xbox\" TargetDeviceFamily=\"Scarlett\"/> <Executable Name=\"DevTool.exe\" Id=\"Dev\" IsDevOnly=\"true\"/> <Executable Id=\"Game\" TargetDeviceFamily=\"PC\" Name=\"oriwotw.exe\"/>' }, { \"Console.exe\": 10, \"DevTool.exe\": 10, \"oriwotw.exe\": 30 });\n// No config at all: the biggest program that isn't a tool\ngame(\"Old Game\", null, { \"bin/OldGame.exe\": 400, \"CrashReporter.exe\": 900, \"bin/unins000.exe\": 950, \"bin/small.exe\": 20 });\n// The config names a program that isn't there\ngame(\"Moved\", { display: \"Moved Game\", exes: '<Executable Name=\"Gone.exe\" Id=\"Game\"/>' }, { \"Real.exe\": 60 });\n// Things that aren't games\nfs.mkdirSync(path.join(root, \"GameSave\"), { recursive: true });\ngame(\"Some Add-on\", { display: \"Add-on Pack\", exes: \"\" }, { \"data.pak\": 100 });\nput(path.join(root, \"notes.txt\"));\n// A second folder on another drive, with one game of its own\nput(path.join(second, \"Sea of Thieves\", \"Content\", \"MicrosoftGame.config\"), config({ display: \"Sea of Thieves\", exes: '<Executable Name=\"SoTGame.exe\" Id=\"Game\"/>' }));\nput(path.join(second, \"Sea of Thieves\", \"Content\", \"SoTGame.exe\"));\n\n(async () => {\n  console.log(\"1. Finding installed games\");\n  const { games } = await xbox.findGames({ roots: [root, second, path.join(tmp, \"missing\")] });\n  const by = Object.fromEntries(games.map((g) => [g.title, g.exePath]));\n  check(\"finds every game, in both folders, and nothing that isn't one\", JSON.stringify(games.map((g) => g.title)) === JSON.stringify([\"Forza Horizon 5\", \"Halo Infinite\", \"Moved Game\", \"Old Game\", \"Ori & the Will of the Wisps\", \"Sea of Thieves\"]), games.map((g) => g.title));\n  check(\"uses the program the game's own config names\", by[\"Forza Horizon 5\"] === path.join(forza, \"ForzaHorizon5.exe\"), by[\"Forza Horizon 5\"]);\n  check(\"follows a program kept in a sub-folder\", by[\"Halo Infinite\"] === path.join(halo, \"Binaries\", \"Win64\", \"HaloInfinite.exe\"), by[\"Halo Infinite\"]);\n  check(\"uses the folder's name when the game gives a lookup code instead of a title\", \"Halo Infinite\" in by);\n  check(\"picks the PC program, not the console one or a developer tool\", by[\"Ori & the Will of the Wisps\"] === path.join(ori, \"oriwotw.exe\"), by[\"Ori & the Will of the Wisps\"]);\n  check(\"with no config, picks the game rather than a crash reporter or uninstaller\", by[\"Old Game\"] === path.join(root, \"Old Game\", \"Content\", \"bin\", \"OldGame.exe\"), by[\"Old Game\"]);\n  check(\"if the named program is missing, finds the one that is there\", by[\"Moved Game\"] === path.join(root, \"Moved\", \"Content\", \"Real.exe\"), by[\"Moved Game\"]);\n\n  console.log(\"2. What the Import button gets back\");\n  let asked = [];\n  let res = await xbox.importGames({ roots: [root], covers: async (list) => { asked.push(list); return { success: true, covers: { [list[0].id]: \"https://images.example/forza.jpg\", [list[1].id]: \"javascript:alert(1)\" } }; } });\n  check(\"games come back in the shape the library uses\", res.success && res.games.length === 5 && res.games.every((g) => g.title && g.exePath && g.category === \"Other\" && typeof g.cover === \"string\"), res);\n  check(\"cover art is asked for by title, and filled in\", asked.length === 1 && asked[0][0].title === \"Forza Horizon 5\" && res.games[0].cover === \"https://images.example/forza.jpg\", [asked, res.games[0]]);\n  check(\"only a proper web address is accepted as a cover\", res.games[1].cover === \"\", res.games[1]);\n  res = await xbox.importGames({ roots: [root], covers: async () => { throw new Error(\"offline\"); } });\n  check(\"if cover art can't be fetched, the games are still imported\", res.success && res.games.length === 5 && res.games.every((g) => g.cover === \"\"));\n  res = await xbox.importGames({ roots: [] });\n  check(\"no Xbox folder: says so plainly\", res.success === false && /No Xbox games folder found/.test(res.error), res);\n  res = await xbox.importGames({ roots: [path.join(root, \"GameSave\")] });\n  check(\"an Xbox folder with no games in it: says where it looked\", res.success === false && /No installed Xbox games found in/.test(res.error) && res.error.includes(\"GameSave\"), res);\n\n  console.log(\"3. Starting a game\");\n  let how = xbox.launcherFor(by[\"Forza Horizon 5\"]);\n  check(\"a game with Xbox's own starter is started through it\", how && how.command === path.join(forza, \"gamelaunchhelper.exe\") && how.args.length === 0 && how.cwd === forza, how);\n  how = xbox.launcherFor(by[\"Halo Infinite\"], { platform: \"win32\" });\n  check(\"a game without one is started through Windows, by its app address\", how && how.command === \"explorer.exe\" && how.args.length === 1 && how.args[0] === \"shell:AppsFolder\\\\Microsoft.254428597CFE2_8wekyb3d8bbwe!Game\" && how.cwd === halo, how);\n  check(\"the program id in that address comes from the game's config\", xbox.appAddress(xbox.readConfig(fs.readFileSync(path.join(forza, \"MicrosoftGame.config\"), \"utf8\"))) === \"Microsoft.624F8B84B80_8wekyb3d8bbwe!App\");\n  check(\"a game that isn't from Xbox is left to start as usual\", xbox.launcherFor(path.join(tmp, \"Steam\", \"common\", \"Doom\", \"doom.exe\")) === null && xbox.launcherFor(\"\") === null && xbox.launcherFor(null) === null);\n  put(path.join(tmp, \"Deep\", \"MicrosoftGame.config\"), config({})); put(path.join(tmp, \"Deep\", \"a\", \"b\", \"c\", \"d\", \"e\", \"f\", \"g.exe\"));\n  check(\"it only looks a few folders up for the config\", xbox.launcherFor(path.join(tmp, \"Deep\", \"a\", \"b\", \"c\", \"d\", \"e\", \"f\", \"g.exe\")) === null && xbox.launcherFor(path.join(tmp, \"Deep\", \"a\", \"b\", \"g.exe\"), { platform: \"win32\" }) !== null);\n  check(\"an odd name in a config can't put anything unexpected into the command\", xbox.appAddress({ name: \"Bad Name & calc.exe\", publisher: MS, executables: [{ name: \"a.exe\", id: \"Game\" }] }) === \"\" && /!Game$/.test(xbox.appAddress({ name: \"Good.Name\", publisher: MS, executables: [{ name: \"a.exe\", id: \"x y & z\" }] })));\n\n  console.log(\"4. Windows' short publisher names, and the Xbox folder marker\");\n  check(\"Microsoft's publisher name shortens to the value Windows uses\", xbox.publisherId(MS) === \"8wekyb3d8bbwe\");\n  check(\"so does the Windows one\", xbox.publisherId(\"CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond, S=Washington, C=US\") === \"cw5n1h2txyewy\");\n  const marker = (...folders) => Buffer.concat([Buffer.from(\"RGBX\"), Buffer.from([folders.length, 0, 0, 0]), ...folders.map((f) => Buffer.from(f + \"\\u0000\", \"utf16le\"))]);\n  check(\"the marker file names the default folder\", JSON.stringify(xbox.foldersFromGamingRoot(marker(\"XboxGames\"))) === '[\"XboxGames\"]');\n  check(\"...or one the person chose\", JSON.stringify(xbox.foldersFromGamingRoot(marker(\"Games\\\\Xbox\"))) === '[\"Games\\\\\\\\Xbox\"]', xbox.foldersFromGamingRoot(marker(\"Games\\\\Xbox\")));\n  check(\"a file that isn't a marker, or points outside the drive, is ignored\", xbox.foldersFromGamingRoot(Buffer.from(\"hello world\")).length === 0 && xbox.foldersFromGamingRoot(null).length === 0 && xbox.foldersFromGamingRoot(marker(\"..\\\\Windows\", \"C:\\\\Windows\")).length === 0, xbox.foldersFromGamingRoot(marker(\"..\\\\Windows\", \"C:\\\\Windows\")));\n  check(\"on a PC that isn't Windows there are no Xbox folders to look in\", process.platform === \"win32\" || (await xbox.gamingRoots()).length === 0);\n\n  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}\n  console.log(failed ? `\\n${failed} FAILED` : \"\\nall passed\");\n  process.exit(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The Xbox check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-xbox.bak";
const MARK = "Added by aura-xbox-setup.cjs";
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

// ── Main file ─────────────────────────────────────────────────────────────────
function editMain(text) {
  const lines = text.split("\n");
  const notes = [];

  // 1. The Import button: read the Xbox app's folders properly
  if (!/require\(\s*["']\.\/xbox["']\s*\)\.importGames\(/.test(text)) {
    const start = findLine(lines, /^ipcMain\.handle\(\s*["']import-xbox["']\s*,/);
    if (start < 0) throw new Error('the Xbox import ( ipcMain.handle("import-xbox", ... )');
    const end = /\}\s*\)\s*;?\s*$/.test(lines[start]) && !/\{\s*$/.test(lines[start]) ? start : findLine(lines, /^\}\);\s*$/, start + 1, Math.min(lines.length, start + 60));
    if (end < 0) throw new Error('the end of the Xbox import ( the  });  that closes ipcMain.handle("import-xbox", ... )');
    lines.splice(start, end - start + 1,
      "// Finds the games the Xbox app has installed (see xbox.js), and asks the AURA server for their cover art",
      'ipcMain.handle("import-xbox", async () =>',
      '  require("./xbox").importGames({ covers: typeof auraServer === "function" ? (games) => auraServer("/api/covers/bulk", { games }) : null }));');
    notes.push("the Xbox import now finds games where the Xbox app really puts them");
  }

  // 2. The Play button: Game Pass games go through Xbox's own starter
  if (!/require\(\s*["']\.\/xbox["']\s*\)\.launcherFor\(/.test(lines.join("\n"))) {
    const handler = findLine(lines, /^ipcMain\.handle\(\s*["']launch-game["']\s*,/);
    const at = handler < 0 ? -1 : findLine(lines, /^\s*const child\s*=\s*spawn\(\s*exePath\s*,\s*\[\s*\]\s*,\s*\{\s*$/, handler, Math.min(lines.length, handler + 40));
    if (at >= 0 && /^\s*cwd\s*:\s*path\.dirname\(\s*exePath\s*\)\s*,\s*$/.test(lines[at + 1] || "")) {
      const pad = indentOf(lines[at]);
      lines.splice(at, 2,
        pad + "// Game Pass games are started the way Xbox expects (see xbox.js). AURA still watches the game itself.",
        pad + 'const xboxStart = require("./xbox").launcherFor(exePath);',
        pad + "const child = spawn(xboxStart ? xboxStart.command : exePath, xboxStart ? xboxStart.args : [], {",
        indentOf(lines[at + 1]) + "cwd: xboxStart ? xboxStart.cwd : path.dirname(exePath),");
      notes.push("Game Pass games start through Xbox's own starter");
    } else {
      notes.push("(I couldn't find where AURA starts a game, so Game Pass games are started the old way. If one won't launch, copy this line to Claude.)");
    }
  }
  return { text: lines.join("\n"), notes };
}

// ── App file: keep the cover art, and say why when nothing is found ───────────
function editApp(text) {
  const lines = text.split("\n");
  const notes = [];
  const start = findLine(lines, /const doImportXbox\s*=\s*useCallback\(/);
  const end = start < 0 ? -1 : findLine(lines, /^\s*\}\s*,\s*\[[^\]]*\]\s*\)\s*;?\s*$/, start + 1, Math.min(lines.length, start + 14));
  if (start < 0 || end < 0) return { text, notes: ["(I couldn't find the Xbox import in the App file. The import still works; games arrive without cover art until you use Fetch Missing Cover Art.)"] };
  let covers = false, message = false;
  for (let i = start; i <= end; i++) {
    if (/exePath:g\.exePath,cover:"",/.test(lines[i])) { lines[i] = lines[i].replace(/exePath:g\.exePath,cover:"",/, 'exePath:g.exePath,cover:g.cover||"",'); covers = true; }
    if (/toast\("Could not find Xbox Game Pass","err"\)/.test(lines[i])) { lines[i] = lines[i].replace('toast("Could not find Xbox Game Pass","err")', 'toast(result.error||"Could not find Xbox Game Pass","err")'); message = true; }
  }
  if (covers) notes.push("imported Xbox games keep their cover art");
  if (message) notes.push("if no games are found, AURA now says why");
  return { text: lines.join("\n"), notes };
}

// ── AURA's checks (only when they are installed): add the Xbox ones ───────────
function editRunner(text) {
  if (/xbox\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  const at = findLine(lines, /^if \(fs\.existsSync\(errorlog\)\) add\(/);
  if (at < 0) return { text, notes: ["(couldn't find where to add the Xbox checks, so npm test doesn't include them)"] };
  lines.splice(at + 1, 0,
    'const xboxFile = path.join(ROOT, "electron", "xbox.js");',
    'if (fs.existsSync(xboxFile) && fs.existsSync(path.join(__dirname, "xbox.cjs"))) add("files", "Xbox and Game Pass games", "xbox.cjs", [xboxFile]);');
  return { text: lines.join("\n"), notes: ["npm test now checks the Xbox import too"] };
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
      } else if (entry.name === "xbox.js" || entry.name === "xbox.cjs") {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. The Xbox import is back to how it was. Games already in your library stay there." : "Nothing to undo.");
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
  const files = {
    main: findOne("your main file", (t) => /ipcMain\.handle\(\s*["']import-xbox["']/.test(t), need, [
      (h) => startFile && sameFile(h.file, startFile),
      (h) => /ipcMain\.handle\(\s*["']launch-game["']/.test(h.text),
    ]),
    app: findOne("your App file", (t) => /function AuraApp\s*\(/.test(t) && /<AuraApp\b/.test(t), need, [
      (h) => /doImportXbox/.test(h.text),
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
  consider("main file", files.main, editMain, true);
  consider("App file", files.app, editApp, false);
  const runner = path.join(ROOT, "tests", "run.cjs");
  const hasChecks = fs.existsSync(runner);
  if (hasChecks) consider("checks", runner, editRunner, true);

  const created = [{ label: "xbox", file: path.join(path.dirname(files.main), "xbox.js"), content: FILES.xbox }];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "xbox.cjs"), content: FILES.test });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: Xbox and Game Pass games");
  say();
  for (const step of plan) {
    if (step.after !== step.before && !DRY) {
      const bak = step.file + BAK;
      if (!fs.existsSync(bak)) fs.copyFileSync(step.file, bak);
      fs.writeFileSync(step.file, withEol(step.after, step.eol));
    }
    say("  " + (step.label + ":").padEnd(11) + rel(step.file));
    (step.notes.length ? step.notes : ["already done"]).forEach((n) => say("             - " + n));
  }
  for (const c of created) {
    if (c.note !== "already done" && !DRY) { fs.mkdirSync(path.dirname(c.file), { recursive: true }); fs.writeFileSync(c.file, c.content); }
    say("  " + (c.label + ":").padEnd(11) + rel(c.file));
    say("             - " + c.note);
  }
  say();
  if (DRY) { say("Run it again without --dry-run to apply."); say(); return; }
  say("Done. To try it:");
  say("  1. Start AURA (if it was running, stop it in the terminal and start it again).");
  say('  2. Open Settings and click Import next to "Import Xbox Game Pass".');
  say("  3. Press Play on one of the games.");
  if (hasChecks) say("Then run  npm test  before your next release.");
  say("To undo later:  node aura-xbox-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
