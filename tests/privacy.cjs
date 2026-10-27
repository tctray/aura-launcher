// The privacy policy: the same words in AURA and on GitHub, a support email, and the things AURA
// does that people should know about (shared clip links, group chats, link previews, calls).
// Added by aura-privacy-update-setup.cjs.
const fs = require("fs");
const path = require("path");
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const ROOT = path.resolve(__dirname, "..");
const jsx = fs.readFileSync(path.join(ROOT, "src", "components", "privacy.jsx"), "utf8");
const md = fs.readFileSync(path.join(ROOT, "PRIVACY.md"), "utf8");

const inApp = [...jsx.matchAll(/title: "([^"]+)"/g)].map((m) => m[1]);
const onGitHub = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]).filter((t) => t !== "Contact");
check("AURA and GitHub have the same sections, in the same order", JSON.stringify(inApp) === JSON.stringify(onGitHub), { inApp, onGitHub });
const date = (jsx.match(/const UPDATED = "([^"]+)"/) || [])[1];
check("...and the same date", !!date && md.includes("Last updated " + date), date);
const strings = [...jsx.matchAll(/^\s+"((?:[^"\\]|\\.)+)",$/gm)].map((m) => JSON.parse('"' + m[1] + '"'));
const missing = strings.filter((s) => !md.includes(s));
check("...and every sentence in AURA is also on GitHub, word for word", strings.length > 30 && missing.length === 0, missing.slice(0, 3));
const email = (jsx.match(/const EMAIL = "([^"]*)"/) || [])[1];
check("there's a support email, the same in both", /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email || "") && md.includes(email), email);
for (const [what, words] of [
  ["shared clips are public Catbox links", /Catbox \(catbox\.moe\)[\s\S]*Anyone with the link can watch the clip/],
  ["group chats can include people who aren't your friends", /A group chat and its files can be opened by everyone in the group/],
  ["link previews are made by the sender's PC", /your PC visits that page once to make its preview/],
  ["3-person calls can share your IP address with a friend's friend", /share your IP address with, someone who isn't your friend/],
  ["the camera and screen sharing", /your camera, and you can share your screen/],
  ["YouTube in messages and the media player", /YouTube's privacy-enhanced player \(youtube-nocookie\.com\)/],
  ["the media player and sound devices stay on the PC", /Clips > Media[\s\S]*None of it is uploaded/],
]) check("it says: " + what, words.test(md) && words.test(jsx));

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
