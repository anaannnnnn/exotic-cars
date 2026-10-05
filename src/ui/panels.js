import * as data from '../data/catalog.js';
import { h, icon, clear } from './dom.js';
import { toast } from './toast.js';
import {
  getSettings, setSetting, getUser, signIn, signOut, saveAppointment, getAppointments, resetLocalData
} from '../state/settings.js';
import { send as sendRequest, problemText } from '../state/outbox.js';

/* Modal sheets opened from the dock: service appointment, sign in, settings and the VR viewer. */

let open = null;

export function closePanel() {
  if (!open) return;
  open.el.remove();
  document.body.classList.remove('is-locked');
  document.removeEventListener('keydown', open.onKey);
  open.onClose?.();
  open = null;
}

function modal(title, sub, body, { wide = false, onClose } = {}) {
  closePanel();
  const onKey = (e) => { if (e.key === 'Escape') closePanel(); };
  const el = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
    h('div', { class: 'sheet__scrim', onclick: closePanel }),
    h('div', { class: `sheet__panel${wide ? ' sheet__panel--wide' : ''}` }, [
      h('div', { class: 'sheet__head' }, [
        h('div', {}, [h('h2', { text: title }), sub ? h('p', { class: 'sheet__sub', text: sub }) : null]),
        h('button', { class: 'round round--sm', type: 'button', 'aria-label': 'Close', onclick: closePanel }, icon('close'))
      ]),
      body
    ])
  ]);
  document.body.append(el);
  document.body.classList.add('is-locked');
  document.addEventListener('keydown', onKey);
  open = { el, onKey, onClose };
  const first = el.querySelector('input, select, textarea, button.cta');
  first?.focus?.({ preventScroll: true });
  return el;
}

const field = (label, control, hint) => h('label', { class: 'field' }, [h('span', { class: 'field__label', text: label }), control, hint ? h('small', { text: hint }) : null]);
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/* ------------------------------------------------------------------ service appointment */
const SERVICES = ['Test drive', 'Service & maintenance', 'Wheel & aero fitting', 'Paint protection & detailing', 'Configuration consultation'];
const SLOTS = ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00'];

