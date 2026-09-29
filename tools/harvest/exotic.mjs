/*
 * Imports the client's own inventory (exoticcars.ae) - published with the client's permission.
 *
 *   node tools/harvest/exotic.mjs            # crawl current stock + previously sold, cache in .cache/exotic/stock.json
 *
 * The site is a Laravel app: the stock page sets a session + XSRF cookie and embeds a CSRF token, then lists cars
 * with POST /api/stock-car/get-cars?page=N { brand_id, isSold, isNewArrival, ... }. We do exactly what the page does,
 * one request per second, and identify ourselves.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/sources.mjs';

const ORIGIN = 'https://exoticcars.ae';
const UA = 'ApexAtelierImport/1.0 (client-authorised inventory import)';
const OUT = path.join(ROOT, '.cache', 'exotic');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
function absorb(res) {
  for (const c of res.headers.getSetCookie?.() || []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

async function session() {
  const res = await fetch(`${ORIGIN}/stock`, { headers: { 'User-Agent': UA } });
  absorb(res);
  const html = await res.text();
  const m = html.match(/_token['"]?\s*[:=]\s*['"]([A-Za-z0-9]{30,})['"]/) || html.match(/csrf-token"\s+content="([^"]+)"/i);
  if (!m) throw new Error('could not find the CSRF token on /stock');
  return m[1];
}

async function page(token, body, n) {
  const xsrf = decodeURIComponent(jar.get('XSRF-TOKEN') || '');
  const res = await fetch(`${ORIGIN}/api/stock-car/get-cars?page=${n}`, {
    method: 'POST',
    headers: {
      'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-TOKEN': token, 'X-XSRF-TOKEN': xsrf, Cookie: cookieHeader(), Referer: `${ORIGIN}/stock`
    },
    body: JSON.stringify({ ...body, _token: token })
  });
  absorb(res);
  if (!res.ok) throw new Error(`${res.status} on page ${n}`);
  return res.json();
}

async function crawl(token, label, body) {
  const cars = [];
  for (let n = 1; ; n++) {
    const j = await page(token, body, n);
    cars.push(...(j.data || []));
    process.stdout.write(`${label} page ${n}/${j.last_page} (${cars.length}${j.total ? `/${j.total}` : ''})\n`);
    if (!j.next_page_url || n >= j.last_page || n > 200) break;
    await sleep(1000);
  }
  return cars;
}

const token = await session();
fs.mkdirSync(OUT, { recursive: true });
const forSale = await crawl(token, 'for sale', { brand_id: '', isSold: 0, isNewArrival: '', hasLandingPageSegment: false, pathname: '/stock', model_id: '' });
const sold = await crawl(token, 'sold', { brand_id: '', isSold: 1, isNewArrival: 'No', hasLandingPageSegment: false, pathname: '/stock' });
fs.writeFileSync(path.join(OUT, 'stock.json'), JSON.stringify({ fetched: new Date().toISOString(), origin: ORIGIN, forSale, sold }));
console.log(`saved ${forSale.length} for sale, ${sold.length} sold`);
