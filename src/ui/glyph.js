const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs) => { const n = document.createElementNS(NS, name); Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v)); return n; };

/** A neat line-drawn alloy wheel, tinted with the wheel's finish. Used when a supplier lists no photo. */
export function wheelGlyph(color = '#9a9da5') {
  const svg = el('svg', { viewBox: '0 0 100 100', class: 'glyph', 'aria-hidden': 'true' });
  svg.append(
    el('circle', { cx: 50, cy: 50, r: 44, fill: '#1b1c20' }),
    el('circle', { cx: 50, cy: 50, r: 37, fill: color, stroke: 'rgba(0,0,0,.25)', 'stroke-width': 1 }),
    el('circle', { cx: 50, cy: 50, r: 30, fill: '#15161a' })
  );
  for (let i = 0; i < 10; i++) {
    const a = (i * 36 * Math.PI) / 180;
    const p = (r, w) => [50 + Math.cos(a) * r, 50 + Math.sin(a) * r, w];
    const [x1, y1] = p(9, 0), [x2, y2] = p(33, 0);
    svg.append(el('line', { x1, y1, x2, y2, stroke: color, 'stroke-width': 4.2, 'stroke-linecap': 'round' }));
  }
  svg.append(el('circle', { cx: 50, cy: 50, r: 8.5, fill: color }), el('circle', { cx: 50, cy: 50, r: 3, fill: '#15161a' }));
  return svg;
}
