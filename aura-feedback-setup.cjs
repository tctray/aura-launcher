#!/usr/bin/env node
/**
 * AURA — a "Send feedback" button in Settings
 *
 * Adds a Feedback row to Settings > About. The button opens a short form: what kind of feedback
 * it is (a bug, an idea, something else), the message, and an email address if the person would
 * like a reply. Pressing Send emails it to you.
 *
 * How it reaches you, and why your email address stays private:
 *   The form is sent through Web3Forms, the service you signed up to. Web3Forms knows which
 *   inbox the form belongs to and forwards each message there. AURA only holds the form's access
 *   key, so your email address is not in the app and not on GitHub. The access key is meant to
 *   be public; all anyone can do with it is send you a message.
 *
 * How to use:
 *   1. Put this file in your AURA project folder (the one with package.json).
 *   2. Fully quit AURA.
 *   3. Run:   node aura-feedback-setup.cjs
 *      It asks for your Web3Forms access key. Paste it and press Enter.
 *      (Or give it on the same line:  node aura-feedback-setup.cjs --key=YOUR-ACCESS-KEY)
 *   4. Then:  npm test
 *
 * What it does:
 *   - creates  src/components/feedback.jsx  the button and the form, with your access key in it
 *   - edits    src/App.jsx                  the Feedback row in Settings > About
 *   - edits    src/components/privacy.jsx   the privacy policy now mentions feedback
 *   - edits    PRIVACY.md                   the same words, for the policy's page on GitHub
 *   - creates  tests/feedback.cjs           (only if AURA's checks are installed) checks the form
 *   - edits    tests/run.cjs                (same) so npm test runs it
 *
 * Every file it changes is copied to <name>.before-feedback.bak first.
 * To put everything back:                 node aura-feedback-setup.cjs --undo
 * To preview without changing anything:   node aura-feedback-setup.cjs --dry-run
 * To change the key later:                node aura-feedback-setup.cjs --key=THE-NEW-KEY
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const EDITS = [{"kind":"insert","file":"app","label":"Settings > About has a Feedback row with a \"Send feedback\" button","after":"import { PrivacyButton } from \"./components/privacy\";","done":"import { FeedbackButton } from \"./components/feedback\";","text":"import { FeedbackButton } from \"./components/feedback\";\n"},{"kind":"insert","file":"app","label":"Settings > About has a Feedback row with a \"Send feedback\" button","after":"<PrivacyButton/></div>","done":"<FeedbackButton/>","text":"          <div className=\"sr\"><div><div className=\"sr-l\">Feedback</div><div className=\"sr-s\">Found a bug or have an idea? Tell the developer.</div></div><FeedbackButton/></div>\n"},{"kind":"insert","file":"privacy","label":"the privacy policy says what sending feedback shares, and with whom","after":"\"GitHub: AURA checks GitHub for new versions and downloads updates from it.\",","done":"\"Web3Forms:","text":"        \"Web3Forms: if you send feedback from Settings, your message, your AURA username, the version of AURA you're using, and an email address if you choose to give one, are sent through Web3Forms, which delivers them to the developer by email. Nothing is sent unless you press Send.\",\n"},{"kind":"re","file":"privacy","label":"the privacy policy says what sending feedback shares, and with whom","re":"^const UPDATED = \"October 7, 2026\";","missingOk":true,"text":"const UPDATED = \"October 11, 2026\";"},{"kind":"replace","file":"privacy","label":"the privacy policy's title is always readable (it came out dark on a PC set to Windows' light mode)","done":".pp-head h1{margin:0;color:var(--t1,#fff);","missingOk":true,"before":".pp-head h1{margin:0;font-family:","text":".pp-head h1{margin:0;color:var(--t1,#fff);font-family:"},{"kind":"insert","file":"policy","label":"the privacy policy says what sending feedback shares, and with whom","after":"- GitHub: AURA checks GitHub for new versions and downloads updates from it.","done":"- Web3Forms:","text":"- Web3Forms: if you send feedback from Settings, your message, your AURA username, the version of AURA you're using, and an email address if you choose to give one, are sent through Web3Forms, which delivers them to the developer by email. Nothing is sent unless you press Send.\n"},{"kind":"re","file":"policy","label":"the privacy policy says what sending feedback shares, and with whom","re":"^Last updated October 7, 2026$","missingOk":true,"text":"Last updated October 11, 2026"},{"kind":"insert","file":"runner","label":"npm test now checks the feedback form","after":"add(\"window\", \"The window opens and every page loads\", \"window.cjs\");","done":"feedback.cjs","text":"if (fs.existsSync(path.join(__dirname, \"feedback.cjs\"))) add(\"window\", \"The feedback form in Settings\", \"feedback.cjs\");\n"}];
const FILES = {"form":"/**\n * AURA — feedback\n *\n *   - FeedbackButton    a button (used in Settings) that opens a short form: what kind of\n *                       feedback it is, the message, and an email address if a reply is wanted\n *\n * The form is sent through Web3Forms (web3forms.com), which turns it into an email to the\n * developer. The developer's email address is not in AURA or anywhere in this project:\n * Web3Forms keeps it, and AURA only holds the form's access key (FEEDBACK_FORM below). That key\n * is meant to be seen. It is the same kind of key a website's contact form shows every visitor,\n * and all it can do is send a message to the developer.\n *\n * To use a different key:   node aura-feedback-setup.cjs --key=THE-NEW-KEY\n *\n * Added by aura-feedback-setup.cjs.\n */\nimport { useEffect, useRef, useState } from \"react\";\nimport { createPortal } from \"react-dom\";\n\nconst FEEDBACK_FORM = \"__AURA_FEEDBACK_KEY__\";\nconst SEND_TO = \"https://api.web3forms.com/submit\";\nconst LONGEST = 4000;      // characters in a message\nconst SHORTEST = 10;\nconst A_DAY = 24 * 60 * 60 * 1000;\nconst PER_DAY = 10;        // messages from one PC in a day (the free form allows 250 a month in all)\nconst SENT_KEY = \"aura_feedback_sent\";\nconst WAIT_MS = 20000;\nconst EMAIL_SHAPE = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/;\n\nconst KINDS = [\n  { id: \"bug\", label: \"A bug\", ask: \"What happened, and what were you doing when it happened?\" },\n  { id: \"idea\", label: \"An idea\", ask: \"What would you like AURA to do?\" },\n  { id: \"other\", label: \"Something else\", ask: \"What's on your mind?\" },\n];\n\n// What you've typed is kept while AURA is open, so closing the form by accident loses nothing\nlet draft = { kind: \"bug\", text: \"\", reply: \"\" };\n\nconst sentToday = () => {\n  try {\n    const list = JSON.parse(localStorage.getItem(SENT_KEY) || \"[]\");\n    return Array.isArray(list) ? list.filter((t) => typeof t === \"number\" && Date.now() - t < A_DAY && t <= Date.now()) : [];\n  } catch { return []; }\n};\nconst noteSent = () => { try { localStorage.setItem(SENT_KEY, JSON.stringify([...sentToday(), Date.now()])); } catch {} };\nconst myUsername = () => {\n  try { return String(JSON.parse(localStorage.getItem(\"aura_profile\") || \"null\")?.username || \"\").slice(0, 40); } catch { return \"\"; }\n};\n\n// Sends one message. Answers { ok: true } or { ok: false, why } and never throws.\nasync function sendFeedback({ kind, text, reply, version }) {\n  const label = (KINDS.find((k) => k.id === kind) || KINDS[2]).label;\n  const name = myUsername() || \"(no username)\";\n  const body = {\n    access_key: FEEDBACK_FORM,\n    subject: \"AURA feedback: \" + label.toLowerCase() + \" from \" + name,\n    from_name: \"AURA feedback\",\n    type: label,\n    message: text,\n    username: name,\n    aura_version: version || \"unknown\",\n  };\n  if (reply) body.email = reply; // Web3Forms makes this the address a reply goes to\n  const stopper = typeof AbortController === \"function\" ? new AbortController() : null;\n  const timer = setTimeout(() => stopper?.abort(), WAIT_MS);\n  try {\n    const res = await fetch(SEND_TO, {\n      method: \"POST\",\n      headers: { \"Content-Type\": \"application/json\", Accept: \"application/json\" },\n      body: JSON.stringify(body),\n      signal: stopper?.signal,\n    });\n    let answer = null;\n    try { answer = await res.json(); } catch {}\n    if (res.ok && answer?.success === true) return { ok: true };\n    return { ok: false, why: res.status === 429 ? \"busy\" : \"refused\" };\n  } catch {\n    return { ok: false, why: \"offline\" };\n  } finally {\n    clearTimeout(timer);\n  }\n}\n\nconst PROBLEMS = {\n  offline: \"Couldn't send it. Check your internet connection and try again.\",\n  busy: \"The feedback service is busy right now. Try again in a few minutes.\",\n  refused: \"Couldn't send it right now. Try again later.\",\n  tooMany: \"You've sent a lot of feedback today, thank you. You can send more tomorrow.\",\n};\n\nconst CSS = `\n.fb-open{background:var(--card,#2D4059);border:1px solid var(--border,rgba(255,255,255,.12));color:var(--t1,#fff);border-radius:8px;padding:8px 14px;font:500 12px 'DM Sans',sans-serif;cursor:pointer;white-space:nowrap;flex-shrink:0}\n.fb-open:hover{border-color:var(--ac,#FF5722)}\n.fb-veil{position:fixed;inset:0;z-index:9500;display:flex;align-items:center;justify-content:center;padding:28px;background:rgba(4,4,8,.78);font-family:'DM Sans',sans-serif}\n.fb{position:relative;width:min(500px,100%);max-height:100%;display:flex;flex-direction:column;border-radius:16px;background:var(--panel,#1a1f26);border:1px solid var(--borderb,rgba(255,255,255,.14));box-shadow:0 30px 90px rgba(0,0,0,.6);color:var(--t1,#fff)}\n.fb-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px 22px 14px;border-bottom:1px solid var(--border,rgba(255,255,255,.08));flex-shrink:0}\n.fb-head h1{margin:0;font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:700;letter-spacing:.5px;line-height:1.1;color:var(--t1,#fff)}\n.fb-lead{margin-top:4px;font-size:12px;color:var(--t2,#8b8b9e)}\n.fb-x{width:32px;height:32px;flex-shrink:0;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(255,255,255,.06);border:1px solid var(--border,rgba(255,255,255,.12));color:var(--t1,#fff)}\n.fb-x:hover{background:rgba(255,255,255,.14)}\n.fb-body{padding:16px 22px 4px;overflow-y:auto}\n.fb-kinds{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}\n.fb-kind{background:transparent;border:1px solid var(--border,rgba(255,255,255,.14));color:var(--t2,#8b8b9e);border-radius:20px;padding:7px 14px;font:600 12px 'DM Sans',sans-serif;cursor:pointer}\n.fb-kind:hover{color:var(--t1,#fff)}\n.fb-kind.on{background:var(--ac,#FF5722);border-color:var(--ac,#FF5722);color:#fff}\n.fb-label{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:10px;font-weight:600;color:var(--t2,#8b8b9e);margin-bottom:5px;letter-spacing:.5px;text-transform:uppercase}\n.fb-label span{text-transform:none;letter-spacing:0;font-weight:500}\n.fb-field{width:100%;box-sizing:border-box;background:var(--card,#2D4059);border:1px solid var(--border,rgba(255,255,255,.12));border-radius:9px;padding:10px 13px;color:var(--t1,#fff);font:400 13px/1.5 'DM Sans',sans-serif;outline:none;user-select:text}\n.fb-field::placeholder{color:var(--t2,#8b8b9e);opacity:.75}\n.fb-field:focus{border-color:var(--ac,#FF5722)}\ntextarea.fb-field{display:block;height:150px;resize:vertical;min-height:90px;max-height:320px;margin-bottom:14px}\n.fb-note{margin:10px 0 0;font-size:11.5px;line-height:1.5;color:var(--t2,#8b8b9e)}\n.fb-problem{margin:12px 0 0;padding:10px 12px;border-radius:9px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.35);color:#fecaca;font-size:12.5px;line-height:1.45;display:flex;align-items:center;justify-content:space-between;gap:12px}\n.fb-copy{background:none;border:none;padding:0;cursor:pointer;font:600 12px 'DM Sans',sans-serif;color:#fff;text-decoration:underline;white-space:nowrap;flex-shrink:0}\n.fb-foot{padding:16px 22px 20px;display:flex;gap:8px;justify-content:flex-end;flex-shrink:0}\n.fb-btn{border-radius:9px;padding:9px 18px;font:600 12px 'DM Sans',sans-serif;cursor:pointer;background:transparent;border:1px solid var(--border,rgba(255,255,255,.14));color:var(--t2,#8b8b9e)}\n.fb-btn:hover{color:var(--t1,#fff)}\n.fb-btn.send{background:var(--ac,#FF5722);border-color:var(--ac,#FF5722);color:#fff;min-width:84px}\n.fb-btn.send:disabled{opacity:.45;cursor:default}\n.fb-sent{padding:34px 22px 10px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px}\n.fb-tick{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;background:rgba(34,197,94,.15);color:#22c55e;margin-bottom:8px}\n.fb-sent h2{margin:0;font-family:'Rajdhani',sans-serif;font-size:21px;font-weight:700;letter-spacing:.4px;line-height:1.2;color:var(--t1,#fff)}\n.fb-sent p{margin:0;font-size:13px;color:var(--t2,#8b8b9e);max-width:36ch;line-height:1.5}\n.fb-open:focus-visible,.fb-x:focus-visible,.fb-kind:focus-visible,.fb-btn:focus-visible,.fb-copy:focus-visible{outline:2px solid var(--ac,#FF5722);outline-offset:2px}\n`;\nfunction ensureStyles() {\n  if (document.getElementById(\"aura-feedback-styles\")) return;\n  const el = document.createElement(\"style\");\n  el.id = \"aura-feedback-styles\";\n  el.textContent = CSS;\n  document.head.appendChild(el);\n}\n\nexport function FeedbackForm({ onClose }) {\n  const [kind, setKind] = useState(draft.kind);\n  const [text, setText] = useState(draft.text);\n  const [reply, setReply] = useState(draft.reply);\n  const [stage, setStage] = useState(\"form\"); // form, sending, sent\n  const [problem, setProblem] = useState(\"\");\n  const [canCopy, setCanCopy] = useState(false); // offered when sending failed, so the message isn't lost\n  const [copied, setCopied] = useState(false);\n  const version = useRef(\"\");\n  const box = useRef(null);\n  const busy = stage === \"sending\";\n\n  useEffect(() => { draft = { kind, text, reply }; }, [kind, text, reply]);\n  useEffect(() => {\n    ensureStyles();\n    box.current?.focus();\n    let live = true;\n    Promise.resolve(window.electronAPI?.checkUpdate?.()).then((r) => { if (live && r?.current) version.current = String(r.current).slice(0, 20); }).catch(() => {});\n    return () => { live = false; };\n  }, []);\n  useEffect(() => {\n    const esc = (e) => { if (e.key === \"Escape\") { e.stopPropagation(); if (!busy) onClose(); } };\n    document.addEventListener(\"keydown\", esc, true);\n    return () => document.removeEventListener(\"keydown\", esc, true);\n  }, [onClose, busy]);\n\n  const message = text.trim();\n  const address = reply.trim();\n  const ready = message.length >= SHORTEST && !busy;\n  const name = myUsername();\n\n  const send = async () => {\n    if (!ready) return;\n    setCopied(false);\n    setCanCopy(false);\n    if (address && !EMAIL_SHAPE.test(address)) { setProblem(\"That email address doesn't look right. Fix it, or leave it empty.\"); return; }\n    if (sentToday().length >= PER_DAY) { setProblem(PROBLEMS.tooMany); return; }\n    setProblem(\"\");\n    setStage(\"sending\");\n    const result = await sendFeedback({ kind, text: message.slice(0, LONGEST), reply: address, version: version.current });\n    if (result.ok) {\n      noteSent();\n      setText(\"\");\n      setStage(\"sent\");\n    } else {\n      setProblem(PROBLEMS[result.why] || PROBLEMS.refused);\n      setCanCopy(true);\n      setStage(\"form\");\n    }\n  };\n  const copy = async () => { try { await navigator.clipboard.writeText(message); setCopied(true); } catch {} };\n\n  return createPortal(\n    <div className=\"fb-veil\" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>\n      <div className=\"fb\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"fb-title\">\n        {stage === \"sent\" ? (\n          <>\n            <div className=\"fb-sent\" role=\"status\">\n              <div className=\"fb-tick\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"2.4\" width=\"26\" height=\"26\" strokeLinecap=\"round\" strokeLinejoin=\"round\" aria-hidden=\"true\"><path d=\"M5 12.5l4.5 4.5L19 7.5\"/></svg></div>\n              <h2 id=\"fb-title\">Feedback sent</h2>\n              <p>Thank you. It goes straight to the developer.</p>\n            </div>\n            <div className=\"fb-foot\" style={{ justifyContent: \"center\" }}><button type=\"button\" className=\"fb-btn send\" onClick={onClose} autoFocus>Close</button></div>\n          </>\n        ) : (\n          <>\n            <div className=\"fb-head\">\n              <div><h1 id=\"fb-title\">Send feedback</h1><div className=\"fb-lead\">Tell the developer what's broken or what would make AURA better.</div></div>\n              <button type=\"button\" className=\"fb-x\" onClick={() => { if (!busy) onClose(); }} aria-label=\"Close\">\n                <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"1.8\" width=\"14\" height=\"14\" strokeLinecap=\"round\" aria-hidden=\"true\"><path d=\"M6 6l12 12M18 6L6 18\"/></svg>\n              </button>\n            </div>\n            <div className=\"fb-body\">\n              <div className=\"fb-kinds\" role=\"radiogroup\" aria-label=\"What kind of feedback\">\n                {KINDS.map((k) => (\n                  <button key={k.id} type=\"button\" role=\"radio\" aria-checked={kind === k.id} className={\"fb-kind\" + (kind === k.id ? \" on\" : \"\")} onClick={() => setKind(k.id)} disabled={busy}>{k.label}</button>\n                ))}\n              </div>\n              <label className=\"fb-label\" htmlFor=\"fb-text\">Your message <span>{text.length > LONGEST - 500 ? text.length + \" / \" + LONGEST : \"\"}</span></label>\n              <textarea id=\"fb-text\" ref={box} className=\"fb-field\" value={text} maxLength={LONGEST} disabled={busy}\n                placeholder={(KINDS.find((k) => k.id === kind) || KINDS[0]).ask}\n                onChange={(e) => { setText(e.target.value); if (problem) setProblem(\"\"); }}/>\n              <label className=\"fb-label\" htmlFor=\"fb-reply\">Your email <span>Optional. Only if you'd like a reply.</span></label>\n              <input id=\"fb-reply\" className=\"fb-field\" type=\"email\" value={reply} maxLength={120} disabled={busy} autoComplete=\"off\" spellCheck={false}\n                placeholder=\"name@example.com\" onChange={(e) => { setReply(e.target.value); if (problem) setProblem(\"\"); }}/>\n              <p className=\"fb-note\">Sent with your message: {name ? <>your AURA username ({name})</> : \"your AURA username\"} and the version of AURA you're using. Please don't include passwords.</p>\n              {problem && (\n                <div className=\"fb-problem\" role=\"alert\">\n                  <span>{problem}</span>\n                  {canCopy && message && <button type=\"button\" className=\"fb-copy\" onClick={copy}>{copied ? \"Copied\" : \"Copy my message\"}</button>}\n                </div>\n              )}\n            </div>\n            <div className=\"fb-foot\">\n              <button type=\"button\" className=\"fb-btn\" onClick={onClose} disabled={busy}>Cancel</button>\n              <button type=\"button\" className=\"fb-btn send\" onClick={send} disabled={!ready}>{busy ? \"Sending…\" : \"Send\"}</button>\n            </div>\n          </>\n        )}\n      </div>\n    </div>,\n    document.body,\n  );\n}\n\n// The button that opens the form\nexport function FeedbackButton({ children }) {\n  const [open, setOpen] = useState(false);\n  useEffect(() => { ensureStyles(); }, []);\n  return (\n    <>\n      <button type=\"button\" className=\"fb-open\" onClick={() => setOpen(true)}>{children || \"Send feedback\"}</button>\n      {open && <FeedbackForm onClose={() => setOpen(false)} />}\n    </>\n  );\n}\n\nexport default FeedbackButton;\n","check":"// The feedback form (Settings > About > Send feedback).\n//\n// Opens the built window (dist) in a real browser with a pretend desktop side and a stand-in for\n// Web3Forms, so NOTHING IS REALLY SENT: no email goes out and none of the monthly allowance is\n// used. It checks that:\n//   - the button is in Settings and opens the form\n//   - Send only works once there is a real message\n//   - what is sent is the message, its kind, the AURA username and version, and a reply\n//     address only if one was typed. Nothing else.\n//   - a message that can't be sent is kept, with a plain reason and a way to copy it\n//   - closing the form by accident doesn't lose what was typed\n//   - one PC can't use up the whole allowance in a day\n//   - no email address is written into the feedback code\n// Added by aura-feedback-setup.cjs.\n\"use strict\";\nconst fs = require(\"fs\");\nconst http = require(\"http\");\nconst path = require(\"path\");\n\nconst ROOT = path.resolve(__dirname, \"..\");\nconst DIST = path.join(ROOT, \"dist\");\nconst WEB3FORMS = \"https://api.web3forms.com/submit\";\nconst KEY_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;\nconst TYPES = { \".html\": \"text/html\", \".js\": \"text/javascript\", \".mjs\": \"text/javascript\", \".css\": \"text/css\", \".png\": \"image/png\", \".jpg\": \"image/jpeg\", \".svg\": \"image/svg+xml\", \".ico\": \"image/x-icon\", \".json\": \"application/json\", \".woff2\": \"font/woff2\", \".woff\": \"font/woff\" };\nlet failed = 0;\nconst check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? \"  ok    \" : \"  FAIL  \") + name + (ok || extra === undefined ? \"\" : \"\\n          \" + (typeof extra === \"string\" ? extra : JSON.stringify(extra)))); };\nconst note = (text) => console.log(\"  note  \" + text);\nconst done = (code) => { console.log(code === 0 ? \"\\nall passed\" : code === 3 ? \"\\nskipped\" : `\\n${failed} FAILED`); process.exit(code); };\nconst read = (...parts) => { try { return fs.readFileSync(path.join(ROOT, ...parts), \"utf8\"); } catch { return \"\"; } };\n\n(async () => {\n  if (!fs.existsSync(path.join(DIST, \"index.html\"))) { check(\"the window has been built (dist/index.html)\", false, \"Run  npm run build  first.\"); return done(1); }\n  let chromium;\n  try { ({ chromium } = require(\"playwright\")); } catch { note(\"the test browser isn't installed here\"); return done(process.env.CI ? 1 : 3); }\n  let browser = null;\n  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: \"msedge\" }, { channel: \"chrome\" }]) {\n    try { browser = await chromium.launch(options); break; } catch {}\n  }\n  if (!browser) { note(\"no browser to test with. Run  npx playwright install chromium  once to add one.\"); return done(process.env.CI ? 1 : 3); }\n\n  const server = http.createServer((req, res) => {\n    const url = decodeURIComponent(new URL(req.url, \"http://x\").pathname);\n    const file = path.join(DIST, url === \"/\" ? \"index.html\" : url);\n    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }\n    fs.readFile(file, (err, data) => {\n      if (err) { res.writeHead(404); return res.end(); }\n      res.writeHead(200, { \"Content-Type\": TYPES[path.extname(file).toLowerCase()] || \"application/octet-stream\" });\n      res.end(data);\n    });\n  });\n  await new Promise((r) => server.listen(0, \"127.0.0.1\", r));\n  const base = \"http://127.0.0.1:\" + server.address().port;\n\n  // Start AURA logged in as \"tester\". `web3forms.answer` decides how the stand-in replies.\n  async function start({ sentBefore = 0 } = {}) {\n    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: \"light\" });\n    try { await context.grantPermissions([\"clipboard-read\", \"clipboard-write\"], { origin: base }); } catch {}\n    const page = await context.newPage();\n    const thrown = [];\n    page.on(\"pageerror\", (e) => thrown.push(String(e.message || e).split(\"\\n\")[0]));\n    const web3forms = { answer: \"ok\", got: [] };\n    const open = { \"access-control-allow-origin\": \"*\", \"access-control-allow-headers\": \"*\", \"access-control-allow-methods\": \"POST, OPTIONS\" };\n    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());\n    await page.route(WEB3FORMS, async (route) => {\n      const request = route.request();\n      if (request.method() === \"OPTIONS\") return route.fulfill({ status: 204, headers: open });\n      let body = null;\n      try { body = JSON.parse(request.postData() || \"null\"); } catch {}\n      web3forms.got.push({ method: request.method(), type: request.headers()[\"content-type\"] || \"\", body });\n      if (web3forms.answer === \"cut\") return route.abort(\"internetdisconnected\");\n      if (web3forms.answer === \"busy\") return route.fulfill({ status: 429, headers: open, contentType: \"application/json\", body: JSON.stringify({ success: false, message: \"Too many requests. Please try later!\" }) });\n      if (web3forms.answer === \"down\") return route.fulfill({ status: 500, headers: open, contentType: \"text/html\", body: \"<html><style>:root{--a:#07354a}</style><h1>500</h1></html>\" });\n      if (web3forms.answer === \"no\") return route.fulfill({ status: 400, headers: open, contentType: \"application/json\", body: JSON.stringify({ success: false, message: \"Invalid access key\" }) });\n      return route.fulfill({ status: 200, headers: open, contentType: \"application/json\", body: JSON.stringify({ success: true, message: \"Email sent successfully!\", data: body }) });\n    });\n    await page.addInitScript(({ sentBefore }) => {\n      try {\n        localStorage.clear();\n        localStorage.setItem(\"aura_profile\", JSON.stringify({ username: \"tester\", avatar: \"\", userId: \"user-1\" }));\n        if (sentBefore) localStorage.setItem(\"aura_feedback_sent\", JSON.stringify(Array.from({ length: sentBefore }, (_x, i) => Date.now() - (i + 1) * 60000)));\n      } catch {}\n      const ok = (data) => Promise.resolve({ success: true, data });\n      const account = { getSession: () => ok({ id: \"user-1\", email: \"me@example.com\" }), getMyProfile: () => ok({ username: \"tester\", avatar_url: null }), saveProfile: (name, picture) => ok({ username: name, avatar_url: picture || null }) };\n      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === \"then\" ? undefined : (...args) => (name === \"auraCloud\" && account[key]) ? account[key](...args) : ok(null)) });\n      window.auraCloud = fake(\"auraCloud\");\n      window.auraSocial = fake(\"auraSocial\");\n      const desktop = { checkUpdate: () => Promise.resolve({ success: true, current: \"1.16.1\", latest: \"1.16.1\", hasUpdate: false }) };\n      window.electronAPI = new Proxy({}, {\n        get: (_t, key) => {\n          if (key === \"isElectron\") return true;\n          if (typeof key !== \"string\" || key === \"then\") return undefined;\n          if (/^on[A-Z]/.test(key)) return () => () => {};\n          if (/^remove/.test(key)) return () => {};\n          return (...args) => (desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }));\n        },\n      });\n    }, { sentBefore });\n    await page.goto(base + \"/index.html\", { waitUntil: \"load\" });\n    await page.waitForTimeout(4500);\n    await page.locator('.gm-rail-item[title=\"Settings\"], .sb-item[title=\"Settings\"]').first().click({ timeout: 5000 });\n    await page.waitForTimeout(900);\n    const button = page.getByRole(\"button\", { name: \"Send feedback\", exact: true });\n    const form = page.locator(\".fb\");\n    const openForm = async () => { await button.scrollIntoViewIfNeeded({ timeout: 5000 }); await button.click({ timeout: 4000 }); await page.waitForTimeout(450); };\n    const write = async (text) => { await page.locator(\"#fb-text\").fill(text); await page.waitForTimeout(120); };\n    const send = async () => { await form.getByRole(\"button\", { name: \"Send\", exact: true }).click({ timeout: 4000 }); await page.waitForTimeout(700); };\n    const state = () => page.evaluate(() => {\n      const box = document.querySelector(\".fb\");\n      if (!box) return null;\n      const tick = box.querySelector(\".fb-tick\");\n      return {\n        title: box.querySelector(\"#fb-title\")?.textContent.trim() || \"\",\n        kinds: [...box.querySelectorAll(\".fb-kind\")].map((b) => b.textContent.trim() + (b.getAttribute(\"aria-checked\") === \"true\" ? \"*\" : \"\")),\n        text: box.querySelector(\"#fb-text\")?.value ?? null,\n        reply: box.querySelector(\"#fb-reply\")?.value ?? null,\n        ask: box.querySelector(\"#fb-text\")?.getAttribute(\"placeholder\") || \"\",\n        focused: document.activeElement?.id || \"\",\n        canSend: [...box.querySelectorAll(\"button\")].some((b) => b.textContent.trim() === \"Send\" && !b.disabled),\n        problem: box.querySelector(\".fb-problem span\")?.textContent.trim() || \"\",\n        copy: box.querySelector(\".fb-copy\")?.textContent.trim() || \"\",\n        note: box.querySelector(\".fb-note\")?.textContent.trim() || \"\",\n        tick: tick ? getComputedStyle(tick).color : \"\",\n        heading: getComputedStyle(box.querySelector(\"#fb-title\")).color,\n        all: box.innerText,\n      };\n    });\n    return { page, thrown, web3forms, button, form, openForm, write, send, state };\n  }\n  const light = (colour) => { const [r, g, b] = (String(colour).match(/\\d+/g) || []).map(Number); return r > 200 && g > 200 && b > 200; };\n  const green = (colour) => { const [r, g, b] = (String(colour).match(/\\d+/g) || []).map(Number); return g > 150 && g > r + 60 && g > b + 60; };\n  const CODE = /[<>{}]|:root|--a|<\\/?\\w/;\n  const source = read(\"src\", \"components\", \"feedback.jsx\");\n  const key = (source.match(/const FEEDBACK_FORM = \"([^\"]*)\";/) || [])[1] || \"\";\n\n  try {\n    console.log(\"1. The button and the form\");\n    let app = await start();\n    const row = await app.page.evaluate(() => {\n      const b = [...document.querySelectorAll(\"button\")].find((x) => x.textContent.trim() === \"Send feedback\");\n      const r = b?.closest(\".sr\");\n      const card = r?.closest(\".ss-card\");\n      let title = card?.previousElementSibling;\n      return r ? { label: r.querySelector(\".sr-l\")?.textContent.trim(), about: title?.textContent.trim() } : null;\n    });\n    check(\"Settings > About has a Feedback row with a \\\"Send feedback\\\" button\", !!row && row.label === \"Feedback\" && row.about === \"ABOUT\", row);\n    check(\"nothing is sent just by opening Settings\", app.web3forms.got.length === 0);\n    await app.openForm();\n    let s = await app.state();\n    check(\"the button opens the form\", !!s && s.title === \"Send feedback\", s && s.all);\n    check(\"its title is light on the dark panel (also on a PC set to light mode)\", !!s && light(s.heading), s && s.heading);\n    check(\"it asks what kind of feedback it is: a bug, an idea or something else\", !!s && s.kinds.join(\"|\") === \"A bug*|An idea|Something else\", s && s.kinds);\n    check(\"the message box is ready to type in\", !!s && s.focused === \"fb-text\" && /What happened/.test(s.ask), s && [s.focused, s.ask]);\n    check(\"it says what is sent along with the message\", !!s && /your AURA username \\(tester\\)/.test(s.note) && /version of AURA/.test(s.note), s && s.note);\n    check(\"Send is off while there is no message\", !!s && !s.canSend);\n    await app.write(\"hi\");\n    check(\"and stays off for a message too short to mean anything\", !(await app.state()).canSend);\n    await app.write(\"The clips page froze when I pressed Trim on a long clip.\");\n    check(\"Send comes on once there is a real message\", (await app.state()).canSend);\n    check(\"nothing has been sent yet\", app.web3forms.got.length === 0);\n\n    console.log(\"2. Sending\");\n    await app.send();\n    let got = app.web3forms.got[0];\n    check(\"pressing Send sends it once, to Web3Forms\", app.web3forms.got.length === 1 && !!got && got.method === \"POST\" && /application\\/json/.test(got.type), app.web3forms.got);\n    const b = (got && got.body) || {};\n    check(\"with AURA's access key\", KEY_SHAPE.test(key) && b.access_key === key, [b.access_key, key]);\n    check(\"the message, and that it is a bug\", b.message === \"The clips page froze when I pressed Trim on a long clip.\" && b.type === \"A bug\", b);\n    check(\"the AURA username and version\", b.username === \"tester\" && b.aura_version === \"1.16.1\", b);\n    check(\"a subject that reads properly in an inbox\", b.subject === \"AURA feedback: a bug from tester\" && b.from_name === \"AURA feedback\", b);\n    check(\"no reply address, because none was typed\", !(\"email\" in b), b);\n    check(\"and nothing else\", Object.keys(b).sort().join(\",\") === \"access_key,aura_version,from_name,message,subject,type,username\", Object.keys(b));\n    s = await app.state();\n    check(\"then it says the feedback was sent, with a green check mark\", !!s && s.title === \"Feedback sent\" && green(s.tick) && s.text === null, s);\n    await app.form.getByRole(\"button\", { name: \"Close\", exact: true }).click({ timeout: 4000 });\n    await app.page.waitForTimeout(300);\n    check(\"Close puts the form away\", (await app.state()) === null);\n    await app.openForm();\n    s = await app.state();\n    check(\"the next time, the form is empty again\", !!s && s.text === \"\" && !s.canSend, s);\n\n    await app.form.getByRole(\"radio\", { name: \"An idea\", exact: true }).click({ timeout: 4000 });\n    await app.write(\"It would be great to sort the library by last played.\");\n    await app.page.locator(\"#fb-reply\").fill(\"not an address\");\n    await app.send();\n    s = await app.state();\n    check(\"a reply address that isn't one is caught before anything is sent\", !!s && /email address doesn't look right/.test(s.problem) && app.web3forms.got.length === 1 && s.copy === \"\", s && s.problem);\n    await app.page.locator(\"#fb-reply\").fill(\"  someone@example.com \");\n    await app.send();\n    got = app.web3forms.got[1];\n    check(\"an idea with a reply address: both are sent\", app.web3forms.got.length === 2 && !!got && got.body.type === \"An idea\" && got.body.email === \"someone@example.com\" && /sort the library/.test(got.body.message), got);\n    check(\"and it says it was sent\", (await app.state()).title === \"Feedback sent\");\n    check(\"nothing crashed along the way\", (await app.page.locator(\".aura-fallback\").count()) === 0 && app.thrown.length === 0, app.thrown);\n    await app.page.context().close();\n\n    console.log(\"3. When it can't be sent\");\n    app = await start();\n    await app.openForm();\n    const words = \"Voice calls drop after about ten minutes on my PC.\";\n    await app.write(words);\n    app.web3forms.answer = \"down\";\n    await app.send();\n    s = await app.state();\n    check(\"the service is down: a plain reason, and none of its error page\", !!s && s.problem === \"Couldn't send it right now. Try again later.\" && !CODE.test(s.problem), s && s.problem);\n    check(\"the message is still there, and Send can be pressed again\", !!s && s.text === words && s.canSend, s);\n    check(\"with a way to copy the message\", !!s && s.copy === \"Copy my message\", s && s.copy);\n    await app.form.locator(\".fb-copy\").click({ timeout: 4000 });\n    await app.page.waitForTimeout(300);\n    const copied = await app.page.evaluate(() => navigator.clipboard.readText().catch(() => null));\n    if (copied === null) note(\"this browser doesn't let the check read the clipboard, so the copy wasn't checked\");\n    else check(\"which copies it\", copied === words && (await app.state()).copy === \"Copied\", copied);\n    app.web3forms.answer = \"busy\";\n    await app.send();\n    s = await app.state();\n    check(\"the service is busy: it says to try again in a few minutes\", !!s && /busy right now\\. Try again in a few minutes\\./.test(s.problem) && s.text === words, s && s.problem);\n    app.web3forms.answer = \"no\";\n    await app.send();\n    s = await app.state();\n    check(\"the service says no: it isn't counted as sent\", !!s && s.title === \"Send feedback\" && /Couldn't send it right now/.test(s.problem), s && s.problem);\n    app.web3forms.answer = \"cut\";\n    await app.send();\n    s = await app.state();\n    check(\"no internet: it says to check the connection\", !!s && /Check your internet connection and try again\\./.test(s.problem) && s.text === words, s && s.problem);\n    app.web3forms.answer = \"ok\";\n    await app.send();\n    s = await app.state();\n    check(\"and when it works again, the same message goes through\", !!s && s.title === \"Feedback sent\" && app.web3forms.got.length === 5 && app.web3forms.got[4].body.message === words, s && s.title);\n    const counted = await app.page.evaluate(() => JSON.parse(localStorage.getItem(\"aura_feedback_sent\") || \"[]\").length);\n    check(\"only the one that went through counts toward the day's limit\", counted === 1, counted);\n    await app.page.context().close();\n\n    console.log(\"4. Not losing what was typed\");\n    app = await start();\n    await app.openForm();\n    await app.form.getByRole(\"radio\", { name: \"Something else\", exact: true }).click({ timeout: 4000 });\n    await app.write(\"Half a thought about the Home page\");\n    await app.page.keyboard.press(\"Escape\");\n    await app.page.waitForTimeout(300);\n    check(\"Esc closes the form\", (await app.state()) === null);\n    check(\"and leaves you in Settings\", await app.button.isVisible());\n    await app.openForm();\n    s = await app.state();\n    check(\"opening it again brings back what was typed\", !!s && s.text === \"Half a thought about the Home page\" && s.kinds.join(\"|\") === \"A bug|An idea|Something else*\", s);\n    await app.form.getByRole(\"button\", { name: \"Cancel\", exact: true }).click({ timeout: 4000 });\n    await app.page.waitForTimeout(300);\n    check(\"Cancel closes it without sending\", (await app.state()) === null && app.web3forms.got.length === 0);\n    await app.page.context().close();\n\n    console.log(\"5. One PC can't use up the allowance\");\n    app = await start({ sentBefore: 10 });\n    await app.openForm();\n    await app.write(\"An eleventh message in one day, which is plenty.\");\n    await app.send();\n    s = await app.state();\n    check(\"after 10 in a day it says to send more tomorrow, and sends nothing\", !!s && /You can send more tomorrow\\./.test(s.problem) && app.web3forms.got.length === 0, s && s.problem);\n    await app.page.context().close();\n    app = await start({ sentBefore: 9 });\n    await app.openForm();\n    await app.write(\"A tenth message in one day is still fine.\");\n    await app.send();\n    check(\"the tenth still goes\", (await app.state()).title === \"Feedback sent\" && app.web3forms.got.length === 1);\n    await app.page.context().close();\n\n    console.log(\"6. The code\");\n    check(\"the feedback code is there (src/components/feedback.jsx)\", source.length > 2000);\n    check(\"it holds a Web3Forms access key\", KEY_SHAPE.test(key), key ? \"what is there isn't shaped like a key. Run  node aura-feedback-setup.cjs --key=YOUR-KEY\" : \"no key found\");\n    const addresses = (source.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/g) || []).filter((a) => !/@example\\.com$/i.test(a));\n    check(\"no email address is written into it (Web3Forms keeps the address, not AURA)\", addresses.length === 0, addresses.map((a) => a.replace(/^(.).*(@.*)$/, \"$1…$2\")));\n    const sites = [...new Set((source.match(/https?:\\/\\/[^\\s\"'`)]+/g) || []))];\n    check(\"the only place it sends to is Web3Forms\", sites.length === 1 && sites[0] === WEB3FORMS, sites);\n    const inApp = read(\"src\", \"components\", \"privacy.jsx\"), onGitHub = read(\"PRIVACY.md\");\n    if (!inApp && !onGitHub) note(\"the privacy policy isn't in this project, so it wasn't checked\");\n    else {\n      const says = (text) => /Web3Forms: if you send feedback from Settings/.test(text) && /Nothing is sent unless you press Send/.test(text);\n      check(\"the privacy policy says what sending feedback shares, in AURA and on GitHub\", (!inApp || says(inApp)) && (!onGitHub || says(onGitHub)));\n    }\n  } finally {\n    await browser.close();\n    server.close();\n  }\n  done(failed ? 1 : 0);\n})().catch((e) => { console.error(\"The feedback check itself broke:\", e); process.exit(2); });\n"};

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry-run");
const UNDO = process.argv.includes("--undo");
const BAK = ".before-feedback.bak";
const MARK = "Added by aura-feedback-setup.cjs";
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "release", ".git", ".vite", "coverage"]);
const CREATED = ["feedback.jsx", "feedback.cjs"];
const KEY_SLOT = "__AURA_FEEDBACK_KEY__";
const KEY_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_EXAMPLE = "1a2b3c4d-1234-5678-9abc-1a2b3c4d5e6f";
const RETIRED = [];

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
const count = (text, piece) => (piece ? text.split(piece).length - 1 : 0);

