// Browser tabs on the Social page: the pieces that make them work are in place.
// Added by aura-browser-tabs-setup.cjs.
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
let failed = 0;
const check = (name, ok) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name); };
const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n"); } catch { return ""; } };

const social = read("src/components/social.jsx");
const main = read("electron/main.js");
const preload = read("electron/preload.js");

console.log("1. The Browser has tabs");
check("a tab strip with + and x", /function TabStrip\(/.test(social) && /aria-label="New tab"/.test(social) && /className="btab-x"/.test(social));
check("up to 10 tabs", /const MAX_TABS = 10;/.test(social));
check("each tab is its own page, sharing the Browser's sign-ins", /partition: BROWSER_PARTITION/.test(social) && /const BROWSER_PARTITION = "persist:social-browser";/.test(social));
check("Ctrl+T, Ctrl+W and Ctrl+Tab in AURA's toolbar", /k === "t" \? "new" : k === "w" \? "close" : k === "tab"/.test(social));
check("middle-click closes a tab, and opens a bookmark in a new tab", /onAuxClick=\{\(e\) => \{ if \(e\.button === 1\) \{ e\.preventDefault\(\); onClose\(t\.id\); \} \}\}/.test(social) && /onOpenNew\(b\.url\)/.test(social));

console.log("2. Coming back next time");
check("open tabs are kept on this PC", /const TABS_KEY = "aura_browser_tabs";/.test(social) && /localStorage\.setItem\(TABS_KEY/.test(social));
check("only https pages are kept or reopened", /HTTPS_PAGE\.test\(\(t && t\.url\) \|\| ""\)/.test(social) && /HTTPS_PAGE\.test\(s\.url \|\| ""\) \? s\.url/.test(social));
check("only the tab you're on loads straight away", /tabs\.filter\(\(t\) => opened\.has\(t\.id\)\)/.test(social));

console.log("3. Links and keys from inside a page");
check("a link that opens a new tab or window opens as a tab", /host\.send\("browser-open-tab", \{ url, background: disposition === "background-tab" \}\)/.test(main));
check("only web links do (anything else still goes through the safe opener)", /if \(isBrowserTab && \/\^https\?:\\\/\\\/\/i\.test\(url\)\) \{/.test(main));
check("Ctrl+T, Ctrl+W and Ctrl+Tab inside a page reach AURA's tabs", /host\.send\("browser-tab-key", what\)/.test(main) && /if \(isBrowserTab\) contents\.on\("before-input-event"/.test(main));
check("the window can hear both", /onBrowserOpenTab:/.test(preload) && /onBrowserTabKey:/.test(preload) && /onBrowserOpenTab\?\.\(/.test(social) && /onBrowserTabKey\?\.\(/.test(social));
check("listeners can be removed (no leaks when the page reloads)", /removeListener\("browser-open-tab", h\)/.test(preload) && /removeListener\("browser-tab-key", h\)/.test(preload));

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
