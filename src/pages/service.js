import * as stock from '../data/stock.js';
import { h, icon, clear } from '../ui/dom.js';
import { closePanel } from '../ui/panels.js';
import { toast } from '../ui/toast.js';
import { getUser, saveAppointment, getAppointments } from '../state/settings.js';
import { send as sendRequest, problemText } from '../state/outbox.js';
import { pageHead, segmented, field, chips, toggleRow } from '../ui/kit.js';
import { mainDock } from './hub.js';

/*
 * Service: what the workshop does, one form that adapts to the kind of request (booking, repair, quote, test drive),
 * a way to talk to a person or the AI concierge, and the requests already sent from this device.
 */
const SERVICES = [
  { id: 'maintenance', icon: 'wrench', title: 'Scheduled service', body: 'Manufacturer-schedule servicing: fluids, filters, brakes and a full health check.' },
  { id: 'repair', icon: 'alert', title: 'Repair & diagnostics', body: 'Warning lights, noises, electrical faults or accident damage, diagnosed and quoted first.' },
  { id: 'protection', icon: 'shield', title: 'Paint protection', body: 'Paint protection film and ceramic coating to keep the finish as it left the factory.' },
  { id: 'detailing', icon: 'drops', title: 'Detailing', body: 'Hand wash, paint correction, interior deep clean and leather care.' },
  { id: 'wheels', icon: 'wheels', title: 'Wheels & aero', body: 'Forged wheels, tyres and carbon aero parts from Dubai suppliers, fitted and aligned.' },
  { id: 'tint', icon: 'tint', title: 'Window tint', body: 'Heat-rejecting tint in road-legal shades for comfort in the Dubai sun.' },
  { id: 'inspection', icon: 'inspect', title: 'Inspection & valuation', body: 'A detailed inspection report, or a valuation for selling or part-exchange.' },
  { id: 'testdrive', icon: 'gauge', title: 'Test drive', body: 'Drive any car in stock. Choose the car, the day and the time.' }
];
const TYPES = [
  { id: 'book', label: 'Book', icon: 'calendar' },
  { id: 'repair', label: 'Repair', icon: 'wrench' },
  { id: 'quote', label: 'Quote', icon: 'inspect' },
  { id: 'drive', label: 'Test drive', icon: 'gauge' }
];
const ISSUES = [
  { id: 'engine', label: 'Engine' }, { id: 'electrical', label: 'Electrical' }, { id: 'brakes', label: 'Brakes' }, { id: 'suspension', label: 'Suspension' },
  { id: 'gearbox', label: 'Gearbox' }, { id: 'body', label: 'Body & paint' }, { id: 'ac', label: 'Air conditioning' }, { id: 'other', label: 'Other' }
];
const SLOTS = ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00'];
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export function mountService(root) {
  const user = getUser();
  let type = 'book', service = 'maintenance';

  /* ---------- catalogue */
  const catalogue = h('div', { class: 'svc-grid' }, SERVICES.map((s, i) => h('button', {
    class: 'svc', type: 'button', style: `--i:${i}`, 'aria-pressed': String(s.id === service), 'data-tip': s.title, 'data-tip-desc': 'Choose this service',
    onclick: () => { service = s.id; [...catalogue.children].forEach((b, j) => b.setAttribute('aria-pressed', String(SERVICES[j].id === s.id))); seg.select(s.id === 'repair' ? 'repair' : s.id === 'testdrive' ? 'drive' : type === 'repair' || type === 'drive' ? 'book' : type); setType(s.id === 'repair' ? 'repair' : s.id === 'testdrive' ? 'drive' : type === 'repair' || type === 'drive' ? 'book' : type); form.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }, [h('span', { class: 'svc__ic' }, icon(s.icon)), h('b', { text: s.title }), h('span', { class: 'svc__body', text: s.body })])));

  /* ---------- the request form, adapting to its type */
  const seg = segmented(TYPES, type, (t) => setType(t), { label: 'Type of request', full: true });
  const vehicle = field({ label: 'Your car (make and model)', name: 'vehicle' });
  const carList = h('datalist', { id: 'svc-cars' }, [...new Set(stock.queryStock({ tab: 'sale' }).map((c) => c.title))].slice(0, 400).map((t) => h('option', { value: t })));
  vehicle.input.setAttribute('list', 'svc-cars');
  const date = field({ label: 'Preferred day', name: 'date', type: 'date', value: today() });
  date.input.min = today();
  let slot = SLOTS[0];
  const slots = h('div', { class: 'slots', role: 'radiogroup', 'aria-label': 'Time' }, SLOTS.map((s) => h('button', {
    class: 'slot', type: 'button', role: 'radio', 'aria-checked': String(s === slot), text: s,
    onclick: (e) => { slot = s; [...slots.children].forEach((b) => b.setAttribute('aria-checked', String(b === e.currentTarget))); }
  })));
  const issues = chips(ISSUES, { multi: true, label: 'What is wrong' });
  const warning = toggleRow('Warning light is on', 'Tell us which one in the description');
  const drivable = toggleRow('The car is drivable', 'Otherwise we arrange recovery', true);
  const pickup = toggleRow('Collect it from me', 'Pick-up and return to your address');
  const photos = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'sr', id: 'svc-photos' });
  const photoList = h('div', { class: 'thumbs2' });
  photos.addEventListener('change', () => {
    clear(photoList);
    [...photos.files].slice(0, 6).forEach((f) => photoList.append(h('img', { src: URL.createObjectURL(f), alt: f.name })));
  });
  const photoBtn = h('label', { class: 'pill pill--line', for: 'svc-photos' }, [icon('photo'), 'Add photos']);
  const quoteFor = chips(SERVICES.filter((s) => s.id !== 'testdrive').map((s) => ({ id: s.id, label: s.title })), { multi: true, label: 'Quote for' });
  const testCar = field({ label: 'Car to drive', name: 'testcar' });
  testCar.input.setAttribute('list', 'svc-cars');
  const details = field({ label: 'Details', name: 'notes', rows: 4 });
  const name = field({ label: 'Full name', name: 'name', autocomplete: 'name', value: user?.name || '', required: true });
  const phone = field({ label: 'Phone', name: 'phone', type: 'tel', autocomplete: 'tel', inputmode: 'tel', value: user?.phone || '', required: true });
  const email = field({ label: 'Email', name: 'email', type: 'email', autocomplete: 'email', value: user?.email || '' });
  const err = h('p', { class: 'form__err', role: 'alert' });

  const group = (title, kids, cls = '') => h('fieldset', { class: `fgroup ${cls}` }, [h('legend', { text: title }), ...kids]);
  const gRepair = group('What is wrong', [issues.el, warning.el, drivable.el, pickup.el, h('div', { class: 'row-photo' }, [photoBtn, photos, photoList])], 'is-repair');
  const gQuote = group('Quote for', [quoteFor.el], 'is-quote');
  const gWhen = group('When', [h('div', { class: 'row2' }, [date.el]), slots]);
  const gCar = group('Car', [vehicle.el, testCar.el, carList]);
  const gYou = group('Your details', [name.el, h('div', { class: 'row2' }, [phone.el, email.el])]);
  const submit = h('button', { class: 'pill pill--ink pill--lg', type: 'submit' }, [h('span', { class: 'sub-label', text: 'Send request' }), icon('send')]);

  const form = h('form', { class: 'sform', novalidate: true, onsubmit: (e) => { e.preventDefault(); send(); } }, [
    h('div', { class: 'sform__head' }, [h('h2', { text: 'Make a request' }), h('p', { text: 'The team confirms every request by phone.' })]),
    seg.el, gCar, gRepair, gQuote, gWhen, h('fieldset', { class: 'fgroup' }, [h('legend', { text: 'Anything else' }), details.el]), gYou, err, submit
  ]);

  function setType(t) {
    type = t;
    form.dataset.type = t;
    testCar.el.hidden = t !== 'drive';
    vehicle.el.hidden = t === 'drive';
    submit.querySelector('.sub-label').textContent = { book: 'Book the service', repair: 'Request the repair', quote: 'Ask for a quote', drive: 'Book the test drive' }[t];
  }
  setType(type);

  function send() {
    err.textContent = '';
    if (!name.input.value.trim()) { err.textContent = 'Enter your name.'; name.input.focus(); return; }
    if (phone.input.value.replace(/\D/g, '').length < 7) { err.textContent = 'Enter a phone number we can reach you on.'; phone.input.focus(); return; }
    if (type === 'repair' && !issues.values().length && !details.input.value.trim()) { err.textContent = 'Tell us what is wrong: pick an area or describe it.'; return; }
    if (type === 'drive' && !testCar.input.value.trim()) { err.textContent = 'Choose the car you would like to drive.'; testCar.input.focus(); return; }
    const svc = SERVICES.find((s) => s.id === service);
    const kind = { book: svc.title, repair: 'Repair & diagnostics', quote: 'Quote', drive: 'Test drive' }[type];
    const extra = type === 'repair'
      ? [`Areas: ${issues.values().map((v) => ISSUES.find((x) => x.id === v).label).join(', ') || 'not specified'}`, warning.input.checked ? 'Warning light on' : '', drivable.input.checked ? 'Drivable' : 'Not drivable - needs recovery', pickup.input.checked ? 'Collect from customer' : '', photos.files.length ? `${photos.files.length} photo(s) to share` : '']
      : type === 'quote' ? [`Quote for: ${quoteFor.values().map((v) => SERVICES.find((s) => s.id === v).title).join(', ') || 'see details'}`] : [];
    const payload = {
      name: name.input.value.trim(), phone: phone.input.value.trim(), email: email.input.value.trim(), service: kind,
      car: (type === 'drive' ? testCar.input.value : vehicle.input.value).trim(), date: date.input.value, slot,
      notes: [...extra.filter(Boolean), details.input.value.trim()].filter(Boolean).join(' · ')
    };
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    sendRequest('appointment', payload).then((r) => {
      const item = saveAppointment({ ...payload, ref: r.ref, sent: r.sent });
      done(item, kind);
      renderMine();
    }, (e) => { err.textContent = problemText(e); }).finally(() => { submit.disabled = false; form.removeAttribute('aria-busy'); });
  }

  function done(item, kind) {
    const card = h('div', { class: 'sdone' }, [
      h('span', { class: 'sdone__tick' }, icon('check')),
      h('h2', { text: item.sent === false ? 'Request saved' : 'Request sent' }),
      item.sent === false ? h('p', { class: 'sdone__note', text: 'You are offline, so it is kept on this phone and sent to the team automatically when you reconnect.' }) : null,
      h('p', { text: `${kind}${item.car ? ` · ${item.car}` : ''}` }),
      h('p', { class: 'sdone__when', text: `${new Date(`${item.date}T${item.slot}`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · ${item.slot}` }),
      h('p', { class: 'sdone__ref', text: `Reference ${item.ref}` }),
      h('div', { class: 'sdone__actions' }, [
        h('button', { class: 'pill pill--line', type: 'button', text: 'Make another request', onclick: () => { card.replaceWith(form); form.reset(); setType(type); } }),
        h('a', { class: 'pill pill--ink', href: '#/home', text: 'Back home' })
      ])
    ]);
    form.replaceWith(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ---------- talk to someone */
  const cbName = field({ label: 'Name', name: 'cbname', autocomplete: 'name', value: user?.name || '' });
  const cbPhone = field({ label: 'Phone', name: 'cbphone', type: 'tel', autocomplete: 'tel', value: user?.phone || '' });
  const callback = h('form', { class: 'cb', novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    if (!cbName.input.value.trim() || cbPhone.input.value.replace(/\D/g, '').length < 7) { toast('Add your name and a phone number'); return; }
    const payload = { name: cbName.input.value.trim(), phone: cbPhone.input.value.trim(), email: user?.email || '', service: 'Call back from an advisor', car: '', date: today(), slot: 'Today', notes: '' };
    sendRequest('appointment', payload).then((r) => {
      const item = saveAppointment({ ...payload, ref: r.ref, sent: r.sent });
      callback.replaceChildren(h('p', { class: 'cb__ok' }, [icon('done'), r.sent ? `An advisor will call you. Reference ${item.ref}.` : `Saved as ${item.ref}. It is sent to an advisor as soon as you are back online.`]));
      renderMine();
    }, (e2) => toast(problemText(e2)));
  } }, [cbName.el, cbPhone.el, h('button', { class: 'pill pill--ink', type: 'submit' }, [icon('phone'), 'Call me back'])]);
  const talk = h('section', { class: 'talk', 'aria-label': 'Talk to someone' }, [
    h('div', { class: 'sect-head' }, [h('h2', { text: 'Talk to someone' })]),
    h('div', { class: 'talk__grid' }, [
      h('a', { class: 'talk__card talk__card--ai', href: '#/concierge' }, [
        h('span', { class: 'talk__ic' }, icon('spark')),
        h('b', { text: 'AI concierge' }), h('span', { text: 'Instant answers about any car, service or booking — day or night.' }),
        h('span', { class: 'pill pill--signal pill--sm talk__go' }, ['Start a chat', icon('right')])
      ]),
      h('div', { class: 'talk__card' }, [
        h('span', { class: 'talk__ic talk__ic--light' }, icon('headset')),
        h('b', { text: 'Service advisor' }), h('span', { text: 'Leave your number and an advisor calls you back.' }),
        callback
      ])
    ])
  ]);

  /* ---------- your requests */
  const mine = h('section', { class: 'mine', 'aria-label': 'Your requests' });
  function renderMine() {
    clear(mine);
    const list = getAppointments().slice(0, 4);
    if (!list.length) return;
    mine.append(h('div', { class: 'sect-head' }, [h('h2', { text: 'Your requests' })]), h('ul', { class: 'mine__list' }, list.map((a) => h('li', { class: 'mine__row' }, [
      h('span', { class: 'mine__ic' }, icon(/repair/i.test(a.service) ? 'wrench' : /call/i.test(a.service) ? 'phone' : /drive/i.test(a.service) ? 'gauge' : 'calendar')),
      h('span', { class: 'mine__t' }, [h('b', { text: a.service }), h('small', { text: [a.car, a.date, a.slot].filter(Boolean).join(' · ') })]),
      h('span', { class: 'mine__ref', text: a.ref })
    ]))));
  }
  renderMine();

  const dock = mainDock('service');
  root.append(h('main', { class: 'pg' }, [
    h('div', { class: 'hub__glow', 'aria-hidden': 'true' }),
    pageHead({ title: 'Service', sub: 'Bookings, repairs and quotes' }),
    h('section', { class: 'pg__hero' }, [
      h('p', { class: 'eyebrow', text: 'Workshop' }),
      h('h2', { class: 'pg__title', text: 'Looked after, start to finish.' }),
      h('p', { class: 'pg__lede', text: 'Choose a service below or describe what you need. The team confirms every request by phone.' })
    ]),
    h('div', { class: 'sect-head' }, [h('h2', { text: 'Services' })]),
    catalogue, form, talk, mine
  ]));
  return { kind: 'service', destroy() { dock.destroy(); closePanel(); } };
}
