import { scrypt as scryptCb, randomBytes, timingSafeEqual, createHmac, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './http.mjs';

/*
 * Passwords and sessions.
 * - Passwords: scrypt (N=2^15, r=8, p=1, 64-byte key, 16-byte salt) stored as "scrypt$N$r$p$salt$hash" (base64url).
 *   Verification is constant-time.
 * - Sessions: stateless tokens "payload.signature" where payload is base64url JSON { sub, role, iat, exp } and the
 *   signature is HMAC-SHA-256 with SESSION_SECRET. Carried in HttpOnly, Secure, SameSite=Strict cookies.
 * Secrets only ever come from the environment.
 */
const scrypt = promisify(scryptCb);
const N = 32768, R = 8, P = 1, KEYLEN = 64;
const b64u = (buf) => Buffer.from(buf).toString('base64url');

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(String(password), salt, KEYLEN, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return `scrypt$${N}$${R}$${P}$${b64u(salt)}$${b64u(key)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [alg, n, r, p, salt, hash] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64url');
    const key = await scrypt(String(password), Buffer.from(salt, 'base64url'), expected.length, { N: +n, r: +r, p: +p, maxmem: 128 * +n * +r * 2 });
    return expected.length === key.length && timingSafeEqual(expected, key);
  } catch { return false; }
}

/* ---------- configuration ---------- */
function secret() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length < 32) throw new HttpError(503, 'Not configured', 'The server is missing SESSION_SECRET (at least 32 characters). Add it in the site’s environment variables.');
  return s;
}
export const staffConfigured = () => Boolean(process.env.ADMIN_EMAIL && (process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD) && (process.env.SESSION_SECRET || '').length >= 32);

/* ---------- tokens ---------- */
export function signToken(payload, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }));
  const sig = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string' || token.length > 2048) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret()).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch { return null; }
}

/* ---------- cookies ---------- */
export const STAFF_COOKIE = 'ec_staff';
export const CUSTOMER_COOKIE = 'ec_user';

export function cookies(req) {
  const out = {};
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    /* another site cookie on this domain may not be URI-encoded (e.g. "pct=100%"): skip it, do not fail the request */
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore */ }
  }
  return out;
}

export function setCookie(name, value, maxAgeSeconds) {
  const secure = process.env.COOKIE_INSECURE === '1' ? '' : '; Secure';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}
export const clearCookie = (name) => setCookie(name, '', 0);

/* ---------- staff ---------- */
export const STAFF_TTL = 12 * 60 * 60;

export async function checkStaffCredentials(email, password) {
  const want = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const got = String(email || '').trim().toLowerCase();
  /* always do the same amount of work, so the response time does not reveal which part was wrong */
  const hash = process.env.ADMIN_PASSWORD_HASH;
  let ok;
  if (hash) ok = await verifyPassword(password, hash);
  else {
    const a = createHash('sha256').update(String(password)).digest();
    const b = createHash('sha256').update(String(process.env.ADMIN_PASSWORD || '')).digest();
    ok = timingSafeEqual(a, b) && Boolean(process.env.ADMIN_PASSWORD);
  }
  const emailOk = want.length > 0 && timingSafeEqual(createHash('sha256').update(got).digest(), createHash('sha256').update(want).digest());
  return ok && emailOk;
}

export function requireStaff(req) {
  const data = verifyToken(cookies(req)[STAFF_COOKIE]);
  if (!data || data.role !== 'staff') throw new HttpError(401, 'Unauthorized', 'Sign in to the CRM to continue.');
  return data;
}

/* ---------- customers ---------- */
export const CUSTOMER_TTL = 30 * 24 * 60 * 60;
export const customerId = (email) => createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 40);

export function currentCustomer(req) {
  const data = verifyToken(cookies(req)[CUSTOMER_COOKIE]);
  return data && data.role === 'customer' ? data : null;
}
