import { createHash } from 'node:crypto';
import { HttpError, json, noContent, problem, readJson, assertSameOrigin, clientIp, invalid } from './http.mjs';
import * as auth from './auth.mjs';
import * as S from './schemas.mjs';
import * as repo from './repo.mjs';
import { store, newId, newRef, rateLimit, audit } from './store.mjs';

/*
 * The whole API (/api/v1/*) as one request handler, so the Netlify Function, the local dev server and the tests all run
 * exactly the same code. Every route declares who may call it; every body and query goes through a schema; every error
 * leaves as an RFC 7807 problem.
 */
const PREFIX = '/api/v1';
const routes = [];

/**
 * on(method, '/admin/cars/:id', handler, { staff: true })
 * Handlers get { req, url, params, query, ip, origin, staff } and return a Response or a plain object (sent as JSON).
 */
function on(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
  routes.push({ method, re, keys, handler, ...opts });
}

/* ---------- small helpers ---------- */
function parse(schema, data) {
  const res = schema.safeParse(data);
  if (!res.success) throw invalid(res.error);
  return res.data;
}

const ID = {
  car: /^\d{1,9}$/,
  product: /^[a-z0-9:_.-]{1,240}$/i,
  record: /^[a-z0-9]{9}-[a-f0-9]{8}$/,
  customer: /^[a-f0-9]{40}$/,
  media: /^[a-z0-9]{9}-[a-f0-9]{8}$/
};
function id(kind, value) {
  if (!ID[kind].test(value)) throw new HttpError(404, 'Not found', 'Nothing here has that id.');
  return value;
}

const quoteTag = (etag) => (etag.startsWith('"') || etag.startsWith('W/') ? etag : `"${etag}"`);

/**
 * Public catalogue reads: the browser always revalidates (cheap 304s thanks to the entity tag); Netlify's CDN keeps a
 * copy for 30 seconds and may serve it 30 seconds longer while it refreshes, so a CRM change is live within a minute.
 * The tag is the stored document's own, or a hash of the response when the store does not give one.
 */
