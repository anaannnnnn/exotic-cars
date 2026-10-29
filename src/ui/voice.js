import { getSettings } from '../state/settings.js';
import { aiStatus, aiSpeech } from '../data/api.js';

/*
 * Voice for the concierge, all in the browser: speech synthesis for "voice bites" (a short spoken version of an answer),
 * and speech recognition for talking to it. Nothing is recorded or sent anywhere by this file; where a browser routes
 * recognition through its own speech service, that is the browser's doing.
 */
const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
export const voiceSupport = () => ({ speak: typeof window !== 'undefined' && 'speechSynthesis' in window, listen: Boolean(SR), record: typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined' });

let voice = null;
function pickVoice() {
  const list = speechSynthesis.getVoices();
  if (!list.length) return null;
  const score = (v) => {
    let s = 0;
    if (/^en[-_](GB|AE|AU|IE)/i.test(v.lang)) s += 4; else if (/^en/i.test(v.lang)) s += 2; else return -1;
    if (/natural|neural|premium|enhanced|google uk|daniel|oliver|serena|kate|jamie|arthur|samantha/i.test(v.name)) s += 3;
    if (v.localService === false) s += 1;
    return s;
  };
  return [...list].sort((a, b) => score(b) - score(a))[0] || null;
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  speechSynthesis.addEventListener?.('voiceschanged', () => { voice = pickVoice(); });
  voice = pickVoice();
}

let current = null;
/* one audio element for every spoken answer: it is unlocked by the first touch, so a phone lets later answers play on their own */
const player = typeof Audio !== 'undefined' ? new Audio() : null;
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=';
if (player && typeof window !== 'undefined') {
  const unlock = () => { try { player.src = SILENT; player.play().catch(() => {}); } catch { /* ignore */ } };
  ['pointerdown', 'touchend', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock, { once: true, capture: true }));
}
/** Speak `text`. A natural AI voice when the server has one, the browser's own voice otherwise. Returns { stop }. */
export function speak(text, { onstart, onend, rate = 1 } = {}) {
  stopSpeaking();
  let done = false, cancelled = false;
  const end = () => { if (done) return; done = true; if (current === handle) current = null; onend?.(); };
  const browser = () => {
    if (cancelled) return;
    if (!voiceSupport().speak) { end(); return; }
    const u = new SpeechSynthesisUtterance(text);
    voice ||= pickVoice();
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-GB';
    u.rate = rate; u.pitch = 1;
    u.onstart = () => onstart?.(); u.onend = end; u.onerror = end;
    speechSynthesis.speak(u);
  };
  const handle = { stop() { cancelled = true; try { player?.pause(); } catch { /* ignore */ } try { speechSynthesis.cancel(); } catch { /* ignore */ } end(); } };
  current = handle;
  aiStatus().then(async (st) => {
    if (cancelled) return;
    if (!st.voice || !player) { browser(); return; }
    try {
      const blob = await aiSpeech(text);
      if (cancelled) return;
      const url = URL.createObjectURL(blob);
      player.onended = () => { URL.revokeObjectURL(url); end(); };
      player.onerror = () => { URL.revokeObjectURL(url); if (!cancelled && !done) browser(); };
      player.onplay = () => onstart?.();
      player.src = url;
      await player.play();
    } catch { if (!cancelled && !done) browser(); }
  });
  return handle;
}
export function stopSpeaking() { current?.stop(); current = null; try { speechSynthesis.cancel(); } catch { /* ignore */ } }

/** One short spoken sentence or two from a concierge answer: the voice bite. */
export function biteFrom(res) {
  if (res?.ai) return String(res.text || '');
  const t = String(res?.text || '').replace(/\s+/g, ' ').replace(/[“”]/g, '"').trim();
  const sents = t.match(/[^.!?]+[.!?]+/g) || [t];
  let out = sents[0].trim();
  if (out.length < 70 && sents[1]) out += ` ${sents[1].trim()}`;
  if (out.length > 200) out = `${out.slice(0, 197).replace(/\s+\S*$/, '')}…`;
  const c = res?.cars?.[0];
  if (c && res.cars.length) out += ` Top pick: ${c.title}${c.year ? `, ${c.year}` : ''}.`;
  return out;
}

/** Listen once. Returns { stop, abort }. onInterim(text) while speaking, onFinal(text) at the end of the phrase. */
export function listen({ onInterim, onFinal, onEnd, onError, lang = 'en-GB' } = {}) {
  if (!SR) { onError?.({ error: 'unsupported' }); onEnd?.(); return { stop() {}, abort() {} }; }
  const rec = new SR();
  rec.lang = lang; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
  let finalText = '', ended = false;
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
    }
    if (interim) onInterim?.(interim.trim());
  };
  rec.onerror = (e) => onError?.(e);
  rec.onend = () => { if (ended) return; ended = true; if (finalText.trim()) onFinal?.(finalText.trim()); onEnd?.(); };
  try { rec.start(); } catch (e) { onError?.(e); onEnd?.(); }
  return { stop() { try { rec.stop(); } catch { /* ignore */ } }, abort() { ended = true; try { rec.abort(); } catch { /* ignore */ } } };
}

