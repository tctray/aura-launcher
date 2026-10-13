#!/usr/bin/env node
/**
 * AURA — a cleaner "Friends Playing Now" on Home
 *
 * Before: a long game name wrapped onto several lines inside a small card, pushing the friend's
 * name off the top and the online dot onto a line of its own, with "ST" in the corner.
 *
 * Now each friend is one tidy card:
 *   - their picture, round, with a green online dot (their initial if there's no picture)
 *   - their name on one line
 *   - "Playing <game>" on one line; a long name ends in "..." and the full text shows on hover
 *   - no more "ST" in the corner: pointing at a card says who, what, and that it's from Steam
 * The row also refreshes every 2 minutes, instead of only when AURA starts.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-friends-playing-setup.cjs
 *   4. Then:  npm test
 *
 * What it does:
 *   - edits    src/App.jsx                 the Friends Playing Now cards on Home
 *   - creates  tests/friends-playing.cjs   (only if AURA's checks are installed) checks them
 *   - edits    tests/run.cjs               (same) so npm test runs it
 *
 * Every file it changes is copied to <name>.before-friends-playing.bak first.
 * To put everything back:                 node aura-friends-playing-setup.cjs --undo
 * To preview without changing anything:   node aura-friends-playing-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const EDITS = [{"kind":"insert","file":"app","label":"Home's \"Friends Playing Now\" cards: round picture with an online dot, name and game on one line each","after":".gm-mf-card:hover .gm-mf-card-play{opacity:1;}","done":".fa-card{","text":"/* FRIENDS PLAYING NOW (Home). Added by aura-friends-playing-setup.cjs. */\n.fa-card{flex-shrink:0;width:250px;text-align:left;height:64px;display:flex;align-items:center;gap:11px;padding:0 12px;border-radius:12px;background:rgba(0,0,0,.45);border:1px solid var(--border);backdrop-filter:blur(12px);}\n.fa-av{position:relative;width:40px;height:40px;flex-shrink:0;}\n.fa-av img,.fa-ph{width:40px;height:40px;border-radius:50%;object-fit:cover;display:block;background:var(--hover);}\n.fa-ph{display:flex;align-items:center;justify-content:center;font-family:'Rajdhani',sans-serif;font-size:17px;font-weight:700;color:var(--t2);}\n.fa-dot{position:absolute;right:-1px;bottom:-1px;width:12px;height:12px;border-radius:50%;background:#43b581;border:2px solid var(--panel);}\n.fa-info{flex:1;min-width:0;line-height:1.25;}\n.fa-name{font-family:'Rajdhani',sans-serif;font-size:14px;font-weight:700;letter-spacing:.3px;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n.fa-game{margin-top:2px;font-size:11px;font-weight:600;color:var(--ac);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n.fa-verb{color:var(--t2);font-weight:500;}\n.no-blur .fa-card{background:var(--card);backdrop-filter:none;}\n"},{"kind":"re","file":"app","label":"Home's \"Friends Playing Now\" cards: round picture with an online dot, name and game on one line each","re":"^[ \\t]*\\{friends\\.map\\(f => \\(\\n[ \\t]*<div key=\\{f\\.id\\} className=\"gm-mf-card\" style=\\{\\{cursor:\"default\"\\}\\}>\\n[\\s\\S]*?\\{f\\.source===\"discord\"\\?\"DC\":\"ST\"\\}\\n[ \\t]*</div>\\n[ \\t]*</div>\\n[ \\t]*\\)\\)\\}\\n","done":"className=\"fa-card\"","text":"        {friends.map(f => {\n          const where = f.source === \"discord\" ? \"Discord\" : \"Steam\";\n          return (\n            <div key={f.id} className=\"fa-card\" title={`${f.name} is playing ${f.game} (${where})`}>\n              <div className=\"fa-av\">\n                {f.avatar\n                  ? <img src={f.avatar} alt=\"\" onError={e => { e.currentTarget.style.display = \"none\"; e.currentTarget.nextSibling.style.display = \"flex\"; }}/>\n                  : null}\n                <div className=\"fa-ph\" style={{display: f.avatar ? \"none\" : \"flex\"}}>{(String(f.name || \"?\").trim()[0] || \"?\").toUpperCase()}</div>\n                <span className=\"fa-dot\" aria-label=\"Online\"/>\n              </div>\n              <div className=\"fa-info\">\n                <div className=\"fa-name\">{f.name}</div>\n                <div className=\"fa-game\"><span className=\"fa-verb\">Playing </span>{f.game}</div>\n              </div>\n            </div>\n          );\n        })}\n"},{"kind":"replace","file":"app","label":"Home's \"Friends Playing Now\" refreshes every 2 minutes instead of only when AURA starts","done":"const playingTimer = setInterval(fetch, 120000);","before":"    fetch();\n  }, []);","text":"    fetch();\n    const playingTimer = setInterval(fetch, 120000); // keep \"Playing Now\" current\n    return () => clearInterval(playingTimer);\n  }, []);"},{"kind":"insert","file":"runner","label":"npm test now checks Friends Playing Now","after":"add(\"window\", \"The window opens and every page loads\", \"window.cjs\");","done":"friends-playing.cjs","text":"if (fs.existsSync(path.join(__dirname, \"friends-playing.cjs\"))) add(\"window\", \"Home: Friends Playing Now\", \"friends-playing.cjs\");\n"}];
const FILES = {"check":"// Home: \"Friends Playing Now\". Opens the built window (dist) in a real browser with a pretend\n// desktop side that has Steam friends playing games, one with a very long game name and one with\n// no picture, and checks each card stays tidy: name and game on one line each, nothing spilling\n// out of the card, the online dot on the picture, and where it's from spelled out.\n// Added by aura-friends-playing-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\nconst PIC = \"data:image/svg+xml;base64,\" + Buffer.from('<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"64\"><rect width=\"64\" height=\"64\" fill=\"#4a7\"/></svg>').toString(\"base64\");\nconst LONG = \"BOMBANANA: The Extremely Long Deluxe Edition With Every Expansion Pack\";\n\n(async () => {\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(process.env.CI ? 1 : 3); }\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch(options); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with. Run  npx playwright install chromium  once to add one.\"); return done(process.env.CI ? 1 : 3); }\n\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(DIST, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => {\n      if (err) { res.writeHead(404); return res.end(); }\n      res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" });\n      res.end(data);\n    });\n  });\n  await new Promise((r) => server.listen(0, \"127.0.0.1\", r));\n  const base = \"http://127.0.0.1:\" + server.address().port;\n\n  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();\n  const thrown = [];\n  page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n  await page.route((url) => !String(url).startsWith(base) && !String(url).startsWith(\"data:\"), (route) => route.abort());\n  await page.addInitScript(({ PIC, LONG }) => {\n    try {\n      localStorage.clear();\n      localStorage.setItem(\"aura_profile\", JSON.stringify({ username: \"tester\", avatar: \"\", userId: \"user-1\" }));\n      localStorage.setItem(\"aura_steam_id\", \"76561198000000000\");\n    } catch {}\n    const ok = (data) => Promise.resolve({ success: true, data });\n    const account = { getSession: () => ok({ id: \"user-1\", email: \"me@example.com\" }), getMyProfile: () => ok({ username: \"tester\", avatar_url: null }) };\n    const fake = (name) => new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => (name === \"auraCloud\" && account[key]) ? account[key](...args) : ok(null)) });\n    window.auraCloud = fake(\"auraCloud\");\n    window.auraSocial = fake(\"auraSocial\");\n    const friends = [\n      { id: \"1\", username: \"the_mexican_bombanana_player\", avatar: PIC, status: \"online\", activity: LONG },\n      { id: \"2\", username: \"nopic\", avatar: \"\", status: \"online\", activity: \"Apex Legends\" },\n      { id: \"3\", username: \"offline_friend\", avatar: PIC, status: \"offline\", activity: \"Fortnite\" },\n    ];\n    window.electronAPI = new Proxy({}, {\n      get: (_t, key) => {\n        if (key === \"isElectron\") return true;\n        if (typeof key !== \"string\" || key === \"then\") return undefined;\n        if (/^on[A-Z]/.test(key)) return () => () => {};\n        if (/^remove/.test(key)) return () => {};\n        if (key === \"steamGetFriendsProfiles\") return () => Promise.resolve({ success: true, friends });\n        return () => Promise.resolve({ success: false });\n      },\n    });\n  }, { PIC, LONG });\n\n  try {\n    await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n    await page.waitForTimeout(4500);\n    const cards = await page.evaluate(() => [...document.querySelectorAll(\".fa-card\")].map((c) => {\n      const box = c.getBoundingClientRect();\n      const inside = [...c.querySelectorAll(\"*\")].every((e) => { const r = e.getBoundingClientRect(); return r.width === 0 || (r.top >= box.top - 2 && r.bottom <= box.bottom + 2 && r.left >= box.left - 2 && r.right <= box.right + 2); });\n      const line = (sel) => { const e = c.querySelector(sel); return e ? { text: e.textContent.trim(), oneLine: e.getBoundingClientRect().height < parseFloat(getComputedStyle(e).fontSize) * 1.9 } : null; };\n      const pic = c.querySelector(\".fa-av img\"), ph = c.querySelector(\".fa-ph\"), dot = c.querySelector(\".fa-dot\"), av = c.querySelector(\".fa-av\");\n      const seen = (e) => !!e && getComputedStyle(e).display !== \"none\" && e.getBoundingClientRect().width > 0;\n      const d = dot?.getBoundingClientRect(), a = av?.getBoundingClientRect();\n      return {\n        height: Math.round(box.height), inside, tip: c.getAttribute(\"title\"),\n        name: line(\".fa-name\"), game: line(\".fa-game\"), left: [\".fa-name\", \".fa-game\"].every((sel) => getComputedStyle(c.querySelector(sel)).textAlign !== \"center\"),\n        picture: seen(pic) ? \"picture\" : seen(ph) ? \"initial:\" + ph.textContent.trim() : \"none\",\n        round: pic && seen(pic) ? getComputedStyle(pic).borderRadius === \"50%\" : true,\n        dotOnPicture: !!d && !!a && d.right <= a.right + 3 && d.bottom <= a.bottom + 3 && d.left > a.left + a.width / 2,\n        all: c.innerText,\n      };\n    }));\n    check(\"Home shows Friends Playing Now, with only the friends who are online and playing\", cards.length === 2, cards.map((c) => c.name && c.name.text));\n    const [long, nopic] = cards;\n    check(\"the cards are all the same height\", cards.every((c) => c.height === cards[0].height && c.height >= 56 && c.height <= 72), cards.map((c) => c.height));\n    check(\"a long name stays on one line\", !!long && long.name.oneLine, long && long.name);\n    check(\"a very long game name stays on one line too\", !!long && long.game.oneLine && /^Playing BOMBANANA/.test(long.game.text), long && long.game);\n    check(\"nothing spills out of a card\", cards.every((c) => c.inside));\n    check(\"the full name and game show when you point at the card\", !!long && long.tip === \"the_mexican_bombanana_player is playing \" + LONG + \" (Steam)\", long && long.tip);\n    check(\"each card has a round picture with the online dot on it\", !!long && long.picture === \"picture\" && long.round && cards.every((c) => c.dotOnPicture), cards.map((c) => [c.picture, c.dotOnPicture]));\n    check(\"a friend with no picture gets their initial instead\", !!nopic && nopic.picture === \"initial:N\", nopic && nopic.picture);\n    check(\"no cryptic \\\"ST\\\" on the cards (pointing at one says it's from Steam)\", cards.every((c) => !/\\bST\\b/.test(c.all)), cards.map((c) => c.all));\n    check(\"names and games line up on the left, next to the picture\", cards.every((c) => c.left));\n    await page.locator(\".fa-card\").first().hover();\n    check(\"nothing crashed\", (await page.locator(\".aura-fallback\").count()) === 0 && thrown.length === 0, thrown);\n\n    const source = fs.readFileSync(path.join(ROOT, \"src\", \"App.jsx\"), \"utf8\");\n    check(\"the row refreshes every 2 minutes, and stops when Home closes\", /const playingTimer = setInterval\\(fetch, 120000\\);[\\s\\S]{0,120}return \\(\\) => clearInterval\\(playingTimer\\);/.test(source));\n  } finally {\n    await browser.close();\n    server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The Friends Playing Now check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-friends-playing.bak";
const MARK = "Added by aura-friends-playing-setup.cjs";
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "release", ".git", ".vite", "coverage"]);
const CREATED = ["friends-playing.cjs"];
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
  app: ['{f.source==="discord"?"DC":"ST"}'],
};
const REQUIRED = {
  app: [".fa-card{", 'className="fa-card"', "const playingTimer = setInterval(fetch, 120000);"],
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
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "friends-playing.cjs"), content: FILES.check });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: Friends Playing Now");
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
  say("  " + (hasChecks ? "2" : "1") + ". Start AURA and look at Friends Playing Now on Home.");
  say();
  say("To undo later:  node aura-friends-playing-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
