import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';

/*
 * API integration tests: the real request handler against real storage - run once on a local Netlify Blobs server
 * (tests/api.test.mjs) and once on Postgres (tests/api.postgres.test.mjs, PGlite). Covers the acceptance criteria in
 * specs/crm-backend_design.md: live edits reach the public endpoints, enquiries and bookings arrive complete, staff
 * routes are closed without a session, nothing private leaks, concurrent edits are not lost.
 */
export function apiSuite(label, { start, stop = async () => {} }) {
const ORIGIN = 'https://showroom.test';
let handle;

beforeAll(async () => {
  await start();
  process.env.IMPORT_DIR = resolve('public/data');
  process.env.ADMIN_EMAIL = 'Sales@ExoticCars.test';
  process.env.ADMIN_PASSWORD = 'correct horse battery staple';
  process.env.SESSION_SECRET = 'x'.repeat(48);
  ({ handle } = await import('../server/app.mjs'));
}, 30_000);

afterAll(() => stop());

it(`runs on ${label}`, async () => {
  const { storageKind } = await import('../server/store.mjs');
  expect(storageKind()).toBe(label === 'Postgres' ? 'postgres' : 'netlify-blobs');
});

let ipSeq = 0;
/** One request through the handler. Mutations carry this site's Origin unless `origin: null`. */
async function call(method, path, { body, cookie, origin = ORIGIN, headers = {}, ip } = {}) {
  const h = new Headers(headers);
  if (origin && method !== 'GET') h.set('origin', origin);
  if (cookie) h.set('cookie', cookie);
  let payload = body;
  if (body !== undefined && !(body instanceof Uint8Array)) { h.set('content-type', 'application/json'); payload = JSON.stringify(body); }
  const res = await handle(new Request(`${ORIGIN}/api/v1${path}`, { method, headers: h, body: payload }), { ip: ip || `10.0.0.${++ipSeq % 250}` });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : type.includes('csv') || type.includes('text') ? await res.text() : null;
  return { status: res.status, headers: res.headers, data, cookie: (res.headers.getSetCookie?.() || [])[0]?.split(';')[0] };
}

let staff;
const asStaff = (method, path, opts = {}) => call(method, path, { ...opts, cookie: staff });

describe('before setup', () => {
  it('reports health and that nothing is imported yet', async () => {
    const r = await call('GET', '/health');
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ status: 'ok', storage: 'ok', crm: true, imported: { cars: false, products: false } });
  });

  it('tells the public site to use its built-in data', async () => {
    const r = await call('GET', '/stock');
    expect(r.status).toBe(404);
    expect(r.headers.get('content-type')).toContain('application/problem+json');
    expect(r.data.title).toBe('Not imported');
  });

  it('closes every staff route without a session', async () => {
    for (const [m, p] of [['GET', '/admin/stats'], ['GET', '/admin/cars'], ['GET', '/admin/leads'], ['GET', '/admin/customers'], ['GET', '/admin/ads'], ['GET', '/admin/transactions'], ['GET', '/admin/export/leads'], ['POST', '/admin/cars'], ['DELETE', '/admin/leads/000000000-00000000']]) {
      const r = await call(m, p, { body: m === 'POST' ? {} : undefined });
      expect(r.status, `${m} ${p}`).toBe(401);
    }
  });

  it('refuses a forged staff cookie', async () => {
    const r = await call('GET', '/admin/stats', { cookie: 'ec_staff=eyJzdWIiOiJ4Iiwicm9sZSI6InN0YWZmIiwiZXhwIjo5OTk5OTk5OTk5fQ.AAAA' });
    expect(r.status).toBe(401);
  });

  it('answers unknown paths and wrong methods properly', async () => {
    expect((await call('GET', '/nope')).status).toBe(404);
    expect((await call('PUT', '/stock', { body: {} })).status).toBe(405);
  });
});

