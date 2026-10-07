// src/components/social.jsx — Social page: Instagram, X and Facebook inside AURA
import { useCallback, useEffect, useRef, useState } from "react";

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
      try { onState(site.id, { canGoBack: wv.canGoBack(), canGoForward: wv.canGoForward(), url: wv.getURL() }); } catch {}
    };
    const start = () => onState(site.id, { loading: true });
    const stop = () => { onState(site.id, { loading: false }); update(); };
    const events = [
      ["dom-ready", update], ["did-navigate", update], ["did-navigate-in-page", update],
      ["did-start-loading", start], ["did-stop-loading", stop],
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
};
const Svg = ({ name }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
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
          <button style={tool} onClick={goHome} title="Home" aria-label="Home"><Svg name="home" /></button>
        )}
        <button style={tool} onClick={reload} title="Reload" aria-label="Reload"><Svg name="reload" /></button>
        <button style={tool} onClick={openOutside} title="Open in your browser" aria-label="Open in your browser">
          <Svg name="external" />
        </button>
      </div>

      {/* Loading line */}
      <div style={{ height: 2, flexShrink: 0, background: st.loading ? "var(--ac)" : "transparent", transition: "background .2s" }} />

      {/* Sites (kept alive once opened so switching tabs is instant) */}
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {SITES.filter((s) => opened.has(s.id)).map((s) => (
          <SiteView key={s.id} site={s} active={s.id === active} onState={onState} register={register} />
        ))}
        {showStart && <StartPage onGo={openInBrowserTab} />}
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

function StartPage({ onGo }) {
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