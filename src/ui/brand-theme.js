/*
 * Each make's own colours, used as a theme when a make is chosen: a deep ground (bg -> bg2), the ink that reads on
 * it, and one accent from the make's livery or crest. Colours only - marks come from brand.js and stay as they are.
 * Exposed as CSS custom properties so any element can take a make's look with `style` alone.
 */
const T = {
  Ferrari:          { bg: '#d40000', bg2: '#7a0000', ink: '#ffffff', acc: '#ffdd00', on: '#3a0000', name: 'Rosso Corsa' },
  Lamborghini:      { bg: '#141414', bg2: '#000000', ink: '#ffffff', acc: '#d4a72c', on: '#000000', name: 'Nero & Oro' },
  'Rolls Royce':    { bg: '#1d2340', bg2: '#0b0e1c', ink: '#f2f2f4', acc: '#c9ccd6', on: '#0b0e1c', name: 'Midnight & Silver' },
  'Mercedes Benz':  { bg: '#3a3d42', bg2: '#0f1012', ink: '#ffffff', acc: '#c6ccd3', on: '#0f1012', name: 'Silver Arrow' },
  Bentley:          { bg: '#124734', bg2: '#062519', ink: '#f4f1e8', acc: '#c9ad6e', on: '#062519', name: 'British Racing Green' },
  Porsche:          { bg: '#2b2b2b', bg2: '#0c0c0c', ink: '#ffffff', acc: '#d5001c', on: '#ffffff', name: 'Guards Red' },
  'Aston Martin':   { bg: '#00594f', bg2: '#002a25', ink: '#ffffff', acc: '#cedc00', on: '#002a25', name: 'Racing Green & Lime' },
  'Land Rover':     { bg: '#005a2b', bg2: '#00250f', ink: '#ffffff', acc: '#e9e4d8', on: '#00250f', name: 'Heritage Green' },
  McLaren:          { bg: '#ff8000', bg2: '#b34700', ink: '#111111', acc: '#111111', on: '#ff8000', name: 'Papaya' },
  BMW:              { bg: '#1c69d4', bg2: '#0a2a5c', ink: '#ffffff', acc: '#e7222e', on: '#ffffff', name: 'M Blue' },
  Bugatti:          { bg: '#1a3a8a', bg2: '#091a45', ink: '#ffffff', acc: '#e0b23c', on: '#091a45', name: 'French Blue' },
  Audi:             { bg: '#2a2a2a', bg2: '#0b0b0b', ink: '#ffffff', acc: '#bb0a30', on: '#ffffff', name: 'Progressive Red' },
  Maserati:         { bg: '#0c2340', bg2: '#040d1a', ink: '#ffffff', acc: '#c4a86a', on: '#040d1a', name: 'Blu Nobile' },
  Cadillac:         { bg: '#262a30', bg2: '#0a0b0d', ink: '#ffffff', acc: '#b8975a', on: '#0a0b0d', name: 'Crest' },
  'Alfa Romeo':     { bg: '#8f0d1e', bg2: '#3f040c', ink: '#ffffff', acc: '#1d6b3a', on: '#ffffff', name: 'Rosso Alfa' },
  Infiniti:         { bg: '#2a2d33', bg2: '#0d0e10', ink: '#ffffff', acc: '#c9ccd2', on: '#0d0e10', name: 'Graphite' }
};
const FALLBACK = { bg: '#1a1a1c', bg2: '#050505', ink: '#ffffff', acc: '#e3bf72', on: '#000000', name: 'Exotic' };

export const brandTheme = (make) => T[make] || FALLBACK;

/** Inline style that hands a make's colours to an element and its children. */
export const brandVars = (make) => {
  const t = brandTheme(make);
  return `--b-bg:${t.bg};--b-bg2:${t.bg2};--b-ink:${t.ink};--b-acc:${t.acc};--b-on:${t.on}`;
};

const LABEL = { 'Rolls Royce': 'Rolls-Royce', 'Mercedes Benz': 'Mercedes-Benz' };
export const makeLabel = (make) => LABEL[make] || make;
