import { h, icon, aed, compact, ago, chip, debounce, segmented, skeleton, empty, errorState, drawer, toast, failed, whatsapp, field, input, textarea, select, toggle, initials, when } from '../ui.js';
import { get, patch, qs } from '../api.js';

/*
 * Workshop: every service and repair as a job the customer can follow in the app. Each step the team takes here (received,
 * inspected, quoted, approved, in work, checked, ready, delivered) shows on the customer's phone, and the customer approves
 * the written quote there.
 */
const ST = {
  requested: ['Requested', 'red'], scheduled: ['Booked in', 'blue'], received: ['Car received', 'blue'], inspecting: ['Inspecting', 'violet'], quoted: ['Quote sent', 'amber'],
  approved: ['Quote approved', 'green'], 'in-progress': ['In work', 'violet'], qc: ['Quality check', 'amber'], ready: ['Ready', 'green'], delivered: ['Delivered', 'grey'], cancelled: ['Cancelled', 'grey']
};
const COLS = [['New', ['requested']], ['Booked in', ['scheduled', 'received']], ['Inspect & quote', ['inspecting', 'quoted']], ['In work', ['approved', 'in-progress']], ['Check & ready', ['qc', 'ready']]];
const NEXT = { requested: ['scheduled', 'Confirm the booking'], scheduled: ['received', 'Car received'], received: ['inspecting', 'Start the inspection'], inspecting: [null, 'Prepare a quote below'], quoted: ['approved', 'Customer agreed by phone'], approved: ['in-progress', 'Start the work'], 'in-progress': ['qc', 'Send to quality check'], qc: ['ready', 'Mark ready'], ready: ['delivered', 'Hand back to the customer'] };
const FLOW = ['requested', 'scheduled', 'received', 'inspecting', 'quoted', 'approved', 'in-progress', 'qc', 'ready', 'delivered'];

