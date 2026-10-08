// Security rules (electron/security.js) and how the main file uses them.
// Added by aura-security-setup.cjs.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const sec = require(path.resolve(process.argv[2] || path.join(ROOT, "electron", "security.js")));
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const { pathToFileURL } = require("url");

(async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aura-sec-")));
  const appPath = path.join(dir, "app");
  const clips = path.join(dir, "Clips");
  fs.mkdirSync(path.join(appPath, "dist"), { recursive: true });
  fs.mkdirSync(path.join(clips, "Elden Ring"), { recursive: true });
  fs.mkdirSync(path.join(clips, "Screenshots"), { recursive: true });
  const clip = path.join(clips, "Elden Ring", "clip-1.mp4"); fs.writeFileSync(clip, "x");
  const shot = path.join(clips, "Screenshots", "s.png"); fs.writeFileSync(shot, "x");
  const secret = path.join(dir, "passwords.txt"); fs.writeFileSync(secret, "x");
  const note = path.join(clips, "notes.txt"); fs.writeFileSync(note, "x");

  console.log("1. AURA's own pages");
  const page = pathToFileURL(path.join(appPath, "dist", "index.html")).href;
  check("the installed app's page is AURA's", sec.isAppUrl(page, { appPath }));
  check("with a #page on the end too", sec.isAppUrl(page + "#aurabar", { appPath }));
  check("a file outside AURA's folder isn't", !sec.isAppUrl(pathToFileURL(secret).href, { appPath }));
  check("a look-alike folder isn't", !sec.isAppUrl(pathToFileURL(appPath + "-evil/dist/index.html").href, { appPath }));
  check("websites aren't", !sec.isAppUrl("https://evil.example/", { appPath }) && !sec.isAppUrl("http://localhost:5173/", { appPath }));
  check("the dev server only counts while developing", sec.isAppUrl("http://localhost:5173/#x", { appPath, dev: true }) && !sec.isAppUrl("http://localhost:5174/", { appPath, dev: true }));
  check("rubbish isn't", !sec.isAppUrl("", { appPath }) && !sec.isAppUrl(null, { appPath }) && !sec.isAppUrl("javascript:alert(1)", { appPath }));

  console.log("2. Links that open outside AURA");
  const ext = (u) => sec.checkExternal(u, { clipFolder: clips });
  check("web links open", ext("https://www.twitch.tv/x")?.kind === "web" && ext("http://example.com")?.kind === "web");
  check("email links open", ext("mailto:?subject=hi")?.kind === "web");
  check("Steam play links open", ext("steam://rungameid/570")?.kind === "web");
  check("other Steam commands don't", !ext("steam://install/570/../../x") && !ext("steam://openurl/https://evil.example"));
  for (const bad of ["file://evil.example/share/x.exe", "\\\\evil.example\\share\\x.exe", "ms-msdt:/id PCWDiagnostic", "search-ms:query=x&crumb=location:\\\\evil", "ms-settings:", "javascript:alert(1)", "vbscript:x", "calculator:", "https://user:pass@example.com/"]) {
    check("refused: " + bad, !ext(bad));
  }
  check("a screenshot in the clip folder opens", ext(pathToFileURL(shot).href)?.path === shot);
  check("a clip opens", ext(pathToFileURL(clip).href)?.kind === "file");
  check("other files on the PC don't", !ext(pathToFileURL(secret).href) && !ext(pathToFileURL(note).href));
  check("a way out of the clip folder doesn't", !ext(pathToFileURL(path.join(clips, "..", "passwords.txt")).href));
  const opened = [];
  const open = sec.makeOpenExternal({ shell: { openExternal: async (u) => opened.push(["web", u]), openPath: async (p) => { opened.push(["file", p]); return ""; } }, getClipFolder: () => clips, log: () => {} });
  check("opening a web link works", (await open("https://example.com/a")).success && opened[0][1] === "https://example.com/a");
  check("opening a blocked link says so and opens nothing", !(await open("ms-msdt:/id x")).success && opened.length === 1);
  check("a screenshot opens in its own app", (await open(pathToFileURL(shot).href)).success && opened[1][0] === "file");

  console.log("3. Clip files");
  check("a clip in the folder is fine", sec.clipPath(clip, clips) === clip);
  check("the folder itself isn't a clip", sec.clipPath(clips, clips) === null);
  check("a file outside isn't", sec.clipPath(secret, clips) === null);
  check("..\\ tricks aren't", sec.clipPath(path.join(clips, "Elden Ring", "..", "..", "passwords.txt"), clips) === null);
  check("a look-alike folder isn't", sec.clipPath(clips + "Evil" + path.sep + "x.mp4", clips) === null);
  check("rubbish isn't", sec.clipPath("", clips) === null && sec.clipPath(null, clips) === null && sec.clipPath(clip + "\0.mp4", clips) === null && sec.clipPath({}, clips) === null);
  try {
    const link = path.join(clips, "link.mp4"); fs.symlinkSync(secret, link);
    check("a shortcut out of the folder isn't", sec.clipPath(link, clips) === null);
  } catch { console.log("  (skipped the shortcut check: this PC doesn't allow making one)"); }
  check("Windows paths are compared without case", sec.inside("C:\\Users\\Me\\Clips", "c:\\users\\me\\clips\\Game\\a.mp4") && !sec.inside("C:\\Users\\Me\\Clips", "C:\\Users\\Me\\ClipsX\\a.mp4") && !sec.inside("C:\\Users\\Me\\Clips", "C:\\Users\\Me\\Clips\\..\\a.mp4"));
  check("only clip and picture types count", sec.isClipFile("a.MP4") && sec.isClipFile("a.webm") && sec.isClipFile("a.png") && !sec.isClipFile("a.exe") && !sec.isClipFile("a.lnk") && !sec.isClipFile("a.txt"));

  console.log("4. Names typed for clips, and game names used for folders");
  check("a normal name stays", sec.safeName("Elden Ring") === "Elden Ring" && sec.safeName("Épique run (2)") === "Épique run (2)");
  check("slashes can't make a path", !/[\\/]/.test(sec.safeName("..\\..\\Startup\\x")) && !/[\\/]/.test(sec.safeName("../../x")));
  check(".. alone is refused", sec.safeName("..") === "General" && sec.safeName(" . ") === "General" && sec.safeName("..", "") === "");
  check("names Windows refuses are refused", sec.safeName("CON") === "General" && sec.safeName("nul.txt") === "General" && sec.safeName("a:b*c?") === "a_b_c_");
  check("nothing becomes General", sec.safeName("") === "General" && sec.safeName(null) === "General");
  check("very long names are cut", sec.safeName("x".repeat(500)).length === 100);

  console.log("5. Games");
  const exe = path.join(dir, "Game", "game.exe"); fs.mkdirSync(path.dirname(exe), { recursive: true }); fs.writeFileSync(exe, "MZ");
  const other = path.join(dir, "Game", "other.exe"); fs.writeFileSync(other, "MZ");
  const bat = path.join(dir, "Game", "run.bat"); fs.writeFileSync(bat, "x");
  let asked = 0, answer = 1;
  const dialog = { showMessageBox: async () => { asked++; return { response: answer }; } };
  const store = path.join(dir, "userData", "approved-games.json");
  const games = sec.makeGames({ file: store, dialog, getMainWindow: () => null, platform: "linux" });
  check("a game you picked starts without asking", (games.approve(exe), (await games.check(exe)) === null && asked === 0));
  check("only .exe files start", /only starts \.exe/.test(await games.check(bat)) && asked === 0);
  check("a missing file says so", /wasn't found/.test(await games.check(path.join(dir, "Game", "gone.exe"))));
  check("no path, or a relative one, is refused", /valid file/.test(await games.check("")) && /valid file/.test(await games.check("game.exe")) && /valid file/.test(await games.check({})));
  check("a game nobody picked asks first, and Cancel stops it", (await games.check(other)) === "Cancelled." && asked === 1);
  answer = 0;
  check("saying Start runs it", (await games.check(other)) === null && asked === 2);
  check("and it isn't asked again", (await games.check(other)) === null && asked === 2);
  const again = sec.makeGames({ file: store, dialog, getMainWindow: () => null, platform: "linux" });
  check("the list is kept after AURA restarts", again.has(exe) && again.has(other));
  again.approveAll([{ exePath: path.join(dir, "Game", "imported.exe") }, null, { exePath: 5 }]);
  check("imports are remembered", again.has(path.join(dir, "Game", "imported.exe")));
  fs.writeFileSync(store, "not json");
  check("a damaged list just means asking again", !sec.makeGames({ file: store, dialog, getMainWindow: () => null, platform: "linux" }).has(exe));

  console.log("6. Permissions");
  let handler, checker;
  const ses = { setPermissionRequestHandler: (f) => { handler = f; }, setPermissionCheckHandler: (f) => { checker = f; } };
  let promptAnswer = 0; let prompts = 0;
  const perms = sec.makePermissions({
    dialog: { showMessageBox: async () => { prompts++; return { response: promptAnswer }; } },
    BrowserWindow: { fromWebContents: () => null },
    isTrusted: (wc) => !!(wc && wc.trusted),
    getMainWindow: () => null,
  });
  perms.lock(ses);
  const ask = (wc, permission, details) => new Promise((r) => handler(wc, permission, r, details));
  const site = { trusted: false, getURL: () => "https://www.instagram.com/" };
  check("AURA's pages get the microphone and screen", (await ask({ trusted: true }, "media", { mediaTypes: ["audio"] })) && (await ask({ trusted: true }, "display-capture", {})));
  check("websites get fullscreen without asking", await ask(site, "fullscreen", {}));
  check("websites never get location, notifications or programs", !(await ask(site, "geolocation", {})) && !(await ask(site, "notifications", {})) && !(await ask(site, "openExternal", {})) && prompts === 0);
  promptAnswer = 1;
  check("a website asking for the camera is asked about, and Block blocks it", !(await ask(site, "media", { mediaTypes: ["video"], requestingUrl: "https://www.instagram.com/x" })) && prompts === 1);
  check("the answer is remembered", !(await ask(site, "media", { mediaTypes: ["video"], requestingUrl: "https://www.instagram.com/y" })) && prompts === 1);
  promptAnswer = 0;
  check("Allow allows the microphone for that site", (await ask(site, "media", { mediaTypes: ["audio"], requestingUrl: "https://www.messenger.com/" })) && prompts === 2);
  check("and the browser's check agrees", checker(site, "media", "https://www.messenger.com", { requestingUrl: "https://www.messenger.com/t/1" }) === true && checker(site, "media", "https://evil.example", {}) === false);
  check("a page that isn't https is never offered the camera", !(await ask(site, "media", { mediaTypes: ["video"], requestingUrl: "http://evil.example/" })) && prompts === 2);
  check("checks: AURA yes, websites only the safe ones", checker({ trusted: true }, "media", "", {}) === true && checker(site, "geolocation", "https://x", {}) === false && checker(site, "fullscreen", "https://x", {}) === true);
  const before = handler; perms.lock(ses);
  check("locking a session twice is harmless", handler === before);

  console.log("7. Embedded pages");
  const prefs = { preload: "C:\\evil.js", nodeIntegration: true, contextIsolation: false, sandbox: false, webSecurity: false };
  check("an https page may be embedded", sec.hardenWebview(prefs, { src: "https://www.instagram.com/" }));
  check("but never with Node, a preload or without the sandbox", !prefs.preload && prefs.nodeIntegration === false && prefs.contextIsolation === true && prefs.sandbox === true && prefs.webSecurity === true);
  check("file: and javascript: pages can't be embedded", !sec.hardenWebview({}, { src: "file:///C:/x.html" }) && !sec.hardenWebview({}, { src: "javascript:alert(1)" }));

  console.log("8. The main file uses all of this");
  const mainFile = path.join(ROOT, "electron", "main.js");
  const main = fs.existsSync(mainFile) ? fs.readFileSync(mainFile, "utf8") : "";
  if (!main) console.log("  (skipped: electron/main.js not found)");
  else {
    const handlerOf = (name) => { const i = main.indexOf('ipcMain.handle("' + name + '"'); return i < 0 ? "" : main.slice(i, main.indexOf("\n});", i) + 4); };
    const createWindow = main.slice(main.indexOf("function createWindow"), main.indexOf("function createWindow") + 1500);
    check("the AURA window is sandboxed with web security on", /sandbox: true/.test(createWindow) && /webSecurity: true/.test(createWindow) && !/allowRunningInsecureContent: true/.test(createWindow));
    check("the AURA Bar is sandboxed", /auraBar = new BrowserWindow\(\{[\s\S]{0,700}?sandbox: true/.test(main));
    check("nothing turns web security off", !/webSecurity:\s*false/.test(main) && !/nodeIntegration:\s*true/.test(main) && !/contextIsolation:\s*false/.test(main));
    check("AURA's windows can't be sent to other sites", /contents\.on\("will-navigate", stay\)/.test(main) && /will-attach-webview/.test(main));
    check("links go through the safe opener", /ipcMain\.handle\("open-external", async \(_e, url\) => safeOpenExternal\(url\)\)/.test(main) && !/else shell\.openExternal\(url\)/.test(main));
    check("permissions are locked for every session", /app\.on\("session-created", \(ses\) => permissions\.lock\(ses\)\)/.test(main) && !/setPermissionCheckHandler\(\(\) => true\)/.test(main));
    check("only AURA's pages capture the screen", /return callback\(\{\}\)/.test(main));
    check("games are checked before they start", /approvedGames\.check\(exePath\)/.test(handlerOf("launch-game")));
    check("delete, rename, trim and the clip player stay in the clip folder",
      /security\.clipPath/.test(handlerOf("delete-clip")) && /security\.clipPath/.test(handlerOf("rename-clip")) && /security\.clipPath/.test(handlerOf("trim-clip")) && /security\.clipPath\(asked, getClipFolder\(\)\)/.test(main));
    check("game names can't leave the clip folder", !/path\.join\(getClipFolder\(\), gameName \|\| "General"\)/.test(main));
    check("the Discord listener only answers this PC and checks the login", /authServer\.listen\(3000, "127\.0\.0\.1"/.test(main) && /state=\$\{discordState\}/.test(main) && /state !== expected/.test(main));
    check("PowerShell never gets a game folder in its command", /\$env:AURA_DIR/.test(main) && !/StartsWith\('\$\{safe\}'/.test(main));
    check("the installed app doesn't read .env", !/resEnv/.test(main));
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
