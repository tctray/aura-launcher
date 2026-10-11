#!/usr/bin/env node
/**
 * AURA — the "Live on Twitch" row on Home: glass cards that open when you point at them
 *
 *   - Each stream rests as a narrow pane of glass, with the picture showing faintly through it.
 *   - Point at one (or reach it with Tab or a controller) and it opens out to the full picture,
 *     with a LIVE tag, the streamer, the game, how many are watching, and two buttons:
 *       the white play button   watch it on the Live Streams page
 *       the smaller button      open it straight into full view
 *     Clicking anywhere else on the card also watches it.
 *   - The purple is gone from the row (the LIVE tag, the outline, the game name, the button).
 *     The LIVE tag is a red dot on dark glass, and it only shows on the card that is open.
 *   - Picking a stream on Home now opens that stream. (Before, it only opened the Live Streams
 *     page. If you have already run aura-twitch-discord-setup.cjs, that part is already done.)
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-twitch-row-setup.cjs
 *   4. Then:  npm test
 *
 * What it does:
 *   - edits    src/App.jsx              the row, its styles, and "open in full view"
 *   - creates  tests/twitch-row.cjs     (only if AURA's checks are installed) checks it
 *   - edits    tests/run.cjs            (same) so npm test runs it
 *
 * Every file it changes is copied to <name>.before-twitch-row.bak first.
 * To put everything back:                 node aura-twitch-row-setup.cjs --undo
 * To preview without changing anything:   node aura-twitch-row-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const EDITS = [{"kind":"cut","file":"app","label":"Live on Twitch: glass cards that open when you point at them, with LIVE and two buttons; no purple","from":".twitch-row{display:flex;gap:14px;padding:4px 40px 12px;overflow-x:auto;scrollbar-width:none;}","to":".twitch-empty{","done":".twitch-card.on,.twitch-card.ctrl-focus{","maxLines":24,"text":".twitch-row{display:flex;gap:12px;padding:6px 40px 14px;overflow-x:auto;scrollbar-width:none;}\n.twitch-row::-webkit-scrollbar{display:none;}\n/* A stream rests as a narrow pane of glass, its picture showing faintly through. The one you\n   point at (or reach with Tab or a controller) opens out to the full picture, with the LIVE tag\n   and the buttons. Added by aura-twitch-row-setup.cjs. */\n.twitch-card{flex-shrink:0;position:relative;width:150px;height:220px;text-align:left;border-radius:16px;overflow:hidden;cursor:pointer;outline:none;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);box-shadow:inset 0 1px 0 rgba(255,255,255,.18),0 10px 28px rgba(0,0,0,.28);backdrop-filter:blur(18px) saturate(1.3);transition:width .34s cubic-bezier(.2,.8,.2,1),border-color .2s,box-shadow .2s;}\n.twitch-thumb{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;opacity:.38;filter:saturate(.6);transition:opacity .25s,filter .25s;}\n.twitch-thumb-ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:38px;opacity:.5;}\n.twitch-sheen{position:absolute;inset:0;background:linear-gradient(155deg,rgba(255,255,255,.2) 0%,rgba(255,255,255,.04) 34%,rgba(255,255,255,0) 60%);pointer-events:none;transition:opacity .25s;}\n.twitch-rest{position:absolute;left:12px;right:12px;bottom:12px;font-family:'Rajdhani',sans-serif;font-size:14px;font-weight:700;letter-spacing:.3px;color:rgba(255,255,255,.86);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 6px rgba(0,0,0,.6);transition:opacity .15s;}\n.twitch-card.on,.twitch-card.ctrl-focus{width:392px;border-color:rgba(255,255,255,.42);box-shadow:0 18px 44px rgba(0,0,0,.55);backdrop-filter:none;}\n.twitch-card.on .twitch-thumb,.twitch-card.ctrl-focus .twitch-thumb{opacity:1;filter:none;}\n.twitch-card.on .twitch-sheen,.twitch-card.on .twitch-rest,.twitch-card.ctrl-focus .twitch-sheen,.twitch-card.ctrl-focus .twitch-rest{opacity:0;}\n.twitch-card:focus-visible{border-color:#fff;box-shadow:0 0 0 2px rgba(255,255,255,.7);}\n.twitch-badge{position:absolute;top:12px;left:12px;display:flex;align-items:center;gap:6px;padding:4px 10px 4px 8px;border-radius:20px;background:rgba(0,0,0,.62);border:1px solid rgba(255,255,255,.18);color:#fff;font-size:10px;font-weight:800;letter-spacing:1.4px;opacity:0;transition:opacity .2s;z-index:2;}\n.twitch-badge-dot{width:7px;height:7px;border-radius:50%;background:#eb0400;box-shadow:0 0 6px #eb0400;}\n.twitch-ov{position:absolute;inset:0;display:flex;align-items:flex-end;gap:12px;padding:14px;background:linear-gradient(to top,rgba(0,0,0,.88) 0%,rgba(0,0,0,.35) 42%,rgba(0,0,0,0) 68%);opacity:0;pointer-events:none;transition:opacity .2s;z-index:3;}\n.twitch-card.on .twitch-badge,.twitch-card.on .twitch-ov,.twitch-card.ctrl-focus .twitch-badge,.twitch-card.ctrl-focus .twitch-ov{opacity:1;}\n.twitch-card.on .twitch-ov,.twitch-card.ctrl-focus .twitch-ov{pointer-events:auto;transition-delay:.08s;}\n.twitch-info{flex:1;min-width:0;}\n.twitch-user{font-family:'Rajdhani',sans-serif;font-size:19px;font-weight:700;color:#fff;letter-spacing:.3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n.twitch-game{font-size:11px;color:rgba(255,255,255,.78);font-weight:600;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n.twitch-viewers-row{font-size:11px;color:rgba(255,255,255,.62);font-weight:600;margin-top:2px;}\n.twitch-tools{display:flex;align-items:center;gap:8px;flex-shrink:0;}\n.twitch-tool{display:grid;place-items:center;width:36px;height:36px;padding:0;border-radius:50%;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.12);color:#fff;cursor:pointer;backdrop-filter:blur(8px);transition:background .15s,transform .15s;}\n.twitch-tool:hover{background:rgba(255,255,255,.26);}\n.twitch-tool.main{width:44px;height:44px;border:none;background:#fff;color:#0b0b0d;}\n.twitch-tool.main:hover{background:#fff;transform:scale(1.06);}\n.twitch-tool:focus-visible{outline:2px solid #fff;outline-offset:2px;}\n.reduce-motion .twitch-card,.reduce-motion .twitch-thumb,.reduce-motion .twitch-tool{transition:none!important;}\n.no-blur .twitch-card{background:rgba(24,26,32,.7);}\n"},{"kind":"insert","file":"app","label":"Live on Twitch: glass cards that open when you point at them, with LIVE and two buttons; no purple","after":"const [showInput, setShowInput] = useState(false);","done":"const [lit, setLit] = useState(null);","text":"  const [lit, setLit] = useState(null); // the stream you are pointing at: its card is open\n"},{"kind":"replace","file":"app","label":"Live on Twitch: glass cards that open when you point at them, with LIVE and two buttons; no purple","done":"<div className=\"twitch-row\" ref={rowRef} onMouseLeave=","before":"<div className=\"twitch-row\" ref={rowRef}>","text":"<div className=\"twitch-row\" ref={rowRef} onMouseLeave={()=>setLit(null)} onBlur={e=>{ if(!e.currentTarget.contains(e.relatedTarget)) setLit(null); }}>"},{"kind":"re","file":"app","label":"Live on Twitch: glass cards that open when you point at them, with LIVE and two buttons; no purple","re":"^[ \\t]*\\{streams\\.map\\(s => \\(\\n[ \\t]*<div key=\\{s\\.id\\} className=\"twitch-card\" onClick=[^\\n]*\\n(?:[^\\n]*\\n){1,12}?[ \\t]*\\)\\)\\}\\n","done":"className={\"twitch-card\" + (on ? \" on\" : \"\")}","text":"              {streams.map(s => {\n                const on = lit === s.id;\n                const watch = (how) => onStreamClick && onStreamClick(s, how);\n                return (\n                  <div key={s.id} className={\"twitch-card\" + (on ? \" on\" : \"\")} role=\"button\" tabIndex={0}\n                    aria-label={\"Watch \" + s.user + (s.game ? \", playing \" + s.game : \"\")}\n                    onMouseEnter={()=>setLit(s.id)} onFocus={()=>setLit(s.id)} onClick={()=>watch()}\n                    onKeyDown={e=>{ if(e.target===e.currentTarget&&(e.key===\"Enter\"||e.key===\" \")){ e.preventDefault(); watch(); } }}>\n                    {s.thumbnail ? <img src={s.thumbnail} alt=\"\" className=\"twitch-thumb\" draggable={false}/> : <div className=\"twitch-thumb-ph\">📺</div>}\n                    <div className=\"twitch-sheen\"/>\n                    <div className=\"twitch-rest\">{s.user}</div>\n                    <div className=\"twitch-badge\"><div className=\"twitch-badge-dot\"/>LIVE</div>\n                    <div className=\"twitch-ov\">\n                      <div className=\"twitch-info\">\n                        <div className=\"twitch-user\">{s.user}</div>\n                        <div className=\"twitch-game\">{s.game}</div>\n                        <div className=\"twitch-viewers-row\">{fmtViewers(s.viewers)} watching</div>\n                      </div>\n                      <div className=\"twitch-tools\">\n                        <button type=\"button\" className=\"twitch-tool\" tabIndex={on?0:-1} title=\"Open in full view\" aria-label={\"Open \" + s.user + \" in full view\"} onClick={e=>{e.stopPropagation();watch({full:true});}}>\n                          <svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"2.2\" strokeLinecap=\"round\" strokeLinejoin=\"round\" aria-hidden=\"true\"><path d=\"M15 4h5v5\"/><path d=\"M9 20H4v-5\"/><path d=\"M20 4l-6 6\"/><path d=\"M4 20l6-6\"/></svg>\n                        </button>\n                        <button type=\"button\" className=\"twitch-tool main\" tabIndex={on?0:-1} title=\"Watch\" aria-label={\"Watch \" + s.user} onClick={e=>{e.stopPropagation();watch();}}>\n                          <svg viewBox=\"0 0 24 24\" width=\"18\" height=\"18\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M8 5.2v13.6a.6.6 0 0 0 .92.5l10.6-6.8a.6.6 0 0 0 0-1L8.92 4.7A.6.6 0 0 0 8 5.2z\"/></svg>\n                        </button>\n                      </div>\n                    </div>\n                  </div>\n                );\n              })}\n"},{"kind":"insert","file":"app","label":"a stream picked on Home opens on Live Streams (it used to open only the page)","after":"const [activeStream, setActiveStream] = useState(initialStream||null);","done":"useEffect(() => { setActiveStream(initialStream || null); }, [initialStream]);","text":"  // Keep in step with the rest of AURA: a stream picked on Home opens here, and closing the\n  // mini-player closes it here too (which is what shuts the Twitch player down).\n  useEffect(() => { setActiveStream(initialStream || null); }, [initialStream]);\n"},{"kind":"replace","file":"app","label":"\"Open in full view\" on Home opens the stream filling the window","done":"function StreamsView({ games, initialStream, openFull, onClear, onStreamChange }) {","before":"function StreamsView({ games, initialStream, onClear, onStreamChange }) {","text":"function StreamsView({ games, initialStream, openFull, onClear, onStreamChange }) {"},{"kind":"insert","file":"app","label":"\"Open in full view\" on Home opens the stream filling the window","after":"useEffect(() => () => { fullRef.current = false; }, []);","done":"const fullAsked = useRef(0);","text":"  // \"Open in full view\" on Home: once the player and chat have had time to open, fill the window.\n  // Each ask is used once, so picking another stream later doesn't go full by itself.\n  const fullAsked = useRef(0);\n  useEffect(() => {\n    if (!openFull || openFull === fullAsked.current || !activeStream || !window.electronAPI?.isElectron) return;\n    const timer = setTimeout(() => { fullAsked.current = openFull; if (!fullRef.current) setFull(true); }, 1300);\n    return () => clearTimeout(timer);\n  }, [openFull, activeStream]);\n"},{"kind":"insert","file":"app","label":"\"Open in full view\" on Home opens the stream filling the window","after":"const [activeStream, setActiveStream] = useState(null);","done":"const [streamFullAsk, setStreamFullAsk] = useState(0);","text":"  const [streamFullAsk, setStreamFullAsk] = useState(0); // changes each time \"Open in full view\" is picked on Home\n"},{"kind":"replace","file":"app","label":"\"Open in full view\" on Home opens the stream filling the window","done":"<TwitchShelf games={games} onStreamClick={(s,how)=>","before":"<TwitchShelf games={games} onStreamClick={s=>{setActiveStream(s);goTo(\"streams\");}}/>","text":"<TwitchShelf games={games} onStreamClick={(s,how)=>{setActiveStream(s);if(how?.full)setStreamFullAsk(Date.now());goTo(\"streams\");}}/>"},{"kind":"replace","file":"app","label":"\"Open in full view\" on Home opens the stream filling the window","done":"<StreamsView games={games} initialStream={activeStream} openFull={streamFullAsk}","before":"<StreamsView games={games} initialStream={activeStream}","text":"<StreamsView games={games} initialStream={activeStream} openFull={streamFullAsk}"},{"kind":"insert","file":"runner","label":"npm test now checks the row","after":"add(\"window\", \"The window opens and every page loads\", \"window.cjs\");","done":"twitch-row.cjs","text":"if (fs.existsSync(path.join(__dirname, \"twitch-row.cjs\"))) add(\"window\", \"The Live on Twitch row on Home\", \"twitch-row.cjs\");\n"}];
const FILES = {"row":"// The \"Live on Twitch\" row on Home.\n//\n// Each stream rests as a narrow pane of glass. The one you point at opens out to the full\n// picture, with a LIVE tag and two buttons: watch, and open in full view. This opens the built\n// window (dist) in a real browser with a pretend desktop side and some pretend streams, and checks:\n//   - at rest: narrow, see-through, picture dimmed, no LIVE tag\n//   - pointed at: wide, picture clear, LIVE tag and both buttons showing; only one card at a time\n//   - no purple or gold anywhere in the row\n//   - the play button watches the stream; the other button opens it in full view\n//   - it works from the keyboard too\n// Added by aura-twitch-row-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\n\n(async () => {\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(process.env.CI ? 1 : 3); }\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch(options); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with. Run  npx playwright install chromium  once to add one.\"); return done(process.env.CI ? 1 : 3); }\n\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(DIST, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => {\n      if (err) { res.writeHead(404); return res.end(); }\n      res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" });\n      res.end(data);\n    });\n  });\n  await new Promise((r) => server.listen(0, \"127.0.0.1\", r));\n  const base = \"http://127.0.0.1:\" + server.address().port;\n\n  try {\n    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();\n    const thrown = [];\n    page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n    await page.route((url) => !String(url).startsWith(base) && !String(url).startsWith(\"data:\"), (route) => route.abort());\n    await page.addInitScript(() => {\n      try { localStorage.clear(); localStorage.setItem(\"aura_profile\", JSON.stringify({ username: \"tester\", avatar: \"\", userId: \"user-1\" })); } catch {}\n      window.__calls = [];\n      const ok = (data) => Promise.resolve({ success: true, data });\n      const account = { getSession: () => ok({ id: \"user-1\", email: \"me@example.com\" }), getMyProfile: () => ok({ username: \"tester\", avatar_url: null }), saveProfile: (name, picture) => ok({ username: name, avatar_url: picture || null }) };\n      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => (name === \"auraCloud\" && account[key]) ? account[key](...args) : ok(null)) });\n      window.auraCloud = fake(\"auraCloud\");\n      window.auraSocial = fake(\"auraSocial\");\n      const picture = (hue) => \"data:image/svg+xml,\" + encodeURIComponent(`<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"440\" height=\"248\"><rect width=\"440\" height=\"248\" fill=\"hsl(${hue},60%,45%)\"/><circle cx=\"220\" cy=\"124\" r=\"70\" fill=\"hsl(${hue + 40},70%,65%)\"/></svg>`);\n      const names = [\"Shroud\", \"Pokimane\", \"TimTheTatman\", \"Myth\", \"Nickmercs\", \"Summit1g\"];\n      const streams = names.map((user, i) => ({ id: \"s\" + (i + 1), user, userLogin: user.toLowerCase(), title: user + \" is live\", game: \"Game \" + (i + 1), viewers: 1200 * (i + 1), thumbnail: picture(i * 55), url: \"https://twitch.tv/\" + user.toLowerCase() }));\n      const desktop = {\n        fetchTwitchStreams: () => Promise.resolve({ success: true, streams }),\n        streamFullscreen: () => Promise.resolve({ success: true }),\n        streamExitFull: () => Promise.resolve({ success: true }),\n      };\n      window.electronAPI = new Proxy({}, {\n        get: (_t, key) => {\n          if (key === \"isElectron\") return true;\n          if (typeof key !== \"string\" || key === \"then\") return undefined;\n          if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};\n          return (...args) => { window.__calls.push([key, args]); return desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }); };\n        },\n      });\n    });\n    await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n    await page.waitForTimeout(4500);\n    const menu = async (name) => { await page.locator(`.gm-rail-item[title=\"${name}\"], .sb-item[title=\"${name}\"]`).first().click({ timeout: 5000 }); await page.waitForTimeout(500); };\n    const called = (name) => page.evaluate((n) => window.__calls.filter(([k]) => k === n).map(([, a]) => a[0]), name);\n    // How every card in the row looks right now\n    const look = () => page.evaluate(() => [...document.querySelectorAll(\".twitch-shelf .twitch-card\")].map((card) => {\n      const cs = getComputedStyle(card), show = (sel) => Number(getComputedStyle(card.querySelector(sel)).opacity);\n      return { name: card.querySelector(\".twitch-rest\").textContent, width: Math.round(card.getBoundingClientRect().width), height: Math.round(card.getBoundingClientRect().height),\n        background: cs.backgroundColor, blur: cs.backdropFilter, picture: show(\".twitch-thumb\"), live: show(\".twitch-badge\"), tools: show(\".twitch-ov\"), buttons: card.querySelectorAll(\".twitch-tool\").length };\n    }));\n    const alpha = (color) => { const m = /rgba?\\(([^)]+)\\)/.exec(color || \"\"); if (!m) return 1; const p = m[1].split(/[,/ ]+/).filter(Boolean); return p.length > 3 ? Number(p[3]) : 1; };\n    const card = (n) => page.locator(\".twitch-shelf .twitch-card\").nth(n);\n\n    await menu(\"Home\");\n    await page.locator(\".twitch-shelf .twitch-card\").first().waitFor({ timeout: 8000 });\n    await page.mouse.move(700, 20); // not pointing at the row\n    await page.waitForTimeout(500);\n\n    console.log(\"1. At rest: panes of glass\");\n    let cards = await look();\n    check(\"the row shows the streams\", cards.length === 6, cards.map((c) => c.name));\n    check(\"every card is narrow, and none is open\", cards.every((c) => c.width <= 160 && c.width >= 120), cards.map((c) => c.width));\n    check(\"the card is see-through glass (a faint tint with the background blurred behind it)\", cards.every((c) => alpha(c.background) > 0 && alpha(c.background) <= 0.2 && /blur\\(/.test(c.blur)), cards.slice(0, 1));\n    check(\"the picture shows only faintly through it\", cards.every((c) => c.picture > 0.1 && c.picture < 0.6), cards.map((c) => c.picture));\n    check(\"no LIVE tag and no buttons until you point at one\", cards.every((c) => c.live === 0 && c.tools === 0), cards.map((c) => [c.live, c.tools]));\n\n    console.log(\"2. Pointing at one\");\n    await card(1).hover();\n    await page.waitForTimeout(700);\n    cards = await look();\n    check(\"that card opens out wide\", cards[1].width >= 380 && cards[1].height === cards[0].height, cards.map((c) => c.width));\n    check(\"its picture is clear\", cards[1].picture === 1, cards[1].picture);\n    check(\"LIVE shows on it\", cards[1].live === 1 && (await card(1).locator(\".twitch-badge\").innerText()).trim() === \"LIVE\");\n    check(\"with the streamer, the game and how many are watching\", /Pokimane/.test(await card(1).locator(\".twitch-info\").innerText()) && /Game 2/.test(await card(1).locator(\".twitch-info\").innerText()) && /2\\.4K watching/.test(await card(1).locator(\".twitch-info\").innerText()), await card(1).locator(\".twitch-info\").innerText());\n    check(\"and two buttons: open in full view, and watch\", cards[1].tools === 1 && cards[1].buttons === 2 && (await card(1).locator('.twitch-tool[title=\"Open in full view\"]').isVisible()) && (await card(1).locator('.twitch-tool.main[title=\"Watch\"]').isVisible()));\n    check(\"the others stay as glass\", cards.filter((_c, i) => i !== 1).every((c) => c.width <= 160 && c.live === 0 && c.picture < 0.6), cards.map((c) => c.width));\n    await card(2).hover();\n    await page.waitForTimeout(700);\n    cards = await look();\n    check(\"pointing at the next one opens it and closes the first\", cards[2].width >= 380 && cards[2].live === 1 && cards[1].width <= 160 && cards[1].live === 0, cards.map((c) => c.width));\n    check(\"only one is open at a time\", cards.filter((c) => c.width > 200).length === 1, cards.map((c) => c.width));\n    await page.mouse.move(700, 20);\n    await page.waitForTimeout(700);\n    cards = await look();\n    check(\"moving away closes it again\", cards.every((c) => c.width <= 160 && c.live === 0), cards.map((c) => c.width));\n\n    console.log(\"3. No purple or gold\");\n    await card(0).hover();\n    await page.waitForTimeout(600);\n    const colours = await page.evaluate(() => {\n      const found = [];\n      const hueOf = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (d < 40 || mx < 60) return null; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = Math.round(h * 60); return h < 0 ? h + 360 : h; };\n      for (const el of document.querySelectorAll(\".twitch-shelf .twitch-row, .twitch-shelf .twitch-row *\")) {\n        if (el.tagName === \"IMG\") continue; // the stream's own picture can be any colour\n        const cs = getComputedStyle(el);\n        for (const prop of [\"color\", \"backgroundColor\", \"borderTopColor\", \"outlineColor\", \"backgroundImage\", \"boxShadow\", \"fill\", \"stroke\"]) {\n          for (const m of String(cs[prop] || \"\").matchAll(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/g)) {\n            if (m[4] !== undefined && Number(m[4]) === 0) continue;\n            const hue = hueOf(+m[1], +m[2], +m[3]);\n            if (hue === null) continue;\n            if (hue >= 240 && hue <= 320) found.push(\"purple \" + m[0] + \" on .\" + el.className + \" (\" + prop + \")\");\n            if (hue >= 35 && hue <= 65) found.push(\"gold \" + m[0] + \" on .\" + el.className + \" (\" + prop + \")\");\n          }\n        }\n      }\n      return [...new Set(found)];\n    });\n    check(\"nothing in the row is purple or gold (the LIVE dot is red; the rest is white, black and glass)\", colours.length === 0, colours.join(\"\\n\"));\n    const source = (() => { try { return fs.readFileSync(path.join(ROOT, \"src\", \"App.jsx\"), \"utf8\"); } catch { return \"\"; } })();\n    const rules = source.split(\"\\n\").filter((l) => /^\\.twitch-/.test(l)).join(\"\\n\");\n    const old = [\"#9147ff\", \"145,71,255\", \"#2d1b69\", \"gold\", \"#ffd700\", \"#fbbf24\", \"#f5c518\"].filter((c) => rules.toLowerCase().includes(c));\n    check(\"and none is left in its styles\", rules.length > 500 && old.length === 0, old);\n\n    console.log(\"4. The buttons\");\n    await card(1).hover();\n    await page.waitForTimeout(500);\n    await card(1).locator(\".twitch-tool.main\").click({ timeout: 4000 });\n    await page.waitForTimeout(2200);\n    let opened = await called(\"streamOpen\");\n    check(\"the play button opens that stream on Live Streams\", opened.length === 1 && opened[0].channel === \"pokimane\" && (await page.getByText(\"Hide Chat\").first().isVisible()), opened);\n    check(\"without going to full view\", (await called(\"streamFullscreen\")).length === 0 && (await page.locator(\".stream-full-bar\").count()) === 0);\n    await page.getByText(\"✕ Close\", { exact: true }).first().click({ timeout: 4000 });\n    await page.waitForTimeout(400);\n    await menu(\"Home\");\n    await card(3).hover();\n    await page.waitForTimeout(500);\n    await card(3).locator('.twitch-tool[title=\"Open in full view\"]').click({ timeout: 4000 });\n    await page.waitForTimeout(2600);\n    opened = await called(\"streamOpen\");\n    const order = await page.evaluate(() => window.__calls.map(([k]) => k).filter((k) => /^(streamOpen|chatOpen|streamFullscreen)$/.test(k)).slice(-3));\n    check(\"the other button opens the stream\", opened.length === 2 && opened[1].channel === \"myth\", opened);\n    check(\"and then fills the window with it, after the player and chat have opened\", (await called(\"streamFullscreen\")).length === 1 && order.join(\",\") === \"streamOpen,chatOpen,streamFullscreen\" && (await page.locator(\".stream-full-bar\").isVisible()), order);\n    await page.getByText(\"Exit full view\", { exact: true }).click({ timeout: 4000 });\n    await page.waitForTimeout(500);\n    await page.getByText(\"✕ Close\", { exact: true }).first().click({ timeout: 4000 });\n    await page.waitForTimeout(400);\n    // Picking a stream the ordinary way afterwards must not go full on its own\n    await page.getByText(\"Summit1g is live\").first().click({ timeout: 5000 });\n    await page.waitForTimeout(2400);\n    check(\"a stream picked afterwards opens normally, not in full view\", (await called(\"streamOpen\")).length === 3 && (await called(\"streamFullscreen\")).length === 1 && (await page.locator(\".stream-full-bar\").count()) === 0);\n    await page.getByText(\"✕ Close\", { exact: true }).first().click({ timeout: 4000 });\n    await page.waitForTimeout(400);\n\n    console.log(\"5. From the keyboard\");\n    await menu(\"Home\");\n    await page.mouse.move(700, 20);\n    await card(4).focus();\n    await page.waitForTimeout(700);\n    cards = await look();\n    check(\"a card you tab to opens the same way\", cards[4].width >= 380 && cards[4].live === 1 && cards.filter((c) => c.width > 200).length === 1, cards.map((c) => c.width));\n    await page.keyboard.press(\"Enter\");\n    await page.waitForTimeout(1500);\n    opened = await called(\"streamOpen\");\n    check(\"and Enter watches it\", opened.length === 4 && opened[3].channel === \"nickmercs\", opened);\n    check(\"nothing crashed along the way\", (await page.locator(\".aura-fallback\").count()) === 0, thrown);\n  } finally {\n    await browser.close();\n    server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The row check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-twitch-row.bak";
const MARK = "Added by aura-twitch-row-setup.cjs";
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "release", ".git", ".vite", "coverage"]);
const CREATED = ["twitch-row.cjs"];

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
const count = (text, piece) => (piece ? text.split(piece).length - 1 : 0);

