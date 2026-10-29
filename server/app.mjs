import { createHash } from 'node:crypto';
import { HttpError, json, noContent, problem, readJson, assertSameOrigin, clientIp, invalid } from './http.mjs';
import * as auth from './auth.mjs';
import * as S from './schemas.mjs';
import * as repo from './repo.mjs';
import { store, newId, newRef, rateLimit, audit, storageKind } from './store.mjs';
import * as deals from './deals.mjs';
import * as team from './team.mjs';
import * as service from './service.mjs';
import { logActivity, listActivity, activityPeople } from './activity.mjs';
import { getPolicy, setPolicy, policyPatch } from './policy.mjs';
import { subscribe, publish } from './bus.mjs';
import { recordDemand, demandGaps } from './demand.mjs';
import { buildForecast, calcForecast, forecastCatalog, forecastSuggest } from './forecast.mjs';
import { loadDemo, removeDemo, demoStatus } from './demo.mjs';
import { buildPlan, askPlanner } from './purchasing.mjs';
import * as ai from './concierge-ai.mjs';

/*
 * The whole API (/api/v1/*) as one request handler, so the Netlify Function, the local dev server and the tests all run
 * exactly the same code. Every route declares who may call it; every body and query goes through a schema; every error
 * leaves as an RFC 7807 problem.
 */
const PREFIX = '/api/v1';
const routes = [];
/* who may call what: owner > manager > sales / service. A route with no `roles` is open to any signed-in staff. */
const MGR = ['owner', 'manager'], SALES = ['owner', 'manager', 'sales'], OWNER = ['owner'];

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
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
function id(kind, value) {
  if (!ID[kind].test(value) || RESERVED.has(value)) throw new HttpError(404, 'Not found', 'Nothing here has that id.');
  return value;
}

const quoteTag = (etag) => (etag.startsWith('"') || etag.startsWith('W/') ? etag : `"${etag}"`);

/**
 * Public catalogue reads: the browser always revalidates (cheap 304s thanks to the entity tag); the host's CDN keeps a
 * copy for 30 seconds and may serve it 30 seconds longer while it refreshes, so a CRM change is live within a minute.
 * The tag is the stored document's own, or a hash of the response when the store does not give one.
 */
