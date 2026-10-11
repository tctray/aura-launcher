// Sharing clips when the sharing sites are down (electron/share.js), against a stand-in for
// Catbox and Litterbox on this PC that answers the way they do when they are overloaded: with
// an error page full of code. AURA must say what happened in plain words and never show the code.
// Also checks the share window's Copy button has what it needs to say "Copied!".
// Added by aura-share-message-setup.cjs.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const ROOT = path.resolve(__dirname, "..");
const { shareClip } = require(path.resolve(process.argv[2] || path.join(ROOT, "electron", "share.js")));
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };

// The kind of page a site's front door sends when the site behind it doesn't answer: a title,
// then thousands of characters of styles before any words.
const STYLES = ":root{--color-bg-primary:#07354a;--color-text-primary:rgba(255, 255, 255, 0.86);--color-text-secondary:rgba(255, 255, 255, 0.6);--font:system-ui}" + "body{margin:0;background:var(--color-bg-primary);color:var(--color-text-primary)}.box{display:flex;padding:24px}".repeat(60);
const gatewayPage = (code, words) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${code} | ${words}</title><style>${STYLES}</style><script>window.__data={"ray":"abc123","ok":false};function retry(){location.reload()}</script></head><body><div class="box"><h1>${words}</h1><p>The web server reported a ${words.toLowerCase()} error.</p></div></body></html>`;
const CODE = /[<>{}]|:root|--color|rgba\(|var\(|function\b|window\.|<\/?\w/;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-share-errors-"));
  const clips = path.join(dir, "Clips");
  fs.mkdirSync(clips, { recursive: true });
  const clip = path.join(clips, "clip-1.webm");
  fs.writeFileSync(clip, Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(50000, 7)]));

  let behave = {};
  const server = http.createServer((req, res) => {
    const site = req.headers["x-site"];
    req.on("data", () => {});
    req.on("end", () => {
      const mode = behave[site];
      if (mode === "hangup") return req.socket.destroy();
      if (mode === "504") { res.writeHead(504, { "Content-Type": "text/html" }); return res.end(gatewayPage(504, "Gateway Timeout")); }
      if (mode === "502") { res.writeHead(502, { "Content-Type": "text/html" }); return res.end(gatewayPage(502, "Bad Gateway")); }
      if (mode === "paused") { res.writeHead(403, { "Content-Type": "text/plain" }); return res.end("Uploads are paused for maintenance"); }
      if (mode === "code-only") { res.writeHead(403, { "Content-Type": "text/html" }); return res.end(`<style>${STYLES}</style><script>var a={"b":1};</script>`); }
      if (mode === "json") { res.writeHead(400, { "Content-Type": "application/json" }); return res.end('{"error":{"code":"bad_request","detail":"reqtype missing"}}'); }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(site === "catbox.moe" ? "https://files.catbox.moe/ab12cd.webm" : "https://litter.catbox.moe/zz99yy.webm");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const request = (opts, cb) => http.request({ ...opts, hostname: "127.0.0.1", port, headers: { ...opts.headers, "x-site": opts.hostname } }, cb);
  const share = () => shareClip(clip, { clipFolder: clips, request, timeoutMs: 5000 });

  try {
    console.log("1. Both sites answer with an error page");
    behave = { "catbox.moe": "504", "litterbox.catbox.moe": "504" };
    let r = await share();
    check("it says both sites are having trouble, with the error number and its name", !r.success && /^Catbox and Litterbox \(the free sites AURA shares clips through\) are having trouble right now \(error 504, Gateway Timeout\)\./.test(r.error), r);
    check("it says the clip and AURA are fine, and to try again", /Nothing is wrong with your clip or with AURA\. Try again in a few minutes\.$/.test(r.error), r);
    check("none of the error page's code is shown", !CODE.test(r.error), r);
    check("the message is short enough to read in a pop-up", r.error.length < 240, r.error.length);
    behave = { "catbox.moe": "502", "litterbox.catbox.moe": "502" };
    r = await share();
    check("the same for other \"site is down\" answers (502)", !r.success && /having trouble right now \(error 502, Bad Gateway\)/.test(r.error) && !CODE.test(r.error), r);

    console.log("2. One hangs up, the other answers with an error page");
    behave = { "catbox.moe": "hangup", "litterbox.catbox.moe": "504" };
    r = await share();
    check("still one plain message naming both", !r.success && /^Catbox and Litterbox .* are having trouble right now \(error 504, Gateway Timeout\)/.test(r.error) && !CODE.test(r.error) && !/socket/i.test(r.error), r);

    console.log("3. A site refuses for a reason of its own");
    behave = { "catbox.moe": "paused", "litterbox.catbox.moe": "paused" };
    r = await share();
    check("its own plain words are passed on", !r.success && /Litterbox didn't accept the clip \(Uploads are paused for maintenance\)/.test(r.error), r);
    behave = { "catbox.moe": "code-only", "litterbox.catbox.moe": "code-only" };
    r = await share();
    check("an answer that is nothing but code: just the error number", !r.success && /didn't accept the clip \(error 403\)/.test(r.error) && !CODE.test(r.error), r);
    behave = { "catbox.moe": "json", "litterbox.catbox.moe": "json" };
    r = await share();
    check("the same for an answer in a programmer's format", !r.success && /didn't accept the clip \(error 400\)/.test(r.error) && !CODE.test(r.error), r);

    console.log("4. When a site is back");
    behave = { "catbox.moe": "504", "litterbox.catbox.moe": "ok" };
    r = await share();
    check("Catbox down, Litterbox up: the clip is shared, and you're told the link lasts 3 days", r.success && r.url === "https://litter.catbox.moe/zz99yy.webm" && /3 days/.test(r.note), r);
    behave = { "catbox.moe": "ok", "litterbox.catbox.moe": "ok" };
    r = await share();
    check("both up: shared as usual", r.success && r.url === "https://files.catbox.moe/ab12cd.webm" && r.note === "", r);

    console.log("5. A clip that is too big");
    // 201 MB, made without writing 201 MB to the disk
    const big = path.join(clips, "long-session.mp4");
    fs.writeFileSync(big, "x");
    fs.truncateSync(big, 201 * 1024 * 1024);
    let uploads = 0;
    const counting = (opts, cb) => { uploads++; return request(opts, cb); };
    const started = Date.now();
    r = await shareClip(big, { clipFolder: clips, request: counting, timeoutMs: 5000 });
    check("AURA says at once to trim it shorter, with the clip's size and the limit", !r.success && r.error === "This clip is 201 MB, which is too big to share. Clips up to 200 MB can be shared. Trim it shorter, then share the trimmed clip.", r);
    check("nothing was uploaded first, so there is no long wait", uploads === 0 && Date.now() - started < 2000, [uploads, Date.now() - started]);
    fs.truncateSync(big, 150 * 1024 * 1024);
    const sizes = [];
    const peek = (opts, cb) => { sizes.push(Number(opts.headers["Content-Length"])); const req = request(opts, cb); return req; };
    r = await shareClip(big, { clipFolder: clips, request: peek, timeoutMs: 60000 });
    check("a 150 MB clip is still shared as usual", r.success && r.url === "https://files.catbox.moe/ab12cd.webm" && sizes.length === 1 && sizes[0] > 150 * 1024 * 1024, [r, sizes]);
    try { fs.unlinkSync(big); } catch {}

    console.log("6. The share window");
    const app = (() => { try { return fs.readFileSync(path.join(ROOT, "src", "App.jsx"), "utf8"); } catch { return ""; } })();
    if (!app) console.log("  note  src/App.jsx isn't here, so the Copy button wasn't checked");
    else {
      const says = /toast\?\.\("Copied!"\)/.test(app);
      check("the Copy button can say \"Copied!\" (the clips page is given the way to show a message)", !says || (/function ClipsPage\(\{[^)]*\btoast\b[^)]*\}\)/.test(app) && /<ClipsPage\b[^>]*\btoast=\{toast\}/.test(app)));
    }
  } finally {
    server.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("The sharing check itself broke:", e); process.exit(2); });
