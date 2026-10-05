import { h, icon, aed, ago, field, input, textarea, select, toggle, showFieldErrors, confirmBox, toast, failed, skeleton, errorState } from '../ui.js';
import { get, post, patch, del, SITE } from '../api.js';
import { uploadPhotos, pickFiles, displayUrl, carThumb, imgFallback, ownCover } from '../media.js';

/* Add or edit a car. Only the fields that changed are sent, so two people editing different things never clash. */
const BODIES = ['', 'Coupe', 'Convertible', 'SUV', 'Sedan', 'Hatchback', 'Other'];
const GEARS = ['', 'Automatic', 'Manual', 'Electric', 'Hybrid'];
const REGIONS = ['', 'GCC', 'Euro', 'US', 'Japan', 'Others'];
const NUMBERS = new Set(['year', 'km', 'price', 'cylinders', 'doors']);
const FLAGS = ['newArrival', 'featured', 'sold', 'hidden'];

export async function mountCarEditor(view, { id }, ctx) {
  const isNew = id === 'new';
  view.append(skeleton(10));
  let car = null, makes = [];
  try {
    const [c, list] = await Promise.all([isNew ? null : get(`admin/cars/${encodeURIComponent(id)}`), get('admin/cars?limit=1')]);
    car = c;
    makes = list.makes || [];
  } catch (e) {
    view.replaceChildren(errorState(e, () => ctx.reload()));
    return;
  }
  view.replaceChildren();
  const base = car || { title: '', brand: '', year: new Date().getFullYear(), newArrival: true, featured: false, sold: false, hidden: false, gallery: [], cover: null };

  /* ---------- header */
  const title = h('h1', { class: 'phead__title', text: isNew ? 'Add a car' : car.title });
  view.append(h('header', { class: 'phead phead--editor' }, [
    h('a', { class: 'back', href: '#/inventory' }, [icon('left'), 'Inventory']),
    h('div', {}, [h('p', { class: 'phead__eyebrow', text: isNew ? 'New listing' : `Stock #${car.id} · listed ${ago(car.listedAt)}` }), title]),
    !isNew ? h('div', { class: 'phead__actions' }, [
      !car.hidden ? h('a', { class: 'btn btn--ghost', href: `${SITE}#/shop/${car.id}`, target: '_blank', rel: 'noopener' }, [icon('open'), h('span', { class: 'hide-sm', text: 'View on site' })]) : null,
      h('button', { class: 'btn btn--ghost btn--danger-ghost', type: 'button', onclick: remove }, [icon('trash'), h('span', { class: 'hide-sm', text: 'Delete' })])
    ]) : null
  ]));

  /* ---------- form */
  const f = {
    title: input('title', base.title, { required: true, maxlength: 140, placeholder: '2024 Ferrari SF90 Stradale Assetto Fiorano' }),
    brand: input('brand', base.brand, { required: true, maxlength: 40, list: 'crm-makes', placeholder: 'Ferrari' }),
    model: input('model', base.model, { maxlength: 60, placeholder: 'SF90 Stradale' }),
    year: input('year', base.year, { type: 'number', inputmode: 'numeric', min: 1950, max: new Date().getFullYear() + 2, required: true }),
    price: input('price', base.price, { type: 'number', inputmode: 'numeric', min: 0, step: 1000, placeholder: 'Leave empty for “price on request”' }),
    km: input('km', base.km, { type: 'number', inputmode: 'numeric', min: 0, step: 100 }),
    exterior: input('exterior', base.exterior, { maxlength: 40, placeholder: 'Rosso Corsa' }),
    interior: input('interior', base.interior, { maxlength: 40, placeholder: 'Nero leather' }),
    body: select('body', BODIES.map((b) => [b, b || '—']), base.body || ''),
    transmission: select('transmission', GEARS.map((b) => [b, b || '—']), base.transmission || ''),
    engine: input('engine', base.engine, { maxlength: 40, placeholder: '4.0L V8 twin-turbo hybrid' }),
    hp: input('hp', base.hp, { maxlength: 40, placeholder: '986 hp' }),
    cylinders: input('cylinders', base.cylinders, { type: 'number', inputmode: 'numeric', min: 0, max: 16 }),
    doors: input('doors', base.doors, { type: 'number', inputmode: 'numeric', min: 0, max: 6 }),
    region: select('region', REGIONS.map((b) => [b, b || '—']), base.region || ''),
    warranty: input('warranty', base.warranty, { maxlength: 60, placeholder: 'Dealer warranty until 2027' }),
    subtitle: input('subtitle', base.subtitle, { maxlength: 140, placeholder: 'One line under the title' }),
    description: textarea('description', base.description, { maxlength: 20000, rows: 7, placeholder: 'History, options, service record…' }),
    video: input('video', base.video, { type: 'url', placeholder: 'https://youtube.com/…' }),
    url: input('url', base.url, { type: 'url', placeholder: 'https://exoticcars.ae/…' })
  };
  const flags = Object.fromEntries(FLAGS.map((k) => [k, toggle(k, base[k], { newArrival: 'New arrival', featured: 'Featured on the home page', sold: 'Sold', hidden: 'Hidden from the website' }[k])]));
  const priceHint = h('small', { class: 'fld__hint', text: base.price ? aed(base.price) : 'Shown as “Price on request”' });
  f.price.addEventListener('input', () => { priceHint.textContent = f.price.value ? aed(Number(f.price.value)) : 'Shown as “Price on request”'; });

  /* ---------- photos */
  let photos = [...new Set([base.cover, ...(base.gallery || [])].filter(Boolean))];
  const photoGrid = h('div', { class: 'photos' });
  const linkInput = input('photo-link', '', { type: 'url', placeholder: 'https://… photo link' });
  function renderPhotos() {
    photoGrid.replaceChildren(...photos.map((u, i) => h('figure', { class: `photo${i === 0 ? ' is-cover' : ''}` }, [
      h('img', { src: i === 0 && car && !ownCover(car) && u === car.cover ? carThumb(car) : displayUrl(u), alt: '', loading: 'lazy', onerror: imgFallback }),
      i === 0 ? h('span', { class: 'photo__badge', text: 'Cover' }) : null,
      h('figcaption', { class: 'photo__tools' }, [
        i > 0 ? h('button', { type: 'button', title: 'Make cover', 'aria-label': 'Make this the cover photo', onclick: () => { photos.unshift(photos.splice(i, 1)[0]); dirty(); renderPhotos(); } }, icon('star')) : null,
        i > 0 ? h('button', { type: 'button', title: 'Move left', 'aria-label': 'Move left', onclick: () => { [photos[i - 1], photos[i]] = [photos[i], photos[i - 1]]; dirty(); renderPhotos(); } }, icon('left')) : null,
        i < photos.length - 1 ? h('button', { type: 'button', title: 'Move right', 'aria-label': 'Move right', onclick: () => { [photos[i + 1], photos[i]] = [photos[i], photos[i + 1]]; dirty(); renderPhotos(); } }, icon('right')) : null,
        h('button', { type: 'button', title: 'Remove', 'aria-label': 'Remove photo', onclick: () => { photos.splice(i, 1); dirty(); renderPhotos(); } }, icon('trash'))
      ])
    ])), h('button', { class: 'photo photo--add', type: 'button', onclick: () => pickFiles(upload) }, [icon('photo'), h('b', { text: 'Upload photos' }), h('small', { text: 'JPEG, PNG, WebP, HEIC · resized for the web' })]));
  }
  async function upload(files) {
    const pending = files.map(() => h('div', { class: 'photo photo--busy' }, h('span', { class: 'spinner' })));
    photoGrid.lastChild.before(...pending);
    try {
      await uploadPhotos(files, (url) => { photos.push(url); pending.shift()?.remove(); dirty(); });
      renderPhotos();
      toast(`${files.length} photo${files.length > 1 ? 's' : ''} uploaded`);
    } catch (e) { failed(e); renderPhotos(); }
  }
  photoGrid.addEventListener('dragover', (e) => { e.preventDefault(); photoGrid.classList.add('is-drop'); });
  photoGrid.addEventListener('dragleave', () => photoGrid.classList.remove('is-drop'));
  photoGrid.addEventListener('drop', (e) => { e.preventDefault(); photoGrid.classList.remove('is-drop'); const files = [...(e.dataTransfer?.files || [])].filter((x) => x.type.startsWith('image/')); if (files.length) upload(files); });
  renderPhotos();

  const section = (label, sub, ...children) => h('section', { class: 'fsec' }, [h('header', { class: 'fsec__head' }, [h('h2', { text: label }), sub ? h('p', { text: sub }) : null]), ...children]);
  const form = h('form', { class: 'editor', novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } }, [
    h('datalist', { id: 'crm-makes' }, makes.map((m) => h('option', { value: m }))),
    h('div', { class: 'editor__main' }, [
      section('The car', null, h('div', { class: 'fgrid' }, [
        field('Title', f.title, { span: 2, hint: 'As buyers search for it: year, make, model, edition.' }),
        field('Make', f.brand), field('Model', f.model), field('Year', f.year),
        h('label', { class: 'fld', dataset: { name: 'price' } }, [h('span', { class: 'fld__label', text: 'Price (AED)' }), f.price, priceHint, h('small', { class: 'fld__err' })]),
        field('Mileage (km)', f.km), field('Exterior', f.exterior), field('Interior', f.interior)
      ])),
      section('Specification', null, h('div', { class: 'fgrid fgrid--3' }, [
        field('Body', f.body), field('Transmission', f.transmission), field('Specs', f.region),
        field('Engine', f.engine), field('Power', f.hp), field('Cylinders', f.cylinders), field('Doors', f.doors),
        field('Warranty', f.warranty, { span: 2 })
      ])),
      section('Description', 'Shown on the car’s page.', h('div', { class: 'fgrid' }, [field('Subtitle', f.subtitle, { span: 2 }), field('Description', f.description, { span: 2 })])),
      section('Photos', 'The first photo is the cover on the website. Drop files here, or add a link.', photoGrid,
        h('div', { class: 'linkadd' }, [linkInput, h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => {
          const v = linkInput.value.trim();
          if (!/^https:\/\/\S+$/i.test(v)) { toast('Use an https:// link to a photo', 'error'); return; }
          photos.push(v); linkInput.value = ''; dirty(); renderPhotos();
        } }, [icon('plus'), 'Add link'])]))
    ]),
    h('aside', { class: 'editor__side' }, [
      section('On the website', null, h('div', { class: 'switches' }, Object.values(flags))),
      section('Links', null, h('div', { class: 'fgrid fgrid--1' }, [field('Video', f.video), field('Original listing', f.url)])),
      !isNew ? h('p', { class: 'meta', text: `Last saved ${ago(car.updatedAt || car.listedAt)}` }) : null
    ])
  ]);

  /* ---------- save bar */
  const saveBtn = h('button', { class: 'btn btn--primary', type: 'button', onclick: () => save() }, [icon('check'), isNew ? 'Add to inventory' : 'Save changes']);
  const bar = h('div', { class: `savebar${isNew ? ' is-on' : ''}` }, [
    h('span', { class: 'savebar__t', text: isNew ? 'New car' : 'Unsaved changes' }),
    h('button', { class: 'btn btn--ghost', type: 'button', text: isNew ? 'Cancel' : 'Discard', onclick: () => (isNew ? ctx.go('#/inventory') : ctx.go(`#/inventory/${car.id}?r=${Date.now()}`)) }),
    saveBtn
  ]);
  view.append(form, bar);
  function dirty() { bar.classList.add('is-on'); }
  form.addEventListener('input', dirty);
  form.addEventListener('change', dirty);

  function values() {
    const out = {};
    for (const [k, el] of Object.entries(f)) {
      const v = el.value.trim();
      out[k] = NUMBERS.has(k) ? (v === '' ? null : Number(v)) : v;
    }
    for (const k of FLAGS) out[k] = flags[k].querySelector('input').checked;
    out.cover = photos[0] || null;
    out.gallery = photos.slice(1);
    return out;
  }
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null) || ((a ?? '') === '' && (b ?? '') === '');

  async function save() {
    const v = values();
    showFieldErrors(form, null);
    saveBtn.disabled = true;
    try {
      if (isNew) {
        const body = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '' && x !== null));
        const created = await post('admin/cars', body);
        toast(`${created.title} added`);
        ctx.go(`#/inventory/${created.id}`);
        return;
      }
      const prev = { ...car, gallery: car.gallery || [] };
      const prevPhotos = [...new Set([car.cover, ...(car.gallery || [])].filter(Boolean))];
      const changes = {};
      for (const [k, x] of Object.entries(v)) {
        if (k === 'cover' || k === 'gallery') continue;
        if (!same(x, prev[k])) changes[k] = x;
      }
      if (JSON.stringify(prevPhotos) !== JSON.stringify(photos)) { changes.cover = v.cover; changes.gallery = v.gallery; }
      if (!Object.keys(changes).length) { bar.classList.remove('is-on'); toast('Nothing to save'); return; }
      car = await patch(`admin/cars/${car.id}`, changes);
      title.textContent = car.title;
      bar.classList.remove('is-on');
      toast('Saved — live on the site within a minute');
    } catch (e) {
      showFieldErrors(form, e.fields);
      failed(e);
    } finally { saveBtn.disabled = false; }
  }

  async function remove() {
    if (!(await confirmBox({ title: `Delete ${car.title}?`, body: 'It disappears from the website and the inventory. To keep it but take it off the site, hide it instead.', ok: 'Delete car', danger: true }))) return;
    try { await del(`admin/cars/${car.id}`); toast('Car deleted'); ctx.go('#/inventory'); } catch (e) { failed(e); }
  }
}
