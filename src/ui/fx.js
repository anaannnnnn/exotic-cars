/*
 * Small page-wide effects, all delegated so pages only add class names:
 *  - pointer light: pills, tiles and notch buttons catch a soft light where the pointer is (mouse only);
 *  - tilt: `.tilt` cards lean towards the pointer (mouse only) and glint along the lean;
 *  - reveal: `.rv` elements rise into place the first time they scroll into view (staggered by --i).
 */
const SEL = '.pill, .qtile, .notch-btn, .svc, .talk__card, .vrc, .slot, .chip2, .btile, .ncard';
const reduced = () => document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initFx() {
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = e.target.closest?.(SEL);
    if (el) {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${(e.clientX - r.left).toFixed(1)}px`);
      el.style.setProperty('--my', `${(e.clientY - r.top).toFixed(1)}px`);
    }
    const t = e.target.closest?.('.tilt');
    if (t && !reduced()) {
      const r = t.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      t.style.setProperty('--ry', `${(x * 7).toFixed(2)}deg`);
      t.style.setProperty('--rx', `${(-y * 6).toFixed(2)}deg`);
      t.style.setProperty('--gx', `${((x + 0.5) * 100).toFixed(1)}%`);
      t.classList.add('is-tilt');
    }
  }, { passive: true });
  document.addEventListener('pointerout', (e) => {
    const t = e.target.closest?.('.tilt');
    if (t && !t.contains(e.relatedTarget)) { t.classList.remove('is-tilt'); t.style.setProperty('--rx', '0deg'); t.style.setProperty('--ry', '0deg'); }
  }, { passive: true });
  initReveal();
  initTapRipple();
  initRails();
  initBars();
}

/* ---------- scroll reveal ---------- */
function initReveal() {
  const show = (el) => el.classList.add('is-in');
  if (!('IntersectionObserver' in window)) {
    new MutationObserver(() => document.querySelectorAll('.rv:not(.is-in)').forEach(show)).observe(document.body, { childList: true, subtree: true });
    return;
  }
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    show(e.target);
    io.unobserve(e.target);
  }), { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });
  /* horizontal rails reveal their cards as they are scrolled sideways too: observe against the viewport, which still
     reports cards that slide in from the right edge */
  let queued = false;
  const scan = () => {
    queued = false;
    document.querySelectorAll('.rv:not(.rv--watched)').forEach((el) => {
      el.classList.add('rv--watched');
      if (reduced()) show(el); else io.observe(el);
    });
  };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(scan); } }).observe(document.body, { childList: true, subtree: true });
  scan();
}

/* ---------- touch: an ink ripple spreads from where the finger lands ---------- */
const TAP = '.pill, .qtile, .lq__item, .scard, .ncard, .btile, .body-t, .svc, .slot, .chip2, .tb__btn, .fchip, .cta, .ghost, .mk__item, .circle-btn, .hub__icon, .prompt, .vrc, .talk__card, .sg__item, .more, .slide, .ask__go, .bb__x, .way';
function initTapRipple() {
  document.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || reduced()) return;
    const el = e.target.closest?.(TAP);
    if (!el || el.disabled) return;
    const cs = getComputedStyle(el);
    if (cs.position === 'static') el.style.position = 'relative';
    if (cs.isolation !== 'isolate') el.style.isolation = 'isolate';
    let host = el.querySelector(':scope > .tap-host');
    if (!host) { host = document.createElement('span'); host.className = 'tap-host'; host.setAttribute('aria-hidden', 'true'); el.append(host); }
    const r = el.getBoundingClientRect();
    const size = Math.hypot(r.width, r.height) * 2;
    const dot = document.createElement('span');
    dot.className = 'tap';
    dot.style.cssText = `left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px;width:${size}px;height:${size}px`;
    host.append(dot);
    const done = () => { dot.classList.add('is-out'); setTimeout(() => dot.remove(), 420); };
    el.addEventListener('pointerup', done, { once: true });
    el.addEventListener('pointercancel', done, { once: true });
    el.addEventListener('pointerleave', done, { once: true });
    setTimeout(done, 900);
  }, { passive: true });
}

/* ---------- rails: the card nearest the middle is full size, its neighbours ease back as they slide away ---------- */
const RAILS = '.rail2, .show__track';
function focusRail(rail) {
  const mid = rail.scrollLeft + rail.clientWidth / 2;
  for (const c of rail.children) {
    const f = Math.min(1, Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid) / (rail.clientWidth * 0.9));
    c.style.setProperty('--f', f.toFixed(3));
  }
}
function initRails() {
  let q = new Set(), raf = 0;
  const flush = () => { raf = 0; q.forEach(focusRail); q.clear(); };
  document.addEventListener('scroll', (e) => {
    const rail = e.target?.closest?.(RAILS);
    if (!rail || reduced()) return;
    q.add(rail);
    if (!raf) raf = requestAnimationFrame(flush);
  }, { passive: true, capture: true });
  /* new rails get their first pass as they appear */
  new MutationObserver(() => document.querySelectorAll(RAILS).forEach((r) => { if (!r.dataset.f) { r.dataset.f = '1'; requestAnimationFrame(() => focusRail(r)); } else if (!raf) { q.add(r); raf = requestAnimationFrame(flush); } }))
    .observe(document.body, { childList: true, subtree: true });
}

/* ---------- top bars: frosted once the page moves, out of the way while scrolling down, back on the way up ---------- */
const BARS = '.tb, .hub__top, .phead';
function initBars() {
  let lastY = window.scrollY, acc = 0;
  window.addEventListener('scroll', () => {
    const y = window.scrollY, dy = y - lastY;
    lastY = y;
    acc = dy > 0 ? Math.max(0, acc) + dy : Math.min(0, acc) + dy;
    document.querySelectorAll(BARS).forEach((bar) => {
      bar.classList.toggle('is-stuck', y > 6);
      if (y < 80 || acc < -12) bar.classList.remove('is-away');
      else if (acc > 40) bar.classList.add('is-away');
    });
  }, { passive: true });
}
