// Avatar decorations in the main process (electron/decor.js): only the expected shape is saved or
// passed on, saving uses the database function that can only change your own profile, and a
// database without the update says what to run. A pretend Supabase stands in for the real one.
// Added by aura-seasonal-setup.cjs.
"use strict";
const fs = require("fs");
const path = require("path");
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok || extra === undefined ? "" : "  " + JSON.stringify(extra))); };
const ROOT = path.resolve(__dirname, "..");
const decor = require(path.join(ROOT, "electron", "decor.js"));
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

(async () => {
  console.log("1. Only the expected shape");
  const s = decor.sanitize({ on: true, mode: "manual", season: "christmas", frames: true, accessories: false, animate: false, picks: { christmas: { frame: "wreath", acc: "santa", x: 9, y: -9, size: 5, evil: "<script>" }, "Bad Key": { frame: "x" } }, extra: "x".repeat(5000), image: "data:image/png;base64,AAAA" });
  check("keeps the choices", s.on === true && s.mode === "manual" && s.season === "christmas" && s.accessories === false && s.animate === false && s.picks.christmas.frame === "wreath" && s.picks.christmas.acc === "santa");
  check("numbers are kept in range (position and size)", s.picks.christmas.x === 0.3 && s.picks.christmas.y === -0.3 && s.picks.christmas.size === 1.3);
  check("anything else is dropped: extra fields, odd names, pictures", !("extra" in s) && !("image" in s) && !("evil" in s.picks.christmas) && !s.picks["Bad Key"] && JSON.stringify(s).length < 400, s);
  check("names must be short plain words", decor.sanitize({ picks: { winter: { frame: "<img src=x>", acc: "a".repeat(40) } } }).picks.winter.frame === "" && decor.sanitize({ picks: { winter: { acc: "a".repeat(40) } } }).picks.winter.acc === "");
  check("off unless switched on", decor.sanitize({}).on === false && decor.sanitize(null) === null && decor.sanitize("on") === null);

  console.log("2. Reading and saving");
  const calls = [];
  let rows = [{ id: A, avatar_decor: { on: true, picks: { christmas: { frame: "candy" } }, junk: 1 } }, { id: B, avatar_decor: null }];
  let selectError = null, rpcError = null;
  const client = {
    from: (t) => ({ select: (cols) => ({ in: async (col, ids) => { calls.push(["select", t, cols, col, ids]); return selectError ? { error: selectError } : { data: rows.filter((r) => ids.includes(r.id)) }; } }) }),
    rpc: async (fn, args) => { calls.push(["rpc", fn, args]); return rpcError ? { error: rpcError } : { data: null }; },
  };
  const cloud = { internals: { client: () => client, currentUser: async () => ({ id: A }) } };
  const handlers = {};
  decor.register({ handle: (ch, fn) => { handlers[ch] = fn; } }, (fn) => async (_e, ...a) => { try { return { success: true, data: await fn(...a) }; } catch (e) { return { success: false, error: e.message }; } }, cloud);
  let r = await handlers["profile:decorations"](null, [A, B, "not-an-id", A, "'; drop table profiles;--"]);
  check("people's decorations are read from their profiles, only real IDs asked for", r.success && calls[0][1] === "profiles" && calls[0][2] === "id,avatar_decor" && JSON.stringify(calls[0][4]) === JSON.stringify([A, B]));
  check("...cleaned before the window gets them; people without any are left out", r.data.decor[A].picks.christmas.frame === "candy" && !("junk" in r.data.decor[A]) && !(B in r.data.decor));
  r = await handlers["profile:decorations"](null, Array.from({ length: 500 }, (_x, i) => `${String(i).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`));
  check("at most 200 people at a time", calls.at(-1)[4].length === 200);
  r = await handlers["profile:saveDecoration"](null, { on: true, season: "winter", picks: { winter: { frame: "ice" } }, sneaky: true });
  check("saving goes through the database function, cleaned", r.success && calls.at(-1)[0] === "rpc" && calls.at(-1)[1] === "set_avatar_decoration" && calls.at(-1)[2].decor.on === true && !("sneaky" in calls.at(-1)[2].decor));
  check("...nothing is written to the table directly", !calls.some((c) => c[0] === "update" || c[0] === "upsert"));
  selectError = { code: "42703", message: 'column profiles.avatar_decor does not exist' };
  r = await handlers["profile:decorations"](null, [A]);
  check("before the database update: nobody has decorations, nothing breaks", r.success && r.data.unavailable === true && JSON.stringify(r.data.decor) === "{}");
  rpcError = { code: "PGRST202", message: "Could not find the function public.set_avatar_decoration(decor)" };
  r = await handlers["profile:saveDecoration"](null, { on: true });
  check("...and saving says which file to run in Supabase", !r.success && /aura-seasonal\.sql/.test(r.error), r);
  r = await handlers["profile:saveDecoration"](null, "nope");
  check("something that isn't a decoration isn't saved", !r.success);

  console.log("3. Files");
  const sql = fs.readFileSync(path.join(ROOT, "supabase", "aura-seasonal.sql"), "utf8");
  check("the database update adds one column and one function, and changes no existing rules", /add column if not exists avatar_decor jsonb/.test(sql) && /set_avatar_decoration/.test(sql) && !/create policy|drop policy|alter policy|disable row level security|delete from/i.test(sql));
  const pre = fs.readFileSync(path.join(ROOT, "electron", "preload.js"), "utf8");
  check("the window can only ask for decorations and save its own", /getAvatarDecorations: \(ids\) => ipcRenderer\.invoke\("profile:decorations", ids\)/.test(pre) && /saveAvatarDecoration: \(decor\) => ipcRenderer\.invoke\("profile:saveDecoration", decor\)/.test(pre));
  const policy = (() => { try { return fs.readFileSync(path.join(ROOT, "PRIVACY.md"), "utf8"); } catch { return ""; } })();
  if (policy) check("the privacy policy says avatar decorations are part of your profile", /profile picture, and the avatar decorations you choose/.test(policy));
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
