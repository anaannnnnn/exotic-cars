import { h, icon, aed, ago, field, input, textarea, select, toggle, segmented, showFieldErrors, confirmBox, toast, failed, skeleton, errorState, debounce } from '../ui.js';
import { get, post, patch, del, SITE } from '../api.js';
import { uploadPhotos, pickFiles, displayUrl, imgFallback } from '../media.js';
import { KIT_LABEL } from '../../data/catalog.js';

/*
 * Add or edit a wheel or body kit. "Fits these cars" is the list the configurator uses: once saved here it replaces the
 * fitment that came from the supplier's listing.
 */
const CONSTRUCTION = ['', 'Forged', 'Flow formed', 'Cast', 'Multi-piece', 'Carbon'];
const FINISHES = [['#e2e5ea', 'Polished', 1, 0.08], ['#1b1b1d', 'Gloss black', 0.6, 0.18], ['#2a2b2e', 'Satin black', 0.5, 0.45], ['#8d9096', 'Brushed', 0.95, 0.32], ['#3b3d42', 'Gunmetal', 0.85, 0.3], ['#b08d57', 'Bronze', 0.9, 0.3], ['#c9a227', 'Gold', 1, 0.2], ['#d4182c', 'Rosso', 0.4, 0.25]];

let vehicles = null;
async function catalogue() {
  if (vehicles) return vehicles;
  const res = await fetch(`${SITE}data/catalog.json`);
  if (!res.ok) throw new Error('Could not load the vehicle list.');
  const c = await res.json();
  vehicles = c.vehicles.map((v) => ({ id: v.id, make: v.make, model: v.model, generation: v.generation, years: `${v.yearFrom}–${v.yearTo || 'now'}`, direct: v.parts?.direct || [], hay: `${v.make} ${v.model} ${v.generation} ${v.yearFrom}`.toLowerCase() }));
  return vehicles;
}

