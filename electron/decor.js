// AURA — avatar decorations in your account (Edit Profile > Avatar Decorations).
// Reads the decorations people chose, and saves yours. Saving goes through one database function
// that can only change your own profile (supabase/aura-seasonal.sql). Only the expected shape is
// ever saved or passed on: a few short names and numbers, never pictures or text.
// Added by aura-seasonal-setup.cjs. Wired up from the main file with one line:
//   require("./decor").register(ipcMain, cloudHandler, auraCloud);
"use strict";
const SLUG = /^[a-z][a-z0-9-]{0,19}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (v, lo, hi, d) => (typeof v === "number" && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const NEEDS_SQL = "Avatar decorations need a one-time database update. In Supabase, open SQL Editor and run supabase/aura-seasonal.sql.";

function sanitize(d) {
  if (!d || typeof d !== "object") return null;
  const o = { v: 1, on: d.on === true, mode: d.mode === "manual" ? "manual" : "auto", season: SLUG.test(d.season || "") ? d.season : "christmas", frames: d.frames !== false, accessories: d.accessories !== false, animate: d.animate !== false, picks: {} };
  if (d.picks && typeof d.picks === "object") for (const [k, p] of Object.entries(d.picks).slice(0, 12)) {
    if (!SLUG.test(k) || !p || typeof p !== "object") continue;
    o.picks[k] = { frame: SLUG.test(p.frame || "") ? p.frame : "", acc: SLUG.test(p.acc || "") ? p.acc : "", x: num(p.x, -0.3, 0.3, 0), y: num(p.y, -0.3, 0.3, 0), size: num(p.size, 0.7, 1.3, 1) };
  }
  return o;
}
const missing = (error) => error && (error.code === "42703" || error.code === "PGRST204" || /avatar_decor/.test(error.message || ""));
const noFunction = (error) => error && (error.code === "PGRST202" || error.code === "42883" || /set_avatar_decoration/.test(error.message || ""));

function create(cloud) {
  const sb = () => cloud.internals.client();
  // The decorations of up to 200 people at once
  async function getDecorations(ids) {
    const list = [...new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string" && ID.test(x)))].slice(0, 200);
    if (!list.length) return { decor: {} };
    await cloud.internals.currentUser();
    const { data, error } = await sb().from("profiles").select("id,avatar_decor").in("id", list);
    if (error) { if (missing(error)) return { decor: {}, unavailable: true }; throw new Error(error.message); }
    const decor = {};
    for (const row of data || []) { const d = sanitize(row.avatar_decor); if (d) decor[row.id] = d; }
    return { decor };
  }
  async function saveMine(d) {
    const clean = sanitize(d);
    if (!clean) throw new Error("That decoration isn't valid.");
    await cloud.internals.currentUser();
    const { error } = await sb().rpc("set_avatar_decoration", { decor: clean });
    if (error) throw new Error(noFunction(error) || missing(error) ? NEEDS_SQL : error.message);
    return clean;
  }
  return { getDecorations, saveMine };
}
function register(ipcMain, cloudHandler, cloud) {
  const d = create(cloud);
  ipcMain.handle("profile:decorations", cloudHandler(d.getDecorations));
  ipcMain.handle("profile:saveDecoration", cloudHandler(d.saveMine));
  return d;
}
module.exports = { sanitize, create, register, NEEDS_SQL };
