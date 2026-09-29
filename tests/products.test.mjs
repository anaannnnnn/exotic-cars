import { describe, it, expect } from 'vitest';
import {
  fitmentText, yearSpan, wheelSpec, wheelDesign, kitSubtype, kitMaterial, finishInfo, matchVehicles, samePattern, normalizeProduct
} from '../tools/lib/products.mjs';
import { VEHICLES } from '../tools/data/vehicles.mjs';

describe('fitmentText', () => {
  it('takes the text after the last "for" and drops trailing wheel specs', () => {
    expect(fitmentText('BBS FI025 Wheel FI for FERRARI 458 Front 20x8.75 ET44 5x114')).toBe('FERRARI 458');
    expect(fitmentText('NOVITEC F4 458 85 Wheels And Tyres Set NF9 21/22 J, Forged, Transparent Color, Polished for FERRARI 458 Italia / Spider 2011-2015'))
      .toBe('FERRARI 458 Italia / Spider 2011-2015');
    expect(fitmentText('BBS RT88-055-BKBD Wheel RT88 for BMW M2 (G87) / BMW M3 (G80) / BMW M4 (G82) 20x10 ET7.2 5x112, Black Bright Diamond Cut'))
      .toBe('BMW M2 (G87) / BMW M3 (G80) / BMW M4 (G82)');
    expect(fitmentText('ADRO A13A10-1201 Front Lip for CHEVROLET Corvette (C8) 2020-')).toBe('CHEVROLET Corvette (C8) 2020-');
  });
  it('returns empty when there is no fitment phrase', () => {
    expect(fitmentText('ADVAN V6482 Wheel GT BEYOND 18x10 PCD 5x120 ET40 Racing White')).toBe('');
  });
});

describe('yearSpan', () => {
  it('parses closed, open and single years', () => {
    expect(yearSpan('FERRARI 458 Italia / Spider 2011-2015')).toEqual({ from: 2011, to: 2015 });
    expect(yearSpan('FERRARI 296 2021-')).toEqual({ from: 2021, to: 0 });
    expect(yearSpan('NISSAN Z (RZ34) 2023+')).toEqual({ from: 2023, to: 0 });
    expect(yearSpan('BMW M2 (G87)')).toBeNull();
  });
});

describe('wheelSpec', () => {
  it('reads generic sizes, offset and bolt pattern', () => {
    const s = wheelSpec('APEX VS5RS1785ET44-5100-561-BC Forged wheel VS-5RS 17x8.5 ET44 5x100 Brushed Clear for SUBARU BRZ');
    expect(s).toMatchObject({ diameter: 17, width: 8.5, et: 44, pcd: '5x100' });
  });
  it('reads Novitec front/rear set sizes', () => {
    const s = wheelSpec('NOVITEC F4 458 85 Wheels And Tyres Set NF9 21/22 J, Forged, Transparent Color, Polished for FERRARI 458 Italia / Spider 2011-2015');
    expect(s).toMatchObject({ diameter: 21, diameterRear: 22, set: true });
  });
  it('reads Novitec single wheels (width x diameter, axle)', () => {
    const s = wheelSpec('NOVITEC F4 458 73 Wheel NF9, Forged, 12,0J X 22J Rear, Solid Color for FERRARI 458 Italia / Spider 2011-2015');
    expect(s).toMatchObject({ width: 12, diameter: 22, axle: 'rear', set: false });
  });
  it('does not confuse "10.5x18" width-by-diameter with a bolt pattern', () => {
    const s = wheelSpec('TEAM SCHIRMER FE-BB105-E46SI Rim Set BBS E88 10x18 / 10.5x18 Silver for BMW M3 (E46)');
    expect(s.pcd).toBeNull();
    expect(s.diameter).toBe(18);
  });
  it('reads a signed offset written after the width', () => {
    const s = wheelSpec('UNPLUGGED PERFORMANCE UP-UP03 Single Wheel UP-03, Forged, 20x9.5+35 5x114.3, Satin Titanium for TESLA Model 3');
    expect(s).toMatchObject({ diameter: 20, width: 9.5, et: 35, pcd: '5x114.3' });
  });
  it('does not treat a "Central Lock Look" wheel as a real centre-lock hub', () => {
    expect(wheelSpec('NOVITEC F4 458 91 Wheels And Tyres Set NF10 21/22 J, Forged, Central Lock Look, Transparent Color, Polished for FERRARI 458 Italia').pcd).toBeNull();
    expect(wheelSpec('NOVITEC L4 222 23 Wheels And Tyres Set NL5, Forged, 20/21J, Central Lock, Transparent Color, Brushed for LAMBORGHINI Huracan').pcd).toBe('Centerlock');
  });
  it('reads centre bore and centre-lock', () => {
    expect(wheelSpec('BBS LM508 17x8 ET40 5x120 CB72.5 Gold').cb).toBe(72.5);
    expect(wheelSpec('BBS FI209 Wheel FI-R EVO for PORSCHE 911 GT3 (992.1) Rear 21x12 ET45, Center Lock').pcd).toBe('Centerlock');
  });
});

