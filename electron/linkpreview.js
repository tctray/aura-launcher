// Link previews for messages. Added by aura-messages-links-setup.cjs
// (YouTube videos always get a card, and big pages are read further: Added by aura-links-youtube-fix-setup.cjs)
//
// When you type a link in a message, the main process (never the window) looks the page up and
// returns its title, a short description, the site's name and its picture. The window shrinks the
// picture to a small JPEG, and it is all saved with the message, so the person you send it to
// never visits the website just because the message arrived.
//
// Only https pages on the public internet are looked up: never this PC, the local network, or an
// address with a password in it, and the same goes for every redirect and for the picture.
// YouTube links get the video's id (it plays in the chat when clicked) and Steam store links get
// the game's name, picture and price from Steam.
"use strict";
const dns = require("dns").promises;
const net = require("net");

const PAGE_MAX = 3 * 1024 * 1024;     // read at most this much of a page (YouTube's pages are big, and keep their titles far down)
const IMAGE_MAX = 4 * 1024 * 1024;    // and of its picture
const TIMEOUT_MS = 7000;
const AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 AURA-link-preview";
const KINDS = ["page", "youtube", "twitch", "steam"];
const URL_MAX = 2000;

// ── Which addresses may be looked up ─────────────────────────────────────────
function privateV4(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
function privateIp(ip) {
  if (net.isIPv4(ip)) return privateV4(ip);
  if (!net.isIPv6(ip)) return true;
  const v = ip.toLowerCase();
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateV4(mapped[1]);
  return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v) || /^64:ff9b:/.test(v) || /^2001:db8:/.test(v);
}
// A link AURA will look at: https, no password, the normal port, a real host name
function checkUrl(raw) {
  let u = null;
  try { u = new URL(String(raw || "").trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !/\./.test(host)) return null;
  if (net.isIP(host) && privateIp(host)) return null;
  if (u.href.length > URL_MAX) return null;
  u.hash = "";
  return u;
}
async function publicHost(u, lookup) {
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return !privateIp(host);
  try {
    const found = await lookup(host, { all: true, verbatim: true });
    return Array.isArray(found) && found.length > 0 && found.every((a) => !privateIp(a.address));
  } catch { return false; }
}

// ── Fetching, carefully ──────────────────────────────────────────────────────
// Follows at most 4 redirects, checking each address. Reads at most `max` bytes.
async function careful(raw, { fetchFn, lookup, max, accept }) {
  let u = checkUrl(raw);
  for (let hop = 0; hop < 5 && u; hop++) {
    if (!(await publicHost(u, lookup))) return null;
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), TIMEOUT_MS);
    let res = null;
    try {
      res = await fetchFn(u.href, { redirect: "manual", signal: stop.signal, headers: { "User-Agent": AGENT, Accept: accept, "Accept-Language": "en-US,en;q=0.8" } });
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get("location");
        try { res.body?.cancel?.(); } catch {}
        u = next ? checkUrl(new URL(next, u).href) : null;
        continue;
      }
      if (!res.ok) { try { res.body?.cancel?.(); } catch {} return null; }
      const length = Number(res.headers.get("content-length") || 0);
      if (length > max * 4) { try { res.body?.cancel?.(); } catch {} return null; }
      const chunks = [];
      let size = 0;
      if (res.body && typeof res.body.getReader === "function") {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          chunks.push(Buffer.from(value));
          if (size >= max) { try { await reader.cancel(); } catch {} break; }
        }
      } else {
        const buf = Buffer.from(await res.arrayBuffer());
        chunks.push(buf.subarray(0, max)); size = Math.min(buf.length, max);
      }
      return { url: u, type: String(res.headers.get("content-type") || "").toLowerCase(), bytes: Buffer.concat(chunks).subarray(0, max), complete: size < max };
    } catch { return null; }
    finally { clearTimeout(timer); }
  }
  return null;
}

// ── Reading a page ───────────────────────────────────────────────────────────
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
function decode(text) {
  return String(text || "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (all, e) => {
      if (/^#x/i.test(e)) { const n = parseInt(e.slice(2), 16); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; }
      if (/^#\d/.test(e)) { const n = parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; }
      return ENTITIES[e.toLowerCase()] ?? all;
    })
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ").trim();
}
const cut = (text, n) => { const t = decode(text); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; };
function metaTags(html) {
  const head = html;
  const tags = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const attr = (name) => { const r = tag.match(new RegExp("\\b" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i")); return r ? (r[2] ?? r[3] ?? r[4] ?? "") : null; };
    const key = (attr("property") || attr("name") || "").toLowerCase();
    const content = attr("content");
    if (key && content != null && !(key in tags)) tags[key] = content;
  }
  const title = head.match(/<title\b[^>]*>([\s\S]{0,600}?)<\/title>/i);
  // YouTube also names the video in its page data
  const yt = head.match(/"videoDetails":\{[^{}]*?"title":"((?:[^"\\]|\\.){1,300})"/);
  if (yt && !tags["og:title"]) { try { tags["og:title"] = JSON.parse('"' + yt[1] + '"'); } catch {} }
  if (title && !tags["<title>"]) tags["<title>"] = title[1];
  return tags;
}

// ── Special sites ────────────────────────────────────────────────────────────
function youtubeId(u) {
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, "");
  let id = "";
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v") || "";
    else { const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/); if (m) id = m[1]; }
  }
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
}
const steamApp = (u) => (/^(store\.steampowered\.com)$/.test(u.hostname) ? (u.pathname.match(/^\/app\/(\d{1,10})(?:\/|$)/) || [])[1] || "" : "");
const isTwitch = (u) => /(^|\.)twitch\.tv$/.test(u.hostname);
const siteName = (u) => u.hostname.replace(/^www\./, "");

