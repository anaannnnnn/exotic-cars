import { h, icon, aed, select, field, input, toast, failed, errorState } from '../ui.js';
import { get as apiGet, post as apiPost, qs } from '../api.js';

const MONTHS = [['', 'All months'], ...Array.from({ length: 12 }, (_, i) => [String(i + 1), new Date(2000, i, 1).toLocaleString('en', { month: 'long' })])];
export function mountTransactions(view, { type = 'sale' } = {}) {
  const purchase = type === 'purchase';
  const label = purchase ? 'Purchases' : 'Sales';
  view.append(h('header', { class: 'phead' }, [h('div', {}, [h('p', { class: 'phead__eyebrow', text: 'Transaction ledger' }), h('h1', { class: 'phead__title', text: label })]), h('a', { class: 'btn btn--ghost', href: '#/inventory' }, [icon('car'), 'Inventory'])]));
  const form = h('form', { class: 'card txn-form' });
  const carSel = select('carId', [['', 'Choose a car']], '');
  const amount = input('amount', '', { type: 'number', min: '1', step: '0.01', required: true, placeholder: 'AED' });
  const date = input('date', new Date().toISOString().slice(0, 10), { type: 'date', required: true });
  const person = input(purchase ? 'counterparty' : 'salesperson', '', { maxlength: purchase ? 120 : 100, placeholder: purchase ? 'Seller / supplier' : 'Salesperson' });
  const notes = input('notes', '', { maxlength: 1000, placeholder: 'Optional reference or notes' });
  form.append(h('header', { class: 'card__head' }, [h('h2', { text: purchase ? 'Record purchase' : 'Record sale' }), h('small', { text: purchase ? 'Purchases are tracked as acquisition cost.' : 'Sold stock can be added here once its actual date, amount, and salesperson are known.' })]),
    h('div', { class: 'fgrid fgrid--4' }, [field('Car', carSel), field(purchase ? 'Purchase amount (AED)' : 'Sale amount (AED)', amount), field('Transaction date', date), field(purchase ? 'Seller / supplier' : 'Salesperson', person), field('Notes', notes, { span: 2 })]),
    h('div', { class: 'card__actions' }, h('button', { class: 'btn btn--primary', type: 'submit' }, [icon('plus'), `Record ${purchase ? 'purchase' : 'sale'}`])));
  view.append(form);
  const legacy = !purchase ? h('details', { class: 'card legacy-sold' }, [h('summary', { text: 'Sold inventory awaiting transaction details' }), h('p', { class: 'muted small', text: 'These cars are marked sold in stock, but have no sale date, amount, or salesperson. Add verified details to include them in reports.' }), h('div', { class: 'rows', text: 'Loading sold inventory…' })]) : null;
  if (legacy) view.append(legacy);
  const filters = { month: select('month', MONTHS, ''), year: select('year', [['', 'All years']], ''), car: select('car', [['', 'All cars']], ''), brand: select('brand', [['', 'All brands']], ''), salesperson: select('salesperson', [['', purchase ? 'All sellers' : 'All salespeople']], '') };
  const filtersEl = h('div', { class: 'txn-filters toolbar__row' }, [filters.month, filters.year, filters.car, filters.brand, filters.salesperson]);
  view.append(h('div', { class: 'report-head' }, [h('div', {}, [h('p', { class: 'phead__eyebrow', text: 'Live report' }), h('h2', { class: 'section-title', text: `${label} report` })]), filtersEl]));
  const kpis = h('div', { class: 'txn-kpis' });
  const report = h('div', { class: 'txn-split' });
  const rows = h('div', { class: 'rows' });
  view.append(kpis, report, h('h2', { class: 'section-title', text: `${label} records` }), rows);

  async function loadCars() {
    const response = await apiGet(`admin/cars${qs({ limit: 500, sort: 'title' })}`);
    const cars = response.data;
    carSel.replaceChildren(h('option', { value: '', text: 'Choose a car' }), ...cars.map((c) => h('option', { value: c.id, text: `${c.title}${c.sold ? ' · sold' : ''}` })));
  }
  async function loadLegacy() {
    if (!legacy) return;
    const host = legacy.querySelector('.rows');
    try {
      const [sold, ledger] = await Promise.all([apiGet(`admin/cars${qs({ status: 'sold', limit: 500 })}`), apiGet('admin/transactions?type=sale&limit=500')]);
      const recorded = new Set(ledger.data.map((r) => String(r.carId)));
      const pending = sold.data.filter((c) => !recorded.has(String(c.id)));
      legacy.querySelector('summary').textContent = `Sold inventory awaiting transaction details · ${pending.length}`;
      host.replaceChildren(...(pending.length ? pending.map((c) => h('article', { class: 'row legacy-row' }, [
        h('span', { class: 'row__t' }, [h('b', { text: c.title }), h('small', { text: [c.brand, `Stock #${c.id}`].join(' · ') })]),
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Add details', onclick: () => { carSel.value = String(c.id); amount.focus(); form.scrollIntoView({ behavior: 'smooth', block: 'center' }); } })
      ])) : [h('p', { class: 'muted small', text: 'All sold inventory has a matching sales record.' })]));
    } catch (err) { host.replaceChildren(h('p', { class: 'muted small', text: err.message })); }
  }
  function populate(sel, options, firstLabel, current) {
    sel.replaceChildren(h('option', { value: '', text: firstLabel }), ...options.map((o) => { const v = typeof o === 'object' ? o.id : o; const t = typeof o === 'object' ? o.title : o; return h('option', { value: v, text: t }); }));
    if ([...sel.options].some((o) => o.value === current)) sel.value = current;
  }
  async function load() {
    const query = Object.fromEntries(Object.entries(filters).map(([key, el]) => [key, el.value]));
    try {
      const res = await apiGet(`admin/transactions${qs({ type: purchase ? 'purchase' : 'sale', ...query })}`);
      populate(filters.year, res.filters.years, 'All years', query.year);
      populate(filters.car, res.filters.cars, 'All cars', query.car);
      populate(filters.brand, res.filters.brands, 'All brands', query.brand);
      populate(filters.salesperson, res.filters.salespeople, purchase ? 'All sellers' : 'All salespeople', query.salesperson);
      kpis.replaceChildren(
        h('div', { class: 'txn-kpi' }, [h('small', { text: `Recorded ${purchase ? 'purchases' : 'sales'}` }), h('b', { text: String(res.report.count) })]),
        h('div', { class: 'txn-kpi' }, [h('small', { text: purchase ? 'Acquisition spend' : 'Sales revenue' }), h('b', { text: aed(res.report.amount) })])
      );
      const breakdown = (title, pairs) => h('article', { class: 'card txn-breakdown' }, [h('h3', { text: title }), pairs.length ? h('ul', { class: 'txn-bars' }, pairs.slice(0, 8).map(([name, n]) => h('li', {}, [h('span', { text: name }), h('b', { text: aed(n) })]))) : h('p', { class: 'muted small', text: 'No records in this period.' })]);
      report.replaceChildren(breakdown('By brand', res.report.byBrand), breakdown(purchase ? 'By seller' : 'By salesperson', res.report.byPerson));
      rows.replaceChildren(...(res.data.length ? res.data.map((r) => h('article', { class: 'row txn-row' }, [
        h('span', { class: 'row__img txn-mark' }, icon(purchase ? 'money' : 'car')),
        h('span', { class: 'row__t' }, [h('b', { text: r.carTitle }), h('small', { text: [r.brand, new Date(`${r.date}T12:00:00`).toLocaleDateString('en-GB', { dateStyle: 'medium' }), r.salesperson || r.counterparty].filter(Boolean).join(' · ') })]),
        h('span', { class: 'row__price' }, h('b', { text: aed(r.amount) }))
      ])) : [h('p', { class: 'empty', text: `No ${label.toLowerCase()} match these filters. Record a transaction above to start the ledger.` })]),
      res.truncated ? h('p', { class: 'muted small', text: 'Showing the first 500 records. Report totals include every matching transaction.' }) : null);
    } catch (err) { rows.replaceChildren(errorState(err, load)); }
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const button = form.querySelector('[type=submit]'); button.disabled = true;
    try {
      await apiPost('admin/transactions', { type: purchase ? 'purchase' : 'sale', carId: Number(carSel.value), amount: Number(amount.value), date: date.value, salesperson: purchase ? null : person.value, counterparty: purchase ? person.value : null, notes: notes.value });
      amount.value = ''; notes.value = ''; toast(`${purchase ? 'Purchase' : 'Sale'} recorded`); await loadCars(); await load(); await loadLegacy();
    } catch (err) { failed(err); } finally { button.disabled = false; }
  });
  Object.values(filters).forEach((el) => el.addEventListener('change', load));
  loadCars().then(() => Promise.all([load(), loadLegacy()])).catch((err) => rows.replaceChildren(errorState(err, load)));
}
