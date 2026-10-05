import { h, icon } from './dom.js';
import { getSettings, setSetting, onSettings } from '../state/settings.js';
import { haptic } from './haptics.js';

/*
 * Light / dark toggle. A round button holding a sun and a moon that cross-fade (scale 0.25 -> 1, blur 4px -> 0).
 * Switching opens the new theme as a circle growing out of the button (View Transitions); where the browser has no
 * view transitions, or the visitor asked for less motion, the theme snaps with every CSS transition held for one
 * frame so nothing smears. Every toggle on the page stays in step through the settings listener.
 */
const reduced = () => document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;

function syncAll(dark) {
  document.querySelectorAll('.theme-tg').forEach((b) => {
    b.setAttribute('aria-pressed', String(dark));
    b.dataset.tip = dark ? 'Light appearance' : 'Dark appearance';
  });
}
onSettings((s) => syncAll(!!s.dark));

/** Snap a theme change without transitions smearing it across the page. */
function snap(apply) {
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{transition:none!important}';
  document.head.append(style);
  apply();
  void document.body.offsetHeight;
  requestAnimationFrame(() => style.remove());
}

export function toggleTheme(from) {
  const dark = !getSettings().dark;
  const apply = () => setSetting('dark', dark);
  haptic(8);
  const root = document.documentElement;
  if (!document.startViewTransition || reduced()) { snap(apply); return; }
  const r = from?.getBoundingClientRect();
  root.style.setProperty('--tx', `${r ? r.left + r.width / 2 : innerWidth / 2}px`);
  root.style.setProperty('--ty', `${r ? r.top + r.height / 2 : 0}px`);
  root.classList.add('theme-vt');
  const vt = document.startViewTransition(() => snap(apply));
  vt.finished.finally(() => root.classList.remove('theme-vt'));
}

export function themeToggle(cls = '') {
  const dark = !!getSettings().dark;
  const btn = h('button', {
    class: `theme-tg ${cls}`.trim(), type: 'button', 'aria-label': 'Dark appearance', 'aria-pressed': String(dark),
    'data-tip': dark ? 'Light appearance' : 'Dark appearance', onclick: (e) => toggleTheme(e.currentTarget)
  }, [h('span', { class: 'theme-tg__ic theme-tg__sun', 'aria-hidden': 'true' }, icon('sun')), h('span', { class: 'theme-tg__ic theme-tg__moon', 'aria-hidden': 'true' }, icon('moon'))]);
  return btn;
}
