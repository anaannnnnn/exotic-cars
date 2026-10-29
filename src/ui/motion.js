/*
 * Motion Lib (motion.devxpert.online), vanilla ports. One delegated pointer handler drives every element that opts in
 * with data-fx, so cards that are re-rendered later need no wiring:
 *   spot  - Card Spotlight: a soft light follows the cursor (--mx, --my in px)
 *   tilt  - 3D Card Effect: the card leans toward the pointer (--px, --py, -0.5..0.5); children sit at their own depth in CSS
 *   glare - Holographic Glare: a light streak crosses the card as the pointer moves (--gx, %)
 *   mag   - Magnetic button: the element leans toward the cursor and springs back (--tx, --ty, px)
 * Mouse only: touch devices get the CSS press states and the scroll-driven focus on rails (fx.js). All of it is off
 * when the visitor asked for less motion.
 */
const calm = () => document.documentElement.dataset.motion === 'reduce' || false;
const VARS = ['--mx', '--my', '--px', '--py', '--gx', '--tx', '--ty'];

let started = false;

/*
 * Reveal card (Motion Lib "Product reveal card", vanilla): tapping a car card slides a dark overlay up over it with two
 * choices - "See more details" and, when the car has a 3D model (data-cfg), "Customize in 3D". Sold cards (.is-sold)
 * and the archive keep their plain link. One card is open at a time; Escape or a tap elsewhere closes it.
 */
const CARD = '.xc, .hub .ncard:not(.is-sold), .scw > .scard:not(.is-sold), .vr-grid .vrc';
let openCard = null;
function closeCard() { if (openCard) { openCard.classList.remove('is-open'); openCard.querySelector('.rvl')?.setAttribute('aria-hidden', 'true'); openCard = null; } }
function overlayFor(card) {
  let ov = card.querySelector(':scope > .rvl');
  if (ov) return ov;
  const href = card.getAttribute('href') || '';
  const title = card.dataset.tip || card.getAttribute('aria-label') || '';
  const go = (to) => (e) => { e.preventDefault(); e.stopPropagation(); closeCard(); location.hash = to; };
  const btn = (cls, text, to) => { const b = document.createElement('button'); b.type = 'button'; b.className = `rvl__btn ${cls}`; b.textContent = text; b.addEventListener('click', go(to)); return b; };
  ov = document.createElement('span');
  ov.className = 'rvl';
  ov.setAttribute('aria-hidden', 'true');
  const name = document.createElement('b');
  name.className = 'rvl__name';
  name.textContent = title;
  const acts = document.createElement('span');
  acts.className = 'rvl__acts';
  acts.append(btn('rvl__btn--main', 'See more details', href.replace(/^#?/, '#')));
  if (card.dataset.vr === '1') {
    const v = document.createElement('button');
    v.type = 'button'; v.className = 'rvl__btn rvl__btn--ghost'; v.textContent = 'Open in VR';
    v.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeCard(); card.dispatchEvent(new CustomEvent('vropen')); });
    acts.append(v);
  }
  if (card.dataset.cfg === '1') acts.append(btn('rvl__btn--ghost', 'Customize in 3D', `${href.replace(/^#?/, '#')}/configure`));
  const x = document.createElement('button');
  x.type = 'button'; x.className = 'rvl__x'; x.setAttribute('aria-label', 'Close'); x.textContent = '×';
  x.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeCard(); });
  ov.append(x, name, acts);
  card.append(ov);
  return ov;
}
function initCardReveal() {
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('.rvl')) return;
    const card = e.target.closest?.(CARD);
    if (!card) { closeCard(); return; }
    e.preventDefault();
    if (card === openCard) { closeCard(); return; }
    closeCard();
    const ov = overlayFor(card);
    card.classList.add('is-open');
    ov.setAttribute('aria-hidden', 'false');
    openCard = card;
    ov.querySelector('.rvl__btn')?.focus({ preventScroll: true });
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCard(); });
  window.addEventListener('hashchange', closeCard);
}

export function initMotion() {
  if (started) return;
  started = true;
  initCardReveal();
  let cur = null, raf = 0, ev = null;

  const reset = (el) => { if (!el) return; el.classList.remove('is-fx'); VARS.forEach((v) => el.style.removeProperty(v)); };

  const frame = () => {
    raf = 0;
    if (!cur || !ev) return;
    const r = cur.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    const fx = cur.dataset.fx || '';
    cur.classList.add('is-fx');
    if (fx.includes('spot')) { cur.style.setProperty('--mx', `${x.toFixed(1)}px`); cur.style.setProperty('--my', `${y.toFixed(1)}px`); }
    if (fx.includes('tilt')) { cur.style.setProperty('--px', (x / r.width - 0.5).toFixed(3)); cur.style.setProperty('--py', (y / r.height - 0.5).toFixed(3)); }
    if (fx.includes('glare')) cur.style.setProperty('--gx', `${((x / r.width) * 140 - 60).toFixed(1)}%`);
    if (fx.includes('mag')) { cur.style.setProperty('--tx', `${((x - r.width / 2) * 0.28).toFixed(1)}px`); cur.style.setProperty('--ty', `${((y - r.height / 2) * 0.28).toFixed(1)}px`); }
  };

  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || calm()) return;
    const el = e.target.closest?.('[data-fx]') || null;
    if (el !== cur) { reset(cur); cur = el; }
    if (!cur) return;
    ev = e;
    if (!raf) raf = requestAnimationFrame(frame);
  }, { passive: true });

  document.addEventListener('pointerleave', () => { reset(cur); cur = null; }, { passive: true });
  window.addEventListener('blur', () => { reset(cur); cur = null; });
}

/*
 * Reveal: elements marked data-reveal get .is-in the first time they come into view (staggered with --i in CSS).
 * Returns the observer's disconnect so a page can clean up.
 */
export function revealIn(root = document, selector = '[data-reveal]') {
  const els = [...root.querySelectorAll(selector)];
  if (!els.length) return () => {};
  if (!('IntersectionObserver' in window) || calm()) { els.forEach((el) => el.classList.add('is-in')); return () => {}; }
  const io = new IntersectionObserver((list) => list.forEach((en) => {
    if (!en.isIntersecting) return;
    en.target.classList.add('is-in');
    io.unobserve(en.target);
  }), { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  els.forEach((el) => io.observe(el));
  return () => io.disconnect();
}

/*
 * Centre focus (Focus cards): the card nearest the middle of a swipe rail gets .is-focus, so touch screens get the
 * same lit-up card a mouse gets on hover. Cheap: one rAF per scroll frame.
 */
export function focusCenter(rail) {
  let raf = 0;
  const run = () => {
    raf = 0;
    const mid = rail.scrollLeft + rail.clientWidth / 2;
    let best = null, bd = Infinity;
    for (const c of rail.children) {
      const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
      if (d < bd) { bd = d; best = c; }
    }
    for (const c of rail.children) c.classList.toggle('is-focus', c === best);
  };
  const queue = () => { if (!raf) raf = requestAnimationFrame(run); };
  rail.addEventListener('scroll', queue, { passive: true });
  const ro = 'ResizeObserver' in window ? new ResizeObserver(queue) : null;
  ro?.observe(rail);
  queue();
  return { refresh: queue, destroy() { rail.removeEventListener('scroll', queue); ro?.disconnect(); cancelAnimationFrame(raf); } };
}
