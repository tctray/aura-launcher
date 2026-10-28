#!/usr/bin/env node
// AURA - fix for the group chat test that failed on GitHub (1.35.0). The test's pretend server gave a
// new group's first message the same time as joining, so sometimes it didn't count as new. AURA itself
// is unchanged. How to use:  node aura-group-test-fix.cjs   (in your AURA folder)
"use strict";
const fs = require("fs"), path = require("path");
const file = path.join(process.cwd(), "tests", "group-chats.cjs");
const PAIRS = [["    check(\"...saying who made it, as new\", (await listed(B)).some((t) => /Alex created the group/.test(t)) && (await B.locator(\".mx-conv.unread\", { hasText: \"Squad\" }).count()) === 1, await listed(B));", "    check(\"...saying who made it, as new\", await until(async () => (await listed(B)).some((t) => /Alex created the group/.test(t)) && (await B.locator(\".mx-conv.unread\", { hasText: \"Squad\" }).count()) === 1), await listed(B)); // (Updated by aura-group-test-fix.cjs)"], ["createdAt: new Date(Date.now() + msgs.length).toISOString(), reactions: [] };", "createdAt: new Date(Date.now() + msgs.length + 1).toISOString(), reactions: [] }; // always after the join time, like the database (Updated by aura-group-test-fix.cjs)"]];
if (!fs.existsSync(file)) { console.log("\ntests/group-chats.cjs isn't here. Run this in your AURA folder.\n"); process.exit(1); }
const raw = fs.readFileSync(file, "utf8"), eol = raw.includes("\r\n") ? "\r\n" : "\n";
let text = raw.replace(/\r\n/g, "\n");
if (PAIRS.every(([, b]) => text.includes(b))) { console.log("\nAlready fixed.\n"); process.exit(0); }
for (const [a, b] of PAIRS) {
  if (text.includes(b)) continue;
  if (!text.includes(a)) { console.log("\nCouldn't find the check to fix. Copy this message to Claude.\n"); process.exit(1); }
  text = text.replace(a, () => b);
}
fs.writeFileSync(file, text.replace(/\n/g, eol));
console.log("\nFixed tests/group-chats.cjs. Now run  npm test\n");
