#!/usr/bin/env node
/**
 * AURA — Twitch and Discord rules, and a mini-player you can close
 *
 * Twitch
 *   - The stream mini-player (the small player that stays when you leave Live Streams) is now
 *     400 x 300, the smallest size Twitch allows. It was 360 x 203.
 *   - The mini-player has a bar above it: drag it to move, Open to go back to the stream, and
 *     an X to close the stream. The old buttons were hidden underneath the player.
 *   - AURA's own volume slider for streams is removed. It worked by running a small script
 *     inside Twitch's player, and Twitch's rules say the player must be left as it is. Use the
 *     volume control inside the player (it remembers your volume).
 *
 * Discord
 *   - The Invite button that tried to send a Discord message as you is removed.
 *   - The Discord friends list is removed. It needed Discord's approval for this app, which is
 *     why it was always empty. Discord login and "now playing" stay as they are.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-twitch-discord-setup.cjs
 *   4. Then:  npm test
 *
 * What it does:
 *   - edits    your main file, preload.js   removes the Discord friends/invite and volume code
 *   - edits    src/App.jsx                  the mini-player, the Streams page and the Discord tab
 *   - creates  tests/platform-rules.cjs     (only if AURA's checks are installed) checks the rules
 *   - creates  tests/miniplayer.cjs         (same) checks the mini-player
 *   - edits    tests/run.cjs                (same) so npm test runs those two
 *
 * Every file it changes is copied to <name>.before-twitch-discord.bak first.
 * To put everything back:                 node aura-twitch-discord-setup.cjs --undo
 * To preview without changing anything:   node aura-twitch-discord-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const EDITS = [{"kind":"cut","file":"main","label":"Discord: AURA no longer reads your Discord friends list or sends Discord messages for you","from":"ipcMain.handle(\"discord-get-friends\"","to":"// ── YouTube trailer ──","done":"AURA doesn't read anyone's Discord friends list","only":["discord-get-friends","discord-invite-friend","rpc-get-friends"],"maxLines":70,"text":"// AURA doesn't read anyone's Discord friends list or send Discord messages for them. Both need\n// Discord's approval for this app, so friends and invites are AURA's own (see social.js).\n\n"},{"kind":"cut","file":"main","label":"Twitch: AURA no longer runs anything inside the Twitch player to change the volume","from":"ipcMain.handle(\"stream-set-volume\"","to":"ipcMain.handle(\"stream-restore\"","done":"Volume is set with the Twitch player's own volume control","only":["stream-set-volume"],"maxLines":30,"text":"// Volume is set with the Twitch player's own volume control. AURA runs nothing inside the player\n// to change it: Twitch's rules say the player must be left as it is.\n\n"},{"kind":"cut","file":"main","label":"Mini-player: never smaller than Twitch's minimum (400 x 300)","from":"ipcMain.handle(\"stream-pip\"","to":"ipcMain.handle(\"stream-resize\"","done":"const STREAM_MIN =","only":["stream-pip"],"maxLines":20,"text":"// The mini-player. Twitch asks that its player is never shown smaller than 400 x 300.\nconst STREAM_MIN = { width: 400, height: 300 };\nipcMain.handle(\"stream-pip\", async (_e, bounds) => {\n  if (streamView && bounds) {\n    const b = zoomBounds(bounds);\n    streamView.setBounds({ x: b.x, y: b.y, width: Math.max(STREAM_MIN.width, b.width), height: Math.max(STREAM_MIN.height, b.height) });\n  }\n  // Chat isn't shown in the mini-player\n  if (mainWin.chatView) {\n    mainWin.removeBrowserView(mainWin.chatView);\n  }\n  return { success: true };\n});\n\n"},{"kind":"re","file":"preload","label":"removed the Discord friends, Discord invite and stream volume calls","re":"^[ \\t]*discordGetFriends\\s*:[^\\n]*\\n","missingOk":true,"text":""},{"kind":"re","file":"preload","label":"removed the Discord friends, Discord invite and stream volume calls","re":"^[ \\t]*discordInviteFriend\\s*:[^\\n]*\\n","missingOk":true,"text":""},{"kind":"re","file":"preload","label":"removed the Discord friends, Discord invite and stream volume calls","re":"^(?:[ \\t]*// ── Discord RPC ─*[ \\t]*\\n)?[ \\t]*rpcGetFriends\\s*:[^\\n]*\\n(?:[ \\t]*\\n)?","missingOk":true,"text":""},{"kind":"re","file":"preload","label":"removed the Discord friends, Discord invite and stream volume calls","re":"^[ \\t]*streamSetVolume\\s*:[^\\n]*\\n","missingOk":true,"text":""},{"kind":"cut","file":"app","label":"Discord tab: the friends list and Invite button are gone; it shows a short note and an Open Discord button","from":"function FriendItem({ friend, onInvite }) {","to":"function FriendsPanel(","maxLines":25,"missingOk":true,"text":""},{"kind":"re","file":"app","label":"Discord tab: the friends list and Invite button are gone; it shows a short note and an Open Discord button","re":"^[ \\t]*const \\[friends,setFriends\\]=useState\\(\\[\\]\\);\\n[ \\t]*const \\[loading,setLoading\\]=useState\\(false\\);\\n","missingOk":true,"text":""},{"kind":"replace","file":"app","label":"Discord tab: the friends list and Invite button are gone; it shows a short note and an Open Discord button","missingOk":true,"before":"window.electronAPI.onDiscordAuthSuccess(async()=>{ await loadUser(); await loadFriends(); });","text":"window.electronAPI.onDiscordAuthSuccess(async()=>{ await loadUser(); });"},{"kind":"cut","file":"app","label":"Discord tab: the friends list and Invite button are gone; it shows a short note and an Open Discord button","from":"const loadFriends=async()=>{","to":"const handleLogin=async()=>{","maxLines":22,"missingOk":true,"text":""},{"kind":"replace","file":"app","label":"Discord tab: the friends list and Invite button are gone; it shows a short note and an Open Discord button","missingOk":true,"before":"setUser(null);setFriends([]);setLoggedIn(false);","text":"setUser(null);setLoggedIn(false);"},{"kind":"re","file":"app","label":"Discord tab: the friends list and Invite button are gone; it shows a short note and an Open Discord button","re":"^[ \\t]*const handleInvite=async\\(friend\\)=>[^\\n]*\\n","missingOk":true,"text":""},{"kind":"re","file":"app","label":"Discord tab: the friends list and Invite button are gone; it shows a short note and an Open Discord button","re":"^[ \\t]*\\{loggedIn&&steamTab===\"discord\"&&<button className=\"fp-refresh\" onClick=\\{loadFriends\\}[^\\n]*\\n","missingOk":true,"text":""},{"kind":"replace","file":"app","label":"Discord tab: the friends list and Invite button are gone; it shows a short note and an Open Discord button","done":"Connect your Discord profile.","before":"<div className=\"fp-login-s\">See friends, their status, and invite them to games</div>","text":"<div className=\"fp-login-s\">Connect your Discord profile. Your Discord status shows the game you're playing in AURA.</div>"},{"kind":"re","file":"app","label":"Discord tab: the friends list and Invite button are gone; it shows a short note and an Open Discord button","re":"^[ \\t]*\\{loading\\?<div className=\"fp-empty\">Loading friends\\.\\.\\.</div>:friends\\.length===0\\?[^\\n]*\\n[ \\t]*<>\\n[ \\t]*\\{friends\\.filter\\([^\\n]*\\n[ \\t]*\\{friends\\.filter\\([^\\n]*\\n[ \\t]*</>\\n[ \\t]*\\)\\}\\n","done":"Friends, messages and invites are in the AURA tab.","text":"                <div className=\"fp-empty\" style={{lineHeight:1.6,color:\"var(--t2)\"}}>Your Discord status shows the game you're playing in AURA. Friends, messages and invites are in the AURA tab.</div>\n                <button className=\"btn-gh\" style={{width:\"100%\",justifyContent:\"center\",fontSize:11,padding:\"7px 10px\"}} onClick={()=>window.electronAPI?.openExternal(\"https://discord.com/channels/@me\")}>Open Discord</button>\n"},{"kind":"re","file":"app","label":"Home: the \"Playing Now\" row no longer asks Discord for friends","re":"^[ \\t]*// Discord RPC friends\\n[ \\t]*try \\{\\n[ \\t]*const rpc = await window\\.electronAPI\\.rpcGetFriends\\(\\);\\n(?:[^\\n]*\\n){1,8}?[ \\t]*\\} catch \\{\\}\\n","missingOk":true,"text":""},{"kind":"insert","file":"app","label":"Streams: closing the mini-player closes the stream, and a stream picked on Home opens","after":"const [activeStream, setActiveStream] = useState(initialStream||null);","done":"useEffect(() => { setActiveStream(initialStream || null); }, [initialStream]);","text":"  // Keep in step with the rest of AURA: a stream picked on Home opens here, and closing the\n  // mini-player closes it here too (which is what shuts the Twitch player down).\n  useEffect(() => { setActiveStream(initialStream || null); }, [initialStream]);\n"},{"kind":"cut","file":"app","label":"Streams: AURA's own volume slider is gone (use the volume control inside the Twitch player)","from":"const [volume, setVolume] = useState(() => Math.round(SETTINGS.streamVolume * 100));","to":"// Open BrowserView when stream selected","maxLines":12,"missingOk":true,"text":"\n"},{"kind":"re","file":"app","label":"Streams: AURA's own volume slider is gone (use the volume control inside the Twitch player)","re":"^[ \\t]*// Apply the default volume once the Twitch player has loaded its video\\n[ \\t]*const v = Math\\.round\\(SETTINGS\\.streamVolume \\* 100\\);\\n[ \\t]*\\[2500, 6000\\]\\.forEach\\([^\\n]*streamSetVolume[^\\n]*\\n","missingOk":true,"text":""},{"kind":"re","file":"app","label":"Streams: AURA's own volume slider is gone (use the volume control inside the Twitch player)","re":"^[ \\t]*\\{/\\* Volume controls \\*/\\}\\n[ \\t]*<div style=\\{\\{display:\"flex\",alignItems:\"center\",gap:6,flexShrink:0\\}\\}>\\n(?:[^\\n]*\\n){1,12}?[ \\t]*</div>\\n(?=[ \\t]*<button onClick=\\{\\(\\)=>\\{setActiveStream\\(null\\);)","missingOk":true,"text":""},{"kind":"replace","file":"app","label":"Settings: the volume setting is now for trailers only","done":"<div className=\"sr-l\">Trailer Volume</div>","before":"<div className=\"sr-l\">Stream &amp; Trailer Volume</div><div className=\"sr-s\">Starting volume for Twitch streams and game trailers</div>","text":"<div className=\"sr-l\">Trailer Volume</div><div className=\"sr-s\">Starting volume for game trailers. Streams use the Twitch player's own volume control.</div>"},{"kind":"cut","file":"app","label":"Mini-player: 400 x 300, with a bar above it to drag, open or close (the X shuts the stream down)","from":"function PipBox({ activeStream, onOpen, onClose, onMove }) {","to":"function AuraApp(){","done":"const PIP = { width: 400, height: 300,","maxLines":70,"text":"// The mini-player: shown while a stream is playing and you are on another page. The Twitch player is a separate\n// layer on top of AURA's page, so anything AURA draws underneath it can't be seen or clicked.\n// The bar with the buttons therefore sits above the player, never over it (Twitch's rules also\n// say nothing may cover the player), and the player is kept at Twitch's minimum size or larger.\nconst PIP = { width: 400, height: 300, bar: 34, edge: 2, gap: 20 };\nlet pipLastSpot = null; // where you last dragged it, until AURA closes\nfunction PipBox({ activeStream, zoom = 1, onOpen, onClose }) {\n  // At a smaller UI size one page pixel is less than one screen pixel, so the box grows to match\n  const scale = Math.min(1, Number(zoom) > 0 ? Number(zoom) : 1);\n  const width = Math.ceil(PIP.width / scale), height = Math.ceil(PIP.height / scale);\n  const boxW = width + PIP.edge * 2, boxH = height + PIP.bar + PIP.edge * 2;\n  const inside = (p) => ({\n    x: Math.max(0, Math.min(window.innerWidth - boxW, Math.round(p.x))),\n    y: Math.max(0, Math.min(window.innerHeight - boxH, Math.round(p.y))),\n  });\n  const [pos, setPos] = useState(() => inside(pipLastSpot || { x: window.innerWidth - boxW - PIP.gap, y: window.innerHeight - boxH - PIP.gap }));\n  const move = (next) => setPos((p) => { const n = inside(next || p); return n.x === p.x && n.y === p.y ? p : n; });\n  const holder = useRef(null);\n  const drag = useRef(null);\n\n  // Puts the Twitch player exactly over the black area under the bar\n  const place = () => {\n    const el = holder.current;\n    if (!el || !window.electronAPI?.streamPip) return;\n    const r = el.getBoundingClientRect();\n    window.electronAPI.streamPip({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });\n  };\n  useEffect(() => { pipLastSpot = pos; place(); }, [pos.x, pos.y, width, height]);\n  useEffect(() => {\n    // Once more after the page has settled, and keep it inside the window when that changes size\n    const later = [200, 700].map((ms) => setTimeout(place, ms));\n    const onResize = () => move();\n    window.addEventListener(\"resize\", onResize);\n    return () => { later.forEach(clearTimeout); window.removeEventListener(\"resize\", onResize); };\n  }, [width, height]);\n\n  // Drag by the bar\n  const onDown = (e) => {\n    if (e.button !== 0 || e.target.closest(\"button\")) return;\n    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };\n    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}\n    e.preventDefault();\n  };\n  const onDrag = (e) => {\n    if (!drag.current) return;\n    if (e.buttons === 0) { drag.current = null; return; } // the button was let go somewhere we couldn't see\n    move({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });\n  };\n  const onUp = () => { drag.current = null; };\n\n  const button = { border: \"none\", color: \"#fff\", borderRadius: 6, height: 24, fontSize: 11, fontWeight: 700, cursor: \"pointer\", fontFamily: \"DM Sans,sans-serif\", flexShrink: 0 };\n  return (\n    <div className=\"pip-box\" style={{position:\"fixed\",left:pos.x,top:pos.y,width:boxW,height:boxH,boxSizing:\"border-box\",zIndex:800,display:\"flex\",flexDirection:\"column\",border:PIP.edge+\"px solid var(--ac)\",borderRadius:\"10px 10px 0 0\",background:\"#000\",boxShadow:\"0 8px 32px rgba(0,0,0,.8)\"}}>\n      <div className=\"pip-bar\" onPointerDown={onDown} onPointerMove={onDrag} onPointerUp={onUp} onPointerCancel={onUp} title=\"Drag to move\"\n        style={{height:PIP.bar,flexShrink:0,display:\"flex\",alignItems:\"center\",gap:8,padding:\"0 6px 0 10px\",background:\"#0e0e10\",borderRadius:\"8px 8px 0 0\",cursor:\"grab\",userSelect:\"none\",touchAction:\"none\"}}>\n        <span aria-hidden=\"true\" style={{color:\"rgba(255,255,255,.5)\",fontSize:12}}>⠿</span>\n        <span style={{flex:1,minWidth:0,fontSize:12,fontWeight:700,color:\"#fff\",fontFamily:\"DM Sans,sans-serif\",whiteSpace:\"nowrap\",overflow:\"hidden\",textOverflow:\"ellipsis\"}}>{activeStream.user}</span>\n        <button type=\"button\" className=\"pip-open\" onClick={onOpen} title=\"Back to Live Streams\" style={{...button,background:\"var(--ac)\",padding:\"0 10px\"}}>Open</button>\n        <button type=\"button\" className=\"pip-close\" onClick={onClose} title=\"Close stream\" aria-label=\"Close stream\" style={{...button,background:\"rgba(255,77,109,.18)\",border:\"1px solid rgba(255,77,109,.45)\",color:\"#ff7a92\",width:28,fontSize:13}}>✕</button>\n      </div>\n      <div id=\"pip-stream-container\" ref={holder} style={{width,height,flexShrink:0,background:\"#000\"}}/>\n    </div>\n  );\n}\n\n"},{"kind":"re","file":"app","label":"Mini-player: 400 x 300, with a bar above it to drag, open or close (the X shuts the stream down)","re":"^[ \\t]*// Move stream BrowserView to PiP when leaving streams view\\n[ \\t]*useEffect\\(\\(\\) => \\{\\n(?:[^\\n]*\\n){5,30}?[ \\t]*\\}, \\[view, activeStream\\]\\);\\n","missingOk":true,"text":""},{"kind":"re","file":"app","label":"Mini-player: 400 x 300, with a bar above it to drag, open or close (the X shuts the stream down)","re":"<PipBox activeStream=\\{activeStream\\} onOpen=\\{\\(\\)=>goTo\\(\"streams\"\\)\\} onClose=\\{\\(\\)=>setActiveStream\\(null\\)\\} onMove=\\{[^\\n]*?\\}/>","done":"<PipBox activeStream={activeStream} zoom={settings.zoom}","text":"<PipBox activeStream={activeStream} zoom={settings.zoom} onOpen={()=>goTo(\"streams\")} onClose={()=>{ window.electronAPI?.streamClose?.(); window.electronAPI?.chatClose?.(); setActiveStream(null); }}/>"},{"kind":"insert","file":"runner","label":"npm test now checks the Twitch and Discord rules","after":"add(\"files\", \"Project files\", \"static.cjs\");","done":"platform-rules.cjs","text":"if (fs.existsSync(path.join(__dirname, \"platform-rules.cjs\"))) add(\"files\", \"Twitch and Discord rules\", \"platform-rules.cjs\");\n"},{"kind":"insert","file":"runner","label":"npm test now checks the mini-player","after":"add(\"window\", \"The window opens and every page loads\", \"window.cjs\");","done":"miniplayer.cjs","text":"if (fs.existsSync(path.join(__dirname, \"miniplayer.cjs\"))) add(\"window\", \"The stream mini-player\", \"miniplayer.cjs\");\n"}];
const FILES = {"rules":"// Twitch and Discord rules: the things AURA must not do with their players and logins.\n//   Twitch:  streams play in Twitch's own player, untouched, and never smaller than 400 x 300.\n//   Discord: AURA signs you in and shows what you're playing. It doesn't read your friends\n//            list or send messages as you (both need Discord's approval for this app).\n// Needs nothing but the project's own files.\n// Added by aura-twitch-discord-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + String(extra).split(\"\\n\").join(\"\\n          \"))); };\nconst read = (p) => { try { return fs.readFileSync(p, \"utf8\"); } catch { return \"\"; } };\nfunction walk(dir, out = []) {\n  let entries = [];\n  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }\n  for (const e of entries) {\n    if (e.name === \"node_modules\" || e.name.startsWith(\".\")) continue;\n    const full = path.join(dir, e.name);\n    if (e.isDirectory()) walk(full, out); else if (/\\.(c?js|jsx)$/.test(e.name)) out.push(full);\n  }\n  return out;\n}\nconst pkg = JSON.parse(read(path.join(ROOT, \"package.json\")) || \"{}\");\nconst mainFile = path.join(ROOT, pkg.main || \"electron/main.js\");\nconst mainSide = walk(path.dirname(mainFile)).map(read).join(\"\\n\");\nconst windowSide = walk(path.join(ROOT, \"src\")).map(read).join(\"\\n\");\nconst everything = mainSide + \"\\n\" + windowSide;\nconst found = (text, list) => list.filter((piece) => (piece instanceof RegExp ? piece.test(text) : text.includes(piece))).map(String);\n\nconsole.log(\"1. Twitch: the player\");\ncheck(\"streams play in Twitch's own player\", /https:\\/\\/player\\.twitch\\.tv\\/\\?channel=/.test(mainSide));\ncheck(\"chat is Twitch's own chat\", /https:\\/\\/www\\.twitch\\.tv\\/embed\\/[^\"'`]*\\/chat/.test(mainSide));\nlet bad = found(mainSide, ['\"stream-set-volume\"', /executeJavaScript\\(\\s*[`'\"][\\s\\S]{0,500}?(querySelector|\\.volume\\s*=|\\.muted\\s*=|\\.style\\b|\\.remove\\(|innerHTML)/]);\ncheck(\"AURA runs nothing inside the player that changes it (volume is the player's own control)\", !bad.length, bad.join(\"\\n\"));\nbad = found(windowSide, [\"streamSetVolume\"]);\ncheck(\"the window has no volume slider that reaches into the player\", !bad.length, bad.join(\"\\n\"));\nbad = found(mainSide, [\"insertCSS(\", /webRequest[\\s\\S]{0,400}?(twitch\\.tv|ttvnw\\.net|jtvnw\\.net)/]);\ncheck(\"nothing is added to the player's page, and none of its requests are blocked\", !bad.length, bad.join(\"\\n\"));\n\nconsole.log(\"2. Twitch: the mini-player's size\");\nconst min = mainSide.match(/STREAM_MIN\\s*=\\s*\\{\\s*width:\\s*(\\d+)\\s*,\\s*height:\\s*(\\d+)/);\ncheck(\"the main process never makes the mini-player smaller than 400 x 300\", !!min && Number(min[1]) >= 400 && Number(min[2]) >= 300 && /Math\\.max\\(STREAM_MIN\\.width/.test(mainSide) && /Math\\.max\\(STREAM_MIN\\.height/.test(mainSide), min ? min[0] : \"no STREAM_MIN in the main file\");\nconst pip = windowSide.match(/const PIP\\s*=\\s*\\{\\s*width:\\s*(\\d+)\\s*,\\s*height:\\s*(\\d+)/);\ncheck(\"the window draws the mini-player at 400 x 300 or larger\", !!pip && Number(pip[1]) >= 400 && Number(pip[2]) >= 300, pip ? pip[0] : \"no PIP size in the window\");\n\nconsole.log(\"3. Discord\");\nconst scopes = [...mainSide.matchAll(/discord\\.com\\/(?:api\\/)?oauth2\\/authorize[^\"'`]*?[?&]scope=([^&\"'`$]+)/g)].map((m) => decodeURIComponent(m[1]).split(/[\\s+]+/).filter(Boolean));\ncheck(\"Discord login asks only for your basic profile\", scopes.length > 0 && scopes.every((list) => list.length === 1 && list[0] === \"identify\"), JSON.stringify(scopes));\nbad = found(everything, [/users\\/@me\\/relationships/, \"getRelationships(\", '\"discord-get-friends\"', '\"rpc-get-friends\"', \"discordGetFriends\", \"rpcGetFriends\"]);\ncheck(\"AURA doesn't read your Discord friends list\", !bad.length, bad.join(\"\\n\"));\nbad = found(everything, [/discord(?:app)?\\.com\\/api\\/[^\"'`]*(?:channels|messages)/, '\"discord-invite-friend\"', \"discordInviteFriend\"]);\ncheck(\"AURA doesn't send Discord messages as you\", !bad.length, bad.join(\"\\n\"));\n\nconsole.log(failed ? `\\n${failed} FAILED` : \"\\nall passed\");\nprocess.exit(failed ? 1 : 0);\n","miniplayer":"// The stream mini-player: the small Twitch player that stays on screen when you leave Live Streams.\n//\n// The Twitch player is a separate layer that the main process puts on top of AURA's page, at the\n// spot the page asks for. This opens the built window (dist) in a real browser with a pretend\n// desktop side, plays a pretend stream, and checks what the page asks for:\n//   - the player is at least 400 x 300 (Twitch's minimum), at any UI size\n//   - the bar with the name, Open and X sits above the player, never under or over it\n//   - dragging the bar moves the player with it\n//   - the X shuts the stream down\n//   - AURA never asks to change the volume inside the player\n// Added by aura-twitch-discord-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\n\n(async () => {\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(process.env.CI ? 1 : 3); }\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch(options); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with. Run  npx playwright install chromium  once to add one.\"); return done(process.env.CI ? 1 : 3); }\n\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(DIST, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => {\n      if (err) { res.writeHead(404); return res.end(); }\n      res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" });\n      res.end(data);\n    });\n  });\n  await new Promise((r) => server.listen(0, \"127.0.0.1\", r));\n  const base = \"http://127.0.0.1:\" + server.address().port;\n\n  // Start AURA logged in, with a desktop side that notes down everything the page asks it for\n  async function start({ zoom = 1 } = {}) {\n    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();\n    const thrown = [];\n    page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());\n    await page.addInitScript(({ zoom }) => {\n      try {\n        localStorage.clear();\n        localStorage.setItem(\"aura_profile\", JSON.stringify({ username: \"tester\", avatar: \"\", userId: \"user-1\" }));\n        localStorage.setItem(\"aura_settings\", JSON.stringify({ zoom }));\n      } catch {}\n      window.__calls = [];\n      const ok = (data) => Promise.resolve({ success: true, data });\n      const account = {\n        getSession: () => ok({ id: \"user-1\", email: \"me@example.com\" }),\n        getMyProfile: () => ok({ username: \"tester\", avatar_url: null }),\n        saveProfile: (name, picture) => ok({ username: name, avatar_url: picture || null }),\n      };\n      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => (name === \"auraCloud\" && account[key]) ? account[key](...args) : ok(null)) });\n      window.auraCloud = fake(\"auraCloud\");\n      window.auraSocial = fake(\"auraSocial\");\n      const stream = { id: \"s1\", user: \"TestStreamer\", userLogin: \"teststreamer\", title: \"A test stream\", game: \"Test Game\", viewers: 1234, thumbnail: \"\", url: \"https://twitch.tv/teststreamer\" };\n      const desktop = {\n        fetchTwitchStreams: () => Promise.resolve({ success: true, streams: [stream] }),\n        // A window that isn't in the corner of the screen. The player's place must not depend on this.\n        getWindowPos: () => Promise.resolve({ x: 300, y: 200 }),\n      };\n      window.electronAPI = new Proxy({}, {\n        get: (_t, key) => {\n          if (key === \"isElectron\") return true;\n          if (typeof key !== \"string\" || key === \"then\") return undefined;\n          if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};\n          return (...args) => { window.__calls.push([key, args]); return desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }); };\n        },\n      });\n    }, { zoom });\n    await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n    await page.waitForTimeout(4500);\n    const menu = async (name) => {\n      await page.locator(`.gm-rail-item[title=\"${name}\"], .sb-item[title=\"${name}\"]`).first().click({ timeout: 5000 });\n      await page.waitForTimeout(500);\n    };\n    const calls = (name) => page.evaluate((n) => window.__calls.filter(([k]) => k === n).map(([, a]) => a[0]), name);\n    const box = (selector) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; }, selector);\n    return { page, thrown, menu, calls, box };\n  }\n  const same = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;\n  const apart = (a, b) => !!a && !!b && (a.y + a.height <= b.y || b.y + b.height <= a.y || a.x + a.width <= b.x || b.x + b.width <= a.x);\n\n  try {\n    console.log(\"1. Playing a stream\");\n    let app = await start();\n    await app.menu(\"Live Streams\");\n    await app.page.getByText(\"A test stream\").first().click({ timeout: 5000 });\n    await app.page.waitForTimeout(900);\n    const opened = await app.calls(\"streamOpen\");\n    check(\"picking a stream opens the Twitch player\", opened.length === 1 && opened[0].channel === \"teststreamer\", opened);\n    check(\"AURA has no volume slider of its own on the stream (the player has one)\", (await app.page.locator('input[type=\"range\"]:visible').count()) === 0);\n\n    console.log(\"2. Leaving the page: the mini-player\");\n    await app.menu(\"Library\");\n    await app.page.waitForTimeout(900);\n    let player = await app.box(\"#pip-stream-container\"), bar = await app.box(\".pip-bar\"), close = await app.box(\".pip-close\"), open = await app.box(\".pip-open\");\n    let asked = (await app.calls(\"streamPip\")).pop();\n    check(\"the mini-player shows\", !!player && !!bar, { player, bar });\n    check(\"the player is at least 400 x 300\", !!player && player.width >= 400 && player.height >= 300, player);\n    check(\"the Twitch player is put exactly where the page shows it (wherever the window is on screen)\", same(asked, player), { asked, player });\n    check(\"the bar sits above the player, not over it\", !!bar && !!player && bar.y + bar.height <= player.y && apart(bar, player), { bar, player });\n    check(\"Open and X are in the bar, clear of the player\", !!close && !!open && apart(close, player) && apart(open, player) && close.width >= 24 && close.height >= 20, { open, close, player });\n    check(\"the whole mini-player is inside the window\", !!player && !!bar && bar.x >= 0 && bar.y >= 0 && player.x + player.width <= 1440 && player.y + player.height <= 900, { bar, player });\n    check(\"the streamer's name is on the bar\", /TestStreamer/.test(await app.page.locator(\".pip-bar\").innerText()));\n\n    console.log(\"3. Moving it\");\n    const grab = { x: bar.x + 60, y: bar.y + Math.round(bar.height / 2) };\n    await app.page.mouse.move(grab.x, grab.y);\n    await app.page.mouse.down();\n    await app.page.mouse.move(grab.x - 300, grab.y - 200, { steps: 6 });\n    await app.page.mouse.up();\n    await app.page.waitForTimeout(300);\n    const moved = await app.box(\"#pip-stream-container\");\n    asked = (await app.calls(\"streamPip\")).pop();\n    check(\"dragging the bar moves the mini-player\", !!moved && moved.x === player.x - 300 && moved.y === player.y - 200, { from: player, to: moved });\n    check(\"and the Twitch player follows it\", same(asked, moved), { asked, moved });\n    await app.page.mouse.move(grab.x - 300, grab.y - 200);\n    await app.page.mouse.down();\n    await app.page.mouse.move(-500, -500, { steps: 4 });\n    await app.page.mouse.up();\n    await app.page.waitForTimeout(300);\n    const cornered = await app.box(\".pip-box\");\n    check(\"it can't be dragged off the window\", !!cornered && cornered.x === 0 && cornered.y === 0, cornered);\n    await app.menu(\"Settings\");\n    await app.page.waitForTimeout(300);\n    check(\"it stays where you put it when you change page\", same(await app.box(\".pip-box\"), cornered), await app.box(\".pip-box\"));\n\n    console.log(\"4. Closing it\");\n    const before = (await app.calls(\"streamClose\")).length;\n    await app.page.locator(\".pip-close\").click({ timeout: 4000 });\n    await app.page.waitForTimeout(600);\n    check(\"X takes the mini-player away\", (await app.box(\".pip-box\")) === null);\n    check(\"and shuts the Twitch player down\", (await app.calls(\"streamClose\")).length > before);\n    await app.menu(\"Live Streams\");\n    check(\"back on Live Streams the list is showing, not a stream\", (await app.page.getByText(\"A test stream\").first().isVisible()) && (await app.calls(\"streamOpen\")).length === 1);\n\n    console.log(\"5. Back and forth\");\n    await app.page.getByText(\"A test stream\").first().click({ timeout: 5000 });\n    await app.page.waitForTimeout(900);\n    await app.menu(\"Library\");\n    await app.page.waitForTimeout(500);\n    check(\"a new stream gets a mini-player too\", !!(await app.box(\".pip-box\")) && (await app.calls(\"streamOpen\")).length === 2);\n    await app.page.locator(\".pip-open\").click({ timeout: 4000 });\n    await app.page.waitForTimeout(700);\n    check(\"Open goes back to the stream, and the mini-player goes away\", (await app.box(\".pip-box\")) === null && (await app.page.getByText(\"Hide Chat\").first().isVisible()));\n    await app.page.getByText(\"Close\", { exact: false }).filter({ hasText: /^✕ Close$/ }).first().click({ timeout: 4000 });\n    await app.page.waitForTimeout(500);\n    await app.menu(\"Home\");\n    await app.page.waitForTimeout(800);\n    const onHome = app.page.locator(\".twitch-shelf .twitch-card\").first();\n    if (await onHome.isVisible().catch(() => false)) {\n      await onHome.click({ timeout: 4000 });\n      await app.page.waitForTimeout(1000);\n      check(\"a stream picked on Home opens on Live Streams\", (await app.calls(\"streamOpen\")).length === 3 && (await app.page.getByText(\"Hide Chat\").first().isVisible()) && (await app.box(\".pip-box\")) === null, await app.calls(\"streamOpen\"));\n    } else note(\"Home isn't showing a Twitch row here, so picking a stream from it wasn't checked\");\n    const volume = await app.page.evaluate(() => window.__calls.filter(([k]) => /volume/i.test(k)).map(([k]) => k));\n    check(\"AURA never asked to change the volume inside the player\", volume.length === 0, volume);\n    check(\"nothing crashed along the way\", (await app.page.locator(\".aura-fallback\").count()) === 0, app.thrown);\n    await app.page.context().close();\n\n    console.log(\"6. At the smallest UI size (80%)\");\n    app = await start({ zoom: 0.8 });\n    await app.menu(\"Live Streams\");\n    await app.page.getByText(\"A test stream\").first().click({ timeout: 5000 });\n    await app.page.waitForTimeout(900);\n    await app.menu(\"Library\");\n    await app.page.waitForTimeout(900);\n    player = await app.box(\"#pip-stream-container\"); bar = await app.box(\".pip-bar\");\n    asked = (await app.calls(\"streamPip\")).pop();\n    // The main process multiplies the page's numbers by the UI size to get real pixels\n    const real = asked ? { width: Math.round(asked.width * 0.8), height: Math.round(asked.height * 0.8) } : null;\n    check(\"the player is still at least 400 x 300 real pixels\", !!real && real.width >= 400 && real.height >= 300, { asked, real });\n    check(\"and the bar is still above it\", same(asked, player) && !!bar && bar.y + bar.height <= player.y, { bar, player, asked });\n    await app.page.context().close();\n  } finally {\n    await browser.close();\n    server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The mini-player check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-twitch-discord.bak";
const MARK = "Added by aura-twitch-discord-setup.cjs";
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "release", ".git", ".vite", "coverage"]);
const CREATED = ["platform-rules.cjs", "miniplayer.cjs"];

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
    throw new Error(edit.kind === "cut" || edit.kind === "insert" ? "the line  " + (edit.from || edit.after).trim() : "the part for: " + edit.label);
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
    const hits = lines.map((l, i) => (l.includes(edit.after) ? i : -1)).filter((i) => i >= 0);
    if (!hits.length) return already();
    if (hits.length > 1) throw new Error("exactly one line with  " + edit.after.trim() + "  (there are " + hits.length + ")");
    lines.splice(hits[0] + 1, 0, ...edit.text.replace(/\n$/, "").split("\n"));
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

