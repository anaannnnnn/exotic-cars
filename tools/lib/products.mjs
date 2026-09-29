/*
 * Product normalisation: turns raw storefront products into typed wheel / kit records with
 * parsed fitment text. Pure functions, unit-tested in tests/products.test.mjs.
 */

/* ------------------------------------------------------------------ fitment text */

const TRAILING_SPEC = /\s+\(?[FR]?\d{2}(?:\.\d+)?\s?x\s?\d.*$/i;

/** The vehicle-fitment phrase of a title: the text after the last " for ", minus trailing spec noise. */
export function fitmentText(title) {
  const i = title.toLowerCase().lastIndexOf(' for ');
  if (i < 0) return '';
  let s = title.slice(i + 5);
  s = s.replace(/\s+(Front|Rear|Rrear)\b.*$/i, '')
    .replace(TRAILING_SPEC, '')
    .replace(/,.*$/, '')
    .replace(/\s+\d{2}\s*"?\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

/** Model-year span found in a fitment phrase: { from, to } (to = 0 when open ended). */
export function yearSpan(text) {
  const m = text.match(/\b((?:19|20)\d{2})\s*(?:[-–]\s*((?:19|20)\d{2})?|\+)?/);
  if (!m) return null;
  const from = +m[1];
  let to = m[2] ? +m[2] : from;
  if (/[-–+]\s*$/.test(m[0].trim()) || /\+/.test(m[0])) to = m[2] ? +m[2] : 0;
  return { from, to };
}

/* ------------------------------------------------------------------ wheels */

const FINISH_WORDS = [
  ['Gloss Black', '#0d0e10', 0.35, 0.25], ['Matte Black', '#111214', 0.4, 0.7], ['Satin Black', '#15161a', 0.55, 0.45],
  ['Black Chrome', '#1b1c20', 1, 0.08], ['Diamond Black', '#121316', 0.7, 0.3], ['Titanium Black', '#26282c', 0.9, 0.35],
  ['Hyper Black', '#17181b', 0.7, 0.3], ['Black', '#111214', 0.5, 0.4], ['Anthracite', '#3a3d42', 0.9, 0.35],
  ['Gunmetal', '#3d4045', 1, 0.3], ['Graphite', '#54575d', 1, 0.35], ['Hyper Platinum', '#7d8087', 1, 0.28],
  ['Platinum', '#a4a7ad', 1, 0.25], ['Titanium', '#8a8d93', 1, 0.3], ['Race Silver', '#c4c8ce', 1, 0.28],
  ['Silver', '#c7cbd1', 1, 0.28], ['Polished', '#e2e5ea', 1, 0.08], ['Brushed', '#b8bcc3', 1, 0.42],
  ['Chrome', '#eceff3', 1, 0.05], ['Motorsport Gold', '#c9a03d', 1, 0.28], ['Matte Gold', '#b9963f', 0.9, 0.55],
  ['Gold', '#cfa64a', 1, 0.28], ['Copper Bronze', '#8a5a34', 1, 0.32], ['Satin Bronze', '#7d5a36', 0.9, 0.4],
  ['Bronze', '#8a5a2b', 0.95, 0.32], ['Copper', '#a5673f', 1, 0.3], ['Candy Red', '#9e0f1d', 0.9, 0.2],
  ['Red', '#b4121f', 0.6, 0.3], ['Blue', '#1f4aa8', 0.7, 0.3], ['Green', '#1c5a3a', 0.7, 0.3],
  ['White', '#f1f1ee', 0.3, 0.35], ['Grey', '#6d7077', 0.8, 0.4], ['Clear', '#d5d8dd', 1, 0.15]
];

/** Best-effort finish name + material description from free text. */
export function finishInfo(text) {
  const t = text || '';
  const hits = [];
  for (const [name, color, metalness, roughness] of FINISH_WORDS) {
    if (new RegExp(`\\b${name.replace(/ /g, '\\s+')}\\b`, 'i').test(t)) hits.push({ name, color, metalness, roughness });
  }
  if (!hits.length) return null;
  /* Prefer the longest (most specific) match */
  hits.sort((a, b) => b.name.length - a.name.length);
  return hits[0];
}

function num(s) { return s == null ? null : parseFloat(String(s).replace(',', '.')); }

/** Parses sizes / offset / bolt pattern out of a wheel title. */
export function wheelSpec(title) {
  /* Some vendors (BBS) put the size after the "for <car>" phrase, so parse the whole title.
   * The regexes below are specific enough (NxM, ET, CB) not to be fooled by model names or years. */
  const head = title;
  const spec = { diameter: null, width: null, et: null, pcd: null, cb: null, axle: null, set: false, diameterRear: null, widthRear: null };

  /* Novitec styles: "21/22 J" (front/rear diameters) and "9,0J X 21J Front" (width x diameter) */
  let m = head.match(/\b(\d{2})\s?\/\s?(\d{2})\s?J\b/);
  if (m) { spec.diameter = +m[1]; spec.diameterRear = +m[2]; spec.set = true; }
  m = head.match(/(\d{1,2}[,.]?\d?)\s?J\s?[xX]\s?(\d{2})\s?J\b/);
  if (m) { spec.width = num(m[1]); spec.diameter = +m[2]; }

  /* Generic "20x10.5" - diameter first */
  if (spec.diameter == null || spec.width == null) {
    const g = [...head.matchAll(/\b(\d{2}(?:\.\d+)?)\s?[xX]\s?(\d{1,2}(?:[.,]\d+)?)\s?J?\b/g)]
      .find((x) => +x[1] >= 13 && +x[1] <= 26 && num(x[2]) <= 16);
    if (g) {
      if (spec.diameter == null) spec.diameter = num(g[1]);
      if (spec.width == null) spec.width = num(g[2]);
    } else {
      /* width x diameter order, e.g. Team Schirmer "10.5x18" */
      const r = [...head.matchAll(/(?<![\d.])(\d{1,2}(?:[.,]\d+)?)\s?[xX]\s?(\d{2})\b(?!\.\d)/g)]
        .find((x) => num(x[1]) < 13 && +x[2] >= 15 && +x[2] <= 26);
      if (r) { spec.width = num(r[1]); spec.diameter = +r[2]; }
    }
  }

  m = head.match(/\bET\s?(-?\d+(?:\.\d+)?)/i) || head.match(/\d\s?J?\s?([+-]\d{2})\b/);
  if (m) spec.et = num(m[1]);

  m = head.match(/(?<![\d.])([4-8])\s?x\s?(\d{2,3}(?:\.\d+)?)\b(?!\s?J)/);
  if (m && parseFloat(m[2]) >= 98) spec.pcd = `${m[1]}x${m[2]}`;
  /* "Central Lock Look" (Novitec) is a 5-lug wheel styled like a centre-lock, not a real centre-lock hub */
  else if (/center\s?lock|centre\s?lock|\bCL\b|central lock(?!\s+look)/i.test(head)) spec.pcd = 'Centerlock';

  m = head.match(/\bCB\s?(\d{2}(?:\.\d+)?)/i);
  if (m) spec.cb = num(m[1]);

  if (/\bRear\b|\bRrear\b/i.test(head)) spec.axle = 'rear';
  else if (/\bFront\b/i.test(head)) spec.axle = 'front';
  if (/\bSet\b|Wheels And Tyres/i.test(head)) spec.set = true;

  return spec;
}

/** Wheel design (model) name from a title. */
export function wheelDesign(title, vendor) {
  const head = title.split(/ for /i)[0];
  const nov = head.match(/\b(N[FLCM]\d{1,2}|MC\d{1,2})\b/);
  if (nov) return nov[1].toUpperCase();
  const clean = (s) => s.replace(/\s+$/, '').replace(/\bEvo\b/, 'EVO');
  /* ADVAN "Wheel V5475 GT for PORSCHE": the model is the word after the V-code */
  let m = head.match(/\bWheel\s+V\d{4}\s+([A-Z][A-Za-z0-9\-]+)/);
  if (m) return clean(m[1]);
  /* "Wheel Set OM-1 20x9.5" (Manthey Racing) */
  m = head.match(/\bWheel Set\s+([A-Z][A-Z0-9\-]+)\s/);
  if (m) return clean(m[1]);
  /* "BBS FI205CG FI-R Evo Forged aluminum 1-piece wheel" */
  m = head.match(/^BBS\s+\S+\s+([A-Z]{1,3}(?:-[A-Z]{1,2})?(?:\s+Evo)?)\s+Forged/);
  if (m) return clean(m[1]);
  m = head.match(/\b[Ww]heels?\s+((?:[A-Z0-9][A-Za-z0-9\-+.]*)(?:\s+(?:[A-Z]{3,}|Evo))?)(?=[\s,]|$)/);
  if (m && !/^\d{1,2}(?:[.,]\d)?x/i.test(m[1])) return clean(m[1]);   /* "wheel 17x7" is a size, not a design */
  /* "Rim Set GTX 10.5x19 ..." (Team Schirmer) */
  m = head.match(/\bRim Set\s+(?:BBS\s+)?([A-Z][A-Za-z0-9\-+.]*)(?=\s)/);
  if (m) return clean(m[1]);
  /* "BBS RE5045(BKD)BKD RE-L2 Forged aluminum 1-piece wheel ..." */
  m = head.match(/\s([A-Z]{1,3}-[A-Z0-9]{1,3})\s+Forged/);
  if (m) return clean(m[1]);
  return vendor;
}

export function wheelConstruction(title) {
  const t = title;
  if (/3-?piece/i.test(t)) return '3-piece forged';
  if (/2-?piece/i.test(t)) return '2-piece forged';
  if (/forged/i.test(t)) return /1-?piece|monoblock/i.test(t) ? 'Forged monoblock' : 'Forged';
  if (/flow/i.test(t)) return 'Flow-formed';
  if (/cast/i.test(t)) return 'Cast';
  return '';
}

/* ------------------------------------------------------------------ kits */

const KIT_TYPE = {
  'Bumpers': 'bumper', 'Diffusers': 'rear-diffuser', 'Wings & Rear Spoilers': 'rear-wing', 'Aero Body Kit': 'full-kit',
  'Side Skirts': 'side-skirts', 'Fenders': 'fenders', 'Fender Extensions': 'fenders', 'Hoods & Accessories': 'hood',
  'Roof Spoilers': 'roof-spoiler', 'Rear Trunk Lids': 'trunk-lid', 'Hood Scoops': 'hood-scoop'
};

export const KIT_LABEL = {
  'front-lip': 'Front spoiler / lip', 'front-bumper': 'Front bumper', 'rear-bumper': 'Rear bumper', 'rear-diffuser': 'Rear diffuser',
  'rear-wing': 'Rear wing', 'decklid-spoiler': 'Decklid spoiler', 'side-skirts': 'Side skirts', 'full-kit': 'Full aero kit',
  'widebody': 'Widebody kit', 'fenders': 'Fenders', 'hood': 'Hood', 'trunk-lid': 'Trunk lid', 'roof-spoiler': 'Roof spoiler',
  'hood-scoop': 'Hood scoop', 'canards': 'Canards', 'bumper': 'Bumper'
};

export function kitSubtype(type, title) {
  const base = KIT_TYPE[type];
  if (!base) return null;
  const t = title.toLowerCase();
  if (base === 'bumper') {
    if (/front (spoiler|lip|splitter)|splitter|lip\b/.test(t)) return 'front-lip';
    if (/canard/.test(t)) return 'canards';
    if (/rear/.test(t)) return 'rear-bumper';
    if (/front/.test(t)) return 'front-bumper';
    return 'bumper';
  }
  if (base === 'rear-wing') {
    if (/decklid|trunk|duckbill|ducktail|lip spoiler/.test(t)) return 'decklid-spoiler';
    return 'rear-wing';
  }
  if (base === 'full-kit' && /widebody/.test(t)) return 'widebody';
  return base;
}

export function kitMaterial(title) {
  const t = title.toLowerCase();
  if (/dry carbon/.test(t)) return 'Dry carbon';
  if (/gloss carbon/.test(t)) return 'Gloss carbon';
  if (/satin carbon/.test(t)) return 'Satin carbon';
  if (/visible carbon/.test(t)) return 'Visible carbon';
  if (/carbon/.test(t)) return 'Carbon fibre';
  if (/paintable|abs|pp\b/.test(t)) return 'Paintable';
  return '';
}

/* ------------------------------------------------------------------ products */

const PLACEHOLDER = /image-coming-soon|no-image|placeholder/i;

export function realImages(images) {
  return (images || []).filter((i) => i && i.src && !PLACEHOLDER.test(i.src)).map((i) => i.src);
}

/** Vendor-specific SKU for display. Falls back to the first variant SKU. */
function sku(p) { return (p.variants && p.variants[0] && p.variants[0].sku) || ''; }

/**
 * Normalises one raw product. Returns null when it's neither a wheel nor an aero/body part.
 */
export function normalizeProduct(p, host) {
  const isAtomic = host === 'atomic-shop.ae';
  const price = p.variants && p.variants[0] ? parseFloat(p.variants[0].price) : null;
  const base = {
    id: `${host}:${p.handle}`,
    source: host,
    vendor: p.vendor,
    title: p.title,
    sku: sku(p),
    url: `https://${host}/products/${p.handle}`,
    priceAED: Number.isFinite(price) ? Math.round(price) : null,
    available: !!(p.variants && p.variants.some((v) => v.available)),
    images: realImages(p.images),
    fitmentText: fitmentText(p.title)
  };

  if (isAtomic && p.type === 'Wheels') {
    const spec = wheelSpec(p.title);
    const nov = /NOVITEC/i.test(p.vendor);
    /* Finish words can sit before or after the "for <car>" phrase, so search the title minus the fitment text. */
    const rest = p.title.replace(base.fitmentText, ' ');
    const finish = finishInfo(nov ? rest.replace(/Wheels And Tyres Set|Central Lock Look/gi, '') : rest.replace(/^.*?(?:ET-?\d+(?:\.\d+)?|\d\s?x\s?\d{2,3}(?:\.\d+)?)/, ''));
    return {
      ...base,
      category: 'wheel',
      design: wheelDesign(p.title, p.vendor),
      construction: wheelConstruction(p.title),
      centerLock: /central lock|center\s?lock|centre\s?lock|\bCL\b/i.test(p.title),
      spec,
      finish: finish ? { name: finish.name, color: finish.color, metalness: finish.metalness, roughness: finish.roughness } : null,
      paintable: /solid color|standard color/i.test(p.title),
      wheelYears: null
    };
  }

  if (isAtomic) {
    const sub = kitSubtype(p.type, p.title);
    if (!sub) return null;
    return { ...base, category: 'kit', subtype: sub, material: kitMaterial(p.title) };
  }

  /* Al Khateeb (GCC upgrade kits) */
  const typ = (p.type || '').toUpperCase();
  if (host === 'alkhateeb.ae') {
    if (/BODY ?KIT/.test(typ)) return { ...base, category: 'kit', subtype: /wide/i.test(p.title) ? 'widebody' : 'full-kit', material: '', fitmentText: p.title };
    if (/SPOILER/.test(typ)) return { ...base, category: 'kit', subtype: 'rear-wing', material: '', fitmentText: p.title };
    if (/LIP-FRONT|BUMPER-FRONT/.test(typ)) return { ...base, category: 'kit', subtype: 'front-lip', material: '', fitmentText: p.title };
    if (/SIDE STEP\/SIDE SKIRT/.test(typ)) return { ...base, category: 'kit', subtype: 'side-skirts', material: '', fitmentText: p.title };
  }
  return null;
}

/* ------------------------------------------------------------------ vehicle matching */

/** Do two bolt-pattern strings describe the same pattern? (5x114 ~ 5x114.3; factory "5x112 front / 5x120 rear" lists) */
export function samePattern(factory, wanted) {
  if (!factory || !wanted) return true;
  if (/centerlock/i.test(factory) || /centerlock/i.test(wanted)) return true;
  const list = String(factory).match(/[4-8]x\d{2,3}(?:\.\d+)?/g) || [];
  if (!list.length) return true;
  const [wl, wp] = wanted.split('x');
  return list.some((p) => {
    const [l, d] = p.split('x');
    return l === wl && Math.abs(parseFloat(d) - parseFloat(wp)) < 0.75;
  });
}

/**
 * Which vehicles does a normalised item directly fit?
 * Returns { ids, dropped } where dropped explains any rejected candidate (for the audit report).
 */
export function matchVehicles(item, vehicles, specOf) {
  const text = (item.fitmentText || '').toUpperCase();
  const ids = [];
  const dropped = [];
  if (!text) return { ids, dropped };
  const span = yearSpan(item.fitmentText);

  for (const v of vehicles) {
    const hit = v.match.some((r) => r.test(text)) || (item.source === 'alkhateeb.ae' && v.altMatch && v.altMatch.some((r) => r.test(item.title)));
    if (!hit) continue;

    if (span) {
      const vTo = v.to || 2100;
      const iTo = span.to || 2100;
      if (span.from > vTo || iTo < v.from) { dropped.push({ id: v.id, why: `years ${span.from}-${span.to || 'now'} outside ${v.from}-${v.to || 'now'}` }); continue; }
    }
    if (item.category === 'wheel' && item.spec && item.spec.pcd && item.spec.pcd !== 'Centerlock') {
      const vs = specOf && specOf(v.id);
      if (vs && vs.boltPattern && !samePattern(vs.boltPattern, item.spec.pcd)) {
        dropped.push({ id: v.id, why: `bolt pattern ${item.spec.pcd} != ${vs.boltPattern}` });
        continue;
      }
    }
    ids.push(v.id);
  }
  return { ids, dropped };
}
