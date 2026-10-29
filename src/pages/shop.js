import * as stock from '../data/stock.js';
import { themeToggle } from '../ui/theme-toggle.js';
import { h, icon, clear, debounce } from '../ui/dom.js';
import { brandMark } from '../ui/brand.js';
import { openService, openEnquiry } from '../ui/panels.js';
import { toast } from '../ui/toast.js';
import { notch, biteFor } from '../ui/notch.js';
import { liquidTabs } from '../ui/liquid-tabs.js';
import { brandTheme, brandVars, makeLabel } from '../ui/brand-theme.js';

/* Filters survive a visit to a car page. */
let missedTimer = 0;
/* what a customer searched for and did not find is counted in the CRM (what the stock could not answer) */
function missed() {
  clearTimeout(missedTimer);
  missedTimer = setTimeout(() => {
    if (memory.tab !== 'sale' || !(memory.brand || (memory.q || '').trim().length >= 3)) return;
    import('../data/api.js').then((m) => m.reportDemand?.({ query: [memory.brand, memory.model, memory.q].filter(Boolean).join(' '), filters: { brand: memory.brand || null, from: memory.from || null, to: memory.to || null }, source: 'shop' })).catch(() => {});
  }, 1600);
}
const memory = { tab: 'sale', q: '', brand: '', model: '', from: 0, to: 0, shown: 24, fresh: false, sort: 'new', body: '', only3d: false, onlyNew: false };
const STEP = 24;

/** Open the shop on one make (from Home's make tiles and spotlight). */
export function shopWithBrand(brand) {
  Object.assign(memory, { tab: 'sale', q: '', brand, model: '', from: 0, to: 0, shown: STEP, fresh: true, sort: 'new', body: '', only3d: false, onlyNew: false });
  location.hash = '#/shop';
}

/**
 * The top bar shared by the shop pages: a round back button, the wordmark in the middle (it goes home) and a round
 * action on the right. It sits on the page; once the page scrolls it tightens into a frosted oval (fx.js).
 */
export function topBar({ back, backLabel, action }) {
  const bar = h('header', { class: 'tb' }, [
    h('a', { class: 'tb__btn', href: back, 'aria-label': backLabel, 'data-tip': backLabel }, icon('back')),
    h('a', { class: 'tb__brand', href: '#/home', 'aria-label': 'Exotic Cars home' }, [h('span', { class: 'tb__dot', 'aria-hidden': 'true' }), h('span', { class: 'tb__word' }, ['Exotic', h('span', { class: 'tb__cars', text: ' Cars' })])]),
    h('div', { class: 'tb__tools' }, [themeToggle('tb__btn'), action].filter(Boolean))
  ]);
  return { el: bar, destroy() {} };   /* scroll states (frosted, away) are set page-wide by fx.js */
}

const bit = (name, text) => (text ? h('span', { class: 'mb' }, [icon(name), text]) : null);
const meta = (c) => h('span', { class: 'scard__meta' }, [bit('year', c.year), bit('gauge', stock.kmLabel(c)), bit('pin', c.region)]);

