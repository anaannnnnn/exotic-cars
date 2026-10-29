import { randomBytes } from 'node:crypto';
import { HttpError } from './http.mjs';

/*
 * MongoDB storage with the same interface as the Postgres store: one document per store+key in `kv`,
 * with an entity tag so onlyIfNew / onlyIfMatch stay atomic. Catalog writes also refresh the `cars`,
 * `brands`, `products` and `meta` collections so those stay the same records the CRM edits.
 * DevX Control provides MONGO_URI. MONGODB_URI and MONGO_URL are also accepted;
 * a mongodb DATABASE_URL is supported for generic hosting integrations.
 */
export function mongoUrl() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL || '';
  /* An explicit Mongo variable always wins over stale Postgres variables. Returning an invalid
     explicit value makes Mongo fail clearly instead of silently switching to another database. */
  if (uri) return uri;
  const other = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  return other.startsWith('mongodb') ? other : '';
}

let dbPromise = null;

const idOf = (store, key) => `${store}\u0000${key}`;
const newTag = () => randomBytes(8).toString('hex');

function toArrayBuffer(bin) {
  if (!bin) return null;
  const buf = Buffer.isBuffer(bin) ? bin : Buffer.from(bin.buffer ?? bin);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function prefixBound(prefix) {
  const last = prefix.charCodeAt(prefix.length - 1);
  return prefix.slice(0, -1) + String.fromCharCode(last + 1);
}

function unavailable(e) {
  if (e instanceof HttpError) throw e;
  const text = `${e?.name || ''} ${e?.message || ''}`;
  if (/Mongo(ServerSelection|Network)|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN/.test(text)) {
    throw new HttpError(503, 'Database unavailable', 'The database did not answer. Check the database connection and try again.');
  }
  throw e;
}

async function database() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(mongoUrl(), { serverSelectionTimeoutMS: 8000 });
      await client.connect();
      const db = client.db();
      await db.collection('kv').createIndex({ store: 1, key: 1 }, { unique: true });
      await seedKv(db);
      return db;
    })().catch((e) => { dbPromise = null; throw e; });
  }
  return dbPromise;
}

function withoutIds(doc) {
  const { _id, key, ...rest } = doc;
  return rest;
}

/** First boot only: the loaded collections become the two catalogue documents the API reads. */
async function seedKv(db) {
  const kv = db.collection('kv');
  if (await kv.findOne({ store: 'catalog', key: 'cars' }, { projection: { _id: 1 } })) return;
  const [cars, brands, products, meta, system] = await Promise.all([
    db.collection('cars').find().toArray(),
    db.collection('brands').find().toArray(),
    db.collection('products').find().toArray(),
    db.collection('meta').findOne({ _id: 'catalog' }),
    db.collection('system').find().toArray()
  ]);
  if (!cars.length && !products.length) return;
  const now = new Date();
  const productDoc = {};
  for (const product of products) {
    const value = withoutIds(product);
    const id = String(value.id || product.key || product._id);
    productDoc[id] = { ...value, id };
  }
  const docs = [];
  if (cars.length) {
    docs.push({
      _id: idOf('catalog', 'cars'), store: 'catalog', key: 'cars', etag: newTag(), updated_at: now,
      value: {
        cars: cars.map(withoutIds),
        brands: brands.map(({ _id, ...rest }) => rest),
        source: meta?.source ?? null,
        fetched: meta?.fetched ?? null,
        updatedAt: meta?.updatedAt ?? null
      }
    });
  }
  if (products.length) {
    docs.push({
      _id: idOf('catalog', 'products'), store: 'catalog', key: 'products', etag: newTag(), updated_at: now,
      value: productDoc
    });
  }
  for (const row of system) {
    if (!row.key) continue;
    docs.push({
      _id: idOf(row.store || 'system', row.key),
      store: row.store || 'system',
      key: row.key,
      value: row.value,
      etag: row.etag || newTag(),
      updated_at: row.updated_at ? new Date(row.updated_at) : now
    });
  }
  if (docs.length) await kv.insertMany(docs, { ordered: false });
}

