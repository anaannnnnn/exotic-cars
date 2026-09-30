/*
 * Notched card (the shape from the design): a rounded card with a bite out of its top-right corner, the bite's
 * inner corner convex and its lower edge flowing out in a concave fillet. A round button sits in the bite.
 * The outline is a clip-path drawn in pixels and redrawn whenever the card changes size. The bite scales with the
 * card (`n` can be a function of width) so a small card gets a small bite and nothing important is cut away;
 * the size is published as --n on `sizeVar` (the wrapper) so the button follows.
 */
export function notchPath(w, h, { r = 24, n = 58, k = 14 } = {}) {
  const f = (v) => v.toFixed(2);
  return `path('M ${f(r)} 0 H ${f(w - n - k)} A ${k} ${k} 0 0 1 ${f(w - n)} ${f(k)} V ${f(n - k)} A ${k} ${k} 0 0 0 ${f(w - n + k)} ${f(n)} `
    + `H ${f(w - r)} A ${r} ${r} 0 0 1 ${f(w)} ${f(n + r)} V ${f(h - r)} A ${r} ${r} 0 0 1 ${f(w - r)} ${f(h)} H ${f(r)} A ${r} ${r} 0 0 1 0 ${f(h - r)} V ${f(r)} A ${r} ${r} 0 0 1 ${f(r)} 0 Z')`;
}

const watched = new WeakMap();
const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((entries) => {
  for (const e of entries) {
    const o = watched.get(e.target);
    if (!o) continue;
    const box = e.borderBoxSize?.[0];
    const width = box ? box.inlineSize : e.contentRect.width, height = box ? box.blockSize : e.contentRect.height;
    if (!width || !height) continue;
    const n = typeof o.n === 'function' ? o.n(width) : o.n;
    e.target.style.clipPath = notchPath(width, height, { ...o, n });
    o.sizeVar?.style.setProperty('--n', `${n}px`);
  }
}) : null;

/** Clip `el` to the notched shape. opts: r (corner), n (bite size or fn(width)), k (inner radii), sizeVar (element to receive --n). */
export function notch(el, opts = {}) {
  watched.set(el, opts);
  ro?.observe(el);
  return el;
}

/** Bite size for a card of width w: about a quarter of it, between `min` and `max`. */
export const biteFor = (min, max) => (w) => Math.round(Math.max(min, Math.min(max, w * 0.24)));
