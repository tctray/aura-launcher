// AURA — the Settings page's layout: a sidebar of categories that follows you as you scroll, a
// search that finds any setting by its name, description or related words, and groups you can
// fold away. The settings themselves are unchanged (they're still the rows in App.jsx and the
// components): this only arranges them and helps you get to them.
// Added by aura-settings-layout-setup.cjs.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const GROUPS_KEY = "aura_settings_groups"; // which groups you folded away (this PC only)
const readFolded = () => { try { return JSON.parse(localStorage.getItem(GROUPS_KEY) || "{}") || {}; } catch { return {}; } };
const saveFolded = (id, open, defaultOpen) => {
  try {
    const all = readFolded();
    if (open === defaultOpen) delete all[id]; else all[id] = open;
    localStorage.setItem(GROUPS_KEY, JSON.stringify(all));
  } catch {}
};
const calm = () => document.documentElement.classList.contains("reduce-motion") || document.body.classList.contains("reduce-motion") || !!document.querySelector(".reduce-motion") || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const scrollerOf = (el) => el?.closest(".sc") || null;

// Brief glow on whatever you were taken to
function glow(el) {
  if (!el) return;
  el.classList.remove("set-glow");
  void el.offsetWidth; // start the glow again if it's already showing
  el.classList.add("set-glow");
  clearTimeout(el.__setGlow);
  el.__setGlow = setTimeout(() => el.classList.remove("set-glow"), 1800);
}

// Opens the group a setting is in (if it's folded), scrolls to the setting, lights it up and
// puts the keyboard on it.
export function revealSetting(el, { focus = true } = {}) {
  if (!el) return;
  const group = el.closest(".sg");
  const wasClosed = !!group && group.classList.contains("closed");
  if (wasClosed) group.dispatchEvent(new CustomEvent("sg-open"));
  const go = () => {
    el.scrollIntoView({ block: el.classList.contains("sg") ? "start" : "center", behavior: calm() ? "auto" : "smooth" });
    glow(el);
    if (!focus) return;
    const control = el.matches(".sg") ? el.querySelector(".sg-tog") : el.querySelector('.tog,button:not([disabled]),select,input,[tabindex="0"]');
    try {
      if (control) control.focus({ preventScroll: true });
      else { el.setAttribute("tabindex", "-1"); el.focus({ preventScroll: true }); }
    } catch {}
  };
  if (wasClosed) setTimeout(go, calm() ? 0 : 280); else go();
}

// ── A group of settings that can be folded away ───────────────────────────────
// children: one settings section (<div className="ss"> with its title and card), as before.
// lazy: what's inside only exists while it's open (for Sound devices, which keeps asking Windows
// about your devices while it's showing).
export function SetGroup({ id, title, keywords = "", note = "", lazy = false, defaultOpen = true, children }) {
  const [open, setOpen] = useState(() => { const f = readFolded(); return typeof f[id] === "boolean" ? f[id] : defaultOpen; });
  const box = useRef(null);
  const toggle = useCallback((next) => {
    setOpen((cur) => {
      const v = typeof next === "boolean" ? next : !cur;
      saveFolded(id, v, defaultOpen);
      return v;
    });
  }, [id, defaultOpen]);
  useEffect(() => {
    const el = box.current;
    const openUp = () => toggle(true);
    el?.addEventListener("sg-open", openUp);
    return () => el?.removeEventListener("sg-open", openUp);
  }, [toggle]);
  const name = title || id;
  return (
    <div ref={box} className={`sg${open ? "" : " closed"}`} data-sg={id} data-title={name} data-keywords={keywords} data-note={note}>
      <button type="button" className="sg-tog" aria-expanded={open} aria-label={`${name}: ${open ? "fold away" : "show"} these settings`} title={open ? "Fold away" : "Show"} onClick={() => toggle()}>
        <svg className="sg-chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {lazy ? (
        <div className="ss">
          <div className="ss-t">{name}</div>
          <div className="sg-lazy">{open ? children : null}</div>
        </div>
      ) : children}
    </div>
  );
}

// One category: its heading, then its groups
export function SetCategory({ id, title, note, children }) {
  return (
    <section className="set-cat" data-cat={id} aria-labelledby={`set-h-${id}`}>
      <header className="set-cat-head">
        <h2 id={`set-h-${id}`} className="set-cat-h" tabIndex={-1}>{title}</h2>
        {note && <p className="set-cat-n">{note}</p>}
      </header>
      {children}
    </section>
  );
}

