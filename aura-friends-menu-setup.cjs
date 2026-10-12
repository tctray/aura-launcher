#!/usr/bin/env node
/**
 * AURA — the friends panel gets its own menu button
 *
 * 1. The "Friends" item is removed from the left menu, on Home and on every other page.
 *
 * 2. The friends panel on the right has a menu button (three lines) at its top.
 *    Press it and the panel folds down to a narrow strip that keeps only that button.
 *    Press it again and the panel opens. It replaces the X that used to hide the panel,
 *    so the control for the panel is now on the panel.
 *
 *    Folded, the panel stays loaded: friends, messages and calls keep working, and anything
 *    typed in it is still there when it opens. AURA remembers whether it was open or folded.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-friends-menu-setup.cjs
 *   4. Then:  npm test
 *
 * What it does:
 *   - edits    src/App.jsx              the left menu, and the friends panel
 *   - creates  tests/friends-menu.cjs   (only if AURA's checks are installed) checks all of it
 *   - edits    tests/run.cjs            (same) so npm test runs it
 *
 * Every file it changes is copied to <name>.before-friends-menu.bak first.
 * To put everything back:                 node aura-friends-menu-setup.cjs --undo
 * To preview without changing anything:   node aura-friends-menu-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const EDITS = [{"kind":"re","file":"app","label":"the Friends item is gone from the left menu (Home and every other page)","re":"^[ \\t]*<div className=\"gm-rail-item\" onClick=\\{\\(\\)=>setFriendsOpen\\(o=>!o\\)\\}[^\\n]*\\n[ \\t]*<Ic\\.Friends/>\\n[^\\n]*>Friends</span>\\}\\n[ \\t]*</div>\\n","missingOk":true,"text":""},{"kind":"re","file":"app","label":"the Friends item is gone from the left menu (Home and every other page)","re":"^[ \\t]*<div className=\"sb-item\" onClick=\\{\\(\\)=>setFriendsOpen\\(o=>!o\\)\\}[^\\n]*\\n[ \\t]*<Ic\\.Friends/>\\n[^\\n]*>Friends</span>\\}\\n[ \\t]*</div>\\n","missingOk":true,"text":""},{"kind":"insert","file":"app","label":"the friends panel has its own menu button, which folds it to a narrow strip and opens it again","after":".fp{width:var(--fw);min-width:var(--fw);background:var(--panel);border-left:1px solid var(--border);display:flex;flex-direction:column;}","done":".fp.shut{","text":"/* The friends panel folds down to a narrow strip that keeps only its menu button. Added by aura-friends-menu-setup.cjs. */\n.fp{transition:width .2s ease,min-width .2s ease;}\n.fp.shut{width:52px;min-width:52px;}\n.fp.shut .fp-hdr{justify-content:center;padding:16px 0 12px;border-bottom-color:transparent;}\n.fp.shut .fp-title,.fp.shut .fp-body{display:none;}\n.fp-toggle{background:var(--acd);border:1px solid var(--acg);color:var(--ac);cursor:pointer;padding:6px;border-radius:8px;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0;}\n.fp-toggle:hover{background:var(--ac);color:#fff;}\n.fp-toggle:focus-visible{outline:2px solid var(--ac);outline-offset:2px;}\n.reduce-motion .fp{transition:none!important;}\n/* The starter stylesheet draws a faint line down each side of the page. It showed through wherever a side panel was folded. */\n#root{border:0!important;}\n"},{"kind":"replace","file":"app","label":"the friends panel has its own menu button, which folds it to a narrow strip and opens it again","done":"function FriendsPanel({ launching, toast, onToggle, hidden }) {","before":"function FriendsPanel({ launching, toast, onClose, hidden }) {","text":"function FriendsPanel({ launching, toast, onToggle, hidden }) {"},{"kind":"replace","file":"app","label":"the friends panel has its own menu button, which folds it to a narrow strip and opens it again","done":"<button className=\"fp-toggle\"","before":"    <div className=\"fp\" style={hidden?{display:\"none\"}:undefined}>\n      <div className=\"fp-hdr\" style={{justifyContent:\"flex-end\"}}>\n        <div style={{display:\"flex\",alignItems:\"center\",gap:2}}>\n          <button className=\"fp-refresh\" onClick={onClose} title=\"Hide friends\" aria-label=\"Hide friends panel\"><Ic.X/></button>\n        </div>\n      </div>","text":"    <div className={\"fp\"+(hidden?\" shut\":\"\")}>\n      {/* The menu button folds the panel down to a narrow strip and opens it again. Folded, everything in it stays loaded. Added by aura-friends-menu-setup.cjs. */}\n      <div className=\"fp-hdr\">\n        <div className=\"fp-title\">FRIENDS</div>\n        <button className=\"fp-toggle\" onClick={onToggle} title={hidden?\"Show friends\":\"Hide friends\"} aria-label={hidden?\"Show friends\":\"Hide friends\"} aria-expanded={!hidden}><Ic.Menu/></button>\n      </div>"},{"kind":"re","file":"app","label":"the friends panel has its own menu button, which folds it to a narrow strip and opens it again","re":"hidden=\\{!friendsOpen\\} onClose=\\{\\(\\)=>setFriendsOpen\\(false\\)\\}/>","missingOk":true,"text":"hidden={!friendsOpen} onToggle={()=>setFriendsOpen(o=>!o)}/>"},{"kind":"re","file":"app","label":"the friends panel has its own menu button, which folds it to a narrow strip and opens it again","re":"hidden=\\{!friendsOpen\\} onClose=\\{\\(\\)=>setFriendsOpen\\(false\\)\\}/>","missingOk":true,"text":"hidden={!friendsOpen} onToggle={()=>setFriendsOpen(o=>!o)}/>"},{"kind":"insert","file":"runner","label":"npm test now checks the friends panel's menu button","after":"add(\"window\", \"The window opens and every page loads\", \"window.cjs\");","done":"friends-menu.cjs","text":"if (fs.existsSync(path.join(__dirname, \"friends-menu.cjs\"))) add(\"window\", \"The friends panel and its menu button\", \"friends-menu.cjs\");\n"}];
const FILES = {"check":"// The friends panel (right side) and its menu button.\n//\n// Opens the built window (dist) in a real browser with a pretend desktop side and checks that:\n//   - the left menu has no Friends item, on Home or on any other page\n//   - the friends panel has a menu button (three lines) that folds it to a narrow strip and\n//     opens it again, giving the page the room while it is folded\n//   - folded or open, it is the same on Home and on the other pages, and it is remembered\n//   - folding the panel doesn't throw away what is in it\n// Added by aura-friends-menu-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\n\n(async () => {\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(process.env.CI ? 1 : 3); }\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch(options); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with. Run  npx playwright install chromium  once to add one.\"); return done(process.env.CI ? 1 : 3); }\n\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(DIST, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => {\n      if (err) { res.writeHead(404); return res.end(); }\n      res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" });\n      res.end(data);\n    });\n  });\n  await new Promise((r) => server.listen(0, \"127.0.0.1\", r));\n  const base = \"http://127.0.0.1:\" + server.address().port;\n\n  // Start AURA logged in, on Home. Storage is only cleared the first time, so restarting\n  // AURA (reload) keeps what it remembered.\n  async function start() {\n    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();\n    const thrown = [];\n    page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());\n    await page.addInitScript(() => {\n      try {\n        if (!sessionStorage.getItem(\"__started\")) {\n          sessionStorage.setItem(\"__started\", \"1\");\n          localStorage.clear();\n          localStorage.setItem(\"aura_profile\", JSON.stringify({ username: \"tester\", avatar: \"\", userId: \"user-1\" }));\n        }\n      } catch {}\n      const ok = (data) => Promise.resolve({ success: true, data });\n      const account = { getSession: () => ok({ id: \"user-1\", email: \"me@example.com\" }), getMyProfile: () => ok({ username: \"tester\", avatar_url: null }), saveProfile: (name, picture) => ok({ username: name, avatar_url: picture || null }) };\n      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => (name === \"auraCloud\" && account[key]) ? account[key](...args) : ok(null)) });\n      window.auraCloud = fake(\"auraCloud\");\n      window.auraSocial = fake(\"auraSocial\");\n      window.electronAPI = new Proxy({}, {\n        get: (_t, key) => {\n          if (key === \"isElectron\") return true;\n          if (typeof key !== \"string\" || key === \"then\") return undefined;\n          if (/^on[A-Z]/.test(key)) return () => () => {};\n          if (/^remove/.test(key)) return () => {};\n          return () => Promise.resolve({ success: false });\n        },\n      });\n    });\n    const load = async () => { await page.goto(base + \"/index.html\", { waitUntil: \"load\" }); await page.waitForTimeout(4500); };\n    await load();\n    const goTo = async (label) => { await page.locator(`.gm-rail-item[title=\"${label}\"], .sb-item[title=\"${label}\"]`).first().click({ timeout: 5000 }); await page.waitForTimeout(900); };\n    const button = page.locator(\".fp .fp-toggle\");\n    const press = async () => { await button.click({ timeout: 4000 }); await page.waitForTimeout(600); };\n    const look = () => page.evaluate(() => {\n      const seen = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== \"hidden\"; };\n      const panel = document.querySelector(\".fp\"), b = panel?.querySelector(\".fp-toggle\");\n      const left = [...document.querySelectorAll(\".gm-rail-item, .sb-item\")];\n      const page = document.querySelector(\".gm-main\") || document.querySelector(\".main\");\n      const br = b?.getBoundingClientRect();\n      return {\n        layout: document.querySelector(\".gm-app\") ? \"home\" : \"sidebar\",\n        leftItems: left.length,\n        leftFriends: left.filter((el) => /friend/i.test((el.getAttribute(\"title\") || \"\") + \" \" + el.textContent)).map((el) => el.getAttribute(\"title\") || el.textContent.trim()),\n        panels: document.querySelectorAll(\".fp\").length,\n        width: panel ? Math.round(panel.getBoundingClientRect().width) : -1,\n        atRightEdge: panel ? Math.round(window.innerWidth - panel.getBoundingClientRect().right) : -1,\n        title: seen(panel?.querySelector(\".fp-title\")) ? panel.querySelector(\".fp-title\").textContent.trim() : \"\",\n        body: seen(panel?.querySelector(\".fp-body\")),\n        tabs: seen(panel?.querySelector(\".fp-body\")) ? [...panel.querySelectorAll(\".fp-body > div:first-child > button\")].map((x) => x.textContent.trim().toUpperCase()) : [],\n        button: b ? { seen: seen(b), isButton: b.tagName === \"BUTTON\", lines: b.querySelectorAll(\"svg line\").length, tip: b.getAttribute(\"title\"), name: b.getAttribute(\"aria-label\"), expanded: b.getAttribute(\"aria-expanded\"), inside: !!br && br.left >= panel.getBoundingClientRect().left && br.right <= panel.getBoundingClientRect().right, x: br ? Math.round(br.left) : -1 } : null,\n        oldX: !!panel?.querySelector(\".fp-refresh\"),\n        pageWidth: page ? Math.round(page.getBoundingClientRect().width) : -1,\n        saved: localStorage.getItem(\"aura_friends_open\"),\n        strayLines: (() => { const cs = getComputedStyle(document.getElementById(\"root\")); return [cs.borderLeftWidth, cs.borderRightWidth].filter((w) => w !== \"0px\"); })(),\n      };\n    });\n    return { page, thrown, load, goTo, button, press, look };\n  }\n\n  try {\n    console.log(\"1. Home\");\n    const app = await start();\n    let s = await app.look();\n    check(\"this is Home, and the left menu is there\", s.layout === \"home\" && s.leftItems >= 6, s);\n    check(\"the left menu has no Friends item\", s.leftFriends.length === 0, s.leftFriends);\n    check(\"the friends panel is open on the right, with its three tabs\", s.panels === 1 && s.width >= 240 && s.atRightEdge === 0 && s.body && s.tabs.join(\"|\") === \"AURA|DISCORD|STEAM\", s);\n    check(\"it has a menu button of its own: three lines, on the panel\", !!s.button && s.button.seen && s.button.isButton && s.button.lines === 3 && s.button.inside, s.button);\n    check(\"the button says what it does (Hide friends), also to a screen reader\", !!s.button && s.button.tip === \"Hide friends\" && s.button.name === \"Hide friends\" && s.button.expanded === \"true\", s.button);\n    check(\"the panel is labelled FRIENDS, and the old X is gone\", s.title === \"FRIENDS\" && !s.oldX, [s.title, s.oldX]);\n    const open = s;\n\n    await app.press();\n    s = await app.look();\n    check(\"the button folds the panel to a narrow strip\", s.width > 30 && s.width <= 64 && s.atRightEdge === 0, s.width);\n    check(\"the strip keeps only the button\", !s.body && s.title === \"\" && !!s.button && s.button.seen && s.button.inside && s.button.lines === 3, s);\n    check(\"which now says Show friends\", !!s.button && s.button.tip === \"Show friends\" && s.button.name === \"Show friends\" && s.button.expanded === \"false\", s.button);\n    check(\"the page gets the room\", s.pageWidth - open.pageWidth === open.width - s.width && s.pageWidth > open.pageWidth + 150, [open.pageWidth, s.pageWidth]);\n    check(\"no stray line shows down the page where the panel was\", s.strayLines.length === 0, s.strayLines);\n    check(\"AURA remembers it is folded\", s.saved === \"0\", s.saved);\n\n    console.log(\"2. The other pages\");\n    await app.goTo(\"Library\");\n    s = await app.look();\n    check(\"on Library the left menu has no Friends item either\", s.layout === \"sidebar\" && s.leftItems >= 6 && s.leftFriends.length === 0, s.leftFriends);\n    check(\"the panel is still folded here\", s.panels === 1 && s.width <= 64 && !s.body && !!s.button && s.button.seen, s);\n    await app.press();\n    s = await app.look();\n    check(\"the button opens it again\", s.width >= 240 && s.body && s.tabs.join(\"|\") === \"AURA|DISCORD|STEAM\" && s.title === \"FRIENDS\" && s.saved === \"1\", s);\n    await app.button.focus();\n    await app.page.keyboard.press(\"Enter\");\n    await app.page.waitForTimeout(600);\n    check(\"it works from the keyboard too (Enter)\", (await app.look()).width <= 64);\n    await app.page.keyboard.press(\"Enter\");\n    await app.page.waitForTimeout(600);\n    check(\"and opens the same way\", (await app.look()).width >= 240);\n\n    console.log(\"3. Nothing in the panel is lost\");\n    const box = app.page.locator(\".fp input\").first();\n    if (!(await box.count())) note(\"the friends panel has no box to type in here, so this wasn't checked\");\n    else {\n      await box.fill(\"half a username\");\n      await app.press();\n      const folded = await app.look();\n      await app.press();\n      check(\"something typed in it is still there after folding and opening\", folded.width <= 64 && (await box.inputValue()) === \"half a username\", await box.inputValue().catch(() => null));\n    }\n    await app.goTo(\"Home\");\n    s = await app.look();\n    check(\"back on Home the panel is open, as it was left\", s.layout === \"home\" && s.width >= 240 && s.body, s);\n\n    console.log(\"4. Restarting AURA\");\n    await app.press();\n    await app.load();\n    s = await app.look();\n    check(\"folded when AURA closed: folded when it opens, button showing\", s.width <= 64 && !s.body && !!s.button && s.button.seen && s.button.expanded === \"false\", s);\n    await app.press();\n    await app.load();\n    s = await app.look();\n    check(\"open when AURA closed: open when it opens\", s.width >= 240 && s.body, s);\n    check(\"nothing crashed along the way\", (await app.page.locator(\".aura-fallback\").count()) === 0 && app.thrown.length === 0, app.thrown);\n    await app.page.context().close();\n\n    console.log(\"5. The code\");\n    const source = (() => { try { return fs.readFileSync(path.join(ROOT, \"src\", \"App.jsx\"), \"utf8\"); } catch { return \"\"; } })();\n    if (!source) note(\"src/App.jsx isn't here, so the code wasn't checked\");\n    else check(\"the friends panel is only opened and folded from its own button\", (source.match(/setFriendsOpen\\(/g) || []).length === 2 && !/className=\"(?:sb-item|gm-rail-item)\" onClick=\\{\\(\\)=>setFriendsOpen/.test(source), (source.match(/setFriendsOpen\\(/g) || []).length);\n  } finally {\n    await browser.close();\n    server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The friends panel check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-friends-menu.bak";
const MARK = "Added by aura-friends-menu-setup.cjs";
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "release", ".git", ".vite", "coverage"]);
const CREATED = ["friends-menu.cjs"];
const RETIRED = [];

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

