import { getUser, signIn, signOut } from './settings.js';
import { api, unavailable, ApiError } from '../data/api.js';

/*
 * Customer accounts. With the backend deployed they live on the dealership's server (scrypt-hashed passwords,
 * HttpOnly session cookie), so they work on every device and show up in the CRM. Without it (a static deploy, or
 * offline) they fall back to this device: a salted PBKDF2-SHA-256 hash in localStorage, never the password itself.
 * The pages only use these four functions.
 */
const KEY = 'exotic-accounts-v1';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage unavailable */ } };
const norm = (email) => String(email || '').trim().toLowerCase();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hash(password, salt) {
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 120000 }, keyMat, 256);
  return hex(bits);
}

export const currentUser = getUser;

async function registerHere({ name, email, phone, password }) {
  const id = norm(email);
  const all = read();
  if (all[id]) throw new Error('An account with this email already exists. Sign in instead.');
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  all[id] = { name: name.trim(), email: id, phone: (phone || '').trim(), salt, hash: await hash(password, salt), created: new Date().toISOString() };
  write(all);
  signIn({ name: all[id].name, email: id, phone: all[id].phone });
  return getUser();
}

async function loginHere({ email, password }) {
  const id = norm(email);
  const acct = read()[id];
  if (!acct || (await hash(password, acct.salt)) !== acct.hash) throw new Error('That email and password don’t match an account on this device.');
  signIn({ name: acct.name, email: id, phone: acct.phone });
  return getUser();
}

const fromServer = (u) => { signIn({ name: u.name, email: u.email, phone: u.phone || '', server: true }); return getUser(); };
const say = (e) => new Error(e.fields ? Object.values(e.fields)[0] : e.message);

export async function register({ name, email, phone, password }) {
  try {
    const { user } = await api('auth/register', { method: 'POST', body: { name: name.trim(), email: norm(email), phone: (phone || '').trim(), password } });
    return fromServer(user);
  } catch (e) {
    if (e instanceof ApiError && !unavailable(e)) throw say(e);
    return registerHere({ name, email, phone, password });
  }
}

export async function login({ email, password }) {
  try {
    const { user } = await api('auth/login', { method: 'POST', body: { email: norm(email), password } });
    return fromServer(user);
  } catch (e) {
    if (e instanceof ApiError && !unavailable(e)) {
      /* an account made on this phone before the server existed: move it to the server on first sign-in */
      const acct = read()[norm(email)];
      if (e.status === 401 && acct && (await hash(password, acct.salt)) === acct.hash) {
        try {
          const { user } = await api('auth/register', { method: 'POST', body: { name: acct.name, email: acct.email, phone: acct.phone || '', password } });
          return fromServer(user);
        } catch { return loginHere({ email, password }); }
      }
      throw say(e);
    }
    return loginHere({ email, password });
  }
}

export function logout() {
  if (getUser()?.server) api('auth/logout', { method: 'POST' }).catch(() => {});
  signOut();
}
