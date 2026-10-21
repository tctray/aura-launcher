// The background saved with each theme (Customize > Saved). Added by aura-theme-backgrounds-setup.cjs
//
// A saved theme keeps its background as one of:
//   { kind: "none" }              no background
//   { kind: "web", url }          a picture from a web link (this travels with your account)
//   { kind: "pic", pic: "<id>" }  a picture from this PC, kept in AURA's picture storage on this PC
// Pictures from the PC can be several MB, so they're not put inside the theme list itself.
const DB = "aura-theme-pictures";
const STORE = "pics";
let opening = null;
function db() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no picture storage"));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  opening.catch(() => { opening = null; });
  return opening;
}
function run(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}
export const isWebPicture = (v) => typeof v === "string" && /^https?:\/\//i.test(v);
const isPicture = (v) => typeof v === "string" && /^data:image\/[a-z.+-]+;base64,/i.test(v);

// What to keep with a theme being saved, for the background showing now. null: it couldn't be kept.
export async function backgroundForTheme(bg) {
  if (!bg) return { kind: "none" };
  if (isWebPicture(bg)) return { kind: "web", url: bg };
  if (!isPicture(bg)) return null;
  try {
    const id = "pic-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    await run("readwrite", (st) => st.put(bg, id));
    return { kind: "pic", pic: id };
  } catch { return null; }
}
// The picture kept for a theme (null if it isn't on this PC)
export async function themePicture(id) {
  if (typeof id !== "string" || !id) return null;
  try { const v = await run("readonly", (st) => st.get(id)); return isPicture(v) ? v : null; } catch { return null; }
}
export async function forgetThemePicture(id) {
  if (typeof id !== "string" || !id) return;
  try { await run("readwrite", (st) => st.delete(id)); } catch {}
}
// A theme's background as something to show: "" for none, a link or picture, or null if unknown/missing
export async function resolveThemeBackground(b) {
  if (!b || typeof b !== "object") return null;
  if (b.kind === "none") return "";
  if (b.kind === "web") return isWebPicture(b.url) ? b.url : null;
  if (b.kind === "pic") return themePicture(b.pic);
  return null;
}
