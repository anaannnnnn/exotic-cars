import '@fontsource/michroma/400.css';
import '@fontsource-variable/instrument-sans/wdth.css';
import '@fontsource-variable/archivo/wdth.css';
import './admin.css';
import { api, get, del, setUnauthorizedHandler, SITE } from './api.js';
import { h, icon, clear, toast } from './ui.js';
import { mountLogin } from './views/login.js';
import { mountDashboard } from './views/dashboard.js';
import { mountInventory } from './views/inventory.js';
import { mountCarEditor } from './views/car-editor.js';
import { mountProducts } from './views/products.js';
import { mountProductEditor } from './views/product-editor.js';
import { mountLeads } from './views/leads.js';
import { mountAppointments } from './views/appointments.js';
import { mountCustomers } from './views/customers.js';
import { mountSettings } from './views/settings.js';
import { mountForecast } from './views/forecast.js';

/*
 * Exotic Cars CRM (/admin/). A small single-page app on the same origin as the site: the session is an HttpOnly cookie
 * set by POST /api/v1/admin/session, so no token is ever visible to scripts here.
 *   #/                dashboard          #/inventory[/new|/<id>]     cars
 *   #/products[/new|/<id>]  wheels, kits #/leads[/<id>]              pipeline
 *   #/appointments    bookings           #/customers  #/settings
 */
const root = document.getElementById('crm');

/* ---------------------------------------------------------------- theme */
const THEME_KEY = 'exotic-crm-theme';
const storedTheme = () => { try { return localStorage.getItem(THEME_KEY); } catch { return null; } };
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0a0708' : '#f6f2f1');
}
applyTheme(storedTheme() || 'dark');
export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode */ }
  applyTheme(next);
  document.querySelectorAll('[data-theme-btn]').forEach(paintThemeBtn);
}
function paintThemeBtn(b) {
  const dark = document.documentElement.dataset.theme === 'dark';
  b.replaceChildren(icon(dark ? 'sun' : 'moon'), b.dataset.label === 'on' ? h('span', { text: dark ? 'Light mode' : 'Dark mode' }) : '');
  b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
}
const themeBtn = (withLabel = false) => {
  const b = h('button', { class: withLabel ? 'side__link' : 'iconbtn', type: 'button', dataset: { themeBtn: '', label: withLabel ? 'on' : 'off' }, onclick: toggleTheme });
  paintThemeBtn(b);
  return b;
};

/* ---------------------------------------------------------------- routes */
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', href: '#/' },
  { id: 'forecast', label: 'Forecast', icon: 'trend', href: '#/forecast' },
  { id: 'leads', label: 'Leads', icon: 'leads', href: '#/leads', badge: 'leads' },
  { id: 'appointments', label: 'Bookings', icon: 'calendar', href: '#/appointments', badge: 'appointments' },
  { id: 'inventory', label: 'Inventory', icon: 'car', href: '#/inventory' },
  { id: 'products', label: 'Wheels & kits', icon: 'wheel', href: '#/products' },
  { id: 'customers', label: 'Customers', icon: 'users', href: '#/customers' },
  { id: 'settings', label: 'Settings', icon: 'settings', href: '#/settings' }
];
const TABS = ['dashboard', 'forecast', 'leads', 'appointments', 'inventory'];

function resolve(hash) {
  const parts = hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
  const [section = 'dashboard', sub] = parts;
  switch (section) {
    case 'dashboard': return { nav: 'dashboard', mount: mountDashboard };
    case 'forecast': return { nav: 'forecast', mount: mountForecast };
    case 'inventory': return sub ? { nav: 'inventory', mount: mountCarEditor, params: { id: sub } } : { nav: 'inventory', mount: mountInventory };
    case 'products': return sub ? { nav: 'products', mount: mountProductEditor, params: { id: sub } } : { nav: 'products', mount: mountProducts };
    case 'leads': return { nav: 'leads', mount: mountLeads, params: { id: sub } };
    case 'appointments': return { nav: 'appointments', mount: mountAppointments, params: { id: sub } };
    case 'customers': return { nav: 'customers', mount: mountCustomers, params: { id: sub } };
    case 'settings': return { nav: 'settings', mount: mountSettings };
    default: return { nav: 'dashboard', mount: mountDashboard };
  }
}

/* ---------------------------------------------------------------- shell */
let session = null;
let current = null;
let shell = null;

