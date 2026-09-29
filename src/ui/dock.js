import { h } from './dom.js';
import { getSettings } from '../state/settings.js';

/*
 * Magnifying dock - a vanilla port of the Motion/React Dock component.
 * Each icon's size follows a gaussian of the cursor's distance to the icon's centre, eased with a spring
 * (stiffness 400, damping 25, mass 0.4). Icons grow upward from the dock's baseline and push their
 * neighbours sideways. Touch devices, and the app's own Reduce motion setting, get fixed-size icons.
 */
const SPRING = { stiffness: 400, damping: 25, mass: 0.4 };

export function createDock({
  items, magnification = 1.8, distance = 120, iconSize = 40, gap = 4, borderRadius = 16,
  alwaysShowLabels = false, spring = SPRING, className = ''
}) {
  const coarse = matchMedia('(pointer: coarse)').matches || matchMedia('(hover: none)').matches;
  const reduced = getSettings().reduceMotion;
  const still = coarse || reduced;
  const labels = alwaysShowLabels || coarse;

  const el = h('div', { class: `dock ${className}`.trim(), role: 'toolbar', 'aria-label': 'Main menu', style: `gap:${gap}px;border-radius:${borderRadius}px` });
  const tip = h('div', { class: 'dock__tip', 'aria-hidden': 'true' }, [h('span', { class: 'dock__tiptext' }), h('svg', { class: 'dock__arrow', viewBox: '0 0 8 4', width: 8, height: 4 })]);
  tip.querySelector('svg').innerHTML = '<path d="M0 0L4 4L8 0" fill="currentColor"/>';
  const tipText = tip.querySelector('.dock__tiptext');

  const cells = items.map((item) => {
    const Tag = item.href ? 'a' : 'button';
    const inner = h(Tag, {
      class: 'dock__btn', href: item.href, type: item.href ? null : 'button', 'aria-label': item.label,
      style: `border-radius:${borderRadius}px`, onclick: item.onClick
    }, item.icon);
    const icon = h('div', { class: 'dock__icon', style: `width:${iconSize}px;height:${iconSize}px` }, inner);
    const wrap = h('div', { class: 'dock__cell', style: `height:${iconSize}px;width:${iconSize}px` }, [icon, labels ? h('span', { class: 'dock__label', text: item.short || item.label }) : null]);
    return { item, wrap, icon, w: iconSize, v: 0, target: iconSize };
  });

  cells.forEach((c, i) => {
    el.append(c.wrap);
    if (c.item.separator) el.append(h('div', { class: 'dock__sep' }, h('div')));
    c.wrap.addEventListener('mouseenter', () => { hovered = i; showTip(); });
    c.wrap.addEventListener('mouseleave', () => { hovered = -1; tip.classList.remove('is-on'); });
    c.wrap.addEventListener('focusin', () => { hovered = i; showTip(); });
    c.wrap.addEventListener('focusout', () => { hovered = -1; tip.classList.remove('is-on'); });
  });
  if (!labels) el.append(tip);

  let mouseX = Infinity;
  let hovered = -1;
  let raf = 0;
  let last = 0;

  const gaussian = (d) => (magnification - 1) * Math.exp(-(d * d) / (2 * distance * distance)) + 1;

  function apply(c) {
    c.wrap.style.width = `${c.w}px`;
    c.icon.style.width = `${c.w}px`;
    c.icon.style.height = `${c.w}px`;
  }

  function showTip() {
    if (labels || hovered < 0) return;
    tipText.textContent = cells[hovered].item.label;
    tip.classList.add('is-on');
    placeTip();
  }

  function placeTip() {
    if (hovered < 0) return;
    const c = cells[hovered];
    const d = el.getBoundingClientRect();
    const r = c.icon.getBoundingClientRect();
    tip.style.left = `${r.left - d.left + r.width / 2}px`;
    tip.style.bottom = `${d.bottom - r.top + 8}px`;
  }

  function frame(now) {
    const dt = Math.min(0.032, (now - last) / 1000 || 0.016);
    last = now;
    let moving = false;
    for (const c of cells) {
      const rect = c.wrap.getBoundingClientRect();
      /* distance is measured to the cell's resting centre so growth doesn't feed back on itself */
      const d = Math.abs(mouseX - (rect.left + rect.width / 2));
      c.target = Number.isFinite(mouseX) ? iconSize * gaussian(d) : iconSize;
      const force = -spring.stiffness * (c.w - c.target) - spring.damping * c.v;
      c.v += (force / spring.mass) * dt;
      c.w += c.v * dt;
      if (Math.abs(c.v) > 0.05 || Math.abs(c.w - c.target) > 0.05) moving = true; else { c.w = c.target; c.v = 0; }
      apply(c);
    }
    placeTip();
    raf = moving || Number.isFinite(mouseX) ? requestAnimationFrame(frame) : 0;
  }
  const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };

  if (!still) {
    el.addEventListener('mousemove', (e) => { mouseX = e.clientX; kick(); });
    el.addEventListener('mouseleave', () => { mouseX = Infinity; kick(); });
  }

  return { el, destroy() { cancelAnimationFrame(raf); raf = 0; } };
}
