import { createHash } from 'node:crypto';
import { readDoc, getRecord, putRecord, serial, listKeys, getMany } from './store.mjs';
import { getPolicy } from './policy.mjs';

/*
 * Demand the stock could not meet. Every time a customer searches the concierge or the shop for something we do not
 * have, it is counted here by what they asked for (make, body, colour, years). The CRM turns the counts into "customers
 * asked for X and we had none", with what that is probably worth - something a point-of-sale system can never see.
 */
const clean = (s) => (s ? String(s).toLowerCase().trim().slice(0, 40) : null);

export async function recordDemand(input) {
  const rec = { brand: clean(input.brand), body: clean(input.body), colour: clean(input.colour), yearFrom: input.yearFrom || null, yearTo: input.yearTo || null };
  if (!rec.brand && !rec.body && !rec.colour && !rec.yearFrom) return { recorded: false };
  const key = createHash('sha1').update(JSON.stringify(rec)).digest('hex').slice(0, 20);
  const day = new Date().toISOString().slice(0, 10);
  await serial(`crm/demand/${key}`, async () => {
    const cur = (await getRecord('crm', `demand/${key}`)) || { key, ...rec, count: 0, firstAt: new Date().toISOString(), days: {}, queries: [], sources: {} };
    cur.count += 1; cur.lastAt = new Date().toISOString();
    cur.days[day] = (cur.days[day] || 0) + 1;
    const days = Object.keys(cur.days).sort(); while (days.length > 60) delete cur.days[days.shift()];
    cur.sources[input.source || 'other'] = (cur.sources[input.source || 'other'] || 0) + 1;
    const q = String(input.query || '').slice(0, 120);
    if (q && !cur.queries.includes(q)) cur.queries = [q, ...cur.queries].slice(0, 5);
    await putRecord('crm', `demand/${key}`, cur);
  });
  return { recorded: true };
}

const cap = (s) => s && String(s).replace(/\b\w/g, (c) => c.toUpperCase());
const label = (d) => [cap(d.colour), cap(d.brand), cap(d.body), d.yearFrom ? (d.yearTo && d.yearTo !== d.yearFrom ? `${d.yearFrom}-${d.yearTo}` : String(d.yearFrom)) : null].filter(Boolean).join(' ');

/** Ranked list: what was asked for, how often, how recently, and the likely value of the sales that slipped past. */
export async function demandGaps({ days = 90 } = {}) {
  const [rows, doc, policy] = await Promise.all([getMany('crm', await listKeys('crm', 'demand/')), readDoc('catalog', 'cars'), getPolicy()]);
  const cars = doc?.data?.cars || [];
  const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const avg = (brand) => {
    const priced = cars.filter((c) => c.price && (!brand || String(c.brand).toLowerCase() === brand));
    return priced.length ? priced.reduce((s, c) => s + c.price, 0) / priced.length : null;
  };
  const out = rows.map((d) => {
    const recent = Object.entries(d.days || {}).filter(([k]) => k >= cutoff).reduce((s, [, n]) => s + n, 0);
    const price = avg(d.brand);
    const inStock = cars.filter((c) => !c.sold && !c.hidden && (!d.brand || String(c.brand).toLowerCase() === d.brand) && (!d.colour || new RegExp(`\\b${d.colour.replace(/[^a-z]/g, '')}\\b`, 'i').test(String(c.exterior || '')))).length;
    return { key: d.key, label: label(d) || 'Anything', brand: d.brand, body: d.body, colour: d.colour, yearFrom: d.yearFrom, yearTo: d.yearTo, asks: recent, total: d.count, lastAt: d.lastAt, queries: d.queries, inStockNow: inStock, avgPrice: price, estimatedValue: price ? Math.round(recent * policy.conversionBaseline * price) : null };
  }).filter((d) => d.asks > 0).sort((a, b) => b.asks - a.asks || b.lastAt.localeCompare(a.lastAt));
  return { days, data: out.slice(0, 40), totalAsks: out.reduce((s, d) => s + d.asks, 0), estimatedValue: out.reduce((s, d) => s + (d.estimatedValue || 0), 0) || null, conversion: policy.conversionBaseline };
}
