import { createHash } from 'node:crypto';
import { store, readDoc, putRecord, getRecord, deleteRecord, listKeys, getMany } from './store.mjs';
import { customerId } from './auth.mjs';

/*
 * Demo data: a realistic Dubai luxury-car showroom to show every screen with. Everything here is marked `demo: true`,
 * lives under its own keys (`*demo-*`), and is removed with one click (Settings -> Demo data). Nothing touches the
 * website: the prices below are an overlay used by the CRM's deal desk, forecast and purchasing planner only.
 * It is generated from the real stock list (models, years, kilometres, listing dates), with a fixed seed so the same
 * numbers come out every time, and dated relative to today so it always looks current.
 *
 *   sales      a year of cars sold (12 full months and this one so far): price, cost, preparation, days to sell, who bought, how it was found and paid for
 *   prices     a list price and a cost for every car in stock
 *   leads      the last three months of enquiries, in every stage, won ones matching the sales ledger
 *   customers, appointments, searches that found nothing
 */
const DAY = 864e5;
const addMonths = (d, n) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
const ym = (d) => d.toISOString().slice(0, 7);

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hashNum = (s) => parseInt(createHash('sha1').update(String(s)).digest('hex').slice(0, 8), 16);
const pick = (r, list) => list[Math.floor(r() * list.length)];
const wpick = (r, items, w) => { const t = w.reduce((s, x) => s + x, 0); let x = r() * t; for (let i = 0; i < items.length; i++) { x -= w[i]; if (x <= 0) return items[i]; } return items[items.length - 1]; };
const between = (r, a, b) => a + r() * (b - a);
const roundTo = (n, step) => Math.round(n / step) * step;

/* ---------- prices: a current-spec GCC price per model (AED), then age, kilometres and a little condition noise ---------- */
const BASE = {
  'Rolls Royce': { Cullinan: 1950000, Dawn: 1900000, Phantom: 2900000, Wraith: 1700000, Spectre: 2450000, Ghost: 1750000 },
  Lamborghini: { Huracan: 1150000, Urus: 1500000, Murcielago: 1050000, Revuelto: 2950000, Aventador: 2200000, Temerario: 1900000, Sian: 11000000 },
  Ferrari: { 'SF90 Stradale/Spider': 3600000, '296 GTB/GTS': 2050000, 'F8 Tributo/Spider': 1800000, 'Portofino/Portofino M': 1350000, Purosangue: 2450000, 'Roma Coupe/Spider': 1500000, '812 Superfast/GTS': 2200000, 'GTC4 Lusso V8/V12': 1200000, 'F430 Coupe/Spider': 520000, '599 GTB/GTO': 760000, '612 Scaglietti': 380000, '458 Italia/Spider': 1050000, '360 Modena/Spider': 380000, '488 GTB/Spider/Pista': 1500000, Testarossa: 1500000, '12 Cilindri': 2700000, '456 M GTA': 480000, '355 Berlinetta/GTS/Spider': 550000, F12: 1350000, FF: 800000, 'Mondial Standard/ T': 300000, 308: 520000, '550/575 Maranello': 480000, '348 GTB/TS/GTS': 420000 },
  'Mercedes Benz': { 'Maybach GLS': 900000, 'G-Class': 780000, 'Maybach S-Class': 1000000, 'SLS AMG': 700000, 'E-Class': 330000, 'S-Class': 120000, 'AMG GT': 600000, 'GLS-CLASS': 350000, 'C-Class': 300000, 'SLR Mclaren': 1900000 },
  Bentley: { 'Continental GTC': 780000, Bentayga: 720000, 'Continental GT': 700000, 'Flying Spur': 780000, Mulsanne: 850000, Azure: 180000 },
  Porsche: { 911: 620000, Taycan: 480000, 718: 360000, Turbo: 650000 },
  'Aston Martin': { DB11: 520000, VANTAGE: 520000, DBS: 760000, DBX: 560000, 'DB 12': 780000 },
  'Land Rover': { 'Range Rover Vogue': 560000, Defender: 330000, 'Range Rover Sport': 480000, 'Range Rover SV': 760000 },
  McLaren: { '765LT Coupe/Spider': 1300000, '720 S Coupe/Spider': 700000, Artura: 700000, GT: 520000, '650 S Coupe/Spyder': 480000 },
  BMW: { X7: 420000, X5: 330000, M5: 560000, i5: 300000, M4: 360000, M3: 120000, X4: 300000 },
  Audi: { Q8: 330000, RS: 400000, 'R8 Coupe/Spyder': 480000 },
  Maserati: { MC20: 900000, Grecale: 400000 },
  Bugatti: { Chiron: 11000000, Divo: 22000000 },
  Cadillac: { Escalade: 360000 }, Infiniti: { QX80: 330000 }, 'Alfa Romeo': { Giulia: 190000 }, KTM: { '1300 R': 55000 }, Brute: { Jeep: 220000 }
};
const DEP = { 'Rolls Royce': 0.085, Lamborghini: 0.06, Ferrari: 0.055, 'Mercedes Benz': 0.11, Bentley: 0.11, Porsche: 0.07, 'Aston Martin': 0.11, 'Land Rover': 0.11, McLaren: 0.10, BMW: 0.12, Audi: 0.12, Maserati: 0.12 };
/* older sports cars and the like are priced as collectables: they hold their value instead of falling */
const collectable = (c) => ['Ferrari', 'Lamborghini', 'Porsche', 'Mercedes Benz', 'Bentley', 'McLaren'].includes(c.brand) && +c.year > 0 && +c.year < 2013 && !/Maybach|S-Class|E-Class|C-Class/.test(c.model || '');

