// סאונד מסונתז (בלי קבצים): מנוע, בוסט ואפקטים קצרים
export class Sfx {
  constructor(enabled = true) { this.enabled = enabled; this.ctx = null; }

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
    this.engGain.gain.setTargetAtTime(active ? 0.07 + Math.abs(throttle) * 0.05 : 0, t, 0.1);
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
  fall() { this.blip(300, 0.4, 'sawtooth', 0.15, -220); }
}
