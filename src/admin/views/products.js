import { h, icon, aed, num, chip, debounce, segmented, select, skeleton, empty, errorState, toast, failed } from '../ui.js';
import { get, patch, qs, exportUrl } from '../api.js';
import { displayUrl, imgFallback } from '../media.js';
import { KIT_LABEL } from '../../data/catalog.js';

/* Wheels and body kits offered in the 3D configurator: prices, availability, and which cars they fit. */
const SORTS = [['newest', 'Recently edited'], ['price', 'Highest price'], ['cheapest', 'Lowest price'], ['title', 'A–Z']];
const PAGE = 40;

export function mountProducts(view) {
  const state = { q: '', category: '', status: '', sort: 'newest', offset: 0 };
  const count = h('span', { class: 'phead__count' });
  view.append(h('header', { class: 'phead' }, [
    h('div', {}, [h('p', { class: 'phead__eyebrow', text: 'Configurator catalogue' }), h('h1', { class: 'phead__title' }, ['Wheels & kits ', count])]),
    h('div', { class: 'phead__actions' }, [
      h('a', { class: 'btn btn--ghost', href: exportUrl('products'), download: '' }, [icon('download'), h('span', { class: 'hide-sm', text: 'Export' })]),
      h('a', { class: 'btn btn--primary', href: '#/products/new' }, [icon('plus'), 'Add a product'])
    ])
  ]));

  const search = h('input', { class: 'inp inp--search', type: 'search', placeholder: 'Search brand, design, SKU, car…', 'aria-label': 'Search products' });
  const status = select('status', [['', 'Any availability'], ['available', 'Available'], ['unavailable', 'Unavailable']], '', { 'aria-label': 'Availability' });
  const sort = select('sort', SORTS, state.sort, { 'aria-label': 'Sort' });
  const seg = segmented([['', 'All'], ['wheel', 'Wheels'], ['kit', 'Body kits']], '', (v) => { state.category = v; reload(); }, { label: 'Category' });
  view.append(h('div', { class: 'toolbar' }, [
    h('label', { class: 'search' }, [icon('search'), search]),
    h('div', { class: 'toolbar__row' }, [status, sort]),
    h('div', { class: 'toolbar__seg' }, seg.el)
  ]));
  const list = h('div', { class: 'rows' });
  const more = h('button', { class: 'btn btn--ghost btn--block', type: 'button', hidden: true, onclick: () => load(true) }, 'Show more');
  view.append(list, more);

  search.addEventListener('input', debounce(() => { state.q = search.value.trim(); reload(); }, 280));
  status.addEventListener('change', () => { state.status = status.value; reload(); });
  sort.addEventListener('change', () => { state.sort = sort.value; reload(); });

  let token = 0;
  function reload() { state.offset = 0; load(false); }
  async function load(append) {
    const my = ++token;
    if (!append) list.replaceChildren(skeleton(8));
    let res;
    try { res = await get(`admin/products${qs({ q: state.q, category: state.category, status: state.status, sort: state.sort, limit: PAGE, offset: append ? state.offset : 0 })}`); } catch (e) { list.replaceChildren(errorState(e, reload)); return; }
    if (my !== token) return;
    if (!append) list.replaceChildren();
    count.textContent = num(res.pagination.total);
    if (!res.imported) { list.replaceChildren(empty('Nothing imported yet', 'Open Settings and import the catalogue, or add your first product.', h('a', { class: 'btn btn--primary', href: '#/settings' }, 'Go to Settings'))); more.hidden = true; return; }
    if (!res.data.length && !append) list.replaceChildren(empty('No products match', 'Try another search or filter.'));
    res.data.forEach((p) => list.append(row(p)));
    state.offset = (append ? state.offset : 0) + res.data.length;
    more.hidden = res.pagination.next == null;
  }

  function row(p) {
    const el = h('article', { class: `row${p.available === false ? ' is-muted' : ''}` });
    const href = `#/products/${encodeURIComponent(p.id)}`;
    const img = p.images?.[0];
    const avail = h('button', { class: `qbtn${p.available !== false ? ' is-on' : ''}`, type: 'button', title: p.available !== false ? 'Available (tap to mark unavailable)' : 'Unavailable (tap to make available)', 'aria-pressed': String(p.available !== false), 'aria-label': 'Available in the configurator' }, icon(p.available !== false ? 'eye' : 'eyeoff'));
    avail.addEventListener('click', async () => {
      avail.disabled = true;
      try {
        Object.assign(p, await patch(`admin/products/${encodeURIComponent(p.id)}`, { available: p.available === false }));
        el.replaceWith(row(p));
        toast(p.available ? 'Back in the configurator' : 'Removed from the configurator');
      } catch (e) { failed(e); avail.disabled = false; }
    });
    el.append(
      h('a', { class: 'row__main', href }, [
        h('span', { class: `row__img row__img--contain${img ? '' : ' is-glyph'}` }, img ? h('img', { src: displayUrl(img), alt: '', loading: 'lazy', onerror: imgFallback }) : (p.finish?.color ? h('span', { class: 'swatch', style: `--c:${p.finish.color}` }) : icon(p.category === 'wheel' ? 'wheel' : 'kit'))),
        h('span', { class: 'row__t' }, [
          h('b', { text: p.title }),
          h('small', { text: [p.vendor, p.sku, p.fitment].filter(Boolean).join(' · ') }),
          h('span', { class: 'row__chips' }, [
            chip(p.category === 'wheel' ? 'Wheel' : KIT_LABEL[p.subtype] || 'Body kit', p.category === 'wheel' ? 'blue' : 'violet'),
            p.available === false ? chip('Unavailable', 'grey') : null,
            p.source === 'crm' ? chip('Added in CRM', 'red') : null,
            Array.isArray(p.fits) ? chip(`Fits ${p.fits.length} car${p.fits.length === 1 ? '' : 's'}`) : null
          ])
        ]),
        h('span', { class: 'row__price' }, [h('b', { text: p.priceAED ? aed(p.priceAED) : 'On request' }), h('small', { text: p.spec?.diameter ? `${p.spec.diameter}${p.spec.diameterRear && p.spec.diameterRear !== p.spec.diameter ? `/${p.spec.diameterRear}` : ''}″` : p.material || '' })])
      ]),
      h('div', { class: 'row__quick' }, [avail, h('a', { class: 'qbtn', href, title: 'Edit', 'aria-label': `Edit ${p.title}` }, icon('edit'))])
    );
    return el;
  }

  load(false);
}
