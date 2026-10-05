import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { HttpError } from './http.mjs';
import { readDoc, updateDoc, writeDoc, listKeys, getMany, getRecord, putRecord, deleteRecord, newId, newRef, store, audit } from './store.mjs';
import { LEAD_STATUSES, APPOINTMENT_STATUSES } from './schemas.mjs';

/*
 * The dealership's data and what the API can do with it. Cars and products are one document each (the public site
 * reads them whole); CRM records are one key each. Nothing here knows about HTTP beyond throwing HttpError.
 */
const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const page = (rows, { limit, offset }) => ({
  data: rows.slice(offset, offset + limit),
  pagination: { total: rows.length, limit, offset, next: offset + limit < rows.length ? offset + limit : null }
});
const isMedia = (u) => typeof u === 'string' && u.startsWith('/api/v1/media/');

/* ======================================================================================== import */
/* the built-in data: bundled with the function where the host allows it (IMPORT_DIR), else read from the site itself */
async function sourceJson(name, origin) {
  if (process.env.IMPORT_DIR) {
    try { return JSON.parse(await readFile(join(process.env.IMPORT_DIR, name), 'utf8')); } catch { /* not bundled: fetch it */ }
  }
  const res = await fetch(new URL(`/data/${name}`, origin));
  if (!res.ok) throw new HttpError(502, 'Import failed', `Could not read /data/${name} from the site (${res.status}).`);
  return res.json();
}

export async function importData({ mode, what }, origin) {
  const done = {};
  if (what.includes('cars')) {
    const has = await readDoc('catalog', 'cars');
    if (!has || mode === 'replace') {
      const stock = await sourceJson('stock.json', origin);
      await writeDoc('catalog', 'cars', { ...stock, cars: stock.cars.map((c) => ({ hidden: false, ...c })), updatedAt: now() });
      done.cars = stock.cars.length;
    } else done.cars = 'kept';
  }
  if (what.includes('products')) {
    const has = await readDoc('catalog', 'products');
    if (!has || mode === 'replace') {
      const products = await sourceJson('products.json', origin);
      await writeDoc('catalog', 'products', products);
      done.products = Object.keys(products).length;
    } else done.products = 'kept';
  }
  await store('system').setJSON('imported', { at: now(), mode, ...done });
  await audit('import', { mode, ...done });
  return done;
}

export async function importStatus() {
  const [cars, products, marker] = await Promise.all([readDoc('catalog', 'cars'), readDoc('catalog', 'products'), store('system').get('imported', { type: 'json' })]);
  return { cars: Boolean(cars), products: Boolean(products), last: marker || null };
}

/* ======================================================================================== cars */
/*
 * Imported cars have a self-hosted copy of their first photo (/stock/<id>.webp) that the site prefers. `thumb` tells it
 * to use the CRM's cover instead: for an uploaded photo, a cover changed in the CRM, or a car added in the CRM.
 */
export const ownCover = (c) => Boolean(c.cover) && (isMedia(c.cover) || c.customCover || c.id >= 900000);
const publicCar = (c) => {
  const { hidden, customCover, ...rest } = c;
  return ownCover(c) ? { ...rest, thumb: c.cover } : rest;
};

export async function publicStock() {
  const doc = await readDoc('catalog', 'cars');
  if (!doc) return null;
  return { etag: doc.etag, body: { ...doc.data, cars: doc.data.cars.filter((c) => !c.hidden).map(publicCar) } };
}

const carStatus = (c) => (c.hidden ? 'hidden' : c.sold ? 'sold' : 'sale');

export async function listCars(q) {
  const doc = await readDoc('catalog', 'cars');
  if (!doc) return { ...page([], q), imported: false };
  const terms = norm(q.q).split(/\s+/).filter(Boolean);
  let rows = doc.data.cars.filter((c) => {
    if (q.make && c.brand !== q.make) return false;
    if (q.status) {
      if (q.status === 'featured' ? !c.featured : q.status === 'new' ? !c.newArrival : carStatus(c) !== q.status) return false;
    }
    if (!terms.length) return true;
    const hay = norm(`${c.title} ${c.brand} ${c.model} ${c.year} ${c.exterior} ${c.interior} ${c.id}`);
    return terms.every((t) => hay.includes(t));
  });
  const sorts = {
    newest: (a, b) => String(b.listedAt || '').localeCompare(String(a.listedAt || '')) || b.id - a.id,
    oldest: (a, b) => String(a.listedAt || '').localeCompare(String(b.listedAt || '')) || a.id - b.id,
    price: (a, b) => (b.price ?? -1) - (a.price ?? -1),
    year: (a, b) => (b.year || 0) - (a.year || 0),
    title: (a, b) => a.title.localeCompare(b.title)
  };
  rows = rows.sort(sorts[q.sort] || sorts.newest);
  const makes = [...new Set(doc.data.cars.map((c) => c.brand))].sort();
  return { ...page(rows, q), makes, imported: true };
}

