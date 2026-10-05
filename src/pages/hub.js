import * as stock from '../data/stock.js';
import { h, icon, clear } from '../ui/dom.js';
import { brandMark } from '../ui/brand.js';
import { closePanel } from '../ui/panels.js';
import { notch, biteFor } from '../ui/notch.js';
import { getUser, getSettings } from '../state/settings.js';
import { createLiquidDock } from '../ui/liquid-dock.js';
import { brandTheme, brandVars } from '../ui/brand-theme.js';
import { shopWithBrand } from './shop.js';
import { liquidTabs } from '../ui/liquid-tabs.js';

/*
 * Home (after the lock screen): greeting, the day in big numerals, a concierge prompt, make filters, a slideshow of
 * featured cars and quick routes - with the liquid dock (home, booking, concierge, VR | account) at the bottom.
 */
const AUTO_MS = 6000;
const MAKE_LABEL = { 'Rolls Royce': 'Rolls-Royce', 'Mercedes Benz': 'Mercedes-Benz' };
const label = (b) => MAKE_LABEL[b] || b;

/** The dock shared by Home and the concierge: home, booking, concierge, VR - and the account circle on the right. */
export function mainDock(current, { autoHide = true } = {}) {
  const user = getUser();
  return createLiquidDock({
    current, autoHide,
    items: [
      { id: 'home', icon: 'home', label: 'Home', desc: 'Featured cars', href: '#/home' },
      { id: 'service', icon: 'calendar', label: 'Service', desc: 'Bookings, repairs and quotes', href: '#/service' },
      { id: 'concierge', icon: 'spark', label: 'AI concierge', short: 'Concierge', desc: 'Ask for any car in plain words', href: '#/concierge' },
      { id: 'vr', icon: 'vr', label: 'VR showroom', short: 'VR', desc: 'Walk around a car in VR or AR', href: '#/vr' }
    ],
    end: {
      id: 'account', label: user ? 'Your account' : 'Sign in', short: user ? 'Account' : 'Sign in', desc: user ? user.email : 'Sign in or create an account', href: '#/account',
      render: () => (user ? h('span', { class: 'dk__avatar', text: (user.name || user.email || '?').trim()[0].toUpperCase() }) : icon('account'))
    }
  });
}

function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? 'Good evening' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
}

