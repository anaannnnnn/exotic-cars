import { readDoc } from './store.mjs';
import { getPolicy } from './policy.mjs';
import { all } from './repo.mjs';
import { salesLedger, withDemoPrices, demoLeadStats, demoEnabled } from './demo.mjs';

/*
 * Forecasting, in plain arithmetic a manager can check by hand.
 *   level   a weighted moving average of the last months (recent months count more), after removing the season
 *   trend   the slope of a straight line through the same months
 *   season  each calendar month's strength against an average month (edited in Settings -> Policy)
 *   month k = (level + trend x k) x season, with a band that widens the further ahead it looks
 * Confidence is how steady the history is and how much of it there is. With too little history the numbers come from a
 * clearly labelled baseline (the size of the stock), never from a made-up trend.
 */
const ym = (d) => d.toISOString().slice(0, 7);
const addMonths = (d, n) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const std = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

/** The engine on its own: a series of monthly values (oldest first, ending at `lastMonth`, a Date at the 1st) -> next `horizon` months. */
export function projectSeries(values, lastMonth, season, horizon = 6) {
  const n = values.length;
  const idx = (k) => addMonths(lastMonth, k).getUTCMonth();
  const win = values.slice(-6);
  const wInd = win.map((v, i) => { const mi = addMonths(lastMonth, i - (win.length - 1)).getUTCMonth(); return season[mi] ? v / season[mi] : v; });
  const w = wInd.map((_, i) => i + 1);
  const level = wInd.length ? wInd.reduce((s, v, i) => s + v * w[i], 0) / w.reduce((s, x) => s + x, 0) : 0;
  let slope = 0;
  if (wInd.length >= 3) {
    const xs = wInd.map((_, i) => i), mx = mean(xs), my = mean(wInd);
    const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    slope = den ? xs.reduce((s, x, i) => s + (x - mx) * (wInd[i] - my), 0) / den : 0;
  }
  /* a trend is only believed when it is a modest share of the level; otherwise it is damped */
  const maxSlope = level * 0.18;
  slope = Math.max(-maxSlope, Math.min(maxSlope, slope));
  const spread = std(wInd);
  const cv = level ? spread / level : 1;
  const confidence = Math.max(0.05, Math.min(0.95, (1 - Math.min(1, cv)) * Math.min(1, n / 6)));
  const months = [];
  for (let k = 1; k <= horizon; k++) {
    const base = Math.max(0, level + slope * (k + (wInd.length - 1) / 2 - (wInd.length - 1) / 2));
    const value = base * season[idx(k)];
    const band = 1.28 * spread * Math.sqrt(1 + k / 6) * season[idx(k)];
    months.push({ month: ym(addMonths(lastMonth, k)), value: Math.round(value * 10) / 10, lo: Math.max(0, Math.round((value - band) * 10) / 10), hi: Math.round((value + band) * 10) / 10 });
  }
  return { level: Math.round(level * 100) / 100, slope: Math.round(slope * 100) / 100, confidence: Math.round(confidence * 100) / 100, months };
}

const monthsBack = (now, n) => Array.from({ length: n }, (_, i) => ym(addMonths(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), i - (n - 1))));
const r1 = (n) => Math.round(n * 10) / 10;
const sum = (a, f = (x) => x) => a.reduce((s, x) => s + f(x), 0);

/** Months of sales, oldest first, ending with the month before `now`'s (the running month is incomplete). */
function monthlySales(ledger, now, n = 12) {
  const months = monthsBack(now, n + 1).slice(0, -1);
  return months.map((m) => {
    const rows = ledger.filter((x) => x.month === m);
    const withDays = rows.filter((x) => x.daysToSell != null), withProfit = rows.filter((x) => x.profit != null);
    return { month: m, units: rows.length, revenue: sum(rows, (x) => x.price || 0), profit: sum(withProfit, (x) => x.profit), avgDays: withDays.length ? Math.round(sum(withDays, (x) => x.daysToSell) / withDays.length) : null };
  });
}

