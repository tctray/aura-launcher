// The media player's main-process side (electron/media.js): reading playlist files, which files the
// window may play, the local server, finding files in folders, reading titles and converting.
// Uses the real FFmpeg (ffmpeg-static) on short made-up files.
// Added by aura-media-player-setup.cjs.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawnSync } = require("child_process");
const { create, parsePlaylist, resolveEntries, m3u } = require(path.resolve(process.argv[2] || path.join(__dirname, "..", "electron", "media.js")));
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const get = (url, headers = {}) => new Promise((resolve) => {
  http.get(url, { headers }, (res) => { const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) })); }).on("error", () => resolve({ status: 0 }));
});

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-"));
  const music = path.join(root, "Music"), videos = path.join(root, "Videos"), secret = path.join(root, "Documents");
  for (const d of [music, path.join(music, "Album"), videos, secret, path.join(music, "node_modules")]) fs.mkdirSync(d, { recursive: true });

  console.log("1. Reading playlist files");
  let p = parsePlaylist("#EXTM3U\n#PLAYLIST:Road Trip\n#EXTINF:123,Band - Song\nAlbum/one.mp3\n\nC:\\Music\\two.flac\nfile:///C:/Music/three%20four.mp3\nhttps://example.com/stream.mp3\n", "C:\\Lists\\trip.m3u8");
  check("m3u: its name, and each line that isn't a comment", p.name === "Road Trip" && JSON.stringify(p.entries) === JSON.stringify(["Album/one.mp3", "C:\\Music\\two.flac", "file:///C:/Music/three%20four.mp3", "https://example.com/stream.mp3"]), p);
  p = parsePlaylist("[playlist]\nFile1=a.mp3\nTitle1=A\nFile2=b.ogg\nNumberOfEntries=2\n", "/x/list.pls");
  check("pls", p.name === "list" && p.entries.join() === "a.mp3,b.ogg", p);
  p = parsePlaylist('<?xml version="1.0"?><playlist><title>Chill &amp; Code</title><trackList><track><title>Not this</title><location>file:///home/me/Music/a%20b.mp3</location></track><track><location>c.flac</location></track></trackList></playlist>', "/x/list.xspf");
  check("xspf (VLC)", p.name === "Chill & Code" && p.entries.join() === "file:///home/me/Music/a%20b.mp3,c.flac", p);
  p = parsePlaylist('<?wpl version="1.0"?><smil><head><title>Gym</title></head><body><seq><media src="..\\Music\\a.mp3"/><media src="b &amp; c.wma"/></seq></body></smil>', "C:\\Lists\\gym.wpl");
  check("wpl (Windows Media Player)", p.name === "Gym" && p.entries.join("|") === "..\\Music\\a.mp3|b & c.wma", p);
  fs.writeFileSync(path.join(music, "Album", "one.mp3"), "x");
  const r = resolveEntries(["Album/one.mp3", "Album/gone.mp3", "notes.txt", "https://example.com/a.mp3", "file://" + path.join(music, "Album", "one.mp3").replace(/\\/g, "/")], path.join(music, "list.m3u"));
  check("entries become full paths: found, not on this PC, or skipped (web links, other files)", r.found.length === 2 && r.found[0] === path.join(music, "Album", "one.mp3") && r.missing.length === 1 && r.skipped.length === 2, r);
  check("exporting writes a playlist other players open", m3u("Gym", ["C:\\a.mp3", "D:\\b.mp4"]) === "#EXTM3U\n#PLAYLIST:Gym\nC:\\a.mp3\nD:\\b.mp4\n");

  // Real files, made with FFmpeg
  let ffmpeg = null; try { ffmpeg = require("ffmpeg-static"); } catch {}
  if (!ffmpeg || !fs.existsSync(ffmpeg)) { console.log("  note  FFmpeg isn't installed here (npm install), so the rest wasn't checked"); console.log(failed ? `\n${failed} FAILED` : "\nall passed"); process.exit(failed ? 1 : 0); }
  const make = (args, file) => spawnSync(ffmpeg, ["-y", "-loglevel", "error", ...args, file]).status === 0;
  const song = path.join(music, "Album", "Night Drive.mp3");
  make(["-f", "lavfi", "-i", "sine=frequency=330:duration=3", "-metadata", "title=Night Drive", "-metadata", "artist=The Testers", "-metadata", "album=Made Up", "-c:a", "libmp3lame"], song);
  const clip = path.join(videos, "trip.mp4");
  make(["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25", "-f", "lavfi", "-i", "sine=frequency=500", "-t", "3", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac"], clip);
  const old = path.join(videos, "old.avi");
  make(["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25", "-t", "2", "-c:v", "mpeg4"], old);
  fs.writeFileSync(path.join(music, "node_modules", "skip.mp3"), "x");
  fs.writeFileSync(path.join(secret, "passwords.txt"), "secret");
  fs.writeFileSync(path.join(secret, "private.mp3"), "x");
  fs.writeFileSync(path.join(root, "trip.m3u"), "#EXTM3U\nVideos/trip.mp4\nMusic/Album/missing.mp3\n");

  const handlers = {}, sent = [];
  let pick = [];
  const dialog = { showOpenDialog: async () => ({ canceled: !pick.length, filePaths: pick }), showSaveDialog: async () => ({ canceled: false, filePath: path.join(root, "out.m3u8") }) };
  create({ userData: path.join(root, "data"), ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, dialog, getWindow: () => ({ isDestroyed: () => false, webContents: { send: (ch, d) => sent.push([ch, d]) } }) });
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  const call = (ch, ...a) => handlers["media:" + ch](null, ...a);

  console.log("2. Folders and files");
  let s = await call("state");
  check("starts with nothing, and a private server", s.success && s.folders.length === 0 && s.port > 0 && s.token.length >= 32);
  pick = [music, videos];
  s = await call("add-folder");
  check("folders can be added", s.folders.length === 2);
  let scan = await call("scan");
  const names = scan.items.map((i) => i.name).sort();
  check("finds the music and videos in them, inside sub-folders too", JSON.stringify(names) === JSON.stringify(["Night Drive", "old", "one", "trip"]), names);
  check("...knowing which is music and which is video", scan.items.find((i) => i.name === "trip").kind === "video" && scan.items.find((i) => i.name === "Night Drive").kind === "audio");
  check("...and skipping program folders like node_modules", !names.includes("skip"));
  const info = (await call("info", [song, clip])).info;
  check("reads title, artist, album and length", info[song].title === "Night Drive" && info[song].artist === "The Testers" && info[song].album === "Made Up" && info[song].duration === 3, info[song]);
  check("...and a video's size", info[clip].width === 320 && info[clip].height === 180 && info[clip].vcodec === "h264");

  console.log("3. Only your music and videos can be played");
  let u = await call("url", song);
  let res = await get(u.url);
  check("a song in your folders plays", u.success && u.native && res.status === 200 && res.headers["content-type"] === "audio/mpeg" && res.body.length === fs.statSync(song).size);
  res = await get(u.url, { Range: "bytes=10-19" });
  check("...and can be skipped through", res.status === 206 && res.body.length === 10 && res.headers["content-range"] === `bytes 10-19/${fs.statSync(song).size}`);
  check("without the secret key: refused", (await get(u.url.replace(/t=[^&]+/, "t=nope"))).status === 403);
  const base = u.url.split("?")[0];
  const token = new URL(u.url).searchParams.get("t");
  check("other files: refused, even with the key", (await get(`${base}?p=${encodeURIComponent(path.join(secret, "passwords.txt"))}&t=${token}`)).status === 404);
  check("music outside your folders: refused", (await get(`${base}?p=${encodeURIComponent(path.join(secret, "private.mp3"))}&t=${token}`)).status === 404 && !(await call("url", path.join(secret, "private.mp3"))).success);
  check("climbing out of a folder: refused", (await get(`${base}?p=${encodeURIComponent(path.join(music, "..", "Documents", "private.mp3"))}&t=${token}`)).status === 404);
  res = await get(u.art);
  check("album art comes from the file (a small JPEG)", res.status === 404 || (res.status === 200 && res.headers["content-type"] === "image/jpeg"));
  res = await get((await call("url", clip)).art);
  check("a video's picture is a frame from it", res.status === 200 && res.body[0] === 0xff && res.body[1] === 0xd8);

  console.log("4. Dropped, opened and imported");
  let d = await call("dropped", [path.join(secret, "private.mp3"), path.join(secret, "passwords.txt"), path.join(root, "trip.m3u")]);
  check("a dropped song can be played, other dropped files are ignored", d.items.length === 1 && d.items[0].name === "private" && (await call("url", path.join(secret, "private.mp3"))).success);
  check("a dropped playlist file is imported", d.playlists.length === 1 && d.playlists[0].name === "trip" && d.playlists[0].items.length === 2 && d.playlists[0].missing === 1, d.playlists);
  pick = [path.join(root, "trip.m3u")];
  const im = await call("import");
  check("importing a playlist file keeps it in AURA", im.playlists.length === 1 && (await call("state")).playlists.length === 2);
  const lists = (await call("state")).playlists;
  const saved = await call("playlists-save", [...lists, { name: "<b>Mine</b>", items: [song, path.join(secret, "passwords.txt")] }, "junk"]);
  check("playlists from the window are checked (music and video files only)", saved.playlists.length === 3 && saved.playlists[2].items.length === 1 && saved.playlists[2].id.length >= 6, saved.playlists[2]);
  const ex = await call("export", saved.playlists[2].id);
  check("export writes an .m3u8", ex.saved && fs.readFileSync(path.join(root, "out.m3u8"), "utf8").includes(song));

  console.log("5. Formats the window can't play");
  u = await call("url", old);
  check("an AVI is marked as needing converting", u.success && u.native === false);
  const c = await call("convert", old);
  res = await get(c.url);
  check("it's converted to an MP4 the window plays", c.success && res.status === 200 && res.body.includes(Buffer.from("ftyp")), c);
  check("...saying how far it has got", sent.some(([ch, x]) => ch === "media-progress" && x.path === old));
  const again = await call("convert", old);
  check("the second time it's ready straight away", again.success && again.url.split("p=")[1].split("&")[0] === c.url.split("p=")[1].split("&")[0]);
  check("only files you can play are converted", !(await call("convert", path.join(secret, "passwords.txt"))).success);

  console.log("6. Removing a folder");
  s = await call("remove-folder", music);
  check("the folder is gone from the list", s.folders.length === 1 && s.folders[0] === videos);
  check("...files in it that were added to a playlist still play", (await call("url", song)).success);
  check("...and other files from it don't", !(await call("url", path.join(music, "Album", "one.mp3"))).success && fs.existsSync(song));

  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch {} // Windows may still hold a converted file (Updated by aura-windows-test-fix.cjs)
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
