import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { handle } from '../server/app.mjs';

/*
 * The whole /api/v1 surface on Vercel: vercel.json rewrites /api/v1/<path> to this one function (Node.js runtime,
 * Web-standard handlers), and server/app.mjs routes it - the same code the Netlify Function runs.
 * Storage is the Postgres database Vercel's Neon integration provides (DATABASE_URL); see docs/DEPLOY.md.
 */

/* the built-in stock and catalogue are bundled with this function (vercel.json includeFiles) for the first import */
const bundled = join(process.cwd(), 'public', 'data');
if (!process.env.IMPORT_DIR && existsSync(join(bundled, 'stock.json'))) process.env.IMPORT_DIR = bundled;

/**
 * Rebuild the public request: Vercel may hand the function the rewritten URL (/api?__path=…) or the original one, and
 * may give a path-only URL. Either way server/app.mjs gets https://<public host>/api/v1/<path>?<query>.
 */
async function toPublicRequest(request) {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost';
  const proto = (request.headers.get('x-forwarded-proto') || 'https').split(',')[0].trim();
  const url = new URL(request.url, `${proto}://${host}`);
  if (!url.pathname.startsWith('/api/v1/')) {
    const path = url.searchParams.get('__path') || '';
    url.pathname = `/api/v1/${path.replace(/^\/+/, '')}`;
  }
  url.searchParams.delete('__path');
  const method = request.method;
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();
  return new Request(url, { method, headers: request.headers, body });
}

const serve = async (request) => {
  const req = await toPublicRequest(request);
  return handle(req, { ip: request.headers.get('x-real-ip') || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || undefined });
};

export const GET = serve;
export const HEAD = serve;
export const POST = serve;
export const PUT = serve;
export const PATCH = serve;
export const DELETE = serve;
export const OPTIONS = serve;
