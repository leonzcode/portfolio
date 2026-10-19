// The car's sound, made in the browser (no recordings): the engine as a few harmonics of its firing rate with a
// little noise, louder under load; tyres squealing with slip; wind with speed; a thud on a hit; the indicator's
// tick. Starts on the first key or click (browsers keep audio off until then).
export class CarSound {
  constructor() { this.ctx = null; this.on = true; this.ticking = false; try { this.on = localStorage.getItem('car_sound') !== '0'; } catch (e) {} }

  start() {
    if (this.ctx || !this.on) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = 0.55; this.master.connect(c.destination);
    // engine: a sawtooth and a square at the firing rate and its half, through a low pass that opens with load
    this.eng = c.createGain(); this.eng.gain.value = 0;
    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 900; this.lp.Q.value = 1.2;
    this.eng.connect(this.lp); this.lp.connect(this.master);
    this.oscs = [['sawtooth', 1, 0.5], ['square', 0.5, 0.35], ['sawtooth', 2, 0.18], ['triangle', 0.25, 0.4]].map(([type, mult, g]) => {
      const o = c.createOscillator(); o.type = type; const gg = c.createGain(); gg.gain.value = g; o.connect(gg); gg.connect(this.eng); o.start(); return { o, mult };
    });
    const noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = (gain, f, q, type = 'bandpass') => {
      const s = c.createBufferSource(); s.buffer = noise; s.loop = true;
      const bf = c.createBiquadFilter(); bf.type = type; bf.frequency.value = f; bf.Q.value = q;
      const g = c.createGain(); g.gain.value = gain; s.connect(bf); bf.connect(g); g.connect(this.master); s.start();
      return { g, bf };
    };
    this.rumble = src(0, 180, 0.8);
    this.squeal = src(0, 1400, 8);
    this.wind = src(0, 600, 0.5, 'lowpass');
    this.road = src(0, 90, 0.7);
  }

  stop() { if (this.ctx) { this.ctx.close(); this.ctx = null; } }
  toggle() { this.on = !this.on; try { localStorage.setItem('car_sound', this.on ? '1' : '0'); } catch (e) {} if (!this.on) this.stop(); else this.start(); return this.on; }

  update(dt, v, signalOn) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, p = v.p;
    const rpm = v.rpm, fire = rpm / 60 * 3; // a six's firing rate (three pulses a turn)
    for (const o of this.oscs) o.o.frequency.setTargetAtTime(fire * o.mult, t, 0.03);
    const load = Math.max(v.throttle, 0.15);
    this.eng.gain.setTargetAtTime(0.05 + 0.13 * load, t, 0.05);
    this.lp.frequency.setTargetAtTime(500 + rpm / p.redline * 2600 * (0.5 + load * 0.5), t, 0.05);
    this.rumble.g.gain.setTargetAtTime(0.05 * load, t, 0.05);
    this.rumble.bf.frequency.setTargetAtTime(fire * 0.5 + 60, t, 0.05);
    const sp = Math.abs(v.fwdSpeed);
    let slip = 0;
    for (const w of v.wheels) if (w.contact) slip = Math.max(slip, Math.min(1, w.slip * 1.5 + Math.max(0, w.lat - 0.12) * 4));
    this.squeal.g.gain.setTargetAtTime(sp > 3 ? slip * 0.12 : 0, t, 0.06);
    this.squeal.bf.frequency.setTargetAtTime(1100 + slip * 500, t, 0.1);
    this.wind.g.gain.setTargetAtTime(Math.min(0.25, (sp / 60) ** 2 * 0.25), t, 0.2);
    this.road.g.gain.setTargetAtTime(Math.min(0.12, sp / 30 * 0.12), t, 0.1);
    // the indicator's relay
    if (signalOn !== this.ticking) { this.ticking = signalOn; if (signalOn !== null) this.tick(signalOn ? 1800 : 1300); }
  }

  tick(f) {
    if (!this.ctx) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
    o.type = 'square'; o.frequency.value = f; g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.04);
  }

  hit(speed) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, n = c.createBufferSource();
    const b = c.createBuffer(1, c.sampleRate * 0.4, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (c.sampleRate * 0.06));
    n.buffer = b;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400 + Math.min(speed, 30) * 60;
    const g = c.createGain(); g.gain.value = Math.min(1, speed / 15) * 0.9;
    n.connect(f); f.connect(g); g.connect(this.master); n.start(t);
  }
}
