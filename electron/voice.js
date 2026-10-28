// AURA — voice commands: "Hey AURA, next song". Runs in the main process. The window reaches it
// through preload.js (window.electronAPI.voice*), and Settings > Voice Commands switches it on.
//
// Off unless you switch it on. While on, a small PowerShell helper listens to the microphone with
// the speech recognition built into Windows (System.Speech). It only knows AURA's own phrases and
// the names of the games in your library, so it can't take any other command. Nothing is recorded,
// saved or sent anywhere, and nothing is downloaded or installed. On Linux and Mac this does nothing.
//
// Added by aura-voice-setup.cjs. Wired up from the main file with one line:
//   const voice = require("./voice").create({ app, ipcMain, getWindow: () => mainWin, onRecord: (a) => ..., onBar: () => toggleBar() });
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const WAKE = "hey aura";
const AWAKE_MS = 6000;     // after "Hey AURA" on its own, a command is heard for this long
const SURE = 0.6;          // how sure Windows must be about what it heard (0 to 1)
const SURE_LAUNCH = 0.7;   // ...and for starting a game
const MAX_GAMES = 500;

// What you can say after "Hey AURA". [action, detail]
const COMMANDS = {
  "next": ["media", "next"], "next song": ["media", "next"], "next track": ["media", "next"], "skip": ["media", "next"], "skip song": ["media", "next"],
  "previous": ["media", "prev"], "previous song": ["media", "prev"], "previous track": ["media", "prev"], "go back": ["media", "prev"],
  "pause": ["media", "pause"], "pause music": ["media", "pause"], "stop music": ["media", "pause"],
  "play": ["media", "play"], "play music": ["media", "play"], "resume": ["media", "play"], "resume music": ["media", "play"],
  "volume up": ["media", "up"], "louder": ["media", "up"], "turn it up": ["media", "up"],
  "volume down": ["media", "down"], "quieter": ["media", "down"], "turn it down": ["media", "down"],
  "mute": ["media", "mute"], "unmute": ["media", "unmute"],
  "start recording": ["record", "start"], "record": ["record", "start"], "stop recording": ["record", "stop"],
  "show the bar": ["bar", "toggle"], "hide the bar": ["bar", "toggle"],
  "open home": ["open", "home"], "go home": ["open", "home"],
  "open library": ["open", "library"], "show library": ["open", "library"],
  "open clips": ["open", "clips"], "open media": ["open", "media"], "open messages": ["open", "messages"],
  "open settings": ["open", "settings"],
};
// Windows media keys, for when AURA's own player has nothing loaded (Spotify, a browser, ...)
const KEYS = ["next", "prev", "playpause", "up", "down", "mute"];

