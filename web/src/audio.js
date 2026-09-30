// Sound, synthesized with WebAudio (no sound files):
//  sea      broadband wash of small waves all round, louder with the wind
//  hull     water slapping the planking: short low thumps timed to the ship's heave and roll against the waves
//  bow      the rush of water parted at the stem, rising with speed
//  wind     in the rigging: a band of noise that follows the apparent wind, whistling faintly in the gusts
//  sail     the cloth flogging when it luffs; a dull boom when it fills
//  timber   creaks of the hull and the mast partners when the ship rolls
//  gulls    now and then, from the direction of the land
//  harbour  a temple bell from the nearest town at evening
// Battle (all placed in the world: each arrives after distance / 343 m/s, quieter and duller with distance, panned):
//  guns     the great gun: a crack, then a long low roll, echoed off the islands; muskets: sharp dry cracks
//  shot     balls landing (a heavy splash), striking timber (a splintering crunch)
//  drum     the war drum (jin-daiko) beating the stroke for the oars, faster with the beat; the conch at the signal
//  fire     the crackle and roar of a burning ship when it is near
const C_SOUND = 343;
export class Sound {
  constructor() { this.ctx = null; }
  start() {
    if (this.ctx) return;
    const c = this.ctx = new AudioContext();
    const out = this.out = c.createGain(); out.gain.value = 0.9;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
    out.connect(comp).connect(c.destination);
    // brown-ish noise, 3 s loop
    const nb = c.createBuffer(2, c.sampleRate * 3, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = nb.getChannelData(ch); for (let i = 0, b = 0; i < d.length; i++) { b = 0.985 * b + 0.015 * (Math.random() * 2 - 1); d[i] = b * 4 + (Math.random() * 2 - 1) * 0.25; } }
    this.nb = nb;
    const noise = (rate = 1) => { const s = c.createBufferSource(); s.buffer = nb; s.loop = true; s.playbackRate.value = rate; s.start(); return s; };
    const chain = (src, type, f, q, g0) => { const f1 = c.createBiquadFilter(); f1.type = type; f1.frequency.value = f; f1.Q.value = q; const g = c.createGain(); g.gain.value = g0; src.connect(f1).connect(g).connect(out); return { f: f1, g }; };
    this.sea = chain(noise(1), 'bandpass', 600, 0.4, 0.05);
    this.sea2 = chain(noise(0.71), 'highpass', 2500, 0.5, 0.01);
    this.bow = chain(noise(1.3), 'bandpass', 1200, 0.7, 0);
    this.wind = chain(noise(0.9), 'bandpass', 400, 1.2, 0.02);
    this.whistle = chain(noise(1.1), 'bandpass', 1800, 18, 0);
    this.flog = chain(noise(0.6), 'lowpass', 300, 0.8, 0);
    // flogging is an amplitude-modulated rumble
    const lfo = c.createOscillator(); lfo.frequency.value = 5; const lg = c.createGain(); lg.gain.value = 0;
    lfo.connect(lg).connect(this.flog.g.gain); lfo.start(); this.flogLfo = lfo; this.flogDepth = lg;
    this.nextSlap = 0; this.nextCreak = 0; this.nextGull = 4; this.lastRoll = 0; this.nextBell = 30;
  }
  thump(gain, freq = 90, dur = 0.35, pan = 0) {
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.nb; s.playbackRate.value = 0.5 + Math.random() * 0.3;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq * 6;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    const p = c.createStereoPanner(); p.pan.value = pan;
    s.connect(f).connect(g).connect(p).connect(this.out); s.start(t, Math.random() * 2); s.stop(t + dur + 0.05);
  }
  creak(gain) {
    // a wooden creak: a rough, gliding tone (sawtooth through a narrow band)
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sawtooth';
    const f0 = 140 + Math.random() * 180;
    o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * (1.3 + Math.random() * 0.4), t + 0.4);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900 + Math.random() * 600; bp.Q.value = 6;
    const am = c.createGain(); am.gain.value = 0;
    const tr = c.createOscillator(); tr.frequency.value = 28 + Math.random() * 20; const tg = c.createGain(); tg.gain.value = gain;
    tr.connect(tg).connect(am.gain);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.08); g.gain.linearRampToValueAtTime(0, t + 0.5);
    const p = c.createStereoPanner(); p.pan.value = Math.random() * 1.2 - 0.6;
    o.connect(bp).connect(am).connect(g).connect(p).connect(this.out);
    o.start(t); tr.start(t); o.stop(t + 0.55); tr.stop(t + 0.55);
  }
  gull(pan) {
    const c = this.ctx, t = c.currentTime;
    for (let k = 0; k < 2 + Math.floor(Math.random() * 3); k++) {
      const t0 = t + k * (0.28 + Math.random() * 0.1);
      const o = c.createOscillator(); o.type = 'triangle';
      const f = 1500 + Math.random() * 300;
      o.frequency.setValueAtTime(f * 1.25, t0); o.frequency.exponentialRampToValueAtTime(f * 0.7, t0 + 0.22);
      const g = c.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.012, t0 + 0.03); g.gain.linearRampToValueAtTime(0, t0 + 0.24);
      const p = c.createStereoPanner(); p.pan.value = pan;
      o.connect(g).connect(p).connect(this.out); o.start(t0); o.stop(t0 + 0.26);
    }
  }
  bell() {
    // a large temple bell far away: inharmonic partials, long decay, heard through the haze (low-passed)
    const c = this.ctx, t = c.currentTime;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    lp.connect(this.out);
    for (const [f, a, d] of [[82, 0.05, 14], [165.5, 0.03, 10], [219, 0.02, 7], [296, 0.012, 5], [421, 0.006, 3]]) {
      const o = c.createOscillator(); o.frequency.value = f;
      const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(lp); o.start(t); o.stop(t + d);
    }
  }
  // distance (m) and pan (-1..1) from the listener; returns [start time, gain, low-pass cutoff]
  place(d) {
    const t = this.ctx.currentTime + d / C_SOUND;
    return [t, 1 / (1 + d / 80), 300 + 11000 * Math.exp(-d / 500)];
  }
  burst({ d, pan, dur, f, q = 0.7, type = 'bandpass', gain, rate = 1, attack = 0.004, delay = 0 }) {
    const c = this.ctx;
    const [t0, k, cut] = this.place(d);
    const t = t0 + delay;
    const s = c.createBufferSource(); s.buffer = this.nb; s.playbackRate.value = rate;
    const f1 = c.createBiquadFilter(); f1.type = type; f1.frequency.value = f; f1.Q.value = q;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cut;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain * k, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = c.createStereoPanner(); p.pan.value = pan;
    s.connect(f1).connect(lp).connect(g).connect(p).connect(this.out);
    s.start(t, Math.random() * 2); s.stop(t + dur + 0.05);
  }
  gun(d, pan, charge) {
    if (!this.ctx) return;
    if (charge > 0.5) {
      // the great gun: crack, body, and the long low roll; then the islands give it back
      this.burst({ d, pan, dur: 0.25, f: 2500, q: 0.5, gain: 0.9, attack: 0.002 });
      this.burst({ d, pan, dur: 1.4, f: 160, q: 0.6, type: 'lowpass', gain: 1.6, rate: 0.5 });
      this.burst({ d, pan, dur: 4.5, f: 70, q: 0.5, type: 'lowpass', gain: 0.7, rate: 0.3, attack: 0.08 });
      this.burst({ d: d + 900, pan: -pan * 0.5, dur: 3.0, f: 120, q: 0.5, type: 'lowpass', gain: 0.25, rate: 0.35, attack: 0.3 });
    } else if (charge > 0.2) {
      this.burst({ d, pan, dur: 0.2, f: 2000, q: 0.6, gain: 0.5 });
      this.burst({ d, pan, dur: 0.9, f: 260, q: 0.6, type: 'lowpass', gain: 0.8, rate: 0.6 });
    } else {
      // matchlock: a dry crack and a short thud
      this.burst({ d, pan, dur: 0.09, f: 3200, q: 0.8, gain: 0.35, attack: 0.001 });
      this.burst({ d, pan, dur: 0.35, f: 400, q: 0.6, type: 'lowpass', gain: 0.25, rate: 0.8 });
    }
  }
  splash(d, pan, big) {
    if (!this.ctx) return;
    this.burst({ d, pan, dur: big ? 1.6 : 0.5, f: 900, q: 0.4, gain: big ? 0.35 : 0.08, attack: 0.02 });
  }
  strike(d, pan) {
    if (!this.ctx) return;
    this.burst({ d, pan, dur: 0.18, f: 1400, q: 1.2, gain: 0.6, attack: 0.001 });
    this.burst({ d, pan, dur: 0.6, f: 300, q: 0.8, gain: 0.5, rate: 0.7, delay: 0.02 });
  }
  // war drum: a big membrane (a falling low tone and a slap of noise)
  drumHit(gain, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(52, t + 0.35);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + 1);
    const s = c.createBufferSource(); s.buffer = this.nb;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    const g2 = c.createGain(); g2.gain.setValueAtTime(gain * 0.5, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    s.connect(f).connect(g2).connect(this.out); s.start(t, Math.random()); s.stop(t + 0.15);
  }
  // conch (horagai): a breathy, slightly wavering horn note that swells and falls, two calls
  conch() {
    if (!this.ctx) return;
    const c = this.ctx;
    for (const [t0, f0, dur] of [[0, 233, 2.4], [2.8, 233, 3.2]]) {
      const t = c.currentTime + t0;
      const o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0 * 0.94, t); o.frequency.linearRampToValueAtTime(f0, t + 0.4); o.frequency.linearRampToValueAtTime(f0 * 0.97, t + dur);
      const vib = c.createOscillator(); vib.frequency.value = 5.2; const vg = c.createGain(); vg.gain.value = 2.5; vib.connect(vg).connect(o.frequency);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 1.4;
      const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.5); g.gain.setValueAtTime(0.09, t + dur - 0.6); g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(bp).connect(g).connect(this.out); o.start(t); vib.start(t); o.stop(t + dur + 0.1); vib.stop(t + dur + 0.1);
      this.burst({ d: 0, pan: 0, dur, f: 1500, q: 0.8, gain: 0.02, attack: 0.4, delay: t0 });
    }
  }
  update(dt, { speed, aw, gust, roll, rollRate, heave, flog, force, landDir, evening }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const w = Math.min(aw / 12, 1.2);
    this.sea.g.gain.setTargetAtTime(0.04 + w * 0.06, t, 0.5);
    this.sea2.g.gain.setTargetAtTime(0.004 + w * 0.012, t, 0.5);
    this.bow.g.gain.setTargetAtTime(Math.min(Math.max(speed, 0) / 5, 1) ** 1.5 * 0.12, t, 0.3);
    this.bow.f.frequency.setTargetAtTime(700 + speed * 220, t, 0.3);
    this.wind.g.gain.setTargetAtTime(0.01 + w * w * 0.05, t, 0.4);
    this.wind.f.frequency.setTargetAtTime(250 + aw * 35, t, 0.4);
    this.whistle.g.gain.setTargetAtTime(Math.max(0, aw - 7) * 0.004 * (0.5 + gust), t, 0.6);
    this.whistle.f.frequency.setTargetAtTime(1400 + aw * 60, t, 0.6);
    this.flog.g.gain.setTargetAtTime(flog * 0.08, t, 0.15);
    this.flogDepth.gain.setTargetAtTime(flog * 0.06, t, 0.15);
    this.flogLfo.frequency.setTargetAtTime(3 + aw * 0.5, t, 0.3);
    // slaps: when the hull drops onto the water or rolls into it
    if (t > this.nextSlap && (heave < -0.15 || Math.abs(rollRate) > 0.05)) {
      this.thump(Math.min(0.08 + Math.abs(heave) * 0.25 + Math.abs(rollRate) * 1.2, 0.35), 80 + Math.random() * 40, 0.3 + Math.random() * 0.3, Math.sign(rollRate) * 0.5);
      this.nextSlap = t + 0.6 + Math.random() * 1.2;
    }
    if (t > this.nextCreak && Math.abs(rollRate) > 0.02 + Math.random() * 0.03) {
      this.creak(0.5 + Math.min(Math.abs(rollRate) * 8, 1) * 0.5 + force * 1e-5);
      this.nextCreak = t + 1.5 + Math.random() * 3;
    }
    if (landDir !== null && t > this.nextGull) { this.gull(landDir); this.nextGull = t + 6 + Math.random() * 14; }
    if (evening && t > this.nextBell) { this.bell(); this.nextBell = t + 40 + Math.random() * 30; }
    this.lastRoll = roll;
  }
  // battle ambience each frame: the drum beating the stroke (beat 0..3, stroke phase), fire nearby (0..1)
  battle(dt, { beat, stroke, fire, on }) {
    if (!this.ctx) return;
    if (!this.fireN) {
      const c = this.ctx;
      const s = c.createBufferSource(); s.buffer = this.nb; s.loop = true; s.playbackRate.value = 1.6; s.start();
      const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1500;
      const g = c.createGain(); g.gain.value = 0; s.connect(f).connect(g).connect(this.out);
      this.fireN = g; this.nextPop = 0; this.lastStroke = stroke;
    }
    const t = this.ctx.currentTime;
    this.fireN.gain.setTargetAtTime(fire * 0.06, t, 0.5);
    if (fire > 0.05 && t > this.nextPop) { this.burst({ d: 20 / fire, pan: Math.random() - 0.5, dur: 0.05, f: 2500, q: 1, gain: 0.2 * fire, attack: 0.001 }); this.nextPop = t + Math.random() * 0.15 / fire; }
    // one drum stroke per oar stroke (on the catch), a double beat when rowing all out
    if (on && beat > 0) {
      const a = Math.floor(this.lastStroke / (Math.PI * 2)), b = Math.floor(stroke / (Math.PI * 2));
      if (b > a) { this.drumHit(0.25 + beat * 0.05); if (beat >= 3) this.drumHit(0.18, 0.22); }
    }
    this.lastStroke = stroke;
  }
}
