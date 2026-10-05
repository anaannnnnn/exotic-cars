import { randomBytes } from 'node:crypto';
import { HttpError } from './http.mjs';

/*
 * Postgres storage with the same interface as a Netlify Blobs store (get, getWithMetadata, setJSON with onlyIfNew /
 * onlyIfMatch, set for bytes, list by prefix, delete), so the rest of the server does not care which one it runs on.
 * Used on Vercel (Neon from the Vercel Marketplace sets DATABASE_URL) or anywhere DATABASE_URL / POSTGRES_URL is set.
 * One table; every value has an entity tag, so conditional writes are single atomic statements.
 */
const SCHEMA = `create table if not exists ec_kv (
  store text not null,
  key text not null,
  value jsonb,
  bytes bytea,
  metadata jsonb,
  etag text not null,
  updated_at timestamptz not null default now(),
  primary key (store, key)
)`;

let run = null;        /* async (text, params) => { rows, rowCount } */
let ready = null;

/** Tests (and other hosts) can hand in their own query function, e.g. PGlite. */
export function useSql(fn) {
  run = fn;
  ready = null;
}

export const databaseUrl = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

const UNREACHABLE = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', '28P01', '28000', '3D000', '57P03', '53300']);

async function q(text, params = []) {
  try {
    if (!run) {
      const { default: pg } = await import('pg');
      const pool = new pg.Pool({ connectionString: databaseUrl(), max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 8_000, allowExitOnIdle: true });
      pool.on('error', () => { /* an idle client dropped by the server; the pool replaces it */ });
      run = async (t, p) => { const r = await pool.query(t, p); return { rows: r.rows, rowCount: r.rowCount }; };
    }
    ready ||= run(SCHEMA).catch((e) => { ready = null; throw e; });
    await ready;
    return await run(text, params);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (UNREACHABLE.has(e?.code)) throw new HttpError(503, 'Database unavailable', 'The database did not answer. Check the database connection in the hosting dashboard and try again.');
    throw e;
  }
}

const newTag = () => randomBytes(8).toString('hex');
const toArrayBuffer = (b64) => { const buf = Buffer.from(b64 || '', 'base64'); return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); };
const likePrefix = (p) => `${String(p).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function pgStore(name) {
  return {
    async get(key, { type } = {}) {
      const { rows } = await q(`select value, case when bytes is null then null else encode(bytes, 'base64') end as b64 from ec_kv where store = $1 and key = $2`, [name, key]);
      if (!rows[0]) return null;
      return type === 'arrayBuffer' ? toArrayBuffer(rows[0].b64) : rows[0].value;
    },

    async getWithMetadata(key, { type } = {}) {
      const { rows } = await q(`select value, case when bytes is null then null else encode(bytes, 'base64') end as b64, metadata, etag from ec_kv where store = $1 and key = $2`, [name, key]);
      const r = rows[0];
      if (!r) return null;
      return { data: type === 'arrayBuffer' ? toArrayBuffer(r.b64) : r.value, etag: r.etag, metadata: r.metadata || {} };
    },

    /* one query for many keys (the CRM lists read every record of a kind) */
    async getMany(keys) {
      if (!keys.length) return [];
      const { rows } = await q('select key, value from ec_kv where store = $1 and key in (select jsonb_array_elements_text($2::jsonb))', [name, JSON.stringify(keys)]);
      const byKey = new Map(rows.map((r) => [r.key, r.value]));
      return keys.map((k) => byKey.get(k)).filter((v) => v != null);
    },

    async setJSON(key, value, opts = {}) {
      const tag = newTag();
      const json = JSON.stringify(value);
      if (opts.onlyIfNew) {
        const r = await q('insert into ec_kv (store, key, value, etag) values ($1, $2, $3::jsonb, $4) on conflict (store, key) do nothing', [name, key, json, tag]);
        return { modified: r.rowCount > 0, etag: tag };
      }
      if (opts.onlyIfMatch) {
        const r = await q('update ec_kv set value = $3::jsonb, bytes = null, etag = $4, updated_at = now() where store = $1 and key = $2 and etag = $5', [name, key, json, tag, opts.onlyIfMatch]);
        return { modified: r.rowCount > 0, etag: tag };
      }
      await q(`insert into ec_kv (store, key, value, etag) values ($1, $2, $3::jsonb, $4)
               on conflict (store, key) do update set value = excluded.value, bytes = null, metadata = null, etag = excluded.etag, updated_at = now()`, [name, key, json, tag]);
      return { modified: true, etag: tag };
    },

    /* bytes (uploaded photos) go in base64 and are decoded by Postgres, so no driver-specific binary handling */
    async set(key, data, { metadata } = {}) {
      const tag = newTag();
      const b64 = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data).toString('base64');
      await q(`insert into ec_kv (store, key, bytes, metadata, etag) values ($1, $2, decode($3, 'base64'), $4::jsonb, $5)
               on conflict (store, key) do update set bytes = excluded.bytes, value = null, metadata = excluded.metadata, etag = excluded.etag, updated_at = now()`,
      [name, key, b64, JSON.stringify(metadata || {}), tag]);
      return { modified: true, etag: tag };
    },

    async list({ prefix = '' } = {}) {
      const { rows } = await q(`select key from ec_kv where store = $1 and key like $2 escape '\\' order by key`, [name, likePrefix(prefix)]);
      return { blobs: rows.map((r) => ({ key: r.key })) };
    },

    async delete(key) {
      await q('delete from ec_kv where store = $1 and key = $2', [name, key]);
    }
  };
}
