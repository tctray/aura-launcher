// Xbox / Game Pass games: builds a pretend Xbox games folder and checks that AURA's scanner
// (electron/xbox.js) reads it the way it should, and knows how to start each kind of game.
// Added by aura-xbox-setup.cjs.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const xbox = require(path.resolve(process.argv[2] || path.join(__dirname, "..", "electron", "xbox.js")));
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok || extra === undefined ? "" : "\n          " + JSON.stringify(extra))); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aura-xbox-"));
const root = path.join(tmp, "XboxGames"), second = path.join(tmp, "MyGames");
const put = (file, content = "x") => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
const MS = "CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US";
const config = ({ name = "Studio.Game", publisher = MS, display = "", exes = '<Executable Name="Game.exe" Id="Game"/>' }) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<Game configVersion="1">\n  <!-- <Executable Name="Commented.exe" Id="Nope"/> -->\n  <Identity Name="${name}" Publisher="${publisher}" Version="1.0.0.0"/>\n  <ExecutableList>\n    ${exes}\n  </ExecutableList>\n  <ShellVisuals DefaultDisplayName="${display}" PublisherDisplayName="Studio" Square150x150Logo="logo.png"/>\n</Game>\n`;
const game = (folder, opts, files) => { const content = path.join(root, folder, "Content"); if (opts) put(path.join(content, "MicrosoftGame.config"), config(opts)); for (const [f, size] of Object.entries(files || {})) put(path.join(content, ...f.split("/")), "x".repeat(size)); return content; };

// A typical game: its config names the program, and Xbox's own starter sits beside it
const forza = game("Forza Horizon 5", { name: "Microsoft.624F8B84B80", display: "Forza Horizon 5", exes: '<Executable Name="ForzaHorizon5.exe" Id="App"/>' }, { "ForzaHorizon5.exe": 50, "gamelaunchhelper.exe": 5 });
// Name given as a lookup code, program in a sub-folder (written the Windows way), no starter
const halo = game("Halo Infinite", { name: "Microsoft.254428597CFE2", display: "ms-resource:AppDisplayName", exes: '<Executable Name="Binaries\\Win64\\HaloInfinite.exe" Id="Game"/>' }, { "Binaries/Win64/HaloInfinite.exe": 50 });
// A console program and a developer tool listed first; a name with "&" in it
const ori = game("Ori", { display: "Ori &amp; the Will of the Wisps", exes: '<Executable Name="Console.exe" Id="Xbox" TargetDeviceFamily="Scarlett"/> <Executable Name="DevTool.exe" Id="Dev" IsDevOnly="true"/> <Executable Id="Game" TargetDeviceFamily="PC" Name="oriwotw.exe"/>' }, { "Console.exe": 10, "DevTool.exe": 10, "oriwotw.exe": 30 });
// No config at all: the biggest program that isn't a tool
game("Old Game", null, { "bin/OldGame.exe": 400, "CrashReporter.exe": 900, "bin/unins000.exe": 950, "bin/small.exe": 20 });
// The config names a program that isn't there
game("Moved", { display: "Moved Game", exes: '<Executable Name="Gone.exe" Id="Game"/>' }, { "Real.exe": 60 });
// Things that aren't games
fs.mkdirSync(path.join(root, "GameSave"), { recursive: true });
game("Some Add-on", { display: "Add-on Pack", exes: "" }, { "data.pak": 100 });
put(path.join(root, "notes.txt"));
// A second folder on another drive, with one game of its own
put(path.join(second, "Sea of Thieves", "Content", "MicrosoftGame.config"), config({ display: "Sea of Thieves", exes: '<Executable Name="SoTGame.exe" Id="Game"/>' }));
put(path.join(second, "Sea of Thieves", "Content", "SoTGame.exe"));

(async () => {
  console.log("1. Finding installed games");
  const { games } = await xbox.findGames({ roots: [root, second, path.join(tmp, "missing")] });
  const by = Object.fromEntries(games.map((g) => [g.title, g.exePath]));
  check("finds every game, in both folders, and nothing that isn't one", JSON.stringify(games.map((g) => g.title)) === JSON.stringify(["Forza Horizon 5", "Halo Infinite", "Moved Game", "Old Game", "Ori & the Will of the Wisps", "Sea of Thieves"]), games.map((g) => g.title));
  check("uses the program the game's own config names", by["Forza Horizon 5"] === path.join(forza, "ForzaHorizon5.exe"), by["Forza Horizon 5"]);
  check("follows a program kept in a sub-folder", by["Halo Infinite"] === path.join(halo, "Binaries", "Win64", "HaloInfinite.exe"), by["Halo Infinite"]);
  check("uses the folder's name when the game gives a lookup code instead of a title", "Halo Infinite" in by);
  check("picks the PC program, not the console one or a developer tool", by["Ori & the Will of the Wisps"] === path.join(ori, "oriwotw.exe"), by["Ori & the Will of the Wisps"]);
  check("with no config, picks the game rather than a crash reporter or uninstaller", by["Old Game"] === path.join(root, "Old Game", "Content", "bin", "OldGame.exe"), by["Old Game"]);
  check("if the named program is missing, finds the one that is there", by["Moved Game"] === path.join(root, "Moved", "Content", "Real.exe"), by["Moved Game"]);

  console.log("2. What the Import button gets back");
  let asked = [];
  let res = await xbox.importGames({ roots: [root], covers: async (list) => { asked.push(list); return { success: true, covers: { [list[0].id]: "https://images.example/forza.jpg", [list[1].id]: "javascript:alert(1)" } }; } });
  check("games come back in the shape the library uses", res.success && res.games.length === 5 && res.games.every((g) => g.title && g.exePath && g.category === "Other" && typeof g.cover === "string"), res);
  check("cover art is asked for by title, and filled in", asked.length === 1 && asked[0][0].title === "Forza Horizon 5" && res.games[0].cover === "https://images.example/forza.jpg", [asked, res.games[0]]);
  check("only a proper web address is accepted as a cover", res.games[1].cover === "", res.games[1]);
  res = await xbox.importGames({ roots: [root], covers: async () => { throw new Error("offline"); } });
  check("if cover art can't be fetched, the games are still imported", res.success && res.games.length === 5 && res.games.every((g) => g.cover === ""));
  res = await xbox.importGames({ roots: [] });
  check("no Xbox folder: says so plainly", res.success === false && /No Xbox games folder found/.test(res.error), res);
  res = await xbox.importGames({ roots: [path.join(root, "GameSave")] });
  check("an Xbox folder with no games in it: says where it looked", res.success === false && /No installed Xbox games found in/.test(res.error) && res.error.includes("GameSave"), res);

  console.log("3. Starting a game");
  let how = xbox.launcherFor(by["Forza Horizon 5"]);
  check("a game with Xbox's own starter is started through it", how && how.command === path.join(forza, "gamelaunchhelper.exe") && how.args.length === 0 && how.cwd === forza, how);
  how = xbox.launcherFor(by["Halo Infinite"], { platform: "win32" });
  check("a game without one is started through Windows, by its app address", how && how.command === "explorer.exe" && how.args.length === 1 && how.args[0] === "shell:AppsFolder\\Microsoft.254428597CFE2_8wekyb3d8bbwe!Game" && how.cwd === halo, how);
  check("the program id in that address comes from the game's config", xbox.appAddress(xbox.readConfig(fs.readFileSync(path.join(forza, "MicrosoftGame.config"), "utf8"))) === "Microsoft.624F8B84B80_8wekyb3d8bbwe!App");
  check("a game that isn't from Xbox is left to start as usual", xbox.launcherFor(path.join(tmp, "Steam", "common", "Doom", "doom.exe")) === null && xbox.launcherFor("") === null && xbox.launcherFor(null) === null);
  put(path.join(tmp, "Deep", "MicrosoftGame.config"), config({})); put(path.join(tmp, "Deep", "a", "b", "c", "d", "e", "f", "g.exe"));
  check("it only looks a few folders up for the config", xbox.launcherFor(path.join(tmp, "Deep", "a", "b", "c", "d", "e", "f", "g.exe")) === null && xbox.launcherFor(path.join(tmp, "Deep", "a", "b", "g.exe"), { platform: "win32" }) !== null);
  check("an odd name in a config can't put anything unexpected into the command", xbox.appAddress({ name: "Bad Name & calc.exe", publisher: MS, executables: [{ name: "a.exe", id: "Game" }] }) === "" && /!Game$/.test(xbox.appAddress({ name: "Good.Name", publisher: MS, executables: [{ name: "a.exe", id: "x y & z" }] })));

  console.log("4. Windows' short publisher names, and the Xbox folder marker");
  check("Microsoft's publisher name shortens to the value Windows uses", xbox.publisherId(MS) === "8wekyb3d8bbwe");
  check("so does the Windows one", xbox.publisherId("CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond, S=Washington, C=US") === "cw5n1h2txyewy");
  const marker = (...folders) => Buffer.concat([Buffer.from("RGBX"), Buffer.from([folders.length, 0, 0, 0]), ...folders.map((f) => Buffer.from(f + "\u0000", "utf16le"))]);
  check("the marker file names the default folder", JSON.stringify(xbox.foldersFromGamingRoot(marker("XboxGames"))) === '["XboxGames"]');
  check("...or one the person chose", JSON.stringify(xbox.foldersFromGamingRoot(marker("Games\\Xbox"))) === '["Games\\\\Xbox"]', xbox.foldersFromGamingRoot(marker("Games\\Xbox")));
  check("a file that isn't a marker, or points outside the drive, is ignored", xbox.foldersFromGamingRoot(Buffer.from("hello world")).length === 0 && xbox.foldersFromGamingRoot(null).length === 0 && xbox.foldersFromGamingRoot(marker("..\\Windows", "C:\\Windows")).length === 0, xbox.foldersFromGamingRoot(marker("..\\Windows", "C:\\Windows")));
  check("on a PC that isn't Windows there are no Xbox folders to look in", process.platform === "win32" || (await xbox.gamingRoots()).length === 0);

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("The Xbox check itself broke:", e); process.exit(2); });
