import * as stock from '../data/stock.js';
import { h, icon } from './dom.js';
import { ask, askAudio } from '../ai/concierge.js';
import { speak, stopSpeaking, listen, recordSpeech, biteFrom, chime, voiceSupport } from './voice.js';
import { aiStatus } from '../data/api.js';

/*
 * A hands-free voice call with the concierge: it listens, thinks, speaks a voice bite, and listens again until the call
 * is ended. Falls back to typing when the browser cannot recognise speech.
 */
export function openVoiceCall({ onClose } = {}) {
  const sup = voiceSupport();   /* { speak, listen, record } */
  let alive = true, state = 'connecting', ear = null, muted = false, silent = 0, aiVoice = false;
  const memory = { filters: null, focus: null, log: [] };

  const status = h('p', { class: 'vc__status', 'aria-live': 'polite', text: 'Connecting…' });
  const heard = h('p', { class: 'vc__heard' });
  const said = h('p', { class: 'vc__said' });
  const cars = h('div', { class: 'vc__cars' });
  const orb = h('div', { class: 'vc__orb', 'aria-hidden': 'true' }, [h('i'), h('i'), h('i'), h('span', {}, icon('spark'))]);
  const typed = h('input', { class: 'ask__input', type: 'text', placeholder: sup.listen ? 'Or type here…' : 'Type your question…', 'aria-label': 'Type to the concierge', autocomplete: 'off' });
  const typeForm = h('form', { class: 'ask vc__type', onsubmit: (e) => { e.preventDefault(); const v = typed.value.trim(); typed.value = ''; if (v) turn(v); } }, [typed, h('button', { class: 'ask__go', type: 'submit', 'aria-label': 'Send' }, icon('send'))]);
  const muteBtn = h('button', { class: 'vc__btn', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Mute your microphone', onclick: () => {
    muted = !muted; muteBtn.setAttribute('aria-pressed', String(muted)); muteBtn.classList.toggle('is-on', muted);
    if (muted) { ear?.abort(); ear = null; set('muted', 'Microphone off. Type to continue.'); } else if (state === 'muted') hear();
  } }, icon('micoff'));
  const endBtn = h('button', { class: 'vc__end', type: 'button', 'aria-label': 'End the call', onclick: () => close() }, [icon('hangup'), h('span', { text: 'End call' })]);
  const clock = h('time', { class: 'vc__time', text: '0:00' });
  const t0 = Date.now();
  const tick = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 1000);

  const el = h('div', { class: 'vc', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Voice call with the concierge' }, [
    h('div', { class: 'vc__top' }, [h('span', { class: 'vc__who' }, [h('b', { text: 'Concierge' }), h('small', { text: 'Exotic Cars · Dubai' })]), clock]),
    h('div', { class: 'vc__mid' }, [orb, status, heard, said, cars]),
    h('div', { class: 'vc__bar' }, [sup.listen ? muteBtn : null, endBtn]),
    typeForm
  ]);
  document.body.append(el);
  document.body.classList.add('is-locked');
  requestAnimationFrame(() => el.classList.add('is-in'));
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  function set(s, text) { state = s; el.dataset.state = s; status.textContent = text; }

  /* with the AI voice on, the microphone is recorded until the caller pauses and the AI hears the audio itself */
  async function hearAi() {
    set('listening', 'Listening…'); heard.textContent = '';
    ear = recordSpeech({ onLevel: (l) => orb.style.setProperty('--lvl', l.toFixed(2)), onSpeech: () => { heard.textContent = '…'; } });
    let wav = null;
    try { wav = await ear.done; } catch (e) { ear = null; muted = true; set('muted', 'Microphone blocked. Allow it in your browser, or type below.'); return; }
    ear = null;
    if (!alive || muted) return;
    if (!wav) { silent += 1; if (silent >= 3) { set('idle', 'Still there? Tap the orb to talk, or type below.'); } else hear(); return; }
    silent = 0;
    set('thinking', 'Thinking…');
    let res;
    try { res = await askAudio(wav, memory); } catch { if (alive) { set('idle', 'I could not hear that. Tap the orb to try again, or type below.'); } return; }
    if (!alive) return;
    heard.textContent = res.heard ? `“${res.heard}”` : '';
    memory.log.push({ from: 'you', text: res.heard || '(spoken)' });
    deliver(res);
  }

  function hear() {
    if (!alive || muted) return;
    if (aiVoice) { hearAi(); return; }
    if (!sup.listen) { set('idle', 'Type your question below.'); return; }
    set('listening', 'Listening…');
    heard.textContent = '';
    ear = listen({
      onInterim: (t) => { heard.textContent = `“${t}”`; },
      onFinal: (t) => { silent = 0; turn(t); },
      onError: (e) => {
        if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') { muted = true; set('muted', 'Microphone blocked. Allow it in your browser, or type below.'); }
      },
      onEnd: () => { if (alive && state === 'listening') { silent += 1; if (silent >= 4) { set('idle', 'Still there? Tap the orb to talk, or type below.'); } else hear(); } }
    });
  }
  orb.addEventListener('click', () => { if (state === 'idle' || state === 'muted') { muted = false; muteBtn.setAttribute('aria-pressed', 'false'); muteBtn.classList.remove('is-on'); silent = 0; hear(); } });

  async function turn(text) {
    if (!alive) return;
    ear?.abort(); ear = null;
    heard.textContent = `“${text}”`; said.textContent = '';
    set('thinking', 'Thinking…');
    memory.log.push({ from: 'you', text });
    const res = await ask(text, { filters: memory.filters, focus: memory.focus, history: memory.log });
    if (!alive) return;
    deliver(res);
  }

  function deliver(res) {
    if (res.filters) memory.filters = res.filters;
    if (res.cars?.length === 1) memory.focus = res.cars[0].id;
    memory.log.push({ from: 'ai', text: res.text });
    const line = biteFrom(res);
    said.textContent = line;
    cars.replaceChildren(...(res.cars || []).slice(0, 4).map((c) => h('a', { class: 'vc__car', href: `#/shop/${c.id}`, onclick: () => close() }, [h('img', { src: stock.coverUrl(c), alt: '', onerror: stock.coverError(c) }), h('span', { text: c.title })])));
    set('speaking', 'Speaking…');
    speak(line, { onend: () => { if (alive) hear(); } });
  }

  function close() {
    if (!alive) return;
    alive = false;
    clearInterval(tick); ear?.abort(); stopSpeaking(); chime('off');
    document.removeEventListener('keydown', onKey);
    el.classList.remove('is-in');
    setTimeout(() => { el.remove(); document.body.classList.remove('is-locked'); onClose?.(); }, 260);
  }

  chime('on');
  aiStatus().then((st) => { aiVoice = Boolean(st.voice) && sup.record; });
  setTimeout(() => {
    if (!alive) return;
    const hello = 'Hello, Exotic Cars Dubai. What are you looking for today?';
    said.textContent = hello;
    set('speaking', 'Speaking…');
    speak(hello, { onend: () => { if (alive) hear(); } });
  }, 700);
  return { close };
}