describe('staff sign-in', () => {
  it('rejects a wrong password with a generic message', async () => {
    const r = await call('POST', '/admin/session', { body: { email: 'sales@exoticcars.test', password: 'nope' } });
    expect(r.status).toBe(401);
    expect(r.data.detail).toBe('The email or password is not right.');
    expect(r.cookie).toBeUndefined();
  });

  it('refuses a sign-in from another site', async () => {
    const r = await call('POST', '/admin/session', { origin: 'https://evil.test', body: { email: 'sales@exoticcars.test', password: process.env.ADMIN_PASSWORD } });
    expect(r.status).toBe(403);
  });

  it('signs in (email is case-insensitive), sets a locked-down cookie and imports the site data', async () => {
    const r = await call('POST', '/admin/session', { body: { email: 'sales@exoticcars.test', password: process.env.ADMIN_PASSWORD } });
    expect(r.status).toBe(200);
    const raw = r.headers.getSetCookie()[0];
    expect(raw).toMatch(/^ec_staff=/);
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Strict');
    expect(raw).toContain('Secure');
    expect(r.data.imported).toMatchObject({ cars: expect.any(Number), products: expect.any(Number) });
    staff = r.cookie;
    const me = await asStaff('GET', '/admin/session');
    expect(me.data.email).toBe('sales@exoticcars.test');
  }, 30_000);

  it('counts sign-in attempts sent in parallel', async () => {
    const all = await Promise.all(Array.from({ length: 20 }, () => call('POST', '/admin/session', { ip: '198.51.100.7', body: { email: 'x@y.z', password: 'guess' } })));
    expect(all.filter((r) => r.status === 429).length).toBe(12);
  });

  it('counts an IPv6 client by its /64', async () => {
    let last;
    for (let i = 0; i < 9; i++) last = await call('POST', '/admin/session', { ip: `2001:db8:1:2::${i + 1}`, body: { email: 'x@y.z', password: 'guess' } });
    expect(last.status).toBe(429);
  });

  it('ignores an unrelated cookie that is not URI-encoded', async () => {
    const r = await call('GET', '/admin/session', { cookie: `pct=100%; ${staff}` });
    expect(r.status).toBe(200);
  });

  it('rate-limits repeated failed sign-ins', async () => {
    let last;
    for (let i = 0; i < 9; i++) last = await call('POST', '/admin/session', { ip: '203.0.113.9', body: { email: 'x@y.z', password: 'guess' } });
    expect(last.status).toBe(429);
    expect(Number(last.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('public catalogue', () => {
  it('serves the stock with an entity tag and answers 304 when unchanged', async () => {
    const r = await call('GET', '/stock');
    expect(r.status).toBe(200);
    expect(r.data.cars.length).toBeGreaterThan(100);
    expect(r.data.cars[0]).not.toHaveProperty('hidden');
    const etag = r.headers.get('etag');
    expect(etag).toBeTruthy();
    expect(r.headers.get('netlify-cdn-cache-control')).toContain('s-maxage=30');
    const again = await call('GET', '/stock', { headers: { 'if-none-match': etag } });
    expect(again.status).toBe(304);
  });

  it('serves the wheels and kits', async () => {
    const r = await call('GET', '/products');
    expect(r.status).toBe(200);
    expect(Object.keys(r.data).length).toBeGreaterThan(1000);
  });
});

describe('inventory', () => {
  let carId;
  it('validates a new car field by field without echoing input', async () => {
    const r = await asStaff('POST', '/admin/cars', { body: { title: 'X', year: 1800, cover: 'javascript:alert(1)' } });
    expect(r.status).toBe(400);
    expect(Object.keys(r.data.fields)).toEqual(expect.arrayContaining(['title', 'brand', 'year', 'cover']));
    expect(JSON.stringify(r.data)).not.toContain('javascript:');
  });

  it('adds a car, which the public stock shows', async () => {
    const r = await asStaff('POST', '/admin/cars', { body: { title: '2026 Ferrari 12Cilindri', brand: 'Ferrari', year: 2026, price: 1950000, exterior: 'Rosso Corsa', newArrival: true } });
    expect(r.status).toBe(201);
    expect(r.data.id).toBeGreaterThan(900000);
    carId = r.data.id;
    const pub = await call('GET', '/stock');
    expect(pub.data.cars.find((c) => c.id === carId)).toMatchObject({ title: '2026 Ferrari 12Cilindri', price: 1950000 });
  });

  it('tells the site to use a cover photo changed in the CRM', async () => {
    const { data } = await asStaff('GET', '/admin/cars?limit=1&sort=oldest');
    const car = data.data[0];
    const before = (await call('GET', '/stock')).data.cars.find((c) => c.id === car.id);
    expect(before.thumb).toBeUndefined();   /* imported: the site keeps its self-hosted copy */
    await asStaff('PATCH', `/admin/cars/${car.id}`, { body: { cover: 'https://cdn.example.com/new-cover.jpg' } });
    const after = (await call('GET', '/stock')).data.cars.find((c) => c.id === car.id);
    expect(after.thumb).toBe('https://cdn.example.com/new-cover.jpg');
    expect(after).not.toHaveProperty('customCover');
  });

  it('edits, hides and removes it', async () => {
    const p = await asStaff('PATCH', `/admin/cars/${carId}`, { body: { price: 1890000, hidden: true } });
    expect(p.status).toBe(200);
    expect(p.data.price).toBe(1890000);
    expect(p.data.title).toBe('2026 Ferrari 12Cilindri');   /* a partial update keeps the other fields */
    const pub = await call('GET', '/stock');
    expect(pub.data.cars.some((c) => c.id === carId)).toBe(false);
    const list = await asStaff('GET', '/admin/cars?status=hidden');
    expect(list.data.data.some((c) => c.id === carId)).toBe(true);
    expect((await asStaff('DELETE', `/admin/cars/${carId}`)).status).toBe(204);
    expect((await asStaff('GET', `/admin/cars/${carId}`)).status).toBe(404);
  });

  it('clears a link, keeps long descriptions and accepts photo links with an apostrophe', async () => {
    const { data } = await asStaff('GET', '/admin/cars?limit=1');
    const id = data.data[0].id;
    await asStaff('PATCH', `/admin/cars/${id}`, { body: { video: 'https://video.example.com/x' } });
    const cleared = await asStaff('PATCH', `/admin/cars/${id}`, { body: { video: '' } });
    expect(cleared.status).toBe(200);
    expect(cleared.data.video).toBeNull();
    const long = 'Full service history. '.repeat(500);
    const r = await asStaff('PATCH', `/admin/cars/${id}`, { body: { description: long, gallery: ["https://exoticcars.ae/uploads/cars/rolls-royce-spectre-linea-d'oro/a.jpg"] } });
    expect(r.status).toBe(200);
    expect(r.data.description.length).toBe(long.trim().length);
  });

  it('never repeats a submitted value in a validation message', async () => {
    const r = await call('POST', '/leads', { body: { type: '<img src=x onerror=alert(1)>', name: 'A B', phone: '0501234567', email: 'not-an-email' } });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.data)).not.toContain('img');
    expect(r.data.fields.type).toBe('Choose one of the listed options');
    expect(r.data.fields.email).toBe('Enter a valid email address');
  });

  it('does not lose either of two simultaneous edits', async () => {
    const { data } = await asStaff('GET', '/admin/cars?limit=2');
    const [a, b] = data.data;
    const [ra, rb] = await Promise.all([
      asStaff('PATCH', `/admin/cars/${a.id}`, { body: { warranty: 'Concurrent A' } }),
      asStaff('PATCH', `/admin/cars/${b.id}`, { body: { warranty: 'Concurrent B' } })
    ]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    expect((await asStaff('GET', `/admin/cars/${a.id}`)).data.warranty).toBe('Concurrent A');
    expect((await asStaff('GET', `/admin/cars/${b.id}`)).data.warranty).toBe('Concurrent B');
  });

  it('filters, searches and pages', async () => {
    const r = await asStaff('GET', '/admin/cars?make=Ferrari&limit=5&offset=0&sort=price');
    expect(r.data.data.length).toBeLessThanOrEqual(5);
    expect(r.data.data.every((c) => c.brand === 'Ferrari')).toBe(true);
    expect(r.data.pagination).toMatchObject({ limit: 5, offset: 0 });
    expect(r.data.makes).toContain('Ferrari');
    expect((await asStaff('GET', '/admin/cars?limit=9999')).status).toBe(400);
  });
});

describe('home advertisements and transaction reports', () => {
  it('adds and removes active home advertisement slides', async () => {
    const created = await asStaff('POST', '/admin/ads', { body: { image: 'https://cdn.example.com/campaign.webp', text: 'Autumn collection', font: 'Michroma', active: true } });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ text: 'Autumn collection', font: 'Michroma', active: true });
    const pub = await call('GET', '/ads');
    expect(pub.status).toBe(200);
    expect(pub.data.some((slide) => slide.id === created.data.id)).toBe(true);
    expect((await asStaff('DELETE', `/admin/ads/${created.data.id}`)).status).toBe(204);
    expect((await call('GET', '/ads')).data.some((slide) => slide.id === created.data.id)).toBe(false);
  });

  it('reports sales and purchases by date, car, brand, and salesperson or seller', async () => {
    const ferrari = await asStaff('POST', '/admin/cars', { body: { title: '2026 Report Ferrari Roma', brand: 'Ferrari', year: 2026, price: 500000 } });
    const lambo = await asStaff('POST', '/admin/cars', { body: { title: '2026 Report Lamborghini Urus', brand: 'Lamborghini', year: 2026, price: 700000 } });
    expect(ferrari.status).toBe(201);
    expect(lambo.status).toBe(201);
    const today = new Date().toISOString().slice(0, 10);
    const [year, month] = today.split('-');
    const invalidDate = await asStaff('POST', '/admin/transactions', { body: { type: 'purchase', carId: ferrari.data.id, amount: 420000, date: '2026-02-31', counterparty: 'Verified Seller' } });
    expect(invalidDate.status).toBe(400);
    const buy = await asStaff('POST', '/admin/transactions', { body: { type: 'purchase', carId: ferrari.data.id, amount: 420000, date: today, counterparty: 'Verified Seller' } });
    const sale = await asStaff('POST', '/admin/transactions', { body: { type: 'sale', carId: ferrari.data.id, amount: 485000, date: today, salesperson: 'Nora' } });
    await asStaff('POST', '/admin/transactions', { body: { type: 'sale', carId: lambo.data.id, amount: 690000, date: today, salesperson: 'Omar' } });
    expect(buy.status).toBe(201);
    expect(sale.status).toBe(201);
    expect((await asStaff('POST', '/admin/transactions', { body: { type: 'sale', carId: ferrari.data.id, amount: 485000, date: today, salesperson: 'Nora' } })).status).toBe(409);

    const sales = await asStaff('GET', `/admin/transactions?type=sale&month=${month}&year=${year}&car=${ferrari.data.id}&brand=Ferrari&salesperson=Nora`);
    expect(sales.status).toBe(200);
    expect(sales.data.report).toMatchObject({ count: 1, amount: 485000 });
    expect(sales.data.data[0]).toMatchObject({ carId: ferrari.data.id, brand: 'Ferrari', salesperson: 'Nora' });

    const purchases = await asStaff('GET', `/admin/transactions?type=purchase&month=${month}&year=${year}&car=${ferrari.data.id}&brand=Ferrari&salesperson=Verified%20Seller`);
    expect(purchases.status).toBe(200);
    expect(purchases.data.report).toMatchObject({ count: 1, amount: 420000 });
    expect(purchases.data.data[0].counterparty).toBe('Verified Seller');
  });
});

describe('products', () => {
  let id;
  it('adds a wheel with its fitment and finish', async () => {
    const r = await asStaff('POST', '/admin/products', { body: { title: 'Forged Monoblock 21/22', vendor: 'Vossen', category: 'wheel', priceAED: 42000, design: 'EVO-5R', fits: ['ferrari-458'], finish: { name: 'Gloss Black', color: '#111111' }, spec: { diameter: 21, diameterRear: 22, pcd: '5x114.3' } } });
    expect(r.status).toBe(201);
    expect(r.data.id).toMatch(/^crm:vossen-forged-monoblock/);
    expect(r.data.finish).toMatchObject({ color: '#111111', metalness: 0.9 });
    id = r.data.id;
    const pub = await call('GET', '/products');
    expect(pub.data[id].fits).toEqual(['ferrari-458']);
  });

  it('re-prices, marks unavailable and removes it', async () => {
    const r = await asStaff('PATCH', `/admin/products/${encodeURIComponent(id)}`, { body: { priceAED: 39900, available: false, spec: { width: 9 } } });
    expect(r.data).toMatchObject({ priceAED: 39900, available: false, spec: { diameter: 21, width: 9 } });
    const list = await asStaff('GET', '/admin/products?status=unavailable&category=wheel');
    expect(list.data.data.some((p) => p.id === id)).toBe(true);
    expect((await asStaff('DELETE', `/admin/products/${encodeURIComponent(id)}`)).status).toBe(204);
    expect((await call('GET', '/products')).data[id]).toBeUndefined();
  });

  it('treats built-in object names as unknown products', async () => {
    for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      expect((await asStaff('GET', `/admin/products/${name}`)).status, name).toBe(404);
      expect((await asStaff('PATCH', `/admin/products/${name}`, { body: { priceAED: 1 } })).status, name).toBe(404);
    }
    expect(Object.keys((await call('GET', '/products')).data)).not.toContain('constructor');
  });

  it('edits an imported product', async () => {
    const { data } = await asStaff('GET', '/admin/products?category=kit&limit=1');
    const p = data.data[0];
    const r = await asStaff('PATCH', `/admin/products/${encodeURIComponent(p.id)}`, { body: { priceAED: 12345 } });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ id: p.id, title: p.title, priceAED: 12345 });
  });
});

