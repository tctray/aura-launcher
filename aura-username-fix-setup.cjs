#!/usr/bin/env node
/**
 * AURA — stay logged in: stop asking "Pick a username" every time AURA starts
 *
 * Since the profile pictures update, AURA asked for a username on every start, even though
 * you were still logged in and already had one. (A line that uploads an old profile picture
 * ended up between "you're logged in, go in" and "otherwise ask for a username", so the
 * question showed up almost every time.) This puts it back: AURA remembers you until you
 * press Log out, and only asks for a username if your account really doesn't have one.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-username-fix-setup.cjs
 *
 * What it does:
 *   - edits    your login file (auth.jsx)   the fix
 *   - creates  tests/login.cjs              (only if AURA's checks are installed) checks it
 *
 * Every file it changes is copied to <name>.before-username-fix.bak first.
 * To put everything back:                 node aura-username-fix-setup.cjs --undo
 * To preview without changing anything:   node aura-username-fix-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FILES = {"test":"// Staying logged in: when AURA starts with a saved login, it goes straight in\n// (no \"Pick a username\"), unless the account really has no username yet.\n// Opens the built window (dist) in a real browser with a pretend account system.\n// Added by aura-username-fix-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\", \".webp\": \"image/webp\", \".mp4\": \"video/mp4\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"  \" + JSON.stringify(extra))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\n\n(async () => {\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(process.env.CI ? 1 : 3); }\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch(options); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with. Run  npx playwright install chromium  once to add one.\"); return done(process.env.CI ? 1 : 3); }\n\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(DIST, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => {\n      if (err) { res.writeHead(404); return res.end(); }\n      res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" });\n      res.end(data);\n    });\n  });\n  await new Promise((r) => server.listen(0, \"127.0.0.1\", r));\n  const base = \"http://127.0.0.1:\" + server.address().port;\n\n  // Start AURA with a saved login. `online` is the profile Supabase has; `local` the one saved on this PC.\n  async function start({ online, local, offline = false }) {\n    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();\n    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());\n    await page.addInitScript(({ online, local, offline }) => {\n      try { localStorage.clear(); if (local) localStorage.setItem(\"aura_profile\", JSON.stringify(local)); } catch {}\n      window.__calls = [];\n      const ok = (data) => Promise.resolve({ success: true, data });\n      const answers = {\n        getSession: () => ok({ id: \"user-1\", email: \"me@example.com\", offline }),\n        getMyProfile: () => (offline ? Promise.resolve({ success: false, error: \"fetch failed\" }) : ok(online)),\n        saveProfile: (name, picture) => ok({ username: name, avatar_url: picture || null }),\n      };\n      // Everything else in the account system answers \"nothing yet\"\n      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => { window.__calls.push([name + \".\" + String(key), args]); return (name === \"auraCloud\" && answers[key]) ? answers[key](...args) : ok(null); }) });\n      window.auraCloud = fake(\"auraCloud\");\n      window.auraSocial = fake(\"auraSocial\");\n    }, { online, local, offline });\n    await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n    await page.waitForTimeout(4500);\n    const seen = await page.evaluate(() => ({\n      title: [...document.querySelectorAll(\".auth-title\")].map((e) => e.textContent).join(\" | \"),\n      saved: window.__calls.filter(([k]) => k === \"auraCloud.saveProfile\").map(([, a]) => [a[0], String(a[1] || \"\").slice(0, 22)]),\n      text: (document.body.innerText || \"\").trim().length,\n    }));\n    await page.context().close();\n    return seen;\n  }\n\n  try {\n    console.log(\"1. Starting AURA while logged in\");\n    let s = await start({ online: { username: \"tctray\", avatar_url: null }, local: { username: \"tctray\", avatar: \"\", userId: \"user-1\" } });\n    check(\"goes straight in, no \\\"Pick a username\\\"\", !s.title && s.text > 20, s);\n    s = await start({ online: { username: \"tctray\", avatar_url: \"https://twparkshmkrroaraiaow.supabase.co/storage/v1/object/public/avatars/user-1/a.png\" }, local: { username: \"tctray\", avatar: \"\", userId: \"user-1\" } });\n    check(\"same with a profile picture\", !s.title && s.text > 20, s);\n    s = await start({ online: { username: \"tctray\", avatar_url: null }, local: null });\n    check(\"same on a PC where AURA has no profile saved yet\", !s.title && s.text > 20, s);\n    s = await start({ online: { username: \"tctray\", avatar_url: null }, local: { username: \"tctray\", avatar: \"data:image/png;base64,iVBORw0KGgo=\", userId: \"user-1\" } });\n    check(\"a picture chosen on this PC is still uploaded quietly, and AURA goes straight in\", !s.title && s.saved.some(([n, p]) => n === \"tctray\" && p.startsWith(\"data:image/png\")), s);\n    s = await start({ offline: true, local: { username: \"tctray\", avatar: \"\", userId: \"user-1\" } });\n    check(\"offline: goes straight in with the name saved on this PC\", !s.title && s.text > 20, s);\n\n    console.log(\"2. Only when the account really has no username\");\n    s = await start({ online: null, local: null });\n    check(\"asks for a username\", /Pick a username/.test(s.title), s);\n    s = await start({ online: null, local: { username: \"tctray\", avatar: \"\", userId: \"user-1\" } });\n    check(\"but first tries the name saved on this PC, and goes in\", !s.title && s.saved.some(([n]) => n === \"tctray\"), s);\n    s = await start({ online: null, local: { username: \"someone\", avatar: \"\", userId: \"user-2\" } });\n    check(\"a name saved by a different account isn't used\", /Pick a username/.test(s.title) && !s.saved.length, s);\n  } finally {\n    await browser.close();\n    server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(e); process.exit(1); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-username-fix.bak";
const MARK = "Added by aura-username-fix-setup.cjs";
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "release", ".git", ".vite", "coverage", "tests", "supabase"]);

const rel = (p) => path.relative(ROOT, p) || p;
const say = (line = "") => console.log(line);
function stop(lines) {
  say();
  say("Nothing was changed.");
  (Array.isArray(lines) ? lines : [lines]).forEach((l) => say("  " + l));
  say();
  process.exit(1);
}
function readText(file) {
  const raw = fs.readFileSync(file, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n"; // keep Windows line endings as they are
  return { text: raw.replace(/\r\n/g, "\n"), eol };
}
const withEol = (text, eol) => (eol === "\n" ? text : text.replace(/\n/g, eol));
function* walk(dir, depth = 0) {
  if (depth > 7) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) yield* walk(full, depth + 1);
    } else if (/\.(jsx?|tsx?|cjs|mjs)$/.test(entry.name) && !/^aura-[\w-]+\.cjs$/.test(entry.name)) {
      try { if (fs.statSync(full).size < 3 * 1024 * 1024) yield full; } catch {}
    }
  }
}
// Finds one file. A project can have several that look alike, so `prefer` is a list of tie-breakers.
function findOne(label, test, hint, prefer = []) {
  let hits = [];
  for (const file of walk(ROOT)) {
    let text = "";
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    if (test(text)) hits.push({ file, text });
  }
  if (!hits.length) stop(["I couldn't find " + label + ".", hint, "Copy this message to Claude."]);
  for (const rule of prefer) {
    if (hits.length === 1) break;
    const kept = hits.filter((h) => rule(h));
    if (kept.length) hits = kept;
  }
  if (hits.length === 1) return hits[0].file;
  stop(["I found more than one file that looks like " + label + ":", ...hits.map((h) => "  " + rel(h.file)), "Copy this message to Claude."]);
}
const sameFile = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const indentOf = (line) => line.match(/^\s*/)[0];
const findLine = (lines, re, from = 0, to = lines.length) => { for (let i = from; i < to; i++) if (re.test(lines[i])) return i; return -1; };