export function listPriceFor(car, nowYear = new Date().getUTCFullYear()) {
  const base = BASE[car.brand]?.[car.model] ?? 300000;
  const year = +car.year || nowYear, age = Math.max(0, nowYear - year);
  let f = collectable(car) ? 0.95 + (hashNum(`${car.id}c`) % 160) / 1000 : Math.max(0.36, (1 - (DEP[car.brand] ?? 0.1)) ** Math.max(0, age - (age >= 1 ? 0 : 0)));
  const km = Number(car.km) || 0;
  if (!collectable(car) && km > 0) f *= Math.min(1.06, Math.max(0.88, 1 - (km - age * 10000) / 1000 * 0.003));
  f *= 0.96 + (hashNum(`${car.id}n`) % 80) / 1000;
  const p = base * f;
  return p >= 1e6 ? roundTo(p, 10000) : roundTo(p, 5000);
}
const costFor = (car, price) => roundTo(price * (0.83 + (hashNum(`${car.id}k`) % 70) / 1000), 5000);

/* ---------- people ---------- */
const FIRST = ['Omar', 'Khalid', 'Mohammed', 'Faisal', 'Yusuf', 'Hamad', 'Saeed', 'Rashid', 'Layla', 'Maryam', 'Noura', 'Fatima', 'Ahmed', 'Rahul', 'Vikram', 'Arjun', 'Priya', 'Ayesha', 'Imran', 'Bilal', 'Dmitri', 'Alexei', 'Natalia', 'James', 'Oliver', 'Sophie', 'Charlotte', 'Daniel', 'Wei', 'Chen', 'Marco', 'Luca', 'Hassan', 'Tariq', 'Karim', 'Sami'];
const LAST = ['Al Mansoori', 'Al Falasi', 'Al Suwaidi', 'Al Nuaimi', 'Al Hashemi', 'Khan', 'Sharma', 'Patel', 'Nair', 'Hussain', 'Rahman', 'Ivanov', 'Petrov', 'Smith', 'Walker', 'Carter', 'Liu', 'Zhang', 'Rossi', 'Bianchi', 'Haddad', 'Nasser', 'Khoury', 'Malik'];
const SOURCES = ['website', 'whatsapp', 'instagram', 'phone', 'walk-in', 'referral', 'event'];
const SALESPEOPLE = ['Sam Carter', 'Mona Haddad', 'Rashid Al Nuaimi', 'Priya Nair'];
const ACQ = [['Trade-in', 28, 0.97], ['GCC dealer network', 26, 1.0], ['Auction', 18, 0.95], ['Private owner', 14, 0.98], ['Import (Europe / USA)', 14, 1.04]];
const PAY = [['Cash', 52], ['Finance', 33], ['Trade-in + cash', 15]];
const DAYS_TO_SELL = { 'Rolls Royce': 68, Lamborghini: 47, Ferrari: 52, 'Mercedes Benz': 61, Bentley: 82, Porsche: 39, 'Aston Martin': 96, 'Land Rover': 37, McLaren: 88, BMW: 44, Audi: 46, Maserati: 90 };
const POP = { 'Rolls Royce': 1.25, Ferrari: 1.1, Lamborghini: 1.15, 'Mercedes Benz': 0.95, Bentley: 0.85, Porsche: 1.2, 'Aston Martin': 0.6, 'Land Rover': 0.8, McLaren: 0.5, BMW: 0.7, Audi: 0.5, Maserati: 0.3 };
const SEASON = [1.05, 1.0, 0.95, 0.9, 0.85, 0.75, 0.7, 0.72, 0.9, 1.1, 1.2, 1.25];
const person = (r) => `${pick(r, FIRST)} ${pick(r, LAST)}`;
const phoneOf = (r) => `+971 5${pick(r, [0, 2, 4, 5, 6])} ${String(Math.floor(r() * 900) + 100)} ${String(Math.floor(r() * 9000) + 1000)}`;
const emailOf = (name, r) => `${name.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '.')}${r() < 0.3 ? Math.floor(r() * 90) : ''}@example.com`;
/* demo ids look like real ones (9 base-36 characters, a dash, 8 hex) so every screen and route accepts them; the leading 'dm' cannot clash with a real, time-based id */
const did = (n) => `dm${n.toString(36).padStart(7, '0')}-${createHash('sha1').update(`demo${n}`).digest('hex').slice(0, 8)}`;
const refOf = (r) => `EX-${Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(r() * 32)]).join('')}`;

