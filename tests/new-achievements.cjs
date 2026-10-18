// The new achievements: Picture Perfect, Clip It!, Content Creator, First Friend, First Contact,
// Connected, Squad Up, Early Adopter and Aura Legend. Part 1 checks the counting; part 2 opens the
// built window (dist) in a real browser with a pretend desktop side. Added by aura-new-achievements-setup.cjs.
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff" };
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok || extra === undefined ? "" : "\n          " + (typeof extra === "string" ? extra : JSON.stringify(extra)))); };
const note = (text) => console.log("  note  " + text);
const done = (code) => { console.log(code === 0 ? "\nall passed" : code === 3 ? "\nskipped" : `\n${failed} FAILED`); process.exit(code); };

(async () => {
  console.log("1. Counting");
  const src = fs.readFileSync(path.join(ROOT, "src", "achievements.js"), "utf8");
  const { achievementStats } = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
  let s = achievementStats([], { clipsSaved: 1, messagesSent: 3, firstSeenAt: "2026-10-18T10:00:00Z" }, [], [], { clips: 4, screenshots: 2, friends: 1, accounts: 2, partySize: 2 });
  check("clips and screenshots on this PC, friends, linked accounts and calls are counted", s.clipsSaved === 4 && s.screenshotsTaken === 2 && s.friendsCount === 1 && s.accountsLinked === 2 && s.maxPartySize === 2, s);
  check("messages sent and the first day are kept", s.messagesSent === 3 && s.firstSeenAt === "2026-10-18", s);
  s = achievementStats([], { clipsSaved: 5, friendsCount: 3 }, [], [], { clips: 1, friends: 0 });
  check("never lower than before (a deleted clip or removed friend doesn't take anything back)", s.clipsSaved === 5 && s.friendsCount === 3, s);
  check("nothing known: all zero, and no first day", (() => { const z = achievementStats([], {}, [], []); return z.clipsSaved === 0 && z.messagesSent === 0 && z.firstSeenAt === null; })());
  const messages = fs.readFileSync(path.join(ROOT, "src", "components", "messages.jsx"), "utf8");
  check("sending a message (text, picture, GIF or video) tells AURA, for First Contact", (messages.match(/dispatchEvent\(new Event\("aura-message-sent"\)\)/g) || []).length >= 2);

  console.log("2. In the window");
  if (!fs.existsSync(path.join(DIST, "index.html"))) { check("the window has been built (dist/index.html)", false, "Run  npm run build  first."); return done(1); }
  let chromium;
  try { ({ chromium } = require("playwright")); } catch { note("the test browser isn't installed here"); return done(failed ? 1 : process.env.CI ? 1 : 3); }
  let browser = null;
  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: "msedge" }, { channel: "chrome" }]) {
    try { browser = await chromium.launch(options); break; } catch {}
  }
  if (!browser) { note("no browser to test with."); return done(failed ? 1 : process.env.CI ? 1 : 3); }
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path.join(DIST, url === "/" ? "index.html" : url);
    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" }); res.end(data); });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;

  // One AURA, set up as `setup` says
  const open = async (setup) => {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    const thrown = [];
    page.on("pageerror", (e) => thrown.push(String(e.message || e).split("\n")[0]));
    await page.route((url) => !String(url).startsWith(base) && !String(url).startsWith("data:"), (route) => route.abort());
    await page.addInitScript((setup) => {
      try {
        localStorage.clear();
        localStorage.setItem("aura_profile", JSON.stringify({ username: "tester", avatar: "", userId: "user-1" }));
        for (const [k, v] of Object.entries(setup.storage || {})) localStorage.setItem(k, v);
      } catch {}
      window.__pc = { clips: setup.clips || 0, screenshots: setup.screenshots || 0, discord: !!setup.discord };
      const ok = (data) => Promise.resolve({ success: true, data });
      const account = { getSession: () => ok({ id: "user-1", email: "me@example.com" }), getMyProfile: () => ok({ username: "tester", avatar_url: null }) };
      const social = {
        start: () => ok({ id: "user-1", username: "tester", live: true }),
        listFriends: () => ok(setup.friends ? [{ friendshipId: "f1", userId: "user-2", username: "Bri", avatarUrl: "", state: "friend", online: true }] : []),
        listConversations: () => ok([]), listBlocked: () => ok([]),
      };
      window.auraCloud = new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (account[key] ? account[key](...args) : ok(null))) });
      window.auraSocial = new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : key === "onEvent" ? () => () => {} : (...args) => (social[key] ? social[key](...args) : ok(null))) });
      const desktop = {
        getClips: () => Promise.resolve({ success: true, clips: Array.from({ length: window.__pc.clips }, (_, i) => ({ id: "c" + i })) }),
        getScreenshots: () => Promise.resolve({ success: true, screenshots: Array.from({ length: window.__pc.screenshots }, (_, i) => ({ id: "s" + i })) }),
        discordGetUser: () => Promise.resolve(window.__pc.discord ? { success: true, user: { username: "me" } } : { success: false }),
      };
      window.electronAPI = new Proxy({}, {
        get: (_t, key) => {
          if (key === "isElectron") return true;
          if (typeof key !== "string" || key === "then") return undefined;
          if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};
          return (...args) => (desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }));
        },
      });
    }, setup);
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(5500);
    return { page, thrown };
  };
  const unlocked = (page) => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("aura_achievements") || "{}")).sort());
  const stat = (page, k) => page.evaluate((k) => JSON.parse(localStorage.getItem("aura_stats") || "{}")[k], k);

  try {
    console.log("3. Clips, screenshots and Early Adopter");
    let { page, thrown } = await open({ clips: 1, screenshots: 2 });
    let u = await unlocked(page);
    check("a clip and screenshots already on the PC unlock Clip It! and Picture Perfect", u.includes("first_clip") && u.includes("first_screenshot"), u);
    check("not Content Creator yet (3 of 10)", !u.includes("ten_captures"), u);
    check("first time in AURA before 2027: Early Adopter", u.includes("early_adopter") && /^\d{4}-\d{2}-\d{2}$/.test(await stat(page, "firstSeenAt")), [u, await stat(page, "firstSeenAt")]);
    check("nothing that wasn't earned: no friend, message, link or party ones", !u.some((id) => ["first_friend", "first_message", "account_linked", "squad_up", "aura_legend"].includes(id)), u);
    await page.evaluate(() => { window.__pc.clips = 8; window.dispatchEvent(new Event("focus")); });
    await page.waitForTimeout(3500);
    check("more clips saved: Content Creator unlocks when AURA looks again", (await unlocked(page)).includes("ten_captures"), await unlocked(page));
    await page.evaluate(() => window.dispatchEvent(new Event("aura-message-sent")));
    await page.waitForTimeout(3500);
    check("sending a message: First Contact", (await unlocked(page)).includes("first_message") && (await stat(page, "messagesSent")) === 1, [await unlocked(page), await stat(page, "messagesSent")]);
    check("nothing crashed", thrown.filter((m) => !/reading 'live'/.test(m)).length === 0, thrown);
    await page.context().close();

    console.log("4. Friends and linked accounts");
    ({ page, thrown } = await open({ friends: true, storage: { aura_steam_id: "76561198000000000" } }));
    u = await unlocked(page);
    check("a friend in your list: First Friend", u.includes("first_friend"), u);
    check("Steam linked: Connected", u.includes("account_linked"), u);
    await page.context().close();
    ({ page } = await open({ discord: true }));
    check("Discord linked: Connected", (await unlocked(page)).includes("account_linked"), await unlocked(page));
    await page.context().close();
    ({ page } = await open({ storage: { aura_games: JSON.stringify([{ id: "x1", title: "ARC Raiders", exePath: "C:/XboxGames/ARC Raiders/Content/gamelaunchhelper.exe", cover: "", category: "Other", favorite: false, playCount: 0, lastPlayed: null }]) } }));
    check("Xbox games in your library: Connected", (await unlocked(page)).includes("account_linked"), await unlocked(page));
    await page.context().close();

    console.log("5. Early Adopter's cutoff, Squad Up and Aura Legend");
    ({ page } = await open({ storage: { aura_stats: JSON.stringify({ totalLaunches: 0, gamesAdded: 0, totalPlaytimeHours: 0, favoritesCount: 0, streakDays: 0, gamesPlayedCount: 0, lastPlayedDate: null, playedGameIds: [], firstSeenAt: "2027-02-01" }) } }));
    check("first time in AURA after the cutoff: no Early Adopter", !(await unlocked(page)).includes("early_adopter"), await unlocked(page));
    await page.context().close();
    const allButLegend = ["first_launch", "five_games_added", "ten_games_added", "one_hour", "ten_hours", "fifty_hours", "first_favorite", "five_favorites", "three_day_streak", "seven_day_streak", "five_games_played", "ten_games_played", "first_screenshot", "first_clip", "ten_captures", "first_friend", "first_message", "account_linked"];
    const had = Object.fromEntries(allButLegend.map((id) => [id, 1000]));
    ({ page } = await open({ storage: { aura_achievements: JSON.stringify(had) } }));
    u = await unlocked(page);
    check("the last one earned (Early Adopter) unlocks Aura Legend in the same moment", u.includes("early_adopter") && u.includes("aura_legend"), u);
    check("Squad Up isn't needed for Aura Legend while calls are one-on-one, and stays locked", !u.includes("squad_up"), u);
    await page.locator('.gm-rail-item[title="Achievements"], .sb-item[title="Achievements"]').first().click({ timeout: 5000 });
    await page.waitForTimeout(600);
    const shown = await page.locator(".ach-progress").innerText();
    const body = await page.locator("body").innerText();
    check("the Achievements page counts all 21", /\/ 21 unlocked/.test(shown), shown);
    check("and lists the new ones with their names", ["Picture Perfect", "Clip It!", "Content Creator", "First Friend", "First Contact", "Connected", "Squad Up", "Early Adopter", "Aura Legend"].every((n) => body.includes(n)), body.slice(0, 400));
    await page.context().close();
  } finally {
    await browser.close();
    server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The new achievements check itself broke:", e); process.exit(2); });