export async function buildForecast({ horizon = 6, now = new Date() } = {}) {
  const [leads, carsDoc, policy, demoOn, demoStats] = await Promise.all([all('leads/'), readDoc('catalog', 'cars'), getPolicy(), demoEnabled(), demoLeadStats()]);
  const cars = await withDemoPrices(carsDoc?.data?.cars || []);
  const ledger = await salesLedger(leads, cars);
  const cur = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const hist = monthsBack(now, 12);
  const sales = monthlySales(ledger, now, 12);
  const salesBy = Object.fromEntries(sales.map((s) => [s.month, s]));
  const by = Object.fromEntries(hist.map((m) => [m, { month: m, leads: 0, lost: 0 }]));
  leads.forEach((l) => {
    const m = l.createdAt.slice(0, 7); if (by[m]) by[m].leads += 1;
    if (l.status === 'lost') { const lm = l.updatedAt.slice(0, 7); if (by[lm]) by[lm].lost += 1; }
  });
  /* months before the demo leads begin come from the demo lead counts */
  hist.forEach((m) => { if (demoOn && demoStats[m] && demoStats[m].leads > by[m].leads) { by[m].leads = demoStats[m].leads; by[m].lost = Math.max(by[m].lost, demoStats[m].lost); } });
  const history = hist.map((m) => ({ month: m, leads: by[m].leads, lost: by[m].lost, won: salesBy[m]?.units ?? 0, revenue: Math.round(salesBy[m]?.revenue ?? 0), profit: Math.round(salesBy[m]?.profit ?? 0), avgDays: salesBy[m]?.avgDays ?? null }));
  const complete = history.slice(0, -1);
  const forSale = cars.filter((c) => !c.sold && !c.hidden);
  const lastComplete = addMonths(cur, -1);

  const soldSeries = complete.map((h) => h.won);
  const activeSales = soldSeries.filter((v) => v > 0).length;
  const closedWon = sum(complete, (h) => h.won), closedLost = sum(complete, (h) => h.lost);
  const conversion = closedWon + closedLost >= 20 ? closedWon / (closedWon + closedLost) : policy.conversionBaseline;
  const last6 = sales.slice(-6);
  const price6 = sum(last6, (s) => s.revenue) / Math.max(1, sum(last6, (s) => s.units));
  const profit6 = sum(last6, (s) => s.profit) / Math.max(1, sum(last6, (s) => s.units));
  const wonVals = ledger.map((x) => x.price).filter(Boolean);
  const priced = forSale.map((c) => c.price).filter(Boolean);
  const avgDeal = sum(last6, (s) => s.units) ? price6 : wonVals.length ? mean(wonVals) : priced.length ? mean(priced) : null;
  const marginPct = sum(last6, (s) => s.revenue) && sum(last6, (s) => s.profit) ? (sum(last6, (s) => s.profit) / sum(last6, (s) => s.revenue)) * 100 : policy.grossMarginPct;

  let method = 'sales', basis;
  let unitFc;
  if (activeSales >= 4 && closedWon >= 12) {
    basis = `Built from ${activeSales} months of cars actually sold${demoOn ? ' (including the demo sales ledger)' : ''}: price, cost and days to sell are taken from those sales.`;
    unitFc = projectSeries(soldSeries, lastComplete, policy.seasonality, horizon);
  } else {
    method = 'baseline';
    basis = 'Not enough sales history yet, so this is a baseline from the size of the showroom (about 3% of the cars sell in a month), shaped by the season. It sharpens as cars are sold. Load the demo data in Settings to see a full year.';
    const flat = Array(6).fill(Math.max(1, Math.round(forSale.length * 0.03)));
    unitFc = projectSeries(flat.map((v, i) => v * policy.seasonality[addMonths(lastComplete, i - 5).getUTCMonth()]), lastComplete, policy.seasonality, horizon);
    unitFc.confidence = 0.15;
  }
  const leadSeries = complete.map((h) => h.leads);
  const leadFc = projectSeries(leadSeries.some((v) => v > 0) ? leadSeries : Array(6).fill(Math.max(1, Math.round(forSale.length * 0.08))), lastComplete, policy.seasonality, horizon);

  const open = leads.filter((l) => ['new', 'contacted', 'qualified', 'negotiating'].includes(l.status));
  const priceById = new Map(cars.filter((c) => c.price).map((c) => [String(c.id), c.price]));
  const dealValue = (l) => l.deal?.finalPrice || l.value || priceById.get(String(l.car?.id ?? l.deal?.carId)) || 0;
  const stages = ['new', 'contacted', 'qualified', 'negotiating'].map((s) => {
    const list = open.filter((l) => l.status === s);
    const value = list.reduce((t, l) => t + dealValue(l), 0);
    return { status: s, count: list.length, value, probability: policy.stageProbability[s], weighted: Math.round(value * policy.stageProbability[s]) };
  });
  const pipelineWeighted = stages.reduce((s, x) => s + x.weighted, 0);
  const months = unitFc.months.map((m, i) => {
    const l = leadFc.months[i];
    const rev = (n) => (avgDeal ? Math.round(n * avgDeal) : null), prof = (n) => Math.round(n * (profit6 || (avgDeal ? avgDeal * (policy.grossMarginPct / 100) : 0)));
    return { month: m.month, leads: l.value, leadsLo: l.lo, leadsHi: l.hi, wins: m.value, winsLo: m.lo, winsHi: m.hi, revenue: rev(m.value), revenueLo: rev(m.lo), revenueHi: rev(m.hi), profit: avgDeal ? prof(m.value) : null, profitLo: avgDeal ? prof(m.lo) : null, profitHi: avgDeal ? prof(m.hi) : null };
  });

  /* where the money comes from: the last 12 months by make, and by model, with the trend against the six months before */
  const lastYear = ledger.filter((x) => x.month >= hist[0] && x.month <= hist[10]);
  const mk = new Map();
  lastYear.filter((x) => x.brand).forEach((x) => { const m = mk.get(x.brand) || { brand: x.brand, units: 0, revenue: 0, profit: 0, days: [], recent: 0, earlier: 0 }; m.units += 1; m.revenue += x.price; m.profit += x.profit ?? 0; if (x.daysToSell != null) m.days.push(x.daysToSell); if (x.month >= hist[5]) m.recent += 1; else m.earlier += 1; mk.set(x.brand, m); });
  const byMake = [...mk.values()].map((m) => ({ brand: m.brand, units: m.units, share: Math.round((m.units / Math.max(1, lastYear.length)) * 1000) / 10, revenue: Math.round(m.revenue), avgPrice: Math.round(m.revenue / m.units), margin: m.revenue ? Math.round((m.profit / m.revenue) * 1000) / 10 : null, avgDays: m.days.length ? Math.round(mean(m.days)) : null, trend: m.earlier ? Math.round(((m.recent - m.earlier) / m.earlier) * 100) : null })).sort((a, b) => b.revenue - a.revenue);
  const ytdStart = `${now.getUTCFullYear()}-01`;
  const ytd = ledger.filter((x) => x.month >= ytdStart);
  return {
    generatedAt: now.toISOString(), horizon, method, basis, confidence: unitFc.confidence, demo: demoOn, monthsOfHistory: activeSales, totalSales: closedWon,
    history, months, stages, pipeline: { open: open.length, value: stages.reduce((s, x) => s + x.value, 0), weighted: pipelineWeighted }, byMake,
    totals: { units12: sum(complete, (h) => h.won), revenue12: sum(complete, (h) => h.revenue), profit12: sum(complete, (h) => h.profit), unitsYtd: ytd.length, revenueYtd: Math.round(sum(ytd, (x) => x.price || 0)) },
    assumptions: {
      conversion: Math.round(conversion * 1000) / 1000, conversionSource: closedWon + closedLost >= 20 ? 'your sales and lost leads over the last year' : `a starting estimate (${policy.conversionBaseline * 100}%) until enough leads are closed`,
      avgDeal: avgDeal ? Math.round(avgDeal) : null, avgDealSource: sum(last6, (s) => s.units) ? 'the cars sold in the last 6 months' : wonVals.length ? 'the cars you have sold' : priced.length ? 'the average listed price in stock' : null,
      grossMarginPct: Math.round(marginPct * 10) / 10, profitPerCar: Math.round(profit6) || null, avgDaysToSell: (() => { const d = last6.filter((s) => s.avgDays != null); return d.length ? Math.round(mean(d.map((s) => s.avgDays))) : null; })(),
      level: unitFc.level, slope: unitFc.slope, seasonality: policy.seasonality
    }
  };
}

