// A theme made from your background picture: the picture's main colour tints AURA's panels and
// cards, and its brightest colour becomes the accent. Added by aura-look-setup.cjs
//
//   colorsFrom(pixels)          the picture's colours, most used first (pixels: RGBA bytes)
//   themeFrom(base, accent)     { bg, panel, card, hover, ac, ac2 } for AURA's custom theme
//   readPicture(src)            loads a picture and answers its colours (in the window)

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const hex = (r, g, b) => "#" + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
export function toRgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || ""));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function toHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  return [h, s, l];
}
export function fromHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return hex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

// The picture's colours: similar shades grouped together, most used first. Each answer is
// { hex, share, vivid } where vivid says how colourful it is (0 grey to 1 bright).
export function colorsFrom(pixels, max = 6) {
  const buckets = new Map();
  let total = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue; // see-through
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4); // 16 steps a channel
    const k = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
    k.r += r; k.g += g; k.b += b; k.n++;
    buckets.set(key, k);
    total++;
  }
  if (!total) return [];
  const all = [...buckets.values()].map((k) => {
    const rgb = [k.r / k.n, k.g / k.n, k.b / k.n];
    const [, s, l] = toHsl(rgb);
    return { rgb, share: k.n / total, vivid: s * (1 - Math.abs(2 * l - 1)) };
  }).sort((a, b) => b.share - a.share);
  // Keep colours that look different from the ones already kept
  const kept = [];
  const far = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 48;
  for (const c of all) {
    if (kept.every((k) => far(k.rgb, c.rgb))) kept.push(c);
    if (kept.length >= max * 3) break;
  }
  return kept.slice(0, max).map((c) => ({ hex: hex(...c.rgb), share: Math.round(c.share * 1000) / 1000, vivid: Math.round(c.vivid * 100) / 100 }));
}

// The colour to build the theme around: the most colourful one that's used a fair amount,
// or the most used one if the picture is mostly grey
export function pickAccent(colors) {
  const list = Array.isArray(colors) ? colors : [];
  const lively = list.filter((c) => c.vivid >= 0.18 && c.share >= 0.01);
  if (lively.length) return lively.sort((a, b) => b.vivid * Math.sqrt(b.share) - a.vivid * Math.sqrt(a.share))[0].hex;
  return list[0]?.hex || "#FF5722";
}

// AURA's colours from the picture: dark panels tinted with the picture's main colour, and an
// accent bright enough to read on them
export function themeFrom(baseHex, accentHex) {
  const base = toRgb(baseHex) || [34, 40, 49];
  const acc = toRgb(accentHex) || base;
  const [bh, bs] = toHsl(base);
  const [ah, as] = toHsl(acc);
  const tint = clamp(bs, 0.12, 0.4);
  const accentSat = as < 0.12 ? as : clamp(as, 0.55, 0.9); // a grey picture keeps a grey accent
  return {
    bg: fromHsl(bh, tint, 0.09),
    panel: fromHsl(bh, tint, 0.065),
    card: fromHsl(bh, tint * 0.9, 0.15),
    hover: fromHsl(bh, tint * 0.9, 0.2),
    ac: fromHsl(ah, accentSat, 0.56),
    ac2: fromHsl((ah + 18) % 360, accentSat, 0.7),
  };
}

// Load the picture and read its colours (in the window). A picture from a website that doesn't
// allow it can't be read, and answers null.
export function readPicture(src) {
  return new Promise((resolve) => {
    if (!src || typeof document === "undefined") return resolve(null);
    const img = new Image();
    if (!/^data:/i.test(src)) img.crossOrigin = "anonymous";
    const done = (v) => { img.onload = img.onerror = null; resolve(v); };
    const timer = setTimeout(() => done(null), 8000);
    img.onload = () => {
      clearTimeout(timer);
      try {
        const size = 64;
        const c = document.createElement("canvas");
        c.width = size; c.height = size;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, size, size);
        done(colorsFrom(ctx.getImageData(0, 0, size, size).data));
      } catch { done(null); }
    };
    img.onerror = () => { clearTimeout(timer); done(null); };
    img.src = src;
  });
}
