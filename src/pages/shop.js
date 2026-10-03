import * as stock from '../data/stock.js';
import { h, icon, clear, debounce } from '../ui/dom.js';
import { brandMark } from '../ui/brand.js';
import { openService } from '../ui/panels.js';
import { toast } from '../ui/toast.js';

/* Filters survive a visit to a car page. */
const memory = { tab: 'sale', q: '', brand: '', model: '', from: 0, to: 0, shown: 24 };
const STEP = 24;
export function setShopBrand(brand) { Object.assign(memory,{tab:"sale",brand,model:"",q:"",from:0,to:0,shown:STEP}); location.hash = "#/shop"; }

const bit = (name, text) => (text ? h('span', { class: 'mb' }, [icon(name), text]) : null);
const meta = (c) => h('span', { class: 'scard__meta' }, [bit('year', c.year), bit('gauge', stock.kmLabel(c)), bit('pin', c.region)]);

function card(c, canConfigure) {
  const badge = c.sold ? 'Sold' : c.newArrival ? 'New arrival' : c.featured ? 'Featured' : null;
  return h('a', { class: `scard${c.sold ? ' is-sold' : ''}`, href: `#/shop/${c.id}`, 'aria-label': c.title }, [
    h('span', { class: 'scard__img' }, [
      h('img', { src: stock.coverUrl(c), alt: '', loading: 'lazy', decoding: 'async', width: 800, height: 600, onerror: (e) => { if (e.target.src !== c.cover) e.target.src = c.cover; } }),
      badge ? h('span', { class: `badge${c.sold ? ' badge--sold' : ''}`, text: badge }) : null,
      canConfigure ? h('span', { class: 'chip3d' }, [icon('paint'), '3D']) : null
    ]),
    h('span', { class: 'scard__body' }, [
      h('span', { class: 'scard__title', text: c.title }),
      meta(c),
      h('span', { class: 'scard__footer' }, [h('span', { class: 'scard__price', text: stock.priceLabel(c) }), h('span', { class: 'card-arrow', 'aria-hidden': 'true' }, icon('forward'))])
    ])
  ]);
}

function select(label, options, value, onchange) {
  return h('label', { class: 'sel' }, [h('span', { class: 'sr', text: label }), h('select', { onchange: (e) => onchange(e.target.value), 'aria-label': label }, [
    h('option', { value: '', text: label }), ...options.map(([v, t]) => h('option', { value: v, text: t, selected: String(v) === String(value) ? true : null }))
  ]), icon('chevron')]);
}

export function mountShop(root) {
  const list = h('div', { class: 'sgrid' });
  const more = h('button', { class: 'more', type: 'button', text: 'Show more' });
  const count = h('p', { class: 'lede' });
  const tabs = h('div', { class: 'pills', role: 'tablist', 'aria-label': 'Stock' });
  const filters = h('div', { class: 'filters' });
  const search = h('input', { class: 'search__input', type: 'search', placeholder: 'Search by make or model', autocomplete: 'off', 'aria-label': 'Search stock', value: memory.q });

  root.append(
    h('header', { class: 'bar bar--home' }, [
      h('a', { class: 'back back--abs', href: '#/', 'aria-label': 'Home' }, icon('back')),
      h('a', { class: 'wordmark', href: '#/', text: 'Exotic Cars' })
    ]),
    h('main', { class: 'wrap' }, [
      h('div', { class: 'head' }, [h('h1', { class: 'title', text: 'Find your next drive.' }), count]),
      tabs,
      h('label', { class: 'search' }, [icon('search'), search]),
      filters, list, more
    ])
  );

  function renderTabs() {
    clear(tabs);
    stock.TABS.forEach((t) => tabs.append(h('button', {
      class: 'pillt', type: 'button', role: 'tab', 'aria-selected': String(memory.tab === t.id), text: t.label,
      onclick: () => { Object.assign(memory, { tab: t.id, brand: '', model: '', shown: STEP }); renderTabs(); renderFilters(); render(); }
    })));
  }

  function renderFilters() {
    clear(filters);
    const years = stock.stockYears().map((y) => [y, y]);
    filters.append(
      select('All makes', stock.stockBrands(memory.tab).map(([b, n]) => [b, `${b} (${n})`]), memory.brand, (v) => { Object.assign(memory, { brand: v, model: '', shown: STEP }); renderFilters(); render(); }),
      select('All models', stock.stockModels(memory.tab, memory.brand).map((m) => [m, m]), memory.model, (v) => { Object.assign(memory, { model: v, shown: STEP }); render(); }),
      select('Min year', years.slice().reverse(), memory.from, (v) => { Object.assign(memory, { from: +v || 0, shown: STEP }); render(); }),
      select('Max year', years, memory.to, (v) => { Object.assign(memory, { to: +v || 0, shown: STEP }); render(); }),
      h('button', { class: 'ghost ghost--sm', type: 'button', text: 'Reset', onclick: () => { Object.assign(memory, { q: '', brand: '', model: '', from: 0, to: 0, shown: STEP }); search.value = ''; renderFilters(); render(); } })
    );
  }

  function render() {
    const cars = stock.queryStock(memory);
    count.textContent = `${cars.length} ${cars.length === 1 ? 'car' : 'cars'}`;
    clear(list);
    if (!cars.length) list.append(h('p', { class: 'empty', text: 'No cars match your search.' }));
    cars.slice(0, memory.shown).forEach((c) => list.append(card(c, !c.sold && !!stock.configuratorMatch(c))));
    more.hidden = cars.length <= memory.shown;
    more.textContent = `Show more (${cars.length - memory.shown})`;
  }

  more.addEventListener('click', () => { memory.shown += STEP; render(); });
  search.addEventListener('input', debounce(() => { memory.q = search.value; memory.shown = STEP; render(); }, 120));
  renderTabs(); renderFilters(); render();
  return { kind: 'shop', destroy() {} };
}

