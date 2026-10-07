// src/components/social.jsx — Social page: Instagram, X and Facebook inside AURA
import { useCallback, useEffect, useRef, useState } from "react";

// ── Bookmarks (Browser tab) ───────────────────────────────────────────────────
// Added by aura-bookmarks-setup.cjs. Kept on this PC, in AURA's own storage.
const BOOKMARKS_KEY = "aura_bookmarks";
const BOOKMARKS_BAR_KEY = "aura_bookmarks_bar";
const MAX_BOOKMARKS = 60;
const isWebAddress = (v) => typeof v === "string" && v.length <= 2000 && /^https?:\/\/[^\s]+$/i.test(v);
const siteName = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Bookmark"; } };
const tidyTitle = (title, url) => String(title || "").replace(/\s+/g, " ").trim().slice(0, 80) || siteName(url);
const sameAddress = (a, b) => String(a || "").replace(/\/$/, "") === String(b || "").replace(/\/$/, "");
function loadBookmarks() {
  try {
    const list = JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || "[]");
    if (!Array.isArray(list)) return [];
    // Only web addresses are kept, whatever ended up in storage
    return list.filter((b) => b && isWebAddress(b.url)).slice(0, MAX_BOOKMARKS).map((b, i) => ({
      id: typeof b.id === "string" && b.id ? b.id : "b" + i,
      url: b.url,
      title: tidyTitle(b.title, b.url),
      icon: typeof b.icon === "string" && /^https:\/\//i.test(b.icon) && b.icon.length <= 2000 ? b.icon : "",
    }));
  } catch { return []; }
}
function saveBookmarks(list) {
  try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(list)); } catch {}
}

const SITES = [
  { id: "instagram", label: "Instagram", url: "https://www.instagram.com/" },
  { id: "x",         label: "X",         url: "https://x.com/home" },
  { id: "facebook",  label: "Facebook",  url: "https://www.facebook.com/" },
  { id: "browser",   label: "Browser",   url: "about:blank" }, // starts on AURA's start page
];

// Turn what's typed in the address bar into a URL (or a Google search)
function toUrl(text) {
  const t = text.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(t)) return "https://" + t;
  return "https://www.google.com/search?q=" + encodeURIComponent(t);
}

// Present as regular Chrome (drop the "Electron/…" and app-name tokens),
// so the sites don't show an "unsupported browser" page.
const UA = typeof navigator !== "undefined"
  ? navigator.userAgent.replace(/\s(?!Chrome\/|Safari\/|AppleWebKit\/|Mozilla\/)[A-Za-z][\w.-]*\/[\w.-]+/g, "")
  : undefined;

