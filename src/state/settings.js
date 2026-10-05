/* Device-local preferences, the signed-in visitor and a copy of the visitor's appointment requests. */
const KEY = 'apex-settings-v1';
const USER = 'apex-user-v1';
const APPTS = 'apex-appointments-v1';

const defaults = { dark: false, hidePrices: false, reduceMotion: false };
let settings = { ...defaults };
const listeners = new Set();

const read = (k, fallback) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? fallback; } catch { return fallback; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

/* until the visitor picks a theme, the device's own light/dark setting decides */
const systemDark = () => { try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; } };

export function initSettings() {
  const saved = read(KEY, {});
  settings = { ...defaults, dark: systemDark(), ...saved };
  applySettings();
}

export const getSettings = () => settings;
export const onSettings = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export function setSetting(key, value) {
  settings = { ...settings, [key]: value };
  write(KEY, settings);
  applySettings();
  listeners.forEach((fn) => fn(settings));
}

function applySettings() {
  const root = document.documentElement;
  root.dataset.theme = settings.dark ? 'dark' : 'light';
  root.dataset.motion = settings.reduceMotion ? 'reduce' : 'full';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', settings.dark ? '#0a0708' : '#f6f2f1');
}

/* visitor (name + email only, kept on this device) */
export const getUser = () => read(USER, null);
export const signIn = (user) => write(USER, user);
export const signOut = () => { try { localStorage.removeItem(USER); } catch { /* ignore */ } };

/* appointment requests */
export const getAppointments = () => read(APPTS, []);
/** Keep a copy of a request on this device for "Your requests" (state/outbox.js sends it to the dealership). */
export function saveAppointment(a) {
  const list = getAppointments().filter((x) => x.ref !== a.ref);
  const item = { ...a, ref: a.ref || `AA-${Date.now().toString(36).toUpperCase().slice(-6)}`, createdAt: new Date().toISOString() };
  write(APPTS, [item, ...list].slice(0, 50));
  return item;
}

export function resetLocalData() {
  [KEY, USER, APPTS, 'apex-atelier-v4'].forEach((k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
  settings = { ...defaults, dark: systemDark() };
  applySettings();
  listeners.forEach((fn) => fn(settings));
}
