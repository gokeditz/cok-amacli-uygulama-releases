// Web Audio ile anlık sentezlenen house parçası. Hiçbir ses dosyası yok,
// her vuruş, bas ve akor burada osilatör ve gürültüden üretiliyor.
import { house } from './tracks.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const MASTER = 0.85;

export class Music {
  constructor() {
    this.track = house;
    this.bpm = house.bpm;
    this.playing = false;
    this.zLast = [0, 0];
    this.ctx = null;
    this.step = 0;
    this.startTime = 0;
    this.timer = null;
    this.spectrum = new Uint8Array(128);
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain();
    this.master.gain.value = MASTER;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 6;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.72;
    this.master.connect(comp);
    comp.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    this.recDest = ctx.createMediaStreamDestination ? ctx.createMediaStreamDestination() : null;
    if (this.recDest) this.analyser.connect(this.recDest);
    this.songGain = ctx.createGain();
    this.songGain.gain.value = 0.9;
    this.songGain.connect(this.analyser);
    this.spectrum = new Uint8Array(this.analyser.frequencyBinCount);

    // Kick vurdukça bas ve akorları bastıran sidechain
    this.duck = ctx.createGain();
    this.duck.connect(this.master);

    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(2.4, 3);
    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = 0.35;
    this.verbSend.connect(this.verb);
    this.verb.connect(this.master);

    this.delay = ctx.createDelay(1.5);
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2800;
    this.delay.connect(dl);
    dl.connect(fb);
    fb.connect(this.delay);
    dl.connect(this.master);
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0.3;
    this.delaySend.connect(this.delay);
    this.updateDelay();

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  impulse(sec, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  updateDelay() {
    if (this.delay) this.delay.delayTime.value = (60 / this.bpm) * 0.75; // noktalı sekizlik
  }

  get stepDur() { return 60 / this.bpm / 4; }
  get latency() {
    const c = this.ctx;
    return c ? c.outputLatency || c.baseLatency || 0 : 0;
  }
  // Kulağa ulaşan sese göre şu anki vuruş
  get beat() { return ((this.ctx.currentTime - this.latency - this.startTime) * this.bpm) / 60; }

  setTrack(track) {
    if (this.playing) this.pause(true);
    this.track = track;
    this.bpm = track.bpm;
    this.zLast = [0, 0];
    this.updateDelay();
  }

  async play(fromBeat = 0) {
    this.init();
    await this.ctx.resume();
    const t = this.ctx.currentTime;
    const t0 = t + 0.05;
    const beatSec = 60 / this.bpm;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(MASTER, t);
    const tr = this.track;
    if (tr.buffer) {
      this.stopSource();
      const src = this.ctx.createBufferSource();
      src.buffer = tr.buffer;
      src.loop = true;
      const loopLen = tr.totalBars * 4 * beatSec;
      src.loopStart = tr.firstBeat;
      src.loopEnd = Math.min(tr.buffer.duration, tr.firstBeat + loopLen);
      src.connect(this.songGain);
      if (fromBeat <= 0) {
        src.start(t0, 0);
        this.startTime = t0 + tr.firstBeat;
      } else {
        src.start(t0, tr.firstBeat + ((fromBeat * beatSec) % loopLen));
        this.startTime = t0 - fromBeat * beatSec;
      }
      this.src = src;
    } else {
      this.startTime = t0 - fromBeat * beatSec;
      this.step = Math.max(0, Math.ceil(fromBeat * 4));
      this.tick();
      clearInterval(this.timer);
      this.timer = setInterval(() => this.tick(), 25);
    }
    this.playing = true;
  }

  stopSource() {
    if (this.src) {
      try { this.src.stop(); } catch { /* zaten durmuş */ }
      this.src.disconnect();
      this.src = null;
    }
  }

  pause(hard = false) {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.timer = null;
    const t = this.ctx.currentTime;
    const g = this.master.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + 0.06);
    const src = this.src;
    this.src = null;
    setTimeout(() => {
      if (src) { try { src.stop(); } catch { /* yok say */ } src.disconnect(); }
      if (!this.playing && !hard) this.ctx.suspend();
    }, 90);
  }

  setBpm(bpm) {
    if (!this.track.tempo) return;
    if (this.playing) {
      const cur = this.beat;
      this.bpm = bpm;
      this.startTime = this.ctx.currentTime - this.latency - (cur * 60) / bpm;
    } else {
      this.bpm = bpm;
    }
    this.updateDelay();
  }

  readSpectrum() {
    if (this.playing) this.analyser.getByteFrequencyData(this.spectrum);
    return this.spectrum;
  }

  tick() {
    const ctx = this.ctx;
    const ahead = ctx.currentTime + 0.12;
    for (;;) {
      const t = this.startTime + this.step * this.stepDur;
      if (t > ahead) break;
      if (t >= ctx.currentTime - 0.02) this.track.schedule(this, this.step, Math.max(t, ctx.currentTime));
      this.step++;
    }
  }

  // ---- enstrümanlar ----
  noiseHit(t, dur, type, freq, vol, dests, q = 0.7) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g);
    for (const d of dests) g.connect(d);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  kick(t) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.45);
    this.noiseHit(t, 0.012, 'highpass', 3000, 0.25, [this.master]);
    const d = this.duck.gain;
    d.cancelScheduledValues(t);
    d.setValueAtTime(0.3, t);
    d.linearRampToValueAtTime(1, t + 0.22);
  }

  clap(t, vol) {
    for (let k = 0; k < 3; k++) this.noiseHit(t + k * 0.011, 0.02, 'bandpass', 1400, vol, [this.master], 1.2);
    this.noiseHit(t + 0.03, 0.2, 'bandpass', 1300, vol * 0.8, [this.master, this.verbSend], 1);
  }

  hat(t, vol, open) {
    this.noiseHit(t, open ? 0.28 : 0.045, 'highpass', 7500, vol * 0.5, [this.master]);
  }

  crash(t) {
    this.noiseHit(t, 1.8, 'highpass', 5000, 0.22, [this.master, this.verbSend]);
  }

  boom(t) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 1.2);
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 1.5);
  }

  bass(t, midi, dur) {
    const c = this.ctx;
    const f = mtof(midi);
    const o1 = c.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = f;
    const o2 = c.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f;
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = 8;
    filt.frequency.setValueAtTime(1600, t);
    filt.frequency.exponentialRampToValueAtTime(180, t + dur * 0.9);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.005);
    g.gain.setTargetAtTime(0, t + dur * 0.7, 0.03);
    o1.connect(filt);
    o2.connect(filt);
    filt.connect(g).connect(this.duck);
    o1.start(t); o2.start(t);
    o1.stop(t + dur + 0.2); o2.stop(t + dur + 0.2);
  }

  stab(t, notes, dur) {
    const c = this.ctx;
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = 2;
    filt.frequency.setValueAtTime(3200, t);
    filt.frequency.exponentialRampToValueAtTime(500, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.11, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    filt.connect(g);
    g.connect(this.duck);
    g.connect(this.verbSend);
    g.connect(this.delaySend);
    for (const n of notes) {
      for (const det of [-7, 7]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(n);
        o.detune.value = det;
        o.connect(filt);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }

  pad(t, notes, dur, cutA, cutB) {
    const c = this.ctx;
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(cutA, t);
    filt.frequency.exponentialRampToValueAtTime(cutB, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.5);
    g.gain.setValueAtTime(0.05, t + dur - 0.1);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.6);
    filt.connect(g);
    g.connect(this.duck);
    g.connect(this.verbSend);
    const all = [...notes, notes[0] - 12];
    for (const n of all) {
      for (const det of [-10, 10]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(n);
        o.detune.value = det;
        o.connect(filt);
        o.start(t);
        o.stop(t + dur + 0.7);
      }
    }
  }

  arp(t, midi, vol) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = mtof(midi);
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 3200;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(filt).connect(g);
    g.connect(this.duck);
    g.connect(this.delaySend);
    o.start(t);
    o.stop(t + 0.2);
  }

  riser(t, dur) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(9000, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
    src.connect(f).connect(g);
    g.connect(this.master);
    g.connect(this.verbSend);
    src.start(t);
    src.stop(t + dur + 0.05);

    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(880, t + dur);
    const og = c.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(0.035, t + dur);
    og.gain.linearRampToValueAtTime(0, t + dur + 0.02);
    o.connect(og);
    og.connect(this.verbSend);
    og.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  dum(t, vol) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(98, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.2);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.6);
    this.noiseHit(t, 0.09, 'lowpass', 500, vol * 0.7, [this.master]);
    const d = this.duck.gain;
    d.cancelScheduledValues(t);
    d.setValueAtTime(0.55, t);
    d.linearRampToValueAtTime(1, t + 0.2);
  }

  tek(t, vol) {
    this.noiseHit(t, 0.05, 'highpass', 2500, vol * 0.6, [this.master, this.verbSend]);
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1150, t);
    o.frequency.exponentialRampToValueAtTime(650, t + 0.03);
    g.gain.setValueAtTime(vol * 0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.06);
  }

  darbuka(t, vol) {
    this.noiseHit(t, 0.06, 'bandpass', 3800, vol, [this.master], 3);
  }

  // Zurna: geniz sesi için testere + kare dalga, tepe filtresi, gecikmeli vibrato ve glissando
  zurna(t, midi, dur, vol, voice = 0) {
    const c = this.ctx;
    const f = mtof(midi);
    const from = this.zLast[voice] || f;
    this.zLast[voice] = f;
    const o1 = c.createOscillator();
    o1.type = 'sawtooth';
    const o2 = c.createOscillator();
    o2.type = 'square';
    o2.detune.value = 6;
    for (const o of [o1, o2]) {
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.035);
    }
    const lfo = c.createOscillator();
    lfo.frequency.value = 5.6;
    const lfoG = c.createGain();
    lfoG.gain.setValueAtTime(0, t);
    lfoG.gain.linearRampToValueAtTime(f * 0.009, t + Math.min(0.3, dur));
    lfo.connect(lfoG);
    lfoG.connect(o1.frequency);
    lfoG.connect(o2.frequency);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 380;
    const pk = c.createBiquadFilter();
    pk.type = 'peaking';
    pk.frequency.value = 1700;
    pk.Q.value = 1.2;
    pk.gain.value = 9;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.018);
    g.gain.setValueAtTime(vol, t + Math.max(0.02, dur - 0.03));
    g.gain.linearRampToValueAtTime(0, t + dur + 0.03);
    o1.connect(hp);
    o2.connect(hp);
    hp.connect(pk).connect(lp).connect(g);
    g.connect(this.master);
    g.connect(this.verbSend);
    g.connect(this.delaySend);
    const end = t + dur + 0.06;
    for (const o of [o1, o2, lfo]) { o.start(t); o.stop(end); }
  }

  // Dem tutan ikinci zurna
  drone(t, midi, dur) {
    const c = this.ctx;
    const f = mtof(midi);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1300;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.028, t + 0.3);
    g.gain.setValueAtTime(0.028, t + dur - 0.05);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.25);
    lp.connect(g);
    g.connect(this.master);
    g.connect(this.verbSend);
    for (const [type, det] of [['sawtooth', 0], ['square', 7]]) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.3);
    }
  }
}
