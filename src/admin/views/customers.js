import { h, icon, ago, dateLabel, chip, debounce, skeleton, empty, errorState, drawer, confirmBox, toast, failed, whatsapp, initials, field, input, showFieldErrors, LEAD, APPT, LEAD_TYPE } from '../ui.js';
import { get, post, del, qs, exportUrl } from '../api.js';

/* Customers who created an account on the website, with everything they have sent. Deleting honours a removal request. */
export function mountCustomers(view, { id }) {
  const state = { q: '' };
  const count = h('span', { class: 'phead__count' });
  view.append(h('header', { class: 'phead' }, [
    h('div', {}, [h('p', { class: 'phead__eyebrow', text: 'Website accounts' }), h('h1', { class: 'phead__title' }, ['Customers ', count])]),
    h('div', { class: 'phead__actions' }, [h('button', { class: 'btn btn--primary', type: 'button', onclick: () => addCustomer() }, [icon('plus'), 'Add customer']), h('a', { class: 'btn btn--ghost', href: exportUrl('customers'), download: '' }, [icon('download'), h('span', { class: 'hide-sm', text: 'Export' })])])
  ]));
  const search = h('input', { class: 'inp inp--search', type: 'search', placeholder: 'Search name, email, phone…', 'aria-label': 'Search customers' });
  view.append(h('div', { class: 'toolbar' }, [h('label', { class: 'search' }, [icon('search'), search])]));
  const list = h('div', { class: 'rows' }, skeleton(6));
  view.append(list);
  search.addEventListener('input', debounce(() => { state.q = search.value.trim(); load(); }, 280));

  async function load() {
    try {
      const res = await get(`admin/customers${qs({ q: state.q, limit: 500 })}`);
      count.textContent = String(res.pagination.total);
      list.replaceChildren(...(res.data.length ? res.data.map(row) : [empty(state.q ? 'No customers match' : 'No accounts yet', 'Customers who sign up on the website’s Account page appear here with their enquiries and bookings.')]));
      if (id) { openCustomer(id); id = null; }
    } catch (e) { list.replaceChildren(errorState(e, load)); }
  }

  const row = (c) => h('button', { class: 'row row--btn', type: 'button', onclick: () => openCustomer(c.id) }, h('span', { class: 'row__main' }, [
    h('span', { class: 'av av--lg', text: initials(c.name) }),
    h('span', { class: 'row__t' }, [h('b', { text: c.name }), h('small', { text: [c.email, c.phone].filter(Boolean).join(' · ') })]),
    h('span', { class: 'row__price' }, [
      h('span', { class: 'row__chips' }, [c.leads ? chip(`${c.leads} lead${c.leads > 1 ? 's' : ''}`, 'red') : null, c.appointments ? chip(`${c.appointments} booking${c.appointments > 1 ? 's' : ''}`, 'blue') : null]),
      h('small', { text: `Joined ${ago(c.createdAt)}` })
    ])
  ]));

  /* a customer the team adds by hand (a walk-in, a phone call); they can claim the record later by signing up on the website with the same email */
  function addCustomer() {
    const d = drawer({ title: 'Add customer', sub: 'Someone who has not made a website account. Their email is how we find them again.' });
    const f = { name: input('name', '', { placeholder: 'Full name', autocomplete: 'off', required: true }), email: input('email', '', { type: 'email', placeholder: 'name@example.com', required: true }), phone: input('phone', '', { type: 'tel', inputmode: 'tel', placeholder: '+971 5X XXX XXXX' }) };
    const form = h('form', { class: 'dform', novalidate: true }, [h('div', { class: 'fgrid' }, [field('Name', f.name), field('Email', f.email), field('Phone', f.phone, { hint: 'Optional' })])]);
    const save = h('button', { class: 'btn btn--primary', type: 'button' }, [icon('check'), 'Add customer']);
    const submit = async () => {
      showFieldErrors(form, null); save.disabled = true;
      try { const c = await post('admin/customers', { name: f.name.value, email: f.email.value, phone: f.phone.value }); toast(`${c.name} added`); d.close(); await load(); openCustomer(c.id); }
      catch (e) { showFieldErrors(form, e.fields); failed(e); } finally { save.disabled = false; }
    };
    save.addEventListener('click', submit); form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    d.body.append(form); d.foot.append(save); f.name.focus();
  }

  async function openCustomer(cid) {
    const d = drawer({ title: 'Customer', wide: true });
    d.body.append(skeleton(5));
    let c;
    try { c = await get(`admin/customers/${cid}`); } catch (e) { d.body.replaceChildren(errorState(e)); return; }
    d.titleEl.textContent = c.name;
    d.subEl.textContent = `Joined ${ago(c.createdAt)}${c.lastLoginAt ? ` · last sign-in ${ago(c.lastLoginAt)}` : ''}`;
    d.body.replaceChildren(...[
      h('div', { class: 'contact' }, [
        c.phone ? h('a', { class: 'cbtn', href: `tel:${c.phone.replace(/[^\d+]/g, '')}` }, [icon('phone'), h('span', { text: 'Call' })]) : null,
        c.phone ? h('a', { class: 'cbtn cbtn--wa', href: whatsapp(c.phone, `Hello ${c.name.split(' ')[0]}, this is Exotic Cars Dubai.`), target: '_blank', rel: 'noopener noreferrer' }, [icon('whatsapp'), h('span', { text: 'WhatsApp' })]) : null,
        h('a', { class: 'cbtn', href: `mailto:${c.email}` }, [icon('mail'), h('span', { text: 'Email' })])
      ]),
      h('dl', { class: 'facts' }, [['Email', c.email], ['Phone', c.phone], ['Account created', new Date(c.createdAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })]].filter(([, v]) => v).map(([k, v]) => h('div', {}, [h('dt', { text: k }), h('dd', { text: v })]))),
      h('section', { class: 'dsec' }, [h('h3', { text: `Enquiries (${c.leads.length})` }), c.leads.length ? h('ul', { class: 'feed' }, c.leads.map((l) => h('li', {}, h('a', { class: 'feed__row', href: `#/leads/${l.id}`, onclick: () => d.close() }, [
        h('span', { class: 'feed__t' }, [h('b', { text: l.car?.title || LEAD_TYPE[l.type] || 'Enquiry' }), h('small', { text: `${l.ref} · ${ago(l.createdAt)}` })]),
        h('span', { class: 'feed__r' }, chip(LEAD[l.status]?.label || l.status, LEAD[l.status]?.tone))
      ])))) : h('p', { class: 'muted', text: 'None yet.' })]),
      (c.owned?.length ? h('section', { class: 'dsec' }, [h('h3', { text: `Garage (${c.owned.length})` }), h('ul', { class: 'feed' }, c.owned.map((o) => h('li', { class: 'feed__row feed__row--static' }, [
        h('span', { class: 'feed__t' }, [h('b', { text: o.title }), h('small', { text: [o.plate, o.warranty?.until ? `Warranty to ${dateLabel(o.warranty.until)}` : null, o.nextService?.date ? `Next service ${dateLabel(o.nextService.date)}` : null].filter(Boolean).join(' · ') })]),
        h('span', { class: 'feed__r' }, chip(`${o.history?.length || 0} visit${(o.history?.length || 0) === 1 ? '' : 's'}`, 'blue'))
      ])))]) : null),
      (c.jobs?.length ? h('section', { class: 'dsec' }, [h('h3', { text: `Workshop (${c.jobs.length})` }), h('ul', { class: 'feed' }, c.jobs.map((j) => h('li', {}, h('a', { class: 'feed__row', href: '#/workshop', onclick: () => d.close() }, [
        h('span', { class: 'feed__t' }, [h('b', { text: j.title }), h('small', { text: [j.ref, j.vehicle].filter(Boolean).join(' · ') })]),
        h('span', { class: 'feed__r' }, [chip(j.status.replace(/-/g, ' '), j.status === 'delivered' ? 'green' : 'amber'), j.quote ? h('small', { text: `AED ${j.quote.total.toLocaleString('en-AE')}` }) : null])
      ]))))]) : null),
      h('section', { class: 'dsec' }, [h('h3', { text: `Bookings (${c.appointments.length})` }), c.appointments.length ? h('ul', { class: 'feed' }, c.appointments.map((a) => h('li', {}, h('a', { class: 'feed__row', href: `#/appointments/${a.id}`, onclick: () => d.close() }, [
        h('span', { class: 'when' }, [h('b', { text: /^\d/.test(a.slot) ? a.slot : 'Call' }), h('small', { text: dateLabel(a.date) })]),
        h('span', { class: 'feed__t' }, [h('b', { text: a.service }), h('small', { text: [a.car, a.ref].filter(Boolean).join(' · ') })]),
        h('span', { class: 'feed__r' }, chip(APPT[a.status]?.label || a.status, APPT[a.status]?.tone))
      ])))) : h('p', { class: 'muted', text: 'None yet.' })])
    ].filter(Boolean));
    d.foot.replaceChildren(h('button', { class: 'btn btn--ghost btn--danger-ghost', type: 'button', onclick: async () => {
      if (!(await confirmBox({ title: `Delete ${c.name}’s account?`, body: 'They can no longer sign in. Their enquiries and bookings stay in the CRM; delete those separately if they asked for all their data to be removed.', ok: 'Delete account', danger: true }))) return;
      try { await del(`admin/customers/${c.id}`); d.close(); toast('Account deleted'); load(); } catch (e) { failed(e); }
    } }, [icon('trash'), 'Delete account']));
  }

  load();
}
