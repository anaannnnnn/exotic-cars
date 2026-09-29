/** Tiny hyperscript helper: h('button', { class: 'x', onclick }, [children]) */
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

import {
  createElement, ArrowLeft, ChevronDown, Search, Share, Camera, X, Check, CarFront, Printer, Copy, MousePointer2, RotateCw,
  CalendarClock, UserRound, Settings, Glasses, Store, Gauge, Calendar, Fuel, Zap, Leaf, ArrowRight, MapPin, Palette
} from 'lucide';

/* Lucide icons (https://lucide.dev), referenced by short names throughout the UI. */
const ICONS = {
  back: ArrowLeft, forward: ArrowRight, chevron: ChevronDown, search: Search, share: Share, camera: Camera, close: X, check: Check, car: CarFront,
  print: Printer, copy: Copy, pick: MousePointer2, rotate: RotateCw, calendar: CalendarClock, user: UserRound, gear: Settings, vr: Glasses,
  shop: Store, gauge: Gauge, year: Calendar, fuel: Fuel, electric: Zap, hybrid: Leaf, pin: MapPin, paint: Palette
};

/** A Lucide icon as an <svg> element (stroke follows currentColor). */
export function icon(name, cls = '') {
  const svg = createElement(ICONS[name] || Check, { 'stroke-width': 1.5, 'aria-hidden': 'true' });
  if (cls) svg.setAttribute('class', cls);
  return svg;
}
export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };
export const $ = (sel, root = document) => root.querySelector(sel);

/** Set a range input's fill percentage for the custom track. */
export function paintRange(input) {
  const min = +input.min || 0, max = +input.max || 100;
  input.style.setProperty('--p', `${((input.value - min) / (max - min)) * 100}%`);
}

/** Debounce for search boxes etc. */
export function debounce(fn, ms) {
  let t = 0;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Animate a number in an element (used for the running total). */
export function countTo(el, to, format, ms = 500) {
  const from = el._value ?? 0;
  el._value = to;
  if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = format(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = format(Math.round(from + (to - from) * e));
    if (k < 1 && el._value === to) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
