import { store, newId, getMany, listKeys } from './store.mjs';

/*
 * The activity log: who did what, and when. Every sign-in and every change made in the CRM by a named person lands here
 * (written by the API's dispatcher, so no screen can forget to). Read by owners and managers, and by each person for their own.
 */
export async function logActivity(entry) {
  const rec = { id: newId(), at: new Date().toISOString(), ...entry };
  try { await store('crm').setJSON(`activity/${rec.id}`, rec); } catch { /* the log must never break a request */ }
  return rec;
}

const norm = (s) => String(s ?? '').toLowerCase();

export async function listActivity({ limit = 50, offset = 0, by, action, entity, q, since } = {}) {
  const keys = await listKeys('crm', 'activity/');
  const out = [];
  let skipped = 0, total = 0;
  /* newest first; read in batches until the page is full, then count the rest cheaply by key */
  for (let i = 0; i < keys.length && out.length < limit; i += 120) {
    const batch = await getMany('crm', keys.slice(i, i + 120));
    batch.sort((a, b) => b.at.localeCompare(a.at));
    for (const r of batch) {
      if (by && r.by !== by) continue;
      if (action && !String(r.action).startsWith(action)) continue;
      if (entity && r.entity?.type !== entity) continue;
      if (since && r.at < since) continue;
      if (q && !norm(`${r.summary} ${r.by} ${r.byName} ${r.entity?.label} ${r.entity?.ref}`).includes(norm(q))) continue;
      total += 1;
      if (skipped < offset) { skipped += 1; continue; }
      if (out.length < limit) out.push(r);
    }
  }
  return { data: out, pagination: { limit, offset, shown: out.length, hasMore: out.length === limit && offset + out.length < keys.length } };
}

/** The people who appear in the log, for the filter. */
export async function activityPeople() {
  const keys = (await listKeys('crm', 'activity/')).slice(0, 400);
  const rows = await getMany('crm', keys);
  const m = new Map();
  rows.forEach((r) => { if (r.by) m.set(r.by, { email: r.by, name: r.byName || r.by, role: r.byRole || null }); });
  return [...m.values()];
}
