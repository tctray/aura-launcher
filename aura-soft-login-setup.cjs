#!/usr/bin/env node
/**
 * AURA — a softer sign-in screen and Log out
 *
 *   - Sign-in fields: rounded and quiet until you use them, with plain labels (no ALL CAPS).
 *   - The Log in / Sign up switch and the buttons: soft pill shapes, plain lettering.
 *   - Log out: a warmer red (instead of the bright pink-red), calmer and rounded in the menu.
 *   - The "Log out of AURA?" box: rounder, and its title is readable again.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-soft-login-setup.cjs
 *
 * What it does:
 *   - edits    src/components/auth.jsx   only its look (one block at the end of its styles)
 *
 * The file is copied to auth.jsx.before-soft-login.bak first.
 * To put it back:                         node aura-soft-login-setup.cjs --undo
 * To preview without changing anything:   node aura-soft-login-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FILES = {};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-soft-login.bak";
const MARK = "Added by aura-soft-login-setup.cjs";
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

const SOFT = `
/* ── A softer, rounder look (${MARK}) ── */
/* Fields: rounded, quiet until you use them */
.auth-form{gap:14px;text-align:left}
.auth-label{font-size:12.5px;font-weight:500;letter-spacing:0;text-transform:none;color:var(--a-t2);margin:0 0 7px 4px}
.auth-input{background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:13px 16px;font-size:14px;transition:border-color .2s,background .2s,box-shadow .2s}
.auth-input::placeholder{color:rgba(255,255,255,.28)}
.auth-input:hover{background:rgba(255,255,255,.06)}
.auth-input:focus{background:rgba(255,255,255,.065);border-color:color-mix(in srgb,var(--a-ac) 55%,transparent);box-shadow:0 0 0 4px color-mix(in srgb,var(--a-ac) 14%,transparent)}
.auth-hint{margin-left:4px}
.auth-password .auth-input{padding-right:72px}
.auth-show{right:7px;padding:6px 11px;border-radius:999px;font-size:11.5px;font-weight:500;color:var(--a-t2);background:rgba(255,255,255,.06)}
.auth-show:hover{background:rgba(255,255,255,.11);color:var(--a-t1)}
/* Log in / Sign up: a soft pill switch */
.auth-seg{border-radius:999px;padding:4px;background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.07)}
.auth-seg button{border-radius:999px;font-weight:500;padding:9px 0}
.auth-seg button.on{background:rgba(255,255,255,.1);color:var(--a-t1);box-shadow:0 1px 6px rgba(0,0,0,.25)}
/* Buttons: rounded, plain words (no shouting) */
.auth-btn{border-radius:999px;padding:13px 18px;font-family:'DM Sans',system-ui,sans-serif;font-size:14.5px;font-weight:600;letter-spacing:.1px;background:linear-gradient(135deg,var(--a-ac),var(--a-ac2))}
.auth-btn:hover:not(:disabled){filter:brightness(1.06);transform:translateY(-1px);box-shadow:0 8px 22px color-mix(in srgb,var(--a-ac) 30%,transparent)}
.auth-btn.ghost{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.08)}
.auth-btn.ghost:hover:not(:disabled){background:rgba(255,255,255,.09);border-color:rgba(255,255,255,.12)}
.auth-btn.danger{background:#e5484d;border-color:transparent;color:#fff}
.auth-btn.danger:hover:not(:disabled){background:#ec5d5e;box-shadow:0 8px 22px rgba(229,72,77,.28)}
.auth-msg{border-radius:14px;padding:11px 14px}
.auth button:focus-visible,.auth-dim button:focus-visible{outline-offset:3px;border-radius:999px}
/* The log out question: rounder, and readable */
.auth-dim{background:rgba(6,6,10,.62);backdrop-filter:blur(14px)}
.auth-dialog{border-radius:24px;padding:28px 26px 22px;border-color:rgba(255,255,255,.09);text-align:center;box-shadow:0 30px 70px rgba(0,0,0,.55)}
.auth-dialog .auth-title{color:var(--a-t1);font-family:'DM Sans',system-ui,sans-serif;font-size:19px;font-weight:600;letter-spacing:0}
.auth-dialog .auth-text{font-size:13.5px}
.auth-dialog-actions .auth-btn{font-size:14px;padding:11px 14px}
/* Log out in the side menu: calm and rounded; a warm red only when you point at it */
.sb-item.aura-logout,.gm-rail-item.aura-logout{color:var(--t3,rgba(255,255,255,.5));border-radius:12px;transition:background .2s,color .2s}
.sb-item.aura-logout:hover,.gm-rail-item.aura-logout:hover{background:rgba(255,255,255,.05);color:var(--t1,#fff)}
.sb-item.aura-logout:hover svg,.gm-rail-item.aura-logout:hover svg{color:#ec5d5e}
.aura-logout:focus-visible{border-radius:12px}
`;
function editAuth(text) {
  if (text.includes(MARK)) return { text, notes: [] };
  const end = "\n:root:has(.now-playing) .gm-rail{padding-bottom:88px}\n`;";
  return {
    text: swapOnce(text, end, "\n:root:has(.now-playing) .gm-rail{padding-bottom:88px}\n" + SOFT + "`;", "the end of the sign-in look ( :root:has(.now-playing) .gm-rail{...} )"),
    notes: [
      "sign-in fields: rounded and quiet, with plain labels (no ALL CAPS)",
      "Log in / Sign up switch and buttons: soft pill shapes, plain lettering",
      "Log out: calmer in the menu, a warmer red, and its question box is rounder and easier to read",
    ],
  };
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
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. The sign-in screen looks as it did." : "Nothing to undo.");
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
    auth: findOne("your sign-in file", (t) => /export function AuthGate\s*\(/.test(t) && /export function LogoutButton\s*\(/.test(t), need, [
      (h) => /^auth\.[jt]sx?$/.test(path.basename(h.file)) && /[\\/]components[\\/]/.test(h.file),
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
  consider("sign-in file", files.auth, editAuth, false);
  const hasChecks = fs.existsSync(path.join(ROOT, "tests", "run.cjs"));

  const created = [];
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: a softer sign-in screen");
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
  say("Done. Restart AURA (stop it in the terminal and start it again) to see the new look.");
  if (hasChecks) say("Run  npm test  before your next release.");
  say("To undo later:  node aura-soft-login-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