export async function mountProductEditor(view, { id }, ctx) {
  const isNew = id === 'new';
  view.append(skeleton(10));
  let p = null, vendors = [], cat = [];
  try {
    const [prod, list, vs] = await Promise.all([isNew ? null : get(`admin/products/${encodeURIComponent(id)}`), get('admin/products?limit=1'), catalogue().catch(() => [])]);
    p = prod; vendors = list.vendors || []; cat = vs;
  } catch (e) { view.replaceChildren(errorState(e, () => ctx.reload())); return; }
  view.replaceChildren();
  const base = p || { category: 'wheel', title: '', vendor: '', available: true, images: [], spec: {}, finish: null };
  let category = base.category;

  /* fitment: the product's own list, else what the supplier listing implied */
  const derived = !Array.isArray(base.fits);
  const initialFits = derived ? cat.filter((v) => v.direct.includes(base.id)).map((v) => v.id) : base.fits;
  let fits = [...initialFits];

  const title = h('h1', { class: 'phead__title', text: isNew ? 'Add a product' : base.title });
  view.append(h('header', { class: 'phead phead--editor' }, [
    h('a', { class: 'back', href: '#/products' }, [icon('left'), 'Wheels & kits']),
    h('div', {}, [h('p', { class: 'phead__eyebrow', text: isNew ? 'New product' : `${base.vendor} · ${base.source === 'crm' ? 'added in the CRM' : `from ${base.source}`}` }), title]),
    !isNew ? h('div', { class: 'phead__actions' }, [
      base.url ? h('a', { class: 'btn btn--ghost', href: base.url, target: '_blank', rel: 'noopener noreferrer' }, [icon('external'), h('span', { class: 'hide-sm', text: 'Supplier page' })]) : null,
      h('button', { class: 'btn btn--ghost btn--danger-ghost', type: 'button', onclick: remove }, [icon('trash'), h('span', { class: 'hide-sm', text: 'Delete' })])
    ]) : null
  ]));

  const f = {
    title: input('title', base.title, { required: true, maxlength: 240, placeholder: 'Vossen EVO-5R 21/22" forged wheel set' }),
    vendor: input('vendor', base.vendor, { required: true, maxlength: 60, list: 'crm-vendors', placeholder: 'NOVITEC' }),
    sku: input('sku', base.sku, { maxlength: 80 }),
    priceAED: input('priceAED', base.priceAED, { type: 'number', inputmode: 'numeric', min: 0, step: 50, placeholder: 'Empty = price on request' }),
    url: input('url', base.url, { type: 'url', placeholder: 'https://supplier.ae/product' }),
    fitment: input('fitment', base.fitment, { maxlength: 240, placeholder: 'FERRARI 458 Italia / Spider 2011-2015' }),
    material: input('material', base.material, { maxlength: 60, placeholder: 'Carbon fibre' }),
    subtype: select('subtype', [['', '—'], ...Object.entries(KIT_LABEL)], base.subtype || ''),
    design: input('design', base.design, { maxlength: 60, placeholder: 'NF10' }),
    construction: select('construction', CONSTRUCTION.map((c) => [c, c || '—']), base.construction || '')
  };
  const available = toggle('available', base.available !== false, 'Available in the configurator');
  const centerLock = toggle('centerLock', Boolean(base.centerLock), 'Centre-lock');
  const setToggle = toggle('set', Boolean(base.spec?.set), 'Sold as a set of four');
  const spec = {
    diameter: input('spec.diameter', base.spec?.diameter, { type: 'number', step: 0.5, min: 13, max: 26, placeholder: '—' }),
    diameterRear: input('spec.diameterRear', base.spec?.diameterRear, { type: 'number', step: 0.5, min: 13, max: 26, placeholder: '—' }),
    width: input('spec.width', base.spec?.width, { type: 'number', step: 0.5, min: 4, max: 15, placeholder: '—' }),
    widthRear: input('spec.widthRear', base.spec?.widthRear, { type: 'number', step: 0.5, min: 4, max: 15, placeholder: '—' }),
    et: input('spec.et', base.spec?.et, { type: 'number', step: 1, min: -80, max: 120, placeholder: '—' }),
    pcd: input('spec.pcd', base.spec?.pcd, { maxlength: 20, placeholder: 'e.g. 5x112' }),
    cb: input('spec.cb', base.spec?.cb, { type: 'number', step: 0.1, min: 40, max: 130, placeholder: '—' })
  };

  /* finish (how the configurator paints the wheel) */
  const fin = base.finish || { name: '', color: '#1b1b1d', metalness: 0.6, roughness: 0.2 };
  const finName = input('finish.name', fin.name, { maxlength: 40, placeholder: 'Gloss black' });
  const finColor = h('input', { class: 'inp inp--color', type: 'color', name: 'finish.color', value: fin.color || '#1b1b1d' });
  const finMetal = h('input', { class: 'range', type: 'range', name: 'finish.metalness', min: 0, max: 1, step: 0.01, value: fin.metalness ?? 0.6 });
  const finRough = h('input', { class: 'range', type: 'range', name: 'finish.roughness', min: 0, max: 1, step: 0.01, value: fin.roughness ?? 0.2 });
  const preview = h('span', { class: 'rim' }, [h('span', { class: 'rim__spokes' })]);
  let finishTouched = Boolean(base.finish);
  const paintPreview = () => {
    preview.style.setProperty('--c', finColor.value);
    preview.style.setProperty('--m', finMetal.value);
    preview.style.setProperty('--r', finRough.value);
  };
  [finColor, finMetal, finRough, finName].forEach((el) => el.addEventListener('input', () => { finishTouched = true; paintPreview(); }));
  paintPreview();
  const presets = h('div', { class: 'presets' }, FINISHES.map(([c, n, m, r]) => h('button', { type: 'button', class: 'preset', title: n, 'aria-label': n, style: `--c:${c}`, onclick: () => {
    finColor.value = c; finName.value = n; finMetal.value = m; finRough.value = r; finishTouched = true; paintPreview(); dirty();
  } })));

  /* images */
  let images = [...(base.images || [])];
  const imgGrid = h('div', { class: 'photos photos--sm' });
  function renderImages() {
    imgGrid.replaceChildren(...images.map((u, i) => h('figure', { class: 'photo photo--contain' }, [
      h('img', { src: displayUrl(u), alt: '', loading: 'lazy', onerror: imgFallback }),
      h('figcaption', { class: 'photo__tools' }, [
        i > 0 ? h('button', { type: 'button', 'aria-label': 'Move first', onclick: () => { images.unshift(images.splice(i, 1)[0]); dirty(); renderImages(); } }, icon('star')) : null,
        h('button', { type: 'button', 'aria-label': 'Remove', onclick: () => { images.splice(i, 1); dirty(); renderImages(); } }, icon('trash'))
      ])
    ])), h('button', { class: 'photo photo--add', type: 'button', onclick: () => pickFiles(async (files) => {
      try { await uploadPhotos(files, (url) => { images.push(url); dirty(); renderImages(); }); } catch (e) { failed(e); }
    }) }, [icon('photo'), h('b', { text: 'Upload' })]));
  }
  renderImages();

  /* fits picker */
  const fitChips = h('div', { class: 'fits' });
  const fitSearch = h('input', { class: 'inp inp--search', type: 'search', placeholder: cat.length ? 'Add a car: make, model or year…' : 'Vehicle list unavailable', disabled: !cat.length, 'aria-label': 'Search cars to add' });
  const fitResults = h('ul', { class: 'fitres', role: 'listbox' });
  const byId = new Map(cat.map((v) => [v.id, v]));
  function renderFits() {
    fitChips.replaceChildren(...(fits.length ? fits.map((vid) => {
      const v = byId.get(vid);
      return h('span', { class: 'fit' }, [h('b', { text: v ? `${v.make} ${v.model}` : vid }), v ? h('small', { text: v.years }) : null,
        h('button', { type: 'button', 'aria-label': `Remove ${v ? `${v.make} ${v.model}` : vid}`, onclick: () => { fits = fits.filter((x) => x !== vid); dirty(); renderFits(); } }, icon('close'))]);
    }) : [h('p', { class: 'muted', text: 'Not linked to any car yet: it will not appear in the configurator.' })]));
  }
  fitSearch.addEventListener('input', debounce(() => {
    const terms = fitSearch.value.toLowerCase().split(/\s+/).filter(Boolean);
    fitResults.replaceChildren(...(terms.length ? cat.filter((v) => !fits.includes(v.id) && terms.every((t) => v.hay.includes(t))).slice(0, 8).map((v) => h('li', {}, h('button', { type: 'button', role: 'option', onclick: () => {
      fits.push(v.id); dirty(); renderFits(); fitSearch.value = ''; fitResults.replaceChildren(); fitSearch.focus();
    } }, [h('b', { text: `${v.make} ${v.model}` }), h('small', { text: [v.generation, v.years].filter(Boolean).join(' · ') })]))) : []));
  }, 120));
  renderFits();

  /* layout */
  const catSeg = segmented([['wheel', 'Wheel'], ['kit', 'Body kit']], category, (v) => { category = v; form.dataset.cat = v; dirty(); }, { label: 'Category' });
  const section = (label, sub, ...children) => h('section', { class: 'fsec' }, [h('header', { class: 'fsec__head' }, [h('h2', { text: label }), sub ? h('p', { text: sub }) : null]), ...children]);
  const form = h('form', { class: 'editor', novalidate: true, dataset: { cat: category }, onsubmit: (e) => { e.preventDefault(); save(); } }, [
    h('datalist', { id: 'crm-vendors' }, vendors.map((v) => h('option', { value: v }))),
    h('div', { class: 'editor__main' }, [
      section('Product', null, h('div', { class: 'fgrid' }, [
        h('div', { class: 'fld fld--2', dataset: { name: 'category' } }, [h('span', { class: 'fld__label', text: 'Category' }), catSeg.el, h('small', { class: 'fld__err' })]),
        field('Title', f.title, { span: 2 }), field('Brand', f.vendor), field('SKU / part number', f.sku),
        field('Price (AED)', f.priceAED, { hint: base.priceAED ? `Now ${aed(base.priceAED)}` : null }), field('Supplier link', f.url)
      ])),
      section('Wheel', 'Size and design, and the finish the 3D configurator paints.', h('div', { class: 'only-wheel' }, [
        h('div', { class: 'fgrid fgrid--3' }, [field('Design', f.design), field('Construction', f.construction), h('div', { class: 'fld fld--switch' }, [centerLock, setToggle])]),
        h('div', { class: 'fgrid fgrid--4' }, [field('Diameter ″', spec.diameter), field('Rear ″', spec.diameterRear), field('Width J', spec.width), field('Rear J', spec.widthRear), field('Offset ET', spec.et), field('Bolt pattern', spec.pcd), field('Centre bore mm', spec.cb)]),
        h('div', { class: 'finish' }, [
          preview,
          h('div', { class: 'finish__ctl' }, [
            h('div', { class: 'fgrid' }, [field('Finish name', finName), h('label', { class: 'fld' }, [h('span', { class: 'fld__label', text: 'Colour' }), finColor])]),
            h('label', { class: 'fld' }, [h('span', { class: 'fld__label', text: 'Metal' }), finMetal]),
            h('label', { class: 'fld' }, [h('span', { class: 'fld__label', text: 'Roughness' }), finRough]),
            presets
          ])
        ])
      ])),
      section('Body kit', null, h('div', { class: 'only-kit' }, h('div', { class: 'fgrid' }, [field('Part', f.subtype), field('Material', f.material)]))),
      section('Fits these cars', derived && fits.length ? 'Taken from the supplier’s fitment list. Saving here makes this list the one the configurator uses.' : 'The configurator offers it on these cars.',
        fitChips, h('div', { class: 'fitpick' }, [h('label', { class: 'search' }, [icon('search'), fitSearch]), fitResults]),
        h('div', { class: 'fgrid fgrid--1' }, [field('Fitment text', f.fitment, { hint: 'As the supplier writes it. Used for search.' })]))
    ]),
    h('aside', { class: 'editor__side' }, [
      section('Visibility', null, h('div', { class: 'switches' }, [available])),
      section('Images', null, imgGrid),
      !isNew ? h('p', { class: 'meta', text: base.updatedAt ? `Last saved ${ago(base.updatedAt)}` : 'Imported from the supplier catalogue' }) : null
    ])
  ]);

  const saveBtn = h('button', { class: 'btn btn--primary', type: 'button', onclick: () => save() }, [icon('check'), isNew ? 'Add product' : 'Save changes']);
  const bar = h('div', { class: `savebar${isNew ? ' is-on' : ''}` }, [
    h('span', { class: 'savebar__t', text: isNew ? 'New product' : 'Unsaved changes' }),
    h('button', { class: 'btn btn--ghost', type: 'button', text: isNew ? 'Cancel' : 'Discard', onclick: () => (isNew ? ctx.go('#/products') : ctx.go(`#/products/${encodeURIComponent(base.id)}?r=${Date.now()}`)) }),
    saveBtn
  ]);
  view.append(form, bar);
  function dirty() { bar.classList.add('is-on'); }
  form.addEventListener('input', dirty);
  form.addEventListener('change', dirty);

  const numOrNull = (el) => (el.value.trim() === '' ? null : Number(el.value));
  function values() {
    const out = {
      category,
      title: f.title.value.trim(), vendor: f.vendor.value.trim(), sku: f.sku.value.trim(), url: f.url.value.trim(),
      priceAED: numOrNull(f.priceAED), available: available.querySelector('input').checked, fitment: f.fitment.value.trim(), images
    };
    if (category === 'kit') Object.assign(out, { subtype: f.subtype.value || null, material: f.material.value.trim() });
    else {
      Object.assign(out, {
        design: f.design.value.trim(), construction: f.construction.value || null, centerLock: centerLock.querySelector('input').checked,
        spec: { diameter: numOrNull(spec.diameter), diameterRear: numOrNull(spec.diameterRear), width: numOrNull(spec.width), widthRear: numOrNull(spec.widthRear), et: numOrNull(spec.et), pcd: spec.pcd.value.trim() || null, cb: numOrNull(spec.cb), set: setToggle.querySelector('input').checked }
      });
      if (finishTouched) out.finish = { name: finName.value.trim(), color: finColor.value, metalness: Number(finMetal.value), roughness: Number(finRough.value) };
    }
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
        body.fits = fits;
        const created = await post('admin/products', body);
        toast('Product added');
        ctx.go(`#/products/${encodeURIComponent(created.id)}`);
        return;
      }
      const changes = {};
      for (const [k, x] of Object.entries(v)) {
        if (k === 'spec') { const prev = base.spec || {}; if (Object.entries(x).some(([sk, sv]) => !same(sv, prev[sk]))) changes.spec = x; continue; }
        if (!same(x, base[k])) changes[k] = x;
      }
      if (JSON.stringify(fits) !== JSON.stringify(initialFits) || (!derived && !same(fits, base.fits))) changes.fits = fits;
      if (!Object.keys(changes).length) { bar.classList.remove('is-on'); toast('Nothing to save'); return; }
      const next = await patch(`admin/products/${encodeURIComponent(base.id)}`, changes);
      Object.assign(base, next);
      title.textContent = next.title;
      bar.classList.remove('is-on');
      toast('Saved — the configurator updates within a minute');
    } catch (e) {
      showFieldErrors(form, e.fields);
      failed(e);
    } finally { saveBtn.disabled = false; }
  }

  async function remove() {
    if (!(await confirmBox({ title: 'Delete this product?', body: 'It leaves the configurator. Builds that used it will show it as no longer offered. To pause it, mark it unavailable instead.', ok: 'Delete product', danger: true }))) return;
    try { await del(`admin/products/${encodeURIComponent(base.id)}`); toast('Product deleted'); ctx.go('#/products'); } catch (e) { failed(e); }
  }
}
