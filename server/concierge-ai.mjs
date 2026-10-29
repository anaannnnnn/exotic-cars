import { HttpError } from './http.mjs';
import { readDoc } from './store.mjs';

/*
 * The concierge's brain and voice on a real AI model (Google Gemini): it understands plain speech or text in any
 * language, answers from the live stock only (the cars it may mention are passed in, and every id it returns is
 * checked against them), and its reply can be spoken in a natural voice. Needs GEMINI_API_KEY; without it the app
 * keeps its on-device concierge and the browser's own voice. Nothing here stores audio or conversations.
 */
const BASE = () => process.env.GEMINI_BASE || 'https://generativelanguage.googleapis.com/v1beta';
const key = () => process.env.GEMINI_API_KEY || '';
/* the first model that answers is used; the rest are fallbacks (a model can be busy or retired). Override with GEMINI_MODEL / GEMINI_TTS_MODEL (comma lists). */
const list = (env, dflt) => String(process.env[env] || dflt).split(',').map((x) => x.trim()).filter(Boolean);
const MODELS = () => list('GEMINI_MODEL', 'gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.8-flash');
const TTS_MODELS = () => list('GEMINI_TTS_MODEL', 'gemini-3.8-flash-tts,gemini-2.5-flash-preview-tts');
const VOICE = () => process.env.GEMINI_VOICE || 'Kore';
export const aiEnabled = () => Boolean(key());

