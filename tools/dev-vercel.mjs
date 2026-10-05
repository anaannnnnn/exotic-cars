/*
 * Local stand-in for a Vercel deploy: serves the built site (dist/) and sends /api/v1/<path> to api/index.js the way
 * vercel.json rewrites it (as /api?__path=<path>&<query>, the case where the function sees the rewritten URL).
 * Storage: an in-memory Postgres (PGlite), or a real one with DATABASE_URL; NO_DB=1 shows the "no database" state.
 *   npm run build && npm run dev:vercel      ->  http://127.0.0.1:4300
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
process.env.VERCEL = '1';
process.env.COOKIE_INSECURE = '1';
if (process.env.NO_DB) delete process.env.DATABASE_URL;
else if (!process.env.DATABASE_URL) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.query('select 1');
  const { useSqlStore } = await import('../server/store.mjs');
  useSqlStore(async (t, p) => { const r = await db.query(t, p); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; });
}
const fn = await import('../api/index.js');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff' };
http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname.startsWith('/api/v1/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const rewritten = new URL(`http://${req.headers.host}/api`);
    rewritten.searchParams.set('__path', u.pathname.slice('/api/v1/'.length));
    u.searchParams.forEach((v, k) => rewritten.searchParams.append(k, v));
    const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    headers.set('x-real-ip', '127.0.0.1'); headers.set('x-forwarded-host', req.headers.host); headers.set('x-forwarded-proto', 'http');
    const r = await fn[req.method](new Request(rewritten, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }));
    const out = {}; r.headers.forEach((v, k) => { out[k] = v; }); const sc = r.headers.getSetCookie(); if (sc.length) out['set-cookie'] = sc;
    res.writeHead(r.status, out); res.end(r.body ? Buffer.from(await r.arrayBuffer()) : undefined); return;
  }
  let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
  try { const body = await readFile(join('dist', p)); res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>404</h1>'); }
}).listen(Number(process.env.PORT || 4300), '127.0.0.1', () => console.log('vercel-sim ready', process.env.NO_DB ? '(no database)' : '(PGlite)'));
