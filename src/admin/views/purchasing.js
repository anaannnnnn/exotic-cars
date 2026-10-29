import { h, icon, aed, compact, num, chip, skeleton, errorState, empty, segmented, debounce, toast, input, select } from '../ui.js';
import { get, post, qs } from '../api.js';
import { meter, downloadCsv, monthLong } from '../charts.js';

/*
 * Purchasing AI: what to buy, how many, up to what price, from where, and in what order when money is limited.
 * It works model by model from what really sold (price, cost, days to sell), what is on the floor and how old it is,
 * and what customers asked for and did not find. Every row shows its reasons; every number can be traced.
 */
const URG = { critical: { label: 'Buy now', tone: 'red' }, urgent: { label: 'Buy soon', tone: 'amber' }, plan: { label: 'Plan', tone: 'blue' }, ok: { label: 'Covered', tone: 'green' } };
const nice = (b) => ({ 'Rolls Royce': 'Rolls-Royce', 'Mercedes Benz': 'Mercedes-Benz' }[b] || b);
const f1 = (n) => (n == null ? '—' : new Intl.NumberFormat('en-AE', { maximumFractionDigits: 1 }).format(n));
const pct = (n) => (n == null ? '—' : `${f1(n)}%`);

export function mountPurchasing(view, _p, ctx) {
  let alive = true, plan = null, tab = 'buy';
  const opt = { budget: null, appetite: 'balanced', cover: null };
  view.append(h('header', { class: 'phead' }, [h('div', {}, [h('p', { class: 'phead__eyebrow', text: 'Stock planning' }), h('h1', { class: 'phead__title', text: 'Purchasing AI' })])]));
  const demoBar = h('div', { class: 'banner banner--info', hidden: true });
  const body = h('div', { class: 'pu' }, skeleton(6));
  view.append(demoBar, body);

  async function load() {
    try {
      plan = await get(`admin/purchasing${qs({ budget: opt.budget ?? undefined, appetite: opt.appetite, cover: opt.cover ?? undefined })}`);
      if (!alive) return;
      if (opt.budget == null) opt.budget = plan.params.budget;
      demoBar.hidden = !plan.demo;
      if (plan.demo) demoBar.replaceChildren(icon('spark'), h('div', {}, [h('b', { text: 'Demo data is on' }), h('p', { text: 'The sales ledger, prices, costs and searches here are realistic sample data. Turn it off in Settings → Demo data.' })]));
      render();
    } catch (e) { body.replaceChildren(errorState(e, load)); }
  }
  const reload = debounce(load, 350);

  function kpi(k, v, s, hot) { return h('div', { class: `fc__tile${hot ? ' fc__tile--hot' : ''}` }, [h('small', { text: k }), h('b', { text: v }), h('span', { text: s })]); }
  const th = (cols) => h('thead', {}, h('tr', {}, cols.map(([t, right]) => h('th', { text: t, class: right ? 'r' : '' }))));
  const card = (title, sub, ...kids) => h('section', { class: 'card' }, [h('header', { class: 'card__head' }, [h('h2', { text: title }), sub ? h('small', { text: sub }) : null].filter(Boolean)), ...kids]);

  function render() {
    const S = plan.summary, P = plan.params;
    const out = [];

    /* the levers */
    const budget = h('input', { class: 'inp', type: 'number', min: 0, step: 500000, inputmode: 'numeric', value: opt.budget ?? '', 'aria-label': 'Buying budget for this cycle (AED)' });
    budget.addEventListener('input', () => { opt.budget = budget.value === '' ? null : Number(budget.value); reload(); });
    const cover = h('input', { class: 'inp', type: 'number', min: 0.5, max: 24, step: 0.5, value: opt.cover ?? P.cover, 'aria-label': 'Months of cover wanted' });
    cover.addEventListener('input', () => { opt.cover = cover.value === '' ? null : Number(cover.value); reload(); });
    const appetite = segmented([['cautious', 'Cautious'], ['balanced', 'Balanced'], ['bold', 'Bold']], opt.appetite, (v) => { opt.appetite = v; load(); }, { label: 'How much to buy ahead' });
    out.push(h('section', { class: 'card pu__ctl' }, [
      h('div', { class: 'pu__ctlg' }, [
        h('label', { class: 'fld' }, [h('span', { class: 'fld__l', text: 'Buying budget for this cycle (AED)' }), budget]),
        h('label', { class: 'fld' }, [h('span', { class: 'fld__l', text: 'Months of cover wanted' }), cover]),
        h('div', { class: 'fld' }, [h('span', { class: 'fld__l', text: 'How much to buy ahead' }), appetite.el])
      ]),
      h('div', { class: 'pu__ctla' }, [
        h('small', { class: 'muted', text: `Lead time ${P.leadTimeMonths} months · target margin ${P.targetMarginPct}% · holding ${P.holdingPctPerMonth}% a month · one make at most ${P.maxMakeSharePct}% of the budget (Settings → Policy)` }),
        h('span', { class: 'pu__btns' }, [h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: exportBuy }, [icon('download'), 'Buy list (CSV)']), h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: exportAll }, [icon('download'), 'Full plan (CSV)'])])
      ])
    ]));

    out.push(h('div', { class: 'fc__res' }, [
      kpi('Cars to buy', num(S.toBuy), `${S.lines} models · AED ${compact(S.need)} to fund all`, true),
      kpi('Funded by the budget', `${S.cars} cars`, `AED ${compact(S.allocated)} of ${compact(S.budget)}${S.deferred ? ` · ${S.deferred} wait` : ''}`),
      kpi('Expected profit', `AED ${compact(S.expectedProfit)}`, S.roi != null ? `${f1(S.roi)}% on the money spent` : 'set prices to estimate'),
      kpi('Buy now / soon', `${S.critical} / ${S.urgent}`, 'models running out')
    ]));
    out.push(h('div', { class: 'fc__res' }, [
      kpi('Stock on the floor', `${num(S.stockUnits)} cars`, `AED ${compact(S.stockValue)} at list · AED ${compact(S.stockCost)} at cost`),
      kpi('Listed over 90 days', `${num(S.aged90Units)} cars`, `AED ${compact(S.aged90Cost)} of cost tied up`),
      kpi('Stock turns a year', S.turns != null ? f1(S.turns) : '—', S.gmroi != null ? `profit per dirham of stock: ${S.gmroi}` : 'from the cars sold'),
      kpi('Days to sell', S.avgDaysToSell ? `${S.avgDaysToSell}` : '—', `${num(S.sold12)} cars sold in 12 months`)
    ]));
    out.push(h('p', { class: 'muted small pu__basis', text: plan.basis }));

    /* ask it in plain words */
    const answer = h('div', { class: 'ask__ans', 'aria-live': 'polite' });
    const q = h('input', { class: 'inp', type: 'text', placeholder: 'Ask: what should I buy? How is the Cullinan doing? How much budget do I need? Where should I source?', 'aria-label': 'Ask the planner' });
    const run = async (text) => {
      if (!text.trim()) return;
      answer.replaceChildren(h('p', { class: 'muted', text: 'Thinking…' }));
      try { const r = await post('admin/purchasing/ask', { q: text }); answer.replaceChildren(h('p', { text: r.text })); } catch (e) { answer.replaceChildren(h('p', { class: 'muted', text: e.message || 'Could not answer that.' })); }
    };
    out.push(h('section', { class: 'card askbox' }, [
      h('header', { class: 'card__head' }, [h('h2', {}, [icon('spark'), ' Ask the planner'])]),
      h('form', { class: 'inline', onsubmit: (e) => { e.preventDefault(); run(q.value); } }, [q, h('button', { class: 'btn btn--primary', type: 'submit' }, [icon('arrow'), 'Ask'])]),
      h('div', { class: 'chipbar' }, ['What should I buy?', 'How much budget do I need?', 'Which cars are slow?', 'Where should I source cars?', 'How is Ferrari doing?', 'What are customers asking for?'].map((t) => h('button', { class: 'fchip', type: 'button', onclick: () => { q.value = t; run(t); } }, t))),
      answer
    ]));
    out.push(card('What stands out', null, h('ul', { class: 'bul' }, plan.insights.map((t) => h('li', { text: t })))));

    /* the sections */
    const tb = segmented([['buy', 'Buy list'], ['models', 'By model'], ['makes', 'By make'], ['stock', 'Stock health'], ['source', 'Sourcing & calendar']], tab, (v) => { tab = v; panes.forEach(([k, el]) => { el.hidden = k !== v; }); }, { label: 'Planner view' });
    out.push(h('div', { class: 'toolbar' }, [h('div', { class: 'toolbar__seg' }, tb.el)]));
    const panes = [['buy', buyPane()], ['models', modelsPane()], ['makes', makesPane()], ['stock', stockPane()], ['source', sourcePane()]];
    panes.forEach(([k, el]) => { el.hidden = k !== tab; out.push(el); });
    out.push(card('How the plan is worked out', null, h('ol', { class: 'how__l' }, [
      h('li', { text: 'Demand: each model\'s own sales over the last year, with the season taken out and recent months counting more. A model with few sales borrows its share of the make; a make with few sales falls back to enquiries and searches, and says so.' }),
      h('li', { text: `To buy = demand × (lead time ${P.leadTimeMonths} + cover ${P.cover} + a safety buffer that grows as confidence falls) − cars in stock.` }),
      h('li', { text: `Max bid = the price it sells for, less the ${P.targetMarginPct}% margin wanted, ${P.reconPct}% to prepare it, and ${P.holdingPctPerMonth}% a month for the days it will sit. Pay more and you earn less than the target.` }),
      h('li', { text: 'Priority: how soon the stock runs out comes first, then profit per dirham spent. Cars are funded in that order until the budget (or one make\'s share of it) runs out; the rest wait for the next cycle.' }),
      h('li', { text: 'Risk: how old the stock is, how uneven the sale prices are, how little history there is, and how long the model takes to sell.' })
    ])));
    body.replaceChildren(...out);
  }

  /* ---------- buy list ---------- */
  function buyPane() {
    const A = plan.allocation;
    const lines = A.lines.filter((l) => l.buy > 0);
    const t = h('section', { class: 'card' }, [
      h('header', { class: 'card__head' }, [h('h2', { text: 'What to buy, in order' }), h('small', { text: `AED ${compact(A.spent)} of ${compact(A.budget)} used · AED ${compact(A.remaining)} left` })]),
      lines.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl tbl--pu' }, [
        th([['#'], ['Model'], ['Status'], ['Needed', 1], ['Funded', 1], ['Waiting', 1], ['Max bid each', 1], ['Spend', 1], ['Profit', 1], ['Return', 1]]),
        h('tbody', {}, lines.map((l, i) => h('tr', { class: l.alloc ? '' : 'tr--wait' }, [h('td', { class: 'muted', text: String(i + 1) }), h('td', {}, [h('b', { text: nice(l.brand) }), ' ', l.model, l.why ? h('div', { class: 'muted small', text: l.why }) : null]), h('td', {}, chip(URG[l.urgency].label, URG[l.urgency].tone)), h('td', { class: 'r', text: String(l.buy) }), h('td', { class: 'r' }, h('b', { text: String(l.alloc) })), h('td', { class: 'r', text: l.deferred ? String(l.deferred) : '—' }), h('td', { class: 'r', text: l.unit ? aed(l.unit) : '—' }), h('td', { class: 'r', text: l.spend ? aed(l.spend) : '—' }), h('td', { class: 'r', text: l.profit ? aed(l.profit) : '—' }), h('td', { class: 'r', text: pct(l.roi) })]))),
        h('tfoot', {}, h('tr', {}, [h('td'), h('td', { text: 'Total' }), h('td'), h('td', { class: 'r', text: String(lines.reduce((s, l) => s + l.buy, 0)) }), h('td', { class: 'r', text: String(plan.summary.cars) }), h('td', { class: 'r', text: String(plan.summary.deferred) }), h('td'), h('td', { class: 'r', text: aed(A.spent) }), h('td', { class: 'r', text: aed(plan.summary.expectedProfit) }), h('td', { class: 'r', text: pct(plan.summary.roi) })]))
      ])) : empty('Nothing to buy', 'Stock covers expected sales for the cover you chose.')
    ]);
    const sc = card('What if the budget were different?', 'the same plan, funded at other budgets', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, [
      th([['Budget', 1], ['Cars funded', 1], ['Spend', 1], ['Expected profit', 1], ['Return', 1]]),
      h('tbody', {}, A.scenarios.map((s) => h('tr', { class: s.factor === 1 ? 'tr--hot' : '' }, [h('td', { class: 'r' }, [aed(s.budget), s.factor === 1 ? ' (now)' : '']), h('td', { class: 'r', text: String(s.cars) }), h('td', { class: 'r', text: aed(s.spend) }), h('td', { class: 'r', text: aed(s.profit) }), h('td', { class: 'r', text: pct(s.roi) })])))
    ])));
    const shop = plan.shopping.length ? card('Shopping list', 'what to go and find, funded cars only', h('div', { class: 'pu__shop' }, plan.shopping.map((s) => h('article', { class: 'pu__item' }, [
      h('div', { class: 'pu__item__h' }, [h('b', { text: `${s.qty} × ${nice(s.brand)} ${s.model}` }), chip(URG[s.urgency].label, URG[s.urgency].tone)]),
      h('dl', { class: 'pu__item__d' }, [['Years', s.years || 'any'], ['Pay up to', s.maxBid ? aed(s.maxBid) : '—'], ['Sells for', s.sellFor ? aed(s.sellFor) : '—'], ['Takes', s.days ? `${s.days} days` : '—'], ['Best source', s.channel || '—'], ['Colours asked for', s.colours?.length ? s.colours.join(', ') : '—'], ['Expected profit', aed(s.expectedProfit)]].map(([k, v]) => h('div', {}, [h('dt', { text: k }), h('dd', { text: v })])))
    ])))) : null;
    return h('div', { class: 'pu__pane' }, [t, sc, shop].filter(Boolean));
  }

  /* ---------- by model ---------- */
  function modelsPane() {
    const st = { q: '', make: '', show: 'all' };
    const list = h('div', { class: 'pu__rows' }), more = h('button', { class: 'btn btn--ghost btn--block', type: 'button', hidden: true });
    let cap = 30;
    const q = h('input', { class: 'inp inp--search', type: 'search', placeholder: 'Search a model…', 'aria-label': 'Search models' });
    const mk = select('make', [['', 'All makes'], ...plan.makes.map((m) => [m.brand, nice(m.brand)])], '');
    const sh = segmented([['all', 'All'], ['buy', 'To buy'], ['over', 'Overstocked'], ['risk', 'At risk']], 'all', (v) => { st.show = v; cap = 30; draw(); }, { label: 'Show' });
    q.addEventListener('input', debounce(() => { st.q = q.value.trim().toLowerCase(); cap = 30; draw(); }, 200)); mk.addEventListener('change', () => { st.make = mk.value; cap = 30; draw(); });
    function draw() {
      const rows = plan.rows.filter((r) => (!st.make || r.brand === st.make) && (!st.q || `${r.brand} ${r.model}`.toLowerCase().includes(st.q)) && (st.show === 'all' || (st.show === 'buy' && r.buy > 0) || (st.show === 'over' && r.coverMonths != null && r.coverMonths > 9) || (st.show === 'risk' && r.risk >= 55)));
      list.replaceChildren(...(rows.length ? rows.slice(0, cap).map(modelRow) : [empty('No models match', 'Try another filter.')]));
      more.hidden = rows.length <= cap; more.textContent = `Show ${Math.min(30, rows.length - cap)} more (${rows.length - cap} left)`;
    }
    more.addEventListener('click', () => { cap += 30; draw(); });
    draw();
    return h('div', { class: 'pu__pane' }, [h('div', { class: 'toolbar pu__filters' }, [h('label', { class: 'search' }, [icon('search'), q]), mk, h('div', { class: 'toolbar__seg' }, sh.el)]), list, more]);
  }
  function modelRow(r) {
    const open = h('div', { class: 'pr__body', hidden: true }), cv = h('span', { class: 'pr__chev', 'aria-hidden': 'true' }, icon('down'));
    const head = h('button', { class: 'pr__head', type: 'button', 'aria-expanded': 'false', onclick: () => { const on = open.hidden; open.hidden = !on; head.setAttribute('aria-expanded', String(on)); card2.classList.toggle('is-open', on); } }, [
      h('span', { class: 'pr__name' }, [h('b', { text: `${nice(r.brand)} ${r.model}` }), chip(URG[r.urgency].label, URG[r.urgency].tone)]),
      stat('In stock', String(r.stock)), stat('Sells / month', f1(r.unitsPerMonth)), stat('Cover', r.coverMonths == null ? '—' : `${r.coverMonths} mo`),
      h('span', { class: 'pr__stat pr__risk' }, [h('small', { text: 'Risk' }), meter(r.risk, 100, r.risk >= 55 ? 'red' : r.risk >= 35 ? 'amber' : 'green')]),
      h('span', { class: 'pr__buy' }, [h('small', { text: r.buy ? 'Buy' : 'Hold' }), h('b', { text: r.buy ? String(r.buy) : '—' })]), cv
    ]);
    const grid = [['Sold, 12 months', r.sold12], ['Sold, last 6', r.sold6], ['Typical price', r.avgPrice ? aed(r.avgPrice) : '—'], ['Typical cost', r.avgCost ? aed(r.avgCost) : '—'], ['Preparation', r.avgRecon ? aed(r.avgRecon) : '—'], ['Profit per car', r.avgProfit != null ? aed(r.avgProfit) : '—'], ['Margin', pct(r.marginPct)], ['Days to sell', r.daysToSell ?? '—'], ['Max bid', r.maxBid ? aed(r.maxBid) : '—'], ['Return on a buy', pct(r.roi)], ['Average age in stock', r.avgAge != null ? `${r.avgAge} days` : '—'], ['Over 90 days', r.aged], ['Stock at list', r.stockValue ? aed(r.stockValue) : '—'], ['Confidence', `${r.confidence}%`], ['Trend', r.trend == null ? '—' : `${r.trend > 0 ? '+' : ''}${r.trend}%`], ['Demand from', r.demandBasis]];
    open.append(h('ul', { class: 'bul' }, r.reasons.map((t) => h('li', { text: t }))), h('dl', { class: 'pu__dl' }, grid.map(([k, v]) => h('div', {}, [h('dt', { text: k }), h('dd', { text: String(v) })]))));
    const card2 = h('div', { class: `pr pr--${r.urgency}` }, [head, open]);
    return card2;
  }
  const stat = (k, v) => h('span', { class: 'pr__stat' }, [h('small', { text: k }), h('b', { text: v })]);

  /* ---------- by make ---------- */
  function makesPane() {
    return h('div', { class: 'pu__pane' }, [card('By make', 'urgent first, then the most to buy', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, [
      th([['Make'], ['Status'], ['Stock', 1], ['Models', 1], ['Sold, 12 mo', 1], ['Revenue', 1], ['Margin', 1], ['Days', 1], ['To buy', 1], ['Searches', 1], ['Best source']]),
      h('tbody', {}, plan.makes.map((m) => h('tr', {}, [h('td', {}, h('b', { text: nice(m.brand) })), h('td', {}, chip(URG[m.urgency].label, URG[m.urgency].tone)), h('td', { class: 'r', text: String(m.stock) }), h('td', { class: 'r', text: String(m.models) }), h('td', { class: 'r', text: String(m.sold12) }), h('td', { class: 'r', text: m.revenue12 ? aed(m.revenue12) : '—' }), h('td', { class: 'r', text: pct(m.margin) }), h('td', { class: 'r', text: m.avgDays ?? '—' }), h('td', { class: 'r' }, m.buy ? h('b', { text: String(m.buy) }) : '—'), h('td', { class: 'r', text: m.asks ? String(m.asks) : '—' }), h('td', { text: m.channel || '—' })])))
    ])))]);
  }

  /* ---------- stock health ---------- */
  function stockPane() {
    const maxAge = Math.max(1, ...plan.aging.map((a) => a.units));
    const aging = card('How long the stock has been listed', 'cars and the money tied up in them', h('div', { class: 'pu__bars' }, plan.aging.map((a, i) => h('div', { class: 'pu__bar' }, [h('span', { class: 'pu__bar__l', text: a.label }), meter(a.units, maxAge, i >= 3 ? 'red' : i === 2 ? 'amber' : ''), h('span', { class: 'pu__bar__v' }, [h('b', { text: String(a.units) }), ` cars · ${a.share}% · AED ${compact(a.cost)}`])]))));
    const slow = plan.slowMovers.length ? card('Oldest cars on the floor', 'each month costs about the holding rate in the policy', h('ul', { class: 'feed' }, plan.slowMovers.map((s) => h('li', {}, h('a', { class: 'feed__row', href: `#/inventory/${s.id}` }, [h('span', { class: 'when' }, [h('b', { text: String(s.ageDays) }), h('small', { text: 'days' })]), h('span', { class: 'feed__t' }, [h('b', { text: s.title }), h('small', { text: [s.price ? `AED ${compact(s.price)} list` : null, s.cost ? `AED ${compact(s.cost)} cost` : null, s.holding ? `AED ${compact(s.holding)} holding so far` : null].filter(Boolean).join(' · ') })]), icon('right')]))))) : null;
    const conc = card('Where the money is tied up', `no make should be more than ${plan.params.maxMakeSharePct}% of stock at cost`, h('div', { class: 'pu__bars' }, plan.concentration.map((c) => h('div', { class: 'pu__bar' }, [h('span', { class: 'pu__bar__l', text: nice(c.brand) }), meter(c.share, 100, c.flag === 'over' ? 'red' : c.flag === 'near' ? 'amber' : ''), h('span', { class: 'pu__bar__v' }, [h('b', { text: `${c.share}%` }), ` · ${c.units} cars · AED ${compact(c.cost)}`, c.flag ? ' ' : '', c.flag ? chip(c.flag === 'over' ? 'Over the limit' : 'Near the limit', c.flag === 'over' ? 'red' : 'amber') : null])]))));
    const bands = card('Price bands: what we stock against what sells', 'a positive gap means under-stocked', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, [th([['Band'], ['In stock', 1], ['Stock share', 1], ['Sold, 12 mo', 1], ['Sales share', 1], ['Gap', 1]]), h('tbody', {}, plan.priceBands.map((b) => h('tr', {}, [h('td', { text: b.label }), h('td', { class: 'r', text: String(b.stock) }), h('td', { class: 'r', text: `${b.stockShare}%` }), h('td', { class: 'r', text: String(b.sold) }), h('td', { class: 'r', text: `${b.salesShare}%` }), h('td', { class: 'r' }, chip(`${b.gap > 0 ? '+' : ''}${b.gap}`, b.gap >= 5 ? 'red' : b.gap <= -5 ? 'amber' : 'green'))])))])));
    const body2 = card('Body styles: stock against demand', 'sales plus searches nothing answered', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, [th([['Body'], ['In stock', 1], ['Stock share', 1], ['Sold, 12 mo', 1], ['Searches', 1], ['Demand share', 1], ['Gap', 1]]), h('tbody', {}, plan.bodyMix.map((b) => h('tr', {}, [h('td', { text: b.body }), h('td', { class: 'r', text: String(b.stock) }), h('td', { class: 'r', text: `${b.stockShare}%` }), h('td', { class: 'r', text: String(b.sold) }), h('td', { class: 'r', text: b.asks ? String(b.asks) : '—' }), h('td', { class: 'r', text: `${b.demandShare}%` }), h('td', { class: 'r' }, chip(`${b.gap > 0 ? '+' : ''}${b.gap}`, b.gap >= 5 ? 'red' : b.gap <= -5 ? 'amber' : 'green'))])))])));
    return h('div', { class: 'pu__pane' }, [aging, slow, conc, bands, body2].filter(Boolean));
  }

  /* ---------- sourcing and calendar ---------- */
  function sourcePane() {
    const ch = plan.channels.length ? card('Where cars were bought', 'by profit per car, last 12 months', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, [th([['Channel'], ['Cars', 1], ['Share', 1], ['Bought at % of list', 1], ['Days to sell', 1], ['Profit a car', 1], ['Margin', 1]]), h('tbody', {}, plan.channels.map((c) => h('tr', {}, [h('td', {}, h('b', { text: c.channel })), h('td', { class: 'r', text: String(c.units) }), h('td', { class: 'r', text: `${c.share}%` }), h('td', { class: 'r', text: `${c.avgCostVsList}%` }), h('td', { class: 'r', text: String(c.avgDays) }), h('td', { class: 'r', text: aed(c.avgProfit) }), h('td', { class: 'r', text: pct(c.marginPct) })])))]))) : null;
    const cal = card('Buying calendar', `cars take ${plan.params.leadTimeMonths} months to source, so buy ahead of the peaks`, h('div', { class: 'pu__cal' }, plan.calendar.map((m) => h('div', { class: `pu__cal__m${m.index >= 1.15 ? ' is-peak' : m.index <= 0.78 ? ' is-quiet' : ''}` }, [h('b', { text: monthLong(m.month).split(' ')[0] }), h('span', { class: 'pu__cal__i', text: `${m.index.toFixed(2)}×` }), meter(m.index, 1.4), h('small', { text: m.note }), m.buyBy ? h('small', { class: 'pu__cal__by', text: `buy by ${monthLong(m.buyBy).split(' ')[0]}` }) : null]))));
    const unmet = plan.unmet.length ? card('Asked for, not in stock', 'from the concierge and shop searches, last 90 days', h('ul', { class: 'feed' }, plan.unmet.map((u) => h('li', { class: 'feed__row feed__row--static' }, [h('span', { class: 'when' }, [h('b', { text: String(u.asks) }), h('small', { text: 'asks' })]), h('span', { class: 'feed__t' }, [h('b', { text: u.label }), h('small', { text: u.estimatedValue ? `worth about AED ${compact(u.estimatedValue)}` : 'no price known' })])])))) : null;
    const risks = plan.risks.length ? card('Models to watch', 'old stock, uneven prices or little evidence', h('ul', { class: 'feed' }, plan.risks.map((r) => h('li', { class: 'feed__row feed__row--static' }, [h('span', { class: 'when' }, [h('b', { text: String(r.risk) }), h('small', { text: 'risk' })]), h('span', { class: 'feed__t' }, [h('b', { text: r.title }), h('small', { text: r.text })])])))) : null;
    return h('div', { class: 'pu__pane' }, [ch, cal, unmet, risks].filter(Boolean));
  }

  function exportBuy() {
    downloadCsv('buy-list.csv', [['Priority', 'Make', 'Model', 'Status', 'Needed', 'Funded', 'Waiting', 'Max bid each (AED)', 'Spend (AED)', 'Expected profit (AED)', 'Return %', 'Note'], ...plan.allocation.lines.filter((l) => l.buy).map((l, i) => [i + 1, nice(l.brand), l.model, URG[l.urgency].label, l.buy, l.alloc, l.deferred, l.unit, l.spend, l.profit, l.roi, l.why || ''])]);
  }
  function exportAll() {
    downloadCsv('purchasing-plan.csv', [['Make', 'Model', 'In stock', 'Sells per month', 'Cover (months)', 'Status', 'To buy', 'Max bid (AED)', 'Typical price (AED)', 'Typical cost (AED)', 'Profit per car (AED)', 'Margin %', 'Days to sell', 'Sold 12 months', 'Over 90 days', 'Risk', 'Confidence %', 'Demand from'], ...plan.rows.map((r) => [nice(r.brand), r.model, r.stock, r.unitsPerMonth, r.coverMonths, URG[r.urgency].label, r.buy, r.maxBid, r.avgPrice, r.avgCost, r.avgProfit, r.marginPct, r.daysToSell, r.sold12, r.aged, r.risk, r.confidence, r.demandBasis])]);
  }

  load();
  return { destroy() { alive = false; } };
}
