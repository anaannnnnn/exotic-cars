import { randomBytes } from 'node:crypto';
import { HttpError } from './http.mjs';
import { newId, newRef, readDoc, getRecord, putRecord } from './store.mjs';
import { all, editRecord, now, page, norm, patchCar, getCar, patchAppointment } from './repo.mjs';
import { publish } from './bus.mjs';
import { customerId } from './auth.mjs';
import { findCustomer } from './repo.mjs';

/*
 * After the sale. Every service or repair request becomes a workshop job the customer can follow from their phone:
 * received, inspected, quoted (they approve the quote in the app), in work, checked, ready, delivered. A car sold here is
 * handed over into the buyer's garage with its warranty and next service date, so the service history builds itself.
 */
export const JOB_STATUSES = ['requested', 'scheduled', 'received', 'inspecting', 'quoted', 'approved', 'in-progress', 'qc', 'ready', 'delivered', 'cancelled'];
const APPT_OF = { scheduled: 'confirmed', received: 'confirmed', delivered: 'completed', cancelled: 'cancelled' };
const tail = (s) => String(s || '').replace(/\D/g, '').slice(-4);
const phone9 = (s) => String(s || '').replace(/\D/g, '').slice(-9);

/* what the workshop offers, for the service page and the booking form (prices are quoted per car, never listed) */
export const CATALOGUE = {
  services: [
    { id: 'maintenance', title: 'Scheduled service', turnaround: 'Same day to 2 days', includes: ['Manufacturer-schedule servicing', 'Fluids, filters and brakes checked', 'Full digital health check'], pickup: true },
    { id: 'repair', title: 'Repair & diagnostics', turnaround: 'Diagnosed within 24 hours', includes: ['Fault found and explained before any work', 'Written quote you approve in the app', 'Parts and labour warranty on the repair'], pickup: true },
    { id: 'protection', title: 'Paint protection', turnaround: '2 to 5 days', includes: ['Paint protection film or ceramic coating', 'Paint correction first', 'Care guide and aftercare check'], pickup: true },
    { id: 'detailing', title: 'Detailing', turnaround: 'Same day', includes: ['Hand wash and decontamination', 'Interior deep clean and leather care', 'Optional paint correction'], pickup: true },
    { id: 'wheels', title: 'Wheels & aero', turnaround: '1 to 3 days', includes: ['Forged wheels, tyres and carbon aero parts', 'Fitted, balanced and aligned', 'Fitment checked against your exact car'], pickup: true },
    { id: 'tint', title: 'Window tint', turnaround: 'Same day', includes: ['Heat-rejecting film in road-legal shades', 'Clean installation, no edge lift'], pickup: false },
    { id: 'inspection', title: 'Inspection & valuation', turnaround: 'Same day', includes: ['Detailed inspection report', 'Valuation for sale or part-exchange'], pickup: false }
  ],
  benefits: [
    { id: 'track', title: 'Follow every step', body: 'From check-in to hand-back, see where your car is in the workshop, with a note at each step.' },
    { id: 'quote', title: 'You approve the quote', body: 'Nothing is done to your car beyond the inspection until you approve the written quote in the app.' },
    { id: 'pickup', title: 'Collection and return', body: 'We collect from your home or office and bring the car back, so a service never costs you a morning.' },
    { id: 'courtesy', title: 'Courtesy car', body: 'Ask for a courtesy car for longer jobs, arranged when you book.' },
    { id: 'warranty', title: 'Warranty looked after', body: 'Cars bought here carry their warranty in your garage. We handle the claim with the supplier.' },
    { id: 'history', title: 'A history that follows the car', body: 'Every job is kept in your garage as a service history that raises the car’s value at resale.' }
  ],
  plans: [
    { id: 'essential', title: 'Essential care', blurb: 'The first year, looked after.', includes: ['Scheduled service at the manufacturer interval', 'Digital health check at every visit', 'Service reminders in the app'] },
    { id: 'complete', title: 'Complete care', blurb: 'Everything Essential covers, plus the extras that keep a supercar at its best.', includes: ['Everything in Essential', 'Collection and return', 'Courtesy car on longer jobs', 'Paint protection check every visit'] },
    { id: 'concierge', title: 'Concierge ownership', blurb: 'One number for everything the car needs.', includes: ['Everything in Complete', 'Priority workshop slots', '24/7 recovery arranged for you', 'Detailing before every hand-back'] }
  ]
};

