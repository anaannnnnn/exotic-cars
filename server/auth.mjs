import { scrypt as scryptCb, randomBytes, timingSafeEqual, createHmac, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './http.mjs';
import { store } from './store.mjs';

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

/* ---------- the signing key ---------- */
let generated = null;
async function secret() {
  const env = process.env.SESSION_SECRET || '';
  if (env) {
    if (env.length < 32) throw new HttpError(503, 'Not configured', 'SESSION_SECRET is set but shorter than 32 characters. Lengthen it or remove it.');
    return env;
  }
  if (generated) return generated;
  /* no SESSION_SECRET: make one the first time it is needed and keep it in the site's private store */
  let saved = await store('system').get('session-secret', { type: 'json' });
  if (!saved?.value) {
    const fresh = { value: randomBytes(48).toString('base64url'), at: new Date().toISOString() };
    const res = await store('system').setJSON('session-secret', fresh, { onlyIfNew: true });
    saved = res?.modified === false ? await store('system').get('session-secret', { type: 'json' }) : fresh;
  }
  generated = saved.value;
  return generated;
}

/* ---------- tokens ---------- */
export async function signToken(payload, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }));
  const sig = createHmac('sha256', await secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export async function verifyToken(token) {
  if (!token || typeof token !== 'string' || token.length > 2048) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', await secret()).update(body).digest();
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
/* an scrypt hash of nothing: checked when there is no account, so a miss costs the same time as a hit */
export const DUMMY_HASH = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const STAFF_KEY = 'staff-account';
const envStaff = () => Boolean(process.env.ADMIN_EMAIL && (process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD));
const sameText = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
export const storedStaff = () => store('system').get(STAFF_KEY, { type: 'json' });

/* The built-in login shipped with the project zip. It works only until a password is set in the CRM (Settings →
   Your login), which replaces it for good; ADMIN_EMAIL + ADMIN_PASSWORD(_HASH) override both. */
export const DEFAULT_ADMIN = { username: 'admin', password: 'admin123' };

/** 'env' (environment variables), 'stored' (set in the CRM) or 'default' (the built-in admin / admin123). */
export async function staffMode() {
  if (envStaff()) return 'env';
  return (await storedStaff()) ? 'stored' : 'default';
}
export const staffConfigured = async () => (await staffMode()) !== 'setup';

/* which version of the login a session was issued for: changing the password ends every other session */
const loginVersion = (mode, acct) => (mode === 'env' || mode === 'default' ? mode : acct.passwordChangedAt || acct.createdAt);

/* ---------- the team: named logins with a role (owner, manager, sales, service), one record each in the CRM store ---------- */
export const ROLES = ['owner', 'manager', 'sales', 'service'];
export const memberId = (email) => createHash('sha256').update(`staff:${String(email).trim().toLowerCase()}`).digest('hex').slice(0, 24);
export const findMember = (email) => store('crm').get(`staff/${memberId(email)}`, { type: 'json' });
const memberVersion = (m) => `u:${m.passwordChangedAt || m.createdAt}`;

/** Check a sign-in. Returns { email, v, role, name, uid } for a session, or null. */
export async function checkStaffCredentials(email, password) {
  const got = String(email || '').trim().toLowerCase();
  const member = await findMember(got).catch(() => null);
  if (member) {
    const ok = await verifyPassword(password, member.passwordHash);
    if (!ok || member.active === false) return null;
    await store('crm').setJSON(`staff/${member.id}`, { ...member, lastLoginAt: new Date().toISOString() }).catch(() => {});
    return { email: member.email, v: memberVersion(member), role: member.role, name: member.name, uid: member.id, branch: member.branch || null };
  }
  const mode = await staffMode();
  if (mode === 'env') {
    const want = String(process.env.ADMIN_EMAIL).trim().toLowerCase();
    const hash = process.env.ADMIN_PASSWORD_HASH;
    const ok = hash ? await verifyPassword(password, hash) : sameText(password, process.env.ADMIN_PASSWORD) && Boolean(process.env.ADMIN_PASSWORD);
    return ok && sameText(got, want) ? { email: want, v: 'env' } : null;
  }
  if (mode === 'default') {
    await verifyPassword(password, DUMMY_HASH);   /* same work as a real check */
    return sameText(got, DEFAULT_ADMIN.username) && sameText(password, DEFAULT_ADMIN.password) ? { email: DEFAULT_ADMIN.username, v: 'default' } : null;
  }
  const acct = await storedStaff();
  const ok = await verifyPassword(password, acct?.passwordHash || DUMMY_HASH);
  return acct && ok && sameText(got, acct.email) ? { email: acct.email, v: loginVersion('stored', acct) } : null;
}

/** First visit to a new site: create the staff login. Only possible while there is none (an atomic create). */
export async function createStaffAccount(email, password) {
  if ((await staffMode()) !== 'setup') throw new HttpError(409, 'Already set up', 'This CRM already has a staff login. Sign in instead.');
  const at = new Date().toISOString();
  const acct = { email: String(email).trim().toLowerCase(), passwordHash: await hashPassword(password), createdAt: at };
  const res = await store('system').setJSON(STAFF_KEY, acct, { onlyIfNew: true });
  if (res?.modified === false) {
    throw new HttpError(409, 'Already set up', 'This CRM already has a staff login. Sign in instead.');
  }
  return { email: acct.email, v: loginVersion('stored', acct) };
}

export async function changeStaffPassword(current, next) {
  if (envStaff()) throw new HttpError(409, 'Managed elsewhere', 'This login is set by the site’s environment variables (ADMIN_PASSWORD_HASH). Change it there.');
  const acct = await storedStaff();
  const wrong = () => new HttpError(400, 'Invalid request', 'Some fields are missing or not valid.', { fields: { current: 'That is not the current password' } });
  if (!acct) {
    /* still on the built-in login: setting a password turns it into a stored one and switches the default off */
    if (!sameText(current, DEFAULT_ADMIN.password)) throw wrong();
    const at = new Date().toISOString();
    const made = { email: DEFAULT_ADMIN.username, passwordHash: await hashPassword(next), createdAt: at, passwordChangedAt: at };
    const res = await store('system').setJSON(STAFF_KEY, made, { onlyIfNew: true });
    if (res?.modified === false) throw new HttpError(409, 'Edit conflict', 'The password was just changed elsewhere. Sign in again.');
    return { email: made.email, v: loginVersion('stored', made) };
  }
  if (!(await verifyPassword(current, acct.passwordHash))) throw wrong();
  const updated = { ...acct, passwordHash: await hashPassword(next), passwordChangedAt: new Date().toISOString() };
  await store('system').setJSON(STAFF_KEY, updated);
  return { email: updated.email, v: loginVersion('stored', updated) };
}

export async function staffToken(login) {
  return signToken({ sub: login.email, role: 'staff', r: login.role || 'owner', n: login.name || null, uid: login.uid || null, v: login.v }, STAFF_TTL);
}

/** The staff session, or 401. A session only counts for the login (and password) it was issued for. */
export async function requireStaff(req) {
  const data = await verifyToken(cookies(req)[STAFF_COOKIE]);
  const deny = () => new HttpError(401, 'Unauthorized', 'Sign in to the CRM to continue.');
  if (!data || data.role !== 'staff') throw deny();
  if (data.uid) {
    const m = await store('crm').get(`staff/${data.uid}`, { type: 'json' });
    if (!m || m.active === false || data.v !== memberVersion(m)) throw deny();
    return { sub: m.email, email: m.email, role: m.role, name: m.name, uid: m.id, branch: m.branch || null, exp: data.exp };
  }
  const mode = await staffMode();
  if (mode === 'env') {
    if (data.v !== 'env' || !sameText(data.sub, String(process.env.ADMIN_EMAIL).trim().toLowerCase())) throw deny();
  } else if (mode === 'default') {
    if (data.v !== 'default' || data.sub !== DEFAULT_ADMIN.username) throw deny();
  } else {
    const acct = mode === 'stored' ? await storedStaff() : null;
    if (!acct || data.v !== loginVersion('stored', acct) || data.sub !== acct.email) throw deny();
  }
  /* the shop's own login (environment, built-in or set in the CRM) is the owner */
  return { sub: data.sub, email: data.sub, role: 'owner', name: data.n || 'Owner', uid: null, branch: null, exp: data.exp };
}

/* ---------- customers ---------- */
export const CUSTOMER_TTL = 30 * 24 * 60 * 60;
export const customerId = (email) => createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 40);

export async function currentCustomer(req) {
  const data = await verifyToken(cookies(req)[CUSTOMER_COOKIE]);
  return data && data.role === 'customer' ? data : null;
}
