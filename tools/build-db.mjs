/*
 * Builds the fitment database from the cached crawl:
 *
 *   npm run harvest -- <host> [--collection x]   (fetch raw storefront data, see tools/harvest/crawl.mjs)
 *   npm run db                                   (this script)
 *
 * Output:
 *   data/apex.db                 SQLite (canonical, for analysis / other tools)
 *   public/data/catalog.json     vehicles + factory specs + 3D models + part index (loaded by the app)
 *   public/data/products.json    products referenced by the catalog
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, loadRaw, loadAnkusi, ankusiSpec } from './lib/sources.mjs';
import { normalizeProduct, matchVehicles, samePattern } from './lib/products.mjs';
import { findModels, nhtsaCheck } from './lib/sketchfab.mjs';
import { VEHICLES as CURATED } from './data/vehicles.mjs';
import { EXTRA_UNIQUE } from './data/extra-vehicles.mjs';

const VEHICLES = [...CURATED, ...EXTRA_UNIQUE];
const EV = /^(tesla|rimac)|taycan|spectre|e-tron|ioniq|leaf/i;

/* Titles that reveal a tuned, game-asset or otherwise non-stock model. */
const BAD_MODEL = /rwb|c-west|top secret|veilside|abandoned car|asphalt|police|nfsmw|need for speed|crash|cyberpun|\babt\b|3d ?-?print|scale ?1|tribute|hover|robocar|racing se|coursework|gt1|lb-?works|photoscanned|zero hf|hks|caravan|camper|presidential/i;
/* Vehicles whose best Sketchfab hits turned out to be a different generation or car. */
const DROP = new Set([
  'mercedes-benz-c-63-amg-w204', 'mercedes-benz-c-63-amg-w205', 'mercedes-benz-e-63-amg-w212', 'mercedes-benz-e-63-s-amg-w213', 'mercedes-benz-cla-45-amg-c118',
  'porsche-911-carrera-997-997', 'volkswagen-golf-r-mk8', 'toyota-crown-s235', 'jaguar-xj-x351', 'audi-r8-lms-rs-e-tron-concept',
  'ferrari-purosangue-concept-296-gt3-f171', 'toyota-corolla-e210'
]);
const firstUsed = new Set();
/* Surcharges, spacers, bolts and the like are listed beside wheels but are not wheels. */
const NOT_A_PRODUCT = /surcharge|spacer|wheel bolt|wheel nut|lug (bolt|nut)|tpms|hub ring|centre cap|center cap|valve stem|adapter/i;

const STUDIO = {
  'ferrari-458': {
    source: 'studio',
    uid: 'studio-ferrari-458',
    name: 'Ferrari 458 – studio model (live wheel & kit preview)',
    author: 'vicent091036',
    license: 'CC Attribution 4.0',
    glb: 'https://raw.githubusercontent.com/mrdoob/three.js/r128/examples/models/gltf/ferrari.glb',
    url: 'https://threejs.org/examples/#webgl_loader_gltf'
  }
};

const SOURCES = {
  'atomic-shop.ae': { id: 'atomic-shop.ae', name: 'ATOMIC-SHOP', city: 'Dubai', country: 'UAE', currency: 'AED', url: 'https://atomic-shop.ae' },
  'alkhateeb.ae': { id: 'alkhateeb.ae', name: 'Al Khateeb Enterprises', city: 'Dubai', country: 'UAE', currency: 'AED', url: 'https://alkhateeb.ae' }
};

const MAKE_ONLY = new Map([
  ['BMW', 'BMW'], ['PORSCHE', 'Porsche'], ['SUBARU', 'Subaru'], ['TOYOTA', 'Toyota'], ['FERRARI', 'Ferrari'],
  ['TESLA', 'Tesla'], ['NISSAN', 'Nissan'], ['LAMBORGHINI', 'Lamborghini'], ['MCLAREN', 'McLaren'], ['CHEVROLET', 'Chevrolet']
]);

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

