import { describe, it, expect } from 'vitest';
import { defaultQty, bom, wheelCoverage, toShare, fromShare, defaultState, quantityLabel } from '../src/state/build.js';
import { wheelChecks, oeDiameter, sizeLabel, variantLabel, aed, groupWheels, groupKits } from '../src/data/catalog.js';

const set = { id: 'set', category: 'wheel', vendor: 'NOVITEC', design: 'NF9', priceAED: 80000, spec: { set: true, diameter: 21, diameterRear: 22 }, images: [] };
const front = { id: 'f', category: 'wheel', vendor: 'BBS', design: 'FI', priceAED: 8000, spec: { axle: 'front', diameter: 20, width: 8.75, et: 44, pcd: '5x114' }, images: [] };
const rear = { id: 'r', category: 'wheel', vendor: 'BBS', design: 'FI', priceAED: 8200, spec: { axle: 'rear', diameter: 20 }, images: [] };
const kit = { id: 'k', category: 'kit', subtype: 'decklid-spoiler', priceAED: 14000 };
const lookup = (id) => ({ set, f: front, r: rear, k: kit })[id];

describe('quantities', () => {
  it('assigns sensible default quantities', () => {
    expect(defaultQty(set)).toBe(1);
    expect(defaultQty(front)).toBe(2);
    expect(defaultQty({ spec: {} })).toBe(4);
    expect(quantityLabel(set, 1)).toBe('Set of 4');
    expect(quantityLabel(front, 2)).toBe('2 wheels');
  });
});

describe('bill of materials', () => {
  it('totals line prices with quantities', () => {
    const s = { ...defaultState(), wheels: [{ id: 'f', qty: 2 }, { id: 'r', qty: 2 }], kits: ['k'] };
    const b = bom(s, lookup);
    expect(b.lines).toHaveLength(3);
    expect(b.total).toBe(8000 * 2 + 8200 * 2 + 14000);
    expect(b.unpriced).toBe(0);
  });
  it('counts unpriced items separately', () => {
    const s = { ...defaultState(), wheels: [{ id: 'x', qty: 1 }], kits: [] };
    expect(bom(s, () => ({ priceAED: null, spec: {} })).unpriced).toBe(1);
  });
});

describe('wheel coverage', () => {
  it('accepts a set, or a front + rear pair', () => {
    expect(wheelCoverage({ ...defaultState(), wheels: [{ id: 'set', qty: 1 }] }, lookup).complete).toBe(true);
    expect(wheelCoverage({ ...defaultState(), wheels: [{ id: 'f', qty: 2 }, { id: 'r', qty: 2 }] }, lookup).complete).toBe(true);
  });
  it('flags a single axle', () => {
    const r = wheelCoverage({ ...defaultState(), wheels: [{ id: 'f', qty: 2 }] }, lookup);
    expect(r.complete).toBe(false);
    expect(r.message).toMatch(/rear pair/);
  });
});

describe('share links', () => {
  it('round-trips a build', () => {
    const s = { ...defaultState(), vehicleId: 'bmw-m3-g80', modelUid: 'abc', wheels: [{ id: 'set', qty: 1 }], kits: ['k'], tint: true, wheelColor: '#123456' };
    const back = fromShare(toShare(s));
    expect(back).toMatchObject({ vehicleId: 'bmw-m3-g80', modelUid: 'abc', kits: ['k'], tint: true, wheelColor: '#123456' });
    expect(back.wheels).toEqual([{ id: 'set', qty: 1 }]);
  });
  it('rejects garbage', () => {
    expect(fromShare('not-a-valid-link!!')).toBeNull();
  });
});

describe('fitment checks', () => {
  const car = { spec: { boltPattern: '5x114.3', centerBore: 67.1, oeWheel: 'F: 20x8.5J R: 20x10.5J' } };
  it('reads the factory diameter', () => {
    expect(oeDiameter(car)).toBe(20);
    expect(oeDiameter({ spec: null })).toBeNull();
  });
  it('passes a matching bolt pattern (5x114 == 5x114.3) and reports the diameter delta', () => {
    const c = wheelChecks(car, front);
    expect(c.find((x) => x.label === 'Bolt pattern').ok).toBe(true);
    expect(c.find((x) => x.label === 'Diameter').detail).toMatch(/20″ vs 20″ factory/);
  });
  it('fails a wrong bolt pattern and is unsure when the vendor does not state one', () => {
    expect(wheelChecks(car, { spec: { pcd: '5x112', diameter: 20 } }).find((x) => x.label === 'Bolt pattern').ok).toBe(false);
    expect(wheelChecks(car, { spec: { diameter: 21 } }).find((x) => x.label === 'Bolt pattern').ok).toBeNull();
  });
  it('warns when the wheel bore is larger than the hub', () => {
    const c = wheelChecks(car, { spec: { pcd: '5x114.3', cb: 72.6 } }).find((x) => x.label === 'Centre bore');
    expect(c.detail).toMatch(/hub rings/);
  });
});

describe('formatting and grouping', () => {
  it('formats money and sizes', () => {
    expect(aed(79550)).toBe('AED 79,550');
    expect(aed(null)).toBe('Price on request');
    expect(sizeLabel(set)).toBe('21″ front / 22″ rear set');
    expect(sizeLabel(front)).toBe('8.75J × 20″ · ET44 · front');
  });
  it('groups wheels by design and kits by subtype', () => {
    const g = groupWheels([{ ...front, tier: 'direct' }, { ...rear, tier: 'direct' }, { ...set, tier: 'direct' }]);
    expect(g).toHaveLength(2);
    expect(g.find((x) => x.design === 'FI').items).toHaveLength(2);
    expect(groupKits([kit, { ...kit, id: 'k2', subtype: 'full-kit' }])[0].subtype).toBe('full-kit');
  });
});

describe('wheel labels', () => {
  it('describes sets that carry no size in their title', () => {
    expect(sizeLabel({ title: 'NOVITEC L4 Wheels And Tyres Set NL5, Solid Color', spec: { set: true } })).toBe('Set of 4 with tyres');
    expect(sizeLabel({ title: 'Aluminum Wheel NL4', spec: {} })).toBe('Single wheel');
  });
  it('names the variant from the finish, construction and colour wording', () => {
    expect(variantLabel({ title: 'NOVITEC F4 Wheels And Tyres Set NF11, Forged, Transparent Color, Polished for FERRARI', construction: 'Forged', centerLock: true }))
      .toBe('Transparent Colour · Polished · Forged · Centre-lock look');
    expect(variantLabel({ title: 'BBS FI Wheel for BMW', finish: { name: 'Satin Black' } })).toBe('Satin Black');
  });
});