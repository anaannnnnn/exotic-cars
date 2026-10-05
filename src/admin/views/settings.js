import { h, icon, ago, chip, skeleton, errorState, confirmBox, toast, failed } from '../ui.js';
import { get, post, exportUrl, SITE } from '../api.js';

/* Settings: the data the site runs on (import / re-import), CSV exports, system health and the audit trail. */
const EVENTS = {
  'staff.login': ['Signed in', 'green'], 'staff.login-failed': ['Failed sign-in', 'red'], 'rate-limited': ['Rate limit hit', 'amber'],
  import: ['Data imported', 'blue'], 'import.manual': ['Import run', 'blue'], export: ['CSV exported', ''],
  'car.create': ['Car added', 'green'], 'car.update': ['Car edited', ''], 'car.delete': ['Car deleted', 'red'],
  'product.create': ['Product added', 'green'], 'product.update': ['Product edited', ''], 'product.delete': ['Product deleted', 'red'],
  'lead.delete': ['Lead deleted', 'red'], 'appointment.delete': ['Booking deleted', 'red'], 'customer.delete': ['Account deleted', 'red']
};

export function mountSettings(view, _p, ctx) {
  view.append(h('header', { class: 'phead' }, [h('div', {}, [h('p', { class: 'phead__eyebrow', text: 'System' }), h('h1', { class: 'phead__title', text: 'Settings' })])]));
  const grid = h('div', { class: 'settings' });
  view.append(grid);

  /* ---------- data */
  const dataCard = h('article', { class: 'card' }, skeleton(3));
  async function paintData() {
    let st;
    try { st = await get('admin/import'); } catch (e) { dataCard.replaceChildren(errorState(e, paintData)); return; }
    const run = (mode) => async (e) => {
      const b = e.currentTarget;
      if (mode === 'replace' && !(await confirmBox({ title: 'Replace stock and catalogue?', body: 'Every car, wheel and kit goes back to the copy built into the website. Edits, added cars and uploaded covers in the inventory are lost. Leads, bookings and customers are not touched.', ok: 'Replace everything', danger: true }))) return;
      b.disabled = true;
      try {
        const r = await post('admin/import', { mode });
        toast(`Cars: ${r.done.cars}, products: ${r.done.products}`);
        paintData();
      } catch (err) { failed(err); b.disabled = false; }
    };
    dataCard.replaceChildren(
      h('header', { class: 'card__head' }, [h('h2', { text: 'Stock & catalogue data' }), h('small', { text: 'What the website shows comes from here.' })]),
      h('ul', { class: 'checks' }, [
        h('li', {}, [icon(st.cars ? 'done' : 'alert'), h('span', { text: 'Cars' }), chip(st.cars ? 'In the database' : 'Not imported', st.cars ? 'green' : 'amber')]),
        h('li', {}, [icon(st.products ? 'done' : 'alert'), h('span', { text: 'Wheels & kits' }), chip(st.products ? 'In the database' : 'Not imported', st.products ? 'green' : 'amber')])
      ]),
      st.last ? h('p', { class: 'muted small', text: `Last import ${ago(st.last.at)} (${st.last.mode === 'replace' ? 'replaced' : 'missing only'})` }) : null,
      h('div', { class: 'card__actions' }, [
        h('button', { class: 'btn btn--primary', type: 'button', onclick: run('missing') }, [icon('download'), 'Import what is missing']),
        h('button', { class: 'btn btn--ghost btn--danger-ghost', type: 'button', onclick: run('replace') }, [icon('refresh'), 'Reset from the website copy'])
      ])
    );
  }

  /* ---------- exports */
  const exportsCard = h('article', { class: 'card' }, [
    h('header', { class: 'card__head' }, [h('h2', { text: 'Export to a spreadsheet' }), h('small', { text: 'CSV, opens in Excel, Numbers and Google Sheets.' })]),
    h('div', { class: 'exports' }, [['leads', 'Leads', 'leads'], ['appointments', 'Bookings', 'calendar'], ['customers', 'Customers', 'users'], ['cars', 'Inventory', 'car'], ['products', 'Wheels & kits', 'wheel']]
      .map(([k, label, ic]) => h('a', { class: 'export', href: exportUrl(k), download: '' }, [icon(ic), h('b', { text: label }), icon('download', 'export__dl')])))
  ]);

  /* ---------- health */
  const healthCard = h('article', { class: 'card' }, skeleton(3));
  async function paintHealth() {
    let hl;
    try { hl = await get('health'); } catch (e) { healthCard.replaceChildren(errorState(e, paintHealth)); return; }
    healthCard.replaceChildren(
      h('header', { class: 'card__head' }, [h('h2', { text: 'System' }), h('small', { text: `Checked ${new Date(hl.time).toLocaleTimeString('en-GB')}` })]),
      h('ul', { class: 'checks' }, [
        h('li', {}, [icon(hl.status === 'ok' ? 'done' : 'alert'), h('span', { text: 'API' }), chip(hl.status === 'ok' ? 'Running' : 'Degraded', hl.status === 'ok' ? 'green' : 'amber')]),
        h('li', {}, [icon(hl.storage === 'ok' ? 'done' : 'alert'), h('span', { text: 'Database (Netlify Blobs)' }), chip(hl.storage === 'ok' ? 'Connected' : 'Unavailable', hl.storage === 'ok' ? 'green' : 'red')]),
        h('li', {}, [icon('lock'), h('span', { text: 'Staff sign-in' }), chip(hl.crm ? 'Configured' : 'Missing settings', hl.crm ? 'green' : 'red')]),
        h('li', {}, [icon('shield'), h('span', { text: 'Session' }), h('small', { class: 'muted', text: `${ctx.session.email} · until ${new Date(ctx.session.expiresAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` })])
      ]),
      h('div', { class: 'card__actions' }, [
        h('a', { class: 'btn btn--ghost', href: SITE, target: '_blank', rel: 'noopener' }, [icon('open'), 'Open the website']),
        h('button', { class: 'btn btn--ghost', type: 'button', onclick: paintHealth }, [icon('refresh'), 'Check again'])
      ])
    );
  }

  /* ---------- audit */
  const auditCard = h('article', { class: 'card card--wide' }, skeleton(6));
  async function paintAudit() {
    let res;
    try { res = await get('admin/audit'); } catch (e) { auditCard.replaceChildren(errorState(e, paintAudit)); return; }
    auditCard.replaceChildren(
      h('header', { class: 'card__head' }, [h('h2', { text: 'Activity' }), h('small', { text: 'Sign-ins, imports, exports and deletions. The newest 80.' })]),
      res.data.length ? h('ol', { class: 'audit' }, res.data.map((e) => {
        const [label, tone] = EVENTS[e.event] || [e.event, ''];
        const what = e.id ? `#${e.id}` : e.collection || (e.fields ? e.fields.join(', ') : '') || (e.mode ? e.mode : '') || e.bucket || '';
        return h('li', {}, [chip(label, tone), h('span', { class: 'audit__what', text: [what, e.by].filter(Boolean).join(' · ') }), h('small', { text: ago(e.at) })]);
      })) : h('p', { class: 'muted', text: 'Nothing recorded yet.' })
    );
  }

  grid.append(dataCard, healthCard, exportsCard, auditCard);
  paintData(); paintHealth(); paintAudit();
}
