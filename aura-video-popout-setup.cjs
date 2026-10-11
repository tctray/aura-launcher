#!/usr/bin/env node
/**
 * AURA — videos pop out of the Social browser
 *
 * When a video with sound is playing in the Social page's Browser tab (YouTube, for example)
 * and you go to another page in AURA, the video pops out into a small window that stays on top
 * and keeps playing. Come back to the Browser tab and it goes back into the page.
 *
 *   - The small window is the browser's own picture-in-picture window, the same one Chrome and
 *     Edge have. You can move it, resize it, pause it, or close it (closing stops the video).
 *   - Its "Back to tab" button takes you back to the video in AURA.
 *   - A new button in the Browser tab's toolbar turns this on and off. It starts on.
 *   - Only the Browser tab does this, and only for a video that is playing with sound.
 *   - AURA doesn't change the page: nothing is hidden, blocked or muted, and ads play as usual.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-video-popout-setup.cjs
 *   4. Then:  npm test
 *
 * What it does:
 *   - edits    src/components/social.jsx    the pop-out and its toolbar button
 *   - edits    src/App.jsx                  one line, so "Back to tab" can open the Social page
 *   - creates  tests/video-popout.cjs       (only if AURA's checks are installed) checks it
 *   - edits    tests/run.cjs                (same) so npm test runs it
 *
 * Every file it changes is copied to <name>.before-video-popout.bak first.
 * To put everything back:                 node aura-video-popout-setup.cjs --undo
 * To preview without changing anything:   node aura-video-popout-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const EDITS = [{"kind":"insert","file":"social","label":"a video playing with sound in the Browser tab pops out into a small window when you leave, and goes back when you return","done":"const POPOUT_KEY = \"aura_video_popout\";","aheadOf":"// Turn what's typed in the address bar into a URL (or a Google search)","text":"// ── Pop-out video (Browser tab) ───────────────────────────────────────────────\n// Added by aura-video-popout-setup.cjs.\n// When a video with sound is playing in the Browser tab and you go somewhere else in AURA, the\n// video pops out into the browser's own picture-in-picture window (the same one Chrome and Edge\n// have), so it keeps playing where you can see it. Coming back puts it back in the page.\n//\n// These three snippets are everything AURA runs in the page. They ask the browser to show the\n// video in its own window, to put it back, or where it is now. The page itself is left exactly\n// as it is: nothing is hidden, blocked, muted or changed, and ads play as they normally would.\n// A video that says it must not be popped out is left alone.\nconst POPOUT_KEY = \"aura_video_popout\";\nconst POP_OUT = `(async () => {\n  try {\n    if (!document.pictureInPictureEnabled) return \"unsupported\";\n    if (document.pictureInPictureElement) return \"out\";\n    const playing = [...document.querySelectorAll(\"video\")].filter((v) => !v.paused && !v.ended && v.readyState > 2 && !v.muted && v.volume > 0 && !v.disablePictureInPicture);\n    playing.sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight);\n    if (!playing.length) return \"none\";\n    await playing[0].requestPictureInPicture();\n    return \"out\";\n  } catch (e) { return \"failed\"; }\n})()`;\nconst POP_IN = `(async () => { try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); } catch (e) {} return \"in\"; })()`;\n// \"out\" = in its own window, \"page\" = playing in the page, \"idle\" = not playing\nconst POP_WHERE = `(() => {\n  if (document.pictureInPictureElement) return \"out\";\n  return [...document.querySelectorAll(\"video\")].some((v) => !v.paused && !v.ended && !v.muted && v.volume > 0) ? \"page\" : \"idle\";\n})()`;\n\n"},{"kind":"insert","file":"social","label":"a button in the Browser tab's toolbar turns the pop-out on and off","after":"more: (<><circle cx=\"12\" cy=\"5.5\" r=\"1\" />","done":"popout: (<>","text":"  popout: (<><rect x=\"3\" y=\"5\" width=\"18\" height=\"14\" rx=\"2\" /><rect x=\"12.5\" y=\"12\" width=\"6\" height=\"4.5\" rx=\"1\" fill=\"currentColor\" stroke=\"none\" /></>),\n"},{"kind":"replace","file":"social","label":"a video playing with sound in the Browser tab pops out into a small window when you leave, and goes back when you return","done":"export default function SocialPage({ visible = true, onShow }) {","before":"export default function SocialPage({ visible = true }) {","text":"export default function SocialPage({ visible = true, onShow }) {"},{"kind":"insert","file":"social","label":"a video playing with sound in the Browser tab pops out into a small window when you leave, and goes back when you return","after":"const reload = () => { try { wv?.reload(); } catch {} };","done":"const browserShowing = visible && isBrowser && !showStart;","text":"\n  // Pop-out video (see POP_OUT at the top). \"Showing\" means the Browser tab's page is on screen.\n  const [popOut, setPopOut] = useState(() => { try { return localStorage.getItem(POPOUT_KEY) !== \"0\"; } catch { return true; } });\n  const [popped, setPopped] = useState(false);\n  const browserShowing = visible && isBrowser && !showStart;\n  const wasShowing = useRef(browserShowing);\n  const inPage = (code, asUser = false) => {\n    const view = views.current.browser;\n    try { return view ? Promise.resolve(view.executeJavaScript(code, asUser)).catch(() => \"\") : Promise.resolve(\"\"); } catch { return Promise.resolve(\"\"); }\n  };\n  useEffect(() => {\n    const before = wasShowing.current;\n    wasShowing.current = browserShowing;\n    if (before === browserShowing) return;\n    if (browserShowing) { setPopped(false); inPage(POP_IN); return; }\n    if (!popOut) return;\n    let sound = false;\n    try { sound = !!views.current.browser?.isCurrentlyAudible(); } catch {}\n    // Leaving the page counts as asking for it: browsers only open that window on a person's say-so\n    if (sound) inPage(POP_OUT, true).then((where) => {\n      if (where !== \"out\") return;\n      if (wasShowing.current) inPage(POP_IN); // you were already back before it opened\n      else setPopped(true);\n    });\n  }, [browserShowing]);\n  // While it's out, notice when it comes back. \"Back to tab\" on the small window means \"show me\n  // the page\", so AURA opens it. Closing the small window stops the video, and nothing else happens.\n  useEffect(() => {\n    if (!popped) return;\n    const timer = setInterval(() => {\n      inPage(POP_WHERE).then((where) => {\n        if (where === \"out\" || wasShowing.current) return;\n        setPopped(false);\n        if (where === \"page\") { setBrowserHome(false); choose(\"browser\"); onShow?.(); }\n      });\n    }, 1500);\n    return () => clearInterval(timer);\n  }, [popped]);\n  const togglePopOut = () => {\n    const next = !popOut;\n    setPopOut(next);\n    try { localStorage.setItem(POPOUT_KEY, next ? \"1\" : \"0\"); } catch {}\n  };\n"},{"kind":"insert","file":"social","label":"a button in the Browser tab's toolbar turns the pop-out on and off","done":"className=\"popout-toggle\"","aheadOf":"<button style={tool} onClick={reload} title=\"Reload\" aria-label=\"Reload\"><Svg name=\"reload\" /></button>","text":"        {isBrowser && (\n          <button className=\"popout-toggle\" style={{ ...tool, color: popOut ? \"var(--ac)\" : \"var(--t2)\", background: popOut ? \"var(--card)\" : \"transparent\" }} onClick={togglePopOut} aria-pressed={popOut}\n                  title={popOut ? \"On: a video playing here pops out into a small window when you go to another page. Click to turn off.\" : \"Off: videos stay in the page when you go to another page. Click to pop them out into a small window.\"}\n                  aria-label=\"Pop videos out when you leave this page\">\n            <Svg name=\"popout\" />\n          </button>\n        )}\n"},{"kind":"replace","file":"app","label":"\"Back to tab\" on the small window opens the Social page","done":"<SocialPage visible={view===\"social\"} onShow={()=>goTo(\"social\")}/>","before":"<SocialPage visible={view===\"social\"}/>","text":"<SocialPage visible={view===\"social\"} onShow={()=>goTo(\"social\")}/>"},{"kind":"insert","file":"runner","label":"npm test now checks the pop-out","after":"add(\"window\", \"The window opens and every page loads\", \"window.cjs\");","done":"video-popout.cjs","text":"if (fs.existsSync(path.join(__dirname, \"video-popout.cjs\"))) add(\"window\", \"Videos pop out of the Social browser\", \"video-popout.cjs\");\n"}];
const FILES = {"popout":"// Videos pop out of the Social browser.\n//\n// When a video with sound is playing in the Browser tab and you go somewhere else in AURA, AURA\n// asks the browser to show the video in its own small window (picture-in-picture), and to put it\n// back when you return. This opens the built window (dist) in a real browser with a pretend\n// Browser tab, and checks when AURA asks, and that asking is all it does:\n//   - only the Browser tab, only for a video playing with sound, only when the button is on\n//   - back in the page when you return\n//   - \"Back to tab\" on the small window brings you to the video; closing it changes nothing\n//   - the snippets AURA runs in the page only ask for the small window; they change nothing\n// Added by aura-video-popout-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\n\nconsole.log(\"1. What AURA runs in the page\");\nconst source = (() => { try { return fs.readFileSync(path.join(ROOT, \"src\", \"components\", \"social.jsx\"), \"utf8\"); } catch { return \"\"; } })();\nconst snippet = (name) => (source.match(new RegExp(\"const \" + name + \" = `([\\\\s\\\\S]*?)`;\")) || [])[1] || \"\";\nconst snippets = { POP_OUT: snippet(\"POP_OUT\"), POP_IN: snippet(\"POP_IN\"), POP_WHERE: snippet(\"POP_WHERE\") };\ncheck(\"found the three snippets in the Social page\", Object.values(snippets).every(Boolean), Object.keys(snippets).filter((k) => !snippets[k]).join(\", \"));\ncheck(\"popping out is the browser's own picture-in-picture\", /\\.requestPictureInPicture\\(\\)/.test(snippets.POP_OUT) && /document\\.exitPictureInPicture\\(\\)/.test(snippets.POP_IN));\n// Nothing here may change the page: no hiding, removing, muting, clicking, seeking or skipping\nconst CHANGES = /\\.style\\b|\\.remove\\(|\\.click\\(|innerHTML|outerHTML|insertAdjacent|appendChild|createElement|\\.muted\\s*=|\\.volume\\s*=|\\.currentTime\\s*=|playbackRate|\\.pause\\(|\\.play\\(|\\.src\\s*=|setAttribute|classList|localStorage|cookie|fetch\\(|XMLHttpRequest|location\\b/;\nconst changing = Object.entries(snippets).filter(([, code]) => CHANGES.test(code)).map(([name, code]) => name + \": \" + code.match(CHANGES)[0]);\ncheck(\"the snippets change nothing in the page (they only ask where the video is shown)\", !changing.length, changing.join(\"\\n\"));\ncheck(\"a video that says it must not be popped out is left alone\", /disablePictureInPicture/.test(snippets.POP_OUT));\nconst runs = [...source.matchAll(/executeJavaScript\\(([^)]*)\\)/g)].map((m) => m[1].trim());\ncheck(\"those snippets are the only thing AURA runs in a page\", runs.length > 0 && runs.every((r) => /^code\\b/.test(r)) && [...source.matchAll(/inPage\\(([A-Z_]+)/g)].every((m) => m[1] in snippets), runs);\n\n(async () => {\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(failed ? 1 : process.env.CI ? 1 : 3); }\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch(options); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with. Run  npx playwright install chromium  once to add one.\"); return done(failed ? 1 : process.env.CI ? 1 : 3); }\n\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(DIST, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => {\n      if (err) { res.writeHead(404); return res.end(); }\n      res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" });\n      res.end(data);\n    });\n  });\n  await new Promise((r) => server.listen(0, \"127.0.0.1\", r));\n  const base = \"http://127.0.0.1:\" + server.address().port;\n\n  try {\n    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();\n    const thrown = [];\n    page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());\n    await page.addInitScript(() => {\n      try { localStorage.clear(); localStorage.setItem(\"aura_profile\", JSON.stringify({ username: \"tester\", avatar: \"\", userId: \"user-1\" })); } catch {}\n      const ok = (data) => Promise.resolve({ success: true, data });\n      const account = { getSession: () => ok({ id: \"user-1\", email: \"me@example.com\" }), getMyProfile: () => ok({ username: \"tester\", avatar_url: null }), saveProfile: (name, picture) => ok({ username: name, avatar_url: picture || null }) };\n      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => (name === \"auraCloud\" && account[key]) ? account[key](...args) : ok(null)) });\n      window.auraCloud = fake(\"auraCloud\");\n      window.auraSocial = fake(\"auraSocial\");\n      window.electronAPI = new Proxy({}, {\n        get: (_t, key) => {\n          if (key === \"isElectron\") return true;\n          if (typeof key !== \"string\" || key === \"then\") return undefined;\n          if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};\n          return () => Promise.resolve({ success: false });\n        },\n      });\n      // A pretend page in each Social tab. In the desktop app these are real embedded pages; here\n      // they answer the same questions AURA asks them, and note down what was asked.\n      window.__video = { sound: false, playing: false, out: false }; // the Browser tab's video\n      window.__asked = [];\n      const tabOf = (el) => (el.getAttribute(\"partition\") || \"\").replace(\"persist:social-\", \"\");\n      const give = (name, fn) => { HTMLElement.prototype[name] = fn; };\n      give(\"isCurrentlyAudible\", function () { return tabOf(this) === \"browser\" && window.__video.sound; });\n      give(\"executeJavaScript\", function (code, asUser) {\n        const kind = /requestPictureInPicture/.test(code) ? \"out\" : /exitPictureInPicture/.test(code) ? \"in\" : \"where\";\n        window.__asked.push({ tab: tabOf(this), kind, asUser: !!asUser });\n        const v = window.__video;\n        if (kind === \"out\") { if (!v.playing) return Promise.resolve(\"none\"); v.out = true; return Promise.resolve(\"out\"); }\n        if (kind === \"in\") { v.out = false; return Promise.resolve(\"in\"); }\n        return Promise.resolve(v.out ? \"out\" : v.playing ? \"page\" : \"idle\");\n      });\n      give(\"canGoBack\", () => false);\n      give(\"canGoForward\", () => false);\n      give(\"getURL\", function () { return this.__url || \"about:blank\"; });\n      give(\"getTitle\", () => \"A video site\");\n      give(\"reload\", () => {});\n      give(\"loadURL\", function (url) { this.__url = url; this.dispatchEvent(new Event(\"did-navigate\")); this.dispatchEvent(new Event(\"did-stop-loading\")); return Promise.resolve(); });\n    });\n    await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n    await page.waitForTimeout(4500);\n    const menu = async (name) => { await page.locator(`.gm-rail-item[title=\"${name}\"], .sb-item[title=\"${name}\"]`).first().click({ timeout: 5000 }); await page.waitForTimeout(450); };\n    const asked = () => page.evaluate(() => window.__asked);\n    const forget = () => page.evaluate(() => { window.__asked = []; });\n    const video = (state) => page.evaluate((s) => Object.assign(window.__video, s), state);\n    const onBrowserTab = () => page.locator('input[aria-label=\"Address\"]').isVisible();\n    const only = (list, kind) => list.filter((a) => a.kind === kind);\n\n    console.log(\"2. Leaving while a video plays with sound\");\n    await menu(\"Social\");\n    await page.getByRole(\"tab\", { name: \"Browser\" }).click({ timeout: 5000 });\n    await page.waitForTimeout(300);\n    await page.getByText(\"YouTube\", { exact: true }).first().click({ timeout: 5000 }); // a quick link on the start page\n    await page.waitForTimeout(500);\n    check(\"the Browser tab has a button for popping videos out, and it starts on\", (await page.locator(\".popout-toggle\").getAttribute(\"aria-pressed\")) === \"true\");\n    await video({ sound: true, playing: true });\n    await forget();\n    await menu(\"Library\");\n    let list = await asked();\n    check(\"the video is asked to pop out\", only(list, \"out\").length === 1, list);\n    check(\"it is asked the way a click would ask (browsers need that)\", only(list, \"out\").every((a) => a.asUser), list);\n    await page.waitForTimeout(1900);\n    await menu(\"Settings\");\n    list = await asked();\n    check(\"going on to other pages doesn't ask again\", only(list, \"out\").length === 1 && only(list, \"in\").length === 0, list);\n\n    console.log(\"3. Coming back\");\n    await forget();\n    await menu(\"Social\");\n    list = await asked();\n    check(\"back on the Browser tab, the video is put back in the page\", only(list, \"in\").length === 1 && (await page.evaluate(() => window.__video.out)) === false, list);\n    await forget();\n    await page.waitForTimeout(1900);\n    check(\"and AURA stops checking on it\", (await asked()).length === 0, await asked());\n\n    console.log(\"4. When it shouldn't pop out\");\n    await video({ sound: false, playing: true });\n    await forget();\n    await menu(\"Library\");\n    check(\"a video with no sound is left alone\", only(await asked(), \"out\").length === 0, await asked());\n    await menu(\"Social\");\n    await video({ sound: true, playing: true });\n    await page.locator(\".popout-toggle\").click({ timeout: 4000 });\n    check(\"the button turns it off\", (await page.locator(\".popout-toggle\").getAttribute(\"aria-pressed\")) === \"false\" && (await page.evaluate(() => localStorage.getItem(\"aura_video_popout\"))) === \"0\");\n    await forget();\n    await menu(\"Library\");\n    check(\"turned off: nothing pops out\", only(await asked(), \"out\").length === 0, await asked());\n    await menu(\"Social\");\n    await page.locator(\".popout-toggle\").click({ timeout: 4000 });\n    check(\"and on again\", (await page.locator(\".popout-toggle\").getAttribute(\"aria-pressed\")) === \"true\" && (await page.evaluate(() => localStorage.getItem(\"aura_video_popout\"))) === \"1\");\n\n    console.log(\"5. Other ways of leaving the page\");\n    await forget();\n    await page.getByRole(\"tab\", { name: \"Instagram\" }).click({ timeout: 5000 });\n    await page.waitForTimeout(400);\n    list = await asked();\n    check(\"switching to another Social tab pops it out too\", only(list, \"out\").length === 1, list);\n    await page.getByRole(\"tab\", { name: \"Browser\" }).click({ timeout: 5000 });\n    await page.waitForTimeout(400);\n    check(\"and coming back to the Browser tab puts it back\", only(await asked(), \"in\").length === 1, await asked());\n    await forget();\n    await page.locator('button[aria-label=\"Home\"]').click({ timeout: 4000 });\n    await page.waitForTimeout(400);\n    check(\"so does the browser's Home button, which covers the page with the start page\", only(await asked(), \"out\").length === 1, await asked());\n    await page.getByText(\"YouTube\", { exact: true }).first().click({ timeout: 5000 });\n    await page.waitForTimeout(400);\n\n    console.log(\"6. The small window's own buttons\");\n    await video({ sound: true, playing: true, out: false });\n    await menu(\"Library\");\n    await page.waitForTimeout(300);\n    check(\"leaving again pops it out again\", (await page.evaluate(() => window.__video.out)) === true);\n    await video({ out: false }); // \"Back to tab\": the video is playing in the page again\n    await page.waitForTimeout(2300);\n    check(\"\\\"Back to tab\\\" brings you to the video in AURA\", await onBrowserTab());\n    await menu(\"Library\");\n    await page.waitForTimeout(300);\n    await video({ out: false, playing: false, sound: false }); // closing the small window stops the video\n    await page.waitForTimeout(2300);\n    check(\"closing the small window leaves you where you are\", !(await onBrowserTab()));\n    await forget();\n    await page.waitForTimeout(1900);\n    check(\"and AURA stops checking on it\", (await asked()).length === 0, await asked());\n\n    console.log(\"7. Only the Browser tab\");\n    await menu(\"Social\");\n    await page.getByRole(\"tab\", { name: \"X\", exact: true }).click({ timeout: 5000 });\n    await page.waitForTimeout(300);\n    await page.evaluate(() => { window.__all = []; const run = HTMLElement.prototype.executeJavaScript; HTMLElement.prototype.executeJavaScript = function (...a) { window.__all.push((this.getAttribute(\"partition\") || \"\")); return run.apply(this, a); }; });\n    await menu(\"Library\");\n    await menu(\"Social\");\n    const touched = await page.evaluate(() => window.__all);\n    check(\"Instagram, X and Facebook pages are never asked anything\", touched.every((p) => p === \"persist:social-browser\"), touched);\n    check(\"nothing crashed along the way\", (await page.locator(\".aura-fallback\").count()) === 0, thrown);\n  } finally {\n    await browser.close();\n    server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The pop-out check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-video-popout.bak";
const MARK = "Added by aura-video-popout-setup.cjs";
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "release", ".git", ".vite", "coverage"]);
const CREATED = ["video-popout.cjs"];

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
const count = (text, piece) => (piece ? text.split(piece).length - 1 : 0);

// ── One edit ──────────────────────────────────────────────────────────────────
// Each returns the new text and whether it changed anything. If the place it is looking for
// isn't there, that is fine when the edit was already made (its "done" text is present) or when
// the edit only removes something that is already gone. Anything else is a problem.
function applyEdit(text, edit) {
  const already = () => {
    if (edit.done && text.includes(edit.done)) return { text, changed: false };
    if (edit.missingOk) return { text, changed: false };
    throw new Error(edit.kind === "cut" || edit.kind === "insert" ? "the line  " + (edit.from || edit.after || edit.aheadOf).trim() : "the part for: " + edit.label);
  };
  if (edit.done && text.includes(edit.done)) return { text, changed: false };

  if (edit.kind === "replace") {
    const n = count(text, edit.before);
    if (n === 0) return already();
    if (n > 1) throw new Error("exactly one of  " + edit.before.slice(0, 70) + "  (there are " + n + ")");
    return { text: text.replace(edit.before, () => edit.text), changed: true };
  }

  if (edit.kind === "re") {
    const re = new RegExp(edit.re, "m");
    if (!re.test(text)) return already();
    return { text: text.replace(re, () => edit.text), changed: true };
  }

  const lines = text.split("\n");
  if (edit.kind === "insert") {
    const anchor = edit.after || edit.aheadOf;
    const hits = lines.map((l, i) => (l.includes(anchor) ? i : -1)).filter((i) => i >= 0);
    if (!hits.length) return already();
    if (hits.length > 1) throw new Error("exactly one line with  " + anchor.trim() + "  (there are " + hits.length + ")");
    lines.splice(hits[0] + (edit.after ? 1 : 0), 0, ...edit.text.replace(/\n$/, "").split("\n"));
    return { text: lines.join("\n"), changed: true };
  }

  if (edit.kind === "cut") {
    const starts = lines.map((l, i) => (l.includes(edit.from) ? i : -1)).filter((i) => i >= 0);
    if (!starts.length) return already();
    if (starts.length > 1) throw new Error("exactly one line with  " + edit.from.trim() + "  (there are " + starts.length + ")");
    const a = starts[0];
    let b = -1;
    for (let i = a + 1; i < lines.length; i++) if (lines[i].includes(edit.to)) { b = i; break; }
    if (b < 0) throw new Error("the line  " + edit.to.trim() + "  after  " + edit.from.trim());
    if (edit.maxLines && b - a > edit.maxLines) throw new Error("the part from  " + edit.from.trim() + "  where I expected it (it is longer than it should be)");
    // Never remove more than was meant: only these handlers may be inside the part taken out
    if (edit.only) {
      const inside = lines.slice(a, b).join("\n");
      const others = [...inside.matchAll(/ipcMain\.(?:handle|on)\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]).filter((name) => !edit.only.includes(name));
      if (others.length) throw new Error("the part from  " + edit.from.trim() + "  on its own (" + others.join(", ") + " is in the middle of it)");
    }
    const put = edit.text ? edit.text.replace(/\n$/, "").split("\n") : [];
    lines.splice(a, b - a, ...put);
    return { text: lines.join("\n"), changed: true };
  }
  throw new Error("how to make the change: " + edit.label);
}

const LEFTOVERS = {};

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
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) visit(full, depth + 1);
      } else if (entry.name.endsWith(BAK)) {
        const target = full.slice(0, -BAK.length);
        fs.copyFileSync(full, target); fs.unlinkSync(full);
        say("  restored  " + rel(target)); restored++;
      } else if (CREATED.includes(entry.name)) {
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

  const where = {
    social: { file: path.join(ROOT, "src", "components", "social.jsx"), name: "Social", js: false },
    app: { file: path.join(ROOT, "src", "App.jsx"), name: "window", js: false },
    runner: { file: path.join(ROOT, "tests", "run.cjs"), name: "checks", js: true, optional: true },
  };
  const missing = Object.values(where).filter((w) => !w.optional && !fs.existsSync(w.file)).map((w) => rel(w.file));
  if (missing.length) stop(["I couldn't find " + missing.join(" or ") + ".", "Make sure this file is in your AURA project folder, next to package.json.", "Copy this message to Claude."]);
  const hasChecks = fs.existsSync(where.runner.file);

  const plan = [];
  const problems = [];
  for (const [key, w] of Object.entries(where)) {
    if (w.optional && !fs.existsSync(w.file)) continue;
    const { text, eol } = readText(w.file);
    let now = text;
    const notes = [];
    for (const edit of EDITS.filter((e) => e.file === key)) {
      try {
        const result = applyEdit(now, edit);
        if (result.changed) { now = result.text; if (!notes.includes(edit.label)) notes.push(edit.label); }
      } catch (e) { problems.push("In " + rel(w.file) + " I couldn't find " + e.message + "."); }
    }
    const left = (LEFTOVERS[key] || []).filter((piece) => now.includes(piece));
    if (left.length) problems.push("In " + rel(w.file) + " I couldn't safely remove: " + left.join(", ") + ".");
    if (w.js && now !== text) { const bad = syntaxProblem(now); if (bad) problems.push("In " + rel(w.file) + " I couldn't find a way to edit it safely (" + bad + ")."); }
    plan.push({ label: w.name, file: w.file, before: text, after: now, eol, notes });
  }

  const created = [];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "video-popout.cjs"), content: FILES.popout });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: videos pop out of the Social browser");
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
  say("Done. Next:");
  if (hasChecks) say("  1. Check everything still works:   npm test");
  say("  " + (hasChecks ? "2" : "1") + ". Start AURA, open Social, go to the Browser tab and play a YouTube video with sound.");
  say("     Click Library: the video should pop out into a small window. Click Social: it goes back.");
  say();
  say("To undo later:  node aura-video-popout-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
