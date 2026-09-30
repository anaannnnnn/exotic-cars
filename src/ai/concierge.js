import * as stock from '../data/stock.js';

/*
 * The concierge's brain, running on this device: it reads a plain-language request, works out the filters it implies
 * (make, body, year, mileage, colour, power, 3D, sold) and answers from the live stock. Follow-ups refine the previous
 * question ("only SUVs", "newer ones"). Booking, VR and price questions hand off to the right place.
 *
 * To put a hosted language model behind the same UI later, set window.EXOTIC_CONCIERGE = async (text, history) =>
 * ({ text, carIds?, actions?, suggestions? }) - for example a small server function that calls the Claude API with the
 * stock list as context. Its answer is rendered exactly like the local one, and the local engine stays as the fallback.
 */

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.+ ]+/g, ' ').replace(/\s+/g, ' ').trim();

const MAKES = [
  ['Ferrari', /\bferraris?\b|prancing horse/], ['Lamborghini', /\blamborghinis?\b|\blambos?\b/], ['Rolls Royce', /\brolls ?royces?\b|\brolls\b|\brr\b/],
  ['Mercedes Benz', /\bmercedes|\bmercs?\b|\bbenz\b|\bamg\b|\bmaybachs?\b/], ['Bentley', /\bbentleys?\b/], ['Porsche', /\bporsches?\b/],
  ['Aston Martin', /\bastons?\b/], ['Land Rover', /\bland rovers?|\brange rovers?|\bdefenders?\b/], ['McLaren', /\bmc ?larens?\b/], ['BMW', /\bbmws?\b/],
  ['Audi', /\baudis?\b/], ['Maserati', /\bmaseratis?\b/], ['Bugatti', /\bbugattis?\b/], ['Cadillac', /\bcadillacs?\b/]
];
const BODIES = [
  ['suv', /\bsuvs?\b|\b4x4\b|\boff ?road|\bfamily\b/, /suv|crossover|4x4/],
  ['convertible', /\bconvertibles?|\bcabrio(let)?s?\b|\bspy?ders?\b|\broadsters?\b|\bopen top|\bdrop ?top/, /convertible|cabrio|spider|spyder|roadster/],
  ['coupe', /\bcoupes?\b|\bsports? cars?\b|\bsupercars?\b/, /coupe|coupé/],
  ['sedan', /\bsedans?\b|\bsaloons?\b|\bchauffeur/, /sedan|saloon/]
];
const COLOURS = ['black', 'white', 'silver', 'grey', 'gray', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'brown', 'beige', 'gold', 'pink'];

const num = (s) => Number(String(s).replace(/[, ]/g, '').replace(/k$/i, '000'));
const hpOf = (c) => { const m = String(c.hp || '').match(/\d{3,4}/g); return m ? Math.max(...m.map(Number)) : 0; };

