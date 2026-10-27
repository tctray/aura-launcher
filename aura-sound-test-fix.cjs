#!/usr/bin/env node
// AURA — fix for the Sound devices test: "not on Windows" now really pretends to be Linux.
// How to use:  node aura-sound-test-fix.cjs   (in your AURA project folder)
"use strict";
const fs = require("fs"), path = require("path");
const file = path.join(process.cwd(), "tests", "sound-settings.cjs");
const A = "userAgent: windows ? \"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) aura Chrome/134.0 Electron/41.0 Safari/537.36\" : undefined });", B = "userAgent: windows ? \"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) aura Chrome/134.0 Electron/41.0 Safari/537.36\" : \"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) aura Chrome/134.0 Electron/41.0 Safari/537.36\" }); // (a Linux PC, even when the test runs on Windows)";
if (!fs.existsSync(file)) { console.log("\ntests/sound-settings.cjs isn't here. Run this in your AURA folder, after aura-sound-devices-setup.cjs.\n"); process.exit(1); }
const raw = fs.readFileSync(file, "utf8"), eol = raw.includes("\r\n") ? "\r\n" : "\n", text = raw.replace(/\r\n/g, "\n");
if (text.includes(B)) { console.log("\nAlready fixed.\n"); process.exit(0); }
if (!text.includes(A)) { console.log("\nCouldn't find the line to fix. Copy this message to Claude.\n"); process.exit(1); }
fs.writeFileSync(file, text.replace(A, B).replace(/\n/g, eol));
console.log("\nFixed tests/sound-settings.cjs. Run  npm test  again.\n");
