import { h, icon } from './dom.js';
import { haptic } from './haptics.js';

/*
 * The dock: a graphite glass capsule of round buttons. The selected item opens into a pill that carries its name,
 * filled with signal cyan and lit from within - a lens of light whose bloom spills onto the page around the dock.
 *
 * Everything moves on springs, so any tap mid-flight is picked up from wherever things are:
 *  - the lens's two edges travel separately - the leading edge is thrown, the trailing edge follows - so it stretches
 *    like a drop between items, squashes with its speed and beads up on landing (a sheen crosses it as it lands);
 *  - each item's name opens and closes on its own spring, and the lens aims at where the target will settle.
 * With a mouse the icons swell toward the pointer (dock magnification). With a thumb, press and slide along the dock:
 * the lens follows the finger with a light tick at each item, and letting go opens the item under it.
 * Scrolling down tucks the dock behind a small handle; scrolling up, reaching the end or tapping the handle brings it
 * back. On a screen too narrow for a name, the lens stays round and the names live in the tooltips.
 */
const spring = (response, damping) => { const k = (2 * Math.PI / response) ** 2; return { k, c: 2 * Math.sqrt(k) * damping }; };
const LEAD = spring(0.3, 0.8), TRAIL = spring(0.46, 0.94), OPEN = spring(0.36, 0.88), FOLLOW = spring(0.08, 1);
const STEP = 1 / 240;   /* physics sub-step, s */
/* the item lit on the previous page, so the lens flows from it; the dock rises in only on the first page of a visit */
let lastIndex = null;
let entered = false;

const reduced = () => document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const px = (v) => `${v.toFixed(2)}px`;

