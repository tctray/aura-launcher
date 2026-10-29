// Settings > Voice Commands, the Listening sign, and what AURA does with a command: pages, music,
// starting a game. Opens the built window (dist) in a real browser, as AURA on Windows, and plays
// the part of the main process. Added by aura-voice-setup.cjs. Every page, calls and typing messages
// by voice: updated by aura-voice-more-setup.cjs.
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

(async () => {
  if (!fs.existsSync(path.join(DIST, "index.html"))) { check("the window has been built (dist/index.html)", false, "Run  npm run build  first."); return done(1); }
  let chromium;
  try { ({ chromium } = require("playwright")); } catch { note("the test browser isn't installed here"); return done(process.env.CI ? 1 : 3); }
  let browser = null;
  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: "msedge" }, { channel: "chrome" }].map((o) => ({ ...o, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] }))) {
    try { browser = await chromium.launch(options); break; } catch {}
  }
  if (!browser) { note("no browser to test with. Run  npx playwright install chromium  once to add one."); return done(process.env.CI ? 1 : 3); }

  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
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

  async function open({ windows = true } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, userAgent: windows ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) aura Chrome/134.0 Electron/44.0 Safari/537.36" : "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) aura Chrome/134.0 Electron/44.0 Safari/537.36" });
    const page = await ctx.newPage();
    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());
    // A pretend YouTube player that remembers the commands AURA sends it
    await page.route((url) => String(url).startsWith("https://www.youtube-nocookie.com/embed/"), (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><body><script>
      window.cmds = [];
      addEventListener("message", (e) => { let d; try { d = JSON.parse(e.data); } catch { return; }
        if (d.event === "listening" && !window.said) { window.said = true; parent.postMessage(JSON.stringify({ event: "onReady" }), "*"); parent.postMessage(JSON.stringify({ event: "infoDelivery", info: { playerState: 1, currentTime: 1, duration: 100 } }), "*"); }
        if (d.event === "command") window.cmds.push(d.func); });
    </script></body>` }));
    await page.addInitScript(() => {
      try {
        localStorage.clear();
        localStorage.setItem("aura_profile", JSON.stringify({ username: "tctray", avatar: "", userId: "user-1" }));
        localStorage.setItem("aura_games", JSON.stringify([{ id: "g1", title: "Fortnite", exePath: "C:\\Games\\Fortnite.exe", genre: "Action", cover: "", favorite: false, playCount: 0 }, { id: "g2", title: "No Path Game", exePath: "" }]));
      } catch {}
      window.__calls = [];
      const ok = (data) => Promise.resolve({ success: true, data });
      // A friend, JordanK, and your chat with them (Added by aura-voice-more-setup.cjs)
      const now = new Date().toISOString();
      const chat = { id: "c1", isGroup: false, userId: "user-j", username: "JordanK", avatarUrl: "", online: true, isFriend: true, lastMessage: "", lastSenderId: null, lastMessageAt: now, unread: 0, lastMedia: "", background: null };
      window.__sent = [];
      const answers = {
        "auraCloud.getSession": () => ok({ id: "user-1", email: "me@example.com" }), "auraCloud.getMyProfile": () => ok({ username: "tctray", avatar_url: null }),
        "auraSocial.start": () => ok({ id: "user-1", username: "tctray", live: true }),
        "auraSocial.listFriends": () => ok([{ friendshipId: "f1", userId: "user-j", username: "JordanK", avatarUrl: "", state: "friend", since: null, online: true, lastSeenAt: now }]),
        "auraSocial.listConversations": () => ok([chat]), "auraSocial.listBlocked": () => ok([]), "auraSocial.openConversation": () => ok("c1"),
        "auraSocial.getMessages": () => ok({ messages: [], hasMore: false }),
        "auraSocial.sendMessage": (id, content) => { window.__sent.push([id, content]); return ok({ id: "m" + window.__sent.length, conversationId: id, senderId: "user-1", content, createdAt: new Date().toISOString(), readAt: null, deleted: false, media: null, reactions: [] }); },
        "auraSocial.startCall": (userId) => { window.__calls.push(["startCall", [userId]]); return ok({ id: "call-1" }); },
      };
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => { if (/^on[A-Z]/.test(String(key))) return () => {}; const a = answers[name + "." + String(key)]; return a ? a(...args) : ok(null); }) });
      window.auraCloud = fake("auraCloud");
      window.auraSocial = fake("auraSocial");
      // The voice part of AURA's bridge; the test plays the main process
      const v = { enabled: false, state: "off", error: "", status: [], command: [] };
      window.__voice = v;
      const st = () => ({ success: true, supported: true, enabled: v.enabled, state: v.state, error: v.error, language: "en-US", commands: ["next song"] });
      const voice = {
        voiceGet: async () => st(),
        voiceSet: async (on) => { v.enabled = on; v.state = on ? "starting" : "off"; return st(); },
        voiceGames: async (titles) => ({ success: true, count: titles.length }),
        voiceFriends: async (names) => ({ success: true, count: names.length }),
        voiceKey: async () => ({ success: true }),
        onVoiceStatus: (cb) => { v.status.push(cb); return () => { v.status = v.status.filter((x) => x !== cb); }; },
        onVoiceCommand: (cb) => { v.command.push(cb); return () => { v.command = v.command.filter((x) => x !== cb); }; },
      };
      window.__fire = (kind, data) => window.__voice[kind].forEach((cb) => cb(data));
      window.electronAPI = new Proxy({}, { get: (_t, key) => {
        if (key in voice) return (...args) => { window.__calls.push([String(key), args]); return voice[key](...args); };
        if (key === "isElectron" || key === "then") return undefined;
        return (...args) => { if (/^on[A-Z]/.test(String(key))) return () => {}; return Promise.resolve(null); };
      } });
    });
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(3500);
    return page;
  }
  const toSettings = async (page) => { await page.locator('.gm-rail-item[title="Settings"], .sb-item[title="Settings"]').first().click(); await page.waitForTimeout(600); };
  const calls = (page, k) => page.evaluate((k) => window.__calls.filter(([n]) => n === k).map(([, a]) => a), k);
  const fire = async (page, kind, data) => { await page.evaluate(([k, d]) => window.__fire(k, d), [kind, data]); await page.waitForTimeout(350); };
  const onPage = (page) => page.evaluate(() => document.querySelector(".gm-rail-item.on, .sb-item.on")?.getAttribute("title") || "");
  let page;
  try {
    console.log("1. Settings > Voice Commands");
    page = await open({ windows: false });
    await toSettings(page);
    check("not on Windows: no Voice Commands in Settings", await page.getByText("UI Scale").isVisible() && !(await page.getByText("VOICE COMMANDS", { exact: true }).count()));
    await page.context().close();
    page = await open();
    await toSettings(page);
    const sw = page.getByRole("switch", { name: "Voice commands" });
    check("on Windows it's there, switched off", await page.getByText("VOICE COMMANDS", { exact: true }).isVisible() && (await sw.getAttribute("aria-checked")) === "false");
    check("...saying the microphone isn't used", /Off\. AURA doesn't use your microphone/.test(await page.locator(".sr", { hasText: "Status" }).innerText()));
    check("...between Sound and Recording", await page.evaluate(() => { const t = [...document.querySelectorAll(".ss-t")].map((e) => e.textContent); return t.indexOf("VOICE COMMANDS") === t.indexOf("SOUND") + 1 && t.indexOf("RECORDING") === t.indexOf("VOICE COMMANDS") + 1; }));
    await sw.click(); await page.waitForTimeout(300);
    check("switching it on asks AURA to start listening", JSON.stringify(await calls(page, "voiceSet")) === "[[true]]" && (await sw.getAttribute("aria-checked")) === "true" && /Starting/.test(await page.locator(".sr", { hasText: "Status" }).innerText()));
    await fire(page, "status", { supported: true, enabled: true, state: "listening", error: "" });
    check("...then it says it's listening for “Hey AURA”", /Listening for “Hey AURA”/.test(await page.locator(".sr", { hasText: "Status" }).innerText()));
    await page.getByRole("button", { name: "What you can say" }).click();
    check("“What you can say” lists the commands", /start recording/.test(await page.locator(".vc-say").innerText()) && /launch, then a game's name/.test(await page.locator(".vc-say").innerText()));
    await fire(page, "status", { supported: true, enabled: true, state: "error", error: "AURA couldn't use your microphone." });
    check("a problem is shown in Status", /couldn't use your microphone/.test(await page.locator(".sr", { hasText: "Status" }).innerText()) && await page.locator(".vc-err").isVisible());
    if (process.env.AURA_SHOT_DIR) await page.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "voice-settings.png") });
    check("AURA tells it the games it can launch (ones with a file to start)", JSON.stringify((await calls(page, "voiceGames")).at(-1)) === JSON.stringify([["Fortnite"]]));
    check("...and your friends' names, for calls and messages", JSON.stringify((await calls(page, "voiceFriends")).at(-1)) === JSON.stringify([["JordanK"]]), await calls(page, "voiceFriends"));
    check("the list of what you can say has every page, calls and messages", /recently played · favorites · live streams/.test(await page.locator(".vc-say").innerText()) && /call Jordan/.test(await page.locator(".vc-say").innerText()) && /Say “send” to send it/.test(await page.locator(".vc-say").innerText()));

    console.log("2. Doing what you said");
    await fire(page, "status", { state: "awake" });
    check("“Hey AURA” shows the Listening sign", /Listening… say a command/.test(await page.locator(".vc-sign").innerText()));
    await fire(page, "command", { action: "open", detail: "library", said: "open library" });
    check("“open library” opens the library", (await onPage(page)) === "Library");
    check("...and the sign shows what was heard", /“open library”/.test(await page.locator(".vc-sign").innerText()));
    await fire(page, "command", { action: "open", detail: "media", said: "open media" });
    check("“open media” opens Clips on the Media tab", (await onPage(page)) === "Clips" && (await page.locator('[role="tab"][aria-selected="true"]', { hasText: "Media" }).count()) === 1);
    await fire(page, "command", { action: "media", detail: "next", said: "next song" });
    check("“next song” with nothing playing in AURA: Windows' next-track key", JSON.stringify((await calls(page, "voiceKey")).at(-1)) === JSON.stringify(["next"]));
    await fire(page, "command", { action: "media", detail: "pause", said: "pause" });
    check("“pause”: Windows' play/pause key", JSON.stringify((await calls(page, "voiceKey")).at(-1)) === JSON.stringify(["playpause"]));
    await fire(page, "command", { action: "launch", detail: "Fortnite", said: "launch fortnite" });
    await page.waitForTimeout(2600);
    check("“launch Fortnite” starts it", /Fortnite launched!/.test(await page.locator(".tc").innerText()), await page.locator(".tc").innerText());
    await fire(page, "command", { action: "launch", detail: "Halo", said: "launch halo" });
    check("a game that isn't there: AURA says so", /“Halo” isn't in your library/.test(await page.locator(".tc").innerText()));
    console.log("3. When AURA's player is playing");
    await page.getByLabel("YouTube link").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await page.locator(".md-yt").getByRole("button", { name: "Play", exact: true }).click(); await page.waitForTimeout(2000);
    const keys = (await calls(page, "voiceKey")).length;
    const yt = () => page.frames().find((f) => f.url().includes("youtube-nocookie"))?.evaluate(() => window.cmds) || [];
    await fire(page, "command", { action: "media", detail: "pause", said: "pause" });
    check("“pause” pauses AURA's player, not Windows'", (await yt()).includes("pauseVideo") && (await calls(page, "voiceKey")).length === keys, await yt());
    await fire(page, "command", { action: "media", detail: "down", said: "volume down" });
    check("“volume down” turns AURA's player down", (await page.locator(".md-now").getByLabel("Volume").inputValue()) === String(Math.round((0.8 - 0.1) * 100) / 100), await page.locator(".md-now").getByLabel("Volume").inputValue());
    console.log("4. Every page on the left");
    for (const [detail, title] of [["recent", "Recently Played"], ["favorites", "Favorites"], ["streams", "Live Streams"], ["social", "Social"], ["sessions", "Sessions"], ["performance", "Performance"], ["achievements", "Achievements"], ["customize", "Customize"], ["home", "Home"]]) {
      await fire(page, "command", { action: "open", detail, said: "open " + detail });
      if ((await onPage(page)) !== title) { check(`“open ${detail}” opens ${title}`, false, await onPage(page)); break; }
    }
    check("“open …” works for every page on the left", (await onPage(page)) === "Home");

    console.log("5. Messages by voice");
    await fire(page, "command", { action: "message", detail: "start", who: "JordanK", said: "message jordan k" });
    await page.waitForTimeout(800);
    check("“message Jordan” opens your chat with Jordan", (await onPage(page)) === "Messages" && /JordanK/.test(await page.locator(".mx-head").innerText().catch(() => "")));
    await fire(page, "status", { state: "typing" });
    check("...with a sign saying to say send or cancel", /Typing your message… say “send” or “cancel”/.test(await page.locator(".vc-sign").innerText()));
    await fire(page, "command", { action: "type", detail: "text", text: "you on tonight", said: "you on tonight" });
    await fire(page, "command", { action: "type", detail: "text", text: "for some ranked?", said: "for some ranked?" });
    const box = page.locator(".mx-compose textarea");
    check("what you say is typed into the message box", (await box.inputValue()) === "you on tonight for some ranked?", await box.inputValue());
    check("...and nothing is sent yet", (await page.evaluate(() => window.__sent.length)) === 0);
    await fire(page, "status", { state: "listening" });
    await fire(page, "command", { action: "type", detail: "send", said: "send" });
    await page.waitForTimeout(500);
    check("“send” sends it, like Enter", JSON.stringify(await page.evaluate(() => window.__sent)) === JSON.stringify([["c1", "you on tonight for some ranked?"]]) && (await box.inputValue()) === "");
    await fire(page, "command", { action: "type", detail: "text", text: "never mind that", said: "never mind that" });
    await fire(page, "command", { action: "type", detail: "cancel", said: "cancel" });
    check("“cancel” clears the box without sending", (await box.inputValue()) === "" && (await page.evaluate(() => window.__sent.length)) === 1);
    await fire(page, "command", { action: "type", detail: "stop", said: "" });
    check("after 20 quiet seconds, it says typing stopped", /Stopped typing/.test(await page.locator(".vc-sign").innerText()));

    console.log("6. Calls by voice");
    await fire(page, "command", { action: "call", detail: "start", who: "Nobody", said: "call nobody" });
    check("calling someone who isn't a friend: AURA says so", /Nobody isn't one of your friends/.test(await page.locator(".tc").innerText()));
    await fire(page, "command", { action: "call", detail: "start", who: "JordanK", said: "call jordan k" });
    await page.waitForTimeout(1500);
    check("“call Jordan” calls Jordan", JSON.stringify((await calls(page, "startCall")).at(-1)) === JSON.stringify(["user-j"]), await page.locator(".tc").innerText());
    await fire(page, "command", { action: "call", detail: "hangup", said: "hang up" });
    await page.waitForTimeout(800);
    check("“hang up” ends it", !(await page.locator(".cx-bar.ringing, .cx-bar.live").count()));

    await fire(page, "command", { action: "open", detail: "../../evil", said: "x" });
    await fire(page, "command", { action: "rm", detail: "-rf", said: "x" });
    check("anything else is ignored", (await onPage(page)) === "Messages");
  } catch (e) {
    check("the test ran to the end", false, String(e?.message || e).slice(0, 400));
  }
  await browser.close();
  server.close();
  done(failed ? 1 : 0);
})();
