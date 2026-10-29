import { h, icon, aed, compact, num, chip, skeleton, errorState, segmented, toast, failed, select, input } from '../ui.js';
import { get, post, qs } from '../api.js';
import { trendChart, monthShort, monthLong, meter, downloadCsv } from '../charts.js';

/*
 * Forecast, in two parts:
 *   Calculator       pick a make and model (or type your own numbers), and it works out demand over the period, what the stock covers,
 *                    what to buy and what it earns - with the working shown (the same shape as the DevX Nexus forecast calculator).
 *   Showroom outlook the next 3, 6 or 12 months for the whole showroom, with a what-if you can move.
 * Everything is plain arithmetic; the figures it starts from are shown, with where each came from.
 */
const TONE = { up: ['trend', 'green'], down: ['alert', 'red'], season: ['calendar', 'violet'], risk: ['alert', 'red'], action: ['check', 'blue'], ok: ['check', 'green'] };
const num1 = (n) => (n == null ? '—' : new Intl.NumberFormat('en-AE', { maximumFractionDigits: 1 }).format(n));

export function mountForecast(view, _p, ctx) {
  let alive = true, tab = 'calc';
  view.append(h('header', { class: 'phead' }, [h('div', {}, [h('p', { class: 'phead__eyebrow', text: 'Looking ahead' }), h('h1', { class: 'phead__title', text: 'Forecast' })])]));
  const tabs = segmented([['calc', 'Calculator'], ['outlook', 'Showroom outlook']], 'calc', (v) => { tab = v; calcPane.hidden = v !== 'calc'; outPane.hidden = v !== 'outlook'; if (v === 'outlook' && !outLoaded) loadOutlook(); }, { label: 'Forecast view' });
  view.append(h('div', { class: 'toolbar' }, [h('div', { class: 'toolbar__seg' }, tabs.el)]));
  const demoBar = h('div', { class: 'banner banner--info', hidden: true });
  const calcPane = h('div', { class: 'fc' }), outPane = h('div', { class: 'fc', hidden: true });
  view.append(demoBar, calcPane, outPane);
  get('admin/demo').then((d) => { if (alive && d.enabled) { demoBar.hidden = false; demoBar.replaceChildren(icon('spark'), h('div', {}, [h('b', { text: 'Demo data is on' }), h('p', { text: 'The sales history, prices and costs here are realistic sample data, so every screen has something to show. Turn it off in Settings → Demo data.' })])); } }).catch(() => {});

  /* ================================================================== calculator */
  let cat = null, sug = null, last = null;
  const f = {};
  const mkField = (label, control, hint) => h('label', { class: 'fld pl-fld' }, [h('span', { class: 'fld__l', text: label }), control, hint ? h('small', { class: 'muted', text: hint }) : null]);
  const numIn = (name, value, attrs = {}) => input(name, value, { type: 'number', inputmode: 'decimal', min: 0, step: 'any', ...attrs });

  async function initCalc() {
    calcPane.replaceChildren(...skeleton(5).children);
    try { cat = await get('admin/forecast/catalog'); } catch (e) { calcPane.replaceChildren(errorState(e, initCalc)); return; }
    if (!alive) return;
    buildForm();
    const top = cat.models.find((m) => m.units12 > 0) || cat.models[0];
    if (top) { f.make.value = top.brand; fillModels(); f.model.value = top.model; await loadSuggest(true); } else showEmpty();
  }

  function buildForm() {
    const now = new Date(), mi = now.getMonth();
    f.make = select('make', [['', 'Choose a make…'], ...cat.makes.map((m) => [m.brand, `${m.brand}  ·  ${m.units12} sold, ${m.stock} in stock`])], '');
    f.model = select('model', [['', 'All models of the make']], '');
    f.search = input('search', '', { type: 'search', placeholder: 'Search a make or model…', 'aria-label': 'Search models', list: 'fc-models' });
    f.list = h('datalist', { id: 'fc-models' }, cat.models.slice(0, 400).map((m) => h('option', { value: `${m.brand} ${m.model}` })));
    f.period = select('period', [['30', '30 days'], ['60', '60 days'], ['90', '90 days (a quarter)'], ['180', '6 months'], ['365', '12 months']], String(cat.defaults.periodDays));
    f.month = select('month', Array.from({ length: 12 }, (_, i) => [String(i), new Date(2026, i, 1).toLocaleDateString('en-GB', { month: 'long' })]), String(mi));
    const defEvent = cat.events.find((e) => e.uplift && e.months.includes(mi))?.key || 'none';
    f.event = select('event', cat.events.map((e) => [e.key, `${e.label}${e.uplift ? ` (${e.uplift > 0 ? '+' : ''}${Math.round(e.uplift * 100)}%)` : ''}`]), defEvent);
    f.hist = Array.from({ length: 12 }, (_, i) => numIn(`m${i}`, '', { placeholder: '0', 'aria-label': `Month ${i + 1} sales` }));
    f.histLbl = Array.from({ length: 12 }, (_, i) => h('small', { class: 'pl-hist__l', text: `M${i + 1}` }));
    f.stock = numIn('stock', 0); f.safety = numIn('safety', 0); f.lead = numIn('lead', cat.defaults.leadDays);
    f.price = numIn('price', '', { step: 1000 }); f.cost = numIn('cost', '', { step: 1000 }); f.recon = numIn('recon', '', { step: 500 });
    f.disc = numIn('disc', 0, { step: 0.1 }); f.hold = numIn('hold', cat.defaults.holdingPct, { step: 0.05 }); f.margin = numIn('margin', cat.defaults.targetMarginPct, { step: 0.5 });
    f.src = h('p', { class: 'muted small pl-src' });
    f.make.addEventListener('change', () => { fillModels(); loadSuggest(true); });
    f.model.addEventListener('change', () => loadSuggest(true));
    f.search.addEventListener('change', () => { const q = f.search.value.trim().toLowerCase(); const m = cat.models.find((x) => `${x.brand} ${x.model}`.toLowerCase() === q) || cat.models.find((x) => `${x.brand} ${x.model}`.toLowerCase().includes(q)); if (m) { f.make.value = m.brand; fillModels(); f.model.value = m.model; loadSuggest(true); } });
    f.month.addEventListener('change', () => { const e = cat.events.find((x) => x.uplift && x.months.includes(+f.month.value)); f.event.value = e?.key || 'none'; });
    const go = h('button', { class: 'btn btn--primary btn--block', type: 'button', onclick: () => calc() }, [icon('spark'), 'Calculate forecast']);
    const form = h('form', { class: 'pl-form', onsubmit: (e) => { e.preventDefault(); calc(); } }, [
      h('div', { class: 'pl-pick' }, [h('div', { class: 'pl-pick__t', text: 'Pick a car to start from' }), h('div', { class: 'pl-grid2' }, [mkField('Make', f.make), mkField('Model', f.model)]), mkField('Or search', f.search), f.list, f.src]),
      h('div', { class: 'pl-grid2' }, [mkField('Forecast period', f.period), mkField('Starting month', f.month)]),
      h('div', { class: 'pl-hist' }, [h('div', { class: 'pl-hist__t', text: 'Cars sold each month, oldest to newest' }), h('div', { class: 'pl-hist__g' }, f.hist.map((inp, i) => h('div', { class: 'pl-hist__c' }, [f.histLbl[i], inp])))]),
      h('div', { class: 'pl-grid3' }, [mkField('In stock now', f.stock), mkField('Safety stock', f.safety, 'Spare cars you never want to dip below'), mkField('Lead time (days)', f.lead, 'To find and bring a car in')]),
      h('div', { class: 'pl-grid3' }, [mkField('Selling price (AED)', f.price), mkField('Buying cost (AED)', f.cost), mkField('Preparation (AED)', f.recon)]),
      h('div', { class: 'pl-grid3' }, [mkField('Average discount %', f.disc), mkField('Holding cost %/month', f.hold, 'Of the car\'s cost, for finance and insurance'), mkField('Target margin %', f.margin)]),
      mkField('Dubai season or event', f.event),
      go
    ]);
    f.out = h('div', { class: 'pl-out' }, [h('div', { class: 'empty' }, [h('p', { text: 'Pick a car or fill in the numbers, then press Calculate.' })])]);
    f.conf = h('span', { class: 'chip' , text: '—' });
    calcPane.replaceChildren(h('div', { class: 'pl-wrap' }, [
      h('section', { class: 'card pl-card' }, [h('header', { class: 'card__head' }, [h('h2', { text: 'Forecast calculator' }), h('small', { text: `${cat.models.length} models` })]), form]),
      h('section', { class: 'card pl-card' }, [h('header', { class: 'card__head' }, [h('h2', { text: 'Result' }), f.conf]), f.out])
    ]));
  }
  function fillModels() {
    const ms = cat.models.filter((m) => m.brand === f.make.value);
    f.model.replaceChildren(h('option', { value: '', text: 'All models of the make' }), ...ms.map((m) => h('option', { value: m.model, text: `${m.model}  ·  ${m.units12} sold, ${m.stock} in stock` })));
  }
  async function loadSuggest(run) {
    if (!f.make.value) return;
    f.src.textContent = 'Loading the sales history…';
    try { sug = await get(`admin/forecast/suggest${qs({ brand: f.make.value, model: f.model.value || undefined })}`); } catch (e) { f.src.textContent = ''; failed(e); return; }
    if (!alive) return;
    sug.history.forEach((v, i) => { f.hist[i].value = v; });
    sug.months.forEach((m, i) => { f.histLbl[i].textContent = monthShort(m); });
    f.stock.value = sug.stock; f.safety.value = sug.safety; f.price.value = sug.price || ''; f.cost.value = sug.cost || ''; f.recon.value = sug.recon || ''; f.disc.value = sug.discountPct || 0;
    f.src.textContent = `${sug.source}${sug.avgDaysToSell ? ` · about ${sug.avgDaysToSell} days to sell` : ''}. You can change any number.`;
    if (run) calc();
  }
  const showEmpty = () => { f.out.replaceChildren(h('div', { class: 'empty' }, [h('p', { text: 'There is no sales history yet. Type your own numbers on the left, or load the demo data in Settings to see the calculator with a full year.' })])); };

  async function calc() {
    const history = f.hist.map((i) => i.value).filter((v) => v !== '').map(Number);
    if (!history.length) { toast('Enter at least one month of sales', 'error'); return; }
    if (!(Number(f.price.value) > 0)) { toast('Enter the selling price first', 'error'); f.price.focus(); return; }
    const body = { history, stock: +f.stock.value || 0, safety: +f.safety.value || 0, leadDays: +f.lead.value || 0, periodDays: +f.period.value, price: +f.price.value, cost: +f.cost.value || 0, recon: +f.recon.value || 0, discountPct: +f.disc.value || 0, holdingPct: +f.hold.value || 0, targetMarginPct: +f.margin.value || 0, month: +f.month.value, event: f.event.value };
    f.out.replaceChildren(h('p', { class: 'muted', text: 'Working it out…' }));
    try { const r = await post('admin/forecast/calc', body); if (alive) { last = { r, body }; render(r, body); } } catch (e) { f.out.replaceChildren(errorState(e, calc)); }
  }

  function render(r, body) {
    const F = r.forecast, S = r.stock, M = r.money, P = r.purchase, label = f.model.value ? `${f.make.value} ${f.model.value}` : f.make.value || 'This car';
    f.conf.textContent = `${F.confidence}% confidence`; f.conf.className = `chip chip--${F.confidence >= 60 ? 'green' : F.confidence >= 35 ? 'amber' : 'red'}`;
    const tile = (k, v, s, hot) => h('div', { class: `fc__tile${hot ? ' fc__tile--hot' : ''}` }, [h('small', { text: k }), h('b', { text: v }), h('span', { text: s })]);
    const out = [];
    out.push(h('p', { class: 'pl-title' }, [h('b', { text: label }), h('span', { class: 'muted', text: ` · next ${body.periodDays} days${F.event.uplift ? ` · ${F.event.label}` : ''}` })]));
    out.push(h('div', { class: 'fc__res' }, [
      tile('Forecast demand', `${num1(F.qty)} cars`, `${num1(F.qtyLo)} to ${num1(F.qtyHi)} likely`, true),
      tile('Forecast revenue', `AED ${compact(M.revenue)}`, `${num1(M.unitsSold)} cars at ${aed(M.unitNet)}`),
      tile('Buy', P.qty ? `${P.qty} car${P.qty > 1 ? 's' : ''}` : 'Nothing', P.qty ? `AED ${compact(P.cost)} at ${aed(P.unitCost)} each` : 'stock covers it'),
      tile('Gross profit', `AED ${compact(M.grossProfit)}`, `${M.marginPct}% margin · ${aed(M.unitProfit)} a car`)
    ]));
    out.push(h('div', { class: 'fc__res' }, [
      tile('Stock covers', S.coverDays == null ? '—' : S.coverDays > 999 ? 'Years' : `${S.coverDays} days`, S.stockoutDate ? `runs out about ${new Date(S.stockoutDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}` : 'no sales expected'),
      tile('Reorder point', `${S.reorderPoint} cars`, `${num1(S.leadDemand)} sold in ${S.leadDays} days + ${S.safety} safety`),
      tile('Holding cost', `AED ${compact(M.holdingCost)}`, `net profit AED ${compact(M.netProfit)}`),
      tile(S.shortfall > 0.5 ? 'Demand you would miss' : 'Price for target margin', S.shortfall > 0.5 ? `${num1(S.shortfall)} cars` : aed(M.priceForTargetMargin), S.shortfall > 0.5 ? `about AED ${compact(M.lostProfit)} of profit` : `break-even ${aed(M.breakEvenPrice)}`)
    ]));
    out.push(h('div', { class: 'pl-chartbox' }, trendChart({ hist: r.report.history.map((x) => ({ label: monthShort(x.month), v: x.units })), fc: r.report.months.map((m) => ({ label: monthShort(m.month), v: m.units, lo: m.lo, hi: m.hi })), fmt: (v) => String(Math.round(v * 10) / 10) })));
    out.push(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, [
      h('thead', {}, h('tr', {}, ['Scenario', 'Cars demanded', 'Cars sold', 'Revenue', 'Gross profit'].map((t, i) => h('th', { text: t, class: i ? 'r' : '' })))),
      h('tbody', {}, [['Worse than expected', 'worst'], ['Expected', 'expected'], ['Better than expected', 'best']].map(([t, k]) => { const s = r.scenarios[k]; return h('tr', { class: k === 'expected' ? 'tr--hot' : '' }, [h('td', { text: t }), h('td', { class: 'r', text: num1(s.units) }), h('td', { class: 'r', text: num1(s.sold) }), h('td', { class: 'r', text: aed(s.revenue) }), h('td', { class: 'r', text: aed(s.profit) })]); }))
    ])));
    out.push(h('div', { class: 'pl-two' }, [
      h('div', {}, [h('h3', { class: 'pl-h', text: 'What stands out' }), h('ul', { class: 'pl-ins' }, r.insights.map((i) => h('li', { class: `pl-ins__${i.tone}` }, [h('span', { class: `pl-ins__ic pl-ins__ic--${TONE[i.tone]?.[1] || 'blue'}` }, icon(TONE[i.tone]?.[0] || 'spark')), h('span', { text: i.text })])))]),
      h('div', {}, [h('h3', { class: 'pl-h', text: 'How it was worked out' }), h('ol', { class: 'how__l' }, r.steps.map((s) => h('li', { text: s })))])
    ]));
    out.push(h('div', { class: 'pl-actions' }, [
      h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => exportCalc(label, body, r) }, [icon('download'), 'Download as CSV']),
      h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => { navigator.clipboard?.writeText(`${label}: ${num1(F.qty)} cars in ${body.periodDays} days, buy ${P.qty}, revenue ${aed(M.revenue)}, gross profit ${aed(M.grossProfit)} (${M.marginPct}%).`).then(() => toast('Summary copied')); } }, [icon('copy'), 'Copy summary'])
    ]));
    f.out.replaceChildren(...out);
  }
  function exportCalc(label, b, r) {
    downloadCsv(`forecast-${label.replace(/\W+/g, '-').toLowerCase()}.csv`, [
      ['Forecast calculator', label], ['Period (days)', b.periodDays], ['Event', r.forecast.event.label], [],
      ['Demand (cars)', r.forecast.qty, 'low', r.forecast.qtyLo, 'high', r.forecast.qtyHi], ['Confidence %', r.forecast.confidence], ['In stock', r.stock.onHand], ['Safety stock', r.stock.safety], ['Lead time (days)', r.stock.leadDays], ['Reorder point', r.stock.reorderPoint], ['Stock covers (days)', r.stock.coverDays], ['To buy', r.purchase.qty], ['Purchase cost (AED)', r.purchase.cost], [],
      ['Selling price', b.price], ['Cost + preparation', r.money.unitCost], ['Profit per car', r.money.unitProfit], ['Margin %', r.money.marginPct], ['Revenue', r.money.revenue], ['Gross profit', r.money.grossProfit], ['Holding cost', r.money.holdingCost], ['Net profit', r.money.netProfit], [],
      ['Month', 'Cars', 'Low', 'High'], ...r.forecast.perMonth.map((m) => [m.month, m.units, m.lo, m.hi]), [], ['How it was worked out'], ...r.steps.map((s) => [s])
    ]);
  }

  /* ================================================================== showroom outlook */
  let outLoaded = false, horizon = 6, fo = null;
  const hz = segmented([['3', '3 months'], ['6', '6 months'], ['12', '12 months']], '6', (v) => { horizon = +v; loadOutlook(); }, { label: 'Horizon' });
  async function loadOutlook() {
    outLoaded = true;
    outPane.replaceChildren(h('div', { class: 'toolbar' }, [h('div', { class: 'toolbar__seg' }, hz.el)]), ...skeleton(5).children);
    try { fo = await get(`admin/forecast${qs({ horizon })}`); if (alive) renderOutlook(); } catch (e) { outPane.replaceChildren(errorState(e, loadOutlook)); }
  }
  function renderOutlook() {
    const A = fo.assumptions, months = fo.months.slice(0, horizon);
    const st = { growth: 0, price: A.avgDeal || 0, disc: 0, margin: A.grossMarginPct, season: true, pipeline: true };
    const res = h('div', { class: 'fc__res' }), chart = h('div', {}), tbl = h('div', { class: 'tbl-wrap' });
    const out = [h('div', { class: 'toolbar' }, [h('div', { class: 'toolbar__seg' }, hz.el)])];
    out.push(h('div', { class: `banner banner--${fo.method === 'baseline' ? 'warn' : 'info'}` }, [icon(fo.method === 'baseline' ? 'alert' : 'trend'), h('div', {}, [h('b', { text: fo.method === 'baseline' ? 'A baseline, not yet a forecast of your own sales' : `Built from ${fo.monthsOfHistory} months of real sales` }), h('p', { text: fo.basis }), h('small', { class: 'muted', text: `Confidence ${Math.round(fo.confidence * 100)}%. ${fo.confidence < 0.4 ? 'Treat the numbers as a range, not a promise.' : 'The months of history are steady enough to lean on.'}` })])]));
    const T = fo.totals;
    out.push(h('div', { class: 'fc__res' }, [
      tile2('Sold, last 12 months', `${num(T.units12)} cars`, `AED ${compact(T.revenue12)} revenue`), tile2('Gross profit, last 12 months', `AED ${compact(T.profit12)}`, `${A.grossMarginPct}% margin · ${aed(A.profitPerCar)} a car`),
      tile2('Average days to sell', A.avgDaysToSell ? `${A.avgDaysToSell} days` : '—', 'from cars sold in the last 6 months'), tile2('Pipeline today', `AED ${compact(fo.pipeline.value)}`, `${fo.pipeline.open} open leads · AED ${compact(fo.pipeline.weighted)} weighted`)
    ]));
    function tile2(k, v, s, hot) { return h('div', { class: `fc__tile${hot ? ' fc__tile--hot' : ''}` }, [h('small', { text: k }), h('b', { text: v }), h('span', { text: s })]); }

    const ctl = h('section', { class: 'card fc__ctl' }, [
      h('header', { class: 'card__head' }, [h('h2', { text: 'What if…' }), h('small', { text: 'Move a slider. Everything updates.' })]),
      slider('More or fewer sales', 'growth', -50, 100, 1, '%', 'Change against the forecast cars sold.'),
      numberRow('Average price of a car sold', 'price', A.avgDeal ? `Starts at ${aed(A.avgDeal)}, from ${A.avgDealSource}.` : 'Set listed prices or load the demo data.'),
      slider('Average discount given', 'disc', 0, 15, 0.5, '%', 'Taken off every sale.'),
      slider('Gross margin', 'margin', 1, 30, 0.5, '%', `Starts at ${A.grossMarginPct}%, from the cars you sold.`),
      toggleRow('Apply the seasonal pattern', 'season', 'Dubai: busy October to February, quiet in summer.'),
      toggleRow('Add what is in the pipeline now', 'pipeline', `${fo.pipeline.open} open leads, weighted by how likely each stage is to close.`)
    ]);
    function slider(label, key, min, max, step, unit, hint) {
      const val = h('output', { class: 'slider__v' }), inp = h('input', { class: 'range', type: 'range', min, max, step, value: st[key], 'aria-label': label });
      const upd = () => { st[key] = Number(inp.value); val.textContent = `${key === 'growth' && st[key] > 0 ? '+' : ''}${st[key]}${unit}`; inp.style.setProperty('--p', `${((st[key] - min) / (max - min)) * 100}%`); };
      inp.addEventListener('input', () => { upd(); calc2(); }); upd();
      return h('div', { class: 'slider' }, [h('div', { class: 'slider__top' }, [h('label', { text: label }), val]), inp, h('small', { class: 'muted', text: hint })]);
    }
    function numberRow(label, key, hint) {
      const inp = h('input', { class: 'inp', type: 'number', min: 0, step: 10000, inputmode: 'numeric', value: st[key] || '', 'aria-label': label, placeholder: 'AED' });
      inp.addEventListener('input', () => { st[key] = Number(inp.value) || 0; calc2(); });
      return h('div', { class: 'slider' }, [h('div', { class: 'slider__top' }, [h('label', { text: label }), h('span', { class: 'muted', text: 'AED' })]), inp, h('small', { class: 'muted', text: hint })]);
    }
    function toggleRow(label, key, hint) {
      const cb = h('input', { type: 'checkbox', checked: st[key] }); cb.addEventListener('change', () => { st[key] = cb.checked; calc2(); });
      return h('label', { class: 'switch switch--row' }, [cb, h('span', { class: 'switch__track' }, h('span', { class: 'switch__dot' })), h('span', { class: 'switch__label' }, [h('b', { text: label }), h('small', { class: 'muted', text: hint })])]);
    }
    function calc2() {
      const sea = A.seasonality;
      const rows = months.map((m) => {
        const flat = m.wins / (sea[new Date(`${m.month}-01T12:00:00`).getMonth()] || 1);
        const cars = (st.season ? m.wins : flat) * (1 + st.growth / 100);
        const price = (st.price || 0) * (1 - st.disc / 100), revenue = cars * price;
        return { month: m.month, cars, revenue, profit: revenue * (st.margin / 100), lo: m.winsLo, hi: m.winsHi };
      });
      const pipe = st.pipeline ? fo.pipeline.weighted * (1 - st.disc / 100) : 0;
      if (pipe && rows.length) { rows[0].revenue += pipe * 0.6; (rows[1] || rows[0]).revenue += pipe * 0.4; rows.forEach((r) => { r.profit = r.revenue * (st.margin / 100); }); }
      const tot = rows.reduce((a, r) => ({ cars: a.cars + r.cars, revenue: a.revenue + r.revenue, profit: a.profit + r.profit }), { cars: 0, revenue: 0, profit: 0 });
      res.replaceChildren(tile2('Cars sold', num1(tot.cars), `over ${horizon} months`, true), tile2('Revenue', st.price || pipe ? `AED ${compact(tot.revenue)}` : '—', st.price ? `at ${aed(Math.round(st.price * (1 - st.disc / 100)))} a car${pipe ? ' + pipeline' : ''}` : 'Enter a price'), tile2('Gross profit', st.price || pipe ? `AED ${compact(tot.profit)}` : '—', `${st.margin}% margin`), tile2('Cars a month', num1(tot.cars / Math.max(1, horizon)), `last year: ${num1(T.units12 / 12)}`));
      chart.replaceChildren(trendChart({ hist: fo.history.slice(0, -1).map((x) => ({ label: monthShort(x.month), v: x.won })), fc: rows.map((r, i) => ({ label: monthShort(r.month), v: r.cars, lo: months[i].winsLo * (1 + st.growth / 100), hi: months[i].winsHi * (1 + st.growth / 100) })), fmt: (v) => String(Math.round(v)) }));
      tbl.replaceChildren(h('table', { class: 'tbl' }, [h('thead', {}, h('tr', {}, ['Month', 'Cars sold', 'Revenue', 'Gross profit'].map((t, i) => h('th', { text: t, class: i ? 'r' : '' })))), h('tbody', {}, rows.map((r) => h('tr', {}, [h('td', { text: monthLong(r.month) }), h('td', { class: 'r', text: num1(r.cars) }), h('td', { class: 'r', text: aed(Math.round(r.revenue)) }), h('td', { class: 'r', text: aed(Math.round(r.profit)) })]))), h('tfoot', {}, h('tr', {}, [h('td', { text: 'Total' }), h('td', { class: 'r', text: num1(tot.cars) }), h('td', { class: 'r', text: aed(Math.round(tot.revenue)) }), h('td', { class: 'r', text: aed(Math.round(tot.profit)) })]))]));
    }
    out.push(h('div', { class: 'fc__grid' }, [ctl, h('div', { class: 'fc__main' }, [res, h('section', { class: 'card' }, [h('header', { class: 'card__head' }, [h('h2', { text: 'Cars sold, so far and expected' }), h('small', { text: 'The shaded range is how far off it could reasonably be.' })]), chart]), h('section', { class: 'card' }, [h('header', { class: 'card__head' }, [h('h2', { text: 'Month by month' })]), tbl])])]));

    /* where the money comes from */
    out.push(h('section', { class: 'card' }, [
      h('header', { class: 'card__head' }, [h('h2', { text: 'By make' }), h('small', { text: 'last 12 months, most revenue first' })]),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, [
        h('thead', {}, h('tr', {}, ['Make', 'Cars', 'Share', 'Revenue', 'Avg price', 'Margin', 'Days to sell', 'Trend'].map((t, i) => h('th', { text: t, class: i ? 'r' : '' })))),
        h('tbody', {}, fo.byMake.slice(0, 10).map((m) => h('tr', {}, [h('td', {}, h('b', { text: m.brand })), h('td', { class: 'r', text: String(m.units) }), h('td', { class: 'r' }, [`${m.share}%`, ' ', meter(m.share, fo.byMake[0]?.share || 1)]), h('td', { class: 'r', text: aed(m.revenue) }), h('td', { class: 'r', text: aed(m.avgPrice) }), h('td', { class: 'r', text: m.margin != null ? `${m.margin}%` : '—' }), h('td', { class: 'r', text: m.avgDays ? `${m.avgDays}` : '—' }), h('td', { class: 'r' }, m.trend == null ? '—' : chip(`${m.trend > 0 ? '+' : ''}${m.trend}%`, m.trend > 10 ? 'green' : m.trend < -10 ? 'red' : ''))])))
      ])),
      h('p', { class: 'muted small', text: 'Trend: the last six months against the six before.' })
    ]));
    out.push(h('section', { class: 'card' }, [
      h('header', { class: 'card__head' }, [h('h2', { text: 'The pipeline today' }), h('small', { text: `${fo.pipeline.open} open leads · AED ${compact(fo.pipeline.value)} · AED ${compact(fo.pipeline.weighted)} expected` })]),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, [
        h('thead', {}, h('tr', {}, ['Stage', 'Leads', 'Value', 'Chance to close', 'Expected'].map((t, i) => h('th', { text: t, class: i ? 'r' : '' })))),
        h('tbody', {}, fo.stages.map((s) => h('tr', {}, [h('td', { text: s.status[0].toUpperCase() + s.status.slice(1) }), h('td', { class: 'r', text: String(s.count) }), h('td', { class: 'r', text: aed(s.value) }), h('td', { class: 'r', text: `${Math.round(s.probability * 100)}%` }), h('td', { class: 'r', text: aed(s.weighted) })])))
      ])),
      h('p', { class: 'muted small', text: 'Chances per stage are rules of thumb you can change in Settings → Policy.' })
    ]));
    out.push(h('section', { class: 'card how' }, [
      h('header', { class: 'card__head' }, [h('h2', { text: 'How it is worked out' })]),
      h('ol', { class: 'how__l' }, [
        h('li', { text: `Level: a weighted average of the last six months of cars sold (the most recent count most), after taking out each month's season. Now ${A.level} a month.` }),
        h('li', { text: `Trend: the slope of a straight line through those months, kept modest. ${A.slope >= 0 ? '+' : ''}${A.slope} a month.` }),
        h('li', { text: 'Season: each calendar month is stronger or weaker than average (Settings → Policy).' }),
        h('li', { text: 'Each coming month = (level + trend) × season, with a range that widens the further ahead it looks.' }),
        h('li', { text: `Revenue = cars sold × the average price (${A.avgDeal ? aed(A.avgDeal) : 'not known yet'}, from ${A.avgDealSource || 'listed prices'}); profit uses what each car really earned (${A.profitPerCar ? aed(A.profitPerCar) : 'the margin in Policy'}).` }),
        h('li', { text: 'The pipeline adds what the leads open today are likely to bring in over the next two months.' })
      ])
    ]));
    outPane.replaceChildren(...out); calc2();
  }
  initCalc();
  return { destroy() { alive = false; } };
}
