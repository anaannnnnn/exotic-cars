import { HttpError } from './http.mjs';
import { readDoc, newId, newRef, getRecord } from './store.mjs';
import { getPolicy } from './policy.mjs';
import { withDemoPrices } from './demo.mjs';
import { editRecord, getLead, all, page, norm, now, createLead } from './repo.mjs';
import { publish } from './bus.mjs';

/*
 * The deal desk. What a lead is worth and what to do next (a score that explains itself), whether it is being worked in
 * time (SLA), and the price: the car's listed price is the starting point, and any reduction goes to a manager to approve
 * (maker-checker: a different person decides, and the listed price is checked again at the moment of approval).
 */
const OPEN = ['new', 'contacted', 'qualified', 'negotiating'];
/** A discount request nobody decided in time: it is no longer waiting for anyone. */
const lapsed = (a) => a?.status === 'pending' && !!a.expiresAt && Date.parse(a.expiresAt) < Date.now();
const HOUR = 3_600_000;
const digits = (s) => String(s || '').replace(/\D/g, '');
const tail = (s) => digits(s).slice(-9);
export const SOURCES = ['website', 'configurator', 'phone', 'walk-in', 'whatsapp', 'instagram', 'referral', 'event', 'other'];

async function carsDoc() { return withDemoPrices((await readDoc('catalog', 'cars'))?.data?.cars || []); }
const carOf = (cars, l) => { const id = l.deal?.carId ?? l.car?.id; return id == null ? null : cars.find((c) => String(c.id) === String(id)) || null; };

/* ------------------------------------------------------------------ score */
const SOURCE_W = { phone: 12, 'walk-in': 14, whatsapp: 9, referral: 14, configurator: 10, instagram: 3, event: 6, website: 0, other: 0 };
const STAGE_W = { new: 0, contacted: 6, qualified: 14, negotiating: 26, won: 0, lost: 0 };
const aedFmt = new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 });

/** Score 1-99 with the reasons behind it, a band (hot, warm, cool) and the next best action. Deterministic: same lead, same answer. */
export function scoreLead(l, { car, policy, repeat = 0, booked = false, nowMs = Date.now() } = {}) {
  const reasons = [];
  let s = 28;
  const value = l.deal?.finalPrice ?? l.value ?? car?.price ?? l.configuration?.total ?? null;
  if (value) {
    const t = Math.max(0, Math.min(1, Math.log10(value / 50000) / Math.log10(40)));
    s += Math.round(14 * t);
    reasons.push({ up: true, text: `Budget around AED ${aedFmt.format(value)}` });
  }
  const st = STAGE_W[l.status] || 0;
  if (st) { s += st; reasons.push({ up: true, text: `In ${l.status}` }); }
  const src = SOURCE_W[l.source] ?? 0;
  if (src) { s += src; reasons.push({ up: true, text: { phone: 'Called in', 'walk-in': 'Walked in', whatsapp: 'Messaged on WhatsApp', referral: 'Referred', configurator: 'Built a car in 3D', instagram: 'From Instagram', event: 'Met at an event' }[l.source] || `Source: ${l.source}` }); }
  if (l.type === 'configuration') { s += 8; reasons.push({ up: true, text: 'Configured a specific car' }); }
  const msg = norm(l.message);
  if (/\b(today|tomorrow|this week|ready|cash|deposit|visit|see (it|the car)|finance|trade|part.?exchange|asap|urgent)\b/.test(msg)) { s += 8; reasons.push({ up: true, text: 'Says they are ready to move' }); }
  if (/\b(just looking|maybe|someday|later|only price|browsing)\b/.test(msg)) { s -= 6; reasons.push({ up: false, text: 'Sounds early in the search' }); }
  if (l.email) s += 3;
  if (repeat) { s += 6; reasons.push({ up: true, text: 'Has enquired before' }); }
  if (booked) { s += 10; reasons.push({ up: true, text: 'Has a viewing or test drive booked' }); }
  const touched = Date.parse(l.lastTouchAt || l.createdAt);
  const days = (nowMs - touched) / 864e5;
  if (OPEN.includes(l.status)) {
    if (days < 2 && !l.lastTouchAt) { s += 8; reasons.push({ up: true, text: 'Fresh: arrived in the last two days' }); }
    else if (days > 30) { s -= 10; reasons.push({ up: false, text: `No contact for ${Math.floor(days)} days` }); }
    else if (days > 10) { s -= 4; reasons.push({ up: false, text: `Quiet for ${Math.floor(days)} days` }); }
  }
  const score = Math.max(1, Math.min(99, Math.round(s)));
  const band = score >= 70 ? 'hot' : score >= 45 ? 'warm' : 'cool';
  let next = null;
  if (OPEN.includes(l.status)) {
    if (l.deal?.approval?.status === 'pending') next = 'Waiting for a manager to approve the discount';
    else if (l.nextAction?.text) next = l.nextAction.text;
    else next = {
      new: `Call within ${policy?.sla?.new ?? 2} hours`, contacted: 'Find out budget and timing', qualified: booked ? 'Prepare the car for the viewing' : 'Offer a viewing or a test drive',
      negotiating: l.deal?.finalPrice ? 'Take a deposit and agree the hand-over date' : 'Agree the price'
    }[l.status];
  }
  return { score, band, reasons: reasons.slice(0, 6), next };
}

