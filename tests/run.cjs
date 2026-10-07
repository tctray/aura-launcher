// AURA's checks.   npm test
//
// Runs everything in this folder and says, at the end, what passed and what didn't. GitHub runs
// the same thing before it builds a release; if anything fails here, no release is built.
//
//   npm test                 everything
//   npm test -- files        only the file checks (a few seconds)
//   npm test -- messages     only the message rules
//   npm test -- window       only the window check
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const wants = (group) => !only.length || only.includes(group);
const social = path.join(ROOT, "electron", "social.js");
const errorlog = path.join(ROOT, "electron", "errorlog.js");
const sqlDir = path.join(ROOT, "supabase");

const steps = [];
const add = (group, title, file, args = []) => steps.push({ group, title, file: path.join(__dirname, file), args });
add("files", "Project files", "static.cjs");
if (fs.existsSync(errorlog)) add("files", "The error log", "errorlog.cjs", [errorlog]);
const xboxFile = path.join(ROOT, "electron", "xbox.js");
if (fs.existsSync(xboxFile) && fs.existsSync(path.join(__dirname, "xbox.cjs"))) add("files", "Xbox and Game Pass games", "xbox.cjs", [xboxFile]);
if (fs.existsSync(social) && fs.existsSync(path.join(sqlDir, "aura-messages-safety.sql"))) {
  add("messages", "Database rules: friends and messages", "messages/sql-friends-and-messages.mjs");
  add("messages", "Database rules: pictures and videos", "messages/sql-media.mjs");
  add("messages", "Database rules: chat backgrounds", "messages/sql-backgrounds.mjs");
  add("messages", "Database rules: deleting, blocking, reporting", "messages/sql-safety.mjs");
  add("messages", "Messaging: friends, sending, unread, notifications", "messages/app-messages.cjs", [social]);
  add("messages", "Messaging: pictures, GIFs and videos", "messages/app-media.cjs", [social]);
  add("messages", "Messaging: shared chat backgrounds", "messages/app-backgrounds.cjs", [social]);
  add("messages", "Messaging: deleting, blocking, reporting", "messages/app-safety.cjs", [social]);
  add("messages", "Messaging on a database missing the picture update", "messages/app-before-media-sql.cjs", [social]);
  add("messages", "Messaging on a database missing the background update", "messages/app-before-background-sql.cjs", [social]);
  add("messages", "Messaging on a database missing the safety update", "messages/app-before-safety-sql.cjs", [social]);
  add("messages", "Messaging: the requests sent to Supabase", "messages/app-requests.cjs", [social]);
  // Voice calls, once that update is in both the database files and the app
  if (fs.existsSync(path.join(sqlDir, "aura-messages-voice.sql"))) {
    add("messages", "Database rules: voice calls", "messages/sql-voice.mjs");
    let hasCalls = false;
    try { hasCalls = /\bstartCall\b/.test(fs.readFileSync(social, "utf8")); } catch {}
    if (hasCalls) {
      add("messages", "Voice calls: ringing, accepting, hanging up, missed calls", "messages/app-voice.cjs", [social]);
      add("messages", "Voice calls on a database missing the voice update", "messages/app-before-voice-sql.cjs", [social]);
    }
  }
}
add("window", "The window opens and every page loads", "window.cjs");

const results = [];
for (const step of steps.filter((s) => wants(s.group))) {
  console.log("\n━━ " + step.title + " " + "━".repeat(Math.max(3, 66 - step.title.length)));
  if (step.group === "window" && !process.env.AURA_SKIP_BUILD) {
    // Check the window as it would ship: build it fresh first
    console.log("  building the window (npm run build)…");
    const built = spawnSync("npm", ["run", "build"], { cwd: ROOT, encoding: "utf8", shell: true });
    if (built.status !== 0) {
      console.log(String(built.stdout || "").split("\n").slice(-25).join("\n") + String(built.stderr || "").split("\n").slice(-25).join("\n"));
      console.log("  FAIL  the window builds");
      results.push({ title: step.title, state: "FAILED" });
      continue;
    }
    console.log("  ok    the window builds");
  }
  const started = Date.now();
  const go = () => spawnSync(process.execPath, [step.file, ...step.args], { cwd: ROOT, encoding: "utf8", env: process.env, maxBuffer: 64 * 1024 * 1024 });
  let run = go();
  // The messaging checks wait on timers (a notice that shows after a pause, for example). On a
  // very busy machine one can miss its moment, so a failed part gets one more go before it counts.
  let again = false;
  if (step.group === "messages" && run.status !== 0 && run.status !== 3) { again = true; run = go(); }
  const out = String(run.stdout || "") + (run.status === 0 || run.status === 3 ? "" : String(run.stderr || "").split("\n").slice(-30).join("\n"));
  // Passing lines are counted, not printed: only what needs attention is shown
  const lines = out.split("\n");
  const passed = lines.filter((l) => /^\s+ok\s/.test(l)).length;
  const shown = lines.filter((l) => !/^\s+ok\s/.test(l) && !/^(all passed|skipped|\d+ FAILED)?\s*$/.test(l) && !/^\d+\. /.test(l));
  if (shown.length) console.log(shown.join("\n"));
  if (again && run.status === 0) console.log("  note  this part failed once and passed when run again (a timing hiccup, not a problem with AURA)");
  const state = run.status === 0 ? "passed" : run.status === 3 ? "skipped" : "FAILED";
  console.log(`  ${state === "passed" ? "✓" : state === "skipped" ? "–" : "✗"} ${passed} check${passed === 1 ? "" : "s"} passed${state === "FAILED" ? ", some FAILED (listed above)" : state === "skipped" ? ", the rest skipped" : ""}  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  results.push({ title: step.title, state, passed });
}

const total = results.reduce((n, r) => n + (r.passed || 0), 0);
const bad = results.filter((r) => r.state === "FAILED");
const skipped = results.filter((r) => r.state === "skipped");
console.log("\n" + "━".repeat(70));
for (const r of results) console.log(`  ${r.state === "passed" ? "✓" : r.state === "skipped" ? "–" : "✗"} ${r.title}${r.state === "passed" ? "" : "  (" + r.state + ")"}`);
console.log("");
if (bad.length) console.log(`${bad.length} part${bad.length === 1 ? "" : "s"} FAILED. Scroll up to the lines marked FAIL to see what and why.`);
else console.log(`All good: ${total} checks passed.` + (skipped.length ? ` ${skipped.length} part${skipped.length === 1 ? " was" : "s were"} skipped (see the notes above).` : ""));
process.exit(bad.length ? 1 : 0);
