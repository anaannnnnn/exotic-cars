import * as stock from '../data/stock.js';
import { h, icon, clear } from '../ui/dom.js';
import { brandMark } from '../ui/brand.js';
import { closePanel } from '../ui/panels.js';
import { getUser, getSettings } from '../state/settings.js';
import { createLiquidDock } from '../ui/liquid-dock.js';
import { brandTheme, brandVars } from '../ui/brand-theme.js';
import { shopWithBrand } from './shop.js';
import { liquidTabs } from '../ui/liquid-tabs.js';
import { themeToggle } from '../ui/theme-toggle.js';
import { flowRail } from '../ui/flow.js';
import { focusCenter } from '../ui/motion.js';
import { listen, voiceSupport } from '../ui/voice.js';
import { api } from '../data/api.js';

/*
 * Home (after the lock screen): greeting, the day in big numerals, a concierge prompt, make filters, a slideshow of
 * featured cars and quick routes - with the liquid dock (home, booking, concierge, VR | account) at the bottom.
 */
const MAKE_LABEL = { 'Rolls Royce': 'Rolls-Royce', 'Mercedes Benz': 'Mercedes-Benz' };
const label = (b) => MAKE_LABEL[b] || b;

/*
 * The dock shared by Home, Service, the concierge, VR and the account: one dock for the whole visit, created the first
 * time a page asks for it and kept on <body>, so changing page never re-mounts it - the page only says which item is
 * its own and the lens flows there. Pages without a dock leave it unclaimed, and the router tucks it off screen
 * (settleDock, called by app.js after each page mounts).
 */
