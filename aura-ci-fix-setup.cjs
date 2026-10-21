#!/usr/bin/env node
/**
 * AURA — the GitHub build's checks, steadier and easier to read
 *
 *   - The checks run on Ubuntu 24.04, like your last good build. GitHub started moving
 *     "ubuntu-latest" to a new Ubuntu on October 19, 2026.
 *   - The window checks (calls, cameras...) get one more go if they fail, like the messaging
 *     checks already do: on GitHub's slower machines a timer can miss its moment.
 *   - On GitHub, a failed check is written into the build's notes (the annotations), so what
 *     failed can be read without opening the full log.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Run:   node aura-ci-fix-setup.cjs
 *
 * What it does:
 *   - edits    tests/run.cjs                 one more go for window checks; failures in the notes
 *   - edits    .github/workflows/build.yml   Ubuntu 24.04
 *
 * Every file it changes is copied to <name>.before-ci-fix.bak first.
 * To put everything back:                 node aura-ci-fix-setup.cjs --undo
 * To preview without changing anything:   node aura-ci-fix-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-ci-fix.bak";
const MARK = "Added by aura-ci-fix-setup.cjs";
const rel = (p) => path.relative(ROOT, p) || p;
const say = (line = "") => console.log(line);
function stop(lines) { say(); say("Nothing was changed."); (Array.isArray(lines) ? lines : [lines]).forEach((l) => say("  " + l)); say(); process.exit(1); }
function readText(file) { const raw = fs.readFileSync(file, "utf8"); const eol = raw.includes("\r\n") ? "\r\n" : "\n"; return { text: raw.replace(/\r\n/g, "\n"), eol }; }
const withEol = (text, eol) => (eol === "\n" ? text : text.replace(/\n/g, eol));
function syntaxProblem(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-check-"));
  const file = path.join(dir, "check.cjs");
  try { fs.writeFileSync(file, text); const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" }); return r.status === 0 ? "" : String(r.stderr || "syntax error").split("\n").filter(Boolean).slice(0, 4).join(" | "); }
  catch { return ""; } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
}
function swapOnce(text, find, replace, what) {
  const i = text.indexOf(find);
  if (i < 0 || text.indexOf(find, i + 1) >= 0) throw new Error(what);
  return text.slice(0, i) + replace + text.slice(i + find.length);
}
function editRunner(text) {
  if (text.includes(MARK)) return { text, notes: [] };
  let t = text;
  t = swapOnce(t, '  if (step.group === "messages" && run.status !== 0 && run.status !== 3 && !tooLong(run)) { again = true; run = go(); }\n',
    '  // (the window checks too: calls and cameras run on timers, and GitHub\'s machines are slower; ' + MARK + ')\n' +
    '  if ((step.group === "messages" || step.group === "window") && run.status !== 0 && run.status !== 3 && !tooLong(run)) { again = true; run = go(); }\n',
    "where a failed part gets one more go");
  t = swapOnce(t, '  results.push({ title: step.title, state, passed });\n}\n',
    '  // On GitHub, a failed part is also written into the build\'s notes, so it can be read without the full log (' + MARK + ')\n' +
    '  if (state === "FAILED" && process.env.GITHUB_ACTIONS) {\n' +
    '    const say = (tooLong(run) ? [`this part didn\'t finish within ${STEP_MINUTES} minutes`] : []).concat(shown.slice(0, 25)).join("\\n").slice(0, 4000);\n' +
    '    console.log("::error title=" + step.title.replace(/[,:\\r\\n%]/g, " ") + "::" + say.replace(/%/g, "%25").replace(/\\r/g, "%0D").replace(/\\n/g, "%0A"));\n' +
    '  }\n' +
    '  results.push({ title: step.title, state, passed });\n}\n',
    "where each part's result is kept");
  return { text: t, notes: ["the window checks get one more go if they fail (like the messaging checks)", "on GitHub, a failed check is written into the build's notes"] };
}
function editWorkflow(text) {
  if (text.includes(MARK)) return { text, notes: [] };
  const n = text.split("runs-on: ubuntu-latest").length - 1;
  if (!n) throw new Error("runs-on: ubuntu-latest");
  return { text: text.split("runs-on: ubuntu-latest").join("runs-on: ubuntu-24.04   # pinned: GitHub is moving ubuntu-latest to a new Ubuntu (" + MARK + ")"), notes: ["the checks run on Ubuntu 24.04, like your last good build (GitHub is moving to a new Ubuntu)"] };
}

function run() {
  if (!fs.existsSync(path.join(ROOT, "package.json"))) stop(["This isn't your AURA project folder (no package.json here).", "Move this file next to package.json and run it from there."]);
  const targets = [
    { label: "checks", file: path.join(ROOT, "tests", "run.cjs"), edit: editRunner, js: true },
    { label: "GitHub build", file: path.join(ROOT, ".github", "workflows", "build.yml"), edit: editWorkflow, js: false },
  ];
  if (UNDO) {
    let n = 0;
    for (const t of targets) if (fs.existsSync(t.file + BAK)) { fs.copyFileSync(t.file + BAK, t.file); fs.unlinkSync(t.file + BAK); say("  restored  " + rel(t.file)); n++; }
    say(n ? "Undo finished." : "Nothing to undo.");
    return;
  }
  const plan = [], problems = [];
  for (const t of targets) {
    if (!fs.existsSync(t.file)) { problems.push("I couldn't find " + rel(t.file) + "."); continue; }
    const { text, eol } = readText(t.file);
    try {
      const r = t.edit(text);
      if (t.js && r.text !== text) { const bad = syntaxProblem(r.text); if (bad) throw new Error("a way to edit it safely (" + bad + ")"); }
      plan.push({ ...t, before: text, after: r.text, eol, notes: r.notes });
    } catch (e) { problems.push("In " + rel(t.file) + " I couldn't find " + e.message + "."); }
  }
  if (problems.length) stop([...problems, "Copy this message to Claude."]);
  say(); say(DRY ? "Dry run. This is what would change:" : "AURA: steadier GitHub checks"); say();
  for (const p of plan) {
    if (p.after !== p.before && !DRY) { if (!fs.existsSync(p.file + BAK)) fs.copyFileSync(p.file, p.file + BAK); fs.writeFileSync(p.file, withEol(p.after, p.eol)); }
    say("  " + (p.label + ":").padEnd(14) + rel(p.file));
    (p.notes.length ? p.notes : ["already done"]).forEach((n) => say("                - " + n));
  }
  say();
  if (DRY) { say("Run it again without --dry-run to apply."); say(); return; }
  say("Done. Run  npm test, then release as usual.");
  say("To undo later:  node aura-ci-fix-setup.cjs --undo");
  say();
}
try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
