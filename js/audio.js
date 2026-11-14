// סאונד מסונתז (בלי קבצים): ניטרו, אפקטים קצרים ומוזיקת מירוצים
export class Sfx {
  constructor(enabled = true, music = true) { this.enabled = enabled; this.musicOn = music; this.ctx = null; this.seq = null; }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.5 : 0;
    this.master.connect(ctx.destination);

    this.eng = ctx.createOscillator();
    this.eng.type = 'sawtooth';
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 500;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.eng.connect(this.engFilter).connect(this.engGain).connect(this.master);
    this.eng.start();

    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buf;
    this.noiseBuf = buf;
    this.mus = ctx.createGain();
    this.mus.gain.value = this.musicOn ? 0.55 : 0;
    this.mus.connect(this.master);
    this.noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.6;
    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0;
    this.noise.connect(bp).connect(this.boostGain).connect(this.master);
    this.noise.start();
  }

  setEnabled(v) {
    this.enabled = v;
    if (this.master) this.master.gain.value = v ? 0.5 : 0;
  }

  engine(speed, throttle, boosting, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.eng.frequency.setTargetAtTime(55 + speed * 4.2 + Math.abs(throttle) * 18, t, 0.08);
    this.engFilter.frequency.setTargetAtTime(350 + speed * 30, t, 0.1);
    // המנוע נשמע רק בזמן ניטרו
    this.engGain.gain.setTargetAtTime(active && boosting ? 0.09 : 0, t, 0.08);
    this.boostGain.gain.setTargetAtTime(active && boosting ? 0.32 : 0, t, 0.05);
  }

  blip(freq = 440, dur = 0.15, type = 'square', vol = 0.2, slide = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur);
  }

  jump() { this.blip(260, 0.18, 'triangle', 0.3, 320); }
  pad() { this.blip(520, 0.3, 'sawtooth', 0.18, 700); }
  checkpoint() { this.blip(660, 0.12, 'square', 0.15); setTimeout(() => this.blip(990, 0.2, 'square', 0.15), 110); }
  beep(hi) { this.blip(hi ? 880 : 440, hi ? 0.5 : 0.18, 'square', 0.2); }
  finish() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.25, 'square', 0.18), i * 130)); }
  hit() { this.blip(140, 0.22, 'sawtooth', 0.3, -90); this.blip(900, 0.06, 'square', 0.12); }
  ko() { [392, 523, 784].forEach((f, i) => setTimeout(() => this.blip(f, 0.16, 'square', 0.16), i * 80)); }
  coin() { this.blip(1320, 0.09, 'square', 0.12); setTimeout(() => this.blip(1760, 0.2, 'square', 0.12), 80); }

  // ----- מוזיקה: סיקוונסר קטן (תופים, בס וארפג'יו). seed קובע מקצב, סולם ומהלך אקורדים -----
  setMusic(v) {
    this.musicOn = v;
    if (this.mus) this.mus.gain.setTargetAtTime(v ? 0.55 : 0, this.ctx.currentTime, 0.1);
  }
  musicStart(seed = 1) {
    this.musicStop();
    if (!this.ctx) return;
    const ctx = this.ctx, PROG = [[0, 0, 5, 7], [0, 3, 5, 3], [0, -2, -4, -5], [0, 5, 3, 7], [0, 7, 8, 5]];
    const prog = PROG[seed % PROG.length], root = 55 * Math.pow(2, ((seed * 5) % 7) / 12), stepDur = 60 / (126 + (seed % 4) * 6) / 4;
    const ARP = [[0, 3, 7, 12, 7, 3, 0, 7], [0, 7, 12, 15, 12, 7, 3, 7], [12, 7, 3, 0, 3, 7, 12, 15]][seed % 3];
    const hz = (semi) => root * Math.pow(2, semi / 12);
    const tone = (type, f, t, dur, vol, cut, f2) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      let node = o;
      if (cut) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = cut; o.connect(fl); node = fl; }
      node.connect(g).connect(this.mus);
      o.start(t); o.stop(t + dur + 0.02);
    };
    const hiss = (t, dur, vol, freq) => {
      const n = ctx.createBufferSource(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
      n.buffer = this.noiseBuf; fl.type = 'highpass'; fl.frequency.value = freq;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      n.connect(fl).connect(g).connect(this.mus);
      n.start(t, Math.random() * 0.5, dur + 0.02);
    };
    let i = 0, next = ctx.currentTime + 0.1;
    const tick = () => {
      if (ctx.state !== 'running') { next = ctx.currentTime + 0.1; return; }
      if (next < ctx.currentTime - 0.3) next = ctx.currentTime + 0.05;
      while (next < ctx.currentTime + 0.18) {
        const st = i % 16, bar = Math.floor(i / 16), ch = prog[bar % 4], sect = Math.floor(bar / 4) % 4;
        if (st % 4 === 0) tone('sine', 150, next, 0.2, 0.55, 0, 42);
        if (st % 8 === 4) hiss(next, 0.13, 0.2, 1800);
        if (st % 2 === 1 || (sect > 0 && st % 4 === 2)) hiss(next, 0.035, 0.07, 7000);
        if (st % 2 === 0) tone('sawtooth', hz(ch + (st % 4 === 2 ? 12 : 0)), next, stepDur * 1.6, 0.2, 420);
        if (sect >= 1) tone('square', hz(ch + 24 + ARP[st % 8]), next, stepDur * 0.9, sect === 3 ? 0.05 : 0.035, 2600);
        if (sect === 2 && st % 8 === 0) tone('triangle', hz(ch + 36 + [0, 3, 7, 3][bar % 4]), next, stepDur * 7, 0.07, 3000);
        next += stepDur; i++;
      }
    };
    this.seq = setInterval(tick, 40);
  }
  musicStop() { if (this.seq) clearInterval(this.seq); this.seq = null; }

  fall() { this.blip(300, 0.4, 'sawtooth', 0.15, -220); }
}
