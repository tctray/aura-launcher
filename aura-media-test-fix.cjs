#!/usr/bin/env node
// AURA — fix for the media player test: it now watches for the converted copy while it plays.
// How to use:  node aura-media-test-fix.cjs   (in your AURA project folder)
"use strict";
const fs = require("fs"), path = require("path");
const file = path.join(process.cwd(), "tests", "media-player.cjs");
const A = "    await page.waitForTimeout(4000);\n    h = await host();\n    check(\"...then plays from the converted copy\", /\\/f\\?p=.*media-cache/.test(decodeURIComponent(h.src)) || /couldn't play/i.test(await page.locator(\".md-now-s\").innerText()), h);", B = "    // Watch until the converted copy is playing (a short one may finish and move on to the next video)\n    let converted = false;\n    for (let i = 0; i < 60 && !converted; i++) {\n      h = await host();\n      converted = /\\/f\\?p=.*media-cache/.test(decodeURIComponent(h.src)) || /couldn't play/i.test(await page.locator(\".md-now-s\").innerText().catch(() => \"\"));\n      if (!converted) await page.waitForTimeout(150);\n    }\n    check(\"...then plays from the converted copy\", converted, h);";
if (!fs.existsSync(file)) { console.log("\ntests/media-player.cjs isn't here. Run this in your AURA folder, after aura-media-player-setup.cjs.\n"); process.exit(1); }
const raw = fs.readFileSync(file, "utf8"), eol = raw.includes("\r\n") ? "\r\n" : "\n", text = raw.replace(/\r\n/g, "\n");
if (text.includes(B)) { console.log("\nAlready fixed.\n"); process.exit(0); }
if (!text.includes(A)) { console.log("\nCouldn't find the part to fix. Copy this message to Claude.\n"); process.exit(1); }
fs.writeFileSync(file, text.replace(A, B).replace(/\n/g, eol));
console.log("\nFixed tests/media-player.cjs. Run  npm test  again.\n");
