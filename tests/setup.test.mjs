import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BlobsServer } from '@netlify/blobs/server';

/*
 * Zero-configuration deploy: no ADMIN_* and no SESSION_SECRET. The CRM opens with the built-in admin / admin123 until a
 * password is set; the signing key is generated and kept in the site's store.
 */
const ORIGIN = 'https://new-site.test';
let handle, dir, server;

beforeAll(async () => {
  for (const k of ['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'ADMIN_PASSWORD_HASH', 'SESSION_SECRET']) delete process.env[k];
  dir = await mkdtemp(join(tmpdir(), 'exotic-setup-'));
  server = new BlobsServer({ directory: dir, token: 't' });
  const { port } = await server.start();
  const edge = `http://127.0.0.1:${port}`;
  process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ edgeURL: edge, uncachedEdgeURL: edge, token: 't', siteID: 'new' })).toString('base64');
  process.env.IMPORT_DIR = resolve('public/data');
  ({ handle } = await import('../server/app.mjs'));
}, 30_000);

afterAll(async () => {
  await server?.stop();
  await rm(dir, { recursive: true, force: true });
});

let n = 0;
async function call(method, path, { body, cookie, origin = ORIGIN } = {}) {
  const h = new Headers();
  if (method !== 'GET' && origin) h.set('origin', origin);
  if (cookie) h.set('cookie', cookie);
  if (body !== undefined) h.set('content-type', 'application/json');
  const res = await handle(new Request(`${ORIGIN}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), { ip: `192.0.2.${++n}` });
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  return { status: res.status, data, cookie: (res.headers.getSetCookie?.() || [])[0]?.split(';')[0] };
}

describe('a brand-new site with no settings', () => {
  let owner;

  it('opens with the built-in admin / admin123 login', async () => {
    expect((await call('GET', '/health')).data.crm).toBe(true);
    expect((await call('GET', '/admin/setup')).data).toEqual({ needed: false, defaultLogin: true });
    expect((await call('POST', '/admin/session', { body: { email: 'admin', password: 'wrong' } })).status).toBe(401);
    const r = await call('POST', '/admin/session', { body: { email: 'Admin', password: 'admin123' } });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ email: 'admin', imported: { cars: expect.any(Number) } });
    owner = r.cookie;
    expect((await call('GET', '/admin/account', { cookie: owner })).data).toMatchObject({ managedBy: 'default', defaultPassword: true });
  }, 30_000);

  it('cannot be taken over through the old setup route', async () => {
    const r = await call('POST', '/admin/setup', { body: { email: 'intruder@evil.test', password: 'intruder pass 1' } });
    expect(r.status).toBe(409);
    expect((await call('POST', '/admin/session', { body: { email: 'admin', password: 'admin123' } })).status).toBe(200);
  });

  it('works for customers without SESSION_SECRET', async () => {
    const reg = await call('POST', '/auth/register', { body: { name: 'Buyer', email: 'buyer@example.ae', password: 'long enough pw' } });
    expect(reg.status).toBe(201);
    expect((await call('GET', '/auth/me', { cookie: reg.cookie })).data.user.email).toBe('buyer@example.ae');
  });

  it('switches the default off once a password is set, and ends the other sessions', async () => {
    const other = (await call('POST', '/admin/session', { body: { email: 'admin', password: 'admin123' } })).cookie;
    expect((await call('POST', '/admin/password', { cookie: owner, body: { current: 'nope', next: 'second password 2' } })).status).toBe(400);
    expect((await call('POST', '/admin/password', { cookie: owner, body: { current: 'admin123', next: 'short' } })).status).toBe(400);
    const ok = await call('POST', '/admin/password', { cookie: owner, body: { current: 'admin123', next: 'second password 2' } });
    expect(ok.status).toBe(200);
    owner = ok.cookie;
    expect((await call('GET', '/admin/stats', { cookie: owner })).status).toBe(200);
    expect((await call('GET', '/admin/stats', { cookie: other })).status).toBe(401);
    expect((await call('POST', '/admin/session', { body: { email: 'admin', password: 'admin123' } })).status).toBe(401);
    expect((await call('POST', '/admin/session', { body: { email: 'admin', password: 'second password 2' } })).status).toBe(200);
    expect((await call('GET', '/admin/account', { cookie: owner })).data).toMatchObject({ managedBy: 'crm', defaultPassword: false });
    expect((await call('GET', '/admin/setup')).data.defaultLogin).toBe(false);
  });

  it('lets environment variables take over (recovery for a forgotten password)', async () => {
    process.env.ADMIN_EMAIL = 'rescue@dealer.test';
    process.env.ADMIN_PASSWORD = 'rescue password 9';
    try {
      expect((await call('GET', '/admin/stats', { cookie: owner })).status).toBe(401);
      const r = await call('POST', '/admin/session', { body: { email: 'rescue@dealer.test', password: 'rescue password 9' } });
      expect(r.status).toBe(200);
      expect((await call('GET', '/admin/account', { cookie: r.cookie })).data.managedBy).toBe('environment');
    } finally {
      delete process.env.ADMIN_EMAIL;
      delete process.env.ADMIN_PASSWORD;
    }
  });
});
