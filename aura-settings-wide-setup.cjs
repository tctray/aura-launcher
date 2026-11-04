#!/usr/bin/env node
/**
 * AURA — Settings fills the page on normal screens
 *
 *   The settings grow up to 1100 pixels wide (they stopped at 880 before). On bigger screens the
 *   sidebar and settings sit together in the middle. Small windows are unchanged.
 *
 *   Needs the new Settings layout first (aura-settings-layout-setup.cjs).
 *
 * How to use:  node aura-settings-wide-setup.cjs      (in your AURA project folder)
 * To undo:     node aura-settings-wide-setup.cjs --undo
 */
"use strict";
const fs = require("fs");
const path = require("path");
const DATA = /*__DATA__*/{"edits": [{"file": "src/components/settingsnav.jsx", "find": ".set2{text-align:left;display:grid;grid-template-columns:240px minmax(0,1fr);gap:0 30px;align-items:start;padding:0 28px 0 24px;min-height:100%}", "replace": ".set2{text-align:left;display:grid;grid-template-columns:240px minmax(0,1100px);justify-content:center;gap:0 32px;align-items:start;padding:0 28px;min-height:100%} /* wider, and centred on big screens (aura-settings-wide-setup.cjs) */"}, {"file": "src/components/settingsnav.jsx", "find": ".set-main{padding:24px 0 40vh;max-width:880px;min-width:0}", "replace": ".set-main{padding:24px 0 40vh;min-width:0}"}], "files": {}};
const ROOT = process.cwd();
const MARK = "aura-settings-wide-setup.cjs";
const BAK = ".before-settings-wide.bak";
const say = (s = "") => console.log(s);
const full = (rel) => path.join(ROOT, ...rel.split("/"));
const stop = (lines) => { say("\nNothing was changed."); lines.forEach((l) => say("  " + l)); say(); process.exit(1); };
const EDITED = [...new Set(DATA.edits.map((e) => e.file))];
const NEW = Object.keys(DATA.files);
if (!fs.existsSync(full("package.json"))) stop(["This isn't your AURA project folder (no package.json here)."]);
if (!fs.existsSync(full("src/components/settingsnav.jsx"))) stop(["Install the new Settings layout first:  node aura-settings-layout-setup.cjs", "Then run this again."]);
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
say("\nAURA: Settings fills the page\n");
for (const p of plan) {
  if (p.done) { say("  " + p.rel + ": already done"); continue; }
  if (p.exists && !fs.existsSync(full(p.rel) + BAK)) fs.copyFileSync(full(p.rel), full(p.rel) + BAK);
  fs.mkdirSync(path.dirname(full(p.rel)), { recursive: true });
  fs.writeFileSync(full(p.rel), p.eol === "\n" ? p.text : p.text.replace(/\n/g, p.eol));
  say("  " + p.rel + ": " + (p.exists ? "updated" : "added"));
}
say("\nRestart AURA (npm run electron:dev) to see it. Run  npm test  before your next release.\n");
