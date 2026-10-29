import '@fontsource/michroma/400.css';
import '@fontsource-variable/instrument-sans/wdth.css';
import '@fontsource-variable/archivo/wdth.css';
import './admin.css';
import { api, get, del, setUnauthorizedHandler, SITE } from './api.js';
import { h, icon, clear, toast, can, ROLE, ping, closeDrawers } from './ui.js';
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
import { mountAds } from './views/ads.js';
import { mountTransactions } from './views/transactions.js';
import { mountApprovals } from './views/approvals.js';
import { mountActivity } from './views/activity.js';
import { mountTeam } from './views/team.js';
import { mountForecast } from './views/forecast.js';
import { mountPurchasing } from './views/purchasing.js';
import { mountWorkshop } from './views/workshop.js';
import './pro.css';
import './planning.css';
import './noir.css';

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
const NAV_ALL = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', href: '#/' },
  { id: 'leads', label: 'Leads', icon: 'leads', href: '#/leads', badge: 'leads', roles: ['owner', 'manager', 'sales'] },
  { id: 'approvals', label: 'Approvals', icon: 'approve', href: '#/approvals', badge: 'approvals', roles: ['owner', 'manager'] },
  { id: 'appointments', label: 'Bookings', icon: 'calendar', href: '#/appointments', badge: 'appointments' },
  { id: 'workshop', label: 'Workshop', icon: 'wrench', href: '#/workshop', badge: 'jobs' },
  { id: 'inventory', label: 'Inventory', icon: 'car', href: '#/inventory', roles: ['owner', 'manager', 'sales'] },
  { id: 'sales', label: 'Sales', icon: 'trend', href: '#/sales', roles: ['owner', 'manager'] },
  { id: 'purchases', label: 'Purchases', icon: 'cart', href: '#/purchases', roles: ['owner', 'manager'] },
  { id: 'ads', label: 'Advertisements', icon: 'photo', href: '#/ads', roles: ['owner', 'manager'] },
  { id: 'products', label: 'Wheels & kits', icon: 'wheel', href: '#/products', roles: ['owner', 'manager'] },
  { id: 'customers', label: 'Customers', icon: 'users', href: '#/customers' },
  { id: 'forecast', label: 'Forecast', icon: 'trend', href: '#/forecast', roles: ['owner', 'manager'] },
  { id: 'purchasing', label: 'Purchasing AI', icon: 'cart', href: '#/purchasing', roles: ['owner', 'manager'] },
  { id: 'activity', label: 'Activity', icon: 'history', href: '#/activity' },
  { id: 'team', label: 'Team', icon: 'adduser', href: '#/team', roles: ['owner', 'manager'] },
  { id: 'settings', label: 'Settings', icon: 'settings', href: '#/settings' }
];
let NAV = NAV_ALL;
const TAB_PICK = { owner: ['dashboard', 'leads', 'approvals', 'workshop'], manager: ['dashboard', 'leads', 'approvals', 'workshop'], sales: ['dashboard', 'leads', 'appointments', 'inventory'], service: ['dashboard', 'workshop', 'appointments', 'customers'] };
let TABS = TAB_PICK.owner;

