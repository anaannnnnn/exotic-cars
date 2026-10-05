/*
 * Local API server: a filesystem-backed Netlify Blobs server plus the same request handler the Netlify Function runs.
 * Vite proxies /api to it (see vite.config.js), so `npm run dev:api` in one terminal and `npm run dev` in another give
 * the full site and CRM on http://127.0.0.1:5173. Data lives in .netlify/dev-blobs (git-ignored).
 *
 * Sign in to the CRM with ADMIN_EMAIL / ADMIN_PASSWORD from the environment; defaults for local use only are printed
 * at start-up.
 */
import http from 'node:http';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { BlobsServer } from '@netlify/blobs/server';

const PORT = Number(process.env.API_PORT || 8787);
const dir = resolve(process.env.BLOBS_DIR || '.netlify/dev-blobs');
await mkdir(dir, { recursive: true });

const token = randomBytes(16).toString('hex');
const blobs = new BlobsServer({ directory: dir, token, port: 0 });
const { port: blobsPort } = await blobs.start();
const edge = `http://127.0.0.1:${blobsPort}`;
process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ edgeURL: edge, uncachedEdgeURL: edge, token, siteID: 'local-dev' })).toString('base64');

process.env.COOKIE_INSECURE = '1';                 /* plain http on localhost */
process.env.IMPORT_DIR ||= resolve('public/data');
process.env.ADMIN_EMAIL ||= 'admin@exoticcars.local';
if (!process.env.ADMIN_PASSWORD_HASH) process.env.ADMIN_PASSWORD ||= 'showroom-dev';
process.env.SESSION_SECRET ||= randomBytes(32).toString('hex');

const { handle } = await import('../server/app.mjs');

http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const url = `http://${req.headers.host || `127.0.0.1:${PORT}`}${req.url}`;
    const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
    const response = await handle(request, { ip: req.socket.remoteAddress });
    const headers = {};
    response.headers.forEach((v, k) => { headers[k] = v; });
    const cookie = response.headers.getSetCookie?.();
    if (cookie?.length) headers['set-cookie'] = cookie;
    res.writeHead(response.status, headers);
    res.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
  } catch (e) {
    console.error(e);
    res.writeHead(500).end();
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`API on http://127.0.0.1:${PORT}/api/v1  (data in ${dir})`);
  if (process.env.ADMIN_PASSWORD) console.log(`CRM sign-in for local use: ${process.env.ADMIN_EMAIL} / ${process.env.ADMIN_PASSWORD}`);
});
