/* Coverage / audit report:  node tools/report.mjs  */
import { loadRaw, loadAnkusi, ankusiSpec } from './lib/sources.mjs';
import { normalizeProduct, matchVehicles } from './lib/products.mjs';
import { VEHICLES } from './data/vehicles.mjs';

const { products } = loadRaw();
const rows = loadAnkusi();
const specs = new Map();
for (const v of VEHICLES) specs.set(v.id, ankusiSpec(rows, v.ank));

const items = [];
for (const p of products) {
  const n = normalizeProduct(p, p.host);
  if (n) items.push(n);
}
console.log(`normalised items: ${items.length}  (wheels ${items.filter((i) => i.category === 'wheel').length}, kits ${items.filter((i) => i.category === 'kit').length})`);

const per = new Map(VEHICLES.map((v) => [v.id, { wheels: 0, kits: 0 }]));
const unmatched = new Map();
const dropped = [];
let matched = 0;
for (const it of items) {
  if (!it.fitmentText) continue;
  const { ids, dropped: d } = matchVehicles(it, VEHICLES, (id) => specs.get(id));
  d.forEach((x) => dropped.push(`${it.title}  ->  ${x.id}: ${x.why}`));
  if (!ids.length) { unmatched.set(it.fitmentText, (unmatched.get(it.fitmentText) || 0) + 1); continue; }
  matched++;
  for (const id of ids) per.get(id)[it.category === 'wheel' ? 'wheels' : 'kits']++;
}
console.log(`matched to vehicles: ${matched}`);
console.log('\nvehicle coverage (wheels / kits) and factory spec:');
for (const v of VEHICLES) {
  const c = per.get(v.id);
  const s = specs.get(v.id);
  console.log(`${v.id.padEnd(30)} ${String(c.wheels).padStart(4)} / ${String(c.kits).padStart(3)}   ${s ? `${s.boltPattern} cb${s.centerBore} (${s.samples} rows)` : 'NO SPEC'}`);
}
console.log('\ntop unmatched fitment texts:');
[...unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 70).forEach(([t, n]) => console.log(`${String(n).padStart(4)}  ${t}`));
console.log(`\ndropped by validation: ${dropped.length}`);
dropped.slice(0, 25).forEach((d) => console.log('  ' + d));
