import { h, icon, ago, chip, skeleton, errorState, confirmBox, toast, failed, field, input, showFieldErrors, can, ROLE, roleChip } from '../ui.js';
import { get, post, put, patch, exportUrl, SITE } from '../api.js';
import { uploadPhotos, pickFiles, displayUrl } from '../media.js';
import { soundOn } from '../main.js';

/* Settings: the data the site runs on (import / re-import), CSV exports, system health and the audit trail. */
const EVENTS = {
  'staff.login': ['Signed in', 'green'], 'staff.login-failed': ['Failed sign-in', 'red'], 'rate-limited': ['Rate limit hit', 'amber'],
  'staff.setup': ['Login created', 'green'], 'staff.password': ['Password changed', 'violet'],
  import: ['Data imported', 'blue'], 'import.manual': ['Import run', 'blue'], export: ['CSV exported', ''],
  'car.create': ['Car added', 'green'], 'car.update': ['Car edited', ''], 'car.delete': ['Car deleted', 'red'],
  'product.create': ['Product added', 'green'], 'product.update': ['Product edited', ''], 'product.delete': ['Product deleted', 'red'],
  'lead.delete': ['Lead deleted', 'red'], 'appointment.delete': ['Booking deleted', 'red'], 'customer.delete': ['Account deleted', 'red']
};

