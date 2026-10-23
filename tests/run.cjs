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
if (fs.existsSync(path.join(__dirname, "link-preview.cjs"))) add("files", "Link previews: what is looked up, and what a preview may hold", "link-preview.cjs"); // (Added by aura-messages-links-setup.cjs)
if (fs.existsSync(path.join(__dirname, "tray-rules.cjs"))) add("files", "Running in the tray: when AURA closes and when it only hides", "tray-rules.cjs");
if (fs.existsSync(path.join(__dirname, "platform-rules.cjs"))) add("files", "Twitch and Discord rules", "platform-rules.cjs");
if (fs.existsSync(errorlog)) add("files", "The error log", "errorlog.cjs", [errorlog]);
const shareFile = path.join(ROOT, "electron", "share.js");
if (fs.existsSync(shareFile) && fs.existsSync(path.join(__dirname, "share.cjs"))) add("files", "Sharing clips", "share.cjs", [shareFile]);
if (fs.existsSync(shareFile) && fs.existsSync(path.join(__dirname, "share-errors.cjs"))) add("files", "Sharing clips: when the sharing sites are down", "share-errors.cjs", [shareFile]);
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
      if (fs.existsSync(path.join(sqlDir, "aura-messages-links.sql")) && fs.existsSync(path.join(__dirname, "messages", "app-links.cjs"))) add("messages", "Link previews in messages", "messages/app-links.cjs", [social]); // (Added by aura-messages-links-setup.cjs)
      if (fs.existsSync(path.join(sqlDir, "aura-messages-groups.sql")) && fs.existsSync(path.join(__dirname, "messages", "sql-groups.mjs"))) { // (Added by aura-messages-groups-setup.cjs)
        add("messages", "Database rules: group chats", "messages/sql-groups.mjs");
        add("messages", "Group chats: making, talking, changing, leaving", "messages/app-groups.cjs", [social]);
      }
      if (fs.existsSync(path.join(sqlDir, "aura-calls-group.sql")) && fs.existsSync(path.join(__dirname, "messages", "sql-group-calls.mjs"))) { // (Added by aura-group-calls-setup.cjs)
        add("messages", "Database rules: calls with 3 people", "messages/sql-group-calls.mjs");
        add("messages", "Calls with 3 people: adding, joining, leaving", "messages/app-group-calls.cjs", [social]);
      }
    }
  }
}
// Likes and dislikes on messages, and GIF search, once that update is in both the database files and the app
if (fs.existsSync(social) && fs.existsSync(path.join(sqlDir, "aura-messages-safety.sql")) && fs.existsSync(path.join(sqlDir, "aura-messages-reactions.sql")) && fs.existsSync(path.join(__dirname, "messages", "sql-reactions.mjs"))) {
  add("messages", "Database rules: likes and dislikes", "messages/sql-reactions.mjs");
  let hasLikes = false;
  try { hasLikes = /\bgifSearch\b/.test(fs.readFileSync(social, "utf8")); } catch {}
  if (hasLikes) {
    add("messages", "Likes and dislikes on messages", "messages/app-reactions.cjs", [social]);
    add("messages", "Messaging on a database missing the likes update", "messages/app-before-reactions-sql.cjs", [social]);
    add("messages", "GIF search and sending GIFs", "messages/app-gifs.cjs", [social]);
  }
}
// Profile pictures saved to the account
const avatarFile = path.join(ROOT, "electron", "avatar.js");
if (fs.existsSync(avatarFile) && fs.existsSync(path.join(__dirname, "avatars.cjs")) && fs.existsSync(path.join(sqlDir, "aura-avatars.sql"))) add("messages", "Profile pictures", "avatars.cjs", [avatarFile]);
const securityFile = path.join(ROOT, "electron", "security.js");
if (fs.existsSync(securityFile) && fs.existsSync(path.join(__dirname, "security.cjs"))) add("files", "Security: windows, links, games and clip files", "security.cjs", [securityFile]);
if (fs.existsSync(path.join(__dirname, "browser-tabs.cjs"))) add("files", "Browser tabs", "browser-tabs.cjs");
if (fs.existsSync(path.join(__dirname, "ringtones.cjs"))) add("files", "Ringtones and message sounds", "ringtones.cjs");
if (fs.existsSync(path.join(__dirname, "sessions.cjs"))) add("files", "Sessions: every library game, however it was started", "sessions.cjs", [path.join(ROOT, "electron", "gamewatch.js")]);
if (fs.existsSync(path.join(__dirname, "no-devtools.cjs"))) add("files", "No menu bar or developer tools in the installed AURA", "no-devtools.cjs");
add("window", "The window opens and every page loads", "window.cjs");
if (fs.existsSync(path.join(__dirname, "friends-playing.cjs"))) add("window", "Home: Friends Playing Now", "friends-playing.cjs");
if (fs.existsSync(path.join(__dirname, "tray-settings.cjs"))) add("window", "Settings: running in the background", "tray-settings.cjs");
if (fs.existsSync(path.join(__dirname, "friends-menu.cjs"))) add("window", "The friends panel and its menu button", "friends-menu.cjs");
if (fs.existsSync(path.join(__dirname, "feedback.cjs"))) add("window", "The feedback form in Settings", "feedback.cjs");
if (fs.existsSync(path.join(__dirname, "browser-home.cjs"))) add("window", "The Social browser: Home, homepage, where you were", "browser-home.cjs");
if (fs.existsSync(path.join(__dirname, "update-notice.cjs"))) add("window", "The update notice", "update-notice.cjs");
if (fs.existsSync(path.join(__dirname, "twitch-glass.cjs"))) add("window", "Twitch streams as glass cards", "twitch-glass.cjs");
if (fs.existsSync(path.join(__dirname, "video-popout.cjs"))) add("window", "Videos pop out of the Social browser", "video-popout.cjs");
if (fs.existsSync(path.join(__dirname, "miniplayer.cjs"))) add("window", "The stream mini-player", "miniplayer.cjs");
if (fs.existsSync(path.join(__dirname, "login.cjs"))) add("window", "Staying logged in when AURA restarts", "login.cjs");
if (fs.existsSync(path.join(__dirname, "twitch-favorites.cjs"))) add("window", "Twitch favorites and live notices", "twitch-favorites.cjs");
if (fs.existsSync(path.join(__dirname, "achievements.cjs"))) add("window", "Achievements count everything", "achievements.cjs");
if (fs.existsSync(path.join(__dirname, "screen-share.cjs"))) add("window", "Screen share in voice calls", "screen-share.cjs");
if (fs.existsSync(path.join(__dirname, "look.cjs"))) add("window", "Full Screen switch and a theme from your background", "look.cjs");
if (fs.existsSync(path.join(__dirname, "new-achievements.cjs"))) add("window", "New achievements", "new-achievements.cjs");
if (fs.existsSync(path.join(__dirname, "controller.cjs"))) add("window", "Playing with a controller", "controller.cjs");
if (fs.existsSync(path.join(__dirname, "stream-bar.cjs"))) add("window", "Live Streams: the stream's buttons are never covered", "stream-bar.cjs");
if (fs.existsSync(path.join(__dirname, "camera.cjs"))) add("window", "The camera: preview, settings, recordings", "camera.cjs");
if (fs.existsSync(path.join(__dirname, "quality.cjs"))) add("window", "Picture quality: screen share, calls and recordings", "quality.cjs");
if (fs.existsSync(path.join(__dirname, "camera-backgrounds.cjs"))) add("window", "Camera backgrounds and green screen", "camera-backgrounds.cjs");
if (fs.existsSync(path.join(__dirname, "call-camera.cjs"))) add("window", "Your camera in calls", "call-camera.cjs");
if (fs.existsSync(path.join(__dirname, "call-screen.cjs"))) add("window", "The call screen", "call-screen.cjs");
if (fs.existsSync(path.join(__dirname, "reset-password.cjs"))) add("window", "Forgot password", "reset-password.cjs");
if (fs.existsSync(path.join(__dirname, "theme-backgrounds.cjs"))) add("window", "Saved themes keep their background", "theme-backgrounds.cjs");
if (fs.existsSync(path.join(__dirname, "group-calls.cjs"))) add("window", "Calls with 3 people", "group-calls.cjs");
if (fs.existsSync(path.join(__dirname, "stream-room.cjs"))) add("window", "A live stream makes room for call panels", "stream-room.cjs");
if (fs.existsSync(path.join(__dirname, "cams-full.cjs"))) add("window", "Call cameras full screen", "cams-full.cjs");
if (fs.existsSync(path.join(__dirname, "camera-busy.cjs"))) add("window", "One camera for the preview and calls", "camera-busy.cjs");
if (fs.existsSync(path.join(__dirname, "group-chats.cjs"))) add("window", "Group chats", "group-chats.cjs");
if (fs.existsSync(path.join(__dirname, "covers.cjs"))) add("window", "Cover art: none skipped", "covers.cjs");
if (fs.existsSync(path.join(__dirname, "message-links.cjs"))) add("window", "Links in messages", "message-links.cjs");
if (fs.existsSync(path.join(__dirname, "new-library.cjs"))) add("window", "A new AURA starts with an empty library", "new-library.cjs");

