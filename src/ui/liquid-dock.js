import { h, icon } from './dom.js';
import { haptic } from './haptics.js';

/*
 * Liquid dock: a black oval of round buttons, melted into a larger round button on its right by a liquid neck
 * (SVG "goo" filter). The selection is a drop of signal-coloured liquid - a head and a trailing tail on springs,
 * melted together - so moving between items stretches it out like mercury before it beads up again; the neck swells
 * as the drop flows into the right-hand circle. The last selection is remembered, so changing page animates from it.
 *
 * Made for thumbs: slide a finger along the dock and the drop follows it (a light tick at each item), let go to open
 * the item under it. The head stretches with its speed and squashes under a press, wobbles when it lands, and carries
 * a glossy highlight. Scrolling down a page slides the dock away (a small handle with the current page stays), so it
 * never sits on the content; scrolling up, reaching the end of the page or tapping the handle brings it back.
 */
const NS = 'http://www.w3.org/2000/svg';
/* base geometry for a 4 + 1 dock about 312px wide; each dock scales it to span the phone (see createLiquidDock) */
const BASE = { D: 46, GAP: 8, PAD: 9, H: 64, END: 70 }, NECK = 16;
/* Apple-style springs (response s / damping): the head is thrown with a little overshoot, the tail lags behind it,
   size and press are bouncier so the drop jiggles as it settles */
const spring = (response, damping) => { const k = (2 * Math.PI / response) ** 2; return { k, c: 2 * Math.sqrt(k) * damping }; };
const HEAD = spring(0.34, 0.74), TAIL = spring(0.5, 0.95), SIZE = spring(0.42, 0.45), DRAG = spring(0.07, 0.9);
let lastIndex = null;

const svg = (tag, attrs = {}, kids = []) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); kids.forEach((c) => el.append(c)); return el; };
const reduced = () => document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;
const f2 = (v) => v.toFixed(2);

