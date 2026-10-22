#!/usr/bin/env node
/**
 * AURA — give the GitHub checks more time
 *
 * AURA's checks (npm test on GitHub) now take about 15-17 minutes, and GitHub was told to stop
 * them at 15. This gives them 30 minutes. The Windows and Linux builds are unchanged.
 *
 * How to use:  node aura-checks-time-setup.cjs      (in your AURA project folder)
 * To undo:     node aura-checks-time-setup.cjs --undo
 */
"use strict";
const fs = require("fs");
const path = require("path");
const FILE = path.join(process.cwd(), ".github", "workflows", "build.yml");
const BAK = FILE + ".before-checks-time.bak";
const say = (s = "") => console.log(s);
if (!fs.existsSync(FILE)) { say("\nNothing was changed.\n  I couldn't find .github/workflows/build.yml. Run this in your AURA project folder.\n"); process.exit(1); }
if (process.argv.includes("--undo")) {
  if (fs.existsSync(BAK)) { fs.copyFileSync(BAK, FILE); fs.unlinkSync(BAK); say("\nUndo finished.\n"); } else say("\nNothing to undo.\n");
  process.exit(0);
}
const raw = fs.readFileSync(FILE, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
const lines = raw.split(/\r?\n/);
const job = lines.findIndex((l) => /^  test:\s*$/.test(l));
if (job < 0) { say("\nNothing was changed.\n  I couldn't find the test job in build.yml. Copy this message to Claude.\n"); process.exit(1); }
let at = -1;
for (let i = job + 1; i < lines.length && !/^  \S/.test(lines[i]); i++) if (/^    timeout-minutes:\s*\d+/.test(lines[i])) { at = i; break; }
if (at < 0) { say("\nNothing was changed.\n  I couldn't find the test job's time limit in build.yml. Copy this message to Claude.\n"); process.exit(1); }
if (/^    timeout-minutes:\s*30\b/.test(lines[at])) { say("\nAlready done: the checks have 30 minutes.\n"); process.exit(0); }
lines[at] = "    timeout-minutes: 30   # GitHub stops the job after this, instead of waiting for hours (more time: Added by aura-checks-time-setup.cjs)";
if (!fs.existsSync(BAK)) fs.copyFileSync(FILE, BAK);
fs.writeFileSync(FILE, lines.join(eol));
say("\nDone: the GitHub checks now have 30 minutes instead of 15 (.github/workflows/build.yml).\n");
