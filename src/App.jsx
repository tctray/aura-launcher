/**
 * AURA — Desktop Game Launcher
 * Full app with profile, themes, Discord, playtime tracking
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

const CATEGORIES = ["All","FPS","RPG","Strategy","Action","Adventure","Sports","Simulation","Indie","Other"];

const DEMO_GAMES = [
  { id:"1", title:"Cyberpunk 2077", exePath:"C:\\Games\\Cyberpunk2077\\Cyberpunk2077.exe", cover:"https://images.igdb.com/igdb/image/upload/t_cover_big/co4hk9.webp", category:"RPG", favorite:true, playCount:47, lastPlayed:Date.now()-86400000*2, addedAt:Date.now()-86400000*30 },
  { id:"2", title:"Elden Ring", exePath:"C:\\Games\\ELDEN RING\\eldenring.exe", cover:"https://images.igdb.com/igdb/image/upload/t_cover_big/co4jni.webp", category:"RPG", favorite:true, playCount:120, lastPlayed:Date.now()-86400000*1, addedAt:Date.now()-86400000*60 },
  { id:"3", title:"Counter-Strike 2", exePath:"C:\\Steam\\steamapps\\common\\cs2\\cs2.exe", cover:"https://images.igdb.com/igdb/image/upload/t_cover_big/co6ahz.webp", category:"FPS", favorite:false, playCount:203, lastPlayed:Date.now()-3600000*5, addedAt:Date.now()-86400000*90 },
  { id:"4", title:"Baldur's Gate 3", exePath:"C:\\Games\\BaldursGate3\\bg3.exe", cover:"https://images.igdb.com/igdb/image/upload/t_cover_big/co6li8.webp", category:"RPG", favorite:true, playCount:88, lastPlayed:Date.now()-86400000*4, addedAt:Date.now()-86400000*20 },
  { id:"5", title:"Starfield", exePath:"C:\\Games\\Starfield\\Starfield.exe", cover:"https://images.igdb.com/igdb/image/upload/t_cover_big/co6rg4.webp", category:"RPG", favorite:false, playCount:22, lastPlayed:Date.now()-86400000*7, addedAt:Date.now()-86400000*45 },
  { id:"6", title:"Hades II", exePath:"C:\\Games\\Hades2\\Hades2.exe", cover:"https://images.igdb.com/igdb/image/upload/t_cover_big/co85a9.webp", category:"Action", favorite:false, playCount:55, lastPlayed:Date.now()-86400000*3, addedAt:Date.now()-86400000*10 },
  { id:"7", title:"Hollow Knight", exePath:"C:\\Games\\HollowKnight\\hollow_knight.exe", cover:"https://images.igdb.com/igdb/image/upload/t_cover_big/co1rgi.webp", category:"Indie", favorite:true, playCount:67, lastPlayed:Date.now()-86400000*14, addedAt:Date.now()-86400000*120 },
  { id:"8", title:"Civilization VI", exePath:"C:\\Steam\\steamapps\\common\\CivilizationVI\\CivilizationVI.exe", cover:"https://images.igdb.com/igdb/image/upload/t_cover_big/co1zcg.webp", category:"Strategy", favorite:false, playCount:310, lastPlayed:Date.now()-86400000*20, addedAt:Date.now()-86400000*200 },
  { id:"9", title:"Dave the Diver", exePath:"C:\\Games\\DavetheDiver\\DavetheDiver.exe", cover:"https://images.igdb.com/igdb/image/upload/t_cover_big/co6t44.webp", category:"Indie", favorite:false, playCount:14, lastPlayed:Date.now()-86400000*9, addedAt:Date.now()-86400000*15 },
  { id:"10", title:"Sea of Stars", exePath:"C:\\Games\\SeaOfStars\\SeaOfStars.exe", cover:"https://images.igdb.com/igdb/image/upload/t_cover_big/co6t36.webp", category:"RPG", favorite:false, playCount:30, lastPlayed:Date.now()-86400000*11, addedAt:Date.now()-86400000*25 },
];

const THEMES = {
  midnight: { name:"Midnight", bg:"#222831", panel:"#1a1f26", card:"#2D4059", hover:"#354d6e", ac:"#FF5722", ac2:"#ff8a65" },
  obsidian: { name:"Obsidian", bg:"#0a0a0a", panel:"#111111", card:"#1e1e1e", hover:"#2a2a2a", ac:"#888888", ac2:"#aaaaaa" },
  blood:    { name:"Blood",    bg:"#0d0000", panel:"#110000", card:"#1e0000", hover:"#2a0000", ac:"#cc0000", ac2:"#ff4444" },
  ocean:    { name:"Ocean",    bg:"#020c1b", panel:"#030d20", card:"#0a1628", hover:"#0f2040", ac:"#1e90ff", ac2:"#64b5f6" },
  neon:     { name:"Neon",     bg:"#0d0d1a", panel:"#111128", card:"#1a1a3e", hover:"#222255", ac:"#00d4ff", ac2:"#66e5ff" },
  crimson:  { name:"Crimson",  bg:"#1a0a0a", panel:"#150808", card:"#2d1010", hover:"#3d1515", ac:"#e53935", ac2:"#ef9a9a" },
  forest:   { name:"Forest",   bg:"#0a1a0e", panel:"#081208", card:"#0f2d15", hover:"#153d1c", ac:"#43a047", ac2:"#81c784" },
  slate:    { name:"Slate",    bg:"#1a1a2e", panel:"#12121f", card:"#252540", hover:"#303055", ac:"#7c4dff", ac2:"#b39ddb" },
  gold:     { name:"Gold",     bg:"#1a1500", panel:"#120f00", card:"#2d2500", hover:"#3d3200", ac:"#ffc107", ac2:"#ffe082" },
  custom:   { name:"Custom",   bg:"#222831", panel:"#1a1f26", card:"#2D4059", hover:"#354d6e", ac:"#FF5722", ac2:"#ff8a65" },
};

const uid = () => Math.random().toString(36).slice(2,10);

// Works in Electron (native dialog) and browser (file input fallback)
const pickImageFile = () => new Promise((resolve) => {
  if (window.electronAPI?.isElectron) {
    window.electronAPI.pickImage().then(resolve);
    return;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp,image/gif";
  input.onchange = () => {
    const file = input.files[0];
    if (!file) { resolve(null); return; }
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.readAsDataURL(file);
  };
  input.click();
});
const load = () => { try { const s=localStorage.getItem("aura_games"); return s?JSON.parse(s):DEMO_GAMES; } catch { return DEMO_GAMES; } };
const save = (g) => { try { localStorage.setItem("aura_games",JSON.stringify(g)); } catch {} };
const loadProfile = () => { try { const s=localStorage.getItem("aura_profile"); return s?JSON.parse(s):null; } catch { return null; } };
const saveProfile = (p) => { try { localStorage.setItem("aura_profile",JSON.stringify(p)); } catch {} };
const loadTheme = () => { try { const s=localStorage.getItem("aura_theme"); return s||"midnight"; } catch { return "midnight"; } };
const saveTheme = (t) => { try { localStorage.setItem("aura_theme",t); } catch {} };
const loadAccent = () => { try { return localStorage.getItem("aura_accent")||null; } catch { return null; } };
const saveAccent = (a) => { try { localStorage.setItem("aura_accent",a); } catch {} };
const loadCustomTheme = () => { try { const s=localStorage.getItem("aura_custom_theme"); return s?JSON.parse(s):null; } catch { return null; } };
const saveCustomTheme = (t) => { try { localStorage.setItem("aura_custom_theme",JSON.stringify(t)); } catch {} };

const ACHIEVEMENTS = [
  { id:"first_launch",    title:"First Launch",   description:"Launch your first game",        icon:"🎮", condition:(s)=>s.totalLaunches>=1 },
  { id:"five_games_added",title:"Collector I",    description:"Add 5 games to your library",   icon:"📚", condition:(s)=>s.gamesAdded>=5 },
  { id:"ten_games_added", title:"Collector II",   description:"Add 10 games to your library",  icon:"📚", condition:(s)=>s.gamesAdded>=10 },
  { id:"one_hour",        title:"Getting Started",description:"Play for 1 hour total",         icon:"⏱", condition:(s)=>s.totalPlaytimeHours>=1 },
  { id:"ten_hours",       title:"Dedicated",      description:"Play for 10 hours total",       icon:"🔥", condition:(s)=>s.totalPlaytimeHours>=10 },
  { id:"fifty_hours",     title:"No Life",        description:"Play for 50 hours total",       icon:"💀", condition:(s)=>s.totalPlaytimeHours>=50 },
  { id:"first_favorite",  title:"First Pick",     description:"Favorite a game",               icon:"⭐", condition:(s)=>s.favoritesCount>=1 },
  { id:"five_favorites",  title:"Top Tier",       description:"Favorite 5 games",              icon:"🌟", condition:(s)=>s.favoritesCount>=5 },
  { id:"three_day_streak",title:"On a Roll",      description:"Play 3 days in a row",          icon:"🔥", condition:(s)=>s.streakDays>=3 },
  { id:"seven_day_streak",title:"Unstoppable",    description:"Play 7 days in a row",          icon:"⚡", condition:(s)=>s.streakDays>=7 },
  { id:"five_games_played",title:"Explorer",      description:"Play 5 different games",        icon:"🧭", condition:(s)=>s.gamesPlayedCount>=5 },
  { id:"ten_games_played",title:"Adventurer",     description:"Play 10 different games",       icon:"🌍", condition:(s)=>s.gamesPlayedCount>=10 },
];

const loadAchievements = () => { try { const s=localStorage.getItem("aura_achievements"); return s?JSON.parse(s):{}; } catch { return {}; } };
const saveAchievements = (a) => { try { localStorage.setItem("aura_achievements",JSON.stringify(a)); } catch {} };
const loadStats = () => { try { const s=localStorage.getItem("aura_stats"); return s?JSON.parse(s):{totalLaunches:0,gamesAdded:0,totalPlaytimeHours:0,favoritesCount:0,streakDays:0,gamesPlayedCount:0,lastPlayedDate:null,playedGameIds:[]}; } catch { return {totalLaunches:0,gamesAdded:0,totalPlaytimeHours:0,favoritesCount:0,streakDays:0,gamesPlayedCount:0,lastPlayedDate:null,playedGameIds:[]}; } };
const saveStats = (s) => { try { localStorage.setItem("aura_stats",JSON.stringify(s)); } catch {} };

const fmtTime = (ms) => {
  if (!ms) return null;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return "~1m";
};

const applyTheme = (themeKey, customAccent, customColors) => {
  const t = themeKey === "custom" && customColors
    ? { ...THEMES.midnight, ...customColors }
    : (THEMES[themeKey] || THEMES.midnight);
  const root = document.documentElement;
  root.style.setProperty("--bg", t.bg);
  root.style.setProperty("--panel", t.panel);
  root.style.setProperty("--card", t.card);
  root.style.setProperty("--hover", t.hover);
  const ac = customAccent || t.ac;
  const ac2 = t.ac2 || ac;
  root.style.setProperty("--ac", ac);
  root.style.setProperty("--ac2", ac2);
  const hex2rgb = (hex) => {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `${r},${g},${b}`;
  };
  try {
    const rgb = hex2rgb(ac);
    root.style.setProperty("--acd", `rgba(${rgb},0.13)`);
    root.style.setProperty("--acg", `rgba(${rgb},0.35)`);
  } catch {}
};

const S = `
@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=DM+Sans:wght@300;400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0e0e10;--panel:#141418;--card:#1c1c22;--hover:#242430;
  --border:rgba(255,255,255,0.06);--borderb:rgba(255,255,255,0.12);
  --ac:#FF5722;--acd:rgba(255,87,34,0.13);--acg:rgba(255,87,34,0.35);
  --ac2:#ff8a65;--danger:#ff4d6d;
  --t1:#ffffff;--t2:#8b8b9e;--t3:#3a3a4a;
  --sw:220px;--fw:260px;
  --radius:14px;
}
body,html{background:var(--bg);color:var(--t1);font-family:'DM Sans',sans-serif;overflow:hidden;height:100vh;width:100vw;margin:0;padding:0;}
::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.06);border-radius:2px}
@keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes fadeOut{from{opacity:1}to{opacity:0}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulse{0%{box-shadow:0 0 0 0 var(--acg)}70%{box-shadow:0 0 0 10px transparent}100%{box-shadow:0 0 0 0 transparent}}
@keyframes splash-load{from{width:0%}to{width:100%}}

/* SPLASH */
.splash{position:fixed;inset:0;background:var(--bg);z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;animation:fadeIn .3s ease;}
.splash.hide{animation:fadeOut .5s ease forwards;}
.splash-logo{font-family:'Rajdhani',sans-serif;font-size:56px;font-weight:700;letter-spacing:10px;background:linear-gradient(90deg,var(--ac),var(--ac2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.app-bg{position:fixed;inset:0;background-size:cover;background-position:center;z-index:0;pointer-events:none;}
.app-bg-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:0;pointer-events:none;}
.app,.gm-app{z-index:1;}
.splash-sub{font-size:11px;color:#00aaff;letter-spacing:4px;text-transform:uppercase;}
.splash-bar{width:200px;height:2px;background:var(--border);border-radius:2px;overflow:hidden;margin-top:8px;}
.splash-fill{height:100%;background:linear-gradient(90deg,var(--ac),var(--ac2));border-radius:2px;animation:splash-load 1.8s ease forwards;}

/* PROFILE SETUP */
.setup{position:fixed;inset:0;background:var(--bg);z-index:999;display:flex;align-items:center;justify-content:center;animation:fadeIn .4s ease;}
.setup-box{background:var(--panel);border:1px solid var(--borderb);border-radius:18px;padding:36px;width:380px;display:flex;flex-direction:column;align-items:center;gap:20px;box-shadow:0 28px 72px rgba(0,0,0,.65);}
.setup-logo{font-family:'Rajdhani',sans-serif;font-size:36px;font-weight:700;letter-spacing:8px;background:linear-gradient(90deg,var(--ac),var(--ac2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.setup-sub{font-size:12px;color:var(--t3);letter-spacing:2px;text-transform:uppercase;margin-top:-12px;}
.setup-avatar-wrap{position:relative;cursor:pointer;}
.setup-avatar{width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid var(--ac);background:var(--card);}
.setup-avatar-placeholder{width:80px;height:80px;border-radius:50%;background:var(--card);border:3px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:32px;cursor:pointer;transition:all .15s;}
.setup-avatar-placeholder:hover{border-color:var(--ac);}
.setup-avatar-label{font-size:10px;color:var(--t3);margin-top:6px;text-align:center;}
.setup-w{width:100%;}

/* APP LAYOUT */
.app{display:flex;height:100vh;width:100vw;min-width:100vw;background:var(--bg);overflow:hidden;position:fixed;top:0;left:0;}

/* SIDEBAR — used in Library view */
.sb{width:var(--sw);min-width:var(--sw);background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column}
.sb-logo{padding:16px 12px 14px;display:flex;align-items:center;gap:10px;min-height:64px;}
.sb.collapsed .sb-logo{justify-content:center;padding:16px 0 14px;flex-direction:column;gap:8px;}
.sb-li{width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,var(--ac),var(--ac2));display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;box-shadow:0 4px 12px var(--acg)}
.sb-lt{font-family:'Rajdhani',sans-serif;font-size:20px;font-weight:700;letter-spacing:4px;background:linear-gradient(90deg,var(--ac),var(--ac2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.sb-profile{padding:14px 16px;border-top:1px solid var(--border);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:11px;cursor:pointer;transition:all .15s;margin:0 0 6px;}
.sb-profile:hover{background:var(--hover);}
.sb-pav{width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid var(--ac);flex-shrink:0;background:var(--card);}
.sb-pav-ph{width:36px;height:36px;border-radius:50%;background:var(--acd);border:2px solid var(--ac);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}
.sb-pname{font-size:13px;font-weight:600;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.sb-pedit{font-size:10px;color:var(--t2);margin-top:1px;}
.sb-sec{padding:10px 10px 6px}
.sb-sl{font-size:9px;font-weight:600;letter-spacing:2px;color:var(--t3);text-transform:uppercase;padding:0 10px;margin-bottom:6px}
.sb-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;cursor:pointer;color:var(--t2);font-size:13px;font-weight:500;transition:all .15s;position:relative;margin-bottom:2px;border:1px solid transparent;user-select:none}
.sb-item:hover{background:var(--hover);color:var(--t1)}
.sb-item.on{background:rgba(255,87,34,0.1);color:var(--ac);border-color:rgba(255,87,34,0.2)}
.sb-item.on::before{content:'';position:absolute;left:0;top:50%;transform:translateY(-50%);width:3px;height:60%;background:var(--ac);border-radius:0 3px 3px 0}
.sb-badge{margin-left:auto;background:var(--ac);color:#fff;font-size:10px;font-weight:700;padding:1px 7px;border-radius:20px;min-width:20px;text-align:center;}
.sb-foot{margin-top:auto;padding:16px 12px;border-top:1px solid var(--border)}
.sb-stat{background:linear-gradient(135deg,var(--card),var(--hover));border:1px solid var(--border);border-radius:12px;padding:14px 16px}
.sb-stat-l{font-size:9px;color:var(--t2);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px}
.sb-stat-v{font-family:'Rajdhani',sans-serif;font-size:28px;font-weight:700;color:var(--ac);line-height:1}
.sb-stat-s{font-size:10px;color:var(--t2);margin-top:3px}

/* MAIN */
.main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}
.hdr{background:transparent;padding:14px 24px;display:flex;align-items:center;gap:14px;flex-shrink:0;border-bottom:1px solid var(--border);}
.hdr-title{font-family:'Rajdhani',sans-serif;font-size:18px;font-weight:700;letter-spacing:2px;color:var(--t2);white-space:nowrap;text-transform:uppercase;}
.srch{display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:8px 14px;flex:1;max-width:320px;transition:all .2s}
.srch:focus-within{border-color:var(--ac);box-shadow:0 0 0 3px var(--acd)}
.srch input{background:none;border:none;outline:none;color:var(--t1);font-size:12.5px;width:100%;font-family:'DM Sans',sans-serif}
.srch input::placeholder{color:var(--t3)}
.hdr-r{display:flex;align-items:center;gap:8px;margin-left:auto}
.btn-p{display:flex;align-items:center;gap:6px;background:var(--ac);color:#fff;border:none;border-radius:10px;padding:8px 16px;font-size:12px;font-weight:700;cursor:pointer;transition:all .15s;white-space:nowrap;font-family:'DM Sans',sans-serif;letter-spacing:.3px}
.btn-p:hover{filter:brightness(1.12);transform:translateY(-1px);box-shadow:0 6px 18px var(--acg)}
.btn-p:active{transform:translateY(0)}
.btn-g{display:flex;align-items:center;gap:5px;background:var(--card);color:var(--t2);border:1px solid var(--border);border-radius:10px;padding:8px 12px;font-size:11.5px;font-weight:500;cursor:pointer;transition:all .15s;font-family:'DM Sans',sans-serif}
.btn-g:hover{border-color:var(--borderb);color:var(--t1)}

.fbar{padding:12px 24px 10px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--border);background:var(--bg);flex-shrink:0}
.chip{padding:5px 14px;border-radius:20px;font-size:11px;font-weight:600;cursor:pointer;transition:all .15s;border:1px solid var(--border);color:var(--t2);background:transparent;font-family:'DM Sans',sans-serif;letter-spacing:.2px}
.chip:hover{border-color:var(--ac);color:var(--ac)}
.chip.on{background:var(--ac);border-color:var(--ac);color:#fff;box-shadow:0 2px 10px var(--acg)}

.gc{flex:1;overflow-y:auto;padding:20px 24px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:14px}

.card{position:relative;border-radius:var(--radius);overflow:hidden;cursor:pointer;transition:transform .28s cubic-bezier(.34,1.56,.64,1),box-shadow .25s ease;background:var(--card);border:1px solid var(--border);animation:fadeUp .4s ease both}
.card:hover{transform:translateY(-8px) scale(1.02);box-shadow:0 24px 48px rgba(0,0,0,.7),0 0 0 1px var(--borderb),0 0 30px var(--acg);border-color:var(--borderb);z-index:2}
.card-img-w{position:relative;aspect-ratio:3/4;overflow:hidden;cursor:pointer;}
.card-img{width:100%;height:100%;object-fit:cover;transition:transform .4s ease;pointer-events:none;}
.card:hover .card-img{transform:scale(1.08)}
.card-ov{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.96) 0%,rgba(0,0,0,.4) 50%,transparent 100%);opacity:0;transition:opacity .22s;display:flex;flex-direction:column;justify-content:flex-end;padding:12px;pointer-events:none;}
.card:hover .card-ov{opacity:1;pointer-events:all;}
.play-btn{display:flex;align-items:center;justify-content:center;gap:6px;background:var(--ac);color:#fff;border:none;border-radius:8px;padding:9px;font-size:11px;font-weight:800;cursor:pointer;transition:all .15s;width:100%;font-family:'Rajdhani',sans-serif;letter-spacing:1.8px;box-shadow:0 4px 14px var(--acg)}
.play-btn:hover{filter:brightness(1.1)}
.c-acts{display:flex;gap:5px;margin-bottom:8px}
.c-act{background:rgba(0,0,0,.7);border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:6px;cursor:pointer;color:var(--t2);transition:all .15s;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px)}
.c-act:hover{color:var(--t1);border-color:rgba(255,255,255,.3)}
.c-act.fav.on{color:var(--danger);border-color:rgba(255,77,109,.4)}
.card-info{padding:10px 12px 12px;background:var(--card);cursor:pointer;}
.card-title{font-size:12px;font-weight:700;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:5px;font-family:'Rajdhani',sans-serif;letter-spacing:.5px;}
.card-meta{display:flex;align-items:center;justify-content:space-between}
.card-cat{font-size:9px;color:var(--ac);background:var(--acd);border-radius:4px;padding:2px 7px;font-weight:700;letter-spacing:.5px}
.card-plays{font-size:9px;color:var(--t3)}
.fav-badge{position:absolute;top:8px;right:8px;color:var(--danger);z-index:2;filter:drop-shadow(0 0 6px rgba(255,77,109,.6))}
.img-fb{width:100%;aspect-ratio:3/4;background:var(--hover);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:var(--t3);font-size:28px;pointer-events:none;}
.img-fb span{font-size:10px;font-weight:600}

.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:260px;gap:10px;color:var(--t3)}
.empty-icon{font-size:44px}
.empty-t{font-size:15px;font-weight:600;color:var(--t2)}
.empty-s{font-size:11px;text-align:center;max-width:240px}

.sh{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.sh-t{font-family:'Rajdhani',sans-serif;font-size:15px;font-weight:700;letter-spacing:1px}
.sh-c{font-size:11px;color:var(--t3);margin-left:7px}

.mbk{position:fixed;inset:0;background:rgba(0,0,0,.85);backdrop-filter:blur(10px);z-index:100;display:flex;align-items:center;justify-content:center;animation:fadeIn .2s ease}
.modal{background:var(--panel);border:1px solid var(--borderb);border-radius:18px;width:430px;max-width:calc(100vw - 30px);max-height:calc(100vh - 60px);overflow-y:auto;animation:fadeUp .22s ease;box-shadow:0 32px 80px rgba(0,0,0,.7),0 0 0 1px var(--acg)}
.mh{padding:20px 22px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
.mt{font-family:'Rajdhani',sans-serif;font-size:17px;font-weight:700;letter-spacing:1.5px}
.mc{background:var(--hover);border:1px solid var(--border);border-radius:8px;padding:5px;cursor:pointer;color:var(--t2);transition:all .15s;display:flex;align-items:center;justify-content:center}
.mc:hover{color:var(--t1)}
.mb{padding:20px 22px}
.fg{margin-bottom:14px}
.fl{display:block;font-size:10px;font-weight:600;color:var(--t2);margin-bottom:5px;letter-spacing:.5px;text-transform:uppercase}
.fi{width:100%;background:var(--card);border:1px solid var(--border);border-radius:9px;padding:10px 13px;color:var(--t1);font-size:12.5px;font-family:'DM Sans',sans-serif;transition:all .15s;outline:none}
.fi:focus{border-color:var(--ac);box-shadow:0 0 0 3px var(--acd)}
.fs{width:100%;background:var(--card);border:1px solid var(--border);border-radius:9px;padding:10px 13px;color:var(--t1);font-size:12.5px;font-family:'DM Sans',sans-serif;transition:all .15s;outline:none;cursor:pointer}
.fs:focus{border-color:var(--ac);box-shadow:0 0 0 3px var(--acd)}
.fs option{background:var(--panel)}
.mf{padding:14px 22px 20px;display:flex;gap:8px;justify-content:flex-end}
.btn-gh{background:transparent;border:1px solid var(--border);color:var(--t2);border-radius:9px;padding:8px 16px;font-size:12px;font-weight:500;cursor:pointer;transition:all .15s;font-family:'DM Sans',sans-serif}
.btn-gh:hover{border-color:var(--borderb);color:var(--t1)}
.btn-d{background:rgba(255,77,109,.11);border:1px solid rgba(255,77,109,.28);color:var(--danger);border-radius:9px;padding:8px 16px;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;font-family:'DM Sans',sans-serif}
.btn-d:hover{background:rgba(255,77,109,.2)}
.cprev{width:100%;aspect-ratio:3/4;max-height:150px;object-fit:cover;border-radius:9px;margin-top:7px;border:1px solid var(--border)}
.del-warn{background:rgba(255,77,109,.08);border:1px solid rgba(255,77,109,.2);border-radius:9px;padding:12px 14px;margin-bottom:14px;font-size:12px;color:var(--t2)}
.del-name{font-weight:700;color:var(--danger)}

.launch{position:fixed;inset:0;background:rgba(0,0,0,.95);z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;animation:fadeIn .3s ease;gap:18px}
.l-spin{width:48px;height:48px;border-radius:50%;border:3px solid var(--borderb);border-top-color:var(--ac);animation:spin .8s linear infinite}
.l-t{font-family:'Rajdhani',sans-serif;font-size:28px;font-weight:700;letter-spacing:4px;color:var(--ac)}
.l-s{font-size:12px;color:var(--t2)}
.l-p{font-size:10px;color:var(--t3);margin-top:2px;max-width:300px;text-align:center;word-break:break-all}

.tc{position:fixed;bottom:20px;right:20px;z-index:300;display:flex;flex-direction:column;gap:8px}
.toast{background:var(--panel);border:1px solid var(--borderb);border-radius:10px;padding:12px 16px;font-size:11.5px;color:var(--t1);animation:fadeUp .25s ease;box-shadow:0 10px 28px rgba(0,0,0,.5);max-width:280px;display:flex;align-items:center;gap:8px}
.toast.ok{border-color:var(--acg)}
.toast.err{border-color:rgba(255,77,109,.35)}
.tdot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.toast.ok .tdot{background:var(--ac)}
.toast.err .tdot{background:var(--danger)}

.sc{padding:24px;overflow-y:auto;flex:1;}
.ss{margin-bottom:28px;}
.ss-t{font-family:'Rajdhani',sans-serif;font-size:13px;font-weight:700;letter-spacing:2px;margin-bottom:12px;color:var(--t2);text-transform:uppercase;}
.ss-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
.sr{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border);gap:12px;}
.sr:last-child{border-bottom:none;}
.sr>div:first-child{flex:1;min-width:0;}
.sr-l{font-size:13px;font-weight:500;color:var(--t1);text-align:left;}
.sr-s{font-size:10.5px;color:var(--t3);margin-top:2px;text-align:left;}
.tog{width:40px;height:22px;border-radius:11px;background:var(--hover);border:1px solid var(--border);cursor:pointer;position:relative;transition:all .2s;flex-shrink:0}
.tog.on{background:var(--ac);border-color:var(--ac)}
.tog::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .2s}
.tog.on::after{transform:translateX(18px)}

/* THEME PICKER */
.theme-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;padding:12px 15px}
.theme-swatch{border-radius:8px;padding:10px 8px;cursor:pointer;border:2px solid transparent;transition:all .15s;display:flex;flex-direction:column;align-items:center;gap:6px;}
.theme-swatch.on{border-color:var(--ac);}
.theme-swatch:hover{transform:translateY(-2px);}
.theme-dot{width:28px;height:28px;border-radius:50%;}
.theme-name{font-size:10px;font-weight:600;color:var(--t2);}
.accent-row{display:flex;align-items:center;gap:10px;padding:12px 15px;border-top:1px solid var(--border);}
.accent-label{font-size:11px;color:var(--t2);flex:1;}
.accent-input{width:36px;height:36px;border-radius:8px;border:1px solid var(--border);cursor:pointer;padding:2px;background:var(--card);}
.accent-reset{font-size:10px;color:var(--t3);cursor:pointer;text-decoration:underline;}
.accent-reset:hover{color:var(--t1);}

/* CUSTOMIZE SCREEN */
.cust{flex:1;overflow-y:auto;padding:24px;}
.cust-preview{border-radius:12px;overflow:hidden;border:1px solid var(--border);margin-bottom:24px;height:120px;display:flex;align-items:center;justify-content:center;position:relative;transition:all .3s;}
.cust-preview-label{font-family:'Rajdhani',sans-serif;font-size:28px;font-weight:700;letter-spacing:6px;background:linear-gradient(90deg,var(--ac),var(--ac2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.cust-preview-sub{font-size:11px;color:var(--t2);letter-spacing:2px;margin-top:4px;}
.cust-section{margin-bottom:24px;}
.cust-section-title{font-family:'Rajdhani',sans-serif;font-size:13px;font-weight:700;letter-spacing:1.5px;color:var(--t2);text-transform:uppercase;margin-bottom:10px;}
.cust-row{display:flex;align-items:center;justify-content:space-between;padding:11px 14px;background:var(--card);border:1px solid var(--border);border-radius:8px;margin-bottom:6px;}
.cust-row-label{font-size:12px;font-weight:500;color:var(--t1);}
.cust-row-sub{font-size:10px;color:var(--t3);margin-top:2px;}
.cust-color{width:32px;height:32px;border-radius:6px;border:2px solid var(--border);cursor:pointer;padding:2px;background:transparent;}
.cust-actions{display:flex;gap:8px;margin-top:8px;}
.cust-theme-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:6px;}
.cust-swatch{border-radius:8px;padding:10px 6px;cursor:pointer;border:2px solid transparent;transition:all .15s;display:flex;flex-direction:column;align-items:center;gap:5px;}
.cust-swatch.on{border-color:var(--ac);}
.cust-swatch:hover{transform:translateY(-2px);}
.cust-dot{width:24px;height:24px;border-radius:50%;}
.cust-name{font-size:9px;font-weight:600;color:var(--t2);text-align:center;}

/* ACHIEVEMENTS */
.ach-screen{flex:1;overflow-y:auto;padding:24px;}
.ach-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;}
.ach-title{font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:700;letter-spacing:2px;}
.ach-progress{font-size:11px;color:var(--t2);}
.ach-bar-wrap{height:3px;background:var(--border);border-radius:2px;margin-bottom:24px;overflow:hidden;}
.ach-bar-fill{height:100%;background:linear-gradient(90deg,var(--ac),var(--ac2));border-radius:2px;transition:width .5s ease;}
.ach-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;}
.ach-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:18px;display:flex;flex-direction:column;gap:8px;transition:all .2s;position:relative;overflow:hidden;}
.ach-card.unlocked{border-color:var(--acg);background:linear-gradient(135deg,var(--card),var(--acd));}
.ach-card.locked{opacity:.4;filter:grayscale(.6);}
.ach-card-icon{font-size:30px;line-height:1;}
.ach-card-title{font-size:15px;font-weight:700;color:var(--t1);font-family:'Rajdhani',sans-serif;letter-spacing:.5px;}
.ach-card-desc{font-size:12px;color:var(--t2);}
.ach-card-date{font-size:10px;color:var(--ac);margin-top:2px;font-weight:600;}
.ach-card-lock{position:absolute;top:12px;right:12px;font-size:14px;opacity:.3;}
.ach-card.unlocked .ach-card-lock{display:none;}
.ach-glow{position:absolute;inset:0;background:linear-gradient(135deg,var(--acg),transparent);opacity:.08;pointer-events:none;}

/* ACHIEVEMENT TOAST */
.ach-toast{background:linear-gradient(135deg,var(--panel),var(--card));border:1px solid var(--ac);border-radius:14px;padding:14px 18px;font-size:11.5px;color:var(--t1);animation:fadeUp .3s ease;box-shadow:0 10px 32px var(--acg);max-width:290px;display:flex;align-items:center;gap:12px;}
.ach-toast-icon{font-size:26px;flex-shrink:0;}
.ach-toast-body{}
.ach-toast-label{font-size:9px;color:var(--ac);font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:2px;}
.ach-toast-title{font-size:14px;font-weight:700;font-family:'Rajdhani',sans-serif;letter-spacing:.5px;}

/* SPOTLIGHT */
@keyframes spotlightIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
.spotlight{position:relative;height:360px;flex-shrink:0;overflow:hidden;}
.spotlight-bg{position:absolute;inset:0;background-size:cover;background-position:center;filter:blur(28px) brightness(.28);transform:scale(1.1);transition:background-image .7s ease;}
.spotlight-grad{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(14,14,16,.2) 0%,rgba(14,14,16,.5) 50%,rgba(14,14,16,1) 100%);}
.spotlight-content{position:relative;z-index:1;display:flex;align-items:flex-end;gap:28px;padding:28px 32px;height:100%;}
.spotlight-cover{width:130px;aspect-ratio:3/4;object-fit:cover;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.8);border:1px solid rgba(255,255,255,.08);flex-shrink:0;}
.spotlight-info{flex:1;min-width:0;animation:spotlightIn .45s ease;}
.spotlight-cat{font-size:10px;color:var(--ac);background:rgba(255,87,34,.15);border:1px solid rgba(255,87,34,.3);border-radius:5px;padding:3px 10px;font-weight:700;letter-spacing:1.5px;display:inline-block;margin-bottom:10px;text-transform:uppercase;}
.spotlight-title{font-family:'Rajdhani',sans-serif;font-size:42px;font-weight:700;letter-spacing:1px;color:#fff;margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 2px 20px rgba(0,0,0,.5);}
.spotlight-meta{font-size:11px;color:rgba(255,255,255,.4);margin-bottom:18px;letter-spacing:.3px;}
.spotlight-actions{display:flex;gap:10px;align-items:center;}
.spotlight-dots{position:absolute;bottom:14px;right:20px;display:flex;gap:5px;z-index:2;}
.spotlight-dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.2);cursor:pointer;transition:all .25s;}
.spotlight-dot.on{background:var(--ac);width:20px;border-radius:3px;}
.spotlight-arr{position:absolute;top:50%;transform:translateY(-50%);z-index:2;background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:7px 10px;cursor:pointer;color:rgba(255,255,255,.6);font-size:16px;transition:all .15s;backdrop-filter:blur(4px);}
.spotlight-arr:hover{background:rgba(0,0,0,.75);color:#fff;}
.spotlight-arr.left{left:12px;}
.spotlight-arr.right{right:12px;}

/* HOME / GM LAYOUT */
.gm-app{display:flex;height:100vh;width:100vw;background:var(--bg);overflow:hidden;position:fixed;top:0;left:0;}
.gm-rail{width:64px;min-width:64px;background:rgba(0,0,0,.6);backdrop-filter:blur(20px);border-right:1px solid var(--border);display:flex;flex-direction:column;align-items:center;padding:16px 0;gap:4px;z-index:10;}
.gm-rail-logo{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,var(--ac),var(--ac2));display:flex;align-items:center;justify-content:center;font-size:14px;margin-bottom:16px;box-shadow:0 4px 14px var(--acg);}
.gm-rail-item{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--t3);transition:all .18s;position:relative;}
.gm-rail-item:hover{background:var(--hover);color:var(--t2);}
.gm-rail-item.on{background:var(--acd);color:var(--ac);}
.gm-rail-item.on::before{content:'';position:absolute;left:0;top:50%;transform:translateY(-50%);width:3px;height:60%;background:var(--ac);border-radius:0 3px 3px 0;}
.gm-rail-badge{position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:var(--ac);border:2px solid var(--bg);}
.gm-rail-avatar{width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid var(--ac);cursor:pointer;margin-top:auto;margin-bottom:8px;}
.gm-rail-avatar-ph{width:36px;height:36px;border-radius:50%;background:var(--acd);border:2px solid var(--ac);display:flex;align-items:center;justify-content:center;font-size:16px;cursor:pointer;margin-top:auto;margin-bottom:8px;}
.gm-main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0;}