/* ------------------------------------------------------------------ SLA */
/** Is this lead being worked in time? 'overdue', 'due' (inside the last quarter of the allowed time) or 'ok'. */
export function slaOf(l, policy, nowMs = Date.now()) {
  if (!OPEN.includes(l.status)) return { state: 'closed' };
  const hours = policy.sla[l.status] ?? 24;
  const base = Date.parse(l.lastTouchAt || l.stageAt || l.createdAt);
  const dueAt = l.nextAction?.at ? Date.parse(l.nextAction.at) : base + hours * HOUR;
  const left = dueAt - nowMs;
  const state = left < 0 ? 'overdue' : left < Math.max(HOUR, hours * HOUR * 0.25) ? 'due' : 'ok';
  return { state, dueAt: new Date(dueAt).toISOString(), hoursOver: left < 0 ? Math.round((-left / HOUR) * 10) / 10 : 0, minutesLeft: left > 0 ? Math.round(left / 60000) : 0 };
}

/* ------------------------------------------------------------------ the rich lead list */
export async function listLeadsRich(q, staff) {
  const [rows, appts, cars, policy] = await Promise.all([all('leads/'), all('appointments/'), carsDoc(), getPolicy()]);
  const phoneCount = new Map();
  rows.forEach((l) => { const k = tail(l.phone); if (k) phoneCount.set(k, (phoneCount.get(k) || 0) + 1); });
  const bookedPhones = new Set(appts.filter((a) => a.status !== 'cancelled' && /drive|viewing|consult/i.test(a.service || '')).map((a) => tail(a.phone)));
  const terms = norm(q.q).split(/\s+/).filter(Boolean);
  const branch = q.branch || (staff.role === 'sales' || staff.role === 'service' ? staff.branch : null);
  const out = rows.filter((l) => {
    if (q.status && l.status !== q.status) return false;
    if (q.source && l.source !== q.source) return false;
    if (branch && (l.branch || 'dubai') !== branch) return false;
    if (q.mine === '1' && l.assignee !== staff.email) return false;
    if (q.assignee && l.assignee !== q.assignee) return false;
    if (!terms.length) return true;
    return terms.every((t) => norm(`${l.ref} ${l.name} ${l.phone} ${l.email} ${l.car?.title} ${l.message} ${l.source}`).includes(t));
  }).map((l) => {
    const car = carOf(cars, l);
    const k = tail(l.phone);
    const sc = scoreLead(l, { car, policy, repeat: Math.max(0, (phoneCount.get(k) || 1) - 1), booked: bookedPhones.has(k) });
    return { ...l, score: sc.score, band: sc.band, reasons: sc.reasons, nextBest: sc.next, sla: slaOf(l, policy), listPrice: l.deal?.listPrice ?? car?.price ?? null, carRef: car ? { id: car.id, title: car.title, price: car.price ?? null, sold: !!car.sold } : null };
  }).filter((l) => (q.band ? l.band === q.band : true) && (q.sla ? l.sla.state === q.sla : true) && (q.approval ? l.deal?.approval?.status === q.approval : true));
  const sorts = {
    priority: (a, b) => (OPEN.includes(b.status) - OPEN.includes(a.status)) || b.score - a.score,
    sla: (a, b) => ({ overdue: 0, due: 1, ok: 2, closed: 3 }[a.sla.state] - { overdue: 0, due: 1, ok: 2, closed: 3 }[b.sla.state]) || b.score - a.score,
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt)
  };
  out.sort(sorts[q.sort] || sorts.newest);
  return page(out, q);
}