/* ---------- state ---------- */
const STATE_KEY = 'demo';
let cache = { at: 0, state: null, prices: null };
export async function demoState() {
  if (Date.now() - cache.at < 15000 && cache.state !== undefined) return cache.state;
  const state = await store('system').get(STATE_KEY, { type: 'json' }).catch(() => null);
  cache = { at: Date.now(), state, prices: state ? await getRecord('crm', 'demo/prices') : null };
  return state;
}
export const demoEnabled = async () => !!(await demoState())?.enabled;

/** The stock with the demo prices and costs on top (a no-op when demo data is off). The website never sees these. */
export async function withDemoPrices(cars) {
  const st = await demoState();
  if (!st?.enabled || !cache.prices) return cars;
  const px = cache.prices.map || {};
  return cars.map((c) => (px[c.id] && !c.price ? { ...c, price: px[c.id].price, cost: px[c.id].cost, demoPrice: true } : c));
}
export async function stockCars() {
  const doc = await readDoc('catalog', 'cars');
  return withDemoPrices(doc?.data?.cars || []);
}

/** Lead counts for every month, so the forecast reads a full year; the demo leads in the CRM are the recent sample of them. */
export async function demoLeadStats() {
  const st = await demoState();
  return st?.enabled ? ((await getRecord('crm', 'demo/leadstats')) || {}).months || {} : {};
}

