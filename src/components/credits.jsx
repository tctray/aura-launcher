// AURA — Settings > About > Credits and licenses: the services AURA uses, the open-source software
// it includes, and FFmpeg's licence (the GPL) with where to get its source. The full text is the
// THIRD-PARTY-NOTICES.md file, which also ships with AURA.
// Added by aura-credits-setup.cjs.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import NOTICES from "../../THIRD-PARTY-NOTICES.md?raw";

// The notices file, split into its sections (headings, paragraphs and lists)
function sections(text) {
  const body = text.replace(/\r\n/g, "\n").replace(/^<!--[\s\S]*?-->\n/, "");
  const fence = body.indexOf("\n```");
  const head = fence >= 0 ? body.slice(0, fence) : body;
  const license = fence >= 0 ? body.slice(fence + 4).replace(/^\n/, "").replace(/\n```\s*$/, "") : "";
  const out = [];
  let cur = null;
  for (const line of head.split("\n")) {
    if (line.startsWith("# ")) continue;
    if (line.startsWith("## ")) { cur = { title: line.slice(3), parts: [] }; out.push(cur); continue; }
    if (!line.trim()) continue;
    if (!cur) { cur = { title: "", parts: [] }; out.push(cur); }
    if (line.startsWith("- ")) { const last = cur.parts[cur.parts.length - 1]; if (Array.isArray(last)) last.push(line.slice(2)); else cur.parts.push([line.slice(2)]); }
    else cur.parts.push(line);
  }
  return { list: out, license };
}
const LINK = /(https?:\/\/[^\s),]*[^\s),.;:!?]|aura\.launcherofficial@gmail\.com)/g; // a full stop after a link isn't part of it
function open(url) {
  const u = url.includes("@") && !url.startsWith("http") ? "mailto:" + url : url;
  if (window.electronAPI?.openExternal) window.electronAPI.openExternal(u);
  else window.open(u, "_blank", "noopener");
}
const withLinks = (text) => text.split(LINK).map((bit, i) => (i % 2 ? <button key={i} type="button" className="cr-link" onClick={() => open(bit)}>{bit}</button> : bit));

export function CreditsPage({ onClose }) {
  const [full, setFull] = useState(false);
  const { list, license } = sections(NOTICES);
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", esc, true);
    return () => document.removeEventListener("keydown", esc, true);
  }, [onClose]);
  return createPortal(
    <div className="cr-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{CSS}</style>
      <div className="cr" role="dialog" aria-modal="true" aria-labelledby="cr-title">
        <div className="cr-head">
          <h1 id="cr-title">Credits and licenses</h1>
          <button type="button" className="cr-x" onClick={onClose} aria-label="Close" autoFocus>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="cr-body">
          {list.map((s, n) => (
            <section key={n}>
              {s.title && <h2>{s.title}</h2>}
              {s.parts.map((p, i) => (Array.isArray(p) ? <ul key={i}>{p.map((l, j) => <li key={j}>{withLinks(l)}</li>)}</ul> : <p key={i}>{withLinks(p)}</p>))}
            </section>
          ))}
          {license && (
            <section>
              <button type="button" className="cr-open" aria-expanded={full} onClick={() => setFull((f) => !f)}>{full ? "Hide the GPL text" : "Show the full GPL text"}</button>
              {full && <pre className="cr-pre" tabIndex={0}>{license}</pre>}
            </section>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function CreditsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="pp-open cr-btn" onClick={() => setOpen(true)}>Credits and licenses</button>
      {open && <CreditsPage onClose={() => setOpen(false)} />}
    </>
  );
}

const CSS = `
.cr-veil{position:fixed;inset:0;z-index:9990;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.7);backdrop-filter:blur(6px)}
.cr{width:min(720px,100%);max-height:100%;display:flex;flex-direction:column;border-radius:16px;background:var(--panel,#1a1f26);border:1px solid var(--borderb,rgba(255,255,255,.14));box-shadow:0 30px 90px rgba(0,0,0,.6);color:var(--t1,#fff);text-align:left}
.cr-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 22px;border-bottom:1px solid var(--border,rgba(255,255,255,.1))}
.cr-head h1{margin:0;font:700 18px 'DM Sans',sans-serif;color:var(--t1,#fff);-webkit-text-fill-color:currentColor;background:none;opacity:1;filter:none}
.cr-x{width:34px;height:34px;flex-shrink:0;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(255,255,255,.06);border:1px solid var(--border,rgba(255,255,255,.12));color:var(--t1,#fff)}
.cr-x:hover{background:rgba(255,255,255,.14)}
.cr-body{overflow-y:auto;padding:6px 22px 22px;font-size:13px;line-height:1.6;color:rgba(255,255,255,.86)}
.cr-body h2{margin:18px 0 6px;font:600 14px 'DM Sans',sans-serif;color:var(--t1,#fff)}
.cr-body p{margin:6px 0}
.cr-body ul{margin:6px 0;padding-left:20px}
.cr-body li{margin:3px 0}
.cr-link{background:none;border:none;padding:0;font:inherit;color:var(--ac,#FF5722);text-decoration:underline;cursor:pointer}
.cr-open{margin-top:12px;background:var(--card,#2D4059);border:1px solid var(--border,rgba(255,255,255,.12));color:var(--t1,#fff);border-radius:8px;padding:8px 14px;font:500 12px 'DM Sans',sans-serif;cursor:pointer}
.cr-open:hover{border-color:var(--ac,#FF5722)}
.cr-pre{margin:12px 0 0;max-height:360px;overflow:auto;padding:14px;border-radius:10px;background:rgba(0,0,0,.35);font:11.5px/1.5 Consolas,'Courier New',monospace;white-space:pre-wrap;color:rgba(255,255,255,.8)}
.cr-x:focus-visible,.cr-link:focus-visible,.cr-open:focus-visible,.cr-pre:focus-visible{outline:2px solid var(--ac,#FF5722);outline-offset:2px}
`;
