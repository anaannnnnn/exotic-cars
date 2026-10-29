import { haptic } from './haptics.js';
import { themeToggle } from './theme-toggle.js';
import { h, icon } from './dom.js';

/* Shared building blocks for the Service, VR and Account pages. */

export function pageHead({ title, sub = '', back = '#/home', action = null }) {
  return h('header', { class: 'phead' }, [
    h('a', { class: 'circle-btn', href: back, 'aria-label': 'Back', 'data-tip': 'Back' }, icon('back')),
    h('div', { class: 'phead__t' }, [h('h1', { text: title }), sub ? h('p', { text: sub }) : null]),
    action || themeToggle()
  ]);
}

/**
 * Segmented control whose black thumb slides between options on a spring and stretches while it travels
 * (it reads as liquid rather than a box jumping). `onChange(id)` fires on selection.
 */
export function segmented(options, value, onChange, { label = 'Choose', full = false } = {}) {
  const thumb = h('span', { class: 'sg__thumb', 'aria-hidden': 'true' });
  const el = h('div', { class: `sg${full ? ' sg--full' : ''}`, role: 'tablist', 'aria-label': label }, [thumb]);
  let current = value, x = 0, w = 0, vx = 0, vw = 0, raf = 0, last = 0, tx = 0, tw = 0, ready = false;
  const K = (2 * Math.PI / 0.34) ** 2, C = 2 * Math.sqrt(K) * 0.86;
  const btns = options.map((o) => h('button', {
    class: 'sg__item', type: 'button', role: 'tab', 'aria-selected': String(o.id === value),
    onclick: () => { if (o.id !== current) haptic(6); select(o.id, true); }
  }, [o.icon ? icon(o.icon) : null, h('span', { text: o.label })]));
  el.append(...btns);
  function paint() {
    const stretch = 1 + Math.min(0.12, Math.abs(vx) / 4000);
    thumb.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0) scaleY(${(1 / stretch).toFixed(3)})`;
    thumb.style.width = `${(w * stretch).toFixed(2)}px`;
  }
  function tick(now) {
    const dt = Math.min(1 / 30, (now - (last || now)) / 1000 || 1 / 60);
    last = now;
    vx += (K * (tx - x) - C * vx) * dt; x += vx * dt;
    vw += (K * (tw - w) - C * vw) * dt; w += vw * dt;
    paint();
    if (Math.abs(tx - x) < 0.2 && Math.abs(tw - w) < 0.2 && Math.abs(vx) < 2) { x = tx; w = tw; vx = vw = 0; paint(); raf = 0; last = 0; return; }
    raf = requestAnimationFrame(tick);
  }
  function measure(animate) {
    const b = btns[options.findIndex((o) => o.id === current)];
    if (!b || !b.offsetWidth) return;
    tx = b.offsetLeft; tw = b.offsetWidth;
    if (!animate || !ready || false) { x = tx; w = tw; paint(); ready = true; return; }
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function select(id, fire) {
    if (id === current && ready) return;
    current = id;
    btns.forEach((b, i) => b.setAttribute('aria-selected', String(options[i].id === id)));
    measure(true);
    if (fire) onChange?.(id);
  }
  requestAnimationFrame(() => measure(false));
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => measure(false)).observe(el);
  return { el, select: (id) => select(id, false), get value() { return current; } };
}

/** Text field whose label floats above the value once it has one (or focus). */
export function field({ label, type = 'text', name, value = '', autocomplete, required = false, inputmode, rows, hint }) {
  const id = `f-${name}-${Math.random().toString(36).slice(2, 6)}`;
  const input = rows
    ? h('textarea', { class: 'ff__input', id, name, rows, placeholder: ' ', required: required ? true : null })
    : h('input', { class: 'ff__input', id, name, type, placeholder: ' ', autocomplete, inputmode, required: required ? true : null, value });
  if (rows && value) input.value = value;
  const el = h('div', { class: `ff${rows ? ' ff--area' : ''}` }, [input, h('label', { class: 'ff__label', for: id, text: label }), hint ? h('small', { class: 'ff__hint', text: hint }) : null]);
  return { el, input };
}

/** Chips; `multi` allows several. Returns { el, values() }. */
export function chips(options, { multi = false, value = [], label = 'Options', onChange } = {}) {
  const on = new Set(value);
  const el = h('div', { class: 'chips2', role: multi ? 'group' : 'radiogroup', 'aria-label': label });
  const btns = options.map((o) => {
    const b = h('button', { class: 'chip2', type: 'button', 'aria-pressed': String(on.has(o.id)), onclick: () => {
      if (multi) { on.has(o.id) ? on.delete(o.id) : on.add(o.id); } else { on.clear(); on.add(o.id); }
      btns.forEach((x, i) => x.setAttribute('aria-pressed', String(on.has(options[i].id))));
      onChange?.([...on]);
    } }, [o.icon ? icon(o.icon) : null, h('span', { text: o.label })]);
    return b;
  });
  el.append(...btns);
  return { el, values: () => [...on] };
}

/** On/off switch row. */
export function toggleRow(label, hint, checked = false) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked: checked ? true : null });
  return { el: h('label', { class: 'trow' }, [h('span', { class: 'trow__t' }, [h('b', { text: label }), hint ? h('small', { text: hint }) : null]), input, h('i', { 'aria-hidden': 'true' })]), input };
}