class Retry extends Error {}
async function once(model, body, ms, outer) {
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  outer?.addEventListener('abort', stop);
  const t = setTimeout(stop, ms);
  try {
    const res = await fetch(`${BASE()}/models/${model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key() }, body: JSON.stringify(body), signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    if ([400, 404, 429, 500, 502, 503, 504].includes(res.status)) throw Object.assign(new Retry(data?.error?.message || String(res.status)), { status: res.status });
    throw new HttpError(502, 'AI unavailable', 'The AI service refused the request.');
  } catch (e) {
    if (e instanceof HttpError || e instanceof Retry) throw e;
    throw new Retry(outer?.aborted ? 'cancelled' : 'timeout');
  } finally { clearTimeout(t); outer?.removeEventListener('abort', stop); }
}
async function attempt(model, body, ms, outer) {
  try { return await once(model, body, ms, outer); } catch (e) {
    /* a model that does not know the thinking switch is asked again without it */
    if (e instanceof Retry && e.status === 400 && body.generationConfig?.thinkingConfig) { const { thinkingConfig, ...g } = body.generationConfig; return once(model, { ...body, generationConfig: g }, ms, outer); }
    throw e;
  }
}
/**
 * Ask the models in order, but do not wait for a slow one: if the first has not answered after `stagger` ms (or has
 * failed), the next is asked as well, and the first good answer wins. Google's models are sometimes busy; this keeps a
 * spoken conversation moving.
 */
function call(models, body, { ms = 14000, stagger = 4500 } = {}) {
  return new Promise((resolve, reject) => {
    const outer = new AbortController();
    let next = 0, failed = 0, settled = false, timer = 0;
    const launch = () => {
      clearTimeout(timer);
      if (settled || next >= models.length) return;
      const m = models[next++];
      if (next < models.length) timer = setTimeout(launch, stagger);
      attempt(m, body, ms, outer.signal).then((d) => { if (settled) return; settled = true; clearTimeout(timer); outer.abort(); resolve(d); }, (e) => {
        if (settled) return;
        if (!(e instanceof Retry)) { settled = true; clearTimeout(timer); outer.abort(); reject(e); return; }
        console.error(`[ai] ${m}: ${e.status || ''} ${String(e.message).slice(0, 100)}`);
        failed += 1;
        if (failed >= models.length) { settled = true; reject(new HttpError(502, 'AI unavailable', 'The AI service did not answer. Please try again in a moment.')); } else launch();
      });
    };
    launch();
  });
}

/* customers say the makes in Arabic too: map those to the names in the stock */
const ALIAS = [['لامبورغيني|لامبورجيني|لمبرجيني', 'lamborghini'], ['فيراري|فراري', 'ferrari'], ['رولز رويس|رولزرويس|رولز', 'rolls royce'], ['مرسيدس|مرسديس', 'mercedes'], ['بنتلي', 'bentley'], ['بورش|بورشه', 'porsche'], ['استون مارتن|أستون مارتن|أستن مارتن', 'aston martin'], ['لاند روفر|رنج روفر', 'land rover'], ['ماكلارين|مكلارين', 'mclaren'], ['بي ام دبليو|بي إم دبليو', 'bmw'], ['اودي|أودي', 'audi'], ['مازيراتي|مازراتي', 'maserati'], ['بوغاتي|بوجاتي', 'bugatti'], ['كاديلاك', 'cadillac']];
const withAliases = (q) => ALIAS.reduce((t, [rx, name]) => (new RegExp(rx).test(t) ? `${t} ${name}` : t), String(q || ''));
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ');

/** The cars the model may talk about this turn: the best matches for what was just said, topped up with the freshest stock. */
async function candidates(query) {
  const cars = ((await readDoc('catalog', 'cars'))?.data?.cars || []).filter((c) => !c.hidden);
  const sale = cars.filter((c) => !c.sold);
  const toks = [...new Set(norm(withAliases(query)).split(/\s+/).filter((w) => w.length > 2 || /^\d+$/.test(w)))];
  const scored = cars.map((c) => {
    const hay = norm(`${c.title} ${c.brand} ${c.model} ${c.year} ${c.exterior} ${c.body} ${c.transmission} ${c.engine}`);
    let s = 0;
    for (const w of toks) if (hay.includes(w)) s += /^\d{4}$/.test(w) ? 3 : w.length > 4 ? 2 : 1;
    return { c, s: s + (c.sold ? -0.5 : 0) };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 36).map((x) => x.c);
  const fresh = sale.filter((c) => c.newArrival || c.featured).slice(0, 14);
  /* one car of every make, so the model always knows what the showroom carries */
  const perMake = [...new Map(sale.map((c) => [c.brand, c])).values()];
  const list = [...new Map([...scored, ...fresh, ...perMake].map((c) => [String(c.id), c])).values()].slice(0, 56);
  const brands = {};
  sale.forEach((c) => { brands[c.brand] = (brands[c.brand] || 0) + 1; });
  const years = sale.map((c) => c.year).filter(Boolean);
  return {
    list, summary: { makesInStock: Object.entries(brands).sort((a, b) => b[1] - a[1]).map(([b]) => b), bodies: [...new Set(sale.map((c) => c.body).filter(Boolean))], yearsFrom: Math.min(...years), yearsTo: Math.max(...years) },
    compact: list.map((c) => ({ id: c.id, car: c.title, year: c.year, km: c.km, colour: c.exterior, body: c.body, hp: c.hp, forSale: !c.sold, new: !!c.newArrival, threeD: false }))
  };
}

const SYSTEM = `You are the concierge of Exotic Cars Dubai, a luxury and exotic car showroom. You speak with customers by text or voice.
Rules:
- ALWAYS answer in the language of the customer's last message: Arabic in, Arabic out (including suggestions and action labels); English in, English out. Be warm, brief and precise. For voice, reply in one to three short sentences.
- Whenever you mention specific cars, put the ids of those cars (up to 6) in carIds so the app can show them. Mention only years, colours and specs that appear in CARS.
- Talk only about the cars in CARS. Never invent a car, spec, colour or availability. A car with forSale false is sold: say so.
- Prices are never quoted: say prices are shared on request, and offer to book a call or a viewing.
- If the customer asks for something that is not in CARS but could exist in stock (a make, colour or year), say you do not have it right now and that the team can source one, and set noMatch true with what they asked for in search.
- Help with test drives, viewings, service, the 3D builder (they can build any car in 3D on its page) and the VR showroom.
- Ask at most one short question when you really need it. Do not repeat the customer's words back.
- Output JSON only.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    heard: { type: 'STRING', description: 'What the customer said, transcribed (voice only)' },
    text: { type: 'STRING' },
    carIds: { type: 'ARRAY', items: { type: 'INTEGER' } },
    actions: { type: 'ARRAY', items: { type: 'OBJECT', properties: { kind: { type: 'STRING', enum: ['service', 'vr'] }, label: { type: 'STRING' }, service: { type: 'STRING' } }, required: ['kind', 'label'] } },
    suggestions: { type: 'ARRAY', items: { type: 'STRING' } },
    noMatch: { type: 'BOOLEAN' },
    search: { type: 'OBJECT', properties: { brand: { type: 'STRING' }, body: { type: 'STRING' }, colour: { type: 'STRING' }, yearFrom: { type: 'INTEGER' }, yearTo: { type: 'INTEGER' } } }
  },
  required: ['text']
};

/** One turn. `input` is { text } or { audio: { mime, data(base64) } }. history: [{ from: 'you'|'ai', text }]. */
export async function ask({ text, audio, history = [], focus = null }) {
  if (!aiEnabled()) throw new HttpError(503, 'AI not set up', 'The AI concierge is not switched on for this site.');
  const recent = history.slice(-8);
  const ctx = await candidates([text, ...recent.map((m) => m.text)].filter(Boolean).join(' '));
  if (focus != null) { const f = ((await readDoc('catalog', 'cars'))?.data?.cars || []).find((c) => String(c.id) === String(focus)); if (f && !ctx.list.some((c) => c.id === f.id)) { ctx.list.unshift(f); ctx.compact.unshift({ id: f.id, car: f.title, year: f.year, km: f.km, colour: f.exterior, body: f.body, hp: f.hp, forSale: !f.sold }); } }
  const turns = recent.map((m) => ({ role: m.from === 'you' ? 'user' : 'model', parts: [{ text: String(m.text).slice(0, 600) }] }));
  const user = audio ? { role: 'user', parts: [{ inlineData: { mimeType: audio.mime, data: audio.data } }, { text: 'Transcribe what the customer just said into "heard", then answer it.' }] } : { role: 'user', parts: [{ text: String(text).slice(0, 800) }] };
  const data = await call(MODELS(), {
    systemInstruction: { parts: [{ text: `${SYSTEM}\n\nSHOWROOM: ${JSON.stringify(ctx.summary)}\nFOCUS CAR ID (the car they are looking at, if any): ${focus ?? 'none'}\nCARS: ${JSON.stringify(ctx.compact)}` }] },
    contents: [...turns, user],
    generationConfig: { temperature: 0.5, maxOutputTokens: 700, responseMimeType: 'application/json', responseSchema: SCHEMA, thinkingConfig: { thinkingBudget: 0 } }
  });
  let out;
  try { out = JSON.parse(data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''); } catch { throw new HttpError(502, 'AI unavailable', 'The AI service gave an answer that could not be read.'); }
  if (!out?.text) throw new HttpError(502, 'AI unavailable', 'The AI service gave an empty answer.');
  const allowed = new Set(ctx.list.map((c) => String(c.id)));
  return {
    heard: audio ? String(out.heard || '').slice(0, 300) : undefined,
    text: String(out.text).slice(0, 700),
    carIds: (out.carIds || []).filter((id) => allowed.has(String(id))).slice(0, 6),
    actions: (out.actions || []).filter((a) => ['service', 'vr'].includes(a.kind)).slice(0, 3).map((a) => ({ kind: a.kind, label: String(a.label).slice(0, 40), service: a.service ? String(a.service).slice(0, 60) : undefined })),
    suggestions: (out.suggestions || []).slice(0, 3).map((s) => String(s).slice(0, 50)),
    noMatch: Boolean(out.noMatch), search: out.search || null
  };
}

/** Text to speech: a natural voice. Returns a WAV (24 kHz, mono). */
export async function speak(text) {
  if (!aiEnabled()) throw new HttpError(503, 'AI not set up', 'The AI voice is not switched on for this site.');
  const data = await call(TTS_MODELS(), {
    contents: [{ parts: [{ text: String(text).slice(0, 500) }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE() } } } }
  });
  const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) throw new HttpError(502, 'AI unavailable', 'The AI voice gave no audio.');
  const raw = Buffer.from(part.inlineData.data, 'base64');
  if (/wav|wave/i.test(part.inlineData.mimeType || '') || raw.subarray(0, 4).toString() === 'RIFF') return raw;   /* already a WAV */
  const pcm = raw;
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1]) || 24000;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
