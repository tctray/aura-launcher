// Achievements count everything you do, however a game got into AURA or was started:
// games imported from Steam, Epic or Xbox, a library brought in from your account, and games
// played from outside AURA (Sessions) all count. Added by aura-achievements-fix-setup.cjs
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
const titleKey = (t) => String(t || "").trim().toLowerCase();
const dayStart = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

// The most days in a row with some play, from the times games were played
export function longestStreak(times) {
  const days = [...new Set(times.filter((t) => Number.isFinite(t) && t > 0).map(dayStart))].sort((a, b) => a - b);
  let best = 0, run = 0, prev = null;
  for (const d of days) {
    if (prev !== null) {
      const p = new Date(prev);
      const next = new Date(p.getFullYear(), p.getMonth(), p.getDate() + 1).getTime(); // safe across clock changes
      run = d === next ? run + 1 : 1;
    } else run = 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

// The numbers the achievements are checked against. Never lower than what AURA already counted.
// Demo games (the ones AURA starts with) don't count as games you added or favorited.
export function achievementStats(games, stats, sessions, demoGames) {
  const s = stats && typeof stats === "object" ? stats : {};
  const all = Array.isArray(games) ? games.filter((g) => g && typeof g === "object") : [];
  const demo = new Set((Array.isArray(demoGames) ? demoGames : []).map((d) => d.id + "|" + d.exePath));
  const mine = all.filter((g) => !demo.has(g.id + "|" + g.exePath));
  const list = Array.isArray(sessions) ? sessions.filter((x) => x && Number.isFinite(x.end)) : [];

  const played = new Set(list.map((x) => titleKey(x.title)).filter(Boolean));
  for (const id of Array.isArray(s.playedGameIds) ? s.playedGameIds : []) {
    const g = all.find((x) => x.id === id);
    played.add(g ? titleKey(g.title) : "id:" + id);
  }
  const sessionHours = list.reduce((n, x) => n + num(x.durationMs), 0) / 3600000;
  const times = [];
  for (const x of list) { times.push(x.end); if (Number.isFinite(x.start)) times.push(x.start); }

  return {
    ...s,
    totalLaunches: Math.max(num(s.totalLaunches), list.length ? 1 : 0),
    gamesAdded: Math.max(num(s.gamesAdded), mine.length),
    favoritesCount: Math.max(mine.filter((g) => g.favorite).length, 0),
    gamesPlayedCount: Math.max(num(s.gamesPlayedCount), played.size),
    totalPlaytimeHours: Math.max(num(s.totalPlaytimeHours), num(s.totalPlaytimeMs) / 3600000, sessionHours),
    streakDays: Math.max(num(s.streakDays), longestStreak(times)),
  };
}