export async function getCar(id) {
  const doc = await readDoc('catalog', 'cars');
  const car = doc?.data.cars.find((c) => String(c.id) === String(id));
  if (!car) throw new HttpError(404, 'Not found', 'There is no car with that id.');
  return car;
}

export async function createCar(input) {
  let created;
  await updateDoc('catalog', 'cars', (doc) => {
    const id = Math.max(900000, ...doc.cars.map((c) => +c.id || 0)) + 1;
    created = {
      id, model: null, km: null, price: null, engine: null, hp: null, cylinders: null, transmission: null, body: null, exterior: null, interior: null, doors: null,
      region: null, warranty: null, description: null, subtitle: null, newArrival: false, featured: false, sold: false, hidden: false, video: null, cover: null, gallery: [], url: null,
      ...input, listedAt: now(), updatedAt: now()
    };
    if (!doc.brands?.some((b) => b.name === created.brand)) doc.brands = [...(doc.brands || []), { name: created.brand, logo: null }];
    doc.cars.unshift(created);
    doc.updatedAt = now();
    return doc;
  });
  await audit('car.create', { id: created.id });
  return created;
}

export async function patchCar(id, patch) {
  let updated;
  await updateDoc('catalog', 'cars', (doc) => {
    const i = doc.cars.findIndex((c) => String(c.id) === String(id));
    if (i < 0) throw new HttpError(404, 'Not found', 'There is no car with that id.');
    updated = { ...doc.cars[i], ...patch, updatedAt: now() };
    if (patch.cover === undefined && patch.gallery?.length && !updated.cover) updated.cover = patch.gallery[0];
    if (updated.cover !== doc.cars[i].cover) updated.customCover = true;
    doc.cars[i] = updated;
    if (patch.brand && !doc.brands?.some((b) => b.name === patch.brand)) doc.brands = [...(doc.brands || []), { name: patch.brand, logo: null }];
    doc.updatedAt = now();
    return doc;
  });
  await audit('car.update', { id, fields: Object.keys(patch) });
  return updated;
}

export async function deleteCar(id) {
  await updateDoc('catalog', 'cars', (doc) => {
    const before = doc.cars.length;
    doc.cars = doc.cars.filter((c) => String(c.id) !== String(id));
    if (doc.cars.length === before) throw new HttpError(404, 'Not found', 'There is no car with that id.');
    doc.updatedAt = now();
    return doc;
  });
  await audit('car.delete', { id });
}

/* ======================================================================================== products */
export async function publicProducts() {
  const doc = await readDoc('catalog', 'products');
  return doc ? { etag: doc.etag, body: doc.data } : null;
}