/* ---------- generate ---------- */
export function generate({ cars, now = new Date(), seed = 20261028 }) {
  const r = rng(seed);
  const nowYear = now.getUTCFullYear();
  const cur = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const prices = {};
  for (const c of cars) { const p = listPriceFor(c, nowYear); prices[c.id] = { price: p, cost: costFor(c, p) }; }

  /* the models the showroom sells, weighted by how much of them it stocks and how popular the make is */
  const byModel = new Map();
  for (const c of cars) { const k = `${c.brand}|${c.model}`; const m = byModel.get(k) || { brand: c.brand, model: c.model, body: c.body, years: [], n: 0 }; m.n += 1; if (+c.year) m.years.push(+c.year); byModel.set(k, m); }
  const models = [...byModel.values()].filter((m) => (BASE[m.brand]?.[m.model] ?? 0) > 0 && (BASE[m.brand][m.model] < 5e6) && m.n >= 1);
  /* what sells is not what is stocked: demand follows how current and in-demand a model is, so some models run short and old stock sits */
  const recency = (m) => { const y = m.years.length ? m.years.reduce((s, x) => s + x, 0) / m.years.length : 2015; return y >= 2023 ? 1.7 : y >= 2020 ? 1.2 : y >= 2013 ? 0.75 : 0.28; };
  const HOT = new Set(['Cullinan', 'Urus', 'G-Class', '911', 'Huracan', 'Purosangue', 'SF90 Stradale/Spider', '296 GTB/GTS', 'Ghost', 'Spectre', 'Range Rover Vogue', 'Range Rover Sport', 'Maybach GLS', 'Revuelto', 'Bentayga', 'Continental GTC', 'Defender', 'Roma Coupe/Spider', 'Phantom']);
  const weights = models.map((m) => (m.n ** 0.3) * (POP[m.brand] ?? 0.3) * recency(m) * (HOT.has(m.model) ? 2.2 : 1) * (0.75 + (hashNum(`${m.brand}${m.model}`) % 50) / 100));

  const sales = [];
  let counter = 0;
  for (let back = 12; back >= 0; back--) {
    const month = addMonths(cur, -back);
    const calMonth = month.getUTCMonth();
    const growth = 1 + (12 - back) * 0.011;
    const target = Math.round(38 * SEASON[calMonth] * growth * between(r, 0.9, 1.1));
    const isCurrent = back === 0;
    const units = isCurrent ? Math.max(1, Math.round(target * (now.getUTCDate() / 30))) : target;
    const dim = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
    for (let i = 0; i < units; i++) {
      const m = wpick(r, models, weights);
      const year = Math.min(nowYear + 1, Math.max(Math.min(...m.years), Math.max(...m.years) - Math.floor(Math.min(r(), r()) * (Math.max(...m.years) - Math.min(...m.years) + 1))));
      const km = year >= nowYear ? Math.floor(between(r, 5, 900)) : Math.floor(Math.max(500, (nowYear - year) * between(r, 5000, 13000)));
      const car = { id: `s${counter}`, brand: m.brand, model: m.model, year, km };
      const list = listPriceFor(car, nowYear);
      const discPct = Math.round(Math.max(0, between(r, -0.5, 5.2)) * 10) / 10;
      const price = roundTo(list * (1 - discPct / 100), list >= 1e6 ? 5000 : 1000);
      const [channel, , chanF] = wpick(r, ACQ, ACQ.map((a) => a[1]));
      const cost = roundTo(list * between(r, 0.8, 0.88) * chanF, 5000);
      const recon = roundTo(list * between(r, 0.006, 0.02), 500);
      const dts = Math.max(6, Math.round((DAYS_TO_SELL[m.brand] ?? 60) * Math.exp((r() - 0.5) * 1.1) * (calMonth >= 5 && calMonth <= 7 ? 1.18 : calMonth >= 9 || calMonth <= 1 ? 0.88 : 1)));
      const day = Math.min(dim, Math.floor(between(r, 1, isCurrent ? Math.max(2, now.getUTCDate()) : dim + 1)));
      const soldAt = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day, 9 + Math.floor(r() * 9), Math.floor(r() * 60))).toISOString();
      const buyer = person(r);
      sales.push({
        id: did(counter++), demo: true, soldAt, month: ym(month), brand: m.brand, model: m.model, body: m.body || null, year, km,
        title: `${year} ${m.brand} ${m.model}`.replace('Rolls Royce', 'Rolls-Royce').replace('Mercedes Benz', 'Mercedes-Benz'),
        listPrice: list, price, discountPct: discPct, cost, recon, profit: price - cost - recon, daysToSell: dts,
        acquiredAt: new Date(Date.parse(soldAt) - dts * DAY).toISOString(), acquisition: channel, saleChannel: wpick(r, SOURCES, [30, 22, 12, 10, 12, 9, 5]),
        payment: wpick(r, PAY.map((p) => p[0]), PAY.map((p) => p[1])), buyer, salesperson: pick(r, SALESPEOPLE), source: 'demo'
      });
    }
  }

  /* leads: the last three months in full, in every stage; won ones mirror real sales */
  const leads = [], customers = new Map();
  const mkAt = (d) => d.toISOString();
  const recentSales = sales.filter((s) => Date.parse(s.soldAt) >= now - 45 * DAY);
  const stageMix = [['new', 15], ['contacted', 14], ['qualified', 10], ['negotiating', 7]];
  const lostReasons = ['Bought elsewhere', 'Price too high', 'Changed their mind', 'No answer after 5 tries', 'Financing declined', 'Wanted a different colour'];
  const pickCar = () => { const c = cars.filter((x) => !x.sold && !x.hidden)[Math.floor(r() * cars.filter((x) => !x.sold && !x.hidden).length)]; return c; };
  const forSale = cars.filter((x) => !x.sold && !x.hidden);
  const mkLead = (o) => {
    const name = o.name || person(r), email = emailOf(name, r), phone = phoneOf(r);
    const created = new Date(o.createdAt), hist = [{ at: created.toISOString(), status: 'new' }];
    const order = ['new', 'contacted', 'qualified', 'negotiating', 'won'];
    const stages = o.status === 'lost' ? ['new', 'contacted', ...(r() < 0.5 ? ['qualified'] : []), 'lost'] : order.slice(0, order.indexOf(o.status) + 1);
    let t = created.getTime();
    stages.slice(1).forEach((s) => { t = Math.min(o.updatedAt ? Date.parse(o.updatedAt) : Date.now(), t + between(r, 0.2, 2.5) * DAY); hist.push({ at: new Date(t).toISOString(), status: s }); });
    const last = hist[hist.length - 1].at;
    const touched = o.status !== 'new';
    const lead = {
      id: did(100000 + leads.length), ref: refOf(r), demo: true, status: o.status, type: o.type || wpick(r, ['general', 'viewing', 'configuration'], [45, 35, 20]),
      name, phone, email, message: o.message || pick(r, ['Is it still available? Interested in a viewing this week.', 'Can I get your best price? Paying cash.', 'Looking to trade in my current car, what can you offer?', 'Does it have full service history and warranty?', 'Can you ship it to Abu Dhabi? Ready to proceed.', 'Want to compare with a similar one, what else do you have?']),
      car: o.car ? { id: o.car.id, title: o.car.title } : null, source: o.source || wpick(r, SOURCES, [30, 22, 12, 10, 12, 9, 5]), origin: o.origin || 'customer', branch: 'dubai', assignee: null,
      notes: [], history: hist, events: [{ at: created.toISOString(), kind: 'created', text: `Enquiry from ${o.source || 'the website'}` }, ...hist.slice(1).map((h) => ({ at: h.at, kind: 'stage', by: 'demo', text: `Moved to ${h.status}` }))],
      touches: touched ? [{ at: hist[1].at, by: 'demo', kind: 'call', outcome: 'connected', note: 'Spoke with the customer' }] : [], stageAt: last, lastTouchAt: touched ? hist[1].at : null,
      createdAt: created.toISOString(), updatedAt: last, value: o.value ?? null
    };
    if (o.deal) lead.deal = o.deal;
    if (o.status === 'won') lead.wonAt = o.wonAt;
    if (o.status === 'lost') lead.lostReason = pick(r, lostReasons);
    customers.set(email, { name, email, phone, at: created.toISOString() });
    leads.push(lead);
  };
  /* won: one per recent sale */
  recentSales.forEach((s) => {
    const car = forSale.find((c) => c.brand === s.brand && c.model === s.model) || pickCar();
    const created = new Date(Date.parse(s.soldAt) - between(r, 4, 25) * DAY);
    mkLead({ name: s.buyer, status: 'won', createdAt: created, updatedAt: s.soldAt, wonAt: s.soldAt, car: { id: car.id, title: s.title }, value: s.price, deal: { carId: car.id, carTitle: s.title, listPrice: s.listPrice, finalPrice: s.price, discount: { amount: s.listPrice - s.price, pct: s.discountPct, reason: s.discountPct > 0 ? 'Cash buyer' : null }, approval: s.discountPct > 5 ? { status: 'approved', requestedBy: 'sales@exotic.test', decidedBy: 'owner', decidedAt: s.soldAt } : { status: 'none' }, payment: s.payment.startsWith('Finance') ? 'finance' : 'cash' } });
  });
  /* lost: about 28 over the three months */
  for (let i = 0; i < 28; i++) { const c = pickCar(); const created = new Date(now - between(r, 8, 85) * DAY); mkLead({ status: 'lost', createdAt: created, updatedAt: new Date(created.getTime() + between(r, 3, 20) * DAY).toISOString(), car: { id: c.id, title: c.title } }); }
  /* open: spread across the pipeline, mostly recent */
  stageMix.forEach(([status, n]) => {
    for (let i = 0; i < n; i++) {
      const c = pickCar(); const age = status === 'new' ? between(r, 0.05, 2.2) : status === 'contacted' ? between(r, 0.5, 6) : status === 'qualified' ? between(r, 2, 14) : between(r, 4, 25);
      const created = new Date(now - age * DAY); const px = prices[c.id]?.price;
      mkLead({ status, createdAt: created, updatedAt: new Date(Math.min(now.getTime(), created.getTime() + age * DAY * 0.6)).toISOString(), car: { id: c.id, title: c.title }, type: r() < 0.3 ? 'configuration' : undefined, value: status === 'negotiating' && px ? Math.round(px * between(r, 0.95, 1)) : null });
    }
  });

  /* appointments: test drives and viewings, some past, some coming up */
  const appointments = [];
  for (let i = 0; i < 30; i++) {
    const c = pickCar(), dayOffset = Math.floor(between(r, -14, 12)), d = new Date(now.getTime() + dayOffset * DAY), name = person(r);
    const date = d.toISOString().slice(0, 10), past = dayOffset < 0;
    const status = past ? wpick(r, ['completed', 'cancelled', 'no-show'], [80, 12, 8]) : wpick(r, ['requested', 'confirmed'], [35, 65]);
    appointments.push({ id: did(200000 + i), ref: `AA-${String(100000 + Math.floor(r() * 899999))}`, demo: true, status, service: pick(r, ['Test drive', 'Private viewing', 'Test drive', 'Trade-in valuation', 'Handover']), car: c.title, date, slot: pick(r, ['10:00', '11:30', '14:00', '16:30', '18:00']), name, phone: phoneOf(r), email: emailOf(name, r), notes: null, customerId: null, branch: 'dubai', staffNotes: [], history: [{ at: d.toISOString(), status: 'requested' }], createdAt: new Date(d.getTime() - between(r, 1, 6) * DAY).toISOString(), updatedAt: d.toISOString() });
  }

  /* what customers asked for and the showroom did not have */
  const day = (n) => new Date(now - n * DAY).toISOString().slice(0, 10);
  const asks = [
    ['lamborghini', 'suv', 'black', 2024, 2026, 'black lamborghini urus 2024', 16], ['ferrari', 'convertible', 'red', 2023, 2026, 'red ferrari convertible', 13], ['rolls royce', 'sedan', 'white', 2024, 2026, 'white rolls royce ghost', 11],
    ['mercedes benz', 'suv', null, 2024, 2026, 'g63 amg 2025', 15], ['porsche', 'coupe', 'grey', 2024, 2026, 'porsche 911 gt3', 9], ['bentley', 'suv', 'green', null, null, 'green bentayga', 7], ['mclaren', 'coupe', null, 2023, 2026, 'mclaren 750s', 6],
    ['range rover', 'suv', 'black', 2025, 2026, 'range rover autobiography 2025', 10], ['ferrari', 'coupe', 'yellow', 2022, 2025, 'yellow ferrari 296', 5], ['lamborghini', 'coupe', 'orange', 2023, 2025, 'orange huracan sto', 6]
  ].map(([brand, body, colour, yearFrom, yearTo, q, count]) => {
    const rec = { brand, body, colour, yearFrom, yearTo };
    const key = createHash('sha1').update(JSON.stringify(rec)).digest('hex').slice(0, 20);
    const days = {}; for (let k = 0; k < count; k++) { const dd = day(Math.floor(r() * 80)); days[dd] = (days[dd] || 0) + 1; }
    return { key: `demo-${key}`, demo: true, ...rec, count, firstAt: new Date(now - 85 * DAY).toISOString(), lastAt: new Date(now - Math.floor(r() * 5) * DAY).toISOString(), days, queries: [q], sources: { concierge: Math.ceil(count * 0.6), shop: Math.floor(count * 0.4) } };
  });

  /* lead counts for the months before the demo leads begin (so a year of history reads end to end) */
  const leadstats = {};
  for (let back = 12; back >= 1; back--) {
    const m = addMonths(cur, -back), mk = ym(m), won = sales.filter((s) => s.month === mk).length;
    const leadsN = Math.round(won / between(r, 0.1, 0.15)); leadstats[mk] = { leads: leadsN, won, lost: Math.round(leadsN * between(r, 0.45, 0.6)) };
  }
  const customerList = [...customers.values()].slice(0, 40).map((c) => ({ id: customerId(c.email), demo: true, name: c.name, email: c.email, phone: c.phone, passwordHash: null, origin: 'demo', createdBy: 'demo', createdAt: c.at, lastLoginAt: null }));
  return { prices, sales, leads, customers: customerList, appointments, demand: asks, leadstats };
}

