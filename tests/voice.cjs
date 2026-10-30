// Voice commands (electron/voice.js): what AURA listens for, what it does with what it hears, and
// that it stays off until you switch it on. The Windows helper is replaced by a pretend one that
// "hears" phrases, so this runs anywhere. Added by aura-voice-setup.cjs. Every page, calls and typing
// messages by voice: updated by aura-voice-more-setup.cjs; the sign mid-sentence by aura-voice-bubble-setup.cjs.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok || extra === undefined ? "" : "  " + JSON.stringify(extra))); };
const ROOT = path.resolve(__dirname, "..");
const voice = require(path.join(ROOT, "electron", "voice.js"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aura-voice-"));

// A pretend Windows helper: remembers what AURA asks, and can say it heard something
function fakeSpawn() {
  const runs = [];
  const fn = (cmd, args) => {
    const p = new EventEmitter();
    p.cmd = cmd; p.args = args; p.asked = []; p.killed = false;
    p.stdout = new EventEmitter(); p.stderr = new EventEmitter();
    p.stdin = { write: (s) => { p.asked.push(JSON.parse(s)); return true; }, end() {} };
    p.kill = () => { p.killed = true; };
    p.say = (o) => p.stdout.emit("data", JSON.stringify(o) + "\n");
    runs.push(p);
    return p;
  };
  fn.runs = runs;
  return fn;
}
function setup({ platform = "win32", enabled = null, quietMs } = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, "d"));
  const prefsFile = path.join(dir, "aura-voice.json"), helperFile = path.join(dir, "aura-voice.ps1");
  if (enabled !== null) fs.writeFileSync(prefsFile, JSON.stringify({ enabled }));
  const handlers = {}, sent = [], record = [], bar = [];
  let clock = 1000;
  const spawnFn = fakeSpawn();
  const win = { isDestroyed: () => false, webContents: { send: (ch, d) => sent.push([ch, d]) } };
  const v = voice.create({
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, getWindow: () => win, platform, spawnFn, prefsFile, helperFile,
    onRecord: (a) => record.push(a), onBar: () => bar.push(1), now: () => clock, ...(quietMs ? { quietMs } : {}),
  });
  return { v, handlers, sent, record, bar, spawnFn, prefsFile, helperFile, tick: (ms) => { clock += ms; }, call: (ch, ...a) => handlers[ch](null, ...a) };
}
const commands = (sent) => sent.filter(([c]) => c === "voice-command").map(([, d]) => d);