export function createLiquidDock({ items, end, current, autoHide = true }) {
  const all = end ? [...items, end] : [...items];
  const n = all.length;
  let target = Math.max(0, all.findIndex((it) => it.id === current));
  const start = lastIndex != null && lastIndex < n && lastIndex !== target ? lastIndex : target;

  /* ---- markup: glass, bloom, lens, items (a hairline separates the account at the end) */
  const lens = h('span', { class: 'dk__lens', 'aria-hidden': 'true' }, [h('span', { class: 'dk__sheen' })]);
  const spill = h('span', { class: 'dk__spill', 'aria-hidden': 'true' });
  const tag = h('span', { class: 'dk__tag', 'aria-hidden': 'true' });
  const labels = [];
  let suppressClick = false;
  const btns = all.map((it, i) => {
    const lbl = h('span', { class: 'dk__lbl' }, h('span', { class: 'dk__txt', text: it.short || it.label }));
    labels.push(lbl);
    return h('a', {
      class: `dk__item${end && it === end ? ' dk__item--end' : ''}`, href: it.href, 'aria-label': it.label, 'data-tip': it.label, 'data-tip-desc': it.desc || '', style: `--j:${i}`,
      onclick: (e) => {
        if (suppressClick) { e.preventDefault(); return; }
        if (i !== target) { select(i); haptic(10); }
      }
    }, [h('span', { class: 'dk__ic', 'aria-hidden': 'true' }, it.render ? it.render() : icon(it.icon)), lbl]);
  });
  const nav = h('nav', { class: 'dk', 'aria-label': 'Main' }, [
    spill, h('span', { class: 'dk__glass', 'aria-hidden': 'true' }), lens,
    ...btns.slice(0, end ? n - 1 : n), end ? h('span', { class: 'dk__sep', 'aria-hidden': 'true' }) : null, end ? btns[n - 1] : null, tag
  ]);

  /* ---- geometry, measured once the dock is on the page (and again on resize / when the web fonts arrive):
     each item's left edge and width with every name closed, and the width each name needs */
  let lefts = [], base = [], lw = [], ready = false;
  function measure() {
    nav.classList.remove('is-compact');
    labels.forEach((l) => { l.style.width = '0px'; });
    lefts = btns.map((b) => b.offsetLeft);
    base = btns.map((b) => b.offsetWidth);
    /* layout widths: the entrance animation scales the items, so transformed boxes would read short */
    lw = labels.map((l) => l.firstChild.offsetWidth);
    /* the dock must fit the screen with any one name open, or it keeps every name in the tooltips */
    const room = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth) - 16;
    if (nav.offsetWidth + Math.max(...lw) > room) { nav.classList.add('is-compact'); lw = lw.map(() => 0); }
    ready = true;
  }
  /* where item j sits right now, given how open the names before it are */
  const leftNow = (j) => { let x = lefts[j]; for (let k = 0; k < j; k++) x += clamp(o[k], 0, 1.06) * lw[k]; return x; };
  const centreNow = (j) => leftNow(j) + base[j] / 2;
  const nearest = (x) => { let best = 0; for (let j = 1; j < n; j++) if (Math.abs(centreNow(j) - x) < Math.abs(centreNow(best) - x)) best = j; return best; };

  /* ---- spring state: lens edges, per-item openness */
  const o = all.map((_, j) => (j === start ? 1 : 0)), ov = all.map(() => 0);
  let L = 0, R = 0, vL = 0, vR = 0, edgeL = LEAD, edgeR = LEAD, raf = 0, last = 0, dragX = null, alive = true;

  function paint() {
    for (let j = 0; j < n; j++) {
      const oo = clamp(o[j], 0, 1.06);
      labels[j].style.width = px(oo * lw[j]);
      labels[j].style.setProperty('--o', clamp((o[j] - 0.3) / 0.7, 0, 1).toFixed(3));
    }
    const w = Math.max(10, R - L), v = (vL + vR) / 2;
    /* fast travel thins the lens a little; it is back to round the moment it lands */
    const squash = Math.min(0.12, Math.abs(v) / 4200);
    lens.style.width = px(w);
    lens.style.transform = `translate3d(${px(L)}, 0, 0) scaleY(${(1 - squash).toFixed(4)})`;
    spill.style.width = px(w + 36);
    spill.style.transform = `translate3d(${px(L - 18)}, 0, 0)`;
    tag.style.transform = `translate3d(${px((L + R) / 2)}, 0, 0)`;
    /* an icon turns dark only while the lens actually covers it, so a passing lens never leaves dark ink on graphite */
    for (let j = 0; j < n; j++) {
      const c = leftNow(j) + base[j] / 2;
      btns[j].classList.toggle('is-lit', L <= c - 10 && R >= c + 10);
    }
  }
  function tick(now) {
    const dt = Math.min(1 / 30, (now - (last || now)) / 1000 || 1 / 60);
    last = now;
    const scrub = dragX != null;
    /* names hold still while a thumb slides along the dock, so nothing moves under the finger */
    for (let j = 0; j < n; j++) {
      const goal = j === target ? 1 : 0;
      for (let s = Math.ceil(dt / STEP), h = dt / s; s > 0; s--) { ov[j] += (OPEN.k * (goal - o[j]) - OPEN.c * ov[j]) * h; o[j] += ov[j] * h; }
    }
    const d = base[0];
    const gL = scrub ? dragX - d / 2 : lefts[target];
    const gR = scrub ? dragX + d / 2 : lefts[target] + base[target] + lw[target];
    const sL = scrub ? FOLLOW : edgeL, sR = scrub ? FOLLOW : edgeR;
    /* small fixed sub-steps keep the stiff finger-follow spring stable at any frame rate */
    for (let s = Math.ceil(dt / STEP), h = dt / s; s > 0; s--) {
      vL += (sL.k * (gL - L) - sL.c * vL) * h; L += vL * h;
      vR += (sR.k * (gR - R) - sR.c * vR) * h; R += vR * h;
    }
    paint();
    const settled = !scrub && Math.abs(gL - L) < 0.1 && Math.abs(gR - R) < 0.1 && Math.abs(vL) + Math.abs(vR) < 1
      && o.every((x, j) => Math.abs((j === target ? 1 : 0) - x) < 0.002) && ov.every((x) => Math.abs(x) < 0.01);
    if (settled) { snap(); raf = 0; last = 0; return; }
    raf = requestAnimationFrame(tick);
  }
  const run = () => { if (!raf && ready && alive) raf = requestAnimationFrame(tick); };
  function snap() {
    o.forEach((_, j) => { o[j] = j === target ? 1 : 0; ov[j] = 0; });
    L = lefts[target]; R = L + base[target] + lw[target]; vL = vR = 0;
    paint();
  }

  /* ---- selecting: the edge on the side of travel leads, the other trails; a sheen crosses the lens as it lands */
  function select(i) {
    const moved = i !== target;
    target = i;
    lastIndex = i;
    btns.forEach((b, j) => (j === i ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
    if (!ready) return;
    const goalC = lefts[i] + (base[i] + lw[i]) / 2, now = (L + R) / 2;
    edgeL = goalC < now ? LEAD : TRAIL;
    edgeR = goalC < now ? TRAIL : LEAD;
    if (reduced()) { cancelAnimationFrame(raf); raf = 0; snap(); return; }
    if (moved) { lens.classList.remove('is-land'); void lens.offsetWidth; lens.classList.add('is-land'); }
    run();
  }

  /* ---- the name that rides above a sliding thumb */
  let tagFor = -1, tagT = 0;
  function showTag(i) {
    if (i !== tagFor) { tagFor = i; tag.textContent = all[i].short || all[i].label; }
    clearTimeout(tagT);
    tag.classList.add('is-on');
  }
  const hideTag = (ms = 0) => { clearTimeout(tagT); tagT = setTimeout(() => tag.classList.remove('is-on'), ms); };

  /* ---- mouse: icons swell toward the pointer, falling off with distance */
  function magnify(x) {
    for (let j = 0; j < n; j++) {
      const c = leftNow(j) + base[j] / 2, m = x == null ? 0 : Math.max(0, 1 - Math.abs(c - x) / 96);
      btns[j].style.setProperty('--m', (m * m).toFixed(3));
    }
  }

  /* ---- thumb: press anywhere on the dock and slide; the lens follows the finger */
  let down = null, over = -1;
  const localX = (e) => e.clientX - nav.getBoundingClientRect().left;
  nav.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || e.pointerType === 'mouse') return;
    down = { id: e.pointerId, x: e.clientX, moved: false };
  });
  nav.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') { if (ready) magnify(localX(e)); return; }
    if (!down || e.pointerId !== down.id || !ready) return;
    if (!down.moved) {
      if (Math.abs(e.clientX - down.x) < 8) return;
      down.moved = true;
      try { nav.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      nav.classList.add('is-scrub');
      edgeL = edgeR = FOLLOW;
    }
    if (!down) return;
    dragX = clamp(localX(e), centreNow(0), centreNow(n - 1));
    const i = nearest(dragX);
    if (i !== over) {
      btns[over]?.classList.remove('is-over');
      over = i; btns[i].classList.add('is-over');
      haptic(6);
    }
    showTag(i);
    run();
  });
  nav.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') magnify(null); });
  const release = (e, cancelled = false) => {
    if (!down || (e && e.pointerId !== down.id)) return;
    const wasDrag = down.moved;
    down = null;
    nav.classList.remove('is-scrub');
    btns[over]?.classList.remove('is-over');
    if (wasDrag && dragX != null) {
      const i = cancelled ? target : nearest(dragX);
      dragX = null; over = -1;
      hideTag(cancelled ? 0 : 700);
      if (cancelled) { select(target); return; }
      /* the pointer-up becomes a click on the item the press began on; ignore that one */
      suppressClick = true; setTimeout(() => { suppressClick = false; }, 350);
      const moved = i !== target;
      select(i);
      if (!moved) { lens.classList.remove('is-land'); void lens.offsetWidth; lens.classList.add('is-land'); run(); }
      haptic(12);
      if (all[i].href && location.hash !== all[i].href) location.hash = all[i].href;
    }
  };
  nav.addEventListener('pointerup', (e) => release(e));
  nav.addEventListener('pointercancel', (e) => release(e, true));
  /* only the dock's own capture ending counts: a touch starts captured by the item under it, and handing that capture
     to the dock fires lostpointercapture on the item, which bubbles up here */
  nav.addEventListener('lostpointercapture', (e) => { if (e.target === nav && down?.moved) release(e); });

  /* ---- keyboard: arrows move between the dock's items */
  nav.addEventListener('keydown', (e) => {
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    const d = { ArrowRight: 1, ArrowLeft: -1, Home: -n, End: n }[e.key];
    if (!d) return;
    e.preventDefault();
    btns[clamp(i + d, 0, n - 1)].focus();
  });

  /* ---- out of the way while reading */
  const cur = all[target];
  const handle = h('button', { class: 'dk-handle', type: 'button', 'aria-label': 'Show menu', tabindex: '-1', onclick: () => { setHidden(false); haptic(8); } }, [
    h('span', { class: 'dk-handle__ic', 'aria-hidden': 'true' }, cur.render ? cur.render() : icon(cur.icon)),
    h('span', { class: 'dk-handle__txt', text: cur.short || cur.label }),
    h('span', { class: 'dk-handle__grip', 'aria-hidden': 'true' })
  ]);
  const wrap = h('div', { class: 'dkw' }, [nav, handle]);
  let hidden = false, lastY = window.scrollY, acc = 0;
  function setHidden(v) {
    if (v === hidden) return;
    hidden = v;
    wrap.classList.toggle('is-hidden', v);
    document.body.classList.toggle('dock-off', v);
    handle.tabIndex = v ? 0 : -1;
    nav.inert = v;
    if (!v) magnify(null);
  }
  const onScroll = () => {
    if (!autoHide || down) return;
    const y = window.scrollY, dy = y - lastY;
    lastY = y;
    acc = dy > 0 ? Math.max(0, acc) + dy : Math.min(0, acc) + dy;
    const atEnd = window.innerHeight + y >= document.documentElement.scrollHeight - 48;
    if (y < 24 || atEnd || acc < -16) setHidden(false);
    else if (acc > 36) setHidden(true);
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---- start: measure on the first frame the dock is on the page, place the lens on the previous page's item, then
     flow to this page's item */
  btns[target].setAttribute('aria-current', 'page');
  if (!entered && !reduced()) wrap.classList.add('is-enter');
  entered = true;
  const relayout = () => { if (!alive || !nav.isConnected) return; measure(); snap(); };
  function init() {
    if (!alive) return;
    if (!nav.isConnected) { requestAnimationFrame(init); return; }
    measure();
    const t = target;
    target = start;
    snap();
    if (t !== start) requestAnimationFrame(() => select(t)); else lastIndex = t;
  }
  requestAnimationFrame(init);
  let rz = 0;
  const onResize = () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(relayout); };
  window.addEventListener('resize', onResize);
  document.fonts?.ready.then(() => { if (!raf) relayout(); });

  return {
    el: wrap,
    destroy() {
      alive = false;
      cancelAnimationFrame(raf); cancelAnimationFrame(rz); clearTimeout(tagT);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      document.body.classList.remove('dock-off');
    }
  };
}