// ── Icons for the sidebar ─────────────────────────────────────────────────────
const P = {
  account: <><circle cx="12" cy="8.5" r="3.6" /><path d="M4.8 19.5a7.4 7.4 0 0 1 14.4 0" /></>,
  appearance: <><path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.8-1.8 0-1.3-1-1.6-1-2.6 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" /><circle cx="7.6" cy="11" r=".9" /><circle cx="10.4" cy="7.4" r=".9" /><circle cx="15" cy="7.6" r=".9" /></>,
  social: <><path d="M5 18.5V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8.5z" /><path d="M9 9.5h6M9 12.5h4" /></>,
  notifications: <><path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>,
  sound: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></>,
  capture: <><rect x="3" y="6.5" width="13" height="11" rx="2.5" /><path d="M16 10.5l5-3v9l-5-3" /></>,
  library: <><rect x="2.5" y="7" width="19" height="10" rx="5" /><path d="M7.5 10.5v3M6 12h3M15.5 11h.01M17.5 13h.01" /></>,
  performance: <><path d="M4.5 16a8 8 0 1 1 15 0" /><path d="M12 15.5l4-5.5" /><circle cx="12" cy="15.5" r="1.4" /></>,
  privacy: <><path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z" /><path d="M9 12l2.2 2.2L15.5 10" /></>,
  about: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.6h.01" /></>,
};
const Icon = ({ name }) => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[name] || P.about}</svg>
);

