import { getStore } from '@netlify/blobs';
import { randomBytes, createHash } from 'node:crypto';
import { HttpError } from './http.mjs';
import { pgStore, databaseUrl, useSql } from './pg-store.mjs';

/*
 * Storage. Four stores:
 *   catalog - "cars" and "products": one JSON document each, guarded by entity tags (optimistic concurrency)
 *   crm     - leads/<id>, appointments/<id>, customers/<id>: one record per key, ids sort by time
 *   media   - uploaded photos
 *   system  - rate-limit buckets, the audit log, the import marker, the staff login, the signing key
 * Where they live depends on the host:
 *   - a Postgres database when DATABASE_URL (or POSTGRES_URL) is set - on Vercel, Neon from the Vercel Marketplace;
 *   - Netlify Blobs on Netlify (nothing to set up), with strong consistency so a saved change reads straight back;
 *   - on Vercel without a database, every call answers 503 with how to connect one (the website keeps working from
 *     its built-in data).
 * Locally tools/dev-api.mjs and the tests use a filesystem Blobs server or PGlite.
 */
export { useSql };
let usingSql = false;
export function useSqlStore(fn) { useSql(fn); usingSql = true; opened.clear(); }

const NO_DATABASE = () => new HttpError(503, 'No database', 'This site has no database yet. In Vercel open the project, then Storage → Create Database → Neon (Postgres) → Connect, and redeploy.');
const missing = new Proxy({}, { get: () => async () => { throw NO_DATABASE(); } });

export function storageKind() {
  if (usingSql || databaseUrl()) return 'postgres';
  if (process.env.VERCEL) return 'missing';
  return 'netlify-blobs';
}

const opened = new Map();
export function store(name) {
  if (!opened.has(name)) {
    const kind = storageKind();
    opened.set(name, kind === 'postgres' ? pgStore(name) : kind === 'missing' ? missing : getStore({ name, consistency: 'strong' }));
  }
  return opened.get(name);
}

/** Time-sortable id: 9 base-36 characters of milliseconds, then 8 random hex characters. */
export const newId = () => `${Date.now().toString(36).padStart(9, '0')}-${randomBytes(4).toString('hex')}`;

/** Human-friendly reference, e.g. EX-7K2QD9 (no 0/O/1/I to avoid misreading on the phone). */
export function newRef(prefix = 'EX') {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = randomBytes(6);
  return `${prefix}-${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

/* ---------- documents ---------- */
export async function readDoc(storeName, key) {
  const res = await store(storeName).getWithMetadata(key, { type: 'json' });
  return res ? { data: res.data, etag: res.etag } : null;
}

/* writes to one key from the same process run one after another (a warm function instance, the dev server) */
const queues = new Map();
async function serial(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((r) => { release = r; });
  const mine = prev.then(() => gate);
  queues.set(key, mine);
  await prev;
  try { return await fn(); } finally {
    release();
    if (queues.get(key) === mine) queues.delete(key);
  }
}

const NOT_IMPORTED = () => new HttpError(409, 'Not imported', 'The data has not been imported yet. Open Settings in the CRM and import it.');

/**
 * Read-modify-write a document. `fn(data)` returns the new document (or throws). Across instances the write only
 * succeeds if nobody else wrote in between (onlyIfMatch on the entity tag); on a clash it re-reads and tries again,
 * then gives up with 409. `missing` is the error for a key that does not exist.
 */
export function updateDoc(storeName, key, fn, { attempts = 3, missing = NOT_IMPORTED } = {}) {
  return serial(`${storeName}/${key}`, async () => {
    for (let i = 0; i < attempts; i++) {
      const cur = await readDoc(storeName, key);
      if (!cur) throw missing();
      const next = await fn(structuredClone(cur.data));
      const res = await store(storeName).setJSON(key, next, cur.etag ? { onlyIfMatch: cur.etag } : {});
      if (res?.modified !== false) return next;
    }
    throw new HttpError(409, 'Edit conflict', 'Someone else changed this at the same time. Reload and try again.');
  });
}

export function writeDoc(storeName, key, data) {
  return serial(`${storeName}/${key}`, () => store(storeName).setJSON(key, data));
}

/* ---------- one-record-per-key collections ---------- */
export async function listKeys(storeName, prefix) {
  const { blobs } = await store(storeName).list({ prefix });
  return blobs.map((b) => b.key).sort().reverse();   /* newest first: ids sort by time */
}

/** Fetch records: one query where the store can (Postgres), else parallel batches. */
export async function getMany(storeName, keys, batch = 24) {
  if (store(storeName).getMany) return store(storeName).getMany(keys);
  const out = [];
  for (let i = 0; i < keys.length; i += batch) {
    const part = await Promise.all(keys.slice(i, i + batch).map((k) => store(storeName).get(k, { type: 'json' })));
    out.push(...part.filter(Boolean));
  }
  return out;
}

export async function getRecord(storeName, key) {
  return store(storeName).get(key, { type: 'json' });
}

export async function putRecord(storeName, key, value) {
  await store(storeName).setJSON(key, value);
  return value;
}

export async function deleteRecord(storeName, key) {
  await store(storeName).delete(key);
}

/* ---------- rate limits: fixed windows per client address ---------- */
/* an IPv6 client controls a whole /64, so count the /64, not the address */
export function clientKey(ip) {
  const s = String(ip || '').replace(/^::ffff:/, '');
  if (!s.includes(':')) return s;
  const [head, tail = ''] = s.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const full = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${full.slice(0, 4).map((x) => x.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/**
 * Count one attempt and refuse with 429 past the limit. The count is a compare-and-set (onlyIfNew / onlyIfMatch) with
 * retries, plus the same per-key queue as updateDoc, so parallel attempts cannot all read the same count.
 */
export function rateLimit(bucket, ip, { limit, windowSeconds }) {
  const who = createHash('sha256').update(`${bucket}:${clientKey(ip)}`).digest('hex').slice(0, 32);
  const key = `rl/${bucket}/${who}`;
  return serial(`system/${key}`, async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const now = Math.floor(Date.now() / 1000);
      const cur = await store('system').getWithMetadata(key, { type: 'json' });
      const data = cur?.data;
      const next = !data || now - data.start >= windowSeconds ? { start: now, count: 1 } : { start: data.start, count: data.count + 1 };
      const res = await store('system').setJSON(key, next, !cur ? { onlyIfNew: true } : cur.etag ? { onlyIfMatch: cur.etag } : {});
      if (res?.modified === false) continue;   /* someone else counted first: count again on top of theirs */
      if (next.count > limit) {
        await audit('rate-limited', { bucket });
        throw new HttpError(429, 'Too many requests', 'Too many attempts. Please wait a few minutes and try again.', { retryAfter: Math.max(1, next.start + windowSeconds - now) });
      }
      return;
    }
    throw new HttpError(429, 'Too many requests', 'Too many attempts at once. Please wait a moment and try again.', { retryAfter: 5 });
  });
}

/* ---------- audit log ---------- */
export async function audit(event, detail = {}) {
  try { await store('system').setJSON(`audit/${newId()}`, { event, at: new Date().toISOString(), ...detail }); } catch { /* the log must never break a request */ }
}
