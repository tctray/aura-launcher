// The feedback form (Settings > About > Send feedback).
//
// Opens the built window (dist) in a real browser with a pretend desktop side and a stand-in for
// Web3Forms, so NOTHING IS REALLY SENT: no email goes out and none of the monthly allowance is
// used. It checks that:
//   - the button is in Settings and opens the form
//   - Send only works once there is a real message
//   - what is sent is the message, its kind, the AURA username and version, and a reply
//     address only if one was typed. Nothing else.
//   - a message that can't be sent is kept, with a plain reason and a way to copy it
//   - closing the form by accident doesn't lose what was typed
//   - one PC can't use up the whole allowance in a day
//   - no email address is written into the feedback code
// Added by aura-feedback-setup.cjs.
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const WEB3FORMS = "https://api.web3forms.com/submit";
const KEY_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff" };
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok || extra === undefined ? "" : "\n          " + (typeof extra === "string" ? extra : JSON.stringify(extra)))); };
const note = (text) => console.log("  note  " + text);
const done = (code) => { console.log(code === 0 ? "\nall passed" : code === 3 ? "\nskipped" : `\n${failed} FAILED`); process.exit(code); };
const read = (...parts) => { try { return fs.readFileSync(path.join(ROOT, ...parts), "utf8"); } catch { return ""; } };

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

  // Start AURA logged in as "tester". `web3forms.answer` decides how the stand-in replies.
  async function start({ sentBefore = 0 } = {}) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
    try { await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base }); } catch {}
    const page = await context.newPage();
    const thrown = [];
    page.on("pageerror", (e) => thrown.push(String(e.message || e).split("\n")[0]));
    const web3forms = { answer: "ok", got: [] };
    const open = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());
    await page.route(WEB3FORMS, async (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: open });
      let body = null;
      try { body = JSON.parse(request.postData() || "null"); } catch {}
      web3forms.got.push({ method: request.method(), type: request.headers()["content-type"] || "", body });
      if (web3forms.answer === "cut") return route.abort("internetdisconnected");
      if (web3forms.answer === "busy") return route.fulfill({ status: 429, headers: open, contentType: "application/json", body: JSON.stringify({ success: false, message: "Too many requests. Please try later!" }) });
      if (web3forms.answer === "down") return route.fulfill({ status: 500, headers: open, contentType: "text/html", body: "<html><style>:root{--a:#07354a}</style><h1>500</h1></html>" });
      if (web3forms.answer === "no") return route.fulfill({ status: 400, headers: open, contentType: "application/json", body: JSON.stringify({ success: false, message: "Invalid access key" }) });
      return route.fulfill({ status: 200, headers: open, contentType: "application/json", body: JSON.stringify({ success: true, message: "Email sent successfully!", data: body }) });
    });
    await page.addInitScript(({ sentBefore }) => {
      try {
        localStorage.clear();
        localStorage.setItem("aura_profile", JSON.stringify({ username: "tester", avatar: "", userId: "user-1" }));
        if (sentBefore) localStorage.setItem("aura_feedback_sent", JSON.stringify(Array.from({ length: sentBefore }, (_x, i) => Date.now() - (i + 1) * 60000)));
      } catch {}
      const ok = (data) => Promise.resolve({ success: true, data });
      const account = { getSession: () => ok({ id: "user-1", email: "me@example.com" }), getMyProfile: () => ok({ username: "tester", avatar_url: null }), saveProfile: (name, picture) => ok({ username: name, avatar_url: picture || null }) };
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (name === "auraCloud" && account[key]) ? account[key](...args) : ok(null)) });
      window.auraCloud = fake("auraCloud");
      window.auraSocial = fake("auraSocial");
      const desktop = { checkUpdate: () => Promise.resolve({ success: true, current: "1.16.1", latest: "1.16.1", hasUpdate: false }) };
      window.electronAPI = new Proxy({}, {
        get: (_t, key) => {
          if (key === "isElectron") return true;
          if (typeof key !== "string" || key === "then") return undefined;
          if (/^on[A-Z]/.test(key)) return () => () => {};
          if (/^remove/.test(key)) return () => {};
          return (...args) => (desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }));
        },
      });
    }, { sentBefore });
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(4500);
    await page.locator('.gm-rail-item[title="Settings"], .sb-item[title="Settings"]').first().click({ timeout: 5000 });
    await page.waitForTimeout(900);
    const button = page.getByRole("button", { name: "Send feedback", exact: true });
    const form = page.locator(".fb");
    const openForm = async () => { await button.scrollIntoViewIfNeeded({ timeout: 5000 }); await button.click({ timeout: 4000 }); await page.waitForTimeout(450); };
    const write = async (text) => { await page.locator("#fb-text").fill(text); await page.waitForTimeout(120); };
    const send = async () => { await form.getByRole("button", { name: "Send", exact: true }).click({ timeout: 4000 }); await page.waitForTimeout(700); };
    const state = () => page.evaluate(() => {
      const box = document.querySelector(".fb");
      if (!box) return null;
      const tick = box.querySelector(".fb-tick");
      return {
        title: box.querySelector("#fb-title")?.textContent.trim() || "",
        kinds: [...box.querySelectorAll(".fb-kind")].map((b) => b.textContent.trim() + (b.getAttribute("aria-checked") === "true" ? "*" : "")),
        text: box.querySelector("#fb-text")?.value ?? null,
        reply: box.querySelector("#fb-reply")?.value ?? null,
        ask: box.querySelector("#fb-text")?.getAttribute("placeholder") || "",
        focused: document.activeElement?.id || "",
        canSend: [...box.querySelectorAll("button")].some((b) => b.textContent.trim() === "Send" && !b.disabled),
        problem: box.querySelector(".fb-problem span")?.textContent.trim() || "",
        copy: box.querySelector(".fb-copy")?.textContent.trim() || "",
        note: box.querySelector(".fb-note")?.textContent.trim() || "",
        tick: tick ? getComputedStyle(tick).color : "",
        heading: getComputedStyle(box.querySelector("#fb-title")).color,
        all: box.innerText,
      };
    });
    return { page, thrown, web3forms, button, form, openForm, write, send, state };
  }
  const light = (colour) => { const [r, g, b] = (String(colour).match(/\d+/g) || []).map(Number); return r > 200 && g > 200 && b > 200; };
  const green = (colour) => { const [r, g, b] = (String(colour).match(/\d+/g) || []).map(Number); return g > 150 && g > r + 60 && g > b + 60; };
  const CODE = /[<>{}]|:root|--a|<\/?\w/;
  const source = read("src", "components", "feedback.jsx");
  const key = (source.match(/const FEEDBACK_FORM = "([^"]*)";/) || [])[1] || "";

  try {
    console.log("1. The button and the form");
    let app = await start();
    const row = await app.page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Send feedback");
      const r = b?.closest(".sr");
      const card = r?.closest(".ss-card");
      let title = card?.previousElementSibling;
      return r ? { label: r.querySelector(".sr-l")?.textContent.trim(), about: title?.textContent.trim() } : null;
    });
    check("Settings > About has a Feedback row with a \"Send feedback\" button", !!row && row.label === "Feedback" && row.about === "ABOUT", row);
    check("nothing is sent just by opening Settings", app.web3forms.got.length === 0);
    await app.openForm();
    let s = await app.state();
    check("the button opens the form", !!s && s.title === "Send feedback", s && s.all);
    check("its title is light on the dark panel (also on a PC set to light mode)", !!s && light(s.heading), s && s.heading);
    check("it asks what kind of feedback it is: a bug, an idea or something else", !!s && s.kinds.join("|") === "A bug*|An idea|Something else", s && s.kinds);
    check("the message box is ready to type in", !!s && s.focused === "fb-text" && /What happened/.test(s.ask), s && [s.focused, s.ask]);
    check("it says what is sent along with the message", !!s && /your AURA username \(tester\)/.test(s.note) && /version of AURA/.test(s.note), s && s.note);
    check("Send is off while there is no message", !!s && !s.canSend);
    await app.write("hi");
    check("and stays off for a message too short to mean anything", !(await app.state()).canSend);
    await app.write("The clips page froze when I pressed Trim on a long clip.");
    check("Send comes on once there is a real message", (await app.state()).canSend);
    check("nothing has been sent yet", app.web3forms.got.length === 0);

    console.log("2. Sending");
    await app.send();
    let got = app.web3forms.got[0];
    check("pressing Send sends it once, to Web3Forms", app.web3forms.got.length === 1 && !!got && got.method === "POST" && /application\/json/.test(got.type), app.web3forms.got);
    const b = (got && got.body) || {};
    check("with AURA's access key", KEY_SHAPE.test(key) && b.access_key === key, [b.access_key, key]);
    check("the message, and that it is a bug", b.message === "The clips page froze when I pressed Trim on a long clip." && b.type === "A bug", b);
    check("the AURA username and version", b.username === "tester" && b.aura_version === "1.16.1", b);
    check("a subject that reads properly in an inbox", b.subject === "AURA feedback: a bug from tester" && b.from_name === "AURA feedback", b);
    check("no reply address, because none was typed", !("email" in b), b);
    check("and nothing else", Object.keys(b).sort().join(",") === "access_key,aura_version,from_name,message,subject,type,username", Object.keys(b));
    s = await app.state();
    check("then it says the feedback was sent, with a green check mark", !!s && s.title === "Feedback sent" && green(s.tick) && s.text === null, s);
    await app.form.getByRole("button", { name: "Close", exact: true }).click({ timeout: 4000 });
    await app.page.waitForTimeout(300);
    check("Close puts the form away", (await app.state()) === null);
    await app.openForm();
    s = await app.state();
    check("the next time, the form is empty again", !!s && s.text === "" && !s.canSend, s);

    await app.form.getByRole("radio", { name: "An idea", exact: true }).click({ timeout: 4000 });
    await app.write("It would be great to sort the library by last played.");
    await app.page.locator("#fb-reply").fill("not an address");
    await app.send();
    s = await app.state();
    check("a reply address that isn't one is caught before anything is sent", !!s && /email address doesn't look right/.test(s.problem) && app.web3forms.got.length === 1 && s.copy === "", s && s.problem);
    await app.page.locator("#fb-reply").fill("  someone@example.com ");
    await app.send();
    got = app.web3forms.got[1];
    check("an idea with a reply address: both are sent", app.web3forms.got.length === 2 && !!got && got.body.type === "An idea" && got.body.email === "someone@example.com" && /sort the library/.test(got.body.message), got);
    check("and it says it was sent", (await app.state()).title === "Feedback sent");
    check("nothing crashed along the way", (await app.page.locator(".aura-fallback").count()) === 0 && app.thrown.length === 0, app.thrown);
    await app.page.context().close();

    console.log("3. When it can't be sent");
    app = await start();
    await app.openForm();
    const words = "Voice calls drop after about ten minutes on my PC.";
    await app.write(words);
    app.web3forms.answer = "down";
    await app.send();
    s = await app.state();
    check("the service is down: a plain reason, and none of its error page", !!s && s.problem === "Couldn't send it right now. Try again later." && !CODE.test(s.problem), s && s.problem);
    check("the message is still there, and Send can be pressed again", !!s && s.text === words && s.canSend, s);
    check("with a way to copy the message", !!s && s.copy === "Copy my message", s && s.copy);
    await app.form.locator(".fb-copy").click({ timeout: 4000 });
    await app.page.waitForTimeout(300);
    const copied = await app.page.evaluate(() => navigator.clipboard.readText().catch(() => null));
    if (copied === null) note("this browser doesn't let the check read the clipboard, so the copy wasn't checked");
    else check("which copies it", copied === words && (await app.state()).copy === "Copied", copied);
    app.web3forms.answer = "busy";
    await app.send();
    s = await app.state();
    check("the service is busy: it says to try again in a few minutes", !!s && /busy right now\. Try again in a few minutes\./.test(s.problem) && s.text === words, s && s.problem);
    app.web3forms.answer = "no";
    await app.send();
    s = await app.state();
    check("the service says no: it isn't counted as sent", !!s && s.title === "Send feedback" && /Couldn't send it right now/.test(s.problem), s && s.problem);
    app.web3forms.answer = "cut";
    await app.send();
    s = await app.state();
    check("no internet: it says to check the connection", !!s && /Check your internet connection and try again\./.test(s.problem) && s.text === words, s && s.problem);
    app.web3forms.answer = "ok";
    await app.send();
    s = await app.state();
    check("and when it works again, the same message goes through", !!s && s.title === "Feedback sent" && app.web3forms.got.length === 5 && app.web3forms.got[4].body.message === words, s && s.title);
    const counted = await app.page.evaluate(() => JSON.parse(localStorage.getItem("aura_feedback_sent") || "[]").length);
    check("only the one that went through counts toward the day's limit", counted === 1, counted);
    await app.page.context().close();

    console.log("4. Not losing what was typed");
    app = await start();
    await app.openForm();
    await app.form.getByRole("radio", { name: "Something else", exact: true }).click({ timeout: 4000 });
    await app.write("Half a thought about the Home page");
    await app.page.keyboard.press("Escape");
    await app.page.waitForTimeout(300);
    check("Esc closes the form", (await app.state()) === null);
    check("and leaves you in Settings", await app.button.isVisible());
    await app.openForm();
    s = await app.state();
    check("opening it again brings back what was typed", !!s && s.text === "Half a thought about the Home page" && s.kinds.join("|") === "A bug|An idea|Something else*", s);
    await app.form.getByRole("button", { name: "Cancel", exact: true }).click({ timeout: 4000 });
    await app.page.waitForTimeout(300);
    check("Cancel closes it without sending", (await app.state()) === null && app.web3forms.got.length === 0);
    await app.page.context().close();

    console.log("5. One PC can't use up the allowance");
    app = await start({ sentBefore: 10 });
    await app.openForm();
    await app.write("An eleventh message in one day, which is plenty.");
    await app.send();
    s = await app.state();
    check("after 10 in a day it says to send more tomorrow, and sends nothing", !!s && /You can send more tomorrow\./.test(s.problem) && app.web3forms.got.length === 0, s && s.problem);
    await app.page.context().close();
    app = await start({ sentBefore: 9 });
    await app.openForm();
    await app.write("A tenth message in one day is still fine.");
    await app.send();
    check("the tenth still goes", (await app.state()).title === "Feedback sent" && app.web3forms.got.length === 1);
    await app.page.context().close();

    console.log("6. The code");
    check("the feedback code is there (src/components/feedback.jsx)", source.length > 2000);
    check("it holds a Web3Forms access key", KEY_SHAPE.test(key), key ? "what is there isn't shaped like a key. Run  node aura-feedback-setup.cjs --key=YOUR-KEY" : "no key found");
    const addresses = (source.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).filter((a) => !/@example\.com$/i.test(a));
    check("no email address is written into it (Web3Forms keeps the address, not AURA)", addresses.length === 0, addresses.map((a) => a.replace(/^(.).*(@.*)$/, "$1…$2")));
    const sites = [...new Set((source.match(/https?:\/\/[^\s"'`)]+/g) || []))];
    check("the only place it sends to is Web3Forms", sites.length === 1 && sites[0] === WEB3FORMS, sites);
    const inApp = read("src", "components", "privacy.jsx"), onGitHub = read("PRIVACY.md");
    if (!inApp && !onGitHub) note("the privacy policy isn't in this project, so it wasn't checked");
    else {
      const says = (text) => /Web3Forms: if you send feedback from Settings/.test(text) && /Nothing is sent unless you press Send/.test(text);
      check("the privacy policy says what sending feedback shares, in AURA and on GitHub", (!inApp || says(inApp)) && (!onGitHub || says(onGitHub)));
    }
  } finally {
    await browser.close();
    server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The feedback check itself broke:", e); process.exit(2); });