/** One lead with everything the drawer shows: score, SLA, the car's current price and the deal. */
export async function leadDetail(id, staff) {
  const [l, cars, policy, appts, all_] = await Promise.all([getLead(id), carsDoc(), getPolicy(), all('appointments/'), all('leads/')]);
  const car = carOf(cars, l);
  const k = tail(l.phone);
  const booked = appts.some((a) => a.status !== 'cancelled' && tail(a.phone) === k && /drive|viewing|consult/i.test(a.service || ''));
  const repeat = all_.filter((x) => x.id !== l.id && tail(x.phone) === k).length;
  const sc = scoreLead(l, { car, policy, repeat, booked });
  const o = l.ownedId ? await getRecord('crm', `owned/${l.ownedId}`) : null;
  return { ...l, deal: l.deal && lapsed(l.deal.approval) ? { ...l.deal, approval: { ...l.deal.approval, status: 'expired' } } : l.deal, owned: o ? { id: o.id, claimCode: o.claimCode, status: o.status, plate: o.plate, vin: o.vin } : null, score: sc.score, band: sc.band, reasons: sc.reasons, nextBest: sc.next, sla: slaOf(l, policy), carRef: car ? { id: car.id, title: car.title, price: car.price ?? null, sold: !!car.sold, listedAt: car.listedAt || null, cover: car.cover || null } : null, policy: { discount: policy.discount, sla: policy.sla }, canApprove: ['owner', 'manager'].includes(staff.role) };
}

/* ------------------------------------------------------------------ create a lead by hand (a phone call, a walk-in) */
export async function createStaffLead(input, staff) {
  const policy = await getPolicy();
  const k = tail(input.phone);
  if (!input.confirmDuplicate && k) {
    const since = Date.now() - 60 * 864e5;
    const dups = (await all('leads/')).filter((l) => tail(l.phone) === k && Date.parse(l.createdAt) > since && OPEN.includes(l.status));
    if (dups.length) throw new HttpError(409, 'Possible duplicate', `${dups[0].name} already has an open lead with this number (${dups[0].ref}). Open that one, or add this anyway.`, { duplicates: dups.slice(0, 3).map(({ id, ref, name, status, car, createdAt }) => ({ id, ref, name, status, car: car?.title || null, createdAt })) });
  }
  const { confirmDuplicate, assignee, budget, branch, ...rest } = input;
  const at = now();
  const lead = await createLead({ ...rest, car: input.car || null, configuration: null }, null, {
    ref: newRef('EX'), origin: 'staff', createdBy: staff.email, assignee: assignee ?? staff.email, branch: branch || staff.branch || policy.defaultBranch,
    value: budget ?? null, status: input.status || 'new', history: [{ at, status: input.status || 'new', by: staff.email }],
    events: [{ at, kind: 'created', by: staff.email, text: `Logged by ${staff.name || staff.email} (${input.source})` }],
    lastTouchAt: input.status && input.status !== 'new' ? at : null
  });
  return lead;
}

/* ------------------------------------------------------------------ calls and visits */
export function logTouch(id, t, staff) {
  return editRecord(`leads/${id}`, 'lead', (l) => {
    const at = now();
    const next = { ...l, lastTouchAt: at, updatedAt: at };
    if (!l.assignee && staff.email) next.assignee = staff.email;
    const line = `${{ call: 'Called', whatsapp: 'WhatsApp', email: 'Emailed', visit: 'Met in person' }[t.kind]}${t.outcome ? `: ${t.outcome.replace(/-/g, ' ')}` : ''}${t.note ? ` - ${t.note}` : ''}`;
    next.events = [...(l.events || []), { at, kind: 'touch', by: staff.email, text: line }];
    next.touches = [...(l.touches || []), { at, by: staff.email, kind: t.kind, outcome: t.outcome || null, note: t.note || null }];
    if (l.status === 'new' && t.outcome !== 'no-answer') {
      next.status = 'contacted'; next.stageAt = at;
      next.history = [...(l.history || []), { at, status: 'contacted', by: staff.email }];
    }
    next.nextAction = t.nextAt ? { at: new Date(t.nextAt).toISOString(), text: t.nextText || 'Follow up', by: staff.email } : null;
    return next;
  }).then((l) => { publish('lead.updated', { id: l.id, ref: l.ref, status: l.status, by: staff.email }); return l; });
}

/* ------------------------------------------------------------------ price and discount */
const roundMoney = (n) => Math.round(n * 100) / 100;