function SiteView({ site, active, onState, register }) {
  const ref = useRef(null);

  useEffect(() => {
    const wv = ref.current;
    if (!wv) return;
    register(site.id, wv);
    const update = () => {
      try { onState(site.id, { canGoBack: wv.canGoBack(), canGoForward: wv.canGoForward(), url: wv.getURL(), title: wv.getTitle() }); } catch {}
    };
    const start = () => onState(site.id, { loading: true });
    const stop = () => { onState(site.id, { loading: false }); update(); };
    // The page's name and little icon, used when it is bookmarked
    const moved = () => { onState(site.id, { icon: "" }); update(); }; // a new page: the old icon no longer applies
    const named = (e) => onState(site.id, { title: e.title || "" });
    const pictured = (e) => onState(site.id, { icon: (Array.isArray(e.favicons) ? e.favicons : []).find((u) => /^https:\/\//i.test(u)) || "" });
    const events = [
      ["dom-ready", update], ["did-navigate", moved], ["did-navigate-in-page", update],
      ["did-start-loading", start], ["did-stop-loading", stop],
      ["page-title-updated", named], ["page-favicon-updated", pictured],
    ];
    events.forEach(([e, f]) => wv.addEventListener(e, f));
    return () => events.forEach(([e, f]) => wv.removeEventListener(e, f));
  }, []);

  return (
    <webview
      ref={ref}
      src={site.url}
      partition={`persist:social-${site.id}`}
      useragent={UA}
      allowpopups="true"
      style={{
        position: "absolute", inset: 0, width: "100%", height: "100%",
        visibility: active ? "visible" : "hidden",
        pointerEvents: active ? "auto" : "none",
      }}
    />
  );
}

const icons = {
  back: <path d="M15 18l-6-6 6-6" />,
  forward: <path d="M9 18l6-6-6-6" />,
  home: (<><path d="M4 11l8-6.5 8 6.5" /><path d="M6.5 9.5V19h11V9.5" /></>),
  reload: (<><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>),
  external: (<><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>),
  star: <path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />,
  bookmarks: (<><path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z" /></>),
  more: (<><circle cx="12" cy="5.5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="18.5" r="1" /></>),
};
const Svg = ({ name, filled = false, size = 16 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill={filled ? "currentColor" : "none"} stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>
);

export default function SocialPage({ visible = true }) {
  const isElectron = !!window.electronAPI?.isElectron;
  const [active, setActive] = useState(() => {
    try { return localStorage.getItem("aura_social_tab") || "instagram"; } catch { return "instagram"; }
  });
  const [opened, setOpened] = useState(() => new Set());
  const [states, setStates] = useState({});
  const views = useRef({});

  // Only load a site the first time its tab is actually shown
  useEffect(() => {
    if (visible) setOpened((s) => (s.has(active) ? s : new Set(s).add(active)));
  }, [visible, active]);

  const choose = (id) => {
    setActive(id);
    try { localStorage.setItem("aura_social_tab", id); } catch {}
  };
  const onState = useCallback((id, patch) => setStates((s) => ({ ...s, [id]: { ...s[id], ...patch } })), []);
  const register = useCallback((id, wv) => { views.current[id] = wv; }, []);

  const st = states[active] || {};
  const wv = views.current[active];
  const back = () => { try { if (wv?.canGoBack()) wv.goBack(); } catch {} };
  const forward = () => { try { if (wv?.canGoForward()) wv.goForward(); } catch {} };
  // Browser tab start page
  const [browserHome, setBrowserHome] = useState(true);
  const browserUrl = states.browser?.url;
  useEffect(() => {
    if (browserUrl && browserUrl !== "about:blank") setBrowserHome(false);
  }, [browserUrl]);
  const openInBrowserTab = (url) => {
    const view = views.current.browser;
    if (!view || !url) return;
    try { view.loadURL(url); } catch { view.src = url; }
    setBrowserHome(false);
  };

  const goHome = () => {
    if (active === "browser") { setBrowserHome(true); return; }
    try { wv?.loadURL(SITES.find((s) => s.id === active).url); } catch {}
  };

  // Address bar (Browser tab)
  const [addr, setAddr] = useState(null); // null = show the page's URL
  useEffect(() => { setAddr(null); }, [active, st.url]);
  const go = (e) => {
    e.preventDefault();
    const url = toUrl(addr ?? (showStart ? "" : st.url) ?? "");
    if (url) openInBrowserTab(url);
    setAddr(null);
    e.target.querySelector("input")?.blur();
  };
  const isBrowser = active === "browser";
  const showStart = isBrowser && (browserHome || !st.url || st.url === "about:blank");
  const reload = () => { try { wv?.reload(); } catch {} };

  // Bookmarks (Browser tab): the star saves the page you're on, the bar lists what you've saved
  const [bookmarks, setBookmarks] = useState(loadBookmarks);
  const [barOpen, setBarOpen] = useState(() => { try { return localStorage.getItem(BOOKMARKS_BAR_KEY) !== "0"; } catch { return true; } });
  const [barNote, setBarNote] = useState("");
  const changeBookmarks = (next) => { setBookmarks(next); saveBookmarks(next); };
  const showBar = (open) => { setBarOpen(open); try { localStorage.setItem(BOOKMARKS_BAR_KEY, open ? "1" : "0"); } catch {} };
  const pageUrl = isBrowser && !showStart && isWebAddress(st.url) ? st.url : "";
  const savedHere = pageUrl ? bookmarks.find((b) => sameAddress(b.url, pageUrl)) : null;
  const toggleBookmark = () => {
    if (!pageUrl) return;
    if (savedHere) { changeBookmarks(bookmarks.filter((b) => b.id !== savedHere.id)); return; }
    showBar(true);
    if (bookmarks.length >= MAX_BOOKMARKS) { setBarNote(`You can keep up to ${MAX_BOOKMARKS} bookmarks. Remove one to add another.`); return; }
    setBarNote("");
    changeBookmarks([...bookmarks, { id: "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), url: pageUrl, title: tidyTitle(st.title, pageUrl), icon: st.icon || "" }]);
  };
  useEffect(() => { if (!barNote) return; const t = setTimeout(() => setBarNote(""), 5000); return () => clearTimeout(t); }, [barNote]);

  const openOutside = () => {
    const url = st.url || SITES.find((s) => s.id === active)?.url;
    window.electronAPI?.openExternal?.(url);
  };

  if (!isElectron) {
    return <div style={{ padding: 28, color: "var(--t2)" }}>The Social page works in the AURA desktop app.</div>;
  }

  const tool = {
    background: "transparent", border: "1px solid var(--border)", color: "var(--t2)",
    borderRadius: 8, width: 34, height: 32, display: "grid", placeItems: "center", cursor: "pointer",
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, background: "var(--bg)" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
                    borderBottom: "1px solid var(--border)", background: "var(--panel)", flexShrink: 0 }}>
        <div role="tablist" aria-label="Social sites" style={{ display: "flex", gap: 4 }}>
          {SITES.map((s) => {
            const on = s.id === active;
            return (
              <button key={s.id} role="tab" aria-selected={on} onClick={() => choose(s.id)}
                style={{
                  border: 0, borderRadius: 8, padding: "7px 16px", cursor: "pointer",
                  fontSize: 13, fontWeight: 700, fontFamily: "DM Sans, sans-serif",
                  background: on ? "var(--ac)" : "transparent", color: on ? "#fff" : "var(--t2)",
                }}>
                {s.label}
              </button>
            );
          })}
        </div>
        <button style={{ ...tool, opacity: st.canGoBack ? 1 : 0.4 }} onClick={back} disabled={!st.canGoBack}
                title="Back" aria-label="Back"><Svg name="back" /></button>
        {isBrowser && (
          <button style={{ ...tool, opacity: st.canGoForward ? 1 : 0.4 }} onClick={forward} disabled={!st.canGoForward}
                  title="Forward" aria-label="Forward"><Svg name="forward" /></button>
        )}
        {isBrowser ? (
          <form onSubmit={go} style={{ flex: 1, display: "flex" }}>
            <input
              value={addr ?? (showStart ? "" : st.url) ?? ""}
              onChange={(e) => setAddr(e.target.value)}
              onFocus={(e) => e.target.select()}
              placeholder="Search Google or type a web address"
              aria-label="Address"
              spellCheck={false}
              style={{
                flex: 1, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8,
                padding: "7px 12px", color: "var(--t1)", fontSize: 13, outline: "none", fontFamily: "DM Sans, sans-serif",
              }}
            />
          </form>
        ) : (
          <div style={{ flex: 1 }} />
        )}
        {isBrowser && (
          <button style={{ ...tool, opacity: pageUrl ? 1 : 0.4, color: savedHere ? "var(--ac)" : "var(--t2)" }} onClick={toggleBookmark} disabled={!pageUrl}
                  aria-pressed={!!savedHere} title={savedHere ? "Remove this bookmark" : "Bookmark this page"} aria-label={savedHere ? "Remove this bookmark" : "Bookmark this page"}>
            <Svg name="star" filled={!!savedHere} />
          </button>
        )}
        {isBrowser && (
          <button style={{ ...tool, color: barOpen ? "var(--t1)" : "var(--t2)", background: barOpen ? "var(--card)" : "transparent" }} onClick={() => showBar(!barOpen)}
                  aria-pressed={barOpen} title={barOpen ? "Hide the bookmarks bar" : "Show the bookmarks bar"} aria-label={barOpen ? "Hide the bookmarks bar" : "Show the bookmarks bar"}>
            <Svg name="bookmarks" />
          </button>
        )}
        {isBrowser && (
          <button style={tool} onClick={goHome} title="Home" aria-label="Home"><Svg name="home" /></button>
        )}
        <button style={tool} onClick={reload} title="Reload" aria-label="Reload"><Svg name="reload" /></button>
        <button style={tool} onClick={openOutside} title="Open in your browser" aria-label="Open in your browser">
          <Svg name="external" />
        </button>
      </div>

      <style>{BOOKMARK_CSS}</style>
      {isBrowser && barOpen && <BookmarkBar items={bookmarks} current={pageUrl} note={barNote} onOpen={openInBrowserTab} onChange={changeBookmarks} />}

      {/* Loading line */}
      <div style={{ height: 2, flexShrink: 0, background: st.loading ? "var(--ac)" : "transparent", transition: "background .2s" }} />

      {/* Sites (kept alive once opened so switching tabs is instant) */}
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {SITES.filter((s) => opened.has(s.id)).map((s) => (
          <SiteView key={s.id} site={s} active={s.id === active} onState={onState} register={register} />
        ))}
        {showStart && <StartPage onGo={openInBrowserTab} bookmarks={bookmarks} />}
      </div>
    </div>
  );
}

// ── Browser start page ───────────────────────────────────────────────────────
const QUICK_LINKS = [
  { label: "YouTube", url: "https://www.youtube.com/" },
  { label: "Twitch", url: "https://www.twitch.tv/" },
  { label: "Reddit", url: "https://www.reddit.com/" },
  { label: "Steam Store", url: "https://store.steampowered.com/" },
];

function StartPage({ onGo, bookmarks = [] }) {
  const [q, setQ] = useState("");
  const submit = (e) => {
    e.preventDefault();
    const url = toUrl(q);
    if (url) onGo(url);
  };
  return (
    <div style={{
      position: "absolute", inset: 0, background: "var(--bg)", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 28, padding: 24,
    }}>
      <div role="img" aria-label="AURA" style={{
        width: 116, height: 116,
        background: "linear-gradient(135deg, var(--ac), var(--ac2))",
        WebkitMaskImage: "url(./aura-mark.png)", maskImage: "url(./aura-mark.png)",
        WebkitMaskSize: "contain", maskSize: "contain",
        WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat",
        WebkitMaskPosition: "center", maskPosition: "center",
        filter: "drop-shadow(0 8px 28px var(--acg))",
      }} />
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 560 }}>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search Google or type a web address"
          aria-label="Search or web address"
          spellCheck={false}
          style={{
            width: "100%", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 999,
            padding: "14px 22px", color: "var(--t1)", fontSize: 15, outline: "none", fontFamily: "DM Sans, sans-serif",
            boxShadow: "0 8px 30px rgba(0,0,0,.35)",
          }}
          onFocus={(e) => { e.target.style.borderColor = "var(--ac)"; }}
          onBlur={(e) => { e.target.style.borderColor = "var(--border)"; }}
        />
      </form>
      {bookmarks.length > 0 && (
        <div aria-label="Your bookmarks" style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", maxWidth: 760 }}>
          {bookmarks.slice(0, 12).map((b) => (
            <button key={b.id} onClick={() => onGo(b.url)} title={b.url}
              style={{
                display: "flex", alignItems: "center", gap: 8, maxWidth: 200,
                background: "var(--card)", border: "1px solid var(--border)", color: "var(--t1)", borderRadius: 999,
                padding: "8px 16px 8px 10px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "DM Sans, sans-serif",
              }}>
              <BookmarkIcon item={b} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.title}</span>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        {QUICK_LINKS.map((l) => (
          <button key={l.label} onClick={() => onGo(l.url)}
            style={{
              background: "var(--card)", border: "1px solid var(--border)", color: "var(--t2)", borderRadius: 999,
              padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "DM Sans, sans-serif",
            }}>
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Bookmarks bar ────────────────────────────────────────────────────────────
// Added by aura-bookmarks-setup.cjs.
const BOOKMARK_CSS = `
.bmk-bar{display:flex;align-items:center;gap:2px;padding:5px 12px;min-height:38px;border-bottom:1px solid var(--border);background:var(--panel);flex-shrink:0;overflow-x:auto;font-family:'DM Sans',sans-serif}
.bmk-bar::-webkit-scrollbar{height:4px}
.bmk-bar::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}
.bmk-chip{position:relative;display:flex;align-items:center;flex-shrink:0;border-radius:8px}
.bmk-chip:hover,.bmk-chip:focus-within,.bmk-chip.on{background:var(--card)}
.bmk-go{display:flex;align-items:center;gap:7px;max-width:190px;padding:5px 4px 5px 8px;border:0;background:transparent;color:var(--t1);font:600 12.5px 'DM Sans',sans-serif;cursor:pointer;border-radius:8px}
.bmk-go .bmk-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bmk-chip.here .bmk-go{color:var(--ac)}
.bmk-more{display:grid;place-items:center;width:20px;height:26px;margin-right:2px;border:0;border-radius:6px;background:transparent;color:var(--t2);cursor:pointer;opacity:0}
.bmk-chip:hover .bmk-more,.bmk-chip:focus-within .bmk-more,.bmk-chip.on .bmk-more{opacity:1}
.bmk-more:hover{color:var(--t1)}
.bmk-go:focus-visible,.bmk-more:focus-visible,.bmk-menu button:focus-visible,.bmk-menu input:focus-visible{outline:2px solid var(--ac);outline-offset:1px}
.bmk-hint{padding:0 8px;font-size:12.5px;color:var(--t2);white-space:nowrap}
.bmk-ico{width:16px;height:16px;flex-shrink:0;border-radius:4px;display:grid;place-items:center;font:700 10px 'DM Sans',sans-serif;color:#fff;background:var(--ac);object-fit:contain}
img.bmk-ico{background:transparent}
.bmk-menu{position:fixed;z-index:9200;min-width:190px;padding:6px;border-radius:10px;background:var(--panel);border:1px solid var(--border);box-shadow:0 14px 40px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:2px;font-family:'DM Sans',sans-serif}
.bmk-menu button{padding:8px 10px;border:0;border-radius:7px;background:transparent;color:var(--t1);font:500 13px 'DM Sans',sans-serif;text-align:left;cursor:pointer}
.bmk-menu button:hover:not(:disabled){background:var(--card)}
.bmk-menu button:disabled{opacity:.4;cursor:default}
.bmk-menu button.danger{color:#ff8a8a}
.bmk-menu form{display:flex;flex-direction:column;gap:8px;padding:4px}
.bmk-menu label{font-size:12px;font-weight:600;color:var(--t2)}
.bmk-menu input{padding:8px 10px;border-radius:7px;border:1px solid var(--border);background:var(--card);color:var(--t1);font:13px 'DM Sans',sans-serif;outline:none;width:230px}
.bmk-menu .row{display:flex;justify-content:flex-end;gap:6px}
.bmk-menu .row button{text-align:center;padding:7px 14px;font-weight:600}
.bmk-menu .row button.go{background:var(--ac);color:#fff}
`;

// A site's own little icon, or its first letter when it has none (or it won't load)
function BookmarkIcon({ item }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [item.icon]);
  if (item.icon && !broken) return <img className="bmk-ico" src={item.icon} alt="" onError={() => setBroken(true)} />;
  return <span className="bmk-ico" aria-hidden="true">{(siteName(item.url)[0] || "?").toUpperCase()}</span>;
}

function BookmarkBar({ items, current, note, onOpen, onChange }) {
  const [menu, setMenu] = useState(null);       // { id, x, y, renaming }
  const [name, setName] = useState("");
  const box = useRef(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setMenu(null); };
    const esc = (e) => { if (e.key === "Escape") setMenu(null); };
    const gone = () => setMenu(null);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", gone);
    // Clicking into the web page itself doesn't reach this window as a click, but focus moves there
    window.addEventListener("blur", gone);
    document.addEventListener("focusin", away);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); window.removeEventListener("resize", gone); window.removeEventListener("blur", gone); document.removeEventListener("focusin", away); };
  }, [menu]);
  const openMenu = (e, item) => {
    e.preventDefault();
    const r = e.currentTarget.closest(".bmk-chip").getBoundingClientRect();
    setMenu({ id: item.id, x: Math.max(8, Math.min(r.left, window.innerWidth - 270)), y: r.bottom + 4, renaming: false });
    setName(item.title);
  };
  const at = menu ? items.findIndex((b) => b.id === menu.id) : -1;
  const chosen = at >= 0 ? items[at] : null;
  const move = (by) => {
    const to = at + by;
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    next.splice(to, 0, next.splice(at, 1)[0]);
    onChange(next);
  };
  const rename = (e) => {
    e.preventDefault();
    onChange(items.map((b) => (b.id === chosen.id ? { ...b, title: tidyTitle(name, b.url) } : b)));
    setMenu(null);
  };
  return (
    <div className="bmk-bar" role="toolbar" aria-label="Bookmarks">
      {items.map((b) => (
        <div key={b.id} className={`bmk-chip ${sameAddress(b.url, current) ? "here" : ""} ${menu?.id === b.id ? "on" : ""}`} onContextMenu={(e) => openMenu(e, b)}>
          <button type="button" className="bmk-go" onClick={() => onOpen(b.url)} title={b.title + "\n" + b.url}>
            <BookmarkIcon item={b} /><span className="bmk-name">{b.title}</span>
          </button>
          <button type="button" className="bmk-more" onClick={(e) => openMenu(e, b)} aria-label={`Options for ${b.title}`} aria-haspopup="menu" title="Rename, move or remove"><Svg name="more" size={14} /></button>
        </div>
      ))}
      {items.length === 0 && !note && <span className="bmk-hint">No bookmarks yet. Open a page and click the star to keep it here.</span>}
      {note && <span className="bmk-hint" role="status">{note}</span>}
      {chosen && (
        <div className="bmk-menu" ref={box} role="menu" aria-label={`Options for ${chosen.title}`} style={{ left: menu.x, top: menu.y }}>
          {menu.renaming ? (
            <form onSubmit={rename}>
              <label htmlFor="bmk-name">Name</label>
              <input id="bmk-name" autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} spellCheck={false} />
              <div className="row"><button type="button" onClick={() => setMenu(null)}>Cancel</button><button type="submit" className="go">Save</button></div>
            </form>
          ) : (
            <>
              <button type="button" role="menuitem" onClick={() => setMenu({ ...menu, renaming: true })}>Rename</button>
              <button type="button" role="menuitem" onClick={() => move(-1)} disabled={at === 0}>Move left</button>
              <button type="button" role="menuitem" onClick={() => move(1)} disabled={at === items.length - 1}>Move right</button>
              <button type="button" role="menuitem" className="danger" onClick={() => { onChange(items.filter((b) => b.id !== chosen.id)); setMenu(null); }}>Remove</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
