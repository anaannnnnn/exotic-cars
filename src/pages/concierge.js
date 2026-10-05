import * as stock from '../data/stock.js';
import { h, icon, clear } from '../ui/dom.js';
import { openService, openVR, closePanel } from '../ui/panels.js';
import { getSettings } from '../state/settings.js';
import { ask } from '../ai/concierge.js';
import { mainDock } from './hub.js';

/* the conversation survives leaving the page (e.g. to open a car) and coming back */
const memory = { log: [], filters: null, focus: null };

export function mountConcierge(root, firstQuestion = '') {
  const log = h('div', { class: 'cg__log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation' });
  const suggest = h('div', { class: 'cg__suggest' });
  const input = h('input', { class: 'ask__input', type: 'text', placeholder: 'Ask about any car…', autocomplete: 'off', 'aria-label': 'Message the concierge' });
  const sendBtn = h('button', { class: 'ask__go', type: 'submit', 'aria-label': 'Send' }, icon('send'));
  const form = h('form', { class: 'ask ask--bar', onsubmit: (e) => { e.preventDefault(); send(input.value); } }, [h('span', { class: 'ask__spark', 'aria-hidden': 'true' }, icon('spark')), input, sendBtn]);
  let busy = false, alive = true;

  const scrollDown = () => requestAnimationFrame(() => log.lastElementChild?.scrollIntoView({ block: 'end', behavior: getSettings().reduceMotion ? 'auto' : 'smooth' }));

  function carCard(c) {
    const can = !c.sold && stock.configuratorMatch(c);
    return h('article', { class: 'ccard' }, [
      h('a', { class: 'ccard__img', href: `#/shop/${c.id}`, 'aria-label': c.title, onclick: () => { memory.focus = c.id; } }, h('img', { src: stock.coverUrl(c), alt: '', loading: 'lazy', onerror: (e) => { if (e.target.src !== c.cover) e.target.src = c.cover; } })),
      h('div', { class: 'ccard__body' }, [
        h('b', { text: c.title }),
        h('span', { text: [c.year, stock.kmLabel(c), c.exterior].filter(Boolean).join(' · ') }),
        h('div', { class: 'ccard__actions' }, [
          h('a', { class: 'pill pill--ink pill--sm', href: `#/shop/${c.id}`, onclick: () => { memory.focus = c.id; } }, 'View'),
          can ? h('a', { class: 'pill pill--signal pill--sm', href: `#/shop/${c.id}/configure` }, [icon('model'), '3D']) : null,
          h('button', { class: 'pill pill--line pill--sm', type: 'button', onclick: () => { memory.focus = c.id; openService({ car: c.title, service: 'Test drive' }); } }, 'Book')
        ])
      ])
    ]);
  }

  function bubble(m, animate = true) {
    const mine = m.from === 'you';
    const el = h('div', { class: `msg ${mine ? 'msg--you' : 'msg--ai'}${animate ? ' is-new' : ''}` }, [
      mine ? null : h('span', { class: 'msg__mark', 'aria-hidden': 'true' }, icon('spark')),
      h('div', { class: 'msg__col' }, [
        h('p', { class: 'msg__text', text: m.text }),
        m.cars?.length ? h('div', { class: 'msg__cars' }, m.cars.map(carCard)) : null,
        m.actions?.length ? h('div', { class: 'msg__actions' }, m.actions.map((a) => h('button', {
          class: 'pill pill--ink', type: 'button', text: a.label,
          onclick: () => (a.kind === 'vr' ? openVR() : openService({ car: a.car || '', service: a.service || 'Test drive' }))
        }))) : null
      ])
    ]);
    log.append(el);
    return el;
  }

  function renderSuggestions(list) {
    clear(suggest);
    list.forEach((s, i) => suggest.append(h('button', { class: 'prompt', type: 'button', text: s, style: `--i:${i}`, onclick: () => send(s) })));
  }

  async function send(text) {
    const q = String(text || '').trim();
    if (!q || busy) return;
    busy = true;
    input.value = '';
    sendBtn.disabled = true;
    memory.log.push({ from: 'you', text: q });
    bubble({ from: 'you', text: q });
    const typing = h('div', { class: 'msg msg--ai is-new' }, [h('span', { class: 'msg__mark', 'aria-hidden': 'true' }, icon('spark')), h('div', { class: 'typing', 'aria-label': 'The concierge is typing' }, [h('i'), h('i'), h('i')])]);
    log.append(typing);
    clear(suggest);
    scrollDown();
    const started = performance.now();
    const res = await ask(q, { filters: memory.filters, focus: memory.focus, history: memory.log });
    /* a short beat so the reply reads as an answer, not a flicker */
    await new Promise((r) => setTimeout(r, Math.max(0, 420 - (performance.now() - started))));
    if (!alive) return;
    typing.remove();
    if (res.filters) memory.filters = res.filters;
    if (res.cars?.length === 1) memory.focus = res.cars[0].id;
    const m = { from: 'ai', text: res.text, cars: res.cars, actions: res.actions, suggestions: res.suggestions };
    memory.log.push(m);
    bubble(m);
    renderSuggestions(res.suggestions || []);
    scrollDown();
    busy = false;
    sendBtn.disabled = false;
  }

  const dock = mainDock('concierge', { autoHide: false });
  root.append(h('main', { class: 'cg' }, [
    h('div', { class: 'hub__glow', 'aria-hidden': 'true' }),
    h('header', { class: 'cg__top' }, [
      h('a', { class: 'circle-btn', href: '#/home', 'aria-label': 'Home', 'data-tip': 'Back home' }, icon('back')),
      h('div', { class: 'cg__title' }, [h('h1', { text: 'Concierge' }), h('p', {}, [h('span', { class: 'live', 'aria-hidden': 'true' }), `Knows all ${stock.queryStock({ tab: 'sale' }).length} cars in the showroom`])]),
      h('button', { class: 'circle-btn', type: 'button', 'aria-label': 'New conversation', 'data-tip': 'New conversation', onclick: () => { memory.log = []; memory.filters = null; memory.focus = null; clear(log); start(); } }, icon('rotate'))
    ]),
    log,
    h('div', { class: 'cg__composer' }, [suggest, form])
  ]));

  function start() {
    if (memory.log.length) { memory.log.forEach((m) => bubble(m, false)); const last = [...memory.log].reverse().find((m) => m.from === 'ai'); renderSuggestions(last?.suggestions || []); scrollDown(); return; }
    ask('hello').then((res) => { if (!alive) return; const m = { from: 'ai', text: res.text, suggestions: res.suggestions }; memory.log.push(m); bubble(m); renderSuggestions(res.suggestions); });
  }
  start();
  if (firstQuestion) setTimeout(() => send(firstQuestion), memory.log.length ? 0 : 350);
  else setTimeout(() => { if (matchMedia('(hover: hover)').matches) input.focus({ preventScroll: true }); }, 300);

  return { kind: 'concierge', destroy() { alive = false; dock.destroy(); closePanel(); } };
}
