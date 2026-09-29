/* Loaders for the cached raw crawl and the ANKUSI open fitment dataset. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Unique products across all cached collections: [{ host, collections[], ...slimProduct }] */
export function loadRaw(rawDir = path.join(ROOT, '.cache', 'raw')) {
  const map = new Map();
  const meta = {};
  for (const dir of fs.readdirSync(rawDir)) {
    const [host, collection = ''] = dir.split('__');
    const files = fs.readdirSync(path.join(rawDir, dir)).sort();
    for (const f of files) {
      const page = JSON.parse(fs.readFileSync(path.join(rawDir, dir, f), 'utf8'));
      meta[host] = meta[host] || { fetched: page.fetched, collections: new Set() };
      if (page.fetched > meta[host].fetched) meta[host].fetched = page.fetched;
      meta[host].collections.add(collection || '(all)');
      for (const p of page.products) {
        const key = `${host}:${p.id}`;
        const cur = map.get(key);
        if (cur) cur.collections.add(collection);
        else map.set(key, { ...p, host, collections: new Set([collection]) });
      }
    }
  }
  return { products: [...map.values()], meta };
}

/* --- ANKUSI wheel-fitment dataset (CC BY 4.0, https://ankusiwheels.com/wheel-fitment-dataset/) --- */

function csvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function loadAnkusi(file = path.join(ROOT, '.cache', 'sources', 'ankusi.csv')) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  lines.shift();
  return lines.map((l) => {
    const c = csvLine(l);
    return {
      make: c[0], model: c[1], year: parseInt(c[2], 10), chassis: c[3], boltPattern: c[4],
      centerBore: parseFloat(c[5]) || null, lugCount: parseInt(c[7], 10) || null,
      oeWheel: c[8], flushWheel: c[9], maxWheel: c[10], url: c[11]
    };
  });
}

const mode = (arr) => {
  const m = new Map();
  arr.forEach((x) => m.set(x, (m.get(x) || 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

/** Factory wheel spec for a vehicle: the most common row within its year span. */
export function ankusiSpec(rows, ank) {
  const to = ank.to || 2100;
  const hit = rows.filter((r) =>
    r.make.toLowerCase() === ank.make.toLowerCase() &&
    ank.rx.test(`${r.model} ${r.chassis}`) &&
    (!ank.chassis || (r.chassis || '').toUpperCase().includes(ank.chassis) || r.model.toUpperCase().includes(ank.chassis)) &&
    r.year >= ank.from && r.year <= to && r.boltPattern);
  if (!hit.length) return null;
  const pattern = mode(hit.map((r) => r.boltPattern));
  const same = hit.filter((r) => r.boltPattern === pattern);
  const cb = mode(same.map((r) => r.centerBore).filter(Boolean));
  const rep = same.find((r) => r.centerBore === cb && r.oeWheel) || same[0];
  return {
    boltPattern: pattern,
    centerBore: cb,
    lugCount: rep.lugCount,
    oeWheel: rep.oeWheel,
    flushWheel: rep.flushWheel,
    maxWheel: rep.maxWheel,
    samples: same.length,
    sourceUrl: rep.url
  };
}