function cachedJson(req, { etag, body }) {
  const text = JSON.stringify(body);
  const tag = etag ? quoteTag(etag) : `"${createHash('sha1').update(text).digest('base64url')}"`;
  const headers = {
    'cache-control': 'public, max-age=0, must-revalidate',
    'netlify-cdn-cache-control': 'public, s-maxage=30, stale-while-revalidate=30',
    'vercel-cdn-cache-control': 'public, s-maxage=30, stale-while-revalidate=30',
    'x-content-type-options': 'nosniff',
    etag: tag
  };
  const inm = req.headers.get('if-none-match');
  if (inm && inm.split(',').map((s) => s.trim()).includes(tag)) return new Response(null, { status: 304, headers });
  return new Response(text, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

/** A filled-in honeypot means a bot: answer as if it worked and store nothing. */
const isBot = (body) => typeof body?.website === 'string' && body.website.length > 0;

/**
 * The customer behind a session cookie, or null. A session belongs to the account that issued it: if that account was
 * deleted and the email registered again, older sessions do not carry over to the new account.
 */
async function sessionCustomer(req) {
  let s = null;
  try { s = await auth.currentCustomer(req); } catch { return null; }
  const c = s && (await repo.findCustomer(s.sub));
  if (!c || s.iat < Math.floor(Date.parse(c.createdAt) / 1000)) return null;
  return { session: s, customer: c };
}

/* customer session cookies are optional on public forms; a bad, stale or unverifiable cookie is simply ignored */
async function optionalCustomer(req) {
  return (await sessionCustomer(req))?.session || null;
}

function realDate(s) {
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new HttpError(400, 'Invalid request', 'Some fields are missing or not valid.', { fields: { date: 'Choose a real date' } });
}

const LIMITS = {
  staffLogin: { limit: Number(process.env.STAFF_LOGIN_LIMIT) || 8, windowSeconds: 15 * 60 },
  auth: { limit: 10, windowSeconds: 15 * 60 },
  forms: { limit: 20, windowSeconds: 60 * 60 },
  upload: { limit: 120, windowSeconds: 60 * 60 }
};

/* ======================================================================================== public */
on('GET', '/health', async () => {
  let storage = 'ok', imported = null, storageMessage = null;
  try { imported = await repo.importStatus(); } catch (e) { storage = e?.title === 'No database' ? 'missing' : 'unavailable'; storageMessage = e?.detail || null; }
  return {
    status: storage === 'ok' ? 'ok' : 'degraded', version: 'v1', time: new Date().toISOString(),
    storage, storageKind: storageKind(), storageMessage,
    imported: imported && { cars: imported.cars, products: imported.products },
    crm: storage === 'ok' ? await auth.staffConfigured().catch(() => false) : false
  };
});

on('GET', '/stock', async ({ req }) => {
  const res = await repo.publicStock();
  if (!res) throw new HttpError(404, 'Not imported', 'The live stock has not been set up yet; the site uses its built-in copy.');
  return cachedJson(req, res);
});

on('GET', '/ads', async ({ req }) => cachedJson(req, await repo.publicAds()));

on('GET', '/products', async ({ req }) => {
  const res = await repo.publicProducts();
  if (!res) throw new HttpError(404, 'Not imported', 'The live catalogue has not been set up yet; the site uses its built-in copy.');
  return cachedJson(req, res);
});

on('GET', '/promotions', async ({ req }) => {
  const res = await store('system').getWithMetadata('homepage/promotions', { type: 'json' });
  const items = (res?.data?.items || []).filter((p) => p.active).sort((a, b) => a.order - b.order);
  return cachedJson(req, { etag: res?.etag, body: { items } });
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
    'vercel-cdn-cache-control': 'public, s-maxage=31536000, immutable',
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
  const lead = await repo.createLead(parse(S.leadCreate, body), await optionalCustomer(req));
  return json({ ref: lead.ref, status: lead.status, createdAt: lead.createdAt }, lead.duplicate ? 200 : 201);
});

on('POST', '/appointments', async ({ req, ip }) => {
  await rateLimit('forms', ip, LIMITS.forms);
  const body = await readJson(req, 64 * 1024);
  if (isBot(body)) return json({ ref: typeof body.ref === 'string' ? body.ref.slice(0, 16) : newRef('AA'), status: 'requested' }, 201);
  const input = parse(S.appointmentCreate, body);
  realDate(input.date);
  const sess = await sessionCustomer(req);
  /* a booking can name one of the customer's own cars, but only if it really is in their garage */
  if (input.ownedId && !(sess && (await service.ownedFor(sess.customer.id)).some((o) => o.id === input.ownedId))) input.ownedId = null;
  const a = await repo.createAppointment(input, sess?.session || null);
  await service.ensureJob({ ...a, ownedId: input.ownedId || null, pickupAddress: input.pickupAddress || null }).catch((e) => console.error('[job]', e));
  return json({ ref: a.ref, status: a.status, service: a.service, date: a.date, slot: a.slot, createdAt: a.createdAt }, a.duplicate ? 200 : 201);
});

on('POST', '/demand', async ({ req, ip }) => {
  await rateLimit('forms', ip, { limit: 120, windowSeconds: 60 * 60 });
  const body = await readJson(req, 8 * 1024);
  if (isBot(body)) return json({ recorded: false }, 202);
  return json(await recordDemand(parse(S.demandInput, body)), 202);
});

/* the AI concierge: text, voice and a natural spoken answer (needs GEMINI_API_KEY; otherwise the app keeps its on-device concierge) */
on('GET', '/concierge/status', () => ({ ai: ai.aiEnabled(), voice: ai.aiEnabled() }));
async function conciergeTurn(input) {
  const out = await ai.ask(input);
  if (out.noMatch && out.search) recordDemand({ query: out.heard || input.text || '', brand: out.search.brand, body: out.search.body, colour: out.search.colour, yearFrom: out.search.yearFrom, yearTo: out.search.yearTo, source: 'concierge' }).catch(() => {});
  return out;
}
on('POST', '/concierge', async ({ req, ip }) => {
  await rateLimit('concierge', ip, { limit: 40, windowSeconds: 10 * 60 });
  const b = parse(S.conciergeAsk, await readJson(req, 16 * 1024));
  return conciergeTurn({ text: b.text, history: b.history, focus: b.focus });
});
on('POST', '/concierge/voice', async ({ req, ip }) => {
  await rateLimit('concierge-voice', ip, { limit: 25, windowSeconds: 10 * 60 });
  const b = parse(S.conciergeVoice, await readJson(req, 3_200_000));
  return conciergeTurn({ audio: { mime: b.mime.split(';')[0], data: b.audio }, history: b.history, focus: b.focus });
});
on('POST', '/concierge/speak', async ({ req, ip }) => {
  await rateLimit('concierge-speak', ip, { limit: 40, windowSeconds: 10 * 60 });
  const b = parse(S.conciergeSpeak, await readJson(req, 4 * 1024));
  const wav = await ai.speak(b.text);
  return new Response(wav, { status: 200, headers: { 'content-type': 'audio/wav', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
});

on('GET', '/service/catalogue', ({ req }) => cachedJson(req, { body: service.CATALOGUE }));

/* follow a job: its reference and the last four digits of the phone number it was booked with */
on('GET', '/track', async ({ query, ip }) => {
  await rateLimit('track', ip, { limit: 30, windowSeconds: 15 * 60 });
  const q = parse(S.trackQuery, query);
  return { job: service.customerView(await service.trackJob(q.ref, q.phone)) };
});
on('POST', '/track/quote', async ({ req, ip }) => {
  await rateLimit('track', ip, { limit: 30, windowSeconds: 15 * 60 });
  const b = parse(S.quoteDecision, await readJson(req, 8 * 1024));
  const j = await service.trackJob(b.ref || '', b.phone || '');
  return { job: service.customerView(await service.decideQuote(j.id, b.decision, 'the customer')) };
});

/* ---------- customer accounts ---------- */
const publicUser = (c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone || null, createdAt: c.createdAt });
const customerCookie = async (c) => auth.setCookie(auth.CUSTOMER_COOKIE, await auth.signToken({ sub: c.id, role: 'customer', email: c.email }, auth.CUSTOMER_TTL), auth.CUSTOMER_TTL);

on('POST', '/auth/register', async ({ req, ip }) => {
  await rateLimit('auth', ip, LIMITS.auth);
  const input = parse(S.register, await readJson(req, 16 * 1024));
  const cid = auth.customerId(input.email);
  const existing = await repo.findCustomer(cid);
  if (existing?.passwordHash) throw new HttpError(409, 'Account exists', 'There is already an account with this email. Sign in instead.');
  const at = new Date().toISOString();
  /* a customer the team added by hand has no password yet: signing up on the website claims that record */
  const c = { ...(existing || {}), id: cid, name: input.name, email: input.email, phone: input.phone || existing?.phone || null, passwordHash: await auth.hashPassword(input.password), createdAt: existing?.createdAt || at, lastLoginAt: at, ...(existing ? { claimedAt: at } : {}) };
  await repo.saveCustomer(c);
  return json({ user: publicUser(c) }, 201, { 'set-cookie': await customerCookie(c) });
});

on('POST', '/auth/login', async ({ req, ip }) => {
  await rateLimit('auth', ip, LIMITS.auth);
  const input = parse(S.login, await readJson(req, 16 * 1024));
  const c = await repo.findCustomer(auth.customerId(input.email));
  const ok = await auth.verifyPassword(input.password, c?.passwordHash || auth.DUMMY_HASH);   /* same work either way */
  if (!c || !ok) throw new HttpError(401, 'Sign-in failed', 'The email or password is not right.');
  c.lastLoginAt = new Date().toISOString();
  await repo.saveCustomer(c);
  return json({ user: publicUser(c) }, 200, { 'set-cookie': await customerCookie(c) });
});

on('POST', '/auth/logout', async () => noContent({ 'set-cookie': auth.clearCookie(auth.CUSTOMER_COOKIE) }));

async function signedInCustomer(req) {
  const found = await sessionCustomer(req);
  if (!found) throw new HttpError(401, 'Unauthorized', 'Sign in to continue.');
  return found.customer;
}

on('GET', '/auth/me', async ({ req }) => ({ user: publicUser(await signedInCustomer(req)) }));

on('GET', '/auth/appointments', async ({ req }) => {
  const c = await signedInCustomer(req);
  const data = (await repo.appointmentsFor(c.id)).map(({ customerId, ...a }) => a);
  return { data };
});

on('GET', '/auth/jobs', async ({ req }) => {
  const c = await signedInCustomer(req);
  return { data: (await service.customerJobs(c.id)).map(service.customerView) };
});
on('POST', '/auth/jobs/:ref/quote', async ({ req, params }) => {
  const c = await signedInCustomer(req);
  const b = parse(S.quoteDecision, await readJson(req, 8 * 1024));
  const j = (await service.customerJobs(c.id)).find((x) => x.ref === params.ref);
  if (!j) throw new HttpError(404, 'Not found', 'There is no job with that reference on your account.');
  return { job: service.customerView(await service.decideQuote(j.id, b.decision, c.name)) };
});
on('GET', '/auth/garage', async ({ req }) => {
  const c = await signedInCustomer(req);
  const [owned, jobs] = await Promise.all([service.ownedFor(c.id), service.customerJobs(c.id)]);
  return { data: owned.map((o) => service.publicOwned(o, jobs)) };
});
on('POST', '/auth/garage/claim', async ({ req, ip }) => {
  await rateLimit('claim', ip, { limit: 10, windowSeconds: 60 * 60 });
  const c = await signedInCustomer(req);
  const o = await service.claimOwned(parse(S.claimInput, await readJson(req, 4 * 1024)).code, c.id);
  return json({ car: service.publicOwned(o, await service.customerJobs(c.id)) }, 201);
});

/* ======================================================================================== staff */
/* first sign-in (or first setup) on a new site: copy the built-in stock and catalogue into the database */
async function firstImport(origin) {
  try {
    const st = await repo.importStatus();
    const what = [!st.cars && 'cars', !st.products && 'products'].filter(Boolean);
    return { imported: what.length ? await repo.importData({ mode: 'missing', what }, origin) : null, importError: null };
  } catch (e) { return { imported: null, importError: e instanceof HttpError ? e.detail : 'The first import did not finish. Run it again from Settings.' }; }
}

async function signedIn(login, origin, extra = {}) {
  const token = await auth.staffToken(login);
  return json({ email: login.email, expiresAt: new Date(Date.now() + auth.STAFF_TTL * 1000).toISOString(), ...(await firstImport(origin)), ...extra }, 200,
    { 'set-cookie': auth.setCookie(auth.STAFF_COOKIE, token, auth.STAFF_TTL) });
}

on('POST', '/admin/session', async ({ req, ip, origin }) => {
  await rateLimit('staff-login', ip, LIMITS.staffLogin);
  const input = parse(S.staffLogin, await readJson(req, 16 * 1024));
  if ((await auth.staffMode()) === 'setup') throw new HttpError(409, 'Setup needed', 'This CRM has no staff login yet. Create it first.');
  const login = await auth.checkStaffCredentials(input.email, input.password);
  if (!login) {
    await audit('staff.login-failed', {});
    throw new HttpError(401, 'Sign-in failed', 'The email or password is not right.');
  }
  await audit('staff.login', { by: login.email });
  await logActivity({ by: login.email, byName: login.name || login.email, byRole: login.role || 'owner', action: 'auth.login', entity: { type: 'session' }, summary: 'Signed in', ip });
  return signedIn(login, origin, { role: login.role || 'owner', name: login.name || null });
});

/* first visit to /admin/ on a new site: is there a staff login yet? */
on('GET', '/admin/setup', async () => ({ needed: false, defaultLogin: (await auth.staffMode()) === 'default' }));

on('POST', '/admin/setup', async ({ req, ip, origin }) => {
  await rateLimit('staff-login', ip, LIMITS.staffLogin);
  const input = parse(S.staffSetup, await readJson(req, 16 * 1024));
  const login = await auth.createStaffAccount(input.email, input.password);
  await audit('staff.setup', { by: login.email });
  return signedIn(login, origin, { created: true });
});

on('GET', '/admin/account', async ({ staff }) => {
  if (staff.uid) return { email: staff.sub, name: staff.name, role: staff.role, managedBy: 'team', defaultPassword: false };
  const mode = await auth.staffMode();
  const acct = mode === 'stored' ? await auth.storedStaff() : null;
  return { email: staff.sub, managedBy: mode === 'env' ? 'environment' : mode === 'default' ? 'default' : 'crm', defaultPassword: mode === 'default', createdAt: acct?.createdAt || null, passwordChangedAt: acct?.passwordChangedAt || null };
}, { staff: true });

on('POST', '/admin/password', async ({ req, ip, staff }) => {
  await rateLimit('staff-login', ip, LIMITS.staffLogin);
  const input = parse(S.passwordChange, await readJson(req, 16 * 1024));
  if (staff.uid) {
    const m = await team.changeOwnPassword(staff.uid, input.current, input.next);
    await audit('staff.password', { by: staff.sub });
    return json({ changed: true }, 200, { 'set-cookie': auth.setCookie(auth.STAFF_COOKIE, await auth.staffToken({ email: m.email, role: m.role, name: m.name, uid: m.id, v: `u:${m.passwordChangedAt}` }), auth.STAFF_TTL) });
  }
  const login = await auth.changeStaffPassword(input.current, input.next);
  await audit('staff.password', { by: staff.sub });
  /* this session continues with the new password; every other session ends */
  return json({ changed: true }, 200, { 'set-cookie': auth.setCookie(auth.STAFF_COOKIE, await auth.staffToken(login), auth.STAFF_TTL) });
}, { staff: true });

on('GET', '/admin/session', async ({ staff }) => ({ email: staff.sub, name: staff.name, role: staff.role, branch: staff.branch, expiresAt: new Date(staff.exp * 1000).toISOString() }), { staff: true });
on('DELETE', '/admin/session', async ({ req, ip }) => {
  const who = await auth.requireStaff(req).catch(() => null);
  if (who) await logActivity({ by: who.email, byName: who.name, byRole: who.role, action: 'auth.logout', entity: { type: 'session' }, summary: 'Signed out', ip });
  return noContent({ 'set-cookie': auth.clearCookie(auth.STAFF_COOKIE) });
});

on('GET', '/admin/stats', async ({ staff }) => ({ ...(await repo.stats()), health: await deals.health(staff) }), { staff: true });

/* what happened, as it happens: new leads, approvals, workshop updates (server-sent events) */
const visibleTo = (e, staff) => {
  if (e.type === 'approval.requested') return MGR.includes(staff.role);
  if (e.type === 'approval.decided') return MGR.includes(staff.role) || e.to === staff.email;
  if (e.type.startsWith('lead.')) return staff.role !== 'service';
  return true;
};
on('GET', '/admin/events', ({ staff }) => {
  let unsub = null, beat = null;
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(c) {
      const put = (text) => { try { c.enqueue(enc.encode(text)); } catch { /* closed */ } };
      put('retry: 4000\n: connected\n\n');
      unsub = subscribe((e) => { if (visibleTo(e, staff)) put(`data: ${JSON.stringify(e)}\n\n`); });
      beat = setInterval(() => put(': ping\n\n'), 25000);
    },
    cancel() { unsub?.(); clearInterval(beat); }
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' } });
}, { staff: true });

/* ---------- home advertisements and transaction reports ---------- */
on('GET', '/admin/ads', () => repo.listAds(), { staff: true });
on('POST', '/admin/ads', async ({ req }) => json(await repo.addAd(parse(S.adSlide, await readJson(req))), 201), { staff: true });
on('DELETE', '/admin/ads/:id', async ({ params }) => { await repo.removeAd(id('media', params.id)); return noContent(); }, { staff: true });
on('GET', '/admin/transactions', ({ query }) => repo.listTransactions(parse(S.transactionQuery, query)), { staff: true });
on('POST', '/admin/transactions', async ({ req }) => {
  const input = parse(S.transactionCreate, await readJson(req));
  realDate(input.date);
  return json(await repo.createTransaction(input), 201);
}, { staff: true });

/* ---------- inventory ---------- */
on('GET', '/admin/cars', ({ query }) => repo.listCars(parse(S.listQuery, query)), { staff: true });
on('POST', '/admin/cars', async ({ req }) => json(await repo.createCar(parse(S.carCreate, await readJson(req))), 201), { staff: true, roles: SALES });
on('GET', '/admin/cars/:id', ({ params }) => repo.getCar(id('car', params.id)), { staff: true });
on('PATCH', '/admin/cars/:id', async ({ req, params, staff }) => {
  const patch = parse(S.carPatch, await readJson(req));
  if (staff.role === 'sales' && (patch.price !== undefined || patch.hidden !== undefined)) throw new HttpError(403, 'Not allowed', 'Listed prices and visibility are set by a manager.');
  if (patch.sold === true) patch.soldAt = new Date().toISOString();
  return repo.patchCar(id('car', params.id), patch);
}, { staff: true, roles: SALES });
on('DELETE', '/admin/cars/:id', async ({ params }) => { await repo.deleteCar(id('car', params.id)); return noContent(); }, { staff: true, roles: MGR });

/* ---------- wheels and body kits ---------- */
on('GET', '/admin/products', ({ query }) => repo.listProducts(parse(S.listQuery, query)), { staff: true });
on('POST', '/admin/products', async ({ req }) => json(await repo.createProduct(parse(S.productCreate, await readJson(req))), 201), { staff: true, roles: MGR });
on('GET', '/admin/products/:id', ({ params }) => repo.getProduct(id('product', params.id)), { staff: true });
on('PATCH', '/admin/products/:id', async ({ req, params }) => repo.patchProduct(id('product', params.id), parse(S.productPatch, await readJson(req))), { staff: true, roles: MGR });
on('DELETE', '/admin/products/:id', async ({ params }) => { await repo.deleteProduct(id('product', params.id)); return noContent(); }, { staff: true, roles: MGR });

/* ---------- leads: the pipeline, the deal desk, approvals ---------- */
on('GET', '/admin/leads', ({ query, staff }) => deals.listLeadsRich(parse(S.listQuery, query), staff), { staff: true, roles: SALES });
on('POST', '/admin/leads', async ({ req, staff }) => json(await deals.createStaffLead(parse(S.leadStaffCreate, await readJson(req)), staff), 201), { staff: true, roles: SALES });
on('GET', '/admin/leads/:id', ({ params, staff }) => deals.leadDetail(id('record', params.id), staff), { staff: true, roles: SALES });
on('PATCH', '/admin/leads/:id', async ({ req, params, staff }) => {
  await repo.patchLead(id('record', params.id), parse(S.leadPatch, await readJson(req)), staff.sub, staff.email || (String(staff.sub).includes('@') ? staff.sub : null));
  return deals.leadDetail(params.id, staff);
}, { staff: true, roles: SALES });
on('DELETE', '/admin/leads/:id', async ({ params }) => { await repo.deleteLead(id('record', params.id)); return noContent(); }, { staff: true, roles: MGR });
on('POST', '/admin/leads/:id/notes', async ({ req, params, staff }) => json(await repo.addLeadNote(id('record', params.id), parse(S.note, await readJson(req)).text, staff.sub), 201), { staff: true, roles: SALES });
on('POST', '/admin/leads/:id/touch', async ({ req, params, staff }) => { await deals.logTouch(id('record', params.id), parse(S.touchInput, await readJson(req)), staff); return deals.leadDetail(params.id, staff); }, { staff: true, roles: SALES });
on('PUT', '/admin/leads/:id/deal', async ({ req, params, staff }) => deals.saveDeal(id('record', params.id), parse(S.dealInput, await readJson(req)), staff), { staff: true, roles: SALES });
on('POST', '/admin/leads/:id/discount', async ({ req, params, staff }) => deals.decideDiscount(id('record', params.id), parse(S.discountDecision, await readJson(req)), staff), { staff: true, roles: MGR });
on('POST', '/admin/leads/:id/handover', async ({ req, params, staff }) => json(await service.handover(id('record', params.id), parse(S.handoverInput, await readJson(req)), staff), 201), { staff: true, roles: SALES });
on('GET', '/admin/approvals', async () => ({ data: await deals.pendingApprovals() }), { staff: true, roles: MGR });

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
on('POST', '/admin/customers', async ({ req, staff }) => {
  const input = parse(S.customerStaffCreate, await readJson(req, 16 * 1024));
  const cid = auth.customerId(input.email);
  if (await repo.findCustomer(cid)) throw new HttpError(409, 'Customer exists', 'There is already a customer with this email. Search for them in the list.');
  const at = new Date().toISOString();
  return json(await repo.saveCustomer({ id: cid, name: input.name, email: input.email, phone: input.phone || null, passwordHash: null, origin: 'staff', createdBy: staff.email, createdAt: at, lastLoginAt: null }), 201);
}, { staff: true, roles: SALES });
on('GET', '/admin/customers', ({ query }) => repo.listCustomers(parse(S.listQuery, query)), { staff: true });
on('GET', '/admin/customers/:id', async ({ params }) => {
  const c = await repo.getCustomerDetail(id('customer', params.id));
  const [jobs, owned] = await Promise.all([service.customerJobs(c.id), service.ownedFor(c.id)]);
  return { ...c, jobs: jobs.map(service.customerView), owned: owned.map((o) => service.publicOwned(o, jobs)) };
}, { staff: true });
on('DELETE', '/admin/customers/:id', async ({ params }) => { await repo.deleteCustomer(id('customer', params.id)); return noContent(); }, { staff: true, roles: MGR });

/* ---------- the workshop ---------- */
on('GET', '/admin/jobs', ({ query, staff }) => service.listJobs(parse(S.listQuery, query), staff), { staff: true });
on('GET', '/admin/jobs/:id', ({ params }) => service.getJob(id('record', params.id)), { staff: true });
on('PATCH', '/admin/jobs/:id', async ({ req, params, staff }) => service.patchJob(id('record', params.id), parse(S.jobPatch, await readJson(req)), staff), { staff: true });
on('GET', '/admin/owned', ({ query }) => service.listOwned(parse(S.listQuery, query)), { staff: true });

/* ---------- the team and the rules ---------- */
on('GET', '/admin/team', async () => ({ data: await team.listTeam() }), { staff: true, roles: MGR });
on('POST', '/admin/team', async ({ req }) => json(await team.createMember(parse(S.teamCreate, await readJson(req))), 201), { staff: true, roles: OWNER });
on('PATCH', '/admin/team/:id', async ({ req, params, staff }) => team.patchMember(params.id, parse(S.teamPatch, await readJson(req)), staff), { staff: true, roles: OWNER });
on('GET', '/admin/people', async () => ({ data: (await team.listTeam()).filter((m) => m.active !== false).map(({ email, name, role }) => ({ email, name, role })) }), { staff: true });
on('GET', '/admin/policy', async () => getPolicy(), { staff: true });
on('PATCH', '/admin/policy', async ({ req }) => setPolicy(parse(policyPatch, await readJson(req))), { staff: true, roles: OWNER });

on('GET', '/admin/promotions', async () => {
  const data = await store('system').get('homepage/promotions', { type: 'json' });
  return data || { items: [] };
}, { staff: true, roles: MGR });
on('PUT', '/admin/promotions', async ({ req, staff }) => {
  const data = parse(S.promotionsPut, await readJson(req, 128 * 1024));
  data.items.sort((a, b) => a.order - b.order);
  await store('system').setJSON('homepage/promotions', data);
  await audit('promotions.update', { by: staff.sub, count: data.items.length });
  return data;
}, { staff: true, roles: MGR });

/* ---------- activity: who did what ---------- */
on('GET', '/admin/activity', async ({ query, staff }) => {
  const q = parse(S.activityQuery, query);
  if (!MGR.includes(staff.role) || q.mine) q.by = staff.email;
  return { ...(await listActivity(q)), people: MGR.includes(staff.role) ? await activityPeople() : [] };
}, { staff: true });

/* ---------- looking ahead: demand, forecast, purchasing ---------- */
on('GET', '/admin/demand', async ({ query }) => demandGaps({ days: Number(query.days) || 90 }), { staff: true, roles: SALES });
on('GET', '/admin/forecast', async ({ query }) => buildForecast({ horizon: parse(S.forecastQuery, query).horizon }), { staff: true, roles: MGR });
on('GET', '/admin/forecast/catalog', async () => forecastCatalog(), { staff: true, roles: MGR });
on('GET', '/admin/forecast/suggest', async ({ query }) => { const q = parse(S.forecastSuggest, query); return forecastSuggest({ brand: q.brand, model: q.model }); }, { staff: true, roles: MGR });
on('POST', '/admin/forecast/calc', async ({ req }) => { const input = parse(S.forecastCalc, await readJson(req)); return calcForecast(input, await getPolicy()); }, { staff: true, roles: MGR });
on('GET', '/admin/purchasing', async ({ query }) => { const q = parse(S.purchasingQuery, query); return buildPlan({ budget: q.budget, appetite: q.appetite, cover: q.cover }); }, { staff: true, roles: MGR });
/* demo data: a full, realistic showroom to look at every screen with; marked, removable, never on the website */
on('GET', '/admin/demo', async () => demoStatus(), { staff: true, roles: MGR });
on('POST', '/admin/demo/load', async () => { try { return await loadDemo(); } catch (e) { if (e.code === 'no-stock') throw new HttpError(409, 'No stock yet', e.message); throw e; } }, { staff: true, roles: OWNER });
on('POST', '/admin/demo/remove', async () => removeDemo(), { staff: true, roles: OWNER });
on('POST', '/admin/purchasing/ask', async ({ req }) => askPlanner(parse(S.plannerAsk, await readJson(req)).q), { staff: true, roles: MGR });

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
}, { staff: true, roles: OWNER });

on('GET', '/admin/audit', async () => ({ data: await repo.auditLog(80) }), { staff: true, roles: MGR });

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
}, { staff: true, roles: MGR });

