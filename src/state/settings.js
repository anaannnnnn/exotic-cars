/* Device-local preferences, the signed-in visitor and saved appointment requests. Nothing leaves the browser. */
const KEY = 'apex-settings-v1';
const USER = 'apex-user-v1';
const APPTS = 'apex-appointments-v1';

const defaults = { dark: true, hidePrices: false, reduceMotion: false };
let settings = { ...defaults };
const listeners = new Set();

const read = (k, fallback) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? fallback; } catch { return fallback; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

export function initSettings() {
  settings = { ...defaults, ...read(KEY, {}) };
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
  if (meta) meta.setAttribute('content', settings.dark ? '#101110' : '#f6f7f2');
}

/* visitor (name + email only, kept on this device) */
export const getUser = () => read(USER, null);
export const signIn = (user) => write(USER, user);
export const signOut = () => { try { localStorage.removeItem(USER); } catch { /* ignore */ } };

/* appointment requests */
export const getAppointments = () => read(APPTS, []);
export function saveAppointment(a) {
  const list = getAppointments();
  const ref = `AA-${Date.now().toString(36).toUpperCase().slice(-6)}`;
  const item = { ...a, ref, createdAt: new Date().toISOString() };
  write(APPTS, [item, ...list].slice(0, 50));
  return item;
}

export function resetLocalData() {
  [KEY, USER, APPTS, 'apex-atelier-v4'].forEach((k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
  settings = { ...defaults };
  applySettings();
  listeners.forEach((fn) => fn(settings));
}