const kindOf = (service) => (/repair|diagnos/i.test(service) ? 'repair' : /protect|ppf|ceramic/i.test(service) ? 'protection' : /detail/i.test(service) ? 'detailing' : /wheel|aero/i.test(service) ? 'wheels' : /tint/i.test(service) ? 'tint' : /inspect|valuat/i.test(service) ? 'inspection' : /warranty/i.test(service) ? 'warranty' : 'maintenance');
const isWorkshop = (service) => !/test drive|call back|consultation|viewing/i.test(service || '');

/* ------------------------------------------------------------------ jobs */
export async function ensureJob(a) {
  if (!isWorkshop(a.service)) return null;
  const exists = (await all('jobs/')).find((j) => j.appointmentId === a.id);
  if (exists) return exists;
  const at = now();
  const job = {
    id: newId(), ref: a.ref, appointmentId: a.id, customerId: a.customerId || null, ownedId: a.ownedId || null, name: a.name, phone: a.phone, email: a.email || null,
    vehicle: a.car || null, kind: kindOf(a.service), title: a.service, description: a.notes || null, date: a.date, slot: a.slot,
    status: 'requested', timeline: [{ at, status: 'requested', by: null, note: 'Request received' }], quote: null, eta: null, assignee: null, branch: a.branch || 'dubai',
    pickup: { needed: /collect|pick.?up/i.test(a.notes || '') || Boolean(a.pickupAddress), address: a.pickupAddress || null }, courtesy: false, warranty: { covered: false }, invoice: null, createdAt: at, updatedAt: at
  };
  await putRecord('crm', `jobs/${job.id}`, job);
  publish('job.new', { id: job.id, ref: job.ref, name: job.name, title: job.title });
  return job;
}

/* bookings made before the workshop existed become jobs the first time the workshop is opened (once) */
async function backfill() {
  if (await getRecord('crm', 'meta/jobs-backfilled')) return;
  const rows = await all('appointments/');
  const t = new Date().toISOString().slice(0, 10);
  for (const a of rows) if (a.status !== 'cancelled' && a.date >= t.slice(0, 8) + '01' && isWorkshop(a.service)) await ensureJob(a).catch(() => {});
  await putRecord('crm', 'meta/jobs-backfilled', { at: now() });
}

export async function listJobs(q, staff) {
  await backfill();
  const terms = norm(q.q).split(/\s+/).filter(Boolean);
  const branch = q.branch || (['sales', 'service'].includes(staff.role) ? staff.branch : null);
  const rows = (await all('jobs/')).filter((j) => {
    if (q.status === 'open') { if (['delivered', 'cancelled'].includes(j.status)) return false; }
    else if (q.status && j.status !== q.status) return false;
    if (branch && (j.branch || 'dubai') !== branch) return false;
    if (q.mine === '1' && j.assignee !== staff.email) return false;
    return !terms.length || terms.every((t) => norm(`${j.ref} ${j.name} ${j.phone} ${j.vehicle} ${j.title} ${j.description}`).includes(t));
  });
  return page(rows, q);
}

export async function getJob(id) {
  const j = await getRecord('crm', `jobs/${id}`);
  if (!j) throw new HttpError(404, 'Not found', 'There is no job with that id.');
  return j;
}