// After the edits, none of these may be left, and all of the second list must be there. If not,
// an edit didn't fit this copy of AURA, and nothing is written.
const LEFTOVERS = {
  app: ['onClose={()=>setFriendsOpen(false)}', 'title={friendsOpen?"Hide friends":"Show friends"}', 'className="fp-refresh" onClick={onClose}'],
};
const REQUIRED = {
  app: [".fp.shut{", '<button className="fp-toggle" onClick={onToggle}', "function FriendsPanel({ launching, toast, onToggle, hidden }) {", "hidden={!friendsOpen} onToggle={()=>setFriendsOpen(o=>!o)}/>"],
};

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
    const absent = (REQUIRED[key] || []).filter((piece) => !now.includes(piece));
    if (absent.length) problems.push("In " + rel(w.file) + " I couldn't put in: " + absent.join(", ") + ".");
    if (w.js && now !== text) { const bad = syntaxProblem(now); if (bad) problems.push("In " + rel(w.file) + " I couldn't find a way to edit it safely (" + bad + ")."); }
    plan.push({ label: w.name, file: w.file, before: text, after: now, eol, notes });
  }

  const created = [];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "friends-menu.cjs"), content: FILES.check });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: the friends panel's menu button");
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
  for (const r of RETIRED) {
    const file = path.join(ROOT, r.file);
    let mine = false;
    try { mine = fs.readFileSync(file, "utf8").includes(r.mark); } catch {}
    if (!mine) continue;
    if (!DRY) { const bak = file + BAK; if (!fs.existsSync(bak)) fs.copyFileSync(file, bak); fs.unlinkSync(file); }
    say("  " + "checks:".padEnd(11) + rel(file));
    say("             - removed (the new check covers it)");
  }
  say();
  if (DRY) { say("Run it again without --dry-run to apply."); say(); return; }
  say("Done. Next:");
  if (hasChecks) say("  1. Check everything still works:   npm test");
  say("  " + (hasChecks ? "2" : "1") + ". Start AURA. The left menu no longer has Friends. Press the three-line button");
  say("     at the top of the friends panel (right side) to fold it away and open it again.");
  say();
  say("To undo later:  node aura-friends-menu-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
