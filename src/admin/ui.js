import {
  createElement, LayoutDashboard, CarFront, Disc3, KanbanSquare, CalendarClock, Users, Settings, LogOut, Search, Plus, X, Check,
  ChevronLeft, ChevronRight, ChevronDown, Phone, MessageCircle, Mail, Trash2, Pencil, Eye, EyeOff, Star, Sparkles, Tag, ImagePlus,
  Upload, Download, RefreshCw, ExternalLink, Sun, Moon, TriangleAlert, CircleCheck, Clock, ArrowUpRight, ArrowRight, Filter, Grip,
  Database, ShieldCheck, Activity, Menu, StickyNote, Banknote, TrendingUp, Gauge, Wrench, Lock, Copy, List, Columns3, Wind, MapPin, Undo2
} from 'lucide';

/* Building blocks for the CRM. Every text value goes in through textContent (h's `text` or a child string), never HTML. */

const ICONS = {
  dashboard: LayoutDashboard, car: CarFront, wheel: Disc3, leads: KanbanSquare, calendar: CalendarClock, users: Users, settings: Settings,
  logout: LogOut, search: Search, plus: Plus, close: X, check: Check, left: ChevronLeft, right: ChevronRight, down: ChevronDown,
  phone: Phone, whatsapp: MessageCircle, mail: Mail, trash: Trash2, edit: Pencil, eye: Eye, eyeoff: EyeOff, star: Star, spark: Sparkles,
  tag: Tag, photo: ImagePlus, upload: Upload, download: Download, refresh: RefreshCw, external: ExternalLink, sun: Sun, moon: Moon,
  alert: TriangleAlert, done: CircleCheck, clock: Clock, open: ArrowUpRight, arrow: ArrowRight, filter: Filter, grip: Grip, db: Database,
  shield: ShieldCheck, activity: Activity, menu: Menu, note: StickyNote, money: Banknote, trend: TrendingUp, gauge: Gauge, wrench: Wrench,
  lock: Lock, copy: Copy, list: List, board: Columns3, kit: Wind, pin: MapPin, undo: Undo2
};

export function icon(name, cls = '') {
  const svg = createElement(ICONS[name] || Check, { 'stroke-width': 1.6, 'aria-hidden': 'true' });
  if (cls) svg.setAttribute('class', cls);
  return svg;
}

/** h('button', { class, text, onclick, dataset }, children) */
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = Boolean(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVGNS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, children = []) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const c of [].concat(children)) if (c) el.append(c);
  return el;
}

