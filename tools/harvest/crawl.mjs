/*
 * Resumable, polite crawler for Shopify storefronts that publish /products.json.
 *
 *   node tools/harvest/crawl.mjs atomic-shop.ae
 *   node tools/harvest/crawl.mjs alkhateeb.ae --collection body-kit
 *
 * Raw pages are cached in .cache/raw/<host>[__collection]/page-NNNN.json together with
 * provenance (URL + fetch time). Re-running skips pages that already exist, so an interrupted
 * or rate-limited crawl simply resumes. Only public catalogue data is requested, one request at a
 * time, with back-off on 429 / 5xx, as the stores' robots.txt allows.
 */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const UA = 'Mozilla/5.0 (compatible; ApexStudioCatalogBuilder/2.0; +research)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const exists = (p) => access(p).then(() => true, () => false);

/* Keep only what the fitment database needs, so the cache stays small. */
function slim(p) {
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    vendor: p.vendor,
    type: p.product_type,
    tags: p.tags,
    published: p.published_at,
    updated: p.updated_at,
    variants: (p.variants || []).slice(0, 6).map((v) => ({ sku: v.sku, price: v.price, available: v.available, title: v.title })),
    images: (p.images || []).slice(0, 8).map((i) => ({ src: i.src, w: i.width, h: i.height })),
    text: (p.body_html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1600)
  };
}

async function fetchPage(url) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (res.ok) return await res.json();
      if (res.status === 429 || res.status >= 500) {
        const wait = Math.min(60000, 3000 * 2 ** attempt);
        console.warn(`  ${res.status} on ${url} - waiting ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      throw new Error(`HTTP ${res.status} ${url}`);
    } catch (err) {
      if (attempt === 7) throw err;
      await sleep(2000 * (attempt + 1));
    }
  }
  throw new Error('gave up: ' + url);
}

export async function crawl(host, { collection = '', delay = 900, maxPages = 800 } = {}) {
  const dir = path.join(root, '.cache', 'raw', host + (collection ? `__${collection}` : ''));
  await mkdir(dir, { recursive: true });
  const base = collection ? `https://${host}/collections/${collection}/products.json` : `https://${host}/products.json`;
  let total = 0;
  for (let page = 1; page <= maxPages; page++) {
    const file = path.join(dir, `page-${String(page).padStart(4, '0')}.json`);
    if (await exists(file)) {
      const cached = JSON.parse(await readFile(file, 'utf8'));
      if (!cached.products.length) break;
      total += cached.products.length;
      continue;
    }
    const url = `${base}?limit=250&page=${page}`;
    const json = await fetchPage(url);
    if (!json.products.length) {
      await writeFile(file, JSON.stringify({ url, fetched: new Date().toISOString(), products: [] }));
      break;
    }
    total += json.products.length;
    await writeFile(file, JSON.stringify({ url, fetched: new Date().toISOString(), products: json.products.map(slim) }));
    console.log(`${host}${collection ? '/' + collection : ''}: page ${page} (${total} products)`);
    await sleep(delay);
  }
  console.log(`Done: ${total} products cached in ${path.relative(root, dir)}`);
  return total;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('crawl.mjs')) {
  const args = process.argv.slice(2);
  const host = args[0];
  if (!host) { console.error('usage: node tools/harvest/crawl.mjs <host> [--collection handle]'); process.exit(1); }
  const ci = args.indexOf('--collection');
  crawl(host, { collection: ci >= 0 ? args[ci + 1] : '' }).catch((e) => { console.error(e); process.exit(1); });
}
