/**
 * AURA accounts
 *
 * Everything the window needs for accounts lives in this file:
 *   - AuthGate      shows the log in / sign up page until someone is signed in
 *   - LogoutButton  the "Log out" row under your profile in the left panel
 *   - useAccount    lets the rest of AURA read the signed-in account
 *
 * How a request travels:
 *   this file  ->  window.auraCloud (preload.js)  ->  main.js  ->  supabase.js  ->  Supabase
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

// ── Talking to the backend ────────────────────────────────────────────────────

// True when this window can reach the account system (false in a plain browser preview)
export const cloudAvailable = () =>
  typeof window !== "undefined" && typeof window.auraCloud?.getSession === "function";

// Turn technical errors into something a player can act on
const FRIENDLY = [
  [/invalid login credentials/i, "Wrong email or password."],
  [/email not confirmed/i, "Confirm your email first. Open the link we sent you, then log in."],
  [/already registered|already has an account/i, "That email already has an account. Log in instead."],
  [/rate limit|too many requests|only request this after/i, "Too many tries. Wait a minute, then try again."],
  [/unable to validate email|email address .* invalid|invalid email/i, "That email address doesn't look right."],
  [/fetch failed|failed to fetch|network|enotfound|econn|etimedout|timed out/i, "Can't reach AURA's servers. Check your internet connection."],
];
export function friendlyError(message) {
  const text = String(message || "").trim();
  const hit = FRIENDLY.find(([pattern]) => pattern.test(text));
  return hit ? hit[1] : text || "Something went wrong. Try again.";
}

// Call one backend function. Returns its data, or throws an Error with a friendly message.
export async function cloudCall(method, ...args) {
  const fn = typeof window !== "undefined" ? window.auraCloud?.[method] : null;
  if (typeof fn !== "function") throw new Error("This copy of AURA can't reach AURA accounts.");
  let res;
  try { res = await fn(...args); } catch (e) { throw new Error(friendlyError(e?.message)); }
  if (!res || res.success !== true) throw new Error(friendlyError(res?.error));
  return res.data ?? null;
}

// Only web links are stored online. Pictures picked from the PC stay on the PC for now.
const webUrl = (value) => (typeof value === "string" && /^https?:\/\//i.test(value) ? value : undefined);

const USERNAME_RULE = /^[A-Za-z0-9_]{3,20}$/;
const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_HELP = "3 to 20 letters, numbers or underscores.";

// ── Account context ───────────────────────────────────────────────────────────

const LOCAL_ONLY = {
  enabled: false,
  user: null,
  requestLogout: () => {},
  saveProfile: async (profile) => ({ ok: true, profile }),
};
const AccountContext = createContext(LOCAL_ONLY);
export const useAccount = () => useContext(AccountContext);

// ── The gate ──────────────────────────────────────────────────────────────────
// user: undefined = still checking, null = signed out, object = signed in

export function AuthGate({ children, loadProfile, saveProfile, covers = [], calm = false }) {
  const enabled = cloudAvailable();
  const [user, setUser] = useState(enabled ? undefined : null);
  const [needsName, setNeedsName] = useState(null); // { user, mine, taken } while choosing a username
  const [confirming, setConfirming] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Save the profile on this PC, then let AURA load
  const enter = useCallback((account, username, mine) => {
    saveProfile({ createdAt: Date.now(), avatar: "", ...(mine || {}), userId: account.id, username });
    setNeedsName(null);
    setUser(account);
  }, [saveProfile]);

  // After a login (or a saved login at startup): work out this account's profile
  const resolveUser = useCallback(async (account) => {
    if (!account) { setNeedsName(null); setUser(null); return; }
    const local = loadProfile();
    // A profile saved on this PC by a different account is not ours
    const mine = local && (!local.userId || local.userId === account.id) ? local : null;
    let username = null;
    let taken = null;
    if (account.offline) {
      username = mine?.username || null;
    } else {
      let reachable = true;
      try { username = (await cloudCall("getMyProfile"))?.username || null; } catch { reachable = false; }
      if (!reachable) {
        username = mine?.username || null;
      } else if (!username) {
        // First login: create the online profile from the name chosen at sign up
        const wanted = account.username || mine?.username;
        if (wanted) {
          try { await cloudCall("saveProfile", wanted, webUrl(mine?.avatar)); username = wanted; }
          catch (e) { if (/taken/i.test(e.message)) taken = wanted; }
        }
      }
    }
    if (username) enter(account, username, mine);
    else { setUser(null); setNeedsName({ user: account, mine, taken }); }
  }, [loadProfile, enter]);

  // At startup, look for a saved login
  useEffect(() => {
    if (!enabled) {
      if (typeof window !== "undefined" && window.auraCloud) {
        console.warn("AURA accounts are off: preload.js still has the old auraCloud block.");
      }
      return;
    }
    let alive = true;
    cloudCall("getSession")
      .then((account) => { if (alive) resolveUser(account); })
      .catch(() => { if (alive) setUser(null); });
    return () => { alive = false; };
  }, [enabled, resolveUser]);

  const logOut = useCallback(async () => {
    setLoggingOut(true);
    try { await cloudCall("logOut"); } catch {}
    // Close any Twitch stream that sits on top of the window
    try { window.electronAPI?.streamClose?.(); window.electronAPI?.chatClose?.(); } catch {}
    setLoggingOut(false);
    setConfirming(false);
    setNeedsName(null);
    setUser(null);
  }, []);

  // Used by the Edit Profile window. Returns { ok, profile } or { ok: false, error }.
  const saveAccountProfile = useCallback(async (profile) => {
    const username = String(profile?.username || "").trim();
    if (!username) return { ok: false, error: "Enter a username." };
    if (user?.offline) {
      const current = loadProfile();
      if (current && current.username !== username) {
        return { ok: false, error: "You're offline. Reconnect to change your username." };
      }
    } else {
      try { await cloudCall("saveProfile", username, webUrl(profile.avatar)); }
      catch (e) { return { ok: false, error: e.message }; }
    }
    return { ok: true, profile: { ...profile, username, userId: user?.id } };
  }, [user, loadProfile]);

  const account = useMemo(() => ({
    enabled: true,
    user: user || null,
    requestLogout: () => setConfirming(true),
    saveProfile: saveAccountProfile,
  }), [user, saveAccountProfile]);

  if (!enabled) {
    return <AccountContext.Provider value={LOCAL_ONLY}>{children("local")}</AccountContext.Provider>;
  }

  return (
    <AccountContext.Provider value={account}>
      <style>{CSS}</style>
      {user === undefined && <Splash />}
      {user === null && !needsName && <AuthScreen covers={covers} calm={calm} onSignedIn={resolveUser} />}
      {user === null && needsName && (
        <UsernameStep
          covers={covers}
          calm={calm}
          taken={needsName.taken}
          onLogout={logOut}
          onDone={(username) => enter(needsName.user, username, needsName.mine)}
        />
      )}
      {user && children(user.id)}
      {user && confirming && (
        <LogoutDialog busy={loggingOut} onCancel={() => setConfirming(false)} onConfirm={logOut} />
      )}
    </AccountContext.Provider>
  );
}

// ── Log out button (left panel, under the profile) ────────────────────────────

const LogoutIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16" aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

// rail = the slim icon rail on Home, otherwise the wide sidebar. open = labels showing.
export function LogoutButton({ rail = false, open = true }) {
  const account = useAccount();
  if (!account.enabled) return null;
  const press = () => account.requestLogout();
  const onKey = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); press(); } };
  if (rail) {
    return (
      <div className="gm-rail-item aura-logout" role="button" tabIndex={0} title="Log out" onClick={press} onKeyDown={onKey}>
        <LogoutIcon />
        {open && <span className="gm-rail-item-label">Log out</span>}
      </div>
    );
  }
  return (
    <div className="aura-logout-wrap">
      <div className="sb-item aura-logout" role="button" tabIndex={0} title="Log out" onClick={press} onKeyDown={onKey}>
        <LogoutIcon />
        {open && <span>Log out</span>}
      </div>
    </div>
  );
}

function LogoutDialog({ busy, onCancel, onConfirm }) {
  const stay = useRef(null);
  useEffect(() => {
    stay.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="auth-dim" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-logout-title">
        <h2 id="auth-logout-title" className="auth-title">Log out of AURA?</h2>
        <p className="auth-text">Your games, clips and settings stay on this PC.</p>
        <div className="auth-dialog-actions">
          <button ref={stay} type="button" className="auth-btn ghost" onClick={onCancel}>Stay logged in</button>
          <button type="button" className="auth-btn danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Logging out…" : "Log out"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Screens ───────────────────────────────────────────────────────────────────

function Splash() {
  return (
    <div className="auth-splash">
      <img src="./aura-logo.png" alt="AURA" />
      <div className="auth-splash-sub">Developed By: Taurrean Traylor</div>
      <div className="auth-splash-bar" />
    </div>
  );
}

// A slow-moving wall of the covers from this PC's library
function CoverWall({ covers, calm }) {
  const columns = useMemo(() => {
    const list = covers.filter(Boolean).slice(0, 48);
    if (list.length < 3) return [];
    const COLUMNS = 12, PER_COLUMN = 6;
    return Array.from({ length: COLUMNS }, (_, c) =>
      Array.from({ length: PER_COLUMN }, (_, r) => list[(c * 5 + r) % list.length])
    );
  }, [covers]);
  return (
    <div className={`auth-wall${calm ? " calm" : ""}`} aria-hidden="true">
      <div className="auth-wall-grid">
        {columns.map((column, c) => (
          <div className="auth-wall-col" key={c}>
            {[...column, ...column].map((src, i) => (
              <img key={i} src={src} alt="" loading="lazy" draggable={false}
                onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function AuthShell({ covers, calm, children }) {
  return (
    <div className="auth">
      <CoverWall covers={covers} calm={calm} />
      <main className="auth-panel">
        <div className="auth-inner">
          <img className="auth-logo" src="./aura-logo.png" alt="AURA" />
          {children}
        </div>
      </main>
    </div>
  );
}

function AuthScreen({ covers, calm, onSignedIn }) {
  const [mode, setMode] = useState("login"); // "login" | "signup" | "sent"
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const firstField = useRef(null);

  useEffect(() => { firstField.current?.focus(); }, [mode]);

  const switchMode = (next) => {
    setMode(next);
    setError("");
    setNotice("");
    setPassword("");
    setShowPassword(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const mail = email.trim();
    setError("");
    setNotice("");

    if (mode === "signup") {
      const name = username.trim();
      if (!USERNAME_RULE.test(name)) { setError(`Usernames are ${USERNAME_HELP}`); return; }
      if (!EMAIL_RULE.test(mail)) { setError("Enter a valid email address."); return; }
      if (password.length < 8) { setError("Use at least 8 characters for your password."); return; }
      setBusy(true);
      try {
        const result = await cloudCall("signUp", mail, password, name);
        if (result?.user) { await onSignedIn(result.user); return; }
        setPassword("");
        setMode("sent");
      } catch (err) {
        setError(err.message);
      }
      setBusy(false);
      return;
    }

    if (!mail || !password) { setError("Enter your email and password."); return; }
    setBusy(true);
    try {
      await onSignedIn(await cloudCall("logIn", mail, password));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const resend = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await cloudCall("resendConfirmation", email.trim());
      setNotice("Sent. Check your inbox and your spam folder.");
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  if (mode === "sent") {
    return (
      <AuthShell covers={covers} calm={calm}>
        <h1 className="auth-title">Check your email</h1>
        <p className="auth-text">
          We sent a confirmation link to <strong>{email.trim()}</strong>. Open it, then come back here and log in.
        </p>
        {error && <div className="auth-msg err" role="alert">{error}</div>}
        {notice && <div className="auth-msg ok" role="status">{notice}</div>}
        <button type="button" className="auth-btn" onClick={() => switchMode("login")}>Log in</button>
        <p className="auth-alt">
          Nothing arrived?{" "}
          <button type="button" className="auth-link" onClick={resend} disabled={busy}>
            {busy ? "Sending…" : "Send the email again"}
          </button>
        </p>
      </AuthShell>
    );
  }

  const signingUp = mode === "signup";
  return (
    <AuthShell covers={covers} calm={calm}>
      <div className="auth-seg" role="group" aria-label="Account">
        <button type="button" className={!signingUp ? "on" : ""} aria-pressed={!signingUp} onClick={() => switchMode("login")}>Log in</button>
        <button type="button" className={signingUp ? "on" : ""} aria-pressed={signingUp} onClick={() => switchMode("signup")}>Sign up</button>
      </div>

      <form className="auth-form" onSubmit={submit} noValidate>
        {signingUp && (
          <div className="auth-field">
            <label className="auth-label" htmlFor="auth-username">Username</label>
            <input id="auth-username" ref={firstField} className="auth-input" value={username}
              onChange={(e) => setUsername(e.target.value)} maxLength={20} autoComplete="username"
              spellCheck={false} placeholder="How friends will find you" />
            <div className="auth-hint">{USERNAME_HELP}</div>
          </div>
        )}

        <div className="auth-field">
          <label className="auth-label" htmlFor="auth-email">Email</label>
          <input id="auth-email" ref={signingUp ? null : firstField} className="auth-input" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)} autoComplete="email" spellCheck={false}
            placeholder="you@example.com" />
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="auth-password">Password</label>
          <div className="auth-password">
            <input id="auth-password" className="auth-input" type={showPassword ? "text" : "password"} value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={signingUp ? "new-password" : "current-password"}
              placeholder={signingUp ? "At least 8 characters" : "Your password"} />
            <button type="button" className="auth-show" onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Hide password" : "Show password"}>
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        {error && <div className="auth-msg err" role="alert">{error}</div>}

        <button type="submit" className="auth-btn" disabled={busy}>
          {busy ? (signingUp ? "Creating account…" : "Logging in…") : (signingUp ? "Create account" : "Log in")}
        </button>
      </form>

      <p className="auth-alt">
        {signingUp ? "Already have an account? " : "New to AURA? "}
        <button type="button" className="auth-link" onClick={() => switchMode(signingUp ? "login" : "signup")}>
          {signingUp ? "Log in" : "Create an account"}
        </button>
      </p>
    </AuthShell>
  );
}

// Shown only when an account has no username yet (for example, the one from sign up was taken)
function UsernameStep({ covers, calm, taken, onDone, onLogout }) {
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(taken ? `"${taken}" is already taken. Pick another username.` : "");
  const field = useRef(null);
  useEffect(() => { field.current?.focus(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const name = username.trim();
    if (!USERNAME_RULE.test(name)) { setError(`Usernames are ${USERNAME_HELP}`); return; }
    setBusy(true);
    setError("");
    try {
      await cloudCall("saveProfile", name);
      onDone(name);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <AuthShell covers={covers} calm={calm}>
      <h1 className="auth-title">Pick a username</h1>
      <p className="auth-text">This is how friends will find you on AURA.</p>
      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="auth-field">
          <label className="auth-label" htmlFor="auth-newname">Username</label>
          <input id="auth-newname" ref={field} className="auth-input" value={username}
            onChange={(e) => setUsername(e.target.value)} maxLength={20} spellCheck={false} />
          <div className="auth-hint">{USERNAME_HELP}</div>
        </div>
        {error && <div className="auth-msg err" role="alert">{error}</div>}
        <button type="submit" className="auth-btn" disabled={busy}>{busy ? "Saving…" : "Continue"}</button>
      </form>
      <p className="auth-alt">
        Wrong account?{" "}
        <button type="button" className="auth-link" onClick={onLogout}>Log out</button>
      </p>
    </AuthShell>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
// Colors come from the active AURA theme (the --bg, --ac … variables), with the
// Midnight theme as the fallback when no theme has been applied yet.

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=DM+Sans:wght@300;400;500;600&display=swap');

.auth,.auth-splash,.auth-dim{
  --a-bg:var(--bg,#222831);--a-panel:var(--panel,#1a1f26);--a-card:var(--card,#2D4059);
  --a-ac:var(--ac,#FF5722);--a-ac2:var(--ac2,#ff8a65);
  --a-acd:var(--acd,rgba(255,87,34,.13));--a-acg:var(--acg,rgba(255,87,34,.35));
  --a-t1:#fff;--a-t2:#a3abb8;--a-line:rgba(255,255,255,.1);--a-danger:#ff4d6d;
  font-family:'DM Sans',system-ui,sans-serif;color:var(--a-t1);
}
.auth *,.auth-splash *,.auth-dim *{box-sizing:border-box;margin:0;padding:0}
html,body{margin:0;background:var(--bg,#222831)}

@keyframes auth-in{from{opacity:0}to{opacity:1}}
@keyframes auth-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes auth-drift{from{transform:translateY(0)}to{transform:translateY(-50%)}}

/* Startup check: matches AURA's own splash so the hand-off is seamless */
.auth-splash{position:fixed;inset:0;z-index:1000;background:var(--a-bg);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px}
.auth-splash img{width:320px;max-width:80vw;height:auto;display:block}
.auth-splash-sub{font-size:11px;color:#00aaff;letter-spacing:4px;text-transform:uppercase}
.auth-splash-bar{width:200px;height:2px;background:rgba(255,255,255,.06);border-radius:2px;margin-top:8px}

/* Page */
.auth{position:fixed;inset:0;z-index:900;display:flex;background:var(--a-bg);overflow:hidden}

/* Cover wall */
.auth-wall{position:relative;flex:1;min-width:0;overflow:hidden;background:
  radial-gradient(60% 50% at 30% 35%,var(--a-acd),transparent 70%),var(--a-bg)}
.auth-wall-grid{position:absolute;inset:-25% -15%;display:flex;justify-content:center;align-items:flex-start;gap:14px;transform:rotate(-7deg);filter:brightness(.62) saturate(1.05)}
.auth-wall-col{flex:0 0 22.5vh;animation:auth-drift 110s linear infinite;will-change:transform}
.auth-wall-col:nth-child(even){animation-direction:reverse;animation-duration:135s}
.auth-wall-col img{display:block;width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:12px;margin-bottom:14px;background:var(--a-card);user-select:none}
.auth-wall::after{content:'';position:absolute;inset:0;pointer-events:none;background:
  linear-gradient(90deg,transparent 35%,var(--a-panel) 100%),
  linear-gradient(180deg,rgba(0,0,0,.45) 0%,transparent 28%,transparent 72%,rgba(0,0,0,.5) 100%)}
.auth-wall.calm .auth-wall-col,.reduce-motion .auth-wall-col{animation:none}
@media (prefers-reduced-motion:reduce){.auth-wall-col{animation:none}.auth-inner,.auth-dim,.auth-dialog{animation:none!important}}

/* Form side */
.auth-panel{width:440px;flex-shrink:0;background:var(--a-panel);border-left:1px solid var(--a-line);display:flex;overflow-y:auto;padding:36px 48px}
.auth-inner{width:100%;margin:auto 0;display:flex;flex-direction:column;animation:auth-rise .4s ease .05s both}
.auth-logo{width:168px;height:auto;display:block;margin:0 0 30px -4px}
.auth-title{font-family:'Rajdhani',sans-serif;font-size:26px;font-weight:700;letter-spacing:.5px;line-height:1.15;margin-bottom:10px}
.auth-text{font-size:13.5px;line-height:1.6;color:var(--a-t2);margin-bottom:22px}
.auth-text strong{color:var(--a-t1);font-weight:600;overflow-wrap:anywhere}

.auth-seg{display:flex;background:var(--a-bg);border:1px solid var(--a-line);border-radius:11px;padding:3px;margin-bottom:24px}
.auth-seg button{flex:1;background:transparent;border:none;color:var(--a-t2);font-family:inherit;font-size:13px;font-weight:600;padding:9px 0;border-radius:8px;cursor:pointer;transition:color .15s,background .15s}
.auth-seg button:hover{color:var(--a-t1)}
.auth-seg button.on{background:var(--a-ac);color:#fff}

.auth-form{display:flex;flex-direction:column;gap:16px}
.auth-label{display:block;font-size:10px;font-weight:600;color:var(--a-t2);margin-bottom:6px;letter-spacing:.5px;text-transform:uppercase}
.auth-input{width:100%;background:var(--a-card);border:1px solid var(--a-line);border-radius:9px;padding:11px 13px;color:var(--a-t1);font-size:13.5px;font-family:inherit;outline:none;transition:border-color .15s,box-shadow .15s}
.auth-input::placeholder{color:rgba(255,255,255,.32)}
.auth-input:focus{border-color:var(--a-ac);box-shadow:0 0 0 3px var(--a-acd)}
.auth-hint{font-size:11px;color:var(--a-t2);margin-top:6px}
.auth-password{position:relative}
.auth-password .auth-input{padding-right:62px}
.auth-show{position:absolute;right:5px;top:50%;transform:translateY(-50%);background:transparent;border:none;color:var(--a-t2);font-family:inherit;font-size:11px;font-weight:600;padding:7px 9px;border-radius:6px;cursor:pointer}
.auth-show:hover{color:var(--a-t1)}

.auth-msg{border-radius:9px;padding:10px 12px;font-size:12.5px;line-height:1.45}
.auth-msg.err{background:rgba(255,77,109,.1);border:1px solid rgba(255,77,109,.32);color:#ff9bae}
.auth-msg.ok{background:var(--a-acd);border:1px solid var(--a-acg);color:var(--a-t1)}
.auth-text + .auth-msg,.auth-msg + .auth-msg{margin-top:-6px}
.auth-inner > .auth-msg + .auth-btn{margin-top:16px}

.auth-btn{display:block;width:100%;background:var(--a-ac);color:#fff;border:1px solid transparent;border-radius:10px;padding:12px 16px;font-family:'Rajdhani',sans-serif;font-size:15px;font-weight:700;letter-spacing:1.2px;cursor:pointer;transition:filter .15s,transform .15s,box-shadow .15s}
.auth-btn:hover:not(:disabled){filter:brightness(1.1);transform:translateY(-1px);box-shadow:0 6px 18px var(--a-acg)}
.auth-btn:active:not(:disabled){transform:none}
.auth-btn:disabled{opacity:.6;cursor:default}
.auth-btn.ghost{background:transparent;border-color:var(--a-line);color:var(--a-t1)}
.auth-btn.ghost:hover:not(:disabled){box-shadow:none;border-color:rgba(255,255,255,.3)}
.auth-btn.danger{background:rgba(255,77,109,.14);border-color:rgba(255,77,109,.4);color:#ff8fa3}
.auth-btn.danger:hover:not(:disabled){background:rgba(255,77,109,.24);box-shadow:none}

.auth-alt{font-size:12.5px;color:var(--a-t2);margin-top:20px}
.auth-link{background:none;border:none;color:var(--a-ac2);font-family:inherit;font-size:inherit;font-weight:600;cursor:pointer;padding:0}
.auth-link:hover:not(:disabled){text-decoration:underline}
.auth-link:disabled{opacity:.6;cursor:default}

.auth button:focus-visible,.auth-dim button:focus-visible,.aura-logout:focus-visible{outline:2px solid var(--ac,#FF5722);outline-offset:2px}

@media (max-width:860px){
  .auth-wall{display:none}
  .auth-panel{width:100%;border-left:none;justify-content:center}
  .auth-inner{max-width:360px}
}

/* Log out confirmation */
.auth-dim{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.8);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px;animation:auth-in .18s ease}
.auth-dialog{width:380px;max-width:100%;background:var(--a-panel);border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:26px 26px 22px;box-shadow:0 32px 80px rgba(0,0,0,.7);animation:auth-rise .2s ease}
.auth-dialog .auth-title{font-size:21px}
.auth-dialog-actions{display:flex;gap:10px}
.auth-dialog-actions .auth-btn{font-size:14px;padding:10px 12px}

/* Log out row in AURA's left panel */
.sb .sb-sec{flex:1 1 auto;min-height:0;overflow-y:auto}
.sb .sb-foot{flex-shrink:0}
.aura-logout-wrap{flex-shrink:0;padding:0 10px 2px}
.sb-item.aura-logout{margin-bottom:0}
.gm-rail-item.aura-logout{flex-shrink:0}
.sb-item.aura-logout:hover,.gm-rail-item.aura-logout:hover{background:rgba(255,77,109,.12);color:#ff4d6d}
/* Keep it clear of the Now Playing bar */
:root:has(.now-playing) .sb{padding-bottom:72px}
:root:has(.now-playing) .gm-rail{padding-bottom:88px}
`;