export const clear = (node) => { node.replaceChildren(); return node; };
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ---------------------------------------------------------------- formatting */
const aedFmt = new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 });
export const aed = (n) => (n == null || n === '' ? '—' : `AED ${aedFmt.format(n)}`);
export const compact = (n) => {
  if (n == null) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(Math.round(n));
};
export const num = (n) => (n == null ? '—' : aedFmt.format(n));
export function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
export const dateLabel = (ymd) => {
  if (!ymd) return '';
  const d = new Date(`${ymd}T12:00:00`);
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const diff = Math.round((d - today) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};
export const localToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/** wa.me link for a UAE-style number: 05x… becomes 9715x… */
export function whatsapp(phone, text = '') {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `971${d.slice(1)}`;
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/* ---------------------------------------------------------------- toasts */
let toastHost = null;
export function toast(message, kind = 'ok') {
  toastHost ||= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const el = h('div', { class: `toast toast--${kind}` }, [icon(kind === 'error' ? 'alert' : 'done'), h('span', { text: message })]);
  toastHost.append(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  setTimeout(() => { el.classList.remove('is-in'); setTimeout(() => el.remove(), 300); }, kind === 'error' ? 5200 : 2800);
}
export const failed = (e) => toast(e?.fields ? `${e.message} ${Object.entries(e.fields).map(([k, v]) => `${k}: ${v}`).join(' · ')}` : e?.message || 'Something went wrong', 'error');

/* ---------------------------------------------------------------- overlays */
const stack = [];
function trap(e) {
  const top = stack.at(-1);
  if (!top) return;
  if (e.key === 'Escape') { e.preventDefault(); top.close(); }
}
document.addEventListener('keydown', trap);

/** A side drawer (full screen on phones). Returns { el, body, foot, close }. */
export function drawer({ title, sub, wide = false, onClose } = {}) {
  const body = h('div', { class: 'drawer__body' });
  const foot = h('div', { class: 'drawer__foot' });
  const titleEl = h('h2', { class: 'drawer__title', text: title || '' });
  const subEl = h('p', { class: 'drawer__sub', text: sub || '' });
  const el = h('div', { class: `drawer${wide ? ' drawer--wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Details' }, [
    h('div', { class: 'drawer__scrim', onclick: () => api.close() }),
    h('section', { class: 'drawer__panel' }, [
      h('header', { class: 'drawer__head' }, [h('div', { class: 'drawer__titles' }, [titleEl, subEl]), h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Close', onclick: () => api.close() }, icon('close'))]),
      body, foot
    ])
  ]);
  const api = {
    el, body, foot, titleEl, subEl,
    close() {
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      el.classList.remove('is-open');
      setTimeout(() => el.remove(), 260);
      if (!stack.length) document.body.classList.remove('is-locked');
      onClose?.();
    }
  };
  document.body.append(el);
  document.body.classList.add('is-locked');
  stack.push(api);
  requestAnimationFrame(() => el.classList.add('is-open'));
  return api;
}

/** Confirm dialog. Resolves true/false. */
export function confirmBox({ title, body, ok = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const api = { close: () => finish(false) };
    const finish = (v) => {
      if (done) return;
      done = true;
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      el.remove();
      resolve(v);
    };
    const el = h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title }, [
      h('div', { class: 'dialog__scrim', onclick: () => finish(false) }),
      h('div', { class: 'dialog__panel' }, [
        h('span', { class: `dialog__ic${danger ? ' is-danger' : ''}` }, icon(danger ? 'alert' : 'check')),
        h('h3', { text: title }),
        body ? h('p', { text: body }) : null,
        h('div', { class: 'dialog__actions' }, [
          h('button', { class: 'btn btn--ghost', type: 'button', text: 'Cancel', onclick: () => finish(false) }),
          h('button', { class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`, type: 'button', text: ok, onclick: () => finish(true) })
        ])
      ])
    ]);
    stack.push(api);
    document.body.append(el);
    el.querySelector('.btn--primary, .btn--danger').focus();
  });
}

/* ---------------------------------------------------------------- form controls */
/** A labelled field. control is an element; returns the wrapper. */
export const field = (label, control, { hint, span = 1, error } = {}) => h('label', { class: `fld${span === 2 ? ' fld--2' : ''}`, dataset: { name: control.name || '' } }, [
  h('span', { class: 'fld__label', text: label }), control, hint ? h('small', { class: 'fld__hint', text: hint }) : null,
  h('small', { class: 'fld__err', text: error || '' })
]);

export const input = (name, value, attrs = {}) => h('input', { class: 'inp', name, value: value ?? '', ...attrs });
export const textarea = (name, value, attrs = {}) => { const t = h('textarea', { class: 'inp inp--area', name, rows: 4, ...attrs }); t.value = value ?? ''; return t; };
export function select(name, options, value, attrs = {}) {
  const s = h('select', { class: 'inp inp--select', name, ...attrs }, options.map((o) => {
    const [v, label] = Array.isArray(o) ? o : [o, o];
    return h('option', { value: v, text: label });
  }));
  s.value = value ?? '';
  return s;
}
export const toggle = (name, checked, label) => h('label', { class: 'switch' }, [
  h('input', { type: 'checkbox', name, checked }), h('span', { class: 'switch__track' }, h('span', { class: 'switch__dot' })), h('span', { class: 'switch__label', text: label })
]);

/** Show the server's field errors next to the fields, by name. */
export function showFieldErrors(form, fields) {
  form.querySelectorAll('.fld.is-invalid').forEach((f) => { f.classList.remove('is-invalid'); f.querySelector('.fld__err').textContent = ''; });
  if (!fields) return;
  let first = null;
  for (const [key, msg] of Object.entries(fields)) {
    const parts = key.split('.');
    const f = form.querySelector(`.fld[data-name="${CSS.escape(parts.slice(0, 2).join('.'))}"]`) || form.querySelector(`.fld[data-name="${CSS.escape(parts[0])}"]`);
    if (!f) continue;
    f.classList.add('is-invalid');
    f.querySelector('.fld__err').textContent = msg;
    first ||= f;
  }
  first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/** Segmented control. */
export function segmented(options, value, onChange, { label = 'Filter' } = {}) {
  const el = h('div', { class: 'seg', role: 'tablist', 'aria-label': label });
  const btns = options.map(([v, text, count]) => h('button', { class: 'seg__btn', type: 'button', role: 'tab', 'aria-selected': String(v === value), dataset: { v }, onclick: () => set(v, true) }, [text, count != null ? h('span', { class: 'seg__n', text: String(count) }) : null]));
  el.append(...btns);
  function set(v, fire) {
    value = v;
    btns.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === v)));
    if (fire) onChange(v);
  }
  return { el, set, get value() { return value; } };
}