/* ---------- load / remove ---------- */
const PREFIXES = ['sales/', 'leads/dm', 'customers/', 'appointments/dm', 'demand/demo-', 'demo/'];
async function wipeKeys() {
  let n = 0;
  for (const pre of PREFIXES) {
    const keys = await listKeys('crm', pre);
    if (['customers/', 'leads/dm', 'appointments/dm'].includes(pre)) {
      const rows = await getMany('crm', keys);
      for (let i = 0; i < keys.length; i++) if (rows[i]?.demo) { await deleteRecord('crm', keys[i]); n++; }
    } else for (const k of keys) { await deleteRecord('crm', k); n++; }
  }
  return n;
}
export async function removeDemo() {
  const n = await wipeKeys();
  await store('system').delete(STATE_KEY).catch(() => {});
  cache = { at: 0, state: undefined, prices: null };
  return { removed: n };
}
export async function loadDemo({ now = new Date(), seed } = {}) {
  await wipeKeys();
  const doc = await readDoc('catalog', 'cars');
  const cars = doc?.data?.cars || [];
  if (!cars.length) throw Object.assign(new Error('Import the stock first: there are no cars to build demo data from.'), { code: 'no-stock' });
  const g = generate({ cars, now, seed });
  const put = (key, rec) => putRecord('crm', key, rec);
  await put('demo/prices', { map: g.prices });
  await put('demo/leadstats', { months: g.leadstats });
  for (const s of g.sales) await put(`sales/${s.id}`, s);
  for (const l of g.leads) await put(`leads/${l.id}`, l);
  for (const c of g.customers) await put(`customers/${c.id}`, c);
  for (const a of g.appointments) await put(`appointments/${a.id}`, a);
  for (const d of g.demand) await put(`demand/${d.key}`, d);
  const counts = { cars: Object.keys(g.prices).length, sales: g.sales.length, leads: g.leads.length, customers: g.customers.length, appointments: g.appointments.length, searches: g.demand.length };
  await store('system').setJSON(STATE_KEY, { enabled: true, loadedAt: now.toISOString(), counts });
  cache = { at: 0, state: undefined, prices: null };
  return { counts };
}
export async function demoStatus() {
  const st = await demoState();
  return st ? { enabled: true, loadedAt: st.loadedAt, counts: st.counts } : { enabled: false };
}

/** Sales for the forecast and the planner: the demo ledger, plus real won leads that are not already in it. */
export async function salesLedger(leads, cars = []) {
  const keys = await listKeys('crm', 'sales/');
  const demo = keys.length ? (await getMany('crm', keys)).filter(Boolean) : [];
  const real = (leads || []).filter((l) => l.status === 'won' && !l.demo).map((l) => { const car = cars.find((c) => String(c.id) === String(l.deal?.carId ?? l.car?.id)); return ({ id: `lead-${l.id}`, demo: false, soldAt: l.wonAt || l.updatedAt, month: (l.wonAt || l.updatedAt).slice(0, 7), title: l.deal?.carTitle || l.car?.title || 'Vehicle', brand: car?.brand || null, model: car?.model || null, body: car?.body || null, year: +car?.year || null, price: l.deal?.finalPrice || l.value || 0, cost: car?.cost || null, recon: null, profit: null, daysToSell: null }); });
  return [...demo, ...real].sort((a, b) => a.soldAt.localeCompare(b.soldAt));
}