async function readJson(url, opts) {
  const got = await careful(url, { ...opts, max: 400 * 1024, accept: "application/json" });
  if (!got) return null;
  try { return JSON.parse(got.bytes.toString("utf8")); } catch { return null; }
}

// ── The preview ──────────────────────────────────────────────────────────────
// Answers { url, kind, title, description, site, videoId?, appId?, price?, image: { bytes, mime } | null } or null.
async function linkPreview(raw, { fetchFn = globalThis.fetch, lookup = dns.lookup } = {}) {
  const asked = checkUrl(raw);
  if (!asked || typeof fetchFn !== "function") return null;
  const opts = { fetchFn, lookup };
  const out = { url: asked.href, kind: "page", title: "", description: "", site: siteName(asked), image: null };
  let picture = "";

  const vid = youtubeId(asked);
  const app = steamApp(asked);
  if (vid) {
    out.kind = "youtube"; out.videoId = vid; out.site = "YouTube";
    const o = await readJson("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + vid), opts);
    out.title = cut(o?.title || "", 200);
    out.description = o?.author_name ? cut(o.author_name, 120) : "";
    picture = "https://i.ytimg.com/vi/" + vid + "/hqdefault.jpg";
    if (!out.title) {
      // The quick lookup didn't answer: the video's own page has its name too
      const pageFor = await careful("https://www.youtube.com/watch?v=" + vid, { ...opts, max: PAGE_MAX, accept: "text/html" });
      const tags = pageFor && /html/.test(pageFor.type) ? metaTags(pageFor.bytes.toString("utf8")) : {};
      out.title = cut(tags["og:title"] || tags["twitter:title"] || String(tags["<title>"] || "").replace(/\s*-\s*YouTube\s*$/, ""), 200);
      if (!out.description) out.description = cut(tags["og:description"] || "", 300);
    }
    // Even with no name at all, it's still a video that can be played: it always gets a card
    if (!out.title) out.title = "YouTube video";
  } else if (app) {
    out.kind = "steam"; out.appId = app; out.site = "Steam";
    const j = await readJson("https://store.steampowered.com/api/appdetails?cc=us&l=english&appids=" + app, opts);
    const d = j?.[app]?.success ? j[app].data : null;
    if (d) {
      out.title = cut(d.name || "", 200);
      out.description = cut(String(d.short_description || "").replace(/<[^>]*>/g, " "), 300);
      out.price = d.is_free ? "Free to play" : cut(d.price_overview?.final_formatted || "", 40);
      picture = d.header_image || "";
    }
  }
  if (!out.title) {
    const page = await careful(asked.href, { ...opts, max: PAGE_MAX, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" });
    if (!page) return out.kind === "page" ? null : out;
    if (!/html|xml/.test(page.type)) return null; // a file, not a page: no preview
    const tags = metaTags(page.bytes.toString("utf8"));
    out.title = cut(tags["og:title"] || tags["twitter:title"] || tags["<title>"] || "", 200);
    out.description = cut(tags["og:description"] || tags["twitter:description"] || tags["description"] || "", 300);
    out.site = cut(tags["og:site_name"] || out.site, 80) || out.site;
    if (out.kind === "page" && isTwitch(asked)) { out.kind = "twitch"; out.site = "Twitch"; }
    if (!picture) {
      const img = tags["og:image:secure_url"] || tags["og:image"] || tags["og:image:url"] || tags["twitter:image"] || tags["twitter:image:src"] || "";
      try { picture = img ? new URL(decode(img), page.url).href : ""; } catch { picture = ""; }
    }
  }
  if (!out.title && !out.description) return null;
  const pictures = picture ? [picture] : [];
  if (out.kind === "youtube") pictures.push("https://i.ytimg.com/vi/" + out.videoId + "/mqdefault.jpg"); // a smaller one, if the big one isn't there
  for (const p of pictures) {
    const img = await careful(p, { ...opts, max: IMAGE_MAX, accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8" });
    const mime = img?.type.split(";")[0].trim();
    if (img && img.complete && /^image\/(png|jpeg|webp|gif)$/.test(mime) && img.bytes.length > 64) { out.image = { bytes: new Uint8Array(img.bytes), mime }; break; }
  }
  return out;
}

// ── What a saved preview may hold ────────────────────────────────────────────
// Used when a message is sent and again when one is read: anything else is dropped.
const THUMB = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
const text = (v, n) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "");
function cleanLink(link) {
  if (!link || typeof link !== "object" || Array.isArray(link)) return null;
  const u = checkUrl(link.url);
  if (!u) return null;
  const kind = KINDS.includes(link.kind) ? link.kind : "page";
  const out = { url: u.href, kind, title: text(link.title, 200), description: text(link.description, 300), site: text(link.site, 80) };
  if (!out.title && !out.description) return null;
  if (kind === "youtube") { if (!/^[A-Za-z0-9_-]{11}$/.test(String(link.videoId || ""))) return null; out.videoId = link.videoId; }
  if (kind === "steam") { if (!/^\d{1,10}$/.test(String(link.appId || ""))) return null; out.appId = String(link.appId); out.price = text(link.price, 40); }
  if (typeof link.image === "string" && link.image.length <= 60000 && THUMB.test(link.image)) out.image = link.image;
  return out;
}

module.exports = { linkPreview, cleanLink, checkUrl, privateIp, youtubeId };
