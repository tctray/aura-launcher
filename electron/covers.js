// Cover art for many games at once. Added by aura-covers-setup.cjs
//
// The AURA server looks covers up on IGDB. Asked for a group of games, a busy server can come back
// with only some of them (IGDB only answers a few searches a second), which is why pressing Fetch
// used to leave gaps. So covers are asked for in small groups, slowly, and any game still without
// one is then asked for on its own (the same as the Auto button), with one retry.
"use strict";

const COVER_URL = /^https:\/\/[^\s"'<>]{8,600}$/;
const isCover = (url) => typeof url === "string" && COVER_URL.test(url);
// "DOOM™ Eternal" and "Game®" are found more reliably without the marks
const cleanTitle = (title) => String(title || "").replace(/[™®©]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
const offline = (error) => /couldn't reach|internet|log out and log back in|couldn't find your login|couldn't read your login/i.test(String(error || ""));
const noneFound = (error) => /no cover|not found|couldn't find (a )?cover|nothing found/i.test(String(error || ""));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// games: [{ id, title }]. server(route, body) answers like the AURA server.
// Answers { success, covers: { id: url }, found, total } or { success: false, error }.
async function fetchCovers(games, { server, wait = sleep, progress = () => {}, group = 8, pause = 600, gap = 300 } = {}) {
  const seen = new Set();
  const list = [];
  for (const g of Array.isArray(games) ? games : []) {
    const id = g && (typeof g.id === "string" || typeof g.id === "number") ? String(g.id) : "";
    const title = cleanTitle(g?.title);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    list.push({ id, title });
    if (list.length >= 500) break;
  }
  const covers = {};
  const total = list.length;
  let answered = false, lastError = "", stopped = false;
  const tell = () => { try { progress({ done: list.filter((g) => g.tried || covers[g.id]).length, found: Object.keys(covers).length, total }); } catch {} };

  // 1. Small groups
  for (let i = 0; i < list.length && !stopped; i += group) {
    const res = await server("/api/covers/bulk", { games: list.slice(i, i + group) });
    if (res && res.success) {
      answered = true;
      for (const [id, url] of Object.entries(res.covers || {})) if (seen.has(id) && isCover(url)) covers[id] = url;
    } else {
      lastError = res?.error || lastError;
      if (offline(lastError)) stopped = true;
    }
    tell();
    if (i + group < list.length && !stopped) await wait(pause);
  }
  // 2. Anything still missing, one at a time
  for (const g of list) {
    if (stopped) break;
    if (covers[g.id]) continue;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await server("/api/covers/one", { title: g.title });
      if (res && res.success && isCover(res.url)) { answered = true; covers[g.id] = res.url; break; }
      if (res && (res.success || noneFound(res.error))) { answered = true; break; } // the server answered: IGDB has none
      lastError = res?.error || lastError;
      if (offline(lastError)) { stopped = true; break; }
      await wait(1500); // busy: give it a moment, then once more
    }
    g.tried = true;
    tell();
    await wait(gap);
  }
  const found = Object.keys(covers).length;
  if (!answered && !found) return { success: false, error: lastError || "Couldn't reach the AURA server. Check your internet connection." };
  return { success: true, covers, found, total, error: stopped ? lastError : "" };
}

module.exports = { fetchCovers, cleanTitle };
