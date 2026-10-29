import { h, icon, chip, skeleton, empty, errorState, drawer, toast, failed, field, input, select, toggle, ROLE, roleChip, when, ago, initials, confirmBox, showFieldErrors } from '../ui.js';
import { get, post, patch } from '../api.js';

/* Team: each person has their own login and a role. Owners add and change people; managers can see who is on the team. */
const ROLE_TEXT = {
  owner: 'Everything, including the team, the rules and data import.',
  manager: 'All sales and stock work, approves discounts, sees forecast, purchasing and everyone’s activity.',
  sales: 'Leads, customers, bookings and cars. Asks a manager to approve a discount.',
  service: 'Bookings and the workshop. Sees customers.'
};

export function mountTeam(view, _p, ctx) {
  const owner = ctx.session.role === 'owner';
  let branches = [{ id: 'dubai', name: 'Dubai showroom' }];
  get('admin/policy').then((p) => { branches = p.branches; }).catch(() => {});
  view.append(h('header', { class: 'phead' }, [h('div', {}, [h('p', { class: 'phead__eyebrow', text: 'Who can do what' }), h('h1', { class: 'phead__title', text: 'Team' })]), h('div', { class: 'phead__actions' }, [owner ? h('button', { class: 'btn btn--primary', type: 'button', onclick: () => edit(null) }, [icon('adduser'), 'Add a person']) : null])]));
  const roles = h('section', { class: 'roles' }, Object.keys(ROLE_TEXT).map((r) => h('div', { class: 'roles__i' }, [roleChip(r), h('p', { text: ROLE_TEXT[r] })])));
  const body = h('div', { class: 'rows' }, skeleton(4));
  view.append(roles, body);
  let members = [];
  async function load() {
    try {
      members = (await get('admin/team')).data;
      body.replaceChildren(h('div', { class: 'row row--static row--me' }, [h('span', { class: 'row__main' }, [h('span', { class: 'av', text: 'O' }), h('span', { class: 'row__t' }, [h('b', { text: 'Shop login' }), h('small', { text: 'The login set up for this CRM. It is the owner and cannot be removed.' })]), h('span', { class: 'row__price' }, roleChip('owner'))])]),
        ...(members.length ? members.map(row) : [empty('Just the shop login so far', owner ? 'Add your managers, salespeople and workshop staff so everything they do is logged under their name.' : 'The owner can add people here.')]));
    } catch (e) { body.replaceChildren(errorState(e, load)); }
  }
  const row = (m) => h(owner ? 'button' : 'div', { class: `row row--btn${m.active === false ? ' is-off' : ''}`, type: owner ? 'button' : undefined, onclick: owner ? () => edit(m) : undefined }, [h('span', { class: 'row__main' }, [
    h('span', { class: 'av', text: initials(m.name) }), h('span', { class: 'row__t' }, [h('b', { text: m.name }), h('small', { text: `${m.email}${m.branch ? ` · ${branches.find((b) => b.id === m.branch)?.name || m.branch}` : ''} · ${m.lastLoginAt ? `last in ${ago(m.lastLoginAt)}` : 'never signed in'}` })]),
    h('span', { class: 'row__price' }, [m.active === false ? chip('Deactivated', 'grey') : null, roleChip(m.role)])
  ])]);

  function edit(m) {
    const d = drawer({ title: m ? m.name : 'Add a person', sub: m ? m.email : 'They sign in with their own email and password.' });
    const f = {
      name: input('name', m?.name || '', { placeholder: 'Full name' }), email: input('email', m?.email || '', { type: 'email', placeholder: 'name@company.com', disabled: Boolean(m) }),
      role: select('role', Object.keys(ROLE).map((r) => [r, ROLE[r].label]), m?.role || 'sales'),
      branch: select('branch', [['', 'All branches'], ...branches.map((b) => [b.id, b.name])], m?.branch || ''),
      password: input('password', '', { type: 'password', autocomplete: 'new-password', placeholder: m ? 'Leave empty to keep the current one' : 'At least 10 characters' })
    };
    const active = toggle('active', m ? m.active !== false : true, 'Can sign in');
    const hint = h('p', { class: 'muted small', text: ROLE_TEXT[f.role.value] });
    f.role.addEventListener('change', () => { hint.textContent = ROLE_TEXT[f.role.value]; });
    const form = h('form', { class: 'dform', novalidate: true }, [field('Name', f.name), field('Email', f.email), field('Role', f.role), hint, field('Branch', f.branch, { hint: 'A salesperson with a branch sees only that branch’s leads and jobs.' }), field(m ? 'New password' : 'Password', f.password), m ? active : null]);
    const save = h('button', { class: 'btn btn--primary', type: 'button', onclick: async () => {
      showFieldErrors(form, null); save.disabled = true;
      try {
        if (m) {
          const body = { name: f.name.value, role: f.role.value, branch: f.branch.value || null, active: active.querySelector('input').checked };
          if (f.password.value) body.password = f.password.value;
          await patch(`admin/team/${m.id}`, body);
        } else await post('admin/team', { name: f.name.value, email: f.email.value, role: f.role.value, branch: f.branch.value || null, password: f.password.value });
        toast(m ? 'Saved' : 'Added to the team'); d.close(); load();
      } catch (e) { showFieldErrors(form, e.fields); failed(e); save.disabled = false; }
    } }, [icon('check'), m ? 'Save' : 'Add to the team']);
    d.body.append(form); d.foot.append(save);
  }
  load();
}
