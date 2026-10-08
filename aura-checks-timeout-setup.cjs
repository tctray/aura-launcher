#!/usr/bin/env node
/**
 * AURA — stop a stuck release from sitting for hours
 *
 * On GitHub, the "test" step of a release got stuck and stayed "In progress" for hours.
 * This makes that impossible:
 *   - every job has a time limit, so GitHub stops it and marks it red instead of waiting
 *   - the test job no longer downloads things it doesn't use (the Electron program, ffmpeg and
 *     extra system packages), which is where a download can stall
 *   - each check has its own time limit and says so if it runs out
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Run:   node aura-checks-timeout-setup.cjs
 *   3. Then release as usual.
 *
 * What it does:
 *   - edits    .github/workflows/build.yml     time limits, and a lighter test job
 *   - edits    tests/run.cjs                   a time limit for each check
 *
 * Every file it changes is copied to <name>.before-timeouts.bak first.
 * To put everything back:                 node aura-checks-timeout-setup.cjs --undo
 * To preview without changing anything:   node aura-checks-timeout-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-timeouts.bak";
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
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  return { text: raw.replace(/\r\n/g, "\n"), eol };
}
const withEol = (text, eol) => (eol === "\n" ? text : text.replace(/\n/g, eol));
const indentOf = (line) => line.match(/^\s*/)[0];
const findLine = (lines, re, from = 0, to = lines.length) => { for (let i = from; i < to; i++) if (re.test(lines[i])) return i; return -1; };

// ── The release workflow ──────────────────────────────────────────────────────
function editWorkflow(text) {
  const lines = text.split("\n");
  const notes = [];
  const jobsAt = findLine(lines, /^jobs:\s*$/);
  if (jobsAt < 0) throw new Error("the jobs in this workflow");
  // Job names are the lines indented one step under "jobs:"
  let step = null;
  const starts = [];
  for (let i = jobsAt + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(\s+)([\w-]+):\s*$/);
    if (!m) { if (/^\S/.test(lines[i])) break; continue; }
    if (step === null) step = m[1];
    if (m[1] === step) starts.push({ at: i, name: m[2] });
  }
  const job = (name) => { const n = starts.findIndex((s) => s.name === name); return n < 0 ? null : { from: starts[n].at, to: n + 1 < starts.length ? starts[n + 1].at : lines.length }; };
  if (!job("test")) throw new Error("the test job (run aura-reliability-setup.cjs first)");

  // 1. A time limit on every job (done from the last job up, so line numbers stay right)
  let limited = 0;
  for (let n = starts.length - 1; n >= 0; n--) {
    const from = starts[n].at, to = n + 1 < starts.length ? starts[n + 1].at : lines.length;
    if (findLine(lines, new RegExp("^" + step + step + "timeout-minutes:"), from, to) >= 0) continue;
    const runsOn = findLine(lines, /^\s+runs-on:/, from, to);
    if (runsOn < 0) continue;
    lines.splice(runsOn + 1, 0, indentOf(lines[runsOn]) + "timeout-minutes: " + (starts[n].name === "test" ? 15 : 45) + "   # GitHub stops the job after this, instead of waiting for hours");
    starts.forEach((s) => { if (s.at > runsOn) s.at++; });
    limited++;
  }
  if (limited) notes.push("every job now has a time limit (15 minutes for the checks, 45 for a build)");

  // 2. The test job: install without the big downloads it doesn't use
  let t = job("test");
  const install = findLine(lines, /^\s+run:\s*npm install\s*$/, t.from, t.to);
  if (install >= 0) {
    lines[install] = indentOf(lines[install]) + "run: npm install --ignore-scripts --no-audit --no-fund   # the checks don't need the Electron program or ffmpeg downloaded";
    notes.push("the checks no longer download the Electron program and ffmpeg");
  }
  // 3. The browser for the window check: just the browser, with a time limit. If it can't be
  //    fetched, the window check uses the Chrome or Edge that GitHub's machine already has.
  t = job("test");
  const browser = findLine(lines, /^\s+run:\s*npx playwright install --with-deps chromium\s*$/, t.from, t.to);
  if (browser >= 0) {
    const pad = indentOf(lines[browser]);
    lines.splice(browser, 1, pad + "run: npx playwright install chromium", pad + "timeout-minutes: 5", pad + "continue-on-error: true   # if this can't be fetched, the check uses the Chrome already on GitHub's machine");
    notes.push("fetching the test browser can't stall the release any more");
  }
  return { text: lines.join("\n"), notes };
}

