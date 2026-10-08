// Test harness (used by the app-*.cjs checks): runs the real electron/social.js for several users at once against a real
// Postgres engine (PGlite) loaded with the real SQL files from the supabase folder, with a stand-in for the Supabase
// client that enforces "run every query as this user" and imitates Realtime delivery rules.
const Module = require("module");
const fs = require("fs");
const path = require("path");

const USERS = {
  A: { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", username: "tctray" },
  B: { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", username: "Alex" },
  C: { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", username: "Marcus" },
  D: { id: "dddddddd-dddd-dddd-dddd-dddddddddddd", username: "Stranger" },
};
const notifications = []; // every Windows notification the app tried to show
class FakeNotification {
  static isSupported() { return true; }
  constructor(opts) { this.opts = opts; this.handlers = {}; this.closed = false; }
  close() { this.closed = true; }
  on(name, fn) { this.handlers[name] = fn; }
  show() { notifications.push(this); }
}
// Electron's app object: remembers what listens for AURA closing, and counts how often it is told to quit
const fakeApp = { isPackaged: false, setAppUserModelId() {}, handlers: {}, quits: 0, on(name, fn) { (fakeApp.handlers[name] ||= []).push(fn); }, quit() { fakeApp.quits++; } };
const realLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "electron" && parent && /social\.js$/.test(parent.filename)) return { app: fakeApp, Notification: FakeNotification };
  return realLoad.call(this, request, parent, ...rest);
};

async function createWorld(socialPath) {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  await db.exec(`
    create schema auth; create table auth.users (id uuid primary key);
    create role anon nologin; create role authenticated nologin;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    create publication supabase_realtime;
    create table public.profiles (id uuid primary key references auth.users on delete cascade, username text unique not null, bio text, avatar_url text, created_at timestamptz default now());
    alter table public.profiles enable row level security;
    create policy "Logged-in users can view profiles" on public.profiles for select to authenticated using (true);
  `);
  for (const u of Object.values(USERS)) {
    await db.query("insert into auth.users values ($1)", [u.id]);
    await db.query("insert into public.profiles (id, username, bio) values ($1, $2, $3)", [u.id, u.username, u.username === "Alex" ? "Mostly RPGs and racing games." : null]);
  }
  await db.exec(fs.readFileSync(path.join(__dirname, "storage-fake.sql"), "utf8")); // Supabase Storage's tables exist in every project
  await db.exec(fs.readFileSync(path.join(__dirname, "..", "..", "supabase", "aura-messages.sql"), "utf8"));
  if (!process.env.NO_MEDIA_SQL) await db.exec(fs.readFileSync(path.join(__dirname, "..", "..", "supabase", "aura-messages-media.sql"), "utf8"));
  if (!process.env.NO_MEDIA_SQL && !process.env.NO_BG_SQL) await db.exec(fs.readFileSync(path.join(__dirname, "..", "..", "supabase", "aura-messages-background.sql"), "utf8"));
  if (!process.env.NO_MEDIA_SQL && !process.env.NO_BG_SQL && !process.env.NO_SAFETY_SQL) await db.exec(fs.readFileSync(path.join(__dirname, "..", "..", "supabase", "aura-messages-safety.sql"), "utf8"));
  if (!process.env.NO_VOICE_SQL) await db.exec(fs.readFileSync(path.join(__dirname, "..", "..", "supabase", "aura-messages-voice.sql"), "utf8"));
  // Likes and dislikes (left out for the checks that imitate a database from before the safety update)
  const reactionsSql = path.join(__dirname, "..", "..", "supabase", "aura-messages-reactions.sql");
  const hasReactions = !process.env.NO_REACTIONS_SQL && !process.env.NO_SAFETY_SQL && fs.existsSync(reactionsSql);
  if (hasReactions) await db.exec(fs.readFileSync(reactionsSql, "utf8"));
  // Rows as they arrive over HTTP: dates as text, big whole numbers as plain numbers
  const plain = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x)));

  // One query at a time, each run as a specific user (or as the database owner when uid is null)
  let chain = Promise.resolve();
  const run = (uid, text, params = []) => {
    const job = chain.then(async () => {
      await db.exec(uid ? `reset role; set test.uid = '${uid}'; set role authenticated;` : `reset role; set test.uid = '';`);
      return db.query(text, params);
    });
    chain = job.catch(() => {});
    return job;
  };
  const world = { db, run, offline: new Set(), subs: [], sessions: {}, notifications, USERS, files: new Map(), tokens: new Set(), mediaBase: "http://storage.test", uploads: [], removals: [] };

  // Realtime, as Supabase does it: inserts/updates only to people allowed to read the row,
  // deletes to everyone on that table but carrying just the id.
  async function broadcast(table, eventType, row) {
    for (const sub of [...world.subs]) {
      if (sub.table !== table || (sub.event !== "*" && sub.event !== eventType) || world.offline.has(sub.uid)) continue;
      if (eventType === "DELETE") { sub.cb({ eventType, old: { id: row.id }, new: {} }); continue; }
      const key = table === "conversation_backgrounds" ? "conversation_id" : "id";
      const seen = await run(sub.uid, `select 1 from public.${table} where ${key} = $1`, [row[key]]);
      if (seen.rows.length) sub.cb({ eventType, new: row, old: {} });
    }
  }
  const SETS = new Set(["list_friends", "list_conversations", "list_conversations_v2", "list_blocked", "current_call"]);
  const ROWS = new Set(["start_call", "answer_call", "end_call"]); // answer with one whole row
  const callsNow = async () => (process.env.NO_VOICE_SQL ? new Map() : new Map((await run(null, "select * from public.voice_calls")).rows.map((r) => [r.id, r])));
  const reactionsNow = async () => (!hasReactions ? new Map() : new Map((await run(null, "select * from public.message_reactions")).rows.map((r) => [String(r.id), r])));
  const messageIds = async () => new Set((await run(null, "select id from public.messages")).rows.map((r) => r.id));
  const snapshot = async () => new Map((await run(null, "select * from public.friendships")).rows.map((r) => [r.id, r]));

  function clientFor(uid) {
    const fail = (e) => ({ data: null, error: { message: e.message, code: e.code || "" } });
    const guard = () => { if (world.offline.has(uid)) throw Object.assign(new Error("TypeError: fetch failed"), { code: "" }); };
    const from = (table) => {
      const s = { op: "select", cols: "*", where: [], params: [], order: [], limit: null, row: null, single: null, returning: null };
      const add = (sqlText, value) => { s.params.push(value); s.where.push(sqlText.replace("?", "$" + s.params.length)); };
      const exec = async () => {
        try {
          guard();
          const where = s.where.length ? " where " + s.where.join(" and ") : "";
          let res, rows;
          if (s.op === "select") {
            res = await run(uid, `select ${s.cols} from public.${table}${where}${s.order.length ? " order by " + s.order.join(", ") : ""}${s.limit ? " limit " + s.limit : ""}`, s.params);
            rows = res.rows;
          } else if (s.op === "insert") {
            if (table === "messages") await run(null, "select pg_sleep(0.003)"); // this test database's clock only counts milliseconds; real Postgres counts microseconds
            const keys = Object.keys(s.row);
            res = await run(uid, `insert into public.${table} (${keys.join(",")}) values (${keys.map((_, i) => "$" + (i + 1)).join(",")}) returning *`, keys.map((k) => s.row[k]));
            rows = res.rows;
            for (const r of rows) await broadcast(table, "INSERT", JSON.parse(JSON.stringify(r)));
          } else if (s.op === "delete") {
            const callsBefore = table === "friendships" ? await callsNow() : null;
            res = await run(uid, `delete from public.${table}${where} returning *`, s.params);
            rows = res.rows;
            for (const r of rows) await broadcast(table, "DELETE", r);
            // Removing a friend ends a call with them: that change arrives live as well
            if (callsBefore) for (const [cid, row] of await callsNow()) if (callsBefore.get(cid) && callsBefore.get(cid).status !== row.status) await broadcast("voice_calls", "UPDATE", plain(row));
          }
          rows = plain(rows);
          if (s.single === "single") return rows.length === 1 ? { data: rows[0], error: null } : fail(Object.assign(new Error("JSON object requested, multiple (or no) rows returned"), { code: "PGRST116" }));
          if (s.single === "maybe") return { data: rows[0] || null, error: null };
          return { data: rows, error: null };
        } catch (e) { return fail(e); }
      };
      const api = {
        select(cols) { if (s.op === "select") s.cols = cols || "*"; else s.returning = cols; return api; },
        insert(row) { s.op = "insert"; s.row = row; return api; },
        delete() { s.op = "delete"; return api; },
        eq(col, v) { add(`${col} = ?`, v); return api; },
        lt(col, v) { add(`${col} < ?`, v); return api; },
        gt(col, v) { add(`${col} > ?`, v); return api; },
        in(col, list) { add(`${col}::text = any(?::text[])`, list); return api; },
        ilike(col, v) { add(`${col} ilike ?`, v); return api; },
        order(col, o) { s.order.push(col + (o && o.ascending === false ? " desc" : "")); return api; },
        limit(n) { s.limit = n; return api; },
        single() { s.single = "single"; return exec(); },
        maybeSingle() { s.single = "maybe"; return exec(); },
        then(res, rej) { return exec().then(res, rej); },
      };
      return api;
    };
    // Storage, as Supabase does it: bucket limits first, then the row is written as the user (so the
    // real rules decide), and viewing links are only made for files that user is allowed to see.
    const storage = {
      from(bucket) {
        const no = (message, statusCode) => ({ data: null, error: { message, statusCode, name: "StorageApiError" } });
        return {
          async upload(objectPath, body, opts = {}) {
            try {
              guard();
              world.uploads.push({ uid, bucket, path: objectPath, opts, size: body.length });
              const b = (await run(null, "select * from storage.buckets where id = $1", [bucket])).rows[0];
              if (!b) return no("Bucket not found", "404");
              if (b.file_size_limit && body.length > Number(b.file_size_limit)) return no("The object exceeded the maximum allowed size", "413");
              if (b.allowed_mime_types && !b.allowed_mime_types.includes(opts.contentType)) return no(`mime type ${opts.contentType} is not supported`, "415");
              await run(uid, "insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, $3::uuid, $4, $5::jsonb)", [bucket, objectPath, uid, uid, JSON.stringify({ size: body.length, mimetype: opts.contentType })]);
              world.files.set(bucket + "/" + objectPath, { bytes: Buffer.from(body), type: opts.contentType });
              return { data: { path: objectPath, fullPath: bucket + "/" + objectPath }, error: null };
            } catch (e) {
              if (/row-level security/.test(e.message)) return no("new row violates row-level security policy", "403");
              if (/duplicate key/.test(e.message)) return no("The resource already exists", "409");
              return no(e.message, "500");
            }
          },
          async remove(paths) {
            try {
              guard();
              const gone = [];
              for (const p of paths) {
                const res = await run(uid, "delete from storage.objects where bucket_id = $1 and name = $2 returning name", [bucket, p]); // the real rules decide
                if (res.rows.length) { world.files.delete(bucket + "/" + p); gone.push({ name: p }); }
              }
              world.removals.push({ uid, bucket, paths, removed: gone.length });
              return { data: gone, error: null };
            } catch (e) { return no(e.message, "500"); }
          },
          async createSignedUrls(paths, expiresIn) {
            try {
              guard();
              const out = [];
              for (const p of paths) {
                const seen = await run(uid, "select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, p]);
                if (!seen.rows.length) { out.push({ path: p, signedUrl: null, error: "Either the object does not exist or you do not have access to it" }); continue; }
                const token = require("crypto").randomBytes(12).toString("hex");
                world.tokens.add(token);
                out.push({ path: p, signedUrl: `${world.mediaBase}/media/${bucket}/${p}?token=${token}&expires=${expiresIn}`, error: null });
              }
              return { data: out, error: null };
            } catch (e) { return no(e.message, "500"); }
          },
        };
      },
    };
    return {
      from, storage,
      async rpc(name, args = {}) {
        try {
          guard();
          const keys = Object.keys(args);
          const call = `public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
          const before = /friend|block/.test(name) ? await snapshot() : null;
          const voice = /call|friend|block/.test(name) ? { calls: await callsNow(), messages: await messageIds() } : null;
          const liked = /react_to_message|delete_message/.test(name) ? await reactionsNow() : null;
          const res = await run(uid, SETS.has(name) || ROWS.has(name) ? `select * from ${call}` : `select ${call} as r`, keys.map((k) => args[k]));
          if (voice) {
            // Calls starting, being answered and ending arrive live, as do the details the PCs swap
            // and the note a missed call leaves in the conversation
            const after = await callsNow();
            for (const [cid, row] of after) { const was = voice.calls.get(cid); if (!was) await broadcast("voice_calls", "INSERT", plain(row)); else if (was.status !== row.status) await broadcast("voice_calls", "UPDATE", plain(row)); }
            if (name === "send_call_signal") { const row = (await run(null, "select * from public.voice_signals where id = $1", [res.rows[0].r])).rows[0]; if (row) await broadcast("voice_signals", "INSERT", plain(row)); }
            for (const row of (await run(null, "select * from public.messages order by created_at")).rows) if (!voice.messages.has(row.id)) await broadcast("messages", "INSERT", plain(row));
          }
          if (liked) {
            // A like or dislike being added, changed or taken back arrives live for the two people in the chat
            for (const [rid, row] of await reactionsNow()) { const was = liked.get(rid); if (!was) await broadcast("message_reactions", "INSERT", plain(row)); else if (was.reaction !== row.reaction) await broadcast("message_reactions", "UPDATE", plain(row)); }
          }
          if (name === "delete_message") {
            const row = (await run(null, "select * from public.messages where id = $1", [args.message])).rows[0];
            if (row) await broadcast("messages", "UPDATE", JSON.parse(JSON.stringify(row)));
          }
          if (name === "mark_conversation_read") { // reads arrive as updates too, as on Supabase
            for (const row of (await run(null, "select * from public.messages where conversation_id = $1 and deleted_at is null and read_at > now() - interval '2 seconds'", [args.conversation])).rows) await broadcast("messages", "UPDATE", JSON.parse(JSON.stringify(row)));
          }
          if (name === "set_conversation_background") {
            const row = (await run(null, "select * from public.conversation_backgrounds where conversation_id = $1", [args.conversation])).rows[0];
            if (row) await broadcast("conversation_backgrounds", "UPDATE", JSON.parse(JSON.stringify(row)));
          }
          if (before) {
            const after = await snapshot();
            for (const [fid, row] of after) { const was = before.get(fid); if (!was) await broadcast("friendships", "INSERT", row); else if (was.status !== row.status) await broadcast("friendships", "UPDATE", row); }
            for (const [fid, row] of before) if (!after.has(fid)) await broadcast("friendships", "DELETE", row);
          }
          const rows = plain(res.rows);
          return { data: SETS.has(name) ? rows : ROWS.has(name) ? rows[0] : rows[0].r, error: null };
        } catch (e) { return fail(e); }
      },
      channel(name) {
        const mine = [];
        let statusCb = null;
        const ch = {
          name,
          on(_kind, filter, cb) { mine.push({ uid, table: filter.table, event: filter.event, cb }); return ch; },
          subscribe(cb) {
            statusCb = cb;
            // A table that doesn't exist makes the whole channel fail, as on Supabase
            Promise.all(mine.map((m) => run(null, "select to_regclass($1) as t", ["public." + m.table]).then((r) => !!r.rows[0].t))).then((exist) => {
              if (exist.every(Boolean)) world.subs.push(...mine); else ch._broken = true;
              setTimeout(() => cb && cb(ch._broken || world.offline.has(uid) ? "CHANNEL_ERROR" : "SUBSCRIBED"), 5);
            });
            return ch;
          },
          _remove() { world.subs = world.subs.filter((x) => !mine.includes(x)); },
          _status(st) { statusCb && statusCb(st); },
        };
        if (world.sessions[uid]) { (world.sessions[uid].channels ||= []).push(ch); if (!/-(bg|calls|reactions):/.test(name)) world.sessions[uid].channel = ch; }
        return ch;
      },
      removeChannel(ch) { ch._remove(); },
      auth: { onAuthStateChange(cb) { world.sessions[uid].authCb = cb; return { data: { subscription: { unsubscribe() {} } } }; } },
    };
  }

  // One running copy of social.js per user, as if each were their own AURA
  const { register } = require(socialPath);
  world.login = (key) => {
    const user = USERS[key];
    const session = { key, user, events: [], listeners: new Set(), focused: true, handlers: {} };
    world.sessions[user.id] = session;
    const client = clientFor(user.id);
    const win = { isDestroyed: () => false, isFocused: () => session.focused, isVisible: () => true, isMinimized: () => false, restore() {}, show() { session.shown = true; }, focus() { session.focused = true; },
      flashFrame(on) { session.flashing = !!on; (session.flashes ||= []).push(!!on); },
      webContents: { send: (_ch, ev) => { session.events.push(ev); session.listeners.forEach((l) => l(ev)); } } };
    const cloudHandler = (fn) => async (_e, ...args) => { try { return { success: true, data: (await fn(...args)) ?? null }; } catch (e) { return { success: false, error: e?.message || "Something went wrong" }; } };
    session.api = register({
      ipcMain: { handle: (ch, fn) => { session.handlers[ch] = fn; } }, cloudHandler,
      cloud: { internals: { client: () => client, currentUser: async () => ({ id: user.id, user_metadata: { username: user.username } }) } },
      getWindow: () => win,
      // The AURA server, as the main file passes it in. Tests set world.server to stand in for it.
      ...(world.noServer ? {} : { server: async (route, body) => { (world.serverCalls ||= []).push({ uid: user.id, route, body }); return world.server ? world.server(route, body, user) : { success: false, error: "The AURA server answered with an error (404)." }; } }),
    });
    session.call = (name, ...args) => session.handlers["social:" + name](null, ...args);
    return session;
  };
  world.setOffline = (key, off) => { const uid = USERS[key].id; off ? world.offline.add(uid) : world.offline.delete(uid); world.sessions[uid]?.channel?._status(off ? "CHANNEL_ERROR" : "SUBSCRIBED");
    // The other connections (chat backgrounds, calls) drop and come back with it
    for (const ch of world.sessions[uid]?.channels || []) if (ch !== world.sessions[uid].channel && !ch._broken) ch._status(off ? "CHANNEL_ERROR" : "SUBSCRIBED"); };
  return world;
}
module.exports = { createWorld, USERS, fakeApp };
