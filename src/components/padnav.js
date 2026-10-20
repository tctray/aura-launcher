// Moving around AURA with a controller: which thing is next in the direction you push.
// Added by aura-controller-setup.cjs
//
//   nextInDirection(from, candidates, dir)   from / candidates are { left, top, right, bottom }
//                                            (with any other fields); dir: up, down, left, right
//   FOCUSABLE                                what a controller can land on
//   isUsable(el)                             on screen, not hidden, not switched off
//   scopeOf(doc)                             a dialog that's open (only it can be used), or the page

export const FOCUSABLE = [
  "button", "a[href]", "input:not([type=hidden])", "select", "textarea",
  "[role=button]", "[role=switch]", "[role=tab]", "[role=listitem][tabindex]", "[tabindex]:not([tabindex='-1'])",
  ".gm-card", ".gm-mf-card", ".card", ".twitch-card", ".sb-item", ".gm-rail-item", ".tog", ".chip", ".clip-card", ".sb-profile",
].join(",");

// The thing in direction `dir` from `from`: closest along the way you push, and lined up with
// where you are (something straight ahead beats something closer but off to the side)
export function nextInDirection(from, candidates, dir) {
  const cx = (r) => (r.left + r.right) / 2, cy = (r) => (r.top + r.bottom) / 2;
  let best = null, bestScore = Infinity;
  for (const c of candidates) {
    if (c === from) continue;
    let along, across, overlap;
    if (dir === "right" || dir === "left") {
      along = dir === "right" ? c.left - from.right : from.left - c.right;
      if (along < -Math.min(c.right - c.left, from.right - from.left) / 2) continue; // not that way
      along = Math.max(0, along) + Math.abs(cx(c) - cx(from)) * 0.1;
      overlap = Math.min(c.bottom, from.bottom) - Math.max(c.top, from.top);
      across = overlap > 0 ? 0 : Math.abs(cy(c) - cy(from));
    } else {
      along = dir === "down" ? c.top - from.bottom : from.top - c.bottom;
      if (along < -Math.min(c.bottom - c.top, from.bottom - from.top) / 2) continue;
      along = Math.max(0, along) + Math.abs(cy(c) - cy(from)) * 0.1;
      overlap = Math.min(c.right, from.right) - Math.max(c.left, from.left);
      across = overlap > 0 ? 0 : Math.abs(cx(c) - cx(from));
    }
    const score = along + across * 3;
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}

export function isUsable(el) {
  if (!el || el.disabled || el.getAttribute?.("aria-disabled") === "true") return false;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false;
  if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) {
    // Off screen but inside something that scrolls: still reachable (it scrolls into view)
    let p = el.parentElement, scrolls = false;
    while (p && p !== document.body) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowY + s.overflowX)) { scrolls = true; break; } p = p.parentElement; }
    if (!scrolls) return false;
  }
  const s = getComputedStyle(el);
  if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0 && !el.matches(".twitch-fav,.twitch-tool")) return false;
  return !el.closest("[aria-hidden=true],[inert]");
}

// A dialog that's open takes over: only what's in it can be used
export function scopeOf(doc = document) {
  const open = [...doc.querySelectorAll(".mbk, [role=dialog], [aria-modal=true], .cx-screen.full")].filter((d) => { const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  return open.length ? open[open.length - 1] : doc.body;
}
