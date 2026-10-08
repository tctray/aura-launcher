// AURA — sharing a clip.
//
// Uploads one clip to Catbox (catbox.moe: free, no account) and hands back its public link.
// Anyone with the link can watch the clip, so AURA only ever uploads a clip from your clip
// folder, and only when you press Share.
//
// Clips over 200 MB, or any clip while Catbox itself won't take uploads, go to Litterbox (run by
// the same people) instead, which keeps them for 3 days.
//
// Added by aura-share-fix-setup.cjs. Wired up from the main file with one line:
//   ipcMain.handle("share-clip", async (_e, filePath) => require("./share").shareClip(filePath, { clipFolder: getClipFolder() }));
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

const MB = 1024 * 1024;
const CATBOX = { name: "Catbox", hostname: "catbox.moe", path: "/user/api.php", max: 200 * MB, link: /^https:\/\/files\.catbox\.moe\/[A-Za-z0-9._-]+$/ };
const LITTERBOX = { name: "Litterbox", hostname: "litterbox.catbox.moe", path: "/resources/internals/api.php", max: 1024 * MB, fields: { time: "72h" }, link: /^https:\/\/litter\.catbox\.moe\/[A-Za-z0-9._-]+$/ };
const TYPES = { ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".gif": "image/gif" };
const TIMEOUT_MS = 10 * 60 * 1000;  // a big clip on a slow connection can take a while
const sizeText = (n) => (n >= 10 * MB ? Math.round(n / MB) : (n / MB).toFixed(1)) + " MB";

// Is `file` somewhere inside `folder`?
function inside(file, folder) {
  const r = path.relative(path.resolve(folder), path.resolve(file));
  return !!r && !r.startsWith("..") && !path.isAbsolute(r);
}

// Sends the file as a normal form upload, with its full size stated up front. (The old code sent
// it in pieces without saying how big it was, which Catbox answers by hanging up.)
function upload(target, filePath, size, { request = https.request, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const boundary = "----AURA" + crypto.randomBytes(12).toString("hex");
    const field = (name, value) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
    const fileName = path.basename(filePath).replace(/["\r\n\\]/g, "_");
    const head = Buffer.from(
      field("reqtype", "fileupload") + Object.entries(target.fields || {}).map(([k, v]) => field(k, v)).join("") +
      `--${boundary}\r\nContent-Disposition: form-data; name="fileToUpload"; filename="${fileName}"\r\nContent-Type: ${TYPES[path.extname(filePath).toLowerCase()]}\r\n\r\n`);
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };
    const req = request({
      hostname: target.hostname, path: target.path, method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=" + boundary, "Content-Length": head.length + size + tail.length, "User-Agent": "AURA-Launcher", Accept: "text/plain" },
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d) => { if (body.length < 4000) body += d; });
      res.on("end", () => done(resolve, { status: res.statusCode, body: body.trim() }));
      res.on("error", (e) => done(reject, e));
    });
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })));
    req.on("error", (e) => done(reject, e));
    const stream = fs.createReadStream(filePath);
    stream.on("error", (e) => { req.destroy(e); done(reject, e); });
    stream.on("end", () => req.end(tail));
    req.write(head);
    stream.pipe(req, { end: false });
  });
}

// What went wrong, in words a person can act on
const lostConnection = (e) => /socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|ENETUNREACH|timed out/i.test(String(e?.code || "") + " " + String(e?.message || ""));

// Returns { success: true, url, note } or { success: false, error }
async function shareClip(filePath, { clipFolder, request, timeoutMs, maxBytes } = {}) {
  try {
    if (typeof filePath !== "string" || !filePath) return { success: false, error: "No clip was chosen." };
    if (!clipFolder || !inside(filePath, clipFolder)) return { success: false, error: "Only clips in your AURA clip folder can be shared." };
    if (!TYPES[path.extname(filePath).toLowerCase()]) return { success: false, error: "Only video clips (MP4, WebM, MOV, MKV) and GIFs can be shared." };
    let size = 0;
    try { const st = fs.statSync(filePath); if (!st.isFile()) throw new Error(); size = st.size; }
    catch { return { success: false, error: "That clip isn't there any more. It may have been moved or deleted." }; }
    if (!size) return { success: false, error: "That clip is empty, so there's nothing to share." };
    const biggest = maxBytes || LITTERBOX.max;
    if (size > biggest) return { success: false, error: `This clip is ${sizeText(size)}. Clips up to ${sizeText(biggest)} can be shared; trim it in the clip editor first.` };

    const targets = size <= Math.min(CATBOX.max, biggest) ? [CATBOX, LITTERBOX] : [LITTERBOX];
    const problems = [];
    for (const target of targets) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        let res;
        try { res = await upload(target, filePath, size, { request, timeoutMs }); }
        catch (e) {
          problems.push({ target, lost: lostConnection(e), text: String(e?.message || e) });
          if (lostConnection(e) && attempt === 1) { await new Promise((r) => setTimeout(r, 1500)); continue; } // one more go after a dropped connection
          break;
        }
        if (res.status === 200 && target.link.test(res.body)) {
          const note = target === LITTERBOX ? (size > CATBOX.max
            ? `Shared. This clip is ${sizeText(size)}, over Catbox's 200 MB limit, so it went to Litterbox and the link works for 3 days.`
            : "Shared. Catbox wasn't taking uploads just now, so it went to Litterbox and the link works for 3 days.") : "";
          return { success: true, url: res.body, note };
        }
        problems.push({ target, lost: false, text: (res.body || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "error " + res.status, status: res.status });
        break; // a clear "no" doesn't change by asking again
      }
    }
    const last = problems[problems.length - 1] || {};
    if (problems.every((p) => p.lost)) return { success: false, error: "Couldn't upload the clip: Catbox (the free site AURA shares clips through) isn't answering or closed the connection. Check your internet, or try again in a few minutes." };
    if (last.status === 412 || /size|too large|exceed/i.test(last.text || "")) return { success: false, error: `${last.target.name} says the clip is too big (${sizeText(size)}). Trim it in the clip editor and try again.` };
    return { success: false, error: `${(last.target || CATBOX).name} didn't accept the clip (${last.text}). Try again in a few minutes.` };
  } catch (e) {
    return { success: false, error: "Couldn't share the clip: " + (e?.message || "unknown problem") };
  }
}

module.exports = { shareClip, upload, CATBOX, LITTERBOX };