const money = (n) => Math.round(Number(n) * 100) / 100;
export function patchJob(id, patch, staff) {
  let apptStatus = null;
  return editRecord(`jobs/${id}`, 'job', (j) => {
    const at = now();
    const next = { ...j, updatedAt: at };
    const events = [];
    if (patch.quote) {
      const items = patch.quote.items.map((i) => ({ label: i.label, qty: i.qty || 1, price: money(i.price) }));
      const total = money(items.reduce((s, i) => s + i.qty * i.price, 0));
      next.quote = { items, total, note: patch.quote.note || null, status: 'pending', sentAt: at, by: staff.email };
      events.push(`Quote prepared: AED ${total}`);
    }
    for (const k of ['assignee', 'eta', 'courtesy', 'description']) if (patch[k] !== undefined) next[k] = patch[k];
    if (patch.pickup) next.pickup = { ...j.pickup, ...patch.pickup };
    if (patch.warranty) next.warranty = { ...j.warranty, ...patch.warranty };
    if (patch.invoice) next.invoice = { ...(j.invoice || {}), ...patch.invoice, issuedAt: j.invoice?.issuedAt || at };
    if (patch.status && patch.status !== j.status) {
      if (patch.status === 'quoted' && !next.quote) throw new HttpError(409, 'Prepare the quote first', 'Add the items and prices before sending the quote to the customer.');
      if (patch.status === 'in-progress' && next.quote && next.quote.status === 'pending') throw new HttpError(409, 'Quote not approved', 'The customer has not approved the quote yet. If they agreed by phone, mark it approved first.');
      if (patch.status === 'approved' && next.quote) next.quote = { ...next.quote, status: 'approved', decidedAt: at, decidedBy: `${staff.name || staff.email} (for the customer)` };
      next.status = patch.status;
      next.timeline = [...j.timeline, { at, status: patch.status, by: staff.name || staff.email, note: patch.note || null }];
      apptStatus = APPT_OF[patch.status] || null;
      if (patch.status === 'delivered') next.deliveredAt = at;
    } else if (patch.note) next.timeline = [...j.timeline, { at, status: j.status, by: staff.name || staff.email, note: patch.note }];
    events.forEach((text) => { next.timeline = [...next.timeline, { at, status: next.status, by: staff.name || staff.email, note: text }]; });
    return next;
  }).then(async (j) => {
    if (apptStatus && j.appointmentId) { try { await patchAppointment(j.appointmentId, { status: apptStatus }, staff.email); } catch { /* the booking may have been removed */ } }
    if (j.status === 'delivered' && j.ownedId) await afterDelivery(j);
    publish('job.updated', { id: j.id, ref: j.ref, status: j.status, by: staff.email });
    return j;
  });
}

/* a delivered job lands on the car's service record and moves its next service date on */
async function afterDelivery(j) {
  const o = await getRecord('crm', `owned/${j.ownedId}`);
  if (!o) return;
  const next = new Date(); next.setUTCMonth(next.getUTCMonth() + (j.kind === 'maintenance' ? 6 : 6));
  const history = [{ at: j.deliveredAt, ref: j.ref, title: j.title, total: j.invoice?.total ?? j.quote?.total ?? null }, ...(o.history || [])].slice(0, 40);
  await putRecord('crm', `owned/${o.id}`, { ...o, history, nextService: j.kind === 'maintenance' || j.kind === 'repair' ? { date: next.toISOString().slice(0, 10), basis: 'six months after the last visit' } : o.nextService, updatedAt: now() });
}

/* ------------------------------------------------------------------ what the customer may see (never staff notes) */
export const customerView = (j) => ({
  ref: j.ref, title: j.title, kind: j.kind, vehicle: j.vehicle, status: j.status, date: j.date, slot: j.slot, eta: j.eta, courtesy: j.courtesy, pickup: j.pickup,
  warranty: j.warranty?.covered ? { covered: true } : { covered: false },
  timeline: j.timeline.map(({ at, status, note }) => ({ at, status, note: note && !/^Quote prepared/.test(note) ? note : null })),
  quote: j.quote ? { items: j.quote.items, total: j.quote.total, note: j.quote.note, status: j.quote.status, sentAt: j.quote.sentAt, decidedAt: j.quote.decidedAt || null } : null,
  invoice: j.invoice ? { total: j.invoice.total ?? null, paid: Boolean(j.invoice.paid) } : null, createdAt: j.createdAt, updatedAt: j.updatedAt
});

/** A guest follows a job with its reference and the last four digits of the phone number it was booked with. */
export async function trackJob(ref, phone4) {
  const j = (await all('jobs/')).find((x) => x.ref === String(ref).toUpperCase().trim());
  if (!j || tail(j.phone) !== String(phone4).replace(/\D/g, '').slice(-4)) throw new HttpError(404, 'Not found', 'We could not find a job with that reference and phone number. Check both and try again.');
  return j;
}