let shared = null, claimed = false;
const accountItem = () => {
  const user = getUser();
  return {
    id: 'account', label: user ? 'Your account' : 'Sign in', short: user ? 'Account' : 'Sign in', desc: user ? user.email : 'Sign in or create an account', href: '#/account',
    render: () => (user ? h('span', { class: 'dk__avatar', text: (user.name || user.email || '?').trim()[0].toUpperCase() }) : icon('account'))
  };
};
export function mainDock(current, { autoHide = true } = {}) {
  claimed = true;
  if (!shared) {
    shared = createLiquidDock({
      current, autoHide,
      items: [
        { id: 'home', icon: 'home', label: 'Home', desc: 'Featured cars', href: '#/home' },
        { id: 'service', icon: 'calendar', label: 'Service', desc: 'Bookings, repairs and quotes', href: '#/service' },
        { id: 'concierge', icon: 'spark', label: 'AI concierge', short: 'Concierge', desc: 'Ask for any car in plain words', href: '#/concierge' },
        { id: 'vr', icon: 'vr', label: 'VR showroom', short: 'VR', desc: 'Walk around a car in VR or AR', href: '#/vr' }
      ],
      end: accountItem()
    });
    document.body.append(h('div', { class: 'dockbar' }, shared.el));
  } else {
    shared.setItem(4, accountItem());
    shared.setAutoHide(autoHide);
    shared.select(current);
    shared.show();
  }
  return { destroy() { /* the dock outlives the page; the next route decides whether it stays (settleDock) */ } };
}
/** After a page mounts: a page that did not ask for the dock gets it tucked off screen. */
export function settleDock() {
  if (!claimed) shared?.hide();
  claimed = false;
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
  let make = '';
  let adSlides = [];
  let alive = true;

  /* ---------- header */
    const top = h('header', { class: 'hub__top' }, [
    h('a', { class: 'hub__me', href: '#/account', 'data-tip': user ? 'Your account' : 'Sign in', 'data-tip-desc': user ? user.email : 'Save builds and bookings' }, [
      h('span', { class: 'hub__avatar' }, user ? (user.name || user.email || '?').trim()[0].toUpperCase() : icon('account')),
      h('span', { class: 'hub__hello' }, [h('small', { text: greeting() }), h('b', { text: user?.name ? user.name.split(' ')[0] : 'Welcome' })])
    ]),
    h('div', { class: 'hub__tools' }, [
      themeToggle(),
      h('a', { class: 'hub__icon', href: '#/shop', 'aria-label': 'Search the shop', 'data-tip': 'Search', 'data-tip-desc': 'Every car in the showroom' }, icon('search'))
    ])
  ]);
  /* ---------- concierge prompt */
  const askInput = h('input', { class: 'ask__input', type: 'text', name: 'q', placeholder: 'Ask for any car…', autocomplete: 'off', 'aria-label': 'Ask the concierge' });
  let homeEar = null, heroAsk = null;
  function setAskOpen(on) {
    ask.classList.toggle('is-open', on);
    heroAsk?.classList.toggle('is-open', on);
    ask.querySelector('.ask__spark')?.setAttribute('aria-expanded', String(on));
    if (on) requestAnimationFrame(() => askInput.focus());
  }
  const setHomeListening = (on) => {
    if (!askVoice) return;
    askVoice.setAttribute('aria-pressed', String(on));
    askVoice.setAttribute('aria-label', on ? 'Stop listening' : 'Speak your search');
    ask.classList.toggle('is-listening', on);
    askInput.placeholder = on ? 'Listening…' : 'Ask for any car…';
  };
  const askVoice = voiceSupport().listen ? h('button', {
    class: 'ask__mic ask__voice', type: 'button', 'aria-label': 'Speak your search', 'aria-pressed': 'false',
    onclick: () => {
      if (homeEar) { homeEar.stop(); return; }
      setHomeListening(true);
      homeEar = listen({
        onInterim: (text) => { askInput.value = text; },
        onFinal: (text) => { askInput.value = text; askInput.focus(); },
        onError: () => { askInput.placeholder = 'Microphone unavailable — type instead'; },
        onEnd: () => { homeEar = null; setHomeListening(false); }
      });
    }
  }, icon('mic')) : null;
  const ask = h('form', { class: 'ask ask--orb', role: 'search', onsubmit: (e) => { e.preventDefault(); const q = askInput.value.trim(); location.hash = q ? `#/concierge/${encodeURIComponent(q)}` : '#/concierge'; } }, [
    h('button', { class: 'ask__spark', type: 'button', 'aria-label': 'Open AI concierge', 'aria-expanded': 'false', onclick: () => setAskOpen(true) }, icon('spark')),
    askInput,
    askVoice,
    h('button', { class: 'ask__go', type: 'submit', 'aria-label': 'Ask', 'data-tip': 'Ask the concierge' }, icon('send'))
  ].filter(Boolean));
  askInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); askInput.value = ''; setAskOpen(false); ask.querySelector('.ask__spark')?.focus(); } });
  ask.addEventListener('focusout', () => setTimeout(() => { if (!ask.contains(document.activeElement) && !askInput.value && !homeEar) setAskOpen(false); }, 0));

  /* ---------- logo shortcuts: dark medallions, one per make (magnetic on a mouse) ---------- */
  const chips = h('nav', { class: 'mk', 'aria-label': 'Shop by make' });
  function renderChips() {
    clear(chips);
    makes.forEach((m) => chips.append(h('a', {
      class: 'mk__item', href: '#/shop', style: brandVars(m), 'aria-label': `Shop ${label(m)}`, 'data-tip': label(m), 'data-fx': 'mag', onclick: goMake(m)
    }, brandMark(label(m)) || h('span', { class: 'mk__initial', text: label(m)[0] }))));
  }

  /* ---------- featured hero: full-bleed photos that slide in from the right (translate3d + opacity only) */
  const reduced = () => !!getSettings().reduceMotion || false;
  const stage = h('div', { class: 'show__stage' });
  const count = h('span', { class: 'show__count', 'aria-hidden': 'true' });
  const bar = h('span', { class: 'show__bar', 'aria-hidden': 'true' }, h('i'));
  const stepBtn = (dir) => h('button', { class: `show__btn show__btn--step show__btn--${dir < 0 ? 'prev' : 'next'}`, type: 'button', 'aria-label': dir < 0 ? 'Previous car' : 'Next car', onclick: () => goTo(cur + dir, dir) }, icon(dir < 0 ? 'left' : 'right'));
  const pauseBtn = h('button', { class: 'show__btn show__pause', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Pause the slideshow', onclick: () => { userPaused = !userPaused; syncPlay(); } }, [h('span', { class: 'show__ic show__ic--pause', 'aria-hidden': 'true' }, icon('pause')), h('span', { class: 'show__ic show__ic--play', 'aria-hidden': 'true' }, icon('play'))]);
  heroAsk = h('div', { class: 'hero-ask' }, ask);
  const show = h('section', { class: 'show show--hero', 'aria-roledescription': 'carousel', 'aria-label': 'Promotions', tabindex: '0' }, [
    stage,
    heroAsk,
    h('div', { class: 'show__ctl' }, [count, bar, stepBtn(-1), pauseBtn, stepBtn(1)])
  ]);
  let cur = 0, userPaused = false, hoverPause = false, touchPause = false, hiddenPause = false;
  const slideEls = () => [...stage.children];
  const ensureImg = (el) => { const im = el?.querySelector('img'); if (im && !im.getAttribute('src') && im.dataset.src) im.src = im.dataset.src; };
  const brandRe = (c) => new RegExp(`^${c.brand.replace(/\s+/g, '[\\s-]*')}\\s*`, 'i');

  /* a hero car shows only its make and name; the whole text block is the link to the car */
  function slide(c, i, total) {
    const [name] = (c.title.replace(brandRe(c), '') || c.title).split(/\s*\|\s*/);
    return h('article', { class: 'slide', role: 'group', 'aria-roledescription': 'slide', 'aria-label': `${i + 1} of ${total}: ${c.title}` }, [
      h('div', { class: 'slide__layer', 'aria-hidden': 'true' }, [
        h('span', { class: 'slide__word', text: label(c.brand).toUpperCase() }),
        h('div', { class: 'slide__pic' }, h('img', { class: 'slide__img', alt: '', width: '800', height: '533', draggable: 'false', decoding: 'async', ...(i === 0 ? { src: stock.coverUrl(c), loading: 'eager', fetchpriority: 'high' } : { 'data-src': stock.coverUrl(c), loading: 'lazy' }), onerror: stock.coverError(c) }))
      ]),
      h('div', { class: 'slide__shade', 'aria-hidden': 'true' }),
      h('a', { class: 'slide__body slide__body--lite', href: `#/shop/${c.id}`, 'aria-label': `View the car: ${c.title}` }, [
        h('p', { class: 'slide__eyebrow' }, [brandMark(label(c.brand)) || '', h('span', { text: label(c.brand) })]),
        h('h2', { class: 'slide__title', text: name || c.title })
      ])
    ]);
  }
  function adSlide(ad, i, total) {
    const caption = (ad.text || '').trim();
    return h('article', { class: 'slide slide--promo slide--ad', role: 'group', 'aria-roledescription': 'slide', 'aria-label': `${i + 1} of ${total}${caption ? `: ${caption}` : ': Advertisement'}` }, [
      h('div', { class: 'slide__layer' }, h('div', { class: 'slide__pic slide__pic--promo' }, h('img', { class: 'slide__img', alt: caption || 'Advertisement', width: '1600', height: '900', draggable: 'false', decoding: 'async', ...(i === 0 ? { src: ad.image, loading: 'eager', fetchpriority: 'high' } : { 'data-src': ad.image, loading: 'lazy' }) }))),
      h('div', { class: 'slide__shade', 'aria-hidden': 'true' }),
      caption ? h('div', { class: 'slide__body slide__body--ad' }, h('h2', { class: 'slide__title', text: caption, style: { fontFamily: `"${ad.font || 'Instrument Sans Variable'}", sans-serif` } })) : null
    ].filter(Boolean));
  }
  /* the stack's own `alt`: the car photo is decorative inside the labelled slide, so its title lives on the slide */
  function renderSlides() {
    const usingAds = adSlides.length > 0;
    const list = (usingAds ? adSlides : featuredAll).slice(0, 8);
    clear(stage);
    list.forEach((item, i) => { const el = usingAds ? adSlide(item, i, list.length) : slide(item, i, list.length); if (!usingAds) { el.querySelector('img').alt = item.title; el.querySelector('.slide__layer').removeAttribute('aria-hidden'); } stage.append(el); });
    cur = 0;
    slideEls()[0]?.classList.add('is-active');
    sync();
    preloadNext();
  }
  const preloadNext = () => { const all = slideEls(); if (all.length > 1) ensureImg(all[(cur + 1) % all.length]); };
  function sync() {
    const all = slideEls();
    all.forEach((el, i) => { el.inert = i !== cur; el.setAttribute('aria-hidden', String(i !== cur)); });
    count.textContent = `${String(cur + 1).padStart(2, '0')} / ${String(all.length).padStart(2, '0')}`;
    show.classList.toggle('is-single', all.length < 2);
    restartBar();
  }
  function goTo(next, dir, drag) {
    const all = slideEls(), n = all.length;
    if (n < 2) return;
    next = (next + n) % n;
    if (next === cur) return;
    dir = dir || (next > cur ? 1 : -1);
    const from = all[cur], to = all[next];
    ensureImg(to);
    all.forEach((el) => el.classList.remove('is-leave-l', 'is-leave-r', 'pre-r', 'pre-l'));
    if (!drag && !reduced()) { to.classList.add(dir > 0 ? 'pre-r' : 'pre-l'); void to.offsetWidth; }
    [from, to].forEach((el) => { el.style.transform = ''; el.style.transition = ''; el.classList.remove('is-drag-nb'); });
    to.classList.remove('pre-r', 'pre-l'); to.classList.add('is-active');
    from.classList.remove('is-active'); from.classList.add(dir > 0 ? 'is-leave-l' : 'is-leave-r');
    clearTimeout(from._t); from._t = setTimeout(() => from.classList.remove('is-leave-l', 'is-leave-r'), 1100);
    cur = next;
    sync(); preloadNext();
  }
  /* autoplay is the progress line itself: when its 4s animation ends the next car slides in; pausing holds the line */
  function canPlay() { return !reduced() && slideEls().length > 1 && !userPaused; }
  /* a plain timer drives the slideshow (a car or an ad changes every AUTO_MS) so it never depends on CSS animation */
  const AUTO_MS = 4000;
  let elapsed = 0;
  const paint = () => { bar.firstChild.style.transform = `scaleX(${canPlay() ? Math.min(1, elapsed / AUTO_MS) : 1})`; };
  function restartBar() {
    elapsed = 0;
    show.classList.toggle('is-playing', canPlay());
    paint();
    syncPlay();
  }
  const clock = setInterval(() => {
    if (!alive || !canPlay() || userPaused || touchPause || hiddenPause) return;
    elapsed += 100;
    if (elapsed >= AUTO_MS) { elapsed = 0; goTo(cur + 1, 1); } else paint();
  }, 100);
  function syncPlay() {
    const held = userPaused || touchPause || hiddenPause;
    show.classList.toggle('is-held', held);
    pauseBtn.setAttribute('aria-pressed', String(userPaused));
    pauseBtn.setAttribute('aria-label', userPaused ? 'Play the slideshow' : 'Pause the slideshow');
    stage.setAttribute('aria-live', held || !canPlay() ? 'polite' : 'off');
  }
  const onVis = () => { hiddenPause = document.hidden; syncPlay(); };
  document.addEventListener('visibilitychange', onVis);
  show.addEventListener('keydown', (e) => {
    if (e.target.closest('a,button,input,textarea,select,form') && e.target !== show) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(cur + 1, 1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(cur - 1, -1); }
  });

  /* swipe or drag: the card follows the finger and its neighbour rides in beside it */
  let drag = null, swallow = false;
  stage.addEventListener('pointerdown', (e) => { if (e.button || slideEls().length < 2) return; drag = { x: e.clientX, y: e.clientY, t: performance.now(), dx: 0, on: false, nb: null, id: e.pointerId, touch: e.pointerType !== 'mouse' }; });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.on) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      drag.on = true; stage.setPointerCapture?.(drag.id); stage.classList.add('is-drag');
      if (drag.touch) { touchPause = true; syncPlay(); }
    }
    drag.dx = dx;
    const all = slideEls(), W = stage.clientWidth, d = dx < 0 ? 1 : -1, nb = all[(cur + d + all.length) % all.length];
    if (drag.nb && drag.nb !== nb) { drag.nb.classList.remove('is-drag-nb'); drag.nb.style.transform = ''; drag.nb.style.transition = ''; }
    drag.nb = nb; ensureImg(nb);
    all[cur].style.transition = 'none'; all[cur].style.transform = `translate3d(${dx}px,0,0)`;
    nb.classList.add('is-drag-nb'); nb.style.transition = 'none'; nb.style.transform = `translate3d(${d * W + dx}px,0,0)`;
  });
  const endDrag = (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    stage.classList.remove('is-drag');
    if (d.touch) setTimeout(() => { touchPause = false; syncPlay(); }, 4000);
    if (!d.on) return;
    swallow = true; setTimeout(() => { swallow = false; }, 60);
    const all = slideEls(), W = stage.clientWidth, v = d.dx / Math.max(1, performance.now() - d.t);
    if (e.type !== 'pointercancel' && (Math.abs(d.dx) > W * 0.2 || Math.abs(v) > 0.45)) {
      const dir = d.dx < 0 ? 1 : -1;
      goTo(all.indexOf(d.nb), dir, true);
    } else {                                                   /* not far enough: ease back */
      const from = all[cur], dd = d.dx < 0 ? 1 : -1;
      from.style.transition = 'transform 420ms var(--ease-cine)'; from.style.transform = '';
      if (d.nb) { d.nb.style.transition = 'transform 420ms var(--ease-cine)'; d.nb.style.transform = `translate3d(${dd * W}px,0,0)`; setTimeout(() => { d.nb.classList.remove('is-drag-nb'); d.nb.style.transform = ''; d.nb.style.transition = ''; }, 440); }
      setTimeout(() => { from.style.transition = ''; }, 440);
    }
  };
  stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('click', (e) => { if (swallow) { e.preventDefault(); e.stopPropagation(); } }, true);
  stage.addEventListener('dragstart', (e) => e.preventDefault());

  /* ---------- small cards for the rails below */
  const short = (c) => c.title.replace(new RegExp(`^${c.brand.replace(/\s+/g, '[\\s-]*')}\\s*`, 'i'), '') || c.title;
  const ncard = (c, i, { dark = false } = {}) => h('a', { class: `ncard rv${dark ? ' ncard--dark' : ''}${c.sold ? ' is-sold' : ''}`, href: `#/shop/${c.id}`, 'data-cfg': !c.sold && stock.configuratorMatch(c) ? '1' : null, style: `--i:${i % 8}`, 'data-fx': dark ? 'spot glare' : null, 'data-tip': c.title, 'data-tip-desc': c.sold ? 'Sold - ask about similar cars' : 'Photos, specs and booking' }, [
    h('span', { class: 'ncard__img' }, [
      h('img', { src: stock.coverUrl(c), alt: '', loading: 'lazy', decoding: 'async', onerror: stock.coverError(c) }),
      c.sold ? h('span', { class: 'ncard__sold', text: 'Sold' }) : null
    ]),
    h('span', { class: 'ncard__body' }, [
      h('small', { text: label(c.brand) }),
      h('b', { text: short(c) }),
      h('span', { class: 'ncard__meta', text: [c.year, stock.kmLabel(c)].filter(Boolean).join(' · ') }),
      h('span', { class: 'ncard__price', text: c.sold ? 'Sold' : stock.priceLabel(c) })
    ])
  ]);
  const rail = (cards, cls = '') => h('div', { class: `rail2 ${cls}`.trim() }, cards);
  const media = (c, cls) => h('img', { class: cls, src: stock.coverUrl(c), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false', onerror: stock.coverError(c) });

  /* new arrivals: interactive cards - Motion Lib spotlight, 3D tilt, holographic glare and a moving neon border */
  const xcard = (c, i) => h('a', { class: 'xc', href: `#/shop/${c.id}`, style: `--i:${i % 8}`, 'data-cfg': stock.configuratorMatch(c) ? '1' : null, 'data-fx': 'spot tilt glare', 'data-tip': c.title, 'data-tip-desc': 'Photos, specs and booking' }, [
    h('span', { class: 'xc__stage' }, [
      media(c, 'xc__img'),
      h('span', { class: 'xc__idx', 'aria-hidden': 'true', text: String(i + 1).padStart(2, '0') })
    ]),
    h('span', { class: 'xc__body' }, [
      h('small', { text: label(c.brand) }),
      h('b', { text: short(c) }),
      h('span', { class: 'xc__meta', text: [c.year, stock.kmLabel(c)].filter(Boolean).join(' · ') }),
      h('span', { class: 'xc__foot' }, [h('span', { class: 'xc__price', text: stock.priceLabel(c) }), h('span', { class: 'xc__go', 'aria-hidden': 'true' }, icon('right'))])
    ]),
    h('span', { class: 'xc__glare', 'aria-hidden': 'true' })
  ]);

  /* the archive: sold cars as ledger entries - greyscale until touched, stamped, with the lot number */
  const soldCard = (c, i) => h('a', { class: 'sc', href: `#/shop/${c.id}`, style: `--i:${i % 8}`, 'data-fx': 'spot', 'data-tip': c.title, 'data-tip-desc': 'Sold - ask about similar cars' }, [
    h('span', { class: 'sc__stage' }, [
      media(c, 'sc__img'),
      h('span', { class: 'sc__stamp', 'aria-hidden': 'true' }, 'Sold')
    ]),
    h('span', { class: 'sc__body' }, [
      h('span', { class: 'sc__lot', text: `Lot ${String(c.id).padStart(4, '0')}` }),
      h('small', { text: label(c.brand) }),
      h('b', { text: short(c) }),
      h('span', { class: 'sc__meta', text: [c.year, stock.kmLabel(c)].filter(Boolean).join(' · ') })
    ])
  ]);

  /* ---------- the marques: every make in stock, most cars first, as one continuous flow of cards that drifts sideways
     for ever (ui/flow.js) - grab it, swipe it, or pause it. Each card carries the make's mark on a medallion in its
     own colours, the models it is best stocked in, the span of model years, how many can be built in 3D and how many
     are new arrivals, and a bar for its share against the best-stocked make. */
  const byMake = stock.stockBrands('sale');
  const goMake = (m) => (e) => { e.preventDefault(); shopWithBrand(m); };
  const lead = byMake[0]?.[1] || 1;
  const marque = ([m, count], i) => h('a', {
    class: 'mq', href: '#/shop', style: `${brandVars(m)};--i:${i % 6};--share:${(count / lead).toFixed(4)}`, onclick: goMake(m), 'data-fx': 'spot',
    'aria-label': `${label(m)}: ${count} ${count === 1 ? 'car' : 'cars'} in stock`
  }, [
    h('span', { class: 'mq__medal', 'aria-hidden': 'true' }, brandMark(label(m)) || h('span', { class: 'mq__ini', text: label(m)[0] })),
    h('span', { class: 'mq__txt' }, h('b', { class: 'mq__name', text: label(m) })),
    h('span', { class: 'mq__n' }, [h('b', { text: String(count) }), h('small', { text: count === 1 ? 'car' : 'cars' })]),
    h('span', { class: 'mq__bar', 'aria-hidden': 'true' }, h('i'))
  ]);
  /* the track holds every card twice so the flow wraps without a seam; the second set is for the eye only */
  const mqTrack = h('div', { class: 'mq-track' }, [
    ...byMake.map((x, i) => marque(x, i)),
    ...byMake.map((x, i) => { const c = marque(x, i); c.setAttribute('aria-hidden', 'true'); c.tabIndex = -1; return c; })
  ]);
  const flowEl = h('div', { class: 'mq-flow', role: 'group', 'aria-roledescription': 'carousel', 'aria-label': 'Makes in stock' }, mqTrack);
  const flow = flowRail(flowEl, mqTrack, { speed: 30 });
  const makesEl = h('section', { class: 'makes marques rv', 'aria-label': 'The marques' }, flowEl);

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
  const spotEl = h('section', { class: 'spot rv', 'aria-label': 'Make spotlight' }, [
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
  const freshRail = h('div', { class: 'fresh__list' });
  const freshEl = h('section', { class: 'fresh rv', 'aria-label': 'New arrivals' }, [
    h('div', { class: 'sect-head' }, [h('div', {}, [h('p', { class: 'eyebrow', text: 'Just in' }), h('h2', { text: 'New arrivals' })]), h('a', { class: 'sect-head__link', href: '#/concierge/Newest arrivals' }, ['Ask the concierge', icon('right')])]),
    freshRail
  ]);
  function renderFresh() {
    const list = fresh.filter((c) => !make || c.brand === make).slice(0, 10);
    freshRail.replaceChildren(list.length
      ? rail(list.map((c, i) => xcard(c, i)), 'xrail')
      : h('p', { class: 'fresh__none', text: `No new arrivals from ${label(make)} right now.` }));
  }
  const BODIES = [['SUV', 'SUVs', 'Room for five, and the boot'], ['Coupe', 'Coupés', 'Two doors, long bonnet'], ['Convertible', 'Convertibles', 'Roof down by the sea'], ['Sedan', 'Saloons', 'Chauffeur or driver']];
  const bodyCount = (b) => sale.filter((c) => c.body === b).length;
  const bodiesEl = h('section', { class: 'bodies rv', 'aria-label': 'Body styles' }, [
    h('div', { class: 'sect-head' }, [h('div', {}, [h('p', { class: 'eyebrow', text: 'Browse' }), h('h2', { text: 'By body style' })])]),
    h('div', { class: 'bx-grid' }, BODIES.map(([b, name, sub], i) => {
      const pick = sale.find((c) => c.body === b && stock.configuratorMatch(c)) || sale.find((c) => c.body === b);
      const n = bodyCount(b);
      return h('a', { class: 'bx rv', href: `#/concierge/${encodeURIComponent(`Show me ${name.toLowerCase()}`)}`, style: `--i:${i}`, 'data-fx': 'spot', 'data-tip': `${n} ${name.toLowerCase()}`, 'data-tip-desc': 'Ask the concierge' }, [
        h('span', { class: 'bx__n', 'aria-hidden': 'true', text: String(n) }),
        pick ? media(pick, 'bx__car') : null,
        h('span', { class: 'bx__floor', 'aria-hidden': 'true' }),
        h('span', { class: 'bx__txt' }, [h('small', { text: `${String(i + 1).padStart(2, '0')} · ${n} cars` }), h('b', { text: name }), h('span', { text: sub })]),
        h('span', { class: 'bx__go', 'aria-hidden': 'true' }, icon('right'))
      ]);
    }))
  ]);
  const sold = stock.queryStock({ tab: 'sold' }).slice(0, 10);
  const soldEl = sold.length ? h('section', { class: 'sold sold--archive rv', 'aria-label': 'Recently sold' }, [
    h('div', { class: 'sold__head' }, [
      h('div', {}, [h('p', { class: 'eyebrow', text: 'Archive' }), h('h2', { text: 'Recently sold' }), h('p', { class: 'sold__tally' }, [h('b', { text: String(sold.length) }), ' cars found new homes'])]),
      h('a', { class: 'sold__ask', href: '#/concierge/Find me something like a recently sold model', 'data-fx': 'mag' }, ['Want one like this?', icon('right')])
    ]),
    rail(sold.map((c, i) => soldCard(c, i)), 'sold__rail')
  ]) : null;

  /* ---------- services: the concierge sits fixed in the middle; the other routes swipe beneath it */
  const svcCard = ({ ic, title, sub, href }, i) => h('a', { class: 'svc__card', href, style: `--i:${i}`, 'data-fx': 'spot tilt glare', 'data-tip': title }, [
    h('span', { class: 'svc__no', 'aria-hidden': 'true', text: String(i + 1).padStart(2, '0') }),
    h('span', { class: 'svc__ic' }, icon(ic)),
    h('b', { text: title }),
    h('span', { class: 'svc__sub', text: sub }),
    h('span', { class: 'svc__arrow', 'aria-hidden': 'true' }, icon('right')),
    h('span', { class: 'xc__glare', 'aria-hidden': 'true' })
  ]);
  const svcRail = h('div', { class: 'svc__rail', role: 'list', 'aria-label': 'More services' }, [
    { ic: 'calendar', title: 'Service & garage', sub: 'Track every job and approve quotes', href: '#/service' },
    { ic: 'vr', title: 'VR showroom', sub: 'Walk around a car or place it at home', href: '#/vr' },
    { ic: 'shop', title: 'The collection', sub: 'Browse every car in the showroom', href: '#/shop' }
  ].map(svcCard));
  const quick = h('section', { class: 'quick quick--stage rv', 'aria-label': 'Services' }, [
    h('div', { class: 'sect-head' }, h('div', {}, [h('p', { class: 'eyebrow', text: 'Explore' }), h('h2', { text: 'Services' })])),
    h('a', { class: 'svc__ai', href: '#/concierge', 'data-fx': 'spot', 'data-tip': 'Ask AI concierge' }, [
      h('span', { class: 'svc__orb', 'aria-hidden': 'true' }, [h('i'), h('i'), h('i'), icon('spark')]),
      h('b', { text: 'Ask AI concierge' }),
      h('span', { text: 'Describe the car you want in your own words' })
    ]),
    svcRail
  ]);
  const svcFocus = focusCenter(svcRail);

  mainDock('home');
  /* the header floats over the photo; once the hero has scrolled away it becomes solid glass */
  const sentinel = h('div', { class: 'hub__sentinel', 'aria-hidden': 'true' });
  const main = h('main', { class: 'hub' }, [
    top, show, sentinel,
    h('div', { class: 'hub__body' }, h('div', { class: 'hub__in' }, [
      chips, makesEl, spotEl, freshEl, bodiesEl, quick, soldEl,
      h('p', { class: 'hub__foot', text: 'Exotic Cars · Dubai · prices in AED, availability updated daily' })
    ].filter(Boolean)))
  ]);
  root.append(main);
  const io = new IntersectionObserver((list) => { const en = list[list.length - 1]; top.classList.toggle('is-solid', !en.isIntersecting && en.boundingClientRect.top < 84); }, { rootMargin: '-84px 0px 0px 0px' });
  io.observe(sentinel);
  renderSpot(false);
  /* arriving from the lock screen: its black veil fades away over the new page */
  const veil = document.querySelector('.unveil');
  if (veil) requestAnimationFrame(() => { veil.classList.add('is-out'); setTimeout(() => veil.remove(), 480); });
  renderChips();
  renderSlides();
  api('ads', { timeout: 5000 }).then((res) => {
    if (!alive || !Array.isArray(res) || !res.length) return;
    adSlides = res;
    renderSlides();
  }).catch(() => { /* featured inventory remains available if the ad service is offline */ });
  renderFresh();
  show.classList.toggle('is-reduced', reduced());

  return { kind: 'hub', destroy() { alive = false; clearInterval(clock); homeEar?.abort(); io.disconnect(); document.removeEventListener('visibilitychange', onVis); spotTabs.destroy(); flow.destroy(); svcFocus.destroy(); closePanel(); } };
}
