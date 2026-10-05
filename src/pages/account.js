import * as stock from '../data/stock.js';
import { h, icon, clear } from '../ui/dom.js';
import { closePanel, openSettings } from '../ui/panels.js';
import { toast } from '../ui/toast.js';
import { getAppointments } from '../state/settings.js';
import { currentUser, register, login, logout } from '../state/accounts.js';
import { segmented, field } from '../ui/kit.js';
import { mainDock } from './hub.js';

/* Account: sign in / create an account (a dark hero with a white sheet rising over it), or the signed-in profile. */

function passwordField(label, name, autocomplete) {
  const f = field({ label, name, type: 'password', autocomplete, required: true });
  const eye = h('button', { class: 'ff__eye', type: 'button', 'aria-label': 'Show password', 'aria-pressed': 'false' }, [icon('eye'), icon('eyeoff')]);
  eye.addEventListener('click', () => {
    const show = f.input.type === 'password';
    f.input.type = show ? 'text' : 'password';
    eye.setAttribute('aria-pressed', String(show));
    eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
  f.el.append(eye);
  f.el.classList.add('ff--pw');
  return f;
}
function strength(pw) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

export function mountAccount(root) {
  const user = currentUser();
  const dock = mainDock('account');
  const cover = stock.queryStock({ tab: 'sale' }).find((c) => /urus|sf90|cullinan|revuelto|296/i.test(c.title)) || stock.queryStock({ tab: 'sale' })[0];
  const main = h('main', { class: `acct${user ? ' is-in' : ''}` });
  root.append(main);

  function renderAuth(mode = 'in') {
    clear(main);
    const err = h('p', { class: 'form__err', role: 'alert' });
    const email = field({ label: 'Email', name: 'email', type: 'email', autocomplete: 'email', required: true });
    const pw = passwordField('Password', 'password', mode === 'in' ? 'current-password' : 'new-password');
    const name = field({ label: 'Full name', name: 'name', autocomplete: 'name', required: true });
    const phone = field({ label: 'Phone (optional)', name: 'phone', type: 'tel', autocomplete: 'tel', inputmode: 'tel' });
    const meter = h('div', { class: 'meter', 'aria-hidden': 'true' }, [h('i'), h('i'), h('i'), h('i')]);
    const meterText = h('small', { class: 'meter__t', 'aria-live': 'polite' });
    pw.input.addEventListener('input', () => {
      const s = strength(pw.input.value);
      meter.dataset.s = String(s);
      meterText.textContent = pw.input.value ? ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][s] : '';
    });
    const consent = h('label', { class: 'consent' }, [h('input', { type: 'checkbox', required: true }), h('span', { text: 'I agree to be contacted about my enquiries and bookings.' })]);
    const submit = h('button', { class: 'pill pill--ink pill--lg', type: 'submit' }, [h('span', { class: 'sub-label' }), icon('right')]);
    const signupOnly = h('div', { class: 'acct__only' }, [name.el, phone.el]);
    const pwExtra = h('div', { class: 'acct__only' }, [h('div', { class: 'meter-row' }, [meter, meterText]), consent]);

    const form = h('form', { class: 'acct__form', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      const em = email.input.value.trim();
      if (mode === 'up' && !name.input.value.trim()) { err.textContent = 'Enter your name.'; name.input.focus(); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { err.textContent = 'Enter a valid email address.'; email.input.focus(); return; }
      if (mode === 'up' && pw.input.value.length < 8) { err.textContent = 'Use at least 8 characters for your password.'; pw.input.focus(); return; }
      if (!pw.input.value) { err.textContent = 'Enter your password.'; pw.input.focus(); return; }
      if (mode === 'up' && !consent.querySelector('input').checked) { err.textContent = 'Please accept to be contacted about your bookings.'; return; }
      submit.disabled = true;
      main.classList.add('is-busy');
      try {
        const u = mode === 'in' ? await login({ email: em, password: pw.input.value }) : await register({ name: name.input.value, email: em, phone: phone.input.value, password: pw.input.value });
        toast(`Welcome${u?.name ? `, ${u.name.split(' ')[0]}` : ''}`);
        location.hash = '#/home';
      } catch (ex) {
        err.textContent = ex.message;
        form.classList.remove('is-shake'); void form.offsetWidth; form.classList.add('is-shake');
      } finally { submit.disabled = false; main.classList.remove('is-busy'); }
    } }, [signupOnly, email.el, pw.el, pwExtra, err, submit]);

    const seg = segmented([{ id: 'in', label: 'Sign in' }, { id: 'up', label: 'Create account' }], mode, (m) => { mode = m; apply(); }, { label: 'Account', full: true });
    const title = h('h1', { class: 'acct__title' });
    const lede = h('p', { class: 'acct__lede' });
    const switchLink = h('button', { class: 'acct__switch', type: 'button', onclick: () => { mode = mode === 'in' ? 'up' : 'in'; seg.select(mode); apply(); } });
    function apply() {
      form.dataset.mode = mode;
      title.textContent = mode === 'in' ? 'Welcome back.' : 'Join Exotic Cars.';
      lede.textContent = mode === 'in' ? 'Sign in to see your requests and saved builds.' : 'One account for bookings, builds and your concierge history.';
      submit.querySelector('.sub-label').textContent = mode === 'in' ? 'Sign in' : 'Create account';
      pw.input.autocomplete = mode === 'in' ? 'current-password' : 'new-password';
      switchLink.textContent = mode === 'in' ? 'New here? Create an account' : 'Already have an account? Sign in';
      err.textContent = '';
    }
    apply();

    main.append(
      h('section', { class: 'acct__hero' }, [
        h('img', { class: 'acct__img', src: stock.coverUrl(cover), alt: '', onerror: (e) => { if (e.target.src !== cover.cover) e.target.src = cover.cover; } }),
        h('div', { class: 'acct__veil', 'aria-hidden': 'true' }),
        h('a', { class: 'circle-btn circle-btn--glass acct__back', href: '#/home', 'aria-label': 'Back home' }, icon('back')),
        h('div', { class: 'acct__brand' }, [h('span', { class: 'acct__mark', text: 'EXOTIC' }), h('span', { class: 'acct__sub', text: 'Private client access' })])
      ]),
      h('section', { class: 'acct__sheet' }, [
        title, lede, seg.el, form, switchLink,
        h('ul', { class: 'perks' }, [['calendar', 'Bookings and repairs in one place'], ['model', 'Save and share your 3D builds'], ['spark', 'Your concierge remembers you']].map(([ic, t]) => h('li', {}, [h('span', { class: 'perks__ic' }, icon(ic)), t]))),
        h('p', { class: 'acct__note', text: 'Your account is kept securely on this device; it moves to the dealership’s servers once they are connected. Passwords are stored only as a salted hash.' })
      ]),
      h('div', { class: 'dockbar' }, dock.el)
    );
    requestAnimationFrame(() => { if (matchMedia('(hover: hover)').matches) (mode === 'in' ? email : name).input.focus({ preventScroll: true }); });
  }

  function renderProfile(u) {
    clear(main);
    const reqs = getAppointments().slice(0, 6);
    main.append(
      h('div', { class: 'hub__glow', 'aria-hidden': 'true' }),
      h('header', { class: 'phead' }, [h('a', { class: 'circle-btn', href: '#/home', 'aria-label': 'Back home' }, icon('back')), h('div', { class: 'phead__t' }, [h('h1', { text: 'Account' })]), h('button', { class: 'circle-btn', type: 'button', 'aria-label': 'Settings', 'data-tip': 'Settings', onclick: openSettings }, icon('gear'))]),
      h('section', { class: 'prof' }, [
        h('span', { class: 'prof__av', text: (u.name || u.email || '?').trim()[0].toUpperCase() }),
        h('h2', { text: u.name || 'Guest' }),
        h('p', { text: [u.email, u.phone].filter(Boolean).join(' · ') })
      ]),
      h('div', { class: 'sect-head' }, [h('h2', { text: 'Your requests' }), h('a', { class: 'sect-head__link', href: '#/service' }, ['New', icon('right')])]),
      reqs.length ? h('ul', { class: 'mine__list mine__list--pad' }, reqs.map((a) => h('li', { class: 'mine__row' }, [
        h('span', { class: 'mine__ic' }, icon(/repair/i.test(a.service) ? 'wrench' : /call/i.test(a.service) ? 'phone' : /drive/i.test(a.service) ? 'gauge' : 'calendar')),
        h('span', { class: 'mine__t' }, [h('b', { text: a.service }), h('small', { text: [a.car, a.date, a.slot].filter(Boolean).join(' · ') })]),
        h('span', { class: 'mine__ref', text: a.ref })
      ]))) : h('p', { class: 'pg__note', text: 'No requests yet. Book a service or a test drive and it appears here.' }),
      h('div', { class: 'prof__actions' }, [
        h('a', { class: 'pill pill--line pill--lg', href: '#/concierge' }, [icon('spark'), 'Ask the concierge']),
        h('button', { class: 'pill pill--ink pill--lg', type: 'button', onclick: () => { logout(); toast('Signed out'); renderAuth('in'); main.classList.remove('is-in'); } }, [icon('logout'), 'Sign out'])
      ]),
      h('div', { class: 'dockbar' }, dock.el)
    );
  }

  if (user) renderProfile(user); else renderAuth('in');
  return { kind: 'account', destroy() { dock.destroy(); closePanel(); } };
}
