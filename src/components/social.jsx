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

// ── Pop-out video (Browser tab) ───────────────────────────────────────────────
// Added by aura-video-popout-setup.cjs.
// When a video with sound is playing in the Browser tab and you go somewhere else in AURA, the
// video pops out into the browser's own picture-in-picture window (the same one Chrome and Edge
// have), so it keeps playing where you can see it. Coming back puts it back in the page.
//
// These three snippets are everything AURA runs in the page. They ask the browser to show the
// video in its own window, to put it back, or where it is now. The page itself is left exactly
// as it is: nothing is hidden, blocked, muted or changed, and ads play as they normally would.
// A video that says it must not be popped out is left alone.
const POPOUT_KEY = "aura_video_popout";
const POP_OUT = `(async () => {
  try {
    if (!document.pictureInPictureEnabled) return "unsupported";
    if (document.pictureInPictureElement) return "out";
    const playing = [...document.querySelectorAll("video")].filter((v) => !v.paused && !v.ended && v.readyState > 2 && !v.muted && v.volume > 0 && !v.disablePictureInPicture);
    playing.sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight);
    if (!playing.length) return "none";
    await playing[0].requestPictureInPicture();
    return "out";
  } catch (e) { return "failed"; }
})()`;
const POP_IN = `(async () => { try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); } catch (e) {} return "in"; })()`;
// "out" = in its own window, "page" = playing in the page, "idle" = not playing
const POP_WHERE = `(() => {
  if (document.pictureInPictureElement) return "out";
  return [...document.querySelectorAll("video")].some((v) => !v.paused && !v.ended && !v.muted && v.volume > 0) ? "page" : "idle";
})()`;

// ── Homepage and "where you were" (Browser tab) ───────────────────────────────
// Added by aura-browser-home-setup.cjs. Both are kept on this PC, in AURA's own storage.
//   homepage:   the page the Home button opens. Right-click the Home button to choose it.
//               With none chosen, Home shows AURA's start page.
//   last page:  the page you were on, so the Browser tab opens there next time.
// Only ordinary https pages are ever kept or reopened.
const HOMEPAGE_KEY = "aura_browser_home";
const LASTPAGE_KEY = "aura_browser_last";
const HTTPS_PAGE = /^https:\/\/[^\s]{1,1990}$/i;
const savedPage = (key) => { try { const v = localStorage.getItem(key) || ""; return HTTPS_PAGE.test(v) ? v : ""; } catch { return ""; } };

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