function buildShell() {
  const badges = {};
  const link = (n, cls) => {
    const b = n.badge ? (badges[`${n.badge}-${cls}`] = h('span', { class: 'nbadge', hidden: true })) : null;
    return h('a', { class: cls, href: n.href, dataset: { nav: n.id } }, [icon(n.icon), h('span', { class: `${cls}__t`, text: n.label }), b]);
  };
  const more = h('div', { class: 'more', hidden: true }, [
    h('div', { class: 'more__scrim', onclick: () => { more.hidden = true; } }),
    h('div', { class: 'more__panel' }, [
      ...NAV.filter((n) => !TABS.includes(n.id)).map((n) => { const a = link(n, 'more__link'); a.addEventListener('click', () => { more.hidden = true; }); return a; }),
      h('a', { class: 'more__link', href: SITE, target: '_blank', rel: 'noopener' }, [icon('open'), h('span', { text: 'Open the website' })]),
      themeBtn(true),
      h('button', { class: 'more__link', type: 'button', onclick: signOut }, [icon('logout'), h('span', { text: 'Sign out' })])
    ])
  ]);
  const view = h('main', { class: 'view', id: 'view', tabindex: '-1' });
  const el = h('div', { class: 'crm' }, [
    h('aside', { class: 'side' }, [
      h('a', { class: 'brand', href: '#/' }, [h('span', { class: 'brand__mark', text: 'EXOTIC' }), h('span', { class: 'brand__sub', text: 'Dealer CRM' })]),
      h('nav', { class: 'side__nav', 'aria-label': 'Sections' }, NAV.map((n) => link(n, 'side__item'))),
      h('div', { class: 'side__foot' }, [
        h('a', { class: 'side__link', href: SITE, target: '_blank', rel: 'noopener' }, [icon('open'), h('span', { text: 'Open the website' })]),
        themeBtn(true),
        h('div', { class: 'me' }, [
          h('span', { class: 'me__av', text: (session.email[0] || '?').toUpperCase() }),
          h('span', { class: 'me__t' }, [h('b', { text: 'Signed in' }), h('small', { text: session.email })]),
          h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Sign out', title: 'Sign out', onclick: signOut }, icon('logout'))
        ])
      ])
    ]),
    h('div', { class: 'crm__main' }, [
      h('header', { class: 'mtop' }, [
        h('a', { class: 'brand brand--sm', href: '#/' }, [h('span', { class: 'brand__mark', text: 'EXOTIC' }), h('span', { class: 'brand__sub', text: 'CRM' })]),
        themeBtn()
      ]),
      view
    ]),
    h('nav', { class: 'tabbar', 'aria-label': 'Sections' }, [
      ...NAV.filter((n) => TABS.includes(n.id)).map((n) => link(n, 'tab')),
      h('button', { class: 'tab', type: 'button', onclick: () => { more.hidden = !more.hidden; } }, [icon('menu'), h('span', { class: 'tab__t', text: 'More' })])
    ]),
    more
  ]);
  return { el, view, badges };
}

async function refreshBadges() {
  if (!shell) return;
  try {
    const s = await get('admin/stats');
    const set = (key, n) => Object.entries(shell.badges).forEach(([k, b]) => { if (k.startsWith(key)) { b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n); } });
    set('leads', s.leads.byStatus.new);
    set('appointments', s.appointments.byStatus.requested);
    return s;
  } catch { return null; }
}

async function route() {
  if (!session) return;
  current?.destroy?.();
  current = null;
  const r = resolve(location.hash);
  shell.el.querySelectorAll('[data-nav]').forEach((a) => { if (a.dataset.nav === r.nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  clear(shell.view);
  shell.view.style.animation = 'none';
  void shell.view.offsetWidth;   /* replay the entrance for each page */
  shell.view.style.animation = '';
  shell.view.scrollTop = 0;
  window.scrollTo(0, 0);
  const ctx = { session, refreshBadges, go: (hash) => { location.hash = hash; }, reload: route };
  try {
    current = (await r.mount(shell.view, r.params || {}, ctx)) || null;
  } catch (e) {
    console.error(e);
    shell.view.append(h('p', { class: 'empty', text: e.message }));
  }
  shell.view.focus({ preventScroll: true });
}

function start(s) {
  session = s;
  clear(root);
  shell = buildShell();
  root.append(shell.el);
  refreshBadges();
  route();
}

async function signOut() {
  try { await del('admin/session'); } catch { /* the cookie expires anyway */ }
  session = null;
  shell = null;
  current?.destroy?.();
  showLogin();
  toast('Signed out');
}

function showLogin(notice) {
  session = null;
  shell = null;
  clear(root);
  mountLogin(root, { notice, onSignedIn: (s) => {
    if (!location.hash || location.hash === '#') location.hash = '#/';
    start(s);
    if (s.created) toast('Your login is ready. The site’s cars, wheels and kits are now in the CRM.');
  } });
}

setUnauthorizedHandler(() => { if (session) showLogin({ kind: 'info', text: 'Your session ended. Sign in again to continue.' }); });
window.addEventListener('hashchange', route);
setInterval(() => { if (session && !document.hidden) refreshBadges(); }, 60000);

(async function boot() {
  root.append(h('div', { class: 'boot' }, [h('span', { class: 'brand__mark', text: 'EXOTIC' }), h('span', { class: 'boot__bar' })]));
  try {
    start(await get('admin/session'));
  } catch (e) {
    if (e.status === 401) showLogin();
    else if (e.status === 503 && e.title === 'Not configured') showLogin({ kind: 'warn', text: e.message });
    else showLogin({ kind: 'warn', text: e.message, title: e.title });
  }
})();

export { api };
