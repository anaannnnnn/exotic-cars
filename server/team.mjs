import { HttpError } from './http.mjs';
import { store, getMany, listKeys } from './store.mjs';
import { hashPassword, verifyPassword, memberId, findMember, ROLES } from './auth.mjs';

/*
 * The team: each person has their own login and a role. The shop's own login (set up in Settings or the environment)
 * stays the owner and can never be locked out. Roles:
 *   owner    everything, including the team and the policy
 *   manager  everything about sales and stock, approves discounts, sees the forecast and the activity log
 *   sales    leads, customers, bookings and the cars; asks a manager to approve discounts
 *   service  bookings and the workshop; sees customers
 */
export { ROLES };
const pub = ({ passwordHash, ...m }) => m;

export async function listTeam() {
  const rows = await getMany('crm', await listKeys('crm', 'staff/'));
  return rows.map(pub).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export async function createMember({ email, name, role, branch, password }) {
  if (await findMember(email)) throw new HttpError(409, 'Already on the team', 'There is already a login with that email.');
  const at = new Date().toISOString();
  const m = { id: memberId(email), email, name, role, branch: branch || null, active: true, passwordHash: await hashPassword(password), createdAt: at, lastLoginAt: null };
  const res = await store('crm').setJSON(`staff/${m.id}`, m, { onlyIfNew: true });
  if (res?.modified === false) throw new HttpError(409, 'Already on the team', 'There is already a login with that email.');
  return pub(m);
}

export async function patchMember(id, patch, by) {
  const cur = await store('crm').get(`staff/${id}`, { type: 'json' });
  if (!cur) throw new HttpError(404, 'Not found', 'There is nobody on the team with that id.');
  if (by?.uid === id && (patch.active === false || (patch.role && patch.role !== cur.role))) {
    throw new HttpError(400, 'Not allowed', 'You cannot deactivate yourself or change your own role.');
  }
  const next = { ...cur };
  for (const k of ['name', 'role', 'branch', 'active']) if (patch[k] !== undefined) next[k] = patch[k];
  if (patch.password) { next.passwordHash = await hashPassword(patch.password); next.passwordChangedAt = new Date().toISOString(); }
  await store('crm').setJSON(`staff/${id}`, next);
  return pub(next);
}

/** Names for display: who is who, by email. */
export async function teamNames() {
  const m = new Map();
  for (const x of await listTeam()) m.set(x.email, x.name);
  return m;
}

/** A team member changes their own password; every other session of theirs ends. */
export async function changeOwnPassword(id, current, next) {
  const m = await store('crm').get(`staff/${id}`, { type: 'json' });
  if (!m) throw new HttpError(404, 'Not found', 'There is nobody on the team with that id.');
  if (!(await verifyPassword(current, m.passwordHash))) throw new HttpError(400, 'Invalid request', 'Some fields are missing or not valid.', { fields: { current: 'That is not the current password' } });
  const upd = { ...m, passwordHash: await hashPassword(next), passwordChangedAt: new Date().toISOString() };
  await store('crm').setJSON(`staff/${id}`, upd);
  return upd;
}
