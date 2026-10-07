#!/usr/bin/env node
/**
 * AURA — a switch for the Home banner
 *
 * Adds "Home Banner" to Settings > Display. Turn it off and the game slideshow at the top of
 * Home goes away, so your background shows across the whole page. It is on by default, and the
 * choice is remembered (and follows your account to another PC, like your other settings).
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-banner-toggle-setup.cjs
 *
 * What it does:
 *   - edits    your App file     one new setting, its switch in Settings, and the Home page obeys it
 *
 * The file it changes is copied to <name>.before-banner-toggle.bak first.
 * To put everything back:                 node aura-banner-toggle-setup.cjs --undo
 * To preview without changing anything:   node aura-banner-toggle-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-banner-toggle.bak";
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
    } else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
      try { if (fs.statSync(full).size < 3 * 1024 * 1024) yield full; } catch {}
    }
  }
}
const indentOf = (line) => line.match(/^\s*/)[0];
const findLine = (lines, re, from = 0, to = lines.length) => { for (let i = from; i < to; i++) if (re.test(lines[i])) return i; return -1; };

function editApp(text) {
  const lines = text.split("\n");
  const notes = [];
  const fail = (what) => { throw new Error(what); };

  // 1. The setting itself, on by default
  if (findLine(lines, /^\s*homeBanner\s*:/) < 0) {
    const start = findLine(lines, /^const SETTINGS_DEFAULTS\s*=\s*\{\s*$/);
    if (start < 0) fail("the list of settings ( const SETTINGS_DEFAULTS = { )");
    const end = findLine(lines, /^\};\s*$/, start);
    let at = findLine(lines, /^\s*noBlur\s*:/, start, end);
    if (at < 0) at = findLine(lines, /^\s*reduceMotion\s*:/, start, end);
    if (at < 0) fail("the display settings ( noBlur: false, ) in SETTINGS_DEFAULTS");
    lines.splice(at + 1, 0, indentOf(lines[at]) + "homeBanner: true,       // the game slideshow at the top of Home");
    notes.push("new setting: Home Banner (on by default)");
  }

  // 2. Its switch in Settings > Display
  if (findLine(lines, /<Tog k="homeBanner"\/>/) < 0) {
    let at = findLine(lines, /<Tog k="noBlur"\/>\s*<\/div>\s*$/);
    if (at < 0) at = findLine(lines, /<Tog k="reduceMotion"\/>\s*<\/div>\s*$/);
    if (at < 0) fail('the Display switches in Settings ( <Tog k="noBlur"/> )');
    lines.splice(at + 1, 0, indentOf(lines[at]) + '<div className="sr"><div><div className="sr-l">Home Banner</div><div className="sr-s">The game slideshow at the top of Home. Turn it off to see your whole background</div></div><Tog k="homeBanner"/></div>');
    notes.push("switch added to Settings, under Display");
  }

  // 3. Home obeys it. With the banner gone, a little room is left at the top for the search box.
  if (findLine(lines, /settings\.homeBanner/) < 0) {
    const app = findLine(lines, /^function AuraApp\s*\(/);
    if (app < 0 || findLine(lines, /^\s*const settings\s*=\s*useSettings\(\)\s*;?\s*$/, app) < 0) fail("const settings=useSettings() inside AuraApp");
    const at = findLine(lines, /^\s*\{!srch&&<GMBanner\b.*\/>\}\s*$/, app);
    if (at < 0) fail("the Home banner line ( {!srch&&<GMBanner ... />} )");
    lines[at] = lines[at].replace("{!srch&&<GMBanner", "{!srch&&settings.homeBanner&&<GMBanner");
    lines.splice(at + 1, 0, indentOf(lines[at]) + "{!srch&&!settings.homeBanner&&<div style={{height:58,flexShrink:0}}/>}");
    notes.push("the Home page shows or hides the banner to match");
  }
  return { text: lines.join("\n"), notes };
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
      else if (entry.name.endsWith(BAK)) {
        const target = full.slice(0, -BAK.length);
        fs.copyFileSync(full, target); fs.unlinkSync(full);
        say("  restored  " + rel(target)); restored++;
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. The Home banner is always shown again." : "Nothing to undo.");
  say();
}

function run() {
  if (!fs.existsSync(path.join(ROOT, "package.json"))) stop(["This isn't your AURA project folder (no package.json here).", "Move this file next to package.json and run it from there."]);
  if (UNDO) return undo();
  const hits = [];
  for (const file of walk(ROOT)) {
    let text = "";
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    if (/function AuraApp\s*\(/.test(text) && /function GMBanner\s*\(/.test(text) && /SETTINGS_DEFAULTS/.test(text)) hits.push(file);
  }
  if (!hits.length) stop(["I couldn't find your App file.", "Make sure this file is in your AURA project folder, next to package.json.", "Copy this message to Claude."]);
  if (hits.length > 1) stop(["I found more than one file that looks like your App file:", ...hits.map((h) => "  " + rel(h)), "Copy this message to Claude."]);
  const file = hits[0];
  const { text, eol } = readText(file);
  let result;
  try { result = editApp(text); } catch (e) { stop(["In " + rel(file) + " I couldn't find " + e.message + ".", "Copy this message to Claude."]); }

  say();
  say(DRY ? "Dry run. This is what would change:" : "AURA: Home banner switch");
  say();
  if (result.text !== text && !DRY) {
    const bak = file + BAK;
    if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
    fs.writeFileSync(file, withEol(result.text, eol));
  }
  say("  App file:  " + rel(file));
  (result.notes.length ? result.notes : ["already done"]).forEach((n) => say("             - " + n));
  say();
  if (DRY) { say("Run it again without --dry-run to apply."); say(); return; }
  say("Done. Start AURA, open Settings, and under Display switch Home Banner off.");
  say("To undo later:  node aura-banner-toggle-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