/** Save the deal for a lead: price, payment, deposit, part-exchange. A reduction on the listed price is checked against the policy. */
export async function saveDeal(id, input, staff) {
  const [policy, cars] = await Promise.all([getPolicy(), carsDoc()]);
  let notify = null;
  const lead = await editRecord(`leads/${id}`, 'lead', (l) => {
    if (!OPEN.includes(l.status)) throw new HttpError(409, 'Lead is closed', 'A won or lost lead keeps the deal it had. Re-open it to change the price.');
    const prev = l.deal || {};
    const carId = input.carId ?? prev.carId ?? l.car?.id ?? null;
    const car = carId == null ? null : cars.find((c) => String(c.id) === String(carId)) || null;
    const inventoryPrice = car?.price ?? null;
    const listPrice = inventoryPrice ?? input.listPrice ?? prev.listPrice ?? null;
    const at = now();
    const deal = { ...prev, carId: car?.id ?? carId, carTitle: car?.title || l.car?.title || prev.carTitle || null, listPrice, priceSource: inventoryPrice != null ? 'inventory' : listPrice != null ? 'manual' : null };
    if (input.payment !== undefined) deal.payment = input.payment;
    if (input.deposit !== undefined) deal.deposit = input.deposit;
    if (input.tradeIn !== undefined) deal.tradeIn = input.tradeIn;
    if (input.notes !== undefined) deal.notes = input.notes;
    if (listPrice == null && input.finalPrice == null) { l.deal = deal; return { ...l, deal, updatedAt: at }; }
    if (listPrice == null) throw new HttpError(400, 'Invalid request', 'Some fields are missing or not valid.', { fields: { listPrice: 'This car has no listed price yet. Enter it to continue.' } });
    /* the price defaults to the listed price: nobody has to type it unless it changes */
    const final = roundMoney(input.finalPrice ?? prev.finalPrice ?? listPrice);
    if (final <= 0) throw new HttpError(400, 'Invalid request', 'Some fields are missing or not valid.', { fields: { finalPrice: 'Enter a price above zero' } });
    const discount = Math.max(0, roundMoney(listPrice - final));
    const pct = listPrice > 0 ? (discount / listPrice) * 100 : 0;
    deal.finalPrice = final; deal.discount = { amount: discount, pct: Math.round(pct * 100) / 100, reason: input.reason ?? prev.discount?.reason ?? null };
    deal.aboveList = final > listPrice ? roundMoney(final - listPrice) : 0;
    const unchanged = prev.finalPrice === final && prev.listPrice === listPrice && prev.approval && (prev.approval.status === 'approved' || (prev.approval.status === 'pending' && !lapsed(prev.approval)));
    if (unchanged) { deal.approval = prev.approval; }
    else if (discount === 0) { deal.approval = { status: 'none' }; }
    else {
      if (pct > policy.discount.maxPct && staff.role !== 'owner') throw new HttpError(409, 'Discount too large', `The most that can be taken off is ${policy.discount.maxPct}% (AED ${aedFmt.format(roundMoney(listPrice * policy.discount.maxPct / 100))}). Only the owner can go further.`);
      if (!input.reason && !deal.discount.reason) throw new HttpError(400, 'Invalid request', 'Some fields are missing or not valid.', { fields: { reason: 'Say why the price is lower (a short reason helps the approver)' } });
      const auto = staff.role === 'owner' || (staff.role === 'manager' && pct <= policy.discount.managerAutoPct) || (staff.role === 'sales' && pct <= policy.discount.salesAutoPct);
      if (auto) deal.approval = { status: 'approved', auto: true, requestedBy: staff.email, requestedAt: at, decidedBy: staff.email, decidedAt: at, listPriceAtRequest: listPrice, requestedPrice: final };
      else {
        deal.approval = { status: 'pending', requestedBy: staff.email, requestedByName: staff.name || staff.email, requestedAt: at, requestedPrice: final, listPriceAtRequest: listPrice, expiresAt: new Date(Date.now() + policy.discount.approvalValidHours * HOUR).toISOString() };
        notify = { id: l.id, ref: l.ref, name: l.name, by: staff.email, byName: staff.name || staff.email, amount: discount, pct: deal.discount.pct };
      }
    }
    const text = `Price set to AED ${aedFmt.format(final)}${discount ? ` (AED ${aedFmt.format(discount)} / ${deal.discount.pct}% below the listed price)` : ''}${deal.approval.status === 'pending' ? ' - sent for approval' : ''}`;
    return { ...l, deal, value: final, updatedAt: at, events: [...(l.events || []), { at, kind: 'deal', by: staff.email, text }] };
  });
  if (notify) publish('approval.requested', notify);
  publish('lead.updated', { id: lead.id, ref: lead.ref, status: lead.status, by: staff.email });
  return leadDetail(id, staff);
}

