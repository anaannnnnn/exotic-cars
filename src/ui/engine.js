import { getSettings } from '../state/settings.js';

/*
 * The engine behind the lock orb: a synthesised flat-plane V8 (no audio files), revved by how far the hold has got.
 * Two detuned saws and a square sub-octave through a soft clipper and a low-pass that opens with the revs, plus a band
 * of breath for the rasp. Pressing cranks and catches, the revs climb with the hold, the last stretch bounces off the
 * limiter, and letting the orb open ends on a bark and a few crackles as it lifts off. Everything is routed through one
 * master gain so a cancelled hold simply falls with the revs, and a device with sound off (Settings) stays silent.
 */
const IDLE = 46, TOP = 440;               /* firing frequency at idle and at the limiter, in Hz */

export function createEngine() {
  const enabled = () => getSettings().sound !== false;
  let ac = null, master = null, saw1 = null, saw2 = null, sub = null, lp = null, noiseGain = null, bp = null, started = false, limiter = 0, lastP = 0, cutTimer = 0;

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ac = new AC();
    master = ac.createGain(); master.gain.value = 0;
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5;
    lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.4; lp.frequency.value = 320;
    const clip = ac.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) { const x = (i / 512) - 1; curve[i] = Math.tanh(2.6 * x); }
    clip.curve = curve; clip.oversample = '2x';
    const mix = ac.createGain(); mix.gain.value = 0.5;
    saw1 = ac.createOscillator(); saw1.type = 'sawtooth';
    saw2 = ac.createOscillator(); saw2.type = 'sawtooth'; saw2.detune.value = 9;
    sub = ac.createOscillator(); sub.type = 'square';
    const subGain = ac.createGain(); subGain.gain.value = 0.28;
    saw1.connect(mix); saw2.connect(mix); sub.connect(subGain); subGain.connect(mix);
    mix.connect(clip); clip.connect(lp); lp.connect(master);
    /* breath: looped noise through a band-pass that follows the revs */
    const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ac.createBufferSource(); noise.buffer = buf; noise.loop = true;
    bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9; bp.frequency.value = 700;
    noiseGain = ac.createGain(); noiseGain.gain.value = 0;
    noise.connect(bp); bp.connect(noiseGain); noiseGain.connect(master);
    master.connect(comp); comp.connect(ac.destination);
    [saw1, saw2, sub, noise].forEach((n) => n.start());
    saw1.frequency.value = saw2.frequency.value = IDLE; sub.frequency.value = IDLE / 2;
    return true;
  }

  const setFreq = (f, t = 0.05) => {
    const now = ac.currentTime;
    saw1.frequency.setTargetAtTime(f, now, t); saw2.frequency.setTargetAtTime(f, now, t); sub.frequency.setTargetAtTime(f / 2, now, t);
  };
  const setTone = (r) => {
    const now = ac.currentTime;
    lp.frequency.setTargetAtTime(280 + r * 3900, now, 0.06);
    bp.frequency.setTargetAtTime(600 + r * 2600, now, 0.06);
    noiseGain.gain.setTargetAtTime(0.012 + r * 0.075, now, 0.06);
  };
  const pop = (at, strength = 0.5) => {
    const now = ac.currentTime + at;
    const g = ac.createGain(); g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(strength, now + 0.004); g.gain.exponentialRampToValueAtTime(0.0005, now + 0.09);
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420 + Math.random() * 500; f.Q.value = 1.4;
    const src = ac.createBufferSource(); src.buffer = noiseGain.context.createBuffer(1, 4410, ac.sampleRate);
    const d = src.buffer.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    src.connect(f); f.connect(g); g.connect(master); src.start(now); src.stop(now + 0.12);
  };

  return {
    /* call from the first touch or key press on the page: browsers only let sound start from a gesture */
    prime() {
      if (!enabled()) return;
      try { if (!ac && !build()) return; ac.state === 'suspended' && ac.resume(); } catch { /* no audio on this device */ }
    },
    /* the orb is pressed: starter, then the engine catches */
    start() {
      if (!enabled()) return;
      try {
        if (!ac && !build()) return;
        if (ac.state === 'suspended') ac.resume();
        clearTimeout(cutTimer);
        const now = ac.currentTime;
        started = true; lastP = 0;
        setFreq(18, 0.02); setTone(0.02);
        master.gain.cancelScheduledValues(now); master.gain.setTargetAtTime(0.5, now, 0.03);
        setFreq(IDLE * 1.5, 0.12);                           /* the engine catches... */
        setTimeout(() => started && setFreq(IDLE * 1.15, 0.2), 260);   /* ...and settles */
        pop(0.02, 0.35);
      } catch { /* ignore */ }
    },
    /* the hold's progress, 0 to 1, every frame */
    update(p) {
      if (!ac || !started) return;
      lastP = p;
      const r = p <= 0 ? 0 : 0.04 + 0.96 * Math.pow(p, 0.82);
      if (p > 0.0005) {
        const rev = IDLE * 1.15 + (TOP - IDLE * 1.15) * r;
        if (p > 0.93 && !limiter) {                           /* the limiter: the revs stutter at the top */
          let on = false;
          limiter = setInterval(() => { if (!ac) return; on = !on; setFreq(TOP * (on ? 1 : 0.88), 0.012); master.gain.setTargetAtTime(on ? 0.72 : 0.35, ac.currentTime, 0.01); }, 62);
        } else if (p <= 0.93 && limiter) { clearInterval(limiter); limiter = 0; }
        if (!limiter) { setFreq(rev, 0.045); master.gain.setTargetAtTime(0.5 + r * 0.32, ac.currentTime, 0.04); }
        setTone(r);
      } else {
        this.stop();
      }
    },
    /* let go early: the revs fall with the ring and the sound fades under them */
    stop() {
      if (!ac || !started) return;
      started = false;
      if (limiter) { clearInterval(limiter); limiter = 0; }
      const now = ac.currentTime;
      setFreq(IDLE * 0.9, 0.12); setTone(0);
      master.gain.cancelScheduledValues(now); master.gain.setTargetAtTime(0, now, 0.11);
      if (lastP > 0.35) { pop(0.1, 0.25); pop(0.22, 0.18); }
      clearTimeout(cutTimer);
    },
    /* the orb opens: one last bark, then the engine lifts and crackles away */
    finish() {
      if (!ac || !started) return;
      started = false;
      if (limiter) { clearInterval(limiter); limiter = 0; }
      const now = ac.currentTime;
      setFreq(TOP * 1.04, 0.01); setTone(1);
      master.gain.cancelScheduledValues(now); master.gain.setTargetAtTime(0.95, now, 0.01);
      setTimeout(() => { if (!ac) return; setFreq(IDLE * 1.4, 0.16); setTone(0.15); }, 160);
      [0.34, 0.45, 0.52, 0.66, 0.74].forEach((t, i) => pop(t, 0.55 - i * 0.07));
      master.gain.setTargetAtTime(0, now + 0.55, 0.22);
    }
  };
}
