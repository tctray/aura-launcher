// Choosing sound devices (electron/sounddevices.js): names, switching, favourites, Quick Switch,
// the shortcut, switching to the headset while a game runs, and the PowerShell helper's messages.
// Uses a pretend Windows (no real sound devices are touched).
// Added by aura-sound-devices-setup.cjs.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { create, helperClient, label, SCRIPT } = require(path.resolve(process.argv[2] || path.join(__dirname, "..", "electron", "sounddevices.js")));
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const id = (n) => `{0.0.${n < 10 ? 0 : 1}.00000000}.{${String(n).padStart(8, "0")}-0000-0000-0000-000000000000}`;

// Your devices, as Windows describes them
const OUT = { arctis: id(1), ihtb: id(2), me6s: id(3), h27: id(4) };
const IN = { arctis: id(11), hyperx: id(12), voicemod: id(13) };
function pretendWindows() {
  const w = {
    devices: [
      { id: OUT.arctis, flow: "out", desc: "Headphones", iface: "Arctis Nova 7 Gen 2", volume: 0.72, muted: false },
      { id: OUT.ihtb, flow: "out", desc: "Headphones", iface: "IHTB138", volume: 0.5, muted: false },
      { id: OUT.me6s, flow: "out", desc: "Speakers", iface: "ME6S", volume: 1, muted: false },
      { id: OUT.h27, flow: "out", desc: "H27T27", iface: "NVIDIA High Definition Audio", volume: 1, muted: false },
      { id: IN.arctis, flow: "in", desc: "Microphone", iface: "Arctis Nova 7 Gen 2", volume: 0.85, muted: false },
      { id: IN.hyperx, flow: "in", desc: "Microphone", iface: "HyperX Cloud Alpha S Chat", volume: 0.6, muted: false },
      { id: IN.voicemod, flow: "in", desc: "Microphone", iface: "Voicemod", volume: 1, muted: false },
    ],
    out: OUT.ihtb, mic: IN.hyperx, comms: OUT.me6s, asked: [],
  };
  w.helper = {
    async request(cmd, args = {}) {
      w.asked.push([cmd, args.device || "", args.value]);
      if (cmd === "list") return w.devices.map((d) => ({ ...d, isDefault: d.id === (d.flow === "out" ? w.out : w.mic), isComms: d.id === w.comms }));
      const d = w.devices.find((x) => x.id === args.device);
      if (!d) throw new Error("That device isn't connected.");
      if (cmd === "use") { if (d.flow === "out") { w.out = d.id; w.comms = d.id; } else w.mic = d.id; }
      if (cmd === "volume") d.volume = args.value;
      if (cmd === "mute") d.muted = args.value;
      return null;
    },
  };
  return w;
}
function world({ platform = "win32", taken = false } = {}) {
  const w = pretendWindows();
  const handlers = {}, keys = new Map(), sent = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-sound-"));
  w.keys = keys; w.sent = sent; w.changes = 0;
  w.mod = create({
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    globalShortcut: { register: (k, fn) => { if (taken) return false; keys.set(k, fn); return true; }, unregister: (k) => keys.delete(k) },
    getWindow: () => ({ isDestroyed: () => false, webContents: { send: (ch, d) => sent.push([ch, d]) } }),
    onChange: () => { w.changes++; },
    openExternal: (u) => { w.opened = u; },
    platform, helper: w.helper, prefsFile: path.join(dir, "aura-sound.json"),
  });
  w.call = (ch, ...args) => handlers["sound:" + ch](null, ...args);
  w.file = path.join(dir, "aura-sound.json");
  return w;
}

