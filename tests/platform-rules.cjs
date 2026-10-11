// Twitch and Discord rules: the things AURA must not do with their players and logins.
//   Twitch:  streams play in Twitch's own player, untouched, and never smaller than 400 x 300.
//   Discord: AURA signs you in and shows what you're playing. It doesn't read your friends
//            list or send messages as you (both need Discord's approval for this app).
// Needs nothing but the project's own files.
// Added by aura-twitch-discord-setup.cjs.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok || extra === undefined ? "" : "\n          " + String(extra).split("\n").join("\n          "))); };
const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out); else if (/\.(c?js|jsx)$/.test(e.name)) out.push(full);
  }
  return out;
}
const pkg = JSON.parse(read(path.join(ROOT, "package.json")) || "{}");
const mainFile = path.join(ROOT, pkg.main || "electron/main.js");
const mainSide = walk(path.dirname(mainFile)).map(read).join("\n");
const windowSide = walk(path.join(ROOT, "src")).map(read).join("\n");
const everything = mainSide + "\n" + windowSide;
const found = (text, list) => list.filter((piece) => (piece instanceof RegExp ? piece.test(text) : text.includes(piece))).map(String);

console.log("1. Twitch: the player");
check("streams play in Twitch's own player", /https:\/\/player\.twitch\.tv\/\?channel=/.test(mainSide));
check("chat is Twitch's own chat", /https:\/\/www\.twitch\.tv\/embed\/[^"'`]*\/chat/.test(mainSide));
let bad = found(mainSide, ['"stream-set-volume"', /executeJavaScript\(\s*[`'"][\s\S]{0,500}?(querySelector|\.volume\s*=|\.muted\s*=|\.style\b|\.remove\(|innerHTML)/]);
check("AURA runs nothing inside the player that changes it (volume is the player's own control)", !bad.length, bad.join("\n"));
bad = found(windowSide, ["streamSetVolume"]);
check("the window has no volume slider that reaches into the player", !bad.length, bad.join("\n"));
bad = found(mainSide, ["insertCSS(", /webRequest[\s\S]{0,400}?(twitch\.tv|ttvnw\.net|jtvnw\.net)/]);
check("nothing is added to the player's page, and none of its requests are blocked", !bad.length, bad.join("\n"));

console.log("2. Twitch: the mini-player's size");
const min = mainSide.match(/STREAM_MIN\s*=\s*\{\s*width:\s*(\d+)\s*,\s*height:\s*(\d+)/);
check("the main process never makes the mini-player smaller than 400 x 300", !!min && Number(min[1]) >= 400 && Number(min[2]) >= 300 && /Math\.max\(STREAM_MIN\.width/.test(mainSide) && /Math\.max\(STREAM_MIN\.height/.test(mainSide), min ? min[0] : "no STREAM_MIN in the main file");
const pip = windowSide.match(/const PIP\s*=\s*\{\s*width:\s*(\d+)\s*,\s*height:\s*(\d+)/);
check("the window draws the mini-player at 400 x 300 or larger", !!pip && Number(pip[1]) >= 400 && Number(pip[2]) >= 300, pip ? pip[0] : "no PIP size in the window");

console.log("3. Discord");
const scopes = [...mainSide.matchAll(/discord\.com\/(?:api\/)?oauth2\/authorize[^"'`]*?[?&]scope=([^&"'`$]+)/g)].map((m) => decodeURIComponent(m[1]).split(/[\s+]+/).filter(Boolean));
check("Discord login asks only for your basic profile", scopes.length > 0 && scopes.every((list) => list.length === 1 && list[0] === "identify"), JSON.stringify(scopes));
bad = found(everything, [/users\/@me\/relationships/, "getRelationships(", '"discord-get-friends"', '"rpc-get-friends"', "discordGetFriends", "rpcGetFriends"]);
check("AURA doesn't read your Discord friends list", !bad.length, bad.join("\n"));
bad = found(everything, [/discord(?:app)?\.com\/api\/[^"'`]*(?:channels|messages)/, '"discord-invite-friend"', "discordInviteFriend"]);
check("AURA doesn't send Discord messages as you", !bad.length, bad.join("\n"));

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