// ── tests/run.cjs: a time limit for each check ────────────────────────────────
function editRunner(text) {
  if (/STEP_MINUTES/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  const build = findLine(lines, /^\s*const built = spawnSync\("npm", \["run", "build"\], \{ cwd: ROOT, encoding: "utf8", shell: true \}\);\s*$/);
  const go = findLine(lines, /^\s*const go = \(\) => spawnSync\(process\.execPath, \[step\.file, \.\.\.step\.args\], \{ cwd: ROOT, encoding: "utf8", env: process\.env, maxBuffer: 64 \* 1024 \* 1024 \}\);\s*$/);
  const again = findLine(lines, /^\s*if \(step\.group === "messages" && run\.status !== 0 && run\.status !== 3\) \{ again = true; run = go\(\); \}\s*$/);
  const shown = findLine(lines, /^\s*if \(shown\.length\) console\.log\(shown\.join\("\\n"\)\);\s*$/);
  const results = findLine(lines, /^const results = \[\];\s*$/);
  if (build < 0 || go < 0 || again < 0 || shown < 0 || results < 0) throw new Error("the places to add time limits (it may be a different version of the checks)");
  lines[shown] = lines[shown] + "\n" + indentOf(lines[shown]) + "if (tooLong(run)) console.log(`  FAIL  this part didn't finish within ${STEP_MINUTES} minutes, so it was stopped`);";
  lines[again] = lines[again].replace('run.status !== 3) {', 'run.status !== 3 && !tooLong(run)) {');
  lines[go] = lines[go].replace("maxBuffer: 64 * 1024 * 1024 });", "maxBuffer: 64 * 1024 * 1024, timeout: STEP_MINUTES * 60000, killSignal: \"SIGKILL\" });");
  lines[build] = lines[build].replace("shell: true });", "shell: true, timeout: STEP_MINUTES * 60000 });");
  lines.splice(results, 0,
    "// No check may run for ever: after this many minutes it is stopped and counted as failed",
    "const STEP_MINUTES = Number(process.env.AURA_STEP_MINUTES) > 0 ? Number(process.env.AURA_STEP_MINUTES) : 6;",
    "const tooLong = (run) => !!run.error && run.error.code === \"ETIMEDOUT\";",
    "");
  return { text: lines.join("\n"), notes: ["each check is stopped if it runs longer than 6 minutes"] };
}

function syntaxProblem(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-check-"));
  const file = path.join(dir, "check.cjs");
  try { fs.writeFileSync(file, text); const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" }); return r.status === 0 ? "" : String(r.stderr || "syntax error").split("\n").filter(Boolean).slice(0, 3).join(" | "); }
  catch { return ""; } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
}

function undo() {
  let restored = 0;
  say();
  for (const dir of [path.join(ROOT, ".github", "workflows"), path.join(ROOT, "tests")]) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch {}
    for (const name of names) if (name.endsWith(BAK)) {
      const full = path.join(dir, name), target = full.slice(0, -BAK.length);
      fs.copyFileSync(full, target); fs.unlinkSync(full);
      say("  restored  " + rel(target)); restored++;
    }
  }
  say(restored ? "Undo finished." : "Nothing to undo.");
  say();
}

function run() {
  if (!fs.existsSync(path.join(ROOT, "package.json"))) stop(["This isn't your AURA project folder (no package.json here).", "Move this file next to package.json and run it from there."]);
  if (UNDO) return undo();
  const flows = path.join(ROOT, ".github", "workflows");
  let workflows = [];
  try { workflows = fs.readdirSync(flows).filter((f) => /\.ya?ml$/.test(f)).map((f) => path.join(flows, f)).filter((f) => /^\s*run:\s*npm (test|run test:aura)\b/m.test(fs.readFileSync(f, "utf8"))); } catch {}
  const runner = path.join(ROOT, "tests", "run.cjs");
  if (!workflows.length) stop(["I couldn't find the release workflow with AURA's checks in it (.github/workflows).", "Run aura-reliability-setup.cjs first.", "Copy this message to Claude."]);
  if (!fs.existsSync(runner)) stop(["I couldn't find tests/run.cjs.", "Run aura-reliability-setup.cjs first.", "Copy this message to Claude."]);

  const plan = [], problems = [];
  const consider = (label, file, edit, check) => {
    const { text, eol } = readText(file);
    try {
      const result = edit(text);
      if (check && result.text !== text) { const bad = syntaxProblem(result.text); if (bad) throw new Error("a way to edit it safely (" + bad + ")"); }
      plan.push({ label, file, before: text, after: result.text, eol, notes: result.notes });
    } catch (e) { problems.push("In " + rel(file) + " I couldn't find " + e.message + "."); }
  };
  for (const wf of workflows) consider("release", wf, editWorkflow, false);
  consider("checks", runner, editRunner, true);
  if (problems.length) stop([...problems, "Copy this message to Claude."]);

  say();
  say(DRY ? "Dry run. This is what would change:" : "AURA: time limits for releases");
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
  say();
  if (DRY) { say("Run it again without --dry-run to apply."); say(); return; }
  say("Done. Run  npm test  once, then release as usual.");
  say("To undo later:  node aura-checks-timeout-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
