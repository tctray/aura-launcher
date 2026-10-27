// AURA — choosing sound devices on Windows (Settings > Sound devices, Quick Switch, the AURA bar).
// Runs in the main process. The window reaches it through preload.js (window.electronAPI.sound*).
//
// Windows has no command for "use these headphones", so AURA keeps a small PowerShell helper
// running (started the first time it's needed, stopped when it's idle) that talks to Windows'
// sound system directly, the same way the free SoundSwitch and EarTrumpet apps do. Nothing is
// downloaded or installed. On Linux and Mac this does nothing and the tab doesn't show.
//
// Added by aura-sound-devices-setup.cjs. Wired up from the main file with one line:
//   const soundDevices = require("./sounddevices").create({ app, ipcMain, globalShortcut, getWindow: () => mainWin, onChange: () => pushBarState(), openExternal: (u) => shell.openExternal(u) });
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const HOTKEY = "Control+Alt+S";
const HOTKEY_TEXT = "Ctrl + Alt + S";
const DEVICE_ID = /^\{[0-9.]{1,20}\}\.\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/i;
const isId = (id) => typeof id === "string" && DEVICE_ID.test(id);
const text = (s, max = 120) => (typeof s === "string" ? s.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");

// Windows calls most devices "Speakers" or "Headphones"; the hardware's own name tells them apart
const GENERIC = /^(speakers?|headphones?|headsets?|headset (earphone|microphone)|earphones?|microphones?|microphone array|line( in| out)?|digital (audio|output)( interface)?( \(s\/pdif\))?|s\/?pdif.*|realtek digital output|external mic(rophone)?|front mic|rear mic|mic in)$/i;
function label(d) {
  const desc = text(d.desc), iface = text(d.iface);
  if (!iface) return { name: desc || "Sound device", detail: "" };
  if (!desc || desc === iface) return { name: iface, detail: "" };
  return GENERIC.test(desc) ? { name: iface, detail: desc } : { name: desc, detail: iface };
}
function tidy(raw) {
  if (!raw || !isId(raw.id) || (raw.flow !== "out" && raw.flow !== "in")) return null;
  const { name, detail } = label(raw);
  const volume = typeof raw.volume === "number" && raw.volume >= 0 && raw.volume <= 1 ? raw.volume : null;
  return { id: raw.id, flow: raw.flow, name, detail, inUse: raw.isDefault === true, forCalls: raw.isComms === true, volume, muted: raw.muted === true };
}

// ── The PowerShell helper ─────────────────────────────────────────────────────
const SCRIPT = `
# AURA: switching sound devices on Windows. AURA starts this once and asks it things, one line each.
# (Written by AURA from electron/sounddevices.js. Added by aura-sound-devices-setup.cjs)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$code = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace AuraSound
{
    public class Device
    {
        public string Id;
        public string Flow;      // "out" (what you hear) or "in" (a mic)
        public string Desc;      // e.g. "Headphones"
        public string Iface;     // e.g. "Arctis Nova 7 Gen 2"
        public bool IsDefault;
        public bool IsComms;
        public double Volume = -1;
        public bool Muted;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PropertyKey
    {
        public Guid fmtid;
        public int pid;
        public PropertyKey(Guid g, int p) { fmtid = g; pid = p; }
    }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    struct PropVariant
    {
        [FieldOffset(0)] public short vt;
        [FieldOffset(8)] public IntPtr pointerValue;
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorComObject { }

    [ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
    class PolicyConfigClient { }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int Item(int index, out IMMDevice device);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore store);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
    }

    [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetAt(int index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int Commit();
    }

    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume
    {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int GetChannelCount(out int count);
        [PreserveSig] int SetMasterVolumeLevel(float levelDB, ref Guid context);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid context);
        [PreserveSig] int GetMasterVolumeLevel(out float levelDB);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(int channel, float levelDB, ref Guid context);
        [PreserveSig] int SetChannelVolumeLevelScalar(int channel, float level, ref Guid context);
        [PreserveSig] int GetChannelVolumeLevel(int channel, out float levelDB);
        [PreserveSig] int GetChannelVolumeLevelScalar(int channel, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
        [PreserveSig] int GetVolumeStepInfo(out int step, out int stepCount);
        [PreserveSig] int VolumeStepUp(ref Guid context);
        [PreserveSig] int VolumeStepDown(ref Guid context);
        [PreserveSig] int QueryHardwareSupport(out int mask);
        [PreserveSig] int GetVolumeRange(out float minDB, out float maxDB, out float incrementDB);
    }

    // Undocumented, but the same since Windows 7 (SoundSwitch and EarTrumpet use it too)
    [Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPolicyConfig
    {
        [PreserveSig] int GetMixFormat(IntPtr a, IntPtr b);
        [PreserveSig] int GetDeviceFormat(IntPtr a, int b, IntPtr c);
        [PreserveSig] int ResetDeviceFormat(IntPtr a);
        [PreserveSig] int SetDeviceFormat(IntPtr a, IntPtr b, IntPtr c);
        [PreserveSig] int GetProcessingPeriod(IntPtr a, int b, IntPtr c, IntPtr d);
        [PreserveSig] int SetProcessingPeriod(IntPtr a, IntPtr b);
        [PreserveSig] int GetShareMode(IntPtr a, IntPtr b);
        [PreserveSig] int SetShareMode(IntPtr a, IntPtr b);
        [PreserveSig] int GetPropertyValue(IntPtr a, IntPtr b, IntPtr c);
        [PreserveSig] int SetPropertyValue(IntPtr a, IntPtr b, IntPtr c);
        [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int role);
        [PreserveSig] int SetEndpointVisibility(IntPtr a, int b);
    }

    public static class Audio
    {
        const int ACTIVE = 1;
        const int CLSCTX_ALL = 23;
        static readonly Guid DEVICE = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");
        static readonly Guid IFACE = new Guid("026e516e-b814-414b-83cd-856d6fef4822");

        [DllImport("ole32.dll")]
        static extern int PropVariantClear(ref PropVariant pvar);

        static IMMDeviceEnumerator Enumerator()
        {
            return (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        }

        static void Check(int hr, string what)
        {
            if (hr != 0) throw new Exception(what + " failed (0x" + hr.ToString("X8") + ")");
        }

        static string Prop(IPropertyStore store, Guid g, int pid)
        {
            PropertyKey key = new PropertyKey(g, pid);
            PropVariant v;
            if (store.GetValue(ref key, out v) != 0) return "";
            string s = "";
            if (v.vt == 31 && v.pointerValue != IntPtr.Zero) s = Marshal.PtrToStringUni(v.pointerValue);
            PropVariantClear(ref v);
            return s ?? "";
        }

        static string DefaultId(IMMDeviceEnumerator en, int flow, int role)
        {
            IMMDevice d;
            if (en.GetDefaultAudioEndpoint(flow, role, out d) != 0 || d == null) return "";
            string id;
            return d.GetId(out id) == 0 ? id : "";
        }

        static IAudioEndpointVolume Volume(IMMDevice d)
        {
            Guid iid = typeof(IAudioEndpointVolume).GUID;
            object o;
            if (d.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out o) != 0 || o == null) return null;
            return o as IAudioEndpointVolume;
        }

        public static Device[] List()
        {
            IMMDeviceEnumerator en = Enumerator();
            List<Device> list = new List<Device>();
            for (int flow = 0; flow <= 1; flow++)
            {
                string def = DefaultId(en, flow, 0);   // what apps use
                string comms = DefaultId(en, flow, 2); // what calls use
                IMMDeviceCollection all;
                Check(en.EnumAudioEndpoints(flow, ACTIVE, out all), "Listing sound devices");
                int count;
                all.GetCount(out count);
                for (int i = 0; i < count; i++)
                {
                    IMMDevice d;
                    if (all.Item(i, out d) != 0 || d == null) continue;
                    Device x = new Device();
                    d.GetId(out x.Id);
                    x.Flow = flow == 0 ? "out" : "in";
                    IPropertyStore store;
                    if (d.OpenPropertyStore(0, out store) == 0 && store != null)
                    {
                        x.Desc = Prop(store, DEVICE, 2);
                        x.Iface = Prop(store, IFACE, 2);
                    }
                    x.IsDefault = x.Id == def;
                    x.IsComms = x.Id == comms;
                    IAudioEndpointVolume vol = Volume(d);
                    if (vol != null)
                    {
                        float level;
                        if (vol.GetMasterVolumeLevelScalar(out level) == 0) x.Volume = Math.Round(level, 3);
                        bool muted;
                        if (vol.GetMute(out muted) == 0) x.Muted = muted;
                    }
                    list.Add(x);
                }
            }
            return list.ToArray();
        }

        static IMMDevice Find(string id)
        {
            IMMDevice d;
            Check(Enumerator().GetDevice(id, out d), "Finding that device");
            if (d == null) throw new Exception("That device isn't connected.");
            return d;
        }

        // Makes a device the one Windows uses: for apps, for media, and for calls
        public static void SetDefault(string id)
        {
            Find(id);
            IPolicyConfig pc = (IPolicyConfig)new PolicyConfigClient();
            for (int role = 0; role <= 2; role++) Check(pc.SetDefaultEndpoint(id, role), "Switching device");
        }

        public static void SetVolume(string id, double level)
        {
            IAudioEndpointVolume vol = Volume(Find(id));
            if (vol == null) throw new Exception("That device has no volume control.");
            Guid ctx = Guid.Empty;
            float v = (float)Math.Max(0, Math.Min(1, level));
            Check(vol.SetMasterVolumeLevelScalar(v, ref ctx), "Setting the volume");
        }

        public static void SetMute(string id, bool mute)
        {
            IAudioEndpointVolume vol = Volume(Find(id));
            if (vol == null) throw new Exception("That device can't be muted.");
            Guid ctx = Guid.Empty;
            Check(vol.SetMute(mute, ref ctx), "Muting");
        }
    }
}

'@
function Send($obj) { [Console]::Out.WriteLine((ConvertTo-Json -InputObject $obj -Compress -Depth 5)); [Console]::Out.Flush() }
try { Add-Type -TypeDefinition $code -Language CSharp } catch { Send @{ n = 0; ok = $false; error = ("Windows sound control couldn't start: " + $_.Exception.Message) }; exit 1 }
Send @{ n = 0; ok = $true; data = 'ready' }
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  if (-not $line.Trim()) { continue }
  $n = 0
  try {
    $req = ConvertFrom-Json $line
    $n = [int]$req.n
    $data = $null
    switch ([string]$req.cmd) {
      'list' { $data = @([AuraSound.Audio]::List() | ForEach-Object { [ordered]@{ id = $_.Id; flow = $_.Flow; desc = $_.Desc; iface = $_.Iface; isDefault = $_.IsDefault; isComms = $_.IsComms; volume = $_.Volume; muted = $_.Muted } }) }
      'use' { [AuraSound.Audio]::SetDefault([string]$req.device) }
      'volume' { [AuraSound.Audio]::SetVolume([string]$req.device, [double]$req.value) }
      'mute' { [AuraSound.Audio]::SetMute([string]$req.device, [bool]$req.value) }
      default { throw ('Unknown request: ' + $req.cmd) }
    }
    Send @{ n = $n; ok = $true; data = $data }
  } catch {
    Send @{ n = $n; ok = $false; error = $_.Exception.Message }
  }
}
`;

function helperClient({ file, spawnFn = spawn, idleMs = 120000, timeoutMs = 20000 } = {}) {
  let proc = null, ready = null, buffer = "", n = 0, idle = null;
  const waiting = new Map();
  const failAll = (msg) => { for (const w of waiting.values()) { clearTimeout(w.timer); w.reject(new Error(msg)); } waiting.clear(); };
  const stop = () => {
    clearTimeout(idle);
    if (proc) { try { proc.stdin.end(); } catch {} try { proc.kill(); } catch {} }
    proc = null; ready = null; buffer = "";
  };
  const start = () => {
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
      try {
        if (file) { try { if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== SCRIPT) fs.writeFileSync(file, SCRIPT, "utf8"); } catch {} }
        proc = spawnFn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file], { windowsHide: true });
      } catch (e) { ready = null; return reject(new Error("Windows sound control couldn't start: " + (e?.message || e))); }
      const me = proc;
      waiting.set(0, { resolve: () => resolve(), reject: (e) => { ready = null; reject(e); }, timer: setTimeout(() => { waiting.delete(0); stop(); reject(new Error("Windows sound control took too long to start.")); }, timeoutMs) });
      me.stdout.setEncoding?.("utf8");
      me.stdout.on("data", (d) => {
        buffer += d;
        let i;
        while ((i = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, i).trim();
          buffer = buffer.slice(i + 1);
          if (!line.startsWith("{")) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          const w = waiting.get(Number(msg.n) || 0);
          if (!w) continue;
          waiting.delete(Number(msg.n) || 0);
          clearTimeout(w.timer);
          msg.ok ? w.resolve(msg.data) : w.reject(new Error(text(String(msg.error || "Windows said no."), 300)));
        }
      });
      me.stderr?.on?.("data", () => {});
      const gone = () => { if (proc === me) { proc = null; ready = null; buffer = ""; } failAll("Windows sound control stopped. Try again."); };
      me.on("error", gone);
      me.on("exit", gone);
    });
    return ready;
  };
  async function request(cmd, args = {}) {
    await start();
    clearTimeout(idle);
    const id = ++n;
    const answer = new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject, timer: setTimeout(() => { waiting.delete(id); reject(new Error("Windows didn't answer in time.")); }, timeoutMs) });
    });
    try { proc.stdin.write(JSON.stringify({ n: id, cmd, ...args }) + "\n"); }
    catch (e) { const w = waiting.get(id); waiting.delete(id); clearTimeout(w?.timer); throw new Error("Windows sound control stopped. Try again."); }
    try { return await answer; }
    finally { clearTimeout(idle); idle = setTimeout(stop, idleMs); idle.unref?.(); }
  }
  return { request, stop };
}

