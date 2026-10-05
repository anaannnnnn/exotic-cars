import * as data from './catalog.js';

/* The dealership's own stock (public/data/stock.json, built by tools/build-stock.mjs). */
let stock = null;
let models = {};
let loading = null;
const BASE = import.meta.env.BASE_URL;

export function loadStock() {
  if (stock) return Promise.resolve(stock);
  loading ||= Promise.all([
    fetch(`${BASE}data/stock.json`).then((r) => { if (!r.ok) throw new Error('stock.json missing - run "npm run stock"'); return r.json(); }),
    fetch(`${BASE}data/stock-models.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
  ])
    .then(([s, m]) => {
      models = m || {};
      s.cars.forEach((c) => { c._hay = data.norm(`${c.title} ${c.brand} ${c.model || ''} ${c.year || ''} ${c.body || ''} ${c.exterior || ''} ${c.region || ''}`); });
      stock = s;
      return s;
    });
  return loading;
}

export const stockCar = (id) => (stock ? stock.cars.find((c) => String(c.id) === String(id)) || null : null);

/** Cover photo: the self-hosted copy when present, else the dealer's own URL. */
export const coverUrl = (c) => `${BASE}stock/${c.id}.webp`;

export const TABS = [
  { id: 'new', label: 'New arrival', test: (c) => !c.sold && c.newArrival },
  { id: 'sale', label: 'Cars for sale', test: (c) => !c.sold },
  { id: 'sold', label: 'Previously sold', test: (c) => c.sold }
];

export function queryStock({ tab = 'sale', q = '', brand = '', model = '', from = 0, to = 0 } = {}) {
  const t = TABS.find((x) => x.id === tab) || TABS[1];
  const terms = data.norm(q).split(' ').filter(Boolean);
  return stock.cars.filter((c) => t.test(c)
    && (!brand || c.brand === brand)
    && (!model || c.model === model)
    && (!from || (c.year || 0) >= from)
    && (!to || (c.year || 9999) <= to)
    && terms.every((w) => c._hay.includes(w)));
}

export const stockBrands = (tab) => {
  const t = TABS.find((x) => x.id === tab) || TABS[1];
  const m = new Map();
  stock.cars.filter(t.test).forEach((c) => m.set(c.brand, (m.get(c.brand) || 0) + 1));
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

export const stockModels = (tab, brand) => {
  const t = TABS.find((x) => x.id === tab) || TABS[1];
  return [...new Set(stock.cars.filter((c) => t.test(c) && (!brand || c.brand === brand)).map((c) => c.model).filter(Boolean))].sort();
};

export const stockYears = () => {
  const ys = stock.cars.map((c) => c.year).filter(Boolean);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  return Array.from({ length: hi - lo + 1 }, (_, i) => hi - i);
};

const MAKE_ALIAS = { 'Rolls Royce': 'Rolls-Royce', 'Mercedes Benz': 'Mercedes-Benz' };

/* "F430" should match a title that says "430"; "Continental GT" a title that says only "GT W12" (the dealer's model field has the rest). */
const keyTokens = (model) => data.norm(model.replace(/\(.*?\)/g, '')).split(' ').filter((w) => w.length > 1 || /\d/.test(w)).slice(0, 2);

/** Verified 3D models for a stock car, best first ([] when none passed the checks). */
export const stockModels3d = (car) => (models[car.id] || []);

/**
 * What to configure for a stock car, or null. A car only gets a 3D configurator when it has at least one model that was
 * matched to it by name, year and variant AND verified to render (tools/match-stock-models.mjs + public/audit.html).
 * The catalogue vehicle with the same make/model is used for wheels and kits when there is one; otherwise the car
 * is configurable for colour only.
 */
export function configuratorMatch(car) {
  const list = stockModels3d(car);
  if (!list.length) return null;
  const make = MAKE_ALIAS[car.brand] || car.brand;
  const hay = ` ${data.norm(`${car.title} ${car.model || ''}`)} `;
  const compact = hay.replace(/ /g, '');
  let best = null, bestScore = 0;
  for (const v of data.listVehicles({ make })) {
    const keys = keyTokens(v.model.replace(/\/.*$/, ''));
    if (!keys.length) continue;
    const hit = (k) => (k.length >= 5 && compact.includes(k)) || hay.includes(` ${k} `) || hay.includes(` ${k.replace(/^f(?=\d)/, '')} `) || (/^\d/.test(k) && hay.includes(` f${k} `));
    const got = keys.filter(hit).length;
    if (!got) continue;
    let score = 40 + got * 30 + keys.join('').length;
    if (car.year) {
      const to = v.yearTo || 2100;
      if (car.year >= v.yearFrom - 1 && car.year <= to + 1) score += 100;
      else score -= Math.min(60, Math.min(Math.abs(car.year - v.yearFrom), Math.abs(car.year - to)) * 4);
    }
    if (score > bestScore) { best = v; bestScore = score; }
  }
  const base = bestScore > 140 ? best : null;   /* only reuse parts when the generation really matches */
  return {
    id: base ? base.id : `stock-${car.id}`, make: base ? base.make : make, model: base ? base.model : car.title, generation: base ? base.generation : String(car.year || ''),
    yearFrom: base ? base.yearFrom : car.year || 0, yearTo: base ? base.yearTo : car.year || 0, body: car.body || '', country: '', fuel: 'G',
    spec: base ? base.spec : null, has3d: true, thumb: list[0].thumb || '', counts: base ? base.counts : { wheels: 0, kits: 0, makeLevel: 0 },
    parts: base ? base.parts : { direct: [], makeLevel: [] }, models: list
  };
}

export const kmLabel = (c) => (c.km == null ? null : c.km < 1000 ? `${c.km} km` : `${c.km.toLocaleString('en-US')} km`);
export const priceLabel = (c) => (c.price ? data.aed(c.price) : 'Price on request');