async function main() {
  const t0 = Date.now();
  const { products, meta } = loadRaw();
  const ankusi = loadAnkusi();
  console.log(`raw products: ${products.length}, ANKUSI rows: ${ankusi.length}`);

  /* 1. factory specs */
  const specs = new Map();
  for (const v of VEHICLES) specs.set(v.id, ankusiSpec(ankusi, v.ank));

  /* 2. normalise + link */
  const items = [];
  for (const p of products) {
    const n = normalizeProduct(p, p.host);
    if (n && !NOT_A_PRODUCT.test(n.title)) items.push(n);
  }
  const linked = new Map();          /* product id -> item */
  const direct = new Map(VEHICLES.map((v) => [v.id, []]));
  const makeLevel = new Map(VEHICLES.map((v) => [v.id, []]));
  const audit = { dropped: 0, matched: 0 };

  for (const it of items) {
    if (!it.fitmentText) continue;
    const { ids, dropped } = matchVehicles(it, VEHICLES, (id) => specs.get(id));
    audit.dropped += dropped.length;
    if (ids.length) {
      audit.matched++;
      linked.set(it.id, it);
      ids.forEach((id) => direct.get(id).push(it.id));
      continue;
    }
    /* make-level wheels (e.g. "APEX ... for BMW"): only when the wheel states a bolt pattern we can verify */
    const mk = MAKE_ONLY.get(it.fitmentText.toUpperCase());
    if (mk && it.category === 'wheel' && it.spec.pcd) {
      const targets = VEHICLES.filter((v) => v.make === mk && specs.get(v.id)?.boltPattern && samePattern(specs.get(v.id).boltPattern, it.spec.pcd));
      if (targets.length) {
        linked.set(it.id, it);
        targets.forEach((v) => makeLevel.get(v.id).push(it.id));
      }
    }
  }

  /* 3. models + NHTSA */
  const vehicles = [];
  let n = 0;
  for (const v of VEHICLES) {
    n++;
    const d = direct.get(v.id);
    const ml = makeLevel.get(v.id);
    process.stdout.write(`[${n}/${VEHICLES.length}] ${v.id} `);
    let models = [];
    try { models = await findModels(v); } catch (e) { console.warn(`(sketchfab failed: ${e.message})`); }
    models = models.filter((m) => !BAD_MODEL.test(m.name) && !firstUsed.has(m.uid));
    const topLikes = Math.max(0, ...models.map((m) => m.likes || 0));
    if (!models.length || DROP.has(v.id) || (topLikes < 8 && !d.length && !ml.length)) { console.log('no usable 3D model - skipped'); continue; }
    firstUsed.add(models[0].uid);
    const nhtsa = await nhtsaCheck(v.make === 'Acura / Honda' ? 'Acura' : v.make, v.model.split(/[ /(]/)[0]);
    const wheelsD = d.filter((id) => linked.get(id).category === 'wheel').length;
    const kitsD = d.filter((id) => linked.get(id).category === 'kit').length;
    console.log(`models:${models.length} direct wheels:${wheelsD} kits:${kitsD} make-level:${ml.length}`);
    vehicles.push({
      id: v.id, make: v.make, model: v.model, generation: v.gen, yearFrom: v.from, yearTo: v.to, body: v.body, country: v.country, fuel: v.fuel || (EV.test(`${v.make} ${v.model}`) ? 'E' : 'G'),
      spec: specs.get(v.id), nhtsa,
      models,
      has3d: models.length > 0,
      tunable: models.some((m) => m.source === 'studio'),
      thumb: (models.find((m) => m.thumb) || {}).thumb || '',
      counts: { wheels: wheelsD, kits: kitsD, makeLevel: ml.length },
      parts: { direct: d, makeLevel: ml }
    });
  }

  /* 4. outputs */
  const productMap = {};
  const used = new Set();
  vehicles.forEach((v) => [...v.parts.direct, ...v.parts.makeLevel].forEach((id) => used.add(id)));
  for (const id of used) {
    const it = linked.get(id);
    productMap[id] = {
      ...pick(it, ['id', 'source', 'vendor', 'title', 'sku', 'url', 'priceAED', 'available', 'category', 'subtype', 'design', 'construction', 'centerLock', 'spec', 'finish', 'paintable', 'material']),
      images: it.images.slice(0, 3),
      fitment: it.fitmentText
    };
  }

  const sources = Object.values(SOURCES).map((s) => ({ ...s, fetched: meta[s.id]?.fetched || null, products: products.filter((p) => p.host === s.id).length }));
  const catalog = {
    version: `${new Date().toISOString().slice(0, 10)}.${vehicles.length}.${used.size}`,
    generatedAt: new Date().toISOString(),
    sources,
    specSource: { name: 'ANKUSI Wheel Fitment Dataset', license: 'CC BY 4.0', url: 'https://ankusiwheels.com/wheel-fitment-dataset/' },
    vehicles
  };

  const outDir = path.join(ROOT, 'public', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'catalog.json'), JSON.stringify(catalog));
  fs.writeFileSync(path.join(outDir, 'products.json'), JSON.stringify(productMap));

  /* SQLite */
  const dbFile = path.join(ROOT, 'data', 'apex.db');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  fs.rmSync(dbFile, { force: true });
  const db = new DatabaseSync(dbFile);
  db.exec(`
    CREATE TABLE sources (id TEXT PRIMARY KEY, name TEXT, city TEXT, country TEXT, currency TEXT, url TEXT, fetched TEXT, products INT);
    CREATE TABLE vehicles (id TEXT PRIMARY KEY, make TEXT, model TEXT, generation TEXT, year_from INT, year_to INT, body TEXT, country TEXT, has_3d INT, tunable INT, nhtsa_make INT, nhtsa_model INT);
    CREATE TABLE vehicle_specs (vehicle_id TEXT PRIMARY KEY, bolt_pattern TEXT, center_bore_mm REAL, lug_count INT, oe_wheel TEXT, flush_wheel TEXT, max_wheel TEXT, samples INT, source_url TEXT);
    CREATE TABLE vehicle_models (uid TEXT, vehicle_id TEXT, source TEXT, name TEXT, author TEXT, license TEXT, likes INT, thumb TEXT, url TEXT, glb TEXT, PRIMARY KEY (uid, vehicle_id));
    CREATE TABLE products (id TEXT PRIMARY KEY, source TEXT, vendor TEXT, sku TEXT, title TEXT, url TEXT, price_aed INT, available INT, category TEXT, subtype TEXT, design TEXT, construction TEXT, center_lock INT, diameter REAL, diameter_rear REAL, width REAL, et REAL, pcd TEXT, axle TEXT, is_set INT, finish TEXT, material TEXT, fitment_text TEXT, images TEXT);
    CREATE TABLE fitment (product_id TEXT, vehicle_id TEXT, tier TEXT, PRIMARY KEY (product_id, vehicle_id));
    CREATE INDEX idx_fit_vehicle ON fitment(vehicle_id);
    CREATE INDEX idx_prod_cat ON products(category, design);
  `);
  const iSrc = db.prepare('INSERT INTO sources VALUES (?,?,?,?,?,?,?,?)');
  sources.forEach((s) => iSrc.run(s.id, s.name, s.city, s.country, s.currency, s.url, s.fetched, s.products));
  const iVeh = db.prepare('INSERT INTO vehicles VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const iSpec = db.prepare('INSERT INTO vehicle_specs VALUES (?,?,?,?,?,?,?,?,?)');
  const iMod = db.prepare('INSERT INTO vehicle_models VALUES (?,?,?,?,?,?,?,?,?,?)');
  const iFit = db.prepare('INSERT INTO fitment VALUES (?,?,?)');
  for (const v of vehicles) {
    iVeh.run(v.id, v.make, v.model, v.generation, v.yearFrom, v.yearTo, v.body, v.country, v.has3d ? 1 : 0, v.tunable ? 1 : 0, v.nhtsa.make ? 1 : 0, v.nhtsa.model ? 1 : 0);
    if (v.spec) iSpec.run(v.id, v.spec.boltPattern, v.spec.centerBore, v.spec.lugCount, v.spec.oeWheel, v.spec.flushWheel, v.spec.maxWheel, v.spec.samples, v.spec.sourceUrl);
    v.models.forEach((m) => iMod.run(m.uid, v.id, m.source, m.name, m.author, m.license, m.likes || 0, m.thumb || '', m.url || '', m.glb || ''));
    v.parts.direct.forEach((id) => iFit.run(id, v.id, 'direct'));
    v.parts.makeLevel.forEach((id) => iFit.run(id, v.id, 'make-level'));
  }
  const iProd = db.prepare('INSERT INTO products VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const p of Object.values(productMap)) {
    const s = p.spec || {};
    iProd.run(p.id, p.source, p.vendor, p.sku, p.title, p.url, p.priceAED, p.available ? 1 : 0, p.category, p.subtype || null, p.design || null, p.construction || null,
      p.centerLock ? 1 : 0, s.diameter ?? null, s.diameterRear ?? null, s.width ?? null, s.et ?? null, s.pcd ?? null, s.axle ?? null, s.set ? 1 : 0,
      p.finish ? p.finish.name : null, p.material || null, p.fitment, JSON.stringify(p.images));
  }
  db.close();

  const with3d = vehicles.filter((v) => v.has3d).length;
  console.log(`\nvehicles with parts: ${vehicles.length} (3D model available: ${with3d}, live-tunable: ${vehicles.filter((v) => v.tunable).length})`);
  console.log(`products in catalogue: ${used.size}  (matched ${audit.matched}, rejected by spec/year checks ${audit.dropped})`);
  console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s -> public/data/*.json, data/apex.db`);
}

main().catch((e) => { console.error(e); process.exit(1); });
