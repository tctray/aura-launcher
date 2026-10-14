// Ringtones and message sounds: the pieces that make them work are in place.
// Added by aura-ringtones-setup.cjs.
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
let failed = 0;
const check = (name, ok) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name); };
const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n"); } catch { return ""; } };
const sounds = read("src/components/sounds.jsx");
const calls = read("src/components/calls.jsx");
const messages = read("src/components/messages.jsx");
const app = read("src/App.jsx");
const social = read("electron/social.js");
const main = read("electron/main.js");

console.log("1. The choices");
check("AURA's ringtones and message sounds, a file from your PC, or none", /export const RINGTONES = \[/.test(sounds) && /export const CHIMES = \[/.test(sounds) && /value="file"/.test(sounds) && /value="off">None</.test(sounds));
check("Settings > Calls and messages shows them", /import \{ CallSoundSettings \} from "\.\/components\/sounds";/.test(app) && /<CallSoundSettings\/>/.test(app));
check("your choices are kept on this PC", /const KEY = "aura_call_sounds";/.test(sounds) && /localStorage\.setItem\(KEY/.test(sounds));

console.log("2. Sound files from your PC");
check("only sound files, up to 3 MB", /const MAX_FILE = 3 \* 1024 \* 1024;/.test(sounds) && /That isn't a sound file/.test(sounds));
check("a file must really play before it's used", /decodeAudioData/.test(sounds));
check("kept on this PC (AURA's own storage), never uploaded", /indexedDB\.open\(DB/.test(sounds) && !/fetch\(|auraCloud|auraSocial/.test(sounds));
check("long files are cut: 30 s for a ring, 5 s for a message", /const RING_MAX_SECONDS = 30;/.test(sounds) && /const CHIME_MAX_SECONDS = 5;/.test(sounds));

console.log("3. Calls and messages use them");
check("calls ring with your ringtone, and stop with the call", /import \{ ringtone, soundPrefs \} from "\.\/sounds";/.test(calls) && /ringtone\.start\(\{ loop: tones\.loop, note: tones\.note/.test(calls) && /stop\(\) \{\n\s*ringtone\.stop\(\);/.test(calls));
check("AURA's own ring follows the volume", /tones\.note\(\[f\], i \* 0\.16, 0\.2, 0\.09 \* v\)/.test(calls));
check("a call answered while the file loads never rings late", /if \(turn !== ringTurn\) return true;/.test(sounds));
check("messages you're not looking at chime (not missed calls)", /import \{ chime \} from "\.\/sounds";/.test(messages) && /if \(message\.content !== MISSED_CALL\) chime\(\);/.test(messages));
check("a burst of messages chimes once", /if \(now - lastChime < 1500\) return;/.test(sounds));
check("Windows notifications don't add a second sound", /silent: typeof messageSound === "function" \? messageSound\(\) !== "windows" : false/.test(social) && /messageSound: \(\) => appSettings\.messageSound/.test(main) && /messageSound: "aura",/.test(main));

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
