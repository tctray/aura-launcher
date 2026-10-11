/**
 * AURA — feedback
 *
 *   - FeedbackButton    a button (used in Settings) that opens a short form: what kind of
 *                       feedback it is, the message, and an email address if a reply is wanted
 *
 * The form is sent through Web3Forms (web3forms.com), which turns it into an email to the
 * developer. The developer's email address is not in AURA or anywhere in this project:
 * Web3Forms keeps it, and AURA only holds the form's access key (FEEDBACK_FORM below). That key
 * is meant to be seen. It is the same kind of key a website's contact form shows every visitor,
 * and all it can do is send a message to the developer.
 *
 * To use a different key:   node aura-feedback-setup.cjs --key=THE-NEW-KEY
 *
 * Added by aura-feedback-setup.cjs.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const FEEDBACK_FORM = "ca4f8c1f-2d36-4114-9bb4-fe9185e9b833";
const SEND_TO = "https://api.web3forms.com/submit";
const LONGEST = 4000;      // characters in a message
const SHORTEST = 10;
const A_DAY = 24 * 60 * 60 * 1000;
const PER_DAY = 10;        // messages from one PC in a day (the free form allows 250 a month in all)
const SENT_KEY = "aura_feedback_sent";
const WAIT_MS = 20000;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const KINDS = [
  { id: "bug", label: "A bug", ask: "What happened, and what were you doing when it happened?" },
  { id: "idea", label: "An idea", ask: "What would you like AURA to do?" },
  { id: "other", label: "Something else", ask: "What's on your mind?" },
];

// What you've typed is kept while AURA is open, so closing the form by accident loses nothing
let draft = { kind: "bug", text: "", reply: "" };

const sentToday = () => {
  try {
    const list = JSON.parse(localStorage.getItem(SENT_KEY) || "[]");
    return Array.isArray(list) ? list.filter((t) => typeof t === "number" && Date.now() - t < A_DAY && t <= Date.now()) : [];
  } catch { return []; }
};
const noteSent = () => { try { localStorage.setItem(SENT_KEY, JSON.stringify([...sentToday(), Date.now()])); } catch {} };
const myUsername = () => {
  try { return String(JSON.parse(localStorage.getItem("aura_profile") || "null")?.username || "").slice(0, 40); } catch { return ""; }
};

// Sends one message. Answers { ok: true } or { ok: false, why } and never throws.
async function sendFeedback({ kind, text, reply, version }) {
  const label = (KINDS.find((k) => k.id === kind) || KINDS[2]).label;
  const name = myUsername() || "(no username)";
  const body = {
    access_key: FEEDBACK_FORM,
    subject: "AURA feedback: " + label.toLowerCase() + " from " + name,
    from_name: "AURA feedback",
    type: label,
    message: text,
    username: name,
    aura_version: version || "unknown",
  };
  if (reply) body.email = reply; // Web3Forms makes this the address a reply goes to
  const stopper = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => stopper?.abort(), WAIT_MS);
  try {
    const res = await fetch(SEND_TO, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: stopper?.signal,
    });
    let answer = null;
    try { answer = await res.json(); } catch {}
    if (res.ok && answer?.success === true) return { ok: true };
    return { ok: false, why: res.status === 429 ? "busy" : "refused" };
  } catch {
    return { ok: false, why: "offline" };
  } finally {
    clearTimeout(timer);
  }
}

const PROBLEMS = {
  offline: "Couldn't send it. Check your internet connection and try again.",
  busy: "The feedback service is busy right now. Try again in a few minutes.",
  refused: "Couldn't send it right now. Try again later.",
  tooMany: "You've sent a lot of feedback today, thank you. You can send more tomorrow.",
};

const CSS = `
.fb-open{background:var(--card,#2D4059);border:1px solid var(--border,rgba(255,255,255,.12));color:var(--t1,#fff);border-radius:8px;padding:8px 14px;font:500 12px 'DM Sans',sans-serif;cursor:pointer;white-space:nowrap;flex-shrink:0}
.fb-open:hover{border-color:var(--ac,#FF5722)}
.fb-veil{position:fixed;inset:0;z-index:9500;display:flex;align-items:center;justify-content:center;padding:28px;background:rgba(4,4,8,.78);font-family:'DM Sans',sans-serif}
.fb{position:relative;width:min(500px,100%);max-height:100%;display:flex;flex-direction:column;border-radius:16px;background:var(--panel,#1a1f26);border:1px solid var(--borderb,rgba(255,255,255,.14));box-shadow:0 30px 90px rgba(0,0,0,.6);color:var(--t1,#fff)}
.fb-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px 22px 14px;border-bottom:1px solid var(--border,rgba(255,255,255,.08));flex-shrink:0}
.fb-head h1{margin:0;font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:700;letter-spacing:.5px;line-height:1.1;color:var(--t1,#fff)}
.fb-lead{margin-top:4px;font-size:12px;color:var(--t2,#8b8b9e)}
.fb-x{width:32px;height:32px;flex-shrink:0;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(255,255,255,.06);border:1px solid var(--border,rgba(255,255,255,.12));color:var(--t1,#fff)}
.fb-x:hover{background:rgba(255,255,255,.14)}
.fb-body{padding:16px 22px 4px;overflow-y:auto}
.fb-kinds{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.fb-kind{background:transparent;border:1px solid var(--border,rgba(255,255,255,.14));color:var(--t2,#8b8b9e);border-radius:20px;padding:7px 14px;font:600 12px 'DM Sans',sans-serif;cursor:pointer}
.fb-kind:hover{color:var(--t1,#fff)}
.fb-kind.on{background:var(--ac,#FF5722);border-color:var(--ac,#FF5722);color:#fff}
.fb-label{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:10px;font-weight:600;color:var(--t2,#8b8b9e);margin-bottom:5px;letter-spacing:.5px;text-transform:uppercase}
.fb-label span{text-transform:none;letter-spacing:0;font-weight:500}
.fb-field{width:100%;box-sizing:border-box;background:var(--card,#2D4059);border:1px solid var(--border,rgba(255,255,255,.12));border-radius:9px;padding:10px 13px;color:var(--t1,#fff);font:400 13px/1.5 'DM Sans',sans-serif;outline:none;user-select:text}
.fb-field::placeholder{color:var(--t2,#8b8b9e);opacity:.75}
.fb-field:focus{border-color:var(--ac,#FF5722)}
textarea.fb-field{display:block;height:150px;resize:vertical;min-height:90px;max-height:320px;margin-bottom:14px}
.fb-note{margin:10px 0 0;font-size:11.5px;line-height:1.5;color:var(--t2,#8b8b9e)}
.fb-problem{margin:12px 0 0;padding:10px 12px;border-radius:9px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.35);color:#fecaca;font-size:12.5px;line-height:1.45;display:flex;align-items:center;justify-content:space-between;gap:12px}
.fb-copy{background:none;border:none;padding:0;cursor:pointer;font:600 12px 'DM Sans',sans-serif;color:#fff;text-decoration:underline;white-space:nowrap;flex-shrink:0}
.fb-foot{padding:16px 22px 20px;display:flex;gap:8px;justify-content:flex-end;flex-shrink:0}
.fb-btn{border-radius:9px;padding:9px 18px;font:600 12px 'DM Sans',sans-serif;cursor:pointer;background:transparent;border:1px solid var(--border,rgba(255,255,255,.14));color:var(--t2,#8b8b9e)}
.fb-btn:hover{color:var(--t1,#fff)}
.fb-btn.send{background:var(--ac,#FF5722);border-color:var(--ac,#FF5722);color:#fff;min-width:84px}
.fb-btn.send:disabled{opacity:.45;cursor:default}
.fb-sent{padding:34px 22px 10px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px}
.fb-tick{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;background:rgba(34,197,94,.15);color:#22c55e;margin-bottom:8px}
.fb-sent h2{margin:0;font-family:'Rajdhani',sans-serif;font-size:21px;font-weight:700;letter-spacing:.4px;line-height:1.2;color:var(--t1,#fff)}
.fb-sent p{margin:0;font-size:13px;color:var(--t2,#8b8b9e);max-width:36ch;line-height:1.5}
.fb-open:focus-visible,.fb-x:focus-visible,.fb-kind:focus-visible,.fb-btn:focus-visible,.fb-copy:focus-visible{outline:2px solid var(--ac,#FF5722);outline-offset:2px}
`;
function ensureStyles() {
  if (document.getElementById("aura-feedback-styles")) return;
  const el = document.createElement("style");
  el.id = "aura-feedback-styles";
  el.textContent = CSS;
  document.head.appendChild(el);
}

export function FeedbackForm({ onClose }) {
  const [kind, setKind] = useState(draft.kind);
  const [text, setText] = useState(draft.text);
  const [reply, setReply] = useState(draft.reply);
  const [stage, setStage] = useState("form"); // form, sending, sent
  const [problem, setProblem] = useState("");
  const [canCopy, setCanCopy] = useState(false); // offered when sending failed, so the message isn't lost
  const [copied, setCopied] = useState(false);
  const version = useRef("");
  const box = useRef(null);
  const busy = stage === "sending";

  useEffect(() => { draft = { kind, text, reply }; }, [kind, text, reply]);
  useEffect(() => {
    ensureStyles();
    box.current?.focus();
    let live = true;
    Promise.resolve(window.electronAPI?.checkUpdate?.()).then((r) => { if (live && r?.current) version.current = String(r.current).slice(0, 20); }).catch(() => {});
    return () => { live = false; };
  }, []);
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); if (!busy) onClose(); } };
    document.addEventListener("keydown", esc, true);
    return () => document.removeEventListener("keydown", esc, true);
  }, [onClose, busy]);

  const message = text.trim();
  const address = reply.trim();
  const ready = message.length >= SHORTEST && !busy;
  const name = myUsername();

  const send = async () => {
    if (!ready) return;
    setCopied(false);
    setCanCopy(false);
    if (address && !EMAIL_SHAPE.test(address)) { setProblem("That email address doesn't look right. Fix it, or leave it empty."); return; }
    if (sentToday().length >= PER_DAY) { setProblem(PROBLEMS.tooMany); return; }
    setProblem("");
    setStage("sending");
    const result = await sendFeedback({ kind, text: message.slice(0, LONGEST), reply: address, version: version.current });
    if (result.ok) {
      noteSent();
      setText("");
      setStage("sent");
    } else {
      setProblem(PROBLEMS[result.why] || PROBLEMS.refused);
      setCanCopy(true);
      setStage("form");
    }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(message); setCopied(true); } catch {} };

  return createPortal(
    <div className="fb-veil" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="fb" role="dialog" aria-modal="true" aria-labelledby="fb-title">
        {stage === "sent" ? (
          <>
            <div className="fb-sent" role="status">
              <div className="fb-tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" width="26" height="26" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
              <h2 id="fb-title">Feedback sent</h2>
              <p>Thank you. It goes straight to the developer.</p>
            </div>
            <div className="fb-foot" style={{ justifyContent: "center" }}><button type="button" className="fb-btn send" onClick={onClose} autoFocus>Close</button></div>
          </>
        ) : (
          <>
            <div className="fb-head">
              <div><h1 id="fb-title">Send feedback</h1><div className="fb-lead">Tell the developer what's broken or what would make AURA better.</div></div>
              <button type="button" className="fb-x" onClick={() => { if (!busy) onClose(); }} aria-label="Close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
              </button>
            </div>
            <div className="fb-body">
              <div className="fb-kinds" role="radiogroup" aria-label="What kind of feedback">
                {KINDS.map((k) => (
                  <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} className={"fb-kind" + (kind === k.id ? " on" : "")} onClick={() => setKind(k.id)} disabled={busy}>{k.label}</button>
                ))}
              </div>
              <label className="fb-label" htmlFor="fb-text">Your message <span>{text.length > LONGEST - 500 ? text.length + " / " + LONGEST : ""}</span></label>
              <textarea id="fb-text" ref={box} className="fb-field" value={text} maxLength={LONGEST} disabled={busy}
                placeholder={(KINDS.find((k) => k.id === kind) || KINDS[0]).ask}
                onChange={(e) => { setText(e.target.value); if (problem) setProblem(""); }}/>
              <label className="fb-label" htmlFor="fb-reply">Your email <span>Optional. Only if you'd like a reply.</span></label>
              <input id="fb-reply" className="fb-field" type="email" value={reply} maxLength={120} disabled={busy} autoComplete="off" spellCheck={false}
                placeholder="name@example.com" onChange={(e) => { setReply(e.target.value); if (problem) setProblem(""); }}/>
              <p className="fb-note">Sent with your message: {name ? <>your AURA username ({name})</> : "your AURA username"} and the version of AURA you're using. Please don't include passwords.</p>
              {problem && (
                <div className="fb-problem" role="alert">
                  <span>{problem}</span>
                  {canCopy && message && <button type="button" className="fb-copy" onClick={copy}>{copied ? "Copied" : "Copy my message"}</button>}
                </div>
              )}
            </div>
            <div className="fb-foot">
              <button type="button" className="fb-btn" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className="fb-btn send" onClick={send} disabled={!ready}>{busy ? "Sending…" : "Send"}</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

// The button that opens the form
export function FeedbackButton({ children }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { ensureStyles(); }, []);
  return (
    <>
      <button type="button" className="fb-open" onClick={() => setOpen(true)}>{children || "Send feedback"}</button>
      {open && <FeedbackForm onClose={() => setOpen(false)} />}
    </>
  );
}

export default FeedbackButton;
