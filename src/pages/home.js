import * as stock from '../data/stock.js';
import { h, icon } from '../ui/dom.js';
import { brandMark } from '../ui/brand.js';
import { createDock } from '../ui/dock.js';
import { openService, openLogin, openSettings, openVR, closePanel } from '../ui/panels.js';
import { getUser } from '../state/settings.js';

const FEATURED = ['Ferrari', 'Lamborghini', 'Rolls-Royce', 'Bentley', 'Porsche', 'McLaren', 'Aston Martin', 'Mercedes-Benz', 'BMW', 'Audi'];

export function mountHome(root) {
  const user = getUser();
  const marks = FEATURED.map((m) => brandMark(m)).filter(Boolean);
  const cars = stock.queryStock({ tab: 'sale' });
  const total = cars.length;
  const brands = new Set(cars.map((c) => c.brand)).size;

  const dock = createDock({
    magnification: 1.75, distance: 110, iconSize: 52, gap: 6, borderRadius: 18,
    items: [
      { icon: icon('shop'), label: 'Shop', href: '#/shop' },
      { icon: icon('calendar'), label: 'Service appointment', short: 'Service', onClick: openService },
      { icon: icon('vr'), label: 'VR & AR', short: 'VR', onClick: openVR, separator: true },
      { icon: icon('gear'), label: 'Settings', onClick: openSettings },
      { icon: icon('user'), label: user ? 'Account' : 'Sign in', onClick: openLogin }
    ]
  });

  root.append(h('main', { class: 'home' }, [
    h('div', { class: 'home__glow', 'aria-hidden': 'true' }),
    h('header', { class: 'home__top' }, [h('span', { class: 'wordmark', text: 'Exotic Cars' })]),
    h('section', { class: 'home__hero' }, [
      h('p', { class: 'home__eyebrow', text: 'Dubai · Configure in 3D' }),
      h('h1', { class: 'home__title' }, ['Your car,', h('br'), h('em', { text: 'your way.' })]),
      h('p', { class: 'home__lede', text: `${total} luxury and exotic cars from ${brands} marques. Explore each one in photos, then make it yours in 3D.` }),
      h('a', { class: 'home__cta', href: '#/shop' }, [h('span', { text: 'Browse the collection' }), icon('forward')])
    ]),
    h('div', { class: 'home__brands', 'aria-hidden': 'true' }, marks),
    h('nav', { class: 'home__dock', 'aria-label': 'Menu' }, dock.el)
  ]));

  return { kind: 'home', destroy() { dock.destroy(); closePanel(); } };
}
