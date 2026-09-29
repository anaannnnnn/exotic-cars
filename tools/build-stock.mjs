/*
 * Turns the crawled dealership stock (.cache/exotic/stock.json) into
 *   data/stock.db                 SQLite (brands, cars, images)
 *   public/data/stock.json        what the shop pages load
 * and, with --images, downloads each car's cover photo to public/stock/<id>.webp (800px) so cards load fast and
 * do not depend on the dealer's server. Gallery photos stay linked to the dealer's own image URLs.
 *
 *   node tools/harvest/exotic.mjs && node tools/build-stock.mjs [--images]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT } from './lib/sources.mjs';

const raw = JSON.parse(fs.readFileSync(path.join(ROOT, '.cache', 'exotic', 'stock.json'), 'utf8'));
const ORIGIN = raw.origin;
const abs = (p) => (p ? `${ORIGIN}/${String(p).replace(/^\/+/, '')}` : null);
const num = (v) => { const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : null; };
const text = (v) => { const s = String(v ?? '').trim(); return s && s !== 'null' ? s : null; };
const strip = (h) => text(String(h ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' '));

function car(x, sold) {
  const gallery = (x.car_images || []).map((i) => abs(i.image)).filter(Boolean);
  const cover = abs(x.image) || gallery[0] || null;
  return {
    id: x.id,
    title: text(x.title),
    brand: text(x.brand?.brand_name) || 'Other',
    model: text(x.model?.model),
    year: num(x.model_year),
    km: num(x.milage),
    price: num(x.price_aed),
    engine: text(x.engine) || text(x.engine_size),
    hp: text(x.horse_power),
    cylinders: text(x.cylinder),
    transmission: text(x.transmission),
    body: text(x.body_type),
    exterior: text(x.exterior_color),
    interior: text(x.interior_color),
    doors: text(x.door),
    region: text(x.specs),
    warranty: text(x.warranty_details),
    description: strip(x.car_description),
    subtitle: text(x.sub_title),
    newArrival: x.new_arrival === 'Yes',
    featured: x.featured === 'Yes',
    sold,
    video: text(x.youtube_embed_code),
    cover,
    gallery: gallery.filter((g) => g !== cover),
    url: `${ORIGIN}/${String(x.title).trim().replace(/\s+/g, '-')}/${x.id}`,
    listedAt: x.created_at
  };
}

const cars = [...raw.forSale.map((x) => car(x, false)), ...raw.sold.map((x) => car(x, true))]
  .filter((c) => c.title)
  .sort((a, b) => (a.sold - b.sold) || String(b.listedAt).localeCompare(String(a.listedAt)));

const brands = new Map();
for (const c of [...raw.forSale, ...raw.sold]) if (c.brand?.brand_name) brands.set(c.brand.brand_name, { name: c.brand.brand_name, logo: abs(c.brand.brand_logo) });

const out = path.join(ROOT, 'public', 'data');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'stock.json'), JSON.stringify({
  fetched: raw.fetched, source: { name: 'Exotic Cars', url: ORIGIN },
  brands: [...brands.values()].sort((a, b) => a.name.localeCompare(b.name)), cars
}));

/* SQLite */
const dbFile = path.join(ROOT, 'data', 'stock.db');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
fs.rmSync(dbFile, { force: true });
const db = new DatabaseSync(dbFile);
db.exec(`
  CREATE TABLE brands (name TEXT PRIMARY KEY, logo TEXT);
  CREATE TABLE cars (id INTEGER PRIMARY KEY, title TEXT, brand TEXT, model TEXT, year INT, km INT, price_aed INT, engine TEXT, horse_power TEXT, cylinders TEXT,
    transmission TEXT, body TEXT, exterior TEXT, interior TEXT, doors TEXT, region TEXT, warranty TEXT, description TEXT, subtitle TEXT,
    new_arrival INT, featured INT, sold INT, video TEXT, cover TEXT, url TEXT, listed_at TEXT);
  CREATE TABLE images (car_id INTEGER, position INT, url TEXT, PRIMARY KEY (car_id, position));
  CREATE INDEX idx_cars_brand ON cars(brand, model);
  CREATE INDEX idx_cars_status ON cars(sold, new_arrival);
`);
const iB = db.prepare('INSERT INTO brands VALUES (?,?)');
brands.forEach((b) => iB.run(b.name, b.logo));
const iC = db.prepare('INSERT INTO cars VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
const iI = db.prepare('INSERT INTO images VALUES (?,?,?)');
for (const c of cars) {
  iC.run(c.id, c.title, c.brand, c.model, c.year, c.km, c.price, c.engine, c.hp, c.cylinders, c.transmission, c.body, c.exterior, c.interior, c.doors, c.region,
    c.warranty, c.description, c.subtitle, +c.newArrival, +c.featured, +c.sold, c.video, c.cover, c.url, c.listedAt);
  [c.cover, ...c.gallery].filter(Boolean).forEach((u, i) => iI.run(c.id, i, u));
}
db.close();
console.log(`${cars.length} cars (${cars.filter((c) => !c.sold).length} for sale, ${cars.filter((c) => c.sold).length} sold), ${brands.size} brands -> data/stock.db, public/data/stock.json`);

/* optional: self-host the cover photos */
if (process.argv.includes('--images')) {
  const { default: sharp } = await import('sharp');
  const dir = path.join(ROOT, 'public', 'stock');
  fs.mkdirSync(dir, { recursive: true });
  let done = 0, failed = 0;
  const queue = cars.filter((c) => c.cover);
  const worker = async () => {
    while (queue.length) {
      const c = queue.shift();
      const file = path.join(dir, `${c.id}.webp`);
      if (fs.existsSync(file)) { done++; continue; }
      try {
        const res = await fetch(c.cover, { headers: { 'User-Agent': 'ApexAtelierImport/1.0 (client-authorised inventory import)' } });
        if (!res.ok) throw new Error(String(res.status));
        await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: 800, withoutEnlargement: true }).webp({ quality: 78 }).toFile(file);
        done++;
      } catch { failed++; }
      if ((done + failed) % 50 === 0) console.log(`images ${done + failed}/${cars.length}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  console.log(`cover photos: ${done} saved, ${failed} failed -> public/stock/`);
}