function card(c, canConfigure, i = 0) {
  const badge = c.sold ? 'Sold' : c.featured ? 'Featured' : null;
  const img = h('span', { class: 'scard__img' }, [
    h('img', { src: stock.coverUrl(c), alt: '', loading: 'lazy', decoding: 'async', width: 800, height: 600, onerror: stock.coverError(c) }),
    badge ? h('span', { class: `badge${c.sold ? ' badge--sold' : c.newArrival ? ' badge--new' : ''}`, text: badge }) : null
  ]);
  const a = h('a', {
    class: `scard${c.sold ? ' is-sold' : ''}`, href: `#/shop/${c.id}`, 'aria-label': c.title,
    'data-tip': c.sold ? 'View sold car' : 'View car', 'data-tip-desc': 'Photos, specs and booking'
  }, [img, h('span', { class: 'scard__body' }, [
    h('span', { class: 'scard__make', text: makeLabel(c.brand) }),
    h('span', { class: 'scard__title', text: c.title }), meta(c),
    h('span', { class: 'scard__foot' }, [h('span', { class: 'scard__price', text: c.price ? stock.priceLabel(c) : 'On request', 'aria-label': stock.priceLabel(c) }), h('span', { class: 'scard__go', 'aria-hidden': 'true' }, icon('right'))])
  ])]);
  const wrap = h('div', { class: 'scw rv tilt', style: `--i:${i % 6}` });
  if (canConfigure) a.dataset.cfg = '1';   /* tapping the card reveals "See more details" and "Customize in 3D" (ui/motion.js) */
  wrap.append(a);
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
  const shopMain = h('main', { class: 'wrap shop' }, [
    h('div', { class: 'shop__head' }, [h('h1', { class: 'shop__title', text: 'Shop' }), count]),
    tabs.el,
    h('div', { class: 'shop__tools' }, [h('label', { class: 'search' }, [icon('search'), search]), filterBtn]),
    filterWrap,
    brandsSlot, banner, list, more
  ]);
  root.append(
    bar.el,
    shopMain
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

  /* ---------- a make's own page: the highlighted car first, then the rest, with sort and filter ---------- */
  const SORTS = [['new', 'Newest first'], ['old', 'Oldest first'], ['low', 'Price: low to high'], ['high', 'Price: high to low'], ['km', 'Lowest mileage']];
  const cmp = (a, b) => (a > b) - (a < b);
  const SORT_FN = {
    new: (x, y) => cmp(y.year || 0, x.year || 0),
    old: (x, y) => cmp(x.year || 0, y.year || 0),
    low: (x, y) => cmp(x.price || Infinity, y.price || Infinity),
    high: (x, y) => cmp(y.price || 0, x.price || 0),
    km: (x, y) => cmp(x.km ?? Infinity, y.km ?? Infinity)
  };
  const pickHero = (l) => l.find((c) => c.featured && stock.configuratorMatch(c)) || l.find((c) => c.featured) || l.find((c) => c.newArrival) || l.find((c) => stock.configuratorMatch(c)) || l[0] || null;
  const brandView = (cars) => cars
    .filter((c) => (!memory.body || c.body === memory.body) && (!memory.only3d || stock.configuratorMatch(c)) && (!memory.onlyNew || c.newArrival))
    .sort(SORT_FN[memory.sort] || SORT_FN.new);
  const leaveBrand = () => { Object.assign(memory, { brand: '', model: '', shown: STEP }); brands.set(''); renderFilters(); render(true); window.scrollTo({ top: 0 }); };

  const heroSlot = h('div', { class: 'bh-slot' });
  const barSlot = h('div', { class: 'bc-slot' });
  let barFor = '', barUi = null;
  function buildBar(base) {
    const chips = [];
    const add = (text, test, set) => {
      const el = h('button', { class: 'ui-chip', type: 'button', 'aria-pressed': 'false', text, onclick: () => { set(); memory.shown = STEP; render(true); } });
      chips.push([el, test]);
      return el;
    };
    const bodies = [...new Set(base.map((c) => c.body).filter(Boolean))].sort();
    const sel = h('select', { class: 'ui-select__el', 'aria-label': 'Sort by', onchange: (e) => { memory.sort = e.target.value; memory.shown = STEP; render(true); } }, SORTS.map(([v, t]) => h('option', { value: v, text: t })));
    const countEl = h('span', { class: 'bc__count', 'aria-live': 'polite' });
    const el = h('div', { class: 'bc' }, [
      h('div', { class: 'bc__row' }, [h('label', { class: 'ui-select' }, [h('span', { class: 'ui-select__lbl', text: 'Sort by' }), sel, icon('chevron')]), countEl]),
      h('div', { class: 'bc__chips', role: 'group', 'aria-label': 'Filter cars' }, [
        add('All', () => !memory.body && !memory.only3d && !memory.onlyNew, () => Object.assign(memory, { body: '', only3d: false, onlyNew: false })),
        ...bodies.map((b) => add(b, () => memory.body === b, () => { memory.body = memory.body === b ? '' : b; })),
        add('3D ready', () => memory.only3d, () => { memory.only3d = !memory.only3d; }),
        add('New arrivals', () => memory.onlyNew, () => { memory.onlyNew = !memory.onlyNew; })
      ])
    ]);
    return { el, sync(n) { sel.value = memory.sort; chips.forEach(([c, t]) => c.setAttribute('aria-pressed', String(!!t()))); countEl.textContent = `${n} ${n === 1 ? 'car' : 'cars'}`; } };
  }
  function brandHero(c, b, total) {
    const t = brandTheme(b);
    const name = c ? (c.title.replace(new RegExp(`^${c.brand.replace(/\s+/g, '[\\s-]*')}\\s*`, 'i'), '') || c.title) : '';
    const pic = c ? h('a', { class: 'bh__car', href: `#/shop/${c.id}`, 'data-fx': 'spot tilt glare', 'aria-label': `Highlighted car: ${c.title}` }, [
      h('span', { class: 'bh__pic' }, h('img', { src: stock.coverUrl(c), alt: '', decoding: 'async', draggable: 'false', onerror: stock.coverError(c) })),
      h('span', { class: 'bh__flag' }, [icon('spark'), 'Highlight']),
      h('span', { class: 'bh__info' }, [
        h('b', { text: name }),
        h('span', { class: 'bh__spec', text: [c.year, stock.kmLabel(c), c.hp].filter(Boolean).join(' · ') }),
        h('span', { class: 'bh__foot' }, [h('span', { class: 'bh__price', text: stock.priceLabel(c) }), h('span', { class: 'bh__cta' }, ['View the car', icon('right')])])
      ]),
      h('span', { class: 'xc__glare', 'aria-hidden': 'true' })
    ]) : null;
    return h('section', { class: 'bh', style: brandVars(b), 'aria-label': `${makeLabel(b)} cars` }, [
      h('span', { class: 'bh__mark', 'aria-hidden': 'true' }, brandMark(makeLabel(b)) || ''),
      h('div', { class: 'bh__head' }, [h('button', { class: 'bh__back', type: 'button', onclick: leaveBrand }, [icon('back'), 'All makes']), h('p', { class: 'bh__eyebrow', text: t.name })]),
      h('h1', { class: 'bh__title', text: makeLabel(b) }),
      h('p', { class: 'bh__sub', text: `${total} ${total === 1 ? 'car' : 'cars'} ${memory.tab === 'sold' ? 'sold' : 'in stock'}` }),
      pic
    ]);
  }
  function renderBanner(view, hero) {
    const b = memory.brand;
    list.setAttribute('style', b ? brandVars(b) : '');
    list.classList.toggle('is-branded', !!b);
    shopMain.setAttribute('style', b ? brandVars(b) : '');
    shopMain.classList.toggle('is-brand-page', !!b);
    bar.el.setAttribute('style', b ? brandVars(b) : '');
    bar.el.classList.toggle('is-brand-page', !!b);
    if (!b) { banner.replaceChildren(); barFor = ''; return; }
    if (!banner.firstChild) banner.append(heroSlot, barSlot);
    const base = stock.queryStock({ tab: memory.tab, brand: b });
    const key = `${memory.tab}|${b}`;
    if (key !== barFor) { barFor = key; barUi = buildBar(base); barSlot.replaceChildren(barUi.el); }
    barUi.sync(view.length);
    heroSlot.replaceChildren(brandHero(hero, b, base.length));
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
    const found = stock.queryStock(memory);
    const view = memory.brand ? brandView(found) : found;
    const hero = memory.brand ? pickHero(view) : null;
    const cars = hero ? view.filter((c) => c !== hero) : view;
    count.textContent = `${view.length} ${view.length === 1 ? 'car' : 'cars'}${memory.brand ? ` · ${makeLabel(memory.brand)}` : ''}`;
    renderBanner(view, hero);
    if (reset) { clear(list); shownBefore = 0; }
    if (!view.length) { clear(list); list.append(h('p', { class: 'empty', text: memory.brand ? 'No cars match these filters.' : 'No cars match your search.' })); missed(); }
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
  const photos = [...new Set([c.cover, ...(c.gallery || [])].filter(Boolean))];
  if (!photos.length) photos.push(stock.PLACEHOLDER);
  const local = (u, i) => (i === 0 ? stock.coverUrl(c) : u);
  const track = h('div', { class: 'gal__track', tabindex: '0', 'aria-label': 'Photos' }, photos.map((u, i) => h('div', { class: 'gal__slide' }, h('img', {
    src: local(u, i), alt: i === 0 ? c.title : '', loading: i < 2 ? 'eager' : 'lazy', decoding: 'async',
    onerror: i === 0 ? stock.coverError(c) : undefined
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
  const badge = c.sold ? 'Sold' : null;
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
          h('button', { class: 'ghost', type: 'button', onclick: () => openEnquiry({ title: c.sold ? 'Find me one like this' : 'Ask about this car', type: c.sold ? 'general' : 'viewing', car: { id: c.id, title: name }, source: 'car page', message: c.sold ? 'I am looking for a similar car.' : '' }) }, [icon('chat'), c.sold ? 'Find me one' : 'Enquire']),
          c.url ? h('a', { class: 'ghost', href: c.url, target: '_blank', rel: 'noopener noreferrer' }, 'View on exoticcars.ae') : null
        ])
      ])
    ])
  );

  return { kind: 'shopcar', destroy() { bar.destroy(); } };
}