// ── One edit ──────────────────────────────────────────────────────────────────
// Each returns the new text and whether it changed anything. If the place it is looking for
// isn't there, that is fine when the edit was already made (its "done" text is present) or when
// the edit only removes something that is already gone. Anything else is a problem.
function applyEdit(text, edit) {
  const already = () => {
    if (edit.done && text.includes(edit.done)) return { text, changed: false };
    if (edit.missingOk) return { text, changed: false };
    throw new Error(edit.kind === "cut" || edit.kind === "insert" ? "the line  " + (edit.from || edit.after || edit.aheadOf).trim() : "the part for: " + edit.label);
  };
  if (edit.done && text.includes(edit.done)) return { text, changed: false };

  if (edit.kind === "replace") {
    const n = count(text, edit.before);
    if (n === 0) return already();
    if (n > 1) throw new Error("exactly one of  " + edit.before.slice(0, 70) + "  (there are " + n + ")");
    return { text: text.replace(edit.before, () => edit.text), changed: true };
  }

  if (edit.kind === "re") {
    const re = new RegExp(edit.re, "m");
    if (!re.test(text)) return already();
    return { text: text.replace(re, () => edit.text), changed: true };
  }

  const lines = text.split("\n");
  if (edit.kind === "insert") {
    const anchor = edit.after || edit.aheadOf;
    const hits = lines.map((l, i) => (l.includes(anchor) ? i : -1)).filter((i) => i >= 0);
    if (!hits.length) return already();
    if (hits.length > 1) throw new Error("exactly one line with  " + anchor.trim() + "  (there are " + hits.length + ")");
    lines.splice(hits[0] + (edit.after ? 1 : 0), 0, ...edit.text.replace(/\n$/, "").split("\n"));
    return { text: lines.join("\n"), changed: true };
  }

  if (edit.kind === "cut") {
    const starts = lines.map((l, i) => (l.includes(edit.from) ? i : -1)).filter((i) => i >= 0);
    if (!starts.length) return already();
    if (starts.length > 1) throw new Error("exactly one line with  " + edit.from.trim() + "  (there are " + starts.length + ")");
    const a = starts[0];
    let b = -1;
    for (let i = a + 1; i < lines.length; i++) if (lines[i].includes(edit.to)) { b = i; break; }
    if (b < 0) throw new Error("the line  " + edit.to.trim() + "  after  " + edit.from.trim());
    if (edit.maxLines && b - a > edit.maxLines) throw new Error("the part from  " + edit.from.trim() + "  where I expected it (it is longer than it should be)");
    // Never remove more than was meant: only these handlers may be inside the part taken out
    if (edit.only) {
      const inside = lines.slice(a, b).join("\n");
      const others = [...inside.matchAll(/ipcMain\.(?:handle|on)\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]).filter((name) => !edit.only.includes(name));
      if (others.length) throw new Error("the part from  " + edit.from.trim() + "  on its own (" + others.join(", ") + " is in the middle of it)");
    }
    const put = edit.text ? edit.text.replace(/\n$/, "").split("\n") : [];
    lines.splice(a, b - a, ...put);
    return { text: lines.join("\n"), changed: true };
  }
  throw new Error("how to make the change: " + edit.label);
}