export function openService(prefill = {}) {
  const user = getUser();
  const f = {
    name: h('input', { type: 'text', autocomplete: 'name', required: true, value: user?.name || '' }),
    phone: h('input', { type: 'tel', autocomplete: 'tel', inputmode: 'tel', required: true, placeholder: '+971 5X XXX XXXX' }),
    email: h('input', { type: 'email', autocomplete: 'email', value: user?.email || '' }),
    service: h('select', {}, SERVICES.map((s) => h('option', { value: s, text: s }))),
    car: h('input', { type: 'text', placeholder: 'e.g. Porsche 911 GT3 RS', list: 'appt-cars' }),
    date: h('input', { type: 'date', required: true, min: today(), value: today() }),
    slot: h('select', {}, SLOTS.map((s) => h('option', { value: s, text: s }))),
    notes: h('textarea', { rows: 3, placeholder: 'Anything we should prepare?' })
  };
  if (typeof prefill.car === 'string') f.car.value = prefill.car;
  if (typeof prefill.service === 'string' && SERVICES.includes(prefill.service)) f.service.value = prefill.service;
  const cars = h('datalist', { id: 'appt-cars' }, data.listVehicles().slice(0, 600).map((v) => h('option', { value: `${v.make} ${v.model}` })));
  const err = h('p', { class: 'form__err', role: 'alert' });

  const form = h('form', { class: 'form', novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    if (!f.name.value.trim()) { err.textContent = 'Please enter your name.'; f.name.focus(); return; }
    if (f.phone.value.replace(/\D/g, '').length < 7) { err.textContent = 'Please enter a phone number we can reach you on.'; f.phone.focus(); return; }
    if (!f.date.value || f.date.value < today()) { err.textContent = 'Please choose a date from today onwards.'; f.date.focus(); return; }
    const payload = {
      name: f.name.value.trim(), phone: f.phone.value.trim(), email: f.email.value.trim(), service: f.service.value,
      car: f.car.value.trim(), date: f.date.value, slot: f.slot.value, notes: f.notes.value.trim()
    };
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    sendRequest('appointment', payload).then((r) => confirmation(saveAppointment({ ...payload, ref: r.ref, sent: r.sent })), (e2) => { err.textContent = problemText(e2); })
      .finally(() => { btn.disabled = false; });
  } }, [
    field('Service', f.service),
    field('Vehicle', f.car),
    h('div', { class: 'row' }, [field('Date', f.date), field('Time', f.slot)]),
    field('Name', f.name),
    h('div', { class: 'row' }, [field('Phone', f.phone), field('Email', f.email)]),
    field('Notes', f.notes),
    err, cars,
    h('button', { class: 'cta cta--block', type: 'submit', text: 'Request appointment' })
  ]);

  const past = getAppointments();
  const el = modal('Service appointment', 'Choose a service, a date and a time. The dealership confirms by phone.', form);
  if (past.length) el.querySelector('.form').append(h('p', { class: 'form__note', text: `${past.length} request${past.length > 1 ? 's' : ''} saved on this device` }));

  function confirmation(item) {
    const text = [`Appointment request ${item.ref}`, item.service, item.car && `Vehicle: ${item.car}`, `${item.date} at ${item.slot}`, `${item.name} · ${item.phone}${item.email ? ` · ${item.email}` : ''}`, item.notes && `Notes: ${item.notes}`].filter(Boolean).join('\n');
    const body = h('div', { class: 'done' }, [
      h('span', { class: 'done__tick' }, icon('check')),
      h('h3', { text: item.sent === false ? 'Request saved' : 'Request sent' }),
      item.sent === false ? h('p', { class: 'form__note', text: 'You are offline: it is kept on this device and sent automatically when you reconnect.' }) : null,
      h('p', { text: `${item.service}${item.car ? ` · ${item.car}` : ''}` }),
      h('p', { class: 'done__when', text: `${new Date(`${item.date}T${item.slot}`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · ${item.slot}` }),
      h('p', { class: 'done__ref', text: `Reference ${item.ref}` }),
      h('div', { class: 'sheet__actions' }, [
        h('button', { class: 'cta', type: 'button', onclick: () => navigator.clipboard?.writeText(text).then(() => toast('Details copied'), () => toast('Copy is not available')) }, [icon('copy'), 'Copy details']),
        h('button', { class: 'ghost', type: 'button', onclick: closePanel, text: 'Done' })
      ])
    ]);
    modal('Service appointment', null, body);
  }
}

/* ------------------------------------------------------------------ enquiry to the sales team */
/**
 * A short form that sends an enquiry (lead) to the dealership's CRM: about a car, or a full 3D configuration with
 * paint, wheels, kits, total and the link that reopens it.
 *   openEnquiry({ title, sub, type: 'configuration' | 'viewing' | 'general', car: { id, title }, configuration, summary, source })
 */
