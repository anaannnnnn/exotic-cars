/*
 * Picks the best Sketchfab 3D model for each stock car (not just for its generation), so the default is the closest,
 * best-built model - and cars with no trustworthy model get none instead of a wrong one.
 *
 *   node tools/match-stock-models.mjs            -> .cache/stockmodels/candidates.json  (ranked candidates per car)
 *
 * Scoring (see score()): the model's title must name the same make and model; year and variant words (Spider, Black Badge,
 * Performante ...) that agree add points and ones that disagree subtract; quality signals (sane polygon count, real
 * materials/textures, likes, permissive licence, embeddable, not age-restricted) add points. Renders are verified separately
 * by public/audit.html, which loads the winners in the Sketchfab viewer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/sources.mjs';

const CACHE = path.join(ROOT, '.cache', 'stockmodels');
fs.mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const BAD = /lego|minecraft|voxel|papercraft|toy\b|cartoon|toon\b|chibi|low[ -]?poly|game[ -]?ready|\bwip\b|wheel only|rim only|engine only|interior|cockpit|tuned|widebody|wide body|drift|racing|race car|gt3 ?r|liberty|lb.?works|zacoe|rocket bunny|crash|wreck|damaged|police|taxi|asphalt|forza|gta|roblox|nfs|need for speed|hot ?wheels|scale model|3d ?print|blueprint|template|rigged|animation|sdc\b|black panther|roger dubuis|lost\]|prior design|mansory|novitec|brabus|vorsteiner|onyx|keyvany|tuning|custom/i;
const GENERIC = new Set(['class', 'series', 'standard', 'coupe', 'spider', 'spyder', 'convertible', 'cabriolet', 'sedan', 'suv', 'hatchback', 'wagon', 'the', 'new', 'edition', 'gt', 'v8', 'v12', 'v10', 'awd', 'amg']);
const VARIANTS = ['spider', 'spyder', 'roadster', 'convertible', 'cabriolet', 'cabrio', 'volante', 'targa', 'touring', 'avant', 'sportback', 'coupe', 'gtc', 'gts', 'gtb', 'black badge', 'silver badge', 'series ii', 'ewb', 'extended', 'performante', 'superleggera', 'svj', 'pista', 'speciale', 'stradale', 'sto', 'evo', 'gt3', 'gt2', 'rs', 'turbo', 'competition', 'trofeo', 'tributo', 'aperta', 'maybach', 'speed', 'azure', 'mulliner', 'zenith', 'drophead', 'dawn', 'wraith'];
/* Different cars, not trim levels: a model carrying one of these words is never used for a car without it. */
const HARD = ['xx', 'folgore', 'electric', 'limousine', 'limo', 'pullman', 'gt3', 'gt2', 'gt4', 'cup', 'trofeo', 'black series', 'r pro', 'sterrato'];
const SPECIAL = ['ewb', 'extended', 'xx', 'pista', 'speciale', 'svj', 'sv', 'competizione', 'gt3', 'gt2', 'gt4', 'trofeo', 'sterrato', 'sto', 'tecnica', 'superleggera', 'black series', 'nismo', 'ultimae', 'folgore', 'electric', 'limousine', 'limo', 'pullman', 'brabus', 'hybrid', 'phev', 'cup', 'r pro'];
const LICENSE_PTS = { cc0: 8, by: 6, 'by-sa': 4, 'by-nd': 1, st: 1 };   /* nc / ed licences get nothing */

/* One request, hard-limited: the timer covers connecting AND reading the body (a stalled body used to hang the run). */
async function once(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'ApexAtelierMatch/1.0', Accept: 'application/json' }, signal: ctl.signal });
    if (res.status === 429 || res.status >= 500) return { retry: true };
    if (res.status === 404 || res.status === 403) return { json: { notFound: true } };
    if (!res.ok) return { json: null };
    return { json: await res.json() };
  } catch { return { retry: true }; } finally { clearTimeout(timer); }
}