// ── Browser tabs ──────────────────────────────────────────────────────────────
// Added by aura-browser-tabs-setup.cjs.
// The Browser has tabs, like Chrome or Edge: + (or Ctrl+T) for a new tab, the x (or Ctrl+W, or a
// middle-click) to close one, Ctrl+Tab and Ctrl+Shift+Tab to switch. A link that opens a new tab
// or window opens as a tab here. The open tabs are kept on this PC, in AURA's own storage, and come
// back next time (only ordinary https pages are kept; a tab on the start page stays one).
// All tabs share one set of sign-ins, as tabs in a browser do.
const TABS_KEY = "aura_browser_tabs";
const MAX_TABS = 10;
const BROWSER_PARTITION = "persist:social-browser";
const newTabId = () => "tab-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const blankTab = (url = "") => ({ id: newTabId(), url: url || "about:blank", start: !url, title: "", icon: "" });
const safeIcon = (v) => (typeof v === "string" && /^https:\/\//i.test(v) && v.length <= 2000 ? v : "");
function loadTabs() {
  try {
    const saved = JSON.parse(localStorage.getItem(TABS_KEY) || "null");
    if (saved && Array.isArray(saved.tabs) && saved.tabs.length) {
      const tabs = saved.tabs.slice(0, MAX_TABS).map((t) => {
        const url = HTTPS_PAGE.test((t && t.url) || "") ? t.url : "";
        return { ...blankTab(url), title: url && typeof t.title === "string" ? t.title.slice(0, 80) : "", icon: url ? safeIcon(t.icon) : "" };
      });
      const at = Math.min(Math.max(0, Math.floor(Number(saved.active)) || 0), tabs.length - 1);
      return { tabs, active: tabs[at].id };
    }
  } catch {}
  // The first time: one tab, where the Browser was last (or the homepage, or the start page)
  const tab = blankTab(savedPage(LASTPAGE_KEY) || savedPage(HOMEPAGE_KEY));
  return { tabs: [tab], active: tab.id };
}

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
    // The page's name and little icon, used for its tab and when it is bookmarked
    const moved = () => { onState(site.id, { icon: "" }); update(); }; // a new page: the old icon no longer applies
    const named = (e) => onState(site.id, { title: e.title || "" });
    const pictured = (e) => onState(site.id, { icon: (Array.isArray(e.favicons) ? e.favicons : []).find((u) => /^https:\/\//i.test(u)) || "" });
    // A plain http page (some links open one) starts once the tab is ready: tabs open on https pages only
    let later = /^http:\/\//i.test(site.url || "") ? site.url : "";
    const ready = () => { if (later) { const u = later; later = ""; try { wv.loadURL(u); } catch {} } update(); };
    const events = [
      ["dom-ready", ready], ["did-navigate", moved], ["did-navigate-in-page", update],
      ["did-start-loading", start], ["did-stop-loading", stop],
      ["page-title-updated", named], ["page-favicon-updated", pictured],
    ];
    events.forEach(([e, f]) => wv.addEventListener(e, f));
    // The blank page can be ready before this runs; then start the real page now
    if (later) { try { wv.getURL(); ready(); } catch {} }
    return () => { events.forEach(([e, f]) => wv.removeEventListener(e, f)); register(site.id, null); };
  }, []);

  return (
    <webview
      ref={ref}
      src={/^http:\/\//i.test(site.url || "") ? "about:blank" : site.url}
      partition={site.partition || `persist:social-${site.id}`}
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
  popout: (<><rect x="3" y="5" width="18" height="14" rx="2" /><rect x="12.5" y="12" width="6" height="4.5" rx="1" fill="currentColor" stroke="none" /></>),
  plus: (<><path d="M12 5v14" /><path d="M5 12h14" /></>),
  close: (<><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>),
};
const Svg = ({ name, filled = false, size = 16 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill={filled ? "currentColor" : "none"} stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>
);

export default function SocialPage({ visible = true, onShow }) {
  const isElectron = !!window.electronAPI?.isElectron;
  const [active, setActive] = useState(() => {
    try { return localStorage.getItem("aura_social_tab") || "instagram"; } catch { return "instagram"; }
  });
  const [opened, setOpened] = useState(() => new Set());
  const [states, setStates] = useState({});
  const views = useRef({});

  // Browser tabs: { tabs: [{ id, url (what it first opened), start (showing the start page), title, icon }], active }
  const [browser, setBrowser] = useState(loadTabs);
  const browserRef = useRef(browser);
  browserRef.current = browser;
  const tabs = browser.tabs;
  const tabId = browser.active;
  const tab = tabs.find((t) => t.id === tabId) || tabs[0];
  const isBrowser = active === "browser";
  const key = isBrowser ? tabId : active; // the page the toolbar is working on

  // Only load a page the first time it is actually shown
  useEffect(() => {
    if (visible) setOpened((s) => (s.has(key) ? s : new Set(s).add(key)));
  }, [visible, key]);

  const choose = (id) => {
    setActive(id);
    try { localStorage.setItem("aura_social_tab", id); } catch {}
  };
  const onState = useCallback((id, patch) => setStates((s) => ({ ...s, [id]: { ...s[id], ...patch } })), []);
  const register = useCallback((id, wv) => { if (wv) views.current[id] = wv; else delete views.current[id]; }, []);
  const setTab = (id, patch) => setBrowser((b) => ({ ...b, tabs: b.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));

  const st = states[key] || {};
  const wv = views.current[key];
  const back = () => { try { if (wv?.canGoBack()) wv.goBack(); } catch {} };
  const forward = () => { try { if (wv?.canGoForward()) wv.goForward(); } catch {} };
  const [homepage, setHomepage] = useState(() => savedPage(HOMEPAGE_KEY));
  const [homeMenu, setHomeMenu] = useState(null);
  const showStart = isBrowser && !!tab?.start;

  // A tab that goes to a new page is no longer on the start page
  const seenUrl = useRef({});
  useEffect(() => {
    const moved = [];
    for (const t of tabs) {
      const u = states[t.id]?.url;
      if (u && u !== seenUrl.current[t.id]) { seenUrl.current[t.id] = u; if (u !== "about:blank") moved.push(t.id); }
    }
    if (moved.some((id) => tabs.find((t) => t.id === id)?.start)) {
      setBrowser((b) => ({ ...b, tabs: b.tabs.map((t) => (moved.includes(t.id) && t.start ? { ...t, start: false } : t)) }));
    }
  }, [states]);
  // Remember the open tabs, and where the one you're on is
  const activeUrl = states[tabId]?.url;
  useEffect(() => { if (HTTPS_PAGE.test(activeUrl || "") && !tab?.start) { try { localStorage.setItem(LASTPAGE_KEY, activeUrl); } catch {} } }, [activeUrl]);
  useEffect(() => {
    const list = tabs.map((t) => {
      if (t.start) return { url: "" };
      const s = states[t.id] || {};
      const url = HTTPS_PAGE.test(s.url || "") ? s.url : HTTPS_PAGE.test(t.url) ? t.url : "";
      return url ? { url, title: tidyTitle(s.title || t.title, url), icon: safeIcon(s.icon || t.icon) } : { url: "" };
    });
    try { localStorage.setItem(TABS_KEY, JSON.stringify({ tabs: list, active: Math.max(0, tabs.findIndex((t) => t.id === tabId)) })); } catch {}
  }, [browser, states]);

  // A short note under the tabs ("You can have up to 10 tabs...")
  const [tabNote, setTabNote] = useState("");
  useEffect(() => { if (!tabNote) return; const t = setTimeout(() => setTabNote(""), 5000); return () => clearTimeout(t); }, [tabNote]);

  // Open a page in the tab you're on
  const openInBrowserTab = (url) => {
    if (!url) return;
    const id = browserRef.current.active;
    const view = views.current[id];
    if (view) { try { view.loadURL(url); } catch { view.src = url; } setTab(id, { start: false }); }
    else { setTab(id, { url, start: false }); setOpened((s) => new Set(s).add(id)); }
    if (HTTPS_PAGE.test(url)) { try { localStorage.setItem(LASTPAGE_KEY, url); } catch {} }
  };
  // Open a new tab next to the one you're on: on the start page, or on a page
  const openNewTab = (url = "", { background = false, fromLink = false } = {}) => {
    const b = browserRef.current;
    if (b.tabs.length >= MAX_TABS) {
      setTabNote(`You can have up to ${MAX_TABS} tabs. Close one to open another.`);
      if (url && !background) openInBrowserTab(url); // a link still opens, in this tab
      return;
    }
    const t = blankTab(url);
    const next = [...b.tabs];
    if (fromLink) {
      // Like Chrome: a tab opened from a link goes next to its page, after others opened from it
      const at = b.tabs.findIndex((x) => x.id === b.active);
      next.splice(at + 1 + b.tabs.slice(at + 1).filter((x) => x.opener === b.active).length, 0, { ...t, opener: b.active });
    } else next.push(t); // + and Ctrl+T add a tab at the end
    setBrowser({ tabs: next, active: background ? b.active : t.id });
    if (url) setOpened((s) => new Set(s).add(t.id)); // pages in new tabs start loading straight away
    if (!background) choose("browser");
  };
  const selectTab = (id) => { setBrowser((b) => (b.tabs.some((t) => t.id === id) ? { ...b, active: id } : b)); };
  const closeTab = (id) => {
    const b = browserRef.current;
    const at = b.tabs.findIndex((t) => t.id === id);
    if (at < 0) return;
    if (b.tabs.length === 1) {
      const t = blankTab(); // closing the last tab leaves a fresh start page
      setBrowser({ tabs: [t], active: t.id });
      try { localStorage.removeItem(LASTPAGE_KEY); } catch {}
    } else {
      const rest = b.tabs.filter((t) => t.id !== id);
      const closing = b.tabs[at];
      const back = closing.opener && rest.find((t) => t.id === closing.opener);
      const nextActive = b.active !== id ? b.active : (back || rest[at] || rest[at - 1]).id;
      setBrowser({ tabs: rest.map((t) => (t.opener === id ? { ...t, opener: undefined } : t)), active: nextActive });
    }
    delete views.current[id];
    delete seenUrl.current[id];
    setStates((s) => { if (!s[id]) return s; const n = { ...s }; delete n[id]; return n; });
    setOpened((s) => { if (!s.has(id)) return s; const n = new Set(s); n.delete(id); return n; });
    if (popTab.current === id) { popTab.current = null; setPopped(false); }
  };
  const cycleTab = (by) => {
    const b = browserRef.current;
    const at = b.tabs.findIndex((t) => t.id === b.active);
    selectTab(b.tabs[(at + by + b.tabs.length) % b.tabs.length].id);
  };
  // Ctrl+T, Ctrl+W, Ctrl+Tab and Ctrl+Shift+Tab: from AURA's toolbar, or from inside a page
  const tabKey = (what) => {
    if (!visibleRef.current || activeRef.current !== "browser") return false;
    if (what === "new") openNewTab();
    else if (what === "close") closeTab(browserRef.current.active);
    else if (what === "next") cycleTab(1);
    else if (what === "previous") cycleTab(-1);
    else return false;
    return true;
  };
  const visibleRef = useRef(visible); visibleRef.current = visible;
  const activeRef = useRef(active); activeRef.current = active;
  const actions = useRef({});
  actions.current = { openNewTab, tabKey };
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = String(e.key).toLowerCase();
      const what = k === "t" ? "new" : k === "w" ? "close" : k === "tab" ? (e.shiftKey ? "previous" : "next") : null;
      if (what && actions.current.tabKey(what)) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("keydown", onKey, true);
    const offOpen = window.electronAPI?.onBrowserOpenTab?.((d) => { if (d && isWebAddress(d.url)) actions.current.openNewTab(d.url, { background: !!d.background, fromLink: true }); });
    const offKey = window.electronAPI?.onBrowserTabKey?.((what) => actions.current.tabKey(what));
    return () => { window.removeEventListener("keydown", onKey, true); if (typeof offOpen === "function") offOpen(); if (typeof offKey === "function") offKey(); };
  }, []);

  const goHome = () => {
    if (isBrowser) {
      if (homepage) { openInBrowserTab(homepage); return; }
      openStartPage();
      return;
    }
    try { wv?.loadURL(SITES.find((s) => s.id === active).url); } catch {}
  };

  // Address bar (Browser)
  const [addr, setAddr] = useState(null); // null = show the page's URL
  useEffect(() => { setAddr(null); }, [key, st.url, showStart]);
  const go = (e) => {
    e.preventDefault();
    const url = toUrl(addr ?? (showStart ? "" : st.url) ?? "");
    if (url) openInBrowserTab(url);
    setAddr(null);
    e.target.querySelector("input")?.blur();
  };
  const reload = () => { try { if (!showStart) wv?.reload(); } catch {} };

  // Pop-out video (see POP_OUT at the top). "Showing" means a Browser tab's page is on screen.
  const [popOut, setPopOut] = useState(() => { try { return localStorage.getItem(POPOUT_KEY) !== "0"; } catch { return true; } });
  const [popped, setPopped] = useState(false);
  const browserShowing = visible && isBrowser && !showStart;
  const shownTab = useRef(null); // the tab whose page was on screen last
  const popTab = useRef(null);   // the tab whose video is popped out
  if (browserShowing) shownTab.current = tabId;
  const wasShowing = useRef(browserShowing);
  const inPage = (code, asUser = false, id = popTab.current || shownTab.current) => {
    const view = id ? views.current[id] : null;
    try { return view ? Promise.resolve(view.executeJavaScript(code, asUser)).catch(() => "") : Promise.resolve(""); } catch { return Promise.resolve(""); }
  };
  useEffect(() => {
    const before = wasShowing.current;
    wasShowing.current = browserShowing;
    if (before === browserShowing) return;
    if (browserShowing) {
      setPopped(false);
      if (popTab.current) inPage(POP_IN, false, popTab.current);
      popTab.current = null;
      return;
    }
    if (!popOut) return;
    const id = shownTab.current;
    let sound = false;
    try { sound = !!(id && views.current[id]?.isCurrentlyAudible()); } catch {}
    // Leaving the page counts as asking for it: browsers only open that window on a person's say-so
    if (sound) inPage(POP_OUT, true, id).then((where) => {
      if (where !== "out") return;
      if (wasShowing.current) { inPage(POP_IN, false, id); return; } // you were already back before it opened
      popTab.current = id;
      setPopped(true);
    });
  }, [browserShowing]);
  // While it's out, notice when it comes back. "Back to tab" on the small window means "show me
  // the page", so AURA opens it. Closing the small window stops the video, and nothing else happens.
  useEffect(() => {
    if (!popped) return;
    const timer = setInterval(() => {
      const id = popTab.current;
      inPage(POP_WHERE, false, id).then((where) => {
        if (where === "out" || wasShowing.current) return;
        setPopped(false);
        popTab.current = null;
        if (where === "page" && id) { selectTab(id); setTab(id, { start: false }); choose("browser"); onShow?.(); }
      });
    }, 1500);
    return () => clearInterval(timer);
  }, [popped]);
  const togglePopOut = () => {
    const next = !popOut;
    setPopOut(next);
    try { localStorage.setItem(POPOUT_KEY, next ? "1" : "0"); } catch {}
  };

  // Bookmarks (Browser): the star saves the page you're on, the bar lists what you've saved
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

  // Homepage (Browser): right-click the Home button to choose
  const openStartPage = () => {
    setTab(browserRef.current.active, { start: true });
    try { localStorage.removeItem(LASTPAGE_KEY); } catch {} // you chose the start page, so that is where you are
    setHomeMenu(null);
  };
  const chooseHomepage = (url) => {
    const next = HTTPS_PAGE.test(url || "") ? url : "";
    setHomepage(next);
    try { if (next) localStorage.setItem(HOMEPAGE_KEY, next); else localStorage.removeItem(HOMEPAGE_KEY); } catch {}
    setHomeMenu(null);
  };
  useEffect(() => {
    if (!homeMenu) return;
    const onKey = (e) => { if (e.key === "Escape") setHomeMenu(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [homeMenu]);

  const openOutside = () => {
    const url = showStart ? "" : st.url || SITES.find((s) => s.id === active)?.url;
    if (url && url !== "about:blank") window.electronAPI?.openExternal?.(url);
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
        <button style={{ ...tool, opacity: st.canGoBack && !showStart ? 1 : 0.4 }} onClick={back} disabled={!st.canGoBack || showStart}
                title="Back" aria-label="Back"><Svg name="back" /></button>
        {isBrowser && (
          <button style={{ ...tool, opacity: st.canGoForward && !showStart ? 1 : 0.4 }} onClick={forward} disabled={!st.canGoForward || showStart}
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
          <button className="home-btn" style={{ ...tool, color: homepage ? "var(--t1)" : "var(--t2)" }} onClick={goHome} aria-label="Home" aria-haspopup="menu"
                  onContextMenu={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setHomeMenu({ right: Math.max(8, window.innerWidth - r.right), top: r.bottom + 6 }); }}
                  title={homepage ? "Home: " + siteName(homepage) + " (right-click to change)" : "Home (right-click to choose your homepage)"}><Svg name="home" /></button>
        )}
        {isBrowser && (
          <button className="popout-toggle" style={{ ...tool, color: popOut ? "var(--ac)" : "var(--t2)", background: popOut ? "var(--card)" : "transparent" }} onClick={togglePopOut} aria-pressed={popOut}
                  title={popOut ? "On: a video playing here pops out into a small window when you go to another page. Click to turn off." : "Off: videos stay in the page when you go to another page. Click to pop them out into a small window."}
                  aria-label="Pop videos out when you leave this page">
            <Svg name="popout" />
          </button>
        )}
        <button style={tool} onClick={reload} title="Reload" aria-label="Reload"><Svg name="reload" /></button>
        <button style={tool} onClick={openOutside} title="Open in your browser" aria-label="Open in your browser">
          <Svg name="external" />
        </button>
      </div>

      {homeMenu && (
        <>
          <div onClick={() => setHomeMenu(null)} onContextMenu={(e) => { e.preventDefault(); setHomeMenu(null); }} style={{ position: "fixed", inset: 0, zIndex: 9199 }} />
          <div className="bmk-menu home-menu" role="menu" aria-label="Homepage" style={{ right: homeMenu.right, top: homeMenu.top }}>
            <button role="menuitem" disabled={!HTTPS_PAGE.test(pageUrl)} onClick={() => chooseHomepage(pageUrl)}>Make this page my homepage</button>
            {homepage && <button role="menuitem" onClick={() => chooseHomepage("")}>Use AURA's start page instead</button>}
            <button role="menuitem" onClick={openStartPage}>Open the start page</button>
          </div>
        </>
      )}
      <style>{BOOKMARK_CSS + TABS_CSS}</style>
      {isBrowser && (
        <TabStrip tabs={tabs} active={tabId} states={states} note={tabNote}
                  onSelect={selectTab} onClose={closeTab} onNew={() => openNewTab()} />
      )}
      {isBrowser && barOpen && <BookmarkBar items={bookmarks} current={pageUrl} note={barNote} onOpen={openInBrowserTab} onOpenNew={(url) => openNewTab(url, { background: true })} onChange={changeBookmarks} />}

      {/* Loading line */}
      <div style={{ height: 2, flexShrink: 0, background: st.loading && !showStart ? "var(--ac)" : "transparent", transition: "background .2s" }} />

      {/* Pages (kept alive once opened so switching is instant) */}
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {SITES.filter((s) => s.id !== "browser" && opened.has(s.id)).map((s) => (
          <SiteView key={s.id} site={s} active={s.id === active} onState={onState} register={register} />
        ))}
        {tabs.filter((t) => opened.has(t.id)).map((t) => (
          <SiteView key={t.id} site={{ id: t.id, url: t.url, partition: BROWSER_PARTITION }} active={isBrowser && t.id === tabId && !t.start} onState={onState} register={register} />
        ))}
        {showStart && <StartPage key={tabId} onGo={openInBrowserTab} bookmarks={bookmarks} />}
      </div>
    </div>
  );
}

// ── Tab strip (Browser) ───────────────────────────────────────────────────────
const TABS_CSS = `
.btab-strip{position:relative;display:flex;align-items:center;gap:4px;padding:6px 12px 0;min-height:40px;background:var(--panel);border-bottom:1px solid var(--border);flex-shrink:0;font-family:'DM Sans',sans-serif}
.btab{position:relative;display:flex;align-items:center;flex:0 1 200px;min-width:0;overflow:hidden;height:34px;border-radius:9px 9px 0 0;color:var(--t2)}
.btab:hover{background:color-mix(in srgb,var(--card) 55%,transparent);color:var(--t1)}
.btab.on{background:var(--card);color:var(--t1);box-shadow:inset 0 2px 0 var(--ac)}
.btab-go{flex:1;min-width:0;display:flex;align-items:center;gap:8px;height:100%;padding:0 4px 0 11px;border:0;background:transparent;color:inherit;font:600 12.5px 'DM Sans',sans-serif;cursor:pointer;text-align:left;border-radius:9px 0 0 0}
.btab-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.btab-x{display:grid;place-items:center;flex-shrink:0;width:22px;height:22px;margin-right:6px;border:0;border-radius:6px;background:transparent;color:var(--t2);cursor:pointer;opacity:0}
.btab:hover .btab-x,.btab.on .btab-x,.btab:focus-within .btab-x{opacity:1}
.btab-x:hover{background:var(--border);color:var(--t1)}
.btab-new{display:grid;place-items:center;flex-shrink:0;width:30px;height:30px;margin:0 0 2px 2px;border:0;border-radius:8px;background:transparent;color:var(--t2);cursor:pointer}
.btab-new:hover:not(:disabled){background:var(--card);color:var(--t1)}
.btab-new:disabled{opacity:.35;cursor:default}
.btab-go:focus-visible,.btab-x:focus-visible,.btab-new:focus-visible{outline:2px solid var(--ac);outline-offset:-2px}
.btab-spin{width:14px;height:14px;flex-shrink:0;border-radius:50%;border:2px solid var(--border);border-top-color:var(--ac);animation:btab-spin .8s linear infinite}
.btab-new-ico{width:16px;height:16px;flex-shrink:0;border-radius:5px;background:linear-gradient(135deg,var(--ac),var(--ac2))}
.btab-note{position:absolute;right:12px;top:calc(100% + 6px);z-index:30;padding:8px 12px;border-radius:8px;background:var(--panel);border:1px solid var(--border);box-shadow:0 10px 30px rgba(0,0,0,.45);font-size:12.5px;color:var(--t1);white-space:nowrap}
@keyframes btab-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.btab-spin{animation:none}}
`;

function TabStrip({ tabs, active, states, note, onSelect, onClose, onNew }) {
  const full = tabs.length >= MAX_TABS;
  return (
    <div className="btab-strip">
      <div role="tablist" aria-label="Browser tabs" style={{ display: "contents" }}>
        {tabs.map((t) => {
          const s = states[t.id] || {};
          const url = t.start ? "" : (s.url && s.url !== "about:blank" ? s.url : t.url !== "about:blank" ? t.url : "");
          const named = s.title && s.title !== "about:blank" ? s.title : t.title;
          const title = t.start ? "New tab" : tidyTitle(named, url || "New tab");
          const on = t.id === active;
          return (
            <div key={t.id} className={`btab ${on ? "on" : ""}`}
                 onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
                 onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose(t.id); } }}>
              <button type="button" role="tab" aria-selected={on} className="btab-go" onClick={() => onSelect(t.id)}
                      title={url ? title + "\n" + url : title}>
                {s.loading && !t.start ? <span className="btab-spin" aria-hidden="true" />
                  : t.start ? <span className="btab-new-ico" aria-hidden="true" />
                  : <BookmarkIcon item={{ icon: s.icon || t.icon || "", url: url || "https://new" }} />}
                <span className="btab-name">{title}</span>
              </button>
              <button type="button" className="btab-x" onClick={() => onClose(t.id)} aria-label={`Close ${title}`} title="Close tab (Ctrl+W)">
                <Svg name="close" size={13} />
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" className="btab-new" onClick={onNew} disabled={full} aria-label="New tab"
              title={full ? `You can have up to ${MAX_TABS} tabs. Close one to open another.` : "New tab (Ctrl+T)"}>
        <Svg name="plus" size={16} />
      </button>
      {note && <span className="btab-note" role="status">{note}</span>}
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
      <div style={{ fontSize: 12, color: "var(--t2)", fontFamily: "DM Sans, sans-serif" }}>Tip: right-click the Home button to choose your homepage.</div>
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

function BookmarkBar({ items, current, note, onOpen, onOpenNew, onChange }) {
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
          <button type="button" className="bmk-go" onClick={() => onOpen(b.url)} title={b.title + "\n" + b.url}
                  onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
                  onAuxClick={(e) => { if (e.button === 1 && onOpenNew) { e.preventDefault(); onOpenNew(b.url); } }}>
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