export function openEnquiry({ title = 'Send to the dealership', sub = 'A sales advisor will contact you by phone or WhatsApp.', type = 'general', car = null, configuration = null, summary = null, source = 'website', message = '' } = {}) {
  const user = getUser();
  const f = {
    name: h('input', { type: 'text', autocomplete: 'name', required: true, value: user?.name || '' }),
    phone: h('input', { type: 'tel', autocomplete: 'tel', inputmode: 'tel', required: true, placeholder: '+971 5X XXX XXXX', value: user?.phone || '' }),
    email: h('input', { type: 'email', autocomplete: 'email', value: user?.email || '' }),
    message: h('textarea', { rows: 3, placeholder: type === 'configuration' ? 'Questions, trade-in, preferred contact time…' : 'What would you like to know?' }),
    website: h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', class: 'hp', 'aria-hidden': 'true' })
  };
  f.message.value = message;
  const err = h('p', { class: 'form__err', role: 'alert' });
  const btn = h('button', { class: 'cta cta--block', type: 'submit' }, [icon('send'), 'Send enquiry']);
  const form = h('form', { class: 'form', novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    err.textContent = '';
    if (f.name.value.trim().length < 2) { err.textContent = 'Please enter your name.'; f.name.focus(); return; }
    if (f.phone.value.replace(/\D/g, '').length < 7) { err.textContent = 'Please enter a phone number we can reach you on.'; f.phone.focus(); return; }
    btn.disabled = true;
    const payload = { type, name: f.name.value.trim(), phone: f.phone.value.trim(), email: f.email.value.trim(), message: f.message.value.trim(), car, configuration, source, website: f.website.value };
    sendRequest('lead', payload).then((r) => {
      modal('Enquiry sent', null, h('div', { class: 'done' }, [
        h('span', { class: 'done__tick' }, icon('check')),
        h('h3', { text: r.sent ? 'With the sales team' : 'Saved on this device' }),
        h('p', { text: r.sent ? 'An advisor will call you shortly to talk it through.' : 'You are offline. It is sent automatically when you reconnect.' }),
        car?.title ? h('p', { class: 'done__when', text: car.title }) : null,
        h('p', { class: 'done__ref', text: `Reference ${r.ref}` }),
        h('div', { class: 'sheet__actions' }, [h('button', { class: 'cta', type: 'button', text: 'Done', onclick: closePanel })])
      ]));
    }, (e2) => { err.textContent = problemText(e2); }).finally(() => { btn.disabled = false; });
  } }, [
    summary ? h('div', { class: 'enq__sum' }, summary) : null,
    field('Name', f.name),
    h('div', { class: 'row' }, [field('Phone', f.phone), field('Email (optional)', f.email)]),
    field('Message', f.message),
    f.website, err, btn,
    h('p', { class: 'form__note', text: 'Your details go only to Exotic Cars Dubai, to answer this enquiry.' })
  ]);
  modal(title, sub, form);
}

/* ------------------------------------------------------------------ sign in */
export function openLogin() {
  const user = getUser();
  if (user) {
    modal('Your account', 'Saved on this device', h('div', { class: 'account' }, [
      h('span', { class: 'avatar', text: (user.name || user.email || '?').trim()[0].toUpperCase() }),
      h('strong', { text: user.name || 'Guest' }),
      h('span', { class: 'muted', text: user.email }),
      h('div', { class: 'sheet__actions' }, [h('button', { class: 'ghost', type: 'button', text: 'Sign out', onclick: () => { signOut(); closePanel(); toast('Signed out'); } })])
    ]));
    return;
  }
  const name = h('input', { type: 'text', autocomplete: 'name', placeholder: 'Your name' });
  const email = h('input', { type: 'email', autocomplete: 'email', required: true, placeholder: 'you@example.com' });
  const err = h('p', { class: 'form__err', role: 'alert' });
  modal('Sign in', 'Save your builds and appointment details on this device.', h('form', { class: 'form', novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { err.textContent = 'Please enter a valid email address.'; email.focus(); return; }
    signIn({ name: name.value.trim(), email: email.value.trim() });
    closePanel();
    toast(`Welcome${name.value.trim() ? `, ${name.value.trim().split(' ')[0]}` : ''}`);
  } }, [
    field('Name', name), field('Email', email), err,
    h('button', { class: 'cta cta--block', type: 'submit', text: 'Continue' }),
    h('p', { class: 'form__note', text: 'No password is needed. Your details stay in this browser.' })
  ]));
}

