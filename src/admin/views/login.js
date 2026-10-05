import { h, icon } from '../ui.js';
import { api, get, SITE } from '../api.js';

/* Sign-in: a full-bleed photo of a car from the stock, the wordmark, and a short form. */
const HERO = ['6569', '6492', '6516'];

export function mountLogin(root, { notice, onSignedIn }) {
  const email = h('input', { class: 'inp', type: 'email', name: 'email', autocomplete: 'username', required: true, placeholder: 'you@exoticcars.ae' });
  const password = h('input', { class: 'inp', type: 'password', name: 'password', autocomplete: 'current-password', required: true, placeholder: '••••••••••' });
  const reveal = h('button', { class: 'iconbtn iconbtn--in', type: 'button', 'aria-label': 'Show password', onclick: () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    reveal.replaceChildren(icon(show ? 'eyeoff' : 'eye'));
    reveal.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  } }, icon('eye'));
  const msg = h('div', { class: 'login__msg', role: 'alert' });
  const btn = h('button', { class: 'btn btn--primary btn--lg btn--block', type: 'submit' }, [h('span', { text: 'Sign in' }), icon('arrow')]);

  const say = (kind, text, title) => {
    msg.replaceChildren();
    if (!text) return;
    msg.className = `login__msg login__msg--${kind}`;
    msg.append(icon(kind === 'error' ? 'alert' : kind === 'warn' ? 'lock' : 'done'), h('span', {}, [title ? h('b', { text: `${title}. ` }) : null, text]));
  };
  if (notice) say(notice.kind, notice.text, notice.title);

  const form = h('form', { class: 'login__form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    if (!email.value.trim() || !password.value) { say('error', 'Enter your email and password.'); return; }
    btn.disabled = true;
    form.classList.add('is-busy');
    try {
      const s = await api('admin/session', { method: 'POST', body: { email: email.value.trim(), password: password.value } });
      if (s.importError) say('warn', s.importError);
      onSignedIn({ email: s.email, expiresAt: s.expiresAt, imported: s.imported });
    } catch (err) {
      say(err.status === 503 || err.status === 429 ? 'warn' : 'error', err.message, err.status === 503 ? err.title : null);
      password.select();
      form.classList.remove('is-shake'); void form.offsetWidth; form.classList.add('is-shake');
    } finally {
      btn.disabled = false;
      form.classList.remove('is-busy');
    }
  } }, [
    h('label', { class: 'fld' }, [h('span', { class: 'fld__label', text: 'Email' }), email]),
    h('label', { class: 'fld' }, [h('span', { class: 'fld__label', text: 'Password' }), h('span', { class: 'inp-wrap' }, [password, reveal])]),
    msg, btn
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
    h('div', { class: 'login__side' }, [
      h('div', { class: 'login__card' }, [
        h('div', { class: 'brand brand--lg' }, [h('span', { class: 'brand__mark', text: 'EXOTIC' }), h('span', { class: 'brand__sub', text: 'Dealer CRM' })]),
        h('h1', { class: 'login__title', text: 'Welcome back' }),
        h('p', { class: 'login__lede', text: 'Sign in with the dealership’s staff account.' }),
        form,
        h('a', { class: 'login__site', href: SITE }, [icon('left'), 'Back to the website'])
      ]),
      h('p', { class: 'login__legal', text: 'Staff only. Sign-ins are logged.' })
    ])
  ]));
  setTimeout(() => email.focus(), 50);

  /* tell staff up front when the server side is not ready */
  if (!notice) {
    get('health').then((hl) => {
      if (!hl.crm) say('warn', 'Add ADMIN_EMAIL, ADMIN_PASSWORD_HASH and SESSION_SECRET in Netlify → Site configuration → Environment variables, then redeploy.', 'CRM sign-in not set up');
    }).catch((e) => { if (e.title === 'Backend not deployed') say('warn', e.message, e.title); });
  }
}
