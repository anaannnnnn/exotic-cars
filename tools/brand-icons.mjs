import fs from 'node:fs';
import * as si from 'simple-icons';
import { VEHICLES } from './data/vehicles.mjs';
import { EXTRA_UNIQUE } from './data/extra-vehicles.mjs';

const makes = [...new Set([...VEHICLES, ...EXTRA_UNIQUE].map((v) => v.make))];
const alias = { 'Mercedes-Benz': 'mercedes', 'Acura / Honda': 'acura', 'Land Rover': 'landrover', 'Aston Martin': 'astonmartin', 'Alfa Romeo': 'alfaromeo', 'Rolls-Royce': 'rollsroyce', Lotus: 'lotuscars', 'Citroën': 'citroen', 'De Tomaso': 'detomaso', 'W Motors': 'wmotors' };
const out = {};
const missing = [];
for (const m of makes) {
  const key = 'si' + (alias[m] || m.toLowerCase().replace(/[^a-z0-9]/g, '')).replace(/^./, (c) => c.toUpperCase());
  const icon = si[key] || Object.values(si).find((i) => i && i.title && i.title.toLowerCase() === m.toLowerCase());
  if (icon) out[m] = icon.path; else missing.push(m);
}
fs.writeFileSync('src/data/brand-paths.json', JSON.stringify(out));
console.log('with logo:', Object.keys(out).length, 'missing:', missing.join(', '));
