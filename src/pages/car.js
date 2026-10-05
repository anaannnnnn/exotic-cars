import * as data from '../data/catalog.js';
import * as B from '../state/build.js';
import { Viewer } from '../viewer/sketchfab.js';
import { h, icon, clear, countTo } from '../ui/dom.js';
import { brandMark } from '../ui/brand.js';
import { wheelGlyph } from '../ui/glyph.js';
import { createSwipe } from '../ui/swipe.js';
import { openService, openEnquiry } from '../ui/panels.js';
import { getSettings, getUser } from '../state/settings.js';
import { coverUrl, coverError } from '../data/stock.js';

/* A complete kit already contains these parts - selecting both would double count. */
const FULL_KIT_COVERS = ['front-lip', 'front-bumper', 'rear-bumper', 'rear-diffuser', 'decklid-spoiler', 'side-skirts'];
const TITLES = { paint: 'Colour', wheels: 'Wheels', aero: 'Aero', details: 'Details' };
/* floating tooltip text for the customise menu */
const CAT_TIPS = { paint: 'Colour and finish, live on the car', wheels: 'Wheels Dubai suppliers list for this car', aero: 'Body kits and carbon parts', details: 'Glass tint and brake calipers' };
const VIEW_TIPS = { side: 'Profile', front34: 'Three-quarter front', front: 'Head on', rear: 'From behind', top: 'From above', wheel: 'Close up on the wheel' };
const PAINT_TABS = [{ id: 'solid', label: 'Solid' }, { id: 'metallic', label: 'Metallic' }, { id: 'matte', label: 'Matte' }];

/**
 * The configurator: the 3D car fills the screen; categories float on the left, the options for the chosen category
 * float on the right, the running price and a swipe-to-enquire control sit at the bottom.
 */
