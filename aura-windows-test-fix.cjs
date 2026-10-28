#!/usr/bin/env node
// AURA - fixes two checks that failed only on GitHub's Windows machine (1.35.1). AURA itself is unchanged:
//   tests/update-notice.cjs  reads App.jsx with Windows line endings too
//   tests/media.cjs          doesn't fail when Windows is still holding a converted file at clean-up
// How to use:  node aura-windows-test-fix.cjs   (in your AURA folder)
"use strict";
const fs = require("fs"), path = require("path");
const FIXES = {"tests/update-notice.cjs": [["    const source = (() => { try { return fs.readFileSync(path.join(ROOT, \"src\", \"App.jsx\"), \"utf8\"); } catch { return \"\"; } })();", "    const source = (() => { try { return fs.readFileSync(path.join(ROOT, \"src\", \"App.jsx\"), \"utf8\").replace(/\\r\\n/g, \"\\n\"); } catch { return \"\"; } })(); // Windows line endings too (Updated by aura-windows-test-fix.cjs)"]], "tests/media.cjs": [["  fs.rmSync(root, { recursive: true, force: true });\n  console.log(failed ?", "  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch {} // Windows may still hold a converted file (Updated by aura-windows-test-fix.cjs)\n  console.log(failed ?"]]};
let changed = 0;
for (const [rel, pairs] of Object.entries(FIXES)) {
  const file = path.join(process.cwd(), ...rel.split("/"));
  if (!fs.existsSync(file)) { console.log("\n" + rel + " isn't here. Run this in your AURA folder.\n"); process.exit(1); }
  const raw = fs.readFileSync(file, "utf8"), eol = raw.includes("\r\n") ? "\r\n" : "\n";
  let text = raw.replace(/\r\n/g, "\n");
  for (const [a, b] of pairs) {
    if (text.includes(b)) continue;
    if (!text.includes(a)) { console.log("\nCouldn't find the spot to fix in " + rel + ". Copy this message to Claude.\n"); process.exit(1); }
    text = text.replace(a, () => b); changed++;
  }
  fs.writeFileSync(file, text.replace(/\n/g, eol));
}
console.log(changed ? "\nFixed " + changed + " check(s). Now run  npm test\n" : "\nAlready fixed.\n");
