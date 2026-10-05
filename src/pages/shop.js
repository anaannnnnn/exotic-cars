import * as stock from '../data/stock.js';
import { themeToggle } from '../ui/theme-toggle.js';
import { h, icon, clear, debounce } from '../ui/dom.js';
import { brandMark } from '../ui/brand.js';
import { openService } from '../ui/panels.js';
import { toast } from '../ui/toast.js';
import { notch, biteFor } from '../ui/notch.js';
import { liquidTabs } from '../ui/liquid-tabs.js';
import { brandTheme, brandVars, makeLabel } from '../ui/brand-theme.js';

/* Filters survive a visit to a car page. */
const memory = { tab: 'sale', q: '', brand: '', model: '', from: 0, to: 0, shown: 24, fresh: false };
const STEP = 24;

/** Open the shop on one make (from Home's make tiles and spotlight). */
export function shopWithBrand(brand) {
  Object.assign(memory, { tab: 'sale', q: '', brand, model: '', from: 0, to: 0, shown: STEP, fresh: true });
  location.hash = '#/shop';
}

/**
 * The top bar shared by the shop pages: a round back button, the wordmark in the middle (it goes home) and a round
 * action on the right. It sits on the page; once the page scrolls it tightens into a frosted oval (fx.js).
 */
export function topBar({ back, backLabel, action }) {
  const bar = h('header', { class: 'tb' }, [
    h('a', { class: 'tb__btn', href: back, 'aria-label': backLabel, 'data-tip': backLabel }, icon('back')),
    h('a', { class: 'tb__brand', href: '#/home', 'aria-label': 'Exotic Cars home' }, [h('span', { class: 'tb__dot', 'aria-hidden': 'true' }), h('span', { class: 'tb__word', text: 'Exotic Cars' })]),
    h('div', { class: 'tb__tools' }, [themeToggle('tb__btn'), action].filter(Boolean))
  ]);
  return { el: bar, destroy() {} };   /* scroll states (frosted, away) are set page-wide by fx.js */
}

const bit = (name, text) => (text ? h('span', { class: 'mb' }, [icon(name), text]) : null);
const meta = (c) => h('span', { class: 'scard__meta' }, [bit('year', c.year), bit('gauge', stock.kmLabel(c)), bit('pin', c.region)]);

function card(c, canConfigure, i = 0) {
  const badge = c.sold ? 'Sold' : c.newArrival ? 'New arrival' : c.featured ? 'Featured' : null;
  const img = h('span', { class: 'scard__img' }, [
    h('img', { src: stock.coverUrl(c), alt: '', loading: 'lazy', decoding: 'async', width: 800, height: 600, onerror: (e) => { if (e.target.src !== c.cover) e.target.src = c.cover; } }),
    badge ? h('span', { class: `badge${c.sold ? ' badge--sold' : c.newArrival ? ' badge--new' : ''}`, text: badge }) : null
  ]);
  const a = h('a', {
    class: `scard${c.sold ? ' is-sold' : ''}`, href: `#/shop/${c.id}`, 'aria-label': c.title,
    'data-tip': c.sold ? 'View sold car' : 'View car', 'data-tip-desc': 'Photos, specs and booking'
  }, [img, h('span', { class: 'scard__body' }, [
    h('span', { class: 'scard__make', text: makeLabel(c.brand) }),
    h('span', { class: 'scard__title', text: c.title }), meta(c),
    h('span', { class: 'scard__foot' }, [h('span', { class: 'scard__price', text: stock.priceLabel(c) }), h('span', { class: 'scard__go', 'aria-hidden': 'true' }, icon('right'))])
  ])]);
  const wrap = h('div', { class: 'scw rv tilt', style: `--i:${i % 6}` });
  if (!canConfigure) { wrap.append(a); return wrap; }
  /* configurable: the card takes the notched shape and the configure button sits in the bite */
  const bite = biteFor(40, 52);
  notch(a, { r: 24, n: bite, k: 12, sizeVar: wrap });
  notch(img, { r: 18, n: (w) => bite(w + 12) - 6, k: 9 });
  a.classList.add('is-notched');
  wrap.append(a, h('a', { class: 'notch-btn notch-btn--sm', href: `#/shop/${c.id}/configure`, 'aria-label': `Configure ${c.title} in 3D`, 'data-tip': 'Configure in 3D', 'data-tip-desc': 'Paint, wheels and aero' }, icon('model')));
  return wrap;
}

function select(label, options, value, onchange) {
  return h('label', { class: 'sel' }, [h('span', { class: 'sr', text: label }), h('select', { onchange: (e) => onchange(e.target.value), 'aria-label': label }, [
    h('option', { value: '', text: label }), ...options.map(([v, t]) => h('option', { value: v, text: t, selected: String(v) === String(value) ? true : null }))
  ]), icon('chevron')]);
}

