import { api, unavailable, ApiError } from '../data/api.js';

/*
 * Enquiries and bookings are sent to the dealership at once when the connection allows, and otherwise kept on this
 * device and sent later (next visit, or when the phone is back online). Each request carries its own reference, so a
 * retry never creates a second copy in the CRM.
 */
const KEY = 'exotic-outbox-v1';
const PATHS = { lead: 'leads', appointment: 'appointments' };
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v.slice(-40))); } catch { /* storage unavailable */ } };

/** EX-7K2QD9: no 0/O/1/I, so it reads well over the phone. */
export function newRef(prefix) {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  return `${prefix}-${[...crypto.getRandomValues(new Uint8Array(6))].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

let flushing = null;

/** Send everything that is waiting. Resolves to the number still waiting. */
export function flush() {
  flushing ||= (async () => {
    for (const item of read()) {
      try {
        await api(PATHS[item.kind], { method: 'POST', body: item.payload, timeout: 10000 });
        write(read().filter((x) => x.payload.ref !== item.payload.ref));
      } catch (e) {
        if (unavailable(e) || e.status === 429) break;          /* try again later */
        write(read().filter((x) => x.payload.ref !== item.payload.ref));   /* refused for good (invalid): do not retry forever */
      }
    }
    return read().length;
  })().finally(() => { flushing = null; });
  return flushing;
}

/**
 * Send one request. Resolves { ref, sent: true } once the dealership has it, or { ref, sent: false } when it is queued
 * on the device. Rejects with ApiError (with .fields) when the dealership refuses it, so the form can show why.
 */
export async function send(kind, payload) {
  const body = { ...payload, ref: payload.ref || newRef(kind === 'lead' ? 'EX' : 'AA') };
  try {
    await api(PATHS[kind], { method: 'POST', body, timeout: 10000 });
    flush();
    return { ref: body.ref, sent: true };
  } catch (e) {
    if (e instanceof ApiError && !unavailable(e)) throw e;   /* refused (invalid, or too many requests): the form says why */
    write([...read().filter((x) => x.payload.ref !== body.ref), { kind, payload: body, at: Date.now() }]);
    return { ref: body.ref, sent: false };
  }
}

export const waiting = () => read().length;

/** The first thing the dealership's server said was wrong with a form, in words for the visitor. */
export const problemText = (e) => (e?.fields ? Object.values(e.fields)[0] : e?.message) || 'That did not go through. Please try again.';

export function initOutbox() {
  if (read().length) setTimeout(flush, 2500);
  addEventListener('online', () => flush());
}
