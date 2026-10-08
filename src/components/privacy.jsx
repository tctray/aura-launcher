/**
 * AURA — privacy policy
 *
 *   - PrivacyPolicy     the policy as a page over the app (Esc or the X closes it)
 *   - PrivacyButton     a button that opens it; used in Settings and in the Friends panel
 *
 * The same words are saved as PRIVACY.md in the project folder, so the policy also has a page
 * on GitHub. If you change what AURA stores or who it talks to, change both.
 *
 * To show an email address for privacy requests, put it between the quotes on the EMAIL line.
 *
 * Added by aura-messages-setup.cjs.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const UPDATED = "October 7, 2026";
const EMAIL = ""; // e.g. "privacy@example.com". Left empty, the policy points to the GitHub page below.
const ISSUES = "https://github.com/tctray/aura-launcher/issues";

// Each section: a heading, then paragraphs (text) and lists (arrays of text)
export const PRIVACY_SECTIONS = [
  {
    title: "The short version",
    body: [
      "AURA is a game launcher for Windows, developed by Taurrean Traylor. It has no ads and no tracking or analytics, and nothing about you is sold or shared for marketing.",
      "Most of what AURA does stays on your PC. If you create an AURA account, the things listed below are saved online so they follow you to another PC and so friends can message you.",
    ],
  },
  {
    title: "What stays on your PC",
    body: [[
      "Clips, recordings and screenshots you make with AURA.",
      "Performance readings (frame rate, temperatures and the like).",
      "Your login, kept encrypted by Windows so you stay signed in.",
      "How you've set up the Messages page, including a background picture of your own.",
      "Which microphone and speakers you chose for voice calls.",
    ]],
  },
  {
    title: "What is saved to your account",
    body: [
      "These are stored with Supabase, the database service AURA uses.",
      [
        "Sign-up details: your email address, username and password. The password is stored scrambled; nobody, including the developer, can read it.",
        "Your profile: username, bio and profile picture. Anyone signed in to AURA can see these, which is how friends find you by username.",
        "Your library: game titles, favorites, how often and how long you've played, and when you last played.",
        "Play sessions: the game, when it started and ended, and the game's file location on your PC.",
        "Achievements, streaks, themes, settings, and your AURA background if it is a web address.",
        "Friends: the requests you send and receive, your friends, the people you block, and when you were last online. Only your friends see whether you're online.",
        "Messages: the text, pictures, GIFs and videos you send, the likes and dislikes you put on messages, a chat's shared background, and whether a message has been read.",
        "Voice calls: who called whom, when, and whether the call was answered. This is kept for 30 days. The sound of a call is never recorded or saved.",
        "Reports you send: the reason, anything you add, and a copy of the message you reported.",
      ],
    ],
  },
  {
    title: "Who can see your messages",
    body: [
      "Inside AURA, a conversation and its files can be opened only by the two people in it. Files have no public links.",
      "Messages are protected on their way to and from AURA, but they are not end-to-end encrypted. The developer can access the database to keep AURA running and to look into reports. Don't send passwords, card numbers or anything else you'd need to keep secret.",
    ],
  },
  {
    title: "Voice calls",
    body: [
      "You can only call, and be called by, your AURA friends. AURA uses your microphone only while you are in a call.",
      "When a call is accepted, the two PCs connect to each other and the sound travels between them, encrypted. It doesn't pass through AURA's database and it isn't recorded.",
      "To connect, each PC is told the other's internet (IP) address. This happens only after a call is accepted, and only with the friend you are talking to. If you'd rather a friend never learn it, don't call them or accept their calls.",
      "On a few networks two PCs can't connect directly. If AURA has a relay set up for that, the encrypted sound passes through it instead. The relay can't listen to it.",
    ],
  },
  {
    title: "Other services AURA talks to",
    body: [
      "AURA uses these to do its job. Each sees your internet address, as any website does, and has its own privacy policy.",
      [
        "Supabase: accounts, the database, stored files and live updates.",
        "The AURA server (hosted by GoDaddy): fetches cover art, trailers, streams and Steam details for you, so the keys for those services aren't on your PC. It checks that you're signed in and doesn't keep a history of what you look up.",
        "IGDB and Twitch: game titles are sent to find cover art and live streams, and what you type in stream search. Streams play in Twitch's own player.",
        "YouTube: a game's title is sent to find its trailer, and the trailer plays in YouTube's player.",
        "Steam: if you connect Steam, your Steam ID is used to show your profile, friends and playtime.",
        "Discord: if you connect Discord, you sign in with Discord, and AURA can show the game you're playing on your Discord profile.",
        "Google and Cloudflare: when a voice call connects, their free public servers tell your PC its own internet address, so the two PCs can find each other. They learn nothing else about the call.",
        "KLIPY: when you use GIF search, what you type goes through the AURA server to KLIPY to find GIFs, along with a scrambled ID that stands for you (not your name, email or AURA account). A GIF picked from the search is not copied into AURA: the message holds its address at KLIPY, and both people's AURA loads it from KLIPY when the chat is opened.",
        "GitHub: AURA checks GitHub for new versions and downloads updates from it.",
      ],
    ],
  },
  {
    title: "Deleting things",
    body: [[
      "A message: point at one of your own messages and choose Delete. Its words and its file are removed for both of you.",
      "A friend: remove them from the profile card in a chat. Your past conversation stays, but neither of you can send more.",
      "Your account and everything in it: ask using the contact details below, from the email address on the account or naming your AURA username. It will be removed within 30 days.",
      "Uninstalling AURA removes it from your PC. It doesn't delete your account.",
    ]],
  },
  {
    title: "Blocking and reporting",
    body: [
      "Blocking someone removes them from your friends and stops them from messaging you, calling you or sending you friend requests. They aren't told.",
      "Reporting someone sends the reason, and the message if you report one, to the developer. A reported message is kept for review even if its sender deletes it afterwards. Accounts used for harassment, spam or anything illegal may be removed.",
    ],
  },
  {
    title: "How long things are kept",
    body: [
      "What's saved to your account stays until you delete it or ask for your account to be removed. Reports are kept for as long as it takes to deal with them.",
    ],
  },
  {
    title: "Children",
    body: ["AURA isn't meant for children under 13, and accounts shouldn't be created for them."],
  },
  {
    title: "Changes to this policy",
    body: ["If AURA starts storing something new or using another service, this page is updated and the date at the top changes."],
  },
];

const CSS = `
.pp-veil{position:fixed;inset:0;z-index:9500;display:flex;align-items:center;justify-content:center;padding:28px;background:rgba(4,4,8,.78);font-family:'DM Sans',sans-serif}
.pp{position:relative;width:min(720px,100%);max-height:100%;display:flex;flex-direction:column;border-radius:16px;background:var(--panel,#1a1f26);border:1px solid var(--borderb,rgba(255,255,255,.14));box-shadow:0 30px 90px rgba(0,0,0,.6);color:var(--t1,#fff)}
.pp-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:22px 24px 14px;border-bottom:1px solid var(--border,rgba(255,255,255,.08));flex-shrink:0}
.pp-head h1{margin:0;font-family:'Rajdhani',sans-serif;font-size:26px;font-weight:700;letter-spacing:.5px;line-height:1.1}
.pp-date{margin-top:4px;font-size:12px;color:var(--t2,#8b8b9e)}
.pp-x{width:34px;height:34px;flex-shrink:0;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(255,255,255,.06);border:1px solid var(--border,rgba(255,255,255,.12));color:var(--t1,#fff)}
.pp-x:hover{background:rgba(255,255,255,.14)}
.pp-x:focus-visible,.pp-link:focus-visible,.pp-open:focus-visible{outline:2px solid var(--ac,#FF5722);outline-offset:2px}
.pp-body{padding:6px 24px 24px;overflow-y:auto;font-size:14px;line-height:1.6;user-select:text}
.pp-body h2{margin:22px 0 6px;font-family:'Rajdhani',sans-serif;font-size:18px;font-weight:700;letter-spacing:.3px;color:var(--t1,#fff)}
.pp-body p{margin:0 0 10px;max-width:68ch;color:var(--t1,#fff);opacity:.9}
.pp-body ul{margin:0 0 10px;padding-left:20px;max-width:68ch}
.pp-body li{margin-bottom:6px;color:var(--t1,#fff);opacity:.9}
.pp-link{background:none;border:none;padding:0;cursor:pointer;font:inherit;color:var(--ac2,var(--ac,#ff8a65));text-decoration:underline;overflow-wrap:anywhere;text-align:left}
.pp-open{background:var(--card,#2D4059);border:1px solid var(--border,rgba(255,255,255,.12));color:var(--t1,#fff);border-radius:8px;padding:8px 14px;font:500 12px 'DM Sans',sans-serif;cursor:pointer;white-space:nowrap;flex-shrink:0}
.pp-open:hover{border-color:var(--ac,#FF5722)}
.pp-open.quiet{background:none;border:none;padding:0;font-size:11.5px;color:var(--t2,#8b8b9e);text-decoration:underline}
.pp-open.quiet:hover{color:var(--t1,#fff)}
`;
function ensureStyles() {
  if (document.getElementById("aura-privacy-styles")) return;
  const el = document.createElement("style");
  el.id = "aura-privacy-styles";
  el.textContent = CSS;
  document.head.appendChild(el);
}

// Web links open in the user's own browser, not inside AURA
function openOutside(url) {
  if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url);
  else window.open(url, "_blank", "noopener");
}

export function PrivacyPolicy({ onClose }) {
  useEffect(() => {
    ensureStyles();
    const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", esc, true);
    return () => document.removeEventListener("keydown", esc, true);
  }, [onClose]);
  return createPortal(
    <div className="pp-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pp" role="dialog" aria-modal="true" aria-labelledby="pp-title">
        <div className="pp-head">
          <div><h1 id="pp-title">AURA privacy policy</h1><div className="pp-date">Last updated {UPDATED}</div></div>
          <button type="button" className="pp-x" onClick={onClose} aria-label="Close" autoFocus>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div className="pp-body">
          {PRIVACY_SECTIONS.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.body.map((part, i) => Array.isArray(part)
                ? <ul key={i}>{part.map((line, n) => <li key={n}>{line}</li>)}</ul>
                : <p key={i}>{part}</p>)}
            </section>
          ))}
          <section>
            <h2>Contact</h2>
            <p>
              Questions, or a request to remove your account:{" "}
              {EMAIL
                ? <button type="button" className="pp-link" onClick={() => openOutside("mailto:" + EMAIL)}>{EMAIL}</button>
                : <button type="button" className="pp-link" onClick={() => openOutside(ISSUES)}>{ISSUES.replace("https://", "")}</button>}
              {!EMAIL && ". That page is public, so give only your AURA username there."}
            </p>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// A button that opens the policy. `quiet` makes it a small text link.
export function PrivacyButton({ quiet = false, children }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { ensureStyles(); }, []);
  return (
    <>
      <button type="button" className={`pp-open ${quiet ? "quiet" : ""}`} onClick={() => setOpen(true)}>{children || "Read the privacy policy"}</button>
      {open && <PrivacyPolicy onClose={() => setOpen(false)} />}
    </>
  );
}

export default PrivacyPolicy;
