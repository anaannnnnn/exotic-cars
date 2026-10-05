import { h, icon } from '../ui.js';
import { api, get, SITE } from '../api.js';

/*
 * Sign-in: a full-bleed photo of a car from the stock, the wordmark, and a short form. On a brand-new site (no staff
 * login yet) the same card asks for the login to be created instead - once, on the first visit.
 */
const HERO = ['6569', '6492', '6516'];

export function mountLogin(root, { notice, onSignedIn }) {
  const email = h('input', { class: 'inp', type: 'text', name: 'email', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, placeholder: 'admin' });
  const password = h('input', { class: 'inp', type: 'password', name: 'password', autocomplete: 'current-password', required: true, placeholder: '••••••••••' });
  const confirm = h('input', { class: 'inp', type: 'password', name: 'confirm', autocomplete: 'new-password', placeholder: 'Type it again' });
  const reveal = h('button', { class: 'iconbtn iconbtn--in', type: 'button', 'aria-label': 'Show password', onclick: () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    confirm.type = password.type;
    reveal.replaceChildren(icon(show ? 'eyeoff' : 'eye'));
    reveal.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  } }, icon('eye'));
  const msg = h('div', { class: 'login__msg', role: 'alert' });
  const btnLabel = h('span', { text: 'Sign in' });
  const btn = h('button', { class: 'btn btn--primary btn--lg btn--block', type: 'submit' }, [btnLabel, icon('arrow')]);
  const title = h('h1', { class: 'login__title', text: 'Welcome back' });
  const lede = h('p', { class: 'login__lede', text: 'Sign in with the dealership’s staff account.' });
  const confirmField = h('label', { class: 'fld', hidden: true }, [h('span', { class: 'fld__label', text: 'Confirm password' }), confirm]);
  const hint = h('small', { class: 'fld__hint', hidden: true, text: 'At least 10 characters. A short sentence is easy to remember and hard to guess.' });
  let mode = 'signin';

  const say = (kind, text, heading) => {
    msg.replaceChildren();
    if (!text) return;
    msg.className = `login__msg login__msg--${kind}`;
    msg.append(icon(kind === 'error' ? 'alert' : kind === 'warn' ? 'lock' : 'done'), h('span', {}, [heading ? h('b', { text: `${heading}. ` }) : null, text]));
  };
  if (notice) say(notice.kind, notice.text, notice.title);

  function setMode(next) {
    mode = next;
    const setup = mode === 'setup';
    title.textContent = setup ? 'Create your login' : 'Welcome back';
    lede.textContent = setup
      ? 'This is a new site. Choose the email and password your team will use for the CRM. This screen appears only once.'
      : 'Sign in with the dealership’s staff account.';
    btnLabel.textContent = setup ? 'Create login and open the CRM' : 'Sign in';
    password.autocomplete = setup ? 'new-password' : 'current-password';
    confirmField.hidden = !setup;
    hint.hidden = !setup;
    card.classList.toggle('is-setup', setup);
  }

  const shake = () => { form.classList.remove('is-shake'); void form.offsetWidth; form.classList.add('is-shake'); };

  const form = h('form', { class: 'login__form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    say();
    const em = email.value.trim();
    if (!em || !password.value) { say('error', 'Enter your username and password.'); shake(); return; }
    if (mode === 'setup') {
      if (password.value.length < 10) { say('error', 'Use at least 10 characters for the password.'); password.focus(); shake(); return; }
      if (password.value !== confirm.value) { say('error', 'The two passwords do not match.'); confirm.focus(); shake(); return; }
    }
    btn.disabled = true;
    form.classList.add('is-busy');
    try {
      const s = await api(mode === 'setup' ? 'admin/setup' : 'admin/session', { method: 'POST', body: { email: em, password: password.value } });
      if (s.importError) say('warn', s.importError);
      onSignedIn({ email: s.email, expiresAt: s.expiresAt, imported: s.imported, created: s.created });
    } catch (err) {
      if (err.status === 409 && mode === 'setup') { setMode('signin'); say('warn', err.message); }
      else if (err.status === 409) { setMode('setup'); say('warn', err.message); }
      else say(err.status === 503 || err.status === 429 ? 'warn' : 'error', err.fields ? Object.values(err.fields)[0] : err.message, err.status === 503 ? err.title : null);
      password.select();
      shake();
    } finally {
      btn.disabled = false;
      form.classList.remove('is-busy');
    }
  } }, [
    h('label', { class: 'fld' }, [h('span', { class: 'fld__label', text: 'Username or email' }), email]),
    h('label', { class: 'fld' }, [h('span', { class: 'fld__label', text: 'Password' }), h('span', { class: 'inp-wrap' }, [password, reveal]), hint]),
    confirmField,
    msg, btn
  ]);

  const card = h('div', { class: 'login__card' }, [
    h('div', { class: 'brand brand--lg' }, [h('span', { class: 'brand__mark', text: 'EXOTIC' }), h('span', { class: 'brand__sub', text: 'Dealer CRM' })]),
    title, lede, form,
    h('a', { class: 'login__site', href: SITE }, [icon('left'), 'Back to the website'])
  ]);

  const hero = HERO[Math.floor(Math.random() * HERO.length)];
  root.append(h('div', { class: 'login' }, [
    h('div', { class: 'login__art', 'aria-hidden': 'true' }, [
      h('img', { src: `${SITE}stock/${hero}.webp`, alt: '', decoding: 'async' }),
      h('div', { class: 'login__shade' }),
      h('div', { class: 'login__claim' }, [
        h('span', { class: 'login__eyebrow', text: 'Exotic Cars · Dubai' }),
        h('p', { class: 'login__line', text: 'Every car, every lead, every booking — in one place.' })
      ])
    ]),
    h('div', { class: 'login__side' }, [card, h('p', { class: 'login__legal', text: 'Staff only. Sign-ins are logged.' })])
  ]));
  setTimeout(() => email.focus(), 50);

  /* a brand-new site has no login yet: offer to create it; a static-only deploy has no backend at all */
  get('admin/setup').then((r) => { if (r.needed) setMode('setup'); })
    .catch((e) => { if (!notice && (e.status === 503 || e.title === 'Backend not deployed')) say('warn', e.message, e.title); });
}
