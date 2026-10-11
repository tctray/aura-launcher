// Videos pop out of the Social browser.
//
// When a video with sound is playing in the Browser tab and you go somewhere else in AURA, AURA
// asks the browser to show the video in its own small window (picture-in-picture), and to put it
// back when you return. This opens the built window (dist) in a real browser with a pretend
// Browser tab, and checks when AURA asks, and that asking is all it does:
//   - only the Browser tab, only for a video playing with sound, only when the button is on
//   - back in the page when you return
//   - "Back to tab" on the small window brings you to the video; closing it changes nothing
//   - the snippets AURA runs in the page only ask for the small window; they change nothing
// Added by aura-video-popout-setup.cjs.
"use strict";
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

console.log("1. What AURA runs in the page");
const source = (() => { try { return fs.readFileSync(path.join(ROOT, "src", "components", "social.jsx"), "utf8"); } catch { return ""; } })();
const snippet = (name) => (source.match(new RegExp("const " + name + " = `([\\s\\S]*?)`;")) || [])[1] || "";
const snippets = { POP_OUT: snippet("POP_OUT"), POP_IN: snippet("POP_IN"), POP_WHERE: snippet("POP_WHERE") };
check("found the three snippets in the Social page", Object.values(snippets).every(Boolean), Object.keys(snippets).filter((k) => !snippets[k]).join(", "));
check("popping out is the browser's own picture-in-picture", /\.requestPictureInPicture\(\)/.test(snippets.POP_OUT) && /document\.exitPictureInPicture\(\)/.test(snippets.POP_IN));
// Nothing here may change the page: no hiding, removing, muting, clicking, seeking or skipping
const CHANGES = /\.style\b|\.remove\(|\.click\(|innerHTML|outerHTML|insertAdjacent|appendChild|createElement|\.muted\s*=|\.volume\s*=|\.currentTime\s*=|playbackRate|\.pause\(|\.play\(|\.src\s*=|setAttribute|classList|localStorage|cookie|fetch\(|XMLHttpRequest|location\b/;
const changing = Object.entries(snippets).filter(([, code]) => CHANGES.test(code)).map(([name, code]) => name + ": " + code.match(CHANGES)[0]);
check("the snippets change nothing in the page (they only ask where the video is shown)", !changing.length, changing.join("\n"));
check("a video that says it must not be popped out is left alone", /disablePictureInPicture/.test(snippets.POP_OUT));
const runs = [...source.matchAll(/executeJavaScript\(([^)]*)\)/g)].map((m) => m[1].trim());
check("those snippets are the only thing AURA runs in a page", runs.length > 0 && runs.every((r) => /^code\b/.test(r)) && [...source.matchAll(/inPage\(([A-Z_]+)/g)].every((m) => m[1] in snippets), runs);

(async () => {
  if (!fs.existsSync(path.join(DIST, "index.html"))) { check("the window has been built (dist/index.html)", false, "Run  npm run build  first."); return done(1); }
  let chromium;
  try { ({ chromium } = require("playwright")); } catch { note("the test browser isn't installed here"); return done(failed ? 1 : process.env.CI ? 1 : 3); }
  let browser = null;
  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: "msedge" }, { channel: "chrome" }]) {
    try { browser = await chromium.launch(options); break; } catch {}
  }
  if (!browser) { note("no browser to test with. Run  npx playwright install chromium  once to add one."); return done(failed ? 1 : process.env.CI ? 1 : 3); }

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

  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    const thrown = [];
    page.on("pageerror", (e) => thrown.push(String(e.message || e).split("\n")[0]));
    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());
    await page.addInitScript(() => {
      try { localStorage.clear(); localStorage.setItem("aura_profile", JSON.stringify({ username: "tester", avatar: "", userId: "user-1" })); } catch {}
      const ok = (data) => Promise.resolve({ success: true, data });
      const account = { getSession: () => ok({ id: "user-1", email: "me@example.com" }), getMyProfile: () => ok({ username: "tester", avatar_url: null }), saveProfile: (name, picture) => ok({ username: name, avatar_url: picture || null }) };
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (name === "auraCloud" && account[key]) ? account[key](...args) : ok(null)) });
      window.auraCloud = fake("auraCloud");
      window.auraSocial = fake("auraSocial");
      window.electronAPI = new Proxy({}, {
        get: (_t, key) => {
          if (key === "isElectron") return true;
          if (typeof key !== "string" || key === "then") return undefined;
          if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};
          return () => Promise.resolve({ success: false });
        },
      });
      // A pretend page in each Social tab. In the desktop app these are real embedded pages; here
      // they answer the same questions AURA asks them, and note down what was asked.
      window.__video = { sound: false, playing: false, out: false }; // the Browser tab's video
      window.__asked = [];
      const tabOf = (el) => (el.getAttribute("partition") || "").replace("persist:social-", "");
      const give = (name, fn) => { HTMLElement.prototype[name] = fn; };
      give("isCurrentlyAudible", function () { return tabOf(this) === "browser" && window.__video.sound; });
      give("executeJavaScript", function (code, asUser) {
        const kind = /requestPictureInPicture/.test(code) ? "out" : /exitPictureInPicture/.test(code) ? "in" : "where";
        window.__asked.push({ tab: tabOf(this), kind, asUser: !!asUser });
        const v = window.__video;
        if (kind === "out") { if (!v.playing) return Promise.resolve("none"); v.out = true; return Promise.resolve("out"); }
        if (kind === "in") { v.out = false; return Promise.resolve("in"); }
        return Promise.resolve(v.out ? "out" : v.playing ? "page" : "idle");
      });
      give("canGoBack", () => false);
      give("canGoForward", () => false);
      give("getURL", function () { return this.__url || "about:blank"; });
      give("getTitle", () => "A video site");
      give("reload", () => {});
      give("loadURL", function (url) { this.__url = url; this.dispatchEvent(new Event("did-navigate")); this.dispatchEvent(new Event("did-stop-loading")); return Promise.resolve(); });
    });
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(4500);
    const menu = async (name) => { await page.locator(`.gm-rail-item[title="${name}"], .sb-item[title="${name}"]`).first().click({ timeout: 5000 }); await page.waitForTimeout(450); };
    const asked = () => page.evaluate(() => window.__asked);
    const forget = () => page.evaluate(() => { window.__asked = []; });
    const video = (state) => page.evaluate((s) => Object.assign(window.__video, s), state);
    const onBrowserTab = () => page.locator('input[aria-label="Address"]').isVisible();
    const only = (list, kind) => list.filter((a) => a.kind === kind);

    console.log("2. Leaving while a video plays with sound");
    await menu("Social");
    await page.getByRole("tab", { name: "Browser" }).click({ timeout: 5000 });
    await page.waitForTimeout(300);
    await page.getByText("YouTube", { exact: true }).first().click({ timeout: 5000 }); // a quick link on the start page
    await page.waitForTimeout(500);
    check("the Browser tab has a button for popping videos out, and it starts on", (await page.locator(".popout-toggle").getAttribute("aria-pressed")) === "true");
    await video({ sound: true, playing: true });
    await forget();
    await menu("Library");
    let list = await asked();
    check("the video is asked to pop out", only(list, "out").length === 1, list);
    check("it is asked the way a click would ask (browsers need that)", only(list, "out").every((a) => a.asUser), list);
    await page.waitForTimeout(1900);
    await menu("Settings");
    list = await asked();
    check("going on to other pages doesn't ask again", only(list, "out").length === 1 && only(list, "in").length === 0, list);

    console.log("3. Coming back");
    await forget();
    await menu("Social");
    list = await asked();
    check("back on the Browser tab, the video is put back in the page", only(list, "in").length === 1 && (await page.evaluate(() => window.__video.out)) === false, list);
    await forget();
    await page.waitForTimeout(1900);
    check("and AURA stops checking on it", (await asked()).length === 0, await asked());

    console.log("4. When it shouldn't pop out");
    await video({ sound: false, playing: true });
    await forget();
    await menu("Library");
    check("a video with no sound is left alone", only(await asked(), "out").length === 0, await asked());
    await menu("Social");
    await video({ sound: true, playing: true });
    await page.locator(".popout-toggle").click({ timeout: 4000 });
    check("the button turns it off", (await page.locator(".popout-toggle").getAttribute("aria-pressed")) === "false" && (await page.evaluate(() => localStorage.getItem("aura_video_popout"))) === "0");
    await forget();
    await menu("Library");
    check("turned off: nothing pops out", only(await asked(), "out").length === 0, await asked());
    await menu("Social");
    await page.locator(".popout-toggle").click({ timeout: 4000 });
    check("and on again", (await page.locator(".popout-toggle").getAttribute("aria-pressed")) === "true" && (await page.evaluate(() => localStorage.getItem("aura_video_popout"))) === "1");

    console.log("5. Other ways of leaving the page");
    await forget();
    await page.getByRole("tab", { name: "Instagram" }).click({ timeout: 5000 });
    await page.waitForTimeout(400);
    list = await asked();
    check("switching to another Social tab pops it out too", only(list, "out").length === 1, list);
    await page.getByRole("tab", { name: "Browser" }).click({ timeout: 5000 });
    await page.waitForTimeout(400);
    check("and coming back to the Browser tab puts it back", only(await asked(), "in").length === 1, await asked());
    await forget();
    await page.locator('button[aria-label="Home"]').click({ timeout: 4000 });
    await page.waitForTimeout(400);
    check("so does the browser's Home button, which covers the page with the start page", only(await asked(), "out").length === 1, await asked());
    await page.getByText("YouTube", { exact: true }).first().click({ timeout: 5000 });
    await page.waitForTimeout(400);

    console.log("6. The small window's own buttons");
    await video({ sound: true, playing: true, out: false });
    await menu("Library");
    await page.waitForTimeout(300);
    check("leaving again pops it out again", (await page.evaluate(() => window.__video.out)) === true);
    await video({ out: false }); // "Back to tab": the video is playing in the page again
    await page.waitForTimeout(2300);
    check("\"Back to tab\" brings you to the video in AURA", await onBrowserTab());
    await menu("Library");
    await page.waitForTimeout(300);
    await video({ out: false, playing: false, sound: false }); // closing the small window stops the video
    await page.waitForTimeout(2300);
    check("closing the small window leaves you where you are", !(await onBrowserTab()));
    await forget();
    await page.waitForTimeout(1900);
    check("and AURA stops checking on it", (await asked()).length === 0, await asked());

    console.log("7. Only the Browser tab");
    await menu("Social");
    await page.getByRole("tab", { name: "X", exact: true }).click({ timeout: 5000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => { window.__all = []; const run = HTMLElement.prototype.executeJavaScript; HTMLElement.prototype.executeJavaScript = function (...a) { window.__all.push((this.getAttribute("partition") || "")); return run.apply(this, a); }; });
    await menu("Library");
    await menu("Social");
    const touched = await page.evaluate(() => window.__all);
    check("Instagram, X and Facebook pages are never asked anything", touched.every((p) => p === "persist:social-browser"), touched);
    check("nothing crashed along the way", (await page.locator(".aura-fallback").count()) === 0, thrown);
  } finally {
    await browser.close();
    server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The pop-out check itself broke:", e); process.exit(2); });
