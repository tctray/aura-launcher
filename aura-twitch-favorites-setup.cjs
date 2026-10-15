#!/usr/bin/env node
/**
 * AURA — Twitch favorites, with a notice when they go live
 *
 *   - Every stream card gets a star. Click it to add that streamer to your favorites, click it
 *     again to remove them. Works on Home, on Live Streams and on search results (also for
 *     channels that are offline).
 *   - Live Streams shows your Favorites on top: the ones live now first (most watched first,
 *     with how long they've been live when Twitch says), then the rest greyed out as Offline.
 *   - When a favorite goes live you get a notice: inside AURA when it's in front, or a Windows
 *     notification when AURA is hidden or behind other windows. Clicking it opens the stream.
 *     Favorites are checked every 2 minutes. No notice twice for the same streamer within half
 *     an hour. Switch it off with "Tell me when they go live" on Live Streams.
 *   - Home: "+ Streamers" becomes "★ Favorites", where you can add a name or a twitch.tv link
 *     and remove names. The names you had typed there carry over as favorites.
 *   - Favorites are saved to your account, so they follow you to another PC.
 * It uses AURA's existing Twitch server, so nothing new is needed on GoDaddy and no keys change.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-twitch-favorites-setup.cjs
 *
 * What it does:
 *   - creates  src/components/twitchfavs.jsx  favorites, the star, the live checks
 *   - edits    src/App.jsx                    the star, the Favorites row, the notices, Home
 *   - edits    src/cloudsync.js               favorites travel with your account
 *   - edits    electron/main.js               the Windows notification
 *   - edits    electron/preload.js            lets the window ask for it
 *   - creates  tests/twitch-favorites.cjs     (only if AURA's checks are installed) checks it
 *
 * Every file it changes is copied to <name>.before-twitch-favorites.bak first.
 * To put everything back:                 node aura-twitch-favorites-setup.cjs --undo
 * To preview without changing anything:   node aura-twitch-favorites-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FILES = {"favs":"// Twitch favorites: the streamers you star, which of them are live, and a notice when one goes live.\n// The list itself is kept in AURA's settings (twitchFavs), so it travels with your account.\n// Added by aura-twitch-favorites-setup.cjs\nimport { useEffect, useRef, useState } from \"react\";\n\nexport const MAX_FAVS = 50;\nconst LOGIN = /^[a-z0-9_]{1,25}$/;\nconst CHECK_EVERY_MS = 2 * 60 * 1000;   // how often favorites are checked\nconst QUIET_MS = 30 * 60 * 1000;        // no second notice for the same streamer within this time\nconst PER_ASK = 10;                     // streamers per request to AURA's Twitch server\n\n// A stream's or channel's Twitch login name (\"shroud\"), or \"\" if it can't be told\nexport function loginOf(s) {\n  if (!s || typeof s !== \"object\") return \"\";\n  const tries = [s.userLogin, s.login];\n  try {\n    const u = new URL(String(s.url || \"\"));\n    if (/(^|\\.)twitch\\.tv$/i.test(u.hostname)) tries.push(u.pathname.split(\"/\")[1]);\n  } catch {}\n  tries.push(s.user);\n  for (const t of tries) {\n    const v = String(t || \"\").trim().toLowerCase();\n    if (LOGIN.test(v)) return v;\n  }\n  return \"\";\n}\n\n// What someone typed: \"shroud\", \"@shroud\", \"twitch.tv/shroud\" or a full link\nexport function parseLogin(text) {\n  let v = String(text || \"\").trim();\n  const link = /(?:^|\\/\\/|\\.)twitch\\.tv\\/([^/?#\\s]+)/i.exec(v);\n  if (link) v = link[1];\n  v = v.replace(/^@/, \"\").toLowerCase();\n  return LOGIN.test(v) ? v : \"\";\n}\n\nconst okPic = (v) => (typeof v === \"string\" && v.length < 500 && /^https:\\/\\/([a-z0-9-]+\\.)*(jtvnw\\.net|twitch\\.tv)\\//i.test(v) ? v : \"\");\n\n// Favorites as they're saved: [{ login, name, pic? }], no repeats, at most MAX_FAVS\nexport function cleanFavs(list) {\n  const out = [];\n  const seen = new Set();\n  for (const f of Array.isArray(list) ? list : []) {\n    const login = String(f?.login || \"\").trim().toLowerCase();\n    if (!LOGIN.test(login) || seen.has(login)) continue;\n    seen.add(login);\n    const name = typeof f.name === \"string\" && f.name.trim() ? f.name.trim().slice(0, 40) : login;\n    const pic = okPic(f.pic);\n    out.push(pic ? { login, name, pic } : { login, name });\n    if (out.length >= MAX_FAVS) break;\n  }\n  return out;\n}\n\nexport const isFav = (favs, s) => {\n  const login = loginOf(s);\n  return !!login && Array.isArray(favs) && favs.some((f) => f?.login === login);\n};\n\n// Star or unstar a stream or channel\nexport function toggleFav(favs, s) {\n  const list = cleanFavs(favs);\n  const login = loginOf(s);\n  if (!login) return list;\n  if (list.some((f) => f.login === login)) return list.filter((f) => f.login !== login);\n  if (list.length >= MAX_FAVS) return list;\n  return cleanFavs([...list, { login, name: s.user || s.name || login, pic: s.pic }]);\n}\n\n// The names typed into \"+ Streamers\" before favorites existed\nexport function migrateFavs(text) {\n  return cleanFavs(String(text || \"\").split(\",\").map((x) => ({ login: parseLogin(x) })));\n}\n\n// Who just went live: seen offline last time, live now, and not announced in the last half hour.\n// Someone seen for the first time (just starred, or AURA just opened) is never announced.\nexport function liveChanges(prev, liveNow, logins, now, lastNotice, quietMs = QUIET_MS) {\n  const next = new Map();\n  const wentLive = [];\n  for (const login of logins) {\n    const on = liveNow.has(login);\n    next.set(login, on);\n    if (on && prev.get(login) === false && !(now - (lastNotice.get(login) || 0) < quietMs)) wentLive.push(login);\n  }\n  return { next, wentLive };\n}\n\n// Names as Twitch writes them (\"pokimane\" -> \"Pokimane\"), once a favorite has been seen live.\n// A new list when something changed, otherwise null.\nexport function renameFavs(favs, found) {\n  const list = cleanFavs(favs);\n  let changed = false;\n  const next = list.map((f) => {\n    const s = found.get(f.login);\n    const name = typeof s?.user === \"string\" ? s.user.trim() : \"\";\n    if (!name || name === f.name || name.toLowerCase() !== f.login) return f;\n    changed = true;\n    return { ...f, name };\n  });\n  return changed ? next : null;\n}\n\n// Ask AURA's Twitch server which favorites are live. A Map of login -> stream, or null if it couldn't tell.\nexport async function fetchFavLive(logins, ask) {\n  const found = new Map();\n  for (let i = 0; i < logins.length; i += PER_ASK) {\n    const part = logins.slice(i, i + PER_ASK);\n    let res = null;\n    try { res = await ask({ gameNames: [], userLogins: part }); } catch { return null; }\n    if (!res?.success || !Array.isArray(res.streams)) return null;\n    const wanted = new Set(part);\n    for (const s of res.streams) {\n      const login = loginOf(s);\n      if (wanted.has(login) && !found.has(login)) found.set(login, s);\n    }\n  }\n  return found;\n}\n\n// ── Which favorites are live right now, shared by the whole window ───────────\nconst store = { live: new Map(), checked: false, listeners: new Set(), checks: new Set() };\nfunction publish(live, checked) {\n  store.live = live;\n  store.checked = checked;\n  store.listeners.forEach((fn) => fn());\n}\nexport function useFavLive() {\n  const [, setTick] = useState(0);\n  useEffect(() => {\n    const fn = () => setTick((n) => n + 1);\n    store.listeners.add(fn);\n    return () => { store.listeners.delete(fn); };\n  }, []);\n  return { live: store.live, checked: store.checked };\n}\nexport const favLiveStream = (login) => store.live.get(login) || null;\n// Check again now (the Live page's refresh button)\nexport function refreshFavLive() { store.checks.forEach((fn) => fn()); }\n\n// Runs once, in the main window: keeps checking favorites and calls onLive(stream) when one goes live\nexport function useFavWatch({ favs, alerts, onLive, onSeen, everyMs = CHECK_EVERY_MS }) {\n  const logins = cleanFavs(favs).map((f) => f.login).join(\",\");\n  const ref = useRef({ prev: new Map(), last: new Map() });\n  ref.current.alerts = alerts;\n  ref.current.onLive = onLive;\n  ref.current.onSeen = onSeen;\n  useEffect(() => {\n    const r = ref.current;\n    const list = logins ? logins.split(\",\") : [];\n    const ask = window.electronAPI?.fetchTwitchStreams;\n    // Keep what's known about streamers still starred, so the page doesn't flicker\n    const kept = new Map([...store.live].filter(([login]) => list.includes(login)));\n    if (!list.length || typeof ask !== \"function\") { publish(kept, true); return; }\n    publish(kept, store.checked && kept.size === store.live.size);\n    let alive = true, busy = false;\n    const check = async () => {\n      if (busy || !alive) return;\n      busy = true;\n      try {\n        const found = await fetchFavLive(list, ask);\n        if (!alive || !found) return; // couldn't reach Twitch: try again next time, and don't announce anyone\n        const { next, wentLive } = liveChanges(r.prev, found, list, Date.now(), r.last);\n        r.prev = next;\n        publish(found, true);\n        try { r.onSeen?.(found); } catch {}\n        if (!r.alerts) return;\n        for (const login of wentLive) {\n          r.last.set(login, Date.now());\n          try { r.onLive?.(found.get(login)); } catch {}\n        }\n      } finally { busy = false; }\n    };\n    const soon = setTimeout(check, 1200); // a moment after starring, so a few quick clicks are one check\n    const timer = setInterval(check, everyMs);\n    store.checks.add(check);\n    return () => { alive = false; clearTimeout(soon); clearInterval(timer); store.checks.delete(check); };\n  }, [logins, everyMs]);\n}\n\n// How long a stream has been live, when Twitch says when it started\nexport function liveFor(started, now = Date.now()) {\n  const t = typeof started === \"number\" ? started : Date.parse(started || \"\");\n  if (!Number.isFinite(t) || t > now) return \"\";\n  const mins = Math.floor((now - t) / 60000);\n  if (mins < 1) return \"Just went live\";\n  if (mins < 60) return \"Live \" + mins + \"m\";\n  return \"Live \" + Math.floor(mins / 60) + \"h \" + (mins % 60) + \"m\";\n}\n\n// ── The star on every stream card ────────────────────────────────────────────\nexport function FavStar({ on, name, onToggle }) {\n  return (\n    <button type=\"button\" className={\"twitch-fav\" + (on ? \" is-on\" : \"\")} aria-pressed={on}\n      title={on ? \"Remove from favorites\" : \"Add to favorites\"}\n      aria-label={(on ? \"Remove \" : \"Add \") + name + (on ? \" from favorites\" : \" to favorites\")}\n      onClick={(e) => { e.stopPropagation(); onToggle(); }}\n      onKeyDown={(e) => e.stopPropagation()}>\n      <svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" aria-hidden=\"true\">\n        <path d=\"M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z\" fill={on ? \"currentColor\" : \"none\"} stroke=\"currentColor\" strokeWidth=\"1.8\" strokeLinejoin=\"round\"/>\n      </svg>\n    </button>\n  );\n}\n\n// ── Home: add and remove favorites by name ───────────────────────────────────\nexport function FavEditor({ favs, onChange }) {\n  const list = cleanFavs(favs);\n  const [text, setText] = useState(\"\");\n  const [note, setNote] = useState(\"\");\n  const add = () => {\n    const names = text.split(/[,\\s]+/).filter(Boolean);\n    if (!names.length) return;\n    const bad = names.filter((n) => !parseLogin(n));\n    let next = list, full = false;\n    for (const n of names) {\n      const login = parseLogin(n);\n      if (!login || next.some((f) => f.login === login)) continue;\n      if (next.length >= MAX_FAVS) { full = true; continue; }\n      next = [...next, { login, name: login }];\n    }\n    if (next !== list) onChange(cleanFavs(next));\n    setText(bad.length ? bad.join(\", \") : \"\");\n    setNote(bad.length ? \"Twitch names use only letters, numbers and _ : \" + bad.join(\", \") : full ? \"You can keep up to \" + MAX_FAVS + \" favorites.\" : \"\");\n  };\n  return (\n    <div className=\"fav-edit\">\n      <div className=\"fav-edit-add\">\n        <input className=\"fi\" value={text} onChange={(e) => { setText(e.target.value); setNote(\"\"); }}\n          onKeyDown={(e) => { if (e.key === \"Enter\") { e.preventDefault(); add(); } }}\n          placeholder=\"Twitch name or link, e.g. shroud\" aria-label=\"Add a favorite streamer\" style={{ fontSize: 11 }}/>\n        <button type=\"button\" className=\"btn-p\" onClick={add} disabled={!text.trim()}>Add</button>\n      </div>\n      {note && <div className=\"fav-edit-note\" role=\"status\">{note}</div>}\n      {list.length > 0 && (\n        <ul className=\"fav-chips\" aria-label=\"Your favorite streamers\">\n          {list.map((f) => (\n            <li key={f.login} className=\"fav-chip\">\n              <span>{f.name}</span>\n              <button type=\"button\" aria-label={\"Remove \" + f.name + \" from favorites\"} title=\"Remove\"\n                onClick={() => onChange(list.filter((x) => x.login !== f.login))}>×</button>\n            </li>\n          ))}\n        </ul>\n      )}\n      <div className=\"fav-edit-hint\">Your favorites show first here and on Live Streams. Streams for games in your library show too.</div>\n    </div>\n  );\n}\n\n// ── Looks ────────────────────────────────────────────────────────────────────\n// White only: the stream cards keep to no purple and no gold.\nexport const FAV_CSS = `\n.twitch-fav{position:absolute;top:10px;right:10px;z-index:4;width:30px;height:30px;padding:0;border-radius:50%;display:grid;place-items:center;border:1px solid rgba(255,255,255,.22);background:rgba(0,0,0,.55);color:rgba(255,255,255,.88);cursor:pointer;opacity:0;transition:opacity .2s,transform .15s,background .15s;}\n.twitch-card:hover .twitch-fav,.twitch-card:focus-within .twitch-fav,.twitch-card.on .twitch-fav,.twitch-card.ctrl-focus .twitch-fav,.twitch-fav.is-on{opacity:1;}\n.twitch-fav.is-on{color:#fff;background:rgba(0,0,0,.72);border-color:rgba(255,255,255,.6);}\n.twitch-fav:hover{transform:scale(1.08);background:rgba(0,0,0,.8);}\n.twitch-fav:focus-visible{outline:2px solid #fff;outline-offset:2px;opacity:1;}\n.reduce-motion .twitch-fav:hover{transform:none;}\n.fav-row{margin-bottom:28px;}\n.fav-hdr{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;}\n.fav-title{margin:0;font-family:Rajdhani,sans-serif;font-size:15px;font-weight:700;letter-spacing:1.5px;color:var(--t1);}\n.fav-count{font-size:11px;color:var(--t2);}\n.fav-alerts{margin-left:auto;display:flex;align-items:center;gap:7px;font-size:11px;color:var(--t2);cursor:pointer;user-select:none;}\n.fav-alerts input{accent-color:var(--ac);width:14px;height:14px;margin:0;cursor:pointer;}\n.fav-empty{margin-bottom:22px;padding:12px 14px;border:1px dashed var(--border);border-radius:10px;font-size:12px;color:var(--t2);display:flex;align-items:center;gap:10px;}\n.fav-empty svg{flex-shrink:0;color:var(--t3);}\n.fav-edit{padding:0 40px;margin-bottom:12px;}\n.fav-edit-add{display:flex;gap:8px;align-items:center;}\n.fav-edit-add .fi{flex:1;}\n.fav-edit-add .btn-p{font-size:11px;padding:7px 14px;flex-shrink:0;}\n.fav-edit-add .btn-p:disabled{opacity:.5;cursor:default;}\n.fav-edit-note{font-size:10px;color:var(--danger);margin-top:5px;}\n.fav-chips{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:6px;}\n.fav-chip{display:flex;align-items:center;gap:4px;padding:3px 4px 3px 10px;border-radius:20px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);font-size:11px;color:var(--t1);}\n.fav-chip button{width:20px;height:20px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--t3);cursor:pointer;font-size:14px;line-height:1;}\n.fav-chip button:hover,.fav-chip button:focus-visible{background:rgba(255,255,255,.12);color:var(--t1);}\n.fav-edit-hint{font-size:10px;color:var(--t3);margin-top:6px;}\n`;\nif (typeof document !== \"undefined\" && !document.getElementById(\"aura-fav-css\")) {\n  const el = document.createElement(\"style\");\n  el.id = \"aura-fav-css\";\n  el.textContent = FAV_CSS;\n  document.head.appendChild(el);\n}\n","test":"// Twitch favorites: the star on every stream card, the Favorites row on Live Streams, the\n// notice when a favorite goes live, and the ★ Favorites box on Home.\n//\n// Opens the built window (dist) in a real browser with a pretend desktop side and pretend\n// streams, where the test decides who is live, and checks:\n//   - names typed into the old \"+ Streamers\" box become favorites (bad names are dropped)\n//   - Live Streams: Favorites on top, live ones first, offline ones greyed; not shown twice below\n//   - the star adds and removes a favorite, from a stream, an offline favorite or a search\n//   - going live: a notice inside AURA when it's in front, a Windows notification when it isn't;\n//     no notice for someone just starred, none twice in a row, none when switched off\n//   - clicking the Windows notification opens the stream\n//   - favorites are saved to the account\n//   - Home: add by name or link, remove, bad names explained\n// Added by aura-twitch-favorites-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\n\n(async () => {\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(process.env.CI ? 1 : 3); }\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch(options); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with. Run  npx playwright install chromium  once to add one.\"); return done(process.env.CI ? 1 : 3); }\n\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(DIST, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => {\n      if (err) { res.writeHead(404); return res.end(); }\n      res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" });\n      res.end(data);\n    });\n  });\n  await new Promise((r) => server.listen(0, \"127.0.0.1\", r));\n  const base = \"http://127.0.0.1:\" + server.address().port;\n\n  try {\n    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();\n    const thrown = [];\n    page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n    await page.route((url) => !String(url).startsWith(base) && !String(url).startsWith(\"data:\"), (route) => route.abort());\n    await page.addInitScript(() => {\n      try {\n        localStorage.clear();\n        localStorage.setItem(\"aura_profile\", JSON.stringify({ username: \"tester\", avatar: \"\", userId: \"user-1\" }));\n        localStorage.setItem(\"aura_twitch_logins\", \"Pokimane, bad name!, twitch.tv/xQc,\");\n      } catch {}\n      window.__calls = [];\n      window.__front = true; // is AURA the window in front?\n      Document.prototype.hasFocus = function () { return window.__front; };\n      const ok = (data) => Promise.resolve({ success: true, data });\n      const account = {\n        getSession: () => ok({ id: \"user-1\", email: \"me@example.com\" }),\n        getMyProfile: () => ok({ username: \"tester\", avatar_url: null }),\n        saveProfile: (name, picture) => ok({ username: name, avatar_url: picture || null }),\n        getMyData: () => ok([]),\n        getMySessionIds: () => ok([]),\n        saveMyData: (rows) => { window.__saved = (window.__saved || []).concat([rows]); return ok(null); },\n      };\n      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => (name === \"auraCloud\" && account[key]) ? account[key](...args) : ok(null)) });\n      window.auraCloud = fake(\"auraCloud\");\n      window.auraSocial = fake(\"auraSocial\");\n      const picture = (hue) => \"data:image/svg+xml;base64,\" + btoa(`<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"440\" height=\"248\"><rect width=\"440\" height=\"248\" fill=\"hsl(${hue},60%,45%)\"/></svg>`);\n      const names = [\"Shroud\", \"Pokimane\", \"TimTheTatman\", \"Myth\", \"Nickmercs\", \"Summit1g\", \"Lirik\", \"DrLupo\"];\n      // viewers: Shroud 8K, Pokimane 7K, ... others 1K\n      const streamOf = (user, i) => ({ id: \"s-\" + user.toLowerCase(), user, userLogin: user.toLowerCase(), title: user + \" is live\", game: \"Game \" + (i + 1), viewers: 1000 * Math.max(1, 8 - i), thumbnail: picture(i * 40), url: \"https://twitch.tv/\" + user.toLowerCase(), startedAt: new Date(Date.now() - 95 * 60000).toISOString() });\n      const games = names.map(streamOf);\n      // Who is live, as the test says. Pokimane is; xQc and NinjaFan aren't yet.\n      window.__live = new Set([\"shroud\", \"pokimane\", \"timthetatman\", \"myth\", \"nickmercs\", \"summit1g\", \"lirik\", \"drlupo\"]);\n      window.__asked = [];\n      const display = { xqc: \"xQc\", ninjafan: \"NinjaFan\" };\n      const desktop = {\n        fetchTwitchStreams: ({ gameNames = [], userLogins = [] } = {}) => {\n          if (!gameNames.length && userLogins.length) {\n            window.__asked.push(userLogins);\n            return Promise.resolve({ success: true, streams: userLogins.filter((l) => window.__live.has(l)).map((l) => { const n = names.find((x) => x.toLowerCase() === l); return streamOf(display[l] || n || l, n ? names.indexOf(n) : 20); }) });\n          }\n          return Promise.resolve({ success: true, streams: games });\n        },\n        searchTwitch: () => Promise.resolve({\n          success: true,\n          channels: [\n            { id: \"c1\", name: \"Ninja\", login: \"ninja\", title: \"Ninja plays tonight\", game: \"Fortnite\", thumbnail: picture(10), isLive: true },\n            { id: \"c2\", name: \"NinjaFan\", login: \"ninjafan\", title: \"\", game: \"Fortnite\", thumbnail: \"https://static-cdn.jtvnw.net/jtv_user_pictures/ninjafan-profile.png\", isLive: false },\n          ],\n          games: [], gameStreams: [],\n        }),\n      };\n      window.electronAPI = new Proxy({}, {\n        get: (_t, key) => {\n          if (key === \"isElectron\") return true;\n          if (typeof key !== \"string\" || key === \"then\") return undefined;\n          if (key === \"onTwitchOpenStream\") return (cb) => { window.__openStream = cb; return () => { window.__openStream = null; }; };\n          if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};\n          return (...args) => { window.__calls.push([key, args]); return desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }); };\n        },\n      });\n    });\n    await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n    await page.waitForTimeout(4500);\n    const menu = async (name) => { await page.locator(`.gm-rail-item[title=\"${name}\"], .sb-item[title=\"${name}\"]`).first().click({ timeout: 5000 }); await page.waitForTimeout(600); };\n    const called = (name) => page.evaluate((n) => window.__calls.filter(([k]) => k === n).map(([, a]) => a[0]), name);\n    const favs = () => page.evaluate(() => { try { return (JSON.parse(localStorage.getItem(\"aura_settings\") || \"{}\").twitchFavs || []).map((f) => f.login); } catch { return null; } });\n    const away = async () => { await page.mouse.move(700, 8); await page.waitForTimeout(500); };\n    const ROW = \".fav-row .twitch-card\";\n    const rowCards = () => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((c) => ({ name: c.querySelector(\".twitch-rest\").childNodes[0].textContent, off: c.classList.contains(\"off\"), starred: !!c.querySelector(\".twitch-fav.is-on\"), text: c.innerText })), ROW);\n    const wallNames = () => page.evaluate(() => { const walls = [...document.querySelectorAll(\".twitch-wall\")].filter((w) => !w.closest(\".fav-row\")); return walls.flatMap((w) => [...w.querySelectorAll(\".twitch-card\")].map((c) => c.querySelector(\".twitch-rest\").childNodes[0].textContent)); });\n    const refresh = async () => { await page.locator(\"button.btn-p\", { hasText: \"↻\" }).first().click({ timeout: 4000 }); await page.waitForTimeout(900); };\n    const toasts = () => page.evaluate(() => [...document.querySelectorAll(\".toast\")].map((t) => t.innerText));\n    const notices = async () => (await called(\"twitchLiveNotice\")).map((x) => x.login);\n    const live = (login, on) => page.evaluate(([l, o]) => { if (o) window.__live.add(l); else window.__live.delete(l); }, [login, on]);\n\n    console.log(\"1. Names typed into the old + Streamers box carry over\");\n    check(\"they became favorites, and the bad one was dropped\", JSON.stringify(await favs()) === JSON.stringify([\"pokimane\", \"xqc\"]), await favs());\n\n    console.log(\"2. Live Streams: the Favorites row\");\n    await menu(\"Live Streams\");\n    await page.locator(ROW).first().waitFor({ timeout: 8000 });\n    await page.waitForTimeout(1500);\n    let row = await rowCards();\n    check(\"it's at the top of the page, with both favorites\", row.length === 2, row);\n    check(\"the live one comes first, and the offline one is greyed out and says Offline\", row[0].name === \"Pokimane\" && !row[0].off && row[1].name === \"xqc\" && row[1].off && /Offline/.test(row[1].text), row);\n    check(\"it says how many are live\", /1 live now/.test(await page.locator(\".fav-count\").innerText()), await page.locator(\".fav-count\").innerText());\n    check(\"both stars are filled in\", row.every((c) => c.starred), row);\n    await page.locator(ROW).first().hover();\n    await page.waitForTimeout(700);\n    check(\"a live favorite says how long it has been live\", /Live 1h 35m/.test(await page.locator(ROW).first().locator(\".twitch-info\").innerText()), await page.locator(ROW).first().locator(\".twitch-info\").innerText());\n    const tint = await page.evaluate(() => {\n      const found = [];\n      const hueOf = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (d < 40 || mx < 60) return null; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = Math.round(h * 60); return h < 0 ? h + 360 : h; };\n      for (const el of document.querySelectorAll(\".fav-row .twitch-fav, .fav-row .twitch-fav *\")) {\n        const cs = getComputedStyle(el);\n        for (const prop of [\"color\", \"backgroundColor\", \"borderTopColor\", \"fill\", \"stroke\"]) {\n          for (const m of String(cs[prop] || \"\").matchAll(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/g)) { const h = hueOf(+m[1], +m[2], +m[3]); if (h !== null) found.push(prop + \" \" + m[0]); }\n        }\n      }\n      return found;\n    });\n    check(\"the stars are plain white, like the rest of the cards (no purple or gold)\", tint.length === 0, tint);\n    if (process.env.AURA_SHOT) await page.screenshot({ path: process.env.AURA_SHOT });\n    await away();\n    let wall = await wallNames();\n    check(\"a favorite isn't shown a second time in the list below\", wall.length === 7 && !wall.includes(\"Pokimane\"), wall);\n\n    console.log(\"3. The star\");\n    const star = page.locator(\".twitch-wall .twitch-card\", { hasText: \"Shroud\" }).last().locator(\".twitch-fav\");\n    check(\"at rest a card shows no star until you point at it\", Number(await star.evaluate((e) => getComputedStyle(e).opacity)) === 0);\n    await page.locator(\".twitch-wall .twitch-card\", { hasText: \"Shroud\" }).last().hover();\n    await page.waitForTimeout(400);\n    check(\"pointing at a card shows its star\", Number(await star.evaluate((e) => getComputedStyle(e).opacity)) === 1 && (await star.getAttribute(\"aria-pressed\")) === \"false\");\n    const opensBefore = (await called(\"streamOpen\")).length;\n    await star.click({ timeout: 4000 });\n    await page.waitForTimeout(1800);\n    row = await rowCards();\n    check(\"clicking it adds that streamer to Favorites\", JSON.stringify(await favs()) === JSON.stringify([\"pokimane\", \"xqc\", \"shroud\"]) && row.some((c) => c.name === \"Shroud\" && !c.off), { favs: await favs(), row });\n    check(\"and doesn't start the stream\", (await called(\"streamOpen\")).length === opensBefore);\n    check(\"they leave the list below\", !(await wallNames()).includes(\"Shroud\"), await wallNames());\n    check(\"live ones are sorted by how many are watching\", (await rowCards()).map((c) => c.name).join(\",\") === \"Shroud,Pokimane,xqc\", (await rowCards()).map((c) => c.name));\n    await page.locator(ROW, { hasText: \"Shroud\" }).hover();\n    await page.locator(ROW, { hasText: \"Shroud\" }).locator(\".twitch-fav\").click({ timeout: 4000 });\n    await page.waitForTimeout(600);\n    check(\"clicking a filled star removes them again\", JSON.stringify(await favs()) === JSON.stringify([\"pokimane\", \"xqc\"]) && (await wallNames()).includes(\"Shroud\"), await favs());\n    const xqcStar = page.locator(ROW, { hasText: \"xqc\" }).locator(\".twitch-fav\");\n    check(\"an offline favorite's star always shows, so it can be removed\", Number(await xqcStar.evaluate((e) => getComputedStyle(e).opacity)) === 1);\n    await xqcStar.focus();\n    await page.keyboard.press(\"Enter\");\n    await page.waitForTimeout(600);\n    check(\"and works from the keyboard\", JSON.stringify(await favs()) === JSON.stringify([\"pokimane\"]), await favs());\n\n    console.log(\"4. Starring from a search\");\n    const search = page.locator('input[placeholder^=\"Search streamers or games\"]');\n    await search.fill(\"ninja\");\n    await search.press(\"Enter\");\n    await page.waitForTimeout(900);\n    check(\"the Favorites row steps aside while you look at search results\", (await page.locator(\".fav-row\").count()) === 0);\n    const fan = page.locator(\".twitch-wall .twitch-card\", { hasText: \"NinjaFan\" });\n    await fan.hover();\n    await fan.locator(\".twitch-fav\").click({ timeout: 4000 });\n    await page.waitForTimeout(400);\n    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(\"aura_settings\")).twitchFavs);\n    check(\"an offline channel can be starred, and keeps its picture and name\", saved.some((f) => f.login === \"ninjafan\" && f.name === \"NinjaFan\" && /jtvnw\\.net/.test(f.pic || \"\")), saved);\n    await search.fill(\"\");\n    await refresh(); // back to the page\n    await page.waitForTimeout(900);\n    row = await rowCards();\n    check(\"back on the page, they're in Favorites as Offline, with their picture\", row.some((c) => c.name === \"NinjaFan\" && c.off) && (await page.locator(ROW, { hasText: \"NinjaFan\" }).locator(\"img.twitch-thumb\").getAttribute(\"src\")).includes(\"ninjafan-profile\"), row);\n\n    console.log(\"5. When a favorite goes live\");\n    await page.waitForTimeout(400);\n    check(\"no notice for someone you just starred\", (await toasts()).every((t) => !/NinjaFan/.test(t)) && (await notices()).length === 0, await toasts());\n    await live(\"ninjafan\", true);\n    await refresh();\n    let shown = await toasts();\n    check(\"with AURA in front, a notice shows inside AURA\", shown.some((t) => /NinjaFan is live on Twitch/.test(t)) && (await notices()).length === 0, { shown, notices: await notices() });\n    row = await rowCards();\n    check(\"and they move up to the live part of Favorites\", row[0].name !== \"NinjaFan\" ? row.some((c) => c.name === \"NinjaFan\" && !c.off) : !row[0].off, row);\n    await live(\"ninjafan\", false);\n    await refresh();\n    await live(\"ninjafan\", true);\n    await page.waitForTimeout(3200); // let the first notice go\n    await refresh();\n    check(\"going off and on again soon after doesn't give a second notice\", (await toasts()).every((t) => !/NinjaFan/.test(t)), await toasts());\n    // Hidden by the clock\n    await page.evaluate(() => { window.__front = false; });\n    await live(\"pokimane\", false);\n    await refresh();\n    await live(\"pokimane\", true);\n    await refresh();\n    let n = await called(\"twitchLiveNotice\");\n    check(\"with AURA hidden, Windows shows the notice instead\", n.length === 1 && n[0].login === \"pokimane\" && n[0].name === \"Pokimane\" && /Game/.test(n[0].game || \"\"), n);\n    check(\"and AURA doesn't show its own as well\", (await toasts()).every((t) => !/Pokimane/.test(t)), await toasts());\n    // Switched off\n    await page.locator(\".fav-alerts input\").uncheck();\n    await page.waitForTimeout(300);\n    check(\"the switch is remembered\", (await page.evaluate(() => JSON.parse(localStorage.getItem(\"aura_settings\")).twitchLiveAlerts)) === false);\n    await live(\"ninjafan\", false); await refresh();\n    await live(\"ninjafan\", true); await refresh();\n    check(\"switched off, nobody gets announced\", (await called(\"twitchLiveNotice\")).length === 1 && (await toasts()).every((t) => !/NinjaFan/.test(t)));\n    await page.locator(\".fav-alerts input\").check();\n    await page.evaluate(() => { window.__front = true; });\n    check(\"favorites are checked a few at a time\", (await page.evaluate(() => window.__asked.every((a) => a.length <= 10))));\n\n    console.log(\"6. Clicking the Windows notification\");\n    await menu(\"Home\");\n    const before = (await called(\"streamOpen\")).length;\n    await page.evaluate(() => window.__openStream && window.__openStream(\"pokimane\"));\n    await page.waitForTimeout(1600);\n    const opened = (await called(\"streamOpen\")).slice(before);\n    check(\"opens Live Streams and plays that stream\", opened.length === 1 && opened[0].channel === \"pokimane\" && (await page.getByText(\"Hide Chat\").first().isVisible()), opened);\n    await page.evaluate(() => window.__openStream && window.__openStream(\"../evil\"));\n    await page.waitForTimeout(500);\n    check(\"and ignores anything that isn't a Twitch name\", (await called(\"streamOpen\")).length === before + 1);\n    await page.getByText(\"✕ Close\", { exact: true }).first().click({ timeout: 4000 });\n    await page.waitForTimeout(400);\n\n    console.log(\"7. Saved to the account\");\n    await page.waitForTimeout(2600);\n    const rows = await page.evaluate(() => (window.__saved || []).flat().filter((r) => r.key === \"settings\").map((r) => r.value.twitchFavs));\n    const last = rows[rows.length - 1] || [];\n    check(\"the account gets the favorites list\", last.map((f) => f.login).join(\",\") === \"pokimane,ninjafan\", rows);\n\n    console.log(\"8. Home: ★ Favorites\");\n    await menu(\"Home\");\n    const shelfBtn = page.locator(\".twitch-shelf button\", { hasText: \"Favorites\" });\n    check(\"the + Streamers button is now ★ Favorites\", (await shelfBtn.count()) === 1);\n    await shelfBtn.click();\n    await page.waitForTimeout(300);\n    const chips = () => page.locator(\".fav-chip span\").allInnerTexts();\n    check(\"it lists your favorites, with names written the way Twitch shows them\", JSON.stringify(await chips()) === JSON.stringify([\"Pokimane\", \"NinjaFan\"]), await chips());\n    const box = page.locator('input[aria-label=\"Add a favorite streamer\"]');\n    await box.fill(\"https://www.twitch.tv/Lirik?x=1\");\n    await box.press(\"Enter\");\n    await page.waitForTimeout(400);\n    check(\"a link or a name can be added\", (await chips()).includes(\"lirik\") && (await favs()).includes(\"lirik\") && (await box.inputValue()) === \"\", await chips());\n    await box.fill(\"bad-name!\");\n    await page.locator(\".fav-edit .btn-p\").click();\n    await page.waitForTimeout(300);\n    check(\"a name Twitch can't have is explained, and left in the box to fix\", /letters, numbers and _/.test(await page.locator(\".fav-edit-note\").innerText()) && (await favs()).length === 3, await favs());\n    await page.locator('.fav-chip button[aria-label=\"Remove lirik from favorites\"]').click();\n    await page.waitForTimeout(1600);\n    check(\"× removes one\", !(await favs()).includes(\"lirik\") && !(await chips()).includes(\"lirik\"), await favs());\n    const shelfOrder = await page.evaluate(() => [...document.querySelectorAll(\".twitch-shelf .twitch-card\")].map((c) => c.querySelector(\".twitch-rest\").childNodes[0].textContent));\n    check(\"live favorites come first in the Home row\", shelfOrder[0] === \"Pokimane\", shelfOrder.slice(0, 3));\n\n    console.log(\"9. All of it\");\n    check(\"nothing crashed along the way\", (await page.locator(\".aura-fallback\").count()) === 0 && thrown.length === 0, thrown);\n  } finally {\n    await browser.close();\n    server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The Twitch favorites check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-twitch-favorites.bak";
const MARK = "Added by aura-twitch-favorites-setup.cjs";
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "release", ".git", ".vite", "coverage", "tests", "supabase"]);

const rel = (p) => path.relative(ROOT, p) || p;
const say = (line = "") => console.log(line);
function stop(lines) {
  say();
  say("Nothing was changed.");
  (Array.isArray(lines) ? lines : [lines]).forEach((l) => say("  " + l));
  say();
  process.exit(1);
}
function readText(file) {
  const raw = fs.readFileSync(file, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n"; // keep Windows line endings as they are
  return { text: raw.replace(/\r\n/g, "\n"), eol };
}
const withEol = (text, eol) => (eol === "\n" ? text : text.replace(/\n/g, eol));
function* walk(dir, depth = 0) {
  if (depth > 7) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) yield* walk(full, depth + 1);
    } else if (/\.(jsx?|tsx?|cjs|mjs)$/.test(entry.name) && !/^aura-[\w-]+\.cjs$/.test(entry.name)) {
      try { if (fs.statSync(full).size < 3 * 1024 * 1024) yield full; } catch {}
    }
  }
}
// Finds one file. A project can have several that look alike, so `prefer` is a list of tie-breakers.
function findOne(label, test, hint, prefer = []) {
  let hits = [];
  for (const file of walk(ROOT)) {
    let text = "";
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    if (test(text)) hits.push({ file, text });
  }
  if (!hits.length) stop(["I couldn't find " + label + ".", hint, "Copy this message to Claude."]);
  for (const rule of prefer) {
    if (hits.length === 1) break;
    const kept = hits.filter((h) => rule(h));
    if (kept.length) hits = kept;
  }
  if (hits.length === 1) return hits[0].file;
  stop(["I found more than one file that looks like " + label + ":", ...hits.map((h) => "  " + rel(h.file)), "Copy this message to Claude."]);
}
const sameFile = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const indentOf = (line) => line.match(/^\s*/)[0];
const findLine = (lines, re, from = 0, to = lines.length) => { for (let i = from; i < to; i++) if (re.test(lines[i])) return i; return -1; };