async function api(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const r = await once(url);
    if (!r.retry) return r.json;
    await sleep(3000 * (i + 1));
  }
  return null;   /* failed: the caller must not cache this */
}

const cached = async (key, fn) => {
  const f = path.join(CACHE, `${key.replace(/[^a-z0-9]+/gi, '_').slice(0, 120)}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const v = await fn();
  if (v != null) fs.writeFileSync(f, JSON.stringify(v));   /* only successes are cached */
  return v;
};

async function search(q) {
  return cached(`s_${norm(q)}`, async () => {
    const j = await api(`https://api.sketchfab.com/v3/search?type=models&categories=cars-vehicles&count=24&q=${encodeURIComponent(q)}`);
    await sleep(350);
    if (!j) return null;
    return (j?.results || []).filter((r) => r.uid && r.name).map((r) => ({ uid: r.uid, name: r.name, likes: r.likeCount || 0, faces: r.faceCount || 0, author: r.user?.displayName || r.user?.username || '', thumb: (r.thumbnails?.images || []).sort((a, b) => a.width - b.width).find((i) => i.width >= 400)?.url || '', url: r.viewerUrl, age: !!r.isAgeRestricted }));
  });
}

async function detail(uid) {
  return cached(`d_${uid}`, async () => {
    const j = await api(`https://api.sketchfab.com/v3/models/${uid}`);
    await sleep(300);
    if (j?.notFound) return { faces: 0, embed: false, age: false, license: '' };
    return j ? { faces: j.faceCount, verts: j.vertexCount, tex: j.textureCount, mats: j.materialCount, anim: j.animationCount, license: j.license?.slug || '', embed: !!j.embedUrl, age: !!j.isAgeRestricted, likes: j.likeCount, views: j.viewCount, published: j.publishedAt, tags: (j.tags || []).map((t) => t.name).slice(0, 12) } : null;
  });
}

function parts(car) {
  const brand = norm(car.brand.replace('Benz', '')).split(' ')[0];
  const t = norm(car.title);
  const brandWords = norm(car.brand).split(' ');
  const meaningful = (w) => w && !GENERIC.has(w) && !brandWords.includes(w) && (w.length >= 2 || /\d/.test(w));
  const rest = t.split(' ').filter((w) => !brandWords.includes(w));
  let core = norm(car.model || '').split(' ').filter(meaningful);
  /* a model field like "G Class" says too little ("g" matches everything): fall back to what the title says, e.g. "g63" */
  if (!core.length || core.every((w) => w.length < 3 && !/\d/.test(w))) core = rest.filter(meaningful).slice(0, 2);
  if (!core.length) core = rest.slice(0, 2);
  return { brand, core, rest, t };
}

const has = (hay, w) => ` ${hay} `.includes(` ${w} `) || ((w.length >= 4 || /\d/.test(w)) && w.length >= 3 && hay.replace(/ /g, '').includes(w.replace(/ /g, '')));

function preScore(car, p, c) {
  const n = norm(c.name);
  if (BAD.test(c.name)) return -999;
  if (!has(n, p.brand) && !p.brand.startsWith('mercedes')) return -500;
  if (p.brand.startsWith('mercedes') && !/mercedes|benz|amg|maybach/.test(n)) return -500;
  const coreHit = p.core.filter((w) => has(n, w)).length;
  if (!coreHit) return -400;
  let s = 30 + coreHit * 25 - (p.core.length - coreHit) * 15;
  /* variant words the car has / lacks */
  for (const v of VARIANTS) {
    const inCar = has(p.t, v), inModel = has(n, v);
    if (inCar && inModel) s += 12;
    else if (!inCar && inModel) s -= 9;
    else if (inCar && !inModel && ['spider', 'spyder', 'roadster', 'convertible', 'volante', 'gtc', 'drophead'].includes(v)) s -= 14;
  }
  for (const w of HARD) if (has(n, w) && !has(p.t, w) && !has(norm(car.model || ''), w)) return -700;
  for (const w of SPECIAL) if (has(n, w) && !has(p.t, w) && !has(norm(car.model || ''), w)) s -= 24;
  /* years in the model's name */
  const ys = [...n.matchAll(/\b(19[5-9]\d|20[0-3]\d)\b/g)].map((m) => +m[1]);
  if (ys.length && car.year) { const d = Math.min(...ys.map((y) => Math.abs(y - car.year))); s += d <= 1 ? 16 : d <= 3 ? 8 : d > 6 ? -30 : -12; }
  s += Math.min(14, Math.log10(1 + c.likes) * 5);
  return s;
}

