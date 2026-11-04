#!/usr/bin/env node
/**
 * AURA — Home tidy-up
 *
 *   - The small Made For tiles show the top of each cover (where the game's name is), not the middle.
 *   - "No live streams" and "Made For" sit on the left like the other headings, and stay readable
 *     over your background picture.
 *   - A game card lifting up when you point at it isn't cut off at the top any more.
 *   Looks only: nothing else changes.
 *
 * How to use:  node aura-home-tidy-setup.cjs      (in your AURA project folder)
 * To undo:     node aura-home-tidy-setup.cjs --undo
 */
"use strict";
const fs = require("fs");
const path = require("path");
const DATA = /*__DATA__*/{"edits": [{"file": "src/App.jsx", "find": ".gm-made-for-row::-webkit-scrollbar{display:none;}", "replace": ".gm-made-for-row::-webkit-scrollbar{display:none;}\n/* Home: the tops of covers and cards aren't cut off, and the words read over a background picture (Added by aura-home-tidy-setup.cjs) */\n.gm-mf-card-img{object-position:center top;}\n.gm-made-for-hdr{text-align:left;}\n.gm-made-for-label{text-shadow:0 1px 3px rgba(0,0,0,.85);}\n.gm-made-for-title{text-shadow:0 2px 8px rgba(0,0,0,.6);}\n.twitch-shelf .twitch-empty{text-align:left;color:var(--t2);font-size:12px;text-shadow:0 1px 3px rgba(0,0,0,.85);}\n.twitch-shelf .twitch-err{color:#ffb3c0;}\n.gm-shelf-row,.gm-made-for-row{padding-top:12px;margin-top:-8px;}"}], "files": {}};
const ROOT = process.cwd();
const MARK = "aura-home-tidy-setup.cjs";
const BAK = ".before-home-tidy.bak";
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
say("\nAURA: Home tidy-up\n");
for (const p of plan) {
  if (p.done) { say("  " + p.rel + ": already done"); continue; }
  if (p.exists && !fs.existsSync(full(p.rel) + BAK)) fs.copyFileSync(full(p.rel), full(p.rel) + BAK);
  fs.mkdirSync(path.dirname(full(p.rel)), { recursive: true });
  fs.writeFileSync(full(p.rel), p.eol === "\n" ? p.text : p.text.replace(/\n/g, p.eol));
  say("  " + p.rel + ": " + (p.exists ? "updated" : "added"));
}
say("\nRestart AURA (npm run electron:dev) to see it. Run  npm test  before your next release.\n");
