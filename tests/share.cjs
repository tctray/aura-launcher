// Sharing clips (electron/share.js), against a stand-in for Catbox and Litterbox on this PC.
// Added by aura-share-fix-setup.cjs.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { shareClip } = require(path.resolve(process.argv[2] || path.join(__dirname, "..", "electron", "share.js")));
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-share-"));
  const clips = path.join(dir, "Clips"), game = path.join(clips, "Elden Ring");
  fs.mkdirSync(game, { recursive: true });
  const clip = path.join(game, "clip-1.webm");
  const bytes = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(300000, 7)]);
  fs.writeFileSync(clip, bytes);
  const secret = path.join(dir, "passwords.txt"); fs.writeFileSync(secret, "hunter2");
  fs.writeFileSync(path.join(clips, "notes.txt"), "x");

  // What each pretend site does with an upload
  const got = [];
  let behave = { "catbox.moe": "ok", "litterbox.catbox.moe": "ok" };
  const server = http.createServer((req, res) => {
    const site = req.headers["x-site"];
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      got.push({ site, path: req.url, headers: req.headers, body });
      const mode = Array.isArray(behave[site]) ? behave[site].shift() : behave[site];
      if (mode === "hangup") return req.socket.destroy();
      if (mode === "stall") return; // never answers
      if (mode === "big") { res.writeHead(412); return res.end("File size too large"); }
      if (mode === "html") { res.writeHead(500); return res.end("<html><body><h1>Internal Server Error</h1></body></html>"); }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(site === "catbox.moe" ? "https://files.catbox.moe/ab12cd.webm" : "https://litter.catbox.moe/zz99yy.webm");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const request = (opts, cb) => http.request({ ...opts, hostname: "127.0.0.1", port, headers: { ...opts.headers, "x-site": opts.hostname } }, cb);
  const share = (file, more = {}) => shareClip(file, { clipFolder: clips, request, ...more });
  const field = (body, name) => { const m = body.toString("latin1").match(new RegExp(`name="${name}"(?:; filename="([^"]*)")?\\r\\n(?:Content-Type: ([^\\r]+)\\r\\n)?\\r\\n`)); return m; };

  console.log("1. Sharing a clip");
  let r = await share(clip);
  const up = got[got.length - 1];
  check("it uploads to Catbox and hands back the link", r.success && r.url === "https://files.catbox.moe/ab12cd.webm" && r.note === "" && up.site === "catbox.moe" && up.path === "/user/api.php", [r, up && up.site]);
  check("the upload says how big it is up front (Catbox hangs up otherwise)", Number(up.headers["content-length"]) === up.body.length && !up.headers["transfer-encoding"], [up.headers["content-length"], up.body.length, up.headers["transfer-encoding"]]);
  check("it is a normal form upload: reqtype=fileupload and the file", /^multipart\/form-data; boundary=/.test(up.headers["content-type"]) && /name="reqtype"\r\n\r\nfileupload\r\n/.test(up.body.toString("latin1")) && field(up.body, "fileToUpload")?.[1] === "clip-1.webm" && field(up.body, "fileToUpload")?.[2] === "video/webm", up.headers["content-type"]);
  check("the whole clip arrives, byte for byte", up.body.includes(bytes));
  check("AURA names itself", up.headers["user-agent"] === "AURA-Launcher");

  console.log("2. Only clips from the clip folder");
  const before = got.length;
  check("a file outside the clip folder is refused", (await share(secret)).error === "Only clips in your AURA clip folder can be shared.");
  check("so is a sneaky path that climbs out of it", (await share(path.join(game, "..", "..", "passwords.txt"))).error === "Only clips in your AURA clip folder can be shared.");
  check("so is something that isn't a clip", /Only video clips/.test((await share(path.join(clips, "notes.txt"))).error));
  check("a clip that has gone says so", /isn't there any more/.test((await share(path.join(game, "gone.mp4"))).error));
  check("nothing is asked for", (await share(null)).error === "No clip was chosen." && (await shareClip(clip, { request })).error === "Only clips in your AURA clip folder can be shared.");
  check("none of those were uploaded", got.length === before);

  console.log("3. When Catbox has trouble");
  behave["catbox.moe"] = ["hangup", "ok"];
  r = await share(clip);
  check("a dropped connection gets one more go", r.success && r.url.startsWith("https://files.catbox.moe/"), r);
  behave["catbox.moe"] = "hangup";
  let n = got.length;
  r = await share(clip);
  check("Catbox hanging up every time: the clip goes to Litterbox, and you're told the link lasts 3 days", r.success && r.url === "https://litter.catbox.moe/zz99yy.webm" && /works for 3 days/.test(r.note) && /Catbox wasn't taking uploads/.test(r.note), r);
  const lit = got[got.length - 1];
  check("Litterbox is asked to keep it 72 hours", lit.site === "litterbox.catbox.moe" && lit.path === "/resources/internals/api.php" && /name="time"\r\n\r\n72h\r\n/.test(lit.body.toString("latin1")) && got.length - n >= 2, lit.path);
  behave = { "catbox.moe": "hangup", "litterbox.catbox.moe": "hangup" };
  r = await share(clip);
  check("both hanging up: a plain message instead of 'socket hang up'", !r.success && /isn't answering or closed the connection/.test(r.error) && !/socket/.test(r.error), r);
  behave = { "catbox.moe": "html", "litterbox.catbox.moe": "html" };
  r = await share(clip);
  check("an error page: its words, not its code", !r.success && /didn't accept the clip \(Internal Server Error\)/.test(r.error), r);
  behave = { "catbox.moe": "big", "litterbox.catbox.moe": "big" };
  r = await share(clip);
  check("too big for them: says to trim it", !r.success && /too big/.test(r.error) && /clip editor/.test(r.error), r);
  behave = { "catbox.moe": "ok", "litterbox.catbox.moe": "ok" };
  r = await share(clip, { maxBytes: 100000 });
  check("bigger than can be shared at all: says so before uploading", !r.success && /Clips up to/.test(r.error), r);
  behave = { "catbox.moe": "stall", "litterbox.catbox.moe": "stall" };
  const t0 = Date.now();
  r = await share(clip, { timeoutMs: 300 });
  check("a stuck upload is stopped instead of waiting for ever", !r.success && /isn't answering/.test(r.error) && Date.now() - t0 < 10000, [r, Date.now() - t0]);

  server.closeAllConnections?.(); server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST CRASHED:", e); process.exit(2); });