/* FULL WIDTH BANNER */
.gm-banner{position:relative;height:52vh;min-height:300px;flex-shrink:0;overflow:hidden;}
.gm-banner-bg{position:absolute;inset:0;background-size:cover;background-position:center top;filter:blur(0px) brightness(.55);transform:scale(1.02);transition:all .8s ease;}
.gm-banner-grad{position:absolute;inset:0;background:linear-gradient(to right,rgba(0,0,0,.92) 0%,rgba(0,0,0,.5) 50%,transparent 100%),linear-gradient(to top,var(--bg) 0%,transparent 40%);}
.gm-banner-content{position:relative;z-index:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;padding:32px 40px;}
.gm-banner-cat{font-size:10px;color:var(--ac);font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px;}
.gm-banner-title{font-family:'Rajdhani',sans-serif;font-size:52px;font-weight:700;letter-spacing:1px;color:#fff;line-height:1;margin-bottom:10px;text-shadow:0 2px 30px rgba(0,0,0,.5);}
.gm-banner-meta{font-size:12px;color:rgba(255,255,255,.5);margin-bottom:20px;letter-spacing:.3px;}
.gm-banner-actions{display:flex;gap:10px;align-items:center;}
.gm-banner-dots{position:absolute;bottom:16px;right:24px;display:flex;gap:6px;z-index:2;}
.gm-banner-dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.25);cursor:pointer;transition:all .25s;}
.gm-banner-dot.on{background:var(--ac);width:22px;border-radius:3px;}

/* SHELF */
.gm-content{flex:1;overflow-y:auto;padding:20px 0 40px;}
.gm-shelf{margin-bottom:28px;}
.gm-shelf-hdr{display:flex;align-items:center;justify-content:space-between;padding:0 40px;margin-bottom:12px;}
.gm-shelf-title{font-family:'Rajdhani',sans-serif;font-size:16px;font-weight:700;letter-spacing:1.5px;color:var(--t1);}
.gm-shelf-count{font-size:11px;color:var(--t3);}
.gm-shelf-row{display:flex;gap:12px;padding:4px 40px 8px;overflow-x:auto;scrollbar-width:none;}
.gm-shelf-row::-webkit-scrollbar{display:none;}
.gm-card{flex-shrink:0;width:140px;border-radius:10px;overflow:hidden;cursor:pointer;transition:transform .25s cubic-bezier(.34,1.56,.64,1),box-shadow .2s;background:var(--card);border:1px solid var(--border);position:relative;}
.gm-card:hover{transform:translateY(-8px) scale(1.04);box-shadow:0 20px 40px rgba(0,0,0,.7),0 0 0 1px var(--borderb),0 0 20px var(--acg);z-index:2;}
.gm-card-img{width:100%;aspect-ratio:3/4;object-fit:cover;}
.gm-card-grad{position:absolute;bottom:0;left:0;right:0;height:55%;background:linear-gradient(to top,rgba(0,0,0,.95) 0%,transparent 100%);}
.gm-card-info{position:absolute;bottom:0;left:0;right:0;padding:10px 10px 8px;}
.gm-card-title{font-family:'Rajdhani',sans-serif;font-size:13px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.3px;}
.gm-card-cat{font-size:9px;color:var(--ac);font-weight:700;letter-spacing:.5px;margin-top:2px;}
.gm-card-play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);opacity:0;transition:opacity .18s;backdrop-filter:blur(2px);}
.gm-card:hover .gm-card-play{opacity:1;}
.gm-card-play-btn{background:var(--ac);border:none;border-radius:50%;width:42px;height:42px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;box-shadow:0 4px 16px var(--acg);transition:transform .15s;}
.gm-card-play-btn:hover{transform:scale(1.12);}
.gm-card-fav{position:absolute;top:7px;right:7px;color:var(--danger);filter:drop-shadow(0 0 4px rgba(255,77,109,.6));z-index:3;}

