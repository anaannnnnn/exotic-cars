import { getUser, signIn, signOut } from './settings.js';

/*
 * Customer accounts, kept on this device until the dealership's account server is connected.
 * Passwords are never stored: only a salted PBKDF2-SHA-256 hash (Web Crypto). Swap register/login for API calls later;
 * the pages only use these four functions.
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

export async function register({ name, email, phone, password }) {
  const id = norm(email);
  const all = read();
  if (all[id]) throw new Error('An account with this email already exists. Sign in instead.');
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  all[id] = { name: name.trim(), email: id, phone: (phone || '').trim(), salt, hash: await hash(password, salt), created: new Date().toISOString() };
  write(all);
  signIn({ name: all[id].name, email: id, phone: all[id].phone });
  return getUser();
}

export async function login({ email, password }) {
  const id = norm(email);
  const acct = read()[id];
  if (!acct || (await hash(password, acct.salt)) !== acct.hash) throw new Error('That email and password don’t match an account on this device.');
  signIn({ name: acct.name, email: id, phone: acct.phone });
  return getUser();
}

export function logout() { signOut(); }
