import { h, icon, ago, dateLabel, localToday, chip, debounce, segmented, skeleton, empty, errorState, drawer, confirmBox, toast, failed, whatsapp, input, APPT } from '../ui.js';
import { get, patch, post, del, qs, exportUrl } from '../api.js';

/* Bookings: service, repairs, test drives and call-backs requested on the website - confirm, reschedule, complete. */
const FILTERS = [['upcoming', 'Upcoming'], ['requested', 'To confirm'], ['confirmed', 'Confirmed'], ['past', 'Past'], ['', 'All']];
const SLOTS = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00'];

export function mountAppointments(view, { id }, ctx) {
  const state = { status: 'upcoming', q: '', day: '' };
  let rows = [];
  const count = h('span', { class: 'phead__count' });
  view.append(h('header', { class: 'phead' }, [
    h('div', {}, [h('p', { class: 'phead__eyebrow', text: 'Workshop & showroom' }), h('h1', { class: 'phead__title' }, ['Bookings ', count])]),
    h('div', { class: 'phead__actions' }, [h('a', { class: 'btn btn--ghost', href: exportUrl('appointments'), download: '' }, [icon('download'), h('span', { class: 'hide-sm', text: 'Export' })])])
  ]));
  const strip = h('div', { class: 'days', role: 'listbox', 'aria-label': 'Next two weeks' });
  const search = h('input', { class: 'inp inp--search', type: 'search', placeholder: 'Search name, phone, car, reference…', 'aria-label': 'Search bookings' });
  const seg = segmented(FILTERS, state.status, (v) => { state.status = v; state.day = ''; load(); }, { label: 'Status' });
  view.append(strip, h('div', { class: 'toolbar' }, [h('label', { class: 'search' }, [icon('search'), search]), h('div', { class: 'toolbar__seg' }, seg.el)]));
  const list = h('div', { class: 'agenda' }, skeleton(6));
  view.append(list);
  search.addEventListener('input', debounce(() => { state.q = search.value.trim(); load(); }, 280));

  async function loadStrip() {
    try {
      const res = await get('admin/appointments?status=upcoming&limit=500');
      const t = new Date(`${localToday()}T12:00:00`);
      const days = Array.from({ length: 14 }, (_, i) => new Date(t.getTime() + i * 864e5).toISOString().slice(0, 10));
      strip.replaceChildren(...days.map((d) => {
        const n = res.data.filter((a) => a.date === d).length;
        const dt = new Date(`${d}T12:00:00`);
        return h('button', { class: `day${state.day === d ? ' is-on' : ''}${n ? ' has' : ''}`, type: 'button', role: 'option', 'aria-selected': String(state.day === d), onclick: () => { state.day = state.day === d ? '' : d; if (state.status !== 'upcoming' && state.status !== '') { state.status = ''; seg.set(''); } load(); loadStrip(); } }, [
          h('small', { text: dt.toLocaleDateString('en-GB', { weekday: 'short' }) }), h('b', { text: String(dt.getDate()) }), h('span', { class: 'day__n', text: n ? String(n) : '' })
        ]);
      }));
    } catch { strip.replaceChildren(); }
  }

  async function load() {
    list.replaceChildren(skeleton(6));
    try {
      const res = await get(`admin/appointments${qs({ status: state.status, q: state.q, limit: 500, sort: state.status === 'past' ? 'created' : '' })}`);
      rows = state.day ? res.data.filter((a) => a.date === state.day) : res.data;
      if (state.status === 'past') rows.sort((a, b) => `${b.date} ${b.slot}`.localeCompare(`${a.date} ${a.slot}`));
      render();
      if (id) { const a = rows.find((x) => x.id === id) || (await get(`admin/appointments/${id}`).catch(() => null)); if (a) openAppt(a); id = null; }
    } catch (e) { list.replaceChildren(errorState(e, load)); }
  }

  function render() {
    count.textContent = String(rows.length);
    if (!rows.length) { list.replaceChildren(empty(state.day ? `Nothing on ${dateLabel(state.day)}` : 'No bookings here', 'Bookings made on the website’s Service page and car pages arrive here.')); return; }
    const groups = new Map();
    rows.forEach((a) => { if (!groups.has(a.date)) groups.set(a.date, []); groups.get(a.date).push(a); });
    list.replaceChildren(...[...groups].map(([d, items]) => h('section', { class: 'agenda__day' }, [
      h('h2', { class: 'agenda__date' }, [h('b', { text: dateLabel(d) }), h('small', { text: new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) })]),
      ...items.map(item)
    ])));
  }

  function item(a) {
    const quick = [];
    if (a.status === 'requested') quick.push(h('button', { class: 'btn btn--sm btn--primary', type: 'button', onclick: (e) => { e.stopPropagation(); setStatus(a, 'confirmed'); } }, [icon('check'), 'Confirm']));
    if (a.status === 'confirmed') quick.push(h('button', { class: 'btn btn--sm btn--ghost', type: 'button', onclick: (e) => { e.stopPropagation(); setStatus(a, 'completed'); } }, [icon('done'), 'Done']));
    quick.push(h('a', { class: 'qbtn', href: `tel:${a.phone.replace(/[^\d+]/g, '')}`, 'aria-label': `Call ${a.name}`, onclick: (e) => e.stopPropagation() }, icon('phone')));
    quick.push(h('a', { class: 'qbtn qbtn--wa', href: whatsapp(a.phone, `Hello ${a.name.split(' ')[0]}, this is Exotic Cars Dubai about your booking ${a.ref} on ${dateLabel(a.date)} at ${a.slot}.`), target: '_blank', rel: 'noopener noreferrer', 'aria-label': `WhatsApp ${a.name}`, onclick: (e) => e.stopPropagation() }, icon('whatsapp')));
    const el = h('article', { class: `appt appt--${a.status}`, tabindex: '0', role: 'button' }, [
      h('span', { class: 'appt__time', text: /^\d/.test(a.slot) ? a.slot : 'Call' }),
      h('span', { class: 'appt__t' }, [h('b', { text: a.service }), h('small', { text: [a.name, a.car, a.ref].filter(Boolean).join(' · ') })]),
      h('span', { class: 'appt__s' }, chip(APPT[a.status]?.label || a.status, APPT[a.status]?.tone)),
      h('span', { class: 'appt__q' }, quick)
    ]);
    el.addEventListener('click', () => openAppt(a));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openAppt(a); });
    return el;
  }

  async function setStatus(a, status) {
    try {
      Object.assign(a, await patch(`admin/appointments/${a.id}`, { status }));
      toast(`${a.ref}: ${APPT[status].label}`);
      render(); loadStrip(); ctx.refreshBadges();
      a._repaint?.();
    } catch (e) { failed(e); }
  }

  function openAppt(a) {
    const d = drawer({ title: a.service, sub: `${a.ref} · requested ${ago(a.createdAt)}`, wide: true });
    const paint = () => {
      const stages = h('div', { class: 'stages' }, Object.keys(APPT).map((s) => h('button', { class: `stage tone--${APPT[s].tone}${a.status === s ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(a.status === s), onclick: () => { if (a.status !== s) setStatus(a, s); } }, APPT[s].label)));
      const date = input('date', a.date, { type: 'date' });
      const slot = h('select', { class: 'inp inp--select', name: 'slot' }, [...new Set([a.slot, ...SLOTS])].map((s) => h('option', { value: s, text: s })));
      slot.value = a.slot;
      const when = h('section', { class: 'dsec' }, [h('h3', { text: 'When' }), h('div', { class: 'inline inline--3' }, [date, slot, h('button', { class: 'btn btn--ghost', type: 'button', onclick: async () => {
        try { Object.assign(a, await patch(`admin/appointments/${a.id}`, { date: date.value, slot: slot.value })); toast('Rescheduled'); load(); loadStrip(); paint(); } catch (e) { failed(e); }
      } }, 'Reschedule')])]);
      const contact = h('div', { class: 'contact' }, [
        h('a', { class: 'cbtn', href: `tel:${a.phone.replace(/[^\d+]/g, '')}` }, [icon('phone'), h('span', { text: 'Call' })]),
        h('a', { class: 'cbtn cbtn--wa', href: whatsapp(a.phone, `Hello ${a.name.split(' ')[0]}, this is Exotic Cars Dubai about your booking ${a.ref} on ${dateLabel(a.date)} at ${a.slot}.`), target: '_blank', rel: 'noopener noreferrer' }, [icon('whatsapp'), h('span', { text: 'WhatsApp' })]),
        a.email ? h('a', { class: 'cbtn', href: `mailto:${a.email}?subject=${encodeURIComponent(`Your booking ${a.ref}`)}` }, [icon('mail'), h('span', { text: 'Email' })]) : null
      ]);
      const facts = h('dl', { class: 'facts' }, [['Customer', a.name], ['Phone', a.phone], ['Email', a.email], ['Car', a.car], ['Booked for', `${dateLabel(a.date)} · ${a.slot}`], ['Account', a.customerId ? 'Signed-in customer' : null]]
        .filter(([, v]) => v).map(([k, v]) => h('div', {}, [h('dt', { text: k }), h('dd', { text: v })])));
      const theirs = a.notes ? h('section', { class: 'dsec' }, [h('h3', { text: 'From the customer' }), h('blockquote', { class: 'quote', text: a.notes })]) : null;
      const noteText = h('textarea', { class: 'inp inp--area', rows: 3, placeholder: 'Internal note: driver booked, parts ordered…', 'aria-label': 'New note' });
      const notes = h('section', { class: 'dsec' }, [
        h('h3', { text: 'Team notes' }),
        h('ol', { class: 'notes' }, [...(a.staffNotes || [])].reverse().map((n) => h('li', {}, [h('p', { text: n.text }), h('small', { text: `${n.by || 'Staff'} · ${ago(n.at)}` })]))),
        noteText,
        h('button', { class: 'btn btn--primary', type: 'button', onclick: async () => {
          if (!noteText.value.trim()) { noteText.focus(); return; }
          try { Object.assign(a, await post(`admin/appointments/${a.id}/notes`, { text: noteText.value.trim() })); paint(); } catch (e) { failed(e); }
        } }, [icon('plus'), 'Add note'])
      ]);
      const history = h('section', { class: 'dsec' }, [h('h3', { text: 'History' }), h('ol', { class: 'timeline' }, [...(a.history || [])].reverse().map((x) => h('li', {}, [h('span', { class: `dot tone--${APPT[x.status]?.tone || 'grey'}` }), h('span', { text: `${APPT[x.status]?.label || x.status}${x.by ? ` · ${x.by}` : ''}` }), h('small', { text: ago(x.at) })])))]);
      d.body.replaceChildren(stages, contact, facts, when, theirs || '', notes, history);
      d.foot.replaceChildren(h('button', { class: 'btn btn--ghost btn--danger-ghost', type: 'button', onclick: async () => {
        if (!(await confirmBox({ title: `Delete booking ${a.ref}?`, body: 'Use “Cancelled” to keep a record instead.', ok: 'Delete booking', danger: true }))) return;
        try { await del(`admin/appointments/${a.id}`); d.close(); toast('Booking deleted'); load(); loadStrip(); ctx.refreshBadges(); } catch (e) { failed(e); }
      } }, [icon('trash'), 'Delete booking']));
    };
    a._repaint = paint;
    paint();
  }

  loadStrip();
  load();
}
