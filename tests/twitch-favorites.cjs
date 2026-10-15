// Twitch favorites: the star on every stream card, the Favorites row on Live Streams, the
// notice when a favorite goes live, and the ★ Favorites box on Home.
//
// Opens the built window (dist) in a real browser with a pretend desktop side and pretend
// streams, where the test decides who is live, and checks:
//   - names typed into the old "+ Streamers" box become favorites (bad names are dropped)
//   - Live Streams: Favorites on top, live ones first, offline ones greyed; not shown twice below
//   - the star adds and removes a favorite, from a stream, an offline favorite or a search
//   - going live: a notice inside AURA when it's in front, a Windows notification when it isn't;
//     no notice for someone just starred, none twice in a row, none when switched off
//   - clicking the Windows notification opens the stream
//   - favorites are saved to the account
//   - Home: add by name or link, remove, bad names explained
// Added by aura-twitch-favorites-setup.cjs.
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

  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    const thrown = [];
    page.on("pageerror", (e) => thrown.push(String(e.message || e).split("\n")[0]));
    await page.route((url) => !String(url).startsWith(base) && !String(url).startsWith("data:"), (route) => route.abort());
    await page.addInitScript(() => {
      try {
        localStorage.clear();
        localStorage.setItem("aura_profile", JSON.stringify({ username: "tester", avatar: "", userId: "user-1" }));
        localStorage.setItem("aura_twitch_logins", "Pokimane, bad name!, twitch.tv/xQc,");
      } catch {}
      window.__calls = [];
      window.__front = true; // is AURA the window in front?
      Document.prototype.hasFocus = function () { return window.__front; };
      const ok = (data) => Promise.resolve({ success: true, data });
      const account = {
        getSession: () => ok({ id: "user-1", email: "me@example.com" }),
        getMyProfile: () => ok({ username: "tester", avatar_url: null }),
        saveProfile: (name, picture) => ok({ username: name, avatar_url: picture || null }),
        getMyData: () => ok([]),
        getMySessionIds: () => ok([]),
        saveMyData: (rows) => { window.__saved = (window.__saved || []).concat([rows]); return ok(null); },
      };
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (name === "auraCloud" && account[key]) ? account[key](...args) : ok(null)) });
      window.auraCloud = fake("auraCloud");
      window.auraSocial = fake("auraSocial");
      const picture = (hue) => "data:image/svg+xml;base64," + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="440" height="248"><rect width="440" height="248" fill="hsl(${hue},60%,45%)"/></svg>`);
      const names = ["Shroud", "Pokimane", "TimTheTatman", "Myth", "Nickmercs", "Summit1g", "Lirik", "DrLupo"];
      // viewers: Shroud 8K, Pokimane 7K, ... others 1K
      const streamOf = (user, i) => ({ id: "s-" + user.toLowerCase(), user, userLogin: user.toLowerCase(), title: user + " is live", game: "Game " + (i + 1), viewers: 1000 * Math.max(1, 8 - i), thumbnail: picture(i * 40), url: "https://twitch.tv/" + user.toLowerCase(), startedAt: new Date(Date.now() - 95 * 60000).toISOString() });
      const games = names.map(streamOf);
      // Who is live, as the test says. Pokimane is; xQc and NinjaFan aren't yet.
      window.__live = new Set(["shroud", "pokimane", "timthetatman", "myth", "nickmercs", "summit1g", "lirik", "drlupo"]);
      window.__asked = [];
      const display = { xqc: "xQc", ninjafan: "NinjaFan" };
      const desktop = {
        fetchTwitchStreams: ({ gameNames = [], userLogins = [] } = {}) => {
          if (!gameNames.length && userLogins.length) {
            window.__asked.push(userLogins);
            return Promise.resolve({ success: true, streams: userLogins.filter((l) => window.__live.has(l)).map((l) => { const n = names.find((x) => x.toLowerCase() === l); return streamOf(display[l] || n || l, n ? names.indexOf(n) : 20); }) });
          }
          return Promise.resolve({ success: true, streams: games });
        },
        searchTwitch: () => Promise.resolve({
          success: true,
          channels: [
            { id: "c1", name: "Ninja", login: "ninja", title: "Ninja plays tonight", game: "Fortnite", thumbnail: picture(10), isLive: true },
            { id: "c2", name: "NinjaFan", login: "ninjafan", title: "", game: "Fortnite", thumbnail: "https://static-cdn.jtvnw.net/jtv_user_pictures/ninjafan-profile.png", isLive: false },
          ],
          games: [], gameStreams: [],
        }),
      };
      window.electronAPI = new Proxy({}, {
        get: (_t, key) => {
          if (key === "isElectron") return true;
          if (typeof key !== "string" || key === "then") return undefined;
          if (key === "onTwitchOpenStream") return (cb) => { window.__openStream = cb; return () => { window.__openStream = null; }; };
          if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};
          return (...args) => { window.__calls.push([key, args]); return desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }); };
        },
      });
    });
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(4500);
    const menu = async (name) => { await page.locator(`.gm-rail-item[title="${name}"], .sb-item[title="${name}"]`).first().click({ timeout: 5000 }); await page.waitForTimeout(600); };
    const called = (name) => page.evaluate((n) => window.__calls.filter(([k]) => k === n).map(([, a]) => a[0]), name);
    const favs = () => page.evaluate(() => { try { return (JSON.parse(localStorage.getItem("aura_settings") || "{}").twitchFavs || []).map((f) => f.login); } catch { return null; } });
    const away = async () => { await page.mouse.move(700, 8); await page.waitForTimeout(500); };
    const ROW = ".fav-row .twitch-card";
    const rowCards = () => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((c) => ({ name: c.querySelector(".twitch-rest").childNodes[0].textContent, off: c.classList.contains("off"), starred: !!c.querySelector(".twitch-fav.is-on"), text: c.innerText })), ROW);
    const wallNames = () => page.evaluate(() => { const walls = [...document.querySelectorAll(".twitch-wall")].filter((w) => !w.closest(".fav-row")); return walls.flatMap((w) => [...w.querySelectorAll(".twitch-card")].map((c) => c.querySelector(".twitch-rest").childNodes[0].textContent)); });
    const refresh = async () => { await page.locator("button.btn-p", { hasText: "↻" }).first().click({ timeout: 4000 }); await page.waitForTimeout(900); };
    const toasts = () => page.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.innerText));
    const notices = async () => (await called("twitchLiveNotice")).map((x) => x.login);
    const live = (login, on) => page.evaluate(([l, o]) => { if (o) window.__live.add(l); else window.__live.delete(l); }, [login, on]);

    console.log("1. Names typed into the old + Streamers box carry over");
    check("they became favorites, and the bad one was dropped", JSON.stringify(await favs()) === JSON.stringify(["pokimane", "xqc"]), await favs());

    console.log("2. Live Streams: the Favorites row");
    await menu("Live Streams");
    await page.locator(ROW).first().waitFor({ timeout: 8000 });
    await page.waitForTimeout(1500);
    let row = await rowCards();
    check("it's at the top of the page, with both favorites", row.length === 2, row);
    check("the live one comes first, and the offline one is greyed out and says Offline", row[0].name === "Pokimane" && !row[0].off && row[1].name === "xqc" && row[1].off && /Offline/.test(row[1].text), row);
    check("it says how many are live", /1 live now/.test(await page.locator(".fav-count").innerText()), await page.locator(".fav-count").innerText());
    check("both stars are filled in", row.every((c) => c.starred), row);
    await page.locator(ROW).first().hover();
    await page.waitForTimeout(700);
    check("a live favorite says how long it has been live", /Live 1h 35m/.test(await page.locator(ROW).first().locator(".twitch-info").innerText()), await page.locator(ROW).first().locator(".twitch-info").innerText());
    const tint = await page.evaluate(() => {
      const found = [];
      const hueOf = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (d < 40 || mx < 60) return null; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = Math.round(h * 60); return h < 0 ? h + 360 : h; };
      for (const el of document.querySelectorAll(".fav-row .twitch-fav, .fav-row .twitch-fav *")) {
        const cs = getComputedStyle(el);
        for (const prop of ["color", "backgroundColor", "borderTopColor", "fill", "stroke"]) {
          for (const m of String(cs[prop] || "").matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)) { const h = hueOf(+m[1], +m[2], +m[3]); if (h !== null) found.push(prop + " " + m[0]); }
        }
      }
      return found;
    });
    check("the stars are plain white, like the rest of the cards (no purple or gold)", tint.length === 0, tint);
    if (process.env.AURA_SHOT) await page.screenshot({ path: process.env.AURA_SHOT });
    await away();
    let wall = await wallNames();
    check("a favorite isn't shown a second time in the list below", wall.length === 7 && !wall.includes("Pokimane"), wall);

    console.log("3. The star");
    const star = page.locator(".twitch-wall .twitch-card", { hasText: "Shroud" }).last().locator(".twitch-fav");
    check("at rest a card shows no star until you point at it", Number(await star.evaluate((e) => getComputedStyle(e).opacity)) === 0);
    await page.locator(".twitch-wall .twitch-card", { hasText: "Shroud" }).last().hover();
    await page.waitForTimeout(400);
    check("pointing at a card shows its star", Number(await star.evaluate((e) => getComputedStyle(e).opacity)) === 1 && (await star.getAttribute("aria-pressed")) === "false");
    const opensBefore = (await called("streamOpen")).length;
    await star.click({ timeout: 4000 });
    await page.waitForTimeout(1800);
    row = await rowCards();
    check("clicking it adds that streamer to Favorites", JSON.stringify(await favs()) === JSON.stringify(["pokimane", "xqc", "shroud"]) && row.some((c) => c.name === "Shroud" && !c.off), { favs: await favs(), row });
    check("and doesn't start the stream", (await called("streamOpen")).length === opensBefore);
    check("they leave the list below", !(await wallNames()).includes("Shroud"), await wallNames());
    check("live ones are sorted by how many are watching", (await rowCards()).map((c) => c.name).join(",") === "Shroud,Pokimane,xqc", (await rowCards()).map((c) => c.name));
    await page.locator(ROW, { hasText: "Shroud" }).hover();
    await page.locator(ROW, { hasText: "Shroud" }).locator(".twitch-fav").click({ timeout: 4000 });
    await page.waitForTimeout(600);
    check("clicking a filled star removes them again", JSON.stringify(await favs()) === JSON.stringify(["pokimane", "xqc"]) && (await wallNames()).includes("Shroud"), await favs());
    const xqcStar = page.locator(ROW, { hasText: "xqc" }).locator(".twitch-fav");
    check("an offline favorite's star always shows, so it can be removed", Number(await xqcStar.evaluate((e) => getComputedStyle(e).opacity)) === 1);
    await xqcStar.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    check("and works from the keyboard", JSON.stringify(await favs()) === JSON.stringify(["pokimane"]), await favs());

    console.log("4. Starring from a search");
    const search = page.locator('input[placeholder^="Search streamers or games"]');
    await search.fill("ninja");
    await search.press("Enter");
    await page.waitForTimeout(900);
    check("the Favorites row steps aside while you look at search results", (await page.locator(".fav-row").count()) === 0);
    const fan = page.locator(".twitch-wall .twitch-card", { hasText: "NinjaFan" });
    await fan.hover();
    await fan.locator(".twitch-fav").click({ timeout: 4000 });
    await page.waitForTimeout(400);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("aura_settings")).twitchFavs);
    check("an offline channel can be starred, and keeps its picture and name", saved.some((f) => f.login === "ninjafan" && f.name === "NinjaFan" && /jtvnw\.net/.test(f.pic || "")), saved);
    await search.fill("");
    await refresh(); // back to the page
    await page.waitForTimeout(900);
    row = await rowCards();
    check("back on the page, they're in Favorites as Offline, with their picture", row.some((c) => c.name === "NinjaFan" && c.off) && (await page.locator(ROW, { hasText: "NinjaFan" }).locator("img.twitch-thumb").getAttribute("src")).includes("ninjafan-profile"), row);

    console.log("5. When a favorite goes live");
    await page.waitForTimeout(400);
    check("no notice for someone you just starred", (await toasts()).every((t) => !/NinjaFan/.test(t)) && (await notices()).length === 0, await toasts());
    await live("ninjafan", true);
    await refresh();
    let shown = await toasts();
    check("with AURA in front, a notice shows inside AURA", shown.some((t) => /NinjaFan is live on Twitch/.test(t)) && (await notices()).length === 0, { shown, notices: await notices() });
    row = await rowCards();
    check("and they move up to the live part of Favorites", row[0].name !== "NinjaFan" ? row.some((c) => c.name === "NinjaFan" && !c.off) : !row[0].off, row);
    await live("ninjafan", false);
    await refresh();
    await live("ninjafan", true);
    await page.waitForTimeout(3200); // let the first notice go
    await refresh();
    check("going off and on again soon after doesn't give a second notice", (await toasts()).every((t) => !/NinjaFan/.test(t)), await toasts());
    // Hidden by the clock
    await page.evaluate(() => { window.__front = false; });
    await live("pokimane", false);
    await refresh();
    await live("pokimane", true);
    await refresh();
    let n = await called("twitchLiveNotice");
    check("with AURA hidden, Windows shows the notice instead", n.length === 1 && n[0].login === "pokimane" && n[0].name === "Pokimane" && /Game/.test(n[0].game || ""), n);
    check("and AURA doesn't show its own as well", (await toasts()).every((t) => !/Pokimane/.test(t)), await toasts());
    // Switched off
    await page.locator(".fav-alerts input").uncheck();
    await page.waitForTimeout(300);
    check("the switch is remembered", (await page.evaluate(() => JSON.parse(localStorage.getItem("aura_settings")).twitchLiveAlerts)) === false);
    await live("ninjafan", false); await refresh();
    await live("ninjafan", true); await refresh();
    check("switched off, nobody gets announced", (await called("twitchLiveNotice")).length === 1 && (await toasts()).every((t) => !/NinjaFan/.test(t)));
    await page.locator(".fav-alerts input").check();
    await page.evaluate(() => { window.__front = true; });
    check("favorites are checked a few at a time", (await page.evaluate(() => window.__asked.every((a) => a.length <= 10))));

    console.log("6. Clicking the Windows notification");
    await menu("Home");
    const before = (await called("streamOpen")).length;
    await page.evaluate(() => window.__openStream && window.__openStream("pokimane"));
    await page.waitForTimeout(1600);
    const opened = (await called("streamOpen")).slice(before);
    check("opens Live Streams and plays that stream", opened.length === 1 && opened[0].channel === "pokimane" && (await page.getByText("Hide Chat").first().isVisible()), opened);
    await page.evaluate(() => window.__openStream && window.__openStream("../evil"));
    await page.waitForTimeout(500);
    check("and ignores anything that isn't a Twitch name", (await called("streamOpen")).length === before + 1);
    await page.getByText("✕ Close", { exact: true }).first().click({ timeout: 4000 });
    await page.waitForTimeout(400);

    console.log("7. Saved to the account");
    await page.waitForTimeout(2600);
    const rows = await page.evaluate(() => (window.__saved || []).flat().filter((r) => r.key === "settings").map((r) => r.value.twitchFavs));
    const last = rows[rows.length - 1] || [];
    check("the account gets the favorites list", last.map((f) => f.login).join(",") === "pokimane,ninjafan", rows);

    console.log("8. Home: ★ Favorites");
    await menu("Home");
    const shelfBtn = page.locator(".twitch-shelf button", { hasText: "Favorites" });
    check("the + Streamers button is now ★ Favorites", (await shelfBtn.count()) === 1);
    await shelfBtn.click();
    await page.waitForTimeout(300);
    const chips = () => page.locator(".fav-chip span").allInnerTexts();
    check("it lists your favorites, with names written the way Twitch shows them", JSON.stringify(await chips()) === JSON.stringify(["Pokimane", "NinjaFan"]), await chips());
    const box = page.locator('input[aria-label="Add a favorite streamer"]');
    await box.fill("https://www.twitch.tv/Lirik?x=1");
    await box.press("Enter");
    await page.waitForTimeout(400);
    check("a link or a name can be added", (await chips()).includes("lirik") && (await favs()).includes("lirik") && (await box.inputValue()) === "", await chips());
    await box.fill("bad-name!");
    await page.locator(".fav-edit .btn-p").click();
    await page.waitForTimeout(300);
    check("a name Twitch can't have is explained, and left in the box to fix", /letters, numbers and _/.test(await page.locator(".fav-edit-note").innerText()) && (await favs()).length === 3, await favs());
    await page.locator('.fav-chip button[aria-label="Remove lirik from favorites"]').click();
    await page.waitForTimeout(1600);
    check("× removes one", !(await favs()).includes("lirik") && !(await chips()).includes("lirik"), await favs());
    const shelfOrder = await page.evaluate(() => [...document.querySelectorAll(".twitch-shelf .twitch-card")].map((c) => c.querySelector(".twitch-rest").childNodes[0].textContent));
    check("live favorites come first in the Home row", shelfOrder[0] === "Pokimane", shelfOrder.slice(0, 3));

    console.log("9. All of it");
    check("nothing crashed along the way", (await page.locator(".aura-fallback").count()) === 0 && thrown.length === 0, thrown);
  } finally {
    await browser.close();
    server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The Twitch favorites check itself broke:", e); process.exit(2); });
