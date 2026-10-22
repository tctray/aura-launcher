#!/usr/bin/env node
/**
 * AURA — fix: call cameras stuck in full screen
 *
 * On a slow PC, Windows can grant full screen a moment late, after you've already pressed Esc.
 * The cameras then stayed full screen. Now they leave it again straight away.
 * Also makes AURA's check for this wait properly for full screen (it failed on GitHub).
 *
 * How to use:  node aura-cams-full-fix-setup.cjs      (in your AURA project folder)
 * To undo:     node aura-cams-full-fix-setup.cjs --undo
 */
"use strict";
const fs = require("fs");
const path = require("path");
const EDITS = [
 {
  "file": "calls",
  "find": "  const [full, setFull] = useState(false);\n",
  "replace": "  const [full, setFull] = useState(false);\n  // Full screen can arrive a moment late (after Esc was already pressed, on a slow PC): if it does, leave it again (Added by aura-cams-full-fix-setup.cjs)\n  const fullRef = useRef(false);\n  fullRef.current = full;\n  useEffect(() => {\n    const changed = () => { const el = box.current; if (el && document.fullscreenElement === el && !fullRef.current) document.exitFullscreen().catch(() => {}); };\n    document.addEventListener(\"fullscreenchange\", changed);\n    return () => document.removeEventListener(\"fullscreenchange\", changed);\n  }, []);\n"
 },
 {
  "file": "test",
  "find": "    await btn.click();\n    let s = await until(() => isFull(A), 8000);",
  "replace": "    // Only the window in front may go full screen (like a real AURA window you click in): three pretend people are three windows here (Added by aura-cams-full-fix-setup.cjs)\n    await A.bringToFront();\n    await btn.click();\n    // (full screen can take a moment to start: wait for it, and only then settle for filling the window)\n    let s = (await until(async () => { const x = await isFull(A); return x && x.fs ? x : null; }, 8000)) || (await until(() => isFull(A), 2000));"
 },
 {
  "file": "test",
  "find": "    await A.locator(\".cx-cams .cx-cam-theirs\").dblclick();",
  "replace": "    await A.bringToFront();\n    await A.locator(\".cx-cams .cx-cam-theirs\").dblclick();"
 },
 {
  "file": "test",
  "find": "    check(\"the call carried on throughout\", (await A.locator(\".cx-bar.live\").count()) === 1);\n",
  "replace": "    check(\"the call carried on throughout\", (await A.locator(\".cx-bar.live\").count()) === 1);\n    // A slow PC: Windows only grants full screen after Esc was already pressed (Added by aura-cams-full-fix-setup.cjs)\n    await A.evaluate(() => { const real = Element.prototype.requestFullscreen; window.__realFs = real; Element.prototype.requestFullscreen = function (...a) { const el = this; return new Promise((r) => setTimeout(r, 900)).then(() => real.apply(el, a)); }; });\n    await A.bringToFront();\n    await A.locator(\".cx-cams\").hover();\n    await A.locator('.cx-cams button[aria-label=\"Full screen\"]').click();\n    await sleep(150);\n    await A.keyboard.press(\"Escape\");\n    await sleep(2500);\n    check(\"if full screen arrives after Esc, it is left again straight away\", !!(await isSmall(A)) && !(await A.evaluate(() => !!document.fullscreenElement)), await state(A));\n    await A.evaluate(() => { Element.prototype.requestFullscreen = window.__realFs; });\n"
 }
];
const ROOT = process.cwd();
const MARK = "Added by aura-cams-full-fix-setup.cjs";
const BAK = ".before-cams-full-fix.bak";
const say = (s = "") => console.log(s);
const FILES = { calls: path.join(ROOT, "src", "components", "calls.jsx"), test: path.join(ROOT, "tests", "cams-full.cjs") };
const stop = (lines) => { say("\nNothing was changed."); lines.forEach((l) => say("  " + l)); say(); process.exit(1); };
if (!fs.existsSync(path.join(ROOT, "package.json"))) stop(["This isn't your AURA project folder (no package.json here)."]);
if (process.argv.includes("--undo")) {
  let n = 0;
  for (const f of Object.values(FILES)) if (fs.existsSync(f + BAK)) { fs.copyFileSync(f + BAK, f); fs.unlinkSync(f + BAK); say("  restored  " + path.relative(ROOT, f)); n++; }
  say(n ? "\nUndo finished.\n" : "\nNothing to undo.\n");
  process.exit(0);
}
if (!fs.existsSync(FILES.calls)) stop(["I couldn't find src/components/calls.jsx. Copy this message to Claude."]);
const plan = [];
for (const [key, file] of Object.entries(FILES)) {
  if (!fs.existsSync(file)) { if (key === "test") continue; }
  const raw = fs.readFileSync(file, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  let t = raw.replace(/\r\n/g, "\n");
  if (t.includes(MARK)) { plan.push({ file, done: true }); continue; }
  for (const e of EDITS.filter((x) => x.file === key)) {
    const i = t.indexOf(e.find);
    if (i < 0 || t.indexOf(e.find, i + 1) >= 0) stop(["In " + path.relative(ROOT, file) + " I couldn't find the spot for: " + e.find.trim().split("\n")[0].slice(0, 90), "Run aura-cams-full-setup.cjs first, or copy this message to Claude."]);
    t = t.slice(0, i) + e.replace + t.slice(i + e.find.length);
  }
  plan.push({ file, text: eol === "\n" ? t : t.replace(/\n/g, eol) });
}
say();
for (const p of plan) {
  if (p.done) { say("  " + path.relative(ROOT, p.file) + ": already done"); continue; }
  if (!fs.existsSync(p.file + BAK)) fs.copyFileSync(p.file, p.file + BAK);
  fs.writeFileSync(p.file, p.text);
  say("  " + path.relative(ROOT, p.file) + ": fixed");
}
say("\nDone. Run  npm test  before your next release.\n");