/* ========================================================================================================
   The calculator: the same arithmetic as the Nexus forecast calculator, for one car or one model.
   Demand over the period, what the stock will cover, what to buy, and what it earns - with the working shown.
   ======================================================================================================== */
export const EVENTS = [
  { key: 'none', label: 'No special event', uplift: 0, months: [] },
  { key: 'cool', label: 'Cool-season peak (October to March)', uplift: 0.08, months: [9, 10, 11, 0, 1, 2] },
  { key: 'dsf', label: 'Dubai Shopping Festival (December to January)', uplift: 0.1, months: [11, 0] },
  { key: 'national_day', label: 'UAE National Day (December)', uplift: 0.06, months: [11] },
  { key: 'motor_show', label: 'Motor show and launch season (November)', uplift: 0.09, months: [10] },
  { key: 'eid', label: 'Eid holidays', uplift: 0.12, months: [3, 6] },
  { key: 'ramadan', label: 'Ramadan (quieter showroom)', uplift: -0.14, months: [2, 3] },
  { key: 'summer', label: 'Summer slowdown (June to August)', uplift: -0.2, months: [5, 6, 7] }
];

export function calcForecast(inp, policy) {
  const hist = inp.history.map((n) => Math.max(0, Number(n) || 0));
  const periodDays = inp.periodDays, months = Math.max(1, Math.ceil(periodDays / 30));
  const startMonth = inp.month, lastMonth = new Date(Date.UTC(2026, startMonth - 1, 1));
  const proj = projectSeries(hist, lastMonth, policy.seasonality, months + 1);
  const ev = EVENTS.find((e) => e.key === inp.event) || EVENTS[0];
  const f = 1 + ev.uplift;
  const full = Math.floor(periodDays / 30), rem = periodDays / 30 - full;
  const take = (key) => sum(proj.months.slice(0, full), (m) => m[key]) + (rem > 0 ? rem * (proj.months[full]?.[key] ?? 0) : 0);
  /* the months' uncertainty adds up like independent errors (square root of the sum of squares), not end to end */
  const spread = Math.sqrt(sum(proj.months.slice(0, full), (m) => (m.hi - m.value) ** 2) + (rem > 0 ? (rem * ((proj.months[full]?.hi ?? 0) - (proj.months[full]?.value ?? 0))) ** 2 : 0));
  const qty = take('value') * f, qtyLo = Math.max(0, qty - spread * f), qtyHi = qty + spread * f;
  const perDay = qty / periodDays;
  const stock = inp.stock, safety = inp.safety;
  const leadDemand = perDay * inp.leadDays;
  const reorderPoint = Math.ceil(leadDemand + safety);
  const poQty = Math.max(0, Math.ceil(qty + safety - stock - 0.0001));
  const cover = perDay > 0 ? stock / perDay : null;
  const unitNet = inp.price * (1 - inp.discountPct / 100), unitCost = inp.cost + inp.recon, unitProfit = unitNet - unitCost;
  const marginPct = unitNet > 0 ? (unitProfit / unitNet) * 100 : 0;
  /* a car can only be sold if it is on the floor: what is in stock now, and what arrives after the lead time */
  const shortfall = Math.max(0, leadDemand - stock);
  const supply = stock + poQty;
  const unitsSold = Math.max(0, Math.min(qty - shortfall, supply));
  const revenue = unitsSold * unitNet, cogs = unitsSold * unitCost, gross = revenue - cogs;
  const avgStock = (stock + Math.max(supply - qty, safety)) / 2;
  const holding = avgStock * inp.cost * (inp.holdingPct / 100) * (periodDays / 30);
  const net = gross - holding;
  const lostRevenue = shortfall * unitNet, lostProfit = shortfall * unitProfit;
  const scen = (q) => { const u = Math.max(0, Math.min(q - shortfall, supply)); return { units: r1(q), sold: r1(u), revenue: Math.round(u * unitNet), profit: Math.round(u * unitProfit) }; };
  const stockoutDate = cover != null ? new Date(Date.now() + cover * 864e5).toISOString().slice(0, 10) : null;
  const priceForTarget = unitCost / (1 - inp.targetMarginPct / 100) / (1 - inp.discountPct / 100);

  const steps = [
    `Demand: ${hist.length} months of sales, newest weighted most, with the season taken out, gives a level of ${proj.level} a month and a trend of ${proj.slope >= 0 ? '+' : ''}${proj.slope} a month.`,
    `Over ${periodDays} days that is ${r1(take('value'))} cars${ev.uplift ? `, ${ev.uplift > 0 ? 'plus' : 'minus'} ${Math.abs(Math.round(ev.uplift * 100))}% for "${ev.label}"` : ''}: ${r1(qty)} cars (${r1(qtyLo)} to ${r1(qtyHi)} if it goes worse or better).`,
    `Over the ${inp.leadDays}-day lead time you will sell about ${r1(leadDemand)}, so the reorder point is ${reorderPoint} cars (that plus ${safety} safety).`,
    `To buy = demand ${r1(qty)} + safety ${safety} - in stock ${stock} = ${poQty} car${poQty === 1 ? '' : 's'}${poQty ? `, ${Math.round(poQty * unitCost).toLocaleString('en-AE')} AED at ${Math.round(unitCost).toLocaleString('en-AE')} each including preparation` : ''}.`,
    `Each car earns ${Math.round(unitNet).toLocaleString('en-AE')} (after ${inp.discountPct}% discount) - ${Math.round(unitCost).toLocaleString('en-AE')} = ${Math.round(unitProfit).toLocaleString('en-AE')} AED, a ${r1(marginPct)}% margin.`,
    `Holding cost: about ${r1(avgStock)} cars on the floor on average x ${inp.holdingPct}% of cost a month = ${Math.round(holding).toLocaleString('en-AE')} AED over the period.`
  ];
  const insights = [];
  if (!(proj.confidence >= 0.4)) insights.push({ tone: 'risk', text: `Confidence is ${Math.round(proj.confidence * 100)}%: the history is short or uneven, so read the numbers as a range (${r1(qtyLo)} to ${r1(qtyHi)} cars).` });
  else insights.push({ tone: 'ok', text: `Confidence is ${Math.round(proj.confidence * 100)}%: the months of sales are steady enough to trust the central figure.` });
  if (proj.slope > 0.15) insights.push({ tone: 'up', text: `Sales are trending up (+${proj.slope} cars a month). Buying a little ahead of the trend would be reasonable.` });
  else if (proj.slope < -0.15) insights.push({ tone: 'down', text: `Sales are trending down (${proj.slope} cars a month). Avoid adding more than the forecast needs.` });
  if (ev.uplift) insights.push({ tone: 'season', text: `${ev.label}: demand is adjusted ${ev.uplift > 0 ? 'up' : 'down'} by ${Math.abs(Math.round(ev.uplift * 100))}% for the period.` });
  if (shortfall > 0.5) insights.push({ tone: 'risk', text: `Stock will run out before new cars can arrive: about ${r1(shortfall)} car${shortfall > 1.5 ? 's' : ''} of demand in the ${inp.leadDays}-day lead time cannot be met, worth about AED ${Math.round(lostProfit).toLocaleString('en-AE')} of profit. Order now or source faster.` });
  if (cover != null && cover > 180) insights.push({ tone: 'risk', text: `The stock covers ${Math.round(cover)} days of sales. Holding that many ties up capital (about AED ${Math.round(stock * inp.cost).toLocaleString('en-AE')}); do not buy more, and consider featuring or repricing.` });
  if (marginPct < inp.targetMarginPct) insights.push({ tone: 'risk', text: `The margin is ${r1(marginPct)}%, below your ${inp.targetMarginPct}% target. To reach it, price the car at about AED ${Math.round(priceForTarget).toLocaleString('en-AE')} or buy it for less.` });
  else insights.push({ tone: 'ok', text: `The margin of ${r1(marginPct)}% meets your ${inp.targetMarginPct}% target.` });
  if (poQty > 0 && shortfall <= 0.5) insights.push({ tone: 'action', text: `Buy ${poQty} car${poQty > 1 ? 's' : ''} within ${Math.max(0, Math.round((cover ?? 0) - inp.leadDays))} days so they land before the stock runs out.` });
  if (poQty === 0) insights.push({ tone: 'action', text: 'No purchase needed for this period: the stock already covers the forecast plus the safety buffer.' });
  return {
    forecast: { qty: r1(qty), qtyLo: r1(qtyLo), qtyHi: r1(qtyHi), perDay: Math.round(perDay * 1000) / 1000, perMonth: proj.months.slice(0, months).map((m) => ({ month: m.month, units: m.value, lo: m.lo, hi: m.hi })), level: proj.level, slope: proj.slope, confidence: Math.round(proj.confidence * 100), event: ev },
    stock: { onHand: stock, safety, leadDays: inp.leadDays, leadDemand: r1(leadDemand), reorderPoint, coverDays: cover == null ? null : Math.round(cover), stockoutDate, shortfall: r1(shortfall) },
    purchase: { qty: poQty, unitCost: Math.round(unitCost), cost: Math.round(poQty * unitCost) },
    money: { unitNet: Math.round(unitNet), unitCost: Math.round(unitCost), unitProfit: Math.round(unitProfit), marginPct: r1(marginPct), unitsSold: r1(unitsSold), revenue: Math.round(revenue), cogs: Math.round(cogs), grossProfit: Math.round(gross), holdingCost: Math.round(holding), netProfit: Math.round(net), lostRevenue: Math.round(lostRevenue), lostProfit: Math.round(lostProfit), priceForTargetMargin: Math.round(priceForTarget), breakEvenPrice: Math.round(unitCost / (1 - inp.discountPct / 100)) },
    scenarios: { worst: scen(qtyLo), expected: scen(qty), best: scen(qtyHi) },
    steps, insights,
    report: { history: hist.map((u, i) => ({ month: ym(addMonths(lastMonth, i - (hist.length - 1))), units: u })), months: proj.months.slice(0, months).map((m) => ({ month: m.month, units: m.value, lo: m.lo, hi: m.hi })) }
  };
}