function cachedJson(req, { etag, body }) {
  const text = JSON.stringify(body);
  const tag = etag ? quoteTag(etag) : `"${createHash('sha1').update(text).digest('base64url')}"`;
  const headers = {
    'cache-control': 'public, max-age=0, must-revalidate',
    'netlify-cdn-cache-control': 'public, s-maxage=30, stale-while-revalidate=30',
    'x-content-type-options': 'nosniff',
    etag: tag
  };
  const inm = req.headers.get('if-none-match');
  if (inm && inm.split(',').map((s) => s.trim()).includes(tag)) return new Response(null, { status: 304, headers });
  return new Response(text, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

/** A filled-in honeypot means a bot: answer as if it worked and store nothing. */
const isBot = (body) => typeof body?.website === 'string' && body.website.length > 0;

/* customer session cookies are optional on public forms; a bad or unverifiable cookie is simply ignored */
function optionalCustomer(req) {
  try { return auth.currentCustomer(req); } catch { return null; }
}

function realDate(s) {
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new HttpError(400, 'Invalid request', 'Some fields are missing or not valid.', { fields: { date: 'Choose a real date' } });
}

const LIMITS = {
  staffLogin: { limit: 8, windowSeconds: 15 * 60 },
  auth: { limit: 10, windowSeconds: 15 * 60 },
  forms: { limit: 20, windowSeconds: 60 * 60 },
  upload: { limit: 120, windowSeconds: 60 * 60 }
};

/* ======================================================================================== public */
on('GET', '/health', async () => {
  let storage = 'ok', imported = null;
  try { imported = await repo.importStatus(); } catch { storage = 'unavailable'; }
  return { status: storage === 'ok' ? 'ok' : 'degraded', version: 'v1', time: new Date().toISOString(), storage, imported: imported && { cars: imported.cars, products: imported.products }, crm: auth.staffConfigured() };
});

on('GET', '/stock', async ({ req }) => {
  const res = await repo.publicStock();
  if (!res) throw new HttpError(404, 'Not imported', 'The live stock has not been set up yet; the site uses its built-in copy.');
  return cachedJson(req, res);
});

on('GET', '/products', async ({ req }) => {
  const res = await repo.publicProducts();
  if (!res) throw new HttpError(404, 'Not imported', 'The live catalogue has not been set up yet; the site uses its built-in copy.');
  return cachedJson(req, res);
});

on('GET', '/media/:key', async ({ req, params }) => {
  const key = id('media', params.key);
  const res = await store('media').getWithMetadata(key, { type: 'arrayBuffer' });
  if (!res) throw new HttpError(404, 'Not found', 'There is no photo with that id.');
  const tag = quoteTag(res.etag || key);
  const headers = {
    'content-type': res.metadata?.type || 'application/octet-stream',
    'cache-control': 'public, max-age=31536000, immutable',
    'netlify-cdn-cache-control': 'public, s-maxage=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    etag: tag
  };
  if (req.headers.get('if-none-match') === tag) return new Response(null, { status: 304, headers });
  return new Response(res.data, { status: 200, headers });
});

on('POST', '/leads', async ({ req, ip }) => {
  await rateLimit('forms', ip, LIMITS.forms);
  const body = await readJson(req, 64 * 1024);
  if (isBot(body)) return json({ ref: typeof body.ref === 'string' ? body.ref.slice(0, 16) : newRef('EX'), status: 'new', createdAt: new Date().toISOString() }, 201);
  const lead = await repo.createLead(parse(S.leadCreate, body), optionalCustomer(req));
  return json({ ref: lead.ref, status: lead.status, createdAt: lead.createdAt }, lead.duplicate ? 200 : 201);
});

on('POST', '/appointments', async ({ req, ip }) => {
  await rateLimit('forms', ip, LIMITS.forms);
  const body = await readJson(req, 64 * 1024);
  if (isBot(body)) return json({ ref: typeof body.ref === 'string' ? body.ref.slice(0, 16) : newRef('AA'), status: 'requested' }, 201);
  const input = parse(S.appointmentCreate, body);
  realDate(input.date);
  const a = await repo.createAppointment(input, optionalCustomer(req));
  return json({ ref: a.ref, status: a.status, service: a.service, date: a.date, slot: a.slot, createdAt: a.createdAt }, a.duplicate ? 200 : 201);
});

/* ---------- customer accounts ---------- */
const DUMMY_HASH = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const publicUser = (c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone || null, createdAt: c.createdAt });
const customerCookie = (c) => auth.setCookie(auth.CUSTOMER_COOKIE, auth.signToken({ sub: c.id, role: 'customer', email: c.email }, auth.CUSTOMER_TTL), auth.CUSTOMER_TTL);

on('POST', '/auth/register', async ({ req, ip }) => {
  await rateLimit('auth', ip, LIMITS.auth);
  const input = parse(S.register, await readJson(req, 16 * 1024));
  const cid = auth.customerId(input.email);
  if (await repo.findCustomer(cid)) throw new HttpError(409, 'Account exists', 'There is already an account with this email. Sign in instead.');
  const at = new Date().toISOString();
  const c = { id: cid, name: input.name, email: input.email, phone: input.phone || null, passwordHash: await auth.hashPassword(input.password), createdAt: at, lastLoginAt: at };
  await repo.saveCustomer(c);
  return json({ user: publicUser(c) }, 201, { 'set-cookie': customerCookie(c) });
});

on('POST', '/auth/login', async ({ req, ip }) => {
  await rateLimit('auth', ip, LIMITS.auth);
  const input = parse(S.login, await readJson(req, 16 * 1024));
  const c = await repo.findCustomer(auth.customerId(input.email));
  const ok = await auth.verifyPassword(input.password, c?.passwordHash || DUMMY_HASH);   /* same work either way */
  if (!c || !ok) throw new HttpError(401, 'Sign-in failed', 'The email or password is not right.');
  c.lastLoginAt = new Date().toISOString();
  await repo.saveCustomer(c);
  return json({ user: publicUser(c) }, 200, { 'set-cookie': customerCookie(c) });
});

on('POST', '/auth/logout', async () => noContent({ 'set-cookie': auth.clearCookie(auth.CUSTOMER_COOKIE) }));

async function signedInCustomer(req) {
  const s = auth.currentCustomer(req);
  const c = s && (await repo.findCustomer(s.sub));
  if (!c) throw new HttpError(401, 'Unauthorized', 'Sign in to continue.');
  return c;
}

on('GET', '/auth/me', async ({ req }) => ({ user: publicUser(await signedInCustomer(req)) }));

on('GET', '/auth/appointments', async ({ req }) => {
  const c = await signedInCustomer(req);
  const data = (await repo.appointmentsFor(c.id, c.email)).map(({ customerId, ...a }) => a);
  return { data };
});

/* ======================================================================================== staff */
on('POST', '/admin/session', async ({ req, ip, origin }) => {
  if (!auth.staffConfigured()) throw new HttpError(503, 'Not configured', 'The CRM sign-in is not set up. Add ADMIN_EMAIL, ADMIN_PASSWORD_HASH (or ADMIN_PASSWORD) and SESSION_SECRET to the site’s environment variables, then redeploy.');
  await rateLimit('staff-login', ip, LIMITS.staffLogin);
  const input = parse(S.staffLogin, await readJson(req, 16 * 1024));
  if (!(await auth.checkStaffCredentials(input.email, input.password))) {
    await audit('staff.login-failed', {});
    throw new HttpError(401, 'Sign-in failed', 'The email or password is not right.');
  }
  const email = input.email.trim().toLowerCase();
  const token = auth.signToken({ sub: email, role: 'staff' }, auth.STAFF_TTL);
  await audit('staff.login', { by: email });
  /* first sign-in on a new site: copy the built-in stock and catalogue into the database */
  let imported = null, importError = null;
  try {
    const st = await repo.importStatus();
    const what = [!st.cars && 'cars', !st.products && 'products'].filter(Boolean);
    if (what.length) imported = await repo.importData({ mode: 'missing', what }, origin);
  } catch (e) { importError = e instanceof HttpError ? e.detail : 'The first import did not finish. Run it again from Settings.'; }
  return json({ email, expiresAt: new Date(Date.now() + auth.STAFF_TTL * 1000).toISOString(), imported, importError }, 200, { 'set-cookie': auth.setCookie(auth.STAFF_COOKIE, token, auth.STAFF_TTL) });
});

on('GET', '/admin/session', async ({ staff }) => ({ email: staff.sub, expiresAt: new Date(staff.exp * 1000).toISOString() }), { staff: true });
on('DELETE', '/admin/session', async () => noContent({ 'set-cookie': auth.clearCookie(auth.STAFF_COOKIE) }));

on('GET', '/admin/stats', () => repo.stats(), { staff: true });

/* ---------- inventory ---------- */
on('GET', '/admin/cars', ({ query }) => repo.listCars(parse(S.listQuery, query)), { staff: true });
on('POST', '/admin/cars', async ({ req }) => json(await repo.createCar(parse(S.carCreate, await readJson(req))), 201), { staff: true });
on('GET', '/admin/cars/:id', ({ params }) => repo.getCar(id('car', params.id)), { staff: true });
on('PATCH', '/admin/cars/:id', async ({ req, params }) => repo.patchCar(id('car', params.id), parse(S.carPatch, await readJson(req))), { staff: true });
on('DELETE', '/admin/cars/:id', async ({ params }) => { await repo.deleteCar(id('car', params.id)); return noContent(); }, { staff: true });

/* ---------- wheels and body kits ---------- */
on('GET', '/admin/products', ({ query }) => repo.listProducts(parse(S.listQuery, query)), { staff: true });
on('POST', '/admin/products', async ({ req }) => json(await repo.createProduct(parse(S.productCreate, await readJson(req))), 201), { staff: true });
on('GET', '/admin/products/:id', ({ params }) => repo.getProduct(id('product', params.id)), { staff: true });
on('PATCH', '/admin/products/:id', async ({ req, params }) => repo.patchProduct(id('product', params.id), parse(S.productPatch, await readJson(req))), { staff: true });
on('DELETE', '/admin/products/:id', async ({ params }) => { await repo.deleteProduct(id('product', params.id)); return noContent(); }, { staff: true });

/* ---------- leads ---------- */
on('GET', '/admin/leads', ({ query }) => repo.listLeads(parse(S.listQuery, query)), { staff: true });
on('GET', '/admin/leads/:id', ({ params }) => repo.getLead(id('record', params.id)), { staff: true });
on('PATCH', '/admin/leads/:id', async ({ req, params, staff }) => repo.patchLead(id('record', params.id), parse(S.leadPatch, await readJson(req)), staff.sub), { staff: true });
on('DELETE', '/admin/leads/:id', async ({ params }) => { await repo.deleteLead(id('record', params.id)); return noContent(); }, { staff: true });
on('POST', '/admin/leads/:id/notes', async ({ req, params, staff }) => json(await repo.addLeadNote(id('record', params.id), parse(S.note, await readJson(req)).text, staff.sub), 201), { staff: true });

/* ---------- appointments ---------- */
on('GET', '/admin/appointments', ({ query }) => repo.listAppointments(parse(S.listQuery, query)), { staff: true });
on('GET', '/admin/appointments/:id', ({ params }) => repo.getAppointment(id('record', params.id)), { staff: true });
on('PATCH', '/admin/appointments/:id', async ({ req, params, staff }) => {
  const patch = parse(S.appointmentPatch, await readJson(req));
  if (patch.date) realDate(patch.date);
  return repo.patchAppointment(id('record', params.id), patch, staff.sub);
}, { staff: true });
on('DELETE', '/admin/appointments/:id', async ({ params }) => { await repo.deleteAppointment(id('record', params.id)); return noContent(); }, { staff: true });
on('POST', '/admin/appointments/:id/notes', async ({ req, params, staff }) => json(await repo.addAppointmentNote(id('record', params.id), parse(S.note, await readJson(req)).text, staff.sub), 201), { staff: true });

/* ---------- customers ---------- */
on('GET', '/admin/customers', ({ query }) => repo.listCustomers(parse(S.listQuery, query)), { staff: true });
on('GET', '/admin/customers/:id', ({ params }) => repo.getCustomerDetail(id('customer', params.id)), { staff: true });
on('DELETE', '/admin/customers/:id', async ({ params }) => { await repo.deleteCustomer(id('customer', params.id)); return noContent(); }, { staff: true });

/* ---------- photos ---------- */
const MAX_PHOTO = 4 * 1024 * 1024;
function sniffImage(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

on('POST', '/admin/media', async ({ req, ip, staff }) => {
  await rateLimit('upload', ip, LIMITS.upload);
  if (Number(req.headers.get('content-length') || 0) > MAX_PHOTO) throw new HttpError(413, 'Payload too large', 'Photos must be under 4 MB.');
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.length > MAX_PHOTO) throw new HttpError(413, 'Payload too large', 'Photos must be under 4 MB.');
  const type = sniffImage(buf);
  if (!type) throw new HttpError(415, 'Unsupported media type', 'Upload a JPEG, PNG or WebP photo.');
  const key = newId();
  await store('media').set(key, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), { metadata: { type, size: buf.length, at: new Date().toISOString(), by: staff.sub } });
  return json({ url: `${PREFIX}/media/${key}`, type, size: buf.length }, 201);
}, { staff: true });

