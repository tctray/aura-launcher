#!/usr/bin/env node
/**
 * AURA — tabs in the Browser
 *
 * The Browser on the Social page gets tabs, like Chrome or Edge:
 *   - + (or Ctrl+T) opens a new tab on AURA's start page
 *   - the x on a tab (or Ctrl+W, or a middle-click on the tab) closes it
 *   - Ctrl+Tab and Ctrl+Shift+Tab switch tabs
 *   - a link that opens a new tab or window opens as a new tab next to its page;
 *     a middle-clicked link opens in the background, like in Chrome
 *   - middle-click a bookmark to open it in a new tab
 *   - each tab shows its page's icon and name, and a spinner while it loads
 *   - your open tabs come back next time you open AURA (only https pages; the rest come
 *     back as the start page). Only the tab you're on loads straight away.
 *   - up to 10 tabs, so the Browser can't slow your games down
 * All tabs share the Browser's sign-ins, as tabs in a browser do. Instagram, X and Facebook
 * stay as they are.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-browser-tabs-setup.cjs
 *
 * What it does:
 *   - edits    src/components/social.jsx   the tabs
 *   - edits    electron/main.js            links and Ctrl+T/W/Tab inside a page reach the tabs
 *   - edits    electron/preload.js         lets the window hear them
 *   - creates  tests/browser-tabs.cjs      (only if AURA's checks are installed) checks it
 *
 * Every file it changes is copied to <name>.before-browser-tabs.bak first.
 * To put everything back:                 node aura-browser-tabs-setup.cjs --undo
 * To preview without changing anything:   node aura-browser-tabs-setup.cjs --dry-run
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FILES = {"social":"// ── Browser tabs ──────────────────────────────────────────────────────────────\n// Added by aura-browser-tabs-setup.cjs.\n// The Browser has tabs, like Chrome or Edge: + (or Ctrl+T) for a new tab, the x (or Ctrl+W, or a\n// middle-click) to close one, Ctrl+Tab and Ctrl+Shift+Tab to switch. A link that opens a new tab\n// or window opens as a tab here. The open tabs are kept on this PC, in AURA's own storage, and come\n// back next time (only ordinary https pages are kept; a tab on the start page stays one).\n// All tabs share one set of sign-ins, as tabs in a browser do.\nconst TABS_KEY = \"aura_browser_tabs\";\nconst MAX_TABS = 10;\nconst BROWSER_PARTITION = \"persist:social-browser\";\nconst newTabId = () => \"tab-\" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);\nconst blankTab = (url = \"\") => ({ id: newTabId(), url: url || \"about:blank\", start: !url, title: \"\", icon: \"\" });\nconst safeIcon = (v) => (typeof v === \"string\" && /^https:\\/\\//i.test(v) && v.length <= 2000 ? v : \"\");\nfunction loadTabs() {\n  try {\n    const saved = JSON.parse(localStorage.getItem(TABS_KEY) || \"null\");\n    if (saved && Array.isArray(saved.tabs) && saved.tabs.length) {\n      const tabs = saved.tabs.slice(0, MAX_TABS).map((t) => {\n        const url = HTTPS_PAGE.test((t && t.url) || \"\") ? t.url : \"\";\n        return { ...blankTab(url), title: url && typeof t.title === \"string\" ? t.title.slice(0, 80) : \"\", icon: url ? safeIcon(t.icon) : \"\" };\n      });\n      const at = Math.min(Math.max(0, Math.floor(Number(saved.active)) || 0), tabs.length - 1);\n      return { tabs, active: tabs[at].id };\n    }\n  } catch {}\n  // The first time: one tab, where the Browser was last (or the homepage, or the start page)\n  const tab = blankTab(savedPage(LASTPAGE_KEY) || savedPage(HOMEPAGE_KEY));\n  return { tabs: [tab], active: tab.id };\n}\n\nfunction SiteView({ site, active, onState, register }) {\n  const ref = useRef(null);\n\n  useEffect(() => {\n    const wv = ref.current;\n    if (!wv) return;\n    register(site.id, wv);\n    const update = () => {\n      try { onState(site.id, { canGoBack: wv.canGoBack(), canGoForward: wv.canGoForward(), url: wv.getURL(), title: wv.getTitle() }); } catch {}\n    };\n    const start = () => onState(site.id, { loading: true });\n    const stop = () => { onState(site.id, { loading: false }); update(); };\n    // The page's name and little icon, used for its tab and when it is bookmarked\n    const moved = () => { onState(site.id, { icon: \"\" }); update(); }; // a new page: the old icon no longer applies\n    const named = (e) => onState(site.id, { title: e.title || \"\" });\n    const pictured = (e) => onState(site.id, { icon: (Array.isArray(e.favicons) ? e.favicons : []).find((u) => /^https:\\/\\//i.test(u)) || \"\" });\n    // A plain http page (some links open one) starts once the tab is ready: tabs open on https pages only\n    let later = /^http:\\/\\//i.test(site.url || \"\") ? site.url : \"\";\n    const ready = () => { if (later) { const u = later; later = \"\"; try { wv.loadURL(u); } catch {} } update(); };\n    const events = [\n      [\"dom-ready\", ready], [\"did-navigate\", moved], [\"did-navigate-in-page\", update],\n      [\"did-start-loading\", start], [\"did-stop-loading\", stop],\n      [\"page-title-updated\", named], [\"page-favicon-updated\", pictured],\n    ];\n    events.forEach(([e, f]) => wv.addEventListener(e, f));\n    // The blank page can be ready before this runs; then start the real page now\n    if (later) { try { wv.getURL(); ready(); } catch {} }\n    return () => { events.forEach(([e, f]) => wv.removeEventListener(e, f)); register(site.id, null); };\n  }, []);\n\n  return (\n    <webview\n      ref={ref}\n      src={/^http:\\/\\//i.test(site.url || \"\") ? \"about:blank\" : site.url}\n      partition={site.partition || `persist:social-${site.id}`}\n      useragent={UA}\n      allowpopups=\"true\"\n      style={{\n        position: \"absolute\", inset: 0, width: \"100%\", height: \"100%\",\n        visibility: active ? \"visible\" : \"hidden\",\n        pointerEvents: active ? \"auto\" : \"none\",\n      }}\n    />\n  );\n}\n\nconst icons = {\n  back: <path d=\"M15 18l-6-6 6-6\" />,\n  forward: <path d=\"M9 18l6-6-6-6\" />,\n  home: (<><path d=\"M4 11l8-6.5 8 6.5\" /><path d=\"M6.5 9.5V19h11V9.5\" /></>),\n  reload: (<><path d=\"M20 11a8 8 0 1 0-2.3 5.7\" /><path d=\"M20 4v7h-7\" /></>),\n  external: (<><path d=\"M14 4h6v6\" /><path d=\"M20 4l-9 9\" /><path d=\"M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5\" /></>),\n  star: <path d=\"M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z\" />,\n  bookmarks: (<><path d=\"M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z\" /></>),\n  more: (<><circle cx=\"12\" cy=\"5.5\" r=\"1\" /><circle cx=\"12\" cy=\"12\" r=\"1\" /><circle cx=\"12\" cy=\"18.5\" r=\"1\" /></>),\n  popout: (<><rect x=\"3\" y=\"5\" width=\"18\" height=\"14\" rx=\"2\" /><rect x=\"12.5\" y=\"12\" width=\"6\" height=\"4.5\" rx=\"1\" fill=\"currentColor\" stroke=\"none\" /></>),\n  plus: (<><path d=\"M12 5v14\" /><path d=\"M5 12h14\" /></>),\n  close: (<><path d=\"M6 6l12 12\" /><path d=\"M18 6L6 18\" /></>),\n};\nconst Svg = ({ name, filled = false, size = 16 }) => (\n  <svg viewBox=\"0 0 24 24\" width={size} height={size} fill={filled ? \"currentColor\" : \"none\"} stroke=\"currentColor\"\n       strokeWidth=\"2\" strokeLinecap=\"round\" strokeLinejoin=\"round\" aria-hidden=\"true\">{icons[name]}</svg>\n);\n\nexport default function SocialPage({ visible = true, onShow }) {\n  const isElectron = !!window.electronAPI?.isElectron;\n  const [active, setActive] = useState(() => {\n    try { return localStorage.getItem(\"aura_social_tab\") || \"instagram\"; } catch { return \"instagram\"; }\n  });\n  const [opened, setOpened] = useState(() => new Set());\n  const [states, setStates] = useState({});\n  const views = useRef({});\n\n  // Browser tabs: { tabs: [{ id, url (what it first opened), start (showing the start page), title, icon }], active }\n  const [browser, setBrowser] = useState(loadTabs);\n  const browserRef = useRef(browser);\n  browserRef.current = browser;\n  const tabs = browser.tabs;\n  const tabId = browser.active;\n  const tab = tabs.find((t) => t.id === tabId) || tabs[0];\n  const isBrowser = active === \"browser\";\n  const key = isBrowser ? tabId : active; // the page the toolbar is working on\n\n  // Only load a page the first time it is actually shown\n  useEffect(() => {\n    if (visible) setOpened((s) => (s.has(key) ? s : new Set(s).add(key)));\n  }, [visible, key]);\n\n  const choose = (id) => {\n    setActive(id);\n    try { localStorage.setItem(\"aura_social_tab\", id); } catch {}\n  };\n  const onState = useCallback((id, patch) => setStates((s) => ({ ...s, [id]: { ...s[id], ...patch } })), []);\n  const register = useCallback((id, wv) => { if (wv) views.current[id] = wv; else delete views.current[id]; }, []);\n  const setTab = (id, patch) => setBrowser((b) => ({ ...b, tabs: b.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));\n\n  const st = states[key] || {};\n  const wv = views.current[key];\n  const back = () => { try { if (wv?.canGoBack()) wv.goBack(); } catch {} };\n  const forward = () => { try { if (wv?.canGoForward()) wv.goForward(); } catch {} };\n  const [homepage, setHomepage] = useState(() => savedPage(HOMEPAGE_KEY));\n  const [homeMenu, setHomeMenu] = useState(null);\n  const showStart = isBrowser && !!tab?.start;\n\n  // A tab that goes to a new page is no longer on the start page\n  const seenUrl = useRef({});\n  useEffect(() => {\n    const moved = [];\n    for (const t of tabs) {\n      const u = states[t.id]?.url;\n      if (u && u !== seenUrl.current[t.id]) { seenUrl.current[t.id] = u; if (u !== \"about:blank\") moved.push(t.id); }\n    }\n    if (moved.some((id) => tabs.find((t) => t.id === id)?.start)) {\n      setBrowser((b) => ({ ...b, tabs: b.tabs.map((t) => (moved.includes(t.id) && t.start ? { ...t, start: false } : t)) }));\n    }\n  }, [states]);\n  // Remember the open tabs, and where the one you're on is\n  const activeUrl = states[tabId]?.url;\n  useEffect(() => { if (HTTPS_PAGE.test(activeUrl || \"\") && !tab?.start) { try { localStorage.setItem(LASTPAGE_KEY, activeUrl); } catch {} } }, [activeUrl]);\n  useEffect(() => {\n    const list = tabs.map((t) => {\n      if (t.start) return { url: \"\" };\n      const s = states[t.id] || {};\n      const url = HTTPS_PAGE.test(s.url || \"\") ? s.url : HTTPS_PAGE.test(t.url) ? t.url : \"\";\n      return url ? { url, title: tidyTitle(s.title || t.title, url), icon: safeIcon(s.icon || t.icon) } : { url: \"\" };\n    });\n    try { localStorage.setItem(TABS_KEY, JSON.stringify({ tabs: list, active: Math.max(0, tabs.findIndex((t) => t.id === tabId)) })); } catch {}\n  }, [browser, states]);\n\n  // A short note under the tabs (\"You can have up to 10 tabs...\")\n  const [tabNote, setTabNote] = useState(\"\");\n  useEffect(() => { if (!tabNote) return; const t = setTimeout(() => setTabNote(\"\"), 5000); return () => clearTimeout(t); }, [tabNote]);\n\n  // Open a page in the tab you're on\n  const openInBrowserTab = (url) => {\n    if (!url) return;\n    const id = browserRef.current.active;\n    const view = views.current[id];\n    if (view) { try { view.loadURL(url); } catch { view.src = url; } setTab(id, { start: false }); }\n    else { setTab(id, { url, start: false }); setOpened((s) => new Set(s).add(id)); }\n    if (HTTPS_PAGE.test(url)) { try { localStorage.setItem(LASTPAGE_KEY, url); } catch {} }\n  };\n  // Open a new tab next to the one you're on: on the start page, or on a page\n  const openNewTab = (url = \"\", { background = false, fromLink = false } = {}) => {\n    const b = browserRef.current;\n    if (b.tabs.length >= MAX_TABS) {\n      setTabNote(`You can have up to ${MAX_TABS} tabs. Close one to open another.`);\n      if (url && !background) openInBrowserTab(url); // a link still opens, in this tab\n      return;\n    }\n    const t = blankTab(url);\n    const next = [...b.tabs];\n    if (fromLink) {\n      // Like Chrome: a tab opened from a link goes next to its page, after others opened from it\n      const at = b.tabs.findIndex((x) => x.id === b.active);\n      next.splice(at + 1 + b.tabs.slice(at + 1).filter((x) => x.opener === b.active).length, 0, { ...t, opener: b.active });\n    } else next.push(t); // + and Ctrl+T add a tab at the end\n    setBrowser({ tabs: next, active: background ? b.active : t.id });\n    if (url) setOpened((s) => new Set(s).add(t.id)); // pages in new tabs start loading straight away\n    if (!background) choose(\"browser\");\n  };\n  const selectTab = (id) => { setBrowser((b) => (b.tabs.some((t) => t.id === id) ? { ...b, active: id } : b)); };\n  const closeTab = (id) => {\n    const b = browserRef.current;\n    const at = b.tabs.findIndex((t) => t.id === id);\n    if (at < 0) return;\n    if (b.tabs.length === 1) {\n      const t = blankTab(); // closing the last tab leaves a fresh start page\n      setBrowser({ tabs: [t], active: t.id });\n      try { localStorage.removeItem(LASTPAGE_KEY); } catch {}\n    } else {\n      const rest = b.tabs.filter((t) => t.id !== id);\n      const closing = b.tabs[at];\n      const back = closing.opener && rest.find((t) => t.id === closing.opener);\n      const nextActive = b.active !== id ? b.active : (back || rest[at] || rest[at - 1]).id;\n      setBrowser({ tabs: rest.map((t) => (t.opener === id ? { ...t, opener: undefined } : t)), active: nextActive });\n    }\n    delete views.current[id];\n    delete seenUrl.current[id];\n    setStates((s) => { if (!s[id]) return s; const n = { ...s }; delete n[id]; return n; });\n    setOpened((s) => { if (!s.has(id)) return s; const n = new Set(s); n.delete(id); return n; });\n    if (popTab.current === id) { popTab.current = null; setPopped(false); }\n  };\n  const cycleTab = (by) => {\n    const b = browserRef.current;\n    const at = b.tabs.findIndex((t) => t.id === b.active);\n    selectTab(b.tabs[(at + by + b.tabs.length) % b.tabs.length].id);\n  };\n  // Ctrl+T, Ctrl+W, Ctrl+Tab and Ctrl+Shift+Tab: from AURA's toolbar, or from inside a page\n  const tabKey = (what) => {\n    if (!visibleRef.current || activeRef.current !== \"browser\") return false;\n    if (what === \"new\") openNewTab();\n    else if (what === \"close\") closeTab(browserRef.current.active);\n    else if (what === \"next\") cycleTab(1);\n    else if (what === \"previous\") cycleTab(-1);\n    else return false;\n    return true;\n  };\n  const visibleRef = useRef(visible); visibleRef.current = visible;\n  const activeRef = useRef(active); activeRef.current = active;\n  const actions = useRef({});\n  actions.current = { openNewTab, tabKey };\n  useEffect(() => {\n    const onKey = (e) => {\n      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;\n      const k = String(e.key).toLowerCase();\n      const what = k === \"t\" ? \"new\" : k === \"w\" ? \"close\" : k === \"tab\" ? (e.shiftKey ? \"previous\" : \"next\") : null;\n      if (what && actions.current.tabKey(what)) { e.preventDefault(); e.stopPropagation(); }\n    };\n    window.addEventListener(\"keydown\", onKey, true);\n    const offOpen = window.electronAPI?.onBrowserOpenTab?.((d) => { if (d && isWebAddress(d.url)) actions.current.openNewTab(d.url, { background: !!d.background, fromLink: true }); });\n    const offKey = window.electronAPI?.onBrowserTabKey?.((what) => actions.current.tabKey(what));\n    return () => { window.removeEventListener(\"keydown\", onKey, true); if (typeof offOpen === \"function\") offOpen(); if (typeof offKey === \"function\") offKey(); };\n  }, []);\n\n  const goHome = () => {\n    if (isBrowser) {\n      if (homepage) { openInBrowserTab(homepage); return; }\n      openStartPage();\n      return;\n    }\n    try { wv?.loadURL(SITES.find((s) => s.id === active).url); } catch {}\n  };\n\n  // Address bar (Browser)\n  const [addr, setAddr] = useState(null); // null = show the page's URL\n  useEffect(() => { setAddr(null); }, [key, st.url, showStart]);\n  const go = (e) => {\n    e.preventDefault();\n    const url = toUrl(addr ?? (showStart ? \"\" : st.url) ?? \"\");\n    if (url) openInBrowserTab(url);\n    setAddr(null);\n    e.target.querySelector(\"input\")?.blur();\n  };\n  const reload = () => { try { if (!showStart) wv?.reload(); } catch {} };\n\n  // Pop-out video (see POP_OUT at the top). \"Showing\" means a Browser tab's page is on screen.\n  const [popOut, setPopOut] = useState(() => { try { return localStorage.getItem(POPOUT_KEY) !== \"0\"; } catch { return true; } });\n  const [popped, setPopped] = useState(false);\n  const browserShowing = visible && isBrowser && !showStart;\n  const shownTab = useRef(null); // the tab whose page was on screen last\n  const popTab = useRef(null);   // the tab whose video is popped out\n  if (browserShowing) shownTab.current = tabId;\n  const wasShowing = useRef(browserShowing);\n  const inPage = (code, asUser = false, id = popTab.current || shownTab.current) => {\n    const view = id ? views.current[id] : null;\n    try { return view ? Promise.resolve(view.executeJavaScript(code, asUser)).catch(() => \"\") : Promise.resolve(\"\"); } catch { return Promise.resolve(\"\"); }\n  };\n  useEffect(() => {\n    const before = wasShowing.current;\n    wasShowing.current = browserShowing;\n    if (before === browserShowing) return;\n    if (browserShowing) {\n      setPopped(false);\n      if (popTab.current) inPage(POP_IN, false, popTab.current);\n      popTab.current = null;\n      return;\n    }\n    if (!popOut) return;\n    const id = shownTab.current;\n    let sound = false;\n    try { sound = !!(id && views.current[id]?.isCurrentlyAudible()); } catch {}\n    // Leaving the page counts as asking for it: browsers only open that window on a person's say-so\n    if (sound) inPage(POP_OUT, true, id).then((where) => {\n      if (where !== \"out\") return;\n      if (wasShowing.current) { inPage(POP_IN, false, id); return; } // you were already back before it opened\n      popTab.current = id;\n      setPopped(true);\n    });\n  }, [browserShowing]);\n  // While it's out, notice when it comes back. \"Back to tab\" on the small window means \"show me\n  // the page\", so AURA opens it. Closing the small window stops the video, and nothing else happens.\n  useEffect(() => {\n    if (!popped) return;\n    const timer = setInterval(() => {\n      const id = popTab.current;\n      inPage(POP_WHERE, false, id).then((where) => {\n        if (where === \"out\" || wasShowing.current) return;\n        setPopped(false);\n        popTab.current = null;\n        if (where === \"page\" && id) { selectTab(id); setTab(id, { start: false }); choose(\"browser\"); onShow?.(); }\n      });\n    }, 1500);\n    return () => clearInterval(timer);\n  }, [popped]);\n  const togglePopOut = () => {\n    const next = !popOut;\n    setPopOut(next);\n    try { localStorage.setItem(POPOUT_KEY, next ? \"1\" : \"0\"); } catch {}\n  };\n\n  // Bookmarks (Browser): the star saves the page you're on, the bar lists what you've saved\n  const [bookmarks, setBookmarks] = useState(loadBookmarks);\n  const [barOpen, setBarOpen] = useState(() => { try { return localStorage.getItem(BOOKMARKS_BAR_KEY) !== \"0\"; } catch { return true; } });\n  const [barNote, setBarNote] = useState(\"\");\n  const changeBookmarks = (next) => { setBookmarks(next); saveBookmarks(next); };\n  const showBar = (open) => { setBarOpen(open); try { localStorage.setItem(BOOKMARKS_BAR_KEY, open ? \"1\" : \"0\"); } catch {} };\n  const pageUrl = isBrowser && !showStart && isWebAddress(st.url) ? st.url : \"\";\n  const savedHere = pageUrl ? bookmarks.find((b) => sameAddress(b.url, pageUrl)) : null;\n  const toggleBookmark = () => {\n    if (!pageUrl) return;\n    if (savedHere) { changeBookmarks(bookmarks.filter((b) => b.id !== savedHere.id)); return; }\n    showBar(true);\n    if (bookmarks.length >= MAX_BOOKMARKS) { setBarNote(`You can keep up to ${MAX_BOOKMARKS} bookmarks. Remove one to add another.`); return; }\n    setBarNote(\"\");\n    changeBookmarks([...bookmarks, { id: \"b\" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), url: pageUrl, title: tidyTitle(st.title, pageUrl), icon: st.icon || \"\" }]);\n  };\n  useEffect(() => { if (!barNote) return; const t = setTimeout(() => setBarNote(\"\"), 5000); return () => clearTimeout(t); }, [barNote]);\n\n  // Homepage (Browser): right-click the Home button to choose\n  const openStartPage = () => {\n    setTab(browserRef.current.active, { start: true });\n    try { localStorage.removeItem(LASTPAGE_KEY); } catch {} // you chose the start page, so that is where you are\n    setHomeMenu(null);\n  };\n  const chooseHomepage = (url) => {\n    const next = HTTPS_PAGE.test(url || \"\") ? url : \"\";\n    setHomepage(next);\n    try { if (next) localStorage.setItem(HOMEPAGE_KEY, next); else localStorage.removeItem(HOMEPAGE_KEY); } catch {}\n    setHomeMenu(null);\n  };\n  useEffect(() => {\n    if (!homeMenu) return;\n    const onKey = (e) => { if (e.key === \"Escape\") setHomeMenu(null); };\n    window.addEventListener(\"keydown\", onKey);\n    return () => window.removeEventListener(\"keydown\", onKey);\n  }, [homeMenu]);\n\n  const openOutside = () => {\n    const url = showStart ? \"\" : st.url || SITES.find((s) => s.id === active)?.url;\n    if (url && url !== \"about:blank\") window.electronAPI?.openExternal?.(url);\n  };\n\n  if (!isElectron) {\n    return <div style={{ padding: 28, color: \"var(--t2)\" }}>The Social page works in the AURA desktop app.</div>;\n  }\n\n  const tool = {\n    background: \"transparent\", border: \"1px solid var(--border)\", color: \"var(--t2)\",\n    borderRadius: 8, width: 34, height: 32, display: \"grid\", placeItems: \"center\", cursor: \"pointer\",\n  };\n\n  return (\n    <div style={{ flex: 1, display: \"flex\", flexDirection: \"column\", minHeight: 0, background: \"var(--bg)\" }}>\n      {/* Toolbar */}\n      <div style={{ display: \"flex\", alignItems: \"center\", gap: 10, padding: \"10px 16px\",\n                    borderBottom: \"1px solid var(--border)\", background: \"var(--panel)\", flexShrink: 0 }}>\n        <div role=\"tablist\" aria-label=\"Social sites\" style={{ display: \"flex\", gap: 4 }}>\n          {SITES.map((s) => {\n            const on = s.id === active;\n            return (\n              <button key={s.id} role=\"tab\" aria-selected={on} onClick={() => choose(s.id)}\n                style={{\n                  border: 0, borderRadius: 8, padding: \"7px 16px\", cursor: \"pointer\",\n                  fontSize: 13, fontWeight: 700, fontFamily: \"DM Sans, sans-serif\",\n                  background: on ? \"var(--ac)\" : \"transparent\", color: on ? \"#fff\" : \"var(--t2)\",\n                }}>\n                {s.label}\n              </button>\n            );\n          })}\n        </div>\n        <button style={{ ...tool, opacity: st.canGoBack && !showStart ? 1 : 0.4 }} onClick={back} disabled={!st.canGoBack || showStart}\n                title=\"Back\" aria-label=\"Back\"><Svg name=\"back\" /></button>\n        {isBrowser && (\n          <button style={{ ...tool, opacity: st.canGoForward && !showStart ? 1 : 0.4 }} onClick={forward} disabled={!st.canGoForward || showStart}\n                  title=\"Forward\" aria-label=\"Forward\"><Svg name=\"forward\" /></button>\n        )}\n        {isBrowser ? (\n          <form onSubmit={go} style={{ flex: 1, display: \"flex\" }}>\n            <input\n              value={addr ?? (showStart ? \"\" : st.url) ?? \"\"}\n              onChange={(e) => setAddr(e.target.value)}\n              onFocus={(e) => e.target.select()}\n              placeholder=\"Search Google or type a web address\"\n              aria-label=\"Address\"\n              spellCheck={false}\n              style={{\n                flex: 1, background: \"var(--card)\", border: \"1px solid var(--border)\", borderRadius: 8,\n                padding: \"7px 12px\", color: \"var(--t1)\", fontSize: 13, outline: \"none\", fontFamily: \"DM Sans, sans-serif\",\n              }}\n            />\n          </form>\n        ) : (\n          <div style={{ flex: 1 }} />\n        )}\n        {isBrowser && (\n          <button style={{ ...tool, opacity: pageUrl ? 1 : 0.4, color: savedHere ? \"var(--ac)\" : \"var(--t2)\" }} onClick={toggleBookmark} disabled={!pageUrl}\n                  aria-pressed={!!savedHere} title={savedHere ? \"Remove this bookmark\" : \"Bookmark this page\"} aria-label={savedHere ? \"Remove this bookmark\" : \"Bookmark this page\"}>\n            <Svg name=\"star\" filled={!!savedHere} />\n          </button>\n        )}\n        {isBrowser && (\n          <button style={{ ...tool, color: barOpen ? \"var(--t1)\" : \"var(--t2)\", background: barOpen ? \"var(--card)\" : \"transparent\" }} onClick={() => showBar(!barOpen)}\n                  aria-pressed={barOpen} title={barOpen ? \"Hide the bookmarks bar\" : \"Show the bookmarks bar\"} aria-label={barOpen ? \"Hide the bookmarks bar\" : \"Show the bookmarks bar\"}>\n            <Svg name=\"bookmarks\" />\n          </button>\n        )}\n        {isBrowser && (\n          <button className=\"home-btn\" style={{ ...tool, color: homepage ? \"var(--t1)\" : \"var(--t2)\" }} onClick={goHome} aria-label=\"Home\" aria-haspopup=\"menu\"\n                  onContextMenu={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setHomeMenu({ right: Math.max(8, window.innerWidth - r.right), top: r.bottom + 6 }); }}\n                  title={homepage ? \"Home: \" + siteName(homepage) + \" (right-click to change)\" : \"Home (right-click to choose your homepage)\"}><Svg name=\"home\" /></button>\n        )}\n        {isBrowser && (\n          <button className=\"popout-toggle\" style={{ ...tool, color: popOut ? \"var(--ac)\" : \"var(--t2)\", background: popOut ? \"var(--card)\" : \"transparent\" }} onClick={togglePopOut} aria-pressed={popOut}\n                  title={popOut ? \"On: a video playing here pops out into a small window when you go to another page. Click to turn off.\" : \"Off: videos stay in the page when you go to another page. Click to pop them out into a small window.\"}\n                  aria-label=\"Pop videos out when you leave this page\">\n            <Svg name=\"popout\" />\n          </button>\n        )}\n        <button style={tool} onClick={reload} title=\"Reload\" aria-label=\"Reload\"><Svg name=\"reload\" /></button>\n        <button style={tool} onClick={openOutside} title=\"Open in your browser\" aria-label=\"Open in your browser\">\n          <Svg name=\"external\" />\n        </button>\n      </div>\n\n      {homeMenu && (\n        <>\n          <div onClick={() => setHomeMenu(null)} onContextMenu={(e) => { e.preventDefault(); setHomeMenu(null); }} style={{ position: \"fixed\", inset: 0, zIndex: 9199 }} />\n          <div className=\"bmk-menu home-menu\" role=\"menu\" aria-label=\"Homepage\" style={{ right: homeMenu.right, top: homeMenu.top }}>\n            <button role=\"menuitem\" disabled={!HTTPS_PAGE.test(pageUrl)} onClick={() => chooseHomepage(pageUrl)}>Make this page my homepage</button>\n            {homepage && <button role=\"menuitem\" onClick={() => chooseHomepage(\"\")}>Use AURA's start page instead</button>}\n            <button role=\"menuitem\" onClick={openStartPage}>Open the start page</button>\n          </div>\n        </>\n      )}\n      <style>{BOOKMARK_CSS + TABS_CSS}</style>\n      {isBrowser && (\n        <TabStrip tabs={tabs} active={tabId} states={states} note={tabNote}\n                  onSelect={selectTab} onClose={closeTab} onNew={() => openNewTab()} />\n      )}\n      {isBrowser && barOpen && <BookmarkBar items={bookmarks} current={pageUrl} note={barNote} onOpen={openInBrowserTab} onOpenNew={(url) => openNewTab(url, { background: true })} onChange={changeBookmarks} />}\n\n      {/* Loading line */}\n      <div style={{ height: 2, flexShrink: 0, background: st.loading && !showStart ? \"var(--ac)\" : \"transparent\", transition: \"background .2s\" }} />\n\n      {/* Pages (kept alive once opened so switching is instant) */}\n      <div style={{ position: \"relative\", flex: 1, minHeight: 0 }}>\n        {SITES.filter((s) => s.id !== \"browser\" && opened.has(s.id)).map((s) => (\n          <SiteView key={s.id} site={s} active={s.id === active} onState={onState} register={register} />\n        ))}\n        {tabs.filter((t) => opened.has(t.id)).map((t) => (\n          <SiteView key={t.id} site={{ id: t.id, url: t.url, partition: BROWSER_PARTITION }} active={isBrowser && t.id === tabId && !t.start} onState={onState} register={register} />\n        ))}\n        {showStart && <StartPage key={tabId} onGo={openInBrowserTab} bookmarks={bookmarks} />}\n      </div>\n    </div>\n  );\n}\n\n// ── Tab strip (Browser) ───────────────────────────────────────────────────────\nconst TABS_CSS = `\n.btab-strip{position:relative;display:flex;align-items:center;gap:4px;padding:6px 12px 0;min-height:40px;background:var(--panel);border-bottom:1px solid var(--border);flex-shrink:0;font-family:'DM Sans',sans-serif}\n.btab{position:relative;display:flex;align-items:center;flex:0 1 200px;min-width:0;overflow:hidden;height:34px;border-radius:9px 9px 0 0;color:var(--t2)}\n.btab:hover{background:color-mix(in srgb,var(--card) 55%,transparent);color:var(--t1)}\n.btab.on{background:var(--card);color:var(--t1);box-shadow:inset 0 2px 0 var(--ac)}\n.btab-go{flex:1;min-width:0;display:flex;align-items:center;gap:8px;height:100%;padding:0 4px 0 11px;border:0;background:transparent;color:inherit;font:600 12.5px 'DM Sans',sans-serif;cursor:pointer;text-align:left;border-radius:9px 0 0 0}\n.btab-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.btab-x{display:grid;place-items:center;flex-shrink:0;width:22px;height:22px;margin-right:6px;border:0;border-radius:6px;background:transparent;color:var(--t2);cursor:pointer;opacity:0}\n.btab:hover .btab-x,.btab.on .btab-x,.btab:focus-within .btab-x{opacity:1}\n.btab-x:hover{background:var(--border);color:var(--t1)}\n.btab-new{display:grid;place-items:center;flex-shrink:0;width:30px;height:30px;margin:0 0 2px 2px;border:0;border-radius:8px;background:transparent;color:var(--t2);cursor:pointer}\n.btab-new:hover:not(:disabled){background:var(--card);color:var(--t1)}\n.btab-new:disabled{opacity:.35;cursor:default}\n.btab-go:focus-visible,.btab-x:focus-visible,.btab-new:focus-visible{outline:2px solid var(--ac);outline-offset:-2px}\n.btab-spin{width:14px;height:14px;flex-shrink:0;border-radius:50%;border:2px solid var(--border);border-top-color:var(--ac);animation:btab-spin .8s linear infinite}\n.btab-new-ico{width:16px;height:16px;flex-shrink:0;border-radius:5px;background:linear-gradient(135deg,var(--ac),var(--ac2))}\n.btab-note{position:absolute;right:12px;top:calc(100% + 6px);z-index:30;padding:8px 12px;border-radius:8px;background:var(--panel);border:1px solid var(--border);box-shadow:0 10px 30px rgba(0,0,0,.45);font-size:12.5px;color:var(--t1);white-space:nowrap}\n@keyframes btab-spin{to{transform:rotate(360deg)}}\n@media (prefers-reduced-motion:reduce){.btab-spin{animation:none}}\n`;\n\nfunction TabStrip({ tabs, active, states, note, onSelect, onClose, onNew }) {\n  const full = tabs.length >= MAX_TABS;\n  return (\n    <div className=\"btab-strip\">\n      <div role=\"tablist\" aria-label=\"Browser tabs\" style={{ display: \"contents\" }}>\n        {tabs.map((t) => {\n          const s = states[t.id] || {};\n          const url = t.start ? \"\" : (s.url && s.url !== \"about:blank\" ? s.url : t.url !== \"about:blank\" ? t.url : \"\");\n          const named = s.title && s.title !== \"about:blank\" ? s.title : t.title;\n          const title = t.start ? \"New tab\" : tidyTitle(named, url || \"New tab\");\n          const on = t.id === active;\n          return (\n            <div key={t.id} className={`btab ${on ? \"on\" : \"\"}`}\n                 onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}\n                 onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose(t.id); } }}>\n              <button type=\"button\" role=\"tab\" aria-selected={on} className=\"btab-go\" onClick={() => onSelect(t.id)}\n                      title={url ? title + \"\\n\" + url : title}>\n                {s.loading && !t.start ? <span className=\"btab-spin\" aria-hidden=\"true\" />\n                  : t.start ? <span className=\"btab-new-ico\" aria-hidden=\"true\" />\n                  : <BookmarkIcon item={{ icon: s.icon || t.icon || \"\", url: url || \"https://new\" }} />}\n                <span className=\"btab-name\">{title}</span>\n              </button>\n              <button type=\"button\" className=\"btab-x\" onClick={() => onClose(t.id)} aria-label={`Close ${title}`} title=\"Close tab (Ctrl+W)\">\n                <Svg name=\"close\" size={13} />\n              </button>\n            </div>\n          );\n        })}\n      </div>\n      <button type=\"button\" className=\"btab-new\" onClick={onNew} disabled={full} aria-label=\"New tab\"\n              title={full ? `You can have up to ${MAX_TABS} tabs. Close one to open another.` : \"New tab (Ctrl+T)\"}>\n        <Svg name=\"plus\" size={16} />\n      </button>\n      {note && <span className=\"btab-note\" role=\"status\">{note}</span>}\n    </div>\n  );\n}\n\n","test":"// Browser tabs on the Social page: the pieces that make them work are in place.\n// Added by aura-browser-tabs-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst path = require(\"path\");\nconst ROOT = path.join(__dirname, \"..\");\nlet failed = 0;\nconst check = (name, ok) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name); };\nconst read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), \"utf8\").replace(/\\r\\n/g, \"\\n\"); } catch { return \"\"; } };\n\nconst social = read(\"src/components/social.jsx\");\nconst main = read(\"electron/main.js\");\nconst preload = read(\"electron/preload.js\");\n\nconsole.log(\"1. The Browser has tabs\");\ncheck(\"a tab strip with + and x\", /function TabStrip\\(/.test(social) && /aria-label=\"New tab\"/.test(social) && /className=\"btab-x\"/.test(social));\ncheck(\"up to 10 tabs\", /const MAX_TABS = 10;/.test(social));\ncheck(\"each tab is its own page, sharing the Browser's sign-ins\", /partition: BROWSER_PARTITION/.test(social) && /const BROWSER_PARTITION = \"persist:social-browser\";/.test(social));\ncheck(\"Ctrl+T, Ctrl+W and Ctrl+Tab in AURA's toolbar\", /k === \"t\" \\? \"new\" : k === \"w\" \\? \"close\" : k === \"tab\"/.test(social));\ncheck(\"middle-click closes a tab, and opens a bookmark in a new tab\", /onAuxClick=\\{\\(e\\) => \\{ if \\(e\\.button === 1\\) \\{ e\\.preventDefault\\(\\); onClose\\(t\\.id\\); \\} \\}\\}/.test(social) && /onOpenNew\\(b\\.url\\)/.test(social));\n\nconsole.log(\"2. Coming back next time\");\ncheck(\"open tabs are kept on this PC\", /const TABS_KEY = \"aura_browser_tabs\";/.test(social) && /localStorage\\.setItem\\(TABS_KEY/.test(social));\ncheck(\"only https pages are kept or reopened\", /HTTPS_PAGE\\.test\\(\\(t && t\\.url\\) \\|\\| \"\"\\)/.test(social) && /HTTPS_PAGE\\.test\\(s\\.url \\|\\| \"\"\\) \\? s\\.url/.test(social));\ncheck(\"only the tab you're on loads straight away\", /tabs\\.filter\\(\\(t\\) => opened\\.has\\(t\\.id\\)\\)/.test(social));\n\nconsole.log(\"3. Links and keys from inside a page\");\ncheck(\"a link that opens a new tab or window opens as a tab\", /host\\.send\\(\"browser-open-tab\", \\{ url, background: disposition === \"background-tab\" \\}\\)/.test(main));\ncheck(\"only web links do (anything else still goes through the safe opener)\", /if \\(isBrowserTab && \\/\\^https\\?:\\\\\\/\\\\\\/\\/i\\.test\\(url\\)\\) \\{/.test(main));\ncheck(\"Ctrl+T, Ctrl+W and Ctrl+Tab inside a page reach AURA's tabs\", /host\\.send\\(\"browser-tab-key\", what\\)/.test(main) && /if \\(isBrowserTab\\) contents\\.on\\(\"before-input-event\"/.test(main));\ncheck(\"the window can hear both\", /onBrowserOpenTab:/.test(preload) && /onBrowserTabKey:/.test(preload) && /onBrowserOpenTab\\?\\.\\(/.test(social) && /onBrowserTabKey\\?\\.\\(/.test(social));\ncheck(\"listeners can be removed (no leaks when the page reloads)\", /removeListener\\(\"browser-open-tab\", h\\)/.test(preload) && /removeListener\\(\"browser-tab-key\", h\\)/.test(preload));\n\nconsole.log(failed ? `\\n${failed} FAILED` : \"\\nall passed\");\nprocess.exit(failed ? 1 : 0);\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-browser-tabs.bak";
const MARK = "Added by aura-browser-tabs-setup.cjs";
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

// ── Social page: the Browser gets tabs ───────────────────────────────────────
function editSocial(text) {
  if (/const TABS_KEY = "aura_browser_tabs";/.test(text)) return { text, notes: [] };
  const start = text.indexOf("function SiteView({ site, active, onState, register }) {");
  const end = text.indexOf("// ── Browser start page");
  if (start < 0 || end < start || !/export default function SocialPage\(/.test(text.slice(start, end))) throw new Error("the Social page's code (function SiteView ... export default function SocialPage ... // ── Browser start page)");
  for (const needed of ["const HTTPS_PAGE", "const LASTPAGE_KEY", "const HOMEPAGE_KEY", "function BookmarkBar(", "function BookmarkIcon(", "const POP_OUT", "function StartPage("]) {
    if (!text.includes(needed)) throw new Error("the Browser's homepage, bookmarks and pop-out video code (" + needed + ")");
  }
  let out = text.slice(0, start) + FILES.social + text.slice(end);
  const bar = "function BookmarkBar({ items, current, note, onOpen, onChange }) {";
  const chip = '<button type="button" className="bmk-go" onClick={() => onOpen(b.url)} title={b.title + "\\n" + b.url}>';
  if (!out.includes(bar) || !out.includes(chip)) throw new Error("the bookmarks bar (function BookmarkBar ... className=\"bmk-go\")");
  out = out.replace(bar, "function BookmarkBar({ items, current, note, onOpen, onOpenNew, onChange }) {");
  out = out.replace(chip, '<button type="button" className="bmk-go" onClick={() => onOpen(b.url)} title={b.title + "\\n" + b.url}\n' +
    '                  onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}\n' +
    '                  onAuxClick={(e) => { if (e.button === 1 && onOpenNew) { e.preventDefault(); onOpenNew(b.url); } }}>');
  return { text: out, notes: ["the Browser has tabs: +, x, Ctrl+T/W/Tab, middle-click, and they come back next time"] };
}

// ── Main file: links and keys from inside a Browser page reach the tabs ──────
function editMain(text) {
  if (/host\.send\("browser-open-tab"/.test(text)) return { text, notes: [] };
  const re = /^(\s*)contents\.setWindowOpenHandler\(\(\{ url \}\) => \{\n\s*if \(\(isBrowserTab && \/\^https\?:\\\/\\\/\/i\.test\(url\)\) \|\| isSocialHost\(url\)\) contents\.loadURL\(url\);\n\s*else outside\(url\);\n\s*return \{ action: "deny" \};\n\s*\}\);\n/m;
  const m = text.match(re);
  if (!m) throw new Error('where Browser links open (contents.setWindowOpenHandler(({ url }) => { if ((isBrowserTab && ... ) ... ) — run aura-security-setup.cjs first if you haven\'t');
  const i = m[1];
  const block = [
    i + "contents.setWindowOpenHandler(({ url, disposition }) => {",
    i + "  if (isBrowserTab && /^https?:\\/\\//i.test(url)) {",
    i + "    // A link that opens a new tab or window opens as a new tab in AURA's Browser",
    i + "    const host = contents.hostWebContents;",
    i + "    if (host && !host.isDestroyed()) host.send(\"browser-open-tab\", { url, background: disposition === \"background-tab\" });",
    i + "    else contents.loadURL(url);",
    i + "  } else if (isSocialHost(url)) contents.loadURL(url);",
    i + "  else outside(url);",
    i + "  return { action: \"deny\" };",
    i + "});",
    i + "// Ctrl+T, Ctrl+W, Ctrl+Tab and Ctrl+Shift+Tab pressed inside a Browser page work on AURA's tabs",
    i + "if (isBrowserTab) contents.on(\"before-input-event\", (e, input) => {",
    i + "  if (input.type !== \"keyDown\" || !(input.control || input.meta) || input.alt) return;",
    i + "  const key = String(input.key || \"\").toLowerCase();",
    i + "  const what = key === \"t\" ? \"new\" : key === \"w\" ? \"close\" : key === \"tab\" ? (input.shift ? \"previous\" : \"next\") : null;",
    i + "  if (!what) return;",
    i + "  e.preventDefault();",
    i + "  const host = contents.hostWebContents;",
    i + "  if (host && !host.isDestroyed()) host.send(\"browser-tab-key\", what);",
    i + "});",
    "",
  ].join("\n");
  return { text: text.replace(re, () => block), notes: ["links that open a new tab, and Ctrl+T/W/Tab inside a page, go to AURA's tabs"] };
}

// ── Preload: the window can hear them ────────────────────────────────────────
function editPreload(text) {
  if (/onBrowserOpenTab:/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  const at = findLine(lines, /^\s*onStreamExitFull:/);
  if (at < 0) throw new Error("where AURA's window listens for the stream player (onStreamExitFull)");
  const i = indentOf(lines[at]);
  lines.splice(at + 1, 0,
    i + "// Browser tabs: links that open a new tab, and Ctrl+T / Ctrl+W / Ctrl+Tab pressed inside a page",
    i + 'onBrowserOpenTab: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on("browser-open-tab", h); return () => ipcRenderer.removeListener("browser-open-tab", h); },',
    i + 'onBrowserTabKey:  (cb) => { const h = (_e, k) => cb(k); ipcRenderer.on("browser-tab-key", h); return () => ipcRenderer.removeListener("browser-tab-key", h); },');
  return { text: lines.join("\n"), notes: ["the window hears new-tab links and tab keys"] };
}

// ── AURA's checks (only when they are installed) ─────────────────────────────
function editRunner(text) {
  if (/browser-tabs\.cjs/.test(text)) return { text, notes: [] };
  const lines = text.split("\n");
  const at = findLine(lines, /^add\("window",/);
  if (at < 0) return { text, notes: ["(couldn't find where to add the tabs check, so npm test doesn't include it)"] };
  lines.splice(at, 0, 'if (fs.existsSync(path.join(__dirname, "browser-tabs.cjs"))) add("files", "Browser tabs", "browser-tabs.cjs");');
  return { text: lines.join("\n"), notes: ["npm test now checks the Browser tabs too"] };
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
      } else if (entry.name === "browser-tabs.cjs") {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. The Browser is back to one page at a time." : "Nothing to undo.");
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
  const files = {
    main: findOne("your main file", (t) => /persist:social-browser/.test(t) && /setWindowOpenHandler/.test(t), need, [
      (h) => startFile && sameFile(h.file, startFile),
      (h) => /function createWindow\s*\(/.test(h.text),
    ]),
    preload: findOne("your preload file", (t) => /contextBridge\.exposeInMainWorld\(\s*["']electronAPI["']/.test(t), need, [
      (h) => /^preload\.[cm]?js$/.test(path.basename(h.file)),
    ]),
    social: findOne("your Social page", (t) => /export default function SocialPage\s*\(/.test(t), need, [
      (h) => /[\\/]components[\\/]/.test(h.file),
      (h) => !/[\\/]electron[\\/]/.test(h.file),
    ]),
  };

  const plan = [];
  const problems = [];
  const consider = (label, file, edit, checkSyntax) => {
    const { text, eol } = readText(file);
    try {
      const result = edit(text);
      if (checkSyntax && result.text !== text) { const bad = syntaxProblem(result.text); if (bad) throw new Error("a way to edit it safely (" + bad + ")"); }
      plan.push({ label, file, before: text, after: result.text, eol, notes: result.notes });
    } catch (e) { problems.push("In " + rel(file) + " I couldn't find " + e.message + "."); }
  };
  consider("Social page", files.social, editSocial, false);
  consider("main file", files.main, editMain, true);
  consider("preload", files.preload, editPreload, true);
  const runner = path.join(ROOT, "tests", "run.cjs");
  const hasChecks = fs.existsSync(runner);
  if (hasChecks) consider("checks", runner, editRunner, true);

  const created = [];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "browser-tabs.cjs"), content: FILES.test });
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
  say(DRY ? "Dry run. This is what would change:" : "AURA: tabs in the Browser");
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
  say("Done. Restart AURA (stop it in the terminal and start it again), open Social > Browser and press +.");
  if (hasChecks) say("Run  npm test  before your next release.");
  say("To undo later:  node aura-browser-tabs-setup.cjs --undo");
  say();
}

try { run(); } catch (e) { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); }