describe('wheelDesign', () => {
  it('extracts design names per vendor', () => {
    expect(wheelDesign('NOVITEC F4 458 85 Wheels And Tyres Set NF9 21/22 J, Forged for FERRARI 458', 'NOVITEC')).toBe('NF9');
    expect(wheelDesign('BBS FI025 Wheel FI for FERRARI 458 Front 20x8.75 ET44 5x114', 'BBS')).toBe('FI');
    expect(wheelDesign('BBS FI209 Wheel FI-R EVO for PORSCHE 911 GT3 (992.1) Rear 21x12 ET45', 'BBS')).toBe('FI-R EVO');
    expect(wheelDesign('ADVAN V6416 Wheel RZ-DF2 20x11.5J PCD 5x130 ET53 Racing Titanium Black for PORSCHE', 'ADVAN')).toBe('RZ-DF2');
    expect(wheelDesign('APEX SM101811ET44 Wheel SM-10 18x11 ET44 5x120 Race Silver for BMW', 'APEX RACE')).toBe('SM-10');
    expect(wheelDesign('TEAM SCHIRMER WHEEL-POL Rim Set GTX 10.5x19 / 11x19 Polished for BMW M2 (G87)', 'TEAM SCHIRMER')).toBe('GTX');
    expect(wheelDesign('BBS RE5045(BKD)BKD RE-L2 Forged aluminum 1-piece wheel 17x7 ET53 5x114.3', 'BBS')).toBe('RE-L2');
    expect(wheelDesign('BBS FI204 Wheel FI-R Evo for PORSCHE 992.1 Turbo S / GT3 Front, R20x9.5 ET44', 'BBS')).toBe('FI-R EVO');
  });
});

describe('kits', () => {
  it('classifies aero part subtypes', () => {
    expect(kitSubtype('Bumpers', 'VORSTEINER 4100BMV Front Spoiler EVO (Gloss Carbon) for BMW M4 GTS (F82) 2016-2017')).toBe('front-lip');
    expect(kitSubtype('Bumpers', 'VORSTEINER MVS3040 Rear Bumper VRS (Gloss Carbon) for MCLAREN Artura')).toBe('rear-bumper');
    expect(kitSubtype('Diffusers', 'x')).toBe('rear-diffuser');
    expect(kitSubtype('Wings & Rear Spoilers', 'VORSTEINER FRV1160 Decklid Spoiler VX AERO (Gloss Carbon) for FERRARI 458')).toBe('decklid-spoiler');
    expect(kitSubtype('Wings & Rear Spoilers', 'ADRO Swan Neck Wing AT-P2 for PORSCHE 911 GT3 (992)')).toBe('rear-wing');
    expect(kitSubtype('Aero Body Kit', 'NOVITEC Widebody Kit Esteso (14-Part) for LAMBORGHINI Urus')).toBe('widebody');
    expect(kitSubtype('Intercoolers Kits', 'x')).toBeNull();
  });
  it('reads materials', () => {
    expect(kitMaterial('Aero Body Kit (Gloss Carbon) for X')).toBe('Gloss carbon');
    expect(kitMaterial('Carbon Hood with Dome')).toBe('Carbon fibre');
  });
});

describe('finishInfo', () => {
  it('prefers the most specific finish name', () => {
    expect(finishInfo('Racing Titanium Black').name).toBe('Titanium Black');
    expect(finishInfo('Race Silver').name).toBe('Race Silver');
    expect(finishInfo('nothing here')).toBeNull();
  });
});

describe('samePattern', () => {
  it('treats 5x114 and 5x114.3 as the same and understands factory lists', () => {
    expect(samePattern('5x114.3', '5x114')).toBe(true);
    expect(samePattern('5x112 front / 5x120 rear', '5x120')).toBe(true);
    expect(samePattern('5x112', '5x120')).toBe(false);
    expect(samePattern('5x112', 'Centerlock')).toBe(true);
  });
});