/** A two-note chime for "connected" / "call ended" (WebAudio, no files). */
export function chime(kind = 'on') {
  if (getSettings().sound === false) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    const notes = kind === 'on' ? [660, 880] : [660, 440];
    notes.forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t = ac.currentTime + i * 0.14;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.32);
      o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.34);
    });
    setTimeout(() => ac.close?.(), 900);
  } catch { /* no audio */ }
}


/* ---------- recording for the AI: capture until the speaker stops, return a small 16 kHz mono WAV ---------- */
function wavFrom(float32, rate) {
  const buf = new ArrayBuffer(44 + float32.length * 2), v = new DataView(buf);
  const w = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + float32.length * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, float32.length * 2, true);
  for (let i = 0; i < float32.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, float32[i])) * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}
async function toWav(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  try {
    const decoded = await ac.decodeAudioData(await blob.arrayBuffer());
    const rate = 16000, len = Math.ceil(decoded.duration * rate);
    const off = new OfflineAudioContext(1, len, rate);
    const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
    return wavFrom((await off.startRendering()).getChannelData(0), rate);
  } finally { ac.close?.(); }
}

/**
 * Listen through the microphone until the person stops talking (or `maxMs`). Resolves a WAV blob, or null when nothing
 * was said. `onLevel(0..1)` drives a meter, `onSpeech()` fires when speech starts. Returns { done, stop, abort }.
 */
export function recordSpeech({ onLevel, onSpeech, maxMs = 14000, silenceMs = 1300, waitMs = 8000 } = {}) {
  let rec = null, stream = null, ac = null, timer = 0, aborted = false;
  const parts = [];
  const cleanup = () => { clearInterval(timer); try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ } try { ac?.close(); } catch { /* ignore */ } };
  let stopFn = () => {};
  const done = (async () => {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (aborted) { cleanup(); return null; }
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported?.(t));
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    rec.ondataavailable = (e) => { if (e.data?.size) parts.push(e.data); };
    const AC = window.AudioContext || window.webkitAudioContext;
    ac = new AC();
    const an = ac.createAnalyser(); an.fftSize = 1024;
    ac.createMediaStreamSource(stream).connect(an);
    const data = new Float32Array(an.fftSize);
    const t0 = Date.now();
    let floor = 0.012, spoke = false, spokeAt = 0, lastVoice = 0, ticks = 0;
    return new Promise((resolve) => {
      let finished = false;
      const finish = (keep) => { if (finished) return; finished = true; clearInterval(timer); rec.onstop = async () => { cleanup(); if (!keep || aborted || !spoke) return resolve(null); try { resolve(await toWav(new Blob(parts, { type: rec.mimeType || 'audio/webm' }))); } catch { resolve(null); } }; try { rec.stop(); } catch { cleanup(); resolve(null); } };
      stopFn = (keep = true) => finish(keep);
      rec.start(250);
      timer = setInterval(() => {
        an.getFloatTimeDomainData(data);
        let sum = 0; for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        if (++ticks <= 6) floor = Math.max(floor, Math.min(0.05, rms * 1.6));   /* the room's own noise, measured first */
        onLevel?.(Math.min(1, rms * 9));
        const now = Date.now();
        if (rms > Math.max(0.02, floor * 1.9)) { if (!spoke) { spoke = true; spokeAt = now; onSpeech?.(); } lastVoice = now; }
        if (spoke && now - lastVoice > silenceMs && now - spokeAt > 450) finish(true);
        else if (!spoke && now - t0 > waitMs) finish(false);
        else if (now - t0 > maxMs) finish(true);
      }, 50);
    });
  })();
  return { done, stop: () => stopFn(true), abort: () => { aborted = true; stopFn(false); cleanup(); } };
}