export const chip = (text, tone = '') => h('span', { class: `chip${tone ? ` chip--${tone}` : ''}`, text });
export const empty = (title, body, action) => h('div', { class: 'empty' }, [h('span', { class: 'empty__ic' }, icon('spark')), h('h3', { text: title }), body ? h('p', { text: body }) : null, action || null]);
export const skeleton = (rows = 6) => h('div', { class: 'skel' }, Array.from({ length: rows }, () => h('div', { class: 'skel__row' })));
export const errorState = (e, retry) => h('div', { class: 'empty empty--error' }, [h('span', { class: 'empty__ic' }, icon('alert')), h('h3', { text: e.title || 'Could not load' }), h('p', { text: e.message }), retry ? h('button', { class: 'btn btn--ghost', type: 'button', onclick: retry }, [icon('refresh'), 'Try again']) : null]);

/* ---------------------------------------------------------------- statuses */
export const LEAD = {
  new: { label: 'New', tone: 'red' }, contacted: { label: 'Contacted', tone: 'amber' }, qualified: { label: 'Qualified', tone: 'blue' },
  negotiating: { label: 'Negotiating', tone: 'violet' }, won: { label: 'Won', tone: 'green' }, lost: { label: 'Lost', tone: 'grey' }
};
export const APPT = {
  requested: { label: 'Requested', tone: 'red' }, confirmed: { label: 'Confirmed', tone: 'blue' }, completed: { label: 'Completed', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'grey' }, 'no-show': { label: 'No-show', tone: 'amber' }
};
export const LEAD_TYPE = { configuration: '3D build', viewing: 'Car enquiry', general: 'General' };

/* ---------------------------------------------------------------- tiny charts (SVG) */
/** Horizontal bars: rows = [[label, value]] */
export function bars(rows, { format = String } = {}) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return h('ul', { class: 'bars' }, rows.map(([label, value]) => h('li', { class: 'bars__row' }, [
    h('span', { class: 'bars__label', text: label }),
    h('span', { class: 'bars__track' }, h('span', { class: 'bars__fill', style: `--w:${Math.max(2, (value / max) * 100)}%` })),
    h('span', { class: 'bars__val', text: format(value) })
  ])));
}

/** Donut: parts = [{ value, tone, label }] */
export function donut(parts, centre, sub) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const r = 42, c = 2 * Math.PI * r;
  let off = 0;
  const rings = parts.filter((p) => p.value > 0).map((p) => {
    const len = (p.value / total) * c;
    const seg = svg('circle', { cx: 60, cy: 60, r, fill: 'none', class: `donut__seg tone--${p.tone}`, 'stroke-width': 12, 'stroke-dasharray': `${Math.max(0, len - 2)} ${c}`, 'stroke-dashoffset': -off, transform: 'rotate(-90 60 60)' });
    off += len;
    return seg;
  });
  return h('div', { class: 'donut' }, [
    svg('svg', { viewBox: '0 0 120 120', role: 'img', 'aria-label': parts.map((p) => `${p.label} ${p.value}`).join(', ') }, [
      svg('circle', { cx: 60, cy: 60, r, fill: 'none', class: 'donut__bg', 'stroke-width': 12 }), ...rings
    ]),
    h('div', { class: 'donut__mid' }, [h('b', { text: centre }), h('small', { text: sub })])
  ]);
}

/** Spark bars for a short series (e.g. leads per day). */
export function spark(values) {
  const max = Math.max(1, ...values);
  const w = 7, gap = 3;
  return svg('svg', { class: 'spark', viewBox: `0 0 ${values.length * (w + gap)} 32`, preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    values.map((v, i) => svg('rect', { x: i * (w + gap), y: 32 - Math.max(2, (v / max) * 32), width: w, height: Math.max(2, (v / max) * 32), rx: 2 })));
}
