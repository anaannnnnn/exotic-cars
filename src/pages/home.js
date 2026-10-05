import * as stock from '../data/stock.js';
import { h, icon } from '../ui/dom.js';
import { brandMark } from '../ui/brand.js';
import { closePanel } from '../ui/panels.js';
import { getSettings } from '../state/settings.js';
import { Viewer } from '../viewer/sketchfab.js';
import { haptic } from '../ui/haptics.js';
import { themeToggle } from '../ui/theme-toggle.js';

/*
 * Landing: the showroom before the doors open. A line of detail across the top (Dubai, local time, a way straight
 * in), the EXOTIC wordmark with a sheen of light crossing it once, and the featured car - make above, model below -
 * standing on a spotlit turntable. Drag the knob along the ring (or tap its arrows) to turn the car; the visitor
 * cannot orbit freely. Under the stage, three figures from today's stock; at the bottom, the orb: press and hold to
 * open the showroom.
 * The car is a Ferrari, Bugatti or McLaren from stock and changes every 15 minutes, the same for every visitor.
 */

/* the home car is shown commercially, so only freely licensed models are used (CC0 / CC-BY / CC-BY-SA) */
const OPEN_LICENCE = /^(CC0|CC Attribution(-ShareAlike)?)$/;
const BRANDS = /^(Ferrari|Bugatti|McLaren)$/i;
/* models that name a different car than the stock one they were matched to */
const WRONG_MODEL = /solus/i;
const SLOT_MS = 15 * 60 * 1000;
const HOLD_MS = 900;
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAKE_LABEL = { 'Rolls Royce': 'Rolls-Royce', 'Mercedes Benz': 'Mercedes-Benz' };
const label = (b) => MAKE_LABEL[b] || b;

/* ring geometry, in the ellipse's own 417 x 128 box (from the design); the lit arc around the knob spans 2 x ARC rad */
const RING = { w: 417, h: 128, cx: 208.5, cy: 64, rx: 208, ry: 63.5 };
const ARC = 0.17;

function svg(tag, attrs = {}, kids = []) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  kids.forEach((c) => el.append(c));
  return el;
}
const onRing = (t) => [RING.cx + RING.rx * Math.cos(t), RING.cy + RING.ry * Math.sin(t)];