// After the edits, none of these may be left, and all of the second list must be there. If not,
// an edit didn't fit this copy of AURA, and nothing is written.
const LEFTOVERS = {};
const REQUIRED = {
  app: ['import { FeedbackButton } from "./components/feedback";', "<FeedbackButton/></div>"],
  privacy: ['"Web3Forms:'],
  policy: ["- Web3Forms:"],
};

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

// ── The access key ────────────────────────────────────────────────────────────
// From the command line, or already in AURA from an earlier run, or asked for.
// Forgiving about what gets pasted around it: quotes, spaces, "access_key: ..."
const tidyKey = (value) => { const text = String(value || "").trim(); const m = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i); return m ? m[0] : text; };
function keyFromCommand() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const m = args[i].match(/^--?key(?:=(.*))?$/i);
    if (m) return tidyKey(m[1] !== undefined ? m[1] : args[i + 1]);
    if (!args[i].startsWith("-") && KEY_SHAPE.test(tidyKey(args[i]))) return tidyKey(args[i]); // the key on its own
  }
  return "";
}
function keyInAura() {
  try {
    const m = fs.readFileSync(path.join(ROOT, "src", "components", "feedback.jsx"), "utf8").match(/const FEEDBACK_FORM = "([^"]*)";/);
    return m && KEY_SHAPE.test(m[1]) ? m[1] : "";
  } catch { return ""; }
}
const KEY_HELP = [
  "A Web3Forms access key looks like this:  " + KEY_EXAMPLE,
  "It is in the email Web3Forms sent when you created the form, and on your form's page at web3forms.com.",
];
function askForKey() {
  return new Promise((resolve) => {
    const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout });
    let tries = 0;
    const ask = () => rl.question("Paste your Web3Forms access key and press Enter: ", (answer) => {
      const key = tidyKey(answer);
      if (KEY_SHAPE.test(key)) { resolve(key); return rl.close(); }
      if (++tries >= 3 || !key) { resolve(""); return rl.close(); }
      say("  That doesn't look like an access key. " + KEY_HELP[0]);
      ask();
    });
    rl.on("close", () => resolve(""));
    say();
    ask();
  });
}
async function findKey() {
  const given = keyFromCommand();
  if (process.argv.slice(2).some((a) => /^--?key/i.test(a)) || given) {
    if (!KEY_SHAPE.test(given)) stop(["That doesn't look like a Web3Forms access key.", ...KEY_HELP, "Run it like this:  node aura-feedback-setup.cjs --key=" + KEY_EXAMPLE + "   (with your own key)"]);
    return { key: given.toLowerCase(), from: "given" };
  }
  const kept = keyInAura();
  if (kept) return { key: kept, from: "kept" };
  if (DRY) return { key: "", from: "none" };
  if (!process.stdin.isTTY) stop(["I need your Web3Forms access key.", ...KEY_HELP, "Run it like this:  node aura-feedback-setup.cjs --key=" + KEY_EXAMPLE + "   (with your own key)"]);
  const typed = await askForKey();
  if (!typed) stop(["I didn't get a Web3Forms access key.", ...KEY_HELP, "Run this again when you have it."]);
  return { key: typed.toLowerCase(), from: "given" };
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
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) visit(full, depth + 1);
      } else if (entry.name.endsWith(BAK)) {
        const target = full.slice(0, -BAK.length);
        fs.copyFileSync(full, target); fs.unlinkSync(full);
        say("  restored  " + rel(target)); restored++;
      } else if (CREATED.includes(entry.name)) {
        try { if (fs.readFileSync(full, "utf8").includes(MARK)) { fs.unlinkSync(full); say("  removed   " + rel(full)); restored++; } } catch {}
      }
    }
  };
  say();
  visit(ROOT);
  say(restored ? "Undo finished. Everything is back to how it was." : "Nothing to undo.");
  say();
}

