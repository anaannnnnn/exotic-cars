import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { carCreate, productCreate } from '../server/schemas.mjs';
import { fromShare, toShare, defaultState } from '../src/state/build.js';

/* Everything imported from the website must be editable in the CRM without tripping a validation rule. */
describe('imported data fits the CRM schemas', () => {
  it('every car', () => {
    const { cars } = JSON.parse(readFileSync('public/data/stock.json', 'utf8'));
    const bad = cars.filter((c) => !carCreate.safeParse(c).success).map((c) => c.id);
    expect(bad).toEqual([]);
  });
  it('every wheel and kit', () => {
    const products = Object.values(JSON.parse(readFileSync('public/data/products.json', 'utf8')));
    const bad = products.filter((p) => !productCreate.safeParse(p).success).map((p) => p.id);
    expect(bad).toEqual([]);
  });
});

describe('share links are untrusted', () => {
  const link = (p, wc) => Buffer.from(JSON.stringify({ v: 'ferrari-458', p, wc })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  it('drops a colour that is not #rrggbb', () => {
    const s = fromShare(link({ color: 'red;position:fixed;inset:0;background:url(https://evil.test/x.png)', preset: 'x' }, 'red;top:0'));
    expect(s.paint).toEqual(defaultState().paint);
    expect(s.wheelColor).toBeNull();
  });
  it('keeps a real custom colour', () => {
    const state = { ...defaultState(), vehicleId: 'ferrari-458', paint: { preset: null, color: '#12ab9f', roughness: 0.3, metalness: 0.5 } };
    expect(fromShare(toShare(state)).paint).toEqual(state.paint);
  });
});