/** Filters implied by one message; `prev` carries the last question's filters for follow-ups. */
export function parse(text, prev = null) {
  const q = norm(text);
  const f = {};
  /* a follow-up refines the last search; naming a different make starts a new one */
  const follow = prev && /^(only|just|and|but|now|what about|how about|newer|older|newest|latest|oldest|most|sort|lower|less|more|in |with |also )/.test(q);
  if (follow) Object.assign(f, prev);

  for (const [name, rx] of MAKES) if (rx.test(q)) { if (follow && f.brand && f.brand !== name) { delete f.q; } f.brand = name; break; }
  for (const [id, rx] of BODIES) if (rx.test(q)) { f.body = id; break; }
  const colour = COLOURS.find((c) => new RegExp(`\\b${c}\\b`).test(q));
  if (colour) f.colour = colour === 'gray' ? 'grey' : colour;

  let m;
  if ((m = q.match(/\b(?:after|since|newer than|from|over|above)\s+(20\d\d|19\d\d)\b/))) f.from = +m[1] + (/after|newer/.test(m[0]) ? 1 : 0);
  if ((m = q.match(/\b(?:before|older than|until|up to)\s+(20\d\d|19\d\d)\b/))) f.to = +m[1] - (/before|older/.test(m[0]) ? 1 : 0);
  if ((m = q.match(/\b(20\d\d|19\d\d)\s*(?:to|-)\s*(20\d\d|19\d\d)\b/))) { f.from = +m[1]; f.to = +m[2]; }
  else if (!f.from && !f.to && (m = q.match(/\b(20[0-3]\d|19\d\d)\b/))) { f.from = +m[1]; f.to = +m[1]; }
  if (/\b(newest|latest|brand new|new ones)\b/.test(q) || (/\bnewer\b/.test(q) && !/\bnewer than\b/.test(q))) f.sort = 'new';
  if (/\b(oldest|classic|vintage)\b/.test(q) || (/\bolder\b/.test(q) && !/\bolder than\b/.test(q))) f.sort = 'old';

  if ((m = q.match(/\b(?:under|below|less than|max|maximum)\s+([\d,.]+k?)\s*(?:km|kms|kilomet)/))) f.kmMax = num(m[1]);
  if (/\b(low|lowest) (mileage|km|kms)\b|\bbarely driven|\bdelivery mileage|\bzero km|\b0 km/.test(q)) f.kmMax = Math.min(f.kmMax || Infinity, 10000);
  if ((m = q.match(/\b(?:over|above|more than|at least|min)\s+(\d{3,4})\s*(?:hp|bhp|horsepower|horses)/))) f.hpMin = +m[1];
  if (/\b(fastest|most powerful|quickest)\b/.test(q)) f.sort = 'power';
  if (/\b(3d|configur\w*|customi[sz]\w*|personali[sz]\w*|spec it|build (it|one))/.test(q)) f.configurable = true;
  if (/\b(sold|previously sold|past sales)\b/.test(q)) f.sold = true;
  else if (follow && /\bfor sale|available|in stock\b/.test(q)) f.sold = false;
  if (/\b(new arrivals?|just arrived|fresh)\b/.test(q)) f.fresh = true;

  /* whatever is left that looks like a model name ("cullinan", "sf90", "g63") becomes a free-text term */
  const STOP = /^(a|an|the|i|me|my|we|want|need|looking|look|for|show|find|get|any|some|car|cars|with|and|or|in|of|to|is|are|do|you|have|please|under|over|than|only|just|that|one|ones|can|could|would|like|good|best|from|after|before|km|kms|hp|new|used|stock|available|what|which|about|how|it|this|there|on|at|by|be|newer|older|cheaper|show|me|colour|color|mileage|low|year|years|first|newest|latest|oldest|most|powerful|fastest|quickest|order|sort|sorted|configure|configurable|3d|sold|previously|arrivals|arrival|under|km|kms)$/;
  const known = new RegExp(`${MAKES.map(([, rx]) => rx.source).join('|')}|${BODIES.map(([, rx]) => rx.source).join('|')}|\\b(${COLOURS.join('|')})\\b|\\b(19|20)\\d\\d\\b|\\b[\\d,.]+k?\\s*(km|kms|kilometres?|kilometers?|hp|bhp|horsepower)\\b`, 'g');
  const words = q.replace(known, ' ').split(' ').filter((w) => w.length > 1 && !STOP.test(w));
  const terms = words.filter((w) => stock.queryStock({ tab: f.sold ? 'sold' : 'sale', q: w }).length);
  if (terms.length) f.q = terms.join(' ');
  else if (!follow) delete f.q;
  return f;
}

function search(f) {
  let cars = stock.queryStock({ tab: f.sold ? 'sold' : f.fresh ? 'new' : 'sale', q: f.q || '', brand: f.brand || '', from: f.from || 0, to: f.to || 0 });
  if (f.body) { const rx = BODIES.find(([id]) => id === f.body)[2]; cars = cars.filter((c) => rx.test(String(c.body || '').toLowerCase()) || rx.test(norm(c.title))); }
  if (f.colour) cars = cars.filter((c) => norm(c.exterior).includes(f.colour));
  if (f.kmMax) cars = cars.filter((c) => c.km != null && c.km <= f.kmMax);
  if (f.hpMin) cars = cars.filter((c) => hpOf(c) >= f.hpMin);
  if (f.configurable) cars = cars.filter((c) => !c.sold && stock.configuratorMatch(c));
  const by = { new: (a, b) => (b.year || 0) - (a.year || 0), old: (a, b) => (a.year || 0) - (b.year || 0), power: (a, b) => hpOf(b) - hpOf(a) }[f.sort];
  return by ? [...cars].sort(by) : cars;
}