// ── One edit ──────────────────────────────────────────────────────────────────
// Each returns the new text and whether it changed anything. If the place it is looking for
// isn't there, that is fine when the edit was already made (its "done" text is present) or when
// the edit only removes something that is already gone. Anything else is a problem.
function applyEdit(text, edit) {
  const already = () => {
    if (edit.done && text.includes(edit.done)) return { text, changed: false };
    if (edit.missingOk) return { text, changed: false };
    throw new Error(edit.kind === "cut" || edit.kind === "insert" ? "the line  " + (edit.from || edit.after || edit.aheadOf).trim() : "the part for: " + edit.label);
  };
  if (edit.done && text.includes(edit.done)) return { text, changed: false };

  if (edit.kind === "replace") {
    const n = count(text, edit.before);
    if (n === 0) return already();
    if (n > 1) throw new Error("exactly one of  " + edit.before.slice(0, 70) + "  (there are " + n + ")");
    return { text: text.replace(edit.before, () => edit.text), changed: true };
  }

  if (edit.kind === "re") {
    const re = new RegExp(edit.re, "m");
    if (!re.test(text)) return already();
    return { text: text.replace(re, () => edit.text), changed: true };
  }

  const lines = text.split("\n");
  if (edit.kind === "insert") {
    const anchor = edit.after || edit.aheadOf;
    const hits = lines.map((l, i) => (l.includes(anchor) ? i : -1)).filter((i) => i >= 0);
    if (!hits.length) return already();
    if (hits.length > 1) throw new Error("exactly one line with  " + anchor.trim() + "  (there are " + hits.length + ")");
    lines.splice(hits[0] + (edit.after ? 1 : 0), 0, ...edit.text.replace(/\n$/, "").split("\n"));
    return { text: lines.join("\n"), changed: true };
  }

  if (edit.kind === "cut") {
    const starts = lines.map((l, i) => (l.includes(edit.from) ? i : -1)).filter((i) => i >= 0);
    if (!starts.length) return already();
    if (starts.length > 1) throw new Error("exactly one line with  " + edit.from.trim() + "  (there are " + starts.length + ")");
    const a = starts[0];
    let b = -1;
    for (let i = a + 1; i < lines.length; i++) if (lines[i].includes(edit.to)) { b = i; break; }
    if (b < 0) throw new Error("the line  " + edit.to.trim() + "  after  " + edit.from.trim());
    if (edit.maxLines && b - a > edit.maxLines) throw new Error("the part from  " + edit.from.trim() + "  where I expected it (it is longer than it should be)");
    // Never remove more than was meant: only these handlers may be inside the part taken out
    if (edit.only) {
      const inside = lines.slice(a, b).join("\n");
      const others = [...inside.matchAll(/ipcMain\.(?:handle|on)\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]).filter((name) => !edit.only.includes(name));
      if (others.length) throw new Error("the part from  " + edit.from.trim() + "  on its own (" + others.join(", ") + " is in the middle of it)");
    }
    const put = edit.text ? edit.text.replace(/\n$/, "").split("\n") : [];
    lines.splice(a, b - a, ...put);
    return { text: lines.join("\n"), changed: true };
  }
  throw new Error("how to make the change: " + edit.label);
}