export async function customerJobs(customerIdValue) {
  return (await all('jobs/')).filter((j) => j.customerId === customerIdValue).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function decideQuote(jobId, decision, who) {
  return editRecord(`jobs/${jobId}`, 'job', (j) => {
    if (!j.quote || j.quote.status !== 'pending') throw new HttpError(409, 'Nothing to approve', 'There is no quote waiting for your answer.');
    const at = now();
    const approved = decision === 'approved';
    return { ...j, quote: { ...j.quote, status: decision, decidedAt: at, decidedBy: who }, status: approved ? 'approved' : 'cancelled', updatedAt: at, timeline: [...j.timeline, { at, status: approved ? 'approved' : 'cancelled', by: who, note: approved ? 'Quote approved by the customer' : 'Quote declined by the customer' }] };
  }).then((j) => { publish('job.updated', { id: j.id, ref: j.ref, status: j.status, by: who, customer: true }); return j; });
}

/* ------------------------------------------------------------------ the garage: cars bought here */
const claimCode = () => `GK-${[...randomBytes(5)].map((b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('')}`;
const yearsOf = (s) => { const m = String(s || '').match(/(\d+)\s*(year|yr|month)/i); return m ? (/month/i.test(m[2]) ? +m[1] / 12 : +m[1]) : null; };

/** Hand a sold car to its buyer: the car leaves the stock, appears in the buyer's garage with its warranty and next service, and a claim code is made for the buyer to attach it to their account. */
export async function handover(leadId, input, staff) {
  const leads = await all('leads/');
  const lead = leads.find((l) => l.id === leadId);
  if (!lead) throw new HttpError(404, 'Not found', 'There is no lead with that id.');
  if (lead.status !== 'won') throw new HttpError(409, 'Not sold yet', 'Mark the lead won, with its price, before handing the car over.');
  if (lead.ownedId) throw new HttpError(409, 'Already handed over', 'This car has already been handed over.');
  const carId = lead.deal?.carId ?? lead.car?.id;
  const car = carId != null ? await getCar(carId).catch(() => null) : null;
  const at = now();
  const email = (lead.email || '').toLowerCase();
  const account = email ? await findCustomer(customerId(email)) : null;
  const wy = yearsOf(input.warrantyText ?? car?.warranty);
  const until = new Date(); if (wy) until.setUTCMonth(until.getUTCMonth() + Math.round(wy * 12));
  const next = new Date(); next.setUTCMonth(next.getUTCMonth() + 6);
  const o = {
    id: newId(), claimCode: claimCode(), customerId: account?.id || null, status: account ? 'claimed' : 'unclaimed', leadId: lead.id, leadRef: lead.ref,
    buyer: { name: lead.name, phone: lead.phone, email: lead.email || null }, carId: car?.id ?? carId ?? null, title: car?.title || lead.deal?.carTitle || lead.car?.title || 'Your car', brand: car?.brand || null, model: car?.model || null, year: car?.year || null,
    colour: car?.exterior || null, vin: input.vin || null, plate: input.plate || null, km: input.km ?? car?.km ?? null, price: lead.deal?.finalPrice ?? null, purchasedAt: at, deliveredBy: staff.email,
    warranty: { text: input.warrantyText ?? car?.warranty ?? null, until: wy ? until.toISOString().slice(0, 10) : null }, plan: input.plan || null,
    nextService: { date: next.toISOString().slice(0, 10), basis: 'six months after delivery' }, history: [], branch: lead.branch || 'dubai', cover: car?.thumb || car?.cover || null, createdAt: at, updatedAt: at
  };
  await putRecord('crm', `owned/${o.id}`, o);
  await putRecord('crm', `owned-codes/${o.claimCode}`, { id: o.id });
  if (car) await patchCar(car.id, { sold: true, soldAt: at }).catch(() => {});
  await editRecord(`leads/${leadId}`, 'lead', (l) => ({ ...l, ownedId: o.id, handedOverAt: at, updatedAt: at, events: [...(l.events || []), { at, kind: 'handover', by: staff.email, text: `Handed over. Garage code ${o.claimCode}` }] }));
  publish('lead.updated', { id: lead.id, ref: lead.ref, status: 'won', by: staff.email });
  return o;
}

export const listOwned = async (q) => page((await all('owned/')).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), q);
export async function ownedFor(customerIdValue) {
  return (await all('owned/')).filter((o) => o.customerId === customerIdValue).sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt));
}
export async function claimOwned(code, customerIdValue) {
  const key = String(code || '').toUpperCase().replace(/\s+/g, '');
  const ref = await getRecord('crm', `owned-codes/${key}`);
  const o = ref && (await getRecord('crm', `owned/${ref.id}`));
  if (!o) throw new HttpError(404, 'Code not found', 'That garage code is not right. It is on the hand-over sheet from the showroom.');
  if (o.customerId && o.customerId !== customerIdValue) throw new HttpError(409, 'Already claimed', 'That car is already in another garage. Contact the showroom if this is a mistake.');
  const next = { ...o, customerId: customerIdValue, status: 'claimed', claimedAt: now(), updatedAt: now() };
  await putRecord('crm', `owned/${o.id}`, next);
  return next;
}
export const publicOwned = ({ claimCode, buyer, leadId, leadRef, deliveredBy, ...o }, jobs = []) => ({ ...o, jobs: jobs.filter((j) => j.ownedId === o.id).map(customerView) });
