// The real errorlog.js with stand-ins for Electron's pieces
const fs = require("fs"), os = require("os"), path = require("path");
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const data = fs.mkdtempSync(path.join(os.tmpdir(), "aura-log-"));
const handlers = {}, appEvents = {}, shown = [];
const before = { u: process.listeners("uncaughtException").slice(), r: process.listeners("unhandledRejection").slice() };
const log = require(path.resolve(process.argv[2])).register({
  ipcMain: { handle: (n, f) => (handlers[n] = f) },
  app: { getPath: () => data, getVersion: () => "1.12.0", on: (n, f) => (appEvents[n] = f) },
  shell: { showItemInFolder: (f) => shown.push(f) },
});
const mine = { u: process.listeners("uncaughtException").filter((l) => !before.u.includes(l)), r: process.listeners("unhandledRejection").filter((l) => !before.r.includes(l)) };
const file = path.join(data, "logs", "aura-errors.log");
const read = () => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
(async () => {
  check("nothing is written until something goes wrong", !fs.existsSync(file));
  let r = await handlers["open-error-log"]();
  check("opening the log before any error makes an empty one and shows it in its folder", r.success && shown[0] === file && /Nothing has gone wrong yet/.test(read()), r);
  const home = os.homedir();
  r = await handlers["log-error"]({}, { kind: "page", where: "streams", message: "Cannot read properties of undefined (reading 'map')", stack: `TypeError: Cannot read properties of undefined (reading 'map')\n    at StreamsView (${home}\\Documents\\aura\\src\\App.jsx:1700:12)\n    at div`, detail: "\n    at StreamsView\n    at PageBoundary\n    at AuraApp" });
  let text = read();
  check("a page crash is written with the time, version, page and message", r.success && /\[\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\] AURA 1\.12\.0 · page "streams"\nCannot read properties of undefined \(reading 'map'\)/.test(text), text);
  check("with where it happened in the code and in the page", /at StreamsView \(~\\Documents\\aura\\src\\App\.jsx:1700:12\)/.test(text) && /where in the page:\n    at StreamsView\n    at PageBoundary/.test(text), text);
  check("the person's Windows user folder is replaced with ~", !text.includes(home), home);
  await handlers["log-error"]({}, "just a string"); await handlers["log-error"]({}, null); await handlers["log-error"]({}, { kind: "we\"ird\nkind", where: "a\nb", message: 42 });
  text = read();
  check("odd input never breaks it", /just a string/.test(text) && /Unknown error/.test(text) && /· weirdkind "a b"\n42/.test(text), text.slice(-300));
  const big = "x".repeat(50000);
  await handlers["log-error"]({}, { kind: "page", message: big, stack: big, detail: big });
  check("one huge error is cut down to size", read().length < 16000, read().length);
  let ok = 0; for (let i = 0; i < 100; i++) if ((await handlers["log-error"]({}, { message: "loop " + i })).success) ok++;
  check("an error loop is capped (30 a minute) so it can't fill the disk", ok > 0 && ok <= 30 && read().split("loop ").length - 1 === ok, ok);
  check("exactly one listener each for main-process errors", mine.u.length === 1 && mine.r.length === 1);
  // Past the cap for this minute; write directly as the next minute would
  const realNow = Date.now; Date.now = () => realNow() + 61000;
  mine.u[0](new Error("main went wrong")); mine.r[0]("a rejected promise");
  appEvents["render-process-gone"]({}, {}, { reason: "oom", exitCode: -536870904 });
  appEvents["render-process-gone"]({}, {}, { reason: "clean-exit", exitCode: 0 });
  appEvents["child-process-gone"]({}, { type: "GPU", reason: "crashed", name: "GPU Process" });
  text = read();
  check("main-process errors are written too", /· main\nmain went wrong\n    at /.test(text) && /· main-promise\na rejected promise/.test(text), text.slice(-700));
  check("so is the window process dying, but not a normal close", /The window process stopped: oom \(exit code -536870904\)/.test(text) && !/clean-exit/.test(text) && /A helper process stopped: GPU · crashed · GPU Process/.test(text));
  fs.writeFileSync(file, "old\n".repeat(140000)); // over half a megabyte
  Date.now = () => realNow() + 125000;
  await handlers["log-error"]({}, { message: "after rotation" });
  check("a full log is set aside as aura-errors.old.log and a fresh one started", fs.existsSync(path.join(data, "logs", "aura-errors.old.log")) && read().length < 500 && /after rotation/.test(read()), read().length);
  Date.now = realNow;
  fs.rmSync(data, { recursive: true, force: true });
  console.log(failed ? "\n" + failed + " FAILED" : "\nall passed");
  process.exit(failed ? 1 : 0);
})();