describe('matchVehicles', () => {
  const item = (title, extra = {}) => ({ title, category: 'wheel', source: 'atomic-shop.ae', fitmentText: fitmentText(title), spec: wheelSpec(title), ...extra });
  const ids = (title, specs = {}) => matchVehicles(item(title), VEHICLES, (id) => specs[id]).ids;

  it('matches the Ferrari 458 Novitec wheel', () => {
    expect(ids('NOVITEC F4 458 85 Wheels And Tyres Set NF9 21/22 J, Forged for FERRARI 458 Italia / Spider 2011-2015')).toEqual(['ferrari-458']);
  });
  it('splits generation-specific BMW fitments by chassis code', () => {
    expect(ids('BBS RT88-011 Wheel RT88 for BMW M2 (F87) 19x9.5 ET20.2 5x120')).toEqual(['bmw-m2-f87']);
    expect(ids('BBS RT88-055 Wheel RT88 for BMW M2 (G87) / BMW M3 (G80) / BMW M4 (G82) 20x10 ET7.2 5x112')).toEqual(['bmw-m2-g87', 'bmw-m3-g80', 'bmw-m4-g82']);
  });
  it('does not treat a BMW chassis code that collides with another make (F12) as a Ferrari', () => {
    expect(ids('X Front Lip for BMW M6 (F12) 2012-2015')).not.toContain('ferrari-f12');
  });
  it('rejects a wheel whose bolt pattern contradicts the factory spec', () => {
    const r = matchVehicles(item('APEX Wheel X 18x9 ET40 5x100 Black for TOYOTA Supra'), VEHICLES, (id) => (id === 'toyota-supra-a80' ? { boltPattern: '5x114.3' } : { boltPattern: '5x112' }));
    expect(r.ids).toEqual([]);
    expect(r.dropped.length).toBeGreaterThan(0);
  });
  it('accepts an ambiguous title only for the generation whose bolt pattern matches', () => {
    const specs = { 'toyota-supra-a80': { boltPattern: '5x114.3' }, 'toyota-gr-supra': { boltPattern: '5x112' } };
    expect(ids('APEX Wheel X 18x9 ET40 5x112 Black for TOYOTA Supra', specs)).toEqual(['toyota-gr-supra']);
  });
  it('honours year ranges', () => {
    const it2 = { title: 'x', category: 'kit', source: 'atomic-shop.ae', fitmentText: 'FERRARI 458 Italia 2009-2015' };
    expect(matchVehicles(it2, VEHICLES).ids).toEqual(['ferrari-458']);
    const it3 = { title: 'x', category: 'kit', source: 'atomic-shop.ae', fitmentText: 'FERRARI 458 2021-' };
    expect(matchVehicles(it3, VEHICLES).ids).toEqual([]);
  });
  it('never invents fitment for make-only or empty text', () => {
    expect(ids('APEX Wheel EC-7 18x8.5 ET45 5x120 Race Silver for BMW')).toEqual([]);
    expect(ids('ADVAN V6482 Wheel GT BEYOND 18x10 PCD 5x120 ET40 Racing White')).toEqual([]);
  });
});

describe('normalizeProduct', () => {
  const base = { handle: 'h', vendor: 'X', tags: [], variants: [{ sku: 'S1', price: '1234.6', available: true }], images: [] };
  it('drops products that are neither wheels nor aero', () => {
    expect(normalizeProduct({ ...base, title: 'Brake pads for BMW M3', type: 'Brake Pads' }, 'atomic-shop.ae')).toBeNull();
  });
  it('builds a wheel record with spec, design and a real-image filter', () => {
    const n = normalizeProduct({ ...base, vendor: 'NOVITEC', type: 'Wheels', title: 'NOVITEC F4 458 85 Wheels And Tyres Set NF9 21/22 J, Forged, Transparent Color, Polished for FERRARI 458 Italia / Spider 2011-2015', images: [{ src: 'https://cdn/x/image-coming-soon_1.png' }] }, 'atomic-shop.ae');
    expect(n).toMatchObject({ category: 'wheel', design: 'NF9', priceAED: 1235, url: 'https://atomic-shop.ae/products/h' });
    expect(n.images).toEqual([]);
    expect(n.finish.name).toBe('Polished');
  });
  it('builds a kit record', () => {
    const n = normalizeProduct({ ...base, vendor: 'Vorsteiner', type: 'Wings & Rear Spoilers', title: 'VORSTEINER FRV1160 Decklid Spoiler VX AERO (Gloss Carbon) for FERRARI 458 Italia 2009-2015' }, 'atomic-shop.ae');
    expect(n).toMatchObject({ category: 'kit', subtype: 'decklid-spoiler', material: 'Gloss carbon' });
  });
});
