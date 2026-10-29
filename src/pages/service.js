import * as stock from '../data/stock.js';
import { h, icon, clear } from '../ui/dom.js';
import { closePanel, openCall, openEnquiry } from '../ui/panels.js';
import * as svc from '../data/service.js';
import { openJob, stepLabel, progress } from '../ui/jobsheet.js';
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
/* what each service includes and how long it takes (the workshop's own words) */
const MORE = {
  maintenance: { time: 'Same day to 2 days', inc: ['Manufacturer-schedule servicing', 'Fluids, filters and brakes checked', 'A full digital health check'] },
  repair: { time: 'Diagnosed within 24 hours', inc: ['The fault found and explained first', 'A written quote you approve in the app', 'Parts and labour warranty on the repair'] },
  protection: { time: '2 to 5 days', inc: ['Paint protection film or ceramic coating', 'Paint correction first', 'Care guide and an aftercare check'] },
  detailing: { time: 'Same day', inc: ['Hand wash and decontamination', 'Interior deep clean and leather care', 'Optional paint correction'] },
  wheels: { time: '1 to 3 days', inc: ['Forged wheels, tyres and carbon aero', 'Fitted, balanced and aligned', 'Fitment checked against your exact car'] },
  tint: { time: 'Same day', inc: ['Heat-rejecting film in road-legal shades', 'Clean installation, no edge lift'] },
  inspection: { time: 'Same day', inc: ['A detailed inspection report', 'A valuation for sale or part-exchange'] },
  testdrive: { time: 'Any day, by appointment', inc: ['Drive any car in stock', 'An advisor with you if you like'] }
};
/* what happens after you buy, and what it gives you */
const JOURNEY = [
  { ic: 'key', t: 'Hand-over to your garage', b: 'On delivery you get a garage code. Add it in the app and the car, its warranty and its next service date are waiting for you.' },
  { ic: 'shield', t: 'A care plan, if you want one', b: 'Essential, Complete or Concierge: servicing, collection and priority slots, arranged once and looked after.' },
  { ic: 'calendar', t: 'Book or report in a minute', b: 'Book a service or report a problem for the right car, with photos, from your phone.' },
  { ic: 'inspect', t: 'Follow every step', b: 'Checked in, inspected, quoted, in work, ready. Each step appears on your phone as it happens.' },
  { ic: 'check', t: 'You approve the quote', b: 'The written quote arrives in the app. Nothing more is done to the car until you say yes.' },
  { ic: 'year', t: 'A history that follows the car', b: 'Every visit is kept in your garage. A full service history helps the car’s value when you sell.' }
];
const PLANS = [
  { id: 'essential', t: 'Essential care', b: 'The first year, looked after.', inc: ['Scheduled service at the manufacturer interval', 'A digital health check at every visit', 'Service reminders in the app'] },
  { id: 'complete', t: 'Complete care', b: 'Everything in Essential, plus what keeps a supercar at its best.', inc: ['Everything in Essential', 'Collection and return', 'A courtesy car on longer jobs', 'A paint protection check every visit'], pop: true },
  { id: 'concierge', t: 'Concierge ownership', b: 'One number for everything the car needs.', inc: ['Everything in Complete', 'Priority workshop slots', '24/7 recovery arranged for you', 'Detailing before every hand-back'] }
];
const BENEFITS = [
  { ic: 'truck', t: 'Collection and return', b: 'We collect from your home or office and bring the car back.' },
  { ic: 'car', t: 'Courtesy car', b: 'Ask for one when you book a longer job.' },
  { ic: 'shield', t: 'Warranty handled', b: 'Cars bought here carry their warranty in your garage, and we deal with the claim.' },
  { ic: 'drops', t: 'Genuine parts', b: 'Parts matched to your exact car, with the price quoted before work.' },
  { ic: 'phone', t: 'One call or message', b: 'Phone, WhatsApp or the concierge. A person answers.' },
  { ic: 'done', t: 'No surprises', b: 'A written quote, your approval, then the work. Never the other way round.' }
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
  let type = 'book', service = 'maintenance', ownedId = '', garageCars = [];


  /* ---------- after the sale: the journey ---------- */
  const journey = h('section', { class: 'journey', 'aria-label': 'What happens after you buy' }, [
    h('div', { class: 'sect-head' }, [h('h2', { text: 'After you buy' })]),
    h('ol', { class: 'journey__rail' }, JOURNEY.map((j, i) => h('li', { class: 'jstep rv', style: `--i:${i}` }, [h('span', { class: 'jstep__ic' }, icon(j.ic)), h('b', { text: j.t }), h('span', { text: j.b })])))
  ]);

  /* ---------- your garage ---------- */
  const garageEl = h('section', { class: 'garage', 'aria-label': 'Your garage' });
  const jobsEl = h('section', { class: 'jobs', 'aria-label': 'Your jobs and tracking' });
  let myJobs = [];
  const dayMs = 864e5;
  const dLeft = (ymd) => Math.round((new Date(`${ymd}T12:00:00`) - Date.now()) / dayMs);
  const rel = (d) => (d < 0 ? `${-d} day${-d === 1 ? '' : 's'} overdue` : d === 0 ? 'today' : d < 45 ? `in ${d} day${d === 1 ? '' : 's'}` : `in ${Math.round(d / 30)} months`);
  const fmt = (ymd) => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  const head = (t, extra) => h('div', { class: 'sect-head' }, [h('h2', { text: t }), extra || null]);

  function claimCard() {
    const code = h('input', { class: 'ff__input claim__in', type: 'text', placeholder: 'GK-XXXXX', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Garage code' });
    const msg = h('p', { class: 'form__err', role: 'alert' });
    return h('form', { class: 'claim', novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); msg.textContent = '';
      if (code.value.trim().length < 6) { msg.textContent = 'Enter the code from your hand-over sheet.'; return; }
      try { await svc.claim(code.value.trim()); toast('Car added to your garage'); renderGarage(); } catch (err) { msg.textContent = err.message; }
    } }, [h('span', { class: 'claim__ic' }, icon('key')), h('div', { class: 'claim__t' }, [h('b', { text: 'Bought a car from us?' }), h('small', { text: 'Enter the garage code from your hand-over sheet.' })]), h('div', { class: 'claim__row' }, [code, h('button', { class: 'pill pill--ink', type: 'submit' }, 'Add')]), msg]);
  }

  function garageCard(o) {
    const car = o.carId ? stock.stockCar(o.carId) : null;
    const img = car ? stock.coverUrl(car) : o.cover;
    const chips = [];
    if (o.warranty?.until) { const d = dLeft(o.warranty.until); chips.push(h('span', { class: `gchip ${d < 0 ? 'gchip--bad' : d < 90 ? 'gchip--warn' : 'gchip--ok'}` }, [icon('shield'), d < 0 ? `Warranty ended ${fmt(o.warranty.until)}` : `Warranty to ${fmt(o.warranty.until)}`])); }
    if (o.nextService?.date) { const d = dLeft(o.nextService.date); chips.push(h('span', { class: `gchip ${d < 0 ? 'gchip--bad' : d < 30 ? 'gchip--warn' : ''}` }, [icon('wrench'), `Next service ${rel(d)}`])); }
    const active = myJobs.find((j) => !['delivered', 'cancelled'].includes(j.status) && (j.vehicle || '').toLowerCase().includes((o.model || o.title || '').toLowerCase().split(' ')[0]));
    const hist = h('ul', { class: 'ghist', hidden: true }, (o.jobs?.length ? o.jobs : []).filter((j) => j.status === 'delivered').map((j) => h('li', {}, [h('span', { text: j.title }), h('small', { text: new Date(j.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) })])));
    if (!hist.children.length) hist.append(h('li', {}, [h('span', { class: 'muted', text: 'No visits yet. Your first service will appear here.' })]));
    const plan = o.plan ? { essential: 'Essential care', complete: 'Complete care', concierge: 'Concierge ownership' }[o.plan] : null;
    return h('article', { class: 'gcar rv' }, [
      h('div', { class: 'gcar__img' }, [img ? h('img', { src: img, alt: '', loading: 'lazy', onerror: car ? stock.coverError(car) : null }) : null]),
      h('div', { class: 'gcar__body' }, [
        h('h3', { text: o.title }), h('p', { class: 'muted', text: [o.year, o.colour, o.plate].filter(Boolean).join(' · ') }),
        h('div', { class: 'gcar__chips' }, [...chips, plan ? h('span', { class: 'gchip' }, [icon('spark'), plan]) : null].filter(Boolean)),
        active ? h('button', { class: 'gcar__job', type: 'button', onclick: () => openJob(active, { onChange: renderGarage }) }, [h('span', { class: 'gcar__jd', 'aria-hidden': 'true' }), h('span', {}, [h('b', { text: active.title }), h('small', { text: stepLabel(active.status) })]), icon('right')]) : null,
        h('div', { class: 'gcar__act' }, [
          h('button', { class: 'pill pill--ink pill--sm', type: 'button', onclick: () => useCar(o, 'book') }, [icon('calendar'), 'Book a service']),
          h('button', { class: 'pill pill--line pill--sm', type: 'button', onclick: () => useCar(o, 'repair') }, [icon('wrench'), 'Report a problem']),
          h('button', { class: 'pill pill--line pill--sm', type: 'button', 'aria-expanded': 'false', onclick: (e) => { hist.hidden = !hist.hidden; e.currentTarget.setAttribute('aria-expanded', String(!hist.hidden)); } }, [icon('clock'), `History (${(o.jobs || []).filter((j) => j.status === 'delivered').length})`])
        ]),
        hist
      ])
    ]);
  }
  function useCar(o, t) {
    garageCars = garageCars.length ? garageCars : [];
    garageSelect.value = o.id; ownedId = o.id; vehicle.input.value = o.title;
    seg.select(t); setType(t);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function renderGarage() {
    const u = getUser();
    if (!u) { garageEl.replaceChildren(head('Your garage'), h('a', { class: 'ghost-card', href: '#/account' }, [h('span', { class: 'claim__ic' }, icon('key')), h('div', { class: 'claim__t' }, [h('b', { text: 'Sign in to see your garage' }), h('small', { text: 'Your car, its warranty, its service history and every job in one place.' })]), icon('right')])); jobsEl.replaceChildren(trackCard()); return; }
    let cars = null, list = null;
    try { [cars, list] = await Promise.all([svc.garage(), svc.jobs()]); } catch { /* shown below as unreachable */ }
    myJobs = list || [];
    if (cars === null) { garageEl.replaceChildren(head('Your garage'), h('a', { class: 'ghost-card', href: '#/account' }, [h('span', { class: 'claim__ic' }, icon('key')), h('div', { class: 'claim__t' }, [h('b', { text: 'Sign in again to see your garage' }), h('small', { text: 'Your garage and jobs are kept with your online account.' })]), icon('right')])); jobsEl.replaceChildren(trackCard()); return; }
    garageCars = cars;
    garageSelect.replaceChildren(h('option', { value: '', text: 'Another car' }), ...cars.map((c) => h('option', { value: c.id, text: c.title })));
    garageSelect.hidden = !cars.length;
    garageEl.replaceChildren(head('Your garage', cars.length ? h('span', { class: 'sect-head__note', text: `${cars.length} car${cars.length === 1 ? '' : 's'}` }) : null), ...(cars.length ? cars.map(garageCard) : []), claimCard());
    renderJobs();
  }

  /* ---------- jobs: yours, and a way to follow any job by its reference ---------- */
  function jobRow(j) {
    return h('button', { class: 'jrow', type: 'button', onclick: () => openJob(j, { onChange: (n) => { Object.assign(j, n); renderJobs(); } }) }, [
      h('span', { class: 'jrow__ic' }, icon(/repair/i.test(j.title) ? 'wrench' : 'calendar')),
      h('span', { class: 'jrow__t' }, [h('b', { text: j.title }), h('small', { text: [j.vehicle, j.ref].filter(Boolean).join(' · ') })]),
      h('span', { class: 'jrow__s' }, [h('span', { class: `jpill jpill--${j.status}`, text: stepLabel(j.status) }), j.quote?.status === 'pending' ? h('small', { class: 'jrow__act', text: 'Your answer is needed' }) : null]),
      h('span', { class: 'jrow__bar', 'aria-hidden': 'true' }, h('i', { style: `--p:${progress(j)}` }))
    ]);
  }
  function trackCard() {
    const ref = h('input', { class: 'ff__input', type: 'text', placeholder: 'Reference (AA-XXXXXX)', autocomplete: 'off', autocapitalize: 'characters', 'aria-label': 'Job reference' });
    const ph = h('input', { class: 'ff__input', type: 'tel', inputmode: 'numeric', maxlength: 4, placeholder: 'Last 4 of your phone', 'aria-label': 'Last four digits of the phone number' });
    const msg = h('p', { class: 'form__err', role: 'alert' });
    return h('form', { class: 'track', novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); msg.textContent = '';
      if (ref.value.trim().length < 4 || ph.value.replace(/\D/g, '').length < 3) { msg.textContent = 'Enter the reference and the last four digits of your phone number.'; return; }
      try { const job = await svc.track(ref.value.trim(), ph.value.trim()); openJob(job, { guest: { ref: ref.value.trim(), phone: ph.value.trim() } }); } catch (err) { msg.textContent = err.message; }
    } }, [h('div', { class: 'claim__t' }, [h('b', { text: 'Follow a job' }), h('small', { text: 'With the reference we gave you and the last four digits of your phone number.' })]), h('div', { class: 'claim__row' }, [ref, ph, h('button', { class: 'pill pill--ink', type: 'submit' }, 'Track')]), msg]);
  }
  function renderJobs() {
    const open = myJobs.filter((j) => !['delivered', 'cancelled'].includes(j.status)), done = myJobs.filter((j) => ['delivered', 'cancelled'].includes(j.status)).slice(0, 3);
    jobsEl.replaceChildren(head('Your jobs'), ...(myJobs.length ? [h('div', { class: 'jlist' }, [...open, ...done].map(jobRow))] : [h('p', { class: 'pg__note', text: 'No jobs yet. When you book a service or report a problem, you can follow it here.' })]), trackCard());
  }

  /* ---------- care plans and benefits ---------- */
  const plans = h('section', { class: 'plans', 'aria-label': 'Care plans' }, [
    head('Care plans'),
    h('div', { class: 'plans__grid' }, PLANS.map((p, i) => h('article', { class: `plan rv${p.pop ? ' plan--pop' : ''}`, style: `--i:${i}` }, [
      p.pop ? h('span', { class: 'plan__tag', text: 'Most chosen' }) : null, h('h3', { text: p.t }), h('p', { class: 'plan__b', text: p.b }),
      h('ul', {}, p.inc.map((x) => h('li', {}, [icon('check'), x]))),
      h('button', { class: `pill ${p.pop ? 'pill--signal' : 'pill--ink'}`, type: 'button', onclick: () => openEnquiry({ title: p.t, sub: 'An advisor will call you with what it covers and what it costs for your car.', type: 'general', source: 'care-plan', message: `I would like to know about the ${p.t} plan.` }) }, ['Ask about this plan', icon('right')])
    ])))
  ]);
  const benefits = h('section', { class: 'benefits', 'aria-label': 'Why service with us' }, [head('Why service with us'), h('div', { class: 'benefits__grid' }, BENEFITS.map((b, i) => h('div', { class: 'benefit rv', style: `--i:${i}` }, [h('span', { class: 'benefit__ic' }, icon(b.ic)), h('b', { text: b.t }), h('span', { text: b.b })])))]);

  /* ---------- catalogue */
  const catalogue = h('div', { class: 'svc-grid' }, SERVICES.map((s, i) => h('button', {
    class: 'svc', type: 'button', style: `--i:${i}`, 'aria-pressed': String(s.id === service), 'data-tip': s.title, 'data-tip-desc': 'Choose this service',
    onclick: () => { service = s.id; [...catalogue.children].forEach((b, j) => b.setAttribute('aria-pressed', String(SERVICES[j].id === s.id))); seg.select(s.id === 'repair' ? 'repair' : s.id === 'testdrive' ? 'drive' : type === 'repair' || type === 'drive' ? 'book' : type); setType(s.id === 'repair' ? 'repair' : s.id === 'testdrive' ? 'drive' : type === 'repair' || type === 'drive' ? 'book' : type); form.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }, [h('span', { class: 'svc__ic' }, icon(s.icon)), h('b', { text: s.title }), h('span', { class: 'svc__body', text: s.body }), h('span', { class: 'svc__time' }, [icon('clock'), MORE[s.id].time]), h('ul', { class: 'svc__inc' }, MORE[s.id].inc.map((x) => h('li', { text: x })))])));

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
  const pickupAddr = field({ label: 'Where should we collect it?', name: 'pickupaddr', autocomplete: 'street-address' });
  pickupAddr.el.hidden = true;
  pickup.input.addEventListener('change', () => { pickupAddr.el.hidden = !pickup.input.checked; });
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
  const gRepair = group('What is wrong', [issues.el, warning.el, drivable.el, pickup.el, pickupAddr.el, h('div', { class: 'row-photo' }, [photoBtn, photos, photoList])], 'is-repair');
  const gQuote = group('Quote for', [quoteFor.el], 'is-quote');
  const gWhen = group('When', [h('div', { class: 'row2' }, [date.el]), slots]);
  const garageSelect = h('select', { class: 'sel-garage', 'aria-label': 'One of your cars', hidden: true, onchange: () => { const o = garageCars.find((c) => c.id === garageSelect.value); ownedId = o ? o.id : ''; if (o) vehicle.input.value = o.title; } }, [h('option', { value: '', text: 'Another car' })]);
  const gCar = group('Car', [garageSelect, vehicle.el, testCar.el, carList]);
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
      ownedId: type === 'drive' || !ownedId ? undefined : ownedId, pickupAddress: type === 'repair' && pickup.input.checked && pickupAddr.input.value.trim() ? pickupAddr.input.value.trim() : undefined,
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
      h('p', { class: 'pg__lede', text: 'From the day you collect the car: your garage, every job tracked on your phone, quotes you approve in the app, and a service history that follows the car.' })
    ]),
    journey, garageEl, jobsEl,
    h('div', { class: 'sect-head' }, [h('h2', { text: 'Services' })]),
    catalogue, plans, benefits, form, talk, mine
  ]));
  renderGarage();
  return { kind: 'service', destroy() { dock.destroy(); closePanel(); } };
}
