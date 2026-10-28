// The release process: checks on Linux and Windows before anything is built, exact package versions,
// the installed AURA started once as a check, and releases published as drafts you approve.
// Added by aura-release-process-setup.cjs.
const fs = require("fs");
const path = require("path");
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const ROOT = path.resolve(__dirname, "..");
const read = (...p) => { try { return fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n"); } catch { return ""; } };
const flow = read(".github", "workflows", "build.yml");
const pkg = JSON.parse(read("package.json") || "{}");
const main = read("electron", "main.js");
const job = (name) => { const m = new RegExp("\\n  " + name + ":\\n([\\s\\S]*?)(?=\\n  [a-z-]+:\\n|$)").exec(flow); return m ? m[1] : ""; };

if (!flow) { console.log("  note  .github/workflows/build.yml isn't here, so it wasn't checked"); }
else {
  check("the checks run on Linux and on Windows", /runs-on: ubuntu/.test(job("test")) && /runs-on: windows-latest/.test(job("test-windows")) && /npm test/.test(job("test-windows")));
  check("nothing is built until both pass", /needs: \[test, test-windows\]/.test(job("build-windows")) && /needs: \[test, test-windows\]/.test(job("build-linux")));
  check("every job installs the exact versions in package-lock.json (npm ci)", ["test", "test-windows", "build-windows", "build-linux"].every((j) => /run: npm ci\b/.test(job(j)) && !/run: npm install\b/.test(job(j))));
  check("the built Windows installer is installed and AURA started once as a check", /AURA-Installer-\*\.exe/.test(job("build-windows")) && /"\/S"/.test(job("build-windows")) && /--aura-smoke-test/.test(job("build-windows")) && /ExitCode -ne 0/.test(job("build-windows")));
}
const publish = [...(pkg.publish || []), ...((pkg.build && pkg.build.publish) || [])];
check("releases are published as drafts", publish.length > 0 && publish.every((p) => p.releaseType === "draft"), publish);
check("package.json and package-lock.json agree (npm ci needs that)", (() => {
  try {
    const lock = JSON.parse(read("package-lock.json"));
    const want = { ...pkg.dependencies, ...pkg.devDependencies };
    const have = lock.packages[""];
    const sorted = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
    return sorted({ ...have.dependencies, ...have.devDependencies }) === sorted(want);
  } catch { return false; }
})());
check("AURA has the start-up check (--aura-smoke-test): window shown, error log empty, result written", /--aura-smoke-test/.test(main) && /smoke-test\.txt/.test(main) && /innerText/.test(main) && /aura-errors\.log/.test(main) && /app\.exit\(ok \? 0 : 1\)/.test(main));

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
