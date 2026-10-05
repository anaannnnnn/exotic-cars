import * as data from './data/catalog.js';
import { loadStock, stockCar, configuratorMatch } from './data/stock.js';
import { mountHome } from './pages/home.js';
import { mountCar } from './pages/car.js';
import { mountShop, mountShopCar } from './pages/shop.js';
import { mountHub, settleDock } from './pages/hub.js';
import { mountConcierge } from './pages/concierge.js';
import { mountService } from './pages/service.js';
import { mountVR } from './pages/vr.js';
import { mountAccount } from './pages/account.js';
import { initSettings } from './state/settings.js';
import { toast } from './ui/toast.js';
import { initFloatTip } from './ui/float-tip.js';
import { initFx } from './ui/fx.js';

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
  initFloatTip();
  initFx();
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
    } else if (/^#\/home\/?$/.test(hash)) {
      next = mountHub(root);
    } else if (/^#\/service\/?$/.test(hash)) {
      next = mountService(root);
    } else if (/^#\/vr\/?$/.test(hash)) {
      next = mountVR(root);
    } else if (/^#\/account\/?$/.test(hash)) {
      next = mountAccount(root);
    } else if (/^#\/concierge(\/.*)?$/.test(hash)) {
      const q = hash.match(/^#\/concierge\/(.+)$/);
      /* the question in the address is asked once; going back to this page must not ask it again */
      if (q) try { history.replaceState(null, '', '#/concierge'); } catch { /* ignore */ }
      next = mountConcierge(root, q ? decodeURIComponent(q[1]) : '');
    } else {
      next = mountHome(root);
    }
    page = next;
    document.body.dataset.page = next.kind;
    settleDock();
    window.scrollTo(0, next.fresh ? 0 : restore);   /* a page opened afresh (e.g. the shop with a make chosen) starts at the top */
  }

  /* page changes cross-fade with the View Transitions API where the browser has it; the dock keeps its place (it has its
     own transition name), and a change made from the dock slides the way its lens travelled (data-navdir) */
  const html = document.documentElement;
  window.addEventListener('hashchange', () => {
    const calm = html.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (document.startViewTransition && !calm && !document.querySelector('.unveil')) {
      const vt = document.startViewTransition(() => route());
      vt.finished.finally(() => { delete html.dataset.navdir; });
    } else {
      delete html.dataset.navdir;
      route();
    }
  });
  await route();
}
