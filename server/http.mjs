/*
 * HTTP helpers for the API: JSON and RFC 7807 problem responses, body parsing with a size cap, the same-origin check
 * that guards every state-changing request, and the client address used for rate limits.
 */
const BASE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin'
};

export class HttpError extends Error {
  constructor(status, title, detail, extra = {}) {
    super(detail || title);
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.extra = extra;
  }
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...BASE_HEADERS, ...headers }
  });
}

export function noContent(headers = {}) {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', ...BASE_HEADERS, ...headers } });
}

export function problem(status, title, detail, extra = {}) {
  const headers = { 'content-type': 'application/problem+json; charset=utf-8', 'cache-control': 'no-store', ...BASE_HEADERS };
  if (extra.retryAfter) headers['retry-after'] = String(extra.retryAfter);
  const { retryAfter, ...rest } = extra;
  return new Response(JSON.stringify({ type: `urn:exotic-cars:problem:${slug(title)}`, title, status, detail, ...rest }), { status, headers });
}

/** Read a JSON body, refusing anything over `max` bytes or that is not valid JSON. */
export async function readJson(req, max = 256 * 1024) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > max) throw new HttpError(413, 'Payload too large', `The request body must be under ${Math.round(max / 1024)} KB.`);
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, 'Payload too large', `The request body must be under ${Math.round(max / 1024)} KB.`);
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'Invalid JSON', 'The request body is not valid JSON.'); }
}

/**
 * Cross-site request forgery guard for POST/PATCH/PUT/DELETE: the browser's Origin header must be this site (or one
 * listed in ALLOWED_ORIGINS). Cookies are also SameSite=Strict, so this is a second, independent layer.
 */
export function assertSameOrigin(req) {
  const origin = req.headers.get('origin');
  const self = new URL(req.url).origin;
  /* behind a host's proxy the function may see an internal URL: the public host is in the forwarded headers */
  const proto = (req.headers.get('x-forwarded-proto') || 'https').split(',')[0].trim();
  const hosts = [req.headers.get('x-forwarded-host'), req.headers.get('host')].filter(Boolean).map((h) => `${proto}://${h.split(',')[0].trim()}`);
  const allowed = new Set([self, ...hosts, ...String(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)]);
  if (!origin || !allowed.has(origin)) throw new HttpError(403, 'Forbidden', 'This request must come from the Exotic Cars site.');
}

export function clientIp(req, ctx) {
  return ctx?.ip || req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-real-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || '0.0.0.0';
}

/** Zod error -> a short, field-by-field problem detail that never echoes the submitted values. */
/* Zod's default text for these codes quotes the submitted value */
const GENERIC = {
  invalid_enum_value: 'Choose one of the listed options',
  invalid_literal: 'Not accepted',
  invalid_union: 'Not valid',
  invalid_union_discriminator: 'Not valid',
  invalid_type: 'Required'
};
function messageFor(issue) {
  /* a union (email or empty, link or empty): report why the main form failed */
  if (issue.code === 'invalid_union') {
    const inner = issue.unionErrors?.[0]?.issues?.[0];
    return inner ? messageFor(inner) : GENERIC.invalid_union;
  }
  if (issue.code === 'invalid_type') return issue.received === 'undefined' || issue.received === 'null' ? GENERIC.invalid_type : 'Wrong kind of value';
  return GENERIC[issue.code] || issue.message;
}
export function invalid(zerr) {
  const fields = {};
  for (const issue of zerr.issues) {
    const key = issue.path.join('.') || 'body';
    if (!fields[key]) fields[key] = messageFor(issue);
  }
  return new HttpError(400, 'Invalid request', 'Some fields are missing or not valid.', { fields });
}