// ── Choosing devices ──────────────────────────────────────────────────────────
function create({ app, ipcMain, globalShortcut, getWindow = () => null, onChange = () => {}, openExternal = () => {}, platform = process.platform, helper, prefsFile } = {}) {
  const windows = platform === "win32";
  const file = prefsFile || (app ? path.join(app.getPath("userData"), "aura-sound.json") : null);
  const run = helper || (windows && app ? helperClient({ file: path.join(app.getPath("userData"), "aura-sound.ps1") }) : null);
  let prefs = { favs: [], hotkey: true, bar: true, autoHeadset: false };
  try { if (file) prefs = clean(JSON.parse(fs.readFileSync(file, "utf8"))); } catch {}
  let hotkeyOn = false, hotkeyBusy = false;
  let games = 0, before = null;

  function clean(p) {
    const favs = (Array.isArray(p?.favs) ? p.favs : []).filter((f) => f && isId(f.output)).slice(0, 2).map((f) => ({
      output: f.output, outputName: text(f.outputName) || "Sound device",
      input: isId(f.input) ? f.input : null, inputName: isId(f.input) ? text(f.inputName) || "Mic" : "",
    }));
    return { favs, hotkey: p?.hotkey !== false, bar: p?.bar !== false, autoHeadset: p?.autoHeadset === true };
  }
  const save = () => { try { if (file) fs.writeFileSync(file, JSON.stringify(prefs, null, 2)); } catch {} };
  const tell = (what) => { try { const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send("sound-changed", what || {}); } catch {} try { onChange(); } catch {} };

  async function devices() {
    const list = await run.request("list");
    const all = (Array.isArray(list) ? list : list ? [list] : []).map(tidy).filter(Boolean);
    return { outputs: all.filter((d) => d.flow === "out"), inputs: all.filter((d) => d.flow === "in") };
  }
  async function use(id) {
    if (!isId(id)) throw new Error("That isn't a sound device.");
    await run.request("use", { device: id });
  }

  // Ctrl + Alt + S flips between the two favourites
  function applyHotkey() {
    if (!globalShortcut) return;
    const want = windows && prefs.hotkey && prefs.favs.length > 0;
    if (want && !hotkeyOn) {
      try { hotkeyOn = globalShortcut.register(HOTKEY, () => { quickSwitch().catch(() => {}); }); } catch { hotkeyOn = false; }
      hotkeyBusy = !hotkeyOn;
    } else if (!want && hotkeyOn) {
      try { globalShortcut.unregister(HOTKEY); } catch {}
      hotkeyOn = false;
    }
    if (!want) hotkeyBusy = false;
  }

  async function switchTo(fav, now) {
    await use(fav.output);
    if (fav.input && now.inputs.some((d) => d.id === fav.input)) await use(fav.input);
  }

  async function quickSwitch() {
    if (!windows || !run) return { success: false, error: "Switching sound devices works on Windows only." };
    try {
      const now = await devices();
      const here = prefs.favs.filter((f) => now.outputs.some((d) => d.id === f.output));
      if (!prefs.favs.length) return { success: false, error: "Star one or two devices in Settings > Sound devices first." };
      if (!here.length) return { success: false, error: "Your favourite devices aren't connected." };
      const current = (now.outputs.find((d) => d.inUse) || {}).id;
      const i = here.findIndex((f) => f.output === current);
      const target = here.length > 1 && i >= 0 ? here[(i + 1) % here.length] : here[0];
      await switchTo(target, now);
      tell({ name: target.outputName });
      return { success: true, name: target.outputName };
    } catch (e) { return { success: false, error: e.message }; }
  }

  // Switching to the headset (the first favourite) while a game runs, and back afterwards
  async function gameStarted() {
    games++;
    if (games !== 1 || !windows || !run || !prefs.autoHeadset || !prefs.favs[0]) return;
    try {
      const now = await devices();
      const head = prefs.favs[0];
      if (!now.outputs.some((d) => d.id === head.output)) return;
      const out = (now.outputs.find((d) => d.inUse) || {}).id || null;
      const mic = (now.inputs.find((d) => d.inUse) || {}).id || null;
      if (out === head.output) return;
      before = { output: out, input: mic, head: head.output };
      await switchTo(head, now);
      tell({ name: head.outputName });
    } catch {}
  }
  async function gameEnded() {
    games = Math.max(0, games - 1);
    if (games !== 0 || !before) return;
    const back = before;
    before = null;
    try {
      const now = await devices();
      const current = (now.outputs.find((d) => d.inUse) || {}).id;
      if (current !== back.head) return; // you picked something else during the game: leave it
      if (back.output && now.outputs.some((d) => d.id === back.output)) await use(back.output);
      if (back.input && now.inputs.some((d) => d.id === back.input)) await use(back.input);
      tell({});
    } catch {}
  }

  const answer = (fn) => async (_e, ...args) => {
    try { return { success: true, ...(await fn(...args)) }; }
    catch (e) { return { success: false, error: e?.message || "Something went wrong." }; }
  };
  const listAll = async () => {
    if (!windows || !run) return { supported: false };
    return { supported: true, ...(await devices()), prefs, hotkey: HOTKEY_TEXT, hotkeyBusy };
  };
  if (ipcMain) {
    ipcMain.handle("sound:list", answer(listAll));
    ipcMain.handle("sound:use", answer(async (id) => { if (!windows || !run) return { supported: false }; await use(id); tell({}); return listAll(); }));
    ipcMain.handle("sound:volume", answer(async (id, value) => {
      if (!windows || !run) return { supported: false };
      if (!isId(id) || typeof value !== "number" || !(value >= 0 && value <= 1)) throw new Error("That isn't a volume.");
      await run.request("volume", { device: id, value }); return {};
    }));
    ipcMain.handle("sound:mute", answer(async (id, muted) => {
      if (!windows || !run) return { supported: false };
      if (!isId(id)) throw new Error("That isn't a sound device.");
      await run.request("mute", { device: id, value: muted === true }); return {};
    }));
    ipcMain.handle("sound:prefs", answer(async (patch) => {
      prefs = clean({ ...prefs, ...(patch && typeof patch === "object" ? patch : {}) });
      save(); applyHotkey(); try { onChange(); } catch {}
      return { prefs, hotkeyBusy };
    }));
    ipcMain.handle("sound:quick", () => quickSwitch());
    ipcMain.handle("sound:open-windows", () => { if (windows) openExternal("ms-settings:sound"); return { success: true }; });
  }
  if (app?.whenReady) app.whenReady().then(applyHotkey).catch(() => {}); else applyHotkey();
  if (app?.on) app.on("will-quit", () => { try { run?.stop?.(); } catch {} });

  return {
    quickSwitch, gameStarted, gameEnded, applyHotkey,
    barInfo: () => ({ show: windows && !!run && prefs.bar && prefs.favs.length > 0, hotkey: HOTKEY_TEXT }),
    get prefs() { return prefs; },
    get hotkeyBusy() { return hotkeyBusy; },
  };
}

module.exports = { create, helperClient, label, tidy, SCRIPT, HOTKEY };
