// Home: "Friends Playing Now". Opens the built window (dist) in a real browser with a pretend
// desktop side that has Steam friends playing games, one with a very long game name and one with
// no picture, and checks each card stays tidy: name and game on one line each, nothing spilling
// out of the card, the online dot on the picture, and where it's from spelled out.
// Added by aura-friends-playing-setup.cjs.
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
const PIC = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#4a7"/></svg>').toString("base64");
const LONG = "BOMBANANA: The Extremely Long Deluxe Edition With Every Expansion Pack";

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

  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const thrown = [];
  page.on("pageerror", (e) => thrown.push(String(e.message || e).split("\n")[0]));
  await page.route((url) => !String(url).startsWith(base) && !String(url).startsWith("data:"), (route) => route.abort());
  await page.addInitScript(({ PIC, LONG }) => {
    try {
      localStorage.clear();
      localStorage.setItem("aura_profile", JSON.stringify({ username: "tester", avatar: "", userId: "user-1" }));
      localStorage.setItem("aura_steam_id", "76561198000000000");
    } catch {}
    const ok = (data) => Promise.resolve({ success: true, data });
    const account = { getSession: () => ok({ id: "user-1", email: "me@example.com" }), getMyProfile: () => ok({ username: "tester", avatar_url: null }) };
    const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (name === "auraCloud" && account[key]) ? account[key](...args) : ok(null)) });
    window.auraCloud = fake("auraCloud");
    window.auraSocial = fake("auraSocial");
    const friends = [
      { id: "1", username: "the_mexican_bombanana_player", avatar: PIC, status: "online", activity: LONG },
      { id: "2", username: "nopic", avatar: "", status: "online", activity: "Apex Legends" },
      { id: "3", username: "offline_friend", avatar: PIC, status: "offline", activity: "Fortnite" },
    ];
    window.electronAPI = new Proxy({}, {
      get: (_t, key) => {
        if (key === "isElectron") return true;
        if (typeof key !== "string" || key === "then") return undefined;
        if (/^on[A-Z]/.test(key)) return () => () => {};
        if (/^remove/.test(key)) return () => {};
        if (key === "steamGetFriendsProfiles") return () => Promise.resolve({ success: true, friends });
        return () => Promise.resolve({ success: false });
      },
    });
  }, { PIC, LONG });

  try {
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(4500);
    const cards = await page.evaluate(() => [...document.querySelectorAll(".fa-card")].map((c) => {
      const box = c.getBoundingClientRect();
      const inside = [...c.querySelectorAll("*")].every((e) => { const r = e.getBoundingClientRect(); return r.width === 0 || (r.top >= box.top - 2 && r.bottom <= box.bottom + 2 && r.left >= box.left - 2 && r.right <= box.right + 2); });
      const line = (sel) => { const e = c.querySelector(sel); return e ? { text: e.textContent.trim(), oneLine: e.getBoundingClientRect().height < parseFloat(getComputedStyle(e).fontSize) * 1.9 } : null; };
      const pic = c.querySelector(".fa-av img"), ph = c.querySelector(".fa-ph"), dot = c.querySelector(".fa-dot"), av = c.querySelector(".fa-av");
      const seen = (e) => !!e && getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0;
      const d = dot?.getBoundingClientRect(), a = av?.getBoundingClientRect();
      return {
        height: Math.round(box.height), inside, tip: c.getAttribute("title"),
        name: line(".fa-name"), game: line(".fa-game"), left: [".fa-name", ".fa-game"].every((sel) => getComputedStyle(c.querySelector(sel)).textAlign !== "center"),
        picture: seen(pic) ? "picture" : seen(ph) ? "initial:" + ph.textContent.trim() : "none",
        round: pic && seen(pic) ? getComputedStyle(pic).borderRadius === "50%" : true,
        dotOnPicture: !!d && !!a && d.right <= a.right + 3 && d.bottom <= a.bottom + 3 && d.left > a.left + a.width / 2,
        all: c.innerText,
      };
    }));
    check("Home shows Friends Playing Now, with only the friends who are online and playing", cards.length === 2, cards.map((c) => c.name && c.name.text));
    const [long, nopic] = cards;
    check("the cards are all the same height", cards.every((c) => c.height === cards[0].height && c.height >= 56 && c.height <= 72), cards.map((c) => c.height));
    check("a long name stays on one line", !!long && long.name.oneLine, long && long.name);
    check("a very long game name stays on one line too", !!long && long.game.oneLine && /^Playing BOMBANANA/.test(long.game.text), long && long.game);
    check("nothing spills out of a card", cards.every((c) => c.inside));
    check("the full name and game show when you point at the card", !!long && long.tip === "the_mexican_bombanana_player is playing " + LONG + " (Steam)", long && long.tip);
    check("each card has a round picture with the online dot on it", !!long && long.picture === "picture" && long.round && cards.every((c) => c.dotOnPicture), cards.map((c) => [c.picture, c.dotOnPicture]));
    check("a friend with no picture gets their initial instead", !!nopic && nopic.picture === "initial:N", nopic && nopic.picture);
    check("no cryptic \"ST\" on the cards (pointing at one says it's from Steam)", cards.every((c) => !/\bST\b/.test(c.all)), cards.map((c) => c.all));
    check("names and games line up on the left, next to the picture", cards.every((c) => c.left));
    await page.locator(".fa-card").first().hover();
    check("nothing crashed", (await page.locator(".aura-fallback").count()) === 0 && thrown.length === 0, thrown);

    const source = fs.readFileSync(path.join(ROOT, "src", "App.jsx"), "utf8");
    check("the row refreshes every 2 minutes (not while AURA is hidden), and stops when Home closes", /const playingTimer = setInterval\((?:fetch|\(\) => \{ if \(!window\.__auraHidden\) fetch\(\); \}), 120000\);[\s\S]{0,120}return \(\) => clearInterval\(playingTimer\);/.test(source)); // (Updated by aura-release-fixes-setup.cjs)
  } finally {
    await browser.close();
    server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The Friends Playing Now check itself broke:", e); process.exit(2); });