(async () => {
  console.log("1. Off until you switch it on");
  let t = setup();
  check("it starts off, and the microphone isn't touched", t.spawnFn.runs.length === 0 && (await t.call("voice:get")).enabled === false && (await t.call("voice:get")).state === "off");
  check("it lists what you can say", (await t.call("voice:get")).commands.includes("next song"));
  let r = await t.call("voice:set", true);
  check("switching it on starts the Windows helper, hidden", t.spawnFn.runs.length === 1 && t.spawnFn.runs[0].cmd === "powershell.exe" && t.spawnFn.runs[0].args.includes(t.helperFile) && r.enabled === true && r.state === "starting");
  check("...written to AURA's data folder", fs.readFileSync(t.helperFile, "utf8") === voice.SCRIPT);
  check("...and remembered for next time", JSON.parse(fs.readFileSync(t.prefsFile, "utf8")).enabled === true);
  const p = t.spawnFn.runs[0];
  check("it's told only AURA's phrases", p.asked[0].cmd === "start" && p.asked[0].phrases.includes("hey aura") && p.asked[0].phrases.includes("hey aura next song") && p.asked[0].phrases.every((x) => /^[a-z0-9' ]+$/.test(x)));
  p.say({ type: "ready", text: "en-US", conf: 1 });
  check("once Windows is ready it's listening", (await t.call("voice:get")).state === "listening");
  r = await t.call("voice:set", false);
  check("switching it off stops the helper", p.killed && r.state === "off" && JSON.parse(fs.readFileSync(t.prefsFile, "utf8")).enabled === false);
  t = setup({ enabled: true });
  check("switched on last time: it starts with AURA", t.spawnFn.runs.length === 1);
  t = setup({ platform: "linux" });
  r = await t.call("voice:set", true);
  check("not on Windows: nothing starts", t.spawnFn.runs.length === 0 && r.enabled === false && r.supported === false);

  console.log("2. What it hears");
  t = setup(); await t.call("voice:set", true);
  let h = t.spawnFn.runs[0]; h.say({ type: "ready", text: "en-US", conf: 1 });
  h.say({ type: "heard", text: "hey aura next song", conf: 0.9 });
  check("“Hey AURA, next song” goes to the window as next", JSON.stringify(commands(t.sent)) === JSON.stringify([{ action: "media", detail: "next", said: "next song" }]), commands(t.sent));
  h.say({ type: "heard", text: "pause", conf: 0.95 });
  check("“pause” without “Hey AURA” does nothing", commands(t.sent).length === 1);
  h.say({ type: "heard", text: "hey aura pause", conf: 0.4 });
  check("something Windows isn't sure about does nothing", commands(t.sent).length === 1);
  h.say({ type: "heard", text: "hey aura", conf: 0.8 });
  check("“Hey AURA” on its own shows the Listening sign", t.sent.some(([c, d]) => c === "voice-status" && d.state === "awake"));
  t.tick(3000);
  h.say({ type: "heard", text: "pause music", conf: 0.8 });
  check("...and the next command within 6 seconds counts", commands(t.sent)[1]?.detail === "pause");
  h.say({ type: "heard", text: "play", conf: 0.8 });
  check("...but only that one", commands(t.sent).length === 2);
  h.say({ type: "heard", text: "hey aura", conf: 0.8 }); t.tick(7000);
  h.say({ type: "heard", text: "next", conf: 0.9 });
  check("after 6 seconds it stops waiting", commands(t.sent).length === 2);
  // Said in one go: the sign shows while you're still talking (Added by aura-voice-bubble-setup.cjs)
  const awake = () => t.sent.filter(([c, d]) => c === "voice-status" && d.state === "awake").length;
  t.tick(10000); let shown = awake();
  h.say({ type: "hyp", text: "hey", conf: 0.2 });
  h.say({ type: "hyp", text: "hey aura next", conf: 0.3 });
  check("“Hey AURA, next song” in one go: the Listening sign shows as soon as “Hey AURA” is heard", awake() === shown + 1);
  h.say({ type: "hyp", text: "hey aura next song", conf: 0.4 });
  check("...once, not again for every word", awake() === shown + 1);
  t.tick(4000); shown = awake();
  h.say({ type: "hyp", text: "next song", conf: 0.5 });
  check("...and not for words without “Hey AURA”", awake() === shown);
  check("...it only shows the sign: nothing is done until the whole sentence is heard", commands(t.sent).length === 2);
  h.say({ type: "heard", text: "hey aura start recording", conf: 0.9 });
  h.say({ type: "heard", text: "hey aura stop recording", conf: 0.9 });
  check("recording is started and stopped by AURA itself", JSON.stringify(t.record) === JSON.stringify(["start", "stop"]));
  h.say({ type: "heard", text: "hey aura show the bar", conf: 0.9 });
  check("“show the bar” shows the AURA Bar", t.bar.length === 1);
  h.say({ type: "heard", text: "hey aura open library", conf: 0.9 });
  check("“open library” goes to the window", commands(t.sent).at(-1).action === "open" && commands(t.sent).at(-1).detail === "library");
  h.say({ type: "heard", text: "hey aura format my drive", conf: 0.99 });
  check("anything else does nothing", commands(t.sent).at(-1).detail === "library");
  h.stdout.emit("data", "not json\n{broken\n");
  check("output that isn't a message is ignored", (await t.call("voice:get")).state === "listening");

  console.log("3. Your games");
  r = await t.call("voice:games", ["Halo™: Infinite", "Pokémon Legends", "Rock & Roll Racing", "Next", "x", 42, "Halo: Infinite"]);
  check("game names become words you can say", JSON.stringify([...t.v.games.keys()]) === JSON.stringify(["halo infinite", "pokemon legends", "rock and roll racing"]), [...t.v.games.keys()]);
  check("...and the helper gets the new list", h.asked.at(-1).cmd === "phrases" && h.asked.at(-1).phrases.includes("hey aura launch halo infinite"));
  const before = h.asked.length;
  await t.call("voice:games", ["Halo™: Infinite", "Pokémon Legends", "Rock & Roll Racing"]);
  check("the same list isn't sent twice", h.asked.length === before);
  h.say({ type: "heard", text: "hey aura launch pokemon legends", conf: 0.85 });
  check("“launch Pokémon Legends” starts it, by its real name", commands(t.sent).at(-1).action === "launch" && commands(t.sent).at(-1).detail === "Pokémon Legends");
  const n = commands(t.sent).length;
  h.say({ type: "heard", text: "hey aura launch halo infinite", conf: 0.65 });
  check("starting a game needs Windows to be more sure", commands(t.sent).length === n);
  h.say({ type: "heard", text: "hey aura launch minecraft", conf: 0.95 });
  check("a game that isn't in your library isn't started", commands(t.sent).length === n);
  r = await t.call("voice:games", Array.from({ length: 900 }, (_x, i) => "Game number " + i));
  check("at most 500 games are listened for", r.count === 500);

  console.log("3b. Every page, calls and messages (Added by aura-voice-more-setup.cjs)");
  const pages = ["home", "library", "recent", "favorites", "streams", "social", "messages", "clips", "media", "sessions", "performance", "achievements", "customize", "settings"];
  check("every page on the left can be opened: “open …” and “go to …”", pages.every((pg) => Object.entries(voice.COMMANDS).some(([k, [a, d]]) => a === "open" && d === pg && k.startsWith("open ")) && Object.entries(voice.COMMANDS).some(([k, [a, d]]) => a === "open" && d === pg && k.startsWith("go to "))));
  h.say({ type: "heard", text: "hey aura go to recently played", conf: 0.9 });
  check("“go to recently played” opens it", commands(t.sent).at(-1).action === "open" && commands(t.sent).at(-1).detail === "recent");
  r = await t.call("voice:friends", ["JordanK", "SniperKing_99", "x", "next", null, "JordanK"]);
  check("friends' names become words you can say", JSON.stringify([...t.v.friends.keys()]) === JSON.stringify(["jordan k", "sniper king 99"]), [...t.v.friends.keys()]);
  check("...and the helper hears “call …” and “message …” for them", h.asked.at(-1).cmd === "phrases" && h.asked.at(-1).phrases.includes("hey aura call sniper king 99") && h.asked.at(-1).phrases.includes("hey aura message jordan k") && h.asked.at(-1).phrases.includes("hey aura launch pokemon legends") === false);
  h.say({ type: "heard", text: "hey aura call jordan k", conf: 0.8 });
  check("“call Jordan K” calls JordanK, by their username", commands(t.sent).at(-1).action === "call" && commands(t.sent).at(-1).detail === "start" && commands(t.sent).at(-1).who === "JordanK");
  const nCalls = commands(t.sent).length;
  h.say({ type: "heard", text: "hey aura call sniper king 99", conf: 0.65 });
  h.say({ type: "heard", text: "hey aura call somebody", conf: 0.95 });
  check("calling needs Windows to be sure, and only friends can be called", commands(t.sent).length === nCalls);
  for (const [said, detail] of [["hang up", "hangup"], ["answer", "answer"], ["decline", "decline"], ["mute my mic", "mute"], ["unmute my mic", "unmute"]]) h.say({ type: "heard", text: "hey aura " + said, conf: 0.9 });
  check("answer, decline, hang up, mute my mic, unmute my mic", JSON.stringify(commands(t.sent).slice(-5).map((c) => c.detail)) === JSON.stringify(["hangup", "answer", "decline", "mute", "unmute"]));

  console.log("3c. Typing a message by voice");
  t = setup({ quietMs: 120 }); await t.call("voice:set", true); h = t.spawnFn.runs[0]; h.say({ type: "ready", text: "en-US", conf: 1 });
  await t.call("voice:friends", ["JordanK"]);
  h.say({ type: "heard", text: "hey aura what's up", conf: 0.9, g: "dictation" });
  check("free speech does nothing unless you're typing a message", commands(t.sent).length === 0);
  h.say({ type: "heard", text: "hey aura message jordan k", conf: 0.85, g: "aura" });
  check("“message Jordan K” opens the chat and starts typing", commands(t.sent).at(-1).action === "message" && commands(t.sent).at(-1).who === "JordanK" && h.asked.at(-1).cmd === "typing" && h.asked.at(-1).on === true && JSON.stringify(h.asked.at(-1).phrases) === JSON.stringify([...voice.SEND, ...voice.CANCEL]));
  check("...and the window shows it's typing", t.sent.some(([c, d]) => c === "voice-status" && d.state === "typing"));
  h.say({ type: "heard", text: "You on tonight for some ranked?", conf: 0.42, g: "dictation" });
  check("what you say goes to the message box as you said it", commands(t.sent).at(-1).action === "type" && commands(t.sent).at(-1).detail === "text" && commands(t.sent).at(-1).text === "You on tonight for some ranked?");
  h.say({ type: "heard", text: "next song", conf: 0.95, g: "aura" });
  check("...commands don't work while typing (so “next song” can be part of a message)", commands(t.sent).at(-1).detail === "text");
  h.say({ type: "heard", text: "send", conf: 0.9, g: "aura" });
  check("“send” sends it and goes back to commands", commands(t.sent).at(-1).detail === "send" && h.asked.at(-1).cmd === "typing" && h.asked.at(-1).on === false);
  h.say({ type: "heard", text: "you there", conf: 0.9, g: "dictation" });
  check("...after which free speech does nothing again", commands(t.sent).at(-1).detail === "send");
  h.say({ type: "heard", text: "hey aura start typing", conf: 0.9 });
  h.say({ type: "heard", text: "cancel", conf: 0.9, g: "aura" });
  check("“start typing”, then “cancel”", commands(t.sent).at(-1).detail === "cancel" && h.asked.at(-1).on === false);
  h.say({ type: "heard", text: "hey aura start typing", conf: 0.9 });
  await new Promise((r) => setTimeout(r, 300));
  check("20 quiet seconds stop typing (and nothing is sent)", commands(t.sent).at(-1).detail === "stop" && h.asked.at(-1).on === false);

  console.log("4. Media keys, and problems");
  check("Windows media keys: only the six known ones", (await t.call("voice:key", "next")).success && h.asked.at(-1).key === "next" && !(await t.call("voice:key", "calc")).success);
  h.say({ type: "error", text: "no-english", conf: 0 });
  let st = await t.call("voice:get");
  check("no English speech recognition: it says how to add it, and stops", st.state === "error" && /English \(United States\)/.test(st.error) && h.killed);
  check("...media keys don't go anywhere while it's off", !(await t.call("voice:key", "next")).success);
  t = setup(); await t.call("voice:set", true); h = t.spawnFn.runs[0];
  h.say({ type: "error", text: "No audio input device is available", conf: 0 });
  check("no microphone: it says what to check", /microphone/i.test((await t.call("voice:get")).error));
  t = setup(); await t.call("voice:set", true); h = t.spawnFn.runs[0]; h.say({ type: "ready", text: "en-US", conf: 1 });
  h.emit("exit", 1);
  st = await t.call("voice:get");
  check("if the helper stops, AURA says so", st.state === "error" && /off and on/.test(st.error));

  console.log("5. The Windows helper");
  const s = voice.SCRIPT;
  check("it uses Windows' own speech recognition, on this PC", /System\.Speech/.test(s) && /SpeechRecognitionEngine/.test(s) && /SetInputToDefaultAudioDevice/.test(s));
  check("it never reaches the internet or runs other programs", !/Invoke-WebRequest|Invoke-RestMethod|Net\.WebClient|HttpClient|Start-Process|Invoke-Expression|\biex\b/i.test(s));
  check("it only knows the phrases AURA gives it", /new Choices\(\)/.test(s) && /choices\.Add\(typing && control\.Length > 0 \? control : phrases\)/.test(s));
  check("...and free speech only while you type a message by voice", /if \(typing\) rec\.LoadGrammar\(new DictationGrammar\(\)/.test(s) && (s.match(/DictationGrammar/g) || []).length === 1);
  check("media keys are a fixed list", /case "next": vk = 0xB0/.test(s) && /default: return;/.test(s));
  const policy = (() => { try { return fs.readFileSync(path.join(ROOT, "PRIVACY.md"), "utf8"); } catch { return ""; } })();
  if (policy) check("the privacy policy says how voice commands work", /## Voice commands/.test(policy) && /isn't recorded, saved or sent anywhere/.test(policy));
  if (policy) check("...including typing messages by voice", /When you type a message by voice/.test(policy) && /only sent when you say “send” or press Enter/.test(policy));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
