// The camera: the floating preview, Settings > Camera, and the camera in recordings.
//
// Opens the built window (dist) in a real browser with two pretend cameras and a pretend desktop
// side, and checks:
//   - the camera stays off until you press Camera, and every way of stopping it lets go of it
//   - the preview shows the camera, mirrors (or not), switches cameras, moves, resizes and
//     stays on screen, minimizes, and opens again without restarting AURA
//   - blocked, busy, missing and unplugged cameras are explained, and nothing crashes
//   - Settings > Camera: which camera, mirror, size
//   - recordings: with "Camera in Recordings" on and the camera on, the clip's picture has the
//     camera in the chosen corner; with either off, the clip is only the screen
// Added by aura-camera-setup.cjs.
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
  // Pretend cameras (two of them) and no permission prompts
  const args = ["--use-fake-device-for-media-stream=device-count=2", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"];
  for (const options of [process.env.AURA_TEST_BROWSER ? { executablePath: process.env.AURA_TEST_BROWSER } : {}, { channel: "msedge" }, { channel: "chrome" }]) {
    try { browser = await chromium.launch({ ...options, args }); break; } catch {}
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
        localStorage.setItem("aura_settings", JSON.stringify({ recordSourceId: "screen:1", recordSourceName: "Screen 1", micVolume: 0 }));
      } catch {}
      window.__calls = [];
      // Every camera AURA opens, and a way to make the next one fail
      window.__cams = [];
      window.__fail = null;
      const md = navigator.mediaDevices;
      const real = md.getUserMedia.bind(md);
      md.getUserMedia = async (c = {}) => {
        if (c.video && window.__fail) { const e = new Error("pretend"); e.name = window.__fail; throw e; }
        const s = await real(c);
        if (c.video) window.__cams.push(s);
        return s;
      };
      // The "screen" being recorded: plain blue
      md.getDisplayMedia = async () => {
        const cv = document.createElement("canvas"); cv.width = 1280; cv.height = 720;
        const x = cv.getContext("2d");
        const paint = () => { x.fillStyle = "#0000ff"; x.fillRect(0, 0, 1280, 720); };
        paint(); window.__paint = setInterval(paint, 30);
        const s = cv.captureStream(30);
        window.__screens = (window.__screens || []).concat([s]);
        return s;
      };
      // What each recording records
      const RealRec = window.MediaRecorder;
      window.__recs = [];
      window.MediaRecorder = class extends RealRec { constructor(stream, o) { super(stream, o); window.__recs.push({ stream, rec: this }); } };
      window.MediaRecorder.isTypeSupported = (t) => RealRec.isTypeSupported(t);
      const ok = (data) => Promise.resolve({ success: true, data });
      const account = {
        getSession: () => ok({ id: "user-1", email: "me@example.com" }),
        getMyProfile: () => ok({ username: "tester", avatar_url: null }),
        getMyData: () => ok([]),
        getMySessionIds: () => ok([]),
      };
      const fake = (name) => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : (...args) => (name === "auraCloud" && account[key]) ? account[key](...args) : ok(null)) });
      window.auraCloud = fake("auraCloud");
      window.auraSocial = fake("auraSocial");
      const desktop = {
        getCaptureSources: () => Promise.resolve({ success: true, sources: [{ id: "screen:1", name: "Screen 1", isScreen: true }] }),
        setCaptureSource: () => Promise.resolve({ success: true }),
        startFfmpegPipe: () => Promise.resolve({ success: true }),
        pipeToFfmpeg: () => Promise.resolve({ success: true }),
        stopFfmpegPipe: () => Promise.resolve({ success: true }),
        getAudioDevices: () => Promise.resolve({ success: true, devices: [] }),
      };
      window.electronAPI = new Proxy({}, {
        get: (_t, key) => {
          if (key === "isElectron") return true;
          if (typeof key !== "string" || key === "then") return undefined;
          if (key === "onQuickRecordToggle") return (cb) => { window.__f9 = cb; return () => {}; };
          if (/^(on[A-Z]|remove)/.test(key)) return () => () => {};
          return (...args) => { window.__calls.push([key, args]); return desktop[key] ? desktop[key](...args) : Promise.resolve({ success: false }); };
        },
      });
    });
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForTimeout(4500);
    const menu = async (name) => { await page.locator(`.gm-rail-item[title="${name}"], .sb-item[title="${name}"]`).first().click({ timeout: 5000 }); await page.waitForTimeout(600); };
    const camItem = page.locator(".aura-cam").first();
    const PANEL = ".cam-pan";
    const btn = (label) => page.locator(`${PANEL} button[aria-label="${label}"], .cam-pill button[aria-label="${label}"]`).first();
    const cams = () => page.evaluate(() => window.__cams.map((s) => s.getVideoTracks().map((t) => ({ state: t.readyState, id: t.getSettings().deviceId }))[0]));
    const liveCams = async () => (await cams()).filter((c) => c && c.state === "live");
    const shown = () => page.evaluate(() => { const v = document.querySelector(".cam-pan video"); return v ? { w: v.videoWidth, playing: !v.paused, mirror: getComputedStyle(v).transform, src: !!v.srcObject } : null; });
    const box = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }, sel);
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("aura_settings") || "{}"));
    const offText = () => page.locator(".cam-off").innerText().catch(() => "");

    console.log("1. Off until you ask");
    check("AURA starts with the camera off and no preview", (await cams()).length === 0 && (await page.locator(PANEL).count()) === 0);
    check("the side menu has a Camera item", (await camItem.count()) === 1 && /Camera/.test(await camItem.innerText()));

    console.log("2. The preview");
    await camItem.click();
    await page.waitForTimeout(1500);
    let v = await shown();
    check("pressing Camera opens the preview with the camera on", (await liveCams()).length === 1 && v && v.w > 0 && v.playing, { v, cams: await cams() });
    check("it says the camera is on, and the menu item shows a red dot", /on/.test(await page.locator(".cam-state").innerText()) && (await page.locator(".aura-cam .cam-menu-dot").count()) === 1);
    check("it's mirrored at first", /matrix\(-1/.test(v.mirror), v.mirror);
    let b = await box(PANEL);
    check("it starts in the bottom right, inside the window, clear of the Now Playing bar", b && b.x + b.w <= 1440 && b.y + b.h <= 900 - 72 && b.x > 700, b);
    await btn("Mirror the preview").click();
    await page.waitForTimeout(300);
    check("the mirror button turns mirroring off, and AURA remembers", (await shown()).mirror === "none" && (await saved()).camMirror === false, (await shown()).mirror);
    await btn("Mirror the preview").click();

    console.log("3. Switching cameras");
    const firstId = (await liveCams())[0].id;
    await btn("Switch camera").click();
    await page.waitForTimeout(1500);
    const after = await cams();
    check("switch moves to the other camera", (await liveCams()).length === 1 && (await liveCams())[0].id !== firstId, after);
    check("and lets go of the first one", after.filter((c) => c.state === "live").length === 1 && after[0].state === "ended", after);
    check("the preview shows the new camera", (await shown()).w > 0);

    console.log("4. Off and on");
    await btn("Turn the camera off").click();
    await page.waitForTimeout(500);
    check("the power button turns the camera off (it's let go)", (await liveCams()).length === 0 && /camera is off/i.test(await offText()), await cams());
    check("the preview says it's off", /off/.test(await page.locator(".cam-state").innerText()));
    await page.locator(".cam-off .cam-go").click();
    await page.waitForTimeout(1500);
    check("Turn on brings it back", (await liveCams()).length === 1 && (await shown()).w > 0);

    console.log("5. Moving and resizing");
    b = await box(PANEL);
    await page.mouse.move(b.x + 40, b.y + 15); await page.mouse.down(); await page.mouse.move(b.x - 300, b.y - 200, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(300);
    let nb = await box(PANEL);
    check("dragging its top bar moves it", Math.abs(nb.x - (b.x - 340)) <= 3 && Math.abs(nb.y - (b.y - 215)) <= 3, { b, nb });
    const s1 = await saved();
    check("and AURA remembers where", s1.camX === nb.x && s1.camY === nb.y, s1);
    await page.mouse.move(nb.x + 40, nb.y + 15); await page.mouse.down(); await page.mouse.move(-500, -500, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(300);
    nb = await box(PANEL);
    check("it can't be dragged off the window", nb.x === 0 && nb.y === 0, nb);
    await page.mouse.move(nb.x + nb.w - 5, nb.y + nb.h - 5); await page.mouse.down(); await page.mouse.move(nb.x + nb.w + 155, nb.y + nb.h + 90, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(300);
    const rb = await box(PANEL);
    check("dragging the corner makes it bigger (keeping its shape)", rb.w === nb.w + 160 && Math.abs((rb.h - 34) / rb.w - 9 / 16) < 0.02 && (await saved()).camWidth === rb.w, { nb, rb });
    await page.locator(".cam-top").focus();
    await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(200);
    const kb = await box(PANEL);
    check("the arrow keys move it too", kb.x === 10 && kb.y === 10, kb);
    await page.setViewportSize({ width: 900, height: 600 });
    await page.waitForTimeout(400);
    await page.locator(".cam-top").focus(); await page.keyboard.press("Shift+ArrowRight"); for (let i = 0; i < 20; i++) await page.keyboard.press("Shift+ArrowRight");
    await page.waitForTimeout(200);
    const sm = await box(PANEL);
    check("in a smaller window it still stays fully on screen", sm.x + sm.w <= 900 && sm.y + sm.h <= 600 && sm.x >= 0, sm);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(400);

    console.log("6. Minimize");
    await btn("Minimize the camera").click();
    await page.waitForTimeout(300);
    check("minimize shrinks it to a small bar that still says the camera is on", (await page.locator(PANEL).count()) === 0 && (await page.locator(".cam-pill.on").count()) === 1 && /on/.test(await page.locator(".cam-pill").innerText()));
    check("the camera keeps running while minimized", (await liveCams()).length === 1);
    await btn("Show the camera").click();
    await page.waitForTimeout(600);
    check("and it comes back", (await shown()).w > 0 && (await shown()).playing);

    console.log("7. Close and open again");
    await btn("Close the camera").click();
    await page.waitForTimeout(400);
    check("close shuts the preview and lets go of the camera", (await page.locator(PANEL).count()) === 0 && (await liveCams()).length === 0 && (await cams()).every((c) => c.state === "ended"), await cams());
    check("the red dot in the menu goes", (await page.locator(".aura-cam .cam-menu-dot").count()) === 0);
    await camItem.click();
    await page.waitForTimeout(1500);
    check("it opens again without restarting AURA", (await liveCams()).length === 1 && (await shown()).w > 0);
    await camItem.click();
    await page.waitForTimeout(400);
    check("the menu item closes it too (camera let go)", (await page.locator(PANEL).count()) === 0 && (await liveCams()).length === 0);

    console.log("8. When the camera can't be used");
    for (const [name, says] of [["NotAllowedError", /isn't allowed.*Privacy & security > Camera/], ["NotReadableError", /being used by another app/], ["NotFoundError", /No camera was found/]]) {
      await page.evaluate((n) => { window.__fail = n; }, name);
      await camItem.click();
      await page.waitForTimeout(800);
      const msg = await offText();
      check(`${name}: explained, with a Turn on button to try again`, says.test(msg) && /Turn on/.test(msg) && (await liveCams()).length === 0, msg);
      await btn("Close the camera").click();
      await page.waitForTimeout(300);
    }
    await page.evaluate(() => { window.__fail = null; });
    await camItem.click();
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const t = window.__cams[window.__cams.length - 1].getVideoTracks()[0]; t.stop(); t.dispatchEvent(new Event("ended")); });
    await page.waitForTimeout(400);
    check("a camera unplugged while on: explained, nothing left running", /disconnected/.test(await offText()) && (await liveCams()).length === 0, await offText());
    await page.locator(".cam-off .cam-go").click();
    await page.waitForTimeout(1500);
    check("and Turn on works again after", (await liveCams()).length === 1);

    console.log("9. Settings > Camera");
    await menu("Settings");
    const camSection = page.locator(".ss", { has: page.locator(".ss-t", { hasText: /^CAMERA$/ }) });
    check("Settings has a Camera section", (await camSection.count()) === 1);
    const pick = camSection.locator('select[aria-label="Camera"]');
    const options = await pick.locator("option").allInnerTexts();
    check("it lists both cameras (and Automatic)", options.length === 3 && options[0] === "Automatic", options);
    const second = await pick.locator("option").nth(2).getAttribute("value");
    await pick.selectOption(second);
    await page.waitForTimeout(1500);
    check("choosing a camera saves it and switches to it", (await saved()).camDevice === second && (await liveCams()).length === 1 && (await liveCams())[0].id === second, { saved: (await saved()).camDevice, live: await liveCams() });
    await camSection.locator(".seg button", { hasText: "Large" }).click();
    await page.waitForTimeout(300);
    check("Preview Size: Large makes it 480 wide", (await box(PANEL)).w === 480 && (await saved()).camWidth === 480, await box(PANEL));
    await camSection.locator('[aria-label="Mirror the preview"]').click();
    await page.waitForTimeout(300);
    check("Mirror the Preview switch works", (await shown()).mirror === "none");
    await camSection.locator('[aria-label="Mirror the preview"]').click();
    check("Camera in Recordings is off unless you switch it on", (await saved()).camInRecordings === false && (await camSection.locator('[aria-label="Camera in recordings"]').getAttribute("aria-checked")) === "false");
    await btn("Close the camera").click();
    await page.waitForTimeout(300);
    await camItem.click();
    await page.waitForTimeout(1500);
    check("the saved camera is the one used next time", (await liveCams())[0]?.id === second, await liveCams());

    // What a recording's picture looks like: [center, the chosen corner]
    const look = async (corner = "br") => page.evaluate(async (corner) => {
      const r = window.__recs[window.__recs.length - 1];
      const t = r.stream.getVideoTracks()[0];
      const v = document.createElement("video"); v.muted = true; v.srcObject = new MediaStream([t]); await v.play();
      for (let i = 0; i < 40 && !(v.videoWidth > 0); i++) await new Promise((x) => setTimeout(x, 50));
      await new Promise((x) => setTimeout(x, 400));
      const cv = document.createElement("canvas"); cv.width = v.videoWidth; cv.height = v.videoHeight;
      const g = cv.getContext("2d"); g.drawImage(v, 0, 0);
      const at = (fx, fy) => { const d = g.getImageData(Math.round(cv.width * fx) - 4, Math.round(cv.height * fy) - 4, 8, 8).data; let s = [0, 0, 0]; for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; } return s.map((x) => Math.round(x / (d.length / 4))); };
      const spot = { br: [0.86, 0.82], bl: [0.14, 0.82], tr: [0.86, 0.18], tl: [0.14, 0.18] }[corner];
      v.srcObject = null;
      return { center: at(0.5, 0.5), corner: at(spot[0], spot[1]), other: at(corner === "br" ? 0.14 : 0.86, 0.82), size: [cv.width, cv.height], same: t === window.__screens[window.__screens.length - 1].getVideoTracks()[0] };
    }, corner);
    const blue = (c) => c[2] > 200 && c[0] < 50 && c[1] < 50;
    const f9 = async () => { await page.evaluate(() => window.__f9 && window.__f9({ game: "Arc Raiders" })); await page.waitForTimeout(1500); };

    console.log("10. Recordings");
    await f9();
    let pic = await look();
    check("with Camera in Recordings off, an F9 clip is only the screen (as before)", pic.same && blue(pic.center) && blue(pic.corner), pic);
    await f9(); // stop
    check("stopping the recording leaves the preview camera on", (await liveCams()).length === 1);
    await camSection.locator('[aria-label="Camera in recordings"]').click();
    await page.waitForTimeout(300);
    check("switching on Camera in Recordings shows where it goes (bottom right)", (await saved()).camInRecordings === true && (await camSection.locator(".seg button.on", { hasText: "Bottom right" }).count()) === 1);
    await f9();
    pic = await look("br");
    check("with the camera on, the F9 clip has the camera in the bottom-right corner", !pic.same && blue(pic.center) && !blue(pic.corner) && blue(pic.other) && pic.size[0] === 1280, pic);
    await btn("Turn the camera off").click();
    await page.waitForTimeout(800);
    pic = await look("br");
    check("turning the camera off mid-recording: the recording carries on, the camera is let go", blue(pic.center) && (await liveCams()).length === 0 && (await page.evaluate(() => window.__recs[window.__recs.length - 1].rec.state)) === "recording", pic);
    await f9(); // stop
    await page.waitForTimeout(500);
    check("when the recording stops, the screen capture is let go", await page.evaluate(() => window.__screens.every((s) => s.getTracks().every((t) => t.readyState === "ended"))));
    await f9();
    pic = await look();
    check("with the camera off, a new clip is only the screen", pic.same && blue(pic.corner), pic);
    await f9();
    await page.locator(".cam-off .cam-go").click();
    await page.waitForTimeout(1500);
    await camSection.locator(".seg button", { hasText: "Top left" }).click();
    await f9();
    pic = await look("tl");
    check("the corner can be changed (top left)", !blue(pic.corner) && blue(pic.center) && blue(await look("br").then((p) => p.corner)), pic);
    await f9();

    console.log("11. Recording from the Clips page");
    await menu("Clips");
    await page.locator("button", { hasText: "⏺ Record" }).first().click({ timeout: 4000 });
    await page.locator("button", { hasText: "Record Full Desktop" }).click({ timeout: 4000 });
    await page.waitForTimeout(1500);
    pic = await look("tl");
    check("a Clips page recording has the camera in the corner too", !pic.same && !blue(pic.corner) && blue(pic.center), pic);
    await page.locator("button", { hasText: "■ Stop" }).first().click({ timeout: 4000 });
    await page.waitForTimeout(800);
    check("stopping it lets go of the screen and keeps the preview camera on", (await page.evaluate(() => window.__screens.every((s) => s.getTracks().every((t) => t.readyState === "ended")))) && (await liveCams()).length === 1);

    console.log("12. All of it");
    await btn("Close the camera").click();
    await page.waitForTimeout(400);
    check("at the end nothing is left using the camera", (await liveCams()).length === 0);
    check("nothing crashed along the way", (await page.locator(".aura-fallback").count()) === 0 && thrown.length === 0, thrown);
  } finally {
    await browser.close();
    server.close();
  }
  done(failed ? 1 : 0);
})().catch((e) => { console.error("The camera check itself broke:", e); process.exit(2); });
