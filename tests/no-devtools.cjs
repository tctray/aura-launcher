// No menu bar and no developer tools in the installed AURA (they still work while developing).
// Added by aura-no-devtools-setup.cjs.
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
let failed = 0;
const check = (name, ok) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name); };
const main = fs.readFileSync(path.join(ROOT, "electron", "main.js"), "utf8");
check("there's no menu bar on AURA's windows", /Menu\.setApplicationMenu\(null\)/.test(main) && /mainWin\.setMenu\(null\)/.test(main));
check("the main window has no developer tools in the installed app", /devTools: !app\.isPackaged/.test(main));
check("developer tools opened any other way close again in the installed app (every window, view and page)", /app\.on\("web-contents-created"[\s\S]{0,300}if \(app\.isPackaged\) contents\.on\("devtools-opened"[^\n]*closeDevTools\(\)/.test(main));
check("while developing, F12 or Ctrl+Shift+I opens them", /if \(!app\.isPackaged\) \{[\s\S]{0,200}before-input-event[\s\S]{0,300}"F12"[\s\S]{0,200}toggleDevTools\(\)/.test(main));
check("nothing in AURA opens developer tools by itself", !/\.openDevTools\(/.test(main));
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
