import { getStore } from '@netlify/blobs';
import { randomBytes, createHash } from 'node:crypto';
import { HttpError } from './http.mjs';

/*
 * Storage on Netlify Blobs. Every store is opened with strong consistency, so a staff member who saves a change reads
 * it straight back. Four stores:
 *   catalog - "cars" and "products": one JSON document each, guarded by entity tags (optimistic concurrency)
 *   crm     - leads/<id>, appointments/<id>, customers/<id>: one record per key, ids sort by time
 *   media   - uploaded photos
 *   system  - rate-limit buckets, the audit log, the import marker
 * Netlify fills in the store credentials in production; locally tools/dev-api.mjs and the tests point it at a
 * filesystem-backed Blobs server.
 */
const opened = new Map();
export function store(name) {
  if (!opened.has(name)) opened.set(name, getStore({ name, consistency: 'strong' }));
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

/** Fetch records in parallel batches. */
export async function getMany(storeName, keys, batch = 24) {
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
export async function rateLimit(bucket, ip, { limit, windowSeconds }) {
  const who = createHash('sha256').update(`${bucket}:${ip}`).digest('hex').slice(0, 32);
  const key = `rl/${bucket}/${who}`;
  const now = Math.floor(Date.now() / 1000);
  const cur = (await store('system').get(key, { type: 'json' })) || { start: now, count: 0 };
  const fresh = now - cur.start >= windowSeconds;
  const next = fresh ? { start: now, count: 1 } : { start: cur.start, count: cur.count + 1 };
  await store('system').setJSON(key, next);
  if (next.count > limit) {
    const retryAfter = Math.max(1, next.start + windowSeconds - now);
    await audit('rate-limited', { bucket });
    throw new HttpError(429, 'Too many requests', 'Too many attempts. Please wait a few minutes and try again.', { retryAfter });
  }
}

/* ---------- audit log ---------- */
export async function audit(event, detail = {}) {
  try { await store('system').setJSON(`audit/${newId()}`, { event, at: new Date().toISOString(), ...detail }); } catch { /* the log must never break a request */ }
}
