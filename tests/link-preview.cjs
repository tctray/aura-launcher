// Link previews (electron/linkpreview.js): what is looked up, what is refused, and what a saved
// preview may hold. Uses a pretend internet, so it never goes online.
// Added by aura-messages-links-setup.cjs.
"use strict";
const path = require("path");
const { linkPreview, cleanLink, checkUrl, privateIp, youtubeId } = require(path.join(__dirname, "..", "electron", "linkpreview.js"));
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };

// ── A pretend internet ───────────────────────────────────────────────────────
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]);
const DNS = { "example.com": "93.184.216.34", "www.youtube.com": "142.250.1.1", "i.ytimg.com": "142.250.1.2", "store.steampowered.com": "23.1.1.1", "shared.akamai.steamstatic.com": "23.1.1.2",
  "evil.example": "192.168.1.10", "rebind.example": "127.0.0.1", "cdn.example.com": "93.184.216.35", "www.twitch.tv": "151.101.1.1", "bounce.example.com": "93.184.216.36", "big.example.com": "93.184.216.37", "file.example.com": "93.184.216.38" };
const asked = [];
const page = (html, type = "text/html; charset=utf-8") => ({ status: 200, type, body: Buffer.from(html) });
const SITES = {
  "https://example.com/post": page(`<html><head><title>Ignored title</title>
    <meta property="og:title" content="Patch notes &amp; more">
    <meta property="og:description" content='Big &quot;changes&quot; this week&#33;'>
    <meta property="og:site_name" content="Example News">
    <meta property="og:image" content="/img/cover.jpg"></head><body>hi</body></html>`),
  "https://example.com/img/cover.jpg": { status: 200, type: "image/jpeg", body: JPEG },
  "https://example.com/streamed": { ...page(`<meta property="og:title" content="Sent in pieces">`), stream: true },
  "https://example.com/plain": page("<html><head><title>  Just a   title </title></head></html>"),
  "https://example.com/local-picture": page(`<meta property="og:title" content="Sneaky"><meta property="og:image" content="https://evil.example/x.jpg">`),
  "https://example.com/redirect-home": { status: 302, location: "https://evil.example/admin" },
  "https://bounce.example.com/go": { status: 301, location: "/landing" },
  "https://bounce.example.com/landing": page(`<meta name="twitter:title" content="Landed"><meta name="description" content="After a redirect">`),
  "https://example.com/file.zip": { status: 200, type: "application/zip", body: Buffer.alloc(100) },
  "https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ": page(JSON.stringify({ title: "Never Gonna Give You Up", author_name: "Rick Astley" }), "application/json"),
  "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg": { status: 200, type: "image/jpeg", body: JPEG },
  "https://store.steampowered.com/api/appdetails?cc=us&l=english&appids=367520": page(JSON.stringify({ 367520: { success: true, data: { name: "Hollow Knight", short_description: "Forge your own path in <b>Hollow Knight</b>!", is_free: false, price_overview: { final_formatted: "$14.99" }, header_image: "https://shared.akamai.steamstatic.com/header.jpg" } } }), "application/json"),
  "https://shared.akamai.steamstatic.com/header.jpg": { status: 200, type: "image/jpeg", body: JPEG },
  "https://www.twitch.tv/somestreamer": page(`<meta property="og:title" content="somestreamer - Twitch"><meta property="og:description" content="Playing games">`),
  "https://big.example.com/huge.jpg": { status: 200, type: "image/jpeg", body: Buffer.alloc(5 * 1024 * 1024, 1) },
  "https://big.example.com/page": page(`<meta property="og:title" content="Huge picture"><meta property="og:image" content="https://big.example.com/huge.jpg">`),
};
async function fetchFn(url, opts) {
  asked.push(url);
  const site = SITES[url];
  if (!site) return { status: 404, ok: false, headers: new Map(), body: null, arrayBuffer: async () => new ArrayBuffer(0) };
  const headers = new Map([["content-type", site.type || ""], ["location", site.location || null], ["content-length", String(site.body?.length || 0)]]);
  return {
    status: site.status, ok: site.status >= 200 && site.status < 300,
    headers: { get: (k) => headers.get(k.toLowerCase()) ?? null },
    body: site.stream ? { getReader() { const parts = [site.body.subarray(0, 20), site.body.subarray(20)]; return { read: async () => (parts.length ? { done: false, value: new Uint8Array(parts.shift()) } : { done: true }), cancel: async () => {} }; } } : null,
    arrayBuffer: async () => site.body || new ArrayBuffer(0),
    redirect: opts.redirect,
  };
}
const lookup = async (host) => { if (!DNS[host]) throw new Error("ENOTFOUND"); return [{ address: DNS[host], family: 4 }]; };
const preview = (url) => linkPreview(url, { fetchFn, lookup });

