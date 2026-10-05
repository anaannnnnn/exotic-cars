/*
 * The build: which real products the customer has selected, the bill of materials and share links.
 * Pure functions - no DOM - so the totals are unit tested.
 */

/* Paint library. gloss = solid clear-coat, metallic = flake, matte = satin/matte wrap-like finishes. */
export const PAINT_GROUPS = [
  { id: 'solid', name: 'Solid' },
  { id: 'metallic', name: 'Metallic' },
  { id: 'matte', name: 'Matte & satin' }
];

export const PAINTS = [
  { id: 'alpine', group: 'solid', name: 'Alpine White', color: '#eeeeea', roughness: 0.16, metalness: 0.1 },
  { id: 'jet', group: 'solid', name: 'Jet Black', color: '#0b0b0d', roughness: 0.12, metalness: 0.15 },
  { id: 'signal', group: 'solid', name: 'Signal Red', color: '#c8102e', roughness: 0.12, metalness: 0.2 },
  { id: 'sun', group: 'solid', name: 'Sun Yellow', color: '#f3c400', roughness: 0.12, metalness: 0.15 },
  { id: 'dubai', group: 'solid', name: 'Dubai Orange', color: '#e8590c', roughness: 0.14, metalness: 0.2 },
  { id: 'racing', group: 'solid', name: 'Racing Green', color: '#0d3b2a', roughness: 0.14, metalness: 0.25 },
  { id: 'titanium', group: 'metallic', name: 'Titanium', color: '#5b5f66', roughness: 0.26, metalness: 0.85 },
  { id: 'silver', group: 'metallic', name: 'Silverstone', color: '#b9bcc2', roughness: 0.24, metalness: 0.9 },
  { id: 'graphite', group: 'metallic', name: 'Graphite', color: '#2b2d31', roughness: 0.26, metalness: 0.85 },
  { id: 'cobalt', group: 'metallic', name: 'Cobalt', color: '#14338c', roughness: 0.22, metalness: 0.8 },
  { id: 'midnight', group: 'metallic', name: 'Midnight Blue', color: '#0f1a3a', roughness: 0.22, metalness: 0.8 },
  { id: 'champagne', group: 'metallic', name: 'Champagne', color: '#c9b68a', roughness: 0.24, metalness: 0.85 },
  { id: 'bronze', group: 'metallic', name: 'Bronze', color: '#7a5a3a', roughness: 0.26, metalness: 0.85 },
  { id: 'amethyst', group: 'metallic', name: 'Amethyst', color: '#4b2a63', roughness: 0.22, metalness: 0.8 },
  { id: 'emerald', group: 'metallic', name: 'Emerald', color: '#0f5a45', roughness: 0.22, metalness: 0.8 },
  { id: 'rose', group: 'metallic', name: 'Rosé Gold', color: '#b76e79', roughness: 0.25, metalness: 0.85 },
  { id: 'matte-black', group: 'matte', name: 'Matte Black', color: '#141416', roughness: 0.85, metalness: 0.1 },
  { id: 'nardo', group: 'matte', name: 'Nardo Grey', color: '#7c7f84', roughness: 0.55, metalness: 0.2 },
  { id: 'satin-white', group: 'matte', name: 'Satin White', color: '#e6e5e0', roughness: 0.55, metalness: 0.15 },
  { id: 'olive', group: 'matte', name: 'Matte Olive', color: '#4b5240', roughness: 0.8, metalness: 0.1 },
  { id: 'matte-blue', group: 'matte', name: 'Matte Blue', color: '#27408b', roughness: 0.8, metalness: 0.1 },
  { id: 'matte-red', group: 'matte', name: 'Matte Red', color: '#8b1a1a', roughness: 0.8, metalness: 0.1 }
];