/** Everything the calculator's pickers need: the makes and models the showroom stocks and sells, with what it knows about each. */
export async function forecastCatalog({ now = new Date() } = {}) {
  const [leads, carsDoc, policy] = await Promise.all([all('leads/'), readDoc('catalog', 'cars'), getPolicy()]);
  const cars = await withDemoPrices(carsDoc?.data?.cars || []);
  const ledger = await salesLedger(leads, cars);
  const forSale = cars.filter((c) => !c.sold && !c.hidden);
  const months = monthsBack(now, 13).slice(0, -1);
  const key = (b, m) => `${b}|${m}`;
  const stockBy = new Map(), soldBy = new Map();
  forSale.forEach((c) => { const k = key(c.brand, c.model); const x = stockBy.get(k) || { brand: c.brand, model: c.model, stock: 0, prices: [], costs: [] }; x.stock += 1; if (c.price) x.prices.push(c.price); if (c.cost) x.costs.push(c.cost); stockBy.set(k, x); });
  ledger.filter((x) => x.brand && x.month >= months[0]).forEach((x) => { const k = key(x.brand, x.model); const y = soldBy.get(k) || { units: 0, rev: 0, costs: [], recon: [], days: [], series: Object.fromEntries(months.map((m) => [m, 0])) }; y.units += 1; y.rev += x.price; if (x.cost) y.costs.push(x.cost); if (x.recon) y.recon.push(x.recon); if (x.daysToSell != null) y.days.push(x.daysToSell); if (y.series[x.month] !== undefined) y.series[x.month] += 1; soldBy.set(k, y); });
  const keys = new Set([...stockBy.keys(), ...soldBy.keys()]);
  const models = [...keys].map((k) => {
    const [brand, model] = k.split('|'), s = stockBy.get(k), y = soldBy.get(k);
    return { brand, model, stock: s?.stock || 0, units12: y?.units || 0, avgPrice: y ? Math.round(y.rev / y.units) : s?.prices.length ? Math.round(mean(s.prices)) : null };
  }).sort((a, b) => b.units12 - a.units12 || b.stock - a.stock);
  const makes = [...new Set(models.map((m) => m.brand))].map((b) => ({ brand: b, stock: sum(models.filter((m) => m.brand === b), (m) => m.stock), units12: sum(models.filter((m) => m.brand === b), (m) => m.units12) })).sort((a, b) => b.units12 - a.units12 || b.stock - a.stock);
  return { makes, models, events: EVENTS.map(({ key: k, label, uplift, months: mo }) => ({ key: k, label, uplift, months: mo })), defaults: { leadDays: Math.round(policy.purchasing.leadTimeMonths * 30), periodDays: 90, targetMarginPct: policy.purchasing.targetMarginPct, holdingPct: policy.purchasing.holdingPctPerMonth, reconPct: policy.purchasing.reconPct }, months };
}

