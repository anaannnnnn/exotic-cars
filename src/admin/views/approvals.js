import { h, icon, aed, ago, chip, skeleton, empty, errorState, toast, failed, when, textarea } from '../ui.js';
import { get, post } from '../api.js';

/* Approvals: every discount a salesperson has asked for, waiting for a manager. Approve or reject in one tap, with the facts beside it. */
export function mountApprovals(view, _p, ctx) {
  let alive = true;
  const count = h('span', { class: 'phead__count' });
  view.append(h('header', { class: 'phead' }, [h('div', {}, [h('p', { class: 'phead__eyebrow', text: 'Maker and checker' }), h('h1', { class: 'phead__title' }, ['Approvals ', count])])]));
  const body = h('div', { class: 'approvals' }, skeleton(3));
  view.append(body);

  async function load() {
    try {
      const res = await get('admin/approvals');
      if (!alive) return;
      count.textContent = String(res.data.length);
      body.replaceChildren(...(res.data.length ? res.data.map(row) : [empty('Nothing is waiting', 'When a salesperson asks for a discount, it appears here for you to approve or reject.')]));
      ctx.refreshBadges();
    } catch (e) { body.replaceChildren(errorState(e, load)); }
  }

  function row(a) {
    const mine = a.requestedByEmail === ctx.session.email;
    const note = textarea('note', '', { rows: 2, placeholder: 'Note for the record (optional)', 'aria-label': 'Note' });
    const decide = async (decision) => {
      try { await post(`admin/leads/${a.id}/discount`, { decision, note: note.value || null }); toast(decision === 'approved' ? 'Discount approved' : 'Discount rejected'); load(); } catch (e) { failed(e); load(); }
    };
    return h('article', { class: 'card appr' }, [
      h('header', { class: 'card__head' }, [h('div', {}, [h('h2', { text: a.name }), h('small', { text: `${a.ref}${a.car ? ` · ${a.car}` : ''}` })]), h('a', { class: 'card__link', href: `#/leads/${a.id}` }, ['Open the lead', icon('arrow')])]),
      h('div', { class: 'appr__nums' }, [
        h('div', {}, [h('small', { text: 'Listed price' }), h('b', { text: aed(a.listPrice) })]),
        h('div', {}, [h('small', { text: 'Agreed price' }), h('b', { text: aed(a.finalPrice) })]),
        h('div', { class: 'appr__off' }, [h('small', { text: 'Off the price' }), h('b', { text: `− ${aed(a.discount?.amount || 0)}` }), h('span', { class: 'chip chip--amber', text: `${a.discount?.pct}%` })])
      ]),
      a.reason ? h('blockquote', { class: 'quote', text: a.reason }) : null,
      h('p', { class: 'muted small', text: `Asked by ${a.requestedBy} · ${ago(a.requestedAt)}${a.expiresAt ? ` · valid until ${when(a.expiresAt)}` : ''}` }),
      mine ? h('p', { class: 'muted small', text: 'You asked for this one, so someone else has to approve it.' }) : h('div', { class: 'approval__act' }, [note, h('div', { class: 'inline' }, [
        h('button', { class: 'btn btn--primary', type: 'button', onclick: () => decide('approved') }, [icon('check'), 'Approve']),
        h('button', { class: 'btn btn--ghost btn--danger-ghost', type: 'button', onclick: () => decide('rejected') }, [icon('close'), 'Reject'])
      ])])
    ]);
  }
  load();
  return { destroy() { alive = false; }, live: (e) => { if (e.type.startsWith('approval') || e.type === 'lead.updated') load(); } };
}
