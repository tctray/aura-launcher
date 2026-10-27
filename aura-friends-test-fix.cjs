#!/usr/bin/env node
// AURA — fix for the "Friends Playing Now" test after the release fixes: it now accepts the refresh
// that waits while AURA is hidden. How to use:  node aura-friends-test-fix.cjs   (in your AURA folder)
"use strict";
const fs = require("fs"), path = require("path");
const file = path.join(process.cwd(), "tests", "friends-playing.cjs");
const A = "check(\"the row refreshes every 2 minutes, and stops when Home closes\", /const playingTimer = setInterval\\(fetch, 120000\\);[\\s\\S]{0,120}return \\(\\) => clearInterval\\(playingTimer\\);/.test(source));", B = "check(\"the row refreshes every 2 minutes (not while AURA is hidden), and stops when Home closes\", /const playingTimer = setInterval\\((?:fetch|\\(\\) => \\{ if \\(!window\\.__auraHidden\\) fetch\\(\\); \\}), 120000\\);[\\s\\S]{0,120}return \\(\\) => clearInterval\\(playingTimer\\);/.test(source)); // (Updated by aura-release-fixes-setup.cjs)";
if (!fs.existsSync(file)) { console.log("\ntests/friends-playing.cjs isn't here. Run this in your AURA folder.\n"); process.exit(1); }
const raw = fs.readFileSync(file, "utf8"), eol = raw.includes("\r\n") ? "\r\n" : "\n", text = raw.replace(/\r\n/g, "\n");
if (text.includes(B)) { console.log("\nAlready fixed.\n"); process.exit(0); }
if (!text.includes(A)) { console.log("\nCouldn't find the check to fix. Copy this message to Claude.\n"); process.exit(1); }
fs.writeFileSync(file, text.replace(A, () => B).replace(/\n/g, eol));
console.log("\nFixed tests/friends-playing.cjs. Run  npm test  again.\n");