function quality(d) {
  if (!d || !d.embed || d.age) return -999;
  let s = 0;
  const f = d.faces || 0;
  s += f < 12000 ? -30 : f < 35000 ? -10 : f <= 450000 ? 14 : f <= 800000 ? 6 : f <= 1300000 ? -8 : -30;
  s += (d.mats || 0) >= 6 ? 6 : (d.mats || 0) >= 3 ? 2 : -8;
  s += (d.tex || 0) > 0 || (d.mats || 0) >= 12 ? 3 : 0;
  s += (d.anim || 0) > 0 ? -10 : 0;
  s += LICENSE_PTS[d.license] ?? -3;
  return s;
}

const stock = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'stock.json'), 'utf8'));
const cars = stock.cars.filter((c) => !c.sold);
const groups = new Map();
cars.forEach((c) => { const k = `${norm(c.title)}|${c.year}`; if (!groups.has(k)) groups.set(k, { car: c, ids: [] }); groups.get(k).ids.push(c.id); });
console.log(`${cars.length} cars for sale in ${groups.size} distinct title+year groups`);

const out = {};
let n = 0;
const queue = [...groups];
async function work() {
  while (queue.length) {
    const [key, g] = queue.shift();
    n++;
    const car = g.car, p = parts(car);
    const queries = [...new Set([`${car.brand} ${car.title.replace(new RegExp(`^${car.brand}\\s*`, 'i'), '')}`, `${car.brand} ${car.model || ''} ${car.year || ''}`.trim(), `${car.brand} ${car.model || ''}`.trim()])];
    const seen = new Map();
    for (const q of queries) { if (process.env.TRACE) console.log(`[${n}] search: ${q}`); for (const r of (await search(q)) || []) if (!seen.has(r.uid)) seen.set(r.uid, r); }
    const pre = [...seen.values()].map((c) => ({ c, pre: preScore(car, p, c) })).filter((x) => x.pre > 0).sort((a, b) => b.pre - a.pre).slice(0, 7);
    const ranked = [];
    for (const { c, pre: ps } of pre) {
      if (process.env.TRACE) console.log(`[${n}] detail: ${c.uid} ${c.name.slice(0, 40)}`);
      const d = await detail(c.uid);
      const q = quality(d);
      if (q < -100) continue;
      ranked.push({ uid: c.uid, name: c.name, author: c.author, url: c.url, thumb: c.thumb, license: d?.license || '', faces: d?.faces, mats: d?.mats, likes: c.likes, match: Math.round(ps), quality: q, score: Math.round(ps + q) });
    }
    ranked.sort((a, b) => b.score - a.score);
    out[key] = { ids: g.ids, title: car.title, year: car.year, candidates: ranked.slice(0, 4) };
    if (n % 20 === 0) console.log(`${n}/${groups.size}`);
  }
}
await Promise.all([work(), work(), work()]);
fs.writeFileSync(path.join(CACHE, 'candidates.json'), JSON.stringify(out));
const none = Object.values(out).filter((g) => !g.candidates.length || g.candidates[0].score < 60);
console.log(`done. ${Object.keys(out).length} groups, ${none.length} without a confident model`);
