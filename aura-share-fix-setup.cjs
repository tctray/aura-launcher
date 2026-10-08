#!/usr/bin/env node
/**
 * AURA — fix "Share failed: socket hang up" on the Clips page
 *
 * Share uploads a clip to Catbox (catbox.moe) for a link. AURA sent the clip without saying how
 * big it was, and Catbox answers that by hanging up. This:
 *   - sends clips the way Catbox expects, and tries once more if the connection drops
 *   - sends clips over 200 MB (Catbox's limit), or any clip while Catbox is down, to Litterbox
 *     (same people) instead, which keeps them 3 days, and tells you so
 *   - says what went wrong in plain words
 *   - only ever uploads clips from your AURA clip folder (before, the window could ask it to
 *     upload any file on the PC)
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-share-fix-setup.cjs
 *
 * What it does:
 *   - creates  electron/share.js       uploads a clip and returns its link
 *   - edits    your main file          the Share button uses share.js
 *   - edits    your App file           shows the note when a link only lasts 3 days
 *   - creates  tests/share.cjs         (only if AURA's checks are installed) checks for the above
 *
 * Every file it changes is copied to <name>.before-share-fix.bak first.
 * To put everything back:                 node aura-share-fix-setup.cjs --undo
 * To preview without changing anything:   node aura-share-fix-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FILES = {"share":"// AURA — sharing a clip.\n//\n// Uploads one clip to Catbox (catbox.moe: free, no account) and hands back its public link.\n// Anyone with the link can watch the clip, so AURA only ever uploads a clip from your clip\n// folder, and only when you press Share.\n//\n// Clips over 200 MB, or any clip while Catbox itself won't take uploads, go to Litterbox (run by\n// the same people) instead, which keeps them for 3 days.\n//\n// Added by aura-share-fix-setup.cjs. Wired up from the main file with one line:\n//   ipcMain.handle(\"share-clip\", async (_e, filePath) => require(\"./share\").shareClip(filePath, { clipFolder: getClipFolder() }));\n\"use strict\";\nconst fs = require(\"fs\");\nconst path = require(\"path\");\nconst https = require(\"https\");\nconst crypto = require(\"crypto\");\n\nconst MB = 1024 * 1024;\nconst CATBOX = { name: \"Catbox\", hostname: \"catbox.moe\", path: \"/user/api.php\", max: 200 * MB, link: /^https:\\/\\/files\\.catbox\\.moe\\/[A-Za-z0-9._-]+$/ };\nconst LITTERBOX = { name: \"Litterbox\", hostname: \"litterbox.catbox.moe\", path: \"/resources/internals/api.php\", max: 1024 * MB, fields: { time: \"72h\" }, link: /^https:\\/\\/litter\\.catbox\\.moe\\/[A-Za-z0-9._-]+$/ };\nconst TYPES = { \".mp4\": \"video/mp4\", \".webm\": \"video/webm\", \".mov\": \"video/quicktime\", \".mkv\": \"video/x-matroska\", \".gif\": \"image/gif\" };\nconst TIMEOUT_MS = 10 * 60 * 1000;  // a big clip on a slow connection can take a while\nconst sizeText = (n) => (n >= 10 * MB ? Math.round(n / MB) : (n / MB).toFixed(1)) + \" MB\";\n\n// Is `file` somewhere inside `folder`?\nfunction inside(file, folder) {\n  const r = path.relative(path.resolve(folder), path.resolve(file));\n  return !!r && !r.startsWith(\"..\") && !path.isAbsolute(r);\n}\n\n// Sends the file as a normal form upload, with its full size stated up front. (The old code sent\n// it in pieces without saying how big it was, which Catbox answers by hanging up.)\nfunction upload(target, filePath, size, { request = https.request, timeoutMs = TIMEOUT_MS } = {}) {\n  return new Promise((resolve, reject) => {\n    const boundary = \"----AURA\" + crypto.randomBytes(12).toString(\"hex\");\n    const field = (name, value) => `--${boundary}\\r\\nContent-Disposition: form-data; name=\"${name}\"\\r\\n\\r\\n${value}\\r\\n`;\n    const fileName = path.basename(filePath).replace(/[\"\\r\\n\\\\]/g, \"_\");\n    const head = Buffer.from(\n      field(\"reqtype\", \"fileupload\") + Object.entries(target.fields || {}).map(([k, v]) => field(k, v)).join(\"\") +\n      `--${boundary}\\r\\nContent-Disposition: form-data; name=\"fileToUpload\"; filename=\"${fileName}\"\\r\\nContent-Type: ${TYPES[path.extname(filePath).toLowerCase()]}\\r\\n\\r\\n`);\n    const tail = Buffer.from(`\\r\\n--${boundary}--\\r\\n`);\n    let settled = false;\n    const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };\n    const req = request({\n      hostname: target.hostname, path: target.path, method: \"POST\",\n      headers: { \"Content-Type\": \"multipart/form-data; boundary=\" + boundary, \"Content-Length\": head.length + size + tail.length, \"User-Agent\": \"AURA-Launcher\", Accept: \"text/plain\" },\n    }, (res) => {\n      let body = \"\";\n      res.setEncoding(\"utf8\");\n      res.on(\"data\", (d) => { if (body.length < 4000) body += d; });\n      res.on(\"end\", () => done(resolve, { status: res.statusCode, body: body.trim() }));\n      res.on(\"error\", (e) => done(reject, e));\n    });\n    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error(\"timed out\"), { code: \"ETIMEDOUT\" })));\n    req.on(\"error\", (e) => done(reject, e));\n    const stream = fs.createReadStream(filePath);\n    stream.on(\"error\", (e) => { req.destroy(e); done(reject, e); });\n    stream.on(\"end\", () => req.end(tail));\n    req.write(head);\n    stream.pipe(req, { end: false });\n  });\n}\n\n// What went wrong, in words a person can act on\nconst lostConnection = (e) => /socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|ENETUNREACH|timed out/i.test(String(e?.code || \"\") + \" \" + String(e?.message || \"\"));\n\n// Returns { success: true, url, note } or { success: false, error }\nasync function shareClip(filePath, { clipFolder, request, timeoutMs, maxBytes } = {}) {\n  try {\n    if (typeof filePath !== \"string\" || !filePath) return { success: false, error: \"No clip was chosen.\" };\n    if (!clipFolder || !inside(filePath, clipFolder)) return { success: false, error: \"Only clips in your AURA clip folder can be shared.\" };\n    if (!TYPES[path.extname(filePath).toLowerCase()]) return { success: false, error: \"Only video clips (MP4, WebM, MOV, MKV) and GIFs can be shared.\" };\n    let size = 0;\n    try { const st = fs.statSync(filePath); if (!st.isFile()) throw new Error(); size = st.size; }\n    catch { return { success: false, error: \"That clip isn't there any more. It may have been moved or deleted.\" }; }\n    if (!size) return { success: false, error: \"That clip is empty, so there's nothing to share.\" };\n    const biggest = maxBytes || LITTERBOX.max;\n    if (size > biggest) return { success: false, error: `This clip is ${sizeText(size)}. Clips up to ${sizeText(biggest)} can be shared; trim it in the clip editor first.` };\n\n    const targets = size <= Math.min(CATBOX.max, biggest) ? [CATBOX, LITTERBOX] : [LITTERBOX];\n    const problems = [];\n    for (const target of targets) {\n      for (let attempt = 1; attempt <= 2; attempt++) {\n        let res;\n        try { res = await upload(target, filePath, size, { request, timeoutMs }); }\n        catch (e) {\n          problems.push({ target, lost: lostConnection(e), text: String(e?.message || e) });\n          if (lostConnection(e) && attempt === 1) { await new Promise((r) => setTimeout(r, 1500)); continue; } // one more go after a dropped connection\n          break;\n        }\n        if (res.status === 200 && target.link.test(res.body)) {\n          const note = target === LITTERBOX ? (size > CATBOX.max\n            ? `Shared. This clip is ${sizeText(size)}, over Catbox's 200 MB limit, so it went to Litterbox and the link works for 3 days.`\n            : \"Shared. Catbox wasn't taking uploads just now, so it went to Litterbox and the link works for 3 days.\") : \"\";\n          return { success: true, url: res.body, note };\n        }\n        problems.push({ target, lost: false, text: (res.body || \"\").replace(/<[^>]*>/g, \" \").replace(/\\s+/g, \" \").trim().slice(0, 120) || \"error \" + res.status, status: res.status });\n        break; // a clear \"no\" doesn't change by asking again\n      }\n    }\n    const last = problems[problems.length - 1] || {};\n    if (problems.every((p) => p.lost)) return { success: false, error: \"Couldn't upload the clip: Catbox (the free site AURA shares clips through) isn't answering or closed the connection. Check your internet, or try again in a few minutes.\" };\n    if (last.status === 412 || /size|too large|exceed/i.test(last.text || \"\")) return { success: false, error: `${last.target.name} says the clip is too big (${sizeText(size)}). Trim it in the clip editor and try again.` };\n    return { success: false, error: `${(last.target || CATBOX).name} didn't accept the clip (${last.text}). Try again in a few minutes.` };\n  } catch (e) {\n    return { success: false, error: \"Couldn't share the clip: \" + (e?.message || \"unknown problem\") };\n  }\n}\n\nmodule.exports = { shareClip, upload, CATBOX, LITTERBOX };\n","test":"// Sharing clips (electron/share.js), against a stand-in for Catbox and Litterbox on this PC.\n// Added by aura-share-fix-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst os = require(\"os\");\nconst path = require(\"path\");\nconst http = require(\"http\");\nconst { shareClip } = require(path.resolve(process.argv[2] || path.join(__dirname, \"..\", \"electron\", \"share.js\")));\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok ? \"\" : \"  \" + JSON.stringify(extra))); };\n\n(async () => {\n  const dir = fs.mkdtempSync(path.join(os.tmpdir(), \"aura-share-\"));\n  const clips = path.join(dir, \"Clips\"), game = path.join(clips, \"Elden Ring\");\n  fs.mkdirSync(game, { recursive: true });\n  const clip = path.join(game, \"clip-1.webm\");\n  const bytes = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(300000, 7)]);\n  fs.writeFileSync(clip, bytes);\n  const secret = path.join(dir, \"passwords.txt\"); fs.writeFileSync(secret, \"hunter2\");\n  fs.writeFileSync(path.join(clips, \"notes.txt\"), \"x\");\n\n  // What each pretend site does with an upload\n  const got = [];\n  let behave = { \"catbox.moe\": \"ok\", \"litterbox.catbox.moe\": \"ok\" };\n  const server = http.createServer((req, res) => {\n    const site = req.headers[\"x-site\"];\n    const chunks = [];\n    req.on(\"data\", (c) => chunks.push(c));\n    req.on(\"end\", () => {\n      const body = Buffer.concat(chunks);\n      got.push({ site, path: req.url, headers: req.headers, body });\n      const mode = Array.isArray(behave[site]) ? behave[site].shift() : behave[site];\n      if (mode === \"hangup\") return req.socket.destroy();\n      if (mode === \"stall\") return; // never answers\n      if (mode === \"big\") { res.writeHead(412); return res.end(\"File size too large\"); }\n      if (mode === \"html\") { res.writeHead(500); return res.end(\"<html><body><h1>Internal Server Error</h1></body></html>\"); }\n      res.writeHead(200, { \"Content-Type\": \"text/plain\" });\n      res.end(site === \"catbox.moe\" ? \"https://files.catbox.moe/ab12cd.webm\" : \"https://litter.catbox.moe/zz99yy.webm\");\n    });\n  });\n  await new Promise((r) => server.listen(0, \"127.0.0.1\", r));\n  const port = server.address().port;\n  const request = (opts, cb) => http.request({ ...opts, hostname: \"127.0.0.1\", port, headers: { ...opts.headers, \"x-site\": opts.hostname } }, cb);\n  const share = (file, more = {}) => shareClip(file, { clipFolder: clips, request, ...more });\n  const field = (body, name) => { const m = body.toString(\"latin1\").match(new RegExp(`name=\"${name}\"(?:; filename=\"([^\"]*)\")?\\\\r\\\\n(?:Content-Type: ([^\\\\r]+)\\\\r\\\\n)?\\\\r\\\\n`)); return m; };\n\n  console.log(\"1. Sharing a clip\");\n  let r = await share(clip);\n  const up = got[got.length - 1];\n  check(\"it uploads to Catbox and hands back the link\", r.success && r.url === \"https://files.catbox.moe/ab12cd.webm\" && r.note === \"\" && up.site === \"catbox.moe\" && up.path === \"/user/api.php\", [r, up && up.site]);\n  check(\"the upload says how big it is up front (Catbox hangs up otherwise)\", Number(up.headers[\"content-length\"]) === up.body.length && !up.headers[\"transfer-encoding\"], [up.headers[\"content-length\"], up.body.length, up.headers[\"transfer-encoding\"]]);\n  check(\"it is a normal form upload: reqtype=fileupload and the file\", /^multipart\\/form-data; boundary=/.test(up.headers[\"content-type\"]) && /name=\"reqtype\"\\r\\n\\r\\nfileupload\\r\\n/.test(up.body.toString(\"latin1\")) && field(up.body, \"fileToUpload\")?.[1] === \"clip-1.webm\" && field(up.body, \"fileToUpload\")?.[2] === \"video/webm\", up.headers[\"content-type\"]);\n  check(\"the whole clip arrives, byte for byte\", up.body.includes(bytes));\n  check(\"AURA names itself\", up.headers[\"user-agent\"] === \"AURA-Launcher\");\n\n  console.log(\"2. Only clips from the clip folder\");\n  const before = got.length;\n  check(\"a file outside the clip folder is refused\", (await share(secret)).error === \"Only clips in your AURA clip folder can be shared.\");\n  check(\"so is a sneaky path that climbs out of it\", (await share(path.join(game, \"..\", \"..\", \"passwords.txt\"))).error === \"Only clips in your AURA clip folder can be shared.\");\n  check(\"so is something that isn't a clip\", /Only video clips/.test((await share(path.join(clips, \"notes.txt\"))).error));\n  check(\"a clip that has gone says so\", /isn't there any more/.test((await share(path.join(game, \"gone.mp4\"))).error));\n  check(\"nothing is asked for\", (await share(null)).error === \"No clip was chosen.\" && (await shareClip(clip, { request })).error === \"Only clips in your AURA clip folder can be shared.\");\n  check(\"none of those were uploaded\", got.length === before);\n\n  console.log(\"3. When Catbox has trouble\");\n  behave[\"catbox.moe\"] = [\"hangup\", \"ok\"];\n  r = await share(clip);\n  check(\"a dropped connection gets one more go\", r.success && r.url.startsWith(\"https://files.catbox.moe/\"), r);\n  behave[\"catbox.moe\"] = \"hangup\";\n  let n = got.length;\n  r = await share(clip);\n  check(\"Catbox hanging up every time: the clip goes to Litterbox, and you're told the link lasts 3 days\", r.success && r.url === \"https://litter.catbox.moe/zz99yy.webm\" && /works for 3 days/.test(r.note) && /Catbox wasn't taking uploads/.test(r.note), r);\n  const lit = got[got.length - 1];\n  check(\"Litterbox is asked to keep it 72 hours\", lit.site === \"litterbox.catbox.moe\" && lit.path === \"/resources/internals/api.php\" && /name=\"time\"\\r\\n\\r\\n72h\\r\\n/.test(lit.body.toString(\"latin1\")) && got.length - n >= 2, lit.path);\n  behave = { \"catbox.moe\": \"hangup\", \"litterbox.catbox.moe\": \"hangup\" };\n  r = await share(clip);\n  check(\"both hanging up: a plain message instead of 'socket hang up'\", !r.success && /isn't answering or closed the connection/.test(r.error) && !/socket/.test(r.error), r);\n  behave = { \"catbox.moe\": \"html\", \"litterbox.catbox.moe\": \"html\" };\n  r = await share(clip);\n  check(\"an error page: its words, not its code\", !r.success && /didn't accept the clip \\(Internal Server Error\\)/.test(r.error), r);\n  behave = { \"catbox.moe\": \"big\", \"litterbox.catbox.moe\": \"big\" };\n  r = await share(clip);\n  check(\"too big for them: says to trim it\", !r.success && /too big/.test(r.error) && /clip editor/.test(r.error), r);\n  behave = { \"catbox.moe\": \"ok\", \"litterbox.catbox.moe\": \"ok\" };\n  r = await share(clip, { maxBytes: 100000 });\n  check(\"bigger than can be shared at all: says so before uploading\", !r.success && /Clips up to/.test(r.error), r);\n  behave = { \"catbox.moe\": \"stall\", \"litterbox.catbox.moe\": \"stall\" };\n  const t0 = Date.now();\n  r = await share(clip, { timeoutMs: 300 });\n  check(\"a stuck upload is stopped instead of waiting for ever\", !r.success && /isn't answering/.test(r.error) && Date.now() - t0 < 10000, [r, Date.now() - t0]);\n\n  server.closeAllConnections?.(); server.close();\n  fs.rmSync(dir, { recursive: true, force: true });\n  console.log(failed ? `\\n${failed} FAILED` : \"\\nall passed\");\n  process.exit(failed ? 1 : 0);\n})().catch((e) => { console.error(\"TEST CRASHED:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-share-fix.bak";
const MARK = "Added by aura-share-fix-setup.cjs";
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

// ── Main file: the Share button uses share.js ────────────────────────────────
function editMain(text) {
  if (/require\(\s*["']\.\/share["']\s*\)\.shareClip\(/.test(text)) return { text, notes: [] };
  if (!/^function getClipFolder\s*\(/m.test(text)) throw new Error("the clip folder helper ( function getClipFolder() )");
  const lines = text.split("\n");
  const start = findLine(lines, /^ipcMain\.handle\(\s*["']share-clip["']\s*,/);
  if (start < 0) throw new Error('the Share button\'s code ( ipcMain.handle("share-clip", ... )');
  const end = findLine(lines, /^\}\);\s*$/, start + 1, Math.min(lines.length, start + 80));
  if (end < 0) throw new Error('the end of the Share code ( the  });  that closes ipcMain.handle("share-clip", ... )');
  lines.splice(start, end - start + 1,
    "// Share: uploads a clip from the clip folder and hands back its link (see share.js)",
    'ipcMain.handle("share-clip", async (_e, filePath) => require("./share").shareClip(filePath, { clipFolder: getClipFolder() }));');
  return { text: lines.join("\n"), notes: ["Share uploads clips the way Catbox expects, with a backup site and plain-word errors"] };
}

// ── App file: say when a link only lasts 3 days ──────────────────────────────
function editApp(text) {
  if (/if \(res\.note\) alert\(res\.note\)/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  const at = findLine(lines, /^\s*setShareLinks\(s\s*=>\s*\(\{\s*\.\.\.s,\s*\[clip\.id\]:\s*res\.url\s*\}\)\);\s*$/);
  if (at < 0) return { text, notes: ["(couldn't find where the Share link is shown, so you won't be told when a link only lasts 3 days. Sharing still works.)"] };
  lines.splice(at + 1, 0, indentOf(lines[at]) + "if (res.note) alert(res.note); // e.g. the link only lasts 3 days");
  return { text: lines.join("\n"), notes: ["tells you when a link only lasts 3 days"] };
}

// ── AURA's checks (only when they are installed): add the sharing ones ────────
function editRunner(text) {
  if (/share\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  const at = findLine(lines, /^if \(fs\.existsSync\(errorlog\)\) add\(/);
  if (at < 0) return { text, notes: ["(couldn't find where to add the sharing checks, so npm test doesn't include them)"] };
  lines.splice(at + 1, 0,
    'const shareFile = path.join(ROOT, "electron", "share.js");',
    'if (fs.existsSync(shareFile) && fs.existsSync(path.join(__dirname, "share.cjs"))) add("files", "Sharing clips", "share.cjs", [shareFile]);');
  return { text: lines.join("\n"), notes: ["npm test now checks sharing too"] };
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
      } else if (entry.name === "share.js" || entry.name === "share.cjs") {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. Share is back to how it was." : "Nothing to undo.");
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
    main: findOne("your main file", (t) => /ipcMain\.handle\(\s*["']share-clip["']/.test(t), need, [
      (h) => startFile && sameFile(h.file, startFile),
      (h) => /^function getClipFolder\s*\(/m.test(h.text),
    ]),
    app: findOne("your App file", (t) => /function AuraApp\s*\(/.test(t) && /<AuraApp\b/.test(t), need, [
      (h) => /shareClip\(/.test(h.text),
      (h) => /^App\.[jt]sx?$/.test(path.basename(h.file)),
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
  consider("main file", files.main, editMain, true);
  consider("App file", files.app, editApp, false);
  const runner = path.join(ROOT, "tests", "run.cjs");
  const hasChecks = fs.existsSync(runner);
  if (hasChecks) consider("checks", runner, editRunner, true);

  const created = [{ label: "share", file: path.join(path.dirname(files.main), "share.js"), content: FILES.share }];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "share.cjs"), content: FILES.test });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: sharing clips");
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
  say("Done. Restart AURA (stop it in the terminal and start it again), then press Share on a clip.");
  if (hasChecks) say("Run  npm test  before your next release.");
  say("To undo later:  node aura-share-fix-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
