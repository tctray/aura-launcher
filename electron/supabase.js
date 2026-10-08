// AURA Cloud: accounts and profiles, stored in Supabase.
// This file runs in the main process. The window reaches it through
// preload.js (window.auraCloud) and the ipcMain handlers in the main file.
const fs = require("fs");
const path = require("path");
const { app, safeStorage } = require("electron");
const { createClient } = require("@supabase/supabase-js");

// Your project's URL and publishable key (Supabase dashboard > Connect).
// Never put the secret / service_role key in this file.
const SUPABASE_URL = "https://twparkshmkrroaraiaow.supabase.co";
const SUPABASE_KEY = "sb_publishable_je-49QO2YDT6KvFcOVAcGA_SXXwqlrJ";

// ── Saved login ───────────────────────────────────────────────────────────────
// The login is kept in a small file so you stay signed in between launches.
// Windows encrypts it, so other accounts on the PC can't read it.
const sessionFile = () => path.join(app.getPath("userData"), "aura-session.dat");
const LAST_USER = "aura-last-user";
let cache = null;

function readStore() {
  if (cache) return cache;
  cache = {};
  try {
    const raw = fs.readFileSync(sessionFile());
    let text;
    try {
      text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString("utf8");
    } catch {
      text = raw.toString("utf8");
    }
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") cache = parsed;
  } catch {}
  return cache;
}

function writeStore() {
  try {
    const text = JSON.stringify(cache || {});
    const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text, "utf8");
    fs.writeFileSync(sessionFile(), data);
  } catch (e) {
    console.error("Could not save the AURA login:", e.message);
  }
}

// Supabase reads and writes the login through these four functions
const storage = {
  async getItem(key) { await app.whenReady(); return readStore()[key] ?? null; },
  async setItem(key, value) { await app.whenReady(); readStore()[key] = value; writeStore(); },
  async removeItem(key) { await app.whenReady(); delete readStore()[key]; writeStore(); },
  async clear() { await app.whenReady(); cache = {}; writeStore(); },
};

// ── Supabase client ───────────────────────────────────────────────────────────
let supabase = null;
let setupProblem = "";
if (!/^https:\/\/.+/.test(SUPABASE_URL) || !SUPABASE_KEY || SUPABASE_KEY.startsWith("__")) {
  setupProblem = "AURA accounts aren't set up yet. Add your project URL and publishable key to supabase.js.";
} else {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  } catch (e) {
    setupProblem = "AURA accounts couldn't start: " + e.message;
  }
}
if (setupProblem) console.error(setupProblem);

function client() {
  if (!supabase) throw new Error(setupProblem);
  return supabase;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const toUser = (u) => ({ id: u.id, email: u.email, username: u.user_metadata?.username || null });
const cleanName = (name) => String(name || "").trim();
const isNetworkError = (e) =>
  !!e && (e.name === "AuthRetryableFetchError" || e.status === 0 || /fetch failed|network|timeout/i.test(e.message || ""));

// Give up waiting after `ms` so AURA never hangs on a bad connection
const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), ms))]);

async function rememberUser(user) {
  await storage.setItem(LAST_USER, JSON.stringify({ id: user.id, email: user.email, username: user.username }));
}

async function currentUser() {
  const { data } = await client().auth.getSession();
  if (!data?.session?.user) throw new Error("You're not logged in.");
  return data.session.user;
}

// ── Accounts ──────────────────────────────────────────────────────────────────
async function signUp(email, password, username) {
  const { data, error } = await client().auth.signUp({
    email,
    password,
    options: { data: { username: cleanName(username) } },
  });
  if (error) throw new Error(error.message);
  // Supabase answers like this when the email is already in use
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error("That email already has an account.");
  }
  // No session yet means the email must be confirmed first
  if (!data.session) return { needsConfirmation: true, user: null };
  const user = toUser(data.user);
  await rememberUser(user);
  return { needsConfirmation: false, user };
}

async function logIn(email, password) {
  const { data, error } = await client().auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  const user = toUser(data.user);
  await rememberUser(user);
  return user;
}