(async () => {
  console.log("1. Names");
  check("\"Headphones\" from Arctis shows as Arctis Nova 7 Gen 2, with Headphones under it", JSON.stringify(label({ desc: "Headphones", iface: "Arctis Nova 7 Gen 2" })) === '{"name":"Arctis Nova 7 Gen 2","detail":"Headphones"}');
  check("a monitor keeps its own name, with the graphics card under it", JSON.stringify(label({ desc: "H27T27", iface: "NVIDIA High Definition Audio" })) === '{"name":"H27T27","detail":"NVIDIA High Definition Audio"}');
  check("Stereo Mix stays Stereo Mix", label({ desc: "Stereo Mix", iface: "Realtek(R) Audio" }).name === "Stereo Mix");
  check("a device with no details still gets a name", label({}).name === "Sound device");

  console.log("2. Listing and switching");
  let w = world();
  let r = await w.call("list");
  check("lists what you hear and your mics", r.success && r.supported && r.outputs.length === 4 && r.inputs.length === 3, r);
  check("...saying which is in use and how loud it is", r.outputs.find((d) => d.inUse).id === OUT.ihtb && r.inputs.find((d) => d.inUse).name === "HyperX Cloud Alpha S Chat" && r.outputs[0].volume === 0.72);
  r = await w.call("use", OUT.arctis);
  check("choosing a device switches Windows to it (calls too) and answers with the new list", r.success && w.out === OUT.arctis && w.comms === OUT.arctis && r.outputs.find((d) => d.inUse).id === OUT.arctis);
  check("...and the Settings page and the bar are told", w.sent.some(([ch]) => ch === "sound-changed") && w.changes > 0);
  const asked = w.asked.length;
  r = await w.call("use", "C:\\Windows\\evil.exe");
  check("something that isn't a device is refused before Windows is asked", !r.success && /isn't a sound device/.test(r.error) && w.asked.length === asked);
  r = await w.call("use", id(99));
  check("a device that was unplugged: Windows' reason is passed on", !r.success && /isn't connected/.test(r.error));
  r = await w.call("volume", OUT.arctis, 0.4);
  check("volume", r.success && w.devices[0].volume === 0.4);
  check("...only between 0 and 100%", !(await w.call("volume", OUT.arctis, 7)).success && !(await w.call("volume", OUT.arctis, "loud")).success);
  r = await w.call("mute", IN.arctis, true);
  check("mute", r.success && w.devices.find((d) => d.id === IN.arctis).muted === true);
  await w.call("open-windows");
  check("Open goes to Windows' own sound settings", w.opened === "ms-settings:sound");

  console.log("3. Favourites and Quick Switch");
  w = world();
  r = await w.call("quick");
  check("with no favourites, it says to star some", !r.success && /Star one or two devices/.test(r.error));
  check("the shortcut isn't taken until there are favourites", w.keys.size === 0);
  r = await w.call("prefs", { favs: [{ output: OUT.arctis, outputName: "Arctis Nova 7 Gen 2", input: IN.arctis, inputName: "Arctis Nova 7 Gen 2" }, { output: OUT.me6s, outputName: "ME6S", input: IN.hyperx, inputName: "HyperX" }] });
  check("two favourites are saved", r.success && r.prefs.favs.length === 2 && JSON.parse(fs.readFileSync(w.file, "utf8")).favs[1].output === OUT.me6s);
  check("...and Ctrl + Alt + S is taken", w.keys.has("Control+Alt+S"));
  r = await w.call("quick");
  check("Quick Switch from another device goes to the first favourite, with its mic", r.success && r.name === "Arctis Nova 7 Gen 2" && w.out === OUT.arctis && w.mic === IN.arctis, [r, w.out, w.mic]);
  await w.keys.get("Control+Alt+S")(); await tick();
  check("the shortcut flips to the other one, mic too", w.out === OUT.me6s && w.mic === IN.hyperx);
  r = await w.call("quick");
  check("...and back", r.success && w.out === OUT.arctis);
  w.devices = w.devices.filter((d) => d.id !== OUT.me6s);
  r = await w.call("quick");
  check("a favourite that's unplugged is skipped", r.success && w.out === OUT.arctis);
  check("the bar button shows once there are favourites", w.mod.barInfo().show === true);
  await w.call("prefs", { bar: false, hotkey: false });
  check("...and can be turned off, like the shortcut", w.mod.barInfo().show === false && w.keys.size === 0);
  r = await w.call("prefs", { favs: [{ output: "nope" }, { output: OUT.arctis, outputName: "x".repeat(500), input: "bad" }, { output: OUT.ihtb }, { output: OUT.h27 }] });
  check("favourites from the window are checked: real devices only, at most two, names kept short", r.prefs.favs.length === 2 && r.prefs.favs[0].output === OUT.arctis && r.prefs.favs[0].input === null && r.prefs.favs[0].outputName.length === 120, r.prefs);
  w = world({ taken: true });
  r = await w.call("prefs", { favs: [{ output: OUT.arctis, outputName: "Arctis" }] });
  check("if another app has the shortcut, the page is told", r.hotkeyBusy === true && (await w.call("list")).hotkeyBusy === true);

  console.log("4. Your headset while you play");
  w = world();
  await w.call("prefs", { autoHeadset: true, favs: [{ output: OUT.arctis, outputName: "Arctis", input: IN.arctis, inputName: "Arctis" }] });
  await w.mod.gameStarted();
  check("a game starting switches to the headset, mic too", w.out === OUT.arctis && w.mic === IN.arctis);
  await w.mod.gameStarted(); await w.mod.gameEnded();
  check("...and stays while another game is still running", w.out === OUT.arctis);
  await w.mod.gameEnded();
  check("when the last game closes, it goes back to what you had", w.out === OUT.ihtb && w.mic === IN.hyperx, [w.out, w.mic]);
  await w.mod.gameStarted(); await w.call("use", OUT.h27); await w.mod.gameEnded();
  check("if you picked something else during the game, that's left alone", w.out === OUT.h27);
  await w.call("prefs", { autoHeadset: false });
  await w.mod.gameStarted(); await w.mod.gameEnded();
  check("switched off, games don't change anything", w.out === OUT.h27);

  console.log("5. Not on Windows");
  w = world({ platform: "linux" });
  r = await w.call("list");
  check("on Linux the page is told it isn't available, and Windows isn't asked", r.success && r.supported === false && w.asked.length === 0);
  check("...and nothing goes on the bar or the keyboard", w.mod.barInfo().show === false && w.keys.size === 0);

  console.log("6. The PowerShell helper");
  check("the script has the device switching and answers one line per request", /SetDefaultEndpoint/.test(SCRIPT) && /ReadLine\(\)/.test(SCRIPT) && /ConvertTo-Json/.test(SCRIPT));
  const spawned = [];
  const fakeSpawn = (cmd, args) => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter(); p.stdout.setEncoding = () => {};
    p.stderr = new EventEmitter();
    p.lines = [];
    p.stdin = { write: (line) => { const m = JSON.parse(line); p.lines.push(m); setTimeout(() => {
      if (m.cmd === "hang") return;
      if (m.cmd === "crash") { p.emit("exit", 1); return; }
      // Two answers in one piece, split oddly, with a stray line before them
      const a = JSON.stringify({ n: m.n, ok: m.cmd !== "bad", data: m.cmd === "list" ? [{ id: "x" }] : null, error: "Windows said no" });
      p.stdout.emit("data", "WARNING: something\r\n" + a.slice(0, 9)); p.stdout.emit("data", a.slice(9) + "\r\n");
    }, 5); }, end() {} };
    p.kill = () => p.emit("exit", 0);
    spawned.push({ cmd, args, p });
    setTimeout(() => p.stdout.emit("data", '{"n":0,"ok":true,"data":"ready"}\r\n'), 5);
    return p;
  };
  const scriptFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aura-sound-ps-")), "aura-sound.ps1");
  const h = helperClient({ file: scriptFile, spawnFn: fakeSpawn, timeoutMs: 300, idleMs: 200 });
  const [one, two] = await Promise.all([h.request("list"), h.request("use", { device: OUT.arctis })]);
  check("starts PowerShell once, hidden, with the script AURA wrote", spawned.length === 1 && spawned[0].cmd === "powershell.exe" && spawned[0].args.includes("-File") && fs.readFileSync(scriptFile, "utf8") === SCRIPT);
  check("answers are matched to their requests, even arriving in pieces", Array.isArray(one) && one[0].id === "x" && two === null);
  check("what's sent is the request as data (the device id never goes on a command line)", spawned[0].p.lines[1].device === OUT.arctis && !spawned[0].args.join(" ").includes(OUT.arctis));
  let e = ""; try { await h.request("bad"); } catch (x) { e = x.message; }
  check("Windows saying no comes back as the error", e === "Windows said no");
  e = ""; try { await h.request("hang"); } catch (x) { e = x.message; }
  check("no answer: gives up instead of waiting for ever", /didn't answer in time/.test(e));
  e = ""; try { await h.request("crash"); } catch (x) { e = x.message; }
  check("if the helper stops, AURA says so", /stopped/.test(e));
  await h.request("list");
  check("...and starts it again next time", spawned.length === 2);
  await tick(320);
  check("an idle helper is stopped, to save memory", spawned[1].p.listenerCount("exit") > 0 && (await h.request("list"), spawned.length === 3));
  h.stop();

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
