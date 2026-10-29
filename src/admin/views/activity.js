import { h, icon, chip, skeleton, empty, errorState, debounce, select, ago, when, roleChip, initials } from '../ui.js';
import { get, qs } from '../api.js';

/* Activity: who signed in, and who did what, newest first. Owners and managers see everyone; everyone else sees their own. */
const AREAS = [['', 'Everything'], ['auth', 'Sign-ins'], ['lead', 'Leads'], ['appointment', 'Bookings'], ['job', 'Workshop'], ['car', 'Inventory'], ['product', 'Wheels & kits'], ['customer', 'Customers'], ['team-member', 'Team'], ['policy', 'Policy']];
const ICON = { auth: 'lock', lead: 'leads', appointment: 'calendar', job: 'wrench', car: 'car', product: 'wheel', customer: 'users', 'team-member': 'adduser', policy: 'settings', data: 'db', photo: 'photo', 'garage-car': 'key' };

export function mountActivity(view, _p, ctx) {
  const mgr = ctx.session.role === 'owner' || ctx.session.role === 'manager';
  let alive = true, offset = 0;
  const state = { by: '', action: '', q: '', since: '' };
  view.append(h('header', { class: 'phead' }, [h('div', {}, [h('p', { class: 'phead__eyebrow', text: mgr ? 'Everyone on the team' : 'Your actions' }), h('h1', { class: 'phead__title', text: 'Activity' })])]));
  const search = h('input', { class: 'inp inp--search', type: 'search', placeholder: 'Search the log…', 'aria-label': 'Search the log' });
  const who = select('by', [['', 'Everyone']], '', { 'aria-label': 'Person', hidden: !mgr, onchange: (e) => { state.by = e.target.value; reset(); } });
  const area = select('action', AREAS, '', { 'aria-label': 'Area', onchange: (e) => { state.action = e.target.value; reset(); } });
  const period = select('since', [['', 'All time'], ['1', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days']], '', { 'aria-label': 'Period', onchange: (e) => { state.since = e.target.value ? new Date(Date.now() - (e.target.value === '1' ? 0 : +e.target.value * 864e5)).toISOString().slice(0, e.target.value === '1' ? 10 : 19) : ''; if (e.target.value === '1') state.since = `${new Date().toISOString().slice(0, 10)}T00:00:00`; reset(); } });
  view.append(h('div', { class: 'toolbar' }, [h('label', { class: 'search' }, [icon('search'), search]), h('div', { class: 'toolbar__row' }, [who, area, period])]));
  const list = h('div', { class: 'act' }, skeleton(8));
  const more = h('button', { class: 'btn btn--ghost btn--block', type: 'button', hidden: true, onclick: () => load(true) }, 'Show older activity');
  view.append(list, more);
  search.addEventListener('input', debounce(() => { state.q = search.value.trim(); reset(); }, 300));
  let people = false;

  function reset() { offset = 0; list.replaceChildren(...skeleton(6).children); load(false); }
  let lastDay = '';
  async function load(append) {
    try {
      if (!append) lastDay = '';
      const res = await get(`admin/activity${qs({ limit: 40, offset, by: state.by, action: state.action, q: state.q, since: state.since })}`);
      if (!alive) return;
      if (!people && res.people?.length) { people = true; res.people.forEach((p) => who.append(h('option', { value: p.email, text: p.name }))); }
      const rows = res.data.map((r) => {
        const day = new Date(r.at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
        const head = day !== lastDay ? h('h3', { class: 'act__day', text: day }) : null;
        lastDay = day;
        return [head, h('div', { class: 'act__row' }, [
          h('span', { class: `act__ic act__ic--${String(r.action).split('.')[0]}` }, icon(ICON[r.entity?.type] || ICON[String(r.action).split('.')[0]] || 'activity')),
          h('div', { class: 'act__t' }, [h('p', {}, [h('b', { text: r.byName || r.by || 'Someone' }), ' ', r.summary || r.action]), h('small', { text: `${r.byRole ? '' : ''}${when(r.at)} · ${ago(r.at)}${r.entity?.ref ? ` · ${r.entity.ref}` : ''}` })]),
          r.byRole ? roleChip(r.byRole) : null
        ])];
      }).flat().filter(Boolean);
      if (!append) list.replaceChildren();
      if (!rows.length && !append) list.replaceChildren(empty('Nothing here yet', 'Sign-ins and changes made in the CRM appear here.'));
      else list.append(...rows);
      offset += res.data.length;
      more.hidden = !res.pagination.hasMore;
    } catch (e) { list.replaceChildren(errorState(e, () => load(false))); }
  }
  load(false);
  return { destroy() { alive = false; }, live: () => { if (offset <= 40) load(false); } };
}