describe('enquiries (leads)', () => {
  let leadId, ref;
  const enquiry = {
    type: 'configuration', name: 'Omar Al Mansoori', phone: '+971 50 123 4567', email: 'omar@example.ae', message: 'Can I see it this week?',
    car: { id: 1234, title: '2023 Ferrari 296 GTB' },
    configuration: { paint: 'Rosso Corsa', wheels: [{ id: 'w1', title: 'NOVITEC NF10', qty: 1, price: 81000 }], kits: [{ id: 'k1', title: 'Carbon lip', price: 15000 }], total: 96000, url: 'https://showroom.test/#/car/1234?c=abc' }
  };

  it('accepts a configurator enquiry and returns only a reference', async () => {
    const r = await call('POST', '/leads', { body: enquiry });
    expect(r.status).toBe(201);
    expect(r.data.ref).toMatch(/^EX-[2-9A-HJ-NP-Z]{6}$/);
    expect(Object.keys(r.data).sort()).toEqual(['createdAt', 'ref', 'status']);
    ref = r.data.ref;
  });

  it('accepts a client reference once, so the offline outbox can retry safely', async () => {
    const body = { ...enquiry, ref: 'EX-OFFL1N', name: 'Queued Customer' };
    const a = await call('POST', '/leads', { body });
    const b = await call('POST', '/leads', { body });
    expect([a.status, b.status]).toEqual([201, 200]);
    expect(b.data.ref).toBe('EX-OFFL1N');
    const list = await asStaff('GET', '/admin/leads?q=EX-OFFL1N');
    expect(list.data.pagination.total).toBe(1);
  });

  it('stores a retried enquiry whose first attempt claimed the reference but never saved', async () => {
    const { store } = await import('../server/store.mjs');
    await store('crm').setJSON('lead-refs/EX-HALF01', { id: '0000half0-abcdef01' });   /* the first attempt died here */
    const r = await call('POST', '/leads', { body: { ...enquiry, ref: 'EX-HALF01', name: 'Retried Customer' } });
    expect(r.status).toBe(201);
    const list = await asStaff('GET', '/admin/leads?q=EX-HALF01');
    expect(list.data.data.map((l) => l.name)).toEqual(['Retried Customer']);
  });

  it('quietly drops a bot that fills the hidden field', async () => {
    const r = await call('POST', '/leads', { body: { ...enquiry, name: 'Spam Bot', website: 'http://spam' } });
    expect(r.status).toBe(201);
    const list = await asStaff('GET', '/admin/leads?q=spam%20bot');
    expect(list.data.pagination.total).toBe(0);
  });

  it('refuses an enquiry posted from another site', async () => {
    expect((await call('POST', '/leads', { body: enquiry, origin: 'https://evil.test' })).status).toBe(403);
    expect((await call('POST', '/leads', { body: enquiry, origin: null })).status).toBe(403);
  });

  it('shows the full detail in the CRM', async () => {
    const list = await asStaff('GET', `/admin/leads?q=${ref}`);
    const lead = list.data.data[0];
    expect(lead).toMatchObject({ ref, status: 'new', value: 96000, car: { title: '2023 Ferrari 296 GTB' }, configuration: { paint: 'Rosso Corsa', total: 96000 } });
    expect(lead.configuration.wheels[0].title).toBe('NOVITEC NF10');
    leadId = lead.id;
  });

  it('moves through the pipeline with notes and history', async () => {
    /* a lead cannot be moved on until someone has actually been in touch, and the first stage move claims an unassigned lead */
    const early = await asStaff('PATCH', `/admin/leads/${leadId}`, { body: { status: 'contacted' } });
    expect(early.status).toBe(409);
    expect((await asStaff('POST', `/admin/leads/${leadId}/touch`, { body: { kind: 'call', outcome: 'no-answer' } })).status).toBe(200);
    expect((await asStaff('PATCH', `/admin/leads/${leadId}`, { body: { status: 'contacted' } })).status).toBe(409);
    expect((await asStaff('POST', `/admin/leads/${leadId}/touch`, { body: { kind: 'call', outcome: 'connected' } })).status).toBe(200);
    const p = await asStaff('PATCH', `/admin/leads/${leadId}`, { body: { status: 'qualified' } });
    expect(p.data.status).toBe('qualified');
    expect(p.data.assignee).toBe('sales@exoticcars.test');
    expect(p.data.history.at(-1)).toMatchObject({ status: 'qualified', by: 'sales@exoticcars.test' });
    const n = await asStaff('POST', `/admin/leads/${leadId}/notes`, { body: { text: 'Called, viewing on Thursday.' } });
    expect(n.status).toBe(201);
    expect(n.data.notes[0].text).toBe('Called, viewing on Thursday.');
    expect((await asStaff('PATCH', `/admin/leads/${leadId}`, { body: { status: 'sold-ish' } })).status).toBe(400);
    const stats = await asStaff('GET', '/admin/stats');
    expect(stats.data.leads.byStatus.qualified).toBeGreaterThanOrEqual(1);
    expect(stats.data.leads.perDay).toHaveLength(14);
    expect(stats.data.leads.perDay.at(-1)).toBeGreaterThanOrEqual(1);
    expect(stats.data.inventory.forSale).toBeGreaterThan(100);
  });

  it('exports CSV that cannot run as a spreadsheet formula', async () => {
    await call('POST', '/leads', { body: { name: '=HYPERLINK("http://x")', phone: '0501234567', message: '@SUM(A1)' } });
    const r = await asStaff('GET', '/admin/export/leads');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toMatch(/attachment; filename="exotic-cars-leads-/);
    expect(r.data).toContain(ref);
    expect(r.data).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(r.data).toContain(`'@SUM(A1)`);
    expect(r.data).not.toMatch(/,=HYPERLINK/);
  });

  it('deletes a lead', async () => {
    expect((await asStaff('DELETE', `/admin/leads/${leadId}`)).status).toBe(204);
    expect((await asStaff('GET', `/admin/leads/${leadId}`)).status).toBe(404);
  });
});

describe('bookings (appointments)', () => {
  /* always a week ahead, so the booking stays "upcoming" whenever the suite runs */
  const ahead = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const booking = { ref: 'AA-7K2QD9', service: 'Detailing & ceramic', car: 'Lamborghini Urus', date: ahead, slot: '10:00', name: 'Sara Haddad', phone: '0559876543', notes: 'Pick-up from Marina' };

  it('books once even when the phone retries', async () => {
    const a = await call('POST', '/appointments', { body: booking });
    expect(a.status).toBe(201);
    expect(a.data).toMatchObject({ ref: 'AA-7K2QD9', status: 'requested', date: ahead });
    const b = await call('POST', '/appointments', { body: booking });
    expect(b.status).toBe(200);
    const list = await asStaff('GET', '/admin/appointments?q=AA-7K2QD9');
    expect(list.data.pagination.total).toBe(1);
  });

  it('rejects an impossible date', async () => {
    const r = await call('POST', '/appointments', { body: { ...booking, ref: undefined, date: '2026-02-31' } });
    expect(r.status).toBe(400);
    expect(r.data.fields.date).toBeTruthy();
  });

  it('is confirmed and annotated by staff', async () => {
    const { data } = await asStaff('GET', '/admin/appointments?status=upcoming');
    const appt = data.data.find((x) => x.ref === 'AA-7K2QD9');
    const p = await asStaff('PATCH', `/admin/appointments/${appt.id}`, { body: { status: 'confirmed', slot: '11:30' } });
    expect(p.data).toMatchObject({ status: 'confirmed', slot: '11:30' });
    const n = await asStaff('POST', `/admin/appointments/${appt.id}/notes`, { body: { text: 'Driver booked' } });
    expect(n.data.staffNotes[0].text).toBe('Driver booked');
  });
});

describe('customer accounts', () => {
  let user;
  it('registers, signs in and reads only its own bookings', async () => {
    const reg = await call('POST', '/auth/register', { body: { name: 'Layla Q', email: 'Layla@Example.ae', password: 'long enough pw' } });
    expect(reg.status).toBe(201);
    expect(reg.data.user).toMatchObject({ email: 'layla@example.ae', name: 'Layla Q' });
    expect(reg.data.user).not.toHaveProperty('passwordHash');
    expect((await call('POST', '/auth/register', { body: { name: 'Layla Q', email: 'layla@example.ae', password: 'long enough pw' } })).status).toBe(409);

    const bad = await call('POST', '/auth/login', { body: { email: 'layla@example.ae', password: 'wrong password' } });
    expect(bad.status).toBe(401);
    const login = await call('POST', '/auth/login', { body: { email: 'layla@example.ae', password: 'long enough pw' } });
    expect(login.status).toBe(200);
    user = login.cookie;

    await call('POST', '/appointments', { cookie: user, body: { service: 'Service', date: '2026-11-02', slot: '09:00', name: 'Layla Q', phone: '0501112233' } });
    const mine = await call('GET', '/auth/appointments', { cookie: user });
    expect(mine.data.data.length).toBe(1);
    expect(mine.data.data[0]).not.toHaveProperty('staffNotes');
    expect(mine.data.data[0]).not.toHaveProperty('history');
    expect((await call('GET', '/auth/me', { cookie: user })).data.user.email).toBe('layla@example.ae');
  });

  it('does not hand a guest’s bookings to whoever registers that email later', async () => {
    await call('POST', '/appointments', { body: { service: 'Service', date: '2026-11-03', slot: '10:00', name: 'Real Owner', phone: '0507777777', email: 'victim@example.ae', notes: 'Gate code 4411' } });
    const reg = await call('POST', '/auth/register', { body: { name: 'Squatter', email: 'victim@example.ae', password: 'long enough pw' } });
    expect(reg.status).toBe(201);
    const mine = await call('GET', '/auth/appointments', { cookie: reg.cookie });
    expect(mine.data.data).toEqual([]);
    expect(JSON.stringify(mine.data)).not.toContain('Gate code');
  });

  it('does not carry an old session over to a new account with the same email', async () => {
    const first = await call('POST', '/auth/register', { body: { name: 'First', email: 'reuse@example.ae', password: 'long enough pw' } });
    const { data } = await asStaff('GET', '/admin/customers?q=reuse@example.ae');
    expect((await asStaff('DELETE', `/admin/customers/${data.data[0].id}`)).status).toBe(204);
    await new Promise((r) => setTimeout(r, 1100));   /* the new account is created in a later second */
    const second = await call('POST', '/auth/register', { body: { name: 'Second', email: 'reuse@example.ae', password: 'another long pw' } });
    expect(second.status).toBe(201);
    expect((await call('GET', '/auth/me', { cookie: first.cookie })).status).toBe(401);
    expect((await call('GET', '/auth/me', { cookie: second.cookie })).data.user.name).toBe('Second');
  });

  it('cannot use a customer session on staff routes', async () => {
    expect((await call('GET', '/admin/stats', { cookie: user.replace('ec_user', 'ec_staff') })).status).toBe(401);
  });

  it('appears in the CRM without its password hash, and can be deleted', async () => {
    const list = await asStaff('GET', '/admin/customers');
    const c = list.data.data.find((x) => x.email === 'layla@example.ae');
    expect(c).toMatchObject({ appointments: 1 });
    expect(JSON.stringify(list.data)).not.toContain('scrypt$');
    const detail = await asStaff('GET', `/admin/customers/${c.id}`);
    expect(detail.data.appointments.length).toBe(1);
    expect(detail.data).not.toHaveProperty('passwordHash');
    expect((await asStaff('DELETE', `/admin/customers/${c.id}`)).status).toBe(204);
  });
});

describe('photos', () => {
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

  it('stores an uploaded photo and serves it immutable', async () => {
    const r = await asStaff('POST', '/admin/media', { body: png, headers: { 'content-type': 'image/png' } });
    expect(r.status).toBe(201);
    expect(r.data.url).toMatch(/^\/api\/v1\/media\/[a-z0-9]{9}-[a-f0-9]{8}$/);
    const img = await handle(new Request(`${ORIGIN}${r.data.url}`), {});
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(img.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(png);
  });

  it('refuses anything that is not an image, whatever it claims to be', async () => {
    const html = new TextEncoder().encode('<script>alert(1)</script>');
    const r = await asStaff('POST', '/admin/media', { body: html, headers: { 'content-type': 'image/png' } });
    expect(r.status).toBe(415);
  });

  it('only accepts its own media keys', async () => {
    expect((await call('GET', '/media/..%2Fcrm%2Fleads')).status).toBe(404);
  });
});


describe('demo data, the forecast calculator and the purchasing planner', () => {
  const calc = (o = {}) => asStaff('POST', '/admin/forecast/calc', { body: { history: [4, 5, 6, 5, 7, 8, 6, 5, 7, 9, 10, 12], stock: 10, safety: 2, leadDays: 45, periodDays: 90, price: 1000000, cost: 850000, recon: 15000, discountPct: 2, holdingPct: 0.55, targetMarginPct: 11, month: 9, event: 'none', ...o } });

  it('has demo data off until the owner loads it, and still forecasts from a baseline', async () => {
    expect((await asStaff('GET', '/admin/demo')).data.enabled).toBe(false);
    const f = await asStaff('GET', '/admin/forecast?horizon=6');
    expect(f.status).toBe(200);
    expect(f.data.demo).toBe(false);
    expect(f.data.method).toBe('baseline');
    expect(f.data.months).toHaveLength(6);
  });

  it('loads a realistic demo showroom, and loading again does not duplicate it', async () => {
    const r = await asStaff('POST', '/admin/demo/load');
    expect(r.status).toBe(200);
    expect(r.data.counts.sales).toBeGreaterThan(400);
    expect(r.data.counts.cars).toBeGreaterThan(400);
    expect(r.data.counts.leads).toBeGreaterThan(80);
    const again = await asStaff('POST', '/admin/demo/load');
    expect(again.data.counts).toEqual(r.data.counts);
    const st = (await asStaff('GET', '/admin/demo')).data;
    expect(st.enabled).toBe(true);
    expect(st.counts.sales).toBe(r.data.counts.sales);
    const ledger = (await asStaff('GET', '/admin/transactions?type=sale&limit=500')).data;
    expect(ledger.report.count).toBeGreaterThanOrEqual(r.data.counts.sales);
    expect(ledger.data.some((sale) => sale.demo && sale.amount > 0 && sale.salesperson)).toBe(true);
    expect(ledger.report.byBrand.length).toBeGreaterThan(5);
  });

  it('shows the demo prices on a lead\'s deal desk', async () => {
    const leads = (await asStaff('GET', '/admin/leads?limit=200')).data;
    const rows = (leads.data || leads).filter((l) => l.car?.id).slice(0, 40);
    expect(rows.length).toBeGreaterThan(10);
    let priced = 0;
    for (const row of rows) { const d = await asStaff('GET', `/admin/leads/${row.id}`); if (d.data.carRef?.price > 50000) priced += 1; }
    expect(priced).toBeGreaterThan(rows.length / 2);               /* the demo leads' cars carry a demo price */
  });

  it('forecasts the showroom from a year of sales', async () => {
    const f = (await asStaff('GET', '/admin/forecast?horizon=12')).data;
    expect(f.method).toBe('sales');
    expect(f.demo).toBe(true);
    expect(f.history).toHaveLength(12);
    expect(f.months).toHaveLength(12);
    expect(f.confidence).toBeGreaterThan(0.5);
    for (const m of f.months) { expect(m.winsLo).toBeLessThanOrEqual(m.wins); expect(m.wins).toBeLessThanOrEqual(m.winsHi); expect(m.revenue).toBeGreaterThan(0); }
    expect(f.totals.units12).toBeGreaterThan(250);
    const revs = f.byMake.map((m) => m.revenue); expect(revs).toEqual([...revs].sort((a, b) => b - a));
    expect(f.assumptions.grossMarginPct).toBeGreaterThan(8); expect(f.assumptions.grossMarginPct).toBeLessThan(25);
    expect(f.stages.find((x) => x.status === 'qualified').value).toBeGreaterThan(0);        /* open leads are valued at their car's price */
  });

  it('calculates demand, stock, purchase and profit the way the working says', async () => {
    const r = (await calc()).data, F = r.forecast;
    expect(F.qty).toBeGreaterThan(10);
    expect(F.qtyLo).toBeLessThanOrEqual(F.qty); expect(F.qty).toBeLessThanOrEqual(F.qtyHi);
    expect(r.purchase.qty).toBe(Math.max(0, Math.ceil(F.qty + 2 - 10 - 0.0001)));
    expect(r.stock.reorderPoint).toBe(Math.ceil(r.stock.leadDemand + 2));
    expect(r.money.unitNet).toBe(Math.round(1000000 * 0.98));
    expect(r.money.unitProfit).toBe(Math.round(980000 - 865000));
    expect(r.money.marginPct).toBeCloseTo((115000 / 980000) * 100, 1);
    expect(r.scenarios.worst.profit).toBeLessThanOrEqual(r.scenarios.expected.profit); expect(r.scenarios.expected.profit).toBeLessThanOrEqual(r.scenarios.best.profit);
    expect(r.steps).toHaveLength(6); expect(r.insights.length).toBeGreaterThan(2);
    expect(r.report.history).toHaveLength(12); expect(r.report.months).toHaveLength(3);
  });

  it('moves demand with the season and the period, and warns about running out or overstock', async () => {
    const none = (await calc()).data.forecast.qty, summer = (await calc({ event: 'summer' })).data.forecast.qty, dsf = (await calc({ event: 'dsf' })).data.forecast.qty;
    expect(summer).toBeLessThan(none); expect(dsf).toBeGreaterThan(none);
    expect((await calc({ periodDays: 180 })).data.forecast.qty).toBeGreaterThan(none * 1.6);
    const out = (await calc({ stock: 0, leadDays: 120 })).data;
    expect(out.stock.shortfall).toBeGreaterThan(0.5); expect(out.insights.some((i) => /run out/.test(i.text))).toBe(true); expect(out.money.lostProfit).toBeGreaterThan(0);
    const over = (await calc({ stock: 80 })).data;
    expect(over.purchase.qty).toBe(0); expect(over.insights.some((i) => /No purchase needed/.test(i.text))).toBe(true);
    const thin = (await calc({ cost: 980000, recon: 20000 })).data;
    expect(thin.insights.some((i) => /below your 11% target/.test(i.text))).toBe(true);
  });

  it('refuses nonsense for the calculator', async () => {
    expect((await calc({ history: [] })).status).toBe(400);
    expect((await calc({ price: 0 })).status).toBe(400);
    expect((await calc({ periodDays: 3 })).status).toBe(400);
    expect((await calc({ history: ['x'] })).status).toBe(400);
  });

  it('suggests starting numbers for a make and model', async () => {
    const cat = (await asStaff('GET', '/admin/forecast/catalog')).data;
    expect(cat.makes.length).toBeGreaterThan(5); expect(cat.events.length).toBe(8);
    const top = cat.models.find((m) => m.units12 > 5);
    const sg = (await asStaff('GET', `/admin/forecast/suggest?brand=${encodeURIComponent(top.brand)}&model=${encodeURIComponent(top.model)}`)).data;
    expect(sg.history).toHaveLength(12); expect(sg.history.reduce((a, b) => a + b, 0)).toBe(sg.units12);
    expect(sg.price).toBeGreaterThan(sg.cost); expect(sg.cost).toBeGreaterThan(0);
  });

  it('plans purchases model by model within the budget and every make\'s share of it', async () => {
    const p = (await asStaff('GET', '/admin/purchasing')).data, budget = p.params.budget, cap = (budget * p.params.maxMakeSharePct) / 100;
    expect(p.rows.length).toBeGreaterThan(50);
    expect(p.summary.toBuy).toBeGreaterThan(10);
    const order = { critical: 0, urgent: 1, plan: 2, ok: 3 };
    const ranks = p.rows.map((r) => order[r.urgency]); expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(p.rows.every((r) => !(r.buy > 0 && r.urgency === 'ok'))).toBe(true);
    const lines = p.allocation.lines;
    for (const l of lines) { expect(l.alloc).toBeGreaterThanOrEqual(0); expect(l.alloc).toBeLessThanOrEqual(l.buy); expect(l.deferred).toBe(l.buy - l.alloc); }
    expect(lines.reduce((s, l) => s + l.spend, 0)).toBeLessThanOrEqual(budget);
    const byMake = {}; lines.forEach((l) => { byMake[l.brand] = (byMake[l.brand] || 0) + l.spend; });
    Object.values(byMake).forEach((v) => expect(v).toBeLessThanOrEqual(cap + 1));
    expect(p.rows.some((r) => r.maxBid && r.avgPrice && r.maxBid < r.avgPrice)).toBe(true);
    const top = p.rows.find((r) => r.buy > 0); expect(top.reasons.length).toBeGreaterThan(1); expect(top.roi).toBeGreaterThan(5);
    expect(p.aging.reduce((s, a) => s + a.units, 0)).toBe(p.summary.stockUnits - p.rows.reduce((s, r) => s + 0, 0) + 0 || p.summary.stockUnits);
    expect(p.concentration.reduce((s, c) => s + c.share, 0)).toBeLessThanOrEqual(100.5);
    expect(p.channels.length).toBeGreaterThan(2); expect(p.calendar).toHaveLength(6); expect(p.shopping.length).toBeGreaterThan(0); expect(p.priceBands).toHaveLength(5);
  });

  it('buys more with a bigger budget and a bolder appetite, and less with a smaller one', async () => {
    const at = (q) => asStaff('GET', `/admin/purchasing?${q}`).then((r) => r.data);
    const small = await at('budget=3000000'), big = await at('budget=60000000');
    expect(small.summary.cars).toBeLessThan(big.summary.cars); expect(small.summary.allocated).toBeLessThanOrEqual(3000000);
    const profits = big.allocation.scenarios.map((s) => s.profit); expect(profits).toEqual([...profits].sort((a, b) => a - b));
    const cautious = await at('appetite=cautious'), bold = await at('appetite=bold');
    expect(bold.summary.toBuy).toBeGreaterThanOrEqual(cautious.summary.toBuy);
    expect((await asStaff('GET', '/admin/purchasing?appetite=reckless')).status).toBe(400);
  });

  it('answers plain questions from the plan', async () => {
    for (const q of ['what should I buy this month', 'how much budget do I need', 'which cars are slow', 'where should I source cars', 'how is Ferrari doing', 'how is the Cullinan doing']) {
      const r = await asStaff('POST', '/admin/purchasing/ask', { body: { q } });
      expect(r.status).toBe(200); expect(r.data.text.length).toBeGreaterThan(20);
    }
  });

  it('removes only the demo records, and everything goes back to a baseline', async () => {
    const before = (await asStaff('GET', '/admin/customers?limit=500')).data.pagination.total;
    expect(before).toBeGreaterThan(0);
    const r = await asStaff('POST', '/admin/demo/remove');
    expect(r.status).toBe(200); expect(r.data.removed).toBeGreaterThan(500);
    expect((await asStaff('GET', '/admin/demo')).data.enabled).toBe(false);
    const f = (await asStaff('GET', '/admin/forecast')).data; expect(f.demo).toBe(false); expect(f.method).toBe('baseline');
    const leads = (await asStaff('GET', '/admin/leads?limit=500')).data; expect((leads.data || leads).every((l) => !l.demo)).toBe(true);
    const sg = (await asStaff('GET', '/admin/forecast/suggest?brand=Ferrari')).data; expect(sg.units12).toBe(0);
  });
});

describe('settings', () => {
  it('re-imports on request and keeps an audit trail', async () => {
    const r = await asStaff('POST', '/admin/import', { body: { mode: 'missing' } });
    expect(r.data.done).toEqual({ cars: 'kept', products: 'kept' });
    const log = await asStaff('GET', '/admin/audit');
    const events = log.data.data.map((e) => e.event);
    expect(events).toEqual(expect.arrayContaining(['staff.login', 'staff.login-failed', 'rate-limited', 'import.manual', 'car.delete']));
    expect(JSON.stringify(log.data)).not.toContain(process.env.ADMIN_PASSWORD);
  });

  it('signs out', async () => {
    const r = await asStaff('DELETE', '/admin/session');
    expect(r.status).toBe(204);
    expect(r.headers.getSetCookie()[0]).toContain('Max-Age=0');
  });
});
}
