/*
 * Continuous flow: a row of cards that drifts sideways for ever. The track holds the cards twice, so when the first set
 * has passed the second is exactly where the first began and the position wraps without a seam.
 *  - It drifts at `speed` px/s, driven per frame on a transform (sub-pixel smooth, no scroll snapping to whole pixels).
 *  - A finger or mouse can grab it: it follows the drag and, let go, glides on with the swipe's momentum before the
 *    drift takes over again a moment later. Vertical swipes still scroll the page (touch-action: pan-y).
 *  - It holds still while a mouse rests on it or a card has keyboard focus, while it is off screen or the tab is hidden,
 *    and whenever the visitor asks for less motion (it can still be dragged). `setPaused` is the visible pause button.
 * Returns { destroy, setPaused }.
 */
const reduced = () => document.documentElement.dataset.motion === 'reduce' || false;

export function flowRail(viewport, track, { speed = 30, resumeAfter = 2200 } = {}) {
  let pos = 0, half = 0, raf = 0, last = 0, alive = true;
  let hover = false, focus = false, paused = false, visible = true, holdUntil = 0;
  let drag = null, momentum = 0, suppressClick = false;

  function measure() {
    const n = track.children.length / 2;
    if (n < 1) { half = 0; return; }
    half = track.children[n].offsetLeft - track.children[0].offsetLeft;
  }
  const wrap = () => { if (half > 0) pos = ((pos % half) + half) % half; };
  const paint = () => { track.style.transform = `translate3d(${(-pos).toFixed(2)}px, 0, 0)`; };
  const drifting = () => !paused && !reduced() && performance.now() > holdUntil;   /* never stops for a resting mouse or focus: it keeps moving left */

  function tick(now) {
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    if (!drag) {
      if (Math.abs(momentum) > 4) {
        pos += momentum * dt;
        momentum *= Math.pow(0.05, dt);          /* glide out over about a second */
      } else {
        momentum = 0;
        if (drifting()) pos += speed * dt;
      }
    }
    wrap(); paint();
    raf = alive && visible && !document.hidden ? requestAnimationFrame(tick) : 0;
    if (!raf) last = 0;
  }
  const run = () => { if (!raf && alive && visible && !document.hidden) raf = requestAnimationFrame(tick); };

  /* ---- grab and swipe */
  viewport.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    drag = { id: e.pointerId, x: e.clientX, from: pos, moved: false, samples: [{ x: e.clientX, t: e.timeStamp }] };
    momentum = 0;
    run();
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved) {
      if (Math.abs(dx) < 6) return;
      drag.moved = true;
      viewport.classList.add('is-drag');
      try { viewport.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    }
    pos = drag.from - dx;
    drag.samples.push({ x: e.clientX, t: e.timeStamp });
    while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > 100) drag.samples.shift();
  });
  const end = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const d = drag;
    drag = null;
    viewport.classList.remove('is-drag');
    if (!d.moved) return;
    const a = d.samples[0], b = d.samples[d.samples.length - 1];
    const v = b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0;          /* px/ms */
    momentum = -Math.max(-3, Math.min(3, v)) * 1000;              /* px/s, opposite to the finger */
    holdUntil = performance.now() + resumeAfter;
    /* the release turns into a click on the card under the finger; a drag is not a choice */
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 60);
  };
  viewport.addEventListener('pointerup', end);
  viewport.addEventListener('dragstart', (e) => e.preventDefault());   /* no ghost-image drag of a card link */
  viewport.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.id) { drag = null; viewport.classList.remove('is-drag'); holdUntil = performance.now() + resumeAfter; } });
  viewport.addEventListener('click', (e) => { if (suppressClick) { e.preventDefault(); e.stopPropagation(); } }, true);

  /* trackpads: a sideways scroll moves the row */
  viewport.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    pos += e.deltaX; momentum = 0;
    holdUntil = performance.now() + resumeAfter;
    run();
  }, { passive: false });

  /* ---- hold still for a resting mouse or keyboard focus; keep a focused card in view */
  viewport.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hover = true; });
  viewport.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hover = false; });
  viewport.addEventListener('focusin', (e) => {
    focus = true;
    const card = e.target.closest('a, button');
    if (card) {
      const vr = viewport.getBoundingClientRect(), cr = card.getBoundingClientRect();
      if (cr.left < vr.left + 12) pos -= vr.left + 12 - cr.left;
      else if (cr.right > vr.right - 12) pos += cr.right - (vr.right - 12);
      viewport.scrollLeft = 0;
      wrap(); paint();
    }
  });
  viewport.addEventListener('focusout', (e) => { if (!viewport.contains(e.relatedTarget)) focus = false; });

  /* ---- only run while on screen and while the tab is showing */
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) run(); }) : null;
  io?.observe(viewport);
  const onVis = () => { if (!document.hidden) run(); };
  document.addEventListener('visibilitychange', onVis);
  let rz = 0;
  const onResize = () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { measure(); wrap(); paint(); }); };
  window.addEventListener('resize', onResize);
  document.fonts?.ready.then(() => { if (alive) { measure(); wrap(); paint(); } });

  requestAnimationFrame(() => { if (!alive) return; measure(); paint(); run(); });

  return {
    setPaused(v) { paused = v; if (v) momentum = 0; else { holdUntil = 0; run(); } },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf); cancelAnimationFrame(rz);
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', onResize);
    }
  };
}