/** Starting figures for one make (and model): twelve months of sales, what is in stock, and typical price, cost and days to sell. */
export async function forecastSuggest({ brand, model, now = new Date() }) {
  const [leads, carsDoc, policy] = await Promise.all([all('leads/'), readDoc('catalog', 'cars'), getPolicy()]);
  const cars = await withDemoPrices(carsDoc?.data?.cars || []);
  const ledger = (await salesLedger(leads, cars)).filter((x) => x.brand === brand && (!model || x.model === model));
  const months = monthsBack(now, 13).slice(0, -1);
  const history = months.map((m) => ledger.filter((x) => x.month === m).length);
  const stockList = cars.filter((c) => !c.sold && !c.hidden && c.brand === brand && (!model || c.model === model));
  const sold = ledger.filter((x) => x.month >= months[months.length - 6]);
  const pool = sold.length >= 3 ? sold : ledger;
  const priced = stockList.map((c) => c.price).filter(Boolean), costs = stockList.map((c) => c.cost).filter(Boolean);
  const price = pool.length ? Math.round(mean(pool.map((x) => x.price))) : priced.length ? Math.round(mean(priced)) : 0;
  const cost = pool.filter((x) => x.cost).length ? Math.round(mean(pool.filter((x) => x.cost).map((x) => x.cost))) : costs.length ? Math.round(mean(costs)) : Math.round(price * 0.86);
  const recon = pool.filter((x) => x.recon).length ? Math.round(mean(pool.filter((x) => x.recon).map((x) => x.recon))) : Math.round(price * (policy.purchasing.reconPct / 100));
  const days = ledger.filter((x) => x.daysToSell != null).map((x) => x.daysToSell);
  const discount = pool.filter((x) => x.discountPct != null).length ? Math.round(mean(pool.filter((x) => x.discountPct != null).map((x) => x.discountPct)) * 10) / 10 : 0;
  const stock = stockList.length, units12 = sum(history);
  return { brand, model: model || null, history, months, stock, safety: Math.max(1, Math.round((units12 / 12) * policy.purchasing.safetyMonths)), price, cost, recon, discountPct: discount, avgDaysToSell: days.length ? Math.round(mean(days)) : null, units12, source: ledger.length ? `${ledger.length} sales in the last year` : 'no sales yet: enter your own numbers' };
}
