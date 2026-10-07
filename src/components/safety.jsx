/**
 * AURA — safety net
 *
 * If a page hits an error, React would normally blank the whole window. These catch the error
 * instead, show a short message with a way to carry on, and note what happened in the error log
 * (a file on this PC; nothing is sent anywhere).
 *
 *   - PageBoundary   around one page: the rest of AURA keeps working
 *   - AppBoundary    around everything: the window is never left blank
 *   - ErrorLogButton opens the folder with the error log (used in Settings)
 *
 * Added by aura-reliability-setup.cjs.
 */
import { Component, useEffect } from "react";

// ── Noting errors in the log ──────────────────────────────────────────────────
let sent = 0;
const lately = new Map(); // message -> when it was last noted, so a repeating error isn't logged over and over
export function noteError(kind, where, error, extra) {
  try {
    const message = String(error?.message || error || "Unknown error").slice(0, 2000);
    const now = Date.now();
    if (now - (lately.get(message) || 0) < 10000 || sent >= 40) return;
    lately.set(message, now); sent++;
    window.electronAPI?.logError?.({
      kind, where: String(where || ""), message,
      stack: String(error?.stack || "").slice(0, 6000),
      detail: String(extra || "").slice(0, 3000),
    });
  } catch {}
}

// Errors outside of drawing a page (a click handler, a timer, a failed request nobody handled)
let watching = false;
function watchWindow() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  window.addEventListener("error", (e) => {
    if (!e.error && !e.message) return; // a picture or script that failed to load, not a code error
    noteError("window", "", e.error || e.message, e.filename ? `${e.filename}:${e.lineno}` : "");
  });
  window.addEventListener("unhandledrejection", (e) => noteError("promise", "", e.reason));
}
watchWindow();

const openLog = () => window.electronAPI?.openErrorLog?.();
const hasLog = () => typeof window !== "undefined" && !!window.electronAPI?.openErrorLog;
const nice = (name) => { const s = String(name || "This page").replace(/[-_]/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };

const CSS = `
.aura-fallback{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:32px;font-family:'DM Sans',sans-serif;color:var(--t1,#fff)}
.aura-fallback.whole{position:fixed;inset:0;z-index:9800;background:var(--bg,#14141c)}
.aura-fallback-in{width:min(460px,100%);padding:26px;border-radius:16px;text-align:center;background:var(--panel,#1a1f26);border:1px solid var(--border,rgba(255,255,255,.12))}
.aura-fallback h2{margin:0 0 8px;font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:700;letter-spacing:.4px}
.aura-fallback p{margin:0 0 16px;font-size:13.5px;line-height:1.55;color:var(--t2,#8b8b9e)}
.aura-fallback-what{margin:0 0 16px;padding:9px 12px;border-radius:8px;text-align:left;font:12px/1.45 ui-monospace,Consolas,monospace;color:var(--t2,#8b8b9e);background:rgba(0,0,0,.25);overflow-wrap:anywhere;max-height:84px;overflow:auto;user-select:text}
.aura-fallback-a{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}
.aura-fallback button{padding:9px 16px;border-radius:9px;cursor:pointer;font:600 12.5px 'DM Sans',sans-serif;background:var(--card,#2D4059);color:var(--t1,#fff);border:1px solid var(--border,rgba(255,255,255,.14))}
.aura-fallback button.go{background:var(--ac,#FF5722);border-color:transparent;color:#fff}
.aura-fallback button:hover{filter:brightness(1.12)}
.aura-fallback button:focus-visible,.aura-log-btn:focus-visible{outline:2px solid var(--ac2,var(--ac,#FF5722));outline-offset:2px}
.aura-log-btn{background:var(--card,#2D4059);border:1px solid var(--border,rgba(255,255,255,.12));color:var(--t1,#fff);border-radius:8px;padding:8px 14px;font:500 12px 'DM Sans',sans-serif;cursor:pointer;white-space:nowrap;flex-shrink:0}
.aura-log-btn:hover{border-color:var(--ac,#FF5722)}
`;
function ensureStyles() {
  if (typeof document === "undefined" || document.getElementById("aura-safety-styles")) return;
  const el = document.createElement("style");
  el.id = "aura-safety-styles";
  el.textContent = CSS;
  document.head.appendChild(el);
}

class Boundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.again = () => this.setState({ error: null });
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    ensureStyles();
    noteError(this.props.whole ? "app" : "page", this.props.name, error, info?.componentStack);
    // The Twitch player is a separate layer on top of the window. Take it down, or it would cover this message.
    if (this.props.whole || this.props.name === "streams") {
      try { window.electronAPI?.streamClose?.(); window.electronAPI?.chatClose?.(); } catch {}
    }
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const what = String(error?.message || error || "Unknown error").slice(0, 300);
    if (this.props.whole) {
      return (
        <div className="aura-fallback whole" role="alert">
          <div className="aura-fallback-in">
            <h2>AURA ran into a problem</h2>
            <p>Your library and your account are safe. Reload to carry on from where you were.</p>
            <div className="aura-fallback-what">{what}</div>
            <div className="aura-fallback-a">
              <button type="button" className="go" onClick={() => window.location.reload()}>Reload AURA</button>
              {hasLog() && <button type="button" onClick={openLog}>Open error log</button>}
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="aura-fallback" role="alert" data-page={this.props.name}>
        <div className="aura-fallback-in">
          <h2>{nice(this.props.name)} had a problem</h2>
          <p>The rest of AURA is still working. Try this page again, or use the menu to go somewhere else.</p>
          <div className="aura-fallback-what">{what}</div>
          <div className="aura-fallback-a">
            <button type="button" className="go" onClick={this.again}>Try again</button>
            {hasLog() && <button type="button" onClick={openLog}>Open error log</button>}
          </div>
        </div>
      </div>
    );
  }
}

// Around one page. `name` is the page's id (library, streams, messages...).
export function PageBoundary({ name, children }) { return <Boundary name={name}>{children}</Boundary>; }
// Around the whole app.
export function AppBoundary({ children }) { return <Boundary name="app" whole>{children}</Boundary>; }

// For Settings: opens the folder that holds the error log
export function ErrorLogButton() {
  useEffect(() => { ensureStyles(); }, []);
  if (!hasLog()) return null;
  return <button type="button" className="aura-log-btn" onClick={openLog}>Open error log</button>;
}