// ── The sidebar's list of categories, showing where you are ───────────────────
function SettingsNav({ cats, layout }) {
  const [active, setActive] = useState(cats[0]?.id || "");
  const list = useRef(null);
  const [mark, setMark] = useState(null); // where the moving highlight sits
  const held = useRef(0); // after a click, scrolling there doesn't move the highlight about
  useEffect(() => {
    const root = scrollerOf(layout.current);
    const main = layout.current?.querySelector(".set-main");
    if (!root || !main) return;
    // The category you're in: the last one whose heading has gone past a line near the top.
    // Worked out at most once a frame while scrolling.
    let frame = 0;
    const pick = () => {
      frame = 0;
      if (Date.now() < held.current) return;
      const sections = main.querySelectorAll(".set-cat");
      if (!sections.length) return;
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) { setActive(sections[sections.length - 1].dataset.cat); return; }
      const line = root.getBoundingClientRect().top + Math.min(160, root.clientHeight * 0.3);
      let id = sections[0].dataset.cat;
      for (const sec of sections) { if (sec.getBoundingClientRect().top <= line) id = sec.dataset.cat; else break; }
      setActive(id);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(pick); };
    root.addEventListener("scroll", onScroll, { passive: true });
    pick();
    return () => { root.removeEventListener("scroll", onScroll); cancelAnimationFrame(frame); };
  }, [layout]);
  useLayoutEffect(() => {
    const btn = list.current?.querySelector(`[data-nav="${active}"]`);
    if (!btn) return;
    setMark((m) => (m && m.y === btn.offsetTop && m.x === btn.offsetLeft && m.w === btn.offsetWidth && m.h === btn.offsetHeight ? m : { y: btn.offsetTop, x: btn.offsetLeft, w: btn.offsetWidth, h: btn.offsetHeight }));
    // In the narrow layout the list scrolls sideways: keep the current one in view
    if (list.current.scrollWidth > list.current.clientWidth + 2) {
      const l = list.current;
      if (btn.offsetLeft < l.scrollLeft || btn.offsetLeft + btn.offsetWidth > l.scrollLeft + l.clientWidth) l.scrollTo({ left: btn.offsetLeft - 12, behavior: calm() ? "auto" : "smooth" });
    }
  }, [active]);
  useEffect(() => {
    const re = () => { const btn = list.current?.querySelector(`[data-nav="${active}"]`); if (btn) setMark({ y: btn.offsetTop, x: btn.offsetLeft, w: btn.offsetWidth, h: btn.offsetHeight }); };
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(re) : null;
    if (ro && list.current) ro.observe(list.current);
    return () => ro?.disconnect();
  }, [active]);
  const go = (id) => {
    const sec = layout.current?.querySelector(`.set-cat[data-cat="${id}"]`);
    if (!sec) return;
    held.current = Date.now() + (calm() ? 120 : 900);
    setActive(id);
    sec.scrollIntoView({ block: "start", behavior: calm() ? "auto" : "smooth" });
    const head = sec.querySelector(".set-cat-head");
    glow(head);
    try { sec.querySelector(".set-cat-h")?.focus({ preventScroll: true }); } catch {}
  };
  const onKey = (e) => {
    const btns = [...list.current.querySelectorAll("[data-nav]")];
    const at = btns.indexOf(document.activeElement);
    const to = e.key === "ArrowDown" || e.key === "ArrowRight" ? at + 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? btns.length - 1 : null;
    if (to === null || at < 0) return;
    e.preventDefault();
    btns[(to + btns.length) % btns.length]?.focus();
  };
  return (
    <nav className="set-nav" aria-label="Settings categories">
      <div className="set-nav-list" ref={list} onKeyDown={onKey}>
        {mark && <span className="set-ind" aria-hidden="true" style={{ transform: `translate(${mark.x}px, ${mark.y}px)`, width: mark.w, height: mark.h }} />}
        {cats.map((c) => (
          <button key={c.id} type="button" data-nav={c.id} className={`set-nav-i${active === c.id ? " on" : ""}`} aria-current={active === c.id ? "true" : undefined} onClick={() => go(c.id)}>
            <Icon name={c.icon || c.id} /><span>{c.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

// ── Search ────────────────────────────────────────────────────────────────────
// Words that also find a setting, beyond its own name and description
const MORE_WORDS = {
  "signed in as": "account profile user username email",
  "edit profile": "username avatar picture photo bio name account",
  "log out": "sign out logout leave account",
  "delete account": "remove erase account data close",
  "ui scale": "zoom size bigger smaller text font",
  "card size": "game cards covers small medium large grid",
  "full screen": "f11 fullscreen maximize maximise window",
  "open in a window": "windowed maximized maximised size",
  "home banner": "slideshow hero banner background home",
  "launch animation": "overlay start game play",
  "show play counts": "playtime sessions hours stats",
  "seasonal decorations": "holiday christmas halloween winter theme decorations",
  "keep aura running when closed": "tray background close minimize minimise quit",
  "start aura when windows starts": "startup boot login sign in autostart",
  "ringtone": "call sound ring notification alert",
  "message sound": "notification chime alert ding",
  "ringtone and message volume": "notification alert loud quiet",
  "ui sounds": "clicks effects sfx beeps",
  "ui sound volume": "clicks effects sfx loud quiet",
  "trailer volume": "video youtube sound loud",
  "voice commands": "hey aura speech microphone talk speak dictation",
  "recording screen": "capture monitor display screen clip record",
  "shortcuts": "hotkey keyboard keys alt shift",
  "also use f9 to record": "hotkey key shortcut",
  "also use f10 for the aura bar": "hotkey key shortcut overlay",
  "recording quality": "fps frames resolution bitrate file size",
  "microphone": "mic input voice",
  "system audio": "stereo mix game sound desktop audio",
  "mic volume": "microphone loud quiet",
  "game volume": "system sound loud quiet",
  "camera": "webcam facecam video",
  "camera preview": "webcam facecam",
  "green screen": "chroma key background",
  "background": "blur replace webcam",
  "fetch missing cover art": "images artwork pictures igdb covers",
  "import steam games": "steam library add scan",
  "import epic games": "epic library add scan",
  "import xbox game pass": "xbox microsoft library add scan",
  "count games started outside aura": "track tracking playtime sessions",
  "reset library": "delete clear remove games empty",
  "reduce animations": "motion transitions movement performance lag smooth",
  "disable blur effects": "blur glass transparency performance fps slow lag",
  "privacy": "data policy personal information gdpr",
  "credits": "licenses licences open source igdb ffmpeg attribution",
  "feedback": "bug report idea contact support help",
  "aura game launcher": "version update updates about check",
  "error log": "logs crash debug",
};
const clean = (t) => String(t || "").replace(/\s+/g, " ").trim();
const words = (q) => clean(q).toLowerCase().split(" ").filter(Boolean);

function collect(main) {
  const out = [];
  for (const row of main.querySelectorAll(".sr")) {
    const lab = row.querySelector(".sr-l");
    if (!lab) continue;
    const label = clean(lab.childNodes[0]?.nodeType === 3 ? lab.childNodes[0].textContent : lab.textContent) || clean(lab.textContent);
    const desc = clean(row.querySelector(".sr-s")?.textContent);
    const cat = row.closest(".set-cat");
    const group = clean(row.closest(".ss")?.querySelector(".ss-t")?.textContent);
    const lower = label.toLowerCase();
    const extra = Object.keys(MORE_WORDS).filter((k) => lower === k || lower.startsWith(k + " ") || lower.startsWith(k)).map((k) => MORE_WORDS[k]).join(" ");
    out.push({ el: row, label, desc, where: [cat?.querySelector(".set-cat-h")?.textContent, group].filter(Boolean).join(" › "), hay: [label, desc, extra, group, clean(lab.textContent)].join(" ").toLowerCase(), labelLow: lower });
  }
  // Groups whose rows only exist while they're open (Sound devices)
  for (const g of main.querySelectorAll(".sg[data-keywords]")) {
    if (!g.dataset.keywords) continue;
    const label = g.dataset.title || "";
    const cat = g.closest(".set-cat");
    out.push({ el: g, label: label.charAt(0) + label.slice(1).toLowerCase(), desc: g.dataset.note || "", where: clean(cat?.querySelector(".set-cat-h")?.textContent), hay: [label, g.dataset.note, g.dataset.keywords].join(" ").toLowerCase(), labelLow: label.toLowerCase(), group: true });
  }
  return out;
}

function Highlight({ text, q }) {
  const ws = words(q).filter((w) => w.length > 1);
  if (!ws.length || !text) return text;
  const re = new RegExp("(" + ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "ig");
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

function SettingsSearch({ layout }) {
  const [q, setQ] = useState("");
  const [shown, setShown] = useState("");     // what the results are for (a moment after you stop typing)
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState(false);
  const input = useRef(null);
  const box = useRef(null);
  useEffect(() => { const t = setTimeout(() => { setShown(q); setAt(0); }, 90); return () => clearTimeout(t); }, [q]);
  const results = useMemo(() => {
    const ws = words(shown);
    const main = layout.current?.querySelector(".set-main");
    if (!ws.length || !main) return [];
    return collect(main)
      .filter((r) => ws.every((w) => r.hay.includes(w)))
      .map((r) => ({ ...r, score: (ws.every((w) => r.labelLow.includes(w)) ? 0 : 1) + (r.labelLow.startsWith(ws[0]) ? 0 : 0.5) }))
      .sort((a, b) => a.score - b.score)
      .slice(0, 12);
  }, [shown, layout]);
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", away, true);
    return () => document.removeEventListener("mousedown", away, true);
  }, [open]);
  // Ctrl + F jumps to the search while Settings is open
  useEffect(() => {
    const key = (e) => { if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "f" && layout.current?.isConnected) { e.preventDefault(); input.current?.focus(); input.current?.select(); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [layout]);
  const pick = (r) => {
    if (!r) return;
    setOpen(false);
    revealSetting(r.el);
  };
  const onKey = (e) => {
    if (e.key === "Escape") { if (q) { e.preventDefault(); e.stopPropagation(); setQ(""); setShown(""); } else input.current?.blur(); return; }
    if (!results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setAt((i) => (i + 1) % results.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setOpen(true); setAt((i) => (i - 1 + results.length) % results.length); }
    else if (e.key === "Enter") { e.preventDefault(); pick(results[at] || results[0]); }
  };
  const showing = open && !!words(shown).length;
  return (
    <div className="set-find" ref={box}>
      <div className="set-find-box">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
        <input ref={input} type="search" value={q} placeholder="Search settings" aria-label="Search settings" role="combobox" aria-expanded={showing} aria-controls="set-find-list" aria-autocomplete="list"
          aria-activedescendant={showing && results[at] ? `set-find-${at}` : undefined}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey} spellCheck={false} />
        {q && <button type="button" className="set-find-x" aria-label="Clear search" onClick={() => { setQ(""); setShown(""); input.current?.focus(); }}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>}
      </div>
      {showing && (
        <div className="set-find-pop" id="set-find-list" role="listbox" aria-label="Matching settings">
          {results.length ? results.map((r, i) => (
            <div key={i} id={`set-find-${i}`} role="option" aria-selected={i === at} className={`set-find-r${i === at ? " on" : ""}`}
              onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setAt(i)} onClick={() => pick(r)}>
              <span className="set-find-l"><Highlight text={r.label} q={shown} /></span>
              {r.desc && <span className="set-find-d"><Highlight text={r.desc.length > 90 ? r.desc.slice(0, 88) + "…" : r.desc} q={shown} /></span>}
              <span className="set-find-w">{r.where}</span>
            </div>
          )) : <div className="set-find-none" role="status">No settings match “{clean(shown)}”.</div>}
        </div>
      )}
    </div>
  );
}

// ── The whole page ────────────────────────────────────────────────────────────
// cats: [{ id, label, icon }] in the order the categories appear. children: the SetCategory sections.
export function SettingsLayout({ cats, children }) {
  const layout = useRef(null);
  return (
    <div className="set2" ref={layout}>
      <style>{CSS}</style>
      <aside className="set-side">
        <div className="set-side-in">
          <SettingsSearch layout={layout} />
          <SettingsNav cats={cats} layout={layout} />
        </div>
      </aside>
      <div className="set-main">{children}</div>
    </div>
  );
}

const CSS = `
.sc:has(> .set2){padding:0;container-type:inline-size;container-name:aura-settings;scroll-padding-top:16px}
.set2{text-align:left;display:grid;grid-template-columns:240px minmax(0,1fr);gap:0 30px;align-items:start;padding:0 28px 0 24px;min-height:100%}
.set-side{position:sticky;top:0;align-self:start;z-index:3;padding:24px 0}
.set-side-in{max-height:calc(100vh - 110px);padding:16px 12px 12px;border-radius:var(--radius);background:var(--card);border:1px solid var(--border);display:flex;flex-direction:column;gap:14px}
.set-nav{min-height:0;overflow-y:auto;margin:0 -4px;padding:0 4px;scrollbar-width:thin}
.set-side-t{font-family:'Rajdhani',sans-serif;font-size:24px;font-weight:700;letter-spacing:1px;color:var(--t1);padding:0 6px}
.set-main{padding:24px 0 40vh;max-width:880px;min-width:0}
/* Search */
.set-find{position:relative}
.set-find-box{display:flex;align-items:center;gap:8px;height:36px;padding:0 8px 0 11px;border-radius:10px;background:var(--bg);border:1px solid var(--border);color:var(--t2);transition:border-color .15s,box-shadow .15s}
.set-find-box:focus-within{border-color:var(--ac);box-shadow:0 0 0 3px var(--acd)}
.set-find-box input{flex:1;min-width:0;height:100%;border:0;outline:0;background:transparent;color:var(--t1);font:13px 'DM Sans',sans-serif}
.set-find-box input::placeholder{color:var(--t2);opacity:.7}
.set-find-box input::-webkit-search-cancel-button{display:none}
.set-find-x{width:22px;height:22px;border-radius:50%;border:0;background:var(--hover);color:var(--t2);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
.set-find-x:hover{color:var(--t1)}
.set-find-pop{position:absolute;top:calc(100% + 6px);left:0;width:min(380px,calc(100vw - 40px));max-height:min(440px,70vh);overflow-y:auto;padding:6px;border-radius:12px;background:var(--panel,var(--card));border:1px solid var(--borderb);box-shadow:0 18px 50px rgba(0,0,0,.55);z-index:20}
.set-find-r{display:flex;flex-direction:column;gap:2px;padding:9px 11px;border-radius:8px;cursor:pointer;text-align:left}
.set-find-r.on{background:var(--acd);box-shadow:inset 3px 0 0 var(--ac)}
.set-find-l{font-size:13px;font-weight:600;color:var(--t1)}
.set-find-d{font-size:11.5px;color:var(--t2);line-height:1.35}
.set-find-w{font-size:10.5px;color:var(--t2);opacity:.75;letter-spacing:.3px}
.set-find-r mark{background:transparent;color:var(--ac2);font-weight:700}
.set-find-none{padding:14px 12px;font-size:12.5px;color:var(--t2)}
/* Categories */
.set-nav-list{position:relative;display:flex;flex-direction:column;gap:2px}
.set-nav-i{position:relative;z-index:1;display:flex;align-items:center;gap:11px;width:100%;padding:9px 12px;border:0;border-radius:9px;background:transparent;color:var(--t2);font:500 13px 'DM Sans',sans-serif;text-align:left;cursor:pointer;transition:color .15s,background-color .15s}
.set-nav-i svg{flex-shrink:0;opacity:.85}
.set-nav-i:hover{color:var(--t1);background:var(--hover)}
.set-nav-i.on{color:var(--t1);background:transparent}
.set-nav-i.on svg{color:var(--ac);opacity:1}
.set-ind{position:absolute;left:0;top:0;border-radius:9px;background:var(--acd);box-shadow:inset 3px 0 0 var(--ac),0 0 18px -6px var(--acg);transition:transform .28s cubic-bezier(.2,.8,.2,1),width .28s,height .28s;pointer-events:none;will-change:transform}
.set-nav-i:focus-visible,.set-find-x:focus-visible,.sg-tog:focus-visible,.set-cat-h:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
/* Category headings */
.set-cat{scroll-margin-top:12px;margin-bottom:18px}
.set-cat + .set-cat{padding-top:18px;border-top:1px solid var(--border)}
.set-cat-head{padding:6px 10px 4px;margin:0 -10px 16px;border-radius:12px}
.set-cat-h{margin:0;font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:700;letter-spacing:.6px;color:var(--t1);outline:none}
.set-cat-n{margin:3px 0 0;font-size:12px;color:var(--t2)}
/* Groups that fold away */
.sg{position:relative;interpolate-size:allow-keywords;scroll-margin-top:16px}
.sg > .ss{transition:margin-bottom .26s ease}
.sg > .ss > .ss-t{position:relative;z-index:2;pointer-events:none;padding-right:34px}
.sg-tog{position:absolute;top:-6px;left:-8px;right:-8px;height:30px;z-index:1;display:flex;align-items:center;justify-content:flex-end;padding:0 10px;border:0;border-radius:8px;background:transparent;color:var(--t3);cursor:pointer;transition:background-color .15s,color .15s}
.sg-tog:hover{background:var(--hover);color:var(--t1)}
.sg-chev{transition:transform .26s ease}
.sg.closed .sg-chev{transform:rotate(-90deg)}
.sg > .ss > :not(.ss-t){height:auto;transition:height .26s ease,opacity .22s ease,visibility 0s linear 0s}
.sg.closed > .ss > :not(.ss-t){height:0;opacity:0;visibility:hidden;overflow:hidden;border-width:0;margin-top:0;margin-bottom:0;transition:height .26s ease,opacity .18s ease,visibility 0s linear .26s}
.sg.closed > .ss{margin-bottom:14px}
.sg.closed > .ss > .ss-t{margin-bottom:0}
.sg:not(:has(.ss)){display:none}
/* Brief glow on what you were taken to */
.set-glow{box-shadow:inset 0 0 0 2px var(--ac);animation:set-glow 1.8s ease-out forwards}
.sg.set-glow{box-shadow:none;animation:none}
.sg.set-glow > .ss > .ss-t{color:var(--ac2)}
@keyframes set-glow{0%{box-shadow:inset 0 0 0 2px var(--ac),0 0 0 0 var(--acg);background-color:var(--acd)}25%{box-shadow:inset 0 0 0 2px var(--ac),0 0 22px 2px var(--acg)}100%{box-shadow:inset 0 0 0 2px transparent,0 0 0 0 transparent;background-color:transparent}}
.set-cat-head.set-glow{animation-duration:1.4s}
@media (prefers-reduced-motion:reduce){
  .set-ind,.sg-chev,.sg > .ss,.sg > .ss > :not(.ss-t),.sg.closed > .ss > :not(.ss-t),.set-nav-i{transition:none!important}
  .set-glow{animation:none}
}
.reduce-motion .set-glow{animation:none!important}
/* Smaller windows: the categories go across the top */
@container aura-settings (max-width: 820px){
  .set2{grid-template-columns:minmax(0,1fr);padding:0 18px}
  .set-side{position:sticky;top:0;margin:0 -18px;padding:0;background:var(--bg);border-bottom:1px solid var(--border)}
  .set-side-in{max-height:none;padding:12px 18px 8px;border:0;border-radius:0;background:none;gap:10px}
  .set-nav{overflow:visible}
  .set-side-t{display:none}
  .set-nav-list{flex-direction:row;overflow-x:auto;gap:4px;padding-bottom:4px;scrollbar-width:thin}
  .set-nav-i{width:auto;flex-shrink:0;padding:7px 12px}
  .set-main{padding-top:18px;max-width:none}
  .set-cat,.sg{scroll-margin-top:118px}
}
`;
