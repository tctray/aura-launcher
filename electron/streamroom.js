// Room for AURA's own panels over a Twitch stream. Added by aura-stream-room-setup.cjs
//
// The Twitch player (and its chat) are separate layers drawn on top of AURA's page, so anything
// AURA shows where the player is (call cameras, a shared screen, call settings, the camera preview)
// would be hidden under it. The page says where those panels are; the player makes room by getting
// shorter (cut from the top for a panel in its upper half, from the bottom for one in its lower
// half). If that would leave it smaller than Twitch allows, it steps aside instead: still playing,
// so you still hear it, and back as soon as the panel goes. The call screen, or anything AURA puts
// full screen, needs the whole window: then the player and chat both step aside.
"use strict";
const MIN_HEIGHT = 300; // Twitch asks that its player is never shown smaller than 400 x 300
const GAP = 8;          // a little space between a panel and the player

// What the page sent, checked: at most 12 rectangles of sensible numbers
function cleanRoom(room) {
  const num = (v) => (Number.isFinite(v) ? Math.max(-100000, Math.min(100000, Math.round(v))) : null);
  const rects = [];
  for (const r of Array.isArray(room?.rects) ? room.rects.slice(0, 12) : []) {
    const x = num(r?.x), y = num(r?.y), width = num(r?.width), height = num(r?.height);
    if (x === null || y === null || !(width > 0) || !(height > 0)) continue;
    rects.push({ x, y, width, height });
  }
  return { rects, all: room?.all === true };
}

// Where the player goes, given where it wants to be (window pixels) and the room AURA needs
// (page pixels, so `zoom` converts). null: step aside.
function fitStream(want, room, zoom = 1) {
  if (!want) return want;
  if (room?.all) return null;
  let top = want.y, bottom = want.y + want.height;
  const mid = want.y + want.height / 2;
  for (const p of room?.rects || []) {
    const r = { x: p.x * zoom, y: p.y * zoom, width: p.width * zoom, height: p.height * zoom };
    if (r.x >= want.x + want.width || r.x + r.width <= want.x || r.y >= bottom || r.y + r.height <= top) continue;
    if (r.y + r.height / 2 < mid) top = Math.max(top, Math.ceil(r.y + r.height + GAP * zoom));
    else bottom = Math.min(bottom, Math.floor(r.y - GAP * zoom));
  }
  if (top === want.y && bottom === want.y + want.height) return want;
  const height = bottom - top;
  if (height < Math.min(MIN_HEIGHT * zoom, want.height)) return null;
  return { x: want.x, y: top, width: want.width, height };
}

module.exports = { fitStream, cleanRoom };
