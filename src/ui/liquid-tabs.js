import { h } from './dom.js';
import { haptic } from './haptics.js';

/*
 * Liquid tabs: oval chips over one sliding thumb. Moving between chips the thumb first stretches across both (like a
 * drop pulled by its leading edge), then its trailing edge lets go and it beads up on the new chip. `theme(id)` may
 * return inline custom properties (e.g. a make's colours) that the row takes while that chip is selected, so the
 * thumb - and anything styled from those properties - changes colour with the choice.
 */
const reduced = () => document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;

export function liquidTabs({ items, value, onChange, label, cls = '', theme = null }) {
  const thumb = h('span', { class: 'lq__thumb', 'aria-hidden': 'true' });
  const el = h('div', { class: `lq ${cls}`.trim(), role: 'tablist', 'aria-label': label });
  let current = value, x = null, w = null, t = 0;

  const btns = items.map((it) => h('button', {
    class: 'lq__item', type: 'button', role: 'tab', 'aria-selected': String(it.id === current), 'data-id': it.id,
    onclick: () => { if (it.id === current) return; haptic(6); set(it.id); onChange?.(it.id); }
  }, it.content || it.label));
  el.append(thumb, ...btns);

  function place(animate = true) {
    const on = btns.find((b) => b.dataset.id === String(current));
    if (!on || !on.offsetWidth) return;
    const to = on.offsetLeft, toW = on.offsetWidth;
    clearTimeout(t);
    if (!animate || x == null || reduced()) {
      thumb.classList.remove('is-stretch');
      thumb.style.transform = `translateX(${to}px)`; thumb.style.width = `${toW}px`;
    } else {
      const L = Math.min(x, to), R = Math.max(x + w, to + toW);
      thumb.classList.add('is-stretch');
      thumb.style.transform = `translateX(${L}px)`; thumb.style.width = `${R - L}px`;
      t = setTimeout(() => { thumb.classList.remove('is-stretch'); thumb.style.transform = `translateX(${to}px)`; thumb.style.width = `${toW}px`; }, 160);
      const left = on.offsetLeft - el.scrollLeft, right = left + toW;
      if (left < 12 || right > el.clientWidth - 12) el.scrollTo({ left: on.offsetLeft - el.clientWidth / 2 + toW / 2, behavior: 'smooth' });
    }
    x = to; w = toW;
  }
  function set(id) {
    current = id;
    btns.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.id === String(id))));
    if (theme) el.setAttribute('style', theme(id) || ''); else el.removeAttribute('style');
    place(true);
  }
  if (theme) el.setAttribute('style', theme(current) || '');
  requestAnimationFrame(() => place(false));
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => place(false)) : null;
  ro?.observe(el);
  return { el, set, relayout: () => place(false), destroy: () => ro?.disconnect() };
}