function describe(f) {
  const bits = [];
  if (f.sort === 'power') bits.push('most powerful');
  if (f.sort === 'new') bits.push('newest');
  if (f.colour) bits.push(f.colour);
  if (f.brand) bits.push({ 'Rolls Royce': 'Rolls-Royce', 'Mercedes Benz': 'Mercedes-Benz' }[f.brand] || f.brand);
  if (f.q) bits.push(f.q.replace(/\b\w/g, (c) => c.toUpperCase()));
  bits.push({ suv: 'SUVs', convertible: 'convertibles', coupe: 'coupés', sedan: 'saloons' }[f.body] || 'cars');
  const tail = [];
  if (f.from && f.to && f.from === f.to) tail.push(`from ${f.from}`);
  else { if (f.from) tail.push(`from ${f.from} on`); if (f.to) tail.push(`up to ${f.to}`); }
  if (f.kmMax) tail.push(`under ${f.kmMax.toLocaleString('en-US')} km`);
  if (f.hpMin) tail.push(`over ${f.hpMin} hp`);
  if (f.configurable) tail.push('you can configure in 3D');
  return `${bits.join(' ')}${tail.length ? ` ${tail.join(', ')}` : ''}`;
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** One concierge turn. Returns { text, cars, actions, suggestions, filters }. */
export async function ask(text, state = {}) {
  if (typeof window !== 'undefined' && typeof window.EXOTIC_CONCIERGE === 'function') {
    try {
      const r = await window.EXOTIC_CONCIERGE(text, state.history || []);
      if (r && r.text) return { text: r.text, cars: (r.carIds || []).map(stock.stockCar).filter(Boolean), actions: r.actions || [], suggestions: r.suggestions || [], filters: state.filters };
    } catch { /* fall back to the on-device engine */ }
  }
  const q = norm(text);
  const sale = stock.queryStock({ tab: 'sale' }).length;

  if (!q || /^(hi|hello|hey|salam|hola|good (morning|evening|afternoon))\b/.test(q)) {
    return { text: `Hello. I know all ${sale} cars in the showroom. Tell me what you have in mind — a make, a body style, a year, a colour — and I'll find it.`, cars: [], actions: [], suggestions: ['Show me Ferrari convertibles', 'Low mileage SUVs', 'Cars I can configure in 3D', 'Book a test drive'] };
  }
  if (/\b(book|appointment|test ?drive|viewing|service|detailing|maintenance)\b/.test(q)) {
    const car = state.focus ? stock.stockCar(state.focus) : null;
    return { text: car ? `I can book you in for the ${car.title}. Pick a day and a time — the team confirms by phone.` : 'Happy to arrange that. Choose the service, a day and a time, and the team confirms by phone.', cars: car ? [car] : [], actions: [{ kind: 'service', label: car ? 'Book a test drive' : 'Open booking', car: car ? car.title : '' }], suggestions: ['Show me new arrivals', 'What can I configure in 3D?'] };
  }
  if (/\b(vr|virtual reality|ar|augmented|headset|walk around)\b/.test(q)) {
    return { text: 'The VR showroom lets you step around any car, or place it in your driveway with AR on your phone.', cars: [], actions: [{ kind: 'vr', label: 'Open the VR showroom' }], suggestions: ['Show me McLarens', 'Newest arrivals'] };
  }
  if (/\b(price|cost|how much|aed|budget|cheap|expensive|finance|lease)\b/.test(q)) {
    return { text: 'Prices are shared on request, so they are always current. Ask about any car and the team will send the price, finance and part-exchange options.', cars: [], actions: [{ kind: 'service', label: 'Ask for a price', service: 'Configuration consultation' }], suggestions: ['Show me Rolls-Royce', 'SUVs from 2024'] };
  }

  const filters = parse(text, state.filters || null);
  const hasFilter = ['brand', 'body', 'colour', 'from', 'to', 'kmMax', 'hpMin', 'configurable', 'sold', 'fresh', 'q', 'sort'].some((k) => filters[k] != null && filters[k] !== false);
  if (!hasFilter) {
    return { text: "I didn't catch a make, style or detail there. Try something like \"black SUVs from 2024\" or \"Lamborghini under 5,000 km\".", cars: [], actions: [], suggestions: ['Black SUVs from 2024', 'Lamborghini under 5,000 km', 'Most powerful cars'] };
  }
  const cars = search(filters);
  const what = describe(filters);
  if (!cars.length) {
    const loose = search({ ...filters, colour: undefined, kmMax: undefined, hpMin: undefined, from: undefined, to: undefined });
    return {
      text: `No ${what} in stock right now.${loose.length ? ` Closest I have: ${loose.length} without those limits.` : ' New cars arrive every week — the team can source one for you.'}`,
      cars: loose.slice(0, 6), actions: [{ kind: 'service', label: 'Ask the team to source one', service: 'Configuration consultation' }], suggestions: ['Show everything for sale', 'New arrivals'], filters
    };
  }
  if (filters.sort) {
    const order = { new: 'Newest first', old: 'Oldest first', power: 'Most powerful first' }[filters.sort];
    const plain = describe({ ...filters, sort: undefined });
    const text = cars.length === 1 ? `${order}: the one ${plain.replace(/s$/, '')} I have.` : `${order} — ${cars.length} ${plain}.${cars.length > 6 ? ' Here are the top six.' : ''}`;
    return { text, cars: cars.slice(0, 6), actions: [], suggestions: ['Only SUVs', 'Under 10,000 km', 'Only ones I can configure'].slice(0, 3), filters };
  }
  const opener = pick(['Here', 'I found', 'There']);
  const lead = cars.length === 1 ? `${opener === 'There' ? 'There is' : opener === 'Here' ? 'Here is' : 'I found'} one ${what.replace(/s$/, '')}.` : `${opener === 'There' ? 'There are' : opener === 'Here' ? 'Here are' : 'I found'} ${cars.length} ${what}.`;
  const extra = cars.length > 6 ? ' The closest six are below — ask me to narrow it down.' : '';
  const sugg = [];
  if (!filters.body) sugg.push('Only SUVs');
  if (!filters.kmMax) sugg.push('Under 10,000 km');
  if (!filters.configurable) sugg.push('Only ones I can configure');
  if (filters.sort !== 'new') sugg.push('Newest first');
  return { text: lead + extra, cars: cars.slice(0, 6), actions: [], suggestions: sugg.slice(0, 3), filters };
}