/* HOME SEARCH BAR */
.gm-search-bar{position:absolute;top:16px;right:24px;z-index:5;display:flex;align-items:center;gap:8px;}
.gm-srch{display:flex;align-items:center;gap:8px;background:rgba(0,0,0,.6);border:1px solid var(--border);border-radius:10px;padding:8px 14px;width:145px;backdrop-filter:blur(10px);transition:all .2s;}
.gm-srch:focus-within{border-color:var(--ac);box-shadow:0 0 0 3px var(--acd);}
.gm-srch input{background:none;border:none;outline:none;color:var(--t1);font-size:12px;width:100%;font-family:'DM Sans',sans-serif;}
.gm-srch input::placeholder{color:var(--t3);}

/* MADE FOR SHELF */
.gm-made-for{margin-bottom:28px;}
.gm-made-for-hdr{padding:0 40px;margin-bottom:4px;}
.gm-made-for-label{font-size:11px;color:var(--t2);letter-spacing:.5px;}
.gm-made-for-title{font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:700;letter-spacing:1.5px;color:var(--t1);}
.gm-made-for-row{display:flex;gap:12px;padding:12px 40px 8px;overflow-x:auto;scrollbar-width:none;}
.gm-made-for-row::-webkit-scrollbar{display:none;}
.gm-mf-card{flex-shrink:0;width:180px;height:60px;border-radius:10px;overflow:hidden;cursor:pointer;display:flex;align-items:center;gap:12px;background:var(--card);border:1px solid var(--border);padding:0 12px 0 0;transition:all .2s;position:relative;}
.gm-mf-card:hover{background:var(--hover);border-color:var(--borderb);transform:translateY(-2px);}
.gm-mf-card-img{width:60px;height:60px;object-fit:cover;flex-shrink:0;}
.gm-mf-card-info{flex:1;min-width:0;}
.gm-mf-card-title{font-size:12px;font-weight:700;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:'Rajdhani',sans-serif;letter-spacing:.3px;}
.gm-mf-card-sub{font-size:10px;color:var(--t2);margin-top:2px;}
.gm-mf-card-play{position:absolute;right:12px;width:32px;height:32px;border-radius:50%;background:var(--ac);border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;opacity:0;transition:all .15s;box-shadow:0 4px 12px var(--acg);}
.gm-mf-card:hover .gm-mf-card-play{opacity:1;}

/* CURRENTLY PLAYING BAR */
.now-playing{position:fixed;bottom:0;left:0;right:0;height:72px;background:rgba(10,10,12,.92);backdrop-filter:blur(20px);border-top:1px solid var(--border);z-index:500;display:flex;align-items:center;padding:0 24px;gap:16px;animation:fadeUp .3s ease;}
.np-cover{width:48px;height:48px;border-radius:8px;object-fit:cover;border:1px solid var(--border);flex-shrink:0;}
.np-cover-ph{width:48px;height:48px;border-radius:8px;background:var(--card);border:1px solid var(--border);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:20px;}
.np-info{flex:1;min-width:0;}
.np-title{font-size:13px;font-weight:700;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:'Rajdhani',sans-serif;letter-spacing:.5px;}
.np-status{font-size:10px;color:var(--ac);margin-top:2px;display:flex;align-items:center;gap:5px;}
.np-dot{width:6px;height:6px;border-radius:50%;background:var(--ac);animation:pulse 2s infinite;}
.np-timer{font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:700;color:var(--t1);letter-spacing:2px;flex-shrink:0;}
.np-close{background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:8px;padding:6px 14px;font-size:11px;font-weight:600;color:var(--t2);cursor:pointer;transition:all .15s;font-family:'DM Sans',sans-serif;flex-shrink:0;}
.np-close:hover{background:rgba(255,77,109,.15);border-color:rgba(255,77,109,.3);color:var(--danger);}

