#!/usr/bin/env node
/**
 * AURA — sharing a clip: clear messages (trim a clip that's too big; sites down), and a working Copy button
 *
 * AURA shares clips through two free sites, Catbox and Litterbox. When they are down or
 * overloaded they answer with an error page, and AURA was showing pieces of that page's code:
 *     Litterbox didn't accept the clip (504 | Gateway Timeout :root{--color-bg-primary:#07354a;...
 * Now it says, in plain words, which site is having trouble and that your clip is fine:
 *     Catbox and Litterbox (the free sites AURA shares clips through) are having trouble right
 *     now (error 504, Gateway Timeout). Nothing is wrong with your clip or with AURA. Try again
 *     in a few minutes.
 * No page code is ever shown, whatever the site sends back.
 *
 * A clip that is too big: clips over 200 MB used to be sent to Litterbox, where a large upload
 * runs for minutes and then times out. Now AURA says straight away, before uploading anything:
 *     This clip is 412 MB, which is too big to share. Clips up to 200 MB can be shared. Trim it
 *     shorter, then share the trimmed clip.
 *
 * Also: the Copy button in the share window copied the link but hit an error before it could
 * say "Copied!". It says it now.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-share-message-setup.cjs
 *   4. Then:  npm test
 *
 * What it does:
 *   - edits    electron/share.js          the messages
 *   - edits    src/App.jsx                the Copy button
 *   - edits    tests/share.cjs            (only if AURA's checks are installed) one check's wording
 *   - creates  tests/share-errors.cjs     (same) checks the new messages
 *   - edits    tests/run.cjs              (same) so npm test runs it
 *
 * Every file it changes is copied to <name>.before-share-message.bak first.
 * To put everything back:                 node aura-share-message-setup.cjs --undo
 * To preview without changing anything:   node aura-share-message-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const EDITS = [{"kind":"insert","file":"share","label":"when the sharing sites are down, AURA says so in plain words and never shows an error page's code","done":"function plainWords(","aheadOf":"// What went wrong, in words a person can act on","text":"// What a site answered, as a few plain words, or \"\" if there are none worth showing. An error\n// page is mostly code (styles, scripts, markup); none of that is ever passed on.\n// Added by aura-share-message-setup.cjs.\nfunction plainWords(body) {\n  const text = String(body || \"\")\n    .replace(/<(style|script|svg|noscript)\\b[\\s\\S]*?<\\/\\1\\s*>/gi, \" \")   // whole blocks of code\n    .replace(/<(style|script|svg|noscript)\\b[\\s\\S]*$/i, \" \")             // one that was cut off before it ended\n    .replace(/<[^>]*>/g, \" \").replace(/<[^>]*$/, \" \")\n    .replace(/&[a-z#0-9]+;/gi, \" \").replace(/\\s+/g, \" \").trim();\n  // If anything that looks like code is left (CSS, JSON, half a tag), show none of it\n  return /[{}<>;]|--[\\w-]+\\s*:|:root\\b|\\bfunction\\b|\\bvar\\(/i.test(text) ? \"\" : text.slice(0, 120);\n}\nconst STATUS_WORDS = { 429: \"Too Many Requests\", 500: \"Internal Server Error\", 502: \"Bad Gateway\", 503: \"Service Unavailable\", 504: \"Gateway Timeout\", 520: \"Unknown Error\", 521: \"Web Server Is Down\", 522: \"Connection Timed Out\", 523: \"Origin Is Unreachable\", 524: \"A Timeout Occurred\" };\n// Their problem, not the clip's: the connection dropped, or the site answered that it is down or too busy\nconst siteIsDown = (p) => p.lost || p.status === 429 || (p.status >= 500 && p.status <= 599);\n\n"},{"kind":"re","file":"share","label":"when the sharing sites are down, AURA says so in plain words and never shows an error page's code","re":"text: \\(res\\.body \\|\\| \"\"\\)\\.replace\\(/<\\[\\^>\\]\\*>/g, \" \"\\)\\.replace\\(/\\\\s\\+/g, \" \"\\)\\.trim\\(\\)\\.slice\\(0, 120\\) \\|\\| \"error \" \\+ res\\.status, status: res\\.status \\}\\);","done":"text: plainWords(res.body) || \"error \" + res.status, status: res.status });","text":"text: plainWords(res.body) || \"error \" + res.status, status: res.status });"},{"kind":"insert","file":"share","label":"when the sharing sites are down, AURA says so in plain words and never shows an error page's code","done":"if (problems.length && problems.every(siteIsDown)) {","aheadOf":"if (last.status === 412 || /size|too large|exceed/i.test(last.text || \"\")) return","text":"    if (problems.length && problems.every(siteIsDown)) {\n      const names = [...new Set(problems.map((p) => p.target.name))];\n      const who = names.length > 1 ? names.join(\" and \") + \" (the free sites AURA shares clips through) are\" : names[0] + \" (the free site AURA shares clips through) is\";\n      const code = last.status ? \" (error \" + last.status + (STATUS_WORDS[last.status] ? \", \" + STATUS_WORDS[last.status] : \"\") + \")\" : \"\";\n      return { success: false, error: who + \" having trouble right now\" + code + \". Nothing is wrong with your clip or with AURA. Try again in a few minutes.\" };\n    }\n"},{"kind":"replace","file":"app","label":"the Copy button in the share window says \"Copied!\" (it copied, then hit an error)","done":"function ClipsPage({ nowPlayingGame, toast }) {","before":"function ClipsPage({ nowPlayingGame }) {","text":"function ClipsPage({ nowPlayingGame, toast }) {"},{"kind":"replace","file":"app","label":"the Copy button in the share window says \"Copied!\" (it copied, then hit an error)","done":"<ClipsPage nowPlayingGame={nowPlaying?.title} toast={toast}/>","before":"<ClipsPage nowPlayingGame={nowPlaying?.title}/>","text":"<ClipsPage nowPlayingGame={nowPlaying?.title} toast={toast}/>"},{"kind":"replace","file":"sharetest","label":"the sharing checks expect the new wording","done":"having trouble right now \\(error 500, Internal Server Error\\)","missingOk":true,"before":"  check(\"an error page: its words, not its code\", !r.success && /didn't accept the clip \\(Internal Server Error\\)/.test(r.error), r);","text":"  check(\"an error page from both sites: says they are having trouble, not its code\", !r.success && /Catbox and Litterbox .* are having trouble right now \\(error 500, Internal Server Error\\)/.test(r.error) && !/[<>{}]/.test(r.error), r);"},{"kind":"insert","file":"runner","label":"npm test now checks the new messages","after":"add(\"files\", \"Sharing clips\", \"share.cjs\", [shareFile]);","done":"share-errors.cjs","text":"if (fs.existsSync(shareFile) && fs.existsSync(path.join(__dirname, \"share-errors.cjs\"))) add(\"files\", \"Sharing clips: when the sharing sites are down\", \"share-errors.cjs\", [shareFile]);\n"},{"kind":"re","file":"share","label":"a clip over 200 MB isn't uploaded: AURA says straight away to trim it shorter (big uploads were timing out)","re":"^// Clips over 200 MB, or any clip while Catbox itself won't take uploads, go to Litterbox \\(run by\\n// the same people\\) instead, which keeps them for 3 days\\.\\n","done":"// A clip over 200 MB isn't uploaded at all","missingOk":true,"text":"// While Catbox itself won't take uploads, a clip goes to Litterbox (run by the same people)\n// instead, which keeps it for 3 days.\n// A clip over 200 MB isn't uploaded at all: AURA says to trim it shorter. (Bigger clips used to\n// go to Litterbox, where a large upload runs for minutes and then times out.)\n"},{"kind":"re","file":"share","label":"a clip over 200 MB isn't uploaded: AURA says straight away to trim it shorter (big uploads were timing out)","re":"^[ \\t]*const biggest = maxBytes \\|\\| LITTERBOX\\.max;\\n[ \\t]*if \\(size > biggest\\) return \\{ success: false, error: `This clip is \\$\\{sizeText\\(size\\)\\}\\. Clips up to \\$\\{sizeText\\(biggest\\)\\} can be shared; trim it in the clip editor first\\.` \\};\\n","done":"which is too big to share. Clips up to","text":"    const biggest = Math.min(maxBytes || CATBOX.max, CATBOX.max);\n    if (size > biggest) return { success: false, tooBig: true, error: `This clip is ${sizeText(size)}, which is too big to share. Clips up to ${sizeText(biggest)} can be shared. Trim it shorter, then share the trimmed clip.` };\n"},{"kind":"replace","file":"share","label":"a clip over 200 MB isn't uploaded: AURA says straight away to trim it shorter (big uploads were timing out)","done":"const targets = [CATBOX, LITTERBOX];","before":"const targets = size <= Math.min(CATBOX.max, biggest) ? [CATBOX, LITTERBOX] : [LITTERBOX];","text":"const targets = [CATBOX, LITTERBOX];"}];
const FILES = {"errors":"// Sharing clips when the sharing sites are down (electron/share.js), against a stand-in for\n// Catbox and Litterbox on this PC that answers the way they do when they are overloaded: with\n// an error page full of code. AURA must say what happened in plain words and never show the code.\n// Also checks the share window's Copy button has what it needs to say \"Copied!\".\n// Added by aura-share-message-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst os = require(\"os\");\nconst path = require(\"path\");\nconst http = require(\"http\");\nconst ROOT = path.resolve(__dirname, \"..\");\nconst { shareClip } = require(path.resolve(process.argv[2] || path.join(ROOT, \"electron\", \"share.js\")));\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok ? \"\" : \"  \" + JSON.stringify(extra))); };\n\n// The kind of page a site's front door sends when the site behind it doesn't answer: a title,\n// then thousands of characters of styles before any words.\nconst STYLES = \":root{--color-bg-primary:#07354a;--color-text-primary:rgba(255, 255, 255, 0.86);--color-text-secondary:rgba(255, 255, 255, 0.6);--font:system-ui}\" + \"body{margin:0;background:var(--color-bg-primary);color:var(--color-text-primary)}.box{display:flex;padding:24px}\".repeat(60);\nconst gatewayPage = (code, words) => `<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>${code} | ${words}</title><style>${STYLES}</style><script>window.__data={\"ray\":\"abc123\",\"ok\":false};function retry(){location.reload()}</script></head><body><div class=\"box\"><h1>${words}</h1><p>The web server reported a ${words.toLowerCase()} error.</p></div></body></html>`;\nconst CODE = /[<>{}]|:root|--color|rgba\\(|var\\(|function\\b|window\\.|<\\/?\\w/;\n\n(async () => {\n  const dir = fs.mkdtempSync(path.join(os.tmpdir(), \"aura-share-errors-\"));\n  const clips = path.join(dir, \"Clips\");\n  fs.mkdirSync(clips, { recursive: true });\n  const clip = path.join(clips, \"clip-1.webm\");\n  fs.writeFileSync(clip, Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(50000, 7)]));\n\n  let behave = {};\n  const server = http.createServer((req, res) => {\n    const site = req.headers[\"x-site\"];\n    req.on(\"data\", () => {});\n    req.on(\"end\", () => {\n      const mode = behave[site];\n      if (mode === \"hangup\") return req.socket.destroy();\n      if (mode === \"504\") { res.writeHead(504, { \"Content-Type\": \"text/html\" }); return res.end(gatewayPage(504, \"Gateway Timeout\")); }\n      if (mode === \"502\") { res.writeHead(502, { \"Content-Type\": \"text/html\" }); return res.end(gatewayPage(502, \"Bad Gateway\")); }\n      if (mode === \"paused\") { res.writeHead(403, { \"Content-Type\": \"text/plain\" }); return res.end(\"Uploads are paused for maintenance\"); }\n      if (mode === \"code-only\") { res.writeHead(403, { \"Content-Type\": \"text/html\" }); return res.end(`<style>${STYLES}</style><script>var a={\"b\":1};</script>`); }\n      if (mode === \"json\") { res.writeHead(400, { \"Content-Type\": \"application/json\" }); return res.end('{\"error\":{\"code\":\"bad_request\",\"detail\":\"reqtype missing\"}}'); }\n      res.writeHead(200, { \"Content-Type\": \"text/plain\" });\n      res.end(site === \"catbox.moe\" ? \"https://files.catbox.moe/ab12cd.webm\" : \"https://litter.catbox.moe/zz99yy.webm\");\n    });\n  });\n  await new Promise((r) => server.listen(0, \"127.0.0.1\", r));\n  const port = server.address().port;\n  const request = (opts, cb) => http.request({ ...opts, hostname: \"127.0.0.1\", port, headers: { ...opts.headers, \"x-site\": opts.hostname } }, cb);\n  const share = () => shareClip(clip, { clipFolder: clips, request, timeoutMs: 5000 });\n\n  try {\n    console.log(\"1. Both sites answer with an error page\");\n    behave = { \"catbox.moe\": \"504\", \"litterbox.catbox.moe\": \"504\" };\n    let r = await share();\n    check(\"it says both sites are having trouble, with the error number and its name\", !r.success && /^Catbox and Litterbox \\(the free sites AURA shares clips through\\) are having trouble right now \\(error 504, Gateway Timeout\\)\\./.test(r.error), r);\n    check(\"it says the clip and AURA are fine, and to try again\", /Nothing is wrong with your clip or with AURA\\. Try again in a few minutes\\.$/.test(r.error), r);\n    check(\"none of the error page's code is shown\", !CODE.test(r.error), r);\n    check(\"the message is short enough to read in a pop-up\", r.error.length < 240, r.error.length);\n    behave = { \"catbox.moe\": \"502\", \"litterbox.catbox.moe\": \"502\" };\n    r = await share();\n    check(\"the same for other \\\"site is down\\\" answers (502)\", !r.success && /having trouble right now \\(error 502, Bad Gateway\\)/.test(r.error) && !CODE.test(r.error), r);\n\n    console.log(\"2. One hangs up, the other answers with an error page\");\n    behave = { \"catbox.moe\": \"hangup\", \"litterbox.catbox.moe\": \"504\" };\n    r = await share();\n    check(\"still one plain message naming both\", !r.success && /^Catbox and Litterbox .* are having trouble right now \\(error 504, Gateway Timeout\\)/.test(r.error) && !CODE.test(r.error) && !/socket/i.test(r.error), r);\n\n    console.log(\"3. A site refuses for a reason of its own\");\n    behave = { \"catbox.moe\": \"paused\", \"litterbox.catbox.moe\": \"paused\" };\n    r = await share();\n    check(\"its own plain words are passed on\", !r.success && /Litterbox didn't accept the clip \\(Uploads are paused for maintenance\\)/.test(r.error), r);\n    behave = { \"catbox.moe\": \"code-only\", \"litterbox.catbox.moe\": \"code-only\" };\n    r = await share();\n    check(\"an answer that is nothing but code: just the error number\", !r.success && /didn't accept the clip \\(error 403\\)/.test(r.error) && !CODE.test(r.error), r);\n    behave = { \"catbox.moe\": \"json\", \"litterbox.catbox.moe\": \"json\" };\n    r = await share();\n    check(\"the same for an answer in a programmer's format\", !r.success && /didn't accept the clip \\(error 400\\)/.test(r.error) && !CODE.test(r.error), r);\n\n    console.log(\"4. When a site is back\");\n    behave = { \"catbox.moe\": \"504\", \"litterbox.catbox.moe\": \"ok\" };\n    r = await share();\n    check(\"Catbox down, Litterbox up: the clip is shared, and you're told the link lasts 3 days\", r.success && r.url === \"https://litter.catbox.moe/zz99yy.webm\" && /3 days/.test(r.note), r);\n    behave = { \"catbox.moe\": \"ok\", \"litterbox.catbox.moe\": \"ok\" };\n    r = await share();\n    check(\"both up: shared as usual\", r.success && r.url === \"https://files.catbox.moe/ab12cd.webm\" && r.note === \"\", r);\n\n    console.log(\"5. A clip that is too big\");\n    // 201 MB, made without writing 201 MB to the disk\n    const big = path.join(clips, \"long-session.mp4\");\n    fs.writeFileSync(big, \"x\");\n    fs.truncateSync(big, 201 * 1024 * 1024);\n    let uploads = 0;\n    const counting = (opts, cb) => { uploads++; return request(opts, cb); };\n    const started = Date.now();\n    r = await shareClip(big, { clipFolder: clips, request: counting, timeoutMs: 5000 });\n    check(\"AURA says at once to trim it shorter, with the clip's size and the limit\", !r.success && r.error === \"This clip is 201 MB, which is too big to share. Clips up to 200 MB can be shared. Trim it shorter, then share the trimmed clip.\", r);\n    check(\"nothing was uploaded first, so there is no long wait\", uploads === 0 && Date.now() - started < 2000, [uploads, Date.now() - started]);\n    fs.truncateSync(big, 150 * 1024 * 1024);\n    const sizes = [];\n    const peek = (opts, cb) => { sizes.push(Number(opts.headers[\"Content-Length\"])); const req = request(opts, cb); return req; };\n    r = await shareClip(big, { clipFolder: clips, request: peek, timeoutMs: 60000 });\n    check(\"a 150 MB clip is still shared as usual\", r.success && r.url === \"https://files.catbox.moe/ab12cd.webm\" && sizes.length === 1 && sizes[0] > 150 * 1024 * 1024, [r, sizes]);\n    try { fs.unlinkSync(big); } catch {}\n\n    console.log(\"6. The share window\");\n    const app = (() => { try { return fs.readFileSync(path.join(ROOT, \"src\", \"App.jsx\"), \"utf8\"); } catch { return \"\"; } })();\n    if (!app) console.log(\"  note  src/App.jsx isn't here, so the Copy button wasn't checked\");\n    else {\n      const says = /toast\\?\\.\\(\"Copied!\"\\)/.test(app);\n      check(\"the Copy button can say \\\"Copied!\\\" (the clips page is given the way to show a message)\", !says || (/function ClipsPage\\(\\{[^)]*\\btoast\\b[^)]*\\}\\)/.test(app) && /<ClipsPage\\b[^>]*\\btoast=\\{toast\\}/.test(app)));\n    }\n  } finally {\n    server.close();\n    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}\n  }\n  console.log(failed ? `\\n${failed} FAILED` : \"\\nall passed\");\n  process.exit(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The sharing check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-share-message.bak";
const MARK = "Added by aura-share-message-setup.cjs";
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "release", ".git", ".vite", "coverage"]);
const CREATED = ["share-errors.cjs"];
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
  app: ['<ClipsPage nowPlayingGame={nowPlaying?.title}/>'],
};
const REQUIRED = {
  share: ["function plainWords(", "having trouble right now", "which is too big to share. Clips up to", "const targets = [CATBOX, LITTERBOX];"],
  app: ["function ClipsPage({ nowPlayingGame, toast })", "toast={toast}/></PageBoundary>"],
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
    share: { file: path.join(ROOT, "electron", "share.js"), name: "sharing", js: true },
    app: { file: path.join(ROOT, "src", "App.jsx"), name: "window", js: false },
    sharetest: { file: path.join(ROOT, "tests", "share.cjs"), name: "checks", js: true, optional: true },
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
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "share-errors.cjs"), content: FILES.errors });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: sharing a clip");
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
  say("  " + (hasChecks ? "2" : "1") + ". Start AURA and share the big clip again. It should say at once to trim it shorter.");
  say("     Trim it, share the trimmed clip, then press Copy: it should say Copied!");
  say();
  say("To undo later:  node aura-share-message-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