export function mountWorkshop(view, { id }, ctx) {
  const role = ctx.session.role || 'owner';
  const state = { q: '', status: 'open', mine: false };
  let jobs = [], people = [], alive = true;
  get('admin/people').then((r) => { people = r.data; }).catch(() => {});
  const nameOf = (e) => people.find((p) => p.email === e)?.name || (e ? e.split('@')[0] : '');

  const count = h('span', { class: 'phead__count' });
  view.append(h('header', { class: 'phead' }, [h('div', {}, [h('p', { class: 'phead__eyebrow', text: 'After the sale' }), h('h1', { class: 'phead__title' }, ['Workshop ', count])])]));
  const search = h('input', { class: 'inp inp--search', type: 'search', placeholder: 'Search reference, customer, car…', 'aria-label': 'Search jobs' });
  const seg = segmented([['open', 'Open'], ['delivered', 'Delivered'], ['', 'All']], 'open', (v) => { state.status = v; load(); }, { label: 'Show' });
  const mine = h('button', { class: 'fchip', type: 'button', 'aria-pressed': 'false', onclick: (e) => { state.mine = !state.mine; e.currentTarget.classList.toggle('is-on', state.mine); load(); } }, [icon('target'), 'Mine']);
  view.append(h('div', { class: 'toolbar' }, [h('label', { class: 'search' }, [icon('search'), search]), h('div', { class: 'toolbar__seg toolbar__seg--wrap' }, [seg.el, mine])]));
  const body = h('div', { class: 'leads' }, skeleton(5));
  view.append(body);
  search.addEventListener('input', debounce(() => { state.q = search.value.trim(); load(); }, 280));

  async function load(quiet) {
    try {
      const res = await get(`admin/jobs${qs({ q: state.q, status: state.status, mine: state.mine ? '1' : '', limit: 300 })}`);
      if (!alive) return;
      jobs = res.data; count.textContent = String(jobs.length); render();
      if (id) { open(id); id = null; }
    } catch (e) { if (!quiet) body.replaceChildren(errorState(e, load)); }
  }

  function render() {
    if (!jobs.length) { body.replaceChildren(empty('No jobs here', 'Service and repair requests from the website and the app appear as jobs.')); return; }
    if (state.status === 'open') {
      body.replaceChildren(h('div', { class: 'board board--5' }, COLS.map(([name, sts]) => {
        const items = jobs.filter((j) => sts.includes(j.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return h('section', { class: 'col' }, [h('header', { class: 'col__head' }, [h('b', { text: name }), h('span', { class: 'col__n', text: String(items.length) })]), h('div', { class: 'col__cards' }, items.length ? items.map(card) : [h('p', { class: 'col__empty', text: 'Nothing here' })])]);
      })));
    } else body.replaceChildren(h('div', { class: 'rows' }, jobs.map((j) => h('button', { class: 'row row--btn', type: 'button', onclick: () => open(j.id) }, [h('span', { class: 'row__main' }, [h('span', { class: 'av', text: initials(j.name) }), h('span', { class: 'row__t' }, [h('b', { text: j.title }), h('small', { text: [j.ref, j.name, j.vehicle].filter(Boolean).join(' · ') })]), h('span', { class: 'row__price' }, [chip(ST[j.status][0], ST[j.status][1]), h('small', { text: ago(j.updatedAt) })])])]))));
  }

  function card(j) {
    return h('article', { class: 'lcard jcard', tabindex: '0', role: 'button', onclick: () => open(j.id), onkeydown: (e) => { if (e.key === 'Enter') open(j.id); } }, [
      h('div', { class: 'lcard__top' }, [h('b', { text: j.title }), h('small', { text: ago(j.createdAt) })]),
      h('p', { class: 'lcard__car', text: [j.name, j.vehicle].filter(Boolean).join(' · ') }),
      h('div', { class: 'lcard__foot' }, [chip(ST[j.status][0], ST[j.status][1]), j.quote?.status === 'pending' ? chip('Quote waiting', 'amber') : null, j.pickup?.needed ? h('span', { class: 'jchip', title: 'Collect from the customer' }, icon('truck')) : null, j.quote ? h('span', { class: 'lcard__v', text: aed(j.quote.total) }) : null, j.assignee ? h('span', { class: 'av av--xs', title: nameOf(j.assignee), text: initials(nameOf(j.assignee)) }) : null])
    ]);
  }

  async function open(jobId) {
    const d = drawer({ title: 'Job', sub: '', wide: true });
    d.body.replaceChildren(skeleton(4));
    let j;
    try { j = await get(`admin/jobs/${jobId}`); } catch (e) { d.body.replaceChildren(errorState(e)); return; }
    const save = async (body, msg) => { try { j = await patch(`admin/jobs/${j.id}`, body); const i = jobs.findIndex((x) => x.id === j.id); if (i >= 0) Object.assign(jobs[i], j); render(); paint(); ctx.refreshBadges(); if (msg) toast(msg); } catch (e) { failed(e); } };
    function paint() {
      d.titleEl.textContent = j.title; d.subEl.textContent = `${j.ref} · ${j.name} · ${j.vehicle || 'car not named'}`;
      const first = (j.name || '').split(' ')[0];
      const steps = h('ol', { class: 'steps' }, FLOW.map((s, i) => { const at = FLOW.indexOf(j.status); return h('li', { class: `step${i < at ? ' is-done' : ''}${i === at ? ' is-now' : ''}` }, [h('span', { class: 'step__dot' }), h('small', { text: ST[s][0] })]); }));
      const nxt = NEXT[j.status];
      const note = textarea('note', '', { rows: 2, placeholder: 'A note the customer sees in their app (optional)' });
      const advance = nxt?.[0] ? h('button', { class: 'btn btn--primary btn--block', type: 'button', onclick: () => save({ status: nxt[0], note: note.value || null }, `Moved to ${ST[nxt[0]][0]}`) }, [icon('arrow'), nxt[1]]) : nxt ? h('p', { class: 'muted small', text: nxt[1] }) : null;
      const any = select('status', FLOW.concat('cancelled').map((s) => [s, ST[s][0]]), j.status, { 'aria-label': 'Set the status', onchange: (e) => { if (e.target.value !== j.status) save({ status: e.target.value, note: note.value || null }, 'Status updated'); } });
      const contact = h('div', { class: 'contact' }, [
        h('a', { class: 'cbtn', href: `tel:${j.phone.replace(/[^\d+]/g, '')}` }, [icon('phone'), h('span', { text: 'Call' })]),
        h('a', { class: 'cbtn cbtn--wa', href: whatsapp(j.phone, `Hello ${first}, this is Exotic Cars Dubai about your ${j.title} (${j.ref}). ${j.status === 'ready' ? 'Your car is ready.' : ''}`), target: '_blank', rel: 'noopener noreferrer' }, [icon('whatsapp'), h('span', { text: 'WhatsApp' })])
      ]);

      /* the quote */
      const items = j.quote?.items?.length ? j.quote.items.map((i) => ({ ...i })) : [{ label: '', qty: 1, price: '' }];
      const locked = j.quote && j.quote.status === 'approved';
      const rows = h('div', { class: 'qrows' });
      const totalEl = h('b', { class: 'qtotal' });
      const sum = () => { const t = items.reduce((s, i) => s + (Number(i.qty) || 1) * (Number(i.price) || 0), 0); totalEl.textContent = aed(t); return t; };
      const drawRows = () => { rows.replaceChildren(...items.map((it, i) => { const lab = h('input', { class: 'inp', value: it.label, placeholder: 'Part or labour', 'aria-label': 'Item', disabled: locked }); const qty = h('input', { class: 'inp inp--qty', type: 'number', min: 1, value: it.qty || 1, 'aria-label': 'Quantity', disabled: locked }); const pr = h('input', { class: 'inp inp--price', type: 'number', min: 0, step: 50, value: it.price, placeholder: 'AED', 'aria-label': 'Price each', disabled: locked }); lab.oninput = () => { it.label = lab.value; }; qty.oninput = () => { it.qty = Number(qty.value) || 1; sum(); }; pr.oninput = () => { it.price = pr.value; sum(); }; return h('div', { class: 'qrow' }, [lab, qty, pr, locked ? null : h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Remove item', onclick: () => { items.splice(i, 1); if (!items.length) items.push({ label: '', qty: 1, price: '' }); drawRows(); sum(); } }, icon('close'))]); })); };
      drawRows(); sum();
      const qState = j.quote ? h('p', { class: `qstate qstate--${j.quote.status}` }, [icon(j.quote.status === 'approved' ? 'verified' : j.quote.status === 'declined' ? 'alert' : 'timer'), { pending: 'Waiting for the customer to answer in their app', approved: `Approved by ${j.quote.decidedBy || 'the customer'} · ${ago(j.quote.decidedAt)}`, declined: 'Declined by the customer' }[j.quote.status]]) : null;
      const quote = h('section', { class: 'dsec' }, [h('h3', { text: 'Quote' }), qState, rows, locked ? null : h('button', { class: 'linkadd', type: 'button', onclick: () => { items.push({ label: '', qty: 1, price: '' }); drawRows(); } }, [icon('plus'), 'Add a line']), h('div', { class: 'build__total' }, [h('span', { text: 'Total' }), totalEl]),
        locked ? null : h('button', { class: 'btn btn--ghost btn--block', type: 'button', onclick: () => { const clean = items.filter((i) => i.label.trim() && i.price !== ''); if (!clean.length) { toast('Add at least one line with a price', 'error'); return; } save({ quote: { items: clean.map((i) => ({ label: i.label.trim(), qty: Number(i.qty) || 1, price: Number(i.price) })) }, status: 'quoted', note: note.value || null }, 'Quote sent to the customer'); } }, [icon('receipt'), j.quote ? 'Send the quote again' : 'Send the quote to the customer'])]);

      /* the details */
      const eta = input('eta', j.eta || '', { type: 'date' });
      eta.addEventListener('change', () => save({ eta: eta.value || null }));
      const owner = select('assignee', [['', 'Unassigned'], ...(people.some((p) => p.email === ctx.session.email) ? [] : [[ctx.session.email, `${ctx.session.name || 'Me'} (you)`]]), ...people.map((p) => [p.email, p.name])], j.assignee || '', { 'aria-label': 'Who is working on it', onchange: (e) => save({ assignee: e.target.value || null }) });
      const tg = (label, on, fn) => { const t = toggle('t', on, label); t.querySelector('input').addEventListener('change', (e) => fn(e.target.checked)); return t; };
      const addr = input('address', j.pickup?.address || '', { placeholder: 'Collection address' });
      addr.addEventListener('change', () => save({ pickup: { address: addr.value || null } }));
      const invTotal = input('invoice', j.invoice?.total ?? j.quote?.total ?? '', { type: 'number', min: 0, step: 50, placeholder: 'AED' });
      const details = h('section', { class: 'dsec' }, [h('h3', { text: 'Details' }), h('div', { class: 'fgrid' }, [field('Working on it', owner), field('Ready by', eta)]),
        tg('Collect from the customer', j.pickup?.needed, (v) => save({ pickup: { needed: v } })), j.pickup?.needed ? field('Address', addr) : null,
        tg('Courtesy car', j.courtesy, (v) => save({ courtesy: v })), tg('Covered by warranty', j.warranty?.covered, (v) => save({ warranty: { covered: v } })),
        h('div', { class: 'fgrid' }, [field('Invoice (AED)', invTotal), h('div', {}, [h('span', { class: 'fld__label', text: 'Paid' }), tg('Invoice paid', j.invoice?.paid, (v) => save({ invoice: { total: Number(invTotal.value) || j.quote?.total || 0, paid: v } }))])]),
        invTotal ? h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => save({ invoice: { total: Number(invTotal.value) || 0 } }, 'Invoice saved') }, 'Save invoice total') : null]);
      const tl = h('section', { class: 'dsec' }, [h('h3', { text: 'Timeline' }), h('ol', { class: 'tl' }, [...j.timeline].reverse().map((e) => h('li', { class: 'tl__i' }, [h('span', { class: 'tl__ic' }, icon('wrench')), h('div', {}, [h('p', { text: `${ST[e.status]?.[0] || e.status}${e.note ? ` - ${e.note}` : ''}` }), h('small', { text: `${e.by ? `${e.by} · ` : ''}${when(e.at)}` })])])))]);
      d.body.replaceChildren(h('div', { class: 'dhead' }, [chip(ST[j.status][0], ST[j.status][1]), j.warranty?.covered ? chip('Warranty', 'blue') : null, j.pickup?.needed ? chip('Collect', 'amber') : null, j.courtesy ? chip('Courtesy car', 'violet') : null]), steps, contact, h('section', { class: 'dsec' }, [j.description ? h('blockquote', { class: 'quote', text: j.description }) : null, note, advance, field('Or set any status', any)]), quote, details, tl);
    }
    paint();
  }
  load();
  return { destroy() { alive = false; }, live: (e) => { if (e.type.startsWith('job') || e.type === 'appointment.new') load(true); } };
}