/* SIDEBAR COLLAPSED */
.sb.collapsed{width:64px;min-width:64px;}
.sb.collapsed .sb-lt{display:none;}
.sb.collapsed .sb-profile{justify-content:center;padding:12px 0;}
.sb.collapsed .sb-pname,.sb.collapsed .sb-pedit{display:none;}
.sb.collapsed .sb-sl{display:none;}
.sb.collapsed .sb-item{justify-content:center;padding:10px 0;}
.sb.collapsed .sb-item span{display:none;}
.sb.collapsed .sb-badge{display:none;}
.sb.collapsed .sb-stat{display:none;}
.sb.collapsed .sb-foot{padding:12px 10px;}
.sb-toggle{background:var(--acd);border:1px solid var(--acg);color:var(--ac);cursor:pointer;padding:6px;border-radius:8px;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0;}
.sb-toggle:hover{background:var(--ac);color:#fff;}
.sb,.gm-rail{transition:width .2s ease,min-width .2s ease;}

/* GM RAIL EXPANDED */
.gm-rail.expanded{width:200px;min-width:200px;align-items:flex-start;padding:16px 10px;}
.gm-rail.expanded .gm-rail-logo{margin-left:4px;}
.gm-rail.expanded .gm-rail-item{width:100%;border-radius:10px;padding:0 12px;gap:10px;justify-content:flex-start;}
.gm-rail.expanded .gm-rail-item-label{display:block;font-size:13px;font-weight:500;font-family:'DM Sans',sans-serif;}
.gm-rail-item-label{display:none;}
.gm-rail.expanded .gm-rail-avatar,.gm-rail.expanded .gm-rail-avatar-ph{margin-left:4px;}
.gm-rail-toggle{background:var(--acd);border:1px solid var(--acg);color:var(--ac);cursor:pointer;padding:6px;border-radius:8px;display:flex;align-items:center;justify-content:center;transition:all .15s;margin-bottom:8px;}
.gm-rail-toggle:hover{background:var(--ac);color:#fff;}
.hero{flex:1;display:flex;overflow:hidden;position:relative;}
.hero-bg{position:absolute;inset:0;background-size:cover;background-position:center;filter:blur(20px) brightness(0.4);transform:scale(1.1);z-index:0;}
.hero-content{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;gap:20px;padding:40px;}
.hero-cover{width:180px;aspect-ratio:3/4;object-fit:cover;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.6);border:2px solid rgba(255,255,255,0.1);}
.hero-title{font-family:'Rajdhani',sans-serif;font-size:42px;font-weight:700;letter-spacing:2px;text-align:center;color:var(--t1);}
.hero-cat{font-size:11px;color:var(--ac);background:var(--acd);border-radius:4px;padding:3px 12px;font-weight:600;letter-spacing:1px;}
.hero-plays{font-size:12px;color:var(--t2);}
.hero-actions{display:flex;gap:12px;margin-top:10px;}
.hero-play{display:flex;align-items:center;gap:8px;background:var(--ac);color:#fff;border:none;border-radius:10px;padding:14px 36px;font-size:15px;font-weight:800;cursor:pointer;font-family:'Rajdhani',sans-serif;letter-spacing:2px;transition:all .15s;}
.hero-play:hover{filter:brightness(1.1);transform:translateY(-2px);box-shadow:0 8px 24px var(--acg);}
.hero-back{display:flex;align-items:center;gap:6px;background:var(--card);color:var(--t2);border:1px solid var(--border);border-radius:8px;padding:8px 16px;font-size:12px;font-weight:500;cursor:pointer;font-family:'DM Sans',sans-serif;transition:all .15s;}
.hero-back:hover{color:var(--t1);border-color:var(--borderb);}
.hero-fav{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px 14px;cursor:pointer;color:var(--t2);transition:all .15s;display:flex;align-items:center;}
.hero-fav:hover{color:var(--danger);}
.hero-fav.on{color:var(--danger);border-color:rgba(255,77,109,.3);}

/* TWITCH SHELF */
.twitch-shelf{margin-bottom:28px;}
.twitch-shelf-hdr{display:flex;align-items:center;justify-content:space-between;padding:0 40px;margin-bottom:16px;}
.twitch-shelf-title{font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:700;letter-spacing:1px;color:var(--t1);display:flex;align-items:center;gap:10px;}
.twitch-live-dot{width:10px;height:10px;border-radius:50%;background:#eb0400;flex-shrink:0;box-shadow:0 0 8px #eb0400;animation:pulse 2s infinite;}
.twitch-row{display:flex;gap:14px;padding:4px 40px 12px;overflow-x:auto;scrollbar-width:none;}
.twitch-row::-webkit-scrollbar{display:none;}
.twitch-card{flex-shrink:0;width:200px;height:200px;border-radius:14px;overflow:hidden;cursor:pointer;position:relative;border:1px solid rgba(255,255,255,.07);transition:transform .22s,box-shadow .22s;}
.twitch-card:hover{transform:translateY(-6px) scale(1.04);box-shadow:0 20px 48px rgba(0,0,0,.8),0 0 0 2px #9147ff;}
.twitch-thumb{width:100%;height:100%;object-fit:cover;display:block;transition:transform .35s;}
.twitch-card:hover .twitch-thumb{transform:scale(1.08);}
.twitch-thumb-ph{width:100%;height:100%;background:linear-gradient(135deg,#1a1a2e,#2d1b69);display:flex;align-items:center;justify-content:center;font-size:42px;}
.twitch-badge{position:absolute;top:10px;left:10px;background:linear-gradient(90deg,#eb0400,#9147ff);color:#fff;font-size:9px;font-weight:800;padding:3px 9px;border-radius:20px;letter-spacing:1.5px;display:flex;align-items:center;gap:4px;z-index:2;}
.twitch-badge-dot{width:5px;height:5px;border-radius:50%;background:#fff;}
.twitch-ov{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.92) 0%,rgba(0,0,0,.3) 55%,transparent 100%);opacity:0;transition:opacity .2s;display:flex;flex-direction:column;justify-content:flex-end;padding:14px;z-index:3;}
.twitch-card:hover .twitch-ov{opacity:1;}
.twitch-user{font-family:'Rajdhani',sans-serif;font-size:15px;font-weight:700;color:#fff;letter-spacing:.3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.twitch-game{font-size:10px;color:#9147ff;font-weight:700;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.twitch-viewers-row{display:flex;align-items:center;gap:5px;font-size:10px;color:rgba(255,255,255,.7);font-weight:600;margin-top:3px;}
.twitch-viewer-dot{width:6px;height:6px;border-radius:50%;background:#eb0400;flex-shrink:0;}
.twitch-watch-btn{width:100%;background:rgba(145,71,255,.85);border:none;color:#fff;border-radius:8px;padding:8px;font-size:11px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;letter-spacing:.3px;transition:all .15s;margin-top:8px;backdrop-filter:blur(4px);}
.twitch-watch-btn:hover{background:#9147ff;}
.twitch-empty{padding:0 40px;font-size:11px;color:var(--t3);}

/* FRIENDS PANEL */
.fp{width:var(--fw);min-width:var(--fw);background:var(--panel);border-left:1px solid var(--border);display:flex;flex-direction:column;}
.fp-hdr{padding:16px 16px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
.fp-title{font-family:'Rajdhani',sans-serif;font-size:14px;font-weight:700;letter-spacing:1.5px;color:var(--t1)}
.fp-body{flex:1;overflow-y:auto;padding:12px}
.fp-login{display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;gap:12px;text-align:center;padding:20px}
.fp-login-icon{font-size:36px}
.fp-login-t{font-size:13px;font-weight:600;color:var(--t2)}
.fp-login-s{font-size:11px;color:var(--t3);margin-bottom:4px}
.fp-user{display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--card);border-radius:8px;margin-bottom:12px;border:1px solid var(--border)}
.fp-avatar{width:32px;height:32px;border-radius:50%;object-fit:cover;border:2px solid var(--ac)}
.fp-username{font-size:12px;font-weight:600;color:var(--t1)}
.fp-tag{font-size:10px;color:var(--ac)}
.fp-section-label{font-size:9px;font-weight:600;letter-spacing:2px;color:var(--t3);text-transform:uppercase;margin:10px 0 6px;padding:0 2px}
.friend-item{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:8px;margin-bottom:4px;transition:all .15s;border:1px solid transparent;}
.friend-item:hover{background:var(--hover);border-color:var(--border)}
.friend-avatar-wrap{position:relative;flex-shrink:0}
.friend-avatar{width:34px;height:34px;border-radius:50%;object-fit:cover}
.friend-status-dot{position:absolute;bottom:0;right:0;width:10px;height:10px;border-radius:50%;border:2px solid var(--panel)}
.friend-status-dot.online{background:#43b581}
.friend-status-dot.idle{background:#faa61a}
.friend-status-dot.dnd{background:#f04747}
.friend-status-dot.offline{background:#747f8d}
.friend-info{flex:1;min-width:0}
.friend-name{font-size:12px;font-weight:600;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.friend-activity{font-size:10px;color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.friend-invite{background:var(--acd);border:1px solid var(--acg);color:var(--ac);border-radius:5px;padding:3px 8px;font-size:10px;font-weight:600;cursor:pointer;transition:all .15s;white-space:nowrap;font-family:'DM Sans',sans-serif}
.friend-invite:hover{background:var(--ac);color:#fff}
.fp-empty{text-align:center;padding:20px;color:var(--t3);font-size:11px}
.fp-refresh{background:transparent;border:none;color:var(--t3);cursor:pointer;padding:4px;border-radius:4px;transition:all .15s;display:flex;align-items:center;justify-content:center}
.fp-refresh:hover{color:var(--t1)}
`;

const Ic = {
  Menu:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>,
  MenuClose:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Home:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  Lib:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16"><path d="M4 19V5a2 2 0 0 1 2-2h11a1 1 0 0 1 1 1v14"/><path d="M4 17h14"/><path d="M9 3v14"/></svg>,
  Clock:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  Heart:({f})=><svg viewBox="0 0 24 24" fill={f?"currentColor":"none"} stroke="currentColor" strokeWidth="1.8" width="16" height="16"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>,
  Gear:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  Plus:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Search:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>,
  Play:()=><svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
  Edit:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="13" height="13"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  Trash:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>,
  X:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Sort:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="9" y1="18" x2="15" y2="18"/></svg>,
  Ctrl:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="15" height="15"><rect x="2" y="6" width="20" height="12" rx="6"/><path d="M6 12h4"/><path d="M8 10v4"/><circle cx="16" cy="11" r="1" fill="currentColor"/><circle cx="18" cy="13" r="1" fill="currentColor"/></svg>,
  Discord:()=><svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.101 18.08.114 18.1.132 18.11a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>,
  Refresh:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>,
  Steam:()=><svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.879L12 22l1.562-.121C18.343 21.128 22 16.991 22 12c0-5.523-4.477-10-10-10zm0 2c4.418 0 8 3.582 8 8 0 4.072-3.05 7.443-7 7.938V18h-2v1.938C7.05 19.443 4 16.072 4 12c0-4.418 3.582-8 8-8zm-4 7v2h2v2h2v-2h2v-2h-2V9h-2v2H8z"/></svg>,
  User:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>,
  Trophy:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16"><path d="M6 9H4a2 2 0 0 1-2-2V5h4"/><path d="M18 9h2a2 2 0 0 0 2-2V5h-4"/><path d="M12 17v4"/><path d="M8 21h8"/><path d="M6 5h12v6a6 6 0 0 1-12 0V5z"/></svg>,
  Palette:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16"><circle cx="12" cy="12" r="10"/><circle cx="8.5" cy="14.5" r="1.5" fill="currentColor"/><circle cx="15.5" cy="14.5" r="1.5" fill="currentColor"/><circle cx="12" cy="9" r="1.5" fill="currentColor"/></svg>,
  Tv:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>,
};

// ── Profile Setup ─────────────────────────────────────────────────────────────
function ProfileSetup({ onComplete }) {
  const [username, setUsername] = useState("");
  const [avatar, setAvatar] = useState("");
  const [avatarErr, setAvatarErr] = useState(false);
  const handleSave = () => {
    if (!username.trim()) return;
    const profile = { username: username.trim(), avatar: avatar.trim(), createdAt: Date.now() };
    saveProfile(profile);
    onComplete(profile);
  };
  return (
    <div className="setup">
      <div className="setup-box">
        <div className="setup-logo">AURA</div>
        <div className="setup-sub">Set up your profile</div>
        <div className="setup-avatar-wrap">
          {avatar && !avatarErr
            ? <img src={avatar} alt="avatar" className="setup-avatar" onError={()=>setAvatarErr(true)}/>
            : <div className="setup-avatar-placeholder">🎮</div>
          }
          <div className="setup-avatar-label">Avatar preview</div>
        </div>
        <div className="setup-w">
          <div className="fg">
            <label className="fl">Username *</label>
            <input className="fi" value={username} onChange={e=>setUsername(e.target.value)} placeholder="Enter a username" onKeyDown={e=>e.key==="Enter"&&handleSave()} autoFocus/>
          </div>
          <div className="fg" style={{marginBottom:0}}>
            <label className="fl">Avatar (optional)</label>
            <div style={{display:"flex",gap:8}}>
              <input className="fi" value={avatar} onChange={e=>{setAvatar(e.target.value);setAvatarErr(false);}} placeholder="https://... or browse" style={{flex:1}}/>
              <button className="btn-p" style={{flexShrink:0}} onClick={async()=>{const result=await pickImageFile();if(result){setAvatar(result);setAvatarErr(false);}}}>Browse</button>
            </div>
          </div>
        </div>
        <button className="btn-p" style={{width:"100%",justifyContent:"center",padding:"11px"}} onClick={handleSave} disabled={!username.trim()}>Enter AURA</button>
      </div>
    </div>
  );
}

// ── Friends Panel ─────────────────────────────────────────────────────────────
function FriendItem({ friend, onInvite }) {
  return (
    <div className="friend-item">
      <div className="friend-avatar-wrap">
        <img className="friend-avatar" src={friend.avatar} alt={friend.username}/>
        <div className={`friend-status-dot ${friend.status}`}/>
      </div>
      <div className="friend-info">
        <div className="friend-name">{friend.username}</div>
        <div className="friend-activity">{friend.activity ? `Playing ${friend.activity}` : friend.status==="offline" ? "Offline" : "Online"}</div>
      </div>
      {friend.status!=="offline"&&<button className="friend-invite" onClick={()=>onInvite(friend)}>Invite</button>}
    </div>
  );
}

function FriendsPanel({ launching, toast }) {
  const [user,setUser]=useState(null);
  const [friends,setFriends]=useState([]);
  const [loading,setLoading]=useState(false);
  const [loggedIn,setLoggedIn]=useState(false);
  const [steamTab,setSteamTab]=useState("discord");
  const [steamId,setSteamId]=useState(()=>localStorage.getItem("aura_steam_id")||"");
  const [steamProfile,setSteamProfile]=useState(null);
  const [steamGames,setSteamGames]=useState([]);
  const [steamFriends,setSteamFriends]=useState([]);
  const [xboxProfile,setXboxProfile]=useState(null);
  const [xboxGames,setXboxGames]=useState([]);

  useEffect(()=>{
    if(!window.electronAPI?.isElectron) return;
    window.electronAPI.onDiscordAuthSuccess(async()=>{ await loadUser(); await loadFriends(); });
    return()=>window.electronAPI.removeDiscordAuthListener?.();
  },[]);

  const loadUser=async()=>{ const res=await window.electronAPI.discordGetUser(); if(res.success){setUser(res.user);setLoggedIn(true);} };
  const loadFriends=async()=>{
    setLoading(true);
    if(window.electronAPI?.isElectron){
      // Try RPC friends first (requires Discord desktop running)
      try {
        const rpcResult=await window.electronAPI.rpcGetFriends();
        if(rpcResult.success&&rpcResult.friends.length>0){setFriends(rpcResult.friends);setLoading(false);return;}
      } catch {}
      // Fall back to OAuth friends
      if(loggedIn){
        const res=await window.electronAPI.discordGetFriends();
        if(res.success) setFriends(res.friends);
      }
    }
    setLoading(false);
  };
  const handleLogin=async()=>{ if(!window.electronAPI?.isElectron){toast("Discord only works in the desktop app","err");return;} await window.electronAPI.discordLogin(); toast("Discord login opened in browser — sign in to continue"); };
  const handleLogout=async()=>{ await window.electronAPI.discordLogout(); setUser(null);setFriends([]);setLoggedIn(false); toast("Disconnected from Discord"); };
  const handleInvite=async(friend)=>{ if(!launching){toast("Launch a game first to invite friends","err");return;} const res=await window.electronAPI.discordInviteFriend(friend.id,launching.title); if(res.success) toast(`Invite sent to ${friend.username}!`); else toast(`Invite failed: ${res.error}`,"err"); };

  return(
    <div className="fp">
      <div className="fp-hdr">
        <span className="fp-title">FRIENDS</span>
        {loggedIn&&steamTab==="discord"&&<button className="fp-refresh" onClick={loadFriends} title="Refresh"><Ic.Refresh/></button>}
      </div>
      <div className="fp-body">
        <div style={{display:"flex",borderBottom:"1px solid var(--border)",marginBottom:12}}>
          {["discord","steam","xbox"].map(t=>(
            <button key={t} onClick={()=>setSteamTab(t)} style={{flex:1,padding:"8px 0",border:"none",background:"transparent",color:steamTab===t?"var(--ac)":"var(--t3)",fontSize:10,fontWeight:700,cursor:"pointer",borderBottom:steamTab===t?"2px solid var(--ac)":"2px solid transparent",textTransform:"uppercase",letterSpacing:1}}>{t}</button>
          ))}
        </div>

        {steamTab==="discord"&&(
          <>
            {!loggedIn?(
              <div className="fp-login">
                <div className="fp-login-icon">💬</div>
                <div className="fp-login-t">Connect Discord</div>
                <div className="fp-login-s">See friends, their status, and invite them to games</div>
                <button className="btn-p" onClick={handleLogin} style={{fontSize:11,padding:"7px 16px",gap:"6px"}}><Ic.Discord/> Login with Discord</button>
              </div>
            ):(
              <>
                {user&&(
                  <div className="fp-user">
                    <img className="fp-avatar" src={user.avatar?`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`:`https://cdn.discordapp.com/embed/avatars/0.png`} alt={user.username}/>
                    <div style={{flex:1,minWidth:0}}><div className="fp-username">{user.username}</div><div className="fp-tag">Connected</div></div>
                    <button className="btn-gh" onClick={handleLogout} style={{fontSize:10,padding:"4px 8px"}}>Logout</button>
                  </div>
                )}
                {loading?<div className="fp-empty">Loading friends...</div>:friends.length===0?<div className="fp-empty">No friends found</div>:(
                  <>
                    {friends.filter(f=>f.status!=="offline").length>0&&(<><div className="fp-section-label">Online — {friends.filter(f=>f.status!=="offline").length}</div>{friends.filter(f=>f.status!=="offline").map(f=><FriendItem key={f.id} friend={f} onInvite={handleInvite}/>)}</>)}
                    {friends.filter(f=>f.status==="offline").length>0&&(<><div className="fp-section-label">Offline — {friends.filter(f=>f.status==="offline").length}</div>{friends.filter(f=>f.status==="offline").map(f=><FriendItem key={f.id} friend={f} onInvite={handleInvite}/>)}</>)}
                  </>
                )}
              </>
            )}
          </>
        )}

        {steamTab==="steam"&&(
          <div>
            {!steamProfile?(
              <div style={{padding:"12px 0"}}>
                <div className="fp-login-t" style={{marginBottom:8}}>Enter Steam ID</div>
                <div className="fp-login-s" style={{marginBottom:10}}>Find it at steamcommunity.com/id/yourname</div>
                <input className="fi" value={steamId} onChange={e=>setSteamId(e.target.value)} placeholder="76561198xxxxxxxxx" style={{marginBottom:8}}/>
                <button className="btn-p" style={{width:"100%",justifyContent:"center"}} onClick={async()=>{
                  if(!steamId.trim()) return;
                  localStorage.setItem("aura_steam_id",steamId.trim());
                  const res=await window.electronAPI.steamGetProfile(steamId.trim());
                  if(res.success) setSteamProfile(res.player);
                  else toast("Steam profile not found","err");
                }}>Connect Steam</button>
              </div>
            ):(
              <div>
                <div className="fp-user" style={{marginBottom:12}}>
                  <img className="fp-avatar" src={steamProfile.avatarmedium} alt={steamProfile.personaname}/>
                  <div style={{flex:1,minWidth:0}}><div className="fp-username">{steamProfile.personaname}</div><div className="fp-tag">Steam Connected</div></div>
                  <button className="btn-gh" onClick={()=>{setSteamProfile(null);localStorage.removeItem("aura_steam_id");}} style={{fontSize:10,padding:"4px 8px"}}>Logout</button>
                </div>
                <div style={{display:"flex",gap:6,marginBottom:10}}>
                  <button className="btn-p" style={{flex:1,justifyContent:"center",fontSize:10,padding:"6px"}} onClick={async()=>{const res=await window.electronAPI.steamGetPlaytime(steamId);if(res.success){setSteamGames(res.games.sort((a,b)=>b.playtime_forever-a.playtime_forever).slice(0,10));setSteamFriends([]);}}}>Top Games</button>
                  <button className="btn-p" style={{flex:1,justifyContent:"center",fontSize:10,padding:"6px"}} onClick={async()=>{const res=await window.electronAPI.steamGetFriendsProfiles(steamId);if(res.success){setSteamFriends(res.friends);setSteamGames([]);}else toast("Friends list is private or empty","err");}}>Friends</button>
                </div>
                {steamGames.length>0&&(<div><div className="fp-section-label">Top Played Games</div>{steamGames.map(g=>(<div key={g.appid} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:"1px solid var(--border)"}}><img src={`https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg`} alt={g.name} style={{width:32,height:32,borderRadius:4}}/><div style={{flex:1,minWidth:0}}><div style={{fontSize:11,fontWeight:600,color:"var(--t1)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.name}</div><div style={{fontSize:9,color:"var(--t3)"}}>{Math.round(g.playtime_forever/60)}h played</div></div></div>))}</div>)}
                {steamFriends.length>0&&(<div>
                  <div className="fp-section-label">Online — {steamFriends.filter(f=>f.status==="online").length}</div>
                  {steamFriends.filter(f=>f.status==="online").map(f=>(<div key={f.id} className="friend-item"><div className="friend-avatar-wrap"><img className="friend-avatar" src={f.avatar} alt={f.username}/><div className="friend-status-dot online"/></div><div className="friend-info"><div className="friend-name">{f.username}</div><div className="friend-activity">{f.activity?`Playing ${f.activity}`:"Online"}</div></div></div>))}
                  <div className="fp-section-label">Offline — {steamFriends.filter(f=>f.status==="offline").length}</div>
                  {steamFriends.filter(f=>f.status==="offline").map(f=>(<div key={f.id} className="friend-item"><div className="friend-avatar-wrap"><img className="friend-avatar" src={f.avatar} alt={f.username}/><div className="friend-status-dot offline"/></div><div className="friend-info"><div className="friend-name">{f.username}</div><div className="friend-activity">Offline</div></div></div>))}
                </div>)}
              </div>
            )}
          </div>
        )}

        {steamTab==="xbox"&&(
          <div>
            {!xboxProfile?(
              <div className="fp-login">
                <div className="fp-login-icon">🎮</div>
                <div className="fp-login-t">Connect Xbox</div>
                <div className="fp-login-s">Shows your Xbox achievements and recent games</div>
                <button className="btn-p" style={{fontSize:11,padding:"7px 16px"}} onClick={async()=>{const res=await window.electronAPI.xboxGetProfile();if(res.success) setXboxProfile(res.profile);else toast("Xbox connection failed — check your API key","err");}}>Connect Xbox</button>
              </div>
            ):(
              <div>
                <div className="fp-user" style={{marginBottom:12}}>
                  <div style={{flex:1,minWidth:0}}><div className="fp-username">Xbox Connected</div><div className="fp-tag">OpenXBL</div></div>
                  <button className="btn-gh" onClick={()=>setXboxProfile(null)} style={{fontSize:10,padding:"4px 8px"}}>Logout</button>
                </div>
                <button className="btn-p" style={{width:"100%",justifyContent:"center",marginBottom:8}} onClick={async()=>{
                  const res=await window.electronAPI.xboxGetRecentGames();
                  if(res.success){
                    const titles=Array.isArray(res.games)?res.games:res.games?.titles||[];
                    setXboxGames(titles);
                    if(!titles.length) toast("No recent Xbox games found","err");
                  } else toast(res.error||"Could not load Xbox games","err");
                }}>Load Recent Games</button>
                {xboxGames.length>0&&(<div><div className="fp-section-label">Recent Games</div>{xboxGames.slice(0,10).map(g=>(<div key={g.titleId} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:"1px solid var(--border)"}}>{g.displayImage&&<img src={g.displayImage} alt={g.name} style={{width:32,height:32,borderRadius:4}}/>}<div style={{flex:1,minWidth:0}}><div style={{fontSize:11,fontWeight:600,color:"var(--t1)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.name}</div><div style={{fontSize:9,color:"var(--t3)"}}>{g.achievement?.currentAchievements||0} / {g.achievement?.totalAchievements||0} achievements</div></div></div>))}</div>)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────
function Card({game,onPlay,onFav,onEdit,onDel,onSelect,style}){
  const [err,setErr]=useState(false);
  return(
    <div className="card" style={style}>
      {game.favorite&&<div className="fav-badge"><Ic.Heart f/></div>}
      <div className="card-img-w">
        {!err&&game.cover?<img src={game.cover} alt={game.title} className="card-img" onError={()=>setErr(true)}/>:<div className="img-fb"><span>🎮</span><span>{game.title.slice(0,8)}</span></div>}
        <div className="card-ov">
          <div className="c-acts">
            <button className={`c-act fav ${game.favorite?"on":""}`} onClick={e=>{e.stopPropagation();onFav(game.id)}}><Ic.Heart f={game.favorite}/></button>
            <button className="c-act" onClick={e=>{e.stopPropagation();onEdit(game)}}><Ic.Edit/></button>
            <button className="c-act" onClick={e=>{e.stopPropagation();onDel(game)}}><Ic.Trash/></button>
            <button className="c-act" onClick={e=>{e.stopPropagation();onSelect&&onSelect(game);}} title="View"><Ic.Lib/></button>
          </div>
          <button className="play-btn" onClick={e=>{e.stopPropagation();onPlay(game)}}><Ic.Play/> LAUNCH</button>
        </div>
      </div>
      <div className="card-info" onClick={()=>onSelect&&onSelect(game)}>
        <div className="card-title" title={game.title}>{game.title}</div>
        <div className="card-meta"><span className="card-cat">{game.category}</span><span className="card-plays">{game.totalTime ? fmtTime(game.totalTime) : `${game.playCount||0}×`}</span></div>
      </div>
    </div>
  );
}

// ── Hero View ─────────────────────────────────────────────────────────────────
function HeroView({ game, onBack, onPlay, onFav }) {
  const [videoId, setVideoId] = useState(null);
  const [loadingTrailer, setLoadingTrailer] = useState(false);
  const [showTrailer, setShowTrailer] = useState(false);

  const fetchTrailer = async () => {
    if (videoId) { setShowTrailer(true); return; }
    setLoadingTrailer(true);
    if (window.electronAPI?.isElectron) {
      const res = await window.electronAPI.fetchTrailer(game.title);
      if (res.success) { setVideoId(res.videoId); setShowTrailer(true); }
    } else {
      // Dev: use YouTube search embed — no API key needed
      setVideoId(`__search__${encodeURIComponent(game.title + " official trailer")}`);
      setShowTrailer(true);
    }
    setLoadingTrailer(false);
  };
  return (
    <div className="hero">
      <div className="hero-bg" style={{backgroundImage:`url(${game.cover})`}}/>
      <div className="hero-content">
        {showTrailer && videoId
          ? <div style={{width:"100%",maxWidth:640,aspectRatio:"16/9",borderRadius:12,overflow:"hidden",boxShadow:"0 20px 60px rgba(0,0,0,.6)",border:"1px solid rgba(255,255,255,.1)"}}>
              <iframe
                width="100%" height="100%"
                src={videoId.startsWith("__search__")
                  ? `https://www.youtube.com/embed?listType=search&list=${videoId.replace("__search__","")}`
                  : `https://www.youtube.com/embed/${videoId}?autoplay=1`
                }
                allow="autoplay; encrypted-media"
                allowFullScreen
                style={{border:"none",display:"block"}}
              />
            </div>
          : game.cover&&<img src={game.cover} alt={game.title} className="hero-cover"/>
        }
        <div className="hero-title">{game.title}</div>
        <div className="hero-cat">{game.category}</div>
        <div className="hero-plays">{game.playCount||0} sessions{game.totalTime ? ` · ${fmtTime(game.totalTime)} played` : ""}</div>
        <div className="hero-actions">
          <button className="hero-back" onClick={onBack}>← Back</button>
          <button className={`hero-fav ${game.favorite?"on":""}`} onClick={()=>onFav(game.id)}><Ic.Heart f={game.favorite}/></button>
          {showTrailer
            ? <button className="hero-back" onClick={()=>setShowTrailer(false)}>✕ Close Trailer</button>
            : <button className="hero-back" onClick={fetchTrailer} disabled={loadingTrailer} style={{opacity:loadingTrailer?.6:1}}>
                {loadingTrailer?"Loading…":"▶ Trailer"}
              </button>
          }
          <button className="hero-play" onClick={()=>onPlay(game)}><Ic.Play/> LAUNCH</button>
        </div>
      </div>
    </div>
  );
}

// ── Spotlight ─────────────────────────────────────────────────────────────────
function Spotlight({ games, onPlay, onFav, onSelect }) {
  const [idx, setIdx] = useState(0);
  const featured = useMemo(() => {
    const withCovers = games.filter(g => g.cover);
    if (withCovers.length === 0) return games.slice(0, 5);
    const favs = withCovers.filter(g => g.favorite);
    const recent = withCovers.filter(g => g.lastPlayed).sort((a,b) => b.lastPlayed - a.lastPlayed);
    return [...new Map([...favs, ...recent, ...withCovers].map(g => [g.id, g])).values()].slice(0, 5);
  }, [games]);
  useEffect(() => {
    if (featured.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % featured.length), 5000);
    return () => clearInterval(t);
  }, [featured.length]);
  if (!featured.length) return null;
  const game = featured[idx];
  return (
    <div className="spotlight">
      <div className="spotlight-bg" style={{backgroundImage:`url(${game.cover})`}}/>
      <div className="spotlight-grad"/>
      <button className="spotlight-arr left" onClick={()=>setIdx(i=>(i-1+featured.length)%featured.length)}>‹</button>
      <button className="spotlight-arr right" onClick={()=>setIdx(i=>(i+1)%featured.length)}>›</button>
      <div className="spotlight-content">
        {game.cover&&<img src={game.cover} alt={game.title} className="spotlight-cover" onClick={()=>onSelect(game)} style={{cursor:"pointer"}}/>}
        <div className="spotlight-info" key={game.id}>
          <div className="spotlight-cat">{game.category}</div>
          <div className="spotlight-title">{game.title}</div>
          <div className="spotlight-meta">{game.playCount||0} sessions{game.totalTime ? ` · ${fmtTime(game.totalTime)} played` : ""}{game.lastPlayed ? ` · Last played ${new Date(game.lastPlayed).toLocaleDateString()}` : ""}</div>
          <div className="spotlight-actions">
            <button className="hero-play" style={{padding:"10px 28px",fontSize:13}} onClick={()=>onPlay(game)}><Ic.Play/> LAUNCH</button>
            <button className={`hero-fav ${game.favorite?"on":""}`} onClick={()=>onFav(game.id)}><Ic.Heart f={game.favorite}/></button>
            <button className="hero-back" onClick={()=>onSelect(game)}>Details</button>
          </div>
        </div>
      </div>
      <div className="spotlight-dots">{featured.map((_,i)=>(<div key={i} className={`spotlight-dot ${i===idx?"on":""}`} onClick={()=>setIdx(i)}/>))}</div>
    </div>
  );
}

// ── GM Card (Home shelf card) ─────────────────────────────────────────────────
function GMCard({ game, onPlay, onFav, onSelect, style }) {
  const [err, setErr] = useState(false);
  return (
    <div className="gm-card" style={style} onClick={() => onSelect(game)}>
      {game.favorite && <div className="gm-card-fav"><Ic.Heart f/></div>}
      {!err && game.cover
        ? <img src={game.cover} alt={game.title} className="gm-card-img" onError={() => setErr(true)}/>
        : <div style={{width:"100%",aspectRatio:"3/4",background:"var(--hover)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>🎮</div>
      }
      <div className="gm-card-grad"/>
      <div className="gm-card-info">
        <div className="gm-card-title">{game.title}</div>
        <div className="gm-card-cat">{game.category}</div>
      </div>
      <div className="gm-card-play">
        <button className="gm-card-play-btn" onClick={e=>{e.stopPropagation();onPlay(game);}}><Ic.Play/></button>
      </div>
    </div>
  );
}

// ── GM Shelf ──────────────────────────────────────────────────────────────────
function GMShelf({ title, games, onPlay, onFav, onSelect, count }) {
  if (!games.length) return null;
  return (
    <div className="gm-shelf">
      <div className="gm-shelf-hdr">
        <span className="gm-shelf-title">{title}</span>
        {count && <span className="gm-shelf-count">{count}</span>}
      </div>
      <div className="gm-shelf-row">
        {games.map((g, i) => <GMCard key={g.id} game={g} onPlay={onPlay} onFav={onFav} onSelect={onSelect} style={{animationDelay:`${i*30}ms`}}/>)}
      </div>
    </div>
  );
}

// ── GM Banner ─────────────────────────────────────────────────────────────────
function GMBanner({ games, onPlay, onFav, onSelect }) {
  const [idx, setIdx] = useState(0);
  const featured = useMemo(() => {
    const withCovers = games.filter(g => g.cover);
    if (!withCovers.length) return games.slice(0, 5);
    const favs = withCovers.filter(g => g.favorite);
    const recent = withCovers.filter(g => g.lastPlayed).sort((a,b) => b.lastPlayed - a.lastPlayed);
    return [...new Map([...favs, ...recent, ...withCovers].map(g => [g.id, g])).values()].slice(0, 5);
  }, [games]);
  useEffect(() => {
    if (featured.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % featured.length), 6000);
    return () => clearInterval(t);
  }, [featured.length]);
  if (!featured.length) return null;
  const game = featured[idx];
  return (
    <div className="gm-banner">
      <div className="gm-banner-bg" style={{backgroundImage:`url(${game.cover})`}}/>
      <div className="gm-banner-grad"/>
      <div className="gm-banner-content">
        <div className="gm-banner-cat"><span style={{width:6,height:6,borderRadius:"50%",background:"var(--ac)",display:"inline-block"}}/>{game.category}</div>
        <div className="gm-banner-title">{game.title}</div>
        <div className="gm-banner-meta">{game.playCount||0} sessions played{game.lastPlayed ? ` · Last played ${new Date(game.lastPlayed).toLocaleDateString()}` : ""}{game.totalTime ? ` · ${fmtTime(game.totalTime)}` : ""}</div>
        <div className="gm-banner-actions">
          <button className="hero-play" style={{padding:"11px 32px",fontSize:14,borderRadius:10}} onClick={()=>onPlay(game)}><Ic.Play/> PLAY NOW</button>
          <button className={`hero-fav ${game.favorite?"on":""}`} onClick={()=>onFav(game.id)} style={{padding:"11px 14px",borderRadius:10}}><Ic.Heart f={game.favorite}/></button>
          <button className="hero-back" onClick={()=>onSelect(game)} style={{padding:"11px 18px",borderRadius:10,fontSize:12}}>Details</button>
        </div>
      </div>
      <div className="gm-banner-dots">{featured.map((_,i)=>(<div key={i} className={`gm-banner-dot ${i===idx?"on":""}`} onClick={()=>setIdx(i)}/>))}</div>
    </div>
  );
}

// ── Now Playing Bar ───────────────────────────────────────────────────────────
function NowPlayingBar({ game, onClose }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const fmt = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };
  return (
    <div className="now-playing">
      {game.cover
        ? <img src={game.cover} alt={game.title} className="np-cover"/>
        : <div className="np-cover-ph">🎮</div>
      }
      <div className="np-info">
        <div className="np-title">{game.title}</div>
        <div className="np-status"><div className="np-dot"/>Now Playing</div>
      </div>
      <div className="np-timer">{fmt(secs)}</div>
      <button className="np-close" onClick={onClose}>✕ Stop</button>
    </div>
  );
}

// ── Friend Activity Shelf ─────────────────────────────────────────────────────
function FriendActivityShelf() {
  const [friends, setFriends] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!window.electronAPI?.isElectron) { setLoaded(true); return; }
    const fetch = async () => {
      const results = [];
      // Discord RPC friends
      try {
        const rpc = await window.electronAPI.rpcGetFriends();
        if (rpc.success) {
          rpc.friends.filter(f => f.activity && f.status !== "offline").forEach(f => {
            results.push({ id:`discord-${f.id}`, name:f.username, avatar:f.avatar, game:f.activity, source:"discord" });
          });
        }
      } catch {}
      // Steam friends
      try {
        const steamId = localStorage.getItem("aura_steam_id");
        if (steamId) {
          const res = await window.electronAPI.steamGetFriendsProfiles(steamId);
          if (res.success) {
            res.friends.filter(f => f.activity && f.status === "online").forEach(f => {
              results.push({ id:`steam-${f.id}`, name:f.username, avatar:f.avatar, game:f.activity, source:"steam" });
            });
          }
        }
      } catch {}
      setFriends(results);
      setLoaded(true);
    };
    fetch();
  }, []);

  if (!loaded || !friends.length) return null;

  return (
    <div className="gm-made-for" style={{marginBottom:28}}>
      <div className="gm-made-for-hdr">
        <div className="gm-made-for-label">Friends</div>
        <div className="gm-made-for-title">Playing Now</div>
      </div>
      <div className="gm-made-for-row">
        {friends.map(f => (
          <div key={f.id} className="gm-mf-card" style={{cursor:"default"}}>
            {f.avatar
              ? <img src={f.avatar} alt={f.name} className="gm-mf-card-img" style={{borderRadius:0}}/>
              : <div style={{width:60,height:60,background:"var(--hover)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>👤</div>
            }
            <div className="gm-mf-card-info">
              <div className="gm-mf-card-title">{f.name}</div>
              <div className="gm-mf-card-sub" style={{color:"var(--ac)"}}>
                <span style={{display:"inline-block",width:6,height:6,borderRadius:"50%",background:"#43b581",marginRight:4,verticalAlign:"middle"}}/>
                {f.game}
              </div>
            </div>
            <div style={{fontSize:9,color:"var(--t3)",flexShrink:0,paddingRight:4}}>
              {f.source==="discord"?"DC":"ST"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Made For Shelf ────────────────────────────────────────────────────────────
function MadeForShelf({ games, username, onPlay, onSelect }) {
  const picks = useMemo(() => {
    if (!games.length) return [];
    // Top category
    const catCounts = {};
    games.forEach(g => { catCounts[g.category] = (catCounts[g.category]||0) + (g.playCount||0); });
    const topCat = Object.entries(catCounts).sort((a,b)=>b[1]-a[1])[0]?.[0];
    const fromTopCat = games.filter(g=>g.category===topCat).sort((a,b)=>(b.playCount||0)-(a.playCount||0)).slice(0,3);
    // Favorites
    const favs = games.filter(g=>g.favorite).slice(0,3);
    // Recent
    const recent = [...games].filter(g=>g.lastPlayed).sort((a,b)=>b.lastPlayed-a.lastPlayed).slice(0,3);
    // Deduplicate
    const pool = [...new Map([...favs,...recent,...fromTopCat].map(g=>[g.id,g])).values()].slice(0,6);
    return pool;
  }, [games]);

  if (!picks.length) return null;

  return (
    <div className="gm-made-for">
      <div className="gm-made-for-hdr">
        <div className="gm-made-for-label">Made For</div>
        <div className="gm-made-for-title">{username}</div>
      </div>
      <div className="gm-made-for-row">
        {picks.map(g => (
          <div key={g.id} className="gm-mf-card" onClick={()=>onSelect(g)}>
            {g.cover
              ? <img src={g.cover} alt={g.title} className="gm-mf-card-img"/>
              : <div style={{width:60,height:60,background:"var(--hover)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>🎮</div>
            }
            <div className="gm-mf-card-info">
              <div className="gm-mf-card-title">{g.title}</div>
              <div className="gm-mf-card-sub">{g.favorite?"⭐ Favorite":g.lastPlayed?`Played ${new Date(g.lastPlayed).toLocaleDateString()}`:g.category}</div>
            </div>
            <button className="gm-mf-card-play" onClick={e=>{e.stopPropagation();onPlay(g);}}>
              <Ic.Play/>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Twitch Shelf ──────────────────────────────────────────────────────────────
function TwitchShelf({ games, onStreamClick }) {
  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [customLogins, setCustomLogins] = useState(() => localStorage.getItem("aura_twitch_logins") || "");
  const [showInput, setShowInput] = useState(false);
  const rowRef = useRef(null);

  const scroll = (dir) => {
    if (rowRef.current) rowRef.current.scrollBy({ left: dir * 440, behavior: "smooth" });
  };

  const fetchStreams = useCallback(async () => {
    if (!window.electronAPI?.isElectron) {
      setStreams([
        { id:"1", user:"shroud",     title:"Valorant ranked grind",      game:"VALORANT",       viewers:45231, thumbnail:"https://static-cdn.jtvnw.net/previews-ttv/live_user_shroud-440x248.jpg",     url:"https://twitch.tv/shroud" },
        { id:"2", user:"pokimane",   title:"Chill games with chat",      game:"Just Chatting",  viewers:28400, thumbnail:"https://static-cdn.jtvnw.net/previews-ttv/live_user_pokimane-440x248.jpg",   url:"https://twitch.tv/pokimane" },
        { id:"3", user:"xQc",        title:"!clip variety day",          game:"Minecraft",      viewers:72100, thumbnail:"https://static-cdn.jtvnw.net/previews-ttv/live_user_xqc-440x248.jpg",        url:"https://twitch.tv/xqc" },
        { id:"4", user:"Myth",       title:"Fortnite with the squad",    game:"Fortnite",       viewers:9800,  thumbnail:"https://static-cdn.jtvnw.net/previews-ttv/live_user_myth-440x248.jpg",        url:"https://twitch.tv/myth" },
        { id:"5", user:"DisguisedToast", title:"Among Us new update",   game:"Among Us",       viewers:15600, thumbnail:"https://static-cdn.jtvnw.net/previews-ttv/live_user_disguisedtoast-440x248.jpg", url:"https://twitch.tv/disguisedtoast" },
      ]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const gameNames = games.filter(g => g.cover).map(g => g.title).slice(0, 10);
    const userLogins = customLogins.split(",").map(s => s.trim()).filter(Boolean);
    try {
      const res = await window.electronAPI.fetchTwitchStreams({ gameNames, userLogins });
      if (res.success) setStreams(res.streams);
      else setStreams([]);
    } catch { setStreams([]); }
    setLoading(false);
  }, [games, customLogins]);

  useEffect(() => {
    fetchStreams();
    const interval = setInterval(fetchStreams, 60000);
    return () => clearInterval(interval);
  }, [fetchStreams]);

  const fmtViewers = (n) => n >= 1000 ? `${(n/1000).toFixed(1)}K` : String(n);

  if (loading) return null;

  return (
    <div className="twitch-shelf">
      <div className="twitch-shelf-hdr">
        <div className="twitch-shelf-title">
          <div className="twitch-live-dot"/>
          LIVE ON TWITCH
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={fetchStreams} style={{background:"transparent",border:"none",color:"var(--t3)",cursor:"pointer",fontSize:11}}>↻ Refresh</button>
          <button onClick={()=>setShowInput(s=>!s)} style={{background:"var(--acd)",border:"1px solid var(--acg)",color:"var(--ac)",borderRadius:6,padding:"3px 10px",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"DM Sans,sans-serif"}}>
            {showInput?"Done":"+ Streamers"}
          </button>
        </div>
      </div>
      {showInput&&(
        <div style={{padding:"0 40px",marginBottom:12}}>
          <input className="fi" value={customLogins} onChange={e=>{setCustomLogins(e.target.value);localStorage.setItem("aura_twitch_logins",e.target.value);}} placeholder="Enter Twitch usernames, comma separated (e.g. shroud, pokimane)" style={{fontSize:11}}/>
          <div style={{fontSize:10,color:"var(--t3)",marginTop:5}}>Also shows streams for games in your library automatically.</div>
        </div>
      )}
      {streams.length === 0
        ? <div className="twitch-empty">No live streams found. Add streamer names above to follow specific channels.</div>
        : (
          <div style={{position:"relative"}}>
            <button onClick={()=>scroll(-1)} style={{position:"absolute",left:16,top:"50%",transform:"translateY(-50%)",zIndex:10,background:"rgba(0,0,0,.7)",border:"1px solid rgba(255,255,255,.15)",color:"#fff",borderRadius:"50%",width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:18,backdropFilter:"blur(6px)"}}>‹</button>
            <div className="twitch-row" ref={rowRef}>
              {streams.map(s => (
                <div key={s.id} className="twitch-card" onClick={()=>onStreamClick&&onStreamClick(s)}>
                  {s.thumbnail ? <img src={s.thumbnail} alt={s.user} className="twitch-thumb"/> : <div className="twitch-thumb-ph">📺</div>}
                  <div className="twitch-badge"><div className="twitch-badge-dot"/>LIVE</div>
                  <div className="twitch-ov">
                    <div className="twitch-user">{s.user}</div>
                    <div className="twitch-game">{s.game}</div>
                    <div className="twitch-viewers-row"><div className="twitch-viewer-dot"/>{fmtViewers(s.viewers)} Viewers</div>
                    <button className="twitch-watch-btn" onClick={e=>{e.stopPropagation();onStreamClick&&onStreamClick(s);}}>Watch Stream</button>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={()=>scroll(1)} style={{position:"absolute",right:16,top:"50%",transform:"translateY(-50%)",zIndex:10,background:"rgba(0,0,0,.7)",border:"1px solid rgba(255,255,255,.15)",color:"#fff",borderRadius:"50%",width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:18,backdropFilter:"blur(6px)"}}>›</button>
          </div>
        )
      }
    </div>
  );
}

// ── Grid ──────────────────────────────────────────────────────────────────────
function Grid({games,onPlay,onFav,onEdit,onDel,onSelect}){
  if(!games.length) return(
    <div className="empty"><div className="empty-icon">🎮</div><div className="empty-t">No games found</div><div className="empty-s">Try a different filter or add a game to your library.</div></div>
  );
  return(
    <div className="grid">{games.map((g,i)=><Card key={g.id} game={g} onPlay={onPlay} onFav={onFav} onEdit={onEdit} onDel={onDel} onSelect={onSelect} style={{animationDelay:`${i*35}ms`}}/>)}</div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function Modal({mode,init,onClose,onSave}){
  const [f,setF]=useState(init||{title:"",exePath:"",cover:"",category:"Action"});
  const [pe,setPe]=useState(false);
  const ch=(k,v)=>{setF(x=>({...x,[k]:v}));if(k==="cover")setPe(false);};
  return(
    <div className="mbk" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div className="mh"><div className="mt">{mode==="add"?"ADD GAME":"EDIT GAME"}</div><button className="mc" onClick={onClose}><Ic.X/></button></div>
        <div className="mb">
          <div className="fg"><label className="fl">Game Title *</label><input className="fi" value={f.title} onChange={e=>ch("title",e.target.value)} placeholder="e.g. Cyberpunk 2077"/></div>
          <div className="fg"><label className="fl">Executable Path</label><div style={{display:"flex",gap:"8px"}}><input className="fi" value={f.exePath} onChange={e=>ch("exePath",e.target.value)} placeholder="C:\Games\game.exe" style={{flex:1}}/><button className="btn-g" onClick={async()=>{if(window.electronAPI?.isElectron){const p=await window.electronAPI.pickExe();if(p) ch("exePath",p);}}}>Browse</button></div></div>
          <div className="fg"><label className="fl">Category</label><select className="fs" value={f.category} onChange={e=>ch("category",e.target.value)}>{CATEGORIES.filter(c=>c!=="All").map(c=><option key={c}>{c}</option>)}</select></div>
          <div className="fg"><label className="fl">Cover Image URL</label><div style={{display:"flex",gap:"8px"}}><input className="fi" value={f.cover} onChange={e=>ch("cover",e.target.value)} placeholder="https://..." style={{flex:1}}/><button className="btn-g" onClick={async()=>{if(!f.title.trim()) return;if(window.electronAPI?.isElectron){const result=await window.electronAPI.fetchCoverArt(f.title);if(result.success) ch("cover",result.url);else alert("Could not find cover art for: "+f.title);}}}>Auto</button></div>{f.cover&&!pe&&<img src={f.cover} alt="" className="cprev" onError={()=>setPe(true)}/>}</div>
        </div>
        <div className="mf"><button className="btn-gh" onClick={onClose}>Cancel</button><button className="btn-p" onClick={()=>f.title.trim()&&onSave(f)}>{mode==="add"?"Add to Library":"Save Changes"}</button></div>
      </div>
    </div>
  );
}

function DelModal({game,onClose,onOk}){
  return(
    <div className="mbk" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div className="mh"><div className="mt">REMOVE GAME</div><button className="mc" onClick={onClose}><Ic.X/></button></div>
        <div className="mb"><div className="del-warn">Remove <span className="del-name">"{game.title}"</span> from your library? This cannot be undone.</div></div>
        <div className="mf"><button className="btn-gh" onClick={onClose}>Cancel</button><button className="btn-d" onClick={onOk}>Remove</button></div>
      </div>
    </div>
  );
}

function ProfileModal({ profile, onClose, onSave }) {
  const [username, setUsername] = useState(profile?.username || "");
  const [avatar, setAvatar] = useState(profile?.avatar || "");
  const [avatarErr, setAvatarErr] = useState(false);
  return (
    <div className="mbk" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div className="mh"><div className="mt">EDIT PROFILE</div><button className="mc" onClick={onClose}><Ic.X/></button></div>
        <div className="mb">
          <div style={{display:"flex",justifyContent:"center",marginBottom:16}}>
            {avatar && !avatarErr
              ? <img src={avatar} alt="avatar" style={{width:64,height:64,borderRadius:"50%",objectFit:"cover",border:"3px solid var(--ac)"}} onError={()=>setAvatarErr(true)}/>
              : <div style={{width:64,height:64,borderRadius:"50%",background:"var(--card)",border:"3px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>🎮</div>
            }
          </div>
          <div className="fg"><label className="fl">Username *</label><input className="fi" value={username} onChange={e=>setUsername(e.target.value)} placeholder="Your username"/></div>
          <div className="fg" style={{marginBottom:0}}>
            <label className="fl">Avatar URL</label>
            <div style={{display:"flex",gap:8}}>
              <input className="fi" value={avatar} onChange={e=>{setAvatar(e.target.value);setAvatarErr(false);}} placeholder="https://... or browse" style={{flex:1}}/>
              <button className="btn-p" style={{flexShrink:0}} onClick={async()=>{const result=await pickImageFile();if(result){setAvatar(result);setAvatarErr(false);}}}>Browse</button>
            </div>
          </div>
        </div>
        <div className="mf"><button className="btn-gh" onClick={onClose}>Cancel</button><button className="btn-p" onClick={()=>{if(!username.trim()) return;onSave({...profile, username:username.trim(), avatar:avatar.trim()});}}>Save</button></div>
      </div>
    </div>
  );
}

// ── Streams View ──────────────────────────────────────────────────────────────
function StreamsView({ games, initialStream, onClear }) {
  const [activeStream, setActiveStream] = useState(initialStream||null);
  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [customLogins, setCustomLogins] = useState(() => localStorage.getItem("aura_twitch_logins") || "");
  const [inputVal, setInputVal] = useState(() => localStorage.getItem("aura_twitch_logins") || "");
  const [chatOpen, setChatOpen] = useState(true);

  const fetchStreams = useCallback(async () => {
    setLoading(true);
    if (window.electronAPI?.isElectron) {
      const gameNames = games.filter(g => g.cover).map(g => g.title).slice(0, 10);
      const userLogins = customLogins.split(",").map(s => s.trim()).filter(Boolean);
      try {
        const res = await window.electronAPI.fetchTwitchStreams({ gameNames, userLogins });
        if (res.success) setStreams(res.streams);
        else setStreams([]);
      } catch { setStreams([]); }
    } else {
      setStreams([
        { id:"1", user:"shroud",     title:"Valorant ranked",     game:"VALORANT",      viewers:45231, thumbnail:"https://static-cdn.jtvnw.net/previews-ttv/live_user_shroud-440x248.jpg",     url:"https://twitch.tv/shroud" },
        { id:"2", user:"pokimane",   title:"Chill games",         game:"Just Chatting", viewers:28400, thumbnail:"https://static-cdn.jtvnw.net/previews-ttv/live_user_pokimane-440x248.jpg",   url:"https://twitch.tv/pokimane" },
        { id:"3", user:"xQc",        title:"Variety day",         game:"Minecraft",     viewers:72100, thumbnail:"https://static-cdn.jtvnw.net/previews-ttv/live_user_xqc-440x248.jpg",        url:"https://twitch.tv/xqc" },
        { id:"4", user:"Myth",       title:"Fortnite squads",     game:"Fortnite",      viewers:9800,  thumbnail:"https://static-cdn.jtvnw.net/previews-ttv/live_user_myth-440x248.jpg",        url:"https://twitch.tv/myth" },
        { id:"5", user:"TimTheTatman",title:"Call of Duty",       game:"Call of Duty",  viewers:18200, thumbnail:"https://static-cdn.jtvnw.net/previews-ttv/live_user_timthetatman-440x248.jpg",url:"https://twitch.tv/timthetatman" },
        { id:"6", user:"NICKMERCS",  title:"Warzone",             game:"Warzone",       viewers:22100, thumbnail:"https://static-cdn.jtvnw.net/previews-ttv/live_user_nickmercs-440x248.jpg",   url:"https://twitch.tv/nickmercs" },
      ]);
    }
    setLoading(false);
  }, [games, customLogins]);

  useEffect(() => { fetchStreams(); }, [fetchStreams]);

  const fmtViewers = (n) => n >= 1000 ? `${(n/1000).toFixed(1)}K` : String(n);

  const player = activeStream ? (
    <div style={{flex:1,display:"flex",flexDirection:"column",background:"#000",minWidth:0}}>
      {/* Stream player */}
      <div style={{flex:1,position:"relative",minHeight:0}}>
        {window.electronAPI?.isElectron
          ? <webview
              src={`https://player.twitch.tv/?channel=${activeStream.userLogin||activeStream.user}&parent=aura-launcher&autoplay=true&muted=false`}
              style={{width:"100%",height:"100%",display:"block"}}
              allowpopups="true"
            />
          : <iframe
              src={`https://player.twitch.tv/?channel=${activeStream.userLogin||activeStream.user}&parent=localhost`}
              style={{width:"100%",height:"100%",border:"none",display:"block"}}
              allowFullScreen
            />
        }
      </div>
      {/* Stream info bar */}
      <div style={{padding:"10px 16px",background:"#0e0e10",borderTop:"1px solid var(--border)",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <div style={{width:8,height:8,borderRadius:"50%",background:"#eb0400",boxShadow:"0 0 6px #eb0400",flexShrink:0}}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:"Rajdhani,sans-serif",fontSize:14,fontWeight:700,color:"var(--t1)",letterSpacing:.3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{activeStream.user}</div>
          <div style={{fontSize:10,color:"var(--t2)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{activeStream.title}</div>
        </div>
        <div style={{fontSize:10,color:"#9147ff",fontWeight:700}}>{activeStream.game}</div>
        <div style={{fontSize:10,color:"var(--t3)"}}>👁 {fmtViewers(activeStream.viewers)}</div>
        <button onClick={()=>setChatOpen(o=>!o)} style={{background:"var(--acd)",border:"1px solid var(--acg)",color:"var(--ac)",borderRadius:6,padding:"4px 10px",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"DM Sans,sans-serif",flexShrink:0}}>{chatOpen?"Hide Chat":"Show Chat"}</button>
        <button onClick={()=>{setActiveStream(null);onClear&&onClear();}} style={{background:"rgba(255,77,109,.1)",border:"1px solid rgba(255,77,109,.3)",color:"var(--danger)",borderRadius:6,padding:"4px 10px",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"DM Sans,sans-serif",flexShrink:0}}>✕ Close</button>
      </div>
    </div>
  ) : null;

  const chat = activeStream && chatOpen ? (
    <div style={{width:300,flexShrink:0,borderLeft:"1px solid var(--border)",background:"#0e0e10"}}>
      {window.electronAPI?.isElectron
        ? <webview
            src={`https://www.twitch.tv/embed/${activeStream.userLogin||activeStream.user}/chat?parent=aura-launcher&darkpopout`}
            style={{width:"100%",height:"100%",display:"block"}}
            allowpopups="true"
          />
        : <iframe
            src={`https://www.twitch.tv/embed/${activeStream.userLogin||activeStream.user}/chat?parent=localhost&darkpopout`}
            style={{width:"100%",height:"100%",border:"none",display:"block"}}
          />
      }
    </div>
  ) : null;

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:"var(--bg)"}}>
      {/* Header */}
      <div style={{padding:"14px 24px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <div style={{width:8,height:8,borderRadius:"50%",background:"#eb0400",boxShadow:"0 0 8px #eb0400",animation:"pulse 2s infinite"}}/>
        <span style={{fontFamily:"Rajdhani,sans-serif",fontSize:18,fontWeight:700,letterSpacing:2,color:"var(--t1)"}}>LIVE STREAMS</span>
        <div style={{flex:1}}/>
        <input
          className="fi" value={inputVal}
          onChange={e=>setInputVal(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter"){ setCustomLogins(inputVal); localStorage.setItem("aura_twitch_logins",inputVal); }}}
          placeholder="Add streamers (comma separated) — press Enter"
          style={{fontSize:11,maxWidth:320}}
        />
        <button className="btn-p" style={{fontSize:11,padding:"7px 14px"}} onClick={()=>{ setCustomLogins(inputVal); localStorage.setItem("aura_twitch_logins",inputVal); fetchStreams(); }}>↻ Refresh</button>
      </div>

      {/* Main area */}
      {activeStream ? (
        <div style={{flex:1,display:"flex",overflow:"hidden"}}>
          {player}
          {chat}
        </div>
      ) : (
        <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>
          {loading ? (
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:200,color:"var(--t3)",fontSize:12}}>Loading streams…</div>
          ) : streams.length === 0 ? (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:200,gap:10,color:"var(--t3)"}}>
              <div style={{fontSize:36}}>📺</div>
              <div style={{fontSize:14,fontWeight:600,color:"var(--t2)"}}>No live streams found</div>
              <div style={{fontSize:11}}>Add streamer names above or launch AURA with your game library</div>
            </div>
          ) : (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:16}}>
              {streams.map(s => (
                <div key={s.id} onClick={()=>setActiveStream(s)} style={{borderRadius:12,overflow:"hidden",cursor:"pointer",background:"var(--card)",border:"1px solid var(--border)",transition:"transform .2s,box-shadow .2s",position:"relative"}}
                  onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-4px)";e.currentTarget.style.boxShadow="0 16px 40px rgba(0,0,0,.6),0 0 0 1px #9147ff55";}}
                  onMouseLeave={e=>{e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow="none";}}>
                  <div style={{position:"relative",aspectRatio:"16/9",overflow:"hidden"}}>
                    {s.thumbnail
                      ? <img src={s.thumbnail} alt={s.user} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
                      : <div style={{width:"100%",height:"100%",background:"linear-gradient(135deg,#1a1a2e,#2d1b69)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:36}}>📺</div>
                    }
                    <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(0,0,0,.6) 0%,transparent 60%)"}}/>
                    <div style={{position:"absolute",top:8,left:8,background:"linear-gradient(90deg,#eb0400,#9147ff)",color:"#fff",fontSize:9,fontWeight:800,padding:"3px 8px",borderRadius:20,letterSpacing:1.5,display:"flex",alignItems:"center",gap:4}}>
                      <div style={{width:5,height:5,borderRadius:"50%",background:"#fff"}}/>LIVE
                    </div>
                    <div style={{position:"absolute",top:8,right:8,background:"rgba(0,0,0,.75)",color:"#fff",fontSize:9,fontWeight:700,padding:"3px 8px",borderRadius:20,backdropFilter:"blur(4px)"}}>👁 {fmtViewers(s.viewers)}</div>
                    <div style={{position:"absolute",bottom:8,left:8,right:8,display:"flex",alignItems:"center",gap:8}}>
                      <div style={{flex:1}}/>
                      <div style={{background:"rgba(145,71,255,.9)",color:"#fff",borderRadius:8,padding:"6px 14px",fontSize:11,fontWeight:700,fontFamily:"Rajdhani,sans-serif",letterSpacing:1}}>▶ Watch</div>
                    </div>
                  </div>
                  <div style={{padding:"12px 14px"}}>
                    <div style={{fontFamily:"Rajdhani,sans-serif",fontSize:15,fontWeight:700,color:"var(--t1)",letterSpacing:.3,marginBottom:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.user}</div>
                    <div style={{fontSize:11,color:"var(--t2)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",marginBottom:4}}>{s.title}</div>
                    <div style={{fontSize:10,color:"#9147ff",fontWeight:700}}>{s.game}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Customize ─────────────────────────────────────────────────────────────────
function Customize({ theme, onThemeChange, accent, onAccentChange, customColors, onCustomColorsChange, bgImage, onBgChange, savedThemes, onSaveTheme, onDeleteTheme, onLoadTheme }) {
  const [local, setLocal] = useState(customColors || {bg:"#222831",panel:"#1a1f26",card:"#2D4059",hover:"#354d6e",ac:"#FF5722",ac2:"#ff8a65"});
  const [tab, setTab] = useState("presets");
  const [ac2color, setAc2color] = useState(customColors?.ac2||"#ff8a65");
  const [saveName, setSaveName] = useState("");
  const [bgInput, setBgInput] = useState(bgImage||"");
  const updateLocal = (key, val) => { const updated={...local,[key]:val};setLocal(updated);if(theme==="custom") onCustomColorsChange(updated); };
  const applyCustom = () => { onCustomColorsChange(local);onThemeChange("custom"); };
  const activeTheme = theme==="custom"&&customColors ? customColors : (THEMES[theme]||THEMES.midnight);
  const previewAc = accent||activeTheme.ac;
  const previewAc2 = ac2color||activeTheme.ac2||previewAc;
  const colorRows = [
    {key:"bg",label:"Background",sub:"Main app background"},
    {key:"panel",label:"Panel",sub:"Sidebar and header"},
    {key:"card",label:"Card",sub:"Game cards and modals"},
    {key:"hover",label:"Hover",sub:"Hover and active states"},
    {key:"ac",label:"Accent",sub:"Primary accent color"},
    {key:"ac2",label:"Accent Light",sub:"Gradient end color"},
  ];
  const quickAccents = ["#FF5722","#cc0000","#1e90ff","#00d4ff","#7c4dff","#43a047","#ffc107","#ff69b4","#00bcd4","#ff6f00","#ffffff","#888888"];
  const gradientPresets = [
    {label:"Sunset",a:"#FF5722",b:"#ff8a65"},
    {label:"Ocean",a:"#1e90ff",b:"#00d4ff"},
    {label:"Purple",a:"#7c4dff",b:"#e040fb"},
    {label:"Fire",a:"#cc0000",b:"#ff6f00"},
    {label:"Forest",a:"#43a047",b:"#00bcd4"},
    {label:"Gold",a:"#ffc107",b:"#ff6f00"},
    {label:"Neon",a:"#00d4ff",b:"#7c4dff"},
    {label:"Rose",a:"#e91e63",b:"#ff5722"},
    {label:"Matrix",a:"#00e676",b:"#00bcd4"},
  ];
  return (
    <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column",background:"var(--bg)"}}>
      <div style={{position:"relative",height:200,flexShrink:0,overflow:"hidden",background:`linear-gradient(135deg,${activeTheme.bg} 0%,${activeTheme.panel} 60%,${activeTheme.card} 100%)`}}>
        <div style={{position:"absolute",width:300,height:300,borderRadius:"50%",background:previewAc,opacity:.06,top:-100,right:-80,filter:"blur(40px)"}}/>
        <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",gap:12,padding:"20px 40px"}}>
          <div style={{width:56,height:130,borderRadius:10,background:activeTheme.panel,border:"1px solid rgba(255,255,255,.06)",flexShrink:0,padding:8,display:"flex",flexDirection:"column",gap:5}}>
            <div style={{width:20,height:20,borderRadius:5,background:`linear-gradient(135deg,${previewAc},${previewAc2})`,marginBottom:4}}/>
            {[70,55,65,50].map((w,i)=>(<div key={i} style={{width:`${w}%`,height:5,borderRadius:3,background:i===0?previewAc:"rgba(255,255,255,.08)"}}/>))}
          </div>
          <div style={{display:"flex",gap:8,flex:1,justifyContent:"center"}}>
            {[1,2,3,4].map(i=>(<div key={i} style={{width:52,height:72,borderRadius:7,overflow:"hidden",background:activeTheme.card,border:"1px solid rgba(255,255,255,.06)",opacity:i===1?1:i===2?.85:i===3?.65:.4,transform:i===1?"translateY(-4px)":"none"}}><div style={{width:"100%",height:48,background:i===1?`linear-gradient(135deg,${previewAc}44,${activeTheme.hover})`:`linear-gradient(135deg,${activeTheme.hover},${activeTheme.card})`}}/></div>))}
          </div>
          <div style={{flexShrink:0,textAlign:"right"}}>
            <div style={{fontFamily:"Rajdhani,sans-serif",fontSize:26,fontWeight:700,letterSpacing:5,background:`linear-gradient(90deg,${previewAc},${previewAc2})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>AURA</div>
            <div style={{fontSize:9,color:"rgba(255,255,255,.3)",letterSpacing:2,marginTop:3,textTransform:"uppercase"}}>{THEMES[theme]?.name||"Custom"} Theme</div>
          </div>
        </div>
        <div style={{position:"absolute",bottom:0,left:0,right:0,height:40,background:"linear-gradient(to bottom,transparent,var(--bg))"}}/>
      </div>
      <div style={{display:"flex",background:"var(--panel)",borderBottom:"1px solid var(--border)",flexShrink:0,padding:"0 4px",overflowX:"auto"}}>
        {[{id:"presets",label:"🎨 Presets"},{id:"custom",label:"🛠 Builder"},{id:"accent",label:"⚡ Accent"},{id:"bg",label:"🖼 BG"},{id:"saved",label:"💾 Saved"}].map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{flexShrink:0,padding:"13px 10px",border:"none",background:"transparent",color:tab===t.id?"var(--ac)":"var(--t3)",fontSize:11,fontWeight:700,cursor:"pointer",letterSpacing:.5,borderBottom:tab===t.id?"2px solid var(--ac)":"2px solid transparent",transition:"all .15s",fontFamily:"DM Sans,sans-serif",whiteSpace:"nowrap"}}>{t.label}</button>
        ))}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"20px 20px 32px"}}>
        {tab==="presets"&&(
          <div>
            <div style={{fontSize:11,color:"var(--t3)",marginBottom:16}}>Select a preset — changes apply instantly.</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
              {Object.entries(THEMES).filter(([k])=>k!=="custom").map(([key,t])=>(
                <div key={key} onClick={()=>onThemeChange(key)} style={{borderRadius:14,overflow:"hidden",cursor:"pointer",border:`2px solid ${theme===key?previewAc:"rgba(255,255,255,.06)"}`,transition:"all .22s",transform:theme===key?"translateY(-3px) scale(1.02)":"none",boxShadow:theme===key?`0 10px 30px ${t.ac}44`:"0 2px 8px rgba(0,0,0,.3)"}}>
                  <div style={{height:80,background:`linear-gradient(135deg,${t.bg} 0%,${t.panel} 100%)`,position:"relative",overflow:"hidden"}}>
                    <div style={{position:"absolute",top:-20,right:-20,width:70,height:70,borderRadius:"50%",background:t.ac,opacity:.15,filter:"blur(10px)"}}/>
                    <div style={{position:"absolute",bottom:8,left:8,right:8,height:18,borderRadius:5,background:t.card,opacity:.9}}/>
                    <div style={{position:"absolute",top:10,left:10,width:24,height:24,borderRadius:6,background:`linear-gradient(135deg,${t.ac},${t.ac2})`}}/>
                  </div>
                  <div style={{background:t.panel,padding:"8px 12px",display:"flex",alignItems:"center",justifyContent:"space-between",borderTop:"1px solid rgba(255,255,255,.04)"}}>
                    <span style={{fontSize:11,fontWeight:700,color:theme===key?t.ac:"rgba(255,255,255,.45)",fontFamily:"Rajdhani,sans-serif",letterSpacing:1}}>{t.name.toUpperCase()}</span>
                    {theme===key?<span style={{fontSize:9,color:t.ac,fontWeight:700,background:`${t.ac}22`,padding:"2px 6px",borderRadius:4}}>ACTIVE</span>:<div style={{width:10,height:10,borderRadius:"50%",background:t.ac}}/>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab==="custom"&&(
          <div>
            <div style={{fontSize:11,color:"var(--t3)",marginBottom:16}}>Build a fully custom theme.</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
              {colorRows.map(r=>(<div key={r.key} style={{display:"flex",alignItems:"center",gap:10,background:"var(--card)",borderRadius:10,padding:"12px 13px",border:"1px solid var(--border)"}}>
                <div style={{width:28,height:28,borderRadius:7,background:local[r.key],border:"2px solid rgba(255,255,255,.12)",flexShrink:0}}/>
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:11,fontWeight:700,color:"var(--t1)"}}>{r.label}</div><div style={{fontSize:9,color:"var(--t3)"}}>{r.sub}</div></div>
                <input type="color" value={local[r.key]} onChange={e=>updateLocal(r.key,e.target.value)} style={{width:28,height:28,borderRadius:6,border:"1px solid rgba(255,255,255,.1)",cursor:"pointer",padding:1,background:"transparent",flexShrink:0}}/>
              </div>))}
            </div>
            <div style={{borderRadius:10,overflow:"hidden",marginBottom:14,height:12,display:"flex"}}>{[local.bg,local.panel,local.card,local.hover,local.ac,local.ac2].map((c,i)=>(<div key={i} style={{flex:1,background:c}}/>))}</div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn-p" style={{flex:1,justifyContent:"center",padding:"10px"}} onClick={applyCustom}>Apply Custom Theme</button>
              <button className="btn-gh" style={{padding:"10px 16px"}} onClick={()=>{const def={bg:"#222831",panel:"#1a1f26",card:"#2D4059",hover:"#354d6e",ac:"#FF5722",ac2:"#ff8a65"};setLocal(def);onCustomColorsChange(def);}}>Reset</button>
            </div>
          </div>
        )}
        {tab==="accent"&&(
          <div>
            <div style={{fontSize:11,color:"var(--t3)",marginBottom:16}}>Pick a start and end color — the gradient applies to buttons, badges, and the logo.</div>
            <div style={{display:"flex",background:"var(--card)",borderRadius:12,padding:"14px 16px",border:"1px solid var(--border)",alignItems:"center",gap:14,marginBottom:20}}>
              <div style={{flex:1,height:48,borderRadius:10,background:previewAc,boxShadow:`0 4px 16px ${previewAc}55`}}/>
              <input type="color" value={accent||THEMES[theme]?.ac||"#FF5722"} onChange={e=>onAccentChange(e.target.value)} style={{width:48,height:48,borderRadius:10,border:`2px solid ${previewAc}66`,cursor:"pointer",padding:2,background:"transparent",flexShrink:0}}/>
            </div>
            <div style={{fontSize:9,color:"var(--t3)",marginBottom:10,letterSpacing:2,textTransform:"uppercase"}}>Quick picks</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:16}}>
              {quickAccents.map(c=>(<div key={c} onClick={()=>onAccentChange(c)} style={{aspectRatio:"1",borderRadius:10,background:c,cursor:"pointer",border:`2px solid ${(accent||THEMES[theme]?.ac)===c?"white":"rgba(255,255,255,.08)"}`,transition:"all .15s",boxShadow:`0 2px 8px ${c}55`,transform:(accent||THEMES[theme]?.ac)===c?"scale(1.1)":"none"}}/>))}
            </div>
            {accent&&<button className="btn-gh" style={{width:"100%",justifyContent:"center",padding:"10px"}} onClick={()=>onAccentChange(null)}>Reset to Theme Default</button>}
          </div>
        )}
        {tab==="bg"&&(
          <div>
            <div style={{fontSize:11,color:"var(--t3)",marginBottom:16}}>Set a custom background image for the launcher.</div>
            {bgImage&&(
              <div style={{width:"100%",height:120,borderRadius:12,overflow:"hidden",marginBottom:16,border:"1px solid var(--border)",position:"relative"}}>
                <img src={bgImage} alt="bg" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.45)",backdropFilter:"blur(4px)"}}/>
                <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Rajdhani,sans-serif",fontSize:18,fontWeight:700,letterSpacing:3,color:"#fff"}}>PREVIEW</div>
              </div>
            )}
            <div style={{display:"flex",gap:8,marginBottom:12}}>
              <input className="fi" value={bgInput} onChange={e=>setBgInput(e.target.value)} placeholder="https://... image URL" style={{flex:1}}/>
              <button className="btn-p" style={{flexShrink:0}} onClick={async()=>{const result=await pickImageFile();if(result){setBgInput(result);onBgChange(result);}}}>Browse</button>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn-p" style={{flex:1,justifyContent:"center"}} onClick={()=>onBgChange(bgInput)}>Apply Background</button>
              {bgImage&&<button className="btn-gh" style={{padding:"10px 16px"}} onClick={()=>{onBgChange("");setBgInput("");}}>Remove</button>}
            </div>
          </div>
        )}
        {tab==="saved"&&(
          <div>
            <div style={{fontSize:11,color:"var(--t3)",marginBottom:16}}>Save your current theme settings as a named preset.</div>
            <div style={{display:"flex",gap:8,marginBottom:20}}>
              <input className="fi" value={saveName} onChange={e=>setSaveName(e.target.value)} placeholder="Theme name e.g. My Dark Purple" style={{flex:1,fontSize:12}}/>
              <button className="btn-p" style={{flexShrink:0}} onClick={()=>{
                if(!saveName.trim()) return;
                onSaveTheme({name:saveName.trim(),colors:{...local},accent,ac2:ac2color,themeName:theme});
                setSaveName("");
              }}>Save</button>
            </div>
            {(!savedThemes||savedThemes.length===0)
              ? <div style={{textAlign:"center",padding:"32px 0",color:"var(--t3)",fontSize:12}}>No saved themes yet. Build a theme and save it above.</div>
              : <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {savedThemes.map(t=>{
                    const swatchBg = t.colors?.bg || THEMES[t.themeName]?.bg || "#222831";
                    const swatchAc = t.accent || t.colors?.ac || THEMES[t.themeName]?.ac || "#FF5722";
                    const swatchAc2 = t.ac2 || t.colors?.ac2 || THEMES[t.themeName]?.ac2 || swatchAc;
                    return (
                    <div key={t.name} style={{display:"flex",alignItems:"center",gap:12,background:"var(--card)",borderRadius:12,padding:"12px 14px",border:"1px solid var(--border)"}}>
                      <div style={{width:44,height:44,borderRadius:10,background:swatchBg,border:"1px solid rgba(255,255,255,.08)",flexShrink:0,position:"relative",overflow:"hidden"}}>
                        <div style={{position:"absolute",top:6,left:6,width:14,height:14,borderRadius:4,background:`linear-gradient(135deg,${swatchAc},${swatchAc2})`}}/>
                        <div style={{position:"absolute",bottom:5,left:5,right:5,height:4,borderRadius:2,background:`${swatchAc}66`}}/>
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",fontFamily:"Rajdhani,sans-serif",letterSpacing:.5}}>{t.name}</div>
                        <div style={{fontSize:10,color:"var(--t3)",marginTop:2}}>{t.themeName||"Custom"} · <span style={{color:swatchAc}}>{swatchAc}</span></div>
                      </div>
                      <button className="btn-p" style={{fontSize:10,padding:"5px 12px"}} onClick={()=>onLoadTheme(t)}>Load</button>
                      <button className="btn-d" style={{fontSize:10,padding:"5px 10px"}} onClick={()=>onDeleteTheme(t.name)}>✕</button>
                    </div>
                  )})}
                </div>
            }
          </div>
        )}
      </div>
    </div>
  );
}

// ── Achievements ──────────────────────────────────────────────────────────────
function AchievementsScreen({ unlockedMap }) {
  const unlocked = ACHIEVEMENTS.filter(a => unlockedMap[a.id]);
  const locked = ACHIEVEMENTS.filter(a => !unlockedMap[a.id]);
  const pct = Math.round((unlocked.length / ACHIEVEMENTS.length) * 100);
  return (
    <div className="ach-screen">
      <div className="ach-header"><div className="ach-title">ACHIEVEMENTS</div><div className="ach-progress">{unlocked.length} / {ACHIEVEMENTS.length} unlocked</div></div>
      <div className="ach-bar-wrap"><div className="ach-bar-fill" style={{width:`${pct}%`}}/></div>
      <div className="ach-grid">
        {[...unlocked,...locked].map(a => {
          const isUnlocked = !!unlockedMap[a.id];
          const date = unlockedMap[a.id] ? new Date(unlockedMap[a.id]).toLocaleDateString() : null;
          return (
            <div key={a.id} className={`ach-card ${isUnlocked?"unlocked":"locked"}`}>
              {isUnlocked && <div className="ach-glow"/>}
              <div className="ach-card-icon">{a.icon}</div>
              <div className="ach-card-title">{a.title}</div>
              <div className="ach-card-desc">{a.description}</div>
              {date && <div className="ach-card-date">Unlocked {date}</div>}
              {!isUnlocked && <div className="ach-card-lock">🔒</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Auto Updater ──────────────────────────────────────────────────────────────
const UPDATE_CSS = `
@keyframes updatePulse{0%,100%{box-shadow:0 0 0 0 rgba(var(--ac-rgb),.4)}50%{box-shadow:0 0 0 10px rgba(var(--ac-rgb),0)}}
@keyframes progressShimmer{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}
.update-toast{position:fixed;bottom:88px;right:20px;z-index:999;background:linear-gradient(135deg,var(--panel),var(--card));border:1px solid var(--acg);border-radius:14px;padding:14px 18px;min-width:280px;max-width:320px;box-shadow:0 12px 40px rgba(0,0,0,.6),0 0 0 1px var(--acg);animation:fadeUp .35s ease;}
.update-toast-hdr{display:flex;align-items:center;gap:10px;margin-bottom:6px;}
.update-toast-icon{font-size:18px;}
.update-toast-title{font-family:'Rajdhani',sans-serif;font-size:14px;font-weight:700;letter-spacing:.5px;color:var(--t1);flex:1;}
.update-toast-close{background:none;border:none;color:var(--t3);cursor:pointer;font-size:16px;padding:0;line-height:1;}
.update-toast-close:hover{color:var(--t1);}
.update-progress-wrap{height:4px;background:var(--hover);border-radius:2px;overflow:hidden;margin-bottom:8px;position:relative;}
.update-progress-bar{height:100%;background:linear-gradient(90deg,var(--ac),var(--ac2));border-radius:2px;transition:width .3s ease;position:relative;overflow:hidden;}
.update-progress-bar::after{content:'';position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.3),transparent);animation:progressShimmer 1.5s infinite;}
.update-pct{font-size:10px;color:var(--t2);margin-bottom:10px;}
.update-restart-btn{width:100%;background:linear-gradient(90deg,var(--ac),var(--ac2));border:none;color:#fff;border-radius:10px;padding:10px;font-size:12px;font-weight:700;cursor:pointer;font-family:'Rajdhani',sans-serif;letter-spacing:1.5px;animation:updatePulse 2s infinite;transition:filter .15s;}
.update-restart-btn:hover{filter:brightness(1.15);}
.update-msg{font-size:11px;color:var(--t2);}
`;

function AutoUpdater() {
  const [state, setState] = useState(null); // null | 'available' | 'downloading' | 'ready'
  const [progress, setProgress] = useState(0);
  const [version, setVersion] = useState("");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return;
    window.electronAPI.onUpdateAvailable?.((v) => { setVersion(v||""); setState("available"); setDismissed(false); });
    window.electronAPI.onUpdateProgress?.((pct) => { setState("downloading"); setProgress(Math.round(pct)); });
    window.electronAPI.onUpdateReady?.(() => { setState("ready"); setProgress(100); });
  }, []);

  if (!state || dismissed) return null;

  return (
    <>
      <style>{UPDATE_CSS}</style>
      <div className="update-toast">
        <div className="update-toast-hdr">
          <span className="update-toast-icon">{state==="ready"?"🚀":"✨"}</span>
          <span className="update-toast-title">
            {state==="available" && `AURA ${version} Available`}
            {state==="downloading" && "Downloading Update…"}
            {state==="ready" && "Update Ready"}
          </span>
          {state!=="downloading"&&<button className="update-toast-close" onClick={()=>setDismissed(true)}>×</button>}
        </div>
        {state==="downloading"&&(
          <>
            <div className="update-progress-wrap"><div className="update-progress-bar" style={{width:`${progress}%`}}/></div>
            <div className="update-pct">{progress}% downloaded</div>
          </>
        )}
        {state==="available"&&(
          <div className="update-msg" style={{marginBottom:10}}>A new version is ready to download.</div>
        )}
        {state==="available"&&(
          <button className="update-restart-btn" onClick={()=>{window.electronAPI.downloadUpdate?.();setState("downloading");}}>↓ Download Now</button>
        )}
        {state==="ready"&&(
          <>
            <div className="update-msg" style={{marginBottom:10}}>Restart AURA to apply the update.</div>
            <button className="update-restart-btn" onClick={()=>window.electronAPI.installUpdate?.()}>⚡ Restart &amp; Update</button>
          </>
        )}
      </div>
    </>
  );
}


// ── Settings ──────────────────────────────────────────────────────────────────
function UpdateButton() {
  const [status, setStatus] = useState("idle");
  const [latest, setLatest] = useState(null);

  const check = async () => {
    if (!window.electronAPI?.isElectron) return;
    setStatus("checking");
    const res = await window.electronAPI.checkUpdate();
    if (res.success) { setLatest(res.latest); setStatus(res.hasUpdate ? "update" : "latest"); }
    else setStatus("error");
  };

  useEffect(() => { check(); }, []);

  if (status === "checking") return <span style={{fontSize:11,color:"var(--t3)"}}>Checking...</span>;
  if (status === "latest")   return <span style={{fontSize:11,color:"var(--ac)"}}>Up to date ✓</span>;
  if (status === "error")    return <button className="btn-gh" onClick={check} style={{fontSize:11,padding:"5px 12px"}}>Retry</button>;
  if (status === "update")   return (
    <button className="btn-p" onClick={()=>window.electronAPI.downloadUpdate?.()} style={{fontSize:11,padding:"5px 14px",animation:"pulse 2s infinite"}}>
      v{latest} — Download
    </button>
  );
  return <button className="btn-gh" onClick={check} style={{fontSize:11,padding:"5px 12px"}}>Check</button>;
}

function Settings({games,onReset,onImportSteam,onImportEpic,onImportXbox,onFetchCovers}){
  const [s,setS]=useState(()=>{try{return JSON.parse(localStorage.getItem("aura_settings")||"{}")}catch{return{}}});
  const tog=k=>{const n={...s,[k]:!s[k]};setS(n);try{localStorage.setItem("aura_settings",JSON.stringify(n))}catch{}};
  const rows=[{k:"anim",l:"Launch Animation",d:"Show launch overlay when starting a game"},{k:"large",l:"Large Card Grid",d:"Bigger cards for easier reading"},{k:"counts",l:"Show Play Counts",d:"Display session counts on each card"}];
  return(
    <div className="sc">
      <div className="ss">
        <div className="ss-t">DISPLAY</div>
        <div className="ss-card">{rows.map(r=>(<div className="sr" key={r.k}><div><div className="sr-l">{r.l}</div><div className="sr-s">{r.d}</div></div><div className={`tog ${s[r.k]?"on":""}`} onClick={()=>tog(r.k)}/></div>))}</div>
      </div>
      <div className="ss">
        <div className="ss-t">LIBRARY</div>
        <div className="ss-card">
          <div className="sr"><div><div className="sr-l">Fetch Missing Cover Art</div><div className="sr-s">Auto-fetch covers for games without images</div></div><button className="btn-p" onClick={()=>{const missing=games.filter(g=>!g.cover);if(missing.length===0) return;onFetchCovers(missing);}} style={{fontSize:11,padding:"6px 14px"}}>Fetch</button></div>
          <div className="sr"><div><div className="sr-l">Import Steam Games</div><div className="sr-s">Auto-import all installed Steam games</div></div><button className="btn-p" onClick={onImportSteam} style={{fontSize:11,padding:"6px 14px",display:"flex",alignItems:"center",gap:"5px"}}><Ic.Steam/> Import</button></div>
          <div className="sr"><div><div className="sr-l">Import Epic Games</div><div className="sr-s">Auto-import all installed Epic Games</div></div><button className="btn-p" onClick={onImportEpic} style={{fontSize:11,padding:"6px 14px"}}>Import</button></div>
          <div className="sr"><div><div className="sr-l">Import Xbox Game Pass</div><div className="sr-s">Auto-import all installed Xbox games</div></div><button className="btn-p" onClick={onImportXbox} style={{fontSize:11,padding:"6px 14px"}}>Import</button></div>
          <div className="sr"><div><div className="sr-l">Games in Library</div><div className="sr-s">{games.length} titles stored locally</div></div><span style={{fontFamily:"Rajdhani,sans-serif",fontSize:22,fontWeight:700,color:"var(--ac)"}}>{games.length}</span></div>
          <div className="sr"><div><div className="sr-l">Reset to Defaults</div><div className="sr-s">Restore demo games</div></div><button className="btn-d" onClick={onReset} style={{fontSize:11,padding:"5px 12px"}}>Reset</button></div>
        </div>
      </div>
      <div className="ss">
        <div className="ss-t">ABOUT</div>
        <div className="ss-card">
          <div className="sr"><div><div className="sr-l">AURA Game Launcher</div><div className="sr-s">React + Electron · v1.1.8</div></div><UpdateButton/></div>
          <div className="sr"><div><div className="sr-l">Developed by Taurrean Traylor</div><div className="sr-s">Built with React + Electron</div></div></div>
        </div>
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App(){
  const [games,setGames]=useState(()=>load());
  const [profile,setProfile]=useState(()=>loadProfile());
  const [theme,setTheme]=useState(()=>loadTheme());
  const [accent,setAccent]=useState(()=>loadAccent());
  const [customColors,setCustomColors]=useState(()=>loadCustomTheme());
  const [unlockedAch,setUnlockedAch]=useState(()=>loadAchievements());
  const [stats,setStats]=useState(()=>loadStats());
  const [achToasts,setAchToasts]=useState([]);
  const [view,setView]=useState("home");
  const [srch,setSrch]=useState("");
  const [heroGame,setHeroGame]=useState(null);
  const [cat,setCat]=useState("All");
  const [sort,setSort]=useState("title");
  const [modal,setModal]=useState(null);
  const [editT,setEditT]=useState(null);
  const [delT,setDelT]=useState(null);
  const [launching,setLaunching]=useState(null);
  const [toasts,setToasts]=useState([]);
  const [splash,setSplash]=useState(true);
  const [splashHide,setSplashHide]=useState(false);
  const [showProfileModal,setShowProfileModal]=useState(false);

  const [nowPlaying, setNowPlaying] = useState(null);
  const [activeStream, setActiveStream] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [bgImage, setBgImage] = useState(()=>localStorage.getItem("aura_bg")||"");
  const [savedThemes, setSavedThemes] = useState(()=>{
    try { return JSON.parse(localStorage.getItem("aura_saved_themes")||"[]"); } catch { return []; }
  });

  useEffect(()=>{ applyTheme(theme, accent, customColors); },[theme, accent, customColors]);
  useEffect(()=>save(games),[games]);
  useEffect(()=>{
    const t1=setTimeout(()=>setSplashHide(true),1800);
    const t2=setTimeout(()=>setSplash(false),2300);
    return()=>{clearTimeout(t1);clearTimeout(t2);}
  },[]);

  const checkAchievements = useCallback((newStats, currentUnlocked) => {
    const newlyUnlocked = [];
    ACHIEVEMENTS.forEach(a => { if (!currentUnlocked[a.id] && a.condition(newStats)) newlyUnlocked.push(a); });
    if (newlyUnlocked.length > 0) {
      const updated = { ...currentUnlocked };
      newlyUnlocked.forEach(a => { updated[a.id] = Date.now(); });
      setUnlockedAch(updated);
      saveAchievements(updated);
      newlyUnlocked.forEach(a => {
        const id = uid();
        setAchToasts(t => [...t, { id, achievement: a }]);
        setTimeout(() => setAchToasts(t => t.filter(x => x.id !== id)), 4000);
      });
    }
  }, []);

  useEffect(()=>{
    if(!window.electronAPI?.isElectron) return;
    window.electronAPI.onGameSessionEnded((_event,data)=>{
      setGames(gs=>gs.map(g=>{ if(g.exePath===data.exePath) return {...g,totalTime:(g.totalTime||0)+data.sessionMs,lastSessionMs:data.sessionMs}; return g; }));
      setStats(prev=>{
        const totalMs=(prev.totalPlaytimeMs||0)+data.sessionMs;
        const updated={...prev,totalPlaytimeMs:totalMs,totalPlaytimeHours:totalMs/3600000};
        saveStats(updated);checkAchievements(updated,unlockedAch);return updated;
      });
    });
  },[checkAchievements, unlockedAch]);

  const handleThemeChange = useCallback((key) => {
    setTheme(key); saveTheme(key);
    if(key !== "custom") { setAccent(null); saveAccent(""); }
    applyTheme(key, key !== "custom" ? null : accent, customColors);
  }, [accent, customColors]);
  const handleAccentChange = useCallback((color) => { setAccent(color);saveAccent(color||"");applyTheme(theme,color,customColors); }, [theme, customColors]);
  const handleCustomColorsChange = useCallback((colors) => { setCustomColors(colors);saveCustomTheme(colors);applyTheme("custom",accent,colors); }, [accent]);
  const updateStats = useCallback((patch) => { setStats(prev=>{ const updated={...prev,...patch};saveStats(updated);checkAchievements(updated,unlockedAch);return updated; }); }, [checkAchievements, unlockedAch]);
  const toast=useCallback((msg,type="ok")=>{ const id=uid();setToasts(t=>[...t,{id,msg,type}]);setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)),3000); },[]);

  const saveCustomTheme2 = useCallback((named) => {
    const updated = [...savedThemes.filter(t=>t.name!==named.name), named];
    setSavedThemes(updated);
    localStorage.setItem("aura_saved_themes", JSON.stringify(updated));
    toast(`Theme "${named.name}" saved!`);
  }, [savedThemes, toast]);

  const deleteCustomTheme2 = useCallback((name) => {
    const updated = savedThemes.filter(t=>t.name!==name);
    setSavedThemes(updated);
    localStorage.setItem("aura_saved_themes", JSON.stringify(updated));
  }, [savedThemes]);

  const doPlay=useCallback(async(game)=>{
    setHeroGame(null);setLaunching(game);
    setGames(gs=>gs.map(g=>g.id===game.id?{...g,lastPlayed:Date.now(),playCount:(g.playCount||0)+1}:g));
    setStats(prev=>{
      const today=new Date().toDateString();const lastDate=prev.lastPlayedDate;const yesterday=new Date(Date.now()-86400000).toDateString();
      const streak=lastDate===today?prev.streakDays:lastDate===yesterday?prev.streakDays+1:1;
      const playedIds=prev.playedGameIds.includes(game.id)?prev.playedGameIds:[...prev.playedGameIds,game.id];
      const updated={...prev,totalLaunches:prev.totalLaunches+1,streakDays:streak,lastPlayedDate:today,gamesPlayedCount:playedIds.length,playedGameIds:playedIds};
      saveStats(updated);checkAchievements(updated,unlockedAch);return updated;
    });
    if(window.electronAPI?.isElectron){
      const result=await window.electronAPI.launchGame(game.exePath);
      setLaunching(null);
      if(result.success){ toast(`${game.title} launched!`); setNowPlaying(game); }
      else toast(`Launch failed: ${result.error}`,"err");
    } else {
      setTimeout(()=>{setLaunching(null);toast(`${game.title} launched!`);setNowPlaying(game);},2200);
    }
  },[toast,checkAchievements,unlockedAch]);

  const doFav=useCallback(id=>{
    setGames(gs=>{
      const updated=gs.map(g=>g.id===id?{...g,favorite:!g.favorite}:g);
      const favCount=updated.filter(g=>g.favorite).length;
      setStats(prev=>{const s={...prev,favoritesCount:favCount};saveStats(s);checkAchievements(s,unlockedAch);return s;});
      return updated;
    });
    setHeroGame(h=>h&&h.id===id?{...h,favorite:!h.favorite}:h);
  },[checkAchievements,unlockedAch]);

  const doAdd=useCallback(f=>{
    setGames(gs=>{
      const updated=[{id:uid(),title:f.title.trim(),exePath:f.exePath.trim(),cover:f.cover.trim(),category:f.category||"Other",favorite:false,playCount:0,lastPlayed:null,addedAt:Date.now()},...gs];
      setStats(prev=>{const s={...prev,gamesAdded:updated.length};saveStats(s);checkAchievements(s,unlockedAch);return s;});
      return updated;
    });
    setModal(null);toast(`"${f.title.trim()}" added`);
  },[toast,checkAchievements,unlockedAch]);

  const doEdit=useCallback(f=>{
    setGames(gs=>gs.map(g=>g.id===editT.id?{...g,title:f.title.trim(),exePath:f.exePath.trim(),cover:f.cover.trim(),category:f.category}:g));
    setModal(null);setEditT(null);toast("Game updated");
  },[editT,toast]);

  const doDel=useCallback(()=>{
    setGames(gs=>gs.filter(g=>g.id!==delT.id));
    toast(`"${delT.title}" removed`,"err");setModal(null);setDelT(null);
  },[delT,toast]);

  const doImportSteam=useCallback(async()=>{
    if(!window.electronAPI?.isElectron){toast("Steam import only works in the desktop app","err");return;}
    const result=await window.electronAPI.importSteam();
    if(result.success){
      const newGames=result.games.map(g=>({id:uid(),title:g.title,exePath:g.exePath,cover:"",category:"Other",favorite:false,playCount:0,lastPlayed:null,addedAt:Date.now()}));
      setGames(gs=>{const existing=gs.map(g=>g.title.toLowerCase());const toAdd=newGames.filter(g=>!existing.includes(g.title.toLowerCase()));if(toAdd.length===0){toast("All Steam games already in library");return gs;}toast(`${toAdd.length} Steam games imported!`);return [...toAdd,...gs];});
    } else toast("Could not find Steam library","err");
  },[toast]);

  const doFetchCovers=useCallback(async(gamesToFetch)=>{
    if(!window.electronAPI?.isElectron) return;
    if(gamesToFetch.length===0){toast("All games already have cover art");return;}
    toast(`Fetching cover art for ${gamesToFetch.length} games...`);
    const result=await window.electronAPI.fetchCoversBulk(gamesToFetch);
    if(result.success){const covers=result.covers;setGames(gs=>gs.map(g=>covers[g.id]?{...g,cover:covers[g.id]}:g));toast("Cover art updated!");}
  },[toast]);

  const doImportEpic=useCallback(async()=>{
    if(!window.electronAPI?.isElectron){toast("Epic import only works in the desktop app","err");return;}
    const result=await window.electronAPI.importEpic();
    if(result.success){
      const newGames=result.games.map(g=>({id:uid(),title:g.title,exePath:g.exePath,cover:"",category:"Other",favorite:false,playCount:0,lastPlayed:null,addedAt:Date.now()}));
      setGames(gs=>{const existing=gs.map(g=>g.title.toLowerCase());const toAdd=newGames.filter(g=>!existing.includes(g.title.toLowerCase()));if(toAdd.length===0){toast("All Epic games already in library");return gs;}toast(`${toAdd.length} Epic games imported!`);return [...toAdd,...gs];});
    } else toast("Could not find Epic Games","err");
  },[toast]);

  const doImportXbox=useCallback(async()=>{
    if(!window.electronAPI?.isElectron){toast("Xbox import only works in the desktop app","err");return;}
    const result=await window.electronAPI.importXbox();
    if(result.success){
      const newGames=result.games.map(g=>({id:uid(),title:g.title,exePath:g.exePath,cover:"",category:"Other",favorite:false,playCount:0,lastPlayed:null,addedAt:Date.now()}));
      setGames(gs=>{const existing=gs.map(g=>g.title.toLowerCase());const toAdd=newGames.filter(g=>!existing.includes(g.title.toLowerCase()));if(toAdd.length===0){toast("All Xbox games already in library");return gs;}toast(`${toAdd.length} Xbox games imported!`);return [...toAdd,...gs];});
    } else toast("Could not find Xbox Game Pass","err");
  },[toast]);

  const sorted=useMemo(()=>{
    let l=[...games];
    if(srch) l=l.filter(g=>g.title.toLowerCase().includes(srch.toLowerCase()));
    if(cat!=="All") l=l.filter(g=>g.category===cat);
    if(sort==="title") l.sort((a,b)=>a.title.localeCompare(b.title));
    else if(sort==="recent") l.sort((a,b)=>(b.lastPlayed||0)-(a.lastPlayed||0));
    else if(sort==="plays") l.sort((a,b)=>(b.playCount||0)-(a.playCount||0));
    else l.sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));
    return l;
  },[games,srch,cat,sort]);

  const recent=useMemo(()=>[...games].filter(g=>g.lastPlayed).sort((a,b)=>b.lastPlayed-a.lastPlayed).slice(0,20),[games]);
  const favs=useMemo(()=>games.filter(g=>g.favorite),[games]);
  const totalPlaytime=useMemo(()=>games.reduce((s,g)=>s+(g.totalTime||0),0),[games]);
  const unlockedCount=useMemo(()=>Object.keys(unlockedAch).length,[unlockedAch]);
  const sorts=["title","recent","plays","added"];
  const openEdit=g=>{setEditT(g);setModal("edit");};
  const openDel=g=>{setDelT(g);setModal("delete");};

  // Nav items — shared between both layouts
  const navItems = [
    {id:"home",      icon:<Ic.Home/>,    label:"Home"},
    {id:"library",   icon:<Ic.Lib/>,     label:"Library",         badge:games.length},
    {id:"recent",    icon:<Ic.Clock/>,   label:"Recently Played"},
    {id:"favorites", icon:<Ic.Heart/>,   label:"Favorites",       badge:favs.length||null},
    {id:"streams",   icon:<Ic.Tv/>,      label:"Live Streams"},
    {id:"achievements",icon:<Ic.Trophy/>,label:"Achievements",    badge:unlockedCount||null},
    {id:"customize", icon:<Ic.Palette/>, label:"Customize"},
    {id:"settings",  icon:<Ic.Gear/>,    label:"Settings"},
  ];

  const goTo = (id) => { setView(id); setHeroGame(null); setSrch(""); };

  if(!profile){
    return(<><style>{S}</style><ProfileSetup onComplete={(p)=>{setProfile(p);}}/></>);
  }

  // ── HOME VIEW — GM/TV layout ──────────────────────────────────────────────
  if(view==="home"){
    return(
      <>
        <style>{S}</style>
        {bgImage&&<><div className="app-bg" style={{backgroundImage:`url(${bgImage})`}}/><div className="app-bg-overlay"/></>}
        {splash&&(<div className={`splash ${splashHide?"hide":""}`}><div className="splash-logo">AURA</div><div className="splash-sub">Your Game Library</div><div className="splash-sub">Developed By: Taurrean Traylor</div><div className="splash-bar"><div className="splash-fill"/></div></div>)}
        <div className="gm-app">
          <aside className={`gm-rail ${sidebarOpen?"expanded":""}`}>
            <button className="gm-rail-toggle" onClick={()=>setSidebarOpen(o=>!o)} title="Toggle menu">
              {sidebarOpen?<Ic.MenuClose/>:<Ic.Menu/>}
            </button>
            <div style={{display:"flex",flexDirection:"column",alignItems:sidebarOpen?"flex-start":"center",marginBottom:16,gap:4,width:"100%",paddingLeft:sidebarOpen?4:0}}>
              <div className="gm-rail-logo"><Ic.Ctrl/></div>
              {sidebarOpen&&<div style={{fontFamily:"Rajdhani,sans-serif",fontSize:9,fontWeight:700,letterSpacing:3,background:"linear-gradient(90deg,var(--ac),var(--ac2))",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",marginLeft:4}}>AURA</div>}
            </div>
            {navItems.map(it=>(
              <div key={it.id} className={`gm-rail-item ${view===it.id?"on":""}`} onClick={()=>goTo(it.id)} title={it.label}>
                {it.icon}
                {sidebarOpen&&<span className="gm-rail-item-label">{it.label}</span>}
                {it.badge?<div className="gm-rail-badge"/>:null}
              </div>
            ))}
            {profile.avatar
              ? <img src={profile.avatar} alt={profile.username} className="gm-rail-avatar" onClick={()=>setShowProfileModal(true)}/>
              : <div className="gm-rail-avatar-ph" onClick={()=>setShowProfileModal(true)}>🎮</div>
            }
          </aside>
          <div className="gm-main" style={{position:"relative"}}>
            <div className="gm-search-bar">
              <div className="gm-srch"><Ic.Search/><input value={srch} onChange={e=>setSrch(e.target.value)} placeholder="Search games…"/></div>
              <button className="btn-p" onClick={()=>setModal("add")} style={{borderRadius:10}}><Ic.Plus/> Add</button>
            </div>
            {!srch&&<GMBanner games={[...games].filter(g=>g.cover).sort((a,b)=>(b.lastPlayed||0)-(a.lastPlayed||0))} onPlay={doPlay} onFav={doFav} onSelect={setHeroGame}/>}
            <div className="gm-content">
              {srch?(
                <GMShelf title="SEARCH RESULTS" games={sorted} onPlay={doPlay} onFav={doFav} onSelect={g=>{goTo("library");setHeroGame(g);}} count={`${sorted.length} games`}/>
              ):(
                <>
                  <FriendActivityShelf/>
                  <TwitchShelf games={games} onStreamClick={s=>{setActiveStream(s);goTo("streams");}}/>
                  <MadeForShelf games={games} username={profile.username} onPlay={doPlay} onSelect={g=>{setHeroGame(g);goTo("library");}}/>
                  {recent.length>0&&<GMShelf title="RECENTLY PLAYED" games={recent.slice(0,12)} onPlay={doPlay} onFav={doFav} onSelect={g=>{goTo("library");setHeroGame(g);}}/>}
                  {favs.length>0&&<GMShelf title="FAVORITES" games={favs} onPlay={doPlay} onFav={doFav} onSelect={g=>{goTo("library");setHeroGame(g);}}/>}
                  {CATEGORIES.filter(c=>c!=="All").map(c=>{
                    const cGames=games.filter(g=>g.category===c);
                    if(!cGames.length) return null;
                    return <GMShelf key={c} title={c.toUpperCase()} games={cGames} onPlay={doPlay} onFav={doFav} onSelect={g=>{goTo("library");setHeroGame(g);}} count={`${cGames.length} games`}/>;
                  })}
                </>
              )}
            </div>
          </div>
          <FriendsPanel launching={launching} toast={toast}/>
        </div>
        {modal==="add"&&<Modal mode="add" onClose={()=>setModal(null)} onSave={doAdd}/>}
        {showProfileModal&&<ProfileModal profile={profile} onClose={()=>setShowProfileModal(false)} onSave={(p)=>{setProfile(p);saveProfile(p);setShowProfileModal(false);toast("Profile updated!");}}/>}
        {launching&&(<div className="launch"><div className="l-spin"/><div className="l-t">LAUNCHING</div><div className="l-s">{launching.title}</div><div className="l-p">{launching.exePath}</div></div>)}
        {nowPlaying&&<NowPlayingBar game={nowPlaying} onClose={()=>setNowPlaying(null)}/>}
        <AutoUpdater/>
        <div className="tc">
          {achToasts.map(t=>(<div key={t.id} className="ach-toast"><div className="ach-toast-icon">{t.achievement.icon}</div><div className="ach-toast-body"><div className="ach-toast-label">Achievement Unlocked!</div><div className="ach-toast-title">{t.achievement.title}</div></div></div>))}
          {toasts.map(t=>(<div key={t.id} className={`toast ${t.type}`}><div className="tdot"/><span>{t.msg}</span></div>))}
        </div>
      </>
    );
  }

  // ── ALL OTHER VIEWS — sidebar layout ──────────────────────────────────────
  return(
    <>
      <style>{S}</style>
      {bgImage&&<><div className="app-bg" style={{backgroundImage:`url(${bgImage})`}}/><div className="app-bg-overlay"/></>}
      {splash&&(<div className={`splash ${splashHide?"hide":""}`}><div className="splash-logo">AURA</div><div className="splash-sub">Your Game Library</div><div className="splash-sub">Developed By: Taurrean Traylor</div><div className="splash-bar"><div className="splash-fill"/></div></div>)}
      <div className="app">
        <aside className={`sb ${sidebarOpen?"":"collapsed"}`}>
          <div className="sb-logo">
            {sidebarOpen
              ? <>
                  <div className="sb-li"><Ic.Ctrl/></div>
                  <span className="sb-lt">AURA</span>
                  <button className="sb-toggle" onClick={()=>setSidebarOpen(o=>!o)} title="Toggle menu"><Ic.MenuClose/></button>
                </>
              : <>
                  <button className="sb-toggle" onClick={()=>setSidebarOpen(o=>!o)} title="Toggle menu" style={{margin:"0 auto"}}><Ic.Menu/></button>
                  <div className="sb-li" style={{margin:"0 auto"}}><Ic.Ctrl/></div>
                </>
            }
          </div>
          <div className="sb-profile" onClick={()=>setShowProfileModal(true)}>
            {profile.avatar?<img src={profile.avatar} alt={profile.username} className="sb-pav"/>:<div className="sb-pav-ph">🎮</div>}
            {sidebarOpen&&<div style={{flex:1,minWidth:0}}><div className="sb-pname">{profile.username}</div><div className="sb-pedit">Edit profile</div></div>}
          </div>
          <div className="sb-sec">
            {sidebarOpen&&<div className="sb-sl">Navigate</div>}
            {navItems.map(it=>(
              <div key={it.id} className={`sb-item ${view===it.id?"on":""}`} onClick={()=>goTo(it.id)} title={it.label}>
                {it.icon}
                {sidebarOpen&&<span>{it.label}</span>}
                {sidebarOpen&&it.badge?<span className="sb-badge">{it.badge}</span>:null}
              </div>
            ))}
          </div>
          <div className="sb-foot">
            {sidebarOpen&&<div className="sb-stat">
              <div className="sb-stat-l">Total Playtime</div>
              <div className="sb-stat-v">{fmtTime(totalPlaytime)||"0m"}</div>
              <div className="sb-stat-s">across {games.length} games</div>
            </div>}
          </div>
        </aside>

        <div className="main">
          <header className="hdr">
            <div className="hdr-title">{heroGame ? heroGame.title : view.toUpperCase()}</div>
            <div className="srch"><Ic.Search/><input value={srch} onChange={e=>setSrch(e.target.value)} placeholder="Search games…"/></div>
            <div className="hdr-r">
              <button className="btn-g" onClick={()=>setSort(sorts[(sorts.indexOf(sort)+1)%sorts.length])}><Ic.Sort/> Sort: {sort}</button>
              <button className="btn-p" onClick={()=>setModal("add")}><Ic.Plus/> Add Game</button>
            </div>
          </header>

          {view==="library"&&(
            <>
              {!heroGame&&(<div className="fbar">{CATEGORIES.map(c=><button key={c} className={`chip ${cat===c?"on":""}`} onClick={()=>setCat(c)}>{c}</button>)}</div>)}
              {heroGame?(
                <HeroView game={heroGame} onBack={()=>setHeroGame(null)} onPlay={doPlay} onFav={doFav}/>
              ):(
                <div className="gc" style={{padding:0,display:"flex",flexDirection:"column"}}>
                  <Spotlight games={[...games].filter(g=>g.cover).sort((a,b)=>(b.lastPlayed||0)-(a.lastPlayed||0))} onPlay={doPlay} onFav={doFav} onSelect={setHeroGame}/>
                  <div style={{padding:"16px 22px 20px"}}>
                    <Grid games={sorted} onPlay={doPlay} onFav={doFav} onEdit={openEdit} onDel={openDel} onSelect={setHeroGame}/>
                  </div>
                </div>
              )}
            </>
          )}

          {view==="recent"&&(
            <div className="gc">
              <div className="sh"><div><span className="sh-t">RECENTLY PLAYED</span><span className="sh-c">{recent.length} games</span></div></div>
              <Grid games={recent} onPlay={doPlay} onFav={doFav} onEdit={openEdit} onDel={openDel} onSelect={setHeroGame}/>
            </div>
          )}

          {view==="favorites"&&(
            <div className="gc">
              <div className="sh"><div><span className="sh-t">FAVORITES</span><span className="sh-c">{favs.length} games</span></div></div>
              {favs.length===0?<div className="empty"><div className="empty-icon">❤️</div><div className="empty-t">No favorites yet</div><div className="empty-s">Click a game to open it, then favorite it.</div></div>:<Grid games={favs} onPlay={doPlay} onFav={doFav} onEdit={openEdit} onDel={openDel} onSelect={setHeroGame}/>}
            </div>
          )}

          {view==="achievements"&&<AchievementsScreen unlockedMap={unlockedAch}/>}

          {view==="streams"&&<StreamsView games={games} initialStream={activeStream} onClear={()=>setActiveStream(null)}/>}

          {view==="customize"&&<Customize
            theme={theme} onThemeChange={handleThemeChange}
            accent={accent} onAccentChange={handleAccentChange}
            customColors={customColors} onCustomColorsChange={handleCustomColorsChange}
            bgImage={bgImage} onBgChange={(v)=>{setBgImage(v);localStorage.setItem("aura_bg",v||"");}}
            savedThemes={savedThemes} onSaveTheme={saveCustomTheme2} onDeleteTheme={deleteCustomTheme2}
            onLoadTheme={(t)=>{
              const colors = t.colors||{};
              const ac = t.accent||colors.ac||"#FF5722";
              const themeKey = t.themeName||"custom";
              setTheme(themeKey); saveTheme(themeKey);
              setAccent(ac); saveAccent(ac);
              setCustomColors(colors); saveCustomTheme(colors);
              applyTheme(themeKey, ac, colors);
            }}
          />}

          {view==="settings"&&<Settings games={games} onReset={()=>{localStorage.removeItem("aura_games");setGames(DEMO_GAMES);toast("Library reset");}} onImportSteam={doImportSteam} onImportEpic={doImportEpic} onImportXbox={doImportXbox} onFetchCovers={doFetchCovers}/>}
        </div>

        <FriendsPanel launching={launching} toast={toast}/>
      </div>

      {modal==="add"&&<Modal mode="add" onClose={()=>setModal(null)} onSave={doAdd}/>}
      {modal==="edit"&&editT&&<Modal mode="edit" init={editT} onClose={()=>{setModal(null);setEditT(null);}} onSave={doEdit}/>}
      {modal==="delete"&&delT&&<DelModal game={delT} onClose={()=>{setModal(null);setDelT(null);}} onOk={doDel}/>}
      {showProfileModal&&<ProfileModal profile={profile} onClose={()=>setShowProfileModal(false)} onSave={(p)=>{setProfile(p);saveProfile(p);setShowProfileModal(false);toast("Profile updated!");}}/>}
      {launching&&(<div className="launch"><div className="l-spin"/><div className="l-t">LAUNCHING</div><div className="l-s">{launching.title}</div><div className="l-p">{launching.exePath}</div></div>)}
      {nowPlaying&&<NowPlayingBar game={nowPlaying} onClose={()=>setNowPlaying(null)}/>}
      <AutoUpdater/>
      <div className="tc">
        {achToasts.map(t=>(<div key={t.id} className="ach-toast"><div className="ach-toast-icon">{t.achievement.icon}</div><div className="ach-toast-body"><div className="ach-toast-label">Achievement Unlocked!</div><div className="ach-toast-title">{t.achievement.title}</div></div></div>))}
        {toasts.map(t=>(<div key={t.id} className={`toast ${t.type}`}><div className="tdot"/><span>{t.msg}</span></div>))}
      </div>
    </>
  );
}