// Tells AURA's main process where AURA's own panels are, so a Twitch stream (drawn on top of the
// page) makes room for them instead of hiding them. See electron/streamroom.js.
// Added by aura-stream-room-setup.cjs
const PANELS = ".cx-bar, .cx-cams, .cx-cams-pill, .cx-devices, .cx-screen:not(.full), .cx-screen-pill, .cam-pan, .cam-pill";
const WHOLE = ".cx-stage, .cx-screen.full"; // these need the whole window

export function watchStreamRoom() {
  const api = window.electronAPI;
  if (typeof api?.streamRoom !== "function") return () => {};
  let last = "";
  const check = () => {
    const full = document.fullscreenElement;
    const all = !!document.querySelector(WHOLE) || (!!full && !full.classList?.contains("stream-full-bar"));
    const rects = all ? [] : [...document.querySelectorAll(PANELS)]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }));
    const sig = JSON.stringify([all, rects]);
    if (sig === last) return;
    last = sig;
    try { Promise.resolve(api.streamRoom({ all, rects })).catch(() => {}); } catch {}
  };
  // Panels open, close and get dragged: a quick look a few times a second is enough
  const timer = setInterval(check, 250);
  document.addEventListener("fullscreenchange", check);
  check();
  return () => {
    clearInterval(timer);
    document.removeEventListener("fullscreenchange", check);
    try { Promise.resolve(api.streamRoom({ all: false, rects: [] })).catch(() => {}); } catch {}
  };
}
