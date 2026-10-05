import { h, icon, aed, num, ago, chip, debounce, segmented, select, skeleton, empty, errorState, toast, failed } from '../ui.js';
import { get, patch, qs, exportUrl } from '../api.js';
import { carThumb, imgFallback } from '../media.js';

/* Inventory: every car the dealership lists, with quick switches for the things that change most (sold, hidden, featured). */
const STATUS = [['', 'All'], ['sale', 'For sale'], ['new', 'New arrivals'], ['featured', 'Featured'], ['sold', 'Sold'], ['hidden', 'Hidden']];
const SORTS = [['newest', 'Newest listed'], ['oldest', 'Oldest listed'], ['price', 'Highest price'], ['year', 'Newest model year'], ['title', 'A–Z']];
const PAGE = 40;

export function mountInventory(view) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const state = { q: params.get('q') || '', make: params.get('make') || '', status: params.get('status') || '', sort: 'newest', offset: 0 };

  const count = h('span', { class: 'phead__count' });
  view.append(h('header', { class: 'phead' }, [
    h('div', {}, [h('p', { class: 'phead__eyebrow', text: 'Stock' }), h('h1', { class: 'phead__title' }, ['Inventory ', count])]),
    h('div', { class: 'phead__actions' }, [
      h('a', { class: 'btn btn--ghost', href: exportUrl('cars'), download: '' }, [icon('download'), h('span', { class: 'hide-sm', text: 'Export' })]),
      h('a', { class: 'btn btn--primary', href: '#/inventory/new' }, [icon('plus'), 'Add a car'])
    ])
  ]));

  const search = h('input', { class: 'inp inp--search', type: 'search', placeholder: 'Search title, colour, stock number…', value: state.q, 'aria-label': 'Search cars' });
  const make = select('make', [['', 'All makes']], state.make, { 'aria-label': 'Make' });
  const sort = select('sort', SORTS, state.sort, { 'aria-label': 'Sort' });
  const seg = segmented(STATUS, state.status, (v) => { state.status = v; reload(); }, { label: 'Status' });
  view.append(h('div', { class: 'toolbar' }, [
    h('label', { class: 'search' }, [icon('search'), search]),
    h('div', { class: 'toolbar__row' }, [make, sort]),
    h('div', { class: 'toolbar__seg' }, seg.el)
  ]));

  const list = h('div', { class: 'rows' });
  const more = h('button', { class: 'btn btn--ghost btn--block', type: 'button', hidden: true, onclick: () => load(true) }, 'Show more');
  view.append(list, more);

  search.addEventListener('input', debounce(() => { state.q = search.value.trim(); reload(); }, 280));
  make.addEventListener('change', () => { state.make = make.value; reload(); });
  sort.addEventListener('change', () => { state.sort = sort.value; reload(); });

  let token = 0;
  function reload() { state.offset = 0; load(false); }
  async function load(append) {
    const my = ++token;
    if (!append) list.replaceChildren(skeleton(8));
    let res;
    try { res = await get(`admin/cars${qs({ q: state.q, make: state.make, status: state.status, sort: state.sort, limit: PAGE, offset: append ? state.offset : 0 })}`); } catch (e) { list.replaceChildren(errorState(e, reload)); return; }
    if (my !== token) return;
    if (!append) list.replaceChildren();
    if (make.options.length <= 1 && res.makes?.length) {
      res.makes.forEach((m) => make.append(h('option', { value: m, text: m })));
      make.value = state.make;
    }
    count.textContent = num(res.pagination.total);
    if (!res.imported) { list.replaceChildren(empty('Nothing imported yet', 'Open Settings and import the site’s stock, or add your first car.', h('a', { class: 'btn btn--primary', href: '#/settings' }, 'Go to Settings'))); more.hidden = true; return; }
    if (!res.data.length && !append) list.replaceChildren(empty('No cars match', 'Try another search or filter.'));
    res.data.forEach((c) => list.append(row(c)));
    state.offset = (append ? state.offset : 0) + res.data.length;
    more.hidden = res.pagination.next == null;
  }

  function row(c) {
    const el = h('article', { class: `row${c.hidden ? ' is-muted' : ''}` });
    const quick = (key, iconOn, iconOff, labelOn, labelOff) => {
      const b = h('button', { class: `qbtn${c[key] ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(Boolean(c[key])), title: c[key] ? labelOn : labelOff, 'aria-label': c[key] ? labelOn : labelOff }, icon(c[key] ? iconOn : iconOff));
      b.addEventListener('click', async (e) => {
        e.preventDefault();
        b.disabled = true;
        try {
          const next = await patch(`admin/cars/${c.id}`, { [key]: !c[key] });
          Object.assign(c, next);
          el.replaceWith(row(c));
          toast(`${c.title}: ${key === 'sold' ? (c.sold ? 'marked sold' : 'back on sale') : key === 'hidden' ? (c.hidden ? 'hidden from the site' : 'shown on the site') : (c.featured ? 'featured on the home page' : 'no longer featured')}`);
        } catch (err) { failed(err); b.disabled = false; }
      });
      return b;
    };
    el.append(
      h('a', { class: 'row__main', href: `#/inventory/${c.id}` }, [
        h('span', { class: 'row__img' }, h('img', { src: carThumb(c), alt: '', loading: 'lazy', decoding: 'async', onerror: imgFallback })),
        h('span', { class: 'row__t' }, [
          h('b', { text: c.title }),
          h('small', { text: [c.year, c.km != null ? `${num(c.km)} km` : null, c.exterior, `#${c.id}`].filter(Boolean).join(' · ') }),
          h('span', { class: 'row__chips' }, [
            c.hidden ? chip('Hidden', 'grey') : c.sold ? chip('Sold', 'grey') : chip('For sale', 'green'),
            c.newArrival ? chip('New arrival', 'red') : null,
            c.featured ? chip('Featured', 'violet') : null
          ])
        ]),
        h('span', { class: 'row__price' }, [h('b', { text: c.price ? aed(c.price) : 'On request' }), h('small', { text: c.updatedAt ? `Edited ${ago(c.updatedAt)}` : c.listedAt ? `Listed ${ago(c.listedAt)}` : '' })])
      ]),
      h('div', { class: 'row__quick' }, [
        quick('featured', 'star', 'star', 'Featured (tap to remove)', 'Feature on the home page'),
        quick('hidden', 'eyeoff', 'eye', 'Hidden (tap to show)', 'Hide from the website'),
        quick('sold', 'done', 'tag', 'Sold (tap to put back on sale)', 'Mark as sold'),
        h('a', { class: 'qbtn', href: `#/inventory/${c.id}`, title: 'Edit', 'aria-label': `Edit ${c.title}` }, icon('edit'))
      ])
    );
    return el;
  }

  load(false);
}