export function mountHome(root) {
  const cars = stock.queryStock({ tab: 'sale' });
  /* one entry per distinct 3D model, so the rotation never shows the same model twice in a row */
  const byModel = new Map();
  for (const c of cars) {
    const m = stock.stockModels3d(c)[0];
    if (!m || !BRANDS.test(c.brand) || !OPEN_LICENCE.test(m.license) || (WRONG_MODEL.test(m.name) && !WRONG_MODEL.test(c.title))) continue;
    if (!byModel.has(m.uid)) byModel.set(m.uid, c);
  }
  let lineup = [...byModel.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  let alive = true, seq = 0, angle = 0, slotTimer = null;
  const failed = new Set();
  const reduce = () => getSettings().reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 3D stage: an overhead spotlight, a contact shadow, the car, and a quiet loading line */
  const stageHost = h('div', { class: 'xh__stage' });
  const loadText = h('span', { class: 'xh__loadtxt', text: 'Bringing the car out' });
  const loading = h('div', { class: 'xh__loading', role: 'status' }, [h('span', { class: 'xh__loadbar', 'aria-hidden': 'true' }), loadText]);
  const show = h('div', { class: 'xh__show is-loading' }, [
    h('span', { class: 'xh__beam', 'aria-hidden': 'true' }),
    h('span', { class: 'xh__pool', 'aria-hidden': 'true' }),
    stageHost, loading
  ]);
  const viewer = new Viewer(stageHost);

  /* ---------- turntable ring with a draggable knob (the two chevron pills) and a lit arc that travels with it */
  const arc = svg('path', { class: 'xh__arc', fill: 'none' });
  const arcGlow = svg('path', { class: 'xh__arcglow', fill: 'none' });
  const ringSvg = svg('svg', { class: 'xh__ring', viewBox: `0 0 ${RING.w} ${RING.h}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' }, [
    svg('defs', {}, [svg('linearGradient', { id: 'xh-ring', x1: '208.683', y1: '10.4828', x2: '208.683', y2: '196.414', gradientUnits: 'userSpaceOnUse' }, [
      svg('stop', { class: 'xh__stop0' }), svg('stop', { offset: '1', class: 'xh__stop1' })
    ])]),
    svg('ellipse', { class: 'xh__floorlight', cx: RING.cx, cy: RING.cy, rx: RING.rx, ry: RING.ry }),
    svg('ellipse', { class: 'xh__track', cx: RING.cx, cy: RING.cy, rx: RING.rx, ry: RING.ry, fill: 'none', stroke: 'url(#xh-ring)' }),
    arcGlow, arc
  ]);
  const leftBtn = h('button', { class: 'xh__pill xh__pill--prev', type: 'button', 'aria-label': 'Turn left', tabindex: '-1' }, icon('left'));
  const rightBtn = h('button', { class: 'xh__pill xh__pill--next', type: 'button', 'aria-label': 'Turn right', tabindex: '-1' }, icon('right'));
  const tip = h('span', { class: 'xh__tip', text: '0°' });
  const knob = h('div', { class: 'xh__knob', role: 'slider', tabindex: '0', 'data-tip': 'Drag to turn the car', 'data-tip-desc': 'Or tap an arrow', 'aria-label': 'Turn the car', 'aria-valuemin': '-180', 'aria-valuemax': '180', 'aria-valuenow': '0', 'aria-valuetext': '0 degrees' }, [leftBtn, rightBtn, tip]);
  const ring = h('div', { class: 'xh__turn' }, [ringSvg, knob]);

  function placeKnob() {
    /* -180 = left end of the ring, 0 = front (bottom), +180 = right end */
    const t = Math.PI / 2 - (angle / 180) * (Math.PI / 2);
    const [x, y] = onRing(t);
    knob.style.left = `${(x / RING.w) * 100}%`;
    knob.style.top = `${(y / RING.h) * 100}%`;
    knob.style.setProperty('--tilt', `${(-angle / 180) * 24}deg`);
    /* the lit arc is a real piece of the ellipse either side of the knob (drawn, not dashed, so it sits exactly under
       the knob at any aspect ratio) */
    const [x0, y0] = onRing(t - ARC), [x1, y1] = onRing(t + ARC);
    const d = `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${RING.rx} ${RING.ry} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
    arc.setAttribute('d', d);
    arcGlow.setAttribute('d', d);
    const deg = Math.round(angle);
    tip.textContent = `${deg > 0 ? '+' : ''}${deg}°`;
    knob.setAttribute('aria-valuenow', String(deg));
    knob.setAttribute('aria-valuetext', `${Math.abs(deg)} degrees ${deg < 0 ? 'left' : deg > 0 ? 'right' : ''}`.trim());
  }
  const turn = (duration = 0) => viewer.spin(angle, duration);
  const setAngle = (a, duration = 0) => { angle = Math.max(-180, Math.min(180, a)); placeKnob(); turn(duration); };

  /* drag anywhere on the ring to turn; a tap on an arrow turns the car a step that way */
  let drag = null;
  ring.addEventListener('pointerdown', (e) => {
    drag = { id: e.pointerId, x: e.clientX, moved: false, target: e.target.closest('.xh__pill') };
    ring.classList.add('is-drag');
    try { ring.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  });
  ring.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (Math.abs(e.clientX - drag.x) > 4) drag.moved = true;
    if (!drag.moved) return;
    const r = ring.getBoundingClientRect();
    setAngle((((e.clientX - r.left) / r.width) * 2 - 1) * 180);
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { moved, target } = drag;
    drag = null;
    ring.classList.remove('is-drag');
    if (!moved && target) { setAngle(angle + (target === leftBtn ? -30 : 30), 0.45); haptic(6); }
  };
  ring.addEventListener('pointerup', endDrag);
  ring.addEventListener('pointercancel', endDrag);
  ring.addEventListener('lostpointercapture', endDrag);
  knob.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: -10, ArrowDown: -10, ArrowRight: 10, ArrowUp: 10, Home: -360, End: 360 }[e.key];
    if (d) { e.preventDefault(); setAngle(angle + d, 0.25); }
  });

  /* ---------- the featured car's caption: make (with its mark) over the model, the year beside it */
  const capMake = h('span', { class: 'xh__make' });
  const capModel = h('span', { class: 'xh__model' });
  const capYear = h('span', { class: 'xh__year' });
  const caption = h('a', { class: 'xh__car', 'data-tip': 'See this car', 'data-tip-desc': 'Photos, specs and booking' }, [capMake, h('span', { class: 'xh__line' }, [capModel, capYear])]);
  const credit = h('p', { class: 'xh__credit' });

  /* ---------- which car: the same for everyone in a 15-minute window, then the next in the lineup */
  const slot = () => Math.floor(Date.now() / SLOT_MS);
  function carFor(n, offset = 0) {
    const list = lineup.filter((c) => !failed.has(c.id));
    if (!list.length) return null;
    const i = (((n * 7) % list.length) + offset) % list.length;   /* step through the lineup, mixing brands */
    return list[(i + list.length) % list.length];
  }
  function schedule() {
    clearTimeout(slotTimer);
    const wait = SLOT_MS - (Date.now() % SLOT_MS) + 500;
    slotTimer = setTimeout(() => { if (alive) { show3d(carFor(slot())); schedule(); } }, wait);
  }

  function setCaption(car) {
    const make = label(car.brand);
    const model = car.title.replace(new RegExp(`^${car.brand.replace(/\s+/g, '[\\s-]*')}\\s*`, 'i'), '') || car.title;
    caption.href = `#/shop/${car.id}`;
    caption.setAttribute('aria-label', `${car.title}${car.year ? `, ${car.year}` : ''} - see this car`);
    capMake.replaceChildren(brandMark(make) || '', h('span', { text: make }));
    capModel.textContent = model;
    capYear.textContent = car.year ? String(car.year) : '';
    caption.classList.remove('is-swap'); void caption.offsetWidth; caption.classList.add('is-swap');
  }

  /* the caption names the car on the turntable: it is set for the first car straight away, and after that only when a
     car has actually come out - a model that fails and is skipped never flashes its name - and the credit only ever
     names the model on show */
  let captioned = null;
  async function show3d(car) {
    if (!car) {
      show.classList.remove('is-loading'); show.classList.add('is-empty');
      loadText.textContent = 'The showroom is open';
      credit.replaceChildren();
      caption.href = '#/shop';
      caption.setAttribute('aria-label', `Browse all ${cars.length} cars`);
      capMake.replaceChildren(h('span', { text: 'The collection' }));
      capModel.textContent = `${cars.length} cars for sale`;
      capYear.textContent = '';
      return;
    }
    const model = stock.stockModels3d(car)[0];
    const my = ++seq;
    show.classList.add('is-loading');
    loadText.textContent = `Bringing out the ${label(car.brand)}`;
    if (!captioned) { setCaption(car); captioned = car.id; }
    /* a model that fails to load, or whose wheels cannot be found (so it cannot turn about its own axis), is dropped */
    const drop = () => { failed.add(car.id); if (failed.size < lineup.length) show3d(carFor(slot())); else show3d(null); };
    try { await viewer.load(model); } catch { if (alive && my === seq) drop(); return; }
    if (!alive || my !== seq) return;
    if (!viewer.axes) { drop(); return; }
    if (captioned !== car.id) { setCaption(car); captioned = car.id; }
    credit.replaceChildren(`3D model “${model.name}” by ${model.author} · ${model.license} · `, h('a', { href: model.url, target: '_blank', rel: 'noopener', text: 'Sketchfab' }));
    await viewer.refreshBase();
    angle = 0; placeKnob();
    viewer.spin(reduce() ? 0 : -40, 0);
    await new Promise((r) => setTimeout(r, 900));
    if (!alive || my !== seq) return;
    show.classList.remove('is-loading');
    turn(reduce() ? 0 : 1.6);
    [1800, 4500].forEach((ms) => setTimeout(() => { if (alive && my === seq) viewer.refreshBase().then(() => alive && my === seq && turn(0.4)); }, ms));
  }

  /* ---------- today's stock in three figures */
  const makes = stock.stockBrands('sale').length;
  const in3d = cars.filter((c) => stock.configuratorMatch(c)).length;
  const fig = (n, unit) => h('li', { class: 'xh__fig' }, [h('b', { text: String(n) }), h('span', { text: unit })]);
  const figures = h('ul', { class: 'xh__figs', 'aria-label': 'Today in the showroom' }, [
    fig(cars.length, 'for sale'), fig(makes, makes === 1 ? 'make' : 'makes'), fig(in3d, 'in 3D')
  ]);

  /* ---------- lock: press and hold to unlock the showroom */
  const body = svg('rect', { x: '57.4', y: '65.6', width: '19.2', height: '14', rx: '1.4', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.75' });
  const shackle = svg('path', { class: 'xh__shackle', d: 'M61.5 64.2V60a5.5 5.5 0 0 1 11 0v4.2', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.75' });
  /* the orb: an ivory ring on a soft shadow, a rosso-red hold line that blooms as it fills, and a glossy black core
     whose lock turns red as the hold builds */
  const lockSvg = svg('svg', { viewBox: '0 0 134 134', class: 'xh__locksvg', 'aria-hidden': 'true' }, [
    svg('defs', {}, [
      svg('radialGradient', { id: 'xh-core', cx: '38%', cy: '30%', r: '75%' }, [svg('stop', { offset: '0', 'stop-color': '#34343a' }), svg('stop', { offset: '0.55', 'stop-color': '#0d0d0f' }), svg('stop', { offset: '1', 'stop-color': '#000' })]),
      svg('linearGradient', { id: 'xh-shine', x1: '0', y1: '0', x2: '0', y2: '1' }, [svg('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '0.28' }), svg('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' })])
    ]),
    svg('circle', { cx: '67', cy: '67', r: '67', class: 'xh__halo1' }),
    svg('circle', { cx: '67', cy: '67', r: '58.5', class: 'xh__halo2' }),
    svg('circle', { class: 'xh__holdglow', cx: '67', cy: '67', r: '62.5', fill: 'none', pathLength: '100' }),
    svg('circle', { class: 'xh__hold', cx: '67', cy: '67', r: '62.5', fill: 'none', pathLength: '100' }),
    svg('circle', { cx: '67', cy: '67', r: '49', class: 'xh__core' }),
    svg('ellipse', { cx: '64', cy: '36', rx: '26', ry: '13', class: 'xh__shine' }),
    svg('g', { class: 'xh__lockicon' }, [body, shackle])
  ]);
  const lockBtn = h('button', { class: 'xh__lock', type: 'button', 'aria-label': 'Press and hold to enter the showroom', 'aria-describedby': 'xh-hint' }, [
    h('span', { class: 'xh__aurora', 'aria-hidden': 'true' }), lockSvg
  ]);
  const hint = h('span', { class: 'xh__hint', id: 'xh-hint', text: 'Hold to enter' });

  /*
   * Hold to unlock, driven per frame so it can be let go and re-grabbed at any point without a jump:
   * the ring fills steadily while held (the deliberate part), and drains from wherever it is in 200ms ease-out when released.
   * Progress also compresses the core, lifts the shackle a little and turns up the bloom, hinting at what completing will do.
   */
  const FILL_S = HOLD_MS / 1000, DRAIN_S = 0.2;
  let p = 0, holding = false, opened = false, holdRaf = 0, holdLast = 0, drainFrom = 0, drainT = 0;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  /* a light tick of the motor at each quarter of the hold */
  let quarter = 0;
  function paintHold() { lockBtn.style.setProperty('--p', p.toFixed(4)); }
  function holdTick(now) {
    const dt = Math.min(0.05, (now - (holdLast || now)) / 1000);
    holdLast = now;
    if (holding) {
      p = Math.min(1, p + dt / FILL_S);
      const q = Math.floor(p * 4);
      if (q > quarter && q < 4) { quarter = q; haptic(7); }
      if (p >= 1) { paintHold(); holdRaf = 0; unlock(); return; }
    } else {
      drainT = Math.min(1, drainT + dt / DRAIN_S);
      p = drainFrom * (1 - easeOut(drainT));
    }
    paintHold();
    holdRaf = (holding || p > 0.0005) ? requestAnimationFrame(holdTick) : 0;
    if (!holdRaf) { p = 0; paintHold(); holdLast = 0; }
  }
  const run = () => { if (!holdRaf) { holdLast = 0; holdRaf = requestAnimationFrame(holdTick); } };
  const startHold = (e) => {
    if (opened || e.button > 0) return;
    holding = true;
    quarter = Math.floor(p * 4);
    lockBtn.classList.add('is-holding');
    hint.textContent = 'Keep holding';
    haptic(6);
    try { lockBtn.setPointerCapture?.(e.pointerId); } catch { /* keyboard */ }
    run();
  };
  const cancelHold = () => {
    if (opened || !holding) return;
    holding = false;
    lockBtn.classList.remove('is-holding');
    hint.textContent = 'Hold to enter';
    drainFrom = p; drainT = 0;
    run();
    /* let go early: a short shake says "keep holding" */
    if (p < 0.6) { lockBtn.classList.remove('is-nudge'); void lockBtn.offsetWidth; lockBtn.classList.add('is-nudge'); }
  };
  function enter() {
    /* the ivory iris grows out of the orb into the whole screen, then hands over to Home underneath it */
    const r = lockBtn.getBoundingClientRect();
    const veil = h('div', { class: 'unveil', 'aria-hidden': 'true', style: `--x:${r.left + r.width / 2}px;--y:${r.top + r.height / 2}px;--r0:${r.width * 0.36}px` });
    document.body.append(veil);
    const calm = reduce();
    setTimeout(() => { veil.classList.add('is-grow'); }, calm ? 0 : 380);
    setTimeout(() => { location.hash = '#/home'; }, calm ? 160 : 380 + 520);
  }
  function unlock() {
    opened = true;
    holding = false;
    lockBtn.classList.add('is-open');
    hint.textContent = 'Welcome in';
    haptic([10, 30, 16]);
    enter();
  }
  lockBtn.addEventListener('pointerdown', startHold);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => lockBtn.addEventListener(ev, cancelHold));
  lockBtn.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); startHold(e); } });
  lockBtn.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') cancelHold(); });
  lockBtn.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ---------- a line of detail across the top: city, Dubai time (GST), and a way straight in for anyone in a hurry */
  const clock = h('time', { class: 'xh__time' });
  const tickClock = () => {
    const d = new Date();
    clock.textContent = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' });
    clock.setAttribute('datetime', d.toISOString());
  };
  tickClock();
  const clockTimer = setInterval(tickClock, 15000);
  const skip = h('a', { class: 'xh__skip', href: '#/home', 'data-tip': 'Enter the showroom', 'data-tip-desc': 'Skip the hold' }, [h('span', { text: 'Showroom' }), icon('open')]);

  const main = h('main', { class: 'xh' }, [
    h('div', { class: 'xh__aura', 'aria-hidden': 'true' }),
    h('div', { class: 'xh__meta' }, [h('span', { class: 'xh__city' }, [themeToggle('theme-tg--line'), h('span', { text: 'Dubai' })]), h('span', { class: 'xh__clock' }, [clock, h('small', { text: 'GST' })]), skip]),
    h('header', { class: 'xh__head' }, [
      h('h1', { class: 'xh__brand' }, [h('span', { class: 'xh__word', text: 'EXOTIC' }), h('span', { class: 'xh__sub', text: 'Cars · Dubai' })]),
      caption
    ]),
    h('section', { class: 'xh__floor', 'aria-label': 'Featured car' }, [show, ring, credit]),
    h('footer', { class: 'xh__foot' }, [figures, h('div', { class: 'xh__lockwrap' }, [lockBtn, hint])])
  ]);
  root.append(main);
  placeKnob();

  /* only models already checked to stand on the turntable (tools/turntable-audit.html) */
  fetch(`${import.meta.env.BASE_URL}data/home-turntable.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((list) => {
      if (!list?.ok?.length) return;
      const good = new Set(list.ok);
      const keep = lineup.filter((c) => good.has(stock.stockModels3d(c)[0].uid));
      if (keep.length) lineup = keep;
    })
    .catch(() => {})
    .finally(() => { if (alive) { show3d(carFor(slot())); schedule(); } });

  return { kind: 'home', destroy() { alive = false; clearInterval(clockTimer); cancelAnimationFrame(holdRaf); clearTimeout(slotTimer); viewer.unload(); closePanel(); } };
}
