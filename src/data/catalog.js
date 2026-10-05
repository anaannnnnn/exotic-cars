/*
 * Catalogue access layer: loads the generated fitment database and answers the questions the UI asks.
 * Everything here is synchronous after load() and free of DOM access so it can be unit tested.
 */

import { getSettings } from '../state/settings.js';
import { api } from './api.js';

let catalog = null;
let products = null;
const vehicleIndex = new Map();

export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Wheels and kits come live from the CRM when the backend is deployed, else from the copy built into the site. */
export async function loadCatalog(base = './data/') {
  const builtIn = () => fetch(`${base}products.json`).then((r) => { if (!r.ok) throw new Error('products.json missing - run "npm run db"'); return r.json(); });
  const [c, p] = await Promise.all([
    fetch(`${base}catalog.json`).then((r) => { if (!r.ok) throw new Error('catalog.json missing - run "npm run db"'); return r.json(); }),
    api('products', { timeout: 7000 }).catch(() => builtIn())
  ]);
  init(c, p);
  return catalog;
}

/**
 * Products edited in the CRM carry `fits` (catalogue vehicle ids). That list is authoritative: the product is listed
 * as a direct fit on exactly those vehicles, replacing whatever the harvested fitment said.
 */
export function applyFits(c, p) {
  const owned = Object.values(p).filter((x) => Array.isArray(x.fits));
  if (!owned.length) return;
  const ids = new Set(owned.map((x) => x.id));
  const add = new Map();
  owned.forEach((x) => x.fits.forEach((vid) => { if (!add.has(vid)) add.set(vid, []); add.get(vid).push(x.id); }));
  c.vehicles.forEach((v) => {
    if (!v.parts) return;
    const extra = add.get(v.id) || [];
    const touched = extra.length || v.parts.direct.some((id) => ids.has(id)) || v.parts.makeLevel.some((id) => ids.has(id));
    if (!touched) return;
    v.parts = { direct: [...v.parts.direct.filter((id) => !ids.has(id)), ...extra], makeLevel: v.parts.makeLevel.filter((id) => !ids.has(id)) };
    if (v.counts) {
      const live = v.parts.direct.map((id) => p[id]).filter(Boolean);
      v.counts = { ...v.counts, wheels: live.filter((x) => x.category === 'wheel').length, kits: live.filter((x) => x.category === 'kit').length };
    }
  });
}

export function init(c, p) {
  catalog = c;
  products = p;
  applyFits(c, p);
  vehicleIndex.clear();
  c.vehicles.forEach((v) => {
    v._hay = norm(`${v.make} ${v.model} ${v.generation} ${v.body} ${v.country} ${v.fuel === 'E' ? 'electric' : v.fuel === 'H' ? 'hybrid' : 'gasoline petrol'} ${v.yearFrom} ${v.yearTo || ''}`);
    vehicleIndex.set(v.id, v);
  });
}

export const meta = () => catalog;
export const vehicle = (id) => vehicleIndex.get(id) || null;
export const product = (id) => (products ? products[id] || null : null);

/* Makes appear in dealership order: marques first, then the rest alphabetically. */
const MAKE_ORDER = ['Ferrari', 'Lamborghini', 'Rolls-Royce', 'Bentley', 'Porsche', 'McLaren', 'Aston Martin', 'Bugatti', 'Mercedes-Benz', 'BMW', 'Audi', 'Maserati', 'Lotus', 'Land Rover', 'Jaguar', 'Lexus', 'Toyota', 'Nissan'];
const rank = (m) => { const i = MAKE_ORDER.indexOf(m); return i < 0 ? 999 : i; };
const byMake = (a, b) => rank(a) - rank(b) || a.localeCompare(b);

export function listVehicles({ q = '', make = '', ids = null } = {}) {
  const terms = norm(q).split(' ').filter(Boolean);
  return catalog.vehicles
    .filter((v) => v.has3d)
    .filter((v) => !make || v.make === make)
    .filter((v) => !ids || ids.includes(v.id))
    .filter((v) => terms.every((t) => v._hay.includes(t)))
    .sort((a, b) => byMake(a.make, b.make) || (b.yearFrom - a.yearFrom) || a.model.localeCompare(b.model));
}

