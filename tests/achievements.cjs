// Achievements count everything: games imported from Steam, Epic or Xbox, and games played from
// outside AURA. Part 1 checks the counting on its own; part 2 opens the built window (dist) in a
// real browser with a pretend desktop side, imports 10 Steam games, then plays over three days.
// Added by aura-achievements-fix-setup.cjs.
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
const DAY = 86400000;

(async () => {
  console.log("1. Counting");
  const src = fs.readFileSync(path.join(ROOT, "src", "achievements.js"), "utf8");
  const { achievementStats, longestStreak } = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
  const demo = [{ id: "1", exePath: "C:\\demo1.exe", favorite: true, title: "Demo" }, { id: "2", exePath: "C:\\demo2.exe", title: "Demo 2" }];
  const mine = Array.from({ length: 10 }, (_, i) => ({ id: "g" + i, exePath: "C:\\g" + i + ".exe", title: "Game " + i, favorite: i < 2 }));
  let s = achievementStats([...demo, ...mine], {}, [], demo);
  check("imported games count as added; demo games don't", s.gamesAdded === 10, s);
  check("favorites count only your own games", s.favoritesCount === 2, s);
  s = achievementStats(demo, {}, [], demo);
  check("a library of only demo games counts as nothing", s.gamesAdded === 0 && s.favoritesCount === 0 && s.totalLaunches === 0, s);
  s = achievementStats(mine, { gamesAdded: 14, totalLaunches: 3, totalPlaytimeHours: 5, streakDays: 4, gamesPlayedCount: 6 }, [], demo);
  check("never lower than what AURA already counted", s.gamesAdded === 14 && s.totalLaunches === 3 && s.totalPlaytimeHours === 5 && s.streakDays === 4 && s.gamesPlayedCount === 6, s);
  const noon = new Date(2026, 9, 10, 12).getTime();
  const sessions = [
    { title: "Game 1", start: noon, end: noon + 40 * 60000, durationMs: 40 * 60000 },
    { title: "Game 2", start: noon + DAY, end: noon + DAY + 30 * 60000, durationMs: 30 * 60000 },
    { title: "game 2", start: noon + 2 * DAY, end: noon + 2 * DAY + 60000, durationMs: 60000 },
  ];
  s = achievementStats(mine, {}, sessions, demo);
  check("games played from outside AURA count: a launch, playtime, different games", s.totalLaunches === 1 && Math.abs(s.totalPlaytimeHours - 71 / 60) < 1e-9 && s.gamesPlayedCount === 2, s);
  check("days in a row come from when you played", s.streakDays === 3, s);
  check("a gap breaks the run", longestStreak([noon, noon + DAY, noon + 3 * DAY, noon + 4 * DAY, noon + 5 * DAY]) === 3);
  check("several plays on one day are one day", longestStreak([noon, noon + 3600000, noon + 7200000]) === 1);
  const dst = [new Date(2026, 2, 7, 23).getTime(), new Date(2026, 2, 8, 23).getTime(), new Date(2026, 2, 9, 1).getTime()];
  check("the clocks changing doesn't break a run", longestStreak(dst) === 3);
  check("broken data is ignored", achievementStats(null, null, [null, { end: "x" }], null).gamesAdded === 0);

  console.log("2. In the window");
  if (!fs.existsSync(path.join(DIST, "index.html"))) { check("the window has been built (dist/index.html)", false, "Run  npm run build  first."); return done(1); }
  let chromium;
  try { ({ chromium } = require("playwright")); } catch { note("the test browser isn't installed here"); return done(failed ? 1 : process.env.CI ? 1 : 3); }
  let browser = null;
  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: "msedge" }, { channel: "chrome" }]) {
    try { browser = await chromium.launch(options); break; } catch {}
  }
  if (!browser) { note("no browser to test with. Run  npx playwright install chromium  once to add one."); return done(failed ? 1 : process.env.CI ? 1 : 3); }
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
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    const thrown = [];
    page.on("pageerror", (e) => thrown.push(String(e.message || e).split("\n")[0]));
    await page.route((url) => !String(url).startsWith(base) && !String(url).startsWith("data:"), (route) => route.abort());
    await page.addInitScript(() => {
      try {
        if (!sessionStorage.getItem("started")) {
          sessionStorage.setItem("started", "1");
          localStorage.clear();
          localStorage.setItem("aura_profile", JSON.stringify({ username: "tester", avatar: "", userId: "user-1" }));
        }
      } catch {}
      const ok = (data) => Promise.resolve({ success: true, data });
      const account = { getSession: () => ok({ id: "user-1", email: "me@example.com" }), getMyProfile: () => ok({ username: "tester", avatar_url: null }) };
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (name === "auraCloud" && account[key]) ? account[key](...args) : ok(null)) });
      window.auraCloud = fake("auraCloud");
      window.auraSocial = fake("auraSocial");
      const steam = Array.from({ length: 10 }, (_, i) => ({ title: "Steam Game " + (i + 1), exePath: "C:\\Steam\\game" + (i + 1) + ".exe" }));
      const desktop = { importSteam: () => Promise.resolve({ success: true, games: steam }), fetchTwitchStreams: () => Promise.resolve({ success: true, streams: [] }) };
      window.electronAPI = new Proxy({}, {
        get: (_t, key) => {
          if (key === "isElectron") return true;
          if (typeof key !== "string" || key === "then") return undefined;
          if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};
          return (...args) => (desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }));
        },
      });
    });
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(5500);
    // (Early Adopter unlocks for anyone new before 2027, so it isn't counted here; Added by aura-new-achievements-setup.cjs)
    const unlocked = () => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("aura_achievements") || "{}")).filter((k) => k !== "early_adopter").sort());
    const toastText = () => page.evaluate(() => [...document.querySelectorAll(".ach-toast")].map((t) => t.innerText.replace(/\s+/g, " ")));
    check("a fresh AURA with only the demo games unlocks nothing", (await unlocked()).length === 0, await unlocked());
    await page.locator('.gm-rail-item[title="Settings"], .sb-item[title="Settings"]').first().click({ timeout: 5000 });
    await page.waitForTimeout(500);
    await page.locator(".sr", { hasText: "Import Steam Games" }).locator("button").click({ timeout: 5000 });
    await page.waitForTimeout(3200);
    const shown = await toastText();
    check("importing 10 Steam games unlocks Collector I and Collector II", JSON.stringify(await unlocked()) === JSON.stringify(["five_games_added", "ten_games_added"]), await unlocked());
    check("and says so", shown.some((t) => /Collector I\b/.test(t)) && shown.some((t) => /Collector II/.test(t)), shown);

    // Games played from outside AURA over three days, then AURA opened again
    await page.evaluate((DAY) => {
      const end = Date.now() - 60000;
      const s = [0, 1, 2].map((d) => ({ id: "x" + d, exePath: "C:\\Steam\\game" + (d + 1) + ".exe", title: "Steam Game " + (d + 1), category: "Other", start: end - d * DAY - 25 * 60000, end: end - d * DAY, durationMs: 25 * 60000, perf: null, outside: true }));
      localStorage.setItem("aura_sessions", JSON.stringify(s));
    }, DAY);
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(5500);
    const after = await unlocked();
    check("games played from outside AURA unlock First Launch, Getting Started and On a Roll", ["first_launch", "one_hour", "three_day_streak"].every((id) => after.includes(id)), after);
    check("what was unlocked before is kept", after.includes("ten_games_added") && after.includes("five_games_added"), after);
    check("catching up on several at once gives one notice, not a pile", (await toastText()).length === 1 && /3 achievements/.test((await toastText())[0] || ""), await toastText());
    await page.locator('.gm-rail-item[title="Achievements"], .sb-item[title="Achievements"]').first().click({ timeout: 5000 });
    await page.waitForTimeout(600);
    check("the Achievements page shows 5 unlocked", /[56] \/ \d+ unlocked/.test(await page.locator(".ach-progress").innerText()), await page.locator(".ach-progress").innerText());
    check("nothing crashed along the way", (await page.locator(".aura-fallback").count()) === 0 && thrown.filter((m) => !/reading 'live'/.test(m)).length === 0, thrown);
  } finally {
    await browser.close();
    server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The achievements check itself broke:", e); process.exit(2); });
