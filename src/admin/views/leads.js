import { h, icon, aed, compact, ago, chip, debounce, segmented, skeleton, empty, errorState, drawer, confirmBox, toast, failed, whatsapp, field, input, textarea, select, showFieldErrors, LEAD, LEAD_TYPE, SOURCE, BAND, scoreRing, slaChip, when, can, initials } from '../ui.js';
import { get, patch, post, put, del, qs, exportUrl, SITE } from '../api.js';

/*
 * Leads: every enquiry, whether it arrived from the website (3D builds, car pages) or was logged here after a call or a
 * visit. A board by stage (drag and drop) or a list, each lead scored and timed, and a drawer that runs the whole deal:
 * who owns it, what was said, the price (starting from the car's listed price), the manager's approval of any
 * reduction, and the hand-over of the car to its buyer.
 */
const STAGES = Object.keys(LEAD);
const OPEN = ['new', 'contacted', 'qualified', 'negotiating'];
const VIEW_KEY = 'exotic-crm-leads-view';
const PAYMENT = [['cash', 'Cash'], ['finance', 'Finance'], ['lease', 'Lease'], ['part-exchange', 'Part-exchange']];
const KIND = { call: ['call', 'Call'], whatsapp: ['whatsapp', 'WhatsApp'], email: ['mail', 'Email'], visit: ['pin', 'Visit'] };
const OUTCOME = [['connected', 'Spoke to them'], ['no-answer', 'No answer'], ['left-message', 'Left a message'], ['visit-booked', 'Booked a visit'], ['offer-made', 'Made an offer'], ['not-interested', 'Not interested']];