// ── Run ───────────────────────────────────────────────────────────────────────
async function run() {
  const pkgFile = path.join(ROOT, "package.json");
  if (!fs.existsSync(pkgFile)) stop(["This isn't your AURA project folder (no package.json here).", "Move this file next to package.json and run it from there."]);
  if (UNDO) return undo();

  const where = {
    app: { file: path.join(ROOT, "src", "App.jsx"), name: "window", js: false },
    privacy: { file: path.join(ROOT, "src", "components", "privacy.jsx"), name: "policy", js: false, optional: true },
    policy: { file: path.join(ROOT, "PRIVACY.md"), name: "policy", js: false, optional: true },
    runner: { file: path.join(ROOT, "tests", "run.cjs"), name: "checks", js: true, optional: true },
  };
  const missing = Object.values(where).filter((w) => !w.optional && !fs.existsSync(w.file)).map((w) => rel(w.file));
  if (missing.length) stop(["I couldn't find " + missing.join(" or ") + ".", "Make sure this file is in your AURA project folder, next to package.json.", "Copy this message to Claude."]);
  const hasChecks = fs.existsSync(where.runner.file);

  const plan = [];
  const problems = [];
  for (const [key, w] of Object.entries(where)) {
    if (w.optional && !fs.existsSync(w.file)) continue;
    const { text, eol } = readText(w.file);
    let now = text;
    const notes = [];
    for (const edit of EDITS.filter((e) => e.file === key)) {
      try {
        const result = applyEdit(now, edit);
        if (result.changed) { now = result.text; if (!notes.includes(edit.label)) notes.push(edit.label); }
      } catch (e) { problems.push("In " + rel(w.file) + " I couldn't find " + e.message + "."); }
    }
    const left = (LEFTOVERS[key] || []).filter((piece) => now.includes(piece));
    if (left.length) problems.push("In " + rel(w.file) + " I couldn't safely remove: " + left.join(", ") + ".");
    const absent = (REQUIRED[key] || []).filter((piece) => !now.includes(piece));
    if (absent.length) problems.push("In " + rel(w.file) + " I couldn't put in: " + absent.join(", ") + ".");
    if (w.js && now !== text) { const bad = syntaxProblem(now); if (bad) problems.push("In " + rel(w.file) + " I couldn't find a way to edit it safely (" + bad + ")."); }
    plan.push({ label: w.name, file: w.file, before: text, after: now, eol, notes });
  }

  // Only ask for the key once it's clear the rest will fit
  if (problems.length) stop([...problems, "Copy this message to Claude."]);
  const { key, from: keyFrom } = await findKey();

  const created = [{ label: "form", file: path.join(ROOT, "src", "components", "feedback.jsx"), content: FILES.form.split(KEY_SLOT).join(key || "(your access key goes here)") }];
  if (hasChecks) created.push({ label: "checks", file: path.join(ROOT, "tests", "feedback.cjs"), content: FILES.check });
  for (const c of created) {
    c.note = "created";
    if (fs.existsSync(c.file)) {
      const existing = readText(c.file).text;
      if (!existing.includes(MARK)) problems.push(rel(c.file) + " already exists and wasn't made by this script, so I left it alone.");
      else c.note = existing === c.content ? "already done" : (c.label === "form" && keyFrom === "given" && keyInAura() && keyInAura() !== key ? "updated with the new access key" : "updated");
    }
  }
  if (problems.length) stop([...problems, "Copy this message to Claude."]);

  say();
  say(DRY ? "Dry run. This is what would change:" : "AURA: a Send feedback button in Settings");
  say();
  for (const step of plan) {
    if (step.after !== step.before && !DRY) {
      const bak = step.file + BAK;
      if (!fs.existsSync(bak)) fs.copyFileSync(step.file, bak);
      fs.writeFileSync(step.file, withEol(step.after, step.eol));
    }
    say("  " + (step.label + ":").padEnd(11) + rel(step.file));
    (step.notes.length ? step.notes : ["already done"]).forEach((n) => say("             - " + n));
  }
  for (const c of created) {
    if (c.note !== "already done" && !DRY) { fs.mkdirSync(path.dirname(c.file), { recursive: true }); fs.writeFileSync(c.file, c.content); }
    say("  " + (c.label + ":").padEnd(11) + rel(c.file));
    say("             - " + c.note);
  }
  for (const r of RETIRED) {
    const file = path.join(ROOT, r.file);
    let mine = false;
    try { mine = fs.readFileSync(file, "utf8").includes(r.mark); } catch {}
    if (!mine) continue;
    if (!DRY) { const bak = file + BAK; if (!fs.existsSync(bak)) fs.copyFileSync(file, bak); fs.unlinkSync(file); }
    say("  " + "checks:".padEnd(11) + rel(file));
    say("             - removed (the new check covers it)");
  }
  say();
  if (DRY) { say("Run it again without --dry-run to apply." + (key ? "" : " It will ask for your Web3Forms access key.")); say(); return; }
  say("Access key: " + key.slice(0, 8) + "…" + (keyFrom === "kept" ? "  (the one already in AURA)" : ""));
  say();
  say("Done. Next:");
  if (hasChecks) say("  1. Check everything still works:   npm test");
  say("  " + (hasChecks ? "2" : "1") + ". Start AURA, open Settings, scroll to About and press Send feedback.");
  say("     Send yourself a test message, then look in your inbox. Check the spam folder too");
  say("     the first time, and mark it \"not spam\" if it landed there.");
  say();
  say("To undo later:  node aura-feedback-setup.cjs --undo");
  say();
}

run().catch((e) => { stop(["Something unexpected went wrong: " + e.message, "Copy this message to Claude."]); });