export function createLiquidDock({ items, end, current, autoHide = true }) {
  const all = [...items, end];
  const n = items.length;
  /* fill the screen width (12px gutters), within reason on very small or large screens */
  const baseW = n * BASE.D + (n - 1) * BASE.GAP + BASE.PAD * 2 + NECK + BASE.END;
  const k = Math.max(0.86, Math.min(1.4, (Math.min(window.innerWidth || 375, 560) - 20) / baseW));   /* edge to edge, 10px gutters */
  const D = Math.round(BASE.D * k), GAP = Math.round(BASE.GAP * k), PAD = Math.round(BASE.PAD * k), H = Math.round(BASE.H * k), END = Math.round(BASE.END * k);
  const pillW = n * D + (n - 1) * GAP + PAD * 2;
  const W = pillW + NECK + END, HH = END;
  const py = (HH - H) / 2, cy = HH / 2;
  const centre = (i) => (i < n ? PAD + i * (D + GAP) + D / 2 : pillW + NECK + END / 2);
  const sizeOf = (i) => (i === n ? END - 12 : D);
  /* size at any x along the dock, so a dragged drop grows as it reaches the big end circle */
  const sizeAt = (x) => { const a = centre(n - 1), b = centre(n); return x <= a ? D : x >= b ? sizeOf(n) : D + (sizeOf(n) - D) * ((x - a) / (b - a)); };
  const nearest = (x) => all.reduce((best, _, i) => (Math.abs(centre(i) - x) < Math.abs(centre(best) - x) ? i : best), 0);
  const uid = `ld${Math.random().toString(36).slice(2, 7)}`;
  const O = 20;   /* svg padding so the blur is not clipped */

  const goo = (id) => svg('filter', { id, x: '-20%', y: '-40%', width: '140%', height: '180%' }, [
    svg('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '6', result: 'b' }),
    svg('feColorMatrix', { in: 'b', mode: 'matrix', values: '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10', result: 'g' }),
    svg('feComposite', { in: 'SourceGraphic', in2: 'g', operator: 'atop' })
  ]);

  /* ---- body: pill + end circle + neck */
  const neck = svg('ellipse', { cx: O + pillW + NECK / 2, cy: O + cy, rx: NECK / 2 + 8, ry: 9 });
  /* the body itself is liquid: a swell rides under the drop, so the black oval bulges where the selection travels */
  const swell = svg('ellipse', { cx: O, cy: O + cy, rx: 0, ry: 0 });
  const body = svg('svg', { class: 'ld__body', width: W + 2 * O, height: HH + 2 * O, viewBox: `0 0 ${W + 2 * O} ${HH + 2 * O}`, 'aria-hidden': 'true' }, [
    svg('defs', {}, [goo(`${uid}-g1`), goo(`${uid}-g2`),
      /* graphite, lighter at the top - the body reads as a polished object, not a flat black shape */
      svg('linearGradient', { id: `${uid}-ink`, x1: '0', y1: '0', x2: '0', y2: '1' }, [svg('stop', { offset: '0', 'stop-color': '#2a2a2f' }), svg('stop', { offset: '0.5', 'stop-color': '#121214' }), svg('stop', { offset: '1', 'stop-color': '#050506' })]),
      /* the bead: bright signal cyan with depth towards its lower edge */
      svg('radialGradient', { id: `${uid}-bead`, cx: '42%', cy: '30%', r: '80%' }, [svg('stop', { offset: '0', 'stop-color': '#b9fffb' }), svg('stop', { offset: '0.45', 'stop-color': '#00fff2' }), svg('stop', { offset: '1', 'stop-color': '#00c9bf' })])]),
    svg('g', { filter: `url(#${uid}-g1)`, class: 'ld__ink', fill: `url(#${uid}-ink)` }, [
      svg('rect', { x: O, y: O + py, width: pillW, height: H, rx: H / 2 }),
      svg('circle', { cx: O + pillW + NECK + END / 2, cy: O + cy, r: END / 2 }),
      neck, swell
    ])
  ]);
  /* ---- the liquid selection: head (an ellipse, so it can stretch) + tail, melted; a gloss streak rides on top */
  const head = svg('ellipse', { cy: O + cy, rx: D / 2, ry: D / 2 });
  const tail = svg('circle', { cy: O + cy, r: D / 2 - 4 });
  const gloss = svg('ellipse', { class: 'ld__gloss', rx: 6, ry: 2 });
  const drop = svg('svg', { class: 'ld__drop', width: W + 2 * O, height: HH + 2 * O, viewBox: `0 0 ${W + 2 * O} ${HH + 2 * O}`, 'aria-hidden': 'true' }, [
    svg('g', { filter: `url(#${uid}-g2)`, class: 'ld__liquid', fill: `url(#${uid}-bead)` }, [tail, head]), gloss
  ]);

  const wells = h('div', { class: 'ld__wells', 'aria-hidden': 'true' }, all.map((_, i) => h('span', {
    class: `ld__well${i === n ? ' ld__well--end' : ''}`, style: `left:${centre(i) - sizeOf(i) / 2}px;--d:${sizeOf(i)}px`
  })));
  /* a glass highlight that rides inside the bead and squeezes with it */
  const core = h('span', { class: 'ld__core', 'aria-hidden': 'true' });
  /* the name of the item under the drop rides above it while sliding, and briefly after a change */
  const tag = h('span', { class: 'ld__tag', 'aria-hidden': 'true' });
  let tagFor = -1, tagT = 0;
  function showTag(i, hold) {
    if (i !== tagFor) { tagFor = i; tag.textContent = all[i].short || all[i].label; }
    tag.classList.add('is-on');
    clearTimeout(tagT);
    if (!hold) tagT = setTimeout(() => tag.classList.remove('is-on'), 1100);
  }
  let suppressClick = false;
  const btns = all.map((it, i) => h('a', {
    class: `ld__btn${i === n ? ' ld__btn--end' : ''}`, href: it.href, 'aria-label': it.label, 'data-tip': it.label, 'data-tip-desc': it.desc || '',
    style: `left:${centre(i) - sizeOf(i) / 2}px;width:${sizeOf(i)}px;height:${sizeOf(i)}px;--j:${i}`,
    onclick: (e) => { if (suppressClick) { e.preventDefault(); return; } ripple(i); go(i); }
  }, it.render ? it.render() : icon(it.icon)));
  const el = h('nav', { class: 'ld', 'aria-label': 'Main', style: `width:${W}px;height:${HH}px;--k:${k.toFixed(3)}` }, [body, wells, drop, core, ...btns, tag]);

  /* ---- springs */
  let target = Math.max(0, all.findIndex((it) => it.id === current));
  const start = lastIndex != null && lastIndex !== target ? lastIndex : target;
  let hx = centre(start), hv = 0, tx = hx, tv = 0, s = sizeOf(start), sv = 0, pr = 0, pv = 0, raf = 0, last = 0;
  let pressGoal = 0, dragX = null, litIdx = -1;

  function paint() {
    /* the head stretches along its travel and thins across it; a press squashes it */
    const stretch = Math.min(0.42, Math.abs(hv) / 1500);
    const r = (s / 2) * (1 - pr * 0.12);
    const rx = r * (1 + stretch), ry = r * (1 - stretch * 0.4);
    head.setAttribute('cx', f2(O + hx));
    head.setAttribute('rx', f2(rx));
    head.setAttribute('ry', f2(Math.max(4, ry)));
    tail.setAttribute('cx', f2(O + tx));
    /* the tail thins out the further it trails, like a drop pulling a thread */
    const gap = Math.abs(hx - tx);
    tail.setAttribute('r', f2(Math.max(r - 5 - gap * 0.08, 8)));
    /* the highlight rides the bead and is squeezed into an oval with it */
    const cw = Math.max(0, 2 * rx - 6 - Math.min(10, gap * 0.12)), ch = Math.max(0, 2 * ry - 6);
    core.style.width = `${f2(cw)}px`; core.style.height = `${f2(ch)}px`;
    core.style.transform = `translate3d(${f2(hx - cw / 2)}px, ${f2(cy - ch / 2)}px, 0)`;
    /* a specular streak across the top of the ring, leaning back as the drop moves */
    gloss.setAttribute('cx', f2(O + hx - Math.sign(hv) * Math.min(6, Math.abs(hv) / 200)));
    gloss.setAttribute('cy', f2(O + cy - ry + 3.2));
    gloss.setAttribute('rx', f2(Math.max(3, rx * 0.36)));
    gloss.setAttribute('ry', '1.6');
    const neckX = pillW + NECK / 2;
    const bump = Math.max(0, 1 - Math.min(Math.abs(hx - neckX), Math.abs(tx - neckX)) / 60);
    neck.setAttribute('ry', f2(9 + bump * 14));
    neck.setAttribute('rx', f2(NECK / 2 + 8 + bump * 7));
    /* the swell: wider and taller the faster the drop moves, a slight bulge under a press, flat at rest */
    const sp = Math.min(1, Math.abs(hv) / 900);
    swell.setAttribute('cx', f2(O + Math.min(hx, pillW - D / 2)));
    swell.setAttribute('rx', f2(D / 2 + 4 + sp * 16));
    swell.setAttribute('ry', f2(H / 2 + sp * 6 + pr * 3));
    /* the icon under the bead turns dark only once the liquid reaches it, so a travelling drop never leaves a dark icon
       on black; the label follows the bead */
    const ni = nearest(hx), lit = Math.abs(hx - centre(ni)) < sizeOf(ni) * 0.36 ? ni : -1;
    if (lit !== litIdx) { btns[litIdx]?.classList.remove('is-lit'); btns[lit]?.classList.add('is-lit'); litIdx = lit; }
    tag.style.transform = `translate3d(${f2(hx)}px, 0, 0)`;
    /* and the whole dock gives a little under the thumb */
    el.style.transform = pr > 0.002 ? `scale(${f2(1 + pr * 0.012)}, ${f2(1 - pr * 0.035)})` : '';
  }
  function tick(now) {
    const dt = Math.min(1 / 30, (now - (last || now)) / 1000 || 1 / 60);
    last = now;
    const dragging = dragX != null;
    const goal = dragging ? dragX : centre(target), gs = dragging ? sizeAt(dragX) : sizeOf(target);
    const HS = dragging ? DRAG : HEAD;
    hv += (HS.k * (goal - hx) - HS.c * hv) * dt; hx += hv * dt;
    tv += (TAIL.k * (goal - tx) - TAIL.c * tv) * dt; tx += tv * dt;
    sv += (SIZE.k * (gs - s) - SIZE.c * sv) * dt; s += sv * dt;
    pv += (SIZE.k * (pressGoal - pr) - SIZE.c * pv) * dt; pr += pv * dt;
    paint();
    const still = Math.abs(goal - hx) < 0.15 && Math.abs(goal - tx) < 0.15 && Math.abs(hv) + Math.abs(tv) < 2 && Math.abs(gs - s) < 0.15 && Math.abs(sv) < 2 && Math.abs(pressGoal - pr) < 0.005 && Math.abs(pv) < 0.05;
    if (still && !dragging) { hx = tx = goal; s = gs; pr = pressGoal; hv = tv = sv = pv = 0; paint(); raf = 0; last = 0; return; }
    raf = requestAnimationFrame(tick);
  }
  const run = () => { if (!raf) raf = requestAnimationFrame(tick); };
  function go(i) {
    const moved = i !== target;
    target = i;
    lastIndex = i;
    btns.forEach((b, j) => (j === i ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
    if (reduced()) { hx = tx = centre(i); s = sizeOf(i); paint(); return; }
    /* landing: the drop dips and swells back - a little wobble */
    if (moved) { sv -= 160; showTag(i, false); }
    run();
  }
  function ripple(i) {
    if (reduced()) return;
    const d = sizeOf(i);
    const rp = h('span', { class: 'ld__ripple', 'aria-hidden': 'true', style: `left:${centre(i) - d / 2}px;width:${d}px;height:${d}px` });
    el.append(rp);
    setTimeout(() => rp.remove(), 650);
  }

  /* ---- thumb scrubbing: press anywhere on the dock and slide; the drop follows the finger */
  let down = null, over = -1;
  const localX = (e) => e.clientX - el.getBoundingClientRect().left;
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    down = { x: e.clientX, id: e.pointerId, moved: false };
    pressGoal = 1; run();
  });
  el.addEventListener('pointermove', (e) => {
    if (!down || e.pointerId !== down.id) return;
    if (!down.moved && Math.abs(e.clientX - down.x) < 8) return;
    if (!down.moved) {
      down.moved = true;
      try { el.setPointerCapture(e.pointerId); } catch { /* gone */ }
      el.classList.add('is-scrub');
    }
    dragX = Math.max(centre(0), Math.min(centre(n), localX(e)));
    const i = nearest(dragX);
    showTag(i, true);
    if (i !== over) {
      btns[over]?.classList.remove('is-over');
      over = i; btns[i].classList.add('is-over');
      haptic(6);
    }
    run();
  });
  const release = (e) => {
    if (!down || (e && e.pointerId !== down.id)) return;
    const wasDrag = down.moved;
    down = null; pressGoal = 0;
    el.classList.remove('is-scrub');
    btns[over]?.classList.remove('is-over');
    if (wasDrag && dragX != null) {
      const i = nearest(dragX);
      dragX = null; over = -1; showTag(i, false);
      /* the pointer-up turns into a click on the item it started on; ignore that one */
      suppressClick = true; setTimeout(() => { suppressClick = false; }, 350);
      ripple(i); go(i); haptic(12);
      if (all[i].href && location.hash !== all[i].href) location.hash = all[i].href;
    }
    run();
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', (e) => { if (down) { dragX = null; over = -1; } release(e); go(target); });
  el.addEventListener('lostpointercapture', (e) => { if (down?.moved) release(e); });

  /* ---- out of the way while reading: scrolling down hides the dock behind a small handle, scrolling up brings it back */
  const cur = all[target];
  const handle = h('button', { class: 'ld-handle', type: 'button', 'aria-label': 'Show menu', tabindex: '-1', onclick: () => { setHidden(false); haptic(8); } },
    [h('span', { class: 'ld-handle__ic', 'aria-hidden': 'true' }, cur.render ? cur.render() : icon(cur.icon)), h('span', { class: 'ld-handle__bar', 'aria-hidden': 'true' })]);
  const wrap = h('div', { class: 'ldw' }, [el, handle]);
  let hidden = false, lastY = window.scrollY, acc = 0;
  function setHidden(v) {
    if (v === hidden) return;
    hidden = v;
    wrap.classList.toggle('is-hidden', v);
    /* coming back: the dock grows out of the handle and its buttons pop in one after another */
    clearTimeout(wrap._t); wrap.classList.remove('is-show');
    if (!v && !reduced()) { void wrap.offsetWidth; wrap.classList.add('is-show'); wrap._t = setTimeout(() => wrap.classList.remove('is-show'), 1000); }
    document.body.classList.toggle('dock-off', v);
    handle.tabIndex = v ? 0 : -1;
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

  paint();
  btns[target].setAttribute('aria-current', 'page');
  /* arriving from another page: flow from the old item to this one */
  if (start !== target) requestAnimationFrame(() => go(target)); else lastIndex = target;
  return { el: wrap, destroy() { cancelAnimationFrame(raf); window.removeEventListener('scroll', onScroll); document.body.classList.remove('dock-off'); } };
}
