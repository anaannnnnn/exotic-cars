import { readDoc } from './store.mjs';
import { getPolicy } from './policy.mjs';
import { all, norm } from './repo.mjs';
import { projectSeries } from './forecast.mjs';
import { demandGaps } from './demand.mjs';
import { salesLedger, withDemoPrices, demoEnabled } from './demo.mjs';

/*
 * The purchasing planner: which cars to buy, how many, up to what price, from where, and in what order when money is limited.
 * It works one model at a time (a Cullinan and a Phantom are different buys), then adds the models up by make. All of it is
 * plain arithmetic a buyer can check:
 *
 *   demand       the model's own sales over the last year (season taken out, recent months counting more); where it has too few
 *                sales, its share of the make's sales; where the make has too few, enquiries x the share that buy
 *   to buy       demand x (lead time + cover wanted + a safety buffer that grows as confidence falls) - cars in stock
 *   max bid      what a car sells for, less the margin wanted, the preparation, and the cost of holding it while it sells
 *   priority     urgency first (how soon the stock runs out), then return on the money (profit per dirham spent)
 *   budget       cars are funded in priority order until the budget or a make's share of it runs out; the rest wait
 *
 * Every row carries its reasons in words, and says where its numbers came from.
 */
const MS = 864e5;
const addMonths = (d, n) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
const ym = (d) => d.toISOString().slice(0, 7);
const r1 = (n) => Math.round(n * 10) / 10;
const r0 = (n) => Math.round(n);
const sum = (a, f = (x) => x) => a.reduce((s, x) => s + f(x), 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const cv = (a) => { if (a.length < 2) return 0; const m = mean(a); return m ? Math.sqrt(mean(a.map((x) => (x - m) ** 2))) / m : 0; };
const aed = (n) => `AED ${new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(n)}`;
const title = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());
const nice = (b) => ({ 'Rolls Royce': 'Rolls-Royce', 'Mercedes Benz': 'Mercedes-Benz' }[b] || b);
const roundBid = (n) => (n >= 1e6 ? Math.round(n / 5000) * 5000 : Math.round(n / 1000) * 1000);
const TURN = 4;                                                       /* months a typical luxury car sits, used only with no history at all */
const APPETITE = { cautious: { buffer: 0.5, cover: 0.8 }, balanced: { buffer: 1, cover: 1 }, bold: { buffer: 1.5, cover: 1.25 } };
const BANDS = [['Under 300k', 0, 3e5], ['300k to 600k', 3e5, 6e5], ['600k to 1M', 6e5, 1e6], ['1M to 2M', 1e6, 2e6], ['Over 2M', 2e6, 1e12]];
const AGE_BUCKETS = [['0 to 30 days', 0, 30], ['31 to 60 days', 31, 60], ['61 to 90 days', 61, 90], ['91 to 180 days', 91, 180], ['Over 180 days', 181, 1e5]];
const URG_RANK = { critical: 0, urgent: 1, plan: 2, ok: 3 };

