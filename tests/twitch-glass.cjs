// Twitch streams as glass cards: the "Live on Twitch" row on Home, and the Live Streams page.
//
// Each stream rests as a pane of glass. The one you point at opens out to the full picture, with
// a LIVE tag and a play button. This opens the built window (dist) in a real browser with a
// pretend desktop side and some pretend streams, and checks:
//   - at rest: see-through, picture dimmed, no LIVE tag
//   - pointed at: wide, picture clear, LIVE tag and the play button showing; one card at a time
//   - Home: a row you scroll.  Live Streams: rows that fill the page, where the open card takes
//     room from its neighbours and nothing jumps to another row
//   - a search's channels and streams are the same cards; offline channels don't open
//   - one button only (play), and no purple or gold anywhere
// Added by aura-twitch-glass-setup.cjs.
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
      try { localStorage.clear(); localStorage.setItem("aura_profile", JSON.stringify({ username: "tester", avatar: "", userId: "user-1" })); } catch {}
      window.__calls = [];
      const ok = (data) => Promise.resolve({ success: true, data });
      const account = { getSession: () => ok({ id: "user-1", email: "me@example.com" }), getMyProfile: () => ok({ username: "tester", avatar_url: null }), saveProfile: (name, picture) => ok({ username: name, avatar_url: picture || null }) };
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (name === "auraCloud" && account[key]) ? account[key](...args) : ok(null)) });
      window.auraCloud = fake("auraCloud");
      window.auraSocial = fake("auraSocial");
      const picture = (hue) => "data:image/svg+xml;base64," + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="440" height="248"><rect width="440" height="248" fill="hsl(${hue},60%,45%)"/><circle cx="220" cy="124" r="70" fill="hsl(${hue + 40},70%,65%)"/></svg>`);
      const names = ["Shroud", "Pokimane", "TimTheTatman", "Myth", "Nickmercs", "Summit1g", "Lirik", "DrLupo", "Sykkuno", "Valkyrae", "Ludwig", "Tarik", "Kyedae", "Aceu"];
      const streams = names.map((user, i) => ({ id: "s" + (i + 1), user, userLogin: user.toLowerCase(), title: user + " is live", game: "Game " + (i + 1), viewers: 1200 * (i + 1), thumbnail: picture(i * 55), url: "https://twitch.tv/" + user.toLowerCase() }));
      const found = {
        success: true,
        channels: [
          { id: "c1", name: "Ninja", login: "ninja", title: "Ninja plays tonight", game: "Fortnite", thumbnail: picture(10), isLive: true },
          { id: "c2", name: "NinjaFan", login: "ninjafan", title: "", game: "Fortnite", thumbnail: picture(120), isLive: false },
          { id: "c3", name: "NinjaKiwi", login: "ninjakiwi", title: "Dev stream", game: "Bloons", thumbnail: picture(200), isLive: true },
        ],
        games: [{ id: "g1", name: "Ninja Gaiden", thumbnail: picture(300) }],
        gameStreams: [],
      };
      const desktop = { fetchTwitchStreams: () => Promise.resolve({ success: true, streams }), searchTwitch: () => Promise.resolve(found) };
      window.electronAPI = new Proxy({}, {
        get: (_t, key) => {
          if (key === "isElectron") return true;
          if (typeof key !== "string" || key === "then") return undefined;
          if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};
          return (...args) => { window.__calls.push([key, args]); return desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }); };
        },
      });
    });
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(4500);
    const menu = async (name) => { await page.locator(`.gm-rail-item[title="${name}"], .sb-item[title="${name}"]`).first().click({ timeout: 5000 }); await page.waitForTimeout(500); };
    const called = (name) => page.evaluate((n) => window.__calls.filter(([k]) => k === n).map(([, a]) => a[0]), name);
    const away = async () => { await page.mouse.move(700, 8); await page.waitForTimeout(650); };
    // How every card inside `scope` looks right now
    const look = (scope) => page.evaluate((scope) => [...document.querySelectorAll(scope + " .twitch-card")].map((card) => {
      const cs = getComputedStyle(card), r = card.getBoundingClientRect();
      const show = (sel) => { const e = card.querySelector(sel); return e ? Number(getComputedStyle(e).opacity) : 0; };
      return { name: card.querySelector(".twitch-rest").childNodes[0].textContent, width: Math.round(r.width), height: Math.round(r.height), top: Math.round(r.top),
        background: cs.backgroundColor, blur: cs.backdropFilter, picture: show(".twitch-thumb"), live: show(".twitch-badge"), tools: show(".twitch-ov"), buttons: card.querySelectorAll(".twitch-tool").length, off: card.classList.contains("off") };
    }), scope);
    const alpha = (color) => { const m = /rgba?\(([^)]+)\)/.exec(color || ""); if (!m) return 1; const p = m[1].split(/[,/ ]+/).filter(Boolean); return p.length > 3 ? Number(p[3]) : 1; };
    const glass = (c) => alpha(c.background) > 0 && alpha(c.background) <= 0.2 && /blur\(/.test(c.blur) && c.picture > 0.1 && c.picture < 0.6 && c.live === 0 && c.tools === 0;
    const colours = (scope) => page.evaluate((scope) => {
      const found = [];
      const hueOf = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (d < 40 || mx < 60) return null; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = Math.round(h * 60); return h < 0 ? h + 360 : h; };
      for (const el of document.querySelectorAll(scope + ", " + scope + " *")) {
        if (el.tagName === "IMG") continue; // a stream's own picture can be any colour
        const cs = getComputedStyle(el);
        for (const prop of ["color", "backgroundColor", "borderTopColor", "outlineColor", "backgroundImage", "boxShadow", "fill", "stroke"]) {
          for (const m of String(cs[prop] || "").matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/g)) {
            if (m[4] !== undefined && Number(m[4]) === 0) continue;
            const hue = hueOf(+m[1], +m[2], +m[3]);
            if (hue === null) continue;
            if (hue >= 240 && hue <= 320) found.push("purple " + m[0] + " on ." + el.className + " (" + prop + ")");
            if (hue >= 35 && hue <= 65) found.push("gold " + m[0] + " on ." + el.className + " (" + prop + ")");
          }
        }
      }
      return [...new Set(found)];
    }, scope);
    const HOME = ".twitch-shelf", WALL = ".twitch-wall";
    const homeCard = (n) => page.locator(HOME + " .twitch-card").nth(n);
    const wallCard = (n) => page.locator(WALL + " .twitch-card").nth(n);
    const closeStream = async () => { await page.getByText("✕ Close", { exact: true }).first().click({ timeout: 4000 }); await page.waitForTimeout(450); };

    console.log("1. Home: the Live on Twitch row");
    await menu("Home");
    await homeCard(0).waitFor({ timeout: 8000 });
    await away();
    let cards = await look(HOME);
    check("at rest every stream is a narrow pane of glass, with no LIVE tag or button showing", cards.length === 14 && cards.every((c) => c.width >= 120 && c.width <= 160 && glass(c)), cards.slice(0, 2));
    await homeCard(1).hover();
    await page.waitForTimeout(700);
    cards = await look(HOME);
    check("the one you point at opens out wide, with a clear picture", cards[1].width >= 380 && cards[1].picture === 1 && cards[1].height === cards[0].height, cards.slice(0, 3).map((c) => c.width));
    check("LIVE shows on it, with the streamer, the game and how many are watching", cards[1].live === 1 && /Pokimane[\s\S]*Game 2[\s\S]*2\.4K watching/.test(await homeCard(1).locator(".twitch-info").innerText()), await homeCard(1).locator(".twitch-info").innerText());
    check("it has one button, the play button", cards[1].buttons === 1 && (await homeCard(1).locator('.twitch-tool.main[title="Watch"]').isVisible()));
    await homeCard(2).hover();
    await page.waitForTimeout(700);
    cards = await look(HOME);
    check("only one is open at a time", cards[2].width >= 380 && cards.filter((c) => c.width > 200).length === 1 && cards[1].live === 0, cards.slice(0, 4).map((c) => c.width));
    check("nothing in the row is purple or gold", (await colours(HOME + " .twitch-row")).length === 0, (await colours(HOME + " .twitch-row")).join("\n"));
    await away();
    check("moving away closes it", (await look(HOME)).every((c) => c.width <= 160 && c.live === 0));
    await homeCard(1).hover();
    await page.waitForTimeout(500);
    await homeCard(1).locator(".twitch-tool.main").click({ timeout: 4000 });
    await page.waitForTimeout(1600);
    let opened = await called("streamOpen");
    check("the play button opens that stream on Live Streams", opened.length === 1 && opened[0].channel === "pokimane" && (await page.getByText("Hide Chat").first().isVisible()), opened);
    await closeStream();
    await menu("Home");
    await away();
    await homeCard(4).focus();
    await page.waitForTimeout(700);
    cards = await look(HOME);
    check("from the keyboard: a card you tab to opens the same way", cards[4].width >= 380 && cards[4].live === 1 && cards.filter((c) => c.width > 200).length === 1, cards.slice(3, 6).map((c) => c.width));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    opened = await called("streamOpen");
    check("and Enter watches it", opened.length === 2 && opened[1].channel === "nickmercs", opened);
    await closeStream();

    console.log("2. Live Streams: rows of glass that fill the page");
    await away();
    await wallCard(0).waitFor({ timeout: 8000 });
    await page.waitForTimeout(400);
    // Rows as they are laid out: cards grouped by how far down the page they sit
    const rowsOf = (list) => { const by = new Map(); for (const c of list) { if (!by.has(c.top)) by.set(c.top, []); by.get(c.top).push(c); } return [...by.values()]; };
    const wallBox = () => page.evaluate((sel) => { const e = document.querySelector(sel); const r = e.getBoundingClientRect(); return { width: Math.round(r.width), height: Math.round(r.height), scroll: e.scrollWidth, rows: [...e.querySelectorAll(".twitch-wall-row")].map((row) => ({ cards: row.querySelectorAll(".twitch-card").length, slots: row.children.length, used: Math.round([...row.children].reduce((n, k) => n + k.getBoundingClientRect().width, 0) + 12 * (row.children.length - 1)) })) }; }, WALL);
    cards = await look(WALL);
    let box = await wallBox();
    const rest = rowsOf(cards);
    const perRow = box.rows[0].slots;
    check("every stream is on the page, with its name and what it's called", cards.length === 14 && /Shroud\s*Shroud is live/.test(await wallCard(0).locator(".twitch-rest").innerText()), await wallCard(0).locator(".twitch-rest").innerText());
    check("at rest they are panes of glass, with no LIVE tag or button showing", cards.every(glass), cards.slice(0, 1));
    check("they sit in rows that fill the page from edge to edge", box.rows.length >= 2 && box.rows.every((r) => Math.abs(r.used - box.width) <= 2 && r.slots === perRow) && box.scroll <= box.width + 1, box);
    check("cards in a row are all the same width", rest.every((row) => Math.max(...row.map((c) => c.width)) - Math.min(...row.map((c) => c.width)) <= 2), rest.map((row) => row.map((c) => c.width)));
    const restWidth = cards[0].width;

    await wallCard(1).hover();
    await page.waitForTimeout(750);
    cards = await look(WALL);
    const after = await wallBox();
    const firstRow = rowsOf(cards)[0];
    check("the one you point at opens out, close to the picture's own shape", cards[1].width >= 330 && cards[1].width <= 460 && cards[1].picture === 1 && cards[1].live === 1, firstRow.map((c) => c.width));
    check("its neighbours make room without disappearing", firstRow.filter((_c, i) => i !== 1).every((c) => c.width < restWidth && c.width >= 80), firstRow.map((c) => c.width));
    check("the row still fills the page exactly, and nothing jumps to another row", Math.abs(after.rows[0].used - after.width) <= 2 && after.height === box.height && JSON.stringify(after.rows.map((r) => r.cards)) === JSON.stringify(box.rows.map((r) => r.cards)) && rowsOf(cards).length === rest.length, { before: box, after });
    check("the other rows don't move", rowsOf(cards).slice(1).every((row) => row.every((c) => Math.abs(c.width - restWidth) <= 2 && c.live === 0)), rowsOf(cards).slice(1).map((row) => row.map((c) => c.width)));
    check("it has one button, the play button", cards[1].buttons === 1 && (await wallCard(1).locator('.twitch-tool.main[title="Watch"]').isVisible()));
    check("and says what the stream is called, the game, and how many are watching", /Pokimane[\s\S]*Pokimane is live[\s\S]*Game 2[\s\S]*2\.4K watching/.test(await wallCard(1).locator(".twitch-info").innerText()), await wallCard(1).locator(".twitch-info").innerText());
    await wallCard(perRow + 1).hover();
    await page.waitForTimeout(750);
    cards = await look(WALL);
    check("pointing at one in the next row opens that one and closes the first", cards[perRow + 1].width >= 330 && cards[perRow + 1].live === 1 && cards.filter((c) => c.live === 1).length === 1 && Math.abs(cards[1].width - restWidth) <= 2, cards.map((c) => c.width));
    check("nothing on the list is purple or gold", (await colours(WALL)).length === 0, (await colours(WALL)).join("\n"));
    const lastRow = after.rows[after.rows.length - 1];
    check("a last row with fewer streams keeps its cards the same size as the rest", lastRow.cards === 14 - perRow * (after.rows.length - 1) && lastRow.slots === perRow, lastRow);
    await wallCard(perRow + 1).locator(".twitch-tool.main").click({ timeout: 4000 });
    await page.waitForTimeout(1600);
    opened = await called("streamOpen");
    check("the play button opens that stream", opened.length === 3 && opened[2].channel === cards[perRow + 1].name.toLowerCase() && (await page.getByText("Hide Chat").first().isVisible()), opened);
    const gameColour = await page.evaluate(() => { const hit = [...document.querySelectorAll("div")].find((d) => d.children.length === 0 && /^Game \d+$/.test(d.textContent.trim()) && d.offsetParent !== null); return hit ? getComputedStyle(hit).color : ""; });
    const rgb = (gameColour.match(/\d+/g) || []).map(Number);
    check("the game's name under the player is no longer purple", rgb.length >= 3 && !(rgb[2] > rgb[1] + 60 && rgb[0] > rgb[1] + 30), gameColour);
    await closeStream();
    await away();
    await wallCard(3).click({ timeout: 4000 });
    await page.waitForTimeout(1500);
    opened = await called("streamOpen");
    check("clicking anywhere on a card watches it too", opened.length === 4 && opened[3].channel === "myth", opened);
    await closeStream();

    console.log("3. Live Streams: a narrower window");
    await page.setViewportSize({ width: 1040, height: 800 });
    await page.waitForTimeout(700);
    await away();
    const narrow = await wallBox();
    check("the rows are cut again to fit, still edge to edge", narrow.rows[0].slots < perRow && narrow.rows[0].slots >= 3 && narrow.rows.every((r) => Math.abs(r.used - narrow.width) <= 2) && narrow.scroll <= narrow.width + 1, narrow);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(700);

    console.log("4. Live Streams: what a search finds");
    const search = page.locator('input[placeholder^="Search streamers or games"]');
    await search.fill("ninja");
    await search.press("Enter");
    await page.waitForTimeout(900);
    await away();
    cards = await look(WALL);
    check("channels are the same glass cards", cards.length === 3 && cards.filter((c) => !c.off).every(glass), cards);
    check("an offline channel is marked Offline", cards[1].off && /Offline/.test(await wallCard(1).innerText()), await wallCard(1).innerText());
    await wallCard(1).hover();
    await page.waitForTimeout(700);
    cards = await look(WALL);
    const before = (await called("streamOpen")).length;
    await wallCard(1).click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(600);
    check("and doesn't open or play", cards[1].live === 0 && Math.abs(cards[1].width - cards[0].width) <= 2 && (await called("streamOpen")).length === before, cards.map((c) => c.width));
    await wallCard(0).hover();
    await page.waitForTimeout(700);
    cards = await look(WALL);
    check("a live channel opens, and says what it's streaming", cards[0].width > cards[1].width + 100 && cards[0].live === 1 && /Ninja[\s\S]*Ninja plays tonight[\s\S]*Fortnite/.test(await wallCard(0).locator(".twitch-info").innerText()), await wallCard(0).locator(".twitch-info").innerText());
    check("nothing in the search results is purple or gold", (await colours(WALL)).length === 0, (await colours(WALL)).join("\n"));
    await away();
    await page.getByText("Ninja Gaiden", { exact: true }).click({ timeout: 4000 }); // a game: shows its streams
    await page.waitForTimeout(900);
    await away();
    cards = await look(WALL);
    check("picking a game shows its streams as the same cards", cards.length === 14 && cards.every(glass), cards.length);
    await wallCard(0).hover();
    await page.waitForTimeout(500);
    await wallCard(0).locator(".twitch-tool.main").click({ timeout: 4000 });
    await page.waitForTimeout(1500);
    opened = await called("streamOpen");
    check("and they play", opened[opened.length - 1].channel === "shroud" && (await page.getByText("Hide Chat").first().isVisible()), opened.slice(-1));

    console.log("5. All of it");
    const source = (() => { try { return fs.readFileSync(path.join(ROOT, "src", "App.jsx"), "utf8"); } catch { return ""; } })();
    const old = ["#9147ff", "145,71,255", "#2d1b69"].filter((c) => source.toLowerCase().includes(c));
    check("the old Twitch purple is gone from the code", source.length > 1000 && old.length === 0, old);
    check("there is no \"open in full view\" button on the cards", !/Open in full view/.test(source) && (await page.locator('.twitch-tool[title="Open in full view"]').count()) === 0);
    check("nothing crashed along the way", (await page.locator(".aura-fallback").count()) === 0, thrown);
  } finally {
    await browser.close();
    server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The glass cards check itself broke:", e); process.exit(2); });