async function syncCatalog(db, key, value) {
  if (key === 'cars' && value && Array.isArray(value.cars)) {
    const cars = value.cars.map((car) => ({ ...car, _id: String(car.id) }));
    const brands = Array.isArray(value.brands) ? value.brands.map((brand) => ({ ...brand, _id: String(brand.name) })) : [];
    await db.collection('cars').deleteMany({});
    await db.collection('brands').deleteMany({});
    if (cars.length) await db.collection('cars').insertMany(cars, { ordered: false });
    if (brands.length) await db.collection('brands').insertMany(brands, { ordered: false });
    await db.collection('meta').updateOne(
      { _id: 'catalog' },
      { $set: { source: value.source ?? null, fetched: value.fetched ?? null, updatedAt: value.updatedAt ?? null } },
      { upsert: true }
    );
  }
  if (key === 'products' && value && typeof value === 'object' && !Array.isArray(value)) {
    const docs = Object.entries(value).map(([id, product]) => ({ ...product, _id: String(product?.id || id), key: id }));
    await db.collection('products').deleteMany({});
    for (let i = 0; i < docs.length; i += 500) await db.collection('products').insertMany(docs.slice(i, i + 500), { ordered: false });
  }
}

async function kv() {
  const db = await database();
  return { db, col: db.collection('kv') };
}

export function mongoStore(name) {
  return {
    async get(key, { type } = {}) {
      try {
        const { col } = await kv();
        const doc = await col.findOne({ _id: idOf(name, key) });
        if (!doc) return null;
        return type === 'arrayBuffer' ? toArrayBuffer(doc.bytes) : doc.value ?? null;
      } catch (e) { unavailable(e); }
    },

    async getWithMetadata(key, { type } = {}) {
      try {
        const { col } = await kv();
        const doc = await col.findOne({ _id: idOf(name, key) });
        if (!doc) return null;
        return { data: type === 'arrayBuffer' ? toArrayBuffer(doc.bytes) : doc.value ?? null, etag: doc.etag, metadata: doc.metadata || {} };
      } catch (e) { unavailable(e); }
    },

    async getMany(keys) {
      try {
        if (!keys.length) return [];
        const { col } = await kv();
        const docs = await col.find({ store: name, key: { $in: keys } }, { projection: { key: 1, value: 1 } }).toArray();
        const byKey = new Map(docs.map((doc) => [doc.key, doc.value]));
        return keys.map((key) => byKey.get(key)).filter((value) => value != null);
      } catch (e) { unavailable(e); }
    },

    async setJSON(key, value, opts = {}) {
      try {
        const { db, col } = await kv();
        const tag = newTag();
        const _id = idOf(name, key);
        if (opts.onlyIfNew) {
          try {
            await col.insertOne({ _id, store: name, key, value, etag: tag, updated_at: new Date() });
          } catch (e) {
            if (e?.code === 11000) return { modified: false, etag: tag };
            throw e;
          }
        } else if (opts.onlyIfMatch) {
          const updated = await col.findOneAndUpdate(
            { _id, etag: opts.onlyIfMatch },
            { $set: { value, etag: tag, updated_at: new Date() }, $unset: { bytes: '' } }
          );
          if (!updated) return { modified: false, etag: tag };
        } else {
          await col.updateOne(
            { _id },
            { $set: { store: name, key, value, etag: tag, updated_at: new Date() }, $unset: { bytes: '', metadata: '' } },
            { upsert: true }
          );
        }
        if (name === 'catalog') await syncCatalog(db, key, value);
        return { modified: true, etag: tag };
      } catch (e) { unavailable(e); }
    },

    async set(key, data, { metadata } = {}) {
      try {
        const { Binary } = await import('mongodb');
        const { col } = await kv();
        const tag = newTag();
        const bytes = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
        await col.updateOne(
          { _id: idOf(name, key) },
          { $set: { store: name, key, bytes: new Binary(bytes), metadata: metadata || {}, etag: tag, updated_at: new Date() }, $unset: { value: '' } },
          { upsert: true }
        );
        return { modified: true, etag: tag };
      } catch (e) { unavailable(e); }
    },

    async list({ prefix = '' } = {}) {
      try {
        const { col } = await kv();
        const filter = { store: name };
        if (prefix) filter.key = { $gte: prefix, $lt: prefixBound(prefix) };
        const rows = await col.find(filter, { projection: { key: 1 } }).sort({ key: 1 }).toArray();
        return { blobs: rows.map((row) => ({ key: row.key })) };
      } catch (e) { unavailable(e); }
    },

    async delete(key) {
      try {
        const { db, col } = await kv();
        await col.deleteOne({ _id: idOf(name, key) });
        if (name === 'catalog' && (key === 'cars' || key === 'products')) await syncCatalog(db, key, key === 'cars' ? { cars: [], brands: [] } : {});
      } catch (e) { unavailable(e); }
    }
  };
}