export function makes() {
  const m = new Map();
  catalog.vehicles.filter((v) => v.has3d).forEach((v) => m.set(v.make, (m.get(v.make) || 0) + 1));
  return [...m.entries()].sort((a, b) => byMake(a[0], b[0])).map(([name, count]) => ({ name, count }));
}
export const yearsLabel = (v) => `${v.yearFrom}–${v.yearTo || 'now'}`;

/* ------------------------------------------------------------------ parts */

/**
 * Parts for a vehicle. Direct fitment = the vendor lists the part for this car. Bolt-pattern matches
 * are wheels listed for the make with a verified matching pattern and are only returned on request.
 */
export function partsFor(v, { includeMakeLevel = false } = {}) {
  const listed = (p) => p && p.available !== false;   /* marked unavailable in the CRM (or by the vendor) */
  const direct = v.parts.direct.map(product).filter(listed);
  const level = includeMakeLevel ? v.parts.makeLevel.map(product).filter(listed) : [];
  const tag = (list, tier) => list.map((p) => ({ ...p, tier }));
  const all = [...tag(direct, 'direct'), ...tag(level, 'make-level')];
  return { wheels: all.filter((p) => p.category === 'wheel'), kits: all.filter((p) => p.category === 'kit') };
}

/** Wheels grouped by design ("NOVITEC NF9"), cheapest configuration first. */
export function groupWheels(wheels) {
  const groups = new Map();
  for (const w of wheels) {
    const key = `${w.vendor}|${w.design}`;
    if (!groups.has(key)) groups.set(key, { key, vendor: w.vendor, design: w.design, construction: w.construction, centerLock: false, tier: w.tier, items: [] });
    const g = groups.get(key);
    g.items.push(w);
    g.centerLock ||= !!w.centerLock;
  }
  return [...groups.values()].map((g) => {
    const prices = g.items.map((i) => i.priceAED).filter(Boolean);
    const dias = g.items.flatMap((i) => [i.spec?.diameter, i.spec?.diameterRear]).filter(Boolean);
    return {
      ...g,
      priceFrom: prices.length ? Math.min(...prices) : null,
      diameters: [...new Set(dias)].sort((a, b) => a - b),
      image: g.items.flatMap((i) => i.images)[0] || null
    };
  }).sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'direct' ? -1 : 1) || b.items.length - a.items.length || a.design.localeCompare(b.design));
}

export const KIT_LABEL = {
  'front-lip': 'Front spoiler / lip', 'front-bumper': 'Front bumper', 'rear-bumper': 'Rear bumper & diffuser', 'rear-diffuser': 'Rear diffuser',
  'rear-wing': 'Rear wing', 'decklid-spoiler': 'Decklid spoiler', 'side-skirts': 'Side skirts', 'full-kit': 'Complete aero kit',
  widebody: 'Widebody kit', fenders: 'Fenders', hood: 'Hood', 'trunk-lid': 'Trunk lid', 'roof-spoiler': 'Roof spoiler',
  'hood-scoop': 'Hood scoop', canards: 'Canards', bumper: 'Bumper'
};

const KIT_ORDER = ['full-kit', 'widebody', 'front-lip', 'front-bumper', 'bumper', 'canards', 'side-skirts', 'fenders', 'hood', 'hood-scoop', 'roof-spoiler', 'decklid-spoiler', 'rear-wing', 'trunk-lid', 'rear-bumper', 'rear-diffuser'];

export function groupKits(kits) {
  const g = new Map();
  kits.forEach((k) => { if (!g.has(k.subtype)) g.set(k.subtype, []); g.get(k.subtype).push(k); });
  return [...g.entries()]
    .sort((a, b) => KIT_ORDER.indexOf(a[0]) - KIT_ORDER.indexOf(b[0]))
    .map(([subtype, items]) => ({ subtype, label: KIT_LABEL[subtype] || subtype, items: items.sort((x, y) => (x.priceAED || 0) - (y.priceAED || 0)) }));
}

/* ------------------------------------------------------------------ fitment checks */

/** Factory wheel diameter in inches from a spec like "F: 20x8.5J R: 20x10.5J", or null. */
export function oeDiameter(v) {
  const m = v.spec?.oeWheel?.match(/(\d{2})\s?x\s?\d/);
  return m ? +m[1] : null;
}