// ── Login file: only ask for a username when there isn't one ─────────────────
function editAuth(text) {
  if (/\} else \{\n\s*\/\/ Only an account that really has no username yet is asked for one/.test(text)) return { text, notes: [] };
  const re = /^([ \t]*)if \(username\) enter\(account, username, mine\);\n((?:[ \t]*\/\/[^\n]*\n)*)[ \t]*if \(username && online !== undefined && (!online\?\.avatar_url && [^\n]*?\)) (cloudCall\("saveProfile", username, mine\.avatar\)\.catch\(\(\) => \{\}\);)\n[ \t]*else \{ setUser\(null\); setNeedsName\(\{ user: account, mine, taken \}\); \}\n/m;
  const m = text.match(re);
  if (!m) throw new Error('the startup login check ( if (username) enter(account, username, mine); ... else { setUser(null); setNeedsName(...) } )');
  const ind = m[1];
  const comments = m[2].split("\n").filter(Boolean).map((l) => ind + "  " + l.trim()).join("\n");
  const fixed = [
    ind + "if (username) {",
    ind + "  enter(account, username, mine);",
    ...(comments ? [comments] : []),
    ind + "  if (online !== undefined && " + m[3] + " " + m[4],
    ind + "} else {",
    ind + "  // Only an account that really has no username yet is asked for one",
    ind + "  setUser(null);",
    ind + "  setNeedsName({ user: account, mine, taken });",
    ind + "}",
    "",
  ].join("\n");
  return { text: text.replace(re, () => fixed), notes: ["AURA remembers you until you log out, and only asks for a username if your account has none"] };
}

