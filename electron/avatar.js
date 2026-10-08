// AURA — profile pictures saved to your account.
//
// A picture chosen from the PC arrives as a data: address. Here it is checked (it must really be
// a picture), made small (256 x 256; this also drops hidden details such as where a photo was
// taken), uploaded to the "avatars" bucket in Supabase under your own folder, and its web address
// is what goes in your profile. Your older pictures there are removed.
//
// Added by aura-avatars-setup.cjs. Used by supabase.js (saveProfile).
"use strict";
const crypto = require("crypto");

const BUCKET = "avatars";
const SIDE = 256;
const MAX_IN = 15 * 1024 * 1024;   // the picture as chosen
const MAX_OUT = 2 * 1024 * 1024;   // what is stored (the bucket refuses more)
const SETUP = "Profile pictures aren't set up in Supabase yet. Run aura-avatars.sql first.";
const DATA_URL = /^data:image\/[a-z.+-]+;base64,([A-Za-z0-9+/=\s]+)$/i;
const isDataUrl = (v) => typeof v === "string" && v.length < MAX_IN * 1.4 && DATA_URL.test(v);

// What a picture really is, from its first bytes
function sniff(b) {
  if (!b || b.length < 12) return null;
  const at = (i, t) => b.toString("latin1", i, i + t.length) === t;
  if (b[0] === 0x89 && at(1, "PNG")) return { mime: "image/png", ext: "png" };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (at(0, "GIF87a") || at(0, "GIF89a")) return { mime: "image/gif", ext: "gif" };
  if (at(0, "RIFF") && at(8, "WEBP")) return { mime: "image/webp", ext: "webp" };
  return null;
}

// Electron's picture tools, when running inside Electron (the checks run without them)
function electronImages() {
  try { const { nativeImage } = require("electron"); return nativeImage && typeof nativeImage.createFromBuffer === "function" ? nativeImage : null; } catch { return null; }
}

// Returns { bytes, mime, ext } ready to store
function prepare(dataUrl, { nativeImage = electronImages() } = {}) {
  if (!isDataUrl(dataUrl)) throw new Error("That picture couldn't be read.");
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  const kind = sniff(bytes);
  if (!kind) throw new Error("A profile picture has to be a PNG, JPG, WebP or GIF.");
  // PNG and JPG are cut to a square from the middle and made small. GIFs and WebP keep their
  // movement, so they are stored as they are if they are small enough.
  if (nativeImage && (kind.ext === "png" || kind.ext === "jpg")) {
    const img = nativeImage.createFromBuffer(bytes);
    if (!img.isEmpty()) {
      const { width, height } = img.getSize();
      const side = Math.min(width, height);
      const square = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side });
      const small = side > SIDE ? square.resize({ width: SIDE, height: SIDE, quality: "best" }) : square;
      const out = kind.ext === "png" ? small.toPNG() : small.toJPEG(88);
      if (out && out.length) return { bytes: out, ...kind };
    }
  }
  if (bytes.length > MAX_OUT) throw new Error("That picture is too big for a profile picture (" + (bytes.length / 1048576).toFixed(1) + " MB). Pick one under 2 MB.");
  return { bytes, ...kind };
}

// Uploads the picture for this user and returns its web address
async function upload(client, userId, dataUrl, opts) {
  const pic = prepare(dataUrl, opts);
  const name = crypto.randomUUID() + "." + pic.ext;
  const store = client.storage.from(BUCKET);
  const up = await store.upload(userId + "/" + name, pic.bytes, { contentType: pic.mime, cacheControl: "31536000", upsert: false });
  if (up.error) {
    const msg = String(up.error.message || up.error);
    if (/bucket not found/i.test(msg)) throw new Error(SETUP);
    if (/row-level security|unauthorized|403/i.test(msg)) throw new Error(SETUP);
    if (/maximum allowed size|too large/i.test(msg)) throw new Error("That picture is too big for a profile picture. Pick one under 2 MB.");
    throw new Error("The picture couldn't be uploaded (" + msg.slice(0, 120) + ").");
  }
  const url = store.getPublicUrl(userId + "/" + name)?.data?.publicUrl;
  if (typeof url !== "string" || !/^https:\/\//.test(url)) throw new Error("The picture was uploaded, but Supabase didn't give back its address.");
  // Older pictures of yours are tidied away. If that fails the new one still counts.
  try {
    const { data } = await store.list(userId, { limit: 100 });
    const old = (data || []).map((f) => f && f.name).filter((n) => typeof n === "string" && n !== name && /^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/.test(n));
    if (old.length) await store.remove(old.map((n) => userId + "/" + n));
  } catch {}
  return url;
}

module.exports = { upload, prepare, isDataUrl, sniff, SETUP, BUCKET };