function boltMatches(factory, wanted) {
  if (!factory || !wanted) return null;
  if (/centerlock/i.test(factory) || /centerlock/i.test(wanted)) return /centerlock/i.test(factory) === /centerlock/i.test(wanted) ? true : null;
  const list = factory.match(/[4-8]x\d{2,3}(?:\.\d+)?/g) || [];
  if (!list.length) return null;
  const [wl, wp] = wanted.split('x');
  return list.some((p) => { const [l, d] = p.split('x'); return l === wl && Math.abs(parseFloat(d) - parseFloat(wp)) < 0.75; });
}

/**
 * Explains why a wheel does (or might not) fit. Each check is { ok: true|false|null, label, detail }.
 * ok === null means "not stated by the vendor - confirm before ordering".
 */
export function wheelChecks(v, w) {
  const out = [];
  const s = v.spec;
  const b = boltMatches(s?.boltPattern, w.spec?.pcd);
  out.push({
    ok: b,
    label: 'Bolt pattern',
    detail: w.spec?.pcd
      ? `${w.spec.pcd} on the wheel · factory ${s?.boltPattern || 'unknown'}`
      : `Not stated by the vendor · factory ${s?.boltPattern || 'unknown'}`
  });
  if (s?.centerBore) {
    out.push({
      ok: w.spec?.cb ? w.spec.cb >= s.centerBore : null,
      label: 'Centre bore',
      detail: w.spec?.cb ? `${w.spec.cb} mm wheel · ${s.centerBore} mm hub${w.spec.cb > s.centerBore ? ' (needs hub rings)' : ''}` : `Factory hub ${s.centerBore} mm · vendor does not list the wheel bore`
    });
  }
  const oe = oeDiameter(v);
  const dia = w.spec?.diameter;
  if (oe && dia) {
    const diff = dia - oe;
    out.push({ ok: Math.abs(diff) <= 3, label: 'Diameter', detail: `${dia}″${w.spec.diameterRear ? ` / ${w.spec.diameterRear}″` : ''} vs ${oe}″ factory${diff ? ` (${diff > 0 ? '+' : ''}${diff}″)` : ''}` });
  }
  return out;
}

/* ------------------------------------------------------------------ formatting */

export const aed = (n) => (getSettings().hidePrices ? 'Ask for price' : n == null ? 'Price on request' : `AED ${Math.round(n).toLocaleString('en-US')}`);

/** "21/22″ set", "9.0J × 21″ front" - a compact human description of a wheel product's size. */
export function sizeLabel(w) {
  const s = w.spec || {};
  const j = (x) => (x == null ? '' : `${x}`.replace(/\.0$/, ''));
  if (s.set && s.diameter) return s.diameterRear ? `${s.diameter}″ front / ${s.diameterRear}″ rear set` : `${s.diameter}″ set`;
  const parts = [];
  if (s.width && s.diameter) parts.push(`${j(s.width)}J × ${s.diameter}″`);
  else if (s.diameter) parts.push(`${s.diameter}″`);
  if (s.et != null) parts.push(`ET${j(s.et)}`);
  if (s.axle) parts.push(s.axle);
  return parts.join(' · ') || (w.spec?.set || /\bset\b/i.test(w.title || '') ? (/tyres?/i.test(w.title || '') ? 'Set of 4 with tyres' : 'Set of 4') : 'Single wheel');
}

/** "Transparent · Polished", "Forged · Centre-lock look": what distinguishes one variant of a design from another. */
export function variantLabel(p) {
  const head = String(p.title || '').split(/ for /i)[0];
  const bits = [];
  if (p.finish?.name) bits.push(p.finish.name);
  else {
    const m = head.match(/(transparent|solid|standard|special)\s+colou?rs?|polished|brushed/gi) || [];
    m.forEach((x) => { const s = x.replace(/colou?rs?/i, 'colour').replace(/\b\w/g, (c) => c.toUpperCase()); if (!bits.includes(s)) bits.push(s); });
  }
  if (p.construction) bits.push(p.construction);
  if (p.centerLock) bits.push('Centre-lock look');
  return [...new Set(bits)].join(' · ');
}