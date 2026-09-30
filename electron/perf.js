// electron/perf.js — AURA performance monitor (runs in the main process)
// Streams CPU, RAM, GPU, disk, network and FPS to the renderer once a second,
// and records per-session performance while a game launched from AURA is running.

const si = require("systeminformation");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { app, ipcMain, BrowserWindow } = require("electron");

const INTERVAL_MS = 1000;
const HISTORY_LEN = 60;

let timer = null;
let sampling = false;
let viewers = 0;
let tick = 0;
let history = [];
let gpuCache = null;
let drives = [];
let disk = { read: 0, write: 0, busy: null };
let diskProc = null;

const fps = { proc: null, exeName: null, frames: [], status: "no-game", gotFrames: false };
const sessions = new Map(); // exePath -> samples[]

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

// ── Disk throughput ───────────────────────────────────────────────────────────
// Windows: stream Performance Counters through typeperf (built in, no admin).
function startDisk() {
  if (process.platform !== "win32" || diskProc) return;
  diskProc = spawn("typeperf", [
    "\\PhysicalDisk(_Total)\\Disk Read Bytes/sec",
    "\\PhysicalDisk(_Total)\\Disk Write Bytes/sec",
    "\\PhysicalDisk(_Total)\\% Idle Time",
    "-si", "1",
  ], { windowsHide: true });

  let buf = "";
  diskProc.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const line of lines) {
      const cols = line.split('","').map((c) => c.replace(/"/g, ""));
      if (cols.length < 4) continue;
      const [r, w, idle] = cols.slice(1, 4).map(Number);
      if ([r, w, idle].some(Number.isNaN)) continue; // header row
      disk = { read: r, write: w, busy: clamp(100 - idle, 0, 100) };
    }
  });
  diskProc.on("error", () => { diskProc = null; });
  diskProc.on("exit", () => { diskProc = null; });
}

function stopDisk() {
  if (diskProc) { try { diskProc.kill(); } catch {} diskProc = null; }
}

// Linux / Steam Deck
async function linuxDisk() {
  try {
    const s = await si.fsStats();
    if (s) disk = { read: Math.max(0, s.rx_sec || 0), write: Math.max(0, s.wx_sec || 0), busy: null };
  } catch {}
}

// ── GPU + drives ──────────────────────────────────────────────────────────────
async function refreshGpu() {
  try {
    const g = await si.graphics();
    const c = g.controllers.find((x) => x.utilizationGpu != null);
    gpuCache = c ? {
      name: c.model,
      util: c.utilizationGpu,
      temp: c.temperatureGpu ?? null,
      vramUsed: c.memoryUsed ?? null,   // MB
      vramTotal: c.memoryTotal ?? null, // MB
    } : null;
  } catch { gpuCache = null; }
}

async function refreshDrives() {
  try {
    const list = await si.fsSize();
    const seen = new Set();
    drives = list
      .filter((d) => d.size > 1e9 && !seen.has(d.mount) && seen.add(d.mount))
      .map((d) => ({ mount: d.mount, size: d.size, used: d.used }));
  } catch { drives = []; }
}

// ── FPS via PresentMon (Windows only) ─────────────────────────────────────────
function presentMonPath() {
  if (process.platform !== "win32") return null;
  const candidates = [
    path.join(process.resourcesPath || "", "PresentMon.exe"),       // installed app
    path.join(app.getAppPath(), "resources", "PresentMon.exe"),     // npm run dev
    path.join(__dirname, "../../resources/PresentMon.exe"),         // same folder as ffmpeg.exe
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function startFps(exePath) {
  stopFps();
  if (process.platform !== "win32") { fps.status = "unsupported"; return; }
  const pm = presentMonPath();
  if (!pm) { fps.status = "missing"; return; }

  fps.exeName = path.basename(exePath);
  fps.frames = [];
  fps.gotFrames = false;
  fps.status = "waiting";

  const proc = spawn(pm, [
    "--process_name", fps.exeName,
    "--output_stdout",
    "--stop_existing_session",
  ], { windowsHide: true });
  fps.proc = proc;

  let buf = "";
  let col = -1;
  proc.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const line of lines) {
      const cols = line.split(",");
      if (col === -1) {
        for (const name of ["MsBetweenPresents", "FrameTime"]) {
          const i = cols.findIndex((c) => c.trim() === name);
          if (i !== -1) { col = i; break; }
        }
        continue;
      }
      const ms = parseFloat(cols[col]);
      if (ms > 0 && ms < 2000) {
        fps.frames.push(ms);
        fps.gotFrames = true;
        fps.status = "ok";
      }
    }
  });

  let errText = "";
  proc.stderr.on("data", (c) => { errText += c.toString(); });
  proc.on("error", () => { if (fps.proc === proc) { fps.proc = null; fps.status = "missing"; } });
  proc.on("exit", () => {
    if (fps.proc !== proc) return;
    fps.proc = null;
    if (!fps.gotFrames) {
      fps.status = /access|privilege|admin|denied|elevat/i.test(errText) ? "denied" : "error";
    }
  });
}

