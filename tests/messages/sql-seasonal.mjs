// Database rules for avatar decorations (supabase/aura-seasonal.sql), run in a small built-in
// Postgres: you can save only your own, only a small settings object, and everyone signed in can
// see them the way they see profile pictures. Added by aura-seasonal-setup.cjs.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import { fileURLToPath } from "url";
import nodePath from "path";
const HERE = nodePath.dirname(fileURLToPath(import.meta.url));
const SQL = nodePath.join(HERE, "..", "..", "supabase", "aura-seasonal.sql");
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const db = new PGlite();
await db.exec(`
  create schema auth; create table auth.users (id uuid primary key);
  create role anon nologin; create role authenticated nologin;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  insert into auth.users values ('${A}'), ('${B}'), ('${C}');
  create table public.profiles (id uuid primary key references auth.users on delete cascade, username text unique not null, bio text, avatar_url text, created_at timestamptz default now());
  alter table public.profiles enable row level security;
  create policy "Logged-in users can view profiles" on public.profiles for select to authenticated using (true);
  create policy "Users can update their own profile" on public.profiles for update to authenticated using (id = auth.uid());
  insert into public.profiles (id, username, avatar_url) values ('${A}', 'tctray', 'https://x/a.png'), ('${B}', 'Alex', null);
`);
const sql = fs.readFileSync(SQL, "utf8");
await db.exec(sql);
await db.exec(sql); // safe to run again

let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const as = async (uid, role = "authenticated") => { await db.exec(`reset role; set test.uid = '${uid || ""}'; set role ${role};`); };
const q = async (text, params) => (await db.query(text, params)).rows;
const fails = async (p) => { try { await p; return false; } catch (e) { return e.message; } };
const save = (d) => db.query("select public.set_avatar_decoration($1::jsonb)", [d === null ? null : JSON.stringify(d)]);
const decorOf = async (id) => (await q("select avatar_decor from public.profiles where id = $1", [id]))[0]?.avatar_decor;

console.log("1. Saving your own");
await as(A);
check("you can save your decorations", !(await fails(save({ v: 1, on: true, season: "christmas", picks: { christmas: { frame: "wreath", acc: "santa" } } }))));
check("...and they're on your profile", (await decorOf(A))?.picks?.christmas?.frame === "wreath");
check("your picture isn't touched", (await q("select avatar_url from public.profiles where id = $1", [A]))[0].avatar_url === "https://x/a.png");
check("you can switch them off (and your choices are kept)", !(await fails(save({ v: 1, on: false, season: "christmas", picks: { christmas: { frame: "wreath" } } }))) && (await decorOf(A)).on === false && (await decorOf(A)).picks.christmas.frame === "wreath");
check("or remove them completely", !(await fails(save(null))) && (await decorOf(A)) === null);
await save({ v: 1, on: true, picks: {} });

console.log("2. Nobody else's");
await as(B);
await save({ v: 1, on: true, picks: { winter: { frame: "ice" } } });
check("saving only ever changes your own profile", (await decorOf(A)).picks.winter === undefined && (await decorOf(B)).picks.winter.frame === "ice");
check("there's no way to name someone else's profile", !!(await fails(db.query("select public.set_avatar_decoration($1::uuid, $2::jsonb)", [A, "{}"]))));
await as(C);
check("someone without a profile yet is told to save it first", /Save your profile first/.test(await fails(save({ on: true }))));
await as(null, "anon");
check("signed out: no saving", !!(await fails(save({ on: true }))));
check("...and no reading", (await fails(q("select avatar_decor from public.profiles"))) || (await q("select avatar_decor from public.profiles")).length === 0);

console.log("3. Small settings only");
await as(A);
check("not a list or text", /isn't valid/.test(await fails(save([1, 2]))) && /isn't valid/.test(await fails(save("hello"))));
check("not anything big (like a picture)", /isn't valid/.test(await fails(save({ on: true, image: "x".repeat(5000) }))));
await as(B);
check("the table itself won't take anything big either", !!(await fails(q("update public.profiles set avatar_decor = $1::jsonb where id = $2", [JSON.stringify({ x: "y".repeat(5000) }), B]))));

console.log("4. Seeing friends' decorations");
await as(B);
check("everyone signed in sees the decorations people chose", (await decorOf(A))?.on === true);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