const LEFTOVERS = {};

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
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) visit(full, depth + 1);
      } else if (entry.name.endsWith(BAK)) {
        const target = full.slice(0, -BAK.length);
        fs.copyFileSync(full, target); fs.unlinkSync(full);
        say("  restored  " + rel(target)); restored++;
      } else if (CREATED.includes(entry.name)) {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. Everything is back to how it was." : "Nothing to undo.");
  say();
}

// ── Run ───────────────────────────────────────────────────────────────────────
function run() {
  const pkgFile = path.join(ROOT, "package.json");
  if (!fs.existsSync(pkgFile)) stop(["This isn't your AURA project folder (no package.json here).", "Move this file next to package.json and run it from there."]);
  if (UNDO) return undo();

  const where = {
    app: { file: path.join(ROOT, "src", "App.jsx"), name: "window", js: false },
    runner: { file: path.join(ROOT, "tests", "run.cjs"), name: "checks", js: true, optional: true },
  };
  const missing = Object.values(where).filter((w) => !w.optional && !fs.existsSync(w.file)).map((w) => rel(w.file));
  if (missing.length) stop(["I couldn't find " + missing.join(" or ") + ".", "Make sure this file is in your AURA project folder, next to package.json.", "Copy this message to Claude."]);
  const hasChecks = fs.existsSync(where.runner.file);

  const plan = [];
  const problems = [];
  for (const [key, w] of Object.entries(where)) {
    if (w.optional && !fs.existsSync(w.file)) continue;
    const { text, eol } = readText(w.file);
    let now = text;
    const notes = [];
    for (const edit of EDITS.filter((e) => e.file === key)) {
      try {
        const result = applyEdit(now, edit);
        if (result.changed) { now = result.text; if (!notes.includes(edit.label)) notes.push(edit.label); }
      } catch (e) { problems.push("In " + rel(w.file) + " I couldn't find " + e.message + "."); }
    }
    const left = (LEFTOVERS[key] || []).filter((piece) => now.includes(piece));
    if (left.length) problems.push("In " + rel(w.file) + " I couldn't safely remove: " + left.join(", ") + ".");
    if (w.js && now !== text) { const bad = syntaxProblem(now); if (bad) problems.push("In " + rel(w.file) + " I couldn't find a way to edit it safely (" + bad + ")."); }
    plan.push({ label: w.name, file: w.file, before: text, after: now, eol, notes });
  }

  const created = [];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "twitch-row.cjs"), content: FILES.row });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: the Live on Twitch row");
  say();
  for (const step of plan) {
    if (step.after !== step.before && !DRY) {
      const bak = step.file + BAK;
      if (!fs.existsSync(bak)) fs.copyFileSync(step.file, bak);
      fs.writeFileSync(step.file, withEol(step.after, step.eol));
    }
    say("  " + (step.label + ":").padEnd(11) + rel(step.file));
    (step.notes.length ? step.notes : ["already done"]).forEach((n) => say("             - " + n));
  }
  for (const c of created) {
    if (c.note !== "already done" && !DRY) { fs.mkdirSync(path.dirname(c.file), { recursive: true }); fs.writeFileSync(c.file, c.content); }
    say("  " + (c.label + ":").padEnd(11) + rel(c.file));
    say("             - " + c.note);
  }
  say();
  if (DRY) { say("Run it again without --dry-run to apply."); say(); return; }
  say("Done. Next:");
  if (hasChecks) say("  1. Check everything still works:   npm test");
  say("  " + (hasChecks ? "2" : "1") + ". Start AURA and go to Home. Point at a stream in the Live on Twitch row: it should open");
  say("     out and show LIVE and two buttons. Try both buttons.");
  say();
  say("To undo later:  node aura-twitch-row-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