function stopFps() {
  if (fps.proc) { const p = fps.proc; fps.proc = null; try { p.kill(); } catch {} }
  fps.exeName = null;
  fps.frames = [];
  fps.status = "no-game";
}

function readFps() {
  const f = fps.frames;
  fps.frames = [];
  if (!f.length) return { fps: null, low: null };
  const avg = f.reduce((a, b) => a + b, 0) / f.length;
  const slowest = [...f].sort((a, b) => b - a);
  const p99 = slowest[Math.floor(slowest.length * 0.01)];
  return { fps: 1000 / avg, low: 1000 / p99 };
}

// ── Sampling loop ─────────────────────────────────────────────────────────────
async function sample() {
  tick++;
  if (tick % 3 === 1) refreshGpu(); // nvidia-smi is slow, poll every 3s
  if (process.platform !== "win32") await linuxDisk();

  const [load, mem, nets] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.networkStats().catch(() => []),
  ]);
  const net = (nets || []).reduce((a, n) => ({
    down: a.down + Math.max(0, n.rx_sec || 0),
    up: a.up + Math.max(0, n.tx_sec || 0),
  }), { down: 0, up: 0 });
  const f = readFps();

  const s = {
    t: Date.now(),
    cpu: load.currentLoad,
    ramUsed: mem.active,
    ramTotal: mem.total,
    gpu: gpuCache,
    diskRead: disk.read,
    diskWrite: disk.write,
    diskBusy: disk.busy,
    netDown: net.down, // bytes/sec
    netUp: net.up,
    fps: f.fps,
    fpsLow: f.low,
    fpsStatus: fps.status,
    game: fps.exeName,
  };

  history.push(s);
  if (history.length > HISTORY_LEN) history.shift();
  for (const samples of sessions.values()) {
    samples.push({ cpu: s.cpu, ram: s.ramUsed, fps: s.fps, fpsLow: s.fpsLow, gpu: s.gpu?.util ?? null });
  }
  broadcast("perf-stats", s);
}

function update() {
  const needed = viewers > 0 || sessions.size > 0;
  if (needed && !timer) {
    startDisk();
    timer = setInterval(() => {
      if (sampling) return;
      sampling = true;
      sample().catch(() => {}).finally(() => { sampling = false; });
    }, INTERVAL_MS);
  } else if (!needed && timer) {
    clearInterval(timer);
    timer = null;
    stopDisk();
  }
}

// ── Session summaries ─────────────────────────────────────────────────────────
function summarize(samples) {
  if (!samples.length) return null;
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const pick = (k) => samples.map((s) => s[k]).filter((v) => v != null);
  const round = (v) => (v == null ? null : Math.round(v * 10) / 10);

  const fpsV = pick("fps"), lowV = pick("fpsLow"), cpuV = pick("cpu"), ramV = pick("ram"), gpuV = pick("gpu");

  // Downsample the FPS timeline to ~40 points for a small chart
  let fpsTrace = null;
  if (fpsV.length) {
    const n = Math.min(40, samples.length);
    const size = samples.length / n;
    fpsTrace = Array.from({ length: n }, (_, i) => {
      const chunk = samples.slice(Math.floor(i * size), Math.floor((i + 1) * size))
        .map((s) => s.fps).filter((v) => v != null);
      return chunk.length ? Math.round(avg(chunk)) : null;
    });
  }

  return {
    avgFps: round(avg(fpsV)),
    lowFps: lowV.length ? round(Math.min(...lowV)) : null,
    avgCpu: round(avg(cpuV)),
    peakCpu: cpuV.length ? round(Math.max(...cpuV)) : null,
    peakRam: ramV.length ? Math.max(...ramV) : null, // bytes
    avgGpu: round(avg(gpuV)),
    fpsTrace,
  };
}

function beginSession(exePath) {
  sessions.set(exePath, []);
  startFps(exePath);
  update();
}

function endSession(exePath) {
  const samples = sessions.get(exePath) || [];
  sessions.delete(exePath);
  if (fps.exeName === path.basename(exePath)) stopFps();
  update();
  return summarize(samples);
}

function register() {
  ipcMain.handle("perf-subscribe", async () => {
    viewers++;
    update();
    await refreshDrives();
    return { history, drives, platform: process.platform };
  });
  ipcMain.handle("perf-unsubscribe", () => {
    viewers = Math.max(0, viewers - 1);
    update();
  });
  app.on("before-quit", () => { stopFps(); stopDisk(); });
}

module.exports = { register, beginSession, endSession };