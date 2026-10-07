#!/usr/bin/env node
/**
 * AURA — a way out of the full-window stream
 *
 * The Twitch player is a separate layer drawn on top of AURA. In "full" view it covered the
 * whole window, including every AURA button, and the keys that were meant to leave it did not
 * work once you had clicked the player. Typing the letter F in the Streams search box also
 * switched it on by accident.
 *
 * After this:
 *   - full view keeps a slim bar at the top with "Exit full view" and "Close stream"
 *   - Esc always leaves full view, even with the keyboard inside the Twitch player
 *   - F only toggles full view when you are not typing in a text box
 *   - leaving full view puts the player back where it belongs (it used to shrink into a corner)
 *   - the player and chat stay lined up when the window or the side panels change size
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-stream-fix.cjs
 *
 * Every file it changes is copied to <name>.before-stream.bak first.
 * To put everything back:                 node aura-stream-fix.cjs --undo
 * To preview without changing anything:   node aura-stream-fix.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");


const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-stream.bak";
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "release", ".git", ".vite", "coverage"]);

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
function findOne(label, test, hint) {
  const hits = [];
  for (const file of walk(ROOT)) {
    let text = "";
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    if (test(text)) hits.push(file);
  }
  if (hits.length === 1) return hits[0];
  if (!hits.length) stop(["I couldn't find " + label + ".", hint, "Copy this message to Claude."]);
  stop(["I found more than one file that looks like " + label + ":", ...hits.map((h) => "  " + rel(h)), "Copy this message to Claude."]);
}
const indentOf = (line) => line.match(/^\s*/)[0];
const findLine = (lines, re, from = 0, to = lines.length) => { for (let i = from; i < to; i++) if (re.test(lines[i])) return i; return -1; };



// ── Main file ─────────────────────────────────────────────────────────────────
const MAIN_BLOCK = `// ── Stream full view ──────────────────────────────────────────────────────────
// The Twitch player is a separate layer drawn on top of AURA's page, so when it fills the window
// it also covers AURA's buttons. Two things make sure there is always a way out:
//   - a slim strip at the top is left uncovered, where the page shows "Exit full view"
//   - Esc leaves full view even when the keyboard is inside the Twitch player
const STREAM_BAR = 44; // height of that strip, in page pixels (the page draws a bar the same height)
function fillWindowWithStream() {
  if (!streamView || !mainWin) return;
  const [w, h] = mainWin.getContentSize();
  const bar = Math.round(STREAM_BAR * (mainWin.webContents.getZoomFactor() || 1));
  streamView.setBounds({ x: 0, y: bar, width: w, height: Math.max(1, h - bar) });
}
function leaveStreamFull() {
  if (!streamView || !streamView.__auraFull) return false;
  streamView.__auraFull = false;
  // Straight back to where it was; the page then lines it up exactly
  if (streamView.__auraBefore) { try { streamView.setBounds(streamView.__auraBefore); } catch {} }
  return true;
}

ipcMain.handle("stream-fullscreen", async () => {
  // Wait up to 2s for streamView to be available
  let attempts = 0;
  while (!streamView && attempts < 20) {
    await new Promise(r => setTimeout(r, 100));
    attempts++;
  }
  if (!streamView || !mainWin) return { success: false, error: "No stream active" };
  const view = streamView;
  if (!view.__auraFull) view.__auraBefore = view.getBounds();
  view.__auraFull = true;
  mainWin.removeBrowserView(view);
  mainWin.addBrowserView(view);
  fillWindowWithStream();
  if (mainWin.chatView) mainWin.removeBrowserView(mainWin.chatView);
  if (!view.__auraEsc) {
    view.__auraEsc = true;
    // Keys pressed inside the Twitch player never reach AURA's page, so Esc is caught here
    view.webContents.on("before-input-event", (e, input) => {
      if (input.type !== "keyDown" || input.key !== "Escape" || !view.__auraFull) return;
      e.preventDefault();
      view.webContents.executeJavaScript("document.fullscreenElement && document.exitFullscreen()").catch(() => {});
      if (streamView === view) leaveStreamFull();
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.focus();
        mainWin.webContents.send("stream-exit-full");
      }
    });
  }
  if (!mainWin.__auraStreamResize) {
    mainWin.__auraStreamResize = true;
    mainWin.on("resize", () => { if (streamView && streamView.__auraFull) fillWindowWithStream(); });
  }
  return { success: true };
});

// The page asks for this before it puts the player back in its place
ipcMain.handle("stream-exit-full", async () => ({ success: true, wasFull: leaveStreamFull() }));`;

