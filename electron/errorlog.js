// AURA error log — the main-process side.
//
// When something goes wrong (a page crashes, the window process dies, an error nobody handled),
// AURA writes a few lines to a file on this PC:
//     <AURA's data folder>/logs/aura-errors.log
// Nothing is sent anywhere. The file is there so the person can look at it, or choose to send it
// to whoever is helping them. Their Windows user name is taken out of file paths first.
//
// Added by aura-reliability-setup.cjs. Wired up from the main file with one line:
//   require("./errorlog").register({ ipcMain, app, shell });
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const MAX_BYTES = 512 * 1024;   // when the log passes this size it becomes aura-errors.old.log and a new one starts
const MAX_PER_MINUTE = 30;      // a page stuck in an error loop can't fill the disk

function register({ ipcMain, app, shell }) {
  const dir = () => path.join(app.getPath("userData"), "logs");
  const file = () => path.join(dir(), "aura-errors.log");
  let minute = 0, count = 0;

  // "C:\Users\tctra\..." -> "~\..." so a shared log doesn't carry the person's name
  const home = os.homedir();
  const tidy = (text, max) => {
    let out = String(text ?? "");
    if (home && home.length > 3) out = out.split(home).join("~").split(home.replace(/\\/g, "/")).join("~");
    return out.replace(/\r\n?/g, "\n").slice(0, max);
  };
  const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };

  function write(entry) {
    try {
      const now = Math.floor(Date.now() / 60000);
      if (now !== minute) { minute = now; count = 0; }
      if (++count > MAX_PER_MINUTE) return false;
      const kind = tidy(entry?.kind || "error", 20).replace(/[^\w-]/g, "");
      const where = tidy(entry?.where || "", 60).replace(/[\n"]/g, " ");
      const lines = [`[${stamp()}] AURA ${app.getVersion()} · ${kind}${where ? ` "${where}"` : ""}`, tidy(entry?.message || "Unknown error", 2000)];
      const stack = tidy(entry?.stack || "", 6000).split("\n").map((l) => l.trim()).filter((l) => l.startsWith("at ")).map((l) => "    " + l); // the frames; the first line just repeats the message
      if (stack.length) lines.push(...stack.slice(0, 30));
      const detail = tidy(entry?.detail || "", 3000).split("\n").filter((l) => l.trim()).map((l) => "    " + l.trim());
      if (detail.length) lines.push("  where in the page:", ...detail.slice(0, 15));
      fs.mkdirSync(dir(), { recursive: true });
      try { if (fs.statSync(file()).size > MAX_BYTES) fs.renameSync(file(), path.join(dir(), "aura-errors.old.log")); } catch {}
      fs.appendFileSync(file(), lines.join("\n") + "\n\n");
      return true;
    } catch { return false; }
  }

  // From the window: a page that crashed, or an error nobody handled
  ipcMain.handle("log-error", (_e, entry) => ({ success: write(entry && typeof entry === "object" ? entry : { message: entry == null ? "" : String(entry) }) }));

  // Shows the log in its folder, so it is easy to attach to a message
  ipcMain.handle("open-error-log", () => {
    try {
      fs.mkdirSync(dir(), { recursive: true });
      if (!fs.existsSync(file())) fs.writeFileSync(file(), "AURA error log. Nothing has gone wrong yet.\n\n");
      shell.showItemInFolder(file());
      return { success: true, file: file() };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // Problems in the main process itself
  process.on("uncaughtException", (e) => { write({ kind: "main", message: e?.message || String(e), stack: e?.stack }); });
  process.on("unhandledRejection", (e) => { write({ kind: "main-promise", message: e?.message || String(e), stack: e?.stack }); });
  // The window's own process dying (out of memory, a graphics driver crash...)
  app.on("render-process-gone", (_e, _contents, details) => { if (details?.reason !== "clean-exit") write({ kind: "window-gone", message: `The window process stopped: ${details?.reason || "unknown"} (exit code ${details?.exitCode ?? "?"})` }); });
  app.on("child-process-gone", (_e, details) => { if (details?.reason !== "clean-exit") write({ kind: "helper-gone", message: `A helper process stopped: ${details?.type || "?"} · ${details?.reason || "unknown"}${details?.name ? " · " + details.name : ""}` }); });

  return { write, file };
}

module.exports = { register };