export async function listProducts(q) {
  const doc = await readDoc('catalog', 'products');
  if (!doc) return { ...page([], q), imported: false };
  const terms = norm(q.q).split(/\s+/).filter(Boolean);
  let rows = Object.values(doc.data).filter((p) => {
    if (q.category && p.category !== q.category) return false;
    if (q.status === 'available' && p.available === false) return false;
    if (q.status === 'unavailable' && p.available !== false) return false;
    if (q.make && !norm(p.fitment).includes(norm(q.make))) return false;
    if (!terms.length) return true;
    const hay = norm(`${p.title} ${p.vendor} ${p.sku} ${p.fitment} ${p.subtype || ''} ${p.design || ''}`);
    return terms.every((t) => hay.includes(t));
  });
  const sorts = {
    price: (a, b) => (b.priceAED ?? -1) - (a.priceAED ?? -1),
    cheapest: (a, b) => (a.priceAED ?? 1e12) - (b.priceAED ?? 1e12),
    title: (a, b) => a.title.localeCompare(b.title),
    newest: (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || a.title.localeCompare(b.title)
  };
  rows = rows.sort(sorts[q.sort] || sorts.newest);
  const vendors = [...new Set(Object.values(doc.data).map((p) => p.vendor))].sort();
  return { ...page(rows, q), vendors, imported: true };
}

/* the catalogue is a plain object keyed by product id: only its own keys are products ("constructor" is not) */
const ownKey = (obj, id) => Boolean(obj) && Object.hasOwn(obj, id);

export async function getProduct(id) {
  const doc = await readDoc('catalog', 'products');
  const p = ownKey(doc?.data, id) ? doc.data[id] : null;
  if (!p) throw new HttpError(404, 'Not found', 'There is no product with that id.');
  return p;
}

const slugify = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export async function createProduct(input) {
  let created;
  await updateDoc('catalog', 'products', (doc) => {
    const id = `crm:${slugify(`${input.vendor} ${input.title}`)}-${randomBytes(2).toString('hex')}`;
    created = { id, source: 'crm', sku: null, url: null, priceAED: null, available: true, images: [], fitment: '', fits: [], ...input, updatedAt: now() };
    doc[id] = created;
    return doc;
  });
  await audit('product.create', { id: created.id });
  return created;
}

export async function patchProduct(id, patch) {
  let updated;
  await updateDoc('catalog', 'products', (doc) => {
    if (!ownKey(doc, id)) throw new HttpError(404, 'Not found', 'There is no product with that id.');
    updated = { ...doc[id], ...patch, id, updatedAt: now() };
    if (patch.spec && doc[id].spec) updated.spec = { ...doc[id].spec, ...patch.spec };   /* keep fields the editor does not show */
    doc[id] = updated;
    return doc;
  });
  await audit('product.update', { id, fields: Object.keys(patch) });
  return updated;
}

export async function deleteProduct(id) {
  await updateDoc('catalog', 'products', (doc) => {
    if (!ownKey(doc, id)) throw new HttpError(404, 'Not found', 'There is no product with that id.');
    delete doc[id];
    return doc;
  });
  await audit('product.delete', { id });
}

/* ======================================================================================== leads */
/**
 * Write a lead or booking exactly once per reference (EX-…, AA-…). The reference is claimed first (onlyIfNew); a phone
 * that sends the same request again (a retry after a dropped connection, the offline outbox) gets the first record back.
 * If an earlier attempt claimed the reference but never wrote the record (it failed in between), this one writes it
 * under the claimed id, so a retry can never be answered "received" while nothing is stored.
 */
async function createOnce(kind, record) {
  const refKey = `${kind}-refs/${record.ref}`;
  let known = await getRecord('crm', refKey);
  if (!known) {
    const res = await store('crm').setJSON(refKey, { id: record.id }, { onlyIfNew: true });
    if (res?.modified === false) known = await getRecord('crm', refKey);
  }
  if (known && known.id !== record.id) {
    const existing = await getRecord('crm', `${kind}s/${known.id}`);
    if (existing) return { ...existing, duplicate: true };
    record = { ...record, id: known.id };
  }
  await putRecord('crm', `${kind}s/${record.id}`, record);
  return record;
}

export async function createLead(input, customer) {
  const { website, ref, ...data } = input;
  const at = now();
  return createOnce('lead', {
    id: newId(), ref: ref || newRef('EX'), status: 'new', ...data,
    value: data.configuration?.total ?? null,
    customerId: customer?.sub || null,
    notes: [], history: [{ at, status: 'new' }], createdAt: at, updatedAt: at
  });
}

async function all(prefix) {
  return getMany('crm', await listKeys('crm', prefix));
}

export async function listLeads(q) {
  const terms = norm(q.q).split(/\s+/).filter(Boolean);
  const rows = (await all('leads/')).filter((l) => {
    if (q.status && l.status !== q.status) return false;
    if (!terms.length) return true;
    const hay = norm(`${l.ref} ${l.name} ${l.phone} ${l.email} ${l.car?.title} ${l.message}`);
    return terms.every((t) => hay.includes(t));
  });
  return page(rows, q);
}

export async function getLead(id) {
  const l = await getRecord('crm', `leads/${id}`);
  if (!l) throw new HttpError(404, 'Not found', 'There is no lead with that id.');
  return l;
}

/* record edits go through updateDoc too, so two people annotating the same lead never overwrite each other */
const editRecord = (key, what, fn) => updateDoc('crm', key, fn, { missing: () => new HttpError(404, 'Not found', `There is no ${what} with that id.`) });

export function patchLead(id, patch, by) {
  return editRecord(`leads/${id}`, 'lead', (l) => {
    const at = now();
    const next = { ...l, ...patch, updatedAt: at };
    if (patch.status && patch.status !== l.status) next.history = [...(l.history || []), { at, status: patch.status, by }];
    return next;
  });
}

export function addLeadNote(id, text, by) {
  return editRecord(`leads/${id}`, 'lead', (l) => ({ ...l, notes: [...(l.notes || []), { at: now(), by, text }], updatedAt: now() }));
}

export async function deleteLead(id) {
  const l = await getLead(id);
  await deleteRecord('crm', `leads/${id}`);
  await deleteRecord('crm', `lead-refs/${l.ref}`);
  await audit('lead.delete', { id });
}

/* ======================================================================================== appointments */
export async function createAppointment(input, customer) {
  const { website, ref, ...data } = input;
  const at = now();
  return createOnce('appointment', { id: newId(), ref: ref || newRef('AA'), status: 'requested', ...data, customerId: customer?.sub || null, staffNotes: [], history: [{ at, status: 'requested' }], createdAt: at, updatedAt: at });
}

export async function listAppointments(q) {
  const terms = norm(q.q).split(/\s+/).filter(Boolean);
  const t = today();
  const rows = (await all('appointments/')).filter((a) => {
    if (q.status === 'upcoming') { if (!(a.date >= t && ['requested', 'confirmed'].includes(a.status))) return false; }
    else if (q.status === 'past') { if (a.date >= t) return false; }
    else if (q.status && a.status !== q.status) return false;
    if (!terms.length) return true;
    const hay = norm(`${a.ref} ${a.name} ${a.phone} ${a.email} ${a.service} ${a.car} ${a.notes}`);
    return terms.every((x) => hay.includes(x));
  }).sort((a, b) => (q.sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : `${a.date} ${a.slot}`.localeCompare(`${b.date} ${b.slot}`)));
  return page(rows, q);
}

export async function getAppointment(id) {
  const a = await getRecord('crm', `appointments/${id}`);
  if (!a) throw new HttpError(404, 'Not found', 'There is no appointment with that id.');
  return a;
}

export function patchAppointment(id, patch, by) {
  return editRecord(`appointments/${id}`, 'appointment', (a) => {
    const at = now();
    const next = { ...a, ...patch, updatedAt: at };
    if (patch.status && patch.status !== a.status) next.history = [...(a.history || []), { at, status: patch.status, by }];
    return next;
  });
}

export function addAppointmentNote(id, text, by) {
  return editRecord(`appointments/${id}`, 'appointment', (a) => ({ ...a, staffNotes: [...(a.staffNotes || []), { at: now(), by, text }], updatedAt: now() }));
}

export async function deleteAppointment(id) {
  const a = await getAppointment(id);
  await deleteRecord('crm', `appointments/${id}`);
  await deleteRecord('crm', `appointment-refs/${a.ref}`);
  await audit('appointment.delete', { id });
}

/**
 * A customer's own bookings, for "My requests" across devices: only those made while signed in to this account.
 * Never matched by email - an address typed into a guest booking proves nothing about who later registers it.
 */
export async function appointmentsFor(customerIdValue) {
  return (await all('appointments/')).filter((a) => a.customerId === customerIdValue)
    .map(({ staffNotes, history, ...a }) => a);
}

/* ======================================================================================== customers */
const publicCustomer = ({ passwordHash, ...c }) => c;

export async function findCustomer(id) {
  return getRecord('crm', `customers/${id}`);
}

export async function saveCustomer(c) {
  await putRecord('crm', `customers/${c.id}`, c);
  return publicCustomer(c);
}

export async function listCustomers(q) {
  const [customers, leads, appts] = await Promise.all([all('customers/'), all('leads/'), all('appointments/')]);
  const terms = norm(q.q).split(/\s+/).filter(Boolean);
  const count = (list, c) => list.filter((x) => x.customerId === c.id || (c.email && x.email === c.email)).length;
  const rows = customers.filter((c) => !terms.length || terms.every((t) => norm(`${c.name} ${c.email} ${c.phone}`).includes(t)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((c) => ({ ...publicCustomer(c), leads: count(leads, c), appointments: count(appts, c) }));
  return page(rows, q);
}

export async function getCustomerDetail(id) {
  const c = await findCustomer(id);
  if (!c) throw new HttpError(404, 'Not found', 'There is no customer with that id.');
  const [leads, appts] = await Promise.all([all('leads/'), all('appointments/')]);
  const mine = (x) => x.customerId === c.id || (c.email && x.email === c.email);
  return { ...publicCustomer(c), leads: leads.filter(mine), appointments: appts.filter(mine) };
}

export async function deleteCustomer(id) {
  if (!(await findCustomer(id))) throw new HttpError(404, 'Not found', 'There is no customer with that id.');
  await deleteRecord('crm', `customers/${id}`);
  await audit('customer.delete', { id });
}

/* ======================================================================================== dashboard */
export async function stats() {
  const [carsDoc, leads, appts, customers, imported] = await Promise.all([
    readDoc('catalog', 'cars'), all('leads/'), all('appointments/'), all('customers/'), importStatus()
  ]);
  const cars = carsDoc?.data.cars || [];
  const sale = cars.filter((c) => !c.sold && !c.hidden);
  const byMake = Object.entries(sale.reduce((m, c) => ({ ...m, [c.brand]: (m[c.brand] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const since = (days) => new Date(Date.now() - days * 864e5).toISOString();
  const leadBy = Object.fromEntries(LEAD_STATUSES.map((s) => [s, leads.filter((l) => l.status === s).length]));
  const apptBy = Object.fromEntries(APPOINTMENT_STATUSES.map((s) => [s, appts.filter((a) => a.status === s).length]));
  const t = today();
  const upcoming = appts.filter((a) => a.date >= t && ['requested', 'confirmed'].includes(a.status)).sort((a, b) => `${a.date} ${a.slot}`.localeCompare(`${b.date} ${b.slot}`));
  const open = leads.filter((l) => !['won', 'lost'].includes(l.status));
  const closed = leadBy.won + leadBy.lost;
  return {
    imported,
    inventory: {
      total: cars.length, forSale: sale.length, sold: cars.filter((c) => c.sold).length, hidden: cars.filter((c) => c.hidden).length,
      featured: sale.filter((c) => c.featured).length, newArrivals: sale.filter((c) => c.newArrival).length,
      listedValue: sale.reduce((s, c) => s + (c.price || 0), 0), priced: sale.filter((c) => c.price).length,
      byMake: byMake.slice(0, 10)
    },
    leads: {
      total: leads.length, byStatus: leadBy, last7: leads.filter((l) => l.createdAt >= since(7)).length,
      pipelineValue: open.reduce((s, l) => s + (l.value || 0), 0), conversion: closed ? leadBy.won / closed : null,
      wonValue: leads.filter((l) => l.status === 'won').reduce((s, l) => s + (l.value || 0), 0),
      perDay: Array.from({ length: 14 }, (_, i) => new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10)).map((d) => leads.filter((l) => l.createdAt.slice(0, 10) === d).length),
      recent: leads.slice(0, 6).map(({ id, ref, name, status, type, car, createdAt, value }) => ({ id, ref, name, status, type, car, createdAt, value }))
    },
    appointments: {
      total: appts.length, byStatus: apptBy, upcoming: upcoming.length, today: appts.filter((a) => a.date === t && a.status !== 'cancelled').length,
      next: upcoming.slice(0, 6).map(({ id, ref, name, service, car, date, slot, status }) => ({ id, ref, name, service, car, date, slot, status }))
    },
    customers: { total: customers.length, last30: customers.filter((c) => c.createdAt >= since(30)).length }
  };
}

/** The newest audit entries (sign-ins, imports, deletions, rate-limit hits) for the CRM's settings page. */
export async function auditLog(limit = 60) {
  const keys = (await listKeys('system', 'audit/')).slice(0, limit);
  return getMany('system', keys);
}

/* ======================================================================================== export */
const cell = (v) => {
  let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;            /* spreadsheet formula injection */
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (cols, rows) => [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');

export async function exportCsv(collection) {
  const max = { limit: 100000, offset: 0 };
  if (collection === 'cars') {
    const { data } = await listCars({ ...max, sort: 'newest' });
    return csv(['id', 'title', 'brand', 'model', 'year', 'km', 'price', 'exterior', 'interior', 'body', 'transmission', 'engine', 'hp', 'region', 'warranty', 'newArrival', 'featured', 'sold', 'hidden', 'listedAt', 'updatedAt'], data);
  }
  if (collection === 'products') {
    const { data } = await listProducts({ ...max, sort: 'title' });
    return csv(['id', 'category', 'subtype', 'vendor', 'title', 'sku', 'priceAED', 'available', 'fitment', 'url'], data);
  }
  if (collection === 'leads') {
    const { data } = await listLeads(max);
    return csv(['ref', 'createdAt', 'status', 'type', 'name', 'phone', 'email', 'carTitle', 'value', 'message'], data.map((l) => ({ ...l, carTitle: l.car?.title })));
  }
  if (collection === 'appointments') {
    const { data } = await listAppointments({ ...max, sort: 'created' });
    return csv(['ref', 'createdAt', 'status', 'service', 'date', 'slot', 'name', 'phone', 'email', 'car', 'notes'], data);
  }
  if (collection === 'customers') {
    const { data } = await listCustomers(max);
    return csv(['name', 'email', 'phone', 'createdAt', 'lastLoginAt', 'leads', 'appointments'], data);
  }
  throw new HttpError(404, 'Not found', 'Unknown export.');
}
