// Emoji reactions and voice messages in the window: the emoji row beside a message, the reactions
// on it, playing a voice message, and recording one with a (fake) microphone. Opens the built
// window (dist) in a real browser. Added by aura-messages-emoji-voice-setup.cjs.
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff", ".webp": "image/webp", ".mp4": "video/mp4" };
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok || extra === undefined ? "" : "  " + JSON.stringify(extra))); };
const note = (text) => console.log("  note  " + text);
const done = (code) => { console.log(code === 0 ? "\nall passed" : code === 3 ? "\nskipped" : `\n${failed} FAILED`); process.exit(code); };

// A 3-second tone, standing in for a friend's voice message
function tone(seconds = 3, rate = 8000) {
  const n = seconds * rate, data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 6000), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

(async () => {
  if (!fs.existsSync(path.join(DIST, "index.html"))) { check("the window has been built (dist/index.html)", false, "Run  npm run build  first."); return done(1); }
  let chromium;
  try { ({ chromium } = require("playwright")); } catch { note("the test browser isn't installed here"); return done(process.env.CI ? 1 : 3); }
  let browser = null;
  const args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"];
  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: "msedge" }, { channel: "chrome" }]) {
    try { browser = await chromium.launch({ ...options, args }); break; } catch {}
  }
  if (!browser) { note("no browser to test with. Run  npx playwright install chromium  once to add one."); return done(process.env.CI ? 1 : 3); }

  const WAV = tone();
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (url === "/voice-test.wav") { res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": WAV.length }); return res.end(WAV); }
    const file = path.join(DIST, url === "/" ? "index.html" : url);
    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
      res.end(data);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;

  const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", JO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const C1 = "11111111-1111-4111-8111-111111111111";
  const VOICE_PATH = C1 + "/33333333-3333-4333-8333-333333333333.weba";
  async function open({ micRefused = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.grantPermissions(["microphone"], { origin: base }).catch(() => {});
    const page = await ctx.newPage();
    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());
    await page.addInitScript(({ ME, JO, C1, VOICE_PATH, base, micRefused }) => {
      try { localStorage.clear(); localStorage.setItem("aura_profile", JSON.stringify({ username: "tctray", avatar: "", userId: ME })); } catch {}
      if (micRefused) navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error("no"), { name: "NotAllowedError" }));
      window.__calls = [];
      const ok = (data) => Promise.resolve({ success: true, data });
      const at = (n) => new Date(Date.now() - (20 - n) * 60000).toISOString();
      const msgs = [
        { id: "m1", conversationId: C1, senderId: JO, content: "gg that was close", createdAt: at(1), readAt: null, deleted: false, media: null, reactions: [{ userId: JO, reaction: "laugh" }] },
        { id: "m2", conversationId: C1, senderId: ME, content: "rematch tomorrow?", createdAt: at(2), readAt: null, deleted: false, media: null, reactions: [{ userId: JO, reaction: "fire" }, { userId: ME, reaction: "like" }] },
        { id: "m3", conversationId: C1, senderId: JO, content: "", createdAt: at(10), readAt: null, deleted: false, reactions: [], media: { path: VOICE_PATH, kind: "audio", mime: "audio/webm", size: 9000, width: null, height: null, name: "", seconds: 3 } },
      ];
      const now = new Date().toISOString();
      let sent = 0;
      const answers = {
        "auraCloud.getSession": () => ok({ id: ME, email: "me@example.com" }), "auraCloud.getMyProfile": () => ok({ username: "tctray", avatar_url: null }),
        "auraSocial.start": () => ok({ id: ME, username: "tctray", live: true }),
        "auraSocial.listFriends": () => ok([{ friendshipId: "f1", userId: JO, username: "Jordan", avatarUrl: "", state: "friend", since: null, online: true, lastSeenAt: now }]),
        "auraSocial.listConversations": () => ok([{ id: C1, isGroup: false, userId: JO, username: "Jordan", avatarUrl: "", online: true, isFriend: true, lastMessage: "", lastSenderId: JO, lastMessageAt: now, unread: 0, lastMedia: "Voice message", background: null }]),
        "auraSocial.listBlocked": () => ok([]),
        "auraSocial.friendStreaks": () => ok({ streaks: [] }),
        "auraSocial.getMessages": () => ok({ messages: msgs, hasMore: false }),
        "auraSocial.mediaUrls": (paths) => { window.__calls.push(["mediaUrls", paths]); return ok({ urls: Object.fromEntries(paths.map((p) => [p, base + "/voice-test.wav"])), seconds: 3600 }); },
        "auraSocial.react": (mid, kind, cid) => { window.__calls.push(["react", mid, kind, cid]); return ok({ messageId: mid, userId: ME, reaction: kind }); },
        "auraSocial.sendMedia": (cid, file, caption) => {
          const b = file.bytes;
          const text = Array.from(b.slice(0, Math.min(b.length, 4096)), (x) => String.fromCharCode(x)).join("");
          window.__calls.push(["sendMedia", cid, { voice: file.voice, seconds: file.seconds, size: b.length, ebml: b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3, opus: text.includes("A_OPUS"), video: /V_VP|V_AV1/.test(text), name: file.name }, caption]);
          sent++;
          return new Promise((r) => setTimeout(() => r({ success: true, data: { id: "v" + sent, conversationId: cid, senderId: ME, content: "", createdAt: new Date().toISOString(), readAt: null, deleted: false, reactions: [], media: { path: C1 + "/4444444" + sent + "-4444-4444-8444-444444444444.weba", kind: "audio", mime: "audio/webm", size: b.length, width: null, height: null, name: "", seconds: file.seconds } } }), 300));
        },
      };
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...a) => { if (/^on[A-Z]/.test(String(key))) return () => {}; const f = answers[name + "." + String(key)]; return f ? f(...a) : ok(null); }) });
      window.auraCloud = fake("auraCloud"); window.auraSocial = fake("auraSocial");
      window.electronAPI = new Proxy({}, { get: (_t, key) => (key === "isElectron" || key === "then" ? undefined : (...a) => (/^on[A-Z]/.test(String(key)) ? () => {} : Promise.resolve(null))) });
    }, { ME, JO, C1, VOICE_PATH, base, micRefused });
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(3000);
    await page.locator('.gm-rail-item[title="Messages"], .sb-item[title="Messages"]').first().click();
    await page.waitForTimeout(1000);
    await page.locator(".mx-conv", { hasText: "Jordan" }).click();
    await page.waitForTimeout(900);
    return page;
  }
  const calls = (page, n) => page.evaluate((n) => window.__calls.filter((c) => c[0] === n), n);
  const until = async (fn, ms = 6000) => { for (let t = 0; t < ms; t += 100) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
  let page;
  try {
    console.log("1. Emoji reactions");
    page = await open();
    const m1 = page.locator('[data-mid="m1"]'), m2 = page.locator('[data-mid="m2"]');
    check("a friend's 😂 shows under their message, with who it was", /😂/.test(await m1.locator(".mx-reacts").innerText()) && (await m1.locator(".mx-react.laugh").getAttribute("title")) === "Jordan reacted 😂 to this");
    check("different emoji from different people show side by side", (await m2.locator(".mx-react").count()) === 2 && /🔥/.test(await m2.locator(".mx-reacts").innerText()) && (await m2.locator(".mx-react.like.on").count()) === 1);
    check("👍 still reads “liked”", /^You liked this/.test(await m2.locator(".mx-react.like").getAttribute("title")));
    await m1.hover(); await page.waitForTimeout(200);
    check("pointing at a message shows Like and the emoji button", await m1.getByRole("button", { name: "Like", exact: true }).isVisible() && await m1.getByRole("button", { name: "React with an emoji" }).isVisible());
    await m1.getByRole("button", { name: "React with an emoji" }).click(); await page.waitForTimeout(250);
    const pop = m1.locator(".mx-emo-pop");
    check("the emoji row opens with all 8", (await pop.locator("button").count()) === 8 && (await pop.innerText()).replace(/\s/g, "") === "👍👎❤️😂😮😢😡🔥");
    check("...and the first one has the keyboard", await page.evaluate(() => document.activeElement?.dataset?.emoji === "like"));
    if (process.env.AURA_SHOT_DIR) await page.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "emoji-reactions.png") });
    await pop.getByRole("button", { name: "Love" }).click(); await page.waitForTimeout(300);
    check("picking ❤️ sends “love” for that message", JSON.stringify((await calls(page, "react")).at(-1)) === JSON.stringify(["react", "m1", "love", C1]));
    check("...it shows straight away, next to Jordan's 😂", (await m1.locator(".mx-react.love.on").count()) === 1 && (await m1.locator(".mx-react").count()) === 2 && (await pop.count()) === 0);
    await m1.hover();
    check("the emoji button now shows your ❤️", (await m1.locator(".mx-act-emoji").innerText()).includes("❤️") && /Your reaction: Love/.test(await m1.locator(".mx-act-emoji").getAttribute("aria-label")));
    await m1.locator(".mx-act-emoji").click(); await page.waitForTimeout(200);
    await m1.locator(".mx-emo-pop").getByRole("button", { name: "Haha" }).click(); await page.waitForTimeout(300);
    check("picking another emoji swaps yours (one each)", (await calls(page, "react")).at(-1)[2] === "laugh" && (await m1.locator(".mx-react.love").count()) === 0 && /You and Jordan reacted 😂 to this/.test(await m1.locator(".mx-react.laugh").getAttribute("title")));
    check("...and the two 😂 are counted", /2/.test(await m1.locator(".mx-react.laugh").innerText()));
    await m1.locator(".mx-react.laugh").click(); await page.waitForTimeout(300);
    check("clicking your reaction takes it back", (await calls(page, "react")).at(-1)[2] === null && !/You/.test(await m1.locator(".mx-react.laugh").getAttribute("title")));
    await m1.hover(); await m1.locator(".mx-act-emoji").click(); await page.waitForTimeout(150);
    await page.keyboard.press("Escape"); await page.waitForTimeout(150);
    check("Esc closes the emoji row without picking", (await page.locator(".mx-emo-pop").count()) === 0 && (await calls(page, "react")).length === 3);

    console.log("2. Playing a voice message");
    const v = page.locator('[data-mid="m3"]');
    check("Jordan's voice message shows a player, not a picture", (await v.locator(".mx-voice").count()) === 1 && (await v.locator("img").count()) === 0);
    check("...its private link is asked for like a picture's", (await calls(page, "mediaUrls")).some((c) => c[1].includes(VOICE_PATH)));
    check("...with how long it is", await until(async () => (await v.locator(".mx-voice-t").innerText()) === "0:03"));
    await v.getByRole("button", { name: "Play voice message" }).click();
    check("Play plays it (the button turns into Pause)", await until(async () => (await v.getByRole("button", { name: "Pause voice message" }).count()) === 1));
    check("...and the time counts up", await until(async () => /^0:0[12]$/.test(await v.locator(".mx-voice-t").innerText())));
    await v.getByRole("button", { name: "Pause voice message" }).click();
    check("Pause stops it", await until(async () => (await v.getByRole("button", { name: "Play voice message" }).count()) === 1));
    check("the chat list calls it a voice message", /Voice message/.test(await page.locator(".mx-conv", { hasText: "Jordan" }).innerText()));

    console.log("3. Recording one");
    const mic = page.getByRole("button", { name: "Record a voice message" });
    check("an empty typing box has a microphone button", await mic.isVisible());
    const box = page.getByRole("textbox", { name: "Message Jordan" });
    await box.fill("typing"); await page.waitForTimeout(100);
    check("...that steps aside while you type", (await mic.count()) === 0);
    await box.fill(""); await page.waitForTimeout(100);
    await mic.click();
    check("recording starts: red dot and a timer", await until(async () => (await page.locator(".mx-rec.recording").count()) === 1));
    check("...and the sound level moves", await until(async () => page.evaluate(() => [...document.querySelectorAll(".mx-rec-wave i")].some((i) => parseFloat(i.style.height) > 9))));
    await page.waitForTimeout(1700);
    check("...the timer counts", /^0:0[1-9]/.test(await page.locator(".mx-rec-t").innerText()));
    if (process.env.AURA_SHOT_DIR) await page.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "voice-recording.png") });
    await page.getByRole("button", { name: "Stop recording" }).click();
    check("Stop lets you listen to it first", await until(async () => (await page.locator(".mx-rec.stopped .mx-voice").count()) === 1));
    await page.getByRole("button", { name: "Send voice message" }).click();
    check("Send sends it as a voice recording, with its length", await until(async () => (await calls(page, "sendMedia")).length === 1));
    const first = (await calls(page, "sendMedia"))[0];
    check("...a WebM with Opus sound and no picture, 1 to 9 seconds long", first[1] === C1 && first[2].voice === true && first[2].ebml && first[2].opus && !first[2].video && first[2].seconds >= 1 && first[2].seconds <= 9 && first[3] === "", first);
    check("...it shows in the chat as a voice message", await until(async () => (await page.locator('[data-mid="v1"] .mx-voice').count()) === 1));
    check("...and the typing box is back", await box.isVisible());

    await mic.click(); await until(async () => (await page.locator(".mx-rec.recording").count()) === 1);
    await page.waitForTimeout(1300);
    await page.getByRole("button", { name: "Send voice message" }).click();
    check("Send while still recording sends it straight away", await until(async () => (await calls(page, "sendMedia")).length === 2));
    await page.waitForTimeout(400);

    await mic.click(); await until(async () => (await page.locator(".mx-rec.recording").count()) === 1);
    await page.waitForTimeout(600);
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    check("Esc throws the recording away", (await page.locator(".mx-rec").count()) === 0 && (await calls(page, "sendMedia")).length === 2);

    await mic.click(); await until(async () => (await page.locator(".mx-rec.recording").count()) === 1);
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "Stop recording" }).click();
    check("a recording under a second isn't sent, and it says why", await until(async () => /too short/.test(await page.locator(".mx-rec-err").innerText().catch(() => ""))) && (await calls(page, "sendMedia")).length === 2);
    await page.getByRole("button", { name: "Delete recording" }).click();
    check("Delete closes it", (await page.locator(".mx-rec").count()) === 0);
    if (process.env.AURA_SHOT_DIR) await page.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "voice-messages.png") });
    await page.context().close();

    console.log("4. Without a microphone");
    page = await open({ micRefused: true });
    await page.getByRole("button", { name: "Record a voice message" }).click();
    check("if Windows blocks the microphone, it says where to turn it on", await until(async () => /Privacy & security > Microphone/.test(await page.locator(".mx-rec-err").innerText().catch(() => ""))));
    check("...and nothing is sent", (await calls(page, "sendMedia")).length === 0);
  } catch (e) {
    check("the test ran to the end", false, String(e?.stack || e).slice(0, 500));
  }
  await browser.close();
  server.close();
  done(failed ? 1 : 0);
})();
