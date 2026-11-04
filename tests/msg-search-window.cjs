// Message search and friend streaks in the window: the search box, results, opening an old result,
// "only in this chat", and 🔥 streaks in the chat list, header and friends list. Opens the built
// window (dist) in a real browser. Added by aura-messages-search-setup.cjs.
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
  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: "msedge" }, { channel: "chrome" }]) {
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

  const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", JO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", SAM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const C1 = "11111111-1111-4111-8111-111111111111", C2 = "22222222-2222-4222-8222-222222222222";
  async function open({ streaksMissing = false, searchError = "" } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date("2026-11-03T20:15:00"));
    await page.route((url) => !String(url).startsWith(base), (route) => route.abort());
    await page.addInitScript(({ ME, JO, SAM, C1, C2, streaksMissing, searchError }) => {
      try { localStorage.clear(); localStorage.setItem("aura_profile", JSON.stringify({ username: "tctray", avatar: "", userId: ME })); } catch {}
      window.__calls = [];
      const ok = (data) => Promise.resolve({ success: true, data });
      const no = (error) => Promise.resolve({ success: false, error });
      const day = (n) => new Date(Date.UTC(2026, 9, 1, 12, 0, n)).toISOString();
      // Jordan's chat: 130 messages, the 5th one is the old one search finds
      const msgs = Array.from({ length: 130 }, (_x, i) => ({ id: "m" + String(i).padStart(4, "0"), conversationId: C1, senderId: i % 2 ? JO : ME, content: i === 4 ? "remember that ranked comeback?" : "message " + i, createdAt: day(i), readAt: null, deleted: false, media: null, reactions: [] }));
      const now = new Date().toISOString();
      const friend = (userId, username) => ({ friendshipId: "f" + username, userId, username, avatarUrl: "", state: "friend", since: null, online: true, lastSeenAt: now });
      const conv = (id, userId, username) => ({ id, isGroup: false, userId, username, avatarUrl: "", online: true, isFriend: true, lastMessage: "hi", lastSenderId: userId, lastMessageAt: now, unread: 0, lastMedia: "", background: null });
      const answers = {
        "auraCloud.getSession": () => ok({ id: ME, email: "me@example.com" }), "auraCloud.getMyProfile": () => ok({ username: "tctray", avatar_url: null }),
        "auraSocial.start": () => ok({ id: ME, username: "tctray", live: true }),
        "auraSocial.listFriends": () => ok([friend(JO, "Jordan"), friend(SAM, "Sam")]),
        "auraSocial.listConversations": () => ok([conv(C1, JO, "Jordan"), conv(C2, SAM, "Sam")]),
        "auraSocial.listBlocked": () => ok([]),
        "auraSocial.getMessages": (cid, before) => {
          window.__calls.push(["getMessages", cid, before || null]);
          const all = cid === C1 ? msgs : [];
          const upto = before ? all.filter((m) => m.createdAt < before) : all;
          const page = upto.slice(-50);
          return ok({ messages: page, hasMore: upto.length > 50 });
        },
        "auraSocial.searchMessages": (words, cid, before) => {
          window.__calls.push(["searchMessages", words, cid || null, before || null]);
          if (searchError) return no(searchError);
          const all = [
            { id: "m0004", conversationId: C1, senderId: ME, content: "remember that ranked comeback?", createdAt: day(4) },
            { id: "s1", conversationId: C2, senderId: SAM, content: "Ranked tonight? I'm in.", createdAt: day(140) },
          ].filter((m) => m.content.toLowerCase().includes(words.toLowerCase()) && (!cid || m.conversationId === cid));
          return ok({ results: all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) });
        },
        "auraSocial.friendStreaks": () => ok(streaksMissing ? { streaks: [], unavailable: true } : { streaks: [{ userId: JO, days: 12, today: false }, { userId: SAM, days: 2, today: true }] }),
      };
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => { if (/^on[A-Z]/.test(String(key))) return () => {}; const a = answers[name + "." + String(key)]; return a ? a(...args) : ok(null); }) });
      window.auraCloud = fake("auraCloud"); window.auraSocial = fake("auraSocial");
      window.electronAPI = new Proxy({}, { get: (_t, key) => (key === "isElectron" || key === "then" ? undefined : (...args) => (/^on[A-Z]/.test(String(key)) ? () => {} : Promise.resolve(null))) });
    }, { ME, JO, SAM, C1, C2, streaksMissing, searchError });
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(3000);
    await page.locator('.gm-rail-item[title="Messages"], .sb-item[title="Messages"]').first().click();
    await page.waitForTimeout(1200);
    return page;
  }
  const calls = (page, n) => page.evaluate((n) => window.__calls.filter((c) => c[0] === n), n);
  let page;
  try {
    console.log("1. Friend streaks");
    page = await open();
    const jordan = page.locator(".mx-conv", { hasText: "Jordan" });
    check("Jordan's chat shows a 12-day streak", /🔥12/.test(await jordan.innerText()));
    check("...with ⌛ in the evening, because neither of you has messaged today", (await jordan.locator(".mx-streak.late").count()) === 1 && /Message Jordan today to keep it going/.test(await jordan.locator(".mx-streak").getAttribute("title")));
    check("a 2-day streak doesn't show yet (3 days or more)", !(await page.locator(".mx-conv", { hasText: "Sam" }).locator(".mx-streak").count()));
    await jordan.click(); await page.waitForTimeout(800);
    check("...and in the chat's header", /🔥12/.test(await page.locator(".mx-head").innerText()));
    await page.getByRole("button", { name: "New message" }).click(); await page.waitForTimeout(400);
    check("...and in your friends lists", (await page.locator(".mx-fr", { hasText: "Jordan" }).allInnerTexts()).every((t) => /🔥12/.test(t)));
    await page.getByRole("button", { name: "New message" }).click(); await page.waitForTimeout(300);

    console.log("2. Searching");
    const box = page.getByRole("searchbox", { name: "Search messages" });
    check("Messages has a search box", await box.isVisible());
    await box.fill("ranked"); await page.waitForTimeout(700);
    const res = page.locator(".mx-result");
    check("results from all your chats, newest first", (await res.count()) === 2 && /Sam/.test(await res.nth(0).innerText()) && /Jordan/.test(await res.nth(1).innerText()), await res.allInnerTexts());
    check("...asked once, after you stop typing", JSON.stringify((await calls(page, "searchMessages")).at(-1)) === JSON.stringify(["searchMessages", "ranked", null, null]) && (await calls(page, "searchMessages")).length === 1);
    check("...showing who said it, with the word highlighted", /You:/.test(await res.nth(1).innerText()) && (await res.nth(1).locator("mark").innerText()).toLowerCase() === "ranked");
    check("the chat list is out of the way while you search", !(await page.locator(".mx-conv:not(.mx-result)").count()));
    if (process.env.AURA_SHOT_DIR) await page.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "message-search.png") });
    await res.nth(1).click();
    // wait for the jump: earlier messages load, then the message lights up for a moment
    let lit = false;
    for (let i = 0; i < 80 && !lit; i++) { await page.waitForTimeout(100); lit = await page.evaluate(() => !!document.querySelector('[data-mid="m0004"].mx-hl')); }
    const older = (await calls(page, "getMessages")).filter((c) => c[1] === C1 && c[2]);
    check("opening an old result loads earlier messages until it's there", older.length >= 1, older);
    const target = page.locator('[data-mid="m0004"]');
    check("...then scrolls to it and lights it up", lit && (await target.count()) === 1 && await target.isVisible() && /remember that ranked comeback/.test(await target.innerText()));
    if (process.env.AURA_SHOT_DIR) await page.screenshot({ path: path.join(process.env.AURA_SHOT_DIR, "message-jump.png") });
    check("the results stay, so you can open another", (await res.count()) === 2);
    await page.getByLabel(/Only in Jordan/).check(); await page.waitForTimeout(700);
    check("“Only in Jordan” searches just that chat", JSON.stringify((await calls(page, "searchMessages")).at(-1).slice(0, 3)) === JSON.stringify(["searchMessages", "ranked", C1]) && (await res.count()) === 1);
    await box.fill("zzz"); await page.waitForTimeout(700);
    check("nothing found: it says so", /No messages with “zzz” in this chat/.test(await page.locator(".mx-results").innerText()));
    await box.press("Escape"); await page.waitForTimeout(300);
    check("Esc clears the search and brings back your chats", (await box.inputValue()) === "" && (await page.locator(".mx-conv").count()) === 2);
    await box.fill("r"); await page.waitForTimeout(600);
    check("one letter doesn't search", (await calls(page, "searchMessages")).every((c) => c[1] !== "r") && (await page.locator(".mx-conv").count()) === 2);
    await page.context().close();

    console.log("3. Before the database update");
    page = await open({ streaksMissing: true, searchError: "Message search and streaks need a one-time database update. In Supabase, open SQL Editor and run supabase/aura-messages-search.sql." });
    check("no streaks, and nothing breaks", !(await page.locator(".mx-streak").count()) && (await page.locator(".mx-conv").count()) === 2);
    await page.getByRole("searchbox", { name: "Search messages" }).fill("ranked"); await page.waitForTimeout(700);
    check("searching says which file to run", /aura-messages-search\.sql/.test(await page.locator(".mx-results").innerText()));
  } catch (e) {
    check("the test ran to the end", false, String(e?.stack || e).slice(0, 500));
  }
  await browser.close();
  server.close();
  done(failed ? 1 : 0);
})();
