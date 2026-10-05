/*
 * The CRM's API client. Same-origin requests carry the HttpOnly staff cookie; a 401 anywhere sends the user back to the
 * sign-in screen. Errors are RFC 7807 problems from server/http.mjs and keep their field-by-field messages.
 */
const ROOT = new URL('../api/v1/', location.href).pathname;

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.detail || body?.title || `Request failed (${status})`);
    this.status = status;
    this.title = body?.title || 'Error';
    this.fields = body?.fields || null;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(path, { method = 'GET', body, raw, timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(ROOT + path, {
      method,
      credentials: 'same-origin',
      headers: raw ? { 'content-type': raw.type || 'application/octet-stream' } : body !== undefined ? { 'content-type': 'application/json' } : {},
      body: raw || (body !== undefined ? JSON.stringify(body) : undefined),
      signal: ctrl.signal
    });
  } catch (e) {
    throw new ApiError(0, { title: 'Offline', detail: e.name === 'AbortError' ? 'The server took too long to answer. Try again.' : 'Cannot reach the server. Check the connection.' });
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return null;
  const type = res.headers.get('content-type') || '';
  if (!type.includes('json')) {
    throw new ApiError(res.status === 200 ? 503 : res.status, { title: 'Backend not deployed', detail: 'The backend is not running on this deploy. Deploy the project zip so the host builds it: on Vercel drop it at vercel.com/drop; on Netlify sign in first, then drop it on Netlify Drop.' });
  }
  const data = await res.json();
  if (!res.ok) {
    const err = new ApiError(res.status, data);
    if (res.status === 401 && !path.startsWith('admin/session')) onUnauthorized(err);
    throw err;
  }
  return data;
}

export const get = (path) => api(path);
export const post = (path, body) => api(path, { method: 'POST', body });
export const patch = (path, body) => api(path, { method: 'PATCH', body });
export const del = (path) => api(path, { method: 'DELETE' });
export const qs = (o) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, String(v)); });
  const s = p.toString();
  return s ? `?${s}` : '';
};
export const exportUrl = (collection) => `${ROOT}admin/export/${collection}`;
export const SITE = new URL('../', location.href).href;
