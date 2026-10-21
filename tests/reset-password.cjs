// Forgot password: the "Forgot password?" link, the Reset your password pages, and what AURA asks
// Supabase for. First with a pretend Supabase (no internet), then in the built window (dist) in a real
// browser with a pretend account system.
// Added by aura-reset-password-setup.cjs.
"use strict";
const Module = require("module");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff" };
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok || extra === undefined ? "" : "\n          " + (typeof extra === "string" ? extra : JSON.stringify(extra)))); };
const note = (text) => console.log("  note  " + text);
const done = (code) => { console.log(code === 0 ? "\nall passed" : code === 3 ? "\nskipped" : `\n${failed} FAILED`); process.exit(code); };

(async () => {
  if (!fs.existsSync(path.join(DIST, "index.html"))) { check("the window has been built (dist/index.html)", false, "Run  npm run build  first."); return done(1); }
  let chromium;
  try { ({ chromium } = require("playwright")); } catch { note("the test browser isn't installed here"); return done(process.env.CI ? 1 : 3); }
  let browser = null;
  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: "msedge" }, { channel: "chrome" }]) {
    try { browser = await chromium.launch(options); break; } catch {}
  }
  if (!browser) { note("no browser to test with. Run  npx playwright install chromium  once to add one."); return done(process.env.CI ? 1 : 3); }

  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path.join(DIST, url === "/" ? "index.html" : url);
    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
      res.end(data);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;

  // ── 1. What AURA asks Supabase for (electron/supabase.js, with a pretend Supabase) ──
  console.log("1. Asking Supabase");
  const asked = [];
  let session = null, verifyAnswer = null, updateAnswer = null;
  const fakeAuth = {
    resetPasswordForEmail: async (email) => { asked.push(["reset", email]); return { error: null }; },
    verifyOtp: async (o) => { asked.push(["verify", o]); if (verifyAnswer) return verifyAnswer; session = { user: { id: "u1", email: o.email, user_metadata: { username: "tester" } } }; return { data: { user: session.user, session }, error: null }; },
    updateUser: async (o) => { asked.push(["update", o]); if (updateAnswer) return updateAnswer; return { data: { user: session.user }, error: null }; },
    getSession: async () => ({ data: { session } }),
  };
  const realLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "electron") return { app: { getPath: () => require("os").tmpdir(), whenReady: async () => {} }, safeStorage: { isEncryptionAvailable: () => false } };
    if (request === "@supabase/supabase-js") return { createClient: () => ({ auth: fakeAuth }) };
    return realLoad.apply(this, arguments);
  };
  const cloud = require(path.join(ROOT, "electron", "supabase.js"));
  Module._load = realLoad;
  const fails = async (p) => { try { await p; return ""; } catch (e) { return e.message; } };
  check("sendResetCode refuses something that isn't an email", (await fails(cloud.sendResetCode("nope"))) === "invalid email" && asked.length === 0);
  await cloud.sendResetCode("  Me@Example.com ");
  check("and asks Supabase to email a code to the address", JSON.stringify(asked[0]) === JSON.stringify(["reset", "Me@Example.com"]), asked);
  check("a code that isn't numbers is refused before asking Supabase", (await fails(cloud.resetPasswordWithCode("me@example.com", "abc", "longenough"))) === "code format" && asked.length === 1);
  check("a short new password is refused", /at least 8/.test(await fails(cloud.resetPasswordWithCode("me@example.com", "123456", "short"))) && asked.length === 1);
  verifyAnswer = { data: null, error: { message: "Token has expired or is invalid" } };
  check("a wrong code: Supabase's answer comes back as the error", (await fails(cloud.resetPasswordWithCode("me@example.com", "111111", "longenough"))) === "Token has expired or is invalid" && !asked.some(([k]) => k === "update"));
  verifyAnswer = null;
  updateAnswer = { data: null, error: { message: "New password should be different from the old password." } };
  check("the right code, but the password can't be used: that's the error", /different from the old/.test(await fails(cloud.resetPasswordWithCode("me@example.com", " 123 456 ", "samepassword"))));
  const v = asked.filter(([k]) => k === "verify").pop();
  check("the code is checked with Supabase as a password-reset code (spaces removed)", !!v && v[1].token === "123456" && v[1].type === "recovery" && v[1].email === "me@example.com", v);
  updateAnswer = null;
  asked.length = 0;
  const user = await cloud.resetPasswordWithCode("me@example.com", "", "anotherpassword");
  check("trying again after that only sets the password (the code was already used)", !asked.some(([k]) => k === "verify") && asked.some(([k, o]) => k === "update" && o.password === "anotherpassword"), asked);
  check("and you're logged in", user && user.id === "u1" && user.username === "tester", user);
  session = null; asked.length = 0;
  const u2 = await cloud.resetPasswordWithCode("me@example.com", "654321", "brandnewpass");
  check("the whole thing in one go: code checked, password set", asked.map(([k]) => k).join(",") === "verify,update" && u2.email === "me@example.com", asked);

  // ── 2. The pages ──
  try {
    const page = await (await browser.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
    const thrown = [];
    page.on("pageerror", (e) => thrown.push(String(e.message || e).split("\n")[0]));
    await page.route((url) => !String(url).startsWith(base) && !String(url).startsWith("data:"), (route) => route.abort());
    await page.addInitScript(() => {
      try { localStorage.clear(); } catch {}
      window.__calls = [];
      window.__signedIn = null;
      window.__resetAnswers = [];
      const ok = (data) => Promise.resolve({ success: true, data });
      const no = (error) => Promise.resolve({ success: false, error });
      const account = {
        getSession: () => ok(window.__signedIn),
        getMyProfile: () => ok(window.__signedIn ? { username: "tester", avatar_url: null } : null),
        sendResetCode: () => ok(true),
        resetPasswordWithCode: () => { const a = window.__resetAnswers.shift(); if (a && a.error) return no(a.error); window.__signedIn = { id: "u1", email: "me@example.com", username: "tester" }; return ok(window.__signedIn); },
        logOut: () => { window.__signedIn = null; return ok(true); },
      };
      window.auraCloud = new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => { window.__calls.push([key, args]); return account[key] ? account[key](...args) : ok(null); }) });
      window.auraSocial = new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : () => ok(null)) });
      window.electronAPI = new Proxy({}, { get: (_t, k) => (k === "isElectron" ? true : typeof k !== "string" || k === "then" ? undefined : /^(on[A-Z]|remove)/.test(k) ? () => () => {} : () => Promise.resolve({ success: false })) });
    });
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(3000);
    const called = (name) => page.evaluate((n) => window.__calls.filter(([k]) => k === n).map(([, a]) => a), name);
    const msg = () => page.locator(".auth-msg").allInnerTexts().then((x) => x.join(" | "));
    const forgot = page.locator(".auth-forgot-row .auth-link");

    console.log("2. The Forgot password? link");
    check("the Log in page has a Forgot password? link", (await forgot.count()) === 1 && (await forgot.innerText()) === "Forgot password?");
    await page.locator(".auth-seg button", { hasText: "Sign up" }).click();
    check("Sign up doesn't show it", (await forgot.count()) === 0);
    await page.locator(".auth-seg button", { hasText: "Log in" }).click();
    await page.locator("#auth-email").fill("me@example.com");
    await forgot.click();
    check("it opens Reset your password, with the email already filled in", (await page.locator(".auth-title").innerText()) === "Reset your password" && (await page.locator("#auth-reset-email").inputValue()) === "me@example.com");

    console.log("3. Asking for a code");
    await page.locator("#auth-reset-email").fill("not an email");
    await page.locator(".auth-btn", { hasText: "Send code" }).click();
    check("a mistyped email is explained (and nothing is sent)", /Enter the email you use for AURA/.test(await msg()) && (await called("sendResetCode")).length === 0);
    await page.locator("#auth-reset-email").fill("me@example.com");
    await page.locator(".auth-btn", { hasText: "Send code" }).click();
    await page.waitForTimeout(400);
    check("Send code asks for a code for that email", JSON.stringify(await called("sendResetCode")) === JSON.stringify([["me@example.com"]]));
    check("then: Check your email, without saying whether the account exists", (await page.locator(".auth-title").innerText()) === "Check your email" && /If me@example.com has an AURA account/.test(await page.locator(".auth-text").innerText()));
    check("Send another waits a minute first", await page.locator(".auth-link", { hasText: /Send another in \d+s/ }).isDisabled());

    console.log("4. The code and a new password");
    await page.locator("#auth-reset-code").fill("12ab34");
    check("the code box only takes numbers", (await page.locator("#auth-reset-code").inputValue()) === "1234");
    await page.locator("#auth-reset-password").fill("longenough");
    await page.locator(".auth-btn", { hasText: "Set new password" }).click();
    check("a code that's too short is explained", /Enter the code from the email/.test(await msg()) && (await called("resetPasswordWithCode")).length === 0);
    await page.locator("#auth-reset-code").fill("123456");
    await page.locator("#auth-reset-password").fill("short");
    await page.locator(".auth-btn", { hasText: "Set new password" }).click();
    check("a short password is explained", /at least 8 characters/.test(await msg()));
    await page.evaluate(() => { window.__resetAnswers.push({ error: "Token has expired or is invalid" }); });
    await page.locator("#auth-reset-password").fill("longenough");
    await page.locator(".auth-btn", { hasText: "Set new password" }).click();
    await page.waitForTimeout(400);
    check("a wrong or old code is explained in plain words", /That code is wrong or has expired/.test(await msg()), await msg());
    await page.evaluate(() => { window.__resetAnswers.push({ error: "New password should be different from the old password." }); });
    await page.locator(".auth-btn", { hasText: "Set new password" }).click();
    await page.waitForTimeout(400);
    check("reusing the old password is explained", /haven't used for AURA before/.test(await msg()), await msg());
    await page.locator("#auth-reset-password").fill("brandnewpass");
    await page.locator(".auth-btn", { hasText: "Set new password" }).click();
    const inApp = await page.waitForSelector(".sb, .gm-rail", { timeout: 8000 }).then(() => true).catch(() => false);
    check("the right code and a new password: you're logged in to AURA", inApp && (await page.locator(".auth").count()) === 0);
    const sent = (await called("resetPasswordWithCode")).pop();
    check("with that email, code and new password", JSON.stringify(sent) === JSON.stringify(["me@example.com", "123456", "brandnewpass"]), sent);

    console.log("5. Going back");
    const p2 = await (await browser.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
    await p2.route((url) => !String(url).startsWith(base) && !String(url).startsWith("data:"), (route) => route.abort());
    await p2.addInitScript(() => {
      window.__calls = [];
      const ok = (data) => Promise.resolve({ success: true, data });
      window.auraCloud = new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => { window.__calls.push([key, args]); return key === "resetPasswordWithCode" ? Promise.resolve({ success: false, error: "Password should be at least 12 characters" }) : ok(null); }) });
      window.auraSocial = new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : () => ok(null)) });
      window.electronAPI = new Proxy({}, { get: (_t, k) => (k === "isElectron" ? true : typeof k !== "string" || k === "then" ? undefined : /^(on[A-Z]|remove)/.test(k) ? () => () => {} : () => Promise.resolve({ success: false })) });
    });
    await p2.goto(base + "/index.html", { waitUntil: "load" });
    await p2.waitForTimeout(3000);
    await p2.locator(".auth-forgot-row .auth-link").click();
    await p2.locator(".auth-alt .auth-link", { hasText: "Log in" }).click();
    check("Remembered it? Log in goes back to Log in", (await p2.locator(".auth-seg").count()) === 1 && (await p2.locator(".auth-forgot-row").count()) === 1);
    await p2.locator(".auth-forgot-row .auth-link").click();
    await p2.locator("#auth-reset-email").fill("me@example.com");
    await p2.locator(".auth-btn", { hasText: "Send code" }).click();
    await p2.locator("#auth-reset-code").fill("123456");
    await p2.locator("#auth-reset-password").fill("longenough");
    await p2.locator(".auth-btn", { hasText: "Set new password" }).click();
    await p2.waitForTimeout(400);
    check("a password Supabase finds too weak is explained", /too easy to guess/.test(await p2.locator(".auth-msg").allInnerTexts().then((x) => x.join(" "))));
    await p2.locator(".auth-alt .auth-link", { hasText: "Back to log in" }).click();
    await p2.waitForTimeout(400);
    check("leaving after the code was accepted logs you back out (no half-reset login left behind)", (await p2.evaluate(() => window.__calls.some(([k]) => k === "logOut"))) && (await p2.locator(".auth-seg").count()) === 1);
    check("the email is still filled in on Log in", (await p2.locator("#auth-email").inputValue()) === "me@example.com");

    check("nothing crashed along the way", thrown.length === 0, thrown);
  } finally {
    await browser.close();
    server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The forgot password check itself broke:", e); process.exit(2); });
