import * as data from './data/catalog.js';
import { loadStock, stockCar, configuratorMatch } from './data/stock.js';
import { mountHome } from './pages/home.js';
import { mountCar } from './pages/car.js';
import { mountShop, mountShopCar } from './pages/shop.js';
import { initSettings } from './state/settings.js';
import { toast } from './ui/toast.js';

const BASE = import.meta.env.BASE_URL;

/*
 * Hash router
 *   #/                       home dock
 *   #/shop                   the dealership's stock       #/shop/<id>              one stock car
 *   #/shop/<id>/configure    3D configurator for that car (colour, wheels, aero)
 * There is no separate model list: configuration lives inside each inventory car.
 */
export async function boot() {
  initSettings();
  await data.loadCatalog(`${BASE}data/`);
  const root = document.getElementById('app');
  let page = null;
  let token = 0;
  const scroll = { shop: 0 };

  async function route() {
    const my = ++token;
    const hash = location.hash;
    if (page) {
      if (page.kind in scroll) scroll[page.kind] = window.scrollY;
      page.destroy();
      page = null;
    }
    root.textContent = '';

    try { await loadStock(); } catch (e) { toast(e.message); return; }
    if (my !== token) return;

    const configure = hash.match(/^#\/shop\/(\d+)\/configure(?:\/(.+))?$/);
    const shopCar = hash.match(/^#\/shop\/(\d+)\/?$/);
    let next = null;
    let restore = 0;

    if (configure) {
      const car = stockCar(configure[1]);
      const match = car && configuratorMatch(car);
      if (!car || !match) { location.hash = car ? `#/shop/${car.id}` : '#/shop'; return; }
      next = mountCar(root, match.id, configure[2] || null, { toast, stock: car, vehicle: match, base: `#/shop/${car.id}/configure`, back: { href: `#/shop/${car.id}`, label: 'Car details' } });
    } else if (shopCar) {
      next = mountShopCar(root, shopCar[1]);
      if (!next) { location.hash = '#/shop'; return; }
    } else if (/^#\/shop\/?$/.test(hash)) {
      next = mountShop(root);
      restore = scroll.shop;
    } else {
      next = mountHome(root);
    }
    page = next;
    document.body.dataset.page = next.kind;
    window.scrollTo(0, restore);
  }

  window.addEventListener('hashchange', route);
  await route();
}
