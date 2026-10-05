import { describe, it, expect } from 'vitest';
import { applyFits, init, partsFor } from '../src/data/catalog.js';

/* Products edited in the CRM carry `fits`; that list decides where the configurator offers them. */
const vehicles = () => [
  { id: 'ferrari-458', make: 'Ferrari', model: '458', generation: '', body: '', country: '', fuel: 'G', yearFrom: 2009, yearTo: 2015, has3d: true, counts: { wheels: 1, kits: 1 }, parts: { direct: ['w-old', 'k-1'], makeLevel: ['w-lvl'] } },
  { id: 'porsche-911', make: 'Porsche', model: '911', generation: '', body: '', country: '', fuel: 'G', yearFrom: 2019, yearTo: 0, has3d: true, counts: { wheels: 0, kits: 0 }, parts: { direct: [], makeLevel: [] } }
];
const products = () => ({
  'w-old': { id: 'w-old', category: 'wheel', vendor: 'A', title: 'Old wheel' },
  'k-1': { id: 'k-1', category: 'kit', vendor: 'B', title: 'Lip', subtype: 'front-lip' },
  'w-lvl': { id: 'w-lvl', category: 'wheel', vendor: 'C', title: 'Make-level wheel' }
});

describe('applyFits', () => {
  it('leaves the harvested fitment alone when no product has a fits list', () => {
    const c = { vehicles: vehicles() };
    applyFits(c, products());
    expect(c.vehicles[0].parts.direct).toEqual(['w-old', 'k-1']);
  });

  it('moves a product to exactly the cars in its fits list and recounts', () => {
    const c = { vehicles: vehicles() };
    const p = { ...products(), 'w-old': { ...products()['w-old'], fits: ['porsche-911'] }, 'crm:new': { id: 'crm:new', category: 'wheel', vendor: 'V', title: 'New', fits: ['ferrari-458', 'porsche-911'] } };
    applyFits(c, p);
    expect(c.vehicles[0].parts.direct).toEqual(['k-1', 'crm:new']);
    expect(c.vehicles[1].parts.direct).toEqual(['w-old', 'crm:new']);
    expect(c.vehicles[0].counts).toMatchObject({ wheels: 1, kits: 1 });
    expect(c.vehicles[1].counts).toMatchObject({ wheels: 2, kits: 0 });
  });

  it('hides products marked unavailable in the configurator', () => {
    const c = { vehicles: vehicles() };
    const p = { ...products(), 'k-1': { ...products()['k-1'], available: false } };
    init(c, p);
    const parts = partsFor(c.vehicles[0]);
    expect(parts.kits).toEqual([]);
    expect(parts.wheels.map((w) => w.id)).toEqual(['w-old']);
  });
});
