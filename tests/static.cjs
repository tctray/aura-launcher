// Checks that need nothing but the project's own files. Each one guards against a way a release
// has gone wrong before, or easily could:
//   - a typing mistake in the main-process code (the window build doesn't cover those files)
//   - the window calling something the main process doesn't answer
//   - keys or setup-script backups ending up inside the installer or on GitHub
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok || extra === undefined ? "" : "\n          " + String(extra).split("\n").join("\n          "))); };
const note = (text) => console.log("  note  " + text);
const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out); else out.push(full);
  }
  return out;
}

const pkg = JSON.parse(read(path.join(ROOT, "package.json")) || "{}");
const mainFile = path.join(ROOT, pkg.main || "electron/main.js");
const electronDir = path.dirname(mainFile);
const mainSide = walk(electronDir).filter((f) => /\.(c?js)$/.test(f));

console.log("1. The main-process code");
const broken = [];
for (const file of mainSide) {
  let r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (r.status !== 0 && /^\s*(import|export)\s/m.test(read(file))) {
    // A file written with import/export: check it as that kind of file
    const tmp = path.join(fs.mkdtempSync(path.join(require("os").tmpdir(), "aura-check-")), "check.mjs");
    fs.writeFileSync(tmp, read(file));
    r = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
    try { fs.rmSync(path.dirname(tmp), { recursive: true, force: true }); } catch {}
  }
  if (r.status !== 0) broken.push(rel(file) + ": " + String(r.stderr || "").split("\n").filter(Boolean).slice(0, 3).join(" | "));
}
check(`all ${mainSide.length} files in ${rel(electronDir)}/ are valid JavaScript`, mainSide.length > 0 && !broken.length, broken.join("\n"));
check("the file AURA starts from exists (" + rel(mainFile) + ")", fs.existsSync(mainFile));

console.log("2. What the window asks for, and who answers");
// Every channel the window can call through preload.js needs an answer in the main process
const preloads = mainSide.filter((f) => /exposeInMainWorld\(/.test(read(f)));
const asked = new Map(); // channel -> file
for (const file of preloads) for (const m of read(file).matchAll(/ipcRenderer\.(?:invoke|send|sendSync)\(\s*["'`]([^"'`$]+)["'`]/g)) if (!asked.has(m[1])) asked.set(m[1], rel(file));
const answered = new Set();
for (const file of mainSide) {
  const text = read(file);
  for (const m of text.matchAll(/ipcMain\.(?:handle|handleOnce|on|once)\(\s*["'`]([^"'`$]+)["'`]/g)) answered.add(m[1]);
  // social.js answers "social:<name>" for every name in its list
  const prefix = text.match(/ipcMain\.handle\(\s*["'`]([\w-]+:)["'`]\s*\+\s*name\b/);
  const list = text.match(/const api\s*=\s*\{([^}]*)\}/);
  if (prefix && list) for (const name of list[1].split(",").map((s) => s.trim().split(":")[0].trim()).filter(Boolean)) answered.add(prefix[1] + name);
}
const knownFile = path.join(__dirname, "known-gaps.json");
let known = [];
try { known = JSON.parse(read(knownFile) || "[]"); } catch {}
const unanswered = [...asked.keys()].filter((c) => !answered.has(c)).sort();
if (process.argv.includes("--record-gaps")) { fs.writeFileSync(knownFile, JSON.stringify(unanswered, null, 2) + "\n"); note(`recorded ${unanswered.length} existing gap(s) in tests/known-gaps.json`); known = unanswered; }
const fresh = unanswered.filter((c) => !known.includes(c));
check(`found the bridge (${preloads.map(rel).join(", ") || "none"}) with ${asked.size} calls, and ${answered.size} answers`, preloads.length > 0 && asked.size > 0 && answered.size > 0);
check("every call the window can make has an answer in the main process", !fresh.length, fresh.map((c) => `"${c}" is called in ${asked.get(c)} but nothing answers it`).join("\n"));
const stillKnown = known.filter((c) => unanswered.includes(c));
if (stillKnown.length) note(`${stillKnown.length} older call(s) with no answer, known about when these checks were set up: ${stillKnown.join(", ")}`);

console.log("3. What goes into the installer, and onto GitHub");
const build = pkg.build || {};
const packed = JSON.stringify([build.files || [], build.extraResources || [], build.extraFiles || []]);
check("the version is three numbers (" + pkg.version + ")", /^\d+\.\d+\.\d+$/.test(String(pkg.version || "")));
check("no .env file is packed into the installer", !/["'/\\]\.env\b/.test(packed), packed);
check("setup-script backups (*.bak) are kept out of the installer", (build.files || []).some((f) => /^!.*\*\.bak$/.test(f)), JSON.stringify(build.files || []));
const ignore = read(path.join(ROOT, ".gitignore")).split(/\r?\n/).map((l) => l.trim());
check(".env is in .gitignore", ignore.includes(".env"));
const git = spawnSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" });
if (git.status === 0) {
  const tracked = git.stdout.split("\n").filter(Boolean);
  check(".env is not saved in git", !tracked.includes(".env"));
  check("no setup-script backups are saved in git", !tracked.some((f) => f.endsWith(".bak")), tracked.filter((f) => f.endsWith(".bak")).join("\n"));
} else note("git isn't available here, so the two git checks were skipped");
// Secret keys never belong in the code. (The publishable Supabase key is fine: it is meant to be public.)
const SECRET = /sb_secret_[A-Za-z0-9_-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:CLIENT_SECRET|API_KEY)["']?\s*[:=]\s*["'][A-Za-z0-9_\-]{20,}["']/;
const leaky = [...mainSide, ...walk(path.join(ROOT, "src"))].filter((f) => /\.(c?js|jsx|json)$/.test(f) && SECRET.test(read(f))).map(rel);
check("no secret keys are written in the code", !leaky.length, leaky.join("\n"));

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