(async () => {
  console.log("1. Which links are looked up");
  check("only https", !checkUrl("http://example.com/") && !!checkUrl("https://example.com/"));
  check("never with a password, an odd port, or this PC", !checkUrl("https://user:pw@example.com/") && !checkUrl("https://example.com:8080/") && !checkUrl("https://localhost/") && !checkUrl("https://127.0.0.1/") && !checkUrl("https://192.168.0.5/") && !checkUrl("https://[::1]/") && !checkUrl("https://printer.local/"));
  check("private and special addresses are recognised", ["10.0.0.1", "172.20.1.1", "169.254.1.1", "100.64.0.1", "::ffff:127.0.0.1", "fe80::1", "fd00::5", "0.0.0.0"].every(privateIp) && !privateIp("93.184.216.34") && !privateIp("2606:4700::1111"));
  asked.length = 0;
  check("a site whose name points at the local network isn't visited", (await preview("https://evil.example/router")) === null && (await preview("https://rebind.example/")) === null && asked.length === 0, asked);
  check("nor is one reached by a redirect", (await preview("https://example.com/redirect-home")) === null && !asked.some((u) => /evil/.test(u)), asked);

  console.log("2. What a preview says");
  let p = await preview("https://example.com/post");
  check("title, description and site name come from the page", p && p.kind === "page" && p.title === "Patch notes & more" && p.description === 'Big "changes" this week!' && p.site === "Example News", p);
  check("...with its picture, fetched by this PC", p && p.image && p.image.mime === "image/jpeg" && p.image.bytes.length === JPEG.length);
  p = await preview("https://example.com/streamed");
  check("a page that arrives in pieces is read whole", p && p.title === "Sent in pieces", p);
  p = await preview("https://example.com/plain");
  check("a page with only a <title> still gets one, tidied", p && p.title === "Just a title" && p.site === "example.com" && !p.image, p);
  p = await preview("https://example.com/local-picture");
  check("a picture on the local network is left out", p && p.title === "Sneaky" && !p.image, p);
  p = await preview("https://bounce.example.com/go");
  check("a normal redirect is followed", p && p.title === "Landed" && p.description === "After a redirect", p);
  check("a file isn't previewed", (await preview("https://example.com/file.zip")) === null);
  check("a page that doesn't exist isn't either", (await preview("https://example.com/nothing")) === null);
  p = await preview("https://big.example.com/page");
  check("a huge picture is left out", p && p.title === "Huge picture" && !p.image, p);

  console.log("3. YouTube, Steam and Twitch");
  check("YouTube video ids are found in every kind of link", ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "https://youtu.be/dQw4w9WgXcQ", "https://m.youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ"].every((u) => youtubeId(new URL(u)) === "dQw4w9WgXcQ") && !youtubeId(new URL("https://www.youtube.com/watch?v=short")));
  p = await preview("https://youtu.be/dQw4w9WgXcQ");
  check("a YouTube link: the video's title, channel and picture", p && p.kind === "youtube" && p.videoId === "dQw4w9WgXcQ" && p.title === "Never Gonna Give You Up" && p.description === "Rick Astley" && p.site === "YouTube" && !!p.image, p);
  p = await preview("https://store.steampowered.com/app/367520/Hollow_Knight/");
  check("a Steam store link: the game's name, price and picture from Steam", p && p.kind === "steam" && p.appId === "367520" && p.title === "Hollow Knight" && p.price === "$14.99" && /Forge your own path in Hollow Knight/.test(p.description) && !!p.image, p);
  p = await preview("https://www.twitch.tv/somestreamer");
  check("a Twitch link is marked as Twitch", p && p.kind === "twitch" && p.site === "Twitch" && p.title === "somestreamer - Twitch", p);

  console.log("4. What a saved preview may hold");
  const thumb = "data:image/jpeg;base64," + Buffer.from("x".repeat(100)).toString("base64");
  check("a good preview is kept as it is", JSON.stringify(cleanLink({ url: "https://example.com/post", kind: "page", title: "T", description: "D", site: "S", image: thumb })) === JSON.stringify({ url: "https://example.com/post", kind: "page", title: "T", description: "D", site: "S", image: thumb }));
  check("anything not https is dropped", cleanLink({ url: "javascript:alert(1)", title: "x" }) === null && cleanLink({ url: "http://example.com", title: "x" }) === null && cleanLink({ url: "https://127.0.0.1/", title: "x" }) === null);
  check("only a small JPEG made by AURA can be its picture", !cleanLink({ url: "https://example.com/", title: "x", image: "https://tracker.example/pixel.gif" }).image && !cleanLink({ url: "https://example.com/", title: "x", image: "data:image/svg+xml;base64,PHN2Zz4=" }).image && !cleanLink({ url: "https://example.com/", title: "x", image: "data:image/jpeg;base64," + "A".repeat(70000) }).image);
  check("text is cut to size and control characters go", cleanLink({ url: "https://example.com/", title: "a\u0000b" + "c".repeat(300) }).title.length === 200 && !/\u0000/.test(cleanLink({ url: "https://example.com/", title: "a\u0000b" }).title));
  check("a YouTube preview needs a real video id, a Steam one a real app id", cleanLink({ url: "https://youtu.be/x", kind: "youtube", title: "x", videoId: "../../evil" }) === null && cleanLink({ url: "https://store.steampowered.com/app/1", kind: "steam", title: "x", appId: "1;drop" }) === null);
  check("an unknown kind becomes a plain page", cleanLink({ url: "https://example.com/", kind: "script", title: "x" }).kind === "page");
  check("an empty preview is dropped", cleanLink({ url: "https://example.com/" }) === null && cleanLink("text") === null && cleanLink([]) === null);

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("The link preview check itself broke:", e); process.exit(2); });
