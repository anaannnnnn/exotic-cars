import * as stock from '../data/stock.js';
import { h, icon, clear, debounce } from '../ui/dom.js';
import { closePanel, launchVRModel } from '../ui/panels.js';
import { notch, biteFor } from '../ui/notch.js';
import { pageHead, segmented } from '../ui/kit.js';
import { mainDock } from './hub.js';

/* VR showroom: how it works, then every stock car with a verified 3D model, ready to open in VR / AR / 360. */
const LABEL = { 'Rolls Royce': 'Rolls-Royce', 'Mercedes Benz': 'Mercedes-Benz' };

export function mountVR(root) {
  /* one card per distinct model, newest first */
  const seen = new Set();
  const cars = stock.queryStock({ tab: 'sale' }).filter((c) => { const m = stock.stockModels3d(c)[0]; if (!m || seen.has(m.uid)) return false; seen.add(m.uid); return true; })
    .sort((a, b) => (b.year || 0) - (a.year || 0));
  const makes = [...new Set(cars.map((c) => c.brand))].slice(0, 6);
  let make = '', q = '';

  const grid = h('div', { class: 'vr-grid' });
  const empty = h('p', { class: 'empty', text: 'No 3D car matches that search.', hidden: true });
  function card(c, i) {
    const m = stock.stockModels3d(c)[0];
    const name = c.title;
    const media = h('span', { class: 'vrc__img' }, h('img', { src: stock.coverUrl(c), alt: '', loading: 'lazy', onerror: stock.coverError(c) }));
    /* tapping the card reveals "See more details" and "Open in VR" (ui/motion.js) - no icon button on the card */
    const btn = h('a', { class: 'vrc', href: `#/shop/${c.id}`, 'data-vr': '1', 'data-tip': name, 'data-tip-desc': 'Headset, phone AR or 360° on screen' }, [
      media,
      h('span', { class: 'vrc__body' }, [h('b', { text: name }), h('small', { text: [c.year, LABEL[c.brand] || c.brand].filter(Boolean).join(' · ') })])
    ]);
    btn.addEventListener('vropen', () => launchVRModel(m, name));
    const wrap = h('div', { class: 'scw', style: `--i:${i % 18}` });
    wrap.append(btn);
    return wrap;
  }
  function render() {
    clear(grid);
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = cars.filter((c) => (!make || c.brand === make) && words.every((w) => c.title.toLowerCase().includes(w)));
    list.slice(0, 36).forEach((c, i) => grid.append(card(c, i)));
    empty.hidden = list.length > 0;
  }
  const seg = segmented([{ id: '', label: 'All' }, ...makes.map((m) => ({ id: m, label: LABEL[m] || m }))], '', (v) => { make = v; render(); }, { label: 'Make' });
  const search = h('input', { class: 'ask__input', type: 'search', placeholder: 'Search a model…', 'aria-label': 'Search 3D cars', oninput: debounce((e) => { q = e.target.value; render(); }, 120) });

  const ways = [
    ['headset', 'VR headset', 'Open the car, press the VR button and step inside it.'],
    ['phonedev', 'Phone AR', 'Place the car at full size in your driveway or garage.'],
    ['desktop', '360° on screen', 'Drag to walk around it, pinch or scroll to look closer.']
  ];
  const dock = mainDock('vr');
  root.append(h('main', { class: 'pg' }, [
    h('div', { class: 'hub__glow', 'aria-hidden': 'true' }),
    pageHead({ title: 'VR showroom', sub: `${cars.length} cars in 3D` }),
    h('section', { class: 'vr-hero' }, [
      h('div', { class: 'vr-hero__in' }, [
        h('p', { class: 'eyebrow eyebrow--light', text: 'Virtual showroom' }),
        h('h2', { class: 'pg__title', text: 'Step inside before you visit.' }),
        h('div', { class: 'ways' }, ways.map(([ic, t, d], i) => h('div', { class: 'way', style: `--i:${i}` }, [h('span', { class: 'way__ic' }, icon(ic)), h('b', { text: t }), h('span', { text: d })])))
      ])
    ]),
    h('div', { class: 'sect-head' }, [h('h2', { text: 'Choose a car' })]),
    h('div', { class: 'pg__tools' }, [h('form', { class: 'ask ask--sm', role: 'search', onsubmit: (e) => e.preventDefault() }, [h('span', { class: 'ask__spark', 'aria-hidden': 'true' }, icon('search')), search]), seg.el]),
    grid, empty,
    h('p', { class: 'pg__note', text: 'VR needs a WebXR headset browser; AR works on recent iPhone and Android phones. 3D models come from Sketchfab and are credited inside the viewer.' })
  ]));
  render();
  return { kind: 'vr', destroy() { dock.destroy(); closePanel(); } };
}
