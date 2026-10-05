import { h, icon, aed, compact, ago, chip, debounce, segmented, skeleton, empty, errorState, drawer, confirmBox, toast, failed, whatsapp, LEAD, LEAD_TYPE } from '../ui.js';
import { get, patch, post, del, qs, exportUrl, SITE } from '../api.js';

/*
 * Leads: every enquiry from the website (3D builds, car pages, general). A board by stage with drag and drop on a
 * desktop, a list on any screen, and a drawer with the full request, quick contact, notes and history.
 */
const STAGES = Object.keys(LEAD);
const VIEW_KEY = 'exotic-crm-leads-view';

export function mountLeads(view, { id }, ctx) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const stored = (() => { try { return localStorage.getItem(VIEW_KEY); } catch { return null; } })();
  let mode = stored || (matchMedia('(max-width: 720px)').matches ? 'list' : 'board');
  const state = { q: '', status: params.get('status') || '', type: '' };
  let leads = [];

  const count = h('span', { class: 'phead__count' });
  view.append(h('header', { class: 'phead' }, [
    h('div', {}, [h('p', { class: 'phead__eyebrow', text: 'Sales pipeline' }), h('h1', { class: 'phead__title' }, ['Leads ', count])]),
    h('div', { class: 'phead__actions' }, [
      h('a', { class: 'btn btn--ghost', href: exportUrl('leads'), download: '' }, [icon('download'), h('span', { class: 'hide-sm', text: 'Export' })])
    ])
  ]));
  const search = h('input', { class: 'inp inp--search', type: 'search', placeholder: 'Search name, phone, reference, car…', 'aria-label': 'Search leads' });
  const modeSeg = segmented([['board', 'Board'], ['list', 'List']], mode, (v) => { mode = v; try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } render(); }, { label: 'View' });
  const typeSeg = segmented([['', 'All'], ['configuration', '3D builds'], ['viewing', 'Car enquiries'], ['general', 'General']], '', (v) => { state.type = v; render(); }, { label: 'Type' });
  view.append(h('div', { class: 'toolbar' }, [
    h('label', { class: 'search' }, [icon('search'), search]),
    h('div', { class: 'toolbar__row toolbar__row--end' }, [modeSeg.el]),
    h('div', { class: 'toolbar__seg' }, typeSeg.el)
  ]));
  const body = h('div', { class: 'leads' }, skeleton(6));
  view.append(body);
  search.addEventListener('input', debounce(() => { state.q = search.value.trim(); load(); }, 280));

  async function load() {
    try {
      const res = await get(`admin/leads${qs({ q: state.q, limit: 500 })}`);
      leads = res.data;
      render();
      if (id) { const l = leads.find((x) => x.id === id); if (l) openLead(l); id = null; }
    } catch (e) { body.replaceChildren(errorState(e, load)); }
  }
  const visible = () => leads.filter((l) => !state.type || l.type === state.type);

  function render() {
    const list = visible();
    count.textContent = String(list.length);
    if (!leads.length) {
      body.replaceChildren(empty(state.q ? 'No leads match' : 'No leads yet', state.q ? 'Try another search.' : 'Enquiries sent from the 3D configurator and the car pages land here, with everything the customer chose.'));
      return;
    }
    body.replaceChildren(mode === 'board' ? board(list) : table(list));
  }

  /* ---------- board */
  function board(list) {
    const el = h('div', { class: 'board' }, STAGES.map((s) => {
      const items = list.filter((l) => l.status === s);
      const value = items.reduce((n, l) => n + (l.value || 0), 0);
      const col = h('section', { class: `col${state.status === s ? ' is-focus' : ''}`, dataset: { status: s } }, [
        h('header', { class: 'col__head' }, [h('span', { class: `dot tone--${LEAD[s].tone}` }), h('b', { text: LEAD[s].label }), h('span', { class: 'col__n', text: String(items.length) }), value ? h('small', { class: 'col__v', text: `AED ${compact(value)}` }) : null]),
        h('div', { class: 'col__cards' }, items.length ? items.map(card) : [h('p', { class: 'col__empty', text: 'Drop a lead here' })])
      ]);
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('is-over'); });
      col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('is-over'); });
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('is-over');
        const l = leads.find((x) => x.id === e.dataTransfer.getData('text/plain'));
        if (l && l.status !== s) move(l, s);
      });
      return col;
    }));
    if (state.status) requestAnimationFrame(() => el.querySelector('.is-focus')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
    return el;
  }

  function card(l) {
    const el = h('article', { class: 'lcard', draggable: 'true', tabindex: '0', role: 'button', 'aria-label': `${l.name}, ${LEAD[l.status].label}` }, [
      h('div', { class: 'lcard__top' }, [h('b', { text: l.name }), h('small', { text: ago(l.createdAt) })]),
      h('p', { class: 'lcard__car', text: l.car?.title || l.message || 'General enquiry' }),
      h('div', { class: 'lcard__foot' }, [
        chip(LEAD_TYPE[l.type] || 'Enquiry', l.type === 'configuration' ? 'red' : ''),
        l.value ? h('span', { class: 'lcard__v', text: `AED ${compact(l.value)}` }) : null,
        l.notes?.length ? h('span', { class: 'lcard__notes', title: `${l.notes.length} notes` }, [icon('note'), String(l.notes.length)]) : null
      ])
    ]);
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', l.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('is-drag'); });
    el.addEventListener('dragend', () => el.classList.remove('is-drag'));
    el.addEventListener('click', () => openLead(l));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLead(l); } });
    return el;
  }

  /* ---------- list */
  function table(list) {
    const rows = state.status ? list.filter((l) => l.status === state.status) : list;
    return h('div', { class: 'rows' }, [
      h('div', { class: 'chipbar' }, [['', 'All stages'], ...STAGES.map((s) => [s, LEAD[s].label])].map(([s, label]) => h('button', { class: `fchip${state.status === s ? ' is-on' : ''}`, type: 'button', onclick: () => { state.status = s; render(); } }, [s ? h('span', { class: `dot tone--${LEAD[s].tone}` }) : null, label, h('span', { class: 'fchip__n', text: String(s ? list.filter((l) => l.status === s).length : list.length) })]))),
      ...(rows.length ? rows.map((l) => h('button', { class: 'row row--btn', type: 'button', onclick: () => openLead(l) }, [
        h('span', { class: 'row__main' }, [
          h('span', { class: 'av', text: (l.name || '?')[0].toUpperCase() }),
          h('span', { class: 'row__t' }, [h('b', { text: l.name }), h('small', { text: [l.ref, LEAD_TYPE[l.type], l.car?.title].filter(Boolean).join(' · ') })]),
          h('span', { class: 'row__price' }, [chip(LEAD[l.status].label, LEAD[l.status].tone), h('small', { text: [l.value ? `AED ${compact(l.value)}` : null, ago(l.createdAt)].filter(Boolean).join(' · ') })])
        ])
      ])) : [empty('Nothing in this stage', null)])
    ]);
  }

  async function move(l, status) {
    const prev = l.status;
    l.status = status;
    render();
    try {
      Object.assign(l, await patch(`admin/leads/${l.id}`, { status }));
      toast(`${l.name} → ${LEAD[status].label}`);
      ctx.refreshBadges();
    } catch (e) { l.status = prev; render(); failed(e); }
  }

  /* ---------- detail drawer */
  function openLead(l) {
    const d = drawer({ title: l.name, sub: `${l.ref} · ${LEAD_TYPE[l.type] || 'Enquiry'} · ${ago(l.createdAt)}`, wide: true });
    const paint = () => {
      d.body.replaceChildren(...detail(l, d));
      d.foot.replaceChildren(h('button', { class: 'btn btn--ghost btn--danger-ghost', type: 'button', onclick: async () => {
        if (!(await confirmBox({ title: `Delete the lead from ${l.name}?`, body: 'Its notes and history go too. This cannot be undone.', ok: 'Delete lead', danger: true }))) return;
        try { await del(`admin/leads/${l.id}`); leads = leads.filter((x) => x.id !== l.id); render(); d.close(); toast('Lead deleted'); ctx.refreshBadges(); } catch (e) { failed(e); }
      } }, [icon('trash'), 'Delete lead']));
    };
    l._repaint = paint;
    paint();
  }

  function detail(l, d) {
    const first = (l.name || '').split(' ')[0];
    const stages = h('div', { class: 'stages', role: 'radiogroup', 'aria-label': 'Stage' }, STAGES.map((s) => h('button', {
      class: `stage tone--${LEAD[s].tone}${l.status === s ? ' is-on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(l.status === s),
      onclick: async () => { if (l.status === s) return; await move(l, s); l._repaint?.(); }
    }, LEAD[s].label)));

    const contact = h('div', { class: 'contact' }, [
      h('a', { class: 'cbtn', href: `tel:${l.phone.replace(/[^\d+]/g, '')}` }, [icon('phone'), h('span', { text: 'Call' })]),
      h('a', { class: 'cbtn cbtn--wa', href: whatsapp(l.phone, `Hello ${first}, this is Exotic Cars Dubai about your enquiry ${l.ref}${l.car?.title ? ` (${l.car.title})` : ''}.`), target: '_blank', rel: 'noopener noreferrer' }, [icon('whatsapp'), h('span', { text: 'WhatsApp' })]),
      l.email ? h('a', { class: 'cbtn', href: `mailto:${l.email}?subject=${encodeURIComponent(`Your enquiry ${l.ref}${l.car?.title ? ` – ${l.car.title}` : ''}`)}` }, [icon('mail'), h('span', { text: 'Email' })]) : null
    ]);

    const facts = h('dl', { class: 'facts' }, [
      ['Phone', l.phone], ['Email', l.email], ['Reference', l.ref], ['Came from', l.source], ['Received', new Date(l.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })],
      ['Account', l.customerId ? 'Signed-in customer' : null]
    ].filter(([, v]) => v).map(([k, v]) => h('div', {}, [h('dt', { text: k }), h('dd', { text: v })])));

    const carId = l.car?.id;
    const carBlock = l.car?.title ? h('section', { class: 'dsec' }, [
      h('h3', { text: 'Car' }),
      h('div', { class: 'carline' }, [h('b', { text: l.car.title }),
        /^\d+$/.test(String(carId ?? '')) ? h('span', { class: 'carline__links' }, [
          h('a', { href: `#/inventory/${carId}`, onclick: () => d.close() }, 'Inventory'),
          h('a', { href: `${SITE}#/shop/${carId}`, target: '_blank', rel: 'noopener' }, 'On the site')
        ]) : null])
    ]) : null;

    const cfg = l.configuration;
    const sameSite = (u) => { try { return new URL(u).origin === location.origin; } catch { return false; } };
    const build = cfg ? h('section', { class: 'dsec build' }, [
      h('h3', { text: '3D build' }),
      cfg.paint ? h('p', { class: 'build__paint' }, [icon('spark'), cfg.paint]) : null,
      h('ul', { class: 'build__lines' }, [
        ...(cfg.wheels || []).map((w) => h('li', {}, [h('span', { text: `${w.title}${w.qty > 1 ? ` ×${w.qty}` : ''}` }), h('b', { text: w.price ? aed(w.price) : 'On request' })])),
        ...(cfg.kits || []).map((k) => h('li', {}, [h('span', { text: k.title }), h('b', { text: k.price ? aed(k.price) : 'On request' })]))
      ]),
      !(cfg.wheels?.length || cfg.kits?.length) ? h('p', { class: 'muted', text: 'Colour only.' }) : null,
      h('div', { class: 'build__total' }, [h('span', { text: 'Parts total' }), h('b', { text: cfg.total ? aed(cfg.total) : '—' })]),
      cfg.url ? (sameSite(cfg.url)
        ? h('a', { class: 'btn btn--ghost btn--block', href: cfg.url, target: '_blank', rel: 'noopener' }, [icon('open'), 'Open this build in 3D'])
        : h('p', { class: 'muted small', text: `Build link (not opened automatically): ${cfg.url}` })) : null
    ]) : null;

    const message = l.message ? h('section', { class: 'dsec' }, [h('h3', { text: 'Message' }), h('blockquote', { class: 'quote', text: l.message })]) : null;

    const valueInput = h('input', { class: 'inp', type: 'number', min: 0, step: 1000, inputmode: 'numeric', value: l.value ?? '', 'aria-label': 'Deal value in AED' });
    const value = h('section', { class: 'dsec' }, [h('h3', { text: 'Deal value' }), h('div', { class: 'inline' }, [valueInput, h('button', { class: 'btn btn--ghost', type: 'button', onclick: async () => {
      try { Object.assign(l, await patch(`admin/leads/${l.id}`, { value: valueInput.value === '' ? null : Number(valueInput.value) })); toast('Value saved'); render(); } catch (e) { failed(e); }
    } }, 'Save')])]);

    const noteText = h('textarea', { class: 'inp inp--area', rows: 3, placeholder: 'Add a note: what was said, next step…', 'aria-label': 'New note' });
    const notes = h('section', { class: 'dsec' }, [
      h('h3', { text: `Notes${l.notes?.length ? ` (${l.notes.length})` : ''}` }),
      h('ol', { class: 'notes' }, [...(l.notes || [])].reverse().map((n) => h('li', {}, [h('p', { text: n.text }), h('small', { text: `${n.by || 'Staff'} · ${ago(n.at)}` })]))),
      noteText,
      h('button', { class: 'btn btn--primary', type: 'button', onclick: async (e) => {
        const b = e.currentTarget;
        if (!noteText.value.trim()) { noteText.focus(); return; }
        b.disabled = true;
        try { Object.assign(l, await post(`admin/leads/${l.id}/notes`, { text: noteText.value.trim() })); l._repaint?.(); render(); } catch (err) { failed(err); b.disabled = false; }
      } }, [icon('plus'), 'Add note'])
    ]);

    const history = h('section', { class: 'dsec' }, [h('h3', { text: 'History' }), h('ol', { class: 'timeline' }, [...(l.history || [])].reverse().map((x) => h('li', {}, [
      h('span', { class: `dot tone--${LEAD[x.status]?.tone || 'grey'}` }), h('span', { text: `${LEAD[x.status]?.label || x.status}${x.by ? ` · ${x.by}` : ''}` }), h('small', { text: ago(x.at) })
    ])))]);

    return [stages, contact, facts, carBlock, build, message, value, notes, history].filter(Boolean);
  }

  load();
  ctx.refreshBadges();
}