async function logOut() {
  try { await withTimeout(client().auth.signOut({ scope: "local" }), 4000); } catch {}
  // Always forget the login on this PC, even if the server couldn't be reached
  await storage.clear();
  return true;
}

// Who is signed in on this PC? Returns the user, or null.
async function getSession() {
  const result = await withTimeout(client().auth.getSession(), 6000);
  const sessionUser = result?.data?.session?.user;
  if (sessionUser) {
    const user = toUser(sessionUser);
    await rememberUser(user);
    return user;
  }
  // No internet: keep the last account signed in so games still launch
  if (result?.timedOut || isNetworkError(result?.error)) {
    const last = await storage.getItem(LAST_USER);
    if (last) {
      try { return { ...JSON.parse(last), offline: true }; } catch {}
    }
  }
  return null;
}

async function resendConfirmation(email) {
  const { error } = await client().auth.resend({ type: "signup", email });
  if (error) throw new Error(error.message);
  return true;
}

// ── Profiles ──────────────────────────────────────────────────────────────────
async function getMyProfile() {
  const user = await currentUser();
  const { data, error } = await client().from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function saveProfile(username, avatarUrl) {
  const user = await currentUser();
  const row = { id: user.id, username: cleanName(username) };
  if (!row.username) throw new Error("Enter a username.");
  if (typeof avatarUrl === "string" && /^https?:\/\//i.test(avatarUrl)) row.avatar_url = avatarUrl;
  // A picture chosen from this PC is stored in Supabase, so friends see it too (see avatar.js)
  let pictureProblem = null;
  if (require("./avatar").isDataUrl(avatarUrl)) {
    try { row.avatar_url = await require("./avatar").upload(client(), user.id, avatarUrl); }
    catch (e) { pictureProblem = e; }
  }
  const { error } = await client().from("profiles").upsert(row);
  if (error) throw new Error(error.code === "23505" ? "That username is already taken." : error.message);
  if (pictureProblem) throw new Error("Your profile was saved, but not the picture: " + pictureProblem.message);
  return true;
}

async function getProfile(username) {
  const { data, error } = await client().from("profiles").select("*").eq("username", cleanName(username)).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

// ── Games: favorites and playtime that follow the account ─────────────────────
// One row per game in the user_games table. Games are matched by title.
async function getMyGames() {
  const user = await currentUser();
  const rows = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await client()
      .from("user_games")
      .select("game_key,title,favorite,playtime_seconds,play_count,last_played")
      .eq("user_id", user.id)
      .order("game_key")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function saveMyGames(games) {
  const user = await currentUser();
  const whole = (v) => Math.max(0, Math.floor(Number(v) || 0));
  const rows = new Map();
  for (const g of Array.isArray(games) ? games.slice(0, 500) : []) {
    const key = String(g?.game_key || "").trim().slice(0, 200);
    if (!key) continue;
    const played = g.last_played ? new Date(g.last_played) : null;
    rows.set(key, {
      user_id: user.id, // always the signed-in account, never taken from the window
      game_key: key,
      title: String(g.title || "").slice(0, 200),
      favorite: !!g.favorite,
      playtime_seconds: whole(g.playtime_seconds),
      play_count: whole(g.play_count),
      last_played: played && !isNaN(played.getTime()) ? played.toISOString() : null,
      updated_at: new Date().toISOString(),
    });
  }
  if (!rows.size) return 0;
  const { error } = await client().from("user_games").upsert([...rows.values()], { onConflict: "user_id,game_key" });
  if (error) throw new Error(error.message);
  return rows.size;
}

// ── Account data: achievements, stats, theme and settings ─────────────────────
// One row per kind in the user_data table.
const DATA_KEYS = new Set(["achievements", "stats", "theme", "settings"]);
const isPlain = (v) => !!v && typeof v === "object" && !Array.isArray(v);

async function getMyData() {
  const user = await currentUser();
  const { data, error } = await client().from("user_data").select("key,value").eq("user_id", user.id);
  if (error) throw new Error(error.message);
  return data || [];
}

async function saveMyData(entries) {
  const user = await currentUser();
  const rows = new Map();
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || !DATA_KEYS.has(e.key) || !isPlain(e.value)) continue;
    if (JSON.stringify(e.value).length > 300000) throw new Error("That's too much to save for " + e.key + ".");
    rows.set(e.key, { user_id: user.id, key: e.key, value: e.value, updated_at: new Date().toISOString() });
  }
  if (!rows.size) return 0;
  const { error } = await client().from("user_data").upsert([...rows.values()], { onConflict: "user_id,key" });
  if (error) throw new Error(error.message);
  return rows.size;
}

// ── Session history ───────────────────────────────────────────────────────────
// One row per play session in the user_sessions table.
const SESSION_ID = /^[\w.:-]{1,80}$/;
const sessionIds = (ids) => [...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string" && SESSION_ID.test(id)))].slice(0, 200);

async function getMySessionIds() {
  const user = await currentUser();
  const ids = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await client()
      .from("user_sessions")
      .select("id")
      .eq("user_id", user.id)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    ids.push(...(data || []).map((r) => r.id));
    if (!data || data.length < 1000) break;
  }
  return ids;
}

async function getMySessions(ids) {
  const user = await currentUser();
  const wanted = sessionIds(ids);
  if (!wanted.length) return [];
  const { data, error } = await client()
    .from("user_sessions")
    .select("id,game_key,title,category,exe_path,started_at,ended_at,duration_ms,perf")
    .eq("user_id", user.id)
    .in("id", wanted);
  if (error) throw new Error(error.message);
  return data || [];
}

async function saveMySessions(sessions) {
  const user = await currentUser();
  const when = (v) => { const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString(); };
  const text = (v, max) => String(v ?? "").slice(0, max);
  const rows = new Map();
  for (const x of Array.isArray(sessions) ? sessions.slice(0, 200) : []) {
    if (!x || typeof x.id !== "string" || !SESSION_ID.test(x.id)) continue;
    const duration = Math.max(0, Math.floor(Number(x.duration_ms) || 0));
    const ended = when(x.ended_at);
    if (!ended) continue;
    const started = when(x.started_at) || new Date(Date.parse(ended) - duration).toISOString();
    // Performance numbers are kept unless they're unreasonably large
    let perf = isPlain(x.perf) ? x.perf : null;
    if (perf && JSON.stringify(perf).length > 60000) { perf = { ...perf }; delete perf.fpsTrace; }
    if (perf && JSON.stringify(perf).length > 60000) perf = null;
    rows.set(x.id, {
      user_id: user.id, // always the signed-in account, never taken from the window
      id: x.id,
      game_key: text(x.game_key, 200),
      title: text(x.title, 200),
      category: text(x.category, 60),
      exe_path: text(x.exe_path, 500),
      started_at: started,
      ended_at: ended,
      duration_ms: duration,
      perf,
    });
  }
  if (!rows.size) return [];
  const { error } = await client().from("user_sessions").upsert([...rows.values()], { onConflict: "user_id,id" });
  if (error) throw new Error(error.message);
  return [...rows.keys()]; // the ids that were saved
}

async function deleteMySessions(ids) {
  const user = await currentUser();
  const wanted = sessionIds(ids);
  if (!wanted.length) return 0;
  const { error } = await client().from("user_sessions").delete().eq("user_id", user.id).in("id", wanted);
  if (error) throw new Error(error.message);
  return wanted.length;
}

// The signed-in user's login token. AURA sends it to the AURA server, which checks it
// with Supabase to see who is asking. Supabase renews it automatically when it gets old.
async function getAccessToken() {
  const { data } = await client().auth.getSession();
  return data?.session?.access_token || null;
}

// social.js (friends and messages) uses the same signed-in connection through these two
module.exports = { signUp, logIn, logOut, getSession, resendConfirmation, getMyProfile, saveProfile, getProfile, getMyGames, saveMyGames, getMyData, saveMyData, getMySessionIds, getMySessions, saveMySessions, deleteMySessions, getAccessToken, internals: { client, currentUser } };
