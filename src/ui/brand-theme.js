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
const FALLBACK = { bg: '#1a1a1c', bg2: '#050505', ink: '#ffffff', acc: '#d4182c', on: '#000000', name: 'Exotic' };


/*
 * Typography kit per make: the face its pages are set in, plus weight, tracking and case. Faces are the ones the app
 * already ships (main.js): Archivo, Bodoni Moda, Jost, Inter Tight, Instrument Sans, IBM Plex Mono and Michroma.
 */
const BODONI = "'Bodoni Moda Variable', 'Times New Roman', serif";
const JOST = "'Jost Variable', 'Instrument Sans Variable', system-ui, sans-serif";
const TIGHT = "'Inter Tight Variable', 'Instrument Sans Variable', system-ui, sans-serif";
const ARCH = "'Archivo Variable', 'Instrument Sans Variable', system-ui, sans-serif";
const INSTR = "'Instrument Sans Variable', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";
const MICH = "'Michroma', 'Instrument Sans Variable', system-ui, sans-serif";
const TYPE = {
  Ferrari:         { font: ARCH,   wt: 800, track: '-0.02em', up: 'uppercase' },
  Lamborghini:     { font: MICH,   wt: 400, track: '0.03em',  up: 'uppercase' },
  'Rolls Royce':   { font: BODONI, wt: 500, track: '0.005em', up: 'none' },
  'Mercedes Benz': { font: TIGHT,  wt: 300, track: '0.14em',  up: 'uppercase' },
  Bentley:         { font: BODONI, wt: 600, track: '0.08em',  up: 'uppercase' },
  Porsche:         { font: JOST,   wt: 600, track: '0.06em',  up: 'uppercase' },
  'Aston Martin':  { font: JOST,   wt: 400, track: '0.18em',  up: 'uppercase' },
  'Land Rover':    { font: INSTR,  wt: 700, track: '0.02em',  up: 'uppercase' },
  McLaren:         { font: MONO,   wt: 500, track: '0.05em',  up: 'uppercase' },
  BMW:             { font: INSTR,  wt: 700, track: '0.02em',  up: 'uppercase' },
  Bugatti:         { font: BODONI, wt: 500, track: '0.2em',   up: 'uppercase' },
  Audi:            { font: JOST,   wt: 500, track: '0em',     up: 'none' },
  Maserati:        { font: TIGHT,  wt: 500, track: '0.12em',  up: 'uppercase' },
  Cadillac:        { font: TIGHT,  wt: 600, track: '0.1em',   up: 'uppercase' },
  'Alfa Romeo':    { font: ARCH,   wt: 700, track: '0.04em',  up: 'uppercase' },
  Infiniti:        { font: JOST,   wt: 300, track: '0.16em',  up: 'uppercase' }
};
const TYPE_FALLBACK = { font: INSTR, wt: 600, track: '0em', up: 'none' };
export const brandType = (make) => TYPE[make] || TYPE_FALLBACK;

export const brandTheme = (make) => T[make] || FALLBACK;

/** Inline style that hands a make's colours to an element and its children. */
export const brandVars = (make) => {
  const t = brandTheme(make), y = brandType(make);
  return `--b-bg:${t.bg};--b-bg2:${t.bg2};--b-ink:${t.ink};--b-acc:${t.acc};--b-on:${t.on};--b-font:${y.font};--b-wt:${y.wt};--b-track:${y.track};--b-case:${y.up}`;
};

const LABEL = { 'Rolls Royce': 'Rolls-Royce', 'Mercedes Benz': 'Mercedes-Benz' };
export const makeLabel = (make) => LABEL[make] || make;