/* ------------------------------------------------------------------ one car */
const SPECS = [
  ['Year', (c) => c.year], ['Mileage', (c) => stock.kmLabel(c)], ['Engine', (c) => c.engine], ['Power', (c) => c.hp],
  ['Transmission', (c) => c.transmission], ['Body', (c) => c.body], ['Exterior', (c) => c.exterior], ['Interior', (c) => c.interior],
  ['Specs', (c) => c.region], ['Warranty', (c) => c.warranty]
];

export function mountShopCar(root, id) {
  const c = stock.stockCar(id);
  if (!c) return null;
  const photos = [c.cover, ...c.gallery].filter(Boolean);
  const local = (u, i) => (i === 0 ? stock.coverUrl(c) : u);
  const track = h('div', { class: 'gal__track', tabindex: '0', 'aria-label': 'Photos' }, photos.map((u, i) => h('div', { class: 'gal__slide' }, h('img', {
    src: local(u, i), alt: i === 0 ? c.title : '', loading: i < 2 ? 'eager' : 'lazy', decoding: 'async',
    onerror: (e) => { if (e.target.src !== u) e.target.src = u; }
  }))));
  const counter = h('span', { class: 'gal__count', text: `1 / ${photos.length}` });
  const thumbs = h('div', { class: 'gal__thumbs' }, photos.map((u, i) => h('button', { class: 'gal__thumb', type: 'button', 'aria-label': `Photo ${i + 1}`, 'aria-pressed': String(i === 0), onclick: () => go(i) }, h('img', { src: u, alt: '', loading: 'lazy' }))));
  let index = 0;
  function go(i) {
    index = Math.max(0, Math.min(photos.length - 1, i));
    track.scrollTo({ left: track.clientWidth * index, behavior: 'smooth' });
  }
  const onScroll = debounce(() => {
    index = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    counter.textContent = `${index + 1} / ${photos.length}`;
    [...thumbs.children].forEach((b, i) => b.setAttribute('aria-pressed', String(i === index)));
    thumbs.children[index]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, 60);
  track.addEventListener('scroll', onScroll, { passive: true });
  track.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') go(index + 1); if (e.key === 'ArrowLeft') go(index - 1); });

  const match = stock.configuratorMatch(c);
  const badge = c.sold ? 'Sold' : c.newArrival ? 'New arrival' : null;
  const name = c.title;

  root.append(
    h('header', { class: 'bar' }, [
      h('a', { class: 'back', href: '#/shop' }, [icon('back'), h('span', { text: 'Shop' })]),
      h('div', { class: 'bar__tools' }, [h('button', { class: 'round round--sm', type: 'button', 'aria-label': 'Copy link', onclick: () => navigator.clipboard?.writeText(location.href).then(() => toast('Link copied'), () => toast('Copy is not available')) }, icon('share'))])
    ]),
    h('main', { class: 'scar' }, [
      h('section', { class: 'gal', 'aria-label': 'Photos' }, [track, counter,
        photos.length > 1 ? h('button', { class: 'gal__nav gal__nav--prev', type: 'button', 'aria-label': 'Previous photo', onclick: () => go(index - 1) }, icon('back')) : null,
        photos.length > 1 ? h('button', { class: 'gal__nav gal__nav--next', type: 'button', 'aria-label': 'Next photo', onclick: () => go(index + 1) }, icon('back')) : null,
        badge ? h('span', { class: `badge badge--lg${c.sold ? ' badge--sold' : ''}`, text: badge }) : null,
        thumbs]),
      h('section', { class: 'scar__info' }, [
        h('div', { class: 'car__make' }, [brandMark(c.brand === 'Rolls Royce' ? 'Rolls-Royce' : c.brand === 'Mercedes Benz' ? 'Mercedes-Benz' : c.brand), h('span', { text: c.brand })]),
        h('h1', { class: 'scar__name', text: name }),
        c.subtitle ? h('p', { class: 'car__meta', text: c.subtitle }) : null,
        h('p', { class: 'scar__price', text: stock.priceLabel(c) }),
        h('dl', { class: 'specs' }, SPECS.map(([k, f]) => { const v = f(c); return v ? h('div', {}, [h('dt', { text: k }), h('dd', { text: String(v) })]) : null; })),
        c.description ? h('p', { class: 'scar__desc', text: c.description }) : null,
        h('div', { class: 'scar__actions' }, [
          !c.sold && match ? h('a', { class: 'cta', href: `#/shop/${c.id}/configure` }, [icon('paint'), 'Configure in 3D']) : null,
          h('button', { class: !c.sold && match ? 'ghost' : 'cta', type: 'button', text: c.sold ? 'Ask about similar cars' : 'Book a viewing', onclick: () => openService({ car: name, service: c.sold ? 'Configuration consultation' : 'Test drive' }) }),
          h('a', { class: 'ghost', href: c.url, target: '_blank', rel: 'noopener noreferrer' }, 'View on exoticcars.ae')
        ])
      ])
    ])
  );

  return { kind: 'shopcar', destroy() {} };
}