export function mountHub(root) {
  const user = getUser();
  const sale = stock.queryStock({ tab: 'sale' });
  /* featured: the dealer's featured and newest cars, 3D-ready ones first */
  const pool = sale.filter((c) => c.featured || c.newArrival);
  const rank = (c) => (stock.configuratorMatch(c) ? 0 : 1);
  const featuredAll = (pool.length >= 6 ? pool : sale).slice().sort((a, b) => rank(a) - rank(b)).slice(0, 24);
  const makes = [...new Set(featuredAll.map((c) => c.brand))].slice(0, 6);
  let make = '', index = 0, timer = 0, paused = false, alive = true;

  /* ---------- header */
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0'), mm = String(now.getMonth() + 1).padStart(2, '0');
  const top = h('header', { class: 'hub__top' }, [
    h('a', { class: 'hub__me', href: '#/account', 'data-tip': user ? 'Your account' : 'Sign in', 'data-tip-desc': user ? user.email : 'Save builds and bookings' }, [
      h('span', { class: 'hub__avatar' }, user ? (user.name || user.email || '?').trim()[0].toUpperCase() : icon('account')),
      h('span', { class: 'hub__hello' }, [h('small', { text: greeting() }), h('b', { text: user?.name ? user.name.split(' ')[0] : 'Welcome' })])
    ]),
    h('a', { class: 'hub__icon', href: '#/shop', 'aria-label': 'Search the shop', 'data-tip': 'Search', 'data-tip-desc': `All ${sale.length} cars` }, icon('search'))
  ]);
  const hero = h('section', { class: 'hub__hero' }, [
    h('p', { class: 'hub__date' }, [h('span', { text: `${dd}.${mm}` }), now.toLocaleDateString('en-GB', { weekday: 'long' })]),
    h('h1', { class: 'hub__title' }, [h('span', { class: 'hub__num', text: String(sale.length) }), h('span', { class: 'hub__unit', text: 'cars ready to drive' })])
  ]);

  /* ---------- concierge prompt */
  const askInput = h('input', { class: 'ask__input', type: 'text', name: 'q', placeholder: 'Ask for any car…', autocomplete: 'off', 'aria-label': 'Ask the concierge' });
  const ask = h('form', { class: 'ask', role: 'search', onsubmit: (e) => { e.preventDefault(); const q = askInput.value.trim(); location.hash = q ? `#/concierge/${encodeURIComponent(q)}` : '#/concierge'; } }, [
    h('span', { class: 'ask__spark', 'aria-hidden': 'true' }, icon('spark')),
    askInput,
    h('button', { class: 'ask__go', type: 'submit', 'aria-label': 'Ask', 'data-tip': 'Ask the concierge' }, icon('send'))
  ]);
  const prompts = h('div', { class: 'hub__prompts' }, ['Ferrari convertibles', 'Low mileage SUVs', 'Newest arrivals'].map((p) => h('a', { class: 'prompt', href: `#/concierge/${encodeURIComponent(p)}`, text: p })));

  /* ---------- make filter (oval chips with a sliding thumb) */
  const chips = h('div', { class: 'mk', role: 'tablist', 'aria-label': 'Filter featured cars by make' });
  const thumb = h('span', { class: 'mk__thumb', 'aria-hidden': 'true' });
  function renderChips() {
    clear(chips);
    chips.append(thumb);
    ['', ...makes].forEach((m) => chips.append(h('button', {
      class: 'mk__item', type: 'button', role: 'tab', 'aria-selected': String(make === m), text: m ? label(m) : 'All',
      onclick: (e) => { if (make === m) return; make = m; index = 0; [...chips.querySelectorAll('.mk__item')].forEach((b) => b.setAttribute('aria-selected', String(b === e.currentTarget))); moveThumb(); renderSlides(); }
    })));
    requestAnimationFrame(moveThumb);
  }
  function moveThumb() {
    const on = chips.querySelector('[aria-selected="true"]');
    if (!on) return;
    thumb.style.width = `${on.offsetWidth}px`;
    thumb.style.transform = `translateX(${on.offsetLeft}px)`;
    on.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: getSettings().reduceMotion ? 'auto' : 'smooth' });
  }

  /* ---------- featured slideshow */
  const track = h('div', { class: 'show__track', tabindex: '0', 'aria-roledescription': 'carousel', 'aria-label': 'Featured cars' });
  const dots = h('div', { class: 'show__dots', role: 'tablist', 'aria-label': 'Choose a featured car' });
  const count = h('span', { class: 'show__count' });
  const slides = () => [...track.children];
  function slide(c, i, total) {
    const can = stock.configuratorMatch(c);
    const meta = [c.year, stock.kmLabel(c)].filter(Boolean).join(' · ');
    const media = h('div', { class: 'slide__media' }, [h('img', { class: 'slide__img', src: stock.coverUrl(c), alt: c.title, loading: i < 2 ? 'eager' : 'lazy', decoding: 'async', onerror: (e) => { if (e.target.src !== c.cover) e.target.src = c.cover; } })]);
    const card = h('article', { class: 'slide', 'aria-roledescription': 'slide', 'aria-label': `${i + 1} of ${total}: ${c.title}` }, [
      media,
      h('div', { class: 'slide__top' }, [
        h('span', { class: 'tag tag--glass' }, [brandMark(label(c.brand)) || '', label(c.brand)]),
        c.newArrival ? h('span', { class: 'tag tag--signal', text: 'New' }) : null
      ]),
      h('div', { class: 'slide__body' }, [
        h('h3', { class: 'slide__title', text: c.title.replace(new RegExp(`^${c.brand}\\s*`, 'i'), '') || c.title }),
        h('p', { class: 'slide__meta', text: meta }),
        h('div', { class: 'slide__actions' }, [
          h('a', { class: 'pill pill--light', href: `#/shop/${c.id}`, 'data-tip': 'Details', 'data-tip-desc': 'Photos, specs and booking' }, ['Details', icon('more')]),
          h('a', { class: 'pill pill--glass', href: `#/service`, 'data-tip': 'Book a viewing' }, 'Book')
        ])
      ])
    ]);
    if (!can) return h('div', { class: 'slidew' }, card);
    /* configurable: the card takes the notched shape, the configure button sits in the bite */
    const wrap = h('div', { class: 'slidew' });
    const bite = biteFor(52, 62);
    notch(card, { r: 28, n: bite, k: 14, sizeVar: wrap });
    notch(media, { r: 22, n: (w) => bite(w + 12) - 6, k: 11 });
    wrap.append(card, h('a', { class: 'notch-btn', href: `#/shop/${c.id}/configure`, 'aria-label': `Configure ${c.title} in 3D`, 'data-tip': 'Configure in 3D', 'data-tip-desc': 'Paint, wheels and aero' }, icon('model')));
    return wrap;
  }
  function renderSlides() {
    const list = (make ? featuredAll.filter((c) => c.brand === make) : featuredAll).slice(0, 8);
    clear(track); clear(dots);
    list.forEach((c, i) => {
      track.append(slide(c, i, list.length));
      dots.append(h('button', { class: 'show__dot', type: 'button', role: 'tab', 'aria-label': `Show ${c.title}`, onclick: () => goTo(i, true) }));
    });
    track.scrollLeft = 0;
    sync(0);
    restart();
  }
  function goTo(i, user = false) {
    const all = slides();
    if (!all.length) return;
    index = (i + all.length) % all.length;
    sync(index);
    track.scrollTo({ left: all[index].offsetLeft - track.offsetLeft - (track.clientWidth - all[index].offsetWidth) / 2, behavior: getSettings().reduceMotion ? 'auto' : 'smooth' });
    if (user) restart();
  }
  function sync(i) {
    index = i;
    [...dots.children].forEach((d, j) => d.setAttribute('aria-selected', String(j === i)));
    count.textContent = `${String(i + 1).padStart(2, '0')} / ${String(dots.children.length).padStart(2, '0')}`;
  }
  let scrollRaf = 0;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(scrollRaf);
    scrollRaf = requestAnimationFrame(() => {
      const mid = track.scrollLeft + track.clientWidth / 2;
      let best = 0, bestD = Infinity;
      slides().forEach((s, j) => { const d = Math.abs(s.offsetLeft - track.offsetLeft + s.offsetWidth / 2 - mid); if (d < bestD) { bestD = d; best = j; } });
      if (best !== index) sync(best);
    });
  }, { passive: true });
  function restart() {
    clearInterval(timer);
    dots.style.setProperty('--auto', `${AUTO_MS}ms`);
    dots.classList.remove('is-run'); void dots.offsetWidth;
    if (getSettings().reduceMotion || slides().length < 2) return;
    dots.classList.add('is-run');
    timer = setInterval(() => { if (!paused && alive && !document.hidden) { goTo(index + 1); dots.classList.remove('is-run'); void dots.offsetWidth; dots.classList.add('is-run'); } }, AUTO_MS);
  }
  const pause = (v) => () => { paused = v; dots.classList.toggle('is-paused', v); };
  ['pointerenter', 'focusin'].forEach((ev) => track.addEventListener(ev, pause(true)));
  ['pointerleave', 'focusout'].forEach((ev) => track.addEventListener(ev, pause(false)));
  track.addEventListener('touchstart', () => { paused = true; dots.classList.add('is-paused'); clearTimeout(track._t); track._t = setTimeout(() => { paused = false; dots.classList.remove('is-paused'); }, 5000); }, { passive: true });
  track.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { e.preventDefault(); goTo(index + 1, true); } if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(index - 1, true); } });

  const show = h('section', { class: 'show', 'aria-label': 'Featured cars' }, [
    h('div', { class: 'sect-head' }, [h('h2', { text: 'Featured' }), h('a', { class: 'sect-head__link', href: '#/shop' }, ['See all', icon('right')])]),
    chips, track, h('div', { class: 'show__foot' }, [dots, count])
  ]);

  /* ---------- small cards for the rails below */
  const short = (c) => c.title.replace(new RegExp(`^${c.brand.replace(/\s+/g, '[\\s-]*')}\\s*`, 'i'), '') || c.title;
  const ncard = (c, i, { dark = false } = {}) => h('a', { class: `ncard rv${dark ? ' ncard--dark' : ''}${c.sold ? ' is-sold' : ''}`, href: `#/shop/${c.id}`, style: `--i:${i % 8}`, 'data-tip': c.title, 'data-tip-desc': c.sold ? 'Sold - ask about similar cars' : 'Photos, specs and booking' }, [
    h('span', { class: 'ncard__img' }, [
      h('img', { src: stock.coverUrl(c), alt: '', loading: 'lazy', decoding: 'async', onerror: (e) => { if (e.target.src !== c.cover) e.target.src = c.cover; } }),
      !c.sold && stock.configuratorMatch(c) ? h('span', { class: 'ncard__3d', 'aria-label': 'Configurable in 3D' }, icon('model')) : null,
      c.sold ? h('span', { class: 'ncard__sold', text: 'Sold' }) : null
    ]),
    h('span', { class: 'ncard__body' }, [
      h('small', { text: label(c.brand) }),
      h('b', { text: short(c) }),
      h('span', { class: 'ncard__meta', text: [c.year, stock.kmLabel(c)].filter(Boolean).join(' · ') }),
      h('span', { class: 'ncard__price', text: c.sold ? 'Sold' : stock.priceLabel(c) })
    ])
  ]);
  const rail = (cards) => h('div', { class: 'rail2' }, cards);

  /* ---------- shop by make: each make in its own colours */
  const byMake = stock.stockBrands('sale');
  const goMake = (m) => (e) => { e.preventDefault(); shopWithBrand(m); };
  const makesEl = h('section', { class: 'makes', 'aria-label': 'Shop by make' }, [
    h('div', { class: 'sect-head' }, [h('h2', { text: 'Shop by make' }), h('a', { class: 'sect-head__link', href: '#/shop' }, [`${byMake.length} makes`, icon('right')])]),
    h('div', { class: 'btiles' }, byMake.slice(0, 8).map(([m, n], i) => {
      const t = brandTheme(m);
      return h('a', { class: 'btile tilt rv', href: '#/shop', style: `${brandVars(m)};--i:${i}`, onclick: goMake(m), 'data-tip': `${label(m)} - ${n} cars`, 'data-tip-desc': t.name }, [
        h('span', { class: 'btile__mark', 'aria-hidden': 'true' }, brandMark(label(m)) || h('span', { text: label(m)[0] })),
        h('span', { class: 'btile__stripe', 'aria-hidden': 'true' }),
        h('b', { text: label(m) }),
        h('span', { class: 'btile__n', text: `${n} ${n === 1 ? 'car' : 'cars'}` })
      ]);
    }))
  ]);

  /* ---------- make spotlight: the band takes the chosen make's colours; the chip's liquid thumb takes them too */
  const spotMakes = byMake.slice(0, 6).map(([m]) => m);
  let spot = spotMakes[0];
  const spotTabs = liquidTabs({
    label: 'Make spotlight', cls: 'lq--brand', value: spot, theme: brandVars,
    items: spotMakes.map((m) => ({ id: m, content: [brandMark(label(m)) || '', label(m)] })),
    onChange: (m) => { spot = m; renderSpot(true); }
  });
  const spotChips = spotTabs.el;
  const spotRail = h('div', { class: 'rail2 rail2--spot' });
  const spotHead = h('div', { class: 'spot__head' });
  const spotEl = h('section', { class: 'spot', 'aria-label': 'Make spotlight' }, [
    h('div', { class: 'spot__bg', 'aria-hidden': 'true' }),
    h('div', { class: 'spot__mark', 'aria-hidden': 'true' }),
    h('p', { class: 'eyebrow spot__eyebrow', text: 'Spotlight' }),
    spotChips, spotHead, spotRail
  ]);
  function renderSpot(animate) {
    const cars = sale.filter((c) => c.brand === spot).sort((a, b) => (b.year || 0) - (a.year || 0));
    const t = brandTheme(spot);
    spotEl.setAttribute('style', brandVars(spot));
    spotEl.querySelector('.spot__mark').replaceChildren(brandMark(label(spot)) || '');
    spotHead.replaceChildren(
      h('div', {}, [h('h2', { text: label(spot) }), h('p', { text: `${cars.length} in stock · ${t.name}` })]),
      h('a', { class: 'pill pill--sm spot__all', href: '#/shop', onclick: goMake(spot) }, ['See all', icon('right')])
    );
    spotRail.replaceChildren(...cars.slice(0, 8).map((c, i) => ncard(c, i, { dark: true })));
    spotRail.scrollLeft = 0;
    if (animate) { spotEl.classList.remove('is-swap'); void spotEl.offsetWidth; spotEl.classList.add('is-swap'); }
  }

  /* ---------- new arrivals, body styles, recently sold */
  const fresh = sale.filter((c) => c.newArrival).sort((a, b) => (b.year || 0) - (a.year || 0));
  const freshEl = h('section', { class: 'fresh', 'aria-label': 'New arrivals' }, [
    h('div', { class: 'sect-head' }, [h('h2', { text: 'New arrivals' }), h('a', { class: 'sect-head__link', href: '#/concierge/Newest arrivals' }, ['Ask the concierge', icon('right')])]),
    rail(fresh.slice(0, 10).map((c, i) => ncard(c, i)))
  ]);
  const BODIES = [['SUV', 'SUVs', 'Room for five, and the boot'], ['Coupe', 'Coupés', 'Two doors, long bonnet'], ['Convertible', 'Convertibles', 'Roof down by the sea'], ['Sedan', 'Saloons', 'Chauffeur or driver']];
  const bodyCount = (b) => sale.filter((c) => c.body === b).length;
  const bodiesEl = h('section', { class: 'bodies', 'aria-label': 'Body styles' }, [
    h('div', { class: 'sect-head' }, [h('h2', { text: 'By body style' })]),
    h('div', { class: 'bgrid' }, BODIES.map(([b, name, sub], i) => {
      const pick = sale.find((c) => c.body === b && stock.configuratorMatch(c)) || sale.find((c) => c.body === b);
      return h('a', { class: 'body-t tilt rv', href: `#/concierge/${encodeURIComponent(`Show me ${name.toLowerCase()}`)}`, style: `--i:${i}`, 'data-tip': `${bodyCount(b)} ${name.toLowerCase()}`, 'data-tip-desc': 'Ask the concierge' }, [
        pick ? h('img', { src: stock.coverUrl(pick), alt: '', loading: 'lazy', onerror: (e) => { if (e.target.src !== pick.cover) e.target.src = pick.cover; } }) : null,
        h('span', { class: 'body-t__txt' }, [h('b', { text: name }), h('small', { text: `${bodyCount(b)} cars · ${sub}` })])
      ]);
    }))
  ]);
  const sold = stock.queryStock({ tab: 'sold' }).slice(0, 10);
  const soldEl = sold.length ? h('section', { class: 'sold', 'aria-label': 'Recently sold' }, [
    h('div', { class: 'sect-head' }, [h('h2', { text: 'Recently sold' }), h('span', { class: 'sect-head__note', text: 'Want one like it? Ask us.' })]),
    rail(sold.map((c, i) => ncard(c, i)))
  ]) : null;

  /* ---------- quick routes */
  const tile = ({ cls = '', ic, title, sub, href, onClick, tip }) => h(href ? 'a' : 'button', {
    class: `qtile ${cls}`, ...(href ? { href } : { type: 'button', onclick: onClick }), 'data-tip': tip || title
  }, [h('span', { class: 'qtile__ic' }, icon(ic)), h('b', { text: title }), h('span', { text: sub })]);
  const quick = h('section', { class: 'quick', 'aria-label': 'Services' }, [
    tile({ cls: 'qtile--ink', ic: 'spark', title: 'AI concierge', sub: 'Ask for any car in plain words', href: '#/concierge' }),
    tile({ ic: 'calendar', title: 'Service', sub: 'Bookings, repairs and quotes', href: '#/service' }),
    tile({ ic: 'vr', title: 'VR showroom', sub: 'Walk around it, or place it at home', href: '#/vr' }),
    tile({ ic: 'shop', title: `${sale.length} cars`, sub: 'Browse the full stock', href: '#/shop' })
  ]);

  const dock = mainDock('home');
  const main = h('main', { class: 'hub' }, [
    h('div', { class: 'hub__glow', 'aria-hidden': 'true' }),
    top, hero, h('div', { class: 'hub__ask' }, [ask, prompts]), show, makesEl, spotEl, freshEl, bodiesEl, quick, soldEl,
    h('p', { class: 'hub__foot', text: 'Exotic Cars · Dubai · prices in AED, availability updated daily' }),
    h('div', { class: 'dockbar' }, dock.el)
  ]);
  root.append(main);
  renderSpot(false);
  /* arriving from the lock screen: its black veil fades away over the new page */
  const veil = document.querySelector('.unveil');
  if (veil) requestAnimationFrame(() => { veil.classList.add('is-out'); setTimeout(() => veil.remove(), 480); });
  renderChips();
  renderSlides();
  const onResize = () => moveThumb();
  window.addEventListener('resize', onResize);

  return { kind: 'hub', destroy() { alive = false; clearInterval(timer); dock.destroy(); spotTabs.destroy(); window.removeEventListener('resize', onResize); closePanel(); } };
}