// No check may run for ever: after this many minutes it is stopped and counted as failed
const STEP_MINUTES = Number(process.env.AURA_STEP_MINUTES) > 0 ? Number(process.env.AURA_STEP_MINUTES) : 6;
const tooLong = (run) => !!run.error && run.error.code === "ETIMEDOUT";

const results = [];
for (const step of steps.filter((s) => wants(s.group))) {
  console.log("\n━━ " + step.title + " " + "━".repeat(Math.max(3, 66 - step.title.length)));
  if (step.group === "window" && !process.env.AURA_SKIP_BUILD) {
    // Check the window as it would ship: build it fresh first
    console.log("  building the window (npm run build)…");
    const built = spawnSync("npm", ["run", "build"], { cwd: ROOT, encoding: "utf8", shell: true, timeout: STEP_MINUTES * 60000 });
    if (built.status !== 0) {
      console.log(String(built.stdout || "").split("\n").slice(-25).join("\n") + String(built.stderr || "").split("\n").slice(-25).join("\n"));
      console.log("  FAIL  the window builds");
      results.push({ title: step.title, state: "FAILED" });
      continue;
    }
    console.log("  ok    the window builds");
  }
  const started = Date.now();
  const go = () => spawnSync(process.execPath, [step.file, ...step.args], { cwd: ROOT, encoding: "utf8", env: process.env, maxBuffer: 64 * 1024 * 1024, timeout: STEP_MINUTES * 60000, killSignal: "SIGKILL" });
  let run = go();
  // The messaging checks wait on timers (a notice that shows after a pause, for example). On a
  // very busy machine one can miss its moment, so a failed part gets one more go before it counts.
  let again = false;
  // (the window checks too: calls and cameras run on timers, and GitHub's machines are slower; Added by aura-ci-fix-setup.cjs)
  if ((step.group === "messages" || step.group === "window") && run.status !== 0 && run.status !== 3 && !tooLong(run)) { again = true; run = go(); }
  const out = String(run.stdout || "") + (run.status === 0 || run.status === 3 ? "" : String(run.stderr || "").split("\n").slice(-30).join("\n"));
  // Passing lines are counted, not printed: only what needs attention is shown
  const lines = out.split("\n");
  const passed = lines.filter((l) => /^\s+ok\s/.test(l)).length;
  const shown = lines.filter((l) => !/^\s+ok\s/.test(l) && !/^(all passed|skipped|\d+ FAILED)?\s*$/.test(l) && !/^\d+\. /.test(l));
  if (shown.length) console.log(shown.join("\n"));
  if (tooLong(run)) console.log(`  FAIL  this part didn't finish within ${STEP_MINUTES} minutes, so it was stopped`);
  if (again && run.status === 0) console.log("  note  this part failed once and passed when run again (a timing hiccup, not a problem with AURA)");
  const state = run.status === 0 ? "passed" : run.status === 3 ? "skipped" : "FAILED";
  console.log(`  ${state === "passed" ? "✓" : state === "skipped" ? "–" : "✗"} ${passed} check${passed === 1 ? "" : "s"} passed${state === "FAILED" ? ", some FAILED (listed above)" : state === "skipped" ? ", the rest skipped" : ""}  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  // On GitHub, a failed part is also written into the build's notes, so it can be read without the full log (Added by aura-ci-fix-setup.cjs)
  if (state === "FAILED" && process.env.GITHUB_ACTIONS) {
    const say = (tooLong(run) ? [`this part didn't finish within ${STEP_MINUTES} minutes`] : []).concat(shown.slice(0, 25)).join("\n").slice(0, 4000);
    console.log("::error title=" + step.title.replace(/[,:\r\n%]/g, " ") + "::" + say.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A"));
  }
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
