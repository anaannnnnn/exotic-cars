/*
 * Client for the dealership API (/api/v1, served by netlify/functions/api.mjs). Every call has a timeout.
 * `unavailable(e)` tells the caller to fall back to the built-in data or the device's outbox: a static-only deploy,
 * no connection, or a backend that is not set up yet.
 */
const ROOT = `${import.meta.env.BASE_URL}api/v1/`;

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.detail || body?.title || `The request failed (${status}).`);
    this.status = status;
    this.title = body?.title || null;
    this.fields = body?.fields || null;
  }
}

export async function api(path, { method = 'GET', body, timeout = 8000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(ROOT + path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal
    });
    if (res.status === 204) return null;
    /* a static host answers with its HTML page: treat that as "no backend" */
    if (!(res.headers.get('content-type') || '').includes('json')) throw new ApiError(res.ok ? 503 : res.status, null);
    const data = await res.json();
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export const unavailable = (e) => !(e instanceof ApiError) || e.status === 404 || e.status === 405 || e.status === 503 || e.status >= 500;

/** Tell the dealership what a customer asked for that the stock does not have (counted in the CRM). Never blocks the page. */
export function reportDemand({ query, filters, source = 'concierge' }) {
  const f = filters || {};
  const clean = Object.fromEntries(['brand', 'body', 'colour', 'from', 'to', 'kmMax', 'hpMin'].filter((k) => f[k] != null).map((k) => [k, f[k]]));
  return api('demand', { method: 'POST', body: { query: String(query || '').slice(0, 200), brand: clean.brand || null, body: clean.body || null, colour: clean.colour || null, yearFrom: clean.from || null, yearTo: clean.to || null, source } }).catch(() => null);
}

/* ---------- the AI concierge (Gemini on the server): text, voice in, natural voice out ---------- */
let aiState = null;
/** { ai, voice }: whether the server has the AI switched on. Asked once; a missing backend simply means "no". */
export const aiStatus = () => (aiState ||= api('concierge/status', { timeout: 5000 }).catch(() => ({ ai: false, voice: false })));
export const aiAsk = (body) => api('concierge', { method: 'POST', body, timeout: 30000 });
export const aiAskVoice = (body) => api('concierge/voice', { method: 'POST', body, timeout: 45000 });
export async function aiSpeech(text) {
  const res = await fetch(`${ROOT}concierge/speak`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new ApiError(res.status, null);
  return res.blob();
}
