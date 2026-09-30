import { h } from './dom.js';

/*
 * Floating tooltip (port of unlumen-ui's FloatingTooltip to plain JS): one label that trails the mouse on a spring,
 * squashing and skewing with its speed. Any element with data-tip (and optional data-tip-desc) shows it; plain title
 * attributes are picked up too ("Name · detail" splits into a title and a description) so the native tooltip never doubles it.
 * Mouse only - touch and pen get no hover tooltips.
 */
const SPRING = { stiffness: 750, damping: 45 };
const lerp3 = (v, [a, b, c], [p, q, r]) => (v <= b ? p + ((Math.max(v, a) - a) / (b - a)) * (q - p) : q + ((Math.min(v, c) - b) / (c - b)) * (r - q));

let root, box, titleEl, descEl;
let x = 0, y = 0, vx = 0, vy = 0, tx = 0, ty = 0, raf = 0, last = 0, active = false, current = null, primed = false;
const reduce = () => document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;

function tick(now) {
  const dt = Math.min(1 / 30, Math.max(1 / 240, (now - (last || now)) / 1000 || 1 / 60));
  last = now;
  /* semi-implicit Euler on a damped spring towards the pointer */
  vx += (SPRING.stiffness * (tx - x) - SPRING.damping * vx) * dt; x += vx * dt;
  vy += (SPRING.stiffness * (ty - y) - SPRING.damping * vy) * dt; y += vy * dt;
  /* keep it on screen: near the right or bottom edge it sits on the other side of the pointer */
  const w = box.offsetWidth + 16, hh = box.offsetHeight + 16;
  const ox = x + w > window.innerWidth - 4 ? -w - 4 : 0, oy = y + hh > window.innerHeight - 4 ? -hh - 4 : 0;
  /* and never past an edge, even mid-spring */
  const px = Math.max(2, Math.min(x + ox, window.innerWidth - w - 2)), py = Math.max(2, Math.min(y + oy, window.innerHeight - hh - 2));
  root.style.transform = `translate3d(${px.toFixed(2)}px, ${py.toFixed(2)}px, 0)`;
  if (!reduce()) {
    const sx = lerp3(vx, [-1000, 0, 1000], [0.9, 1, 1.15]), sy = lerp3(vy, [-1000, 0, 1000], [1.15, 1, 0.9]);
    const kx = lerp3(vx, [-1000, 0, 1000], [-3, 0, 3]), ky = lerp3(vy, [-1000, 0, 1000], [-3, 0, 3]);
    box.style.transform = `scale(${sx.toFixed(3)}, ${sy.toFixed(3)}) skew(${kx.toFixed(2)}deg, ${ky.toFixed(2)}deg)`;
  }
  const settled = Math.abs(tx - x) < 0.3 && Math.abs(ty - y) < 0.3 && Math.abs(vx) < 1 && Math.abs(vy) < 1;
  raf = settled && !active ? 0 : requestAnimationFrame(tick);
}
const run = () => { if (!raf) { last = 0; raf = requestAnimationFrame(tick); } };

function read(el) {
  if (el.hasAttribute('title')) {
    const t = el.getAttribute('title');
    el.removeAttribute('title');
    if (t && !el.dataset.tip) {
      const [head, ...rest] = t.split(' · ');
      el.dataset.tip = head;
      if (rest.length && !el.dataset.tipDesc) el.dataset.tipDesc = rest.join(' · ');
    }
  }
  return { t: el.dataset.tip || '', d: el.dataset.tipDesc || '' };
}

function show(el) {
  const { t, d } = read(el);
  if (!t) { hide(); return; }
  if (el !== current || titleEl.textContent !== t || descEl.textContent !== d) {
    current = el;
    titleEl.textContent = t;
    descEl.textContent = d;
    descEl.hidden = !d;
    box.classList.remove('is-swap'); void box.offsetWidth; box.classList.add('is-swap');
  }
  if (!active) {
    if (!primed) { x = tx; y = ty; vx = vy = 0; primed = true; }
    active = true;
    root.classList.add('is-on');
    run();
  }
}
function hide() {
  if (!active) return;
  active = false; current = null;
  root.classList.remove('is-on');
}

export function initFloatTip() {
  if (root) return;
  titleEl = h('span', { class: 'ftip__t' });
  descEl = h('span', { class: 'ftip__d' });
  box = h('div', { class: 'ftip__box' }, [titleEl, descEl]);
  root = h('div', { class: 'ftip', 'aria-hidden': 'true' }, box);
  document.body.append(root);
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    tx = e.clientX; ty = e.clientY;
    if (!primed) { x = tx; y = ty; primed = true; }
    if (active) run();
  }, { passive: true });
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') { hide(); return; }
    const el = e.target.closest?.('[data-tip], [title]');
    if (el && !el.closest('[data-tip-off]')) show(el); else hide();
  });
  document.addEventListener('pointerdown', hide);
  document.addEventListener('scroll', hide, { passive: true, capture: true });
  document.documentElement.addEventListener('pointerleave', hide);
  window.addEventListener('hashchange', hide);
}
