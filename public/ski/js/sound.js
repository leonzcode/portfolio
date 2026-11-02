// Sound made on the fly with Web Audio: wind that rises with speed, the hiss of a carving edge, the scrape of a skid,
// the thump of a landing, the ring of a rail.
export class Sound {
  constructor() { this.ctx = null; this.on = true; }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const ctx = this.ctx = new C();
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = (f, q, type = 'bandpass') => {
      const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      s.connect(fl); fl.connect(g); g.connect(this.master); s.start(); return { g, fl };
    };
    this.master = ctx.createGain(); this.master.gain.value = 0.6; this.master.connect(ctx.destination);
    this.wind = src(500, 0.4, 'lowpass');
    this.carve = src(3200, 1.2);
    this.skid = src(900, 0.8);
    this.grind = src(2400, 9);
    this.noise = noise;
  }
  thump(power) {
    if (!this.ctx) return;
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260 + power * 40;
    const g = ctx.createGain(); const t = ctx.currentTime;
    g.gain.setValueAtTime(Math.min(1, 0.25 + power * 0.08), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + 0.4);
  }
  frame(sk) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, sp = sk.v.length();
    const set = (n, v) => n.g.gain.setTargetAtTime(v, t, 0.06);
    set(this.wind, Math.min(0.5, sp * sp * 0.0009) * (this.on ? 1 : 0));
    this.wind.fl.frequency.setTargetAtTime(300 + sp * 30, t, 0.1);
    const ground = sk.state === 'ground';
    set(this.carve, ground && this.on ? Math.min(0.18, Math.abs(sk.edge) * sp * 0.012) : 0);
    set(this.skid, ground && this.on ? Math.min(0.35, sk.slide * 0.05 + sk.brake * sp * 0.012 + (sk.surf === 1 ? sp * 0.01 : 0)) : 0);
    this.skid.fl.frequency.setTargetAtTime(sk.surf === 1 ? 500 : 950, t, 0.1);
    set(this.grind, sk.state === 'rail' && this.on ? 0.12 + sp * 0.008 : 0);
  }
}
