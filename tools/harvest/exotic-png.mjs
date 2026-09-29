/*
 * Saves the client's inventory photos as PNG files (original resolution) in a folder outside the web app.
 *
 *   node tools/harvest/exotic-png.mjs            # cover photo of every car        -> inventory-png/covers/
 *   node tools/harvest/exotic-png.mjs --all      # every photo of every car        -> inventory-png/<id>-<slug>/NN.png
 *
 * Reads public/data/stock.json (built by tools/build-stock.mjs). Resumable: files that exist are skipped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/sources.mjs';

const { default: sharp } = await import('sharp');
const UA = 'ApexAtelierImport/1.0 (client-authorised inventory import)';
const all = process.argv.includes('--all');
const OUT = path.join(ROOT, 'inventory-png');
const stock = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'stock.json'), 'utf8'));
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

const jobs = [];
for (const c of stock.cars) {
  const name = `${c.id}-${slug(c.title)}`;
  if (all) [c.cover, ...c.gallery].filter(Boolean).forEach((url, i) => jobs.push({ url, file: path.join(OUT, name, `${String(i + 1).padStart(2, '0')}.png`) }));
  else if (c.cover) jobs.push({ url: c.cover, file: path.join(OUT, 'covers', `${name}.png`) });
}

let done = 0, skipped = 0, failed = 0;
const failures = [];
async function worker() {
  while (jobs.length) {
    const j = jobs.shift();
    if (fs.existsSync(j.file)) { skipped++; continue; }
    try {
      const res = await fetch(j.url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(String(res.status));
      fs.mkdirSync(path.dirname(j.file), { recursive: true });
      await sharp(Buffer.from(await res.arrayBuffer())).png({ compressionLevel: 6 }).toFile(j.file);
      done++;
    } catch (e) { failed++; failures.push(`${j.url} (${e.message})`); }
    const n = done + skipped + failed;
    if (n % 50 === 0) console.log(`${n} processed (${done} saved, ${skipped} already there, ${failed} failed)`);
    await new Promise((r) => setTimeout(r, 120));
  }
}
const total = jobs.length;
console.log(`${total} images to fetch -> ${OUT}`);
await Promise.all([worker(), worker(), worker()]);
if (failures.length) fs.writeFileSync(path.join(OUT, 'failed.txt'), failures.join('\n'));
console.log(`done: ${done} saved, ${skipped} already there, ${failed} failed`);