// ── AURA's checks (only when they are installed): add the login one ──────────
function editRunner(text) {
  if (/login\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  const at = findLine(lines, /^add\("window",/);
  if (at < 0) return { text, notes: ["(couldn't find where to add the login check, so npm test doesn't include it)"] };
  lines.splice(at + 1, 0, 'if (fs.existsSync(path.join(__dirname, "login.cjs"))) add("window", "Staying logged in when AURA restarts", "login.cjs");');
  return { text: lines.join("\n"), notes: ["npm test now checks that AURA remembers your login"] };
}

// Does `node` accept the file? Catches a bad edit before anything is written.
function syntaxProblem(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-check-"));
  const file = path.join(dir, "check.cjs");
  try {
    fs.writeFileSync(file, text);
    const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    return r.status === 0 ? "" : String(r.stderr || "syntax error").split("\n").filter(Boolean).slice(0, 4).join(" | ");
  } catch { return ""; } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
}

// ── Undo ──────────────────────────────────────────────────────────────────────
function undo() {
  let restored = 0;
  const visit = (dir, depth = 0) => {
    if (depth > 7) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if ((!SKIP_DIRS.has(entry.name) || entry.name === "tests") && !entry.name.startsWith(".")) visit(full, depth + 1);
      } else if (entry.name.endsWith(BAK)) {
        const target = full.slice(0, -BAK.length);
        fs.copyFileSync(full, target); fs.unlinkSync(full);
        say("  restored  " + rel(target)); restored++;
      } else if (entry.name === "login.cjs") {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. Everything is back to how it was." : "Nothing to undo.");
  say();
}

// ── Run ───────────────────────────────────────────────────────────────────────
function run() {
  const pkgFile = path.join(ROOT, "package.json");
  if (!fs.existsSync(pkgFile)) stop(["This isn't your AURA project folder (no package.json here).", "Move this file next to package.json and run it from there."]);
  if (UNDO) return undo();

  const need = "Make sure this file is in your AURA project folder, next to package.json.";
  let pkgMain = "";
  try { pkgMain = String(JSON.parse(fs.readFileSync(pkgFile, "utf8")).main || ""); } catch {}
  const startFile = pkgMain ? path.resolve(ROOT, pkgMain) : "";
  const files = {
    auth: findOne("your login file", (t) => /export function AuthGate\s*\(/.test(t) && /setNeedsName\(/.test(t), need, [
      (h) => /[\\/]components[\\/]/.test(h.file),             // the one App imports (src/components/auth.jsx)
      (h) => !/[\\/]electron[\\/]/.test(h.file),               // not an old copy left in electron/
      (h) => /^auth\.[jt]sx?$/.test(path.basename(h.file)),
    ]),
  };

  const plan = [];
  const problems = [];
  const consider = (label, file, edit, checkSyntax) => {
    const { text, eol } = readText(file);
    try {
      const result = edit(text);
      if (checkSyntax && result.text !== text) { const bad = syntaxProblem(result.text); if (bad) throw new Error("a way to edit it safely (" + bad + ")"); }
      plan.push({ label, file, before: text, after: result.text, eol, notes: result.notes });
    } catch (e) { problems.push("In " + rel(file) + " I couldn't find " + e.message + "."); }
  };
  consider("login file", files.auth, editAuth, false);
  const runner = path.join(ROOT, "tests", "run.cjs");
  const hasChecks = fs.existsSync(runner);
  if (hasChecks) consider("checks", runner, editRunner, true);

  const created = [];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "login.cjs"), content: FILES.test });
  for (const c of created) {
    c.note = "created";
    if (fs.existsSync(c.file)) {
      const existing = readText(c.file).text;
      if (!existing.includes(MARK)) problems.push(rel(c.file) + " already exists and wasn't made by this script, so I left it alone.");
      else c.note = existing === c.content ? "already done" : "updated";
    }
  }
  if (problems.length) stop([...problems, "Copy this message to Claude."]);

  say();
  say(DRY ? "Dry run. This is what would change:" : "AURA: stay logged in");
  say();
  for (const step of plan) {
    if (step.after !== step.before && !DRY) {
      const bak = step.file + BAK;
      if (!fs.existsSync(bak)) fs.copyFileSync(step.file, bak);
      fs.writeFileSync(step.file, withEol(step.after, step.eol));
    }
    say("  " + (step.label + ":").padEnd(11) + rel(step.file));
    (step.notes.length ? step.notes : ["already done"]).forEach((n) => say("             - " + n));
  }
  for (const c of created) {
    if (c.note !== "already done" && !DRY) { fs.mkdirSync(path.dirname(c.file), { recursive: true }); fs.writeFileSync(c.file, c.content); }
    say("  " + (c.label + ":").padEnd(11) + rel(c.file));
    say("             - " + c.note);
  }
  say();
  if (DRY) { say("Run it again without --dry-run to apply."); say(); return; }
  say("Done. Restart AURA (stop it in the terminal and start it again). It should go straight in.");
  if (hasChecks) say("Run  npm test  before your next release.");
  say("To undo later:  node aura-username-fix-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
