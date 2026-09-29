import * as data from '../data/catalog.js';
import * as B from '../state/build.js';
import { Viewer } from '../viewer/sketchfab.js';
import { h, icon, clear, countTo } from '../ui/dom.js';
import { brandMark } from '../ui/brand.js';
import { wheelGlyph } from '../ui/glyph.js';
import { getSettings } from '../state/settings.js';

/* A complete kit already contains these parts - selecting both would double count. */
const FULL_KIT_COVERS = ['front-lip', 'front-bumper', 'rear-bumper', 'rear-diffuser', 'decklid-spoiler', 'side-skirts'];
const PREVIEW_COUNT = 6;

export function mountCar(root, id, share, { toast, stock = null, base = null, back = null }) {
  const v = data.vehicle(id);
  if (!v || !v.has3d) return null;

  const route = base || `#/car/${encodeURIComponent(id)}`;
  const name = stock ? stock.title : `${v.make} ${v.model}`;
  let state = { ...B.defaultState(), vehicleId: id, modelUid: v.models[0].uid };
  if (stock) { const p = B.paintForColour(stock.exterior); if (p) state.paint = { preset: p.id, color: p.color, roughness: p.roughness, metalness: p.metalness }; }
  const shared = share ? B.fromShare(share) : null;
  if (shared && shared.vehicleId === id) state = { ...state, ...shared, view: 'side' };
  if (!v.models.some((m) => m.uid === state.modelUid)) state.modelUid = v.models[0].uid;

  const parts = data.partsFor(v);
  const product = (pid) => data.product(pid);
  const open = { colors: true, wheels: true, kits: true, details: false };
  const expanded = { wheels: false, kits: {} };
  let pickMode = false;
  let caps = null;
  let alive = true;
  let seq = 0;

  /* ------------------------------------------------------------------ hero */
  const stage = h('div', { class: 'hero__stage' });
  const loading = h('div', { class: 'hero__loading' }, [h('span', { class: 'spin' }), h('span', { class: 'hero__loadtext', text: 'Loading 3D model' })]);
  const viewsEl = h('div', { class: 'views', role: 'group', 'aria-label': 'Camera view' });
  const counter = h('span', { class: 'hero__count', 'aria-hidden': 'true' });
  const hero = h('section', { class: 'hero', 'aria-label': '3D view' }, [
    h('div', { class: 'hero__floor' }), stage, loading,
    h('div', { class: 'hero__ui' }, viewsEl), counter
  ]);
  const viewer = new Viewer(stage);
  window.__viewer = viewer; /* handy for debugging in the console */
  viewer.onPick = (m) => {
    if (!pickMode) return;
    viewer.togglePaintMaterial(m.id);
    const on = viewer.capabilities().paintTargets.includes(m.id);
    toast(on ? 'This part will follow your colour' : 'This part keeps its original colour');
    viewer.highlight(m.id);
  };

  function renderViews() {
    clear(viewsEl);
    B.VIEWS.forEach((view, i) => viewsEl.append(h('button', {
      class: 'view', type: 'button', 'aria-pressed': String(state.view === view.id), text: view.name,
      onclick: () => goToView(view.id)
    })));
    const i = Math.max(0, B.VIEWS.findIndex((x) => x.id === state.view));
    counter.textContent = `${i + 1} / ${B.VIEWS.length}`;
  }

  function goToView(vid, instant = false) {
    state.view = vid;
    const floor = viewer.goToView(vid, instant ? 0 : 1);
    hero.classList.toggle('has-floor', !!floor);
    if (floor) { hero.style.setProperty('--gy', `${floor.y}px`); hero.style.setProperty('--gw', `${floor.w}px`); }
    renderViews();
  }

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
  }

  async function loadModel(index) {
    const my = ++seq;
    const model = v.models[index];
    state.modelUid = model.uid;
    hero.classList.remove('is-error');
    hero.classList.add('is-loading');
    try {
      caps = await viewer.load(model);
    } catch (err) {
      if (!alive || my !== seq) return;
      if (index + 1 < v.models.length) { loadModel(index + 1); return; }
      hero.classList.remove('is-loading');
      hero.classList.add('is-error');
      loading.replaceChildren(h('span', { class: 'hero__loadtext', text: 'This 3D model can’t be shown right now.' }));
      return;
    }
    if (!alive || my !== seq) return;
    applyLook();
    goToView(state.view, true);
    /* the viewer reports ready a moment before the car is drawn; keep the veil up for that gap */
    await new Promise((r) => setTimeout(r, 1500));
    if (!alive || my !== seq) return;
    hero.classList.remove('is-loading');
    pickMode = !caps.paint;
    renderColors();
    renderWheels();
    renderDetails();
    /* the viewer keeps easing into its own default camera for a few seconds; re-apply ours a few times while it settles */
    [1400, 4200, 8500].forEach((ms) => setTimeout(() => {
      if (alive && my === seq) viewer.refreshBase().then(() => alive && my === seq && goToView(state.view, true)).then(() => (state.view === 'side' ? viewer.probePaint() : false)).then((changed) => { if (changed && alive && my === seq) { applyLook(); caps = viewer.capabilities(); renderColors(); } });
    }, ms));
    renderCredit();
  }

  /* ------------------------------------------------------------------ sections */
  function section(key, title) {
    const sub = h('span', { class: 'sect__sub' });
    const body = h('div', { class: 'sect__inner' });
    const el = h('section', { class: 'sect', dataset: { open: String(open[key]) } }, [
      h('button', { class: 'sect__head', type: 'button', 'aria-expanded': String(open[key]), onclick: (e) => {
        open[key] = !open[key];
        el.dataset.open = String(open[key]);
        e.currentTarget.setAttribute('aria-expanded', String(open[key]));
      } }, [h('span', { class: 'sect__title', text: title }), sub, icon('chevron')]),
      h('div', { class: 'sect__body' }, body)
    ]);
    return { el, body, sub };
  }

  const colors = section('colors', 'Exterior colours');
  const wheels = section('wheels', 'Wheels');
  const kits = section('kits', 'Body kit');
  const details = section('details', 'Details');

  /* ---- colours */
  function swatch(p) {
    const on = state.paint.preset === p.id;
    return h('button', {
      class: `swatch${p.group === 'matte' ? ' is-matte' : ''}`, type: 'button', style: `--c:${p.color};--m:${p.metalness};`,
      'aria-pressed': String(on), 'aria-label': p.name, title: p.name,
      onclick: () => { state.paint = { preset: p.id, color: p.color, roughness: p.roughness, metalness: p.metalness }; applyLook(); renderColors(); sync(); }
    }, on ? icon('check') : null);
  }

  function renderColors() {
    const cur = B.byId(B.PAINTS, state.paint.preset);
    colors.sub.textContent = cur ? cur.name : 'Custom';
    clear(colors.body);
    B.PAINT_GROUPS.forEach((g) => {
      colors.body.append(
        h('h3', { class: 'group-label', text: g.name }),
        h('div', { class: 'swatches' }, B.PAINTS.filter((p) => p.group === g.id).map(swatch))
      );
    });
    const custom = h('input', { type: 'color', value: state.paint.color, 'aria-label': 'Custom colour', oninput: (e) => {
      state.paint = { ...state.paint, preset: 'custom', color: e.target.value };
      applyLook(); colors.sub.textContent = 'Custom'; sync();
    } });
    colors.body.append(
      h('h3', { class: 'group-label', text: 'Your own' }),
      h('div', { class: 'swatches' }, [h('label', { class: `swatch swatch--custom${state.paint.preset === 'custom' ? ' is-on' : ''}`, title: 'Custom colour' }, [custom])]),
      h('button', { class: `pill${pickMode ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(pickMode), onclick: () => {
        pickMode = !pickMode;
        toast(pickMode ? 'Tap a panel on the car' : 'Part selection off');
        renderColors();
      } }, [icon('pick'), h('span', { text: pickMode ? 'Tap a panel on the car' : 'Colour a single part' })])
    );
  }

  /* ---- product tiles */
  const initials = (t) => h('span', { class: 'tile__ph', text: t });
  const placeholder = (p) => (p.category === 'wheel' ? wheelGlyph(p.finish?.color || '#a9adb5') : initials(p.vendor));

  function tile(p, { title, sub, sub2, on, fits, onclick }) {
    return h('button', { class: 'tile', type: 'button', 'aria-pressed': String(on), onclick }, [
      h('span', { class: 'tile__img' }, [
        p.images && p.images[0] ? h('img', { src: p.images[0], alt: '', loading: 'lazy', decoding: 'async' }) : placeholder(p),
        on ? h('span', { class: 'tile__check' }, icon('check')) : null,
        fits ? h('span', { class: 'tile__fit' }, [icon('check'), 'Fits']) : null
      ]),
      h('span', { class: 'tile__name', text: title }),
      h('span', { class: 'tile__sub', text: sub }),
      sub2 ? h('span', { class: 'tile__sub', text: sub2 }) : null,
      h('span', { class: 'tile__price', text: data.aed(p.priceAED) })
    ]);
  }

  const wheelName = (p) => {
    const d = p.design || p.title.split(/ for /i)[0].slice(0, 32);
    return d.toUpperCase().startsWith(String(p.vendor).toUpperCase()) ? d : `${p.vendor} ${d}`;
  };

  const fitsCar = (p) => {
    const checks = data.wheelChecks(v, p);
    return checks.some((c) => c.ok === true) && !checks.some((c) => c.ok === false);
  };

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
    applyLook(); renderWheels(); sync();
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
    renderKits(); sync();
  }

  function renderWheels() {
    const list = [...parts.wheels].sort((a, b) => String(a.design).localeCompare(String(b.design)) || (a.priceAED || 0) - (b.priceAED || 0));
    wheels.el.hidden = !list.length;
    if (!list.length) return;
    wheels.sub.textContent = state.wheels.length ? `${state.wheels.length} selected` : `${list.length} available`;
    clear(wheels.body);
    const shown = expanded.wheels ? list : list.slice(0, PREVIEW_COUNT);
    wheels.body.append(h('div', { class: 'tiles' }, shown.map((p) => tile(p, {
      title: wheelName(p), sub: data.variantLabel(p) || p.vendor, sub2: data.sizeLabel(p),
      on: state.wheels.some((w) => w.id === p.id), fits: fitsCar(p), onclick: () => toggleWheel(p.id)
    }))));
    if (list.length > PREVIEW_COUNT && !expanded.wheels) {
      wheels.body.append(h('button', { class: 'more', type: 'button', text: `Show all ${list.length}`, onclick: () => { expanded.wheels = true; renderWheels(); } }));
    }
    const sel = chosen()[0];
    if (sel && !sel.finish && caps?.rim) {
      wheels.body.append(
        h('h3', { class: 'group-label', text: 'Wheel finish' }),
        h('div', { class: 'swatches' }, B.WHEEL_COLORS.map((c) => h('button', {
          class: 'swatch', type: 'button', style: `--c:${c.color};--m:${c.metalness}`, title: c.name, 'aria-label': c.name, 'aria-pressed': String(state.wheelColor === c.color),
          onclick: () => { state.wheelColor = c.color; applyLook(); renderWheels(); sync(); }
        }, state.wheelColor === c.color ? icon('check') : null)))
      );
    }
  }

  function renderKits() {
    const groups = data.groupKits(parts.kits);
    kits.el.hidden = !groups.length;
    if (!groups.length) return;
    kits.sub.textContent = state.kits.length ? `${state.kits.length} selected` : `${parts.kits.length} available`;
    clear(kits.body);
    groups.forEach((g) => {
      const all = expanded.kits[g.subtype];
      const shown = all ? g.items : g.items.slice(0, 4);
      kits.body.append(
        h('h3', { class: 'group-label', text: g.label }),
        h('div', { class: 'tiles' }, shown.map((p) => tile(p, {
          title: [p.vendor, p.material].filter(Boolean).join(' · ') || g.label, sub: g.label,
          on: state.kits.includes(p.id), fits: false, onclick: () => toggleKit(p.id)
        })))
      );
      if (g.items.length > 4 && !all) kits.body.append(h('button', { class: 'more', type: 'button', text: `Show all ${g.items.length}`, onclick: () => { expanded.kits[g.subtype] = true; renderKits(); } }));
    });
  }

  /* ---- details: glass, calipers, alternative models */
  function renderDetails() {
    details.sub.textContent = '';
    clear(details.body);
    const glass = caps?.glass;
    const cal = caps?.caliper;
    if (glass) {
      details.body.append(h('h3', { class: 'group-label', text: 'Glass' }), h('div', { class: 'seg' }, [
        h('button', { type: 'button', 'aria-pressed': String(!state.tint), text: 'Clear', onclick: () => { state.tint = false; applyLook(); renderDetails(); sync(); } }),
        h('button', { type: 'button', 'aria-pressed': String(state.tint), text: 'Tinted', onclick: () => { state.tint = true; applyLook(); renderDetails(); sync(); } })
      ]));
    }
    if (cal) {
      details.body.append(h('h3', { class: 'group-label', text: 'Brake calipers' }), h('div', { class: 'swatches' }, [
        h('button', { class: 'swatch swatch--none', type: 'button', title: 'Original', 'aria-label': 'Original calipers', 'aria-pressed': String(!state.caliper), onclick: () => { state.caliper = null; applyLook(); renderDetails(); sync(); } }, h('span', { text: '—' })),
        ...B.CALIPERS.map((c) => h('button', {
          class: 'swatch', type: 'button', style: `--c:${c.color}`, title: c.name, 'aria-label': `${c.name} calipers`, 'aria-pressed': String(state.caliper === c.id),
          onclick: () => { state.caliper = c.id; applyLook(); renderDetails(); sync(); }
        }, state.caliper === c.id ? icon('check') : null))
      ]));
    }
    if (v.models.length > 1) {
      details.body.append(h('h3', { class: 'group-label', text: '3D model' }), h('div', { class: 'models3d' }, v.models.map((m, i) => h('button', {
        class: 'm3d', type: 'button', 'aria-pressed': String(m.uid === state.modelUid), 'aria-label': `3D model ${i + 1}`,
        onclick: () => { if (m.uid !== state.modelUid) { loadModel(i); renderDetails(); } }
      }, m.thumb ? h('img', { src: m.thumb, alt: '', loading: 'lazy' }) : `${i + 1}`))));
    }
    details.el.hidden = !details.body.childElementCount;
  }

  /* ------------------------------------------------------------------ bottom bar + summary */
  const total = h('span', { class: 'buy__amount' });
  const count = h('span', { class: 'buy__count' });
  const buy = h('footer', { class: 'buy' }, [
    h('div', { class: 'buy__sum' }, [h('span', { class: 'buy__label', text: 'Your selection' }), h('span', {}, [h('small', { text: 'AED ' }), total]), count]),
    h('button', { class: 'round', type: 'button', 'aria-label': 'Share this build', onclick: () => copy(shareUrl(), 'Link copied') }, icon('share')),
    h('button', { class: 'cta', type: 'button', text: 'Enquire', onclick: () => openSheet() })
  ]);

  function syncBar() {
    const b = B.bom(state, product);
    if (getSettings().hidePrices) total.textContent = '—';
    else countTo(total, b.total, (n) => n.toLocaleString('en-US'), 400);
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
    const head = [`${v.make} ${v.model} (${v.generation}, ${data.yearsLabel(v)})`, `Colour: ${cur ? cur.name : state.paint.color}`];
    const cal = B.byId(B.CALIPERS, state.caliper);
    if (cal) head.push(`Calipers: ${cal.name}`);
    if (state.tint) head.push('Glass: tinted');
    const body = B.summaryText(`${v.make} ${v.model}`, state, product, data.aed).split('\n').slice(2).join('\n');
    return `${head.join('\n')}\n\n${body}\n\n${shareUrl()}`;
  }

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
        h('div', { class: 'sheet__actions' }, [
          h('button', { class: 'cta', type: 'button', onclick: () => copy(requestText(), 'Request copied') }, [icon('copy'), 'Copy request']),
          h('button', { class: 'ghost', type: 'button', onclick: () => copy(shareUrl(), 'Link copied') }, [icon('share'), 'Share link']),
          h('button', { class: 'ghost', type: 'button', onclick: printSheet }, [icon('print'), 'Print'])
        ])
      ])
    ]);
    document.body.classList.add('is-locked');
    root.append(sheet);
    sheet.querySelector('.sheet__panel').focus?.();
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

  /* ------------------------------------------------------------------ credit */
  const credit = h('p', { class: 'credit' });
  function renderCredit() {
    const m = v.models.find((x) => x.uid === state.modelUid) || v.models[0];
    clear(credit);
    credit.append(`3D model “${m.name}” by ${m.author} · ${m.license} · `, h('a', { href: m.url, target: '_blank', rel: 'noopener noreferrer', text: 'Sketchfab' }));
    const src = [...new Set([...parts.wheels, ...parts.kits].map((p) => p.vendor && p.source))].filter(Boolean);
    if (src.length) {
      const names = src.map((s) => (data.meta().sources.find((x) => x.id === s) || {}).name).filter(Boolean);
      credit.append(h('br'), `Wheels and body kits: ${names.join(', ')} (Dubai). Prices in AED as listed.`);
    }
  }

  /* ------------------------------------------------------------------ page */
  const mark = brandMark(v.make);
  root.append(
    h('header', { class: 'bar' }, [
      h('a', { class: 'back', href: back ? back.href : '#/shop' }, [icon('back'), h('span', { text: back ? back.label : 'Back' })]),
      h('div', { class: 'bar__tools' }, [
        h('button', { class: 'round round--sm', type: 'button', 'aria-label': 'Save image', onclick: screenshot }, icon('camera')),
        h('button', { class: 'round round--sm', type: 'button', 'aria-label': 'Copy share link', onclick: () => copy(shareUrl(), 'Link copied') }, icon('share'))
      ])
    ]),
    h('main', { class: 'car' }, [
      h('div', { class: 'car__hero' }, [
        h('div', { class: 'car__title' }, [
          h('div', { class: 'car__make' }, [mark, h('span', { text: v.make })]),
          h('h1', { class: 'car__name' }, stock ? [stock.title] : [v.model, h('span', { class: 'gen', text: v.generation })]),
          h('p', { class: 'car__meta', text: stock ? [stock.year, stock.exterior].filter(Boolean).join(' · ') : data.yearsLabel(v) })
        ]),
        hero
      ]),
      h('div', { class: 'car__panel' }, [colors.el, wheels.el, kits.el, details.el, credit])
    ]),
    buy
  );

  renderViews();
  renderColors();
  renderWheels();
  renderKits();
  renderDetails();
  syncBar();
  const modelIndex = Math.max(0, v.models.findIndex((m) => m.uid === state.modelUid));
  loadModel(modelIndex);

  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  window.addEventListener('keydown', onKey);

  return {
    kind: 'car',
    destroy() {
      alive = false;
      clearTimeout(urlTimer);
      window.removeEventListener('keydown', onKey);
      closeSheet();
      viewer.unload();
    }
  };
}
