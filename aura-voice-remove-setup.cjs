#!/usr/bin/env node
/**
 * AURA — voice commands removed
 *
 *   - "Hey AURA" voice commands are gone: the switch in Settings, the listening, and the
 *     Listening sign. AURA no longer listens to your microphone for commands at all, so game
 *     sound can't mute AURA or start a game by mistake.
 *   - Voice calls and voice messages stay exactly as they are.
 *   - The privacy policy no longer has a Voice commands section.
 *   No database changes. Works whether or not you ran aura-voice-safety-setup.cjs.
 *
 * How to use:  node aura-voice-remove-setup.cjs      (in your AURA project folder)
 * To undo:     node aura-voice-remove-setup.cjs --undo
 */
"use strict";
const fs = require("fs");
const path = require("path");
const DATA = /*__DATA__*/{"edits": [{"file": "electron/main.js", "find": "// Voice commands: \"Hey AURA, next song\", off unless switched on in Settings (Added by aura-voice-setup.cjs)\nrequire(\"./voice\").create({ app, ipcMain, getWindow: () => mainWin, onRecord: (want) => { if ((want === \"start\") !== isRecording) toggleRecordingHotkey(); }, onBar: () => toggleBar() });\n", "replace": "// (Voice commands removed by aura-voice-remove-setup.cjs)\n"}, {"file": "electron/preload.js", "find": "  // Voice commands: Settings > Voice Commands (Added by aura-voice-setup.cjs)\n  voiceGet: () => ipcRenderer.invoke(\"voice:get\"),\n  voiceSet: (on) => ipcRenderer.invoke(\"voice:set\", on === true),\n  voiceGames: (titles) => ipcRenderer.invoke(\"voice:games\", titles),\n  voiceFriends: (names) => ipcRenderer.invoke(\"voice:friends\", names), // (Added by aura-voice-more-setup.cjs)\n  voiceKey: (key) => ipcRenderer.invoke(\"voice:key\", key),\n  onVoiceStatus: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on(\"voice-status\", h); return () => ipcRenderer.removeListener(\"voice-status\", h); },\n  onVoiceCommand: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on(\"voice-command\", h); return () => ipcRenderer.removeListener(\"voice-command\", h); },\n", "replace": "  // (Voice commands removed by aura-voice-remove-setup.cjs)\n"}, {"file": "src/App.jsx", "find": "import { VoiceSettings, VoiceSign, useVoiceCommands } from \"./components/voice\"; // \"Hey AURA\" voice commands (Added by aura-voice-setup.cjs)\n", "replace": "// (Voice commands removed by aura-voice-remove-setup.cjs)\n"}, {"file": "src/App.jsx", "find": "      <SetCategory id=\"sound\" title=\"Sound & Voice\" note=\"Your speakers and mic, AURA's sounds, and talking to AURA\">\n", "replace": "      <SetCategory id=\"sound\" title=\"Sound & Voice\" note=\"Your speakers and mic, and AURA's sounds\">\n"}, {"file": "src/App.jsx", "find": "      <SetGroup id=\"voice\" title=\"VOICE COMMANDS\"><VoiceSettings/></SetGroup>{/* (Added by aura-voice-setup.cjs) */}\n", "replace": ""}, {"file": "src/App.jsx", "find": "  // \"Hey AURA, launch …\", \"open library\", music (Added by aura-voice-setup.cjs)\n  useVoiceCommands({games,play:doPlay,go:(id)=>{setView(id);setHeroGame(null);setSrch(\"\");},toast});\n", "replace": "", "alts": ["  // \"Hey AURA, launch …\", \"open library\", music (Added by aura-voice-setup.cjs)\n  useVoiceCommands({games,play:doPlay,go:(id)=>{setView(id);setHeroGame(null);setSrch(\"\");},toast,playing:nowPlaying}); // (playing: no starting another game by voice, Added by aura-voice-safety-setup.cjs)\n"]}, {"file": "src/App.jsx", "find": "        <VoiceSign/>{/* (Added by aura-voice-setup.cjs) */}\n", "replace": ""}, {"file": "src/App.jsx", "find": "      <MediaDock onOpen={()=>goTo(\"clips\")}/>{/* (Added by aura-media-player-setup.cjs) */}\n      <VoiceSign/>{/* (Added by aura-voice-setup.cjs) */}\n      <SeasonalLayer playing={!!nowPlaying}/><NavAccentStyle/>{/* seasonal decorations (Added by aura-seasonal-setup.cjs) */}\n", "replace": "      <MediaDock onOpen={()=>goTo(\"clips\")}/>{/* (Added by aura-media-player-setup.cjs) */}\n      <SeasonalLayer playing={!!nowPlaying}/><NavAccentStyle/>{/* seasonal decorations (Added by aura-seasonal-setup.cjs) */}\n"}, {"file": "src/components/settingsnav.jsx", "find": "  \"voice commands\": \"hey aura speech microphone talk speak dictation\",\n", "replace": "  // (Voice commands removed by aura-voice-remove-setup.cjs)\n"}, {"file": "src/components/privacy.jsx", "find": "const UPDATED = \"November 3, 2026\"; // (Updated by aura-store-setup.cjs)\n", "replace": "const UPDATED = \"November 22, 2026\"; // (Updated by aura-voice-remove-setup.cjs)\n"}, {"file": "src/components/privacy.jsx", "find": "      \"You can call your AURA friends with your voice and, if you choose, your camera, and you can share your screen. AURA uses your microphone, camera or screen only while you're in a call and have them switched on, or while you record a clip with the camera on. Voice commands also use your microphone while you have them switched on (see Voice commands).\",\n      \"When a call is accepted, the PCs connect to each other and the sound and picture travel between them, encrypted. They don't pass through AURA's database and they aren't recorded.\",\n      \"To connect, each PC is told the other's internet (IP) address. This happens only after a call is accepted, and only with the people in the call. In a call with three people, a friend can add one of their own friends, so you may connect to, and share your IP address with, someone who isn't your friend. If you'd rather not, leave the call.\",\n      \"On a few networks PCs can't connect directly. If AURA has a relay set up for that, the encrypted call passes through it instead. The relay can't listen to it or watch it.\",\n    ],\n  },\n  {\n    title: \"Voice commands\",\n    body: [\n      \"Voice commands are off unless you switch them on in Settings. While they're on, AURA listens through your microphone for “Hey AURA” and its own short list of commands, using the speech recognition built into Windows, on your PC. Windows shows that the microphone is in use.\",\n      \"What you say isn't recorded, saved or sent anywhere, including to the developer. To know which games you can start and which friends you can call or message by voice, AURA gives Windows the names of your games and friends, on your PC.\",\n      \"When you type a message by voice (“Hey AURA, message …”), Windows turns everything you say into text, on your PC, until you say “send” or “cancel” or stop talking for 20 seconds. The text goes into the message box, and it's only sent when you say “send” or press Enter, like any message you type.\",\n    ],\n  },\n", "replace": "      \"You can call your AURA friends with your voice and, if you choose, your camera, and you can share your screen. AURA uses your microphone, camera or screen only while you're in a call and have them switched on, or while you record a clip with the camera on.\",\n      \"When a call is accepted, the PCs connect to each other and the sound and picture travel between them, encrypted. They don't pass through AURA's database and they aren't recorded.\",\n      \"To connect, each PC is told the other's internet (IP) address. This happens only after a call is accepted, and only with the people in the call. In a call with three people, a friend can add one of their own friends, so you may connect to, and share your IP address with, someone who isn't your friend. If you'd rather not, leave the call.\",\n      \"On a few networks PCs can't connect directly. If AURA has a relay set up for that, the encrypted call passes through it instead. The relay can't listen to it or watch it.\",\n    ],\n  },\n  // (Voice commands removed by aura-voice-remove-setup.cjs)\n"}, {"file": "PRIVACY.md", "find": "Last updated November 3, 2026\n", "replace": "Last updated November 22, 2026\n"}, {"file": "PRIVACY.md", "find": "You can call your AURA friends with your voice and, if you choose, your camera, and you can share your screen. AURA uses your microphone, camera or screen only while you're in a call and have them switched on, or while you record a clip with the camera on. Voice commands also use your microphone while you have them switched on (see Voice commands).\n", "replace": "You can call your AURA friends with your voice and, if you choose, your camera, and you can share your screen. AURA uses your microphone, camera or screen only while you're in a call and have them switched on, or while you record a clip with the camera on.\n"}, {"file": "PRIVACY.md", "find": "## Voice commands\n\nVoice commands are off unless you switch them on in Settings. While they're on, AURA listens through your microphone for “Hey AURA” and its own short list of commands, using the speech recognition built into Windows, on your PC. Windows shows that the microphone is in use.\n\nWhat you say isn't recorded, saved or sent anywhere, including to the developer. To know which games you can start and which friends you can call or message by voice, AURA gives Windows the names of your games and friends, on your PC.\n\nWhen you type a message by voice (“Hey AURA, message …”), Windows turns everything you say into text, on your PC, until you say “send” or “cancel” or stop talking for 20 seconds. The text goes into the message box, and it's only sent when you say “send” or press Enter, like any message you type.\n\n", "replace": "<!-- (Voice commands removed by aura-voice-remove-setup.cjs) -->\n"}, {"file": "tests/run.cjs", "find": "// Voice commands (Added by aura-voice-setup.cjs)\nif (fs.existsSync(path.join(ROOT, \"electron\", \"voice.js\")) && fs.existsSync(path.join(__dirname, \"voice.cjs\"))) add(\"files\", \"Voice commands: what AURA listens for and does\", \"voice.cjs\");\n", "replace": "// (Voice commands removed by aura-voice-remove-setup.cjs)\n"}, {"file": "tests/run.cjs", "find": "if (fs.existsSync(path.join(__dirname, \"voice-window.cjs\"))) add(\"window\", \"Settings > Voice Commands, and doing what you said\", \"voice-window.cjs\"); // (Added by aura-voice-setup.cjs)\n", "replace": ""}], "files": {}, "remove": ["electron/voice.js", "src/components/voice.jsx", "tests/voice.cjs", "tests/voice-window.cjs"]};
const ROOT = process.cwd();
const MARK = "aura-voice-remove-setup.cjs";
const BAK = ".before-voice-remove.bak";
const REMOVE = DATA.remove || [];
const say = (s = "") => console.log(s);
const full = (rel) => path.join(ROOT, ...rel.split("/"));
const stop = (lines) => { say("\nNothing was changed."); lines.forEach((l) => say("  " + l)); say(); process.exit(1); };
const EDITED = [...new Set(DATA.edits.map((e) => e.file))];
const NEW = Object.keys(DATA.files);
if (!fs.existsSync(full("package.json"))) stop(["This isn't your AURA project folder (no package.json here)."]);
if (process.argv.includes("--undo")) {
  let n = 0;
  for (const rel of [...EDITED, ...REMOVE]) if (fs.existsSync(full(rel) + BAK)) { fs.copyFileSync(full(rel) + BAK, full(rel)); fs.unlinkSync(full(rel) + BAK); say("  restored  " + rel); n++; }
  for (const rel of NEW) if (fs.existsSync(full(rel)) && fs.readFileSync(full(rel), "utf8").includes(MARK)) { fs.unlinkSync(full(rel)); say("  removed   " + rel); n++; }
  say(n ? "\nUndo finished.\n" : "\nNothing to undo.\n");
  process.exit(0);
}
const crlf = fs.readFileSync(full("package.json"), "utf8").includes("\r\n");
const plan = [];
for (const rel of EDITED) {
  if (!fs.existsSync(full(rel))) { if (rel === "tests/run.cjs" || rel === "PRIVACY.md") continue; stop([rel + " isn't there. Copy this message to Claude."]); }
  const raw = fs.readFileSync(full(rel), "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  let out = raw.replace(/\r\n/g, "\n");
  const mine = DATA.edits.filter((e) => e.file === rel);
  if (out.includes(MARK)) { plan.push({ rel, done: true }); continue; }
  for (const e of DATA.edits.filter((e) => e.file === rel)) {
    const find = [e.find, ...(e.alts || [])].find((f) => { const k = out.indexOf(f); return k >= 0 && out.indexOf(f, k + 1) < 0; }) || e.find;
    const i = out.indexOf(find);
    if (i < 0 || out.indexOf(find, i + 1) >= 0) stop(["In " + rel + " I couldn't find the spot for: " + e.find.trim().split("\n")[0].slice(0, 90), "Copy this message to Claude."]);
    out = out.slice(0, i) + e.replace + out.slice(i + find.length);
  }
  plan.push({ rel, text: out, eol, exists: true });
}
for (const rel of NEW) {
  if (rel.startsWith("tests/") && !fs.existsSync(full("tests"))) continue;
  if (fs.existsSync(full(rel))) {
    if (fs.readFileSync(full(rel), "utf8").includes(MARK)) { plan.push({ rel, done: true }); continue; }
    stop([rel + " is already there, and it isn't from this installer. Copy this message to Claude."]);
  }
  plan.push({ rel, text: DATA.files[rel], eol: crlf ? "\r\n" : "\n", exists: false });
}
for (const rel of REMOVE) plan.push(fs.existsSync(full(rel)) ? { rel, remove: true } : { rel, done: true, gone: true });
say("\nAURA: voice commands removed\n");
for (const p of plan) {
  if (p.done) { say("  " + p.rel + ": " + (p.gone ? "already removed" : "already done")); continue; }
  if (p.remove) {
    if (!fs.existsSync(full(p.rel) + BAK)) fs.copyFileSync(full(p.rel), full(p.rel) + BAK);
    fs.unlinkSync(full(p.rel));
    say("  " + p.rel + ": removed");
    continue;
  }
  if (p.exists && !fs.existsSync(full(p.rel) + BAK)) fs.copyFileSync(full(p.rel), full(p.rel) + BAK);
  fs.mkdirSync(path.dirname(full(p.rel)), { recursive: true });
  fs.writeFileSync(full(p.rel), p.eol === "\n" ? p.text : p.text.replace(/\n/g, p.eol));
  say("  " + p.rel + ": " + (p.exists ? "updated" : "added"));
}
say("\nRestart AURA (npm run electron:dev). Settings > Sound & Voice no longer has Voice Commands. Run  npm test  before your next release.\n");
