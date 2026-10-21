#!/usr/bin/env node
/**
 * AURA — Forgot password
 *
 *   - A "Forgot password?" link under the password on the Log in page.
 *   - Reset your password: type your email and AURA asks Supabase to email you a code.
 *     Then type the code and a new password, and you're logged in.
 *   - A code instead of a link, because a link would open the web browser, not AURA.
 *   - It never says whether an email has an account (so nobody can use it to check).
 *   - Free: Supabase's own password reset. Supabase checks the code and sets the password.
 *
 * ONE STEP IN SUPABASE (once): the reset email has to show the code. In your Supabase project:
 *   Authentication > Emails > Reset Password: put {{ .Token }} in the message (see the steps
 *   printed when this finishes).
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-reset-password-setup.cjs
 *
 * What it does:
 *   - edits    electron/supabase.js       asks Supabase for a code; checks it and sets the password
 *   - edits    electron/main.js           lets the window ask for those
 *   - edits    electron/preload.js        window.auraCloud gets the two calls
 *   - edits    src/components/auth.jsx    the link and the two pages
 *   - creates  tests/reset-password.cjs   (only if AURA's checks are installed) checks it
 *
 * Every file it changes is copied to <name>.before-reset-password.bak first.
 * To put everything back:                 node aura-reset-password-setup.cjs --undo
 * To preview without changing anything:   node aura-reset-password-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FILES = {"test":"// Forgot password: the \"Forgot password?\" link, the Reset your password pages, and what AURA asks\n// Supabase for. First with a pretend Supabase (no internet), then in the built window (dist) in a real\n// browser with a pretend account system.\n// Added by aura-reset-password-setup.cjs.\n\"use strict\";\nconst Module = require(\"module\");\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\n\n(async () => {\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(process.env.CI ? 1 : 3); }\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch(options); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with. Run  npx playwright install chromium  once to add one.\"); return done(process.env.CI ? 1 : 3); }\n\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(DIST, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => {\n      if (err) { res.writeHead(404); return res.end(); }\n      res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" });\n      res.end(data);\n    });\n  });\n  await new Promise((r) => server.listen(0, \"127.0.0.1\", r));\n  const base = \"http://127.0.0.1:\" + server.address().port;\n\n  // ── 1. What AURA asks Supabase for (electron/supabase.js, with a pretend Supabase) ──\n  console.log(\"1. Asking Supabase\");\n  const asked = [];\n  let session = null, verifyAnswer = null, updateAnswer = null;\n  const fakeAuth = {\n    resetPasswordForEmail: async (email) => { asked.push([\"reset\", email]); return { error: null }; },\n    verifyOtp: async (o) => { asked.push([\"verify\", o]); if (verifyAnswer) return verifyAnswer; session = { user: { id: \"u1\", email: o.email, user_metadata: { username: \"tester\" } } }; return { data: { user: session.user, session }, error: null }; },\n    updateUser: async (o) => { asked.push([\"update\", o]); if (updateAnswer) return updateAnswer; return { data: { user: session.user }, error: null }; },\n    getSession: async () => ({ data: { session } }),\n  };\n  const realLoad = Module._load;\n  Module._load = function (request, parent, isMain) {\n    if (request === \"electron\") return { app: { getPath: () => require(\"os\").tmpdir(), whenReady: async () => {} }, safeStorage: { isEncryptionAvailable: () => false } };\n    if (request === \"@supabase/supabase-js\") return { createClient: () => ({ auth: fakeAuth }) };\n    return realLoad.apply(this, arguments);\n  };\n  const cloud = require(path.join(ROOT, \"electron\", \"supabase.js\"));\n  Module._load = realLoad;\n  const fails = async (p) => { try { await p; return \"\"; } catch (e) { return e.message; } };\n  check(\"sendResetCode refuses something that isn't an email\", (await fails(cloud.sendResetCode(\"nope\"))) === \"invalid email\" && asked.length === 0);\n  await cloud.sendResetCode(\"  Me@Example.com \");\n  check(\"and asks Supabase to email a code to the address\", JSON.stringify(asked[0]) === JSON.stringify([\"reset\", \"Me@Example.com\"]), asked);\n  check(\"a code that isn't numbers is refused before asking Supabase\", (await fails(cloud.resetPasswordWithCode(\"me@example.com\", \"abc\", \"longenough\"))) === \"code format\" && asked.length === 1);\n  check(\"a short new password is refused\", /at least 8/.test(await fails(cloud.resetPasswordWithCode(\"me@example.com\", \"123456\", \"short\"))) && asked.length === 1);\n  verifyAnswer = { data: null, error: { message: \"Token has expired or is invalid\" } };\n  check(\"a wrong code: Supabase's answer comes back as the error\", (await fails(cloud.resetPasswordWithCode(\"me@example.com\", \"111111\", \"longenough\"))) === \"Token has expired or is invalid\" && !asked.some(([k]) => k === \"update\"));\n  verifyAnswer = null;\n  updateAnswer = { data: null, error: { message: \"New password should be different from the old password.\" } };\n  check(\"the right code, but the password can't be used: that's the error\", /different from the old/.test(await fails(cloud.resetPasswordWithCode(\"me@example.com\", \" 123 456 \", \"samepassword\"))));\n  const v = asked.filter(([k]) => k === \"verify\").pop();\n  check(\"the code is checked with Supabase as a password-reset code (spaces removed)\", !!v && v[1].token === \"123456\" && v[1].type === \"recovery\" && v[1].email === \"me@example.com\", v);\n  updateAnswer = null;\n  asked.length = 0;\n  const user = await cloud.resetPasswordWithCode(\"me@example.com\", \"\", \"anotherpassword\");\n  check(\"trying again after that only sets the password (the code was already used)\", !asked.some(([k]) => k === \"verify\") && asked.some(([k, o]) => k === \"update\" && o.password === \"anotherpassword\"), asked);\n  check(\"and you're logged in\", user && user.id === \"u1\" && user.username === \"tester\", user);\n  session = null; asked.length = 0;\n  const u2 = await cloud.resetPasswordWithCode(\"me@example.com\", \"654321\", \"brandnewpass\");\n  check(\"the whole thing in one go: code checked, password set\", asked.map(([k]) => k).join(\",\") === \"verify,update\" && u2.email === \"me@example.com\", asked);\n\n  // ── 2. The pages ──\n  try {\n    const page = await (await browser.newContext({ viewport: { width: 1360, height: 860 } })).newPage();\n    const thrown = [];\n    page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n    await page.route((url) => !String(url).startsWith(base) && !String(url).startsWith(\"data:\"), (route) => route.abort());\n    await page.addInitScript(() => {\n      try { localStorage.clear(); } catch {}\n      window.__calls = [];\n      window.__signedIn = null;\n      window.__resetAnswers = [];\n      const ok = (data) => Promise.resolve({ success: true, data });\n      const no = (error) => Promise.resolve({ success: false, error });\n      const account = {\n        getSession: () => ok(window.__signedIn),\n        getMyProfile: () => ok(window.__signedIn ? { username: \"tester\", avatar_url: null } : null),\n        sendResetCode: () => ok(true),\n        resetPasswordWithCode: () => { const a = window.__resetAnswers.shift(); if (a && a.error) return no(a.error); window.__signedIn = { id: \"u1\", email: \"me@example.com\", username: \"tester\" }; return ok(window.__signedIn); },\n        logOut: () => { window.__signedIn = null; return ok(true); },\n      };\n      window.auraCloud = new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => { window.__calls.push([key, args]); return account[key] ? account[key](...args) : ok(null); }) });\n      window.auraSocial = new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : () => ok(null)) });\n      window.electronAPI = new Proxy({}, { get: (_t, k) => (k === \"isElectron\" ? true : typeof k !== \"string\" || k === \"then\" ? undefined : /^(on[A-Z]|remove)/.test(k) ? () => () => {} : () => Promise.resolve({ success: false })) });\n    });\n    await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n    await page.waitForTimeout(3000);\n    const called = (name) => page.evaluate((n) => window.__calls.filter(([k]) => k === n).map(([, a]) => a), name);\n    const msg = () => page.locator(\".auth-msg\").allInnerTexts().then((x) => x.join(\" | \"));\n    const forgot = page.locator(\".auth-forgot-row .auth-link\");\n\n    console.log(\"2. The Forgot password? link\");\n    check(\"the Log in page has a Forgot password? link\", (await forgot.count()) === 1 && (await forgot.innerText()) === \"Forgot password?\");\n    await page.locator(\".auth-seg button\", { hasText: \"Sign up\" }).click();\n    check(\"Sign up doesn't show it\", (await forgot.count()) === 0);\n    await page.locator(\".auth-seg button\", { hasText: \"Log in\" }).click();\n    await page.locator(\"#auth-email\").fill(\"me@example.com\");\n    await forgot.click();\n    check(\"it opens Reset your password, with the email already filled in\", (await page.locator(\".auth-title\").innerText()) === \"Reset your password\" && (await page.locator(\"#auth-reset-email\").inputValue()) === \"me@example.com\");\n\n    console.log(\"3. Asking for a code\");\n    await page.locator(\"#auth-reset-email\").fill(\"not an email\");\n    await page.locator(\".auth-btn\", { hasText: \"Send code\" }).click();\n    check(\"a mistyped email is explained (and nothing is sent)\", /Enter the email you use for AURA/.test(await msg()) && (await called(\"sendResetCode\")).length === 0);\n    await page.locator(\"#auth-reset-email\").fill(\"me@example.com\");\n    await page.locator(\".auth-btn\", { hasText: \"Send code\" }).click();\n    await page.waitForTimeout(400);\n    check(\"Send code asks for a code for that email\", JSON.stringify(await called(\"sendResetCode\")) === JSON.stringify([[\"me@example.com\"]]));\n    check(\"then: Check your email, without saying whether the account exists\", (await page.locator(\".auth-title\").innerText()) === \"Check your email\" && /If me@example.com has an AURA account/.test(await page.locator(\".auth-text\").innerText()));\n    check(\"Send another waits a minute first\", await page.locator(\".auth-link\", { hasText: /Send another in \\d+s/ }).isDisabled());\n\n    console.log(\"4. The code and a new password\");\n    await page.locator(\"#auth-reset-code\").fill(\"12ab34\");\n    check(\"the code box only takes numbers\", (await page.locator(\"#auth-reset-code\").inputValue()) === \"1234\");\n    await page.locator(\"#auth-reset-password\").fill(\"longenough\");\n    await page.locator(\".auth-btn\", { hasText: \"Set new password\" }).click();\n    check(\"a code that's too short is explained\", /Enter the code from the email/.test(await msg()) && (await called(\"resetPasswordWithCode\")).length === 0);\n    await page.locator(\"#auth-reset-code\").fill(\"123456\");\n    await page.locator(\"#auth-reset-password\").fill(\"short\");\n    await page.locator(\".auth-btn\", { hasText: \"Set new password\" }).click();\n    check(\"a short password is explained\", /at least 8 characters/.test(await msg()));\n    await page.evaluate(() => { window.__resetAnswers.push({ error: \"Token has expired or is invalid\" }); });\n    await page.locator(\"#auth-reset-password\").fill(\"longenough\");\n    await page.locator(\".auth-btn\", { hasText: \"Set new password\" }).click();\n    await page.waitForTimeout(400);\n    check(\"a wrong or old code is explained in plain words\", /That code is wrong or has expired/.test(await msg()), await msg());\n    await page.evaluate(() => { window.__resetAnswers.push({ error: \"New password should be different from the old password.\" }); });\n    await page.locator(\".auth-btn\", { hasText: \"Set new password\" }).click();\n    await page.waitForTimeout(400);\n    check(\"reusing the old password is explained\", /haven't used for AURA before/.test(await msg()), await msg());\n    await page.locator(\"#auth-reset-password\").fill(\"brandnewpass\");\n    await page.locator(\".auth-btn\", { hasText: \"Set new password\" }).click();\n    const inApp = await page.waitForSelector(\".sb, .gm-rail\", { timeout: 8000 }).then(() => true).catch(() => false);\n    check(\"the right code and a new password: you're logged in to AURA\", inApp && (await page.locator(\".auth\").count()) === 0);\n    const sent = (await called(\"resetPasswordWithCode\")).pop();\n    check(\"with that email, code and new password\", JSON.stringify(sent) === JSON.stringify([\"me@example.com\", \"123456\", \"brandnewpass\"]), sent);\n\n    console.log(\"5. Going back\");\n    const p2 = await (await browser.newContext({ viewport: { width: 1360, height: 860 } })).newPage();\n    await p2.route((url) => !String(url).startsWith(base) && !String(url).startsWith(\"data:\"), (route) => route.abort());\n    await p2.addInitScript(() => {\n      window.__calls = [];\n      const ok = (data) => Promise.resolve({ success: true, data });\n      window.auraCloud = new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => { window.__calls.push([key, args]); return key === \"resetPasswordWithCode\" ? Promise.resolve({ success: false, error: \"Password should be at least 12 characters\" }) : ok(null); }) });\n      window.auraSocial = new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : () => ok(null)) });\n      window.electronAPI = new Proxy({}, { get: (_t, k) => (k === \"isElectron\" ? true : typeof k !== \"string\" || k === \"then\" ? undefined : /^(on[A-Z]|remove)/.test(k) ? () => () => {} : () => Promise.resolve({ success: false })) });\n    });\n    await p2.goto(base + \"/index.html\", { waitUntil: \"load\" });\n    await p2.waitForTimeout(3000);\n    await p2.locator(\".auth-forgot-row .auth-link\").click();\n    await p2.locator(\".auth-alt .auth-link\", { hasText: \"Log in\" }).click();\n    check(\"Remembered it? Log in goes back to Log in\", (await p2.locator(\".auth-seg\").count()) === 1 && (await p2.locator(\".auth-forgot-row\").count()) === 1);\n    await p2.locator(\".auth-forgot-row .auth-link\").click();\n    await p2.locator(\"#auth-reset-email\").fill(\"me@example.com\");\n    await p2.locator(\".auth-btn\", { hasText: \"Send code\" }).click();\n    await p2.locator(\"#auth-reset-code\").fill(\"123456\");\n    await p2.locator(\"#auth-reset-password\").fill(\"longenough\");\n    await p2.locator(\".auth-btn\", { hasText: \"Set new password\" }).click();\n    await p2.waitForTimeout(400);\n    check(\"a password Supabase finds too weak is explained\", /too easy to guess/.test(await p2.locator(\".auth-msg\").allInnerTexts().then((x) => x.join(\" \"))));\n    await p2.locator(\".auth-alt .auth-link\", { hasText: \"Back to log in\" }).click();\n    await p2.waitForTimeout(400);\n    check(\"leaving after the code was accepted logs you back out (no half-reset login left behind)\", (await p2.evaluate(() => window.__calls.some(([k]) => k === \"logOut\"))) && (await p2.locator(\".auth-seg\").count()) === 1);\n    check(\"the email is still filled in on Log in\", (await p2.locator(\"#auth-email\").inputValue()) === \"me@example.com\");\n\n    check(\"nothing crashed along the way\", thrown.length === 0, thrown);\n  } finally {\n    await browser.close();\n    server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The forgot password check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-reset-password.bak";
const MARK = "Added by aura-reset-password-setup.cjs";
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

function swapOnce(text, find, replace, what) {
  const i = text.indexOf(find);
  if (i < 0 || text.indexOf(find, i + 1) >= 0) throw new Error(what);
  return text.slice(0, i) + replace + text.slice(i + find.length);
}

// ── electron/supabase.js: ask Supabase for a code, then check it and set the new password ──
function editSupabase(text) {
  if (text.includes("async function sendResetCode(")) return { text, notes: [] };
  let t = text;
  t = swapOnce(t, "// ── Profiles ──────────────────────────────────────────────────────────────────\n",
    "// ── Forgot password (" + MARK + ") ──\n" +
    "// Supabase emails a code (Authentication > Emails > Reset Password must show {{ .Token }}).\n" +
    "// Typing that code proves the email is yours; then the new password is set and you're logged in.\n" +
    "const RESET_EMAIL = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;\n" +
    "async function sendResetCode(email) {\n" +
    "  const mail = String(email || \"\").trim();\n" +
    "  if (!RESET_EMAIL.test(mail) || mail.length > 254) throw new Error(\"invalid email\");\n" +
    "  const { error } = await client().auth.resetPasswordForEmail(mail);\n" +
    "  if (error) throw new Error(error.message);\n" +
    "  return true; // (the same answer whether or not the email has an account)\n" +
    "}\n" +
    "async function resetPasswordWithCode(email, code, newPassword) {\n" +
    "  const mail = String(email || \"\").trim();\n" +
    "  const token = String(code || \"\").replace(/\\s+/g, \"\");\n" +
    "  if (!RESET_EMAIL.test(mail) || mail.length > 254) throw new Error(\"invalid email\");\n" +
    "  if (typeof newPassword !== \"string\" || newPassword.length < 8 || newPassword.length > 72) throw new Error(\"Use at least 8 characters for your password.\");\n" +
    "  // Already checked this code (the first try at a new password didn't take)? Then only the password is left to set\n" +
    "  const { data: now } = await client().auth.getSession();\n" +
    "  let user = now?.session?.user && String(now.session.user.email || \"\").toLowerCase() === mail.toLowerCase() ? now.session.user : null;\n" +
    "  if (!user) {\n" +
    "    if (!/^\\d{6,10}$/.test(token)) throw new Error(\"code format\");\n" +
    "    const { data, error } = await client().auth.verifyOtp({ email: mail, token, type: \"recovery\" });\n" +
    "    if (error) throw new Error(error.message);\n" +
    "    user = data?.user;\n" +
    "    if (!user) throw new Error(\"Token has expired or is invalid\");\n" +
    "  }\n" +
    "  const { data: changed, error: e2 } = await client().auth.updateUser({ password: newPassword });\n" +
    "  if (e2) throw new Error(e2.message);\n" +
    "  const signedIn = toUser(changed?.user || user);\n" +
    "  await rememberUser(signedIn);\n" +
    "  return signedIn;\n" +
    "}\n\n" +
    "// ── Profiles ──────────────────────────────────────────────────────────────────\n",
    "the Profiles section ( // ── Profiles ── )");
  t = swapOnce(t, "module.exports = { signUp, logIn, logOut, getSession, resendConfirmation, ",
    "module.exports = { signUp, logIn, logOut, getSession, resendConfirmation, sendResetCode, resetPasswordWithCode, ",
    "the list of account functions ( module.exports = { signUp, logIn, ... } )");
  return { text: t, notes: ["asks Supabase for a reset code, then checks it and sets the new password"] };
}

// ── electron/main.js: let the window ask for them ──
function editMain(text) {
  if (text.includes('"auth:sendResetCode"')) return { text, notes: [] };
  return {
    text: swapOnce(text, 'ipcMain.handle("auth:resendConfirmation", cloudHandler(auraCloud.resendConfirmation));\n',
      'ipcMain.handle("auth:resendConfirmation", cloudHandler(auraCloud.resendConfirmation));\n' +
      '// Forgot password (' + MARK + ')\n' +
      'ipcMain.handle("auth:sendResetCode", cloudHandler(auraCloud.sendResetCode));\n' +
      'ipcMain.handle("auth:resetPasswordWithCode", cloudHandler(auraCloud.resetPasswordWithCode));\n',
      'the account handlers ( ipcMain.handle("auth:resendConfirmation", ... ) )'),
    notes: ["the window can ask for a reset code and set a new password"],
  };
}

// ── electron/preload.js ──
function editPreload(text) {
  if (text.includes("sendResetCode:")) return { text, notes: [] };
  return {
    text: swapOnce(text, '  resendConfirmation: (email) => ipcRenderer.invoke("auth:resendConfirmation", email),\n',
      '  resendConfirmation: (email) => ipcRenderer.invoke("auth:resendConfirmation", email),\n' +
      '  sendResetCode: (email) => ipcRenderer.invoke("auth:sendResetCode", email), // forgot password (' + MARK + ')\n' +
      '  resetPasswordWithCode: (email, code, password) => ipcRenderer.invoke("auth:resetPasswordWithCode", email, code, password),\n',
      'window.auraCloud ( resendConfirmation: ... )'),
    notes: ["window.auraCloud gets the two reset calls"],
  };
}

// ── src/components/auth.jsx: the link and the two pages ──
const RESET_SCREEN = `
// ── Forgot password (${MARK}) ──
// 1. Your email: Supabase sends a code.  2. The code and a new password: you're logged in.
function ResetScreen({ covers, calm, startEmail, onBack, onSignedIn }) {
  const [step, setStep] = useState("email"); // "email" | "code"
  const [email, setEmail] = useState(startEmail || "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [wait, setWait] = useState(0); // seconds until another code can be sent
  const checked = useRef(false); // the code was right (if setting the password then failed, only that is tried again)
  const first = useRef(null);
  useEffect(() => { first.current?.focus(); }, [step]);
  useEffect(() => { if (!wait) return; const t = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(t); }, [wait]);

  const send = async (again) => {
    const mail = email.trim();
    setError(""); setNotice("");
    if (!EMAIL_RULE.test(mail)) { setError("Enter the email you use for AURA."); return; }
    setBusy(true);
    try {
      await cloudCall("sendResetCode", mail);
      setStep("code"); setWait(60);
      if (again) setNotice("We sent another code. Use the newest one.");
    } catch (err) { setError(err.message); }
    setBusy(false);
  };
  const finish = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError(""); setNotice("");
    const digits = code.replace(/\\s+/g, "");
    if (!checked.current && !/^\\d{6,10}$/.test(digits)) { setError("Enter the code from the email (just the numbers)."); return; }
    if (password.length < 8) { setError("Use at least 8 characters for your new password."); return; }
    setBusy(true);
    try {
      const user = await cloudCall("resetPasswordWithCode", email.trim(), digits, password);
      await onSignedIn(user);
      return;
    } catch (err) {
      // Setting the password failed after the code was accepted: keep going without the code
      if (!/code is wrong|code doesn't look right|expired/i.test(err.message)) checked.current = true;
      setError(err.message);
    }
    setBusy(false);
  };
  // Leaving halfway: if the code was already accepted, don't stay logged in without a password you know
  const back = async () => { if (checked.current) { try { await cloudCall("logOut"); } catch {} } onBack(email.trim()); };

  if (step === "email") {
    return (
      <AuthShell covers={covers} calm={calm}>
        <h1 className="auth-title">Reset your password</h1>
        <p className="auth-text">Enter the email you use for AURA. We'll send you a code to set a new password.</p>
        <form className="auth-form" onSubmit={(e) => { e.preventDefault(); if (!busy) send(false); }} noValidate>
          <div className="auth-field">
            <label className="auth-label" htmlFor="auth-reset-email">Email</label>
            <input id="auth-reset-email" ref={first} className="auth-input" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)} autoComplete="email" spellCheck={false} placeholder="you@example.com" />
          </div>
          {error && <div className="auth-msg err" role="alert">{error}</div>}
          <button type="submit" className="auth-btn" disabled={busy}>{busy ? "Sending…" : "Send code"}</button>
        </form>
        <p className="auth-alt">Remembered it? <button type="button" className="auth-link" onClick={back}>Log in</button></p>
      </AuthShell>
    );
  }
  return (
    <AuthShell covers={covers} calm={calm}>
      <h1 className="auth-title">Check your email</h1>
      <p className="auth-text">If <strong>{email.trim()}</strong> has an AURA account, we sent it a code. It can take a minute, so check your spam folder too.</p>
      <form className="auth-form" onSubmit={finish} noValidate>
        <div className="auth-field">
          <label className="auth-label" htmlFor="auth-reset-code">Code</label>
          <input id="auth-reset-code" ref={first} className="auth-input auth-code" value={code} inputMode="numeric" autoComplete="one-time-code"
            maxLength={12} spellCheck={false} placeholder="123456" onChange={(e) => setCode(e.target.value.replace(/[^\\d\\s]/g, ""))} />
        </div>
        <div className="auth-field">
          <label className="auth-label" htmlFor="auth-reset-password">New password</label>
          <div className="auth-password">
            <input id="auth-reset-password" className="auth-input" type={showPassword ? "text" : "password"} value={password}
              onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" />
            <button type="button" className="auth-show" onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? "Hide" : "Show"}</button>
          </div>
        </div>
        {error && <div className="auth-msg err" role="alert">{error}</div>}
        {notice && <div className="auth-msg ok" role="status">{notice}</div>}
        <button type="submit" className="auth-btn" disabled={busy}>{busy ? "Saving…" : "Set new password"}</button>
      </form>
      <p className="auth-alt">
        No code?{" "}
        <button type="button" className="auth-link" onClick={() => send(true)} disabled={busy || wait > 0}>
          {wait > 0 ? \`Send another in \${wait}s\` : "Send another"}
        </button>
        {"  ·  "}
        <button type="button" className="auth-link" onClick={back}>Back to log in</button>
      </p>
    </AuthShell>
  );
}
`;

const RESET_CSS = `/* Forgot password (${MARK}) */
.auth .auth-title{color:var(--a-t1)} /* titles on these screens were dark on dark */
.auth-forgot-row{display:flex;justify-content:flex-end;margin-top:-6px}
.auth-forgot-row .auth-link{font-size:12px;font-weight:500;color:var(--a-t2)}
.auth-forgot-row .auth-link:hover{color:var(--a-t1)}
.auth-code{letter-spacing:6px;font-size:18px;font-variant-numeric:tabular-nums}
.auth-code::placeholder{letter-spacing:6px}
`;

function editAuth(text) {
  if (text.includes("function ResetScreen(")) return { text, notes: [] };
  let t = text;
  // Friendlier words for what Supabase says
  t = swapOnce(t, '  [/fetch failed|failed to fetch|network|enotfound|econn|etimedout|timed out/i, "Can\'t reach AURA\'s servers. Check your internet connection."],\n',
    '  [/fetch failed|failed to fetch|network|enotfound|econn|etimedout|timed out/i, "Can\'t reach AURA\'s servers. Check your internet connection."],\n' +
    '  // Forgot password (' + MARK + ')\n' +
    '  [/token has expired|otp.*(expired|invalid)|invalid.*otp|expired.*token/i, "That code is wrong or has expired. Check the newest email, or send another code."],\n' +
    '  [/^code format$/i, "That code doesn\'t look right. Enter just the numbers from the email."],\n' +
    '  [/different from the old password/i, "Pick a password you haven\'t used for AURA before."],\n' +
    '  [/password should be|weak password|password is too weak/i, "That password is too easy to guess. Try a longer one."],\n',
    "the friendly error messages ( fetch failed|failed to fetch ... )");
  t = swapOnce(t, '  const [mode, setMode] = useState("login"); // "login" | "signup" | "sent"\n',
    '  const [mode, setMode] = useState("login"); // "login" | "signup" | "sent" | "reset"\n',
    'the sign-in modes ( const [mode, setMode] = useState("login"); )');
  t = swapOnce(t, '  if (mode === "sent") {\n',
    '  if (mode === "reset") {\n' +
    '    return <ResetScreen covers={covers} calm={calm} startEmail={email.trim()} onSignedIn={onSignedIn}\n' +
    '      onBack={(mail) => { if (mail) setEmail(mail); switchMode("login"); }} />;\n' +
    '  }\n' +
    '  if (mode === "sent") {\n',
    'the confirmation screen ( if (mode === "sent") { )');
  // The link, under the password (only when logging in)
  t = swapOnce(t, '        {error && <div className="auth-msg err" role="alert">{error}</div>}\n\n        <button type="submit" className="auth-btn" disabled={busy}>\n',
    '        {!signingUp && (\n' +
    '          <div className="auth-forgot-row"><button type="button" className="auth-link" onClick={() => switchMode("reset")}>Forgot password?</button></div>\n' +
    '        )}\n\n' +
    '        {error && <div className="auth-msg err" role="alert">{error}</div>}\n\n        <button type="submit" className="auth-btn" disabled={busy}>\n',
    "the Log in button");
  t = swapOnce(t, "// Shown only when an account has no username yet (for example, the one from sign up was taken)\n",
    RESET_SCREEN.trimStart() + "\n// Shown only when an account has no username yet (for example, the one from sign up was taken)\n",
    "the username step ( // Shown only when an account has no username yet ... )");
  t = swapOnce(t, "\n/* Log out confirmation */\n", "\n" + RESET_CSS + "\n/* Log out confirmation */\n", "the sign-in look ( /* Log out confirmation */ )");
  return { text: t, notes: [
    "a \"Forgot password?\" link under the password on the Log in page",
    "Reset your password: email, then the 6-digit code and a new password; you're logged in",
  ] };
}

// ── AURA's checks (only when they are installed) ─────────────────────────────
function editRunner(text) {
  if (/reset-password\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  let at = -1;
  for (let i = 0; i < lines.length; i++) if (/add\("window",/.test(lines[i])) at = i;
  if (at < 0) return { text, notes: ["(couldn't find where to add the check, so npm test doesn't include it)"] };
  lines.splice(at + 1, 0, 'if (fs.existsSync(path.join(__dirname, "reset-password.cjs"))) add("window", "Forgot password", "reset-password.cjs");');
  return { text: lines.join("\n"), notes: ["npm test now checks Forgot password too"] };
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
      } else if (entry.name === "reset-password.cjs") {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. Forgot password is gone." : "Nothing to undo.");
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
  const comp = (h) => /[\\/]components[\\/]/.test(h.file);
  const files = {
    auth: findOne("your sign-in file", (t) => /export function AuthGate\s*\(/.test(t) && /function AuthScreen\s*\(/.test(t), need, [
      (h) => /^auth\.[jt]sx?$/.test(path.basename(h.file)) && /[\\/]components[\\/]/.test(h.file),
    ]),
    cloud: findOne("your accounts file (supabase.js)", (t) => /signInWithPassword/.test(t) && /module\.exports = \{ signUp, logIn/.test(t), need),
    preload: findOne("your preload file", (t) => /exposeInMainWorld\("auraCloud"/.test(t), need),
    main: findOne("your main file", (t) => /function createWindow\s*\(/.test(t) && /ipcMain\.handle\("auth:logIn"/.test(t), need, [
      (h) => startFile && sameFile(h.file, startFile),
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
  consider("accounts", files.cloud, editSupabase, true);
  consider("main file", files.main, editMain, true);
  consider("preload", files.preload, editPreload, true);
  consider("sign-in file", files.auth, editAuth, false);
  const runner = path.join(ROOT, "tests", "run.cjs");
  const hasChecks = fs.existsSync(runner);
  if (hasChecks) consider("checks", runner, editRunner, true);

  const created = [];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "reset-password.cjs"), content: FILES.test });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: Forgot password");
  say();
  for (const step of plan) {
    if (step.after !== step.before && !DRY) {
      const bak = step.file + BAK;
      if (!fs.existsSync(bak)) fs.copyFileSync(step.file, bak);
      fs.writeFileSync(step.file, withEol(step.after, step.eol));
    }
    say("  " + (step.label + ":").padEnd(13) + rel(step.file));
    (step.notes.length ? step.notes : ["already done"]).forEach((n) => say("               - " + n));
  }
  for (const c of created) {
    if (c.note !== "already done" && !DRY) { fs.mkdirSync(path.dirname(c.file), { recursive: true }); fs.writeFileSync(c.file, c.content); }
    say("  " + (c.label + ":").padEnd(13) + rel(c.file));
    say("               - " + c.note);
  }
  say();
  if (DRY) { say("Run it again without --dry-run to apply."); say(); return; }
  say("Done. One step left, in Supabase (once), so the email shows the code:");
  say("  1. Open your project at supabase.com > Authentication > Emails (Email Templates).");
  say("  2. Pick Reset Password. In the message, add this line where you want the code:");
  say("       <h2>{{ .Token }}</h2>");
  say("     (You can change the subject to \"Your AURA password reset code\".) Click Save.");
  say("Then restart AURA (stop it in the terminal and start it again).");
  if (hasChecks) say("Run  npm test  before your next release.");
  say("To undo later:  node aura-reset-password-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