export const WHEEL_COLORS = [
  { id: 'gloss-black', name: 'Gloss Black', color: '#0d0d0f', metalness: 0.5, roughness: 0.25 },
  { id: 'satin-black', name: 'Satin Black', color: '#1a1a1d', metalness: 0.6, roughness: 0.45 },
  { id: 'silver', name: 'Silver', color: '#c4c7cc', metalness: 1, roughness: 0.22 },
  { id: 'gunmetal', name: 'Gunmetal', color: '#4a4d54', metalness: 0.9, roughness: 0.3 },
  { id: 'bronze', name: 'Bronze', color: '#8a6a43', metalness: 0.9, roughness: 0.3 },
  { id: 'gold', name: 'Gold', color: '#c9a24b', metalness: 1, roughness: 0.22 }
];

export const CALIPERS = [
  { id: 'red', name: 'Red', color: '#e10600' },
  { id: 'yellow', name: 'Yellow', color: '#ffd400' },
  { id: 'blue', name: 'Blue', color: '#1f5fd0' },
  { id: 'black', name: 'Black', color: '#16171a' },
  { id: 'silver', name: 'Silver', color: '#b9bdc4' }
];

export const VIEWS = [
  { id: 'side', name: 'Side' },
  { id: 'front34', name: 'Front' },
  { id: 'rear', name: 'Rear' },
  { id: 'top', name: 'Top' },
  { id: 'wheel', name: 'Wheel' }
];

/** The closest paint preset for a dealer's colour name ("Nardo Grey", "Rosso Corsa", "Bianco Avus"). */
const COLOUR_WORDS = [
  [/white|bianco|blanc|weiss|pearl|ivory|cream/i, 'alpine'], [/matt?e? ?black|nero opaco/i, 'matte-black'], [/black|nero|noir|schwarz|obsidian|onyx|carbon/i, 'jet'],
  [/red|rosso|rouge|burgundy|maroon|ruby|bordeaux/i, 'signal'], [/yellow|giallo|gold|jaune/i, 'sun'], [/orange|arancio/i, 'dubai'], [/british racing|racing green|green|verde|verd|olive/i, 'racing'],
  [/nardo|cement|concrete/i, 'nardo'], [/silver|argento|argent|platinum|arctic|titan/i, 'silver'], [/grey|gray|grigio|anthracite|gun ?metal|graphite|charcoal/i, 'graphite'],
  [/navy|midnight|dark blue|nero blue/i, 'midnight'], [/blue|blu|azzurro|bleu|cobalt/i, 'cobalt'], [/purple|violet|amethyst|viola|lila/i, 'amethyst'],
  [/champagne|beige|sand|tan|sable/i, 'champagne'], [/bronze|brown|marrone|copper|cognac|havana/i, 'bronze'], [/pink|rose|rosa/i, 'rose'], [/turquoise|teal|emerald|aqua/i, 'emerald']
];
export function paintForColour(name) {
  if (!name) return null;
  for (const [rx, id] of COLOUR_WORDS) if (rx.test(name)) return PAINTS.find((p) => p.id === id) || null;
  return null;
}

export const byId = (list, id) => list.find((x) => x.id === id) || null;

export function defaultState() {
  return {
    vehicleId: null,
    modelUid: null,
    paint: { preset: PAINTS[0].id, color: PAINTS[0].color, roughness: PAINTS[0].roughness, metalness: PAINTS[0].metalness },
    caliper: null,
    tint: false,
    view: 'side',
    wheels: [],          /* [{ id, qty }] real wheel products */
    kits: [],            /* [productId] real aero products */
    wheelColor: null     /* recolours the rims on the 3D model, hex */
  };
}

/* ------------------------------------------------------------------ quantities & BOM */

/** Wheels a product represents: a set = 1 line of 4; a single wheel on one axle = 2; an axle-less single = 4. */
export function defaultQty(p) {
  if (p.spec?.set) return 1;
  return p.spec?.axle ? 2 : 4;
}

export function quantityLabel(p, qty) {
  if (p.spec?.set) return qty === 1 ? 'Set of 4' : `${qty} sets`;
  return `${qty} wheel${qty === 1 ? '' : 's'}`;
}

/**
 * Bill of materials: one line per selected product with quantity and line total (AED, as listed).
 * `lookup(id)` resolves a product id to its record.
 */
