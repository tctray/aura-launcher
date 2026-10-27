#!/usr/bin/env node
/**
 * AURA — fix: the GitHub checks get FFmpeg
 *
 *   GitHub's checks skip downloading FFmpeg, so the media player check failed there (it makes its
 *   test music and videos with FFmpeg). Now GitHub downloads FFmpeg for the checks, and if it ever
 *   can't, that check is skipped instead of failing.
 *
 * How to use:  node aura-ci-ffmpeg-setup.cjs      (in your AURA project folder)
 */
"use strict";
const fs = require("fs"), path = require("path");
const EDITS = [{"file": ".github/workflows/build.yml", "find": "        run: npm install --ignore-scripts --no-audit --no-fund   # the checks don't need the Electron program or ffmpeg downloaded\n", "replace": "        run: npm install --ignore-scripts --no-audit --no-fund   # the checks don't need the Electron program or ffmpeg downloaded\n      - name: Get FFmpeg for the media and clip checks   # (Added by aura-ci-ffmpeg-setup.cjs)\n        run: node node_modules/ffmpeg-static/install.js\n        timeout-minutes: 5\n        continue-on-error: true   # if it can't be fetched, those checks are skipped instead of failing\n"}, {"file": "tests/media-player.cjs", "find": "  if (!ffmpeg || !fs.existsSync(ffmpeg)) { note(\"FFmpeg isn't installed here (npm install)\"); return done(process.env.CI ? 1 : 3); }", "replace": "  if (!ffmpeg || !fs.existsSync(ffmpeg)) { note(\"FFmpeg isn't downloaded here, so this was skipped (npm install gets it)\"); return done(3); } // (Added by aura-ci-ffmpeg-setup.cjs)"}];
const MARK = "aura-ci-ffmpeg-setup.cjs";
const say = (s = "") => console.log(s);
let changed = 0;
for (const rel of [...new Set(EDITS.map((e) => e.file))]) {
  const file = path.join(process.cwd(), ...rel.split("/"));
  if (!fs.existsSync(file)) { say("\n" + rel + " isn't here. Run this in your AURA folder.\n"); process.exit(1); }
  const raw = fs.readFileSync(file, "utf8"), eol = raw.includes("\r\n") ? "\r\n" : "\n";
  let text = raw.replace(/\r\n/g, "\n");
  if (text.includes(MARK)) { say("  " + rel + ": already done"); continue; }
  for (const e of EDITS.filter((x) => x.file === rel)) {
    if (text.split(e.find).length !== 2) { say("\nIn " + rel + " I couldn't find the spot to fix. Copy this message to Claude.\n"); process.exit(1); }
    text = text.replace(e.find, () => e.replace);
  }
  fs.writeFileSync(file, eol === "\n" ? text : text.replace(/\n/g, eol));
  say("  " + rel + ": fixed"); changed++;
}
say(changed ? "\nDone. Commit, then release again (see the steps from Claude).\n" : "\nAlready done.\n");