export function mountCar(root, id, share, { toast, stock = null, vehicle = null, base = null, back = null }) {
  const v = vehicle || data.vehicle(id);
  if (!v || !v.has3d) return null;

  const route = base || `#/car/${encodeURIComponent(id)}`;
  const name = stock ? stock.title : `${v.make} ${v.model}`;
  let state = { ...B.defaultState(), vehicleId: id, modelUid: v.models[0].uid };
  if (stock) { const p = B.paintForColour(stock.exterior); if (p) state.paint = { preset: p.id, color: p.color, roughness: p.roughness, metalness: p.metalness }; }
  const shared = share ? B.fromShare(share) : null;
  if (shared && shared.vehicleId === id) state = { ...state, ...shared, view: 'side' };
  if (!v.models.some((m) => m.uid === state.modelUid)) state.modelUid = v.models[0].uid;
  state.cat = 'paint';
  state.ptype = (B.byId(B.PAINTS, state.paint.preset) || {}).group || 'solid';
  state.wtab = 'all';

  const parts = data.partsFor(v);
  const product = (pid) => data.product(pid);
  let pickMode = false;
  let caps = null;
  let alive = true;
  let seq = 0;

  /* ------------------------------------------------------------------ layers */
  const stage = h('div', { class: 'cfg__stage' });
  const markText = h('span', { class: 'cfg__mark', 'aria-hidden': 'true', text: v.make });
  const floor = h('div', { class: 'hero__floor' });
  const loading = h('div', { class: 'cfg__loading' }, [h('span', { class: 'spin' }), h('span', { class: 'hero__loadtext', text: 'Loading 3D model' })]);
  const viewer = new Viewer(stage);
  viewer.anchor = 'bottom';   /* the car stands right above the colour strip, not in mid-air */
  window.__viewer = viewer; /* handy for debugging in the console */
  viewer.onPick = (m) => {
    if (!pickMode) return;
    viewer.togglePaintMaterial(m.id);
    const on = viewer.capabilities().paintTargets.includes(m.id);
    toast(on ? 'This part will follow your colour' : 'This part keeps its original colour');
    viewer.highlight(m.id);
  };

  /* ------------------------------------------------------------------ top + title */
  const mark = brandMark(v.make);
  const activeDot = h('i', { class: 'active__dot' });
  const activeText = h('span', { class: 'active__text' });
  const activeChip = h('div', { class: 'active__chip' }, [activeDot, activeText]);
  const active = h('div', { class: 'cfg__active', 'aria-live': 'polite' }, [h('span', { class: 'active__label', text: 'Active' }), activeChip]);
  const viewsEl = h('div', { class: 'cfg__views', role: 'group', 'aria-label': 'Camera view' });
  /* body colours: a row at the bottom whose swatches swell as you slide over them */
  const strip = h('div', { class: 'container-items cfg__strip', role: 'group', 'aria-label': 'Body colour' });
  let stripOn = null;
  function buildStrip(animate) {
    clear(strip);
    B.PAINTS.filter((p) => p.group === state.ptype).forEach((p, i) => {
      const on = state.paint.preset === p.id;
      strip.append(h('button', {
        class: `item-color${on ? ' is-on' : ''}${animate ? ' in' : ''}`, type: 'button', 'aria-label': p.name, 'aria-pressed': String(on), 'aria-color': p.name, style: `--color:${p.color};--i:${i}`,
        onclick: () => {
          state.paint = { preset: p.id, color: p.color, roughness: p.roughness, metalness: p.metalness };
          strip.querySelectorAll('.item-color').forEach((b) => { const m = b === strip.children[i]; b.classList.toggle('is-on', m); b.setAttribute('aria-pressed', String(m)); });
          optsList.querySelector('.opt--custom')?.classList.remove('is-on');
          applyLook(); renderActive(); sync();
        }
      }));
    });
  }
  function showStrip(on) {
    strip.hidden = !on;
    if (stripOn === on) return;
    const first = stripOn === null;
    stripOn = on;
    cfg.classList.toggle('has-strip', on);
    if (!first) requestAnimationFrame(() => { try { updateInsets(); goToView(state.view); } catch { /* viewer not ready */ } });
  }

  const top = h('header', { class: 'cfg__top' }, [
    h('a', { class: 'fbtn', href: back ? back.href : '#/shop', 'aria-label': back ? back.label : 'Back' }, icon('back')),
    h('div', { class: 'cfg__tools' }, [
      h('button', { class: 'fbtn', type: 'button', 'aria-label': 'Save image', onclick: screenshot }, icon('camera')),
      h('button', { class: 'fbtn', type: 'button', 'aria-label': 'Copy share link', onclick: () => copy(shareUrl(), 'Link copied') }, icon('share'))
    ])
  ]);
  const titleEl = h('div', { class: 'cfg__title' }, [
    h('h1', { text: stock ? stock.title.replace(new RegExp(`^${stock.brand}\\s*`, 'i'), '') || stock.title : `${v.model}` }),
    h('p', { text: stock ? [stock.brand, stock.year, stock.exterior].filter(Boolean).join(' · ') : `${v.make} · ${v.generation} · ${data.yearsLabel(v)}` })
  ]);

  /* ------------------------------------------------------------------ rail (left) and options (right) */
  const rail = h('nav', { class: 'rail', 'aria-label': 'Customise' });
  const optsTitle = h('span', { class: 'opts__title' });
  const optsTabs = h('div', { class: 'opts__tabs', role: 'tablist' });
  const optsList = h('div', { class: 'opts__list' });
  const moreDown = h('button', { class: 'chev chev--down', type: 'button', 'aria-label': 'Scroll options down', onclick: () => optsList.scrollBy({ top: optsList.clientHeight * 0.8, behavior: 'smooth' }) }, icon('chevron'));
  const moreUp = h('button', { class: 'chev chev--up', type: 'button', 'aria-label': 'Scroll options up', onclick: () => optsList.scrollBy({ top: -optsList.clientHeight * 0.8, behavior: 'smooth' }) }, icon('up'));
  const opts = h('aside', { class: 'opts', 'aria-label': 'Options' }, [optsTitle, optsTabs, moreUp, optsList, moreDown]);
  const hints = () => {
    const can = optsList.scrollHeight - optsList.clientHeight > 4;
    moreUp.hidden = !can || optsList.scrollTop < 6;
    moreDown.hidden = !can || optsList.scrollTop + optsList.clientHeight >= optsList.scrollHeight - 6;
  };
  optsList.addEventListener('scroll', hints, { passive: true });
  /* hovering a dot previews its name in the chip above; leaving restores the real selection */
  optsList.addEventListener('pointerover', (e) => {
    const t = e.target.closest('.opt');
    if (t && e.pointerType !== 'touch') { const n = (t.getAttribute('title') || '').split(' · ')[0]; if (n) { activeText.textContent = n; activeChip.classList.add('is-peek'); } }
  });
  optsList.addEventListener('pointerleave', () => { activeChip.classList.remove('is-peek'); renderActive(); });

  const categories = () => [
    { id: 'paint', label: 'Paint', icon: 'paint' },
    parts.wheels.length ? { id: 'wheels', label: 'Wheels', icon: 'wheels' } : null,
    parts.kits.length ? { id: 'aero', label: 'Aero', icon: 'aero' } : null,
    caps && (caps.glass || caps.caliper) ? { id: 'details', label: 'Details', icon: 'details' } : null
  ].filter(Boolean);

  function renderRail() {
    clear(rail);
    rail.append(h('span', { class: 'rail__label', text: 'Customise' }));
    const first = !rail.dataset.built;
    const prev = railSizes;
    categories().forEach((c, i) => rail.append(h('button', {
      class: 'rbtn', type: 'button', 'aria-pressed': String(state.cat === c.id), 'aria-label': c.label, 'data-tip': c.label, 'data-tip-desc': CAT_TIPS[c.id], 'data-key': c.id, style: first ? `--i:${i + 1}` : 'animation:none',
      onclick: () => { if (state.cat === c.id) return; state.cat = c.id; railSizes = sizesOf(rail); renderRail(); renderOpts(true); }
    }, [icon(c.icon), h('span', { text: c.label })])));
    rail.dataset.built = '1';
    carrySizes(rail, prev);
    railSizes = null;
  }
  let railSizes = null;
  /* remember how big each control was, so a re-render grows/shrinks from there instead of snapping */
  function sizesOf(box) { const m = new Map(); box.querySelectorAll('[data-key]').forEach((el) => m.set(el.dataset.key, el.offsetWidth)); return m; }
  function carrySizes(box, m) {
    if (!m) return;
    const els = [...box.querySelectorAll('[data-key]')].filter((el) => m.has(el.dataset.key));
    els.forEach((el) => { el.style.width = el.style.height = `${m.get(el.dataset.key)}px`; });
    void box.offsetWidth;
    els.forEach((el) => { el.style.width = el.style.height = ''; });
  }

  /* ---- option tiles */
  const swatchTile = (p) => {
    const on = state.paint.preset === p.id;
    return h('button', {
      class: `opt opt--sw${on ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(on), 'aria-label': p.name, title: p.name, style: `--c:${p.color};--m:${p.metalness};`,
      onclick: () => { state.paint = { preset: p.id, color: p.color, roughness: p.roughness, metalness: p.metalness }; applyLook(); renderOpts(); sync(); }
    }, [h('i', { class: `sw${p.group === 'matte' ? ' is-matte' : ''}` }), on ? h('span', { class: 'opt__tick' }, icon('check')) : null, h('span', { class: 'opt__cap', text: p.name })]);
  };

  const plainSwatch = (c, on, label, onclick, none = false) => h('button', {
    class: `opt opt--sw${on ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(on), 'aria-label': label, title: label, style: `--c:${c || '#ffffff'};--m:0.6;`, onclick
  }, [h('i', { class: `sw${none ? ' sw--none' : ''}` }, none ? h('span', { text: '—' }) : null), on ? h('span', { class: 'opt__tick' }, icon('check')) : null, h('span', { class: 'opt__cap', text: label })]);

  const wheelName = (p) => {
    const d = p.design || p.title.split(/ for /i)[0].slice(0, 32);
    return d.toUpperCase().startsWith(String(p.vendor).toUpperCase()) ? d : `${p.vendor} ${d}`;
  };
  const fitsCar = (p) => {
    const checks = data.wheelChecks(v, p);
    return checks.some((c) => c.ok === true) && !checks.some((c) => c.ok === false);
  };
  const productTile = (p, { label, sub, on, onclick }) => h('button', {
    class: `opt opt--img${on ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(on), 'aria-label': `${label}${sub ? `, ${sub}` : ''}, ${data.aed(p.priceAED)}`, title: `${label} · ${data.aed(p.priceAED)}`, onclick
  }, [
    h('span', { class: 'opt__img' }, p.images && p.images[0] ? h('img', { src: p.images[0], alt: '', loading: 'lazy', decoding: 'async' }) : (p.category === 'wheel' ? wheelGlyph(p.finish?.color || '#a9adb5') : h('span', { class: 'opt__ph', text: p.vendor }))),
    on ? h('span', { class: 'opt__tick' }, icon('check')) : null,
    h('span', { class: 'opt__cap' }, [h('b', { text: label }), sub ? h('em', { text: sub }) : null, h('u', { text: data.aed(p.priceAED) })])
  ]);

  function tabsFor(items, current, onpick) {
    clear(optsTabs);
    /* one compact pill that cycles through the types (keeps the dots column tall) */
    const i = Math.max(0, items.findIndex((t) => t.id === current));
    const next = items[(i + 1) % items.length];
    optsTabs.append(h('button', {
      class: 'otab', type: 'button', 'aria-label': `${items[i].label}. Show ${next.label}`, title: `Next: ${next.label}`, onclick: () => onpick(next.id)
    }, [h('b', { text: items[i].label }), h('i', { class: 'otab__dots' }, items.map((_, n) => h('u', { class: n === i ? 'on' : '' })))]));
    optsTabs.hidden = items.length < 2;
  }

  function renderOpts(animate = false) {
    const keep = optsList.scrollTop;
    const prev = animate ? null : sizesOf(optsList);
    optsTitle.textContent = TITLES[state.cat];
    clear(optsList);
    showStrip(state.cat === 'paint');
    if (state.cat === 'paint') paintOpts(animate);
    else if (state.cat === 'wheels') wheelOpts();
    else if (state.cat === 'aero') aeroOpts();
    else detailOpts();
    optsList.querySelectorAll('.opt').forEach((el, i) => {
      el.dataset.key = el.getAttribute('title') || el.getAttribute('aria-label') || String(i);
      if (animate) { el.classList.add('in'); el.style.setProperty('--i', Math.min(i, 14)); }
    });
    carrySizes(optsList, prev);
    if (animate) { opts.classList.remove('swap'); void opts.offsetWidth; opts.classList.add('swap'); optsList.scrollTop = 0; } else optsList.scrollTop = keep;
    const on = optsList.querySelector('.opt.is-on, .opt[aria-pressed="true"]');
    if (on) requestAnimationFrame(() => optsList.scrollTo({ top: on.offsetTop - optsList.clientHeight / 2 + on.offsetHeight / 2, behavior: animate ? 'auto' : 'smooth' }));
    requestAnimationFrame(hints);
    renderActive();
  }

  function paintOpts(animate) {
    tabsFor(PAINT_TABS, state.ptype, (t) => { state.ptype = t; renderOpts(true); });
    buildStrip(animate);
    const custom = h('input', { type: 'color', value: state.paint.color, 'aria-label': 'Custom colour', oninput: (e) => { state.paint = { ...state.paint, preset: 'custom', color: e.target.value }; strip.querySelectorAll('.item-color.is-on').forEach((b) => { b.classList.remove('is-on'); b.setAttribute('aria-pressed', 'false'); }); applyLook(); renderActive(); sync(); } });
    optsList.append(
      h('label', { class: `opt opt--sw opt--custom${state.paint.preset === 'custom' ? ' is-on' : ''}`, title: 'Your own colour' }, [h('i', { class: 'sw sw--wheel' }), custom, h('span', { class: 'opt__cap', text: 'Your own' })]),
      h('button', { class: `opt opt--tool${pickMode ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(pickMode), 'aria-label': 'Colour a single part', title: 'Colour a single part', onclick: () => {
        pickMode = !pickMode;
        toast(pickMode ? 'Tap a panel on the car' : 'Part selection off');
        renderOpts();
      } }, [icon('pick'), h('span', { class: 'opt__cap', text: pickMode ? 'Tap the car' : 'Single part' })])
    );
  }

  const wheelType = (p) => (p.spec?.set ? 'set' : p.spec?.axle === 'front' ? 'front' : p.spec?.axle === 'rear' ? 'rear' : 'single');
  function wheelOpts() {
    const all = [...parts.wheels].sort((a, b) => String(a.design).localeCompare(String(b.design)) || (a.priceAED || 0) - (b.priceAED || 0));
    const present = ['set', 'front', 'rear', 'single'].filter((t) => all.some((p) => wheelType(p) === t));
    const labels = { set: 'Sets', front: 'Front', rear: 'Rear', single: 'Single' };
    if (state.wtab !== 'all' && !present.includes(state.wtab)) state.wtab = 'all';
    tabsFor([{ id: 'all', label: 'All' }, ...present.map((t) => ({ id: t, label: labels[t] }))], state.wtab, (t) => { state.wtab = t; renderOpts(true); });
    const list = state.wtab === 'all' ? all : all.filter((p) => wheelType(p) === state.wtab);
    list.forEach((p) => optsList.append(productTile(p, {
      label: wheelName(p), sub: [data.variantLabel(p), data.sizeLabel(p)].filter(Boolean).join(' · '),
      on: state.wheels.some((w) => w.id === p.id), onclick: () => toggleWheel(p.id)
    })));
    const sel = chosen()[0];
    if (sel && !sel.finish && caps?.rim) {
      optsList.append(h('span', { class: 'opts__sep', text: 'Finish' }));
      B.WHEEL_COLORS.forEach((c) => optsList.append(plainSwatch(c.color, state.wheelColor === c.color, c.name, () => { state.wheelColor = c.color; applyLook(); renderOpts(); sync(); })));
    }
  }

  const SHORT = { 'full-kit': 'Full kit', widebody: 'Widebody', 'front-lip': 'Front', 'front-bumper': 'Front', bumper: 'Bumper', canards: 'Canards', 'side-skirts': 'Side', fenders: 'Fenders', hood: 'Bonnet', 'hood-scoop': 'Scoop', 'roof-spoiler': 'Roof', 'decklid-spoiler': 'Spoiler', 'rear-wing': 'Wing', 'trunk-lid': 'Boot', 'rear-bumper': 'Rear', 'rear-diffuser': 'Diffuser' };
  function aeroOpts() {
    clear(optsTabs); optsTabs.hidden = true;
    data.groupKits(parts.kits).forEach((g) => {
      optsList.append(h('span', { class: 'opts__sep', text: SHORT[g.subtype] || g.label }));
      g.items.forEach((p) => optsList.append(productTile(p, {
        label: [p.vendor, p.material].filter(Boolean).join(' · ') || g.label, sub: g.label,
        on: state.kits.includes(p.id), onclick: () => toggleKit(p.id)
      })));
    });
  }

  function detailOpts() {
    clear(optsTabs); optsTabs.hidden = true;
    if (caps?.glass) {
      optsList.append(h('span', { class: 'opts__sep', text: 'Glass' }),
        plainSwatch('#d9e2ea', !state.tint, 'Clear glass', () => { state.tint = false; applyLook(); renderOpts(); sync(); }),
        plainSwatch('#0a0d12', state.tint, 'Tinted glass', () => { state.tint = true; applyLook(); renderOpts(); sync(); }));
    }
    if (caps?.caliper) {
      optsList.append(h('span', { class: 'opts__sep', text: 'Calipers' }),
        plainSwatch('#ffffff', !state.caliper, 'Original', () => { state.caliper = null; applyLook(); renderOpts(); sync(); }, true),
        ...B.CALIPERS.map((c) => plainSwatch(c.color, state.caliper === c.id, `${c.name} calipers`, () => { state.caliper = c.id; applyLook(); renderOpts(); sync(); })));
    }
  }

  /* ---- what is active right now (top chip) */
  function renderActive() {
    let dot = 'transparent', text = '';
    if (state.cat === 'paint') {
      const cur = B.byId(B.PAINTS, state.paint.preset);
      dot = state.paint.color; text = cur ? cur.name : 'Your own colour';
    } else if (state.cat === 'wheels') {
      const p = chosen()[0];
      dot = p?.finish?.color || state.wheelColor || '#9a9da5';
      text = p ? `${wheelName(p)}${chosen().length > 1 ? ` +${chosen().length - 1}` : ''}` : 'Original wheels';
    } else if (state.cat === 'aero') {
      dot = '#14141a'; text = state.kits.length ? `${state.kits.length} part${state.kits.length > 1 ? 's' : ''} selected` : 'Standard body';
    } else {
      const cal = B.byId(B.CALIPERS, state.caliper);
      dot = cal ? cal.color : '#9a9da5'; text = `${state.tint ? 'Tinted' : 'Clear'} glass · ${cal ? cal.name : 'original'} calipers`;
    }
    activeDot.style.background = dot;
    if (activeText.textContent !== text) { activeChip.classList.remove('bump'); void activeChip.offsetWidth; activeChip.classList.add('bump'); }
    activeText.textContent = text;
    root.querySelector('.cfg')?.style.setProperty('--tint', state.paint.color);
  }

  /* ------------------------------------------------------------------ camera */
  function renderViews() {
    clear(viewsEl);
    B.VIEWS.forEach((view) => viewsEl.append(h('button', { class: 'vbtn', type: 'button', 'aria-pressed': String(state.view === view.id), text: view.name, 'data-tip': ` view`, 'data-tip-desc': VIEW_TIPS[view.id] || '', onclick: () => goToView(view.id) })));
  }

  const head = h('div', { class: 'cfg__head' }, [titleEl, active]);
  const cfg = h('div', { class: 'cfg is-loading', 'data-cat': 'paint' });

  function goToView(vid, instant = false) {
    state.view = vid;
    const res = viewer.goToView(vid, instant ? 0 : 1);
    const fl = res?.floor;
    /* the camera stays on the car; the stage slides so the car lands above the strip (and glides with the camera) */
    if (res) { cfg.classList.toggle('stage-instant', instant); cfg.style.setProperty('--shift', `${res.shift}px`); }
    cfg.classList.toggle('has-floor', !!fl);
    if (fl) { cfg.style.setProperty('--gy', `${fl.y}px`); cfg.style.setProperty('--gw', `${fl.w}px`); }
    renderViews();
  }

  /** The free screen area between the floating menus; the car stands on its lower edge, just above the colour strip. */
  function updateInsets() {
    viewer.viewport = cfg;
    const W = window.innerWidth, H = window.innerHeight;
    const rect = (el) => el.getBoundingClientRect();
    const wide = W >= 900;
    const l = rect(rail).right, r = W - rect(opts).left;
    const headBottom = rect(head).bottom;
    cfg.style.setProperty('--cols-top', `${Math.round(headBottom + 14)}px`);
    viewer.insets = {
      top: Math.round(headBottom + 4),
      bottom: Math.round(H - rect(strip.hidden ? viewsEl : strip).top + 4),
      left: Math.round(wide ? l + 8 : l * 0.15),
      right: Math.round(wide ? r + 8 : r * 0.15)
    };
  }
  const onResize = () => { updateInsets(); goToView(state.view, true); };

  /* ------------------------------------------------------------------ look */
  const chosen = () => state.wheels.map((w) => product(w.id)).filter(Boolean);

  function rimFinish() {
    const p = chosen()[0];
    if (!p) return null;
    if (p.finish) return { color: p.finish.color, metalness: p.finish.metalness, roughness: p.finish.roughness };
    if (state.wheelColor) {
      const c = B.WHEEL_COLORS.find((x) => x.color === state.wheelColor);
      return { color: state.wheelColor, metalness: c?.metalness ?? 0.7, roughness: c?.roughness ?? 0.3 };
    }
    return null;
  }

  function applyLook() {
    const cal = B.byId(B.CALIPERS, state.caliper);
    viewer.setLook({ paint: state.paint, rim: rimFinish(), caliper: cal ? cal.color : null, tint: state.tint });
    cfg.style.setProperty('--tint', state.paint.color);
  }

  async function loadModel(index) {
    const my = ++seq;
    const model = v.models[index];
    state.modelUid = model.uid;
    cfg.classList.remove('is-error');
    cfg.classList.add('is-loading');
    try {
      caps = await viewer.load(model);
    } catch (err) {
      if (!alive || my !== seq) return;
      if (index + 1 < v.models.length) { loadModel(index + 1); return; }
      cfg.classList.remove('is-loading');
      cfg.classList.add('is-error');
      loading.replaceChildren(h('span', { class: 'hero__loadtext', text: 'This 3D model can’t be shown right now.' }));
      return;
    }
    if (!alive || my !== seq) return;
    updateInsets();
    applyLook();
    goToView(state.view, true);
    /* a model whose wheels were not found gets measured, so it is framed like the rest */
    if (await viewer.calibrate().catch(() => false)) { if (!alive || my !== seq) return; goToView(state.view, true); }
    /* the viewer reports ready a moment before the car is drawn; keep the veil up for that gap */
    await new Promise((r) => setTimeout(r, 1500));
    if (!alive || my !== seq) return;
    cfg.classList.remove('is-loading');
    pickMode = !caps.paint;
    renderRail();
    renderOpts();
    renderModels();
    renderCredit();
    /* the viewer keeps easing into its own default camera for a few seconds; re-apply ours a few times while it settles */
    [1400, 4200, 8500].forEach((ms) => setTimeout(() => {
      if (alive && my === seq) viewer.refreshBase().then(() => alive && my === seq && goToView(state.view, true)).then(() => (state.view === 'side' ? viewer.probePaint() : false)).then((changed) => { if (changed && alive && my === seq) { applyLook(); caps = viewer.capabilities(); renderOpts(); } });
    }, ms));
  }

  /* ------------------------------------------------------------------ choices that change the build */
  function toggleWheel(pid) {
    const p = product(pid);
    if (!p) return;
    if (state.wheels.some((w) => w.id === pid)) state.wheels = state.wheels.filter((w) => w.id !== pid);
    else {
      const keep = state.wheels.filter((w) => {
        const q = product(w.id);
        if (p.spec?.set || q?.spec?.set || !p.spec?.axle || !q?.spec?.axle) return false;
        return q.spec.axle !== p.spec.axle;
      });
      state.wheels = [...keep, { id: pid, qty: B.defaultQty(p) }];
    }
    applyLook(); renderOpts(); sync();
  }

  function toggleKit(pid) {
    const p = product(pid);
    if (!p) return;
    if (state.kits.includes(pid)) state.kits = state.kits.filter((k) => k !== pid);
    else {
      state.kits = [...state.kits, pid];
      if (p.subtype === 'full-kit') state.kits = state.kits.filter((k) => k === pid || !FULL_KIT_COVERS.includes(product(k)?.subtype));
      else if (FULL_KIT_COVERS.includes(p.subtype)) state.kits = state.kits.filter((k) => product(k)?.subtype !== 'full-kit');
    }
    renderOpts(); sync();
  }

  /* ------------------------------------------------------------------ bottom: ask, price, models, swipe */
  const amount = h('strong', { class: 'price__amount' });
  const count = h('small', { class: 'price__count' });
  const priceEl = h('div', { class: 'price' }, [h('span', { class: 'price__label', text: 'Price' }), h('div', { class: 'price__row' }, [h('span', { class: 'price__cur', text: 'AED' }), amount]), count]);
  const askBtn = h('div', { class: 'cfg-ask' }, [
    h('span', { class: 'cfg-ask__label', text: 'Question' }),
    h('button', { class: 'fbtn fbtn--lg', type: 'button', 'aria-label': 'Ask a question or book a viewing', onclick: () => openService({ car: name, service: 'Configuration consultation' }) }, icon('help'))
  ]);
  const modelsEl = h('div', { class: 'viewed' });
  const swipe = createSwipe({ label: 'Enquire', hint: 'Swipe right', mark: mark ? mark.cloneNode(true) : null, onDone: () => openSheet() });
  const credit = h('p', { class: 'cfg__credit' });
  const foot = h('footer', { class: 'cfg__foot' }, [h('div', { class: 'cfg__row' }, [askBtn, priceEl, modelsEl]), swipe.el, credit]);

  function renderModels() {
    clear(modelsEl);
    if (v.models.length > 1) {
      modelsEl.append(h('span', { class: 'viewed__label', text: '3D models' }), ...v.models.slice(0, 2).map((m, i) => h('button', {
        class: 'thumb', type: 'button', 'aria-pressed': String(m.uid === state.modelUid), 'aria-label': `3D model ${i + 1}`,
        onclick: () => { if (m.uid !== state.modelUid) { loadModel(i); renderModels(); } }
      }, m.thumb ? h('img', { src: m.thumb, alt: '', loading: 'lazy' }) : `${i + 1}`)));
    } else if (stock?.cover) {
      modelsEl.append(h('span', { class: 'viewed__label', text: 'Photos' }), h('a', { class: 'thumb', href: back ? back.href : '#/shop', 'aria-label': 'Back to the car photos' }, h('img', { src: coverUrl(stock), alt: '', onerror: coverError(stock) })));
    }
  }

  function syncBar() {
    const b = B.bom(state, product);
    if (getSettings().hidePrices) amount.textContent = '—';
    else countTo(amount, b.total, (n) => n.toLocaleString('en-US'), 450);
    const n = b.lines.length;
    count.textContent = n ? `${n} item${n > 1 ? 's' : ''}${b.unpriced ? ' · + price on request' : ''}` : 'Colour only';
  }

  const shareUrl = () => `${location.origin}${location.pathname}${route}/${B.toShare(state)}`;
  let urlTimer = 0;
  function sync() {
    syncBar();
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => { try { history.replaceState(null, '', `${route}/${B.toShare(state)}`); } catch { /* ignore */ } }, 400);
  }

  async function copy(text, ok) {
    try { await navigator.clipboard.writeText(text); toast(ok); } catch {
      const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text; document.body.append(ta); ta.select();
      try { document.execCommand('copy'); toast(ok); } catch { toast('Copy is not available in this browser'); }
      ta.remove();
    }
  }

  function requestText() {
    const cur = B.byId(B.PAINTS, state.paint.preset);
    const head = [`${name}${stock ? '' : ` (${v.generation}, ${data.yearsLabel(v)})`}`, `Colour: ${cur ? cur.name : state.paint.color}`];
    const cal = B.byId(B.CALIPERS, state.caliper);
    if (cal) head.push(`Calipers: ${cal.name}`);
    if (state.tint) head.push('Glass: tinted');
    const body = B.summaryText(name, state, product, data.aed).split('\n').slice(2).join('\n');
    return `${head.join('\n')}\n\n${body}\n\n${shareUrl()}`;
  }

  /* ---- enquiry sheet */
  let sheet = null;
  function closeSheet() { sheet?.remove(); sheet = null; document.body.classList.remove('is-locked'); }

  function openSheet() {
    closeSheet();
    const b = B.bom(state, product);
    const cur = B.byId(B.PAINTS, state.paint.preset);
    const cov = B.wheelCoverage(state, product);
    const line = (l) => h('li', { class: 'line' }, [
      h('span', { class: 'line__img' }, l.product.images?.[0] ? h('img', { src: l.product.images[0], alt: '' }) : null),
      h('span', { class: 'line__main' }, [
        h('strong', { text: l.kind === 'wheel' ? wheelName(l.product) : (data.KIT_LABEL[l.product.subtype] || 'Body kit') }),
        h('small', { text: `${l.product.vendor}${l.kind === 'wheel' ? ` · ${data.sizeLabel(l.product)}` : ''}` }),
        l.kind === 'wheel' ? h('span', { class: 'step' }, [
          h('button', { type: 'button', 'aria-label': 'Fewer', onclick: () => qty(l.product.id, -1), text: '−' }),
          h('span', { text: B.quantityLabel(l.product, l.qty) }),
          h('button', { type: 'button', 'aria-label': 'More', onclick: () => qty(l.product.id, 1), text: '+' })
        ]) : null
      ]),
      h('span', { class: 'line__price', text: data.aed(l.total) }),
      h('button', { class: 'line__x', type: 'button', 'aria-label': 'Remove', onclick: () => { l.kind === 'wheel' ? toggleWheel(l.product.id) : toggleKit(l.product.id); openSheet(); } }, icon('close'))
    ]);
    const qty = (pid, d) => { state.wheels = state.wheels.map((w) => (w.id === pid ? { ...w, qty: Math.max(1, Math.min(8, w.qty + d)) } : w)); sync(); openSheet(); };

    sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Your selection' }, [
      h('div', { class: 'sheet__scrim', onclick: closeSheet }),
      h('div', { class: 'sheet__panel' }, [
        h('div', { class: 'sheet__head' }, [h('h2', { text: name }), h('button', { class: 'round round--sm', type: 'button', 'aria-label': 'Close', onclick: closeSheet }, icon('close'))]),
        h('div', { class: 'sheet__spec' }, [
          h('span', { class: 'dot', style: `background:${state.paint.color}` }),
          h('span', { text: cur ? cur.name : 'Custom colour' })
        ]),
        b.lines.length ? h('ul', { class: 'lines' }, b.lines.map(line)) : h('p', { class: 'sheet__empty', text: 'Add wheels or a body kit to build a quote.' }),
        !cov.complete ? h('p', { class: 'sheet__warn', text: cov.message }) : null,
        h('div', { class: 'sheet__total' }, [h('span', { text: 'Total' }), h('strong', { text: data.aed(b.total) })]),
        h('button', { class: 'cta cta--block sheet__send', type: 'button', onclick: sendBuild }, [icon('send'), 'Send to the dealership']),
        h('div', { class: 'sheet__actions' }, [
          h('button', { class: 'ghost', type: 'button', onclick: () => copy(requestText(), 'Request copied') }, [icon('copy'), 'Copy']),
          h('button', { class: 'ghost', type: 'button', onclick: () => copy(shareUrl(), 'Link copied') }, [icon('share'), 'Share link']),
          h('button', { class: 'ghost', type: 'button', onclick: printSheet }, [icon('print'), 'Print'])
        ])
      ])
    ]);
    document.body.classList.add('is-locked');
    root.append(sheet);
    sheet.querySelector('.sheet__panel').focus?.();
  }

  /* the whole build goes to the CRM as a lead: paint, wheels, kits, total and the link that reopens it */
  function sendBuild() {
    const b = B.bom(state, product);
    const cur = B.byId(B.PAINTS, state.paint.preset);
    const cal = B.byId(B.CALIPERS, state.caliper);
    const paint = [cur ? cur.name : `Custom ${state.paint.color}`, cal ? `${cal.name} calipers` : null, state.tint ? 'tinted glass' : null].filter(Boolean).join(' · ');
    const wheels = b.lines.filter((l) => l.kind === 'wheel').map((l) => ({ id: l.product.id, title: `${l.product.vendor} ${wheelName(l.product)} ${data.sizeLabel(l.product)}`.trim().slice(0, 300), qty: l.qty, price: l.total || null }));
    const kits = b.lines.filter((l) => l.kind !== 'wheel').map((l) => ({ id: l.product.id, title: `${l.product.vendor} ${data.KIT_LABEL[l.product.subtype] || 'Body kit'} ${l.product.sku || ''}`.trim().slice(0, 300), price: l.total || null }));
    closeSheet();
    openEnquiry({
      title: 'Send your build',
      sub: 'The sales team receives this exact configuration and calls you back.',
      type: 'configuration',
      source: 'configurator',
      car: { id: stock ? stock.id : v.id, title: name },
      configuration: { paint, wheels, kits, total: b.total || null, url: shareUrl() },
      summary: [
        h('span', { class: 'dot', style: `background:${state.paint.color}` }),
        h('span', { class: 'enq__t' }, [h('b', { text: name }), h('small', { text: [paint, b.lines.length ? `${b.lines.length} item${b.lines.length > 1 ? 's' : ''}` : 'Colour only'].join(' · ') })]),
        h('strong', { class: 'enq__total', text: b.total ? data.aed(b.total) : '' })
      ]
    });
  }

  function printSheet() {
    const b = B.bom(state, product);
    const cur = B.byId(B.PAINTS, state.paint.preset);
    const doc = h('div', { class: 'print-sheet' }, [
      h('h1', { text: name }),
      h('p', { text: `${v.generation} · ${data.yearsLabel(v)} · ${cur ? cur.name : 'Custom colour'} · ${new Date().toLocaleDateString('en-GB')}` }),
      h('table', {}, b.lines.map((l) => h('tr', {}, [
        h('td', {}, [h('b', { text: l.kind === 'wheel' ? wheelName(l.product) : (data.KIT_LABEL[l.product.subtype] || 'Body kit') }), h('div', { text: `${l.product.vendor} · ${l.product.sku || ''}` })]),
        h('td', { text: B.quantityLabel(l.product, l.qty) }),
        h('td', { text: data.aed(l.total), class: 'r' })
      ]))),
      h('p', { class: 'r', text: `Total ${data.aed(b.total)}` })
    ]);
    document.body.append(doc);
    window.print();
    setTimeout(() => doc.remove(), 500);
  }

  async function screenshot() {
    try {
      const blob = await viewer.screenshot();
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: `${id}-${Date.now()}.png` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      toast('Image saved');
    } catch { toast('Could not capture an image'); }
  }

  function renderCredit() {
    const m = v.models.find((x) => x.uid === state.modelUid) || v.models[0];
    clear(credit);
    credit.append(`3D model “${m.name}” by ${m.author} · ${m.license} · `, h('a', { href: m.url, target: '_blank', rel: 'noopener noreferrer', text: 'Sketchfab' }));
  }

  /* ------------------------------------------------------------------ assemble */
  cfg.append(
    h('div', { class: 'cfg__bg' }, [h('div', { class: 'cfg__glow' }), markText]),
    floor, stage, loading,
    h('div', { class: 'cfg__fade', 'aria-hidden': 'true' }), top, head, strip, viewsEl, rail, opts, foot
  );
  root.append(cfg);

  /* the make's name, as large as it can go without leaving the screen */
  const fitMark = () => { markText.style.fontSize = `${Math.min(window.innerWidth * 0.34, (window.innerWidth * 1.55) / Math.max(4, v.make.length))}px`; };
  fitMark();

  renderViews();
  renderRail();
  renderOpts();
  renderModels();
  renderActive();
  syncBar();
  cfg.style.setProperty('--tint', state.paint.color);
  requestAnimationFrame(updateInsets);
  loadModel(Math.max(0, v.models.findIndex((m) => m.uid === state.modelUid)));

  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  window.addEventListener('keydown', onKey);
  let rz = 0;
  const onResizeSoon = () => { clearTimeout(rz); rz = setTimeout(() => { fitMark(); onResize(); }, 120); };
  window.addEventListener('resize', onResizeSoon);

  return {
    kind: 'car',
    destroy() {
      alive = false;
      clearTimeout(urlTimer);
      clearTimeout(rz);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResizeSoon);
      swipe.destroy();
      closeSheet();
      viewer.unload();
    }
  };
}