function editMain(text) {
  if (/ipcMain\.handle\(\s*["']stream-exit-full["']/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  if (findLine(lines, /^let streamView\s*=\s*null\s*;?\s*$/) < 0) fail0("the line  let streamView = null;");
  if (findLine(lines, /^let mainWin\b/) < 0 && !/\bmainWin\s*=\s*new BrowserWindow/.test(text)) fail0("the main window ( mainWin )");
  const start = findLine(lines, /^ipcMain\.handle\(\s*["']stream-fullscreen["']/);
  if (start < 0) fail0('the full view handler ( ipcMain.handle("stream-fullscreen", ... )');
  const end = findLine(lines, /^\}\s*\)\s*;?\s*$/, start);
  if (end < 0 || end - start > 40) fail0("the end of the full view handler");
  const old = lines.slice(start, end + 1).join("\n");
  if (!/streamView\.setBounds\(/.test(old) || !/getContentSize\(\)/.test(old)) fail0("the full view handler in the shape I expected");
  if (findLine(lines, /^ipcMain\.handle\(\s*["']stream-restore["']/) < 0) fail0('the handler  ipcMain.handle("stream-restore", ... )');
  lines.splice(start, end - start + 1, ...MAIN_BLOCK.split("\n"));
  return { text: lines.join("\n"), notes: ["full view leaves a bar at the top and Esc always leaves it"] };
}
function fail0(what) { throw new Error(what); }

// ── preload.js ────────────────────────────────────────────────────────────────
function editPreload(text) {
  if (/\bstreamExitFull\s*:/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  const at = findLine(lines, /^\s*streamFullscreen\s*:.*,\s*$/);
  if (at < 0) fail0("the line  streamFullscreen: ...");
  const pad = indentOf(lines[at]);
  lines.splice(at + 1, 0,
    pad + 'streamExitFull:  ()      => ipcRenderer.invoke("stream-exit-full"),',
    pad + "// Esc was pressed inside the Twitch player while it filled the window",
    pad + 'onStreamExitFull:(cb)    => { const h = () => cb(); ipcRenderer.on("stream-exit-full", h); return () => ipcRenderer.removeListener("stream-exit-full", h); },');
  return { text: lines.join("\n"), notes: ["added the two full view lines to the bridge"] };
}

// ── App file: the Streams page ────────────────────────────────────────────────
const APP_BLOCK = `  // ── Full view ───────────────────────────────────────────────────────────────
  // The Twitch player is a separate layer on top of AURA, so in full view it covers AURA's own
  // buttons. A slim bar stays at the top with a way out, and Esc always leaves full view.
  const fullRef = useRef(false);
  // Puts the player and the chat back over their boxes on the page
  const placeViews = () => {
    if (!window.electronAPI?.isElectron || fullRef.current) return;
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : null;
    };
    const bounds = box(playerContainerRef.current);
    if (bounds) window.electronAPI.streamRestore?.({ bounds, chatBounds: box(chatContainerRef.current) });
  };
  const setFull = (next) => {
    next = !!next;
    if (!window.electronAPI?.isElectron) return;
    fullRef.current = next;
    setIsStreamFull(next);
    if (next) {
      Promise.resolve(window.electronAPI.streamFullscreen?.()).then((r) => {
        if (!r || r.success !== true) { fullRef.current = false; setIsStreamFull(false); }
      }).catch(() => { fullRef.current = false; setIsStreamFull(false); });
    } else {
      Promise.resolve(window.electronAPI.streamExitFull?.()).catch(() => {}).then(() => { placeViews(); setTimeout(placeViews, 250); });
    }
  };

  // F toggles full view (not while typing in a text box). Esc leaves it.
  useEffect(() => {
    if (!activeStream) { fullRef.current = false; setIsStreamFull(false); return; }
    const onKey = (e) => {
      if (e.key === "Escape") { if (fullRef.current) setFull(false); return; }
      if (e.key !== "f" && e.key !== "F") return;
      const el = e.target;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (typing || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
      setFull(!fullRef.current);
    };
    window.addEventListener("keydown", onKey);
    // Esc pressed inside the Twitch player arrives here from the main process
    const off = window.electronAPI?.onStreamExitFull?.(() => { if (fullRef.current) setFull(false); else placeViews(); });
    return () => { window.removeEventListener("keydown", onKey); if (typeof off === "function") off(); };
  }, [activeStream]);

  // Keep the player and chat lined up with the page when the window or the side panels change size
  useEffect(() => {
    if (!activeStream || !window.electronAPI?.isElectron) return;
    let timer = null;
    const soon = () => { clearTimeout(timer); timer = setTimeout(placeViews, 80); };
    window.addEventListener("resize", soon);
    const watcher = typeof ResizeObserver === "function" ? new ResizeObserver(soon) : null;
    if (watcher && playerContainerRef.current) watcher.observe(playerContainerRef.current);
    // Once the player and chat have opened, line both up (the chat used to open over the player)
    const after = [700, 1800].map((ms) => setTimeout(placeViews, ms));
    return () => { window.removeEventListener("resize", soon); if (watcher) watcher.disconnect(); clearTimeout(timer); after.forEach(clearTimeout); };
  }, [activeStream, chatOpen]);
  useEffect(() => () => { fullRef.current = false; }, []);`;

const APP_BAR = `      {/* Full view: the only part of AURA the player doesn't cover. Always a way out. */}
      {isStreamFull && activeStream && window.electronAPI?.isElectron && (
        <div className="stream-full-bar" style={{position:"fixed",top:0,left:0,right:0,height:44,zIndex:5000,background:"#0e0e10",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:12,padding:"0 16px",boxSizing:"border-box"}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:"#eb0400",boxShadow:"0 0 6px #eb0400",flexShrink:0}}/>
          <div style={{flex:1,minWidth:0,fontFamily:"Rajdhani,sans-serif",fontSize:14,fontWeight:700,color:"var(--t1)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{activeStream.user}<span style={{fontFamily:"DM Sans,sans-serif",fontSize:11,fontWeight:400,color:"var(--t2)",marginLeft:10}}>{activeStream.title}</span></div>
          <span style={{fontSize:11,color:"var(--t2)",flexShrink:0}}>Press Esc to exit</span>
          <button onClick={()=>setFull(false)} style={{background:"var(--acd)",border:"1px solid var(--acg)",color:"var(--ac)",borderRadius:6,padding:"6px 12px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"DM Sans,sans-serif",flexShrink:0}}>Exit full view</button>
          <button onClick={()=>{setFull(false);setActiveStream(null);onStreamChange?.(null);onClear&&onClear();}} style={{background:"rgba(255,77,109,.1)",border:"1px solid rgba(255,77,109,.3)",color:"var(--danger)",borderRadius:6,padding:"6px 12px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"DM Sans,sans-serif",flexShrink:0}}>✕ Close stream</button>
        </div>
      )}`;

function editApp(text) {
  if (/\bconst setFull\s*=/.test(text) && /stream-full-bar/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  const notes = [];
  const start = findLine(lines, /^function StreamsView\s*\(/);
  if (start < 0) fail0("function StreamsView( (the Streams page)");
  let end = findLine(lines, /^function \w+\s*\(/, start + 1);
  if (end < 0) end = lines.length;
  const inView = (re, from = start) => findLine(lines, re, from, end);

  if (inView(/\[\s*isStreamFull\s*,\s*setIsStreamFull\s*\]\s*=\s*useState/) < 0) fail0("const [isStreamFull, setIsStreamFull] = useState(false) on the Streams page");
  if (inView(/\[\s*activeStream\s*,\s*setActiveStream\s*\]\s*=\s*useState/) < 0) fail0("const [activeStream, setActiveStream] = useState(...) on the Streams page");
  if (inView(/const playerContainerRef\s*=\s*useRef\(/) < 0 || inView(/const chatContainerRef\s*=\s*useRef\(/) < 0) fail0("the player and chat boxes ( playerContainerRef, chatContainerRef )");
  if (inView(/\[\s*chatOpen\s*,\s*setChatOpen\s*\]\s*=\s*useState/) < 0) fail0("const [chatOpen, setChatOpen] = useState(true) on the Streams page");

  // 1. The key handling
  const keyStart = inView(/^\s*\/\/ F key to toggle fullscreen stream\s*$/);
  const effStart = inView(/^\s*useEffect\(\(\)\s*=>\s*\{\s*$/, keyStart < 0 ? start : keyStart);
  if (keyStart < 0 || effStart !== keyStart + 1) fail0('the "F key to toggle fullscreen stream" block on the Streams page');
  const keyEnd = inView(/^\s*\},\s*\[\s*isStreamFull\s*\]\s*\)\s*;?\s*$/, effStart);
  if (keyEnd < 0 || keyEnd - keyStart > 40) fail0('the end of the "F key to toggle fullscreen stream" block');
  const oldKeys = lines.slice(keyStart, keyEnd + 1).join("\n");
  if (!/streamFullscreen/.test(oldKeys) || !/addEventListener\("keydown"/.test(oldKeys)) fail0('the "F key to toggle fullscreen stream" block in the shape I expected');
  // It must come after everything it uses is declared
  const declared = Math.max(inView(/\[\s*chatOpen\s*,\s*setChatOpen\s*\]\s*=\s*useState/), inView(/\[\s*isStreamFull\s*,\s*setIsStreamFull\s*\]\s*=\s*useState/), inView(/\[\s*activeStream\s*,\s*setActiveStream\s*\]\s*=\s*useState/));
  if (declared > keyStart) fail0("the Streams page in the order I expected");
  lines.splice(keyStart, keyEnd - keyStart + 1, ...APP_BLOCK.split("\n"));
  notes.push("F ignores typing, Esc leaves full view, and the player goes back to its place");
  end = findLine(lines, /^function \w+\s*\(/, start + 1); if (end < 0) end = lines.length;

  // 2. The full view button under the player
  const btn = inView(/onClick=\{\(\)=>\{setIsStreamFull\(f=>\{const next=!f;/);
  if (btn < 0) fail0("the full view button under the player");
  const before = lines[btn];
  lines[btn] = before.replace(/onClick=\{\(\)=>\{setIsStreamFull\(f=>\{const next=!f;.*?return next;\}\)\}\}/, "onClick={()=>setFull(!fullRef.current)}");
  if (lines[btn] === before) fail0("the full view button under the player in the shape I expected");
  notes.push("the full view button uses the same switch");

  // 3. The bar that stays visible in full view
  const ret = inView(/^\s*<div style=\{\{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:"var\(--bg\)",height:"100%"\}\}>\s*$/);
  if (ret < 0 || !/^\s*return\s*\(\s*$/.test(lines[ret - 1] || "")) fail0("the start of the Streams page layout ( return ( <div style={{flex:1,display:\"flex\",flexDirection:\"column\", ... )");
  lines.splice(ret + 1, 0, ...APP_BAR.split("\n"));
  notes.push('added the "Exit full view" bar');
  return { text: lines.join("\n"), notes };
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
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) visit(full, depth + 1);
      } else if (entry.name.endsWith(BAK)) {
        const target = full.slice(0, -BAK.length);
        fs.copyFileSync(full, target);
        fs.unlinkSync(full);
        say("  restored  " + rel(target));
        restored++;
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. The Streams page is back to how it was." : "Nothing to undo.");
  say();
}

// ── Run ───────────────────────────────────────────────────────────────────────
function run() {
  if (!fs.existsSync(path.join(ROOT, "package.json"))) {
    stop(["This isn't your AURA project folder (no package.json here).", "Move this file next to package.json and run it from there."]);
  }
  if (UNDO) return undo();

  const need = "Make sure this file is in your AURA project folder, next to package.json.";
  const files = {
    main: findOne("your main file", (t) => /ipcMain\.handle\(\s*["']stream-fullscreen["']/.test(t), need),
    preload: findOne("preload.js", (t) => /exposeInMainWorld\(/.test(t) && /\bstreamFullscreen\s*:/.test(t), need),
    app: findOne("your App file", (t) => /^function StreamsView\s*\(/m.test(t) && /function AuraApp\s*\(/.test(t), need),
  };
  const edits = { main: editMain, preload: editPreload, app: editApp };
  const labels = { main: "main file", preload: "preload", app: "App file" };

  // Work everything out first, so nothing is written unless every edit fits
  const plan = [];
  const problems = [];
  for (const id of Object.keys(files)) {
    const { text, eol } = readText(files[id]);
    try {
      const result = edits[id](text);
      if (id !== "app" && result.text !== text) { const bad = syntaxProblem(result.text); if (bad) throw new Error("a way to edit it safely (" + bad + ")"); }
      plan.push({ id, file: files[id], before: text, after: result.text, eol, notes: result.notes });
    } catch (e) { problems.push("In " + rel(files[id]) + " I couldn't find " + e.message + "."); }
  }
  if (problems.length) stop([...problems, "Copy this message to Claude."]);

  say();
  say(DRY ? "Dry run. This is what would change:" : "AURA stream full view");
  say();
  for (const step of plan) {
    if (step.after !== step.before && !DRY) {
      const bak = step.file + BAK;
      if (!fs.existsSync(bak)) fs.copyFileSync(step.file, bak);
      fs.writeFileSync(step.file, withEol(step.after, step.eol));
    }
    say("  " + (labels[step.id] + ":").padEnd(11) + rel(step.file));
    (step.notes.length ? step.notes : ["already done"]).forEach((n) => say("             - " + n));
  }
  say();
  if (DRY) { say("Run it again without --dry-run to apply."); say(); return; }
  say("Done. Fully restart AURA (stop it in the terminal, then start it again).");
  say("To undo later:  node aura-stream-fix.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
