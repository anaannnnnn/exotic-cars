/* Sketchfab Data API lookups with an on-disk cache (.cache/sketchfab). */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './sources.mjs';

const CACHE = path.join(ROOT, '.cache', 'sketchfab');
const EXCLUDE = /lego|minecraft|voxel|papercraft|paper\b|toy\b|fanart|sketch|template|rigged only|blueprint|wip\b|scan\b|wheel only|rim only|engine|gearbox|transmission|cockpit|interior|chassis|suspension|tire|tyre|parts?\b|lowpoly|low[ -]poly|game ready|gta|forza|roblox|cartoon|chibi/i;
/* Race, tuned, drift and game-asset variants are not the stock road car the fitment data describes. */
const TUNED = /gt3 ?r\b|gt3 ?evo|gt3 ?cup|super ?trofeo|\bgt4 ?(rs|clubsport)\b|lmgte|\blms\b|widebody|wide body|body ?kit|liberty ?walk|lb[★☆ ]?works|lb[★☆ ]?nation|rocket bunny|pandem|varis|zacoe|adro\b|mansory|vorsteiner|duke dynamics|novitec|brabus|stance|drift|rally|wrc|need for speed|\bnfs\b|patrol|crash|animation|sdc\b|xeno|vaho|razor|by mso|acschnitzer|prior design|hgte|modificata|gtr ?s3/i;
const RACE_ONLY = /gt[34]|[_ -]gte\b|[_ -]gtd\b|\bsuper ?trofeo\b/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A four-digit year in the title must fall inside the vehicle's production span (with a little slack). */
function yearPlausible(name, v) {
  const m = name.match(/\b(19[3-9]\d|20[0-3]\d)\b/);
  if (!m) return true;
  const y = +m[1];
  return y >= v.from - 1 && y <= (v.to || 2100) + 2;
}

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.status === 429) { await sleep(5000 * (i + 1)); continue; }
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.json();
    } catch (err) {
      if (i === tries - 1) throw err;
      await sleep(1500 * (i + 1));
    }
  }
  return null;
}

function pickThumb(images) {
  if (!images?.length) return '';
  const sorted = [...images].sort((a, b) => a.width - b.width);
  return (sorted.find((i) => i.width >= 400) || sorted[sorted.length - 1]).url;
}

/** Up to `limit` real, licensed, embeddable models whose title names the car (regex-gated). */
export async function findModels(vehicle, limit = 4) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `${vehicle.id}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));

  const { q, rx, prefer } = vehicle.sf;
  const url = `https://api.sketchfab.com/v3/search?type=models&categories=cars-vehicles&count=24&q=${encodeURIComponent(q)}`;
  const json = await getJson(url);
  const makeWord = norm(vehicle.make).split(' ')[0];
  const seen = new Set();
  const list = (json.results || [])
    .filter((r) => r?.uid && r.name && r.license && r.name.trim().length >= 6)
    .filter((r) => !EXCLUDE.test(r.name))
    .filter((r) => !TUNED.test(r.name))
    .filter((r) => /gt[34]/i.test(`${vehicle.id} ${vehicle.model}`) || !RACE_ONLY.test(r.name))
    .filter((r) => !vehicle.sf.not || !vehicle.sf.not.test(r.name))
    .filter((r) => yearPlausible(r.name, vehicle))
    .filter((r) => rx.test(r.name) || rx.test(norm(r.name)))
    .filter((r) => norm(r.name).includes(makeWord) || vehicle.sf.noMake)
    .map((r) => ({ r, boost: prefer && (prefer.test(r.name) ? 1 : 0) }))
    .sort((a, b) => (b.boost - a.boost) || ((b.r.likeCount || 0) - (a.r.likeCount || 0)))
    .map((x) => x.r)
    .filter((r) => (seen.has(r.uid) ? false : seen.add(r.uid)))
    .slice(0, limit)
    .map((r) => ({
      source: 'sketchfab',
      uid: r.uid,
      name: r.name,
      author: r.user?.displayName || r.user?.username || 'Unknown',
      license: r.license?.label || r.license?.slug || '',
      likes: r.likeCount || 0,
      thumb: pickThumb(r.thumbnails?.images),
      url: r.viewerUrl || `https://sketchfab.com/3d-models/${r.uid}`
    }));
  fs.writeFileSync(file, JSON.stringify(list));
  await sleep(400);
  return list;
}

const NHTSA_FILE = path.join(ROOT, '.cache', 'nhtsa.json');
const nhtsaCache = new Map();
try { Object.entries(JSON.parse(fs.readFileSync(NHTSA_FILE, 'utf8'))).forEach(([k, v]) => nhtsaCache.set(k, v)); } catch { /* first run */ }

/** NHTSA vPIC: does the make exist, and does it list a model containing `hint`? (make lists are cached on disk) */
export async function nhtsaCheck(make, hint) {
  const key = make.toLowerCase();
  if (!nhtsaCache.has(key)) {
    let models = [];
    try {
      const j = await getJson(`https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMake/${encodeURIComponent(make)}?format=json`, 2);
      models = (j.Results || []).map((r) => norm(r.Model_Name || ''));
    } catch { /* network hiccup: treat as unknown */ }
    nhtsaCache.set(key, models);
    try { fs.mkdirSync(path.dirname(NHTSA_FILE), { recursive: true }); fs.writeFileSync(NHTSA_FILE, JSON.stringify(Object.fromEntries(nhtsaCache))); } catch { /* cache is optional */ }
    await sleep(250);
  }
  const models = nhtsaCache.get(key);
  const h = norm(hint);
  return { make: models.length > 0, model: models.some((m) => m.includes(h) || h.includes(m)) };
}