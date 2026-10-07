#!/usr/bin/env node
/**
 * AURA — bookmarks for the Browser tab (Social page)
 *
 *   - a star beside the address bar saves the page you're on (click it again to remove it)
 *   - a bookmarks bar under the toolbar: click one to open it; its menu renames, moves or removes it
 *   - your bookmarks also show on the Browser tab's start page
 *   - a button beside the star hides or shows the bar
 *
 * Bookmarks are kept on this PC, in AURA's own storage.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-bookmarks-setup.cjs
 *
 * What it does:
 *   - edits    src/components/social.jsx     the Social page (nothing else is touched)
 *
 * The file it changes is copied to <name>.before-bookmarks.bak first.
 * To put everything back:                 node aura-bookmarks-setup.cjs --undo
 * To preview without changing anything:   node aura-bookmarks-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const path = require("path");

const CHANGES = {"edits":[["// src/components/social.jsx — Social page: Instagram, X and Facebook inside AURA\nimport { useCallback, useEffect, useRef, useState } from \"react\";\n","// src/components/social.jsx — Social page: Instagram, X and Facebook inside AURA\nimport { useCallback, useEffect, useRef, useState } from \"react\";\n\n// ── Bookmarks (Browser tab) ───────────────────────────────────────────────────\n// Added by aura-bookmarks-setup.cjs. Kept on this PC, in AURA's own storage.\nconst BOOKMARKS_KEY = \"aura_bookmarks\";\nconst BOOKMARKS_BAR_KEY = \"aura_bookmarks_bar\";\nconst MAX_BOOKMARKS = 60;\nconst isWebAddress = (v) => typeof v === \"string\" && v.length <= 2000 && /^https?:\\/\\/[^\\s]+$/i.test(v);\nconst siteName = (url) => { try { return new URL(url).hostname.replace(/^www\\./, \"\"); } catch { return \"Bookmark\"; } };\nconst tidyTitle = (title, url) => String(title || \"\").replace(/\\s+/g, \" \").trim().slice(0, 80) || siteName(url);\nconst sameAddress = (a, b) => String(a || \"\").replace(/\\/$/, \"\") === String(b || \"\").replace(/\\/$/, \"\");\nfunction loadBookmarks() {\n  try {\n    const list = JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || \"[]\");\n    if (!Array.isArray(list)) return [];\n    // Only web addresses are kept, whatever ended up in storage\n    return list.filter((b) => b && isWebAddress(b.url)).slice(0, MAX_BOOKMARKS).map((b, i) => ({\n      id: typeof b.id === \"string\" && b.id ? b.id : \"b\" + i,\n      url: b.url,\n      title: tidyTitle(b.title, b.url),\n      icon: typeof b.icon === \"string\" && /^https:\\/\\//i.test(b.icon) && b.icon.length <= 2000 ? b.icon : \"\",\n    }));\n  } catch { return []; }\n}\nfunction saveBookmarks(list) {\n  try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(list)); } catch {}\n}\n"],["    const update = () => {\n      try { onState(site.id, { canGoBack: wv.canGoBack(), canGoForward: wv.canGoForward(), url: wv.getURL() }); } catch {}\n    };\n    const start = () => onState(site.id, { loading: true });\n    const stop = () => { onState(site.id, { loading: false }); update(); };\n    const events = [\n      [\"dom-ready\", update], [\"did-navigate\", update], [\"did-navigate-in-page\", update],\n      [\"did-start-loading\", start], [\"did-stop-loading\", stop],\n    ];","    const update = () => {\n      try { onState(site.id, { canGoBack: wv.canGoBack(), canGoForward: wv.canGoForward(), url: wv.getURL(), title: wv.getTitle() }); } catch {}\n    };\n    const start = () => onState(site.id, { loading: true });\n    const stop = () => { onState(site.id, { loading: false }); update(); };\n    // The page's name and little icon, used when it is bookmarked\n    const moved = () => { onState(site.id, { icon: \"\" }); update(); }; // a new page: the old icon no longer applies\n    const named = (e) => onState(site.id, { title: e.title || \"\" });\n    const pictured = (e) => onState(site.id, { icon: (Array.isArray(e.favicons) ? e.favicons : []).find((u) => /^https:\\/\\//i.test(u)) || \"\" });\n    const events = [\n      [\"dom-ready\", update], [\"did-navigate\", moved], [\"did-navigate-in-page\", update],\n      [\"did-start-loading\", start], [\"did-stop-loading\", stop],\n      [\"page-title-updated\", named], [\"page-favicon-updated\", pictured],\n    ];"],["  external: (<><path d=\"M14 4h6v6\" /><path d=\"M20 4l-9 9\" /><path d=\"M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5\" /></>),\n};\nconst Svg = ({ name }) => (\n  <svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" fill=\"none\" stroke=\"currentColor\"\n       strokeWidth=\"2\" strokeLinecap=\"round\" strokeLinejoin=\"round\" aria-hidden=\"true\">{icons[name]}</svg>\n);","  external: (<><path d=\"M14 4h6v6\" /><path d=\"M20 4l-9 9\" /><path d=\"M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5\" /></>),\n  star: <path d=\"M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z\" />,\n  bookmarks: (<><path d=\"M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z\" /></>),\n  more: (<><circle cx=\"12\" cy=\"5.5\" r=\"1\" /><circle cx=\"12\" cy=\"12\" r=\"1\" /><circle cx=\"12\" cy=\"18.5\" r=\"1\" /></>),\n};\nconst Svg = ({ name, filled = false, size = 16 }) => (\n  <svg viewBox=\"0 0 24 24\" width={size} height={size} fill={filled ? \"currentColor\" : \"none\"} stroke=\"currentColor\"\n       strokeWidth=\"2\" strokeLinecap=\"round\" strokeLinejoin=\"round\" aria-hidden=\"true\">{icons[name]}</svg>\n);"],["  const reload = () => { try { wv?.reload(); } catch {} };\n  const openOutside = () => {","  const reload = () => { try { wv?.reload(); } catch {} };\n\n  // Bookmarks (Browser tab): the star saves the page you're on, the bar lists what you've saved\n  const [bookmarks, setBookmarks] = useState(loadBookmarks);\n  const [barOpen, setBarOpen] = useState(() => { try { return localStorage.getItem(BOOKMARKS_BAR_KEY) !== \"0\"; } catch { return true; } });\n  const [barNote, setBarNote] = useState(\"\");\n  const changeBookmarks = (next) => { setBookmarks(next); saveBookmarks(next); };\n  const showBar = (open) => { setBarOpen(open); try { localStorage.setItem(BOOKMARKS_BAR_KEY, open ? \"1\" : \"0\"); } catch {} };\n  const pageUrl = isBrowser && !showStart && isWebAddress(st.url) ? st.url : \"\";\n  const savedHere = pageUrl ? bookmarks.find((b) => sameAddress(b.url, pageUrl)) : null;\n  const toggleBookmark = () => {\n    if (!pageUrl) return;\n    if (savedHere) { changeBookmarks(bookmarks.filter((b) => b.id !== savedHere.id)); return; }\n    showBar(true);\n    if (bookmarks.length >= MAX_BOOKMARKS) { setBarNote(`You can keep up to ${MAX_BOOKMARKS} bookmarks. Remove one to add another.`); return; }\n    setBarNote(\"\");\n    changeBookmarks([...bookmarks, { id: \"b\" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), url: pageUrl, title: tidyTitle(st.title, pageUrl), icon: st.icon || \"\" }]);\n  };\n  useEffect(() => { if (!barNote) return; const t = setTimeout(() => setBarNote(\"\"), 5000); return () => clearTimeout(t); }, [barNote]);\n\n  const openOutside = () => {"],["        {isBrowser && (\n          <button style={tool} onClick={goHome} title=\"Home\" aria-label=\"Home\"><Svg name=\"home\" /></button>\n        )}","        {isBrowser && (\n          <button style={{ ...tool, opacity: pageUrl ? 1 : 0.4, color: savedHere ? \"var(--ac)\" : \"var(--t2)\" }} onClick={toggleBookmark} disabled={!pageUrl}\n                  aria-pressed={!!savedHere} title={savedHere ? \"Remove this bookmark\" : \"Bookmark this page\"} aria-label={savedHere ? \"Remove this bookmark\" : \"Bookmark this page\"}>\n            <Svg name=\"star\" filled={!!savedHere} />\n          </button>\n        )}\n        {isBrowser && (\n          <button style={{ ...tool, color: barOpen ? \"var(--t1)\" : \"var(--t2)\", background: barOpen ? \"var(--card)\" : \"transparent\" }} onClick={() => showBar(!barOpen)}\n                  aria-pressed={barOpen} title={barOpen ? \"Hide the bookmarks bar\" : \"Show the bookmarks bar\"} aria-label={barOpen ? \"Hide the bookmarks bar\" : \"Show the bookmarks bar\"}>\n            <Svg name=\"bookmarks\" />\n          </button>\n        )}\n        {isBrowser && (\n          <button style={tool} onClick={goHome} title=\"Home\" aria-label=\"Home\"><Svg name=\"home\" /></button>\n        )}"],["      {/* Loading line */}","      <style>{BOOKMARK_CSS}</style>\n      {isBrowser && barOpen && <BookmarkBar items={bookmarks} current={pageUrl} note={barNote} onOpen={openInBrowserTab} onChange={changeBookmarks} />}\n\n      {/* Loading line */}"],["        {showStart && <StartPage onGo={openInBrowserTab} />}","        {showStart && <StartPage onGo={openInBrowserTab} bookmarks={bookmarks} />}"],["function StartPage({ onGo }) {","function StartPage({ onGo, bookmarks = [] }) {"],["      <div style={{ display: \"flex\", gap: 10, flexWrap: \"wrap\", justifyContent: \"center\" }}>\n        {QUICK_LINKS.map((l) => (","      {bookmarks.length > 0 && (\n        <div aria-label=\"Your bookmarks\" style={{ display: \"flex\", gap: 10, flexWrap: \"wrap\", justifyContent: \"center\", maxWidth: 760 }}>\n          {bookmarks.slice(0, 12).map((b) => (\n            <button key={b.id} onClick={() => onGo(b.url)} title={b.url}\n              style={{\n                display: \"flex\", alignItems: \"center\", gap: 8, maxWidth: 200,\n                background: \"var(--card)\", border: \"1px solid var(--border)\", color: \"var(--t1)\", borderRadius: 999,\n                padding: \"8px 16px 8px 10px\", fontSize: 13, fontWeight: 600, cursor: \"pointer\", fontFamily: \"DM Sans, sans-serif\",\n              }}>\n              <BookmarkIcon item={b} />\n              <span style={{ overflow: \"hidden\", textOverflow: \"ellipsis\", whiteSpace: \"nowrap\" }}>{b.title}</span>\n            </button>\n          ))}\n        </div>\n      )}\n      <div style={{ display: \"flex\", gap: 10, flexWrap: \"wrap\", justifyContent: \"center\" }}>\n        {QUICK_LINKS.map((l) => ("]],"append":"\n// ── Bookmarks bar ────────────────────────────────────────────────────────────\n// Added by aura-bookmarks-setup.cjs.\nconst BOOKMARK_CSS = `\n.bmk-bar{display:flex;align-items:center;gap:2px;padding:5px 12px;min-height:38px;border-bottom:1px solid var(--border);background:var(--panel);flex-shrink:0;overflow-x:auto;font-family:'DM Sans',sans-serif}\n.bmk-bar::-webkit-scrollbar{height:4px}\n.bmk-bar::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}\n.bmk-chip{position:relative;display:flex;align-items:center;flex-shrink:0;border-radius:8px}\n.bmk-chip:hover,.bmk-chip:focus-within,.bmk-chip.on{background:var(--card)}\n.bmk-go{display:flex;align-items:center;gap:7px;max-width:190px;padding:5px 4px 5px 8px;border:0;background:transparent;color:var(--t1);font:600 12.5px 'DM Sans',sans-serif;cursor:pointer;border-radius:8px}\n.bmk-go .bmk-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.bmk-chip.here .bmk-go{color:var(--ac)}\n.bmk-more{display:grid;place-items:center;width:20px;height:26px;margin-right:2px;border:0;border-radius:6px;background:transparent;color:var(--t2);cursor:pointer;opacity:0}\n.bmk-chip:hover .bmk-more,.bmk-chip:focus-within .bmk-more,.bmk-chip.on .bmk-more{opacity:1}\n.bmk-more:hover{color:var(--t1)}\n.bmk-go:focus-visible,.bmk-more:focus-visible,.bmk-menu button:focus-visible,.bmk-menu input:focus-visible{outline:2px solid var(--ac);outline-offset:1px}\n.bmk-hint{padding:0 8px;font-size:12.5px;color:var(--t2);white-space:nowrap}\n.bmk-ico{width:16px;height:16px;flex-shrink:0;border-radius:4px;display:grid;place-items:center;font:700 10px 'DM Sans',sans-serif;color:#fff;background:var(--ac);object-fit:contain}\nimg.bmk-ico{background:transparent}\n.bmk-menu{position:fixed;z-index:9200;min-width:190px;padding:6px;border-radius:10px;background:var(--panel);border:1px solid var(--border);box-shadow:0 14px 40px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:2px;font-family:'DM Sans',sans-serif}\n.bmk-menu button{padding:8px 10px;border:0;border-radius:7px;background:transparent;color:var(--t1);font:500 13px 'DM Sans',sans-serif;text-align:left;cursor:pointer}\n.bmk-menu button:hover:not(:disabled){background:var(--card)}\n.bmk-menu button:disabled{opacity:.4;cursor:default}\n.bmk-menu button.danger{color:#ff8a8a}\n.bmk-menu form{display:flex;flex-direction:column;gap:8px;padding:4px}\n.bmk-menu label{font-size:12px;font-weight:600;color:var(--t2)}\n.bmk-menu input{padding:8px 10px;border-radius:7px;border:1px solid var(--border);background:var(--card);color:var(--t1);font:13px 'DM Sans',sans-serif;outline:none;width:230px}\n.bmk-menu .row{display:flex;justify-content:flex-end;gap:6px}\n.bmk-menu .row button{text-align:center;padding:7px 14px;font-weight:600}\n.bmk-menu .row button.go{background:var(--ac);color:#fff}\n`;\n\n// A site's own little icon, or its first letter when it has none (or it won't load)\nfunction BookmarkIcon({ item }) {\n  const [broken, setBroken] = useState(false);\n  useEffect(() => { setBroken(false); }, [item.icon]);\n  if (item.icon && !broken) return <img className=\"bmk-ico\" src={item.icon} alt=\"\" onError={() => setBroken(true)} />;\n  return <span className=\"bmk-ico\" aria-hidden=\"true\">{(siteName(item.url)[0] || \"?\").toUpperCase()}</span>;\n}\n\nfunction BookmarkBar({ items, current, note, onOpen, onChange }) {\n  const [menu, setMenu] = useState(null);       // { id, x, y, renaming }\n  const [name, setName] = useState(\"\");\n  const box = useRef(null);\n  useEffect(() => {\n    if (!menu) return;\n    const away = (e) => { if (box.current && !box.current.contains(e.target)) setMenu(null); };\n    const esc = (e) => { if (e.key === \"Escape\") setMenu(null); };\n    const gone = () => setMenu(null);\n    document.addEventListener(\"mousedown\", away);\n    document.addEventListener(\"keydown\", esc);\n    window.addEventListener(\"resize\", gone);\n    // Clicking into the web page itself doesn't reach this window as a click, but focus moves there\n    window.addEventListener(\"blur\", gone);\n    document.addEventListener(\"focusin\", away);\n    return () => { document.removeEventListener(\"mousedown\", away); document.removeEventListener(\"keydown\", esc); window.removeEventListener(\"resize\", gone); window.removeEventListener(\"blur\", gone); document.removeEventListener(\"focusin\", away); };\n  }, [menu]);\n  const openMenu = (e, item) => {\n    e.preventDefault();\n    const r = e.currentTarget.closest(\".bmk-chip\").getBoundingClientRect();\n    setMenu({ id: item.id, x: Math.max(8, Math.min(r.left, window.innerWidth - 270)), y: r.bottom + 4, renaming: false });\n    setName(item.title);\n  };\n  const at = menu ? items.findIndex((b) => b.id === menu.id) : -1;\n  const chosen = at >= 0 ? items[at] : null;\n  const move = (by) => {\n    const to = at + by;\n    if (to < 0 || to >= items.length) return;\n    const next = [...items];\n    next.splice(to, 0, next.splice(at, 1)[0]);\n    onChange(next);\n  };\n  const rename = (e) => {\n    e.preventDefault();\n    onChange(items.map((b) => (b.id === chosen.id ? { ...b, title: tidyTitle(name, b.url) } : b)));\n    setMenu(null);\n  };\n  return (\n    <div className=\"bmk-bar\" role=\"toolbar\" aria-label=\"Bookmarks\">\n      {items.map((b) => (\n        <div key={b.id} className={`bmk-chip ${sameAddress(b.url, current) ? \"here\" : \"\"} ${menu?.id === b.id ? \"on\" : \"\"}`} onContextMenu={(e) => openMenu(e, b)}>\n          <button type=\"button\" className=\"bmk-go\" onClick={() => onOpen(b.url)} title={b.title + \"\\n\" + b.url}>\n            <BookmarkIcon item={b} /><span className=\"bmk-name\">{b.title}</span>\n          </button>\n          <button type=\"button\" className=\"bmk-more\" onClick={(e) => openMenu(e, b)} aria-label={`Options for ${b.title}`} aria-haspopup=\"menu\" title=\"Rename, move or remove\"><Svg name=\"more\" size={14} /></button>\n        </div>\n      ))}\n      {items.length === 0 && !note && <span className=\"bmk-hint\">No bookmarks yet. Open a page and click the star to keep it here.</span>}\n      {note && <span className=\"bmk-hint\" role=\"status\">{note}</span>}\n      {chosen && (\n        <div className=\"bmk-menu\" ref={box} role=\"menu\" aria-label={`Options for ${chosen.title}`} style={{ left: menu.x, top: menu.y }}>\n          {menu.renaming ? (\n            <form onSubmit={rename}>\n              <label htmlFor=\"bmk-name\">Name</label>\n              <input id=\"bmk-name\" autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} spellCheck={false} />\n              <div className=\"row\"><button type=\"button\" onClick={() => setMenu(null)}>Cancel</button><button type=\"submit\" className=\"go\">Save</button></div>\n            </form>\n          ) : (\n            <>\n              <button type=\"button\" role=\"menuitem\" onClick={() => setMenu({ ...menu, renaming: true })}>Rename</button>\n              <button type=\"button\" role=\"menuitem\" onClick={() => move(-1)} disabled={at === 0}>Move left</button>\n              <button type=\"button\" role=\"menuitem\" onClick={() => move(1)} disabled={at === items.length - 1}>Move right</button>\n              <button type=\"button\" role=\"menuitem\" className=\"danger\" onClick={() => { onChange(items.filter((b) => b.id !== chosen.id)); setMenu(null); }}>Remove</button>\n            </>\n          )}\n        </div>\n      )}\n    </div>\n  );\n}\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-bookmarks.bak";
const MARK = "Added by aura-bookmarks-setup.cjs";
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
function* walk(dir, depth = 0) {
  if (depth > 7) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) yield* walk(full, depth + 1); }
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) { try { if (fs.statSync(full).size < 3 * 1024 * 1024) yield full; } catch {} }
  }
}

