/*
 * Combines the ranked candidates (tools/match-stock-models.mjs) with the render audit (public/audit.html) into
 * public/data/stock-models.json: for every stock car, the models that were matched to it AND verified to render,
 * best first. Cars with no verified model are left out on purpose - the shop then shows no 3D for them rather than a wrong one.
 *
 *   node tools/apply-stock-models.mjs [audit.json]      (default: .cache/stockmodels/audit.json)
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/sources.mjs';

const dir = path.join(ROOT, '.cache', 'stockmodels');
const candidates = JSON.parse(fs.readFileSync(path.join(dir, 'candidates.json'), 'utf8'));
const audit = JSON.parse(fs.readFileSync(path.resolve(process.argv[2] || path.join(dir, 'audit.json')), 'utf8'));
const LICENSE = { cc0: 'CC0', by: 'CC Attribution', 'by-sa': 'CC Attribution-ShareAlike', 'by-nd': 'CC Attribution-NoDerivs', 'by-nc': 'CC Attribution-NonCommercial', 'by-nc-sa': 'CC Attribution-NonCommercial-ShareAlike', 'by-nc-nd': 'CC Attribution-NonCommercial-NoDerivs', st: 'Sketchfab Standard', ed: 'Sketchfab Editorial' };

/* 0 = free to reuse with credit, 1 = fine to embed, 2 = non-commercial, 3 = editorial */
const RANK = (lic) => ({ cc0: 0, by: 0, 'by-sa': 0, 'by-nd': 1, st: 1, '': 1, 'by-nc': 2, 'by-nc-sa': 2, 'by-nc-nd': 2, ed: 3 }[lic] ?? 1);
const out = {};
let with3d = 0, without = 0;
const tested = {};   /* uid -> ok, across all groups */
for (const r of Object.values(audit)) r.tried.forEach((t) => { tested[t.uid] = t.ok; });

for (const [key, g] of Object.entries(candidates)) {
  const a = audit[key];
  const winner = a?.winner;
  if (!winner) { without += g.ids.length; continue; }
  let ordered = [g.candidates.find((c) => c.uid === winner), ...g.candidates.filter((c) => c.uid !== winner && tested[c.uid] === true)].filter(Boolean);
  /* prefer models that may be shown commercially (CC0 / CC-BY / CC-BY-SA) when one is almost as good a match */
  if (RANK(ordered[0].license) >= 2) {
    const better = ordered.find((c) => RANK(c.license) <= 1 && c.score >= ordered[0].score - 25);
    if (better) ordered = [better, ...ordered.filter((c) => c !== better)];
  }
  const models = ordered.map((c) => ({ source: 'sketchfab', uid: c.uid, name: c.name, author: c.author || 'Unknown', license: LICENSE[c.license] || c.license || '', url: c.url || `https://sketchfab.com/3d-models/${c.uid}`, thumb: c.thumb || '' }));
  g.ids.forEach((id) => { out[id] = models; });
  with3d += g.ids.length;
}
fs.writeFileSync(path.join(ROOT, 'public', 'data', 'stock-models.json'), JSON.stringify(out));
const nc = Object.values(out).filter((m) => /NonCommercial|Editorial/.test(m[0].license)).length;
console.log(`${nc} cars still default to a non-commercial or editorial model (no better match exists)`);
console.log(`${with3d} cars have a verified 3D model, ${without} have none (no 3D is offered for those)`);
