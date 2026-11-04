#!/usr/bin/env node
/**
 * AURA — fix for the Microsoft Store check on GitHub's Windows test machine
 *
 *   The check read electron/main.js without allowing for Windows line endings, so it failed on
 *   Windows and passed on Linux. Only the test changes; AURA itself is unchanged.
 *
 * How to use:  node aura-store-test-fix.cjs      (in your AURA project folder)
 * To undo:     node aura-store-test-fix.cjs --undo
 */
"use strict";
const fs = require("fs");
const path = require("path");
const DATA = /*__DATA__*/{"edits": [{"file": "tests/store.cjs", "find": "  const main = fs.readFileSync(path.join(ROOT, \"electron\", \"main.js\"), \"utf8\");", "replace": "  const main = fs.readFileSync(path.join(ROOT, \"electron\", \"main.js\"), \"utf8\").replace(/\\r\\n/g, \"\\n\"); // (Windows line endings too: Fixed by aura-store-test-fix.cjs)"}, {"file": "tests/store.cjs", "find": "  const policy = fs.readFileSync(path.join(ROOT, \"PRIVACY.md\"), \"utf8\");", "replace": "  const policy = fs.readFileSync(path.join(ROOT, \"PRIVACY.md\"), \"utf8\").replace(/\\r\\n/g, \"\\n\");"}], "files": {}};
const ROOT = process.cwd();
const MARK = "aura-store-test-fix.cjs";
const BAK = ".before-store-test-fix.bak";
const say = (s = "") => console.log(s);
const full = (rel) => path.join(ROOT, ...rel.split("/"));
const stop = (lines) => { say("\nNothing was changed."); lines.forEach((l) => say("  " + l)); say(); process.exit(1); };
const EDITED = [...new Set(DATA.edits.map((e) => e.file))];
const NEW = Object.keys(DATA.files);
if (!fs.existsSync(full("package.json"))) stop(["This isn't your AURA project folder (no package.json here)."]);
if (process.argv.includes("--undo")) {
  let n = 0;
  for (const rel of EDITED) if (fs.existsSync(full(rel) + BAK)) { fs.copyFileSync(full(rel) + BAK, full(rel)); fs.unlinkSync(full(rel) + BAK); say("  restored  " + rel); n++; }
  for (const rel of NEW) if (fs.existsSync(full(rel)) && fs.readFileSync(full(rel), "utf8").includes(MARK)) { fs.unlinkSync(full(rel)); say("  removed   " + rel); n++; }
  say(n ? "\nUndo finished.\n" : "\nNothing to undo.\n");
  process.exit(0);
}
const crlf = fs.readFileSync(full("package.json"), "utf8").includes("\r\n");
const plan = [];
for (const rel of EDITED) {
  if (!fs.existsSync(full(rel))) { if (rel === "tests/run.cjs" || rel === "PRIVACY.md") continue; stop([rel + " isn't there. Copy this message to Claude."]); }
  const raw = fs.readFileSync(full(rel), "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  let out = raw.replace(/\r\n/g, "\n");
  const mine = DATA.edits.filter((e) => e.file === rel);
  if (out.includes(MARK) || mine.every((e) => out.includes(e.replace))) { plan.push({ rel, done: true }); continue; }
  for (const e of DATA.edits.filter((e) => e.file === rel)) {
    const i = out.indexOf(e.find);
    if (i < 0 || out.indexOf(e.find, i + 1) >= 0) stop(["In " + rel + " I couldn't find the spot for: " + e.find.trim().split("\n")[0].slice(0, 90), "Copy this message to Claude."]);
    out = out.slice(0, i) + e.replace + out.slice(i + e.find.length);
  }
  plan.push({ rel, text: out, eol, exists: true });
}
for (const rel of NEW) {
  if (rel.startsWith("tests/") && !fs.existsSync(full("tests"))) continue;
  if (fs.existsSync(full(rel))) {
    if (fs.readFileSync(full(rel), "utf8").includes(MARK)) { plan.push({ rel, done: true }); continue; }
    stop([rel + " is already there, and it isn't from this installer. Copy this message to Claude."]);
  }
  plan.push({ rel, text: DATA.files[rel], eol: crlf ? "\r\n" : "\n", exists: false });
}
say("\nAURA: fix for the Store check on Windows\n");
for (const p of plan) {
  if (p.done) { say("  " + p.rel + ": already done"); continue; }
  if (p.exists && !fs.existsSync(full(p.rel) + BAK)) fs.copyFileSync(full(p.rel), full(p.rel) + BAK);
  fs.mkdirSync(path.dirname(full(p.rel)), { recursive: true });
  fs.writeFileSync(full(p.rel), p.eol === "\n" ? p.text : p.text.replace(/\n/g, p.eol));
  say("  " + p.rel + ": " + (p.exists ? "updated" : "added"));
}
say("\nNow release again (npm version patch, git push --follow-tags).\n");