// A game's name the way it's said: "Halo™: Infinite" → "halo infinite"
function spoken(title) {
  if (typeof title !== "string") return "";
  const s = title.replace(/[™®©]/g, "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
  return s.length >= 2 && s.length <= 60 && /[a-z]/.test(s) ? s : "";
}
// Everything the helper listens for
function phrases(games) {
  const said = [...Object.keys(COMMANDS), ...[...games.keys()].map((g) => "launch " + g)];
  return [WAKE, ...said, ...said.map((p) => WAKE + " " + p)];
}
// What a heard phrase means. state.awakeUntil is when a command without "Hey AURA" stops counting.
function interpret(text, conf, state, games, now = Date.now()) {
  const t = typeof text === "string" ? text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim() : "";
  if (!t || !(conf >= SURE)) return null;
  if (t === WAKE) { state.awakeUntil = now + AWAKE_MS; return { kind: "wake" }; }
  let said;
  if (t.startsWith(WAKE + " ")) said = t.slice(WAKE.length + 1);
  else if (now < (state.awakeUntil || 0)) said = t;
  else return null; // without "Hey AURA" first, nothing happens
  state.awakeUntil = 0;
  if (COMMANDS[said]) { const [action, detail] = COMMANDS[said]; return { kind: "command", action, detail, said }; }
  if (said.startsWith("launch ") && conf >= SURE_LAUNCH && games.has(said.slice(7))) return { kind: "command", action: "launch", detail: games.get(said.slice(7)), said };
  return null;
}

// ── The PowerShell helper ─────────────────────────────────────────────────────
const SCRIPT = `
# AURA: voice commands. Listens with Windows' own speech recognition for AURA's phrases only.
# (Written by AURA from electron/voice.js. Added by aura-voice-setup.cjs)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$code = @'
using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Speech.Recognition;
using System.Text;

namespace AuraVoice
{
    public static class Engine
    {
        static SpeechRecognitionEngine rec;
        static string[] phrases = new string[0];
        static readonly object gate = new object();

        static string Esc(string s)
        {
            var b = new StringBuilder();
            foreach (char c in s ?? "")
            {
                if (c == '"' || c == '\\\\') b.Append('\\\\').Append(c);
                else if (c < ' ') b.Append(' ');
                else if (c > '~') b.AppendFormat("\\\\u{0:x4}", (int)c);
                else b.Append(c);
            }
            return b.ToString();
        }

        public static void Emit(string type, string text, double conf)
        {
            string line = "{\\"type\\":\\"" + Esc(type) + "\\",\\"text\\":\\"" + Esc(text) + "\\",\\"conf\\":" + conf.ToString("0.###", CultureInfo.InvariantCulture) + "}";
            lock (gate) { Console.Out.WriteLine(line); Console.Out.Flush(); }
        }

        static void Load()
        {
            rec.UnloadAllGrammars();
            var choices = new Choices();
            choices.Add(phrases);
            rec.LoadGrammar(new Grammar(new GrammarBuilder(choices)) { Name = "aura" });
        }

        // Returns the language it listens in, or "" when this PC has no English speech recognition
        public static string Start(string[] said)
        {
            RecognizerInfo pick = null;
            foreach (RecognizerInfo r in SpeechRecognitionEngine.InstalledRecognizers())
            {
                if (r.Culture.Name == "en-US") { pick = r; break; }
                if (pick == null && r.Culture.TwoLetterISOLanguageName == "en") pick = r;
            }
            if (pick == null) return "";
            phrases = said;
            rec = new SpeechRecognitionEngine(pick);
            rec.SetInputToDefaultAudioDevice();
            Load();
            rec.SpeechRecognized += (s, e) => Emit("heard", e.Result.Text, e.Result.Confidence);
            rec.RecognizerUpdateReached += (s, e) => { try { Load(); } catch (Exception x) { Emit("error", x.Message, 0); } };
            rec.RecognizeAsync(RecognizeMode.Multiple);
            return pick.Culture.Name;
        }

        // A new list (your library changed): swapped in between two things you say
        public static void SetPhrases(string[] said)
        {
            phrases = said;
            if (rec != null) rec.RequestRecognizerUpdate();
        }

        [DllImport("user32.dll")]
        static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

        public static void Key(string name)
        {
            byte vk;
            switch (name)
            {
                case "next": vk = 0xB0; break;
                case "prev": vk = 0xB1; break;
                case "playpause": vk = 0xB3; break;
                case "mute": vk = 0xAD; break;
                case "down": vk = 0xAE; break;
                case "up": vk = 0xAF; break;
                default: return;
            }
            keybd_event(vk, 0, 0, UIntPtr.Zero);
            keybd_event(vk, 0, 2, UIntPtr.Zero);
        }

        public static void Stop()
        {
            if (rec == null) return;
            try { rec.RecognizeAsyncCancel(); } catch { }
            rec.Dispose();
            rec = null;
        }
    }
}
'@
try {
  Add-Type -AssemblyName System.Speech
  Add-Type -TypeDefinition $code -Language CSharp -ReferencedAssemblies ([System.Speech.Recognition.SpeechRecognitionEngine].Assembly.Location)
} catch {
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject @{ type = 'error'; text = ('start: ' + $_.Exception.Message); conf = 0 } -Compress)); [Console]::Out.Flush()
  exit 1
}
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  if (-not $line.Trim()) { continue }
  try {
    $req = ConvertFrom-Json $line
    switch ([string]$req.cmd) {
      'start' {
        $lang = [AuraVoice.Engine]::Start([string[]]@($req.phrases))
        if ($lang) { [AuraVoice.Engine]::Emit('ready', $lang, 1) } else { [AuraVoice.Engine]::Emit('error', 'no-english', 0) }
      }
      'phrases' { [AuraVoice.Engine]::SetPhrases([string[]]@($req.phrases)) }
      'key' { [AuraVoice.Engine]::Key([string]$req.key) }
    }
  } catch {
    [AuraVoice.Engine]::Emit('error', $_.Exception.Message, 0)
  }
}
[AuraVoice.Engine]::Stop()
`;

// What went wrong, in words
function explain(text) {
  const t = String(text || "");
  if (t === "no-english") return "Voice commands need English speech recognition, which isn't on this PC. In Windows Settings > Time & language > Language & region, add English (United States) with Speech recognition.";
  if (/audio|device|microphone|input/i.test(t)) return "AURA couldn't use your microphone. Check it's plugged in and set as the default mic, and that Windows Settings > Privacy & security > Microphone lets desktop apps use it. Then switch voice commands off and on.";
  if (/^start:/.test(t)) return "Windows speech recognition couldn't start on this PC.";
  return "Voice commands stopped: " + t.slice(0, 200);
}

// ── Voice commands ────────────────────────────────────────────────────────────
function create({ app, ipcMain, getWindow = () => null, onRecord = () => {}, onBar = () => {}, platform = process.platform, spawnFn = spawn, prefsFile, helperFile, now = () => Date.now() } = {}) {
  const windows = platform === "win32";
  const dataDir = () => { try { return app.getPath("userData"); } catch { return null; } };
  const prefsPath = () => prefsFile || (dataDir() ? path.join(dataDir(), "aura-voice.json") : null);
  const scriptPath = () => helperFile || (dataDir() ? path.join(dataDir(), "aura-voice.ps1") : null);
  let prefs = { enabled: false };
  try { const p = JSON.parse(fs.readFileSync(prefsPath(), "utf8")); prefs = { enabled: p && p.enabled === true }; } catch {}
  const save = () => { try { fs.writeFileSync(prefsPath(), JSON.stringify(prefs)); } catch {} };

  let proc = null, buffer = "", state = "off", error = "", lang = "";
  const heard = { awakeUntil: 0 };
  let games = new Map();
  const status = () => ({ supported: windows, enabled: prefs.enabled, state, error, language: lang });
  const tell = (channel, data) => { try { const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send(channel, data); } catch {} };
  const setState = (s, e = "") => { state = s; error = e; tell("voice-status", status()); };
  const send = (msg) => { try { proc?.stdin.write(JSON.stringify(msg) + "\n"); } catch {} };

  function act(m) {
    if (m.kind === "wake") { tell("voice-status", { ...status(), state: "awake" }); return; }
    tell("voice-status", status()); // back to listening
    if (m.action === "record") { try { onRecord(m.detail); } catch {} }
    else if (m.action === "bar") { try { onBar(); } catch {} }
    tell("voice-command", { action: m.action, detail: m.detail, said: m.said });
  }

  function start() {
    if (!windows || proc) return;
    const file = scriptPath();
    try { if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== SCRIPT) fs.writeFileSync(file, SCRIPT, "utf8"); }
    catch { return setState("error", "AURA couldn't write its voice helper to its data folder."); }
    setState("starting");
    let me;
    try { me = proc = spawnFn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file], { windowsHide: true }); }
    catch (e) { proc = null; return setState("error", explain("start: " + (e?.message || e))); }
    buffer = "";
    me.stdout.setEncoding?.("utf8");
    me.stdout.on("data", (d) => {
      if (proc !== me) return;
      buffer += d;
      if (buffer.length > 65536) buffer = "";
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (!line.startsWith("{")) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.type === "ready") { lang = String(msg.text || "").slice(0, 20); setState("listening"); }
        else if (msg.type === "error") { const e = explain(msg.text); stop(); setState("error", e); return; }
        else if (msg.type === "heard" && state === "listening") { const m = interpret(msg.text, Number(msg.conf), heard, games, now()); if (m) act(m); }
      }
    });
    me.stderr?.on?.("data", () => {});
    const gone = () => { if (proc !== me) return; proc = null; if (prefs.enabled) setState("error", "Voice commands stopped. Switch them off and on to try again."); };
    me.on("error", gone);
    me.on("exit", gone);
    send({ cmd: "start", phrases: phrases(games) });
  }
  function stop() {
    const me = proc;
    proc = null; buffer = ""; heard.awakeUntil = 0;
    if (me) { try { me.stdin.end(); } catch {} try { me.kill(); } catch {} }
  }
  function setEnabled(on) {
    prefs.enabled = on === true && windows;
    save();
    if (prefs.enabled) start(); else { stop(); setState("off"); }
    return status();
  }
  function setGames(titles) {
    const next = new Map();
    for (const t of Array.isArray(titles) ? titles.slice(0, 2000) : []) {
      const s = spoken(t);
      if (s && !next.has(s) && !COMMANDS[s]) next.set(s, String(t).slice(0, 200));
      if (next.size >= MAX_GAMES) break;
    }
    const same = next.size === games.size && [...next].every(([k, v]) => games.get(k) === v);
    games = next;
    if (!same && proc) send({ cmd: "phrases", phrases: phrases(games) });
    return games.size;
  }

  if (ipcMain) {
    ipcMain.handle("voice:get", () => ({ success: true, ...status(), commands: Object.keys(COMMANDS) }));
    ipcMain.handle("voice:set", (_e, on) => ({ success: true, ...setEnabled(on === true) }));
    ipcMain.handle("voice:games", (_e, titles) => ({ success: true, count: setGames(titles) }));
    ipcMain.handle("voice:key", (_e, key) => {
      if (!KEYS.includes(key)) return { success: false, error: "That isn't a media key." };
      if (!proc || state !== "listening") return { success: false, error: "Voice commands are off." };
      send({ cmd: "key", key });
      return { success: true };
    });
  }
  if (windows && prefs.enabled) { if (app?.whenReady) app.whenReady().then(start).catch(() => {}); else start(); }
  if (app?.on) app.on("will-quit", stop);

  return { start, stop, setEnabled, setGames, status, get games() { return games; } };
}

module.exports = { create, interpret, phrases, spoken, explain, COMMANDS, KEYS, SCRIPT, WAKE, AWAKE_MS };