function resolve(hash) {
  const parts = hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
  const [section = 'dashboard', sub] = parts;
  const allowed = (id) => NAV.some((n) => n.id === id);
  const pick = (id, r) => (allowed(id) ? r : { nav: 'dashboard', mount: mountDashboard });
  switch (section) {
    case 'dashboard': return { nav: 'dashboard', mount: mountDashboard };
    case 'sales': return pick('sales', { nav: 'sales', mount: mountTransactions, params: { type: 'sale' } });
    case 'purchases': return pick('purchases', { nav: 'purchases', mount: mountTransactions, params: { type: 'purchase' } });
    case 'ads': return pick('ads', { nav: 'ads', mount: mountAds });
    case 'inventory': return pick('inventory', sub ? { nav: 'inventory', mount: mountCarEditor, params: { id: sub } } : { nav: 'inventory', mount: mountInventory });
    case 'products': return pick('products', sub ? { nav: 'products', mount: mountProductEditor, params: { id: sub } } : { nav: 'products', mount: mountProducts });
    case 'leads': return pick('leads', { nav: 'leads', mount: mountLeads, params: { id: sub } });
    case 'approvals': return pick('approvals', { nav: 'approvals', mount: mountApprovals });
    case 'appointments': return { nav: 'appointments', mount: mountAppointments, params: { id: sub } };
    case 'workshop': return { nav: 'workshop', mount: mountWorkshop, params: { id: sub } };
    case 'customers': return { nav: 'customers', mount: mountCustomers, params: { id: sub } };
    case 'forecast': return pick('forecast', { nav: 'forecast', mount: mountForecast });
    case 'purchasing': return pick('purchasing', { nav: 'purchasing', mount: mountPurchasing });
    case 'activity': return { nav: 'activity', mount: mountActivity };
    case 'team': return pick('team', { nav: 'team', mount: mountTeam });
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
          h('span', { class: 'me__av', text: ((session.name || session.email)[0] || '?').toUpperCase() }),
          h('span', { class: 'me__t' }, [h('b', { text: session.name || 'Signed in' }), h('small', { text: `${ROLE[session.role]?.label || 'Staff'} · ${session.email}` })]),
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
    const set = (key, n, hot) => Object.entries(shell.badges).forEach(([k, b]) => { if (k.startsWith(key)) { b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n); b.classList.toggle('nbadge--hot', Boolean(hot)); } });
    const hl = s.health || {};
    set('leads', (s.leads.byStatus.new || 0) + (hl.overdue || 0), hl.overdue);
    set('appointments', s.appointments.byStatus.requested);
    set('approvals', hl.pendingApprovals, hl.pendingApprovals);
    set('jobs', s.workshop?.requested || 0);
    return s;
  } catch { return null; }
}

/* ---------------------------------------------------------------- live: the server tells every open screen what just happened */
const SOUND_KEY = 'exotic-crm-sound';
export const soundOn = () => { try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; } };
let es = null, refreshTimer = 0;
function live() {
  es?.close();
  if (!('EventSource' in window)) return;
  es = new EventSource(`${new URL('../api/v1/', location.href).pathname}admin/events`);
  es.onmessage = (m) => {
    let e; try { e = JSON.parse(m.data); } catch { return; }
    const say = (text, hash) => { toast(text); if (soundOn()) ping(); if (hash) shell?.el.querySelector('.live__last')?.setAttribute('href', hash); };
    if (e.type === 'lead.new') say(`New lead: ${e.name}${e.car ? ` · ${e.car}` : ''}`);
    else if (e.type === 'approval.requested') say(`${e.byName} asks to approve AED ${Number(e.amount).toLocaleString('en-AE')} off ${e.name}`);
    else if (e.type === 'approval.decided' && e.to === session?.email) say(`Your discount was ${e.decision}`);
    else if (e.type === 'appointment.new') say(`New booking: ${e.service} · ${e.name}`);
    else if (e.type === 'job.updated' && e.customer) say(`Customer answered the quote on ${e.ref}`);
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { refreshBadges(); current?.live?.(e); }, 350);
  };
  es.onerror = () => { /* the browser reconnects by itself */ };
}

async function route() {
  if (!session) return;
  closeDrawers();
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
  NAV = NAV_ALL.filter((n) => !n.roles || n.roles.includes(s.role || 'owner'));
  TABS = TAB_PICK[s.role || 'owner'];
  clear(root);
  shell = buildShell();
  root.append(shell.el);
  refreshBadges();
  route();
  live();
}

async function signOut() {
  es?.close();
  try { await del('admin/session'); } catch { /* the cookie expires anyway */ }
  session = null;
  shell = null;
  current?.destroy?.();
  showLogin();
  toast('Signed out');
}

function showLogin(notice) {
  es?.close();
  session = null;
  shell = null;
  clear(root);
  mountLogin(root, { notice, onSignedIn: async (s0) => {
    if (!location.hash || location.hash === '#') location.hash = '#/';
    const s = { ...s0, ...(await get('admin/session').catch(() => ({}))), created: s0.created };
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