export function mountShop(root) {
  const fresh = memory.fresh;
  memory.fresh = false;
  const list = h('div', { class: 'sgrid' });
  const more = h('button', { class: 'more', type: 'button', text: 'Show more' });
  const count = h('p', { class: 'shop__count' });
  const banner = h('div', { class: 'bb-slot' });
  const filters = h('div', { class: 'filters', id: 'shop-filters' });
  const filterBtn = h('button', { class: 'fchip', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'shop-filters', 'data-tip': 'Model and year' }, [icon('details'), h('span', { text: 'Filters' }), h('i', { class: 'fchip__n', hidden: true })]);
  const filterWrap = h('div', { class: 'fwrap' }, filters);
  const search = h('input', { class: 'search__input', type: 'search', placeholder: 'Search make or model', autocomplete: 'off', 'aria-label': 'Search stock', value: memory.q });

  const tabs = liquidTabs({
    label: 'Stock', cls: 'lq--ink', value: memory.tab,
    items: stock.TABS.map((t) => ({ id: t.id, label: t.label })),
    onChange: (id) => { Object.assign(memory, { tab: id, brand: '', model: '', shown: STEP }); renderBrands(); renderFilters(); render(true); }
  });
  const brandsSlot = h('div', { class: 'brands-slot' });
  let brands = null;

  const bar = topBar({ back: '#/home', backLabel: 'Home', action: h('a', { class: 'tb__btn tb__btn--signal', href: '#/concierge', 'aria-label': 'Ask the concierge', 'data-tip': 'Ask the concierge', 'data-tip-desc': 'Find a car in plain words' }, icon('spark')) });
  root.append(
    bar.el,
    h('main', { class: 'wrap shop' }, [
      h('div', { class: 'shop__head' }, [h('h1', { class: 'shop__title', text: 'Shop' }), count]),
      tabs.el,
      h('div', { class: 'shop__tools' }, [h('label', { class: 'search' }, [icon('search'), search]), filterBtn]),
      filterWrap,
      brandsSlot, banner, list, more
    ])
  );

  filterBtn.addEventListener('click', () => {
    const open = filterBtn.getAttribute('aria-expanded') !== 'true';
    filterBtn.setAttribute('aria-expanded', String(open));
    filterWrap.classList.toggle('is-open', open);
  });

  /* makes: a rail of chips; the chosen one takes its make's colours on a liquid thumb */
  function renderBrands() {
    brands?.destroy();
    const all = stock.stockBrands(memory.tab);
    brands = liquidTabs({
      label: 'Make', cls: 'lq--brand lq--rail', value: memory.brand,
      theme: (id) => (id ? brandVars(id) : ''),
      items: [{ id: '', content: [h('span', { class: 'lq__all', text: 'All' }), h('small', { text: String(all.reduce((s, [, n]) => s + n, 0)) })] },
        ...all.map(([b, n]) => ({ id: b, content: [brandMark(makeLabel(b)) || '', makeLabel(b), h('small', { text: String(n) })] }))],
      onChange: (b) => { Object.assign(memory, { brand: b, model: '', shown: STEP }); renderFilters(); render(true); }
    });
    brandsSlot.replaceChildren(brands.el);
  }

  function renderBanner() {
    const b = memory.brand;
    list.setAttribute('style', b ? brandVars(b) : '');
    list.classList.toggle('is-branded', !!b);
    if (!b) { banner.replaceChildren(); return; }
    const t = brandTheme(b);
    const n = stock.queryStock({ tab: memory.tab, brand: b }).length;
    banner.replaceChildren(h('section', { class: 'bb', style: brandVars(b), 'aria-label': `${makeLabel(b)} cars` }, [
      h('span', { class: 'bb__mark', 'aria-hidden': 'true' }, brandMark(makeLabel(b)) || ''),
      h('div', { class: 'bb__txt' }, [h('small', { text: t.name }), h('h2', { text: makeLabel(b) }), h('p', { text: `${n} ${n === 1 ? 'car' : 'cars'} ${memory.tab === 'sold' ? 'sold' : 'in stock'}` })]),
      h('button', { class: 'bb__x', type: 'button', 'aria-label': 'Show all makes', 'data-tip': 'All makes', onclick: () => { Object.assign(memory, { brand: '', model: '', shown: STEP }); brands.set(''); renderFilters(); render(true); } }, icon('close'))
    ]));
  }

  function renderFilters() {
    clear(filters);
    const years = stock.stockYears().map((y) => [y, y]);
    filters.append(
      select('All models', stock.stockModels(memory.tab, memory.brand).map((m) => [m, m]), memory.model, (v) => { Object.assign(memory, { model: v, shown: STEP }); render(true); }),
      select('Min year', years.slice().reverse(), memory.from, (v) => { Object.assign(memory, { from: +v || 0, shown: STEP }); render(true); }),
      select('Max year', years, memory.to, (v) => { Object.assign(memory, { to: +v || 0, shown: STEP }); render(true); }),
      h('button', { class: 'ghost ghost--sm', type: 'button', text: 'Reset', onclick: () => { Object.assign(memory, { q: '', brand: '', model: '', from: 0, to: 0, shown: STEP }); search.value = ''; brands.set(''); renderFilters(); render(true); } })
    );
    const n = [memory.model, memory.from, memory.to].filter(Boolean).length;
    const badge = filterBtn.querySelector('.fchip__n');
    badge.hidden = !n; badge.textContent = String(n);
  }

  let shownBefore = 0;
  function render(reset = false) {
    const cars = stock.queryStock(memory);
    count.textContent = `${cars.length} ${cars.length === 1 ? 'car' : 'cars'}${memory.brand ? ` · ${makeLabel(memory.brand)}` : ''}`;
    renderBanner();
    if (reset) { clear(list); shownBefore = 0; }
    if (!cars.length) { clear(list); list.append(h('p', { class: 'empty', text: 'No cars match your search.' })); }
    /* only the new page of cards is added, so cards already on screen don't flash */
    cars.slice(shownBefore, memory.shown).forEach((c, i) => list.append(card(c, !c.sold && !!stock.configuratorMatch(c), i)));
    shownBefore = Math.min(cars.length, memory.shown);
    more.hidden = cars.length <= memory.shown;
    more.textContent = `Show more (${cars.length - memory.shown})`;
  }

  more.addEventListener('click', () => { memory.shown += STEP; render(); });
  /* the next page loads by itself as the end of the list comes into view */
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && !more.hidden) { memory.shown += STEP; render(); } }, { rootMargin: '0px 0px 400px 0px' }) : null;
  io?.observe(more);
  search.addEventListener('input', debounce(() => { memory.q = search.value; memory.shown = STEP; render(true); }, 120));
  renderBrands(); renderFilters(); render(true);
  return { kind: 'shop', fresh, destroy() { io?.disconnect(); bar.destroy(); tabs.destroy(); brands?.destroy(); } };
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

  const bar = topBar({ back: '#/shop', backLabel: 'Back to shop', action: h('button', { class: 'tb__btn', type: 'button', 'aria-label': 'Copy link', 'data-tip': 'Copy link', 'data-tip-desc': 'Share this car', onclick: () => navigator.clipboard?.writeText(location.href).then(() => toast('Link copied'), () => toast('Copy is not available')) }, icon('share')) });
  root.append(
    bar.el,
    h('main', { class: 'scar', style: brandVars(c.brand) }, [
      h('section', { class: 'gal', 'aria-label': 'Photos' }, [track, counter,
        photos.length > 1 ? h('button', { class: 'gal__nav gal__nav--prev', type: 'button', 'aria-label': 'Previous photo', onclick: () => go(index - 1) }, icon('back')) : null,
        photos.length > 1 ? h('button', { class: 'gal__nav gal__nav--next', type: 'button', 'aria-label': 'Next photo', onclick: () => go(index + 1) }, icon('back')) : null,
        badge ? h('span', { class: `badge badge--lg${c.sold ? ' badge--sold' : ''}`, text: badge }) : null,
        thumbs]),
      h('section', { class: 'scar__info' }, [
        h('div', { class: 'car__make car__make--brand' }, [brandMark(makeLabel(c.brand)), h('span', { text: makeLabel(c.brand) })]),
        h('h1', { class: 'scar__name', text: name }),
        c.subtitle ? h('p', { class: 'car__meta', text: c.subtitle }) : null,
        h('p', { class: 'scar__price', text: stock.priceLabel(c) }),
        h('div', { class: 'scar__stats' }, [['Year', c.year], ['Mileage', stock.kmLabel(c)], ['Power', c.hp]].filter(([, v]) => v).map(([k, v]) => h('div', { class: 'stat' }, [h('b', { text: String(v) }), h('span', { text: k })]))),
        h('dl', { class: 'specs' }, SPECS.filter(([k]) => !['Year', 'Mileage', 'Power'].includes(k)).map(([k, f]) => {   /* those three lead in the figures row */
         const v = f(c); return v ? h('div', {}, [h('dt', { text: k }), h('dd', { text: String(v) })]) : null; })),
        c.description ? h('p', { class: 'scar__desc', text: c.description }) : null,
        h('div', { class: 'scar__actions' }, [
          !c.sold && match ? h('a', { class: 'cta', href: `#/shop/${c.id}/configure`, 'data-tip': 'Configure in 3D', 'data-tip-desc': 'Paint, wheels and aero on a live model' }, [icon('paint'), 'Configure in 3D']) : null,
          h('button', { class: !c.sold && match ? 'ghost' : 'cta', type: 'button', text: c.sold ? 'Ask about similar cars' : 'Book a viewing', onclick: () => openService({ car: name, service: c.sold ? 'Configuration consultation' : 'Test drive' }) }),
          h('a', { class: 'ghost', href: c.url, target: '_blank', rel: 'noopener noreferrer' }, 'View on exoticcars.ae')
        ])
      ])
    ])
  );

  return { kind: 'shopcar', destroy() { bar.destroy(); } };
}