/* ------------------------------------------------------------------ settings */
export function openSettings() {
  const s = getSettings();
  const row = (label, hint, key) => {
    const input = h('input', { type: 'checkbox', role: 'switch', checked: s[key] ? true : null, onchange: (e) => setSetting(key, e.target.checked) });
    return h('label', { class: 'toggle' }, [h('span', {}, [h('strong', { text: label }), h('small', { text: hint })]), input, h('i', { 'aria-hidden': 'true' })]);
  };
  modal('Settings', null, h('div', { class: 'settings' }, [
    row('Dark appearance', 'Easier on the eyes in a dim showroom', 'dark'),
    row('Hide prices', 'For customer-facing screens', 'hidePrices'),
    row('Reduce motion', 'Calmer animations and a still dock', 'reduceMotion'),
    h('button', { class: 'ghost ghost--block', type: 'button', text: 'Clear saved data on this device', onclick: () => { resetLocalData(); closePanel(); toast('Saved data cleared'); } })
  ]));
}

/* ------------------------------------------------------------------ VR */
/** Full-screen Sketchfab viewer with its VR and AR buttons, for any model ({ uid }) - used by the VR page. */
export function launchVRModel(model, title) {
  if (!model?.uid) return;
  closePanel();
  const frame = h('iframe', {
    class: 'vr__frame', title: `${title} in VR`, allow: 'autoplay; fullscreen; xr-spatial-tracking; accelerometer; gyroscope',
    allowfullscreen: true, src: `https://sketchfab.com/models/${model.uid}/embed?autostart=1&dnt=1&ui_vr=1&ui_ar=1&ui_fullscreen=1&ui_infos=0&ui_watermark_link=0`
  });
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { el.remove(); document.body.classList.remove('is-locked'); document.removeEventListener('keydown', onKey); };
  const el = h('div', { class: 'vr', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${title} in VR` }, [
    frame,
    h('div', { class: 'vr__bar' }, [h('span', { text: title }), h('button', { class: 'round round--sm', type: 'button', 'aria-label': 'Close viewer', onclick: close }, icon('close'))])
  ]);
  document.body.append(el);
  document.body.classList.add('is-locked');
  document.addEventListener('keydown', onKey);
}

export function openVR() {
  const cars = data.listVehicles();
  const groups = new Map();
  cars.forEach((v) => { if (!groups.has(v.make)) groups.set(v.make, []); groups.get(v.make).push(v); });
  const select = h('select', {}, [...groups].map(([make, list]) => h('optgroup', { label: make }, list.map((v) => h('option', { value: v.id, text: `${v.model} (${v.generation})` })))));
  const saved = sessionStorage.getItem('apex-vr-car');
  if (saved) select.value = saved;
  modal('VR & AR viewer', 'Step inside or place the car in your driveway. Works with a VR headset, or AR on a phone.', h('div', { class: 'form' }, [
    field('Car', select),
    h('button', { class: 'cta cta--block', type: 'button', text: 'Launch viewer', onclick: () => launch(select.value) }),
    h('p', { class: 'form__note', text: 'Opens full screen. Use the VR or AR button inside the viewer.' })
  ]));

  function launch(id) {
    const v = data.vehicle(id);
    if (!v) return;
    try { sessionStorage.setItem('apex-vr-car', id); } catch { /* ignore */ }
    const m = v.models[0];
    const frame = h('iframe', {
      class: 'vr__frame', title: `${v.make} ${v.model} in VR`, allow: 'autoplay; fullscreen; xr-spatial-tracking; accelerometer; gyroscope',
      allowfullscreen: true, src: `https://sketchfab.com/models/${m.uid}/embed?autostart=1&dnt=1&ui_vr=1&ui_ar=1&ui_fullscreen=1&ui_infos=0&ui_watermark_link=0`
    });
    closePanel();
    const el = h('div', { class: 'vr', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'VR viewer' }, [
      frame,
      h('div', { class: 'vr__bar' }, [h('span', { text: `${v.make} ${v.model}` }), h('button', { class: 'round round--sm', type: 'button', 'aria-label': 'Close viewer', onclick: () => { el.remove(); document.body.classList.remove('is-locked'); } }, icon('close'))])
    ]);
    document.body.append(el);
    document.body.classList.add('is-locked');
  }
}
