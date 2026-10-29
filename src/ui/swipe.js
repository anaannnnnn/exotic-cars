import { h, icon } from './dom.js';

/*
 * Swipe-to-confirm control. Drag the handle to the right to trigger onDone; it springs back if released early.
 * Works with mouse, touch and pen, and with the keyboard (Enter / Space confirm, Arrow keys nudge).
 */
export function createSwipe({ label = 'Enquire', hint = 'Swipe right', mark = null, onDone }) {
  const handle = h('button', { class: 'swipe__handle', type: 'button', 'aria-label': `${label} - swipe right, or press Enter` }, mark || icon('forward'));
  const fill = h('span', { class: 'swipe__fill', 'aria-hidden': 'true' });
  const track = h('div', { class: 'swipe__track' }, [
    fill,
    h('span', { class: 'swipe__label' }, [h('span', { class: 'swipe__chev', 'aria-hidden': 'true' }, icon('swipe')), h('span', { text: label })]),
    handle
  ]);
  const el = h('div', { class: 'swipe', role: 'group', 'aria-label': `${label} control` }, [h('span', { class: 'swipe__hint', text: hint }), track]);

  let dragging = false, startX = 0, pos = 0, max = 0, busy = false;
  const measure = () => { max = Math.max(0, track.clientWidth - handle.offsetWidth - 8); };
  const set = (x) => { pos = Math.max(0, Math.min(max, x)); track.style.setProperty('--x', `${pos}px`); track.style.setProperty('--p', max ? String(pos / max) : '0'); };

  function complete() {
    if (busy) return;
    busy = true;
    measure();
    track.classList.add('is-snap');
    set(max);
    track.classList.add('is-done');
    setTimeout(() => {
      onDone?.();
      setTimeout(() => { track.classList.remove('is-done'); set(0); setTimeout(() => { track.classList.remove('is-snap'); busy = false; }, 420); }, 500);
    }, 260);
  }

  handle.addEventListener('pointerdown', (e) => {
    if (busy) return;
    measure();
    dragging = true;
    startX = e.clientX - pos;
    track.classList.remove('is-snap');
    track.classList.add('is-drag');
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => { if (dragging) set(e.clientX - startX); });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    track.classList.remove('is-drag');
    if (max && pos / max >= 0.82) complete();
    else { track.classList.add('is-snap'); set(0); setTimeout(() => track.classList.remove('is-snap'), 420); }
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); complete(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); measure(); track.classList.add('is-snap'); set(pos + max * 0.25); if (pos / max >= 0.99) complete(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); measure(); track.classList.add('is-snap'); set(pos - max * 0.25); }
  });
  window.addEventListener('resize', measure);
  /* the footer can change width without the window changing (fonts loading, the dock resizing): measure again then too */
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (!dragging && !busy) measure(); }) : null;
  ro?.observe(track);
  requestAnimationFrame(measure);
  return { el, destroy() { window.removeEventListener('resize', measure); ro?.disconnect(); } };
}