function swapOnce(text, find, replace, what) {
  const i = text.indexOf(find);
  if (i < 0 || text.indexOf(find, i + 1) >= 0) throw new Error(what);
  return text.slice(0, i) + replace + text.slice(i + find.length);
}

function swapIn(text, from, to, find, replace, what) {
  if (from < 0 || to <= from) throw new Error(what);
  return text.slice(0, from) + swapOnce(text.slice(from, to), find, replace, what) + text.slice(to);
}
const region = (t, start, end) => { const a = t.indexOf(start); const b = a < 0 ? -1 : t.indexOf(end, a + 1); return [a, b]; };



// ── App.jsx ──────────────────────────────────────────────────────────────────
function editApp(text) {
  if (text.includes("<FavoritesRow")) return { text, notes: [] };
  let t = text;

  // The import
  const imp = /^import \{ useCloudGames, useCloudProfile \} from "\.\/cloudsync";\n/m;
  if (!imp.test(t)) throw new Error('the imports at the top ( import { useCloudGames, useCloudProfile } from "./cloudsync"; )');
  t = t.replace(imp, (m) => m + 'import { FavStar, FavEditor, cleanFavs, toggleFav, isFav, loginOf, migrateFavs, liveFor, useFavLive, useFavWatch, renameFavs, favLiveStream, refreshFavLive } from "./components/twitchfavs"; // Twitch favorites\n');

  // Settings: the list and the live-notice switch, and the old "+ Streamers" names become favorites
  t = swapOnce(t, "  streamVolume: 0.8,      // 0 – 1, streams and trailers\n",
    "  streamVolume: 0.8,      // 0 – 1, streams and trailers\n" +
    "  twitchFavs: null,       // your favorite streamers [{ login, name, pic }] (" + MARK + ")\n" +
    "  twitchLiveAlerts: true, // a notice when a favorite goes live\n",
    "AURA's settings ( streamVolume: 0.8, ... streams and trailers )");
  t = swapOnce(t, "let SETTINGS = loadSettings();\n",
    "let SETTINGS = loadSettings();\n" +
    "// Streamers typed into \"+ Streamers\" before favorites existed become favorites (" + MARK + ")\n" +
    "if (!Array.isArray(SETTINGS.twitchFavs)) {\n" +
    "  let typed = \"\";\n" +
    "  try { typed = localStorage.getItem(\"aura_twitch_logins\") || \"\"; } catch {}\n" +
    "  SETTINGS = { ...SETTINGS, twitchFavs: migrateFavs(typed) };\n" +
    "  try { localStorage.setItem(\"aura_settings\", JSON.stringify(SETTINGS)); } catch {}\n" +
    "}\n",
    "where settings load ( let SETTINGS = loadSettings(); )");

  // The star on every card
  t = swapOnce(t,
    '  const watching = s.viewers > 0 ? watchingCount(s.viewers) + " watching" : "";\n',
    '  const watching = s.viewers > 0 ? watchingCount(s.viewers) + " watching" : "";\n' +
    "  const favs = useSettings().twitchFavs; // the star (" + MARK + ")\n" +
    "  const canStar = !!loginOf(s), starred = isFav(favs, s);\n",
    'the stream card ( const watching = s.viewers > 0 ? ... " watching" : ""; )');
  t = swapOnce(t,
    '      <div className="twitch-sheen"/>\n',
    '      <div className="twitch-sheen"/>\n' +
    "      {canStar && <FavStar on={starred} name={s.user} onToggle={()=>updateSettings({ twitchFavs: toggleFav(SETTINGS.twitchFavs, s) })}/>}\n",
    'the stream card ( <div className="twitch-sheen"/> )');
  // Live Streams says how long a favorite has been live, when Twitch says
  t = swapOnce(t,
    '{detail ? [s.title ? s.game : "", watching].filter(Boolean).join("  ·  ") : watching || s.title}',
    '{detail ? [s.title ? s.game : "", watching, s.liveFor].filter(Boolean).join("  ·  ") : watching || s.title}',
    "the stream card's details line ( {detail ? [s.title ? s.game : \"\", watching]... } )");

  // The Favorites row, right after StreamWall
  t = swapOnce(t, "function TwitchShelf({ games, onStreamClick }) {\n",
    [
      "// ── Twitch favorites on Live Streams (" + MARK + ") ──",
      "// Live favorites first (most watched first), then the rest greyed out as Offline.",
      "function FavoritesRow({ onWatch }) {",
      "  const st = useSettings();",
      "  const favs = cleanFavs(st.twitchFavs);",
      "  const { live, checked } = useFavLive();",
      "  if (!favs.length) return (",
      '    <div className="fav-empty">',
      '      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>',
      "      Star a streamer to keep them here. AURA tells you when they go live.",
      "    </div>",
      "  );",
      "  const items = favs.map(f => {",
      "    const s = live.get(f.login);",
      '    if (s) return { ...s, id: "fav-" + f.login, userLogin: f.login, pic: f.pic, liveFor: liveFor(s.startedAt || s.started_at) };',
      '    return { id: "fav-" + f.login, user: f.name, userLogin: f.login, title: "", game: "", viewers: 0, thumbnail: f.pic || "", pic: f.pic, url: "https://twitch.tv/" + f.login, offline: true };',
      "  });",
      "  items.sort((a, b) => (a.offline ? 1 : 0) - (b.offline ? 1 : 0) || (b.viewers || 0) - (a.viewers || 0));",
      "  const n = items.filter(x => !x.offline).length;",
      "  return (",
      '    <section className="fav-row" aria-label="Your favorite streamers">',
      '      <div className="fav-hdr">',
      '        <h2 className="fav-title">FAVORITES</h2>',
      '        <span className="fav-count">{!checked ? "Checking who\'s live…" : n ? n + " live now" : "No one live right now"}</span>',
      '        <label className="fav-alerts"><input type="checkbox" checked={st.twitchLiveAlerts !== false} onChange={e=>updateSettings({ twitchLiveAlerts: e.target.checked })}/>Tell me when they go live</label>',
      "      </div>",
      "      <StreamWall streams={items} onWatch={onWatch}/>",
      "    </section>",
      "  );",
      "}",
      "",
      "function TwitchShelf({ games, onStreamClick }) {",
      "",
    ].join("\n"),
    "the Home streams row ( function TwitchShelf({ games, onStreamClick }) )");

  // Home: the streams row uses your favorites, and "+ Streamers" adds and removes them
  {
    const [a, b] = region(t, "function TwitchShelf(", "\nfunction ");
    const oldLogins = '  const [customLogins, setCustomLogins] = useState(() => localStorage.getItem("aura_twitch_logins") || "");\n';
    t = swapIn(t, a, b, oldLogins,
      "  const favList = cleanFavs(useSettings().twitchFavs); // your favorites (" + MARK + ")\n" +
      '  const customLogins = favList.map(f => f.login).join(",");\n',
      'the Home streams row ( const [customLogins, setCustomLogins] = useState(...aura_twitch_logins...) )');
    const [a2, b2] = region(t, "function TwitchShelf(", "\nfunction ");
    const part = t.slice(a2, b2);
    const box = /\n(\s*)\{showInput&&\(\n[\s\S]*?aura_twitch_logins[\s\S]*?\n\s*\)\}\n/.exec(part);
    if (!box) throw new Error('the "+ Streamers" box on Home ( {showInput&&( ... aura_twitch_logins ... )} )');
    const swapped = part.slice(0, box.index) + "\n" + box[1] + "{showInput&&<FavEditor favs={favList} onChange={list=>updateSettings({ twitchFavs: list })}/>}\n" + part.slice(box.index + box[0].length);
    t = t.slice(0, a2) + swapped + t.slice(b2);
    // Favorites first in the row
    const [a3, b3] = region(t, "function TwitchShelf(", "\nfunction ");
    t = swapIn(t, a3, b3, "      if (res.success) setStreams(res.streams);\n",
      "      if (res.success) { const mine = new Set(userLogins); setStreams([...res.streams].sort((x, y) => (mine.has(loginOf(y)) ? 1 : 0) - (mine.has(loginOf(x)) ? 1 : 0))); }\n",
      "the Home streams row ( if (res.success) setStreams(res.streams); )");
    const [a4, b4] = region(t, "function TwitchShelf(", "\nfunction ");
    const label = '{showInput?"Done":"+ Streamers"}';
    if (t.slice(a4, b4).includes(label)) t = swapIn(t, a4, b4, label, '{showInput?"Done":"★ Favorites"}', "the + Streamers button");
  }

  // Live Streams: the Favorites row on top, and they aren't shown twice
  {
    const [a, b] = region(t, "function StreamsView(", "\nfunction ");
    t = swapIn(t, a, b,
      '  const [customLogins, setCustomLogins] = useState(() => localStorage.getItem("aura_twitch_logins") || "");\n',
      '  const customLogins = ""; // favorites have their own row now (' + MARK + ")\n" +
      "  const favSet = new Set(cleanFavs(useSettings().twitchFavs).map(f => f.login));\n",
      'the Live Streams page ( const [customLogins, setCustomLogins] = useState(...aura_twitch_logins...) )');
    const [a2, b2] = region(t, "function StreamsView(", "\nfunction ");
    t = swapIn(t, a2, b2,
      "offline:!c.isLive}))} onWatch={updateStream}/>",
      "offline:!c.isLive,pic:c.thumbnail}))} onWatch={updateStream}/>",
      "the channels a search finds ( offline:!c.isLive})) )");
    const [a3, b3] = region(t, "function StreamsView(", "\nfunction ");
    t = swapIn(t, a3, b3,
      "(fetchStreams(),setSearchResults(null))",
      "(fetchStreams(),refreshFavLive(),setSearchResults(null))",
      "the refresh button ( fetchStreams(),setSearchResults(null) )");
    const [a4, b4] = region(t, "function StreamsView(", "\nfunction ");
    const part = t.slice(a4, b4);
    const load = /\n(\s*)\{loading \? \(\n\s*<div[^\n]*>Loading streams…<\/div>/.exec(part);
    if (!load) throw new Error("the Live Streams list ( {loading ? ( ... Loading streams… ) )");
    let p = part.slice(0, load.index) + "\n" + load[1] + "<FavoritesRow onWatch={updateStream}/>" + part.slice(load.index);
    const wallAt = p.lastIndexOf("<StreamWall streams={streams} onWatch={updateStream}/>");
    if (wallAt < 0) throw new Error("the Live Streams list ( <StreamWall streams={streams} onWatch={updateStream}/> )");
    p = p.slice(0, wallAt) + "<StreamWall streams={streams.filter(s => !favSet.has(loginOf(s)))} onWatch={updateStream}/>" + p.slice(wallAt + "<StreamWall streams={streams} onWatch={updateStream}/>".length);
    p = p.replace("Add streamer names above or launch AURA with your game library", "Search for a streamer above and star them, or add games to your library");
    t = t.slice(0, a4) + p + t.slice(b4);
  }

  // The main window watches favorites and gives the notice
  const cloud = /^(\s*)useCloudProfile\(\{[^\n]*\}\);\n/m;
  const cm = cloud.exec(t);
  if (!cm) throw new Error("where account sync starts ( useCloudProfile({ ... }); )");
  const ind = cm[1];
  const watch = [
    "// Twitch favorites: a notice when one goes live (" + MARK + ")",
    "// In front: a notice inside AURA. Hidden or behind other windows: a Windows notification.",
    "useFavWatch({ favs: settings.twitchFavs, alerts: settings.twitchLiveAlerts !== false, onLive: (s) => {",
    "  const front = document.visibilityState === \"visible\" && document.hasFocus();",
    "  if (front) toast(s.user + \" is live on Twitch\" + (s.game ? \": \" + s.game : \"\"));",
    "  else window.electronAPI?.twitchLiveNotice?.({ login: loginOf(s), name: s.user, game: s.game, title: s.title });",
    "}, onSeen: (found) => { const next = renameFavs(SETTINGS.twitchFavs, found); if (next) updateSettings({ twitchFavs: next }); } });",
    "// Clicking that Windows notification opens the stream",
    "useEffect(() => {",
    "  const off = window.electronAPI?.onTwitchOpenStream?.((login) => {",
    "    if (typeof login !== \"string\" || !/^[a-z0-9_]{1,25}$/.test(login)) return;",
    "    const s = favLiveStream(login) || { id: \"fav-\" + login, user: login, userLogin: login, title: \"\", game: \"\", viewers: 0, url: \"https://twitch.tv/\" + login };",
    "    setActiveStream(s); setView(\"streams\"); setHeroGame(null); setSrch(\"\");",
    "  });",
    "  return () => { if (typeof off === \"function\") off(); };",
    "}, []);",
  ].map((l) => ind + l).join("\n") + "\n";
  t = t.slice(0, cm.index + cm[0].length) + watch + t.slice(cm.index + cm[0].length);

  return { text: t, notes: [
    "a star on every stream card: click it to add or remove a favorite",
    "Live Streams: your Favorites on top, live ones first, offline ones greyed",
    "a notice when a favorite goes live (switch it off on Live Streams)",
    "Home: + Streamers is now ★ Favorites, and the names you typed there carry over",
  ] };
}

// ── cloudsync.js: favorites travel with your account ─────────────────────────
function editCloud(text) {
  if (text.includes("twitchFavs")) return { text, notes: [] };
  let t = text;
  const imp = /^import [^\n]*from "react";\n/m;
  if (!imp.test(t)) throw new Error('the imports at the top ( import ... from "react"; )');
  t = t.replace(imp, (m) => m + 'import { cleanFavs } from "./components/twitchfavs"; // ' + MARK + "\n");
  t = swapOnce(t,
    "    uiVolume: unit(s.uiVolume, 0.5), streamVolume: unit(s.streamVolume, 0.8),\n  };\n};\n",
    "    uiVolume: unit(s.uiVolume, 0.5), streamVolume: unit(s.streamVolume, 0.8),\n" +
    "    // Twitch favorites travel too. Left out when not known (an older AURA), so they're never emptied by mistake.\n" +
    "    ...(Array.isArray(s.twitchFavs) ? { twitchFavs: cleanFavs(s.twitchFavs) } : {}),\n" +
    "  };\n};\n",
    "the settings that sync ( uiVolume: unit(s.uiVolume, 0.5), streamVolume: ... )");
  t = swapOnce(t,
    "        takeSettings(isObj(mine.settings) ? mine.settings : SYNCED_SETTINGS);\n",
    "        // Someone else's favorites don't carry over to this account\n" +
    "        takeSettings({ twitchFavs: [], ...(isObj(mine.settings) ? mine.settings : SYNCED_SETTINGS) });\n",
    "where a different account signs in ( takeSettings(isObj(mine.settings) ? mine.settings : SYNCED_SETTINGS); )");
  return { text: t, notes: ["your favorites are saved to your account, so they follow you to another PC"] };
}

// ── main.js: the Windows notification ────────────────────────────────────────
function editMain(text) {
  if (text.includes('"twitch-live-notice"')) return { text, notes: [] };
  const anchor = 'ipcMain.handle("search-twitch",';
  const i = text.indexOf(anchor);
  if (i < 0 || text.indexOf(anchor, i + 1) >= 0) throw new Error('the Twitch search ( ipcMain.handle("search-twitch", ... ) )');
  const end = text.indexOf(";\n", i);
  if (end < 0) throw new Error('the end of the Twitch search ( ipcMain.handle("search-twitch", ... ); )');
  const block = [
    "",
    "// ── Twitch favorites: a Windows notification when one goes live (" + MARK + ") ──",
    "// Clicking it brings AURA back and opens that stream.",
    "const liveNotices = new Set(); // held on to, so a click still works a while later",
    'ipcMain.handle("twitch-live-notice", (_e, info = {}) => {',
    '  const login = String(info?.login || "").toLowerCase();',
    "  if (!/^[a-z0-9_]{1,25}$/.test(login) || !mainWin || mainWin.isDestroyed()) return { success: false };",
    '  const text = (v, n) => (typeof v === "string" ? v.replace(/\\s+/g, " ").trim().slice(0, n) : "");',
    "  const name = text(info?.name, 40) || login;",
    '  const body = [text(info?.game, 60), text(info?.title, 140)].filter(Boolean).join(": ") || "Click to watch in AURA.";',
    "  try {",
    '    const { Notification } = require("electron");',
    "    if (!Notification.isSupported()) return { success: false };",
    '    const n = new Notification({ title: name + " is live on Twitch", body });',
    "    liveNotices.add(n);",
    "    if (liveNotices.size > 10) liveNotices.delete(liveNotices.values().next().value);",
    '    n.on("click", () => {',
    "      liveNotices.delete(n);",
    "      if (!mainWin || mainWin.isDestroyed()) return;",
    "      if (mainWin.isMinimized()) mainWin.restore();",
    "      mainWin.show(); mainWin.focus();",
    '      mainWin.webContents.send("twitch-open-stream", login);',
    "    });",
    '    n.on("close", () => liveNotices.delete(n));',
    "    n.show();",
    "    return { success: true };",
    "  } catch { return { success: false }; }",
    "});",
  ].join("\n");
  const t = text.slice(0, end + 2) + block + "\n" + text.slice(end + 2);
  return { text: t, notes: ["a Windows notification when a favorite goes live while AURA is hidden"] };
}

// ── preload.js ───────────────────────────────────────────────────────────────
function editPreload(text) {
  if (text.includes("twitchLiveNotice")) return { text, notes: [] };
  const t = swapOnce(text,
    '  fetchTwitchStreams: (opts) => ipcRenderer.invoke("fetch-twitch-streams", opts),\n',
    '  fetchTwitchStreams: (opts) => ipcRenderer.invoke("fetch-twitch-streams", opts),\n' +
    "  // Twitch favorites (" + MARK + ")\n" +
    '  twitchLiveNotice:   (info) => ipcRenderer.invoke("twitch-live-notice", info),\n' +
    '  onTwitchOpenStream: (cb) => { const h = (_e, login) => cb(login); ipcRenderer.on("twitch-open-stream", h); return () => ipcRenderer.removeListener("twitch-open-stream", h); },\n',
    'the Twitch calls ( fetchTwitchStreams: (opts) => ipcRenderer.invoke("fetch-twitch-streams", opts), )');
  return { text: t, notes: ["the window can ask for the notification, and hear when it's clicked"] };
}

// ── AURA's checks (only when they are installed) ─────────────────────────────
function editRunner(text) {
  if (/twitch-favorites\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  let at = -1;
  for (let i = 0; i < lines.length; i++) if (/add\("window",/.test(lines[i])) at = i;
  if (at < 0) return { text, notes: ["(couldn't find where to add the favorites check, so npm test doesn't include it)"] };
  lines.splice(at + 1, 0, 'if (fs.existsSync(path.join(__dirname, "twitch-favorites.cjs"))) add("window", "Twitch favorites and live notices", "twitch-favorites.cjs");');
  return { text: lines.join("\n"), notes: ["npm test now checks Twitch favorites too"] };
}

// Does `node` accept the file? Catches a bad edit before anything is written.
function syntaxProblem(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-check-"));
  const file = path.join(dir, "check.cjs");
  try {
    fs.writeFileSync(file, text);
    const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    return r.status === 0 ? "" : String(r.stderr || "syntax error").split("\n").filter(Boolean).slice(0, 4).join(" | ");
  } catch { return ""; } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
}

// ── Undo ──────────────────────────────────────────────────────────────────────
function undo() {
  let restored = 0;
  const visit = (dir, depth = 0) => {
    if (depth > 7) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if ((!SKIP_DIRS.has(entry.name) || entry.name === "tests") && !entry.name.startsWith(".")) visit(full, depth + 1);
      } else if (entry.name.endsWith(BAK)) {
        const target = full.slice(0, -BAK.length);
        fs.copyFileSync(full, target); fs.unlinkSync(full);
        say("  restored  " + rel(target)); restored++;
      } else if (entry.name === "twitchfavs.jsx" || entry.name === "twitch-favorites.cjs") {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. Live Streams is back to how it was." : "Nothing to undo.");
  say();
}

// ── Run ───────────────────────────────────────────────────────────────────────
function run() {
  const pkgFile = path.join(ROOT, "package.json");
  if (!fs.existsSync(pkgFile)) stop(["This isn't your AURA project folder (no package.json here).", "Move this file next to package.json and run it from there."]);
  if (UNDO) return undo();

  const need = "Make sure this file is in your AURA project folder, next to package.json.";
  let pkgMain = "";
  try { pkgMain = String(JSON.parse(fs.readFileSync(pkgFile, "utf8")).main || ""); } catch {}
  const startFile = pkgMain ? path.resolve(ROOT, pkgMain) : "";
  const comp = (h) => /[\\/]components[\\/]/.test(h.file);
  const files = {
    main: findOne("your main file", (t) => /ipcMain\.handle\("search-twitch",/.test(t), need, [
      (h) => startFile && sameFile(h.file, startFile),
      (h) => /function createWindow\s*\(/.test(h.text),
    ]),
    preload: findOne("your preload file", (t) => /fetchTwitchStreams:\s*\(opts\)/.test(t) && /contextBridge/.test(t), need, [
      (h) => /^preload\.[cm]?js$/.test(path.basename(h.file)),
    ]),
    cloud: findOne("your account sync file (cloudsync.js)", (t) => /export function useCloudProfile\s*\(/.test(t), need, [
      (h) => /^cloudsync\.[jt]sx?$/.test(path.basename(h.file)),
    ]),
    app: findOne("your App file", (t) => /function AuraApp\s*\(/.test(t) && /<AuraApp\b/.test(t), need, [
      (h) => /^App\.[jt]sx?$/.test(path.basename(h.file)),
    ]),
  };

  const plan = [];
  const problems = [];
  if (!sameFile(path.dirname(files.cloud), path.dirname(files.app))) problems.push(rel(files.app) + " and " + rel(files.cloud) + " are in different folders, which I didn't expect.");
  const consider = (label, file, edit, checkSyntax) => {
    const { text, eol } = readText(file);
    try {
      const result = edit(text);
      if (checkSyntax && result.text !== text) { const bad = syntaxProblem(result.text); if (bad) throw new Error("a way to edit it safely (" + bad + ")"); }
      plan.push({ label, file, before: text, after: result.text, eol, notes: result.notes });
    } catch (e) { problems.push("In " + rel(file) + " I couldn't find " + e.message + "."); }
  };
  consider("App file", files.app, editApp, false);
  consider("sync", files.cloud, editCloud, false);
  consider("main file", files.main, editMain, true);
  consider("preload", files.preload, editPreload, true);
  const runner = path.join(ROOT, "tests", "run.cjs");
  const hasChecks = fs.existsSync(runner);
  if (hasChecks) consider("checks", runner, editRunner, true);

  const created = [{ label: "favorites", file: path.join(path.dirname(files.app), "components", "twitchfavs.jsx"), content: FILES.favs }];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "twitch-favorites.cjs"), content: FILES.test });
  for (const c of created) {
    c.note = "created";
    if (fs.existsSync(c.file)) {
      const existing = readText(c.file).text;
      if (!existing.includes(MARK)) problems.push(rel(c.file) + " already exists and wasn't made by this script, so I left it alone.");
      else c.note = existing === c.content ? "already done" : "updated";
    }
  }
  if (problems.length) stop([...problems, "Copy this message to Claude."]);

  say();
  say(DRY ? "Dry run. This is what would change:" : "AURA: Twitch favorites");
  say();
  for (const step of plan) {
    if (step.after !== step.before && !DRY) {
      const bak = step.file + BAK;
      if (!fs.existsSync(bak)) fs.copyFileSync(step.file, bak);
      fs.writeFileSync(step.file, withEol(step.after, step.eol));
    }
    say("  " + (step.label + ":").padEnd(13) + rel(step.file));
    (step.notes.length ? step.notes : ["already done"]).forEach((n) => say("               - " + n));
  }
  for (const c of created) {
    if (c.note !== "already done" && !DRY) { fs.mkdirSync(path.dirname(c.file), { recursive: true }); fs.writeFileSync(c.file, c.content); }
    say("  " + (c.label + ":").padEnd(13) + rel(c.file));
    say("               - " + c.note);
  }
  say();
  if (DRY) { say("Run it again without --dry-run to apply."); say(); return; }
  say("Done. Restart AURA (stop it in the terminal and start it again), then open Live Streams and star a streamer.");
  if (hasChecks) say("Run  npm test  before your next release.");
  say("To undo later:  node aura-twitch-favorites-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