/** A manager (or the owner) approves or rejects a reduced price. Never the person who asked; and the listed price is read again first. */
export async function decideDiscount(id, { decision, note }, staff) {
  if (!['owner', 'manager'].includes(staff.role)) throw new HttpError(403, 'Not allowed', 'Only a manager or the owner can approve a discount.');
  const [policy, cars] = await Promise.all([getPolicy(), carsDoc()]);
  let outcome = null;
  const lead = await editRecord(`leads/${id}`, 'lead', (l) => {
    if (!OPEN.includes(l.status)) throw new HttpError(409, 'Lead is closed', 'This lead is already won or lost, so its price can no longer be approved.');
    const d = l.deal, a = d?.approval;
    if (!a || a.status !== 'pending') throw new HttpError(409, 'Nothing to approve', 'This deal has no discount waiting for approval.');
    if (a.requestedBy === staff.email) throw new HttpError(403, 'Not allowed', 'A discount has to be approved by someone other than the person who asked for it.');
    const at = now();
    if (a.expiresAt && Date.parse(a.expiresAt) < Date.now()) {
      outcome = 'expired';
      return { ...l, deal: { ...d, approval: { ...a, status: 'expired', decidedAt: at } }, updatedAt: at, events: [...(l.events || []), { at, kind: 'approval', by: staff.email, text: 'Approval request had expired' }] };
    }
    const car = d.carId == null ? null : cars.find((c) => String(c.id) === String(d.carId));
    const nowList = car?.price ?? d.listPrice;
    if (decision === 'approved' && nowList !== a.listPriceAtRequest) {
      outcome = 'stale';
      return { ...l, deal: { ...d, listPrice: nowList, approval: { ...a, status: 'stale', decidedAt: at } }, updatedAt: at, events: [...(l.events || []), { at, kind: 'approval', by: staff.email, text: `Listed price changed to AED ${aedFmt.format(nowList)} since the request` }] };
    }
    const pct = d.discount?.pct ?? 0;
    if (decision === 'approved' && pct > policy.discount.maxPct && staff.role !== 'owner') throw new HttpError(409, 'Discount too large', `That is more than the ${policy.discount.maxPct}% a manager can approve. The owner has to.`);
    outcome = decision;
    const approval = { ...a, status: decision, decidedBy: staff.email, decidedByName: staff.name || staff.email, decidedAt: at, note: note || null };
    return { ...l, deal: { ...d, approval }, updatedAt: at, events: [...(l.events || []), { at, kind: 'approval', by: staff.email, text: `${decision === 'approved' ? 'Approved' : 'Rejected'} the discount of AED ${aedFmt.format(d.discount?.amount || 0)}${note ? ` - ${note}` : ''}` }] };
  });
  if (outcome === 'expired') throw new HttpError(409, 'Request expired', 'The request ran past its time limit. Ask for the discount again.');
  if (outcome === 'stale') throw new HttpError(409, 'The price changed', 'The listed price changed after the discount was asked for. Ask again at the new price.');
  publish('approval.decided', { id: lead.id, ref: lead.ref, decision, by: staff.email, to: lead.deal.approval.requestedBy });
  return leadDetail(id, staff);
}

/** Everything waiting for a manager. */
export async function pendingApprovals() {
  const rows = await all('leads/');
  return rows.filter((l) => l.deal?.approval?.status === 'pending' && !lapsed(l.deal.approval) && OPEN.includes(l.status)).map((l) => ({
    id: l.id, ref: l.ref, name: l.name, car: l.deal.carTitle || l.car?.title || null, listPrice: l.deal.listPrice, finalPrice: l.deal.finalPrice,
    discount: l.deal.discount, reason: l.deal.discount?.reason || null, requestedBy: l.deal.approval.requestedByName || l.deal.approval.requestedBy, requestedByEmail: l.deal.approval.requestedBy, requestedAt: l.deal.approval.requestedAt, expiresAt: l.deal.approval.expiresAt
  })).sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

/** The numbers the dashboard and the nav badges need. */
export async function health(staff) {
  const [rows, policy] = await Promise.all([all('leads/'), getPolicy()]);
  const open = rows.filter((l) => OPEN.includes(l.status));
  const states = open.map((l) => slaOf(l, policy).state);
  const mineOpen = open.filter((l) => l.assignee === staff.email);
  return {
    overdue: states.filter((s) => s === 'overdue').length, due: states.filter((s) => s === 'due').length,
    mineOverdue: mineOpen.filter((l) => slaOf(l, policy).state === 'overdue').length,
    pendingApprovals: rows.filter((l) => l.deal?.approval?.status === 'pending' && !lapsed(l.deal.approval) && OPEN.includes(l.status)).length,
    unassigned: open.filter((l) => !l.assignee).length
  };
}
