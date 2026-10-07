#!/usr/bin/env node
/**
 * AURA — fix "Video player configuration error (Error 153)" on trailers in the installed app
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Run:   node aura-trailer-fix.cjs
 *
 * Why it happens: YouTube won't play an embedded video unless the request says which site or
 * app is embedding it. The version you run from the terminal is loaded from http://localhost,
 * which says so automatically. The installed app is loaded from a file, which says nothing.
 *
 * What it does:
 *   - your main file   adds a few lines that fill in that missing detail for YouTube embeds
 *   - package.json     1.8.0 -> 1.8.1, so the fix can go out as an update
 *
 * Every file it changes is copied to <name>.before-trailer-fix.bak first.
 * To put everything back:                 node aura-trailer-fix.cjs --undo
 * To preview without changing anything:   node aura-trailer-fix.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

// The address YouTube is told the videos are embedded from. Your own site is the honest answer.
const EMBEDDED_FROM = "https://taurreantraylor.com/";

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-trailer-fix.bak";
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "release", ".git", ".vite", "coverage"]);

const rel = (p) => path.relative(ROOT, p) || p;
const say = (line = "") => console.log(line);
function stop(lines) {
  say();
  say("Nothing was changed.");
  (Array.isArray(lines) ? lines : [lines]).forEach((l) => say("  " + l));
  say();
  process.exit(1);
}
function* walk(dir, depth = 0) {
  if (depth > 7) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) yield* walk(full, depth + 1);
    } else if (/\.(js|cjs|mjs)$/.test(entry.name) && !/^aura-[\w-]+\.cjs$/.test(entry.name)) {
      try { if (fs.statSync(full).size < 3 * 1024 * 1024) yield full; } catch {}
    }
  }
}

const FIX = `  // YouTube refuses to play embedded videos ("Error 153") unless the request says which site
  // or app is embedding them. The installed app is loaded from a file, which sends nothing,
  // so fill that in here. In dev (http://localhost) the browser already sends it.
  require("electron").session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ["https://www.youtube.com/embed*", "https://www.youtube-nocookie.com/embed*"] },
    (details, callback) => {
      const headers = details.requestHeaders;
      if (!headers.Referer && !headers.referer) headers.Referer = "${EMBEDDED_FROM}";
      callback({ requestHeaders: headers });
    }
  );
`.split("\n").slice(0, -1);

function editMain(text) {
  if (text.includes('refuses to play embedded videos ("Error 153")')) return { text, notes: [] };
  if (/webRequest\.onBeforeSendHeaders\(/.test(text)) throw new Error("a free spot: the file already changes request headers somewhere else, and only one such rule can exist");
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /^app\.whenReady\(\)\.then\(\s*(async\s*)?\(\)\s*=>\s*\{\s*$/.test(l));
  if (at < 0) throw new Error("the line  app.whenReady().then(() => {");
  lines.splice(at + 1, 0, ...FIX);
  return { text: lines.join("\n"), notes: ["YouTube embeds are now told where they're embedded from"] };
}

function editPackage(text) {
  let pkg;
  try { pkg = JSON.parse(text); } catch (e) { throw new Error("valid JSON in it (" + e.message + ")"); }
  if (pkg.version !== "1.8.0") return { text, notes: [], version: pkg.version };
  pkg.version = "1.8.1";
  return { text: JSON.stringify(pkg, null, 2) + (text.endsWith("\n") ? "\n" : ""), notes: ["version 1.8.0 -> 1.8.1"], version: "1.8.1" };
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

function undo() {
  let restored = 0;
  const visit = (dir, depth = 0) => {
    if (depth > 7) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) visit(full, depth + 1); }
      else if (entry.name.endsWith(BAK)) { const target = full.slice(0, -BAK.length); fs.copyFileSync(full, target); fs.unlinkSync(full); say("  restored  " + rel(target)); restored++; }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished." : "Nothing to undo.");
  say();
}

function run() {
  const pkgFile = path.join(ROOT, "package.json");
  if (!fs.existsSync(pkgFile)) stop(["This isn't your AURA project folder (no package.json here).", "Move this file next to package.json and run it from there."]);
  if (UNDO) return undo();

  const mains = [];
  for (const file of walk(ROOT)) { try { const t = fs.readFileSync(file, "utf8"); if (/ipcMain\.handle\(\s*["']fetch-trailer["']/.test(t) && /app\.whenReady\(\)/.test(t)) mains.push(file); } catch {} }
  if (mains.length !== 1) stop([mains.length ? "I found more than one file that looks like your main file:" : "I couldn't find your main file.", ...mains.map((m) => "  " + rel(m)), "Copy this message to Claude."]);

  const plan = [];
  const problems = [];
  let version = "";
  for (const [label, file, fn, check] of [["main file", mains[0], editMain, true], ["package", pkgFile, editPackage, false]]) {
    const raw = fs.readFileSync(file, "utf8");
    const eol = raw.includes("\r\n") ? "\r\n" : "\n"; // keep Windows line endings as they are
    const text = raw.replace(/\r\n/g, "\n");
    try {
      const result = fn(text);
      if (result.version) version = result.version;
      if (check && result.text !== text) { const bad = syntaxProblem(result.text); if (bad) throw new Error("a way to edit it safely (" + bad + ")"); }
      plan.push({ label, file, before: text, after: result.text, eol, notes: result.notes });
    } catch (e) { problems.push("In " + rel(file) + " I couldn't find " + e.message + "."); }
  }
  if (problems.length) stop([...problems, "Copy this message to Claude."]);

  say();
  say(DRY ? "Dry run. This is what would change:" : "AURA trailer fix");
  say();
  for (const step of plan) {
    if (step.after !== step.before && !DRY) {
      const bak = step.file + BAK;
      if (!fs.existsSync(bak)) fs.copyFileSync(step.file, bak);
      fs.writeFileSync(step.file, step.eol === "\n" ? step.after : step.after.replace(/\n/g, step.eol));
    }
    say("  " + (step.label + ":").padEnd(11) + rel(step.file));
    (step.notes.length ? step.notes : ["already done"]).forEach((n) => say("             - " + n));
  }
  say();
  if (DRY) { say("Run it again without --dry-run to apply."); say(); return; }
  say("The trailer only breaks in the installed app, so test a packaged copy before publishing:");
  say();
  say("  1. Close every AURA window.");
  say("  2. npm run build");
  say("  3. npx electron-builder --dir --publish never");
  say("  4. Open the aura.exe it creates in  dist\\win-unpacked  and play a trailer.");
  say();
  say("If the trailer plays, publish it as " + version + ":");
  say();
  say("  git add -A");
  say('  git commit -m "AURA ' + version + ': fix trailers in the installed app"');
  say("  git push");
  say("  git tag v" + version);
  say("  git push origin v" + version);
  say();
  say("To undo:  node aura-trailer-fix.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