/* ======================================================================================== dispatch */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/* every change a named person makes in the CRM is written to the activity log here, so no screen can forget to */
const ENTITY = { cars: 'car', products: 'product', leads: 'lead', appointments: 'appointment', customers: 'customer', jobs: 'job', team: 'team member', policy: 'policy', import: 'data', media: 'photo', password: 'password', owned: 'garage car' };
const SUB = { notes: 'added a note to', touch: 'logged contact on', deal: 'saved the deal on', discount: 'decided the discount on', handover: 'handed over', quote: 'quoted' };
function describe(method, path, params, out) {
  const seg = path.replace(/^\/admin\//, '').split('/').filter(Boolean);
  const type = ENTITY[seg[0]] || seg[0];
  const sub = seg.find((x, i) => i > 0 && SUB[x]);
  const verb = sub ? SUB[sub] : { POST: 'created', PUT: 'updated', PATCH: 'updated', DELETE: 'deleted' }[method];
  const o = out && typeof out === 'object' && !(out instanceof Response) ? out : null;
  const label = o ? o.ref || o.title || o.name || o.email || null : null;
  const id = params.id || o?.id || null;
  return { type, id, label, summary: `${verb[0].toUpperCase()}${verb.slice(1)} ${type}${label ? ` ${label}` : id ? ` ${id}` : ''}` };
}

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
    const staff = r.staff ? await auth.requireStaff(req) : null;
    if (staff && r.roles && !r.roles.includes(staff.role)) throw new HttpError(403, 'Not allowed', 'Your role does not include this. Ask the owner or a manager.');
    const out = await r.handler({ req, url, params, query: Object.fromEntries(url.searchParams), ip: clientIp(req, ctx), origin: url.origin, staff });
    if (staff && MUTATING.has(method) && staff.uid !== undefined) {
      const d = describe(method, path, params, out);
      const dealCh = /\/deal$/.test(path) && out?.deal ? ` (AED ${out.deal.finalPrice ?? '-'}${out.deal.approval?.status === 'pending' ? ', awaiting approval' : ''})` : '';
      logActivity({ by: staff.email, byName: staff.name, byRole: staff.role, action: `${d.type.replace(/\s+/g, '-')}.${method === 'DELETE' ? 'delete' : method === 'POST' ? 'create' : 'update'}`, entity: { type: d.type, id: d.id, label: d.label }, summary: `${d.summary}${dealCh}`, ip: clientIp(req, ctx) });
    }
    const res = out instanceof Response ? out : json(out);
    return req.method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
  } catch (err) {
    if (err instanceof HttpError) return problem(err.status, err.title, err.detail, err.extra);
    console.error('[api]', err);
    return problem(500, 'Server error', 'Something went wrong on our side. Please try again in a moment.');
  }
}
