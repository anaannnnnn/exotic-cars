import { h, icon, clear } from './dom.js';
import { modal, closePanel } from './panels.js';
import { toast } from './toast.js';
import * as svc from '../data/service.js';

/*
 * One job, the way the customer sees it: where it is now and what that means, every step so far with its time and note,
 * the written quote to approve or decline, the invoice, and a way to reach the team. The page behind it keeps its own copy,
 * so an answer to the quote shows there at once (onChange).
 */
const aed = (n) => `AED ${new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(n)}`;
const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const stepLabel = (s) => svc.STEP[s]?.[0] || s;
export const progress = (job) => Math.max(0, svc.FLOW.indexOf(job.status === 'scheduled' ? 'requested' : job.status)) / (svc.FLOW.length - 1);

export function openJob(job, { guest = null, onChange } = {}) {
  let j = job;
  const body = h('div', { class: 'jt' });
  const render = () => {
    clear(body);
    const [head, line] = svc.STEP[j.status] || [j.status, ''];
    const at = svc.FLOW.indexOf(j.status === 'scheduled' ? 'requested' : j.status);
    body.append(
      h('div', { class: `jt__now jt__now--${j.status}` }, [h('span', { class: 'jt__dot', 'aria-hidden': 'true' }), h('div', {}, [h('b', { text: head }), h('p', { text: line })])]),
      h('div', { class: 'jt__bar', role: 'img', 'aria-label': `Step ${Math.max(1, at + 1)} of ${svc.FLOW.length}` }, svc.FLOW.map((s, i) => h('i', { class: i <= at ? 'is-on' : '' }))),
      h('div', { class: 'jt__chips' }, [
        j.eta ? h('span', { class: 'chip3' }, [icon('calendar'), `Ready by ${new Date(`${j.eta}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`]) : null,
        j.pickup?.needed ? h('span', { class: 'chip3' }, [icon('truck'), 'We collect and return it']) : null,
        j.courtesy ? h('span', { class: 'chip3' }, [icon('car'), 'Courtesy car']) : null,
        j.warranty?.covered ? h('span', { class: 'chip3 chip3--ok' }, [icon('shield'), 'Covered by warranty']) : null
      ].filter(Boolean))
    );
    if (j.quote) {
      const q = j.quote;
      const act = q.status === 'pending' ? h('div', { class: 'jt__act' }, [
        h('button', { class: 'cta cta--block', type: 'button', onclick: (e) => answer('approved', e.currentTarget) }, [icon('check'), `Approve the quote · ${aed(q.total)}`]),
        h('button', { class: 'ghost ghost--block', type: 'button', onclick: (e) => answer('declined', e.currentTarget) }, 'Decline')
      ]) : h('p', { class: `jt__qs jt__qs--${q.status}`, text: q.status === 'approved' ? `You approved this quote${q.decidedAt ? ` on ${when(q.decidedAt)}` : ''}.` : 'You declined this quote.' });
      body.append(h('section', { class: 'jt__quote' }, [
        h('h3', { text: 'Quote' }),
        h('ul', {}, q.items.map((i) => h('li', {}, [h('span', { text: `${i.label}${i.qty > 1 ? ` × ${i.qty}` : ''}` }), h('b', { text: aed(i.qty * i.price) })]))),
        h('div', { class: 'jt__total' }, [h('span', { text: 'Total' }), h('b', { text: aed(q.total) })]),
        q.note ? h('p', { class: 'jt__note', text: q.note }) : null, act
      ]));
    }
    if (j.invoice?.total != null) body.append(h('section', { class: 'jt__quote' }, [h('h3', { text: 'Invoice' }), h('div', { class: 'jt__total' }, [h('span', { text: j.invoice.paid ? 'Paid' : 'Due on collection' }), h('b', { text: aed(j.invoice.total) })])]));
    body.append(h('section', { class: 'jt__tl' }, [h('h3', { text: 'What has happened' }), h('ol', {}, [...j.timeline].reverse().map((e) => h('li', {}, [h('span', { class: 'jt__tdot' }), h('div', {}, [h('b', { text: stepLabel(e.status) }), e.note ? h('p', { text: e.note }) : null, h('small', { text: when(e.at) })])])))]));
    body.append(h('div', { class: 'jt__help' }, [h('a', { class: 'pill pill--line', href: 'tel:+971552446000' }, [icon('phone'), 'Call']), h('a', { class: 'pill pill--line', href: `https://wa.me/971559020734?text=${encodeURIComponent(`Hello, about my job ${j.ref}`)}`, target: '_blank', rel: 'noopener noreferrer' }, [icon('chat'), 'WhatsApp'])]));
  };
  async function answer(decision, btn) {
    btn.disabled = true;
    try { j = await svc.decide(j, decision, guest); toast(decision === 'approved' ? 'Quote approved. We will get started.' : 'Quote declined.'); render(); onChange?.(j); } catch (e) { toast(e.message || 'That did not go through'); btn.disabled = false; }
  }
  render();
  return modal(j.title, [j.vehicle, j.ref].filter(Boolean).join(' · '), body, { wide: false });
}
export { closePanel };
