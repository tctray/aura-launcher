#!/usr/bin/env node
/**
 * AURA — no menu bar, no developer tools
 *
 *   - The menu bar at the top of AURA (File, Edit, View, Window, Help) is gone from every window.
 *     It let anyone open the developer tools or reload AURA by accident.
 *   - In the installed AURA, developer tools can't be opened at all, in any window, the Twitch
 *     player or the Social browser.
 *   - While you're developing (npm start), F12 or Ctrl+Shift+I still opens them.
 *   - F11 for full screen keeps working (it's AURA's own now, not the menu's).
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-no-devtools-setup.cjs
 *
 * What it does:
 *   - edits    electron/main.js         no menu bar, no developer tools in the installed app
 *   - creates  tests/no-devtools.cjs    (only if AURA's checks are installed) checks it
 *
 * Every file it changes is copied to <name>.before-no-devtools.bak first.
 * To put everything back:                 node aura-no-devtools-setup.cjs --undo
 * To preview without changing anything:   node aura-no-devtools-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FILES = {"test":"// No menu bar and no developer tools in the installed AURA (they still work while developing).\n// Added by aura-no-devtools-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst path = require(\"path\");\nconst ROOT = path.resolve(__dirname, \"..\");\nlet failed = 0;\nconst check = (name, ok) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name); };\nconst main = fs.readFileSync(path.join(ROOT, \"electron\", \"main.js\"), \"utf8\");\ncheck(\"there's no menu bar on AURA's windows\", /Menu\\.setApplicationMenu\\(null\\)/.test(main) && /mainWin\\.setMenu\\(null\\)/.test(main));\ncheck(\"the main window has no developer tools in the installed app\", /devTools: !app\\.isPackaged/.test(main));\ncheck(\"developer tools opened any other way close again in the installed app (every window, view and page)\", /app\\.on\\(\"web-contents-created\"[\\s\\S]{0,300}if \\(app\\.isPackaged\\) contents\\.on\\(\"devtools-opened\"[^\\n]*closeDevTools\\(\\)/.test(main));\ncheck(\"while developing, F12 or Ctrl+Shift+I opens them\", /if \\(!app\\.isPackaged\\) \\{[\\s\\S]{0,200}before-input-event[\\s\\S]{0,300}\"F12\"[\\s\\S]{0,200}toggleDevTools\\(\\)/.test(main));\ncheck(\"nothing in AURA opens developer tools by itself\", !/\\.openDevTools\\(/.test(main));\nconsole.log(failed ? `\\n${failed} FAILED` : \"\\nall passed\");\nprocess.exit(failed ? 1 : 0);\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-no-devtools.bak";
const MARK = "Added by aura-no-devtools-setup.cjs";
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

function editMain(text) {
  if (text.includes("setApplicationMenu(null)")) return { text, notes: [] };
  let t = text;
  // Every window, view and embedded page: developer tools can't open in the installed app
  t = swapOnce(t, 'app.on("web-contents-created", (_e, contents) => {\n  const type = contents.getType();\n',
    'app.on("web-contents-created", (_e, contents) => {\n' +
    "  // The installed AURA has no developer tools: if anything opens them, they close (" + MARK + ")\n" +
    '  if (app.isPackaged) contents.on("devtools-opened", () => { try { contents.closeDevTools(); } catch {} });\n' +
    "  const type = contents.getType();\n",
    'the hook for every window ( app.on("web-contents-created", (_e, contents) => { ... ) — run aura-security-setup.cjs first if you haven\'t');
  // The main window: no developer tools in the installed app
  t = swapOnce(t, "      nodeIntegration: false,\n      webviewTag: true,\n",
    "      nodeIntegration: false,\n      devTools: !app.isPackaged, // developer tools only while developing (" + MARK + ")\n      webviewTag: true,\n",
    "the main window's settings ( nodeIntegration: false, webviewTag: true, )");
  // The menu bar (File, Edit, View, Window, Help) goes; while developing, F12 still opens the tools
  t = swapOnce(t, "  permissions.lock(mainWin.webContents.session);\n",
    "  permissions.lock(mainWin.webContents.session);\n" +
    "  // No menu bar (File, Edit, View...): it offered developer tools and reloading the page (" + MARK + ")\n" +
    "  mainWin.setMenu(null);\n" +
    "  if (!app.isPackaged) {\n" +
    "    // While developing: F12 or Ctrl+Shift+I opens the developer tools\n" +
    '    mainWin.webContents.on("before-input-event", (event, input) => {\n' +
    '      if (input.type !== "keyDown") return;\n' +
    '      if (input.key === "F12" || (input.control && input.shift && String(input.key).toLowerCase() === "i")) { event.preventDefault(); mainWin.webContents.toggleDevTools(); }\n' +
    "    });\n" +
    "  }\n",
    "where the main window is set up ( permissions.lock(mainWin.webContents.session); )");
  t = swapOnce(t, "app.whenReady().then(() => {\n",
    "app.whenReady().then(() => {\n" +
    "  require(\"electron\").Menu.setApplicationMenu(null); // no menu bar on any of AURA's windows (" + MARK + ")\n",
    "where AURA starts ( app.whenReady().then(() => { )");
  return { text: t, notes: [
    "the menu bar (File, Edit, View, Window, Help) is gone from every AURA window",
    "developer tools can't be opened in the installed AURA",
    "while developing (npm start), F12 or Ctrl+Shift+I still opens them",
  ] };
}

// ── AURA's checks (only when they are installed) ─────────────────────────────
function editRunner(text) {
  if (/no-devtools\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  const at = findLine(lines, /^add\("window",/);
  if (at < 0) return { text, notes: ["(couldn't find where to add the check, so npm test doesn't include it)"] };
  lines.splice(at, 0, 'if (fs.existsSync(path.join(__dirname, "no-devtools.cjs"))) add("files", "No menu bar or developer tools in the installed AURA", "no-devtools.cjs");');
  return { text: lines.join("\n"), notes: ["npm test now checks there's no menu bar or developer tools"] };
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
      } else if (entry.name === "no-devtools.cjs") {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. The menu bar is back." : "Nothing to undo.");
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
    main: findOne("your main file", (t) => /function createWindow\s*\(/.test(t) && /permissions\.lock\(mainWin\.webContents\.session\)/.test(t), need, [
      (h) => startFile && sameFile(h.file, startFile),
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
  const runner = path.join(ROOT, "tests", "run.cjs");
  const hasChecks = fs.existsSync(runner);
  if (hasChecks) consider("checks", runner, editRunner, true);

  const created = [];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "no-devtools.cjs"), content: FILES.test });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: no menu bar, no developer tools");
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
  say("Done. Restart AURA (stop it in the terminal and start it again): the menu bar is gone. While developing, F12 still opens the developer tools.");
  if (hasChecks) say("Run  npm test  before your next release.");
  say("To undo later:  node aura-no-devtools-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
