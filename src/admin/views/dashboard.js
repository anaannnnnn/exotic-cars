import { h, icon, aed, compact, num, ago, dateLabel, bars, donut, spark, chip, skeleton, errorState, LEAD, APPT, LEAD_TYPE } from '../ui.js';
import { get, post, SITE } from '../api.js';

/* Dashboard: the day at a glance - stock, pipeline, bookings - with a way into each list. */
export async function mountDashboard(view, _params, ctx) {
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const head = h('header', { class: 'phead' }, [
    h('div', {}, [
      h('p', { class: 'phead__eyebrow', text: new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) }),
      h('h1', { class: 'phead__title', text: hello })
    ]),
    h('div', { class: 'phead__actions' }, [
      h('a', { class: 'btn btn--ghost', href: SITE, target: '_blank', rel: 'noopener' }, [icon('open'), 'Website']),
      h('a', { class: 'btn btn--primary', href: '#/inventory/new' }, [icon('plus'), 'Add a car'])
    ])
  ]);
  const body = h('div', { class: 'dash' }, skeleton(8));
  view.append(head, body);

  async function load() {
    let s;
    try { s = await get('admin/stats'); } catch (e) { body.replaceChildren(errorState(e, load)); return; }
    body.replaceChildren(...render(s));
  }

  function render(s) {
    const out = [];
    if (!s.imported.cars || !s.imported.products) {
      out.push(h('div', { class: 'banner' }, [
        icon('db'), h('div', {}, [h('b', { text: 'Bring in the site’s stock and catalogue' }), h('p', { text: 'The database is empty. Import the cars, wheels and kits the website already shows, then edit them here.' })]),
        h('button', { class: 'btn btn--primary', type: 'button', onclick: async (e) => {
          const b = e.currentTarget;
          b.disabled = true;
          try { await post('admin/import', { mode: 'missing' }); load(); } catch (err) { b.disabled = false; body.prepend(errorState(err)); }
        } }, [icon('download'), 'Import now'])
      ]));
    }

    const L = s.leads, A = s.appointments, I = s.inventory;
    out.push(h('section', { class: 'kpis' }, [
      kpi({ label: 'Cars for sale', value: num(I.forSale), foot: `${I.priced ? `AED ${compact(I.listedValue)} priced` : 'Prices on request'} · ${I.sold} sold`, icon: 'car', href: '#/inventory' }),
      kpi({ label: 'New leads', value: num(L.byStatus.new), foot: `${L.last7} this week`, icon: 'leads', href: '#/leads', accent: true, chart: spark(L.perDay || []) }),
      kpi({ label: 'Open pipeline', value: `AED ${compact(L.pipelineValue)}`, foot: L.conversion == null ? 'No closed deals yet' : `${Math.round(L.conversion * 100)}% won · AED ${compact(L.wonValue || 0)}`, icon: 'trend', href: '#/leads' }),
      kpi({ label: 'Bookings today', value: num(A.today), foot: `${A.upcoming} upcoming · ${A.byStatus.requested} to confirm`, icon: 'calendar', href: '#/appointments' })
    ]));

    const order = Object.keys(LEAD);
    const total = order.reduce((n, k) => n + (L.byStatus[k] || 0), 0);
    out.push(h('section', { class: 'grid2' }, [
      card('Pipeline', `${total} lead${total === 1 ? '' : 's'}`, h('div', { class: 'pipe' }, [
        donut(order.map((k) => ({ value: L.byStatus[k] || 0, tone: LEAD[k].tone, label: LEAD[k].label })), String(L.byStatus.new + L.byStatus.contacted + L.byStatus.qualified + L.byStatus.negotiating), 'open'),
        h('ul', { class: 'legend' }, order.map((k) => h('li', {}, h('a', { href: `#/leads?status=${k}` }, [h('span', { class: `dot tone--${LEAD[k].tone}` }), h('span', { text: LEAD[k].label }), h('b', { text: String(L.byStatus[k] || 0) })]))))
      ]), h('a', { class: 'card__link', href: '#/leads' }, ['Open the board', icon('arrow')])),
      card('Stock by make', `${I.forSale} for sale · ${I.featured} featured · ${I.newArrivals} new`, I.byMake.length ? bars(I.byMake.slice(0, 8)) : h('p', { class: 'muted', text: 'No cars yet.' }), h('a', { class: 'card__link', href: '#/inventory' }, ['Manage inventory', icon('arrow')]))
    ]));

    out.push(h('section', { class: 'grid2' }, [
      card('Latest enquiries', null, L.recent.length ? h('ul', { class: 'feed' }, L.recent.map((l) => h('li', {}, h('a', { class: 'feed__row', href: `#/leads/${l.id}` }, [
        h('span', { class: 'av', text: (l.name || '?')[0].toUpperCase() }),
        h('span', { class: 'feed__t' }, [h('b', { text: l.name }), h('small', { text: [LEAD_TYPE[l.type] || 'Enquiry', l.car?.title].filter(Boolean).join(' · ') })]),
        h('span', { class: 'feed__r' }, [chip(LEAD[l.status]?.label || l.status, LEAD[l.status]?.tone), h('small', { text: ago(l.createdAt) })])
      ])))) : h('p', { class: 'muted', text: 'Enquiries from the configurator and car pages appear here.' }), h('a', { class: 'card__link', href: '#/leads' }, ['All leads', icon('arrow')])),
      card('Next bookings', null, A.next.length ? h('ul', { class: 'feed' }, A.next.map((a) => h('li', {}, h('a', { class: 'feed__row', href: `#/appointments/${a.id}` }, [
        h('span', { class: 'when' }, [h('b', { text: /^\d/.test(a.slot) ? a.slot : 'Call' }), h('small', { text: dateLabel(a.date) })]),
        h('span', { class: 'feed__t' }, [h('b', { text: a.service }), h('small', { text: [a.name, a.car].filter(Boolean).join(' · ') })]),
        h('span', { class: 'feed__r' }, chip(APPT[a.status]?.label || a.status, APPT[a.status]?.tone))
      ])))) : h('p', { class: 'muted', text: 'Service bookings, test drives and call-backs appear here.' }), h('a', { class: 'card__link', href: '#/appointments' }, ['All bookings', icon('arrow')]))
    ]));

    out.push(h('p', { class: 'dash__foot', text: `${s.customers.total} customer account${s.customers.total === 1 ? '' : 's'} · ${s.customers.last30} new in 30 days · ${I.hidden} hidden car${I.hidden === 1 ? '' : 's'}` }));
    return out;
  }

  load();
  ctx.refreshBadges();
}

function kpi({ label, value, foot, icon: ic, href, accent, chart }) {
  return h('a', { class: `kpi${accent ? ' kpi--accent' : ''}`, href }, [
    h('span', { class: 'kpi__ic' }, icon(ic)),
    h('span', { class: 'kpi__label', text: label }),
    h('b', { class: 'kpi__value', text: value }),
    chart ? h('span', { class: 'kpi__chart' }, chart) : null,
    h('small', { class: 'kpi__foot', text: foot })
  ]);
}

function card(title, sub, content, foot) {
  return h('article', { class: 'card' }, [
    h('header', { class: 'card__head' }, [h('h2', { text: title }), sub ? h('small', { text: sub }) : null]),
    content, foot || null
  ]);
}