export async function buildPlan({ now = new Date(), budget, appetite = 'balanced', cover } = {}) {
  const [leads, appts, carsDoc, policy, gaps, demoOn] = await Promise.all([all('leads/'), all('appointments/'), readDoc('catalog', 'cars'), getPolicy(), demandGaps({ days: 90 }), demoEnabled()]);
  const cars = await withDemoPrices(carsDoc?.data?.cars || []);
  const ledger = await salesLedger(leads, cars);
  const P = policy.purchasing, ap = APPETITE[appetite] || APPETITE.balanced;
  const lt = P.leadTimeMonths, tc = (cover ?? P.targetCoverMonths) * ap.cover, sf = P.safetyMonths * ap.buffer;
  const money = budget != null && Number.isFinite(Number(budget)) ? Number(budget) : P.monthlyBudget;
  const cur = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const months = Array.from({ length: 12 }, (_, i) => ym(addMonths(cur, i - 12)));          /* the 12 complete months before this one */
  const sale = cars.filter((c) => !c.sold && !c.hidden);
  const brands = [...new Set([...sale.map((c) => c.brand), ...ledger.map((x) => x.brand).filter(Boolean)])];
  const ageOf = (c) => (c.listedAt ? Math.max(0, Math.round((now - Date.parse(c.listedAt)) / MS)) : null);

  /* ---- signals for makes with too little sales history: enquiries, builds, test drives and the searches nothing answered ---- */
  const brandOf = (text, carId) => {
    const car = carId != null ? cars.find((c) => String(c.id) === String(carId)) : null;
    if (car) return car.brand;
    const t = norm(text);
    return brands.find((b) => t.includes(norm(b))) || null;
  };
  const enq = Object.fromEntries(brands.map((b) => [b, { leads: 0, builds: 0, drives: 0 }]));
  leads.forEach((l) => {
    const b = brandOf(l.car?.title || l.deal?.carTitle, l.car?.id ?? l.deal?.carId);
    if (!b || !enq[b] || Date.parse(l.createdAt) < now - 180 * MS) return;
    enq[b].leads += 1; if (l.type === 'configuration') enq[b].builds += 1;
  });
  appts.forEach((a) => { const b = brandOf(a.car); if (b && enq[b] && /drive|viewing/i.test(a.service || '') && Date.parse(a.createdAt) > now - 180 * MS) enq[b].drives += 1; });
  const gapBy = {}, gapRows = gaps.data;
  gapRows.forEach((g) => { if (g.brand) { const b = brands.find((x) => norm(x) === norm(g.brand)) || title(g.brand); gapBy[b] = (gapBy[b] || 0) + g.asks; } });

  /* ---- sales by model and make: 12 months of units, price, cost, days ---- */
  const sold12 = ledger.filter((x) => x.brand && x.month >= months[0] && x.month <= months[11]);
  const seriesOf = (rs) => months.map((m) => rs.filter((x) => x.month === m).length);
  const mkKey = (b, m) => `${b}|${m}`;
  const group = (list, keyFn) => { const m = new Map(); list.forEach((x) => { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return m; };
  const modelSales = group(sold12, (x) => mkKey(x.brand, x.model));
  const makeSales = group(sold12, (x) => x.brand);
  const makeUnitsPerMonth = (b) => {
    const rs = makeSales.get(b) || [];
    if (rs.length >= 5) { const p = projectSeries(seriesOf(rs), addMonths(cur, -1), policy.seasonality, 3); return { v: sum(p.months, (m) => m.value) / 3, conf: p.confidence, basis: 'the make\'s sales' }; }
    const e = enq[b]; const gapU = ((gapBy[b] || 0) / 3) * policy.conversionBaseline * 2;
    const fromLeads = e && e.leads ? (e.leads / 6) * policy.conversionBaseline * 4 : 0;
    return { v: fromLeads + gapU, conf: 0.15, basis: 'enquiries and searches' };
  };

  const stockBy = group(sale, (c) => mkKey(c.brand, c.model));
  const keys = new Set([...stockBy.keys(), ...modelSales.keys()]);
  const seasonNext = Array.from({ length: 6 }, (_, i) => policy.seasonality[addMonths(cur, i).getUTCMonth()]);
  const rows = [];
  for (const k of keys) {
    const [brand, model] = k.split('|');
    const stockCars = stockBy.get(k) || [], salesRows = modelSales.get(k) || [];
    if (!stockCars.length && salesRows.length < 2) continue;      /* a model we neither stock nor really sell is not a purchase to plan */
    const stock = stockCars.length;
    const priced = stockCars.filter((c) => c.price), costed = stockCars.filter((c) => c.cost);
    const ages = stockCars.map(ageOf).filter((x) => x != null);
    /* demand in cars a month */
    const mk = makeUnitsPerMonth(brand), makeStock = sale.filter((c) => c.brand === brand).length || 1;
    let units, conf, basis;
    if (salesRows.length >= 4 && seriesOf(salesRows).filter((x) => x > 0).length >= 3) {
      const p = projectSeries(seriesOf(salesRows), addMonths(cur, -1), policy.seasonality, 3); units = sum(p.months, (m) => m.value) / 3; conf = p.confidence; basis = 'this model\'s own sales';
    } else if (mk.v > 0) { const share = stock ? stock / makeStock : 0.05; units = mk.v * share; conf = Math.min(0.35, mk.conf); basis = mk.basis === 'the make\'s sales' ? 'its share of the make\'s sales' : 'enquiries and searches'; }
    else { units = stock / TURN; conf = 0.1; basis = 'the stock itself (no history)'; }
    units = Math.max(0, units);
    const hasHistory = conf >= 0.2 && basis !== 'the stock itself (no history)';
    const coverMonths = units > 0 ? stock / units : null;
    const buffer = sf * (1 - conf);
    /* economics: from what this model really sold for, otherwise the listed prices in stock */
    const recent = salesRows.filter((x) => x.month >= months[6]), pool = recent.length >= 3 ? recent : salesRows;
    const sellPrice = pool.length ? mean(pool.map((x) => x.price)) : priced.length ? mean(priced.map((c) => c.price)) : null;
    const histCost = pool.filter((x) => x.cost).length ? mean(pool.filter((x) => x.cost).map((x) => x.cost)) : costed.length ? mean(costed.map((c) => c.cost)) : null;
    const histRecon = pool.filter((x) => x.recon).length ? mean(pool.filter((x) => x.recon).map((x) => x.recon)) : sellPrice ? (sellPrice * P.reconPct) / 100 : null;
    const dts = median(salesRows.map((x) => x.daysToSell).filter((x) => x != null));
    const expDays = dts ?? (units > 0 ? Math.round((30 / units) * Math.min(stock || 1, 3)) : 90);
    const holdPct = P.holdingPctPerMonth * (expDays / 30);
    const maxBid = sellPrice ? sellPrice * (1 - P.targetMarginPct / 100 - P.reconPct / 100 - holdPct / 100) : null;
    const profitRows = pool.filter((x) => x.profit != null);
    const histProfit = profitRows.length ? mean(profitRows.map((x) => x.profit)) : null;
    const priceCv = cv(salesRows.map((x) => x.price));
    let buy = 0, urgency = 'ok';
    const reasons = [];
    if (hasHistory) {
      buy = Math.max(0, Math.ceil(units * (lt + tc + buffer) - stock - 0.0001));
      urgency = coverMonths == null ? 'ok' : coverMonths < lt ? 'critical' : coverMonths < lt + tc / 2 ? 'urgent' : coverMonths < lt + tc ? 'plan' : 'ok';
      reasons.push(`Sells about ${r1(units)} a month (${basis}); ${stock} in stock covers ${coverMonths == null ? 'no sales' : coverMonths < 24 ? `${r1(coverMonths)} months` : 'more than 24 months'}. Sourcing takes ${lt} months.`);
      if (buy > 0) reasons.push(`To hold ${r1(tc)} months of cover when new cars land${buffer > 0.05 ? ` (plus ${r1(buffer)} spare months because demand is uncertain)` : ''}, buy ${buy}.`);
      else if (coverMonths != null && coverMonths > lt + tc * 1.8) reasons.push(`Overstocked: ${r1(coverMonths)} months of cover. Do not buy more of this until it sells down.`);
      else reasons.push('Covered for now. No purchase suggested.');
    } else if (stock === 0 && units > 0) { buy = Math.max(1, Math.ceil(units * (lt + tc))); urgency = 'plan'; reasons.push(`None in stock and ${basis} point to demand: buy ${buy} to test it.`); }
    else reasons.push(`${stock} in stock. Not enough history on this model to plan from, so nothing is suggested.`);
    const aged = stockCars.filter((c) => (ageOf(c) ?? 0) > P.slowMoverDays);
    if (aged.length) reasons.push(`${aged.length} of the ${stock} have been listed more than ${P.slowMoverDays} days: feature or reprice before buying more.`);
    const trend = salesRows.length >= 6 ? (() => { const a = salesRows.filter((x) => x.month >= months[6]).length, b = salesRows.length - a; return b ? Math.round(((a - b) / b) * 100) : null; })() : null;
    if (trend != null && Math.abs(trend) >= 25) reasons.push(`Sales are ${trend > 0 ? 'up' : 'down'} ${Math.abs(trend)}% in the last six months against the six before.`);
    /* risk: slow, old, uneven prices, thin evidence */
    const risk = Math.min(100, r0((aged.length / Math.max(1, stock)) * 35 + Math.min(1, priceCv) * 25 + (1 - conf) * 25 + (expDays > 90 ? 15 : expDays > 60 ? 8 : 0)));
    const unitNeed = maxBid && buy ? maxBid + (histRecon || 0) : null;
    if (buy > 0 && urgency === 'ok') urgency = 'plan';
    rows.push({
      brand, model, stock, stockValue: r0(sum(priced, (c) => c.price)), stockCost: r0(sum(costed, (c) => c.cost)), avgAge: ages.length ? r0(mean(ages)) : null, aged: aged.length,
      sold12: salesRows.length, sold6: recent.length, trend, unitsPerMonth: r1(units), demandBasis: basis, confidence: Math.round(conf * 100), coverMonths: coverMonths == null ? null : r1(coverMonths),
      avgPrice: sellPrice ? r0(sellPrice) : null, avgCost: histCost ? r0(histCost) : null, avgRecon: histRecon ? r0(histRecon) : null, avgProfit: histProfit != null ? r0(histProfit) : null, marginPct: sellPrice && histProfit != null ? r1((histProfit / sellPrice) * 100) : null,
      daysToSell: dts != null ? r0(dts) : null, expectedDays: r0(expDays), maxBid: maxBid ? roundBid(maxBid) : null, buy, urgency, risk, reasons, hasHistory,
      unitSpend: unitNeed ? roundBid(unitNeed) : null, targetProfit: histProfit != null && histProfit > 0 ? r0(histProfit) : sellPrice && maxBid ? r0((sellPrice * P.targetMarginPct) / 100) : null
    });
  }
  rows.forEach((r) => { r.roi = r.buy && r.unitSpend && r.targetProfit ? r1((r.targetProfit / r.unitSpend) * 100) : null; });
  rows.sort((a, b) => URG_RANK[a.urgency] - URG_RANK[b.urgency] || (b.roi ?? -1) - (a.roi ?? -1) || b.buy - a.buy || b.sold12 - a.sold12);

  /* ---- fund the buys in priority order within the budget and each make's share of it ---- */
  const fundable = rows.filter((r) => r.buy > 0 && (r.unitSpend || r.maxBid));
  const fundWith = (total) => {
    const capMake = (total * P.maxMakeSharePct) / 100;
    const makeSpend = {}; let left = total;
    return rows.filter((r) => r.buy > 0).map((r) => {
      const unit = r.unitSpend || r.maxBid;
      let alloc = r.buy, why = null;
      if (!unit) { alloc = 0; why = 'No price known yet, so it cannot be costed: set a listed price or log a sale.'; }
      else {
        const byMoney = Math.floor(left / unit), byMake = Math.floor(((capMake - (makeSpend[r.brand] || 0)) + 1e-6) / unit);
        alloc = Math.max(0, Math.min(r.buy, byMoney, byMake));
        if (alloc < r.buy) why = byMake < byMoney && byMake < r.buy ? `Capped by the ${P.maxMakeSharePct}% limit on one make` : 'Budget used up';
        left -= alloc * unit; makeSpend[r.brand] = (makeSpend[r.brand] || 0) + alloc * unit;
      }
      return { brand: r.brand, model: r.model, urgency: r.urgency, buy: r.buy, alloc, deferred: r.buy - alloc, unit: unit || null, spend: unit ? r0(alloc * unit) : 0, profit: r.targetProfit ? r0(alloc * r.targetProfit) : 0, roi: r.roi, why };
    });
  };
  const lines = fundWith(money);
  const spent = sum(lines, (l) => l.spend);
  const need = sum(fundable, (r) => r.buy * (r.unitSpend || r.maxBid));
  const scenarios = [0.5, 0.75, 1, 1.25, 1.5, 2].map((f) => { const ls = fundWith(money * f); const sp = sum(ls, (l) => l.spend), pr = sum(ls, (l) => l.profit); return { factor: f, budget: r0(money * f), cars: sum(ls, (l) => l.alloc), spend: r0(sp), profit: r0(pr), roi: sp ? r1((pr / sp) * 100) : null }; });

  /* ---- the whole stock: aging, capital, concentration, price bands, body mix ---- */
  const costOf = (c) => c.cost || (c.price ? c.price * 0.86 : 0);
  const aging = AGE_BUCKETS.map(([label, lo, hi]) => { const cs = sale.filter((c) => { const a = ageOf(c); return a != null && a >= lo && a <= hi; }); return { label, units: cs.length, value: r0(sum(cs, (c) => c.price || 0)), cost: r0(sum(cs, costOf)) }; });
  const ageTotal = sum(aging, (a) => a.units) || 1;
  aging.forEach((a) => { a.share = r1((a.units / ageTotal) * 100); });
  const slowMovers = sale.map((c) => ({ c, age: ageOf(c) })).filter((x) => x.age != null && x.age > P.slowMoverDays).sort((a, b) => b.age - a.age).slice(0, 14).map(({ c, age }) => ({ id: c.id, title: c.title, brand: c.brand, ageDays: age, price: c.price || null, cost: c.cost ? r0(c.cost) : null, holding: c.cost ? r0(c.cost * (P.holdingPctPerMonth / 100) * (age / 30)) : null }));
  const totalCost = sum(sale, costOf) || 1;
  const concentration = brands.map((b) => { const cs = sale.filter((c) => c.brand === b); return { brand: b, units: cs.length, cost: r0(sum(cs, costOf)), share: r1((sum(cs, costOf) / totalCost) * 100) }; }).filter((x) => x.units).sort((a, b) => b.cost - a.cost).slice(0, 10);
  concentration.forEach((x) => { x.flag = x.share > P.maxMakeSharePct ? 'over' : x.share > P.maxMakeSharePct * 0.8 ? 'near' : null; });
  const pricedStock = sale.filter((c) => c.price).length;
  const priceBands = BANDS.map(([label, lo, hi]) => { const st = sale.filter((c) => c.price && c.price >= lo && c.price < hi), sd = sold12.filter((x) => x.price >= lo && x.price < hi); return { label, stock: st.length, sold: sd.length, stockShare: r1((st.length / Math.max(1, pricedStock)) * 100), salesShare: r1((sd.length / Math.max(1, sold12.length)) * 100) }; });
  priceBands.forEach((b) => { b.gap = r1(b.salesShare - b.stockShare); });
  const bodies = [...new Set([...sale.map((c) => c.body), ...sold12.map((x) => x.body)].filter(Boolean))];
  const asksTotal = sum(gapRows.filter((g) => g.body), (g) => g.asks);
  const bodyMix = bodies.map((body) => ({ body, stock: sale.filter((c) => c.body === body).length, sold: sold12.filter((x) => x.body === body).length, asks: sum(gapRows.filter((g) => g.body && norm(g.body) === norm(body)), (g) => g.asks) })).sort((a, b) => b.sold - a.sold);
  bodyMix.forEach((b) => { b.stockShare = r1((b.stock / Math.max(1, sale.length)) * 100); b.demandShare = r1(((b.sold + b.asks) / Math.max(1, sold12.length + asksTotal)) * 100); b.gap = r1(b.demandShare - b.stockShare); });

  /* ---- where cars were bought: channel economics from the ledger ---- */
  const channels = [...group(sold12.filter((x) => x.acquisition), (x) => x.acquisition).entries()].map(([channel, rs]) => ({ channel, units: rs.length, share: r1((rs.length / Math.max(1, sold12.length)) * 100), avgCostVsList: r1(mean(rs.map((x) => (x.cost / x.listPrice) * 100))), avgDays: r0(mean(rs.map((x) => x.daysToSell))), avgProfit: r0(mean(rs.map((x) => x.profit))), marginPct: r1((sum(rs, (x) => x.profit) / Math.max(1, sum(rs, (x) => x.price))) * 100) })).sort((a, b) => b.avgProfit - a.avgProfit);
  const bestChannelFor = (b) => { const g = group((makeSales.get(b) || []).filter((x) => x.acquisition), (x) => x.acquisition); const best = [...g.entries()].filter(([, v]) => v.length >= 3).sort((a, c) => mean(c[1].map((x) => x.profit)) - mean(a[1].map((x) => x.profit)))[0]; return best ? best[0] : null; };

  /* ---- buying calendar: when demand peaks, and so when cars should already be on the floor ---- */
  const calendar = seasonNext.map((idx, i) => { const m = addMonths(cur, i); const land = addMonths(m, -Math.round(lt)); return { month: ym(m), index: idx, note: idx >= 1.15 ? 'Peak: cars should be on the floor beforehand' : idx <= 0.78 ? 'Quiet: buy selectively, mostly for the next peak' : 'Steady', buyBy: idx >= 1.1 ? ym(land) : null }; });

  /* ---- the shopping list: concrete cars to go and find ---- */
  const colourAsks = (b) => { const c = {}; gapRows.filter((g) => g.brand && norm(g.brand) === norm(b) && g.colour).forEach((g) => { c[g.colour] = (c[g.colour] || 0) + g.asks; }); return Object.entries(c).sort((a, d) => d[1] - a[1]).slice(0, 3).map(([k]) => title(k)); };
  const shopping = lines.filter((l) => l.alloc > 0).slice(0, 12).map((l) => {
    const r = rows.find((x) => x.brand === l.brand && x.model === l.model);
    const ys = (modelSales.get(mkKey(l.brand, l.model)) || []).map((x) => x.year).filter(Boolean).sort((a, b) => a - b);
    return { qty: l.alloc, brand: l.brand, model: l.model, years: ys.length ? `${ys[Math.floor(ys.length * 0.25)]} to ${ys[ys.length - 1]}` : null, maxBid: r?.maxBid || null, spend: l.spend, urgency: l.urgency, channel: bestChannelFor(l.brand), colours: colourAsks(l.brand), sellFor: r?.avgPrice || null, expectedProfit: l.profit, days: r?.expectedDays || null };
  });

  /* ---- makes: the models added up ---- */
  const makes = brands.map((b) => {
    const rs = rows.filter((r) => r.brand === b), ms = makeSales.get(b) || [];
    const rev = sum(ms, (x) => x.price), profit = sum(ms.filter((x) => x.profit != null), (x) => x.profit);
    const worst = rs.map((r) => r.urgency).sort((a, c) => URG_RANK[a] - URG_RANK[c])[0] || 'ok';
    const days = ms.map((x) => x.daysToSell).filter((x) => x != null);
    return { brand: b, stock: sum(rs, (r) => r.stock), models: rs.length, sold12: ms.length, revenue12: r0(rev), margin: rev ? r1((profit / rev) * 100) : null, avgDays: days.length ? r0(mean(days)) : null, buy: sum(rs, (r) => r.buy), urgency: worst, stockCost: sum(rs, (r) => r.stockCost), asks: gapBy[b] || 0, channel: bestChannelFor(b) };
  }).filter((m) => m.stock || m.sold12).sort((a, b) => URG_RANK[a.urgency] - URG_RANK[b.urgency] || b.buy - a.buy || b.revenue12 - a.revenue12);

  const unmet = gapRows.filter((g) => !g.brand || g.inStockNow === 0).slice(0, 10).map((g) => ({ label: g.label, asks: g.asks, estimatedValue: g.estimatedValue }));
  const buying = rows.filter((r) => r.buy > 0);
  const stockUnits = sale.length, stockCostTotal = r0(sum(sale, costOf));
  const gross12 = sum(sold12.filter((x) => x.profit != null), (x) => x.profit);
  const old = aging.filter((a) => ['91 to 180 days', 'Over 180 days'].includes(a.label));
  const oldUnits = sum(old, (a) => a.units), oldCost = sum(old, (a) => a.cost);
  const insights = [];
  const top = lines.find((l) => l.alloc > 0);
  if (top) insights.push(`First on the list: ${top.alloc} x ${nice(top.brand)} ${top.model}, up to ${aed(top.unit)} each (${top.urgency === 'critical' ? 'it runs out before new cars could arrive' : top.urgency === 'urgent' ? 'it runs out soon' : 'to keep cover'}).`);
  if (need > money && lines.some((l) => l.deferred)) insights.push(`The full plan needs ${aed(need)} but the budget is ${aed(money)}. ${aed(spent)} funds the highest-priority cars; ${sum(lines, (l) => l.deferred)} wait.`);
  const over = concentration.find((c) => c.flag === 'over');
  if (over) insights.push(`${nice(over.brand)} is ${over.share}% of the money tied up in stock, above the ${P.maxMakeSharePct}% limit. Do not add to it until it sells down.`);
  if (oldUnits) insights.push(`${oldUnits} car${oldUnits > 1 ? 's' : ''} (${aed(oldCost)} at cost) have been listed over 90 days. Each month they sit costs about ${aed((oldCost * P.holdingPctPerMonth) / 100)} to hold.`);
  const bigBand = priceBands.filter((b) => b.gap >= 8).sort((a, b) => b.gap - a.gap)[0];
  if (bigBand) insights.push(`The ${bigBand.label} band is ${bigBand.salesShare}% of sales but only ${bigBand.stockShare}% of stock: it is under-stocked.`);
  if (unmet[0]) insights.push(`Customers keep asking for ${unmet[0].label} (${unmet[0].asks} times in 90 days) and none is in stock.`);
  const peak = calendar.find((c) => c.index >= 1.15);
  if (peak) insights.push(`Demand peaks in ${new Date(`${peak.month}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long' })}. With ${lt} months to source a car, buy for it by ${new Date(`${peak.buyBy || peak.month}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long' })}.`);
  if (!insights.length) insights.push('Stock and demand are in balance. Nothing urgent to buy.');
  const risks = rows.filter((r) => r.risk >= 55 && r.stock).slice(0, 6).map((r) => ({ title: `${nice(r.brand)} ${r.model}`, risk: r.risk, text: r.reasons[0] }));
  const dts = sold12.map((x) => x.daysToSell).filter((x) => x != null);
  return {
    generatedAt: now.toISOString(), demo: demoOn, params: { ...P, budget: money, appetite, cover: r1(tc) }, conversion: policy.conversionBaseline,
    basis: sold12.length >= 12 ? `Planned from ${sold12.length} sales in the last 12 months${demoOn ? ' (including the demo sales ledger)' : ''}, model by model.` : 'There is little sales history yet, so most rows are planned from enquiries and the stock itself. Load the demo data in Settings to see a full year.',
    summary: {
      toBuy: sum(buying, (r) => r.buy), lines: buying.length, critical: rows.filter((r) => r.urgency === 'critical').length, urgent: rows.filter((r) => r.urgency === 'urgent').length, need: r0(need), budget: r0(money), allocated: r0(spent), cars: sum(lines, (l) => l.alloc), deferred: sum(lines, (l) => l.deferred),
      expectedProfit: sum(lines, (l) => l.profit), roi: spent ? r1((sum(lines, (l) => l.profit) / spent) * 100) : null, stockUnits, stockValue: r0(sum(sale, (c) => c.price || 0)), stockCost: stockCostTotal, aged90Units: oldUnits, aged90Cost: r0(oldCost),
      turns: stockUnits ? r1(sold12.length / stockUnits) : null, gmroi: stockCostTotal ? r1(gross12 / stockCostTotal) : null, avgDaysToSell: dts.length ? r0(mean(dts)) : null, sold12: sold12.length
    },
    insights, rows, makes, allocation: { budget: r0(money), spent: r0(spent), remaining: r0(Math.max(0, money - spent)), lines, scenarios }, aging, slowMovers, concentration, priceBands, bodyMix, channels, calendar, shopping, risks, unmet
  };
}

/** Ask the planner a plain question; it answers from the same plan, in words, with the rows behind the answer. */
export async function askPlanner(q) {
  const plan = await buildPlan();
  const t = norm(q), S = plan.summary;
  const row = [...plan.rows].sort((a, b) => b.model.length - a.model.length).find((r) => r.model.length > 2 && t.includes(norm(r.model)) && t.includes(norm(r.brand).split(' ')[0])) || plan.rows.find((r) => r.model.length > 4 && t.includes(norm(r.model)));
  if (row) return { text: `${nice(row.brand)} ${row.model}: ${row.stock} in stock, sells about ${row.unitsPerMonth} a month (${row.demandBasis}), cover ${row.coverMonths ?? 'n/a'} months. ${row.avgPrice ? `Typically sells for ${aed(row.avgPrice)}${row.daysToSell ? ` in ${row.daysToSell} days` : ''}${row.marginPct != null ? `, ${row.marginPct}% margin` : ''}.` : ''} ${row.buy ? `Buy ${row.buy}${row.maxBid ? `, up to ${aed(row.maxBid)} each` : ''}.` : 'No purchase suggested.'}`, rows: [row] };
  const make = plan.makes.find((m) => t.includes(norm(m.brand)) || t.includes(norm(nice(m.brand))));
  if (make) { const rs = plan.rows.filter((r) => r.brand === make.brand && r.buy > 0).slice(0, 4); return { text: `${nice(make.brand)}: ${make.stock} in stock across ${make.models} models, ${make.sold12} sold in 12 months${make.margin != null ? ` at ${make.margin}% margin` : ''}${make.avgDays ? `, ${make.avgDays} days to sell` : ''}. ${make.buy ? `To buy: ${rs.map((r) => `${r.buy} x ${r.model}`).join(', ')}.` : 'Nothing to buy right now.'}${make.channel ? ` Best source: ${make.channel}.` : ''}`, rows: rs }; }
  if (/\b(slow|old|stuck|aged|aging|not selling|dead stock)\b/.test(t)) return plan.slowMovers.length ? { text: `${plan.slowMovers.length} slow movers, oldest first: ${plan.slowMovers.slice(0, 4).map((s) => `${s.title} (${s.ageDays} days)`).join(', ')}. ${S.aged90Units} cars over 90 days tie up ${aed(S.aged90Cost)} at cost. Feature or reprice them before buying more.` } : { text: 'Nothing has been listed for longer than the slow-mover limit.' };
  if (/\b(budget|spend|afford|how much|cost|fund)\b/.test(t)) return { text: `The full plan needs ${aed(S.need)}; with a budget of ${aed(S.budget)} you can fund ${S.cars} cars for ${aed(S.allocated)}, earning about ${aed(S.expectedProfit)} (${S.roi ?? 'n/a'}% on the money). ${S.deferred ? `${S.deferred} more wait for budget.` : ''}`, rows: plan.allocation.lines.filter((l) => l.alloc).slice(0, 6) };
  if (/\b(margin|profit|earn|roi|return)\b/.test(t)) { const best = [...plan.rows].filter((r) => r.marginPct != null).sort((a, b) => b.marginPct - a.marginPct).slice(0, 3); return { text: best.length ? `Highest margins over the last year: ${best.map((r) => `${nice(r.brand)} ${r.model} ${r.marginPct}%`).join(', ')}. The plan as a whole should return about ${S.roi ?? 'n/a'}% on the money spent.` : 'There is no sales history with costs yet, so margins cannot be shown.' }; }
  if (/\b(channel|source|where|auction|trade|import|dealer)\b/.test(t)) return plan.channels.length ? { text: `By profit per car: ${plan.channels.slice(0, 4).map((c) => `${c.channel} ${aed(c.avgProfit)} (bought at ${c.avgCostVsList}% of list, ${c.avgDays} days to sell)`).join('; ')}.` } : { text: 'No acquisition history yet.' };
  if (/\b(ask|asking|wanted|missing|demand|looking for|request)\b/.test(t)) return plan.unmet.length ? { text: `Customers asked for and did not find: ${plan.unmet.slice(0, 5).map((u) => `${u.label} (${u.asks})`).join(', ')}.` } : { text: 'No unmet requests in the last 90 days.' };
  if (/\b(season|peak|when|calendar|winter|summer)\b/.test(t)) return { text: plan.insights.find((i) => /peaks/.test(i)) || 'Demand is steady over the coming months.', rows: [] };
  const buying = plan.rows.filter((r) => r.buy);
  return buying.length ? { text: `Buy ${S.toBuy} cars this cycle (${S.cars} within budget). Most urgent: ${buying.slice(0, 3).map((r) => `${r.buy} x ${nice(r.brand)} ${r.model} (${r.urgency})`).join(', ')}.`, rows: buying.slice(0, 6) } : { text: 'Nothing to buy: stock covers expected sales.' };
}
