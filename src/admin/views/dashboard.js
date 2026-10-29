import { h, icon, aed, compact, num, ago, dateLabel, bars, donut, spark, chip, skeleton, errorState, can, ROLE, LEAD, APPT, LEAD_TYPE } from '../ui.js';
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

  let account = null, fc = null, gaps = null;
  const role = ctx.session.role || 'owner';
  async function load() {
    let s;
    try {
      [s, account, fc, gaps] = await Promise.all([get('admin/stats'), get('admin/account').catch(() => null), can(role, 'forecast') ? get('admin/forecast?horizon=3').catch(() => null) : null, can(role, 'leads') ? get('admin/demand').catch(() => null) : null]);
    } catch (e) { body.replaceChildren(errorState(e, load)); return; }
    body.replaceChildren(...render(s));
  }

  function render(s) {
    const out = [];
    if (account?.defaultPassword) {
      out.push(h('div', { class: 'banner banner--danger' }, [icon('alert'), h('div', {}, [h('b', { text: 'Change the default password' }), h('p', { text: 'The CRM still opens with admin / admin123, which anyone could guess.' })]),
        h('a', { class: 'btn btn--primary', href: '#/settings' }, [icon('lock'), 'Change it now'])]));
    }
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

    const L = s.leads, A = s.appointments, I = s.inventory, HL = s.health || {}, W = s.workshop || {};
    /* what needs a person today */
    const att = [
      can(role, 'leads') && HL.overdue ? ['risk', `${HL.overdue} lead${HL.overdue > 1 ? 's' : ''} waiting too long`, 'No contact in time. Call them first.', '#/leads?sla=overdue&mine=' + (HL.mineOverdue ? '1' : ''), 'hot'] : null,
      can(role, 'approve') && HL.pendingApprovals ? ['approve', `${HL.pendingApprovals} discount${HL.pendingApprovals > 1 ? 's' : ''} to approve`, 'Salespeople are waiting on you.', '#/approvals', 'hot'] : null,
      can(role, 'leads') && HL.unassigned ? ['adduser', `${HL.unassigned} lead${HL.unassigned > 1 ? 's' : ''} with no owner`, 'Give each one to someone.', '#/leads', ''] : null,
      W.requested ? ['wrench', `${W.requested} new workshop request${W.requested > 1 ? 's' : ''}`, 'Confirm the booking.', '#/workshop', ''] : null,
      W.awaitingQuote ? ['receipt', `${W.awaitingQuote} quote${W.awaitingQuote > 1 ? 's' : ''} waiting for the customer`, 'Follow up if it has been a day.', '#/workshop', ''] : null
    ].filter(Boolean);
    out.push(att.length ? h('section', { class: 'attn', 'aria-label': 'Needs attention' }, att.map(([ic, t, sub, href, hot]) => h('a', { class: `attn__i${hot ? ' attn__i--hot' : ''}`, href }, [h('span', { class: 'attn__ic' }, icon(ic)), h('span', { class: 'attn__t' }, [h('b', { text: t }), h('small', { text: sub })]), icon('right')]))) : h('section', { class: 'attn attn--ok' }, [h('span', { class: 'attn__ic' }, icon('verified')), h('span', { class: 'attn__t' }, [h('b', { text: 'You are all caught up' }), h('small', { text: 'No lead is overdue and nothing is waiting on you.' })])]));
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

    /* looking ahead, and what customers asked for that we did not have */
    const ahead = [];
    if (fc) {
      const m3 = fc.months.slice(0, 3);
      const rev = m3.reduce((t, m) => t + (m.revenue || 0), 0), wins = m3.reduce((t, m) => t + m.wins, 0);
      ahead.push(card('Next 3 months', fc.method === 'baseline' ? 'baseline estimate' : `${Math.round(fc.confidence * 100)}% confidence`, h('div', { class: 'mini' }, [
        h('div', {}, [h('small', { text: 'Enquiries' }), h('b', { text: String(Math.round(m3.reduce((t, m) => t + m.leads, 0))) })]),
        h('div', {}, [h('small', { text: 'Cars sold' }), h('b', { text: wins.toFixed(1) })]),
        h('div', {}, [h('small', { text: 'Revenue' }), h('b', { text: rev ? `AED ${compact(rev)}` : '—' })]),
        h('div', {}, [h('small', { text: 'In the pipeline' }), h('b', { text: `AED ${compact(fc.pipeline.weighted)}` })])
      ]), h('a', { class: 'card__link', href: '#/forecast' }, ['Open the forecast', icon('arrow')])));
    }
    if (gaps?.data?.length) ahead.push(card('Customers asked for…', `${gaps.totalAsks} searches with no match, 90 days`, h('ul', { class: 'feed' }, gaps.data.slice(0, 4).map((g) => h('li', { class: 'feed__row feed__row--static' }, [h('span', { class: 'when' }, [h('b', { text: String(g.asks) }), h('small', { text: 'asks' })]), h('span', { class: 'feed__t' }, [h('b', { text: g.label }), h('small', { text: g.inStockNow ? `${g.inStockNow} in stock that nearly match` : 'None in stock' })])]))), can(role, 'purchasing') ? h('a', { class: 'card__link', href: '#/purchasing' }, ['Plan purchases', icon('arrow')]) : null));
    if (ahead.length) out.push(h('section', { class: 'grid2' }, ahead));

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