export function bom(state, lookup) {
  const lines = [];
  for (const w of state.wheels) {
    const p = lookup(w.id);
    if (p) lines.push({ kind: 'wheel', product: p, qty: w.qty, total: p.priceAED != null ? p.priceAED * w.qty : null });
  }
  for (const id of state.kits) {
    const p = lookup(id);
    if (p) lines.push({ kind: 'kit', product: p, qty: 1, total: p.priceAED });
  }
  const priced = lines.filter((l) => l.total != null);
  return { lines, total: priced.reduce((s, l) => s + l.total, 0), unpriced: lines.length - priced.length };
}

/**
 * Do the selected wheels cover all four corners? Returns { complete, message }.
 * A set covers everything; otherwise we need 2 front + 2 rear, or 4 axle-less wheels.
 */
export function wheelCoverage(state, lookup) {
  let front = 0, rear = 0, any = 0, sets = 0;
  for (const w of state.wheels) {
    const p = lookup(w.id);
    if (!p) continue;
    if (p.spec?.set) sets += w.qty;
    else if (p.spec?.axle === 'front') front += w.qty;
    else if (p.spec?.axle === 'rear') rear += w.qty;
    else any += w.qty;
  }
  if (!state.wheels.length) return { complete: true, message: '' };
  if (sets >= 1 || any >= 4 || (front >= 2 && rear >= 2)) return { complete: true, message: '' };
  const missing = [];
  if (front < 2 && any < 4) missing.push('front pair');
  if (rear < 2 && any < 4) missing.push('rear pair');
  return { complete: false, message: `Add the ${missing.join(' and ')} to complete the wheel set.` };
}

/* ------------------------------------------------------------------ share links */

const b64 = {
  enc: (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))
};

export function toShare(state) {
  const compact = { v: state.vehicleId, m: state.modelUid, p: state.paint, c: state.caliper, t: state.tint ? 1 : 0, w: state.wheels, k: state.kits, wc: state.wheelColor };
  return b64.enc(JSON.stringify(compact));
}

/* a shared link is untrusted input: colours end up in style attributes, so only plain #rrggbb gets through */
const HEX = /^#[0-9a-f]{6}$/i;
const unit = (x, fallback) => (typeof x === 'number' && x >= 0 && x <= 1 ? x : fallback);

export function fromShare(hash) {
  try {
    const c = JSON.parse(b64.dec(hash));
    if (typeof c.v !== 'string') return null;
    const d = defaultState();
    return {
      ...d,
      vehicleId: c.v,
      modelUid: typeof c.m === 'string' ? c.m : null,
      paint: c.p && typeof c.p.color === 'string' && HEX.test(c.p.color)
        ? { preset: typeof c.p.preset === 'string' ? c.p.preset : null, color: c.p.color, roughness: unit(c.p.roughness, d.paint.roughness), metalness: unit(c.p.metalness, d.paint.metalness) }
        : d.paint,
      caliper: typeof c.c === 'string' ? c.c : d.caliper,
      tint: !!c.t,
      wheels: Array.isArray(c.w) ? c.w.filter((x) => x && typeof x.id === 'string').map((x) => ({ id: x.id, qty: Math.max(1, Math.min(8, x.qty | 0 || 1)) })) : [],
      kits: Array.isArray(c.k) ? c.k.filter((x) => typeof x === 'string') : [],
      wheelColor: typeof c.wc === 'string' && HEX.test(c.wc) ? c.wc : null
    };
  } catch { return null; }
}

/** Plain-text summary for copying into a message to the vendor. */
export function summaryText(vehicleName, state, lookup, formatMoney) {
  const b = bom(state, lookup);
  const lines = [`Build for ${vehicleName}`, ''];
  b.lines.forEach((l) => lines.push(`- ${l.product.vendor} ${l.product.sku || ''} – ${l.product.title} ×${l.qty} – ${formatMoney(l.total)}\n  ${l.product.url}`));
  lines.push('', `Total (listed prices): ${formatMoney(b.total)}${b.unpriced ? ` + ${b.unpriced} on request` : ''}`);
  return lines.join('\n');
}
