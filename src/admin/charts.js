import { h, svg } from './ui.js';

/* Small SVG charts shared by the Forecast and Purchasing screens. Plain bars, a forecast band, no library. */
export const monthShort = (ym) => new Date(`${ym}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'short' });
export const monthLong = (ym) => new Date(`${ym}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

/** History as grey bars, then the forecast as red bars with a lighter band for the range. `fmt` formats the y axis. */
export function trendChart({ hist, fc, fmt = (v) => String(Math.round(v * 10) / 10), axisFmt = (v) => String(Math.round(v)), height = 230, labelEvery = 1, nowLabel = 'Forecast' }) {
  const W = 700, H = height, pad = { l: 40, r: 8, t: 12, b: 26 };
  const n = hist.length + fc.length, bw = (W - pad.l - pad.r) / Math.max(1, n);
  const max = Math.max(1, ...hist.map((x) => x.v), ...fc.map((x) => x.hi ?? x.v)) * 1.12;
  const y = (v) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const els = [];
  for (let i = 0; i <= 4; i++) { const v = (max / 4) * i; els.push(svg('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'ch__grid' }), svg('text', { x: pad.l - 6, y: y(v) + 3, 'text-anchor': 'end', class: 'ch__ax' }, [axisFmt(v)])); }
  hist.forEach((x, i) => {
    const bx = pad.l + i * bw + bw * 0.16;
    els.push(svg('rect', { x: bx, y: y(x.v), width: bw * 0.68, height: Math.max(1, H - pad.b - y(x.v)), rx: 3, class: 'ch__hist' }, [svg('title', {}, [`${x.label}: ${fmt(x.v)}`])]));
    if (i % labelEvery === 0) els.push(svg('text', { x: bx + bw * 0.34, y: H - 8, 'text-anchor': 'middle', class: 'ch__ax' }, [x.label]));
  });
  fc.forEach((x, j) => {
    const i = hist.length + j, bx = pad.l + i * bw + bw * 0.16;
    if (x.hi != null) els.push(svg('rect', { x: bx, y: y(x.hi), width: bw * 0.68, height: Math.max(2, y(x.lo ?? 0) - y(x.hi)), rx: 3, class: 'ch__band' }));
    els.push(svg('rect', { x: bx, y: y(x.v), width: bw * 0.68, height: Math.max(1, H - pad.b - y(x.v)), rx: 3, class: 'ch__fc' }, [svg('title', {}, [`${x.label}: ${fmt(x.v)}${x.hi != null ? ` (${fmt(x.lo)} to ${fmt(x.hi)})` : ''}`])]));
    if ((hist.length + j) % labelEvery === 0) els.push(svg('text', { x: bx + bw * 0.34, y: H - 8, 'text-anchor': 'middle', class: 'ch__ax ch__ax--fc' }, [x.label]));
  });
  if (hist.length && fc.length) { const split = pad.l + hist.length * bw; els.push(svg('line', { x1: split, x2: split, y1: pad.t, y2: H - pad.b, class: 'ch__now' }), svg('text', { x: split + 6, y: pad.t + 10, class: 'ch__ax' }, [nowLabel])); }
  return h('div', { class: 'chart' }, [
    h('div', { class: 'ch__key' }, [h('span', { class: 'ch__k ch__k--hist', text: 'So far' }), h('span', { class: 'ch__k ch__k--fc', text: 'Forecast' }), fc.some((x) => x.hi != null) ? h('span', { class: 'ch__k ch__k--band', text: 'Likely range' }) : null].filter(Boolean)),
    svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ch', role: 'img', 'aria-label': 'Sales so far and the forecast' }, els)
  ]);
}

/** A thin meter: `value` against `max`, optionally flagged. */
export const meter = (value, max, tone = '') => h('span', { class: `mt${tone ? ` mt--${tone}` : ''}`, role: 'presentation' }, h('i', { style: `width:${Math.max(0, Math.min(100, max ? (value / max) * 100 : 0))}%` }));

/** Download rows as a CSV file (every cell quoted; leading = + - @ neutralised so a spreadsheet cannot run it). */
export function downloadCsv(name, rows) {
  const cell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  const blob = new Blob([`${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