/* ---------- data ---------- */
on('GET', '/admin/import', () => repo.importStatus(), { staff: true });
on('POST', '/admin/import', async ({ req, origin, staff }) => {
  const input = parse(S.importBody, await readJson(req, 4 * 1024));
  const done = await repo.importData(input, origin);
  await audit('import.manual', { by: staff.sub, mode: input.mode });
  return { done, status: await repo.importStatus() };
}, { staff: true });

on('GET', '/admin/audit', async () => ({ data: await repo.auditLog(80) }), { staff: true });

const EXPORTS = ['cars', 'products', 'leads', 'appointments', 'customers'];
on('GET', '/admin/export/:collection', async ({ params, staff }) => {
  if (!EXPORTS.includes(params.collection)) throw new HttpError(404, 'Not found', 'Unknown export.');
  const body = await repo.exportCsv(params.collection);
  await audit('export', { by: staff.sub, collection: params.collection });
  return new Response(`﻿${body}`, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="exotic-cars-${params.collection}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}, { staff: true });

/* ======================================================================================== dispatch */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function handle(req, ctx = {}) {
  try {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(PREFIX)) throw new HttpError(404, 'Not found', 'There is nothing at this address.');
    const path = url.pathname.slice(PREFIX.length) || '/';
    const method = req.method === 'HEAD' ? 'GET' : req.method;

    let match = null;
    const allowed = new Set();
    for (const r of routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      allowed.add(r.method);
      if (r.method === method) { match = { r, m }; break; }
    }
    if (!match) {
      if (allowed.size) return problem(405, 'Method not allowed', `Use ${[...allowed].join(', ')} here.`, { allow: [...allowed] });
      throw new HttpError(404, 'Not found', 'There is nothing at this address.');
    }

    if (MUTATING.has(method)) assertSameOrigin(req);
    const { r, m } = match;
    const params = {};
    r.keys.forEach((k, i) => {
      try { params[k] = decodeURIComponent(m[i + 1]); } catch { throw new HttpError(404, 'Not found', 'There is nothing at this address.'); }
    });
    const staff = r.staff ? auth.requireStaff(req) : null;
    const out = await r.handler({ req, url, params, query: Object.fromEntries(url.searchParams), ip: clientIp(req, ctx), origin: url.origin, staff });
    const res = out instanceof Response ? out : json(out);
    return req.method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
  } catch (err) {
    if (err instanceof HttpError) return problem(err.status, err.title, err.detail, err.extra);
    console.error('[api]', err);
    return problem(500, 'Server error', 'Something went wrong on our side. Please try again in a moment.');
  }
}