export function mountLeads(view, { id }, ctx) {
  const role = ctx.session.role || 'owner';
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const stored = (() => { try { return localStorage.getItem(VIEW_KEY); } catch { return null; } })();
  let mode = stored || (matchMedia('(max-width: 720px)').matches ? 'list' : 'board');
  const state = { q: '', status: params.get('status') || '', type: '', band: '', sla: params.get('sla') || '', mine: params.get('mine') === '1', sort: 'priority' };
  let leads = [], people = [], alive = true;
  get('admin/people').then((r) => { people = r.data; }).catch(() => {});
  const nameOf = (email) => people.find((p) => p.email === email)?.name || (email === ctx.session.email ? (ctx.session.name || 'You') : email ? email.split('@')[0] : '');
  /* everyone a lead can be given to, including the person signed in (the shop login is not on the team list) */
  const ownerOptions = () => [['', 'Unassigned'], ...(people.some((p) => p.email === ctx.session.email) ? [] : [[ctx.session.email, `${ctx.session.name || 'Me'} (you)`]]), ...people.map((p) => [p.email, p.name])];

  const count = h('span', { class: 'phead__count' });
  view.append(h('header', { class: 'phead' }, [
    h('div', {}, [h('p', { class: 'phead__eyebrow', text: 'Sales pipeline' }), h('h1', { class: 'phead__title' }, ['Leads ', count])]),
    h('div', { class: 'phead__actions' }, [
      can(role, 'manage') ? h('a', { class: 'btn btn--ghost', href: exportUrl('leads'), download: '' }, [icon('download'), h('span', { class: 'hide-sm', text: 'Export' })]) : null,
      h('button', { class: 'btn btn--primary', type: 'button', onclick: () => newLead() }, [icon('plus'), 'New lead'])
    ])
  ]));
  const search = h('input', { class: 'inp inp--search', type: 'search', placeholder: 'Search name, phone, reference, car…', 'aria-label': 'Search leads' });
  const modeSeg = segmented([['board', 'Board'], ['list', 'List']], mode, (v) => { mode = v; try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } render(); }, { label: 'View' });
  const typeSeg = segmented([['', 'All'], ['configuration', '3D builds'], ['viewing', 'Car enquiries'], ['general', 'General']], '', (v) => { state.type = v; render(); }, { label: 'Type' });
  const bandSeg = segmented([['', 'Any score'], ['hot', 'Hot'], ['warm', 'Warm'], ['cool', 'Cold']], state.band, (v) => { state.band = v; load(); }, { label: 'Score' });
  const mineBtn = h('button', { class: `fchip${state.mine ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(state.mine), onclick: () => { state.mine = !state.mine; mineBtn.classList.toggle('is-on', state.mine); mineBtn.setAttribute('aria-pressed', String(state.mine)); load(); } }, [icon('target'), 'Mine']);
  const slaBtn = h('button', { class: `fchip fchip--hot${state.sla ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(!!state.sla), onclick: () => { state.sla = state.sla ? '' : 'overdue'; slaBtn.classList.toggle('is-on', !!state.sla); slaBtn.setAttribute('aria-pressed', String(!!state.sla)); load(); } }, [icon('timer'), 'Overdue']);
  view.append(h('div', { class: 'toolbar' }, [
    h('label', { class: 'search' }, [icon('search'), search]),
    h('div', { class: 'toolbar__row toolbar__row--end' }, [modeSeg.el]),
    h('div', { class: 'toolbar__seg' }, [typeSeg.el]),
    h('div', { class: 'toolbar__seg toolbar__seg--wrap' }, [bandSeg.el, mineBtn, slaBtn])
  ]));
  const body = h('div', { class: 'leads' }, skeleton(6));
  view.append(body);
  search.addEventListener('input', debounce(() => { state.q = search.value.trim(); load(); }, 280));

  async function load(quiet = false) {
    try {
      const res = await get(`admin/leads${qs({ q: state.q, limit: 500, sort: 'priority', mine: state.mine ? '1' : '', band: state.band, sla: state.sla })}`);
      if (!alive) return;
      leads = res.data;
      render();
      if (id) { const l = leads.find((x) => x.id === id); if (l) openLead(l); else openLead({ id }); id = null; }
    } catch (e) { if (!quiet) body.replaceChildren(errorState(e, load)); }
  }
  const visible = () => leads.filter((l) => !state.type || l.type === state.type);

  function render() {
    const list = visible();
    count.textContent = String(list.length);
    if (!leads.length) {
      body.replaceChildren(empty(state.q || state.band || state.sla || state.mine ? 'No leads match' : 'No leads yet', state.q || state.band || state.sla || state.mine ? 'Try other filters.' : 'Enquiries from the website land here, and you can log a phone call or a walk-in with New lead.', h('button', { class: 'btn btn--primary', type: 'button', onclick: () => newLead() }, [icon('plus'), 'New lead'])));
      return;
    }
    body.replaceChildren(mode === 'board' ? board(list) : table(list));
  }

  /* ---------- board */
  function board(list) {
    const el = h('div', { class: 'board' }, STAGES.map((s) => {
      const items = list.filter((l) => l.status === s);
      const value = items.reduce((n, l) => n + (l.value || 0), 0);
      const late = items.filter((l) => l.sla?.state === 'overdue').length;
      const col = h('section', { class: `col${state.status === s ? ' is-focus' : ''}`, dataset: { status: s } }, [
        h('header', { class: 'col__head' }, [h('span', { class: `dot tone--${LEAD[s].tone}` }), h('b', { text: LEAD[s].label }), h('span', { class: 'col__n', text: String(items.length) }), late ? h('span', { class: 'col__late', title: `${late} overdue`, text: `${late} late` }) : null, value ? h('small', { class: 'col__v', text: `AED ${compact(value)}` }) : null]),
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

  const approvalChip = (l) => (l.deal?.approval?.status === 'pending' && OPEN.includes(l.status) ? h('span', { class: 'chip chip--amber', title: 'A discount is waiting for a manager' }, [icon('approve'), 'Awaiting approval']) : l.deal?.approval?.status === 'approved' && l.deal?.discount?.amount ? chip('Discount approved', 'green') : null);

  function card(l) {
    const el = h('article', { class: `lcard${l.sla?.state === 'overdue' ? ' lcard--late' : ''}`, draggable: 'true', tabindex: '0', role: 'button', 'aria-label': `${l.name}, ${LEAD[l.status].label}, score ${l.score}` }, [
      h('div', { class: 'lcard__top' }, [scoreRing(l.score, l.band, 34), h('div', { class: 'lcard__who' }, [h('b', { text: l.name }), h('small', { text: ago(l.createdAt) })])]),
      h('p', { class: 'lcard__car', text: l.car?.title || l.deal?.carTitle || l.message || 'General enquiry' }),
      OPEN.includes(l.status) && l.nextBest ? h('p', { class: 'lcard__next' }, [icon('target'), l.nextBest]) : null,
      h('div', { class: 'lcard__foot' }, [
        slaChip(l.sla), approvalChip(l),
        l.source && l.source !== 'website' ? chip(SOURCE[l.source] || l.source, l.source === 'configurator' ? 'red' : '') : null,
        l.value ? h('span', { class: 'lcard__v', text: `AED ${compact(l.value)}` }) : null,
        l.assignee ? h('span', { class: 'av av--xs', title: nameOf(l.assignee), text: initials(nameOf(l.assignee)) }) : h('span', { class: 'av av--xs av--none', title: 'Unassigned', text: '·' })
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
          scoreRing(l.score, l.band, 38),
          h('span', { class: 'row__t' }, [h('b', { text: l.name }), h('small', { text: [l.ref, SOURCE[l.source] || LEAD_TYPE[l.type], l.car?.title || l.deal?.carTitle].filter(Boolean).join(' · ') })]),
          h('span', { class: 'row__price' }, [h('span', { class: 'row__chips' }, [slaChip(l.sla), approvalChip(l), chip(LEAD[l.status].label, LEAD[l.status].tone)]), h('small', { text: [l.value ? `AED ${compact(l.value)}` : null, l.assignee ? nameOf(l.assignee) : 'Unassigned', ago(l.createdAt)].filter(Boolean).join(' · ') })])
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
      if (status === 'won') openLead(l, 'deal');
    } catch (e) {
      l.status = prev; render(); failed(e);
      if (status === 'won') openLead(l, 'deal');
    }
  }

  /* ---------- a lead logged by hand: a call, a walk-in, a message */
  function newLead() {
    const d = drawer({ title: 'New lead', sub: 'Someone called, walked in or messaged. Put them in the pipeline.', wide: true });
    const f = {
      name: input('name', '', { placeholder: 'Full name', autocomplete: 'off', required: true }),
      phone: input('phone', '', { type: 'tel', inputmode: 'tel', placeholder: '+971 5X XXX XXXX', required: true }),
      email: input('email', '', { type: 'email', placeholder: 'Email (optional)' }),
      budget: input('budget', '', { type: 'number', min: 0, step: 1000, inputmode: 'numeric', placeholder: 'AED' }),
      message: textarea('message', '', { rows: 3, placeholder: 'What did they ask for? What did you promise?' }),
      status: select('status', [['new', 'New'], ['contacted', 'Already spoke to them'], ['qualified', 'Qualified']], 'contacted'),
      assignee: select('assignee', ownerOptions(), ctx.session.email)
    };
    let source = 'phone', car = null;
    const srcBar = h('div', { class: 'chipbar chipbar--wrap' }, ['phone', 'walk-in', 'whatsapp', 'instagram', 'referral', 'event', 'other'].map((s) => h('button', { class: `fchip${s === source ? ' is-on' : ''}`, type: 'button', onclick: (e) => { source = s; srcBar.querySelectorAll('.fchip').forEach((b) => b.classList.toggle('is-on', b === e.currentTarget)); } }, SOURCE[s])));
    /* the car they asked about: a search of the inventory */
    const carQ = h('input', { class: 'inp inp--search', type: 'search', placeholder: 'Search the inventory: make, model, id…', 'aria-label': 'Car they asked about' });
    const carPick = h('div', { class: 'pick' });
    const carChosen = h('div', { class: 'pick__chosen', hidden: true });
    const chooseCar = (c) => { car = c ? { id: c.id, title: c.title } : null; carChosen.hidden = !car; carChosen.replaceChildren(...(car ? [icon('car'), h('b', { text: car.title }), h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Remove', onclick: () => chooseCar(null) }, icon('close'))] : [])); carPick.replaceChildren(); carQ.value = ''; };
    carQ.addEventListener('input', debounce(async () => {
      const q = carQ.value.trim();
      if (q.length < 2) { carPick.replaceChildren(); return; }
      try {
        const r = await get(`admin/cars${qs({ q, status: 'sale', limit: 6 })}`);
        carPick.replaceChildren(...r.data.map((c) => h('button', { class: 'pick__item', type: 'button', onclick: () => chooseCar(c) }, [h('b', { text: c.title }), h('small', { text: [c.year, c.price ? aed(c.price) : 'Price on request'].filter(Boolean).join(' · ') })])));
      } catch { /* ignore */ }
    }, 250));
    const form = h('form', { class: 'dform', novalidate: true }, [
      h('div', { class: 'fgrid' }, [field('Name', f.name), field('Phone', f.phone), field('Email', f.email), field('Budget (AED)', f.budget)]),
      h('div', { class: 'dsec' }, [h('h3', { text: 'How did they reach us?' }), srcBar]),
      h('div', { class: 'dsec' }, [h('h3', { text: 'Which car?' }), carChosen, h('label', { class: 'search' }, [icon('search'), carQ]), carPick]),
      field('Notes', f.message, { span: 2 }),
      h('div', { class: 'fgrid' }, [field('Where is it now?', f.status), field('Owner', f.assignee)]),
      h('div', { class: 'dform__dup', hidden: true })
    ]);
    const dup = form.querySelector('.dform__dup');
    const submit = async (force = false) => {
      showFieldErrors(form, null); dup.hidden = true;
      const body = { name: f.name.value, phone: f.phone.value, email: f.email.value, message: f.message.value, source, type: car ? 'viewing' : 'general', car, budget: f.budget.value === '' ? null : Number(f.budget.value), assignee: f.assignee.value || null, status: f.status.value, confirmDuplicate: force || undefined };
      save.disabled = true;
      try {
        const l = await post('admin/leads', body);
        toast(`Lead ${l.ref} created`);
        d.close(); ctx.refreshBadges(); await load(true); openLead(l);
      } catch (e) {
        if (e.status === 409 && e.fields === null && /duplicate/i.test(e.title)) {
          dup.hidden = false;
          dup.replaceChildren(icon('alert'), h('div', {}, [h('b', { text: e.message }), h('div', { class: 'dform__dupbtns' }, [h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => submit(true) }, 'Add it anyway')])]));
        } else { showFieldErrors(form, e.fields); failed(e); }
      } finally { save.disabled = false; }
    };
    const save = h('button', { class: 'btn btn--primary', type: 'button', onclick: () => submit(false) }, [icon('check'), 'Create lead']);
    d.body.append(form); d.foot.append(save);
    f.name.focus();
  }

  /* ---------- the drawer */
  async function openLead(stub, tab = 'overview') {
    const d = drawer({ title: stub.name || 'Lead', sub: stub.ref || '', wide: true });
    d.body.replaceChildren(skeleton(4));
    let l;
    try { l = await get(`admin/leads/${stub.id}`); } catch (e) { d.body.replaceChildren(errorState(e)); return; }
    const reload = async (keepTab) => { try { l = await get(`admin/leads/${l.id}`); } catch (e) { failed(e); return; } const i = leads.findIndex((x) => x.id === l.id); if (i >= 0) Object.assign(leads[i], l); render(); paint(keepTab); ctx.refreshBadges(); };
    const apply = (next, keepTab) => { l = next; const i = leads.findIndex((x) => x.id === l.id); if (i >= 0) Object.assign(leads[i], l); render(); paint(keepTab); ctx.refreshBadges(); };
    let current = tab;
    const tabs = segmented([['overview', 'Overview'], ['deal', 'Deal'], ['timeline', 'Timeline']], tab, (v) => { current = v; paint(v); }, { label: 'Lead sections' });
    const content = h('div', { class: 'dcontent' });
    d.body.replaceChildren(h('div', { class: 'dhead' }), tabs.el, content);
    const dhead = d.body.firstChild;
    function paint(t = current) {
      current = t; tabs.set(t);
      d.titleEl.textContent = l.name; d.subEl.textContent = `${l.ref} · ${SOURCE[l.source] || LEAD_TYPE[l.type] || 'Enquiry'} · ${ago(l.createdAt)}`;
      dhead.replaceChildren(...[scoreRing(l.score, l.band, 46), h('div', { class: 'dhead__t' }, [h('b', { text: `${BAND[l.band]?.label || ''} lead` }), h('small', { text: l.reasons?.[0]?.text || '' })]), slaChip(l.sla), l.deal?.approval?.status === 'pending' && OPEN.includes(l.status) ? chip('Awaiting approval', 'amber') : null, l.owned ? chip('Handed over', 'green') : null].filter(Boolean));
      content.replaceChildren(...(t === 'overview' ? overview() : t === 'deal' ? dealTab() : timeline()));
      d.foot.replaceChildren(...[can(role, 'delete') ? h('button', { class: 'btn btn--ghost btn--danger-ghost', type: 'button', onclick: async () => {
        if (!(await confirmBox({ title: `Delete the lead from ${l.name}?`, body: 'Its notes and history go too. This cannot be undone.', ok: 'Delete lead', danger: true }))) return;
        try { await del(`admin/leads/${l.id}`); leads = leads.filter((x) => x.id !== l.id); render(); d.close(); toast('Lead deleted'); ctx.refreshBadges(); } catch (e) { failed(e); }
      } }, [icon('trash'), 'Delete lead']) : null].filter(Boolean));
    }

    /* --- overview */
    function overview() {
      const first = (l.name || '').split(' ')[0];
      const stages = h('div', { class: 'stages', role: 'radiogroup', 'aria-label': 'Stage' }, STAGES.map((s) => h('button', {
        class: `stage tone--${LEAD[s].tone}${l.status === s ? ' is-on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(l.status === s),
        onclick: async () => {
          if (l.status === s) return;
          try { apply(await patch(`admin/leads/${l.id}`, { status: s })); toast(`Moved to ${LEAD[s].label}`); if (s === 'won') paint('deal'); } catch (e) { failed(e); if (s === 'won') paint('deal'); }
        }
      }, LEAD[s].label)));
      const contact = h('div', { class: 'contact' }, [
        h('a', { class: 'cbtn', href: `tel:${l.phone.replace(/[^\d+]/g, '')}`, onclick: () => { paint('timeline'); } }, [icon('phone'), h('span', { text: 'Call' })]),
        h('a', { class: 'cbtn cbtn--wa', href: whatsapp(l.phone, `Hello ${first}, this is Exotic Cars Dubai about your enquiry ${l.ref}${l.car?.title ? ` (${l.car.title})` : ''}.`), target: '_blank', rel: 'noopener noreferrer', onclick: () => paint('timeline') }, [icon('whatsapp'), h('span', { text: 'WhatsApp' })]),
        l.email ? h('a', { class: 'cbtn', href: `mailto:${l.email}?subject=${encodeURIComponent(`Your enquiry ${l.ref}${l.car?.title ? ` – ${l.car.title}` : ''}`)}` }, [icon('mail'), h('span', { text: 'Email' })]) : null,
        h('button', { class: 'cbtn cbtn--ink', type: 'button', onclick: () => paint('timeline') }, [icon('history'), h('span', { text: 'Log contact' })])
      ]);
      const next = OPEN.includes(l.status) ? h('section', { class: `next next--${l.band}` }, [
        h('div', { class: 'next__head' }, [icon('target'), h('b', { text: 'Next best action' })]),
        h('p', { class: 'next__t', text: l.nextBest || 'Nothing to do' }),
        l.nextAction?.at ? h('small', { class: 'next__when', text: `Follow-up planned ${when(l.nextAction.at)}` }) : null,
        h('ul', { class: 'why' }, (l.reasons || []).map((r) => h('li', { class: r.up ? 'is-up' : 'is-down', text: r.text })))
      ]) : null;
      const owner = h('div', { class: 'inline inline--owner' }, [h('span', { class: 'muted', text: 'Owner' }), select('assignee', ownerOptions(), l.assignee || '', { 'aria-label': 'Owner of this lead', onchange: async (e) => { try { apply(await patch(`admin/leads/${l.id}`, { assignee: e.target.value || null }), 'overview'); toast('Owner updated'); } catch (err) { failed(err); } } })]);
      const facts = h('dl', { class: 'facts' }, [['Phone', l.phone], ['Email', l.email], ['Reference', l.ref], ['Came from', SOURCE[l.source] || l.source], ['Received', when(l.createdAt)], ['Logged by', l.origin === 'staff' ? nameOf(l.createdBy) : null], ['Account', l.customerId ? 'Signed-in customer' : null]].filter(([, v]) => v).map(([k, v]) => h('div', {}, [h('dt', { text: k }), h('dd', { text: v })])));
      const carId = l.car?.id ?? l.deal?.carId;
      const cr = l.carRef;
      const carBlock = l.car?.title || cr ? h('section', { class: 'dsec' }, [
        h('h3', { text: 'Car' }),
        h('div', { class: 'carline' }, [h('b', { text: cr?.title || l.car.title }),
          /^\d+$/.test(String(carId ?? '')) ? h('span', { class: 'carline__links' }, [h('a', { href: `#/inventory/${carId}`, onclick: () => d.close() }, 'Inventory'), h('a', { href: `${SITE}#/shop/${carId}`, target: '_blank', rel: 'noopener' }, 'On the site')]) : null]),
        cr ? h('p', { class: 'muted small', text: cr.sold ? 'This car is already marked sold.' : cr.price ? `Listed at ${aed(cr.price)}` : 'No listed price yet. Set one in the Deal tab or in Inventory.' }) : null
      ]) : null;
      const cfg = l.configuration;
      const sameSite = (u) => { try { return new URL(u).origin === location.origin; } catch { return false; } };
      const build = cfg ? h('section', { class: 'dsec build' }, [
        h('h3', { text: '3D build' }),
        cfg.paint ? h('p', { class: 'build__paint' }, [icon('spark'), cfg.paint]) : null,
        h('ul', { class: 'build__lines' }, [...(cfg.wheels || []).map((w) => h('li', {}, [h('span', { text: `${w.title}${w.qty > 1 ? ` ×${w.qty}` : ''}` }), h('b', { text: w.price ? aed(w.price) : 'On request' })])), ...(cfg.kits || []).map((k) => h('li', {}, [h('span', { text: k.title }), h('b', { text: k.price ? aed(k.price) : 'On request' })]))]),
        !(cfg.wheels?.length || cfg.kits?.length) ? h('p', { class: 'muted', text: 'Colour only.' }) : null,
        h('div', { class: 'build__total' }, [h('span', { text: 'Parts total' }), h('b', { text: cfg.total ? aed(cfg.total) : '—' })]),
        cfg.url ? (sameSite(cfg.url) ? h('a', { class: 'btn btn--ghost btn--block', href: cfg.url, target: '_blank', rel: 'noopener' }, [icon('open'), 'Open this build in 3D']) : h('p', { class: 'muted small', text: `Build link (not opened automatically): ${cfg.url}` })) : null
      ]) : null;
      const message = l.message ? h('section', { class: 'dsec' }, [h('h3', { text: 'Message' }), h('blockquote', { class: 'quote', text: l.message })]) : null;
      return [stages, contact, next, owner, facts, carBlock, build, message].filter(Boolean);
    }

    /* --- the deal */
    function dealTab() {
      const deal = l.deal || {};
      const cr = l.carRef;
      const pol = l.policy?.discount || { salesAutoPct: 0, managerAutoPct: 5, maxPct: 25 };
      const invPrice = cr?.price ?? null;
      const closed = !OPEN.includes(l.status);
      const out = [];

      /* listed price: from the inventory, or entered here when the car has none yet */
      const listIn = input('listPrice', deal.listPrice ?? '', { type: 'number', min: 1, step: 1000, inputmode: 'numeric', placeholder: 'AED', 'aria-label': 'Listed price' });
      const listBlock = invPrice != null
        ? h('div', { class: 'price price--list' }, [h('span', { class: 'price__k', text: 'Listed price' }), h('b', { class: 'price__v', text: aed(invPrice) }), h('small', { class: 'muted', text: 'From the inventory' })])
        : h('div', { class: 'price price--list' }, [h('span', { class: 'price__k', text: 'Listed price' }), field('', listIn, { hint: cr ? 'This car has no listed price yet. Enter the price it is offered at.' : 'No car is attached. Enter the price it is offered at.' })]);
      const finalIn = input('finalPrice', deal.finalPrice ?? invPrice ?? deal.listPrice ?? '', { type: 'number', min: 1, step: 1000, inputmode: 'numeric', placeholder: 'AED', 'aria-label': 'Agreed price' });
      const reason = textarea('reason', deal.discount?.reason || '', { rows: 2, placeholder: 'Why is the price lower? (cash buyer, trade-in, repeat customer…)' });
      const calc = h('div', { class: 'calc' });
      const reasonWrap = field('Reason for the reduction', reason);
      const saveBtn = h('button', { class: 'btn btn--primary', type: 'button', disabled: closed }, [icon('check'), 'Save price']);
      const listVal = () => (invPrice != null ? invPrice : Number(listIn.value) || null);
      function recalc() {
        const lp = listVal(), fp = Number(finalIn.value) || 0;
        const disc = lp && fp ? Math.max(0, lp - fp) : 0, pct = lp ? (disc / lp) * 100 : 0;
        reasonWrap.hidden = !(disc > 0);
        const owner = role === 'owner', mgr = role === 'manager';
        const auto = owner || (mgr && pct <= pol.managerAutoPct) || (role === 'sales' && pct <= pol.salesAutoPct);
        const tooMuch = pct > pol.maxPct && !owner;
        let note = '', cls = 'calc--ok';
        if (!lp) { note = 'Enter the listed price first.'; cls = 'calc--warn'; }
        else if (fp > lp) { note = `AED ${(fp - lp).toLocaleString('en-AE')} above the listed price.`; }
        else if (disc === 0) { note = 'At the listed price. No approval needed.'; }
        else if (tooMuch) { note = `More than the ${pol.maxPct}% limit. Only the owner can go this far.`; cls = 'calc--bad'; }
        else if (auto) { note = 'Within your limit. Approved automatically.'; }
        else { note = `Needs a manager's approval${pol.salesAutoPct ? ` (you can give up to ${pol.salesAutoPct}% yourself)` : ''}.`; cls = 'calc--warn'; }
        calc.className = `calc ${cls}`;
        calc.replaceChildren(h('div', { class: 'calc__row' }, [h('span', { text: 'Off the listed price' }), h('b', { text: disc ? `− ${aed(disc)} (${pct.toFixed(pct < 10 ? 1 : 0)}%)` : 'None' })]), h('p', { text: note }));
        saveBtn.lastChild.textContent = disc > 0 && !auto && !tooMuch ? 'Send for approval' : 'Save price';
        saveBtn.disabled = closed || tooMuch;
      }
      finalIn.addEventListener('input', recalc); listIn.addEventListener('input', recalc);
      let pay = deal.payment || '';
      const payBar = h('div', { class: 'chipbar chipbar--wrap' }, PAYMENT.map(([v, t]) => h('button', { class: `fchip${pay === v ? ' is-on' : ''}`, type: 'button', disabled: closed, onclick: (e) => { pay = pay === v ? '' : v; payBar.querySelectorAll('.fchip').forEach((b) => b.classList.toggle('is-on', b === e.currentTarget && !!pay)); } }, t)));
      const dep = input('deposit', deal.deposit ?? '', { type: 'number', min: 0, step: 1000, inputmode: 'numeric', placeholder: 'AED', disabled: closed });
      const tdesc = input('tradeDesc', deal.tradeIn?.desc || '', { placeholder: 'Their car (make, model, year)', disabled: closed });
      const tval = input('tradeValue', deal.tradeIn?.value ?? '', { type: 'number', min: 0, step: 1000, inputmode: 'numeric', placeholder: 'AED', disabled: closed });
      /* what is saved on the server right now; anything else in the boxes is not part of the deal yet */
      const unsaved = () => !closed && ((finalIn.value !== '' && Number(finalIn.value) !== (deal.finalPrice ?? invPrice ?? deal.listPrice ?? null)) || (invPrice == null && listIn.value !== '' && Number(listIn.value) !== (deal.listPrice ?? null)));
      saveBtn.addEventListener('click', async () => {
        const lp0 = listVal(), fp0 = Number(finalIn.value) || 0;
        if (lp0 && fp0 && fp0 < lp0 && !reason.value.trim()) { reasonWrap.hidden = false; reason.focus(); reason.setAttribute('aria-invalid', 'true'); toast('Say why the price is lower first'); return; }
        reason.removeAttribute('aria-invalid');
        const body = { finalPrice: finalIn.value === '' ? undefined : Number(finalIn.value), reason: reason.value || null, payment: pay || null, deposit: dep.value === '' ? null : Number(dep.value), tradeIn: tdesc.value || tval.value ? { desc: tdesc.value || null, value: tval.value === '' ? null : Number(tval.value) } : null };
        if (invPrice == null && listIn.value) body.listPrice = Number(listIn.value);
        saveBtn.disabled = true;
        try { const next = await put(`admin/leads/${l.id}/deal`, body); apply(next, 'deal'); toast(next.deal?.approval?.status === 'pending' ? 'Sent to a manager for approval' : 'Price saved'); } catch (e) { failed(e); recalc(); }
      });
      out.push(h('section', { class: 'dsec' }, [h('h3', { text: 'Price' }), listBlock, h('div', { class: 'price' }, [h('span', { class: 'price__k', text: 'Agreed price' }), field('', finalIn, { hint: invPrice != null || listVal() ? 'Starts at the listed price. Change it only if the price changed.' : '' })]), calc, reasonWrap, closed ? h('p', { class: 'muted small', text: 'This lead is closed, so its price is fixed.' }) : saveBtn]));
      out.push(h('section', { class: 'dsec' }, [h('h3', { text: 'How they are paying' }), payBar, h('div', { class: 'fgrid' }, [field('Deposit (AED)', dep), field('Trade-in value (AED)', tval)]), field('Trade-in car', tdesc)]));
      recalc();

      /* the manager's decision */
      const ap = deal.approval;
      if (ap && ap.status !== 'none') {
        const mine = ap.requestedBy === ctx.session.email;
        const note = textarea('note', '', { rows: 2, placeholder: 'Note for the record (optional)' });
        const decide = async (decision) => { try { apply(await post(`admin/leads/${l.id}/discount`, { decision, note: note.value || null }), 'deal'); toast(decision === 'approved' ? 'Discount approved' : 'Discount rejected'); } catch (e) { failed(e); if (/changed|expired/i.test(e.title)) reload('deal'); } };
        const apSection = h('section', { class: `dsec approval approval--${ap.status}` }, [
          h('h3', { text: 'Discount approval' }),
          h('div', { class: 'approval__head' }, [icon(ap.status === 'approved' ? 'verified' : ap.status === 'pending' ? 'timer' : 'alert'), h('b', { text: { pending: 'Waiting for a manager', approved: ap.auto ? 'Approved automatically' : 'Approved', rejected: 'Rejected', expired: 'Request expired', stale: 'Listed price changed' }[ap.status] || ap.status })]),
          h('p', { class: 'muted', text: `AED ${(deal.discount?.amount || 0).toLocaleString('en-AE')} (${deal.discount?.pct}%) off ${aed(deal.listPrice)}${deal.discount?.reason ? ` · "${deal.discount.reason}"` : ''}` }),
          h('p', { class: 'muted small', text: `Asked by ${ap.requestedByName || nameOf(ap.requestedBy)} · ${ago(ap.requestedAt)}${ap.decidedBy && ap.status !== 'pending' ? ` · decided by ${ap.decidedByName || nameOf(ap.decidedBy)} ${ago(ap.decidedAt)}${ap.note ? ` · "${ap.note}"` : ''}` : ''}${ap.status === 'pending' && ap.expiresAt ? ` · valid until ${when(ap.expiresAt)}` : ''}` }),
          ap.status === 'pending' && l.canApprove ? (mine ? h('p', { class: 'muted small', text: 'You asked for this, so someone else has to approve it.' }) : h('div', { class: 'approval__act' }, [note, h('div', { class: 'inline' }, [h('button', { class: 'btn btn--primary', type: 'button', onclick: () => decide('approved') }, [icon('check'), 'Approve']), h('button', { class: 'btn btn--ghost btn--danger-ghost', type: 'button', onclick: () => decide('rejected') }, [icon('close'), 'Reject'])])])) : null,
          ['expired', 'stale', 'rejected'].includes(ap.status) ? h('p', { class: 'muted small', text: 'Change the price above and send it again.' }) : null
        ]);
        if (ap.status === 'pending') out.unshift(apSection); else out.push(apSection);
      }

      /* closing: won, then hand the car over */
      if (OPEN.includes(l.status)) {
        out.push(h('section', { class: 'dsec' }, [h('h3', { text: 'Close the deal' }), h('p', { class: 'muted small', text: 'A deal can be won once its price is saved and any discount is approved.' }), h('button', { class: 'btn btn--primary btn--block', type: 'button', onclick: async () => { if (unsaved()) { toast('You changed the price but have not saved it. Save the price first.'); saveBtn.focus(); return; } try { apply(await patch(`admin/leads/${l.id}`, { status: 'won' }), 'deal'); toast('Marked won'); } catch (e) { failed(e); } } }, [icon('verified'), 'Mark as won'])]));
      } else if (l.status === 'won') {
        out.push(l.owned ? h('section', { class: 'dsec handover handover--done' }, [h('h3', { text: 'Handed over' }), codeCard(l.owned.claimCode, l.owned.status, l)]) : h('section', { class: 'dsec' }, [h('h3', { text: 'Hand over the car' }), h('p', { class: 'muted small', text: 'Move the car out of the stock and into the buyer’s garage in the app, with its warranty and next service date.' }), h('button', { class: 'btn btn--primary btn--block', type: 'button', onclick: () => handover() }, [icon('key'), 'Hand over the car'])]));
      }
      return out;
    }

    function codeCard(code, status, lead) {
      const link = `${SITE}#/account`;
      const msg = `Congratulations on your new car! Add it to your garage in the Exotic Cars app: open ${link}, sign in, then Garage > Add a car, and enter this code: ${code}. You will see your warranty, service history and next service there.`;
      return h('div', { class: 'code' }, [
        h('small', { class: 'muted', text: 'Garage code for the buyer' }), h('b', { class: 'code__v', text: code }),
        h('p', { class: 'muted small', text: status === 'claimed' ? 'The buyer has added the car to their garage.' : 'Not claimed yet. Send the code to the buyer.' }),
        h('div', { class: 'inline' }, [
          h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => navigator.clipboard?.writeText(code).then(() => toast('Code copied'), () => toast('Copy is not available', 'error')) }, [icon('copy'), 'Copy']),
          h('a', { class: 'btn btn--ghost btn--sm', href: whatsapp(lead.phone, msg), target: '_blank', rel: 'noopener noreferrer' }, [icon('whatsapp'), 'Send on WhatsApp'])
        ])
      ]);
    }

    function handover() {
      const hd = drawer({ title: 'Hand over the car', sub: l.carRef?.title || l.car?.title || '' });
      const plate = input('plate', '', { placeholder: 'e.g. A 12345' }), vin = input('vin', '', { placeholder: '17 characters' }), km = input('km', '', { type: 'number', min: 0, inputmode: 'numeric', placeholder: 'Odometer at delivery' }), war = input('warrantyText', '', { placeholder: 'e.g. 4 years, or leave to use the car’s own' });
      let plan = '';
      const planBar = h('div', { class: 'chipbar chipbar--wrap' }, [['', 'No plan'], ['essential', 'Essential care'], ['complete', 'Complete care'], ['concierge', 'Concierge']].map(([v, t]) => h('button', { class: `fchip${plan === v ? ' is-on' : ''}`, type: 'button', onclick: (e) => { plan = v; planBar.querySelectorAll('.fchip').forEach((b) => b.classList.toggle('is-on', b === e.currentTarget)); } }, t)));
      hd.body.append(h('div', { class: 'dform' }, [h('div', { class: 'fgrid' }, [field('Plate', plate), field('VIN', vin), field('Kilometres', km), field('Warranty', war)]), h('div', { class: 'dsec' }, [h('h3', { text: 'Care plan' }), planBar])]));
      const go = h('button', { class: 'btn btn--primary', type: 'button', onclick: async () => {
        go.disabled = true;
        try {
          const o = await post(`admin/leads/${l.id}/handover`, { plate: plate.value || null, vin: vin.value || null, km: km.value === '' ? null : Number(km.value), warrantyText: war.value || null, plan: plan || null });
          hd.body.replaceChildren(h('div', { class: 'handover handover--done' }, [h('h3', { text: 'Handed over' }), codeCard(o.claimCode, o.status, l)]));
          hd.foot.replaceChildren(h('button', { class: 'btn btn--primary', type: 'button', onclick: () => { hd.close(); reload('deal'); } }, 'Done'));
          toast('Car handed over');
        } catch (e) { failed(e); go.disabled = false; }
      } }, [icon('key'), 'Hand over']);
      hd.foot.append(go);
    }

    /* --- the timeline, and logging a contact */
    function timeline() {
      let kind = 'call';
      const kindBar = h('div', { class: 'chipbar' }, Object.entries(KIND).map(([k, [ic, t]]) => h('button', { class: `fchip${kind === k ? ' is-on' : ''}`, type: 'button', onclick: (e) => { kind = k; kindBar.querySelectorAll('.fchip').forEach((b) => b.classList.toggle('is-on', b === e.currentTarget)); } }, [icon(ic), t])));
      const outcome = select('outcome', [['', 'What happened?'], ...OUTCOME], '');
      const note = textarea('note', '', { rows: 2, placeholder: 'What was said?' });
      const nextAt = input('nextAt', '', { type: 'datetime-local' });
      const nextText = input('nextText', '', { placeholder: 'Follow up on… (e.g. confirm the visit)' });
      const log = h('section', { class: 'dsec' }, [
        h('h3', { text: 'Log a contact' }), kindBar, h('div', { class: 'fgrid' }, [field('Result', outcome), field('Follow up on', nextAt)]), field('Note', note), field('Reminder text', nextText),
        h('button', { class: 'btn btn--primary', type: 'button', onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try { apply(await post(`admin/leads/${l.id}/touch`, { kind, outcome: outcome.value || null, note: note.value || null, nextAt: nextAt.value ? new Date(nextAt.value).toISOString() : null, nextText: nextText.value || null }), 'timeline'); toast('Contact logged'); } catch (err) { failed(err); b.disabled = false; }
        } }, [icon('check'), 'Save contact'])
      ]);
      const noteText = textarea('newnote', '', { rows: 2, placeholder: 'Add a note…', 'aria-label': 'New note' });
      const addNote = h('div', { class: 'dsec' }, [noteText, h('button', { class: 'btn btn--ghost', type: 'button', onclick: async (e) => { if (!noteText.value.trim()) { noteText.focus(); return; } const b = e.currentTarget; b.disabled = true; try { await post(`admin/leads/${l.id}/notes`, { text: noteText.value.trim() }); await reload('timeline'); } catch (err) { failed(err); b.disabled = false; } } }, [icon('plus'), 'Add note'])]);
      /* one list: the new event log, or the older history and notes for leads made before it */
      const events = (l.events && l.events.length ? l.events : [...(l.history || []).map((x) => ({ at: x.at, kind: 'stage', by: x.by, text: `Moved to ${x.status}` })), ...(l.notes || []).map((n) => ({ at: n.at, kind: 'note', by: n.by, text: n.text }))]).slice().sort((a, b) => b.at.localeCompare(a.at));
      const IC = { created: 'plus', stage: 'board', note: 'note', touch: 'phone', deal: 'money', approval: 'approve', assign: 'users', handover: 'key' };
      const list = h('ol', { class: 'tl' }, events.map((e) => h('li', { class: `tl__i tl__i--${e.kind}` }, [h('span', { class: 'tl__ic' }, icon(IC[e.kind] || 'dot')), h('div', {}, [h('p', { text: e.text }), h('small', { text: `${e.by ? `${nameOf(e.by)} · ` : ''}${when(e.at)}` })])])));
      return [log, addNote, h('section', { class: 'dsec' }, [h('h3', { text: 'Timeline' }), list])];
    }

    paint(tab);
  }

  load();
  ctx.refreshBadges();
  return { destroy() { alive = false; }, live: (e) => { if (/^(lead|approval)/.test(e.type)) load(true); } };
}