function undo() {
  let restored = 0;
  const visit = (dir, depth = 0) => {
    if (depth > 7) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) visit(full, depth + 1); }
      else if (entry.name.endsWith(BAK)) {
        const target = full.slice(0, -BAK.length);
        fs.copyFileSync(full, target); fs.unlinkSync(full);
        say("  restored  " + rel(target)); restored++;
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. The Social page is back to how it was. (Bookmarks you saved stay in AURA's storage and come back if you add this again.)" : "Nothing to undo.");
  say();
}

function run() {
  if (!fs.existsSync(path.join(ROOT, "package.json"))) stop(["This isn't your AURA project folder (no package.json here).", "Move this file next to package.json and run it from there."]);
  if (UNDO) return undo();
  const hits = [];
  for (const file of walk(ROOT)) {
    let text = "";
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    if (/export default function SocialPage\s*\(/.test(text) && /persist:social-/.test(text)) hits.push(file);
  }
  if (!hits.length) stop(["I couldn't find the Social page (src/components/social.jsx).", "Make sure this file is in your AURA project folder, next to package.json.", "Copy this message to Claude."]);
  if (hits.length > 1) stop(["I found more than one file that looks like the Social page:", ...hits.map((h) => "  " + rel(h)), "Copy this message to Claude."]);
  const file = hits[0];
  const raw = fs.readFileSync(file, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n"; // keep Windows line endings as they are
  let text = raw.replace(/\r\n/g, "\n");

  say();
  say(DRY ? "Dry run. This is what would change:" : "AURA: bookmarks for the Browser tab");
  say();
  if (text.includes(MARK)) {
    say("  Social:    " + rel(file));
    say("             - already done");
    say();
    return;
  }
  // Every change has to fit, or none is made. Each one replaces a piece of the page that must be there exactly once.
  const missing = [];
  CHANGES.edits.forEach(([find], i) => { const n = text.split(find).length - 1; if (n !== 1) missing.push({ i, n, line: find.split("\n").find((l) => l.trim()) || "" }); });
  if (missing.length) {
    stop([
      "Your Social page (" + rel(file) + ") isn't quite the copy these changes were made for.",
      ...missing.map((m) => "  piece " + (m.i + 1) + " was found " + m.n + " times: " + m.line.trim().slice(0, 90)),
      "Send Claude the file again along with this message.",
    ]);
  }
  for (const [find, put] of CHANGES.edits) text = text.replace(find, () => put);
  text = text.replace(/\n*$/, "\n") + CHANGES.append;
  if (!DRY) {
    const bak = file + BAK;
    if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
    fs.writeFileSync(file, eol === "\n" ? text : text.replace(/\n/g, eol));
  }
  say("  Social:    " + rel(file));
  say("             - a star beside the address bar saves the page you're on");
  say("             - a bookmarks bar under the toolbar, with a button to hide it");
  say("             - your bookmarks show on the Browser tab's start page");
  say();
  if (DRY) { say("Run it again without --dry-run to apply."); say(); return; }
  say("Done. Start AURA, open Social, choose the Browser tab, open a page and click the star.");
  say("To undo later:  node aura-bookmarks-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