export function mountSettings(view, _p, ctx) {
  const role = ctx.session.role || 'owner';
  view.append(h('header', { class: 'phead' }, [h('div', {}, [h('p', { class: 'phead__eyebrow', text: 'System' }), h('h1', { class: 'phead__title', text: 'Settings' })])]));
  const grid = h('div', { class: 'settings' });
  view.append(grid);

  /* ---------- homepage promotions ---------- */
  const promotionsCard = h('article', { class: 'card card--wide' }, skeleton(3));
  let promotions = [];
  const promotionId = () => `promo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  async function paintPromotions() {
    if (!promotions.length) {
      try { promotions = (await get('admin/promotions')).items || []; }
      catch (e) { promotionsCard.replaceChildren(errorState(e, paintPromotions)); return; }
    }
    const list = h('div', { class: 'promos-admin' });
    const redraw = () => paintPromotions();
    promotions.forEach((p, index) => {
      const title = input('title', p.title || '', { required: true, maxlength: 120 });
      const eyebrow = input('eyebrow', p.eyebrow || '', { maxlength: 60 });
      const brand = input('brand', p.brand || '', { maxlength: 40, placeholder: 'Ferrari, Rolls-Royce…' });
      const body = h('textarea', { class: 'inp promo-admin__body', name: 'body', maxlength: '220', rows: '2', value: p.body || '', placeholder: 'Short promotional message' });
      const cta = input('cta', p.cta || 'Explore', { required: true, maxlength: 40 });
      const href = input('href', p.href || '#/shop', { required: true, maxlength: 2048 });
      const active = h('input', { type: 'checkbox', checked: p.active !== false });
      const preview = h('div', { class: 'promo-admin__preview' }, p.image ? h('img', { src: displayUrl(p.image), alt: '' }) : h('span', { text: 'No image yet' }));
      const upload = h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => pickFiles(async (files) => {
        upload.disabled = true;
        try { const [url] = await uploadPhotos(files.slice(0, 1)); if (url) { p.image = url; redraw(); } }
        catch (e) { failed(e); } finally { upload.disabled = false; }
      }, { multiple: false }) }, [icon('upload'), p.image ? 'Replace image' : 'Upload image']);
      const sync = () => Object.assign(p, { title: title.value, eyebrow: eyebrow.value || null, brand: brand.value || null, body: body.value || null, cta: cta.value, href: href.value, active: active.checked });
      [title, eyebrow, brand, body, cta, href, active].forEach((el) => el.addEventListener('change', sync));
      list.append(h('section', { class: 'promo-admin' }, [
        h('div', { class: 'promo-admin__media' }, [preview, upload]),
        h('div', { class: 'promo-admin__fields' }, [
          h('div', { class: 'fgrid fgrid--3' }, [field('Headline', title), field('Label', eyebrow), field('Brand (optional)', brand)]),
          field('Supporting copy', body),
          h('div', { class: 'fgrid fgrid--3' }, [field('Button label', cta), field('Button destination', href), h('label', { class: 'switch switch--row promo-admin__switch' }, [active, h('span', { class: 'switch__track' }, h('span', { class: 'switch__dot' })), h('span', { class: 'switch__label' }, h('b', { text: 'Live' }))])]),
          h('div', { class: 'promo-admin__tools' }, [
            h('button', { class: 'btn btn--ghost', type: 'button', disabled: index === 0, onclick: () => { sync(); [promotions[index - 1], promotions[index]] = [promotions[index], promotions[index - 1]]; redraw(); } }, [icon('left'), 'Earlier']),
            h('button', { class: 'btn btn--ghost', type: 'button', disabled: index === promotions.length - 1, onclick: () => { sync(); [promotions[index + 1], promotions[index]] = [promotions[index], promotions[index + 1]]; redraw(); } }, [icon('right'), 'Later']),
            h('button', { class: 'btn btn--ghost btn--danger-ghost', type: 'button', onclick: () => { promotions.splice(index, 1); redraw(); } }, [icon('trash'), 'Remove'])
          ])
        ])
      ]));
    });
    const save = h('button', { class: 'btn btn--primary', type: 'button', onclick: async () => {
      list.querySelectorAll('.promo-admin').forEach((row, i) => {
        const v = (n) => row.querySelector(`[name="${n}"]`)?.value || '';
        Object.assign(promotions[i], { title: v('title'), eyebrow: v('eyebrow') || null, brand: v('brand') || null, body: v('body') || null, cta: v('cta'), href: v('href'), active: row.querySelector('input[type=checkbox]').checked, order: i });
      });
      if (promotions.some((p) => !p.image)) { toast('Upload an image for every promotion.'); return; }
      save.disabled = true;
      try { promotions = (await put('admin/promotions', { items: promotions })).items; toast('Homepage promotions are live.'); paintPromotions(); }
      catch (e) { failed(e); } finally { save.disabled = false; }
    } }, [icon('check'), 'Save promotions']);
    promotionsCard.replaceChildren(
      h('header', { class: 'card__head' }, [h('div', {}, [h('h2', { text: 'Homepage promotions' }), h('small', { text: 'Uploaded images become the swipeable slides on the home page.' })]), h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => { promotions.push({ id: promotionId(), title: 'New promotion', eyebrow: 'Featured', body: '', brand: '', image: '', cta: 'Explore', href: '#/shop', active: true, order: promotions.length }); redraw(); } }, [icon('plus'), 'Add slide'])]),
      promotions.length ? list : h('div', { class: 'empty', text: 'No promotions yet. The homepage will keep showing featured inventory until you add one.' }),
      promotions.length ? h('div', { class: 'card__actions' }, save) : null
    );
  }

  /* ---------- data */
  const dataCard = h('article', { class: 'card' }, skeleton(3));
  const demoCard = h('article', { class: 'card' }, skeleton(2));
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
        h('li', {}, [icon(hl.storage === 'ok' ? 'done' : 'alert'), h('span', { text: `Database (${{ postgres: 'Postgres', mongo: 'MongoDB', 'netlify-blobs': 'Netlify Blobs' }[hl.storageKind] || 'not connected'})` }), chip(hl.storage === 'ok' ? 'Connected' : 'Unavailable', hl.storage === 'ok' ? 'green' : 'red')]),
        h('li', {}, [icon('lock'), h('span', { text: 'Staff sign-in' }), chip(hl.crm ? 'Set up' : 'Not created yet', hl.crm ? 'green' : 'amber')]),
        h('li', {}, [icon('shield'), h('span', { text: 'Session' }), h('small', { class: 'muted', text: `${ctx.session.email} · until ${new Date(ctx.session.expiresAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` })])
      ]),
      h('div', { class: 'card__actions' }, [
        h('a', { class: 'btn btn--ghost', href: SITE, target: '_blank', rel: 'noopener' }, [icon('open'), 'Open the website']),
        h('button', { class: 'btn btn--ghost', type: 'button', onclick: paintHealth }, [icon('refresh'), 'Check again'])
      ])
    );
  }

  /* ---------- the staff login */
  const loginCard = h('article', { class: 'card' }, skeleton(3));
  async function paintLogin() {
    let acct;
    try { acct = await get('admin/account'); } catch (e) { loginCard.replaceChildren(errorState(e, paintLogin)); return; }
    const head = h('header', { class: 'card__head' }, [h('h2', { text: 'Your login' }), h('small', { text: acct.email })]);
    if (acct.managedBy === 'team') head.querySelector('small').textContent = `${acct.email} · ${ROLE[acct.role]?.label || ''}`;
    if (acct.managedBy === 'environment') {
      loginCard.replaceChildren(head, h('p', { class: 'muted', text: 'This login is set by the site’s environment variables in Netlify (ADMIN_EMAIL and ADMIN_PASSWORD_HASH). Change the password there.' }));
      return;
    }
    const pw = (name, label, auto) => field(label, h('input', { class: 'inp', type: 'password', name, autocomplete: auto, required: true }));
    const form = h('form', { class: 'fgrid fgrid--1', novalidate: true }, [
      pw('current', 'Current password', 'current-password'), pw('next', 'New password (10+ characters)', 'new-password'), pw('again', 'New password again', 'new-password'),
      h('div', { class: 'card__actions' }, h('button', { class: 'btn btn--primary', type: 'submit' }, [icon('lock'), 'Change password']))
    ]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = (n) => form.querySelector(`[name=${n}]`).value;
      showFieldErrors(form, null);
      if (v('next') !== v('again')) { showFieldErrors(form, { again: 'The new passwords do not match' }); return; }
      const b = form.querySelector('button[type=submit]');
      b.disabled = true;
      try {
        await post('admin/password', { current: v('current'), next: v('next') });
        form.reset();
        toast('Password changed. Other devices are signed out.');
        paintAudit();
      } catch (err) { showFieldErrors(form, err.fields); if (!err.fields) failed(err); } finally { b.disabled = false; }
    });
    const warn = acct.defaultPassword ? h('div', { class: 'banner banner--danger' }, [icon('alert'), h('div', {}, [h('b', { text: 'Still on the default password (admin123)' }), h('p', { text: 'Anyone who guesses it can open the CRM. Set your own below: the default stops working once you do.' })])]) : null;
    if (acct.defaultPassword) { loginCard.replaceChildren(head, warn, form); return; }
    loginCard.replaceChildren(head, h('p', { class: 'muted small', text: `Created ${ago(acct.createdAt)}${acct.passwordChangedAt ? ` · password changed ${ago(acct.passwordChangedAt)}` : ''}` }), form);
  }

  /* ---------- audit */
  const auditCard = h('article', { class: 'card card--wide' }, skeleton(6));
  async function paintAudit() {
    let res;
    try { res = await get('admin/audit'); } catch (e) { auditCard.replaceChildren(errorState(e, paintAudit)); return; }
    auditCard.replaceChildren(
      h('header', { class: 'card__head' }, [h('h2', { text: 'System log' }), h('small', { text: 'Imports, exports, rate limits and password changes. Everything people do is in Activity.' })]),
      res.data.length ? h('ol', { class: 'audit' }, res.data.map((e) => {
        const [label, tone] = EVENTS[e.event] || [e.event, ''];
        const what = e.id ? `#${e.id}` : e.collection || (e.fields ? e.fields.join(', ') : '') || (e.mode ? e.mode : '') || e.bucket || '';
        return h('li', {}, [chip(label, tone), h('span', { class: 'audit__what', text: [what, e.by].filter(Boolean).join(' · ') }), h('small', { text: ago(e.at) })]);
      })) : h('p', { class: 'muted', text: 'Nothing recorded yet.' })
    );
  }

  /* ---------- notifications on this device */
  const soundCard = h('article', { class: 'card' }, [
    h('header', { class: 'card__head' }, [h('h2', { text: 'Alerts on this device' }), h('small', { text: 'New leads and approvals arrive live.' })]),
    (() => { const cb = h('input', { type: 'checkbox', checked: soundOn() }); cb.addEventListener('change', () => { try { localStorage.setItem('exotic-crm-sound', cb.checked ? 'on' : 'off'); } catch { /* ignore */ } toast(cb.checked ? 'Sound on' : 'Sound off'); }); return h('label', { class: 'switch switch--row' }, [cb, h('span', { class: 'switch__track' }, h('span', { class: 'switch__dot' })), h('span', { class: 'switch__label' }, [h('b', { text: 'Play a sound for new leads and requests' }), h('small', { class: 'muted', text: 'A short chime when something needs you.' })])]); })()
  ]);

  /* ---------- the policy: the rules the pipeline, forecast and planner run on (owner) */
  const policyCard = h('article', { class: 'card card--wide' }, skeleton(4));
  async function paintPolicy() {
    let p;
    try { p = await get('admin/policy'); } catch (e) { policyCard.replaceChildren(errorState(e, paintPolicy)); return; }
    const owner = can(role, 'policy');
    const num = (name, value, attrs = {}) => input(name, value, { type: 'number', inputmode: 'decimal', step: 'any', disabled: !owner, ...attrs });
    const f = {
      salesAuto: num('salesAutoPct', p.discount.salesAutoPct, { min: 0, max: 100 }), managerAuto: num('managerAutoPct', p.discount.managerAutoPct, { min: 0, max: 100 }), maxPct: num('maxPct', p.discount.maxPct, { min: 0, max: 100 }), valid: num('approvalValidHours', p.discount.approvalValidHours, { min: 1 }),
      slaNew: num('sla.new', p.sla.new, { min: 0.25 }), slaContacted: num('sla.contacted', p.sla.contacted, { min: 0.25 }), slaQualified: num('sla.qualified', p.sla.qualified, { min: 0.25 }), slaNegotiating: num('sla.negotiating', p.sla.negotiating, { min: 0.25 }),
      pNew: num('p.new', Math.round(p.stageProbability.new * 100), { min: 0, max: 100 }), pContacted: num('p.contacted', Math.round(p.stageProbability.contacted * 100), { min: 0, max: 100 }), pQualified: num('p.qualified', Math.round(p.stageProbability.qualified * 100), { min: 0, max: 100 }), pNegotiating: num('p.negotiating', Math.round(p.stageProbability.negotiating * 100), { min: 0, max: 100 }),
      conv: num('conv', Math.round(p.conversionBaseline * 1000) / 10, { min: 0.1, max: 100 }), margin: num('margin', p.grossMarginPct, { min: 0, max: 100 }),
      lead: num('lead', p.purchasing.leadTimeMonths, { min: 0 }), safety: num('safety', p.purchasing.safetyMonths, { min: 0 }), cover: num('cover', p.purchasing.targetCoverMonths, { min: 0.5 }), slow: num('slow', p.purchasing.slowMoverDays, { min: 7 }),
      tm: num('tm', p.purchasing.targetMarginPct, { min: 0, max: 100 }), recon: num('recon', p.purchasing.reconPct, { min: 0, max: 100, step: 0.1 }), hold: num('hold', p.purchasing.holdingPctPerMonth, { min: 0, max: 100, step: 0.05 }), budget: num('budget', p.purchasing.monthlyBudget, { min: 0, step: 500000 }), share: num('share', p.purchasing.maxMakeSharePct, { min: 5, max: 100 })
    };
    const season = p.seasonality.map((v, i) => { const m = num(`s${i}`, v, { min: 0.2, max: 3, 'aria-label': ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i] }); return h('label', { class: 'season__m' }, [h('span', { text: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i] }), m]); });
    const form = h('form', { class: 'policy', novalidate: true }, [
      h('fieldset', { class: 'fsec' }, [h('legend', { text: 'Discounts' }), h('div', { class: 'fgrid fgrid--3' }, [field('Sales can give up to (%)', f.salesAuto, { hint: 'Above this a manager approves.' }), field('Managers can give up to (%)', f.managerAuto, { hint: 'Above this the owner approves.' }), field('Nobody but the owner above (%)', f.maxPct), field('An approval stays valid (hours)', f.valid)])]),
      h('fieldset', { class: 'fsec' }, [h('legend', { text: 'How long a lead may wait for its next touch (hours)' }), h('div', { class: 'fgrid fgrid--3' }, [field('New', f.slaNew), field('Contacted', f.slaContacted), field('Qualified', f.slaQualified), field('Negotiating', f.slaNegotiating)])]),
      h('fieldset', { class: 'fsec' }, [h('legend', { text: 'Chance a lead closes, by stage (%)' }), h('div', { class: 'fgrid fgrid--3' }, [field('New', f.pNew), field('Contacted', f.pContacted), field('Qualified', f.pQualified), field('Negotiating', f.pNegotiating)])]),
      h('fieldset', { class: 'fsec' }, [h('legend', { text: 'Forecast and purchasing' }), h('div', { class: 'fgrid fgrid--3' }, [field('Leads that buy, until learned (%)', f.conv), field('Gross margin (%)', f.margin), field('Months to source a car', f.lead), field('Safety stock (months)', f.safety), field('Cover to hold (months)', f.cover), field('Slow mover after (days)', f.slow)])]),
      h('fieldset', { class: 'fsec' }, [h('legend', { text: 'Buying cars: what a purchase must earn' }), h('div', { class: 'fgrid fgrid--3' }, [field('Margin a purchase must earn (%)', f.tm, { hint: 'Sets the most to pay for a car.' }), field('Preparation (% of the price)', f.recon), field('Cost of holding a car (% a month)', f.hold, { hint: 'Finance, insurance and space.' }), field('Buying budget for a cycle (AED)', f.budget), field('One make at most (% of the budget)', f.share)])]),
      h('fieldset', { class: 'fsec' }, [h('legend', { text: 'The season: how strong each month is (1.00 is an average month)' }), h('div', { class: 'season' }, season)]),
      owner ? h('div', { class: 'card__actions' }, h('button', { class: 'btn btn--primary', type: 'submit' }, [icon('check'), 'Save the policy'])) : h('p', { class: 'muted small', text: 'Only the owner can change these.' })
    ]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const n = (el) => Number(el.value);
      const body = {
        discount: { salesAutoPct: n(f.salesAuto), managerAutoPct: n(f.managerAuto), maxPct: n(f.maxPct), approvalValidHours: n(f.valid) },
        sla: { new: n(f.slaNew), contacted: n(f.slaContacted), qualified: n(f.slaQualified), negotiating: n(f.slaNegotiating) },
        stageProbability: { new: n(f.pNew) / 100, contacted: n(f.pContacted) / 100, qualified: n(f.pQualified) / 100, negotiating: n(f.pNegotiating) / 100 },
        conversionBaseline: n(f.conv) / 100, grossMarginPct: n(f.margin), purchasing: { leadTimeMonths: n(f.lead), safetyMonths: n(f.safety), targetCoverMonths: n(f.cover), slowMoverDays: n(f.slow), targetMarginPct: n(f.tm), reconPct: n(f.recon), holdingPctPerMonth: n(f.hold), monthlyBudget: n(f.budget), maxMakeSharePct: n(f.share) },
        seasonality: season.map((l) => Number(l.querySelector('input').value))
      };
      const b = form.querySelector('button[type=submit]'); b.disabled = true;
      try { await patch('admin/policy', body); toast('Policy saved. It applies at once.'); } catch (err) { failed(err); } finally { b.disabled = false; }
    });
    policyCard.replaceChildren(h('header', { class: 'card__head' }, [h('h2', { text: 'Rules' }), h('small', { text: 'Discounts, deadlines, closing chances, season and stock planning.' })]), form);
  }

  /* demo data: a full sample showroom, marked as demo and removable, so every screen has something to show */
  async function paintDemo() {
    let st; try { st = await get('admin/demo'); } catch (e) { demoCard.replaceChildren(errorState(e, paintDemo)); return; }
    const owner = role === 'owner';
    const c = st.counts || {};
    const act = async (path, busyText, doneText, confirm) => {
      if (confirm && !(await confirmBox(confirm))) return;
      const b = demoCard.querySelectorAll('button'); b.forEach((x) => { x.disabled = true; }); toast(busyText);
      try { await post(path); toast(doneText); await paintDemo(); } catch (e) { failed(e); b.forEach((x) => { x.disabled = false; }); }
    };
    demoCard.replaceChildren(
      h('header', { class: 'card__head' }, [h('h2', { text: 'Demo data' }), st.enabled ? chip('On', 'green') : chip('Off', '')]),
      h('p', { class: 'muted', text: 'A realistic Dubai showroom to look at every screen with: 18 months of cars sold with their prices, costs and days to sell, a price and cost for every car in stock, three months of leads in every stage, bookings, customers and searches nothing answered. Every record is marked as demo.' }),
      st.enabled
        ? h('ul', { class: 'bul' }, [`${c.sales || 0} cars sold in the sales history`, `${c.cars || 0} cars with a demo price and cost (the website never shows them)`, `${c.leads || 0} leads, ${c.appointments || 0} bookings, ${c.customers || 0} customers, ${c.searches || 0} searches`, `Loaded ${ago(st.loadedAt)}`].map((t) => h('li', { text: t })))
        : h('p', { class: 'muted small', text: 'Nothing is loaded. Loading adds records only; your own leads, customers and stock are not touched.' }),
      owner ? h('div', { class: 'card__actions' }, [
        h('button', { class: 'btn btn--primary', type: 'button', onclick: () => act('admin/demo/load', 'Building the demo showroom…', 'Demo data loaded') }, [icon('spark'), st.enabled ? 'Reload the demo data' : 'Load the demo data']),
        st.enabled ? h('button', { class: 'btn btn--ghost btn--danger-ghost', type: 'button', onclick: () => act('admin/demo/remove', 'Removing the demo data…', 'Demo data removed', { title: 'Remove the demo data?', body: 'Every demo record goes: the sales history, demo leads, customers, bookings and prices. Your own records stay.', ok: 'Remove it', danger: true }) }, [icon('trash'), 'Remove the demo data']) : null
      ]) : h('p', { class: 'muted small', text: 'Only the owner can load or remove demo data.' })
    );
  }
  grid.append(...[can(role, 'manage') ? promotionsCard : null, loginCard, soundCard, can(role, 'manage') ? policyCard : null, can(role, 'manage') ? dataCard : null, can(role, 'manage') ? demoCard : null, healthCard, can(role, 'manage') ? exportsCard : null, can(role, 'manage') ? auditCard : null].filter(Boolean));
  if (can(role, 'manage')) { paintPromotions(); paintData(); paintPolicy(); paintAudit(); paintDemo(); }
  paintHealth(); paintLogin();
}