// After the edits, none of these may be left. If one is, an edit didn't fit this copy of AURA
// and the files would no longer agree with each other, so nothing is written.
const LEFTOVERS = {
  main: ['"discord-get-friends"', '"discord-invite-friend"', '"rpc-get-friends"', '"stream-set-volume"', "getRelationships("],
  preload: ["discordGetFriends", "discordInviteFriend", "rpcGetFriends", "streamSetVolume"],
  app: ["discordGetFriends", "discordInviteFriend", "rpcGetFriends", "streamSetVolume", "setStreamVolume", "loadFriends", "handleInvite", "<FriendItem", "{loading?", "onMove={(x,y)"],
  runner: [],
};

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

  let pkgMain = "";
  try { pkgMain = String(JSON.parse(fs.readFileSync(pkgFile, "utf8")).main || ""); } catch {}
  const mainFile = path.resolve(ROOT, pkgMain || "electron/main.js");
  const where = {
    main: { file: mainFile, name: "main file", js: true },
    preload: { file: path.join(path.dirname(mainFile), "preload.js"), name: "bridge", js: true },
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
  if (hasChecks) {
    created.push({ label: "checks", file: path.join(ROOT, "tests", "platform-rules.cjs"), content: FILES.rules });
    created.push({ label: "checks", file: path.join(ROOT, "tests", "miniplayer.cjs"), content: FILES.miniplayer });
  }
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: Twitch and Discord rules, and the mini-player");
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
  say("  " + (hasChecks ? "2" : "1") + ". Start AURA, open a stream, then click Library. The small player should sit under a");
  say("     bar with the streamer's name, Open and an X. Drag the bar, then press the X.");
  say();
  say("To undo later:  node aura-twitch-discord-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
